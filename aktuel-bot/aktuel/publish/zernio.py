"""Zernio (zernio.com) üzerinden Instagram ve X paylaşımı.

Zernio kendi Meta ve X uygulamalarını kullandığı için bizim Meta geliştirici uygulamamıza,
işletme portföyüne ya da X geliştirici hesabına gerek kalmaz. Hesaplar Zernio panelinden
bağlanır; bot hesapları API'den kendisi bulur.

Gerekli: ZERNIO_API_KEY
Hesap seçimi: Instagram için IG_HANDLE (config.IG_HANDLE), X için X_HANDLE (config.X_HANDLE)
kullanıcı adıyla eşleşen hesap kullanılır; eşleşme yoksa o platformda paylaşılmaz.
İsteğe bağlı: ZERNIO_INSTAGRAM_ACCOUNT_ID, ZERNIO_X_ACCOUNT_ID ile ID doğrudan verilebilir.

Ücret: ilk 2 bağlı hesap ücretsiz (ör. Instagram + X). X API çağrıları X'in tarifesiyle
aynen yansıtılır (post başı ~0,015 $, linkli post ~0,20 $); bot link koymaz.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path

import requests

log = logging.getLogger("aktuel")
API = "https://zernio.com/api/v1"
X_IMAGES_PER_POST = 4


class ZernioError(RuntimeError):
    pass


class Zernio:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {os.environ['ZERNIO_API_KEY']}"})
        self._accounts = None

    @classmethod
    def configured(cls) -> bool:
        return bool(os.environ.get("ZERNIO_API_KEY"))

    def _req(self, method: str, path: str, **kw) -> dict:
        for attempt in range(4):
            r = self.s.request(method, f"{API}/{path}", timeout=120, **kw)
            if r.status_code == 429:
                if attempt >= 1:  # kota dolduysa dakikalarca bekleme, hata ver
                    break
                time.sleep(min(int(r.headers.get("retry-after", 20)), 30) + 1)
                continue
            try:
                body = r.json()
            except ValueError:
                body = {"raw": r.text[:300]}
            if r.status_code >= 400:
                raise ZernioError(f"{method} {path} -> {r.status_code}: {body}")
            return body
        raise ZernioError(f"{method} {path}: hız sınırı")

    # --- hesaplar ------------------------------------------------------------
    def accounts(self) -> list[dict]:
        if self._accounts is None:
            body = self._req("GET", "accounts")
            self._accounts = body if isinstance(body, list) else (body.get("accounts") or body.get("data") or [])
        return self._accounts

    def account_id(self, platform: str, env_name: str, username: str | None) -> str | None:
        """Paylaşılacak hesabın Zernio ID'si. Yanlış hesaba paylaşmamak için kullanıcı adı
        eşleşmesi şart: Zernio'da aynı platformdan birden çok hesap bağlı olabilir."""
        if os.environ.get(env_name):
            return os.environ[env_name]
        want = (username or "").lstrip("@").strip().lower()
        if not want:
            return None
        for a in self.accounts():
            if a.get("platform") != platform or a.get("isActive", True) is False:
                continue
            names = {str(a.get(k) or "").lstrip("@").lower() for k in ("username", "handle", "displayName")}
            if want in names:
                return a.get("_id") or a.get("id")
        log.warning("Zernio'da @%s adlı %s hesabı bulunamadı; bu platformda paylaşılmayacak.", want, platform)
        return None

    def profile_id(self, account_id: str) -> str | None:
        for a in self.accounts():
            if (a.get("_id") or a.get("id")) == account_id:
                p = a.get("profileId") or a.get("profile")
                return (p.get("_id") or p.get("id")) if isinstance(p, dict) else p
        return None

    def wait_platform_post_id(self, post_id: str, timeout: int = 120) -> str | None:
        """Yayınlanan içeriğin Instagram medya kimliğini (platformPostId) bekler."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            post = self._req("GET", f"posts/{post_id}")
            post = post.get("post") or post
            for p in post.get("platforms", []):
                if p.get("platformPostId"):
                    return str(p["platformPostId"])
                if p.get("status") == "failed":
                    raise ZernioError(f"paylaşım başarısız: {p.get('errorMessage')}")
            time.sleep(5)
        return None

    # --- hikâyeye cevap -> DM otomasyonu --------------------------------------
    def create_story_dm(self, account_id: str, story_media_id: str, name: str, keywords: list[str],
                        text: str, button_title: str, url: str) -> str:
        body = {
            "profileId": self.profile_id(account_id), "accountId": account_id,
            "name": name[:100], "trigger": "story_reply", "platformPostId": story_media_id,
            "keywords": keywords, "matchMode": "contains", "dmMessage": text,
            "buttons": [{"type": "url", "title": button_title[:20], "url": url}],
        }
        res = self._req("POST", "comment-automations", json=body)
        a = res.get("automation") or res.get("data") or res
        return a.get("_id") or a.get("id") or ""

    def delete_automation(self, automation_id: str) -> None:
        self._req("DELETE", f"comment-automations/{automation_id}")

    # --- medya ---------------------------------------------------------------
    def upload(self, path: Path, public_id: str = "") -> str:
        """Dosyayı Zernio'ya yükler, herkese açık URL'sini döndürür."""
        data = path.read_bytes()
        ctype = "video/mp4" if path.suffix.lower() == ".mp4" else "image/jpeg"
        pre = self._req("POST", "media/presign", json={
            "filename": path.name, "contentType": ctype, "size": len(data)})
        r = requests.put(pre["uploadUrl"], data=data, headers={"Content-Type": ctype}, timeout=300)
        if r.status_code >= 400:
            raise ZernioError(f"medya yüklenemedi: HTTP {r.status_code}")
        return pre["publicUrl"]

    # --- paylaşım ------------------------------------------------------------
    def create_post(self, body: dict) -> dict:
        body.setdefault("publishNow", True)
        res = self._req("POST", "posts", json=body)
        post = res.get("post") or res
        failed = [p for p in post.get("platforms", []) if p.get("status") == "failed"]
        if failed or post.get("status") == "failed":
            raise ZernioError(f"paylaşım başarısız: {failed or post}")
        return post


class ZernioInstagram:
    """main.publish() ve compare.run() için Instagram arayüzü (Graph API sınıfıyla aynı yöntemler)."""

    def __init__(self, z: Zernio, account_id: str):
        self.z, self.account_id = z, account_id

    def quota_left(self) -> int | None:
        """Instagram'ın 24 saatlik API paylaşım hakkından kalan (bilinmiyorsa None)."""
        try:
            d = self.z._req("GET", f"accounts/{self.account_id}/instagram/publishing-limit")
            d = d.get("data", d) if isinstance(d, dict) else {}
            return int(d["quotaTotal"]) - int(d.get("quotaUsage", 0))
        except Exception as e:
            log.warning("  Instagram kotası okunamadı: %s", e)
            return None

    def post_images(self, urls: list[str], caption: str, user_tags=None) -> str:
        # Not: hesap etiketleme (user_tags) Zernio'da henüz bağlanmadı; etiketsiz paylaşılır.
        entry = {"platform": "instagram", "accountId": self.account_id}
        post = self.z.create_post({
            "content": caption,
            "mediaItems": [{"type": "image", "url": u} for u in urls],
            "platforms": [entry],
        })
        return post.get("_id", "")

    def post_reel(self, url: str, caption: str) -> str:
        """Tek video = Reel (Zernio dokümanı: tek video her zaman Reel olarak yayınlanır)."""
        post = self.z.create_post({
            "content": caption,
            "mediaItems": [{"type": "video", "url": url}],
            "platforms": [{"platform": "instagram", "accountId": self.account_id,
                           "platformSpecificData": {"shareToFeed": True}}],
        })
        return post.get("_id", "")

    def post_story(self, url: str) -> str:
        post = self.z.create_post({
            "mediaItems": [{"type": "image", "url": url}],
            "platforms": [{"platform": "instagram", "accountId": self.account_id,
                           "platformSpecificData": {"contentType": "story"}}],
        })
        return post.get("_id", "")


class ZernioX:
    """main.post_x() ve compare.run() için X arayüzü (X API sınıfıyla aynı thread() yöntemi)."""

    def __init__(self, z: Zernio, account_id: str):
        self.z, self.account_id = z, account_id

    def thread(self, first_text: str, images: list[Path], max_posts: int,
               more_text: str = "👇 Devamı") -> list[str]:
        groups = [images[i:i + X_IMAGES_PER_POST]
                  for i in range(0, len(images), X_IMAGES_PER_POST)][:max_posts]
        items = []
        for i, g in enumerate(groups):
            text = first_text if i == 0 else f"{more_text} ({i + 1}/{len(groups)})"
            items.append({"content": text,
                          "mediaItems": [{"type": "image", "url": self.z.upload(p)} for p in g]})
        if len(items) == 1:
            body = {"content": items[0]["content"], "mediaItems": items[0]["mediaItems"],
                    "platforms": [{"platform": "twitter", "accountId": self.account_id}]}
        else:
            body = {"content": first_text,
                    "platforms": [{"platform": "twitter", "accountId": self.account_id,
                                   "platformSpecificData": {"threadItems": items}}]}
        post = self.z.create_post(body)
        return [post.get("_id", "")]
