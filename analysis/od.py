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


def partner_shares(od: pd.DataFrame, station: str, direction: str) -> pd.DataFrame:
    """Trips and share (%) per partner of ``station`` in one direction.

    Args:
        od: Directed OD matrix.
        station: The selected station.
        direction: ``"out"`` (partners are destinations) or ``"in"`` (origins).

    Returns:
        DataFrame indexed by partner with ``trips`` and ``share`` columns.
    """
    _check_od(od)
    if direction == "out":
        sub = od[(od["origin"] == station) & (od["destination"] != station)]
        col = "destination"
    else:
        sub = od[(od["destination"] == station) & (od["origin"] != station)]
        col = "origin"
    g = sub.groupby(col)["trips"].sum().astype(int).to_frame("trips")
    total = int(g["trips"].sum())
    g["share"] = (g["trips"] / total * 100).round(2) if total else 0.0
    g.index.name = "station"
    return g


def compare_daytypes(
    od_a: pd.DataFrame,
    od_b: pd.DataFrame,
    station: str,
    direction: str,
    names: tuple[str, str] = ("weekday", "weekend"),
    n: int = 10,
) -> list[dict]:
    """Dumbbell rows comparing a station's partners under two OD matrices.

    Takes the union of the top ``n`` partners in each matrix and reports, for
    every partner, its trips and share of the station's trips under both, so a
    chart can show how the ranking shifts (e.g. weekday vs weekend).

    Returns:
        Rows ``{station, <a>_trips, <b>_trips, <a>_share, <b>_share, diff}``
        sorted by ``diff`` (``<b>_share - <a>_share``, percentage points)
        descending, where ``<a>``/``<b>`` are the two ``names``.
    """
    a_name, b_name = names
    a = partner_shares(od_a, station, direction)
    b = partner_shares(od_b, station, direction)
    top = set(a.sort_values("trips", ascending=False).head(n).index)
    top |= set(b.sort_values("trips", ascending=False).head(n).index)
    rows = []
    for partner in top:
        ta = int(a["trips"].get(partner, 0))
        tb = int(b["trips"].get(partner, 0))
        sa = float(a["share"].get(partner, 0.0))
        sb = float(b["share"].get(partner, 0.0))
        rows.append({
            "station": partner,
            f"{a_name}_trips": ta,
            f"{b_name}_trips": tb,
            f"{a_name}_share": round(sa, 2),
            f"{b_name}_share": round(sb, 2),
            "diff": round(sb - sa, 2),
        })
    rows.sort(key=lambda r: (-r["diff"], r["station"]))
    return rows


def station_share_shift(
    od_a: pd.DataFrame,
    od_b: pd.DataFrame,
    names: tuple[str, str] = ("weekday", "weekend"),
    n: int = 10,
) -> list[dict]:
    """Which stations gain or lose importance between two OD matrices.

    A station's share is the percentage of that matrix's trips that start or
    end there. The union of the top ``n`` stations by trips in each matrix is
    reported.

    Returns:
        Rows ``{station, <a>_trips, <b>_trips, <a>_share, <b>_share, diff}``
        sorted by ``diff`` (``<b>_share - <a>_share``) descending.
    """
    a_name, b_name = names
    ta = station_totals(od_a).set_index("station")
    tb = station_totals(od_b).set_index("station")
    tot_a = float(od_a["trips"].sum()) or 1.0
    tot_b = float(od_b["trips"].sum()) or 1.0
    top = set(ta.sort_values("trips", ascending=False).head(n).index)
    top |= set(tb.sort_values("trips", ascending=False).head(n).index)
    rows = []
    for s in top:
        na = int(ta["trips"].get(s, 0))
        nb = int(tb["trips"].get(s, 0))
        sa = round(na / tot_a * 100, 2)
        sb = round(nb / tot_b * 100, 2)
        rows.append({
            "station": s, f"{a_name}_trips": na, f"{b_name}_trips": nb,
            f"{a_name}_share": sa, f"{b_name}_share": sb, "diff": round(sb - sa, 2),
        })
    rows.sort(key=lambda r: (-r["diff"], r["station"]))
    return rows
