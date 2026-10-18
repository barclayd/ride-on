# Fits the colour transform Chrome's screenshots apply (display profile), so sampled cycle.travel colours can be inverted.
import json, sys
import numpy as np
from PIL import Image
im = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)
cols = np.array(json.loads(sys.argv[2]), float)
meas = np.array([im[int((i // 10 + 0.5) * 200), int((i % 10 + 0.5) * 240)] for i in range(len(cols))])
lin = lambda v: np.where(v / 255 <= 0.04045, v / 255 / 12.92, ((v / 255 + 0.055) / 1.055) ** 2.4)
enc = lambda l: 255 * np.where(l <= 0.0031308, l * 12.92, 1.055 * np.clip(l, 0, None) ** (1 / 2.4) - 0.055)
M, *_ = np.linalg.lstsq(lin(cols), lin(meas), rcond=None)
pred = enc(lin(cols) @ M)
print('matrix (rows=input ch):\n', M.round(4))
print('max abs err', np.abs(pred - meas).max().round(2), 'mean', np.abs(pred - meas).mean().round(2))
print('greys in→out', [(int(c[0]), tuple(int(v) for v in m)) for c, m in zip(cols[:8], meas[:8])])
np.save(sys.argv[3], M)
