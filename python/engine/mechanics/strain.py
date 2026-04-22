"""D2.26 — Strain application (pure-engine subset).

Byte-identical port of the *pure math* from
`src/handlers/combat.js:applyStrainToFigure`. Strain in IA is HP damage — no
separate counter — so application is a direct `reduce_hp` call plus the
Fireproof immunity gate.

The JS handler adds a lot of Discord-UI branching around the core math:
  - Pending `strainChoice` prompt (player picks HP vs CC-discard).
  - Headhunter reduce-by-1 + opponent-CC-discard side effect.
  - Under Duress deplete-prompt (opponent takes control of the choice).
  - Submit or Fight (Paz Vizsla) heal-from-discard side effect.

All of those require handler/UI wiring and CC-deck state mutation under live
Discord interactions — they land in D3/D4. This module intentionally covers
only the pure-engine subset: Fireproof gate + direct HP reduction + defeat
signal. Callers feed the returned `defeated` flag into the defeat pipeline
(D2.29) to complete the HP ≤ 0 → remove-figure path.

State shape reads:
    game['p1DcAttachments'] / game['p2DcAttachments']   dict[msgId, list[str]]
        # Attachment names per DC; checked for "Flame Trooper" (Fireproof).

Co-located dedicated constants — the Flame Trooper upgrade string is the only
card name the pure-engine path gates on.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from python.engine.mechanics.card_names import card_name_includes
from python.engine.mechanics.damage_helpers import reduce_hp

FLAME_TROOPER = 'Flame Trooper'
"""Name of the SU DC whose Fireproof trait immunises strain."""


def _fireproof(game: Dict[str, Any], msg_id: str) -> bool:
    """Check whether the DC at `msg_id` has the Flame Trooper attachment.

    Either player's attachment map may hold the DC (the JS code also unions
    them), so we check both. Returns False when neither map has the msgId.
    """
    p1 = (game.get('p1DcAttachments') or {}).get(msg_id) or []
    p2 = (game.get('p2DcAttachments') or {}).get(msg_id) or []
    return card_name_includes(p1, FLAME_TROOPER) or card_name_includes(p2, FLAME_TROOPER)


def apply_strain_to_figure(dc_health_state: Dict[str, List[List[int]]],
                           game: Dict[str, Any],
                           msg_id: str,
                           figure_index: int,
                           figure_key: Optional[str],
                           player_num: int,
                           amount: int) -> Dict[str, Any]:
    """Apply `amount` strain as HP damage to a figure.

    Returns a flat dict describing the outcome:
      - `fireproof` (bool) — True if strain was blocked by Flame Trooper.
      - `applied` (int)    — actual HP reduction (0 when fireproof or amount≤0).
      - `prevHp` (int)     — HP before reduction.
      - `newHp` (int)      — HP after reduction (clamped ≥ 0).
      - `defeated` (bool)  — True when newHp ≤ 0; caller is responsible for
        feeding this into `process_figure_defeat` (D2.29).

    Early-returns (all fields zero/False) for:
      - `amount <= 0`
      - Unknown msgId or missing health state
      - Figure already at 0 HP (defeated flag is *not* propagated back here
        — matches JS which silently no-ops)
      - `figureKey` is falsy — matches the JS `!msgId` / `!figMatch` guards
    """
    result = {
        'fireproof': False,
        'applied': 0,
        'prevHp': 0,
        'newHp': 0,
        'defeated': False,
    }
    if amount <= 0 or not msg_id or not figure_key:
        return result

    if _fireproof(game, msg_id):
        result['fireproof'] = True
        return result

    health = reduce_hp(dc_health_state, game, msg_id, figure_index, amount, player_num)
    result['prevHp'] = health['prevHp']
    result['newHp'] = health['newHp']
    result['applied'] = health['prevHp'] - health['newHp']
    result['defeated'] = health['wasDefeated']
    return result
