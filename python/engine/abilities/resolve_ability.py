"""Top-level ability resolution. JS-shape contract.

Mirrors `resolveAbility` in src/game/abilities.js (2-arg call:
ability_id, context). Returns the JS-shape result dict:

  - applied: bool
  - manualMessage: str | None
  - logMessage: str | None
  - requiresChoice: bool (when chooseOne with no choice_index)
  - choiceOptions: List[str] (when requiresChoice)
  - choiceCount: int (when requiresChoice)
  - requiresSpaceChoice: bool
  - validSpaces: List[str] (when requiresSpaceChoice)
  - freeAction: bool
  - drewCards: List[str]
  - refreshDcEmbed / refreshDiscard: bool

Internally fans out to:
  - Surge entries → manual fallback (surges resolve in step_surge).
  - ccEffect informational → log-only success.
  - chooseOne (no choice_index) → requiresChoice prompt.
  - chooseOne (choice_index set) → resolve chosen sub-entry.
  - Pattern A/B/C/D/E → python.engine.abilities.dispatch.resolve.

The Python pattern dispatcher already covers 293 CC abilities and 333
DC abilities (verified 0-fail vs JS via cc_golden / ability_golden).
This module is the JS-shape adapter on top of that.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from python.engine.abilities.dispatch import (
    PatternNotImplemented,
    UnknownAbility,
    resolve as _resolve_pattern,
)
from python.engine.data.ability_library_loader import get_ability


def _manual_result(message: str = 'Resolve manually (see rules).',
                   ) -> Dict[str, Any]:
    return {'applied': False, 'manualMessage': message}


def _build_choose_one_prompt(entry: Dict[str, Any]) -> Dict[str, Any]:
    choices = entry.get('chooseOne') or []
    options: List[str] = [
        (c.get('label') if isinstance(c, dict) and c.get('label')
         else f'Option {i + 1}')
        for i, c in enumerate(choices)
    ]
    return {
        'applied': False,
        'requiresChoice': True,
        'choiceOptions': options,
        'choiceCount': len(options),
        'manualMessage': f"Choose one: {', '.join(options)}.",
    }


def resolve_ability(ability_id: Optional[str],
                    context: Optional[Dict[str, Any]] = None,
                    ) -> Dict[str, Any]:
    """Top-level ability resolution. JS-shape contract.

    Args:
      ability_id: Library ID or synthetic key (None / unknown → manual).
      context: dict with at minimum `game`. Optional: msg_id, meta,
        player_num, choice_index, card_name, special_label, figure_key.

    Returns:
      Result dict described in the module docstring.
    """
    if not ability_id:
        return _manual_result()

    entry = get_ability(ability_id)
    if entry is None:
        return _manual_result()

    # Surge entries resolve in step_surge, not here.
    if entry.get('type') == 'surge':
        return _manual_result()

    context = context or {}
    choice_index = context.get('choice_index')
    if choice_index is None:
        choice_index = context.get('choiceIndex')

    # ccEffect / dcSpecial chooseOne handling.
    choose_one = entry.get('chooseOne')
    if isinstance(choose_one, list) and choose_one:
        if choice_index is None or choice_index < 0 or choice_index >= len(choose_one):
            return _build_choose_one_prompt(entry)
        # Resolve chosen sub-entry: fold the chosen branch into the entry.
        chosen = choose_one[choice_index]
        if not isinstance(chosen, dict):
            return _manual_result()
        # Pass the merged sub-entry through pattern dispatch when it has
        # a recognized shape. For shapes JS handles inline (applyFocusToSelf,
        # nextAttackCleave, nextAttackReach), apply the simple state mutations.
        result = _apply_choose_one_branch(entry, chosen, context)
        if result is not None:
            return result

    # ccEffect informational / log-only entries.
    if entry.get('type') == 'ccEffect' and entry.get('informational'):
        msg = entry.get('logMessage') or entry.get('label') \
              or 'Resolve manually (see rules).'
        return {'applied': True, 'logMessage': msg}

    # Default: fan out to pattern dispatch.
    game = context.get('game')
    if game is None:
        return _manual_result()
    try:
        pattern_result = _resolve_pattern(game, ability_id, context)
    except UnknownAbility:
        return _manual_result()
    except PatternNotImplemented as e:
        return {'applied': False, 'manualMessage': str(e)}

    return _normalize_pattern_result(pattern_result, entry)


def _apply_choose_one_branch(entry: Dict[str, Any],
                             chosen: Dict[str, Any],
                             context: Dict[str, Any],
                             ) -> Optional[Dict[str, Any]]:
    """Apply the inline JS handlers for chooseOne sub-entries:
    applyFocusToSelf, nextAttackCleave, nextAttackReach. Returns the
    JS-shape result dict, or None when no inline handler matches (so
    the caller falls back to pattern dispatch).
    """
    game = context.get('game')
    msg_id = context.get('msg_id') or context.get('msgId')
    meta = context.get('meta') or {}
    player_num = context.get('player_num') or context.get('playerNum')
    parts: List[str] = []
    handled = False

    if not game:
        return None

    apply_focus = chosen.get('applyFocusToSelf')
    next_attack_cleave = chosen.get('nextAttackCleave')
    next_attack_reach = chosen.get('nextAttackReach')

    if apply_focus and meta and player_num:
        from python.engine.mechanics.conditions import apply_condition

        dc_name = meta.get('dcName')
        display_name = meta.get('displayName') or dc_name or ''
        # Find figure keys for this DC group.
        import re
        m = re.search(r'\[(?:DG|Group) (\d+)\]', display_name or '')
        dg_index = m.group(1) if m else '1'
        if dc_name:
            prefix = f'{dc_name}-{dg_index}-'
            data = game.data if hasattr(game, 'data') else game
            fp = (data.get('figurePositions') or {}).get(player_num) or {}
            for fk in fp:
                if isinstance(fk, str) and fk.startswith(prefix):
                    apply_condition(game, fk, 'Focus')
            parts.append('Became **Focused**')
            handled = True

    if isinstance(next_attack_cleave, int) and next_attack_cleave > 0 and player_num:
        data = game.data if hasattr(game, 'data') else game
        bonus = data.get('nextAttackBonusSurgeAbilities') or {}
        existing = list(bonus.get(player_num) or [])
        existing.append(f'cleave {next_attack_cleave}')
        bonus[player_num] = existing
        data['nextAttackBonusSurgeAbilities'] = bonus
        handled = True

    if next_attack_reach and player_num:
        data = game.data if hasattr(game, 'data') else game
        reach = data.get('nextAttackReach') or {}
        reach[player_num] = True
        data['nextAttackReach'] = reach
        handled = True

    if next_attack_reach or next_attack_cleave:
        cleave_val = int(next_attack_cleave or 0)
        reach_label = 'Reach + ' if next_attack_reach else ''
        parts.append(
            f'Next attack gains **{reach_label}Cleave {cleave_val}** '
            f'(attack targets up to 2 spaces away if Reach)'
        )

    if not handled:
        return None

    label = entry.get('label') or 'Choice'
    return {
        'applied': True,
        'logMessage': f'**{label}**: {" and ".join(parts)}.',
        'refreshDcEmbed': bool(apply_focus),
    }


def _normalize_pattern_result(pattern_result: Any,
                              entry: Dict[str, Any]) -> Dict[str, Any]:
    """Map the Pattern A/B/C/D/E handler result shape into the JS-shape
    contract used by Discord callers.
    """
    if not isinstance(pattern_result, dict):
        return _manual_result()

    out: Dict[str, Any] = {}
    # Treat any non-empty pattern result with `applied`-ish signal as success.
    applied_flag = pattern_result.get('applied')
    if applied_flag is None:
        # Pattern handlers that don't expose applied flag are treated as
        # success when they returned anything other than an obvious failure.
        applied_flag = not pattern_result.get('failed', False)
    out['applied'] = bool(applied_flag)

    for key in (
        'manualMessage', 'logMessage', 'requiresChoice', 'choiceOptions',
        'choiceCount', 'requiresSpaceChoice', 'validSpaces', 'freeAction',
        'grantsAction', 'drewCards', 'refreshDcEmbed', 'refreshDiscard',
    ):
        if key in pattern_result:
            out[key] = pattern_result[key]

    if 'manualMessage' not in out and not out['applied']:
        out['manualMessage'] = entry.get('label') or 'Resolve manually (see rules).'

    return out
