# pair2.py ct.png ml.png out.(png|jpg) dx scale [x0 y0 x1 y1 in ml device px]: aligned side-by-side, ct shifted by dx.
# The committed comparisons in ../../screenshots used dx 350, scale 1, no box, saved as .jpg.
import sys
from PIL import Image
ct, ml, out, dx, scale = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), float(sys.argv[5])
a, b = Image.open(ct).convert('RGB'), Image.open(ml).convert('RGB')
box = [int(v) for v in sys.argv[6:10]] if len(sys.argv) > 6 else [0, 0, b.width - dx, b.height]
ca = a.crop((box[0] + dx, box[1], box[2] + dx, box[3])); cb = b.crop(box)
w, h = int(ca.width * scale), int(ca.height * scale)
c = Image.new('RGB', (w * 2 + 16, h), 'white')
c.paste(ca.resize((w, h), Image.LANCZOS), (0, 0)); c.paste(cb.resize((w, h), Image.LANCZOS), (w + 16, 0))
c.save(out, quality=86) if out.endswith('.jpg') else c.save(out)
