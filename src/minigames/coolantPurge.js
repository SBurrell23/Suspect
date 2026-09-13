import { defineMinigame, setupCanvas, pointer, keyState, panelBg, label, progressBar, roundRect, dist, PALETTE, clamp } from './common.js';

// Hold the drifting valve with the mouse AND hold SPACE on the second valve for 5s total.
export default defineMinigame({ id: 'coolantPurge', label: 'Purge Coolant', duration: 'short', visual: false }, (container, { onComplete, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 400);
  const p = pointer(canvas, w, h);
  const keys = keyState();
  const valve = { x: 200, y: 220, r: 46, vx: 40, vy: 30, held: false };
  let progress = 0, jumpT = 1.5, done = false;
  const need = 5;
  return {
    update(dt, t) {
      if (done) return;
      const speed = 1 + (difficulty - 1) * 0.5;
      // drift while held
      if (valve.held) {
        valve.x += valve.vx * dt * speed; valve.y += valve.vy * dt * speed;
        if (valve.x < 80 || valve.x > 330) valve.vx *= -1;
        if (valve.y < 120 || valve.y > 330) valve.vy *= -1;
        jumpT -= dt;
        if (jumpT <= 0) { jumpT = 1.2 + Math.random(); valve.vx = (Math.random() - 0.5) * 120 * speed; valve.vy = (Math.random() - 0.5) * 120 * speed; }
      }
      valve.x = clamp(valve.x, 80, 330); valve.y = clamp(valve.y, 120, 330);
      const overValve = dist(p.x, p.y, valve.x, valve.y) < valve.r + 6;
      valve.held = p.down && overValve;
      const spaceHeld = keys.has('Space');
      if (valve.held && spaceHeld) progress += dt; else progress = Math.max(0, progress - dt * 0.6);
      if (progress >= need) { done = true; setTimeout(onComplete, 250); }
      // draw
      panelBg(ctx, w, h, 'HOLD BOTH VALVES');
      // pipes
      ctx.strokeStyle = PALETTE.line; ctx.lineWidth = 18; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(60, 220); ctx.lineTo(580, 220); ctx.stroke();
      ctx.strokeStyle = valve.held && spaceHeld ? PALETTE.ok : '#2e3c4c'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(60, 220); ctx.lineTo(60 + 520 * (progress / need), 220); ctx.stroke();
      // valve A (mouse)
      ctx.beginPath(); ctx.arc(valve.x, valve.y, valve.r, 0, 7); ctx.fillStyle = valve.held ? PALETTE.ok : PALETTE.panel2; ctx.fill(); ctx.strokeStyle = PALETTE.accent; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = PALETTE.bg; ctx.lineWidth = 6;
      for (let i = 0; i < 3; i++) { const a = t * 2 + (i * Math.PI) / 3; ctx.beginPath(); ctx.moveTo(valve.x - Math.cos(a) * 30, valve.y - Math.sin(a) * 30); ctx.lineTo(valve.x + Math.cos(a) * 30, valve.y + Math.sin(a) * 30); ctx.stroke(); }
      label(ctx, 'HOLD', valve.x, valve.y + valve.r + 18, 12, PALETTE.dim);
      // valve B (space)
      const bx = 470, by = 220;
      roundRect(ctx, bx - 70, by - 40, 140, 80, 12, spaceHeld ? PALETTE.ok : PALETTE.panel2, PALETTE.accent);
      label(ctx, 'SPACE', bx, by, 22, spaceHeld ? PALETTE.bg : PALETTE.text);
      label(ctx, 'HOLD', bx, by + 58, 12, PALETTE.dim);
      progressBar(ctx, 60, 350, 520, 18, progress / need);
    },
    destroy() { p.destroy(); keys.destroy(); destroyCanvas(); },
  };
});
