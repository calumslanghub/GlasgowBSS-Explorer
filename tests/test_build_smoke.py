"""Smoke test on the generated web/data/ files (run after ``python -m build.run``)."""

import json
import math
from pathlib import Path

import pytest

WEB_DATA = Path(__file__).resolve().parents[1] / "web" / "data"
REQUIRED = [
    "manifest.json",
    "stations.json",
    "od_by_station.json",
    "routes.json",
    "infra.geojson",
    "infra_timeline.json",
    "context_by_station.json",
    "corridor_network.json",
    "corridor_load.geojson",
    "segregated.geojson",
    "segregated_summary.json",
]

pytestmark = pytest.mark.skipif(
    not (WEB_DATA / "manifest.json").exists(), reason="web/data not built yet"
)


def load(name: str) -> object:
    return json.loads((WEB_DATA / name).read_text(encoding="utf-8"))


def test_all_files_exist_and_parse() -> None:
    for name in REQUIRED:
        assert (WEB_DATA / name).exists(), name
        load(name)


def test_stations_are_in_glasgow_and_complete() -> None:
    stations = load("stations.json")
    assert len(stations) >= 100
    for s in stations:
        assert 55.75 <= s["lat"] <= 55.95 and -4.45 <= s["lon"] <= -4.05, s["id"]
        assert s["trips"] >= 0 and isinstance(s["trips"], int)
        assert len(s["first_trip"]) == 10


def test_every_station_has_od_and_context_entries() -> None:
    ids = [s["id"] for s in load("stations.json")]
    od = load("od_by_station.json")
    ctx = load("context_by_station.json")
    for sid in ids:
        assert sid in od, sid
        assert sid in ctx, sid
        e = od[sid]
        assert e["out_share"] + e["in_share"] == pytest.approx(100, abs=0.05) or e["out_trips"] + e["in_trips"] == 0
        assert len(e["top_dest"]) <= 10 and len(e["top_orig"]) <= 10
        assert [r["hour"] for r in e["hourly"]] == list(range(6, 24))
        for row in e["top_dest"] + e["top_orig"]:
            assert row["trips"] >= 0 and not math.isnan(row["share"])


def test_routes_cover_every_top_pair() -> None:
    od = load("od_by_station.json")
    routes = load("routes.json")["pairs"]
    for sid, e in od.items():
        for r in e["top_dest"]:
            assert f"{sid}|{r['station']}" in routes
        for r in e["top_orig"]:
            assert f"{r['station']}|{sid}" in routes
    any_path = next(iter(routes.values()))
    lat, lon = any_path[0][0]
    assert 55.7 <= lat <= 56.0 and -4.5 <= lon <= -4.0


def test_infra_geojson_and_timeline() -> None:
    fc = load("infra.geojson")
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) > 900
    types = {f["properties"]["type"] for f in fc["features"]}
    assert types <= {"segregated", "lane", "shared", "mixed"}
    lon, lat = fc["features"][0]["geometry"]["coordinates"][0][:2] if fc["features"][0]["geometry"]["type"] == "LineString" else fc["features"][0]["geometry"]["coordinates"][0][0][:2]
    assert -4.6 <= lon <= -4.0 and 55.7 <= lat <= 56.0
    tl = load("infra_timeline.json")
    n = len(tl["dates"])
    for key in ("segregated", "lane", "shared", "mixed", "any", "stations"):
        assert len(tl[key]) == n
        assert all(b >= a for a, b in zip(tl[key], tl[key][1:])), f"{key} not monotone"
    assert tl["dates"][0] == "2017-09-15" and tl["dates"][-1] == "2024-04-01"


def test_corridor_labels_and_loads() -> None:
    ctx = load("context_by_station.json")
    labels = {r["commuter"] for e in ctx.values() for r in e["corridors"]}
    assert labels <= {"commuter", "non-commuter", "unclassified"}
    assert "leisure" not in labels
    net = load("corridor_network.json")
    assert net["commuter_pct"] + net["noncommuter_pct"] + net["unclassified_pct"] == pytest.approx(100, abs=0.2)
    fc = load("corridor_load.geojson")
    assert fc["features"] and set(fc["max"]) == {"c", "n", "u"}
    for f in fc["features"][:50]:
        p = f["properties"]
        assert p["c"] >= 0 and p["n"] >= 0 and p["u"] >= 0 and p["c"] + p["n"] + p["u"] >= 10


def test_segregated_usage() -> None:
    fc = load("segregated.geojson")
    assert len(fc["features"]) > 100
    for f in fc["features"]:
        p = f["properties"]
        assert p["t"] == p["c"] + p["n"] + (p["t"] - p["c"] - p["n"]) and p["t"] >= p["c"]
    s = load("segregated_summary.json")
    for mode in ("all", "commuter"):
        assert 0 <= s[mode]["share_pct"] <= 100
        assert s[mode]["trips_on"] <= s[mode]["trips_total"]
        assert s[mode]["top"] and s[mode]["top"][0]["trips"] >= s[mode]["top"][-1]["trips"]
    assert s["commuter"]["trips_total"] < s["all"]["trips_total"]


def test_manifest_layers_reference_existing_files_and_fields() -> None:
    m = load("manifest.json")
    for name, layer in m["layers"].items():
        assert (WEB_DATA / layer["file"]).exists(), name
        assert layer["render"] in {"bar", "line", "kpi"}, name
        for k, v in layer.items():
            assert not (isinstance(v, str) and v.startswith("$")), f"{name}.{k} unresolved"
    for vname, view in m["views"].items():
        for lname in view["layers"] + view["map"]["lines"]:
            assert lname in m["layers"], f"{vname} -> {lname}"
