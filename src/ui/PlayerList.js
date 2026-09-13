import { el, clear, hexCss } from './dom.js';
import { COLORS } from '../config.js';

// Tab overlay: everyone in the room, who is speaking, per-peer volume and local mute.
export class PlayerList {
  constructor(root, { onVolume, onMute }) {
    this.cb = { onVolume, onMute };
    this.list = el('div', { class: 'players' });
    this.root = el('div', { id: 'playerlist', class: 'panel col', hidden: true }, el('h3', {}, 'Players'), this.list, el('div', { class: 'dim small' }, 'Release Tab to close.'));
    root.appendChild(this.root);
  }
  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
  get visible() { return !this.root.hidden; }

  update(state, { speakingFn, deadFn, volumeFn, mutedFn, roles }) {
    clear(this.list);
    const players = [...state.players.values()].sort((a, b) => a.slot - b.slot);
    for (const p of players) {
      const dead = deadFn ? deadFn(p) : false;
      const me = p.slot === state.mySlot;
      const role = roles ? roles[p.slot] : null;
      const row = el('div', { class: 'player' + (speakingFn(p) ? ' speaking' : '') + (dead ? ' dead' : '') },
        el('div', { class: 'dot', style: { background: hexCss(COLORS[p.colorIdx]?.hex || 0xffffff) } }),
        el('div', { class: 'name' }, p.name, me ? el('span', { class: 'tag' }, ' (you)') : null, role ? el('span', { class: 'tag', style: { color: role === 'impostor' ? 'var(--bad)' : 'var(--accent)' } }, ' ' + role) : null),
        p.isHost ? el('span', { class: 'tag' }, 'host') : null);
      if (!me) {
        const vol = el('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: volumeFn(p) });
        vol.addEventListener('input', () => this.cb.onVolume(p, Number(vol.value)));
        const mute = el('button', { class: 'small', style: { padding: '4px 8px' }, onClick: () => this.cb.onMute(p, !mutedFn(p)) }, mutedFn(p) ? 'Unmute' : 'Mute');
        row.append(vol, mute);
      }
      this.list.appendChild(row);
    }
  }
}
