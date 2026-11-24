from __future__ import annotations

import re
from datetime import date

from .dates import human_range
from .models import Brochure

IG_CAPTION_LIMIT = 2200
IG_HASHTAG_LIMIT = 30


def title_line(b: Brochure) -> str:
    # BİM başlıkları tarih metni ("25 Kasım Çarşamba"); onları "Aktüel Ürünler" yap.
    if not b.title or re.match(r"^\d{1,2}\s*[-\s]", b.title):
        return "Aktüel Ürünler"
    return b.title


def when_text(b: Brochure, today: date) -> str:
    if not b.start:
        return ""
    delta = (b.start - today).days
    if delta == 0:
        return "Bugün mağazalarda!"
    if delta == 1:
        return "Yarın mağazalarda!"
    if delta > 1:
        return f"{delta} gün sonra mağazalarda!"
    return ""


def _compose(b, market, cfg, today, part, parts, n_products) -> str:
    rng = human_range(b.start, b.end)
    lines = [f"🛒 {market['name']} – {title_line(b)}"]
    if rng:
        lines.append(f"📅 {rng}")
    w = when_text(b, today)
    if w:
        lines.append(f"⏰ {w}")
    if parts > 1:
        lines.append(f"📄 Bölüm {part}/{parts}")
    lines.append("")

    prods = b.products[:n_products]
    if prods:
        lines.append("🔥 Öne çıkanlar:")
        lines += [f"• {p.name}" + (f" – {p.price} TL" if p.price else "") for p in prods]
        lines.append("")

    if len(b.pages) > 1:
        lines.append("👉 Tüm sayfalar için kaydır!")
    lines.append("🔔 Hiçbir aktüeli kaçırmamak için takip et, kaydet ve arkadaşına gönder.")
    lines.append("ℹ️ Fiyat ve stoklar marketin broşürüne göredir, değişebilir.")
    if cfg.AD_DISCLOSURE:
        lines.append(cfg.AD_DISCLOSURE)
    lines.append("")

    tags: list[str] = []
    for t in market["tags"] + cfg.COMMON_TAGS:
        if t not in tags:
            tags.append(t)
    lines.append(" ".join("#" + t for t in tags[:IG_HASHTAG_LIMIT]))
    return "\n".join(lines)


def build(b: Brochure, market: dict, cfg, today: date, part: int = 1, parts: int = 1) -> str:
    n = cfg.CAPTION_TOP_PRODUCTS
    text = _compose(b, market, cfg, today, part, parts, n)
    while len(text) > IG_CAPTION_LIMIT and n > 0:
        n -= 1
        text = _compose(b, market, cfg, today, part, parts, n)
    return text[:IG_CAPTION_LIMIT]
