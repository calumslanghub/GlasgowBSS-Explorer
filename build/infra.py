"""Phase 2: GCC cycling-routes shapefile -> infra.geojson + infra_timeline.json.

Reads the BNG shapefile in place, applies the dating rules from
``analysis.infra``, reprojects to WGS84 and writes a simplified GeoJSON with
``opened`` and ``type`` per segment, plus a monthly timeline of km open by
type and stations live (for the slider chart).
"""

from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path

import geopandas as gpd
import pandas as pd

from analysis import infra as infra_mod
from build import sources
from build.geo import CRS_BNG, CRS_WGS84, lonlat_paths

log = logging.getLogger(__name__)

SIMPLIFY_M: float = 5.0


def load_infra(path: Path = sources.INFRA_SHP) -> gpd.GeoDataFrame:
    """Read, type, date and measure every line segment (BNG, metres)."""
    g = gpd.read_file(path).to_crs(CRS_BNG)
    g = g[g.geometry.type.isin(["LineString", "MultiLineString"])].copy()
    g = infra_mod.date_segments(g)
    g["length_m"] = g.geometry.length
    return gpd.GeoDataFrame(g, geometry="geometry", crs=CRS_BNG)


def report_undated(g: pd.DataFrame) -> None:
    """Log named schemes that still fall back to STUDY_START."""
    rep = infra_mod.undated_named_schemes(g)
    if len(rep):
        log.warning(
            "Named schemes without a confirmed opening date (default to %s):\n%s",
            infra_mod.STUDY_START,
            rep.to_string(index=False),
        )


def write_geojson(
    g: gpd.GeoDataFrame, out: Path = sources.WEB_DATA_DIR / "infra.geojson"
) -> dict:
    """Write simplified WGS84 segments with id/type/opened/name/scheme/km."""
    simp = g.copy()
    simp["geometry"] = simp.geometry.simplify(SIMPLIFY_M, preserve_topology=False)
    simp = simp.to_crs(CRS_WGS84)
    features = []
    for r in simp.itertuples(index=False):
        paths = lonlat_paths(r.geometry)
        if not paths:
            continue
        geometry = (
            {"type": "LineString", "coordinates": paths[0]}
            if len(paths) == 1
            else {"type": "MultiLineString", "coordinates": paths}
        )
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "id": int(r.OBJECTID),
                    "type": r.infra_type,
                    "opened": r.opened.isoformat(),
                    "name": None if pd.isna(r.ROUTENAMEO) else str(r.ROUTENAMEO),
                    "scheme": None if pd.isna(r.scheme) else str(r.scheme),
                    "km": round(float(r.length_m) / 1000, 3),
                },
            }
        )
    fc = {"type": "FeatureCollection", "features": features}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote %d infrastructure segments to %s", len(features), out)
    return fc


def timeline_dates(epochs: pd.DataFrame) -> list[date]:
    """Month starts across the study plus every epoch boundary (sorted, unique)."""
    start = date.fromisoformat(sources.STUDY_START)
    end = date.fromisoformat(sources.STUDY_END)
    dates = set(infra_mod.month_starts(start, end))
    for col in ("start", "end"):
        for d in pd.to_datetime(epochs[col]).dt.date:
            if start <= d <= end:
                dates.add(d)
    return sorted(dates)


def write_timeline(
    g: pd.DataFrame,
    first_dates: pd.Series,
    out: Path = sources.WEB_DATA_DIR / "infra_timeline.json",
) -> dict:
    """Write km-open-by-type and stations-live series over the study window."""
    epochs = pd.read_csv(sources.EPOCHS_CSV)
    dates = timeline_dates(epochs)
    km = infra_mod.km_open_by_type(g, dates)
    payload: dict = {
        "study_start": sources.STUDY_START,
        "study_end": sources.STUDY_END,
        "dates": [d.isoformat() for d in dates],
        "stations": infra_mod.stations_open_count(first_dates, dates),
        "epochs": [
            {"epoch": int(r.epoch), "start": str(r.start), "end": str(r.end)}
            for r in epochs.itertuples(index=False)
        ],
        "segments": int(len(g)),
    }
    for col in list(infra_mod.INFRA_TYPES) + ["any"]:
        payload[col] = km[col].tolist()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote timeline with %d dates to %s", len(dates), out)
    return payload
