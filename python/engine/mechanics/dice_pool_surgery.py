"""D3.12 — shared dice-pool surgery primitive.

Pure-engine port of the JS `pendingCombat.attackInfo.dice` mutation pattern
that several Pattern D combat-declare abilities share. Each JS site does:

    const dice = game.pendingCombat.attackInfo.dice || [];
    const idx  = dice.findIndex(<per-ability predicate>);
    if (idx >= 0) {
        const newDice = [...dice];
        newDice[idx] = <replacement color, typically 'red'>;
        game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo,
                                          dice: newDice };
    }

Three combat-declare handlers consume this primitive today (D3.12):

  - `shock_and_awe`  — `selector = (c == 'yellow')`, replacement = 'red',
                        once-per-round sticky gate on `attackerFigureKey +
                        '_shock_and_awe'` (JS `combat.js:1740-1755`).
  - `vanguard`       — `selector = (c != 'red')`, replacement = 'red',
                        distance-to-target ≤ 3 gate (JS `combat.js:1757-1767`).
  - `front_line`     — `selector = (c == 'blue')`, replacement = 'red',
                        distance-to-target ≤ 3 gate (JS `combat.js:1845-1855`).

The primitive is intentionally selector-agnostic and replacement-agnostic —
it does not hardcode 'red' or any colour predicate — so future reactive /
attack-modification handlers that swap any-colour-for-any-colour can reuse
it unchanged (e.g. "upgrade 1 blue to yellow", "downgrade 1 red to green").

Identity semantics mirror JS exactly:
  - A NEW `dice` list is built via `list(dice)` + index assignment (preserves
    the "cloned array" invariant the JS `[...dice]` spread enforces).
  - A NEW `attackInfo` dict is written back via `{**attack_info, 'dice':
    new_dice}` (mirrors JS `{ ...attackInfo, dice: newDice }`).
  - `combat` identity is preserved (same dict); only `combat['attackInfo']` is
    reassigned. Consumers that hold a stale reference to the prior
    `attackInfo` do NOT see the swap (matches JS).
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional


def replace_die_in_pool(combat: Dict[str, Any],
                        selector: Callable[[str], bool],
                        replacement: str) -> Dict[str, Any]:
    """Find the first die in `combat.attackInfo.dice` matching `selector` and
    swap it for `replacement`.

    Byte-identical to JS `findIndex` + spread-clone + splice pattern. No
    mutation occurs if either the pool is empty or no die matches.

    Returns:
        {applied: bool, replaced_color: Optional[str], index: int}
            - applied        True iff a die was found and replaced
            - replaced_color the colour of the matched die before the swap,
                             or None when no match
            - index          0-based index of the replaced die, or -1 when no
                             match (mirrors JS `findIndex` -1 sentinel)
    """
    attack_info: Dict[str, Any] = combat.get('attackInfo') or {}
    dice: List[str] = attack_info.get('dice') or []
    for idx, color in enumerate(dice):
        if selector(color):
            new_dice = list(dice)
            new_dice[idx] = replacement
            combat['attackInfo'] = {**attack_info, 'dice': new_dice}
            return {'applied': True, 'replaced_color': color, 'index': idx}
    return {'applied': False, 'replaced_color': None, 'index': -1}


def is_once_per_round_used(game: Dict[str, Any], key: str) -> bool:
    """Read the round-sticky flag JS writes at
    `game.roundFigureAbilityUsed[key]`. Returns False if the map is absent
    (mirrors the JS `!game.roundFigureAbilityUsed?.[key]` optional-chain
    check).
    """
    used: Optional[Dict[str, Any]] = game.get('roundFigureAbilityUsed')
    if not used:
        return False
    return bool(used.get(key))


def mark_once_per_round_used(game: Dict[str, Any], key: str) -> None:
    """Port of the JS lazy-init:
        if (!game.roundFigureAbilityUsed) game.roundFigureAbilityUsed = {};
        game.roundFigureAbilityUsed[key] = true;

    Preserves the round-flag dict identity when it already exists so
    `ROUND_OBJECT_FLAGS` reset-to-`{}` pattern (D2.29 / `activation-state.js`)
    keeps working.
    """
    used = game.get('roundFigureAbilityUsed')
    if used is None:
        used = {}
        game['roundFigureAbilityUsed'] = used
    used[key] = True
