# badges.py img... -> every cycle.travel-style badge (red #d7655f / blue #4ea4d3 box) found, with size
import sys
from PIL import Image
import numpy as np
from scipy import ndimage
for p in sys.argv[1:]:
    a = np.asarray(Image.open(p).convert('RGB')).astype(int)
    def near(c, d=22): return (np.abs(a - np.array(c)).sum(axis=2) < d * 3)
    for name, cols in (('red', [(0xd7, 0x65, 0x5f), (0xda, 0x65, 0x5e)]), ('blue', [(0x52, 0xa8, 0xdc), (0x4e, 0xa4, 0xd3)])):
        m = np.zeros(a.shape[:2], bool)
        for c in cols: m |= near(c)
        m = ndimage.binary_closing(m, iterations=3)
        lab, n = ndimage.label(m)
        found = []
        for i, sl in enumerate(ndimage.find_objects(lab)):
            h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
            fillr = (lab[sl] == i + 1).mean()
            if 18 <= h <= 28 and 22 <= w <= 90 and fillr > 0.55:
                found.append((sl[1].start + w // 2, sl[0].start + h // 2, w, h))
        print(p.split('/')[-1], name, len(found), sorted(found))
