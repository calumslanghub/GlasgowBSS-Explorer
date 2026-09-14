"""Fetch and cache the OSMnx bike network that covers the station bounding box.

Run as ``python -m build.graph`` to (re)download. The build proper only reads
the cached GraphML; if it is absent, routes fall back to straight lines.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from build import sources

log = logging.getLogger(__name__)

MARGIN_DEG: float = 0.02


def station_bbox(stations: pd.DataFrame, margin: float = MARGIN_DEG) -> tuple:
    """Return (left, bottom, right, top) in WGS84 around all stations."""
    return (
        float(stations["lon"].min() - margin),
        float(stations["lat"].min() - margin),
        float(stations["lon"].max() + margin),
        float(stations["lat"].max() + margin),
    )


def fetch_graph(stations: pd.DataFrame, out: Path = sources.GRAPH_FILE) -> Path:
    """Download the bike network for the station bbox and save it as GraphML."""
    import osmnx as ox

    ox.settings.use_cache = True
    ox.settings.cache_folder = str(sources.CACHE_DIR / "osmnx")
    ox.settings.requests_timeout = 900
    bbox = station_bbox(stations)
    log.info("Downloading bike network for bbox %s", bbox)
    graph = ox.graph_from_bbox(bbox=bbox, network_type="bike", simplify=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(graph, out)
    log.info("Saved %d nodes / %d edges to %s", len(graph.nodes), len(graph.edges), out)
    return out


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    df = pd.read_csv(sources.STATIONS_CSV)
    df = df[~df["station_id"].isin(sources.EXCLUDED_STATIONS)]
    fetch_graph(df)
