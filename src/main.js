import * as THREE from 'three';
import './ui/styles.css';
import { NET, RULES, COLORS } from './config.js';
import { MSG, BIN, FLAG } from './net/protocol.js';
import { Net } from './net/peer.js';
import { encodeInputs, decodeInputs, decodeSnapshot } from './net/snapshot.js';
import { HostGame } from './game/hostLogic.js';
import { ClientGame } from './game/clientLogic.js';
import { currentStation } from './game/tasks.js';
import { SABOTAGES, SABOTAGE_ORDER } from './game/sabotage.js';
import { LevelBuilder } from './world/LevelBuilder.js';
import { getLevel } from './world/levels/index.js';
import { VisionPass } from './world/vision.js';
import { LocalPlayer } from './entities/LocalPlayer.js';
import { RemotePlayer } from './entities/RemotePlayer.js';
import { DeadBody } from './entities/DeadBody.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { VoiceManager } from './voice/voiceManager.js';
import { getMinigame, difficultyFor } from './minigames/index.js';
import { MenuScreen, LobbyPanel } from './ui/Lobby.js';
import { HUD } from './ui/HUD.js';
import { MeetingScreen } from './ui/MeetingScreen.js';
import { PlayerList } from './ui/PlayerList.js';
import { SettingsPanel, loadLocalSettings, saveLocalSettings } from './ui/Settings.js';
import { el, clear } from './ui/dom.js';
import { icon } from './ui/HUD.js';

const CLIENT_TO_HOST = new Set([
  MSG.JOIN, MSG.SET_NAME, MSG.SET_COLOR, MSG.READY, MSG.START_GAME, MSG.SET_SETTINGS, MSG.TASK_COMPLETE, MSG.KILL_ATTEMPT,
  MSG.REPORT_BODY, MSG.EMERGENCY_MEETING, MSG.VOTE, MSG.SABOTAGE_REQUEST, MSG.SABOTAGE_FIX, MSG.VENT_ENTER, MSG.VENT_MOVE,
  MSG.VENT_EXIT, MSG.MINIGAME_STATE, MSG.CHAT,
]);
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const distP = (a, p) => Math.hypot(a.x - p[0], a.y - p[1], a.z - p[2]);

class App {
  constructor() {
    this.ui = document.getElementById('ui');
    this.canvas = document.getElementById('gl');
    this.local = loadLocalSettings();
    this.dev = new URLSearchParams(location.search).has('dev');

    // ---- rendering
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.camera = new THREE.PerspectiveCamera(this.local.fov, window.innerWidth / window.innerHeight, 0.1, 500);
    this.vision = new VisionPass(this.renderer, { samples: this.local.antialias ? 4 : 0 });

    // ---- audio (context starts suspended until a user gesture)
    this.sound = new SoundEngine();
    this.listener = new THREE.AudioListener();
    this.camera.add(this.listener);
    this.scene.add(this.camera);
    this._applyVolumes();

    // ---- UI
    this.menu = new MenuScreen(this.ui, { local: this.local, onCreate: (n, c) => this.createRoom(n, c), onJoin: (code, n, c) => this.joinRoom(code, n, c) });
    this.lobbyPanel = new LobbyPanel(this.ui, {
      onStart: () => this.client?.startGame(),
      onSettings: (s) => this.client?.setSettings(s),
      onColor: (i) => this.client?.setColor(i),
      onName: (n) => { this.local.name = n; saveLocalSettings(this.local); this.client?.setName(n); },
      onMic: () => this.enableMic(),
      onReady: (r) => this.client?.setReady(r),
      onLeave: () => this.leave(),
    });
    this.lobbyPanel.hide();
    this.hud = new HUD(this.ui, {
      onAction: (name) => this.action(name),
      onVentMove: (id) => this.client?.ventMove(id),
      onVentExit: () => this.client?.ventExit(),
      onSabotage: (type, room) => this.client?.sabotage(type, room),
      onChat: (t) => this.client?.chat(t),
    });
    this.meeting = new MeetingScreen(this.ui, { onVote: (t) => this.client?.vote(t), onChat: (t) => this.client?.chat(t) });
    this.playerList = new PlayerList(this.ui, {
      onVolume: (p, v) => this.voice?.setVolume(p.id, v),
      onMute: (p, m) => { this.voice?.setMuted(p.id, m); this._refreshPlayerList(); },
    });
    this.settings = new SettingsPanel(this.ui, {
      local: this.local,
      onChange: () => { this._applyVolumes(); this.voice?.setPushToTalk(this.local.pushToTalk); this.vision.setSamples(this.local.antialias ? 4 : 0); if (this.localPlayer) this.localPlayer.settings = this.local; },
      onResume: () => { this.settings.hide(); this.localPlayer?.requestPointerLock(this.canvas); },
      onLeave: () => this.leave(),
    });
    this.minigameRoot = el('div', { id: 'minigame', hidden: true });
    this.ui.appendChild(this.minigameRoot);

    // ---- world state
    this.net = null; this.client = null; this.host = null; this.voice = null;
    this.level = null; this.levelId = null;
    this.localPlayer = null;
    this.remotes = new Map();
    this.bodies = new Map();
    this.minigame = null;
    this.flash = 0; this.flashColor = new THREE.Color(1, 0, 0);
    this.pulse = 0;
    this.myFlags = FLAG.ALIVE;
    this.lastT = performance.now();
    this.fpsAcc = 0; this.fpsN = 0;
    this.interact = { use: null, report: null, kill: null, vent: null };
    this.stepAcc = new Map();
    this._lastZone = null;

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    this.canvas.addEventListener('click', () => { if (this.net && this._canLock()) this.localPlayer?.requestPointerLock(this.canvas); });
    window.addEventListener('beforeunload', () => { this.net?.destroy(); });
    requestAnimationFrame((t) => this.loop(t));
  }

  _applyVolumes() { this.sound.setVolumes({ master: this.local.masterVolume, music: this.local.musicVolume, voice: this.local.voiceVolume }); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vision.setSize(w, h);
  }

  // ------------------------------------------------------------------ connection
  async createRoom(name, colorIdx, preferredCode = null) {
    await this.sound.resume();
    this.menu.setStatus('Creating room…');
    const net = new Net();
    const code = await net.host(this.dev ? preferredCode : null);
    this.net = net;
    await this._connected(name, colorIdx, code);
  }

  async joinRoom(code, name, colorIdx) {
    if (!code || code.trim().length < NET.ROOM_CODE_LEN) throw new Error('Enter the 6-character room code.');
    await this.sound.resume();
    this.menu.setStatus('Connecting to ' + code.toUpperCase() + '…');
    const net = new Net();
    try { await net.join(code); } catch (e) { net.destroy(); throw new Error(e?.type === 'peer-unavailable' ? 'Room not found. Check the code.' : (e?.message || 'Could not connect.')); }
    this.net = net;
    await this._connected(name, colorIdx, code.toUpperCase());
  }

  async _connected(name, colorIdx, code) {
    const net = this.net;
    this.client = new ClientGame(net);
    if (net.isHost) this.host = new HostGame({ net, requestLevel: (id) => this.requestLevel(id), minPlayers: this.dev ? 1 : NET.MIN_PLAYERS });
    // The host clock must not depend on requestAnimationFrame: a backgrounded host tab would freeze the round.
    this.hostTimer = setInterval(() => { if (this.host) this.host.update(performance.now()); }, 50);
    this.voice = new VoiceManager(this.sound, net, this.listener);
    this.voice.setPushToTalk(this.local.pushToTalk);
    net.on('evt', (from, msg) => this.onEvt(from, msg));
    net.on('net', (from, buf) => this.onNet(from, buf));
    net.on('peer-leave', (id) => { if (this.host) this.host.removePeer(id); });
    net.on('became-host', () => this.onBecameHost());
    net.on('host-changed', (id) => this.hud.toast('Host changed — waiting for the new host…'));
    net.on('error', (err) => { console.warn('net error', err); if (err?.type !== 'peer-unavailable') this.hud.toast('Network: ' + (err?.type || err?.message || 'error')); });
    net.on('closed', () => this.hud.toast('Disconnected from signaling server.'));

    this.requestLevel('lobby');
    this.localPlayer = new LocalPlayer({ camera: this.camera, world: this.level.collision, level: this.level, settings: this.local, colorHex: COLORS[colorIdx].hex, name });
    this.localPlayer.onInputs = (recent) => { net.sendBinaryToHost(encodeInputs(recent)); };
    this.localPlayer.onFootstep = () => { const s = this.localPlayer.state; this.sound.play('footstep', { surface: this.level.collision.surfaceAt(s.x, s.y, s.z), sprint: this.localPlayer.sprinting, volume: 0.22 }); };
    this.scene.add(this.localPlayer.view.group);
    const sp = this.level.spawnPoints(1)[0];
    this.localPlayer.teleport(sp.x, sp.y, sp.z, sp.yaw);
    this._wireClient();
    this.menu.hide();
    this.lobbyPanel.setCode(code);
    this.lobbyPanel.show();
    this.hud.show();
    this.hud.showTasks(false);
    this.sound.music.setBed(this.level.data.ambience?.bedTrack || 'ambient-space');
    this.sound.music.setIntensity(1);
    this.sound.music.start();
    net.sendToHost({ t: MSG.JOIN, name, colorIdx });
    this.hud.toast(`Room <b>${code}</b> — share the code. ${net.isHost ? 'You are the host.' : ''} Click the 3D view to look around, Esc to get the mouse back.`, 8000);
  }

  onBecameHost() {
    const s = this.client.state;
    const wasInGame = s.phase !== 'LOBBY';
    // only peers that are still connected (the departed host is gone, and peer-leave fired before we became host)
    const players = [...s.players.values()].filter((p) => p.id === this.net.myId || this.net.peers.get(p.id)?.announced).map((p) => ({ id: p.id, name: p.name, colorIdx: p.colorIdx, slot: p.slot }));
    this.host = new HostGame({ net: this.net, requestLevel: (id) => this.requestLevel(id), minPlayers: this.dev ? 1 : NET.MIN_PLAYERS, initialPlayers: players, settings: s.settings });
    this.hud.toast(wasInGame ? 'The host left — round ended in a draw. You are the new host.' : 'You are the new host.', 6000);
    this.host.toLobby();
  }

  leave() { clearInterval(this.hostTimer); this.net?.destroy(); location.reload(); }

  async enableMic() {
    const ok = await this.voice.enableMic();
    this.lobbyPanel.setMic(ok ? 'on' : 'denied');
    if (!ok) this.hud.toast('Microphone blocked — the game is fully playable with text chat (T).', 6000);
  }

  // ------------------------------------------------------------------ levels
  requestLevel(id) {
    if (this.level && this.levelId === id) return this.level;
    if (this.level) this.level.dispose();
    for (const b of this.bodies.values()) { this.scene.remove(b.group); b.dispose(); }
    this.bodies.clear();
    const data = getLevel(id);
    this.level = new LevelBuilder(this.scene, data).build();
    this.levelId = id;
    this.scene.background = new THREE.Color(data.background ?? 0x05070c);
    if (this.localPlayer) this.localPlayer.setWorld(this.level.collision, this.level);
    if (this.voice) this.voice.setCollision(this.level.collision);
    for (const r of this.remotes.values()) r.interp.clear();
    this.sound.music.setBed(data.ambience?.bedTrack || 'ambient-space');
    this._lastZone = null;
    return this.level;
  }

  // ------------------------------------------------------------------ network routing
  onEvt(from, msg) {
    if (CLIENT_TO_HOST.has(msg.t)) { if (this.host) this.host.handle(from, msg); return; }
    this.client.handle(from, msg);
  }

  onNet(from, buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 2) return;
    const type = new Uint8Array(buf)[0];
    if (type === BIN.INPUT) { if (this.host) this.host.onInputs(from, decodeInputs(buf)); return; }
    if (type === BIN.SNAPSHOT) { if (from !== this.net.hostId) return; this.applySnapshot(decodeSnapshot(buf)); }
  }

  applySnapshot(snap) {
    const now = performance.now();
    const s = this.client.state;
    for (const rec of snap.players) {
      if (rec.slot === s.mySlot) { this.localPlayer.predictor.reconcile(rec, rec.ackTick); this.myFlags = rec.flags; continue; }
      const r = this.ensureRemote(rec.slot);
      if (r) r.pushSnapshot(rec, now);
    }
  }

  ensureRemote(slot) {
    let r = this.remotes.get(slot);
    if (r) return r;
    const info = this.client.state.players.get(slot);
    if (!info) return null;
    r = new RemotePlayer(slot, COLORS[info.colorIdx]?.hex || 0xffffff, info.name, this.scene);
    this.remotes.set(slot, r);
    this.voice.bindObject(info.id, r.view.group);
    return r;
  }

  syncRemotes() {
    const s = this.client.state;
    for (const [slot, r] of [...this.remotes]) if (!s.players.has(slot)) { r.dispose(); this.remotes.delete(slot); }
    for (const p of s.players.values()) {
      if (p.slot === s.mySlot) { this.localPlayer.view.setColor(COLORS[p.colorIdx].hex); this.localPlayer.view.setName(p.name); continue; }
      const r = this.ensureRemote(p.slot);
      if (r) { r.setInfo(COLORS[p.colorIdx].hex, p.name); this.voice.bindObject(p.id, r.view.group); }
    }
    this._updateFactions();
  }

  _updateFactions() {
    const s = this.client.state;
    const ghosts = [...s.players.values()].filter((p) => p.alive === false).map((p) => p.id);
    this.voice.setFactions({ iAmGhost: this.client.isGhost, ghostPeerIds: ghosts });
  }

  // ------------------------------------------------------------------ client events
  _wireClient() {
    const c = this.client, s = c.state;
    c.on('lobby', () => { this.syncRemotes(); this._refreshLobby(); });
    c.on('change', () => { this._updateFactions(); if (this.playerList.visible) this._refreshPlayerList(); });
    c.on('error', (m) => { this.hud.toast(m.message || m.code, 5000); if (m.code === 'IN_PROGRESS' || m.code === 'FULL') { this.menu.show(); this.menu.setError(m.message); } });
    c.on('playerLeft', (m) => { const r = this.remotes.get(m.slot); if (r) { r.dispose(); this.remotes.delete(m.slot); } this.hud.toast(`${m.name} left.`); });
    c.on('teleport', (m) => {
      if (m.slot === s.mySlot) { this.localPlayer.teleport(m.x, m.y, m.z, m.yaw); if (this.minigame && s.phase === 'ROUND') this.closeMinigame(); }
      else this.remotes.get(m.slot)?.teleport(m.x, m.y, m.z, m.yaw);
    });
    c.on('gameStart', ({ levelId }) => {
      this.closeMinigame();
      this.meeting.hide();
      this.requestLevel(levelId);
      this.lobbyPanel.hide();
      this.hud.setBlackout(true);
      this.hud.hideVent(); this.hud.hideSabotageMenu();
      this.sound.music.setIntensity(2);
      this.voice.setMode('proximity');
      this.myFlags = FLAG.ALIVE;
    });
    c.on('role', ({ role, impostors }) => {
      const names = impostors.filter((sl) => sl !== s.mySlot).map((sl) => s.players.get(sl)?.name).filter(Boolean);
      const sub = role === 'impostor' ? (names.length ? 'Fellow impostor' + (names.length > 1 ? 's' : '') + ': ' + names.join(', ') : 'You are alone. Kill, sabotage, vent, fake tasks.') : 'Complete tasks. Find the impostor' + (s.players.size >= 7 ? 's' : '') + '.';
      this.hud.showCenter(role === 'impostor' ? 'Impostor' : 'Crewmate', sub, role, 5500);
      this.sound.play('roleReveal', { impostor: role === 'impostor' });
      this._refreshTasks();
      this.hud.showTasks(true);
    });
    c.on('phase', ({ phase, levelId }) => {
      if (phase === 'LOBBY') {
        this.closeMinigame(); this.meeting.hide(); this.hud.hideCenter(); this.hud.hideVent(); this.hud.hideSabotageMenu();
        this.requestLevel(levelId || 'lobby');
        this.hud.setBlackout(false); this.hud.showTasks(false); this.hud.setSabotage(null);
        this.sound.stopLoop('alarm'); this.sound.music.setIntensity(1);
        this.voice.setComms(false); this.voice.setMode('proximity');
        this.lobbyPanel.show();
        this.myFlags = FLAG.ALIVE;
        this._refreshLobby();
      } else if (phase === 'ROUND') {
        this.hud.setBlackout(false);
        this.meeting.hide();
        this.voice.setMode('proximity');
        this.sound.music.setIntensity(s.sabotage ? 4 : 2);
        if (this._canLock()) this.localPlayer.requestPointerLock(this.canvas);
      } else if (phase === 'GAME_OVER') {
        this.closeMinigame(); this.meeting.hide(); this.hud.hideVent(); this.hud.hideSabotageMenu();
        this.sound.stopLoop('alarm');
        this.voice.setMode('direct'); this.voice.setComms(false);
      }
      this._refreshActions();
    });
    c.on('kill', (m) => {
      this.flashColor.set(0xff0000);
      const body = m.body;
      const b = new DeadBody(body.id, body.slot, COLORS[body.colorIdx]?.hex || 0xff0000, body, body.yaw);
      this.scene.add(b.group);
      this.bodies.set(body.id, b);
      if (m.victim === s.mySlot) {
        this.flash = 1;
        this.sound.play('kill');
        this.hud.showCenter('You were killed', 'You are a ghost now. Finish your tasks — the living cannot hear you.', 'impostor', 5000);
        this.closeMinigame();
        this._updateFactions();
      } else if (m.killer === s.mySlot) {
        this.localPlayer.killPunch();
        this.sound.play('kill', { volume: 0.7 });
      } else {
        this.sound.playAt('kill', body.x, body.y, body.z, { maxDistance: 14, volume: 0.6 });
      }
      this._refreshPlayerList();
    });
    c.on('killCooldown', () => this._refreshActions());
    c.on('meetingStart', (m) => {
      this.closeMinigame();
      this.hud.hideVent(); this.hud.hideSabotageMenu();
      for (const b of this.bodies.values()) { this.scene.remove(b.group); b.dispose(); }
      this.bodies.clear();
      this.sound.play(m.bodySlot !== null && m.bodySlot !== undefined ? 'report' : 'emergency');
      this.voice.setMode('direct');
      this.localPlayer.releasePointerLock();
      this.meeting.show(s);
      this._updateFactions();
    });
    c.on('meetingPhase', () => this.meeting.update(s, c.hostNow()));
    c.on('voteCast', () => { this.sound.play('voteCast'); this.meeting.update(s, c.hostNow()); });
    c.on('voteResult', (m) => {
      this.meeting.update(s, c.hostNow());
      if (m.ejected !== null && m.ejected !== undefined) {
        this.sound.play('eject');
        if (m.ejected === s.mySlot) { this.hud.toast('You were ejected. You are a ghost now.', 6000); this._updateFactions(); }
      }
    });
    c.on('taskProgress', () => this._refreshTasks());
    c.on('taskAck', (m) => { this.sound.play(m.done ? 'taskComplete' : 'ping'); this._refreshTasks(); if (!m.done) this.hud.toast('Now go to the download station.'); });
    c.on('sabotageStart', (sab) => {
      const def = SABOTAGES[sab.type];
      if (sab.type === 'wormhole') {
        this.closeMinigame();
        this.flashColor.set(0x3fa7ff); this.flash = 1;
        this.sound.play('vent'); this.sound.play('eject', { volume: 0.4 });
        this.hud.showCenter('Wormhole', 'Everyone has been scattered across the map.', 'crew', 3500);
        return;
      }
      this.hud.toast(`<b>${def.label} sabotaged!</b> ${def.description}`, 5000);
      if (def.critical) this.sound.startLoop('alarm', 'sabotageAlarm'); else this.sound.play('door');
      if (sab.type === 'comms') this.voice.setComms(true);
      this.sound.music.setIntensity(4);
      this._refreshTasks();
    });
    c.on('sabotageUpdate', () => { if (this.minigame?.kind === 'fix' && this.minigame.type === 'o2' && s.sabotage?.fixed[this.minigame.index]) { this.hud.toast('Filter restored.'); this.closeMinigame(); } });
    c.on('sabotageEnd', (m) => {
      this.sound.stopLoop('alarm');
      this.voice.setComms(false);
      this.sound.music.setIntensity(2);
      if (m.fixed && !SABOTAGES[m.type].instant) { this.sound.play('taskComplete'); this.hud.toast(`${SABOTAGES[m.type].label} restored.`); }
      if (this.minigame?.kind === 'fix') this.closeMinigame();
      this._refreshTasks();
    });
    c.on('doors', (closed) => {
      let changed = false;
      for (const d of this.level.doors) { const want = closed.has(d.id); if (want !== d.closed) { this.level.setDoor(d.id, want); changed = true; if (want) this.sound.playAt('door', d.pos[0], d.pos[1], d.pos[2]); } }
      if (changed && closed.size) this.hud.toast('Doors sealed.');
    });
    c.on('ventState', (m) => {
      this.sound.play('vent');
      if (m.venting) {
        this.localPlayer.releasePointerLock();
        this.hud.showVent(m.connects, (id) => { const v = this.level.vents.find((x) => x.id === id); const z = v ? this.level.zoneAt(v.pos[0], v.pos[1] + 0.5, v.pos[2]) : null; return z ? z.name : id; });
      } else { this.hud.hideVent(); if (this._canLock()) this.localPlayer.requestPointerLock(this.canvas); }
    });
    c.on('flare', () => { this.level.flare(); this.sound.play('flare'); });
    c.on('stationGlow', (m) => this.level.setStationGlow(m.stationId, m.on));
    c.on('chat', (m) => {
      const p = s.players.get(m.slot);
      if (!p) return;
      this.hud.addChat(p.name, p.colorIdx, m.text, m.ghost);
      if (this.meeting.visible) this.meeting.addChat(p.name, p.colorIdx, m.text, m.ghost);
      this.sound.play('click');
    });
    c.on('gameEnd', (m) => {
      const iWon = (m.winner === 'impostor') === (s.myRole === 'impostor');
      const big = m.winner === 'crew' ? 'Crew wins' : m.winner === 'impostor' ? 'Impostors win' : 'Draw';
      const imps = Object.entries(m.roles || {}).filter(([, r]) => r === 'impostor').map(([sl]) => s.players.get(Number(sl))?.name).filter(Boolean);
      this.hud.showCenter(big, `${m.reason || ''}<br>Impostor${imps.length === 1 ? '' : 's'}: ${imps.join(', ') || '—'}<br>Back to the lobby in a moment.`, m.winner === 'impostor' ? 'impostor' : 'crew', RULES.GAME_OVER_MS);
      this.sound.play('stinger', { win: iWon });
      this.hud.setSabotage(null);
      this._refreshPlayerList();
    });
  }

  _refreshLobby() {
    const s = this.client.state;
    this.lobbyPanel.update(s, this.net.isHost, (p) => this._speaking(p));
    this.syncRemotes();
  }
  _refreshTasks() {
    const s = this.client.state;
    this.hud.setTasks(s.tasks, { hidden: s.sabotage?.type === 'comms', impostor: s.myRole === 'impostor', progress: s.taskProgress });
  }
  _speaking(p) { return p.slot === this.client.state.mySlot ? this.voice.localSpeaking : this.voice.isSpeaking(p.id); }
  _refreshPlayerList() {
    if (!this.playerList.visible) return;
    const s = this.client.state;
    const ghost = this.client.isGhost;
    this.playerList.update(s, {
      speakingFn: (p) => this._speaking(p),
      deadFn: (p) => (ghost || s.phase === 'GAME_OVER' ? p.alive === false : s.knownDead.has(p.slot)),
      volumeFn: (p) => this.voice.getVolume(p.id),
      mutedFn: (p) => this.voice.isMuted(p.id),
      roles: s.phase === 'GAME_OVER' ? s.endRoles : null,
    });
  }

  // ------------------------------------------------------------------ input
  _typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); }
  _overlayOpen() { return !!this.minigame || this.meeting.visible || this.settings.visible || !this.hud.ventEl.hidden; }
  _canLock() { return this.net && !this._overlayOpen() && !this.menu.root.hidden === false; }

  onKeyDown(e) {
    if (!this.net || this._typing()) return;
    switch (e.code) {
      case 'KeyE': this.action('use'); break;
      case 'KeyR': this.action('report'); break;
      case 'KeyQ': this.action('kill'); break;
      case 'KeyF': this.action('vent'); break;
      case 'KeyC': this.action('sabotage'); break;
      case 'KeyT': if (!this.minigame) { e.preventDefault(); this.localPlayer.releasePointerLock(); this.hud.focusChat(); } break;
      case 'KeyV': this.voice.setPttDown(true); break;
      case 'KeyM': this.voice.micMuted = !this.voice.micMuted; this.voice.setPushToTalk(this.voice.micMuted ? true : this.local.pushToTalk); this.hud.toast(this.voice.micMuted ? 'Mic muted' : 'Mic on'); break;
      case 'Tab': e.preventDefault(); if (!this.playerList.visible) { this.playerList.show(); this._refreshPlayerList(); } break;
      case 'Escape':
        if (this.minigame) this.closeMinigame();
        else if (this.hud.sabotageMenuOpen) this.hud.hideSabotageMenu();
        else if (this.settings.visible) { this.settings.hide(); this.localPlayer.requestPointerLock(this.canvas); }
        else if (!document.pointerLockElement && !this.meeting.visible) this.settings.show();
        break;
      default:
    }
  }
  onKeyUp(e) {
    if (!this.net) return;
    if (e.code === 'KeyV') this.voice?.setPttDown(false);
    if (e.code === 'Tab') this.playerList.hide();
  }

  action(name) {
    const c = this.client; if (!c) return;
    const s = c.state, I = this.interact;
    if (name === 'lock') { this.localPlayer.requestPointerLock(this.canvas); return; }
    if (this.minigame || this.meeting.visible) return;
    switch (name) {
      case 'use':
        if (I.use?.type === 'task') this.openTaskMinigame(I.use.task, I.use.station);
        else if (I.use?.type === 'fix') this.openFixMinigame(I.use.station);
        else if (I.use?.type === 'emergency') c.emergencyMeeting();
        break;
      case 'report': if (I.report) c.reportBody(I.report.id); break;
      case 'kill': if (I.kill && s.myRole === 'impostor') { c.killAttempt(I.kill.slot); this.localPlayer.killPunch(); } break;
      case 'vent': if (s.venting) c.ventExit(); else if (I.vent) c.ventEnter(I.vent.id); break;
      case 'sabotage':
        if (s.myRole !== 'impostor' || s.phase !== 'ROUND') return;
        if (this.hud.sabotageMenuOpen) { this.hud.hideSabotageMenu(); this.localPlayer.requestPointerLock(this.canvas); }
        else {
          this.localPlayer.releasePointerLock();
          this.hud.showSabotageMenu(s, c.hostNow());
        }
        break;
      default:
    }
  }

  // ------------------------------------------------------------------ minigames
  _mountMinigame(def, api, meta) {
    this.closeMinigame();
    clear(this.minigameRoot);
    const inner = el('div', {});
    const card = el('div', { class: 'panel card' }, el('div', { class: 'mg-head' }, el('h3', {}, def.label), el('span', { class: 'dim small' }, 'Esc to close'), el('button', { class: 'iconbtn', title: 'Close', onClick: () => this.closeMinigame() }, icon('close'))), inner);
    this.minigameRoot.appendChild(card);
    this.minigameRoot.hidden = false;
    this.localPlayer.releasePointerLock();
    this.localPlayer.inMinigame = true;
    this.minigame = { def, ...meta };
    def.mount(inner, api);
  }

  openTaskMinigame(task, station) {
    const s = this.client.state;
    const def = getMinigame(task.minigame);
    if (!def) return;
    const isCrew = s.myRole === 'crew';
    if (station.visual && isCrew) this.client.minigameState(station.id, true);
    this._mountMinigame(def, {
      difficulty: difficultyFor(s.players.size),
      params: { step: task.step, micRms: () => this.voice.localRms, micEnabled: () => this.voice.micEnabled },
      onComplete: () => {
        if (isCrew) this.client.taskComplete(task.id, station.id);
        else { this.sound.play('ping'); this.hud.toast('Task faked. The bar did not move.'); }
        this.closeMinigame();
      },
      onFail: () => { this.sound.play('taskFail'); this.hud.toast('Failed — try again.'); this.closeMinigame(); },
    }, { kind: 'task', task, station });
  }

  openFixMinigame(station) {
    const s = this.client.state, sab = s.sabotage;
    if (!sab || sab.type !== station.type) return;
    const idx = station.index || 0;
    const common = { difficulty: 1 };
    if (sab.type === 'lights' || sab.type === 'comms') {
      this._mountMinigame(getMinigame(sab.type === 'lights' ? 'lightsFix' : 'commsFix'), { ...common, onComplete: () => { this.client.sabotageFix(sab.type, idx); this.closeMinigame(); } }, { kind: 'fix', type: sab.type, index: idx, station });
    } else if (sab.type === 'reactor') {
      this._mountMinigame(getMinigame('reactorHold'), { ...common, params: { onHold: (h) => this.client.sabotageFix('reactor', idx, { holding: h }), otherHeld: () => !!s.sabotage?.holds?.[1 - idx] } }, { kind: 'fix', type: 'reactor', index: idx, station });
    } else if (sab.type === 'o2') {
      this._mountMinigame(getMinigame('o2Code'), { ...common, params: { hint: 'Filter ' + (idx === 0 ? 'A' : 'B') }, onComplete: (code) => { this.client.sabotageFix('o2', idx, { code }); this.sound.play('click'); } }, { kind: 'fix', type: 'o2', index: idx, station });
    }
  }

  closeMinigame() {
    if (!this.minigame) return;
    const m = this.minigame;
    try { m.def.unmount(); } catch (e) { /* ignore */ }
    this.minigame = null;
    this.minigameRoot.hidden = true;
    clear(this.minigameRoot);
    if (this.localPlayer) this.localPlayer.inMinigame = false;
    if (m.kind === 'task' && m.station.visual && this.client.state.myRole === 'crew') this.client.minigameState(m.station.id, false);
    if (this._canLock() && !this.meeting.visible) this.localPlayer.requestPointerLock(this.canvas);
  }

  // ------------------------------------------------------------------ interaction scan
  scanInteractions() {
    const c = this.client, s = c.state, I = this.interact;
    I.use = null; I.report = null; I.kill = null; I.vent = null;
    if (s.phase !== 'ROUND' || s.venting) return;
    const me = this.localPlayer.state;
    const alive = !c.isGhost;
    const imp = s.myRole === 'impostor';
    // sabotage fix panels first
    if (s.sabotage && alive && SABOTAGES[s.sabotage.type].fixStations > 0) {
      let best = null, bd = RULES.USE_RANGE;
      for (const st of this.level.sabotageStations) {
        if (st.type !== s.sabotage.type) continue;
        if (s.sabotage.type === 'o2' && s.sabotage.fixed[st.index || 0]) continue;
        const d = distP(me, st.pos);
        if (d < bd) { bd = d; best = st; }
      }
      if (best) I.use = { type: 'fix', station: best, label: `Fix ${SABOTAGES[s.sabotage.type].label}` };
    }
    // tasks (crew, alive or ghost) / fake tasks (impostor)
    if (!I.use && !(s.sabotage?.type === 'comms' && !imp)) {
      let best = null, bd = RULES.USE_RANGE;
      if (imp) {
        for (const st of this.level.stations) { if (st.downloadOnly) continue; const d = distP(me, st.pos); if (d < bd) { bd = d; best = { task: { id: 'fake', minigame: st.minigame, step: 0, steps: [st.id], label: st.label }, station: st }; } }
      } else {
        for (const t of s.tasks) {
          if (t.done) continue;
          const stId = currentStation(t);
          const st = this.level.stations.find((x) => x.id === stId);
          if (!st) continue;
          const d = distP(me, st.pos);
          if (d < bd) { bd = d; best = { task: t, station: st }; }
        }
      }
      if (best) I.use = { type: 'task', task: best.task, station: best.station, label: best.task.label };
    }
    // emergency button
    if (!I.use && alive && s.emergencies > 0 && !(s.sabotage && SABOTAGES[s.sabotage.type].critical)) {
      if (distP(me, this.level.meetingTable) < RULES.MEETING_BUTTON_RANGE + 1.6) I.use = { type: 'emergency', label: `Call emergency meeting (${s.emergencies} left)` };
    }
    // bodies
    if (alive) {
      let bd = RULES.REPORT_RANGE;
      for (const b of this.bodies.values()) { const d = dist3(me, b.pos); if (d < bd) { bd = d; I.report = b; } }
    }
    // vents
    if (alive) {
      let bd = RULES.VENT_RANGE;
      for (const v of this.level.vents) { if (!imp && !v.public) continue; const d = distP(me, v.pos); if (d < bd) { bd = d; I.vent = v; } }
    }
    // kill target: nearest alive crew in range and roughly in front
    if (imp && alive) {
      let bd = RULES.KILL_RANGE;
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
      for (const r of this.remotes.values()) {
        if (r.ghost || r.venting || r.culled) continue;
        const p = s.players.get(r.slot);
        if (!p || p.alive === false) continue;
        const d = dist3(me, r.pos);
        if (d > bd) continue;
        const dx = r.pos.x - me.x, dz = r.pos.z - me.z, len = Math.hypot(dx, dz) || 1;
        if ((dx * fx + dz * fz) / len < -0.2) continue;
        bd = d; I.kill = r;
      }
    }
  }

  _refreshActions() {
    const c = this.client; if (!c) return;
    const s = c.state, I = this.interact;
    const imp = s.myRole === 'impostor', round = s.phase === 'ROUND', alive = !c.isGhost;
    const cd = Math.max(0, s.killCooldownEnd - c.hostNow());
    this.hud.setActions({
      use: { visible: round, enabled: !!I.use },
      report: { visible: round && alive, enabled: !!I.report },
      kill: { visible: round && imp && alive, enabled: !!I.kill && cd <= 0, cooldownMs: cd },
      vent: { visible: round && alive && (imp || s.venting || !!I.vent), enabled: !!I.vent || s.venting },
      sabotage: { visible: round && imp, enabled: true },
    });
    let prompt = null;
    if (round && !this.minigame && !s.venting) {
      if (I.use) prompt = `<kbd>E</kbd> ${I.use.label}`;
      else if (I.report) prompt = '<kbd>R</kbd> Report body';
      else if (I.vent) prompt = '<kbd>F</kbd> Enter vent';
      else if (I.kill && cd <= 0) prompt = `<kbd>Q</kbd> Kill ${s.players.get(I.kill.slot)?.name || ''}`;
      if (I.report && I.use) prompt += ' · <kbd>R</kbd> Report body';
    }
    this.hud.setPrompt(prompt);
    this.hud.setLockHint(!!this.net && !document.pointerLockElement && !this._overlayOpen() && !this.hud.chatFocused && !this.playerList.visible);
  }

  // Guidance arrows toward the panels that fix a critical sabotage. Hidden once you are in that room.
  _sabotageArrows(myZone) {
    const s = this.client.state, sab = s.sabotage;
    if (!sab || s.phase !== 'ROUND' || (sab.type !== 'reactor' && sab.type !== 'o2')) return null;
    const me = this.localPlayer.state, yaw = this.localPlayer.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const out = [];
    for (const st of this.level.sabotageStations) {
      if (st.type !== sab.type) continue;
      const idx = st.index || 0;
      if (sab.type === 'o2' && sab.fixed[idx]) continue;
      if (sab.type === 'reactor' && sab.holds[idx]) continue;
      const stZone = this.level.zoneAt(st.pos[0], st.pos[1] + 0.5, st.pos[2]);
      if (stZone && myZone && stZone === myZone) continue;
      const dx = st.pos[0] - me.x, dz = st.pos[2] - me.z;
      out.push({ label: `${st.label}${stZone ? ' · ' + stZone.name : ''}`, angle: Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz), dist: Math.hypot(dx, dz) });
    }
    return out;
  }

  visionRadius() {
    const s = this.client.state;
    if (this.client.isGhost) return 1000;
    if (s.phase === 'LOBBY' || s.phase === 'GAME_OVER' || s.phase === 'MEETING') return 60;
    const imp = s.myRole === 'impostor';
    let r = imp ? s.settings.impostorVisionRadius : s.settings.crewVisionRadius;
    if (s.sabotage?.type === 'lights' && !imp) r = RULES.LIGHTS_VISION;
    const z = this._zone;
    if (z && z.visionScale && z.visionScale !== 1) r *= z.visionScale;
    return r;
  }

  // ------------------------------------------------------------------ frame
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.max(0, Math.min(0.1, (t - this.lastT) / 1000));
    this.lastT = Math.max(this.lastT, t);
    if (!this.net || !this.client || !this.localPlayer) { this.renderer.setRenderTarget(null); this.renderer.clear(); return; }
    const c = this.client, s = c.state, lp = this.localPlayer;
    const now = performance.now();
    const hostNow = c.hostNow();

    // movement context (must match the host's rule)
    lp.setContext({ phase: s.phase, alive: !c.isGhost, venting: s.venting });
    lp.setSpeedMul(s.settings.moveSpeed || 1);
    lp.moveEnabled = !this.minigame && !this.settings.visible && !this.hud.chatFocused && !this.meeting.visible && !this.hud.sabotageMenuOpen;
    lp.inputEnabled = !this.minigame && !this.meeting.visible;
    lp.speaking = this.voice.localSpeaking;
    lp.update(dt);
    if (this.host) this.host.update(now);

    // zone / reverb / vision
    const me = lp.state;
    const zone = this.level.zoneAt(me.x, me.y + 0.5, me.z);
    if (zone !== this._zone) { this._zone = zone; this.sound.setRoomReverb(zone?.reverb || this.level.data.ambience?.reverb || 'small-room'); }
    const radius = this.visionRadius();
    const viewerIsGhost = c.isGhost;
    const lightsOut = s.sabotage?.type === 'lights' && s.myRole !== 'impostor';

    // remote players
    const camPos = this.camera.position;
    const peerPos = new Map();
    let nearAlive = false;
    for (const r of this.remotes.values()) {
      const info = s.players.get(r.slot);
      const speaking = info ? this.voice.isSpeaking(info.id) : false;
      const d = r.update(dt, now, camPos, { visionRadius: radius, viewerIsGhost, lightsOut, speaking });
      if (info) peerPos.set(info.id, [r.pos.x, r.pos.y, r.pos.z]);
      if (!r.ghost && !r.venting && d < RULES.VULNERABLE_RANGE && r.slot !== s.mySlot) nearAlive = true;
      // remote footsteps
      if ((r.flags & FLAG.MOVING) && !r.ghost && r.view.group.visible) {
        const acc = this.stepAcc.get(r.slot) || { x: r.pos.x, z: r.pos.z, d: 0 };
        acc.d += Math.hypot(r.pos.x - acc.x, r.pos.z - acc.z); acc.x = r.pos.x; acc.z = r.pos.z;
        if (acc.d > ((r.flags & FLAG.SPRINTING) ? 2.2 : 1.7)) { acc.d = 0; this.sound.playAt('footstep', r.pos.x, r.pos.y, r.pos.z, { surface: this.level.collision.surfaceAt(r.pos.x, r.pos.y, r.pos.z), sprint: !!(r.flags & FLAG.SPRINTING), volume: 0.3, maxDistance: 16 }); }
        this.stepAcc.set(r.slot, acc);
      }
    }
    this.pulse += ((this.minigame && nearAlive && !viewerIsGhost ? 1 : 0) - this.pulse) * Math.min(1, dt * 6);
    this.hud.setVignette(this.minigame && nearAlive && !viewerIsGhost);

    // voice / audio listener
    this.voice.update(dt, [camPos.x, camPos.y, camPos.z], peerPos);
    this.sound.setListener(camPos.x, camPos.y, camPos.z, lp.yaw);
    this.hud.setMic(this.voice.micEnabled ? 'on' : this.voice.micDenied ? 'denied' : 'off', this.voice.localSpeaking);

    // level dynamics + culling
    this.level.update(dt, hostNow);
    this.level.cull(camPos, radius);
    this.level.setVentHighlight(s.myRole === 'impostor' && s.phase === 'ROUND');
    for (const b of this.bodies.values()) b.group.visible = viewerIsGhost || dist3(camPos, b.pos) < radius + 1;

    // interaction + HUD
    this.scanInteractions();
    this._refreshActions();
    if (s.sabotage) this.hud.setSabotage(s.sabotage, hostNow); else this.hud.setBanner(s.phase === 'ROLE_ASSIGN' ? 'Assigning roles…' : null);
    this.hud.setArrows(this._sabotageArrows(zone));
    this.hud.setSabotageCooldown({
      visible: s.phase === 'ROUND',
      ms: s.sabotageCooldownEnd - hostNow,
      active: !!s.sabotage,
      remaining: SABOTAGE_ORDER.length - (s.usedSabotages || []).length,
    });
    if (this.meeting.visible) this.meeting.update(s, hostNow);
    if (this.lobbyPanel.root.hidden === false && (t | 0) % 30 === 0) this.lobbyPanel.update(s, this.net.isHost, (p) => this._speaking(p));
    if (this.playerList.visible && (t | 0) % 20 === 0) this._refreshPlayerList();

    // reactor countdown beeps
    if (s.sabotage?.endsAt) {
      const left = (s.sabotage.endsAt - hostNow) / 1000;
      const rate = left < 10 ? 0.25 : left < 25 ? 0.5 : 1;
      this._beepT = (this._beepT || 0) + dt;
      if (this._beepT > rate) { this._beepT = 0; this.sound.play('countdownBeep', { progress: 1 - left / RULES.CRITICAL_SABOTAGE_TIME, volume: 0.25 }); }
    }

    // render
    this.flash = Math.max(0, this.flash - dt * 1.5);
    this.vision.render(this.scene, this.camera, { radius, pulse: this.pulse, flash: this.flash * 0.6, flashColor: this.flashColor, fogColor: this.level.data.fogColor ?? 0x3a414a, time: t / 1000, skyDark: viewerIsGhost ? 0 : 0.55 });
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.hud.setStats({ fps: Math.round(this.fpsN / this.fpsAcc), draws: this.vision.drawCalls || 0, ping: this.net.isHost ? 0 : this.net.rtt(this.net.hostId) }); this.fpsAcc = 0; this.fpsN = 0; }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  window.suspect = app;
  // Dev helpers: ?dev&host=1&room=CODE&name=X  or  ?dev&join=CODE&name=X ; step(n) drives frames when the tab is hidden.
  const q = new URLSearchParams(location.search);
  if (app.dev) {
    window.step = async (n, dtms = 33) => { for (let i = 0; i < n; i++) { app.loop(performance.now()); await new Promise((r) => setTimeout(r, dtms)); } };
    const name = q.get('name') || 'Dev';
    const color = Number(q.get('color') || 0);
    if (q.has('host')) app.createRoom(name, color, q.get('room')).catch((e) => app.menu.setError(e.message));
    else if (q.get('join')) app.joinRoom(q.get('join'), name, color).catch((e) => app.menu.setError(e.message));
  }
});
