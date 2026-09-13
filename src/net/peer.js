import Peer from 'peerjs';
import { ICE_SERVERS, PEER_SERVER, NET } from '../config.js';
import { MSG } from './protocol.js';

const ID_PREFIX = 'suspect-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genRoomCode() {
  let s = '';
  const arr = new Uint8Array(NET.ROOM_CODE_LEN);
  crypto.getRandomValues(arr);
  for (let i = 0; i < NET.ROOM_CODE_LEN; i++) s += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  return s;
}

// PeerJS wrapper: full mesh, two channels per peer (evt = reliable JSON, net = raw binary),
// host election by lowest lexicographic peer ID on host loss.
export class Net {
  constructor(opts = {}) {
    this.peerServer = opts.peerServer ?? PEER_SERVER;
    this.iceServers = opts.iceServers ?? ICE_SERVERS;
    this.peer = null;
    this.myId = null;
    this.hostId = null;
    this.isHost = false;
    this.roomCode = null;
    this.peers = new Map(); // id -> { evt, net, evtOpen, netOpen }
    this.handlers = new Map();
    this.destroyed = false;
    // Application-level heartbeat: WebRTC close detection can take 30s+ when a tab dies.
    this.heartbeat = setInterval(() => this._heartbeat(), 2000);
  }

  _heartbeat() {
    if (this.destroyed) return;
    const now = Date.now();
    for (const e of [...this.peers.values()]) {
      if (!e.announced) continue;
      if (now - (e.lastSeen || now) > NET.PEER_TIMEOUT_MS) { console.warn('peer timed out', e.id); this._onClose(e.id, 'evt'); continue; }
      try { e.evt.send({ t: MSG.PING, ts: Date.now() }); } catch (err) { /* ignore */ }
    }
  }

  on(ev, fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev).add(fn);
    return () => this.handlers.get(ev).delete(fn);
  }
  emit(ev, ...args) {
    const hs = this.handlers.get(ev);
    if (!hs) return;
    for (const h of hs) {
      try { h(...args); } catch (e) { console.error('net handler error', ev, e); }
    }
  }

  _peerOptions() {
    const o = { config: { iceServers: this.iceServers }, debug: 1 };
    if (this.peerServer) Object.assign(o, this.peerServer);
    return o;
  }

  async host(preferredCode = null) {
    let lastErr = null;
    for (let i = 0; i < NET.ROOM_CODE_RETRIES; i++) {
      const code = i === 0 && preferredCode ? preferredCode.toUpperCase() : genRoomCode();
      try {
        await this._open(ID_PREFIX + code);
        this.isHost = true;
        this.hostId = this.myId;
        this.roomCode = code;
        return code;
      } catch (e) {
        lastErr = e;
        if (e && e.type === 'unavailable-id') { this._destroyPeer(); continue; }
        throw e;
      }
    }
    throw lastErr || new Error('Could not allocate a room code');
  }

  async join(code) {
    code = code.trim().toUpperCase();
    await this._open(undefined);
    this.roomCode = code;
    this.hostId = ID_PREFIX + code;
    this.isHost = false;
    await this._connectTo(this.hostId);
  }

  _open(id) {
    return new Promise((resolve, reject) => {
      let opened = false;
      const peer = new Peer(id, this._peerOptions());
      this.peer = peer;
      peer.on('open', (pid) => {
        opened = true;
        this.myId = pid;
        resolve(pid);
      });
      peer.on('error', (err) => {
        if (!opened) { reject(err); return; }
        // peer-unavailable fires when a connect target is gone; surface the rest
        this.emit('error', err);
      });
      peer.on('connection', (conn) => this._accept(conn));
      peer.on('call', (call) => this.emit('call', call));
      peer.on('disconnected', () => { if (!this.destroyed && this.peer === peer) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
      peer.on('close', () => { if (this.peer === peer) this.emit('closed'); });
    });
  }

  _destroyPeer() {
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
    this.peer = null;
  }

  _entry(id) {
    let e = this.peers.get(id);
    if (!e) { e = { id, evt: null, net: null, evtOpen: false, netOpen: false, announced: false, initiator: false, lastSeen: Date.now() }; this.peers.set(id, e); }
    return e;
  }

  _accept(conn) {
    const id = conn.peer;
    const e = this._entry(id);
    this._wire(e, conn);
  }

  _wire(e, conn) {
    const label = conn.label === 'net' ? 'net' : 'evt';
    e[label] = conn;
    const onOpen = () => {
      e[label + 'Open'] = true;
      this._maybeAnnounce(e);
    };
    if (conn.open) onOpen(); else conn.on('open', onOpen);
    conn.on('data', (data) => {
      e.lastSeen = Date.now();
      if (label === 'evt') this._onEvt(e.id, data);
      else this.emit('net', e.id, data instanceof ArrayBuffer ? data : data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    });
    conn.on('close', () => this._onClose(e.id, label));
    conn.on('error', (err) => { console.warn('conn error', e.id, label, err); });
  }

  _maybeAnnounce(e) {
    if (e.announced || !e.evtOpen || !e.netOpen) return;
    e.announced = true;
    e.lastSeen = Date.now();
    this.emit('peer-join', e.id, e.initiator);
    if (e.id === this.hostId) this.emit('host-connected');
  }

  _connectTo(id) {
    return new Promise((resolve, reject) => {
      if (this.peers.get(id)?.announced) { resolve(); return; }
      const e = this._entry(id);
      e.initiator = true;
      const evt = this.peer.connect(id, { label: 'evt', reliable: true, serialization: 'json' });
      const net = this.peer.connect(id, { label: 'net', reliable: false, serialization: 'raw' });
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('Connection to ' + id + ' timed out')); } }, 15000);
      const check = () => {
        if (e.evtOpen && e.netOpen && !done) { done = true; clearTimeout(timer); resolve(); }
      };
      const off = this.on('peer-join', (pid) => { if (pid === id) { check(); off(); } });
      this._wire(e, evt);
      this._wire(e, net);
      evt.on('error', (err) => { if (!done) { done = true; clearTimeout(timer); reject(err); } });
      check();
    });
  }

  _onEvt(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === MSG.PING) { const e = this.peers.get(from); if (e && e.evtOpen) { try { e.evt.send({ t: MSG.PONG, ts: msg.ts }); } catch (err) { /* */ } } return; }
    if (msg.t === MSG.PONG) { const e = this.peers.get(from); if (e && typeof msg.ts === 'number') e.rtt = Math.max(0, Date.now() - msg.ts); return; }
    if (msg.t === MSG.ROSTER && msg.connect) {
      for (const pid of msg.peers || []) {
        if (pid === this.myId || this.peers.get(pid)?.announced) continue;
        this._connectTo(pid).catch((err) => console.warn('mesh connect failed', pid, err));
      }
    }
    if (msg.t === MSG.HOST_CLAIM) {
      this.hostId = from;
      this.isHost = false;
      this.emit('host-changed', from);
    }
    this.emit('evt', from, msg);
  }

  _onClose(id, label) {
    const e = this.peers.get(id);
    if (!e) return;
    e[label + 'Open'] = false;
    // one channel closing means the peer is gone (or going)
    this.peers.delete(id);
    try { e.evt?.close(); e.net?.close(); } catch (err) { /* ignore */ }
    if (e.announced) this.emit('peer-leave', id);
    if (id === this.hostId && !this.isHost) this._electHost();
  }

  _electHost() {
    const candidates = [this.myId, ...this.peers.keys()].filter(Boolean).sort();
    const winner = candidates[0];
    this.hostId = winner;
    if (winner === this.myId) {
      // wait for objections (a simultaneous claimant with a lower id), then claim
      setTimeout(() => {
        if (this.hostId !== this.myId) return;
        this.isHost = true;
        this.broadcast({ t: MSG.HOST_CLAIM });
        this.emit('became-host');
      }, NET.HOST_CLAIM_WAIT_MS);
    } else {
      this.emit('host-changed', winner);
    }
  }

  peerIds() { return [...this.peers.keys()].filter((id) => this.peers.get(id).announced); }
  rtt(id) { const e = this.peers.get(id); return e && e.rtt !== undefined ? e.rtt : null; }

  send(id, msg) {
    if (id === this.myId) { this.emit('evt', this.myId, msg); return true; }
    const e = this.peers.get(id);
    if (!e || !e.evtOpen) return false;
    try { e.evt.send(msg); return true; } catch (err) { console.warn('send failed', id, err); return false; }
  }

  broadcast(msg, includeSelf = false) {
    for (const e of this.peers.values()) if (e.evtOpen) { try { e.evt.send(msg); } catch (err) { /* ignore */ } }
    if (includeSelf) this.emit('evt', this.myId, msg);
  }

  sendBinary(id, buf) {
    if (id === this.myId) { this.emit('net', this.myId, buf); return true; }
    const e = this.peers.get(id);
    if (!e || !e.netOpen) return false;
    try { e.net.send(buf); return true; } catch (err) { return false; }
  }

  broadcastBinary(buf, includeSelf = false) {
    for (const e of this.peers.values()) if (e.netOpen) { try { e.net.send(buf); } catch (err) { /* ignore */ } }
    if (includeSelf) this.emit('net', this.myId, buf);
  }

  sendToHost(msg) { return this.send(this.hostId, msg); }
  sendBinaryToHost(buf) { return this.sendBinary(this.hostId, buf); }

  destroy() {
    this.destroyed = true;
    clearInterval(this.heartbeat);
    for (const e of this.peers.values()) { try { e.evt?.close(); e.net?.close(); } catch (err) { /* ignore */ } }
    this.peers.clear();
    this._destroyPeer();
  }
}
