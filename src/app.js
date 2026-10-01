// App orchestrator: owns the session (Station 1 Pack-Out → Station 2 Dock
// Check), the scene, world-space UI and the XR/desktop lifecycle. Every
// procedural action goes through a station engine; animations only ever
// follow a validated result (PRD §9). `this.engine` is the Station 2 engine.
import * as THREE from 'three';
import { Session } from './session.js';
import { PackStation, PACK_BASE } from './pack/station.js';
import { PACK_LAYOUT } from './pack/scene.js';
import { SCENARIO, weightRange } from './scenario.js';
import { buildWorld, LAYOUT, PACKAGE_SIZES } from './scene.js';
import { brandTexture } from './textures.js';
import { Panel, Tag } from './panel.js';
import { buildMainSpec, buildHelpSpec, markerTarget } from './guidance.js';
import { Sfx } from './audio.js';
import { brief } from './copy.js';
import { VideoPlayer, loadManifest } from './media.js';
import { mergeStatic } from './merge.js';
import { InstructionConsole, PerfMeter } from './console.js';
import { startXRSession, describeXRError } from './xr-session.js';
import { XRInput } from './xr-input.js';
import { DesktopInput } from './desktop-input.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

const DOCK_BASE = new THREE.Vector3(0, 0, 0);

const POSTURES = {
  standing: { bench: 0.92, eye: 1.62 },
  seated: { bench: 0.72, eye: 1.2 },
};

export class App {
  constructor({ container, ui }) {
    this.container = container;
    this.ui = ui;
    this.session = new Session();
    this.engine = this.session.dock;
    this.sfx = new Sfx();
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.settings = { posture: 'standing', benchHeight: POSTURES.standing.bench, reducedMotion: reduce, muted: false, ambience: true, music: false };
    this.assistOpen = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    // Quest 2 reported smooth at 1.0; spend that headroom on sharpness.
    renderer.xr.setFramebufferScaleFactor(1.25);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x3b4148);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.03, 60);
    this.scene.add(this.camera);

    this.world = buildWorld(SCENARIO);
    this.scene.add(this.world.worldRoot);

    this.mainPanel = new Panel({ width: 1.3, height: 0.86, name: 'main-panel' });
    this.console = new InstructionConsole(this.mainPanel);
    this.video = new VideoPlayer(this, this.console);
    // "PULL TRIGGER" sign over the Station 2 scan zone, lit while a label is lined up.
    this.scanPrompt = new Tag({ width: 0.26, height: 0.058 });
    this.scanPrompt.set('PULL TRIGGER', { accent: '#39d98a', bg: 'rgba(8,40,22,0.95)' });
    this.scanPrompt.mesh.visible = false;
    this.world.station.add(this.scanPrompt.mesh);
    this.scanPrompt.mesh.position.set(LAYOUT.scanZone.x, LAYOUT.scanZone.y + LAYOUT.scanZone.h / 2 + 0.09, LAYOUT.scanZone.z);
    loadManifest().then((m) => {
      this.video.setFiles(m.videos);
      this.sfx.setFiles(m.audio);
      this.lastSpecKey = null;
      this.refreshUI();
    });
    if (new URLSearchParams(globalThis.location?.search ?? '').has('perf')) this.perf = new PerfMeter(this.console, Tag);
    this.helpPanel = new Panel({ width: 1.1, height: 1.02, name: 'help-panel' });
    this.helpPanel.mesh.visible = false;
    // Modal: always drawn on top so a held/assisted package can never cover it.
    this.helpPanel.setOnTop(20);
    this.scene.add(this.helpPanel.mesh);

    // VR entry intro: fade up from dark behind a brief title card. Nothing in
    // the world moves, so it stays comfortable (PRD §7).
    this.fade = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x0b0e12, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.fade.renderOrder = 998;
    this.fade.visible = false;
    this.introTitle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.2),
      new THREE.MeshBasicMaterial({ map: brandTexture(SCENARIO.org, SCENARIO.title), transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.introTitle.renderOrder = 999;
    this.introTitle.visible = false;
    this.scene.add(this.fade, this.introTitle);
    this.intro = null;

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
    this.pack = new PackStation(this);
    this.world.worldRoot.add(this.pack.group);
    // Batch static scenery into fewer draw calls (Quest 2 frame budget).
    this.mergedMeshes = mergeStatic(this.world.worldRoot);
    this.transition = null;

    for (const src of [this.session, this.session.pack, this.session.dock]) src.on((evt) => this.onEngineEvent(evt));
    this.placeMainPanel();
    this.applyHeight();
    this.resetScene();
    this.recenter();
    this.resize();
    globalThis.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      // During a session, XRSession visibility is authoritative (some browsers
      // may report the page hidden while immersive); see enterVR().
      if (this.xr) return;
      if (document.hidden) this.session.pause('hidden');
      else this.session.resume('hidden');
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

  /**
   * Head pose, computed at most once per frame and reused (no per-call
   * allocations: garbage-collection pauses cause visible hitches in VR).
   * Callers must treat the returned vectors as read-only.
   */
  viewerPose() {
    if (this.poseCache && this.poseCache.frame === this.frameNo) return this.poseCache;
    const pc = this.poseCache ?? (this.poseCache = {
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fwd: new THREE.Vector3(), frame: -1,
    });
    const cam = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    cam.getWorldPosition(pc.pos);
    cam.getWorldQuaternion(pc.quat);
    pc.fwd.set(0, 0, -1).applyQuaternion(pc.quat);
    pc.fwd.y = 0;
    if (pc.fwd.lengthSq() < 1e-6) pc.fwd.set(0, 0, -1);
    pc.fwd.normalize();
    pc.frame = this.frameNo;
    return pc;
  }

  view() {
    const e = this.engine;
    const active = e.activePackage();
    const holder = active ? this.holders[active] : null;
    return {
      engine: e,
      session: this.session,
      packStation: this.pack,
      vr: !!this.xr,
      xrActive: !!this.xr,
      held: holder ? active : null,
      heldBy: holder?.by ?? null,
      assistOpen: this.assistOpen,
      videos: this.video?.available,
      video: this.video?.current ?? null,
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
    // New task → pulse the console light and chime, so attention returns to it.
    const step = main.stepId ?? null;
    if (step && step !== this.lastStep) {
      this.console.pulse(performance.now());
      if (this.lastStep) this.sfx.play('step');
      this.sfx.play(`vo:${step}`); // optional recorded voice line for this step
    }
    this.lastStep = step;
    if (key !== this.lastSpecKey) {
      this.lastSpecKey = key;
      this.mainPanel.setContent(main);
      if (help) this.helpPanel.setContent(help);
    }
    this.ui.render({
      main,
      help,
      results: this.session.phase === 'complete' ? this.session.results() : null,
      paused: this.session.isPaused(),
      xrActive: !!this.xr,
    });
  }

  // -------------------------------------------------------------- feedback

  showResult(r, { controller = null } = {}) {
    if (!r || r.silent || !r.message) return;
    // Headset shows a headline + one line; the full message stays for desktop/screen readers.
    const b = r.title ? { title: r.title, text: r.message } : brief(this.stationKey, r);
    this.feedback = { tone: r.tone, title: b.title, text: b.text, full: r.message };
    // A recorded coaching clip for this mistake plays once per session, if supplied.
    if (r.code && ['error', 'critical', 'warning'].includes(r.tone)) this.video?.maybeCoach(`${this.stationKey}:${r.code}`);
    // Event sounds (recorded files from media/manifest.json; most are silent until supplied).
    const evSound = {
      PRINTED: 'print', NO_READ: 'noread', CARTON_OK: 'fold', DUNNAGE: 'pillow', LABELLED: 'label',
      RELEASED: 'conveyor', DIVERTED: 'bin', QUARANTINED: 'bin', SCANNED: 'scan', ITEM_OK: 'scan',
      NOT_ON_ORDER: 'scan', ORDER_OPEN: 'scan', SEALED: 'tapeEnd',
    }[r.code];
    if (evSound) this.sfx.play(evSound);
    const sound = { success: 'success', error: 'error', critical: 'critical', warning: 'warning' }[r.tone];
    if (sound) this.sfx.play(sound);
    const pulses = { success: [0.3, 60], error: [0.6, 140], critical: [1.0, 300], warning: [0.5, 100] }[r.tone];
    if (pulses) {
      const targets = controller ? [controller] : this.xrInput.controllers;
      for (const c of targets) this.xrInput.haptic(c, ...pulses);
    }
  }

  /** App-level hint: short `title` + one short line. */
  info(message, tone = 'info', title = null) {
    this.showResult({ tone, message, title: title ?? undefined });
  }

  onEngineEvent(evt) {
    if (evt.type === 'phase' && evt.phase === 'exercise') {
      this.dropPractice();
      this.world.practice.visible = false;
    }
    if (evt.type === 'phase' || evt.type === 'action') this.session.sync();
    if (evt.type === 'session-phase' && evt.phase === 'complete') this.resultsPage = 'summary';
    if (evt.type === 'session-phase' && evt.phase === 'briefing' && this.video.has('intro') && !this.video.shown.has('intro')) {
      this.video.play('intro'); // intro outlining the three goals, once per session
    }
    if (evt.type === 'phase' && evt.phase === 'complete') this.sfx.play('complete');
    this.refreshUI();
  }

  get stationKey() {
    return this.session.stationKey;
  }

  activeStationGroup() {
    return this.stationKey === 'pack' ? this.pack.group : this.world.station;
  }

  stationBase() {
    return this.stationKey === 'pack' ? PACK_BASE : DOCK_BASE;
  }

  placeMainPanel() {
    const group = this.activeStationGroup();
    const con = this.console.group;
    if (con.parent !== group) group.add(con);
    const P = this.stationKey === 'pack' ? PACK_LAYOUT.panel : LAYOUT.panel;
    con.position.set(P.x, this.settings.posture === 'seated' ? P.seatedY : P.standingY, P.z);
    const marker = this.world.marker;
    if (marker.parent !== group) group.add(marker);
  }

  /** Fade out, run `fn` (e.g. move to another station), fade back in. */
  fadeTransition(fn) {
    this.sfx.play('transition');
    this.endIntro();
    this.transition = { t: 0, fn, fired: false };
    this.fade.material.opacity = 0;
    this.fade.visible = true;
  }

  updateTransition(dt) {
    const tr = this.transition;
    if (!tr) return;
    tr.t += dt;
    const { pos } = this.viewerPose();
    this.fade.position.copy(pos);
    const out = 0.45;
    const total = 1.1;
    if (tr.t < out) {
      this.fade.material.opacity = tr.t / out;
    } else {
      if (!tr.fired) {
        tr.fired = true;
        tr.fn();
      }
      this.fade.material.opacity = Math.max(0, 1 - (tr.t - out) / (total - out));
    }
    if (tr.t >= total) {
      this.fade.visible = false;
      this.transition = null;
    }
  }

  goToDock(skip) {
    if (!this.session.toDock({ skip })) return null;
    for (const c of this.xrInput.controllers) if (c.held) this.freezeHeld(c, 'move');
    this.world.practice.visible = false;
    this.fadeTransition(() => {
      this.placeMainPanel();
      this.recenter();
    });
    return { tone: 'info', message: 'Station 2 · Dock Check. Read the briefing, then start.' };
  }

  /** Station 1 again with the next order configuration. */
  replayPack() {
    if (this.session.phase !== 'pack') return null;
    for (const c of this.xrInput.controllers) if (c.held && c.held.startsWith('pk:')) this.freezeHeld(c, 'move');
    this.packOrder = (this.packOrder ?? 0) + 1;
    this.pack.setOrder(this.packOrder);
    this.session.replayPack();
    const o = this.pack.s.order;
    return { tone: 'info', message: `New order ${o.id} in tote ${o.tote}. Pick up the scanner and open it.` };
  }

  /** What the controller-attached hint should say for this hand, or null. */
  controllerHint(c) {
    const held = c.held;
    const go = { accent: '#39d98a', bg: 'rgba(8,40,22,0.95)', pulse: true };
    if (held === 'pk:scanner') return { text: 'TRIGGER = SCAN' };
    if (held === 'pk:tape') return this.pack.tape.active === c ? { text: 'DRAG ALONG THE TOP' } : { text: 'HOLD TRIGGER + DRAG' };
    if (held && this.world.packages[held] && this.stationKey === 'dock' && this.engine.packageState(held) === 'accepted') {
      const a = this.scanAlignment(held);
      if (a.aligned) return { text: 'PULL TRIGGER TO SCAN', ...go, tick: true };
      if (a.inside) return { text: 'TURN LABEL TO SCANNER' };
      return { text: 'LABEL INTO GREEN ZONE' };
    }
    if (!held && c.near && this.session.phase !== 'complete') return { text: 'GRIP = GRAB' };
    return null;
  }

  /** Trigger released while holding something (continuous tools like the tape gun). */
  onHeldTriggerEnd(c) {
    if (c.held && c.held.startsWith('pk:')) this.pack.onTriggerEnd(c);
  }

  objFor(key) {
    if (key === 'practice') return this.world.practice;
    if (key.startsWith('pk:')) return this.pack.objFor(key);
    return this.world.packages[key]?.group ?? null;
  }

  /** [key, object] pairs a hand can grab right now. */
  grabCandidates() {
    const out = [];
    if (this.world.practice.visible) out.push(['practice', this.world.practice]);
    if (this.stationKey === 'pack') out.push(...this.pack.grabCandidates());
    else for (const [k, p] of Object.entries(this.world.packages)) out.push([k, p.group]);
    return out;
  }

  /** Trigger pressed while holding something. Returns true when consumed. */
  onHeldTrigger(c) {
    if (!c.held || c.held === 'practice') return false;
    if (c.held.startsWith('pk:')) return this.pack.onTrigger(c);
    if (this.scanAlignment(c.held).near) {
      this.handScan(c.held, c);
      return true;
    }
    return false;
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
    if (verb === 'pk') {
      const [, v, a] = id.split(':');
      r = this.pack.dispatch(v, a, ctx);
      if (r) this.showResult(r, { controller });
      this.refreshUI();
      return r;
    }
    switch (verb) {
      case 'condition': r = e.submitCondition(key, arg, ctx); break;
      case 'decide': r = e.decide(key, arg, ctx); break;
      case 'weight': r = e.confirmWeight(key, arg, ctx); break;
      case 'release': r = this.stationKey === 'pack' ? this.pack.confirmRelease(ctx) : this.confirmRelease(ctx); break;
      case 'assist':
        if (arg === 'toggle') this.assistOpen = !this.assistOpen;
        else r = this.assist(arg, key, ctx);
        break;
      case 'video':
        if (arg === 'skip') this.video.stop();
        else if (arg === 'replay') this.video.replay();
        else this.video.play(arg);
        break;
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
      case 'continue': this.session.toBriefing(); break;
      case 'start': r = this.session.startDock(); break;
      case 'station':
        if (arg === 'pack') r = this.session.startPack();
        else if (arg === 'replay-pack') r = this.replayPack();
        else r = this.goToDock(arg === 'skip');
        break;
      case 'toggle':
        if (arg === 'motion') this.settings.reducedMotion = !this.settings.reducedMotion;
        if (arg === 'sound') {
          this.settings.muted = !this.settings.muted;
          this.sfx.setMuted(this.settings.muted);
          this.video.el.muted = this.settings.muted;
        }
        if (arg === 'ambience' || arg === 'music') {
          this.settings[arg] = !this.settings[arg];
          this.sfx.setLoops({ ambience: this.settings.ambience, music: this.settings.music });
        }
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
    this.info('No penalty.', 'info', 'Back on the mat');
  }

  // ------------------------------------------------------- hand interaction

  /** Called by XRInput when a controller squeezes on a grabbable. */
  tryGrab(key, controller, far) {
    const e = this.engine;
    if (key.startsWith('pk:')) return this.pack.tryGrab(key, controller, far);
    if (key === 'practice') {
      if (!this.world.practice.visible) return false;
      this.attachToHand('practice', this.world.practice, controller, far);
      if (this.practiceHint === 0) {
        this.practiceHint = 1;
        this.info('Let go of GRIP to drop it.', 'success', 'Grab works!');
      }
      return true;
    }
    if (e.phase !== 'exercise') {
      if (e.phase === 'complete') this.info('Select Replay to go again.', 'info', 'All done');
      else this.info('Press Start on the screen first.', 'info', 'Not started');
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
    this.sfx.play('grab');
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
    if (key.startsWith('pk:')) {
      this.pack.release(controller);
      return;
    }
    controller.held = null;
    if (key === 'practice') {
      const obj = this.world.practice;
      this.pack.group.attach(obj);
      this.restOrDrop('practice', obj, 0.14);
      if (this.practiceHint === 1) {
        this.practiceHint = 2;
        this.info('Point at a button, pull TRIGGER.', 'success', 'Nice!');
        this.refreshUI();
      }
      return;
    }
    const p = this.world.packages[key];
    this.holders[key] = null;
    this.station.attach(p.group);
    this.sfx.play('drop');
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
    const obj = this.objFor(key);
    if (key.startsWith('pk:')) {
      this.pack.group.attach(obj);
      this.pack.loc[key] = 'frozen';
    } else if (key === 'practice') {
      this.pack.group.attach(obj);
    } else {
      this.station.attach(obj);
    }
    if (key !== 'practice' && !key.startsWith('pk:')) {
      this.holders[key] = null;
      this.phys[key].zone = 'frozen';
    }
    if (reason === 'move') return;
    if (reason === 'tracking') this.info('It\u2019s held in place. Grab it again.', 'warning', 'Tracking lost');
    else this.info('Item held in place. Nothing scored.', 'warning', 'Controller lost');
    this.refreshUI();
  }

  detachFromHand(key) {
    for (const c of this.xrInput.controllers) {
      if (c.held === key) {
        c.held = null;
        const obj = this.objFor(key);
        (key === 'practice' || key.startsWith('pk:') ? this.pack.group : this.station).attach(obj);
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
      this.info('No penalty. It\u2019s coming back.', 'info', 'Dropped');
    } else {
      this.phys[key].zone = 'floor';
      this.info('No penalty. Select Retrieve package.', 'info', 'Dropped');
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

  /** Practice box sits on the Station 1 pack scale during setup. */
  practiceHome() {
    const P = PACK_LAYOUT.packZone;
    return new THREE.Vector3(P.x, P.top + 0.07, P.z);
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
      this.session.pause('menu');
      const { pos, fwd } = this.viewerPose();
      const dist = this.xr ? 0.95 : 1.15;
      this.helpPanel.mesh.position.copy(pos).addScaledVector(fwd, dist).add(v1.set(0, -0.12, 0));
      this.helpPanel.mesh.lookAt(pos.x, this.helpPanel.mesh.position.y, pos.z);
    } else {
      this.session.resume('menu');
    }
    this.lastSpecKey = null;
    this.refreshUI();
  }

  tryResume() {
    if (this.needsTrackingForResume()) {
      this.info('Pick up a controller to resume.', 'warning', 'Waiting');
      return;
    }
    if (this.helpOpen) this.toggleHelp(false);
    const wasPaused = this.session.isPaused();
    this.session.resume();
    if (wasPaused) this.info('Scoring is running again.', 'info', 'Resumed');
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
    if (this.pack) this.pack.group.position.y = H;
    this.placeMainPanel();
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
    const base = this.stationBase();
    if (!this.xr) {
      root.position.set(-base.x, 0, -base.z);
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
    // The active station's standing spot lands under the learner's head.
    root.rotation.set(0, yaw, 0);
    const offset = base.clone().applyAxisAngle(UP, yaw);
    root.position.set(pos.x - offset.x, 0, pos.z - offset.z);
    this.applyFloorOffset();
    this.lastSpecKey = null;
    if (this.helpOpen) this.toggleHelp(true);
  }

  // --------------------------------------------------------------- session

  restart() {
    for (const c of this.xrInput.controllers) c.held = null;
    this.helpOpen = false;
    this.helpPanel.mesh.visible = false;
    if (this.video.current) this.video.stop();
    this.video.shown.clear();
    this.session.reset();
    this.resetScene();
    this.packOrder = 0;
    this.pack.setOrder(0);
    this.placeMainPanel();
    this.recenter();
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
    this.pack.group.attach(practice);
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
    this.session.resume('hidden');
    this.applyFloorOffset();
    this.pendingRecenter = 3;
    this.intro = { t: 0, placed: false };
    this.fade.material.opacity = 1;
    this.fade.visible = true;
    session.addEventListener('visibilitychange', () => {
      if (!this.xr) return;
      this.xr.visibility = session.visibilityState;
      if (session.visibilityState !== 'visible') {
        this.session.pause('xr-visibility');
        for (const c of this.xrInput.controllers) if (c.held) this.freezeHeld(c, 'tracking');
      }
      this.refreshUI();
    });
    session.addEventListener('end', () => this.onXREnd());
    this.ui.setMode('xr');
    this.lastSpecKey = null;
    this.refreshUI();
  }

  updateIntro(dt) {
    const intro = this.intro;
    if (!intro) return;
    const { pos, fwd } = this.viewerPose();
    this.fade.position.copy(pos);
    if (!intro.placed) {
      // Wait for the first recenter so the title appears straight ahead.
      if (this.pendingRecenter > 0) return;
      intro.placed = true;
      this.introTitle.position.copy(pos).addScaledVector(fwd, 1.6);
      this.introTitle.lookAt(pos.x, this.introTitle.position.y, pos.z);
      this.introTitle.visible = true;
    }
    intro.t += dt;
    const t = intro.t;
    const smooth = (a, b, x) => {
      const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
      return k * k * (3 - 2 * k);
    };
    this.introTitle.material.opacity = smooth(0, 0.4, t) * (1 - smooth(1.2, 1.7, t));
    this.fade.material.opacity = 1 - smooth(0.9, 2.2, t);
    if (t >= 2.2) {
      this.fade.visible = false;
      this.introTitle.visible = false;
      this.intro = null;
    }
  }

  endIntro() {
    this.intro = null;
    this.fade.visible = false;
    this.introTitle.visible = false;
  }

  onXREnd() {
    this.endIntro();
    for (const c of this.xrInput.controllers) if (c.held) this.freezeHeld(c, 'disconnect');
    this.xr = null;
    this.session.resume('hidden');
    if (document.hidden) this.session.pause('hidden');
    this.session.resume('input');
    this.session.resume('xr-visibility');
    if (['pack', 'dock'].includes(this.session.phase)) this.session.pause('xr-exit');
    this.transition = null;
    if (this.helpOpen) this.toggleHelp(false);
    this.recenter();
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
    if (this.stationKey === 'pack') {
      if (this.world.practice.visible && exclude !== 'practice') list.push(this.world.practice.children[0]);
      list.push(...this.pack.pickables());
      return list;
    }
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
      if (ud.kind === 'pk') return { kind: 'pk', key: ud.key, label: ud.label, object: o, distance: h.distance, point: h.point };
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
        if (h.object) hot.add(h.object);
        if (h.key) hot.add(h.key);
        if (h.action) hot.add(h.action);
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
    this.pack.setHover(hot);

    const tag = this.world.hoverTag;
    if (tagTarget) {
      const obj = tagTarget.object ?? (tagTarget.key ? this.objFor(tagTarget.key) : null);
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

  updateInstruments(now, slow = true) {
    const { scaleScreen, scannerScreen, scanZone } = this.world;
    const B = SCENARIO.packages.B;
    const flash = this.scannerFlash && this.scannerFlash.until > now ? this.scannerFlash : null;
    // Scan-zone feedback (per frame): bright when a held barcode is aligned or just scanned.
    let aligned = false;
    if (this.stationKey === 'dock') {
      for (const c of this.xrInput.controllers) {
        if (c.held && this.world.packages[c.held] && this.scanAlignment(c.held).aligned) aligned = true;
      }
    }
    const glow = aligned || (flash && flash.ok);
    this.scanPrompt.mesh.visible = aligned;
    if (aligned) this.scanPrompt.mesh.lookAt(this.viewerPose().pos);
    scanZone.fill.material.opacity = glow ? 0.25 : 0.08;
    scanZone.edges.material.color.setHex(glow ? 0xb6ffd6 : 0x39d98a);
    if (!slow) return;
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
    const scanned = this.engine.stateAtLeast('B', 'scanned') && this.engine.phase !== 'setup';
    if (flash && !flash.ok) {
      scannerScreen.show([{ text: 'NO READ', size: 44, bold: true, color: '#ffb36b' }, { text: 'align barcode in zone', size: 24, color: '#ffb36b' }], { bg: '#1a0e05' });
    } else if (scanned) {
      scannerScreen.show([{ text: 'SCAN OK', size: 40, bold: true }, { text: B.id, size: 30 }]);
    } else {
      scannerScreen.show([{ text: 'READY', size: 44, bold: true, color: '#9fc7ff' }, { text: 'present barcode', size: 26, color: '#9fc7ff' }], { bg: '#070d18' });
    }
  }

  updateMarker(t) {
    const { marker, markerTag } = this.world;
    if (this.stationKey === 'pack') {
      const pm = !this.session.isPaused() ? this.pack.markerPose() : null;
      marker.visible = !!pm;
      if (!pm) return;
      if (!this.settings.reducedMotion) pm.pos.y += Math.sin(t * 3) * 0.012;
      marker.position.copy(pm.pos);
      markerTag.set(pm.text);
      markerTag.mesh.lookAt(this.viewerPose().pos);
      return;
    }
    const m = !this.session.isPaused() && this.session.phase === 'dock' ? markerTarget(this.engine) : null;
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
    this.frameNo = (this.frameNo ?? 0) + 1;
    this.perf?.sample(now);
    this.updateTweens(dt);
    if (this.xr) {
      if (this.pendingRecenter > 0 && --this.pendingRecenter === 0) this.recenter();
      this.xrInput.update(dt, xrFrame);
      this.updateIntro(dt);
    } else {
      this.desktop.update(dt);
    }
    this.updateTransition(dt);
    // Instrument screens only need ~10 Hz; per-frame work stays minimal.
    const slow = now - (this.lastSlow ?? 0) > 100;
    if (slow) this.lastSlow = now;
    this.updateInstruments(now, slow);
    this.pack.update(now, slow);
    this.updateMarker(t);
    this.updateShadows();
    this.mainPanel.update();
    this.console.update(now, this.settings.reducedMotion);
    if (this.helpOpen) this.helpPanel.update();
    this.renderer.render(this.scene, this.camera);
  }
}
