"""Licensed premises points -> web/data/premises.json (heat-map input).

Reads the Glasgow licensing board extract used by ``OnPremisesVariable.ipynb``,
keeps premises licensed for on-sales (pubs, bars, restaurants, clubs), and
writes their WGS84 positions with on-sales capacity as the heat weight.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import geopandas as gpd
import pandas as pd

from build import sources
from build.geo import CRS_BNG, CRS_WGS84

log = logging.getLogger(__name__)

ON_SALES: frozenset[str] = frozenset({"On", "On & Off"})
CAPACITY_CAP: int = 2000   # clip a few arenas so they do not swamp the heat map


def load_on_premises(path: Path = sources.PREMISES_POINTS_CSV) -> gpd.GeoDataFrame:
    """On-sales premises as WGS84 points with a ``capacity`` column."""
    raw = pd.read_csv(path, encoding="utf-8-sig")
    on = raw[raw["ALCOHOL_SALES"].isin(ON_SALES)].copy()
    on["capacity"] = pd.to_numeric(on["CAPACITY_ON"], errors="coerce")
    g = gpd.GeoDataFrame(on, geometry=gpd.points_from_xy(on["X"], on["Y"]), crs=CRS_BNG)
    return g.to_crs(CRS_WGS84)


def write_premises(out: Path = sources.WEB_DATA_DIR / "premises.json") -> dict:
    """Write ``{n, capacity_known, points: [[lat, lon, capacity], ...]}``."""
    if not sources.PREMISES_POINTS_CSV.exists():
        log.warning("Premises points %s not found; heat map will be empty", sources.PREMISES_POINTS_CSV)
        payload = {"n": 0, "capacity_known": 0, "points": []}
        out.write_text(json.dumps(payload), encoding="utf-8")
        return payload
    g = load_on_premises()
    points = []
    for r in g.itertuples(index=False):
        cap = None if pd.isna(r.capacity) else int(min(r.capacity, CAPACITY_CAP))
        points.append([round(float(r.geometry.y), 5), round(float(r.geometry.x), 5), cap])
    payload = {
        "n": len(points),
        "capacity_known": int(g["capacity"].notna().sum()),
        "capacity_cap": CAPACITY_CAP,
        "points": points,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote %d on-sales premises to %s", len(points), out)
    return payload
