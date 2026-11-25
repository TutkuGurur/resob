"""Fiyat karşılaştırma görselleri: her ürün için marketlere göre fiyat listesi + kapak."""
from __future__ import annotations

from datetime import date

from PIL import Image, ImageDraw, ImageFilter, ImageOps

from .dates import MONTH_NAMES
from .render import POST_SIZE, STORY_SIZE, _font, _hex

MARKET_STYLE = {
    "bim": ("BİM", "#E30613", "#FFFFFF"),
    "a101": ("A101", "#00A6E2", "#FFFFFF"),
    "sok": ("ŞOK", "#FFD400", "#1B2A8C"),
    "migros": ("Migros", "#FF7A00", "#FFFFFF"),
    "carrefour": ("CarrefourSA", "#0A4DA2", "#FFFFFF"),
    "hakmar": ("Hakmar", "#00A651", "#FFFFFF"),
    "tarim_kredi": ("Tarım Kredi", "#2E7D32", "#FFFFFF"),
}

BG_TOP, BG_BOTTOM = (38, 16, 92), (14, 8, 40)
ACCENT = (255, 214, 0)
GOOD = (34, 197, 94)
BAD = (248, 113, 113)
WHITE = (255, 255, 255)
MUTED = (190, 180, 230)


def market_name(m: str) -> str:
    return MARKET_STYLE.get(m, (m.title(), "", ""))[0]


def tl(v: float) -> str:
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s} TL"


def date_tr(d: date) -> str:
    return f"{d.day} {MONTH_NAMES[d.month]} {d.year}"


def _gradient(size) -> Image.Image:
    w, h = size
    top = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        top.putpixel((0, y), tuple(int(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3)))
    im = top.resize(size)
    # hafif parıltı
    glow = Image.new("L", size, 0)
    ImageDraw.Draw(glow).ellipse((w * 0.15, -h * 0.15, w * 0.85, h * 0.35), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    im.paste(Image.new("RGB", size, (120, 70, 255)), (0, 0), glow)
    return im


def _wrap(draw, text, font, max_w, max_lines=2):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while draw.textlength(lines[-1] + "…", font=font) > max_w and " " in lines[-1]:
            lines[-1] = lines[-1].rsplit(" ", 1)[0]
        lines[-1] += "…"
    return lines


def _product_card(canvas, img: Image.Image | None, box):
    x0, y0, x1, y1 = box
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle(box, 36, fill=WHITE)
    if img is None:
        return
    im = img.convert("RGBA")
    pad = 30
    im = ImageOps.contain(im, (x1 - x0 - 2 * pad, y1 - y0 - 2 * pad), Image.LANCZOS)
    px = x0 + (x1 - x0 - im.width) // 2
    py = y0 + (y1 - y0 - im.height) // 2
    canvas.paste(im, (px, py), im)


def render_product(product, img, idx: int, total: int, today: date, area: str, handle: str,
                   size=POST_SIZE) -> Image.Image:
    W, H = size
    story = H > 1500
    c = _gradient(size)
    d = ImageDraw.Draw(c)
    top = 210 if story else 44
    # başlık şeridi
    d.text((60, top + 22), "AYNI ÜRÜN, FARKLI FİYAT", font=_font("ExtraBold", 40), fill=ACCENT, anchor="lm")
    d.rounded_rectangle((W - 170, top, W - 60, top + 46), 23, fill=(76, 52, 150), outline=MUTED, width=2)
    d.text((W - 115, top + 23), f"{idx}/{total}", font=_font("Bold", 26), fill=WHITE, anchor="mm")

    card_h = 600 if story else 380
    card_top = top + 76
    _product_card(c, img, (60, card_top, W - 60, card_top + card_h))

    y = card_top + card_h + 34
    f_title = _font("ExtraBold", 50)
    for line in _wrap(d, product.title, f_title, W - 120, 2):
        d.text((60, y), line, font=f_title, fill=WHITE)
        y += 60
    norm = lambda t: t.lower().replace(" ", "").replace("ı", "i")
    if product.size and norm(product.size) not in norm(product.title):
        d.text((60, y + 4), product.size, font=_font("SemiBold", 30), fill=MUTED)
        y += 44
    y += 18

    offers = product.sorted_offers
    footer_h = 150 if not story else 330
    avail = H - footer_h - y
    row_h = max(64, min(130 if story else 96, avail // max(1, len(offers))))
    cheapest, priciest = offers[0].price, offers[-1].price
    f_name = _font("Bold", int(row_h * 0.36))
    f_price = _font("ExtraBold", int(row_h * 0.44))
    for i, o in enumerate(offers):
        name, bg, fg = MARKET_STYLE.get(o.market, (o.market, "#666666", "#FFFFFF"))
        ry0, ry1 = y, y + row_h - 12
        is_best = o.price == cheapest
        row_fill = (22, 101, 52) if is_best else (255, 255, 255)
        if is_best:
            d.rounded_rectangle((60, ry0, W - 60, ry1), 20, fill=row_fill)
        else:
            overlay = Image.new("RGBA", (W - 120, ry1 - ry0), (255, 255, 255, 22))
            c.paste(overlay, (60, ry0), overlay)
        # market rozeti
        pill_w = 280
        d.rounded_rectangle((76, ry0 + 10, 76 + pill_w, ry1 - 10), 16, fill=_hex(bg))
        d.text((76 + pill_w / 2, (ry0 + ry1) / 2), name, font=f_name, fill=_hex(fg), anchor="mm")
        if is_best:
            d.text((76 + pill_w + 24, (ry0 + ry1) / 2), "EN UCUZ", font=_font("ExtraBold", int(row_h * 0.3)),
                   fill=ACCENT, anchor="lm")
        color = WHITE if is_best else (BAD if o.price == priciest and len(offers) > 1 else WHITE)
        d.text((W - 84, (ry0 + ry1) / 2), tl(o.price), font=f_price, fill=color, anchor="rm")
        y += row_h

    # alt bilgi
    fy = H - footer_h + (20 if not story else 40)
    if len(offers) > 1:
        msg = f"Fark: {tl(product.diff)}  ·  %{round(product.spread * 100)}"
        d.text((W / 2, fy + 10), msg, font=_font("ExtraBold", 40), fill=ACCENT, anchor="mm")
    d.text((W / 2, fy + 62), f"{date_tr(today)} · {area} · Kaynak: marketfiyati.org.tr",
           font=_font("SemiBold", 22), fill=MUTED, anchor="mm")
    if handle:
        d.text((W / 2, fy + 98), f"@{handle}", font=_font("Bold", 26), fill=WHITE, anchor="mm")
    return c


def render_cover(products, imgs, today: date, area: str, handle: str, size=POST_SIZE) -> Image.Image:
    W, H = size
    story = H > 1500
    c = _gradient(size)
    d = ImageDraw.Draw(c)
    y = 260 if story else 90
    for line, f in (("Aynı ürün,", _font("ExtraBold", 110)), ("farklı fiyat.", _font("ExtraBold", 110))):
        d.text((W / 2, y), line, font=f, fill=WHITE, anchor="mm")
        y += 118
    d.text((W / 2, y + 10), "Bugün hangi market daha ucuz?", font=_font("Bold", 42), fill=ACCENT, anchor="mm")
    y += 70
    d.text((W / 2, y + 6), f"{date_tr(today)} · {area}", font=_font("SemiBold", 28), fill=MUTED, anchor="mm")
    y += 60

    # ürün listesi
    row_h = 150 if story else 136
    for p, im in zip(products, imgs):
        d.rounded_rectangle((60, y, W - 60, y + row_h - 16), 26, fill=(255, 255, 255))
        thumb_box = (76, y + 12, 76 + row_h - 40, y + row_h - 28)
        if im is not None:
            t = ImageOps.contain(im.convert("RGBA"), (thumb_box[2] - thumb_box[0], thumb_box[3] - thumb_box[1]))
            c.paste(t, (thumb_box[0] + (thumb_box[2] - thumb_box[0] - t.width) // 2,
                        thumb_box[1] + (thumb_box[3] - thumb_box[1] - t.height) // 2), t)
        tx = thumb_box[2] + 24
        best = p.sorted_offers[0]
        f_t = _font("Bold", 32)
        title = _wrap(d, p.title, f_t, W - 60 - 24 - tx - 10, 1)[0]
        d.text((tx, y + 22), title, font=f_t, fill=(20, 12, 50))
        d.text((tx, y + 70), f"En ucuz: {market_name(best.market)} {tl(best.price)}",
               font=_font("SemiBold", 28), fill=(22, 101, 52))
        y += row_h
    d.text((W / 2, H - (300 if story else 70)), "Kaydır →  Tüm market fiyatları", font=_font("Bold", 34),
           fill=WHITE, anchor="mm")
    if handle:
        d.text((W / 2, H - (250 if story else 28)), f"@{handle} · Kaynak: marketfiyati.org.tr",
               font=_font("SemiBold", 22), fill=MUTED, anchor="mm")
    return c
