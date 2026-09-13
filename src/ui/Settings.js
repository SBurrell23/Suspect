import { el } from './dom.js';
import { LS_KEY, LOCAL_DEFAULTS, ICE_SERVERS, PEER_SERVER } from '../config.js';

export function loadLocalSettings() {
  try { return { ...LOCAL_DEFAULTS, ...(JSON.parse(localStorage.getItem(LS_KEY) || '{}')) }; } catch (e) { return { ...LOCAL_DEFAULTS }; }
}
export function saveLocalSettings(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

// Local (per-player) settings: look sensitivity, head bob, third person, FOV, push-to-talk, volumes.
export class SettingsPanel {
  constructor(root, { local, onChange, onResume, onLeave }) {
    this.local = local;
    this.onChange = onChange;
    const range = (key, label, min, max, step) => {
      const val = el('span', { class: 'dim small' }, String(local[key]));
      const input = el('input', { type: 'range', min, max, step, value: local[key] });
      input.addEventListener('input', () => { local[key] = Number(input.value); val.textContent = input.value; this._changed(); });
      return el('div', { class: 'setting' }, el('span', {}, label), input, val);
    };
    const bool = (key, label) => {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!local[key];
      input.addEventListener('change', () => { local[key] = input.checked; this._changed(); });
      return el('div', { class: 'setting' }, el('span', {}, label), input, el('span'));
    };
    this.root = el('div', { id: 'settings', class: 'panel col', hidden: true },
      el('div', { class: 'row' }, el('h3', {}, 'Settings'), el('div', { class: 'grow' }), el('button', { class: 'primary', onClick: () => onResume() }, 'Resume')),
      el('h3', {}, 'Controls'),
      range('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.1),
      range('fov', 'Field of view', 60, 100, 1),
      bool('headBob', 'Head bob'),
      bool('thirdPerson', 'Third person (same vision, no advantage)'),
      bool('pushToTalk', 'Push to talk (hold V)'),
      el('h3', {}, 'Audio'),
      range('masterVolume', 'Master', 0, 1, 0.05),
      range('musicVolume', 'Music', 0, 1, 0.05),
      range('voiceVolume', 'Voice', 0, 1.5, 0.05),
      el('h3', {}, 'Keys'),
      el('div', { class: 'dim small' }, 'WASD move · Shift sprint · E use · R report · Q kill · F vent · C sabotage · Tab players · T chat · V push-to-talk · M mute mic · Space/Ctrl fly (ghost / zero-G)'),
      el('h3', {}, 'Network'),
      el('div', { class: 'dim small' }, `Signaling: ${PEER_SERVER ? PEER_SERVER.host : 'PeerJS cloud'} · ICE: ${ICE_SERVERS.length} server(s)${ICE_SERVERS.some((s) => String(s.urls).startsWith('turn')) ? '' : ' (no TURN configured — see config.js)'}`),
      el('div', { class: 'row', style: { marginTop: '6px' } }, el('button', { class: 'danger', onClick: () => onLeave() }, 'Leave room')),
    );
    root.appendChild(this.root);
  }
  _changed() { saveLocalSettings(this.local); this.onChange(this.local); }
  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
  get visible() { return !this.root.hidden; }
}
