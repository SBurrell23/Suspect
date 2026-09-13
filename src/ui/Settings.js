import { el } from './dom.js';
import { LS_KEY, LOCAL_DEFAULTS } from '../config.js';
import { icon } from './HUD.js';

export function loadLocalSettings() {
  try {
    const s = { ...LOCAL_DEFAULTS, ...(JSON.parse(localStorage.getItem(LS_KEY) || '{}')) };
    delete s.fov; delete s.thirdPerson; // removed: fixed 75° first person only (fairness)
    return s;
  } catch (e) { return { ...LOCAL_DEFAULTS }; }
}
export function saveLocalSettings(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

// Local (per-player) settings. Nothing here can grant a gameplay advantage: FOV is fixed at 75°
// and the game is first person only.
export class SettingsPanel {
  constructor(root, { local, onChange, onResume, onLeave }) {
    this.local = local;
    this.onChange = onChange;
    const range = (key, label, min, max, step, fmt = (v) => String(v)) => {
      const val = el('span', { class: 'val' }, fmt(local[key]));
      const input = el('input', { type: 'range', min, max, step, value: local[key] });
      input.addEventListener('input', () => { local[key] = Number(input.value); val.textContent = fmt(local[key]); this._changed(); });
      return el('div', { class: 'setting' }, el('span', {}, label), input, val);
    };
    const bool = (key, label, hint) => {
      const input = el('input', { type: 'checkbox', class: 'switch' });
      input.checked = !!local[key];
      input.addEventListener('change', () => { local[key] = input.checked; this._changed(); });
      return el('div', { class: 'setting' }, el('span', {}, label, hint ? el('div', { class: 'dim small' }, hint) : null), input, el('span'));
    };
    const pct = (v) => Math.round(v * 100) + '%';
    this.root = el('div', { id: 'settings', class: 'panel col', hidden: true },
      el('div', { class: 'panel-head' }, el('h3', {}, 'Settings'), el('div', { class: 'grow' }), el('button', { class: 'primary', onClick: () => onResume() }, 'Resume')),
      el('h4', {}, 'Controls'),
      range('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.1, (v) => v.toFixed(1) + 'x'),
      bool('headBob', 'Head bob', 'Turn off if you get motion sick.'),
      bool('pushToTalk', 'Push to talk', 'Hold V to speak. Off = open mic with a noise gate.'),
      el('h4', {}, 'Graphics'),
      bool('antialias', 'Antialiasing (MSAA 4x)', 'Smooths jagged edges. Turn off on slower machines.'),
      el('h4', {}, 'Audio'),
      range('masterVolume', 'Master', 0, 1, 0.05, pct),
      range('musicVolume', 'Music', 0, 1, 0.05, pct),
      range('voiceVolume', 'Voice', 0, 1.5, 0.05, pct),
      el('h4', {}, 'Keys'),
      el('div', { class: 'keys' },
        ...[['WASD', 'move'], ['Shift', 'sprint'], ['E', 'use'], ['R', 'report'], ['Q', 'kill'], ['F', 'vent'], ['C', 'sabotage'], ['Tab', 'players'], ['T', 'chat'], ['V', 'push-to-talk'], ['M', 'mute mic'], ['Space / Ctrl', 'fly (ghost)']]
          .map(([k, v]) => el('div', { class: 'keyrow' }, el('kbd', {}, k), el('span', { class: 'dim' }, v)))),
      el('div', { class: 'dim small' }, 'Field of view is fixed at 75° and the camera is always first person, so nobody can see more than anyone else.'),
      el('div', { class: 'row', style: { marginTop: '6px' } }, el('button', { class: 'danger', onClick: () => onLeave() }, 'Leave room')),
    );
    root.appendChild(this.root);
  }
  _changed() { saveLocalSettings(this.local); this.onChange(this.local); }
  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
  get visible() { return !this.root.hidden; }
}
