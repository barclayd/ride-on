import sys
from PIL import Image
from collections import Counter
for f in sys.argv[1:]:
    im = Image.open(f).convert('RGB')
    c = Counter(im.getdata())
    print(f.split('/')[-1], ' '.join('#%02x%02x%02x:%d' % (k + (v,)) for k, v in c.most_common(28)))
