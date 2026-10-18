# Counts pixels within 6 levels of each target colour, to check badge fills land on cycle.travel's sampled values.
import sys
import numpy as np
from PIL import Image
im = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
for h in sys.argv[2:]:
    t = np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)])
    print(h, int((np.abs(im - t).max(-1) <= 6).sum()))
