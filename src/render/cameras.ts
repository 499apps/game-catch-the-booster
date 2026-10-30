// The five webcast camera rigs and a basic auto-director.
import * as THREE from 'three';
import { BOOSTER_LENGTH, COM_ABOVE_BASE, PIN_ABOVE_COM, RAIL_Y, SHORELINE_X, TOWER_HEIGHT, TOWER_X } from '../sim/constants';
import type { Phase } from '../sim/types';
import type { Vec3 } from '../sim/vec';

export type CameraId = 'towerTop' | 'beach' | 'chase' | 'onboard' | 'wide';
export const CAMERA_IDS: readonly CameraId[] = ['towerTop', 'beach', 'chase', 'onboard', 'wide'];
export const CAMERA_LABELS: Record<CameraId, string> = {
  towerTop: 'Tower top',
  beach: 'Beach long lens',
  chase: 'Drone chase',
  onboard: 'Onboard',
  wide: 'Wide bay',
};

export const BEACH_CAM: Vec3 = { x: SHORELINE_X - 12, y: 4, z: -1700 };
export const WIDE_CAM: Vec3 = { x: -420, y: 28, z: -2300 };
export const TOWER_CAM: Vec3 = { x: TOWER_X + 3, y: TOWER_HEIGHT + 3, z: 2 };

export interface ShotInput {
  com: Vec3;
  axis: Vec3;
  thrustFrac: number;
  t: number;
  reducedMotion: boolean;
}

const expK = (dt: number, tau: number): number => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private initialised = false;

  constructor(
    readonly id: CameraId,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 1, 30000);
  }

  /** Moves the rig. `snap` skips smoothing (still frames, cuts). */
  update(s: ShotInput, dt: number, snap: boolean): void {
    const c = this.camera;
    const com = new THREE.Vector3(s.com.x, s.com.y, s.com.z);
    const axis = new THREE.Vector3(s.axis.x, s.axis.y, s.axis.z);
    const wantPos = new THREE.Vector3();
    const wantTarget = com.clone();
    let fov = 50;
    let posTau = 0;
    let targetTau = 0;
    c.up.set(0, 1, 0);
    switch (this.id) {
      case 'towerTop': {
        wantPos.set(TOWER_CAM.x, TOWER_CAM.y, TOWER_CAM.z);
        // Aim between the pins and the arms so both stay in frame on the final drop.
        wantTarget.copy(com).addScaledVector(axis, PIN_ABOVE_COM * 0.4);
        if (com.y < 400) wantTarget.y = Math.min(wantTarget.y, RAIL_Y + 10 + (com.y - 61) * 0.6);
        fov = 72;
        targetTau = 0.15;
        break;
      }
      case 'beach': {
        wantPos.set(BEACH_CAM.x, BEACH_CAM.y, BEACH_CAM.z);
        const d = wantPos.distanceTo(com);
        // Long lens: keep the booster about 40% of the frame height, a little lag.
        fov = THREE.MathUtils.clamp((2 * Math.atan((BOOSTER_LENGTH * 1.25) / d) * 180) / Math.PI, 1.2, 40);
        targetTau = 0.35;
        break;
      }
      case 'chase': {
        wantPos.set(com.x + 85, com.y + 6, com.z - 120);
        fov = 46;
        posTau = 0.7;
        targetTau = 0.1;
        break;
      }
      case 'onboard': {
        const side = new THREE.Vector3(1, 0, 0);
        wantPos.copy(com).addScaledVector(axis, PIN_ABOVE_COM + 3).addScaledVector(side, 6.2);
        wantTarget.copy(com).addScaledVector(axis, -COM_ABOVE_BASE - 60).addScaledVector(side, 3);
        c.up.copy(side);
        fov = 78;
        break;
      }
      case 'wide': {
        wantPos.set(WIDE_CAM.x, WIDE_CAM.y, WIDE_CAM.z);
        wantTarget.set(0, 70, 0).lerp(com, 0.5);
        const d = wantPos.distanceTo(wantTarget);
        const span = Math.max(220, Math.abs(com.y - 70) + 160);
        fov = THREE.MathUtils.clamp((2 * Math.atan(span / 2 / d) * 180) / Math.PI, 4, 45);
        targetTau = 0.4;
        break;
      }
    }
    // Shake on the close-in rigs, scaled by thrust (never with reduced motion).
    if (!s.reducedMotion && (this.id === 'towerTop' || this.id === 'chase') && s.thrustFrac > 0.02) {
      const d = wantPos.distanceTo(com);
      const amp = Math.min(0.6, (s.thrustFrac * 40) / Math.max(d, 40));
      wantPos.x += amp * Math.sin(s.t * 31.7);
      wantPos.y += amp * Math.sin(s.t * 27.3 + 1.1);
    }
    if (snap || !this.initialised) {
      this.pos.copy(wantPos);
      this.target.copy(wantTarget);
      this.initialised = true;
    } else {
      this.pos.lerp(wantPos, expK(dt, posTau));
      this.target.lerp(wantTarget, expK(dt, targetTau));
    }
    c.position.copy(this.pos);
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = snap ? fov : c.fov + (fov - c.fov) * expK(dt, 0.3);
      c.updateProjectionMatrix();
    }
    c.lookAt(this.target);
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.initialised = false;
  }
}

/** Picks a camera by flight phase, holding each shot at least a few seconds. */
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
    if (phase === 'caught' || phase === 'settling') return tDone !== null && t - tDone > 1.5 ? 'wide' : 'towerTop';
    if (tau === null) return 'beach';
    if (armsClosing || tau >= 19) return 'towerTop';
    if (tau < 4) return 'beach';
    if (tau < 10) return 'chase';
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
}
