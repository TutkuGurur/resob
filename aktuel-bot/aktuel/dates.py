"""Türkçe tarih metinlerini (\"19 Kas 2026\", \"21-27 Kasım\", \"20 Kasım-20 Aralık\") çözer."""
from __future__ import annotations

import re
from datetime import date, timedelta

MONTHS = {
    "oca": 1, "şub": 2, "sub": 2, "mar": 3, "nis": 4, "may": 5, "haz": 6,
    "tem": 7, "ağu": 8, "agu": 8, "eyl": 9, "eki": 10, "kas": 11, "ara": 12,
}
MONTH_NAMES = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz",
               "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]


def _month(word: str) -> int | None:
    w = word.strip().lower().replace("i̇", "i")
    return MONTHS.get(w[:3])


def _nearest_year(day: int, month: int, today: date) -> date:
    """Yılı verilmemiş bir tarih için bugüne en yakın yılı seçer."""
    cands = []
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            cands.append(date(y, month, day))
        except ValueError:
            pass
    return min(cands, key=lambda d: abs((d - today).days))


def parse_tr_date(text: str, today: date | None = None) -> date | None:
    """\"19 Kas 2026\" veya \"19 Kasım\" -> date."""
    today = today or date.today()
    m = re.search(r"(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\.?(?:\s+(\d{4}))?", text)
    if not m:
        return None
    month = _month(m.group(2))
    if not month:
        return None
    day = int(m.group(1))
    if m.group(3):
        return date(int(m.group(3)), month, day)
    return _nearest_year(day, month, today)


def parse_tr_range(text: str, today: date | None = None, single_day_len: int = 7):
    """BİM tarzı aralık metinlerini (start, end) olarak döndürür.

    \"25 Kasım Çarşamba\" -> tek gün başlangıç; bitiş = start + single_day_len - 1
    \"21-27 Kasım\"       -> 21 Kasım .. 27 Kasım
    \"20 Kasım-20 Aralık\" -> 20 Kasım .. 20 Aralık
    """
    today = today or date.today()
    t = re.sub(r"\s+", " ", text).strip()
    # "21-27 Kasım"
    m = re.match(r"^(\d{1,2})\s*-\s*(\d{1,2})\s+([^\s\d-]+)", t)
    if m:
        month = _month(m.group(3))
        if month:
            end = _nearest_year(int(m.group(2)), month, today)
            start_month = month if int(m.group(1)) <= int(m.group(2)) else (month - 2) % 12 + 1
            start = _nearest_year(int(m.group(1)), start_month, end)
            return start, end
    # "20 Kasım-20 Aralık" / "24 Mart-31 Aralık"
    m = re.match(r"^(\d{1,2})\s+([^\s\d-]+)\s*-\s*(\d{1,2})\s+([^\s\d-]+)", t)
    if m:
        m1, m2 = _month(m.group(2)), _month(m.group(4))
        if m1 and m2:
            end = _nearest_year(int(m.group(3)), m2, today)
            start = _nearest_year(int(m.group(1)), m1, end)
            if start > end:
                start = start.replace(year=start.year - 1)
            return start, end
    start = parse_tr_date(t, today)
    if start:
        return start, start + timedelta(days=single_day_len - 1)
    return None, None


def human_range(start: date | None, end: date | None) -> str:
    if not start:
        return ""
    if not end or end == start:
        return f"{start.day} {MONTH_NAMES[start.month]}"
    if start.month == end.month:
        return f"{start.day}-{end.day} {MONTH_NAMES[end.month]}"
    return f"{start.day} {MONTH_NAMES[start.month]} - {end.day} {MONTH_NAMES[end.month]}"
