#!/usr/bin/env python3
"""Genera le icone dell'app: un 'segnalino di scaletta' ambra su fondo backstage."""
from PIL import Image, ImageDraw

STAGE = (22, 19, 17)
TUNGSTEN = (255, 176, 32)
INK = (243, 236, 226)


def make(size, path):
    img = Image.new("RGB", (size, size), STAGE)
    d = ImageDraw.Draw(img)
    # bagliore soft in alto
    for r in range(size, 0, -6):
        a = max(0, int(26 * (r / size)))
        d.ellipse([size/2 - r, -r*0.7, size/2 + r, r*0.9],
                  fill=(STAGE[0] + a//3, STAGE[1] + a//5, STAGE[2]))
    # tre righe di "scaletta", la centrale accesa
    m = size * 0.20
    gap = size * 0.14
    bar_h = size * 0.085
    y = size * 0.30
    widths = [0.46, 0.60, 0.38]
    for i, w in enumerate(widths):
        color = TUNGSTEN if i == 1 else (70, 62, 54)
        x1 = m
        x2 = m + (size - 2*m) * w
        d.rounded_rectangle([x1, y, x2, y + bar_h], radius=bar_h/2, fill=color)
        if i == 1:
            # puntino "live" a fine riga accesa
            cx = x2 + bar_h * 0.9
            if cx + bar_h < size - m*0.3:
                d.ellipse([cx, y, cx + bar_h, y + bar_h], fill=TUNGSTEN)
        y += gap
    img.save(path)
    print("scritto", path)


if __name__ == "__main__":
    make(192, "public/icons/icon-192.png")
    make(512, "public/icons/icon-512.png")
