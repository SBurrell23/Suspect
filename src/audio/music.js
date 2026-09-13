import { noise } from './sfx.js';

// 16-step sequencer with three procedural beds. Layers by intensity (1 lobby, 2 round, 4 sabotage).
const BEDS = {
  industrial: {
    bpm: 96, root: 55, scale: [0, 3, 5, 7, 10], padType: 'sawtooth', padCut: 500,
    bass: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0],
    chords: [[0, 2, 4], [1, 3, 0], [0, 2, 4], [3, 0, 2]],
    leadProb: 0.35, leadType: 'square', swing: 0,
  },
  'ambient-space': {
    bpm: 68, root: 65.41, scale: [0, 2, 4, 7, 9], padType: 'triangle', padCut: 1200,
    bass: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    kick: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hat: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    chords: [[0, 2, 4], [2, 4, 1], [1, 3, 0], [0, 4, 2]],
    leadProb: 0.2, leadType: 'sine', swing: 0,
  },
  organic: {
    bpm: 84, root: 73.42, scale: [0, 2, 5, 7, 9], padType: 'triangle', padCut: 900,
    bass: [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0],
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    hat: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    chords: [[0, 2, 4], [1, 3, 0], [2, 4, 1], [0, 3, 4]],
    leadProb: 0.3, leadType: 'triangle', swing: 0.08,
  },
};

function noteFreq(root, scale, degree, octave = 0) {
  const n = scale.length;
  const oct = Math.floor(degree / n) + octave;
  const semi = scale[((degree % n) + n) % n];
  return root * Math.pow(2, oct + semi / 12);
}

export class Music {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.bedName = 'ambient-space';
    this.pendingBed = null;
    this.intensity = 1;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.running = false;
    this.padNodes = [];
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.0;
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 800;
    this.padGain.connect(this.padFilter).connect(out);
    this.bassGain = ctx.createGain(); this.bassGain.gain.value = 0; this.bassGain.connect(out);
    this.percGain = ctx.createGain(); this.percGain.gain.value = 0; this.percGain.connect(out);
    this.leadGain = ctx.createGain(); this.leadGain.gain.value = 0; this.leadGain.connect(out);
    this.leadDelay = ctx.createDelay(1.0); this.leadDelay.delayTime.value = 0.375;
    this.leadFb = ctx.createGain(); this.leadFb.gain.value = 0.35;
    this.leadGain.connect(this.leadDelay).connect(this.leadFb).connect(this.leadDelay);
    this.leadDelay.connect(out);
    this._seed = 7;
  }

  _rand() { this._seed = (this._seed * 1664525 + 1013904223) >>> 0; return this._seed / 4294967296; }

  get bed() { return BEDS[this.bedName] || BEDS.industrial; }

  setBed(name) {
    if (!BEDS[name] || name === this.bedName) return;
    if (!this.running) { this.bedName = name; return; }
    this.pendingBed = name;
  }

  setIntensity(n) {
    this.intensity = Math.max(0, Math.min(4, n));
    const t = this.ctx.currentTime;
    const tgt = (g, v) => { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(v, t, 1.2); };
    tgt(this.padGain, this.intensity >= 1 ? 0.16 : 0);
    tgt(this.bassGain, this.intensity >= 2 ? 0.22 : 0);
    tgt(this.percGain, this.intensity >= 3 ? 0.25 : 0);
    tgt(this.leadGain, this.intensity >= 4 ? 0.12 : 0);
    this.padFilter.frequency.setTargetAtTime(this.bed.padCut * (0.6 + this.intensity * 0.25), t, 1.5);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this._startPad();
    this.setIntensity(this.intensity);
    this.timer = setInterval(() => this._tick(), 25);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this._stopPad();
  }

  _startPad() {
    this._stopPad();
    const b = this.bed;
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator();
      o.type = b.padType;
      o.frequency.value = noteFreq(b.root, b.scale, b.chords[0][i], 1);
      o.detune.value = (i - 1) * 6;
      const g = this.ctx.createGain(); g.gain.value = 0.33;
      o.connect(g).connect(this.padGain);
      o.start();
      this.padNodes.push({ o, g });
    }
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = this.ctx.createGain(); lg.gain.value = 220;
    lfo.connect(lg).connect(this.padFilter.frequency);
    lfo.start();
    this.padNodes.push({ o: lfo, g: lg });
  }

  _stopPad() {
    for (const p of this.padNodes) { try { p.o.stop(); } catch (e) { /* */ } p.o.disconnect(); p.g.disconnect(); }
    this.padNodes.length = 0;
  }

  _tick() {
    const lookahead = 0.12;
    while (this.nextTime < this.ctx.currentTime + lookahead) {
      this._schedule(this.step, this.nextTime);
      const stepLen = 60 / this.bed.bpm / 4;
      const swing = this.step % 2 ? this.bed.swing * stepLen : 0;
      this.nextTime += stepLen + swing;
      this.step = (this.step + 1) % 64;
      if (this.step === 0 && this.pendingBed) { this.bedName = this.pendingBed; this.pendingBed = null; this._startPad(); }
    }
  }

  _schedule(step, t) {
    const b = this.bed, ctx = this.ctx;
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    // pad chord change each bar
    if (s16 === 0) {
      const chord = b.chords[bar];
      this.padNodes.slice(0, 3).forEach((p, i) => p.o.frequency.setTargetAtTime(noteFreq(b.root, b.scale, chord[i], 1), t, 0.4));
    }
    if (b.bass[s16]) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const deg = b.chords[bar][0] + (s16 % 8 === 3 ? 4 : 0);
      o.frequency.setValueAtTime(noteFreq(b.root, b.scale, deg, 0), t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      const sat = ctx.createWaveShaper(); sat.curve = this._satCurve();
      o.connect(sat).connect(g).connect(this.bassGain);
      o.start(t); o.stop(t + 0.4);
    }
    if (b.kick[s16]) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(this.percGain); o.start(t); o.stop(t + 0.3);
    }
    if (b.hat[s16]) {
      const src = ctx.createBufferSource(); src.buffer = noise(ctx);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      src.connect(hp).connect(g).connect(this.percGain); src.start(t); src.stop(t + 0.08);
    }
    if (this.intensity >= 4 && this._rand() < b.leadProb) {
      const o = ctx.createOscillator(); o.type = b.leadType;
      const deg = Math.floor(this._rand() * 8);
      o.frequency.setValueAtTime(noteFreq(b.root, b.scale, deg, 3), t);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.6, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(this.leadGain); o.start(t); o.stop(t + 0.25);
    }
  }

  _satCurve() {
    if (this._sat) return this._sat;
    const n = 256, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 2.5); }
    this._sat = c;
    return c;
  }
}
