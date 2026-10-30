import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  AutoDirector,
  CAMERA_IDS,
  CameraRig,
  TOWER_CAM,
  TOWER_TOP_LAYER,
  WIDE_CAM,
  fovToFit,
  frameInSafe,
  safeBand,
  stickYawFrom,
  stickYawOf,
  type CameraId,
  type ShotInput,
} from '../../src/render/cameras';
import { rotateStick } from '../../src/input/mapping';
import { FINAL_APPROACH_HEIGHT, TILT_ABORT_DEG, cadetPinTone, pinTone, tiltTone } from '../../src/ui/tolerance';
import { WATERLINE_X, terrainHeight } from '../../src/render/terrain';
import { autopilotCommand } from '../../src/sim/autopilot';
import { BOOSTER_LENGTH, COM_ABOVE_BASE, PIN_ABOVE_COM, RAIL_Y, TOWER_HEIGHT, TOWER_X } from '../../src/sim/constants';
import type { TierId } from '../../src/sim/tiers';
import { axisFromTilt } from '../../src/sim/vec';
import { createWorld, stepWorld, tauOf } from '../../src/sim/world';
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
  it('a Bullseye points to the next tier: Cadet -> Pilot -> Flight Director', () => {
    expect(tipFor(null, 'bullseye', 'cadet')).toMatch(/Pilot/);
    expect(tipFor(null, 'bullseye', 'cadet')).not.toMatch(/Flight Director/);
    expect(tipFor(null, 'bullseye', 'pilot')).toMatch(/Flight Director/);
    expect(tipFor(null, 'bullseye', 'fd')).toMatch(/wind/i);
  });
  it('failures keep their own tip whatever the medal', () => {
    expect(tipFor('overload', 'none')).toBe(TIPS.overload);
  });
});

describe('HUD tolerance tones: nothing red while the flight goes to plan', () => {
  it('TILT is neutral above the final approach unless it nears the 30 deg abort; contact limit below 30 m', () => {
    expect(tiltTone(29.7, 1200, 3, false)).toBeNull(); // 13-engine braking lean: by design
    expect(tiltTone(29.7, 400, 3)).toBe('warn'); // 3 engines, near the 30 deg abort
    expect(tiltTone(31, 400, 3)).toBe('bad'); // past it
    expect(tiltTone(14.6, 500, 3)).toBeNull(); // the step-down lean: neutral
    expect(tiltTone(4.7, 200, 3)).toBeNull(); // the divert lean: neutral
    expect(tiltTone(16, 200, 3)).toBe('warn'); // past half the abort
    expect(tiltTone(1, 20, 3)).toBe('ok'); // final approach: graded
    expect(tiltTone(2, 20, 3)).toBe('warn');
    expect(tiltTone(3, 20, 3)).toBe('bad');
  });
  it('PIN is neutral above the final approach (a 31 m divert offset is not an error)', () => {
    expect(pinTone(31, 200, 2.5)).toBeNull();
    expect(pinTone(0.5, 20, 2.5)).toBe('ok');
    expect(pinTone(2, 20, 2.5)).toBe('warn');
    expect(pinTone(3, 20, 2.5)).toBe('bad');
  });
  it('Cadet PIN (the aim error) stays neutral until the hover', () => {
    expect(cadetPinTone(2.2, false, 3)).toBeNull();
    expect(cadetPinTone(0.4, true, 3)).toBe('ok');
    expect(cadetPinTone(2.2, true, 3)).toBe('warn');
    expect(FINAL_APPROACH_HEIGHT).toBe(30);
    expect(TILT_ABORT_DEG).toBe(30);
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
    // The divert (from T_DIVERT = 13 s): the beach long lens, not the far wide shot.
    expect(d.desired('burn3', 13.5, false, null, 13.5)).toBe('beach');
    expect(d.desired('burn3', 16, false, null, 16)).toBe('beach');
    expect(d.desired('splashdown', 25, false, 25, 26)).toBe('wide');
  });
  it('shows the booster held in the arms on the beach long lens after the catch (and in the debrief)', () => {
    const d = new AutoDirector();
    expect(d.desired('settling', 31, false, 31, 31.5)).toBe('beach');
    expect(d.desired('caught', 33, false, 31, 33)).toBe('beach');
    // The sim clock stops when the run is done: the shot must not depend on it moving on.
    expect(d.desired('caught', 33, false, 33, 33)).toBe('beach');
    d.update('burn3', 29, true, null, 29);
    expect(d.update('caught', 33, false, 33, 33)).toBe('beach');
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

describe('camera-relative steering', () => {
  // Mid-divert, and late beside the arms.
  const SHOTS = [
    { x: 20, y: 260, z: 4 },
    { x: 6, y: 120, z: -2 },
  ];
  for (const id of CAMERA_IDS) {
    for (const com of SHOTS) {
      it(`${id}: screen-right on the stick moves the booster right on screen (CoM ${com.x}, ${com.y})`, () => {
        const rig = new CameraRig(id, 16 / 9);
        rig.update({ com, axis: { x: 0, y: 1, z: 0 }, thrustFrac: 0.2, t: 18, reducedMotion: true }, 0, true);
        const c = rig.camera;
        c.updateMatrixWorld();
        const yaw = stickYawOf(c);
        const p = new THREE.Vector3(com.x, com.y, com.z);
        const ndc0 = p.clone().project(c);
        // Screen right -> world, then 5 m that way.
        const [rx, rz] = rotateStick(1, 0, yaw);
        expect(Math.hypot(rx, rz)).toBeCloseTo(1, 9);
        const ndcR = p.clone().add(new THREE.Vector3(rx * 5, 0, rz * 5)).project(c);
        expect(ndcR.x, `${id} right`).toBeGreaterThan(ndc0.x + 1e-4);
        expect(Math.abs(ndcR.y - ndc0.y), `${id} stays level`).toBeLessThan(Math.abs(ndcR.x - ndc0.x));
        // Screen up -> into the scene: away from the lens over the ground.
        const [ux, uz] = rotateStick(0, -1, yaw);
        const fwd = new THREE.Vector3();
        c.getWorldDirection(fwd);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
        const into = fwd.y < -0.9 ? up : fwd; // a lens looking straight down: "up the screen"
        expect(ux * into.x + uz * into.z, `${id} up = into the scene`).toBeGreaterThan(0);
      });
    }
  }

  it('tower top: pulling the stick down (toward the tower on screen) moves toward the tower', () => {
    const rig = new CameraRig('towerTop', 16 / 9);
    rig.update({ com: { x: 8, y: 140, z: 0 }, axis: { x: 0, y: 1, z: 0 }, thrustFrac: 0.2, t: 22, reducedMotion: true }, 0, true);
    const [x] = rotateStick(0, 1, stickYawOf(rig.camera));
    expect(x).toBeLessThan(-0.5); // the tower stands inland, at -x
  });

  it('a level lens looking along -z needs no turn; the yaw is continuous across the horizon', () => {
    expect(stickYawFrom({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(0, 9);
    const s = Math.SQRT1_2;
    const down = stickYawFrom({ x: 0, y: -s, z: -s }, { x: 0, y: s, z: -s });
    const upward = stickYawFrom({ x: 0, y: s, z: -s }, { x: 0, y: s, z: s });
    expect(down).toBeCloseTo(0, 9);
    expect(upward).toBeCloseTo(0, 9);
  });
});

describe('auto-director holds the shot while the player steers', () => {
  const fly = (steering: boolean): Map<number, CameraId> => {
    const d = new AutoDirector();
    const shots = new Map<number, CameraId>();
    for (let tau = 0; tau <= 26.0001; tau += 0.1) {
      const t = tau + 4;
      shots.set(Math.round(tau * 10), d.update(tau < 4 ? 'burn13' : 'burn3', tau, false, null, t, steering));
    }
    return shots;
  };
  it('cuts from the wide shot to the beach lens at the divert, then holds it while steering (no cut to 23 s)', () => {
    const steer = fly(true);
    expect(steer.get(120)).toBe('wide');
    // The cut at T_DIVERT (13 s) still happens (within a step of float rounding).
    for (let k = 132; k < 230; k++) expect(steer.get(k), `tau ${k / 10}`).toBe('beach');
    expect(steer.get(240)).toBe('towerTop');
    const free = fly(false);
    expect(free.get(120)).toBe('wide');
    expect(free.get(170)).toBe('beach');
    expect(free.get(210)).toBe('towerTop');
  });
  it('never holds the far wide lens through the divert, even when steering from before 13 s', () => {
    const steer = fly(true);
    for (let k = 132; k < 260; k++) expect(steer.get(k), `tau ${k / 10}`).not.toBe('wide');
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

  it('desktop tower top: the ring and the pins at contact sit clear of the bottom HUD strip, horizon in frame', () => {
    const rig = new CameraRig('towerTop', 16 / 9);
    rig.update(shotAt({ x: 1, y: 70, z: 0 }), 0, true);
    const c = rig.camera;
    c.updateMatrixWorld();
    const ring = new THREE.Vector3(0, RAIL_Y + 0.4, 0).project(c);
    // Bottom strip ~20% of the height (ndc y < -0.6): the ring sits above it, below mid-frame.
    expect(ring.y).toBeGreaterThan(-0.6);
    expect(ring.y).toBeLessThan(0);
    expect(Math.abs(ring.x)).toBeLessThan(1);
    const fwd = new THREE.Vector3();
    c.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const horizon = new THREE.Vector3(TOWER_CAM.x, TOWER_CAM.y, TOWER_CAM.z).addScaledVector(fwd, 20000);
    horizon.y = 0;
    expect(inFrame(c, horizon)).toBe(true);
  });

  it('tower top after the catch keeps the booster in the arms and the horizon in frame', () => {
    const rig = new CameraRig('towerTop', 16 / 9);
    rig.update(shotAt({ x: 0, y: 61, z: 0 }), 0, true);
    const c = rig.camera;
    c.updateMatrixWorld();
    expect(inFrame(c, new THREE.Vector3(0, 100, 0))).toBe(true);
  });

  it('the tower-top lens sits clear of the tower steel (no structure within a few metres)', () => {
    // Tower column: 12 m square around TOWER_X, z = 0, up to TOWER_HEIGHT (+ deck, housing, mast).
    const half = 6 + 1.5;
    const dx = Math.max(0, Math.abs(TOWER_CAM.x - TOWER_X) - half);
    const dz = Math.max(0, Math.abs(TOWER_CAM.z) - half);
    expect(Math.hypot(dx, dz)).toBeGreaterThan(10);
    expect(TOWER_CAM.y).toBeGreaterThan(TOWER_HEIGHT + 5);
  });

  it('the tower-top structure is on its own layer, hidden from the tower-top lens only', () => {
    const top = new CameraRig('towerTop', 1.6).camera;
    const beach = new CameraRig('beach', 1.6).camera;
    const probe = new THREE.Object3D();
    probe.layers.set(TOWER_TOP_LAYER);
    expect(probe.layers.test(top.layers)).toBe(false);
    expect(probe.layers.test(beach.layers)).toBe(true);
  });

  it('the menu hero shot is low and close, and frames the booster in the arms', () => {
    const rig = new CameraRig('wide', 16 / 9);
    rig.update({ ...shotAt({ x: 0, y: 61, z: 0 }), hero: true }, 0, true);
    const c = rig.camera;
    c.updateMatrixWorld();
    expect(c.position.y).toBeLessThan(10);
    expect(Math.hypot(c.position.x - TOWER_X, c.position.z)).toBeLessThan(600);
    expect(inFrame(c, new THREE.Vector3(0, 100, 0))).toBe(true);
    expect(inFrame(c, new THREE.Vector3(0, 61 + 45, 0))).toBe(true); // the nose
    // Right of centre on wide screens (the left rail covers the left side).
    expect(new THREE.Vector3(0, 80, 0).project(c).x).toBeGreaterThan(0);
  });

  it('frameInSafe puts every point below the HUD band and inside the frame', () => {
    const pos = new THREE.Vector3(0, 2, 2000);
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 450, 0), new THREE.Vector3(30, 200, 0)];
    for (const aspect of [16 / 9, 390 / 844]) {
      const { top, bottom } = safeBand(aspect);
      const f = frameInSafe(pos, pts, aspect, top, bottom, 1.1, 1, 60);
      const cam = new THREE.PerspectiveCamera(f.fov, aspect, 1, 10000);
      cam.position.copy(pos);
      cam.lookAt(f.target);
      cam.updateMatrixWorld();
      for (const p of pts) {
        const q = p.clone().project(cam);
        expect(q.y).toBeLessThanOrEqual(1 - 2 * top + 1e-3);
        expect(q.y).toBeGreaterThanOrEqual(-1 + 2 * bottom - 1e-3);
        expect(Math.abs(q.x)).toBeLessThan(1);
      }
    }
  });

  it('wide and beach cams stand on the ground, above the sand', () => {
    expect(WIDE_CAM.y).toBeGreaterThan(terrainHeight(WIDE_CAM.x, WIDE_CAM.z) + 1);
    expect(WIDE_CAM.x).toBeLessThan(WATERLINE_X);
  });
});

describe('auto-director shots keep the booster in the safe frame below the HUD', () => {
  // HUD strip: at the BOTTOM on desktop (~20%), at the TOP on phones (~28%: strip + folded board).
  const SCREENS: [string, number, { top: number; bottom: number }][] = [
    ['desktop 1280x720', 1280 / 720, { top: 0, bottom: 0.2 }],
    ['phone 393x852', 393 / 852, { top: 0.28, bottom: 0 }],
  ];
  const RUNS: [TierId, number][] = [
    ['cadet', 1],
    ['pilot', 3],
    ['fd', 2],
    ['fd', 7],
  ];
  for (const [label, aspect, hud] of SCREENS) {
    for (const [tier, seed] of RUNS) {
      it(`${tier} seed ${seed}, ${label}`, () => {
        const w = createWorld(seed, tier);
        const director = new AutoDirector();
        const rigs = new Map<CameraId, CameraRig>();
        let checked = 0;
        let guard = 0;
        while (!w.done && guard++ < 120 * 90) {
          stepWorld(w, autopilotCommand(w));
          if (w.step % 30 !== 0 || w.phase === 'splashdown') continue;
          const tau = tauOf(w);
          const id = director.update(w.phase, tau, w.arms.closing, null, w.t);
          let rig = rigs.get(id);
          if (!rig) {
            rig = new CameraRig(id, aspect);
            rigs.set(id, rig);
          }
          const axis = axisFromTilt(w.tilt);
          rig.update({ com: w.pos, axis, thrustFrac: 0.3, t: w.t, reducedMotion: true }, 0, true);
          const c = rig.camera;
          c.updateMatrixWorld();
          const at = (k: number): THREE.Vector3 => new THREE.Vector3(w.pos.x + axis.x * k, w.pos.y + axis.y * k, w.pos.z + axis.z * k);
          const safe = (p: THREE.Vector3): boolean => {
            const q = p.clone().project(c);
            return q.z < 1 && Math.abs(q.x) < 1 && q.y > -1 + 2 * hud.bottom && q.y < 1 - 2 * hud.top;
          };
          const where = `${id} at t=${w.t.toFixed(1)} (tau ${tau?.toFixed(1) ?? '-'})`;
          if (id === 'towerTop') {
            // A close wide lens: the booster never fits whole; its engine end or its pins must
            // read once it is beside the arms (a no-go booster stays offshore, out of this lens).
            // While it drops past the lens the hull spans the frame (engines at the bottom edge, pins
            // just under the HUD), so check every 2 m of hull between the engines and the pins.
            if (Math.hypot(w.pos.x, w.pos.z) < 120) {
              let seen = false;
              for (let k = -COM_ABOVE_BASE; k <= PIN_ABOVE_COM && !seen; k += 2) seen = safe(at(k));
              expect(seen, where).toBe(true);
            }
          } else if (id !== 'onboard') {
            expect(safe(at(0)), `CoM, ${where}`).toBe(true);
            expect(safe(at(BOOSTER_LENGTH - COM_ABOVE_BASE - 2)), `nose, ${where}`).toBe(true);
          }
          checked++;
        }
        expect(checked).toBeGreaterThan(20);
      });
    }
  }
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
