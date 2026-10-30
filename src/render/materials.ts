// Procedural materials and textures. No image files: the sky, sea, hull, plume and
// particles are all drawn here, in shaders or on small canvases at start-up.
import * as THREE from 'three';
import { BOOSTER_DIAMETER, BOOSTER_LENGTH } from '../sim/constants';

/** Low dusk sun over the sea (+x), a little toward -z (about 6 deg up). */
export const SUN_DIR = new THREE.Vector3(0.8, 0.105, -0.52).normalize();
/** Exponential-squared haze shared by the scene fog and the custom shaders. */
export const FOG_DENSITY = 1 / 6200;
export const FOG_COLOR = new THREE.Color().setRGB(0.74, 0.56, 0.47);
export const PLUME_COLOR = new THREE.Color().setRGB(1.0, 0.55, 0.22);

// ---------------------------------------------------------------- GLSL chunks

const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x);
    float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x);
    float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x);
    float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
  }
  float fbm3(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s;
  }
`;

/**
 * Analytic dusk sky (linear HDR): Rayleigh-like gradient from a warm horizon toward the
 * sun to a deep blue zenith, a Mie glow, the sun disc and a band of low stratus.
 */
const SKY_GLSL = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uClouds;
  vec3 skyColor(vec3 d, bool clouds) {
    float h = d.y;
    float sunCos = dot(d, uSunDir);
    vec2 az = normalize(d.xz + vec2(1e-5));
    vec2 sunAz = normalize(uSunDir.xz);
    float toSun = dot(az, sunAz) * 0.5 + 0.5;
    vec3 horizCool = vec3(0.50, 0.46, 0.58);
    vec3 horizWarm = vec3(1.45, 0.66, 0.28);
    vec3 horizon = mix(horizCool, horizWarm, pow(toSun, 2.2));
    vec3 midSky = mix(vec3(0.30, 0.42, 0.62), vec3(0.62, 0.55, 0.52), pow(toSun, 3.0));
    vec3 zenith = vec3(0.07, 0.15, 0.36);
    float hh = max(h, 0.0);
    vec3 c = mix(horizon, midSky, smoothstep(0.0, 0.22, pow(hh, 0.75)));
    c = mix(c, zenith, smoothstep(0.18, 0.95, hh));
    float s = max(sunCos, 0.0);
    c += vec3(1.0, 0.62, 0.32) * (pow(s, 10.0) * 0.55 + pow(s, 90.0) * 1.2) * (1.0 - 0.6 * smoothstep(0.0, 0.5, hh));
    c += vec3(40.0, 26.0, 12.0) * smoothstep(0.99975, 0.99988, sunCos);
    // Uniform branches: cheap tiers skip the cirrus, and pixels outside the bands skip the noise.
    if (clouds && uClouds > 0.0 && h > 0.01 && h < 0.7) {
      vec2 p = d.xz / max(h, 0.02);
      if (h < 0.2) {
        // Soft stratus: a lower noise frequency (no horizontal scanlines near the horizon), wide
        // band edges, low contrast, and never darker than the sky behind it.
        float n = fbm3(vec3(p * vec2(0.32, 0.9), 0.0));
        float band = smoothstep(0.006, 0.07, h) * (1.0 - smoothstep(0.05, 0.2, h));
        float low = smoothstep(0.48, 0.86, n) * band;
        vec3 lowCol = mix(c * vec3(1.06, 1.0, 1.02) + vec3(0.025, 0.018, 0.022), vec3(1.25, 0.66, 0.36), pow(s, 6.0));
        c = mix(c, max(lowCol, c), low * 0.5);
      }
      if (uClouds > 0.75 && h > 0.08) {
        float hi = smoothstep(0.55, 0.9, fbm3(vec3(p * vec2(0.08, 0.5), 3.0)));
        float hiBand = smoothstep(0.08, 0.2, h) * (1.0 - smoothstep(0.35, 0.7, h));
        c += vec3(0.9, 0.48, 0.42) * hi * hiBand * 0.35 * (0.4 + toSun);
      }
    }
    c = mix(c, horizon * 0.42, 1.0 - smoothstep(-0.06, 0.0, h));
    return c;
  }
`;

function skyUniforms(): Record<string, THREE.IUniform> {
  return { uSunDir: { value: SUN_DIR.clone() }, uClouds: { value: 1 } };
}

export function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms(),
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir), true), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Open sea: summed directional waves for the normal, Fresnel sky reflection, a sun
 * glint path, the orange plume glint and light pool, shore foam and horizon haze.
 */
export function makeWaterMaterial(shoreX: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      ...skyUniforms(),
      uTime: { value: 0 },
      uPlumePos: { value: new THREE.Vector3(0, -1000, 0) },
      uPlume: { value: 0 },
      uPlumeCol: { value: PLUME_COLOR.clone() },
      uShoreX: { value: shoreX },
      uFogDensity: { value: FOG_DENSITY },
      uSplash: { value: new THREE.Vector4(0, 0, 0, 0) },
      // Plume downwash on the water: x, z, ring radius (m), strength 0..1.
      uWash: { value: new THREE.Vector4(0, 0, 0, 0) },
      uDetail: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${SKY_GLSL}
      uniform float uTime;
      uniform vec3 uPlumePos;
      uniform float uPlume;
      uniform vec3 uPlumeCol;
      uniform float uShoreX;
      uniform float uFogDensity;
      uniform vec4 uSplash;
      uniform vec4 uWash;
      uniform float uDetail;
      varying vec3 vWorld;

      vec2 wave(vec2 p, vec2 dir, float len, float amp, float fade) {
        float k = 6.2831853 / len;
        float w = sqrt(9.81 * k);
        float ph = dot(normalize(dir), p) * k + uTime * w;
        return normalize(dir) * amp * k * cos(ph) * fade;
      }

      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vWorld.xz;
        float f1 = 1.0 / (1.0 + dist * 0.0015);
        float f2 = 1.0 / (1.0 + dist * 0.006);
        float f3 = 1.0 / (1.0 + dist * 0.02);
        vec2 g = vec2(0.0);
        g += wave(p, vec2(-1.0, 0.25), 61.0, 0.55, f1);
        g += wave(p, vec2(-0.8, -0.6), 37.0, 0.32, f1);
        g += wave(p, vec2(-0.3, 1.0), 23.0, 0.2, f2);
        g += wave(p, vec2(-1.0, -0.15), 11.3, 0.09, f2);
        g += wave(p, vec2(0.6, 1.0), 6.7, 0.05, f3);
        g += wave(p, vec2(-0.9, 0.7), 3.1, 0.024, f3);
        float detail = 0.0;
        if (uDetail > 0.0) {
          float n = vnoise(vec3(p * 0.35, uTime * 0.6)) - 0.5;
          g += vec2(n, -n) * 0.06 * f3;
          detail = 1.0;
        }
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

        float ndv = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y) + 0.01;
        vec3 refl = skyColor(normalize(R), false);
        vec3 body = vec3(0.012, 0.045, 0.06) + skyColor(vec3(0.0, 1.0, 0.0), false) * 0.035;
        vec3 col = mix(body, refl, fres);

        vec3 H = normalize(V + uSunDir);
        float nh = max(dot(N, H), 0.0);
        col += vec3(1.0, 0.68, 0.38) * (pow(nh, 900.0) * 60.0 + pow(nh, 90.0) * 0.9);

        vec3 L = uPlumePos - vWorld;
        float ld = length(L);
        L /= ld;
        vec3 Hp = normalize(V + L);
        float att = uPlume / (1.0 + ld * ld * 0.00025);
        col += uPlumeCol * att * (pow(max(dot(N, Hp), 0.0), 140.0) * 7.0 + 0.05 * max(L.y, 0.0));

        float sd = vWorld.x - uShoreX;
        float shallow = 1.0 - smoothstep(0.0, 70.0, sd);
        col = mix(col, col * vec3(0.9, 1.15, 1.05) + vec3(0.02, 0.05, 0.045), shallow * 0.6);
        if (sd < 40.0) {
          float wob = sin(p.y * 0.031) * 1.6 + sin(p.y * 0.11 + 1.3) * 0.9;
          float surf = smoothstep(0.82, 1.0, sin(sd * 0.21 - uTime * 1.3 + wob));
          float foam = (1.0 - smoothstep(0.0, 34.0, sd)) * (0.35 + surf) + (1.0 - smoothstep(0.0, 4.0, sd));
          if (detail > 0.0) foam *= 0.65 + 0.35 * vnoise(vec3(p * 0.4, uTime * 0.3));
          col = mix(col, vec3(0.75, 0.68, 0.62), clamp(foam, 0.0, 1.0) * 0.75);
        }

        if (uWash.w > 0.0) {
          // Downwash: a churned white disc under the plume and a spray ring racing outward.
          vec2 dv = vWorld.xz - uWash.xy;
          float wr = length(dv);
          vec2 dn = dv / max(wr, 0.001); // direction, not angle: no seam
          float rough = vnoise(vec3(dn * 2.5 + vec2(wr * 0.05 - uTime * 1.8), uTime * 0.7));
          float ring = exp(-pow((wr - uWash.z * (0.82 + 0.3 * rough)) / (uWash.z * 0.18 + 2.0), 2.0));
          float disc = (1.0 - smoothstep(0.0, uWash.z * 0.8, wr)) * (0.45 + 0.55 * rough);
          col = mix(col, vec3(0.88, 0.86, 0.82), clamp((ring * 0.85 + disc * 0.6) * uWash.w, 0.0, 0.85));
        }
        if (uSplash.w > 0.0) {
          float sr = length(vWorld.xz - uSplash.xy);
          float ring = exp(-pow((sr - uSplash.z) / 6.0, 2.0)) + 0.6 * (1.0 - smoothstep(0.0, uSplash.z, sr));
          col = mix(col, vec3(0.8, 0.82, 0.82), clamp(ring * uSplash.w, 0.0, 0.85));
        }

        float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
        vec3 hz = skyColor(normalize(vec3(-V.x, 0.02, -V.z)), false);
        col = mix(col, hz, fog);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Wet sand at the waterline: dark damp sand with a Fresnel mirror of the dusk sky, a sun
 * glint, and two thin swash foam lines that run up and back. Fades out up the beach.
 */
export function makeWetSandMaterial(shoreX: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    uniforms: {
      ...skyUniforms(),
      uTime: { value: 0 },
      uShoreX: { value: shoreX },
      uFogDensity: { value: FOG_DENSITY },
      uDetail: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${SKY_GLSL}
      uniform float uTime;
      uniform float uShoreX;
      uniform float uFogDensity;
      uniform float uDetail;
      varying vec3 vWorld;
      void main() {
        float d = uShoreX - vWorld.x; // metres up the beach from the waterline
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float n = vnoise(vec3(vWorld.xz * vec2(0.09, 0.025), 0.0));
        float n2 = uDetail > 0.0 ? vnoise(vec3(vWorld.xz * 0.7, 2.0)) : 0.5;
        // Damp band: wide where the swash reaches far, narrow elsewhere.
        float wet = 1.0 - smoothstep(3.0 + 3.0 * n, 10.0 + 5.0 * n, d);
        vec3 N = normalize(vec3((n2 - 0.5) * 0.06, 1.0, (n - 0.5) * 0.05));
        vec3 R = reflect(-V, N);
        R.y = abs(R.y) + 0.01;
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 sand = mix(vec3(0.15, 0.11, 0.075), vec3(0.2, 0.15, 0.1), n2);
        vec3 col = mix(sand, skyColor(normalize(R), false), clamp(fres * 0.9 + 0.08, 0.0, 1.0));
        vec3 H = normalize(V + uSunDir);
        col += vec3(1.0, 0.68, 0.38) * pow(max(dot(N, H), 0.0), 260.0) * 3.0;
        // Swash: a foam edge that runs up and back, and a fainter older line above it.
        float run = 1.6 + 1.3 * sin(uTime * 0.42 + vWorld.z * 0.0037 + n * 2.0);
        float edge = exp(-pow((d - run - (n2 - 0.5) * 0.8) / 0.22, 2.0));
        float older = exp(-pow((d - 4.2 - 1.6 * n) / 0.3, 2.0)) * 0.45;
        float lace = 0.6 + 0.4 * n2;
        col = mix(col, vec3(0.82, 0.78, 0.72), clamp((edge + older) * lace, 0.0, 0.85));
        float a = clamp(max(wet, (edge + older) * lace), 0.0, 1.0) * 0.92;
        float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
        vec3 hz = skyColor(normalize(vec3(-V.x, 0.02, -V.z)), false);
        col = mix(col, hz, fog);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------------------------------------------------------------- plume

type RGB = readonly [number, number, number];

/** Colours and strengths for the plume shaders (every value 0..1; see plumeTone). */
export interface PlumeTone {
  envCore: RGB;
  envEdge: RGB;
  envTail: RGB;
  coreCore: RGB;
  coreEdge: RGB;
  /** Shock-diamond strength (lifts the core toward uCore; it never adds light past it). */
  diamonds: number;
  envIntensity: number;
  coreIntensity: number;
}

/** The nozzle glow sprite colour (held at or below 1.0, so it keeps its hue). */
export const NOZZLE_GLOW_RGB: RGB = [1.0, 0.42, 0.16];

/**
 * Plume colours for the 13-engine and the 3-engine burn. Every channel stays at or below 1.0
 * after the heat and flash multipliers, so tone mapping and bloom cannot clip the plume to
 * white: the brightness comes from area and overlap, and the colours are saturated enough
 * (low green and blue) to keep their hue through ACES. 3 engines: one continuous salmon
 * (pink-orange) pillar with subtle diamonds. 13 engines: an orange flame fading to cream smoke.
 */
export function plumeTone(many: boolean, heat: number, flash: number): PlumeTone {
  const h = Math.min(1, Math.max(0, heat));
  const fl = Math.min(1, Math.max(0, flash));
  if (many) {
    return {
      envCore: [1.0, 0.42, 0.09],
      envEdge: [1.0, 0.27, 0.035],
      envTail: [0.62, 0.52, 0.4],
      coreCore: [1.0, 0.55, 0.17],
      coreEdge: [1.0, 0.33, 0.06],
      diamonds: 0.25,
      envIntensity: Math.min(1, (0.4 + 0.3 * h) * (1 + fl)),
      coreIntensity: Math.min(1, 0.3 + 0.15 * h),
    };
  }
  return {
    envCore: [1.0, 0.36, 0.22],
    envEdge: [1.0, 0.25, 0.15],
    envTail: [0.7, 0.21, 0.15],
    coreCore: [1.0, 0.47, 0.29],
    coreEdge: [1.0, 0.3, 0.18],
    diamonds: 0.5,
    envIntensity: Math.min(1, (0.42 + 0.18 * h) * (1 + 0.5 * fl)),
    coreIntensity: Math.min(1, 0.3 + 0.12 * h),
  };
}

/** Turbulent outer envelope (13 engines: wide and chaotic; 3 engines: a tight pillar). */
export function makePlumeEnvelopeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uCore: { value: new THREE.Color().setRGB(1.0, 0.42, 0.09) },
      uEdge: { value: new THREE.Color().setRGB(1.0, 0.27, 0.035) },
      uTail: { value: new THREE.Color().setRGB(0.62, 0.52, 0.4) },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
      uChaos: { value: 1 },
      uFogDensity: { value: FOG_DENSITY },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      varying vec3 vPos;
      varying float vDist;
      void main() {
        vUv = uv;
        vPos = position;
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform vec3 uTail;
      uniform float uIntensity;
      uniform float uTime;
      uniform float uChaos;
      uniform float uFogDensity;
      varying vec2 vUv;
      varying float vFacing;
      varying vec3 vPos;
      varying float vDist;
      void main() {
        float along = vUv.y;
        float n = fbm3(vec3(vPos.x * 4.0, vPos.y * 7.0 + uTime * 9.0, vPos.z * 4.0));
        float turb = mix(0.8, smoothstep(0.2, 0.85, n) * 1.4, uChaos);
        float body = pow(1.0 - along, 1.1) * smoothstep(0.0, 0.06, along + 0.01);
        float rim = pow(vFacing, 1.2);
        vec3 col = mix(uEdge, uCore, clamp((1.0 - along * 1.6) * rim, 0.0, 1.0));
        col = mix(col, uTail, smoothstep(0.35, 1.0, along));
        // Additive (src alpha, one): this adds col * a, never more than the colour itself.
        float a = clamp(body * rim * turb * uIntensity, 0.0, 1.0);
        float fogAtt = exp(-pow(vDist * uFogDensity, 2.0));
        gl_FragColor = vec4(min(col, vec3(1.0)) * fogAtt, a);
      }
    `,
  });
}

/** Per-engine cores (instanced) with pulsing shock diamonds (Mach disks). */
export function makePlumeCoreMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uCore: { value: new THREE.Color().setRGB(1.0, 0.47, 0.29) },
      uEdge: { value: new THREE.Color().setRGB(1.0, 0.3, 0.18) },
      uIntensity: { value: 0.3 },
      uTime: { value: 0 },
      uDiamonds: { value: 0.5 },
      uCells: { value: 5 },
      uFogDensity: { value: FOG_DENSITY },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      varying float vDist;
      void main() {
        vUv = uv;
        vec4 local = instanceMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vec4 mv = modelViewMatrix * local;
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform float uIntensity;
      uniform float uTime;
      uniform float uDiamonds;
      uniform float uCells;
      uniform float uFogDensity;
      varying vec2 vUv;
      varying float vFacing;
      varying float vDist;
      void main() {
        float along = vUv.y;
        float core = pow(vFacing, 2.0);
        float fade = pow(1.0 - along, 1.15);
        float k = along * uCells;
        float cell = fract(k);
        float disk = exp(-pow((cell - 0.18) * 7.0, 2.0)) * (1.0 - smoothstep(0.55, 0.95, along));
        float pulse = 0.85 + 0.15 * sin(uTime * 47.0 + floor(k) * 1.7);
        float shimmer = 0.9 + 0.1 * sin(uTime * 83.0 + along * 37.0);
        float dia = disk * uDiamonds * core * pulse;
        // A continuous shell between the diamonds (one pillar, not a row of dots). A diamond only
        // shifts the colour toward uCore and adds a little opacity: never past the uniforms.
        vec3 col = mix(uEdge, uCore, clamp(core * (1.15 - along) + dia, 0.0, 1.0));
        float a = clamp((fade * (0.6 + 0.4 * core) + dia * 0.5) * uIntensity * shimmer, 0.0, 1.0);
        float fogAtt = exp(-pow(vDist * uFogDensity, 2.0));
        gl_FragColor = vec4(min(col, vec3(1.0)) * fogAtt, a);
      }
    `,
  });
}

/** Lathe profile for a plume shell, length 1 along -y, nozzle at y = 0. uv.y = 0 at the nozzle. */
export function plumeLathe(r0: number, r1: number, power: number, segs: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * Math.pow(s, power), -s));
  }
  return new THREE.LatheGeometry(pts, segs);
}

// ---------------------------------------------------------------- particles

/**
 * Instanced soft billboards (steam, spray, dust, mist). Lit by the sun and by the
 * plume glow; per-instance position, size, alpha, rotation and tint.
 */
export function makeParticleMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uMap: { value: map },
      uSunDir: { value: SUN_DIR.clone() },
      uSunCol: { value: new THREE.Color().setRGB(1.25, 0.82, 0.55) },
      uAmbient: { value: new THREE.Color().setRGB(0.36, 0.38, 0.46) },
      uPlumePos: { value: new THREE.Vector3(0, -1000, 0) },
      uPlume: { value: 0 },
      uPlumeCol: { value: PLUME_COLOR.clone() },
      uFogDensity: { value: FOG_DENSITY },
      uFogColor: { value: FOG_COLOR.clone() },
    },
    vertexShader: /* glsl */ `
      attribute vec3 iPos;
      attribute vec4 iData; // size, alpha, rotation, unused
      attribute vec3 iTint;
      uniform vec3 uSunDir;
      uniform vec3 uSunCol;
      uniform vec3 uAmbient;
      uniform vec3 uPlumePos;
      uniform float uPlume;
      uniform vec3 uPlumeCol;
      uniform float uFogDensity;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vAlpha;
      varying float vFog;
      void main() {
        vUv = uv;
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float c = cos(iData.z);
        float s = sin(iData.z);
        vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
        mv.xy += q * iData.x;
        vec3 toP = uPlumePos - iPos;
        float glow = uPlume / (1.0 + dot(toP, toP) / 3600.0);
        float sun = 0.55 + 0.45 * clamp(uSunDir.y * 3.0 + 0.4, 0.0, 1.0);
        vCol = iTint * (uAmbient + uSunCol * sun) + uPlumeCol * glow * 1.4;
        vAlpha = iData.y;
        vFog = 1.0 - exp(-pow(-mv.z * uFogDensity, 2.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uFogColor;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vAlpha;
      varying float vFog;
      void main() {
        float m = texture2D(uMap, vUv).r;
        float a = m * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(vCol, uFogColor, vFog), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------------------------------------------------------------- canvases

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Billowy puff (red channel = density) for the particle billboards. */
export function makePuffTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const rnd = lcg(99);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * S * 0.24;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const rad = S * (0.12 + rnd() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,0,0,0.32)');
    g.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  // Fade to the edge so no square corners show.
  ctx.globalCompositeOperation = 'destination-in';
  const e = ctx.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S / 2);
  e.addColorStop(0, 'rgba(0,0,0,1)');
  e.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = e;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Radial glow for the nozzle sprite and lights. */
export function makeGlowTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- hull

export interface HullTextures {
  map: THREE.CanvasTexture;
  roughMetal: THREE.CanvasTexture; // G = roughness, B = metalness
  normal: THREE.CanvasTexture;
  glow: THREE.CanvasTexture; // emissive mask: bright at the engine end
}

/**
 * Livery panel (6 m x 18 m at 40 px/m): the original heron glyph above the stencil
 * tail number HB-07, read bottom-to-top along the hull.
 */
function makeLiveryCanvas(): HTMLCanvasElement {
  const PX = 40;
  const [c, ctx] = canvas(6 * PX, 18 * PX);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#18222c';
  ctx.strokeStyle = '#18222c';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Heron glyph in the top 6 m: body, S-neck, dagger beak, crest, one raised leg.
  ctx.save();
  ctx.translate(0.6 * PX, 0.4 * PX);
  ctx.scale(PX / 100, PX / 100);
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.moveTo(250, 330);
  ctx.bezierCurveTo(170, 270, 330, 220, 270, 140);
  ctx.bezierCurveTo(245, 105, 285, 70, 320, 82);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(318, 72);
  ctx.lineTo(452, 96);
  ctx.lineTo(320, 100);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(306, 74);
  ctx.lineTo(236, 52);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(150, 345);
  ctx.bezierCurveTo(190, 300, 300, 300, 330, 350);
  ctx.bezierCurveTo(300, 400, 200, 410, 120, 390);
  ctx.lineTo(70, 400);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(240, 395);
  ctx.lineTo(240, 540);
  ctx.moveTo(270, 392);
  ctx.lineTo(310, 455);
  ctx.lineTo(262, 490);
  ctx.stroke();
  ctx.restore();
  // Stencil tail number, rotated to read along the hull.
  ctx.save();
  ctx.translate(3 * PX, 12.4 * PX);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `bold ${2.3 * PX}px ui-monospace, Consolas, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HB-07', 0, 0);
  // Stencil bridges cut through each glyph.
  ctx.globalCompositeOperation = 'destination-out';
  const w = ctx.measureText('HB-07').width;
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + (w / 5) * (i + 0.5);
    ctx.fillRect(x - 0.05 * PX, -1.4 * PX, 0.1 * PX, 2.8 * PX);
  }
  ctx.restore();
  return c;
}

/**
 * Hull sheet tone (0-255 canvas values): albedo, and the roughness range (the G channel of
 * the roughness-metalness map; metalness is 1). The stainless used to be 192 albedo and
 * 0.25-0.34 roughness: a near-mirror that showed the bright dusk sky as a white column in the
 * low sun. Darker and rougher reads as the mid-grey of the real hull at the catch.
 */
export const HULL_TONE = { albedo: 152, roughMin: 108, roughSpan: 30 } as const;

/** Brushed stainless with weld rings, staggered vertical seams, soot, frost and the livery. */
export function makeHullTextures(): HullTextures {
  const W = 512;
  const H = 2048;
  const L = BOOSTER_LENGTH;
  const C = Math.PI * BOOSTER_DIAMETER;
  const sx = W / C; // px per metre around the hull
  const sy = H / L; // px per metre along the hull
  const rowOf = (h: number): number => (L - h) * sy; // canvas row of a hull height (canvas top = nose)
  const rnd = lcg(20240611);
  const [cc, cx] = canvas(W, H);
  const [rc, rx] = canvas(W, H);
  const height = new Float32Array(W * H);
  const bump = (y: number, x0: number, x1: number, v: number): void => {
    const yy = Math.round(y);
    if (yy < 0 || yy >= H) return;
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) height[yy * W + x] = (height[yy * W + x] ?? 0) + v;
  };
  /** Draws a rect that wraps around the u seam. */
  const wrapRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void => {
    ctx.fillRect(x, y, w, h);
    if (x + w > W) ctx.fillRect(x - W, y, w, h);
    if (x < 0) ctx.fillRect(x + W, y, w, h);
  };

  // Rings (barrel sections ~1.8 m tall), each a slightly different sheet.
  const ringH = 1.82;
  const rings = Math.ceil(L / ringH);
  for (let k = 0; k < rings; k++) {
    const y0 = rowOf(Math.min(L, (k + 1) * ringH));
    const y1 = rowOf(k * ringH);
    const t = HULL_TONE.albedo + Math.round((rnd() - 0.5) * 16);
    cx.fillStyle = `rgb(${t},${t + 2},${t + 5})`;
    cx.fillRect(0, y0, W, y1 - y0 + 1);
    const r = HULL_TONE.roughMin + Math.round(rnd() * HULL_TONE.roughSpan);
    rx.fillStyle = `rgb(0,${r},255)`;
    rx.fillRect(0, y0, W, y1 - y0 + 1);
  }
  // Circumferential brushing: short streaks that wrap cleanly around the seam.
  for (let i = 0; i < 5200; i++) {
    const y = rnd() * H;
    const x = rnd() * W;
    const len = W * (0.08 + rnd() * 0.5);
    const g = HULL_TONE.albedo - 25 + Math.floor(rnd() * 70);
    cx.fillStyle = `rgba(${g},${g + 2},${g + 5},${(0.06 + rnd() * 0.12).toFixed(3)})`;
    wrapRect(cx, x, y, len, 0.7 + rnd() * 0.8);
    const rr = HULL_TONE.roughMin - 10 + Math.floor(rnd() * HULL_TONE.roughSpan);
    rx.fillStyle = `rgba(0,${rr},255,0.25)`;
    wrapRect(rx, x, y, len, 1);
    const v = (rnd() - 0.5) * 0.08;
    bump(y, x, x + len, v);
    if (x + len > W) bump(y, 0, x + len - W, v);
  }
  // Weld rings: a dark line with a bright bead under it, and a raised bead in the normal map.
  for (let k = 1; k < rings; k++) {
    const y = rowOf(k * ringH);
    cx.fillStyle = 'rgba(70,72,78,0.55)';
    cx.fillRect(0, y - 1, W, 2);
    cx.fillStyle = 'rgba(250,250,252,0.25)';
    cx.fillRect(0, y + 1, W, 1);
    rx.fillStyle = 'rgb(0,120,230)';
    rx.fillRect(0, y - 1, W, 3);
    for (let d = -2; d <= 2; d++) bump(y + d, 0, W, 0.9 * Math.exp(-d * d * 0.6));
  }
  // One vertical seam per ring, staggered (never on the texture edge).
  for (let k = 0; k < rings; k++) {
    const y0 = rowOf(Math.min(L, (k + 1) * ringH));
    const y1 = rowOf(k * ringH);
    const x = 12 + rnd() * (W - 24);
    cx.fillStyle = 'rgba(78,80,86,0.5)';
    cx.fillRect(x, y0, 1.5, y1 - y0);
    for (let y = Math.floor(y0); y < y1; y++) for (let d = -1; d <= 1; d++) bump(y, x + d, x + d + 1, 0.6 * (1 - Math.abs(d) * 0.5));
  }
  // Vent slots in the top ring.
  cx.fillStyle = 'rgba(40,42,46,0.85)';
  rx.fillStyle = 'rgb(0,170,120)';
  for (let i = 0; i < 24; i++) {
    const x = (i / 24) * W + 4;
    const y = rowOf(L - 1.2);
    cx.fillRect(x, y, W / 24 - 8, 1.6 * sy);
    rx.fillRect(x, y, W / 24 - 8, 1.6 * sy);
  }

  // Frost where cold propellant still sits: the lower tank sump and the upper tank header.
  const frost = (hLo: number, hHi: number, amount: number): void => {
    for (let i = 0; i < 900 * amount; i++) {
      const h = hLo + rnd() * (hHi - hLo);
      const edge = Math.min(h - hLo, hHi - h) / ((hHi - hLo) / 2);
      if (rnd() > Math.pow(edge, 0.4)) continue;
      const x = rnd() * W;
      const y = rowOf(h);
      const rad = 4 + rnd() * 14;
      for (const ox of [0, -W, W]) {
        const g = cx.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
        g.addColorStop(0, 'rgba(240,246,250,0.5)');
        g.addColorStop(1, 'rgba(240,246,250,0)');
        cx.fillStyle = g;
        cx.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
        const gr = rx.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
        gr.addColorStop(0, 'rgba(0,235,40,0.6)');
        gr.addColorStop(1, 'rgba(0,235,40,0)');
        rx.fillStyle = gr;
        rx.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
      }
      bump(y, x - rad * 0.5, x + rad * 0.5, 0.25 * rnd());
    }
  };
  frost(5.5, 11.5, 1.2);
  frost(36.5, 39.5, 0.6);

  // Soot: a dark gradient and vertical streaks rising from the engine end.
  const soot = cx.createLinearGradient(0, rowOf(0), 0, rowOf(11));
  soot.addColorStop(0, 'rgba(36,28,22,0.92)');
  soot.addColorStop(0.35, 'rgba(52,40,30,0.55)');
  soot.addColorStop(1, 'rgba(60,46,34,0)');
  cx.fillStyle = soot;
  cx.fillRect(0, rowOf(11), W, rowOf(0) - rowOf(11));
  const sootR = rx.createLinearGradient(0, rowOf(0), 0, rowOf(11));
  sootR.addColorStop(0, 'rgba(0,200,110,0.9)');
  sootR.addColorStop(1, 'rgba(0,200,110,0)');
  rx.fillStyle = sootR;
  rx.fillRect(0, rowOf(11), W, rowOf(0) - rowOf(11));
  for (let i = 0; i < 160; i++) {
    const x = rnd() * W;
    const top = 3 + rnd() * 14;
    const g = cx.createLinearGradient(0, rowOf(0), 0, rowOf(top));
    g.addColorStop(0, 'rgba(30,24,20,0.5)');
    g.addColorStop(1, 'rgba(30,24,20,0)');
    cx.fillStyle = g;
    wrapRect(cx, x, rowOf(top), 1 + rnd() * 5, rowOf(0) - rowOf(top));
  }

  // Livery on the camera-facing side (u ~ 0.45), drawn in metres so it is not stretched.
  const livery = makeLiveryCanvas();
  const uC = 0.45 * C;
  const place = (ctx: CanvasRenderingContext2D, img: CanvasImageSource): void => {
    ctx.save();
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.drawImage(img, uC - 3, L - 58, 6, 18);
    ctx.restore();
  };
  place(cx, livery);
  const [pc, px] = canvas(livery.width, livery.height);
  px.drawImage(livery, 0, 0);
  px.globalCompositeOperation = 'source-in';
  px.fillStyle = 'rgb(0,150,0)'; // paint: rougher, not metallic
  px.fillRect(0, 0, pc.width, pc.height);
  place(rx, pc);

  // Normal map from the height field (wraps around the seam).
  const [nc, nx] = canvas(W, H);
  const img = nx.createImageData(W, H);
  const strength = 2.2;
  for (let y = 0; y < H; y++) {
    const yu = y > 0 ? y - 1 : y;
    const yd = y < H - 1 ? y + 1 : y;
    for (let x = 0; x < W; x++) {
      const xl = (x + W - 1) % W;
      const xr = (x + 1) % W;
      const dx = ((height[y * W + xr] ?? 0) - (height[y * W + xl] ?? 0)) * strength;
      const dy = ((height[yd * W + x] ?? 0) - (height[yu * W + x] ?? 0)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      img.data[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  nx.putImageData(img, 0, 0);

  // Emissive mask for the plume's orange light on the lower hull.
  const [gc, gx] = canvas(4, 256);
  const gg = gx.createLinearGradient(0, 256, 0, 0);
  gg.addColorStop(0, 'rgb(255,255,255)');
  gg.addColorStop(0.06, 'rgb(150,150,150)');
  gg.addColorStop(0.2, 'rgb(40,40,40)');
  gg.addColorStop(0.45, 'rgb(6,6,6)');
  gg.addColorStop(1, 'rgb(0,0,0)');
  gx.fillStyle = gg;
  gx.fillRect(0, 0, 4, 256);

  const tex = (c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(cc, true), roughMetal: tex(rc, false), normal: tex(nc, false), glow: tex(gc, false) };
}

/** Weathered lattice steel for the tower and arms: neutral grey panels with paler wear streaks. */
export function makeSteelTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#5a5d60';
  ctx.fillRect(0, 0, S, S);
  const rnd = lcg(5);
  for (let i = 0; i < 400; i++) {
    const g = 70 + Math.floor(rnd() * 50);
    // Grey, a touch cool: no red or brown cast.
    ctx.fillStyle = `rgba(${g},${g + 2},${g + 5},0.25)`;
    ctx.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 10, 1 + rnd() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}
