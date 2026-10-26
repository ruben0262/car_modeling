"""Print manual pages compactly, optionally only the lines matching a regex.

    python3 -I tools/research/pages.py manual.txt 2196 2212 "located|mounted|Nm"
"""
import re
import sys

pages = open(sys.argv[1], encoding="utf-8", errors="replace").read().split("\f")
a, b = int(sys.argv[2]), int(sys.argv[3])
pat = re.compile(sys.argv[4], re.I) if len(sys.argv) > 4 else None
NOISE = re.compile(r"^(http://topix|\d+ of \d+\s+\d\d/\d\d/\d{4}|Published:)")
for n in range(a, b + 1):
    lines = [" ".join(l.split()) for l in pages[n - 1].split("\n")]
    lines = [l for l in lines if l and not NOISE.match(l)]
    if pat:
        lines = [l for l in lines if pat.search(l)]
        if not lines:
            continue
    print(f"--- p{n}")
    print("\n".join(lines))
