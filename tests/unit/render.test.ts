import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AutoDirector, CAMERA_IDS, CameraRig, TOWER_CAM, WIDE_CAM, fovToFit, type ShotInput } from '../../src/render/cameras';
import { WATERLINE_X, terrainHeight } from '../../src/render/terrain';
import { RAIL_Y, TOWER_X } from '../../src/sim/constants';
import { CATCH_TIPS, TIPS, tipFor } from '../../src/sim/tips';

describe('debrief tips depend on the result', () => {
  it('a Bullseye is never told to try for a Bullseye', () => {
    expect(tipFor(null, 'bullseye')).not.toMatch(/try for a bullseye/i);
    expect(tipFor(null, 'bullseye')).toMatch(/bullseye/i);
  });
  it('lower medals get a specific next step', () => {
    expect(tipFor(null, 'gold')).toMatch(/0\.3 m/);
    for (const m of ['gold', 'silver', 'bronze', 'none'] as const) expect(tipFor(null, m)).toBe(CATCH_TIPS[m]);
  });
  it('failures keep their own tip whatever the medal', () => {
    expect(tipFor('overload', 'none')).toBe(TIPS.overload);
  });
});

describe('auto-director', () => {
  it('cuts to the tower top for the final approach and the arms', () => {
    const d = new AutoDirector();
    expect(d.desired('burn3', 20, false, null, 20)).toBe('towerTop');
    expect(d.desired('burn3', 16, true, null, 16)).toBe('towerTop');
    expect(d.desired('burn13', 1, false, null, 1)).toBe('beach');
    expect(d.desired('burn3', 6, false, null, 6)).toBe('chase');
    expect(d.desired('burn3', 12, false, null, 12)).toBe('wide');
    expect(d.desired('splashdown', 25, false, 25, 26)).toBe('wide');
  });
  it('the picture-in-picture never repeats the main shot and hides after the flight', () => {
    for (const id of CAMERA_IDS) {
      const p = AutoDirector.pip(id, 'burn3', 10);
      expect(p).not.toBeNull();
      expect(p).not.toBe(id);
      expect(AutoDirector.pip(id, 'caught', 33)).toBeNull();
      expect(AutoDirector.pip(id, 'coast', null)).toBeNull();
    }
  });
});

describe('camera framing', () => {
  it('fovToFit matches the analytic angle for a centred span', () => {
    const pos = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(0, 0, -100);
    const fov = fovToFit(pos, target, [new THREE.Vector3(0, 50, -100), new THREE.Vector3(0, -50, -100)], 1, 1);
    // half-span 50 m at 100 m: tan(half-angle) = 0.5, so fov = 2·atan(0.5) ≈ 53.13°
    expect(fov).toBeCloseTo(2 * Math.atan(0.5) * (180 / Math.PI), 6);
  });

  const shotAt = (com: { x: number; y: number; z: number }): ShotInput => ({
    com,
    axis: { x: 0, y: 1, z: 0 },
    thrustFrac: 0.1,
    t: 20,
    reducedMotion: true,
  });
  const inFrame = (cam: THREE.PerspectiveCamera, p: THREE.Vector3): boolean => {
    const q = p.clone().project(cam);
    return q.z < 1 && Math.abs(q.x) < 1 && Math.abs(q.y) < 1;
  };

  for (const aspect of [16 / 9, 390 / 844]) {
    it(`tower top at +20 s shows the arms, the lower booster and the horizon (aspect ${aspect.toFixed(2)})`, () => {
      // Reference state at +20 s: CoM ~150 m up, ~5 m offshore of the arms.
      const rig = new CameraRig('towerTop', aspect);
      rig.update(shotAt({ x: 5, y: 150, z: 0 }), 0, true);
      const c = rig.camera;
      c.updateMatrixWorld();
      expect(inFrame(c, new THREE.Vector3(8, RAIL_Y, 0))).toBe(true); // arms
      expect(inFrame(c, new THREE.Vector3(5, 125, 0))).toBe(true); // engine end
      const fwd = new THREE.Vector3();
      c.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const horizon = new THREE.Vector3(TOWER_CAM.x, TOWER_CAM.y, TOWER_CAM.z).addScaledVector(fwd, 20000);
      horizon.y = 0;
      expect(inFrame(c, horizon)).toBe(true);
    });
  }

  it('tower top after the catch keeps the booster in the arms and the horizon in frame', () => {
    const rig = new CameraRig('towerTop', 16 / 9);
    rig.update(shotAt({ x: 0, y: 61, z: 0 }), 0, true);
    const c = rig.camera;
    c.updateMatrixWorld();
    expect(inFrame(c, new THREE.Vector3(0, 100, 0))).toBe(true);
  });

  it('wide and beach cams stand on the ground, above the sand', () => {
    expect(WIDE_CAM.y).toBeGreaterThan(terrainHeight(WIDE_CAM.x, WIDE_CAM.z) + 1);
    expect(WIDE_CAM.x).toBeLessThan(WATERLINE_X);
  });
});

describe('coast terrain', () => {
  it('is below the sea offshore and above it inland', () => {
    expect(terrainHeight(WATERLINE_X + 50, 0)).toBeLessThan(0);
    expect(terrainHeight(WATERLINE_X - 40, 900)).toBeGreaterThan(0);
  });
  it('is flat and graded around the tower', () => {
    for (const [x, z] of [
      [TOWER_X, 0],
      [TOWER_X - 30, 40],
      [0, -30],
    ] as const) {
      expect(Math.abs(terrainHeight(x, z) - 0.35)).toBeLessThan(0.3);
    }
  });
});
