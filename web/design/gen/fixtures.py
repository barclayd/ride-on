# Adds EU-DEM elevation to the simplified loops and emits API-shaped fixtures (docs/api.md) as a JS file.
import json, sys, time, urllib.request, uuid

RAW, OUT = sys.argv[1], sys.argv[2]
routes = json.load(open(RAW))

def elevations(pts):
  out = []
  for i in range(0, len(pts), 100):
    chunk = pts[i:i + 100]
    locs = "|".join(f"{a:.5f},{b:.5f}" for a, b in chunk)
    for k in range(5):
      try:
        with urllib.request.urlopen(f"https://api.opentopodata.org/v1/eudem25m?locations={locs}", timeout=60) as r:
          j = json.load(r)
        if j["status"] == "OK": break
      except Exception as e:
        print("retry", e, file=sys.stderr)
      time.sleep(2 + k * 2)
    out += [round(x["elevation"] or 0) for x in j["results"]]
    time.sleep(1.1)
  return out

def enc(v):
  v = ~(v << 1) if v < 0 else v << 1
  s = ""
  while v >= 0x20: s += chr((0x20 | (v & 0x1f)) + 63); v >>= 5
  return s + chr(v + 63)

def polyline6(pts):
  out, plat, plon = "", 0, 0
  for lat, lon in pts:
    a, b = round(lat * 1e6), round(lon * 1e6)
    out += enc(a - plat) + enc(b - plon); plat, plon = a, b
  return out

# name -> (cycle.travel journey id or None for a GPX upload, unpaved fraction, updatedAt)
META = {
  "Richmond Park laps": ("4815162", 0.03, "2026-10-21T18:42:10Z"),
  "Box Hill via Leatherhead": ("4790321", 0.04, "2026-10-19T07:55:31Z"),
  "Windsor Great Park": ("4772018", 0.12, "2026-10-12T20:14:02Z"),
  "Hampton Court & Bushy Park": ("4801177", 0.18, "2026-10-17T12:03:48Z"),
  "Thames to Walton": ("4766540", 0.46, "2026-10-09T16:30:00Z"),
  "Ripley café loop": ("4758803", 0.05, "2026-10-04T08:21:19Z"),
  "Leith Hill & the Surrey Hills": ("4744129", 0.09, "2026-09-28T19:47:55Z"),
  "Runnymede & Staines": (None, 0.21, "2026-09-22T10:12:40Z"),
  "Wimbledon Common": ("4721986", 0.24, "2026-09-18T17:05:12Z"),
  "Esher & Claygate lanes": ("4718342", 0.02, "2026-09-14T09:40:27Z"),
  "Ham & Petersham riverside": ("4709955", 0.38, "2026-09-09T13:18:03Z"),
  "Epsom Downs & Headley": (None, 0.06, "2026-09-02T15:51:44Z"),
  "Barnes & Putney Bridge": ("4823301", 0.27, "2026-10-23T19:02:11Z"),
  "Chertsey & St Ann's Hill": ("4819764", 0.08, "2026-10-22T21:36:58Z"),
  "Ranmore Common": ("4812040", 0.07, "2026-10-20T20:11:25Z"),
}
LIBRARY_ONLY = {"Barnes & Putney Bridge", "Chertsey & St Ann's Hill", "Ranmore Common"}

summaries, geometry, elevation = [], {}, {}
for r in routes:
  rid = str(uuid.uuid5(uuid.NAMESPACE_URL, "ride-on-fixture/" + r["name"]))
  ext, unpaved, updated = META[r["name"]]
  d = r["distanceM"]
  unpavedM = round(d * unpaved)
  summaries.append({
    "id": rid, "name": r["name"], "distanceM": d,
    "source": {"providerId": "cycle-travel", "externalId": ext} if ext else None,
    "version": 1, "updatedAt": updated,
    "surfaceSummary": {
      "status": "complete", "pavedM": d - unpavedM, "unpavedM": unpavedM, "nonCyclingM": 0, "unknownM": 0,
      "classifiedFraction": 1, "unpavedFraction": unpaved,
      "source": {"kind": "cycle-travel-instructions"} if ext else None,
      "capturedAt": updated if ext else None,
    },
  })
  geometry[rid] = {"routeId": rid, "version": 1, "geometry": {"version": 1, "encoding": "polyline6", "data": polyline6(r["points"]), "pointCount": len(r["points"])}}
  elevation[rid] = elevations(r["points"])
  print(r["name"], "ok", min(elevation[rid]), max(elevation[rid]), file=sys.stderr)

summaries.sort(key=lambda s: s["updatedAt"], reverse=True)
selection = [s["id"] for s in summaries if s["name"] not in LIBRARY_ONLY]
assert len(selection) == 12

with open(OUT, "w") as f:
  f.write("// Generated fixtures: 15 real loops from the OSRM bike router, simplified to 6 m, with EU-DEM 25 m elevation.\n")
  f.write("// Shapes follow docs/api.md: GET /routes, GET /routes/:id/geometry and GET /route-selection.\n")
  f.write("// elevation is the §12.5 API gap: metres per geometry point, in point order.\n")
  f.write("window.RIDE_ON_FIXTURES = ")
  json.dump({
    "routes": {"routes": summaries, "limit": 50, "nextCursor": None},
    "geometry": geometry,
    "elevation": elevation,
    "selection": {"version": 7, "routeIds": selection, "updatedAt": "2026-10-21T18:44:02Z"},
  }, f, ensure_ascii=False, separators=(",", ":"))
  f.write(";\n")
