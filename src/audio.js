// Optional, independently mutable sound cues. No music. Every cue also has a
// text/visual equivalent, so muting never hides information (PRD §7).
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AC) this.ctx = new AC();
  }

  tone(freq, start, dur, type = 'sine', gain = 0.08) {
    const { ctx } = this;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = ctx.currentTime + start;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(kind) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    switch (kind) {
      case 'success': this.tone(660, 0, 0.12); this.tone(990, 0.1, 0.16); break;
      case 'scan': this.tone(1800, 0, 0.09, 'square', 0.04); break;
      case 'error': this.tone(220, 0, 0.22, 'triangle', 0.1); break;
      case 'critical': [0, 0.18, 0.36].forEach((s) => this.tone(180, s, 0.14, 'sawtooth', 0.06)); break;
      case 'warning': this.tone(440, 0, 0.14, 'triangle', 0.07); break;
      case 'click': this.tone(1200, 0, 0.03, 'sine', 0.03); break;
      case 'tape': this.tone(140 + Math.random() * 60, 0, 0.06, 'sawtooth', 0.025); break;
      case 'step': this.tone(784, 0, 0.12, 'sine', 0.05); this.tone(1047, 0.12, 0.2, 'sine', 0.05); break;
      default: break;
    }
  }
}
