import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, progressBar, PALETTE } from './common.js';

// Two-visit task: start the upload here, then walk to the download station to finish.
// params.step: 0 = upload, 1 = download.
export default defineMinigame({ id: 'dataUpload', label: 'Data Upload', duration: 'long', visual: false }, (container, { onComplete, params = {} }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 380);
  const p = pointer(canvas, w, h);
  const step = params.step || 0;
  const need = step === 0 ? 6 : 5;
  let started = false, t = 0, done = false;
  const bits = [];
  for (let i = 0; i < 40; i++) bits.push({ x: Math.random(), y: Math.random(), s: Math.random() });
  return {
    update(dt, time) {
      if (done) return;
      if (!started && p.justDown && Math.abs(p.x - 320) < 90 && Math.abs(p.y - 300) < 28) started = true;
      p.consume();
      if (started) t += dt;
      if (t >= need) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, step === 0 ? 'UPLOAD DATA' : 'DOWNLOAD DATA');
      roundRect(ctx, 60, 60, 520, 170, 12, '#0a1018', PALETTE.line);
      const prog = Math.min(1, t / need);
      for (const b of bits) {
        const y = step === 0 ? (b.y - ((time * 0.15 * (0.5 + b.s)) % 1) + 1) % 1 : (b.y + ((time * 0.15 * (0.5 + b.s)) % 1)) % 1;
        const on = started && b.x < prog + 0.05;
        ctx.fillStyle = on ? PALETTE.ok : 'rgba(127,178,255,0.25)';
        ctx.fillRect(70 + b.x * 500, 70 + y * 150, 4 + b.s * 8, 3);
      }
      progressBar(ctx, 60, 245, 520, 16, prog);
      label(ctx, `${Math.round(prog * 100)}%`, 590, 253, 12, PALETTE.dim, 'right');
      roundRect(ctx, 230, 272, 180, 56, 12, started ? PALETTE.panel2 : PALETTE.accent, PALETTE.accent);
      label(ctx, started ? (step === 0 ? 'UPLOADING' : 'DOWNLOADING') : 'START', 320, 300, 16, started ? PALETTE.dim : PALETTE.bg);
      if (step === 0 && !started) label(ctx, 'THEN VISIT DOWNLOAD', 320, 350, 12, PALETTE.dim);
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
