import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, PALETTE, dist } from './common.js';

// Press and hold your palm on the scanner for 6 seconds. The ring resets if the cursor leaves.
// VISUAL TASK: other players see the station glow while a real crewmate does this.
export default defineMinigame({ id: 'identScan', label: 'Identity Scan', duration: 'medium', visual: true }, (container, { onComplete, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 420);
  const p = pointer(canvas, w, h);
  const pad = { x: 320, y: 220, r: 90 };
  let t = 0, done = false;
  const need = 6;
  return {
    update(dt, time) {
      if (done) return;
      const on = p.down && dist(p.x, p.y, pad.x, pad.y) < pad.r;
      if (on) t += dt; else t = 0;
      if (t >= need) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, 'HOLD PALM ON SCANNER');
      roundRect(ctx, 200, 100, 240, 240, 24, '#0a1018', PALETTE.line);
      const glow = on ? 0.35 + 0.15 * Math.sin(time * 6) : 0.08;
      ctx.beginPath(); ctx.arc(pad.x, pad.y, pad.r, 0, 7); ctx.fillStyle = `rgba(127,178,255,${glow})`; ctx.fill();
      // hand outline
      ctx.strokeStyle = on ? PALETTE.accent : PALETTE.dim; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(pad.x, pad.y + 25, 34, 40, 0, 0, 7); ctx.stroke();
      for (let i = 0; i < 5; i++) { const a = -Math.PI * 0.85 + i * 0.35; ctx.beginPath(); ctx.ellipse(pad.x + Math.cos(a) * 46, pad.y + 5 + Math.sin(a) * 46, 9, 26, a + Math.PI / 2, 0, 7); ctx.stroke(); }
      // scan line
      if (on) { const y = pad.y - pad.r + ((time * 120) % (pad.r * 2)); ctx.strokeStyle = PALETTE.ok; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pad.x - pad.r, y); ctx.lineTo(pad.x + pad.r, y); ctx.stroke(); }
      // progress ring
      ctx.strokeStyle = PALETTE.line; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(pad.x, pad.y, pad.r + 16, 0, 7); ctx.stroke();
      ctx.strokeStyle = PALETTE.ok; ctx.beginPath(); ctx.arc(pad.x, pad.y, pad.r + 16, -Math.PI / 2, -Math.PI / 2 + (t / need) * Math.PI * 2); ctx.stroke();
      label(ctx, Math.ceil(Math.max(0, need - t)).toString(), pad.x, pad.y - pad.r - 40, 22, PALETTE.text);
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
