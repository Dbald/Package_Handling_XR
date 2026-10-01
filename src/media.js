// Recorded media: intro / coaching videos on the console screen and optional
// audio files. Everything is declared in media/manifest.json, so adding a
// recording is "drop the file in, list it" — no code change. Missing media is
// simply skipped (videos) or replaced by built-in synthesized sounds (audio).
import * as THREE from 'three';

export const VIDEO_TRIGGERS = {
  // Played automatically the first time this happens in a session.
  intro: 'Shift briefing opens',
  'dock-intro': 'Station 2 briefing (button)',
  'pack:ORDER_NOT_OPEN': 'Handled items before scanning the tote',
  'pack:WRONG_ITEM': 'Tried to pack the item not on the order',
  'pack:SCAN_FIRST': 'Packed an item without scanning it',
  'pack:CARTON_WRONG': 'Chose the wrong carton size',
  'pack:NEEDS_DUNNAGE': 'Tried to seal a fragile item without void fill',
  'pack:MISSING_ITEMS': 'Tried to seal before packing everything',
  'pack:TOTE_NOT_CLEAR': 'Tried to seal with the extra item still in the tote',
  'pack:PRINT_EARLY': 'Printed the label before confirming weight',
  'pack:WEIGHT_WRONG': 'Misread the scale',
  'pack:PREMATURE_RELEASE': 'Tried to ship an unfinished carton',
  'pack:NO_READ': 'Scanner did not read (how to scan)',
  'dock:CONDITION_WRONG': 'Misjudged damaged vs intact',
  'dock:ACCEPTED_DAMAGED': 'Accepted the damaged package',
  'dock:REJECTED_INTACT': 'Rejected the intact package',
  'dock:DAMAGED_OUTBOUND': 'Sent the damaged package outbound',
  'dock:SCAN_FIRST': 'Weighed before scanning',
  'dock:NO_READ': 'Scan zone did not read (how to scan)',
  'dock:WEIGHT_WRONG': 'Misread the scale',
  'dock:PREMATURE_RELEASE': 'Tried to ship before scan and weight',
};

export async function loadManifest(url = 'media/manifest.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return { videos: {}, audio: {} };
    const m = await res.json();
    return { videos: m.videos ?? {}, audio: m.audio ?? {} };
  } catch {
    return { videos: {}, audio: {} };
  }
}

/** Plays a manifest video on the instruction console's screen. */
export class VideoPlayer {
  constructor(app, consoleObj) {
    this.app = app;
    this.files = {};
    this.shown = new Set();
    this.current = null;
    const el = document.createElement('video');
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.crossOrigin = 'anonymous';
    el.preload = 'none'; // never part of the initial download
    el.style.display = 'none';
    document.body.appendChild(el);
    el.addEventListener('ended', () => {
      if (!this.current) return;
      this.current.ended = true;
      app.lastSpecKey = null;
      app.refreshUI();
    });
    el.addEventListener('error', () => this.stop());
    this.el = el;
    this.texture = new THREE.VideoTexture(el);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // 16:9 screen area at the top of the console panel; buttons stay below.
    const pw = consoleObj.group.children[0].geometry.parameters.width;
    const ph = consoleObj.group.children[0].geometry.parameters.height;
    const vw = pw - 0.08;
    const vh = vw * 9 / 16;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(vw, vh), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.mesh.position.set(0, ph / 2 - 0.04 - vh / 2, 0.005);
    this.mesh.visible = false;
    consoleObj.group.add(this.mesh);
  }

  setFiles(files) {
    this.files = files ?? {};
  }

  /** Keys that have a file listed in the manifest. */
  get available() {
    return new Set(Object.keys(this.files).filter((k) => this.files[k]));
  }

  has(key) {
    return !!this.files[key];
  }

  /** Coaching clip for a mistake, once per session per key. */
  maybeCoach(key) {
    if (!this.has(key) || this.shown.has(key) || this.current) return false;
    this.play(key);
    return true;
  }

  play(key) {
    if (!this.has(key)) return;
    this.shown.add(key);
    this.current = { key, ended: false };
    const f = this.files[key];
    // Relative paths live in media/; full URLs (CDN, blob:) are used as-is.
    this.el.src = /^(https?:|blob:|data:|\/)/.test(f) ? f : `media/${f}`;
    this.el.muted = !!this.app.settings.muted;
    this.el.currentTime = 0;
    this.mesh.visible = true;
    this.app.session.pause('video');
    this.el.play().catch(() => {
      // Autoplay with sound refused: try muted (captions should carry it).
      this.el.muted = true;
      this.el.play().catch(() => this.stop());
    });
    this.app.lastSpecKey = null;
    this.app.refreshUI();
  }

  replay() {
    if (!this.current) return;
    this.current.ended = false;
    this.el.currentTime = 0;
    this.el.play().catch(() => {});
    this.app.lastSpecKey = null;
    this.app.refreshUI();
  }

  stop() {
    this.el.pause();
    this.mesh.visible = false;
    this.current = null;
    this.app.session.resume('video');
    this.app.lastSpecKey = null;
    this.app.refreshUI();
  }
}
