# Glasgow Bike-Share Explorer

Interactive, static dashboard of Glasgow's nextbike bike-share system (Sep 2017
to Apr 2024) and its relationship to cycle infrastructure. Built from the
aggregated outputs of an MSc dissertation; no raw trip data is shipped.

**Live site:** _add the GitHub Pages / Netlify URL here once deployed_

## What it shows

| Tab | Phase | Content |
|---|---|---|
| Station flows | 1 | Click a station: top 10 destinations, top 10 origins, routes drawn along the shortest bike-network path (OSMnx), and the origin-vs-destination split by hour (06:00 to 23:00). |
| Infrastructure timeline | 2 | A date slider (with play) that reveals cycle infrastructure as it opened, and docking stations as they recorded their first trip. Chart of km open by type. |
| Corridors & context | 3 | The station's busiest corridors coloured by the dissertation's k-means commuter label, how much of each route runs on cycle infrastructure, and the 250 m census-buffer neighbourhood profile. |

## How it is built

```
data/raw/*.csv + ../gencsvs/glatrips.csv + ../CyclingRoutes/*.shp
        │
        ▼
build/  (Python)  ── calls ──▶  analysis/  (pure functions, tested)
        │  writes small JSON
        ▼
web/data/*.json  ──fetch()──▶  web/js/  (vanilla JS: Leaflet + Chart.js)
```

`config/layers.yaml` is the manifest: every panel is a layer entry naming its
JSON file, the field to read and one of three generic renderers (`bar`, `line`,
`kpi`). Tabs are `views` listing layers in order. Adding a panel is a build
function that writes JSON plus a manifest entry, not new JS.

## Running the build

Requirements: Python 3.10+, `pip install -e .[routing,test]` (pandas,
geopandas, shapely, pyproj, pyyaml, osmnx, pytest).

1. Copy the small dissertation aggregates into `data/raw/` (see
   `build/sources.py` for the list). The trip file and the GCC shapefile are
   read in place from the dissertation folder (parent directory by default;
   override with `DISS_DIR`, `DISS_TRIPS_CSV`, `DISS_INFRA_SHP`).
2. Fetch the OSMnx bike network once (cached, gitignored):
   ```
   python -m build.graph
   ```
3. Rebuild everything in `web/data/`:
   ```
   python -m build.run            # full build
   python -m build.run --no-routes  # straight lines instead of network routes
   python -m build.run --no-trips   # skip the trip file (no hourly split)
   ```
4. Tests:
   ```
   pytest tests/ -v
   ```

## Running the site locally

The site is plain files. Because the JS `fetch()`es JSON, open it through any
static server rather than `file://`:

```
cd web && python -m http.server 8000
```

then visit http://localhost:8000.

## Deploying

Commit `web/data/*.json` (they are the site's database) and publish the `web/`
folder with GitHub Pages, Netlify or Cloudflare Pages. No server, no build step
for the JS.

## Data notes

- Station names (including the ` - ELECTRIC` suffix) are the join key across
  every table.
- The infrastructure shapefile has no opening-date field. Dates come from
  hand-coded lookups in `analysis/infra.py` ported from the dissertation
  notebook; segments without a date default to the study start and the build
  logs the named schemes still undated.
- Commuter labels are the dissertation's pre-COVID k-means classification of
  unordered station pairs; pairs with too few trips are "unclassified".
- Route exposure is the share of a pair's shortest bike route within 15 m of
  infrastructure, trip-weighted across the dissertation's exposure regimes.
