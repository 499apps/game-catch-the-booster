// Renderer, post-processing and camera rigs. Creating it throws if WebGL is unavailable;
// the game then keeps running (HUD, sim, debrief) without the 3D view.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CAMERA_IDS, CameraRig, type CameraId, type ShotInput } from './cameras';
import type { QualityProfile } from './quality';
import { WorldScene, type FrameState } from './scene';
import { makeSkyMaterial } from './materials';

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

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly world = new WorldScene();
  readonly rigs: Record<CameraId, CameraRig>;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private profile: QualityProfile;
  private width = 1;
  private height = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    profile: QualityProfile,
    opts: { preserveDrawingBuffer: boolean },
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: profile.tier !== 'low',
      powerPreference: 'high-performance',
      preserveDrawingBuffer: opts.preserveDrawingBuffer,
      alpha: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Image-based lighting from the sky alone (no files), so the stainless hull reflects it.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial()));
    const env = pmrem.fromScene(envScene, 0.02);
    this.world.scene.environment = env.texture;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatioCap));
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    if (p.bloom !== 'off') {
      const composer = new EffectComposer(this.renderer);
      this.renderPass = new RenderPass(this.world.scene, this.rigs.wide.camera);
      composer.addPass(this.renderPass);
      const res = new THREE.Vector2(this.width, this.height);
      const bloom = p.bloom === 'half' ? new HalfBloomPass(res, 0.55, 0.5, 0.86) : new UnrealBloomPass(res, 0.6, 0.55, 0.85);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
    }
    this.resize(this.width, this.height);
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.pixelRatioCap));
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

  render(frame: FrameState, cam: CameraId, shot: ShotInput, dt: number, snap: boolean): void {
    this.world.update(frame);
    const rig = this.rigs[cam];
    rig.update(shot, dt, snap);
    if (this.composer && this.renderPass) {
      this.renderPass.camera = rig.camera;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.world.scene, rig.camera);
    }
  }

  /** Frees GPU resources and drops the WebGL context. */
  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.world.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** Keeps the off-screen rigs tracking so a cut lands on a settled shot. */
  trackAll(shot: ShotInput, dt: number, except: CameraId): void {
    for (const id of CAMERA_IDS) if (id !== except) this.rigs[id].update(shot, dt, false);
  }
}
