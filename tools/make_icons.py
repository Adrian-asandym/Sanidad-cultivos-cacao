"""Genera todos los iconos a partir de app/icons/logo.svg.

- PWA: app/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
- Android (Capacitor): mipmaps del icono adaptativo (fondo + primer plano +
  monocromo para iconos temáticos), icono heredado cuadrado y redondo, icono de
  la splash de Android 12+ y las splash.png heredadas.

El SVG se rasteriza con el Edge/Chrome instalado vía Playwright (no descarga
navegadores) y la composición se hace con Pillow. Uso:

    python tools/make_icons.py            # Edge (Windows)
    python tools/make_icons.py --channel chrome
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "app" / "icons" / "logo.svg"
PWA = ROOT / "app" / "icons"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

ICON_BG = (255, 255, 255, 255)        # fondo de los iconos (contraste con los verdes del logo)
SPLASH_BG = (248, 247, 252, 255)      # #F8F7FC, el fondo de la app: la splash funde con la primera pantalla
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
MASTER_H = 2048


def render_master(channel):
    """Rasteriza el SVG con transparencia a MASTER_H px de alto."""
    from playwright.sync_api import sync_playwright

    svg = LOGO.read_text(encoding="utf-8")
    vb = [float(v) for v in svg.split('viewBox="')[1].split('"')[0].split()]
    w = round(MASTER_H * vb[2] / vb[3])
    html = (
        "<!doctype html><html><head><style>html,body{margin:0;background:transparent}"
        f"svg{{display:block;width:{w}px;height:{MASTER_H}px}}</style></head><body>{svg}</body></html>"
    )
    tmp = ROOT / "tools" / ".logo_master.png"
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=channel)
        page = browser.new_page(viewport={"width": w, "height": MASTER_H})
        page.set_content(html)
        page.screenshot(path=str(tmp), omit_background=True)
        browser.close()
    img = Image.open(tmp).convert("RGBA")
    img.load()
    tmp.unlink()
    return img.crop(img.getchannel("A").getbbox())


def enclosing_radius(img):
    """Distancia máxima de un píxel visible al centro: así el logo cabe en las zonas seguras circulares."""
    a = img.getchannel("A").point(lambda v: 255 if v > 8 else 0)
    small = a.resize((a.width // 8, a.height // 8))
    cx, cy = small.width / 2, small.height / 2
    px = small.load()
    r = max(
        ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
        for y in range(small.height) for x in range(small.width) if px[x, y]
    )
    return r * 8


class Composer:
    def __init__(self, logo):
        self.logo = logo
        self.r = enclosing_radius(logo)

    def logo_for_radius(self, radius, mono=False):
        k = radius / self.r
        size = (max(1, round(self.logo.width * k)), max(1, round(self.logo.height * k)))
        img = self.logo.resize(size, Image.LANCZOS)
        if mono:  # iconos temáticos (Android 13+): solo cuenta el canal alfa
            white = Image.new("RGBA", img.size, (255, 255, 255, 255))
            white.putalpha(img.getchannel("A"))
            img = white
        return img

    def compose(self, w, h, radius, bg=None, shape="square", corner=0.0, mono=False):
        """Lienzo w×h con fondo opcional (square/rounded/circle) y el logo centrado."""
        s = 4  # supermuestreo de la forma de fondo
        canvas = Image.new("RGBA", (w * s, h * s), (0, 0, 0, 0))
        if bg:
            d = ImageDraw.Draw(canvas)
            box = [0, 0, w * s - 1, h * s - 1]
            if shape == "circle":
                d.ellipse(box, fill=bg)
            elif shape == "rounded":
                d.rounded_rectangle(box, radius=int(min(w, h) * s * corner), fill=bg)
            else:
                d.rectangle(box, fill=bg)
        canvas = canvas.resize((w, h), Image.LANCZOS)
        logo = self.logo_for_radius(radius, mono)
        canvas.alpha_composite(logo, ((w - logo.width) // 2, (h - logo.height) // 2))
        return canvas


def save(img, path, rgb=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    (img.convert("RGB") if rgb else img).save(path, optimize=True)


def build_pwa(c):
    save(c.compose(192, 192, 192 * 0.37, ICON_BG, "rounded", 0.22), PWA / "icon-192.png")
    save(c.compose(512, 512, 512 * 0.37, ICON_BG, "rounded", 0.22), PWA / "icon-512.png")
    # maskable: la zona segura es un círculo de radio 40 %
    save(c.compose(512, 512, 512 * 0.34, ICON_BG), PWA / "icon-maskable-512.png")
    save(c.compose(180, 180, 180 * 0.36, ICON_BG), PWA / "apple-touch-icon.png", rgb=True)


def build_android(c):
    for name, k in DENSITIES.items():
        mip = RES / f"mipmap-{name}"
        # Icono adaptativo: capa de 108 dp; la zona segura es un círculo de 66 dp (radio 33).
        fg = round(108 * k)
        save(c.compose(fg, fg, 30 * k), mip / "ic_launcher_foreground.png")
        save(c.compose(fg, fg, 30 * k, mono=True), mip / "ic_launcher_monochrome.png")
        # Iconos heredados (Android < 8): 48 dp
        lg = round(48 * k)
        save(c.compose(lg, lg, 17.5 * k, ICON_BG, "rounded", 0.2), mip / "ic_launcher.png")
        save(c.compose(lg, lg, 17 * k, ICON_BG, "circle"), mip / "ic_launcher_round.png")
        # Splash de Android 12+: icono de 288 dp que debe caber en un círculo de 192 dp.
        sp = round(288 * k)
        save(c.compose(sp, sp, 82 * k), RES / f"drawable-{name}" / "splash_icon.png")

    # Splash heredada (Android < 12 y fondo de la ventana de arranque): mismos tamaños que generó Capacitor.
    for folder in sorted(RES.glob("drawable*")):
        f = folder / "splash.png"
        if f.exists():
            with Image.open(f) as old:
                w, h = old.size
            save(c.compose(w, h, min(w, h) * 0.2, SPLASH_BG), f, rgb=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--channel", default="msedge", help="navegador instalado: msedge o chrome")
    ap.add_argument("--solo-pwa", action="store_true", help="no tocar los recursos de Android")
    args = ap.parse_args()
    comp = Composer(render_master(args.channel))
    build_pwa(comp)
    print("Iconos PWA escritos en", PWA, file=sys.stderr)
    if not args.solo_pwa and RES.exists():
        build_android(comp)
        print("Recursos Android escritos en", RES, file=sys.stderr)
