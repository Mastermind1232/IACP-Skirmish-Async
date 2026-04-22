"""D2.16 — dice.json + dice-face-outcomes.json loaders.

JS analogue: `getDiceData()` + `getDiceFaceOutcomes()` in `src/data-loader.js`.
Mirrors the JS shape exactly: `{attack: {red/yellow/green/blue: [6 faces]},
defense: {white/black: [6 faces]}}`. Faces are dicts matching the JS keys
(`acc`/`dmg`/`surge` for attack; `block`/`evade`/`dodge?` for defense).

Module-level cache — first load hits disk, subsequent calls return the cached
dict. Tests that need a clean slate can call `reset_cache()`.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
DICE_PATH = REPO_ROOT / 'data' / 'dice.json'
OUTCOMES_PATH = REPO_ROOT / 'data' / 'dice-face-outcomes.json'

_dice_data: Optional[Dict[str, Any]] = None
_face_outcomes: Optional[Dict[str, Any]] = None


def reset_cache() -> None:
    """Drop the module-level caches (for test determinism)."""
    global _dice_data, _face_outcomes
    _dice_data = None
    _face_outcomes = None


def get_dice_data() -> Dict[str, Any]:
    """Return the parsed contents of data/dice.json.

    Shape:
        {
          'attack':  {'red': [...6 faces], 'yellow': [...], 'green': [...], 'blue': [...]},
          'defense': {'white': [...6 faces], 'black': [...]}
        }
    Attack face: {'acc': int, 'dmg': int, 'surge': int}
    Defense face: {'block': int, 'evade': int} with optional {'dodge': True}
    """
    global _dice_data
    if _dice_data is None:
        with open(DICE_PATH, 'r') as f:
            _dice_data = json.load(f)
    return _dice_data


def get_dice_face_outcomes() -> Dict[str, Any]:
    """Return the parsed contents of data/dice-face-outcomes.json (display text)."""
    global _face_outcomes
    if _face_outcomes is None:
        with open(OUTCOMES_PATH, 'r') as f:
            _face_outcomes = json.load(f)
    return _face_outcomes


def attack_faces(color: str) -> List[Dict[str, int]]:
    """Return the 6 face dicts for an attack color; empty list if unknown."""
    return get_dice_data().get('attack', {}).get(color.lower(), [])


def defense_faces(color: str) -> List[Dict[str, Any]]:
    """Return the 6 face dicts for a defense color; empty list if unknown."""
    return get_dice_data().get('defense', {}).get(color.lower(), [])
