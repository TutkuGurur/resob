from datetime import date

from aktuel.dates import human_range, parse_tr_date, parse_tr_range

T = date(2026, 11, 24)


def test_parse_date():
    assert parse_tr_date("19 Kas 2026", T) == date(2026, 11, 19)
    assert parse_tr_date("02 Aralık Çarşamba", T) == date(2026, 12, 2)
    assert parse_tr_date("05 Oca", T) == date(2027, 1, 5)


def test_parse_range():
    assert parse_tr_range("21-27 Kasım", T) == (date(2026, 11, 21), date(2026, 11, 27))
    assert parse_tr_range("20 Kasım-20 Aralık", T) == (date(2026, 11, 20), date(2026, 12, 20))
    assert parse_tr_range("24 Mart-31 Aralık", T) == (date(2026, 3, 24), date(2026, 12, 31))
    assert parse_tr_range("25 Kasım Çarşamba", T) == (date(2026, 11, 25), date(2026, 12, 1))


def test_human_range():
    assert human_range(date(2026, 11, 21), date(2026, 11, 27)) == "21-27 Kasım"
    assert human_range(date(2026, 11, 26), date(2026, 12, 2)) == "26 Kasım - 2 Aralık"
