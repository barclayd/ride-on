# ct-classify.py shot.png ways.json ct_zoom lat lon: for each OSM way, which of cycle.travel's line styles sits under it.
import sys, json, math
from collections import Counter, defaultdict
from PIL import Image
import numpy as np
shot, ways, z, lat0, lon0 = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
a = np.asarray(Image.open(shot).convert('RGB')).astype(int)
H, W = a.shape[:2]
r, g, b = a[..., 0], a[..., 1], a[..., 2]
cls = {
  'brown': (abs(r - 131) < 14) & (abs(g - 74) < 14) & (abs(b - 33) < 14),
  'red': (r > 190) & (g < 130) & (b < 110),
  'green': (g > r + 15) & (g - b > 70) & (g < 215),
  'white': (r > 250) & (g > 250) & (b > 250),
}
world = 256 * 2 ** z
def px(lat, lon):
  x = (lon + 180) / 360 * world
  s = math.sin(math.radians(lat))
  y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * world
  return x, y
cx, cy = px(lat0, lon0)
ox, oy = 1550, 800  # ct's map centre in device px (sidebar hidden after load)
def dev(lat, lon):
  x, y = px(lat, lon)
  return ox + 2 * (x - cx), oy + 2 * (y - cy)
res = []
for e in json.load(open(ways))['elements']:
  geom = [dev(p['lat'], p['lon']) for p in e['geometry']]
  hits, n = Counter(), 0
  for (x0, y0), (x1, y1) in zip(geom, geom[1:]):
    steps = max(1, int(math.hypot(x1 - x0, y1 - y0) / 3))
    for i in range(steps):
      x, y = int(x0 + (x1 - x0) * i / steps), int(y0 + (y1 - y0) * i / steps)
      if not (3 <= x < W - 3 and 3 <= y < H - 3): continue
      n += 1
      for k, m in cls.items():
        if m[y - 2:y + 3, x - 2:x + 3].any(): hits[k] += 1
  if n < 30: continue
  t = e['tags']
  res.append((e['id'], t.get('highway'), t.get('bicycle', '-'), t.get('surface', '-'), t.get('name', ''), n, {k: round(v / n, 2) for k, v in hits.items()}))
json.dump(res, open(sys.argv[6], 'w')) if len(sys.argv) > 6 else None
for row in res: print(*row)
