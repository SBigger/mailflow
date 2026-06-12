"""Erstellt icon.ico fuer VoxDrop."""
from PIL import Image, ImageDraw
import os

BASE = os.path.dirname(os.path.abspath(__file__))

def make_icon():
    # Groesstes Bild zeichnen, Pillow skaliert auf alle Groessen
    s = 256
    img  = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, s-1, s-1], radius=48, fill=(15, 40, 80))
    m = s / 64
    pts = [(int(x*m), int(y*m)) for x, y in
           [(12,14),(24,14),(32,38),(40,14),(52,14),(36,50),(28,50)]]
    draw.polygon(pts, fill=(255, 255, 255))

    out = os.path.join(BASE, "icon.ico")
    img.save(out, format="ICO",
             sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    print("icon.ico erstellt: " + out)

if __name__ == "__main__":
    make_icon()
