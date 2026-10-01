// Station 1 interaction controller: grabbing, drop targets, handheld scanner,
// tape gun, label printer, displays and local prompts. Every procedural
// change goes through PackEngine; visuals follow validated results only.
import * as THREE from 'three';
import { buildPackStation, PACK_LAYOUT as L } from './scene.js';
import { PACK_SCENARIO, packWeightRange } from './scenario.js';

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
export const PACK_BASE = new THREE.Vector3(-3.2, 0, 0);

const ITEM_KEYS = PACK_SCENARIO.itemOrder.map((k) => `pk:${k}`);
const TOOL_KEYS = ['pk:scanner', 'pk:tape'];

export class PackStation {
  constructor(app) {
    this.app = app;
    this.s = PACK_SCENARIO;
    this.w = buildPackStation(this.s);
    this.group = this.w.station;
    this.group.position.x = PACK_BASE.x;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 1.2;
    this.loc = {};
    this.selected = this.s.itemOrder[0];
    this.scanFlash = null;
    this.reset();
  }

  get engine() {
    return this.app.session.pack;
  }

  // ------------------------------------------------------------ registry

  objFor(key) {
    const w = this.w;
    if (key === 'pk:scanner') return w.scanner.group;
    if (key === 'pk:tape') return w.tapeGun.group;
    if (key === 'pk:pillow') return w.pillow;
    if (key === 'pk:label') return w.label;
    if (key === 'pk:box') return w.carton.group;
    if (key.startsWith('pk:carton-')) return w.flats[key.slice(10)].group;
    return w.items[key.slice(3)]?.group ?? null;
  }

  itemKey(key) {
    return ITEM_KEYS.includes(key) ? key.slice(3) : null;
  }

  homePose(key) {
    const T = L.tote;
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    switch (key) {
      case 'pk:mug': pos.set(T.x - 0.1, 0.02 + 0.06, T.z - 0.04); break;
      case 'pk:book': pos.set(T.x + 0.07, 0.02 + 0.02, T.z + 0.04); break;
      case 'pk:case': pos.set(T.x + 0.07, 0.04 + 0.0125 + 0.004, T.z + 0.02); q.setFromAxisAngle(UP, 0.25); break;
      case 'pk:scanner':
        pos.set(L.scanner.x, 0.025, L.scanner.z);
        q.setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI / 2, 'YXZ'));
        break;
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
    const size = this.w.carton.size;
    if (item === 'mug') return { pos: new THREE.Vector3(-0.07, 0.006 + 0.06, 0.03), quat: new THREE.Quaternion() };
    if (item === 'book') {
      const q = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      return { pos: new THREE.Vector3(size[0] / 2 - 0.04, 0.006 + 0.08, 0), quat: q };
    }
    return { pos: new THREE.Vector3(0, 0.05, 0), quat: new THREE.Quaternion() };
  }

  exceptionSlot(item) {
    const def = this.s.items[item];
    return { pos: new THREE.Vector3(L.exception.x, 0.02 + def.size[1] / 2, L.exception.z), quat: new THREE.Quaternion().setFromAxisAngle(UP, 0.4) };
  }

  // --------------------------------------------------------------- state

  reset() {
    for (const c of this.app.xrInput?.controllers ?? []) {
      if (c.held && c.held.startsWith('pk:')) c.held = null;
    }
    const keys = [...ITEM_KEYS, ...TOOL_KEYS, 'pk:pillow', 'pk:label', 'pk:box', ...this.s.cartonOrder.map((k) => `pk:carton-${k}`)];
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
    this.w.carton.setSealed(false);
    this.selected = this.s.itemOrder[0];
    this.scanFlash = null;
    this.sync();
  }

  /** Derive visibility from engine state (carton, fill, labels). */
  sync() {
    const e = this.engine;
    const w = this.w;
    w.carton.group.visible = !!e.carton;
    w.carton.setSealed(e.sealed);
    w.cartonPillows.forEach((p, i) => { p.visible = i < e.dunnage; });
    w.appliedLabel.visible = e.labelApplied;
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
    for (const key of [...ITEM_KEYS, ...TOOL_KEYS]) {
      if (!this.isHeld(key)) add(this.objFor(key));
    }
    list.push(this.w.toteLabel);
    for (const k of this.s.cartonOrder) if (this.w.flats[k].group.visible && !this.isHeld(`pk:carton-${k}`)) add(this.w.flats[k].group);
    if (!this.isHeld('pk:pillow')) add(this.w.pillow);
    if (this.w.label.visible && !this.isHeld('pk:label')) add(this.w.label);
    if (this.w.carton.group.visible && !this.isHeld('pk:box')) {
      this.w.carton.group.children.forEach((o) => { if (o.isMesh) list.push(o); });
    }
    list.push(this.w.printer, this.w.wms.mesh, this.w.releaseBtn);
    return list;
  }

  grabCandidates() {
    const out = [];
    for (const key of [...ITEM_KEYS, ...TOOL_KEYS, 'pk:pillow']) out.push([key, this.objFor(key)]);
    for (const k of this.s.cartonOrder) if (this.w.flats[k].group.visible) out.push([`pk:carton-${k}`, this.w.flats[k].group]);
    if (this.w.label.visible) out.push(['pk:label', this.w.label]);
    if (this.w.carton.group.visible) out.push(['pk:box', this.w.carton.group]);
    return out;
  }

  setHover(hot) {
    const glow = (mats, on) => mats.forEach((m) => m.emissive?.setHex(on ? 0x3a3020 : 0));
    for (const k of this.s.itemOrder) glow(this.w.items[k].mats, hot.has(`pk:${k}`) || (!this.app.xr && this.selected === k && this.app.session.phase === 'pack'));
    for (const k of this.s.cartonOrder) glow(this.w.flats[k].mats, hot.has(`pk:carton-${k}`));
    glow(this.w.scanner.mats, hot.has('pk:scanner'));
    glow(this.w.tapeGun.mats, hot.has('pk:tape'));
    glow([this.w.carton.mat], hot.has('pk:box'));
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
      return { ok: false, message: 'Start Station 1 from the briefing panel first. During setup, practise with the grey box.' };
    }
    if (e.phase === 'complete') return { ok: false, message: 'Station 1 is complete. Continue to Station 2 from the panel.' };
    if (e.isPaused()) return { ok: false, message: 'Training is paused. Select Resume to continue.' };
    return { ok: true };
  }

  tryGrab(key, c, far) {
    const app = this.app;
    const u = this.canUse();
    if (!u.ok) {
      app.info(u.message);
      app.xrInput.haptic(c, 0.4, 80);
      app.refreshUI();
      return false;
    }
    const e = this.engine;
    const item = this.itemKey(key);
    if (item && ['box', 'exception'].includes(e.items[item].loc)) {
      app.info(e.items[item].loc === 'box' ? 'Packed items stay in the carton.' : 'That item stays in the exception bin for a lead to resolve.');
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
    app.xrInput.haptic(c, 0.35, 40);
    app.refreshUI();
    return true;
  }

  release(c) {
    const app = this.app;
    const key = c.held;
    c.held = null;
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
      if (zone === 'carton') {
        r = this.engine.selectCarton(key.slice(10), ctx);
      }
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
    this.w.carton.group.attach(obj);
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
    const obj = this.w.carton.group;
    this.app.tween(obj, { pos: new THREE.Vector3(C.x, C.top, C.intakeZ), quat: new THREE.Quaternion(), dur: 0.3 });
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
    this.app.info(`${this.s.items[item]?.name ?? 'Item'} dropped — no penalty. Select Retrieve items to put it back in the tote.`);
  }

  floorItems() {
    return ITEM_KEYS.filter((k) => this.loc[k] === 'floor');
  }

  // ------------------------------------------------------------ tool use

  /** Trigger while holding a tool. Returns true when consumed. */
  onTrigger(c) {
    if (c.held === 'pk:scanner') {
      this.handScan(c);
      return true;
    }
    if (c.held === 'pk:tape') {
      this.handTape(c);
      return true;
    }
    return false;
  }

  scanTargets() {
    const list = [this.w.toteLabel];
    for (const k of this.s.itemOrder) list.push(this.w.items[k].mesh);
    return list;
  }

  /** Ray from the scanner nose; returns {key, item, facing, distance} or null. */
  scannerHit() {
    const gun = this.w.scanner.group;
    const origin = new THREE.Vector3(0, 0, -0.095).applyMatrix4(gun.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(gun.matrixWorld);
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
      r = { tone: 'warning', message: 'No read — point the red beam at a barcode (tote label or product label) and pull the trigger.' };
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

  handTape(c) {
    const app = this.app;
    const e = this.engine;
    const nose = new THREE.Vector3(0, -0.04, -0.11).applyMatrix4(this.w.tapeGun.group.matrixWorld);
    this.group.worldToLocal(nose);
    const P = L.packZone;
    const top = new THREE.Vector3(P.x, P.top + this.w.carton.size[1], P.z);
    let r;
    if (!e.carton || this.loc['pk:box'] !== 'home') {
      r = { tone: 'info', message: 'Build a carton on the pack scale first; then tape it shut there.' };
    } else if (nose.distanceTo(top) > 0.3) {
      r = { tone: 'info', message: 'Hold the tape gun over the top of the carton, then pull the trigger.' };
    } else {
      r = e.seal({ input: 'xr' });
    }
    this.sync();
    app.showResult(r, { controller: c });
    app.refreshUI();
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
        this.app.info('Dropped items are back in the tote. No penalty.');
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
    const r = this.engine.release(ctx);
    if (r.ok && r.code === 'RELEASED') {
      const C = L.conveyor;
      const obj = this.w.carton.group;
      this.loc['pk:box'] = 'released';
      this.app.tween(obj, { pos: new THREE.Vector3(C.x, C.top, C.endZ), quat: new THREE.Quaternion(), dur: 3.2, ease: 'linear' });
    }
    return r;
  }

  /** Desktop click on a station object. */
  click(key) {
    const app = this.app;
    const item = this.itemKey(key);
    if (item) {
      this.selected = item;
      app.info(`Selected: ${this.s.items[item].name}. Use Scan item, Pack in carton or To exception bin.`);
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

  update(now) {
    const e = this.engine;
    const w = this.w;
    const { min, max } = packWeightRange(this.s);
    const weight = e.carton && this.loc['pk:box'] === 'home' ? e.measuredWeightKg() : 0;
    w.scaleScreen.show([
      { text: `${weight.toFixed(2)} kg`, size: 64, bold: true, color: weight ? '#9dffc9' : '#6fae8c' },
      { text: e.weightConfirmed ? 'CONFIRMED: IN RANGE' : e.sealed ? 'CONFIRM ON PANEL' : `EXPECTED ${min.toFixed(2)}–${max.toFixed(2)}`, size: 26, color: e.sealed && !e.weightConfirmed ? '#ffd97a' : '#cfe8da' },
    ]);
    w.printerScreen.show([{ text: e.labelApplied ? 'DONE' : e.labelPrinted ? 'TAKE LABEL' : 'READY', size: 64, bold: true }]);
    const s = this.s;
    w.wms.show({
      open: e.orderOpen,
      orderId: s.order.id,
      tote: s.order.tote,
      service: s.order.service,
      rows: e.orderItems().map((k) => ({
        name: s.items[k].name, sku: s.items[k].sku, fragile: s.items[k].fragile,
        scanned: e.items[k].scanned, packed: e.items[k].loc === 'box',
      })),
      exceptions: s.itemOrder.filter((k) => !s.items[k].onOrder && (e.items[k].scanned || e.items[k].loc === 'exception'))
        .map((k) => ({ name: s.items[k].name, sku: s.items[k].sku, state: e.items[k].loc === 'exception' ? 'diverted' : 'flagged' })),
      carton: e.carton ? `${e.carton} (${s.cartons[e.carton].inner})` : null,
      weight: (e.carton ? e.measuredWeightKg() : 0).toFixed(2),
      range: `${min.toFixed(2)}–${max.toFixed(2)}`,
      sealed: e.sealed,
      confirmed: e.weightConfirmed,
      label: e.labelApplied ? 'APPLIED' : e.labelPrinted ? 'PRINTED' : '--',
    });
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
  }

  /** Local prompt for the current step (station-frame position + text). */
  markerPose() {
    const e = this.engine;
    if (this.app.session.phase !== 'pack' || e.phase !== 'exercise') return null;
    const T = L.tote;
    const C = L.conveyor;
    const P = L.packZone;
    const step = e.step();
    const at = (x, y, z, text) => ({ pos: new THREE.Vector3(x, y, z), text });
    switch (step) {
      case 'open': return at(T.x, T.h + 0.1, T.z + T.d / 2, 'SCAN TOTE LABEL');
      case 'scan': return at(T.x, 0.3, T.z, 'SCAN EACH ITEM');
      case 'exception': return at(L.exception.x, 0.32, L.exception.z, 'EXCEPTION BIN');
      case 'carton': return at(L.slots.xs.M, 0.3, L.slots.z, 'CHOOSE CARTON');
      case 'pack': return at(P.x, 0.4, P.z, 'PACK ITEMS');
      case 'dunnage': return at(L.basket.x, 0.3, L.basket.z, 'VOID FILL');
      case 'seal': return at(L.tape.x, 0.25, L.tape.z, 'TAPE TO SEAL');
      case 'weigh': return at(P.x - 0.22, 0.12, P.z + P.d / 2 + 0.05, 'READ THE SCALE');
      case 'print': return at(L.printer.x, 0.32, L.printer.z, 'PRINT LABEL');
      case 'label': return at(L.printer.x, 0.32, L.printer.z, 'APPLY LABEL');
      case 'outbound': return at(C.x, 0.42, C.intakeZ, 'OUTBOUND');
      case 'release': return at(L.releaseButton.x, 0.24, L.releaseButton.z, 'CONFIRM RELEASE');
      default: return null;
    }
  }
}
