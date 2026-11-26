"""Günlük "Aynı ürün, farklı fiyat" paylaşımı: marketfiyati.org.tr verisinden 5 ürün seçer,
kapak + ürün başına bir görsel üretir, Instagram'a ya da Telegram'a gönderir."""
from __future__ import annotations

import html
import io
import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from PIL import Image

from . import render
from .http import get_bytes
from .render_compare import market_name, render_cover, render_product, tl, date_tr
from .sources import marketfiyati

log = logging.getLogger("aktuel")


def select(products: dict, recent_ids: set[str], cfg) -> list:
    """Paylaşmaya değer ürünleri seçer: en az N markette satılan, görseli olan, fark büyük olan;
    aynı aramadan (kategori) en fazla bir ürün; son günlerde paylaşılmamış."""
    pool = []
    for p in products.values():
        n = len(p.offers)
        if n < cfg.COMPARE_MIN_MARKETS or not p.image_url or p.id in recent_ids:
            continue
        prices = [o.price for o in p.offers.values()]
        lo, hi = min(prices), max(prices)
        if lo <= 0 or hi / lo > cfg.COMPARE_MAX_RATIO:  # büyük ihtimalle veri hatası / farklı ürün
            continue
        if p.diff < cfg.COMPARE_MIN_DIFF_TL or p.spread < cfg.COMPARE_MIN_SPREAD:
            continue
        score = p.spread * (1 + 0.2 * (n - cfg.COMPARE_MIN_MARKETS))
        pool.append((score, p))
    pool.sort(key=lambda x: x[0], reverse=True)
    picked, used_kw, used_brand = [], set(), set()
    for _, p in pool:
        if p.keyword in used_kw or (p.brand and p.brand in used_brand):
            continue
        picked.append(p)
        used_kw.add(p.keyword)
        if p.brand:
            used_brand.add(p.brand)
        if len(picked) >= cfg.COMPARE_DAILY_COUNT:
            break
    return picked


def build_caption(products, today: date, cfg) -> str:
    lines = ["🛒 Aynı ürün, farklı fiyat! Bugün hangi market daha ucuz?",
             f"📅 {date_tr(today)} · {cfg.COMPARE_AREA_LABEL}", ""]
    for i, p in enumerate(products, 1):
        best, worst = p.sorted_offers[0], p.sorted_offers[-1]
        lines.append(f"{i}️⃣ {p.title}")
        lines.append(f"   ✅ En ucuz: {market_name(best.market)} {tl(best.price)}")
        lines.append(f"   ❌ En pahalı: {market_name(worst.market)} {tl(worst.price)} "
                     f"(fark {tl(p.diff)})")
    lines += ["", "👉 Kaydır, her ürünün tüm market fiyatlarını gör!",
              "💾 Alışverişten önce kaydet, arkadaşına gönder.",
              "ℹ️ Fiyatlar marketfiyati.org.tr'den alınmıştır; mağazaya ve bölgeye göre değişebilir.",
              ""]
    tags = ["marketfiyatları", "fiyatkarşılaştırma", "bim", "a101", "şok", "migros", "carrefoursa",
            "hakmar", "tarımkredi", "aktüel", "indirim", "ucuzluk", "tasarruf", "alışveriş"]
    if cfg.AD_DISCLOSURE:
        lines.insert(-1, cfg.AD_DISCLOSURE)
    lines.append(" ".join("#" + t for t in tags))
    return "\n".join(lines)[:2200]


def _img(url: str | None) -> Image.Image | None:
    if not url:
        return None
    try:
        return Image.open(io.BytesIO(get_bytes(url))).convert("RGBA")
    except Exception as e:
        log.warning("  ürün görseli indirilemedi: %s", e)
        return None


def x_text(products, today: date) -> str:
    from .publish.x import fit
    lines = [f"🛒 Aynı ürün, farklı fiyat ({today.day} {date_tr(today).split()[1]})",
             "Bugün en ucuz nerede?", ""]
    for i, p in enumerate(products, 1):
        best = p.sorted_offers[0]
        name = p.title if len(p.title) <= 20 else p.title[:18].rstrip() + "…"
        lines.append(f"{i}. {name}: {market_name(best.market)} {tl(best.price)}")
    return fit(lines, "#marketfiyatları #indirim")


def run_reel_only(cfg, state, today: date, out_dir: Path, handle: str, ig=None, host=None,
                  tg=None) -> int:
    """Bugün paylaşılmış karşılaştırmanın aynı ürünleriyle yalnızca Reels üretip paylaşır
    (gönderi, hikâye ve X tekrar edilmez)."""
    done = state.data.setdefault("compare", {})
    ids = done.get(today.isoformat())
    if not ids:
        log.warning("[Reels] bugün paylaşılmış karşılaştırma yok; önce karşılaştırmayı çalıştır.")
        return 1
    reels_done = state.data.setdefault("compare_reels", {})
    if reels_done.get(today.isoformat()):
        log.info("[Reels] bugünün Reels'i zaten paylaşıldı.")
        return 0
    products = marketfiyati.collect(cfg.COMPARE_KEYWORDS, cfg.COMPARE_LAT, cfg.COMPARE_LON,
                                    cfg.COMPARE_RADIUS_KM, pages=cfg.COMPARE_PAGES)
    picked = [products[i] for i in ids if i in products]
    if len(picked) < 3:
        log.warning("[Reels] bugünün ürünleri bulunamadı (%d).", len(picked))
        return 1
    from . import reel
    imgs = [_img(p.image_url) for p in picked]
    cdir = out_dir / f"reels_{today.isoformat()}"
    cdir.mkdir(parents=True, exist_ok=True)
    music = Path(__file__).resolve().parent.parent / cfg.REEL_MUSIC if cfg.REEL_MUSIC else None
    path = reel.build(picked, imgs, today, cfg.COMPARE_AREA_LABEL, handle, cdir / "reel.mp4", music)
    if not path:
        return 1
    cap = build_caption(picked, today, cfg)
    if ig and hasattr(ig, "post_reel"):
        ig.post_reel(host.upload(path, f"{cdir.name}_reel"), cap)
        log.info("  Reels paylaşıldı")
        if tg:
            tg.text("✅ Paylaşıldı: <b>Aynı ürün, farklı fiyat</b> (Reels)")
    elif tg:
        tg.text("🎬 <b>REELS</b>: aşağıdaki videoyu Reels olarak paylaş.")
        tg.video(path)
        tg.copyable(cap)
    else:
        return 0
    reels_done[today.isoformat()] = True
    return 0


def run(cfg, state, today: date, out_dir: Path, handle: str, ig=None, host=None, tg=None,
        force: bool = False, xc=None) -> int:
    done = state.data.setdefault("compare", {})
    if done.get(today.isoformat()) and not force:
        log.info("[Karşılaştırma] bugün zaten paylaşıldı, atlanıyor.")
        return 0
    cutoff = (today - timedelta(days=cfg.COMPARE_NO_REPEAT_DAYS)).isoformat()
    recent = {pid for d, ids in done.items() if d >= cutoff for pid in ids}

    products = marketfiyati.collect(cfg.COMPARE_KEYWORDS, cfg.COMPARE_LAT, cfg.COMPARE_LON,
                                    cfg.COMPARE_RADIUS_KM, pages=cfg.COMPARE_PAGES)
    picked = select(products, recent, cfg)
    if len(picked) < 3:
        log.warning("[Karşılaştırma] yeterli ürün bulunamadı (%d), atlanıyor.", len(picked))
        return 1
    for p in picked:
        log.info("  • %s | %s", p.title, ", ".join(f"{market_name(o.market)} {o.price}" for o in p.sorted_offers))

    imgs = [_img(p.image_url) for p in picked]
    cdir = out_dir / f"karsilastirma_{today.isoformat()}"
    area = cfg.COMPARE_AREA_LABEL
    posts = [render.save_jpeg(render_cover(picked, imgs, today, area, handle).convert("RGB"),
                              cdir / "post_00.jpg")]
    stories = [render.save_jpeg(render_cover(picked, imgs, today, area, handle, render.STORY_SIZE)
                                .convert("RGB"), cdir / "story_00.jpg")]
    n = len(picked)
    for i, (p, im) in enumerate(zip(picked, imgs), 1):
        posts.append(render.save_jpeg(render_product(p, im, i, n, today, area, handle).convert("RGB"),
                                      cdir / f"post_{i:02d}.jpg"))
        stories.append(render.save_jpeg(render_product(p, im, i, n, today, area, handle, render.STORY_SIZE)
                                        .convert("RGB"), cdir / f"story_{i:02d}.jpg"))
    cap = build_caption(picked, today, cfg)
    (cdir / "caption_1.txt").write_text(cap, encoding="utf-8")
    reel_path = None
    if getattr(cfg, "COMPARE_REEL", False):
        from . import reel
        try:
            music = Path(__file__).resolve().parent.parent / cfg.REEL_MUSIC if cfg.REEL_MUSIC else None
            reel_path = reel.build(picked, imgs, today, area, handle, cdir / "reel.mp4", music)
        except Exception as e:
            log.error("  Reels üretilemedi: %s", e)
    log.info("  hazır: %s (%d gönderi görseli, %d hikâye)", cdir, len(posts), len(stories))

    live = bool(ig or tg or xc)
    stories = stories[:getattr(cfg, "COMPARE_MAX_STORIES", len(stories))]
    x_done = state.data.setdefault("compare_x", {})
    if xc and not x_done.get(today.isoformat()):
        try:
            ids = xc.thread(x_text(picked, today), posts, 2, "👇 Diğer ürünler")
            log.info("  X'te paylaşıldı: %d post", len(ids))
            x_done[today.isoformat()] = True
        except Exception as e:
            log.error("  X HATA: %s", e)
    for d in [d for d in x_done if d < (today - timedelta(days=7)).isoformat()]:
        del x_done[d]
    if ig:
        def up(p: Path) -> str:
            return host.upload(p, f"{cdir.name}_{p.stem}")
        need = 1 + len(stories) + (1 if reel_path else 0)
        left = ig.quota_left()
        if left is not None and left < need:
            raise RuntimeError(f"Instagram 24 saatlik kotası yetersiz (kalan {left}, gereken {need}); "
                               f"sonraki turda denenecek")
        ig.post_images([up(p) for p in posts], cap)
        for s in stories:
            ig.post_story(up(s))
        if reel_path and hasattr(ig, "post_reel"):
            try:
                ig.post_reel(up(reel_path), cap)
                log.info("  Reels paylaşıldı")
                state.data.setdefault("compare_reels", {})[today.isoformat()] = True
            except Exception as e:
                log.error("  Reels HATA: %s", e)
        if tg:
            tg.text(f"✅ Paylaşıldı: <b>Aynı ürün, farklı fiyat</b> ({n} ürün)")
    elif tg:
        tg.text(f"🏷️ <b>AYNI ÜRÜN, FARKLI FİYAT</b> – {html.escape(date_tr(today))}\n\n"
                f"📌 <b>GÖNDERİ</b>: aşağıdaki {len(posts)} görseli sırasıyla kaydırmalı gönderi olarak paylaş.")
        tg.photos(posts)
        tg.text("✍️ Açıklama (kopyalamak için dokun):")
        tg.copyable(cap)
        tg.text(f"📱 <b>HİKÂYELER</b>: {len(stories)} görsel, sırayla paylaş.")
        tg.photos(stories)
        if reel_path:
            tg.text("🎬 <b>REELS</b>: aşağıdaki videoyu Reels olarak paylaş (açıklama yukarıdaki ile aynı).")
            tg.video(reel_path)
    if live:
        done[today.isoformat()] = [p.id for p in picked]
        # eski kayıtları temizle
        for d in [d for d in done if d < (today - timedelta(days=60)).isoformat()]:
            del done[d]
    return 0
