"""OD matrix + trip file -> web/data/od_by_station.json.

The trip file is streamed in chunks purely to produce two small aggregates
(hourly origin/destination counts per station, and each station's first trip
date). Nothing trip-level is written.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd

from analysis import hourly as hourly_mod
from analysis import od as od_mod
from build import sources

log = logging.getLogger(__name__)

TOP_N: int = 10
CHUNK_ROWS: int = 250_000
TRIP_COLS: tuple[str, ...] = ("origin", "destination", "started_at", "ended_at")


def load_od() -> pd.DataFrame:
    """Read the directed OD matrix, dropping self-loops and non-station names."""
    od = pd.read_csv(sources.OD_CSV)
    od = od[~od["origin"].isin(sources.EXCLUDED_STATIONS)]
    od = od[~od["destination"].isin(sources.EXCLUDED_STATIONS)]
    od = od[od["origin"] != od["destination"]]
    od["trips"] = od["trips"].astype(int)
    return od.reset_index(drop=True)


def aggregate_trips(path: Path = sources.TRIPS_CSV) -> tuple[pd.DataFrame, pd.Series]:
    """Stream the trip file and return (hourly counts, first trip dates).

    Returns:
        ``hourly``: long frame ``station, hour, out, in``.
        ``first_dates``: Series station -> ISO date of first appearance.
    """
    if not path.exists():
        log.warning("Trip file %s not found; hourly split and first dates unavailable", path)
        return hourly_mod.combine_hourly([]), hourly_mod.combine_first_dates([])
    hourly_parts: list[pd.DataFrame] = []
    date_parts: list[pd.Series] = []
    n = 0
    for chunk in pd.read_csv(path, usecols=list(TRIP_COLS), chunksize=CHUNK_ROWS):
        chunk = chunk.dropna(subset=["origin", "destination"])
        local = hourly_mod.add_local_hours(chunk)
        hourly_parts.append(hourly_mod.hourly_role_counts(local))
        date_parts.append(hourly_mod.first_trip_dates(local))
        n += len(chunk)
        log.info("  ... %d trips aggregated", n)
    return hourly_mod.combine_hourly(hourly_parts), hourly_mod.combine_first_dates(date_parts)


def _hourly_rows(profile: dict[str, list]) -> list[dict]:
    return [
        {"hour": h, "out": o, "in": i}
        for h, o, i in zip(profile["hours"], profile["out"], profile["in"])
    ]


def write_od_by_station(
    od: pd.DataFrame,
    stations: list[str],
    hourly: pd.DataFrame,
    out: Path = sources.WEB_DATA_DIR / "od_by_station.json",
) -> dict[str, dict]:
    """Write the per-station OD summary (top lists, split, hourly profile)."""
    summary = od_mod.od_summary(od, stations, n=TOP_N)
    for s in stations:
        summary[s]["hourly"] = _hourly_rows(hourly_mod.hourly_profile(hourly, s))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote OD summary for %d stations to %s", len(summary), out)
    return summary
