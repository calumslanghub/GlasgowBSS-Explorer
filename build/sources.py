"""Locations of every source file the build reads.

Small dissertation aggregates are copied into ``data/raw/`` (gitignored).
The two large inputs that must never enter the repo (the trip file and the
GCC cycling-routes shapefile) are read in place from the dissertation folder,
which defaults to the parent directory of this repo and can be overridden with
the ``DISS_DIR`` environment variable.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parents[1]
RAW_DIR: Path = REPO_ROOT / "data" / "raw"
CACHE_DIR: Path = REPO_ROOT / "data" / "cache"
WEB_DATA_DIR: Path = REPO_ROOT / "web" / "data"
CONFIG_DIR: Path = REPO_ROOT / "config"

DISS_DIR: Path = Path(os.environ.get("DISS_DIR", REPO_ROOT.parent))

# Small aggregates (copied into data/raw/).
STATIONS_CSV: Path = RAW_DIR / "glasgow_stations.csv"
OD_CSV: Path = RAW_DIR / "glasgowOD.csv"
OD_PANEL_CSV: Path = RAW_DIR / "glasgow_od_panel_collapsed.csv"
COMMUTER_CSV: Path = RAW_DIR / "commuter_labels.csv"
STATION_VARS_CSV: Path = RAW_DIR / "station_independent_variables.csv"
STATION_PREMISES_CSV: Path = RAW_DIR / "station_on_premises.csv"
EPOCHS_CSV: Path = RAW_DIR / "glasgow_epochs.csv"
# Glasgow licensing board premises points (BNG X/Y); on-sales only are used.
PREMISES_POINTS_CSV: Path = RAW_DIR / "Glasgow_Alc_Premise.csv"

# Large inputs read in place (never copied, never shipped to the browser).
TRIPS_CSV: Path = Path(
    os.environ.get("DISS_TRIPS_CSV", DISS_DIR / "gencsvs" / "glatrips.csv")
)
INFRA_SHP: Path = Path(
    os.environ.get(
        "DISS_INFRA_SHP", DISS_DIR / "CyclingRoutes" / "Cycling_Routes_Open.shp"
    )
)

# Cached OSMnx bike network (gitignored; rebuilt on demand).
GRAPH_FILE: Path = CACHE_DIR / "glasgow_bike.graphml"

STUDY_START: str = "2017-09-15"
STUDY_END: str = "2024-04-01"

# Names in the station list that are not real dock locations.
EXCLUDED_STATIONS: frozenset[str] = frozenset({"not specified"})
