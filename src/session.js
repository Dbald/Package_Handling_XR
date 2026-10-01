// Session flow across stations:
//   setup → briefing → pack (Station 1) → dock-briefing → dock (Station 2) → complete
// Each station keeps its own engine, score and timer; the session combines
// them. Pure logic (no rendering) so it is unit-tested.
import { ProcedureEngine } from './engine.js';
import { PackEngine } from './pack/engine.js';

export const STATIONS = [
  { key: 'pack', number: 1, name: 'Pack-Out' },
  { key: 'dock', number: 2, name: 'Dock Check' },
];

export class Session {
  constructor({ pack = new PackEngine(), dock = new ProcedureEngine() } = {}) {
    this.pack = pack;
    this.dock = dock;
    this.listeners = new Set();
    this.phase = 'setup';
    this.skipped = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _set(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    for (const fn of this.listeners) fn({ type: 'session-phase', phase }, this);
  }

  /** Station whose scene is in front of the learner. */
  get stationKey() {
    return ['dock-briefing', 'dock', 'complete'].includes(this.phase) ? 'dock' : 'pack';
  }

  get engines() {
    return [this.pack, this.dock];
  }

  reset() {
    this.pack.reset();
    this.dock.reset();
    this.skipped.clear();
    this._set('setup');
  }

  toBriefing() {
    if (this.phase === 'setup') this._set('briefing');
  }

  startPack() {
    if (this.phase === 'setup') this._set('briefing');
    if (this.phase !== 'briefing') return null;
    // Start the engine before announcing the phase, so listeners see a running station.
    const r = this.pack.startExercise();
    this._set('pack');
    return r;
  }

  /** Move to Station 2. `skip` is for demos that start at the dock. */
  toDock({ skip = false } = {}) {
    if (!['setup', 'briefing', 'pack'].includes(this.phase)) return false;
    if (this.phase === 'pack' && !this.pack.isComplete() && !skip) return false;
    if (skip && !this.pack.isComplete()) this.skipped.add('pack');
    this.dock.startBriefing();
    this._set('dock-briefing');
    return true;
  }

  startDock() {
    if (this.phase !== 'dock-briefing') return null;
    const r = this.dock.startExercise();
    this._set('dock');
    return r;
  }

  /** Call after engine events: advances to 'complete' when Station 2 finishes. */
  sync() {
    if (this.phase === 'dock' && this.dock.isComplete()) this._set('complete');
  }

  pause(reason) {
    for (const e of this.engines) e.pause(reason);
  }

  resume(reason) {
    for (const e of this.engines) e.resume(reason);
  }

  isPaused() {
    return this.engines.some((e) => e.isPaused());
  }

  get pauseReasons() {
    return new Set(this.engines.flatMap((e) => [...e.pauseReasons]));
  }

  elapsedMs() {
    return this.pack.elapsedMs() + this.dock.elapsedMs();
  }

  results() {
    const stations = STATIONS.map((s) => ({
      ...s,
      skipped: this.skipped.has(s.key),
      results: this[s.key].results(),
    }));
    const allComplete = stations.every((s) => s.results.complete);
    const allProficient = stations.every((s) => s.results.status === 'proficient');
    let status = 'incomplete';
    if (allComplete) status = allProficient ? 'proficient' : 'practice';
    const skippedNames = stations.filter((s) => s.skipped).map((s) => `Station ${s.number}`);
    const statusLabel = {
      proficient: 'Completed — proficiency met',
      practice: 'Completed — practice recommended',
      incomplete: skippedNames.length ? `Incomplete — ${skippedNames.join(', ')} skipped` : 'Incomplete',
    }[status];
    return {
      status,
      statusLabel,
      complete: allComplete,
      passed: status === 'proficient',
      score: stations.reduce((a, s) => a + s.results.score, 0),
      maxScore: stations.reduce((a, s) => a + s.results.maxScore, 0),
      criticalErrors: stations.flatMap((s) => s.results.criticalErrors.map((c) => ({ ...c, station: s.number }))),
      elapsedMs: this.elapsedMs(),
      stations,
    };
  }
}
