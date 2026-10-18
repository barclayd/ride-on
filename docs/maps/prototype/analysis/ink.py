# ink.py img x0 y0 x1 y1 [thresh]: bounding box of dark text pixels in a region (device px), plus a 2x crop for eyeballing.
import sys
import numpy as np
from PIL import Image
f, *b = sys.argv[1:6]
x0, y0, x1, y1 = map(int, b)
t = int(sys.argv[6]) if len(sys.argv) > 6 else 90
im = Image.open(f).convert('RGB')
a = np.asarray(im.crop((x0, y0, x1, y1))).astype(int)
ys, xs = np.nonzero(a.max(-1) < t)
print(f.split('/')[-1], 'ink box', xs.min() + x0, ys.min() + y0, xs.max() + x0, ys.max() + y0, 'w', xs.max() - xs.min() + 1, 'h', ys.max() - ys.min() + 1)
im.crop((x0, y0, x1, y1)).save(sys.argv[7] if len(sys.argv) > 7 else '/dev/null', 'PNG') if len(sys.argv) > 7 else None
