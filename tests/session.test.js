// Session flow across Station 1 (pack) and Station 2 (dock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { PackEngine } from '../src/pack/engine.js';
import { ProcedureEngine } from '../src/engine.js';

import { ctx, packRest, dockAll } from './helpers.js';

function make() {
  let n = 0;
  const now = () => 1_000_000;
  const idGen = () => `id-${++n}`;
  return new Session({ pack: new PackEngine({ now, idGen }), dock: new ProcedureEngine({ now, idGen }) });
}

const packAll = packRest;

test('full two-station run: 200/200 and proficient', () => {
  const s = make();
  s.toBriefing();
  assert.equal(s.stationKey, 'pack');
  s.startPack();
  assert.equal(s.toDock(), false, 'cannot leave Station 1 before it is complete');
  packAll(s.pack);
  assert.equal(s.toDock(), true);
  assert.equal(s.stationKey, 'dock');
  s.startDock();
  dockAll(s.dock);
  s.sync();
  assert.equal(s.phase, 'complete');
  const r = s.results();
  assert.equal(r.score, 200);
  assert.equal(r.maxScore, 200);
  assert.equal(r.status, 'proficient');
});

test('skipping Station 1 for a demo never produces a passing result', () => {
  const s = make();
  s.toBriefing();
  assert.equal(s.toDock({ skip: true }), true);
  s.startDock();
  dockAll(s.dock);
  s.sync();
  const r = s.results();
  assert.equal(r.status, 'incomplete');
  assert.match(r.statusLabel, /Station 1 skipped/);
  assert.equal(r.passed, false);
});

test('a critical error at either station makes the session practice-recommended', () => {
  const s = make();
  s.startPack();
  s.pack.scanTote(ctx);
  s.pack.selectCarton('M', ctx);
  s.pack.packItem('case', ctx); // critical
  packAll(s.pack);
  s.toDock();
  s.startDock();
  dockAll(s.dock);
  s.sync();
  const r = s.results();
  assert.equal(r.status, 'practice');
  assert.equal(r.criticalErrors[0].station, 1);
});

test('pause applies to both stations; reset restarts the whole session', () => {
  const s = make();
  s.startPack();
  s.pause('menu');
  assert.equal(s.isPaused(), true);
  assert.equal(s.pack.scanTote(ctx).code, 'PAUSED');
  s.resume();
  assert.equal(s.isPaused(), false);
  packAll(s.pack);
  s.reset();
  assert.equal(s.phase, 'setup');
  assert.equal(s.pack.phase, 'setup');
  assert.equal(s.dock.phase, 'setup');
  assert.equal(s.results().score, 0);
});
