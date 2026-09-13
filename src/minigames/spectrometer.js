import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, PALETTE, clamp } from './common.js';

// Tune frequency, phase AND amplitude until your waveform cancels the reference into a flat line,
// then hold it there while the reference slowly drifts.
export default defineMinigame({ id: 'spectrometer', label: 'Align Spectrometer', duration: 'medium', visual: false }, (container, { onComplete, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 440);
  const p = pointer(canvas, w, h);
  const target = { f: 1.5 + Math.random() * 2.5, ph: Math.random() * Math.PI * 2, a: 0.4 + Math.random() * 0.6 };
  const me = { f: 1.5 + Math.random() * 2.5, ph: Math.random() * Math.PI * 2, a: 0.4 + Math.random() * 0.6 };
  const sliders = [
    { key: 'f', x: 60, y: 350, w: 150, min: 1, max: 4.5, name: 'FREQ' },
    { key: 'ph', x: 245, y: 350, w: 150, min: 0, max: Math.PI * 2, name: 'PHASE' },
    { key: 'a', x: 430, y: 350, w: 150, min: 0.2, max: 1.2, name: 'AMP' },
  ];
  let drag = null, okT = 0, done = false, drift = 0;
  const tol = 0.05 / difficulty;
  return {
    update(dt, t) {
      if (done) return;
      if (p.justDown) for (const s of sliders) if (Math.abs(p.y - s.y) < 24 && p.x > s.x - 12 && p.x < s.x + s.w + 12) drag = s;
      if (p.justUp) drag = null;
      if (drag && p.down) me[drag.key] = drag.min + clamp((p.x - drag.x) / drag.w, 0, 1) * (drag.max - drag.min);
      p.consume();
      // the reference drifts slowly so you must keep tracking it
      drift += dt;
      target.ph += Math.sin(drift * 0.35) * dt * 0.12 * difficulty;
      let err = 0;
      for (let i = 0; i < 64; i++) { const x = (i / 64) * 4; err += Math.abs(target.a * Math.sin(x * target.f + target.ph) - me.a * Math.sin(x * me.f + me.ph)); }
      err /= 64;
      const good = err < tol * 3;
      if (good) okT += dt; else okT = Math.max(0, okT - dt * 2);
      if (okT > 1.8) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, 'FLATTEN THE SIGNAL AND HOLD IT');
      roundRect(ctx, 40, 50, 560, 230, 10, '#0a1018', PALETTE.line);
      ctx.strokeStyle = PALETTE.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(40, 165); ctx.lineTo(600, 165); ctx.stroke();
      const drawWave = (fn, color, width) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        for (let i = 0; i <= 280; i++) { const x = (i / 280) * 4; const y = 165 - fn(x) * 70; if (i === 0) ctx.moveTo(40 + i * 2, y); else ctx.lineTo(40 + i * 2, y); }
        ctx.stroke();
      };
      drawWave((x) => target.a * Math.sin(x * target.f + target.ph), 'rgba(127,178,255,0.35)', 2);
      drawWave((x) => me.a * Math.sin(x * me.f + me.ph), 'rgba(255,204,77,0.35)', 2);
      drawWave((x) => target.a * Math.sin(x * target.f + target.ph) - me.a * Math.sin(x * me.f + me.ph), good ? PALETTE.ok : PALETTE.bad, 3);
      for (const s of sliders) {
        roundRect(ctx, s.x, s.y - 5, s.w, 10, 5, PALETTE.bg, PALETTE.line);
        const v = (me[s.key] - s.min) / (s.max - s.min);
        ctx.beginPath(); ctx.arc(s.x + v * s.w, s.y, 14, 0, 7); ctx.fillStyle = drag === s ? PALETTE.accent : PALETTE.panel2; ctx.fill(); ctx.strokeStyle = PALETTE.accent; ctx.lineWidth = 3; ctx.stroke();
        label(ctx, s.name, s.x + s.w / 2, s.y + 36, 12, PALETTE.dim);
      }
      roundRect(ctx, 40, 296, 560, 10, 5, PALETTE.bg, PALETTE.line);
      if (okT > 0) roundRect(ctx, 42, 298, Math.max(4, 556 * clamp(okT / 1.8, 0, 1)), 6, 3, PALETTE.ok);
      label(ctx, good ? 'LOCKED' : (err * 100).toFixed(0), 590, 318, 13, good ? PALETTE.ok : PALETTE.dim, 'right');
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
