import { el, clear, hexCss, fmtTime } from './dom.js';
import { COLORS } from '../config.js';
import { SKIP } from '../game/voting.js';

// Discussion / voting / result overlay. The 3D meeting table stays visible behind it.
export class MeetingScreen {
  constructor(root, { onVote, onChat }) {
    this.cb = { onVote, onChat };
    this.title = el('h2', {});
    this.timer = el('div', { class: 'timer' });
    this.grid = el('div', { class: 'mgrid' });
    this.skipBtn = el('button', { onClick: () => this._pick(SKIP) }, 'Skip vote');
    this.confirmBtn = el('button', { class: 'primary', disabled: true, onClick: () => this._confirm() }, 'Confirm vote');
    this.resultEl = el('div', { class: 'result', hidden: true });
    this.chatLog = el('div', { class: 'log', style: { maxHeight: '120px' } });
    this.chatInput = el('input', { type: 'text', placeholder: 'Say something…', maxlength: 200 });
    this.chatInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { const t = this.chatInput.value.trim(); if (t) onChat(t); this.chatInput.value = ''; } });
    this.voteRow = el('div', { class: 'row' }, this.skipBtn, this.confirmBtn, el('div', { class: 'grow' }), el('span', { class: 'dim small' }, 'Pick a player, then confirm.'));
    this.root = el('div', { id: 'meeting', hidden: true },
      el('div', { class: 'panel card col' },
        el('div', { class: 'row' }, this.title, el('div', { class: 'grow' }), this.timer),
        this.grid, this.resultEl, this.voteRow,
        el('div', { class: 'chat', style: { position: 'static', width: 'auto' } }, this.chatLog, this.chatInput)));
    root.appendChild(this.root);
    this.selected = undefined;
    this.state = null;
  }

  show(state) {
    this.root.hidden = false;
    this.selected = undefined;
    this.state = state;
    this.resultEl.hidden = true;
    this.grid.hidden = false;
    clear(this.chatLog);
    this.update(state, Date.now());
  }
  hide() { this.root.hidden = true; }
  get visible() { return !this.root.hidden; }

  _pick(target) {
    const m = this.state?.meeting;
    if (!m || m.phase !== 'VOTE' || m.myVote !== undefined) return;
    this.selected = target;
    this.confirmBtn.disabled = false;
    this.update(this.state, this._now);
  }
  _confirm() {
    if (this.selected === undefined) return;
    this.cb.onVote(this.selected);
    this.confirmBtn.disabled = true;
    this.skipBtn.disabled = true;
  }

  addChat(name, colorIdx, text, ghost) {
    this.chatLog.appendChild(el('div', { class: ghost ? 'ghost' : '' }, el('span', { style: { color: hexCss(COLORS[colorIdx]?.hex || 0xffffff), fontWeight: 700 } }, name + ': '), text));
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  update(state, hostNow) {
    this.state = state;
    this._now = hostNow;
    const m = state.meeting;
    if (!m) return;
    const me = state.players.get(state.mySlot);
    const iAmDead = !me || me.alive === false;
    const phase = m.phase;
    this.title.textContent = phase === 'DISCUSS' ? (m.bodySlot !== null && m.bodySlot !== undefined ? 'Body reported' : 'Emergency meeting') : phase === 'VOTE' ? 'Vote' : 'Result';
    this.timer.textContent = fmtTime((m.endsAt || 0) - hostNow);
    const canVote = phase === 'VOTE' && !iAmDead && m.myVote === undefined;
    this.voteRow.hidden = phase !== 'VOTE' || iAmDead;
    this.skipBtn.disabled = !canVote;
    this.confirmBtn.disabled = !canVote || this.selected === undefined;
    this.skipBtn.classList.toggle('primary', this.selected === SKIP);
    if (phase === 'RESULT' && m.result) {
      this.grid.hidden = true;
      this.resultEl.hidden = false;
      const r = m.result;
      clear(this.resultEl);
      if (r.ejected !== null && r.ejected !== undefined) {
        const p = state.players.get(r.ejected);
        const name = p ? p.name : 'Someone';
        const roleLine = r.role ? `${name} was ${r.role === 'impostor' ? 'an Impostor' : 'not an Impostor'}.` : `${name} was ejected.`;
        const rem = r.remainingImpostors !== null && r.remainingImpostors !== undefined ? `${r.remainingImpostors} impostor${r.remainingImpostors === 1 ? '' : 's'} remain${r.remainingImpostors === 1 ? 's' : ''}.` : '';
        this.resultEl.appendChild(el('div', {}, roleLine, el('div', { class: 'sub' }, rem)));
      } else {
        this.resultEl.appendChild(el('div', {}, r.tie ? 'Tie — no one was ejected.' : 'No one was ejected (skipped).'));
      }
      return;
    }
    this.grid.hidden = false;
    clear(this.grid);
    const players = [...state.players.values()].sort((a, b) => a.slot - b.slot);
    for (const p of players) {
      const dead = p.alive === false || state.knownDead.has(p.slot);
      const card = el('div', { class: 'mcard' + (dead ? ' dead' : '') + (this.selected === p.slot ? ' sel' : '') + (m.reporter === p.slot ? ' reporter' : ''), onClick: () => { if (!dead) this._pick(p.slot); } },
        el('div', { class: 'dot', style: { background: hexCss(COLORS[p.colorIdx]?.hex || 0xffffff) } }),
        el('div', {}, p.name),
        m.voted.has(p.slot) && phase === 'VOTE' ? el('div', { class: 'voted', title: 'voted' }) : null,
      );
      this.grid.appendChild(card);
    }
  }
}
