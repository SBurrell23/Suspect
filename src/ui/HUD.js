import { el, clear, hexCss, fmtTime } from './dom.js';
import { COLORS } from '../config.js';
import { SABOTAGES, SABOTAGE_ORDER } from '../game/sabotage.js';

// Inline SVG icons (no emoji, no image files)
const ICON = {
  use: '<svg viewBox="0 0 24 24"><path d="M12 3a4 4 0 0 1 4 4v3h1.5a2.5 2.5 0 0 1 0 5H16v2a4 4 0 0 1-8 0v-2H6.5a2.5 2.5 0 0 1 0-5H8V7a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
  report: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9v5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="17" r="1.3" fill="currentColor"/></svg>',
  kill: '<svg viewBox="0 0 24 24"><path d="M4 20 14 10l-2-2L2 18l2 2z" fill="currentColor"/><path d="M13 5l6 6M11 7l6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M15 3l6 6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  vent: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 8h12M6 12h12M6 16h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  sabotage: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="m7.5 12.5 3 3 6-7" fill="none" stroke="#0b1017" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  circle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  half: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M12 2 20 20l-8-5-8 5z" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
};
export const ICONS = ICON;
export function icon(name, cls = 'ico') { return el('span', { class: cls, html: ICON[name] || '' }); }

export class HUD {
  constructor(root, cb) {
    this.cb = cb; // { onAction(name), onVentMove(id), onVentExit(), onSabotage(type), onChat(text) }
    this.taskList = el('div', { class: 'task-list' });
    this.taskFill = el('div', {});
    this.taskCount = el('span', { class: 'task-count' });
    this.tasksEl = el('div', { class: 'tasks panel-mini' },
      el('div', { class: 'panel-head' }, el('h3', {}, 'Tasks'), this.taskCount),
      el('div', { class: 'taskbar' }, this.taskFill),
      this.taskList);
    this.promptEl = el('div', { class: 'prompt', hidden: true });
    this.bannerEl = el('div', { class: 'banner', hidden: true });
    this.codesEl = el('div', { class: 'codes', hidden: true });
    this.arrowsEl = el('div', { class: 'arrows' });
    this.sabCdEl = el('div', { class: 'sabcd', hidden: true });
    this.centerEl = el('div', { class: 'center', hidden: true });
    this.blackout = el('div', { class: 'blackout', hidden: true });
    this.toasts = el('div', { class: 'toasts' });
    this.vignette = el('div', { class: 'vignette' });
    this.micInd = el('div', { class: 'ind' });
    this.micEl = el('div', { class: 'mic' }, icon('mic', 'ico small-ico'), this.micInd);
    this.actionsEl = el('div', { class: 'actions' });
    this.actions = {};
    for (const [name, key, cls] of [['use', 'E', ''], ['report', 'R', ''], ['kill', 'Q', 'kill'], ['vent', 'F', ''], ['sabotage', 'C', 'sab']]) {
      const cd = el('div', { class: 'cd', hidden: true });
      const b = el('button', { class: 'action ' + cls, hidden: true, onClick: () => cb.onAction(name) }, icon(name), el('span', { class: 'label' }, name), el('span', { class: 'key' }, key), cd);
      this.actions[name] = { btn: b, cd };
      this.actionsEl.appendChild(b);
    }
    this.ventEl = el('div', { class: 'ventui', hidden: true });
    this.sabMenu = el('div', { class: 'sabmenu panel col', hidden: true });
    this.chatLog = el('div', { class: 'log' });
    this.chatInput = el('input', { type: 'text', placeholder: 'Press T to chat', maxlength: 200 });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = this.chatInput.value.trim(); if (t) cb.onChat(t); this.chatInput.value = ''; this.chatInput.blur(); }
      if (e.key === 'Escape') { this.chatInput.blur(); }
    });
    this.chatEl = el('div', { class: 'chat' }, this.chatLog, this.chatInput);
    this.statsEl = el('div', { class: 'stats' });
    this.lockHint = el('div', { class: 'lockhint', hidden: true }, el('div', {}, 'Click the 3D view to look around. Esc releases the mouse.'));
    this.root = el('div', { id: 'hud', hidden: true }, this.blackout, this.vignette, el('div', { class: 'crosshair' }), this.tasksEl, this.promptEl, this.bannerEl, this.arrowsEl, this.sabCdEl, this.codesEl, this.centerEl, this.toasts, this.micEl, this.actionsEl, this.ventEl, this.sabMenu, this.chatEl, this.statsEl, this.lockHint);
    root.appendChild(this.root);
    this._centerTimer = null;
    this._arrowNodes = [];
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }

  setPrompt(text) { if (!text) this.promptEl.hidden = true; else { this.promptEl.hidden = false; this.promptEl.innerHTML = text; } }

  // Tasks grouped by room, with a status icon per task and the crew-wide bar on top.
  setTasks(tasks, { hidden = false, impostor = false, progress }) {
    clear(this.taskList);
    if (progress) {
      this.taskFill.style.width = progress.total ? `${(100 * progress.done) / progress.total}%` : '0%';
      this.taskCount.textContent = `${progress.done}/${progress.total} crew`;
    }
    if (hidden) { this.taskList.appendChild(el('div', { class: 'task-note bad' }, 'COMMS SABOTAGED')); return; }
    if (impostor) this.taskList.appendChild(el('div', { class: 'task-note' }, 'Fake tasks. Finishing them changes nothing.'));
    const byZone = new Map();
    for (const t of tasks) { const k = t.zone || 'Somewhere'; if (!byZone.has(k)) byZone.set(k, []); byZone.get(k).push(t); }
    for (const [zone, list] of byZone) {
      this.taskList.appendChild(el('div', { class: 'task-room' }, zone));
      for (const t of list) {
        const twoStep = t.steps.length > 1;
        const ic = t.done ? 'check' : twoStep && t.step > 0 ? 'half' : 'circle';
        this.taskList.appendChild(el('div', { class: 'task' + (t.done ? ' done' : '') },
          icon(ic, 'ico task-ico'),
          el('span', { class: 'task-label' }, t.label),
          twoStep && !t.done ? el('span', { class: 'pill' }, t.step === 0 ? 'upload' : 'download') : null));
      }
    }
    if (!tasks.length) this.taskList.appendChild(el('div', { class: 'task-note' }, 'No tasks.'));
  }
  showTasks(v) { this.tasksEl.hidden = !v; }

  setActions(spec) {
    for (const [name, a] of Object.entries(this.actions)) {
      const s = spec[name];
      if (!s || !s.visible) { a.btn.hidden = true; continue; }
      a.btn.hidden = false;
      a.btn.disabled = !s.enabled;
      a.btn.classList.toggle('ready', !!s.enabled);
      if (s.cooldownMs > 0) { a.cd.hidden = false; a.cd.textContent = Math.ceil(s.cooldownMs / 1000); } else a.cd.hidden = true;
    }
  }

  setBanner(text, sab = false) {
    if (!text) { this.bannerEl.hidden = true; return; }
    this.bannerEl.hidden = false;
    this.bannerEl.className = 'banner' + (sab ? ' sab' : '');
    this.bannerEl.textContent = text;
  }

  setSabotage(sab, hostNow) {
    if (!sab) { this.setBanner(null); this.codesEl.hidden = true; return; }
    const def = SABOTAGES[sab.type];
    let text = def.label.toUpperCase() + ' SABOTAGED';
    if (sab.endsAt) text += `  ${fmtTime(sab.endsAt - hostNow)}`;
    if (sab.type === 'reactor') text += `  panels ${sab.holds.filter(Boolean).length}/2 held`;
    if (sab.type === 'o2') text += `  filters ${sab.fixed.filter(Boolean).length}/2`;
    this.setBanner(text, true);
    if (sab.type === 'o2' && sab.codes) { this.codesEl.hidden = false; this.codesEl.innerHTML = `<span>A</span> ${sab.codes[0]} <span>B</span> ${sab.codes[1]}`; } else this.codesEl.hidden = true;
  }

  // Everyone sees when the next sabotage can happen.
  setSabotageCooldown({ visible, ms, active, remaining }) {
    if (!visible) { this.sabCdEl.hidden = true; return; }
    this.sabCdEl.hidden = false;
    if (active) { this.sabCdEl.className = 'sabcd active'; this.sabCdEl.textContent = 'SABOTAGE IN PROGRESS'; }
    else if (ms > 0) { this.sabCdEl.className = 'sabcd'; this.sabCdEl.textContent = `NEXT SABOTAGE AVAILABLE IN ${Math.ceil(ms / 1000)}s`; }
    else if (remaining === 0) { this.sabCdEl.className = 'sabcd dim'; this.sabCdEl.textContent = 'NO SABOTAGES LEFT'; }
    else { this.sabCdEl.className = 'sabcd ready'; this.sabCdEl.textContent = 'SABOTAGE READY'; }
  }

  // Direction arrows toward the panels that fix a critical sabotage. angle: radians, 0 = straight ahead, + = right.
  setArrows(list) {
    if (!list || !list.length) { if (this.arrowsEl.children.length) clear(this.arrowsEl); this._arrowNodes = []; return; }
    if (this._arrowNodes.length !== list.length) {
      clear(this.arrowsEl);
      this._arrowNodes = list.map(() => {
        const ic = icon('arrow', 'ico arrow-ico');
        const lab = el('span', { class: 'arrow-label' });
        const dist = el('span', { class: 'arrow-dist' });
        const node = el('div', { class: 'arrow' }, ic, lab, dist);
        this.arrowsEl.appendChild(node);
        return { node, ic, lab, dist };
      });
    }
    list.forEach((a, i) => {
      const n = this._arrowNodes[i];
      n.ic.style.transform = `rotate(${a.angle}rad)`;
      n.lab.textContent = a.label;
      n.dist.textContent = `${Math.round(a.dist)}m`;
      n.node.classList.toggle('behind', Math.abs(a.angle) > Math.PI * 0.6);
    });
  }

  toast(text, ms = 3500) {
    const t = el('div', { class: 'toast', html: text });
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  showCenter(big, sub, cls = '', ms = 3000) {
    clearTimeout(this._centerTimer);
    this.centerEl.hidden = false;
    this.centerEl.className = 'center ' + cls;
    clear(this.centerEl);
    this.centerEl.appendChild(el('div', {}, el('div', { class: 'big', html: big }), sub ? el('div', { class: 'sub', html: sub }) : null));
    if (ms > 0) this._centerTimer = setTimeout(() => (this.centerEl.hidden = true), ms);
  }
  hideCenter() { clearTimeout(this._centerTimer); this.centerEl.hidden = true; }

  setBlackout(on) { this.blackout.hidden = false; this.blackout.style.opacity = on ? '1' : '0'; if (!on) setTimeout(() => { if (this.blackout.style.opacity === '0') this.blackout.hidden = true; }, 650); }

  setVignette(on) { this.vignette.classList.toggle('on', !!on); }
  setMic(state, speaking) { this.micInd.className = 'ind ' + (state === 'on' ? (speaking ? 'on' : 'idle') : state === 'denied' ? 'off' : ''); this.micEl.title = state === 'on' ? 'Microphone on' : state === 'denied' ? 'Microphone blocked' : 'Microphone off'; }
  setStats({ fps, draws, ping }) { this.statsEl.textContent = `${fps} FPS  ${draws} DRAWS  ${ping === null || ping === undefined ? '-' : ping} MS`; }
  setLockHint(v) { this.lockHint.hidden = !v; }

  showVent(connects, ventLabel) {
    this.ventEl.hidden = false;
    clear(this.ventEl);
    this.ventEl.appendChild(el('div', { class: 'panel col ventcard' },
      el('div', { class: 'panel-head' }, icon('vent', 'ico'), el('h3', {}, 'In vent')),
      el('div', { class: 'opts' }, ...connects.map((id) => el('button', { onClick: () => this.cb.onVentMove(id) }, ventLabel(id)))),
      el('button', { class: 'primary', onClick: () => this.cb.onVentExit() }, 'Climb out', el('span', { class: 'key' }, 'F'))));
  }
  hideVent() { this.ventEl.hidden = true; }

  showSabotageMenu(state, hostNow) {
    this.sabMenu.hidden = false;
    clear(this.sabMenu);
    this.sabMenu.appendChild(el('div', { class: 'panel-head' }, icon('sabotage', 'ico'), el('h3', {}, 'Sabotage'), el('div', { class: 'grow' }), el('button', { class: 'iconbtn', onClick: () => this.hideSabotageMenu() }, icon('close'))));
    const busy = !!state.sabotage;
    const cd = Math.max(0, state.sabotageCooldownEnd - hostNow);
    const used = new Set(state.usedSabotages || []);
    this.sabMenu.appendChild(el('div', { class: 'dim small' }, 'Each sabotage can be used once per round. Everyone sees the cooldown.'));
    for (const type of SABOTAGE_ORDER) {
      const def = SABOTAGES[type];
      const isUsed = used.has(type);
      this.sabMenu.appendChild(el('div', { class: 'opt' + (isUsed ? ' used' : '') },
        el('div', {}, el('div', { class: 'opt-title' }, def.label, def.critical ? el('span', { class: 'pill bad' }, 'critical') : null), el('div', { class: 'dim small' }, def.description)),
        el('button', { class: isUsed ? '' : 'primary', disabled: busy || cd > 0 || isUsed, onClick: () => { this.cb.onSabotage(type); this.hideSabotageMenu(); } }, isUsed ? 'Used' : cd > 0 ? Math.ceil(cd / 1000) + 's' : 'Go')));
    }
  }
  hideSabotageMenu() { this.sabMenu.hidden = true; }
  get sabotageMenuOpen() { return !this.sabMenu.hidden; }

  addChat(name, colorIdx, text, ghost) {
    const line = el('div', { class: ghost ? 'ghost' : '' }, el('span', { style: { color: hexCss(COLORS[colorIdx]?.hex || 0xffffff), fontWeight: 700 } }, name + ': '), text);
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }
  focusChat() { this.chatInput.focus(); }
  get chatFocused() { return document.activeElement === this.chatInput; }
}
