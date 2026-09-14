"""Bike-network routing for every OD pair -> routes.json + corridor_load.geojson.

Uses the cached OSMnx graph (``python -m build.graph``). Every directed OD
pair is routed once; from those node paths the build derives

* ``routes.json``: per-pair polylines for the pairs shown on the map (top lists),
* ``corridor_load.geojson``: trips per street segment, split by commuter
  category (the city-wide corridor flow map),
* a ``RouteSet`` handed to ``build.segregated`` for infrastructure usage.

Without a cached graph the build still succeeds with straight lines and empty
load layers, recording ``router: "straight"``.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString
from shapely.ops import linemerge

from analysis import loads as loads_mod
from build import sources
from build.geo import CRS_BNG, CRS_WGS84, latlon_paths, lonlat_paths

log = logging.getLogger(__name__)

SIMPLIFY_M: float = 4.0
MIN_LOAD_TRIPS: int = 10          # drop near-empty edges from the flow map
Edge = tuple[int, int]            # undirected node pair (min, max)
Pair = tuple[str, str]


@dataclass
class RouteSet:
    """Routes for all pairs plus the edge geometries they use (BNG)."""

    router: str
    pair_edges: dict[Pair, list[Edge]] = field(default_factory=dict)
    edge_geoms: dict[Edge, LineString] = field(default_factory=dict)

    def used_edges_gdf(self) -> gpd.GeoDataFrame:
        """GeoDataFrame (BNG) of every edge used by at least one route."""
        keys = list(self.edge_geoms)
        return gpd.GeoDataFrame(
            {"edge": keys},
            geometry=[self.edge_geoms[k] for k in keys],
            crs=CRS_BNG,
        )


# ── straight-line fallback ────────────────────────────────────────────────────
def straight_routes(pairs: set[Pair], stations: pd.DataFrame) -> dict[str, list]:
    """Two-point fallback line between the two stations (WGS84 lat/lon)."""
    xy = stations.set_index("station")[["lat", "lon"]]
    out: dict[str, list] = {}
    for a, b in sorted(pairs):
        if a in xy.index and b in xy.index:
            out[f"{a}|{b}"] = [[
                [round(float(xy.loc[a, "lat"]), 5), round(float(xy.loc[a, "lon"]), 5)],
                [round(float(xy.loc[b, "lat"]), 5), round(float(xy.loc[b, "lon"]), 5)],
            ]]
    return out


# ── OSMnx routing ─────────────────────────────────────────────────────────────
def _edge_of(graph, u: int, v: int) -> tuple[Edge, LineString]:
    """Undirected edge key and geometry for the shortest parallel edge u->v."""
    data = graph.get_edge_data(u, v)
    attrs = min(data.values(), key=lambda d: d.get("length", 0.0))
    geom = attrs.get("geometry")
    if geom is None:
        nu, nv = graph.nodes[u], graph.nodes[v]
        geom = LineString([(nu["x"], nu["y"]), (nv["x"], nv["y"])])
    return (min(u, v), max(u, v)), geom


def route_all_pairs(
    pairs: list[Pair], stations: pd.DataFrame, graph_file: Path
) -> RouteSet:
    """Shortest bike-network path (by length) for every directed pair."""
    import osmnx as ox

    graph = ox.project_graph(ox.load_graphml(graph_file), to_crs=CRS_BNG)
    pts = gpd.GeoDataFrame(
        stations, geometry=gpd.points_from_xy(stations["lon"], stations["lat"]), crs=CRS_WGS84
    ).to_crs(CRS_BNG)
    nodes = ox.distance.nearest_nodes(graph, X=pts.geometry.x.values, Y=pts.geometry.y.values)
    node_of = dict(zip(pts["station"], nodes))
    ordered = [p for p in pairs if p[0] in node_of and p[1] in node_of]
    cpus = max(1, min(8, (os.cpu_count() or 2) - 1))
    log.info("Routing %d pairs on %d cpus", len(ordered), cpus)
    paths = ox.routing.shortest_path(
        graph, [node_of[a] for a, _ in ordered], [node_of[b] for _, b in ordered],
        weight="length", cpus=cpus,
    )
    rs = RouteSet(router="osmnx")
    failed = 0
    for (a, b), path in zip(ordered, paths):
        if not path or len(path) < 2:
            failed += 1
            continue
        edges: list[Edge] = []
        for u, v in zip(path[:-1], path[1:]):
            key, geom = _edge_of(graph, u, v)
            edges.append(key)
            rs.edge_geoms.setdefault(key, geom)
        rs.pair_edges[(a, b)] = edges
    log.info("Routed %d pairs (%d failed); %d distinct edges", len(rs.pair_edges), failed, len(rs.edge_geoms))
    return rs


def pair_polylines(rs: RouteSet, pairs: set[Pair]) -> dict[str, list]:
    """Merged, simplified WGS84 polylines for the given pairs (Leaflet order)."""
    keys, geoms = [], []
    for a, b in sorted(pairs):
        edges = rs.pair_edges.get((a, b))
        if not edges:
            continue
        merged = linemerge([rs.edge_geoms[e] for e in edges])
        keys.append(f"{a}|{b}")
        geoms.append(merged.simplify(SIMPLIFY_M, preserve_topology=False))
    wgs = gpd.GeoSeries(geoms, crs=CRS_BNG).to_crs(CRS_WGS84)
    out: dict[str, list] = {}
    for k, g in zip(keys, wgs):
        coords = latlon_paths(g)
        if coords:
            out[k] = coords
    return out


def write_routes(
    rs: RouteSet,
    pairs: set[Pair],
    stations: pd.DataFrame,
    out: Path = sources.WEB_DATA_DIR / "routes.json",
) -> dict:
    """Write routes.json for the map's pairs; network paths where available."""
    routed = pair_polylines(rs, pairs) if rs.router == "osmnx" else {}
    pairs_out = {**straight_routes(pairs, stations), **routed}
    payload = {"router": rs.router, "n": len(pairs_out), "pairs": pairs_out}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote %d routes (%s) to %s", len(pairs_out), rs.router, out)
    return payload


def write_corridor_loads(
    rs: RouteSet,
    pair_trips: dict[Pair, int],
    pair_cat: dict[Pair, str],
    out: Path = sources.WEB_DATA_DIR / "corridor_load.geojson",
) -> dict:
    """Write the flow map: every used street segment with trips per category."""
    loads = loads_mod.accumulate_loads(rs.pair_edges, pair_trips, pair_cat)
    keep = [e for e, l in loads.items() if sum(l.values()) >= MIN_LOAD_TRIPS]
    features: list[dict] = []
    if keep:
        geoms = gpd.GeoSeries(
            [rs.edge_geoms[e].simplify(SIMPLIFY_M, preserve_topology=False) for e in keep],
            crs=CRS_BNG,
        ).to_crs(CRS_WGS84)
        for e, g in zip(keep, geoms):
            paths = lonlat_paths(g)
            if not paths:
                continue
            l = loads[e]
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": paths[0]},
                "properties": {"c": l["commuter"], "n": l["non-commuter"], "u": l["unclassified"]},
            })
    maxima = {k: max((f["properties"][k] for f in features), default=0) for k in ("c", "n", "u")}
    fc = {"type": "FeatureCollection", "max": maxima, "features": features}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote %d loaded segments to %s (max %s)", len(features), out, maxima)
    return fc


def build_routes(
    od: pd.DataFrame, stations: pd.DataFrame, graph_file: Path, use_graph: bool
) -> RouteSet:
    """Route all OD pairs on the cached graph, or return an empty straight set."""
    pairs = list(zip(od["origin"], od["destination"]))
    if use_graph and graph_file.exists():
        try:
            return route_all_pairs(pairs, stations, graph_file)
        except Exception as exc:  # noqa: BLE001 - routing must never sink the build
            log.error("OSMnx routing failed (%s); using straight lines", exc)
    elif use_graph:
        log.warning("No cached graph at %s; run `python -m build.graph`. Using straight lines.", graph_file)
    return RouteSet(router="straight")
