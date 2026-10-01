// Warehouse hall: textured shell, structure, racking and baked contact
// shadows. Everything is generated at load (no downloads), lit by the
// existing two lights with ambient occlusion painted into the textures, and
// batched: shared materials + instancing keep the added cost to a handful of
// draw calls on Quest 2. Purely scenery: nothing here is interactive.
import * as THREE from 'three';
import { canvasTexture, paintCardboard } from './textures.js';

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

// Hall extents (world coordinates, metres).
const HALL = { x0: -6.8, x1: 4.8, z0: -3.25, z1: 3.2, h: 4.2 };

// ------------------------------------------------------------- textures

function floorTexture() {
  // One 3.5 m slab per tile: polished concrete, aggregate, saw-cut joints, wear.
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const r = rng(7);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#80848a');
    g.addColorStop(1, '#73777d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      // Soft cloudy variation (trowel marks / curing).
      const x = r() * w;
      const y = r() * h;
      const rad = 80 + r() * 220;
      const cg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const tone = r() > 0.5 ? '255,255,255' : '20,22,26';
      cg.addColorStop(0, `rgba(${tone},${0.04 + r() * 0.05})`);
      cg.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 26000; i++) {
      const v = 70 + Math.floor(r() * 90);
      ctx.fillStyle = `rgba(${v},${v},${v + 3},${0.18 + r() * 0.2})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    // Tyre scuffs.
    ctx.strokeStyle = 'rgba(30,30,32,0.06)';
    for (let i = 0; i < 6; i++) {
      ctx.lineWidth = 14 + r() * 10;
      ctx.beginPath();
      ctx.moveTo(r() * w, 0);
      ctx.bezierCurveTo(r() * w, h * 0.3, r() * w, h * 0.7, r() * w, h);
      ctx.stroke();
    }
    // Saw-cut joints on the slab edges.
    ctx.strokeStyle = 'rgba(25,26,30,0.75)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  }, { repeat: [1, 1] });
}

function blockWallTexture() {
  // Painted concrete block (CMU), 0.4 × 0.2 m units; AO darkening at the base.
  return canvasTexture(512, 512, (ctx, w, h) => {
    const r = rng(11);
    ctx.fillStyle = '#b8bcc0';
    ctx.fillRect(0, 0, w, h);
    const bw = w / 4;
    const bh = h / 8;
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let col = -1; col < 5; col++) {
        const v = 176 + Math.floor(r() * 18);
        ctx.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
        ctx.fillRect(col * bw + off + 3, row * bh + 3, bw - 6, bh - 6);
      }
    }
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(60,60,60,${r() * 0.12})`;
      ctx.fillRect(r() * w, r() * h, 2, 2);
    }
  }, { repeat: [1, 1] });
}

function metalWallTexture() {
  // Vertical corrugated cladding, one 1 m panel per tile, with seam and grime.
  return canvasTexture(256, 512, (ctx, w, h) => {
    const r = rng(23);
    for (let x = 0; x < w; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, '#7c858f');
      g.addColorStop(0.5, '#a8b0b8');
      g.addColorStop(1, '#6f7881');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 16, h);
    }
    ctx.fillStyle = 'rgba(30,34,40,0.6)';
    ctx.fillRect(0, 0, 3, h);
    const grime = ctx.createLinearGradient(0, h, 0, h * 0.6);
    grime.addColorStop(0, 'rgba(40,36,30,0.25)');
    grime.addColorStop(1, 'rgba(40,36,30,0)');
    ctx.fillStyle = grime;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = `rgba(40,40,40,${r() * 0.08})`;
      ctx.fillRect(r() * w, r() * h, 1, 3 + r() * 6);
    }
  }, { repeat: [1, 1] });
}

function shadowTexture() {
  // Soft rectangular contact shadow (baked AO) for under equipment.
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { srgb: false });
}

// -------------------------------------------------------------- helpers

/** Box whose UVs are scaled so a shared texture tiles at `tile` metres. */
function tiledBox(w, h, d, mat, tile, x, y, z) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  // BoxGeometry faces: ±x (d × h), ±y (w × d), ±z (w × h); 4 vertices each.
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / tile[0], uv.getY(k) * dims[f][1] / tile[1]);
    }
  }
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.userData.sharedMaterial = true;
  return m;
}

function solid(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// ---------------------------------------------------------------- build

export function buildHall(root) {
  const { x0, x1, z0, z1, h } = HALL;
  const W = x1 - x0;
  const D = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hall = new THREE.Group();
  hall.name = 'hall';

  // Floor: 3.5 m slabs.
  const floorMat = new THREE.MeshLambertMaterial({ map: floorTexture() });
  floorMat.map.wrapS = floorMat.map.wrapT = THREE.RepeatWrapping;
  const floorGeo = new THREE.PlaneGeometry(14, 14);
  const fuv = floorGeo.attributes.uv;
  for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 4, fuv.getY(i) * 4);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.x = -1;
  hall.add(floor);

  // Walls: block to 1.2 m, corrugated cladding above, clerestory windows.
  const blockMat = new THREE.MeshLambertMaterial({ map: blockWallTexture() });
  const metalMat = new THREE.MeshLambertMaterial({ map: metalWallTexture() });
  for (const m of [blockMat, metalMat]) m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
  const blockH = 1.2;
  const winH = 0.7;
  const winY = 3.0;
  const walls = [
    { len: W, x: cx, z: z0, rotY: 0 },
    { len: W, x: cx, z: z1, rotY: Math.PI },
    { len: D, x: x0, z: cz, rotY: Math.PI / 2 },
    { len: D, x: x1, z: cz, rotY: -Math.PI / 2 },
  ];
  const winMat = new THREE.MeshBasicMaterial({ color: 0xdfeaf5, toneMapped: false });
  const mullionMat = new THREE.MeshLambertMaterial({ color: 0x3b4148 });
  const steel = new THREE.MeshLambertMaterial({ color: 0x5a6672 });
  for (const wl of walls) {
    const g = new THREE.Group();
    g.position.set(wl.x, 0, wl.z);
    g.rotation.y = wl.rotY;
    g.add(tiledBox(wl.len, blockH, 0.12, blockMat, [1.6, 0.8], 0, blockH / 2, 0));
    const upperH = h - blockH;
    g.add(tiledBox(wl.len, upperH, 0.08, metalMat, [1.0, upperH], 0, blockH + upperH / 2, -0.02));
    // Window band and mullions (inside face).
    const band = new THREE.Mesh(new THREE.PlaneGeometry(wl.len - 0.4, winH), winMat);
    band.position.set(0, winY, 0.025);
    g.add(band);
    for (let x = -wl.len / 2 + 0.2; x <= wl.len / 2 - 0.2 + 1e-6; x += 1.2) g.add(solid(0.06, winH + 0.06, 0.04, mullionMat, x, winY, 0.035));
    g.add(solid(wl.len - 0.3, 0.06, 0.05, mullionMat, 0, winY + winH / 2, 0.035));
    g.add(solid(wl.len - 0.3, 0.06, 0.05, mullionMat, 0, winY - winH / 2, 0.035));
    // Yellow-black kick rail at the base of the block wall.
    g.add(solid(wl.len, 0.1, 0.02, new THREE.MeshLambertMaterial({ color: 0xd9b21e }), 0, 0.05, 0.07));
    hall.add(g);
  }

  // Steel columns along the long walls.
  // Spaced to clear both conveyor openings in the back wall.
  for (let x = x0 + 0.8; x < x1 - 0.5; x += 2.9) {
    for (const z of [z0 + 0.15, z1 - 0.15]) hall.add(solid(0.22, h, 0.22, steel, x, h / 2, z));
  }

  // Roof: deck, trusses, high-bay lights.
  hall.add(solid(W, 0.05, D, new THREE.MeshLambertMaterial({ color: 0x3c424a }), cx, h, cz));
  const truss = new THREE.MeshLambertMaterial({ color: 0x6b7680 });
  for (let x = x0 + 0.8; x < x1 - 0.5; x += 2.9) {
    hall.add(solid(0.12, 0.35, D, truss, x, h - 0.25, cz));
    hall.add(solid(0.06, 0.06, D, truss, x, h - 0.55, cz));
  }
  for (let z = z0 + 1.0; z < z1; z += 2.0) hall.add(solid(W, 0.08, 0.08, truss, cx, h - 0.45, z));
  const lampBody = new THREE.MeshLambertMaterial({ color: 0x2a2f36 });
  const lampGlow = new THREE.MeshBasicMaterial({ color: 0xfff6e2, toneMapped: false });
  for (const [x, z] of [[-4.4, -1.4], [-2.0, -1.4], [0.0, -1.4], [2.4, -1.4], [-4.4, 1.4], [-2.0, 1.4], [0.0, 1.4], [2.4, 1.4]]) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.18, 16), lampBody);
    body.position.set(x, h - 0.85, z);
    hall.add(body);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.27, 16), lampGlow);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(x, h - 0.945, z);
    hall.add(glow);
    hall.add(solid(0.015, 0.6, 0.015, truss, x, h - 0.45, z));
  }

  // Floor markings: walkway lanes behind the stations and around the racks.
  const lane = new THREE.MeshLambertMaterial({ color: 0xd9b21e });
  hall.add(solid(W - 1.0, 0.004, 0.08, lane, cx, 0.003, 1.1));
  hall.add(solid(W - 1.0, 0.004, 0.08, lane, cx, 0.003, 1.9));
  for (let x = x0 + 0.8; x < x1 - 0.6; x += 0.9) hall.add(solid(0.45, 0.004, 0.08, new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }), x, 0.003, 1.5));

  // Pallet racking: behind the learner (z ≈ 2.7) and along the right wall.
  const r = rng(31);
  const upright = new THREE.MeshLambertMaterial({ color: 0x1f4f8f });
  const beam = new THREE.MeshLambertMaterial({ color: 0xe0701e });
  const deck = new THREE.MeshLambertMaterial({ color: 0x8a6a45 });
  const boxSlots = [];
  const addRack = (x, z, bays, along) => {
    const bayW = 2.4;
    const depth = 0.9;
    const levels = [0.12, 1.25, 2.4];
    for (let b = 0; b <= bays; b++) {
      for (const dz of [-depth / 2, depth / 2]) {
        const ox = along === 'x' ? b * bayW : dz;
        const oz = along === 'x' ? dz : b * bayW;
        hall.add(solid(0.08, 3.4, 0.08, upright, x + ox, 1.7, z + oz));
      }
    }
    for (let b = 0; b < bays; b++) {
      for (const ly of levels) {
        const mx = along === 'x' ? x + (b + 0.5) * bayW : x;
        const mz = along === 'x' ? z : z + (b + 0.5) * bayW;
        const [bw, bd] = along === 'x' ? [bayW, depth] : [depth, bayW];
        for (const s of [-1, 1]) {
          const ex = along === 'x' ? 0 : s * depth / 2;
          const ez = along === 'x' ? s * depth / 2 : 0;
          hall.add(solid(along === 'x' ? bayW : 0.06, 0.1, along === 'x' ? 0.06 : bayW, beam, mx + ex, ly + 0.05, mz + ez));
        }
        hall.add(solid(bw - 0.05, 0.03, bd - 0.05, deck, mx, ly + 0.115, mz));
        // Cartons on each level, varied sizes.
        let cursor = -bayW / 2 + 0.1;
        while (cursor < bayW / 2 - 0.4) {
          const sw = 0.3 + r() * 0.3;
          const sh = 0.25 + r() * 0.45;
          const sd = 0.35 + r() * 0.4;
          const stack = r() > 0.55 ? 2 : 1;
          for (let k = 0; k < stack; k++) {
            const px = along === 'x' ? mx + cursor + sw / 2 : mx + (r() - 0.5) * 0.15;
            const pz = along === 'x' ? mz + (r() - 0.5) * 0.15 : mz + cursor + sw / 2;
            boxSlots.push({ x: px, y: ly + 0.13 + sh / 2 + k * sh, z: pz, sx: along === 'x' ? sw : sd, sy: sh, sz: along === 'x' ? sd : sw, rot: (r() - 0.5) * 0.12 });
          }
          cursor += sw + 0.04 + r() * 0.08;
        }
      }
    }
  };
  addRack(-6.4, 2.45, 4, 'x');
  addRack(4.2, -2.6, 2, 'z');

  // Floor-standing pallets of stock (pallet + carton stack) for depth.
  const palletMat = new THREE.MeshLambertMaterial({ color: 0x9a7a52 });
  for (const [x, z] of [[-6.1, 0.6], [2.6, 1.5], [1.6, -2.4]]) {
    hall.add(solid(1.2, 0.14, 1.0, palletMat, x, 0.07, z));
    for (let i = 0; i < 6; i++) {
      boxSlots.push({ x: x - 0.3 + (i % 2) * 0.6, y: 0.14 + 0.2 + Math.floor(i / 2) * 0.4, z: z + (r() - 0.5) * 0.1, sx: 0.55, sy: 0.4, sz: 0.85, rot: (r() - 0.5) * 0.08 });
    }
  }

  // All stock cartons in one instanced draw call.
  const cartonMat = new THREE.MeshLambertMaterial({
    map: canvasTexture(256, 256, (ctx, w, hh) => {
      paintCardboard(ctx, w, hh, 5);
      ctx.fillStyle = 'rgba(214,170,110,0.9)';
      ctx.fillRect(0, hh * 0.44, w, hh * 0.12);
      ctx.fillStyle = '#f5f2ea';
      ctx.fillRect(w * 0.12, hh * 0.62, w * 0.34, hh * 0.22);
    }),
  });
  const cartons = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cartonMat, boxSlots.length);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  boxSlots.forEach((b, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
    mtx.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.sx, b.sy, b.sz));
    cartons.setMatrixAt(i, mtx);
    const t = 0.82 + r() * 0.22;
    cartons.setColorAt(i, col.setRGB(t, t * (0.95 + r() * 0.05), t * (0.9 + r() * 0.08)));
  });
  hall.add(cartons);

  // Baked contact shadows under the stations and conveyors.
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, color: 0xffffff });
  for (const [x, z, w, d] of [
    [-0.22, -0.64, 1.6, 1.2], [-3.42, -0.64, 1.6, 1.2], // benches
    [0.6, -1.7, 0.9, 3.3], [-2.6, -1.7, 0.9, 3.3], // outbound conveyors
    [-4.7, -0.5, 1.9, 0.8], // incoming rollers
  ]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shadowMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.004, z);
    s.userData.sharedMaterial = true;
    hall.add(s);
  }

  // Flatten per-wall groups into the hall so the batcher can merge like
  // materials across all four walls into single draw calls.
  hall.updateMatrixWorld(true);
  for (const g of hall.children.filter((c) => c.isGroup)) {
    for (const c of [...g.children]) hall.attach(c);
    hall.remove(g);
  }
  root.add(hall);
  return hall;
}
