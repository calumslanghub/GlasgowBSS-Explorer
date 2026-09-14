"""Phase 3: commuter labels + exposure panel + covariates -> context_by_station.json
and the city-wide corridor_network.json."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd

from analysis import context as ctx
from analysis import loads as loads_mod
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


def pair_categories(od: pd.DataFrame, lookup: dict) -> tuple[dict, dict]:
    """``(pair_trips, pair_cat)`` dicts keyed by directed pair, for the load maps."""
    pair_trips = {(o, d): int(t) for o, d, t in zip(od["origin"], od["destination"], od["trips"])}
    pair_cat = {p: loads_mod.pair_category(p[0], p[1], lookup) for p in pair_trips}
    return pair_trips, pair_cat


def write_context(
    od: pd.DataFrame,
    stations: list[str],
    out: Path = sources.WEB_DATA_DIR / "context_by_station.json",
    out_net: Path = sources.WEB_DATA_DIR / "corridor_network.json",
) -> tuple[dict[str, dict], dict, dict]:
    """Write per-station context and network category totals.

    Returns:
        ``(context, network_summary, lookup)`` where ``lookup`` is the
        commuter-label dict reused by the routing layers.
    """
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

    pair_trips, pair_cat = pair_categories(od, lookup)
    net = loads_mod.category_totals(pair_trips, pair_cat)
    net_payload = {
        "categories": net,
        "commuter_pairs": net["commuter"]["pairs"],
        "commuter_trips": net["commuter"]["trips"],
        "commuter_pct": net["commuter"]["pct"],
        "noncommuter_pairs": net["non-commuter"]["pairs"],
        "noncommuter_trips": net["non-commuter"]["trips"],
        "noncommuter_pct": net["non-commuter"]["pct"],
        "unclassified_pairs": net["unclassified"]["pairs"],
        "unclassified_pct": net["unclassified"]["pct"],
    }
    out_net.write_text(json.dumps(net_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote context for %d stations to %s; network totals to %s", len(result), out, out_net)
    return result, summary, lookup
