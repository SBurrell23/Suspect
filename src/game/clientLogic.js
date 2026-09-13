// Mirrors host messages into a local view of the game and emits UI/world events.
import { MSG } from '../net/protocol.js';
import { GAME_DEFAULTS } from '../config.js';

export class ClientGame {
  constructor(net) {
    this.net = net;
    this.listeners = new Map();
    this.offset = 0;
    this.reset();
  }

  reset() {
    this.state = {
      phase: 'LOBBY',
      players: new Map(),
      mySlot: -1,
      myRole: null,
      impostors: [],
      settings: { ...GAME_DEFAULTS },
      levelId: 'lobby',
      tasks: [],
      taskProgress: { done: 0, total: 0 },
      bodies: [],
      meeting: null,
      sabotage: null,
      sabotageCooldownEnd: 0,
      doorsClosed: new Set(),
      killCooldownEnd: 0,
      emergencies: 0,
      venting: false,
      ventId: null,
      ventConnects: [],
      winner: null,
      endRoles: null,
      knownDead: new Set(),
      chat: [],
      minPlayers: 4,
      hostSlot: -1,
      roundAt: 0,
    };
  }

  on(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev).add(fn);
    return () => this.listeners.get(ev).delete(fn);
  }
  emit(ev, payload) {
    const hs = this.listeners.get(ev);
    if (hs) for (const h of hs) { try { h(payload); } catch (e) { console.error('client handler', ev, e); } }
    const all = this.listeners.get('*');
    if (all) for (const h of all) { try { h(ev, payload); } catch (e) { console.error('client handler *', ev, e); } }
  }

  hostNow() { return Date.now() + this.offset; }
  _sync(msg) { if (typeof msg.hostTime === 'number') this.offset = msg.hostTime - Date.now(); }

  get me() { return this.state.players.get(this.state.mySlot) || null; }
  get isGhost() { const m = this.me; return !!(m && m.alive === false); }
  get isImpostor() { return this.state.myRole === 'impostor'; }
  player(slot) { return this.state.players.get(slot); }

  handle(from, msg) {
    if (from !== this.net.hostId && from !== this.net.myId) return; // only the host speaks
    if (from === this.net.myId && !this.net.isHost) return;
    const s = this.state;
    this._sync(msg);
    switch (msg.t) {
      case MSG.ROSTER:
        if (typeof msg.yourSlot === 'number') s.mySlot = msg.yourSlot;
        return;
      case MSG.ERROR: this.emit('error', msg); return;
      case MSG.LOBBY_STATE: {
        const next = new Map();
        for (const p of msg.players) {
          const prev = s.players.get(p.slot);
          next.set(p.slot, { ...prev, ...p, alive: prev ? prev.alive : true });
          if (p.id === this.net.myId) s.mySlot = p.slot;
          if (p.isHost) s.hostSlot = p.slot;
        }
        s.players = next;
        s.settings = { ...s.settings, ...msg.settings };
        s.minPlayers = msg.minPlayers ?? s.minPlayers;
        if (msg.phase === 'LOBBY') { s.phase = 'LOBBY'; s.levelId = msg.levelId || 'lobby'; s.myRole = null; s.tasks = []; s.knownDead.clear(); for (const p of s.players.values()) p.alive = true; }
        this.emit('lobby', s);
        break;
      }
      case MSG.PLAYER_LEFT: {
        s.players.delete(msg.slot);
        this.emit('playerLeft', msg);
        break;
      }
      case MSG.PHASE: {
        s.phase = msg.phase;
        if (msg.levelId) s.levelId = msg.levelId;
        if (msg.phase === 'LOBBY') {
          s.myRole = null; s.impostors = []; s.tasks = []; s.bodies = []; s.meeting = null; s.sabotage = null;
          s.doorsClosed.clear(); s.venting = false; s.winner = null; s.endRoles = null; s.knownDead.clear();
          for (const p of s.players.values()) p.alive = true;
        }
        if (msg.phase === 'ROUND') s.meeting = null;
        this.emit('phase', { phase: msg.phase, levelId: s.levelId });
        break;
      }
      case MSG.GAME_START: {
        s.phase = 'ROLE_ASSIGN';
        s.levelId = msg.levelId;
        s.settings = { ...s.settings, ...msg.settings };
        s.bodies = []; s.meeting = null; s.sabotage = null; s.doorsClosed.clear(); s.venting = false; s.winner = null; s.endRoles = null;
        s.knownDead.clear();
        s.taskProgress = { done: 0, total: msg.tasksTotal || 0 };
        s.roundAt = msg.roundAt;
        for (const p of s.players.values()) p.alive = true;
        this.emit('gameStart', { levelId: msg.levelId, roundAt: msg.roundAt });
        this.emit('phase', { phase: 'ROLE_ASSIGN', levelId: s.levelId });
        break;
      }
      case MSG.ROLE_ASSIGN: {
        s.myRole = msg.role;
        s.impostors = msg.impostors || [];
        s.tasks = msg.tasks || [];
        s.killCooldownEnd = msg.killCooldownEnd || 0;
        s.emergencies = msg.emergencies ?? 0;
        this.emit('role', { role: msg.role, impostors: s.impostors, tasks: s.tasks });
        break;
      }
      case MSG.TELEPORT: this.emit('teleport', msg); break;
      case MSG.KILL_CONFIRMED: {
        const v = s.players.get(msg.victim);
        if (v) v.alive = false;
        s.bodies.push(msg.body);
        if (msg.victim === s.mySlot || this.isGhost) s.knownDead.add(msg.victim);
        this.emit('kill', msg);
        break;
      }
      case MSG.KILL_COOLDOWN: s.killCooldownEnd = msg.killCooldownEnd; this.emit('killCooldown', msg); break;
      case MSG.MEETING_START: {
        s.phase = 'MEETING';
        s.bodies = [];
        s.venting = false;
        for (const d of msg.dead || []) { s.knownDead.add(d); const p = s.players.get(d); if (p) p.alive = false; }
        if (msg.reporter === s.mySlot && typeof msg.emergencies === 'number') s.emergencies = msg.emergencies;
        s.meeting = { phase: 'DISCUSS', endsAt: msg.endsAt, reporter: msg.reporter, bodySlot: msg.bodySlot, voted: new Set(), myVote: undefined, result: null };
        this.emit('meetingStart', msg);
        this.emit('phase', { phase: 'MEETING', levelId: s.levelId });
        break;
      }
      case MSG.MEETING_PHASE: {
        if (!s.meeting) s.meeting = { voted: new Set(), result: null };
        s.meeting.phase = msg.phase; s.meeting.endsAt = msg.endsAt;
        this.emit('meetingPhase', msg);
        break;
      }
      case MSG.VOTE_CAST: { if (s.meeting) s.meeting.voted.add(msg.voter); this.emit('voteCast', msg); break; }
      case MSG.VOTE_RESULT: {
        if (!s.meeting) s.meeting = { voted: new Set() };
        s.meeting.phase = 'RESULT'; s.meeting.endsAt = msg.endsAt; s.meeting.result = msg;
        if (msg.ejected !== null && msg.ejected !== undefined) { const p = s.players.get(msg.ejected); if (p) p.alive = false; s.knownDead.add(msg.ejected); }
        this.emit('voteResult', msg);
        break;
      }
      case MSG.TASK_PROGRESS: s.taskProgress = { done: msg.done, total: msg.total }; this.emit('taskProgress', s.taskProgress); break;
      case MSG.TASK_ACK: {
        const t = s.tasks.find((x) => x.id === msg.taskId);
        if (t) { t.step = msg.step; t.done = msg.done; }
        this.emit('taskAck', msg);
        break;
      }
      case MSG.SABOTAGE_START: s.sabotage = msg.sabotage; this.emit('sabotageStart', msg.sabotage); break;
      case MSG.SABOTAGE_UPDATE: if (s.sabotage) { s.sabotage.holds = msg.holds; s.sabotage.fixed = msg.fixed; } this.emit('sabotageUpdate', msg); break;
      case MSG.SABOTAGE_END: s.sabotage = null; s.sabotageCooldownEnd = msg.cooldownEnd || 0; this.emit('sabotageEnd', msg); break;
      case MSG.DOOR_STATE: s.doorsClosed = new Set(msg.closed || []); this.emit('doors', s.doorsClosed); break;
      case MSG.VENT_STATE: s.venting = !!msg.venting; s.ventId = msg.ventId || null; s.ventConnects = msg.connects || []; this.emit('ventState', msg); break;
      case MSG.FLARE: this.emit('flare'); break;
      case MSG.STATION_GLOW: this.emit('stationGlow', msg); break;
      case MSG.CHAT: s.chat.push({ slot: msg.slot, text: msg.text, ghost: msg.ghost, at: Date.now() }); if (s.chat.length > 60) s.chat.shift(); this.emit('chat', msg); break;
      case MSG.GAME_END: {
        s.phase = 'GAME_OVER'; s.winner = msg.winner; s.endRoles = msg.roles; s.sabotage = null; s.meeting = null;
        this.emit('gameEnd', msg);
        this.emit('phase', { phase: 'GAME_OVER', levelId: s.levelId });
        break;
      }
      default: return;
    }
    this.emit('change', s);
  }

  // ---- client -> host helpers
  sendHost(msg) { this.net.sendToHost(msg); }
  setName(name) { this.sendHost({ t: MSG.SET_NAME, name }); }
  setColor(colorIdx) { this.sendHost({ t: MSG.SET_COLOR, colorIdx }); }
  setReady(ready) { this.sendHost({ t: MSG.READY, ready }); }
  setSettings(settings) { this.sendHost({ t: MSG.SET_SETTINGS, settings }); }
  startGame() { this.sendHost({ t: MSG.START_GAME }); }
  taskComplete(taskId, stationId) { this.sendHost({ t: MSG.TASK_COMPLETE, taskId, stationId }); }
  killAttempt(target) { this.sendHost({ t: MSG.KILL_ATTEMPT, target }); }
  reportBody(bodyId) { this.sendHost({ t: MSG.REPORT_BODY, bodyId }); }
  emergencyMeeting() { this.sendHost({ t: MSG.EMERGENCY_MEETING }); }
  vote(target) { if (this.state.meeting) this.state.meeting.myVote = target; this.sendHost({ t: MSG.VOTE, target }); }
  sabotage(type, room) { this.sendHost({ t: MSG.SABOTAGE_REQUEST, type, room }); }
  sabotageFix(type, index, extra = {}) { this.sendHost({ t: MSG.SABOTAGE_FIX, type, index, ...extra }); }
  ventEnter(ventId) { this.sendHost({ t: MSG.VENT_ENTER, ventId }); }
  ventMove(to) { this.sendHost({ t: MSG.VENT_MOVE, to }); }
  ventExit() { this.sendHost({ t: MSG.VENT_EXIT }); }
  minigameState(stationId, open) { this.sendHost({ t: MSG.MINIGAME_STATE, stationId, open }); }
  chat(text) { this.sendHost({ t: MSG.CHAT, text }); }
}
