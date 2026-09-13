import * as THREE from 'three';

// Binds a Web Audio node to a THREE.PositionalAudio attached to a character mesh so panning
// follows the player, and runs cheap occlusion raycasts against the collision layer.
export function createPositional(listener, sourceNode) {
  const pa = new THREE.PositionalAudio(listener);
  pa.setNodeSource(sourceNode);
  pa.setDistanceModel('inverse');
  pa.setRefDistance(3);
  pa.setMaxDistance(18);
  pa.setRolloffFactor(2);
  pa.panner.panningModel = 'HRTF';
  pa.setDirectionalCone(360, 360, 0);
  return pa;
}

// Raycast from listener to speaker against the collision AABBs. Returns true if blocked.
export function isOccluded(collision, from, to) {
  if (!collision) return false;
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 0.5) return false;
  const hit = collision.raycast(from, [dx / d, dy / d, dz / d], d - 0.3);
  return hit !== null;
}

// Route THREE's AudioListener output through our voice bus instead of straight to destination.
export function attachListenerToBus(listener, bus) {
  try { listener.gain.disconnect(); } catch (e) { /* not connected */ }
  listener.gain.connect(bus);
}
