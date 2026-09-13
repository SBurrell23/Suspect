import * as THREE from 'three';

// Fog-of-war post-process. The scene is rendered to a target with a depth texture; this pass
// reconstructs the true view distance per pixel and darkens to black at the vision radius.
// (Not THREE.Fog — that would leave far players renderable; player meshes are also distance-culled.)
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform float uNear, uFar, uRadius, uAspect, uTanHalfFov, uPulse, uFlash, uTime, uSkyDark;
  uniform vec3 uFlashColor;
  varying vec2 vUv;
  float viewZ(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / ((uFar - uNear) * z - (uNear + uFar));
  }
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    float d = texture2D(tDepth, vUv).x;
    float vz = viewZ(d);
    vec2 ndc = vUv * 2.0 - 1.0;
    float vx = -vz * ndc.x * uTanHalfFov * uAspect;
    float vy = -vz * ndc.y * uTanHalfFov;
    float dist = length(vec3(vx, vy, vz));
    float dark = smoothstep(uRadius * 0.5, uRadius, dist);
    if (d >= 0.99999) dark = uSkyDark;
    vec3 col = c.rgb * (1.0 - dark);
    // soft edge vignette so the radius reads as a pool of light, not a hard disc
    float edge = smoothstep(0.75, 1.45, length(ndc));
    col *= 1.0 - edge * 0.3;
    // vulnerability pulse: red rim when someone is near while you are locked in a minigame
    float rim = smoothstep(0.5, 1.25, length(ndc));
    col = mix(col, vec3(0.75, 0.04, 0.04), rim * uPulse * (0.55 + 0.45 * sin(uTime * 9.0)));
    col = mix(col, uFlashColor, uFlash);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class VisionPass {
  constructor(renderer) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.width = Math.max(1, Math.floor(size.x * pr));
    this.height = Math.max(1, Math.floor(size.y * pr));
    this.depthTexture = new THREE.DepthTexture(this.width, this.height);
    this.depthTexture.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(this.width, this.height, {
      depthTexture: this.depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tDepth: { value: this.depthTexture },
        uNear: { value: 0.1 },
        uFar: { value: 500 },
        uRadius: { value: 12 },
        uAspect: { value: 1 },
        uTanHalfFov: { value: 1 },
        uPulse: { value: 0 },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 0, 0) },
        uTime: { value: 0 },
        uSkyDark: { value: 0.55 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.enabled = true;
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.width = Math.max(1, Math.floor(w * pr));
    this.height = Math.max(1, Math.floor(h * pr));
    this.rt.setSize(this.width, this.height);
  }

  render(scene, camera, params) {
    if (!this.enabled) { this.renderer.setRenderTarget(null); this.renderer.render(scene, camera); return; }
    const u = this.material.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uRadius.value = params.radius;
    u.uAspect.value = camera.aspect;
    u.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    u.uPulse.value = params.pulse || 0;
    u.uFlash.value = params.flash || 0;
    u.uSkyDark.value = params.skyDark ?? 0.55;
    if (params.flashColor) u.uFlashColor.value.set(params.flashColor);
    u.uTime.value = params.time || 0;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.drawCalls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.rt.dispose();
    this.depthTexture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
