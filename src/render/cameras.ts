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
/**
 * Camera on a boom off the tower top, looking out to sea over the arms. It sits clear
 * of the deck, crane housing and mast (those are also hidden from this lens on
 * TOWER_TOP_LAYER), so no tower steel fills the frame near the lens.
 */
export const TOWER_CAM: Vec3 = { x: TOWER_X + 2, y: TOWER_HEIGHT + 9, z: -24 };
/** Render layer for the tower-top structure: every camera sees it except the tower-top lens. */
export const TOWER_TOP_LAYER = 1;
/**
 * Main-menu hero shot: low on the site, a three-quarter view from inland and up the coast,
 * so both arms visibly wrap the caught booster and the low sun rims it from behind.
 */
// From (-90, 200) the line to the booster passes ~15 m clear of the tower column, so the
// tower never hides the hull, and the arms are seen ~25 deg off their side.
export const HERO_CAM: Vec3 = { x: TOWER_X - 74, y: terrainHeight(TOWER_X - 74, 200) + 2.4, z: 200 };

/**
 * Fraction of the frame height that the HUD covers at the top: the telemetry strip on
 * desktop (~20%) and the strip with the folded board on phones (~28%), plus a margin.
 */
export function safeTop(aspect: number): number {
  return aspect < 1 ? 0.3 : 0.22;
}
/** Bottom margin (camera tag, thumbs) kept clear of the subject. */
export const SAFE_BOTTOM = 0.07;

export interface ShotInput {
  com: Vec3;
  axis: Vec3;
  thrustFrac: number;
  t: number;
  reducedMotion: boolean;
  /** Main menu: the wide rig takes the hero shot, framed right of the left rail. */
  hero?: boolean;
  /** Seconds since the pins touched the rails (drives the settle bounce), or null. */
  impact?: number | null;
}

const expK = (dt: number, tau: number): number => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
const DEG = 180 / Math.PI;

/**
 * Stick yaw (rad) for a camera with view direction `fwd` and up vector `up`: the ground
 * direction that looks "up the screen" (into the scene) is g = (-sin yaw, -cos yaw), and
 * screen-right is g turned 90 deg clockwise from above. A level camera looking along -z
 * has yaw 0 (stick right = world +x). Works for lenses pitched up, down or straight down.
 */
export function stickYawFrom(fwd: Vec3, up: Vec3): number {
  // Pitched down, the up vector leans into the scene; pitched up, it leans back toward us.
  const k = fwd.y < 0 ? 1 : -1;
  let gx = fwd.x + k * up.x;
  let gz = fwd.z + k * up.z;
  if (Math.hypot(gx, gz) < 1e-9) {
    gx = 0;
    gz = -1;
  }
  return Math.atan2(-gx, -gz);
}

const tmpF = new THREE.Vector3();
const tmpU = new THREE.Vector3();
/** Stick yaw of a three.js camera (from its orientation). */
export function stickYawOf(cam: THREE.Camera): number {
  tmpF.set(0, 0, -1).applyQuaternion(cam.quaternion);
  tmpU.set(0, 1, 0).applyQuaternion(cam.quaternion);
  return stickYawFrom(tmpF, tmpU);
}

/**
 * Aim and vertical fov that put every point inside the safe band of the frame:
 * below the top `top` fraction (the HUD) and above the bottom `bottom` fraction.
 * The lens is clamped to [minFov, maxFov] (deg); with a fixed lens it only re-aims.
 */
export function frameInSafe(
  pos: THREE.Vector3,
  pts: readonly THREE.Vector3[],
  aspect: number,
  top: number,
  bottom: number,
  margin: number,
  minFov: number,
  maxFov: number,
): { target: THREE.Vector3; fov: number } {
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.multiplyScalar(1 / Math.max(1, pts.length));
  const dist = Math.max(1, c.distanceTo(pos));
  const fwd = c.clone().sub(pos).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd);
  let uMin = Infinity;
  let uMax = -Infinity;
  let rMax = 0;
  const v = new THREE.Vector3();
  for (const p of pts) {
    v.copy(p).sub(pos);
    const z = Math.max(1, v.dot(fwd));
    const u = v.dot(up) / z;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    rMax = Math.max(rMax, Math.abs(v.dot(right)) / z);
  }
  if (!Number.isFinite(uMin)) {
    uMin = 0;
    uMax = 0;
  }
  const yLo = -1 + 2 * bottom;
  const yHi = 1 - 2 * top;
  const cy = (yLo + yHi) / 2;
  const h = Math.max(0.1, (yHi - yLo) / 2);
  const need = Math.max((uMax - uMin) / 2 / h, rMax / (aspect * 0.9)) * margin;
  const fov = THREE.MathUtils.clamp(2 * Math.atan(need) * DEG, minFov, maxFov);
  const T = Math.tan(((fov / 2) * Math.PI) / 180);
  // Tilt the aim so the content's middle lands on the middle of the safe band.
  const a = Math.atan((uMin + uMax) / 2) - Math.atan(cy * T);
  const aim = fwd.multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
  return { target: pos.clone().addScaledVector(aim, dist), fov };
}

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
    if (id !== 'towerTop') this.camera.layers.enable(TOWER_TOP_LAYER);
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
        // Portrait screens are narrow: lean further toward the booster so a divert toward the
        // camera side does not push it past the side edge.
        wantTarget.copy(look).lerp(mid, (c.aspect < 1 ? 0.45 : 0.25) * near);
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
        // Long lens: the subject sits in the band below the HUD strip.
        // Portrait phones are narrow: allow a wider lens so tower and booster both fit.
        const f = frameInSafe(wantPos, pts, c.aspect, safeTop(c.aspect), SAFE_BOTTOM, 1.2, 0.8, c.aspect < 1 ? 48 : 30);
        wantTarget.copy(f.target);
        fov = f.fov * (1 + 0.12 * this.pull);
        targetTau = 0.45;
        fovTau = 0.8;
        shakeK = 0.25;
        break;
      }
      case 'chase': {
        const a = 0.75 + 0.035 * s.t;
        // A little farther out on portrait phones, so the whole hull clears the taller HUD.
        const R = c.aspect < 1 ? 185 : 150;
        wantPos.set(com.x + Math.cos(a) * R, com.y + 14, com.z - Math.sin(a) * R);
        wantPos.y = Math.max(wantPos.y, terrainHeight(wantPos.x, wantPos.z) + 12);
        // Fixed 44 deg drone lens, re-aimed so the hull and engine end clear the HUD.
        const f = frameInSafe(wantPos, [top, base], c.aspect, safeTop(c.aspect), SAFE_BOTTOM, 1, 44, 44);
        wantTarget.copy(f.target);
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
        if (s.hero) {
          // Low three-quarter view: the tower top and the booster held in both arms fill
          // the frame, the sunset rims them. No HUD in the menu, so only a small top margin.
          wantPos.set(HERO_CAM.x, HERO_CAM.y, HERO_CAM.z);
          const pts = [top, new THREE.Vector3(TOWER_X, TOWER_HEIGHT + 17, 0), new THREE.Vector3(TOWER_X, 40, 0), base];
          const f = frameInSafe(wantPos, pts, c.aspect, 0.05, 0.04, 1.08, 8, 60);
          wantTarget.copy(f.target);
          fov = f.fov;
          // Aim left of the subject so it sits right of centre, clear of the left rail.
          if (c.aspect > 1) {
            const fwd = wantTarget.clone().sub(wantPos).normalize();
            const right = new THREE.Vector3().crossVectors(fwd, c.up).normalize();
            const halfW = Math.tan(((fov / 2) * Math.PI) / 180) * wantPos.distanceTo(wantTarget) * c.aspect;
            wantTarget.addScaledVector(right, -0.26 * halfW);
          }
          targetTau = 0.6;
          fovTau = 0.9;
          break;
        }
        wantPos.set(WIDE_CAM.x, WIDE_CAM.y, WIDE_CAM.z);
        const pts = [top, plumeEnd, new THREE.Vector3(TOWER_X, TOWER_HEIGHT + 8, 0), new THREE.Vector3(TOWER_X, 0, 0)];
        // Keep the whole story (booster, plume, tower) below the HUD, with some foreground
        // (dunes, crowd) at the bottom of the frame.
        const f = frameInSafe(wantPos, pts, c.aspect, safeTop(c.aspect), SAFE_BOTTOM + 0.06, 1.12, 2.5, c.aspect < 1 ? 64 : 38);
        wantTarget.copy(f.target);
        fov = f.fov;
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
    const aim = this.target.clone();
    let roll = 0;
    if (!s.reducedMotion) {
      const r = this.pos.distanceTo(aim);
      const fovRad = (c.fov * Math.PI) / 180;
      // Micro-shake: angular, scaled by thrust and by how close the lens is to the plume.
      if (shakeK > 0 && s.thrustFrac > 0.02) {
        const d = this.pos.distanceTo(com);
        const ang = (shakeK * s.thrustFrac * 0.012) / (1 + d / 120) + 0.0025 * fovRad * s.thrustFrac;
        aim.x += (Math.sin(s.t * 31.7) * Math.sin(s.t * 4.3) + 0.35 * Math.sin(s.t * 71.3)) * ang * r;
        aim.y += (Math.sin(s.t * 27.3 + 1.1) * Math.sin(s.t * 3.1 + 2) + 0.35 * Math.sin(s.t * 63.1 + 0.4)) * ang * r;
        roll = Math.sin(s.t * 23.9 + 0.7) * ang * 0.6;
      }
      // Settle bounce: the frame dips with the heavy thud on the rails, then rings out.
      const ti = s.impact;
      if (ti !== null && ti !== undefined && ti >= 0 && ti < 1.6) {
        const k = 0.03 * fovRad * Math.exp(-ti / 0.35) * Math.sin(2 * Math.PI * 2.2 * ti);
        aim.y -= k * r;
      }
    }
    c.lookAt(aim);
    if (roll !== 0) c.rotateZ(roll);
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

/**
 * Picks the main shot by flight phase, holding each shot at least a few seconds. While the
 * player steers during the divert (STEER_HOLD) it holds the current shot: a cut would turn
 * the camera-relative stick under the player's thumb.
 */
export class AutoDirector {
  current: CameraId = 'wide';
  private since = -1e9;
  static readonly MIN_HOLD = 2.5;
  /** Seconds after ignition in which a steering player keeps the current shot. */
  static readonly STEER_HOLD: readonly [number, number] = [13, 23];

  reset(): void {
    this.current = 'wide';
    this.since = -1e9;
  }

  desired(phase: Phase, tau: number | null, armsClosing: boolean, _tDone: number | null, _t: number): CameraId {
    if (phase === 'splashdown') return 'wide';
    // The caught moment and the debrief: the beach long lens shows the booster held in the arms.
    if (phase === 'caught' || phase === 'settling') return 'beach';
    if (tau === null) return 'beach'; // coast: the long lens finds the booster high over the sea
    if (armsClosing || tau >= 20) return 'towerTop';
    if (tau < 4) return 'beach'; // ignition on 13
    if (tau < 10) return 'chase'; // step-down to 3, shock diamonds
    if (tau < 15) return 'wide'; // the divert swing toward the tower
    return 'beach';
  }

  /**
   * Returns the camera to show at sim time t. Cuts immediately on phase ends. `steering`:
   * the player is on the stick, so no cut between STEER_HOLD[0] and STEER_HOLD[1].
   */
  update(phase: Phase, tau: number | null, armsClosing: boolean, tDone: number | null, t: number, steering = false): CameraId {
    const want = this.desired(phase, tau, armsClosing, tDone, t);
    const urgent = phase === 'splashdown' || phase === 'caught' || armsClosing;
    const [h0, h1] = AutoDirector.STEER_HOLD;
    const hold = steering && tau !== null && tau >= h0 && tau < h1;
    if (want !== this.current && (urgent || (!hold && t - this.since >= AutoDirector.MIN_HOLD))) {
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
