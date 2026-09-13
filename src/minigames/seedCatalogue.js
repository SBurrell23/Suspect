import { defineMinigame, setupCanvas, pointer, panelBg, roundRect, shuffle, rng, PALETTE } from './common.js';

// Memory-match 6 pairs of procedurally generated plant glyphs.
function drawGlyph(ctx, g, x, y, s) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = g.color; ctx.fillStyle = g.color; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, s * 0.45); ctx.quadraticCurveTo(g.bend * s, 0, 0, -s * 0.4); ctx.stroke();
  for (let i = 0; i < g.leaves; i++) {
    const t = (i + 1) / (g.leaves + 1);
    const ly = s * 0.45 - t * s * 0.85, side = i % 2 ? 1 : -1;
    ctx.beginPath(); ctx.ellipse(side * s * 0.22, ly, s * g.leafW, s * 0.09, side * g.tilt, 0, 7); ctx.fill();
  }
  if (g.flower) { ctx.fillStyle = g.flowerColor; for (let i = 0; i < g.petals; i++) { const a = (i / g.petals) * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.12, -s * 0.4 + Math.sin(a) * s * 0.12, s * 0.07, 0, 7); ctx.fill(); } }
  ctx.restore();
}

export default defineMinigame({ id: 'seedCatalogue', label: 'Seed Catalogue', duration: 'long', visual: false }, (container, { onComplete }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 440);
  const p = pointer(canvas, w, h);
  const rand = rng();
  const greens = ['#5fe38a', '#3fa76a', '#9cff7a', '#7fd36a', '#2e9e4a', '#b9f28a'];
  const glyphs = [];
  for (let i = 0; i < 6; i++) glyphs.push({ color: greens[i], bend: (rand() - 0.5) * 0.6, leaves: 2 + Math.floor(rand() * 4), leafW: 0.16 + rand() * 0.12, tilt: (rand() - 0.5) * 0.8, flower: rand() < 0.6, petals: 4 + Math.floor(rand() * 3), flowerColor: ['#ee6fc1', '#ffcc4d', '#7fb2ff', '#ff5f5f'][Math.floor(rand() * 4)] });
  const cards = shuffle([...glyphs, ...glyphs].map((g, i) => ({ g, open: false, matched: false, i })), rand);
  cards.forEach((c, i) => { c.x = 70 + (i % 6) * 100; c.y = 90 + Math.floor(i / 6) * 150; });
  let first = null, second = null, hideT = 0, done = false;
  return {
    update(dt) {
      if (done) return;
      if (hideT > 0) { hideT -= dt; if (hideT <= 0) { first.open = false; second.open = false; first = second = null; } }
      else if (p.justDown) {
        const c = cards.find((k) => !k.matched && !k.open && Math.abs(p.x - k.x) < 42 && Math.abs(p.y - k.y) < 62);
        if (c) {
          c.open = true;
          if (!first) first = c;
          else { second = c; if (first.g === second.g) { first.matched = second.matched = true; first = second = null; } else hideT = 0.8; }
        }
      }
      p.consume();
      if (cards.every((c) => c.matched)) { done = true; setTimeout(onComplete, 300); }
      panelBg(ctx, w, h, 'MATCH THE SPECIMENS');
      for (const c of cards) {
        const show = c.open || c.matched;
        roundRect(ctx, c.x - 42, c.y - 62, 84, 124, 10, show ? (c.matched ? '#1d3a2a' : PALETTE.panel2) : '#2a3a4c', show ? PALETTE.ok : PALETTE.line);
        if (show) drawGlyph(ctx, c.g, c.x, c.y, 80);
        else { ctx.strokeStyle = PALETTE.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, 16, 0, 7); ctx.stroke(); }
      }
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
