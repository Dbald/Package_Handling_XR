// Static-geometry batching: merges plain, colour-only meshes that share a
// parent and a colour into one draw call, keeping Quest 2 frame time low.
// Interactive objects (anything with userData.kind) are never touched, and a
// merged mesh stays under the same parent, so moving groups still move it.
import * as THREE from 'three';

const v = new THREE.Vector3();
const n = new THREE.Vector3();
const nm = new THREE.Matrix3();

function mergeable(o) {
  const m = o.material;
  return o.isMesh && !o.isInstancedMesh && !o.userData.kind && !o.userData.noMerge && o.children.length === 0
    && !Array.isArray(m) && (m.isMeshLambertMaterial || m.isMeshBasicMaterial) && o.visible
    // Textured or transparent meshes merge only when they share one material instance.
    && (!(m.map || m.transparent) || o.userData.sharedMaterial);
}

// Plain colour-only materials are merged ACROSS colours: each part's colour is
// baked into a vertex-colour attribute, so a whole parent's static scenery
// becomes one draw call regardless of how many paints it uses.
function bucketKey(m) {
  if (m.map || m.transparent) return `uuid:${m.uuid}`;
  if (m.emissive && m.emissive.getHex() !== 0) return `${m.type}|${m.color.getHex()}|${m.emissive.getHex()}|${m.side}`;
  return `vc|${m.type}|${m.side}`;
}

const vcMaterials = new Map();
function vertexColorMaterial(proto) {
  const key = `${proto.type}|${proto.side}`;
  if (!vcMaterials.has(key)) {
    const M = proto.isMeshBasicMaterial ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial;
    vcMaterials.set(key, new M({ vertexColors: true, side: proto.side, toneMapped: proto.toneMapped }));
  }
  return vcMaterials.get(key);
}

function mergeChildren(parent) {
  const buckets = new Map();
  for (const m of parent.children) {
    if (!mergeable(m)) continue;
    const key = bucketKey(m.material);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }
  let removed = 0;
  for (const [key, list] of buckets.entries()) {
    if (list.length < 2) continue;
    const vc = key.startsWith('vc|');
    let vCount = 0;
    let iCount = 0;
    for (const m of list) {
      const g = m.geometry;
      vCount += g.attributes.position.count;
      iCount += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const withUv = list.every((m) => m.geometry.attributes.uv);
    const uvs = withUv && !vc ? new Float32Array(vCount * 2) : null;
    const cols = vc ? new Float32Array(vCount * 3) : null;
    const idx = new Uint32Array(iCount);
    let vo = 0;
    let io = 0;
    for (const m of list) {
      m.updateMatrix();
      nm.getNormalMatrix(m.matrix);
      const g = m.geometry;
      const p = g.attributes.position;
      const nr = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrix);
        pos.set([v.x, v.y, v.z], (vo + i) * 3);
        n.fromBufferAttribute(nr, i).applyMatrix3(nm).normalize();
        nor.set([n.x, n.y, n.z], (vo + i) * 3);
        if (cols) {
          const c = m.material.color; // linear, as vertex colours expect
          cols[(vo + i) * 3] = c.r;
          cols[(vo + i) * 3 + 1] = c.g;
          cols[(vo + i) * 3 + 2] = c.b;
        }
        if (uvs) {
          const uv = g.attributes.uv;
          uvs[(vo + i) * 2] = uv.getX(i);
          uvs[(vo + i) * 2 + 1] = uv.getY(i);
        }
      }
      if (g.index) {
        for (let j = 0; j < g.index.count; j++) idx[io + j] = g.index.getX(j) + vo;
        io += g.index.count;
      } else {
        for (let j = 0; j < p.count; j++) idx[io + j] = vo + j;
        io += p.count;
      }
      vo += p.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (cols) geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, vc ? vertexColorMaterial(list[0].material) : list[0].material);
    merged.name = 'merged-static';
    for (const m of list) {
      parent.remove(m);
      m.geometry.dispose();
    }
    parent.add(merged);
    removed += list.length - 1;
  }
  return removed;
}

/** Recursively batch static meshes under `root`. Returns meshes saved. */
export function mergeStatic(root) {
  let saved = mergeChildren(root);
  for (const child of [...root.children]) {
    if (!child.isMesh && !child.userData.kind && child.children.length) saved += mergeStatic(child);
  }
  return saved;
}
