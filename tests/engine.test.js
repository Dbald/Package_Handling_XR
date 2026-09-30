// Procedure-engine tests. These mirror the engine-verifiable items of the
// PRD §12 release checklist. Headset behaviour still needs hardware testing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProcedureEngine } from '../src/engine.js';
import { SCENARIO } from '../src/scenario.js';

function makeEngine() {
  let t = 1_000_000;
  let n = 0;
  const clock = { advance: (ms) => { t += ms; } };
  const engine = new ProcedureEngine({ now: () => t, idGen: () => `sess-${++n}` });
  return { engine, clock };
}

const ctx = { input: 'test' };

function start(engine) {
  engine.startBriefing();
  engine.startExercise();
}

function perfectA(e) {
  e.inspect('A', ctx);
  e.submitCondition('A', 'damaged', ctx);
  e.decide('A', 'reject', ctx);
  e.place('A', 'quarantine', ctx);
}

function perfectB(e) {
  e.inspect('B', ctx);
  e.submitCondition('B', 'intact', ctx);
  e.decide('B', 'accept', ctx);
  e.scan('B', { aligned: true }, ctx);
  e.place('B', 'scale', ctx);
  e.confirmWeight('B', 'within', ctx);
  e.place('B', 'outbound', ctx);
  e.release('B', ctx);
}

test('correct two-package flow scores 100 with no critical errors', () => {
  const { engine: e } = makeEngine();
  start(e);
  perfectA(e);
  assert.equal(e.packageState('A'), 'quarantined');
  assert.equal(e.activePackage(), 'B');
  perfectB(e);
  assert.equal(e.packageState('B'), 'outbound');
  const r = e.results();
  assert.equal(r.score, 100);
  assert.equal(r.maxScore, 100);
  assert.equal(r.criticalErrors.length, 0);
  assert.equal(r.status, 'proficient');
  assert.equal(r.statusLabel, 'Completed — proficiency met');
  assert.equal(r.corrections, 0);
});

test('accepting the damaged package is blocked, critical, and recoverable', () => {
  const { engine: e } = makeEngine();
  start(e);
  e.inspect('A', ctx);
  e.submitCondition('A', 'damaged', ctx);
  const bad = e.decide('A', 'accept', ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'ACCEPTED_DAMAGED');
  assert.equal(e.packageState('A'), 'condition_submitted', 'state preserved');
  // Recover through quarantine.
  assert.equal(e.decide('A', 'reject', ctx).ok, true);
  assert.equal(e.place('A', 'quarantine', ctx).ok, true);
  perfectB(e);
  const r = e.results();
  assert.equal(r.score, 90);
  assert.equal(r.criticalErrors.length, 1);
  assert.equal(r.criticalErrors[0].type, 'ACCEPTED_DAMAGED');
  assert.equal(r.status, 'practice', 'critical error retained through completion');
  assert.equal(r.checkpoints.find((c) => c.id === 'A_REJECT').corrected, true);
});

test('early outbound release is blocked, fails the final two checkpoints, and stays critical', () => {
  const { engine: e } = makeEngine();
  start(e);
  perfectA(e);
  e.inspect('B', ctx);
  e.submitCondition('B', 'intact', ctx);
  e.decide('B', 'accept', ctx);
  const early = e.place('B', 'outbound', ctx);
  assert.equal(early.ok, false);
  assert.equal(early.code, 'PREMATURE_RELEASE');
  assert.match(early.message, /scan/);
  assert.match(early.message, /weight confirmation/);
  assert.equal(e.packageState('B'), 'accepted');
  // Release button pressed prematurely is the same critical error, not a second one.
  e.release('B', ctx);
  e.scan('B', { aligned: true }, ctx);
  e.place('B', 'scale', ctx);
  e.confirmWeight('B', 'within', ctx);
  e.place('B', 'outbound', ctx);
  e.release('B', ctx);
  const r = e.results();
  assert.equal(r.complete, true);
  assert.equal(r.score, 80);
  assert.equal(r.criticalErrors.length, 1);
  assert.equal(r.criticalErrors[0].type, 'PREMATURE_RELEASE');
  assert.equal(r.status, 'practice');
  const cp = Object.fromEntries(r.checkpoints.map((c) => [c.id, c.status]));
  assert.equal(cp.B_OUTBOUND, 'failed');
  assert.equal(cp.B_NO_PREMATURE, 'failed');
});

test('rejecting the intact package allows correction without first-attempt points', () => {
  const { engine: e } = makeEngine();
  start(e);
  perfectA(e);
  e.inspect('B', ctx);
  e.submitCondition('B', 'intact', ctx);
  const bad = e.decide('B', 'reject', ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.critical, undefined);
  assert.equal(e.packageState('B'), 'condition_submitted');
  assert.equal(e.decide('B', 'accept', ctx).ok, true);
  e.scan('B', { aligned: true }, ctx);
  e.place('B', 'scale', ctx);
  e.confirmWeight('B', 'within', ctx);
  e.place('B', 'outbound', ctx);
  e.release('B', ctx);
  const r = e.results();
  assert.equal(r.score, 90);
  assert.equal(r.criticalErrors.length, 0);
  assert.equal(r.status, 'proficient', '90 with no critical errors meets the demo threshold');
});

test('repeated invalid actions do not duplicate score changes, criticals, or transitions', () => {
  const { engine: e } = makeEngine();
  start(e);
  e.inspect('A', ctx);
  for (let i = 0; i < 5; i++) e.submitCondition('A', 'intact', ctx);
  e.submitCondition('A', 'damaged', ctx);
  for (let i = 0; i < 5; i++) e.decide('A', 'accept', ctx);
  e.decide('A', 'reject', ctx);
  e.decide('A', 'reject', ctx); // repeat valid action
  for (let i = 0; i < 3; i++) e.place('A', 'outbound', ctx);
  e.place('A', 'quarantine', ctx);
  e.place('A', 'quarantine', ctx);
  assert.equal(e.criticals.length, 2, 'one ACCEPTED_DAMAGED + one DAMAGED_OUTBOUND');
  assert.equal(e.score(), 0);
  assert.equal(e.packageState('A'), 'quarantined');
  e.inspect('B', ctx);
  e.submitCondition('B', 'intact', ctx);
  e.decide('B', 'accept', ctx);
  for (let i = 0; i < 4; i++) e.scan('B', { aligned: true }, ctx);
  assert.equal(e.packageState('B'), 'scanned');
  assert.equal(e.score(), 30);
});

test('actions are blocked while paused and the timer stops', () => {
  const { engine: e, clock } = makeEngine();
  start(e);
  clock.advance(10_000);
  e.pause('tracking');
  clock.advance(60_000);
  const r = e.inspect('A', ctx);
  assert.equal(r.code, 'PAUSED');
  assert.equal(e.packageState('A'), 'waiting');
  e.resume('tracking');
  clock.advance(5_000);
  assert.equal(e.elapsedMs(), 15_000);
});

test('timer does not run during setup or briefing, and stops at completion', () => {
  const { engine: e, clock } = makeEngine();
  clock.advance(30_000);
  e.startBriefing();
  clock.advance(30_000);
  e.startExercise();
  clock.advance(1_000);
  perfectA(e);
  perfectB(e);
  clock.advance(99_000);
  assert.equal(e.elapsedMs(), 1_000);
});

test('a partial session never produces a passing result', () => {
  const { engine: e } = makeEngine();
  start(e);
  perfectA(e);
  e.inspect('B', ctx);
  e.submitCondition('B', 'intact', ctx);
  const r = e.results();
  assert.equal(r.complete, false);
  assert.equal(r.status, 'incomplete');
  assert.equal(r.passed, false);
});

test('reset restores every package, checkpoint, score, timer and log', () => {
  const { engine: e, clock } = makeEngine();
  start(e);
  const first = e.sessionId;
  e.inspect('A', ctx);
  e.submitCondition('A', 'damaged', ctx);
  e.decide('A', 'accept', ctx);
  clock.advance(5000);
  e.reset();
  assert.notEqual(e.sessionId, first);
  assert.equal(e.phase, 'setup');
  assert.equal(e.packageState('A'), 'waiting');
  assert.equal(e.packageState('B'), 'waiting');
  assert.equal(e.score(), 0);
  assert.equal(e.criticals.length, 0);
  assert.equal(e.log.length, 0);
  assert.equal(e.elapsedMs(), 0);
  assert.ok(e.results().checkpoints.every((c) => c.status === 'pending' && !c.corrected));
});

test('packages are processed in order; Package B is locked until A is quarantined', () => {
  const { engine: e } = makeEngine();
  start(e);
  const r = e.inspect('B', ctx);
  assert.equal(r.code, 'NOT_ACTIVE');
  assert.equal(e.packageState('B'), 'waiting');
  // Out-of-order attempts are guidance, never scored.
  e.place('B', 'outbound', ctx);
  assert.equal(e.criticals.length, 0);
});

test('weighing before scanning fails the scan-order checkpoints and is blocked', () => {
  const { engine: e } = makeEngine();
  start(e);
  perfectA(e);
  e.inspect('B', ctx);
  e.submitCondition('B', 'intact', ctx);
  e.decide('B', 'accept', ctx);
  const r = e.place('B', 'scale', ctx);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SCAN_FIRST');
  assert.equal(e.packageState('B'), 'accepted');
  e.scan('B', { aligned: true }, ctx);
  e.place('B', 'scale', ctx);
  e.confirmWeight('B', 'within', ctx);
  e.place('B', 'outbound', ctx);
  e.release('B', ctx);
  const res = e.results();
  assert.equal(res.score, 80);
  assert.equal(res.criticalErrors.length, 0);
  assert.equal(res.status, 'proficient');
});

test('an unaligned scan is a no-read with no penalty', () => {
  const { engine: e } = makeEngine();
  start(e);
  perfectA(e);
  e.inspect('B', ctx);
  e.submitCondition('B', 'intact', ctx);
  e.decide('B', 'accept', ctx);
  assert.equal(e.scan('B', { aligned: false }, ctx).code, 'NO_READ');
  assert.equal(e.packageState('B'), 'accepted');
  assert.equal(e.results().checkpoints.find((c) => c.id === 'B_SCAN_FIRST').status, 'pending');
});

test('a wrong weight confirmation is corrected but loses first-attempt points', () => {
  const { engine: e } = makeEngine();
  start(e);
  perfectA(e);
  e.inspect('B', ctx);
  e.submitCondition('B', 'intact', ctx);
  e.decide('B', 'accept', ctx);
  e.scan('B', { aligned: true }, ctx);
  e.place('B', 'scale', ctx);
  assert.equal(e.confirmWeight('B', 'outside', ctx).ok, false);
  assert.equal(e.packageState('B'), 'weighed');
  assert.equal(e.confirmWeight('B', 'within', ctx).ok, true);
  e.place('B', 'outbound', ctx);
  e.release('B', ctx);
  assert.equal(e.results().score, 90);
});

test('placing a damaged package outbound is critical even before a decision', () => {
  const { engine: e } = makeEngine();
  start(e);
  e.inspect('A', ctx);
  const r = e.place('A', 'outbound', ctx);
  assert.equal(r.code, 'DAMAGED_OUTBOUND');
  assert.equal(r.returnToBench, true);
  assert.equal(e.criticals[0].type, 'DAMAGED_OUTBOUND');
});

test('help, selection and rotation-equivalent actions never change the score', () => {
  const { engine: e } = makeEngine();
  start(e);
  e.pause('menu');
  e.resume('menu');
  e.inspect('A', ctx);
  e.inspect('A', ctx);
  e.place('A', 'bench', ctx);
  assert.equal(e.score(), 0);
  assert.equal(e.criticals.length, 0);
  assert.ok(e.results().checkpoints.every((c) => c.status === 'pending'));
});

test('session log carries the PRD minimum data fields', () => {
  const { engine: e } = makeEngine();
  start(e);
  perfectA(e);
  const entry = e.log.find((l) => l.checkpointId === 'A_REJECT');
  for (const k of ['sessionId', 'scenarioVersion', 'packageId', 'checkpointId', 'action', 'timestamp',
    'valid', 'firstAttempt', 'critical', 'score', 'completion']) {
    assert.ok(k in entry, `missing ${k}`);
  }
  assert.equal(entry.packageId, SCENARIO.packages.A.id);
  assert.equal(entry.firstAttempt, 'correct');
});

test('five replay cycles leave no stale state', () => {
  const { engine: e } = makeEngine();
  for (let i = 0; i < 5; i++) {
    start(e);
    if (i % 2) e.place('B', 'outbound', ctx); // B is locked here: must not score or leak
    perfectA(e);
    perfectB(e);
    assert.equal(e.results().score, 100);
    assert.equal(e.results().status, 'proficient');
    e.reset();
  }
});

test('removing a staged package from the conveyor un-stages it; release then needs re-staging', () => {
  const { engine: e } = makeEngine();
  start(e);
  perfectA(e);
  e.inspect('B', ctx);
  e.submitCondition('B', 'intact', ctx);
  e.decide('B', 'accept', ctx);
  e.scan('B', { aligned: true }, ctx);
  e.place('B', 'scale', ctx);
  e.confirmWeight('B', 'within', ctx);
  e.place('B', 'outbound', ctx);
  assert.equal(e.packageState('B'), 'staged');
  e.place('B', 'bench', ctx);
  assert.equal(e.packageState('B'), 'weight_confirmed');
  const r = e.release('B', ctx);
  assert.equal(r.code, 'PREREQ', 'not a premature-release critical: all checks are done');
  assert.equal(e.criticals.length, 0);
  e.place('B', 'outbound', ctx);
  e.release('B', ctx);
  assert.equal(e.results().score, 100);
});
