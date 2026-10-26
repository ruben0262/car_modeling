/**
 * Shared materials and their display variants. Every mesh points at one of
 * a small set of cached instances, so state changes (hover, select, ghost,
 * colour modes) are pointer swaps — no per-mesh material clones.
 */
import * as THREE from 'three';
import { MATERIALS, isMaterialId, type MaterialDef } from '../shared/materials';

const GHOST_VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;

const GHOST_FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 color;
uniform float opacity;
uniform float power;
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <clipping_planes_fragment>
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), power);
  gl_FragColor = vec4(color, opacity * (0.1 + 0.9 * rim));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export type Variant = 'hover' | 'selected' | 'selected-group' | 'related';

export const STATUS_COLORS = { verified: '#3ecf8e', partial: '#f5b84a', unverified: '#ff5d6c' } as const;
export const ACCENT = '#8f7cff';

export class MaterialLibrary {
  private base = new Map<string, THREE.MeshStandardMaterial>();
  private tints = new Map<string, THREE.MeshStandardMaterial>();
  private variants = new Map<string, THREE.Material>();
  private ghosts = new Map<string, THREE.ShaderMaterial>();

  constructor(bodyColor: string) {
    for (const [id, d] of Object.entries(MATERIALS) as [string, MaterialDef][]) {
      const opacity = d.opacity ?? 1;
      const m = new THREE.MeshStandardMaterial({
        name: id,
        color: id === 'paint' ? bodyColor : d.color,
        metalness: d.metalness,
        roughness: d.roughness,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
        side: d.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (id === 'paint') {
        // a touch of clear-coat sheen without the cost of MeshPhysicalMaterial
        m.envMapIntensity = 1.25;
      }
      this.base.set(id, m);
    }
  }

  get(id: string): THREE.MeshStandardMaterial {
    return this.base.get(isMaterialId(id) ? id : 'plastic-grey')!;
  }

  /** Flat-ish tinted material used by the system and verification colour modes. */
  tint(color: string, doubleSided = false): THREE.MeshStandardMaterial {
    const key = `${color}:${doubleSided}`;
    let m = this.tints.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.55, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
      this.tints.set(key, m);
    }
    return m;
  }

  variant(source: THREE.Material, kind: Variant): THREE.Material {
    const key = `${source.uuid}:${kind}`;
    let m = this.variants.get(key);
    if (!m) {
      const v = (source as THREE.MeshStandardMaterial).clone();
      const emissive = kind === 'related' ? '#f5b84a' : ACCENT;
      v.emissive = new THREE.Color(emissive);
      // a selected assembly is tinted gently so its parts keep their real materials while being studied
      v.emissiveIntensity = kind === 'selected' ? 0.55 : kind === 'selected-group' ? 0.16 : kind === 'hover' ? 0.28 : 0.35;
      if (v.transparent) v.opacity = Math.max(v.opacity, 0.75);
      m = v;
      this.variants.set(key, m);
    }
    return m;
  }

  /** Fresnel "x-ray" material: edges glow, faces facing the camera nearly vanish. */
  ghost(color = '#9fb3ff', opacity = 0.32, power = 2.2): THREE.ShaderMaterial {
    const key = `${color}:${opacity}:${power}`;
    let m = this.ghosts.get(key);
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity }, power: { value: power } },
        vertexShader: GHOST_VERT,
        fragmentShader: GHOST_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        clipping: true,
      });
      this.ghosts.set(key, m);
    }
    return m;
  }

  dispose() {
    for (const m of [...this.base.values(), ...this.tints.values(), ...this.variants.values(), ...this.ghosts.values()]) m.dispose();
  }
}
