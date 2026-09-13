import { BIN } from './protocol.js';

// Snapshot (host -> clients), little-endian:
//   u8 type, u16 tick, u8 count
//   per player (12 bytes): u8 slot, i16 x, i16 y, i16 z, i16 yaw, u8 flags, u16 ackTick
// (The spec's 10-byte record is extended by a u16 ackTick so clients can reconcile
//  prediction against the last input the host processed.)
const PLAYER_BYTES = 12;
const POS_SCALE = 100;
const YAW_SCALE = 10000;

function clampI16(v) { return Math.max(-32768, Math.min(32767, Math.round(v))); }

export function encodeSnapshot(tick, players) {
  const buf = new ArrayBuffer(4 + players.length * PLAYER_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, BIN.SNAPSHOT);
  dv.setUint16(1, tick & 0xffff, true);
  dv.setUint8(3, players.length);
  let o = 4;
  for (const p of players) {
    dv.setUint8(o, p.slot); o += 1;
    dv.setInt16(o, clampI16(p.x * POS_SCALE), true); o += 2;
    dv.setInt16(o, clampI16(p.y * POS_SCALE), true); o += 2;
    dv.setInt16(o, clampI16(p.z * POS_SCALE), true); o += 2;
    dv.setInt16(o, clampI16(wrapPi(p.yaw) * YAW_SCALE), true); o += 2;
    dv.setUint8(o, p.flags & 0xff); o += 1;
    dv.setUint16(o, p.ackTick & 0xffff, true); o += 2;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const dv = new DataView(buf);
  const tick = dv.getUint16(1, true);
  const count = dv.getUint8(3);
  const players = [];
  let o = 4;
  for (let i = 0; i < count; i++) {
    players.push({
      slot: dv.getUint8(o),
      x: dv.getInt16(o + 1, true) / POS_SCALE,
      y: dv.getInt16(o + 3, true) / POS_SCALE,
      z: dv.getInt16(o + 5, true) / POS_SCALE,
      yaw: dv.getInt16(o + 7, true) / YAW_SCALE,
      flags: dv.getUint8(o + 9),
      ackTick: dv.getUint16(o + 10, true),
    });
    o += PLAYER_BYTES;
  }
  return { tick, players };
}

// Input (client -> host). Carries the last N inputs for loss redundancy.
//   u8 type, u8 count
//   per input (8 bytes): u16 tick, i8 moveX, i8 moveZ, i8 moveY, i16 yaw, u8 actions
const INPUT_BYTES = 8;

export function encodeInputs(inputs) {
  const buf = new ArrayBuffer(2 + inputs.length * INPUT_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, BIN.INPUT);
  dv.setUint8(1, inputs.length);
  let o = 2;
  for (const inp of inputs) {
    dv.setUint16(o, inp.tick & 0xffff, true); o += 2;
    dv.setInt8(o, Math.round(Math.max(-1, Math.min(1, inp.moveX)) * 100)); o += 1;
    dv.setInt8(o, Math.round(Math.max(-1, Math.min(1, inp.moveZ)) * 100)); o += 1;
    dv.setInt8(o, Math.round(Math.max(-1, Math.min(1, inp.moveY || 0)) * 100)); o += 1;
    dv.setInt16(o, clampI16(wrapPi(inp.yaw) * YAW_SCALE), true); o += 2;
    dv.setUint8(o, inp.actions & 0xff); o += 1;
  }
  return buf;
}

export function decodeInputs(buf) {
  const dv = new DataView(buf);
  const count = dv.getUint8(1);
  const inputs = [];
  let o = 2;
  for (let i = 0; i < count; i++) {
    inputs.push({
      tick: dv.getUint16(o, true),
      moveX: dv.getInt8(o + 2) / 100,
      moveZ: dv.getInt8(o + 3) / 100,
      moveY: dv.getInt8(o + 4) / 100,
      yaw: dv.getInt16(o + 5, true) / YAW_SCALE,
      actions: dv.getUint8(o + 7),
    });
    o += INPUT_BYTES;
  }
  return inputs;
}

export function wrapPi(a) {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// u16 tick comparison with wraparound: returns a - b in [-32768, 32767]
export function tickDiff(a, b) {
  let d = (a - b) & 0xffff;
  if (d >= 0x8000) d -= 0x10000;
  return d;
}

// Quantize a value the same way the wire does so host/client prediction agree.
export function quantizeInput(inp) {
  const q = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
  return {
    tick: inp.tick & 0xffff,
    moveX: q(inp.moveX),
    moveZ: q(inp.moveZ),
    moveY: q(inp.moveY || 0),
    yaw: clampI16(wrapPi(inp.yaw) * YAW_SCALE) / YAW_SCALE,
    actions: inp.actions & 0xff,
  };
}
