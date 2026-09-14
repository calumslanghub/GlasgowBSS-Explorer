"""Origin-destination aggregations on the directed OD matrix.

Every function takes a DataFrame with columns ``origin, destination, trips``
(one row per directed pair) and returns plain DataFrames or dicts. No I/O.
"""

from __future__ import annotations

import pandas as pd

OD_COLUMNS: tuple[str, ...] = ("origin", "destination", "trips")


def _check_od(od: pd.DataFrame) -> None:
    missing = [c for c in OD_COLUMNS if c not in od.columns]
    if missing:
        raise ValueError(f"OD frame missing columns: {missing}")


def _top_n(sub: pd.DataFrame, partner_col: str, n: int) -> pd.DataFrame:
    total = int(sub["trips"].sum())
    out = (
        sub.groupby(partner_col, as_index=False)["trips"]
        .sum()
        .sort_values(["trips", partner_col], ascending=[False, True])
        .head(n)
        .rename(columns={partner_col: "station"})
        .reset_index(drop=True)
    )
    out["trips"] = out["trips"].astype(int)
    out["share"] = (out["trips"] / total * 100).round(2) if total else 0.0
    return out[["station", "trips", "share"]]


def top_n_destinations(od: pd.DataFrame, station: str, n: int = 10) -> pd.DataFrame:
    """Top ``n`` destinations of trips that start at ``station``.

    Args:
        od: Directed OD matrix (``origin, destination, trips``).
        station: Station name used as the origin filter.
        n: Number of rows to return.

    Returns:
        DataFrame ``station, trips, share`` sorted by trips descending, where
        ``share`` is the percentage of all outbound trips from ``station``.
    """
    _check_od(od)
    sub = od[(od["origin"] == station) & (od["destination"] != station)]
    return _top_n(sub, "destination", n)


def top_n_origins(od: pd.DataFrame, station: str, n: int = 10) -> pd.DataFrame:
    """Top ``n`` origins of trips that end at ``station`` (see top_n_destinations)."""
    _check_od(od)
    sub = od[(od["destination"] == station) & (od["origin"] != station)]
    return _top_n(sub, "origin", n)


def origin_dest_shares(od: pd.DataFrame, station: str) -> dict[str, float | int]:
    """Split of trips touching ``station`` into outbound (origin) and inbound.

    Returns:
        Dict with ``out_trips``, ``in_trips``, ``out_share``, ``in_share`` where the
        two shares are percentages that sum to 100 (0 when the station has no
        trips).
    """
    _check_od(od)
    out_trips = int(od.loc[od["origin"] == station, "trips"].sum())
    in_trips = int(od.loc[od["destination"] == station, "trips"].sum())
    total = out_trips + in_trips
    out_share = round(out_trips / total * 100, 2) if total else 0.0
    in_share = round(100 - out_share, 2) if total else 0.0
    return {
        "out_trips": out_trips,
        "in_trips": in_trips,
        "out_share": out_share,
        "in_share": in_share,
    }


def station_totals(od: pd.DataFrame) -> pd.DataFrame:
    """Outbound, inbound and total trips per station (union of origins and dests)."""
    _check_od(od)
    out = od.groupby("origin")["trips"].sum().rename("out_trips")
    inn = od.groupby("destination")["trips"].sum().rename("in_trips")
    tot = pd.concat([out, inn], axis=1).fillna(0).astype(int)
    tot["trips"] = tot["out_trips"] + tot["in_trips"]
    tot.index.name = "station"
    return tot.reset_index().sort_values("station").reset_index(drop=True)


def od_summary(od: pd.DataFrame, stations: list[str], n: int = 10) -> dict[str, dict]:
    """Per-station summary: top destinations, top origins and the O/D split.

    Args:
        od: Directed OD matrix.
        stations: Station names to summarise (stations absent from ``od`` get
            empty lists and zero counts).
        n: Length of the top lists.

    Returns:
        ``{station: {top_dest: [...], top_orig: [...], out_trips, in_trips,
        out_share, in_share}}`` with list items as ``{station, trips, share}``.
    """
    result: dict[str, dict] = {}
    for s in stations:
        entry = origin_dest_shares(od, s)
        entry["top_dest"] = top_n_destinations(od, s, n).to_dict(orient="records")
        entry["top_orig"] = top_n_origins(od, s, n).to_dict(orient="records")
        result[s] = entry
    return result


def top_pairs(summary: dict[str, dict]) -> set[tuple[str, str]]:
    """Directed (origin, destination) pairs that appear in any top list."""
    pairs: set[tuple[str, str]] = set()
    for station, entry in summary.items():
        for row in entry.get("top_dest", []):
            pairs.add((station, row["station"]))
        for row in entry.get("top_orig", []):
            pairs.add((row["station"], station))
    return pairs
