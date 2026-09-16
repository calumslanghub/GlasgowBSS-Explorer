"""Dissertation regression results -> web/data/regression.json."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from analysis import regression as reg
from build import sources

log = logging.getLogger(__name__)

CURVE_STEPS: int = 21   # exposure 0 %, 5 %, ... 100 %


def write_regression(out: Path = sources.WEB_DATA_DIR / "regression.json") -> dict:
    """Write the coefficient plot, IRR curve, model ladder and diagnostics."""
    xs = [round(i / (CURVE_STEPS - 1), 3) for i in range(CURVE_STEPS)]
    forest = reg.forest_rows()
    d = dict(reg.DIAGNOSTICS)
    curve = reg.irr_curve(xs)
    # Typical commuter exposure levels, for the narrative and the chart marker.
    typical = {
        k: {
            "exposure_pct": round(d[f"commuter_exp_segregated_{k}"] * 100, 1),
            "irr": reg.irr_curve([d[f"commuter_exp_segregated_{k}"]])["commuter"][0],
        }
        for k in ("median", "mean", "q75")
    }
    payload = {
        "forest": forest,
        "forest_by_group": {
            g: [r for r in forest if r["group"] == g]
            for g in ("gravity", "infrastructure", "neighbourhood", "commuter")
        },
        "irr_curve": curve,
        "ladder": reg.model_ladder(),
        "diagnostics": d,
        "typical_commuter": typical,
        "headline": {
            "irr_full": d["commuter_segregated_irr"],
            "irr_lo": d["commuter_segregated_irr_lo"],
            "irr_hi": d["commuter_segregated_irr_hi"],
            "irr_median": typical["median"]["irr"],
            "commuter_irr": round(2.718281828 ** reg.coef("is_commuter"), 2),
            "n_pairs": d["n_pairs"],
            "pearson_r": d["pearson_r_pred"],
            "lr_p": d["lr_interaction_p"],
        },
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote regression results (%d terms) to %s", len(forest), out)
    return payload
