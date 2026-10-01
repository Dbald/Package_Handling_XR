// Secondary desktop preview: mouse look, click-to-select on the 3D scene,
// keyboard rotation. Every procedural action still goes through
// App.dispatch → ProcedureEngine, exactly like VR input.
import * as THREE from 'three';

const POSTURE_EYE = { standing: 1.62, seated: 1.2 };

export class DesktopInput {
  constructor(app) {
    this.app = app;
    this.el = app.renderer.domElement;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.yaw = 0;
    this.pitch = 0;
    this.drag = null;
    this.hover = null;
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('pointermove', (e) => this.onMove(e));
    this.el.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('pointerleave', () => {
      this.hover = null;
      this.drag = null;
    });
    globalThis.addEventListener('keydown', (e) => this.onKey(e));
  }

  resetCamera() {
    const { camera, settings } = this.app;
    const eye = POSTURE_EYE[settings.posture];
    camera.position.set(0, eye + 0.05, 0.55);
    const target = new THREE.Vector3(0, settings.benchHeight + 0.35, -0.9);
    const d = target.clone().sub(camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.apply();
  }

  apply() {
    this.app.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  setNdc(e) {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.app.camera);
  }

  onDown(e) {
    if (this.app.xr) return;
    this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, moved: false };
    this.el.setPointerCapture?.(e.pointerId);
  }

  onMove(e) {
    if (this.app.xr) return;
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      if (this.drag.moved) {
        this.yaw = this.drag.yaw + dx * 0.004;
        this.pitch = THREE.MathUtils.clamp(this.drag.pitch + dy * 0.004, -1.2, 1.0);
        this.apply();
        return;
      }
    }
    this.setNdc(e);
    this.hover = this.app.pick(this.raycaster);
    const clickable = this.hover && (this.hover.kind !== 'panel' || this.hover.button) && this.hover.kind !== 'tool';
    this.el.style.cursor = clickable ? 'pointer' : 'grab';
  }

  onUp(e) {
    if (this.app.xr) return;
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved) return;
    this.setNdc(e);
    const hit = this.app.pick(this.raycaster);
    if (!hit) return;
    const { app } = this;
    if (hit.kind === 'panel' && hit.button) app.dispatch(hit.button.id, 'desktop');
    else if (hit.kind === 'button') app.dispatch(hit.action, 'desktop');
    else if (hit.kind === 'package') {
      if (app.engine.activePackage() === hit.key) app.dispatch('assist:bring', 'desktop');
      else {
        app.showResult(app.engine.inspect(hit.key, { input: 'desktop' }));
        app.refreshUI();
      }
    } else if (hit.kind === 'pk') {
      app.pack.click(hit.key);
      app.refreshUI();
    } else if (hit.kind === 'practice') {
      app.info('The practice box is for VR grab practice. On desktop, use the buttons.');
      app.refreshUI();
    }
  }

  onKey(e) {
    if (this.app.xr) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const onButton = tag === 'BUTTON';
    switch (e.key) {
      case 'ArrowLeft': if (!onButton) { this.app.nudgeRotation('y', -1); e.preventDefault(); } break;
      case 'ArrowRight': if (!onButton) { this.app.nudgeRotation('y', 1); e.preventDefault(); } break;
      case 'ArrowUp': if (!onButton) { this.app.nudgeRotation('x', -1); e.preventDefault(); } break;
      case 'ArrowDown': if (!onButton) { this.app.nudgeRotation('x', 1); e.preventDefault(); } break;
      case 'h':
      case 'H':
        this.app.toggleHelp();
        break;
      case 'Escape':
        if (this.app.helpOpen) this.app.dispatch('resume', 'desktop');
        break;
      default: break;
    }
  }

  update() {
    this.app.applyHover(this.hover ? [this.hover] : []);
  }
}
