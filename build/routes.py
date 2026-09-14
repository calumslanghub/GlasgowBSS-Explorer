"""Street-network routes for the OD pairs shown on the map -> routes.json.

Uses the cached OSMnx bike graph (``python -m build.graph`` to fetch). When the
cache is missing the build still succeeds, writing straight-line fallbacks and
recording ``router: "straight"`` so the UI can say so.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import geopandas as gpd
import pandas as pd

from build import sources
from build.geo import CRS_BNG, CRS_WGS84, latlon_paths

log = logging.getLogger(__name__)

SIMPLIFY_M: float = 4.0


def straight_routes(
    pairs: set[tuple[str, str]], stations: pd.DataFrame
) -> dict[str, list]:
    """Great-circle-free fallback: a two-point line between the two stations."""
    xy = stations.set_index("station")[["lat", "lon"]]
    out: dict[str, list] = {}
    for a, b in sorted(pairs):
        if a in xy.index and b in xy.index:
            out[f"{a}|{b}"] = [[
                [round(float(xy.loc[a, "lat"]), 5), round(float(xy.loc[a, "lon"]), 5)],
                [round(float(xy.loc[b, "lat"]), 5), round(float(xy.loc[b, "lon"]), 5)],
            ]]
    return out


def osmnx_routes(
    pairs: set[tuple[str, str]], stations: pd.DataFrame, graph_file: Path
) -> dict[str, list]:
    """Shortest bike-network paths (by length) for every directed pair."""
    import osmnx as ox

    graph = ox.project_graph(ox.load_graphml(graph_file), to_crs=CRS_BNG)
    pts = gpd.GeoDataFrame(
        stations,
        geometry=gpd.points_from_xy(stations["lon"], stations["lat"]),
        crs=CRS_WGS84,
    ).to_crs(CRS_BNG)
    nodes = ox.distance.nearest_nodes(graph, X=pts.geometry.x.values, Y=pts.geometry.y.values)
    node_of = dict(zip(pts["station"], nodes))
    ordered = sorted(p for p in pairs if p[0] in node_of and p[1] in node_of)
    origs = [node_of[a] for a, _ in ordered]
    dests = [node_of[b] for _, b in ordered]
    paths = ox.routing.shortest_path(graph, origs, dests, weight="length")
    out: dict[str, list] = {}
    failed = 0
    for (a, b), path in zip(ordered, paths):
        if not path or len(path) < 2:
            failed += 1
            continue
        edges = ox.routing.route_to_gdf(graph, path, weight="length")
        line = edges.geometry.union_all()
        line = line.simplify(SIMPLIFY_M, preserve_topology=False)
        wgs = gpd.GeoSeries([line], crs=CRS_BNG).to_crs(CRS_WGS84).iloc[0]
        coords = latlon_paths(wgs)
        if coords:
            out[f"{a}|{b}"] = coords
        else:
            failed += 1
    log.info("Routed %d pairs on the bike network (%d failed)", len(out), failed)
    return out


def write_routes(
    pairs: set[tuple[str, str]],
    stations: pd.DataFrame,
    graph_file: Path = sources.GRAPH_FILE,
    use_graph: bool = True,
    out: Path = sources.WEB_DATA_DIR / "routes.json",
) -> dict:
    """Write routes.json for all pairs; OSMnx when cached, else straight lines."""
    straight = straight_routes(pairs, stations)
    router = "straight"
    routed: dict[str, list] = {}
    if use_graph and graph_file.exists():
        try:
            routed = osmnx_routes(pairs, stations, graph_file)
            router = "osmnx"
        except Exception as exc:  # noqa: BLE001 - never let routing sink the build
            log.error("OSMnx routing failed (%s); using straight lines", exc)
    elif use_graph:
        log.warning("No cached graph at %s; run `python -m build.graph`. Using straight lines.", graph_file)
    pairs_out = {**straight, **routed}
    payload = {"router": router, "n": len(pairs_out), "pairs": pairs_out}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote %d routes (%s) to %s", len(pairs_out), router, out)
    return payload
