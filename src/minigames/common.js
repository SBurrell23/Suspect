// Shared helpers for the 2D canvas minigames. All graphics are procedural; no text beyond numerals and short labels.
export const PALETTE = {
  bg: '#0f1620', panel: '#1b2632', panel2: '#233142', line: '#3a4a5c', accent: '#7fb2ff',
  ok: '#5fe38a', bad: '#ff5f5f', warn: '#ffcc4d', text: '#e6eef7', dim: '#8a9bb0',
  wires: ['#ff5f5f', '#5fe38a', '#7fb2ff', '#ffcc4d', '#ee6fc1', '#3fd3e0'],
};

export function setupCanvas(container, w = 640, h = 420) {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = '100%';
  canvas.style.maxWidth = w + 'px';
  canvas.style.aspectRatio = `${w} / ${h}`;
  canvas.style.display = 'block';
  canvas.style.borderRadius = '14px';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'crosshair';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { canvas, ctx, w, h, destroy() { canvas.remove(); } };
}

export class Loop {
  constructor(fn) { this.fn = fn; this.raf = 0; this.last = 0; this.running = false; }
  start() { this.running = true; this.last = performance.now(); const step = (t) => { if (!this.running) return; const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t; this.fn(dt, t / 1000); this.raf = requestAnimationFrame(step); }; this.raf = requestAnimationFrame(step); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
}

export function pointer(canvas, w, h) {
  const p = { x: -1, y: -1, down: false, justDown: false, justUp: false, inside: false };
  const map = (e) => {
    const r = canvas.getBoundingClientRect();
    p.x = ((e.clientX - r.left) / r.width) * w;
    p.y = ((e.clientY - r.top) / r.height) * h;
    p.inside = p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;
  };
  const onMove = (e) => map(e);
  const onDown = (e) => { map(e); p.down = true; p.justDown = true; e.preventDefault(); };
  const onUp = (e) => { map(e); p.down = false; p.justUp = true; };
  const onLeave = () => { p.inside = false; };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  p.consume = () => { p.justDown = false; p.justUp = false; };
  p.destroy = () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointerleave', onLeave);
  };
  return p;
}

export function keyState() {
  const keys = new Set();
  const down = (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); };
  const up = (e) => keys.delete(e.code);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return { has: (c) => keys.has(c), destroy() { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); } };
}

export function rng(seed = Date.now()) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

export function label(ctx, text, x, y, size = 16, color = PALETTE.text, align = 'center') {
  ctx.font = `bold ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function panelBg(ctx, w, h, title) {
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, w, h);
  roundRect(ctx, 8, 8, w - 16, h - 16, 14, PALETTE.panel, PALETTE.line);
  if (title) label(ctx, title, w / 2, 28, 15, PALETTE.dim);
}

export function progressBar(ctx, x, y, w, h, t, color = PALETTE.ok) {
  roundRect(ctx, x, y, w, h, h / 2, PALETTE.bg, PALETTE.line);
  if (t > 0) roundRect(ctx, x + 2, y + 2, Math.max(h - 4, (w - 4) * clamp(t, 0, 1)), h - 4, (h - 4) / 2, color);
}

// Build a minigame module from a factory that returns { update(dt,t), destroy() }
export function defineMinigame(meta, factory) {
  let inst = null;
  return {
    ...meta,
    mount(container, api) {
      this.unmount();
      inst = factory(container, api);
      inst.loop = new Loop((dt, t) => inst.update(dt, t));
      inst.loop.start();
    },
    unmount() {
      if (!inst) return;
      inst.loop?.stop();
      try { inst.destroy(); } catch (e) { /* ignore */ }
      inst = null;
    },
  };
}
