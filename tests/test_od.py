"""Tests for analysis.od on a small synthetic OD matrix."""

import pandas as pd
import pytest

from analysis import od as od_mod


@pytest.fixture
def od() -> pd.DataFrame:
    rows = [
        ("A", "B", 50),
        ("A", "C", 30),
        ("A", "D", 20),
        ("A", "E", 5),
        ("A", "F", 1),
        ("A", "G", 1),
        ("B", "A", 10),
        ("C", "A", 40),
        ("D", "A", 15),
        ("B", "C", 7),
    ]
    return pd.DataFrame(rows, columns=["origin", "destination", "trips"])


def test_top_n_destinations_order_and_share(od: pd.DataFrame) -> None:
    top = od_mod.top_n_destinations(od, "A", n=5)
    assert top["station"].tolist() == ["B", "C", "D", "E", "F"]
    assert top["trips"].tolist() == [50, 30, 20, 5, 1]
    # Share is of all outbound trips from A (107), not of the top 5.
    assert top["share"].iloc[0] == pytest.approx(50 / 107 * 100, abs=0.01)


def test_top_n_destinations_tie_break_is_alphabetical(od: pd.DataFrame) -> None:
    top = od_mod.top_n_destinations(od, "A", n=10)
    assert top["station"].tolist()[-2:] == ["F", "G"]


def test_top_n_origins(od: pd.DataFrame) -> None:
    top = od_mod.top_n_origins(od, "A", n=2)
    assert top["station"].tolist() == ["C", "D"]
    assert top["trips"].tolist() == [40, 15]


def test_origin_dest_shares_sum_to_100(od: pd.DataFrame) -> None:
    s = od_mod.origin_dest_shares(od, "A")
    assert s["out_trips"] == 107
    assert s["in_trips"] == 65
    assert s["out_share"] + s["in_share"] == pytest.approx(100)


def test_shares_for_unknown_station_are_zero(od: pd.DataFrame) -> None:
    s = od_mod.origin_dest_shares(od, "ZZZ")
    assert s == {"out_trips": 0, "in_trips": 0, "out_share": 0.0, "in_share": 0.0}


def test_station_totals(od: pd.DataFrame) -> None:
    tot = od_mod.station_totals(od).set_index("station")
    assert tot.loc["A", "out_trips"] == 107
    assert tot.loc["A", "in_trips"] == 65
    assert tot.loc["G", "in_trips"] == 1 and tot.loc["G", "out_trips"] == 0


def test_od_summary_and_top_pairs(od: pd.DataFrame) -> None:
    summary = od_mod.od_summary(od, ["A", "B"], n=2)
    assert set(summary) == {"A", "B"}
    assert [r["station"] for r in summary["A"]["top_dest"]] == ["B", "C"]
    pairs = od_mod.top_pairs(summary)
    assert ("A", "B") in pairs and ("C", "A") in pairs


def test_missing_columns_raise() -> None:
    with pytest.raises(ValueError):
        od_mod.top_n_destinations(pd.DataFrame({"x": [1]}), "A")


def test_compare_daytypes_reports_union_sorted_by_shift(od: pd.DataFrame) -> None:
    weekend = pd.DataFrame(
        [("A", "B", 10), ("A", "C", 60), ("A", "H", 30)], columns=["origin", "destination", "trips"]
    )
    rows = od_mod.compare_daytypes(od, weekend, "A", "out", n=2)
    # Top 2 weekday: B, C. Top 2 weekend: C, H. Union = B, C, H.
    assert {r["station"] for r in rows} == {"B", "C", "H"}
    by = {r["station"]: r for r in rows}
    assert by["H"]["weekday_trips"] == 0 and by["H"]["weekend_share"] == 30.0
    assert by["B"]["weekday_share"] == pytest.approx(50 / 107 * 100, abs=0.01)
    assert rows[0]["diff"] >= rows[-1]["diff"]
    assert rows[0]["station"] == "C"   # +60% - 28% is the largest weekend gain


def test_station_share_shift(od: pd.DataFrame) -> None:
    weekend = pd.DataFrame([("A", "B", 10), ("C", "B", 10)], columns=["origin", "destination", "trips"])
    rows = od_mod.station_share_shift(od, weekend, n=1)
    by = {r["station"]: r for r in rows}
    assert "A" in by and "B" in by
    assert by["B"]["weekend_share"] == 100.0   # B touches every weekend trip
