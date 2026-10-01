// Procedure engine: the single validated action interface for VR input,
// assisted input and the desktop preview. It has no knowledge of rendering,
// the DOM or WebXR (PRD §9), so it runs unchanged under `node --test`.
//
// Package workflow states:
//   common : waiting → inspecting → condition_submitted → (decision)
//   damaged: rejected → quarantined
//   intact : accepted → scanned → weighed → weight_confirmed → staged → outbound
// `staged` = placed on the outbound conveyor, awaiting explicit release
// confirmation (PRD §5 step 7; targets never auto-route a package).
//
// Invalid actions never change workflow state ("rejected actions preserve the
// last valid state"). Checkpoints score only the first evaluated attempt, and
// repeated identical errors never add penalties.

import { SCENARIO, weightRange, weightWithinRange } from './scenario.js';
import { BaseEngine } from './engine-base.js';

export const PHASES = ['setup', 'briefing', 'exercise', 'complete'];

const STATE_ORDER = {
  A: ['waiting', 'inspecting', 'condition_submitted', 'rejected', 'quarantined'],
  B: ['waiting', 'inspecting', 'condition_submitted', 'accepted', 'scanned', 'weighed', 'weight_confirmed', 'staged', 'outbound'],
};

const FINAL_STATE = { damaged: 'quarantined', intact: 'outbound' };

const fmtKg = (v) => `${v.toFixed(2)} kg`;

export class ProcedureEngine extends BaseEngine {
  constructor({ scenario = SCENARIO, ...opts } = {}) {
    super({ scenario, ...opts });
  }

  _initState() {
    this.packages = {};
    for (const key of this.scenario.order) {
      this.packages[key] = { key, state: 'waiting' };
    }
  }

  _startMessage() {
    return `Pick up ${this._pkg('A').label} and inspect every side.`;
  }

  // ------------------------------------------------------------------ queries

  _pkg(key) {
    return this.scenario.packages[key];
  }

  packageState(key) {
    return this.packages[key]?.state;
  }

  isFinished(key) {
    const def = this._pkg(key);
    return this.packages[key].state === FINAL_STATE[def.condition];
  }

  activePackage() {
    if (this.phase !== 'exercise') return null;
    return this.scenario.order.find((k) => !this.isFinished(k)) ?? null;
  }

  stateAtLeast(key, state) {
    const order = STATE_ORDER[key] ?? STATE_ORDER[this._pkg(key).condition === 'damaged' ? 'A' : 'B'];
    return order.indexOf(this.packages[key].state) >= order.indexOf(state);
  }

  // ------------------------------------------------------------------ helpers

  _guard(key, ctx) {
    if (!this.packages[key]) return this._result(false, 'UNKNOWN_PACKAGE', 'warning', 'Unknown package.');
    if (this.phase === 'complete') return this._result(false, 'COMPLETE', 'info', 'The exercise is complete. Select Replay to try again.');
    if (this.phase !== 'exercise') return this._result(false, 'NOT_STARTED', 'info', 'Start the exercise from the briefing panel first.');
    if (this.isPaused()) return this._result(false, 'PAUSED', 'info', 'Training is paused. Select Resume to continue.');
    const active = this.activePackage();
    if (key !== active) {
      if (this.isFinished(key)) {
        const where = this._pkg(key).condition === 'damaged' ? 'in quarantine' : 'released outbound';
        return this._result(false, 'PACKAGE_DONE', 'info', `${this._pkg(key).label} is already ${where}.`);
      }
      return this._result(false, 'NOT_ACTIVE', 'info', `Finish ${this._pkg(active).label} first — packages are processed one at a time.`);
    }
    if (ctx?.input) this.inputModes.add(ctx.input);
    return null;
  }

  _record(key, action, opts) {
    return this._logEntry(key ? this._pkg(key).id : null, action, opts);
  }

  _finish(key, action, result, logOpts) {
    if (logOpts) this._record(key, action, logOpts);
    this._emit({ type: 'action', action, pkg: key, result });
    return result;
  }

  _checkCompletion() {
    if (this.scenario.order.every((k) => this.isFinished(k))) {
      this._setPhase('complete');
    }
  }

  _missingForRelease(key) {
    const st = this.packages[key].state;
    const need = [];
    if (['waiting', 'inspecting'].includes(st)) need.push('inspection');
    if (['waiting', 'inspecting', 'condition_submitted'].includes(st)) need.push('acceptance');
    if (!this.stateAtLeast(key, 'scanned')) need.push('scan');
    if (!this.stateAtLeast(key, 'weighed')) need.push('weighing');
    if (!this.stateAtLeast(key, 'weight_confirmed')) need.push('weight confirmation');
    return need;
  }

  _premature(key, action, ctx) {
    this._evaluate('B_OUTBOUND', false, 'Outbound was attempted before all prerequisites were met.');
    this._evaluate('B_NO_PREMATURE', false, 'A premature outbound release was attempted.');
    const isNew = this._critical('PREMATURE_RELEASE', key);
    const missing = this._missingForRelease(key).join(', ');
    const r = this._result(false, 'PREMATURE_RELEASE', 'critical',
      `Blocked. ${this._pkg(key).label} cannot go outbound yet. Missing: ${missing}. ` +
      'Releasing an unverified package risks shipping the wrong item or weight.',
      { critical: true, newCritical: isNew, returnToBench: true });
    return this._finish(key, action, r, { checkpointId: 'B_OUTBOUND', valid: false, first: null, critical: true, ctx });
  }

  // ------------------------------------------------------------------ actions

  /** Selecting or grabbing a package begins inspection. Never scored. */
  inspect(key, ctx) {
    const g = this._guard(key, ctx);
    if (g) return this._finish(key, 'inspect', g);
    const p = this.packages[key];
    if (p.state !== 'waiting') {
      return this._finish(key, 'inspect', this._result(true, 'INSPECTING', 'neutral', null, { silent: true }));
    }
    p.state = 'inspecting';
    const r = this._result(true, 'INSPECTING', 'info',
      `Inspecting ${this._pkg(key).label}. Turn it to check every side, then record its condition.`);
    return this._finish(key, 'inspect', r, { valid: true, ctx });
  }

  submitCondition(key, condition, ctx) {
    const g = this._guard(key, ctx);
    if (g) return this._finish(key, 'condition', g);
    const def = this._pkg(key);
    const p = this.packages[key];
    const cpId = `${key}_CONDITION`;
    if (p.state === 'waiting') {
      return this._finish(key, 'condition', this._result(false, 'PREREQ', 'warning',
        `Pick up or select ${def.label} to inspect it before recording its condition.`));
    }
    if (p.state !== 'inspecting') {
      return this._finish(key, 'condition', this._result(false, 'ALREADY', 'info',
        `${def.label}'s condition is already recorded as ${def.condition}.`));
    }
    const correct = condition === def.condition;
    const note = def.condition === 'damaged'
      ? `${def.label} has a crushed, torn corner — visible damage.`
      : `${def.label} has no crushes, tears or punctures — it is intact.`;
    const first = this._evaluate(cpId, correct, note);
    let r;
    if (correct) {
      p.state = 'condition_submitted';
      r = this._result(true, 'CONDITION_OK', 'success',
        def.condition === 'damaged'
          ? `Correct — ${def.label} is damaged (${def.evidence.toLowerCase()}). Now record your decision.`
          : `Correct — ${def.label} is intact. Now record your decision.`);
    } else {
      r = this._result(false, 'CONDITION_WRONG', 'error',
        `Not quite. Look again: ${note} Record the condition again.`);
    }
    return this._finish(key, 'condition', r, { checkpointId: cpId, valid: correct, first, ctx });
  }

  decide(key, decision, ctx) {
    const g = this._guard(key, ctx);
    if (g) return this._finish(key, 'decide', g);
    const def = this._pkg(key);
    const p = this.packages[key];
    if (['waiting', 'inspecting'].includes(p.state)) {
      return this._finish(key, 'decide', this._result(false, 'PREREQ', 'warning',
        `Inspect ${def.label} and record its condition before deciding.`));
    }
    if (p.state !== 'condition_submitted') {
      return this._finish(key, 'decide', this._result(false, 'ALREADY', 'info',
        `${def.label} is already ${def.condition === 'damaged' ? 'rejected' : 'accepted'}.`));
    }
    const expected = def.condition === 'damaged' ? 'reject' : 'accept';
    const correct = decision === expected;
    const cpId = def.condition === 'damaged' ? `${key}_REJECT` : `${key}_ACCEPT`;
    const note = def.condition === 'damaged'
      ? 'Damaged packages must be rejected.'
      : 'Intact packages are accepted for processing.';
    const first = this._evaluate(cpId, correct, note);
    let critical = false;
    let r;
    if (correct) {
      p.state = decision === 'reject' ? 'rejected' : 'accepted';
      r = this._result(true, 'DECISION_OK', 'success', decision === 'reject'
        ? `${def.label} rejected. Place it in the QUARANTINE bin.`
        : `${def.label} accepted. Scan its barcode at the scanner.`);
    } else if (def.condition === 'damaged') {
      critical = true;
      const isNew = this._critical('ACCEPTED_DAMAGED', key);
      r = this._result(false, 'ACCEPTED_DAMAGED', 'critical',
        `Blocked. ${def.label} is visibly damaged and must never be accepted. ` +
        'Accepted damage can reach a customer or hide a carrier claim. Choose Reject.',
        { critical: true, newCritical: isNew });
    } else {
      r = this._result(false, 'REJECTED_INTACT', 'error',
        `${def.label} is intact. Rejecting it sends good stock to quarantine and delays the shipment. Choose Accept.`);
    }
    return this._finish(key, 'decide', r, { checkpointId: cpId, valid: correct, first, critical, ctx });
  }

  /** Place a package at a zone: 'bench' | 'quarantine' | 'scale' | 'outbound'. */
  place(key, zone, ctx) {
    const g = this._guard(key, ctx);
    if (g) return this._finish(key, `place:${zone}`, { ...g, returnToBench: zone !== 'bench' });
    const def = this._pkg(key);
    const p = this.packages[key];
    const action = `place:${zone}`;
    const blocked = (code, tone, message, extra) =>
      this._finish(key, action, this._result(false, code, tone, message, { returnToBench: true, ...extra }));

    if (zone === 'bench') {
      // Taking a staged package back off the conveyor un-stages it, so a later
      // release confirmation always matches where the package physically is.
      if (p.state === 'staged') p.state = 'weight_confirmed';
      return this._finish(key, action, this._result(true, 'BENCH', 'neutral', null, { silent: true }));
    }

    if (def.condition === 'damaged') {
      if (zone === 'outbound') {
        const first = this._evaluate(`${key}_QUARANTINE`, false, 'Damaged packages go to quarantine, never outbound.');
        const isNew = this._critical('DAMAGED_OUTBOUND', key);
        const r = this._result(false, 'DAMAGED_OUTBOUND', 'critical',
          `Blocked. ${def.label} is damaged and must never be sent outbound. ` +
          'It has been returned to the bench. Place it in QUARANTINE.',
          { critical: true, newCritical: isNew, returnToBench: true });
        return this._finish(key, action, r, { checkpointId: `${key}_QUARANTINE`, valid: false, first, critical: true, ctx });
      }
      if (zone === 'quarantine') {
        if (p.state === 'quarantined') return blocked('ALREADY', 'info', `${def.label} is already in quarantine.`, { returnToBench: false });
        if (p.state !== 'rejected') {
          return blocked('PREREQ', 'warning', `Record ${def.label}'s condition and decision before placing it in quarantine.`);
        }
        const first = this._evaluate(`${key}_QUARANTINE`, true);
        p.state = 'quarantined';
        this._checkCompletion();
        const r = this._result(true, 'QUARANTINED', 'success',
          `${def.label} is in QUARANTINE and stays there for review. Next: ${this._nextLabel(key)}.`);
        return this._finish(key, action, r, { checkpointId: `${key}_QUARANTINE`, valid: true, first, ctx });
      }
      if (zone === 'scale') {
        return blocked('NOT_APPLICABLE', 'info', `The scale is only used for accepted packages. ${def.label} is not weighed.`);
      }
    } else {
      if (zone === 'outbound') {
        if (p.state === 'weight_confirmed') {
          p.state = 'staged';
          const r = this._result(true, 'STAGED', 'info',
            `${def.label} is on the outbound conveyor. Select Confirm Release to send it.`);
          return this._finish(key, action, r, { valid: true, ctx });
        }
        if (p.state === 'staged' || p.state === 'outbound') {
          return blocked('ALREADY', 'info', `${def.label} is already on the outbound conveyor.`, { returnToBench: false });
        }
        return this._premature(key, action, ctx);
      }
      if (zone === 'quarantine') {
        if (!this.stateAtLeast(key, 'accepted')) {
          return blocked('PREREQ', 'warning', `Record ${def.label}'s condition and decision first.`);
        }
        let first = null;
        if (this.stateAtLeast(key, 'weight_confirmed')) {
          first = this._evaluate('B_OUTBOUND', false, 'Accepted, verified packages are routed outbound, not quarantined.');
        }
        const r = this._result(false, 'WRONG_DESTINATION', 'error',
          `${def.label} is accepted and intact. Quarantine is only for rejected packages. It has been returned to the bench.`,
          { returnToBench: true });
        return this._finish(key, action, r, { checkpointId: first ? 'B_OUTBOUND' : null, valid: false, first, ctx });
      }
      if (zone === 'scale') {
        if (!this.stateAtLeast(key, 'accepted')) {
          return blocked('PREREQ', 'warning', `Accept ${def.label} before weighing it.`);
        }
        if (p.state === 'accepted') {
          const f1 = this._evaluate('B_SCAN_FIRST', false, 'The package was placed on the scale before a successful scan.');
          this._evaluate('B_WEIGH_AFTER_SCAN', false, 'Weighing was attempted before the scan succeeded.');
          const r = this._result(false, 'SCAN_FIRST', 'error',
            `Scan first. The scan links ${def.label} to its record — weigh only after a successful scan. It has been returned to the bench.`,
            { returnToBench: true });
          return this._finish(key, action, r, { checkpointId: 'B_SCAN_FIRST', valid: false, first: f1, ctx });
        }
        if (p.state === 'scanned') {
          const first = this._evaluate('B_WEIGH_AFTER_SCAN', true);
          p.state = 'weighed';
          const { min, max } = weightRange(def);
          const r = this._result(true, 'WEIGHED', 'success',
            `Scale reads ${fmtKg(def.measuredWeightKg)}. Expected ${fmtKg(min)} – ${fmtKg(max)}. Is the reading within range?`);
          return this._finish(key, action, r, { checkpointId: 'B_WEIGH_AFTER_SCAN', valid: true, first, ctx });
        }
        return this._finish(key, action, this._result(true, 'ALREADY', 'info',
          `${def.label} was already weighed: ${fmtKg(def.measuredWeightKg)}.`, { returnToBench: false }));
      }
    }
    return blocked('UNKNOWN_ZONE', 'warning', 'That is not a placement target.');
  }

  /** Scan requires the barcode to be inside the scanner target (`aligned`). */
  scan(key, { aligned = true } = {}, ctx) {
    const g = this._guard(key, ctx);
    if (g) return this._finish(key, 'scan', g);
    const def = this._pkg(key);
    const p = this.packages[key];
    if (!aligned) {
      return this._finish(key, 'scan', this._result(false, 'NO_READ', 'warning',
        'No read. Hold the barcode inside the glowing scan zone, facing the scanner, then press the trigger.'));
    }
    if (def.condition === 'damaged') {
      return this._finish(key, 'scan', this._result(false, 'NOT_APPLICABLE', 'info',
        `${def.label} is not processed for shipping, so it is not scanned. ${p.state === 'rejected' ? 'Place it in QUARANTINE.' : 'Inspect it and decide first.'}`));
    }
    if (!this.stateAtLeast(key, 'accepted')) {
      return this._finish(key, 'scan', this._result(false, 'PREREQ', 'warning',
        `Inspect and accept ${def.label} before scanning it.`));
    }
    if (p.state !== 'accepted') {
      return this._finish(key, 'scan', this._result(true, 'ALREADY', 'info',
        `Already scanned: ${def.id}. Repeat scans do not change the score.`, { scannedId: def.id }));
    }
    const first = this._evaluate('B_SCAN_FIRST', true);
    p.state = 'scanned';
    const r = this._result(true, 'SCANNED', 'success',
      `Scan OK — ${def.id} (${def.barcode}). Now place ${def.label} on the scale.`, { scannedId: def.id });
    return this._finish(key, 'scan', r, { checkpointId: 'B_SCAN_FIRST', valid: true, first, ctx });
  }

  confirmWeight(key, answer, ctx) {
    const g = this._guard(key, ctx);
    if (g) return this._finish(key, 'weight', g);
    const def = this._pkg(key);
    const p = this.packages[key];
    if (def.condition === 'damaged') {
      return this._finish(key, 'weight', this._result(false, 'NOT_APPLICABLE', 'info', `${def.label} is not weighed.`));
    }
    if (!this.stateAtLeast(key, 'weighed')) {
      return this._finish(key, 'weight', this._result(false, 'PREREQ', 'warning',
        `Place ${def.label} on the scale to get a reading first.`));
    }
    if (p.state !== 'weighed') {
      return this._finish(key, 'weight', this._result(false, 'ALREADY', 'info', 'The weight is already confirmed.'));
    }
    const within = weightWithinRange(def);
    const correct = (answer === 'within') === within;
    const { min, max } = weightRange(def);
    const note = `${fmtKg(def.measuredWeightKg)} is ${within ? 'inside' : 'outside'} ${fmtKg(min)} – ${fmtKg(max)}.`;
    const first = this._evaluate('B_WEIGHT_CONFIRM', correct, note);
    let r;
    if (correct) {
      p.state = 'weight_confirmed';
      r = this._result(true, 'WEIGHT_OK', 'success',
        `Weight confirmed: ${note} Place ${def.label} on the OUTBOUND conveyor, then confirm release.`);
    } else {
      r = this._result(false, 'WEIGHT_WRONG', 'error', `Check the scale display again: ${note}`);
    }
    return this._finish(key, 'weight', r, { checkpointId: 'B_WEIGHT_CONFIRM', valid: correct, first, ctx });
  }

  /** Explicit outbound release confirmation. */
  release(key, ctx) {
    const g = this._guard(key, ctx);
    if (g) return this._finish(key, 'release', g);
    const def = this._pkg(key);
    const p = this.packages[key];
    if (def.condition === 'damaged') return this.place(key, 'outbound', ctx);
    if (p.state === 'outbound') {
      return this._finish(key, 'release', this._result(false, 'ALREADY', 'info', `${def.label} was already released.`));
    }
    if (p.state === 'weight_confirmed') {
      return this._finish(key, 'release', this._result(false, 'PREREQ', 'warning',
        `Place ${def.label} on the OUTBOUND conveyor before confirming release.`));
    }
    if (p.state !== 'staged') return this._premature(key, 'release', ctx);
    const first = this._evaluate('B_OUTBOUND', true);
    this._evaluate('B_NO_PREMATURE', true);
    p.state = 'outbound';
    this._checkCompletion();
    const r = this._result(true, 'RELEASED', 'success',
      `${def.label} released outbound.${this.isComplete() ? ' Exercise complete — review your results.' : ''}`);
    return this._finish(key, 'release', r, { checkpointId: 'B_OUTBOUND', valid: true, first, ctx });
  }

  _nextLabel(key) {
    const idx = this.scenario.order.indexOf(key);
    const next = this.scenario.order[idx + 1];
    return next && !this.isComplete() ? `inspect ${this._pkg(next).label}` : 'review your results';
  }
}
