"""Loader for data/map-tokens.json — per-map terminals / doors / mission tokens."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional


_REPO_ROOT = Path(__file__).resolve().parents[3]
_DATA_PATH = _REPO_ROOT / 'data' / 'map-tokens.json'

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


def get_map_tokens_data() -> Dict[str, Any]:
    """Return the full {mapId: {terminals, missionA, missionB, doors, namedAreas}} map."""
    return _load()


def get_map_tokens(map_id: Optional[str]) -> Dict[str, Any]:
    """Return tokens for a specific map, or {} if unknown."""
    if not map_id:
        return {}
    return _load().get(map_id) or {}
