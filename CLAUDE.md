# CLAUDE.md — Glasgow Bike-Share Dashboard

## What this project is

An interactive web dashboard that showcases the analytical work from my MSc dissertation, on Glasgow's nextbike bike-share system and its relationship to cycle infrastructure.

It is a **portfolio piece**. It will be linked publicly from a LinkedIn post, so it must be self-contained, fast, look polished, and host for free as a **static site** (GitHub Pages / Netlify / Cloudflare Pages). There is **no backend server**.

The dissertation has already produced clean, aggregated outputs (station list, OD matrix, OD panel with infrastructure exposure, k-means commuter labels, station-level covariates). Those aggregates — **not** the raw trip files — are the inputs to this dashboard.

## The core architecture — copy the v4git pattern, in Python

The reference app `v4git/` (R/Shiny + vanilla JS) proves the pattern desired:
a **data build layer** turns messy source files into small, JSON-ready structures, and a **thin vanilla-JS frontend** (Leaflet + Chart.js) renders them.
All interactivity is client-side JS reading pre-computed data. Copy that shape, with two deliberate changes:

1. **The build layer is Python**, not R.
2. **It is a static build, not a live server.** v4git injects JSON into the HTML
   at runtime via Shiny. We instead have Python **write JSON files to `web/data/` at build time**, and the JS `fetch()`es them. Nothing runs server-side once deployed.

```
  Source aggregates (data/raw/*.csv, shapefile)
        │
        ▼
  build/  (Python)  ── calls ──▶  analysis/  (pure functions, DataFrames in/out)
        │
        │ writes small JSON
        ▼
  web/data/*.json
        │
        │ fetch() at page load
        ▼
  web/js/  (vanilla JS: Leaflet map + Chart.js)  ──▶  the deployed site
```

### The one rule that keeps this clean as features grow

The worry is that the codebase will get messy as ideas pile up. The v4git answer, which we adopt, is: **a new panel/idea is a new data layer + a config entry, NOT a new bespoke JS function.**

v4git has ~7 generic renderers (`renderTimeSeries`, `renderSnapshotBar`, `renderGroupedStackedBar`, …) selected declaratively per dataset via a `desired_render` field in `datasets.yaml`. Individual "datasets" are just manifest entries; the JS picks a generic renderer and configures it from meta fields. **Do the same here.** Adding "top-5 destinations" and "top-5 origins" should reuse *one* horizontal-bar renderer, not two. Adding a future panel should,
wherever possible, reuse an existing renderer + a manifest entry rather than introduce a new code path.

**If you find yourself writing a second near-identical renderer, stop and generalise the first one instead.**

## Directory structure

```
diss-dash/
├── CLAUDE.md                  ← you are here
├── README.md                  ← project + "how to run the build" + live link
├── pyproject.toml             ← deps and metadata
├── config/
│   ├── layers.yaml            ← manifest: each JSON layer, its render type + meta
│   └── colours.yaml           ← palette (reuse the dissertation's mode colours)
├── build/                     ← Python; runs offline, regenerates web/data/*.json
│   ├── __init__.py
│   ├── sources.py             ← where the raw source files live (data/raw paths)
│   ├── stations.py            ← station list → stations.json
│   ├── od.py                  ← OD aggregation → per-station top origins/dests + shares
│   ├── infra.py               ← PHASE 2 ONLY: segment geometry + opened date (see below)
│   └── run.py                 ← CLI entry: `python -m build.run` rebuilds everything
├── analysis/                  ← pure functions, no I/O, no plotting, testable
│   ├── __init__.py
│   └── od.py                  ← top_n_destinations(), top_n_origins(), origin_dest_shares()
├── web/                       ← THE DEPLOYABLE STATIC SITE (this is what gets hosted)
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── utils.js           ← Leaflet init, Chart.js helpers, colour helpers
│   │   ├── data.js            ← fetches web/data/*.json once, exposes to app
│   │   ├── renderers.js       ← GENERIC renderers, selected by layer "render" field
│   │   ├── map.js             ← station map + click selection
│   │   └── app.js             ← global state, dispatch, wiring
│   └── data/                  ← generated JSON (COMMIT this — GH Pages serves it)
│       ├── manifest.json
│       ├── stations.json
│       └── od_by_station.json
├── data/                      ← NOT in git (.gitignore)
│   └── raw/                   ← copies of the small dissertation aggregates
├── tests/
│   └── test_od.py
└── .gitignore
```

## Source data — what exists, and what to touch

The dissertation folder (`Diss_Dash/`) holds both huge raw files and small clean aggregates. **Copy only the small aggregates into `data/raw/`. Never import the raw trip files into this repo.**

### USE these (small, already clean — the dashboard inputs)

| File | Rows | Contents |
|---|---|---|
| `gencsvs/glasgow_stations.csv` | 122 | `station_id, lat, lon` — station master list (WGS84) |
| `gencsvs/glasgowOD.csv` | 11,053 | `origin, destination, trips` — directed OD counts (all-time) |
| `gencsvs/glasgow_od_panel_collapsed.csv` | 16,103 | OD pairs + infrastructure exposure per pair (`len_*_m`, `exp_*`) |
| `gencsvs/commuter_labels.csv` | ~4k | k-means commuter classification per OD pair (`cluster, is_commuter`) |
| `gencsvs/station_independent_variables.csv` | 485 | Station covariates by buffer (age, health, cars, NS-SeC, student share…) |
| `gencsvs/station_on_premises.csv` | 485 | Licensed-premises count/capacity per station by buffer |
| `gencsvs/glasgow_epochs.csv` | 22 | Derived infrastructure epochs (`epoch, start, end`) — PHASE 2 |

Note `station_id` in these files is actually the **station name** (a string, e.g. `"Duke Street Railway Station"`), and it is the join key across every table.
The " - ELECTRIC" suffix on some names is part of the id — do not strip it.

### DO NOT touch these (huge; browser death)

| File | Size | Why excluded |
|---|---|---|
| `BSSdata/GlasgownextBSSData.csv` | 359 MB | Raw trip source |
| `gencsvs/glatrips.csv` | 193 MB / 1.2M rows | Trip-level data |
| `gencsvs/glaalltrips.csv` | large | Trip-level data |
| `CensusData/DZshp/*.shp` | 60–80 MB each | Full boundary geometry |

If a view ever needs something only the raw trips can provide (e.g. the hourly 6am–midnight origin/destination split for the stacked bar), **aggregate it in `build/` and write the small result to JSON.** The browser must never see a trip file.

## Phase plan

### Phase 1 (build this now): map + OD explorer + origin/destination split

Deliver a single-page dashboard with:

1. **Leaflet map** of the 122 stations. Click a station to select it.
2. For the selected station:
   - **Top 10 destinations** (where trips from this station go).
   - **Top 10 origins** (where trips ending here started).
   - This should include a side panel that displays the top 10 as a bar chart.
   - On the map clicking a station should reveal lines that show the trip, through the OSMnx.  
   - Reuse **one** horizontal-bar renderer for both.
3. **Origin vs destination stacked bar** for the selected station: of all trips related to this station, what % originate here vs terminate here. One bar, two colours, filled to 100%. Should be a timeseries graph between 6am-11pm. Colour scheme- Blue = Origin, Red = Desination.


For phase 1, `glasgowOD.csv` (directed `origin, destination, trips`) is enough for
all three — top destinations = filter `origin == station`, top origins = filter
`destination == station`, and the origin/destination split = sum of outbound vs
inbound trips. **The hourly 6am–midnight version of the split needs the trip
files, so build that aggregation in `build/od.py` only if/when we want the
time-of-day breakdown; otherwise the all-day split is fine for v1.**

Build order: `analysis/od.py` (pure functions + tests) → `build/od.py` (writes
`od_by_station.json`) → `web/js/renderers.js` + `map.js` → wire in `app.js`.

### Phase 2 (do NOT start until phase 1 is deployed): Infrastructure Timeline
A date slider that plays cycle infrastructure appearing over 2017–2024. This panel will include the cycle infrastructure and BSS stations. Not all stations were open when data was first collected. During slider stations should only appear on the date of the first trip that has the station as an origin or destination. 

- The GCC shapefile `CyclingRoutes/Cycling_Routes_Open.shp` has **no opening-date
  field.** Confirmed columns: `OBJECTID, HYPERLINK, LOC_AUTHOR, CATEGORY_1..5,
  EXTRA_INFO, ROUTENAMEO, TYPE_NEW, PUB_CLASS, SHAPELEN`. It is in **BNG
  (EPSG:27700)** — reproject to WGS84 for the map.
- Opening dates come entirely from **three hand-coded dicts** in
  `GlasgowExposureFinal.ipynb`: `SCHEMES_OPENED`, `PHASED_SCHEMES`,
  `SEGMENT_OPENED`, applied by a `derive_opened(row)` function. `PUB_CLASS` maps to infra type via `GCC_TYPE_MAP`. **Most of `SCHEMES_OPENED` is commented out**, so most segments default to `STUDY_START` (2017-09-15) and will appear at date zero. The scale slider will start at 2017-09-15, the undated infrastructure was there at 2017-09-15. 

- Phase 2 = port `GCC_TYPE_MAP`, `EXTRA_INFO_NORMALISE`, and `derive_opened()` into `build/infra.py`, ideally **completing the opening dates**, then write a simplified GeoJSON with per-segment `opened` + `infra_type` to `web/data/`. The slider filters `opened <= selectedDate` client-side. `glasgow_epochs.csv` is the derived output of this process, useful for snapping the slider to real dates.

Do not scope-creep phase 2 features into phase 1.

## Coding conventions

**Python (build + analysis):**
- Python 3.10+. Type hints on every function signature.
- PEP 8, 88-char lines (Black default). stdlib → third-party → project imports,
  one blank line between groups. No wildcard imports.
- snake_case functions/vars, PascalCase classes, UPPER_SNAKE constants.
- Google-style docstrings on public functions.
- `logging`, not `print`, in `build/` and `analysis/` library code. `print` is
  fine in `run.py`.
- Prefer functions over classes. Keep functions under ~40 lines; if longer, it's
  probably doing two things.
- **`analysis/` does no file I/O and no plotting** — DataFrames in, results out,
  so it stays unit-testable. `build/` reads/writes files and calls `analysis/`.

**JavaScript (frontend):**
- Vanilla JS. No React, no build step for the JS — plain `.js` files loaded in
  `index.html`. Match the v4git style (small focused files, generic renderers).
- Libraries via CDN in `index.html`: **Leaflet** (maps) and **Chart.js** (charts).
  These are the same tools v4git uses.
- Keep global mutable state in one place (v4git uses a single `S = {…}` object;
  do the same). Renderers read state; they don't own navigation.
- No frameworks/bundlers unless there's a concrete reason. This site must open by
  loading `index.html`.

## Data & format conventions

- **Coordinates: WGS84 (EPSG:4326)** for everything the browser sees. Source
  shapefile is BNG (27700) — reproject in `build/`.
- **JSON is the frontend data format.** Round floats (4 dp is plenty), keep keys
  short-ish, structure per-station so the JS does a dict lookup, not a scan:
  `od_by_station.json` → `{ "<station>": { top_dest: [...], top_orig: [...],
  out_trips: N, in_trips: N } }`.
- **`config/layers.yaml` is the manifest.** Each renderable layer names its JSON
  file, its `render` type, a title, and colour/label meta — mirroring v4git's
  `datasets.yaml`. Adding a view starts here.
- Reuse the dissertation's mode palette from `v4git/build/constants.R`
  (`COLOUR_MAP`: Walk `#1a7032`, Cycle `#5eb135`, etc.) so the piece looks
  coherent. Put it in `config/colours.yaml`.
- The build is **deterministic and re-runnable**: `python -m build.run`
  regenerates `web/data/` from `data/raw/` with no manual steps.
- **Commit `web/data/*.json`** to the repo — GitHub Pages serves static files
  only, so the generated JSON must be in git. (`data/raw/` stays gitignored.)

### Example — a `layers.yaml` entry (the pattern to follow)

```yaml
od_top_destinations:
  file: od_by_station.json
  field: top_dest          # which array inside the per-station object
  render: hbar             # generic horizontal-bar renderer
  title: "Top 5 destinations"
  value_key: trips
  label_key: destination
  colour: "#5eb135"
```

A new idea should aim to be another block like this + a `build/` function that
writes the JSON — not a new JS function.

## What NOT to do

- **Do not import raw trip files** (`glatrips.csv`, `GlasgownextBSSData.csv`, etc.)
  into the repo or ship them to the browser. Aggregate in `build/` first.
- **Do not add a backend server** (Flask/FastAPI/Streamlit/Dash). This is a
  static site. If a genuinely interactive query is ever needed, raise it — don't
  quietly add a server.
- **Do not build phase 2 (infrastructure timeline) before phase 1 is deployed.**
- **Do not write a second bespoke renderer** where generalising the first would
  do. That's how this gets messy.
- **Do not mix layers.** `analysis/` must not read files or import from `web/` or
  `build/`. `build/` must not contain chart logic.
- **Do not edit the original dissertation files** in `Diss_Dash/`. Copy the small
  aggregates into this repo's `data/raw/`; treat the originals as read-only source.
- **Do not commit `data/raw/`.** Only `web/data/` JSON is committed.
- **Do not over-abstract for "multiple cities."** This is Glasgow. Build for
  Glasgow; generalise only if a second city ever actually appears.

## Testing

- **pytest.** Tests live in `tests/`, mirroring `analysis/`/`build/`.
- Every `analysis/` function gets at least one test on a small synthetic
  DataFrame (e.g. `top_n_destinations` returns the right 5 in the right order;
  `origin_dest_shares` sums to ~100%).
- A build smoke test: after `python -m build.run`, assert `web/data/*.json` exist,
  parse as JSON, and every station in `stations.json` has an entry in
  `od_by_station.json`.
- Sanity checks worth asserting: Glasgow coords are lat 55.8–55.9, lon −4.4 to
  −4.1; no NaN in required fields; trip counts are non-negative ints.
- Run: `pytest tests/ -v`.

## Dependencies

```
# build + analysis
pandas >= 2.0
geopandas >= 0.14     # PHASE 2 (shapefile → GeoJSON); not needed for phase 1
pyproj                # PHASE 2 (BNG → WGS84)
shapely >= 2.0        # PHASE 2
pyyaml

# testing
pytest
```
Frontend libraries (Leaflet, Chart.js) load via CDN — not pip.

## Git workflow

- Commit after each working piece (a function + its test; a renderer that works).
- Imperative commit subjects, ≤72 chars: "Add top-5 destinations aggregation",
  not "Added...".
- Tag milestones: `v0.1-map-od`, `v0.2-origin-dest-split`, `v1.0-phase1-live`.
- The `main` branch is what GitHub Pages deploys — keep it working.
### Phase 3 (built after phase 2): Corridors & context

Surfaces the remaining dissertation aggregates for the selected station, on a
third tab, with **no new renderers** (reuses `bar` and `kpi`):

- **Busiest corridors** (both directions combined) coloured by the k-means
  commuter label from `commuter_labels.csv` (commuter / leisure / unclassified);
  the same rows drive the map lines while this tab is active.
- **Route on cycle infrastructure**: per corridor, the trip-weighted `exp_any`
  from `glasgow_od_panel_collapsed.csv` (mean across regime blocks), plus a
  station-level breakdown by infrastructure type.
- **Neighbourhood profile**: 250 m buffer covariates from
  `station_independent_variables.csv` and `station_on_premises.csv`.

Build: `analysis/context.py` (pure) → `build/context.py` writes
`context_by_station.json`; manifest entries in `config/layers.yaml` under the
`corridors` view.

### Phase 4: Segregated infrastructure usage

A fourth tab showing only segregated segments, each drawn with width = trips
whose bike-network route followed it (within the dissertation's 15 m snap
tolerance for at least 30 m), with a legend switch to commuter-corridor trips
only. Build: `build/routes.py` routes **all** directed OD pairs once
(`RouteSet`), `analysis/loads.py` (pure) accumulates per-edge loads and
per-segment usage, `build/segregated.py` writes `segregated.geojson` and
`segregated_summary.json`. The same routing feeds the phase 3 city-wide flow
map (`corridor_load.geojson`).

### Frontend conventions added after first review

- Corridor labels are **commuter / non-commuter / unclassified**. Never
  "leisure": the dissertation does not classify leisure use.
- The map legend is the single place for show/hide toggles; every legend
  entry is a button. Views declare legend groups in `layers.yaml`.
- Stations are uniform dots except in Station flows (size = trips). The
  slider bar is generic: `dates` (phase 2) or `hours` (phase 1 standard day).
- Clicking empty map deselects the station; global-scope layers still render.
