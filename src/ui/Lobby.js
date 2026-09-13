import { el, clear, hexCss } from './dom.js';
import { COLORS, SETTINGS_SCHEMA, NET } from '../config.js';

// Start screen: name, color, create / join.
export class MenuScreen {
  constructor(root, { local, onCreate, onJoin }) {
    this.local = local;
    this.colorIdx = local.colorIdx || 0;
    this.nameInput = el('input', { type: 'text', placeholder: 'Your name', maxlength: 16, value: local.name || '' });
    this.codeInput = el('input', { type: 'text', placeholder: 'ROOM CODE', maxlength: NET.ROOM_CODE_LEN, style: { textTransform: 'uppercase', letterSpacing: '0.2em' } });
    this.error = el('div', { class: 'error' });
    this.status = el('div', { class: 'status' });
    this.swatches = el('div', { class: 'swatches' });
    this.createBtn = el('button', { class: 'primary', onClick: () => this._go(() => onCreate(this._name(), this.colorIdx)) }, 'Create room');
    this.joinBtn = el('button', { onClick: () => this._go(() => onJoin(this.codeInput.value, this._name(), this.colorIdx)) }, 'Join');
    this.codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinBtn.click(); });
    this.root = el('div', { id: 'menu' },
      el('div', { class: 'panel card col' },
        el('div', { class: 'col', style: { gap: '4px', marginBottom: '8px' } }, el('h1', {}, 'SUSPECT'), el('div', { class: 'tagline' }, '3D social deduction · voice · no servers')),
        el('h3', {}, 'Name'), this.nameInput,
        el('h3', {}, 'Color'), this.swatches,
        el('div', { class: 'row', style: { marginTop: '8px' } }, this.createBtn, el('div', { class: 'grow' }), this.codeInput, this.joinBtn),
        this.status, this.error,
        el('div', { class: 'dim small' }, 'Host a room and share the code. Works best with 4–10 players, headphones, and a mic. WASD to move, mouse to look.'),
      ));
    root.appendChild(this.root);
    this._renderSwatches();
  }
  _name() { const n = this.nameInput.value.trim() || 'Crewmate'; this.local.name = n; this.local.colorIdx = this.colorIdx; return n; }
  _go(fn) { this.error.textContent = ''; this.setBusy(true); Promise.resolve().then(fn).catch((e) => { this.setError(e?.message || String(e)); this.setBusy(false); }); }
  _renderSwatches() {
    clear(this.swatches);
    COLORS.forEach((c, i) => this.swatches.appendChild(el('div', { class: 'swatch' + (i === this.colorIdx ? ' sel' : ''), style: { background: hexCss(c.hex) }, title: c.name, onClick: () => { this.colorIdx = i; this._renderSwatches(); } })));
  }
  setBusy(b) { this.createBtn.disabled = b; this.joinBtn.disabled = b; }
  setStatus(t) { this.status.textContent = t || ''; }
  setError(t) { this.error.textContent = t || ''; this.status.textContent = ''; }
  show() { this.root.hidden = false; this.setBusy(false); }
  hide() { this.root.hidden = true; }
}

// In-lobby panel shown over the 3D lobby.
export class LobbyPanel {
  constructor(root, { onStart, onSettings, onColor, onName, onMic, onReady, onLeave }) {
    this.cb = { onStart, onSettings, onColor, onName, onMic, onReady, onLeave };
    this.codeEl = el('div', { class: 'code' });
    this.playersEl = el('div', { class: 'players' });
    this.settingsEl = el('div', { class: 'col', style: { gap: '6px' } });
    this.startBtn = el('button', { class: 'primary', onClick: () => onStart() }, 'Start game');
    this.readyBtn = el('button', { onClick: () => { this.ready = !this.ready; onReady(this.ready); } }, 'Ready');
    this.micBtn = el('button', { onClick: () => onMic() }, 'Enable microphone');
    this.swatches = el('div', { class: 'swatches' });
    this.nameInput = el('input', { type: 'text', maxlength: 16, placeholder: 'Name' });
    this.nameInput.addEventListener('change', () => onName(this.nameInput.value));
    this.warn = el('div', { class: 'dim small' });
    this.copyBtn = el('button', { class: 'small', onClick: () => { navigator.clipboard?.writeText(this.code || ''); this.copyBtn.textContent = 'Copied'; setTimeout(() => (this.copyBtn.textContent = 'Copy'), 1200); } }, 'Copy');
    this.root = el('div', { id: 'lobby', class: 'panel col' },
      el('div', { class: 'row' }, el('div', { class: 'col', style: { gap: '2px' } }, el('h3', {}, 'Room code'), this.codeEl), el('div', { class: 'grow' }), this.copyBtn),
      el('div', { class: 'row' }, this.micBtn, el('div', { class: 'grow' }), el('button', { class: 'small', onClick: () => onLeave() }, 'Leave')),
      el('h3', {}, 'Players'), this.playersEl,
      el('h3', {}, 'You'), this.nameInput, this.swatches,
      this.hostSection = el('div', { class: 'col' }, el('h3', {}, 'Game settings (host)'), this.settingsEl),
      el('div', { class: 'row' }, this.startBtn, this.readyBtn),
      this.warn,
      el('div', { class: 'dim small' }, 'Walk around while you wait. ', el('kbd', {}, 'Tab'), ' player list · ', el('kbd', {}, 'Esc'), ' settings'),
    );
    root.appendChild(this.root);
    this.ready = false;
    this.code = '';
    this._settingsBuilt = false;
  }

  setCode(code) { this.code = code; this.codeEl.textContent = code; }
  setMic(state) { this.micBtn.textContent = state === 'on' ? 'Mic on' : state === 'denied' ? 'Mic blocked (text only)' : 'Enable microphone'; this.micBtn.disabled = state === 'on'; }

  update(state, isHost, speakingFn) {
    const players = [...state.players.values()].sort((a, b) => a.slot - b.slot);
    clear(this.playersEl);
    const used = new Set();
    for (const p of players) {
      used.add(p.colorIdx);
      this.playersEl.appendChild(el('div', { class: 'player' + (speakingFn && speakingFn(p) ? ' speaking' : '') },
        el('div', { class: 'dot', style: { background: hexCss(COLORS[p.colorIdx]?.hex || 0xffffff) } }),
        el('div', { class: 'name' }, p.name),
        el('div', { class: 'tag' }, [p.isHost ? 'host' : '', p.ready ? 'ready' : '', p.slot === state.mySlot ? 'you' : ''].filter(Boolean).join(' · '))));
    }
    const me = state.players.get(state.mySlot);
    if (me && document.activeElement !== this.nameInput) this.nameInput.value = me.name;
    clear(this.swatches);
    COLORS.forEach((c, i) => {
      const taken = used.has(i) && me?.colorIdx !== i;
      this.swatches.appendChild(el('div', { class: 'swatch' + (me?.colorIdx === i ? ' sel' : '') + (taken ? ' taken' : ''), style: { background: hexCss(c.hex) }, title: c.name, onClick: () => { if (!taken) this.cb.onColor(i); } }));
    });
    this.hostSection.hidden = !isHost;
    this.startBtn.hidden = !isHost;
    if (isHost) {
      if (!this._settingsBuilt) this._buildSettings(state.settings);
      this._syncSettings(state.settings);
      const n = players.length;
      this.startBtn.disabled = n < state.minPlayers;
      this.warn.textContent = n < state.minPlayers ? `Need ${state.minPlayers - n} more player${state.minPlayers - n === 1 ? '' : 's'} to start.` : n < 3 ? 'Dev mode: fewer than 3 players.' : n === 3 ? 'With 3 players the impostor wins on the first kill. Vote well.' : '';
    } else {
      this.warn.textContent = 'Waiting for the host to start…';
    }
    this.readyBtn.textContent = this.ready ? 'Not ready' : 'Ready';
  }

  _buildSettings(settings) {
    this._settingsBuilt = true;
    this.inputs = {};
    for (const def of SETTINGS_SCHEMA) {
      let input, valueEl = el('span', { class: 'dim small' });
      if (def.type === 'range') {
        input = el('input', { type: 'range', min: def.min, max: def.max, step: def.step, value: settings[def.key] });
        input.addEventListener('input', () => { valueEl.textContent = input.value; });
        input.addEventListener('change', () => this.cb.onSettings({ [def.key]: Number(input.value) }));
      } else if (def.type === 'bool') {
        input = el('input', { type: 'checkbox' });
        input.checked = !!settings[def.key];
        input.addEventListener('change', () => this.cb.onSettings({ [def.key]: input.checked }));
      } else {
        input = el('select', {}, ...def.options.map((o) => el('option', { value: o }, o)));
        input.value = settings[def.key];
        input.addEventListener('change', () => this.cb.onSettings({ [def.key]: input.value }));
      }
      this.inputs[def.key] = { input, valueEl, def };
      this.settingsEl.appendChild(el('div', { class: 'setting' }, el('span', {}, def.label), input, valueEl));
    }
  }
  _syncSettings(settings) {
    for (const [k, { input, valueEl, def }] of Object.entries(this.inputs)) {
      if (document.activeElement === input) continue;
      if (def.type === 'bool') input.checked = !!settings[k]; else input.value = settings[k];
      valueEl.textContent = def.type === 'range' ? String(settings[k]) : '';
    }
  }
  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
}
