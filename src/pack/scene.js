// Station 1 Pack-Out workstation geometry. Same bench footprint and frame
// convention as the dock station (y = 0 is the work surface, learner at the
// origin facing -Z), modelled on lean pack-station layouts: incoming tote on
// the left, carton slots at the back, pack scale in the middle, tools and
// consumables on the right, outbound roller conveyor beyond them.
import * as THREE from 'three';
import { paintCardboard, drawBarcode, textTexture, canvasTexture } from '../textures.js';
import { ScreenDisplay, LAYOUT } from '../scene.js';

export const PACK_LAYOUT = Object.freeze({
  bench: LAYOUT.bench,
  tote: { x: -0.56, z: -0.5, w: 0.38, d: 0.3, h: 0.14 },
  exception: { x: -0.6, z: -0.87, w: 0.3, d: 0.2, h: 0.15 },
  slots: { z: -0.885, w: 0.19, d: 0.21, h: 0.13, xs: { S: -0.3, M: -0.09, L: 0.12 } },
  packZone: { x: -0.08, z: -0.54, w: 0.44, d: 0.36, top: 0.03 },
  basket: { x: 0.28, z: -0.87, w: 0.14, d: 0.2, h: 0.1 },
  printer: { x: 0.28, z: -0.65, w: 0.13, d: 0.16, h: 0.12 },
  tape: { x: 0.28, z: -0.45 },
  scanner: { x: -0.48, z: -0.315 },
  monitor: { x: 0.6, y: 0.44, z: -0.9, w: 0.46, h: 0.29 },
  conveyor: LAYOUT.conveyor,
  releaseButton: LAYOUT.releaseButton,
  panel: { x: -0.25, z: -1.35, standingY: 0.8, seatedY: 0.72 },
});

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function plane(tex, w, h) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
}

function tag(obj, key, label) {
  obj.userData = { ...obj.userData, kind: 'pk', key, label };
  obj.traverse((o) => { if (o.isMesh) o.userData = obj.userData; });
  return obj;
}

// ------------------------------------------------------------- textures

function productFaces(def, { base, accent, art, barcodeFace }) {
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  return faces.map((f) => canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, 26);
    if (f === barcodeFace) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(18, 120, w - 36, 118);
      drawBarcode(ctx, 28, 130, w - 56, 70, def.sku);
      ctx.fillStyle = '#111';
      ctx.font = 'bold 26px ui-monospace, monospace';
      ctx.fillText(def.sku, 30, 228);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.fillText(def.name, 14, 100);
    } else if (art) {
      art(ctx, w, h, f);
    }
  }));
}

function mugArt(ctx, w, h, f) {
  if (f !== 'py' && f !== 'px' && f !== 'nx' && f !== 'nz') return;
  ctx.strokeStyle = '#2b4a6b';
  ctx.lineWidth = 10;
  ctx.strokeRect(70, 80, 90, 110);
  ctx.beginPath();
  ctx.arc(175, 135, 28, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.fillStyle = '#c62828';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText('FRAGILE', 54, 240);
}

function bookArt(ctx, w, h, f) {
  if (f === 'py' || f === 'pz') return;
  ctx.fillStyle = '#e8d9a8';
  ctx.font = 'bold 30px Georgia, serif';
  ctx.fillText('Atlas of', 30, 110);
  ctx.fillText('Logistics', 30, 150);
}

function caseArt(ctx, w, h, f) {
  if (f === 'py') return;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText('PHONE CASE', 30, 130);
}

function makeItem(def, opts) {
  const [w, h, d] = def.size;
  const mats = productFaces(def, opts).map((map) => new THREE.MeshLambertMaterial({ map, emissive: 0x000000 }));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  const g = new THREE.Group();
  g.add(mesh);
  // Barcode normal in item-local space (for scan facing checks).
  const normals = { pz: [0, 0, 1], py: [0, 1, 0] };
  g.userData.barcodeNormal = new THREE.Vector3(...normals[opts.barcodeFace]);
  tag(g, `pk:${def.key}`, `${def.name} — ${def.sku}`);
  return { group: g, mesh, mats };
}

// --------------------------------------------------------------- carton

function cartonTexture(seed) {
  return canvasTexture(256, 256, (ctx, w, h) => paintCardboard(ctx, w, h, seed));
}

/** Open-top carton with hinged flaps; setSealed() closes and tapes it. */
function makeCarton(size) {
  const [w, h, d] = size;
  const mat = new THREE.MeshLambertMaterial({ map: cartonTexture(41), emissive: 0x000000 });
  const inner = new THREE.MeshLambertMaterial({ color: 0xa47a48, side: THREE.DoubleSide });
  const t = 0.006;
  const g = new THREE.Group();
  g.add(box(w, t, d, mat, 0, t / 2, 0));
  g.add(box(w, h, t, mat, 0, h / 2, -d / 2));
  g.add(box(w, h, t, mat, 0, h / 2, d / 2));
  g.add(box(t, h, d, mat, -w / 2, h / 2, 0));
  g.add(box(t, h, d, mat, w / 2, h / 2, 0));
  // Flaps hinge on the top edges.
  const flaps = [];
  // axis 'x': long flap (length fw along x, depth fd along z); axis 'z': side flap.
  const mk = (fw, fd, px, pz, axis, sign) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, h, pz);
    const geo = axis === 'x' ? new THREE.BoxGeometry(fw, t, fd) : new THREE.BoxGeometry(fd, t, fw);
    const f = new THREE.Mesh(geo, [mat, mat, mat, inner, mat, mat]);
    if (axis === 'x') f.position.z = sign * fd / 2;
    else f.position.x = sign * fd / 2;
    pivot.add(f);
    pivot.userData = { axis, sign };
    g.add(pivot);
    flaps.push(pivot);
  };
  mk(w, d / 2, 0, -d / 2, 'x', 1); // back long flap folds toward +z
  mk(w, d / 2, 0, d / 2, 'x', -1); // front long flap folds toward -z
  mk(d, 0.07, -w / 2, 0, 'z', 1); // side flaps
  mk(d, 0.07, w / 2, 0, 'z', -1);
  const tape = box(0.05, 0.002, d + 0.02, new THREE.MeshLambertMaterial({ color: 0xc9a46a, transparent: true, opacity: 0.85 }), 0, h + t + 0.001, 0);
  tape.visible = false;
  g.add(tape);
  const setSealed = (sealed) => {
    for (const p of flaps) {
      const { axis, sign } = p.userData;
      // Open: flaps splay outward. Sealed: folded flat (side flaps under long flaps).
      const angle = sealed ? 0 : -sign * 1.9;
      if (axis === 'x') p.rotation.set(angle, 0, 0);
      else p.rotation.set(0, 0, -angle);
      if (sealed && axis === 'z') p.position.y = h - 0.004;
      else p.position.y = h;
    }
    tape.visible = sealed;
  };
  setSealed(false);
  return { group: g, mat, setSealed, size };
}

function makeFlatCarton(key, size) {
  const [w, , d] = size;
  const fw = Math.min(0.17, 0.11 + w * 0.15);
  const fd = Math.min(0.2, 0.15 + d * 0.12);
  const tex = canvasTexture(256, 256, (ctx, cw, ch) => {
    paintCardboard(ctx, cw, ch, key.charCodeAt(0));
    ctx.fillStyle = '#2b1a0c';
    ctx.font = 'bold 150px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(key, cw / 2, ch / 2 + 50);
  });
  const mats = [lambert(0xb8864f), lambert(0xb8864f), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x000000 }),
    lambert(0xb8864f), lambert(0xb8864f), lambert(0xb8864f)];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.02, fd), mats);
  const g = new THREE.Group();
  g.add(mesh);
  tag(g, `pk:carton-${key}`, `Carton ${key} (flat)`);
  return { group: g, mesh, mats: [mats[2]] };
}

// ---------------------------------------------------------------- tools

function makeScannerGun() {
  const g = new THREE.Group();
  const body = lambert(0x2a2f36, { emissive: 0x000000 });
  const accent = lambert(0xe0a526, { emissive: 0x000000 });
  // Scan direction is local -Z; the handle hangs below the hand.
  g.add(box(0.05, 0.045, 0.12, body, 0, 0, -0.03));
  const handle = box(0.032, 0.1, 0.038, body, 0, -0.06, 0.02);
  handle.rotation.x = -0.35;
  g.add(handle);
  g.add(box(0.034, 0.012, 0.03, accent, 0, -0.025, -0.01));
  g.add(box(0.04, 0.03, 0.004, new THREE.MeshBasicMaterial({ color: 0x5a0d0d }), 0, 0, -0.092));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 1, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.7 }));
  beam.rotation.x = Math.PI / 2;
  beam.visible = false;
  g.add(beam);
  g.userData.beam = beam;
  tag(g, 'pk:scanner', 'Handheld scanner — hold and pull TRIGGER');
  return { group: g, mats: [body, accent] };
}

function makeTapeGun() {
  const g = new THREE.Group();
  const body = lambert(0xc0392b, { emissive: 0x000000 });
  const roll = lambert(0xc9a46a, { emissive: 0x000000 });
  const r = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20), roll);
  r.rotation.z = Math.PI / 2;
  r.position.set(0, 0.0, -0.02);
  g.add(r);
  g.add(box(0.012, 0.04, 0.16, body, 0, -0.02, -0.03));
  const handle = box(0.03, 0.1, 0.035, body, 0, -0.07, 0.04);
  handle.rotation.x = -0.4;
  g.add(handle);
  g.add(box(0.055, 0.01, 0.02, lambert(0x9aa3ad), 0, -0.045, -0.11));
  tag(g, 'pk:tape', 'Tape gun — hold over the carton and pull TRIGGER to seal');
  return { group: g, mats: [body, roll] };
}

function makePillow(mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), mat);
  m.scale.set(0.11, 0.045, 0.075);
  return m;
}

// --------------------------------------------------------------- build

export function buildPackStation(scenario) {
  const L = PACK_LAYOUT;
  const station = new THREE.Group();
  station.name = 'pack-station';
  const steelBlue = lambert(0x2f6db5);
  const steel = lambert(0x4b535c);

  // Bench: black ESD top, blue frame (as in the reference stations).
  const B = L.bench;
  const bw = B.x1 - B.x0;
  const bd = B.z1 - B.z0;
  const bx = (B.x0 + B.x1) / 2;
  const bz = (B.z0 + B.z1) / 2;
  station.add(box(bw, 0.04, bd, lambert(0x1d2126), bx, -0.02, bz));
  station.add(box(bw, 0.045, 0.02, lambert(0xd9b21e), bx, -0.02, B.z1 + 0.005));
  for (const [x, z] of [[B.x0 + 0.04, B.z0 + 0.04], [B.x1 - 0.04, B.z0 + 0.04], [B.x0 + 0.04, B.z1 - 0.04], [B.x1 - 0.04, B.z1 - 0.04]]) {
    station.add(box(0.05, 1.4, 0.05, steelBlue, x, -0.74, z));
  }
  station.add(box(bw - 0.08, 0.03, 0.03, steelBlue, bx, -0.5, B.z0 + 0.04));

  // Station sign hanging above.
  const sign = plane(textTexture(['STATION 1 · PACK-OUT', { text: 'Pack customer orders', font: '30px system-ui' }],
    { w: 768, h: 160, font: 'bold 64px system-ui', bg: '#1f2a36', fg: '#ffffff' }), 1.2, 0.25);
  sign.position.set(-0.2, 1.75, -1.6);
  station.add(sign);

  // Incoming tote.
  const T = L.tote;
  const toteMat = lambert(0x2f6db5);
  const tote = new THREE.Group();
  tote.position.set(T.x, 0, T.z);
  tote.add(box(T.w, 0.02, T.d, toteMat, 0, 0.01, 0));
  tote.add(box(T.w, T.h, 0.015, toteMat, 0, T.h / 2, -T.d / 2));
  tote.add(box(T.w, T.h, 0.015, toteMat, 0, T.h / 2, T.d / 2));
  tote.add(box(0.015, T.h, T.d, toteMat, -T.w / 2, T.h / 2, 0));
  tote.add(box(0.015, T.h, T.d, toteMat, T.w / 2, T.h / 2, 0));
  const toteLabelTex = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    drawBarcode(ctx, 14, 12, w - 28, 70, scenario.order.tote);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 30px ui-monospace, monospace';
    ctx.fillText(scenario.order.tote, 20, 116);
  });
  const toteLabel = plane(toteLabelTex, 0.12, 0.06);
  toteLabel.position.set(0, T.h * 0.55, T.d / 2 + 0.009);
  tote.add(toteLabel);
  tag(toteLabel, 'pk:tote', `Order tote ${scenario.order.tote} — scan this label`);
  station.add(tote);

  // Exception bin.
  const E = L.exception;
  const exMat = lambert(0xe0b12b);
  const ex = new THREE.Group();
  ex.position.set(E.x, 0, E.z);
  ex.add(box(E.w, 0.02, E.d, exMat, 0, 0.01, 0));
  ex.add(box(E.w, E.h, 0.015, exMat, 0, E.h / 2, -E.d / 2));
  ex.add(box(E.w, E.h, 0.015, exMat, 0, E.h / 2, E.d / 2));
  ex.add(box(0.015, E.h, E.d, exMat, -E.w / 2, E.h / 2, 0));
  ex.add(box(0.015, E.h, E.d, exMat, E.w / 2, E.h / 2, 0));
  const exLabel = plane(textTexture(['EXCEPTION', { text: 'not on order / problem', font: '26px system-ui' }],
    { w: 512, h: 150, font: 'bold 60px system-ui', bg: '#1a1a1a', fg: '#ffd23f', stripe: '#ffd23f' }), 0.28, 0.082);
  exLabel.position.set(0, E.h * 0.55, E.d / 2 + 0.009);
  ex.add(exLabel);
  station.add(ex);

  // Carton slots (flat cartons, smallest to largest).
  const SL = L.slots;
  const slotMat = lambert(0x3a4350);
  const flats = {};
  for (const key of scenario.cartonOrder) {
    const x = SL.xs[key];
    station.add(box(SL.w, 0.012, SL.d, slotMat, x, 0.006, SL.z));
    station.add(box(0.008, SL.h, SL.d, slotMat, x - SL.w / 2, SL.h / 2, SL.z));
    station.add(box(0.008, SL.h, SL.d, slotMat, x + SL.w / 2, SL.h / 2, SL.z));
    for (let i = 0; i < 3; i++) {
      station.add(box(0.16, 0.018, 0.19, lambert(i % 2 ? 0xa97c49 : 0xb8864f), x, 0.022 + i * 0.019, SL.z));
    }
    const lbl = plane(textTexture([`SIZE ${key}`, { text: scenario.cartons[key].inner, font: '26px system-ui' }],
      { w: 320, h: 120, font: 'bold 46px system-ui', bg: '#10151b', fg: '#ffffff' }), 0.16, 0.06);
    lbl.position.set(x, 0.1, SL.z + SL.d / 2 + 0.002);
    station.add(lbl);
    const flat = makeFlatCarton(key, scenario.cartons[key].size);
    station.add(flat.group);
    flats[key] = flat;
  }

  // Pack scale (pack-on-scale) + readout.
  const P = L.packZone;
  station.add(box(P.w, 0.03, P.d, lambert(0x9aa3ad), P.x, 0.015, P.z));
  const scaleScreen = new ScreenDisplay(0.26, 0.09);
  scaleScreen.mesh.position.set(P.x, 0.05, P.z + P.d / 2 + 0.035);
  scaleScreen.mesh.rotation.x = -0.9;
  station.add(box(0.28, 0.045, 0.06, lambert(0x2d3339), P.x, 0.022, P.z + P.d / 2 + 0.035));
  station.add(scaleScreen.mesh);

  // Erected carton (correct size); hidden until built.
  const carton = makeCarton(scenario.cartons[scenario.correctCarton].size);
  tag(carton.group, 'pk:box', `Order carton ${scenario.order.id}`);
  carton.group.visible = false;
  station.add(carton.group);
  const pillowMat = new THREE.MeshLambertMaterial({ color: 0xeef6ff, transparent: true, opacity: 0.85, emissive: 0x000000 });
  const cartonPillows = [];
  const [cw, , cd] = carton.size;
  const pillowSlots = [[0.02, 0.07, -0.08], [0.02, 0.07, 0.08], [-0.12, 0.13, -0.08], [-0.12, 0.13, 0.08], [0.02, 0.15, 0], [-0.13, 0.04, 0]];
  for (const [x, y, z] of pillowSlots) {
    const p = makePillow(pillowMat);
    p.position.set(x * (cw / 0.32), y, z * (cd / 0.24));
    p.visible = false;
    carton.group.add(p);
    cartonPillows.push(p);
  }
  const shipLabelTex = canvasTexture(256, 384, (ctx, w, h) => {
    ctx.fillStyle = '#fbfbf7';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText('GROUND', 16, 40);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(`ORDER ${scenario.order.id}`, 16, 74);
    ctx.fillText('SHIP TO: DEMO CUSTOMER', 16, 100);
    ctx.fillText(`WT ${scenario.expectedWeightKg.toFixed(2)} KG`, 16, 126);
    drawBarcode(ctx, 16, 150, w - 32, 150, scenario.order.id);
    ctx.font = 'bold 24px ui-monospace, monospace';
    ctx.fillText(scenario.order.id, 16, 340);
  });
  const appliedLabel = plane(shipLabelTex, 0.1, 0.15);
  appliedLabel.rotation.x = -Math.PI / 2;
  appliedLabel.position.set(0.05, carton.size[1] + 0.012, 0);
  appliedLabel.visible = false;
  carton.group.add(appliedLabel);

  // Right column: void fill, label printer, tape gun.
  const BK = L.basket;
  const wire = lambert(0x8d96a0);
  station.add(box(BK.w, 0.008, BK.d, wire, BK.x, 0.004, BK.z));
  for (const [dx, dz, w, d] of [[0, -BK.d / 2, BK.w, 0.006], [0, BK.d / 2, BK.w, 0.006], [-BK.w / 2, 0, 0.006, BK.d], [BK.w / 2, 0, 0.006, BK.d]]) {
    station.add(box(w, BK.h, d, wire, BK.x + dx, BK.h / 2, BK.z + dz));
  }
  for (const [dx, dy, dz] of [[-0.02, 0.03, -0.05], [0.02, 0.03, 0.05], [0, 0.05, 0]]) {
    const p = makePillow(pillowMat);
    p.position.set(BK.x + dx, dy, BK.z + dz);
    station.add(p);
  }
  const pillow = new THREE.Group();
  pillow.add(makePillow(pillowMat));
  tag(pillow, 'pk:pillow', 'Void fill (air pillow) — grab and drop into the carton');
  station.add(pillow);
  const basketLabel = plane(textTexture('VOID FILL', { w: 256, h: 56, font: 'bold 34px system-ui', bg: '#10151b' }), 0.13, 0.028);
  basketLabel.position.set(BK.x, BK.h + 0.03, BK.z + BK.d / 2);
  station.add(basketLabel);

  const PR = L.printer;
  const printerMat = lambert(0xe6e8eb, { emissive: 0x000000 });
  const printer = box(PR.w, PR.h, PR.d, printerMat, PR.x, PR.h / 2, PR.z);
  printer.userData = { kind: 'pk', key: 'pk:printer', label: 'Label printer' };
  station.add(printer);
  station.add(box(PR.w * 0.8, 0.008, 0.01, lambert(0x22272d), PR.x, PR.h * 0.55, PR.z + PR.d / 2 + 0.002));
  const printerScreen = new ScreenDisplay(0.08, 0.035);
  printerScreen.mesh.position.set(PR.x, PR.h + 0.001, PR.z + 0.03);
  printerScreen.mesh.rotation.x = -Math.PI / 2;
  station.add(printerScreen.mesh);
  const label = new THREE.Group();
  const labelMesh = plane(shipLabelTex, 0.1, 0.15);
  labelMesh.material = new THREE.MeshLambertMaterial({ map: shipLabelTex, side: THREE.DoubleSide, emissive: 0x000000 });
  label.add(labelMesh);
  tag(label, 'pk:label', 'Shipping label — grab and place on the carton top');
  label.visible = false;
  station.add(label);

  const tapeGun = makeTapeGun();
  station.add(tapeGun.group);
  const scanner = makeScannerGun();
  station.add(scanner.group);

  // Items.
  const itemStyle = {
    mug: { base: '#f4f4f0', accent: '#2b4a6b', art: mugArt, barcodeFace: 'pz' },
    book: { base: '#1f3557', accent: '#c9a227', art: bookArt, barcodeFace: 'py' },
    case: { base: '#5b2d8e', accent: '#ff7ab6', art: caseArt, barcodeFace: 'py' },
  };
  const items = {};
  for (const key of scenario.itemOrder) {
    const it = makeItem(scenario.items[key], itemStyle[key]);
    station.add(it.group);
    items[key] = it;
  }

  // WMS monitor on an arm.
  const M = L.monitor;
  station.add(box(0.03, 0.44, 0.03, steel, 0.33, 0.22, -0.97));
  const arm = box(0.27, 0.02, 0.02, steel, 0.465, 0.42, -0.95);
  station.add(arm);
  const monitor = new THREE.Group();
  monitor.position.set(M.x, M.y, M.z);
  monitor.rotation.y = Math.atan2(-M.x, -M.z); // face the learner
  monitor.add(box(M.w + 0.02, M.h + 0.02, 0.02, lambert(0x15191e), 0, 0, -0.012));
  const wms = new WmsScreen(M.w, M.h);
  monitor.add(wms.mesh);
  station.add(monitor);

  // Outbound roller conveyor (right) and incoming roller conveyor (left).
  const C = L.conveyor;
  const rollerGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 10);
  rollerGeo.rotateZ(Math.PI / 2);
  const rollerMat = lambert(0xb9c0c7);
  const outLen = C.z0 - C.z1;
  const outRollers = new THREE.InstancedMesh(rollerGeo, rollerMat, Math.ceil(outLen / 0.07));
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < outRollers.count; i++) {
    mtx.compose(new THREE.Vector3(C.x, C.top - 0.022, C.z0 - 0.04 - i * 0.07), new THREE.Quaternion(), new THREE.Vector3(C.w, 1, 1));
    outRollers.setMatrixAt(i, mtx);
  }
  station.add(outRollers);
  const czc = (C.z0 + C.z1) / 2;
  station.add(box(0.03, 0.07, outLen, steelBlue, C.x - C.w / 2 - 0.02, C.top - 0.03, czc));
  station.add(box(0.03, 0.07, outLen, steelBlue, C.x + C.w / 2 + 0.02, C.top - 0.03, czc));
  for (let z = C.z0 - 0.1; z > C.z1; z -= 0.7) {
    station.add(box(0.04, 1.4, 0.04, steelBlue, C.x - C.w / 2 - 0.02, -0.75, z));
    station.add(box(0.04, 1.4, 0.04, steelBlue, C.x + C.w / 2 + 0.02, -0.75, z));
  }
  const signX = C.x + C.w / 2 + 0.09;
  const outSign = plane(textTexture(['OUTBOUND', { text: 'sealed + weighed + labelled', font: '24px system-ui' }],
    { w: 512, h: 150, font: 'bold 60px system-ui', bg: '#133d28', fg: '#e9fff2' }), 0.34, 0.1);
  outSign.position.set(signX, 0.36, C.intakeZ - 0.3);
  station.add(outSign);
  station.add(box(0.025, 1.7, 0.025, steel, signX, -0.54, C.intakeZ - 0.32));

  const inX0 = -2.2;
  const inX1 = B.x0;
  const inZ = T.z;
  const inRollers = new THREE.InstancedMesh(rollerGeo, rollerMat, Math.ceil((inX1 - inX0) / 0.07));
  for (let i = 0; i < inRollers.count; i++) {
    mtx.compose(new THREE.Vector3(inX0 + 0.04 + i * 0.07, -0.03, inZ), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(0.42, 1, 1));
    inRollers.setMatrixAt(i, mtx);
  }
  station.add(inRollers);
  station.add(box(inX1 - inX0, 0.07, 0.03, steelBlue, (inX0 + inX1) / 2, -0.04, inZ - 0.23));
  station.add(box(inX1 - inX0, 0.07, 0.03, steelBlue, (inX0 + inX1) / 2, -0.04, inZ + 0.23));
  for (let x = inX0 + 0.1; x < inX1; x += 0.7) {
    station.add(box(0.04, 1.4, 0.04, steelBlue, x, -0.76, inZ - 0.23));
    station.add(box(0.04, 1.4, 0.04, steelBlue, x, -0.76, inZ + 0.23));
  }
  // A waiting tote upstream, for context.
  const nextTote = box(T.w, T.h, T.d, toteMat, -1.4, T.h / 2 - 0.008, inZ);
  station.add(nextTote);

  // Release control.
  const R = L.releaseButton;
  station.add(box(0.14, 0.12, 0.12, lambert(0x2d3339), R.x, 0.0, R.z));
  const releaseBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 24), lambert(0x2f9e5b, { emissive: 0x000000 }));
  releaseBtn.position.set(R.x, 0.07, R.z);
  releaseBtn.userData = { kind: 'button', action: 'release', label: 'CONFIRM RELEASE (outbound)' };
  station.add(releaseBtn);
  const relLabel = plane(textTexture(['CONFIRM', 'RELEASE'], { w: 256, h: 128, font: 'bold 44px system-ui', bg: '#1b2229' }), 0.12, 0.06);
  relLabel.position.set(R.x, 0.02, R.z + 0.061);
  station.add(relLabel);
  station.add(box(0.04, 1.4, 0.04, steel, R.x, -0.76, R.z));

  // Drop-target volumes (station frame), tested against an object's centre.
  const zone = (x, z, w, d, y0, y1) => ({
    min: new THREE.Vector3(x - w / 2, y0, z - d / 2),
    max: new THREE.Vector3(x + w / 2, y1, z + d / 2),
  });
  const zones = {
    carton: { label: 'CARTON', ...zone(P.x, P.z, P.w, P.d, -0.02, 0.5) },
    tote: { label: 'TOTE', ...zone(T.x, T.z, T.w, T.d, -0.02, 0.4) },
    exception: { label: 'EXCEPTION BIN', ...zone(E.x, E.z, E.w + 0.04, E.d + 0.04, -0.02, 0.45) },
    outbound: { label: 'OUTBOUND', ...zone(C.x, C.intakeZ + 0.05, C.w + 0.08, 0.6, -0.05, 0.55) },
  };

  return {
    station, tote, toteLabel, items, flats, carton, cartonPillows, appliedLabel, pillow, label,
    tapeGun, scanner, printer, printerScreen, scaleScreen, wms, releaseBtn, zones, monitor,
  };
}

/** WMS monitor: order header, item check-off, carton, weight, label. */
export class WmsScreen {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 960;
    this.canvas.height = Math.round(960 * (height / width));
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.mesh.userData = { kind: 'tool', label: 'Order monitor (WMS)' };
    this.key = null;
  }

  /** view: { open, orderId, tote, rows:[{name, sku, fragile, scanned, packed}], exceptions:[{name, sku, state}], carton, weight, range, sealed, confirmed, label } */
  show(view) {
    const key = JSON.stringify(view);
    if (key === this.key) return;
    this.key = key;
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1b6ec2';
    ctx.fillRect(0, 0, W, 64);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(view.open ? `ORDER ${view.orderId}` : 'PACK STATION 1', 22, 33);
    ctx.font = '26px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(view.open ? view.service : 'READY', W - 22, 33);
    ctx.textAlign = 'left';
    if (!view.open) {
      ctx.fillStyle = '#ffd97a';
      ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.fillText('SCAN TOTE TO OPEN ORDER', 40, H / 2 - 20);
      ctx.fillStyle = '#9fb3c8';
      ctx.font = '30px system-ui, sans-serif';
      ctx.fillText(`Tote ${view.tote} is waiting on the left.`, 40, H / 2 + 40);
      this.texture.needsUpdate = true;
      return;
    }
    let y = 100;
    ctx.fillStyle = '#9fb3c8';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('ITEM', 22, y);
    ctx.fillText('QTY', 520, y);
    ctx.fillText('SCAN', 620, y);
    ctx.fillText('PACKED', 760, y);
    y += 44;
    for (const r of view.rows) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '30px system-ui, sans-serif';
      ctx.fillText(r.name, 22, y);
      if (r.fragile) {
        const nameW = ctx.measureText(r.name).width;
        ctx.fillStyle = '#ff8a80';
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.fillText('FRAGILE', 22 + nameW + 14, y);
      }
      ctx.fillStyle = '#9fb3c8';
      ctx.font = '22px ui-monospace, monospace';
      ctx.fillText(r.sku, 22, y + 30);
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('1', 530, y);
      ctx.fillStyle = r.scanned ? '#7ee2a8' : '#5f7187';
      ctx.fillText(r.scanned ? 'OK' : '--', 620, y);
      ctx.fillStyle = r.packed ? '#7ee2a8' : '#5f7187';
      ctx.fillText(r.packed ? 'YES' : '--', 760, y);
      y += 74;
    }
    for (const x of view.exceptions) {
      ctx.fillStyle = x.state === 'diverted' ? '#7ee2a8' : '#ffb36b';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText(`${x.sku} ${x.name}: NOT ON ORDER → ${x.state === 'diverted' ? 'IN EXCEPTION BIN' : 'EXCEPTION BIN'}`, 22, y);
      y += 44;
    }
    ctx.fillStyle = '#25374d';
    ctx.fillRect(0, H - 120, W, 120);
    ctx.font = '26px system-ui, sans-serif';
    ctx.fillStyle = '#cfe0f2';
    ctx.fillText(`CARTON: ${view.carton ?? '--'}`, 22, H - 88);
    ctx.fillText(`WEIGHT: ${view.weight} kg  (expected ${view.range})`, 22, H - 50);
    ctx.textAlign = 'right';
    ctx.fillStyle = view.confirmed ? '#7ee2a8' : view.sealed ? '#ffd97a' : '#cfe0f2';
    ctx.fillText(view.confirmed ? 'WEIGHT OK' : view.sealed ? 'CONFIRM WEIGHT' : 'OPEN', W - 22, H - 88);
    ctx.fillStyle = view.label === 'APPLIED' ? '#7ee2a8' : '#cfe0f2';
    ctx.fillText(`LABEL: ${view.label}`, W - 22, H - 50);
    ctx.textAlign = 'left';
    this.texture.needsUpdate = true;
  }
}
