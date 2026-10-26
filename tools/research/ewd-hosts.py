"""Find where connector-less wiring-diagram components live.

A component printed without its own connector (a switch inside a switch pack, a relay inside a
junction box, a warning lamp inside the cluster) is drawn inside the outline of its host. This
lists, for each code, the nearest labelled components on every sheet it appears on, and the pins
printed around it -- the host is usually the nearest code whose connector those pins belong to.

    python3 -I tools/research/ewd-hosts.py "<diagrams>.pdf" data/vehicles/.../wiring/<netlist>.json S100,S109,R127
"""
import json
import re
import subprocess
import sys

pdf, netlist, targets = sys.argv[1], sys.argv[2], set(sys.argv[3].split(","))
xml = subprocess.run(["pdftotext", "-bbox", pdf, "-"], capture_output=True, text=True, errors="replace").stdout
ewd = json.load(open(netlist))
W = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
CODE = re.compile(r"^\(([A-Z]\d{3})\)$")
for pi, chunk in enumerate(xml.split("<page ")[1:]):
    words = [(float(a), float(b), float(c), float(d), t) for a, b, c, d, t in W.findall(chunk)]
    codes = [(w, CODE.match(w[4]).group(1)) for w in words if CODE.match(w[4])]
    for w, c in codes:
        if c not in targets:
            continue
        cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        near = sorted((((cx - (o[0] + o[2]) / 2) ** 2 + (cy - (o[1] + o[3]) / 2) ** 2) ** 0.5, c2) for o, c2 in codes if c2 != c)
        pins = sorted({x[4] for x in words if re.match(r"^C\d[A-Z0-9]{1,8}-\d", x[4]) and abs((x[0] + x[2]) / 2 - cx) < 90 and abs((x[1] + x[3]) / 2 - cy) < 60})
        header = " ".join(x[4] for x in sorted(words, key=lambda q: (q[1], q[0]))[:6])
        named = ", ".join(f"{c2}({ewd['components'].get(c2, {}).get('name', '?')[:28]}) {d:.0f}" for d, c2 in near[:4])
        print(f"{c} p{pi + 1} [{header[:50]}] near: {named} | pins {' '.join(pins[:6])}")
