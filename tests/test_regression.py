"""Tests for analysis.regression (ported coefficients -> chart rows)."""

import math

import pytest

from analysis import regression as reg


def test_forest_rows_intervals_and_significance() -> None:
    rows = {r["key"]: r for r in reg.forest_rows()}
    dist = rows["log_dist"]
    assert dist["cluster_lo"] < dist["coef"] < dist["cluster_hi"]
    assert dist["cluster_hi"] - dist["cluster_lo"] > dist["naive_hi"] - dist["naive_lo"]
    assert dist["sig"] is True and dist["p_cluster"] < 0.001
    # Segregated exposure alone loses significance under clustering (p = 0.46).
    seg = rows["exp_segregated"]
    assert seg["p_naive"] < 0.05 < seg["p_cluster"]
    assert seg["sig"] is False
    assert rows["commuter_x_segregated"]["sig"] is True
    assert rows["log_dist"]["irr"] == pytest.approx(math.exp(-1.352), abs=0.001)


def test_irr_curve_matches_dissertation_numbers() -> None:
    c = reg.irr_curve([0.0, 0.1, 1.0])
    assert c["commuter"][0] == 1.0 and c["non_commuter"][0] == 1.0
    # Notebook: full exposure -> IRR 3.30 for commuter pairs; median (0.100) -> 1.13.
    assert c["commuter"][2] == pytest.approx(3.296, abs=0.005)
    assert c["commuter"][1] == pytest.approx(1.13, abs=0.005)
    assert c["non_commuter"][2] == pytest.approx(math.exp(0.1542), abs=0.001)
    assert c["x_pct"] == [0.0, 10.0, 100.0]


def test_model_ladder_aic_reproduces_notebook() -> None:
    ladder = reg.model_ladder()
    assert [m["model"] for m in ladder] == [f"M{i}" for i in range(1, 9)]
    # Notebook printed AIC=108547 for M1 and 107174 for M6 (LL rounded, so +-2).
    assert ladder[0]["aic"] == pytest.approx(108547, abs=2)
    assert ladder[5]["aic"] == pytest.approx(107174, abs=2)
    assert ladder[0]["aic_drop"] == 0
    assert all(m["aic_drop"] >= 0 for m in ladder[1:])


def test_p_value_and_coef_lookup() -> None:
    assert reg.p_value(1.96, 1.0) == pytest.approx(0.05, abs=0.001)
    assert reg.coef("is_commuter") == 0.5286
    with pytest.raises(KeyError):
        reg.coef("nope")
