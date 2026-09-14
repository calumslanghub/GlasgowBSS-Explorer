"""Station list -> web/data/stations.json."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd

from analysis import od as od_mod
from build import sources

log = logging.getLogger(__name__)

LAT_RANGE: tuple[float, float] = (55.75, 55.95)
LON_RANGE: tuple[float, float] = (-4.45, -4.05)


def load_stations(od: pd.DataFrame) -> pd.DataFrame:
    """Read the station master list and keep real stations that have trips.

    Args:
        od: Directed OD matrix; stations absent from it are dropped (they never
            appear on the map or the timeline).

    Returns:
        DataFrame ``station, lat, lon`` sorted by name.
    """
    df = pd.read_csv(sources.STATIONS_CSV).rename(columns={"station_id": "station"})
    df = df[~df["station"].isin(sources.EXCLUDED_STATIONS)]
    in_box = df["lat"].between(*LAT_RANGE) & df["lon"].between(*LON_RANGE)
    if (~in_box).any():
        log.warning("Dropping stations outside Glasgow bbox: %s", df.loc[~in_box, "station"].tolist())
    df = df[in_box]
    active = set(od["origin"]) | set(od["destination"])
    dropped = sorted(set(df["station"]) - active)
    if dropped:
        log.warning("Dropping %d stations with no OD trips: %s", len(dropped), dropped)
    df = df[df["station"].isin(active)]
    df["lat"] = df["lat"].round(6)
    df["lon"] = df["lon"].round(6)
    return df.sort_values("station").reset_index(drop=True)


def write_stations(
    stations: pd.DataFrame,
    od: pd.DataFrame,
    first_dates: pd.Series,
    out: Path = sources.WEB_DATA_DIR / "stations.json",
) -> list[dict]:
    """Write stations.json: id, lat, lon, first trip date and trip totals."""
    totals = od_mod.station_totals(od).set_index("station")
    rows: list[dict] = []
    for r in stations.itertuples(index=False):
        t = totals.loc[r.station] if r.station in totals.index else None
        rows.append(
            {
                "id": r.station,
                "lat": float(r.lat),
                "lon": float(r.lon),
                "first_trip": str(first_dates.get(r.station, sources.STUDY_START)),
                "trips": int(t["trips"]) if t is not None else 0,
                "out_trips": int(t["out_trips"]) if t is not None else 0,
                "in_trips": int(t["in_trips"]) if t is not None else 0,
            }
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote %d stations to %s", len(rows), out)
    return rows
