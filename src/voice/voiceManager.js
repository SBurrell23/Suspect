import { createPositional, isOccluded, attachListenerToBus } from './spatialAudio.js';

// Voice chat over PeerJS media calls with a Web Audio graph per remote peer:
//   MediaStream -> source -> factionGate -> userGain -> occGain -> commsShaper -> commsBand -> occlusionLowpass
//     -> dryGain -> voiceBus            (MEETING: normal group call)
//     -> spatialGain -> PositionalAudio (ROUND: proximity)
const SPEAK_THRESHOLD = 0.02;
const GATE_THRESHOLD = 0.00316; // -50 dB
const SPEAK_HOLD_MS = 180;

function distortionCurve(amount) {
  const n = 512, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return c;
}

export class VoiceManager {
  constructor(sound, net, listener) {
    this.sound = sound;
    this.ctx = sound.ctx;
    this.net = net;
    this.listener = listener;
    attachListenerToBus(listener, sound.voiceBus);
    this.peers = new Map(); // peerId -> entry
    this.mode = 'proximity';
    this.comms = false;
    this.micEnabled = false;
    this.micDenied = false;
    this.pushToTalk = false;
    this.pttDown = false;
    this.localSpeaking = false;
    this.localRms = 0;
    this._speakHold = 0;
    this._gateRelease = 0;
    this._occT = 0;
    this._buf = new Float32Array(512);
    this.collision = null;
    this.iAmGhost = false;
    this.ghostPeers = new Set();
    this.muteAll = false;

    // outgoing: mic -> gate -> processed destination (this is the stream we send)
    this.procDest = this.ctx.createMediaStreamDestination();
    this.gateGain = this.ctx.createGain();
    this.gateGain.gain.value = 0;
    this.gateGain.connect(this.procDest);
    this.micSource = null;
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 512;

    // peers that connected before this manager existed (e.g. the host we joined through)
    for (const e of net.peers.values()) if (e.announced && e.initiator) this.callPeer(e.id);
    net.on('call', (call) => this._answer(call));
    net.on('peer-join', (id, initiator) => { if (initiator) this.callPeer(id); });
    net.on('peer-leave', (id) => this.removePeer(id));
  }

  outStream() { return this.procDest.stream; }

  async enableMic() {
    if (this.micEnabled) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.micStream = stream;
      this.micSource = this.ctx.createMediaStreamSource(stream);
      this.micSource.connect(this.gateGain);
      this.micSource.connect(this.micAnalyser);
      this.micEnabled = true;
      this.micDenied = false;
      return true;
    } catch (e) {
      console.warn('mic denied', e);
      this.micDenied = true;
      return false;
    }
  }

  setPushToTalk(on) { this.pushToTalk = on; }
  setPttDown(on) { this.pttDown = on; }
  setCollision(c) { this.collision = c; }

  callPeer(id) {
    if (!this.net.peer || this.peers.get(id)?.call) return;
    try {
      const call = this.net.peer.call(id, this.outStream());
      this._track(id, call);
    } catch (e) { console.warn('call failed', id, e); }
  }

  _answer(call) {
    try { call.answer(this.outStream()); } catch (e) { console.warn('answer failed', e); }
    this._track(call.peer, call);
  }

  _track(id, call) {
    const e = this._entry(id);
    e.call = call;
    call.on('stream', (stream) => this._onStream(id, stream));
    call.on('close', () => { if (e.call === call) this._teardownAudio(e); });
    call.on('error', (err) => console.warn('media call error', id, err));
  }

  _entry(id) {
    let e = this.peers.get(id);
    if (!e) {
      e = { id, call: null, stream: null, sink: null, nodes: null, speaking: false, rms: 0, hold: 0, muted: false, volume: 1, occluded: false, object: null, positional: null, allowed: true };
      this.peers.set(id, e);
    }
    return e;
  }

  _onStream(id, stream) {
    const e = this._entry(id);
    if (e.stream === stream) return;
    this._teardownAudio(e);
    e.stream = stream;
    // REQUIRED Chromium workaround: a remote WebRTC MediaStream produces no audio through Web Audio
    // unless it is also attached to a playing HTMLAudioElement. Keep the reference or GC kills it.
    const sink = new Audio();
    sink.srcObject = stream;
    sink.muted = true;
    sink.autoplay = true;
    sink.play().catch(() => {});
    e.sink = sink;
    const ctx = this.ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    const gate = ctx.createGain(); gate.gain.value = e.allowed ? 1 : 0;
    const userGain = ctx.createGain(); userGain.gain.value = e.muted ? 0 : e.volume;
    const occGain = ctx.createGain(); occGain.gain.value = 1;
    const shaper = ctx.createWaveShaper(); shaper.curve = this.comms ? distortionCurve(60) : null; shaper.oversample = '2x';
    const band = ctx.createBiquadFilter(); band.type = this.comms ? 'bandpass' : 'allpass'; band.frequency.value = 1400; band.Q.value = 1.2;
    const lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 20000;
    const dry = ctx.createGain(); dry.gain.value = this.mode === 'direct' ? 1 : 0;
    const spatial = ctx.createGain(); spatial.gain.value = this.mode === 'direct' ? 0 : 1;
    source.connect(analyser);
    source.connect(gate).connect(userGain).connect(occGain).connect(shaper).connect(band).connect(lowpass);
    lowpass.connect(dry).connect(this.sound.voiceBus);
    lowpass.connect(spatial);
    e.nodes = { source, analyser, gate, userGain, occGain, shaper, band, lowpass, dry, spatial };
    if (e.object) this._bindSpatial(e);
    this._applyFaction(e);
  }

  _bindSpatial(e) {
    if (!e.nodes || !e.object) return;
    if (e.positional) { e.positional.removeFromParent(); try { e.positional.disconnect(); } catch (err) { /* */ } }
    e.positional = createPositional(this.listener, e.nodes.spatial);
    e.positional.position.set(0, 1.3, 0);
    e.object.add(e.positional);
  }

  // Attach the peer's audio to a character mesh (Object3D) so panning follows them.
  bindObject(id, object3d) {
    const e = this._entry(id);
    if (e.object === object3d) return;
    e.object = object3d;
    this._bindSpatial(e);
  }

  _teardownAudio(e) {
    if (e.positional) { e.positional.removeFromParent(); try { e.positional.disconnect(); } catch (err) { /* */ } e.positional = null; }
    if (e.nodes) { for (const n of Object.values(e.nodes)) { try { n.disconnect(); } catch (err) { /* */ } } e.nodes = null; }
    if (e.sink) { try { e.sink.pause(); e.sink.srcObject = null; } catch (err) { /* */ } e.sink = null; }
    e.stream = null;
    e.speaking = false;
  }

  removePeer(id) {
    const e = this.peers.get(id);
    if (!e) return;
    this._teardownAudio(e);
    try { e.call?.close(); } catch (err) { /* */ }
    this.peers.delete(id);
  }

  // 'proximity' (round, spatialized) or 'direct' (meeting, everyone at full volume). 300ms crossfade.
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    const t = this.ctx.currentTime;
    for (const e of this.peers.values()) {
      if (!e.nodes) continue;
      e.nodes.dry.gain.cancelScheduledValues(t); e.nodes.spatial.gain.cancelScheduledValues(t);
      e.nodes.dry.gain.setValueAtTime(e.nodes.dry.gain.value, t);
      e.nodes.spatial.gain.setValueAtTime(e.nodes.spatial.gain.value, t);
      e.nodes.dry.gain.linearRampToValueAtTime(mode === 'direct' ? 1 : 0, t + 0.3);
      e.nodes.spatial.gain.linearRampToValueAtTime(mode === 'direct' ? 0 : 1, t + 0.3);
    }
  }

  // Faction gating. Living players must never hear ghosts. Enforced at the gain node AND re-verified every frame.
  setFactions({ iAmGhost, ghostPeerIds }) {
    this.iAmGhost = !!iAmGhost;
    this.ghostPeers = new Set(ghostPeerIds || []);
    for (const e of this.peers.values()) this._applyFaction(e);
  }
  _applyFaction(e) {
    const isGhost = this.ghostPeers.has(e.id);
    e.allowed = !(isGhost && !this.iAmGhost) && !this.muteAll;
    if (e.nodes) e.nodes.gate.gain.value = e.allowed ? 1 : 0;
  }

  setMuteAll(on) { this.muteAll = on; for (const e of this.peers.values()) this._applyFaction(e); }

  setComms(on) {
    if (on === this.comms) return;
    this.comms = on;
    for (const e of this.peers.values()) {
      if (!e.nodes) continue;
      e.nodes.shaper.curve = on ? distortionCurve(60) : null;
      e.nodes.band.type = on ? 'bandpass' : 'allpass';
    }
  }

  setVolume(id, v) { const e = this._entry(id); e.volume = v; if (e.nodes) e.nodes.userGain.gain.setTargetAtTime(e.muted ? 0 : v, this.ctx.currentTime, 0.02); }
  setMuted(id, m) { const e = this._entry(id); e.muted = m; if (e.nodes) e.nodes.userGain.gain.setTargetAtTime(m ? 0 : e.volume, this.ctx.currentTime, 0.02); }
  isMuted(id) { return !!this.peers.get(id)?.muted; }
  getVolume(id) { return this.peers.get(id)?.volume ?? 1; }
  isSpeaking(id) { return !!this.peers.get(id)?.speaking; }

  _rms(analyser) {
    analyser.getFloatTimeDomainData(this._buf);
    let s = 0;
    for (let i = 0; i < this._buf.length; i++) s += this._buf[i] * this._buf[i];
    return Math.sqrt(s / this._buf.length);
  }

  // listenerPos: [x,y,z]; peerPositions: Map(peerId -> [x,y,z])
  update(dt, listenerPos, peerPositions) {
    const now = performance.now();
    // outgoing gate / push-to-talk
    if (this.micEnabled) {
      this.localRms = this._rms(this.micAnalyser);
      let open;
      if (this.pushToTalk) open = this.pttDown;
      else {
        if (this.localRms > GATE_THRESHOLD) this._gateRelease = now + 250;
        open = now < this._gateRelease;
      }
      const target = open ? 1 : 0;
      if (Math.abs(this.gateGain.gain.value - target) > 0.01) this.gateGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
      this.localSpeaking = open && this.localRms > SPEAK_THRESHOLD;
    }
    let any = false;
    for (const e of this.peers.values()) {
      if (!e.nodes) continue;
      // belt-and-braces faction verification
      const shouldAllow = !(this.ghostPeers.has(e.id) && !this.iAmGhost) && !this.muteAll;
      if (e.nodes.gate.gain.value !== (shouldAllow ? 1 : 0)) e.nodes.gate.gain.value = shouldAllow ? 1 : 0;
      e.rms = this._rms(e.nodes.analyser);
      if (e.rms > SPEAK_THRESHOLD && shouldAllow && !e.muted) e.hold = now + SPEAK_HOLD_MS;
      e.speaking = now < e.hold;
      if (e.speaking) any = true;
    }
    // occlusion every 200ms, not per frame
    this._occT += dt;
    if (this._occT > 0.2) {
      this._occT = 0;
      for (const e of this.peers.values()) {
        if (!e.nodes) continue;
        const p = peerPositions && peerPositions.get(e.id);
        let blocked = false;
        if (p && this.mode === 'proximity' && listenerPos) blocked = isOccluded(this.collision, listenerPos, [p[0], p[1] + 1.3, p[2]]);
        if (blocked !== e.occluded) {
          e.occluded = blocked;
          const t = this.ctx.currentTime;
          e.nodes.lowpass.frequency.setTargetAtTime(blocked ? 700 : 20000, t, 0.08);
          e.nodes.occGain.gain.setTargetAtTime(blocked ? 0.6 : 1, t, 0.08);
        }
      }
    }
    this.sound.duck(any || this.localSpeaking);
    return any;
  }

  dispose() {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    if (this.micStream) for (const t of this.micStream.getTracks()) t.stop();
  }
}
