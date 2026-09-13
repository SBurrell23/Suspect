import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, progressBar, PALETTE, clamp, dist } from './common.js';

// Click-and-hold the valve: the needle climbs while held and falls when released. Keep it inside
// the moving green band for 4 seconds total.
export default defineMinigame({ id: 'airlockPressurize', label: 'Pressurize Airlock', duration: 'medium', visual: false }, (container, { onComplete, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 420);
  const p = pointer(canvas, w, h);
  let needle = 0.1, band = 0.5, bandT = 0, bandTarget = 0.5, held = 0, done = false;
  const bandW = 0.16 / difficulty;
  const valve = { x: 320, y: 300, r: 52 };
  return {
    update(dt, t) {
      if (done) return;
      const holding = p.down && dist(p.x, p.y, valve.x, valve.y) < valve.r + 8;
      needle += (holding ? 0.55 : -0.45) * dt;
      needle = clamp(needle, 0, 1);
      bandT -= dt;
      if (bandT <= 0) { bandT = 1.5 + Math.random() * 1.5; bandTarget = 0.2 + Math.random() * 0.6; }
      band += (bandTarget - band) * Math.min(1, dt * 0.8 * difficulty);
      const inside = Math.abs(needle - band) < bandW / 2;
      if (inside) held += dt; else held = Math.max(0, held - dt * 0.3);
      if (held >= 4) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, 'HOLD PRESSURE IN THE GREEN');
      // gauge
      const gx = 80, gy = 120, gw = 480, gh = 60;
      roundRect(ctx, gx, gy, gw, gh, 8, '#0a1018', PALETTE.line);
      ctx.fillStyle = 'rgba(95,227,138,0.35)';
      ctx.fillRect(gx + (band - bandW / 2) * gw, gy + 4, bandW * gw, gh - 8);
      for (let i = 0; i <= 10; i++) { ctx.fillStyle = PALETTE.line; ctx.fillRect(gx + (i / 10) * gw - 1, gy + gh - 14, 2, 10); }
      ctx.fillStyle = inside ? PALETTE.ok : PALETTE.bad;
      ctx.fillRect(gx + needle * gw - 3, gy - 6, 6, gh + 12);
      // valve
      ctx.beginPath(); ctx.arc(valve.x, valve.y, valve.r, 0, 7); ctx.fillStyle = holding ? PALETTE.accent : PALETTE.panel2; ctx.fill(); ctx.strokeStyle = PALETTE.accent; ctx.lineWidth = 5; ctx.stroke();
      const a = t * (holding ? 4 : 0.5);
      ctx.strokeStyle = PALETTE.bg; ctx.lineWidth = 7;
      for (let i = 0; i < 4; i++) { const k = a + (i * Math.PI) / 4; ctx.beginPath(); ctx.moveTo(valve.x - Math.cos(k) * 36, valve.y - Math.sin(k) * 36); ctx.lineTo(valve.x + Math.cos(k) * 36, valve.y + Math.sin(k) * 36); ctx.stroke(); }
      label(ctx, 'HOLD', valve.x, valve.y + valve.r + 20, 12, PALETTE.dim);
      progressBar(ctx, 80, 210, 480, 16, held / 4);
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
