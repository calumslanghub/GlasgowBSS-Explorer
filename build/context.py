"""Phase 3: commuter labels + exposure panel + covariates -> context_by_station.json."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd

from analysis import context as ctx
from build import sources

log = logging.getLogger(__name__)

TOP_N: int = 10
BUFFER_M: int = 250


def load_inputs() -> tuple[pd.DataFrame, dict, pd.DataFrame, pd.DataFrame]:
    """Read the pair panel, commuter labels and station covariates."""
    panel = pd.read_csv(sources.OD_PANEL_CSV)
    exposure = ctx.pair_exposure(panel)
    lookup = ctx.commuter_lookup(pd.read_csv(sources.COMMUTER_CSV))
    station_vars = pd.read_csv(sources.STATION_VARS_CSV)
    premises = pd.read_csv(sources.STATION_PREMISES_CSV)
    return exposure, lookup, station_vars, premises


def write_context(
    od: pd.DataFrame,
    stations: list[str],
    out: Path = sources.WEB_DATA_DIR / "context_by_station.json",
) -> tuple[dict[str, dict], dict]:
    """Write per-station corridor/exposure/profile context; return (data, summary)."""
    exposure, lookup, station_vars, premises = load_inputs()
    result: dict[str, dict] = {}
    for s in stations:
        entry: dict = {}
        entry["corridors"] = ctx.undirected_corridors(od, exposure, lookup, s, n=TOP_N)
        entry["exposure"] = ctx.station_exposure(od, exposure, s)
        entry.update(ctx.commuter_share(od, lookup, s))
        entry["exp_any"] = entry["exposure"]["any"]
        entry["profile"] = ctx.station_profile(station_vars, premises, s, BUFFER_M)
        result[s] = entry
    summary = ctx.network_summary(od, exposure, lookup)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote context for %d stations to %s", len(result), out)
    return result, summary
