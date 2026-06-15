"""
VoxDrop Wizard Images Generator
Erstellt wizard_main.bmp (164x314) und wizard_small.bmp (55x55) fuer Inno Setup
"""

from PIL import Image, ImageDraw, ImageFont
import math
import os

# Farben
BG_COLOR = (10, 20, 14)        # #0a140e
GREEN = (52, 211, 116)          # #34d374
GREEN_DARK = (30, 130, 70)      # dunkleres Gruen fuer Verlauf
WHITE = (255, 255, 255)
GRAY = (160, 170, 165)


def draw_voxdrop_logo(draw, cx, cy, size):
    """
    Zeichnet das VoxDrop-Logo: grüner Tropfen + Wellenbalken
    cx, cy = Mittelpunkt, size = Gesamtgrösse
    """
    drop_w = int(size * 0.55)
    drop_h = int(size * 0.70)

    # Tropfen-Form: Kreis oben + Spitze unten
    circle_r = drop_w // 2
    circle_cx = cx
    circle_cy = cy - drop_h // 2 + circle_r

    # Hauptkreis des Tropfens
    draw.ellipse(
        [circle_cx - circle_r, circle_cy - circle_r,
         circle_cx + circle_r, circle_cy + circle_r],
        fill=GREEN
    )

    # Dreieck/Spitze unten
    tip_y = cy + drop_h // 2 - int(size * 0.05)
    triangle = [
        (cx - circle_r + int(circle_r * 0.15), circle_cy + int(circle_r * 0.6)),
        (cx + circle_r - int(circle_r * 0.15), circle_cy + int(circle_r * 0.6)),
        (cx, tip_y),
    ]
    draw.polygon(triangle, fill=GREEN)

    # Wellenbalken (Schallwellen) im Tropfen
    bar_count = 3
    bar_max_h = int(circle_r * 0.85)
    bar_w = max(2, int(drop_w * 0.07))
    bar_gap = int(drop_w * 0.13)
    total_bar_width = bar_count * bar_w + (bar_count - 1) * bar_gap
    bar_start_x = cx - total_bar_width // 2

    bar_heights = [int(bar_max_h * 0.55), bar_max_h, int(bar_max_h * 0.55)]
    bar_y_center = circle_cy - int(circle_r * 0.05)

    for i in range(bar_count):
        bx = bar_start_x + i * (bar_w + bar_gap)
        bh = bar_heights[i]
        draw.rounded_rectangle(
            [bx, bar_y_center - bh // 2, bx + bar_w, bar_y_center + bh // 2],
            radius=bar_w // 2,
            fill=BG_COLOR
        )


def create_wizard_main():
    """wizard_main.bmp – 164x314 px, linkes Seitenbild"""
    w, h = 164, 314
    img = Image.new("RGB", (w, h), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Dezenter Verlauf-Effekt (vertikale Streifen)
    for y in range(h):
        ratio = y / h
        r = int(BG_COLOR[0] + (GREEN_DARK[0] - BG_COLOR[0]) * ratio * 0.18)
        g = int(BG_COLOR[1] + (GREEN_DARK[1] - BG_COLOR[1]) * ratio * 0.18)
        b = int(BG_COLOR[2] + (GREEN_DARK[2] - BG_COLOR[2]) * ratio * 0.18)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    # Logo zentriert (oberes Drittel)
    logo_size = 90
    logo_cx = w // 2
    logo_cy = 100
    draw_voxdrop_logo(draw, logo_cx, logo_cy, logo_size)

    # "VoxDrop" Text
    try:
        font_large = ImageFont.truetype("C:/Windows/Fonts/calibrib.ttf", 22)
        font_medium = ImageFont.truetype("C:/Windows/Fonts/calibri.ttf", 13)
        font_small = ImageFont.truetype("C:/Windows/Fonts/calibri.ttf", 11)
    except Exception:
        font_large = ImageFont.load_default()
        font_medium = font_large
        font_small = font_large

    # Haupttitel "VoxDrop"
    text_voxdrop = "VoxDrop"
    bbox = draw.textbbox((0, 0), text_voxdrop, font=font_large)
    tw = bbox[2] - bbox[0]
    draw.text((w // 2 - tw // 2, 200), text_voxdrop, fill=GREEN, font=font_large)

    # "by Artis"
    text_artis = "by Artis"
    bbox2 = draw.textbbox((0, 0), text_artis, font=font_medium)
    tw2 = bbox2[2] - bbox2[0]
    draw.text((w // 2 - tw2 // 2, 228), text_artis, fill=GRAY, font=font_medium)

    # Trennlinie
    line_y = 270
    draw.line([(20, line_y), (w - 20, line_y)], fill=(40, 80, 55), width=1)

    # Versionsnummer unten
    text_ver = "v1.1.3"
    bbox3 = draw.textbbox((0, 0), text_ver, font=font_small)
    tw3 = bbox3[2] - bbox3[0]
    draw.text((w // 2 - tw3 // 2, 282), text_ver, fill=(100, 160, 120), font=font_small)

    # Gespeichert als BMP
    img.save("wizard_main.bmp", "BMP")
    print(f"wizard_main.bmp erstellt ({w}x{h})")


def create_wizard_small():
    """wizard_small.bmp – 55x55 px, kleines Eckbild"""
    w, h = 55, 55
    img = Image.new("RGB", (w, h), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Logo zentriert, kleiner
    logo_size = 44
    draw_voxdrop_logo(draw, w // 2, h // 2, logo_size)

    img.save("wizard_small.bmp", "BMP")
    print(f"wizard_small.bmp erstellt ({w}x{h})")


if __name__ == "__main__":
    # Ins VOXDROP-Verzeichnis wechseln (Script liegt dort)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    create_wizard_main()
    create_wizard_small()
    print("Fertig – beide BMP-Dateien erstellt.")
