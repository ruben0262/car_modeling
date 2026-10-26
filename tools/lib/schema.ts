/**
 * Authoring schema for vehicle data (data/vehicles/**). Curators edit YAML;
 * this schema rejects anything ambiguous before geometry is built.
 */
import { z } from 'zod';
import { LINK_TYPES } from '../../src/shared/manifest';
import { FACT_LEVELS, GEOMETRY_LEVELS, PLACEMENT_LEVELS, REVIEW_SCOPES } from '../../src/shared/verification';

export const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ids must be kebab-case (a-z, 0-9, -)');
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Side = z.enum(['left', 'right']);

export const SourceRef = z
  .object({
    ref: Id,
    locator: z.string().optional(),
    says: z.string().optional(),
  })
  .strict();

const Review = z
  .object({
    by: z.string().min(1),
    role: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'review dates are YYYY-MM-DD'),
    scope: z.array(z.enum(REVIEW_SCOPES)).min(1),
    verdict: z.enum(['approved', 'changes-requested']),
    notes: z.string().optional(),
  })
  .strict();

export const VerificationInput = z
  .object({
    geometry: z.enum(GEOMETRY_LEVELS).optional(),
    placement: z.enum(PLACEMENT_LEVELS).optional(),
    facts: z.enum(FACT_LEVELS).optional(),
    sources: z.array(SourceRef).optional(),
    reviews: z.array(Review).optional(),
    notes: z.string().optional(),
  })
  .strict();

const Placement = z
  .object({
    pos: Vec3.default([0, 0, 0]),
    rot: Vec3.default([0, 0, 0]),
  })
  .strict();

const Access = z
  .object({
    from: z.array(Id).min(1),
    removeFirst: z.array(Id).default([]),
    tools: z.array(z.string()).default([]),
    notes: z.string().optional(),
    sources: z.array(SourceRef).default([]),
  })
  .strict();

const PartNumber = z
  .object({
    number: z.string().min(1),
    side: Side.optional(),
    note: z.string().optional(),
    source: SourceRef.optional(),
  })
  .strict();

const Spec = z.object({ label: z.string(), value: z.string(), source: SourceRef.optional() }).strict();
const Fault = z.object({ symptom: z.string(), cause: z.string().optional(), source: SourceRef.optional() }).strict();

const Connector = z
  .object({
    /** Connector id in the wiring diagrams (e.g. C1E109A); the viewer shows its pin-out. */
    ewd: z.string().regex(/^C\d[A-Z0-9]{1,8}$/).optional(),
    pins: z.number().int().positive().optional(),
    mates: Id.optional(),
    housing: z.string().optional(),
    pinout: z
      .array(
        z
          .object({ pin: z.string(), circuit: z.string().optional(), signal: z.string().optional(), wire: z.string().optional() })
          .strict(),
      )
      .default([]),
  })
  .strict();

/** A documented join between two components ("bolted to the subframe, 175 Nm"). */
const Link = z
  .object({
    to: Id,
    type: z.enum(LINK_TYPES),
    note: z.string().optional(),
    torque: z.string().optional(),
    source: SourceRef.optional(),
  })
  .strict();

const EwdCode = z.string().regex(/^[A-Z]\d{3}$/, 'EWD codes look like D131');

/** Geometry generator call: `gen` picks the generator, remaining keys are its parameters. */
export const GeometryCall = z.looseObject({ gen: z.string().min(1) });

export const NodeKind = z.enum(['assembly', 'part', 'connector', 'harness', 'hose', 'pipe', 'fastener']);

export const NodeInput = z
  .object({
    id: Id,
    parent: Id.optional(),
    kind: NodeKind,
    name: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    summary: z.string().optional(),
    function: z.string().optional(),
    sides: z.array(Side).min(1).optional(),
    location: z.object({ zone: Id, text: z.string() }).strict().optional(),
    access: Access.optional(),
    partNumbers: z.array(PartNumber).default([]),
    specs: z.array(Spec).default([]),
    /** How and from what the part is made, and by whom (material, process, supplier). */
    manufacturing: z.array(Spec).default([]),
    /** Optional equipment / market fitment note ("Xenon headlamps only", "Cold-climate pack"). */
    fitment: z.string().optional(),
    /**
     * Electrical Wiring Diagram component codes represented by this node, e.g. [D131].
     * On a mirrored node, suffix ":l" / ":r" to bind a code to one side (T150:l, T149:r).
     */
    ewd: z.array(z.string().regex(/^[A-Z]\d{3}(:[lr])?$/, 'EWD codes look like D131 or T150:l')).default([]),
    faults: z.array(Fault).default([]),
    placement: Placement.optional(),
    geometry: GeometryCall.optional(),
    material: z.string().optional(),
    explode: z.object({ dir: Vec3, dist: z.number().nonnegative() }).strict().optional(),
    detail: z.boolean().default(false),
    /**
     * Position depends on which side the steering wheel is (pedals, steering column, glovebox…).
     * Data is authored for left-hand drive; a right-hand-drive variant mirrors handed subtrees.
     */
    handed: z.boolean().default(false),
    connector: Connector.optional(),
    harness: z.object({ connects: z.array(Id).default([]) }).strict().optional(),
    /** Parts that are expected to touch/overlap this one (suppresses interference warnings). */
    contacts: z.array(Id).default([]),
    /** Documented joins to other components (type, fixing torque, citation). */
    links: z.array(Link).default([]),
    verification: VerificationInput.optional(),
  })
  .strict();

export const ComponentFile = z
  .object({
    system: Id,
    defaults: z
      .object({
        verification: VerificationInput.optional(),
        material: z.string().optional(),
      })
      .strict()
      .default({}),
    nodes: z.array(NodeInput),
  })
  .strict();

const SystemInput = z
  .object({
    id: Id,
    name: z.string(),
    short: z.string(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    icon: z.string(),
    layer: z.number().int(),
    summary: z.string(),
    explode: z.object({ dir: Vec3, dist: z.number().nonnegative() }).strict(),
  })
  .strict();

export const SourceInput = z
  .object({
    id: Id,
    title: z.string(),
    publisher: z.string().optional(),
    url: z.url().optional(),
    type: z.enum(['oem-manual', 'oem-parts', 'oem-spec', 'supplier', 'forum', 'press', 'measurement', 'photo', 'other']),
    reliability: z.enum(['A', 'B', 'C', 'D']),
    accessed: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const VehicleFile = z
  .object({
    id: Id,
    make: z.string(),
    model: z.string(),
    generation: z.object({ code: z.string(), years: z.tuple([z.number().int(), z.number().int()]) }).strict(),
    modelYear: z.number().int(),
    variant: z
      .object({
        name: z.string(),
        engine: z.string(),
        transmission: z.string(),
        drive: z.string(),
        body: z.string(),
        market: z.string(),
        steering: z.enum(['left', 'right']),
      })
      .strict(),
    aliases: z.array(z.string()).default([]),
    disclaimer: z.string(),
    bodyColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    envelope: z
      .object({
        length: z.number(),
        width: z.number(),
        height: z.number(),
        wheelbase: z.number(),
        trackFront: z.number(),
        trackRear: z.number(),
        /** Body extremes along X in the vehicle frame (front bumper, rear bumper). */
        xFront: z.number(),
        xRear: z.number(),
      })
      .strict(),
    specs: z.array(Spec).default([]),
    specSources: z.array(SourceRef).default([]),
    systems: z.array(SystemInput).min(1),
    zones: z.record(Id, z.string()),
    approaches: z.array(z.object({ id: Id, label: z.string(), dir: Vec3 }).strict()),
    files: z.array(z.string()).min(1),
    /** Documented joins between components (see JointsFile). */
    joints: z.string().optional(),
    /** Netlist extracted from the OEM wiring diagrams (tools/ewd/import.ts). */
    wiring: z
      .object({
        /** The publication this vehicle uses by default (the closest to its build date). */
        id: Id.default('default'),
        file: z.string(),
        source: Id,
        /** How the publication is told apart, e.g. "VIN 080379–113896". */
        label: z.string().optional(),
        /** Model years it covers, from VIN breaks. */
        years: z.string().optional(),
        note: z.string().optional(),
        /** A publication printing the length of (almost) every wire, used where the default prints none. */
        lengths: z.object({ file: z.string(), source: Id }).strict().optional(),
        /** The same vehicle's wiring in other model years or issues, selectable in the viewer. */
        publications: z
          .array(z.object({ id: Id, file: z.string(), source: Id, label: z.string(), years: z.string().optional(), note: z.string().optional() }).strict())
          .default([]),
        /** Components the diagrams print that this variant does not have (other engine, gearbox or market). */
        notApplicable: z.array(z.object({ codes: z.array(EwdCode).min(1), reason: z.string(), source: SourceRef.optional() }).strict()).default([]),
      })
      .strict()
      .optional(),
    /** Vehicle-specific parameters consumed by generators (e.g. the body surface definition). */
    shapes: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const SourcesFile = z.object({ sources: z.array(SourceInput) }).strict();

/** Shared library of general part descriptions (data/library/descriptions.yaml). */
export const DescriptionsFile = z
  .object({
    descriptions: z.array(
      z
        .object({
          match: z.string().refine((r) => {
            try {
              new RegExp(r, 'i');
              return true;
            } catch {
              return false;
            }
          }, 'invalid regular expression'),
          kinds: z.array(NodeKind).optional(),
          text: z.string().min(20),
        })
        .strict(),
    ),
  })
  .strict();
export type DescriptionsFileT = z.infer<typeof DescriptionsFile>;

/**
 * Documented joins between components (joints.yaml): which part is fixed to which, how, and at what
 * torque. Every joint cites its source. A mirrored part named by its authored id is joined on both sides.
 */
export const JointsFile = z
  .object({
    joints: z.array(
      z
        .object({
          a: Id,
          b: Id,
          type: z.enum(LINK_TYPES),
          torque: z.string().optional(),
          note: z.string().optional(),
          source: SourceRef,
        })
        .strict(),
    ),
  })
  .strict();

export type NodeInputT = z.infer<typeof NodeInput>;
export type VehicleFileT = z.infer<typeof VehicleFile>;
export type ComponentFileT = z.infer<typeof ComponentFile>;
export type SourceInputT = z.infer<typeof SourceInput>;
export type VerificationInputT = z.infer<typeof VerificationInput>;
