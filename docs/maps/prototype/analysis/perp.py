# perp.py img cx cy angle_deg [half] : rail outer width (device px) along perpendicular profiles
import sys, math
import numpy as np
from PIL import Image
img = np.asarray(Image.open(sys.argv[1]).convert('L')).astype(float)
cx, cy, ang = float(sys.argv[2]), float(sys.argv[3]), math.radians(float(sys.argv[4]))
half = int(sys.argv[5]) if len(sys.argv) > 5 else 20
dx, dy = math.cos(ang), math.sin(ang)
nx, ny = -dy, dx
def at(x, y):
    x0, y0 = int(math.floor(x)), int(math.floor(y)); fx, fy = x - x0, y - y0
    a = img[y0:y0+2, x0:x0+2]
    return a[0,0]*(1-fx)*(1-fy) + a[0,1]*fx*(1-fy) + a[1,0]*(1-fx)*fy + a[1,1]*fx*fy
ws = []
for s in range(-80, 81, 10):
    px, py = cx + dx*s, cy + dy*s
    prof = [at(px + nx*t/4, py + ny*t/4) for t in range(-half*4, half*4+1)]
    bg = (np.median(prof[:12]) + np.median(prof[-12:])) / 2
    lo = min(prof); thr = (bg + lo) / 2
    idx = [i for i, v in enumerate(prof) if v < thr]
    if not idx: continue
    w = (idx[-1] - idx[0] + 1) / 4
    ws.append(w)
    print(f"s={s:4d} bg={bg:5.1f} min={lo:5.1f} width={w:5.2f} ", ''.join('#' if v < thr else ('o' if v > bg + 8 else '.') for v in prof[::2]))
print("median width", np.median(ws))
