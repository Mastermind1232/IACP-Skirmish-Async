"""CC effect resolver + per-card handler registry (C5-D skeleton).

When PLAY_CC or CC_CONFIRM_PLAY completes, it sets
game.pendingCcEffect = {cardName, playerNum, timing, playableBy, dcName}.
The game loop then calls `resolve_pending_cc_effect(game, ctx)` to apply
the card's actual state change.

Per-card effect handlers register into the _CC_EFFECTS dict keyed by
card name. Each handler takes (game, pending, ctx) and returns a dict
describing the outcome. Unknown cards raise `UnknownCcEffect` so the
caller knows the coverage gap is explicit, not silent.

Scope of this skeleton (5 representative cards — rest is batch grind
in Phase 5-D):
  - 'Reinforcements' — draw 3 CCs
  - 'Hold On' — add Focus to a target figure
  - 'Hit the Deck' — add Hide to a target figure
  - 'Rally' — remove one condition from a target figure
  - 'Take Initiative' — transfer initiative
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional


class UnknownCcEffect(KeyError):
    """Raised when a pending CC has no registered effect handler."""


_CC_EFFECTS: Dict[str, Callable[[Any, Dict[str, Any], Dict[str, Any]], Dict[str, Any]]] = {}


def register(card_name: str, handler: Callable) -> None:
    if card_name in _CC_EFFECTS:
        raise ValueError(f'duplicate cc effect handler for {card_name!r}')
    _CC_EFFECTS[card_name] = handler


def resolve_pending_cc_effect(game: Any, ctx: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Dispatch game.pendingCcEffect to its per-card handler.

    Returns the handler's result dict. Clears pendingCcEffect on success.
    Raises UnknownCcEffect if no handler is registered.
    """
    data = game.data if hasattr(game, 'data') else game
    pending = data.get('pendingCcEffect')
    if not pending:
        return {'applied': False, 'reason': 'no_pending_cc_effect'}
    card_name = pending.get('cardName')
    if not card_name:
        raise ValueError('resolve_pending_cc_effect: pendingCcEffect missing cardName')
    handler = _CC_EFFECTS.get(card_name)
    if handler is None:
        raise UnknownCcEffect(card_name)
    result = handler(game, dict(pending), ctx or {})
    data['pendingCcEffect'] = None
    data['lastCcEffectResult'] = {'cardName': card_name, 'result': result}
    return result


# ---------------------------------------------------------------------------
# Built-in per-card handlers (C5-D seed)

def _apply_condition_to_target(game: Any, target_fk: str, condition: str) -> bool:
    """Add `condition` to the target figure's condition list (dedupe)."""
    from python.engine.mechanics.conditions import apply_condition
    return apply_condition(game, target_fk, condition)


def _cc_reinforcements(game: Any, pending: Dict[str, Any],
                       ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Reinforcements: draw 3 CCs. Once per SoR."""
    from python.engine.cards.deck import draw_with_reshuffle

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    if player_num not in (1, 2):
        raise ValueError('reinforcements: pending missing playerNum')
    drew = draw_with_reshuffle(game, player_num, 3)
    data['reinforcementsPlayedThisSor'] = True
    return {'applied': True, 'drew': drew}


def _cc_hold_on(game: Any, pending: Dict[str, Any],
                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Hold On: gain Focus on target figure.

    ctx must supply target_figure_key.
    """
    target_fk = (ctx or {}).get('target_figure_key') or pending.get('targetFigureKey')
    if not target_fk:
        raise ValueError('hold_on: requires target_figure_key in ctx')
    added = _apply_condition_to_target(game, target_fk, 'Focus')
    return {'applied': True, 'conditionAdded': added, 'targetFigureKey': target_fk}


def _cc_hit_the_deck(game: Any, pending: Dict[str, Any],
                     ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Hit the Deck: target figure gains Hide."""
    target_fk = (ctx or {}).get('target_figure_key') or pending.get('targetFigureKey')
    if not target_fk:
        raise ValueError('hit_the_deck: requires target_figure_key in ctx')
    added = _apply_condition_to_target(game, target_fk, 'Hide')
    return {'applied': True, 'conditionAdded': added, 'targetFigureKey': target_fk}


def _cc_rally(game: Any, pending: Dict[str, Any],
              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Rally: remove one chosen condition from target figure.

    ctx must supply target_figure_key + condition.
    """
    from python.engine.mechanics.conditions import filter_condition

    target_fk = (ctx or {}).get('target_figure_key') or pending.get('targetFigureKey')
    condition = (ctx or {}).get('condition') or pending.get('condition')
    if not target_fk or not condition:
        raise ValueError('rally: requires target_figure_key + condition in ctx')
    filter_condition(game, target_fk, condition)
    return {
        'applied': True,
        'targetFigureKey': target_fk,
        'conditionRemoved': condition,
    }


def _cc_take_initiative(game: Any, pending: Dict[str, Any],
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Take Initiative: swap initiative to the playing player for next round.

    Sets game.initiativeSwapNextRound = {toPlayerNum}.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    data['initiativeSwapNextRound'] = {'toPlayerNum': player_num}
    return {'applied': True, 'toPlayerNum': player_num}


def _cc_blitz(game: Any, pending: Dict[str, Any],
              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Blitz: +1 Surge to attack results (active pendingCombat)."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    combat_mut = dict(combat)
    combat_mut['bonusSurges'] = int(combat_mut.get('bonusSurges') or 0) + 1
    data['pendingCombat'] = combat_mut
    return {'applied': True, 'bonusSurgesAdded': 1}


def _cc_advance_warning(game: Any, pending: Dict[str, Any],
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Advance Warning: self and an adjacent friendly each gain 1 MP.

    Requires ctx.msg_id (self DC) + ctx.adjacent_msg_id (the chosen
    adjacent friendly DC).
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank

    msg_id = (ctx or {}).get('msg_id')
    adjacent_msg_id = (ctx or {}).get('adjacent_msg_id')
    if not msg_id:
        raise ValueError('advance_warning: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 1)
    if adjacent_msg_id:
        grant_movement_bank(game, adjacent_msg_id, 1)
    return {
        'applied': True,
        'selfMsgId': msg_id,
        'adjacentMsgId': adjacent_msg_id,
    }


def _cc_battle_scars(game: Any, pending: Dict[str, Any],
                     ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Battle Scars: grant 1 Power Token; 2 if figure suffered ≥3 damage
    during the activation. Target type comes from ctx.token_type (defaults
    to 'Surge' — caller should prompt via POWER_TOKEN_CHOICE).
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('battle_scars: requires ctx.figure_key')
    damage_this_activation = int(
        ((data.get('figureDamageThisActivation') or {}).get(figure_key)) or 0
    )
    token_count = 2 if damage_this_activation >= 3 else 1
    token_type = (ctx or {}).get('token_type', 'Surge')
    grant_power_tokens(data, figure_key, token_type, token_count)
    return {
        'applied': True,
        'figureKey': figure_key,
        'tokenType': token_type,
        'count': token_count,
    }


def _cc_blaze_of_glory(game: Any, pending: Dict[str, Any],
                       ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Blaze of Glory: ready a DC (remove from activatedDcIndices). The
    3-damage cost is queued as game.blazeOfGloryEorDamage for EoR.

    Requires ctx.target_msg_id (the DC to re-ready).
    """
    from python.engine.mechanics.player_helpers import (
        get_activated_dc_indices, set_activated_dc_indices,
    )

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    target_msg_id = (ctx or {}).get('target_msg_id')
    if player_num not in (1, 2) or not target_msg_id:
        raise ValueError('blaze_of_glory: requires pending.playerNum + ctx.target_msg_id')

    ids_list = (
        data.get('p1DcMessageIds') if player_num == 1
        else data.get('p2DcMessageIds')
    ) or []
    if target_msg_id not in ids_list:
        return {'applied': False, 'reason': 'target_not_in_dc_list'}
    idx = ids_list.index(target_msg_id)
    activated = get_activated_dc_indices(game, player_num) or []
    if idx in activated:
        set_activated_dc_indices(
            game, player_num, [i for i in activated if i != idx],
        )
    # Queue 3-damage end-of-round penalty on the DC that played Blaze of Glory
    data['blazeOfGloryEorDamage'] = {
        'msgId': target_msg_id,
        'playerNum': player_num,
        'amount': 3,
    }
    return {'applied': True, 'readiedMsgId': target_msg_id, 'eorDamageQueued': 3}


# ---------------------------------------------------------------------------
# Registry install

register('Reinforcements', _cc_reinforcements)
register('Hold On', _cc_hold_on)
register('Hit the Deck', _cc_hit_the_deck)
register('Rally', _cc_rally)
register('Take Initiative', _cc_take_initiative)
register('Blitz', _cc_blitz)
register('Advance Warning', _cc_advance_warning)
register('Battle Scars', _cc_battle_scars)
register('Blaze of Glory', _cc_blaze_of_glory)


def registered_cc_effects() -> list:
    """List all currently-registered CC effect names (for coverage tracking)."""
    return sorted(_CC_EFFECTS.keys())
