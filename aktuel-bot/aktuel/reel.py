"""'Aynı ürün, farklı fiyat' Reels videosu (1080x1920, MP4).

Kurgu: kapak → her ürün için fiyatlar pahalıdan ucuza tek tek açılır → en ucuz market
yeşil yanar ve fark yazılır → kapanış ekranı. Kareler PIL ile çizilir, ffmpeg ile birleştirilir.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw

from .render import STORY_SIZE, _font
from .render_compare import ACCENT, MUTED, WHITE, _gradient, render_cover, render_product

log = logging.getLogger("aktuel")

COVER_SEC = 2.5
PRODUCT_INTRO_SEC = 0.8
ROW_SEC = 0.45
PRODUCT_FULL_SEC = 2.2
OUTRO_SEC = 2.5


def _outro(handle: str) -> Image.Image:
    W, H = STORY_SIZE
    c = _gradient(STORY_SIZE)
    d = ImageDraw.Draw(c)
    d.text((W / 2, H * 0.40), "Her gün yeni fiyatlar", font=_font("ExtraBold", 76), fill=WHITE, anchor="mm")
    d.text((W / 2, H * 0.40 + 100), "Alışverişten önce kaydet!", font=_font("Bold", 48), fill=ACCENT, anchor="mm")
    if handle:
        d.text((W / 2, H * 0.40 + 230), f"Takip et → @{handle}", font=_font("Bold", 46), fill=WHITE, anchor="mm")
    d.text((W / 2, H - 300), "Kaynak: marketfiyati.org.tr", font=_font("SemiBold", 28), fill=MUTED, anchor="mm")
    return c


def _ffmpeg() -> str | None:
    """Sistemdeki ffmpeg; yoksa imageio-ffmpeg paketinin getirdiği hazır ffmpeg."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def build(products, imgs, today: date, area: str, handle: str, out: Path,
          music: Path | None = None) -> Path | None:
    ffmpeg = _ffmpeg()
    if not ffmpeg:
        log.warning("  ffmpeg yok, Reels üretilemedi.")
        return None
    fdir = out.parent / (out.stem + "_frames")
    fdir.mkdir(parents=True, exist_ok=True)
    frames: list[tuple[Path, float]] = []

    def add(im: Image.Image, sec: float):
        p = fdir / f"f{len(frames):03d}.jpg"
        im.convert("RGB").save(p, "JPEG", quality=92)
        frames.append((p, sec))

    add(render_cover(products, imgs, today, area, handle, STORY_SIZE, cta="İzle, en ucuzu bul!"), COVER_SEC)
    n = len(products)
    for i, (p, im) in enumerate(zip(products, imgs), 1):
        rows = len(p.offers)
        add(render_product(p, im, i, n, today, area, handle, STORY_SIZE, reveal=0), PRODUCT_INTRO_SEC)
        for k in range(1, rows):
            add(render_product(p, im, i, n, today, area, handle, STORY_SIZE, reveal=k), ROW_SEC)
        add(render_product(p, im, i, n, today, area, handle, STORY_SIZE), PRODUCT_FULL_SEC)
    add(_outro(handle), OUTRO_SEC)

    lst = fdir / "list.txt"
    lines = []
    for p, sec in frames:
        lines += [f"file '{p.name}'", f"duration {sec}"]
    lines.append(f"file '{frames[-1][0].name}'")  # concat demuxer son kareyi tekrar ister
    lst.write_text("\n".join(lines) + "\n", encoding="utf-8")
    total = sum(sec for _, sec in frames)

    cmd = [ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst)]
    if music and music.exists():
        cmd += ["-stream_loop", "-1", "-i", str(music)]
    else:  # sessiz ses kanalı: bazı platformlar ses kanalı olmayan videoyu sorunlu işliyor
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
    cmd += ["-t", f"{total:.2f}", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "21", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True, cwd=fdir)
    shutil.rmtree(fdir, ignore_errors=True)
    log.info("  Reels hazır: %s (%.0f sn)", out, total)
    return out
