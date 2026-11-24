"""Paylaşılan broşürlerin kaydı (state/posted.json). GitHub Actions her çalıştırmada repoya geri yazar."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

KEEP_DAYS = 90


class State:
    def __init__(self, path: Path):
        self.path = path
        self.data = {"posted": {}}
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))
        self.data.setdefault("posted", {})

    def is_posted(self, bid: str) -> bool:
        return bid in self.data["posted"]

    def recent_hashes(self) -> list[int]:
        return [v["hash"] for v in self.data["posted"].values() if v.get("hash") is not None]

    def mark(self, bid: str, **info) -> None:
        info["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.data["posted"][bid] = info

    def save(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
        self.data["posted"] = {
            k: v for k, v in self.data["posted"].items()
            if datetime.fromisoformat(v["at"]) >= cutoff
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")
