"""Müzikli hikâye videoları ve müzik seçimi.

Hikâye görselleri (1080x1920 JPEG), hafif yaklaşma (zoom) efektli ve müzikli kısa MP4'lere
çevrilir. Müzik videonun süresine göre kırpılır ya da döngüyle uzatılır; başta ve sonda
yumuşak geçiş yapılır. assets/music/ altındaki parçalar sırayla döner.
"""
from __future__ import annotations

import logging
import subprocess
from datetime import date
from pathlib import Path

from .reel import _ffmpeg

log = logging.getLogger("aktuel")
ROOT = Path(__file__).resolve().parent.parent


def tracks(cfg) -> list[Path]:
    out = []
    for rel in getattr(cfg, "MUSIC_TRACKS", []):
        p = ROOT / rel
        if p.exists():
            out.append(p)
    return out


def pick_track(cfg, today: date, offset: int = 0) -> Path | None:
    """4 parça sırayla döner: güne ve içerik sırasına göre."""
    ts = tracks(cfg)
    if not ts:
        return None
    return ts[(today.toordinal() + offset) % len(ts)]


def _probe_duration(ffmpeg: str, path: Path) -> float:
    r = subprocess.run([ffmpeg, "-i", str(path)], capture_output=True, text=True)
    import re
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0


def audio_filter(seconds: float, start: float = 0.0) -> str:
    fade_out = max(0.0, seconds - 1.2)
    return (f"atrim=start={start:.2f},asetpts=PTS-STARTPTS,atrim=0:{seconds:.2f},"
            f"afade=t=in:st=0:d=0.6,afade=t=out:st={fade_out:.2f}:d=1.2,volume=0.85")


def story_video(image: Path, out: Path, seconds: float, music: Path | None, start: float = 0.0) -> Path | None:
    """Tek bir hikâye görselinden müzikli MP4 üretir (1080x1920, 30 fps)."""
    ffmpeg = _ffmpeg()
    if not ffmpeg:
        return None
    frames = int(seconds * 30)
    vf = (f"scale=2160:3840,zoompan=z='min(zoom+0.0004,1.06)':d={frames}:"
          f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,format=yuv420p")
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-loop", "1", "-i", str(image)]
    if music:
        cmd += ["-stream_loop", "-1", "-i", str(music)]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
    af = audio_filter(seconds, start) if music else "anull"
    cmd += ["-filter_complex", f"[0:v]{vf}[v];[1:a]{af}[a]", "-map", "[v]", "-map", "[a]",
            "-t", f"{seconds:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    return out


def story_videos(images: list[Path], cfg, today: date, offset: int = 0,
                 seconds: float | None = None) -> list[Path]:
    """Hikâye görsellerini müzikli videolara çevirir. Video üretilemezse görselleri aynen döndürür.
    Ardışık hikâyelerde müzik kaldığı yerden devam eder (aynı parça, sırayla ilerleyen başlangıç)."""
    if not getattr(cfg, "STORY_VIDEO", False):
        return images
    seconds = seconds or cfg.STORY_VIDEO_SECONDS
    music = pick_track(cfg, today, offset)
    ffmpeg = _ffmpeg()
    if not ffmpeg:
        log.warning("  ffmpeg yok; hikâyeler görsel olarak paylaşılacak.")
        return images
    dur = _probe_duration(ffmpeg, music) if music else 0.0
    out = []
    for i, img in enumerate(images):
        start = (i * seconds) % dur if dur > seconds else 0.0
        try:
            v = story_video(img, img.with_suffix(".mp4"), seconds, music, start)
            out.append(v or img)
        except Exception as e:
            log.warning("  hikâye videosu üretilemedi (%s), görsel kullanılacak: %s", img.name, e)
            out.append(img)
    return out
