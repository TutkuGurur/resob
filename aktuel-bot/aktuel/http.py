from __future__ import annotations

import time

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")

_session = requests.Session()
_session.headers.update({"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9"})


def get(url: str, *, retries: int = 3, timeout: int = 30, **kw) -> requests.Response:
    last = None
    for i in range(retries):
        try:
            r = _session.get(url, timeout=timeout, **kw)
            if r.status_code == 200:
                return r
            last = RuntimeError(f"HTTP {r.status_code}: {url}")
        except requests.RequestException as e:  # ağ hatası
            last = e
        time.sleep(2 * (i + 1))
    raise last  # type: ignore[misc]


def get_text(url: str) -> str:
    r = get(url)
    if "charset" not in r.headers.get("Content-Type", "").lower():
        r.encoding = "utf-8"  # Akakçe charset bildirmiyor; requests yanlışlıkla latin-1 seçiyor
    return r.text


def get_bytes(url: str) -> bytes:
    return get(url, timeout=60).content
