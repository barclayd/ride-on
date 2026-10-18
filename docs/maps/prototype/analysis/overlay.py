# overlay.py shot.png ways.json ct_zoom lat lon out.png ids...: draws the given OSM ways (magenta) over a cycle.travel shot.
import sys, json, math
from PIL import Image, ImageDraw
shot, ways, z, lat0, lon0, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
ids = {int(i) for i in sys.argv[7:]}
world = 256 * 2 ** z
def px(lat, lon):
  s = math.sin(math.radians(lat))
  return (lon + 180) / 360 * world, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * world
cx, cy = px(lat0, lon0)
im = Image.open(shot).convert('RGB'); d = ImageDraw.Draw(im)
for e in json.load(open(ways))['elements']:
  if e['id'] not in ids: continue
  pts = [(1550 + 2 * (x - cx), 800 + 2 * (y - cy)) for x, y in (px(p['lat'], p['lon']) for p in e['geometry'])]
  d.line(pts, fill=(255, 0, 255), width=1)
im.save(out)
