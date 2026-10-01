// Scene construction: a compact receiving workstation. Units are metres.
// `station` is the bench-top frame: y = 0 is the work surface, the learner
// stands at the origin facing -Z. Raising/lowering the workstation moves the
// whole station group; legs extend below the floor so they never float.
import * as THREE from 'three';
import {
  packageFaceTextures, textTexture, beltTexture, matTexture, brandTexture,
} from './textures.js';
import { Tag, uploadCanvas } from './panel.js';
import { buildHall } from './dressing.js';

// Left to right along the bench: packages roll in from the inbound conveyor
// onto the arrival pad, the quarantine drop bin is sunk into the bench in the
// middle, then the scale (front) and scanner (back), then outbound.
export const LAYOUT = Object.freeze({
  bench: { x0: -0.8, x1: 0.35, z0: -1.0, z1: -0.28 },
  // Arrival pad = a package's "bench" spot (where it rolls in and returns to).
  mat: { x: -0.58, z: -0.54, w: 0.4, d: 0.38 },
  inbound: { z: -0.54, w: 0.44, x0: -2.1, x1: -0.8, queue: [-1.02, -1.44, -1.86] },
  // Quarantine drop bin: rim just above the bench, floor well below it, so
  // rejected packages stack out of the way of the console.
  tote: { x: -0.17, z: -0.55, w: 0.36, d: 0.36, rim: 0.08, floor: -0.34 },
  scale: { x: 0.18, z: -0.5, w: 0.32, d: 0.34, top: 0.062 },
  scanner: { x: 0.17, z: -0.92 },
  scanZone: { x: 0.17, y: 0.2, z: -0.76, w: 0.28, h: 0.26, d: 0.16 },
  conveyor: { x: 0.6, w: 0.46, z0: -0.28, z1: -3.1, top: -0.01, intakeZ: -0.52, endZ: -2.6 },
  releaseButton: { x: 0.9, z: -0.36 },
  // Receiving monitor on its own pole, to the learner's left (as at Station 1).
  monitor: { x: -1.06, y: 0.52, z: -0.84, w: 0.56, h: 0.35 },
  // Bench-height switch under the front edge.
  heightSwitch: { x: -0.12, z: -0.25 },
  // Console stands behind the bench, clear of the outbound conveyor.
  panel: { x: -0.37, z: -1.35, w: 1.15, standingY: 0.86, seatedY: 0.74 },
});

export const PACKAGE_SIZES = {
  A: [0.3, 0.22, 0.26],
  B: [0.36, 0.26, 0.28],
  C: [0.3, 0.2, 0.24],
  D: [0.28, 0.2, 0.26],
};

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function labelPlane(tex, w, h) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
}

// Dent the (+x,+y,+z) corner of a subdivided box: displacement is a pure
// function of position, so coincident vertices on adjacent faces stay welded.
function crushCorner(geo, [w, h, d]) {
  const pos = geo.attributes.position;
  const corner = new THREE.Vector3(w / 2, h / 2, d / 2);
  const center = new THREE.Vector3(0, 0, 0);
  const v = new THREE.Vector3();
  const R = 0.14;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dist = v.distanceTo(corner);
    if (dist < R) {
      const k = (1 - dist / R) ** 2;
      const dir = center.clone().sub(v).normalize();
      const wobble = Math.sin(v.x * 90) * Math.cos(v.z * 70) * 0.006;
      v.addScaledVector(dir, k * 0.065 + wobble * k);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
}

// Punch a dent into the back (-z) face: a puncture only visible once the
// package is turned around.
function punctureBack(geo, [w, h, d]) {
  const pos = geo.attributes.position;
  const c = new THREE.Vector3(w * 0.12, -h * 0.05, -d / 2);
  const v = new THREE.Vector3();
  const R = 0.09;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dist = v.distanceTo(c);
    if (dist < R) {
      const k = (1 - dist / R) ** 2;
      v.z += k * 0.05 + Math.sin(v.x * 120) * 0.003 * k;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
}

const DAMAGE_FACES = {
  corner: { pz: [1, 0], px: [0, 0], py: [1, 1] },
  side: { nz: [0.38, 0.55] },
};
const SEEDS = { A: 11, B: 23, C: 31, D: 47 };

/**
 * Pack six face textures into one 3 × 2 atlas and remap the box's UVs to it,
 * so the package renders with a single material. Face order follows
 * BoxGeometry groups: +x, -x, +y, -y, +z, -z.
 */
function atlasFaces(faces, geo) {
  const S = faces[0].image.width;
  const c = document.createElement('canvas');
  c.width = S * 3;
  c.height = S * 2;
  const ctx = c.getContext('2d');
  faces.forEach((t, i) => {
    ctx.drawImage(t.image, (i % 3) * S, Math.floor(i / 3) * S);
    t.dispose();
  });
  const uv = geo.attributes.uv;
  const idx = geo.index;
  geo.groups.forEach((g, i) => {
    const col = i % 3;
    const row = 1 - Math.floor(i / 3); // canvas row 0 is the top (v = 1)
    const seen = new Set();
    for (let k = g.start; k < g.start + g.count; k++) {
      const vi = idx.getX(k);
      if (seen.has(vi)) continue;
      seen.add(vi);
      uv.setXY(vi, (col + uv.getX(vi)) / 3, (row + uv.getY(vi)) / 2);
    }
  });
  geo.clearGroups();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function buildPackage(key, def) {
  const size = PACKAGE_SIZES[key];
  const [w, h, d] = size;
  const damaged = def.condition === 'damaged';
  const geo = new THREE.BoxGeometry(w, h, d, 10, 10, 10);
  if (def.damage === 'corner') crushCorner(geo, size);
  if (def.damage === 'side') punctureBack(geo, size);
  const faces = packageFaceTextures({
    id: def.id,
    barcode: def.barcode ?? `DG${def.id.slice(-4)}-0000`,
    label: def.label,
    seed: SEEDS[key] ?? 5,
    damage: damaged ? { faces: DAMAGE_FACES[def.damage ?? 'corner'] } : null,
  });
  // One atlas texture (3 × 2 faces) and one material: a single draw call per package.
  const atlas = atlasFaces(faces, geo);
  const mat = new THREE.MeshLambertMaterial({ map: atlas, emissive: 0x000000 });
  const mats = [mat];
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.name = `package-${key}`;
  group.add(mesh);
  if (def.damage === 'corner') {
    // Torn flap lifting away from the crushed corner.
    const flapGeo = new THREE.BufferGeometry();
    flapGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, -0.1, 0, 0, -0.03, 0, -0.09,
    ], 3));
    // Face 2 (+y) sits in atlas cell (2, top row).
    flapGeo.setAttribute('uv', new THREE.Float32BufferAttribute([2 / 3, 0.5, 1, 0.5, 2.5 / 3, 1], 2));
    flapGeo.computeVertexNormals();
    const flap = new THREE.Mesh(flapGeo, new THREE.MeshLambertMaterial({ map: atlas, side: THREE.DoubleSide }));
    flap.position.set(w / 2 - 0.03, h / 2 - 0.035, d / 2 - 0.02);
    flap.rotation.set(-0.5, 0.3, 0.55);
    group.add(flap);
  }
  // Barcode anchor on the +Z face; its local +Z is the barcode's normal.
  const barcodeAnchor = new THREE.Object3D();
  barcodeAnchor.position.set(-0.09 * w, -0.12 * h, d / 2 + 0.001);
  group.add(barcodeAnchor);
  group.userData = { kind: 'package', key, label: `${def.label} — ${def.id}` };
  mesh.userData = group.userData;
  return { key, group, mesh, mats, size, barcodeAnchor };
}

export function buildWorld(scenario) {
  const worldRoot = new THREE.Group();
  worldRoot.name = 'worldRoot';

  // ---------------------------------------------------------------- room
  buildHall(worldRoot); // textured shell, structure, racking, baked shadows
  const brand = labelPlane(brandTexture(scenario.org, scenario.title), 2.0, 0.5);
  brand.position.set(-1.6, 2.2, -3.17);
  worldRoot.add(brand);

  // Outbound dock opening where the conveyor ends.
  const dock = box(0.9, 1.0, 0.02, new THREE.MeshBasicMaterial({ color: 0x0b0d10 }), LAYOUT.conveyor.x, 0.95, -3.17);
  const dockSign = labelPlane(textTexture('OUTBOUND DOCK 3', { w: 512, h: 96, font: 'bold 50px system-ui', bg: '#1d6b3a' }), 0.8, 0.15);
  dockSign.position.set(LAYOUT.conveyor.x, 1.6, -3.16);
  worldRoot.add(dock, dockSign);
  // Opening where Station 1's conveyor carries packed orders toward the dock.
  const packDock = box(0.7, 0.8, 0.02, new THREE.MeshBasicMaterial({ color: 0x0b0e12 }), -2.6, 0.85, -3.17);
  const packDockSign = labelPlane(textTexture('TO DOCK CHECK', { w: 512, h: 96, font: 'bold 48px system-ui', bg: '#1f2a36' }), 0.7, 0.13);
  packDockSign.position.set(-2.6, 1.42, -3.16);
  worldRoot.add(packDock, packDockSign);

  // Standing mat and floor safety lines (stationary: all tasks fit here).
  const standMat = box(0.9, 0.012, 0.6, lambert(0x1f2327), 0, 0.006, 0.05);
  worldRoot.add(standMat);
  const tapeMat = lambert(0xd9b21e);
  worldRoot.add(box(2.2, 0.004, 0.05, tapeMat, 0.1, 0.002, 0.45));
  worldRoot.add(box(0.05, 0.004, 1.6, tapeMat, -1.0, 0.002, -0.3));
  worldRoot.add(box(0.9, 0.012, 0.6, lambert(0x1f2327), -3.2, 0.006, 0.05));
  worldRoot.add(box(2.2, 0.004, 0.05, tapeMat, -3.1, 0.002, 0.45));

  // --------------------------------------------------------------- station
  const station = new THREE.Group();
  station.name = 'station';
  worldRoot.add(station);
  const stationSign = labelPlane(textTexture(['STATION 2 · DOCK CHECK', { text: 'Inspect before loading', font: '30px system-ui' }],
    { w: 768, h: 160, font: 'bold 60px system-ui', bg: '#1f2a36', fg: '#ffffff' }), 1.2, 0.25);
  stationSign.position.set(-0.1, 1.75, -1.6);
  station.add(stationSign);

  const { bench } = LAYOUT;
  const T = LAYOUT.tote;
  const bx = (bench.x0 + bench.x1) / 2;
  const benchMat = lambert(0x7c6a55);
  // Bench top in four pieces around the quarantine bin's cut-out.
  const hx0 = T.x - T.w / 2 - 0.01;
  const hx1 = T.x + T.w / 2 + 0.01;
  const hz0 = T.z - T.d / 2 - 0.01;
  const hz1 = T.z + T.d / 2 + 0.01;
  for (const [x0, x1, z0, z1] of [
    [bench.x0, hx0, bench.z0, bench.z1], [hx1, bench.x1, bench.z0, bench.z1],
    [hx0, hx1, bench.z0, hz0], [hx0, hx1, hz1, bench.z1],
  ]) {
    station.add(box(x1 - x0, 0.04, z1 - z0, benchMat, (x0 + x1) / 2, -0.02, (z0 + z1) / 2));
  }
  station.add(box(bench.x1 - bench.x0, 0.045, 0.02, lambert(0xd9b21e), bx, -0.02, bench.z1 + 0.005));
  const steel = lambert(0x4b535c);
  for (const [x, z] of [[bench.x0 + 0.04, bench.z0 + 0.04], [bench.x1 - 0.04, bench.z0 + 0.04],
    [bench.x0 + 0.04, bench.z1 - 0.04], [bench.x1 - 0.04, bench.z1 - 0.04]]) {
    station.add(box(0.05, 1.4, 0.05, steel, x, -0.74, z));
  }

  // Arrival pad: the end of the inbound line, where each package stops.
  const M0 = LAYOUT.mat;
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(M0.w, M0.d), new THREE.MeshLambertMaterial({ map: matTexture() }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(M0.x, 0.002, M0.z);
  station.add(mat);
  const stop = box(0.03, 0.05, M0.d, lambert(0xd9b21e), M0.x + M0.w / 2 + 0.005, 0.025, M0.z);
  station.add(stop);
  const arrival = labelPlane(textTexture('ARRIVAL', { w: 256, h: 64, font: 'bold 38px system-ui', bg: '#303841' }), 0.16, 0.04);
  arrival.rotation.x = -Math.PI / 2;
  arrival.position.set(M0.x, 0.003, M0.z + M0.d / 2 + 0.03);
  station.add(arrival);

  // Inbound roller conveyor from the left; packages queue on it.
  const I = LAYOUT.inbound;
  const inLen = I.x1 - I.x0;
  const rollerGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 10);
  rollerGeo.rotateX(Math.PI / 2);
  const rollers = new THREE.InstancedMesh(rollerGeo, lambert(0xb9c0c7), Math.floor(inLen / 0.07));
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < rollers.count; i++) {
    mtx.compose(new THREE.Vector3(I.x1 - 0.04 - i * 0.07, -0.022, I.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, I.w));
    rollers.setMatrixAt(i, mtx);
  }
  station.add(rollers);
  const rail = lambert(0x2f6db5);
  for (const sz of [-1, 1]) {
    station.add(box(inLen, 0.06, 0.03, rail, (I.x0 + I.x1) / 2, -0.015, I.z + sz * (I.w / 2 + 0.02)));
    for (let x = I.x0 + 0.1; x < I.x1; x += 0.65) station.add(box(0.04, 1.4, 0.04, rail, x, -0.74, I.z + sz * (I.w / 2 + 0.02)));
  }
  const inSign = labelPlane(textTexture(['INBOUND', { text: 'one package at a time', font: '26px system-ui' }],
    { w: 512, h: 150, font: 'bold 60px system-ui', bg: '#1f2a36', fg: '#ffffff' }), 0.34, 0.1);
  inSign.position.set(I.x0 + 0.25, 0.42, I.z - I.w / 2 - 0.06);
  station.add(inSign);
  station.add(box(0.025, 1.8, 0.025, steel, I.x0 + 0.25, -0.5, I.z - I.w / 2 - 0.075));

  // Quarantine drop bin, sunk into the bench.
  const toteMat = lambert(0xb8452a);
  const tote = new THREE.Group();
  tote.position.set(T.x, 0, T.z);
  const depth = T.rim - T.floor;
  const midY = (T.rim + T.floor) / 2;
  tote.add(box(T.w, 0.02, T.d, toteMat, 0, T.floor - 0.01, 0));
  tote.add(box(T.w, depth, 0.02, toteMat, 0, midY, -T.d / 2));
  tote.add(box(T.w, depth, 0.02, toteMat, 0, midY, T.d / 2));
  tote.add(box(0.02, depth, T.d, toteMat, -T.w / 2, midY, 0));
  tote.add(box(0.02, depth, T.d, toteMat, T.w / 2, midY, 0));
  // Yellow-black rim so the opening reads at a glance.
  const rimMat = lambert(0xffd23f);
  for (const [w, d, x, z] of [[T.w + 0.04, 0.025, 0, -T.d / 2], [T.w + 0.04, 0.025, 0, T.d / 2], [0.025, T.d, -T.w / 2, 0], [0.025, T.d, T.w / 2, 0]]) {
    tote.add(box(w, 0.012, d, rimMat, x, T.rim + 0.006, z));
  }
  const toteLabel = labelPlane(textTexture(['QUARANTINE', { text: 'Damaged / rejected only', font: '28px system-ui' }],
    { w: 512, h: 160, font: 'bold 64px system-ui', bg: '#1a1a1a', fg: '#ffd23f', stripe: '#ffd23f' }), 0.3, 0.075);
  toteLabel.position.set(0, T.rim / 2 - 0.005, T.d / 2 + 0.012);
  tote.add(toteLabel);
  station.add(tote);

  // Receiving monitor on its own floor pole, to the learner's left.
  const MO = LAYOUT.monitor;
  const monitor = new THREE.Group();
  monitor.position.set(MO.x, MO.y, MO.z);
  monitor.rotation.y = Math.atan2(-MO.x, -MO.z); // face the learner
  monitor.add(box(MO.w + 0.025, MO.h + 0.025, 0.025, lambert(0x15191e), 0, 0, -0.014));
  monitor.add(box(0.08, 0.06, 0.03, steel, 0, 0, -0.04));
  monitor.add(box(0.035, 1.8, 0.035, steel, 0, -0.9, -0.07));
  const receiving = new ReceivingScreen(MO.w, MO.h);
  monitor.add(receiving.mesh);
  const monSign = labelPlane(textTexture('RECEIVING MONITOR', { w: 512, h: 72, font: 'bold 42px system-ui', bg: '#1b6ec2' }), 0.34, 0.048);
  monSign.position.set(0, MO.h / 2 + 0.045, 0);
  monitor.add(monSign);
  station.add(monitor);

  // Bench-height switch under the front edge (like a real lift bench).
  const heightSwitch = buildHeightSwitch();
  heightSwitch.group.position.set(LAYOUT.heightSwitch.x, -0.1, LAYOUT.heightSwitch.z);
  station.add(heightSwitch.group);

  // Scale.
  const S = LAYOUT.scale;
  station.add(box(S.w + 0.02, 0.05, S.d + 0.02, lambert(0x2d3339), S.x, 0.025, S.z));
  const plate = box(S.w, 0.012, S.d, lambert(0xb9c0c7), S.x, 0.056, S.z);
  plate.userData = { kind: 'tool', label: 'Scale — place accepted package here' };
  station.add(plate);
  const scaleScreen = new ScreenDisplay(0.28, 0.12);
  scaleScreen.mesh.position.set(S.x, 0.06, S.z + S.d / 2 + 0.05);
  scaleScreen.mesh.rotation.x = -0.9;
  station.add(box(0.3, 0.05, 0.08, lambert(0x2d3339), S.x, 0.02, S.z + S.d / 2 + 0.05));
  station.add(scaleScreen.mesh);

  // Presentation scanner.
  const SC = LAYOUT.scanner;
  const scanner = new THREE.Group();
  scanner.position.set(SC.x, 0, SC.z);
  const scannerBody = lambert(0x24292f);
  scanner.add(box(0.16, 0.02, 0.12, scannerBody, 0, 0.01, 0));
  scanner.add(box(0.04, 0.1, 0.04, scannerBody, 0, 0.07, -0.02));
  const head = box(0.14, 0.1, 0.07, scannerBody, 0, 0.15, 0);
  head.userData = { kind: 'tool', label: 'Scanner — hold barcode in the scan zone, press trigger' };
  scanner.add(head);
  const windowMesh = box(0.11, 0.065, 0.005, new THREE.MeshBasicMaterial({ color: 0x3d0f0f }), 0, 0.15, 0.036);
  scanner.add(windowMesh);
  const scannerScreen = new ScreenDisplay(0.2, 0.07);
  scannerScreen.mesh.position.set(0, 0.215, 0.02);
  scannerScreen.mesh.rotation.x = -0.6;
  scanner.add(scannerScreen.mesh);
  station.add(scanner);

  const Z = LAYOUT.scanZone;
  const scanZone = new THREE.Group();
  scanZone.position.set(Z.x, Z.y, Z.z);
  const zoneGeo = new THREE.BoxGeometry(Z.w, Z.h, Z.d);
  const scanFill = new THREE.Mesh(zoneGeo, new THREE.MeshBasicMaterial({
    color: 0x39d98a, transparent: true, opacity: 0.08, depthWrite: false,
  }));
  const scanEdges = new THREE.LineSegments(new THREE.EdgesGeometry(zoneGeo), new THREE.LineBasicMaterial({ color: 0x39d98a }));
  scanZone.add(scanFill, scanEdges);
  const beam = box(Z.w * 0.9, 0.003, 0.003, new THREE.MeshBasicMaterial({ color: 0xff3030 }), 0, 0, Z.d / 2);
  scanZone.add(beam);
  const scanZoneLabel = labelPlane(textTexture('SCAN ZONE', { w: 256, h: 56, font: 'bold 34px system-ui', bg: '#133d28', fg: '#bff5d8' }), 0.14, 0.03);
  scanZoneLabel.position.set(0, Z.h / 2 + 0.02, 0);
  scanZone.add(scanZoneLabel);
  station.add(scanZone);

  // Outbound conveyor.
  const C = LAYOUT.conveyor;
  const conveyor = new THREE.Group();
  const len = C.z0 - C.z1;
  const cz = (C.z0 + C.z1) / 2;
  const belt = beltTexture();
  belt.repeat.set(1, len * 6);
  const beltMesh = new THREE.Mesh(new THREE.PlaneGeometry(C.w, len), new THREE.MeshLambertMaterial({ map: belt }));
  beltMesh.rotation.x = -Math.PI / 2;
  beltMesh.position.set(C.x, C.top, cz);
  conveyor.add(beltMesh);
  conveyor.add(box(C.w + 0.06, 0.08, len, steel, C.x, C.top - 0.045, cz));
  conveyor.add(box(0.025, 0.04, len, lambert(0x9aa3ad), C.x - C.w / 2 - 0.015, C.top + 0.01, cz));
  conveyor.add(box(0.025, 0.04, len, lambert(0x9aa3ad), C.x + C.w / 2 + 0.015, C.top + 0.01, cz));
  for (let z = C.z0 - 0.1; z > C.z1; z -= 0.7) {
    conveyor.add(box(0.04, 1.4, 0.04, steel, C.x - C.w / 2, -0.75, z));
    conveyor.add(box(0.04, 1.4, 0.04, steel, C.x + C.w / 2, -0.75, z));
  }
  const intakeMarker = labelPlane(textTexture(['OUTBOUND', { text: 'accepted + verified only', font: '26px system-ui' }],
    { w: 512, h: 150, font: 'bold 60px system-ui', bg: '#133d28', fg: '#e9fff2' }), 0.34, 0.1);
  // Sign stands on its own post beside the belt so nothing obstructs the conveyor.
  const signX = C.x + C.w / 2 + 0.09;
  intakeMarker.position.set(signX, 0.36, C.intakeZ - 0.3);
  conveyor.add(intakeMarker);
  conveyor.add(box(0.025, 1.7, 0.025, steel, signX, -0.54, C.intakeZ - 0.32));
  station.add(conveyor);

  // Physical release control on a pedestal beside the conveyor.
  const R = LAYOUT.releaseButton;
  const pedestal = box(0.14, 0.12, 0.12, lambert(0x2d3339), R.x, 0.0, R.z);
  const releaseBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 24), lambert(0x2f9e5b, { emissive: 0x000000 }));
  releaseBtn.position.set(R.x, 0.07, R.z);
  releaseBtn.userData = { kind: 'button', action: 'release', label: 'CONFIRM RELEASE (outbound)' };
  const releaseLabel = labelPlane(textTexture(['CONFIRM', 'RELEASE'], { w: 256, h: 128, font: 'bold 44px system-ui', bg: '#1b2229' }), 0.12, 0.06);
  releaseLabel.position.set(R.x, 0.02, R.z + 0.061);
  station.add(pedestal, releaseBtn, releaseLabel);
  station.add(box(0.04, 1.4, 0.04, steel, R.x, -0.76, R.z));

  // --------------------------------------------------------------- packages
  const packages = {};
  for (const key of scenario.order) {
    const p = buildPackage(key, scenario.packages[key]);
    station.add(p.group);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(p.size[0] / 0.34, p.size[2] / 0.34, 1);
    station.add(shadow);
    p.shadow = shadow;
    packages[key] = p;
  }

  // Practice box used during comfort setup (never scored).
  const practice = new THREE.Group();
  const practiceMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), lambert(0x8795a3, { emissive: 0x000000 }));
  practice.add(practiceMesh);
  practice.userData = { kind: 'practice', key: 'practice', label: 'Practice box — grab and release' };
  practiceMesh.userData = practice.userData;
  station.add(practice);

  // --------------------------------------------------------------- zones
  // Drop-target volumes in station coordinates, tested against a package's centre.
  const zones = {
    quarantine: {
      label: 'QUARANTINE', min: new THREE.Vector3(T.x - T.w / 2, T.floor - 0.05, T.z - T.d / 2),
      max: new THREE.Vector3(T.x + T.w / 2, 0.65, T.z + T.d / 2),
      // `below`: height of packages already in the bin (they stack).
      slot: (size, below = 0) => new THREE.Vector3(T.x, T.floor + below + size[1] / 2, T.z),
    },
    scale: {
      label: 'SCALE', min: new THREE.Vector3(S.x - S.w / 2, 0.0, S.z - S.d / 2 - 0.02),
      max: new THREE.Vector3(S.x + S.w / 2 + 0.02, 0.5, S.z + S.d / 2 + 0.02),
      slot: (size) => new THREE.Vector3(S.x, S.top + size[1] / 2, S.z),
    },
    outbound: {
      label: 'OUTBOUND', min: new THREE.Vector3(C.x - C.w / 2 - 0.04, -0.05, C.intakeZ - 0.3),
      max: new THREE.Vector3(C.x + C.w / 2 + 0.04, 0.55, C.z0 + 0.05),
      slot: (size) => new THREE.Vector3(C.x, C.top + size[1] / 2, C.intakeZ),
    },
  };
  for (const [name, z] of Object.entries(zones)) {
    const size = new THREE.Vector3().subVectors(z.max, z.min);
    const g = new THREE.BoxGeometry(size.x, size.y, size.z);
    const hl = new THREE.Group();
    hl.position.addVectors(z.min, z.max).multiplyScalar(0.5);
    const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    hl.add(fill, edges);
    hl.visible = false;
    hl.name = `zone-${name}`;
    station.add(hl);
    z.highlight = { group: hl, fill, edges };
  }

  // Guidance marker: ring + tag over the next relevant tool (local prompt).
  const marker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 8, 32), new THREE.MeshBasicMaterial({ color: 0xe0a526 }));
  ring.rotation.x = Math.PI / 2;
  const markerTag = new Tag({ width: 0.24, height: 0.06 });
  markerTag.mesh.position.y = 0.06;
  marker.add(ring, markerTag.mesh);
  marker.visible = false;
  station.add(marker);

  // Hover tag, reused for whatever is focused.
  const hoverTag = new Tag({ width: 0.34, height: 0.07 });
  worldRoot.add(hoverTag.mesh);

  // --------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xe6edf5, 0x403a33, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-1.2, 3, 1.5);
  worldRoot.add(hemi, sun);

  return {
    worldRoot, station, packages, practice, zones, marker, markerTag, hoverTag,
    scaleScreen, scannerScreen, scanZone: { group: scanZone, fill: scanFill, edges: scanEdges },
    belt, releaseBtn, plate, scannerHead: head, receiving, monitor, heightSwitch,
  };
}

/** Small emissive-look screen for instrument readouts. */
export class ScreenDisplay {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = Math.round(512 * (height / width));
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.key = null;
  }

  /** lines: [{text, size, color, bold}] */
  show(lines, { bg = '#07120c', border = '#2b3a33' } = {}) {
    const key = JSON.stringify([lines, bg, border]);
    if (key === this.key) return;
    this.key = key;
    const { ctx, canvas } = this;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = border;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const total = lines.reduce((a, l) => a + (l.size ?? 40) * 1.2, 0);
    let y = (canvas.height - total) / 2;
    for (const l of lines) {
      const size = l.size ?? 40;
      ctx.font = `${l.bold ? 'bold ' : ''}${size}px ui-monospace, "Roboto Mono", monospace`;
      ctx.fillStyle = l.color ?? '#9dffc9';
      y += size * 0.6;
      ctx.fillText(l.text, canvas.width / 2, y);
      y += size * 0.6;
    }
    uploadCanvas(this.texture, this.canvas);
  }
}

/**
 * Bench-height switch: labelled LOWER / RAISE buttons and a cm readout,
 * mounted under the bench's front edge like a real lift bench. Buttons are
 * ray targets (`kind: 'button'`) that dispatch height:down / height:up.
 */
export function buildHeightSwitch() {
  const g = new THREE.Group();
  g.name = 'height-switch';
  const tilt = new THREE.Group();
  tilt.rotation.x = -0.6; // face up toward the learner
  g.add(tilt);
  tilt.add(box(0.27, 0.105, 0.03, lambert(0x15191e), 0, 0, -0.016));
  const title = labelPlane(textTexture('BENCH HEIGHT', { w: 512, h: 64, font: 'bold 44px system-ui', bg: '#15191e', fg: '#ffc23d' }), 0.22, 0.028);
  title.position.set(0, 0.033, 0.001);
  tilt.add(title);
  const mk = (action, text, x) => {
    // Raised key: a plain block (merged with the housing) + a textured face that is the ray target.
    tilt.add(box(0.085, 0.048, 0.012, lambert(0x1f6fd1), x, -0.016, 0.0));
    const tex = textTexture(text, { w: 256, h: 128, font: 'bold 52px system-ui', bg: '#1f6fd1', fg: '#ffffff' });
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.048), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x000000 }));
    b.position.set(x, -0.016, 0.0065);
    b.userData = { kind: 'button', action, label: text === '▼ LOWER' ? 'Lower the bench' : 'Raise the bench' };
    tilt.add(b);
    return b;
  };
  const down = mk('height:down', '▼ LOWER', -0.085);
  const up = mk('height:up', '▲ RAISE', 0.085);
  const readout = new ScreenDisplay(0.07, 0.034);
  readout.mesh.position.set(0, -0.016, 0.002);
  tilt.add(readout.mesh);
  return { group: g, buttons: [down, up], readout };
}

/**
 * Receiving monitor (Station 2): the inbound queue, the package at the bench
 * and — once its label is scanned — what is inside and what it should weigh.
 */
export class ReceivingScreen {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 960;
    this.canvas.height = Math.round(960 * (height / width));
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.mesh.userData = { kind: 'tool', label: 'Receiving monitor' };
    this.key = null;
  }

  /**
   * view: { index, count, queue: [{ key, label, status }],
   *         active: { label, id, from, contents, fragile, range, card } | null,
   *         weight, weightStatus }
   * card: 'inspect' | 'quarantine' | 'scan' | 'details' | 'done'
   */
  show(view) {
    const key = JSON.stringify(view);
    if (key === this.key) return;
    this.key = key;
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const F = 'system-ui, sans-serif';
    const rr = (x, y, w, h, r) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    };
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1b6ec2';
    ctx.fillRect(0, 0, W, 64);
    ctx.fillStyle = '#fff';
    ctx.font = `bold 34px ${F}`;
    ctx.fillText('RECEIVING · DOCK 3', 24, 33);
    ctx.textAlign = 'right';
    ctx.font = `bold 28px ${F}`;
    ctx.fillText(view.count ? `PACKAGE ${Math.min(view.index + 1, view.count)} OF ${view.count}` : '', W - 24, 33);
    ctx.textAlign = 'left';

    // Left: the inbound queue.
    const colW = 300;
    const STATUS = {
      waiting: ['ON CONVEYOR', '#22344a', '#8fa6bf'],
      bench: ['AT BENCH', '#ffc23d', '#1a1405'],
      quarantined: ['QUARANTINED', '#c0392b', '#ffffff'],
      shipped: ['SHIPPED', '#2fae66', '#08130c'],
    };
    let y = 90;
    const rowH = (H - 64 - 110) / Math.max(4, view.queue.length);
    for (const q of view.queue) {
      const [text, bg, fg] = STATUS[q.status] ?? STATUS.waiting;
      const on = q.status === 'bench';
      if (on) {
        ctx.fillStyle = '#16314d';
        rr(10, y - 6, colW - 10, rowH - 8, 12);
        ctx.fill();
      }
      ctx.fillStyle = on ? '#ffffff' : '#9fb3c8';
      ctx.font = `bold 30px ${F}`;
      ctx.fillText(q.label, 24, y + 20);
      ctx.font = `bold 18px ${F}`;
      const pw = ctx.measureText(text).width + 22;
      ctx.fillStyle = bg;
      rr(24, y + 42, pw, 28, 14);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.fillText(text, 35, y + 57);
      y += rowH;
    }

    // Right: card for the package at the bench.
    const cx = colW + 20;
    const cw = W - cx - 20;
    const cy = 82;
    const ch = H - cy - 112;
    const a = view.active;
    const cards = {
      inspect: ['#2b2410', '#ffc23d', 'INSPECT IT', 'Turn it. Check every side.'],
      quarantine: ['#2e1110', '#ff7a6b', 'QUARANTINE', 'Damaged. Do not ship.'],
      scan: ['#2b2410', '#ffc23d', 'SCAN THE LABEL', 'Shows what’s inside + weight'],
      done: ['#0f2a1b', '#7ee2a8', 'ALL DONE', 'Every package handled.'],
    };
    const card = a?.card ?? 'done';
    if (card !== 'details') {
      const [bg, fg, title, sub] = cards[card];
      ctx.fillStyle = bg;
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = fg;
      ctx.lineWidth = 8;
      ctx.strokeRect(cx + 4, cy + 4, cw - 8, ch - 8);
      ctx.textAlign = 'center';
      if (a) {
        ctx.fillStyle = '#cfe0f2';
        ctx.font = `bold 30px ${F}`;
        ctx.fillText(a.label.toUpperCase(), cx + cw / 2, cy + 46);
      }
      ctx.fillStyle = fg;
      ctx.font = `bold 66px ${F}`;
      ctx.fillText(title, cx + cw / 2, cy + ch / 2);
      ctx.fillStyle = '#cfe0f2';
      ctx.font = `30px ${F}`;
      ctx.fillText(sub, cx + cw / 2, cy + ch / 2 + 62);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#12283a';
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = '#2f6db5';
      ctx.lineWidth = 3;
      ctx.strokeRect(cx + 2, cy + 2, cw - 4, ch - 4);
      let ty = cy + 40;
      ctx.fillStyle = '#7ee2a8';
      ctx.font = `bold 26px ${F}`;
      ctx.fillText('✓ SCANNED', cx + 24, ty);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 34px ui-monospace, monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(a.id, cx + cw - 24, ty);
      ctx.textAlign = 'left';
      ty += 50;
      ctx.fillStyle = '#9fb3c8';
      ctx.font = `24px ${F}`;
      ctx.fillText(`FROM  ${a.from}`, cx + 24, ty);
      ty += 44;
      ctx.fillText('CONTAINS', cx + 24, ty);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 32px ${F}`;
      for (const c of a.contents) {
        ty += 42;
        ctx.fillText(c, cx + 36, ty);
      }
      if (a.fragile) {
        ty += 46;
        ctx.font = `bold 22px ${F}`;
        ctx.fillStyle = '#ff8a80';
        rr(cx + 36, ty - 16, 120, 32, 16);
        ctx.fill();
        ctx.fillStyle = '#2a0a08';
        ctx.fillText('FRAGILE', cx + 50, ty + 1);
      }
      ctx.fillStyle = '#ffc23d';
      ctx.font = `bold 26px ${F}`;
      ctx.fillText('EXPECTED WEIGHT', cx + 24, cy + ch - 70);
      ctx.font = `bold 46px ${F}`;
      ctx.fillText(`${a.range} kg`, cx + 24, cy + ch - 30);
    }

    // Bottom: live scale reading.
    ctx.fillStyle = '#25374d';
    ctx.fillRect(0, H - 96, W, 96);
    ctx.fillStyle = '#9fb3c8';
    ctx.font = `bold 24px ${F}`;
    ctx.fillText('SCALE', 24, H - 48);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 40px ${F}`;
    ctx.fillText(view.weight == null ? '--' : `${view.weight.toFixed(2)} kg`, 120, H - 48);
    ctx.textAlign = 'right';
    ctx.font = `bold 28px ${F}`;
    const ws = view.weightStatus ?? '';
    ctx.fillStyle = ws.startsWith('✓') ? '#7ee2a8' : ws ? '#ffd97a' : '#9fb3c8';
    ctx.fillText(ws, W - 24, H - 48);
    ctx.textAlign = 'left';
    uploadCanvas(this.texture, this.canvas);
  }
}
