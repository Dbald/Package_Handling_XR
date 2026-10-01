// Scene construction: a compact receiving workstation. Units are metres.
// `station` is the bench-top frame: y = 0 is the work surface, the learner
// stands at the origin facing -Z. Raising/lowering the workstation moves the
// whole station group; legs extend below the floor so they never float.
import * as THREE from 'three';
import {
  packageFaceTextures, textTexture, concreteTexture, beltTexture, matTexture, brandTexture,
} from './textures.js';
import { Tag } from './panel.js';

export const LAYOUT = Object.freeze({
  bench: { x0: -0.8, x1: 0.35, z0: -1.0, z1: -0.28 },
  mat: { x: -0.14, z: -0.52, w: 0.36, d: 0.34 },
  incoming: { x: -0.16, z: -0.85 },
  tote: { x: -0.59, z: -0.55, w: 0.4, d: 0.4, h: 0.2 },
  scale: { x: 0.17, z: -0.5, w: 0.34, d: 0.34, top: 0.062 },
  scanner: { x: 0.17, z: -0.92 },
  scanZone: { x: 0.17, y: 0.2, z: -0.76, w: 0.28, h: 0.26, d: 0.16 },
  conveyor: { x: 0.6, w: 0.46, z0: -0.28, z1: -3.1, top: -0.01, intakeZ: -0.52, endZ: -2.6 },
  releaseButton: { x: 0.9, z: -0.36 },
  panel: { x: -0.1, z: -1.35, standingY: 0.8, seatedY: 0.72 },
});

export const PACKAGE_SIZES = { A: [0.34, 0.24, 0.27], B: [0.36, 0.26, 0.28] };

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

function buildPackage(key, def) {
  const size = PACKAGE_SIZES[key];
  const [w, h, d] = size;
  const damaged = def.condition === 'damaged';
  const geo = new THREE.BoxGeometry(w, h, d, 10, 10, 10);
  if (damaged) crushCorner(geo, size);
  const faces = packageFaceTextures({
    id: def.id,
    barcode: def.barcode ?? `DG${def.id.slice(-4)}-0000`,
    label: def.label,
    seed: key === 'A' ? 11 : 23,
    damage: damaged ? { faces: { pz: [1, 0], px: [0, 0], py: [1, 1] } } : null,
  });
  const mats = faces.map((map) => new THREE.MeshLambertMaterial({ map, emissive: 0x000000 }));
  const mesh = new THREE.Mesh(geo, mats);
  const group = new THREE.Group();
  group.name = `package-${key}`;
  group.add(mesh);
  if (damaged) {
    // Torn flap lifting away from the crushed corner.
    const flapGeo = new THREE.BufferGeometry();
    flapGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, -0.1, 0, 0, -0.03, 0, -0.09,
    ], 3));
    flapGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    flapGeo.computeVertexNormals();
    const flap = new THREE.Mesh(flapGeo, new THREE.MeshLambertMaterial({ map: faces[2], side: THREE.DoubleSide }));
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
  const floorTex = concreteTexture();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  worldRoot.add(floor);

  const wallMat = lambert(0x8d949c);
  // One hall holds both stations: Station 1 (pack) at x = -3.2, Station 2 at 0.
  const back = box(11.6, 3.4, 0.1, wallMat, -1.0, 1.7, -3.25);
  const left = box(0.1, 3.4, 7, wallMat, -6.8, 1.7, -0.3);
  const right = box(0.1, 3.4, 7, wallMat, 4.8, 1.7, -0.3);
  const behind = box(11.6, 3.4, 0.1, wallMat, -1.0, 1.7, 3.2);
  const ceiling = box(11.6, 0.05, 7, lambert(0x4a5057), -1.0, 3.4, -0.3);
  worldRoot.add(back, left, right, behind, ceiling);
  for (const [x, z] of [[-4.4, -1.5], [-2.0, -1.5], [-1.2, -1.5], [1.2, -1.5], [-4.4, 1.2], [-2.0, 1.2], [-1.2, 1.2], [1.2, 1.2]]) {
    const light = box(1.2, 0.02, 0.3, new THREE.MeshBasicMaterial({ color: 0xf4f6f8 }), x, 3.37, z);
    worldRoot.add(light);
  }
  const brand = labelPlane(brandTexture(scenario.org, scenario.title), 2.0, 0.5);
  brand.position.set(-1.6, 2.35, -3.19);
  worldRoot.add(brand);

  // Outbound dock opening where the conveyor ends.
  const dock = box(0.9, 1.0, 0.02, new THREE.MeshBasicMaterial({ color: 0x0b0d10 }), LAYOUT.conveyor.x, 0.95, -3.19);
  const dockSign = labelPlane(textTexture('OUTBOUND DOCK 3', { w: 512, h: 96, font: 'bold 50px system-ui', bg: '#1d6b3a' }), 0.8, 0.15);
  dockSign.position.set(LAYOUT.conveyor.x, 1.6, -3.18);
  worldRoot.add(dock, dockSign);
  // Opening where Station 1's conveyor carries packed orders toward the dock.
  const packDock = box(0.7, 0.8, 0.02, new THREE.MeshBasicMaterial({ color: 0x0b0e12 }), -2.6, 0.85, -3.19);
  const packDockSign = labelPlane(textTexture('TO DOCK CHECK', { w: 512, h: 96, font: 'bold 48px system-ui', bg: '#1f2a36' }), 0.7, 0.13);
  packDockSign.position.set(-2.6, 1.42, -3.18);
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
  const bw = bench.x1 - bench.x0;
  const bd = bench.z1 - bench.z0;
  const bx = (bench.x0 + bench.x1) / 2;
  const bz = (bench.z0 + bench.z1) / 2;
  const top = box(bw, 0.04, bd, lambert(0x7c6a55), bx, -0.02, bz);
  station.add(top);
  station.add(box(bw, 0.045, 0.02, lambert(0xd9b21e), bx, -0.02, bench.z1 + 0.005));
  const steel = lambert(0x4b535c);
  for (const [x, z] of [[bench.x0 + 0.04, bench.z0 + 0.04], [bench.x1 - 0.04, bench.z0 + 0.04],
    [bench.x0 + 0.04, bench.z1 - 0.04], [bench.x1 - 0.04, bench.z1 - 0.04]]) {
    station.add(box(0.05, 1.4, 0.05, steel, x, -0.74, z));
  }

  // Inspection mat + incoming marker.
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.mat.w, LAYOUT.mat.d), new THREE.MeshLambertMaterial({ map: matTexture() }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(LAYOUT.mat.x, 0.002, LAYOUT.mat.z);
  station.add(mat);
  const incoming = labelPlane(textTexture('INCOMING', { w: 256, h: 64, font: 'bold 36px system-ui', bg: '#303841' }), 0.16, 0.04);
  incoming.rotation.x = -Math.PI / 2;
  incoming.position.set(LAYOUT.incoming.x - 0.2, 0.002, LAYOUT.incoming.z + 0.1);
  station.add(incoming);

  // Quarantine tote.
  const T = LAYOUT.tote;
  const toteMat = lambert(0xb8452a);
  const tote = new THREE.Group();
  tote.position.set(T.x, 0, T.z);
  tote.add(box(T.w, 0.02, T.d, toteMat, 0, 0.01, 0));
  tote.add(box(T.w, T.h, 0.02, toteMat, 0, T.h / 2, -T.d / 2));
  tote.add(box(T.w, T.h, 0.02, toteMat, 0, T.h / 2, T.d / 2));
  tote.add(box(0.02, T.h, T.d, toteMat, -T.w / 2, T.h / 2, 0));
  tote.add(box(0.02, T.h, T.d, toteMat, T.w / 2, T.h / 2, 0));
  const toteLabel = labelPlane(textTexture(['QUARANTINE', { text: 'Rejected / damaged only', font: '28px system-ui' }],
    { w: 512, h: 160, font: 'bold 64px system-ui', bg: '#1a1a1a', fg: '#ffd23f', stripe: '#ffd23f' }), 0.36, 0.11);
  toteLabel.position.set(0, T.h * 0.5, T.d / 2 + 0.012);
  tote.add(toteLabel);
  const toteSign = labelPlane(textTexture(['QUARANTINE', { text: 'Hold for review', font: '30px system-ui' }],
    { w: 512, h: 170, font: 'bold 70px system-ui', bg: '#1a1a1a', fg: '#ffd23f', stripe: '#ffd23f' }), 0.34, 0.115);
  toteSign.position.set(0, 0.36, -T.d / 2 - 0.005); // in front of the post (post front face at -T.d/2 - 0.02)
  tote.add(toteSign);
  tote.add(box(0.02, 0.36, 0.02, steel, 0, 0.18, -T.d / 2 - 0.03));
  station.add(tote);

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
      label: 'QUARANTINE', min: new THREE.Vector3(T.x - T.w / 2, -0.05, T.z - T.d / 2),
      max: new THREE.Vector3(T.x + T.w / 2, 0.65, T.z + T.d / 2),
      slot: (size) => new THREE.Vector3(T.x, 0.02 + size[1] / 2, T.z),
    },
    scale: {
      label: 'SCALE', min: new THREE.Vector3(S.x - S.w / 2 - 0.02, 0.0, S.z - S.d / 2 - 0.02),
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
    belt, releaseBtn, plate, scannerHead: head,
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
    this.texture.needsUpdate = true;
  }
}
