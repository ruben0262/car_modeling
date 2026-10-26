"""Compare printed wire lengths with modelled routes for one wiring-diagram component.

Run after `npm run data`. Reads the published wiring file (netlist + harness graph) and, for every
wire from the component to another component's pin, prints the printed length, the length of the
modelled route along the harness graph, and the difference -- a quick way to see whether a part
(or the harness trunk it hangs on) is in the wrong place.

    python3 -I tools/research/wire-lengths.py <vehicle-id> <publication-id> <component-code> [lengths-netlist.json]
    python3 -I tools/research/wire-lengths.py land-rover-freelander-2-l359-2010-td4 lhd-080379 D316 \
        data/vehicles/land-rover/freelander-2/l359-2010-td4/wiring/ewd-lhd-09my-engineering.json
"""
import glob
import heapq
import json
import math
import sys

vid, pub, comp = sys.argv[1:4]
d = json.load(open(glob.glob(f"public/data/vehicles/{vid}/wiring-{pub}.*.json")[0]))
eng = {w["id"]: w for w in json.load(open(sys.argv[4]))["wires"]} if len(sys.argv) > 4 else {}
L = d["layout"]
V = L["v"]
n = len(V) // 3
adj = [[] for _ in range(n)]
for i in range(0, len(L["e"]), 2):
    a, b = L["e"][i], L["e"][i + 1]
    w = math.dist(V[3 * a:3 * a + 3], V[3 * b:3 * b + 3]) * 1000
    adj[a].append((b, w))
    adj[b].append((a, w))


def dijkstra(s):
    dist = [math.inf] * n
    dist[s] = 0
    h = [(0, s)]
    while h:
        du, u = heapq.heappop(h)
        if du > dist[u]:
            continue
        for v, w in adj[u]:
            if du + w < dist[v]:
                dist[v] = du + w
                heapq.heappush(h, (dist[v], v))
    return dist


conns = d["components"][comp]["connectors"]
cache = {}
rows = []
for w in d["wires"]:
    if len(w["ends"]) != 2:
        continue
    mine = [x for x in w["ends"] if x.rsplit("-", 1)[0] in conns]
    other = [x for x in w["ends"] if x not in mine]
    if not mine or not other:
        continue
    o = other[0]
    oc = o.rsplit("-", 1)[0]
    if o[0] in "SG" or oc not in L["connectors"] or not d["connectors"].get(oc, {}).get("component"):
        continue
    e = eng.get(w["id"])
    length = (e and sorted(e["ends"]) == sorted(w["ends"]) and e.get("length")) or w.get("length")
    if not length:
        continue
    a = L["connectors"][mine[0].rsplit("-", 1)[0]]["v"]
    b = L["connectors"][oc]["v"]
    if a not in cache:
        cache[a] = dijkstra(a)
    target = d["connectors"][oc]["component"]
    rows.append((target, d["components"][target]["name"][:34], length, round(cache[a][b])))
rows.sort(key=lambda r: r[2] - r[3])
for r in rows:
    print(f"{r[0]} {r[1]:34s} printed {r[2]:5d}  model {r[3]:5d}  diff {r[2] - r[3]:+6d}")
