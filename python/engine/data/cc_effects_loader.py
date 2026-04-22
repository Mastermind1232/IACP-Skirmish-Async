"""D7.5 — data/cc-effects.json loader.

Mirrors dc_effects_loader shape. JS analogue: `getCcEffects()` in
`src/data-loader.js`. The JSON file is `{source, cards}`; we unwrap to
`.cards`, byte-identical to JS.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
CC_EFFECTS_PATH = REPO_ROOT / 'data' / 'cc-effects.json'

_cc_effects: Optional[Dict[str, Any]] = None


def reset_cache() -> None:
    global _cc_effects
    _cc_effects = None


def get_cc_effects() -> Dict[str, Any]:
    """Return the CC-effects dict keyed by CC name."""
    global _cc_effects
    if _cc_effects is None:
        with open(CC_EFFECTS_PATH, 'r') as f:
            raw = json.load(f)
        _cc_effects = raw.get('cards', {}) if isinstance(raw, dict) else {}
    return _cc_effects
