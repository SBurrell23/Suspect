import { CharacterView } from './Player.js';
import { Interpolator } from '../net/interpolation.js';
import { FLAG } from '../net/protocol.js';
import { NET, RULES } from '../config.js';

export class RemotePlayer {
  constructor(slot, colorHex, name, scene) {
    this.slot = slot;
    this.scene = scene;
    this.view = new CharacterView(colorHex, name);
    this.interp = new Interpolator();
    this.flags = FLAG.ALIVE;
    this.pos = { x: 0, y: -100, z: 0 };
    this.yaw = 0;
    this.culled = false;
    this.hasData = false;
    this.lastSnapTime = 0;
    this._s = {};
    scene.add(this.view.group);
    this.view.group.visible = false;
  }

  pushSnapshot(rec, now) {
    this.interp.push({ t: now, x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw });
    this.flags = rec.flags;
    this.hasData = true;
    this.lastSnapTime = now;
  }

  teleport(x, y, z, yaw) {
    this.interp.clear();
    this.interp.push({ t: performance.now(), x, y, z, yaw });
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
  }

  get ghost() { return (this.flags & FLAG.GHOST) !== 0 || (this.flags & FLAG.ALIVE) === 0; }
  get venting() { return (this.flags & FLAG.VENTING) !== 0; }

  update(dt, now, camPos, { visionRadius, viewerIsGhost, lightsOut, speaking }) {
    const s = this.interp.sample(now - NET.INTERP_DELAY_MS, this._s);
    if (s) {
      this.pos.x = s.x; this.pos.y = s.y; this.pos.z = s.z; this.yaw = s.yaw;
      this.view.group.position.set(s.x, s.y, s.z);
      this.view.group.rotation.y = s.yaw;
      this.view.setOpacity(s.starved ? 0.55 : 1);
    }
    const ghost = this.ghost;
    this.view.setGhost(ghost);
    this.view.setSpeaking(!!speaking);
    const dx = this.pos.x - camPos.x, dy = this.pos.y - camPos.y, dz = this.pos.z - camPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // distance culling with hysteresis so players don't pop at the boundary
    if (viewerIsGhost) this.culled = false;
    else if (this.culled && d < visionRadius - RULES.VISION_HYSTERESIS * 0.5) this.culled = false;
    else if (!this.culled && d > visionRadius + RULES.VISION_HYSTERESIS * 0.5) this.culled = true;
    const hiddenGhost = ghost && !viewerIsGhost;
    this.view.group.visible = this.hasData && !this.culled && !hiddenGhost && !this.venting;
    if (this.view.group.visible) {
      this.view.update(dt, {
        moving: (this.flags & FLAG.MOVING) !== 0,
        sprinting: (this.flags & FLAG.SPRINTING) !== 0,
        distToCamera: d,
        lightsOut,
      });
    }
    return d;
  }

  setInfo(colorHex, name) { this.view.setColor(colorHex); this.view.setName(name); }

  dispose() {
    this.scene.remove(this.view.group);
    this.view.dispose();
  }
}
