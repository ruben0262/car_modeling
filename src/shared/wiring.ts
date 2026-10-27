/**
 * Wiring netlist extracted from OEM wiring diagrams: Land Rover Electrical Wiring Diagrams
 * (tools/ewd/import.ts) and Volkswagen Current Flow Diagrams (tools/ewd/import-vw.ts).
 */
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
  /** `name`: the legend's description where the diagrams give one ("24-pin connector, on engine left"). */
  connectors: Record<string, { component: string | null; pins: Record<string, { wires: string[]; signal?: string }>; mates?: string; name?: string }>;
  wires: EwdWire[];
  fuses: Record<string, { rating?: number; between: string[]; sheets: string[] }>;
  splices: Record<string, { wires: string[]; name?: string }>;
  grounds: Record<string, { wires: string[]; name?: string }>;
  stats: Record<string, number>;
  /** Present in the published file only (added by the data build). */
  layout?: WiringLayout;
}

/** Wire colour codes → display colours: JLR (BK, "BU-OG") and VW, which keeps the German codes (sw, "ro/sw"). */
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
  sw: '#1d1d1f',
  br: '#7a4a24',
  bl: '#2f6fd6',
  gn: '#2f9e50',
  gr: '#8c9196',
  or: '#f08a24',
  rs: '#f28cb8',
  ro: '#d93a2b',
  rt: '#d93a2b',
  li: '#8b5bd6',
  ws: '#f2f2f0',
  ge: '#f2d01f',
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
  sw: 'black',
  br: 'brown',
  bl: 'blue',
  gn: 'green',
  gr: 'grey',
  or: 'orange',
  rs: 'pink',
  ro: 'red',
  rt: 'red',
  li: 'purple',
  ws: 'white',
  ge: 'yellow',
};

/** Main colour and tracer of a wire colour code: "BU-OG" (JLR) or "ro/sw" (VW). */
export function colourParts(code: string): [string, string | undefined] {
  const [main, tracer] = code.split(/[-/]/);
  return [main, tracer];
}

export function describeColour(code: string): string {
  const [main, tracer] = colourParts(code);
  const m = WIRE_COLOUR_NAMES[main] ?? main;
  return tracer ? `${m} with ${WIRE_COLOUR_NAMES[tracer] ?? tracer} tracer` : m;
}

export type EndKind = 'pin' | 'splice' | 'ground';

/**
 * What a wire end is. With the netlist at hand the end is looked up in its splices and grounds, which every
 * importer lists (VW names them after the diagrams: "B170", earth point "13"); without it, the Land Rover
 * prefixes decide ("S1BB33" splice, "G1D108A-1" ground).
 */
export function endKind(end: string, data?: Pick<EwdData, 'splices' | 'grounds'>): EndKind {
  if (data) {
    if (data.splices[end]) return 'splice';
    if (data.grounds[end] || data.grounds[end.replace(/-\d+$/, '')]) return 'ground';
    return 'pin';
  }
  if (/^S\d/.test(end)) return 'splice';
  if (/^G\d/.test(end)) return 'ground';
  return 'pin';
}

/** "C1BP02B-15" → { connector: "C1BP02B", pin: "15" } */
export function splitPin(end: string): { connector: string; pin: string } {
  const i = end.lastIndexOf('-');
  return { connector: end.slice(0, i), pin: end.slice(i + 1) };
}
