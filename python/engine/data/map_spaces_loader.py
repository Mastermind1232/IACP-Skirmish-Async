"""D7.5 — data/map-spaces.json loader.

JS analogue: `getMapSpaces(mapId)` in `src/data-loader.js`. The JSON has
top key `maps`, nested per mission with fields:
  - spaces: List[str]  (every valid IA cell on the map)
  - adjacency: Dict[str, List[str]]
  - terrain: Dict[str, str]  (values: 'normal' | 'blocking')
  - blocking: List[str]  (explicit blocking-tile coords)
  - impassableEdges: List[[str, str]]  (LOS-blocking walls)
  - movementBlockingEdges: List[[str, str]]  (doors, one-way, etc.)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
MAP_SPACES_PATH = REPO_ROOT / 'data' / 'map-spaces.json'

_map_spaces: Optional[Dict[str, Any]] = None


def reset_cache() -> None:
    global _map_spaces
    _map_spaces = None


def _load() -> Dict[str, Any]:
    global _map_spaces
    if _map_spaces is None:
        with open(MAP_SPACES_PATH, 'r') as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            maps = raw.get('maps', {})
            _map_spaces = maps if isinstance(maps, dict) else {}
        else:
            _map_spaces = {}
    return _map_spaces


def get_map_spaces(map_id: Optional[str]) -> Dict[str, Any]:
    """Return the map-spaces payload for `map_id`, or {} if absent."""
    if not map_id:
        return {}
    return _load().get(map_id, {})


def all_map_ids() -> list:
    """List of mission IDs that have spaces data."""
    return list(_load().keys())
