# greyruns.py img x0 y0 x1 y1: along every 4th row, runs of neutral grey pixels darker than the land; modal darkest colour and width
import sys
from collections import Counter
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
x0, y0, x1, y1 = map(int, sys.argv[2:6])
cols, widths = Counter(), Counter()
for y in range(y0, y1, 4):
    row = a[y, x0:x1]
    grey = (row.max(1) - row.min(1) <= 6) & (row.sum(1) < 3 * 0xc8)
    i = 0
    while i < len(row):
        if grey[i]:
            j = i
            while j < len(row) and grey[j]: j += 1
            if j - i <= 6:
                p = row[i + np.argmin(row[i:j].sum(1))]
                cols['#%02x%02x%02x' % tuple(p)] += 1; widths[j - i] += 1
            i = j
        else: i += 1
print('colours', cols.most_common(6)); print('widths', sorted(widths.most_common(6)))
