// The five webcast camera rigs and the auto-director (main shot + picture-in-picture).
import * as THREE from 'three';
import {
  BOOSTER_DIAMETER,
  BOOSTER_LENGTH,
  COM_ABOVE_BASE,
  PIN_ABOVE_COM,
  RAIL_Y,
  SHORELINE_X,
  TOWER_HEIGHT,
  TOWER_X,
} from '../sim/constants';
import type { Phase } from '../sim/types';
import type { Vec3 } from '../sim/vec';
import { WATERLINE_X, terrainHeight } from './terrain';

export type CameraId = 'towerTop' | 'beach' | 'chase' | 'onboard' | 'wide';
export const CAMERA_IDS: readonly CameraId[] = ['towerTop', 'beach', 'chase', 'onboard', 'wide'];
export const CAMERA_LABELS: Record<CameraId, string> = {
  towerTop: 'Tower top',
  beach: 'Beach long lens',
  chase: 'Drone chase',
  onboard: 'Onboard',
  wide: 'Wide bay',
};

/** Long-lens camera on the beach, down the coast (front-lit by the low sun). */
export const BEACH_CAM: Vec3 = { x: SHORELINE_X - 14, y: terrainHeight(SHORELINE_X - 14, -1750) + 2.6, z: -1750 };
/** Wide shot along the beach from behind the crowd, looking into the sunset glow. */
export const WIDE_CAM: Vec3 = { x: WATERLINE_X - 18, y: terrainHeight(WATERLINE_X - 18, 2650) + 4.5, z: 2650 };
/** Camera on the tower top, at the inland edge, looking out to sea over the arms. */
export const TOWER_CAM: Vec3 = { x: TOWER_X - 4, y: TOWER_HEIGHT + 8, z: -14 };

export interface ShotInput {
  com: Vec3;
  axis: Vec3;
  thrustFrac: number;
  t: number;
  reducedMotion: boolean;
}

const expK = (dt: number, tau: number): number => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
const DEG = 180 / Math.PI;

/** Vertical fov (deg) that fits all points around the view from `pos` to `target`. */
export function fovToFit(pos: THREE.Vector3, target: THREE.Vector3, pts: readonly THREE.Vector3[], aspect: number, margin: number): number {
  const fwd = target.clone().sub(pos).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd);
  let need = 0;
  const v = new THREE.Vector3();
  for (const p of pts) {
    v.copy(p).sub(pos);
    const z = Math.max(1, v.dot(fwd));
    need = Math.max(need, Math.abs(v.dot(up)) / z, Math.abs(v.dot(right)) / (z * aspect));
  }
  return 2 * Math.atan(need * margin) * DEG;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private initialised = false;
  private pull = 0; // focus-pull breathing after a cut (beach lens)

  constructor(
    readonly id: CameraId,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 1, 32000);
  }

  /** Moves the rig. `snap` skips smoothing (still frames, cuts). */
  update(s: ShotInput, dt: number, snap: boolean): void {
    const c = this.camera;
    const com = new THREE.Vector3(s.com.x, s.com.y, s.com.z);
    const axis = new THREE.Vector3(s.axis.x, s.axis.y, s.axis.z);
    const top = com.clone().addScaledVector(axis, BOOSTER_LENGTH - COM_ABOVE_BASE);
    const base = com.clone().addScaledVector(axis, -COM_ABOVE_BASE);
    const plumeEnd = base.clone().addScaledVector(axis, -30 - 30 * Math.min(1, s.thrustFrac * 2));
    plumeEnd.y = Math.max(plumeEnd.y, 0);
    const wantPos = new THREE.Vector3();
    const wantTarget = com.clone();
    let fov = 50;
    let posTau = 0;
    let targetTau = 0;
    let fovTau = 0.35;
    let shakeK = 0;
    c.up.set(0, 1, 0);
    switch (this.id) {
      case 'towerTop': {
        // Wide lens on the tower top: arms below, booster beside them, sea and horizon beyond.
        // A booster beside the arms is only ~30 m away, so it can never fit whole. Look out
        // to sea over the arms instead: arms and plume below, the hull rising through the
        // frame, the horizon near the top. The aim follows the booster only a little.
        wantPos.set(TOWER_CAM.x, TOWER_CAM.y, TOWER_CAM.z);
        fov = THREE.MathUtils.clamp(2 * Math.atan(Math.tan((112 / 2) * (Math.PI / 180)) / c.aspect) * DEG, 74, 104);
        const look = new THREE.Vector3(55, RAIL_Y - 5, 10);
        const mid = com.clone().addScaledVector(axis, (BOOSTER_LENGTH / 2 - COM_ABOVE_BASE) * 0.5);
        const near = 1 - THREE.MathUtils.clamp((com.distanceTo(look) - 60) / 400, 0, 1);
        wantTarget.copy(look).lerp(mid, 0.25 * near);
        // Pitch between "horizon just inside the top edge" and a shallow 12 deg down.
        const d = wantTarget.clone().sub(wantPos);
        const horiz = Math.max(1, Math.hypot(d.x, d.z));
        const maxDown = ((fov / 2 - 10) * Math.PI) / 180;
        const minDown = (12 * Math.PI) / 180;
        const pitch = THREE.MathUtils.clamp(Math.atan2(d.y, horiz), -maxDown, -minDown);
        wantTarget.y = wantPos.y + Math.tan(pitch) * horiz;
        targetTau = 0.25;
        shakeK = 1;
        break;
      }
      case 'beach': {
        wantPos.set(BEACH_CAM.x, BEACH_CAM.y, BEACH_CAM.z);
        const pts = [top, plumeEnd];
        if (com.y < 420) {
          pts.push(new THREE.Vector3(TOWER_X, TOWER_HEIGHT + 12, 0), new THREE.Vector3(TOWER_X, 0, 0));
        }
        wantTarget.set(0, 0, 0);
        for (const p of pts) wantTarget.add(p);
        wantTarget.multiplyScalar(1 / pts.length);
        fov = THREE.MathUtils.clamp(fovToFit(wantPos, wantTarget, pts, c.aspect, 1.3), 0.8, 30) * (1 + 0.12 * this.pull);
        targetTau = 0.45;
        fovTau = 0.8;
        shakeK = 0.25;
        break;
      }
      case 'chase': {
        const a = 0.75 + 0.035 * s.t;
        wantPos.set(com.x + Math.cos(a) * 150, com.y + 14, com.z - Math.sin(a) * 150);
        wantPos.y = Math.max(wantPos.y, terrainHeight(wantPos.x, wantPos.z) + 12);
        wantTarget.copy(com).addScaledVector(axis, -6);
        fov = 44;
        posTau = 0.9;
        targetTau = 0.12;
        shakeK = 0.7;
        break;
      }
      case 'onboard': {
        const side = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
        const R = BOOSTER_DIAMETER / 2;
        wantPos.copy(com).addScaledVector(axis, PIN_ABOVE_COM - 1).addScaledVector(side, R + 0.9);
        wantTarget.copy(com).addScaledVector(axis, -COM_ABOVE_BASE - 70).addScaledVector(side, R + 9);
        c.up.copy(side);
        fov = 74;
        shakeK = 0.5;
        break;
      }
      case 'wide': {
        wantPos.set(WIDE_CAM.x, WIDE_CAM.y, WIDE_CAM.z);
        const pts = [top, plumeEnd, new THREE.Vector3(TOWER_X, TOWER_HEIGHT + 8, 0), new THREE.Vector3(TOWER_X, 0, 0)];
        wantTarget.set(0, 0, 0);
        for (const p of pts) wantTarget.add(p);
        wantTarget.multiplyScalar(1 / pts.length);
        // Keep some foreground (dunes, crowd) in the bottom of the frame.
        wantTarget.y -= 12;
        fov = THREE.MathUtils.clamp(fovToFit(wantPos, wantTarget, pts, c.aspect, 1.35), 2.5, 38);
        targetTau = 0.6;
        fovTau = 0.9;
        shakeK = 0.1;
        break;
      }
    }
    if (snap || !this.initialised) {
      this.pos.copy(wantPos);
      this.target.copy(wantTarget);
      if (!this.initialised && !snap) this.pull = 1;
      this.initialised = true;
    } else {
      this.pos.lerp(wantPos, expK(dt, posTau));
      this.target.lerp(wantTarget, expK(dt, targetTau));
      this.pull *= 1 - expK(dt, 0.7);
    }
    c.position.copy(this.pos);
    if (Math.abs(c.fov - fov) > 0.001) {
      c.fov = snap ? fov : c.fov + (fov - c.fov) * expK(dt, fovTau);
      c.updateProjectionMatrix();
    }
    // Angular shake, scaled by thrust and distance (never with reduced motion).
    const aim = this.target.clone();
    if (!s.reducedMotion && shakeK > 0 && s.thrustFrac > 0.02) {
      const d = this.pos.distanceTo(com);
      const ang = shakeK * s.thrustFrac * 0.012 / (1 + d / 120);
      const r = this.pos.distanceTo(aim);
      aim.x += Math.sin(s.t * 31.7) * Math.sin(s.t * 4.3) * ang * r;
      aim.y += Math.sin(s.t * 27.3 + 1.1) * Math.sin(s.t * 3.1 + 2) * ang * r;
    }
    c.lookAt(aim);
  }

  /** A cut to this rig: restart the focus pull. */
  cut(): void {
    this.pull = 1;
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.initialised = false;
  }
}

/** Picks the main shot by flight phase, holding each shot at least a few seconds. */
export class AutoDirector {
  current: CameraId = 'wide';
  private since = -1e9;
  static readonly MIN_HOLD = 2.5;

  reset(): void {
    this.current = 'wide';
    this.since = -1e9;
  }

  desired(phase: Phase, tau: number | null, armsClosing: boolean, tDone: number | null, t: number): CameraId {
    if (phase === 'splashdown') return 'wide';
    if (phase === 'caught' || phase === 'settling') return tDone !== null && t - tDone > 2 ? 'wide' : 'towerTop';
    if (tau === null) return 'beach'; // coast: the long lens finds the booster high over the sea
    if (armsClosing || tau >= 20) return 'towerTop';
    if (tau < 4) return 'beach'; // ignition on 13
    if (tau < 10) return 'chase'; // step-down to 3, shock diamonds
    if (tau < 15) return 'wide'; // the divert swing toward the tower
    return 'beach';
  }

  /** Returns the camera to show at sim time t. Cuts immediately on phase ends. */
  update(phase: Phase, tau: number | null, armsClosing: boolean, tDone: number | null, t: number): CameraId {
    const want = this.desired(phase, tau, armsClosing, tDone, t);
    const urgent = phase === 'splashdown' || phase === 'caught' || armsClosing;
    if (want !== this.current && (urgent || t - this.since >= AutoDirector.MIN_HOLD)) {
      this.current = want;
      this.since = t;
    }
    return this.current;
  }

  /** The picture-in-picture shot that best complements the main shot (null = none). */
  static pip(main: CameraId, phase: Phase, tau: number | null): CameraId | null {
    if (tau === null || phase === 'caught' || phase === 'settling' || phase === 'splashdown') return null;
    switch (main) {
      case 'beach':
        return 'towerTop';
      case 'chase':
        return 'beach';
      case 'wide':
        return 'onboard';
      case 'towerTop':
        return 'beach';
      case 'onboard':
        return 'wide';
    }
  }
}
