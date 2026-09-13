// Remote player smoothing: buffer snapshots, render at now - INTERP_DELAY, lerp position and
// shortest-arc interpolate yaw between the two bracketing snapshots.
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Interpolator {
  constructor() {
    this.buf = [];
    this.last = null;
  }

  push(sample) {
    // sample: { t, x, y, z, yaw }
    const n = this.buf.length;
    if (n && sample.t <= this.buf[n - 1].t) sample.t = this.buf[n - 1].t + 1;
    this.buf.push(sample);
    if (this.buf.length > 40) this.buf.shift();
  }

  clear() { this.buf.length = 0; this.last = null; }

  // Returns { x, y, z, yaw, starved } or null if nothing buffered.
  sample(renderTime, out = {}) {
    const b = this.buf;
    if (!b.length) return null;
    // prune everything older than the second-newest sample before renderTime
    while (b.length > 2 && b[1].t <= renderTime) b.shift();
    let a = b[0], c = b[1];
    if (!c) {
      out.x = a.x; out.y = a.y; out.z = a.z; out.yaw = a.yaw;
      out.starved = renderTime - a.t > 250;
      return out;
    }
    if (renderTime <= a.t) {
      out.x = a.x; out.y = a.y; out.z = a.z; out.yaw = a.yaw; out.starved = false;
      return out;
    }
    if (renderTime >= c.t) {
      // buffer starved: hold the last known position
      const last = b[b.length - 1];
      out.x = last.x; out.y = last.y; out.z = last.z; out.yaw = last.yaw;
      out.starved = renderTime - last.t > 250;
      return out;
    }
    const t = (renderTime - a.t) / (c.t - a.t);
    out.x = a.x + (c.x - a.x) * t;
    out.y = a.y + (c.y - a.y) * t;
    out.z = a.z + (c.z - a.z) * t;
    out.yaw = lerpAngle(a.yaw, c.yaw, t);
    out.starved = false;
    return out;
  }
}
