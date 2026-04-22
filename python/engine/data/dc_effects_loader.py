"""D2.24 — data/dc-effects.json loader.

JS analogue: `getDcEffects()` in `src/data-loader.js`. The JSON is a dict keyed
by DC name whose values are effect objects (`specialAbilityIds`, `companion`,
`unique`, `keywords`, `affiliation`, etc.). Matches JS shape byte-for-byte.

Module-level cache — first load hits disk, subsequent calls return the cached
dict. Tests that need a clean slate can call `reset_cache()`.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
DC_EFFECTS_PATH = REPO_ROOT / 'data' / 'dc-effects.json'

_dc_effects: Optional[Dict[str, Any]] = None


def reset_cache() -> None:
    """Drop the module-level cache (for test determinism)."""
    global _dc_effects
    _dc_effects = None


def get_dc_effects() -> Dict[str, Any]:
    """Return the DC-effects dict keyed by DC name.

    The on-disk JSON is `{source, cards}`; JS `getDcEffects()` (see
    `src/data-loader.js:54-55`) unwraps to `.cards`. Match that shape so
    `effects.get(dcName)` works with `dcName` keys byte-identical to JS.
    """
    global _dc_effects
    if _dc_effects is None:
        with open(DC_EFFECTS_PATH, 'r') as f:
            raw = json.load(f)
        _dc_effects = raw.get('cards', {}) if isinstance(raw, dict) else {}
    return _dc_effects


def get_dc_effect(dc_name: str) -> Optional[Dict[str, Any]]:
    """Look up a DC's effects, falling back to the name with bracket suffixes stripped.

    Mirrors `src/game/dc-helpers.js:getDcEffect` — tries the raw name first,
    then `dc_name.replace(/\\s*\\[.*\\]\\s*$/, '')`. Returns None if neither
    lookup hits. A None-safe `dc_name` also returns None.
    """
    effects = get_dc_effects()
    if not dc_name:
        return None
    hit = effects.get(dc_name)
    if hit is not None:
        return hit
    import re
    stripped = re.sub(r'\s*\[.*\]\s*$', '', dc_name)
    return effects.get(stripped)
