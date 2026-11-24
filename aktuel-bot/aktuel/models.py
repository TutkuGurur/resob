from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class Product:
    name: str
    price: str | None = None  # "8.999,00" gibi, TL işareti olmadan


@dataclass
class Page:
    image_url: str
    products: list[Product] = field(default_factory=list)


@dataclass
class Brochure:
    id: str               # kalıcı kimlik, örn. "akakce:65546" ya da "bim:fb59c2e2-..."
    market: str           # config'teki market anahtarı, örn. "a101"
    title: str            # "Aldın Aldın", "Haftanın Fırsatları" ...
    start: date | None
    end: date | None
    source_url: str
    pages: list[Page] = field(default_factory=list)

    @property
    def products(self) -> list[Product]:
        seen, out = set(), []
        for p in self.pages:
            for pr in p.products:
                key = pr.name.lower()
                if key not in seen:
                    seen.add(key)
                    out.append(pr)
        return out
