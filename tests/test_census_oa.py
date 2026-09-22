"""Tests for analysis.census_oa (per-output-area census scoring)."""

import numpy as np
import pandas as pd
import pytest

from analysis import census_oa
from analysis.context import CENSUS_VARS

AGE_COLS = ["Under 1", "40", "100 and over"]
NSSEC_COLS = ["L1: Employers", "L8: Semi-routine", "L15: Full-time students"]


@pytest.fixture
def master() -> pd.DataFrame:
    """Two output areas; the second has empty denominators throughout."""
    return pd.DataFrame(
        {
            "Male": [60, 0], "Female": [40, 0],
            "Under 1": [2, 0], "40": [6, 0], "100 and over": [2, 0],
            "Very good": [5, 0], "Good": [5, 0], "Fair": [0, 0],
            "Bad": [0, 0], "Very bad": [0, 0],
            "Number of cars or vans in household: No cars or vans": [3, 0],
            "Number of cars or vans in household: One car or van": [1, 0],
            "Number of cars or vans in household: Two cars or vans": [0, 0],
            "Number of cars or vans in household: Three cars or vans": [0, 0],
            "Number of cars or vans in household: Four or more cars or vans": [0, 0],
            "L1: Employers": [3, 0], "L8: Semi-routine": [2, 0],
            "L15: Full-time students": [96, 0],
            "TotalPop": [200, 0], "StudentPop": [50, 0],
            "d_lt2": [10, 0], "d_2_5": [20, 0], "d_5_10": [20, 0], "d_10_20": [10, 0],
            "d_20_30": [40, 0], "d_30_40": [0, 0], "d_40_60": [0, 0], "d_60plus": [0, 0],
            "over16pop": [180, 0], "workplace_pop": [500, np.nan],
        },
        index=pd.Index(["S00000001", "S00000002"], name="Datazone"),
    )


def test_oa_values_scores(master: pd.DataFrame) -> None:
    v = census_oa.oa_values(master, AGE_COLS, NSSEC_COLS)
    a = v.loc["S00000001"]
    assert a["avg_age"] == pytest.approx((0 * 2 + 40 * 6 + 100 * 2) / 10)   # 44.0
    assert a["avg_health_score"] == pytest.approx(4.5)                      # (5*5 + 4*5)/10
    assert a["avg_cars_per_household"] == pytest.approx(0.25)               # (0*3 + 1*1)/4
    assert a["avg_nssec_score"] == pytest.approx(3.8)                       # (1*3 + 8*2)/5, L15 excluded
    assert a["student_share"] == pytest.approx(25.0)                        # fraction x100
    assert a["male_female_ratio"] == pytest.approx(1.5)
    # 2-20 km bands over everyone with a physical commute distance.
    assert a["cycling_distance_share_ext"] == pytest.approx(50.0)
    assert a["over16pop"] == 180 and a["workplace_pop"] == 500


def test_oa_values_are_null_without_a_denominator(master: pd.DataFrame) -> None:
    v = census_oa.oa_values(master, AGE_COLS, NSSEC_COLS)
    b = v.loc["S00000002"]
    for key in ("avg_age", "avg_health_score", "avg_cars_per_household",
                "avg_nssec_score", "student_share", "male_female_ratio",
                "cycling_distance_share_ext", "workplace_pop"):
        assert pd.isna(b[key]), key


def test_oa_values_columns_match_the_shipped_variables(master: pd.DataFrame) -> None:
    v = census_oa.oa_values(master, AGE_COLS, NSSEC_COLS)
    assert list(v.columns) == list(CENSUS_VARS)
    # No premises frame -> the two premises variables are unknown, not zero.
    assert v["n_on_premises"].isna().all()


def test_oa_values_join_premises_counts(master: pd.DataFrame) -> None:
    counts = pd.DataFrame(
        {"code": ["S00000001"], "n_on_premises": [4], "premises_capacity": [820.0]}
    )
    v = census_oa.oa_values(master, AGE_COLS, NSSEC_COLS, counts)
    assert v.loc["S00000001", "n_on_premises"] == 4
    assert v.loc["S00000001", "premises_capacity"] == 820
    # An output area with no premises has none, not a missing value.
    assert v.loc["S00000002", "n_on_premises"] == 0


def test_nssec_score_skips_students() -> None:
    assert census_oa.nssec_score(NSSEC_COLS) == {"L1: Employers": 1, "L8: Semi-routine": 8}


def test_age_value_handles_the_open_ended_bands() -> None:
    assert census_oa.age_value(AGE_COLS) == {"Under 1": 0, "40": 40, "100 and over": 100}
