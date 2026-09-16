"""Tests for analysis.hourly on a handful of synthetic trips."""

import pandas as pd
import pytest

from analysis import hourly


def _trips() -> pd.DataFrame:
    rows = [
        # origin, destination, started_at (UTC), ended_at (UTC)
        ("A", "B", "2019-06-01 07:10:00+00:00", "2019-06-01 07:30:00+00:00"),
        ("A", "C", "2019-06-01 07:50:00+00:00", "2019-06-01 08:05:00+00:00"),
        ("B", "A", "2019-06-01 16:00:00+00:00", "2019-06-01 16:20:00+00:00"),
        ("C", "A", "2020-01-10 23:30:00+00:00", "2020-01-11 00:10:00+00:00"),
    ]
    return pd.DataFrame(rows, columns=["origin", "destination", "started_at", "ended_at"])


def test_add_local_hours_uses_uk_clock() -> None:
    t = hourly.add_local_hours(_trips())
    # June is BST: 07:10 UTC -> 08 local. January is GMT: 23:30 UTC -> 23 local.
    assert t["start_hour"].tolist() == [8, 8, 17, 23]
    assert t["end_hour"].tolist() == [8, 9, 17, 0]
    assert t["start_date"].iloc[0] == "2019-06-01"
    # 1 June 2019 was a Saturday; 10 January 2020 a Friday.
    assert t["daytype"].tolist() == ["weekend", "weekend", "weekend", "weekday"]


def test_hourly_role_counts_and_profile() -> None:
    t = hourly.add_local_hours(_trips())
    h = hourly.hourly_role_counts(t)
    a8 = h[(h["station"] == "A") & (h["hour"] == 8)].iloc[0]
    assert a8["out"] == 2 and a8["in"] == 0
    a17 = h[(h["station"] == "A") & (h["hour"] == 17)].iloc[0]
    assert a17["out"] == 0 and a17["in"] == 1

    prof = hourly.hourly_profile(h, "A", hours=(6, 7, 8, 17))
    assert prof["hours"] == [6, 7, 8, 17]
    assert prof["out"] == [0, 0, 2, 0]
    assert prof["in"] == [0, 0, 0, 1]
    for o, i in zip(prof["out_pct"], prof["in_pct"]):
        assert o + i in (0.0, 100.0)
    # Day-type slices: A's trips are all on the Saturday except C->A (Friday 23:00).
    wk = hourly.hourly_profile(h, "A", hours=(8, 23), daytype="weekday")
    assert wk["out"] == [0, 0] and wk["in"] == [0, 0]   # C->A ends at 00 local, not 23
    we = hourly.hourly_profile(h, "A", hours=(8, 17), daytype="weekend")
    assert we["out"] == [2, 0] and we["in"] == [0, 1]


def test_combine_hourly_sums_chunks() -> None:
    t = hourly.add_local_hours(_trips())
    h1 = hourly.hourly_role_counts(t.iloc[:2])
    h2 = hourly.hourly_role_counts(t.iloc[2:])
    both = hourly.combine_hourly([h1, h2])
    full = hourly.hourly_role_counts(t)
    pd.testing.assert_frame_equal(both, full)


def test_first_trip_dates_across_roles() -> None:
    t = hourly.add_local_hours(_trips())
    fd = hourly.first_trip_dates(t)
    assert fd["A"] == "2019-06-01"
    assert fd["C"] == "2019-06-01"  # first appears as a destination
    combined = hourly.combine_first_dates([fd, pd.Series({"A": "2018-01-01"})])
    assert combined["A"] == "2018-01-01"


def test_daytype_od_counts_and_system_profile() -> None:
    t = hourly.add_local_hours(_trips())
    odc = hourly.combine_od_counts([hourly.daytype_od_counts(t.iloc[:2]), hourly.daytype_od_counts(t.iloc[2:])])
    we = hourly.od_for_daytype(odc, "weekend").set_index(["origin", "destination"])["trips"]
    assert we[("A", "B")] == 1 and we[("B", "A")] == 1
    wd = hourly.od_for_daytype(odc, "weekday")
    assert wd["trips"].sum() == 1 and set(wd.columns) == {"origin", "destination", "trips"}

    days = hourly.day_counts("2019-06-01", "2019-06-07")   # Sat..Fri
    assert days == {"weekday": 5, "weekend": 2}
    prof = hourly.system_profile(hourly.hourly_role_counts(t), days, hours=(8, 17, 23))
    assert prof["weekend"]["trips"] == [2, 1, 0] and prof["weekend"]["days"] == 2
    assert prof["weekend"]["per_day"] == [1.0, 0.5, 0.0]
    assert prof["weekday"]["trips"] == [0, 0, 1]
    assert sum(prof["all"]["share_pct"]) == pytest.approx(100, abs=0.05)
