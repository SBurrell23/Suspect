import { PLAYER } from '../config.js';
import { ACT } from '../net/protocol.js';

// Axis-aligned box world stored in a uniform grid. Player is a vertical capsule
// approximated as a circle (XZ) + vertical span (Y). No physics engine.
export class CollisionWorld {
  constructor(cell = PLAYER.GRID_CELL) {
    this.cell = cell;
    this.boxes = [];
    this.grid = new Map();
    this.bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    this._stamp = 1;
    this._stamps = [];
  }

  addBox(min, max, opts = {}) {
    const b = {
      min: [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])],
      max: [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])],
      enabled: opts.enabled !== false,
      tag: opts.tag || '',
      surface: opts.surface || 'metal',
      occlude: opts.occlude !== false,
    };
    const idx = this.boxes.length;
    this.boxes.push(b);
    this._stamps.push(0);
    for (let i = 0; i < 3; i++) {
      this.bounds.min[i] = Math.min(this.bounds.min[i], b.min[i]);
      this.bounds.max[i] = Math.max(this.bounds.max[i], b.max[i]);
    }
    this._insert(b, idx);
    return idx;
  }

  setEnabled(idx, on) { if (this.boxes[idx]) this.boxes[idx].enabled = on; }

  _key(cx, cz) { return (cx + 4096) * 8192 + (cz + 4096); }

  _insert(b, idx) {
    const c = this.cell;
    const x0 = Math.floor(b.min[0] / c), x1 = Math.floor(b.max[0] / c);
    const z0 = Math.floor(b.min[2] / c), z1 = Math.floor(b.max[2] / c);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = this._key(x, z);
        let list = this.grid.get(k);
        if (!list) { list = []; this.grid.set(k, list); }
        list.push(idx);
      }
    }
  }

  // Collect unique box indices overlapping an XZ rectangle.
  query(minx, minz, maxx, maxz, out) {
    out.length = 0;
    const c = this.cell;
    const stamp = ++this._stamp;
    const x0 = Math.floor(minx / c), x1 = Math.floor(maxx / c);
    const z0 = Math.floor(minz / c), z1 = Math.floor(maxz / c);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.grid.get(this._key(x, z));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const idx = list[i];
          if (this._stamps[idx] === stamp) continue;
          this._stamps[idx] = stamp;
          out.push(this.boxes[idx]);
        }
      }
    }
    return out;
  }

  // Ray vs all enabled occluding boxes. Returns distance to first hit or null.
  raycast(o, d, maxDist) {
    let best = null;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b.enabled || !b.occlude) continue;
      let tmin = 0, tmax = maxDist;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        const oa = o[a], da = d[a];
        if (Math.abs(da) < 1e-9) {
          if (oa < b.min[a] || oa > b.max[a]) { ok = false; break; }
        } else {
          let t1 = (b.min[a] - oa) / da;
          let t2 = (b.max[a] - oa) / da;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (ok && (best === null || tmin < best)) best = tmin;
    }
    return best;
  }

  // Surface type of the box directly under a point (for footsteps).
  surfaceAt(x, y, z) {
    const out = [];
    this.query(x - 0.5, z - 0.5, x + 0.5, z + 0.5, out);
    let best = null, bestTop = -Infinity;
    for (const b of out) {
      if (!b.enabled) continue;
      if (b.max[1] <= y + 0.1 && b.max[1] > bestTop && x >= b.min[0] - 0.4 && x <= b.max[0] + 0.4 && z >= b.min[2] - 0.4 && z <= b.max[2] + 0.4) {
        bestTop = b.max[1]; best = b;
      }
    }
    return best ? best.surface : 'metal';
  }
}

const _q = [];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function resolveHorizontal(world, s) {
  const r = PLAYER.RADIUS;
  const feet = s.y, head = s.y + PLAYER.HEIGHT;
  for (let iter = 0; iter < PLAYER.COLLISION_ITER; iter++) {
    world.query(s.x - r - 0.2, s.z - r - 0.2, s.x + r + 0.2, s.z + r + 0.2, _q);
    let moved = false;
    for (let i = 0; i < _q.length; i++) {
      const b = _q[i];
      if (!b.enabled) continue;
      if (b.max[1] <= feet + PLAYER.STEP_HEIGHT + 1e-4) continue; // walkable / below
      if (b.min[1] >= head - 1e-4) continue; // above head
      const cx = clamp(s.x, b.min[0], b.max[0]);
      const cz = clamp(s.z, b.min[2], b.max[2]);
      const dx = s.x - cx, dz = s.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        const push = r - d + PLAYER.SKIN;
        s.x += (dx / d) * push;
        s.z += (dz / d) * push;
      } else {
        const pl = s.x - b.min[0] + r, pr = b.max[0] - s.x + r;
        const pn = s.z - b.min[2] + r, ps = b.max[2] - s.z + r;
        const m = Math.min(pl, pr, pn, ps);
        if (m === pl) s.x -= pl + PLAYER.SKIN;
        else if (m === pr) s.x += pr + PLAYER.SKIN;
        else if (m === pn) s.z -= pn + PLAYER.SKIN;
        else s.z += ps + PLAYER.SKIN;
      }
      moved = true;
    }
    if (!moved) break;
  }
}

function findGround(world, s) {
  const r = PLAYER.RADIUS * 0.85;
  world.query(s.x - r, s.z - r, s.x + r, s.z + r, _q);
  let groundY = -Infinity;
  for (let i = 0; i < _q.length; i++) {
    const b = _q[i];
    if (!b.enabled) continue;
    const top = b.max[1];
    if (top > s.y + PLAYER.STEP_HEIGHT + 1e-4) continue;
    if (top < s.y - 50) continue;
    const cx = clamp(s.x, b.min[0], b.max[0]);
    const cz = clamp(s.z, b.min[2], b.max[2]);
    const dx = s.x - cx, dz = s.z - cz;
    if (dx * dx + dz * dz < r * r && top > groundY) groundY = top;
  }
  return groundY;
}

function resolveCeiling(world, s) {
  const r = PLAYER.RADIUS * 0.85;
  const head = s.y + PLAYER.HEIGHT;
  world.query(s.x - r, s.z - r, s.x + r, s.z + r, _q);
  for (let i = 0; i < _q.length; i++) {
    const b = _q[i];
    if (!b.enabled) continue;
    if (b.min[1] >= head || b.max[1] <= s.y + PLAYER.STEP_HEIGHT) continue;
    if (b.min[1] < s.y + PLAYER.HEIGHT * 0.5) continue; // that's a wall, not a ceiling
    const cx = clamp(s.x, b.min[0], b.max[0]);
    const cz = clamp(s.z, b.min[2], b.max[2]);
    const dx = s.x - cx, dz = s.z - cz;
    if (dx * dx + dz * dz < r * r) {
      s.y = b.min[1] - PLAYER.HEIGHT - PLAYER.SKIN;
      if (s.vy > 0) s.vy = 0;
    }
  }
}

function resolveVertical(world, s, dt, gravity) {
  s.vy += gravity * dt;
  const newY = s.y + s.vy * dt;
  const groundY = findGround(world, s);
  if (s.vy <= 0 && groundY > -Infinity && newY <= groundY + 1e-3) {
    s.y = groundY;
    s.vy = 0;
    s.onGround = true;
  } else {
    s.y = newY;
    s.onGround = false;
  }
  resolveCeiling(world, s);
}

// Deterministic fixed-step movement shared by host (authoritative) and client (prediction).
// s: { x, y, z, vx, vy, vz, yaw, onGround }
// mode: 'walk' | 'ghost' | 'zeroG' | 'frozen'
export function simulateStep(world, s, input, dt, mode, speedMul = 1) {
  s.yaw = input.yaw;
  if (mode === 'frozen') { s.vx = s.vz = s.vy = 0; return s; }

  const fx = -Math.sin(input.yaw), fz = -Math.cos(input.yaw);
  const rx = Math.cos(input.yaw), rz = -Math.sin(input.yaw);
  let mx = fx * input.moveZ + rx * input.moveX;
  let mz = fz * input.moveZ + rz * input.moveX;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }

  if (mode === 'ghost') {
    const sp = PLAYER.GHOST_SPEED * speedMul;
    s.x += mx * sp * dt;
    s.z += mz * sp * dt;
    s.y += (input.moveY || 0) * sp * dt;
    const bmin = world.bounds.min, bmax = world.bounds.max;
    s.x = clamp(s.x, bmin[0] - 5, bmax[0] + 5);
    s.z = clamp(s.z, bmin[2] - 5, bmax[2] + 5);
    s.y = clamp(s.y, bmin[1] - 1, bmax[1] + 12);
    s.vy = 0;
    s.onGround = false;
    return s;
  }

  if (mode === 'zeroG') {
    const th = PLAYER.ZERO_G_THRUST;
    s.vx = (s.vx + mx * th * dt) * PLAYER.ZERO_G_DRAG;
    s.vz = (s.vz + mz * th * dt) * PLAYER.ZERO_G_DRAG;
    s.vy = (s.vy + (input.moveY || 0) * th * dt) * PLAYER.ZERO_G_DRAG;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    resolveHorizontal(world, s);
    const ny = s.y + s.vy * dt;
    const groundY = findGround(world, s);
    if (s.vy < 0 && groundY > -Infinity && ny <= groundY) { s.y = groundY; s.vy = 0; }
    else s.y = ny;
    resolveCeiling(world, s);
    s.onGround = false;
    return s;
  }

  // walk
  const sprint = (input.actions & ACT.SPRINT) !== 0;
  const sp = (sprint ? PLAYER.SPRINT_SPEED : PLAYER.WALK_SPEED) * speedMul;
  s.vx = mx * sp;
  s.vz = mz * sp;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  resolveHorizontal(world, s);
  resolveVertical(world, s, dt, PLAYER.GRAVITY);
  return s;
}

export function makeMoveState(x = 0, y = 0, z = 0, yaw = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw, onGround: false };
}

export function copyMoveState(dst, src) {
  dst.x = src.x; dst.y = src.y; dst.z = src.z;
  dst.vx = src.vx; dst.vy = src.vy; dst.vz = src.vz;
  dst.yaw = src.yaw; dst.onGround = src.onGround;
  return dst;
}
