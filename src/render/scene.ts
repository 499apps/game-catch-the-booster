// The greybox world: sky, sea, land, the Catcher (tower + two arms), the Heron-class
// booster with its HE-2 plumes, steam, Cadet aids and the recovery boat.
// Pure view: it reads sim state each frame and never changes it.
import * as THREE from 'three';
import {
  ARM_LENGTH,
  BOOSTER_DIAMETER,
  BOOSTER_LENGTH,
  COM_ABOVE_BASE,
  ENGINE_COUNT,
  PIN_ABOVE_COM,
  RAIL_Y,
  SHORELINE_X,
  TOWER_HEIGHT,
  TOWER_X,
} from '../sim/constants';
import { armAngle } from '../sim/tower';
import { axisFromTilt, type Vec3 } from '../sim/vec';
import type { EngineState } from '../sim/types';
import {
  SUN_DIR,
  makeBrushedTexture,
  makeLiveryTexture,
  makePlumeMaterial,
  makeSkyMaterial,
  makeSoftSprite,
} from './materials';
import type { QualityProfile } from './quality';

const R = BOOSTER_DIAMETER / 2;
const TOWER_W = 12;
const TOWER_FACE_X = TOWER_X + TOWER_W / 2; // -10
export const ARM_Z = R + 1.1; // arm beam centre off the booster axis when closed
const ARM_BEAM_H = 4;
const MAX_PARTICLES = 1200;

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
  pos: Vec3;
  tilt: { x: number; z: number };
  roll: number;
  engines: readonly EngineState[];
  thrustFrac: number; // total thrust / (13 x full)
  armProgress: number;
  aids: { show: boolean; ghost: Vec3[]; pinGhost: Vec3 | null; ringRadius: number };
  splash: { active: boolean; progress: number; at: Vec3 } | null;
  reducedMotion: boolean;
}

export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly booster = new THREE.Group();
  private readonly hull: THREE.Mesh;
  private readonly armA = new THREE.Group();
  private readonly armB = new THREE.Group();
  private readonly plume13: THREE.Mesh;
  private readonly plume3: THREE.Group;
  private readonly plumeMat13: THREE.ShaderMaterial;
  private readonly plumeMat3: THREE.ShaderMaterial;
  private readonly plumeLight: THREE.PointLight;
  private readonly bells: THREE.Mesh[] = [];
  private readonly bellGlow: THREE.MeshBasicMaterial;
  private readonly bellDark = new THREE.MeshStandardMaterial({ color: '#2b2d30', metalness: 0.6, roughness: 0.55 });
  private readonly fins: THREE.Mesh[] = [];
  private readonly steam: THREE.Points;
  private readonly steamPos: Float32Array;
  private readonly steamAlpha: Float32Array;
  private particleCount = 400;
  private readonly ring: THREE.Mesh;
  private readonly ghostLine: THREE.Line;
  private readonly pinGhost: THREE.Mesh;
  private readonly boat = new THREE.Group();
  private readonly foam: THREE.Mesh;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tmpV = new THREE.Vector3();

  constructor() {
    const s = this.scene;
    s.fog = new THREE.Fog(new THREE.Color('#c9b8a8'), 2500, 16000);

    const sky = new THREE.Mesh(new THREE.SphereGeometry(18000, 32, 16), makeSkyMaterial());
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    s.add(sky);

    s.add(new THREE.HemisphereLight(new THREE.Color('#a8c4e0'), new THREE.Color('#4a3c30'), 0.9));
    this.sun = new THREE.DirectionalLight(new THREE.Color('#ffd9b0'), 2.6);
    this.sun.position.copy(SUN_DIR).multiplyScalar(400);
    this.sun.target.position.set(0, 60, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -140;
    sc.right = 140;
    sc.top = 160;
    sc.bottom = -60;
    sc.near = 10;
    sc.far = 1200;
    this.sun.shadow.bias = -0.0004;
    s.add(this.sun, this.sun.target);

    this.buildGround();
    this.buildTower();

    // ---- Booster ----
    const brushed = makeBrushedTexture();
    const steel = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#d4d6d8'),
      map: brushed,
      metalness: 0.88,
      roughness: 0.32,
    });
    const bodyH = BOOSTER_LENGTH;
    this.hull = new THREE.Mesh(new THREE.CylinderGeometry(R, R, bodyH, 48, 1, false), steel);
    this.hull.position.y = bodyH / 2 - COM_ABOVE_BASE;
    this.hull.castShadow = true;
    this.hull.receiveShadow = true;
    this.booster.add(this.hull);

    // Dark aft skirt and the engine bay.
    const dark = this.bellDark;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 3.2, 48, 1, true), dark);
    skirt.position.y = -COM_ABOVE_BASE + 1.6;
    this.booster.add(skirt);
    const plate = new THREE.Mesh(new THREE.CircleGeometry(R, 48), dark);
    plate.rotation.x = Math.PI / 2;
    plate.position.y = -COM_ABOVE_BASE + 0.01;
    this.booster.add(plate);

    // 13 HE-2 bells; the glow material lights up per running engine.
    this.bellGlow = new THREE.MeshBasicMaterial({ color: '#ffb766' });
    const bellGeo = new THREE.CylinderGeometry(0.45, 0.65, 1.4, 16, 1, true);
    for (const [x, z] of engineLayout()) {
      const b = new THREE.Mesh(bellGeo, dark);
      b.position.set(x, -COM_ABOVE_BASE - 0.6, z);
      this.booster.add(b);
      this.bells.push(b);
    }

    // Grid fins (4) near the top and the two catch pins.
    const finMat = new THREE.MeshStandardMaterial({ color: '#3b3f44', metalness: 0.7, roughness: 0.5 });
    const finGeo = new THREE.BoxGeometry(5.5, 0.6, 4.2);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const f = new THREE.Mesh(finGeo, finMat);
      f.position.set(Math.cos(a) * (R + 2.7), PIN_ABOVE_COM + 4.5, Math.sin(a) * (R + 2.7));
      f.rotation.y = -a;
      f.castShadow = true;
      this.booster.add(f);
      this.fins.push(f);
    }
    const pinGeo = new THREE.CylinderGeometry(0.55, 0.55, 2.6, 12);
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(pinGeo, finMat);
      p.rotation.x = Math.PI / 2;
      p.position.set(0, PIN_ABOVE_COM, sz * (R + 1.0));
      this.booster.add(p);
    }

    // Livery decal on the sea-facing side.
    const decal = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.03, R + 0.03, 12, 24, 1, true, -0.45, 0.9),
      new THREE.MeshStandardMaterial({
        map: makeLiveryTexture(),
        transparent: true,
        metalness: 0.2,
        roughness: 0.6,
        depthWrite: false,
      }),
    );
    decal.position.y = 18;
    decal.rotation.y = Math.PI / 2;
    this.booster.add(decal);

    // ---- Plumes ----
    this.plumeMat13 = makePlumeMaterial('#fff1c9', '#ff8a2a');
    const p13Geo = new THREE.CylinderGeometry(3.6, 14, 70, 32, 1, true);
    p13Geo.translate(0, -35, 0);
    this.plume13 = new THREE.Mesh(p13Geo, this.plumeMat13);
    this.plume13.position.y = -COM_ABOVE_BASE - 1.2;
    this.plume13.frustumCulled = false;
    this.booster.add(this.plume13);

    this.plumeMat3 = makePlumeMaterial('#ffffff', '#ffb070');
    this.plume3 = new THREE.Group();
    const p3Geo = new THREE.CylinderGeometry(0.5, 1.6, 34, 16, 1, true);
    p3Geo.translate(0, -17, 0);
    for (const [x, z] of engineLayout().slice(0, 3)) {
      const m = new THREE.Mesh(p3Geo, this.plumeMat3);
      m.position.set(x, 0, z);
      m.frustumCulled = false;
      this.plume3.add(m);
    }
    this.plume3.position.y = -COM_ABOVE_BASE - 1.2;
    this.booster.add(this.plume3);

    this.plumeLight = new THREE.PointLight(new THREE.Color('#ffa24a'), 0, 260, 1.6);
    this.plumeLight.position.y = -COM_ABOVE_BASE - 8;
    this.booster.add(this.plumeLight);
    s.add(this.booster);

    // ---- Steam / dust (positions are a pure function of time: deterministic stills) ----
    this.steamPos = new Float32Array(MAX_PARTICLES * 3);
    this.steamAlpha = new Float32Array(MAX_PARTICLES);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.steamPos, 3));
    sg.setDrawRange(0, 0);
    this.steam = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        size: 26,
        map: makeSoftSprite(),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        color: '#f1e6da',
        sizeAttenuation: true,
      }),
    );
    this.steam.frustumCulled = false;
    s.add(this.steam);

    // ---- Cadet aids ----
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(3, 0.25, 8, 64),
      new THREE.MeshBasicMaterial({ color: '#5fffd0', transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.set(0, RAIL_Y + 0.4, 0);
    s.add(this.ring);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.ghostLine = new THREE.Line(
      lg,
      new THREE.LineBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.6 }),
    );
    this.ghostLine.frustumCulled = false;
    s.add(this.ghostLine);
    this.pinGhost = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 16, 8),
      new THREE.MeshBasicMaterial({ color: '#5fffd0', transparent: true, opacity: 0.7, depthWrite: false }),
    );
    s.add(this.pinGhost);

    // ---- Recovery boat and foam (splashdown) ----
    const hullMat = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.5 });
    const boatHull = new THREE.Mesh(new THREE.BoxGeometry(26, 4, 8), hullMat);
    boatHull.position.y = 1.5;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(9, 5, 6),
      new THREE.MeshStandardMaterial({ color: '#e0663a', roughness: 0.6 }),
    );
    cabin.position.set(-4, 6, 0);
    this.boat.add(boatHull, cabin);
    this.boat.visible = false;
    s.add(this.boat);
    this.foam = new THREE.Mesh(
      new THREE.RingGeometry(6, 14, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }),
    );
    this.foam.rotation.x = -Math.PI / 2;
    this.foam.position.y = 0.3;
    s.add(this.foam);
  }

  private buildGround(): void {
    const s = this.scene;
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 40000),
      new THREE.MeshStandardMaterial({ color: '#1f4b63', metalness: 0.15, roughness: 0.16 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(SHORELINE_X + 20000, 0, 0);
    sea.receiveShadow = true;
    s.add(sea);
    const land = new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 40000),
      new THREE.MeshStandardMaterial({ color: '#7d7a5c', roughness: 0.95 }),
    );
    land.rotation.x = -Math.PI / 2;
    land.position.set(SHORELINE_X - 20000 - 60, 0.05, 0);
    land.receiveShadow = true;
    s.add(land);
    const beach = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 40000),
      new THREE.MeshStandardMaterial({ color: '#cdb994', roughness: 0.9 }),
    );
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(SHORELINE_X - 30, 0.08, 0);
    beach.receiveShadow = true;
    s.add(beach);
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(70, 48),
      new THREE.MeshStandardMaterial({ color: '#8f8c86', roughness: 0.85 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(-10, 0.12, 0);
    pad.receiveShadow = true;
    s.add(pad);
  }

  private buildTower(): void {
    const s = this.scene;
    const steel = new THREE.MeshStandardMaterial({ color: '#4a4d52', metalness: 0.55, roughness: 0.6 });
    const tower = new THREE.Group();
    const half = TOWER_W / 2;
    // Corner columns.
    const colGeo = new THREE.BoxGeometry(1.4, TOWER_HEIGHT, 1.4);
    for (const [dx, dz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      const c = new THREE.Mesh(colGeo, steel);
      c.position.set(TOWER_X + dx * half, TOWER_HEIGHT / 2, dz * half);
      c.castShadow = true;
      tower.add(c);
    }
    // Lattice: horizontal braces and X diagonals on all four faces, instanced.
    const bays = Math.floor(TOWER_HEIGHT / 8);
    const braceGeo = new THREE.BoxGeometry(TOWER_W, 0.5, 0.5);
    const diagLen = Math.hypot(TOWER_W, 8);
    const diagGeo = new THREE.BoxGeometry(diagLen, 0.35, 0.35);
    const braces = new THREE.InstancedMesh(braceGeo, steel, bays * 4);
    const diags = new THREE.InstancedMesh(diagGeo, steel, bays * 8);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let bi = 0;
    let di = 0;
    const tilt = Math.atan2(8, TOWER_W);
    // Faces: centre offset (x, z) and the yaw that lays a brace along the face.
    const faces: readonly [number, number, number][] = [
      [half, 0, Math.PI / 2],
      [-half, 0, Math.PI / 2],
      [0, half, 0],
      [0, -half, 0],
    ];
    for (let b = 0; b < bays; b++) {
      const y = b * 8 + 8;
      for (const [fx, fz, yaw] of faces) {
        p.set(TOWER_X + fx, y, fz);
        e.set(0, yaw, 0);
        q.setFromEuler(e);
        m.compose(p, q, one);
        braces.setMatrixAt(bi++, m);
        for (const sgn of [-1, 1]) {
          e.set(0, yaw, sgn * tilt, 'YXZ');
          q.setFromEuler(e);
          m.compose(p.clone().setY(y - 4), q, one);
          diags.setMatrixAt(di++, m);
        }
      }
    }
    braces.castShadow = true;
    diags.castShadow = true;
    tower.add(braces, diags);
    // Mast and lightning rod.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 18, 8), steel);
    mast.position.set(TOWER_X, TOWER_HEIGHT + 9, 0);
    tower.add(mast);
    // Carriage that carries the arms.
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(5, 10, 16), steel);
    carriage.position.set(TOWER_FACE_X + 1.5, RAIL_Y - 4, 0);
    carriage.castShadow = true;
    tower.add(carriage);
    s.add(tower);

    // Arms: pivot near the tower face, beam along +x when closed.
    const armMat = new THREE.MeshStandardMaterial({ color: '#55595f', metalness: 0.6, roughness: 0.55 });
    const railMat = new THREE.MeshStandardMaterial({ color: '#c9a640', metalness: 0.5, roughness: 0.45 });
    const bumperMat = new THREE.MeshStandardMaterial({ color: '#d9d4c7', roughness: 0.8 });
    for (const [arm, side] of [
      [this.armA, 1],
      [this.armB, -1],
    ] as const) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(ARM_LENGTH, ARM_BEAM_H, 2), armMat);
      beam.position.set(ARM_LENGTH / 2, -ARM_BEAM_H / 2, 0);
      beam.castShadow = true;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(ARM_LENGTH - 8, 0.5, 1.6), railMat);
      rail.position.set(ARM_LENGTH / 2 + 3, 0.25 - 0.25, 0);
      const truss = new THREE.Mesh(new THREE.BoxGeometry(ARM_LENGTH * 0.8, 1.2, 1.2), armMat);
      truss.position.set(ARM_LENGTH * 0.4, -ARM_BEAM_H - 2.2, 0);
      truss.rotation.z = 0.12;
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.8), bumperMat);
      bumper.position.set(ARM_LENGTH / 2 + 10, -1.5, -side * 1.3);
      arm.add(beam, rail, truss, bumper);
      arm.position.set(TOWER_FACE_X, RAIL_Y - 0.25, side * ARM_Z);
      s.add(arm);
    }
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
  }

  update(f: FrameState): void {
    // Booster pose.
    const pos = f.pos; // already moved toward the splash point by the game during a splashdown
    const axis = axisFromTilt(f.tilt);
    this.tmpV.set(axis.x, axis.y, axis.z);
    this.tmpQ.setFromUnitVectors(this.up, this.tmpV);
    this.tmpQ2.setFromAxisAngle(this.up, f.roll);
    this.tmpQ.multiply(this.tmpQ2);

    const sp = f.splash;
    this.boat.visible = !!sp?.active;
    if (sp?.active) {
      // Soft splashdown: the booster settles into the sea and lies down gently.
      const k = Math.min(1, sp.progress);
      const ease = k * k * (3 - 2 * k);
      const lie = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.25 * ease);
      this.tmpQ.slerp(lie, ease);
      const fm = this.foam.material as THREE.MeshBasicMaterial;
      fm.opacity = 0.7 * Math.max(0, 1 - Math.abs(k - 0.7) * 2.5);
      this.foam.position.set(sp.at.x, 0.3, sp.at.z);
      this.foam.scale.setScalar(1 + k * 2);
      this.boat.position.set(sp.at.x + 220 - 160 * ease, 0, sp.at.z + 60);
      this.boat.rotation.y = 0.3;
    } else {
      (this.foam.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    this.booster.position.set(pos.x, pos.y, pos.z);
    this.booster.quaternion.copy(this.tmpQ);

    // Engines and plumes.
    let lit = 0;
    for (let i = 0; i < ENGINE_COUNT; i++) {
      const e = f.engines[i];
      const on = !!e && (e.mode === 'lit' || (e.mode === 'spooling' && !e.willFail && e.spool > e.spoolTime * 0.5));
      if (on) lit++;
      const b = this.bells[i];
      if (b) b.material = on ? this.bellGlow : this.bellDark;
    }
    const heat = Math.min(1, f.thrustFrac * 1.4);
    const many = lit > 3;
    this.plume13.visible = many && heat > 0.01;
    this.plume3.visible = !many && lit > 0;
    const flick = f.reducedMotion ? 0 : 1;
    this.plumeMat13.uniforms['uIntensity']!.value = 0.55 + 0.6 * heat;
    this.plumeMat13.uniforms['uTime']!.value = f.t * flick;
    this.plume13.scale.set(0.7 + 0.4 * (lit / 13), 0.6 + 0.6 * heat, 0.7 + 0.4 * (lit / 13));
    this.plumeMat3.uniforms['uIntensity']!.value = 0.9 + 0.5 * heat;
    this.plumeMat3.uniforms['uTime']!.value = f.t * flick;
    this.plumeMat3.uniforms['uDiamonds']!.value = 1;
    this.plume3.scale.set(1, 0.8 + 0.6 * Math.min(1, heat * 3), 1);
    this.plumeLight.intensity = lit > 0 ? 6e3 * (0.4 + heat) : 0;

    // Grid fin twitch (high frequency, tiny).
    if (!f.reducedMotion) {
      for (let i = 0; i < this.fins.length; i++) {
        const fin = this.fins[i];
        if (fin) fin.rotation.x = 0.04 * Math.sin(f.t * 37 + i * 1.7) * Math.sin(f.t * 5.3 + i);
      }
    }

    // Arms.
    const ang = armAngle(f.armProgress);
    this.armA.rotation.y = -ang;
    this.armB.rotation.y = ang;

    this.updateSteam(f, pos, lit);
    this.updateAids(f);
  }

  private updateSteam(f: FrameState, pos: Vec3, lit: number): void {
    const baseY = pos.y - COM_ABOVE_BASE;
    const strength = lit > 0 ? Math.max(0, 1 - baseY / 220) : 0;
    const n = Math.floor(this.particleCount * Math.min(1, strength * 1.5) * (f.reducedMotion ? 0.4 : 1));
    const geo = this.steam.geometry;
    geo.setDrawRange(0, n);
    if (n === 0) return;
    const spread = lit > 3 ? 160 : 90;
    for (let i = 0; i < n; i++) {
      // Golden-angle directions and staggered ages: a deterministic billowing ring.
      const dir = i * 2.39996;
      const age = (f.t * 0.22 + (i * 0.6180339) % 1) % 1;
      const r = 6 + age * spread * (0.6 + 0.4 * ((i * 0.37) % 1));
      this.steamPos[i * 3] = pos.x + Math.cos(dir) * r;
      this.steamPos[i * 3 + 1] = 2 + age * 30 * (0.5 + ((i * 0.53) % 1));
      this.steamPos[i * 3 + 2] = pos.z + Math.sin(dir) * r;
      this.steamAlpha[i] = 1 - age;
    }
    (this.steam.material as THREE.PointsMaterial).opacity = 0.35 + 0.3 * strength;
    const attr = geo.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }

  private updateAids(f: FrameState): void {
    const a = f.aids;
    this.ring.visible = a.show;
    this.ghostLine.visible = a.show && a.ghost.length > 1;
    this.pinGhost.visible = a.show && !!a.pinGhost;
    if (!a.show) return;
    this.ring.scale.setScalar(a.ringRadius / 3);
    const pulse = f.reducedMotion ? 0.8 : 0.65 + 0.3 * Math.sin(f.t * 4);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = pulse;
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
}
