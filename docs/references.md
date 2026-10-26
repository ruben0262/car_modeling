# References

Every document and web page that turned out to be useful for the Freelander 2 (L359), what it is good for, and how to get it. Parts cite these through `sources.yaml` (by id); this page is the reading list behind them.

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
