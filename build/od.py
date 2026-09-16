"""OD matrix + trip file -> od_by_station.json and system_profile.json.

The trip file is streamed in chunks purely to produce small aggregates: hourly
origin/destination counts per station and day type, weekday/weekend OD counts,
and each station's first trip date. Nothing trip-level is written.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from analysis import hourly as hourly_mod
from analysis import od as od_mod
from build import sources

log = logging.getLogger(__name__)

TOP_N: int = 10
CHUNK_ROWS: int = 250_000
TRIP_COLS: tuple[str, ...] = ("origin", "destination", "started_at", "ended_at")
DAYTYPE_KEYS: tuple[str, ...] = ("all",) + hourly_mod.DAYTYPES


@dataclass
class TripAggregates:
    """Everything the build keeps from the trip file."""

    hourly: pd.DataFrame
    first_dates: pd.Series
    od_counts: pd.DataFrame
    date_range: tuple[str, str] = (sources.STUDY_START, sources.STUDY_END)
    n_trips: int = 0
    parts: dict[str, list] = field(default_factory=dict, repr=False)

    def od(self, daytype: str) -> pd.DataFrame:
        """Directed OD frame for ``"weekday"`` / ``"weekend"`` (empty if no trips)."""
        return hourly_mod.od_for_daytype(self.od_counts, daytype)


def load_od() -> pd.DataFrame:
    """Read the directed OD matrix, dropping self-loops and non-station names."""
    od = pd.read_csv(sources.OD_CSV)
    od = od[~od["origin"].isin(sources.EXCLUDED_STATIONS)]
    od = od[~od["destination"].isin(sources.EXCLUDED_STATIONS)]
    od = od[od["origin"] != od["destination"]]
    od["trips"] = od["trips"].astype(int)
    return od.reset_index(drop=True)


def aggregate_trips(path: Path = sources.TRIPS_CSV) -> TripAggregates:
    """Stream the trip file once and return every small aggregate it yields.

    Self-loops and the placeholder station names are dropped so the
    weekday/weekend OD counts match the filtering of the all-time OD matrix.
    """
    empty = TripAggregates(
        hourly_mod.combine_hourly([]), hourly_mod.combine_first_dates([]),
        hourly_mod.combine_od_counts([]),
    )
    if not path.exists():
        log.warning("Trip file %s not found; hourly split, day types and first dates unavailable", path)
        return empty
    hourly_parts: list[pd.DataFrame] = []
    date_parts: list[pd.Series] = []
    od_parts: list[pd.DataFrame] = []
    first, last, n = None, None, 0
    for chunk in pd.read_csv(path, usecols=list(TRIP_COLS), chunksize=CHUNK_ROWS):
        chunk = chunk.dropna(subset=["origin", "destination"])
        chunk = chunk[~chunk["origin"].isin(sources.EXCLUDED_STATIONS)]
        chunk = chunk[~chunk["destination"].isin(sources.EXCLUDED_STATIONS)]
        chunk = chunk[chunk["origin"] != chunk["destination"]]
        local = hourly_mod.add_local_hours(chunk)
        hourly_parts.append(hourly_mod.hourly_role_counts(local))
        date_parts.append(hourly_mod.first_trip_dates(local))
        od_parts.append(hourly_mod.daytype_od_counts(local))
        lo, hi = local["start_date"].min(), local["start_date"].max()
        first = lo if first is None or lo < first else first
        last = hi if last is None or hi > last else last
        n += len(chunk)
        log.info("  ... %d trips aggregated", n)
    return TripAggregates(
        hourly_mod.combine_hourly(hourly_parts),
        hourly_mod.combine_first_dates(date_parts),
        hourly_mod.combine_od_counts(od_parts),
        (first or sources.STUDY_START, last or sources.STUDY_END),
        n,
    )


def _hourly_rows(profile: dict[str, list]) -> list[dict]:
    return [
        {"hour": h, "out": o, "in": i}
        for h, o, i in zip(profile["hours"], profile["out"], profile["in"])
    ]


def _daytype_block(
    od: pd.DataFrame, station: str, hourly: pd.DataFrame, daytype: str | None
) -> dict:
    block = od_mod.origin_dest_shares(od, station)
    block["top_dest"] = od_mod.top_n_destinations(od, station, TOP_N).to_dict(orient="records")
    block["top_orig"] = od_mod.top_n_origins(od, station, TOP_N).to_dict(orient="records")
    block["hourly"] = _hourly_rows(hourly_mod.hourly_profile(hourly, station, daytype=daytype))
    return block


def write_od_by_station(
    od: pd.DataFrame,
    stations: list[str],
    agg: TripAggregates,
    out: Path = sources.WEB_DATA_DIR / "od_by_station.json",
) -> dict[str, dict]:
    """Write the per-station OD summary for all days, weekdays and weekends.

    Structure per station: ``{all|weekday|weekend: {out_trips, in_trips,
    out_share, in_share, top_dest, top_orig, hourly}, compare: {dest, orig}}``
    where ``compare`` rows contrast weekday and weekend shares per partner.
    """
    frames = {"all": od, "weekday": agg.od("weekday"), "weekend": agg.od("weekend")}
    summary: dict[str, dict] = {}
    for s in stations:
        entry: dict = {}
        for key, frame in frames.items():
            entry[key] = _daytype_block(frame, s, agg.hourly, None if key == "all" else key)
        entry["compare"] = {
            "dest": od_mod.compare_daytypes(frames["weekday"], frames["weekend"], s, "out", n=TOP_N),
            "orig": od_mod.compare_daytypes(frames["weekday"], frames["weekend"], s, "in", n=TOP_N),
        }
        summary[s] = entry
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote OD summary for %d stations to %s", len(summary), out)
    return summary


def all_top_pairs(summary: dict[str, dict]) -> set[tuple[str, str]]:
    """Directed pairs in any top list of any day-type block (for routes.json)."""
    pairs: set[tuple[str, str]] = set()
    for key in DAYTYPE_KEYS:
        pairs |= od_mod.top_pairs({s: e[key] for s, e in summary.items() if key in e})
    return pairs


def write_system_profile(
    od: pd.DataFrame,
    agg: TripAggregates,
    out: Path = sources.WEB_DATA_DIR / "system_profile.json",
) -> dict:
    """Write the network-wide weekday/weekend picture shown before a click.

    Contains per-hour trips per day for each day type (``rows``), the
    station-share shift between weekdays and weekends (``shift``) and headline
    KPIs.
    """
    days = hourly_mod.day_counts(*agg.date_range)
    prof = hourly_mod.system_profile(agg.hourly, days)
    rows = [
        {
            "hour": h,
            "weekday": prof["weekday"]["per_day"][i],
            "weekend": prof["weekend"]["per_day"][i],
            "weekday_pct": prof["weekday"]["share_pct"][i],
            "weekend_pct": prof["weekend"]["share_pct"][i],
        }
        for i, h in enumerate(prof["all"]["hours"])
    ]
    wd, we = agg.od("weekday"), agg.od("weekend")
    total = int(wd["trips"].sum() + we["trips"].sum())
    wd_total, we_total = int(wd["trips"].sum()), int(we["trips"].sum())

    def peak(dt: str) -> int | None:
        t = prof[dt]["trips"]
        return prof[dt]["hours"][t.index(max(t))] if t and max(t) > 0 else None

    payload = {
        "profiles": prof,
        "rows": rows,
        "shift": od_mod.station_share_shift(wd, we, n=TOP_N),
        "kpi": {
            "trips_total": int(od["trips"].sum()),
            "weekday_trips": wd_total,
            "weekend_trips": we_total,
            "weekday_pct": round(wd_total / total * 100, 1) if total else 0.0,
            "weekend_pct": round(we_total / total * 100, 1) if total else 0.0,
            "weekday_per_day": round(wd_total / days["weekday"], 0) if days["weekday"] else 0,
            "weekend_per_day": round(we_total / days["weekend"], 0) if days["weekend"] else 0,
            "weekday_peak_hour": peak("weekday"),
            "weekend_peak_hour": peak("weekend"),
            "days_weekday": days["weekday"],
            "days_weekend": days["weekend"],
        },
        "date_range": list(agg.date_range),
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Wrote system profile (%d weekday / %d weekend days) to %s", days["weekday"], days["weekend"], out)
    return payload
