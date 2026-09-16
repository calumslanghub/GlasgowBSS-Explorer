"""Phase 3: corridor character and station context.

Joins the OD matrix with the dissertation's pair-level outputs (k-means
commuter labels, route exposure to cycle infrastructure) and the station-level
covariates (census buffers, licensed premises). Pure functions; no I/O.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

EXPOSURE_TYPES: tuple[str, ...] = ("segregated", "lane", "shared", "mixed", "any")
BUFFERS_M: tuple[int, ...] = (150, 250, 500, 750)

# Station-buffer covariates shipped to the neighbourhood maps, with display
# metadata. ``pct`` values are stored as fractions in the source and shown x100.
# ``source`` names the table column when it differs from the key.
CENSUS_VARS: dict[str, dict] = {
    "avg_age": {"label": "Average age", "unit": " yrs", "dp": 1,
                "desc": "Mean age of residents in the buffer's data zones"},
    "student_share": {"label": "Students", "unit": "%", "dp": 1, "pct": True,
                      "desc": "Share of residents 16+ who are full-time students"},
    "avg_cars_per_household": {"label": "Cars per household", "unit": "", "dp": 2,
                               "desc": "Mean cars or vans per household"},
    "avg_health_score": {"label": "Health score", "unit": "", "dp": 2,
                         "desc": "Self-reported general health, 1 (very bad) to 5 (very good)"},
    "avg_nssec_score": {"label": "NS-SeC score", "unit": "", "dp": 1,
                        "desc": "Socio-economic classification, 1 (higher managerial) to 15 (never worked)"},
    "cycling_distance_share_ext": {"label": "Commutes in cycling range", "unit": "%", "dp": 1,
                                   "pct": True, "source": "cycling_distance_share_ext",
                                   "desc": "Share of workers travelling under 10 km to work"},
    "male_female_ratio": {"label": "Male : female ratio", "unit": "", "dp": 2,
                          "desc": "Male residents per female resident"},
    "over16pop": {"label": "Residents 16+", "unit": "", "dp": 0,
                  "desc": "Resident population aged 16 and over"},
    "workplace_pop": {"label": "Workplace population", "unit": "", "dp": 0,
                      "desc": "People whose workplace is in the buffer"},
    "n_on_premises": {"label": "Licensed premises", "unit": "", "dp": 0,
                      "source": "n_on_premises", "heat": True,
                      "desc": "Premises licensed for on-sales (pubs, bars, restaurants, clubs)"},
    "premises_capacity": {"label": "Premises capacity", "unit": "", "dp": 0,
                          "source": "total_capacity_on", "heat": True,
                          "desc": "Summed licensed on-sales capacity"},
}


def _label(flag: bool | None) -> str:
    """Display label for a commuter flag; unlabelled pairs are non-commuter."""
    return "commuter" if flag else "non-commuter"


def canonical_pair(a: pd.Series, b: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Unordered pair key as two aligned Series (``lo <= hi``)."""
    lo = pd.Series(np.where(a <= b, a, b), index=a.index)
    hi = pd.Series(np.where(a <= b, b, a), index=a.index)
    return lo, hi


def pair_exposure(panel: pd.DataFrame) -> pd.DataFrame:
    """Trip-weighted mean exposure per directed pair across panel blocks.

    Args:
        panel: ``glasgow_od_panel_collapsed`` rows (``origin, destination, trips,
            exp_segregated, exp_lane, exp_shared, exp_mixed, exp_any, len_any_m``).

    Returns:
        One row per ``(origin, destination)`` with ``trips`` (sum) and each
        ``exp_*`` as a trip-weighted mean in [0, 1], plus ``len_any_m``.
    """
    cols = [f"exp_{t}" for t in EXPOSURE_TYPES]
    p = panel.copy()
    w = p["trips"].astype(float)
    for c in cols:
        p[c] = p[c].astype(float) * w
    g = p.groupby(["origin", "destination"], as_index=False).agg(
        trips=("trips", "sum"),
        len_any_m=("len_any_m", "max"),
        **{c: (c, "sum") for c in cols},
    )
    tw = g["trips"].replace(0, np.nan)
    for c in cols:
        g[c] = (g[c] / tw).fillna(0.0).round(4)
    return g


def commuter_lookup(labels: pd.DataFrame) -> dict[tuple[str, str], bool]:
    """``{(lo, hi): is_commuter}`` keyed by the canonical unordered pair."""
    return {
        (r.origin_c, r.dest_c): bool(r.is_commuter)
        for r in labels.itertuples(index=False)
    }


def label_pair(
    origin: str, dest: str, lookup: dict[tuple[str, str], bool]
) -> bool | None:
    """Commuter flag for a directed pair (None when the pair is unclassified)."""
    key = (origin, dest) if origin <= dest else (dest, origin)
    return lookup.get(key)


def corridor_rows(
    top_rows: list[dict],
    station: str,
    direction: str,
    exposure: pd.DataFrame,
    lookup: dict[tuple[str, str], bool],
) -> list[dict]:
    """Enrich top-list rows with commuter label and infra exposure.

    Args:
        top_rows: ``[{station, trips, share}]`` from the OD summary.
        station: The selected station.
        direction: ``"out"`` (rows are destinations) or ``"in"`` (rows are origins).
        exposure: Output of ``pair_exposure``.
        lookup: Output of ``commuter_lookup``.

    Returns:
        Rows with added ``commuter`` (``"commuter" | "non-commuter"``) and
        ``exp_any`` .. ``exp_mixed`` as percentages (1 dp).
    """
    exp = exposure.set_index(["origin", "destination"])
    out = []
    for r in top_rows:
        o, d = (station, r["station"]) if direction == "out" else (r["station"], station)
        row = dict(r)
        row["commuter"] = _label(label_pair(o, d, lookup))
        for t in EXPOSURE_TYPES:
            col = f"exp_{t}"
            val = exp[col].get((o, d), 0.0) if col in exp.columns else 0.0
            row[col] = round(float(val) * 100, 1)
        out.append(row)
    return out


def undirected_corridors(
    od: pd.DataFrame,
    exposure: pd.DataFrame,
    lookup: dict[tuple[str, str], bool],
    station: str,
    n: int = 10,
) -> list[dict]:
    """Top ``n`` partners of ``station`` by trips in both directions combined.

    Each row carries ``station`` (the partner), ``trips`` (both directions),
    ``share`` (% of all trips touching the station), ``commuter`` label and the
    trip-weighted ``exp_*`` exposure of the two directed routes (%).
    """
    sub = od[(od["origin"] == station) | (od["destination"] == station)].copy()
    sub = sub[sub["origin"] != sub["destination"]]
    sub["partner"] = np.where(sub["origin"] == station, sub["destination"], sub["origin"])
    m = sub.merge(exposure, on=["origin", "destination"], how="left", suffixes=("", "_p"))
    cols = [f"exp_{t}" for t in EXPOSURE_TYPES]
    for c in cols:
        m[c] = m[c].fillna(0.0) * m["trips"]
    g = m.groupby("partner", as_index=False).agg(
        trips=("trips", "sum"), **{c: (c, "sum") for c in cols}
    )
    total = float(g["trips"].sum())
    g = g.sort_values(["trips", "partner"], ascending=[False, True]).head(n)
    rows = []
    for r in g.itertuples(index=False):
        row: dict = {
            "station": r.partner,
            "trips": int(r.trips),
            "share": round(r.trips / total * 100, 2) if total else 0.0,
        }
        row["commuter"] = _label(label_pair(station, r.partner, lookup))
        for c in cols:
            row[c] = round(float(getattr(r, c)) / r.trips * 100, 1) if r.trips else 0.0
        rows.append(row)
    return rows


def station_exposure(
    od: pd.DataFrame, exposure: pd.DataFrame, station: str
) -> dict[str, float]:
    """Trip-weighted route exposure (%) over all trips touching ``station``."""
    sub = od[(od["origin"] == station) | (od["destination"] == station)]
    m = sub.merge(exposure, on=["origin", "destination"], how="left", suffixes=("", "_p"))
    w = m["trips"].astype(float)
    total = float(w.sum())
    result: dict[str, float] = {}
    for t in EXPOSURE_TYPES:
        col = f"exp_{t}"
        vals = m[col].fillna(0.0) if col in m.columns else pd.Series(0.0, index=m.index)
        result[t] = round(float((vals * w).sum() / total * 100), 1) if total else 0.0
    return result


def commuter_share(
    od: pd.DataFrame, lookup: dict[tuple[str, str], bool], station: str
) -> dict[str, float]:
    """Share (%) of a station's trips on commuter-labelled pairs.

    Returns ``commuter_pct`` (of all trips; unlabelled pairs count as
    non-commuter), ``classified_pct`` (share of trips on pairs the k-means step
    labelled at all) and ``commuter_pairs`` (distinct commuter partners).
    """
    sub = od[(od["origin"] == station) | (od["destination"] == station)]
    flags = [label_pair(o, d, lookup) for o, d in zip(sub["origin"], sub["destination"])]
    w = sub["trips"].astype(float).to_numpy()
    is_c = np.array([f is True for f in flags])
    is_l = np.array([f is not None for f in flags])
    total = float(w.sum())
    classified = float(w[is_l].sum()) if len(w) else 0.0
    commuter = float(w[is_c].sum()) if len(w) else 0.0
    partners = set()
    for (o, d), f in zip(zip(sub["origin"], sub["destination"]), flags):
        if f is True:
            partners.add(d if o == station else o)
    return {
        "commuter_pct": round(commuter / total * 100, 1) if total else 0.0,
        "classified_pct": round(classified / total * 100, 1) if total else 0.0,
        "commuter_pairs": len(partners),
    }


def census_table(
    station_vars: pd.DataFrame,
    premises: pd.DataFrame,
    stations: list[str],
    buffers: tuple[int, ...] = BUFFERS_M,
) -> dict[str, dict[int, dict[str, float | None]]]:
    """Every CENSUS_VARS value per station per buffer radius.

    Args:
        station_vars: ``station_independent_variables`` rows.
        premises: ``station_on_premises`` rows.
        stations: Station names to include (missing rows give ``None`` values).
        buffers: Buffer radii (m) to include.

    Returns:
        ``{station: {buffer_m: {var: value}}}`` with ``pct`` variables scaled to
        percent and every value rounded to its display precision.
    """
    merged = station_vars.merge(premises, on=["station_id", "buffer_m"], how="left")
    merged = merged.set_index(["station_id", "buffer_m"]).sort_index()
    out: dict[str, dict[int, dict[str, float | None]]] = {}
    for s in stations:
        out[s] = {}
        for b in buffers:
            row = merged.loc[(s, b)] if (s, b) in merged.index else None
            vals: dict[str, float | None] = {}
            for key, meta in CENSUS_VARS.items():
                col = meta.get("source", key)
                v = None if row is None or col not in row.index else row[col]
                if v is None or pd.isna(v):
                    vals[key] = None
                    continue
                v = float(v) * (100 if meta.get("pct") else 1)
                vals[key] = round(v, meta["dp"]) if meta["dp"] else int(round(v))
            out[s][b] = vals
    return out


def variable_ranking(
    table: dict[str, dict[int, dict[str, float | None]]],
    var: str,
    buffer_m: int,
    n: int = 10,
) -> dict:
    """Highest / lowest stations and summary statistics for one variable.

    Returns:
        ``{"top": [{station, value}], "bottom": [...], "min", "max", "mean",
        "median", "q05", "q95", "n"}`` (``bottom`` ascending, ``top``
        descending). Stations with a ``None`` value are ignored.
    """
    vals = [
        (s, buf[buffer_m][var])
        for s, buf in table.items()
        if buffer_m in buf and buf[buffer_m].get(var) is not None
    ]
    if not vals:
        return {"top": [], "bottom": [], "min": None, "max": None, "mean": None,
                "median": None, "q05": None, "q95": None, "n": 0}
    vals.sort(key=lambda t: (-t[1], t[0]))
    arr = np.array([v for _, v in vals], dtype=float)
    rows = [{"station": s, "value": v} for s, v in vals]
    return {
        "top": rows[:n],
        "bottom": list(reversed(rows[-n:])),
        "min": float(arr.min()),
        "max": float(arr.max()),
        "mean": round(float(arr.mean()), 3),
        "median": round(float(np.median(arr)), 3),
        "q05": round(float(np.quantile(arr, 0.05)), 3),
        "q95": round(float(np.quantile(arr, 0.95)), 3),
        "n": int(len(arr)),
    }


def population_balance(
    table: dict[str, dict[int, dict[str, float | None]]], buffer_m: int
) -> list[dict]:
    """Residents vs workplace population per station for one buffer radius.

    Returns:
        Rows ``{station, residents, workplace, total, workplace_pct, log_ratio}``
        sorted by ``workplace_pct`` descending. ``workplace_pct`` is the share of
        (residents + workplace) that is workplace population; ``log_ratio`` is
        ``ln((workplace + 1) / (residents + 1))`` (positive = job-rich).
    """
    rows = []
    for s, buf in table.items():
        v = buf.get(buffer_m) or {}
        res, wp = v.get("over16pop"), v.get("workplace_pop")
        if res is None or wp is None:
            continue
        total = res + wp
        rows.append({
            "station": s,
            "residents": int(res),
            "workplace": int(wp),
            "total": int(total),
            "workplace_pct": round(wp / total * 100, 1) if total else 0.0,
            "log_ratio": round(float(np.log((wp + 1) / (res + 1))), 3),
        })
    rows.sort(key=lambda r: (-r["workplace_pct"], r["station"]))
    return rows


def network_summary(
    od: pd.DataFrame, exposure: pd.DataFrame, lookup: dict[tuple[str, str], bool]
) -> dict[str, float | int]:
    """City-wide headline numbers for the summary tiles."""
    total = int(od["trips"].sum())
    m = od.merge(exposure, on=["origin", "destination"], how="left", suffixes=("", "_p"))
    w = m["trips"].astype(float)
    exp_any = float((m["exp_any"].fillna(0.0) * w).sum() / w.sum() * 100) if total else 0.0
    flags = [label_pair(o, d, lookup) for o, d in zip(od["origin"], od["destination"])]
    wt = od["trips"].astype(float).to_numpy()
    classified = float(wt[[f is not None for f in flags]].sum())
    commuter = float(wt[[f is True for f in flags]].sum())
    return {
        "trips": total,
        "pairs": int(len(od)),
        "exp_any_pct": round(exp_any, 1),
        "commuter_pct": round(commuter / total * 100, 1) if total else 0.0,
        "classified_pct": round(classified / total * 100, 1) if total else 0.0,
    }
