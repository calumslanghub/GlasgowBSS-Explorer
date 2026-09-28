"""Tests for analysis.kmeans (scatter rows for the commuter clustering)."""

import math

import pandas as pd

from analysis import kmeans


def _labels() -> pd.DataFrame:
    return pd.DataFrame(
        [("B", "A", 40, 0.6, math.e, 1.5, 0.1, 1, True),
         ("A", "C", 35, 0.3, 1.0, 0.4, 0.4, 0, False)],
        columns=["origin_c", "dest_c", "total", "peak_share", "weekday_rate_ratio",
                 "reversal", "midday_share", "cluster", "is_commuter"],
    )


def test_scatter_rows_logs_ratio_and_drops_midday() -> None:
    rows = kmeans.scatter_rows(_labels(), {("A", "B"): 99})
    assert rows[0]["a"] == "A" and rows[0]["b"] == "B"   # canonical order
    assert rows[0]["wk"] == 1.0                            # log(e)
    assert rows[0]["c"] == 1 and rows[0]["trips"] == 99
    assert rows[1]["trips"] == 35                          # falls back to pre-COVID
    assert "midday" not in rows[0] and "midday_share" not in rows[0]
    assert set(kmeans.METRICS) == {"peak", "wk", "rev"}


def test_pair_trips_undirected_sums_both_directions() -> None:
    od = pd.DataFrame([("A", "B", 5), ("B", "A", 7), ("A", "C", 1)],
                      columns=["origin", "destination", "trips"])
    assert kmeans.pair_trips_undirected(od) == {("A", "B"): 12, ("A", "C"): 1}


def test_cluster_summary_counts() -> None:
    s = kmeans.cluster_summary(kmeans.scatter_rows(_labels()))
    assert s["commuter"]["n"] == 1 and s["non-commuter"]["n"] == 1
    assert s["commuter"]["peak"] == 0.6


def test_cluster_profile_one_row_per_metric() -> None:
    rows = kmeans.cluster_profile(kmeans.cluster_summary(kmeans.scatter_rows(_labels())))
    assert [r["metric"] for r in rows] == [m["label"] for m in kmeans.METRICS.values()]
    assert rows[0]["commuter"] == 0.6 and rows[0]["n_c"] == 1
