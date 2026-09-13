import { defineMinigame, setupCanvas, pointer, panelBg, shuffle, dist, PALETTE, roundRect } from './common.js';

// Drag colored wire ends from the left terminal to the matching right terminal.
export default defineMinigame({ id: 'wireSplice', label: 'Splice Wires', duration: 'short', visual: false }, (container, { onComplete, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 400);
  const p = pointer(canvas, w, h);
  const n = difficulty > 1.4 ? 5 : 4;
  const colors = shuffle(PALETTE.wires.slice()).slice(0, n);
  const left = colors.map((c, i) => ({ c, y: 80 + i * (240 / (n - 1)), x: 110, done: false }));
  const right = shuffle(colors.slice()).map((c, i) => ({ c, y: 80 + i * (240 / (n - 1)), x: 530 }));
  let drag = null, done = false;
  return {
    update() {
      if (done) return;
      if (p.justDown) {
        for (const l of left) if (!l.done && dist(p.x, p.y, l.x, l.y) < 26) drag = l;
      }
      if (p.justUp && drag) {
        for (const r of right) if (r.c === drag.c && dist(p.x, p.y, r.x, r.y) < 30) drag.done = true;
        drag = null;
      }
      p.consume();
      if (left.every((l) => l.done)) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, 'CONNECT THE WIRES');
      roundRect(ctx, 40, 50, 90, 300, 10, PALETTE.panel2, PALETTE.line);
      roundRect(ctx, 510, 50, 90, 300, 10, PALETTE.panel2, PALETTE.line);
      ctx.lineCap = 'round';
      for (const l of left) {
        const r = right.find((x) => x.c === l.c);
        ctx.strokeStyle = l.c; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(60, l.y); ctx.lineTo(l.x, l.y);
        if (l.done) ctx.lineTo(r.x, r.y); else if (drag === l) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(l.x, l.y, 14, 0, 7); ctx.fillStyle = l.c; ctx.fill();
      }
      for (const r of right) {
        ctx.strokeStyle = r.c; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(580, r.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(r.x, r.y, 14, 0, 7); ctx.fillStyle = left.find((l) => l.c === r.c && l.done) ? r.c : PALETTE.bg; ctx.fill(); ctx.strokeStyle = r.c; ctx.lineWidth = 4; ctx.stroke();
      }
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
