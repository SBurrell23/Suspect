import { defineMinigame, setupCanvas, pointer, panelBg, label, PALETTE, dist } from './common.js';

// Aim and click to destroy 16 incoming asteroids before any reaches the hull. They come fast,
// some weave, and big ones split in two.
export default defineMinigame({ id: 'debrisClear', label: 'Clear Debris', duration: 'medium', visual: false }, (container, { onComplete, onFail, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 420);
  const p = pointer(canvas, w, h);
  const cx = 320, cy = 220;
  const rocks = [];
  let spawnT = 0.3, destroyed = 0, spawned = 0, done = false, flash = 0;
  const need = 16;
  const mkRock = (x, y, r, speed) => {
    const pts = [];
    const n = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) pts.push(0.7 + Math.random() * 0.5);
    return { x, y, r, pts, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 3, speed, weave: Math.random() < 0.4 ? 1.5 + Math.random() * 2 : 0, ph: Math.random() * 6, big: r > 22 };
  };
  const spawn = () => {
    const a = Math.random() * Math.PI * 2, R = 330;
    const big = Math.random() < 0.3;
    rocks.push(mkRock(cx + Math.cos(a) * R, cy + Math.sin(a) * R, big ? 26 : 12 + Math.random() * 8, (70 + Math.random() * 50) * difficulty));
    spawned++;
  };
  return {
    update(dt, t) {
      if (done) return;
      spawnT -= dt;
      if (spawnT <= 0 && spawned < need) { spawnT = 0.6 / difficulty; spawn(); }
      if (p.justDown) {
        for (const r of rocks) if (dist(p.x, p.y, r.x, r.y) < r.r + 8) {
          rocks.splice(rocks.indexOf(r), 1); destroyed++; flash = 0.15;
          if (r.big) { for (let k = 0; k < 2; k++) rocks.push(mkRock(r.x + (k ? 14 : -14), r.y, 11, r.speed * 1.3)); }
          break;
        }
      }
      p.consume();
      for (const r of rocks) {
        const dx = cx - r.x, dy = cy - r.y, d = Math.hypot(dx, dy);
        const nx = dx / d, ny = dy / d;
        const wob = r.weave ? Math.sin(t * r.weave + r.ph) * 60 : 0;
        r.x += (nx * r.speed - ny * wob) * dt; r.y += (ny * r.speed + nx * wob) * dt; r.rot += r.spin * dt;
        if (d < 38) { done = true; onFail && onFail(); return; }
      }
      if (destroyed >= need && rocks.length === 0) { done = true; setTimeout(onComplete, 300); }
      flash = Math.max(0, flash - dt);
      panelBg(ctx, w, h, 'CLICK THE DEBRIS — BIG ONES SPLIT');
      ctx.beginPath(); ctx.arc(cx, cy, 34, 0, 7); ctx.fillStyle = PALETTE.panel2; ctx.fill(); ctx.strokeStyle = PALETTE.accent; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(127,178,255,0.15)'; ctx.lineWidth = 1;
      for (const R of [100, 180, 260]) { ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke(); }
      for (const r of rocks) {
        ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
        ctx.beginPath();
        r.pts.forEach((k, i) => { const a = (i / r.pts.length) * Math.PI * 2; const x = Math.cos(a) * r.r * k, y = Math.sin(a) * r.r * k; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.closePath(); ctx.fillStyle = r.big ? '#8a6a52' : '#6f6a62'; ctx.fill(); ctx.strokeStyle = '#3d3a35'; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = flash > 0 ? PALETTE.ok : PALETTE.warn; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x - 22, p.y); ctx.lineTo(p.x - 8, p.y); ctx.moveTo(p.x + 8, p.y); ctx.lineTo(p.x + 22, p.y); ctx.moveTo(p.x, p.y - 22); ctx.lineTo(p.x, p.y - 8); ctx.moveTo(p.x, p.y + 8); ctx.lineTo(p.x, p.y + 22); ctx.stroke();
      label(ctx, `${Math.min(destroyed, need)} / ${need}`, 590, 52, 14, PALETTE.dim, 'right');
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
