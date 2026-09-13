import { el, clear, hexCss, fmtTime } from './dom.js';
import { COLORS } from '../config.js';
import { SABOTAGES } from '../game/sabotage.js';

export class HUD {
  constructor(root, cb) {
    this.cb = cb; // { onAction(name), onVentMove(id), onVentExit(), onSabotage(type, room), onChat(text) }
    this.taskList = el('div', {});
    this.taskFill = el('div', {});
    this.tasksEl = el('div', { class: 'tasks' }, el('h3', {}, 'Tasks'), el('div', { class: 'taskbar' }, this.taskFill), this.taskList);
    this.promptEl = el('div', { class: 'prompt', hidden: true });
    this.bannerEl = el('div', { class: 'banner', hidden: true });
    this.codesEl = el('div', { class: 'codes', hidden: true });
    this.centerEl = el('div', { class: 'center', hidden: true });
    this.blackout = el('div', { class: 'blackout', hidden: true });
    this.toasts = el('div', { class: 'toasts' });
    this.vignette = el('div', { class: 'vignette' });
    this.micInd = el('div', { class: 'ind' });
    this.micEl = el('div', { class: 'mic' }, this.micInd, el('span', { class: 'small dim' }, 'mic'));
    this.actionsEl = el('div', { class: 'actions' });
    this.actions = {};
    for (const [name, key, cls] of [['use', 'E', ''], ['report', 'R', ''], ['kill', 'Q', 'kill'], ['vent', 'F', ''], ['sabotage', 'C', '']]) {
      const cd = el('div', { class: 'cd', hidden: true });
      const b = el('button', { class: 'action ' + cls, hidden: true, onClick: () => cb.onAction(name) }, el('span', { class: 'key' }, key), el('span', {}, name), cd);
      this.actions[name] = { btn: b, cd };
      this.actionsEl.appendChild(b);
    }
    this.ventEl = el('div', { class: 'ventui', hidden: true });
    this.sabMenu = el('div', { class: 'sabmenu panel col', hidden: true });
    this.chatLog = el('div', { class: 'log' });
    this.chatInput = el('input', { type: 'text', placeholder: 'Press T to chat…', maxlength: 200 });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = this.chatInput.value.trim(); if (t) cb.onChat(t); this.chatInput.value = ''; this.chatInput.blur(); }
      if (e.key === 'Escape') { this.chatInput.blur(); }
    });
    this.chatEl = el('div', { class: 'chat' }, this.chatLog, this.chatInput);
    this.fpsEl = el('div', { class: 'fps' });
    this.lockHint = el('div', { class: 'lockhint', hidden: true, onClick: () => cb.onAction('lock') }, el('div', {}, 'Click to look around · Esc for settings'));
    this.root = el('div', { id: 'hud', hidden: true }, this.blackout, this.vignette, el('div', { class: 'crosshair' }), this.tasksEl, this.promptEl, this.bannerEl, this.codesEl, this.centerEl, this.toasts, this.micEl, this.actionsEl, this.ventEl, this.sabMenu, this.chatEl, this.fpsEl, this.lockHint);
    root.appendChild(this.root);
    this._centerTimer = null;
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }

  setPrompt(text) { if (!text) this.promptEl.hidden = true; else { this.promptEl.hidden = false; this.promptEl.innerHTML = text; } }

  setTasks(tasks, { hidden = false, impostor = false, progress }) {
    clear(this.taskList);
    if (progress) this.taskFill.style.width = progress.total ? `${(100 * progress.done) / progress.total}%` : '0%';
    if (hidden) { this.taskList.appendChild(el('div', { class: 'dim' }, 'COMMS SABOTAGED')); return; }
    if (impostor) this.taskList.appendChild(el('div', { class: 'dim small' }, 'Fake tasks — completing them does nothing.'));
    for (const t of tasks) {
      const step = t.steps.length > 1 ? ` (${t.step}/${t.steps.length})` : '';
      this.taskList.appendChild(el('div', { class: 'task' + (t.done ? ' done' : '') }, el('span', { class: 'where' }, t.zone ? t.zone + ':' : ''), el('span', {}, t.label + step)));
    }
    if (!tasks.length) this.taskList.appendChild(el('div', { class: 'dim small' }, 'No tasks.'));
  }
  showTasks(v) { this.tasksEl.hidden = !v; }

  // buttons: { use:{visible,enabled,label}, report:{visible,enabled}, kill:{visible,enabled,cooldownMs}, vent:{visible,enabled}, sabotage:{visible,enabled} }
  setActions(spec) {
    for (const [name, a] of Object.entries(this.actions)) {
      const s = spec[name];
      if (!s || !s.visible) { a.btn.hidden = true; continue; }
      a.btn.hidden = false;
      a.btn.disabled = !s.enabled;
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
    if (sab.endsAt) text += ` — ${fmtTime(sab.endsAt - hostNow)}`;
    if (sab.type === 'reactor') text += ` — panels ${sab.holds.filter(Boolean).length}/2 held`;
    if (sab.type === 'o2') text += ` — filters ${sab.fixed.filter(Boolean).length}/2`;
    this.setBanner(text, true);
    if (sab.type === 'o2' && sab.codes) { this.codesEl.hidden = false; this.codesEl.textContent = `A ${sab.codes[0]}   B ${sab.codes[1]}`; } else this.codesEl.hidden = true;
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
  setMic(state, speaking) { this.micInd.className = 'ind ' + (state === 'on' ? (speaking ? 'on' : '') : state === 'denied' ? 'off' : ''); }
  setFps(fps, draws) { this.fpsEl.textContent = `${fps} fps · ${draws} draws`; }
  setLockHint(v) { this.lockHint.hidden = !v; }

  showVent(connects, ventLabel) {
    this.ventEl.hidden = false;
    clear(this.ventEl);
    this.ventEl.appendChild(el('h2', {}, 'In vent'));
    this.ventEl.appendChild(el('div', { class: 'opts' }, ...connects.map((id) => el('button', { onClick: () => this.cb.onVentMove(id) }, ventLabel(id)))));
    this.ventEl.appendChild(el('button', { class: 'primary', onClick: () => this.cb.onVentExit() }, 'Exit vent (F)'));
  }
  hideVent() { this.ventEl.hidden = true; }

  showSabotageMenu(rooms, state, hostNow) {
    this.sabMenu.hidden = false;
    clear(this.sabMenu);
    this.sabMenu.appendChild(el('div', { class: 'row' }, el('h3', {}, 'Sabotage'), el('div', { class: 'grow' }), el('button', { class: 'small', onClick: () => this.hideSabotageMenu() }, 'Close (C)')));
    const busy = !!state.sabotage;
    const cd = Math.max(0, state.sabotageCooldownEnd - hostNow);
    for (const type of ['lights', 'comms', 'reactor', 'o2']) {
      const def = SABOTAGES[type];
      this.sabMenu.appendChild(el('div', { class: 'opt' }, el('div', {}, el('div', {}, def.label), el('div', { class: 'dim small' }, def.description)),
        el('button', { disabled: busy || cd > 0, onClick: () => { this.cb.onSabotage(type); this.hideSabotageMenu(); } }, cd > 0 ? Math.ceil(cd / 1000) + 's' : 'Go')));
    }
    if (rooms.length) {
      this.sabMenu.appendChild(el('h3', {}, 'Seal doors (10s)'));
      for (const r of rooms) this.sabMenu.appendChild(el('div', { class: 'opt' }, el('div', {}, r.name), el('button', { onClick: () => { this.cb.onSabotage('doors', r.id); this.hideSabotageMenu(); } }, 'Seal')));
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
