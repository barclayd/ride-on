# trio.py ct.png app.png ml.png out.(png|jpg): the phone comparison, cycle.travel (mobile site), the app
# (MapLibre Native, Simulator) and the prototype (GL JS), side by side at 3×, each with its name above.
import sys
from PIL import Image, ImageDraw, ImageFont
paths, out = sys.argv[1:4], sys.argv[4]
images = [Image.open(p).convert('RGB') for p in paths]
w, h = images[0].size
gap, bar = 24, 64
canvas = Image.new('RGB', (w * 3 + gap * 2, h + bar), 'white')
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 40)
for i, (image, label) in enumerate(zip(images, ['cycle.travel', 'App: MapLibre Native', 'Prototype: GL JS'])):
    canvas.paste(image.resize((w, h)) if image.size != (w, h) else image, (i * (w + gap), bar))
    draw.text((i * (w + gap) + 16, 12), label, fill='black', font=font)
canvas.save(out, quality=86) if out.endswith('.jpg') else canvas.save(out)
