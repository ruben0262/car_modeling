"""Tile rendered manual pages into one image to read location figures side by side (needs Pillow).

    pdftoppm -f 2196 -l 2199 -r 70 -png "<manual>.pdf" /tmp/fig/p
    python3 -I tools/research/contact-sheet.py /tmp/fig/sheet.png /tmp/fig/p-*.png
"""
import sys

from PIL import Image, ImageDraw

out, paths = sys.argv[1], sys.argv[2:]
ims = [Image.open(p).convert("RGB") for p in paths]
w = max(i.width for i in ims)
h = max(i.height for i in ims)
cols = 2
rows = (len(ims) + 1) // 2
sheet = Image.new("RGB", (cols * w, rows * h), "white")
d = ImageDraw.Draw(sheet)
for k, (im, p) in enumerate(zip(ims, paths)):
    x, y = (k % cols) * w, (k // cols) * h
    sheet.paste(im, (x, y))
    d.rectangle([x, y, x + w - 1, y + h - 1], outline="black")
    d.text((x + 6, y + 4), p.split("/")[-1], fill="red")
sheet.save(out)
print(sheet.size)
