# Glasgow Bike-Share Explorer

Interactive, static dashboard of Glasgow's nextbike bike-share system (Sep 2017
to Apr 2024) and its relationship to cycle infrastructure. Built from the
aggregated outputs of an MSc dissertation; no raw trip data is shipped.

**Live site:** _add the GitHub Pages / Netlify URL here once deployed_

## What it shows

| Tab | Phase | Content |
|---|---|---|
| Station flows | 1 | Click a station: top 10 destinations, top 10 origins, routes drawn along the shortest bike-network path (OSMnx), and the origin-vs-destination split by hour (06:00 to 23:00). Press play for a *standard day*: markers grow with that hour's trips and shade from red (mostly ending there) to blue (mostly starting there). |
| Infrastructure timeline | 2 | A date slider (with play) that reveals cycle infrastructure as it opened, and docking stations as they recorded their first trip. Chart of km open by type. |
| Corridors & context | 3 | City-wide flow map: every classified station pair routed on the bike network, with street width = trips on that street, toggled by commuter / non-commuter label. Click a station for its busiest corridors, route exposure to cycle infrastructure and the 250 m census-buffer neighbourhood profile. |
| Segregated infrastructure | 4 | Only segregated segments, drawn with width = trips whose route followed them (within 15 m for at least 30 m), a ranked list of the most-used streets, and a switch to commuter-corridor trips only. |

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

`web/data/*.json` are committed (they are the site's database), so the `web/`
folder is a complete static site. It deploys to GitHub Pages via
`.github/workflows/deploy.yml`, which publishes the `web/` folder on every push
to `main`. In the repo's **Settings -> Pages**, set **Source: GitHub Actions**
(the workflow does the rest). Note the native "deploy from a branch" option
cannot target a `web/` subfolder -- only the repo root or `/docs` -- which is why
the Actions workflow is used.

Once deployed the site lives at `https://<user>.github.io/<repo>/`; add that URL
to the **Live site** line near the top of this README. Netlify or Cloudflare
Pages also work -- set the publish directory to `web/` with no build command.

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
- The corridor flow map and segregated-usage counts route all 11,052 directed
  OD pairs on the cached OSMnx bike graph (about a minute on 8 cores) and use
  the latest infrastructure network, not the dated regimes.
