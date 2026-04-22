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


# ---------------------------------------------------------------------------
# Registry install

register('Reinforcements', _cc_reinforcements)
register('Hold On', _cc_hold_on)
register('Hit the Deck', _cc_hit_the_deck)
register('Rally', _cc_rally)
register('Take Initiative', _cc_take_initiative)


def registered_cc_effects() -> list:
    """List all currently-registered CC effect names (for coverage tracking)."""
    return sorted(_CC_EFFECTS.keys())
