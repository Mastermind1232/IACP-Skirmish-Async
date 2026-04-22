"""Interact Discord handler — mirror of src/handlers/interact.js.

Wraps the stepper's INTERACT action with:
1. Resolution of customId → option_id (legal-option validation via
   board_helpers.get_legal_interact_options)
2. Dispatch through the stepper
3. Structured result for the bot layer to edit the interact prompt
   message + update the board render

The customId shape is:
    interact_choice_{gameId}_{msgId}_{figureIndex}_{optionId}

where optionId may itself contain underscores (e.g. 'open_door_a1|a2').
Parse carefully: the first 4 underscore-delimited parts are fixed, the
rest is the optionId joined by '_'.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from python.discord_bot.handlers import register
from python.discord_bot.messages.updaters import format_log_line
from python.engine.actions import ActionType


def _extract_custom_id(interaction: Any) -> str:
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    return (
        getattr(interaction, 'customId', None)
        or getattr(interaction, 'custom_id', None)
        or ''
    )


def _extract_user_id(interaction: Any) -> str:
    user = getattr(interaction, 'user', None)
    if user is not None:
        uid = getattr(user, 'id', None)
        if uid is not None:
            return str(uid)
    return str(
        getattr(interaction, 'userId', None)
        or getattr(interaction, 'user_id', None)
        or ''
    )


def _parse_interact_id(custom_id: str) -> Optional[Tuple[str, str, int, str]]:
    """Split 'interact_choice_{gameId}_{msgId}_{figureIdx}_{optionId}'.

    Returns (gameId, msgId, figureIdx, optionId) or None if malformed.
    Handles optionIds with embedded underscores via rsplit-style walk:
    gameId is segment 2, msgId is segment 3, figureIdx is segment 4, the
    rest joined on '_' is the option id.
    """
    if not custom_id.startswith('interact_choice_'):
        return None
    parts = custom_id.split('_')
    if len(parts) < 6:
        return None
    # parts[0] = 'interact', parts[1] = 'choice', parts[2] = gameId,
    # parts[3] = msgId, parts[4] = figureIndex, parts[5:] = option tokens
    game_id = parts[2]
    msg_id = parts[3]
    try:
        figure_idx = int(parts[4])
    except ValueError:
        return None
    option_id = '_'.join(parts[5:])
    if not option_id:
        return None
    return game_id, msg_id, figure_idx, option_id


def _resolve_figure_key(game: Any, msg_id: str, figure_idx: int) -> Optional[Tuple[str, int]]:
    """Look up (figure_key, player_num) from msgId + figureIndex."""
    data = game.data if hasattr(game, 'data') else game
    for pn in (1, 2):
        ids = data.get(f'p{pn}DcMessageIds') or []
        if msg_id in ids:
            dc_list = data.get(f'p{pn}DcList') or []
            idx = ids.index(msg_id)
            if idx < len(dc_list):
                dc = dc_list[idx]
                dc_name = dc.get('dcName') if isinstance(dc, dict) else None
                display = (dc.get('displayName') if isinstance(dc, dict) else None) or dc_name
                if dc_name:
                    # DG index: default 1; extract from display if [DG N] present
                    import re
                    m = re.search(r'\[(?:DG|Group) (\d+)\]', str(display))
                    dg = m.group(1) if m else '1'
                    return f'{dc_name}-{dg}-{figure_idx}', pn
    return None


def _handle_interact(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Dispatch an interact button click through the stepper."""
    from python.engine.stepper import Action, step

    custom_id = _extract_custom_id(interaction)
    parsed = _parse_interact_id(custom_id)
    if parsed is None:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id, figure_idx, option_id = parsed

    get_game = ctx.get('get_game')
    if not callable(get_game):
        return {'ok': False, 'reason': 'no_get_game_in_context'}
    game = get_game(game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    resolved = _resolve_figure_key(game, msg_id, figure_idx)
    if resolved is None:
        return {'ok': False, 'reason': 'figure_not_found_for_msg_id'}
    figure_key, player_num = resolved

    # Optional: validate caller owns this DC
    user_id = _extract_user_id(interaction)
    data = game.data if hasattr(game, 'data') else game
    owner_id = data.get(f'player{player_num}Id')
    if owner_id and user_id and user_id != str(owner_id):
        return {'ok': False, 'reason': 'not_owner'}

    try:
        new_game = step(
            game,
            Action(
                type=ActionType.INTERACT, player=player_num,
                params={'figure_key': figure_key, 'option_id': option_id},
            ),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()

    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line(
            f'{figure_key} used interact: {option_id}.',
            phase='ROUND', icon='deploy',
        ), {})

    return {
        'ok': True, 'game': new_game, 'figureKey': figure_key,
        'optionId': option_id, 'playerNum': player_num,
    }


register('interact_choice_', _handle_interact, 'core')
