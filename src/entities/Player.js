import * as THREE from 'three';
import { makeNameplate, makeRing } from '../world/textures.js';
import { RULES } from '../config.js';

// Shared immutable materials
let visorMat = null, ringTex = null;
function sharedVisor() {
  if (!visorMat) visorMat = new THREE.MeshStandardMaterial({ color: 0x16253f, metalness: 0.9, roughness: 0.1 });
  return visorMat;
}
function sharedRing() {
  if (!ringTex) ringTex = makeRing(0x9cff7a);
  return ringTex;
}

function darken(hex, f) {
  const r = ((hex >> 16) & 255) * f, g = ((hex >> 8) & 255) * f, b = (hex & 255) * f;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

// Procedural character: capsule body, visor, backpack, two legs, nameplate, speaking ring.
// No skeletal animation — everything is sine-driven.
export class CharacterView {
  constructor(colorHex = 0xd6332b, name = '') {
    this.group = new THREE.Group();
    this.colorHex = colorHex;
    this.name = name;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55, metalness: 0.1, transparent: true, opacity: 1 });
    this.legMat = new THREE.MeshStandardMaterial({ color: darken(colorHex, 0.7), roughness: 0.7, metalness: 0.1, transparent: true, opacity: 1 });
    this.packMat = new THREE.MeshStandardMaterial({ color: darken(colorHex, 0.85), roughness: 0.6, metalness: 0.15, transparent: true, opacity: 1 });

    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 14), this.bodyMat);
    this.body.position.y = 1.0;
    this.body.castShadow = true;

    this.visor = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), sharedVisor());
    this.visor.scale.set(1, 0.62, 0.5);
    this.visor.position.set(0, 1.28, -0.3);

    this.pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.24, 1, 1, 1), this.packMat);
    this.pack.position.set(0, 1.0, 0.4);

    const legGeo = new THREE.CapsuleGeometry(0.12, 0.18, 3, 8);
    this.legL = new THREE.Mesh(legGeo, this.legMat);
    this.legR = new THREE.Mesh(legGeo, this.legMat);
    this.legL.position.set(-0.17, 0.2, 0);
    this.legR.position.set(0.17, 0.2, 0);

    this.torso = new THREE.Group();
    this.torso.add(this.body, this.visor, this.pack);
    this.group.add(this.torso, this.legL, this.legR);

    // nameplate sprite
    this.nameTex = makeNameplate(name || ' ', colorHex);
    this.nameMat = new THREE.SpriteMaterial({ map: this.nameTex, transparent: true, depthWrite: false });
    this.nameplate = new THREE.Sprite(this.nameMat);
    this.nameplate.scale.set(1.6, 0.4, 1);
    this.nameplate.position.y = 2.15;
    this.group.add(this.nameplate);

    // speaking ring
    this.ringMat = new THREE.SpriteMaterial({ map: sharedRing(), transparent: true, depthWrite: false, opacity: 0 });
    this.ring = new THREE.Sprite(this.ringMat);
    this.ring.scale.set(0.6, 0.6, 1);
    this.ring.position.y = 2.5;
    this.group.add(this.ring);

    this.t = Math.random() * 10;
    this.ghost = false;
    this.speaking = false;
    this.opacity = 1;
    this._anim = null; // { type, t, dur }
  }

  setName(name) {
    if (name === this.name) return;
    this.name = name;
    this.nameTex.dispose();
    this.nameTex = makeNameplate(name || ' ', this.colorHex);
    this.nameMat.map = this.nameTex;
    this.nameMat.needsUpdate = true;
  }

  setColor(hex) {
    if (hex === this.colorHex) return;
    this.colorHex = hex;
    this.bodyMat.color.setHex(hex);
    this.legMat.color.setHex(darken(hex, 0.7));
    this.packMat.color.setHex(darken(hex, 0.85));
    this.nameTex.dispose();
    this.nameTex = makeNameplate(this.name || ' ', hex);
    this.nameMat.map = this.nameTex;
    this.nameMat.needsUpdate = true;
  }

  setGhost(on) {
    if (this.ghost === on) return;
    this.ghost = on;
    for (const m of [this.bodyMat, this.legMat, this.packMat]) {
      m.opacity = on ? 0.35 : this.opacity;
      m.depthWrite = !on;
    }
    this.visor.material = on ? new THREE.MeshStandardMaterial({ color: 0x16253f, metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }) : sharedVisor();
  }

  // Connection-hiccup fade (remote players whose snapshot buffer starved)
  setOpacity(a) {
    if (this.ghost) return;
    if (Math.abs(a - this.opacity) < 0.01) return;
    this.opacity = a;
    for (const m of [this.bodyMat, this.legMat, this.packMat]) m.opacity = a;
  }

  setSpeaking(on) { this.speaking = on; }

  setNameplateVisible(v) { this.nameplate.visible = v; }

  playKillLunge() { this._anim = { type: 'lunge', t: 0, dur: 0.45 }; }
  playVent(entering) { this._anim = { type: entering ? 'ventIn' : 'ventOut', t: 0, dur: 0.4 }; }
  playEject() { this._anim = { type: 'eject', t: 0, dur: 6 }; }

  // moving/sprinting flags, speed (m/s), distToCamera for nameplate fade
  update(dt, { moving = false, sprinting = false, distToCamera = 0, lightsOut = false } = {}) {
    this.t += dt;
    const g = this.group;
    // walk cycle
    const freq = sprinting ? 13 : 9;
    const amp = moving ? (sprinting ? 0.5 : 0.35) : 0;
    const s = Math.sin(this.t * freq);
    this.legL.position.z = -s * amp * 0.5;
    this.legR.position.z = s * amp * 0.5;
    this.legL.position.y = 0.2 + Math.max(0, s) * amp * 0.25;
    this.legR.position.y = 0.2 + Math.max(0, -s) * amp * 0.25;
    // body bob & lean
    const bob = moving ? Math.abs(Math.sin(this.t * freq)) * (sprinting ? 0.06 : 0.04) : Math.sin(this.t * 1.5) * 0.012;
    this.torso.position.y = bob + (this.ghost ? 0.5 + Math.sin(this.t * 1.2) * 0.18 : 0);
    this.torso.rotation.x = sprinting && moving ? -0.18 : moving ? -0.06 : 0;
    this.torso.rotation.z = moving ? Math.sin(this.t * freq * 0.5) * 0.03 : Math.sin(this.t * 0.9) * 0.01;
    this.legL.visible = this.legR.visible = !this.ghost;
    // ring / nameplate
    this.ringMat.opacity += ((this.speaking ? 0.95 : 0) - this.ringMat.opacity) * Math.min(1, dt * 12);
    this.ring.visible = this.ringMat.opacity > 0.02;
    if (this.ring.visible) this.ring.material.rotation += dt * 2;
    const fade = lightsOut ? 0 : THREE.MathUtils.clamp(1 - (distToCamera - RULES.NAMEPLATE_FADE * 0.6) / (RULES.NAMEPLATE_FADE * 0.4), 0, 1);
    this.nameMat.opacity = fade;
    this.nameplate.visible = fade > 0.02;
    // one-shot animations
    if (this._anim) {
      const a = this._anim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      if (a.type === 'lunge') {
        this.torso.position.z = -Math.sin(k * Math.PI) * 0.6;
        this.torso.rotation.x = -Math.sin(k * Math.PI) * 0.5;
      } else if (a.type === 'ventIn') {
        const sc = 1 - k;
        g.scale.set(1 + k * 0.4, Math.max(0.01, sc), 1 + k * 0.4);
      } else if (a.type === 'ventOut') {
        g.scale.set(1.4 - k * 0.4, Math.max(0.01, k), 1.4 - k * 0.4);
      } else if (a.type === 'eject') {
        this.torso.rotation.z = k * Math.PI * 6;
        this.torso.position.y = k * 8;
        this.setOpacity(1 - k);
      }
      if (k >= 1) {
        if (a.type === 'ventIn') g.scale.set(1, 0.01, 1);
        else { g.scale.set(1, 1, 1); this.torso.position.z = 0; }
        this._anim = null;
      }
    }
  }

  dispose() {
    this.body.geometry.dispose();
    this.visor.geometry.dispose();
    this.pack.geometry.dispose();
    this.legL.geometry.dispose();
    this.bodyMat.dispose(); this.legMat.dispose(); this.packMat.dispose();
    this.nameTex.dispose(); this.nameMat.dispose(); this.ringMat.dispose();
    if (this.visor.material !== visorMat) this.visor.material.dispose();
  }
}
