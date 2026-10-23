import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeObject } from '../robot/model';

export class StudioScene {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly grid: THREE.GridHelper;
  private skeleton?: THREE.SkeletonHelper;
  private readonly selection = new THREE.AxesHelper(0.28);
  private frame = 0;
  private disposed = false;
  private frames = 0;
  private lastSample = performance.now();
  private autoRotate = false;
  private onUpdate?: (nowMs: number, deltaSeconds: number) => void;
  private lastFrameTime = performance.now();

  setUpdate(callback?: (nowMs: number, deltaSeconds: number) => void): void { this.onUpdate = callback; }
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.onError('图形上下文已丢失，请重新加载页面。');
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly onFps: (fps: number) => void,
    private readonly onError: (message: string) => void,
  ) {
    this.scene.background = new THREE.Color('#141a18');
    this.scene.fog = new THREE.Fog('#141a18', 8, 18);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.domElement.setAttribute('aria-label', '三维机器人视窗，可拖动旋转、滚轮缩放');
    this.container.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 10;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.02;
    this.controls.autoRotateSpeed = 0.65;
    this.resetCamera();

    this.scene.add(new THREE.HemisphereLight('#ebf5e4', '#525a50', 2.4));
    const key = new THREE.DirectionalLight('#fff5e3', 4);
    key.position.set(3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -3;
    key.shadow.normalBias = 0.035;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#c4edab', 3);
    rim.position.set(-4, 3, -3);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: '#151b18', roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.07;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(1.48, 1.5, 0.055, 96),
      new THREE.MeshStandardMaterial({ color: '#29312b', roughness: 0.7, metalness: 0.2 }),
    );
    platform.position.y = -0.035;
    platform.receiveShadow = true;
    this.scene.add(platform);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.47, 1.482, 96),
      new THREE.MeshBasicMaterial({ color: '#819d68', side: THREE.DoubleSide, transparent: true, opacity: 0.6 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.003;
    this.scene.add(ring);
    this.grid = new THREE.GridHelper(20, 40, '#364036', '#242d26');
    this.grid.position.y = -0.038;
    this.scene.add(this.grid);
    this.selection.visible = false;
    this.selection.renderOrder = 10;
    const selectionMaterial = this.selection.material as THREE.LineBasicMaterial;
    selectionMaterial.depthTest = false;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.animate();
  }

  addModel(root: THREE.Group): void {
    this.scene.add(root);
    this.skeleton = new THREE.SkeletonHelper(root);
    this.skeleton.visible = false;
    this.skeleton.renderOrder = 9;
    const material = this.skeleton.material as THREE.LineBasicMaterial;
    material.depthTest = false;
    material.transparent = true;
    material.opacity = 0.8;
    this.scene.add(this.skeleton);
  }

  selectBone(bone?: THREE.Bone): void {
    this.selection.removeFromParent();
    this.selection.visible = Boolean(bone);
    bone?.add(this.selection);
  }

  setGrid(visible: boolean): void { this.grid.visible = visible; }
  setSkeleton(visible: boolean): void { if (this.skeleton) this.skeleton.visible = visible; }
  setAutoRotate(enabled: boolean): void { this.autoRotate = enabled; }

  resetCamera(view: 'perspective' | 'front' | 'side' = 'perspective'): void {
    this.controls.target.set(0, 1.22, 0);
    if (view === 'front') this.camera.position.set(0, 1.65, 6.3);
    else if (view === 'side') this.camera.position.set(6.3, 1.65, 0);
    else this.camera.position.set(3.4, 2.5, 5.7);
    this.controls.update();
  }

  private resize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    this.camera.aspect = Math.max(width, 1) / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(Math.max(width, 1), Math.max(height, 1));
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const nowMs = performance.now();
    const dt = Math.max(0, (nowMs - this.lastFrameTime) / 1000);
    this.lastFrameTime = nowMs;
    if (!document.hidden) this.onUpdate?.(nowMs, dt);
    this.controls.autoRotate = this.autoRotate && !document.hidden;
    this.controls.update();
    if (!document.hidden) {
      this.renderer.render(this.scene, this.camera);
      this.frames++;
    }
    const now = performance.now();
    if (now - this.lastSample >= 1000) {
      this.onFps(Math.round(this.frames * 1000 / (now - this.lastSample)));
      this.lastSample = now;
      this.frames = 0;
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onUpdate = undefined;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.selection.removeFromParent();
    this.selection.dispose();
    this.skeleton?.dispose();
    this.skeleton?.removeFromParent();
    this.scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    disposeObject(this.scene);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
