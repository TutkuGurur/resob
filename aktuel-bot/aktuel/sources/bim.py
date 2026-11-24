"""BİM'in resmi afiş sayfası (bim.com.tr/Categories/680/afisler.aspx).

Tüm afiş grupları tek sayfada; her grubun önünde tarih butonu (\"25 Kasım Çarşamba\",
\"21-27 Kasım\" ...) ve altında tam boy görseller (data-bigimg) var.
"""
from __future__ import annotations

import re
from datetime import date

from bs4 import BeautifulSoup

from ..dates import parse_tr_range
from ..http import get_text
from ..models import Brochure, Page

URL = "https://www.bim.com.tr/Categories/680/afisler.aspx"


def list_brochures(market_key: str, today: date | None = None) -> list[Brochure]:
    today = today or date.today()
    soup = BeautifulSoup(get_text(URL), "html.parser")
    out: list[Brochure] = []
    for item in soup.select("div.row.item"):
        btn = item.find_previous("a", class_="triangle")
        label = re.sub(r"\s+", " ", btn.get_text(" ", strip=True)) if btn else ""
        imgs = [a["data-bigimg"] for a in item.select("a.small[data-bigimg]")]
        if not imgs:
            imgs = [a["href"] for a in item.select("a.fancyboxImage[href]")]
        if not imgs:
            continue
        start, end = parse_tr_range(label, today)
        uid = re.sub(r"\.\w+$", "", imgs[0].rsplit("/", 1)[-1])
        out.append(Brochure(
            id=f"bim:{uid}",
            market=market_key,
            title=label,
            start=start,
            end=end,
            source_url=URL,
            pages=[Page(image_url=u) for u in imgs],
        ))
    return sorted(out, key=lambda b: (b.start or date.min), reverse=True)


def fetch_pages(b: Brochure) -> Brochure:
    return b  # sayfalar listeleme sırasında zaten dolu
