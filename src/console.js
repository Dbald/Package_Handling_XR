// Work-instruction console: the main panel mounted in a physical display
// (bezel, floor stand, brand strip, status light) so instructions read as a
// piece of station equipment, not a floating sheet. The light bar pulses with
// a chime whenever the task changes, pulling attention back to it.
import * as THREE from 'three';
import { textTexture } from './textures.js';
import { mergeStatic } from './merge.js';

const DIM = new THREE.Color(0x4a3a12);
const BRIGHT = new THREE.Color(0xffc23d);

export class InstructionConsole {
  constructor(panel) {
    const w = panel.wm;
    const h = panel.hm;
    this.group = new THREE.Group();
    this.group.name = 'instruction-console';
    this.group.add(panel.mesh);

    const shell = new THREE.MeshLambertMaterial({ color: 0x1b1e23 });
    const steel = new THREE.MeshLambertMaterial({ color: 0x4b535c });
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.09, h + 0.14, 0.06), shell);
    bezel.position.set(0, -0.015, -0.035);
    this.group.add(bezel);
    // Floor stand: two uprights behind the screen (they run below the floor
    // so they never float when the bench height changes) and a cross brace.
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.4, 0.05), steel);
      post.position.set(sx * (w / 2 - 0.12), -h / 2 - 1.15, -0.09);
      this.group.add(post);
    }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.04, 0.03), steel);
    brace.position.set(0, -h / 2 - 0.35, -0.09);
    this.group.add(brace);

    // Brand strip on the lower bezel.
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.05),
      new THREE.MeshBasicMaterial({ map: textTexture('DEVINCI GLOBAL · WORK INSTRUCTIONS', { w: 1024, h: 82, font: 'bold 44px system-ui', bg: '#1b1e23', fg: '#aab4bf' }), toneMapped: false }));
    strip.position.set(-0.05, -h / 2 - 0.05, 0.0);
    this.group.add(strip);
    this.led = new THREE.Mesh(new THREE.CircleGeometry(0.009, 16), new THREE.MeshBasicMaterial({ color: 0x39d98a }));
    this.led.position.set(w / 2 - 0.02, -h / 2 - 0.05, 0.001);
    this.group.add(this.led);

    // Attention light bar along the top edge.
    this.lightMat = new THREE.MeshBasicMaterial({ color: DIM.clone(), toneMapped: false });
    this.light = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.016, 0.012), this.lightMat);
    this.light.position.set(0, h / 2 + 0.035, 0.0);
    this.group.add(this.light);
    this.pulseUntil = 0;
    mergeStatic(this.group); // uprights + brace share a material: one draw call
  }

  /** Flash the light bar (task changed / needs attention). */
  pulse(now, ms = 1800) {
    this.pulseUntil = now + ms;
  }

  update(now, reducedMotion) {
    const left = this.pulseUntil - now;
    if (left > 0) {
      // Three slow pulses; steady bright under reduced motion.
      const k = reducedMotion ? 1 : 0.5 + 0.5 * Math.cos(((1800 - left) / 600) * Math.PI * 2);
      this.lightMat.color.copy(DIM).lerp(BRIGHT, k);
    } else {
      this.lightMat.color.copy(DIM).lerp(BRIGHT, 0.35);
    }
  }
}

/**
 * Optional frame-time readout (append ?perf to the URL): fps, average and
 * worst frame over the last second, shown under the console. For checking the
 * 72 Hz budget on the headset without external tools.
 */
export class PerfMeter {
  constructor(consoleObj, Tag) {
    this.tag = new Tag({ width: 0.5, height: 0.05 });
    this.tag.mesh.material.depthTest = true;
    this.tag.mesh.position.set(0, -consoleObj.group.children[0].geometry.parameters.height / 2 - 0.12, 0.01);
    consoleObj.group.add(this.tag.mesh);
    this.tag.set('measuring…');
    this.last = null;
    this.windowStart = null;
    this.frames = 0;
    this.sum = 0;
    this.worst = 0;
    this.slow = 0;
  }

  sample(now) {
    if (this.last !== null) {
      const dt = now - this.last;
      this.frames++;
      this.sum += dt;
      this.worst = Math.max(this.worst, dt);
      if (dt > 15.5) this.slow++; // over a 72 Hz frame (13.9 ms) plus slack
    }
    this.last = now;
    if (this.windowStart === null) this.windowStart = now;
    if (now - this.windowStart >= 1000 && this.frames) {
      const avg = this.sum / this.frames;
      const pct = Math.round((1 - this.slow / this.frames) * 100);
      this.tag.set(`${Math.round(1000 / avg)} fps · avg ${avg.toFixed(1)} ms · worst ${this.worst.toFixed(0)} ms · ${pct}% on time`, {
        accent: pct >= 95 ? '#2fae66' : '#e0762b',
      });
      this.windowStart = now;
      this.frames = this.sum = this.worst = this.slow = 0;
    }
  }
}
