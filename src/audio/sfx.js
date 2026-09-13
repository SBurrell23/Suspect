// Synthesis recipes. Each recipe: (ctx, out, t0, opts) -> optional { stop() } for looping sounds.
let noiseBuf = null;
export function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = ctx.sampleRate * 1.5;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function env(ctx, node, t0, a, d, s, r, peak = 1, sustainLen = 0) {
  const g = node.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0.0001, t0);
  g.linearRampToValueAtTime(peak, t0 + a);
  g.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t0 + a + d);
  const relStart = t0 + a + d + sustainLen;
  g.setValueAtTime(Math.max(0.0001, peak * s), relStart);
  g.exponentialRampToValueAtTime(0.0001, relStart + r);
  return relStart + r;
}

function osc(ctx, type, freq, t0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  return o;
}

function noiseSource(ctx, t0) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  src.start(t0);
  return src;
}

const SURFACE_BAND = { metal: 1400, grating: 2200, soil: 480, concrete: 900 };

export const RECIPES = {
  footstep(ctx, out, t0, { surface = 'metal', volume = 0.35, sprint = false } = {}) {
    const base = SURFACE_BAND[surface] || 1000;
    const f = base * (0.85 + Math.random() * 0.3);
    const src = noiseSource(ctx, t0);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = surface === 'soil' ? 0.8 : 1.6;
    bp.frequency.setValueAtTime(f * 1.4, t0);
    bp.frequency.exponentialRampToValueAtTime(f * 0.5, t0 + 0.04);
    const g = ctx.createGain();
    const end = env(ctx, g, t0, 0.003, 0.03, 0.2, 0.02, volume * (sprint ? 1.25 : 1));
    src.connect(bp).connect(g).connect(out);
    src.stop(end + 0.02);
  },

  kill(ctx, out, t0, { volume = 0.9 } = {}) {
    const o = osc(ctx, 'sawtooth', 220, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.5);
    const g = ctx.createGain();
    env(ctx, g, t0, 0.005, 0.45, 0.3, 0.35, volume);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200, t0); lp.frequency.exponentialRampToValueAtTime(200, t0 + 0.6);
    o.connect(lp).connect(g).connect(out);
    o.start(t0); o.stop(t0 + 1.0);
    const n = noiseSource(ctx, t0);
    const ng = ctx.createGain();
    env(ctx, ng, t0, 0.002, 0.12, 0.1, 0.3, volume * 0.7);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    n.connect(hp).connect(ng).connect(out);
    n.stop(t0 + 0.6);
  },

  report(ctx, out, t0, { volume = 0.6 } = {}) {
    const notes = [523.25, 440, 349.23]; // C5 A4 F4 — descending minor-ish triad
    notes.forEach((f, i) => {
      const o = osc(ctx, 'square', f, t0 + i * 0.22);
      const g = ctx.createGain();
      env(ctx, g, t0 + i * 0.22, 0.01, 0.18, 0.4, 0.9, volume * 0.35);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      o.connect(lp).connect(g).connect(out);
      o.start(t0 + i * 0.22); o.stop(t0 + i * 0.22 + 1.3);
    });
  },

  emergency(ctx, out, t0, { volume = 0.5 } = {}) {
    for (let i = 0; i < 12; i++) {
      const f = i % 2 ? 880 : 660;
      const o = osc(ctx, 'square', f, t0 + i * 0.16);
      const g = ctx.createGain();
      env(ctx, g, t0 + i * 0.16, 0.005, 0.1, 0.5, 0.05, volume * 0.3, 0.02);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      o.connect(lp).connect(g).connect(out);
      o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.2);
    }
  },

  taskComplete(ctx, out, t0, { volume = 0.5 } = {}) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const o = osc(ctx, 'triangle', f, t0 + i * 0.06);
      const g = ctx.createGain();
      env(ctx, g, t0 + i * 0.06, 0.005, 0.05, 0.5, i === 3 ? 0.35 : 0.06, volume * 0.5);
      o.connect(g).connect(out);
      o.start(t0 + i * 0.06); o.stop(t0 + i * 0.06 + 0.6);
    });
  },

  taskFail(ctx, out, t0, { volume = 0.45 } = {}) {
    [311.13, 293.66].forEach((f, i) => {
      const o = osc(ctx, 'sawtooth', f, t0 + i * 0.16);
      const g = ctx.createGain();
      env(ctx, g, t0 + i * 0.16, 0.005, 0.12, 0.4, 0.2, volume * 0.35);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      o.connect(lp).connect(g).connect(out);
      o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.5);
    });
  },

  vent(ctx, out, t0, { volume = 0.5 } = {}) {
    const ring = osc(ctx, 'sine', 137, t0);
    const rg = ctx.createGain(); rg.gain.value = 1;
    ring.connect(rg);
    [190, 197, 184].forEach((f) => {
      const o = osc(ctx, 'square', f, t0);
      const mod = ctx.createGain(); mod.gain.value = 0;
      rg.connect(mod.gain);
      const g = ctx.createGain();
      env(ctx, g, t0, 0.002, 0.18, 0.15, 0.25, volume * 0.25);
      o.connect(mod).connect(g).connect(out);
      o.start(t0); o.stop(t0 + 0.6);
    });
    ring.start(t0); ring.stop(t0 + 0.6);
  },

  door(ctx, out, t0, { volume = 0.5 } = {}) {
    const n = noiseSource(ctx, t0);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(3000, t0); bp.frequency.exponentialRampToValueAtTime(300, t0 + 0.35);
    const g = ctx.createGain();
    env(ctx, g, t0, 0.01, 0.3, 0.2, 0.1, volume * 0.4);
    n.connect(bp).connect(g).connect(out);
    n.stop(t0 + 0.6);
    const th = osc(ctx, 'sine', 70, t0 + 0.32);
    th.frequency.exponentialRampToValueAtTime(35, t0 + 0.6);
    const tg = ctx.createGain();
    env(ctx, tg, t0 + 0.32, 0.005, 0.2, 0.2, 0.15, volume * 0.8);
    th.connect(tg).connect(out);
    th.start(t0 + 0.32); th.stop(t0 + 0.9);
  },

  sabotageAlarm(ctx, out, t0, { volume = 0.35 } = {}) {
    const o = osc(ctx, 'sawtooth', 110, t0);
    const trem = osc(ctx, 'sine', 4, t0);
    const tg = ctx.createGain(); tg.gain.value = 0.5;
    const vca = ctx.createGain(); vca.gain.value = 0.5;
    trem.connect(tg).connect(vca.gain);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const master = ctx.createGain(); master.gain.setValueAtTime(0.0001, t0); master.gain.linearRampToValueAtTime(volume, t0 + 0.3);
    o.connect(lp).connect(vca).connect(master).connect(out);
    const siren = osc(ctx, 'triangle', 500, t0);
    const sg = ctx.createGain(); sg.gain.value = 0.35;
    siren.connect(sg).connect(master);
    const lfo = osc(ctx, 'sine', 0.5, t0);
    const lg = ctx.createGain(); lg.gain.value = 250;
    lfo.connect(lg).connect(siren.frequency);
    o.start(t0); trem.start(t0); siren.start(t0); lfo.start(t0);
    return {
      stop() {
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(0.0001, t + 0.3);
        for (const n of [o, trem, siren, lfo]) n.stop(t + 0.35);
      },
    };
  },

  countdownBeep(ctx, out, t0, { progress = 0, volume = 0.4 } = {}) {
    const f = 600 + progress * 900;
    const o = osc(ctx, 'square', f, t0);
    const g = ctx.createGain();
    env(ctx, g, t0, 0.003, 0.06, 0.4, 0.05, volume * 0.3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    o.connect(lp).connect(g).connect(out);
    o.start(t0); o.stop(t0 + 0.2);
  },

  eject(ctx, out, t0, { volume = 0.5 } = {}) {
    const n = noiseSource(ctx, t0);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(300, t0); bp.frequency.exponentialRampToValueAtTime(4000, t0 + 1.5); bp.frequency.exponentialRampToValueAtTime(200, t0 + 4);
    const g = ctx.createGain();
    env(ctx, g, t0, 0.4, 1.5, 0.6, 2.0, volume * 0.5);
    n.connect(bp).connect(g).connect(out);
    n.stop(t0 + 4.5);
    const o = osc(ctx, 'sine', 880, t0);
    o.frequency.exponentialRampToValueAtTime(160, t0 + 3.5);
    const og = ctx.createGain();
    env(ctx, og, t0, 0.2, 1.0, 0.5, 2.2, volume * 0.35);
    o.connect(og).connect(out);
    o.start(t0); o.stop(t0 + 4);
  },

  voteCast(ctx, out, t0, { volume = 0.4 } = {}) {
    const n = noiseSource(ctx, t0);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 4;
    const g = ctx.createGain();
    env(ctx, g, t0, 0.001, 0.03, 0.1, 0.02, volume);
    n.connect(bp).connect(g).connect(out);
    n.stop(t0 + 0.1);
  },

  click(ctx, out, t0, { volume = 0.25 } = {}) {
    const o = osc(ctx, 'triangle', 1800, t0);
    const g = ctx.createGain();
    env(ctx, g, t0, 0.001, 0.02, 0.1, 0.02, volume);
    o.connect(g).connect(out);
    o.start(t0); o.stop(t0 + 0.08);
  },

  ping(ctx, out, t0, { volume = 0.35, freq = 1320 } = {}) {
    const o = osc(ctx, 'sine', freq, t0);
    const g = ctx.createGain();
    env(ctx, g, t0, 0.005, 0.15, 0.3, 0.3, volume);
    o.connect(g).connect(out);
    o.start(t0); o.stop(t0 + 0.6);
  },

  roleReveal(ctx, out, t0, { impostor = false, volume = 0.5 } = {}) {
    const f = impostor ? 55 : 110;
    const o = osc(ctx, impostor ? 'sawtooth' : 'triangle', f, t0);
    const o2 = osc(ctx, 'sine', f * (impostor ? 1.5 : 2), t0);
    const g = ctx.createGain();
    env(ctx, g, t0, 0.4, 1.2, 0.5, 1.5, volume * 0.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(200, t0); lp.frequency.exponentialRampToValueAtTime(impostor ? 1200 : 3000, t0 + 1.5);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(out);
    o.start(t0); o2.start(t0); o.stop(t0 + 3.5); o2.stop(t0 + 3.5);
  },

  stinger(ctx, out, t0, { win = true, volume = 0.5 } = {}) {
    const notes = win ? [392, 493.88, 587.33, 783.99] : [392, 369.99, 311.13, 233.08];
    notes.forEach((f, i) => {
      const o = osc(ctx, win ? 'triangle' : 'sawtooth', f, t0 + i * 0.18);
      const g = ctx.createGain();
      env(ctx, g, t0 + i * 0.18, 0.01, 0.3, 0.5, i === 3 ? 1.5 : 0.2, volume * 0.4);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = win ? 4000 : 1200;
      o.connect(lp).connect(g).connect(out);
      o.start(t0 + i * 0.18); o.stop(t0 + i * 0.18 + 2.2);
    });
  },

  flare(ctx, out, t0, { volume = 0.4 } = {}) {
    const n = noiseSource(ctx, t0);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(200, t0); lp.frequency.exponentialRampToValueAtTime(1500, t0 + 0.4); lp.frequency.exponentialRampToValueAtTime(120, t0 + 2.5);
    const g = ctx.createGain();
    env(ctx, g, t0, 0.3, 0.8, 0.4, 1.5, volume);
    n.connect(lp).connect(g).connect(out);
    n.stop(t0 + 3);
  },
};
