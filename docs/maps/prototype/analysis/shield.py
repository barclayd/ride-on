# shield.py img cx cy  -> bbox + colours of the badge (red or blue fill) in a 110x60 window around (cx, cy)
import sys
from collections import Counter
from PIL import Image
p, cx, cy = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
im = Image.open(p).convert('RGB')
win = [(x, y) for x in range(cx - 55, cx + 55) for y in range(cy - 30, cy + 30)]
def red(c): r, g, b = c; return r > 190 and 70 < g < 120 and 60 < b < 110
def blue(c): r, g, b = c; return 50 < r < 110 and 140 < g < 190 and 180 < b < 240
kind = red if sum(red(im.getpixel(q)) for q in win) > sum(blue(im.getpixel(q)) for q in win) else blue
# rows/cols where the fill dominates -> badge box (robust to route lines crossing it)
rows = Counter(y for x, y in win if kind(im.getpixel((x, y))))
cols = Counter(x for x, y in win if kind(im.getpixel((x, y))))
ys = sorted(y for y, n in rows.items() if n >= 12); xs = sorted(x for x, n in cols.items() if n >= 8)
l, r, t, b = xs[0], xs[-1], ys[0], ys[-1]
fill = Counter(im.getpixel((x, y)) for x in range(l, r + 1) for y in range(t, b + 1) if kind(im.getpixel((x, y))))
h = lambda c: '#%02x%02x%02x' % c
mx = (l + r) // 2
print(p.split('/')[-1], 'red' if kind is red else 'blue', 'w', r - l + 1, 'h', b - t + 1, 'fill', [h(c) for c, _ in fill.most_common(3)])
print('   above/top edge:', [h(im.getpixel((l + 3, y))) for y in range(t - 2, t + 3)], ' bottom edge:', [h(im.getpixel((l + 3, y))) for y in range(b - 2, b + 3)])
print('   corner TL:', [h(im.getpixel((l + i, t + i))) for i in range(0, 4)])
# text: white pixels inside the box
wx = [x for x in range(l, r + 1) for y in range(t, b + 1) if min(im.getpixel((x, y))) > 235]
wy = [y for x in range(l, r + 1) for y in range(t, b + 1) if min(im.getpixel((x, y))) > 235]
if wx: print('   text box w', max(wx) - min(wx) + 1, 'h', max(wy) - min(wy) + 1, 'pad L', min(wx) - l, 'R', r - max(wx), 'T', min(wy) - t, 'B', b - max(wy))
