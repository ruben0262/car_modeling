"""Index a workshop-manual text dump: one entry per TOPIx document (title, kind, page range).

    pdftotext -layout "<manual>.pdf" manual.txt
    python3 -I tools/research/manual-index.py manual.txt manual-index.json

Pages are split on form feeds, so page N here is PDF page N (the locator the data cites).
A TOPIx print starts every document with a "Published:" line, then the title, then the kind
("Description and Operation", "Removal and Installation", "Specifications", ...).
"""
import json
import sys

pages = open(sys.argv[1], encoding="utf-8", errors="replace").read().split("\f")
KINDS = ("Description and Operation", "Removal and Installation", "Specifications", "Diagnosis and Testing",
         "General Procedures", "Disassembly and Assembly", "Installation", "Removal", "Overhaul",
         "Component Location", "Torque Specifications", "General Specifications")
docs = []
for i, p in enumerate(pages):
    lines = [l.strip() for l in p.split("\n") if l.strip()]
    head = [j for j, l in enumerate(lines[:4]) if l.startswith("Published:")]
    if not head:
        continue
    k = head[0]
    title = lines[k + 1] if k + 1 < len(lines) else ""
    kind = lines[k + 2] if k + 2 < len(lines) else ""
    if not any(kind.startswith(t) for t in KINDS) and k + 3 < len(lines) and any(lines[k + 3].startswith(t) for t in KINDS):
        title, kind = title + " " + kind, lines[k + 3]  # wrapped title
    docs.append({"page": i + 1, "title": title, "kind": kind})
for d, n in zip(docs, docs[1:] + [{"page": len(pages) + 1}]):
    d["end"] = n["page"] - 1
json.dump(docs, open(sys.argv[2], "w"), indent=0)
print(len(docs), "documents")
systems = {}
for d in docs:
    systems[d["title"].split(" - ")[0]] = systems.get(d["title"].split(" - ")[0], 0) + 1
for s, n in sorted(systems.items(), key=lambda x: -x[1])[:40]:
    print(f"{n:4d}  {s}")
