"""Broşür sayfalarından Instagram gönderi (1080x1350) ve hikâye (1080x1920) görselleri üretir.

Broşür sayfası kesilmeden ortalanır; boşluklar sayfanın bulanık ve koyulaştırılmış
hâliyle doldurulur. Üstte market renginde başlık şeridi, altta sayfa adı yer alır.
"""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
POST_SIZE = (1080, 1350)
STORY_SIZE = (1080, 1920)


def _font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / f"Inter-{weight}.otf"), size)


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def load(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    return im.convert("RGB")


def _background(page: Image.Image, size: tuple[int, int]) -> Image.Image:
    bg = ImageOps.fit(page, size, Image.LANCZOS)
    bg = bg.filter(ImageFilter.GaussianBlur(40))
    dark = Image.new("RGB", size, (0, 0, 0))
    return Image.blend(bg, dark, 0.45)


def _paste_fit(canvas: Image.Image, page: Image.Image, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    scale = min(bw / page.width, bh / page.height)
    w, h = int(page.width * scale), int(page.height * scale)
    fg = page.resize((w, h), Image.LANCZOS)
    px, py = x0 + (bw - w) // 2, y0 + (bh - h) // 2
    # hafif gölge
    shadow = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((20, 20, w + 20, h + 20), 18, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas.paste(shadow, (px - 20, py - 12), shadow)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), 14, fill=255)
    canvas.paste(fg, (px, py), mask)


def _fit_text(draw, text, weight, max_size, max_width):
    size = max_size
    while size > 18:
        f = _font(weight, size)
        if draw.textlength(text, font=f) <= max_width:
            return f
        size -= 2
    return _font(weight, size)


def _header(canvas, market: dict, title: str, subtitle: str, top: int, height: int) -> None:
    W = canvas.width
    d = ImageDraw.Draw(canvas)
    color, tcolor = _hex(market["color"]), _hex(market["text_color"])
    pad = 40
    d.rounded_rectangle((pad, top, W - pad, top + height), 28, fill=color)
    # market adı rozeti
    name = market["name"].upper()
    f_name = _font("ExtraBold", int(height * 0.42))
    nw = d.textlength(name, font=f_name)
    d.text((pad + 34, top + height / 2), name, font=f_name, fill=tcolor, anchor="lm")
    # ayırıcı
    sx = pad + 34 + nw + 26
    d.line((sx, top + height * 0.22, sx, top + height * 0.78), fill=tcolor, width=3)
    # başlık + tarih
    tx = sx + 26
    maxw = W - pad - 30 - tx
    f_t = _fit_text(d, title, "Bold", int(height * 0.27), maxw)
    f_s = _fit_text(d, subtitle, "SemiBold", int(height * 0.22), maxw)
    d.text((tx, top + height * 0.36), title, font=f_t, fill=tcolor, anchor="lm")
    d.text((tx, top + height * 0.68), subtitle, font=f_s, fill=tcolor, anchor="lm")


def _footer(canvas, text: str, y: int, size: int = 30) -> None:
    d = ImageDraw.Draw(canvas)
    f = _font("SemiBold", size)
    d.text((canvas.width / 2, y), text, font=f, fill=(255, 255, 255), anchor="mm")


def render_post(page: Image.Image, market: dict, title: str, subtitle: str,
                footer: str) -> Image.Image:
    W, H = POST_SIZE
    c = _background(page, POST_SIZE)
    head_top, head_h = 28, 118
    _header(c, market, title, subtitle, head_top, head_h)
    _paste_fit(c, page, (40, head_top + head_h + 22, W - 40, H - 62))
    _footer(c, footer, H - 32, 28)
    return c


def render_story(page: Image.Image, market: dict, title: str, subtitle: str,
                 footer: str) -> Image.Image:
    W, H = STORY_SIZE
    c = _background(page, STORY_SIZE)
    # Instagram arayüzü üstte ~200px, altta ~250px kaplar; içerik güvenli alanda.
    head_top, head_h = 200, 150
    _header(c, market, title, subtitle, head_top, head_h)
    _paste_fit(c, page, (40, head_top + head_h + 30, W - 40, H - 290))
    _footer(c, footer, H - 240, 34)
    return c


def save_jpeg(im: Image.Image, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "JPEG", quality=90, optimize=True, progressive=True)
    return path
