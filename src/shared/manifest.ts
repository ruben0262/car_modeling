/**
 * Runtime contract between the data build (tools/) and the viewer (src/).
 * The build writes one manifest per vehicle plus binary geometry chunks;
 * the viewer never reads the authoring YAML.
 */
import type { Vec3 } from './frames';
import type { SourceRef, VerificationFacets, VerificationStatus } from './verification';

export const MANIFEST_SCHEMA_VERSION = 1;

export type NodeKind = 'system' | 'assembly' | 'part' | 'connector' | 'harness' | 'hose' | 'pipe' | 'fastener';
export type Side = 'left' | 'right';

export interface PartNumber {
  number: string;
  note?: string;
  source?: SourceRef;
}

export interface Spec {
  label: string;
  value: string;
  source?: SourceRef;
}

export interface Fault {
  symptom: string;
  cause?: string;
  source?: SourceRef;
}

export interface AccessInfo {
  from: string[];
  removeFirst: string[];
  tools: string[];
  notes?: string;
  sources: SourceRef[];
}

export interface PinInfo {
  pin: string;
  circuit?: string;
  signal?: string;
  wire?: string;
}

export interface ConnectorInfo {
  ewd?: string;
  pins?: number;
  mates?: string;
  housing?: string;
  pinout: PinInfo[];
}

export interface HarnessInfo {
  connects: string[];
}

/** How two components are joined. */
export const LINK_TYPES = ['bolted', 'clipped', 'plugged', 'screwed', 'pressed', 'hose', 'pipe', 'shaft', 'belt', 'cable', 'harness', 'electrical', 'sealed'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export interface LinkInfo {
  to: string;
  type: LinkType;
  /** "authored" links cite a document; "derived" ones are worked out by the build (geometry or harness routing). */
  evidence: 'authored' | 'derived';
  note?: string;
  torque?: string;
  source?: SourceRef;
}

export interface RuntimeVerification extends VerificationFacets {
  status: VerificationStatus;
  score: number;
}

export interface RuntimeNode {
  id: string;
  parent: string | null;
  children: string[];
  kind: NodeKind;
  name: string;
  aliases: string[];
  system: string;
  depth: number;
  side?: Side;
  summary?: string;
  function?: string;
  location?: { zone: string; text: string };
  access?: AccessInfo;
  partNumbers: PartNumber[];
  specs: Spec[];
  manufacturing: Spec[];
  fitment?: string;
  /** Electrical Wiring Diagram component codes this node represents. */
  ewd: string[];
  faults: Fault[];
  connector?: ConnectorInfo;
  harness?: HarnessInfo;
  /** Components this one is joined to (mechanical and harness links; wire-level links come from the netlist). */
  links?: LinkInfo[];
  /** Wiring-diagram connector ids carried by this node (generated harness branches and in-line connectors). */
  ewdConnectors?: string[];
  /** Created by the data build from the wiring diagrams (harness branches, in-line connectors, ground points). */
  generated?: boolean;
  /** The summary is a general description of this kind of part, not a vehicle-specific statement. */
  summaryGeneral?: boolean;
  material?: string;
  verification: RuntimeVerification;
  /** Explode offset in the parent frame, three.js metres. */
  explode: Vec3;
  /** World-space bounds of the node and its descendants, three.js metres. */
  bounds?: { min: Vec3; max: Vec3 };
  /** Local bounding-box size of this node's own geometry in millimetres (for display). */
  size?: Vec3;
  /** Chunk containing this node's transform/geometry. */
  chunk: string;
  /** For lazily loaded assemblies: chunk holding the detailed children. */
  detailChunk?: string;
  triangles: number;
}

export interface SystemInfo {
  id: string;
  name: string;
  short: string;
  color: string;
  icon: string;
  layer: number;
  summary: string;
  chunk: string;
}

export interface ChunkInfo {
  id: string;
  url: string;
  bytes: number;
  triangles: number;
  /** 'system' chunks load up front; 'detail' chunks load on demand. */
  role: 'system' | 'detail';
  root: string;
}

export interface SourceInfo {
  id: string;
  title: string;
  publisher?: string;
  url?: string;
  type: 'oem-manual' | 'oem-parts' | 'oem-spec' | 'supplier' | 'forum' | 'press' | 'measurement' | 'photo' | 'other';
  reliability: 'A' | 'B' | 'C' | 'D';
  accessed?: string;
  notes?: string;
}

export interface ApproachInfo {
  id: string;
  label: string;
  /** Camera direction (from target towards camera), three.js frame. */
  dir: Vec3;
}

export interface CheckResult {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  nodes: string[];
  detail?: string;
}

export interface VehicleInfo {
  id: string;
  make: string;
  model: string;
  generation: { code: string; years: [number, number] };
  modelYear: number;
  variant: {
    name: string;
    engine: string;
    transmission: string;
    drive: string;
    body: string;
    market: string;
    steering: 'left' | 'right';
  };
  aliases: string[];
  specs: Spec[];
  envelope: {
    length: number;
    width: number;
    height: number;
    wheelbase: number;
    trackFront: number;
    trackRear: number;
  };
  frame: { axes: string; origin: string; units: string };
  disclaimer: string;
  bodyColor: string;
}

export interface PublicationChanges {
  /** The publication these changes are counted from (the previous one in time). */
  from: string;
  componentsAdded: { code: string; name: string }[];
  componentsRemoved: { code: string; name: string }[];
  connectionsAdded: number;
  connectionsRemoved: number;
  /** Same two ends, different colour or cross-section. */
  connectionsChanged: number;
  examples: { kind: 'added' | 'removed' | 'changed'; ends: string[]; wire: string; was?: string; sheet?: string }[];
}

/** One issue of the wiring diagrams (a VIN range or model year). */
export interface WiringPublication {
  id: string;
  label: string;
  years?: string;
  note?: string;
  title: string;
  vin: string;
  source: string;
  url: string;
  bytes: number;
  stats: Record<string, number>;
  mapped: number;
  relevant: number;
  /** Wires with a printed length (mm). */
  lengths: number;
  isDefault: boolean;
  changes?: PublicationChanges;
}

export interface WiringInfo {
  /** Id of the default publication (its url, stats and counts are repeated below). */
  id: string;
  url: string;
  bytes: number;
  source: string;
  note?: string;
  publication: { title: string; vin: string; market: string };
  stats: Record<string, number>;
  /** EWD component codes that have a 3D node. */
  mapped: number;
  /** EWD components relevant to this variant (excludes other-engine sheets and `notApplicable`). */
  relevant: number;
  /** Components printed in the diagrams that this variant does not have, with the reason. */
  notApplicable: { codes: string[]; reason: string; source?: SourceRef }[];
  /** Harness routing graph shipped inside the wiring file (see WiringLayout). */
  layout?: { vertices: number; junctions: number; branches: number; inline: number; splices: number; grounds: number; calculated: number };
  /** Every publication of this vehicle's wiring, oldest first. */
  publications: WiringPublication[];
  /** Source of the printed wire lengths positions are calculated from. */
  lengthsSource?: string;
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA_VERSION;
  generatedAt: string;
  vehicle: VehicleInfo;
  wiring?: WiringInfo;
  systems: SystemInfo[];
  nodes: RuntimeNode[];
  chunks: ChunkInfo[];
  sources: Record<string, SourceInfo>;
  approaches: ApproachInfo[];
  zones: Record<string, string>;
  checks: CheckResult[];
  stats: {
    nodes: number;
    parts: number;
    connectors: number;
    lines: number;
    triangles: number;
    bytes: number;
    byStatus: Record<VerificationStatus, number>;
  };
}

/** A picture rendered from the vehicle's 3D model (tools/render-images.mjs), in several widths. */
export interface CatalogImage {
  /** Size of the largest file. */
  width: number;
  height: number;
  /** Smallest first. */
  files: { width: number; url: string }[];
}

export interface CatalogMedia {
  /** Date the images were rendered. */
  rendered: string;
  /** False when the model has changed since the images were rendered. */
  current: boolean;
  /** `hero` (painted) and `xray` share one camera; also `exploded` and `wiring`. */
  images: Record<string, CatalogImage>;
  /** Parts marked on the x-ray image, in priority order; positions are fractions of its width and height. */
  hotspots: { id: string; name: string; system: string; color: string; x: number; y: number }[];
}

/** Catalogue entry used by the vehicle search on the landing page. */
export interface CatalogEntry {
  id: string;
  make: string;
  model: string;
  generation: string;
  years: [number, number];
  modelYear: number;
  variant: string;
  engine: string;
  transmission: string;
  drive: string;
  market: string;
  aliases: string[];
  manifest: string;
  stats: { parts: number; verified: number; partial: number; unverified: number; bytes: number };
  /** The vehicle's layers, for the landing page. */
  systems: { id: string; name: string; short: string; color: string }[];
  /** Counts shown on the landing page, all taken from the built manifest. */
  highlights: { joints: number; connectors: number; wires: number; wiringIssues: number; sources: number };
  media?: CatalogMedia;
}

export interface Catalog {
  schema: typeof MANIFEST_SCHEMA_VERSION;
  vehicles: CatalogEntry[];
}
