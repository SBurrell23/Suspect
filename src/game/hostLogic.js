// AUTHORITATIVE — every rule lives here. Runs only on the host peer.
import { MSG, FLAG, ACT } from '../net/protocol.js';
import { encodeSnapshot, tickDiff } from '../net/snapshot.js';
import { simulateStep, makeMoveState } from '../world/collision.js';
import { movementMode, zoneZeroGAt } from '../net/prediction.js';
import { NET, RULES, GAME_DEFAULTS, COLORS, SETTINGS_SCHEMA } from '../config.js';
import { impostorCountFor, assignRoles } from './roles.js';
import { buildTaskPool, assignTasksFor, currentStation, serializeTasks } from './tasks.js';
import { tally, SKIP } from './voting.js';
import { SABOTAGES, makeSabotage, publicSabotage } from './sabotage.js';
import { StateMachine } from './stateMachine.js';

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const distPos = (s, p) => Math.hypot(s.x - p[0], s.y - p[1], s.z - p[2]);

export class HostGame {
  constructor({ net, requestLevel, minPlayers = NET.MIN_PLAYERS, initialPlayers = null, settings = null }) {
    this.net = net;
    this.requestLevel = requestLevel;
    this.minPlayers = minPlayers;
    this.sm = new StateMachine('LOBBY');
    this.players = new Map(); // slot -> record
    this.slotsByPeer = new Map();
    this.settings = { ...GAME_DEFAULTS, ...(settings || {}) };
    this.levelId = 'lobby';
    this.level = requestLevel('lobby');
    this.bodies = [];
    this.bodySeq = 1;
    this.meeting = null;
    this.sabotage = null;
    this.sabotageCooldownEnd = 0;
    this.doorCooldowns = new Map();
    this.doorTimers = new Map();
    this.tasksDone = 0;
    this.tasksTotal = 0;
    this.tick = 0;
    this.nextSnapshotAt = 0;
    this.phaseEndAt = 0;
    this.flareAt = 0;
    this.lastDistanceCheck = 0;
    this.winner = null;
    if (initialPlayers) for (const p of initialPlayers) this._addPlayer(p.id, p.name, p.colorIdx, p.slot);
  }

  get phase() { return this.sm.phase; }
  now() { return Date.now(); }

  // ------------------------------------------------------------ messaging
  send(slot, msg) { const p = this.players.get(slot); if (p) this.net.send(p.id, msg); }
  broadcast(msg) { this.net.broadcast(msg, true); }
  playerByPeer(id) { const s = this.slotsByPeer.get(id); return s === undefined ? null : this.players.get(s); }
  alivePlayers() { return [...this.players.values()].filter((p) => p.alive); }

  lobbyState() {
    return {
      t: MSG.LOBBY_STATE,
      players: [...this.players.values()].map((p) => ({ slot: p.slot, id: p.id, name: p.name, colorIdx: p.colorIdx, ready: p.ready, isHost: p.id === this.net.myId })),
      settings: this.settings,
      levelId: this.levelId,
      phase: this.phase,
      hostTime: this.now(),
      minPlayers: this.minPlayers,
    };
  }

  // ------------------------------------------------------------ players
  _freeSlot() { for (let i = 0; i < NET.MAX_PLAYERS; i++) if (!this.players.has(i)) return i; return -1; }
  _freeColor(pref) {
    const used = new Set([...this.players.values()].map((p) => p.colorIdx));
    if (!used.has(pref)) return pref;
    for (let i = 0; i < COLORS.length; i++) if (!used.has(i)) return i;
    return pref;
  }

  _addPlayer(id, name, colorIdx, forceSlot) {
    const slot = forceSlot !== undefined && !this.players.has(forceSlot) ? forceSlot : this._freeSlot();
    if (slot < 0) return null;
    const sp = this.level.spawnPoints(NET.MAX_PLAYERS)[slot];
    const p = {
      slot, id, name: (name || `Player ${slot + 1}`).slice(0, 16), colorIdx: this._freeColor(colorIdx | 0),
      alive: true, ready: false, role: null, tasks: [], emergencies: this.settings.emergencyMeetingsPerPlayer,
      killCooldownEnd: 0, venting: false, ventId: null, sim: makeMoveState(sp.x, sp.y, sp.z, sp.yaw),
      lastTick: 0, hasTick: false, minigame: false, sprint: false, lastMode: 'walk', connected: true,
    };
    this.players.set(slot, p);
    this.slotsByPeer.set(id, slot);
    return p;
  }

  join(from, msg) {
    if (this.playerByPeer(from)) { this.broadcast(this.lobbyState()); return; }
    if (this.phase !== 'LOBBY') { this.net.send(from, { t: MSG.ERROR, code: 'IN_PROGRESS', message: 'Game in progress. Try again after this round.' }); return; }
    const p = this._addPlayer(from, msg.name, msg.colorIdx);
    if (!p) { this.net.send(from, { t: MSG.ERROR, code: 'FULL', message: 'Room is full (10 players).' }); return; }
    // tell the joiner who to mesh with, and everyone the new lobby
    this.net.send(from, { t: MSG.ROSTER, peers: [...this.slotsByPeer.keys()].filter((id) => id !== from), connect: true, yourSlot: p.slot });
    this.broadcast(this.lobbyState());
    this.broadcast({ t: MSG.TELEPORT, slot: p.slot, x: p.sim.x, y: p.sim.y, z: p.sim.z, yaw: p.sim.yaw });
  }

  removePeer(id) {
    const p = this.playerByPeer(id);
    if (!p) return;
    this.players.delete(p.slot);
    this.slotsByPeer.delete(id);
    if (this.meeting) this.meeting.votes.delete(p.slot);
    this.broadcast({ t: MSG.PLAYER_LEFT, slot: p.slot, name: p.name });
    if (this.phase === 'LOBBY') { this.broadcast(this.lobbyState()); return; }
    if (this.sabotage && this.sabotage.type === 'reactor') {
      this.sabotage.holdSlots = this.sabotage.holdSlots.map((s) => (s === p.slot ? null : s));
      this.sabotage.holds = this.sabotage.holdSlots.map((s) => s !== null);
    }
    this.checkWin();
    if (this.phase === 'MEETING' && this.meeting?.phase === 'VOTE') this._maybeEndVoteEarly();
  }

  // ------------------------------------------------------------ dispatch
  handle(from, msg) {
    const p = this.playerByPeer(from);
    switch (msg.t) {
      case MSG.JOIN: return this.join(from, msg);
      case MSG.SET_NAME: if (p && this.phase === 'LOBBY') { p.name = String(msg.name || '').slice(0, 16) || p.name; this.broadcast(this.lobbyState()); } return;
      case MSG.SET_COLOR: if (p && this.phase === 'LOBBY') { p.colorIdx = this._freeColor(msg.colorIdx | 0); this.broadcast(this.lobbyState()); } return;
      case MSG.READY: if (p) { p.ready = !!msg.ready; this.broadcast(this.lobbyState()); } return;
      case MSG.SET_SETTINGS: if (from === this.net.myId && this.phase === 'LOBBY') { this._applySettings(msg.settings); this.broadcast(this.lobbyState()); } return;
      case MSG.START_GAME: if (from === this.net.myId) this.startGame(); return;
      case MSG.TASK_COMPLETE: return p && this.taskComplete(p, msg);
      case MSG.KILL_ATTEMPT: return p && this.killAttempt(p, msg);
      case MSG.REPORT_BODY: return p && this.reportBody(p, msg);
      case MSG.EMERGENCY_MEETING: return p && this.emergencyMeeting(p);
      case MSG.VOTE: return p && this.vote(p, msg);
      case MSG.SABOTAGE_REQUEST: return p && this.sabotageRequest(p, msg);
      case MSG.SABOTAGE_FIX: return p && this.sabotageFix(p, msg);
      case MSG.VENT_ENTER: return p && this.ventEnter(p, msg);
      case MSG.VENT_MOVE: return p && this.ventMove(p, msg);
      case MSG.VENT_EXIT: return p && this.ventExit(p);
      case MSG.MINIGAME_STATE: return p && this.minigameState(p, msg);
      case MSG.CHAT: return p && this.chat(p, msg);
      default: return;
    }
  }

  _applySettings(s) {
    if (!s) return;
    for (const def of SETTINGS_SCHEMA) {
      if (!(def.key in s)) continue;
      let v = s[def.key];
      if (def.type === 'range') { v = Number(v); if (!Number.isFinite(v)) continue; v = Math.max(def.min, Math.min(def.max, v)); }
      else if (def.type === 'bool') v = !!v;
      else if (def.type === 'select') { if (!def.options.includes(v)) continue; }
      this.settings[def.key] = v;
    }
  }

  // ------------------------------------------------------------ movement
  onInputs(from, inputs) {
    const p = this.playerByPeer(from);
    if (!p) return;
    for (const inp of inputs) {
      if (p.hasTick) {
        const d = tickDiff(inp.tick, p.lastTick);
        if (d <= 0 && d > -30000) continue;
      }
      const mode = movementMode({ phase: this.phase, alive: p.alive, venting: p.venting, inMinigame: (inp.actions & ACT.MINIGAME) !== 0, zoneZeroG: zoneZeroGAt(this.level, p.sim) });
      simulateStep(this.level.collision, p.sim, inp, NET.SIM_DT, mode, this.settings.moveSpeed);
      p.lastTick = inp.tick; p.hasTick = true;
      p.minigame = (inp.actions & ACT.MINIGAME) !== 0;
      p.sprint = (inp.actions & ACT.SPRINT) !== 0;
      p.lastMode = mode;
      // fell out of the world: respawn at the level spawn
      if (p.sim.y < this.level.collision.bounds.min[1] - 20) { const sp = this.level.spawnPoints(10)[p.slot]; this.teleport(p, sp.x, sp.y, sp.z, sp.yaw); }
    }
  }

  teleport(p, x, y, z, yaw) {
    p.sim.x = x; p.sim.y = y; p.sim.z = z; p.sim.yaw = yaw ?? p.sim.yaw;
    p.sim.vx = p.sim.vy = p.sim.vz = 0; p.sim.onGround = true;
    this.broadcast({ t: MSG.TELEPORT, slot: p.slot, x, y, z, yaw: p.sim.yaw });
  }

  snapshot() {
    this.tick = (this.tick + 1) & 0xffff;
    const recs = [];
    for (const p of this.players.values()) {
      let flags = 0;
      if (p.alive) flags |= FLAG.ALIVE; else flags |= FLAG.GHOST;
      if (p.venting) flags |= FLAG.VENTING;
      const moving = Math.abs(p.sim.vx) + Math.abs(p.sim.vz) > 0.2 && p.lastMode !== 'frozen';
      if (moving) flags |= FLAG.MOVING;
      if (moving && p.sprint) flags |= FLAG.SPRINTING;
      if (p.minigame) flags |= FLAG.IN_MINIGAME;
      recs.push({ slot: p.slot, x: p.sim.x, y: p.sim.y, z: p.sim.z, yaw: p.sim.yaw, flags, ackTick: p.lastTick });
    }
    return encodeSnapshot(this.tick, recs);
  }

  // ------------------------------------------------------------ game flow
  startGame() {
    if (this.phase !== 'LOBBY') return;
    if (this.players.size < this.minPlayers) { this.net.send(this.net.myId, { t: MSG.ERROR, code: 'NOT_ENOUGH', message: `Need at least ${this.minPlayers} players.` }); return; }
    const levelId = this.settings.level;
    this.level = this.requestLevel(levelId);
    this.levelId = levelId;
    this.bodies = []; this.sabotage = null; this.meeting = null; this.winner = null;
    this.sabotageCooldownEnd = this.now() + 10000;
    this.doorCooldowns.clear();
    for (const t of this.doorTimers.values()) clearTimeout(t);
    this.doorTimers.clear();
    const slots = [...this.players.keys()];
    const count = impostorCountFor(slots.length, this.settings.impostorCount);
    const { roles, impostors } = assignRoles(slots, count);
    const pool = buildTaskPool(this.level);
    this.tasksDone = 0; this.tasksTotal = 0;
    const spawns = this.level.spawnPoints(slots.length);
    let i = 0;
    for (const p of this.players.values()) {
      p.role = roles.get(p.slot);
      p.alive = true; p.venting = false; p.ventId = null; p.minigame = false;
      p.emergencies = this.settings.emergencyMeetingsPerPlayer;
      p.killCooldownEnd = this.now() + RULES.ROLE_ASSIGN_MS + this.settings.killCooldown * 1000;
      p.tasks = assignTasksFor(p.slot, pool, this.settings.tasksPerPlayer);
      if (p.role === 'crew') this.tasksTotal += p.tasks.length;
      const sp = spawns[i++];
      p.sim.x = sp.x; p.sim.y = sp.y; p.sim.z = sp.z; p.sim.yaw = sp.yaw; p.sim.vx = p.sim.vy = p.sim.vz = 0;
    }
    this.sm.transition('ROLE_ASSIGN');
    this.phaseEndAt = this.now() + RULES.ROLE_ASSIGN_MS;
    this.broadcast({ t: MSG.GAME_START, levelId, settings: this.settings, hostTime: this.now(), roundAt: this.phaseEndAt, tasksTotal: this.tasksTotal });
    for (const p of this.players.values()) {
      this.broadcast({ t: MSG.TELEPORT, slot: p.slot, x: p.sim.x, y: p.sim.y, z: p.sim.z, yaw: p.sim.yaw });
      this.send(p.slot, { t: MSG.ROLE_ASSIGN, role: p.role, impostors: p.role === 'impostor' ? [...impostors] : null, tasks: serializeTasks(p.tasks), killCooldownEnd: p.killCooldownEnd, emergencies: p.emergencies, hostTime: this.now() });
    }
    this.flareAt = this.now() + RULES.FLARE_PERIOD_MS * (0.6 + Math.random() * 0.8);
  }

  _startRound() {
    this.sm.transition('ROUND');
    this.broadcast({ t: MSG.PHASE, phase: 'ROUND', hostTime: this.now() });
  }

  toLobby() {
    this.level = this.requestLevel('lobby');
    this.levelId = 'lobby';
    this.bodies = []; this.sabotage = null; this.meeting = null; this.winner = null;
    for (const t of this.doorTimers.values()) clearTimeout(t);
    this.doorTimers.clear();
    const spawns = this.level.spawnPoints(NET.MAX_PLAYERS);
    for (const p of this.players.values()) {
      p.alive = true; p.role = null; p.tasks = []; p.venting = false; p.ventId = null; p.minigame = false; p.ready = false;
      const sp = spawns[p.slot];
      p.sim.x = sp.x; p.sim.y = sp.y; p.sim.z = sp.z; p.sim.yaw = sp.yaw; p.sim.vx = p.sim.vy = p.sim.vz = 0;
    }
    this.sm.force('LOBBY');
    this.broadcast({ t: MSG.PHASE, phase: 'LOBBY', levelId: 'lobby', hostTime: this.now() });
    for (const p of this.players.values()) this.broadcast({ t: MSG.TELEPORT, slot: p.slot, x: p.sim.x, y: p.sim.y, z: p.sim.z, yaw: p.sim.yaw });
    this.broadcast(this.lobbyState());
  }

  endGame(winner, reason) {
    if (this.phase === 'GAME_OVER' || this.phase === 'LOBBY') return;
    this.winner = winner;
    this.sm.force('GAME_OVER');
    this.phaseEndAt = this.now() + RULES.GAME_OVER_MS;
    const roles = {};
    for (const p of this.players.values()) roles[p.slot] = p.role;
    this.broadcast({ t: MSG.GAME_END, winner, reason, roles, hostTime: this.now(), lobbyAt: this.phaseEndAt });
    this.sabotage = null;
    this.meeting = null;
  }

  checkWin() {
    if (this.phase !== 'ROUND' && this.phase !== 'MEETING') return false;
    const alive = this.alivePlayers();
    const imps = alive.filter((p) => p.role === 'impostor').length;
    const crew = alive.filter((p) => p.role === 'crew').length;
    const totalImps = [...this.players.values()].filter((p) => p.role === 'impostor').length;
    if (totalImps === 0 || imps === 0) { this.endGame('crew', imps === 0 && totalImps > 0 ? 'All impostors were ejected.' : 'No impostors left.'); return true; }
    if (this.tasksTotal > 0 && this.tasksDone >= this.tasksTotal) { this.endGame('crew', 'All tasks completed.'); return true; }
    if (imps >= crew) { this.endGame('impostor', 'The impostors outnumber the crew.'); return true; }
    return false;
  }

  // ------------------------------------------------------------ tasks
  taskComplete(p, msg) {
    if (this.phase !== 'ROUND' || p.role !== 'crew') return;
    const task = p.tasks.find((t) => t.id === msg.taskId);
    if (!task || task.done) return;
    const want = currentStation(task);
    if (msg.stationId !== want) return;
    const st = this.level.stations.find((s) => s.id === want);
    if (!st || distPos(p.sim, st.pos) > RULES.USE_RANGE + 1.5) return;
    task.step++;
    if (task.step >= task.steps.length) {
      task.done = true;
      this.tasksDone++;
      this.broadcast({ t: MSG.TASK_PROGRESS, done: this.tasksDone, total: this.tasksTotal });
    }
    this.send(p.slot, { t: MSG.TASK_ACK, taskId: task.id, step: task.step, done: task.done });
    this.checkWin();
  }

  minigameState(p, msg) {
    const st = this.level.stations.find((s) => s.id === msg.stationId);
    if (!st || !st.visual || !this.settings.visualTasksEnabled) return;
    if (p.role !== 'crew') return; // fakers don't glow — that's how you catch them
    this.broadcast({ t: MSG.STATION_GLOW, stationId: st.id, on: !!msg.open });
  }

  // ------------------------------------------------------------ kills / bodies
  killAttempt(p, msg) {
    if (this.phase !== 'ROUND' || p.role !== 'impostor' || !p.alive || p.venting) return;
    if (this.now() < p.killCooldownEnd) return;
    const target = this.players.get(msg.target | 0);
    if (!target || !target.alive || target.role !== 'crew' || target.venting) return;
    if (dist3(p.sim, target.sim) > RULES.KILL_RANGE + 0.3) return;
    target.alive = false;
    target.minigame = false;
    const body = { id: this.bodySeq++, slot: target.slot, x: target.sim.x, y: target.sim.y, z: target.sim.z, yaw: target.sim.yaw, colorIdx: target.colorIdx };
    this.bodies.push(body);
    p.killCooldownEnd = this.now() + this.settings.killCooldown * 1000;
    // killer lands on the body (classic lunge)
    this.teleport(p, target.sim.x, target.sim.y, target.sim.z, p.sim.yaw);
    this.broadcast({ t: MSG.KILL_CONFIRMED, victim: target.slot, killer: p.slot, body, hostTime: this.now() });
    this.send(p.slot, { t: MSG.KILL_COOLDOWN, killCooldownEnd: p.killCooldownEnd, hostTime: this.now() });
    if (this.sabotage?.type === 'reactor') this._releaseHold(target.slot);
    this.checkWin();
  }

  reportBody(p, msg) {
    if (this.phase !== 'ROUND' || !p.alive) return;
    const body = this.bodies.find((b) => b.id === msg.bodyId);
    if (!body) return;
    if (distPos(p.sim, [body.x, body.y, body.z]) > RULES.REPORT_RANGE + 0.5) return;
    this.startMeeting(p, body.slot);
  }

  emergencyMeeting(p) {
    if (this.phase !== 'ROUND' || !p.alive) return;
    if (this.sabotage && SABOTAGES[this.sabotage.type].critical) return;
    if (p.emergencies <= 0) return;
    if (distPos(p.sim, this.level.meetingTable) > RULES.MEETING_BUTTON_RANGE + 1.7) return;
    p.emergencies--;
    this.startMeeting(p, null);
  }

  startMeeting(reporter, bodySlot) {
    this.sm.transition('MEETING');
    this.bodies = [];
    const seats = this.level.meetingSeats(NET.MAX_PLAYERS);
    for (const p of this.players.values()) {
      p.venting = false; p.ventId = null; p.minigame = false;
      const s = seats[p.slot];
      this.teleport(p, s.x, s.y, s.z, s.yaw);
    }
    if (this.sabotage?.type === 'reactor') { this.sabotage.holdSlots = [null, null]; this.sabotage.holds = [false, false]; }
    const endsAt = this.now() + this.settings.discussTime * 1000;
    this.meeting = { phase: 'DISCUSS', endsAt, reporter: reporter.slot, bodySlot, votes: new Map() };
    this.broadcast({
      t: MSG.MEETING_START, reporter: reporter.slot, bodySlot, phase: 'DISCUSS', endsAt, hostTime: this.now(),
      dead: [...this.players.values()].filter((p) => !p.alive).map((p) => p.slot), emergencies: reporter.emergencies,
    });
  }

  vote(p, msg) {
    if (this.phase !== 'MEETING' || !this.meeting || this.meeting.phase !== 'VOTE') return;
    if (!p.alive || this.meeting.votes.has(p.slot)) return;
    let target = msg.target === SKIP || msg.target === null ? SKIP : msg.target | 0;
    if (target !== SKIP) { const tp = this.players.get(target); if (!tp || !tp.alive) return; }
    this.meeting.votes.set(p.slot, target);
    this.broadcast({ t: MSG.VOTE_CAST, voter: p.slot });
    this._maybeEndVoteEarly();
  }

  _maybeEndVoteEarly() {
    if (!this.meeting || this.meeting.phase !== 'VOTE') return;
    const alive = this.alivePlayers();
    if (alive.every((p) => this.meeting.votes.has(p.slot))) this.endVote();
  }

  endVote() {
    const m = this.meeting;
    if (!m || m.phase === 'RESULT') return;
    const res = tally(m.votes);
    let role = null;
    if (res.ejected !== null) {
      const ep = this.players.get(res.ejected);
      if (ep) { ep.alive = false; role = ep.role; }
    }
    const votes = {};
    for (const [voter, target] of m.votes) votes[voter] = target;
    m.phase = 'RESULT';
    m.endsAt = this.now() + RULES.RESULT_MS;
    const remaining = this.alivePlayers().filter((p) => p.role === 'impostor').length;
    this.broadcast({
      t: MSG.VOTE_RESULT, ejected: res.ejected, tie: res.tie, skipped: res.skipped, counts: res.counts, votes,
      role: this.settings.confirmEjects ? role : null, remainingImpostors: this.settings.confirmEjects ? remaining : null,
      endsAt: m.endsAt, hostTime: this.now(),
    });
  }

  _resumeRound() {
    this.meeting = null;
    if (this.checkWin()) return;
    for (const p of this.players.values()) p.killCooldownEnd = this.now() + this.settings.killCooldown * 1000;
    this._startRound();
    for (const p of this.players.values()) if (p.role === 'impostor') this.send(p.slot, { t: MSG.KILL_COOLDOWN, killCooldownEnd: p.killCooldownEnd, hostTime: this.now() });
  }

  // ------------------------------------------------------------ sabotage
  sabotageRequest(p, msg) {
    if (this.phase !== 'ROUND' || p.role !== 'impostor') return;
    const type = msg.type;
    const def = SABOTAGES[type];
    if (!def) return;
    const now = this.now();
    if (type === 'doors') {
      const room = msg.room;
      const doors = this.level.doors.filter((d) => d.room === room);
      if (!doors.length) return;
      if ((this.doorCooldowns.get(room) || 0) > now) return;
      this.doorCooldowns.set(room, now + RULES.DOOR_COOLDOWN * 1000);
      for (const d of doors) {
        this.level.setDoor(d.id, true);
        if (this.doorTimers.has(d.id)) clearTimeout(this.doorTimers.get(d.id));
        this.doorTimers.set(d.id, setTimeout(() => { this.level.setDoor(d.id, false); this.doorTimers.delete(d.id); this._broadcastDoors(); }, RULES.DOOR_CLOSE_TIME * 1000));
      }
      this._broadcastDoors();
      return;
    }
    if (this.sabotage) return; // one at a time
    if (now < this.sabotageCooldownEnd) return;
    this.sabotage = makeSabotage(type, now);
    this.sabotage.holdSlots = [null, null];
    this.broadcast({ t: MSG.SABOTAGE_START, sabotage: publicSabotage(this.sabotage), hostTime: now });
  }

  _broadcastDoors() {
    const closed = this.level.doors.filter((d) => d.closed).map((d) => d.id);
    this.broadcast({ t: MSG.DOOR_STATE, closed });
  }

  _fixStation(type, index) {
    return this.level.sabotageStations.find((s) => s.type === type && (s.index || 0) === (index || 0));
  }

  sabotageFix(p, msg) {
    const s = this.sabotage;
    if (!s || this.phase !== 'ROUND' || !p.alive) return;
    if (msg.type !== s.type) return;
    const idx = msg.index | 0;
    const st = this._fixStation(s.type, idx);
    if (!st || distPos(p.sim, st.pos) > RULES.USE_RANGE + 1.5) return;
    switch (s.type) {
      case 'lights':
      case 'comms':
        this._endSabotage(true);
        return;
      case 'reactor':
        if (msg.holding) { s.holdSlots[idx] = p.slot; } else if (s.holdSlots[idx] === p.slot) s.holdSlots[idx] = null;
        s.holds = s.holdSlots.map((x) => x !== null);
        if (s.holds[0] && s.holds[1]) { this._endSabotage(true); return; }
        this.broadcast({ t: MSG.SABOTAGE_UPDATE, holds: s.holds, fixed: s.fixed });
        return;
      case 'o2':
        if (String(msg.code) === s.codes[idx]) {
          s.fixed[idx] = true;
          if (s.fixed[0] && s.fixed[1]) { this._endSabotage(true); return; }
          this.broadcast({ t: MSG.SABOTAGE_UPDATE, holds: s.holds, fixed: s.fixed });
        }
        return;
      default:
    }
  }

  _releaseHold(slot) {
    const s = this.sabotage;
    if (!s || s.type !== 'reactor') return;
    let changed = false;
    s.holdSlots = s.holdSlots.map((x) => { if (x === slot) { changed = true; return null; } return x; });
    if (changed) { s.holds = s.holdSlots.map((x) => x !== null); this.broadcast({ t: MSG.SABOTAGE_UPDATE, holds: s.holds, fixed: s.fixed }); }
  }

  _endSabotage(fixed) {
    const s = this.sabotage;
    if (!s) return;
    this.sabotage = null;
    this.sabotageCooldownEnd = this.now() + RULES.SABOTAGE_COOLDOWN * 1000;
    this.broadcast({ t: MSG.SABOTAGE_END, type: s.type, fixed, cooldownEnd: this.sabotageCooldownEnd, hostTime: this.now() });
    if (!fixed) this.endGame('impostor', s.type === 'reactor' ? 'The reactor melted down.' : 'The crew ran out of oxygen.');
  }

  // ------------------------------------------------------------ vents
  _vent(id) { return this.level.vents.find((v) => v.id === id); }
  _canVent(p, v) { return this.phase === 'ROUND' && p.alive && (p.role === 'impostor' || v.public); }

  ventEnter(p, msg) {
    const v = this._vent(msg.ventId);
    if (!v || !this._canVent(p, v) || p.venting || p.minigame) return;
    if (distPos(p.sim, v.pos) > RULES.VENT_RANGE + 0.6) return;
    p.venting = true; p.ventId = v.id;
    this._releaseHold(p.slot);
    this.teleport(p, v.pos[0], v.pos[1], v.pos[2], p.sim.yaw);
    this.send(p.slot, { t: MSG.VENT_STATE, venting: true, ventId: v.id, connects: v.connects });
  }
  ventMove(p, msg) {
    if (!p.venting) return;
    const cur = this._vent(p.ventId);
    const v = this._vent(msg.to);
    if (!cur || !v || !cur.connects.includes(v.id)) return;
    p.ventId = v.id;
    this.teleport(p, v.pos[0], v.pos[1], v.pos[2], p.sim.yaw);
    this.send(p.slot, { t: MSG.VENT_STATE, venting: true, ventId: v.id, connects: v.connects });
  }
  ventExit(p) {
    if (!p.venting) return;
    p.venting = false; p.ventId = null;
    this.send(p.slot, { t: MSG.VENT_STATE, venting: false });
  }

  chat(p, msg) {
    const text = String(msg.text || '').slice(0, 200);
    if (!text.trim()) return;
    const out = { t: MSG.CHAT, slot: p.slot, text, ghost: !p.alive };
    if (p.alive) this.broadcast(out);
    else for (const q of this.players.values()) if (!q.alive) this.send(q.slot, out);
  }

  // ------------------------------------------------------------ per-frame
  update(nowMs) {
    const now = this.now();
    // snapshots
    if (nowMs >= this.nextSnapshotAt && this.players.size) {
      this.nextSnapshotAt = nowMs + 1000 / NET.SNAPSHOT_HZ;
      this.net.broadcastBinary(this.snapshot(), true);
    }
    switch (this.phase) {
      case 'ROLE_ASSIGN':
        if (now >= this.phaseEndAt) this._startRound();
        break;
      case 'ROUND':
        if (this.sabotage && this.sabotage.endsAt && now >= this.sabotage.endsAt) this._endSabotage(false);
        if (this.level.data.ambience?.flares && now >= this.flareAt) {
          this.flareAt = now + RULES.FLARE_PERIOD_MS * (0.6 + Math.random() * 0.8);
          this.broadcast({ t: MSG.FLARE });
        }
        if (nowMs - this.lastDistanceCheck > 500) {
          this.lastDistanceCheck = nowMs;
          if (this.sabotage?.type === 'reactor') {
            for (let i = 0; i < 2; i++) {
              const slot = this.sabotage.holdSlots[i];
              if (slot === null) continue;
              const p = this.players.get(slot);
              const st = this._fixStation('reactor', i);
              if (!p || !p.alive || !st || distPos(p.sim, st.pos) > RULES.USE_RANGE + 1.5) this._releaseHold(slot);
            }
          }
        }
        break;
      case 'MEETING': {
        const m = this.meeting;
        if (!m) break;
        if (now < m.endsAt) break;
        if (m.phase === 'DISCUSS') {
          m.phase = 'VOTE'; m.endsAt = now + this.settings.voteTime * 1000;
          this.broadcast({ t: MSG.MEETING_PHASE, phase: 'VOTE', endsAt: m.endsAt, hostTime: now });
        } else if (m.phase === 'VOTE') this.endVote();
        else if (m.phase === 'RESULT') this._resumeRound();
        break;
      }
      case 'GAME_OVER':
        if (now >= this.phaseEndAt) this.toLobby();
        break;
      default:
    }
  }

  destroy() {
    for (const t of this.doorTimers.values()) clearTimeout(t);
    this.doorTimers.clear();
  }
}
