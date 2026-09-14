"""config/layers.yaml + config/colours.yaml -> web/data/manifest.json.

Colour references of the form ``"$roles.origin"`` or ``"$corridor"`` are
resolved against colours.yaml here so the JS receives literal hex values.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import yaml

from build import sources

log = logging.getLogger(__name__)


def load_yaml(path: Path) -> dict:
    """Read a YAML file into a dict (empty dict if the file is empty)."""
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def resolve_ref(value: str, colours: dict) -> Any:
    """Resolve ``$a.b`` against nested ``colours``; raise if the path is missing."""
    node: Any = colours
    for part in value[1:].split("."):
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"Unknown colour reference {value!r}")
        node = node[part]
    return node


def resolve_colours(obj: Any, colours: dict) -> Any:
    """Recursively replace ``$path`` strings with values from ``colours``."""
    if isinstance(obj, str) and obj.startswith("$"):
        return resolve_ref(obj, colours)
    if isinstance(obj, dict):
        return {k: resolve_colours(v, colours) for k, v in obj.items()}
    if isinstance(obj, list):
        return [resolve_colours(v, colours) for v in obj]
    return obj


def validate(layers: dict, views: dict) -> None:
    """Fail loudly if a view names a layer that does not exist."""
    for name, view in views.items():
        for lname in view.get("layers", []) + view.get("map", {}).get("lines", []):
            if lname not in layers:
                raise KeyError(f"View {name!r} references unknown layer {lname!r}")


def write_manifest(
    summary: dict,
    out: Path = sources.WEB_DATA_DIR / "manifest.json",
) -> dict:
    """Write manifest.json with resolved layers, views, colours and summary stats."""
    layers_cfg = load_yaml(sources.CONFIG_DIR / "layers.yaml")
    colours = load_yaml(sources.CONFIG_DIR / "colours.yaml")
    layers = resolve_colours(layers_cfg.get("layers", {}), colours)
    views = layers_cfg.get("views", {})
    validate(layers, views)
    payload = {"layers": layers, "views": views, "colours": colours, "summary": summary}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("Wrote manifest with %d layers / %d views to %s", len(layers), len(views), out)
    return payload
