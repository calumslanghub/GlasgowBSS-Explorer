"""Segregated cycle infrastructure usage -> segregated.geojson + segregated_summary.json.

For each segregated segment, counts the trips whose bike-network route runs
along it (within the dissertation's 15 m snap tolerance for at least 30 m),
split by commuter category. Also groups segments by street/scheme name for a
ranked list, and totals how many trips used any segregated infrastructure.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import geopandas as gpd
import pandas as pd

from analysis import loads as loads_mod
from build import sources
from build.geo import CRS_WGS84, lonlat_paths
from build.routes import RouteSet

log = logging.getLogger(__name__)

SNAP_TOL_M: float = 15.0
MIN_OVERLAP_M: float = 30.0
SIMPLIFY_M: float = 5.0
TOP_N: int = 12


def segregated_segments(infra: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Segregated segments with a display name (street, else scheme)."""
    seg = infra[infra["infra_type"] == "segregated"].copy()
    seg["name"] = seg["ROUTENAMEO"].where(seg["ROUTENAMEO"].notna(), seg["scheme"])
    seg["name"] = seg["name"].fillna("Unnamed segregated route")
    seg["seg_id"] = seg["OBJECTID"].astype(int)
    return seg


def edge_overlaps(
    rs: RouteSet, seg: gpd.GeoDataFrame, key_col: str
) -> dict[tuple[int, int], dict[object, float]]:
    """Metres of each used edge lying inside each segment buffer, keyed by ``key_col``."""
    edges = rs.used_edges_gdf()
    if edges.empty:
        return {}
    buf = seg[[key_col, "geometry"]].copy()
    buf["geometry"] = buf.geometry.buffer(SNAP_TOL_M)
    joined = gpd.sjoin(edges, buf, how="inner", predicate="intersects")
    out: dict[tuple[int, int], dict[object, float]] = {}
    buf_geom = buf.set_index(buf.index)["geometry"]
    for r in joined.itertuples():
        m = float(r.geometry.intersection(buf_geom.loc[r.index_right]).length)
        if m <= 0:
            continue
        out.setdefault(r.edge, {})
        key = getattr(r, key_col)
        out[r.edge][key] = out[r.edge].get(key, 0.0) + m
    return out


def write_segregated(
    rs: RouteSet,
    infra: gpd.GeoDataFrame,
    pair_trips: dict[tuple[str, str], int],
    pair_cat: dict[tuple[str, str], str],
    out_geo: Path = sources.WEB_DATA_DIR / "segregated.geojson",
    out_sum: Path = sources.WEB_DATA_DIR / "segregated_summary.json",
) -> dict:
    """Write per-segment usage GeoJSON and the summary/ranked-list JSON."""
    seg = segregated_segments(infra)
    by_seg = loads_mod.segment_usage(
        rs.pair_edges, pair_trips, pair_cat, edge_overlaps(rs, seg, "seg_id"), MIN_OVERLAP_M
    )
    by_name = loads_mod.segment_usage(
        rs.pair_edges, pair_trips, pair_cat, edge_overlaps(rs, seg, "name"), MIN_OVERLAP_M
    )
    seg_counts, pair_overlap = by_seg
    name_counts, _ = by_name

    simp = seg.copy()
    simp["geometry"] = simp.geometry.simplify(SIMPLIFY_M, preserve_topology=False)
    simp = simp.to_crs(CRS_WGS84)
    features = []
    for r in simp.itertuples(index=False):
        paths = lonlat_paths(r.geometry)
        if not paths:
            continue
        c = seg_counts.get(r.seg_id, {})
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": paths[0]} if len(paths) == 1
            else {"type": "MultiLineString", "coordinates": paths},
            "properties": {
                "id": int(r.seg_id), "name": str(r.name), "opened": r.opened.isoformat(),
                "km": round(float(r.length_m) / 1000, 3),
                "t": int(sum(c.values())), "c": int(c.get("commuter", 0)),
                "n": int(c.get("non-commuter", 0)),
            },
        })
    maxima = {k: max((f["properties"][k] for f in features), default=0) for k in ("t", "c")}
    fc = {"type": "FeatureCollection", "max": maxima, "features": features}
    out_geo.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    km_by_name = seg.groupby("name")["length_m"].sum() / 1000
    def ranked(cat_key: str) -> list[dict]:
        rows = []
        for name, counts in name_counts.items():
            trips = counts["commuter"] if cat_key == "commuter" else sum(counts.values())
            if trips > 0:
                rows.append({"name": str(name), "trips": int(trips), "km": round(float(km_by_name.get(name, 0)), 2)})
        rows.sort(key=lambda r: (-r["trips"], r["name"]))
        return rows[:TOP_N]

    summary = {
        "all": {**loads_mod.usage_summary(pair_trips, pair_cat, pair_overlap), "top": ranked("all")},
        "commuter": {**loads_mod.usage_summary(pair_trips, pair_cat, pair_overlap, "commuter"), "top": ranked("commuter")},
        "segments": len(features),
        "km": round(float(seg["length_m"].sum()) / 1000, 1),
        "snap_m": SNAP_TOL_M,
        "min_overlap_m": MIN_OVERLAP_M,
    }
    out_sum.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info(
        "Segregated: %d segments; %.1f%% of trips followed one (%.1f%% of commuter trips)",
        len(features), summary["all"]["share_pct"], summary["commuter"]["share_pct"],
    )
    return summary
