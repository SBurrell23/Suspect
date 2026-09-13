import { simulateStep, makeMoveState } from '../world/collision.js';
import { quantizeInput } from './snapshot.js';
import { NET } from '../config.js';
import { ACT } from './protocol.js';

// The single rule for how a player moves, shared by host (authoritative) and client (prediction).
export function movementMode({ phase, alive, venting, inMinigame, zoneZeroG, frozen }) {
  if (frozen) return 'frozen';
  if (phase !== 'ROUND' && phase !== 'LOBBY') return 'frozen';
  if (venting || inMinigame) return 'frozen';
  if (!alive) return 'ghost';
  if (zoneZeroG) return 'zeroG';
  return 'walk';
}

export function zoneZeroGAt(level, s) {
  if (!level) return false;
  const z = level.zoneAt(s.x, s.y + 0.5, s.z);
  return !!(z && z.zeroG);
}

// Client-side prediction with a ring buffer of { tick, input, resulting state }.
// On snapshot arrival we compare the host's position at the acked tick to our stored prediction;
// if it diverged we rewind, replay unacked inputs and smooth the visual correction over 150ms.
export class Predictor {
  constructor(world, level) {
    this.world = world;
    this.level = level;
    this.state = makeMoveState();
    this.prev = { x: 0, y: 0, z: 0 };
    this.history = [];
    this.tick = 1;
    this.offset = { x: 0, y: 0, z: 0 };
    this.offsetT = 0;
    this.speedMul = 1;
    this.ctx = { phase: 'LOBBY', alive: true, venting: false, frozen: false };
    this.lastMode = 'walk';
  }

  setWorld(world, level) { this.world = world; this.level = level; this.history.length = 0; }

  modeFor(state, input) {
    return movementMode({ ...this.ctx, inMinigame: (input.actions & ACT.MINIGAME) !== 0, zoneZeroG: zoneZeroGAt(this.level, state) });
  }

  step(rawInput) {
    const input = quantizeInput({ ...rawInput, tick: this.tick });
    const mode = this.modeFor(this.state, input);
    this.lastMode = mode;
    this.prev.x = this.state.x; this.prev.y = this.state.y; this.prev.z = this.state.z;
    simulateStep(this.world, this.state, input, NET.SIM_DT, mode, this.speedMul);
    const s = this.state;
    this.history.push({ tick: input.tick, input, x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, onGround: s.onGround });
    if (this.history.length > 160) this.history.shift();
    this.tick = (this.tick + 1) & 0xffff;
    return input;
  }

  reconcile(host, ackTick) {
    const idx = this.history.findIndex((h) => h.tick === ackTick);
    if (idx < 0) {
      if (this.history.length === 0) {
        const d = Math.hypot(this.state.x - host.x, this.state.y - host.y, this.state.z - host.z);
        if (d > NET.RECONCILE_THRESHOLD * 3) this._snap(host);
      }
      return;
    }
    const h = this.history[idx];
    const d = Math.hypot(h.x - host.x, h.y - host.y, h.z - host.z);
    if (d <= NET.RECONCILE_THRESHOLD) {
      this.history.splice(0, idx + 1);
      return;
    }
    const al = this.lastAlpha ?? 1;
    const before = { x: this.prev.x + (this.state.x - this.prev.x) * al, y: this.prev.y + (this.state.y - this.prev.y) * al, z: this.prev.z + (this.state.z - this.prev.z) * al };
    const s = this.state;
    s.x = host.x; s.y = host.y; s.z = host.z;
    s.vx = h.vx; s.vy = h.vy; s.vz = h.vz; s.onGround = h.onGround;
    for (let i = idx + 1; i < this.history.length; i++) {
      const e = this.history[i];
      const mode = this.modeFor(s, e.input);
      simulateStep(this.world, s, e.input, NET.SIM_DT, mode, this.speedMul);
      e.x = s.x; e.y = s.y; e.z = s.z; e.vx = s.vx; e.vy = s.vy; e.vz = s.vz; e.onGround = s.onGround;
    }
    this.history.splice(0, idx + 1);
    this.prev.x = s.x; this.prev.y = s.y; this.prev.z = s.z;
    // keep the rendered position continuous; the offset decays to zero over RECONCILE_MS
    const k = this.offsetT > 0 ? this.offsetT / (NET.RECONCILE_MS / 1000) : 0;
    this.offset.x = before.x - s.x + this.offset.x * k;
    this.offset.y = before.y - s.y + this.offset.y * k;
    this.offset.z = before.z - s.z + this.offset.z * k;
    const mag = Math.hypot(this.offset.x, this.offset.y, this.offset.z);
    if (mag > 4) { this.offset.x = this.offset.y = this.offset.z = 0; this.offsetT = 0; } // too far: just snap
    else this.offsetT = NET.RECONCILE_MS / 1000;
  }

  _snap(host) {
    this.state.x = host.x; this.state.y = host.y; this.state.z = host.z;
    this.prev.x = host.x; this.prev.y = host.y; this.prev.z = host.z;
    this.state.vx = this.state.vy = this.state.vz = 0;
  }

  // Interpolate between the previous and current fixed step (alpha = accumulator / SIM_DT) so the
  // camera moves smoothly at any frame rate instead of hopping 20 times a second.
  renderPos(dt, out, alpha = 1) {
    const a = Math.max(0, Math.min(1, alpha));
    this.lastAlpha = a;
    const s = this.state, p = this.prev;
    out.x = p.x + (s.x - p.x) * a;
    out.y = p.y + (s.y - p.y) * a;
    out.z = p.z + (s.z - p.z) * a;
    if (this.offsetT > 0) {
      this.offsetT = Math.max(0, this.offsetT - dt);
      const k = this.offsetT / (NET.RECONCILE_MS / 1000);
      out.x += this.offset.x * k; out.y += this.offset.y * k; out.z += this.offset.z * k;
    }
    return out;
  }

  teleport(x, y, z, yaw) {
    const s = this.state;
    s.x = x; s.y = y; s.z = z;
    if (yaw !== undefined) s.yaw = yaw;
    s.vx = s.vy = s.vz = 0;
    s.onGround = true;
    this.prev.x = x; this.prev.y = y; this.prev.z = z;
    this.history.length = 0;
    this.offset.x = this.offset.y = this.offset.z = 0;
    this.offsetT = 0;
  }
}
