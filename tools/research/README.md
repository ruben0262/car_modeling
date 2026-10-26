# Research tools

Helpers for turning OEM documents into vehicle data. They only read the documents; nothing here is
part of the data build. Keep downloaded PDFs and text dumps outside the repo (a scratch folder), one
folder per download, and run Python with `-I`.

| Tool | Use |
| --- | --- |
| `manual-index.py` | Index a workshop-manual text dump (`pdftotext -layout`) into documents: title, kind, PDF page range |
| `pages.py` | Print a page range, optionally only the lines matching a regex (`"located\|mounted\|Nm"`) |
| `locations.py` | Every "is located / mounted / installed …" sentence and every component-location table, by page |
| `contact-sheet.py` | Tile rendered pages (`pdftoppm -png`) to read location figures (needs Pillow) |
| `ewd-hosts.py` | For wiring codes without a connector, the components drawn next to them (their host) |
| `ewd-missing.ts` | Wiring-diagram components that apply to the vehicle but have no 3D part yet |
| `wire-lengths.py` | One component's wires: printed length vs modelled route (after `npm run data`) |
| `snap.mjs` | Screenshots of the running viewer, with scripted steps (`window.__store`, `window.__viewer`); `--mobile` shoots a phone |
| `perf.mjs` | Frame rate while orbiting and exploding, on a real GPU |

The wiring importer itself is `tools/ewd/import.ts`. The whole process is in
[docs/adding-a-vehicle.md](../../docs/adding-a-vehicle.md).
