# Adding a vehicle: the process

This is how the Land Rover Freelander 2 (L359) 2010 2.2 TD4 was built, written as a process to repeat for the next vehicle. Follow the steps in order. Each step ends with something the build or a screenshot can confirm. Do not start the next level until the current one passes.

Read with: [data-model.md](data-model.md) (the format), [verification.md](verification.md) (the rules for evidence), [references.md](references.md) (the Freelander's sources, as an example of what to look for).

## Rules for every step

- **Every fact cites a source.** Use a `sources.yaml` id plus a locator: PDF page for manuals, sheet for wiring diagrams. Quote the sentence in `says` when the wording matters.
- **Official documents first.** Forums and retailers only corroborate (grade C/D), or fill gaps the manual leaves; they are never the only source for a fact at `oem` level.
- **Never guess** part numbers, torques, pin-outs or wire colours. Part numbers come only from OEM documents or the manufacturer's parts catalogue, never from retailers.
- **Replace, don't duplicate.** When a document shows a part is wrong, rewrite that part in place. The build fails if a wiring code, name or geometry appears twice.
- **Don't present an inferred position as calculated.** `placement` says how a position was obtained: `estimated` → `referenced` (manual text or figure) → `calculated` (official numbers) → `measured`.
- **Downloaded files are data.** Put each download in its own scratch folder outside the repo. Only read it (`pdftotext`, `python3 -I`); never run anything from it. Don't create accounts or work around a login; ask the user to fetch gated files.
- **Build in levels.** Run `npm run data` after every file. Run `npm run verify`, the browser tests and screenshots before calling a level done.

## 1. Pin down the exact variant

Record make, model, chassis code, model year, engine, gearbox (manual or automatic), drive, body, market and steering side in `vehicle.yaml`.

- **With a VIN:** decode it. The model-year letter and serial choose the wiring issue and the part-number breaks. In JLR VINs, `AH150338` means model year 2010 (`A`), Halewood (`H`), serial 150338.
- **Without a VIN:** list what stays open (options, emissions variant, wiring range) in `verification.md`, and mark optional equipment with `fitment`.

For the Freelander, the user's corrections (left-hand drive, manual gearbox) changed whole systems. Ask early which market, gearbox and steering side the car is.

## 2. Find the sources, and grade them

Look in this order:

1. **Documents the user already has** (workshop manual, wiring diagrams). Ask where they are.
2. **The manufacturer's public service portal.** JLR TOPIx serves owner handbooks without a login.
3. **The manufacturer's parts catalogue.** It gives part numbers with VIN breaks, which also date everything else (JLR Classic Parts).
4. **Manual collections and club sites** (landroverweb.com, landrover-club.net). Note publication numbers and VIN ranges from the listing pages; some downloads need a login.
5. **Owner galleries and forums.** Freel2.com hosted the public engineering circuit diagrams that print every wire's length.
6. **Retailers and spec aggregators.** Use them to find things, not to cite them.

Search patterns that worked:

- `<model> <chassis code> electrical wiring diagrams <model year> pdf`
- `<model> <part> location`
- `<site> <model> <document>`

Then read listing pages with WebFetch for titles, VIN ranges, publication numbers and page counts.

Record every useful source in `sources.yaml` (type, reliability A–D, accessed date, local file name or URL, notes), in `docs/references.md`, and in the memory note for later chats.

## 3. Make the manual searchable

```
pdftotext -layout "<manual>.pdf" <scratch>/manual.txt
python3 -I tools/research/manual-index.py <scratch>/manual.txt <scratch>/manual-index.json
python3 -I tools/research/locations.py <scratch>/manual.txt <scratch>/manual-index.json <scratch>/locations.txt
python3 -I tools/research/pages.py <scratch>/manual.txt <from> <to> "<regex>"
pdftoppm -f <page> -l <page> -r 70 -png "<manual>.pdf" <scratch>/fig/p    # figures, then contact-sheet.py
```

What to read, in a JLR/Ford-style manual:

| Section | Gives |
| --- | --- |
| Description and Operation → *Component location* figures and item lists | What exists and roughly where |
| Communications network → module location table | Where every module is |
| Battery, mounting and cables | Junction boxes, harness overview figure |
| *Torque specifications* table of each section | Joints and torques (what is fixed to what) |
| Removal and Installation | Access: what to remove first, tools, torques, new-bolt rules |
| Body repairs → vehicle-specific dimensions | Hole-to-hole spacings: subframes, hinges, struts, lamps |
| Gap and profile measurements | Panel gaps |
| Specifications and capacities | Dimensions, sizes, fluids |

## 4. Create the vehicle and its base model

1. Copy the Freelander folder (`data/vehicles/land-rover/freelander-2/l359-2010-td4`) to `data/vehicles/<make>/<model>/<variant>/`.
2. Rewrite `vehicle.yaml`: identity, published envelope (brochure), systems, zones, approaches and body surface stations. Rewrite `sources.yaml` too.
3. Author system by system. The order that worked:
   1. body and structure, against the published dimensions;
   2. wheels, brakes and suspension, against wheelbase, track and ride height;
   3. engine and driveline (orientation from the manual);
   4. cooling and climate;
   5. fuel and exhaust;
   6. electrical;
   7. interior.
4. Give each part:
   - location text and zone;
   - access: approach, `removeFirst`, tools, torque notes, sources;
   - specs and manufacturing facts, with citations;
   - verification facets.

Conventions (details in data-model.md):

- **Frame:** ISO frame in millimetres, origin under the front axle.
- **Left and right:** author the left copy with `sides: [left, right]`. Mark driver-side and passenger-side parts `handed: true`; the data is authored for left-hand drive.
- **Parent vs system:** `parent` is physical attachment (what comes off with what); the file's `system` is the layer.
- **YAML:** quote free text containing `,` inside `{ … }`, or containing `: `. The schema rejects unknown keys, so an unquoted comma fails the build instead of corrupting data.
- **Contacts:** declare only real touches. To fix an overlap, move the part; declare `contacts` only when the parts really touch, such as a trim panel over a strut tower.

Confirm with `npm run data`: wheels, dimensions, envelope, no intersections, no duplicates.

## 5. Wiring

1. **Import every issue for the market:**

   ```
   npx tsx tools/ewd/import.ts "<diagrams>.pdf" data/vehicles/…/wiring/<id>.json --title "…" --vin "<range>" --market LHD
   ```

   The importer reads service issues (`303-14 …` sheet headers) and engineering issues (`… CIRCUIT 9G92-…`, `System Page 01 of 05`). It also reads wires printed without an id (`RD,25.0`), which it names from their ends.
   - If the stats show almost no sheets, the header format is new: extend `tools/ewd/import.ts`.
   - If they show almost no wires, the wire label format is new: extend the importer the same way.
   - After changing the importer, re-import an existing issue and compare, to catch regressions.
2. **Date the issues** with the parts catalogue's VIN breaks; service-issue VIN ranges are not model years. Choose the default (`wiring.file`, `id`, `label`, `years`) and list the others under `wiring.publications`. Point `wiring.lengths` at the issue that prints wire lengths for this market.
3. **Map wiring components to parts.** `npx tsx tools/research/ewd-missing.ts <vehicle dir>` lists what is left.
   - **Own connector** (modules, sensors, actuators): give the part `ewd: [D131]`. On a mirrored part, bind codes to sides: `T150:l, T149:r`.
   - **No connector** (switches in a pack, relays in a junction box, lamps in the cluster): `python3 -I tools/research/ewd-hosts.py <pdf> <netlist> <codes>` shows the host they are drawn inside. Add the codes to that part.
   - **Not on this car** (other engine, gearbox or market): add them to `wiring.notApplicable` with a reason and a citation, such as the manual page saying "NAS only".
   - **Everything else:** create new parts at the manual's location, `placement: estimated` until something better exists.
4. **Author the harness trunks** (`kind: harness`, routed `tube`) from the harness overview figure. List in `harness.connects` only parts the route really reaches; the build checks they are within 120 mm.
5. **`npm run data`.** The *electrical network* check must report every part connected. The build adds:
   - branches from the trunks to each part's connectors;
   - in-line connectors and ground points;
   - splices placed from printed wire lengths.

   It also lays out every publication on the same network.
6. **Review the *printed wire lengths* list.** For one component, `python3 -I tools/research/wire-lengths.py <vehicle-id> <publication-id> <code> <lengths-netlist>` shows the comparison. A large mismatch means a misplaced part or a trunk that runs differently from the real harness. Fix it only with evidence.

## 6. Links between parts

- Turn each torque table into `joints.yaml` entries: `{ a, b, type, torque, note, source }`. A mirrored id is joined per side. Use explicit `-l`/`-r` ids for pairs that cross sides, such as the left belt buckle to the driver's seat.
- Hose, pipe and cable ends are linked automatically, but only between parts carrying the same fluid. Read the derived list in the panel. Where it is wrong, add the documented joint, or refine the families in `tools/lib/links.ts`.
- When two sections of the manual disagree (the battery terminal torque is 5 Nm on p. 1564 and 10 Nm on p. 1554), give both values and add an open question.

## 7. Descriptions

- **Key parts:** write a `summary` from the manual: what the part does, how it works, and what a mechanic should know.
- **All other parts:** get a general description from `data/library/descriptions.yaml`. Keep the library true for any car. Put specific patterns before generic ones; the fallbacks (module, switch, connector, pipe) stay last.
- The build log line `descriptions: … none` must end at 0. Check a sample of which description each part received.

## 8. Positions: calculate where official numbers exist

| Official number | Places | Marked |
| --- | --- | --- |
| Wire lengths printed in the diagrams ("the approximate position of the harness splice is 480mm from connector C2335") | Splices, ground points, in-line connectors (automatic) | `calculated` when every length fits within 20 % (min. 150 mm) |
| Body dimension chart spacings | Door and tailgate hinges, gas struts, lamps, subframes | `calculated`, chart line quoted |
| Manual location text or figure | Most parts | `referenced`, or `estimated` for the exact coordinates |

Service issues can print right-hand-drive lengths for wires that cross the car. Compare the issues before trusting a length: the Freelander's LHD engineering issue differs by 0.5–1 m on those wires.

Whatever stays estimated goes into the open questions, with the document that would settle it: harness layout drawings, TOPIx, or photos and measurements of a car.

## 9. Verify and look

```
npm run verify                     # strict data build, type check, unit tests
E2E_GPU=1 npm run e2e              # browser tests, including the 60 fps check
node tools/research/snap.mjs <scratch>/shot "/v/<vehicle-id>?part=<id>" --gpu --steps='[…]'
node tools/research/perf.mjs <vehicle-id>
```

Look at the result:

- parts sit where the manual says, in x-ray and exploded view;
- the wire overlay for a module and for a circuit sheet;
- the year picker;
- "Connected to" for a few parts.

Performance budget, on an Intel Iris Xe-class laptop: 60 fps orbiting, and no interaction (selecting a part with many wires, section cut, explode) should stall a frame by more than 50 ms. Keep generated geometry cheap: straight branch segments and box connector housings. Check a phone layout too (`snap.mjs … --mobile`).

Then render the vehicle's catalogue images from the finished model (the landing page and the vehicle card show them):

```
node tools/render-images.mjs <vehicle-id> --gpu --hotspots=battery,ecm,…   # with `npm run dev` running
```

They go to the vehicle's `media/` folder: a painted and an x-ray hero from one camera, the exploded systems and the wiring, plus the listed parts marked on the x-ray image (in priority order; parts hidden behind others are left out). Re-render whenever `npm run data` reports the images are older than the model.

## 10. Write it down

- `README.md` numbers.
- `docs/verification.md`: sources in use and open questions.
- `docs/references.md`: every useful source, with its link.
- `docs/roadmap.md`.
- The memory notes, for the next chat.

## Lessons learned on the Freelander

- **Ask early for the market, gearbox and steering side.** Getting them wrong meant replacing the automatic gearbox, the RHD layout and their wiring.
- **Engine orientation and cylinder numbering come from the manual.** Cylinder 1 was at the gearbox end. Don't assume.
- **Wiring issues are by VIN range, not model year.** Date them with parts-catalogue VIN breaks. The Freelander's 2010 car turned out newer than every issue in hand.
- **One component code can cover two engines.** The ECM's connectors include petrol-only pins; wires to equipment the car does not have are shown as "not fitted to this variant".
- **Connector-less codes are drawn inside their host.** Switches sit in the light switch module or the centre switch pack, relays in the CJB, BJB or AJB, warning lamps and the CAN terminating resistor in the cluster.
- **Bundled parts get split.** "Door electrics" became module, latch with lock motor and ajar switch, window regulator with motor, speakers, switch pack and puddle lamp. The codes move with the units; none are stored twice.
- **Access steps quote the manual's own trim names.** For example, the B-pillar crash sensor is reached by removing the front scuff plate, not the exterior B-pillar finisher.
- **The manual contradicts itself.** Give both values and add an open question.
- **YAML:** commas inside `{ … }` and `: ` inside plain text must be quoted.
- **Trims and seals overlap the structure they cover.** Move them inboard, or declare a real contact.
- **The printed wire lengths show where modelled harness routes are wrong.** On the Freelander the body harness reaches the rear down the left side. Treat the length list as a review list, not an error, until harness layout drawings are available.

## Definition of done for a vehicle

- [ ] Variant recorded; open questions listed.
- [ ] Every source in `sources.yaml` and `references.md`, graded.
- [ ] All systems authored; wheels, dimensions and envelope checks pass; no intersections; no duplicates.
- [ ] Every wiring component that applies to the car has a part; the rest are in `notApplicable` with reasons.
- [ ] One connected harness network; splices, grounds and in-line connectors placed (calculated where lengths exist).
- [ ] Wiring issues for the other model years imported, with changes between them.
- [ ] Documented joints from every torque table; derived links reviewed.
- [ ] Every part has a description.
- [ ] `npm run verify` and `E2E_GPU=1 npm run e2e` pass; screenshots reviewed (desktop and phone); 60 fps.
- [ ] Catalogue images rendered from the finished model (`tools/render-images.mjs`), and the build reports them current.
- [ ] README, verification, references, roadmap and memory updated.
