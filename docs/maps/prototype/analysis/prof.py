# prof.py img cx cy angle s1,s2,.. : raw RGB perpendicular profile (1 device px steps) at offsets s along the line
import sys, math
import numpy as np
from PIL import Image
img = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
cx, cy, ang = float(sys.argv[2]), float(sys.argv[3]), math.radians(float(sys.argv[4]))
dx, dy = math.cos(ang), math.sin(ang); nx, ny = -dy, dx
for s in [int(v) for v in sys.argv[5].split(',')]:
    px, py = cx + dx*s, cy + dy*s
    row = []
    for t in range(-9, 10):
        x, y = int(round(px + nx*t)), int(round(py + ny*t))
        r, g, b = img[y, x]
        row.append(f"{r:02x}{g:02x}{b:02x}"[:6])
    print(f"s={s:4d}", ' '.join(row))
