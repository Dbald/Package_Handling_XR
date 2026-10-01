// World-space UI: canvas-rendered panels with ray/mouse hit-testing.
// Tone is never carried by colour alone: every feedback box has a symbol
// and a text label (PRD FR-09, §7).
import * as THREE from 'three';

/**
 * Push a redrawn canvas to the GPU without stalling the frame: snapshot it as
 * an ImageBitmap off the critical path (Quest Browser), else plain upload.
 */
export function uploadCanvas(texture, canvas) {
  if (typeof globalThis.createImageBitmap !== 'function') {
    texture.needsUpdate = true;
    return;
  }
  const gen = (texture.userData.uploadGen = (texture.userData.uploadGen ?? 0) + 1);
  createImageBitmap(canvas, { imageOrientation: 'flipY' }).then((bmp) => {
    if (gen !== texture.userData.uploadGen) {
      bmp.close?.();
      return;
    }
    const old = texture.image;
    texture.image = bmp;
    texture.flipY = false;
    texture.needsUpdate = true;
    if (old && old !== canvas && typeof old.close === 'function') old.close();
  }).catch(() => {
    texture.needsUpdate = true;
  });
}

export const TONES = {
  success: { color: '#2fae66', label: 'CORRECT', symbol: 'check' },
  error: { color: '#e0762b', label: 'NOT QUITE', symbol: 'cross' },
  critical: { color: '#e04848', label: 'CRITICAL ERROR', symbol: 'octagon' },
  warning: { color: '#e0b12b', label: 'BLOCKED', symbol: 'triangle' },
  info: { color: '#4a9be0', label: 'INFO', symbol: 'info' },
  neutral: { color: '#8a96a3', label: '', symbol: 'info' },
};

export function drawSymbol(ctx, kind, x, y, s, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = s * 0.12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = x + s / 2;
  const cy = y + s / 2;
  if (kind === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(x + s, y + s);
    ctx.lineTo(x, y + s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, y + s * 0.35);
    ctx.lineTo(cx, y + s * 0.68);
    ctx.moveTo(cx, y + s * 0.84);
    ctx.lineTo(cx, y + s * 0.85);
    ctx.stroke();
  } else if (kind === 'octagon') {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      ctx.lineTo(cx + Math.cos(a) * s * 0.5, cy + Math.sin(a) * s * 0.5);
    }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, y + s * 0.22);
    ctx.lineTo(cx, y + s * 0.58);
    ctx.moveTo(cx, y + s * 0.76);
    ctx.lineTo(cx, y + s * 0.77);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    if (kind === 'check') {
      ctx.moveTo(x + s * 0.26, cy);
      ctx.lineTo(x + s * 0.44, y + s * 0.7);
      ctx.lineTo(x + s * 0.76, y + s * 0.32);
    } else if (kind === 'cross') {
      ctx.moveTo(x + s * 0.3, y + s * 0.3);
      ctx.lineTo(x + s * 0.7, y + s * 0.7);
      ctx.moveTo(x + s * 0.7, y + s * 0.3);
      ctx.lineTo(x + s * 0.3, y + s * 0.7);
    } else {
      ctx.moveTo(cx, y + s * 0.44);
      ctx.lineTo(cx, y + s * 0.76);
      ctx.moveTo(cx, y + s * 0.26);
      ctx.lineTo(cx, y + s * 0.27);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function wrapText(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

const FONT = 'system-ui, -apple-system, Roboto, "Segoe UI", sans-serif';

export class Panel {
  constructor({ width = 1.3, height = 0.86, pxPerMeter = 1000, supersample = 1.5, name = 'panel' } = {}) {
    // Layout works in logical px (1 px = 1 mm); the canvas is supersampled so
    // text stays crisp in the headset.
    this.w = Math.round(width * pxPerMeter);
    this.h = Math.round(height * pxPerMeter);
    this.wm = width;
    this.hm = height;
    this.ss = supersample;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.w * supersample);
    this.canvas.height = Math.round(this.h * supersample);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    this.mesh.name = name;
    this.mesh.userData.panel = this;
    // Thin back so the panel reads as a physical board from behind.
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.02, height + 0.02, 0.015),
      new THREE.MeshLambertMaterial({ color: 0x2a3139 }),
    );
    back.position.z = -0.009;
    this.mesh.add(back);
    // Hover highlight is geometry, not a canvas redraw: aiming across buttons
    // must never re-upload the panel texture (that dropped frames in VR).
    this.hoverFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }));
    this.hoverFrame = new THREE.Mesh(this.frameGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    for (const m of [this.hoverFill, this.hoverFrame]) {
      m.visible = false;
      m.position.z = 0.002;
      this.mesh.add(m);
    }
    this.spec = null;
    this.hover = null;
    this.buttons = [];
    this.dirty = true;
  }

  setContent(spec) {
    this.spec = spec;
    this.dirty = true;
  }

  /** Unit square outline (4 bars) scaled to the hovered button. */
  frameGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    const idx = [];
    for (let q = 0; q < 4; q++) {
      const o = q * 4;
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    g.setIndex(idx);
    return g;
  }

  setHover(id) {
    if (this.hover === id) return;
    this.hover = id;
    const b = id ? this.buttons.find((x) => x.id === id) : null;
    this.hoverFill.visible = this.hoverFrame.visible = !!b;
    if (!b) return;
    const kx = this.wm / this.w;
    const ky = this.hm / this.h;
    const cx = (b.x + b.w / 2) * kx - this.wm / 2;
    const cy = this.hm / 2 - (b.y + b.h / 2) * ky;
    const w = b.w * kx;
    const h = b.h * ky;
    this.hoverFill.position.set(cx, cy, 0.002);
    this.hoverFill.scale.set(w, h, 1);
    const t = 0.005;
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    const quads = [
      [x0, y1 - t, x1, y1], [x0, y0, x1, y0 + t], [x0, y0, x0 + t, y1], [x1 - t, y0, x1, y1],
    ];
    const pos = this.hoverFrame.geometry.attributes.position;
    quads.forEach(([a, b2, c, d], q) => {
      pos.setXYZ(q * 4, a, b2, 0.003);
      pos.setXYZ(q * 4 + 1, c, b2, 0.003);
      pos.setXYZ(q * 4 + 2, c, d, 0.003);
      pos.setXYZ(q * 4 + 3, a, d, 0.003);
    });
    pos.needsUpdate = true;
    this.hoverFrame.geometry.computeBoundingSphere();
    this.hoverFrame.position.set(0, 0, 0);
  }

  /** Draw on top of everything (modal panels). */
  setOnTop(order) {
    this.mesh.traverse((o) => {
      if (!o.material) return;
      o.material.depthTest = false;
      o.renderOrder = order;
    });
    this.mesh.renderOrder = order + 1;
    this.hoverFill.renderOrder = order + 2;
    this.hoverFrame.renderOrder = order + 3;
  }

  /** uv from a raycast hit → enabled button under it, or null. */
  hitTest(uv) {
    if (!uv) return null;
    const x = uv.x * this.w;
    const y = (1 - uv.y) * this.h;
    return this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null;
  }

  update() {
    if (!this.dirty || !this.spec) return;
    this.dirty = false;
    this.draw(this.spec);
    uploadCanvas(this.texture, this.canvas);
    // Buttons may have moved: re-place the hover highlight.
    const h = this.hover;
    this.hover = null;
    this.setHover(h);
  }

  draw(spec) {
    const { ctx, w, h } = this;
    const pad = 48;
    const gap = 18;
    ctx.setTransform(this.ss, 0, 0, this.ss, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#141b23');
    bg.addColorStop(1, '#0d1217');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = spec.accent ?? '#e0a526';
    ctx.fillRect(0, 0, w, 6);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    // ---- buttons, pinned to the bottom
    this.buttons = [];
    const rows = (spec.buttons ?? []).filter((r) => r && r.length);
    const bh = spec.buttonHeight ?? 74;
    let by = h - pad - rows.length * bh - Math.max(0, rows.length - 1) * gap;
    let bottom = rows.length ? by - gap : h - pad;
    for (const row of rows) {
      const bw = (w - pad * 2 - gap * (row.length - 1)) / row.length;
      row.forEach((b, i) => {
        const rect = { ...b, x: pad + i * (bw + gap), y: by, w: bw, h: bh };
        this.drawButton(rect);
        if (b.enabled !== false) this.buttons.push(rect);
      });
      by += bh + gap;
    }

    // ---- feedback card, directly above the buttons (same place every time)
    if (spec.feedback && (spec.feedback.title || spec.feedback.text)) {
      const tone = TONES[spec.feedback.tone] ?? TONES.info;
      const fh = 116;
      const fy = bottom - fh;
      ctx.fillStyle = '#1a222c';
      roundRect(ctx, pad, fy, w - pad * 2, fh, 18);
      ctx.fill();
      ctx.fillStyle = tone.color;
      roundRect(ctx, pad, fy, 12, fh, 6);
      ctx.fill();
      drawSymbol(ctx, tone.symbol, pad + 34, fy + 28, 60, tone.color);
      const tx = pad + 112;
      const maxW = w - tx - pad - 20;
      ctx.fillStyle = tone.color;
      ctx.font = `bold 38px ${FONT}`;
      ctx.fillText(fit(ctx, spec.feedback.title || tone.label, maxW), tx, fy + 16);
      if (spec.feedback.text) {
        ctx.fillStyle = '#e8edf2';
        ctx.font = `32px ${FONT}`;
        ctx.fillText(fit(ctx, spec.feedback.text, maxW), tx, fy + 64);
      }
      bottom = fy - gap;
    }

    // ---- header: station chip, step counter, progress
    let y = pad - 6;
    if (spec.chip || spec.stepLabel) {
      if (spec.chip) {
        ctx.font = `bold 24px ${FONT}`;
        const cw = ctx.measureText(spec.chip.toUpperCase()).width + 32;
        ctx.fillStyle = '#232d38';
        roundRect(ctx, pad, y, cw, 42, 21);
        ctx.fill();
        ctx.fillStyle = '#aab7c4';
        ctx.fillText(spec.chip.toUpperCase(), pad + 16, y + 10);
      }
      if (spec.stepLabel) {
        ctx.font = `bold 28px ${FONT}`;
        ctx.fillStyle = '#e0a526';
        ctx.textAlign = 'right';
        ctx.fillText(spec.stepLabel, w - pad, y + 7);
        ctx.textAlign = 'left';
      }
      y += 58;
    }
    if (spec.progress) {
      const { i, n } = spec.progress;
      const g = 8;
      const sw = (w - pad * 2 - g * (n - 1)) / n;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = k < i - 1 ? '#2fae66' : k === i - 1 ? '#e0a526' : '#26303b';
        roundRect(ctx, pad + k * (sw + g), y, sw, 10, 5);
        ctx.fill();
      }
      y += 10 + gap + 8;
    }

    // ---- hero: icon + task title + one line
    if (spec.title) {
      const size = spec.titleSize ?? 66;
      const iconS = spec.icon ? 128 : 0;
      const tx = pad + (iconS ? iconS + 32 : 0);
      const maxW = w - tx - pad;
      if (spec.icon) {
        ctx.fillStyle = '#1f2833';
        roundRect(ctx, pad, y, iconS, iconS, 24);
        ctx.fill();
        drawIcon(ctx, spec.icon, pad + 18, y + 18, iconS - 36, spec.iconColor ?? '#e0a526');
      }
      ctx.font = `bold ${size}px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      const tl = wrapText(ctx, spec.title, maxW).slice(0, 2);
      let ty = y + (spec.icon && tl.length === 1 && !spec.subtitle ? (iconS - size) / 2 : 2);
      for (const line of tl) {
        ctx.fillText(line, tx, ty);
        ty += size + 8;
      }
      if (spec.subtitle) {
        ctx.font = `${spec.subtitleSize ?? 36}px ${FONT}`;
        ctx.fillStyle = '#b6c2ce';
        for (const line of wrapText(ctx, spec.subtitle, maxW).slice(0, 2)) {
          ctx.fillText(line, tx, ty + 4);
          ty += (spec.subtitleSize ?? 36) + 8;
        }
      }
      y = Math.max(y + iconS, ty) + gap + 6;
    }

    // ---- controller hint chips: [TRIGGER] scan  [GRIP] grab
    if (spec.hints?.length && y + 58 <= bottom) {
      let x = pad;
      for (const hnt of spec.hints) {
        ctx.font = `bold 28px ${FONT}`;
        const kw = ctx.measureText(hnt.key).width + 32;
        ctx.font = `32px ${FONT}`;
        const tw = ctx.measureText(hnt.text).width;
        if (x + kw + tw + 30 > w - pad) break;
        ctx.fillStyle = '#e0a526';
        roundRect(ctx, x, y, kw, 54, 12);
        ctx.fill();
        ctx.fillStyle = '#14100a';
        ctx.font = `bold 28px ${FONT}`;
        ctx.fillText(hnt.key, x + 16, y + 13);
        ctx.fillStyle = '#e8edf2';
        ctx.font = `32px ${FONT}`;
        ctx.fillText(hnt.text, x + kw + 14, y + 10);
        x += kw + tw + 52;
      }
      y += 54 + gap + 6;
    }

    // ---- objective cards (briefings): icon, two-word title, short line
    if (spec.cards?.length) {
      const n = spec.cards.length;
      const cw = (w - pad * 2 - gap * (n - 1)) / n;
      const ch = Math.min(280, bottom - y);
      if (ch > 120) {
        spec.cards.forEach((c, i) => {
          const cx = pad + i * (cw + gap);
          ctx.fillStyle = '#1a222c';
          roundRect(ctx, cx, y, cw, ch, 20);
          ctx.fill();
          ctx.fillStyle = '#e0a526';
          ctx.font = `bold 26px ${FONT}`;
          ctx.fillText(String(i + 1), cx + 22, y + 18);
          drawIcon(ctx, c.icon, cx + cw / 2 - 44, y + 24, 88, '#e0a526');
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold 38px ${FONT}`;
          ctx.fillText(fit(ctx, c.title, cw - 24), cx + cw / 2, y + 128);
          ctx.fillStyle = '#b6c2ce';
          ctx.font = `29px ${FONT}`;
          wrapText(ctx, c.text, cw - 36).slice(0, 2).forEach((line, k) => ctx.fillText(line, cx + cw / 2, y + 180 + k * 34));
          ctx.textAlign = 'left';
        });
        y += ch + gap;
      }
    }

    // ---- free body lines (help, results, setup notes)
    const bodySize = spec.bodySize ?? 30;
    for (const item of spec.body ?? []) {
      if (typeof item === 'object' && item.gap) {
        y += item.gap;
        continue;
      }
      const text = typeof item === 'string' ? item : item.text;
      const size = (typeof item === 'object' && item.size) || bodySize;
      ctx.font = `${typeof item === 'object' && item.bold ? 'bold ' : ''}${size}px ${FONT}`;
      ctx.fillStyle = (typeof item === 'object' && item.color) || '#dbe2ea';
      const bullet = typeof item === 'object' && item.bullet;
      const indent = bullet ? 30 : 0;
      for (const [k, line] of wrapText(ctx, text, w - pad * 2 - indent).entries()) {
        if (y + size > bottom) break;
        if (bullet && k === 0) ctx.fillText('•', pad + 4, y);
        ctx.fillText(line, pad + indent, y);
        y += size + 10;
      }
      y += 6;
    }
  }

  drawButton(b) {
    const { ctx } = this;
    const variants = {
      primary: ['#1f6fd1', '#ffffff'],
      danger: ['#8f2b2b', '#ffffff'],
      default: ['#25303b', '#eef2f6'],
      ghost: ['#161d25', '#aab7c4'],
    };
    let [bg, fg] = variants[b.variant ?? 'default'] ?? variants.default;
    if (b.active) bg = '#355a2b';
    if (b.enabled === false) {
      bg = '#171d24';
      fg = '#55606c';
    }
    ctx.fillStyle = bg;
    roundRect(ctx, b.x, b.y, b.w, b.h, 16);
    ctx.fill();
    // Hover is an overlay mesh (see setHover), so this never changes on aim.
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = fg;
    let size = b.h > 70 ? 30 : 26;
    ctx.font = `600 ${size}px ${FONT}`;
    const label = (b.active ? '● ' : '') + b.label;
    while (ctx.measureText(label).width > b.w - 28 && size > 18) {
      size -= 2;
      ctx.font = `600 ${size}px ${FONT}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
}

/** Shrink-to-fit with an ellipsis for single-line text. */
function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Simple line pictograms for task types (drawn, so no image assets). */
export function drawIcon(ctx, name, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(3, s * 0.07);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const L = (pts, close = false) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * s, py * s) : ctx.moveTo(px * s, py * s)));
    if (close) ctx.closePath();
    ctx.stroke();
  };
  switch (name) {
    case 'scan':
      for (const [bx, bw2] of [[0.1, 0.06], [0.22, 0.03], [0.3, 0.08], [0.44, 0.03], [0.52, 0.06], [0.64, 0.03], [0.72, 0.08], [0.86, 0.04]]) ctx.fillRect(bx * s, 0.18 * s, bw2 * s, 0.5 * s);
      ctx.fillStyle = '#e04848';
      ctx.fillRect(0.02 * s, 0.42 * s, 0.96 * s, 0.05 * s);
      break;
    case 'box':
      L([[0.5, 0.08], [0.92, 0.28], [0.5, 0.48], [0.08, 0.28]], true);
      L([[0.08, 0.28], [0.08, 0.74], [0.5, 0.94], [0.92, 0.74], [0.92, 0.28]]);
      L([[0.5, 0.48], [0.5, 0.94]]);
      break;
    case 'tape':
      ctx.beginPath();
      ctx.arc(0.36 * s, 0.42 * s, 0.26 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0.36 * s, 0.42 * s, 0.1 * s, 0, Math.PI * 2);
      ctx.stroke();
      L([[0.36, 0.68], [0.96, 0.68]]);
      L([[0.62, 0.42], [0.96, 0.62]]);
      break;
    case 'scale':
      L([[0.06, 0.6], [0.94, 0.6], [0.86, 0.9], [0.14, 0.9]], true);
      L([[0.2, 0.6], [0.2, 0.46], [0.8, 0.46], [0.8, 0.6]]);
      ctx.font = `bold ${0.26 * s}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('kg', 0.5 * s, 0.1 * s);
      ctx.textAlign = 'left';
      break;
    case 'label':
      L([[0.18, 0.06], [0.82, 0.06], [0.82, 0.94], [0.18, 0.94]], true);
      for (const ly of [0.22, 0.34]) L([[0.3, ly], [0.7, ly]]);
      for (const [bx, bw2] of [[0.3, 0.05], [0.4, 0.03], [0.47, 0.07], [0.58, 0.03], [0.65, 0.05]]) ctx.fillRect(bx * s, 0.5 * s, bw2 * s, 0.3 * s);
      break;
    case 'ship':
      L([[0.06, 0.3], [0.52, 0.3], [0.52, 0.78], [0.06, 0.78]], true);
      L([[0.6, 0.54], [0.94, 0.54]]);
      L([[0.78, 0.38], [0.94, 0.54], [0.78, 0.7]]);
      break;
    case 'bin':
      L([[0.1, 0.3], [0.9, 0.3], [0.78, 0.92], [0.22, 0.92]], true);
      L([[0.36, 0.08], [0.64, 0.08], [0.64, 0.3]]);
      L([[0.36, 0.08], [0.36, 0.3]]);
      L([[0.4, 0.5], [0.6, 0.72]]);
      L([[0.6, 0.5], [0.4, 0.72]]);
      break;
    case 'eye':
      ctx.beginPath();
      ctx.moveTo(0.04 * s, 0.5 * s);
      ctx.quadraticCurveTo(0.5 * s, 0.02 * s, 0.96 * s, 0.5 * s);
      ctx.quadraticCurveTo(0.5 * s, 0.98 * s, 0.04 * s, 0.5 * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0.5 * s, 0.5 * s, 0.15 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'decide':
      L([[0.06, 0.52], [0.2, 0.68], [0.42, 0.34]]);
      L([[0.6, 0.34], [0.92, 0.68]]);
      L([[0.92, 0.34], [0.6, 0.68]]);
      break;
    case 'fill':
      for (const [cx, cy, r] of [[0.32, 0.42, 0.2], [0.66, 0.42, 0.2], [0.5, 0.68, 0.2]]) {
        ctx.beginPath();
        ctx.ellipse(cx * s, cy * s, r * s, r * 0.7 * s, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'gear':
      ctx.beginPath();
      ctx.arc(0.5 * s, 0.5 * s, 0.24 * s, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        L([[0.5 + Math.cos(a) * 0.32, 0.5 + Math.sin(a) * 0.32], [0.5 + Math.cos(a) * 0.44, 0.5 + Math.sin(a) * 0.44]]);
      }
      break;
    case 'star': {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 ? 0.2 : 0.46;
        ctx.lineTo((0.5 + Math.cos(a) * r) * s, (0.52 + Math.sin(a) * r) * s);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'pause':
      ctx.fillRect(0.24 * s, 0.16 * s, 0.17 * s, 0.68 * s);
      ctx.fillRect(0.59 * s, 0.16 * s, 0.17 * s, 0.68 * s);
      break;
    case 'play':
      ctx.beginPath();
      ctx.moveTo(0.26 * s, 0.14 * s);
      ctx.lineTo(0.84 * s, 0.5 * s);
      ctx.lineTo(0.26 * s, 0.86 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'list':
      L([[0.08, 0.1], [0.92, 0.1], [0.92, 0.72], [0.08, 0.72]], true);
      for (const ly of [0.28, 0.42, 0.56]) L([[0.2, ly], [0.8, ly]]);
      L([[0.4, 0.72], [0.36, 0.92]]);
      L([[0.6, 0.72], [0.64, 0.92]]);
      L([[0.28, 0.92], [0.72, 0.92]]);
      break;
    default:
      ctx.beginPath();
      ctx.arc(0.5 * s, 0.5 * s, 0.4 * s, 0, Math.PI * 2);
      ctx.stroke();
  }
  ctx.restore();
}

/** Small billboard label used for hover tags and local tool prompts. */
export class Tag {
  constructor({ width = 0.3, height = 0.075 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = Math.round(640 * (height / width));
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthTest: false }),
    );
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.text = null;
  }

  set(text, { bg = 'rgba(12,16,21,0.92)', fg = '#ffffff', accent = '#e0a526' } = {}) {
    if (!text) {
      this.mesh.visible = false;
      this.text = null;
      return;
    }
    this.mesh.visible = true;
    const key = text + bg + accent;
    if (this.text === key) return;
    this.text = key;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bg;
    roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 22);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = String(text).split('\n');
    let size = lines.length > 1 ? 42 : 52;
    ctx.font = `bold ${size}px ${FONT}`;
    while (Math.max(...lines.map((l) => ctx.measureText(l).width)) > canvas.width - 40 && size > 20) {
      size -= 2;
      ctx.font = `bold ${size}px ${FONT}`;
    }
    lines.forEach((l, i) => {
      ctx.fillText(l, canvas.width / 2, (canvas.height / (lines.length + 1)) * (i + 1));
    });
    uploadCanvas(this.texture, canvas);
  }
}
