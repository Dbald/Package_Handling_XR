// Station 1 interaction controller: grabbing, drop targets, handheld scanner,
// tape gun, label printer, displays and local prompts. Every procedural
// change goes through PackEngine; visuals follow validated results only.
// A shift is several totes (packRun(v)); replays move to the next run.
import * as THREE from 'three';
import { buildPackStation, PACK_LAYOUT as L } from './scene.js';
import { PACK_CATALOG, packRun, packWeightRange } from './scenario.js';

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
export const PACK_BASE = new THREE.Vector3(-3.2, 0, 0);

const ALL_ITEM_KEYS = Object.keys(PACK_CATALOG).map((k) => `pk:${k}`);
const TOOL_KEYS = ['pk:scanner', 'pk:tape'];
const STAND_Q = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));

export class PackStation {
  constructor(app) {
    this.app = app;
    this.s = app.session.pack.scenario;
    this.w = buildPackStation(this.s);
    this.group = this.w.station;
    this.group.position.x = PACK_BASE.x;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 1.2;
    this.loc = {};
    this.selected = this.s.itemOrder[0];
    this.scanFlash = null;
    this.tape = { a: 0, b: 0, active: null, lastBuzz: 0 };
    this.flapK = 0;
    this.shipping = null;
    this.reset();
    // Next tote of the shift: swap the order and roll the new tote in.
    this.engine.on((evt) => { if (evt.type === 'order') this.onNextOrder(); });
  }

  get engine() {
    return this.app.session.pack;
  }

  /** Switch to run `variant` (Station 1 replay with new orders). */
  setRun(variant) {
    const run = packRun(variant);
    // Update local state first: the engine reset triggers a UI refresh.
    this.s = run.orders[0];
    this.selected = this.s.itemOrder[0];
    this.finishShipping();
    this.engine.setRun(run);
    this.drawOrder();
    this.reset();
  }

  drawOrder() {
    this.w.drawToteLabel(this.s.order.tote);
    this.w.shipLabel.draw(this.s);
    this.w.nextTote.visible = this.s.index < this.s.count - 1;
  }

  onNextOrder() {
    this.s = this.engine.scenario;
    this.selected = this.s.itemOrder[0];
    this.drawOrder();
    this.reset({ rollIn: true, keepHeldTools: true });
  }

  // ------------------------------------------------------------ registry

  get itemKeys() {
    return this.s.itemOrder.map((k) => `pk:${k}`);
  }

  /** The carton currently built (or the one that would be). */
  get carton() {
    return this.w.cartons[this.engine.carton ?? this.s.correctCarton];
  }

  objFor(key) {
    const w = this.w;
    if (key === 'pk:scanner') return w.scanner.group;
    if (key === 'pk:tape') return w.tapeGun.group;
    if (key === 'pk:pillow') return w.pillow;
    if (key === 'pk:label') return w.label;
    if (key === 'pk:box') return this.carton.group;
    if (key.startsWith('pk:carton-')) return w.flats[key.slice(10)].group;
    return w.items[key.slice(3)]?.group ?? null;
  }

  itemKey(key) {
    return this.itemKeys.includes(key) ? key.slice(3) : null;
  }

  homePose(key) {
    const T = L.tote;
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const item = this.itemKey(key);
    if (item) {
      const [dx, y, dz, rot = 0] = this.s.toteSlots[item];
      pos.set(T.x + dx, y, T.z + dz);
      q.setFromAxisAngle(UP, rot);
      return { pos, quat: q };
    }
    switch (key) {
      case 'pk:scanner': pos.set(L.scanner.x, 0.14, L.scanner.z); break; // upright in its cradle
      case 'pk:tape':
        pos.set(L.tape.x, 0.05, L.tape.z);
        q.setFromEuler(new THREE.Euler(0, Math.PI, 0));
        break;
      case 'pk:pillow': pos.set(L.basket.x, 0.085, L.basket.z); break;
      case 'pk:label':
        pos.set(L.printer.x, 0.075, L.printer.z + L.printer.d / 2 + 0.06);
        q.setFromEuler(new THREE.Euler(-1.1, 0, 0));
        break;
      case 'pk:box': pos.set(L.packZone.x, L.packZone.top, L.packZone.z); break;
      default:
        if (key.startsWith('pk:carton-')) pos.set(L.slots.xs[key.slice(10)], 0.022 + 3 * 0.019 + 0.002, L.slots.z);
    }
    return { pos, quat: q };
  }

  cartonSlot(item) {
    const [x, y, z, rot = 0] = this.s.cartonSlots[item] ?? [0, 0.05, 0];
    const quat = rot === 'stand' ? STAND_Q.clone() : new THREE.Quaternion().setFromAxisAngle(UP, rot);
    return { pos: new THREE.Vector3(x, y, z), quat };
  }

  exceptionSlot(item) {
    const def = this.s.items[item];
    return { pos: new THREE.Vector3(L.exception.x, 0.02 + def.size[1] / 2, L.exception.z), quat: new THREE.Quaternion().setFromAxisAngle(UP, 0.4) };
  }

  // --------------------------------------------------------------- state

  /**
   * Put everything for the current tote in place. `rollIn` slides the new
   * tote in along the inbound rollers; `keepHeldTools` leaves a scanner or
   * tape gun in the learner's hand between totes.
   */
  reset({ rollIn = false, keepHeldTools = false } = {}) {
    const keep = new Set();
    for (const c of this.app.xrInput?.controllers ?? []) {
      if (!c.held || !c.held.startsWith('pk:')) continue;
      if (keepHeldTools && TOOL_KEYS.includes(c.held)) keep.add(c.held);
      else c.held = null;
    }
    if (!keep.has('pk:tape')) this.tape = { a: 0, b: 0, active: null, lastBuzz: 0 };
    else this.tape = { ...this.tape, a: 0, b: 0, active: null };
    for (const key of ALL_ITEM_KEYS) {
      const obj = this.w.items[key.slice(3)].group;
      this.app.cancelTweens?.(obj);
      this.group.attach(obj);
      obj.visible = false;
    }
    for (const [k, c] of Object.entries(this.w.cartons)) {
      if (this.shipping?.key === k) continue; // still riding the outbound conveyor
      this.app.cancelTweens?.(c.group);
      this.group.attach(c.group);
      c.group.visible = false;
      c.setFlaps(0);
      c.setTape(0, 0);
    }
    const keys = [...this.itemKeys, ...TOOL_KEYS, 'pk:pillow', 'pk:label', 'pk:box', ...this.s.cartonOrder.map((k) => `pk:carton-${k}`)]
      .filter((k) => !keep.has(k) && !(k === 'pk:box' && this.shipping && this.carton === this.w.cartons[this.shipping.key]));
    for (const key of keys) {
      const obj = this.objFor(key);
      this.app.cancelTweens?.(obj);
      this.group.attach(obj);
      const { pos, quat } = this.homePose(key);
      obj.position.copy(pos);
      obj.quaternion.copy(quat);
      obj.visible = true;
      this.loc[key] = 'home';
    }
    this.selected = this.s.itemOrder[0];
    this.scanFlash = null;
    this.flapK = 0;
    if (rollIn && !this.app.settings.reducedMotion) {
      for (const obj of [this.w.tote, ...this.itemKeys.map((k) => this.objFor(k))]) {
        const end = obj.position.clone();
        obj.position.x -= 0.9;
        this.app.tween(obj, { pos: end, dur: 1.3, ease: 'out' });
      }
      this.app.sfx.play('conveyor');
    }
    this.sync();
  }

  /** The shipped carton has left: hide it and make it reusable. */
  finishShipping() {
    const sh = this.shipping;
    if (!sh) return;
    this.shipping = null;
    const c = this.w.cartons[sh.key];
    this.app.cancelTweens?.(c.group);
    c.group.visible = false;
    c.setFlaps(0);
    c.setTape(0, 0);
    c.appliedLabel.visible = false;
    c.pillows.forEach((p) => { p.visible = false; });
    this.sync();
  }

  /** Derive visibility from engine state (carton, fill, labels). */
  sync() {
    const e = this.engine;
    const w = this.w;
    if (this.shipping && e.carton === this.shipping.key) this.finishShipping(); // same size needed again
    for (const [k, c] of Object.entries(w.cartons)) {
      if (this.shipping?.key === k) continue;
      const built = e.carton === k;
      c.group.visible = built;
      c.pillows.forEach((p, i) => { p.visible = built && i < e.dunnage; });
      c.appliedLabel.visible = built && e.labelApplied;
      if (built && e.sealed) c.setTape(-c.size[0] / 2 - 0.002, c.size[0] / 2 + 0.002);
    }
    w.label.visible = e.labelPrinted && !e.labelApplied;
    for (const k of this.s.cartonOrder) {
      w.flats[k].group.visible = !e.carton || this.loc[`pk:carton-${k}`] === 'held';
    }
  }

  isHeld(key) {
    return (this.app.xrInput?.controllers ?? []).some((c) => c.held === key);
  }

  selectableItems() {
    return this.s.itemOrder.filter((k) => !['box', 'exception'].includes(this.engine.items[k].loc));
  }

  // ------------------------------------------------------------- picking

  pickables() {
    const list = [];
    const add = (obj) => obj.traverse((o) => { if (o.isMesh && o.visible) list.push(o); });
    for (const key of [...this.itemKeys, ...TOOL_KEYS]) {
      if (!this.isHeld(key)) add(this.objFor(key));
    }
    list.push(this.w.toteLabel);
    for (const k of this.s.cartonOrder) if (this.w.flats[k].group.visible && !this.isHeld(`pk:carton-${k}`)) add(this.w.flats[k].group);
    if (!this.isHeld('pk:pillow')) add(this.w.pillow);
    if (this.w.label.visible && !this.isHeld('pk:label')) add(this.w.label);
    const box = this.carton.group;
    if (box.visible && !this.isHeld('pk:box')) box.children.forEach((o) => { if (o.isMesh) list.push(o); });
    list.push(this.w.printer, this.w.wms.mesh, this.w.releaseBtn, ...this.w.heightSwitch.buttons);
    return list;
  }

  grabCandidates() {
    const out = [];
    for (const key of [...this.itemKeys, ...TOOL_KEYS, 'pk:pillow']) out.push([key, this.objFor(key)]);
    for (const k of this.s.cartonOrder) if (this.w.flats[k].group.visible) out.push([`pk:carton-${k}`, this.w.flats[k].group]);
    if (this.w.label.visible) out.push(['pk:label', this.w.label]);
    if (this.carton.group.visible) out.push(['pk:box', this.carton.group]);
    return out;
  }

  setHover(hot) {
    const glow = (mats, on) => mats.forEach((m) => m.emissive?.setHex(on ? 0x3a3020 : 0));
    for (const k of this.s.itemOrder) glow(this.w.items[k].mats, hot.has(`pk:${k}`) || (!this.app.xr && this.selected === k && this.app.session.phase === 'pack'));
    for (const k of this.s.cartonOrder) glow(this.w.flats[k].mats, hot.has(`pk:carton-${k}`));
    glow(this.w.scanner.mats, hot.has('pk:scanner'));
    glow(this.w.tapeGun.mats, hot.has('pk:tape'));
    glow([this.carton.mat], hot.has('pk:box'));
    glow([this.w.printer.material], hot.has('pk:printer'));
    this.w.releaseBtn.material.emissive.setHex(hot.has('release') ? 0x1f5a36 : 0);
  }

  zoneAt(pos) {
    for (const [name, z] of Object.entries(this.w.zones)) {
      if (pos.x >= z.min.x && pos.x <= z.max.x && pos.y >= z.min.y && pos.y <= z.max.y && pos.z >= z.min.z && pos.z <= z.max.z) return name;
    }
    return null;
  }

  zoneOf(obj) {
    obj.getWorldPosition(v1);
    this.group.worldToLocal(v1);
    return this.zoneAt(v1);
  }

  /** Label for the drop target under a held object, if any. */
  zoneLabelFor(key) {
    if (TOOL_KEYS.includes(key)) return null;
    const z = this.zoneOf(this.objFor(key));
    return z ? `Release: ${this.w.zones[z].label}` : null;
  }

  // --------------------------------------------------------------- grabbing

  canUse() {
    const e = this.engine;
    if (this.app.session.phase !== 'pack' || e.phase === 'setup' || e.phase === 'briefing') {
      return { ok: false, title: 'Not started', message: 'Press Start on the screen first.' };
    }
    if (e.phase === 'complete') return { ok: false, title: 'Station done', message: 'Go on, or replay with a new order.' };
    if (e.isPaused()) return { ok: false, title: 'Paused', message: 'Select Resume.' };
    return { ok: true };
  }

  tryGrab(key, c, far) {
    const app = this.app;
    const u = this.canUse();
    if (!u.ok) {
      app.info(u.message, 'info', u.title);
      app.xrInput.haptic(c, 0.4, 80);
      app.refreshUI();
      return false;
    }
    const e = this.engine;
    const item = this.itemKey(key);
    if (item && ['box', 'exception'].includes(e.items[item].loc)) {
      app.info(e.items[item].loc === 'box' ? 'Packed items stay in the carton.' : 'Extra items stay in the bin.', 'info', 'Stays put');
      app.refreshUI();
      return false;
    }
    if (key === 'pk:box' && (e.released || this.loc['pk:box'] === 'released')) return false;
    const obj = this.objFor(key);
    app.cancelTweens(obj);
    if (key === 'pk:box' && e.staged) e.unstage();
    if (TOOL_KEYS.includes(key)) {
      // Tools snap to a fixed pose on the pointing ray so aim matches the beam.
      c.ray.attach(obj);
      obj.position.set(0, -0.03, key === 'pk:scanner' ? 0.03 : 0.0);
      obj.quaternion.identity();
    } else {
      c.grip.attach(obj);
      if (far) app.tween(obj, { pos: new THREE.Vector3(0, -0.02, -0.12), dur: 0.25 });
    }
    c.held = key;
    this.loc[key] = 'held';
    if (item) this.selected = item;
    app.sfx.play('grab');
    app.xrInput.haptic(c, 0.35, 40);
    app.refreshUI();
    return true;
  }

  release(c) {
    const app = this.app;
    const key = c.held;
    c.held = null;
    if (key === 'pk:tape') this.tape.active = null;
    const obj = this.objFor(key);
    this.group.attach(obj);
    const ctx = { input: 'xr' };
    const zone = this.zoneAt(obj.position);
    let r = null;
    const item = this.itemKey(key);
    if (TOOL_KEYS.includes(key)) {
      this.goHome(key);
    } else if (item) {
      if (zone === 'carton') {
        r = this.engine.packItem(item, ctx);
        if (r.ok) this.putInCarton(item);
        else this.goHome(key);
      } else if (zone === 'exception') {
        r = this.engine.divertItem(item, ctx);
        if (r.ok) this.putInException(item);
        else this.goHome(key);
      } else if (zone === 'tote') {
        this.engine.returnToTote(item);
        this.goHome(key);
      } else if (zone === 'outbound') {
        r = { tone: 'info', message: 'Only sealed, weighed and labelled cartons go on the conveyor. The item is back in the tote.' };
        this.goHome(key);
      } else {
        this.restOrDrop(key, obj);
      }
    } else if (key.startsWith('pk:carton-')) {
      if (zone === 'carton') r = this.engine.selectCarton(key.slice(10), ctx);
      this.goHome(key);
    } else if (key === 'pk:pillow') {
      if (zone === 'carton') r = this.engine.addDunnage(ctx);
      this.goHome(key);
    } else if (key === 'pk:label') {
      if (zone === 'carton') r = this.engine.applyLabel(ctx);
      this.goHome(key);
    } else if (key === 'pk:box') {
      if (zone === 'outbound') {
        r = this.engine.stage(ctx);
        if (r.ok) this.toConveyor();
        else this.goHome(key);
      } else {
        this.goHome(key);
      }
    }
    this.sync();
    if (!TOOL_KEYS.includes(key)) app.sfx.play('drop');
    if (r) app.showResult(r, { controller: c });
    app.refreshUI();
  }

  goHome(key) {
    const obj = this.objFor(key);
    if (obj.parent !== this.group) this.group.attach(obj);
    const { pos, quat } = this.homePose(key);
    this.app.tween(obj, { pos, quat, dur: 0.3 });
    this.loc[key] = 'home';
  }

  putInCarton(item) {
    const obj = this.objFor(`pk:${item}`);
    this.carton.group.attach(obj);
    const { pos, quat } = this.cartonSlot(item);
    this.app.tween(obj, { pos, quat, dur: 0.3 });
    this.loc[`pk:${item}`] = 'box';
  }

  putInException(item) {
    const obj = this.objFor(`pk:${item}`);
    if (obj.parent !== this.group) this.group.attach(obj);
    const { pos, quat } = this.exceptionSlot(item);
    this.app.tween(obj, { pos, quat, dur: 0.3 });
    this.loc[`pk:${item}`] = 'exception';
  }

  toConveyor() {
    const C = L.conveyor;
    this.app.tween(this.carton.group, { pos: new THREE.Vector3(C.x, C.top, C.intakeZ), quat: new THREE.Quaternion(), dur: 0.3 });
    this.loc['pk:box'] = 'outbound';
  }

  restOrDrop(key, obj) {
    const pos = obj.position.clone();
    const item = this.itemKey(key);
    const h = item ? this.s.items[item].size[1] : 0.05;
    const e = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ');
    const quat = new THREE.Quaternion().setFromAxisAngle(UP, e.y);
    if (this.app.overBench(pos)) {
      pos.y = h / 2;
      this.app.tween(obj, { pos, quat, dur: 0.25, ease: 'in' });
      this.loc[key] = 'bench';
      return;
    }
    pos.y = -this.app.settings.benchHeight + h / 2;
    this.app.tween(obj, { pos, quat, dur: 0.4, ease: 'in' });
    this.loc[key] = 'floor';
    this.app.info('No penalty. Select Retrieve items.', 'info', 'Dropped');
  }

  floorItems() {
    return this.itemKeys.filter((k) => this.loc[k] === 'floor');
  }

  // ------------------------------------------------------------ tool use

  /** Trigger pressed while holding a tool. Returns true when consumed. */
  onTrigger(c) {
    if (c.held === 'pk:scanner') {
      this.handScan(c);
      return true;
    }
    if (c.held === 'pk:tape') {
      this.startTape(c);
      return true;
    }
    return false;
  }

  /** Trigger released while holding a tool. */
  onTriggerEnd(c) {
    if (this.tape.active === c) this.tape.active = null;
  }

  scanTargets() {
    const list = [this.w.toteLabel];
    for (const k of this.s.itemOrder) list.push(this.w.items[k].mesh);
    return list;
  }

  /** Ray from the scanner nose; returns {key, item, facing, distance} or null. */
  scannerHit() {
    const gun = this.w.scanner.group;
    const origin = v1.set(0, 0, -0.095).applyMatrix4(gun.matrixWorld);
    const dir = v2.set(0, 0, -1).transformDirection(gun.matrixWorld);
    this.raycaster.set(origin, dir);
    const hits = this.raycaster.intersectObjects(this.scanTargets(), false);
    for (const h of hits) {
      const key = h.object.userData.key;
      if (key === 'pk:tote') return { key, distance: h.distance, facing: true };
      const item = this.itemKey(key);
      if (!item) continue;
      const g = this.w.items[item].group;
      const n = g.userData.barcodeNormal.clone().transformDirection(g.matrixWorld);
      return { key, item, distance: h.distance, facing: n.dot(dir) < -0.2 };
    }
    return null;
  }

  handScan(c) {
    const app = this.app;
    const hit = this.scannerHit();
    let r;
    if (!hit) {
      r = { code: 'NO_READ', tone: 'warning', message: 'No read — point the red beam at a barcode (tote label or product label) and pull the trigger.' };
      this.scanFlash = { ok: false, until: performance.now() + 1200 };
    } else if (hit.key === 'pk:tote') {
      r = this.engine.scanTote({ input: 'xr' });
    } else {
      r = this.engine.scanItem(hit.item, { aligned: hit.facing }, { input: 'xr' });
      if (r.code === 'NO_READ') r.message = `No read — the ${this.s.items[hit.item].name.toLowerCase()} barcode is facing away. Turn it toward the scanner.`;
      this.selected = hit.item;
    }
    if (r.ok) {
      this.scanFlash = { ok: true, until: performance.now() + 1200 };
      app.sfx.play('scan');
    }
    app.showResult(r, { controller: c });
    app.refreshUI();
  }

  /** Tape-gun nose in carton-local coordinates. */
  tapeNoseInCarton() {
    const nose = v1.set(0, -0.04, -0.11).applyMatrix4(this.w.tapeGun.group.matrixWorld);
    return this.carton.group.worldToLocal(nose);
  }

  startTape(c) {
    const app = this.app;
    const e = this.engine;
    let r = null;
    if (!e.carton || this.loc['pk:box'] !== 'home') {
      r = { code: 'TAPE_NO_CARTON', tone: 'info', message: 'Build a carton on the pack scale first; then tape it shut there.' };
    } else if (e.sealed) {
      r = { tone: 'info', message: 'The carton is already sealed.' };
    } else {
      const n = this.tapeNoseInCarton();
      const [w, h] = this.carton.size;
      if (Math.abs(n.x) > w / 2 + 0.15 || Math.abs(n.z) > 0.2 || n.y < h - 0.08 || n.y > h + 0.25) {
        r = { code: 'TAPE_FAR', tone: 'info', message: 'Hold the tape gun over one end of the carton seam, pull the trigger and draw it across the top.' };
      } else if (e.sealBlocker()) {
        // Same validated (and scored) refusal as any other seal attempt.
        r = e.seal({ input: 'xr' });
      } else {
        this.tape.active = c;
        if (this.tape.b <= this.tape.a) {
          const x = THREE.MathUtils.clamp(n.x, -w / 2, w / 2);
          this.tape.a = this.tape.b = x;
        }
        app.info('Keep it held. Drag along the top.', 'info', 'Taping…');
      }
    }
    if (r) app.showResult(r, { controller: c });
    app.refreshUI();
  }

  /** Per frame while taping: extend the strip under the gun; seal when it spans the carton. */
  updateTape(now) {
    const c = this.tape.active;
    if (!c) return;
    const carton = this.carton;
    const [w, h] = carton.size;
    const n = this.tapeNoseInCarton();
    if (Math.abs(n.z) < 0.12 && n.y > h - 0.08 && n.y < h + 0.2) {
      const x = THREE.MathUtils.clamp(n.x, -w / 2 - 0.002, w / 2 + 0.002);
      const before = this.tape.b - this.tape.a;
      this.tape.a = Math.min(this.tape.a, x);
      this.tape.b = Math.max(this.tape.b, x);
      if (this.tape.b - this.tape.a > before + 0.003 && now - this.tape.lastBuzz > 70) {
        this.tape.lastBuzz = now;
        this.app.xrInput.haptic(c, 0.25, 30);
        this.app.sfx.play('tape');
      }
      carton.setTape(this.tape.a, this.tape.b);
      if (this.tape.b - this.tape.a >= w * 0.85) {
        this.tape.active = null;
        const r = this.engine.seal({ input: 'xr' });
        this.sync();
        this.app.showResult(r, { controller: c });
        this.app.refreshUI();
      }
    }
  }

  // -------------------------------------------------------- panel actions

  /** Assisted / desktop actions: id = 'pk:<verb>[:<arg>]'. */
  dispatch(verb, arg, ctx) {
    const e = this.engine;
    const item = this.selected;
    let r = null;
    switch (verb) {
      case 'scan':
        r = arg === 'tote' ? e.scanTote(ctx) : e.scanItem(item, { aligned: true }, ctx);
        if (r.ok) {
          this.scanFlash = { ok: true, until: performance.now() + 1200 };
          this.app.sfx.play('scan');
        }
        break;
      case 'select': {
        const list = this.selectableItems();
        if (list.length) this.selected = list[(list.indexOf(item) + 1) % list.length];
        return null;
      }
      case 'pick':
        if (this.s.items[arg]) this.selected = arg;
        return null;
      case 'pack':
        r = e.packItem(item, ctx);
        if (r.ok && this.loc[`pk:${item}`] !== 'box') { this.detach(`pk:${item}`); this.putInCarton(item); }
        break;
      case 'divert':
        r = e.divertItem(item, ctx);
        if (r.ok && this.loc[`pk:${item}`] !== 'exception') { this.detach(`pk:${item}`); this.putInException(item); }
        break;
      case 'carton': r = e.selectCarton(arg, ctx); break;
      case 'dunnage': r = e.addDunnage(ctx); break;
      case 'seal': r = e.seal(ctx); break;
      case 'weight': r = e.confirmWeight(arg, ctx); break;
      case 'print': r = e.printLabel(ctx); break;
      case 'apply': r = e.applyLabel(ctx); if (r.ok) this.detach('pk:label'); break;
      case 'outbound':
        r = e.stage(ctx);
        if (r.ok) { this.detach('pk:box'); this.toConveyor(); }
        break;
      case 'retrieve':
        for (const k of this.floorItems()) this.goHome(k);
        this.app.info('No penalty.', 'info', 'Back in the tote');
        break;
      default: break;
    }
    if (r?.ok && this.selectableItems().length && !this.selectableItems().includes(this.selected)) {
      this.selected = this.selectableItems()[0];
    }
    this.sync();
    return r;
  }

  detach(key) {
    for (const c of this.app.xrInput.controllers) {
      if (c.held === key) {
        c.held = null;
        this.group.attach(this.objFor(key));
      }
    }
  }

  confirmRelease(ctx) {
    const size = this.engine.carton;
    // Mark the carton as shipping first: a successful release moves the
    // engine to the next tote, and that reset must leave this carton alone.
    if (size) this.finishShipping();
    if (size && this.engine.staged) this.shipping = { key: size };
    const r = this.engine.release(ctx);
    if (r.ok && r.code === 'RELEASED') {
      const C = L.conveyor;
      const shipped = this.w.cartons[size];
      const g = shipped.group;
      // Ships closed and taped, even if the flap animation had not finished.
      shipped.setFlaps(1);
      shipped.setTape(-shipped.size[0] / 2 - 0.002, shipped.size[0] / 2 + 0.002);
      // The last carton of the shift stays at the end of the line.
      if (r.lastOrder) {
        this.loc['pk:box'] = 'released';
        this.shipping = null;
      }
      this.app.tween(g, {
        pos: new THREE.Vector3(C.x, C.top, C.endZ), quat: new THREE.Quaternion(), dur: 3.2, ease: 'linear',
        onDone: () => { if (this.shipping?.key === size) this.finishShipping(); },
      });
    } else {
      this.shipping = null;
    }
    return r;
  }

  /** Desktop click on a station object. */
  click(key) {
    const app = this.app;
    const item = this.itemKey(key);
    if (item) {
      this.selected = item;
      app.info('Use Scan, Pack or To bin.', 'info', `Selected: ${this.s.items[item].name}`);
      return;
    }
    const map = {
      'pk:tote': 'pk:scan:tote', 'pk:pillow': 'pk:dunnage', 'pk:tape': 'pk:seal', 'pk:printer': 'pk:print',
      'pk:label': 'pk:apply', 'pk:box': 'pk:outbound', 'pk:scanner': 'pk:scan:item',
    };
    if (key.startsWith('pk:carton-')) app.dispatch(`pk:carton:${key.slice(10)}`, 'desktop');
    else if (map[key]) app.dispatch(map[key], 'desktop');
  }

  // ---------------------------------------------------------- per frame

  /** `slow` (≈10 Hz) gates canvas screens; tools and animation run every frame. */
  update(now, slow = true) {
    const e = this.engine;
    const w = this.w;
    // Flaps fold shut as soon as taping starts, and stay shut once sealed.
    const target = e.sealed || this.tape.b > this.tape.a ? 1 : 0;
    const dt = Math.min(100, now - (this.lastUpdate ?? now));
    this.lastUpdate = now;
    if (this.flapK !== target) {
      // Time-based (~0.4 s) so it looks the same at any frame rate.
      const step = dt / 400;
      this.flapK = this.app.settings.reducedMotion ? target : THREE.MathUtils.clamp(this.flapK + (target ? step : -step), 0, 1);
      this.carton.setFlaps(this.flapK);
    }
    this.updateTape(now);
    // Pulse the monitor frame while the carton size is the thing to read.
    const glow = w.monitorGlow;
    glow.visible = e.phase === 'exercise' && e.step() === 'carton';
    if (glow.visible) glow.userData.mat.color.setHSL(0.11, 1, 0.45 + 0.15 * Math.sin(now / 180));
    // Scanner beam while held.
    const beam = w.scanner.group.userData.beam;
    const held = this.isHeld('pk:scanner');
    beam.visible = held;
    if (held) {
      const hit = this.scannerHit();
      const len = hit ? hit.distance + 0.01 : 0.6;
      beam.scale.set(1, len, 1);
      beam.position.set(0, 0, -0.095 - len / 2);
      const flash = this.scanFlash && this.scanFlash.until > now ? this.scanFlash : null;
      beam.material.color.setHex(flash ? (flash.ok ? 0x39d98a : 0xff9b3d) : hit ? 0xff2a2a : 0xff6a6a);
    }
    if (!slow) return;
    const { min, max } = packWeightRange(this.s);
    const weight = e.carton && this.loc['pk:box'] === 'home' ? e.measuredWeightKg() : 0;
    w.scaleScreen.show([
      { text: `${weight.toFixed(2)} kg`, size: 64, bold: true, color: weight ? '#9dffc9' : '#6fae8c' },
      { text: e.weightConfirmed ? 'CONFIRMED: IN RANGE' : e.sealed ? 'CONFIRM ON PANEL' : `EXPECTED ${min.toFixed(2)}–${max.toFixed(2)}`, size: 26, color: e.sealed && !e.weightConfirmed ? '#ffd97a' : '#cfe8da' },
    ]);
    w.printerScreen.show([{ text: e.labelApplied ? 'DONE' : e.labelPrinted ? 'TAKE LABEL' : 'READY', size: 64, bold: true }]);
    const s = this.s;
    w.wms.show({
      tote: s.order.tote,
      toteNo: `TOTE ${s.index + 1} OF ${s.count}`,
      open: e.orderOpen,
      orderId: s.order.id,
      service: s.order.service,
      rows: e.orderItems().map((k) => ({
        name: s.items[k].name, sku: s.items[k].sku, dims: s.items[k].dims, fragile: s.items[k].fragile,
        scanned: e.items[k].scanned, packed: e.items[k].loc === 'box',
      })),
      exceptions: s.itemOrder.filter((k) => !s.items[k].onOrder && (e.items[k].scanned || e.items[k].loc === 'exception'))
        .map((k) => ({ name: s.items[k].name, sku: s.items[k].sku, state: e.items[k].loc === 'exception' ? 'diverted' : 'flagged' })),
      recSize: s.correctCarton,
      recInner: `${s.cartons[e.carton ?? s.correctCarton].inner} inside`,
      carton: e.carton,
      weight: (e.carton ? e.measuredWeightKg() : 0).toFixed(2),
      range: `${min.toFixed(2)}–${max.toFixed(2)}`,
      sealed: e.sealed,
      confirmed: e.weightConfirmed,
      label: e.labelApplied ? 'APPLIED' : e.labelPrinted ? 'PRINTED' : '--',
    });
  }

  /** Local prompt for the current step (station-frame position + text). */
  markerPose() {
    const e = this.engine;
    if (this.app.session.phase !== 'pack' || e.phase !== 'exercise') return null;
    const T = L.tote;
    const C = L.conveyor;
    const P = L.packZone;
    const M = L.monitor;
    const step = e.step();
    const vr = !!this.app.xr;
    const at = (x, y, z, text) => ({ pos: new THREE.Vector3(x, y, z), text });
    const top = P.top + this.carton.size[1];
    switch (step) {
      case 'open':
        return vr && !this.isHeld('pk:scanner')
          ? at(L.scanner.x, 0.36, L.scanner.z, 'PICK UP SCANNER')
          : at(T.x, T.h + 0.1, T.z + T.d / 2, 'SCAN TOTE LABEL');
      case 'scan': return at(T.x, 0.3, T.z, 'SCAN EACH ITEM');
      case 'exception': return at(L.exception.x, 0.32, L.exception.z, 'EXCEPTION BIN');
      case 'carton': return at(M.x, M.y + M.h / 2 + 0.16, M.z, 'CHECK CARTON SIZE');
      case 'pack': return at(P.x, 0.4, P.z, 'PACK ITEMS');
      case 'dunnage': return at(L.basket.x, 0.3, L.basket.z, 'VOID FILL');
      case 'seal':
        return vr && !this.isHeld('pk:tape')
          ? at(L.tape.x, 0.27, L.tape.z, 'PICK UP TAPE GUN')
          : at(P.x, top + 0.2, P.z, 'RUN TAPE ALONG THE TOP');
      case 'weigh': return at(P.x - 0.22, 0.12, P.z + P.d / 2 + 0.05, 'READ THE SCALE');
      case 'print': return at(L.printer.x, 0.32, L.printer.z, 'PRINT LABEL');
      case 'label':
        return this.isHeld('pk:label')
          ? at(P.x, top + 0.2, P.z, 'PLACE ON TOP')
          : at(L.printer.x, 0.32, L.printer.z, 'TAKE LABEL');
      case 'outbound': return at(C.x, 0.42, C.intakeZ, 'OUTBOUND');
      case 'release': return at(L.releaseButton.x, 0.24, L.releaseButton.z, 'CONFIRM RELEASE');
      default: return null;
    }
  }
}
