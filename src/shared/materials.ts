/**
 * Shared material library. The data build writes these as glTF materials
 * (by id); the viewer swaps them for its own shared instances so that
 * hundreds of parts reuse a handful of shader programs.
 */
export interface MaterialDef {
  color: string;
  metalness: number;
  roughness: number;
  opacity?: number;
  /** Rendered from both sides (open shells such as body panels and liners). */
  doubleSided?: boolean;
  emissive?: string;
}

export const MATERIALS = {
  paint: { color: '#a3a9b0', metalness: 0.6, roughness: 0.3, doubleSided: true },
  'trim-black': { color: '#1b1d20', metalness: 0.05, roughness: 0.72, doubleSided: true },
  'trim-satin': { color: '#2a2d31', metalness: 0.3, roughness: 0.45, doubleSided: true },
  glass: { color: '#26343d', metalness: 0.1, roughness: 0.05, opacity: 0.38, doubleSided: true },
  'lens-clear': { color: '#d9e4ec', metalness: 0.2, roughness: 0.08, opacity: 0.55 },
  'lens-red': { color: '#a3161c', metalness: 0.1, roughness: 0.2, opacity: 0.85 },
  'lens-amber': { color: '#d17a12', metalness: 0.1, roughness: 0.25, opacity: 0.85 },
  chrome: { color: '#e4e8ec', metalness: 1, roughness: 0.12 },
  'aluminium-cast': { color: '#a9aeb4', metalness: 0.75, roughness: 0.42 },
  'aluminium-machined': { color: '#c8ccd1', metalness: 0.9, roughness: 0.25 },
  'iron-cast': { color: '#5d6166', metalness: 0.55, roughness: 0.62 },
  'steel-black': { color: '#25282c', metalness: 0.45, roughness: 0.5 },
  'steel-zinc': { color: '#9ea3a6', metalness: 0.8, roughness: 0.38 },
  'steel-structure': { color: '#bdb7a8', metalness: 0.25, roughness: 0.62, doubleSided: true },
  'brake-disc': { color: '#8a8f95', metalness: 0.85, roughness: 0.33 },
  caliper: { color: '#3d4248', metalness: 0.5, roughness: 0.48 },
  rubber: { color: '#161718', metalness: 0, roughness: 0.92 },
  'plastic-black': { color: '#202226', metalness: 0.05, roughness: 0.6 },
  'plastic-grey': { color: '#4a4e54', metalness: 0.05, roughness: 0.55 },
  'plastic-white': { color: '#e8e4d8', metalness: 0, roughness: 0.5, opacity: 0.88 },
  'exhaust-steel': { color: '#7c766f', metalness: 0.7, roughness: 0.55 },
  heatshield: { color: '#b9bbbd', metalness: 0.85, roughness: 0.35 },
  copper: { color: '#b87333', metalness: 0.95, roughness: 0.3 },
  'harness-black': { color: '#151617', metalness: 0, roughness: 0.75 },
  'cable-red': { color: '#b3261e', metalness: 0, roughness: 0.6 },
  'connector-grey': { color: '#6b7078', metalness: 0.05, roughness: 0.5 },
  'connector-black': { color: '#2b2e33', metalness: 0.05, roughness: 0.5 },
  'connector-green': { color: '#3f7d4e', metalness: 0.05, roughness: 0.5 },
  'connector-blue': { color: '#2f5f9a', metalness: 0.05, roughness: 0.5 },
  'fluid-brake': { color: '#c49a3a', metalness: 0.1, roughness: 0.3 },
  'brake-line': { color: '#9a9ea3', metalness: 0.85, roughness: 0.35 },
  'fuel-line': { color: '#3d4d3a', metalness: 0.1, roughness: 0.6 },
  'coolant-hose': { color: '#1c1d1f', metalness: 0, roughness: 0.85 },
  'radiator-core': { color: '#4b5157', metalness: 0.6, roughness: 0.6 },
  'interior-dark': { color: '#2c2e32', metalness: 0.02, roughness: 0.85 },
  'interior-fabric': { color: '#3a3c40', metalness: 0, roughness: 0.95 },
  'interior-trim': { color: '#55585e', metalness: 0.05, roughness: 0.7 },
  'battery-case': { color: '#24272b', metalness: 0.05, roughness: 0.55 },
  'terminal-lead': { color: '#9fa4a8', metalness: 0.7, roughness: 0.45 },
  'label-yellow': { color: '#d8b13a', metalness: 0.05, roughness: 0.6 },
} as const satisfies Record<string, MaterialDef>;

export type MaterialId = keyof typeof MATERIALS;

export function isMaterialId(id: string): id is MaterialId {
  return Object.prototype.hasOwnProperty.call(MATERIALS, id);
}
