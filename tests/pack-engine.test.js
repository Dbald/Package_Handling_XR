// Station 1 Pack-Out engine tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PackEngine } from '../src/pack/engine.js';
import { packRun, PACK_ORDERS } from '../src/pack/scenario.js';
import { ctx, packTote, packRest, pct } from './helpers.js';

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

test('a shift is four totes needing cartons M, S, L, M', () => {
  for (const v of [0, 1]) {
    const run = packRun(v);
    assert.equal(run.orders.length, 4);
    assert.deepEqual(run.orders.map((o) => o.correctCarton), ['M', 'S', 'L', 'M']);
    assert.equal(new Set(run.checkpoints.map((c) => c.id)).size, run.checkpoints.length, 'unique ids');
    // Each run mixes fragile items, mis-picks and at least one clean tote.
    assert.ok(run.orders.some((o) => o.itemOrder.some((k) => o.items[k].fragile)));
    assert.ok(run.orders.some((o) => o.itemOrder.some((k) => !o.items[k].onOrder)));
  }
  assert.ok(packRun(0).orders.some((o) => o.itemOrder.every((k) => o.items[k].onOrder)), 'one tote has no mis-pick');
});

test('every order fits its tote and carton', () => {
  const inner = { S: [0.208, 0.114, 0.158], M: [0.308, 0.174, 0.228], L: [0.448, 0.294, 0.348] };
  const ext = (size, rot) => {
    if (rot === 'stand') return [size[1], size[2], size[0]];
    const q = Math.abs(Math.round((rot ?? 0) / (Math.PI / 2))) % 2;
    return q ? [size[2], size[1], size[0]] : size;
  };
  for (const v of [0, 1]) {
    for (const o of packRun(v).orders) {
      for (const k of o.itemOrder) {
        const [x, y, z, rot] = o.toteSlots[k];
        const [w, h, d] = ext(o.items[k].size, rot);
        assert.ok(Math.abs(x) + w / 2 <= 0.19 + 0.012 && Math.abs(z) + d / 2 <= 0.15 + 0.012, `${o.order.id} ${k} in tote`);
        assert.ok(y - h / 2 >= 0.019, `${o.order.id} ${k} above tote floor`);
        if (!o.items[k].onOrder) continue;
        const [cx, cy, cz, crot] = o.cartonSlots[k];
        const [cw, ch, cd] = ext(o.items[k].size, crot);
        const [iw, ih, id] = inner[o.correctCarton];
        assert.ok(Math.abs(cx) + cw / 2 <= iw / 2 + 0.003 && Math.abs(cz) + cd / 2 <= id / 2 + 0.003, `${o.order.id} ${k} inside carton walls`);
        assert.ok(cy + ch / 2 <= ih + 0.006 && cy - ch / 2 >= 0.005, `${o.order.id} ${k} below carton top`);
      }
    }
  }
  assert.equal(Object.keys(PACK_ORDERS).length, 8);
});

test('perfect shift: four totes in a row score 100 with no critical errors', () => {
  const { e } = make();
  start(e);
  const r = perfect(e);
  assert.equal(r.code, 'RELEASED');
  assert.equal(e.isComplete(), false, 'tote 1 done, three to go');
  assert.equal(e.orderIndex, 1);
  assert.equal(e.scenario.order.id, 'ORD-58257');
  assert.equal(e.orderOpen, false, 'next tote starts closed');
  assert.equal(e.carton, null);
  assert.equal(e.step(), 'open');
  const ids = [];
  e.on((evt) => { if (evt.type === 'order') ids.push(evt.index); });
  const last = packRest(e);
  assert.deepEqual(ids, [2, 3]);
  assert.equal(last.lastOrder, true);
  assert.equal(e.isComplete(), true);
  const res = e.results();
  assert.equal(res.score, 100);
  assert.equal(res.criticalErrors.length, 0);
  assert.equal(res.status, 'proficient');
});

test('a clean tote (no mis-pick, nothing fragile) skips the exception and void-fill steps', () => {
  const { e } = make();
  start(e);
  for (let i = 0; i < 3; i++) packTote(e);
  assert.equal(e.scenario.order.id, 'ORD-58344');
  e.scanTote(ctx);
  for (const k of e.scenario.itemOrder) e.scanItem(k, {}, ctx);
  assert.equal(e.step(), 'carton', 'no exception step');
  e.selectCarton('M', ctx);
  for (const k of e.scenario.itemOrder) e.packItem(k, ctx);
  assert.equal(e.step(), 'seal', 'no void-fill step');
  assert.equal(e.seal(ctx).code, 'SEALED');
  assert.equal(e.checkpoints.T4_PK_EXCEPTION, undefined);
  assert.equal(e.checkpoints.T4_PK_DUNNAGE, undefined);
});

test('the same mistake on two totes counts on each tote', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  assert.equal(e.selectCarton('L', ctx).code, 'CARTON_WRONG');
  packTote(e);
  e.scanTote(ctx);
  assert.equal(e.selectCarton('M', ctx).code, 'CARTON_WRONG');
  packRest(e);
  assert.equal(e.checkpoints.T1_PK_CARTON.status, 'failed');
  assert.equal(e.checkpoints.T2_PK_CARTON.status, 'failed');
  assert.equal(e.results().score, pct(e, 2));
});

test('handling items before opening the order fails PK_ORDER_FIRST but is recoverable', () => {
  const { e } = make();
  start(e);
  assert.equal(e.scanItem('mug', {}, ctx).code, 'ORDER_NOT_OPEN');
  assert.equal(e.items.mug.scanned, false);
  perfect(e);
  packRest(e);
  const res = e.results();
  assert.equal(res.score, pct(e, 1));
  assert.equal(res.checkpoints.find((c) => c.id === 'T1_PK_ORDER_FIRST').corrected, true);
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
  packRest(e);
  const res = e.results();
  assert.equal(res.complete, true);
  assert.equal(res.status, 'practice');
  assert.equal(res.score, pct(e, 1));
});

test('wrong carton sizes are blocked and lose first-attempt points', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  assert.equal(e.selectCarton('L', ctx).code, 'CARTON_WRONG');
  assert.equal(e.selectCarton('S', ctx).code, 'CARTON_WRONG');
  assert.equal(e.carton, null);
  assert.equal(e.selectCarton('M', ctx).ok, true);
  assert.equal(e.checkpoints.T1_PK_CARTON.status, 'failed');
  assert.equal(e.checkpoints.T1_PK_CARTON.corrected, true);
});

test('packing an unscanned item is blocked', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  e.selectCarton('M', ctx);
  assert.equal(e.packItem('book', ctx).code, 'SCAN_FIRST');
  assert.equal(e.items.book.loc, 'tote');
  assert.equal(e.checkpoints.T1_PK_SCAN_ITEMS.status, 'failed');
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
  assert.equal(cp.T1_PK_SEAL.status, 'failed');
  assert.equal(cp.T1_PK_EXCEPTION.status, 'failed');
  assert.equal(cp.T1_PK_DUNNAGE.status, 'failed');
});

test('printing before weight confirmation fails the label-order checkpoint', () => {
  const { e } = make();
  start(e);
  e.scanTote(ctx);
  assert.equal(e.printLabel(ctx).code, 'PRINT_EARLY');
  assert.equal(e.labelPrinted, false);
  assert.equal(e.checkpoints.T1_PK_LABEL_ORDER.status, 'failed');
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
  packRest(e);
  const res = e.results();
  assert.equal(res.score, pct(e, 2));
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
  packRest(e);
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
  assert.equal(e.orderIndex, 0);
  assert.equal(e.scenario.order.id, 'ORD-58213');
  assert.equal(e.orderOpen, false);
  assert.equal(e.carton, null);
  assert.equal(e.dunnage, 0);
  assert.equal(e.score(), 0);
  assert.equal(e.log.length, 0);
  assert.ok(Object.values(e.items).every((i) => !i.scanned && i.loc === 'tote'));
});

test('setRun switches to the replay orders and starts from tote 1', () => {
  const { e } = make();
  start(e);
  packTote(e);
  e.setRun(packRun(1));
  assert.equal(e.phase, 'setup');
  assert.equal(e.orderIndex, 0);
  assert.equal(e.scenario.order.id, 'ORD-61102');
  start(e);
  packRest(e);
  assert.equal(e.results().score, 100);
  assert.equal(e.results().checkpoints.length, packRun(1).checkpoints.length);
});
