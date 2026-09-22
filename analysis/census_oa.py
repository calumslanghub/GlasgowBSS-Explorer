"""Census 2022 tables -> one row of CENSUS_VARS values per output area.

The dissertation's ``CensusFix_2.ipynb`` scored each station buffer by summing
the census counts of the output areas it intersects. The same weighted scores
are computed here for a single output area, so the map can colour the real
geography rather than a circle. Pure functions; no I/O.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from analysis.context import CENSUS_VARS

# Scores applied to the census count columns, as in the notebook.
HEALTH_VALUE: dict[str, int] = {
    "Very good": 5, "Good": 4, "Fair": 3, "Bad": 2, "Very bad": 1,
}
CARS_VALUE: dict[str, int] = {
    "Number of cars or vans in household: No cars or vans": 0,
    "Number of cars or vans in household: One car or van": 1,
    "Number of cars or vans in household: Two cars or vans": 2,
    "Number of cars or vans in household: Three cars or vans": 3,
    "Number of cars or vans in household: Four or more cars or vans": 4,
}
# Commute bands with an actual physical distance (work-from-home and no fixed
# workplace have no distance to be near or far).
DISTANCE_BANDS: tuple[str, ...] = (
    "d_lt2", "d_2_5", "d_5_10", "d_10_20", "d_20_30", "d_30_40", "d_40_60", "d_60plus",
)


def age_value(columns: list[str]) -> dict[str, int]:
    """Midpoint age for each single-year column of the age table."""
    out: dict[str, int] = {}
    for c in columns:
        if c == "Under 1":
            out[c] = 0
        elif c == "100 and over":
            out[c] = 100
        else:
            out[c] = int(c)
    return out


def nssec_score(columns: list[str]) -> dict[str, int]:
    """NS-SeC class number per column; L15 (full-time students) is excluded."""
    scores: dict[str, int] = {}
    for c in columns:
        m = re.match(r"L(\d+)", c)
        if m and int(m.group(1)) != 15:
            scores[c] = int(m.group(1))
    return scores


def _weighted_mean(df: pd.DataFrame, scores: dict[str, int]) -> pd.Series:
    """Score-weighted mean per row; NaN where the row has nobody to average."""
    cols = [c for c in scores if c in df.columns]
    if not cols:
        return pd.Series(np.nan, index=df.index)
    counts = df[cols]
    denom = counts.sum(axis=1)
    total = sum(counts[c] * scores[c] for c in cols)
    return total.div(denom.where(denom > 0))


def _share(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    """Fraction, NaN where the denominator is zero."""
    return numerator.div(denominator.where(denominator > 0))


def oa_values(
    master: pd.DataFrame,
    age_cols: list[str],
    nssec_cols: list[str],
    premises: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Every CENSUS_VARS value for each output area.

    Args:
        master: One row per output area, indexed by ``Datazone`` (the census
            tables' output-area code), holding the raw count columns of the age,
            health, cars, NS-SeC, student, commute-distance, resident and
            workplace-population tables.
        age_cols: The single-year age columns of the age table.
        nssec_cols: The ``L*`` columns of the NS-SeC table.
        premises: Optional ``code, n_on_premises, premises_capacity`` counts of
            licensed premises falling inside each output area.

    Returns:
        A frame indexed by output-area code with exactly the ``CENSUS_VARS``
        keys as columns, ``pct`` variables scaled to percent and every value
        rounded to its display precision. ``NaN`` marks an output area the
        source does not cover or whose denominator is zero.
    """
    m = master
    out = pd.DataFrame(index=m.index)
    out["avg_age"] = _weighted_mean(m, age_value(age_cols))
    out["student_share"] = _share(m["StudentPop"], m["TotalPop"])
    out["avg_cars_per_household"] = _weighted_mean(m, CARS_VALUE)
    out["avg_health_score"] = _weighted_mean(m, HEALTH_VALUE)
    out["avg_nssec_score"] = _weighted_mean(m, nssec_score(nssec_cols))
    bands = [c for c in DISTANCE_BANDS if c in m.columns]
    commuters = m[bands].sum(axis=1) if bands else pd.Series(0, index=m.index)
    cycling = m[["d_2_5", "d_5_10", "d_10_20"]].sum(axis=1)
    out["cycling_distance_share_ext"] = _share(cycling, commuters)
    out["male_female_ratio"] = _share(m["Male"], m["Female"])
    out["over16pop"] = m["over16pop"]
    out["workplace_pop"] = m["workplace_pop"]

    counts = premises.set_index("code") if premises is not None else None
    for key in ("n_on_premises", "premises_capacity"):
        if counts is not None and key in counts.columns:
            out[key] = counts[key].reindex(out.index).fillna(0)
        else:
            out[key] = np.nan

    for key, meta in CENSUS_VARS.items():
        col = out[key].astype(float) * (100 if meta.get("pct") else 1)
        out[key] = col.round(meta["dp"]) if meta["dp"] else col.round(0)
    return out[list(CENSUS_VARS)]
