import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, progressBar, PALETTE, dist, clamp } from './common.js';

// Sabotage fix panels. Same contract as task minigames.

// Lights: flip all switches up.
export const lightsFix = defineMinigame({ id: 'lightsFix', label: 'Reset Breakers', duration: 'short', visual: false }, (container, { onComplete }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 360);
  const p = pointer(canvas, w, h);
  const sw = [0, 1, 2, 3, 4].map((i) => ({ x: 120 + i * 100, y: 180, on: Math.random() < 0.5 }));
  if (sw.every((s) => s.on)) sw[2].on = false;
  let done = false;
  return {
    update() {
      if (done) return;
      if (p.justDown) for (const s of sw) if (Math.abs(p.x - s.x) < 30 && Math.abs(p.y - s.y) < 60) s.on = !s.on;
      p.consume();
      if (sw.every((s) => s.on)) { done = true; setTimeout(onComplete, 250); }
      panelBg(ctx, w, h, 'FLIP ALL BREAKERS UP');
      for (const s of sw) {
        roundRect(ctx, s.x - 26, s.y - 60, 52, 120, 8, '#0a1018', PALETTE.line);
        roundRect(ctx, s.x - 18, s.y + (s.on ? -52 : 4), 36, 48, 6, s.on ? PALETTE.ok : PALETTE.bad);
      }
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});

// Comms: drag the tuner until all signal bars are full.
export const commsFix = defineMinigame({ id: 'commsFix', label: 'Retune Comms', duration: 'short', visual: false }, (container, { onComplete }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 360);
  const p = pointer(canvas, w, h);
  const target = 0.15 + Math.random() * 0.7;
  let v = Math.random(), okT = 0, done = false, drag = false;
  return {
    update(dt, t) {
      if (done) return;
      if (p.justDown && Math.abs(p.y - 200) < 30) drag = true;
      if (p.justUp) drag = false;
      if (drag && p.down) v = clamp((p.x - 80) / 480, 0, 1);
      p.consume();
      const err = Math.abs(v - target);
      const strength = clamp(1 - err * 6, 0, 1);
      if (strength > 0.9) okT += dt; else okT = 0;
      if (okT > 1) { done = true; setTimeout(onComplete, 250); }
      panelBg(ctx, w, h, 'TUNE THE SIGNAL');
      for (let i = 0; i < 6; i++) { ctx.fillStyle = strength * 6 > i ? PALETTE.ok : PALETTE.line; ctx.fillRect(220 + i * 36, 130 - i * 10, 24, 20 + i * 10); }
      // static
      ctx.strokeStyle = 'rgba(127,178,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 480; i += 4) { const y = 290 + (Math.random() - 0.5) * (1 - strength) * 40 + Math.sin(i * 0.05 + t * 6) * strength * 10; if (i === 0) ctx.moveTo(80 + i, y); else ctx.lineTo(80 + i, y); }
      ctx.stroke();
      roundRect(ctx, 80, 195, 480, 10, 5, PALETTE.bg, PALETTE.line);
      ctx.beginPath(); ctx.arc(80 + v * 480, 200, 16, 0, 7); ctx.fillStyle = drag ? PALETTE.accent : PALETTE.panel2; ctx.fill(); ctx.strokeStyle = PALETTE.accent; ctx.lineWidth = 3; ctx.stroke();
    },
    destroy() { p.destroy(); destroyCanvas(); },
  };
});

// Reactor: hold your palm. Reports hold state via params.onHold(bool); the host ends the sabotage.
export const reactorHold = defineMinigame({ id: 'reactorHold', label: 'Hold Reactor', duration: 'medium', visual: false }, (container, { params = {} }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 360);
  const p = pointer(canvas, w, h);
  let holding = false;
  const pad = { x: 320, y: 190, r: 80 };
  return {
    update(dt, t) {
      const on = p.down && dist(p.x, p.y, pad.x, pad.y) < pad.r;
      if (on !== holding) { holding = on; params.onHold && params.onHold(on); }
      const other = params.otherHeld ? params.otherHeld() : false;
      panelBg(ctx, w, h, 'HOLD — A SECOND PLAYER MUST HOLD THE OTHER PANEL');
      ctx.beginPath(); ctx.arc(pad.x, pad.y, pad.r, 0, 7); ctx.fillStyle = on ? `rgba(255,95,95,${0.4 + 0.2 * Math.sin(t * 8)})` : 'rgba(255,95,95,0.1)'; ctx.fill(); ctx.strokeStyle = PALETTE.bad; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = on ? PALETTE.text : PALETTE.dim; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(pad.x, pad.y + 22, 30, 36, 0, 0, 7); ctx.stroke();
      for (let i = 0; i < 5; i++) { const a = -Math.PI * 0.85 + i * 0.35; ctx.beginPath(); ctx.ellipse(pad.x + Math.cos(a) * 42, pad.y + 4 + Math.sin(a) * 42, 8, 24, a + Math.PI / 2, 0, 7); ctx.stroke(); }
      label(ctx, on ? 'HOLDING' : 'HOLD', pad.x, pad.y + pad.r + 26, 14, on ? PALETTE.ok : PALETTE.dim);
      roundRect(ctx, 60, 310, 250, 26, 8, on ? PALETTE.ok : PALETTE.panel2, PALETTE.line);
      roundRect(ctx, 330, 310, 250, 26, 8, other ? PALETTE.ok : PALETTE.panel2, PALETTE.line);
      label(ctx, 'YOU', 185, 323, 12, on ? PALETTE.bg : PALETTE.dim);
      label(ctx, 'OTHER PANEL', 455, 323, 12, other ? PALETTE.bg : PALETTE.dim);
    },
    destroy() { if (holding && params.onHold) params.onHold(false); p.destroy(); destroyCanvas(); },
  };
});

// O2: keypad — type the 5-digit code shown on your HUD. onComplete(code).
export const o2Code = defineMinigame({ id: 'o2Code', label: 'O2 Filter Code', duration: 'short', visual: false }, (container, { onComplete, params = {} }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 480, 440);
  const p = pointer(canvas, w, h);
  let entry = '', flash = 0;
  const keys = [];
  const layout = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'];
  layout.forEach((k, i) => keys.push({ k, x: 120 + (i % 3) * 120, y: 150 + Math.floor(i / 3) * 70 }));
  const onKey = (e) => { if (/^[0-9]$/.test(e.key) && entry.length < 5) entry += e.key; else if (e.key === 'Backspace') entry = entry.slice(0, -1); else if (e.key === 'Enter') submit(); };
  const submit = () => { if (entry.length === 5) { const code = entry; entry = ''; flash = 0.4; onComplete(code); } };
  window.addEventListener('keydown', onKey);
  return {
    update(dt) {
      flash = Math.max(0, flash - dt);
      if (p.justDown) for (const b of keys) if (Math.abs(p.x - b.x) < 50 && Math.abs(p.y - b.y) < 28) {
        if (b.k === 'C') entry = ''; else if (b.k === 'OK') submit(); else if (entry.length < 5) entry += b.k;
      }
      p.consume();
      panelBg(ctx, w, h, 'ENTER THE CODE FROM YOUR HUD');
      roundRect(ctx, 60, 60, 360, 56, 8, '#0a1018', flash > 0 ? PALETTE.ok : PALETTE.line);
      label(ctx, entry.padEnd(5, '_').split('').join(' '), 240, 88, 28, PALETTE.ok);
      for (const b of keys) { roundRect(ctx, b.x - 50, b.y - 28, 100, 56, 8, b.k === 'OK' ? PALETTE.accent : PALETTE.panel2, PALETTE.line); label(ctx, b.k, b.x, b.y, 20, b.k === 'OK' ? PALETTE.bg : PALETTE.text); }
      if (params.hint) label(ctx, params.hint, 240, 420, 12, PALETTE.dim);
    },
    destroy() { window.removeEventListener('keydown', onKey); p.destroy(); destroyCanvas(); },
  };
});
