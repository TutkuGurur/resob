"""RADAR akışı: fiyatı gerçekten düşen pazaryeri ürünlerini bulur, hikâye olarak paylaşır,
her hikâyeye "RADAR yaz → linki DM'den al" otomasyonu bağlar (Zernio)."""
from __future__ import annotations

import html
import io
import logging
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

from PIL import Image

from . import render, video
from .http import get_bytes
from .render_compare import tl
from .render_radar import marketplace_style, render_story
from .sources import radar_akakce as src

log = logging.getLogger("aktuel")


def affiliate_url(url: str, marketplace: str, cfg) -> str:
    """config.AFFILIATE'e göre linki affiliate linke çevirir (tanımlı değilse aynen döner)."""
    aff = getattr(cfg, "AFFILIATE", {}) or {}
    mp = marketplace.lower()
    for key, rule in aff.items():
        if key.lower() not in mp:
            continue
        if rule.get("tag") and "amazon." in url:
            return url + ("&" if "?" in url else "?") + f"tag={rule['tag']}"
        if rule.get("template"):
            return rule["template"].format(url=url, url_enc=quote(url, safe=""))
    return url


def _img(url: str | None):
    if not url:
        return None
    try:
        return Image.open(io.BytesIO(get_bytes(url))).convert("RGBA")
    except Exception as e:
        log.warning("  ürün görseli indirilemedi: %s", e)
        return None


def find_deals(cfg, recent: set[str]) -> list:
    cands = src.list_candidates(cfg.RADAR_SCAN_PAGES, cfg.RADAR_MIN_DROP)
    log.info("[Radar] %d aday (en az %%%d düşüş)", len(cands), cfg.RADAR_MIN_DROP)
    picked, inspected, used_brands = [], 0, set()
    for d in cands:
        if len(picked) >= cfg.RADAR_PER_RUN or inspected >= cfg.RADAR_MAX_INSPECT:
            break
        if d.id in recent or (d.brand and d.brand in used_brands):
            continue
        inspected += 1
        try:
            src.inspect(d, cfg.RADAR_MARKETPLACES)
        except Exception as e:
            log.warning("  %s incelenemedi: %s", d.name[:40], e)
            continue
        time.sleep(0.8)
        if not src.is_real_deal(d):
            continue  # son 1 ayda daha ucuza satılmış: sahte indirim
        if not d.best:
            continue  # hedef pazaryerlerinde satılmıyor
        if not src.resolve_link(d.best):
            continue
        d.best.url = affiliate_url(d.best.url, d.best.marketplace, cfg)
        picked.append(d)
        if d.brand:
            used_brands.add(d.brand)
        log.info("  🎯 %%%d %s | %s %s | %s", d.drop_pct, d.name[:50], d.best.marketplace,
                 d.best.price, d.best.url)
    log.info("[Radar] %d ürün incelendi, %d gerçek fırsat seçildi", inspected, len(picked))
    return picked


def run(cfg, state, today: date, out_dir: Path, handle: str, ig=None, host=None, tg=None) -> int:
    rs = state.data.setdefault("radar", {})
    autos = state.data.setdefault("radar_automations", [])

    # Dünkü hikâyelerin süresi doldu: DM otomasyonlarını temizle.
    z = getattr(ig, "z", None)
    if z and autos:
        keep = []
        for a in autos:
            if a["date"] < (today - timedelta(days=1)).isoformat():
                try:
                    z.delete_automation(a["id"])
                except Exception as e:
                    log.warning("  eski otomasyon silinemedi (%s): %s", a["id"], e)
            else:
                keep.append(a)
        autos[:] = keep

    cutoff = (today - timedelta(days=cfg.RADAR_NO_REPEAT_DAYS)).isoformat()
    recent = {pid for pid, d in rs.items() if d >= cutoff}
    deals = find_deals(cfg, recent)
    if not deals:
        log.info("[Radar] bugün yeni gerçek fırsat yok.")
        return True
    if ig and hasattr(ig, "quota_left"):
        left = ig.quota_left()
        if left is not None and left < len(deals):
            if left <= 0:
                log.warning("[Radar] Instagram 24 saatlik kotası dolu; sonraki turda denenecek.")
                return False
            deals = deals[:left]
            log.info("[Radar] kota nedeniyle %d ürünle sınırlandı", left)

    rdir = out_dir / f"radar_{today.isoformat()}_{len(rs)}"
    stories = []
    for i, d in enumerate(deals, 1):
        im = render_story(d, _img(d.image_url), i, len(deals), today, handle, cfg.RADAR_KEYWORD)
        stories.append(render.save_jpeg(im.convert("RGB"), rdir / f"story_{i:02d}.jpg"))
    log.info("  hazır: %s (%d hikâye)", rdir, len(stories))

    live = bool(ig or tg)
    posted = 0
    media = video.story_videos(stories, cfg, today, offset=2) if ig else stories
    lines = []
    for i, (d, p) in enumerate(zip(deals, media), 1):
        lines.append(f"{i}. {d.name} – {tl(d.best.price)} ({d.best.marketplace})\n{d.best.url}")
        if not ig:
            continue
        try:
            post_id = ig.post_story(host.upload(p, f"{rdir.name}_{p.stem}"))
            if z:
                media_id = z.wait_platform_post_id(post_id)
                if media_id:
                    text = cfg.RADAR_DM_TEXT.format(name=d.name, price=tl(d.best.price),
                                                    marketplace=marketplace_style(d.best.marketplace)[0])
                    aid = z.create_story_dm(ig.account_id, media_id, f"Radar {today} #{i} {d.name}",
                                            cfg.RADAR_DM_KEYWORDS, text, "Ürüne git", d.best.url)
                    autos.append({"id": aid, "date": today.isoformat(), "product": d.id})
                    log.info("  hikâye #%d paylaşıldı, DM otomasyonu kuruldu", i)
                else:
                    log.warning("  hikâye #%d paylaşıldı ama medya kimliği alınamadı (DM kurulamadı)", i)
        except Exception as e:
            log.error("  hikâye #%d HATA: %s", i, e)
            continue
        rs[d.id] = today.isoformat()
        posted += 1

    if tg:
        body = "\n\n".join(html.escape(x) for x in lines)
        if ig:
            tg.text(f"🎯 <b>Radar paylaşıldı</b> ({len(deals)} ürün)\n\n{body}")
        else:
            tg.text(f"🎯 <b>RADAR</b> – {len(deals)} gerçek fırsat. Hikâyeleri paylaş, "
                    f"link çıkartmasına aşağıdaki linkleri ekle:\n\n{body}")
            tg.photos(stories)
            for d in deals:
                rs[d.id] = today.isoformat()
    if not live:
        log.info("\n".join(lines))
    # eski kayıtları temizle
    for pid in [k for k, v in rs.items() if v < (today - timedelta(days=60)).isoformat()]:
        del rs[pid]
    return posted > 0 or not ig
