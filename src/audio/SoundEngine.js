import * as THREE from 'three';
import { RECIPES } from './sfx.js';
import { makeConvolver, REVERB_TYPES } from './reverb.js';
import { Music } from './music.js';

// One AudioContext shared with THREE (for PositionalAudio voice) and everything else.
export class SoundEngine {
  constructor() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    THREE.AudioContext.setContext(ctx);
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicDuck = ctx.createGain(); this.musicDuck.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.5; this.musicBus.connect(this.musicDuck);
    this.voiceBus = ctx.createGain(); this.voiceBus.connect(this.master);
    // reverb sends (one convolver per space type)
    this.reverbs = {};
    for (const type of Object.keys(REVERB_TYPES)) {
      const { conv, wet } = makeConvolver(ctx, type);
      const send = ctx.createGain(); send.gain.value = 0;
      this.sfxBus.connect(send); send.connect(conv); conv.connect(this.master);
      this.reverbs[type] = { conv, send, wet };
    }
    this.currentReverb = null;
    this.setRoomReverb('small-room');
    this.music = new Music(ctx, this.musicBus);
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.ducked = false;
    this.loops = new Map();
  }

  async resume() { if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (e) { /* ignore */ } } }

  setVolumes({ master, music, voice }) {
    const t = this.ctx.currentTime;
    if (master !== undefined) this.master.gain.setTargetAtTime(master, t, 0.05);
    if (music !== undefined) this.musicBus.gain.setTargetAtTime(music, t, 0.05);
    if (voice !== undefined) this.voiceBus.gain.setTargetAtTime(voice, t, 0.05);
  }

  setRoomReverb(type) {
    if (!this.reverbs[type]) type = 'small-room';
    if (this.currentReverb === type) return;
    this.currentReverb = type;
    const t = this.ctx.currentTime;
    for (const [k, r] of Object.entries(this.reverbs)) r.send.gain.setTargetAtTime(k === type ? r.wet : 0, t, 0.4);
  }

  setListener(x, y, z, yaw) { this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw; }

  play(name, opts = {}) {
    const r = RECIPES[name];
    if (!r || this.ctx.state !== 'running') return null;
    try { return r(this.ctx, this.sfxBus, this.ctx.currentTime + (opts.delay || 0), opts); } catch (e) { console.warn('sfx', name, e); return null; }
  }

  // Positional one-shot: gain by distance, pan by bearing relative to the listener's yaw.
  playAt(name, x, y, z, opts = {}) {
    const r = RECIPES[name];
    if (!r || this.ctx.state !== 'running') return;
    const L = this.listener;
    const dx = x - L.x, dy = y - L.y, dz = z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const maxD = opts.maxDistance || 26;
    if (d > maxD) return;
    const gain = Math.min(1, 2.5 / Math.max(1, d)) * (1 - d / maxD);
    const fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw);
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const dl = d > 0.01 ? 1 / d : 0;
    const pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) * dl));
    const behind = (dx * fx + dz * fz) * dl < -0.3;
    const g = this.ctx.createGain(); g.gain.value = gain * (behind ? 0.75 : 1);
    const p = this.ctx.createStereoPanner(); p.pan.value = pan * 0.8;
    g.connect(p).connect(this.sfxBus);
    try { r(this.ctx, g, this.ctx.currentTime, opts); } catch (e) { /* ignore */ }
    setTimeout(() => { try { g.disconnect(); p.disconnect(); } catch (e) { /* */ } }, 6000);
  }

  startLoop(key, name, opts = {}) {
    if (this.loops.has(key)) return;
    const h = this.play(name, opts);
    if (h) this.loops.set(key, h);
  }
  stopLoop(key) {
    const h = this.loops.get(key);
    if (h) { try { h.stop(); } catch (e) { /* */ } this.loops.delete(key); }
  }

  // Duck music by -12dB whenever any voice peer exceeds the speaking threshold.
  duck(on) {
    if (on === this.ducked) return;
    this.ducked = on;
    this.musicDuck.gain.setTargetAtTime(on ? 0.25 : 1, this.ctx.currentTime, on ? 0.05 : 0.6);
  }
}
