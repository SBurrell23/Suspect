import * as THREE from 'three';

// Every texture in the game is drawn to a canvas at runtime. Nothing is loaded.
const cache = new Map();

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

function hex(h) { return '#' + h.toString(16).padStart(6, '0'); }
function rgba(h, a) { return `rgba(${(h >> 16) & 255},${(h >> 8) & 255},${h & 255},${a})`; }
function shade(h, f) {
  const r = Math.min(255, Math.max(0, Math.round(((h >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((h >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((h & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

// deterministic pseudo random per texture
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function noiseOverlay(ctx, size, amount, rand) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount * 255;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function finish(c, { repeat = 1, srgb = true, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const GENERATORS = {
  metal(color, rand, size, ctx) {
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, size, size);
    // brushed streaks
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = rgba(rand() < 0.5 ? 0xffffff : 0x000000, 0.05);
      ctx.fillRect(rand() * size, rand() * size, rand() * 60 + 10, 1);
    }
    // panel seams
    ctx.strokeStyle = rgba(0x000000, 0.45);
    ctx.lineWidth = 3;
    const n = 2;
    for (let i = 0; i <= n; i++) {
      const p = (i / n) * size;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }
    ctx.strokeStyle = rgba(0xffffff, 0.12);
    ctx.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      const p = (i / n) * size + 3;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }
    // rivets
    ctx.fillStyle = rgba(0x000000, 0.5);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = (i / n) * size + 12, y = (j / n) * size + 12;
      const s = size / n - 24;
      for (const [px, py] of [[x, y], [x + s, y], [x, y + s], [x + s, y + s]]) {
        ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
      }
    }
    noiseOverlay(ctx, size, 0.12, rand);
  },

  wall(color, rand, size, ctx) {
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, size, size);
    // horizontal bands
    ctx.fillStyle = rgba(shade(color, 0.75), 1);
    ctx.fillRect(0, 0, size, size * 0.08);
    ctx.fillRect(0, size * 0.92, size, size * 0.08);
    ctx.fillStyle = rgba(0x000000, 0.25);
    ctx.fillRect(0, size * 0.08, size, 3);
    ctx.fillRect(0, size * 0.92 - 3, size, 3);
    ctx.strokeStyle = rgba(0x000000, 0.35);
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((i / 4) * size, size * 0.08); ctx.lineTo((i / 4) * size, size * 0.92); ctx.stroke();
    }
    // painted gradient (baked lighting)
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, rgba(0x000000, 0.25));
    g.addColorStop(0.5, rgba(0x000000, 0));
    g.addColorStop(1, rgba(0x000000, 0.35));
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    noiseOverlay(ctx, size, 0.1, rand);
  },

  grating(color, rand, size, ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = hex(color);
    const bars = 8, w = size / bars, t = w * 0.28;
    for (let i = 0; i < bars; i++) {
      ctx.fillRect(i * w, 0, t, size);
      ctx.fillRect(0, i * w, size, t);
    }
    ctx.fillStyle = rgba(0xffffff, 0.18);
    for (let i = 0; i < bars; i++) ctx.fillRect(i * w, 0, 2, size);
  },

  tiles(color, rand, size, ctx) {
    ctx.fillStyle = hex(shade(color, 0.6));
    ctx.fillRect(0, 0, size, size);
    const n = 4, w = size / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = hex(shade(color, 0.9 + rand() * 0.2));
      ctx.fillRect(i * w + 2, j * w + 2, w - 4, w - 4);
      ctx.fillStyle = rgba(0xffffff, 0.08);
      ctx.fillRect(i * w + 2, j * w + 2, w - 4, 3);
    }
    noiseOverlay(ctx, size, 0.08, rand);
  },

  soil(color, rand, size, ctx) {
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rgba(rand() < 0.5 ? shade(color, 0.6) : shade(color, 1.35), 0.5);
      const r = rand() * 5 + 1;
      ctx.beginPath(); ctx.arc(rand() * size, rand() * size, r, 0, 7); ctx.fill();
    }
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = rgba(0x3f7f2a, 0.45);
      ctx.fillRect(rand() * size, rand() * size, 2, rand() * 8 + 3);
    }
    noiseOverlay(ctx, size, 0.15, rand);
  },

  hedge(color, rand, size, ctx) {
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 700; i++) {
      const x = rand() * size, y = rand() * size, r = rand() * 9 + 4;
      const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
      if (d > 1.0 + (rand() - 0.5) * 0.25) continue;
      ctx.fillStyle = hex(shade(color, 0.55 + rand() * 0.8));
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, rand() * 3.14, 0, 7);
      ctx.fill();
    }
  },

  leaf(color, rand, size, ctx) {
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 26; i++) {
      const x = size * 0.5 + (rand() - 0.5) * size * 0.8;
      const y = size * 0.5 + (rand() - 0.5) * size * 0.8;
      const r = size * (0.08 + rand() * 0.12);
      ctx.fillStyle = hex(shade(color, 0.6 + rand() * 0.8));
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.45, rand() * 6.28, 0, 7);
      ctx.fill();
    }
  },

  glass(color, rand, size, ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = rgba(color, 0.18);
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = rgba(0xffffff, 0.35);
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, size - 4, size - 4);
    ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke();
    ctx.fillStyle = rgba(0xffffff, 0.12);
    ctx.beginPath(); ctx.moveTo(0, size); ctx.lineTo(size * 0.4, 0); ctx.lineTo(size * 0.55, 0); ctx.lineTo(size * 0.15, size); ctx.fill();
  },

  concrete(color, rand, size, ctx) {
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = rgba(0x000000, rand() * 0.2);
      ctx.fillRect(rand() * size, rand() * size, rand() * 3 + 1, rand() * 3 + 1);
    }
    ctx.strokeStyle = rgba(0x000000, 0.3);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke();
    noiseOverlay(ctx, size, 0.14, rand);
  },

  lava(color, rand, size, ctx) {
    ctx.fillStyle = '#1a0500';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) {
      const g = ctx.createRadialGradient(rand() * size, rand() * size, 0, rand() * size, rand() * size, rand() * 90 + 30);
      g.addColorStop(0, rgba(0xffe28a, 0.9));
      g.addColorStop(0.4, rgba(color, 0.8));
      g.addColorStop(1, rgba(0x2a0800, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    }
    ctx.strokeStyle = rgba(0x000000, 0.7); ctx.lineWidth = 3;
    for (let i = 0; i < 25; i++) {
      ctx.beginPath(); ctx.moveTo(rand() * size, rand() * size);
      for (let k = 0; k < 5; k++) ctx.lineTo(rand() * size, rand() * size);
      ctx.stroke();
    }
  },

  circuit(color, rand, size, ctx) {
    ctx.fillStyle = hex(shade(color, 0.35));
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = hex(color); ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      let x = Math.floor(rand() * 16) * 16, y = Math.floor(rand() * 16) * 16;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        if (rand() < 0.5) x = Math.floor(rand() * 16) * 16; else y = Math.floor(rand() * 16) * 16;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = hex(shade(color, 1.5));
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
  },

  vent(color, rand, size, ctx) {
    ctx.fillStyle = hex(shade(color, 0.5));
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#050505';
    ctx.fillRect(size * 0.1, size * 0.1, size * 0.8, size * 0.8);
    ctx.fillStyle = hex(color);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const y = size * 0.12 + (i / n) * size * 0.78;
      ctx.fillRect(size * 0.12, y, size * 0.76, size * 0.05);
    }
    ctx.fillStyle = rgba(0x000000, 0.6);
    for (const [x, y] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]) {
      ctx.beginPath(); ctx.arc(x * size, y * size, 6, 0, 7); ctx.fill();
    }
  },

  door(color, rand, size, ctx) {
    GENERATORS.metal(color, rand, size, ctx);
    ctx.fillStyle = '#ffcc33';
    ctx.fillRect(0, size * 0.6, size, size * 0.06);
    ctx.fillStyle = '#111';
    for (let i = 0; i < 6; i++) ctx.fillRect(i * (size / 6) + size / 12 - 6, size * 0.6, 12, size * 0.06);
    ctx.fillStyle = rgba(0x000000, 0.5);
    ctx.fillRect(size * 0.45, size * 0.2, size * 0.1, size * 0.3);
  },

  stars(color, rand, size, ctx) {
    ctx.fillStyle = '#02030a';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 1800; i++) {
      const b = rand();
      ctx.fillStyle = rgba(b > 0.9 ? 0xbfd6ff : 0xffffff, 0.35 + b * 0.65);
      const r = b > 0.97 ? 2 : 1;
      ctx.fillRect(rand() * size, rand() * size, r, r);
    }
    const g = ctx.createRadialGradient(size * 0.7, size * 0.35, 0, size * 0.7, size * 0.35, size * 0.5);
    g.addColorStop(0, rgba(color, 0.35));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  },

  cookie(color, rand, size, ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 260; i++) {
      const x = rand() * size, y = rand() * size, r = rand() * 22 + 6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(0xffffff, 0.9));
      g.addColorStop(1, rgba(0xffffff, 0));
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  },

  bark(color, rand, size, ctx) {
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = rgba(rand() < 0.5 ? 0x000000 : 0xffffff, 0.15);
      ctx.fillRect(rand() * size, 0, rand() * 6 + 2, size);
    }
    noiseOverlay(ctx, size, 0.2, rand);
  },

  fabric(color, rand, size, ctx) {
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = rgba(0x000000, 0.15);
    for (let i = 0; i < size; i += 6) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    }
  },
};

export function getTexture(kind, color = 0x808080, opts = {}) {
  const size = opts.size || 256;
  const key = `${kind}:${color}:${size}:${opts.repeat || 1}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const gen = GENERATORS[kind] || GENERATORS.metal;
  gen(color, rng(color * 31 + kind.length * 7919), size, ctx);
  const t = finish(c, { repeat: opts.repeat || 1, srgb: kind !== 'cookie' });
  cache.set(key, t);
  return t;
}

export function makeNameplate(name, colorHex) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = 'bold 64px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(name, 256, 64);
  ctx.fillStyle = hex(colorHex);
  ctx.fillText(name, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSign(text, colorHex = 0xffffff, bg = 0x101418) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(bg);
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = hex(colorHex); ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.font = 'bold 60px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = hex(colorHex);
  ctx.fillText(text.toUpperCase(), 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSplat(colorHex) {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rand = rng(colorHex);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = hex(shade(colorHex, 0.6));
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.28, 0, 7); ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = rand() * 6.28, d = size * (0.2 + rand() * 0.25), r = size * (0.03 + rand() * 0.07);
    ctx.beginPath(); ctx.arc(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, r, 0, 7); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeRing(colorHex) {
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = hex(colorHex);
  ctx.lineWidth = 10;
  ctx.shadowColor = hex(colorHex); ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.34, 0, 7); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
