"""Radar: Akakçe'de fiyatı gerçekten düşen ürünleri bulur.

1. akakce.com/fiyati-dusen-urunler/?p=N listesinden düşüş yüzdesiyle adayları toplar.
2. Ürün sayfasında Akakçe'nin fiyat geçmişi notuna bakar: "Bu ürün son 1 ay içinde daha
   düşük fiyat gördü" yazıyorsa düşüş sahtedir (önce zam, sonra "indirim"), elenir.
3. Pazaryeri tekliflerinden (Trendyol, Hepsiburada, Amazon, N11 ...) en ucuzunu seçer ve
   Akakçe yönlendirmesinden gerçek ürün linkini çıkarır.
"""
from __future__ import annotations

import html as htmlmod
import logging
import re
import time
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from bs4 import BeautifulSoup

from ..http import get_text
from .akakce import BASE, _islands

log = logging.getLogger("aktuel")

FAKE_DROP_NOTE = "daha düşük fiyat gördü"


@dataclass
class Offer:
    marketplace: str      # "Trendyol", "Hepsiburada", "Amazon Türkiye", "N11" ...
    price: float
    ship: float
    redirect: str         # Akakçe yönlendirme yolu (/r/?pr=..&vd=..&pg=..)
    url: str | None = None


@dataclass
class Deal:
    id: str               # Akakçe ürün kodu
    name: str
    brand: str
    drop_pct: int         # Akakçe listesindeki düşüş yüzdesi
    page_url: str
    image_url: str | None = None
    offers: list[Offer] = field(default_factory=list)
    best: Offer | None = None
    note: str = ""        # Akakçe fiyat geçmişi notu


def _price(text: str) -> float:
    t = re.sub(r"[^\d,]", "", text).replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return 0.0


def list_candidates(pages: int, min_drop: int, sleep: float = 1.0) -> list[Deal]:
    out: dict[str, Deal] = {}
    for pg in range(1, pages + 1):
        try:
            soup = BeautifulSoup(get_text(f"{BASE}/fiyati-dusen-urunler/?p={pg}"), "html.parser")
        except Exception as e:
            log.warning("  radar listesi sayfa %d alınamadı: %s", pg, e)
            continue
        for li in soup.select("li[data-pr]"):
            a, pct, h3 = li.find("a"), li.select_one(".ps_v9 i"), li.select_one("h3")
            if not (a and pct and h3):
                continue
            drop = int(re.sub(r"\D", "", pct.get_text()) or 0)
            if drop < min_drop or li["data-pr"] in out:
                continue
            img = li.find("img")
            src = img.get("src") if img else None
            out[li["data-pr"]] = Deal(
                id=li["data-pr"], name=h3.get_text(strip=True), brand=li.get("data-mk", ""),
                drop_pct=drop, page_url=BASE + a["href"],
                image_url=("https:" + src) if src and src.startswith("//") else src,
            )
        time.sleep(sleep)
    return sorted(out.values(), key=lambda d: -d.drop_pct)


def inspect(deal: Deal, marketplaces: list[str]) -> Deal:
    """Ürün sayfasından fiyat geçmişi notunu ve pazaryeri tekliflerini doldurur."""
    page = get_text(deal.page_url)
    m = re.search(r'class="tool-tip[^"]*"><b>[^<]*</b><span>(.*?)</span>', page)
    deal.note = re.sub(r"<[^>]+>", "", m.group(1)) if m else ""
    og = re.search(r'<meta property="og:image" content="([^"]+)"', page)
    if og:  # büyük ürün resmi (listedeki küçük resim yerine)
        deal.image_url = og.group(1)
    offers: list[Offer] = []
    for isl in _islands(page):
        for pg in isl.get("initialPgList") or []:
            vd = pg.get("vdName") or ""
            f = re.search(r"f=([^&]+)", pg.get("url") or "")
            if not f:
                continue
            redirect = htmlmod.unescape(f.group(1)).replace("%2f", "/").replace("%3f", "?") \
                .replace("%3d", "=").replace("%26", "&")
            offers.append(Offer(vd, float(pg.get("price") or 0), float(pg.get("shipPrice") or 0), redirect))
            if not deal.image_url and pg.get("imageUrl"):
                deal.image_url = pg["imageUrl"]
    deal.offers = offers
    allowed = [o for o in offers if o.price > 0 and any(mp.lower() in o.marketplace.lower() for mp in marketplaces)]
    if allowed:
        deal.best = min(allowed, key=lambda o: o.price + o.ship)
    return deal


def is_real_deal(deal: Deal) -> bool:
    return FAKE_DROP_NOTE not in deal.note


_DROP_PARAMS = re.compile(r"^(utm_|gclid|fbclid|boutiqueId$|adjust_|aff|ref$|tag$)", re.I)


def clean_url(url: str) -> str:
    """İzleme parametrelerini atar; Amazon linkini /dp/ASIN biçimine indirir."""
    p = urlparse(url)
    if "amazon." in p.netloc:
        m = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", p.path)
        if m:
            return f"https://{p.netloc}/dp/{m.group(1)}"
    q = [(k, v) for k, v in parse_qsl(p.query) if not _DROP_PARAMS.match(k)]
    return urlunparse(p._replace(query=urlencode(q)))


def resolve_link(offer: Offer) -> str | None:
    """Akakçe yönlendirme sayfasından pazaryerindeki gerçek ürün linkini çıkarır."""
    try:
        page = get_text(BASE + offer.redirect)
    except Exception as e:
        log.warning("  link çözülemedi: %s", e)
        return None
    m = re.search(r"url=(https?://[^\"'<> ]+)", page)
    if not m:
        return None
    offer.url = clean_url(htmlmod.unescape(m.group(1)))
    return offer.url
