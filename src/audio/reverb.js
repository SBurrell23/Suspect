// Procedural impulse responses: exponentially decaying noise. No files.
export const REVERB_TYPES = {
  'small-room': { seconds: 0.45, decay: 4.5, wet: 0.18 },
  'large-metal': { seconds: 2.5, decay: 2.6, wet: 0.32 },
  outdoor: { seconds: 0.8, decay: 3.5, wet: 0.14 },
};

export function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = 12345 + ch * 777;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = seed / 2147483648 - 1;
      // a little early-reflection comb flavour for metal spaces
      const t = i / len;
      d[i] = n * Math.pow(1 - t, decay) * (1 + 0.15 * Math.sin(i * 0.0021 * (ch + 1)));
    }
  }
  return buf;
}

export function makeConvolver(ctx, type) {
  const spec = REVERB_TYPES[type] || REVERB_TYPES['small-room'];
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx, spec.seconds, spec.decay);
  conv.normalize = true;
  return { conv, wet: spec.wet };
}
