"""Cycle-infrastructure dating and timeline aggregation (phase 2).

Ported from ``GlasgowExposureFinal.ipynb``: the GCC shapefile has no opening
date field, so dates come from hand-coded lookups applied by ``derive_opened``.
Anything not covered defaults to ``STUDY_START`` (present from day one).

Precedence in ``derive_opened``: per-segment OBJECTID override > phased scheme
(dated by street) > scheme-level date > STUDY_START.
"""

from __future__ import annotations

from datetime import date

import pandas as pd

STUDY_START: date = date(2017, 9, 15)
STUDY_END: date = date(2024, 4, 1)

TYPE_FIELD: str = "PUB_CLASS"
SCHEME_FIELD: str = "EXTRA_INFO"

# GCC PUB_CLASS -> analysis infra type. Exact-match against the .dbf values.
GCC_TYPE_MAP: dict[str, str] = {
    "Segregated Cycle Lane": "segregated",
    "Cycle Lane": "lane",
    "Shared Footway": "shared",
    "Shared Path": "shared",
    "Mixed Traffic Street": "mixed",
}

INFRA_TYPES: tuple[str, ...] = ("segregated", "lane", "shared", "mixed")

# EXTRA_INFO spelling variants -> canonical (one date then covers both).
EXTRA_INFO_NORMALISE: dict[str, str] = {
    "South West City Way": "South-West City Way",
    "Forth and Clyde Canal": "Forth & Clyde Canal",
    "Kelvingrove Park Route": "Kelvingrove Park",
    "Cycle marking on road": "Cycle Marking on Road",
    "Park route": "Park Route",
}

# Scheme (normalised EXTRA_INFO) -> opening date. Sources in comments.
SCHEMES_OPENED: dict[str, date] = {
    "Connecting Woodside": date(2021, 6, 6),
    # Spaces for People light segregation (Ruchill / Bilsland Drive).
    "Armadillo": date(2020, 9, 13),
}

# Named schemes in EXTRA_INFO that still have no confirmed date. They default to
# STUDY_START. Listed so the build can report them; add to SCHEMES_OPENED once
# a source is found.
UNDATED_SCHEMES: tuple[str, ...] = (
    "East City Way",
    "West City Way",
    "South-West City Way",
    "Sighthill TRA project",
    "North East Active Travel Route",
    "The Drumchapel Way",
    "Avenue A",
    "Avenue B",
    "Avenue Pilot",
    "Orcas",
    "Batons",
    "Segregation islands/batons",
    "Light segregation",
)

# South City Way opened south -> north in phases that sit on different streets.
SCW_STREET_OPENED: dict[str, date] = {
    "Victoria Rd": date(2018, 11, 14),
    "Allison St": date(2018, 11, 14),
    "Calder St": date(2018, 11, 14),
    "Pollokshaws Rd": date(2019, 3, 29),
    "Gorbals St": date(2023, 4, 3),
    "Bridgegate": date(2024, 6, 17),
    "King Street": date(2024, 6, 17),
}
PHASED_SCHEMES: dict[str, dict] = {
    "South City Way": {"field": "ROUTENAMEO", "dates": SCW_STREET_OPENED},
}


def _dated(ids: list[int], when: date) -> dict[int, date]:
    return {i: when for i in ids}


# Per-segment override, OBJECTID -> date. Beats everything else.
SEGMENT_OPENED: dict[int, date] = {
    # Spaces for People, London Road phase 2.
    **_dated([1917, 1918, 1192, 1195], date(2020, 7, 17)),
    # East City Way reaching the city centre.
    **_dated([1536, 1515, 1533, 1532, 776, 1916, 1915, 694], date(2023, 7, 6)),
    # George V Bridge (after the study window).
    **_dated([822, 460], date(2025, 6, 1)),
    # Govan-Partick Bridge (after the study window).
    **_dated([982, 1919], date(2024, 9, 7)),
    # Hawthorn Street, Possilpark.
    **_dated([1723, 1719, 1218, 1201, 1718, 1722], date(2020, 10, 2)),
    # Great Western Road, Duntreath Ave to Lincoln Ave.
    **_dated(
        [1946, 1947, 1959, 1958, 1199, 1948, 1960, 1957, 1949, 1956, 1950, 1955,
         1954, 1951, 1953, 1194, 1952],
        date(2020, 7, 21),
    ),
    # Cumbernauld Rd, Station Rd to Provanmill Rd; Provanmill Rd.
    **_dated([578, 577, 1734, 635, 1735, 639, 1733, 579, 638], date(2020, 8, 20)),
    # Broomielaw, Saltmarket to Clyde Arc; Dumbreck Road.
    **_dated([1713, 1198, 1219, 1220, 1907, 1216, 1386], date(2020, 5, 15)),
    # Corkerhill Road.
    **_dated([1368, 1367], date(2020, 10, 2)),
    # Kelvin Way.
    **_dated([1584, 1767], date(2020, 9, 29)),
    # Hyndland / Clarence Drive.
    **_dated(
        [1425, 1429, 1431, 1428, 1430, 1426, 1435, 1427, 1432, 1752, 1753, 1754],
        date(2020, 12, 4),
    ),
    # Brockburn Road, Pollok.
    **_dated(
        [1338, 1319, 1347, 1342, 1348, 1349, 1341, 1339, 1317, 1343, 1340, 1345,
         1337, 1346, 1321, 1318, 1322, 1323, 1320, 1324],
        date(2021, 3, 21),
    ),
    # Argyle Street.
    1844: date(2020, 9, 1),
    # Howard Street.
    85: date(2021, 2, 22),
    # Royston Road.
    **_dated([636, 634, 1839, 1838], date(2021, 5, 1)),
    # Wallacewell Road, Balornock.
    **_dated([450, 448, 1874, 1979, 1980, 1981, 1582, 1583], date(2021, 4, 27)),
    # Cambridge Street.
    1363: date(2021, 4, 10),
    # BMX scheme, Lincoln Ave and Archerhill Road.
    **_dated([882, 884, 885, 886], date(2018, 8, 1)),
    # Byres Road and Church Street (after the study window).
    **_dated([1849, 1848, 1847], date(2024, 10, 1)),
    # Cowcaddens Road (after the study window).
    1867: date(2025, 8, 1),
    # St Andrews Drive cycleway.
    570: date(2023, 2, 1),
}


def normalise_scheme(value: object) -> str | None:
    """Fold EXTRA_INFO spelling variants to their canonical scheme name."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    if not s:
        return None
    return EXTRA_INFO_NORMALISE.get(s, s)


def derive_opened(row: pd.Series | dict) -> date:
    """Opening date for one shapefile row (see module docstring for precedence)."""
    oid = row.get("OBJECTID")
    if oid is not None and not pd.isna(oid):
        try:
            if int(oid) in SEGMENT_OPENED:
                return SEGMENT_OPENED[int(oid)]
        except (ValueError, TypeError):
            pass
    scheme = normalise_scheme(row.get(SCHEME_FIELD))
    if scheme in PHASED_SCHEMES:
        spec = PHASED_SCHEMES[scheme]
        d = spec["dates"].get(row.get(spec["field"]))
        if d is not None:
            return d
    if scheme is not None and scheme in SCHEMES_OPENED:
        return SCHEMES_OPENED[scheme]
    return STUDY_START


def date_segments(df: pd.DataFrame) -> pd.DataFrame:
    """Add ``infra_type`` and ``opened`` columns; drop unmapped PUB_CLASS rows.

    Args:
        df: Shapefile attribute rows (``OBJECTID, PUB_CLASS, EXTRA_INFO,
            ROUTENAMEO`` at least).

    Returns:
        Copy with ``infra_type`` (str) and ``opened`` (``datetime.date``).
    """
    out = df.copy()
    out["infra_type"] = out[TYPE_FIELD].map(GCC_TYPE_MAP)
    out = out.dropna(subset=["infra_type"]).copy()
    out["opened"] = out.apply(derive_opened, axis=1)
    out["scheme"] = out[SCHEME_FIELD].map(normalise_scheme)
    return out


def undated_named_schemes(df: pd.DataFrame) -> pd.DataFrame:
    """Named schemes whose segments all defaulted to STUDY_START (for reporting)."""
    if "scheme" not in df.columns:
        df = date_segments(df)
    sub = df[df["scheme"].isin(UNDATED_SCHEMES)]
    return (
        sub.groupby("scheme")
        .agg(segments=("scheme", "size"), defaulted=("opened", lambda s: int((s == STUDY_START).sum())))
        .reset_index()
        .sort_values("segments", ascending=False)
        .reset_index(drop=True)
    )


def month_starts(start: date, end: date) -> list[date]:
    """First-of-month dates from ``start`` (inclusive) through ``end`` (inclusive)."""
    dates = [start]
    y, m = start.year, start.month
    while True:
        m += 1
        if m > 12:
            m, y = 1, y + 1
        d = date(y, m, 1)
        if d > end:
            break
        dates.append(d)
    if dates[-1] != end:
        dates.append(end)
    return dates


def km_open_by_type(
    segments: pd.DataFrame, dates: list[date], length_col: str = "length_m"
) -> pd.DataFrame:
    """Cumulative km of infrastructure open at each date, per infra type.

    Args:
        segments: Rows with ``infra_type``, ``opened`` and ``length_col`` (m).
        dates: Snapshot dates (segments with ``opened <= date`` count).

    Returns:
        DataFrame indexed by date with one column per INFRA_TYPES entry plus
        ``any`` (all types), in km rounded to 2 dp.
    """
    rows = []
    for d in dates:
        open_ = segments[segments["opened"] <= d]
        by_type = open_.groupby("infra_type")[length_col].sum() / 1000
        row = {t: round(float(by_type.get(t, 0.0)), 2) for t in INFRA_TYPES}
        row["any"] = round(float(open_[length_col].sum() / 1000), 2)
        rows.append(row)
    return pd.DataFrame(rows, index=pd.Index(dates, name="date"))


def stations_open_count(first_dates: pd.Series, dates: list[date]) -> list[int]:
    """Number of stations whose first trip is on or before each date."""
    fd = pd.to_datetime(first_dates).dt.date
    return [int((fd <= d).sum()) for d in dates]
