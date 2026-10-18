import sys
from PIL import Image, ImageDraw, ImageFont
left, right, out = sys.argv[1:4]
a, b = Image.open(left).convert('RGB'), Image.open(right).convert('RGB')
w, h = a.size
bar = 70
canvas = Image.new('RGB', (w * 2 + 20, h + bar), 'white')
canvas.paste(a, (0, bar)); canvas.paste(b, (w + 20, bar))
d = ImageDraw.Draw(canvas)
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 40)
d.text((20, 14), 'cycle.travel', fill='black', font=font)
d.text((w + 40, 14), 'Ride On prototype — MapLibre + Protomaps + OSM routes', fill='black', font=font)
canvas.save(out)
