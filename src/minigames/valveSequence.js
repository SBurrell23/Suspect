import { defineMinigame, setupCanvas, pointer, panelBg, label, roundRect, PALETTE, dist } from './common.js';

// Simon-style: four valves light up in a sequence; repeat it. The sequence grows each round.
const VALVES = [
  { x: 200, y: 150, c: '#ff5f5f', f: 330 }, { x: 440, y: 150, c: '#5fe38a', f: 392 },
  { x: 200, y: 300, c: '#7fb2ff', f: 494 }, { x: 440, y: 300, c: '#ffcc4d', f: 587 },
];

export default defineMinigame({ id: 'valveSequence', label: 'Valve Sequence', duration: 'short', visual: false }, (container, { onComplete, onFail, difficulty = 1 }) => {
  const { canvas, ctx, w, h, destroy: destroyCanvas } = setupCanvas(container, 640, 420);
  const p = pointer(canvas, w, h);
  const rounds = Math.min(7, 4 + Math.round((difficulty - 1) * 3));
  const stepT = Math.max(0.28, 0.55 - (difficulty - 1) * 0.15);
  let seq = [];
  let phase = 'show', showIdx = 0, showT = 0, inputIdx = 0, lit = -1, litT = 0, done = false, wrongT = 0;
  let audio = null;
  const beep = (i) => {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(); o.type = 'triangle'; o.frequency.value = VALVES[i].f;
      const g = audio.createGain(); g.gain.setValueAtTime(0.0001, audio.currentTime); g.gain.linearRampToValueAtTime(0.25, audio.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25);
      o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.3);
    } catch (e) { /* no audio */ }
  };
  const nextRound = () => { seq.push(Math.floor(Math.random() * 4)); phase = 'show'; showIdx = 0; showT = 0.6; inputIdx = 0; };
  nextRound();
  return {
    update(dt, t) {
      if (done) return;
      if (lit >= 0) { litT -= dt; if (litT <= 0) lit = -1; }
      if (phase === 'show') {
        showT -= dt;
        if (showT <= 0) {
          if (showIdx >= seq.length) { phase = 'input'; }
          else { lit = seq[showIdx]; litT = stepT * 0.7; beep(lit); showIdx++; showT = stepT; }
        }
      } else if (phase === 'input') {
        if (p.justDown) {
          const hit = VALVES.findIndex((v) => dist(p.x, p.y, v.x, v.y) < 62);
          if (hit >= 0) {
            lit = hit; litT = 0.2; beep(hit);
            if (hit === seq[inputIdx]) {
              inputIdx++;
              if (inputIdx >= seq.length) {
                if (seq.length >= rounds) { done = true; setTimeout(onComplete, 400); }
                else { phase = 'wait'; showT = 0.7; }
              }
            } else { wrongT = 0.6; phase = 'wrong'; }
          }
        }
      } else if (phase === 'wait') { showT -= dt; if (showT <= 0) nextRound(); }
      else if (phase === 'wrong') { wrongT -= dt; if (wrongT <= 0) { done = true; onFail && onFail(); } }
      p.consume();
      panelBg(ctx, w, h, phase === 'show' ? 'WATCH THE SEQUENCE' : phase === 'input' ? 'REPEAT IT' : phase === 'wrong' ? 'WRONG VALVE' : 'GOOD');
      // pipes between valves
      ctx.strokeStyle = PALETTE.line; ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(200, 150); ctx.lineTo(440, 150); ctx.lineTo(440, 300); ctx.lineTo(200, 300); ctx.closePath(); ctx.stroke();
      VALVES.forEach((v, i) => {
        const on = lit === i;
        ctx.beginPath(); ctx.arc(v.x, v.y, 56, 0, 7); ctx.fillStyle = on ? v.c : PALETTE.panel2; ctx.fill();
        ctx.strokeStyle = v.c; ctx.lineWidth = on ? 8 : 4; ctx.stroke();
        ctx.strokeStyle = on ? PALETTE.bg : v.c; ctx.lineWidth = 6;
        for (let k = 0; k < 3; k++) { const a = (k * Math.PI) / 3 + (on ? t * 6 : 0); ctx.beginPath(); ctx.moveTo(v.x - Math.cos(a) * 34, v.y - Math.sin(a) * 34); ctx.lineTo(v.x + Math.cos(a) * 34, v.y + Math.sin(a) * 34); ctx.stroke(); }
      });
      // round dots
      for (let i = 0; i < rounds; i++) { ctx.fillStyle = i < seq.length - (phase === 'input' || phase === 'show' ? 1 : 0) ? PALETTE.ok : i === seq.length - 1 ? PALETTE.warn : PALETTE.line; ctx.beginPath(); ctx.arc(200 + i * 40, 385, 8, 0, 7); ctx.fill(); }
      label(ctx, `${inputIdx} / ${seq.length}`, 590, 385, 14, PALETTE.dim, 'right');
    },
    destroy() { p.destroy(); destroyCanvas(); try { audio?.close(); } catch (e) { /* */ } },
  };
});
