# Vehicle Atlas

An interactive 3D anatomy atlas for real vehicles, built for mechanics and students. You can take a car apart system by system, down to individual parts, connectors and harnesses. Each part shows where it sits and how to reach it, and **how well each fact has been verified**.

Vehicles so far:

- **Land Rover Freelander 2 (L359), 2010 model year, 2.2 TD4 diesel, 6-speed manual, left-hand drive (EU)**, built from the official workshop manual and wiring diagrams.
- **Ford Galaxy Mk1 (WGR), 1998, 1.9 TDI 66 kW (VW engine AHU), 5-speed manual, left-hand drive (EU)**, built from Volkswagen's official documents for its sister car, the VW Sharan (workshop manuals, current flow diagrams, fitting locations, self-study programmes); the Ford-styled parts are marked estimated.

For any part you can see:

- where it is and how to reach it;
- what it is joined to, with the manual's torque and page;
- its connectors and pin-outs, and every wire drawn in 3D in its real colours along the harness to the parts at the other end, for each model year of the wiring diagrams;
- how well each fact is verified.

It works on desktops, tablets and phones (on a phone the part panel is a bottom sheet you drag up over the model).

```
npm install
npm run dev          # builds the vehicle data, then serves http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run data` | Compile `data/vehicles/**` (YAML) into `public/data` (GLB chunks + manifests) and print the automated checks |
| `npm run data:strict` | Same, but fail on any automated-check error |
| `npm run verify` | Strict data build, type-check and unit tests — run before every commit |
| `npm run build` | Verify, type-check and produce the production site in `dist/` |
| `npm run e2e` | Browser tests against the production build (`E2E_GPU=1` adds the frame-rate check) |
| `npx tsx tools/ewd/import-vw.ts <pdf> <out.json> --diagrams 1,2,14 --title …` | Import VW-format current flow diagrams (the Galaxy's wiring) |
| `node tools/render-images.mjs <vehicle-id> --gpu` | Re-render a vehicle's landing-page images from its 3D model (with `npm run dev` running) |
| `docker compose up -d --build` | Build and serve the site in a container — see [Deploy](#deploy-with-docker) |

## How it is put together

```
data/vehicles/<make>/<model>/<variant>/   ← source of truth, edited by curators
  vehicle.yaml      identity, published dimensions, systems (layers), zones, access approaches, body surface
  sources.yaml      every reference cited, with type and reliability grade
  joints.yaml       documented joins between parts (type, torque, manual page)
  <system>.yaml     components: placement, geometry, location, access, specs, faults, connectors, verification
  wiring/           netlist imported from the OEM wiring diagrams
  media/            landing-page images rendered from the model (tools/render-images.mjs), with the parts they mark
data/library/descriptions.yaml   general part descriptions shared by every vehicle
tools/              data build: validate → generate geometry → wire the harness network → link parts → automated checks → GLB + manifest
  geometry/         parametric part generators (tyre, caliper, turbo, strut, harness, body panels…)
src/shared/         contracts used by both the build and the site (frames, manifest, verification, search)
src/viewer/         three.js engine: loading, explode/break-down, picking, materials, camera
src/app/            React UI: vehicle search, viewer chrome, part details, verification report
tests/              unit tests (vitest) and browser tests (Playwright)
tools/ewd/          wiring-diagram importer (service and engineering issues)
tools/research/     helpers for reading manuals and wiring diagrams (see its README)
```

The viewer never reads YAML. The build turns each vehicle into:

- **one compressed GLB per system** (meshopt-encoded, content-hashed file names, cacheable forever), loaded in parallel;
- **one GLB per detail assembly** (e.g. a brake caliper or the turbocharger). The main file only carries a merged proxy, and the full breakdown loads when someone drills in;
- a **manifest** with the component tree, facts, sources, verification facets, explode vectors and check results.

That split is what keeps loading fast as detail grows: the first view is paid for once, and deeper levels are paid for only by the people who open them.

## Current numbers (Freelander 2, measured on an Intel Iris Xe laptop GPU)

| | |
| --- | --- |
| Components | 805 nodes · 506 parts · 170 harnesses, hoses, pipes and cables; every wiring-diagram component that applies to this car placed in 3D (368 of 368; 26 more are for other engines, gearboxes or markets) |
| Wiring | four issues of the LHD diagrams (2007 to 2009 model years), switchable in the viewer with what changed between them; one harness network with 109 generated branches, 31 in-line connectors and 22 ground points; 121 splice, ground and in-line connector positions calculated from the wire lengths the diagrams print; 865 of the 874 wires between fitted parts drawable in 3D (≈80 KB gzipped per issue, loaded on demand) |
| Links | 195 documented joints (type, torque, manual page) plus 58 hose, pipe and cable ends linked from the model |
| Descriptions | every part: 391 written for this car, 403 general descriptions from the shared library |
| Geometry | 550k triangles, 4.3 MB for the whole car (≈1.7 MB gzipped); 8 on-demand detail chunks |
| Rendering | 60 fps orbiting and exploding; renders only when something changes; no interaction (selecting a part with a hundred wires, section cut, explode) stalls a frame by more than 50 ms |
| Data build | ≈4 s including exact triangle-level interference checks |

## Current numbers (Ford Galaxy 1998 1.9 TDI, same GPU)

| | |
| --- | --- |
| Components | 721 nodes · 430 parts · 160 harnesses, hoses, pipes and cables; every wiring-diagram component that applies to this car placed in 3D (329 of 329; 9 more are for other engines, the automatic gearbox, Climatronic or EDS) |
| Wiring | five VW wiring sets by build date (1997 model year to cars built from November 1998), switchable in the viewer; one harness network with 101 generated branches and 44 in-line connector pairs; 886 of the 946 wires between fitted parts drawable in 3D. The VW diagrams print no wire lengths, so splice and connector positions are estimated |
| Links | 115 documented joints (type, torque, source page) plus 56 hose, pipe and cable ends linked from the model |
| Descriptions | every part: 381 written for this car, 329 general descriptions from the shared library |
| Geometry | 464k triangles, 3.7 MB for the whole car (≈1.5 MB gzipped); 8 on-demand detail chunks |
| Rendering | 60 fps orbiting and exploding (p95 frame 16.8 ms); ready in ≈1.2 s |

## Deploy with Docker

The image builds the data and the site with the same strict checks and unit tests as `npm run verify` (a failing check stops the build), then serves the static files with [Caddy](https://caddyserver.com/): Brotli and gzip compressed in advance, content-hashed files (scripts, geometry, wiring, images) cached for a year, and `index.html`, the catalogue and the manifests revalidated on each visit.

```
docker compose up -d --build                    # http://<server>:8080

# a domain pointing at the server: HTTPS with an automatic certificate
SITE_ADDRESS=atlas.example.com HTTP_PORT=80 HTTPS_PORT=443 docker compose up -d --build
```

Without compose: `docker build -t vehicle-atlas .`, then `docker run -d -p 8080:80 vehicle-atlas`.

- **Behind a reverse proxy or CDN** (nginx, Traefik, Cloudflare): keep the default `SITE_ADDRESS=:80` and point the proxy at the container's port 80.
- **Updating:** rebuild with the same command. Visitors pick up the new version on their next visit; unchanged geometry stays in their cache.
- **Private while not public:** add `basic_auth { atlas <hash> }` inside the site block of [deploy/Caddyfile](deploy/Caddyfile), with a hash from `docker run --rm caddy:2.11-alpine caddy hash-password --plaintext '<password>'`.

> **Before the site goes public:** it serves the wiring netlists extracted from Land Rover's wiring diagrams and quotes from the workshop manual. Republishing those may need the manufacturer's permission (see CLAUDE.md); check first, or keep the site private.

## Verification first

Each component carries three independent facets: **geometry**, **placement** and **facts**. Each has a level, cited sources and named reviews. Nothing is verified by default, and the UI always shows the status.

Every data build also runs automated checks:

- wheelbase and track, published body extents, vehicle envelope;
- exact interference between assemblies;
- connector mating, and harness routes reaching what they claim to connect;
- **duplicate components**: the same wiring code, name or geometry stored twice;
- wiring-diagram cross-references, and that every electrical part is wired into one harness network. See [docs/verification.md](docs/verification.md), including the list of open questions for this vehicle.

More detail: [docs/adding-a-vehicle.md](docs/adding-a-vehicle.md) (the process for the next vehicle) · [docs/data-model.md](docs/data-model.md) · [docs/verification.md](docs/verification.md) · [docs/references.md](docs/references.md) (every source, with links) · [docs/roadmap.md](docs/roadmap.md)

> **Status:** facts, locations and wiring now come from the official Land Rover documents, cited by page. Shapes are still simplified (parametric) except where dimensions were checked against the manual, and no part has had a reviewer's sign-off yet. It is not a substitute for the workshop manual.
