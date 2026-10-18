# abprof.py [raw] z ml.png ct.png [z ml.png ct.png ...]: perpendicular profiles across Colchester's A133 and B1027
# in captures centred on 0.964,51.8787 (ml zoom z, ct zoom z+1, ct offset DX device px). Classes: # dark casing,
# + mid grey, F coloured fill, . land; `raw` prints each pixel's hex instead.
import sys, math
import numpy as np
from PIL import Image
DX = 342
def merc(lon, lat, z):
    W = 512 * 2 ** z; s = math.sin(math.radians(lat))
    return (lon + 180) / 360 * W, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * W
segs = {'A133a': ((0.98325, 51.88176), (0.99139, 51.88172)), 'A133b': ((0.97049, 51.88162), (0.97830, 51.88183)),
        'B1027': ((0.95995, 51.87744), (0.96817, 51.87513))}
def cls(p):
    r, g, b = p; lum = (r + g + b) / 3
    if lum < 0x60: return '#'
    if lum < 0xa0: return '+'
    if r - b > 35: return 'F'
    return '.'
args = sys.argv[1:]; raw = args[:1] == ['raw']; args = args[1:] if raw else args
half = 7 if raw else 10
for i in range(0, len(args), 3):
    mlz, mlf, ctf = int(args[i]), args[i + 1], args[i + 2]
    ml = np.asarray(Image.open(mlf).convert('RGB')).astype(int); ct = np.asarray(Image.open(ctf).convert('RGB')).astype(int)
    cx, cy = merc(0.964, 51.8787, mlz)
    for name, (a, b) in segs.items():
        ax, ay = merc(*a, mlz); bx, by = merc(*b, mlz)
        ang = math.atan2(by - ay, bx - ax); nx, ny = -math.sin(ang), math.cos(ang)
        for f in (0.3, 0.5, 0.7):
            px = ((ax + (bx - ax) * f) - cx) * 2 + 1200; py = ((ay + (by - ay) * f) - cy) * 2 + 800
            rows = []
            for img, off in ((ml, 0), (ct, DX)):
                s = ''
                for t in range(-half, half + 1):
                    x, y = int(round(px + off + nx * t)), int(round(py + ny * t))
                    inside = 0 <= x < img.shape[1] and 0 <= y < img.shape[0]
                    s += ((' %02x%02x%02x' % tuple(img[y, x])) if raw else cls(img[y, x])) if inside else ' '
                rows.append(s)
            print(f'z{mlz} {name} f{f}  ml {rows[0]}  ct {rows[1]}')
