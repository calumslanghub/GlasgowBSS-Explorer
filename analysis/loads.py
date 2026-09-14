"""Route-edge load aggregation for flow maps and infrastructure usage (pure).

The build routes every OD pair on the bike network and hands these functions
plain dicts: which network edges each pair traverses, how many trips the pair
carries, and its commuter category. Nothing here touches a graph or a file.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Hashable

CATEGORIES: tuple[str, ...] = ("commuter", "non-commuter", "unclassified")

Pair = tuple[str, str]


def pair_category(
    origin: str, dest: str, lookup: dict[tuple[str, str], bool]
) -> str:
    """Commuter label for a directed pair from the unordered-pair lookup."""
    key = (origin, dest) if origin <= dest else (dest, origin)
    flag = lookup.get(key)
    if flag is None:
        return "unclassified"
    return "commuter" if flag else "non-commuter"


def accumulate_loads(
    pair_edges: dict[Pair, list[Hashable]],
    pair_trips: dict[Pair, int],
    pair_cat: dict[Pair, str],
) -> dict[Hashable, dict[str, int]]:
    """Sum trips over every edge each pair's route uses, split by category.

    Returns:
        ``{edge: {"commuter": n, "non-commuter": n, "unclassified": n}}`` for
        edges with at least one trip.
    """
    loads: dict[Hashable, dict[str, int]] = defaultdict(lambda: dict.fromkeys(CATEGORIES, 0))
    for pair, edges in pair_edges.items():
        trips = int(pair_trips.get(pair, 0))
        if trips <= 0:
            continue
        cat = pair_cat.get(pair, "unclassified")
        for e in set(edges):
            loads[e][cat] += trips
    return dict(loads)


def segment_usage(
    pair_edges: dict[Pair, list[Hashable]],
    pair_trips: dict[Pair, int],
    pair_cat: dict[Pair, str],
    edge_overlap: dict[Hashable, dict[Hashable, float]],
    min_overlap_m: float = 30.0,
) -> tuple[dict[Hashable, dict[str, int]], dict[Pair, float]]:
    """Trips that *follow* each infrastructure segment, counted once per pair.

    A pair follows a segment when the length of its route lying within the
    segment's buffer (summed over the route's edges) is at least
    ``min_overlap_m``; its trips are then added to that segment once, however
    many edges the overlap spans.

    Args:
        pair_edges: Edge ids per directed pair.
        pair_trips: Trips per directed pair.
        pair_cat: Category per directed pair.
        edge_overlap: ``{edge: {segment_id: metres of edge inside the buffer}}``.
        min_overlap_m: Threshold below which an overlap is ignored.

    Returns:
        ``segment_counts``: ``{segment_id: {category: trips}}``.
        ``pair_overlap``: ``{pair: total metres on any segment}`` (0 if none).
    """
    seg_counts: dict[Hashable, dict[str, int]] = defaultdict(lambda: dict.fromkeys(CATEGORIES, 0))
    pair_overlap: dict[Pair, float] = {}
    for pair, edges in pair_edges.items():
        per_seg: dict[Hashable, float] = defaultdict(float)
        for e in set(edges):
            for seg, m in edge_overlap.get(e, {}).items():
                per_seg[seg] += m
        total = 0.0
        trips = int(pair_trips.get(pair, 0))
        cat = pair_cat.get(pair, "unclassified")
        for seg, m in per_seg.items():
            if m >= min_overlap_m:
                total += m
                if trips > 0:
                    seg_counts[seg][cat] += trips
        pair_overlap[pair] = round(total, 1)
    return dict(seg_counts), pair_overlap


def usage_summary(
    pair_trips: dict[Pair, int],
    pair_cat: dict[Pair, str],
    pair_overlap: dict[Pair, float],
    category: str | None = None,
) -> dict[str, float | int]:
    """Trips and pairs whose route follows any segment, optionally per category."""
    trips_total = trips_on = pairs_total = pairs_on = 0
    for pair, trips in pair_trips.items():
        if category is not None and pair_cat.get(pair, "unclassified") != category:
            continue
        pairs_total += 1
        trips_total += int(trips)
        if pair_overlap.get(pair, 0.0) > 0:
            pairs_on += 1
            trips_on += int(trips)
    return {
        "trips_total": trips_total,
        "trips_on": trips_on,
        "share_pct": round(trips_on / trips_total * 100, 1) if trips_total else 0.0,
        "pairs_total": pairs_total,
        "pairs_on": pairs_on,
    }


def category_totals(
    pair_trips: dict[Pair, int], pair_cat: dict[Pair, str]
) -> dict[str, dict[str, float | int]]:
    """Pairs, trips and trip share per category across the whole network."""
    out = {c: {"pairs": 0, "trips": 0} for c in CATEGORIES}
    for pair, trips in pair_trips.items():
        cat = pair_cat.get(pair, "unclassified")
        out[cat]["pairs"] += 1
        out[cat]["trips"] += int(trips)
    total = sum(v["trips"] for v in out.values())
    for v in out.values():
        v["pct"] = round(v["trips"] / total * 100, 1) if total else 0.0
    return out
