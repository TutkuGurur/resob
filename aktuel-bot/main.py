"""Aktüel bot: 5 marketin yeni broşürlerini bulur, görselleri hazırlar, Instagram'da paylaşır.

Kullanım:
  python main.py                 # Instagram ayarlıysa paylaşır, değilse sadece görselleri üretir
  python main.py --dry-run       # asla paylaşmaz; out/ klasörüne görsel + açıklama üretir
  python main.py --market bim    # sadece bir market
  python main.py --mark-seen     # şu anki broşürleri "paylaşıldı" say (ilk kurulumda birikmeyi önler)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from PIL import Image

import config as cfg
from aktuel import caption, render
from aktuel.dates import human_range
from aktuel.http import get_bytes
from aktuel.models import Brochure
from aktuel.sources import akakce, bim
from aktuel.state import State

ROOT = Path(__file__).resolve().parent
TR_TZ = timezone(timedelta(hours=3))
log = logging.getLogger("aktuel")


# --- kaynaklar ---------------------------------------------------------------
def list_market(key: str, m: dict, today: date) -> list[Brochure]:
    if m["source"] == "bim":
        return bim.list_brochures(key, today)
    return akakce.list_brochures(key, m["slug"], today)


def fetch_pages(b: Brochure, m: dict) -> Brochure:
    return (bim if m["source"] == "bim" else akakce).fetch_pages(b)


def eligible(b: Brochure, today: date) -> bool:
    t = (b.title or "").lower()
    if any(k in t for k in cfg.SKIP_TITLE_KEYWORDS):
        return False
    if not b.start:
        return False
    if b.end and b.end < today:
        return False
    days = (b.start - today).days
    return -cfg.MAX_DAYS_SINCE_START <= days <= cfg.MAX_DAYS_UNTIL_START


# --- benzer broşür tespiti (aynı afişin farklı başlıkla tekrar yayınlanması) -----
def dhash(im: Image.Image) -> int:
    g = im.convert("L").resize((9, 8), Image.LANCZOS)
    px = list(g.tobytes())
    bits = 0
    for r in range(8):
        for c in range(8):
            bits = (bits << 1) | (px[r * 9 + c] > px[r * 9 + c + 1])
    return bits


def is_duplicate(h: int, seen: list[int], max_dist: int = 6) -> bool:
    return any(bin(h ^ s).count("1") <= max_dist for s in seen)


# --- üretim ------------------------------------------------------------------
def chunk(lst, n):
    return [lst[i:i + n] for i in range(0, len(lst), n)]


def prepare(b: Brochure, m: dict, today: date, out_dir: Path, handle: str) -> dict:
    """Görselleri indirip gönderi/hikâye olarak render eder. Dosya yollarını döndürür."""
    n = max(cfg.MAX_POST_PAGES, cfg.MAX_STORY_PAGES)
    pages = []
    for p in b.pages[:n]:
        try:
            pages.append(render.load(get_bytes(p.image_url)))
        except Exception as e:  # tek sayfa bozuksa diğerleriyle devam
            log.warning("  sayfa indirilemedi %s: %s", p.image_url, e)
    if not pages:
        raise RuntimeError("hiç sayfa indirilemedi")

    title = caption.title_line(b)
    sub = human_range(b.start, b.end)
    w = caption.when_text(b, today)
    if w:
        sub = f"{sub} · {w}" if sub else w
    footer = f"@{handle}" if handle else ""
    total = len(b.pages)

    bdir = out_dir / f"{b.market}_{b.id.split(':', 1)[1][:12]}"
    posts, stories = [], []
    for i, im in enumerate(pages[:cfg.MAX_POST_PAGES], 1):
        f = footer + (f"   ·   {i}/{min(total, cfg.MAX_POST_PAGES)}" if total > 1 else "")
        posts.append(render.save_jpeg(render.render_post(im, m, title, sub, f), bdir / f"post_{i:02d}.jpg"))
    for i, im in enumerate(pages[:cfg.MAX_STORY_PAGES], 1):
        f = footer + (f"   ·   Sayfa {i}/{total}" if total > 1 else "")
        stories.append(render.save_jpeg(render.render_story(im, m, title, sub, f), bdir / f"story_{i:02d}.jpg"))

    groups = chunk(posts, cfg.CAROUSEL_SIZE)
    captions = [caption.build(b, m, cfg, today, i + 1, len(groups)) for i in range(len(groups))]
    for i, c in enumerate(captions, 1):
        (bdir / f"caption_{i}.txt").write_text(c, encoding="utf-8")
    return {"dir": bdir, "groups": groups, "captions": captions, "stories": stories,
            "hash": dhash(pages[0])}


def publish(b: Brochure, m: dict, art: dict, ig, host) -> dict:
    tags = None
    if m.get("ig_username"):
        tags = [{"username": m["ig_username"], "x": 0.5, "y": 0.5}]
    need = len(art["groups"]) + len(art["stories"])
    left = ig.quota_left()
    if left is not None and left < need:
        raise RuntimeError(f"Instagram günlük kotası yetersiz (kalan {left}, gereken {need})")

    def up(p: Path) -> str:
        return host.upload(p, f"{art['dir'].name}_{p.stem}")

    post_ids = []
    for group, cap in zip(art["groups"], art["captions"]):
        post_ids.append(ig.post_images([up(p) for p in group], cap, tags))
        log.info("  gönderi paylaşıldı: %s", post_ids[-1])
    story_ids = []
    for p in art["stories"]:
        story_ids.append(ig.post_story(up(p)))
    log.info("  %d hikâye paylaşıldı", len(story_ids))
    return {"post_ids": post_ids, "story_ids": story_ids}


def send_telegram_package(b: Brochure, m: dict, art: dict, tg) -> None:
    """Elle paylaşım için paketi Telegram'a yollar: gönderi görselleri, açıklama, hikâyeler."""
    from aktuel.publish.telegram import esc
    rng = human_range(b.start, b.end)
    n_post = sum(len(g) for g in art["groups"])
    tg.text(f"🛒 <b>{esc(m['name'])} – {esc(caption.title_line(b))}</b>\n📅 {esc(rng)}\n\n"
            f"📌 <b>GÖNDERİ</b>: aşağıdaki {n_post} görseli sırasıyla "
            f"{'kaydırmalı gönderi' if n_post > 1 else 'gönderi'} olarak paylaş.")
    for i, (group, cap) in enumerate(zip(art["groups"], art["captions"]), 1):
        if len(art["groups"]) > 1:
            tg.text(f"Gönderi {i}/{len(art['groups'])}")
        tg.photos(group)
        tg.text("✍️ Açıklama (kopyalamak için dokun):")
        tg.copyable(cap)
    tip = f" Hikâyede @{m['ig_username']} etiketlemeyi unutma." if m.get("ig_username") else ""
    tg.text(f"📱 <b>HİKÂYELER</b>: {len(art['stories'])} görsel, sırayla paylaş.{esc(tip)}")
    tg.photos(art["stories"])


def send_telegram_summary(b: Brochure, m: dict, art: dict, tg) -> None:
    from aktuel.publish.telegram import esc
    tg.text(f"✅ Paylaşıldı: <b>{esc(m['name'])} – {esc(caption.title_line(b))}</b> "
            f"({sum(len(g) for g in art['groups'])} sayfa, {len(art['stories'])} hikâye)")


def check() -> int:
    """Anahtarların doğru girildiğini doğrular; hiçbir şey paylaşmaz, anahtarları yazdırmaz."""
    from aktuel.publish.imagehost import Cloudinary
    from aktuel.publish.instagram import Instagram
    ok = True
    if Instagram.configured():
        try:
            ig = Instagram()
            me = ig.whoami()
            log.info("Instagram OK: @%s (hesap türü: %s, id: %s)", me.get("username"),
                     me.get("account_type"), ig.user_id)
            log.info("Kalan 24 saatlik paylaşım kotası: %s", ig.quota_left())
        except Exception as e:
            ok = False
            log.error("Instagram HATA: %s", e)
    else:
        log.info("Instagram: henüz tanımlı değil (Telegram modu için sorun değil).")
    log.info("Cloudinary: %s", "tanımlı" if Cloudinary.configured() else "TANIMLI DEĞİL")
    from aktuel.publish.telegram import Telegram
    if not Instagram.configured() and not Telegram.configured():
        ok = False
        log.error("Ne Instagram ne Telegram tanımlı.")
    if Telegram.configured():
        try:
            st = State(ROOT / "state" / "posted.json")
            tg = Telegram(st)
            log.info("Telegram OK: @%s", tg.whoami().get("username"))
            tg.text("✅ Aktüel bot bağlantı testi başarılı. Yeni broşürler buraya gelecek.")
            st.save()
        except Exception as e:
            ok = False
            log.error("Telegram HATA: %s", e)
    else:
        log.info("Telegram: TANIMLI DEĞİL")
    return 0 if ok else 1


# --- ana akış -----------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--market", action="append", help="sadece bu market(ler)")
    ap.add_argument("--today", help="YYYY-AA-GG (test için)")
    ap.add_argument("--limit", type=int, default=cfg.MAX_BROCHURES_PER_RUN)
    ap.add_argument("--mark-seen", action="store_true")
    ap.add_argument("--check", action="store_true",
                    help="Instagram/Cloudinary/Telegram bağlantısını test et, paylaşım yapma")
    ap.add_argument("--compare", action="store_true",
                    help="günlük 'Aynı ürün, farklı fiyat' paylaşımını yap (broşürler yerine)")
    ap.add_argument("--force", action="store_true", help="karşılaştırmayı bugün yapılmış olsa da tekrar yap")
    ap.add_argument("--out", default=str(ROOT / "out"))
    ap.add_argument("--state", default=str(ROOT / "state" / "posted.json"))
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if a.check:
        return check()

    today = date.fromisoformat(a.today) if a.today else datetime.now(TR_TZ).date()
    handle = os.environ.get("IG_HANDLE", cfg.IG_HANDLE)
    state = State(Path(a.state))
    markets = {k: v for k, v in cfg.MARKETS.items() if not a.market or k in a.market}

    # Modlar: Instagram ayarlıysa otomatik paylaş (+ Telegram özeti);
    # sadece Telegram ayarlıysa paketi telefona gönder (elle paylaşım);
    # hiçbiri yoksa ya da --dry-run ise sadece görsel üret.
    ig = host = tg = None
    if not a.dry_run and not a.mark_seen:
        from aktuel.publish.imagehost import Cloudinary
        from aktuel.publish.instagram import Instagram
        from aktuel.publish.telegram import Telegram
        if Instagram.configured() and Cloudinary.configured():
            ig, host = Instagram(), Cloudinary()
        if Telegram.configured():
            try:
                tg = Telegram(state)
            except Exception as e:
                log.error("Telegram kullanılamıyor: %s", e)
        if not ig and not tg:
            log.info("Instagram/Telegram ayarlı değil -> sadece görsel üretiliyor (dry-run).")
    live = bool(ig or tg)

    if a.compare:
        from aktuel import compare
        run_dir = Path(a.out) / datetime.now(TR_TZ).strftime("%Y%m%d-%H%M")
        try:
            rc = compare.run(cfg, state, today, run_dir, handle, ig, host, tg, force=a.force)
        finally:
            if live:
                state.save()
        return rc

    # 1) adayları topla
    cands: list[tuple[Brochure, dict]] = []
    for key, m in markets.items():
        try:
            bs = list_market(key, m, today)
        except Exception as e:
            log.error("[%s] liste alınamadı: %s", m["name"], e)
            continue
        new = [b for b in bs if eligible(b, today) and not state.is_posted(b.id)]
        log.info("[%s] %d broşür, %d yeni aday", m["name"], len(bs), len(new))
        cands += [(b, m) for b in new]

    if a.mark_seen:
        for b, m in cands:
            state.mark(b.id, market=b.market, title=b.title, skipped="mark-seen")
        state.save()
        log.info("%d broşür 'görüldü' olarak işaretlendi.", len(cands))
        return 0

    # Yarın/bugün başlayanlar önce
    cands.sort(key=lambda x: abs((x[0].start - today).days))
    run_dir = Path(a.out) / datetime.now(TR_TZ).strftime("%Y%m%d-%H%M")
    done = errors = 0
    for b, m in cands:
        if done >= a.limit:
            break
        log.info("→ %s | %s | %s", m["name"], b.title, human_range(b.start, b.end))
        try:
            fetch_pages(b, m)
            if not b.pages:
                log.warning("  sayfa bulunamadı, atlandı")
                continue
            art = prepare(b, m, today, run_dir, handle)
            if is_duplicate(art["hash"], state.recent_hashes()):
                log.info("  aynı afiş daha önce paylaşılmış, atlandı")
                if live:
                    state.mark(b.id, market=b.market, title=b.title, hash=art["hash"],
                               skipped="duplicate")
                continue
            info = {"market": b.market, "title": b.title, "hash": art["hash"],
                    "pages": len(b.pages)}
            if ig:
                info.update(publish(b, m, art, ig, host))
                state.mark(b.id, **info)
                if tg:
                    send_telegram_summary(b, m, art, tg)
            elif tg:
                send_telegram_package(b, m, art, tg)
                info["sent"] = "telegram"
                state.mark(b.id, **info)
            log.info("  hazır: %s (%d gönderi görseli, %d hikâye)", art["dir"],
                     sum(len(g) for g in art["groups"]), len(art["stories"]))
            done += 1
        except Exception as e:
            errors += 1
            log.error("  HATA: %s", e)
        finally:
            if live:
                state.save()  # her broşürden sonra kaydet; yarıda kesilirse tekrar gönderme
    if live:
        state.save()
    log.info("Bitti: %d broşür işlendi, %d hata.", done, errors)
    return 1 if errors and not done else 0


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    sys.exit(main())
