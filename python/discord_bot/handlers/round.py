"""Round Discord handler — mirror of src/handlers/round.js.

Handles the end-of-round and start-of-round window buttons:
  - end_end_of_round_{gameId}      → END_END_OF_ROUND (advance to next round)
  - end_start_of_round_{gameId}    → END_START_OF_ROUND (close SoR window)

Each wraps the stepper action with logging + returns the new round
state for the bot layer to re-render the round banner.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from python.discord_bot.handlers import register
from python.discord_bot.messages.updaters import format_log_line
from python.engine.actions import ActionType


def _cid(interaction):
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    return (
        getattr(interaction, 'customId', None)
        or getattr(interaction, 'custom_id', None)
        or ''
    )


def _uid(interaction):
    user = getattr(interaction, 'user', None)
    if user is not None:
        uid = getattr(user, 'id', None)
        if uid is not None:
            return str(uid)
    return ''


def _resolve_game(ctx, game_id):
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _handle_end_end_of_round(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """'end_end_of_round_{gameId}' → advance round, reset per-round state."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('end_end_of_round_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('end_end_of_round_'):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.END_END_OF_ROUND, player=0),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()

    data = new_game.data if hasattr(new_game, 'data') else new_game
    round_num = data.get('round') or data.get('currentRound') or 1
    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line(f'→ Round {round_num} begins.',
                             phase='ROUND', icon='round'), {})
    return {
        'ok': True, 'game': new_game, 'round': round_num,
        'phase': data.get('phase'),
        'roundPhase': data.get('roundPhase'),
    }


def _handle_end_start_of_round(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """'end_start_of_round_{gameId}' → close SoR window, run mission SoR rules."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('end_start_of_round_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('end_start_of_round_'):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    user_id = _uid(interaction)
    data = game.data if hasattr(game, 'data') else game
    sor_holder = data.get('startOfRoundWhoseTurn')
    if sor_holder and user_id and user_id != str(sor_holder):
        return {'ok': False, 'reason': 'not_sor_holder'}

    try:
        new_game = step(
            game, Action(type=ActionType.END_START_OF_ROUND, player=1),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()
    data2 = new_game.data if hasattr(new_game, 'data') else new_game
    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line('→ Activation phase begins.',
                             phase='ROUND', icon='round'), {})
    return {
        'ok': True, 'game': new_game,
        'startOfRoundWhoseTurn': data2.get('startOfRoundWhoseTurn'),
        'roundPhase': data2.get('roundPhase'),
    }


register('end_end_of_round_', _handle_end_end_of_round, 'round')
register('end_start_of_round_', _handle_end_start_of_round, 'round')
