"""D3.7 + D3.9 + D3.14 — Pure-engine fire-site helper for combat-declare Pattern D.

The JS firing site lives in `src/handlers/combat.js:1626-1879` inside
`handleAttackTarget()`. It's a 250-line linear sequence of
`if (atkSpecialIds.includes('<ability_id>')) { ... }` blocks and
`if (defSpecialIds.includes('<ability_id>')) { ... }` blocks that fire
BEFORE the dice are rolled, mutating `game.pendingCombat` fields
(`attackInfo.dice`, `bonusHits`, `bonusEvade`, `bonusBlock`,
`bonusPierce`, `surgeBonus`, ...) and, as of D3.9, also mutating defender
health state via `applyStrainToFigure`. D3.14 adds defender-side ability
firing via `defSpecialIds`; the fire-site helper walks attacker's list
first (preserving D3.7/D3.9/D3.12 registration order) and then the
defender's list after.

This module distils the firing site into a pure-engine function: no
Discord, no async, no thread.send. The caller (ORACLE today, D4 handler
tomorrow) supplies:

  - `game`                  the game-state dict (for `figureConditions`
                            mutations; also carries `gameId` for
                            defender-side `findDcMessageIdForFigure` lookups)
  - `combat`                the pendingCombat dict (mutated in place)
  - `attacker_special_ids`  the attacker DC's `specialAbilityIds` list — passed
                            explicitly instead of re-deriving from game state
                            so the helper is independent of DC-loader wiring
  - `attacker_figure_key`
  - `defender_special_ids`  (D3.14, optional) the defender DC's
                            `specialAbilityIds` list. When omitted or empty,
                            no defender walk runs — back-compat with pre-D3.14
                            callers that only threaded attacker-side state.
  - `ctx` — numeric gates AND (D3.9) defender-side lookups:
      - **Numeric gates** (D3.7, attacker-side):
        - `distance_to_target`        int
        - `attacker_damage_suffered`  int (HP-based gates for full_of_rage)
        - `is_ranged`                 bool (D3.14: consumed by gamorrean_honor_guard)
      - **Defender-side lookups** (D3.9, Relentless family; D3.14, exploit_weakness):
        - `defender_figure_key`       str   — target figure key
        - `defender_player_num`       int   — target's player
        - `dc_health_state`           dict  — {msgId: [[hp, max], ...]}
        - `dc_message_meta`           dict  — {msgId: {dcName, playerNum,
                                                 gameId, displayName, ...}}

The defender-side ctx keys are not relentless-specific — every future
defender-side combat-declare handler (`exploit_weakness`, `distracting_*`,
`conclusion`, etc.) will read the same four keys. Introducing them now
with the first family that needs them is the minimum plumbing to make
D3.9 work AND set up the next passes without re-threading ctx.

Fail-loud semantics (same contract as D3.6 trigger bus):

  - For every ability in `attacker_special_ids` that is Pattern D and
    registered under `combat-declare`:
      - If a REAL handler is registered → fire it.
      - If a STUB handler is registered → raise `TriggerNotImplemented`.
  - Non-combat-declare or non-Pattern-D abilities in the list are ignored
    (silently skipped) — they're handled by other JS code paths (Pattern A
    stat-deltas, Pattern C passives, other triggers), or are not our concern.

Why the stub path raises: the Python engine MUST NOT silently no-op on
abilities the JS engine fires. If `scattergun` is on an attacker DC and our
handler is a stub, running the attack in Python produces different behavior
from JS — exactly the parity violation the trigger bus exists to prevent.
Oracles control the attacker DCs; anything with a stub on combat-declare is
explicitly out-of-scope for the test.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from python.engine.abilities.classify import classify_ability
from python.engine.abilities.pattern_d import (
    TriggerNotImplemented,
    get_handler_for,
    is_stub,
)
from python.engine.data.ability_library_loader import get_ability


def _is_combat_declare_pattern_d(ability_id: str) -> bool:
    """True iff this ability classifies as Pattern D AND fires inside JS `handleAttackTarget()`.

    The JS fire site at `src/handlers/combat.js:1626-1879` fires BOTH
    `combat-declare` and `combat-defense` Pattern D abilities in the same
    imperative `if` ladder (attacker-side block first, defender-side second).
    The library trigger distinction (camelCase/semantic) doesn't change where
    JS fires them; this helper's filter must accept both so the Python port's
    fire-site helper walks the exact same population JS does.

    Abilities with library trigger `combat-defense` that JS fires here:
      - Four D3.14 handlers (disposable, cortosis_weave, gamorrean_honor_guard,
        composite_plating) — real handlers post-D3.14.
      - Four still-stubbed (protector, sentinel, keep_the_peace_elite,
        keep_the_peace_reg) — raise `TriggerNotImplemented` via their
        D3.6 bus stubs when walked (fail-loud preserved).

    Uses the live ability library + the D3.1 classifier. Returns False for
    unknown IDs (defensive — the JS side also silently ignores IDs not in its
    ability dispatch table).
    """
    entry = get_ability(ability_id)
    if entry is None:
        return False
    try:
        pattern, _ = classify_ability(ability_id, entry)
    except Exception:
        return False
    if pattern != 'D':
        return False
    return entry.get('trigger') in ('combat-declare', 'combat-defense')


def fire_combat_declare_triggers(game: Dict[str, Any],
                                 combat: Dict[str, Any],
                                 attacker_special_ids: Iterable[str],
                                 attacker_figure_key: str,
                                 ctx: Optional[Dict[str, Any]] = None,
                                 defender_special_ids: Optional[Iterable[str]] = None,
                                 ) -> List[Dict[str, Any]]:
    """Walk attacker's specialAbilityIds then defender's specialAbilityIds.

    Fires in the order the abilities appear in each list (mirrors JS — the
    JS firing site is an imperative `if` ladder where attacker-side blocks
    run first and defender-side blocks run after). Mutates `game`
    (conditions) and `combat` (attackInfo, bonus* fields) in place. Returns
    a list of `{ability_id, applied, log_message, ...}` dicts — one entry
    per fired handler, including the skipped (gated-off) ones so the oracle
    can assert on the firing record.

    The D3.14 defender walk reuses the same classifier + dispatch machinery
    as the attacker walk; the only semantic difference is who owns the
    `specialAbilityIds` list. Defender-side ctx keys (`defender_figure_key`,
    `defender_player_num`, `dc_health_state`, `dc_message_meta`) are
    threaded through `ctx` identically for both walks.

    Raises `TriggerNotImplemented` if any ability in either list is a
    Pattern D combat-declare stub (no real handler yet). Intentional: this
    is the fail-loud gate that keeps the Python engine honest about coverage.
    """
    ctx_full: Dict[str, Any] = {
        **(ctx or {}),
        'combat': combat,
        'attacker_figure_key': attacker_figure_key,
        'trigger': 'combat-declare',
    }

    results: List[Dict[str, Any]] = []

    def _walk(ability_ids: Iterable[str]) -> None:
        for ability_id in list(ability_ids or []):
            if not _is_combat_declare_pattern_d(ability_id):
                continue
            info = get_handler_for(ability_id)
            if info is None:
                from python.engine.abilities.pattern_d import UnregisteredPatternD
                raise UnregisteredPatternD(ability_id)
            _trigger, handler = info
            if is_stub(handler):
                raise TriggerNotImplemented(ability_id, 'combat-declare')
            res = handler(game, ability_id, ctx_full)
            results.append({'ability_id': ability_id, **(res or {})})

    # Attacker walk first (D3.7 + D3.9 + D3.12 + D3.14 attacker-side).
    _walk(attacker_special_ids)
    # Defender walk second (D3.14 defender-side).
    if defender_special_ids:
        _walk(defender_special_ids)

    return results
