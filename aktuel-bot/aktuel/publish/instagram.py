"""Instagram içerik yayınlama (Instagram Graph API).

Varsayılan: "Instagram API with Instagram Login" (graph.instagram.com) — Facebook sayfası gerekmez.
Facebook Login ile kurulduysa IG_GRAPH_HOST=graph.facebook.com yap.

Gerekli ortam değişkenleri: IG_USER_ID, IG_ACCESS_TOKEN
İsteğe bağlı: IG_GRAPH_HOST (varsayılan graph.instagram.com), IG_API_VERSION (varsayılan v23.0)
"""
from __future__ import annotations

import json
import os
import time

import requests


class InstagramError(RuntimeError):
    pass


class Instagram:
    def __init__(self):
        self.user_id = os.environ["IG_USER_ID"]
        self.token = os.environ["IG_ACCESS_TOKEN"]
        host = os.environ.get("IG_GRAPH_HOST", "graph.instagram.com")
        ver = os.environ.get("IG_API_VERSION", "v23.0")
        self.base = f"https://{host}/{ver}"

    @classmethod
    def configured(cls) -> bool:
        return bool(os.environ.get("IG_USER_ID") and os.environ.get("IG_ACCESS_TOKEN"))

    # --- düşük seviye -------------------------------------------------------
    def _req(self, method: str, path: str, **params) -> dict:
        params["access_token"] = self.token
        r = requests.request(method, f"{self.base}/{path}",
                             params=params if method == "GET" else None,
                             data=params if method != "GET" else None, timeout=60)
        try:
            body = r.json()
        except ValueError:
            body = {"raw": r.text}
        if r.status_code != 200 or "error" in body:
            raise InstagramError(f"{method} {path} -> {r.status_code}: {body}")
        return body

    def _wait(self, container_id: str, timeout: int = 180) -> None:
        t0 = time.time()
        while time.time() - t0 < timeout:
            st = self._req("GET", container_id, fields="status_code,status").get("status_code")
            if st == "FINISHED":
                return
            if st in ("ERROR", "EXPIRED"):
                raise InstagramError(f"container {container_id} durumu {st}")
            time.sleep(4)
        raise InstagramError(f"container {container_id} zaman aşımı")

    def _publish(self, container_id: str) -> str:
        self._wait(container_id)
        return self._req("POST", f"{self.user_id}/media_publish", creation_id=container_id)["id"]

    # --- yüksek seviye ------------------------------------------------------
    def quota_left(self) -> int | None:
        """24 saatlik yayın kotasından kalan (API bilgi veremezse None)."""
        try:
            d = self._req("GET", f"{self.user_id}/content_publishing_limit",
                          fields="config,quota_usage")["data"][0]
            return int(d["config"]["quota_total"]) - int(d.get("quota_usage", 0))
        except (InstagramError, KeyError, IndexError, ValueError):
            return None

    def post_images(self, urls: list[str], caption: str,
                    user_tags: list[dict] | None = None) -> str:
        """Tek görsel ya da kaydırmalı (2-10 görsel) gönderi paylaşır, medya id döner."""
        tags = json.dumps(user_tags) if user_tags else None
        if len(urls) == 1:
            p = {"image_url": urls[0], "caption": caption}
            if tags:
                p["user_tags"] = tags
            return self._publish(self._req("POST", f"{self.user_id}/media", **p)["id"])
        children = []
        for i, u in enumerate(urls):
            p = {"image_url": u, "is_carousel_item": "true"}
            if tags and i == 0:  # etiketi ilk sayfaya koy
                p["user_tags"] = tags
            cid = self._req("POST", f"{self.user_id}/media", **p)["id"]
            self._wait(cid)
            children.append(cid)
        cont = self._req("POST", f"{self.user_id}/media", media_type="CAROUSEL",
                         children=",".join(children), caption=caption)["id"]
        return self._publish(cont)

    def post_story(self, url: str) -> str:
        cid = self._req("POST", f"{self.user_id}/media", image_url=url, media_type="STORIES")["id"]
        return self._publish(cid)
