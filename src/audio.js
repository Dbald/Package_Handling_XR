// Sound: effects, ambience and music, each independently switchable. Recorded
// files listed in media/manifest.json replace the built-in synthesized
// placeholders; anything not supplied keeps its placeholder. No music plays
// unless switched on, and every cue also has a text/visual equivalent, so
// muting never hides information (PRD §7).
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.buffers = {};
    this.files = { sfx: {}, ambience: null, music: null };
    this.loops = {};
    this.wantLoops = { ambience: true, music: false };
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.loadFiles();
  }

  /** audio: { sfx: { kind: file }, ambience: file, music: file } from the manifest. */
  setFiles(audio) {
    this.files = { sfx: audio?.sfx ?? {}, ambience: audio?.ambience ?? null, music: audio?.music ?? null };
    if (this.ctx) this.loadFiles();
  }

  async decode(file) {
    const res = await fetch(`media/${file}`);
    if (!res.ok) throw new Error(file);
    return this.ctx.decodeAudioData(await res.arrayBuffer());
  }

  async loadFiles() {
    const jobs = Object.entries(this.files.sfx).map(async ([kind, file]) => {
      try { this.buffers[kind] = await this.decode(file); } catch { /* keep the synth placeholder */ }
    });
    for (const name of ['ambience', 'music']) {
      if (!this.files[name]) continue;
      jobs.push(this.decode(this.files[name]).then((b) => { this.buffers[`loop:${name}`] = b; this.applyLoops(); }).catch(() => {}));
    }
    await Promise.all(jobs);
  }

  /** Turn the looping beds on/off: { ambience, music }. */
  setLoops(want) {
    Object.assign(this.wantLoops, want);
    this.applyLoops();
  }

  applyLoops() {
    if (!this.ctx) return;
    const levels = { ambience: 0.22, music: 0.12 };
    for (const name of ['ambience', 'music']) {
      const on = this.wantLoops[name] && !this.muted && this.buffers[`loop:${name}`];
      const cur = this.loops[name];
      if (on && !cur) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers[`loop:${name}`];
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = levels[name];
        src.connect(g).connect(this.master);
        src.start();
        this.loops[name] = src;
      } else if (!on && cur) {
        cur.stop();
        delete this.loops[name];
      }
    }
  }

  setMuted(m) {
    this.muted = m;
    this.applyLoops();
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
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(kind) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const buf = this.buffers[kind];
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master);
      src.start();
      return;
    }
    // Built-in placeholders until recorded sounds are supplied.
    switch (kind) {
      case 'success': this.tone(660, 0, 0.12); this.tone(990, 0.1, 0.16); break;
      case 'scan': this.tone(1800, 0, 0.09, 'square', 0.04); break;
      case 'error': this.tone(220, 0, 0.22, 'triangle', 0.1); break;
      case 'critical': [0, 0.18, 0.36].forEach((s) => this.tone(180, s, 0.14, 'sawtooth', 0.06)); break;
      case 'warning': this.tone(440, 0, 0.14, 'triangle', 0.07); break;
      case 'click': this.tone(1200, 0, 0.03, 'sine', 0.03); break;
      case 'tape': this.tone(140 + Math.random() * 60, 0, 0.06, 'sawtooth', 0.025); break;
      case 'step': this.tone(784, 0, 0.12, 'sine', 0.05); this.tone(1047, 0.12, 0.2, 'sine', 0.05); break;
      case 'grab': this.tone(320, 0, 0.05, 'triangle', 0.04); break;
      case 'drop': this.tone(150, 0, 0.09, 'sine', 0.07); break;
      case 'print': [0, 0.06, 0.12, 0.18].forEach((s) => this.tone(900, s, 0.04, 'square', 0.02)); break;
      case 'complete': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.1, 0.25, 'sine', 0.06)); break;
      case 'transition': this.tone(300, 0, 0.5, 'sine', 0.03); break;
      case 'noread': this.tone(330, 0, 0.08, 'square', 0.03); this.tone(330, 0.12, 0.08, 'square', 0.03); break;
      default: break;
    }
  }
}
