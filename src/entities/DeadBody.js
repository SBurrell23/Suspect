import * as THREE from 'three';
import { makeSplat } from '../world/textures.js';

// A tipped-over capsule with a stylized geometric splat beneath. Not gory.
export class DeadBody {
  constructor(id, slot, colorHex, pos, yaw = 0) {
    this.id = id;
    this.slot = slot;
    this.pos = { x: pos.x, y: pos.y, z: pos.z };
    this.group = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.55, 4, 12), this.mat);
    body.rotation.z = Math.PI / 2;
    body.position.set(0, 0.36, 0);
    // a visible "bone" stub so it reads as a body at a glance
    const stubMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8), stubMat);
    stub.rotation.z = Math.PI / 2;
    stub.position.set(0.7, 0.32, 0);
    this.splatTex = makeSplat(colorHex);
    this.splatMat = new THREE.MeshBasicMaterial({ map: this.splatTex, transparent: true, depthWrite: false });
    const splat = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), this.splatMat);
    splat.rotation.x = -Math.PI / 2;
    splat.position.y = 0.02;
    this.group.add(body, stub, splat);
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.rotation.y = yaw;
    this.meshes = [body, stub, splat];
    this.stubMat = stubMat;
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.mat.dispose(); this.stubMat.dispose(); this.splatMat.dispose(); this.splatTex.dispose();
  }
}
