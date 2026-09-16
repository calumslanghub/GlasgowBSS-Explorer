"""CLI entry point: ``python -m build.run`` regenerates every file in web/data/.

Options:
  --no-routes   straight-line routes; skips the corridor and segregated flow maps
  --no-trips    skip the trip file (no hourly split / first-trip dates)
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

from build import context as context_mod
from build import infra as infra_mod
from build import manifest as manifest_mod
from build import od as od_build
from build import premises as premises_mod
from build import regression as regression_mod
from build import routes as routes_mod
from build import segregated as seg_mod
from build import sources
from build import stations as stations_mod


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Rebuild web/data/*.json")
    p.add_argument("--no-routes", action="store_true", help="straight lines, no OSMnx")
    p.add_argument("--no-trips", action="store_true", help="skip the trip file")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    t0 = time.time()
    sources.WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("1/9  OD matrix + stations")
    od = od_build.load_od()
    stations = stations_mod.load_stations(od)
    names = stations["station"].tolist()

    print("2/9  Trip aggregates (hourly split, weekday/weekend, first trip dates)")
    trips_path = sources.RAW_DIR / "missing.csv" if args.no_trips else sources.TRIPS_CSV
    agg = od_build.aggregate_trips(trips_path)
    stations_mod.write_stations(stations, od, agg.first_dates)
    summary = od_build.write_od_by_station(od, names, agg)
    od_build.write_system_profile(od, agg)

    print("3/9  Neighbourhood covariates + licensed premises")
    context_mod.write_census(names)
    premises_mod.write_premises()

    print("4/9  Corridors & commuter labels")
    _, net, lookup = context_mod.write_context(od, names)
    pair_trips, pair_cat = context_mod.pair_categories(od, lookup)

    print("5/9  Routing every OD pair on the bike network")
    rs = routes_mod.build_routes(od, stations, sources.GRAPH_FILE, use_graph=not args.no_routes)
    routes = routes_mod.write_routes(rs, od_build.all_top_pairs(summary), stations)
    routes_mod.write_corridor_loads(rs, pair_trips, pair_cat)

    print("6/9  Infrastructure GeoJSON + timeline")
    infra = infra_mod.load_infra()
    infra_mod.report_undated(infra)
    infra_mod.write_geojson(infra)
    timeline = infra_mod.write_timeline(infra, agg.first_dates)

    print("7/9  Segregated infrastructure usage")
    seg = seg_mod.write_segregated(rs, infra, pair_trips, pair_cat)

    print("8/9  Regression results")
    regression_mod.write_regression()

    print("9/9  Manifest")
    stats = {
        "stations": len(names),
        "trips": net["trips"],
        "pairs": net["pairs"],
        "date_start": sources.STUDY_START,
        "date_end": sources.STUDY_END,
        "infra_km": timeline["any"][-1],
        "infra_segments": timeline["segments"],
        "commuter_pct": net["commuter_pct"],
        "classified_pct": net["classified_pct"],
        "exp_any_pct": net["exp_any_pct"],
        "segregated_share_pct": seg["all"]["share_pct"],
        "router": routes["router"],
        "routes": routes["n"],
    }
    manifest_mod.write_manifest(stats)
    print(f"Done in {time.time() - t0:.1f}s -> {sources.WEB_DATA_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
