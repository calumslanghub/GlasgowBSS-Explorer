"""Census 2022 output areas -> web/data/oa.geojson (the neighbourhood choropleth).

Reads the NRS census tables and the output-area boundary shapefile in place from
the dissertation folder (the boundaries are 77 MB and never enter this repo),
keeps the output areas the station buffers can reach, scores each one with
``analysis.census_oa`` and writes a simplified WGS84 GeoJSON carrying every
census variable as a property.

The readers mirror ``CensusFix_2.ipynb`` so the polygons and the station-buffer
averages come from the same numbers.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import geopandas as gpd
import pandas as pd

from analysis import census_oa as oa_mod
from analysis import context as ctx
from build import premises as premises_mod
from build import sources
from build.geo import CRS_BNG, CRS_WGS84

log = logging.getLogger(__name__)

OA_ID_FIELD: str = "code"
SIMPLIFY_M: float = 10.0
COORD_DP: int = 5
# Output areas within this distance of a station are shipped: the widest buffer,
# so every buffer the user can pick is fully covered.
REACH_M: int = max(ctx.BUFFERS_M)

DISTANCE_RENAMES: dict[str, str] = {
    "Mainly work from home": "wfh",
    "Less than 2km": "d_lt2",
    "2km to less than 5km": "d_2_5",
    "5km to less than 10km": "d_5_10",
    "10km to less than 20km": "d_10_20",
    "20km to less than 30km": "d_20_30",
    "30km to less than 40km": "d_30_40",
    "40km to less than 60km": "d_40_60",
    "60km and over": "d_60plus",
    "Other - No fixed place of work or working outside the UK": "no_fixed",
}


def _valid_codes(df: pd.DataFrame, col: str = "Datazone") -> pd.DataFrame:
    """Drop the disclosure-control footer rows the NRS tables carry."""
    return df.loc[df[col].astype(str).str.match(r"^S00\d+$")].copy()


def _numeric(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Coerce count columns to numbers; the NRS ``-`` placeholder means zero."""
    df = df.replace("-", 0)
    for c in cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _read_counts(path: Path, value_cols: list[str] | None = None) -> tuple[pd.DataFrame, list[str]]:
    """Read one of the three-line-header NRS count tables (age, health, cars, NS-SeC)."""
    df = pd.read_csv(path, skiprows=3).rename(columns={0: "Datazone"})
    df = df.rename(columns={df.columns[0]: "Datazone"})
    df = _valid_codes(df)
    cols = value_cols or [c for c in df.columns if c != "Datazone"]
    return _numeric(df, cols), cols


def load_master(census_dir: Path = sources.CENSUS_DIR) -> tuple[pd.DataFrame, list[str], list[str]]:
    """Join every census table into one row per output area.

    Returns:
        ``(master, age_cols, nssec_cols)`` where ``master`` is indexed by the
        output-area code. Residents and workplace population are left joins:
        an output area the source does not cover keeps ``NaN`` so the map can
        grey it out rather than show a false zero.
    """
    mf = pd.read_csv(census_dir / "Male_Female_Population.csv",
                     names=["Datazone", "All People", "Female", "Male"])
    mf = _numeric(_valid_codes(mf), ["Female", "Male"])

    age, age_all = _read_counts(census_dir / "Age.csv")
    age_cols = [c for c in age_all if c != "All people"]
    health, _ = _read_counts(census_dir / "GenHealth.csv", list(oa_mod.HEALTH_VALUE))
    cars, _ = _read_counts(census_dir / "Car_van.csv", list(oa_mod.CARS_VALUE))
    nssec, nssec_all = _read_counts(census_dir / "Ns_SeC.csv")
    nssec_cols = [c for c in nssec_all if c.startswith("L")]

    student = pd.read_csv(census_dir / "studentpop.csv").rename(
        columns={"OutputArea": "Datazone", "TotalPopOver16": "TotalPop"}
    )
    student = _numeric(_valid_codes(student), ["TotalPop", "StudentPop"])

    dist = pd.read_csv(census_dir / "DistancetoWork.csv")
    dist = dist.rename(columns={dist.columns[0]: "Datazone", **DISTANCE_RENAMES})
    dist_cols = [c for c in DISTANCE_RENAMES.values() if c in dist.columns]
    dist = _numeric(_valid_codes(dist), dist_cols)

    pop16 = _valid_codes(pd.read_csv(census_dir / "totpopover16.csv").rename(
        columns={"OutputArea": "Datazone"}))
    pop16 = _numeric(pop16, ["over16pop"])

    work = _valid_codes(pd.read_csv(census_dir / "GlaWorkplacePop.csv").rename(
        columns={"OutputCode": "Datazone", "WorkplacePop": "workplace_pop"}))
    work["workplace_pop"] = pd.to_numeric(
        work["workplace_pop"].astype(str).str.replace(",", "", regex=False), errors="coerce"
    )

    master = (
        mf[["Datazone", "Male", "Female"]]
        .merge(age[["Datazone"] + age_cols], on="Datazone")
        .merge(health[["Datazone"] + list(oa_mod.HEALTH_VALUE)], on="Datazone")
        .merge(cars[["Datazone"] + list(oa_mod.CARS_VALUE)], on="Datazone")
        .merge(nssec[["Datazone"] + nssec_cols], on="Datazone")
        .merge(student[["Datazone", "TotalPop", "StudentPop"]], on="Datazone")
        .merge(dist[["Datazone"] + dist_cols], on="Datazone")
        .merge(pop16[["Datazone", "over16pop"]], on="Datazone", how="left")
        .merge(work[["Datazone", "workplace_pop"]], on="Datazone", how="left")
    )
    return master.set_index("Datazone"), age_cols, nssec_cols


def reachable_areas(
    stations: pd.DataFrame, path: Path = sources.OA_SHP, reach_m: int = REACH_M
) -> gpd.GeoDataFrame:
    """Output areas intersecting any station's widest buffer (BNG, metres)."""
    oa = gpd.read_file(path).to_crs(CRS_BNG)
    pts = gpd.GeoDataFrame(
        stations,
        geometry=gpd.points_from_xy(stations["lon"], stations["lat"]),
        crs=CRS_WGS84,
    ).to_crs(CRS_BNG)
    reach = pts.geometry.buffer(reach_m).union_all()
    return oa.loc[oa.intersects(reach), [OA_ID_FIELD, "geometry"]].copy()


def premises_per_area(areas: gpd.GeoDataFrame) -> pd.DataFrame:
    """Count and capacity of on-sales premises falling inside each output area."""
    if not sources.PREMISES_POINTS_CSV.exists():
        return pd.DataFrame(columns=[OA_ID_FIELD, "n_on_premises", "premises_capacity"])
    pts = premises_mod.load_on_premises().to_crs(areas.crs)
    joined = gpd.sjoin(pts[["capacity", "geometry"]], areas, predicate="within", how="inner")
    counts = joined.groupby(OA_ID_FIELD).agg(
        n_on_premises=("capacity", "size"), premises_capacity=("capacity", "sum")
    )
    return counts.reset_index()


def _geometry(geom, dp: int = COORD_DP) -> dict | None:
    """A (Multi)Polygon as a rounded GeoJSON geometry dict."""
    def ring(coords) -> list[list[float]]:
        return [[round(x, dp), round(y, dp)] for x, y in coords]

    def poly(p) -> list[list[list[float]]]:
        return [ring(p.exterior.coords)] + [ring(i.coords) for i in p.interiors]

    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "Polygon":
        return {"type": "Polygon", "coordinates": poly(geom)}
    if geom.geom_type == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [poly(p) for p in geom.geoms]}
    return None


def write_oa(
    stations: pd.DataFrame, out: Path = sources.WEB_DATA_DIR / "oa.geojson"
) -> dict:
    """Write the output-area choropleth and describe what it contains.

    Returns:
        ``{n, reach_m, scale}`` where ``scale`` is ``{var: value_stats(...)}``
        over the shipped output areas — the colour domain the map uses for both
        the polygons and the station buffers. Empty (and nothing written) when
        the source files are unavailable.
    """
    if not sources.OA_SHP.exists() or not sources.CENSUS_DIR.exists():
        log.warning(
            "Output-area boundaries (%s) or census tables (%s) not found; "
            "the neighbourhood map falls back to station buffers",
            sources.OA_SHP, sources.CENSUS_DIR,
        )
        return {}
    areas = reachable_areas(stations)
    master, age_cols, nssec_cols = load_master()
    values = oa_mod.oa_values(
        master.reindex(areas[OA_ID_FIELD]), age_cols, nssec_cols, premises_per_area(areas)
    )

    simp = areas.copy()
    simp["geometry"] = simp.geometry.simplify(SIMPLIFY_M, preserve_topology=True)
    simp = simp.to_crs(CRS_WGS84)
    features = []
    for r in simp.itertuples(index=False):
        geom = _geometry(r.geometry)
        if geom is None:
            continue
        row = values.loc[getattr(r, OA_ID_FIELD)]
        props: dict[str, object] = {"code": getattr(r, OA_ID_FIELD)}
        for key, meta in ctx.CENSUS_VARS.items():
            v = row[key]
            props[key] = None if pd.isna(v) else (float(v) if meta["dp"] else int(v))
        features.append({"type": "Feature", "geometry": geom, "properties": props})

    fc = {"type": "FeatureCollection", "features": features}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    scale = {
        key: ctx.value_stats(values[key].dropna().to_numpy()) for key in ctx.CENSUS_VARS
    }
    log.info("Wrote %d output areas (within %d m of a station) to %s",
             len(features), REACH_M, out)
    return {"n": len(features), "reach_m": REACH_M, "scale": scale}
