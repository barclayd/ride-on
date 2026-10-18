# crop.py out scale x0 y0 x1 y1 img...  -> same crop from each image, upscaled, side by side
import sys
from PIL import Image, ImageDraw
out, k, x0, y0, x1, y1, *imgs = sys.argv[1:]; k = int(k); box = tuple(map(int, (x0, y0, x1, y1)))
tiles = [Image.open(p).convert('RGB').crop(box).resize(((box[2]-box[0])*k, (box[3]-box[1])*k), Image.NEAREST) for p in imgs]
W = sum(t.width for t in tiles) + 10 * (len(tiles) - 1); H = tiles[0].height
canvas = Image.new('RGB', (W, H), 'white'); x = 0
for t in tiles:
    d = ImageDraw.Draw(t)
    for gx in range(0, t.width, 10 * k): d.line([(gx, 0), (gx, t.height)], fill=(0, 200, 0), width=1)  # 10 device-px grid
    for gy in range(0, t.height, 10 * k): d.line([(0, gy), (t.width, gy)], fill=(0, 200, 0), width=1)
    canvas.paste(t, (x, 0)); x += t.width + 10
canvas.save(out)
