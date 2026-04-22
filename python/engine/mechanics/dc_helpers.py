"""DC lookup helpers — byte-identical port of the subset of
`src/game/dc-helpers.js` that D2.24–2.29 actually reach.

Scope: the pure figure-key → DC-name parse (`dc_name_from_figure_key`,
`parse_figure_key`) and the power-token capacity lookup
(`get_max_power_tokens`, which checks `locked_and_loaded` in
specialAbilityIds). The Discord-only helpers (image paths, button label
builders) are deferred until the relevant handler slice.

No Discord dependency. Safe to import from any mechanics module.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional

from python.engine.data.dc_effects_loader import get_dc_effect

_FIGURE_KEY_SUFFIX = re.compile(r'-\d+-\d+$')
_FIGURE_KEY_SPLIT = re.compile(r'-(\d+)-(\d+)$')


def dc_name_from_figure_key(figure_key: Optional[str]) -> str:
    """Extract the base DC name from a figure key.

    "Darth Vader-1-0" → "Darth Vader". Returns empty string for falsy input.
    Mirrors `dc-helpers.js:dcNameFromFigureKey`.
    """
    if not figure_key:
        return ''
    return _FIGURE_KEY_SUFFIX.sub('', figure_key)


def parse_figure_key(figure_key: Optional[str]) -> Dict[str, int]:
    """Parse a figure key into `{dgIndex, figureIndex}`.

    Defaults to `{dgIndex: 1, figureIndex: 0}` when the pattern doesn't match.
    Mirrors `dc-helpers.js:parseFigureKey`.
    """
    if not figure_key:
        return {'dgIndex': 1, 'figureIndex': 0}
    m = _FIGURE_KEY_SPLIT.search(figure_key)
    if not m:
        return {'dgIndex': 1, 'figureIndex': 0}
    return {'dgIndex': int(m.group(1)), 'figureIndex': int(m.group(2))}


def get_max_power_tokens(figure_key: Optional[str]) -> int:
    """Return the per-figure maximum Power Tokens.

    Default 2; Migs Mayfeld's "Locked and Loaded" (specialAbilityIds contains
    `locked_and_loaded`) raises it to 3. Mirrors `dc-helpers.js:getMaxPowerTokens`.
    """
    if not figure_key:
        return 2
    dc_name = dc_name_from_figure_key(figure_key)
    eff = get_dc_effect(dc_name) or {}
    s_ids = eff.get('specialAbilityIds') or []
    if 'locked_and_loaded' in s_ids:
        return 3
    return 2
