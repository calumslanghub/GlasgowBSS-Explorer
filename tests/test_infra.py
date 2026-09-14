"""Tests for analysis.infra dating rules and the timeline aggregation."""

from datetime import date

import pandas as pd

from analysis import infra


def _row(**kw: object) -> dict:
    base = {"OBJECTID": 1, "PUB_CLASS": "Cycle Lane", "EXTRA_INFO": None, "ROUTENAMEO": None}
    base.update(kw)
    return base


def test_segment_override_beats_scheme() -> None:
    # OBJECTID 1844 (Argyle Street) is dated even though EXTRA_INFO says SCW.
    row = _row(OBJECTID=1844, EXTRA_INFO="South City Way", ROUTENAMEO="Victoria Rd")
    assert infra.derive_opened(row) == date(2020, 9, 1)


def test_phased_scheme_dated_by_street() -> None:
    row = _row(OBJECTID=99999, EXTRA_INFO="South City Way", ROUTENAMEO="Gorbals St")
    assert infra.derive_opened(row) == date(2023, 4, 3)


def test_scheme_level_and_spelling_normalisation() -> None:
    assert infra.derive_opened(_row(OBJECTID=5, EXTRA_INFO="Connecting Woodside")) == date(2021, 6, 6)
    assert infra.normalise_scheme("South West City Way") == "South-West City Way"
    assert infra.normalise_scheme(float("nan")) is None


def test_default_is_study_start() -> None:
    assert infra.derive_opened(_row(OBJECTID=5)) == infra.STUDY_START
    assert infra.derive_opened(_row(OBJECTID=5, EXTRA_INFO="Signage")) == infra.STUDY_START


def test_date_segments_maps_type_and_drops_unknown() -> None:
    df = pd.DataFrame(
        [
            _row(OBJECTID=1, PUB_CLASS="Shared Path"),
            _row(OBJECTID=2, PUB_CLASS="Not a class"),
            _row(OBJECTID=1363, PUB_CLASS="Segregated Cycle Lane"),
        ]
    )
    out = infra.date_segments(df)
    assert out["infra_type"].tolist() == ["shared", "segregated"]
    assert out["opened"].tolist() == [infra.STUDY_START, date(2021, 4, 10)]


def test_km_open_by_type_is_cumulative() -> None:
    seg = pd.DataFrame(
        {
            "infra_type": ["lane", "segregated", "lane"],
            "opened": [date(2017, 9, 15), date(2020, 1, 1), date(2022, 1, 1)],
            "length_m": [1000.0, 2000.0, 500.0],
        }
    )
    dates = [date(2018, 1, 1), date(2020, 6, 1), date(2023, 1, 1)]
    km = infra.km_open_by_type(seg, dates)
    assert km["lane"].tolist() == [1.0, 1.0, 1.5]
    assert km["segregated"].tolist() == [0.0, 2.0, 2.0]
    assert km["any"].tolist() == [1.0, 3.0, 3.5]


def test_month_starts_and_station_counts() -> None:
    dates = infra.month_starts(date(2017, 9, 15), date(2017, 12, 10))
    assert dates == [date(2017, 9, 15), date(2017, 10, 1), date(2017, 11, 1), date(2017, 12, 1), date(2017, 12, 10)]
    fd = pd.Series({"A": "2017-09-15", "B": "2017-11-20"})
    assert infra.stations_open_count(fd, dates) == [1, 1, 1, 2, 2]
