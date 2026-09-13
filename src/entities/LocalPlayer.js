import * as THREE from 'three';
import { CharacterView } from './Player.js';
import { Predictor } from '../net/prediction.js';
import { ACT } from '../net/protocol.js';
import { NET, PLAYER, CAMERA } from '../config.js';

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space', 'ControlLeft', 'KeyC', 'KeyZ', 'KeyX']);

// First-person controller with fixed-step prediction. Emits input packets via onInputs.
export class LocalPlayer {
  constructor({ camera, world, level, settings, colorHex, name }) {
    this.camera = camera;
    this.settings = settings;
    this.predictor = new Predictor(world, level);
    this.world = world;
    this.level = level;
    this.view = new CharacterView(colorHex, name);
    this.view.group.visible = false;
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.pointerLocked = false;
    this.accum = 0;
    this.recent = [];
    this.onInputs = null;
    this.inputEnabled = true;
    this.moveEnabled = true;
    this.inMinigame = false;
    this.bobT = 0;
    this.fov = settings.fov;
    this.killFovT = 0;
    this.renderPos = { x: 0, y: 0, z: 0 };
    this.lastStepPos = { x: 0, y: 0, z: 0 };
    this.stepDistance = 0;
    this.onFootstep = null;
    this.speaking = false;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._bind();
  }

  get state() { return this.predictor.state; }
  get moving() { const s = this.predictor.state; return Math.abs(s.vx) + Math.abs(s.vz) > 0.2 && this.predictor.lastMode !== 'frozen'; }
  get sprinting() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

  _bind() {
    this._onKeyDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
      if (MOVE_KEYS.has(e.code)) { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); }
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };
    this._onBlur = () => this.keys.clear();
    this._onMouseMove = (e) => {
      if (!this.pointerLocked || !this.inputEnabled) return;
      const s = 0.0022 * this.settings.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    };
    this._onLockChange = () => { this.pointerLocked = !!document.pointerLockElement; };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestPointerLock(el) {
    if (document.pointerLockElement) return;
    try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }
  releasePointerLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  setWorld(world, level) {
    this.world = world; this.level = level;
    this.predictor.setWorld(world, level);
  }

  setContext(ctx) { Object.assign(this.predictor.ctx, ctx); }
  setSpeedMul(m) { this.predictor.speedMul = m; }

  teleport(x, y, z, yaw) {
    this.predictor.teleport(x, y, z, yaw);
    if (yaw !== undefined) this.yaw = yaw;
    this.renderPos.x = x; this.renderPos.y = y; this.renderPos.z = z;
    this.lastStepPos.x = x; this.lastStepPos.z = z;
  }

  _buildInput() {
    const k = this.keys;
    let moveX = 0, moveZ = 0, moveY = 0;
    if (this.moveEnabled && this.inputEnabled) {
      moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      moveZ = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      moveY = (k.has('Space') ? 1 : 0) - (k.has('ControlLeft') || k.has('KeyC') ? 1 : 0);
    }
    let actions = 0;
    if (this.sprinting) actions |= ACT.SPRINT;
    if (this.inMinigame) actions |= ACT.MINIGAME;
    return { moveX, moveZ, moveY, yaw: this.yaw, actions };
  }

  update(dt) {
    this.accum += dt;
    let steps = 0;
    while (this.accum >= NET.SIM_DT && steps < 6) {
      this.accum -= NET.SIM_DT;
      steps++;
      const q = this.predictor.step(this._buildInput());
      this.recent.push(q);
      if (this.recent.length > NET.INPUT_REDUNDANCY) this.recent.shift();
      if (this.onInputs) this.onInputs(this.recent);
    }
    if (steps === 6) this.accum = 0;

    const p = this.predictor.renderPos(dt, this.renderPos, this.accum / NET.SIM_DT);
    const s = this.predictor.state;
    const moving = this.moving;
    const sprint = moving && this.sprinting && this.predictor.lastMode === 'walk';

    // footsteps by distance travelled on the ground
    if (this.predictor.lastMode === 'walk' && s.onGround && moving) {
      this.stepDistance += Math.hypot(p.x - this.lastStepPos.x, p.z - this.lastStepPos.z);
      const stride = sprint ? 2.2 : 1.7;
      if (this.stepDistance > stride) { this.stepDistance = 0; if (this.onFootstep) this.onFootstep(); }
    } else this.stepDistance = 0;
    this.lastStepPos.x = p.x; this.lastStepPos.z = p.z;

    // head bob
    if (moving && s.onGround && this.settings.headBob && this.predictor.lastMode === 'walk') this.bobT += dt * (sprint ? 13 : 9);
    const bob = this.settings.headBob && moving && s.onGround ? Math.sin(this.bobT) * 0.035 : 0;
    const bobX = this.settings.headBob && moving && s.onGround ? Math.cos(this.bobT * 0.5) * 0.02 : 0;

    // FOV: sprint punch, kill pull-in
    if (this.killFovT > 0) this.killFovT -= dt;
    const targetFov = this.killFovT > 0 ? CAMERA.FOV_KILL : sprint ? this.settings.fov + (CAMERA.FOV_SPRINT - CAMERA.FOV) : this.settings.fov;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 8);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }

    const eyeY = p.y + PLAYER.EYE_HEIGHT + bob;
    const cam = this.camera;
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch;
    cam.rotation.z = 0;
    if (this.settings.thirdPerson) {
      // shoulder cam: same FOV cone and vision radius, so it grants no advantage
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const eye = this._tmp.set(p.x + rx * CAMERA.THIRD_PERSON_SHOULDER, eyeY + 0.2, p.z + rz * CAMERA.THIRD_PERSON_SHOULDER);
      const back = this._tmp2.set(-fx * Math.cos(this.pitch), -Math.sin(this.pitch) * -1, -fz * Math.cos(this.pitch));
      // pull the camera in if a wall is behind us
      let dist = CAMERA.THIRD_PERSON_DIST;
      const hit = this.world ? this.world.raycast([eye.x, eye.y, eye.z], [back.x, back.y, back.z], dist + 0.3) : null;
      if (hit !== null) dist = Math.max(0.5, hit - 0.3);
      cam.position.set(eye.x + back.x * dist, eye.y + back.y * dist, eye.z + back.z * dist);
      this.view.group.visible = true;
      this.view.group.position.set(p.x, p.y, p.z);
      this.view.group.rotation.y = this.yaw;
      this.view.setSpeaking(this.speaking);
      this.view.update(dt, { moving, sprinting: sprint, distToCamera: 0 });
    } else {
      cam.position.set(p.x + bobX, eyeY, p.z);
      this.view.group.visible = false;
    }
  }

  killPunch() { this.killFovT = 0.5; }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.view.dispose();
  }
}
