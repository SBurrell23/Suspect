import { defineMinigame, setupCanvas, pointer, panelBg, label, PALETTE, dist } from './common.js';

// Aim and click to destroy 12 incoming asteroid shapes before any reaches the hull (center).
export default defineMinigame({ id: 'debrisClear', label: 'Clear Debris', duration: 'medium', visual: false }, (container, { onComplete, onFail, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 420);
  const p = pointer(canvas, w, h);
  const cx = 320, cy = 220;
  const rocks = [];
  let spawnT = 0.3, destroyed = 0, done = false, flash = 0;
  const need = 12;
  const mkRock = () => {
    const a = Math.random() * Math.PI * 2;
    const R = 330;
    const pts = [];
    const n = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) pts.push(0.7 + Math.random() * 0.5);
    return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, r: 16 + Math.random() * 12, pts, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 2, speed: (40 + Math.random() * 30) * difficulty };
  };
  return {
    update(dt, t) {
      if (done) return;
      spawnT -= dt;
      if (spawnT <= 0 && destroyed + rocks.length < need) { spawnT = 0.9 / difficulty; rocks.push(mkRock()); }
      if (p.justDown) {
        for (const r of rocks) if (dist(p.x, p.y, r.x, r.y) < r.r + 10) { rocks.splice(rocks.indexOf(r), 1); destroyed++; flash = 0.15; break; }
      }
      p.consume();
      for (const r of rocks) {
        const dx = cx - r.x, dy = cy - r.y, d = Math.hypot(dx, dy);
        r.x += (dx / d) * r.speed * dt; r.y += (dy / d) * r.speed * dt; r.rot += r.spin * dt;
        if (d < 40) { done = true; onFail && onFail(); return; }
      }
      if (destroyed >= need) { done = true; setTimeout(onComplete, 300); }
      flash = Math.max(0, flash - dt);
      panelBg(ctx, w, h, 'CLICK THE DEBRIS');
      // hull
      ctx.beginPath(); ctx.arc(cx, cy, 34, 0, 7); ctx.fillStyle = PALETTE.panel2; ctx.fill(); ctx.strokeStyle = PALETTE.accent; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(127,178,255,0.15)'; ctx.lineWidth = 1;
      for (const R of [100, 180, 260]) { ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke(); }
      for (const r of rocks) {
        ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
        ctx.beginPath();
        r.pts.forEach((k, i) => { const a = (i / r.pts.length) * Math.PI * 2; const x = Math.cos(a) * r.r * k, y = Math.sin(a) * r.r * k; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.closePath(); ctx.fillStyle = '#6f6a62'; ctx.fill(); ctx.strokeStyle = '#3d3a35'; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      }
      // crosshair
      ctx.strokeStyle = flash > 0 ? PALETTE.ok : PALETTE.warn; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x - 22, p.y); ctx.lineTo(p.x - 8, p.y); ctx.moveTo(p.x + 8, p.y); ctx.lineTo(p.x + 22, p.y); ctx.moveTo(p.x, p.y - 22); ctx.lineTo(p.x, p.y - 8); ctx.moveTo(p.x, p.y + 8); ctx.lineTo(p.x, p.y + 22); ctx.stroke();
      label(ctx, `${destroyed} / ${need}`, 590, 52, 14, PALETTE.dim, 'right');
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});
