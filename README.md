# Glasgow Bike-Share Explorer

I BUILT THIS AFTER HANDING IN MY DISSERTATION

The code is for an interactive, static dashboard of trip data from Glasgow's nextbike bike-share system (Sep 2017
to Apr 2024) and its relationship to cycle infrastructure. I built the dashboard to provide an accessible format to view the findings of my dissertation. 

Link to dashboard: https://calumslanghub.github.io/GlasgowBSS-Explorer/

## What it shows

The five pages follow the dissertation: Data exploration of how the nextbike system is used,
creation of variables based on surrounding area of each station, when infrastructure was built,
what station pairs were identified commuter corridors, and the findings of the regression model.

| Page | Content |
|---|---|
| 1 Station flows | With nothing selected: the network's weekday and weekend hourly profiles and which stations shift between weekday hubs and weekend hotspots. Click a station: top 10 destinations and origins (switchable between all days, weekdays and weekends), a weekday-vs-weekend dumbbell chart of the same partners, routes drawn along the shortest bike-network path (OSMnx), and the origin-vs-destination split by hour (06:00 to 23:00). Press play for a *standard day* (per day type): markers grow with that hour's trips per day and shade from red (mostly ending there) to blue (mostly starting there). |
| 2 Neighbourhoods | The station-buffer covariates (Census 2022 output areas within 150, 250 or 500 m; licensed premises within the buffer). Pick a variable to colour the 2,551 output areas the stations can reach, and click a station to see its buffer drawn on the same colour scale, filled with the average the regression uses. Toggle a heat map of on-sales licensed premises, or switch to residents-vs-workplace columns and how that gap narrows as the buffer widens. |
| 3 Cycle infrastructure | A date slider (with play) that reveals cycle infrastructure as it opened, and docking stations as they recorded their first trip. Chart of km open by type. Stations are not selectable here. |
| 4 Commuter corridors | City-wide flow map: every station pair routed on the bike network, with street width = trips on that street, toggled by commuter / non-commuter label (unlabelled pairs count as non-commuter, as in the regression). Click a station for its busiest corridors and their route exposure to cycle infrastructure. |
| 5 Regression | The negative-binomial gravity model: headline trip-rate ratios, the predicted effect of segregated exposure for commuter vs other pairs, a coefficient plot with naive and two-way clustered intervals, and the model ladder. The map shows segregated segments with width = trips whose route followed them, switchable to commuter-corridor trips only. |

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
