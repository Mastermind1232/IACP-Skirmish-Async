"""D3.1 — data/ability-library.json loader.

Mirrors `src/data-loader.js:74-75`: unwraps `.abilities` from the raw JSON so
callers get `{ability_id: entry}` directly — same shape JS handlers index into.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
ABILITY_LIBRARY_PATH = REPO_ROOT / 'data' / 'ability-library.json'

_library: Optional[Dict[str, Any]] = None


def reset_cache() -> None:
    global _library
    _library = None


def get_ability_library() -> Dict[str, Any]:
    """Return the abilities dict keyed by ability_id.

    JS `getAbilityLibrary()` returns `{abilities: {...}}`; callers read `.abilities`.
    This Python loader returns the inner dict directly.
    """
    global _library
    if _library is None:
        with open(ABILITY_LIBRARY_PATH, 'r') as f:
            raw = json.load(f)
        _library = raw.get('abilities', {}) if isinstance(raw, dict) else {}
    return _library


def get_ability(ability_id: str) -> Optional[Dict[str, Any]]:
    return get_ability_library().get(ability_id)
