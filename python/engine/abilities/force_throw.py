"""D3.11 — Pattern E.16 Force Throw chain handler (back-compat shim).

As of D3.15 the real dispatch logic lives in `push_target_within_range.py`,
where a single data-driven `handle_push_target_within_range` covers
`force_throw`, `wrist_cord`, and `mandalorian_whip` by reading each ability's
`pushTargetWithinRange` + `pushLandingEffect` + side-effect fields from the
library. This module preserves the D3.11 `handle_force_throw` name as a thin
alias so existing importers (pattern_e.py registry, D3.11 oracle, future
D4 wiring) continue to resolve without code change.

JS parity unchanged: the generalized handler reproduces Force Throw's
original behavior byte-identically when invoked with `ability_id='force_throw'`.
See the generalized module's docstring for the library field contract and
JS site pins (`src/game/abilities.js:296-452`).
"""
from __future__ import annotations

from python.engine.abilities.push_target_within_range import (
    handle_push_target_within_range as handle_force_throw,
)

__all__ = ['handle_force_throw']
