# fit: lut.py fit out.json (headless.png display.png)...   apply: lut.py apply lut.json in.png out.png
import sys, json
import numpy as np
from PIL import Image
def load(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.int32)
if sys.argv[1] == 'fit':
    pairs = sys.argv[3:]
    lut = []
    for ch in range(3):
        sums = np.zeros(256); counts = np.zeros(256)
        for a, b in zip(pairs[0::2], pairs[1::2]):
            A, B = load(a)[..., ch].ravel(), load(b)[..., ch].ravel()
            for v in range(256):
                m = A == v
                if m.any(): sums[v] += np.median(B[m]) * m.sum(); counts[v] += m.sum()
        known = counts > 50
        xs = np.nonzero(known)[0]; ys = sums[known] / counts[known]
        lut.append(np.interp(np.arange(256), xs, ys).round().clip(0, 255).astype(int).tolist())
    json.dump(lut, open(sys.argv[2], 'w'))
    print('fitted on', len(pairs)//2, 'pairs')
else:
    lut = np.array(json.load(open(sys.argv[2])), dtype=np.uint8)
    A = load(sys.argv[3]).astype(np.uint8)
    out = np.stack([lut[c][A[..., c]] for c in range(3)], axis=-1)
    Image.fromarray(out).save(sys.argv[4])
