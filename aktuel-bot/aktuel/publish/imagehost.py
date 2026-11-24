"""Instagram API görseli herkese açık bir URL'den çeker; görselleri önce Cloudinary'ye yükleriz.

Gerekli ortam değişkenleri: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
"""
from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path

import requests


class Cloudinary:
    def __init__(self):
        self.cloud = os.environ["CLOUDINARY_CLOUD_NAME"]
        self.key = os.environ["CLOUDINARY_API_KEY"]
        self.secret = os.environ["CLOUDINARY_API_SECRET"]

    @classmethod
    def configured(cls) -> bool:
        return all(os.environ.get(k) for k in
                   ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"))

    def upload(self, path: Path, public_id: str, folder: str = "aktuel-bot") -> str:
        ts = str(int(time.time()))
        params = {"folder": folder, "public_id": public_id, "timestamp": ts, "overwrite": "true"}
        to_sign = "&".join(f"{k}={params[k]}" for k in sorted(params)) + self.secret
        params["signature"] = hashlib.sha1(to_sign.encode()).hexdigest()
        params["api_key"] = self.key
        with open(path, "rb") as fh:
            r = requests.post(f"https://api.cloudinary.com/v1_1/{self.cloud}/image/upload",
                              data=params, files={"file": fh}, timeout=120)
        r.raise_for_status()
        return r.json()["secure_url"]
