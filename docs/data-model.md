# Data model

## Coordinate frame

All vehicle data uses the **ISO 8855 vehicle frame in millimetres**:

- **+X forward, +Y left, +Z up.**
- **Origin:** on the ground, on the centreline, directly under the front axle.
- **Rotations:** degrees, applied in three.js `XYZ` Euler order.

This makes a position checkable with a tape measure ("battery centre is 330 mm behind the front axle, 450 mm left of centre"). The conversion to glTF/three.js (metres, Y up) happens in one place, `src/shared/frames.ts`, and is unit-tested.

A node's `placement` is relative to its **parent**. Assemblies can therefore use their own frame. The engine, for example, is authored in an engine frame where X runs along the crank toward the timing belt, and the whole engine is then placed once.

## Files

`vehicle.yaml` lists the component files. Each file belongs to one **system** (a layer in the UI) and holds a list of nodes:

```yaml
system: electrical
defaults:
  verification: { geometry: schematic, placement: estimated, facts: unsourced }
nodes:
  - id: battery                       # kebab-case, unique per vehicle
    kind: assembly                    # assembly | part | connector | harness | hose | pipe | fastener
    name: Battery (12 V)
    aliases: [car battery]            # search synonyms mechanics actually use
    summary: …
    location: { zone: engine-bay-left, text: "Rear left of the engine compartment" }
    access:
      from: [bonnet]                  # approach ids from vehicle.yaml (drive the camera)
      removeFirst: [battery-cover]    # animated out in "Show access"
      tools: [10 mm socket]
      notes: "…"
      sources: [{ ref: lrman-battery, says: "Remove the cover and disconnect the ground cable" }]
    placement: { pos: [-330, 450, 735] }
    specs: [{ label: Capacity, value: "80 Ah", source: { ref: lrman-battery } }]
    verification:
      facts: secondary
      sources: [{ ref: lrman-battery, says: "Exide H7, 80 Ah, 700 CCA" }]
  - id: battery-case
    parent: battery
    kind: part
    name: Battery case
    geometry: { gen: battery, size: [278, 175, 190], part: case }
```

**Free text inside `{ … }` must be quoted** if it contains commas. The schema rejects unknown keys, so an unquoted comma fails the build instead of silently corrupting data.

### Physical parent vs. system

`parent` is **physical attachment**: what moves with what when the car is taken apart. The file's `system` is the **layer** a part belongs to. The alternator lives in `electrical.yaml` (Electrical layer) but has `parent: engine-assembly`. So it explodes with the engine and hides with the Electrical layer.

### Left/right pairs

`sides: [left, right]` creates `<id>-l` and `<id>-r`. Author the **left (+Y)** copy. The right one is reflected: position Y and the X/Z rotation angles are negated, and geometry is mirrored. This applies to the whole subtree. Inside a mirrored subtree:

- **References follow the side.** `removeFirst: [wheel-front]` on the left caliper resolves to `wheel-front-l`.
- **Zone and approach ids follow the side.** Ids ending in `-left` become `-right` on the right copy.

### Left- and right-hand drive

Data is authored for **left-hand drive**. Mark parts whose position depends on the driver's side with `handed: true`:

- Driver side: pedals, steering column and wheel, instrument cluster, brake booster and master cylinder, diagnostic socket.
- Passenger side: glovebox, CJB, passenger airbag.

When a vehicle sets `steering: right`, the build reflects every handed subtree, so a RHD variant reuses the same files instead of storing a second copy.

### Official references on a part

| Field | Meaning |
| --- | --- |
| `manufacturing` | Material, process and supplier facts (label/value/source), e.g. "Cast iron, double-layer walls" |
| `fitment` | Optional or market-dependent equipment ("Xenon headlamps only", "Stop/Start vehicles") |
| `ewd` | Wiring-diagram component codes this part represents (`[D131]`). On a mirrored part, `T150:l` / `T149:r` bind a code to one side. The build checks every code exists and that no code is used twice. |
| `connector.ewd` | A connector part's id in the wiring diagrams (e.g. `C1E109A`); the viewer shows its pin-out |
| `partNumbers` | Only numbers printed in OEM documents (the manual, or the JLR parts catalogue with its VIN breaks) — never guessed |
| `links` | Documented joins to other parts (`to`, `type`, `torque`, `note`, `source`); usually kept in `joints.yaml` instead |

### Joints (`joints.yaml`)

Which part is fixed to which, how, and at what torque, taken from the manual's torque tables and procedures. Each joint cites its page. A mirrored part named by its authored id is joined on both sides (the left knuckle to the left lower arm, the right to the right):

```yaml
joints:
  - { a: front-caliper-carrier, b: front-knuckle, type: bolted, torque: "200 Nm (new)", note: "Caliper mounting plate to wheel knuckle bolts", source: { ref: wsm, locator: p. 258 } }
```

Every joint becomes a link on both parts (`evidence: authored`). The build adds **derived** links (`evidence: derived`) for hose, pipe and cable ends that meet a part in the model, only between parts carrying the same fluid. The viewer's "Connected to" section shows documented joints with torque and page, derived links labelled as model-derived, and the parts each part is wired to (read from the netlist at runtime).

### Part descriptions

A part's own `summary` is written from the manual. Parts without one get a general description from `data/library/descriptions.yaml`: the first entry whose `match` (a regular expression on the part name) fits, optionally limited to `kinds`. Generic fallbacks (module, switch, connector, pipe) come last. The viewer marks these as general descriptions, so they must stay true for any car.

### Wiring netlist

`tools/ewd/import.ts` reads an EWD publication (PDF with a text layer) and writes the netlist the sheets print:

- **Components and connectors:** codes, connectors and pins.
- **Wires:** id, colour, cross-section, option code, ends.
- **Distribution:** fuses with ratings, splices and grounds.

The netlist is stored next to the vehicle (`wiring/…json`) and referenced from `vehicle.yaml`; the viewer loads it on demand. Wires whose far end is printed on another sheet keep the end that is printed.

A vehicle can carry several issues of its diagrams (`wiring.publications`, each with a VIN range or model years). The default one is shown first; the viewer's Wiring tab switches between them and lists what changed from the previous issue (components added or removed; connections added, removed or with a different colour or size, compared by their two ends). `wiring.lengths` names an issue that prints the length of almost every wire; see *Calculated positions* below.

The importer reads both formats JLR used: service issues (sheet headers like `303-14 Petrol 01/05`) and engineering issues (`ENGINE MANAGEMENT DIESEL CIRCUIT 9G92-…`, footer `System Page 01 of 05`). Wires printed without an id (`RD,25.0`) are named from their two ends (`W:C1R213-1~C21D-8`) and merged with the labelled wire that has the same ends.

A publication covers several variants. Components this car cannot have (the other engine, the other gearbox, other markets) are listed under `wiring.notApplicable` with a reason and a citation; they leave the coverage count, and the build fails if one of them is mapped to a part.

### Harness network (generated)

The diagrams print connections, not positions. `tools/lib/harness.ts` turns them into a physical network:

1. **Trunks.** The authored harness runs (`kind: harness` with routed `tube` geometry) become a routing graph. A trunk end near another trunk is spliced into it.
2. **Branches.** Every part carrying wiring codes is anchored to that graph. Where an authored harness already reaches the part, it is used. Otherwise the build adds a branch from the nearest trunk point, ending in one housing per connector id the netlist prints (`branch-<part>`, a child of the part, so it moves with it).
3. **Splices, in-line connectors and grounds** are placed at the graph median of what their wires reach (`inline-…` and `ground-…` nodes; splices stay in the layout only).

Generated nodes carry `generated: true` and schematic geometry. Branches follow estimated routes; ground points and in-line connectors are `calculated` when their position fits the printed wire lengths (below), otherwise `estimated`.

### Calculated positions

The wiring diagrams print a wire's length after its colour and cross-section (`SBB19LC,BU-RD,6.0,700`). The publication's own notes define it: *"the figure, 480 indicates the approximate position of the harness splice is 480mm from connector C2335"* (LHD 000201 issue, p. 9). The build places each splice, ground and in-line connector at the point on the harness network whose route distances best match the printed lengths of its wires, and marks it `calculated` when every length is met within 20 % (at least 150 mm); the route error is stored in the layout (`calc`) and shown on the part.

Lengths come first from the engineering issue named in `wiring.lengths`, then from the publication itself. Service issues print right-hand-drive lengths for wires that cross the car (BJB to CJB 1220 mm against 2130 mm in the LHD engineering issue), so they are only used where the engineering issue has no figure.

The `wire-lengths` check compares every wire between two parts with its modelled route and lists the parts that disagree most: either the part is out of place or the real harness runs differently from the modelled trunks. It is a review list, not an error, because the documents in hand print lengths, not harness routes.

The body dimension chart (wsm pp. 2249–2257) gives hole-to-hole spacings; parts placed from it (door hinge spacing, tailgate hinges, gas strut spigots) are also `calculated`, with the chart line quoted. The routing graph, connector anchors and splice/ground positions are written into the published wiring file as `layout`. The viewer routes any wire along it, so selecting a part or a circuit sheet draws its wires in their colours. The `electrical-network` check fails the build if any part's connectors are not anchored to the single connected network.

```
npx tsx tools/ewd/import.ts "<EWD.pdf>" data/vehicles/…/wiring/ewd-lhd-080379.json --vin "080379 onwards" --market LHD
```

### Contacts

The interference check flags parts of different assemblies that intersect. Parts that really touch (a glow plug screwed into the head, a disc clamped between hub and wheel) declare `contacts: [<id>]`. A contact covers the named node and all its descendants, and applies to the declaring node's descendants too.

## Geometry

`geometry: { gen: <name>, …params }` calls a parametric generator (`tools/geometry/registry.ts`). Every generator validates its parameters, so a typo is a build error.

| Generator(s) | Used for |
| --- | --- |
| `box`, `cyl`, `lathe`, `tube`, `prism`, `sphere`, `torus`, `frame`, `compound` | generic shapes; `compound` combines several with their own pose/material |
| `body-panel`, `body-cap`, `arch-flare`, `arch-liner` | exterior panels cut from the parametric body surface (`shapes.body`) |
| `tyre`, `rim`, `brake-disc`, `caliper`, `hub`, `knuckle`, `wheel-speed-sensor` | wheel corners; `caliper` can emit housing, carrier, pads, piston, nipple or pins separately |
| `strut`, `coil-spring`, `link`, `driveshaft`, `propshaft`, `steering-rack` | suspension and driveline |
| `engine-block`, `cylinder-head`, `cam-cover`, `oil-sump`, `engine-cover`, `pulley`, `belt`, `turbo`, `machine`, `injector`, `glow-plug`, `transaxle`, `bevel-housing`, `coupling`, `mount` | powertrain |
| `battery`, `enclosure`, `connector`, `heat-exchanger`, `fan`, `canister`, `saddle-tank`, `seat`, `steering-wheel`, `lamp`, `mirror`, `airbox`, `pedal` | everything else |

Procedural geometry is the **stand-in**, not the destination. The pipeline is format-agnostic, so a part can later be swapped for a measured, scanned or CAD-derived mesh without touching the viewer.

### Detail assemblies

`detail: true` on an assembly moves its children into a separate GLB. The parent chunk carries a merged proxy. The viewer swaps the proxy for real parts the first time someone selects inside it or breaks it down, and it prefetches those files in idle time.

## Runtime manifest

`public/data/vehicles/<id>/manifest.json` (types in `src/shared/manifest.ts`) holds:

- the flattened tree, with resolved facts, verification status and score;
- explode vectors in the parent frame, either authored or derived from geometry;
- world bounds and chunk membership for every node;
- sources, approaches, zones and the automated-check results.

`public/data/catalog.json` lists all vehicles for search and the landing page: identity, verification counts, the systems, a few headline counts taken from the manifest (joints, connectors, wires, wiring issues, sources), and the catalogue images.

### Catalogue images

`data/vehicles/<make>/<model>/<variant>/media/` holds renders of the vehicle's own 3D model, made by `tools/render-images.mjs` (never photos, so they always show what the viewer shows and carry no image rights): `hero` (painted) and `xray` from the same camera, `exploded` (systems coloured) and `wiring`, each in two widths, as WebP. `media.json` lists them, the date, a fingerprint of the geometry they were rendered from, and the parts marked on the x-ray image with their position as a fraction of its width and height. The build copies the images next to the geometry with content-hashed names, fails if a marked part no longer exists, and warns when the geometry has changed since the images were rendered.

## Adding a vehicle

The full process, with sources to look for, commands and a definition-of-done checklist, is in [adding-a-vehicle.md](adding-a-vehicle.md). In short:

1. Create `data/vehicles/<make>/<model>/<variant>/` with a `vehicle.yaml`, `sources.yaml` and system files. Copying the Freelander folder is the fastest start.
2. Set the published `envelope`. The build checks wheels and body extents against it.
3. Run `npm run data` and fix whatever the checks report.
4. Import the wiring diagrams for that market and VIN range with `tools/ewd/import.ts`, map their components to parts, and list the rest under `wiring.notApplicable`.
5. Add `joints.yaml` from the manual's torque tables.
6. Shared components (the same engine in several cars) are currently authored per vehicle. A shared component library is on the [roadmap](roadmap.md).
