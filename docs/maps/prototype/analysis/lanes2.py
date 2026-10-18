# lanes2.py ml.png ct.png pts.json zoom [dx=342]: per road kind, ml vs ct profile summary at the same points.
# pts.json is the text evaluate_script returned: a JSON string of {zoom: [[x, y, angle_deg, kind], ...]} in ml device px
import sys, json, math
import numpy as np
from PIL import Image
from collections import defaultdict
ml = np.asarray(Image.open(sys.argv[1]).convert('L')).astype(float)
ct = np.asarray(Image.open(sys.argv[2]).convert('L')).astype(float)
raw = open(sys.argv[3]).read(); raw = raw[raw.find('"{'):raw.rfind('}"') + 2]
pts = json.loads(json.loads(raw))[sys.argv[4]]
dx = float(sys.argv[5]) if len(sys.argv) > 5 else 342
def at(img, x, y):
    x0, y0 = int(math.floor(x)), int(math.floor(y)); fx, fy = x - x0, y - y0
    a = img[y0:y0+2, x0:x0+2]
    return a[0,0]*(1-fx)*(1-fy) + a[0,1]*fx*(1-fy) + a[1,0]*(1-fx)*fy + a[1,1]*fx*fy
def measure(img, x, y, ang):
    r = math.radians(ang); nx, ny = -math.sin(r), math.cos(r)
    prof = np.array([at(img, x + nx*t/2, y + ny*t/2) for t in range(-24, 25)])  # ±12 px, 0.5 px steps
    bg = max(np.median(prof[:6]), np.median(prof[-6:]))
    mid = prof[12:37]  # ±6 px
    lo = mid.min()
    if bg - lo < 12: return None
    thr = (bg + lo) / 2
    idx = [i for i, v in enumerate(prof) if v < thr]
    outer = (idx[-1] - idx[0] + 1) / 2
    hi = prof[idx[0]:idx[-1] + 1].max()
    return outer, lo, hi, bg
by = defaultdict(list)
for x, y, ang, k in pts:
    a, b = measure(ml, x, y, ang), measure(ct, x + dx, y, ang)
    if a and b: by[k].append((a, b))
for k, rows in by.items():
    m = lambda side, j: np.median([r[side][j] for r in rows])
    print(f"{k:13s} n={len(rows):2d}  ml outer={m(0,0):4.1f} lo={m(0,1):4.0f} core={m(0,2):4.0f} | ct outer={m(1,0):4.1f} lo={m(1,1):4.0f} core={m(1,2):4.0f}")
