/** Wiring netlist extracted from OEM Electrical Wiring Diagrams (see tools/ewd/import.ts). */
export interface EwdWire {
  id: string;
  colour: string;
  csa: number;
  option?: string;
  length?: number;
  ends: string[];
  sheets: string[];
}

export interface EwdCircuit {
  id: string;
  section: string;
  title: string;
  sheet: string;
  page: number;
  components: string[];
}

/**
 * Harness routing graph written by the data build (tools/lib/harness.ts) into
 * the published wiring file. Positions are three.js metres.
 */
export interface WiringLayout {
  /** Vertex positions, flattened [x, y, z, …]. */
  v: number[];
  /** Undirected edges as vertex-index pairs, flattened. */
  e: number[];
  /** Per edge: 1 when the junction is estimated (two harness islands joined at their closest point). */
  virtual: number[];
  /** Connector id → node carrying it, graph vertex where its wires leave, housing position. */
  connectors: Record<string, { node: string; v: number; p: [number, number, number] }>;
  /** Splice id → estimated position (the diagrams print connections, not positions). */
  splices: Record<string, { v: number; p: [number, number, number] }>;
  /** Ground id → generated ground-point node and estimated position. */
  grounds: Record<string, { node?: string; v: number; p: [number, number, number] }>;
  /** Splices, grounds and in-line pairs placed from printed wire lengths: route error (mm) and wires used. */
  calc?: Record<string, { rms: number; wires: number; calculated: boolean }>;
}

export interface EwdData {
  publication: { title: string; file: string; vin: string; market: string; pages: number };
  circuits: EwdCircuit[];
  components: Record<string, { name: string; connectors: string[]; circuits: string[] }>;
  connectors: Record<string, { component: string | null; pins: Record<string, { wires: string[]; signal?: string }>; mates?: string }>;
  wires: EwdWire[];
  fuses: Record<string, { rating?: number; between: string[]; sheets: string[] }>;
  splices: Record<string, { wires: string[] }>;
  grounds: Record<string, { wires: string[] }>;
  stats: Record<string, number>;
  /** Present in the published file only (added by the data build). */
  layout?: WiringLayout;
}

/** JLR wire colour codes → display colours. */
export const WIRE_COLOURS: Record<string, string> = {
  BK: '#1d1d1f',
  BN: '#7a4a24',
  BU: '#2f6fd6',
  GN: '#2f9e50',
  GY: '#8c9196',
  OG: '#f08a24',
  PK: '#f28cb8',
  RD: '#d93a2b',
  VT: '#8b5bd6',
  WH: '#f2f2f0',
  YE: '#f2d01f',
};

export const WIRE_COLOUR_NAMES: Record<string, string> = {
  BK: 'black',
  BN: 'brown',
  BU: 'blue',
  GN: 'green',
  GY: 'grey',
  OG: 'orange',
  PK: 'pink',
  RD: 'red',
  VT: 'violet',
  WH: 'white',
  YE: 'yellow',
};

export function describeColour(code: string): string {
  const [main, tracer] = code.split('-');
  const m = WIRE_COLOUR_NAMES[main] ?? main;
  return tracer ? `${m} with ${WIRE_COLOUR_NAMES[tracer] ?? tracer} tracer` : m;
}

export type EndKind = 'pin' | 'splice' | 'ground';

export function endKind(end: string): EndKind {
  if (/^S\d/.test(end)) return 'splice';
  if (/^G\d/.test(end)) return 'ground';
  return 'pin';
}

/** "C1BP02B-15" → { connector: "C1BP02B", pin: "15" } */
export function splitPin(end: string): { connector: string; pin: string } {
  const i = end.lastIndexOf('-');
  return { connector: end.slice(0, i), pin: end.slice(i + 1) };
}
