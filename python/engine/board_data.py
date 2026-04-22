"""Map-data loader (D2.2).

Reads `data/map-spaces.json` and exposes per-map dicts matching the JS
`effectiveMs` shape used by spatial.js / movement.js:

    {
      'spaces': [...],               # list of coord strings
      'adjacency': {coord: [...]},   # 4-conn adjacency graph (pre-computed)
      'blocking': [...],             # blocking-terrain coords (shields merged in later)
      'impassableEdges': [[a,b],...],# wall-like edges (doors/walls)
      'movementBlockingEdges': [[a,b],...],
      'terrain': {coord: 'normal'|'difficult'|'hostile'|'rubble'|...},
    }

Coordinates are stored as lowercase strings matching JS normalization.
"""
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List


_REPO_ROOT = Path(__file__).resolve().parents[2]
_MAP_SPACES_PATH = _REPO_ROOT / 'data' / 'map-spaces.json'


@lru_cache(maxsize=1)
def _load_raw() -> Dict[str, Any]:
    with open(_MAP_SPACES_PATH, encoding='utf-8') as f:
        return json.load(f)


def list_map_ids() -> List[str]:
    return sorted(_load_raw().get('maps', {}).keys())


class UnknownMap(KeyError):
    """Raised when load_map_spaces gets a map id that isn't in the file."""


def load_map_spaces(map_id: str) -> Dict[str, Any]:
    """Return the map's space-geometry dict. Raises UnknownMap on unknown id.

    Returned fields are freshly constructed so callers mutating them does not
    corrupt the cached raw source.
    """
    raw_maps = _load_raw().get('maps', {})
    if map_id not in raw_maps:
        raise UnknownMap(f'{map_id!r} not in map-spaces.json; known ids: {sorted(raw_maps.keys())}')
    m = raw_maps[map_id]
    spaces = list(m.get('spaces', []))
    adjacency: Dict[str, List[str]] = {
        k: list(v) for k, v in (m.get('adjacency', {}) or {}).items()
    }
    blocking = list(m.get('blocking', []))
    impassable_edges = [list(e) for e in (m.get('impassableEdges', []) or [])]
    movement_blocking_edges = [list(e) for e in (m.get('movementBlockingEdges', []) or [])]
    terrain = dict(m.get('terrain', {}) or {})
    return {
        'spaces': spaces,
        'adjacency': adjacency,
        'blocking': blocking,
        'impassableEdges': impassable_edges,
        'movementBlockingEdges': movement_blocking_edges,
        'terrain': terrain,
    }
