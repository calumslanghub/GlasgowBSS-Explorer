"""CLI entry point: ``python -m build.run`` regenerates every file in web/data/.

Options:
  --no-routes   write straight-line routes instead of OSMnx network paths
  --no-trips    skip the trip file (no hourly split / first-trip dates)
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

import pandas as pd

from analysis import od as od_mod
from build import context as context_mod
from build import infra as infra_mod
from build import manifest as manifest_mod
from build import od as od_build
from build import routes as routes_mod
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

    print("1/6  OD matrix + stations")
    od = od_build.load_od()
    stations = stations_mod.load_stations(od)
    names = stations["station"].tolist()

    print("2/6  Trip aggregates (hourly split, first trip dates)")
    if args.no_trips:
        hourly, first_dates = od_build.aggregate_trips(sources.RAW_DIR / "missing.csv")
    else:
        hourly, first_dates = od_build.aggregate_trips()
    stations_mod.write_stations(stations, od, first_dates)
    summary = od_build.write_od_by_station(od, names, hourly)

    print("3/6  Routes for top OD pairs")
    pairs = od_mod.top_pairs(summary)
    routes = routes_mod.write_routes(pairs, stations, use_graph=not args.no_routes)

    print("4/6  Infrastructure GeoJSON + timeline")
    infra = infra_mod.load_infra()
    infra_mod.report_undated(infra)
    infra_mod.write_geojson(infra)
    timeline = infra_mod.write_timeline(infra, first_dates)

    print("5/6  Corridor & context (phase 3)")
    _, net = context_mod.write_context(od, names)

    print("6/6  Manifest")
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
        "router": routes["router"],
        "routes": routes["n"],
    }
    manifest_mod.write_manifest(stats)
    print(f"Done in {time.time() - t0:.1f}s -> {sources.WEB_DATA_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
