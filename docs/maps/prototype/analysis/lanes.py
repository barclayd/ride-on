# lanes.py ml.png ct.png pts.json [dx=342]: lane width (device px at half depth) and darkest value, ml vs ct, at the same points.
# pts.json: [[x, y, angle_deg], ...] in ml device px
import sys, json, math
import numpy as np
from PIL import Image
ml = np.asarray(Image.open(sys.argv[1]).convert('L')).astype(float)
ct = np.asarray(Image.open(sys.argv[2]).convert('L')).astype(float)
pts = json.load(open(sys.argv[3])); dx = float(sys.argv[4]) if len(sys.argv) > 4 else 342
def at(img, x, y):
    x0, y0 = int(math.floor(x)), int(math.floor(y)); fx, fy = x - x0, y - y0
    a = img[y0:y0+2, x0:x0+2]
    return a[0,0]*(1-fx)*(1-fy) + a[0,1]*fx*(1-fy) + a[1,0]*(1-fx)*fy + a[1,1]*fx*fy
def measure(img, x, y, ang):
    r = math.radians(ang); nx, ny = -math.sin(r), math.cos(r)
    prof = np.array([at(img, x + nx*t/4, y + ny*t/4) for t in range(-32, 33)])
    bg = max(np.median(prof[:8]), np.median(prof[-8:]))
    lo = prof[24:41].min()  # within ±4 px of the line
    if bg - lo < 12: return None
    depth = (bg - prof).clip(0)
    return depth.sum() / 4 / (bg - lo), lo, bg  # equivalent width at full depth
rows = []
for x, y, ang in pts:
    a, b = measure(ml, x, y, ang), measure(ct, x + dx, y, ang)
    if a and b: rows.append((a, b)); print(f"({x},{y}) ml w={a[0]:4.1f} lo={a[1]:5.1f} bg={a[2]:5.1f} | ct w={b[0]:4.1f} lo={b[1]:5.1f} bg={b[2]:5.1f}")
if rows:
    print("median ml w=%.2f lo=%.0f  ct w=%.2f lo=%.0f  (n=%d)" % (np.median([r[0][0] for r in rows]), np.median([r[0][1] for r in rows]), np.median([r[1][0] for r in rows]), np.median([r[1][1] for r in rows]), len(rows)))
