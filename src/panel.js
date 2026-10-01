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
    const pad = 36;
    ctx.setTransform(this.ss, 0, 0, this.ss, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#10151b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = spec.accent ?? '#e0a526';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.lineTo(w, 4);
    ctx.stroke();

    // Buttons laid out bottom-up so body text never collides with them.
    this.buttons = [];
    const rows = (spec.buttons ?? []).filter((r) => r && r.length);
    const bh = spec.buttonHeight ?? 76;
    const gap = 14;
    let by = h - pad - rows.length * bh - (rows.length - 1) * gap;
    const buttonsTop = rows.length ? by - 12 : h - pad;
    for (const row of rows) {
      const bw = (w - pad * 2 - gap * (row.length - 1)) / row.length;
      row.forEach((b, i) => {
        const rect = { ...b, x: pad + i * (bw + gap), y: by, w: bw, h: bh };
        this.drawButton(rect);
        if (b.enabled !== false) this.buttons.push(rect);
      });
      by += bh + gap;
    }

    let y = pad;
    ctx.textBaseline = 'top';
    // Step progress: one segment per step (done / current / to do), so the
    // learner always knows where they are in the procedure.
    if (spec.progress) {
      const { i, n } = spec.progress;
      const gap = 6;
      const sw = (w - pad * 2 - gap * (n - 1)) / n;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = k < i - 1 ? '#2fae66' : k === i - 1 ? '#e0a526' : '#2a333d';
        ctx.fillRect(pad + k * (sw + gap), 16, sw, k === i - 1 ? 12 : 8);
      }
      y += 8;
    }
    if (spec.kicker) {
      ctx.fillStyle = '#9aa7b4';
      ctx.font = `600 26px ${FONT}`;
      ctx.fillText(spec.kicker.toUpperCase(), pad, y);
      y += 38;
    }
    if (spec.title) {
      const size = spec.titleSize ?? 46;
      ctx.font = `bold ${size}px ${FONT}`;
      const inset = spec.objective ? 26 : 0;
      const lines = wrapText(ctx, spec.title, w - pad * 2 - inset * 2);
      if (spec.objective) {
        // Highlighted "YOUR TASK" band: the one thing to do right now.
        const bandH = 40 + lines.length * (size + 8) + 14;
        ctx.fillStyle = '#2b2410';
        roundRect(ctx, pad, y, w - pad * 2, bandH, 12);
        ctx.fill();
        ctx.fillStyle = '#e0a526';
        ctx.fillRect(pad, y, 12, bandH);
        ctx.font = `bold 24px ${FONT}`;
        ctx.fillText('YOUR TASK', pad + inset, y + 12);
        y += 44;
        ctx.font = `bold ${size}px ${FONT}`;
      }
      ctx.fillStyle = '#ffffff';
      for (const line of lines) {
        ctx.fillText(line, pad + inset, y);
        y += size + 8;
      }
      y += spec.objective ? 22 : 6;
    }
    const bodySize = spec.bodySize ?? 32;
    const drawLines = (text, { color = '#dbe2ea', size = bodySize, bold = false, bullet = false } = {}) => {
      ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
      ctx.fillStyle = color;
      const indent = bullet ? 30 : 0;
      const lines = wrapText(ctx, text, w - pad * 2 - indent);
      lines.forEach((line, i) => {
        if (y + size > buttonsTop) return;
        if (bullet && i === 0) ctx.fillText('•', pad + 4, y);
        ctx.fillText(line, pad + indent, y);
        y += size + 9;
      });
    };
    for (const item of spec.body ?? []) {
      if (typeof item === 'string') drawLines(item);
      else if (item.gap) y += item.gap;
      else drawLines(item.text, item);
      y += 4;
    }
    if (spec.feedback?.text) {
      y += 8;
      const tone = TONES[spec.feedback.tone] ?? TONES.info;
      ctx.font = `${bodySize - 2}px ${FONT}`;
      const lines = wrapText(ctx, spec.feedback.text, w - pad * 2 - 110);
      const labelH = tone.label ? 36 : 0;
      const boxH = Math.min(labelH + lines.length * (bodySize + 6) + 30, buttonsTop - y - 6);
      if (boxH > 50) {
        ctx.fillStyle = '#1b232c';
        roundRect(ctx, pad, y, w - pad * 2, boxH, 12);
        ctx.fill();
        ctx.fillStyle = tone.color;
        ctx.fillRect(pad, y, 12, boxH);
        drawSymbol(ctx, tone.symbol, pad + 30, y + 16, 54, tone.color);
        let ty = y + 14;
        if (tone.label) {
          ctx.fillStyle = tone.color;
          ctx.font = `bold 28px ${FONT}`;
          ctx.fillText(tone.label, pad + 104, ty);
          ty += labelH;
        }
        ctx.fillStyle = '#ffffff';
        ctx.font = `${bodySize - 2}px ${FONT}`;
        for (const line of lines) {
          if (ty + bodySize > y + boxH) break;
          ctx.fillText(line, pad + 104, ty);
          ty += bodySize + 6;
        }
      }
    }
  }

  drawButton(b) {
    const { ctx } = this;
    const variants = {
      primary: ['#1f6fd1', '#ffffff'],
      danger: ['#8f2b2b', '#ffffff'],
      default: ['#2a333d', '#eef2f6'],
      toggle: ['#2a333d', '#eef2f6'],
    };
    let [bg, fg] = variants[b.variant ?? 'default'] ?? variants.default;
    if (b.active) bg = '#3c5a2f';
    if (b.enabled === false) {
      bg = '#1a2027';
      fg = '#5d6875';
    }
    ctx.fillStyle = bg;
    roundRect(ctx, b.x, b.y, b.w, b.h, 14);
    ctx.fill();
    // Hover is an overlay mesh (see setHover), so this never changes on aim.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = fg;
    let size = b.h > 70 ? 30 : 26;
    ctx.font = `600 ${size}px ${FONT}`;
    let label = (b.active ? '● ' : '') + b.label;
    while (ctx.measureText(label).width > b.w - 20 && size > 18) {
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
