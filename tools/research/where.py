"""Where built parts sit, in the vehicle frame (mm: +X forward, +Y left, +Z up). Run after `npm run data`.

    python3 -I tools/research/where.py <vehicle-id>                              # every leaf part
    python3 -I tools/research/where.py <vehicle-id> --system cooling             # one system
    python3 -I tools/research/where.py <vehicle-id> --id battery                 # ids containing a string
    python3 -I tools/research/where.py <vehicle-id> --box -300 300 -700 0 400 1000   # parts overlapping x0 x1 y0 y1 z0 z1
"""
import json
import sys

args = sys.argv[1:]
if not args or args[0].startswith("--"):
    sys.exit(__doc__)
m = json.load(open(f"public/data/vehicles/{args[0]}/manifest.json"))
opt = lambda k: args[args.index(k) + 1] if k in args else None
system, sub = opt("--system"), opt("--id")
box = [float(v) for v in args[args.index("--box") + 1 : args.index("--box") + 7]] if "--box" in args else None
for n in m["nodes"]:
    b = n.get("bounds")
    if not b or n.get("children"):
        continue
    # manifest bounds are three.js metres: three = (iso.y, iso.z, iso.x) / 1000
    lo = [b["min"][2] * 1000, b["min"][0] * 1000, b["min"][1] * 1000]
    hi = [b["max"][2] * 1000, b["max"][0] * 1000, b["max"][1] * 1000]
    if (system and n["system"] != system) or (sub and sub not in n["id"]):
        continue
    if box and not all(lo[i] <= box[2 * i + 1] and hi[i] >= box[2 * i] for i in range(3)):
        continue
    print(f"{n['id']:40s} {n['system']:12s} x {lo[0]:6.0f}..{hi[0]:6.0f}  y {lo[1]:6.0f}..{hi[1]:6.0f}  z {lo[2]:6.0f}..{hi[2]:6.0f}")
