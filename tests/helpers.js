// Shared test drivers: correct runs through each station, read from the
// scenario data so they follow whatever orders / packages are configured.
export const ctx = { input: 'test' };

/** Pack the current tote correctly, from opening the order to release. */
export function packTote(e) {
  const s = e.scenario;
  e.scanTote(ctx);
  for (const k of s.itemOrder) e.scanItem(k, {}, ctx);
  for (const k of s.itemOrder) if (!s.items[k].onOrder) e.divertItem(k, ctx);
  e.selectCarton(s.correctCarton, ctx);
  for (const k of s.itemOrder) if (s.items[k].onOrder) e.packItem(k, ctx);
  if (s.itemOrder.some((k) => s.items[k].onOrder && s.items[k].fragile)) {
    e.addDunnage(ctx);
    e.addDunnage(ctx);
  }
  e.seal(ctx);
  e.confirmWeight('within', ctx);
  e.printLabel(ctx);
  e.applyLabel(ctx);
  e.stage(ctx);
  return e.release(ctx);
}

/** Pack every remaining tote of the run correctly. */
export function packRest(e) {
  let r = null;
  while (e.phase === 'exercise') r = packTote(e);
  return r;
}

/** Handle one Station 2 package correctly. */
export function dockPackage(e, k) {
  const def = e.scenario.packages[k];
  e.inspect(k, ctx);
  e.submitCondition(k, def.condition, ctx);
  if (def.condition === 'damaged') {
    e.decide(k, 'reject', ctx);
    return e.place(k, 'quarantine', ctx);
  }
  e.decide(k, 'accept', ctx);
  e.scan(k, { aligned: true }, ctx);
  e.place(k, 'scale', ctx);
  e.confirmWeight(k, 'within', ctx);
  e.place(k, 'outbound', ctx);
  return e.release(k, ctx);
}

export function dockAll(e) {
  for (const k of e.scenario.order) if (!e.isFinished(k)) dockPackage(e, k);
}

/** Score with `misses` failed checkpoints out of the station's list. */
export function pct(e, misses) {
  const n = e.scenario.checkpoints.length;
  return Math.round((100 * (n - misses)) / n);
}
