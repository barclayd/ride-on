# sheet.py out scale "img:cx:cy:w:h:label" ...  -> contact sheet of crops centred on (cx, cy) in device px
import sys
from PIL import Image, ImageDraw, ImageFont
out, k, *specs = sys.argv[1:]; k = int(k)
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 22)
tiles = []
for s in specs:
    p, cx, cy, w, h, label = s.split(':')
    cx, cy, w, h = map(int, (cx, cy, w, h))
    t = Image.open(p).convert('RGB').crop((cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)).resize((w * k, h * k), Image.NEAREST)
    c = Image.new('RGB', (t.width, t.height + 30), 'white'); c.paste(t, (0, 30)); ImageDraw.Draw(c).text((4, 2), label, fill='black', font=font)
    tiles.append(c)
cols = 3; rows = (len(tiles) + cols - 1) // cols
cw = max(t.width for t in tiles); ch = max(t.height for t in tiles)
sheet = Image.new('RGB', (cols * (cw + 10), rows * (ch + 10)), (230, 230, 230))
for i, t in enumerate(tiles): sheet.paste(t, ((i % cols) * (cw + 10), (i // cols) * (ch + 10)))
sheet.save(out)
