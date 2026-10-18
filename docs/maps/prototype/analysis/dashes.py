# Measures brown dash length, width and spacing (device px) in a cycle.travel screenshot.
import sys, numpy as np
from PIL import Image
from scipy import ndimage
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
R, G, B = [int(v) for v in (sys.argv[2:5] or [131, 74, 33])]
m = (abs(r - R) < 30) & (abs(g - G) < 30) & (abs(b - B) < 30)
lab, n = ndimage.label(m, np.ones((3, 3)))
cents, lens, wids = [], [], []
for i in range(1, n + 1):
    ys, xs = np.nonzero(lab == i)
    if len(xs) < 6 or len(xs) > 400: continue
    p = np.stack([xs, ys], 1).astype(float); c = p.mean(0); q = p - c
    w, v = np.linalg.eigh(np.cov(q.T)); ax = v[:, 1]
    t = q @ ax; s = q @ v[:, 0]
    L = t.max() - t.min() + 1
    if L < 4: continue
    cents.append(c); lens.append(L); wids.append(len(xs) / L)
cents = np.array(cents)
d = np.sqrt(((cents[:, None] - cents[None]) ** 2).sum(-1)); np.fill_diagonal(d, 1e9)
nn = d.min(1)
print('dashes', len(lens), 'len median', np.median(lens), 'width median', round(np.median(wids), 2), 'period (nn) median', np.median(nn))
