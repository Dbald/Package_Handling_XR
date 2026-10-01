// Station 1 Pack-Out engine tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PackEngine } from '../src/pack/engine.js';

const ctx = { input: 'test' };

function make() {
  let t = 1_000_000;
  let n = 0;
  const e = new PackEngine({ now: () => t, idGen: () => `pk-${++n}` });
  return { e, advance: (ms) => { t += ms; } };
}

function start(e) {
  e.startBriefing();
  e.startExercise();
}

function perfect(e) {
  e.scanTote(ctx);
  e.scanItem('mug', {}, ctx);
  e.scanItem('book', {}, ctx);
  e.scanItem('case', {}, ctx);
  e.divertItem('case', ctx);
  e.selectCarton('M', ctx);
  e.packItem('mug', ctx);
  e.packItem('book', ctx);
  e.addDunnage(ctx);
  e.addDunnage(ctx);
  e.seal(ctx);
  e.confirmWeight('within', ctx);
  e.printLabel(ctx);
  e.applyLabel(ctx);
  e.stage(ctx);
  return e.release(ctx);
}

test('perfect pack-out scores 100 with no critical errors', () => {
  const { e } = make();
  start(e);
  const r = perfect(e);
  assert.equal(r.code, 'RELEASED');
  const res = e.results();
  assert.equal(res.score, 100);
  assert.equal(res.criticalErrors.length, 0);
  assert.equal(res.status, 'proficient');
  assert.equal(e.measuredWeightKg(), 1.72);
});

test('handling items before opening the order fails PK_ORDER_FIRST but is recoverable', () => {
  const { e } = make();
  start(e);
  assert.equal(e.scanItem('mug', {}, ctx).code, 'ORDER_NOT_OPEN');
  assert.equal(e.items.mug.scanned, false);
  perfect(e);
  const res = e.results();
  assert.equal(res.score, 90);
  assert.equal(res.checkpoints.find((c) => c.id === 'PK_ORDER_FIRST').corrected, true);
});

test('packing the item not on the order is blocked and critical', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  e.selectCarton('M', ctx);
  const r = e.packItem('case', ctx);
  assert.equal(r.code, 'WRONG_ITEM');
  assert.equal(r.tone, 'critical');
  assert.equal(e.items.case.loc, 'tote');
  e.packItem('case', ctx); // repeat: no duplicate critical
  assert.equal(e.criticals.length, 1);
  e.scanItem('mug', {}, ctx);
  e.scanItem('book', {}, ctx);
  e.divertItem('case', ctx);
  e.packItem('mug', ctx);
  e.packItem('book', ctx);
  e.addDunnage(ctx);
  e.seal(ctx);
  e.confirmWeight('within', ctx);
  e.printLabel(ctx);
  e.applyLabel(ctx);
  e.stage(ctx);
  e.release(ctx);
  const res = e.results();
  assert.equal(res.complete, true);
  assert.equal(res.status, 'practice');
  assert.equal(res.score, 90);
});

test('wrong carton sizes are blocked and lose first-attempt points', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  assert.equal(e.selectCarton('L', ctx).code, 'CARTON_WRONG');
  assert.equal(e.selectCarton('S', ctx).code, 'CARTON_WRONG');
  assert.equal(e.carton, null);
  assert.equal(e.selectCarton('M', ctx).ok, true);
  assert.equal(e.checkpoints.PK_CARTON.status, 'failed');
  assert.equal(e.checkpoints.PK_CARTON.corrected, true);
});

test('packing an unscanned item is blocked', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  e.selectCarton('M', ctx);
  assert.equal(e.packItem('book', ctx).code, 'SCAN_FIRST');
  assert.equal(e.items.book.loc, 'tote');
  assert.equal(e.checkpoints.PK_SCAN_ITEMS.status, 'failed');
});

test('sealing is blocked for missing items, an uncleared tote, and missing void fill', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  e.scanItem('mug', {}, ctx);
  e.scanItem('book', {}, ctx);
  e.selectCarton('M', ctx);
  e.packItem('mug', ctx);
  assert.equal(e.seal(ctx).code, 'MISSING_ITEMS');
  e.packItem('book', ctx);
  assert.equal(e.seal(ctx).code, 'TOTE_NOT_CLEAR');
  e.divertItem('case', ctx);
  assert.equal(e.seal(ctx).code, 'NEEDS_DUNNAGE');
  e.addDunnage(ctx);
  assert.equal(e.seal(ctx).code, 'SEALED');
  const cp = e.checkpoints;
  assert.equal(cp.PK_SEAL.status, 'failed');
  assert.equal(cp.PK_EXCEPTION.status, 'failed');
  assert.equal(cp.PK_DUNNAGE.status, 'failed');
});

test('printing before weight confirmation fails the label-order checkpoint', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  assert.equal(e.printLabel(ctx).code, 'PRINT_EARLY');
  assert.equal(e.labelPrinted, false);
  assert.equal(e.checkpoints.PK_LABEL_ORDER.status, 'failed');
});

test('premature release is critical, blocked and fails the last two checkpoints', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  e.scanItem('mug', {}, ctx);
  e.scanItem('book', {}, ctx);
  e.scanItem('case', {}, ctx);
  e.divertItem('case', ctx);
  e.selectCarton('M', ctx);
  e.packItem('mug', ctx);
  e.packItem('book', ctx);
  e.addDunnage(ctx);
  e.seal(ctx);
  const r = e.stage(ctx);
  assert.equal(r.code, 'PREMATURE_RELEASE');
  assert.match(r.message, /weight confirmation/);
  assert.equal(e.staged, false);
  e.release(ctx); // same critical, not duplicated
  assert.equal(e.criticals.length, 1);
  e.confirmWeight('within', ctx);
  e.printLabel(ctx);
  e.applyLabel(ctx);
  e.stage(ctx);
  e.release(ctx);
  const res = e.results();
  assert.equal(res.score, 80);
  assert.equal(res.status, 'practice');
});

test('diverting an order item is an error and nothing moves', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  assert.equal(e.divertItem('mug', ctx).code, 'ON_ORDER');
  assert.equal(e.items.mug.loc, 'tote');
});

test('unstaging returns the carton to a pre-release state without penalty', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  ['mug', 'book', 'case'].forEach((k) => e.scanItem(k, {}, ctx));
  e.divertItem('case', ctx);
  e.selectCarton('M', ctx);
  e.packItem('mug', ctx);
  e.packItem('book', ctx);
  e.addDunnage(ctx);
  e.seal(ctx);
  e.confirmWeight('within', ctx);
  e.printLabel(ctx);
  e.applyLabel(ctx);
  e.stage(ctx);
  e.unstage();
  assert.equal(e.release(ctx).code, 'PREREQ');
  e.stage(ctx);
  assert.equal(e.release(ctx).code, 'RELEASED');
  assert.equal(e.results().score, 100);
});

test('step() follows the workflow for guidance', () => {
  const { e } = make();
  start(e);
  const seen = [e.step()];
  e.scanTote(ctx);
  seen.push(e.step());
  ['mug', 'book', 'case'].forEach((k) => e.scanItem(k, {}, ctx));
  seen.push(e.step());
  e.divertItem('case', ctx);
  seen.push(e.step());
  e.selectCarton('M', ctx);
  seen.push(e.step());
  e.packItem('mug', ctx);
  e.packItem('book', ctx);
  seen.push(e.step());
  e.addDunnage(ctx);
  seen.push(e.step());
  e.seal(ctx);
  seen.push(e.step());
  assert.deepEqual(seen, ['open', 'scan', 'exception', 'carton', 'pack', 'dunnage', 'seal', 'weigh']);
});

test('paused engine blocks actions; reset restores everything', () => {
  const { e, advance } = make();
  start(e);
  e.pause('menu');
  assert.equal(e.scanTote(ctx).code, 'PAUSED');
  e.resume('menu');
  perfect(e);
  advance(1000);
  e.reset();
  assert.equal(e.phase, 'setup');
  assert.equal(e.orderOpen, false);
  assert.equal(e.carton, null);
  assert.equal(e.dunnage, 0);
  assert.equal(e.score(), 0);
  assert.equal(e.log.length, 0);
  assert.ok(Object.values(e.items).every((i) => !i.scanned && i.loc === 'tote'));
});
