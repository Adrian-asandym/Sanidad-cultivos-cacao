"""Genera los iconos PNG de la PWA (mismo dibujo que app/icons/logo.svg)."""
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw

GREEN, MINT = (11, 107, 69), (110, 242, 176)
OUT = Path(__file__).resolve().parent.parent / "app" / "icons"


def draw(size, maskable=False):
    s = 4  # supermuestreo para bordes suaves
    W = size * s
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, W, W], fill=GREEN)
        k = 0.62  # el dibujo queda dentro de la zona segura (80 %)
    else:
        d.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 14 / 48), fill=GREEN)
        k = 1.0
    u = W / 48 * k
    ox = oy = (W - 48 * u) / 2
    P = lambda x, y: (ox + x * u, oy + y * u)  # noqa: E731
    # mazorca
    d.ellipse([*P(14, 9), *P(34, 39)], fill=MINT)
    lw = max(1, int(1.3 * u))
    d.line([P(24, 10.5), P(24, 37.5)], fill=GREEN, width=lw)
    for x0, x1 in ((19.2, 16.9), (28.8, 31.1)):
        pts = [P(x0 + (x1 - x0) * math.sin(math.pi * t / 40), 11 + t * 0.65) for t in range(41)]
        d.line(pts, fill=GREEN, width=lw, joint="curve")
    # hoja
    d.polygon([P(24, 9), P(26.5, 6), P(31.6, 4.8), P(29.5, 8), P(24.5, 9.4)], fill=MINT)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    draw(192).save(OUT / "icon-192.png")
    draw(512).save(OUT / "icon-512.png")
    draw(512, maskable=True).save(OUT / "icon-maskable-512.png")
    draw(180, maskable=True).convert("RGB").save(OUT / "apple-touch-icon.png")
    print("Iconos escritos en", OUT, file=sys.stderr)
