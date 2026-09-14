"""Time-of-day and first-appearance aggregations over trip-level rows.

The build layer streams the (large) trip file and passes DataFrames in; these
functions never open files. Trip rows need ``origin, destination, started_at,
ended_at`` where the timestamps are ISO strings or datetimes in UTC.
"""

from __future__ import annotations

import pandas as pd

LOCAL_TZ: str = "Europe/London"
DAY_HOURS: tuple[int, ...] = tuple(range(6, 24))


def add_local_hours(trips: pd.DataFrame, tz: str = LOCAL_TZ) -> pd.DataFrame:
    """Return a copy with local clock hours and the local start date.

    Adds ``start_hour`` / ``end_hour`` (0-23) and ``start_date`` (ISO string).
    """
    out = trips.copy()
    start = pd.to_datetime(out["started_at"], utc=True, errors="coerce")
    end = pd.to_datetime(out["ended_at"], utc=True, errors="coerce")
    local_start = start.dt.tz_convert(tz)
    out["start_hour"] = local_start.dt.hour
    out["end_hour"] = end.dt.tz_convert(tz).dt.hour
    out["start_date"] = local_start.dt.strftime("%Y-%m-%d")
    return out


def hourly_role_counts(trips: pd.DataFrame) -> pd.DataFrame:
    """Count, per station and clock hour, trips that started vs ended there.

    Args:
        trips: Rows with ``origin, destination, start_hour, end_hour``.

    Returns:
        Long DataFrame ``station, hour, out, in`` (ints), one row per station
        per observed hour. Combine over chunks with ``combine_hourly``.
    """
    out = (
        trips.groupby(["origin", "start_hour"])
        .size()
        .rename("out")
        .reset_index()
        .rename(columns={"origin": "station", "start_hour": "hour"})
    )
    inn = (
        trips.groupby(["destination", "end_hour"])
        .size()
        .rename("in")
        .reset_index()
        .rename(columns={"destination": "station", "end_hour": "hour"})
    )
    merged = out.merge(inn, on=["station", "hour"], how="outer").fillna(0)
    merged["out"] = merged["out"].astype(int)
    merged["in"] = merged["in"].astype(int)
    merged["hour"] = merged["hour"].astype(int)
    return merged.sort_values(["station", "hour"]).reset_index(drop=True)


def combine_hourly(parts: list[pd.DataFrame]) -> pd.DataFrame:
    """Sum several ``hourly_role_counts`` outputs (e.g. from file chunks)."""
    if not parts:
        return pd.DataFrame(columns=["station", "hour", "out", "in"])
    allp = pd.concat(parts, ignore_index=True)
    return (
        allp.groupby(["station", "hour"], as_index=False)[["out", "in"]]
        .sum()
        .sort_values(["station", "hour"])
        .reset_index(drop=True)
    )


def hourly_profile(
    hourly: pd.DataFrame, station: str, hours: tuple[int, ...] = DAY_HOURS
) -> dict[str, list]:
    """Dense hourly series for one station over ``hours`` (missing hours = 0).

    Returns:
        ``{"hours": [...], "out": [...], "in": [...], "out_pct": [...],
        "in_pct": [...]}`` where the pct lists split each hour to 100.
    """
    sub = hourly[hourly["station"] == station].set_index("hour")
    out = [int(sub["out"].get(h, 0)) for h in hours]
    inn = [int(sub["in"].get(h, 0)) for h in hours]
    out_pct: list[float] = []
    in_pct: list[float] = []
    for o, i in zip(out, inn):
        t = o + i
        op = round(o / t * 100, 1) if t else 0.0
        out_pct.append(op)
        in_pct.append(round(100 - op, 1) if t else 0.0)
    return {
        "hours": list(hours),
        "out": out,
        "in": inn,
        "out_pct": out_pct,
        "in_pct": in_pct,
    }


def first_trip_dates(trips: pd.DataFrame) -> pd.Series:
    """Earliest ``start_date`` on which each station appears as origin or dest.

    Returns:
        Series indexed by station name with ISO date strings.
    """
    o = trips.groupby("origin")["start_date"].min()
    d = trips.groupby("destination")["start_date"].min()
    both = pd.concat([o, d]).groupby(level=0).min()
    both.index.name = "station"
    return both.sort_index()


def combine_first_dates(parts: list[pd.Series]) -> pd.Series:
    """Element-wise minimum of several ``first_trip_dates`` outputs."""
    if not parts:
        return pd.Series(dtype="object", name="start_date")
    return pd.concat(parts).groupby(level=0).min().sort_index()
