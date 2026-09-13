import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from './collision.js';
import { getTexture, makeSign, disposeTextureCache } from './textures.js';
import { buildProp, stdMat, disposeProps } from './props.js';

// Level data -> meshes + colliders. Adding a level = writing one data file.
//
// Coordinate conventions: +Y up. Box rooms have a local frame { pos:[cx, floorY, cz], rot }.
// Wall sides in local space: 'n' = -Z, 's' = +Z, 'w' = -X, 'e' = +X.

const WALL_T = 0.3;
const SLAB_T = 0.3;
const TILE = 2.5; // meters per texture tile
const CHUNK = 1.2; // collision chunk length for rotated boxes
const LIGHT_SCALE = 3.0; // point/spot intensities in level data are multiplied by this
const AMBIENT_SCALE = 4.2;

const DEG = Math.PI / 180;

function rotXZ(x, z, ry) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return [x * c + z * s, -x * s + z * c];
}

// UV-scale a BoxGeometry so textures tile per meter.
function uvBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * su / TILE, uv.getY(k) * sv / TILE);
    }
  }
  return g;
}

// Build a quad list geometry from explicit vertices (indexed, with normals/uvs).
class QuadBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  quad(v0, v1, v2, v3, normal, uvs) {
    const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
    const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const flip = nx * normal[0] + ny * normal[1] + nz * normal[2] < 0;
    const base = this.pos.length / 3;
    const verts = [v0, v1, v2, v3];
    for (let i = 0; i < 4; i++) {
      this.pos.push(...verts[i]);
      this.nor.push(...normal);
      this.uv.push(...uvs[i]);
    }
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

export class LevelBuilder {
  constructor(scene, data) {
    this.scene = scene;
    this.data = data;
    this.group = new THREE.Group();
    this.group.name = 'level:' + data.id;
    this.collision = new CollisionWorld();
    this.zones = []; // { id, kind, aabb:{min,max}, meshes:[], zeroG, visionScale, reverb, surface, name }
    this.rooms = new Map();
    this.vents = [];
    this.stations = [];
    this.sabotageStations = [];
    this.doors = [];
    this.lights = [];
    this.dynamic = { lava: [], flareLights: [], sun: null, sunBase: null };
    this.buckets = new Map(); // zoneId -> Map(material -> geometries[])
    this._propInstances = new Map(); // type -> [{pos,rot,scale}]
    this._shadowCount = 0;
    this.meetingTable = [0, 0, 0]; // resolved in build() once rooms exist
    this.spawn = [0, 0, 0];
    this.disposables = [];
  }

  // ---------------------------------------------------------------- helpers
  _bucket(zoneId, material) {
    let z = this.buckets.get(zoneId);
    if (!z) { z = new Map(); this.buckets.set(zoneId, z); }
    let list = z.get(material);
    if (!list) { list = []; z.set(material, list); }
    return list;
  }

  _zone(id, kind, extra = {}) {
    const z = { id, kind, aabb: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, meshes: [], ...extra };
    this.zones.push(z);
    return z;
  }

  _growAABB(zone, pts) {
    for (const p of pts) for (let i = 0; i < 3; i++) {
      zone.aabb.min[i] = Math.min(zone.aabb.min[i], p[i]);
      zone.aabb.max[i] = Math.max(zone.aabb.max[i], p[i]);
    }
  }

  // Oriented box in world space: center (cx,cy,cz), size (w,h,d), rotation ry.
  _orientedBox(zone, material, cx, cy, cz, w, h, d, ry, opts = {}) {
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return;
    if (opts.render !== false) {
      const g = uvBox(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(cx, cy, cz);
      this._bucket(zone.id, material).push(g);
    }
    if (opts.collide !== false) this._collideOriented(cx, cy, cz, w, h, d, ry, opts);
    const corners = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [rx, rz] = rotXZ(sx * w / 2, sz * d / 2, ry);
      corners.push([cx + rx, cy - h / 2, cz + rz], [cx + rx, cy + h / 2, cz + rz]);
    }
    this._growAABB(zone, corners);
  }

  _collideOriented(cx, cy, cz, w, h, d, ry, opts = {}) {
    const q = Math.round(ry / (Math.PI / 2));
    const aligned = Math.abs(ry - q * Math.PI / 2) < 1e-4;
    const colOpts = { tag: opts.tag, surface: opts.surface, occlude: opts.occlude, enabled: opts.enabled };
    if (aligned) {
      const odd = Math.abs(q % 2) === 1;
      const hw = (odd ? d : w) / 2, hd = (odd ? w : d) / 2;
      return [this.collision.addBox([cx - hw, cy - h / 2, cz - hd], [cx + hw, cy + h / 2, cz + hd], colOpts)];
    }
    // chunk along the longer axis into AABBs
    const alongX = w >= d;
    const len = alongX ? w : d, thick = alongX ? d : w;
    const n = Math.max(1, Math.ceil(len / CHUNK));
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = -len / 2 + (i / n) * len, b = -len / 2 + ((i + 1) / n) * len;
      const pts = [];
      for (const t of [a, b]) for (const s of [-thick / 2, thick / 2]) {
        const lx = alongX ? t : s, lz = alongX ? s : t;
        const [rx, rz] = rotXZ(lx, lz, ry);
        pts.push([cx + rx, cz + rz]);
      }
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      for (const [x, z] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
      out.push(this.collision.addBox([minx, cy - h / 2, minz], [maxx, cy + h / 2, maxz], colOpts));
    }
    return out;
  }

  // Place a local-frame box (x,y,z relative to frame origin, rotation about frame.ry)
  _localBox(zone, material, frame, x, y, z, w, h, d, opts = {}) {
    const [rx, rz] = rotXZ(x, z, frame.ry);
    this._orientedBox(zone, material, frame.cx + rx, y, frame.cz + rz, w, h, d, frame.ry + (opts.ry || 0), opts);
  }

  _mats(room) {
    const pal = this.data.palette;
    const floorColor = room.floorColor ?? pal.floor;
    const wallColor = room.wallColor ?? pal.wall ?? pal.primary;
    const ceilColor = room.ceilColor ?? pal.ceiling ?? wallColor;
    return {
      floor: stdMat(floorColor, { tex: room.floorTex || pal.floorTex || 'tiles', texColor: floorColor, rough: 0.85, metal: 0.15 }),
      wall: room.glass
        ? stdMat(0x9ad8ff, { tex: 'glass', texColor: 0x9ad8ff, transparent: true, opacity: 0.28, rough: 0.05, metal: 0.3, side: THREE.DoubleSide })
        : stdMat(wallColor, { tex: room.wallTex || pal.wallTex || 'wall', texColor: wallColor, rough: 0.8, metal: 0.25 }),
      ceil: stdMat(ceilColor, { tex: room.ceilTex || pal.ceilTex || 'metal', texColor: ceilColor, rough: 0.9, metal: 0.2 }),
      trim: stdMat(pal.accent, { metal: 0.6, rough: 0.4 }),
      grating: stdMat(pal.accent, { tex: 'grating', texColor: pal.accent, alpha: true, metal: 0.7, rough: 0.4 }),
    };
  }

  // -------------------------------------------------------------- rooms
  _prepRooms() {
    const d = this.data;
    for (const r of d.rooms) {
      const mo = r.openings || {};
      const room = { ...r, openings: { n: [...(mo.n || [])], s: [...(mo.s || [])], e: [...(mo.e || [])], w: [...(mo.w || [])] } };
      if (r.shape === 'ring') {
        room.cx = r.center[0]; room.floorY = r.center[1]; room.cz = r.center[2];
        room.ri = r.radius - r.width / 2; room.ro = r.radius + r.width / 2;
        room.a0 = (r.arc ? r.arc[0] : 0) * DEG; room.a1 = (r.arc ? r.arc[1] : 360) * DEG;
        room.height = r.height;
        room.ringOpenings = []; // { angle, halfAngle, side:'outer'|'inner', height }
      } else {
        room.shape = 'box';
        if (r.attach) {
          const ring = this.rooms.get(r.attach.ring);
          const phi = r.attach.angle * DEG;
          const outer = r.attach.side !== 'inner';
          const gap = r.attach.gap ?? 4;
          const dist = outer ? ring.ro + gap + r.size[2] / 2 : ring.ri - gap - r.size[2] / 2;
          room.cx = ring.cx + Math.cos(phi) * dist;
          room.cz = ring.cz + Math.sin(phi) * dist;
          room.floorY = r.floorY ?? ring.floorY;
          room.ry = Math.PI / 2 - phi + (outer ? 0 : Math.PI);
          room.attachInfo = { ring, phi, outer, gap };
        } else {
          room.cx = r.pos[0]; room.floorY = r.pos[1]; room.cz = r.pos[2];
          room.ry = (r.rot || 0);
        }
        room.w = r.size[0]; room.h = r.size[1]; room.d = r.size[2];
      }
      this.rooms.set(r.id, room);
    }
  }

  _addOpening(room, side, a, b, h) { room.openings[side].push({ a, b, h }); }

  _miscZone() {
    if (!this._misc) this._misc = this._zone('misc', 'misc', { name: 'Catwalk', surface: 'metal', reverb: 'large-metal', always: true });
    return this._misc;
  }

  // Resolve an item's world position/rotation. Items may give absolute `pos` (+`rot`),
  // or `room` + `local:[x,z]` (+`y`) in a box room's frame, or `room` + `polar:[deg, radius]` for rings.
  _resolve(item) {
    if (item.room && (item.local || item.polar)) {
      const room = this.rooms.get(item.room);
      if (!room) { console.warn('unknown room for item', item); return { pos: [0, 0, 0], rot: item.rot || 0 }; }
      if (room.shape === 'ring') {
        const phi = item.polar[0] * DEG, r = item.polar[1];
        // rot so that local +Z (console face) points toward the ring centerline
        const facing = r > room.radius ? Math.PI / 2 - phi + Math.PI : Math.PI / 2 - phi;
        return { pos: [room.cx + Math.cos(phi) * r, room.floorY + (item.y || 0), room.cz + Math.sin(phi) * r], rot: facing + (item.rot || 0) };
      }
      const [rx, rz] = rotXZ(item.local[0], item.local[1], room.ry);
      return { pos: [room.cx + rx, room.floorY + (item.y || 0), room.cz + rz], rot: room.ry + (item.rot || 0) };
    }
    return { pos: [...(item.pos || [0, 0, 0])], rot: item.rot || 0 };
  }
  _resolvePos(v) {
    if (!v) return [0, 0, 0];
    if (Array.isArray(v)) return [...v];
    return this._resolve(v).pos;
  }

  // Corridor between two box rooms sharing a rotation, or an attached room and its ring.
  _prepCorridors() {
    const d = this.data;
    for (const c of d.corridors || []) {
      const A = this.rooms.get(c.from), B = this.rooms.get(c.to);
      if (!A || !B) { console.warn('corridor: unknown room', c); continue; }
      const width = c.width || 3, height = c.height || 3.2;
      if (A.shape === 'ring' || B.shape === 'ring') {
        const ring = A.shape === 'ring' ? A : B;
        const room = A.shape === 'ring' ? B : A;
        if (!room.attachInfo || room.attachInfo.ring !== ring) { console.warn('ring corridor requires attach', c); continue; }
        const { phi, outer, gap } = room.attachInfo;
        const R = outer ? ring.ro : ring.ri;
        ring.ringOpenings.push({ angle: phi, halfAngle: (width / 2 + WALL_T) / R, side: outer ? 'outer' : 'inner', height });
        this._addOpening(room, 'n', -width / 2, width / 2, height);
        this._corridors.push({ id: `corr:${c.from}-${c.to}`, frame: { cx: room.cx, cz: room.cz, ry: room.ry }, axis: 'z', at: 0, from: -room.d / 2 - gap, to: -room.d / 2, width, height, floorY: room.floorY, room, doorAt: c.door });
        continue;
      }
      if (Math.abs(A.ry - B.ry) > 1e-4) { console.warn('corridor rooms must share rotation', c); continue; }
      // work in A's local frame
      const [bx, bz] = rotXZ(B.cx - A.cx, B.cz - A.cz, -A.ry);
      const ax0 = -A.w / 2, ax1 = A.w / 2, az0 = -A.d / 2, az1 = A.d / 2;
      const bx0 = bx - B.w / 2, bx1 = bx + B.w / 2, bz0 = bz - B.d / 2, bz1 = bz + B.d / 2;
      const ox0 = Math.max(ax0, bx0), ox1 = Math.min(ax1, bx1);
      const oz0 = Math.max(az0, bz0), oz1 = Math.min(az1, bz1);
      const frame = { cx: A.cx, cz: A.cz, ry: A.ry };
      const floorY = Math.min(A.floorY, B.floorY);
      if (ox1 - ox0 >= width) {
        const at = c.at !== undefined ? c.at : (ox0 + ox1) / 2;
        if (bz > 0) { // B is south of A
          this._addOpening(A, 's', at - width / 2, at + width / 2, height);
          this._addOpening(B, 'n', at - bx - width / 2, at - bx + width / 2, height);
          this._corridors.push({ id: `corr:${c.from}-${c.to}`, frame, axis: 'z', at, from: az1, to: bz0, width, height, floorY, doorAt: c.door });
        } else {
          this._addOpening(A, 'n', at - width / 2, at + width / 2, height);
          this._addOpening(B, 's', at - bx - width / 2, at - bx + width / 2, height);
          this._corridors.push({ id: `corr:${c.from}-${c.to}`, frame, axis: 'z', at, from: bz1, to: az0, width, height, floorY, doorAt: c.door });
        }
      } else if (oz1 - oz0 >= width) {
        const at = c.at !== undefined ? c.at : (oz0 + oz1) / 2;
        if (bx > 0) {
          this._addOpening(A, 'e', at - width / 2, at + width / 2, height);
          this._addOpening(B, 'w', at - bz - width / 2, at - bz + width / 2, height);
          this._corridors.push({ id: `corr:${c.from}-${c.to}`, frame, axis: 'x', at, from: ax1, to: bx0, width, height, floorY, doorAt: c.door });
        } else {
          this._addOpening(A, 'w', at - width / 2, at + width / 2, height);
          this._addOpening(B, 'e', at - bz - width / 2, at - bz + width / 2, height);
          this._corridors.push({ id: `corr:${c.from}-${c.to}`, frame, axis: 'x', at, from: bx1, to: ax0, width, height, floorY, doorAt: c.door });
        }
      } else {
        console.warn(`corridor ${c.from}->${c.to}: rooms do not overlap on either axis (need ${width}m)`);
      }
    }
  }

  _buildCorridor(c) {
    const zone = this._zone(c.id, 'corridor', { name: 'Corridor', surface: this.data.palette.surface || 'metal', reverb: 'small-room' });
    const m = this._mats({});
    // pieces span from one room's wall outer face to the other's, so nothing is coplanar with room slabs
    const len = c.to - c.from - WALL_T;
    if (len < 0.05) return; // adjacent rooms: just openings
    const mid = (c.from + c.to) / 2;
    const y0 = c.floorY;
    const f = c.frame;
    const place = (x, y, z, w, h, d, opts) => {
      // local coords depend on axis
      if (c.axis === 'z') this._localBox(zone, opts.mat, f, c.at + x, y, mid + z, w, h, d, opts);
      else this._localBox(zone, opts.mat, f, mid + z, y, c.at + x, d, h, w, opts);
    };
    // floor & ceiling
    place(0, y0 - SLAB_T / 2, 0, c.width + WALL_T * 2, SLAB_T, len, { mat: m.floor, surface: zone.surface, tag: 'floor' });
    place(0, y0 + c.height + SLAB_T / 2, 0, c.width + WALL_T * 2, SLAB_T, len, { mat: m.ceil });
    // walls
    place(-(c.width / 2 + WALL_T / 2), y0 + c.height / 2, 0, WALL_T, c.height, len, { mat: m.wall });
    place(c.width / 2 + WALL_T / 2, y0 + c.height / 2, 0, WALL_T, c.height, len, { mat: m.wall });
    // trim strips protrude 1cm from the walls so they never share a plane with them
    place(-(c.width / 2 - 0.04), y0 + 0.05, 0, 0.1, 0.1, len - 0.02, { mat: m.trim, collide: false });
    place(c.width / 2 - 0.04, y0 + 0.05, 0, 0.1, 0.1, len - 0.02, { mat: m.trim, collide: false });
  }

  _buildBoxRoom(room) {
    const zone = this._zone(room.id, 'room', {
      name: room.name || room.id, zeroG: !!room.zeroG, visionScale: room.visionScale ?? 1,
      reverb: room.reverb || this.data.ambience?.reverb || 'small-room', surface: room.surface || this.data.palette.surface || 'metal',
      room,
    });
    const m = this._mats(room);
    const f = { cx: room.cx, cz: room.cz, ry: room.ry };
    const { w, h, d, floorY } = room;
    const glassOpts = room.glass ? { occlude: false } : {};
    // floor slab
    if (!room.noFloor) this._localBox(zone, m.floor, f, 0, floorY - SLAB_T / 2, 0, w + WALL_T, SLAB_T, d + WALL_T, { surface: zone.surface, tag: 'floor' });
    // ceiling
    if (!room.open) this._localBox(zone, m.ceil, f, 0, floorY + h + SLAB_T / 2, 0, w + WALL_T, SLAB_T, d + WALL_T, {});
    // walls with openings. side geometry: n: z=-d/2 along x; s: z=+d/2; w: x=-w/2 along z; e: x=+w/2
    const sides = [
      { s: 'n', lo: -w / 2, hi: w / 2, fixed: -d / 2, alongX: true },
      { s: 's', lo: -w / 2, hi: w / 2, fixed: d / 2, alongX: true },
      { s: 'w', lo: -d / 2, hi: d / 2, fixed: -w / 2, alongX: false },
      { s: 'e', lo: -d / 2, hi: d / 2, fixed: w / 2, alongX: false },
    ];
    for (const side of sides) {
      if (room.noWalls && room.noWalls.includes(side.s)) continue;
      const ops = room.openings[side.s].slice().sort((p, q) => p.a - q.a);
      let cursor = side.lo - WALL_T / 2;
      const emit = (a, b, y0, y1, mat, opts = {}) => {
        if (b - a < 0.02 || y1 - y0 < 0.02) return;
        const mid = (a + b) / 2, len = b - a, thick = opts.thick || WALL_T;
        if (side.alongX) this._localBox(zone, mat, f, mid, (y0 + y1) / 2, side.fixed, len, y1 - y0, thick, { ...glassOpts, ...opts });
        else this._localBox(zone, mat, f, side.fixed, (y0 + y1) / 2, mid, thick, y1 - y0, len, { ...glassOpts, ...opts });
      };
      const solid = (a, b) => {
        emit(a, b, floorY, floorY + h, m.wall);
        // baseboard trim (render only), thicker than the wall so it never shares a plane with it
        if (!room.glass) emit(Math.max(a, side.lo), Math.min(b, side.hi), floorY, floorY + 0.12, m.trim, { collide: false, thick: WALL_T + 0.06 });
      };
      for (const op of ops) {
        solid(cursor, op.a);
        emit(op.a, op.b, floorY + op.h, floorY + h, m.wall); // lintel
        cursor = op.b;
      }
      solid(cursor, side.hi + WALL_T / 2);
    }
  }

  _buildRingRoom(room) {
    const zone = this._zone(room.id, 'room', {
      name: room.name || room.id, zeroG: !!room.zeroG, visionScale: room.visionScale ?? 1,
      reverb: room.reverb || this.data.ambience?.reverb || 'small-room', surface: room.surface || 'metal', room,
    });
    const m = this._mats(room);
    const { cx, cz, floorY, ri, ro, a0, a1, height } = room;
    const arcLen = (a1 - a0) * ro;
    const n = Math.max(8, Math.ceil(arcLen / CHUNK));
    const floorQB = new QuadBuilder(), ceilQB = new QuadBuilder(), wallQB = new QuadBuilder(), trimQB = new QuadBuilder();
    const P = (r, phi, y) => [cx + Math.cos(phi) * r, y, cz + Math.sin(phi) * r];
    const inOpening = (phi, side) => room.ringOpenings.find((o) => o.side === side && Math.abs(Math.atan2(Math.sin(phi - o.angle), Math.cos(phi - o.angle))) < o.halfAngle);
    // segment boundaries: uniform chunks plus every opening edge, so corridor walls meet the ring wall exactly
    const span = a1 - a0;
    const angles = [];
    for (let i = 0; i <= n; i++) angles.push(a0 + (span * i) / n);
    for (const o of room.ringOpenings) for (const e of [o.angle - o.halfAngle, o.angle + o.halfAngle]) {
      const rel = (((e - a0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (rel <= span) angles.push(a0 + rel);
    }
    angles.sort((x, y) => x - y);
    const segs = [];
    for (let i = 0; i < angles.length - 1; i++) if (angles[i + 1] - angles[i] > 1e-4) segs.push([angles[i], angles[i + 1]]);
    for (const [p0, p1] of segs) {
      const pm = (p0 + p1) / 2;
      const rIn = ri - WALL_T / 2, rOut = ro + WALL_T / 2;
      // floor quad
      const uvF = (v) => [v[0] / TILE, v[2] / TILE];
      const f0 = P(rIn, p0, floorY), f1 = P(rOut, p0, floorY), f2 = P(rOut, p1, floorY), f3 = P(rIn, p1, floorY);
      floorQB.quad(f0, f1, f2, f3, [0, 1, 0], [uvF(f0), uvF(f1), uvF(f2), uvF(f3)]);
      // floor collision (flat AABB of quad)
      const xs = [f0[0], f1[0], f2[0], f3[0]], zs = [f0[2], f1[2], f2[2], f3[2]];
      this.collision.addBox([Math.min(...xs), floorY - SLAB_T, Math.min(...zs)], [Math.max(...xs), floorY, Math.max(...zs)], { surface: zone.surface, tag: 'floor', occlude: false });
      this._growAABB(zone, [f0, f1, f2, f3, [f0[0], floorY + height, f0[2]]]);
      // ceiling
      if (!room.open) {
        const c0 = P(rIn, p0, floorY + height), c1 = P(rOut, p0, floorY + height), c2 = P(rOut, p1, floorY + height), c3 = P(rIn, p1, floorY + height);
        ceilQB.quad(c0, c1, c2, c3, [0, -1, 0], [uvF(c0), uvF(c1), uvF(c2), uvF(c3)]);
        this.collision.addBox([Math.min(...xs), floorY + height, Math.min(...zs)], [Math.max(...xs), floorY + height + SLAB_T, Math.max(...zs)], { occlude: false });
      }
      // walls (outer & inner), respecting openings
      for (const side of ['outer', 'inner']) {
        const R = side === 'outer' ? ro : ri;
        const nrm = side === 'outer' ? [-Math.cos(pm), 0, -Math.sin(pm)] : [Math.cos(pm), 0, Math.sin(pm)];
        const op = inOpening(pm, side);
        const yBottom = op ? floorY + op.height : floorY;
        if (floorY + height - yBottom > 0.05) {
          const w0 = P(R, p0, yBottom), w1 = P(R, p1, yBottom), w2 = P(R, p1, floorY + height), w3 = P(R, p0, floorY + height);
          const u0 = (p0 * R) / TILE, u1 = (p1 * R) / TILE;
          wallQB.quad(w0, w1, w2, w3, nrm, [[u0, yBottom / TILE], [u1, yBottom / TILE], [u1, (floorY + height) / TILE], [u0, (floorY + height) / TILE]]);
          const wx = [w0[0], w1[0]], wz = [w0[2], w1[2]];
          this.collision.addBox(
            [Math.min(...wx) - WALL_T / 2, yBottom, Math.min(...wz) - WALL_T / 2],
            [Math.max(...wx) + WALL_T / 2, floorY + height, Math.max(...wz) + WALL_T / 2],
            { tag: 'wall' });
        }
        if (!op) {
          // baseboard trim strip
          const t0 = P(R + (side === 'outer' ? -0.06 : 0.06), p0, floorY), t1 = P(R + (side === 'outer' ? -0.06 : 0.06), p1, floorY);
          trimQB.quad(t0, t1, [t1[0], floorY + 0.12, t1[2]], [t0[0], floorY + 0.12, t0[2]], nrm, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
      }
    }
    this._bucket(zone.id, m.floor).push(floorQB.build());
    if (!room.open) this._bucket(zone.id, m.ceil).push(ceilQB.build());
    const wallMat = stdMat((room.wallColor ?? this.data.palette.wall ?? this.data.palette.primary), { tex: room.wallTex || this.data.palette.wallTex || 'wall', texColor: room.wallColor ?? this.data.palette.wall ?? this.data.palette.primary, rough: 0.8, metal: 0.25, side: THREE.DoubleSide });
    this._bucket(zone.id, wallMat).push(wallQB.build());
    this._bucket(zone.id, m.trim).push(trimQB.build());
    // end caps if partial arc
    if (a1 - a0 < Math.PI * 2 - 1e-3) {
      for (const phi of [a0, a1]) {
        const mid = (ri + ro) / 2;
        this._orientedBox(zone, m.wall, cx + Math.cos(phi) * mid, floorY + height / 2, cz + Math.sin(phi) * mid, ro - ri + WALL_T, height, WALL_T, -phi);
      }
    }
  }

  // ---------------------------------------------------------- extras
  _buildPlatforms() {
    const pal = this.data.palette;
    for (const p of this.data.platforms || []) {
      const zone = this.zones.find((z) => z.id === p.zone) || this._miscZone();
      const m = this._mats({});
      const [x, y, z] = p.pos, [w, t, d] = p.size;
      const mat = p.grating ? m.grating : m.floor;
      this._orientedBox(zone, mat, x, y - t / 2, z, w, t, d, p.rot || 0, { surface: p.grating ? 'grating' : 'metal', tag: 'floor', occlude: !p.grating });
      for (const side of p.rails || []) {
        const rh = 1.05, rt = 0.08;
        const railMat = stdMat(pal.accent, { metal: 0.7, rough: 0.4 });
        const cx = side === 'e' ? x + w / 2 - rt / 2 : side === 'w' ? x - w / 2 + rt / 2 : x;
        const cz = side === 's' ? z + d / 2 - rt / 2 : side === 'n' ? z - d / 2 + rt / 2 : z;
        const rw = side === 'e' || side === 'w' ? rt : w, rd = side === 'n' || side === 's' ? rt : d;
        // top bar + mid bar (render), collider full height
        this._orientedBox(zone, railMat, cx, y + rh - 0.03, cz, rw, 0.06, rd, p.rot || 0, { collide: false });
        this._orientedBox(zone, railMat, cx, y + rh * 0.5, cz, rw, 0.04, rd, p.rot || 0, { collide: false });
        this._orientedBox(zone, railMat, cx, y + rh / 2, cz, rw, rh, rd, p.rot || 0, { render: false, occlude: false });
        // posts
        const count = Math.max(2, Math.round((side === 'e' || side === 'w' ? d : w) / 1.5));
        for (let i = 0; i < count; i++) {
          const tt = -0.5 + (count === 1 ? 0.5 : i / (count - 1));
          const px = side === 'e' || side === 'w' ? cx : x + tt * (w - rt);
          const pz = side === 'n' || side === 's' ? cz : z + tt * (d - rt);
          this._orientedBox(zone, railMat, px, y + rh / 2, pz, rt, rh, rt, p.rot || 0, { collide: false });
        }
      }
    }
  }

  _buildStairs() {
    const m = this._mats({});
    for (const s of this.data.stairs || []) {
      const zone = this._miscZone();
      const [x0, y0, z0] = s.from, [x1, y1, z1] = s.to;
      const rise = y1 - y0;
      const steps = Math.max(1, Math.ceil(Math.abs(rise) / 0.28));
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      const ry = Math.atan2(dx, dz); // corridor direction as rotation about Y (+z forward when ry=0)
      const stepLen = len / steps;
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const cx = x0 + dx * t, cz = z0 + dz * t;
        const top = y0 + (rise * (i + 1)) / steps;
        const bottom = Math.min(y0, y1) - 0.3;
        this._orientedBox(zone, m.floor, cx, (top + bottom) / 2, cz, s.width, top - bottom, stepLen + 0.02, ry, { surface: 'metal', tag: 'floor' });
      }
      // side rails
      const railMat = stdMat(this.data.palette.accent, { metal: 0.7, rough: 0.4 });
      for (const sgn of [-1, 1]) {
        const [ox, oz] = rotXZ(sgn * (s.width / 2 - 0.05), 0, ry);
        const cx = (x0 + x1) / 2 + ox, cz = (z0 + z1) / 2 + oz;
        const cy = (y0 + y1) / 2 + 1.0;
        const g = uvBox(0.06, 0.06, Math.hypot(len, rise));
        g.rotateX(-Math.atan2(rise, len));
        g.rotateY(ry);
        g.translate(cx, cy, cz);
        this._bucket(zone.id, railMat).push(g);
        this._orientedBox(zone, railMat, cx, (y0 + y1) / 2 + 0.6, cz, 0.08, Math.abs(rise) + 1.2, len, ry, { render: false, occlude: false });
      }
    }
  }

  _buildWalls() {
    const m = this._mats({});
    for (const w of this.data.walls || []) {
      const zone = this.zones.find((z) => z.id === w.zone) || this._miscZone();
      const mat = w.glass ? this._mats({ glass: true }).wall : w.mat === 'floor' ? m.floor : w.mat === 'trim' ? m.trim : m.wall;
      this._orientedBox(zone, mat, w.pos[0], w.pos[1] + w.size[1] / 2, w.pos[2], w.size[0], w.size[1], w.size[2], w.rot || 0, { occlude: !w.glass, collide: w.collide !== false });
    }
  }

  _queueProp(type, pos, rot = 0, scale = 1) {
    let list = this._propInstances.get(type);
    if (!list) { list = []; this._propInstances.set(type, list); }
    list.push({ pos, rot, scale });
  }

  _buildProps() {
    const pal = this.data.palette;
    for (const p of this.data.props || []) { const r = this._resolve(p); this._queueProp(p.type, r.pos, r.rot, p.scale || 1); }
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const [type, list] of this._propInstances) {
      const built = buildProp(type, pal);
      for (const part of built.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        im.castShadow = true; im.receiveShadow = true;
        list.forEach((inst, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rot);
          v.set(inst.pos[0], inst.pos[1], inst.pos[2]);
          sc.setScalar(inst.scale);
          mtx.compose(v, q, sc);
          im.setMatrixAt(i, mtx);
        });
        im.instanceMatrix.needsUpdate = true;
        im.frustumCulled = true;
        im.computeBoundingSphere();
        this.group.add(im);
        this.disposables.push(im);
      }
      for (const inst of list) {
        for (const c of built.colliders) {
          const s = inst.scale;
          const w = (c.max[0] - c.min[0]) * s, h = (c.max[1] - c.min[1]) * s, d = (c.max[2] - c.min[2]) * s;
          const lcx = ((c.min[0] + c.max[0]) / 2) * s, lcz = ((c.min[2] + c.max[2]) / 2) * s;
          const [rx, rz] = rotXZ(lcx, lcz, inst.rot);
          this._collideOriented(inst.pos[0] + rx, inst.pos[1] + ((c.min[1] + c.max[1]) / 2) * s, inst.pos[2] + rz, w, h, d, inst.rot, { tag: 'prop' });
        }
      }
    }
  }

  _buildVents() {
    const pal = this.data.palette;
    for (const v0 of this.data.vents || []) {
      const r = this._resolve(v0);
      const v = { ...v0, pos: r.pos, rot: r.rot };
      const mat = new THREE.MeshStandardMaterial({ map: getTexture('vent', pal.accent), color: 0xffffff, roughness: 0.5, metalness: 0.7, emissive: 0x000000 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 1.1), mat);
      mesh.position.set(v.pos[0], v.pos[1] + 0.04, v.pos[2]);
      mesh.rotation.y = v.rot || 0;
      this.group.add(mesh);
      this.disposables.push(mesh, mat);
      this.vents.push({ id: v.id, pos: [...v.pos], connects: v.connects || [], mesh, mat });
    }
  }

  _buildStation(st0, kind) {
    const pal = this.data.palette;
    const rr = this._resolve(st0);
    const st = { ...st0, pos: rr.pos, rot: rr.rot };
    const rot = st.rot;
    this._queueProp(st.prop || 'console', st.pos, rot, 1);
    const signTex = makeSign(st.label || st.id, kind === 'task' ? pal.emissive : 0xff6b6b);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), signMat);
    const [ox, oz] = rotXZ(0, -0.32, rot);
    sign.position.set(st.pos[0] + ox, st.pos[1] + 2.0, st.pos[2] + oz);
    sign.rotation.y = rot;
    this.group.add(sign);
    // glow plane (visual tasks / active fix panels)
    const glowMat = new THREE.MeshBasicMaterial({ color: kind === 'task' ? pal.emissive : 0xff4040, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.6), glowMat);
    const [gx, gz] = rotXZ(0, 0.5, rot);
    glow.position.set(st.pos[0] + gx, st.pos[1] + 1.0, st.pos[2] + gz);
    glow.rotation.y = rot;
    glow.visible = false;
    this.group.add(glow);
    this.disposables.push(sign, signMat, signTex, glow, glowMat);
    const rec = { ...st, pos: [...st.pos], rot, sign, glow, glowMat, glowing: false };
    return rec;
  }

  _buildStations() {
    for (const st of this.data.taskStations || []) this.stations.push(this._buildStation(st, 'task'));
    for (const st of this.data.sabotageStations || []) this.sabotageStations.push(this._buildStation(st, 'fix'));
  }

  _buildDoors() {
    const pal = this.data.palette;
    for (const d0 of this.data.doors || []) {
      const rd = this._resolve(d0);
      const d = { ...d0, pos: rd.pos, rot: rd.rot };
      const height = d.height || 3.2;
      const width = d.width || 3;
      const mat = stdMat(pal.accent, { tex: 'door', texColor: pal.accent, metal: 0.7, rough: 0.35 });
      const grp = new THREE.Group();
      grp.position.set(d.pos[0], d.pos[1], d.pos[2]);
      grp.rotation.y = d.rot || 0;
      const left = new THREE.Mesh(new THREE.BoxGeometry(width / 2, height, 0.2), mat);
      const right = new THREE.Mesh(new THREE.BoxGeometry(width / 2, height, 0.2), mat);
      left.position.set(-width / 4 - width / 2 - 0.08, height / 2, 0); // start open (slid into wall)
      right.position.set(width / 4 + width / 2 + 0.08, height / 2, 0);
      grp.add(left, right);
      this.group.add(grp);
      this.disposables.push(left, right);
      const colIdx = this._collideOriented(d.pos[0], d.pos[1] + height / 2, d.pos[2], width, height, 0.25, d.rot || 0, { enabled: false, tag: 'door', occlude: true });
      this.doors.push({ id: d.id, room: d.room, pos: [...d.pos], width, height, closed: false, target: 0, t: 0, left, right, colliders: colIdx });
    }
  }

  _buildMeetingTable() {
    const pal = this.data.palette;
    const [x, y, z] = this.meetingTable;
    const grp = new THREE.Group();
    const tableMat = stdMat(0x2b2f36, { tex: 'metal', texColor: 0x2b2f36, metal: 0.6, rough: 0.4 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.16, 24), tableMat);
    top.position.y = 0.95;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.9, 12), tableMat);
    stem.position.y = 0.45;
    const btnBase = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.12, 20), stdMat(pal.accent, { metal: 0.6 }));
    btnBase.position.y = 1.09;
    const btnMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xaa0000, emissiveIntensity: 0.8, roughness: 0.4 });
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.14, 20), btnMat);
    btn.position.y = 1.2;
    grp.add(top, stem, btnBase, btn);
    grp.position.set(x, y, z);
    this.group.add(grp);
    this.disposables.push(top, stem, btnBase, btn, btnMat);
    this.collision.addBox([x - 1.6, y, z - 1.6], [x + 1.6, y + 1.05, z + 1.6], { tag: 'table', occlude: false });
    this.meetingButton = btn;
    this.meetingButtonMat = btnMat;
  }

  _buildLights() {
    for (const l0 of this.data.lights || []) {
      let light;
      const l = { ...l0, pos: l0.pos || l0.room ? this._resolve(l0).pos : undefined };
      const color = l.color ?? 0xffffff;
      switch (l.type) {
        case 'ambient': light = new THREE.AmbientLight(color, (l.intensity ?? 0.2) * AMBIENT_SCALE); break;
        case 'hemi': light = new THREE.HemisphereLight(color, l.ground ?? 0x202020, (l.intensity ?? 0.3) * AMBIENT_SCALE); break;
        case 'directional':
          light = new THREE.DirectionalLight(color, l.intensity ?? 1);
          light.position.set(...(l.pos || [10, 20, 10]));
          light.target.position.set(...(l.target || [0, 0, 0]));
          this.group.add(light.target);
          break;
        case 'spot':
          light = new THREE.SpotLight(color, (l.intensity ?? 50) * LIGHT_SCALE, l.range ?? 30, l.angle ?? 0.6, l.penumbra ?? 0.5, l.decay ?? 1.5);
          light.position.set(...l.pos);
          light.target.position.set(...(l.target || [l.pos[0], l.pos[1] - 10, l.pos[2]]));
          this.group.add(light.target);
          if (l.cookie) { light.map = getTexture('cookie', 0xffffff, { size: 512 }); }
          break;
        default:
          light = new THREE.PointLight(color, (l.intensity ?? 30) * LIGHT_SCALE, l.range ?? 25, l.decay ?? 1.6);
          light.position.set(...l.pos);
      }
      if (l.castShadow && this._shadowCount < 3 && light.shadow && !light.isPointLight) {
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.0005;
        this._shadowCount++;
      }
      if (l.flare) this.dynamic.flareLights.push({ light, base: light.intensity });
      if (l.sunSweep) { this.dynamic.sun = light; this.dynamic.sunBase = { pos: [...l.pos], period: l.sunSweep }; }
      this.group.add(light);
      this.lights.push(light);
      this.disposables.push(light);
    }
  }

  _buildSpecials() {
    const pal = this.data.palette;
    if (this.data.sky === 'stars') {
      const tex = getTexture('stars', pal.accent, { size: 1024 });
      tex.repeat.set(4, 2);
      const skyMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false });
      const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 24, 16), skyMat);
      sky.renderOrder = -10;
      this.group.add(sky);
      this.disposables.push(sky, skyMat);
      this.sky = sky;
    }
    for (const s0 of this.data.special || []) {
      const s = { ...s0, pos: this._resolve(s0).pos };
      if (s.type === 'lavaShaft') {
        const tex = getTexture('lava', pal.emissive, { size: 512 });
        tex.repeat.set(2, 2);
        const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: pal.emissive, emissiveMap: tex, emissiveIntensity: 1.6, roughness: 1, metalness: 0 });
        const geo = new THREE.CylinderGeometry(s.radius, s.radius, 0.3, 28);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
        this.group.add(mesh);
        this.disposables.push(mesh, mat);
        this.dynamic.lava.push({ mesh, tex });
        // rim wall
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(s.radius + 0.4, s.radius + 0.4, 1.0, 28, 1, true), stdMat(pal.accent, { metal: 0.7, rough: 0.4, side: THREE.DoubleSide }));
        rim.position.set(s.pos[0], s.pos[1] + 0.5, s.pos[2]);
        this.group.add(rim);
        this.disposables.push(rim);
        // ring of colliders so nobody walks into the lava
        const n = 16;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, a2 = ((i + 1) / n) * Math.PI * 2;
          const R = s.radius + 0.4;
          const x0 = s.pos[0] + Math.cos(a) * R, z0 = s.pos[2] + Math.sin(a) * R, x1 = s.pos[0] + Math.cos(a2) * R, z1 = s.pos[2] + Math.sin(a2) * R;
          this.collision.addBox([Math.min(x0, x1) - 0.2, s.pos[1] - 2, Math.min(z0, z1) - 0.2], [Math.max(x0, x1) + 0.2, s.pos[1] + 1.0, Math.max(z0, z1) + 0.2], { tag: 'rim', occlude: false });
        }
      } else if (s.type === 'dome') {
        const mat = stdMat(0x9ad8ff, { transparent: true, opacity: 0.12, rough: 0.05, metal: 0.4, side: THREE.DoubleSide });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(s.radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        dome.position.set(s.pos[0], s.pos[1], s.pos[2]);
        this.group.add(dome);
        this.disposables.push(dome);
        const ribMat = stdMat(pal.accent, { metal: 0.7, rough: 0.4 });
        for (let i = 0; i < 6; i++) {
          const rib = new THREE.Mesh(new THREE.TorusGeometry(s.ribRadius || s.radius, 0.08, 6, 32, Math.PI), ribMat);
          rib.rotation.y = (i / 6) * Math.PI + Math.PI / 12; // offset so rib feet miss the corridor axes
          rib.position.set(s.pos[0], s.pos[1] + (s.ribY || 0), s.pos[2]);
          this.group.add(rib);
          this.disposables.push(rib);
        }
      } else if (s.type === 'pool') {
        const mat = new THREE.MeshStandardMaterial({ color: s.color ?? 0x2a6fa0, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.3 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.size[0], 0.1, s.size[1]), mat);
        mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
        this.group.add(mesh);
        this.disposables.push(mesh, mat);
      }
    }
  }

  _finalize() {
    for (const [zoneId, mats] of this.buckets) {
      const zone = this.zones.find((z) => z.id === zoneId);
      for (const [material, geos] of mats) {
        if (!geos.length) continue;
        const merged = mergeGeometries(geos, false);
        for (const g of geos) g.dispose();
        if (!merged) { console.warn('merge failed for zone', zoneId); continue; }
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        this.group.add(mesh);
        this.disposables.push(mesh);
        if (zone) zone.meshes.push(mesh);
      }
    }
    this.buckets.clear();
    // pad zone aabbs
    for (const z of this.zones) {
      if (!isFinite(z.aabb.min[0])) z.aabb = { min: [-1, -1, -1], max: [1, 1, 1] };
    }
  }

  build() {
    this._corridors = [];
    this._prepRooms();
    this.meetingTable = this._resolvePos(this.data.meetingTable);
    this.spawn = this._resolvePos(this.data.spawn);
    this._prepCorridors();
    for (const room of this.rooms.values()) {
      if (room.shape === 'ring') this._buildRingRoom(room);
      else this._buildBoxRoom(room);
    }
    for (const c of this._corridors) this._buildCorridor(c);
    this._buildPlatforms();
    this._buildStairs();
    this._buildWalls();
    this._buildVents();
    this._buildStations();
    this._buildDoors();
    this._buildMeetingTable();
    this._buildProps();
    this._buildLights();
    this._buildSpecials();
    this._finalize();
    this.scene.add(this.group);
    return this;
  }

  // ------------------------------------------------------- runtime queries
  zoneAt(x, y, z) {
    let best = null;
    for (const zone of this.zones) {
      const room = zone.room;
      if (zone.kind === 'room' && room) {
        if (room.shape === 'ring') {
          const dx = x - room.cx, dz = z - room.cz;
          const r = Math.hypot(dx, dz);
          if (r < room.ri - 0.5 || r > room.ro + 0.5) continue;
          if (y < room.floorY - 1 || y > room.floorY + room.height + 1) continue;
          let phi = Math.atan2(dz, dx);
          const span = room.a1 - room.a0;
          if (span < Math.PI * 2 - 1e-3) {
            let rel = phi - room.a0;
            rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            if (rel > span) continue;
          }
          return zone;
        }
        const [lx, lz] = rotXZ(x - room.cx, z - room.cz, -room.ry);
        if (Math.abs(lx) <= room.w / 2 + 0.3 && Math.abs(lz) <= room.d / 2 + 0.3 && y >= room.floorY - 1 && y <= room.floorY + room.h + 1) return zone;
      } else {
        const a = zone.aabb;
        if (x >= a.min[0] - 0.3 && x <= a.max[0] + 0.3 && z >= a.min[2] - 0.3 && z <= a.max[2] + 0.3 && y >= a.min[1] - 1 && y <= a.max[1] + 1) best = best || zone;
      }
    }
    return best;
  }

  // Seats around the meeting table for teleporting players into a meeting.
  meetingSeats(n) {
    const out = [];
    const [x, y, z] = this.meetingTable;
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      out.push({ x: x + Math.cos(a) * 2.9, y, z: z + Math.sin(a) * 2.9, yaw: Math.atan2(-(x - (x + Math.cos(a) * 2.9)), -(z - (z + Math.sin(a) * 2.9))) });
    }
    // yaw so that each player faces the table: forward = (-sin yaw, -cos yaw) should equal (table - seat)
    for (const s of out) {
      const dx = x - s.x, dz = z - s.z;
      s.yaw = Math.atan2(-dx, -dz);
    }
    return out;
  }

  spawnPoints(n) {
    const out = [];
    const [x, y, z] = this.spawn;
    const r = this.data.spawnRadius || 3;
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      out.push({ x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r, yaw: Math.atan2(-(x - (x + Math.cos(a) * r)), -(z - (z + Math.sin(a) * r))) });
    }
    return out;
  }

  setDoor(id, closed) {
    const d = this.doors.find((x) => x.id === id);
    if (!d) return;
    d.closed = closed;
    for (const idx of d.colliders) this.collision.setEnabled(idx, closed);
  }

  setStationGlow(id, on) {
    const st = this.stations.find((s) => s.id === id) || this.sabotageStations.find((s) => s.id === id);
    if (!st) return;
    st.glowing = on;
    st.glow.visible = on;
  }

  setVentHighlight(on) {
    for (const v of this.vents) {
      v.mat.emissive.setHex(on ? 0xff3030 : 0x000000);
      v.mat.emissiveIntensity = on ? 0.6 : 0;
    }
  }

  flare() { this._flareT = 1.0; }

  // Cull zones by distance to the camera (everything beyond the vision radius is black anyway).
  cull(camPos, visionRadius) {
    const pad = visionRadius + 6;
    for (const z of this.zones) {
      const a = z.aabb;
      const dx = Math.max(a.min[0] - camPos.x, 0, camPos.x - a.max[0]);
      const dy = Math.max(a.min[1] - camPos.y, 0, camPos.y - a.max[1]);
      const dz = Math.max(a.min[2] - camPos.z, 0, camPos.z - a.max[2]);
      const vis = z.always || dx * dx + dy * dy + dz * dz < pad * pad;
      for (const m of z.meshes) m.visible = vis;
    }
  }

  update(dt, syncedTime) {
    // lava scroll
    for (const l of this.dynamic.lava) {
      l.tex.offset.x = (syncedTime * 0.00003) % 1;
      l.tex.offset.y = (syncedTime * 0.00002) % 1;
    }
    // flare decay
    if (this._flareT > 0) {
      this._flareT = Math.max(0, this._flareT - dt * 0.8);
      for (const f of this.dynamic.flareLights) f.light.intensity = f.base * (1 + this._flareT * 5);
    }
    if (this.dynamic.lava.length) {
      const pulse = 1.4 + Math.sin(syncedTime * 0.002) * 0.25 + (this._flareT || 0) * 2.5;
      for (const l of this.dynamic.lava) l.mesh.material.emissiveIntensity = pulse;
    }
    // sun sweep (host-synced via syncedTime)
    if (this.dynamic.sun) {
      const b = this.dynamic.sunBase;
      const a = ((syncedTime / 1000) % b.period) / b.period * Math.PI * 2;
      const R = Math.hypot(b.pos[0], b.pos[2]) || 40;
      this.dynamic.sun.position.set(Math.cos(a) * R, b.pos[1], Math.sin(a) * R);
    }
    // doors
    for (const d of this.doors) {
      const target = d.closed ? 1 : 0;
      if (Math.abs(d.t - target) > 0.001) {
        d.t += Math.sign(target - d.t) * Math.min(Math.abs(target - d.t), dt * 2.5);
        const open = d.width / 2 + 0.08;
        d.left.position.x = -d.width / 4 - open * (1 - d.t);
        d.right.position.x = d.width / 4 + open * (1 - d.t);
      }
    }
    // station glow pulse
    const g = 0.35 + Math.sin(syncedTime * 0.006) * 0.2;
    for (const s of this.stations) if (s.glowing) s.glowMat.opacity = g;
    for (const s of this.sabotageStations) if (s.glowing) s.glowMat.opacity = g;
    if (this.meetingButtonMat) this.meetingButtonMat.emissiveIntensity = 0.6 + Math.sin(syncedTime * 0.004) * 0.3;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
      if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
    });
    disposeProps();
    disposeTextureCache();
    this.zones.length = 0;
  }
}
