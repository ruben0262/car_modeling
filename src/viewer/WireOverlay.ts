/**
 * Draws individual wires from the wiring netlist along the harness routes:
 * a thin tube in the wire's insulation colour (with its tracer as a second,
 * finer strand) for close-ups, plus a 2 px screen-space line that stays
 * visible through trim and panels and at any zoom.
 * Wires in one bundle get small fixed offsets so they read as separate strands.
 *
 * All wires share one tube mesh and one line set, so a part with a hundred
 * wires costs two draw calls; focusing a wire rewrites vertex alphas and
 * draws that one wire again on top. Materials live as long as the overlay,
 * so their shaders are compiled once (see `warmup`).
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { colourParts, WIRE_COLOURS } from '../shared/wiring';

export interface OverlayWire {
  id: string;
  colour: string;
  points: [number, number, number][];
}

/** Visible stand-in for colours that vanish on the dark background. */
const display = (code: string | undefined) => (code === 'BK' || code === 'sw' ? '#4a4a52' : (code && WIRE_COLOURS[code]) || '#bbbbbb');

const RADIAL = 6;
const COS = Array.from({ length: RADIAL }, (_, k) => Math.cos((k / RADIAL) * Math.PI * 2));
const SIN = Array.from({ length: RADIAL }, (_, k) => Math.sin((k / RADIAL) * Math.PI * 2));
/** Route points closer than this to the line through their neighbours are dropped (well under a strand's width). */
const SIMPLIFY = 0.0005;
const DIM_TUBE = 0.12;
const DIM_LINE = 0.08;
const LINE_OPACITY = 0.6;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _n = new THREE.Vector3();
const _bn = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Douglas–Peucker: harness routes are mostly straight runs sampled densely, so most points can go. */
function simplify(pts: THREE.Vector3[], tol: number): THREE.Vector3[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [0, pts.length - 1];
  const tol2 = tol * tol;
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    _a.subVectors(pts[b], pts[a]);
    const len2 = _a.lengthSq();
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i++) {
      _b.subVectors(pts[i], pts[a]);
      const t = len2 > 0 ? Math.max(0, Math.min(1, _b.dot(_a) / len2)) : 0;
      const d = _b.addScaledVector(_a, -t).lengthSq();
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

interface Strand {
  pts: THREE.Vector3[];
  radius: number;
  colour: THREE.Color;
}

/**
 * Writes a tube along a polyline into the shared buffers: one ring per vertex, normals carried along
 * by parallel transport, rings widened at bends so the strand keeps its thickness.
 * Returns the next free vertex and index positions.
 */
function writeTube(s: Strand, pos: Float32Array, col: Float32Array, idx: Uint16Array | Uint32Array, v0: number, i0: number): [number, number] {
  const { pts, radius, colour } = s;
  const n = pts.length;
  _a.subVectors(pts[1], pts[0]).normalize();
  _n.set(0, 1, 0);
  if (Math.abs(_a.y) > 0.9) _n.set(1, 0, 0);
  _n.addScaledVector(_a, -_n.dot(_a)).normalize();
  _prev.copy(_a);
  let v = v0;
  for (let i = 0; i < n; i++) {
    let mitre = 1;
    if (i === 0) _t.copy(_a);
    else if (i === n - 1) _t.subVectors(pts[i], pts[i - 1]).normalize();
    else {
      _a.subVectors(pts[i], pts[i - 1]).normalize();
      _b.subVectors(pts[i + 1], pts[i]).normalize();
      _t.addVectors(_a, _b);
      if (_t.lengthSq() < 1e-8) _t.copy(_b);
      _t.normalize();
      mitre = Math.min(2, 1 / Math.max(0.5, _a.dot(_t)));
    }
    _n.applyQuaternion(_q.setFromUnitVectors(_prev, _t));
    _n.addScaledVector(_t, -_n.dot(_t)).normalize();
    _bn.crossVectors(_t, _n);
    _prev.copy(_t);
    const r = radius * mitre;
    const p = pts[i];
    for (let k = 0; k < RADIAL; k++, v++) {
      const c = COS[k] * r;
      const sn = SIN[k] * r;
      pos[v * 3] = p.x + _n.x * c + _bn.x * sn;
      pos[v * 3 + 1] = p.y + _n.y * c + _bn.y * sn;
      pos[v * 3 + 2] = p.z + _n.z * c + _bn.z * sn;
      col[v * 4] = colour.r;
      col[v * 4 + 1] = colour.g;
      col[v * 4 + 2] = colour.b;
      col[v * 4 + 3] = 1;
    }
  }
  let ii = i0;
  for (let i = 0; i < n - 1; i++) {
    const p = v0 + i * RADIAL;
    const q = p + RADIAL;
    for (let k = 0; k < RADIAL; k++) {
      const k1 = (k + 1) % RADIAL;
      idx[ii++] = p + k;
      idx[ii++] = q + k;
      idx[ii++] = p + k1;
      idx[ii++] = p + k1;
      idx[ii++] = q + k;
      idx[ii++] = q + k1;
    }
  }
  return [v, ii];
}

export class WireOverlay {
  readonly group = new THREE.Group();
  private tubeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false });
  private lineMat = new LineMaterial({ vertexColors: true, linewidth: 2, transparent: true, opacity: LINE_OPACITY, depthTest: false, depthWrite: false });
  private focusMat = new LineMaterial({ linewidth: 3.5, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
  private tubes: THREE.Mesh | null = null;
  private lines: LineSegments2 | null = null;
  private focusLine: Line2 | null = null;
  /** Per wire: its tube vertex range, route and colour (for the focus line). */
  private items = new Map<string, { start: number; count: number; pts: THREE.Vector3[]; colour: string }>();
  private focusId: string | null = null;

  constructor() {
    this.group.name = 'wire-overlay';
    this.group.renderOrder = 10;
    this.group.matrixAutoUpdate = false;
  }

  get count() {
    return this.items.size;
  }

  set(wires: OverlayWire[]) {
    this.clear();
    // first pass: routes, strands and buffer sizes; second pass: fill typed arrays in place
    const prepared: { id: string; colour: string; pts: THREE.Vector3[]; strands: Strand[] }[] = [];
    const tracerShift = new THREE.Vector3(0.0011, 0.0011, 0);
    let verts = 0;
    let tris = 0;
    let segs = 0;
    wires.forEach((w, k) => {
      // golden-angle spread: each strand sits a few millimetres off the harness centreline
      const a = k * 2.39996;
      const off = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.6, Math.sin(a)).multiplyScalar(0.0025 + 0.0012 * (k % 3));
      let pts: THREE.Vector3[] = [];
      for (const p of w.points) {
        const v = new THREE.Vector3(p[0], p[1], p[2]).add(off);
        if (!pts.length || pts[pts.length - 1].distanceToSquared(v) > 1e-8) pts.push(v);
      }
      if (pts.length < 2) return;
      pts = simplify(pts, SIMPLIFY);
      const [main, tracer] = colourParts(w.colour);
      const strands: Strand[] = [{ pts, radius: 0.0016, colour: new THREE.Color(display(main)) }];
      if (tracer) strands.push({ pts: pts.map((p) => p.clone().add(tracerShift)), radius: 0.0009, colour: new THREE.Color(display(tracer)) });
      for (const st of strands) {
        verts += st.pts.length * RADIAL;
        tris += (st.pts.length - 1) * RADIAL * 2;
      }
      segs += pts.length - 1;
      prepared.push({ id: w.id, colour: display(main), pts, strands });
    });
    if (!prepared.length) return;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 4);
    const idx = verts > 65535 ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3);
    const seg = new Float32Array(segs * 6);
    const segCol = new Float32Array(segs * 6);
    let v = 0;
    let ii = 0;
    let s = 0;
    for (const p of prepared) {
      const start = v;
      for (const st of p.strands) [v, ii] = writeTube(st, pos, col, idx, v, ii);
      const c = p.strands[0].colour;
      for (let i = 1; i < p.pts.length; i++, s += 6) {
        p.pts[i - 1].toArray(seg, s);
        p.pts[i].toArray(seg, s + 3);
        c.toArray(segCol, s);
        c.toArray(segCol, s + 3);
      }
      this.items.set(p.id, { start, count: v - start, pts: p.pts, colour: p.colour });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.tubes = new THREE.Mesh(geo, this.tubeMat);
    this.tubes.renderOrder = 10;
    this.lines = new LineSegments2(new LineSegmentsGeometry().setPositions(seg).setColors(segCol), this.lineMat);
    this.lines.renderOrder = 11;
    for (const o of [this.tubes, this.lines]) {
      o.matrixAutoUpdate = false;
      this.group.add(o);
    }
    this.applyFocus();
  }

  /** Emphasises one wire (from the wiring panel) and fades the others; null restores all. */
  focus(id: string | null) {
    this.focusId = id;
    this.applyFocus();
  }

  private applyFocus() {
    const focused = this.focusId !== null ? this.items.get(this.focusId) : undefined;
    if (this.tubes) {
      const attr = this.tubes.geometry.getAttribute('color') as THREE.BufferAttribute;
      const a = attr.array as Float32Array;
      const dim = focused ? DIM_TUBE : 1;
      for (let i = 3; i < a.length; i += 4) a[i] = dim;
      if (focused) for (let v = focused.start; v < focused.start + focused.count; v++) a[v * 4 + 3] = 1;
      attr.needsUpdate = true;
      // faded strands must not hide the focused one behind them
      this.tubeMat.depthWrite = !focused;
    }
    this.lineMat.opacity = focused ? DIM_LINE : LINE_OPACITY;
    if (this.focusLine) {
      this.focusLine.geometry.dispose();
      this.group.remove(this.focusLine);
      this.focusLine = null;
    }
    if (focused) {
      this.focusMat.color.set(focused.colour);
      this.focusLine = new Line2(new LineGeometry().setPositions(focused.pts.flatMap((p) => [p.x, p.y, p.z])), this.focusMat);
      this.focusLine.renderOrder = 12;
      this.focusLine.matrixAutoUpdate = false;
      this.group.add(this.focusLine);
    }
  }

  /**
   * Fills the overlay with synthetic wires, one focused: compiling the scene then compiles the overlay's
   * shaders, and building them has the JIT optimise the geometry code before the first real wires.
   * Call `focus(null)` and `clear()` afterwards.
   */
  warmup() {
    const wires: OverlayWire[] = Array.from({ length: 16 }, (_, k) => ({
      id: `warmup-${k}`,
      colour: 'R-W',
      points: Array.from({ length: 80 }, (_, i): [number, number, number] => [k * 0.004, 0.2 + Math.sin(i / 4) * 0.05, i * 0.01]),
    }));
    this.set(wires);
    this.focus('warmup-0');
  }

  clear() {
    for (const o of [this.tubes, this.lines, this.focusLine]) o?.geometry.dispose();
    this.tubes = this.lines = this.focusLine = null;
    this.group.clear();
    this.items.clear();
  }

  dispose() {
    this.clear();
    this.tubeMat.dispose();
    this.lineMat.dispose();
    this.focusMat.dispose();
  }
}
