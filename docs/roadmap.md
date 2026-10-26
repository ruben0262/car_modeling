# Roadmap

The atlas is built in levels. Each level is confirmed working before the next one starts.

## Level 1 — done: platform and whole-vehicle breakdown

- Data model with verification facets, sources and reviews; schema validation; left/right mirroring.
- Data build: parametric geometry → automated checks → compressed system chunks plus on-demand detail chunks.
- Viewer:
  - systems as layers, x-ray body, explode and break-down;
  - isolate, section cut, verification colour mode;
  - search with mechanic synonyms;
  - access view (camera approach and "remove first" parts);
  - deep links, mobile layout.
- Freelander 2 2.2 TD4: all 11 systems, 265 parts, connectors, harnesses, brake and fuel lines.
- Two breakdown examples: the brake calipers (housing, carrier, pads, piston, nipple, pins) and the turbocharger.
- Tests: unit (rules, frames, search, loader, dataset), browser (search, deep link, break-down, explode, report, 60 fps).

## Level 2 — in progress: built from official documentation

Done:

- Workshop manual, wiring diagrams, handbook and brochure registered as sources and cited by page.
- Wrong parts replaced in place, with no duplicates, enforced by a build check:
  - engine orientation, 12° tilt and cylinder numbering;
  - manual gearbox and clutch;
  - LHD layout;
  - ABS, ECM and fuse-box locations;
  - exhaust layout;
  - rear suspension link names;
  - subframe mounting points and ride height from the body dimension chart.
- Wiring netlist imported from the LHD diagrams, with connector pin-outs, circuit browser and highlighting.
- **Every electrical component that applies to this car is placed** (368 of 368; 26 more belong to other engines, gearboxes or markets and are listed with reasons).
- **One connected harness network:** generated branches to every part, in-line connectors, ground points, and wire-by-wire drawing in 3D for a part or a circuit sheet.
- **Links between parts:** 129 documented joints with torques and manual pages; hose, pipe and cable ends linked from the model; "Connected to" in every part's panel.
- **Descriptions for every part:** written from the manual, or general descriptions from a shared library, labelled as such.
- Official part numbers (JLR parts catalogue, with VIN breaks) for the airbag system.
- **Wiring by model year:** four LHD issues (2007–2009) imported and switchable, with the changes between them; positions of 121 splices, grounds and in-line connectors calculated from the printed wire lengths, and every part's wiring checked against them.
- **Body and trim hardware:** door hinges and check straps (hinge spacing from the body dimension chart), latches, window regulators, handles, seals, tailgate hinges and gas struts, wiper arms, bonnet hinges and release, undershield, pillar and door trims, headlining, rear seat belts, engine oil cooler, oil separators and turbocharger oil lines, each with the manual's procedure and torques.
- About 110 new components:
  - engine internals and timing drive;
  - clutch hydraulics, parking brake, power steering;
  - A/C and heater assembly;
  - modules, sensors, airbags, door electrics and lamps.

Next:

- Obtain the 2010–2011 wiring diagrams (JLR 15 62 21_2E, VIN 216517 onwards, and the issue for serials ~114000–216516) and import them: a 2010 car is newer than every issue in hand.
- Use harness layout drawings to replace the estimated trunk routes, then let the printed wire lengths place the parts the manual only locates by area.
- A body-geometry check from the dimension chart's hole spacings.
- Confirm estimated positions (generated branches, in-line connectors, ground points, front impact sensors) against photos of a real car.
- Extend the joint list beyond the torque tables (removal procedures), and add part numbers system by system from the JLR parts catalogue.
- Confirm the open questions in [verification.md](verification.md) from the VIN, photos and the workshop manual.
- Move high-value parts to *referenced* / *representative*:
  - battery, fuse boxes, fuel filter, turbo, DPF;
  - brakes, wheel-speed sensors, PTU, Haldex coupling.
- Real connector data: housing shapes and colours from connector-face views (pin-outs and mating pairs are done).
- More breakdowns: engine top end (cam cover, rail, injectors), battery and BJB, PTU, Haldex coupling, strut.
- Replace stand-in geometry with measured or scanned meshes, part by part, through the same pipeline.
- Phones: the viewer is CPU-bound by about 800 draw calls. Batch static parts that share a material (three.js `BatchedMesh`) while keeping per-part picking, highlighting and explode.

## Level 3: reviewing in the browser

- Reviewer accounts; approve or request changes per facet; attach photos and measurements; discrepancy reports from users.
- A history of every change to a component (who, when, which source).

## Level 4: many vehicles

- Shared component library: one definition of the DW12 engine, used by every vehicle that has it, placed per vehicle.
- Catalogue search by make, model, year, engine, platform and market; per-variant differences (LHD/RHD, manual/automatic).
- Backend (database plus object storage/CDN) once the catalogue outgrows static files.

## Level 5: diagnostics

- Symptoms and fault codes linked to components; guided access and removal sequences built from `removeFirst`.
- Fluid capacities, torque settings and procedures, each with OEM citations.
