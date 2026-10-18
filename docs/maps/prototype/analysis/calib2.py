# Model: out = 255 * (lin_srgb(in) @ M) ** (1/g), i.e. a matrix in linear light then a pure power output curve.
import json, sys
import numpy as np
from PIL import Image
im = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)
cols = np.array(json.load(open(sys.argv[2])), float)
meas = np.array([im[int((i // 10 + 0.5) * 200), int((i % 10 + 0.5) * 240)] for i in range(len(cols))])
lin = lambda v: np.where(v / 255 <= 0.04045, v / 255 / 12.92, ((v / 255 + 0.055) / 1.055) ** 2.4)
best = None
for g in np.arange(1.6, 2.6, 0.01):
    for curve in ('pow', 'srgb'):
        lm = (meas / 255) ** g if curve == 'pow' else lin(meas)
        if curve == 'srgb' and g > 1.6: continue
        M, *_ = np.linalg.lstsq(lin(cols), lm, rcond=None)
        y = np.clip(lin(cols) @ M, 0, None)
        pred = 255 * (y ** (1 / g) if curve == 'pow' else np.where(y <= 0.0031308, y * 12.92, 1.055 * y ** (1 / 2.4) - 0.055))
        e = np.abs(pred - meas)
        if best is None or e.mean() < best[0]: best = (e.mean(), e.max(), g, curve, M, e)
mean, mx, g, curve, M, e = best
print(f'best curve={curve} g={g:.2f} mean={mean:.2f} max={mx:.2f}')
print(M.round(4))
worst = np.argsort(e.max(1))[-5:]
for i in worst: print(i, cols[i], meas[i], e[i].round(1))
np.save(sys.argv[3], {'M': M, 'g': g, 'curve': curve}, allow_pickle=True)
