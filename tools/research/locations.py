"""Collect component tables and location sentences from every Description and Operation document.

    python3 -I tools/research/locations.py manual.txt manual-index.json locations.txt [skip-regex]

Output, per document: the numbered component list of its location figure ("ITEMS: 1 - ... | 2 - ...")
and every sentence saying where something is located/mounted/installed, with its PDF page.
The optional skip regex drops documents for other engines (default: petrol i6 sections).
"""
import json
import re
import sys

pages = open(sys.argv[1], encoding="utf-8", errors="replace").read().split("\f")
docs = json.load(open(sys.argv[2]))
skip = re.compile(sys.argv[4] if len(sys.argv) > 4 else r"I6 3\.2L|Petrol|Body Repairs|Sheet Metal|Maintenance Schedules|About This Manual|Jacking")
LOC = re.compile(r"\b(is|are) (located|mounted|installed|fitted|positioned|attached|secured|situated)\b|\blocated (in|on|at|behind|below|beneath|under|above|between|adjacent)", re.I)
out = []
for d in docs:
    if not d["kind"].startswith("Description") or skip.search(d["title"]):
        continue
    text = []
    for n in range(d["page"], d["end"] + 1):
        for l in pages[n - 1].split("\n"):
            l = " ".join(l.split())
            if l and not re.match(r"^(http://topix|\d+ of \d+ \d\d/|Published:)", l):
                text.append((n, l))
    out.append(f"\n##### {d['title']}  [pp. {d['page']}-{d['end']}]")
    items = [l for _, l in text if re.match(r"^\d{1,2} - \S", l)]
    if items:
        out.append("ITEMS: " + " | ".join(items[:80]))
    joined = " ".join(l for _, l in text)
    for m in re.finditer(r"[^.]*?(?:" + LOC.pattern + r")[^.]*\.", joined, re.I):
        s = m.group(0).strip()
        if 20 < len(s) < 400:
            pg = next((n for n, l in text if s[:25] in l), d["page"])
            out.append(f"  p{pg}: {s}")
open(sys.argv[3], "w").write("\n".join(out))
print(len(out), "lines")
