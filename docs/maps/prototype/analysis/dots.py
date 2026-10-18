# dots.py image colour  -> diameter + nearest-neighbour spacing of route dots (device px)
import sys, math, statistics
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGB'); W, H = img.size; px = img.load()
want = sys.argv[2]
def hit(r, g, b):
    if want == 'red': return r > 200 and g < 140 and b < 140 and r - g > 90
    if want == 'blue': return b > 190 and r < 150 and g < 150 and b - r > 70
    if want == 'teal': return g > 110 and b > 110 and r < 90 and abs(g - b) < 40
seen = bytearray(W * H); blobs = []
for y in range(H):
    for x in range(W):
        i = y * W + x
        if seen[i] or not hit(*px[x, y]): continue
        stack = [(x, y)]; seen[i] = 1; pts = []
        while stack:
            cx, cy = stack.pop(); pts.append((cx, cy))
            for nx, ny in ((cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)):
                if 0 <= nx < W and 0 <= ny < H:
                    j = ny * W + nx
                    if not seen[j] and hit(*px[nx, ny]): seen[j] = 1; stack.append((nx, ny))
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        w, h = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        blobs.append((sum(xs) / len(xs), sum(ys) / len(ys), w, h, len(pts)))
# isolated round dots only: roughly square, small, area ~ circle
dots = [b for b in blobs if 3 <= b[2] <= 30 and abs(b[2] - b[3]) <= 2 and b[4] >= 0.6 * b[2] * b[3]]
diam = statistics.median([2 * math.sqrt(b[4] / math.pi) for b in dots]) if dots else 0
nn = []
for a in dots:
    d = min((math.dist(a[:2], b[:2]) for b in dots if b is not a), default=None)
    if d is not None and d < 40: nn.append(d)
print(f'{sys.argv[1].split("/")[-1]} {want}: {len(dots)} dots, diameter≈{diam:.1f}px, spacing≈{statistics.median(nn) if nn else 0:.1f}px (device px @2x)')
