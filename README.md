# Glasgow Bike-Share Explorer

I BUILT THIS AFTER HANDING IN MY DISSERTATION

The code is for an interactive, static dashboard of trip data from Glasgow's nextbike bike-share system (Sep 2017
to Apr 2024) and its relationship to cycle infrastructure. I built the dashboard to provide an accessible format to view the findings of my dissertation. 

Link to dashboard: https://calumslanghub.github.io/GlasgowBSS-Explorer/

## What it shows

One scrolling page that follows the dissertation:

| Section | Content |
|---|---|
| 1 Station flows | Stations sized by trips. Click one for its top 5 destinations and origins (all days, weekdays or weekends), weekday-vs-weekend dumbbells, routes along the shortest bike-network path and the hourly origin/destination split. Press play for a standard day. |
| 2 Neighbourhoods | 2a census variables on the output areas (with the station buffer the regression averaged), 2b residents vs workplace population, 2c a heat map of on-sales licensed premises. |
| 3 Cycle infrastructure | A date slider that reveals infrastructure as it opened, and stations as they recorded their first trip. |
| 4 Commuter corridors | The k-means clustering: switch between one, two or three of its metrics (strip, 2D or 3D plot), pick pairs by clicking, lassoing or range sliders, and see their routes on the map and listed below. |
| 5 Regression | The negative-binomial gravity model's headline rate ratios, IRR curve, coefficient plot and model ladder, then a map of how many trips followed each segregated segment. |

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
   `build/sources.py` for the list). The trip file, the GCC shapefile and the
   census output areas (boundaries plus the NRS count tables) are read in place
   from the dissertation folder (parent directory by default; override with
   `DISS_DIR`, `DISS_TRIPS_CSV`, `DISS_INFRA_SHP`, `DISS_OA_SHP`,
   `DISS_CENSUS_DIR`).
2. Fetch the OSMnx bike network once (cached, gitignored):
   ```
   python -m build.graph
   ```
3. Rebuild everything in `web/data/`:
   ```
   python -m build.run            # full build
   python -m build.run --no-routes  # straight lines instead of network routes
   python -m build.run --no-trips   # skip the trip file (no hourly split)
   python -m build.run --no-oa      # skip the output-area layer (buffers only)
   ```
4. Tests:
   ```
   pytest tests/ -v
   ```
