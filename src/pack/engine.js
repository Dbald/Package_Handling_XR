// Station 1 Pack-Out procedure engine. Same rules as the dock engine:
// invalid actions never change state, only first attempts score, repeated
// identical errors never add penalties.
import { BaseEngine } from '../engine-base.js';
import { PACK_SCENARIO, packWeightRange } from './scenario.js';

const fmtKg = (v) => `${v.toFixed(2)} kg`;

export class PackEngine extends BaseEngine {
  constructor({ scenario = PACK_SCENARIO, ...opts } = {}) {
    super({ scenario, ...opts });
  }

  _initState() {
    const s = this.scenario;
    this.orderOpen = false;
    this.items = {};
    for (const k of s.itemOrder) this.items[k] = { scanned: false, loc: 'tote' };
    this.carton = null;
    this.dunnage = 0;
    this.sealed = false;
    this.weightConfirmed = false;
    this.labelPrinted = false;
    this.labelApplied = false;
    this.staged = false;
    this.released = false;
  }

  /** Switch to another order (Station 1 replay with a new configuration). */
  setScenario(scenario) {
    this.scenario = scenario;
    this.maxScore = scenario.checkpoints.reduce((a, c) => a + c.points, 0);
    this.reset();
  }

  _startMessage() {
    return 'Pick up the scanner and scan the tote label to open the order.';
  }

  // ------------------------------------------------------------------ queries

  item(key) {
    return this.scenario.items[key];
  }

  orderItems() {
    return this.scenario.itemOrder.filter((k) => this.item(k).onOrder);
  }

  measuredWeightKg() {
    const s = this.scenario;
    let w = this.carton ? s.cartons[this.carton].weightKg : 0;
    for (const k of s.itemOrder) if (this.items[k].loc === 'box') w += this.item(k).weightKg;
    w += this.dunnage * s.dunnageKg;
    return +w.toFixed(2);
  }

  weightWithinRange() {
    const { min, max } = packWeightRange(this.scenario);
    const w = this.measuredWeightKg();
    return w >= min && w <= max;
  }

  /** Coarse step name for guidance and markers. */
  step() {
    if (this.phase !== 'exercise') return this.phase;
    if (!this.orderOpen) return 'open';
    const s = this.scenario;
    const unscanned = s.itemOrder.filter((k) => !this.items[k].scanned && this.items[k].loc === 'tote');
    if (!this.sealed) {
      if (unscanned.length) return 'scan';
      if (s.itemOrder.some((k) => !this.item(k).onOrder && this.items[k].loc === 'tote')) return 'exception';
      if (!this.carton) return 'carton';
      if (this.orderItems().some((k) => this.items[k].loc !== 'box')) return 'pack';
      if (s.itemOrder.some((k) => this.item(k).fragile && this.items[k].loc === 'box') && this.dunnage === 0) return 'dunnage';
      return 'seal';
    }
    if (!this.weightConfirmed) return 'weigh';
    if (!this.labelPrinted) return 'print';
    if (!this.labelApplied) return 'label';
    if (!this.staged) return 'outbound';
    return 'release';
  }

  // ------------------------------------------------------------------ helpers

  _finish(subject, action, result, logOpts) {
    if (logOpts) this._logEntry(subject, action, logOpts);
    this._emit({ type: 'action', action, pkg: subject, result });
    return result;
  }

  _orderGuard(subject, action, ctx) {
    if (this.orderOpen) return null;
    const first = this._evaluate('PK_ORDER_FIRST', false, 'Items were handled before the order was opened.');
    const r = this._result(false, 'ORDER_NOT_OPEN', 'warning',
      'Open the order first: scan the tote label so the monitor shows what this customer ordered.',
      { returnHome: true });
    return this._finish(subject, action, r, { checkpointId: 'PK_ORDER_FIRST', valid: false, first, ctx });
  }

  _blocked(subject, action, code, tone, message, extra = {}) {
    return this._finish(subject, action, this._result(false, code, tone, message, { returnHome: true, ...extra }));
  }

  _premature(action, ctx) {
    this._evaluate('PK_LABEL', false, 'Release was attempted before the carton was labelled.');
    this._evaluate('PK_RELEASE', false, 'A premature outbound release was attempted.');
    const isNew = this._critical('UNLABELED_RELEASE', this.scenario.order.id);
    const missing = [];
    if (!this.sealed) missing.push('sealing');
    if (!this.weightConfirmed) missing.push('weight confirmation');
    if (!this.labelApplied) missing.push('shipping label');
    const r = this._result(false, 'PREMATURE_RELEASE', 'critical',
      `Blocked. The carton cannot ship yet. Missing: ${missing.join(', ')}. ` +
      'An unlabelled or unverified carton gets lost or mis-billed.',
      { critical: true, newCritical: isNew, returnHome: true });
    return this._finish(this.scenario.order.id, action, r, { checkpointId: 'PK_RELEASE', valid: false, critical: true, ctx });
  }

  // ------------------------------------------------------------------ actions

  scanTote(ctx) {
    const g = this._phaseGuard(ctx);
    const oid = this.scenario.order.id;
    if (g) return this._finish(oid, 'scan:tote', g);
    if (this.orderOpen) return this._finish(oid, 'scan:tote', this._result(true, 'ALREADY', 'info', `Order ${oid} is already open.`));
    this.orderOpen = true;
    const first = this._evaluate('PK_ORDER_FIRST', true);
    const list = this.orderItems().map((k) => `${this.item(k).name}${this.item(k).fragile ? ' (fragile)' : ''}`).join(', ');
    const r = this._result(true, 'ORDER_OPEN', 'success',
      `Order ${oid} is open: ${list}. Compare the tote with the monitor and scan each item.`);
    return this._finish(oid, 'scan:tote', r, { checkpointId: 'PK_ORDER_FIRST', valid: true, first, ctx });
  }

  scanItem(key, { aligned = true } = {}, ctx) {
    const def = this.item(key);
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(def?.sku, 'scan:item', g);
    if (!aligned) {
      return this._finish(def.sku, 'scan:item', this._result(false, 'NO_READ', 'warning',
        'No read. Aim the scanner beam at the barcode and pull the trigger.'));
    }
    const og = this._orderGuard(def.sku, 'scan:item', ctx);
    if (og) return og;
    const it = this.items[key];
    if (it.scanned) {
      return this._finish(def.sku, 'scan:item', this._result(true, 'ALREADY', 'info',
        `${def.name} already scanned (${def.onOrder ? 'on order' : 'NOT ON ORDER'}). Repeat scans do not change the score.`));
    }
    it.scanned = true;
    const r = def.onOrder
      ? this._result(true, 'ITEM_OK', 'success', `${def.name} (${def.sku}) is on the order.${def.fragile ? ' It is FRAGILE.' : ''}`)
      : this._result(true, 'NOT_ON_ORDER', 'info',
        `${def.name} (${def.sku}) is NOT ON THIS ORDER. Put it in the EXCEPTION bin; never pack it.`);
    return this._finish(def.sku, 'scan:item', r, { valid: true, ctx });
  }

  selectCarton(size, ctx) {
    const s = this.scenario;
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(`CARTON-${size}`, 'carton', g);
    const og = this._orderGuard(`CARTON-${size}`, 'carton', ctx);
    if (og) return og;
    if (this.carton) {
      return this._blocked(`CARTON-${size}`, 'carton', 'ALREADY', 'info', `A size ${this.carton} carton is already on the pack scale.`);
    }
    const correct = size === s.correctCarton;
    const first = this._evaluate('PK_CARTON', correct, s.cartons[size]?.why ?? 'Wrong carton size.');
    let r;
    if (correct) {
      this.carton = size;
      r = this._result(true, 'CARTON_OK', 'success', `Size ${size} carton built (${s.cartons[size].inner}). Pack the order items.`);
    } else {
      r = this._result(false, 'CARTON_WRONG', 'error', `${s.cartons[size].why} The carton goes back in its slot.`, { returnHome: true });
    }
    return this._finish(`CARTON-${size}`, 'carton', r, { checkpointId: 'PK_CARTON', valid: correct, first, ctx });
  }

  packItem(key, ctx) {
    const def = this.item(key);
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(def.sku, 'pack', { ...g, returnHome: true });
    const og = this._orderGuard(def.sku, 'pack', ctx);
    if (og) return og;
    const it = this.items[key];
    if (it.loc === 'box') return this._finish(def.sku, 'pack', this._result(true, 'ALREADY', 'info', `${def.name} is already in the carton.`));
    if (this.sealed) return this._blocked(def.sku, 'pack', 'SEALED', 'info', 'The carton is already sealed.');
    if (!this.carton) {
      return this._blocked(def.sku, 'pack', 'NO_CARTON', 'warning',
        'Build a carton first: take one from the carton slots and set it on the pack scale.');
    }
    if (!def.onOrder) {
      const first = this._evaluate('PK_EXCEPTION', false, 'The item not on the order was put in the carton.');
      const isNew = this._critical('WRONG_ITEM_PACKED', def.sku);
      const r = this._result(false, 'WRONG_ITEM', 'critical',
        `Blocked. ${def.name} is NOT on order ${this.scenario.order.id}. Packing it ships the wrong product and costs a return. ` +
        'Put it in the EXCEPTION bin.', { critical: true, newCritical: isNew, returnHome: true });
      return this._finish(def.sku, 'pack', r, { checkpointId: 'PK_EXCEPTION', valid: false, first, critical: true, ctx });
    }
    if (!it.scanned) {
      const first = this._evaluate('PK_SCAN_ITEMS', false, 'An item was packed before it was scanned.');
      const r = this._result(false, 'SCAN_FIRST', 'error',
        `Scan ${def.name} first. The scan proves it is the right product for this order.`, { returnHome: true });
      return this._finish(def.sku, 'pack', r, { checkpointId: 'PK_SCAN_ITEMS', valid: false, first, ctx });
    }
    it.loc = 'box';
    const r = this._result(true, 'PACKED', 'success',
      `${def.name} packed.${def.fragile ? ' It is fragile: add void fill around it before sealing.' : ''}`);
    return this._finish(def.sku, 'pack', r, { valid: true, ctx });
  }

  divertItem(key, ctx) {
    const def = this.item(key);
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(def.sku, 'exception', { ...g, returnHome: true });
    const og = this._orderGuard(def.sku, 'exception', ctx);
    if (og) return og;
    const it = this.items[key];
    if (it.loc === 'exception') return this._finish(def.sku, 'exception', this._result(true, 'ALREADY', 'info', `${def.name} is already in the exception bin.`));
    if (def.onOrder) {
      const first = this._evaluate('PK_EXCEPTION', false, 'An order item was sent to the exception bin.');
      const r = this._result(false, 'ON_ORDER', 'error',
        `${def.name} IS on the order. It belongs in the carton, not the exception bin.`, { returnHome: true });
      return this._finish(def.sku, 'exception', r, { checkpointId: 'PK_EXCEPTION', valid: false, first, ctx });
    }
    it.loc = 'exception';
    const first = this._evaluate('PK_EXCEPTION', true);
    const r = this._result(true, 'DIVERTED', 'success',
      `${def.name} is in the EXCEPTION bin for a lead to resolve. It will not ship with this order.`);
    return this._finish(def.sku, 'exception', r, { checkpointId: 'PK_EXCEPTION', valid: true, first, ctx });
  }

  /** Item put back in the tote: purely spatial, never scored. */
  returnToTote(key) {
    const it = this.items[key];
    if (it && it.loc !== 'box' && it.loc !== 'exception') it.loc = 'tote';
  }

  addDunnage(ctx) {
    const s = this.scenario;
    const g = this._phaseGuard(ctx);
    if (g) return this._finish('DUNNAGE', 'dunnage', { ...g, returnHome: true });
    if (!this.carton) return this._blocked('DUNNAGE', 'dunnage', 'NO_CARTON', 'warning', 'Build a carton first, then add void fill inside it.');
    if (this.sealed) return this._blocked('DUNNAGE', 'dunnage', 'SEALED', 'info', 'The carton is already sealed.');
    if (this.dunnage >= s.maxDunnage) return this._blocked('DUNNAGE', 'dunnage', 'FULL', 'info', 'The carton is full of void fill.');
    this.dunnage += 1;
    const r = this._result(true, 'DUNNAGE', 'success', `Void fill added (${this.dunnage}).`);
    return this._finish('DUNNAGE', 'dunnage', r, { valid: true, ctx });
  }

  /**
   * Why sealing would be refused right now, without recording anything:
   * 'MISSING_ITEMS' | 'TOTE_NOT_CLEAR' | 'NEEDS_DUNNAGE' | null. Lets the tape
   * gun refuse up front instead of letting the learner run tape for nothing.
   */
  sealBlocker() {
    const s = this.scenario;
    if (this.orderItems().some((k) => this.items[k].loc !== 'box')) return 'MISSING_ITEMS';
    if (s.itemOrder.some((k) => !this.item(k).onOrder && this.items[k].loc !== 'exception')) return 'TOTE_NOT_CLEAR';
    const fragile = s.itemOrder.some((k) => this.item(k).fragile && this.items[k].loc === 'box');
    if (fragile && this.dunnage === 0) return 'NEEDS_DUNNAGE';
    return null;
  }

  seal(ctx) {
    const s = this.scenario;
    const oid = s.order.id;
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(oid, 'seal', g);
    if (!this.carton) return this._finish(oid, 'seal', this._result(false, 'NO_CARTON', 'warning', 'There is no carton to seal yet.'));
    if (this.sealed) return this._finish(oid, 'seal', this._result(true, 'ALREADY', 'info', 'The carton is already sealed.'));
    const missing = this.orderItems().filter((k) => this.items[k].loc !== 'box');
    if (missing.length) {
      const first = this._evaluate('PK_SEAL', false, 'Sealing was attempted before every order item was packed.');
      const r = this._result(false, 'MISSING_ITEMS', 'error',
        `Not yet: ${missing.map((k) => this.item(k).name).join(' and ')} still ${missing.length > 1 ? 'need' : 'needs'} packing. A short shipment means a refund and a re-ship.`);
      return this._finish(oid, 'seal', r, { checkpointId: 'PK_SEAL', valid: false, first, ctx });
    }
    const stray = s.itemOrder.filter((k) => !this.item(k).onOrder && this.items[k].loc !== 'exception');
    if (stray.length) {
      const first = this._evaluate('PK_EXCEPTION', false, 'The item not on the order was left in the tote when the order was closed.');
      const r = this._result(false, 'TOTE_NOT_CLEAR', 'error',
        `Clear the tote first: ${stray.map((k) => this.item(k).name).join(', ')} is not on this order. Put it in the EXCEPTION bin before closing the order.`);
      return this._finish(oid, 'seal', r, { checkpointId: 'PK_EXCEPTION', valid: false, first, ctx });
    }
    const fragile = s.itemOrder.some((k) => this.item(k).fragile && this.items[k].loc === 'box');
    if (fragile && this.dunnage === 0) {
      const first = this._evaluate('PK_DUNNAGE', false, 'The fragile item was about to be sealed without void fill.');
      const names = s.itemOrder.filter((k) => this.item(k).fragile && this.items[k].loc === 'box').map((k) => this.item(k).name.toLowerCase());
      const r = this._result(false, 'NEEDS_DUNNAGE', 'error',
        `Add void fill first: the ${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} fragile and will break if it can move in the carton. Take air pillows from the basket.`);
      return this._finish(oid, 'seal', r, { checkpointId: 'PK_DUNNAGE', valid: false, first, ctx });
    }
    this.sealed = true;
    const first = this._evaluate('PK_SEAL', true);
    this._evaluate('PK_DUNNAGE', true);
    this._evaluate('PK_SCAN_ITEMS', true);
    const { min, max } = packWeightRange(s);
    const r = this._result(true, 'SEALED', 'success',
      `Carton sealed. The scale reads ${fmtKg(this.measuredWeightKg())}; expected ${fmtKg(min)} – ${fmtKg(max)}. Is it within range?`);
    return this._finish(oid, 'seal', r, { checkpointId: 'PK_SEAL', valid: true, first, ctx });
  }

  confirmWeight(answer, ctx) {
    const s = this.scenario;
    const oid = s.order.id;
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(oid, 'weight', g);
    if (!this.sealed) return this._finish(oid, 'weight', this._result(false, 'PREREQ', 'warning', 'Seal the carton first, then confirm its weight.'));
    if (this.weightConfirmed) return this._finish(oid, 'weight', this._result(false, 'ALREADY', 'info', 'The weight is already confirmed.'));
    const within = this.weightWithinRange();
    const correct = (answer === 'within') === within;
    const { min, max } = packWeightRange(s);
    const note = `${fmtKg(this.measuredWeightKg())} is ${within ? 'inside' : 'outside'} ${fmtKg(min)} – ${fmtKg(max)}.`;
    const first = this._evaluate('PK_WEIGHT', correct, note);
    let r;
    if (correct) {
      this.weightConfirmed = true;
      r = this._result(true, 'WEIGHT_OK', 'success', `Weight confirmed: ${note} Print the shipping label.`);
    } else {
      r = this._result(false, 'WEIGHT_WRONG', 'error', `Check the scale display again: ${note}`);
    }
    return this._finish(oid, 'weight', r, { checkpointId: 'PK_WEIGHT', valid: correct, first, ctx });
  }

  printLabel(ctx) {
    const oid = this.scenario.order.id;
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(oid, 'print', g);
    if (this.labelPrinted) return this._finish(oid, 'print', this._result(true, 'ALREADY', 'info', 'The label is already printed.'));
    if (!this.weightConfirmed) {
      const first = this._evaluate('PK_LABEL_ORDER', false, 'The label was printed before the weight was confirmed.');
      const r = this._result(false, 'PRINT_EARLY', 'error',
        `Not yet: ${this.sealed ? 'confirm the weight' : 'seal the carton and confirm its weight'} first. The label carries the verified weight; a wrong weight causes a carrier chargeback.`);
      return this._finish(oid, 'print', r, { checkpointId: 'PK_LABEL_ORDER', valid: false, first, ctx });
    }
    this.labelPrinted = true;
    const first = this._evaluate('PK_LABEL_ORDER', true);
    const r = this._result(true, 'PRINTED', 'success', 'Label printed. Take it from the printer and apply it to the top of the carton.');
    return this._finish(oid, 'print', r, { checkpointId: 'PK_LABEL_ORDER', valid: true, first, ctx });
  }

  applyLabel(ctx) {
    const oid = this.scenario.order.id;
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(oid, 'label', { ...g, returnHome: true });
    if (!this.labelPrinted) return this._blocked(oid, 'label', 'PREREQ', 'warning', 'Print the label first.');
    if (this.labelApplied) return this._finish(oid, 'label', this._result(true, 'ALREADY', 'info', 'The label is already on the carton.'));
    this.labelApplied = true;
    const first = this._evaluate('PK_LABEL', true);
    const r = this._result(true, 'LABELLED', 'success', 'Label applied. Place the carton on the OUTBOUND conveyor, then confirm release.');
    return this._finish(oid, 'label', r, { checkpointId: 'PK_LABEL', valid: true, first, ctx });
  }

  /** Carton placed on the outbound conveyor. */
  stage(ctx) {
    const oid = this.scenario.order.id;
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(oid, 'stage', { ...g, returnHome: true });
    if (!this.carton) return this._blocked(oid, 'stage', 'NO_CARTON', 'info', 'There is no carton to ship yet.');
    if (!this.labelApplied || !this.sealed || !this.weightConfirmed) return this._premature('stage', ctx);
    if (this.staged) return this._finish(oid, 'stage', this._result(true, 'ALREADY', 'info', 'The carton is already on the conveyor.'));
    this.staged = true;
    return this._finish(oid, 'stage', this._result(true, 'STAGED', 'info', 'Carton is on the outbound conveyor. Select Confirm Release to send it.'), { valid: true, ctx });
  }

  /** Carton taken back off the conveyor: purely spatial. */
  unstage() {
    if (!this.released) this.staged = false;
  }

  release(ctx) {
    const oid = this.scenario.order.id;
    const g = this._phaseGuard(ctx);
    if (g) return this._finish(oid, 'release', g);
    if (this.released) return this._finish(oid, 'release', this._result(false, 'ALREADY', 'info', 'The carton was already released.'));
    if (!this.carton) return this._finish(oid, 'release', this._result(false, 'NO_CARTON', 'info', 'There is no carton to release yet.'));
    if (!this.labelApplied || !this.sealed || !this.weightConfirmed) return this._premature('release', ctx);
    if (!this.staged) {
      return this._finish(oid, 'release', this._result(false, 'PREREQ', 'warning', 'Place the carton on the OUTBOUND conveyor before confirming release.'));
    }
    this.released = true;
    this._evaluate('PK_LABEL', true);
    const first = this._evaluate('PK_RELEASE', true);
    this._setPhase('complete');
    const r = this._result(true, 'RELEASED', 'success', `Order ${oid} released to the dock. Station 1 complete.`);
    return this._finish(oid, 'release', r, { checkpointId: 'PK_RELEASE', valid: true, first, ctx });
  }
}
