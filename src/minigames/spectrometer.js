import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, PALETTE, clamp } from './common.js';

// Tune two sliders (frequency, phase) until your waveform cancels the reference into a flat line.
export default defineMinigame({ id: 'spectrometer', label: 'Align Spectrometer', duration: 'medium', visual: false }, (container, { onComplete, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 420);
  const p = pointer(canvas, w, h);
  const target = { f: 1.5 + Math.random() * 2.5, ph: Math.random() * Math.PI * 2 };
  const me = { f: 1.5 + Math.random() * 2.5, ph: Math.random() * Math.PI * 2 };
  const sliders = [
    { key: 'f', x: 80, y: 330, w: 200, min: 1, max: 4.5 },
    { key: 'ph', x: 360, y: 330, w: 200, min: 0, max: Math.PI * 2 },
  ];
  let drag = null, okT = 0, done = false;
  const tol = 0.06 / difficulty;
  return {
    update(dt, t) {
      if (done) return;
      if (p.justDown) for (const s of sliders) if (Math.abs(p.y - s.y) < 24 && p.x > s.x - 12 && p.x < s.x + s.w + 12) drag = s;
      if (p.justUp) drag = null;
      if (drag && p.down) me[drag.key] = drag.min + clamp((p.x - drag.x) / drag.w, 0, 1) * (drag.max - drag.min);
      p.consume();
      // error = mean abs difference over the window
      let err = 0;
      for (let i = 0; i < 64; i++) { const x = (i / 64) * 4; err += Math.abs(Math.sin(x * target.f + target.ph) - Math.sin(x * me.f + me.ph)); }
      err /= 64;
      if (err < tol * 3) okT += dt; else okT = 0;
      if (okT > 1.0) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, 'FLATTEN THE SIGNAL');
      roundRect(ctx, 40, 50, 560, 220, 10, '#0a1018', PALETTE.line);
      ctx.strokeStyle = PALETTE.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(40, 160); ctx.lineTo(600, 160); ctx.stroke();
      const drawWave = (fn, color, width) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        for (let i = 0; i <= 280; i++) { const x = (i / 280) * 4; const y = 160 - fn(x) * 60; if (i === 0) ctx.moveTo(40 + i * 2, y); else ctx.lineTo(40 + i * 2, y); }
        ctx.stroke();
      };
      drawWave((x) => Math.sin(x * target.f + target.ph) * 0.7, 'rgba(127,178,255,0.35)', 2);
      drawWave((x) => Math.sin(x * me.f + me.ph) * 0.7, 'rgba(255,204,77,0.35)', 2);
      const good = err < tol * 3;
      drawWave((x) => (Math.sin(x * target.f + target.ph) - Math.sin(x * me.f + me.ph)) * 0.7, good ? PALETTE.ok : PALETTE.bad, 3);
      for (const s of sliders) {
        roundRect(ctx, s.x, s.y - 5, s.w, 10, 5, PALETTE.bg, PALETTE.line);
        const v = (me[s.key] - s.min) / (s.max - s.min);
        ctx.beginPath(); ctx.arc(s.x + v * s.w, s.y, 14, 0, 7); ctx.fillStyle = drag === s ? PALETTE.accent : PALETTE.panel2; ctx.fill(); ctx.strokeStyle = PALETTE.accent; ctx.lineWidth = 3; ctx.stroke();
        label(ctx, s.key === 'f' ? 'FREQ' : 'PHASE', s.x + s.w / 2, s.y + 36, 12, PALETTE.dim);
      }
      if (good) { ctx.fillStyle = PALETTE.ok; ctx.fillRect(40, 280, 560 * clamp(okT, 0, 1), 6); }
      label(ctx, good ? 'LOCKED' : (err * 100).toFixed(0), 560, 300, 14, good ? PALETTE.ok : PALETTE.dim, 'right');
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
