import { defineMinigame, setupCanvas, pointer, panelBg, label, shuffle, dist, PALETTE, roundRect } from './common.js';

// Six wires, each split in the middle. Drag every left end to the matching right terminal
// before the panel's power flickers out (a timer): one wrong plug shorts a random correct one.
export default defineMinigame({ id: 'wireSplice', label: 'Splice Wires', duration: 'short', visual: false }, (container, { onComplete, onFail, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 440);
  const p = pointer(canvas, w, h);
  const n = 6;
  const colors = shuffle(PALETTE.wires.slice()).slice(0, n);
  const ys = (i) => 70 + i * (300 / (n - 1));
  const left = colors.map((c, i) => ({ c, y: ys(i), x: 110, done: false }));
  const right = shuffle(colors.slice()).map((c, i) => ({ c, y: ys(i), x: 530 }));
  let drag = null, done = false, shorts = 0, timeLeft = 22 / difficulty;
  return {
    update(dt) {
      if (done) return;
      timeLeft -= dt;
      if (timeLeft <= 0) { done = true; onFail && onFail(); return; }
      if (p.justDown) for (const l of left) if (!l.done && dist(p.x, p.y, l.x, l.y) < 26) drag = l;
      if (p.justUp && drag) {
        const target = right.find((r) => dist(p.x, p.y, r.x, r.y) < 30);
        if (target && target.c === drag.c) drag.done = true;
        else if (target) {
          // wrong terminal: short circuit undoes one finished wire
          shorts++;
          const finished = left.filter((l) => l.done);
          if (finished.length) finished[Math.floor(Math.random() * finished.length)].done = false;
        }
        drag = null;
      }
      p.consume();
      if (left.every((l) => l.done)) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, 'CONNECT ALL SIX WIRES');
      roundRect(ctx, 40, 40, 90, 360, 10, PALETTE.panel2, PALETTE.line);
      roundRect(ctx, 510, 40, 90, 360, 10, PALETTE.panel2, PALETTE.line);
      ctx.lineCap = 'round';
      for (const l of left) {
        const r = right.find((x) => x.c === l.c);
        ctx.strokeStyle = l.c; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(60, l.y); ctx.lineTo(l.x, l.y);
        if (l.done) ctx.lineTo(r.x, r.y); else if (drag === l) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(l.x, l.y, 13, 0, 7); ctx.fillStyle = l.c; ctx.fill();
      }
      for (const r of right) {
        ctx.strokeStyle = r.c; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(580, r.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(r.x, r.y, 13, 0, 7); ctx.fillStyle = left.find((l) => l.c === r.c && l.done) ? r.c : PALETTE.bg; ctx.fill(); ctx.strokeStyle = r.c; ctx.lineWidth = 4; ctx.stroke();
      }
      // timer bar
      const tf = Math.max(0, timeLeft / (22 / difficulty));
      roundRect(ctx, 150, 412, 340, 10, 5, PALETTE.bg, PALETTE.line);
      roundRect(ctx, 152, 414, Math.max(4, 336 * tf), 6, 3, tf < 0.3 ? PALETTE.bad : PALETTE.warn);
      label(ctx, Math.ceil(timeLeft).toString(), 590, 417, 13, tf < 0.3 ? PALETTE.bad : PALETTE.dim, 'right');
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
