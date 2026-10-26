/**
 * Runtime model of one vehicle: loads geometry chunks, maps glTF nodes to
 * components, animates explode/break-down, and resolves each mesh's
 * display state (visibility, colour mode, highlight, ghosting).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { ChunkInfo, Manifest, RuntimeNode } from '../shared/manifest';
import { MaterialLibrary, STATUS_COLORS } from './materials';
import { reducedMotion, springStep } from './motion';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type ColorMode = 'realistic' | 'systems' | 'verification';

export interface DisplayState {
  hiddenSystems: ReadonlySet<string>;
  hiddenParts: ReadonlySet<string>;
  selected: string | null;
  hovered: string | null;
  isolate: string | null;
  xray: boolean;
  colorMode: ColorMode;
  /** Parts shown as "remove first" in the access view. */
  removed: ReadonlySet<string>;
  /** Parts highlighted as related (e.g. on the selected wiring circuit). */
  related: ReadonlySet<string>;
}

export interface Part {
  id: string;
  node: RuntimeNode;
  object: THREE.Object3D;
  meshes: THREE.Mesh[];
  proxy: THREE.Object3D | null;
  home: THREE.Vector3;
  vec: THREE.Vector3;
  t: number;
  /** Explode velocity (fraction of `vec` per second). */
  v: number;
  target: number;
}

/** Explode spring stiffness (rad/s): settles in about 0.6 s. */
const EXPLODE_OMEGA = 11;

export class VehicleModel {
  readonly root = new THREE.Group();
  readonly parts = new Map<string, Part>();
  readonly nodes: Map<string, RuntimeNode>;
  readonly materials: MaterialLibrary;
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private active = new Set<Part>();
  private detail = new Map<string, Promise<void>>();
  private pickList: THREE.Mesh[] = [];
  private pickDirty = true;
  private display: DisplayState | null = null;
  private explodeGlobal = 0;
  private brokenDown = new Set<string>();
  private bvhQueue: THREE.BufferGeometry[] = [];
  /** Bumped whenever visibility, materials or part positions change; callers cache bounds against it. */
  revision = 0;

  constructor(
    readonly manifest: Manifest,
    private baseUrl: string,
  ) {
    this.nodes = new Map(manifest.nodes.map((n) => [n.id, n]));
    this.materials = new MaterialLibrary(manifest.vehicle.bodyColor);
    this.root.name = manifest.vehicle.id;
    // a root that recomputed its matrix every frame would force every world matrix below it to recompute too
    this.root.matrixAutoUpdate = false;
  }

  /** Loads every system chunk in parallel; resolves once all are in the scene. */
  async load(onProgress: (loaded: number, total: number) => void, onChunk?: () => void): Promise<void> {
    const chunks = this.manifest.chunks.filter((c) => c.role === 'system');
    const total = chunks.reduce((a, c) => a + c.bytes, 0);
    const done = new Map<string, number>();
    const report = () => onProgress([...done.values()].reduce((a, b) => a + b, 0), total);
    await Promise.all(
      chunks.map(async (c) => {
        const buf = await this.fetchChunk(c, (n) => {
          done.set(c.id, n);
          report();
        });
        const gltf = await this.loader.parseAsync(buf, '');
        this.adopt(gltf.scene, null);
        done.set(c.id, c.bytes);
        report();
        onChunk?.();
      }),
    );
    this.applyExplode(this.explodeGlobal, this.brokenDown);
  }

  private async fetchChunk(c: ChunkInfo, progress: (n: number) => void): Promise<ArrayBuffer> {
    const res = await fetch(this.baseUrl + c.url);
    if (!res.ok || !res.body) throw new Error(`Failed to load ${c.url}: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      n += value.byteLength;
      progress(n);
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out.buffer;
  }

  /** Registers components found in a loaded scene and attaches them. */
  private adopt(scene: THREE.Object3D, attachTo: THREE.Object3D | null) {
    const found: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (this.nodes.has(o.name)) found.push(o);
    });
    for (const o of found) {
      const node = this.nodes.get(o.name)!;
      const meshes: THREE.Mesh[] = [];
      let proxy: THREE.Object3D | null = null;
      for (const child of o.children) {
        const isMesh = child.name === `${node.id}__mesh`;
        const isProxy = child.name === `${node.id}__proxy`;
        if (!isMesh && !isProxy) continue;
        if (isProxy) proxy = child;
        child.traverse((m) => {
          if (!(m as THREE.Mesh).isMesh) return;
          const mesh = m as THREE.Mesh;
          const matName = (mesh.material as THREE.Material).name;
          (mesh.material as THREE.Material).dispose();
          mesh.material = this.materials.get(matName);
          mesh.userData.partId = node.id;
          mesh.userData.base = mesh.material;
          mesh.userData.proxy = isProxy;
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          this.bvhQueue.push(mesh.geometry);
          meshes.push(mesh);
        });
      }
      const part: Part = { id: node.id, node, object: o, meshes, proxy, home: o.position.clone(), vec: new THREE.Vector3(...node.explode), t: 0, v: 0, target: 0 };
      this.parts.set(node.id, part);
    }
    // nothing moves except exploding parts, which update their own matrices (see update)
    scene.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    if (attachTo) for (const child of [...scene.children]) attachTo.add(child);
    else this.root.add(scene);
    this.pickDirty = true;
    this.revision++;
    if (this.display) this.applyDisplay(this.display);
  }

  /** Builds BVHs for picking a few geometries at a time so loading never stalls. */
  buildPendingBvh(budgetMs = 6): boolean {
    const start = performance.now();
    while (this.bvhQueue.length && performance.now() - start < budgetMs) {
      const g = this.bvhQueue.pop()!;
      if (!g.boundsTree) g.computeBoundsTree();
    }
    return this.bvhQueue.length > 0;
  }

  hasDetail(id: string): boolean {
    return !!this.nodes.get(id)?.detailChunk;
  }

  isDetailLoaded(id: string): boolean {
    const p = this.parts.get(id);
    return !!p && !p.proxy?.visible;
  }

  /** Loads an assembly's detailed children (once) and swaps out its proxy. */
  ensureDetail(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (!node?.detailChunk) return Promise.resolve();
    let p = this.detail.get(id);
    if (!p) {
      p = (async () => {
        const chunk = this.manifest.chunks.find((c) => c.id === node.detailChunk)!;
        const buf = await this.fetchChunk(chunk, () => {});
        const gltf = await this.loader.parseAsync(buf, '');
        const holder = gltf.scene.getObjectByName(`${id}__detail`);
        const part = this.parts.get(id)!;
        if (holder) this.adopt(holder, part.object);
        if (part.proxy) part.proxy.visible = false;
        part.meshes = part.meshes.filter((m) => !m.userData.proxy);
        this.applyExplode(this.explodeGlobal, this.brokenDown);
        this.pickDirty = true;
      })();
      this.detail.set(id, p);
    }
    return p;
  }

  /** Warms the HTTP cache for detail chunks without parsing them. */
  prefetchDetail() {
    for (const c of this.manifest.chunks) if (c.role === 'detail') fetch(this.baseUrl + c.url).catch(() => {});
  }

  // ---------------------------------------------------------------- explode

  applyExplode(global: number, brokenDown: ReadonlySet<string>, removed: ReadonlySet<string> = new Set()) {
    this.explodeGlobal = global;
    this.brokenDown = new Set(brokenDown);
    for (const p of this.parts.values()) {
      let target = p.node.depth <= 1 ? global : 0;
      if (p.node.parent && brokenDown.has(p.node.parent)) target = Math.max(target, 1);
      if (removed.has(p.id)) target = Math.max(target, 1.6);
      if (target !== p.target) {
        p.target = target;
        this.active.add(p);
      }
    }
  }

  /** Advances explode animations; returns true while anything is moving. */
  update(dt: number): boolean {
    if (this.active.size === 0) return false;
    this.revision++;
    const jump = reducedMotion();
    for (const p of this.active) {
      [p.t, p.v] = jump ? [p.target, 0] : springStep(p.t, p.v, p.target, EXPLODE_OMEGA, dt);
      if (Math.abs(p.target - p.t) < 0.0005 && Math.abs(p.v) < 0.005) {
        p.t = p.target;
        p.v = 0;
        this.active.delete(p);
      }
      p.object.position.copy(p.home).addScaledVector(p.vec, p.t);
      p.object.updateMatrix();
    }
    return true;
  }

  get animating(): boolean {
    return this.active.size > 0;
  }

  // ---------------------------------------------------------------- display

  isAncestor(ancestor: string, id: string): boolean {
    let cur: string | null = id;
    while (cur) {
      if (cur === ancestor) return true;
      cur = this.nodes.get(cur)?.parent ?? null;
    }
    return false;
  }

  private hiddenByUser(id: string, hiddenParts: ReadonlySet<string>): boolean {
    if (hiddenParts.size === 0) return false;
    let cur: string | null = id;
    while (cur) {
      if (hiddenParts.has(cur)) return true;
      cur = this.nodes.get(cur)?.parent ?? null;
    }
    return false;
  }

  applyDisplay(s: DisplayState) {
    this.display = s;
    this.revision++;
    const lib = this.materials;
    const systems = new Map(this.manifest.systems.map((x) => [x.id, x.color]));
    const xrayGhost = lib.ghost('#9db4ff', 0.28, 2.4);
    const isoGhost = lib.ghost('#7d8cad', 0.16, 2.6);
    const removedGhost = lib.ghost('#f5b84a', 0.35, 1.8);
    const groupSelection = !!s.selected && (this.nodes.get(s.selected)?.children.length ?? 0) > 0;
    for (const p of this.parts.values()) {
      const n = p.node;
      const visible = !s.hiddenSystems.has(n.system) && !this.hiddenByUser(n.id, s.hiddenParts);
      const inSel = !!s.selected && this.isAncestor(s.selected, n.id);
      const inHover = !inSel && !!s.hovered && this.isAncestor(s.hovered, n.id);
      const inRemoved = [...s.removed].some((r) => this.isAncestor(r, n.id));
      const inRelated = !inSel && !inHover && s.related.size > 0 && [...s.related].some((r) => this.isAncestor(r, n.id));
      const isolatedOut = !!s.isolate && !this.isAncestor(s.isolate, n.id) && !inRemoved;
      const relatedFocus = s.related.size > 0 && !s.isolate;
      const xrayed = s.xray && n.system === 'body' && !inSel && !inHover;
      for (const m of p.meshes) {
        m.visible = visible;
        if (!visible) continue;
        const base = m.userData.base as THREE.MeshStandardMaterial;
        let mat: THREE.Material = base;
        if (s.colorMode === 'systems') mat = lib.tint(systems.get(n.system) ?? '#888888', base.side === THREE.DoubleSide);
        else if (s.colorMode === 'verification') mat = lib.tint(STATUS_COLORS[n.verification.status], base.side === THREE.DoubleSide);
        if (inSel) mat = lib.variant(mat, groupSelection ? 'selected-group' : 'selected');
        else if (inHover) mat = lib.variant(mat, 'hover');
        else if (inRelated) mat = lib.variant(mat, 'related');
        else if (inRemoved) mat = removedGhost;
        else if (isolatedOut) mat = isoGhost;
        else if (xrayed || (relatedFocus && n.system === 'body')) mat = xrayGhost;
        m.material = mat;
        m.userData.ghost = mat === xrayGhost || mat === isoGhost || mat === removedGhost;
      }
    }
    this.pickDirty = true;
  }

  /** Meshes that can be hovered/clicked (visible, not ghosted). */
  pickables(): THREE.Mesh[] {
    if (this.pickDirty) {
      this.pickList = [];
      for (const p of this.parts.values()) for (const m of p.meshes) if (m.visible && !m.userData.ghost) this.pickList.push(m);
      this.pickDirty = false;
    }
    return this.pickList;
  }

  /** Current world-space bounds of a component and its descendants. */
  boundsOf(id: string): THREE.Box3 {
    const box = new THREE.Box3();
    const p = this.parts.get(id);
    if (!p) return box;
    p.object.updateWorldMatrix(true, true);
    p.object.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.ghost) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
    });
    return box;
  }

  /** Bounds of everything currently visible, ghosted parts included (used to frame exploded views). */
  boundsAll(): THREE.Box3 {
    const box = new THREE.Box3();
    this.root.updateWorldMatrix(true, true);
    this.root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
    });
    return box;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.disposeBoundsTree?.();
        m.geometry.dispose();
      }
    });
    this.materials.dispose();
  }
}
