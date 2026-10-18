# crop2.py ct.png ml.png out.png x0 y0 x1 y1 [dx=360]: the same ml-device-px box from both captures, side by side (ct left)
import sys
from PIL import Image
ct, ml = Image.open(sys.argv[1]), Image.open(sys.argv[2])
x0, y0, x1, y1 = map(int, sys.argv[4:8]); dx = int(sys.argv[8]) if len(sys.argv) > 8 else 360
a, b = ct.crop((x0 + dx, y0, x1 + dx, y1)), ml.crop((x0, y0, x1, y1))
im = Image.new('RGB', (a.width * 2 + 10, a.height), 'white'); im.paste(a, (0, 0)); im.paste(b, (a.width + 10, 0)); im.save(sys.argv[3])
