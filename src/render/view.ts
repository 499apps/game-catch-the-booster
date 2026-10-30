// Renderer, post-processing, camera rigs and the picture-in-picture inset. Creating it
// throws if WebGL is unavailable; the game then keeps running (HUD, sim, debrief) without
// the 3D view.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CAMERA_IDS, CameraRig, type CameraId, type ShotInput } from './cameras';
import type { QualityProfile } from './quality';
import { WorldScene, type FrameState } from './scene';
import { makeSkyMaterial } from './materials';
import { FinishPass } from './post';

/** three.js r170 needs WebGL2. Probe first so a missing context logs no console error. */
export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Bloom at half the composer resolution (Medium tier). */
class HalfBloomPass extends UnrealBloomPass {
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
  }
}

/** How strongly each lens shows the engine glare (long lenses flare most). */
const FLARE_BY_CAM: Record<CameraId, number> = { beach: 1, wide: 0.8, chase: 0.45, towerTop: 0.5, onboard: 0.25 };
const BASE_EXPOSURE = 0.92;

export interface PipRect {
  x: number; // CSS px from the canvas left
  y: number; // CSS px from the canvas top
  w: number;
  h: number;
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly world = new WorldScene();
  readonly rigs: Record<CameraId, CameraRig>;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private finish: FinishPass | null = null;
  private profile: QualityProfile;
  private width = 1;
  private height = 1;
  private adapt = 0;
  private lastT = 0;
  private readonly tmp = new THREE.Vector3();
  /** Draw calls in the last frame (all passes, PiP included). */
  drawCalls = 0;
  /** Extra render scale (test hook only; 1 in normal play). */
  private readonly scale: number;

  constructor(
    readonly canvas: HTMLCanvasElement,
    profile: QualityProfile,
    opts: { preserveDrawingBuffer: boolean; scale?: number },
  ) {
    this.scale = opts.scale ?? 1;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: profile.tier !== 'low',
      powerPreference: 'high-performance',
      preserveDrawingBuffer: opts.preserveDrawingBuffer,
      alpha: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = BASE_EXPOSURE;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;

    // Image-based lighting from the procedural dusk sky (no files), so the stainless hull reflects it.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyGeo = new THREE.SphereGeometry(100, 48, 24);
    const skyMat = makeSkyMaterial();
    envScene.add(new THREE.Mesh(skyGeo, skyMat));
    const env = pmrem.fromScene(envScene, 0.015);
    this.world.scene.environment = env.texture;
    skyGeo.dispose();
    skyMat.dispose();
    pmrem.dispose();

    const rigs = {} as Record<CameraId, CameraRig>;
    for (const id of CAMERA_IDS) rigs[id] = new CameraRig(id, 1);
    this.rigs = rigs;
    this.profile = profile;
    this.applyQuality(profile);
  }

  applyQuality(p: QualityProfile): void {
    this.profile = p;
    this.renderer.shadowMap.enabled = p.shadowMapSize > 0;
    this.world.setQuality(p);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatioCap) * this.scale);
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.finish = null;
    if (p.bloom !== 'off') {
      const composer = new EffectComposer(this.renderer);
      this.renderPass = new RenderPass(this.world.scene, this.rigs.wide.camera);
      composer.addPass(this.renderPass);
      const res = new THREE.Vector2(this.width, this.height);
      const bloom = p.bloom === 'half' ? new HalfBloomPass(res, 0.5, 0.55, 0.92) : new UnrealBloomPass(res, 0.62, 0.6, 0.9);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.finish = new FinishPass();
      composer.addPass(this.finish);
      this.composer = composer;
    }
    this.resize(this.width, this.height);
  }

  get hasPost(): boolean {
    return this.composer !== null;
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.pixelRatioCap) * this.scale);
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(this.width, this.height);
    }
    for (const id of CAMERA_IDS) this.rigs[id].setAspect(this.width / this.height);
  }

  resetCameras(): void {
    for (const id of CAMERA_IDS) this.rigs[id].reset();
  }

  /** Screen-space engine glare for this camera (0 when off screen or not burning). */
  private flare(cam: THREE.PerspectiveCamera, id: CameraId): { x: number; y: number; k: number } {
    const w = this.world;
    if (w.plumeLevel <= 0) return { x: 0.5, y: 0.5, k: 0 };
    const p = w.enginePoint(this.tmp).project(cam);
    if (p.z > 1 || p.z < -1) return { x: 0.5, y: 0.5, k: 0 };
    const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
    const vis = 1 - THREE.MathUtils.smoothstep(edge, 0.9, 1.15);
    return { x: p.x * 0.5 + 0.5, y: p.y * 0.5 + 0.5, k: vis * w.plumeLevel * FLARE_BY_CAM[id] * (1 + w.flash) };
  }

  render(frame: FrameState, cam: CameraId, shot: ShotInput, dt: number, snap: boolean, pip: { cam: CameraId; rect: PipRect } | null): void {
    this.renderer.info.reset();
    this.world.update(frame);
    const rig = this.rigs[cam];
    const aspect = this.width / this.height;
    if (Math.abs(rig.camera.aspect - aspect) > 1e-4) rig.setAspect(aspect);
    rig.update(shot, dt, snap);

    // Exposure pump: the ignition flash blows out, then the "camera" adapts to the bright plume.
    const w = this.world;
    if (frame.reducedMotion || snap) {
      this.adapt = frame.reducedMotion ? 0 : w.plumeLevel;
      this.renderer.toneMappingExposure = BASE_EXPOSURE / (1 + 0.25 * this.adapt);
    } else {
      this.adapt += (w.plumeLevel - this.adapt) * (1 - Math.exp(-dt / 1.2));
      this.renderer.toneMappingExposure = (BASE_EXPOSURE * (1 + 0.7 * w.flash)) / (1 + 0.25 * this.adapt);
    }

    if (this.composer && this.renderPass && this.finish) {
      this.renderPass.camera = rig.camera;
      const fl = this.flare(rig.camera, cam);
      const t = frame.t;
      this.finish.set({
        time: t,
        aspect,
        shimmer: cam === 'beach' ? 1 : cam === 'wide' ? 0.5 : 0,
        flare: fl.k,
        flareX: fl.x,
        flareY: fl.y,
        grain: frame.reducedMotion ? 0.015 : 0.03,
        vignette: 0.12, // the CSS overlay adds the rest on every tier
      });
      this.lastT = t;
      this.composer.render(dt);
    } else {
      this.renderer.render(w.scene, rig.camera);
    }

    if (pip) this.renderPip(pip.cam, pip.rect, shot, dt, snap);
    this.drawCalls = this.renderer.info.render.calls;
  }

  /**
   * Replay split screen: four synced cameras in a 2x2 grid on one frame of the world.
   * Direct renders (no post), so four views stay inside the frame budget.
   */
  renderSplit(frame: FrameState, cams: readonly CameraId[], shot: ShotInput, dt: number, snap: boolean): void {
    const r = this.renderer;
    r.info.reset();
    this.world.update(frame);
    this.renderer.toneMappingExposure = BASE_EXPOSURE / (1 + 0.25 * (frame.reducedMotion ? 0 : this.world.plumeLevel));
    const hw = Math.floor(this.width / 2);
    const hh = Math.floor(this.height / 2);
    const gap = 1;
    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear();
    r.setScissorTest(true);
    cams.slice(0, 4).forEach((id, i) => {
      const x = (i % 2) * hw;
      const y = i < 2 ? hh : 0; // first row on top
      const w = hw - gap;
      const h = hh - gap;
      const rig = this.rigs[id];
      if (Math.abs(rig.camera.aspect - w / h) > 1e-4) rig.setAspect(w / h);
      rig.update(shot, dt, snap);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.render(this.world.scene, rig.camera);
    });
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    this.drawCalls = r.info.render.calls;
  }

  private renderPip(id: CameraId, rect: PipRect, shot: ShotInput, dt: number, snap: boolean): void {
    const r = this.renderer;
    const w = Math.round(rect.w);
    const h = Math.round(rect.h);
    if (w < 8 || h < 8) return;
    const x = Math.round(rect.x);
    const y = Math.round(this.height - rect.y - rect.h);
    const rig = this.rigs[id];
    if (Math.abs(rig.camera.aspect - w / h) > 1e-4) rig.setAspect(w / h);
    rig.update(shot, dt, snap);
    r.setRenderTarget(null);
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.setScissorTest(true);
    r.render(this.world.scene, rig.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
  }

  /** Frees GPU resources and drops the WebGL context. */
  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.world.scene.environment?.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** Keeps the off-screen rigs tracking so a cut lands on a settled shot. */
  trackAll(shot: ShotInput, dt: number, except: readonly CameraId[]): void {
    for (const id of CAMERA_IDS) if (!except.includes(id)) this.rigs[id].update(shot, dt, false);
  }

  get time(): number {
    return this.lastT;
  }
}
