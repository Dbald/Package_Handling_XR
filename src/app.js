// App orchestrator: owns the engine, the scene, world-space UI and the
// XR/desktop lifecycle. Every procedural action goes through the engine;
// animations only ever follow a validated result (PRD §9).
import * as THREE from 'three';
import { ProcedureEngine } from './engine.js';
import { SCENARIO, weightRange } from './scenario.js';
import { buildWorld, LAYOUT, PACKAGE_SIZES } from './scene.js';
import { Panel } from './panel.js';
import { buildMainSpec, buildHelpSpec, markerTarget } from './guidance.js';
import { Sfx } from './audio.js';
import { startXRSession, describeXRError } from './xr-session.js';
import { XRInput } from './xr-input.js';
import { DesktopInput } from './desktop-input.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

const POSTURES = {
  standing: { bench: 0.92, eye: 1.62 },
  seated: { bench: 0.72, eye: 1.2 },
};

export class App {
  constructor({ container, ui }) {
    this.container = container;
    this.ui = ui;
    this.engine = new ProcedureEngine();
    this.sfx = new Sfx();
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.settings = { posture: 'standing', benchHeight: POSTURES.standing.bench, reducedMotion: reduce, muted: false };

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    renderer.xr.setFramebufferScaleFactor(1.0);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x3b4148);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.03, 60);
    this.scene.add(this.camera);

    this.world = buildWorld(SCENARIO);
    this.scene.add(this.world.worldRoot);

    this.mainPanel = new Panel({ width: 1.3, height: 0.86, name: 'main-panel' });
    this.world.station.add(this.mainPanel.mesh);
    this.helpPanel = new Panel({ width: 1.1, height: 1.02, name: 'help-panel' });
    this.helpPanel.mesh.visible = false;
    // Modal: always drawn on top so a held/assisted package can never cover it.
    this.helpPanel.mesh.traverse((o) => {
      o.material.depthTest = false;
      o.renderOrder = o === this.helpPanel.mesh ? 21 : 20;
    });
    this.scene.add(this.helpPanel.mesh);

    this.phys = {};
    this.holders = {};
    this.tweens = [];
    this.feedback = null;
    this.resultsPage = 'summary';
    this.helpOpen = false;
    this.xr = null;
    this.scannerFlash = null;
    this.lastSpecKey = null;
    this.clock = new THREE.Clock();
    this.practiceHint = 0;

    this.xrInput = new XRInput(this);
    this.desktop = new DesktopInput(this);

    this.engine.on((evt) => this.onEngineEvent(evt));
    this.applyHeight();
    this.resetScene();
    this.desktop.resetCamera();
    this.resize();
    globalThis.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      // During a session, XRSession visibility is authoritative (some browsers
      // may report the page hidden while immersive); see enterVR().
      if (this.xr) return;
      if (document.hidden) this.engine.pause('hidden');
      else this.engine.resume('hidden');
      this.refreshUI();
    });
    this.refreshUI();
    renderer.setAnimationLoop((t, frame) => this.frame(frame));
  }

  // ---------------------------------------------------------------- basics

  resize() {
    if (this.renderer.xr.isPresenting) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get station() {
    return this.world.station;
  }

  viewerPose() {
    const cam = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    cam.getWorldPosition(pos);
    cam.getWorldQuaternion(quat);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    return { pos, quat, fwd };
  }

  view() {
    const e = this.engine;
    const active = e.activePackage();
    const holder = active ? this.holders[active] : null;
    return {
      engine: e,
      vr: !!this.xr,
      xrActive: !!this.xr,
      held: holder ? active : null,
      heldBy: holder?.by ?? null,
      onFloor: Object.keys(this.phys).filter((k) => this.phys[k].zone === 'floor'),
      settings: this.settings,
      feedback: this.feedback,
      resultsPage: this.resultsPage,
      needsTrackingForResume: this.needsTrackingForResume(),
    };
  }

  needsTrackingForResume() {
    if (!this.xr) return false;
    return this.xr.visibility !== 'visible' || !this.xrInput.anyConnected();
  }

  refreshUI() {
    const view = this.view();
    const main = buildMainSpec(view);
    const help = this.helpOpen ? buildHelpSpec(view) : null;
    const key = JSON.stringify([main, help]);
    if (key !== this.lastSpecKey) {
      this.lastSpecKey = key;
      this.mainPanel.setContent(main);
      if (help) this.helpPanel.setContent(help);
    }
    this.ui.render({
      main,
      help,
      results: this.engine.phase === 'complete' ? this.engine.results() : null,
      paused: this.engine.isPaused(),
      xrActive: !!this.xr,
    });
  }

  // -------------------------------------------------------------- feedback

  showResult(r, { controller = null } = {}) {
    if (!r || r.silent || !r.message) return;
    this.feedback = { tone: r.tone, text: r.message };
    const sound = { success: 'success', error: 'error', critical: 'critical', warning: 'warning' }[r.tone];
    if (sound) this.sfx.play(sound);
    const pulses = { success: [0.3, 60], error: [0.6, 140], critical: [1.0, 300], warning: [0.5, 100] }[r.tone];
    if (pulses) {
      const targets = controller ? [controller] : this.xrInput.controllers;
      for (const c of targets) this.xrInput.haptic(c, ...pulses);
    }
  }

  info(message, tone = 'info') {
    this.showResult({ tone, message });
  }

  onEngineEvent(evt) {
    if (evt.type === 'phase') {
      if (evt.phase === 'exercise') {
        this.dropPractice();
        this.world.practice.visible = false;
      }
      if (evt.phase === 'complete') this.resultsPage = 'summary';
    }
    this.refreshUI();
  }

  // --------------------------------------------------------------- actions

  /** Single entry point for panel buttons (VR ray, mouse, HTML, keyboard). */
  dispatch(id, input = 'desktop', controller = null) {
    this.sfx.unlock();
    this.sfx.play('click');
    const e = this.engine;
    const key = e.activePackage();
    const ctx = { input: input === 'xr' ? 'xr-assisted' : input };
    const [verb, arg] = id.split(':');
    let r = null;
    switch (verb) {
      case 'condition': r = e.submitCondition(key, arg, ctx); break;
      case 'decide': r = e.decide(key, arg, ctx); break;
      case 'weight': r = e.confirmWeight(key, arg, ctx); break;
      case 'release': r = this.confirmRelease(ctx); break;
      case 'assist': r = this.assist(arg, key, ctx); break;
      case 'retrieve': this.retrieve(key); break;
      case 'place': r = this.assistPlace(key, arg, ctx); break;
      case 'scan': r = this.assistScan(key, ctx); break;
      case 'help': this.toggleHelp(true); break;
      case 'resume': this.tryResume(); break;
      case 'restart':
      case 'replay': this.restart(); break;
      case 'exitvr': this.xr?.session.end().catch(() => {}); break;
      case 'posture': this.setPosture(arg); break;
      case 'height': this.adjustHeight(arg === 'up' ? 0.03 : -0.03); break;
      case 'recenter': this.recenter(); break;
      case 'continue': r = e.startBriefing(); break;
      case 'start': r = e.startExercise(); break;
      case 'toggle':
        if (arg === 'motion') this.settings.reducedMotion = !this.settings.reducedMotion;
        if (arg === 'sound') this.sfx.muted = this.settings.muted = !this.settings.muted;
        break;
      case 'results': this.resultsPage = arg; break;
      default: break;
    }
    if (r) this.showResult(r, { controller });
    this.refreshUI();
    return r;
  }

  confirmRelease(ctx) {
    const key = this.engine.activePackage();
    if (!key) return null;
    const def = SCENARIO.packages[key];
    if (def.condition !== 'intact' || !this.engine.stateAtLeast(key, 'accepted')) {
      return { tone: 'info', message: 'Nothing is staged on the outbound conveyor.' };
    }
    const r = this.engine.release(key, ctx);
    if (r.ok && r.code === 'RELEASED') {
      const p = this.world.packages[key];
      this.phys[key].zone = 'released';
      const end = new THREE.Vector3(LAYOUT.conveyor.x, p.group.position.y, LAYOUT.conveyor.endZ);
      this.tween(p.group, { pos: end, quat: IDENTITY, dur: 3.2, ease: 'linear', conveyor: true });
    }
    return r;
  }

  assist(verb, key, ctx) {
    if (!key) return null;
    const p = this.world.packages[key];
    if (verb === 'bring') {
      const r = this.engine.inspect(key, ctx);
      if (!r.ok) return r;
      this.detachFromHand(key);
      if (this.engine.packageState(key) === 'staged') this.engine.place(key, 'bench', ctx);
      const { pos, fwd } = this.viewerPose();
      const target = pos.clone().addScaledVector(fwd, this.xr ? 0.45 : 0.5).add(v1.set(0, this.xr ? -0.3 : -0.2, 0));
      if (this.xr) target.addScaledVector(v2.crossVectors(fwd, UP), -0.1);
      this.station.worldToLocal(target);
      // Face the label toward the viewer.
      const yaw = Math.atan2(-fwd.x, -fwd.z) - this.worldYaw();
      const quat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
      this.tween(p.group, { pos: target, quat, dur: 0.45 });
      this.holders[key] = { by: 'assist' };
      this.phys[key].zone = 'assist';
      return r;
    }
    if (verb === 'return') {
      this.detachFromHand(key);
      this.holders[key] = null;
      this.engine.place(key, 'bench', ctx);
      this.snapTo(key, 'bench');
      return null;
    }
    if (verb === 'rotate' || verb === 'flip') {
      if (this.holders[key]?.by !== 'assist') return null;
      const axis = verb === 'rotate' ? UP : RIGHT;
      const quat = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2).multiply(p.group.quaternion);
      this.tween(p.group, { quat, dur: 0.3 });
      return null;
    }
    return null;
  }

  /** Desktop arrow keys: small rotation steps of the assisted package. */
  nudgeRotation(axisName, sign) {
    const key = this.engine.activePackage();
    if (!key || this.holders[key]?.by !== 'assist') return;
    const g = this.world.packages[key].group;
    const axis = axisName === 'y' ? UP : RIGHT;
    g.quaternion.premultiply(q1.setFromAxisAngle(axis, sign * (Math.PI / 12)));
  }

  assistPlace(key, zone, ctx) {
    if (!key) return null;
    const r = this.engine.place(key, zone, ctx);
    if (r.ok || r.returnToBench === false) {
      this.detachFromHand(key);
      this.holders[key] = null;
      this.snapTo(key, zone);
    }
    return r;
  }

  assistScan(key, ctx) {
    if (!key) return null;
    const r = this.engine.scan(key, { aligned: true }, ctx);
    this.afterScan(r);
    if (r.ok) {
      this.detachFromHand(key);
      const p = this.world.packages[key];
      const Z = LAYOUT.scanZone;
      const quat = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
      const anchor = p.barcodeAnchor.position.clone().applyQuaternion(quat);
      const pos = new THREE.Vector3(Z.x, Z.y, Z.z).sub(anchor);
      this.tween(p.group, { pos, quat, dur: 0.45 });
      this.holders[key] = { by: 'assist' };
      this.phys[key].zone = 'assist';
    }
    return r;
  }

  afterScan(r) {
    if (r.code === 'SCANNED' || r.code === 'ALREADY') {
      this.scannerFlash = { ok: true, until: performance.now() + 1500 };
      this.sfx.play('scan');
    } else if (r.code === 'NO_READ') {
      this.scannerFlash = { ok: false, until: performance.now() + 1500 };
    }
  }

  retrieve(key) {
    if (!key) return;
    this.holders[key] = null;
    this.snapTo(key, 'bench');
    this.info(`${SCENARIO.packages[key].label} is back on the inspection mat. No penalty.`);
  }

  // ------------------------------------------------------- hand interaction

  /** Called by XRInput when a controller squeezes on a grabbable. */
  tryGrab(key, controller, far) {
    const e = this.engine;
    if (key === 'practice') {
      if (!this.world.practice.visible) return false;
      this.attachToHand('practice', this.world.practice, controller, far);
      if (this.practiceHint === 0) {
        this.practiceHint = 1;
        this.info('Grab works. Release GRIP to let go.', 'success');
      }
      return true;
    }
    if (e.phase !== 'exercise') {
      this.info(e.phase === 'complete'
        ? 'The exercise is complete. Select Replay to start again.'
        : 'Start the exercise first. During setup, practise with the grey box.');
      this.xrInput.haptic(controller, 0.4, 80);
      this.refreshUI();
      return false;
    }
    const r = e.inspect(key, { input: 'xr' });
    if (!r.ok) {
      this.showResult(r, { controller });
      this.refreshUI();
      return false;
    }
    this.showResult(r, { controller });
    if (e.packageState(key) === 'staged') e.place(key, 'bench', { input: 'xr' });
    this.detachFromHand(key);
    this.holders[key] = { by: 'hand', controller };
    this.phys[key].zone = 'held';
    this.attachToHand(key, this.world.packages[key].group, controller, far);
    this.refreshUI();
    return true;
  }

  attachToHand(key, obj, controller, far) {
    this.cancelTweens(obj);
    controller.grip.attach(obj);
    controller.held = key;
    if (far) {
      const depth = key === 'practice' ? 0.14 : PACKAGE_SIZES[key][2];
      this.tween(obj, { pos: new THREE.Vector3(0, -0.02, -(0.05 + depth / 2)), dur: 0.25 });
    }
    this.xrInput.haptic(controller, 0.35, 40);
  }

  /** Controller let go of whatever it held. */
  releaseFromHand(controller, input = 'xr') {
    const key = controller.held;
    if (!key) return;
    controller.held = null;
    if (key === 'practice') {
      const obj = this.world.practice;
      this.station.attach(obj);
      this.restOrDrop('practice', obj, 0.14);
      if (this.practiceHint === 1) {
        this.practiceHint = 2;
        this.info('Released. Now point at a button and pull TRIGGER to press it.', 'success');
        this.refreshUI();
      }
      return;
    }
    const p = this.world.packages[key];
    this.holders[key] = null;
    this.station.attach(p.group);
    const center = p.group.position;
    const zone = this.zoneAt(center);
    if (zone) {
      const r = this.engine.place(key, zone, { input });
      if (r.ok || r.returnToBench === false) this.snapTo(key, zone);
      else this.snapTo(key, 'bench');
      this.showResult(r, { controller });
    } else {
      this.engine.place(key, 'bench', { input });
      this.restOrDrop(key, p.group, p.size[1]);
    }
    this.refreshUI();
  }

  /** Tracking lost / controller gone: freeze the held item where it is. */
  freezeHeld(controller, reason) {
    const key = controller.held;
    if (!key) return;
    controller.held = null;
    const obj = key === 'practice' ? this.world.practice : this.world.packages[key].group;
    this.station.attach(obj);
    if (key !== 'practice') {
      this.holders[key] = null;
      this.phys[key].zone = 'frozen';
    }
    this.info(reason === 'tracking'
      ? 'Controller tracking lost — the item is held in place. Grab it again when your controller is visible.'
      : 'Controller disconnected — the item is held in place. Nothing was dropped or scored.', 'warning');
    this.refreshUI();
  }

  detachFromHand(key) {
    for (const c of this.xrInput.controllers) {
      if (c.held === key) {
        c.held = null;
        const obj = key === 'practice' ? this.world.practice : this.world.packages[key].group;
        this.station.attach(obj);
      }
    }
  }

  dropPractice() {
    for (const c of this.xrInput.controllers) if (c.held === 'practice') this.detachFromHand('practice');
  }

  zoneAt(pos) {
    for (const [name, z] of Object.entries(this.world.zones)) {
      if (pos.x >= z.min.x && pos.x <= z.max.x && pos.y >= z.min.y && pos.y <= z.max.y && pos.z >= z.min.z && pos.z <= z.max.z) {
        return name;
      }
    }
    return null;
  }

  overBench(pos) {
    const B = LAYOUT.bench;
    return pos.x >= B.x0 && pos.x <= B.x1 && pos.z >= B.z0 && pos.z <= B.z1 && pos.y > -0.05;
  }

  uprightYaw(obj) {
    const e = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ');
    return new THREE.Quaternion().setFromAxisAngle(UP, e.y);
  }

  /** Released outside any target: rest on the bench, or fall to the floor. */
  restOrDrop(key, obj, height) {
    const pos = obj.position.clone();
    const quat = this.uprightYaw(obj);
    if (this.overBench(pos)) {
      pos.y = height / 2;
      this.tween(obj, { pos, quat, dur: 0.25, ease: 'in' });
      if (key !== 'practice') this.phys[key].zone = 'bench';
      return;
    }
    pos.y = -this.settings.benchHeight + height / 2;
    this.tween(obj, { pos, quat, dur: 0.4, ease: 'in' });
    if (key === 'practice') {
      setTimeout(() => {
        this.world.practice.position.copy(this.practiceHome());
        this.world.practice.quaternion.identity();
      }, 1200);
      this.info('The practice box fell and is being returned. Dropping things is never penalised.');
    } else {
      this.phys[key].zone = 'floor';
      this.info(`${SCENARIO.packages[key].label} was dropped — no penalty. Select Retrieve package to bring it back.`);
    }
    this.refreshUI();
  }

  slotFor(key, zone) {
    const size = PACKAGE_SIZES[key];
    if (zone === 'bench') return new THREE.Vector3(LAYOUT.mat.x, size[1] / 2, LAYOUT.mat.z);
    if (zone === 'incoming') return new THREE.Vector3(LAYOUT.incoming.x, size[1] / 2, LAYOUT.incoming.z);
    return this.world.zones[zone].slot(size);
  }

  snapTo(key, zone) {
    const p = this.world.packages[key];
    if (p.group.parent !== this.station) this.station.attach(p.group);
    this.tween(p.group, { pos: this.slotFor(key, zone), quat: IDENTITY, dur: 0.3 });
    this.phys[key].zone = zone;
  }

  practiceHome() {
    return new THREE.Vector3(LAYOUT.scale.x, LAYOUT.scale.top + 0.07, LAYOUT.scale.z);
  }

  /** Where is the barcode relative to the scanner target? */
  scanAlignment(key) {
    const p = this.world.packages[key];
    if (!p) return { near: false, aligned: false };
    const Z = LAYOUT.scanZone;
    const zc = v2.set(Z.x, Z.y, Z.z);
    const a = p.barcodeAnchor.getWorldPosition(new THREE.Vector3());
    this.station.worldToLocal(a);
    const inside = Math.abs(a.x - Z.x) <= Z.w / 2 + 0.02 && Math.abs(a.y - Z.y) <= Z.h / 2 + 0.02 && Math.abs(a.z - Z.z) <= Z.d / 2 + 0.03;
    const n = new THREE.Vector3(0, 0, 1).transformDirection(p.barcodeAnchor.matrixWorld);
    const stationQ = this.station.getWorldQuaternion(new THREE.Quaternion()).invert();
    n.applyQuaternion(stationQ);
    const facing = n.z < -0.45;
    const c = p.group.getWorldPosition(new THREE.Vector3());
    this.station.worldToLocal(c);
    const near = c.distanceTo(zc) < 0.42;
    return { near, inside, facing, aligned: inside && facing };
  }

  /** Controller trigger while holding a package near the scanner. */
  handScan(key, controller) {
    const a = this.scanAlignment(key);
    const r = this.engine.scan(key, { aligned: a.aligned }, { input: 'xr' });
    if (r.code === 'NO_READ') {
      r.message = !a.inside
        ? 'No read — move the barcode label into the green SCAN ZONE, then press TRIGGER.'
        : 'No read — the barcode is facing away. Turn the label toward the scanner window, then press TRIGGER.';
    }
    this.afterScan(r);
    this.showResult(r, { controller });
    this.refreshUI();
  }

  // ------------------------------------------------------------ help/pause

  toggleHelp(open = !this.helpOpen) {
    this.helpOpen = open;
    this.helpPanel.mesh.visible = open;
    if (open) {
      this.engine.pause('menu');
      const { pos, fwd } = this.viewerPose();
      const dist = this.xr ? 0.95 : 1.15;
      this.helpPanel.mesh.position.copy(pos).addScaledVector(fwd, dist).add(v1.set(0, -0.12, 0));
      this.helpPanel.mesh.lookAt(pos.x, this.helpPanel.mesh.position.y, pos.z);
    } else {
      this.engine.resume('menu');
    }
    this.lastSpecKey = null;
    this.refreshUI();
  }

  tryResume() {
    if (this.needsTrackingForResume()) {
      this.info('Waiting for controller tracking. Resume becomes available when a controller is tracked.', 'warning');
      return;
    }
    if (this.helpOpen) this.toggleHelp(false);
    const wasPaused = this.engine.isPaused();
    this.engine.resume();
    if (wasPaused) this.info('Resumed. Scoring and the timer are running again.');
  }

  // --------------------------------------------------------------- comfort

  setPosture(p) {
    if (!POSTURES[p]) return;
    this.settings.posture = p;
    this.settings.benchHeight = POSTURES[p].bench;
    this.applyHeight();
    if (!this.xr) this.desktop.resetCamera();
    else this.applyFloorOffset();
  }

  adjustHeight(delta) {
    this.settings.benchHeight = THREE.MathUtils.clamp(+(this.settings.benchHeight + delta).toFixed(3), 0.6, 1.12);
    this.applyHeight();
  }

  applyHeight() {
    const H = this.settings.benchHeight;
    this.station.position.y = H;
    const P = LAYOUT.panel;
    this.mainPanel.mesh.position.set(P.x, this.settings.posture === 'seated' ? P.seatedY : P.standingY, P.z);
    for (const key of Object.keys(this.phys)) {
      if (this.phys[key].zone === 'floor') this.world.packages[key].group.position.y = -H + PACKAGE_SIZES[key][1] / 2;
    }
  }

  worldYaw() {
    return this.world.worldRoot.rotation.y;
  }

  applyFloorOffset() {
    const root = this.world.worldRoot;
    root.position.y = this.xr && !this.xr.floor ? -POSTURES[this.settings.posture].eye : 0;
  }

  recenter() {
    const root = this.world.worldRoot;
    if (!this.xr) {
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      this.desktop.resetCamera();
      return;
    }
    const cam = this.renderer.xr.getCamera();
    const pos = cam.getWorldPosition(new THREE.Vector3());
    const quat = cam.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    // Held items live in controller space, so moving the world never drops them.
    root.rotation.set(0, yaw, 0);
    root.position.set(pos.x, 0, pos.z);
    this.applyFloorOffset();
    this.lastSpecKey = null;
    if (this.helpOpen) this.toggleHelp(true);
  }

  // --------------------------------------------------------------- session

  restart() {
    for (const c of this.xrInput.controllers) c.held = null;
    this.helpOpen = false;
    this.helpPanel.mesh.visible = false;
    this.engine.reset();
    this.resetScene();
    if (this.xr) this.recenter();
    else this.desktop.resetCamera();
    this.feedback = { tone: 'info', text: 'New session started. Everything has been reset.' };
    this.lastSpecKey = null;
    this.refreshUI();
  }

  resetScene() {
    this.tweens = [];
    for (const key of SCENARIO.order) {
      const p = this.world.packages[key];
      this.station.attach(p.group);
      const zone = key === SCENARIO.order[0] ? 'bench' : 'incoming';
      p.group.position.copy(this.slotFor(key, zone));
      p.group.quaternion.identity();
      p.group.visible = true;
      this.phys[key] = { zone };
      this.holders[key] = null;
    }
    const practice = this.world.practice;
    this.station.attach(practice);
    practice.position.copy(this.practiceHome());
    practice.quaternion.identity();
    practice.visible = true;
    this.practiceHint = 0;
    this.scannerFlash = null;
    this.feedback = null;
    this.resultsPage = 'summary';
  }

  async enterVR() {
    this.sfx.unlock();
    if (this.xr) return;
    let result;
    try {
      result = await startXRSession(this.renderer);
    } catch (err) {
      this.ui.showXRError(describeXRError(err));
      return;
    }
    const { session, floor } = result;
    this.xr = { session, floor, visibility: session.visibilityState ?? 'visible' };
    this.engine.resume('hidden');
    this.applyFloorOffset();
    this.pendingRecenter = 3;
    session.addEventListener('visibilitychange', () => {
      if (!this.xr) return;
      this.xr.visibility = session.visibilityState;
      if (session.visibilityState !== 'visible') {
        this.engine.pause('xr-visibility');
        for (const c of this.xrInput.controllers) if (c.held) this.freezeHeld(c, 'tracking');
      }
      this.refreshUI();
    });
    session.addEventListener('end', () => this.onXREnd());
    this.ui.setMode('xr');
    this.lastSpecKey = null;
    this.refreshUI();
  }

  onXREnd() {
    for (const c of this.xrInput.controllers) if (c.held) this.freezeHeld(c, 'disconnect');
    this.xr = null;
    this.engine.resume('hidden');
    if (document.hidden) this.engine.pause('hidden');
    this.engine.resume('input');
    this.engine.resume('xr-visibility');
    if (this.engine.phase === 'exercise') this.engine.pause('xr-exit');
    const root = this.world.worldRoot;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    if (this.helpOpen) this.toggleHelp(false);
    this.desktop.resetCamera();
    this.resize();
    this.ui.setMode('desktop');
    this.lastSpecKey = null;
    this.refreshUI();
  }

  // ---------------------------------------------------------------- tweens

  tween(obj, { pos = null, quat = null, dur = 0.3, ease = 'out', conveyor = false, onDone = null }) {
    this.cancelTweens(obj);
    if (this.settings.reducedMotion || dur <= 0) {
      if (pos) obj.position.copy(pos);
      if (quat) obj.quaternion.copy(quat);
      onDone?.();
      return;
    }
    this.tweens.push({
      obj, pos: pos?.clone(), quat: quat?.clone(), p0: obj.position.clone(), q0: obj.quaternion.clone(),
      t: 0, dur, ease, conveyor, onDone,
    });
  }

  cancelTweens(obj) {
    this.tweens = this.tweens.filter((t) => t.obj !== obj);
  }

  updateTweens(dt) {
    let belt = false;
    this.tweens = this.tweens.filter((tw) => {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = tw.ease === 'in' ? k * k : tw.ease === 'linear' ? k : 1 - (1 - k) ** 3;
      if (tw.pos) tw.obj.position.lerpVectors(tw.p0, tw.pos, e);
      if (tw.quat) tw.obj.quaternion.slerpQuaternions(tw.q0, tw.quat, e);
      if (tw.conveyor) belt = true;
      if (k >= 1) {
        tw.onDone?.();
        return false;
      }
      return true;
    });
    if (belt && !this.settings.reducedMotion) this.world.belt.offset.y -= dt * 0.9;
  }

  // ------------------------------------------------------------ per frame

  pickables(exclude = null) {
    if (this.helpOpen) return [this.helpPanel.mesh, this.mainPanel.mesh];
    const list = [this.mainPanel.mesh];
    for (const key of SCENARIO.order) {
      if (exclude !== key && this.phys[key].zone !== 'held') list.push(this.world.packages[key].mesh);
    }
    if (this.world.practice.visible && exclude !== 'practice') list.push(this.world.practice.children[0]);
    list.push(this.world.releaseBtn, this.world.plate, this.world.scannerHead);
    return list;
  }

  pick(raycaster, exclude = null) {
    const hits = raycaster.intersectObjects(this.pickables(exclude), false);
    for (const h of hits) {
      const o = h.object;
      if (!o.visible) continue;
      if (o.userData.panel) {
        const button = o.userData.panel.hitTest(h.uv);
        return { kind: 'panel', panel: o.userData.panel, button, distance: h.distance, point: h.point };
      }
      const ud = o.userData;
      if (ud.kind === 'package') return { kind: 'package', key: ud.key, label: ud.label, object: o, distance: h.distance, point: h.point };
      if (ud.kind === 'practice') return { kind: 'practice', key: 'practice', label: ud.label, object: o, distance: h.distance, point: h.point };
      if (ud.kind === 'button') return { kind: 'button', action: ud.action, label: ud.label, object: o, distance: h.distance, point: h.point };
      if (ud.kind === 'tool') return { kind: 'tool', label: ud.label, object: o, distance: h.distance, point: h.point };
    }
    return null;
  }

  /** hovers: array of pick results (+ near-grab results) from all pointers. */
  applyHover(hovers) {
    const panelHover = new Map();
    const hot = new Set();
    let tagTarget = null;
    for (const h of hovers) {
      if (!h) continue;
      if (h.kind === 'panel') {
        if (h.button && !panelHover.has(h.panel)) panelHover.set(h.panel, h.button.id);
      } else {
        hot.add(h.object ?? h.key);
        if (!tagTarget) tagTarget = h;
      }
    }
    for (const panel of [this.mainPanel, this.helpPanel]) panel.setHover(panelHover.get(panel) ?? null);
    for (const key of SCENARIO.order) {
      const p = this.world.packages[key];
      const on = hot.has(p.mesh) || hot.has(key);
      for (const m of p.mats) m.emissive.setHex(on ? 0x3a3020 : 0x000000);
    }
    const pm = this.world.practice.children[0];
    pm.material.emissive.setHex(hot.has(pm) || hot.has('practice') ? 0x333333 : 0);
    this.world.releaseBtn.material.emissive.setHex(hot.has(this.world.releaseBtn) ? 0x1f5a36 : 0);

    const tag = this.world.hoverTag;
    if (tagTarget) {
      const obj = tagTarget.object ?? (tagTarget.key === 'practice' ? this.world.practice : this.world.packages[tagTarget.key]?.group);
      const label = tagTarget.zoneLabel ?? tagTarget.label ?? obj?.userData?.label;
      if (obj && label) {
        obj.getWorldPosition(v1);
        v1.y += 0.2;
        this.world.worldRoot.worldToLocal(v1);
        tag.mesh.position.copy(v1);
        const { pos } = this.viewerPose();
        tag.mesh.lookAt(pos);
        tag.set(label);
        return;
      }
    }
    tag.set(null);
  }

  updateInstruments(now) {
    const { scaleScreen, scannerScreen, scanZone } = this.world;
    const B = SCENARIO.packages.B;
    const { min, max } = weightRange(B);
    const onScale = SCENARIO.order.find((k) => this.phys[k].zone === 'scale');
    const range = { text: `EXPECTED ${min.toFixed(2)}–${max.toFixed(2)} kg`, size: 28, color: '#cfe8da' };
    if (onScale && SCENARIO.packages[onScale].measuredWeightKg) {
      const st = this.engine.packageState(onScale);
      const confirmed = this.engine.stateAtLeast(onScale, 'weight_confirmed');
      scaleScreen.show([
        { text: `${SCENARIO.packages[onScale].measuredWeightKg.toFixed(2)} kg`, size: 70, bold: true },
        range,
        { text: confirmed ? 'CONFIRMED: IN RANGE' : st === 'weighed' ? 'CONFIRM ON PANEL' : 'STABLE', size: 26, color: confirmed ? '#9dffc9' : '#ffd97a' },
      ]);
    } else {
      scaleScreen.show([{ text: '0.00 kg', size: 70, bold: true, color: '#6fae8c' }, range, { text: 'READY', size: 26, color: '#6fae8c' }]);
    }
    const flash = this.scannerFlash && this.scannerFlash.until > now ? this.scannerFlash : null;
    const scanned = this.engine.stateAtLeast('B', 'scanned') && this.engine.phase !== 'setup';
    if (flash && !flash.ok) {
      scannerScreen.show([{ text: 'NO READ', size: 44, bold: true, color: '#ffb36b' }, { text: 'align barcode in zone', size: 24, color: '#ffb36b' }], { bg: '#1a0e05' });
    } else if (scanned) {
      scannerScreen.show([{ text: 'SCAN OK', size: 40, bold: true }, { text: B.id, size: 30 }]);
    } else {
      scannerScreen.show([{ text: 'READY', size: 44, bold: true, color: '#9fc7ff' }, { text: 'present barcode', size: 26, color: '#9fc7ff' }], { bg: '#070d18' });
    }
    // Scan-zone feedback: bright when a held barcode is aligned or just scanned.
    let aligned = false;
    for (const c of this.xrInput.controllers) {
      if (c.held && c.held !== 'practice' && this.scanAlignment(c.held).aligned) aligned = true;
    }
    const glow = aligned || (flash && flash.ok);
    scanZone.fill.material.opacity = glow ? 0.25 : 0.08;
    scanZone.edges.material.color.setHex(glow ? 0xb6ffd6 : 0x39d98a);
  }

  updateMarker(t) {
    const { marker, markerTag } = this.world;
    const m = !this.engine.isPaused() ? markerTarget(this.engine) : null;
    if (!m) {
      marker.visible = false;
      return;
    }
    const C = LAYOUT.conveyor;
    const S = LAYOUT.scale;
    const Z = LAYOUT.scanZone;
    const T = LAYOUT.tote;
    const R = LAYOUT.releaseButton;
    let pos;
    if (m.target.startsWith('package:')) {
      const key = m.target.split(':')[1];
      if (this.holders[key]) {
        marker.visible = false;
        return;
      }
      const g = this.world.packages[key].group;
      g.getWorldPosition(v1);
      this.station.worldToLocal(v1);
      pos = v1.clone().add(v2.set(0, PACKAGE_SIZES[key][1] / 2 + 0.1, 0));
    } else {
      pos = {
        quarantine: new THREE.Vector3(T.x, 0.46, T.z),
        scanZone: new THREE.Vector3(Z.x, Z.y + Z.h / 2 + 0.1, Z.z),
        scale: new THREE.Vector3(S.x, 0.36, S.z),
        scaleScreen: new THREE.Vector3(S.x - 0.25, 0.1, S.z + S.d / 2 + 0.05),
        outbound: new THREE.Vector3(C.x, 0.42, C.intakeZ),
        releaseButton: new THREE.Vector3(R.x, 0.24, R.z),
      }[m.target];
    }
    if (!this.settings.reducedMotion) pos.y += Math.sin(t * 3) * 0.012;
    marker.position.copy(pos);
    marker.visible = true;
    markerTag.set(m.text);
    const { pos: eye } = this.viewerPose();
    markerTag.mesh.lookAt(eye);
  }

  updateShadows() {
    const H = this.settings.benchHeight;
    for (const key of SCENARIO.order) {
      const p = this.world.packages[key];
      p.group.getWorldPosition(v1);
      this.station.worldToLocal(v1);
      const zone = this.phys[key].zone;
      let surface;
      if (zone === 'quarantine') surface = 0.021;
      else if (zone === 'scale') surface = LAYOUT.scale.top;
      else if (zone === 'outbound' || zone === 'released') surface = LAYOUT.conveyor.top + 0.001;
      else if (this.overBench(v1)) surface = 0.001;
      else surface = -H + 0.004;
      const lift = Math.max(0, v1.y - p.size[1] / 2 - surface);
      p.shadow.position.set(v1.x, surface + 0.002, v1.z);
      p.shadow.material.opacity = 0.35 * THREE.MathUtils.clamp(1 - lift / 0.6, 0.15, 1);
      p.shadow.visible = p.group.visible;
    }
  }

  frame(xrFrame) {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    const now = performance.now();
    this.updateTweens(dt);
    if (this.xr) {
      if (this.pendingRecenter > 0 && --this.pendingRecenter === 0) this.recenter();
      this.xrInput.update(dt, xrFrame);
    } else {
      this.desktop.update(dt);
    }
    this.updateInstruments(now);
    this.updateMarker(t);
    this.updateShadows();
    this.mainPanel.update();
    if (this.helpOpen) this.helpPanel.update();
    this.renderer.render(this.scene, this.camera);
  }
}
