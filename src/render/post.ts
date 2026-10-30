// Final screen pass (after tone mapping): heat shimmer for the long lens, an engine
// glare, an anamorphic streak and ghosts (ignition flash only), vignette and film grain.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.035 },
    uShimmer: { value: 0 },
    uFlarePos: { value: new THREE.Vector2(0.5, 0.5) },
    uFlare: { value: 0 },
    uStreak: { value: 0 },
    uGhost: { value: 0 },
    uMaskPos: { value: new THREE.Vector2(-9, -9) },
    uMaskR: { value: 0.1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uShimmer;
    uniform vec2 uFlarePos;
    uniform float uFlare;
    uniform float uStreak;
    uniform float uGhost;
    uniform vec2 uMaskPos;
    uniform float uMaskR;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 ghost(vec2 uv, vec2 at, float r, vec3 tint) {
      vec2 d = (uv - at) * vec2(uAspect, 1.0);
      float l = length(d);
      return tint * (1.0 - smoothstep(r * 0.6, r, l)) * 0.12;
    }

    void main() {
      vec2 uv = vUv;
      if (uShimmer > 0.0) {
        // Rising hot air near the ground: strongest in the bottom of the frame.
        float k = uShimmer * (1.0 - smoothstep(0.1, 0.75, uv.y));
        uv.x += sin(uv.y * 210.0 + uTime * 11.0 + sin(uv.x * 37.0 + uTime * 3.0) * 2.0) * 0.0011 * k;
        uv.y += cos(uv.x * 170.0 + uTime * 8.0) * 0.0007 * k;
      }
      vec3 c = texture2D(tDiffuse, uv).rgb;

      if (uFlare > 0.0 || uStreak > 0.0) {
        vec2 d = (vUv - uFlarePos) * vec2(uAspect, 1.0);
        float r2 = dot(d, d);
        float glow = 0.012 / (r2 * 60.0 + 0.012);
        // A thin anamorphic line, only in the ignition flash.
        float streak = exp(-abs(d.y) * 1700.0) * exp(-abs(d.x) * 2.6);
        vec3 warm = vec3(1.0, 0.62, 0.32);
        c += uFlare * warm * glow * 0.45 + uStreak * vec3(1.0, 0.72, 0.5) * streak * 0.55;
        if (uGhost > 0.0) {
          vec2 axis = vec2(0.5) - uFlarePos;
          vec3 g = ghost(vUv, uFlarePos + axis * 1.3, 0.035, vec3(0.6, 0.8, 1.0));
          g += ghost(vUv, uFlarePos + axis * 1.75, 0.07, vec3(1.0, 0.6, 0.4));
          g += ghost(vUv, uFlarePos + axis * 2.2, 0.02, vec3(0.7, 1.0, 0.7));
          // No ghosts over the tower top.
          float m = length((vUv - uMaskPos) * vec2(uAspect, 1.0));
          c += uGhost * g * smoothstep(uMaskR, uMaskR * 2.0, m);
        }
      }

      vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
      float vig = 1.0 - smoothstep(0.25, 0.95, length(v) / max(1.0, uAspect * 0.62));
      c *= mix(1.0 - uVignette, 1.0, vig);

      float g = hash12(vUv * vec2(1931.0, 1171.0) + fract(uTime * 7.31) * 113.0) - 0.5;
      c += g * uGrain * (0.6 + 0.4 * (1.0 - dot(c, vec3(0.299, 0.587, 0.114))));
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export class FinishPass extends ShaderPass {
  constructor() {
    super(FinishShader);
  }

  set(o: {
    time: number;
    aspect: number;
    shimmer: number;
    /** Soft glow around the engines. */
    flare: number;
    /** Anamorphic streak and ghosts: the ignition flash only. */
    streak: number;
    ghost: number;
    flareX: number;
    flareY: number;
    /** Screen point (uv) and radius where ghosts are masked out (the tower top). */
    maskX: number;
    maskY: number;
    maskR: number;
    grain: number;
    vignette: number;
  }): void {
    const u = this.uniforms as Record<string, THREE.IUniform>;
    u['uTime']!.value = o.time;
    u['uAspect']!.value = o.aspect;
    u['uShimmer']!.value = o.shimmer;
    u['uFlare']!.value = o.flare;
    u['uStreak']!.value = o.streak;
    u['uGhost']!.value = o.ghost;
    (u['uFlarePos']!.value as THREE.Vector2).set(o.flareX, o.flareY);
    (u['uMaskPos']!.value as THREE.Vector2).set(o.maskX, o.maskY);
    u['uMaskR']!.value = o.maskR;
    u['uGrain']!.value = o.grain;
    u['uVignette']!.value = o.vignette;
  }
}
