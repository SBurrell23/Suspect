import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, progressBar, PALETTE, clamp, dist } from './common.js';

// Speak into your microphone to fill the voice print: three seconds of clear voice, and the
// meter drains while you are silent. Other players nearby can hear you doing it.
// params.micRms(): current mic level (0..1). params.micEnabled(): bool.
// No mic (denied / not enabled): hold the pad for 10 seconds instead so the game stays playable text-only.
export default defineMinigame({ id: 'voicePrint', label: 'Voice Print', duration: 'medium', visual: false }, (container, { onComplete, params = {}, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 400);
  const p = pointer(canvas, w, h);
  const micOn = () => !!(params.micEnabled && params.micEnabled());
  const rms = () => (params.micRms ? params.micRms() : 0);
  const need = 3 + (difficulty - 1) * 1.5;
  const threshold = 0.035;
  let t = 0, done = false, level = 0, hold = 0;
  const bars = new Array(48).fill(0);
  const pad = { x: 320, y: 300, r: 46 };
  return {
    update(dt, time) {
      if (done) return;
      const mic = micOn();
      const r = rms();
      level += (Math.min(1, r * 6) - level) * Math.min(1, dt * 14);
      bars.shift(); bars.push(level);
      if (mic) {
        if (r > threshold) t += dt; else t = Math.max(0, t - dt * 0.5);
        if (t >= need) { done = true; setTimeout(onComplete, 300); }
      } else {
        const on = p.down && dist(p.x, p.y, pad.x, pad.y) < pad.r;
        hold = on ? hold + dt : 0;
        if (hold >= 10) { done = true; setTimeout(onComplete, 300); }
      }
      panelBg(ctx, w, h, mic ? 'SPEAK INTO YOUR MIC' : 'NO MIC — HOLD THE PAD FOR 10s');
      roundRect(ctx, 60, 60, 520, 150, 12, '#0a1018', PALETTE.line);
      const speaking = mic && r > threshold;
      bars.forEach((b, i) => {
        const x = 70 + i * 10.6, hh = 4 + b * 120;
        ctx.fillStyle = speaking ? PALETTE.ok : PALETTE.accent;
        ctx.fillRect(x, 135 - hh / 2, 6, hh);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(60, 135); ctx.lineTo(580, 135); ctx.stroke();
      if (mic) {
        progressBar(ctx, 60, 235, 520, 18, t / need);
        label(ctx, speaking ? 'RECORDING' : 'SAY SOMETHING', 320, 290, 16, speaking ? PALETTE.ok : PALETTE.dim);
        label(ctx, `${Math.max(0, need - t).toFixed(1)}s`, 580, 290, 14, PALETTE.dim, 'right');
      } else {
        progressBar(ctx, 60, 235, 520, 18, hold / 10);
        const on = p.down && dist(p.x, p.y, pad.x, pad.y) < pad.r;
        ctx.beginPath(); ctx.arc(pad.x, pad.y, pad.r, 0, 7); ctx.fillStyle = on ? PALETTE.accent : PALETTE.panel2; ctx.fill(); ctx.strokeStyle = PALETTE.accent; ctx.lineWidth = 4; ctx.stroke();
        label(ctx, 'HOLD', pad.x, pad.y, 16, on ? PALETTE.bg : PALETTE.text);
        label(ctx, 'Enable your microphone in the lobby to do this the fast way.', 320, 370, 12, PALETTE.dim);
      }
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
