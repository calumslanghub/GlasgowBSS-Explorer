"""Tests for analysis.context (phase 3 joins)."""

import pandas as pd
import pytest

from analysis import context


@pytest.fixture
def od() -> pd.DataFrame:
    return pd.DataFrame(
        [("A", "B", 60), ("A", "C", 40), ("B", "A", 20), ("D", "A", 10)],
        columns=["origin", "destination", "trips"],
    )


@pytest.fixture
def panel() -> pd.DataFrame:
    cols = ["origin", "destination", "block", "trips", "len_any_m",
            "exp_segregated", "exp_lane", "exp_shared", "exp_mixed", "exp_any"]
    rows = [
        ("A", "B", 1, 30, 1000, 0.0, 0.0, 0.0, 0.0, 0.0),
        ("A", "B", 2, 30, 1000, 0.5, 0.0, 0.0, 0.0, 0.5),  # weighted mean -> 0.25
        ("A", "C", 1, 40, 500, 0.0, 1.0, 0.0, 0.0, 1.0),
        ("B", "A", 1, 20, 1000, 0.0, 0.0, 0.0, 0.0, 0.0),
    ]
    return pd.DataFrame(rows, columns=cols)


@pytest.fixture
def labels() -> pd.DataFrame:
    return pd.DataFrame(
        [("A", "B", True), ("A", "C", False)],
        columns=["origin_c", "dest_c", "is_commuter"],
    )


def test_pair_exposure_is_trip_weighted(panel: pd.DataFrame) -> None:
    e = context.pair_exposure(panel).set_index(["origin", "destination"])
    assert e.loc[("A", "B"), "exp_any"] == pytest.approx(0.25)
    assert e.loc[("A", "B"), "trips"] == 60
    assert e.loc[("A", "C"), "exp_lane"] == pytest.approx(1.0)


def test_label_pair_uses_canonical_order(labels: pd.DataFrame) -> None:
    lk = context.commuter_lookup(labels)
    assert context.label_pair("B", "A", lk) is True
    assert context.label_pair("A", "C", lk) is False
    assert context.label_pair("A", "Z", lk) is None


def test_corridor_rows_enrich(od: pd.DataFrame, panel: pd.DataFrame, labels: pd.DataFrame) -> None:
    lk = context.commuter_lookup(labels)
    exp = context.pair_exposure(panel)
    rows = context.corridor_rows(
        [{"station": "B", "trips": 60, "share": 60.0}, {"station": "C", "trips": 40, "share": 40.0}],
        "A", "out", exp, lk,
    )
    assert rows[0]["commuter"] == "commuter" and rows[0]["exp_any"] == 25.0
    assert rows[1]["commuter"] == "non-commuter" and rows[1]["exp_lane"] == 100.0
    # Inbound rows are keyed (partner -> station).
    rows_in = context.corridor_rows([{"station": "D", "trips": 10, "share": 100.0}], "A", "in", exp, lk)
    # Unlabelled pairs count as non-commuter (as in the regression).
    assert rows_in[0]["commuter"] == "non-commuter" and rows_in[0]["exp_any"] == 0.0


def test_undirected_corridors_combine_directions(od: pd.DataFrame, panel: pd.DataFrame, labels: pd.DataFrame) -> None:
    lk = context.commuter_lookup(labels)
    exp = context.pair_exposure(panel)
    rows = context.undirected_corridors(od, exp, lk, "A", n=2)
    assert [r["station"] for r in rows] == ["B", "C"]
    assert rows[0]["trips"] == 80  # 60 out + 20 in
    assert rows[0]["commuter"] == "commuter"
    # (60*0.25 + 20*0) / 80 = 18.75 -> 18.8
    assert rows[0]["exp_any"] == pytest.approx(18.8, abs=0.05)
    assert rows[0]["share"] == pytest.approx(80 / 130 * 100, abs=0.01)


def test_station_exposure_and_commuter_share(od: pd.DataFrame, panel: pd.DataFrame, labels: pd.DataFrame) -> None:
    lk = context.commuter_lookup(labels)
    exp = context.pair_exposure(panel)
    se = context.station_exposure(od, exp, "A")
    # (60*0.25 + 40*1.0 + 20*0 + 10*0) / 130 = 0.4231
    assert se["any"] == pytest.approx(42.3, abs=0.05)
    cs = context.commuter_share(od, lk, "A")
    # labelled trips: A-B (60+20) + A-C (40) = 120 of 130; commuter = 80 of ALL 130.
    assert cs["classified_pct"] == pytest.approx(92.3, abs=0.05)
    assert cs["commuter_pct"] == pytest.approx(61.5, abs=0.05)
    assert cs["commuter_pairs"] == 1


@pytest.fixture
def station_vars() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "station_id": ["A", "A", "B"], "buffer_m": [150, 250, 250],
            "avg_age": [30.0, 35.0, 40.0], "student_share": [0.1, 0.25, 0.05],
            "avg_cars_per_household": [0.5, 0.6, 1.2], "avg_health_score": [4.0, 4.1, 4.3],
            "avg_nssec_score": [7.0, 7.5, 6.0], "cycling_distance_share_ext": [0.5, 0.6, 0.7],
            "male_female_ratio": [1.0, 1.1, 0.9],
            "over16pop": [100, 200, 1000], "workplace_pop": [300, 400, 50],
        }
    )


@pytest.fixture
def premises() -> pd.DataFrame:
    return pd.DataFrame({"station_id": ["A"], "buffer_m": [250], "n_on_premises": [3], "total_capacity_on": [500.0]})


def test_census_table_scales_and_fills(station_vars: pd.DataFrame, premises: pd.DataFrame) -> None:
    t = context.census_table(station_vars, premises, ["A", "B", "ZZ"], buffers=(150, 250))
    assert t["A"][250]["avg_age"] == 35.0 and t["A"][250]["student_share"] == 25.0
    assert t["A"][250]["n_on_premises"] == 3 and t["A"][250]["premises_capacity"] == 500
    assert t["A"][150]["avg_age"] == 30.0
    assert t["B"][250]["n_on_premises"] is None          # no premises row
    assert t["ZZ"][250]["avg_age"] is None               # unknown station
    assert set(t["A"][250]) == set(context.CENSUS_VARS)


def test_variable_ranking_and_population_balance(station_vars: pd.DataFrame, premises: pd.DataFrame) -> None:
    t = context.census_table(station_vars, premises, ["A", "B", "ZZ"], buffers=(250,))
    rk = context.variable_ranking(t, "avg_age", 250, n=1)
    assert rk["top"] == [{"station": "B", "value": 40.0}]
    assert rk["bottom"] == [{"station": "A", "value": 35.0}]
    assert rk["n"] == 2 and rk["min"] == 35.0 and rk["max"] == 40.0
    bal = context.population_balance(t, 250)
    assert [r["station"] for r in bal] == ["A", "B"]      # A is job-rich (400 vs 200)
    assert bal[0]["workplace_pct"] == pytest.approx(66.7, abs=0.05)
    assert bal[1]["log_ratio"] < 0


def test_network_summary(od: pd.DataFrame, panel: pd.DataFrame, labels: pd.DataFrame) -> None:
    s = context.network_summary(od, context.pair_exposure(panel), context.commuter_lookup(labels))
    assert s["trips"] == 130 and s["pairs"] == 4
    assert s["commuter_pct"] == pytest.approx(61.5, abs=0.05)
