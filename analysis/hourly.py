"""Time-of-day and first-appearance aggregations over trip-level rows.

The build layer streams the (large) trip file and passes DataFrames in; these
functions never open files. Trip rows need ``origin, destination, started_at,
ended_at`` where the timestamps are ISO strings or datetimes in UTC.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

LOCAL_TZ: str = "Europe/London"
DAY_HOURS: tuple[int, ...] = tuple(range(6, 24))
DAYTYPES: tuple[str, ...] = ("weekday", "weekend")


def add_local_hours(trips: pd.DataFrame, tz: str = LOCAL_TZ) -> pd.DataFrame:
    """Return a copy with local clock hours and the local start date.

    Adds ``start_hour`` / ``end_hour`` (0-23), ``start_date`` (ISO string) and
    ``daytype`` (``"weekday"`` Mon-Fri, ``"weekend"`` Sat-Sun, by local start).
    """
    out = trips.copy()
    start = pd.to_datetime(out["started_at"], utc=True, errors="coerce")
    end = pd.to_datetime(out["ended_at"], utc=True, errors="coerce")
    local_start = start.dt.tz_convert(tz)
    out["start_hour"] = local_start.dt.hour
    out["end_hour"] = end.dt.tz_convert(tz).dt.hour
    out["start_date"] = local_start.dt.strftime("%Y-%m-%d")
    out["daytype"] = np.where(local_start.dt.dayofweek >= 5, "weekend", "weekday")
    return out


def hourly_role_counts(trips: pd.DataFrame) -> pd.DataFrame:
    """Count, per station, day type and clock hour, trips that started vs ended.

    Args:
        trips: Rows with ``origin, destination, start_hour, end_hour, daytype``.

    Returns:
        Long DataFrame ``station, daytype, hour, out, in`` (ints), one row per
        station per day type per observed hour. Combine over chunks with
        ``combine_hourly``.
    """
    out = (
        trips.groupby(["origin", "daytype", "start_hour"])
        .size()
        .rename("out")
        .reset_index()
        .rename(columns={"origin": "station", "start_hour": "hour"})
    )
    inn = (
        trips.groupby(["destination", "daytype", "end_hour"])
        .size()
        .rename("in")
        .reset_index()
        .rename(columns={"destination": "station", "end_hour": "hour"})
    )
    merged = out.merge(inn, on=["station", "daytype", "hour"], how="outer").fillna(0)
    merged["out"] = merged["out"].astype(int)
    merged["in"] = merged["in"].astype(int)
    merged["hour"] = merged["hour"].astype(int)
    return merged.sort_values(["station", "daytype", "hour"]).reset_index(drop=True)


def combine_hourly(parts: list[pd.DataFrame]) -> pd.DataFrame:
    """Sum several ``hourly_role_counts`` outputs (e.g. from file chunks)."""
    if not parts:
        return pd.DataFrame(columns=["station", "daytype", "hour", "out", "in"])
    allp = pd.concat(parts, ignore_index=True)
    return (
        allp.groupby(["station", "daytype", "hour"], as_index=False)[["out", "in"]]
        .sum()
        .sort_values(["station", "daytype", "hour"])
        .reset_index(drop=True)
    )


def daytype_od_counts(trips: pd.DataFrame) -> pd.DataFrame:
    """Directed OD counts split by day type (``origin, destination, daytype, trips``)."""
    out = (
        trips.groupby(["origin", "destination", "daytype"])
        .size()
        .rename("trips")
        .reset_index()
    )
    out["trips"] = out["trips"].astype(int)
    return out


def combine_od_counts(parts: list[pd.DataFrame]) -> pd.DataFrame:
    """Sum several ``daytype_od_counts`` outputs."""
    if not parts:
        return pd.DataFrame(columns=["origin", "destination", "daytype", "trips"])
    allp = pd.concat(parts, ignore_index=True)
    return (
        allp.groupby(["origin", "destination", "daytype"], as_index=False)["trips"]
        .sum()
        .reset_index(drop=True)
    )


def od_for_daytype(od_counts: pd.DataFrame, daytype: str) -> pd.DataFrame:
    """Slice the day-type OD counts into a plain ``origin, destination, trips`` frame."""
    sub = od_counts[od_counts["daytype"] == daytype]
    return sub[["origin", "destination", "trips"]].reset_index(drop=True)


def hourly_profile(
    hourly: pd.DataFrame,
    station: str,
    hours: tuple[int, ...] = DAY_HOURS,
    daytype: str | None = None,
) -> dict[str, list]:
    """Dense hourly series for one station over ``hours`` (missing hours = 0).

    Args:
        hourly: Output of ``combine_hourly``.
        station: Station name.
        hours: Clock hours to report.
        daytype: ``"weekday"`` / ``"weekend"`` to slice, or ``None`` for all days.

    Returns:
        ``{"hours": [...], "out": [...], "in": [...], "out_pct": [...],
        "in_pct": [...]}`` where the pct lists split each hour to 100.
    """
    sub = hourly[hourly["station"] == station]
    if daytype is not None and "daytype" in sub.columns:
        sub = sub[sub["daytype"] == daytype]
    sub = sub.groupby("hour")[["out", "in"]].sum()
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


def day_counts(first: str, last: str) -> dict[str, int]:
    """Calendar weekdays and weekend days between two ISO dates (inclusive)."""
    d0, d1 = date.fromisoformat(first), date.fromisoformat(last)
    if d1 < d0:
        d0, d1 = d1, d0
    n = (d1 - d0).days + 1
    weekend = sum(1 for i in range(n) if (d0 + timedelta(days=i)).weekday() >= 5)
    return {"weekday": n - weekend, "weekend": weekend}


def system_profile(
    hourly: pd.DataFrame, days: dict[str, int], hours: tuple[int, ...] = DAY_HOURS
) -> dict[str, dict]:
    """Network-wide trips started per clock hour, per day type and per day.

    Args:
        hourly: Output of ``combine_hourly`` (all stations).
        days: ``{"weekday": n_days, "weekend": n_days}`` from ``day_counts``.
        hours: Clock hours to report.

    Returns:
        ``{daytype: {"hours": [...], "trips": [...], "per_day": [...],
        "share_pct": [...], "total": N, "days": n}}`` for ``weekday``,
        ``weekend`` and ``all``. ``share_pct`` is each hour's share of that day
        type's trips (sums to 100 over the reported hours).
    """
    result: dict[str, dict] = {}
    slices = {dt: hourly[hourly["daytype"] == dt] for dt in DAYTYPES}
    slices["all"] = hourly
    for dt, sub in slices.items():
        by_hour = sub.groupby("hour")["out"].sum()
        trips = [int(by_hour.get(h, 0)) for h in hours]
        total = sum(trips)
        n_days = sum(days.values()) if dt == "all" else int(days.get(dt, 0))
        result[dt] = {
            "hours": list(hours),
            "trips": trips,
            "per_day": [round(t / n_days, 1) if n_days else 0.0 for t in trips],
            "share_pct": [round(t / total * 100, 2) if total else 0.0 for t in trips],
            "total": total,
            "days": n_days,
        }
    return result
