// Shared core for every station's procedure engine: phases, pause-aware
// timer, first-attempt checkpoint scoring, critical errors and the session
// log (PRD §8–§9). Station engines add their own workflow state and actions.
// No rendering, DOM or WebXR here, so it runs under `node --test`.

export function defaultId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'sess-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class BaseEngine {
  constructor({ scenario, now = () => Date.now(), idGen = defaultId } = {}) {
    this.scenario = scenario;
    this.now = now;
    this.idGen = idGen;
    this.listeners = new Set();
    this.maxScore = scenario.checkpoints.reduce((s, c) => s + c.points, 0);
    this.reset();
  }

  // ---------------------------------------------------------------- lifecycle

  reset() {
    this.sessionId = this.idGen();
    this.phase = 'setup';
    this.pauseReasons = new Set();
    this.checkpoints = {};
    for (const cp of this.scenario.checkpoints) {
      this.checkpoints[cp.id] = { status: 'pending', corrected: false, note: null };
    }
    this.criticals = [];
    this.log = [];
    this.inputModes = new Set();
    this.elapsedAcc = 0;
    this.runningSince = null;
    this.lastFeedback = null;
    this._initState();
    this._emit({ type: 'reset' });
  }

  /** Station-specific workflow state. */
  _initState() {}

  /** Message shown when the exercise starts. */
  _startMessage() {
    return 'Exercise started.';
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(evt) {
    for (const fn of this.listeners) fn(evt, this);
  }

  _setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this._syncTimer();
    this._emit({ type: 'phase', phase });
  }

  startBriefing() {
    if (this.phase !== 'setup') return this._result(false, 'WRONG_PHASE', 'info', 'Briefing is already open.');
    this._setPhase('briefing');
    return this._result(true, 'BRIEFING', 'info', 'Read the rules, then start the exercise.');
  }

  startExercise() {
    if (this.phase === 'setup') this._setPhase('briefing');
    if (this.phase !== 'briefing') return this._result(false, 'WRONG_PHASE', 'info', 'The exercise has already started.');
    this._setPhase('exercise');
    return this._result(true, 'STARTED', 'info', this._startMessage());
  }

  // ------------------------------------------------------------------ pausing

  pause(reason) {
    if (this.pauseReasons.has(reason)) return;
    this.pauseReasons.add(reason);
    this._syncTimer();
    this._emit({ type: 'pause', paused: true, reason });
  }

  resume(reason) {
    const had = reason ? this.pauseReasons.delete(reason) : this.pauseReasons.size > 0;
    if (!reason) this.pauseReasons.clear();
    if (!had) return;
    this._syncTimer();
    this._emit({ type: 'pause', paused: this.isPaused(), reason });
  }

  isPaused() {
    return this.pauseReasons.size > 0;
  }

  _syncTimer() {
    const shouldRun = this.phase === 'exercise' && this.pauseReasons.size === 0;
    const t = this.now();
    if (shouldRun && this.runningSince === null) {
      this.runningSince = t;
    } else if (!shouldRun && this.runningSince !== null) {
      this.elapsedAcc += t - this.runningSince;
      this.runningSince = null;
    }
  }

  elapsedMs() {
    return this.elapsedAcc + (this.runningSince !== null ? this.now() - this.runningSince : 0);
  }

  // ------------------------------------------------------------------ scoring

  score() {
    let total = 0;
    for (const cp of this.scenario.checkpoints) {
      if (this.checkpoints[cp.id].status === 'passed') total += cp.points;
    }
    return total;
  }

  isComplete() {
    return this.phase === 'complete';
  }

  results() {
    const s = this.scenario;
    const score = this.score();
    const complete = this.isComplete();
    let status = 'incomplete';
    if (complete) {
      const ok = score >= s.proficiency.minScore && this.criticals.length <= s.proficiency.maxCriticalErrors;
      status = ok ? 'proficient' : 'practice';
    }
    const statusLabel = {
      incomplete: 'Incomplete',
      proficient: 'Completed — proficiency met',
      practice: 'Completed — practice recommended',
    }[status];
    const checkpoints = s.checkpoints.map((cp) => ({
      id: cp.id,
      pkg: cp.pkg,
      label: cp.label,
      points: cp.points,
      ...this.checkpoints[cp.id],
    }));
    return {
      sessionId: this.sessionId,
      scenarioId: s.id,
      scenarioVersion: s.version,
      status,
      statusLabel,
      complete,
      passed: status === 'proficient',
      score,
      maxScore: this.maxScore,
      threshold: { ...s.proficiency },
      criticalErrors: this.criticals.map((c) => ({ ...c })),
      corrections: checkpoints.filter((c) => c.corrected).length,
      checkpoints,
      elapsedMs: this.elapsedMs(),
      inputModes: [...this.inputModes],
    };
  }

  // ------------------------------------------------------------------ helpers

  _result(ok, code, tone, message, extra = {}) {
    const r = { ok, code, tone, message, ...extra };
    this.lastFeedback = r;
    return r;
  }

  /** Common guard: exercise running and not paused. */
  _phaseGuard(ctx) {
    if (this.phase === 'complete') return this._result(false, 'COMPLETE', 'info', 'This station is complete.');
    if (this.phase !== 'exercise') return this._result(false, 'NOT_STARTED', 'info', 'Start the exercise from the briefing panel first.');
    if (this.isPaused()) return this._result(false, 'PAUSED', 'info', 'Training is paused. Select Resume to continue.');
    if (ctx?.input) this.inputModes.add(ctx.input);
    return null;
  }

  _evaluate(cpId, correct, note) {
    const cp = this.checkpoints[cpId];
    if (cp.status === 'pending') {
      cp.status = correct ? 'passed' : 'failed';
      if (!correct) cp.note = note ?? null;
      return correct ? 'correct' : 'incorrect';
    }
    if (cp.status === 'failed' && correct) cp.corrected = true;
    return null; // not the first attempt
  }

  _critical(type, subject) {
    const exists = this.criticals.some((c) => c.type === type && c.pkg === subject);
    if (!exists) {
      this.criticals.push({
        type,
        pkg: subject,
        label: this.scenario.criticalErrors[type],
        at: new Date(this.now()).toISOString(),
      });
    }
    return !exists;
  }

  /** Append a PRD §9 minimum-data log entry. subjectId: package/order/item id. */
  _logEntry(subjectId, action, { checkpointId = null, valid, first = null, critical = false, ctx }) {
    const entry = {
      sessionId: this.sessionId,
      scenarioVersion: this.scenario.version,
      packageId: subjectId ?? null,
      checkpointId,
      action,
      timestamp: new Date(this.now()).toISOString(),
      valid,
      firstAttempt: first,
      critical,
      score: this.score(),
      completion: this.isComplete() ? 'complete' : 'incomplete',
      input: ctx?.input ?? 'unknown',
    };
    this.log.push(entry);
    return entry;
  }
}
