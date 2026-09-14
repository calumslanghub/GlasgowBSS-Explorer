"""Small geometry helpers shared by the build modules (BNG -> WGS84, rounding)."""

from __future__ import annotations

from shapely.geometry import LineString, MultiLineString
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge

CRS_WGS84: str = "EPSG:4326"
CRS_BNG: str = "EPSG:27700"
COORD_DP: int = 5


def latlon_paths(geom: BaseGeometry, dp: int = COORD_DP) -> list[list[list[float]]]:
    """Return a WGS84 (Multi)LineString as ``[[[lat, lon], ...], ...]`` paths.

    Leaflet polylines want ``[lat, lon]`` order; GeoJSON wants ``[lon, lat]``.
    This helper produces the Leaflet order (used by routes.json).
    """
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, MultiLineString):
        merged = linemerge(geom)
        parts = list(merged.geoms) if isinstance(merged, MultiLineString) else [merged]
    elif isinstance(geom, LineString):
        parts = [geom]
    else:
        return []
    return [
        [[round(y, dp), round(x, dp)] for x, y in part.coords] for part in parts
    ]


def lonlat_paths(geom: BaseGeometry, dp: int = COORD_DP) -> list[list[list[float]]]:
    """GeoJSON-ordered ``[[[lon, lat], ...], ...]`` paths for a (Multi)LineString."""
    return [[[lon, lat] for lat, lon in part] for part in latlon_paths(geom, dp)]
