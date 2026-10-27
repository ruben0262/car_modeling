# References

Every document and web page that turned out to be useful, per vehicle, what it is good for, and how to get it. Parts cite these through each vehicle's `sources.yaml` (by id); this page is the reading list behind them. The Freelander 2 (L359) comes first; the Ford Galaxy 1998 1.9 TDI is [further down](#ford-galaxy-wgr-1998-19-tdi).

Reliability grades follow [verification.md](verification.md): **A** OEM document, **B** faithful copy or reputable specialist, **C** aggregator or retailer, **D** forum.

## Official documents in hand (local copies)

| Document | Where | Good for |
| --- | --- | --- |
| Workshop manual 2007–2011 (JLR TOPIx procedures, printed Oct 2011), 2,444 pages — `wsm`, A | `~/Downloads/LAND-ROVER-FREELANDER-2007-2011-WORKSHOP-MANUAL/FREELANDER 2007 - 2011 WORKSHOP MANUAL.pdf` | Component descriptions and location figures, removal procedures, torque tables (pp. 52, 83, 127, 150, 165, 213, 232, 258, 270, 303, 318, 326, 360, 389, 574–575, 755, 824, 877, 1136, 1258, 1304, 1554, 1566, 2419), body dimension chart (pp. 2250–2256), module locations (p. 1800), harness overview (p. 1555) |
| Electrical Wiring Diagrams, LHD, VIN serials 000201–057871, 057872–080378, 080379–113896 — `ewd`, A | `~/Downloads/LAND-ROVER-FREELANDER-2007-2011-WORKSHOP-MANUAL/WIRING DIAGARAMS 2007 - 2011 Freelander/LHD VEHICLES/` (RHD sets alongside) | Netlists: components, connectors, pins, wire colours, cross-sections, option codes, fuses, splices, grounds. Imported with `tools/ewd/import.ts` |
| JLR Engineering Electrical Circuit Diagrams, L359 09MY LHD, Job1 Issue 2 (9 July 2008) — `ewd-09my-engineering`, A | Public download: <https://www.freel2.com/gallery/albums/userpics/10793/L359-09MY_JOB1_CIRCUITS_LHD.pdf> (album page <https://www.freel2.com/gallery/displayimage.php?album=255&pos=2>) | The same circuits in engineering form **with the length of almost every wire (mm)**. The lengths are what positions of splices, in-line connectors, ground points and loosely located parts are calculated from |
| Owner's handbook LRL 10 02 56 131 — `handbook`, A | <https://topix.landrover.jlrext.com/topix/service/document/217254> (public on JLR TOPIx) | Capacities, fluids, fuse tables |
| Brochure, 2011 model year — `brochure-my2011`, A | Linked from <https://www.landroverweb.com/landrover/pdf-land-rover-manuals-part-catalogue/> | Published dimensions, gear ratios, brake sizes |

## Official sources online

| Source | URL | Good for |
| --- | --- | --- |
| JLR Classic parts catalogue — Freelander 2 2006–2014 (L359), Airbag System — `jlr-parts-airbag`, A | <https://parts.jaguarlandroverclassic.com/parts/index/part/id/5.51478.51549.35906/brand/land-rover/> | Part numbers with VIN breaks. The breaks also date the wiring sets: `9H119277` is model year 2009 and `AH150338` model year 2010 (format: model-year letter, plant `H` = Halewood, six-digit serial) |
| JLR TOPIx | <https://topix.landrover.jlrext.com/> | Official route to the 2010–2011 wiring diagrams and current procedures (subscription) |
| landroverweb.com manuals list (the starting point) | <https://www.landroverweb.com/landrover/pdf-land-rover-manuals-part-catalogue/> | Brochures and manuals for many models |

### Wiring diagram publications known to exist

| Publication | VIN / model year | Where | Status |
| --- | --- | --- | --- |
| LRL 21 38 56 701, November 2006 | VIN 001002 onwards (launch, MY2007) | <https://en.landrover-club.net/manual_download.php?id=1225> | not imported |
| TOPIx LHD sets | serials 000201–057871 (MY2007–08), 057872–080378 (MY2008), 080379–113896 (MY2008–09) | local (from the zip at <https://en.landrover-club.net/manual_download.php?id=903>) | imported, switchable by year |
| L359 09MY Job1 engineering circuits, LHD | MY2009 start of production | public, see above | imported; its wire lengths place splices, grounds and in-line connectors |
| **JLR 15 62 21_2E, LHD "1a"** | **VIN 216517 onwards** | <https://en.landrover-club.net/manual_download.php?id=1249> (login required) | **needed for later cars; not in hand** |
| 2013 LR2 wiring diagrams | MY2013–2014 | <https://en.landrover-club.net/manual_download.php?id=823> | not imported |
| L359 11MY electrical wiring diagram, 122 pages | MY2011 | <https://www.autorepairmanuals.ws/arm/threads/land-rover-freelander-2-l359-11my_lr2-electrical-wiring-diagram.38744/> (registration) | not in hand |

A 2010 model-year car falls between serial ~119300 (still MY2009 in the catalogue) and 216516: neither the TOPIx sets in hand nor the 216517 set covers it exactly. The importer reads both the TOPIx format (`303-14 …` section headers) and the engineering format (`… CIRCUIT 9G92-…` headers), so a new PDF is one command:

```
npx tsx tools/ewd/import.ts "<file>.pdf" data/vehicles/…/wiring/<id>.json --title "…" --vin "216517>" --market LHD
```

## Secondary sources (used only where the official documents are silent)

| Source | URL | Used for |
| --- | --- | --- |
| auto-data.net, 2.2 TD4 160 hp — C | <https://www.auto-data.net/en/land-rover-freelander-ii-2.2-td4-160hp-5177> | Body width excluding mirrors |
| Carfolio, Freelander 2 TD4 — C | <https://www.carfolio.com/land-rover-freelander-2-td4-143154> | Pre-facelift output and kerb weight |
| Land Rover Monthly, Haldex coupling — B | <https://www.landrovermonthly.co.uk/articles/freelander-2-haldex-coupling/> | Coupling fault symptoms |
| LRman.ru (Russian translation of the manual) — B | <https://www.lrman.ru/en/freelander/2/electrics/infotainment/description_and_operation_of_antenna> | Cross-checking manual text |
| Freel2.com — PTU drain thread — D | <https://www.freel2.com/forum/topic14659-90.html> | Owner-reported PTU failure modes |
| Freel2.com — sound system thread — D | <https://www.freel2.com/forum/post74683.html> | Amplifier in the RH rear corner (agrees with wsm p. 1594) |
| Freel2.com — handbook, manual and wiring thread — D | <https://www.freel2.com/forum/topic10621-30.html> | Pointers to documents |
| LandyZone — "Which aerial has my 2010 Freelander 2" — D | <https://www.landyzone.co.uk/land-rover/which-aerial-has-my-2010-freelander-2-2-2-td4-e-s-got.313638/> | DAB element in the LH rear quarter glass (agrees with wsm p. 1639) |
| FixYa — front airbag crash sensors — D | <https://www.fixya.com/cars/t25320381-front_airbag_crash_sensors_located> | Front impact sensors behind the bumper |

## Checked and not used

- Fuse-box sites (<https://fuse-box.info/land-rover/land-rover-freelander-2-lr2-l359-2006-2014-fuses>, <https://fusecheck.com/land-rover/land-rover-freelander-l359-2006-2015-fuse-diagram>): fuse numbers disagree between sites and model years; the handbook and wiring diagrams are used instead.
- Retailer listings (lrparts.net, e.g. <https://www.lrparts.net/ywl500050pvj-passenger-airbag-deactivation-switch-for-discovery-3-4-range-rover-sport-06-13-and-freelander-2.html>): useful for finding a part, but part numbers are only recorded from the JLR catalogue.

---

## Ford Galaxy (WGR) 1998 1.9 TDI

The Galaxy Mk1 was built by AutoEuropa alongside the VW Sharan (7M) and SEAT Alhambra and shares their platform, body structure, running gear, VW engines, the 006 gearbox and most of the electrics. Volkswagen's official Sharan documents are therefore the primary sources for the shared parts; Ford-styled parts (bumpers, grille, lamps, bonnet, wings, fascia, radio, badges) are not in them and are marked estimated.

### Official documents in hand (local copies)

All PDFs were downloaded by the owner from vwts.ru (index page <https://vwts.ru/vw_sharan_7m.html>) into `~/Downloads/vw_ford_parts_manuals/`; the binder scans into `~/Downloads/sharan_ffp/Sharan/`. Grade A.

| Document (id) | Link | Good for |
| --- | --- | --- |
| Current Flow Diagrams from 09.1997 with Fitting Locations, 745 pp. (`vw-wd-1997`) | <https://vwts.ru/vw/sharan/vw-sharan-1997-wd-eng.pdf> | 103 dated diagrams (one per engine / item of equipment, editions 09.1997–05.1999); fitting locations pp. 691–746. Imported with `tools/ewd/import-vw.ts` as four build-date sets |
| Current Flow Diagrams from 06.1995, 336 pp. (`vw-wd-1995`) | <https://vwts.ru/vw/sharan/vw-sharan-1995-wd-eng.pdf> | 53 diagrams for model years 1996–1997, incl. the 1Z/AHU engine (No. 10); imported as the 1997 model-year set |
| Current Flow Diagrams from 05.2000, 1,334 pp. (`vw-wd-2000`) | <https://vwts.ru/vw/sharan/vw-sharan-2000-wd-eng.pdf> | Facelift cars (no AHU); kept for the later Galaxy |
| Fitting-locations binder, 211 scans (`vw-fitting-locations-1997`) | <https://vwts.ru/vw_doc2/sharan_ffp.zip> | Relay plate / multi-function unit positions, fuses, connector locations. Stems `00056620…` are the pre-09.97 relay-plate book, `00056686…` the multi-function-unit book a 1998 car has |
| Body Repairs 1996 ➤, 120 pp. (`vw-body`) | <https://vwts.ru/vw/sharan/vw-sharan-1997-body-repairs-eng.pdf> | Body dimensions with hole-to-hole spacings (pp. 6–17), panel gaps, VIN location; the straightening-jig figures (pp. 21–27) are blank in this copy |
| Diesel direct injection and glow plug system (AFN, AHU, 1Z, AVG), 114 pp. (`vw-diesel`) | <https://vwts.ru/vw/sharan/vw-sharan-1996-diesel-direct-injection-eng.pdf> | Sharan installation of the injection system: fitting locations (pp. 45–48), pump, injectors, fuel filter, accelerator, senders, charge pressure and EGR checks, glow plugs, engine mounting at the timing end |
| Heating, air conditioning (`vw-heating`) | <https://vwts.ru/vw/sharan/vw-sharan-1996-heating-air-conditioning-eng.pdf> | Heater and A/C components and locations |
| Supplementary heating (`vw-aux-heating`) | <https://vwts.ru/vw/sharan/vw-sharan-1996-supplementary-heating-eng.pdf> | The TDI's fuel-fired auxiliary heater |
| 1.9 l diesel mechanics, Golf/Vento (`vw-engine-mech`) | <https://vwts.ru/engine/engine-aaz-aey-afn-1y-1z-ahu-ale-avg-mechanical-eng.pdf> | AHU engine data and engine-internal facts and torques only (written for the Golf installation) |
| AFN/AHH/AHU/AVG repair manual, Passat (`vw-engine-b5`) | <https://vwts.ru/engine/engine-afn-ahh-ahu-avg-repair-manual-eng.pdf> | Cross-check of engine-internal facts |
| Owner's manual booklet 3.2 (`vw-owner-tips`) | <https://vwts.ru/vw_doc2/vw_sharan.pdf> | A later Sharan's booklet: spare wheel, jack, wheel bolts — only what the first generation shares |
| Self-Study Programme 169 "Der VW Sharan" (`ssp-169`) | <https://www.volkspage.net/technik/ssp/ssp/SSP_169.PDF> | The best single overview: dimensions drawing (p. 8), engines, engine mounting (p. 20), running gear (pp. 24–31), brakes and ABS (pp. 32–38), fuel (p. 41), control units (p. 42), electrics (pp. 44–59), heating, A/C and the TDI auxiliary heater (pp. 60–67) |
| Self-Study Programme 170 "Schaltgetriebe 006" (`ssp-170`) | <https://www.volkspage.net/technik/ssp/ssp/SSP_170.PDF> | The 006 gearbox (a Ford gearbox adapted to the VW engines): ratios, final drive, cable shift, hydraulic clutch |
| Self-Study Programme 153 "1,9 l-TDI-Motor" (`ssp-153`) | <https://www.volkspage.net/technik/ssp/ssp/SSP_153.PDF> | The 1Z TDI with EDC (the AHU's predecessor) |

SSP index pages: <https://www.volkspage.net/technik/ssp/>. More VW diesel and gearbox manuals: <https://vwts.ru/diesel-engine-vw-audi-skoda-repair-manual.html>, <https://vwts.ru/transmission-vw-audi.html>.

### Secondary sources

| Source | Link | Used for |
| --- | --- | --- |
| Russian workshop book, chapters 8 (clutch, driveshafts), 9 (brakes), 10 (suspension, steering), 12 (body electrics) — `ru-manual`, B | From the vwts.ru Sharan page (local `shar_*_rus.pdf`) | Torques, wear limits and procedures for all three sister models; facts that rest on it alone are marked `secondary` |
| ADAC Autokatalog, Galaxy 1.9 TDI GLX and Ghia — `adac-galaxy-19tdi`, C | <https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/ford/galaxy/i/984954/>, <https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/ford/galaxy/i/984955/> | Galaxy-specific dimensions, weights, tyres and standard equipment |
| Wikipedia, Ford Galaxy — `wikipedia-galaxy`, D | <https://en.wikipedia.org/wiki/Ford_Galaxy> | Only what Ford changed on the shared platform (Ford fascia) |
| L'argus fiche technique, Galaxy I 1998 — C | <https://www.largus.fr/fiche-technique/Ford/Galaxy/I/1998/Monospace> | Looked at as a cross-check of the published dimensions; not cited |
| Parkers, Galaxy 1.9 TDI GLX — C | <https://www.parkers.co.uk/ford/galaxy/estate-1995/19-tdi-glx-> | UK trim levels; not cited |

### Would settle open questions (not in hand)

| Document | Where | Settles |
| --- | --- | --- |
| VW body dimension sheets `vw48a.tif`, `vw48y.tif` | <https://vwts.ru/body/size/vw48a.tif>, <https://vwts.ru/body/size/vw48y.tif> (download page with a countdown — to be fetched by hand) | Underbody measuring points, so the longitudinal members, subframe and axle mounts can be calculated instead of estimated |
| Haynes manual Ford Galaxy 1995–Aug 2000 (No. 3984) | Bookshops (e.g. <https://www.tmbbooks.com/en/autom_Fordrep27.html>) | Ford-specific parts: bumpers, lamps, fascia, radio, Ford torques and capacities |
| Ford Galaxy owner's handbook (1995–2000) | Ford / second-hand | Capacities, fuse chart and bulb table for the Ford version |
| Ford parts catalogue (Microcat / ETIS) | Ford dealer | Ford part numbers and equipment by VIN |

### Checked and not used

- Sites offering "free PDF" Galaxy, Sharan or Haynes manuals on unrelated domains (e.g. `ahecdata.utah.edu`, `db1.greenfirefarms.com`, `portal.goodeyes.com`, `tech.contify.com`, `autodiscover.bps.go.id`): not official and probably not genuine; not used.
- Fuse-box sites (<https://fuseandrelay.com/ford/galaxy.html>, <https://www.bolidenforum.de/portal/fuse-box/ford/galaxy/2004/>): later models or unsourced; the VW fitting locations are used instead.
- Retailer listings (manomano, mall.hr and similar): only confirm that parts are shared between Sharan, Alhambra and Galaxy; no part numbers are taken from them.
