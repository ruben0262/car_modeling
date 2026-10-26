# Verification

The goal is that a mechanic can trust what the atlas shows. That trust has to be earned per component and visible at all times. So verification is part of the data model, not a note at the bottom.

## Three facets per component

| Facet | Levels (low → high) | Evidence that moves it up |
| --- | --- | --- |
| **Geometry**: does it look like the real part? | placeholder → schematic → representative → accurate | photos and drawings (representative); measurement, 3D scan or CAD with key dimensions within ±2 mm (accurate) |
| **Placement**: is it where it really is? | estimated → referenced → calculated → measured | workshop-manual location text or figures (referenced); coordinates computed from official numbers, such as printed wire lengths or the body dimension chart (calculated); measured on a car to ±10 mm (measured) |
| **Facts**: name, function, specs, part numbers | unsourced → secondary → oem | supplier, forum or press source (secondary); workshop manual, parts catalogue or spec sheet (oem) |

A component is **Verified** only when:

- geometry is at least *representative*;
- placement is at least *referenced*;
- facts are *oem*;
- a named reviewer has **approved each facet**.

The latest review per facet wins, so a later "changes requested" revokes an approval. Anything with some evidence is **Partially verified**; everything else is **Unverified**. The rules live in `src/shared/verification.ts` and are unit-tested.

Reviews are recorded in the data:

```yaml
verification:
  geometry: representative
  placement: measured
  facts: oem
  sources: [{ ref: topix-battery, locator: "414-01 Battery, Mounting and Cables", says: "…" }]
  reviews:
    - { by: "J. Smith", role: "Master technician", date: 2026-11-02, scope: [geometry, placement, facts], verdict: approved }
```

## Sources

Every source is registered once in `sources.yaml` with a type and a reliability grade:

| Grade | Meaning |
| --- | --- |
| A | OEM document in hand (workshop manual, EPC, wiring diagram) |
| B | faithful copy of OEM material, or a reputable specialist |
| C | aggregator or supplier listing |
| D | owner forum or video |

Facts can only reach *oem* when cited from a source whose type is `oem-*`. The build rejects anything else, and also rejects facts above *unsourced* that cite nothing. When a source "says" something, quote or closely paraphrase it. Never write what you expect it to say.

## Automated checks (every data build)

| Check | Catches |
| --- | --- |
| Wheel centres vs. wheelbase, track and tyre radius | mis-scaled or mis-placed corners |
| Body extents vs. published length, width (excl. mirrors) and height | a body that has drifted from the real car |
| Vehicle envelope | parts placed outside the car |
| Exact triangle-level interference between separate assemblies | parts occupying the same space (declare real contacts with `contacts`) |
| Connector mating | connectors that claim to mate but do not meet |
| Harness routes | cables that do not reach the parts they claim to connect |
| Duplicates | the same wiring code, name or geometry stored twice |
| Wiring-diagram cross-reference | unknown connector ids or component codes; codes marked not applicable that are mapped anyway; coverage |
| Electrical network | every part with connectors anchored to one connected harness network; how many wires can be drawn end to end; how many positions were calculated from printed lengths |
| Printed wire lengths | each wire's modelled route against the length printed in the diagrams; lists the parts that disagree most (review list) |
| Coverage | counts by status, and components that cite no source |

These checks found and forced fixes for real packaging errors while the Freelander was being built: the battery inside the strut turret, the rear struts inside the tyres, the caliper carrier through the disc. They cannot prove a part is correct. Only evidence and review can.

## Sources in use

The Freelander 2 data is now built from official Land Rover documentation, cited by page:

| Source | What it gives |
| --- | --- |
| Workshop manual 2007–2011 (`wsm`, 2,444 pages, JLR TOPIx procedures) | Component descriptions and locations, removal steps, torques, specifications, materials and suppliers, body dimension chart, panel gaps |
| Electrical Wiring Diagrams, LHD, VIN 080379 onwards (`ewd`) | 98 circuit sheets: components, connectors and pins, wire colours and cross-sections, fuses, splices and grounds |
| Owner's handbook LRL 10 02 56 131 (`handbook`, from JLR TOPIx) | Capacities, fluids, fuse tables |
| 2011 model-year brochure (`brochure-my2011`) | Published dimensions, gear ratios, brake sizes |
| JLR Classic parts catalogue, airbag system (`jlr-parts-airbag`) | Part numbers with VIN breaks for the crash sensors, airbags and restraints control module |
| Wiring diagrams for earlier VIN ranges (`ewd-lhd-000201`, `ewd-lhd-057872`) | Wiring by model year, and what changed between issues |
| JLR engineering circuit diagrams, 09MY LHD (`ewd-09my-engineering`) | Printed length of almost every wire, used to calculate splice, ground and in-line connector positions |
| Owner forums (`fixya-crash-sensor`, `landyzone-dab-aerial`, `freel2-sound-system`, grade D) | Only to support positions the manual describes loosely; never the sole source of a fact |

The full list of documents and web pages, with links and what each is good for, is in [references.md](references.md).

Where these documents showed earlier data to be wrong, the part was **replaced in place**, never kept alongside the corrected one. The build fails if a component appears twice; see the duplicate check.

Using the manual and wiring diagrams as references is fine. Republishing their text, figures or the full netlist on a public site may need permission from JLR; decide this before hosting.

## What is documented and what is derived

The atlas mixes two kinds of information, and the viewer always says which is which:

| Documented (cited) | Derived by the build (labelled as such) |
| --- | --- |
| Part locations from the manual's text and figures | Exact coordinates where the manual only names the area (`placement: estimated`) |
| Joints in `joints.yaml`: what is fixed to what, with torque and page | Hose, pipe and cable ends linked to the part they meet in the model |
| Every wire, pin, colour, cross-section, splice, ground and fuse from the diagrams | Harness branches, in-line connector, splice and ground positions, and wire routes along the harnesses (the diagrams print connections, not positions) |
| Part descriptions written from the manual | General descriptions from `data/library/descriptions.yaml`, shown as "general description" |

Generated nodes (`branch-…`, `inline-…`, `ground-…`) carry `generated: true`, schematic geometry and estimated placement, and cite the wiring-diagram sheets they come from.

## Open questions for this vehicle

The variant is a **2010 model year, 2.2 TD4, 6-speed manual, left-hand drive (EU)**. Without a VIN these remain open:

1. **Stop/Start (TD4_e).** Manual TD4 cars from 2010MY were offered with Stop/Start (AGM battery, battery monitoring module, gear-neutral and linear clutch sensors). Those parts are included but marked *fitment: Stop/Start vehicles*.
2. **Diesel particulate filter.** It depends on market and emissions level, so it is marked as fitment. Its exact position in the tunnel is estimated from the removal figures.
3. **Battery position on LHD.** The manual says "LH side of the engine compartment, behind a cover". On LHD the brake booster and clutch master cylinder are also on the left, so the exact spot is estimated.
4. **ECM lateral position.** It is "between the bulkheads", but which side is not stated.
5. **Engine management type.** The manual contradicts itself: EDC16 on p. 579, EDC 15 C2 on p. 987.
6. **Alarm sounder position.** The manual gives two descriptions (pp. 1780 and 1801).
7. **Wiring VIN range.** The newest LHD set in hand covers serials 080379–113896. The parts catalogue's VIN breaks show serial 119277 is still model year 2009 (`9H119277`) and 2010 cars carry later serials (e.g. `AH150338`), so a 2010 car is **newer than these diagrams**. Stop/Start parts added for 2010 (battery monitoring, gear-neutral sensor) are not in the netlist. The 2010–2011 diagrams (TOPIx) are needed to close this.
8. **Fuel filler side, tailpipe side, spare-wheel type.** Not stated in the documents used.
9. **Optional equipment.** Xenon/AFS headlamps, TPMS, parking aid, fuel-fired heater, power and memory seats, seat heating, navigation, DAB, premium audio, Bluetooth, sunroof and tow bar electrics appear in the diagrams and are marked as fitment.
10. **The manual contradicts itself on two torques.** Battery terminal clamps: 5 Nm in the removal procedure (p. 1564), 10 Nm in the specifications table (p. 1554). Accessory belt tensioner and idler: 48 Nm (pp. 574, 1566) and 45 Nm (p. 859). Both values are shown on the parts.
11. **Positions the manual does not give.** Front impact sensors ("front of the vehicle"), the voice recognition module, the luggage compartment lamp side, the trailer harness pick-up, the passenger airbag deactivation switch and the heated washer jets are placed by inference and marked *estimated*.
12. **Variant codes not fitted.** 26 diagram components belong to the petrol engine, the automatic gearbox, or North American and Japanese equipment. They are listed with their reasons under `wiring.notApplicable` in `vehicle.yaml` and excluded from the coverage count.
13. **Harness routes.** The printed wire lengths show the real harness runs differ from the modelled trunks. For example, wires from the CJB to the right-hand rear lamps are about 1.6 m longer than to the left-hand ones, so the body harness reaches the rear down the left side; some runs are far longer than a direct path. The `wire-lengths` check lists the parts concerned. Harness layout drawings (TOPIx or the Electrical Reference Library) would settle the routes.
14. **Right-hand-drive lengths in the service issues.** For wires that cross the car, the TOPIx service issues print the same lengths as right-hand-drive cars; the LHD engineering issue differs by 0.5–1 m. The engineering figures are used.

## Workflow for raising a part's status

1. Find an OEM reference (workshop manual section, EPC page, wiring diagram) and add it to `sources.yaml`.
2. Update the facts and cite it: `facts: oem`.
3. Check the location against the manual's figure and set `placement: referenced`, or measure the car and set `measured`.
4. Replace or refine the geometry (`representative` / `accurate`).
5. A qualified reviewer adds a `reviews` entry. `npm run verify` must pass.

A review UI (sign-off in the browser, photo attachments, discrepancy reports) is the next verification milestone; see the roadmap.
