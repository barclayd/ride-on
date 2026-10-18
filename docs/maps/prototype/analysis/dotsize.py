# dotsize.py img...: histogram of red route-dot diameters (device px); the colour is shot() of #dd4c18
import sys
from PIL import Image
import numpy as np
from scipy import ndimage
from collections import Counter
for f in sys.argv[1:]:
    im = np.asarray(Image.open(f).convert('RGB')).astype(int)
    d = np.abs(im - np.array([205, 86, 45])).sum(-1)  # shot() of #dd4c18
    lab, n = ndimage.label(d < 60)
    c = Counter()
    for sl in ndimage.find_objects(lab):
        h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        if 4 <= h <= 30 and abs(h - w) <= 1: c[max(h, w)] += 1
    print(f, im.shape[1], sorted(c.items()))
