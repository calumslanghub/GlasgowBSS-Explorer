"""Commuter k-means labels -> kmeans.json (the corridor scatter plot)."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd

from analysis import kmeans as km
from build import sources

log = logging.getLogger(__name__)


def write_kmeans(
    od: pd.DataFrame, out: Path = sources.WEB_DATA_DIR / "kmeans.json"
) -> set[tuple[str, str]]:
    """Write the scatter rows + cluster means; return the pairs to route.

    Returns:
        The unordered pairs ``(a, b)`` so routes.json can draw every point.
    """
    labels = pd.read_csv(sources.COMMUTER_CSV)
    rows = km.scatter_rows(labels, km.pair_trips_undirected(od))
    clusters = km.cluster_summary(rows)
    payload = {
        "metrics": km.METRICS, "clusters": clusters,
        "profile": km.cluster_profile(clusters), "rows": rows,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote %d k-means pairs to %s", len(rows), out)
    return {(r["a"], r["b"]) for r in rows}
