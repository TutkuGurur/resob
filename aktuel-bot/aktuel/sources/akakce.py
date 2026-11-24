"""Akakçe broşür arşivi (akakce.com/brosurler/<market>).

Sayfalar Astro ile render ediliyor; veriler <astro-island props="..."> içinde
"devalue" formatında ([tip, değer] çiftleri) JSON olarak duruyor.
"""
from __future__ import annotations

import html
import json
import re
from datetime import date

from ..dates import parse_tr_date
from ..http import get_text
from ..models import Brochure, Page, Product

BASE = "https://www.akakce.com"


def _dv(v):
    """Astro/devalue çözücü: [0, x] -> x, [1, [...]] -> liste."""
    if isinstance(v, list) and len(v) == 2 and isinstance(v[0], int):
        kind, x = v
        if kind == 1 and isinstance(x, list):
            return [_dv(i) for i in x]
        return _dv(x)
    if isinstance(v, dict):
        return {k: _dv(val) for k, val in v.items()}
    return v


def _islands(page_html: str) -> list[dict]:
    out = []
    for raw in re.findall(r'<astro-island[^>]*?\sprops="([^"]*)"', page_html):
        try:
            out.append(_dv(json.loads(html.unescape(raw))))
        except (ValueError, TypeError):
            continue
    return out


def _walk(obj, key):
    """İç içe yapıda `key` anahtarlı tüm değerleri bulur."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                yield v
            yield from _walk(v, key)
    elif isinstance(obj, list):
        for i in obj:
            yield from _walk(i, key)


def list_brochures(market_key: str, slug: str, today: date | None = None) -> list[Brochure]:
    """Marketin Akakçe sayfasındaki broşürleri (sayfalar hariç) listeler."""
    today = today or date.today()
    page = get_text(f"{BASE}/brosurler/{slug}")
    seen: dict[int, Brochure] = {}
    for isl in _islands(page):
        for item in _iter_brochure_items(isl):
            if item.get("vdNameUrlForm") != slug:
                continue
            bid = item["brochureId"]
            if bid in seen:
                continue
            seen[bid] = Brochure(
                id=f"akakce:{bid}",
                market=market_key,
                title=item.get("brochureName") or "",
                start=parse_tr_date(item.get("startDate") or "", today),
                end=parse_tr_date(item.get("endDate") or "", today),
                source_url=BASE + item["brochureUrl"],
            )
    return sorted(seen.values(), key=lambda b: (b.start or date.min), reverse=True)


def _iter_brochure_items(obj):
    if isinstance(obj, dict):
        if "brochureId" in obj and "brochureUrl" in obj:
            yield obj
        for v in obj.values():
            yield from _iter_brochure_items(v)
    elif isinstance(obj, list):
        for i in obj:
            yield from _iter_brochure_items(i)


def fetch_pages(b: Brochure) -> Brochure:
    """Broşürün sayfa görsellerini ve sayfadaki ürün etiketlerini doldurur."""
    page = get_text(b.source_url)
    pages: list[Page] = []
    for isl in _islands(page):
        for plist in _walk(isl, "pages"):
            if not isinstance(plist, list) or not plist or not isinstance(plist[0], dict):
                continue
            if "highResImageUrl" not in plist[0]:
                continue
            for p in plist:
                prods = []
                for c in p.get("clips") or []:
                    if c.get("name"):
                        prods.append(Product(name=c["name"].strip(), price=c.get("priceFormatted")))
                pages.append(Page(image_url=p["highResImageUrl"], products=prods))
            break
        if pages:
            break
    b.pages = pages
    return b
