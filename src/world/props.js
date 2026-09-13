import * as THREE from 'three';
import { getTexture } from './textures.js';

// Procedural prop generators. Each returns { parts: [{ geometry, material }], colliders: [{min,max}] }
// in local space with y=0 at the floor. The LevelBuilder instances repeated props.

const matCache = new Map();
export function mat(key, factory) {
  if (!matCache.has(key)) matCache.set(key, factory());
  return matCache.get(key);
}
export function stdMat(color, opts = {}) {
  const key = `std:${color}:${opts.tex || ''}:${opts.rough ?? 0.7}:${opts.metal ?? 0.2}:${opts.emissive || 0}:${opts.ei || 0}:${opts.alpha ? 1 : 0}:${opts.repeat || 1}`;
  return mat(key, () => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.7,
      metalness: opts.metal ?? 0.2,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.ei ?? 1,
    });
    if (opts.tex) {
      const t = getTexture(opts.tex, opts.texColor ?? color, { repeat: opts.repeat || 1 });
      m.map = t;
      if (opts.alpha) { m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide; }
    }
    if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity ?? 0.4; m.depthWrite = false; }
    if (opts.side) m.side = opts.side;
    return m;
  });
}

function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function cyl(rt, rb, h, x = 0, y = 0, z = 0, seg = 12, rx = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}
function sph(r, x, y, z, seg = 10) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2));
  g.translate(x, y, z);
  return g;
}
function cone(r, h, x, y, z, seg = 8) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(x, y, z);
  return g;
}
function merge(geos) {
  // simple merge for same-attribute geometries (all non-indexed after toNonIndexed)
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  for (const g of geos) g.dispose();
  return out;
}
const col = (min, max) => ({ min, max });

export const PROP_DEFS = {
  pipeCluster(p) {
    const m = stdMat(p.primary, { tex: 'metal', metal: 0.7, rough: 0.4 });
    const acc = stdMat(p.accent, { metal: 0.6, rough: 0.5 });
    const pipes = [];
    for (let i = 0; i < 4; i++) {
      const x = -0.6 + i * 0.4;
      pipes.push(cyl(0.12, 0.12, 3.2, x, 1.6, 0, 8));
      pipes.push(cyl(0.16, 0.16, 0.2, x, 0.8 + i * 0.5, 0, 8));
    }
    pipes.push(cyl(0.1, 0.1, 1.8, 0, 2.6, 0, 8, 0, Math.PI / 2));
    return {
      parts: [{ geometry: merge(pipes), material: m }, { geometry: box(1.8, 0.15, 0.5, 0, 2.0, 0), material: acc }],
      colliders: [col([-0.8, 0, -0.25], [0.8, 3.2, 0.25])],
    };
  },
  crate(p) {
    const m = stdMat(0x8a7a55, { tex: 'concrete', texColor: 0x8a7a55, rough: 0.9 });
    const edge = stdMat(p.accent, { metal: 0.5 });
    return {
      parts: [
        { geometry: box(1, 1, 1, 0, 0.5, 0), material: m },
        { geometry: merge([box(1.04, 0.08, 0.08, 0, 0.96, 0.5), box(1.04, 0.08, 0.08, 0, 0.96, -0.5), box(0.08, 1.04, 0.08, 0.5, 0.5, 0.5), box(0.08, 1.04, 0.08, -0.5, 0.5, 0.5), box(0.08, 1.04, 0.08, 0.5, 0.5, -0.5), box(0.08, 1.04, 0.08, -0.5, 0.5, -0.5)]), material: edge },
      ],
      colliders: [col([-0.5, 0, -0.5], [0.5, 1, 0.5])],
    };
  },
  crateStack(p) {
    const m = stdMat(0x8a7a55, { tex: 'concrete', texColor: 0x8a7a55, rough: 0.9 });
    const edge = stdMat(p.accent, { metal: 0.5 });
    return {
      parts: [
        { geometry: merge([box(1, 1, 1, 0, 0.5, 0), box(1, 1, 1, 1.05, 0.5, 0.1), box(1, 1, 1, 0.5, 1.5, 0.05)]), material: m },
        { geometry: merge([box(1.04, 0.06, 1.04, 0, 0.98, 0), box(1.04, 0.06, 1.04, 1.05, 0.98, 0.1), box(1.04, 0.06, 1.04, 0.5, 1.98, 0.05)]), material: edge },
      ],
      colliders: [col([-0.5, 0, -0.5], [1.55, 1, 0.6]), col([0, 1, -0.45], [1, 2, 0.55])],
    };
  },
  barrel(p) {
    const m = stdMat(p.accent, { tex: 'metal', texColor: p.accent, metal: 0.6, rough: 0.5 });
    const band = stdMat(0x222222, { metal: 0.8 });
    return {
      parts: [
        { geometry: cyl(0.4, 0.4, 1.1, 0, 0.55, 0, 14), material: m },
        { geometry: merge([cyl(0.42, 0.42, 0.06, 0, 0.3, 0, 14), cyl(0.42, 0.42, 0.06, 0, 0.8, 0, 14)]), material: band },
      ],
      colliders: [col([-0.4, 0, -0.4], [0.4, 1.1, 0.4])],
    };
  },
  console(p) {
    const body = stdMat(0x2b3138, { tex: 'metal', texColor: 0x2b3138, metal: 0.5, rough: 0.5 });
    const screen = stdMat(p.emissive, { tex: 'circuit', texColor: p.emissive, emissive: p.emissive, ei: 0.9 });
    const g = merge([box(1.4, 0.9, 0.6, 0, 0.45, 0), box(1.4, 0.5, 0.35, 0, 1.1, -0.1)]);
    const s = box(1.2, 0.36, 0.02, 0, 1.12, 0.09);
    return {
      parts: [{ geometry: g, material: body }, { geometry: s, material: screen }],
      colliders: [col([-0.7, 0, -0.3], [0.7, 1.35, 0.3])],
    };
  },
  server(p) {
    const body = stdMat(0x1f2428, { tex: 'metal', texColor: 0x1f2428, metal: 0.6, rough: 0.4 });
    const led = stdMat(p.emissive, { emissive: p.emissive, ei: 1.2 });
    const leds = [];
    for (let i = 0; i < 8; i++) leds.push(box(0.5, 0.04, 0.02, 0, 0.3 + i * 0.25, 0.31));
    return {
      parts: [{ geometry: box(0.8, 2.4, 0.6, 0, 1.2, 0), material: body }, { geometry: merge(leds), material: led }],
      colliders: [col([-0.4, 0, -0.3], [0.4, 2.4, 0.3])],
    };
  },
  pillar(p) {
    const m = stdMat(p.primary, { tex: 'concrete', texColor: p.primary, rough: 0.8 });
    return { parts: [{ geometry: cyl(0.45, 0.5, 6, 0, 3, 0, 10), material: m }], colliders: [col([-0.5, 0, -0.5], [0.5, 6, 0.5])] };
  },
  tank(p) {
    const m = stdMat(p.primary, { tex: 'metal', texColor: p.primary, metal: 0.7, rough: 0.35 });
    const acc = stdMat(p.accent, { metal: 0.6 });
    return {
      parts: [
        { geometry: merge([cyl(1.0, 1.0, 2.6, 0, 1.5, 0, 16), sph(1.0, 0, 2.8, 0, 14)]), material: m },
        { geometry: merge([cyl(0.15, 0.15, 0.6, 0, 0.3, 0.9, 8), cyl(1.04, 1.04, 0.1, 0, 1.0, 0, 16), cyl(1.04, 1.04, 0.1, 0, 2.2, 0, 16)]), material: acc },
      ],
      colliders: [col([-1, 0, -1], [1, 3.8, 1])],
    };
  },
  plant(p) {
    const pot = stdMat(0x6b4a2f, { rough: 0.9 });
    const leaves = stdMat(0x3f9a3a, { tex: 'leaf', texColor: 0x3f9a3a, alpha: true, rough: 0.9 });
    const quads = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(1.2, 1.2);
      g.rotateY((i * Math.PI) / 3);
      g.translate(0, 1.0, 0);
      quads.push(g);
    }
    return {
      parts: [{ geometry: cyl(0.3, 0.22, 0.45, 0, 0.22, 0, 10), material: pot }, { geometry: merge(quads), material: leaves }],
      colliders: [col([-0.3, 0, -0.3], [0.3, 0.5, 0.3])],
    };
  },
  hedge(p) {
    const m = stdMat(0x2f7a2c, { tex: 'hedge', texColor: 0x2f7a2c, alpha: true, rough: 1 });
    const core = stdMat(0x1e4d1c, { rough: 1 });
    const quads = [];
    for (let z = -0.9; z <= 0.9; z += 0.45) {
      for (let i = 0; i < 2; i++) {
        const g = new THREE.PlaneGeometry(1.5, 2.2);
        g.rotateY(i * Math.PI / 2 + 0.3);
        g.translate(0, 1.1, z);
        quads.push(g);
      }
    }
    return {
      parts: [{ geometry: box(0.9, 1.9, 2.2, 0, 0.95, 0), material: core }, { geometry: merge(quads), material: m }],
      colliders: [col([-0.55, 0, -1.1], [0.55, 2.0, 1.1])],
    };
  },
  tree(p) {
    const bark = stdMat(0x5a3d25, { tex: 'bark', texColor: 0x5a3d25, rough: 0.95 });
    const leaves = stdMat(0x2f8a34, { rough: 1 });
    const canopy = merge([sph(3.2, 0, 7.5, 0, 10), sph(2.4, 2.2, 6.6, 0.8, 8), sph(2.2, -2.0, 6.9, -0.6, 8), sph(2.0, 0.4, 9.4, 1.4, 8)]);
    return {
      parts: [
        { geometry: merge([cyl(0.5, 0.8, 6, 0, 3, 0, 10), cyl(0.2, 0.3, 3, 1.4, 6, 0.5, 6, 0, -0.6), cyl(0.2, 0.3, 3, -1.3, 6.2, -0.4, 6, 0.4, 0.6)]), material: bark },
        { geometry: canopy, material: leaves },
      ],
      colliders: [col([-0.8, 0, -0.8], [0.8, 6, 0.8])],
    };
  },
  mushroom(p) {
    const stem = stdMat(0xd9d2c5, { rough: 0.9 });
    const cap = stdMat(0x3a7fd9, { emissive: 0x2a6fe0, ei: 1.5, rough: 0.6 });
    return {
      parts: [
        { geometry: merge([cyl(0.12, 0.18, 0.9, 0, 0.45, 0, 8), cyl(0.08, 0.12, 0.6, 0.5, 0.3, 0.3, 6), cyl(0.06, 0.1, 0.45, -0.4, 0.22, -0.2, 6)]), material: stem },
        { geometry: merge([sph(0.42, 0, 0.95, 0, 10), sph(0.24, 0.5, 0.62, 0.3, 8), sph(0.18, -0.4, 0.47, -0.2, 8)]), material: cap },
      ],
      colliders: [],
    };
  },
  hydroTray(p) {
    const frame = stdMat(0xbfc7cc, { metal: 0.6, rough: 0.4 });
    const soil = stdMat(0x4a3423, { tex: 'soil', texColor: 0x4a3423, rough: 1 });
    const leaves = stdMat(0x5bc24a, { tex: 'leaf', texColor: 0x5bc24a, alpha: true, rough: 1 });
    const quads = [];
    for (let x = -1.6; x <= 1.6; x += 0.8) {
      const g = new THREE.PlaneGeometry(0.7, 0.7);
      g.translate(x, 1.35, 0);
      quads.push(g);
      const g2 = new THREE.PlaneGeometry(0.7, 0.7);
      g2.rotateY(Math.PI / 2);
      g2.translate(x, 1.35, 0);
      quads.push(g2);
    }
    return {
      parts: [
        { geometry: merge([box(4, 0.12, 1.2, 0, 1.0, 0), box(0.1, 1.0, 0.1, -1.9, 0.5, -0.5), box(0.1, 1.0, 0.1, 1.9, 0.5, -0.5), box(0.1, 1.0, 0.1, -1.9, 0.5, 0.5), box(0.1, 1.0, 0.1, 1.9, 0.5, 0.5)]), material: frame },
        { geometry: box(3.8, 0.1, 1.0, 0, 1.08, 0), material: soil },
        { geometry: merge(quads), material: leaves },
      ],
      colliders: [col([-2, 0, -0.6], [2, 1.1, 0.6])],
    };
  },
  bench(p) {
    const m = stdMat(p.accent, { rough: 0.7, metal: 0.3 });
    return {
      parts: [{ geometry: merge([box(1.8, 0.08, 0.5, 0, 0.5, 0), box(0.08, 0.5, 0.5, -0.8, 0.25, 0), box(0.08, 0.5, 0.5, 0.8, 0.25, 0)]), material: m }],
      colliders: [col([-0.9, 0, -0.25], [0.9, 0.55, 0.25])],
    };
  },
  antenna(p) {
    const m = stdMat(0xd0d6da, { metal: 0.8, rough: 0.3 });
    const dish = stdMat(0xe8ecef, { metal: 0.5, rough: 0.5, side: THREE.DoubleSide });
    const d = new THREE.SphereGeometry(1.2, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.35);
    d.rotateX(-Math.PI * 0.6);
    d.translate(0, 2.6, 0.2);
    return {
      parts: [{ geometry: merge([cyl(0.1, 0.15, 2.2, 0, 1.1, 0, 8), box(0.6, 0.1, 0.6, 0, 0.05, 0)]), material: m }, { geometry: d, material: dish }],
      colliders: [col([-0.3, 0, -0.3], [0.3, 2.2, 0.3])],
    };
  },
  lamp(p) {
    const m = stdMat(0x222222, { metal: 0.7, rough: 0.4 });
    const bulb = stdMat(0xfff2cc, { emissive: 0xfff2cc, ei: 2 });
    return {
      parts: [{ geometry: merge([cyl(0.05, 0.05, 3, 0, 1.5, 0, 6), cyl(0.3, 0.1, 0.3, 0, 3.1, 0, 8)]), material: m }, { geometry: sph(0.12, 0, 3.0, 0, 8), material: bulb }],
      colliders: [col([-0.06, 0, -0.06], [0.06, 3.2, 0.06])],
    };
  },
  railing(p) {
    const m = stdMat(p.accent, { metal: 0.7, rough: 0.4 });
    const posts = [];
    for (let x = -1.9; x <= 1.9; x += 0.95) posts.push(box(0.06, 1.05, 0.06, x, 0.52, 0));
    return {
      parts: [{ geometry: merge([box(4, 0.06, 0.06, 0, 1.05, 0), box(4, 0.04, 0.04, 0, 0.55, 0), ...posts]), material: m }],
      colliders: [col([-2, 0, -0.08], [2, 1.1, 0.08])],
    };
  },
  ladder(p) {
    const m = stdMat(p.accent, { metal: 0.7, rough: 0.4 });
    const rungs = [];
    for (let y = 0.3; y < 5.6; y += 0.4) rungs.push(box(0.6, 0.05, 0.05, 0, y, 0));
    return {
      parts: [{ geometry: merge([box(0.05, 5.8, 0.05, -0.3, 2.9, 0), box(0.05, 5.8, 0.05, 0.3, 2.9, 0), ...rungs]), material: m }],
      colliders: [],
    };
  },
  oreCart(p) {
    const m = stdMat(0x4a4a4a, { tex: 'metal', texColor: 0x4a4a4a, metal: 0.7, rough: 0.5 });
    const ore = stdMat(p.accent, { emissive: p.accent, ei: 0.4, rough: 0.8 });
    return {
      parts: [
        { geometry: merge([box(1.6, 0.9, 1.0, 0, 0.75, 0), cyl(0.2, 0.2, 0.15, -0.5, 0.2, 0.5, 8, Math.PI / 2), cyl(0.2, 0.2, 0.15, 0.5, 0.2, 0.5, 8, Math.PI / 2), cyl(0.2, 0.2, 0.15, -0.5, 0.2, -0.5, 8, Math.PI / 2), cyl(0.2, 0.2, 0.15, 0.5, 0.2, -0.5, 8, Math.PI / 2)]), material: m },
        { geometry: merge([sph(0.3, 0, 1.25, 0, 6), sph(0.25, 0.4, 1.2, 0.2, 6), sph(0.22, -0.4, 1.18, -0.2, 6)]), material: ore },
      ],
      colliders: [col([-0.8, 0, -0.5], [0.8, 1.2, 0.5])],
    };
  },
  furnace(p) {
    const m = stdMat(0x3a3a40, { tex: 'metal', texColor: 0x3a3a40, metal: 0.6, rough: 0.5 });
    const fire = stdMat(0xff6a1a, { emissive: 0xff5a10, ei: 2.5 });
    return {
      parts: [
        { geometry: merge([box(3, 3, 2.4, 0, 1.5, 0), cyl(0.4, 0.5, 2.5, 0.8, 4.2, -0.5, 10)]), material: m },
        { geometry: box(1.4, 0.9, 0.05, 0, 1.0, 1.21), material: fire },
      ],
      colliders: [col([-1.5, 0, -1.2], [1.5, 3, 1.2])],
    };
  },
  cryoPod(p) {
    const m = stdMat(0xd8dde2, { metal: 0.5, rough: 0.35 });
    const glass = stdMat(0x9ad8ff, { transparent: true, opacity: 0.35, rough: 0.1, metal: 0.2 });
    const glow = stdMat(0x66ccff, { emissive: 0x44aaff, ei: 1.5 });
    return {
      parts: [
        { geometry: merge([box(1.2, 0.4, 2.4, 0, 0.2, 0), box(1.2, 0.3, 0.4, 0, 0.9, -1.0)]), material: m },
        { geometry: cyl(0.55, 0.55, 2.0, 0, 0.9, 0.1, 12, Math.PI / 2), material: glass },
        { geometry: box(1.0, 0.04, 2.0, 0, 0.42, 0.1), material: glow },
      ],
      colliders: [col([-0.6, 0, -1.2], [0.6, 1.4, 1.2])],
    };
  },
  bed(p) {
    const frame = stdMat(0x5d6670, { metal: 0.4 });
    const sheet = stdMat(0xd9e2ea, { tex: 'fabric', texColor: 0xd9e2ea, rough: 1 });
    return {
      parts: [{ geometry: box(1.1, 0.4, 2.2, 0, 0.2, 0), material: frame }, { geometry: merge([box(1.05, 0.2, 2.1, 0, 0.5, 0), box(0.6, 0.15, 0.4, 0, 0.66, -0.8)]), material: sheet }],
      colliders: [col([-0.55, 0, -1.1], [0.55, 0.7, 1.1])],
    };
  },
  locker(p) {
    const m = stdMat(p.accent, { tex: 'metal', texColor: p.accent, metal: 0.6, rough: 0.5 });
    return {
      parts: [{ geometry: merge([box(0.6, 2.0, 0.5, -0.32, 1, 0), box(0.6, 2.0, 0.5, 0.32, 1, 0)]), material: m }],
      colliders: [col([-0.65, 0, -0.25], [0.65, 2, 0.25])],
    };
  },
  rock(p) {
    const m = stdMat(0x6f6a62, { tex: 'concrete', texColor: 0x6f6a62, rough: 1 });
    const g = new THREE.DodecahedronGeometry(0.7, 0);
    g.scale(1, 0.7, 1.2);
    g.translate(0, 0.45, 0);
    return { parts: [{ geometry: g, material: m }], colliders: [col([-0.6, 0, -0.7], [0.6, 0.9, 0.7])] };
  },
  fern(p) {
    const m = stdMat(0x4faa3f, { tex: 'leaf', texColor: 0x4faa3f, alpha: true, rough: 1 });
    const quads = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.PlaneGeometry(1.4, 1.1);
      g.rotateY((i * Math.PI) / 4);
      g.translate(0, 0.55, 0);
      quads.push(g);
    }
    return { parts: [{ geometry: merge(quads), material: m }], colliders: [] };
  },
};

const propCache = new Map();
export function buildProp(type, palette) {
  const key = `${type}:${palette.primary}:${palette.accent}:${palette.emissive}`;
  if (propCache.has(key)) return propCache.get(key);
  const def = PROP_DEFS[type];
  if (!def) { console.warn('Unknown prop', type); return { parts: [], colliders: [] }; }
  const built = def(palette);
  propCache.set(key, built);
  return built;
}

export function disposeProps() {
  for (const p of propCache.values()) for (const part of p.parts) part.geometry.dispose();
  propCache.clear();
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
}
