"""Tests for analysis.loads (edge loads and segment usage)."""

import pytest

from analysis import loads


LOOKUP = {("A", "B"): True, ("A", "C"): False}
PAIR_EDGES = {
    ("A", "B"): ["e1", "e2", "e3"],
    ("B", "A"): ["e3", "e2", "e1"],
    ("A", "C"): ["e1", "e4"],
    ("A", "D"): ["e4", "e5"],
}
PAIR_TRIPS = {("A", "B"): 100, ("B", "A"): 50, ("A", "C"): 20, ("A", "D"): 7}


def cats() -> dict:
    return {p: loads.pair_category(p[0], p[1], LOOKUP) for p in PAIR_EDGES}


def test_pair_category_is_unordered_and_unlabelled_is_non_commuter() -> None:
    assert loads.pair_category("B", "A", LOOKUP) == "commuter"
    assert loads.pair_category("A", "C", LOOKUP) == "non-commuter"
    assert loads.pair_category("A", "Z", LOOKUP) == "non-commuter"
    assert loads.CATEGORIES == ("commuter", "non-commuter")


def test_accumulate_loads_sums_both_directions_by_category() -> None:
    ld = loads.accumulate_loads(PAIR_EDGES, PAIR_TRIPS, cats())
    assert ld["e2"] == {"commuter": 150, "non-commuter": 0}
    assert ld["e1"] == {"commuter": 150, "non-commuter": 20}
    assert ld["e4"] == {"commuter": 0, "non-commuter": 27}   # A->C (20) + unlabelled A->D (7)
    assert "e9" not in ld


def test_segment_usage_counts_a_pair_once_per_segment() -> None:
    # Segment S1 overlaps e1 (20 m) and e2 (15 m): together 35 m >= 30 m, but
    # neither edge alone would qualify. S2 overlaps only e5 by 5 m (ignored).
    overlap = {"e1": {"S1": 20.0}, "e2": {"S1": 15.0}, "e5": {"S2": 5.0}}
    counts, pair_overlap = loads.segment_usage(PAIR_EDGES, PAIR_TRIPS, cats(), overlap)
    assert counts["S1"]["commuter"] == 150  # A->B and B->A, once each
    assert counts["S1"]["non-commuter"] == 0  # A->C only touches e1 (20 m < 30)
    assert "S2" not in counts
    assert pair_overlap[("A", "B")] == 35.0
    assert pair_overlap[("A", "C")] == 0.0


def test_usage_summary_and_category_totals() -> None:
    overlap = {"e2": {"S1": 40.0}}
    _, po = loads.segment_usage(PAIR_EDGES, PAIR_TRIPS, cats(), overlap)
    s_all = loads.usage_summary(PAIR_TRIPS, cats(), po)
    assert s_all["trips_total"] == 177 and s_all["trips_on"] == 150
    assert s_all["share_pct"] == pytest.approx(84.7, abs=0.05)
    s_c = loads.usage_summary(PAIR_TRIPS, cats(), po, category="commuter")
    assert s_c == {"trips_total": 150, "trips_on": 150, "share_pct": 100.0, "pairs_total": 2, "pairs_on": 2}
    tot = loads.category_totals(PAIR_TRIPS, cats())
    assert tot["commuter"]["trips"] == 150 and tot["non-commuter"]["pairs"] == 2
    assert set(tot) == {"commuter", "non-commuter"}
    assert sum(v["pct"] for v in tot.values()) == pytest.approx(100, abs=0.2)
