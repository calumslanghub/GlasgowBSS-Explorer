"""The k-means commuter classification as scatter-plot rows.

The clustering itself ran in the dissertation (``commuterk-means.py``) on
three standardised features per unordered station pair, using pre-COVID trips
only: ``peak_share``, ``log(weekday_rate_ratio)`` and ``reversal``.
``midday_share`` was a diagnostic and is deliberately not exported. Pure
functions: DataFrames in, JSON-ready structures out.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Exported metric key -> (source column, label, axis note). The weekday ratio
# is logged, exactly as it entered the clustering.
METRICS: dict[str, dict[str, str]] = {
    "peak": {"col": "peak_share", "label": "Peak share",
             "note": "share of trips in the 07-10 and 16-19 weekday peaks"},
    "wk": {"col": "weekday_rate_ratio", "label": "Weekday : weekend ratio (log)",
           "note": "log of trips per weekday over trips per weekend day"},
    "rev": {"col": "reversal", "label": "Reversal",
            "note": "0 = same direction AM and PM, 2 = full flip"},
}


def pair_trips_undirected(od: pd.DataFrame) -> dict[tuple[str, str], int]:
    """All-time trips per unordered pair, both directions summed."""
    lo = np.where(od["origin"] <= od["destination"], od["origin"], od["destination"])
    hi = np.where(od["origin"] <= od["destination"], od["destination"], od["origin"])
    g = pd.DataFrame({"a": lo, "b": hi, "t": od["trips"]}).groupby(["a", "b"])["t"].sum()
    return {k: int(v) for k, v in g.items()}


def scatter_rows(
    labels: pd.DataFrame, all_time: dict[tuple[str, str], int] | None = None
) -> list[dict]:
    """One row per classified pair: stations, metrics, label and trip counts.

    Args:
        labels: The k-means output (``origin_c, dest_c, total, peak_share,
            weekday_rate_ratio, reversal, is_commuter``).
        all_time: Optional all-time trips per unordered pair.

    Returns:
        Rows ``{a, b, peak, wk, rev, c, pre, trips}`` with ``c`` 1 for commuter.
    """
    all_time = all_time or {}
    out: list[dict] = []
    for r in labels.itertuples(index=False):
        a, b = sorted((r.origin_c, r.dest_c))
        out.append({
            "a": a, "b": b,
            "peak": round(float(r.peak_share), 4),
            "wk": round(float(np.log(r.weekday_rate_ratio)), 4),
            "rev": round(float(r.reversal), 4),
            "c": int(bool(r.is_commuter)),
            "pre": int(r.total),
            "trips": all_time.get((a, b), int(r.total)),
        })
    return out


def cluster_summary(rows: list[dict]) -> dict[str, dict]:
    """Pair count and mean of each metric for the two clusters."""
    df = pd.DataFrame(rows)
    out: dict[str, dict] = {}
    for flag, name in ((1, "commuter"), (0, "non-commuter")):
        sub = df[df["c"] == flag] if len(df) else df
        out[name] = {"n": int(len(sub))}
        for k in METRICS:
            out[name][k] = round(float(sub[k].mean()), 3) if len(sub) else None
    return out


def cluster_profile(clusters: dict[str, dict]) -> list[dict]:
    """Cluster means as bar-chart rows, one per metric (dissertation figure 4)."""
    c, n = clusters["commuter"], clusters["non-commuter"]
    return [
        {"metric": meta["label"], "commuter": c[k], "noncommuter": n[k],
         "n_c": c["n"], "n_n": n["n"]}
        for k, meta in METRICS.items()
    ]
