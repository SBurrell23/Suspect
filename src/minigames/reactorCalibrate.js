import { defineMinigame, setupCanvas, pointer, panelBg, label, PALETTE, dist, clamp } from './common.js';

// Three dials must reach their target values, but turning one nudges its neighbours.
export default defineMinigame({ id: 'reactorCalibrate', label: 'Calibrate Reactor', duration: 'long', visual: false }, (container, { onComplete, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 420);
  const p = pointer(canvas, w, h);
  const dials = [0, 1, 2].map((i) => ({ x: 130 + i * 190, y: 210, r: 60, v: Math.random(), target: 0.15 + Math.random() * 0.7 }));
  const coupling = 0.35 * difficulty;
  let drag = null, lastA = 0, okT = 0, done = false;
  const tol = 0.035;
  const ang = (d) => Math.atan2(p.y - d.y, p.x - d.x);
  return {
    update(dt) {
      if (done) return;
      if (p.justDown) for (const d of dials) if (dist(p.x, p.y, d.x, d.y) < d.r + 10) { drag = d; lastA = ang(d); }
      if (p.justUp) drag = null;
      if (drag && p.down) {
        const a = ang(drag);
        let da = a - lastA;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        lastA = a;
        const dv = da / (Math.PI * 1.5);
        drag.v = clamp(drag.v + dv, 0, 1);
        const i = dials.indexOf(drag);
        if (dials[i - 1]) dials[i - 1].v = clamp(dials[i - 1].v - dv * coupling, 0, 1);
        if (dials[i + 1]) dials[i + 1].v = clamp(dials[i + 1].v + dv * coupling * 0.8, 0, 1);
      }
      p.consume();
      const allOk = dials.every((d) => Math.abs(d.v - d.target) < tol);
      if (allOk) okT += dt; else okT = 0;
      if (okT > 0.8) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, 'SET ALL DIALS TO TARGET');
      for (const d of dials) {
        const ok = Math.abs(d.v - d.target) < tol;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r + 18, Math.PI * 0.75, Math.PI * 2.25); ctx.strokeStyle = PALETTE.line; ctx.lineWidth = 10; ctx.stroke();
        const ta = Math.PI * 0.75 + d.target * Math.PI * 1.5;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r + 18, ta - 0.08, ta + 0.08); ctx.strokeStyle = ok ? PALETTE.ok : PALETTE.warn; ctx.lineWidth = 12; ctx.stroke();
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fillStyle = drag === d ? PALETTE.panel2 : PALETTE.bg; ctx.fill(); ctx.strokeStyle = ok ? PALETTE.ok : PALETTE.accent; ctx.lineWidth = 4; ctx.stroke();
        const a = Math.PI * 0.75 + d.v * Math.PI * 1.5;
        ctx.strokeStyle = PALETTE.text; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(a) * (d.r - 10), d.y + Math.sin(a) * (d.r - 10)); ctx.stroke();
        label(ctx, Math.round(d.v * 100).toString(), d.x, d.y + d.r + 46, 16, ok ? PALETTE.ok : PALETTE.text);
        label(ctx, Math.round(d.target * 100).toString(), d.x, d.y + d.r + 68, 12, PALETTE.dim);
      }
      if (allOk) { ctx.fillStyle = PALETTE.ok; ctx.fillRect(60, 380, 520 * clamp(okT / 0.8, 0, 1), 6); }
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
