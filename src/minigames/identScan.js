import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, PALETTE, dist } from './common.js';

// Press and hold your palm on the scanner for 8 seconds. The scanner pad drifts; the ring resets
// if the cursor leaves it. VISUAL TASK: others see the station glow while a real crewmate does this.
export default defineMinigame({ id: 'identScan', label: 'Identity Scan', duration: 'medium', visual: true }, (container, { onComplete, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 420);
  const p = pointer(canvas, w, h);
  const pad = { x: 320, y: 220, r: 70, vx: 30, vy: 22 };
  let t = 0, done = false, jumpT = 2.5;
  const need = 8;
  return {
    update(dt, time) {
      if (done) return;
      const on = p.down && dist(p.x, p.y, pad.x, pad.y) < pad.r;
      if (on) {
        t += dt;
        pad.x += pad.vx * dt * difficulty; pad.y += pad.vy * dt * difficulty;
        if (pad.x < 120 || pad.x > 520) pad.vx *= -1;
        if (pad.y < 120 || pad.y > 320) pad.vy *= -1;
        jumpT -= dt;
        if (jumpT <= 0) { jumpT = 2 + Math.random() * 2; pad.vx = (Math.random() - 0.5) * 90; pad.vy = (Math.random() - 0.5) * 70; }
      } else t = 0;
      if (t >= need) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, 'HOLD YOUR PALM ON THE MOVING SCANNER');
      roundRect(ctx, 60, 80, 520, 280, 24, '#0a1018', PALETTE.line);
      const glow = on ? 0.35 + 0.15 * Math.sin(time * 6) : 0.08;
      ctx.beginPath(); ctx.arc(pad.x, pad.y, pad.r, 0, 7); ctx.fillStyle = `rgba(127,178,255,${glow})`; ctx.fill();
      ctx.strokeStyle = on ? PALETTE.accent : PALETTE.dim; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(pad.x, pad.y + 18, 26, 32, 0, 0, 7); ctx.stroke();
      for (let i = 0; i < 5; i++) { const a = -Math.PI * 0.85 + i * 0.35; ctx.beginPath(); ctx.ellipse(pad.x + Math.cos(a) * 36, pad.y + 4 + Math.sin(a) * 36, 7, 20, a + Math.PI / 2, 0, 7); ctx.stroke(); }
      if (on) { const y = pad.y - pad.r + ((time * 120) % (pad.r * 2)); ctx.strokeStyle = PALETTE.ok; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pad.x - pad.r, y); ctx.lineTo(pad.x + pad.r, y); ctx.stroke(); }
      ctx.strokeStyle = PALETTE.line; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(pad.x, pad.y, pad.r + 12, 0, 7); ctx.stroke();
      ctx.strokeStyle = PALETTE.ok; ctx.beginPath(); ctx.arc(pad.x, pad.y, pad.r + 12, -Math.PI / 2, -Math.PI / 2 + (t / need) * Math.PI * 2); ctx.stroke();
      label(ctx, Math.ceil(Math.max(0, need - t)).toString(), 590, 395, 20, PALETTE.text, 'right');
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
