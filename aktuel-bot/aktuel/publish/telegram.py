"""Telegram bildirimleri: hazırlanan gönderi/hikâye paketini telefona yollar.

Gerekli: TELEGRAM_BOT_TOKEN (BotFather'dan).
İsteğe bağlı: TELEGRAM_CHAT_ID. Yoksa bota son /start yazan özel sohbet bulunur ve
state dosyasına kaydedilir (Telegram güncellemeleri yalnızca 24 saat tutar).
"""
from __future__ import annotations

import html
import json
import logging
import os
import time
from pathlib import Path

import requests

log = logging.getLogger("aktuel")
API = "https://api.telegram.org/bot{token}/{method}"
MEDIA_GROUP_MAX = 10


class TelegramError(RuntimeError):
    pass


class Telegram:
    def __init__(self, state=None):
        self.token = os.environ["TELEGRAM_BOT_TOKEN"]
        self.state = state
        self.chat_id = os.environ.get("TELEGRAM_CHAT_ID") or self._saved_chat_id() or self._discover_chat_id()
        if not self.chat_id:
            bot = self._call("getMe").get("username")
            raise TelegramError(f"Sohbet bulunamadı. Bu token @{bot} botuna ait: Telegram'da "
                                f"@{bot} botuna /start yaz, sonra tekrar çalıştır.")

    @classmethod
    def configured(cls) -> bool:
        return bool(os.environ.get("TELEGRAM_BOT_TOKEN"))

    # --- düşük seviye -------------------------------------------------------
    def _call(self, method: str, data: dict | None = None, files: dict | None = None) -> dict:
        url = API.format(token=self.token, method=method)
        for attempt in range(5):
            try:
                r = requests.post(url, data=data, files=files, timeout=120)
            except requests.RequestException as e:
                err = e
                time.sleep(3 * (attempt + 1))
                continue
            body = r.json() if r.headers.get("Content-Type", "").startswith("application/json") else {}
            if body.get("ok"):
                time.sleep(1.2)  # Telegram hız sınırına takılmamak için
                return body["result"]
            retry = (body.get("parameters") or {}).get("retry_after")
            if r.status_code == 429 and retry:
                time.sleep(int(retry) + 1)
                continue
            # token loglara düşmesin diye URL yerine sadece metodu yaz
            raise TelegramError(f"{method}: {r.status_code} {body.get('description', r.text[:200])}")
        raise TelegramError(f"{method}: bağlantı hatası {err}")

    def _saved_chat_id(self):
        return self.state.data.get("telegram_chat_id") if self.state else None

    def _discover_chat_id(self):
        updates = self._call("getUpdates", {"timeout": 0})
        for u in reversed(updates):
            msg = u.get("message") or u.get("my_chat_member") or {}
            chat = msg.get("chat") or {}
            if chat.get("type") == "private":
                log.info("Telegram sohbeti bulundu: %s", chat.get("username") or chat.get("first_name"))
                if self.state:
                    self.state.data["telegram_chat_id"] = chat["id"]
                return chat["id"]
        return None

    # --- yüksek seviye ------------------------------------------------------
    def whoami(self) -> dict:
        return self._call("getMe")

    def text(self, text: str, *, html_mode: bool = True) -> None:
        d = {"chat_id": self.chat_id, "text": text, "disable_web_page_preview": "true"}
        if html_mode:
            d["parse_mode"] = "HTML"
        self._call("sendMessage", d)

    def photos(self, paths: list[Path]) -> None:
        for i in range(0, len(paths), MEDIA_GROUP_MAX):
            group = paths[i:i + MEDIA_GROUP_MAX]
            if len(group) == 1:
                with open(group[0], "rb") as fh:
                    self._call("sendPhoto", {"chat_id": self.chat_id}, {"photo": fh})
                continue
            media, files = [], {}
            for j, p in enumerate(group):
                key = f"f{j}"
                media.append({"type": "photo", "media": f"attach://{key}"})
                files[key] = open(p, "rb")
            try:
                self._call("sendMediaGroup", {"chat_id": self.chat_id, "media": json.dumps(media)}, files)
            finally:
                for fh in files.values():
                    fh.close()

    def video(self, path: Path, caption: str = "") -> None:
        with open(path, "rb") as fh:
            self._call("sendVideo", {"chat_id": self.chat_id, "caption": caption[:1000],
                                     "supports_streaming": "true"}, {"video": fh})

    def copyable(self, text: str) -> None:
        """Dokununca/kopyala butonuyla tek seferde kopyalanabilen blok."""
        self.text(f"<pre>{html.escape(text)}</pre>")


def esc(s: str) -> str:
    return html.escape(s or "")
