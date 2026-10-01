// Tracked-controller input: grip grabs/releases, trigger selects and scans,
// thumbstick rotates a held package, B/Y opens help. Either hand can do
// everything (PRD §7). Hand tracking is not assumed.
import * as THREE from 'three';

const tmp = new THREE.Vector3();
const box = new THREE.Box3();
const NEAR_GRAB = 0.06;
const LOST_FRAMES = 20; // ≈0.28 s at 72 Hz before freezing a held item

function controllerVisual(handedness) {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x262b31 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.11, 14), dark);
  body.rotation.x = -Math.PI / 2 + 0.55;
  body.position.set(0, -0.02, 0.035);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.036, 0.006, 8, 28),
    new THREE.MeshLambertMaterial({ color: handedness === 'left' ? 0x4a9be0 : 0xe0a526 }),
  );
  ring.position.set(0, 0.012, -0.03);
  ring.rotation.x = 0.35;
  const grabDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.013, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  g.add(body, ring, grabDot);
  g.userData.grabDot = grabDot;
  return g;
}

export class XRInput {
  constructor(app) {
    this.app = app;
    this.controllers = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 6;
    const { renderer, scene } = app;
    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
      const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      cursor.visible = false;
      ray.add(line);
      scene.add(ray, grip, cursor);
      const c = {
        index: i, ray, grip, line, cursor, source: null, connected: false, handedness: null,
        held: null, lostFrames: 0, prev: [], hover: null, near: null, visual: null,
      };
      ray.addEventListener('connected', (e) => this.onConnected(c, e.data));
      ray.addEventListener('disconnected', () => this.onDisconnected(c));
      ray.addEventListener('selectstart', () => this.onSelect(c));
      ray.addEventListener('selectend', () => this.app.onHeldTriggerEnd(c));
      ray.addEventListener('squeezestart', () => this.onSqueeze(c));
      ray.addEventListener('squeezeend', () => this.onSqueezeEnd(c));
      this.controllers.push(c);
    }
  }

  anyConnected() {
    return this.controllers.some((c) => c.connected);
  }

  haptic(c, intensity, ms) {
    try {
      c?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
    } catch {
      /* haptics are optional; text feedback always carries the message */
    }
  }

  onConnected(c, source) {
    if (!source || source.hand || source.targetRayMode !== 'tracked-pointer') return;
    c.source = source;
    c.connected = true;
    c.handedness = source.handedness;
    if (c.visual) c.grip.remove(c.visual);
    c.visual = controllerVisual(source.handedness);
    c.grip.add(c.visual);
    c.prev = [];
    const { app } = this;
    const reasons = app.session.pauseReasons;
    if (reasons.has('input') || reasons.has('xr-visibility')) {
      app.info('Controller tracking is back. Select Resume when you are ready.');
    }
    app.refreshUI();
  }

  onDisconnected(c) {
    const wasConnected = c.connected;
    c.connected = false;
    c.source = null;
    c.cursor.visible = false;
    // Defer: when the session itself ends, three.js disconnects controllers
    // before our 'end' handler runs. Only a mid-session loss should pause.
    setTimeout(() => {
      const { app } = this;
      if (!app.xr || !wasConnected) return;
      if (c.held) app.freezeHeld(c, 'disconnect');
      app.session.pause('input');
      app.refreshUI();
    }, 0);
  }

  onSelect(c) {
    const { app } = this;
    app.sfx.unlock();
    if (!c.connected) return;
    if (c.held && app.onHeldTrigger(c)) return;
    const h = c.hover;
    if (!h) return;
    if (h.kind === 'panel' && h.button) {
      this.haptic(c, 0.25, 25);
      app.dispatch(h.button.id, 'xr', c);
    } else if (h.kind === 'button') {
      this.haptic(c, 0.25, 25);
      app.dispatch(h.action, 'xr', c);
    } else if (h.kind === 'pk') {
      if (h.key === 'pk:printer') app.dispatch('pk:print', 'xr', c);
      else if (h.key.startsWith('pk:') && app.pack.itemKey(h.key)) app.pack.dispatch('pick', app.pack.itemKey(h.key));
      app.refreshUI();
    } else if (h.kind === 'package' && app.engine.phase === 'exercise') {
      const r = app.engine.inspect(h.key, { input: 'xr' });
      app.showResult(r, { controller: c });
      app.refreshUI();
    }
  }

  onSqueeze(c) {
    if (!c.connected || c.held) return;
    const h = c.hover;
    const farOk = h && (h.kind === 'package' || h.kind === 'practice' || (h.kind === 'pk' && h.key !== 'pk:printer' && h.key !== 'pk:tote'));
    const target = c.near ?? (farOk ? { key: h.key, far: true } : null);
    if (!target) return;
    this.app.tryGrab(target.key, c, !!target.far);
  }

  onSqueezeEnd(c) {
    if (c.held) this.app.releaseFromHand(c, 'xr');
  }

  nearest(c) {
    const { app } = this;
    c.grip.getWorldPosition(tmp);
    let best = null;
    let bestD = NEAR_GRAB;
    for (const [key, obj] of app.grabCandidates()) {
      if (!obj.visible || this.controllers.some((o) => o.held === key)) continue;
      // A snap can happen earlier in the same frame; refresh the whole chain first.
      obj.updateWorldMatrix(true, true);
      box.setFromObject(obj);
      const d = box.distanceToPoint(tmp);
      if (d <= bestD) {
        bestD = d;
        best = key;
      }
    }
    return best ? { key: best, far: false } : null;
  }

  update(dt) {
    const { app } = this;
    const hovers = [];
    let heldZone = null;
    for (const c of this.controllers) {
      if (!c.connected) {
        c.hover = null;
        c.near = null;
        continue;
      }
      // Tracking loss while holding: freeze the item in place, never drop it.
      if (c.held) {
        if (!c.grip.visible) {
          if (++c.lostFrames > LOST_FRAMES) app.freezeHeld(c, 'tracking');
        } else {
          c.lostFrames = 0;
        }
      }
      // Ray hover.
      if (c.ray.visible) {
        this.raycaster.setFromXRController(c.ray);
        const hit = app.pick(this.raycaster, c.held);
        c.hover = hit;
        const len = hit ? hit.distance : 1.2;
        c.line.scale.z = len;
        const actionable = hit && ((hit.kind === 'panel' && hit.button) || hit.kind !== 'panel');
        c.line.material.color.setHex(actionable ? 0xe0a526 : 0xffffff);
        c.cursor.visible = !!hit;
        if (hit) c.cursor.position.copy(hit.point);
        c.line.visible = !c.held;
      } else {
        c.hover = null;
        c.cursor.visible = false;
      }
      c.near = c.held ? null : this.nearest(c);
      if (c.visual) c.visual.userData.grabDot.material.opacity = c.near ? 0.95 : 0.35;
      const nearKind = !c.near ? null : c.near.key === 'practice' ? 'practice' : c.near.key.startsWith('pk:') ? 'pk' : 'package';
      hovers.push(c.near ? { kind: nearKind, key: c.near.key } : c.hover);

      if (c.held && c.held.startsWith('pk:')) {
        const zoneLabel = app.pack.zoneLabelFor(c.held);
        if (zoneLabel) hovers.push({ kind: 'zone', key: c.held, zoneLabel, object: app.objFor(c.held) });
      } else if (c.held && c.held !== 'practice') {
        const g = app.world.packages[c.held].group;
        g.getWorldPosition(tmp);
        app.station.worldToLocal(tmp);
        const z = app.zoneAt(tmp);
        if (z) heldZone = z;
        if (z) hovers.push({ kind: 'zone', key: c.held, zoneLabel: `Release: ${app.world.zones[z].label}`, object: g });
      }
      this.pollGamepad(c, dt);
    }
    // Drop targets highlight while a package is held; the hovered one brightens.
    const anyHeld = this.controllers.some((c) => c.held && c.held !== 'practice' && !c.held.startsWith('pk:'));
    for (const [name, z] of Object.entries(app.world.zones)) {
      z.highlight.group.visible = anyHeld;
      const hot = heldZone === name;
      z.highlight.fill.material.opacity = hot ? 0.18 : 0.04;
      z.highlight.edges.material.opacity = hot ? 1 : 0.3;
    }
    // A held package's zone label takes precedence over other hovers.
    const zoneHover = hovers.find((h) => h && h.kind === 'zone');
    app.applyHover(zoneHover ? [zoneHover, ...hovers.filter((h) => h !== zoneHover)] : hovers);
  }

  pollGamepad(c, dt) {
    const gp = c.source?.gamepad;
    if (!gp) return;
    const pressed = gp.buttons.map((b) => b.pressed);
    // B / Y (xr-standard index 5): help & pause.
    if (pressed[5] && !c.prev[5]) this.app.toggleHelp();
    c.prev = pressed;
    if (!c.held) return;
    const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] ?? 0;
    const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] ?? 0;
    const obj = this.app.objFor(c.held);
    const dead = 0.25;
    if (Math.abs(ax) > dead) obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ax * 2.6 * dt));
    if (Math.abs(ay) > dead) obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ay * 2.6 * dt));
  }
}
