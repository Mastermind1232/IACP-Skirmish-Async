"""D2.24 + D2.25 — condition helpers.

Byte-identical port of `src/game/conditions.js`. Pure game-state operations on
`game.figureConditions` — no Discord dependency, no handler UI.

Conditions model the dedup + Weaken-lock rules from the JS engine. The IA
rulebook lists nine named conditions; only five are actually implemented in the
JS engine today (**Stun**, **Bleed**, **Focus**, **Hide**, **Weaken**). The
remaining four (Immobilize, Exposed, Disoriented, Hindered) are reserved
names — none of the JS code ever applies or reads them. The Python port mirrors
that reality: it's a string bag keyed on figureKey, no per-condition typing.
Apply any of the five real labels via `apply_condition(game, fk, 'Stun')`.

State shape:
    game['figureConditions']        dict[str, list[str]]  # figureKey → [cond, ...]
    game['disarmPermanentWeakened'] dict[str, bool]       # lock: Weaken can't be removed
    game['youWillNotDenyMeActive']  bool                  # Fifth Brother passive flag

D2.25 is the same module: `is_condition_immune` reads DC specialAbilityIds to
gate Onar Koma / Snowtrooper Elite / Fifth Brother (under YWNDM) from harmful
conditions.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from python.engine.data.dc_effects_loader import get_dc_effect
from python.engine.mechanics.dc_helpers import dc_name_from_figure_key

# ── Constants ───────────────────────────────────────────────────────────────

HARMFUL_CONDITIONS: Tuple[str, ...] = ('Stun', 'Bleed', 'Weaken')
"""Harmful conditions gated by `is_condition_immune`.

Mirrors `src/game/conditions.js:HARMFUL_CONDITIONS`. Focus and Hide are
beneficial and never gated."""


# ── D2.24 — applyCondition / applyConditionWithDie / filterCondition / reset

def apply_condition(game: Dict[str, Any], figure_key: str, cond: str) -> bool:
    """Apply a condition to a figure with dedup.

    Mirrors `conditions.js:applyCondition`. Initialises `figureConditions` and
    the per-figure list if missing. Returns True iff the condition was newly
    applied; False if already present on the figure.
    """
    game.setdefault('figureConditions', {})
    game['figureConditions'].setdefault(figure_key, [])
    if cond in game['figureConditions'][figure_key]:
        return False
    game['figureConditions'][figure_key].append(cond)
    return True


def apply_condition_with_die(game: Dict[str, Any],
                             figure_key: str,
                             condition: str,
                             attack_info: Dict[str, Any],
                             die_color: str) -> Dict[str, Any]:
    """Apply a condition and, if newly applied, append a bonus die to attack_info.

    Encodes the rule "become [Condition] → gain +1 [die color]". Mirrors
    `conditions.js:applyConditionWithDie`. Returns `{attackInfo, applied}`.
    The returned `attackInfo` is a shallow copy with an extended `dice` list
    — the input dict is not mutated (matches JS spread semantics).
    """
    if apply_condition(game, figure_key, condition):
        new_dice = list(attack_info.get('dice') or []) + [die_color]
        new_info = {**attack_info, 'dice': new_dice}
        return {'attackInfo': new_info, 'applied': True}
    return {'attackInfo': attack_info, 'applied': False}


def filter_condition(game: Dict[str, Any], figure_key: str, cond: str) -> None:
    """Remove a specific condition from a figure. No-op if not present.

    Respects the disarmPermanentWeakened lock: if `cond == 'Weaken'` and the
    figure has the Disarm lock, the call is a no-op. If the per-figure list
    becomes empty after removal, the key is deleted from `figureConditions` —
    matches the JS `delete` branch so round-trip equality with JS-produced
    state is preserved.
    """
    fc = game.get('figureConditions')
    if not fc or figure_key not in fc:
        return
    # Disarm permanent Weakened: skip removal of Weaken if the figure has the lock.
    if cond == 'Weaken':
        lock = game.get('disarmPermanentWeakened') or {}
        if lock.get(figure_key):
            return
    fc[figure_key] = [c for c in fc[figure_key] if c != cond]
    if not fc[figure_key]:
        del fc[figure_key]


def reset_condition(game: Dict[str, Any], figure_key: str, cond: str) -> None:
    """Ensure a condition is present exactly once on a figure.

    Removes any existing copies and appends once. Useful when a condition must
    be set regardless of prior state. Mirrors `conditions.js:resetCondition`.
    """
    game.setdefault('figureConditions', {})
    existing = game['figureConditions'].get(figure_key) or []
    game['figureConditions'][figure_key] = [c for c in existing if c != cond] + [cond]


# ── D2.25 — is_condition_immune ─────────────────────────────────────────────

def is_condition_immune(game: Dict[str, Any], figure_key: str) -> bool:
    """Check if a figure is immune to HARMFUL conditions (Stun/Bleed/Weaken).

    Mirrors `conditions.js:isConditionImmune`. Dynamic gates:
      - `immune_onar` in DC specialAbilityIds (Onar Koma).
      - `immune_snowtrooper_elite` in DC specialAbilityIds.
      - `game.youWillNotDenyMeActive` AND DC name contains "fifth brother"
        (Fifth Brother passive while YWNDM active).

    Returns False for any figure whose DC has none of the above.
    """
    dc_name = dc_name_from_figure_key(figure_key)
    dc_eff = get_dc_effect(dc_name) or {}
    s_ids = dc_eff.get('specialAbilityIds') or []
    if 'immune_onar' in s_ids or 'immune_snowtrooper_elite' in s_ids:
        return True
    if game.get('youWillNotDenyMeActive') and dc_name and 'fifth brother' in dc_name.lower():
        return True
    return False
