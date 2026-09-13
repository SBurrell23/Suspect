import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, PALETTE, dist } from './common.js';

// Drag falling crates into the bin with the matching symbol before they hit the floor.
const SYMBOLS = ['circle', 'triangle', 'square'];
function drawSymbol(ctx, s, x, y, r, color) {
  ctx.fillStyle = color; ctx.beginPath();
  if (s === 'circle') ctx.arc(x, y, r, 0, 7);
  else if (s === 'triangle') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); }
  else ctx.rect(x - r, y - r, r * 2, r * 2);
  ctx.fill();
}

export default defineMinigame({ id: 'cargoSort', label: 'Sort Cargo', duration: 'medium', visual: false }, (container, { onComplete, onFail, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 420);
  const p = pointer(canvas, w, h);
  const bins = SYMBOLS.map((s, i) => ({ s, x: 120 + i * 200, y: 360, w: 150, h: 50 }));
  const crates = [];
  let spawnT = 0.5, sorted = 0, missed = 0, drag = null, done = false;
  const need = 6, maxMiss = 3;
  const speed = 55 * difficulty;
  return {
    update(dt) {
      if (done) return;
      spawnT -= dt;
      if (spawnT <= 0 && crates.length < 3 && sorted + crates.length < need + missed) {
        spawnT = 1.6 / difficulty;
        crates.push({ s: SYMBOLS[Math.floor(Math.random() * 3)], x: 100 + Math.random() * 440, y: -20, vy: speed * (0.8 + Math.random() * 0.4) });
      }
      if (p.justDown) for (const c of crates) if (dist(p.x, p.y, c.x, c.y) < 34) drag = c;
      if (drag) { drag.x = p.x; drag.y = p.y; }
      if (p.justUp && drag) {
        const bin = bins.find((b) => Math.abs(p.x - b.x) < b.w / 2 && p.y > b.y - 40);
        if (bin && bin.s === drag.s) { crates.splice(crates.indexOf(drag), 1); sorted++; }
        else if (bin) { crates.splice(crates.indexOf(drag), 1); missed++; }
        drag = null;
      }
      p.consume();
      for (const c of crates.slice()) {
        if (c !== drag) c.y += c.vy * dt;
        if (c.y > 330 && c !== drag) { crates.splice(crates.indexOf(c), 1); missed++; }
      }
      if (sorted >= need) { done = true; setTimeout(onComplete, 300); }
      if (missed >= maxMiss) { done = true; onFail && onFail(); }
      panelBg(ctx, w, h, 'SORT THE CARGO');
      for (const b of bins) { roundRect(ctx, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 8, PALETTE.panel2, PALETTE.line); drawSymbol(ctx, b.s, b.x, b.y, 14, PALETTE.accent); }
      for (const c of crates) { roundRect(ctx, c.x - 26, c.y - 26, 52, 52, 6, '#8a7a55', '#5a4d33'); drawSymbol(ctx, c.s, c.x, c.y, 12, PALETTE.text); }
      for (let i = 0; i < need; i++) { ctx.fillStyle = i < sorted ? PALETTE.ok : PALETTE.line; ctx.fillRect(40 + i * 22, 48, 16, 8); }
      for (let i = 0; i < maxMiss; i++) { ctx.fillStyle = i < missed ? PALETTE.bad : PALETTE.line; ctx.beginPath(); ctx.arc(590 - i * 22, 52, 6, 0, 7); ctx.fill(); }
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
