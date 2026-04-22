"""Loader for data/deployment-zones.json — per-map red/blue zone coords."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional


_REPO_ROOT = Path(__file__).resolve().parents[3]
_DATA_PATH = _REPO_ROOT / 'data' / 'deployment-zones.json'

_cache: Optional[Dict[str, Any]] = None


def reset_cache() -> None:
    global _cache
    _cache = None


def _load() -> Dict[str, Any]:
    global _cache
    if _cache is not None:
        return _cache
    with open(_DATA_PATH, 'r') as f:
        raw = json.load(f)
    _cache = raw.get('maps') or {}
    return _cache


def get_deployment_zones() -> Dict[str, Any]:
    """Return the full {mapId: {red: [...], blue: [...]}} map."""
    return _load()


def get_deployment_zone(map_id: Optional[str]) -> Dict[str, Any]:
    if not map_id:
        return {}
    return _load().get(map_id) or {}
