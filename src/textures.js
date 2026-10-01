// Procedural canvas textures. Everything is generated at runtime, so the
// initial payload is just code (hotspot-friendly, PRD §10) and there are no
// third-party asset rights to clear.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Small deterministic PRNG so textures look identical on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toTexture(c, { srgb = true, repeat } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

export function paintCardboard(ctx, w, h, seed = 1) {
  const r = rng(seed);
  ctx.fillStyle = '#b8864f';
  ctx.fillRect(0, 0, w, h);
  // Fibre speckle and faint corrugation banding.
  for (let i = 0; i < w * h * 0.02; i++) {
    const v = r();
    ctx.fillStyle = v > 0.5 ? 'rgba(90,60,30,0.10)' : 'rgba(235,200,150,0.10)';
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
  ctx.fillStyle = 'rgba(80,50,20,0.05)';
  for (let x = 0; x < w; x += 9) ctx.fillRect(x, 0, 3, h);
  // Edge darkening.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(60,35,10,0.18)');
  g.addColorStop(0.08, 'rgba(0,0,0,0)');
  g.addColorStop(0.92, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(60,35,10,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function paintTape(ctx, w, h, vertical = false) {
  ctx.fillStyle = 'rgba(214,170,110,0.85)';
  if (vertical) ctx.fillRect(w * 0.42, 0, w * 0.16, h);
  else ctx.fillRect(0, h * 0.42, w, h * 0.16);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  if (vertical) ctx.fillRect(w * 0.44, 0, w * 0.02, h);
  else ctx.fillRect(0, h * 0.44, w, h * 0.02);
}

// Simulated linear barcode: deterministic bars derived from the string.
export function drawBarcode(ctx, x, y, w, h, text) {
  const r = rng([...text].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  const modules = [];
  modules.push(2, 1, 1, 2, 3, 2); // start pattern
  for (let i = 0; i < 60; i++) modules.push(1 + Math.floor(r() * 3));
  modules.push(2, 3, 3, 1, 1, 1, 2); // stop pattern
  const total = modules.reduce((a, b) => a + b, 0);
  const unit = w / total;
  let cx = x;
  ctx.fillStyle = '#111';
  modules.forEach((m, i) => {
    if (i % 2 === 0) ctx.fillRect(cx, y, m * unit, h);
    cx += m * unit;
  });
}

function paintShippingLabel(ctx, x, y, w, h, { id, barcode, label, from = 'DG RECEIVING DEMO' }) {
  ctx.fillStyle = '#f7f5ef';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
  ctx.fillStyle = '#111';
  ctx.font = `bold ${Math.round(h * 0.1)}px system-ui, sans-serif`;
  ctx.fillText(label.toUpperCase(), x + 14, y + h * 0.14);
  ctx.font = `${Math.round(h * 0.065)}px system-ui, sans-serif`;
  ctx.fillText(`FROM: ${from}`, x + 14, y + h * 0.24);
  ctx.fillText('TO: OUTBOUND DOCK 3', x + 14, y + h * 0.32);
  drawBarcode(ctx, x + 14, y + h * 0.38, w - 28, h * 0.38, barcode);
  ctx.font = `bold ${Math.round(h * 0.085)}px ui-monospace, monospace`;
  ctx.fillText(id, x + 14, y + h * 0.88);
  ctx.font = `${Math.round(h * 0.06)}px ui-monospace, monospace`;
  ctx.fillText(barcode, x + w * 0.55, y + h * 0.88);
}

function paintArrowsUp(ctx, x, y, s) {
  ctx.fillStyle = '#2b1a0c';
  for (const dx of [0, s * 0.7]) {
    ctx.beginPath();
    ctx.moveTo(x + dx + s * 0.25, y);
    ctx.lineTo(x + dx + s * 0.5, y + s * 0.35);
    ctx.lineTo(x + dx + s * 0.35, y + s * 0.35);
    ctx.lineTo(x + dx + s * 0.35, y + s);
    ctx.lineTo(x + dx + s * 0.15, y + s);
    ctx.lineTo(x + dx + s * 0.15, y + s * 0.35);
    ctx.lineTo(x + dx, y + s * 0.35);
    ctx.closePath();
    ctx.fill();
  }
}

// Crease lines, crushed shading and a torn patch exposing corrugation,
// anchored at a corner of the face. corner: [cx, cy] in 0..1 face coords.
function paintDamage(ctx, w, h, corner, seed) {
  const r = rng(seed);
  const cx = corner[0] * w;
  const cy = corner[1] * h;
  const R = Math.min(w, h) * 0.55;
  // Crushed shadow.
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, 'rgba(40,20,5,0.65)');
  g.addColorStop(0.5, 'rgba(60,30,10,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Creases.
  ctx.strokeStyle = 'rgba(35,18,5,0.85)';
  for (let i = 0; i < 9; i++) {
    ctx.lineWidth = 2 + r() * 4;
    ctx.beginPath();
    let px = cx + (r() - 0.5) * 20;
    let py = cy + (r() - 0.5) * 20;
    ctx.moveTo(px, py);
    const ang = Math.atan2(h / 2 - cy, w / 2 - cx) + (r() - 0.5) * 1.6;
    const len = R * (0.4 + r() * 0.6);
    for (let s = 0; s < 4; s++) {
      px += Math.cos(ang + (r() - 0.5) * 0.6) * len / 4;
      py += Math.sin(ang + (r() - 0.5) * 0.6) * len / 4;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Torn patch: jagged polygon showing lighter inner liner with flutes.
  const tr = R * 0.42;
  const pts = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const rr = tr * (0.55 + r() * 0.5);
    pts.push([cx + Math.cos(a) * rr * 1.1, cy + Math.sin(a) * rr]);
  }
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = '#d9b27a';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(120,80,35,0.9)';
  ctx.lineWidth = 5;
  for (let x = cx - tr * 2; x < cx + tr * 2; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, cy - tr * 2);
    ctx.lineTo(x + 6, cy + tr * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(245,225,190,0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
}

/**
 * Six face textures for a package in BoxGeometry order (+x, -x, +y, -y, +z, -z).
 * damage: null or { faces: { px: [u,v], py: [u,v], pz: [u,v] } }
 */
export function packageFaceTextures({ id, barcode, label, seed = 3, damage = null }) {
  const size = 512;
  const faceKeys = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  return faceKeys.map((k, i) => {
    const [c, ctx] = canvas(size, size);
    paintCardboard(ctx, size, size, seed * 10 + i);
    if (k === 'py' || k === 'ny') paintTape(ctx, size, size, false);
    if (k === 'pz' || k === 'nz') paintTape(ctx, size, size * 0.18, true);
    if (k === 'pz') {
      paintShippingLabel(ctx, size * 0.1, size * 0.3, size * 0.62, size * 0.56, { id, barcode, label });
    }
    if (k === 'nz' || k === 'px') {
      paintArrowsUp(ctx, size * 0.08, size * 0.08, size * 0.14);
      ctx.fillStyle = '#2b1a0c';
      ctx.font = `bold ${size * 0.06}px system-ui, sans-serif`;
      ctx.fillText('THIS SIDE UP', size * 0.1, size * 0.34);
    }
    if (k === 'nx') {
      ctx.fillStyle = '#2b1a0c';
      ctx.font = `bold ${size * 0.09}px system-ui, sans-serif`;
      ctx.fillText(label.toUpperCase(), size * 0.12, size * 0.55);
    }
    if (damage?.faces?.[k]) paintDamage(ctx, size, size, damage.faces[k], seed * 7 + i);
    return toTexture(c);
  });
}

export function textTexture(lines, { w = 512, h = 128, bg = '#1c232b', fg = '#ffffff', font = 'bold 56px system-ui, sans-serif', stripe = null } = {}) {
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (stripe) {
    ctx.save();
    ctx.fillStyle = stripe;
    for (let x = -h; x < w; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 24, h);
      ctx.lineTo(x + 24 + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = bg;
    ctx.fillRect(12, 12, w - 24, h - 24);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((line, i) => {
    const f = typeof line === 'object' ? line.font : font;
    const t = typeof line === 'object' ? line.text : line;
    ctx.font = f;
    ctx.fillText(t, w / 2, (h / (arr.length + 1)) * (i + 1));
  });
  return toTexture(c);
}

export function concreteTexture() {
  const [c, ctx] = canvas(512, 512);
  const r = rng(99);
  ctx.fillStyle = '#6d7075';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = Math.floor(90 + r() * 40);
    ctx.fillStyle = `rgba(${v},${v},${v + 4},0.25)`;
    ctx.fillRect(r() * 512, r() * 512, 2, 2);
  }
  ctx.strokeStyle = 'rgba(40,40,45,0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 512, 512);
  return toTexture(c, { repeat: [8, 8] });
}

export function beltTexture() {
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = '#23272c';
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = '#2f343a';
  for (let y = 0; y < 256; y += 32) ctx.fillRect(0, y, 128, 10);
  return toTexture(c, { repeat: [1, 8] });
}

export function matTexture() {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#2a3036';
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText('INSPECTION', 20, 490);
  return toTexture(c);
}

export function brandTexture(title, subtitle) {
  const [c, ctx] = canvas(1024, 256);
  ctx.fillStyle = '#20262d';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#e0a526';
  ctx.fillRect(0, 0, 14, 256);
  ctx.fillStyle = '#f2f2f2';
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.fillText(title, 48, 120);
  ctx.fillStyle = '#aab4bf';
  ctx.font = '44px system-ui, sans-serif';
  ctx.fillText(subtitle, 48, 196);
  return toTexture(c);
}
