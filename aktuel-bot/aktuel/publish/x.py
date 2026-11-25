"""X (Twitter) paylaşımı — X API v2, OAuth 1.0a (kendi hesabında paylaşım için en basit yol).

Gerekli ortam değişkenleri (developer.x.com → uygulama → Keys and tokens; izin: Read and Write):
  X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET

Not: X API kullandıkça ücretli. İçinde link olan postlar çok daha pahalı olduğu için
bot link koymaz.
"""
from __future__ import annotations

import logging
import os
import time
import unicodedata
from pathlib import Path

import requests
from requests_oauthlib import OAuth1

log = logging.getLogger("aktuel")
API = "https://api.x.com/2"
MAX_IMAGES = 4
MAX_WEIGHT = 280


class XError(RuntimeError):
    pass


def weight(text: str) -> int:
    """X'in karakter sayımı (yaklaşık): Latin/Türkçe harfler 1, emoji ve CJK 2."""
    w = 0
    for ch in text:
        cp = ord(ch)
        if unicodedata.category(ch) in ("Mn", "Cf") or 0xFE00 <= cp <= 0xFE0F or cp == 0x20E3:
            continue  # birleştirici işaretler / emoji varyasyon seçicileri
        w += 1 if cp <= 0x10FF or 0x2000 <= cp <= 0x200D or 0x2010 <= cp <= 0x201F \
            or 0x2032 <= cp <= 0x2037 else 2
    return w


def fit(lines: list[str], tail: str = "") -> str:
    """Satırları 280 ağırlığa sığacak kadar alır; tail (hashtag) sığarsa sona ekler."""
    out: list[str] = []
    for ln in lines:
        cand = "\n".join(out + [ln])
        if weight(cand) > MAX_WEIGHT:
            break
        out.append(ln)
    text = "\n".join(out).rstrip()
    if tail and weight(text + "\n\n" + tail) <= MAX_WEIGHT:
        text += "\n\n" + tail
    return text


class X:
    def __init__(self):
        self.auth = OAuth1(os.environ["X_API_KEY"], os.environ["X_API_SECRET"],
                           os.environ["X_ACCESS_TOKEN"], os.environ["X_ACCESS_SECRET"])

    @classmethod
    def configured(cls) -> bool:
        return all(os.environ.get(k) for k in ("X_API_KEY", "X_API_SECRET",
                                                "X_ACCESS_TOKEN", "X_ACCESS_SECRET"))

    def _req(self, method: str, path: str, **kw) -> dict:
        for attempt in range(4):
            r = requests.request(method, f"{API}/{path}", auth=self.auth, timeout=90, **kw)
            if r.status_code == 429:  # hız sınırı
                reset = int(r.headers.get("x-rate-limit-reset", time.time() + 60))
                time.sleep(min(max(reset - time.time(), 5), 300))
                continue
            try:
                body = r.json()
            except ValueError:
                body = {"raw": r.text[:300]}
            if r.status_code >= 400 or (body.get("errors") and not body.get("data")):
                raise XError(f"{method} {path} -> {r.status_code}: {body}")
            return body
        raise XError(f"{method} {path}: hız sınırı aşılamadı")

    def whoami(self) -> dict:
        return self._req("GET", "users/me")["data"]

    def upload(self, path: Path) -> str:
        with open(path, "rb") as fh:
            body = self._req("POST", "media/upload",
                             files={"media": (path.name, fh, "image/jpeg")},
                             data={"media_category": "tweet_image", "media_type": "image/jpeg"})
        data = body.get("data") or body
        mid = data.get("id") or data.get("media_id_string") or data.get("media_id")
        if not mid:
            raise XError(f"medya yüklenemedi: {body}")
        return str(mid)

    def post(self, text: str, images: list[Path] | None = None, reply_to: str | None = None) -> str:
        payload: dict = {"text": text}
        if images:
            payload["media"] = {"media_ids": [self.upload(p) for p in images[:MAX_IMAGES]]}
        if reply_to:
            payload["reply"] = {"in_reply_to_tweet_id": reply_to}
        return self._req("POST", "tweets", json=payload)["data"]["id"]

    def thread(self, first_text: str, images: list[Path], max_posts: int,
               more_text: str = "👇 Devamı") -> list[str]:
        """Görselleri 4'erli gruplar hâlinde zincir (thread) olarak paylaşır."""
        groups = [images[i:i + MAX_IMAGES] for i in range(0, len(images), MAX_IMAGES)][:max_posts]
        ids: list[str] = []
        for i, g in enumerate(groups):
            text = first_text if i == 0 else f"{more_text} ({i + 1}/{len(groups)})"
            ids.append(self.post(text, g, reply_to=ids[-1] if ids else None))
        return ids
