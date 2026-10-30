// Shared procedural materials and textures (no image files: everything is drawn here).
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.82, 0.2, -0.42).normalize(); // low sun over the sea (golden hour)

export function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#2a4f7d') },
      uMid: { value: new THREE.Color('#9fb4c7') },
      uHorizon: { value: new THREE.Color('#f2b27a') },
      uSun: { value: new THREE.Color('#ffd7a0') },
      uSunDir: { value: SUN_DIR.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        float sunAmt = max(dot(d, normalize(uSunDir)), 0.0);
        vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
        c = mix(c, uTop, smoothstep(0.15, 0.85, h));
        // Warm glow around the sun, stronger near the horizon.
        c += uSun * (pow(sunAmt, 8.0) * 0.45 + pow(sunAmt, 300.0) * 2.5);
        c = mix(c, uHorizon * 0.55, smoothstep(0.0, -0.2, h));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Plume shell: additive, bright core fading along the length and at grazing angles. */
export function makePlumeMaterial(core: string, edge: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uCore: { value: new THREE.Color(core) },
      uEdge: { value: new THREE.Color(edge) },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
      uDiamonds: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vFacing;
      void main() {
        vUv = uv;
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore; uniform vec3 uEdge; uniform float uIntensity; uniform float uTime; uniform float uDiamonds;
      varying vec2 vUv; varying float vFacing;
      void main() {
        float along = vUv.y; // 1 at the nozzle, 0 at the tail
        float body = pow(along, 1.6);
        float rim = pow(vFacing, 1.5);
        float flicker = 0.9 + 0.1 * sin(uTime * 61.0 + along * 23.0);
        float diamonds = 1.0 + uDiamonds * 0.6 * pow(max(sin(along * 34.0 - uTime * 9.0), 0.0), 6.0);
        vec3 c = mix(uEdge, uCore, rim * along);
        float a = body * rim * uIntensity * flicker * diamonds;
        gl_FragColor = vec4(c * a, a);
      }
    `,
  });
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Brushed stainless: fine horizontal streaks and weld seams (used as a roughness/colour map). */
export function makeBrushedTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 512);
  ctx.fillStyle = '#b9bcbf';
  ctx.fillRect(0, 0, c.width, c.height);
  let s = 12345;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < 1400; i++) {
    const y = rnd() * c.height;
    const g = 150 + Math.floor(rnd() * 80);
    ctx.strokeStyle = `rgba(${g},${g + 2},${g + 4},0.35)`;
    ctx.lineWidth = 0.6 + rnd();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(c.width, y + (rnd() - 0.5) * 2);
    ctx.stroke();
  }
  // Ring weld seams.
  ctx.strokeStyle = 'rgba(90,92,95,0.55)';
  ctx.lineWidth = 2;
  for (let y = 18; y < c.height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  t.anisotropy = 4;
  return t;
}

/** Livery decal: an original heron glyph and the stencil tail number HB-07. */
export function makeLiveryTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 512);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#1c2530';
  ctx.fillStyle = '#1c2530';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Heron glyph: S-neck, dagger beak, one raised leg (original 499apps-style mark).
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(110, 250);
  ctx.bezierCurveTo(80, 210, 160, 190, 128, 140);
  ctx.bezierCurveTo(112, 112, 140, 90, 156, 100);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(156, 98);
  ctx.lineTo(206, 108);
  ctx.lineTo(158, 110);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(118, 270, 42, 22, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(116, 290);
  ctx.lineTo(116, 360);
  ctx.moveTo(130, 288);
  ctx.lineTo(146, 318);
  ctx.lineTo(128, 334);
  ctx.stroke();
  // Stencil tail number, rotated to read along the hull.
  ctx.save();
  ctx.translate(128, 470);
  ctx.font = 'bold 64px ui-monospace, Consolas, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HB-07', 0, 0);
  // Stencil bridges.
  ctx.fillStyle = '#b9bcbf';
  for (const x of [-70, -30, 18, 60]) ctx.fillRect(x, -3, 6, 6);
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft round sprite for steam / dust particles. */
export function makeSoftSprite(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
