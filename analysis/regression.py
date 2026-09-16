"""Regression results from the dissertation, ready for the dashboard (pure).

The final model is a negative-binomial gravity model of trips per directed
station pair (offset: log joint active days), fitted in ``RegressionRun.ipynb``
on 11,060 pairs. Re-estimating it needs the 193 MB trip file and statsmodels,
so the fitted coefficients are ported here as constants (like the
infrastructure dates in ``analysis.infra``) and the functions below turn them
into chart-ready rows. Standard errors: naive MLE, and two-way clustered by
origin and destination station (Cameron-Gelbach-Miller).
"""

from __future__ import annotations

import math

Z95: float = 1.959964

# ── Final model (M8): coef, naive SE, two-way clustered SE, display group ────
# Order follows the dissertation's coefficient plot.
FINAL_MODEL: tuple[dict, ...] = (
    {"key": "log_dist", "label": "log(Route distance)", "coef": -1.3520,
     "se_naive": 0.0210, "se_cluster": 0.0661, "group": "gravity"},
    {"key": "log_o_pop", "label": "log(Origin residents 16+)", "coef": 0.0757,
     "se_naive": 0.0186, "se_cluster": 0.0731, "group": "gravity"},
    {"key": "log_d_pop", "label": "log(Dest. residents 16+)", "coef": 0.0433,
     "se_naive": 0.0187, "se_cluster": 0.0882, "group": "gravity"},
    {"key": "log_d_workplace", "label": "log(Dest. workplace pop.)", "coef": 0.1712,
     "se_naive": 0.0156, "se_cluster": 0.0693, "group": "gravity"},
    {"key": "exp_segregated", "label": "Segregated exposure", "coef": 0.1542,
     "se_naive": 0.0684, "se_cluster": 0.2092, "group": "infrastructure"},
    {"key": "exp_lane", "label": "Cycle-lane exposure", "coef": -0.0019,
     "se_naive": 0.2003, "se_cluster": 0.5088, "group": "infrastructure"},
    {"key": "exp_shared", "label": "Shared-path exposure", "coef": 0.3084,
     "se_naive": 0.0733, "se_cluster": 0.1895, "group": "infrastructure"},
    {"key": "o_avg_age", "label": "Origin average age", "coef": -0.0201,
     "se_naive": 0.0032, "se_cluster": 0.0138, "group": "neighbourhood"},
    {"key": "d_avg_age", "label": "Dest. average age", "coef": -0.0099,
     "se_naive": 0.0043, "se_cluster": 0.0158, "group": "neighbourhood"},
    {"key": "o_avg_cars_per_household", "label": "Origin cars / household",
     "coef": -0.5431, "se_naive": 0.0800, "se_cluster": 0.2743, "group": "neighbourhood"},
    {"key": "d_avg_cars_per_household", "label": "Dest. cars / household",
     "coef": -0.4525, "se_naive": 0.0864, "se_cluster": 0.3007, "group": "neighbourhood"},
    {"key": "d_student_share", "label": "Dest. student share", "coef": 0.3541,
     "se_naive": 0.0914, "se_cluster": 0.4325, "group": "neighbourhood"},
    {"key": "o_avg_nssec_score", "label": "Origin NS-SeC score", "coef": -0.2120,
     "se_naive": 0.0111, "se_cluster": 0.0386, "group": "neighbourhood"},
    {"key": "d_avg_nssec_score", "label": "Dest. NS-SeC score", "coef": -0.2055,
     "se_naive": 0.0120, "se_cluster": 0.0457, "group": "neighbourhood"},
    {"key": "o_cycling_distance_share_ext", "label": "Origin commutes in cycling range",
     "coef": 1.1977, "se_naive": 0.1026, "se_cluster": 0.4813, "group": "neighbourhood"},
    {"key": "d_cycling_distance_share_ext", "label": "Dest. commutes in cycling range",
     "coef": 2.2937, "se_naive": 0.1314, "se_cluster": 0.5978, "group": "neighbourhood"},
    {"key": "d_n_on_premises", "label": "Dest. licensed premises", "coef": 0.0031,
     "se_naive": 0.0007, "se_cluster": 0.0028, "group": "neighbourhood"},
    {"key": "is_commuter", "label": "Commuter pair", "coef": 0.5286,
     "se_naive": 0.0584, "se_cluster": 0.0717, "group": "commuter"},
    {"key": "commuter_x_segregated", "label": "Commuter x segregated", "coef": 1.0384,
     "se_naive": 0.2505, "se_cluster": 0.2359, "group": "commuter"},
    {"key": "commuter_x_shared", "label": "Commuter x shared", "coef": 0.1240,
     "se_naive": 0.2182, "se_cluster": 0.0812, "group": "commuter"},
)

# Model ladder: what each step added, its log-likelihood and parameter count
# (coefficients + constant + NB alpha). AIC = 2k - 2LL.
MODEL_LADDER: tuple[dict, ...] = (
    {"model": "M1", "added": "Distance + population masses", "llf": -54268, "k": 6},
    {"model": "M2", "added": "+ infrastructure exposure", "llf": -54180, "k": 9},
    {"model": "M3", "added": "+ age, cars per household", "llf": -54058, "k": 13},
    {"model": "M4", "added": "+ NS-SeC", "llf": -53766, "k": 15},
    {"model": "M5", "added": "+ cycling range, students", "llf": -53573, "k": 18},
    {"model": "M6", "added": "+ licensed premises", "llf": -53568, "k": 19},
    {"model": "M7", "added": "+ commuter pair", "llf": -53363, "k": 20},
    {"model": "M8", "added": "+ commuter x infrastructure", "llf": -53354, "k": 22},
)

# Headline diagnostics quoted in the dissertation.
DIAGNOSTICS: dict[str, float | int] = {
    "n_pairs": 11060,
    "n_origin_clusters": 120,
    "n_dest_clusters": 120,
    "poisson_overdispersion": 143.45,
    "alpha": 0.9483,
    "lr_interaction_stat": 18.88,
    "lr_interaction_df": 2,
    "lr_interaction_p": 7.9e-05,
    "pearson_r_pred": 0.433,
    "commuter_segregated_irr": 3.296,
    "commuter_segregated_irr_lo": 1.989,
    "commuter_segregated_irr_hi": 5.460,
    "commuter_exp_segregated_median": 0.100,
    "commuter_exp_segregated_mean": 0.137,
    "commuter_exp_segregated_q75": 0.204,
}


def coef(key: str, model: tuple[dict, ...] = FINAL_MODEL) -> float:
    """Point estimate for one term (``KeyError`` if absent)."""
    for row in model:
        if row["key"] == key:
            return float(row["coef"])
    raise KeyError(key)


def p_value(estimate: float, se: float) -> float:
    """Two-sided normal p-value for ``estimate / se``."""
    if se <= 0:
        return 0.0
    z = abs(estimate / se)
    return math.erfc(z / math.sqrt(2))


def forest_rows(model: tuple[dict, ...] = FINAL_MODEL, z: float = Z95) -> list[dict]:
    """Coefficient-plot rows with naive and clustered confidence intervals.

    Returns:
        One row per term: ``label, key, group, coef, naive_lo, naive_hi,
        cluster_lo, cluster_hi, p_naive, p_cluster, irr, sig`` where ``sig`` is
        ``True`` when the clustered interval excludes zero.
    """
    rows = []
    for r in model:
        c, sn, sc = float(r["coef"]), float(r["se_naive"]), float(r["se_cluster"])
        rows.append({
            "key": r["key"], "label": r["label"], "group": r["group"], "coef": c,
            "naive_lo": round(c - z * sn, 4), "naive_hi": round(c + z * sn, 4),
            "cluster_lo": round(c - z * sc, 4), "cluster_hi": round(c + z * sc, 4),
            "p_naive": round(p_value(c, sn), 4), "p_cluster": round(p_value(c, sc), 4),
            "irr": round(math.exp(c), 3),
            "sig": bool(p_value(c, sc) < 0.05),
        })
    return rows


def irr_curve(
    xs: list[float], model: tuple[dict, ...] = FINAL_MODEL
) -> dict[str, list[float]]:
    """Trip-rate ratio vs segregated exposure for commuter and other pairs.

    Holding everything else fixed, a pair whose shortest route has share ``x``
    on segregated infrastructure has ``exp(b_seg * x)`` times the trips of an
    identical pair with none; commuter pairs use ``b_seg + b_commuter_x_seg``.

    Returns:
        ``{"x": xs, "x_pct": [...], "commuter": [...], "non_commuter": [...]}``.
    """
    b = coef("exp_segregated", model)
    b_c = b + coef("commuter_x_segregated", model)
    return {
        "x": list(xs),
        "x_pct": [round(x * 100, 1) for x in xs],
        "commuter": [round(math.exp(b_c * x), 3) for x in xs],
        "non_commuter": [round(math.exp(b * x), 3) for x in xs],
    }


def model_ladder(ladder: tuple[dict, ...] = MODEL_LADDER) -> list[dict]:
    """Model-comparison rows with AIC and the AIC drop from the previous step."""
    rows = []
    prev = None
    for m in ladder:
        aic = 2 * m["k"] - 2 * m["llf"]
        rows.append({
            "model": m["model"], "added": m["added"], "llf": m["llf"], "k": m["k"],
            "aic": aic, "aic_drop": (prev - aic) if prev is not None else 0,
        })
        prev = aic
    return rows
