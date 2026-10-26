/**
 * Three.js host: renderer, camera, controls, lighting, picking and the
 * render loop. Renders on demand only — an idle viewer costs nothing.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Manifest } from '../shared/manifest';
import { reducedMotion } from './motion';
import { VehicleModel, type DisplayState } from './VehicleModel';
import { WireOverlay, type OverlayWire } from './WireOverlay';

export interface ViewerCallbacks {
  /** The hovered part changed (null when the pointer is over nothing). */
  onHover?: (id: string | null) => void;
  /** The pointer moved over the canvas, in client pixels (tooltips follow it without re-rendering). */
  onPointer?: (clientX: number, clientY: number) => void;
  onSelect?: (id: string | null, event: { shift: boolean; double: boolean }) => void;
  onFrame?: () => void;
}

export interface Stats {
  fps: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
}

/** Camera placement as the orbit controls see it: a target and a spherical offset (y up). */
interface Orbit {
  target: THREE.Vector3;
  theta: number;
  phi: number;
  radius: number;
}

interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface CamTween {
  from: Orbit;
  to: Orbit;
  elapsed: number;
  duration: number;
  ease: (k: number) => number;
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = (k: number) => 1 - Math.pow(1 - k, 4);
/** Touch screens are usually phones: 1.5× is sharp enough there and saves a lot of fill rate. */
const MAX_PIXEL_RATIO = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
/** Orbit damping per 60 Hz frame; scaled by frame time so the feel is the same at any refresh rate. */
const DAMPING = 0.09;
/** Where the section plane waits while no cut is active: always set, so shaders never recompile on toggle. */
const PARKED = 1e5;
const _sph = new THREE.Spherical();

function orbitOf(position: THREE.Vector3, target: THREE.Vector3): Orbit {
  const s = _sph.setFromVector3(position.clone().sub(target));
  return { target: target.clone(), theta: s.theta, phi: THREE.MathUtils.clamp(s.phi, 1e-3, Math.PI - 1e-3), radius: Math.max(s.radius, 1e-3) };
}

/** Objects that never move get their matrices computed once instead of every frame. */
function freeze(o: THREE.Object3D) {
  o.updateMatrix();
  o.matrixAutoUpdate = false;
}

function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(120,140,255,0.55)');
  grad.addColorStop(0.35, 'rgba(90,110,220,0.22)');
  grad.addColorStop(1, 'rgba(60,80,180,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.7)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);
  readonly controls: OrbitControls;
  model: VehicleModel | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerClient = { x: 0, y: 0 };
  private pointerDirty = false;
  private pointerInside = false;
  /** A button is down on the canvas; past a few pixels of movement it is an orbit/pan drag, not a click. */
  private pressed = false;
  private dragging = false;
  private needsRender = true;
  private raf = 0;
  private last = performance.now();
  private camTween: CamTween | null = null;
  private resizeObserver: ResizeObserver;
  private rect: DOMRect;
  private downAt = { x: 0, y: 0, t: 0 };
  private lastClick = 0;
  private hoveredId: string | null = null;
  private frameTimes: number[] = [];
  private section = new THREE.Plane(new THREE.Vector3(0, 1, 0), PARKED);
  private slowFrames = 0;
  private maxPixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  /** Screen space covered by UI panels; the projection centre shifts so the model sits in the free area. */
  private insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private insetTween: { from: Insets; to: Insets; elapsed: number; duration: number } | null = null;
  readonly floor: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  /** Individual wires drawn along the harnesses for the selected part or circuit. */
  readonly wires = new WireOverlay();

  constructor(
    readonly container: HTMLElement,
    private cb: ViewerCallbacks = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.maxPixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clippingPlanes = [this.section];
    this.renderer.domElement.className = 'viewer-canvas';
    container.appendChild(this.renderer.domElement);
    this.rect = this.renderer.domElement.getBoundingClientRect();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 4);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.9);
    rim.position.set(-4, 3, -5);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xdfe6ff, 0x1a1f2e, 0.5));

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: floorTexture(), transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.floor.position.y = -0.002;
    this.floor.renderOrder = -2;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 5.4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }),
    );
    this.shadow.position.set(0, -0.001, -1.37);
    this.shadow.renderOrder = -1;
    this.scene.add(this.floor, this.shadow, this.wires.group);
    this.scene.traverse(freeze);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = DAMPING;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 22;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.controls.addEventListener('start', () => (this.camTween = null));

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerCancel);
    el.addEventListener('pointerenter', () => (this.rect = el.getBoundingClientRect()));
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.setHover(null);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.home(false);
    this.raf = requestAnimationFrame(this.loop);
  }

  async loadVehicle(manifest: Manifest, baseUrl: string, onProgress: (loaded: number, total: number) => void): Promise<VehicleModel> {
    const model = new VehicleModel(manifest, baseUrl);
    this.model = model;
    this.scene.add(model.root);
    await model.load(onProgress, () => (this.needsRender = true));
    this.needsRender = true;
    return model;
  }

  /**
   * Compiles every shader the opening view and the wire overlay need before the model is shown (in
   * parallel where the driver offers KHR_parallel_shader_compile), so the first frames and the first
   * wires do not stall.
   */
  async prepare(): Promise<void> {
    this.wires.warmup();
    try {
      // without the extension compiling blocks either way; it happens behind the loading screen
      if (this.renderer.extensions.has('KHR_parallel_shader_compile')) await this.renderer.compileAsync(this.scene, this.camera);
      else this.renderer.compile(this.scene, this.camera);
    } catch {
      // compiling up front is an optimisation; the first render compiles whatever is left
    }
    this.wires.focus(null);
    this.wires.clear();
    this.needsRender = true;
  }

  // ---------------------------------------------------------------- loop

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.controls.dampingFactor = 1 - Math.pow(1 - DAMPING, Math.max(dt, 1 / 240) * 60);
    let changed = this.controls.update(dt);
    if (this.model?.update(dt)) changed = true;
    if (this.camTween) {
      this.stepTween(this.camTween, dt);
      changed = true;
    }
    if (this.insetTween) {
      const tw = this.insetTween;
      tw.elapsed += dt;
      const k = easeOut(Math.min(1, tw.elapsed / tw.duration));
      for (const side of ['left', 'right', 'top', 'bottom'] as const) this.insets[side] = THREE.MathUtils.lerp(tw.from[side], tw.to[side], k);
      this.applyViewOffset();
      if (k >= 1) this.insetTween = null;
      changed = true;
    }
    if (this.pointerDirty && this.pointerInside && !this.camTween && !this.dragging) {
      this.pointerDirty = false;
      this.setHover(this.pick());
    }
    if (changed || this.needsRender) {
      this.needsRender = false;
      const t0 = performance.now();
      this.renderer.render(this.scene, this.camera);
      this.trackFrame(t0, now);
      this.cb.onFrame?.();
    } else if (this.model?.buildPendingBvh()) {
      // idle frames build picking acceleration structures
    }
  };

  private trackFrame(t0: number, now: number) {
    this.frameTimes.push(now);
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    // adaptive resolution: drop pixel ratio if rendering is consistently slow
    const cost = performance.now() - t0;
    if (cost > 22 && this.renderer.getPixelRatio() > 1) {
      if (++this.slowFrames > 20) {
        this.renderer.setPixelRatio(Math.max(1, this.renderer.getPixelRatio() - 0.25));
        this.resize();
        this.slowFrames = 0;
      }
    } else this.slowFrames = Math.max(0, this.slowFrames - 1);
  }

  invalidate() {
    this.needsRender = true;
  }

  /** True while the camera is flying or parts are still moving. */
  get moving(): boolean {
    return !!this.camTween || !!this.model?.animating;
  }

  stats(): Stats {
    const info = this.renderer.info.render;
    return { fps: this.frameTimes.length, drawCalls: info.calls, triangles: info.triangles, pixelRatio: this.renderer.getPixelRatio() };
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.aspect = w / h;
    this.applyViewOffset();
  }

  /** Shifts the projection so the model sits in the part of the canvas no panel covers (the canvas keeps its size). */
  private applyViewOffset() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const sx = (this.insets.right - this.insets.left) / 2;
    const sy = (this.insets.bottom - this.insets.top) / 2;
    if (Math.abs(sx) > 0.5 || Math.abs(sy) > 0.5) this.camera.setViewOffset(w, h, sx, sy, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  /** Space covered by panels; `animate` glides the model to its new centre (e.g. with a bottom sheet). */
  setInsets(insets: Insets, animate = false) {
    if (!animate || reducedMotion()) {
      this.insetTween = null;
      this.insets = { ...insets };
      this.applyViewOffset();
      return;
    }
    this.insetTween = { from: { ...this.insets }, to: { ...insets }, elapsed: 0, duration: 0.42 };
  }

  // ---------------------------------------------------------------- picking

  private toNdc(clientX: number, clientY: number) {
    const r = this.rect;
    this.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  private onPointerMove = (e: PointerEvent) => {
    this.toNdc(e.clientX, e.clientY);
    this.pointerClient = { x: e.clientX, y: e.clientY };
    this.pointerInside = true;
    if (this.pressed && !this.dragging && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) {
      // orbiting or panning: no hover highlights (or picking) until the button is released
      this.dragging = true;
      this.setHover(null);
    }
    // hover (highlight and tooltip) follows a mouse or pen; a finger only taps
    if (!this.dragging && e.pointerType !== 'touch') this.pointerDirty = true;
    this.cb.onPointer?.(e.clientX, e.clientY);
  };

  private onPointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.pressed = true;
  };

  private onPointerUp = (e: PointerEvent) => {
    const dragged = this.dragging;
    this.pressed = this.dragging = false;
    if (e.pointerType !== 'touch') this.pointerDirty = true;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    if (dragged || moved > 5 || e.button !== 0) return;
    const now = performance.now();
    const double = now - this.lastClick < 320;
    this.lastClick = now;
    this.toNdc(e.clientX, e.clientY);
    this.cb.onSelect?.(this.pick(), { shift: e.shiftKey, double });
  };

  private onPointerCancel = () => {
    this.pressed = this.dragging = false;
  };

  /** The part seen at a point of the canvas (normalised device coordinates, -1…1), as a click there would pick it. */
  pickAt(x: number, y: number): string | null {
    this.pointer.set(x, y);
    return this.pick();
  }

  private pick(): string | null {
    if (!this.model) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const hits = this.raycaster.intersectObjects(this.model.pickables(), false);
    for (const h of hits) {
      if (this.section.distanceToPoint(h.point) < 0) continue;
      return (h.object.userData.partId as string) ?? null;
    }
    return null;
  }

  private setHover(id: string | null) {
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    this.cb.onHover?.(id);
  }

  // ---------------------------------------------------------------- state

  applyDisplay(s: DisplayState) {
    this.model?.applyDisplay(s);
    this.needsRender = true;
  }

  setWires(wires: OverlayWire[]) {
    this.wires.set(wires);
    this.needsRender = true;
  }

  focusWire(id: string | null) {
    this.wires.focus(id);
    this.needsRender = true;
  }

  setSection(axis: 'x' | 'y' | 'z' | null, offset: number) {
    if (!axis) {
      this.section.set(new THREE.Vector3(0, 1, 0), PARKED);
    } else {
      // offset is ISO-frame millimetres along the chosen vehicle axis
      const n = axis === 'x' ? new THREE.Vector3(0, 0, -1) : axis === 'y' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, -1, 0);
      this.section.set(n, offset / 1000);
    }
    this.needsRender = true;
  }

  // ---------------------------------------------------------------- camera

  /**
   * Flies the camera to `position` looking at `target`: it orbits around the target (the shorter way)
   * while the target glides and the distance changes evenly, so the car never passes through the lens.
   */
  private flyTo(position: THREE.Vector3, target: THREE.Vector3, opts: { duration?: number; ease?: (k: number) => number } = {}) {
    const from = orbitOf(this.camera.position, this.controls.target);
    const to = orbitOf(position, target);
    const dTheta = Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
    to.theta = from.theta + dTheta;
    const turn = Math.hypot(dTheta, to.phi - from.phi);
    const zoom = Math.abs(Math.log(to.radius / from.radius));
    const shift = from.target.distanceTo(to.target) / Math.max(from.radius, to.radius);
    const duration = reducedMotion() ? 0 : (opts.duration ?? THREE.MathUtils.clamp(0.45 + 0.2 * turn + 0.18 * zoom + 0.25 * shift, 0.45, 1.2));
    const tween: CamTween = { from, to, elapsed: 0, duration, ease: opts.ease ?? easeInOut };
    if (duration === 0) {
      this.camTween = null;
      this.stepTween(tween, 1);
      this.controls.update();
      this.needsRender = true;
      return;
    }
    this.camTween = tween;
  }

  private stepTween(tw: CamTween, dt: number) {
    tw.elapsed += dt;
    const k = tw.duration > 0 ? tw.ease(Math.min(1, tw.elapsed / tw.duration)) : 1;
    const { from, to } = tw;
    this.controls.target.lerpVectors(from.target, to.target, k);
    _sph.set(Math.exp(THREE.MathUtils.lerp(Math.log(from.radius), Math.log(to.radius), k)), THREE.MathUtils.lerp(from.phi, to.phi, k), THREE.MathUtils.lerp(from.theta, to.theta, k));
    this.camera.position.setFromSpherical(_sph).add(this.controls.target);
    // orient in the same frame; waiting for the controls' next update would render each frame looking slightly off
    this.camera.lookAt(this.controls.target);
    if (tw.elapsed >= tw.duration && this.camTween === tw) this.camTween = null;
  }

  /** Moves the camera to look at `box` from direction `dir` (three frame). */
  frame(box: THREE.Box3, dir?: THREE.Vector3, animate = true, padding = 1.25) {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    // small parts keep some surroundings in view so their location stays readable
    const radius = Math.max(0.42, box.getSize(new THREE.Vector3()).length() / 2);
    const vfov = (this.camera.fov * Math.PI) / 180;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    // frame for where the panels are going, not where they are mid-slide
    const ins = this.insetTween?.to ?? this.insets;
    const freeW = Math.max(120, w - ins.left - ins.right);
    const freeH = Math.max(120, h - ins.top - ins.bottom);
    // fit inside the visible (un-covered) part of the canvas
    const fitV = 2 * Math.atan(Math.tan(vfov / 2) * (freeH / h));
    const fitH = 2 * Math.atan(Math.tan(vfov / 2) * (freeW / h));
    const fit = Math.min(fitV, fitH);
    const dist = (radius * padding) / Math.sin(fit / 2);
    const d = (dir ?? this.camera.position.clone().sub(this.controls.target)).clone().normalize();
    const p = center.clone().addScaledVector(d, dist);
    if (!animate) {
      this.camTween = null;
      this.camera.position.copy(p);
      this.controls.target.copy(center);
      this.controls.update();
      this.needsRender = true;
      return;
    }
    this.flyTo(p, center);
  }

  home(animate = true) {
    const box = new THREE.Box3(new THREE.Vector3(-0.96, 0, -3.62), new THREE.Vector3(0.96, 1.74, 0.88));
    this.frame(box, new THREE.Vector3(1.05, 0.55, 1.0), animate, 0.92);
  }

  /** Opening move once the vehicle is ready: swing in to the home view from further out and from the side. */
  intro() {
    this.home(false);
    if (reducedMotion()) return;
    const end = { p: this.camera.position.clone(), t: this.controls.target.clone() };
    const o = orbitOf(end.p, end.t);
    _sph.set(o.radius * 1.4, Math.max(0.4, o.phi - 0.22), o.theta + 0.75);
    this.camera.position.setFromSpherical(_sph).add(end.t);
    this.camera.lookAt(end.t);
    this.flyTo(end.p, end.t, { duration: 1.5, ease: easeOut });
  }

  zoomBy(factor: number) {
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t).multiplyScalar(factor);
    const len = THREE.MathUtils.clamp(off.length(), this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(t.clone().add(off.setLength(len)), t.clone());
  }

  /** World position projected to client pixels (null when behind the camera). */
  project(p: THREE.Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera);
    if (v.z > 1) return null;
    const r = this.rect;
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  dispose() {
    this.wires.dispose();
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.model?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
