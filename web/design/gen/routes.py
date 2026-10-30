# Fetches road-following loops from the public OSRM bike router, simplifies them and adds elevation.
import json, math, sys, time, urllib.request

OUT = sys.argv[1]
# (name, [(lat, lon), ...]) — each loop starts and ends at its first point.
ROUTES = [
  ("Richmond Park laps", [(51.4505,-0.2970),(51.4560,-0.2620),(51.4330,-0.2580),(51.4180,-0.2860),(51.4370,-0.3000)]),
  ("Box Hill via Leatherhead", [(51.4110,-0.3050),(51.3690,-0.3650),(51.3300,-0.4100),(51.2900,-0.3300),(51.2560,-0.3100),(51.2480,-0.3200),(51.2700,-0.3200),(51.3600,-0.3000)]),
  ("Windsor Great Park", [(51.4613,-0.3037),(51.4470,-0.3360),(51.4330,-0.5100),(51.4440,-0.5650),(51.4300,-0.5950),(51.4560,-0.6000),(51.4700,-0.5400),(51.4470,-0.4000)]),
  ("Hampton Court & Bushy Park", [(51.4110,-0.3050),(51.4180,-0.3280),(51.4150,-0.3420),(51.4030,-0.3380),(51.3950,-0.3200)]),
  ("Thames to Walton", [(51.4110,-0.3050),(51.4030,-0.3380),(51.3960,-0.3800),(51.3920,-0.4300),(51.4040,-0.4170),(51.4130,-0.3700)]),
  ("Ripley café loop", [(51.4110,-0.3050),(51.3690,-0.3650),(51.3300,-0.4100),(51.2990,-0.4930),(51.3120,-0.4600),(51.3700,-0.4500),(51.3860,-0.4200)]),
  ("Leith Hill & the Surrey Hills", [(51.4110,-0.3050),(51.3300,-0.4100),(51.2990,-0.4930),(51.2200,-0.4630),(51.1950,-0.4200),(51.1760,-0.3720),(51.1880,-0.3570),(51.2320,-0.3310),(51.2560,-0.3100),(51.3600,-0.3000)]),
  ("Runnymede & Staines", [(51.4613,-0.3037),(51.4470,-0.3360),(51.4300,-0.3800),(51.4040,-0.4170),(51.4330,-0.5100),(51.4440,-0.5650),(51.4400,-0.4500),(51.4500,-0.3700)]),
  ("Wimbledon Common", [(51.4110,-0.3050),(51.4330,-0.2350),(51.4220,-0.2080),(51.4090,-0.2300),(51.4010,-0.2580)]),
  ("Esher & Claygate lanes", [(51.4110,-0.3050),(51.3690,-0.3650),(51.3330,-0.3600),(51.3600,-0.3420),(51.3600,-0.3000)]),
  ("Ham & Petersham riverside", [(51.4613,-0.3037),(51.4440,-0.3150),(51.4300,-0.3220),(51.4470,-0.3290)]),
  ("Epsom Downs & Headley", [(51.4110,-0.3050),(51.3500,-0.2490),(51.3120,-0.2550),(51.2810,-0.2730),(51.2970,-0.3290),(51.3100,-0.2990),(51.3600,-0.3000)]),
  ("Barnes & Putney Bridge", [(51.4613,-0.3037),(51.4810,-0.2890),(51.4700,-0.2550),(51.4670,-0.2130),(51.4520,-0.2400)]),
  ("Chertsey & St Ann's Hill", [(51.4110,-0.3050),(51.3920,-0.4300),(51.3860,-0.5090),(51.3970,-0.5190),(51.4100,-0.5300),(51.4150,-0.4900),(51.4000,-0.4500)]),
  ("Ranmore Common", [(51.4110,-0.3050),(51.3000,-0.3300),(51.2440,-0.3700),(51.2700,-0.4000),(51.2850,-0.3700),(51.3600,-0.3000)]),
]

def get(url):
  for i in range(4):
    try:
      with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ride-on-design-fixtures"}), timeout=60) as r:
        return json.load(r)
    except Exception as e:
      print("retry", e, file=sys.stderr); time.sleep(2 + 2 * i)
  raise SystemExit("failed " + url)

def xy(p, lat0):
  return (p[1] * 111320 * math.cos(math.radians(lat0)), p[0] * 110540)

def simplify(pts, tol):
  lat0 = pts[0][0]
  P = [xy(p, lat0) for p in pts]
  keep = [False] * len(pts); keep[0] = keep[-1] = True
  stack = [(0, len(pts) - 1)]
  while stack:
    a, b = stack.pop()
    ax, ay = P[a]; bx, by = P[b]; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
    best, idx = 0, -1
    for i in range(a + 1, b):
      px, py = P[i]
      t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
      d = math.hypot(px - ax - t * dx, py - ay - t * dy)
      if d > best: best, idx = d, i
    if best > tol: keep[idx] = True; stack += [(a, idx), (idx, b)]
  return [p for p, k in zip(pts, keep) if k]

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

result = []
for name, wps in ROUTES:
  loop = wps + [wps[0]]
  coords = ";".join(f"{lon},{lat}" for lat, lon in loop)
  j = get(f"https://routing.openstreetmap.de/routed-bike/route/v1/driving/{coords}?overview=full&geometries=geojson")
  r = j["routes"][0]
  pts = [(c[1], c[0]) for c in r["geometry"]["coordinates"]]
  s = simplify(pts, 6)
  result.append({"name": name, "distanceM": round(r["distance"]), "points": s})
  print(f"{name}: {r['distance']/1000:.1f} km, {len(pts)} -> {len(s)} pts", file=sys.stderr)
  time.sleep(1)

json.dump(result, open(OUT, "w"))
