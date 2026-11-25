"""marketfiyati.org.tr (Ticaret Bakanlığı / TÜBİTAK) fiyat verisi.

Aynı ürünün yakındaki BİM, A101, ŞOK, Migros, CarrefourSA, Hakmar, Tarım Kredi
mağazalarındaki güncel fiyatlarını verir. Site API'si:
  POST api/v2/nearest  {latitude, longitude, distance(km)} -> yakın mağazalar
  POST api/v2/search   {keywords, pages, size<=25, latitude, longitude, distance, depots}
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import requests

from ..http import UA

API = "https://api.marketfiyati.org.tr/api/v2/"
PAGE_SIZE = 25
log = logging.getLogger("aktuel")

_s = requests.Session()
_s.headers.update({"User-Agent": UA, "Content-Type": "application/json",
                   "Accept": "application/json", "Origin": "https://marketfiyati.org.tr",
                   "Referer": "https://marketfiyati.org.tr/"})


@dataclass
class Offer:
    market: str        # "bim", "a101", "sok", "migros", "carrefour", "hakmar", "tarim_kredi"
    price: float
    store: str
    discount: bool = False


@dataclass
class Product:
    id: str
    title: str
    brand: str
    size: str
    image_url: str | None
    category: str
    offers: dict[str, Offer] = field(default_factory=dict)  # market -> en ucuz şube teklifi
    keyword: str = ""

    @property
    def sorted_offers(self) -> list[Offer]:
        return sorted(self.offers.values(), key=lambda o: o.price)

    @property
    def spread(self) -> float:
        p = [o.price for o in self.offers.values()]
        return (max(p) - min(p)) / min(p) if p and min(p) > 0 else 0.0

    @property
    def diff(self) -> float:
        p = [o.price for o in self.offers.values()]
        return max(p) - min(p) if p else 0.0


def _post(path: str, body: dict, retries: int = 5) -> dict | list:
    err = None
    for i in range(retries):
        try:
            r = _s.post(API + path, json=body, timeout=40)
            if r.status_code == 200:
                time.sleep(1.0)  # siteyi yormamak için
                return r.json()
            err = RuntimeError(f"HTTP {r.status_code}")
        except requests.RequestException as e:
            err = e
        time.sleep(4 * (i + 1))
    raise RuntimeError(f"marketfiyati {path}: {err}")


def nearest_depots(lat: float, lon: float, km: float) -> list[str]:
    return [d["id"] for d in _post("nearest", {"latitude": lat, "longitude": lon, "distance": km})]


def _to_product(p: dict, keyword: str) -> Product:
    offers: dict[str, Offer] = {}
    for x in p.get("productDepotInfoList") or []:
        m, price = x.get("marketAdi"), x.get("price")
        if not m or not price:
            continue
        if m not in offers or price < offers[m].price:
            offers[m] = Offer(m, float(price), x.get("depotName", ""), bool(x.get("discount")))
    return Product(
        id=p["id"], title=(p.get("title") or "").strip(), brand=p.get("brand") or "",
        size=p.get("refinedVolumeOrWeight") or "", image_url=p.get("imageUrl"),
        category=p.get("main_category") or "", offers=offers, keyword=keyword,
    )


def collect(keywords: list[str], lat: float, lon: float, km: float,
            pages: int = 3) -> dict[str, Product]:
    depots = nearest_depots(lat, lon, km)
    log.info("[Market Fiyatı] %d yakın mağaza", len(depots))
    out: dict[str, Product] = {}
    for kw in keywords:
        for pg in range(pages):
            try:
                d = _post("search", {"keywords": kw, "pages": pg, "size": PAGE_SIZE,
                                     "latitude": lat, "longitude": lon, "distance": km,
                                     "depots": depots})
            except RuntimeError as e:
                log.warning("  '%s' sayfa %d alınamadı: %s", kw, pg, e)
                break
            items = d.get("content") or []
            for p in items:
                if p.get("id") and p["id"] not in out:
                    out[p["id"]] = _to_product(p, kw)
            if len(items) < PAGE_SIZE:
                break
    log.info("[Market Fiyatı] %d ürün toplandı", len(out))
    return out
