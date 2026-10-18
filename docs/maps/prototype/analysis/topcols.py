import sys
from collections import Counter
from PIL import Image
for f in sys.argv[1:]:
    im = Image.open(f).convert('RGB')
    c = Counter(im.getdata())
    print(f.split('/')[-1], ['#%02x%02x%02x %d' % (*k, v) for k, v in c.most_common(8)])
