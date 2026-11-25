"""Radar hikâye görseli (1080x1920)."""
from __future__ import annotations

from datetime import date

from PIL import Image, ImageDraw, ImageFilter, ImageOps

from .render import STORY_SIZE, _font, _hex
from .render_compare import _wrap, date_tr, tl

BG_TOP, BG_BOTTOM = (6, 46, 56), (3, 16, 24)
TEAL = (45, 212, 191)
ACCENT = (255, 214, 0)
WHITE = (255, 255, 255)
MUTED = (160, 200, 205)

MARKETPLACE_STYLE = {
    "trendyol": ("Trendyol", "#F27A1A", "#FFFFFF"),
    "hepsiburada": ("Hepsiburada", "#FF6000", "#FFFFFF"),
    "amazon": ("Amazon", "#232F3E", "#FF9900"),
    "n11": ("n11", "#5B2C8F", "#FFFFFF"),
}


def marketplace_style(name: str):
    n = name.lower()
    for k, v in MARKETPLACE_STYLE.items():
        if k in n:
            return v
    return (name, "#334155", "#FFFFFF")


def _bg(size):
    w, h = size
    col = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        col.putpixel((0, y), tuple(int(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3)))
    im = col.resize(size)
    # radar halkaları
    rings = Image.new("L", size, 0)
    d = ImageDraw.Draw(rings)
    cx, cy = w // 2, int(h * 0.30)
    for r in range(180, 1400, 170):
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=38, width=3)
    d.line((cx, cy - 1400, cx, cy + 1400), fill=22, width=2)
    d.line((cx - 1400, cy, cx + 1400, cy), fill=22, width=2)
    im.paste(Image.new("RGB", size, TEAL), (0, 0), rings)
    return im


def _radar_icon(d: ImageDraw.ImageDraw, x: int, y: int, r: int):
    for k in (1.0, 0.66, 0.33):
        rr = int(r * k)
        d.ellipse((x - rr, y - rr, x + rr, y + rr), outline=TEAL, width=5)
    d.pieslice((x - r, y - r, x + r, y + r), -90, -40, fill=TEAL)
    d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=WHITE)


def render_story(deal, img: Image.Image | None, idx: int, total: int, today: date, handle: str,
                 keyword: str = "RADAR") -> Image.Image:
    W, H = STORY_SIZE
    c = _bg(STORY_SIZE)
    d = ImageDraw.Draw(c)

    # başlık (Instagram arayüzü üstte ~200 px kaplar)
    top = 215
    _radar_icon(d, 112, top + 45, 44)
    d.text((180, top + 18), "RADAR", font=_font("ExtraBold", 64), fill=WHITE, anchor="lm")
    d.text((182, top + 78), "Fiyatı gerçekten düşen ürün", font=_font("SemiBold", 30), fill=MUTED, anchor="lm")
    d.rounded_rectangle((W - 190, top + 20, W - 60, top + 72), 26, outline=TEAL, width=3)
    d.text((W - 125, top + 46), f"{idx}/{total}", font=_font("Bold", 30), fill=WHITE, anchor="mm")

    # ürün kartı
    card = (60, top + 140, W - 60, top + 140 + 640)
    d.rounded_rectangle(card, 40, fill=WHITE)
    if img is not None:
        im = ImageOps.contain(img.convert("RGBA"), (card[2] - card[0] - 80, card[3] - card[1] - 80), Image.LANCZOS)
        c.paste(im, (card[0] + (card[2] - card[0] - im.width) // 2, card[1] + (card[3] - card[1] - im.height) // 2), im)
    # düşüş rozeti kartın köşesinde
    badge = f"%{deal.drop_pct} DÜŞTÜ"
    fb = _font("ExtraBold", 40)
    bw = d.textlength(badge, font=fb) + 56
    d.rounded_rectangle((card[2] - bw - 24, card[1] + 24, card[2] - 24, card[1] + 96), 36, fill=(220, 38, 38))
    d.text((card[2] - 24 - bw / 2, card[1] + 60), badge, font=fb, fill=WHITE, anchor="mm")

    y = card[3] + 40
    f_title = _font("ExtraBold", 48)
    for line in _wrap(d, deal.name, f_title, W - 120, 2):
        d.text((60, y), line, font=f_title, fill=WHITE)
        y += 60
    y += 20

    # fiyat + pazaryeri
    best = deal.best
    price = tl(best.price)
    d.text((60, y), price, font=_font("ExtraBold", 96), fill=ACCENT)
    name, bg, fg = marketplace_style(best.marketplace)
    f_mp = _font("Bold", 38)
    mw = d.textlength(name, font=f_mp) + 60
    d.rounded_rectangle((W - 60 - mw, y + 18, W - 60, y + 96), 22, fill=_hex(bg))
    d.text((W - 60 - mw / 2, y + 57), name, font=f_mp, fill=_hex(fg), anchor="mm")
    y += 130
    d.text((60, y), "✓ Son 1 ayın en düşük fiyatı".replace("✓ ", ""), font=_font("Bold", 36), fill=TEAL)
    if best.ship:
        d.text((W - 60, y + 4), f"+{tl(best.ship)} kargo", font=_font("SemiBold", 28), fill=MUTED, anchor="ra")

    # çağrı kutusu (alttaki ~250 px Instagram arayüzü)
    cta_top = H - 520
    d.rounded_rectangle((60, cta_top, W - 60, cta_top + 210), 36, fill=TEAL)
    d.text((W / 2, cta_top + 62), "Linki almak için", font=_font("Bold", 40), fill=BG_BOTTOM, anchor="mm")
    d.text((W / 2, cta_top + 128), f"bu hikâyeye  {keyword}  yaz", font=_font("ExtraBold", 54),
           fill=BG_BOTTOM, anchor="mm")
    d.text((W / 2, cta_top + 182), "DM'den hemen gönderelim", font=_font("SemiBold", 30), fill=BG_BOTTOM, anchor="mm")
    foot = f"{date_tr(today)} · Fiyatlar değişebilir · Kaynak: akakce.com"
    d.text((W / 2, cta_top + 250), foot, font=_font("SemiBold", 22), fill=MUTED, anchor="mm")
    if handle:
        d.text((W / 2, cta_top + 286), f"@{handle}", font=_font("Bold", 28), fill=WHITE, anchor="mm")
    return c
