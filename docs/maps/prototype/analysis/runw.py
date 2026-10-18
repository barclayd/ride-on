# runw.py img...: histogram of vertical+horizontal run lengths of A (pink) and B (orange) fill pixels
import sys, numpy as np
from PIL import Image
from collections import Counter
def runs(mask):
    c = Counter()
    for line in mask:
        d = np.diff(np.concatenate(([0], line.astype(int), [0])))
        st = np.nonzero(d == 1)[0]; en = np.nonzero(d == -1)[0]
        c.update((en - st).tolist())
    return c
for f in sys.argv[1:]:
    a = np.asarray(Image.open(f).convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    A = (r > 225) & (g > 175) & (g < 200) & (b > 150) & (b < 185)   # f7bda7-ish
    B = (r > 235) & (g > 195) & (g < 225) & (b > 140) & (b < 180)   # fdd5a5-ish
    for name, m in (('A', A), ('B', B)):
        c = runs(m) + runs(m.T)
        top = sorted(((n, w) for w, n in c.items() if w <= 30), reverse=True)[:5]
        print(f, name, int(m.sum()), ' '.join(f'{w}:{n}' for n, w in top))
