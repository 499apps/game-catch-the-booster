// The world at dusk on a Gulf coast: sky, sea, beach and dunes, the launch site and
// tank farm, the crowd, the Catcher (tower + two arms), the Heron-class booster with
// its HE-2 plumes, steam/spray/dust, Cadet aids and the recovery boat.
// Pure view: it reads sim state each frame and never changes it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ARM_LENGTH,
  BOOSTER_DIAMETER,
  BOOSTER_LENGTH,
  COM_ABOVE_BASE,
  ENGINE_COUNT,
  PIN_ABOVE_COM,
  RAIL_Y,
  TOWER_HEIGHT,
  TOWER_X,
} from '../sim/constants';
import { armAngle } from '../sim/tower';
import { axisFromTilt, type Vec3 } from '../sim/vec';
import type { EngineState } from '../sim/types';
import { TOWER_TOP_LAYER, WIDE_CAM } from './cameras';
import {
  FOG_COLOR,
  FOG_DENSITY,
  NOZZLE_GLOW_RGB,
  PLUME_COLOR,
  SUN_DIR,
  makeGlowTexture,
  makeHullTextures,
  makeParticleMaterial,
  makePlumeCoreMaterial,
  makePlumeEnvelopeMaterial,
  makePuffTexture,
  makeSkyMaterial,
  makeSteelTexture,
  makeWaterMaterial,
  makeWetSandMaterial,
  plumeLathe,
  plumeTone,
} from './materials';
import type { QualityProfile } from './quality';
import { WATERLINE_X, fbm2, grassAmount, terrainHeight } from './terrain';

const R = BOOSTER_DIAMETER / 2;
const TOWER_W = 12;
const TOWER_FACE_X = TOWER_X + TOWER_W / 2; // -10
export const ARM_Z = R + 1.1; // arm beam centre off the booster axis when closed
const RAIL_H = 0.8;
const MAX_PARTICLES = 1400;
const OUTER_ENGINES = 20;
const BASE_Y = -COM_ABOVE_BASE; // engine plane in booster coordinates
const TOP_Y = BOOSTER_LENGTH - COM_ABOVE_BASE;
/** Base steam (wash) left at the engine cutoff on the catch, and the seconds it takes to clear. */
const WASH_AT_CUTOFF = 0.8;
const WASH_DECAY = 6;
/** The target ring geometry has this radius; it is scaled to the hull radius + pin window. */
export const RING_UNIT = 6;
/** Hull sky-reflection strength in flight, and once held in the arms (after cutoff). */
export const HULL_ENV = 0.95;
export const HULL_ENV_HELD = 0.6;
/** CSS px: the smallest the ring may look on screen (far lenses grow it to this). */
const RING_MIN_PX = 24;
/** Degrees: a lens flatter than this over the ring plane sees the ring tilted toward it. */
export const RING_MIN_VIEW_DEG = 30;
/** The flat ring: the torus (built in the xy plane) laid in the horizontal plane. */
const RING_FLAT_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const RING_UP = new THREE.Vector3(0, 1, 0);
const ringN = new THREE.Vector3();
const ringTiltQ = new THREE.Quaternion();

/**
 * The ring pose for one lens. Returns the scale (the ring is at least RING_MIN_PX across on
 * screen) and writes the orientation to `outQ`. A low lens (the beach long lens sees the ring
 * from almost level) would see the flat torus edge-on, as a thin dash: the ring tilts toward
 * the lens until it looks at least RING_MIN_VIEW_DEG open. The ring centre does not move.
 */
export function ringPoseFor(
  camPos: THREE.Vector3,
  fovDeg: number,
  heightPx: number,
  ringPos: THREE.Vector3,
  baseScale: number,
  outQ: THREE.Quaternion,
): number {
  const r = baseScale * RING_UNIT;
  const d = Math.max(1, camPos.distanceTo(ringPos));
  const px = ((r / (d * Math.tan((fovDeg * Math.PI) / 360))) * heightPx) / 2; // radius in px
  const k = px > 1e-6 && 2 * px < RING_MIN_PX ? RING_MIN_PX / (2 * px) : 1;
  const vx = camPos.x - ringPos.x;
  const vy = camPos.y - ringPos.y;
  const vz = camPos.z - ringPos.z;
  const horiz = Math.hypot(vx, vz);
  const elev = Math.atan2(vy, horiz); // + above the ring plane, - below it
  const min = (RING_MIN_VIEW_DEG * Math.PI) / 180;
  if (horiz < 1e-6 || Math.abs(elev) >= min) {
    outQ.copy(RING_FLAT_Q);
  } else {
    // Turn the ring's normal toward the lens (away from it for a lens below the plane).
    const t = min - Math.abs(elev);
    const s = (elev >= 0 ? 1 : -1) * Math.sin(t);
    ringN.set((vx / horiz) * s, Math.cos(t), (vz / horiz) * s);
    ringTiltQ.setFromUnitVectors(RING_UP, ringN);
    outQ.copy(ringTiltQ).multiply(RING_FLAT_Q);
  }
  return baseScale * k;
}
/** Ring tint per tolerance: in the window, near its edge, outside it. */
const RING_TONE: Record<FrameState['aids']['tone'], string> = { ok: '#5fffd0', warn: '#ffd25e', bad: '#ff8a7a' };

/** Engine layout in the base plane (x, z), index 0-2 = centre engines. */
export function engineLayout(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    out.push([Math.cos(a) * 1.1, Math.sin(a) * 1.1]);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    out.push([Math.cos(a) * 2.9, Math.sin(a) * 2.9]);
  }
  return out;
}

export interface FrameState {
  t: number; // render time (s): sim time, frozen in still mode
  simT: number; // sim time (s), for event-relative effects
  pos: Vec3;
  tilt: { x: number; z: number };
  roll: number;
  engines: readonly EngineState[];
  thrustFrac: number; // total thrust / (13 x full)
  armProgress: number;
  railCompression: number;
  /**
   * Flight aids. `ring`: the target ring around the arm centreline (every tier), radius =
   * hull radius + pin window, tinted by `tone`. `show`: the Cadet ghost path and pin ghost.
   * `flash` 0..1 flashes the ring when CATCH is pressed.
   */
  aids: {
    show: boolean;
    ring: boolean;
    ghost: Vec3[];
    pinGhost: Vec3 | null;
    ringRadius: number;
    flash: number;
    tone: 'ok' | 'warn' | 'bad';
  };
  splash: { active: boolean; progress: number; at: Vec3 } | null;
  reducedMotion: boolean;
  /** 0..1: held in the arms. Cold vapour vents from the booster and the crowd cheers. */
  vent: number;
  /** Seconds since engine cutoff at the catch (null: not cut off yet). The base steam decays over it. */
  sinceCutoff?: number | null;
  /** Main-menu hero shot: a warmer, stronger rim from the low sun. */
  hero: boolean;
  /**
   * The shaped stick the sim flew with this frame (world x/z, -1..1; from the replay log in
   * replays). Render only: the gimballed bells, the grid fins and the plume answer it at once.
   */
  stick: { x: number; z: number };
}

/** Stick visuals (render only): full stick gives these deflections. */
const STICK_GIMBAL = 8 * (Math.PI / 180);
const STICK_FIN = 20 * (Math.PI / 180);
const STICK_PLUME = 4 * (Math.PI / 180);
/** Actuator slew rates (rad/s): the bells gimbal at ~40°/s (8° in 0.2 s), the grid fins at ~120°/s (20° in ~0.17 s). */
const GIMBAL_RATE = 40 * (Math.PI / 180);
const FIN_RATE = 120 * (Math.PI / 180);

// ---------------------------------------------------------------- geometry helpers

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/** A box beam from a to b with a w x d cross-section. */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, d = w): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new THREE.BoxGeometry(w, len, d);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** Gives a geometry a flat vertex colour (sRGB hex) so differently coloured parts can merge. */
function tinted(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Merges geometries, dropping attributes some of them lack. */
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = list.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') x.deleteAttribute(k);
    return x;
  });
  const hasColor = norm.every((g) => g.getAttribute('color'));
  const hasUv = norm.every((g) => g.getAttribute('uv'));
  for (const g of norm) {
    if (!hasColor && g.getAttribute('color')) g.deleteAttribute('color');
    if (!hasUv && g.getAttribute('uv')) g.deleteAttribute('uv');
  }
  const out = mergeGeometries(norm, false);
  if (!out) throw new Error('mergeGeometries failed');
  return out;
}

const frac = (x: number): number => x - Math.floor(x);

export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly booster = new THREE.Group();
  /** Ignition flash 0..1 (drives the exposure pump in the view). */
  flash = 0;
  /** True while more than three engines burn (the view lowers bloom and exposure). */
  plumeMany = false;
  /** Plume brightness 0..1 (for the lens flare and exposure). */
  plumeLevel = 0;

  /** The largest grid-fin deflection drawn now, in degrees (stick only, no twitch; for tests). */
  get visFinDeg(): number {
    return (Math.max(...this.finVis.map(Math.abs)) * 180) / Math.PI;
  }
  private readonly sky: THREE.ShaderMaterial;
  private readonly water: THREE.ShaderMaterial;
  private readonly hullMat: THREE.MeshPhysicalMaterial;
  private readonly armA = new THREE.Group();
  private readonly armB = new THREE.Group();
  private readonly rails: THREE.Mesh[] = [];
  private readonly bumpers: THREE.Mesh[] = [];
  private readonly hydraulics: { barrel: THREE.Mesh; rod: THREE.Mesh; anchor: THREE.Vector3; mount: THREE.Vector3; arm: THREE.Group }[] = [];
  private readonly envelope: THREE.Mesh;
  private readonly envMat: THREE.ShaderMaterial;
  private readonly cores: THREE.InstancedMesh;
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly glows: THREE.InstancedMesh;
  private readonly nozzleGlow: THREE.Sprite;
  private readonly plumeLight: THREE.PointLight;
  private readonly fins: THREE.InstancedMesh;
  private readonly bells: THREE.InstancedMesh;
  /**
   * The actuators as drawn (render only): the bell gimbal (rad, booster frame x/z, the way the
   * bells swing), each grid fin's deflection (rad) and the render time they last moved at.
   */
  private readonly gimbalVis = { x: 0, z: 0 };
  private readonly finVis = [0, 0, 0, 0];
  private actT = -1e9;
  private readonly stickLocal = new THREE.Vector3();
  private readonly gimbalQ = new THREE.Quaternion();
  private readonly plumeQ = new THREE.Quaternion();
  private readonly particles: THREE.Mesh;
  private readonly pGeo: THREE.InstancedBufferGeometry;
  private readonly pPos: Float32Array;
  private readonly pData: Float32Array;
  private readonly pTint: Float32Array;
  private readonly pMat: THREE.ShaderMaterial;
  private particleCount = 400;
  private readonly ring: THREE.Mesh;
  private readonly ghostLine: THREE.Line;
  private readonly pinGhost: THREE.Mesh;
  private readonly boat = new THREE.Group();
  private readonly layout = engineLayout();
  private readonly levels = new Float32Array(ENGINE_COUNT);
  private prevLit = 0;
  private flashAt = -1e9;
  /** The ring's world scale this frame (before the per-camera minimum size). */
  private ringScale = 1;
  private lastSimT = -1e9;
  private lastT = -1;
  private wash = 0;
  private readonly washAt = new THREE.Vector3();
  private washWater = 1;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpC = new THREE.Color();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly finAngles = [0, 1, 2, 3].map((i) => Math.PI / 4 + (i * Math.PI) / 2);
  private wetSand: THREE.ShaderMaterial | null = null;
  private lampMat: THREE.MeshBasicMaterial | null = null;
  private haloMat: THREE.PointsMaterial | null = null;
  private crowdCalm: THREE.InstancedMesh | null = null;
  private crowdCheer: THREE.InstancedMesh | null = null;
  /** Plume intensities before the per-camera near-lens trim (see tuneForCamera). */
  private envI = 0;
  private coreI = 0;

  constructor() {
    const s = this.scene;
    s.fog = new THREE.FogExp2(FOG_COLOR.clone(), FOG_DENSITY);

    this.sky = makeSkyMaterial();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(18000, 48, 24), this.sky);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    s.add(sky);

    // Dusk lighting: low warm sun, cool sky fill from the other side, warm bounce from the sand.
    s.add(new THREE.HemisphereLight(new THREE.Color().setRGB(0.42, 0.48, 0.66), new THREE.Color().setRGB(0.3, 0.2, 0.12), 0.55));
    this.sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.68, 0.42), 3.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(500).add(new THREE.Vector3(0, 60, 0));
    this.sun.target.position.set(0, 60, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -150;
    sc.right = 150;
    sc.top = 170;
    sc.bottom = -110;
    sc.near = 50;
    sc.far = 1200;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.4;
    s.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(new THREE.Color().setRGB(0.4, 0.5, 0.8), 0.55);
    fill.position.set(-0.6, 0.6, 0.55).multiplyScalar(500);
    s.add(fill);

    this.water = makeWaterMaterial(WATERLINE_X);
    this.buildGround();
    this.buildSite();
    this.buildCrowd();
    this.buildTower();

    // ---- Booster ----
    const tex = makeHullTextures();
    this.hullMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: tex.map,
      metalness: 1,
      metalnessMap: tex.roughMetal,
      roughness: 1,
      roughnessMap: tex.roughMetal,
      normalMap: tex.normal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      // Low anisotropy and a softer sky reflection: a strong anisotropic highlight drew one
      // long white column down the hull in the low sun (the post-cutoff "white hull").
      anisotropy: 0.2,
      emissive: PLUME_COLOR.clone(),
      emissiveMap: tex.glow,
      emissiveIntensity: 0,
      envMapIntensity: HULL_ENV,
    });
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(R, R, BOOSTER_LENGTH, 96, 1, true), this.hullMat);
    hull.position.y = BOOSTER_LENGTH / 2 - COM_ABOVE_BASE;
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.booster.add(hull);

    const dark = new THREE.MeshStandardMaterial({ color: '#26272a', metalness: 0.7, roughness: 0.55, side: THREE.DoubleSide });
    const aft = new THREE.CircleGeometry(R, 48).rotateX(Math.PI / 2).translate(0, BASE_Y + 0.02, 0);
    const deck = new THREE.CircleGeometry(R - 0.1, 48).rotateX(-Math.PI / 2).translate(0, TOP_Y - 2.4, 0);
    const lip = new THREE.CylinderGeometry(R - 0.06, R - 0.06, 2.4, 48, 1, true).translate(0, TOP_Y - 1.2, 0);
    const darkParts = new THREE.Mesh(merge([aft, deck, lip]), dark);
    this.booster.add(darkParts);

    // Engine bells: 13 gimballed centre/inner engines plus a fixed outer ring.
    const bellProfile = ([
      [0.26, 0.1],
      [0.3, -0.15],
      [0.42, -0.6],
      [0.54, -1.05],
      [0.63, -1.55],
    ] as const).map(([r, y]) => new THREE.Vector2(r, y));
    const bellGeo = new THREE.LatheGeometry(bellProfile, 18);
    const bellMat = new THREE.MeshStandardMaterial({ color: '#3a3330', metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide });
    const bells = new THREE.InstancedMesh(bellGeo, bellMat, ENGINE_COUNT + OUTER_ENGINES);
    this.bells = bells;
    const glowGeo = new THREE.CircleGeometry(0.52, 18).rotateX(Math.PI / 2);
    this.glows = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), ENGINE_COUNT);
    let bi = 0;
    for (const [x, z] of this.layout) {
      this.tmpM.makeTranslation(x, BASE_Y, z);
      bells.setMatrixAt(bi++, this.tmpM);
    }
    for (let i = 0; i < OUTER_ENGINES; i++) {
      const a = (i / OUTER_ENGINES) * Math.PI * 2 + 0.16;
      this.tmpM.makeTranslation(Math.cos(a) * 3.85, BASE_Y + 0.1, Math.sin(a) * 3.85);
      bells.setMatrixAt(bi++, this.tmpM);
    }
    this.layout.forEach(([x, z], i) => {
      this.tmpM.makeTranslation(x, BASE_Y - 0.55, z);
      this.glows.setMatrixAt(i, this.tmpM);
      this.glows.setColorAt(i, this.tmpC.setRGB(0.03, 0.03, 0.03));
    });
    this.booster.add(bells, this.glows);

    // Grid fins (lattice shelves near the top), the catch pins, chines and a cable raceway.
    const finParts: THREE.BufferGeometry[] = [];
    const span = 2.6;
    const out = 3.8;
    const th = 0.9;
    finParts.push(beam(new THREE.Vector3(0.2, 0, -span), new THREE.Vector3(0.2, 0, span), 0.22, th).rotateX(0));
    const edge = (a: THREE.Vector3, b: THREE.Vector3, w: number): void => {
      const g = beam(a, b, w, w);
      finParts.push(g);
    };
    for (const z of [-span, span]) edge(new THREE.Vector3(0.2, 0, z), new THREE.Vector3(out, 0, z), 0.2);
    edge(new THREE.Vector3(out, 0, -span), new THREE.Vector3(out, 0, span), 0.2);
    for (let x = 0.75; x < out; x += 0.55) {
      finParts.push(new THREE.BoxGeometry(0.06, th, span * 2).translate(x, 0, 0));
    }
    for (let z = -span + 0.55; z < span; z += 0.55) {
      finParts.push(new THREE.BoxGeometry(out - 0.2, th, 0.06).translate((out + 0.2) / 2, 0, z));
    }
    const finGeo = merge(finParts);
    const finMat = new THREE.MeshStandardMaterial({ color: '#4a4b4f', metalness: 0.85, roughness: 0.45 });
    this.fins = new THREE.InstancedMesh(finGeo, finMat, 4);
    this.fins.castShadow = true;
    this.booster.add(this.fins);

    const det: THREE.BufferGeometry[] = [];
    for (const sz of [-1, 1]) {
      det.push(new THREE.CylinderGeometry(0.55, 0.55, 2.6, 14).rotateX(Math.PI / 2).translate(0, PIN_ABOVE_COM, sz * (R + 1.0)));
      det.push(new THREE.BoxGeometry(1.6, 2.2, 0.6).translate(0, PIN_ABOVE_COM + 0.2, sz * (R + 0.2)));
    }
    // Chines and the cable raceway: low, flat, raised strips in the hull's own stainless
    // tone (same metal, same roughness), so they read as relief, never as a dark line.
    const strakes: THREE.BufferGeometry[] = [];
    for (const a of [0.6, Math.PI + 0.6]) {
      const g = new THREE.CylinderGeometry(0.3, 0.3, 54, 10, 1).scale(0.4, 1, 1).translate(R - 0.02, BASE_Y + 9 + 27, 0);
      strakes.push(g.rotateY(-a));
    }
    // Raceway: 0.9 m wide, about 0.12 m proud of the skin.
    strakes.push(new THREE.CylinderGeometry(0.45, 0.45, 58, 12, 1).scale(0.3, 1, 1).translate(R - 0.02, BASE_Y + 8 + 29, 0).rotateY(-2.2));
    const strakeMat = new THREE.MeshStandardMaterial({ color: '#c3c5c9', metalness: 1, roughness: 0.34, envMapIntensity: 1.05 });
    const strakeMesh = new THREE.Mesh(merge(strakes), strakeMat);
    strakeMesh.receiveShadow = true;
    this.booster.add(strakeMesh);
    for (const a of this.finAngles) {
      det.push(new THREE.BoxGeometry(0.8, 1.6, 1.4).translate(R + 0.35, TOP_Y - 3.5, 0).rotateY(-a));
    }
    const detMat = new THREE.MeshStandardMaterial({ color: '#b9bcc0', metalness: 0.9, roughness: 0.38 });
    const details = new THREE.Mesh(merge(det), detMat);
    details.castShadow = true;
    this.booster.add(details);

    // ---- Plumes ----
    this.envMat = makePlumeEnvelopeMaterial();
    this.envelope = new THREE.Mesh(plumeLathe(0.28, 1, 0.55, 36), this.envMat);
    this.envelope.position.y = BASE_Y - 1.4;
    this.envelope.frustumCulled = false;
    this.envelope.renderOrder = 2;
    this.booster.add(this.envelope);
    this.coreMat = makePlumeCoreMaterial();
    this.cores = new THREE.InstancedMesh(plumeLathe(0.55, 1.35, 0.8, 14), this.coreMat, ENGINE_COUNT);
    this.cores.frustumCulled = false;
    this.cores.renderOrder = 3;
    this.booster.add(this.cores);
    this.nozzleGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: new THREE.Color().setRGB(...NOZZLE_GLOW_RGB),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.nozzleGlow.position.y = BASE_Y - 3;
    this.nozzleGlow.renderOrder = 4;
    this.booster.add(this.nozzleGlow);

    this.plumeLight = new THREE.PointLight(PLUME_COLOR.clone(), 0, 500, 2);
    this.plumeLight.position.y = BASE_Y - 9;
    this.booster.add(this.plumeLight);
    s.add(this.booster);

    // ---- Steam / spray / dust (instanced soft billboards, positions a pure function of time) ----
    const quad = new THREE.PlaneGeometry(1, 1);
    this.pGeo = new THREE.InstancedBufferGeometry();
    this.pGeo.setIndex(quad.index);
    this.pGeo.setAttribute('position', quad.getAttribute('position'));
    this.pGeo.setAttribute('uv', quad.getAttribute('uv'));
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pData = new Float32Array(MAX_PARTICLES * 4);
    this.pTint = new Float32Array(MAX_PARTICLES * 3);
    const ia = (arr: Float32Array, n: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.pGeo.setAttribute('iPos', ia(this.pPos, 3));
    this.pGeo.setAttribute('iData', ia(this.pData, 4));
    this.pGeo.setAttribute('iTint', ia(this.pTint, 3));
    this.pGeo.instanceCount = 0;
    this.pMat = makeParticleMaterial(makePuffTexture());
    this.particles = new THREE.Mesh(this.pGeo, this.pMat);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 5;
    s.add(this.particles);

    // ---- Aids: the target ring (every tier) and the Cadet ghost path ----
    // Drawn over everything (no depth test, last), so it reads around the hull and the arms.
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(RING_UNIT, RING_UNIT * 0.06, 8, 96),
      new THREE.MeshBasicMaterial({ color: '#5fffd0', transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, fog: false }),
    );
    this.ring.quaternion.copy(RING_FLAT_Q);
    this.ring.position.set(0, RAIL_Y + 0.4, 0);
    this.ring.renderOrder = 20;
    this.ring.frustumCulled = false;
    s.add(this.ring);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.ghostLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.6, fog: false }));
    this.ghostLine.frustumCulled = false;
    s.add(this.ghostLine);
    this.pinGhost = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 16, 8),
      new THREE.MeshBasicMaterial({ color: '#5fffd0', transparent: true, opacity: 0.7, depthWrite: false, fog: false }),
    );
    s.add(this.pinGhost);

    // ---- Friendly recovery boat (splashdown) ----
    const boatGeo = merge([
      tinted(new THREE.BoxGeometry(26, 3.2, 8).translate(0, 1.4, 0), '#f4f1ea'),
      tinted(new THREE.BoxGeometry(26.2, 0.8, 8.2).translate(0, 2.4, 0), '#e8642c'),
      tinted(new THREE.BoxGeometry(9, 4.5, 6).translate(-4, 5.2, 0), '#f4f1ea'),
      tinted(new THREE.BoxGeometry(9.2, 1.2, 6.2).translate(-4, 6.4, 0), '#2d5d7c'),
      tinted(new THREE.CylinderGeometry(0.2, 0.2, 6, 6).translate(-4, 10, 0), '#d8d8d8'),
    ]);
    this.boat.add(new THREE.Mesh(boatGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })));
    this.boat.visible = false;
    s.add(this.boat);
  }

  // ---------------------------------------------------------------- world building

  private buildGround(): void {
    const s = this.scene;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(64000, 64000), this.water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(WATERLINE_X - 300 + 32000, 0, 0);
    sea.frustumCulled = false;
    s.add(sea);

    // Ground grid: dense near the waterline and the site, coarse far inland.
    const xs: number[] = [];
    for (let d = -60; d < 2650; d += 3 + Math.max(0, d) * 0.06) xs.push(WATERLINE_X - d);
    const zs: number[] = [];
    for (let z = 0; z < 5300; z += 8 + z * 0.02) zs.push(z);
    const zAll = [...zs.slice(1).map((z) => -z).reverse(), ...zs];
    const nx = xs.length;
    const nz = zAll.length;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const wet = new THREE.Color('#5f513f');
    const sand = new THREE.Color('#c4ad86');
    const pale = new THREE.Color('#d9c8a4');
    const duneSand = new THREE.Color('#a88f66');
    const wrack = new THREE.Color('#7a6a52'); // dried seaweed line at the high-tide mark
    const grass = new THREE.Color('#5b6236');
    const sage = new THREE.Color('#717548');
    const dry = new THREE.Color('#8f8558');
    const site = new THREE.Color('#9a9488');
    const c = new THREE.Color();
    const sat = (v: number): number => Math.min(1, Math.max(0, v));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = xs[i] ?? 0;
        const z = zAll[j] ?? 0;
        const h = terrainHeight(x, z);
        const o = (i * nz + j) * 3;
        pos[o] = x;
        pos[o + 1] = h;
        pos[o + 2] = z;
        const d = WATERLINE_X - x;
        // Dry sand: pale wind-blown patches, darker on the dune faces.
        c.copy(sand).lerp(pale, fbm2(x / 90 + 4, z / 140) * 0.7);
        c.lerp(duneSand, sat((h - 2.8) / 5) * 0.55);
        // Wrack line: a thin, broken darker band about 16 m up the beach.
        c.lerp(wrack, Math.exp(-Math.pow((d - 16 - 3 * fbm2(z / 60, 1)) / 1.4, 2)) * 0.45 * sat(fbm2(z / 25, 7) * 2 - 0.4));
        c.lerp(wet, 1 - sat(d / 9));
        const gr = grassAmount(x, z);
        const g = fbm2(x / 30, z / 30);
        c.lerp(g > 0.55 ? dry : g > 0.42 ? sage : grass, gr * 0.9);
        const inSite = Math.abs(z) < 200 && x < 0 && x > -560 && d > 20;
        if (inSite) c.lerp(site, 0.55);
        // Fine grain times a low-frequency swell, so no area reads as a flat fill.
        const n = (0.9 + 0.2 * fbm2(x / 6, z / 6)) * (0.84 + 0.32 * fbm2(x / 380 + 3, z / 520 - 2));
        // A gentle hue drift (rosier and greyer patches), so the dry land is not one flat beige.
        const hue = fbm2(x / 170 - 7, z / 230 + 5) - 0.5;
        col[o] = c.r * n * (1 + 0.1 * hue);
        col[o + 1] = c.g * n * (1 - 0.02 * hue);
        col[o + 2] = c.b * n * (1 - 0.12 * hue);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < nx - 1; i++) {
      for (let j = 0; j < nz - 1; j++) {
        const a = i * nz + j;
        const b = (i + 1) * nz + j;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Winding: make sure the ground faces up.
    const nAttr = g.getAttribute('normal');
    if ((nAttr.getY(0) ?? 1) < 0) {
      for (let k = 0; k < idx.length; k += 3) {
        const t = idx[k + 1] ?? 0;
        idx[k + 1] = idx[k + 2] ?? 0;
        idx[k + 2] = t;
      }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }));
    ground.receiveShadow = true;
    s.add(ground);

    // Wet sand at the waterline: a thin glossy band over the ground that mirrors the dusk
    // sky, with drifting swash foam lines. One draw call; follows the terrain height.
    const cols = [-1.5, 0, 1.5, 3, 5, 7.5, 10, 13, 16];
    const rows: number[] = [];
    for (let z = -5300; z <= 5300; z += 12) rows.push(z);
    const wpos = new Float32Array(cols.length * rows.length * 3);
    rows.forEach((z, j) => {
      cols.forEach((d, i) => {
        const x = WATERLINE_X - d;
        const o = (j * cols.length + i) * 3;
        wpos[o] = x;
        wpos[o + 1] = Math.max(terrainHeight(x, z), -0.4) + 0.05;
        wpos[o + 2] = z;
      });
    });
    const widx: number[] = [];
    for (let j = 0; j < rows.length - 1; j++) {
      for (let i = 0; i < cols.length - 1; i++) {
        const a = j * cols.length + i;
        const b = a + cols.length;
        widx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
    wg.setIndex(widx);
    this.wetSand = makeWetSandMaterial(WATERLINE_X);
    const wetMesh = new THREE.Mesh(wg, this.wetSand);
    wetMesh.frustumCulled = false;
    wetMesh.renderOrder = 1;
    s.add(wetMesh);

    const far = new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 64000),
      new THREE.MeshStandardMaterial({ color: '#4f5233', roughness: 1 }),
    );
    far.rotation.x = -Math.PI / 2;
    far.position.set(WATERLINE_X - 2600 - 20000 + 200, -0.6, 0);
    s.add(far);
  }

  /** Pad, site buildings, the tank farm (all one merged mesh). */
  private buildSite(): void {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(tinted(new THREE.CylinderGeometry(28, 29, 0.8, 64).translate(-14, 0.12, 0), '#8e8a84'));
    parts.push(tinted(new THREE.RingGeometry(14, 15.5, 48).rotateX(-Math.PI / 2).translate(0, 0.52, 0), '#c9b75a'));
    // Tank farm: vertical tanks and spheres.
    const tanks: [number, number, number, number][] = [
      [-330, 90, 8, 22],
      [-352, 112, 7, 18],
      [-318, 128, 9, 26],
      [-360, 150, 6, 16],
      [-300, 160, 7.5, 20],
    ];
    for (const [x, z, r, h] of tanks) {
      parts.push(tinted(new THREE.CylinderGeometry(r, r, h, 28).translate(x, h / 2, z), '#e6e3dc'));
      parts.push(tinted(new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1).translate(x, h, z), '#d9d5cc'));
    }
    for (const [x, z] of [
      [-410, 70],
      [-410, 110],
      [-410, 150],
    ] as const) {
      parts.push(tinted(new THREE.SphereGeometry(10, 24, 14).translate(x, 13, z), '#eeeae2'));
      parts.push(tinted(new THREE.CylinderGeometry(1, 1, 4, 8).translate(x, 2, z), '#7d7a73'));
    }
    // Pipe rack from the farm to the pad.
    parts.push(tinted(new THREE.BoxGeometry(270, 1.4, 3).translate(-170, 5, 60), '#7f7b74'));
    for (let x = -300; x < -40; x += 20) parts.push(tinted(new THREE.BoxGeometry(0.6, 5, 3).translate(x, 2.5, 60), '#6d6a64'));
    // Hangars and a control building.
    parts.push(tinted(new THREE.BoxGeometry(70, 46, 56).translate(-480, 23, -170), '#9aa2a8'));
    parts.push(tinted(new THREE.BoxGeometry(40, 18, 30).translate(-150, 9, -150), '#a8a69f'));
    parts.push(tinted(new THREE.BoxGeometry(14, 6, 10).translate(-70, 3, 70), '#b8b3a8'));
    const mesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /**
   * Spectators in loose clusters with gaps: on the sand ahead of the wide cam and down the
   * coast toward the beach cam. Clearly human shapes at 1:1 scale (adults ~1.7 m, kids,
   * people sitting), in muted clothing lifted by the dusk sky, never a dark block of pegs.
   * Four draw calls: calm standers, sitters, and the cheerers (arms down / arms up).
   */
  private buildCrowd(): void {
    const cyl = (r0: number, r1: number, h: number, a: THREE.Vector3, b: THREE.Vector3): THREE.BufferGeometry => {
      const g = new THREE.CylinderGeometry(r1, r0, h, 6, 1);
      const dir = b.clone().sub(a);
      g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()), this.one));
      return g;
    };
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    // Standing adult at scale 1: ~1.7 m. Legs with a gap, a torso wider at the shoulders, a head.
    const core = (): THREE.BufferGeometry[] => [
      cyl(0.075, 0.065, 0.84, V(-0.1, 0, 0), V(-0.09, 0.84, 0)),
      cyl(0.075, 0.065, 0.84, V(0.1, 0, 0), V(0.09, 0.84, 0)),
      new THREE.CylinderGeometry(0.22, 0.15, 0.62, 7, 1).scale(1, 1, 0.62).translate(0, 1.15, 0),
      new THREE.CylinderGeometry(0.05, 0.05, 0.1, 5, 1).translate(0, 1.5, 0),
      new THREE.SphereGeometry(0.115, 8, 6).scale(1, 1.12, 1).translate(0, 1.6, 0),
    ];
    const armsDown = [cyl(0.05, 0.045, 0.62, V(-0.25, 1.4, 0), V(-0.29, 0.8, 0.02)), cyl(0.05, 0.045, 0.62, V(0.25, 1.4, 0), V(0.29, 0.8, 0.02))];
    const armsUp = [cyl(0.05, 0.045, 0.62, V(-0.23, 1.42, 0), V(-0.42, 2.0, 0)), cyl(0.05, 0.045, 0.62, V(0.23, 1.42, 0), V(0.4, 2.02, 0))];
    // Sitting on the sand: knees up, hands on the knees.
    const sitting = merge([
      new THREE.CylinderGeometry(0.21, 0.16, 0.58, 7, 1).scale(1, 1, 0.62).translate(0, 0.42, 0),
      new THREE.SphereGeometry(0.115, 8, 6).scale(1, 1.12, 1).translate(0, 0.86, 0),
      cyl(0.075, 0.07, 0.42, V(-0.1, 0.12, 0), V(-0.1, 0.38, 0.32)),
      cyl(0.075, 0.07, 0.42, V(0.1, 0.12, 0), V(0.1, 0.38, 0.32)),
      cyl(0.07, 0.06, 0.4, V(-0.1, 0.38, 0.32), V(-0.1, 0.05, 0.5)),
      cyl(0.07, 0.06, 0.4, V(0.1, 0.38, 0.32), V(0.1, 0.05, 0.5)),
      cyl(0.045, 0.04, 0.48, V(-0.22, 0.66, 0), V(-0.12, 0.4, 0.34)),
      cyl(0.045, 0.04, 0.48, V(0.22, 0.66, 0), V(0.12, 0.4, 0.34)),
    ]);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
      // A little of the dusk sky on the shaded side, so backlit people never go pure black.
      emissive: new THREE.Color().setRGB(0.05, 0.055, 0.075),
    });
    const tones = ['#4a5a70', '#7a4a3c', '#b8a789', '#3d5446', '#8c837a', '#5e4866', '#a2432e', '#d9d5cb', '#2f3b4f', '#6b6f3e', '#c58b4a', '#41657e'];

    let s = 7;
    const rnd = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    type Person = { x: number; z: number; h: number; w: number; yaw: number; tone: string; kind: 'stand' | 'sit' | 'cheer' };
    const people: Person[] = [];
    const cluster = (cx: number, cz: number, count: number, spread: number, faceZ: number): void => {
      for (let k = 0; k < count; k++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * spread;
        const roll = rnd();
        const kid = rnd() < 0.22;
        const kind: Person['kind'] = roll < 0.18 ? 'sit' : roll < 0.52 ? 'cheer' : 'stand';
        people.push({
          x: cx + Math.cos(a) * r,
          z: cz + Math.sin(a) * r,
          h: kid ? 0.6 + rnd() * 0.16 : 0.96 + rnd() * 0.14,
          w: kid ? 0.8 : 0.9 + rnd() * 0.25,
          // Facing the tower (roughly), each a little different.
          yaw: Math.atan2(TOWER_X - cx, faceZ - cz) + (rnd() - 0.5) * 0.9,
          tone: tones[Math.floor(rnd() * tones.length)] ?? '#6b6b6b',
          kind,
        });
      }
    };
    // Ahead of the wide cam: 13 groups along the dry sand, with open beach between them.
    for (let g = 0; g < 13; g++) {
      const cz = WIDE_CAM.z - 240 - g * 15 - rnd() * 8;
      const cx = WATERLINE_X - 10 - rnd() * 42;
      cluster(cx, cz, 3 + Math.floor(rnd() * 9), 1.6 + rnd() * 2.6, 0);
    }
    // Down the coast toward the beach cam: a few groups, inland of its long-lens line.
    for (let g = 0; g < 7; g++) {
      const cz = -1390 + g * 22 + rnd() * 10;
      const cx = WATERLINE_X - 14 - rnd() * 40;
      cluster(cx, cz, 2 + Math.floor(rnd() * 6), 1.4 + rnd() * 2, 0);
    }

    const make = (geo: THREE.BufferGeometry, list: Person[]): THREE.InstancedMesh | null => {
      if (list.length === 0) return null;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const p = new THREE.Vector3();
      const col = new THREE.Color();
      list.forEach((o, i) => {
        q.setFromAxisAngle(UP, o.yaw);
        sc.set(o.w * o.h, o.h, o.w * o.h);
        m.compose(p.set(o.x, terrainHeight(o.x, o.z) - 0.03, o.z), q, sc);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.set(o.tone).multiplyScalar(0.7 + ((i * 0.618) % 1) * 0.3));
      });
      this.scene.add(mesh);
      return mesh;
    };
    make(merge([...core(), ...armsDown]), people.filter((o) => o.kind === 'stand'));
    make(sitting, people.filter((o) => o.kind === 'sit'));
    const cheer = people.filter((o) => o.kind === 'cheer');
    this.crowdCalm = make(merge([...core(), ...armsDown]), cheer);
    this.crowdCheer = make(merge([...core(), ...armsUp]), cheer);
    if (this.crowdCheer) this.crowdCheer.visible = false;
  }

  private buildTower(): void {
    const s = this.scene;
    const steelMap = makeSteelTexture();
    // Weathered grey steel (a cool, neutral grey: never brown, not black). Light enough that
    // the low sun rims the edges and the sky shows in the grazing reflections.
    const steel = new THREE.MeshStandardMaterial({ color: '#aeb2b6', map: steelMap, metalness: 0.4, roughness: 0.58, envMapIntensity: 1.25 });
    const half = TOWER_W / 2;
    const stat: THREE.BufferGeometry[] = [];
    for (const [dx, dz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      stat.push(new THREE.BoxGeometry(1.5, TOWER_HEIGHT, 1.5).translate(TOWER_X + dx * half, TOWER_HEIGHT / 2, dz * half));
    }
    // Top deck, crane housing and mast: their own mesh on TOWER_TOP_LAYER, so the
    // tower-top lens (mounted on this structure) never sees them fill its frame.
    const topParts = [
      new THREE.BoxGeometry(TOWER_W + 3, 1.6, TOWER_W + 3).translate(TOWER_X, TOWER_HEIGHT, 0),
      new THREE.BoxGeometry(7, 5, 9).translate(TOWER_X - 1.5, TOWER_HEIGHT + 3.3, 0),
      new THREE.CylinderGeometry(0.35, 0.6, 16, 8).translate(TOWER_X + 2, TOWER_HEIGHT + 8, 3),
    ];
    const topMesh = new THREE.Mesh(merge(topParts), steel);
    topMesh.layers.set(TOWER_TOP_LAYER);
    topMesh.receiveShadow = true;
    s.add(topMesh);
    // Carriage guide rails on the sea face and the carriage itself.
    for (const z of [-4.2, 4.2]) stat.push(new THREE.BoxGeometry(0.9, TOWER_HEIGHT - 6, 0.9).translate(TOWER_FACE_X + 0.6, (TOWER_HEIGHT - 6) / 2 + 3, z));
    stat.push(new THREE.BoxGeometry(3.6, 16, 13).translate(TOWER_FACE_X + 2, RAIL_Y - 6, 0));
    stat.push(new THREE.BoxGeometry(4.4, 2.2, 15).translate(TOWER_FACE_X + 2.2, RAIL_Y - 13.5, 0));
    for (const z of [-1, 1]) stat.push(new THREE.CylinderGeometry(1.1, 1.1, 14, 12).translate(TOWER_FACE_X + 2.6, RAIL_Y - 6, z * ARM_Z));
    // Base: a concrete plinth.
    stat.push(new THREE.BoxGeometry(TOWER_W + 6, 3, TOWER_W + 6).translate(TOWER_X, 1.2, 0));
    const towerMesh = new THREE.Mesh(merge(stat), steel);
    towerMesh.castShadow = true;
    towerMesh.receiveShadow = true;
    s.add(towerMesh);

    // Lattice: horizontal braces and X diagonals on all four faces, instanced.
    const bayH = 7.3;
    const bays = Math.floor((TOWER_HEIGHT - 2) / bayH);
    const braceGeo = new THREE.BoxGeometry(TOWER_W, 0.55, 0.55);
    const diagLen = Math.hypot(TOWER_W, bayH);
    const diagGeo = new THREE.BoxGeometry(diagLen, 0.38, 0.38);
    const braces = new THREE.InstancedMesh(braceGeo, steel, bays * 4);
    const diags = new THREE.InstancedMesh(diagGeo, steel, bays * 8);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let bi = 0;
    let di = 0;
    const tilt = Math.atan2(bayH, TOWER_W);
    const faces: readonly [number, number, number][] = [
      [half, 0, Math.PI / 2],
      [-half, 0, Math.PI / 2],
      [0, half, 0],
      [0, -half, 0],
    ];
    // Depth: each bay and face a slightly different tone (paint, weathering), and the
    // horizontal braces a touch lighter than the diagonals behind them.
    const tone = new THREE.Color();
    for (let b = 0; b < bays; b++) {
      const y = b * bayH + bayH + 1;
      for (const [fx, fz, yaw] of faces) {
        p.set(TOWER_X + fx, y, fz);
        e.set(0, yaw, 0);
        q.setFromEuler(e);
        m.compose(p, q, one);
        const k = 0.9 + 0.18 * frac(Math.sin(b * 12.9898 + fx * 3.1 + fz * 7.7) * 43758.5453);
        braces.setColorAt(bi, tone.setScalar(k * 1.06));
        braces.setMatrixAt(bi++, m);
        for (const sgn of [-1, 1]) {
          e.set(0, yaw, sgn * tilt, 'YXZ');
          q.setFromEuler(e);
          m.compose(p.clone().setY(y - bayH / 2), q, one);
          diags.setColorAt(di, tone.setScalar(k * (sgn > 0 ? 0.92 : 0.86)));
          diags.setMatrixAt(di++, m);
        }
      }
    }
    braces.castShadow = true;
    diags.castShadow = true;
    s.add(braces, diags);

    // Aviation warning lights (red) at the top, mid height and the mast tip. They blink
    // (see update); a fixed-pixel-size halo keeps them visible on the long lenses.
    const lampGeo = new THREE.SphereGeometry(0.45, 8, 6);
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(6, 0.5, 0.3), fog: false });
    const lamps = new THREE.InstancedMesh(lampGeo, this.lampMat, 9);
    const lampPos: number[] = [];
    let li = 0;
    for (const y of [TOWER_HEIGHT + 1.2, TOWER_HEIGHT * 0.5]) {
      for (const [dx, dz] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ] as const) {
        m.makeTranslation(TOWER_X + dx * (half + 0.8), y, dz * (half + 0.8));
        lamps.setMatrixAt(li++, m);
        lampPos.push(TOWER_X + dx * (half + 0.8), y, dz * (half + 0.8));
      }
    }
    m.makeTranslation(TOWER_X + 2, TOWER_HEIGHT + 16.3, 3);
    lamps.setMatrixAt(li++, m);
    lampPos.push(TOWER_X + 2, TOWER_HEIGHT + 16.3, 3);
    s.add(lamps);
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lampPos), 3));
    this.haloMat = new THREE.PointsMaterial({
      size: 10,
      sizeAttenuation: false,
      map: makeGlowTexture(),
      color: new THREE.Color().setRGB(1, 0.16, 0.08),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const halos = new THREE.Points(haloGeo, this.haloMat);
    halos.frustumCulled = false;
    halos.renderOrder = 6;
    s.add(halos);

    // Arms: pivot at the carriage, beam along +x when closed; truss, rail, bumper, hydraulics.
    const armMat = new THREE.MeshStandardMaterial({ color: '#a2a6aa', map: steelMap, metalness: 0.45, roughness: 0.55, envMapIntensity: 1.2 });
    const railMat = new THREE.MeshStandardMaterial({ color: '#c9a640', metalness: 0.4, roughness: 0.5 });
    const bumperMat = new THREE.MeshStandardMaterial({ color: '#e3ddcf', roughness: 0.85 });
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(4, 3.6, 3), fog: false });
    const hydMat = new THREE.MeshStandardMaterial({ color: '#c8ccd0', metalness: 0.95, roughness: 0.22 });
    for (const [arm, side] of [
      [this.armA, 1],
      [this.armB, -1],
    ] as const) {
      const truss = new THREE.Mesh(this.armGeometry(side), armMat);
      truss.castShadow = true;
      truss.receiveShadow = true;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(27, RAIL_H, 1.8).translate(16.5, 0, 0), railMat);
      rail.position.y = RAIL_H / 2;
      rail.castShadow = true;
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 0.9).translate(0, 0, -side * 0.45), bumperMat);
      bumper.position.set(-TOWER_FACE_X - 2.6, -1.6, -side * (ARM_Z - R - 0.95));
      const lamps2 = new THREE.Mesh(
        merge([5, 15, 25, 34].map((x) => new THREE.BoxGeometry(0.7, 0.45, 0.7).translate(x, -0.2, side * 3.8))),
        lampMat,
      );
      arm.add(truss, rail, bumper, lamps2);
      arm.position.set(TOWER_FACE_X + 2.6, RAIL_Y - RAIL_H, side * ARM_Z);
      s.add(arm);
      this.rails.push(rail);
      this.bumpers.push(bumper);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1, 12).translate(0, 0.5, 0), hydMat);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1, 10).translate(0, 0.5, 0), hydMat);
      s.add(barrel, rod);
      this.hydraulics.push({
        barrel,
        rod,
        anchor: new THREE.Vector3(TOWER_FACE_X + 2.2, RAIL_Y - 13.5, side * (ARM_Z + 4.5)),
        mount: new THREE.Vector3(13, -6.2, side * 1.8),
        arm,
      });
    }
  }

  /**
   * One arm: a box truss with a deep root tapering to the tip (local frame, rail top at y = 0).
   * The truss sits outboard of the rail (side = +1 for the +z arm) so it clears the hull.
   */
  private armGeometry(side: number): THREE.BufferGeometry {
    const L = ARM_LENGTH;
    const parts: THREE.BufferGeometry[] = [];
    const bottomY = (x: number): number => -10.5 + (x / L) * 8;
    const zi = side * 0.45;
    const zo = side * 3.1;
    for (const z of [zi, zo]) {
      parts.push(beam(new THREE.Vector3(0, -0.6, z), new THREE.Vector3(L, -0.6, z), 1.1, 1.3));
      parts.push(beam(new THREE.Vector3(0, bottomY(0), z), new THREE.Vector3(L - 1, bottomY(L - 1), z), 0.9));
      let prev: THREE.Vector3 | null = null;
      for (let x = 1.5; x <= L - 1; x += 5.5) {
        const top = new THREE.Vector3(x, -0.8, z);
        const bot = new THREE.Vector3(x, bottomY(x), z);
        parts.push(beam(top, bot, 0.55));
        if (prev) parts.push(beam(prev, bot, 0.45));
        prev = top;
      }
    }
    const zc = (zi + zo) / 2;
    for (let x = 1.5; x <= L - 1; x += 5.5) {
      parts.push(beam(new THREE.Vector3(x, -0.6, zi), new THREE.Vector3(x, -0.6, zo), 0.4));
      parts.push(beam(new THREE.Vector3(x, bottomY(x), zi), new THREE.Vector3(x, bottomY(x), zo), 0.35));
    }
    parts.push(new THREE.BoxGeometry(3.2, 12, 4.2).translate(0.4, -5.6, zc));
    parts.push(new THREE.BoxGeometry(1.4, 3.6, 3.6).translate(L - 0.3, -1.6, zc));
    parts.push(new THREE.BoxGeometry(4, 1.2, 3).translate(13, -6.2, zc));
    // Rail support under the rail beam.
    parts.push(new THREE.BoxGeometry(27, 0.6, 1.2).translate(16.5, -0.3, 0));
    return merge(parts);
  }

  setQuality(q: QualityProfile): void {
    this.particleCount = Math.min(MAX_PARTICLES, q.particles);
    const shadows = q.shadowMapSize > 0;
    this.sun.castShadow = shadows;
    if (shadows && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const aniso = q.tier === 'high' ? 0.5 : 0;
    if (this.hullMat.anisotropy !== aniso) {
      this.hullMat.anisotropy = aniso;
      this.hullMat.needsUpdate = true;
    }
    // Low: stratus only and no sea micro-detail (keeps software GL and old phones fast).
    this.sky.uniforms['uClouds']!.value = q.tier === 'low' ? 0.5 : 1;
    this.water.uniforms['uDetail']!.value = q.tier === 'low' ? 0 : 1;
    if (this.wetSand) this.wetSand.uniforms['uDetail']!.value = q.tier === 'low' ? 0 : 1;
  }

  /** World position of the engine plane centre (for the lens flare). */
  enginePoint(out: THREE.Vector3): THREE.Vector3 {
    return this.booster.localToWorld(out.set(0, BASE_Y - 2, 0));
  }

  /**
   * On a far lens the target ring is a few pixels wide: grow it (for this camera only) to at
   * least RING_MIN_PX across on screen. On a low lens, tilt it toward the camera so it reads
   * as a ring, not an edge-on dash (see ringPoseFor). Call after the camera has moved, before
   * rendering.
   */
  fitRingToCamera(cam: THREE.PerspectiveCamera, heightPx: number): void {
    if (!this.ring.visible) return;
    this.ring.scale.setScalar(ringPoseFor(cam.position, cam.fov, heightPx, this.ring.position, this.ringScale, this.ring.quaternion));
  }

  /**
   * Trims the plume for a lens that sits close to it (the tower top): the nozzle glow
   * sprite and the shells would otherwise fill the frame with a white bloom blob. Keeps
   * the hot core and the diamonds. Returns 0 (far) .. 1 (very near) for the bloom/flare.
   */
  tuneForCamera(camPos: THREE.Vector3): number {
    const d = this.enginePoint(this.tmpV).distanceTo(camPos);
    const near = 1 - THREE.MathUtils.smoothstep(d, 35, 230);
    (this.nozzleGlow.material as THREE.SpriteMaterial).opacity = 1 - 0.8 * near;
    this.envMat.uniforms['uIntensity']!.value = this.envI * (1 - 0.45 * near);
    this.coreMat.uniforms['uIntensity']!.value = this.coreI * (1 - 0.2 * near);
    return near;
  }

  // ---------------------------------------------------------------- per frame

  update(f: FrameState): void {
    const dt = f.t - this.lastT;
    const fresh = dt <= 0 || dt > 1; // still frames and jumps: no smoothing
    this.lastT = f.t;
    const pos = f.pos; // moved toward the splash point by the game during a splashdown
    const axis = axisFromTilt(f.tilt);
    this.tmpV.set(axis.x, axis.y, axis.z);
    this.tmpQ.setFromUnitVectors(UP, this.tmpV);
    this.tmpQ2.setFromAxisAngle(UP, f.roll);
    this.tmpQ.multiply(this.tmpQ2);

    const sp = f.splash;
    this.boat.visible = !!sp?.active;
    const wu = this.water.uniforms;
    if (sp?.active) {
      // Soft splashdown: the booster settles into the sea and lies down gently.
      const k = Math.min(1, sp.progress);
      const ease = k * k * (3 - 2 * k);
      const lie = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.25 * ease);
      this.tmpQ.slerp(lie, ease);
      (wu['uSplash']!.value as THREE.Vector4).set(sp.at.x, sp.at.z, 8 + 30 * k, Math.max(0, 1 - Math.abs(k - 0.75) * 2.2));
      this.boat.position.set(sp.at.x + 220 - 160 * ease, 0, sp.at.z + 60);
      this.boat.rotation.y = 0.3;
    } else {
      (wu['uSplash']!.value as THREE.Vector4).set(0, 0, 0, 0);
    }
    this.booster.position.set(pos.x, pos.y, pos.z);
    this.booster.quaternion.copy(this.tmpQ);
    this.booster.updateMatrixWorld();

    // ---- Stick visuals (render only): the bells and fins slew to the stick at actuator rates ----
    const sdt = f.t - this.actT;
    const actSnap = sdt < 0 || sdt > 1; // still frames and jumps: the actuators are already there
    this.actT = f.t;
    // The stick in the booster's own frame (it is tilted and rolled).
    this.tmpQ2.copy(this.booster.quaternion).invert();
    const sl = this.stickLocal.set(f.stick.x, 0, f.stick.z).applyQuaternion(this.tmpQ2);
    const sLen = Math.hypot(sl.x, sl.z);
    // The bells swing opposite to the stick, up to STICK_GIMBAL at full stick.
    const gk = sLen > 1e-4 ? (STICK_GIMBAL * Math.min(1, sLen)) / sLen : 0;
    const gv = this.gimbalVis;
    const gdx = -sl.x * gk - gv.x;
    const gdz = -sl.z * gk - gv.z;
    const gd = Math.hypot(gdx, gdz);
    const gs = actSnap || gd <= GIMBAL_RATE * sdt ? 1 : (GIMBAL_RATE * sdt) / gd;
    gv.x += gdx * gs;
    gv.z += gdz * gs;
    const g = Math.hypot(gv.x, gv.z);
    if (g > 1e-6) {
      // The plume swings with the bells.
      const ux = gv.x / g;
      const uz = gv.z / g;
      this.gimbalQ.setFromUnitVectors(DOWN, this.tmpV.set(ux * Math.sin(g), -Math.cos(g), uz * Math.sin(g)));
      const p = g * (STICK_PLUME / STICK_GIMBAL);
      this.plumeQ.setFromUnitVectors(DOWN, this.tmpV.set(ux * Math.sin(p), -Math.cos(p), uz * Math.sin(p)));
    } else {
      this.gimbalQ.identity();
      this.plumeQ.identity();
    }
    for (let i = 0; i < ENGINE_COUNT; i++) {
      const [x, z] = this.layout[i] ?? [0, 0];
      this.tmpM.compose(this.tmpV2.set(x, BASE_Y, z), this.gimbalQ, this.one);
      this.bells.setMatrixAt(i, this.tmpM);
      // The nozzle-exit glow swings with its bell.
      this.tmpV.set(0, -0.55, 0).applyQuaternion(this.gimbalQ);
      this.tmpM.compose(this.tmpV2.set(x + this.tmpV.x, BASE_Y + this.tmpV.y, z + this.tmpV.z), this.gimbalQ, this.one);
      this.glows.setMatrixAt(i, this.tmpM);
    }
    this.bells.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    this.envelope.quaternion.copy(this.plumeQ);

    // ---- Engines ----
    let lit = 0;
    const levels = this.levels;
    for (let i = 0; i < ENGINE_COUNT; i++) {
      const e = f.engines[i];
      let level = 0;
      if (e && !sp?.active) {
        if (e.mode === 'lit') level = 1;
        else if (e.mode === 'spooling' && !e.willFail) level = Math.min(1, e.spool / Math.max(0.01, e.spoolTime));
      }
      levels[i] = level;
      if (level > 0.5) lit++;
    }
    for (let i = 0; i < ENGINE_COUNT; i++) {
      const e = f.engines[i];
      const level = levels[i] ?? 0;
      const [x, z] = this.layout[i] ?? [0, 0];
      const thr = e ? e.throttle : 0;
      // The nozzle exit glows orange, held at or below 1.0 so it keeps its hue (no white dot).
      this.glows.setColorAt(i, level > 0 ? this.tmpC.setRGB(0.3 + 0.7 * level, 0.12 + 0.5 * level, 0.05 + 0.2 * level) : this.tmpC.setRGB(0.03, 0.03, 0.03));
      // 3 engines: a long pillar (about a booster length), as in the footage.
      const len = lit > 3 ? 20 + 8 * thr : 88 + 28 * thr;
      this.tmpM.compose(this.tmpV2.set(x, BASE_Y - 1.5, z), this.plumeQ, this.tmpV.set(level, len * level, level));
      this.cores.setMatrixAt(i, this.tmpM);
    }
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    this.cores.instanceMatrix.needsUpdate = true;

    // Ignition flash on the first engines to light, only when the sim got there by playing on
    // (not on a jump: still frames, replay seeks and capture jumps land mid-burn, and must not
    // flash). A jump also cancels a flash still fading.
    const jumped = Math.abs(f.simT - this.lastSimT) > 0.5;
    if (jumped) this.flashAt = -1e9;
    else if (lit > 0 && this.prevLit === 0) this.flashAt = f.simT;
    this.prevLit = lit;
    this.lastSimT = f.simT;
    const since = f.simT - this.flashAt;
    this.flash = since >= 0 && since < 3 ? Math.exp(-since / 0.45) : 0;
    if (f.reducedMotion) this.flash *= 0.35;

    const heat = Math.min(1, f.thrustFrac * 1.4);
    const many = lit > 3;
    const anyLit = lit > 0;
    const alt = Math.max(0, pos.y - COM_ABOVE_BASE);
    const spread = 1 + Math.min(1, alt / 1400) * 0.7; // lower ambient pressure: the plume opens up
    const tm = f.reducedMotion ? 0.35 : 1;
    this.envelope.visible = anyLit;
    this.cores.visible = anyLit;
    this.nozzleGlow.visible = anyLit;
    const eu = this.envMat.uniforms;
    const cu = this.coreMat.uniforms;
    eu['uTime']!.value = f.t * tm;
    cu['uTime']!.value = f.t * tm;
    this.plumeMany = many;
    // Every plume colour stays at or below 1.0 (plumeTone), so tone mapping and bloom keep its
    // hue; the brightness comes from the plume's area and the opacity of its shells.
    const tone = plumeTone(many, heat, this.flash);
    (eu['uCore']!.value as THREE.Color).setRGB(...tone.envCore);
    (eu['uEdge']!.value as THREE.Color).setRGB(...tone.envEdge);
    (eu['uTail']!.value as THREE.Color).setRGB(...tone.envTail);
    (cu['uCore']!.value as THREE.Color).setRGB(...tone.coreCore);
    (cu['uEdge']!.value as THREE.Color).setRGB(...tone.coreEdge);
    cu['uDiamonds']!.value = tone.diamonds;
    eu['uIntensity']!.value = tone.envIntensity;
    cu['uIntensity']!.value = tone.coreIntensity;
    if (many) {
      // Thirteen engines: a big orange flame that fades to cream smoke.
      const w = (0.55 + 0.45 * (lit / ENGINE_COUNT)) * spread;
      this.envelope.scale.set(15 * w, 70 + 25 * heat, 15 * w);
      eu['uChaos']!.value = 1;
      cu['uCells']!.value = 4;
    } else {
      // Three engines: one long, continuous salmon (pink-orange) pillar with subtle shock
      // diamonds (the footage's 3-engine look).
      this.envelope.scale.set(3.6 * spread, 110 + 20 * heat, 3.6 * spread);
      eu['uChaos']!.value = 0.25;
      cu['uCells']!.value = 6.5 + 0.4 * Math.sin(f.t * 5.3 * tm);
    }
    this.envI = eu['uIntensity']!.value as number;
    this.coreI = cu['uIntensity']!.value as number;
    this.nozzleGlow.scale.setScalar((many ? 34 : 20) * (1 + this.flash * 1.6));
    this.plumeLevel = anyLit ? Math.min(1, 0.45 + heat * 0.8 + this.flash) : 0;
    // Candela: ~8 lx on the hull/tower at 20 m, ~0.3 lx on the ground from 100 m up.
    this.plumeLight.intensity = anyLit ? 2500 * (0.35 + heat) * (1 + this.flash * 2) : 0;
    // The plume's warm light climbs the lower hull (stronger close to the ground bounce).
    const bounce = 1 + 0.6 * Math.max(0, 1 - alt / 160);
    this.hullMat.emissiveIntensity = anyLit ? (0.5 + 1.1 * heat) * (1 + this.flash) * bounce : 0;
    // Held in the arms (engines off, frost and vapour on the tanks): a duller sky reflection,
    // so the hull reads mid-grey at the catch, not as a white column.
    this.hullMat.envMapIntensity = f.vent > 0 ? HULL_ENV_HELD : HULL_ENV;

    // Hero (menu): the low sun a little warmer and stronger, for a clear rim on the steel.
    this.sun.intensity = f.hero ? 4.2 : 3.4;
    this.sun.color.setRGB(1.0, f.hero ? 0.62 : 0.68, f.hero ? 0.36 : 0.42);

    // Aviation lights: ~40 flashes a minute; dimmer and slower with reduced motion.
    const ph = frac(f.t * (f.reducedMotion ? 0.4 : 0.67));
    const blink = f.reducedMotion ? 0.55 + 0.45 * Math.cos(ph * Math.PI * 2) : ph < 0.42 ? 1 : 0.06;
    if (this.lampMat) this.lampMat.color.setRGB(6 * blink + 0.2, 0.5 * blink + 0.03, 0.3 * blink + 0.02);
    if (this.haloMat) this.haloMat.opacity = 0.1 + 0.9 * blink;

    // The crowd raises its arms once the booster is held.
    if (this.crowdCalm && this.crowdCheer) {
      const cheer = f.vent > 0;
      this.crowdCalm.visible = !cheer;
      this.crowdCheer.visible = cheer;
    }
    if (this.wetSand) this.wetSand.uniforms['uTime']!.value = f.t;

    // Grid fins: a tiny high-frequency twitch, plus the stick (each fin turns about its own
    // radial hinge by the part of the stick across it, slewing at FIN_RATE).
    for (let i = 0; i < 4; i++) {
      const a = this.finAngles[i] ?? 0;
      const tw = f.reducedMotion ? 0 : 0.05 * Math.sin(f.t * 37 + i * 1.7) * Math.sin(f.t * 5.3 + i);
      const across = Math.max(-1, Math.min(1, -sl.x * Math.sin(a) + sl.z * Math.cos(a)));
      const target = STICK_FIN * across;
      const prev = this.finVis[i] ?? 0;
      const fin = actSnap ? target : prev + Math.max(-FIN_RATE * sdt, Math.min(FIN_RATE * sdt, target - prev));
      this.finVis[i] = fin;
      this.tmpQ2.setFromAxisAngle(UP, -a);
      this.tmpQ.setFromAxisAngle(this.tmpV.set(1, 0, 0), tw + fin);
      this.tmpQ2.multiply(this.tmpQ);
      this.tmpM.compose(this.tmpV2.set(Math.cos(a) * (R + 0.15), TOP_Y - 3.5, Math.sin(a) * (R + 0.15)), this.tmpQ2, this.one);
      this.fins.setMatrixAt(i, this.tmpM);
    }
    this.fins.instanceMatrix.needsUpdate = true;

    // ---- Arms: swing, rail compression, bumper flex, hydraulics ----
    const ang = armAngle(f.armProgress);
    this.armA.rotation.y = -ang;
    this.armB.rotation.y = ang;
    for (const r of this.rails) r.position.y = RAIL_H / 2 - Math.min(1.5, Math.max(0, f.railCompression));
    const flex = THREE.MathUtils.smoothstep(f.armProgress, 0.94, 1) * 0.3;
    for (const b of this.bumpers) b.scale.z = 1 - flex;
    for (const h of this.hydraulics) {
      h.arm.updateMatrixWorld();
      const tip = h.arm.localToWorld(this.tmpV.copy(h.mount));
      const dir = this.tmpV2.copy(tip).sub(h.anchor);
      const len = dir.length();
      dir.multiplyScalar(1 / len);
      this.tmpQ.setFromUnitVectors(UP, dir);
      h.barrel.position.copy(h.anchor);
      h.barrel.quaternion.copy(this.tmpQ);
      h.barrel.scale.set(1, len * 0.58, 1);
      h.rod.position.copy(h.anchor);
      h.rod.quaternion.copy(this.tmpQ);
      h.rod.scale.set(1, len, 1);
    }

    // ---- Light the sea, the steam and the hull with the plume ----
    const plumeAt = this.booster.localToWorld(this.tmpV.set(0, BASE_Y - 14, 0));
    wu['uTime']!.value = f.t;
    (wu['uPlumePos']!.value as THREE.Vector3).copy(plumeAt);
    wu['uPlume']!.value = this.plumeLevel * 9;
    (this.pMat.uniforms['uPlumePos']!.value as THREE.Vector3).copy(plumeAt);
    this.pMat.uniforms['uPlume']!.value = this.plumeLevel;

    this.updateParticles(f, axis, lit, fresh, dt);
    this.updateAids(f);
  }

  private updateParticles(f: FrameState, axis: Vec3, lit: number, fresh: boolean, dt: number): void {
    // Where the plume meets the surface below the booster.
    const bx = f.pos.x - axis.x * COM_ABOVE_BASE;
    const by = f.pos.y - axis.y * COM_ABOVE_BASE;
    const bz = f.pos.z - axis.z * COM_ABOVE_BASE;
    const k = by / Math.max(0.3, axis.y);
    const ix = bx - axis.x * k;
    const iz = bz - axis.z * k;
    const ground = Math.max(0, terrainHeight(ix, iz));
    // How high the plume still stirs the surface (a tight 3-engine pillar reaches far down).
    const reach = lit > 3 ? 150 : 160;
    let target = lit > 0 ? Math.max(0, Math.min(1, 1 - (by - ground) / reach)) : 0;
    // After the cutoff at the catch, the steam at the base dies away over WASH_DECAY seconds,
    // also when the frame jumps there (a seek or a still): it does not snap to nothing.
    const sc = f.sinceCutoff;
    if (sc !== null && sc !== undefined && sc >= 0) target = Math.max(target, WASH_AT_CUTOFF * Math.max(0, 1 - sc / WASH_DECAY));
    if (fresh) {
      this.wash = target;
      this.washAt.set(ix, ground, iz);
      this.washWater = ix > WATERLINE_X + 4 ? 1 : 0;
    } else {
      this.wash += (target - this.wash) * (1 - Math.exp(-dt / (target > this.wash ? 0.4 : 3.5)));
      if (target > 0.02) {
        this.washAt.lerp(this.tmpV.set(ix, ground, iz), 1 - Math.exp(-dt / 0.6));
        this.washWater += ((ix > WATERLINE_X + 4 ? 1 : 0) - this.washWater) * (1 - Math.exp(-dt / 0.8));
      }
    }
    const motion = f.reducedMotion ? 0.4 : 1;
    let n = 0;
    const emit = (
      count: number,
      ox: number,
      oy: number,
      oz: number,
      spread: number,
      rise: number,
      size: number,
      strength: number,
      tint: [number, number, number],
      rate: number,
      seed: number,
    ): void => {
      for (let j = 0; j < count && n < MAX_PARTICLES; j++, n++) {
        const i = j + seed;
        const u1 = frac(i * 0.6180339);
        const u2 = frac(i * 0.7548776 + 0.31);
        const u3 = frac(i * 0.5698403 + 0.67);
        const age = frac(f.t * rate * (0.7 + 0.6 * u2) + u1);
        const dir = i * 2.39996;
        const r = 4 + age * spread * (0.35 + 0.65 * u3);
        const o3 = n * 3;
        const o4 = n * 4;
        this.pPos[o3] = ox + Math.cos(dir) * r;
        this.pPos[o3 + 1] = oy + 1.5 + age * rise * (0.3 + u2) + size * 0.25;
        this.pPos[o3 + 2] = oz + Math.sin(dir) * r;
        this.pData[o4] = size * (0.6 + 1.6 * age) * (0.7 + 0.6 * u3);
        this.pData[o4 + 1] = strength * Math.pow(1 - age, 1.4) * Math.min(1, age * 12);
        this.pData[o4 + 2] = dir + f.t * 0.2 * (u2 - 0.5);
        this.pData[o4 + 3] = 0;
        const shade = 0.82 + 0.18 * u1;
        this.pTint[o3] = tint[0] * shade;
        this.pTint[o3 + 1] = tint[1] * shade;
        this.pTint[o3 + 2] = tint[2] * shade;
      }
    };
    if (this.wash > 0.01) {
      const count = Math.floor(this.particleCount * Math.min(1, this.wash * 1.6) * motion);
      const w = this.washWater;
      // Over land: grey-white steam with a little dust (the pad's water deluge), not beige.
      const tint: [number, number, number] = [0.95 * w + 0.82 * (1 - w), 0.96 * w + 0.79 * (1 - w), 0.98 * w + 0.74 * (1 - w)];
      const big = lit > 3 || lit === 0 ? 1 : 0.75;
      emit(count, this.washAt.x, this.washAt.y, this.washAt.z, 190 * big, 46, 16, 0.55 * Math.min(1, this.wash * 1.3), tint, 0.16, 0);
    }
    // The downwash ring on the water under the plume (drawn by the sea shader).
    const washV = this.water.uniforms['uWash']!.value as THREE.Vector4;
    const ww = this.wash * this.washWater;
    if (ww > 0.01) washV.set(this.washAt.x, this.washAt.z, 16 + 46 * this.wash, Math.min(1, ww * 1.2));
    else washV.set(0, 0, 0, 0);
    const sp = f.splash;
    if (sp?.active) {
      const k = Math.min(1, sp.progress);
      const s = Math.max(0, Math.sin(Math.PI * Math.min(1, k * 1.3)));
      const count = Math.floor(this.particleCount * 0.6 * motion);
      emit(count, sp.at.x, 0, sp.at.z, 70, 30, 14, 0.5 * s, [0.95, 0.97, 1.0], 0.22, 5000);
    }
    // Held in the arms: thin cold vapour vents near the top and sinks from the engine bay.
    // Dim grey and mostly transparent: the sun lights it, so a bright tint reads as a
    // glowing white bar on the hull.
    if (f.vent > 0 && !sp?.active) {
      const vc = Math.floor(Math.min(70, this.particleCount * 0.1) * (f.reducedMotion ? 0.5 : 1));
      const topY = TOP_Y - 1.5;
      emit(vc, f.pos.x + axis.x * topY, f.pos.y + axis.y * topY - 1.5, f.pos.z + axis.z * topY, 9, 16, 2.4, 0.16 * f.vent, [0.5, 0.52, 0.55], 0.2, 7000);
      emit(Math.floor(vc * 0.7), bx, by - 3, bz, 7, -12, 3.0, 0.13 * f.vent, [0.48, 0.5, 0.53], 0.14, 8000);
    }
    this.pGeo.instanceCount = n;
    if (n > 0) {
      (this.pGeo.getAttribute('iPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (this.pGeo.getAttribute('iData') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (this.pGeo.getAttribute('iTint') as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  private updateAids(f: FrameState): void {
    const a = f.aids;
    this.ring.visible = a.ring;
    this.ghostLine.visible = a.show && a.ghost.length > 1;
    this.pinGhost.visible = a.show && !!a.pinGhost;
    if (a.ring) {
      // CATCH pressed: the ring flashes white-hot and swells, then settles back.
      const fl = Math.min(1, Math.max(0, a.flash));
      this.ringScale = (a.ringRadius / RING_UNIT) * (1 + (f.reducedMotion ? 0.08 : 0.3) * fl);
      this.ring.scale.setScalar(this.ringScale);
      // Flat until a lens fits it (the split panels and the inset see the flat ring).
      this.ring.quaternion.copy(RING_FLAT_Q);
      const pulse = f.reducedMotion ? 0.85 : 0.7 + 0.25 * Math.sin(f.t * 4);
      const rm = this.ring.material as THREE.MeshBasicMaterial;
      rm.opacity = Math.min(1, pulse + fl);
      rm.color.set(RING_TONE[a.tone]).lerp(this.tmpC.setRGB(2.4, 2.4, 2.4), fl * (f.reducedMotion ? 0.4 : 1));
    }
    if (!a.show) return;
    const attr = this.ghostLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(64, a.ghost.length);
    for (let i = 0; i < n; i++) {
      const p = a.ghost[i];
      if (!p) continue;
      // Draw the pin path (CoM + pin offset) so it ends at the ring.
      attr.setXYZ(i, p.x, p.y + PIN_ABOVE_COM, p.z);
    }
    attr.needsUpdate = true;
    this.ghostLine.geometry.setDrawRange(0, n);
    if (a.pinGhost) this.pinGhost.position.set(a.pinGhost.x, a.pinGhost.y, a.pinGhost.z);
  }

  /** Frees every geometry, material and texture in the scene. */
  dispose(): void {
    const seen = new Set<object>();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !seen.has(mesh.geometry)) {
        seen.add(mesh.geometry);
        mesh.geometry.dispose();
      }
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        const textures: unknown[] = Object.values(m);
        if (m instanceof THREE.ShaderMaterial) for (const u of Object.values(m.uniforms)) textures.push(u.value);
        for (const v of textures) {
          if (v instanceof THREE.Texture && !seen.has(v)) {
            seen.add(v);
            v.dispose();
          }
        }
        m.dispose();
      }
    });
  }
}
