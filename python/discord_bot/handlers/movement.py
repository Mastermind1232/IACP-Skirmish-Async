"""Movement Discord handler — mirror of src/handlers/movement.js.

Handles the movement UI chain:
  move_figure_{gameId}_{msgId}_{figureIdx}  → open movement picker
  move_mp_{msgId}_{figureIdx}_{mp}          → set MP budget
  move_pick_space_{gameId}_{msgId}_{figureIdx}_{space} → commit move
  move_letter_{msgId}_{figureIdx}_{letter}  → letter pick (multi-figure group)

The stepper only consumes move_pick_space (atomic); the rest set
scratch state on game.moveInProgress that the bot UI uses to render
the MP slider / row picker / space picker.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from python.discord_bot.handlers import register
from python.discord_bot.messages.updaters import format_log_line
from python.engine.actions import ActionType


def _cid(interaction: Any) -> str:
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    return (
        getattr(interaction, 'customId', None)
        or getattr(interaction, 'custom_id', None)
        or ''
    )


def _uid(interaction: Any) -> str:
    user = getattr(interaction, 'user', None)
    if user is not None:
        uid = getattr(user, 'id', None)
        if uid is not None:
            return str(uid)
    return ''


def _game_of(ctx: Dict[str, Any], game_id: str) -> Optional[Any]:
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _find_dc_owner(game: Any, msg_id: str) -> Optional[Tuple[int, Dict[str, Any]]]:
    data = game.data if hasattr(game, 'data') else game
    for pn in (1, 2):
        ids = data.get(f'p{pn}DcMessageIds') or []
        dc_list = data.get(f'p{pn}DcList') or []
        if msg_id in ids:
            idx = ids.index(msg_id)
            if idx < len(dc_list):
                return pn, dc_list[idx]
    return None


# ─── move_figure (open picker) ────────────────────────────────────────────

def _handle_move_figure(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('move_figure_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('move_figure_'):]
    parts = tail.rsplit('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    # tail = 'gameId_msgId_figIdx' — if gameId has no underscores
    game_id, msg_id, fig_idx_str = parts
    try:
        figure_idx = int(fig_idx_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    owner = _find_dc_owner(game, msg_id)
    if owner is None:
        return {'ok': False, 'reason': 'dc_not_found_for_msg_id'}
    player_num, dc = owner

    user_id = _uid(interaction)
    data = game.data if hasattr(game, 'data') else game
    if user_id and user_id != str(data.get(f'player{player_num}Id') or ''):
        return {'ok': False, 'reason': 'not_owner_of_dc'}

    dc_name = dc.get('dcName')
    figure_key = f'{dc_name}-{dc.get("dgIndex", 1)}-{figure_idx}'

    new_game = step(
        game, Action(type=ActionType.MOVE_FIGURE, player=player_num,
                      params={'figure_key': figure_key, 'msg_id': msg_id}),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': new_game, 'msgId': msg_id,
        'figureKey': figure_key, 'playerNum': player_num,
    }


# ─── move_mp (set MP budget) ──────────────────────────────────────────────

def _handle_move_mp(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('move_mp_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('move_mp_'):]
    parts = tail.rsplit('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    msg_id, _fig_idx, mp_str = parts
    try:
        mp = int(mp_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    # move_mp needs the game — but gameId isn't in the customId. Look it up
    # via dcMessageMeta. For the stepper port we just pass msg_id and let
    # the stepper-side handler update moveInProgress.
    dcm = ctx.get('dc_message_meta') or {}
    if hasattr(dcm, 'get'):
        meta = dcm.get(msg_id)
    else:
        meta = None
    if meta is None:
        return {'ok': False, 'reason': 'msg_id_not_in_meta'}
    game_id = meta.get('gameId')
    if not game_id:
        return {'ok': False, 'reason': 'meta_missing_game_id'}

    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    new_game = step(
        game, Action(type=ActionType.MOVE_MP, player=0,
                      params={'msg_id': msg_id, 'mp': mp}),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'msgId': msg_id, 'mp': mp}


# ─── move_pick_space (commit move) ────────────────────────────────────────

def _handle_move_pick_space(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('move_pick_space_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('move_pick_space_'):]
    # format: gameId_msgId_figIdx_space
    parts = tail.split('_', 3)
    if len(parts) != 4:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id, fig_idx_str, space = parts
    try:
        figure_idx = int(fig_idx_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    owner = _find_dc_owner(game, msg_id)
    if owner is None:
        return {'ok': False, 'reason': 'dc_not_found_for_msg_id'}
    player_num, dc = owner

    user_id = _uid(interaction)
    data = game.data if hasattr(game, 'data') else game
    if user_id and user_id != str(data.get(f'player{player_num}Id') or ''):
        return {'ok': False, 'reason': 'not_owner_of_dc'}

    dc_name = dc.get('dcName')
    figure_key = f'{dc_name}-{dc.get("dgIndex", 1)}-{figure_idx}'

    try:
        new_game = step(
            game, Action(
                type=ActionType.MOVE_PICK_SPACE, player=player_num,
                params={'figure_key': figure_key, 'coord': space},
            ),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()

    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line(f'{dc_name} moved to {space.upper()}.',
                             phase='ROUND', icon='move'), {})

    return {
        'ok': True, 'game': new_game, 'msgId': msg_id,
        'figureKey': figure_key, 'space': space,
    }


# ─── move_letter (figure pick within multi-figure group) ──────────────────

def _handle_move_letter(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('move_letter_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('move_letter_'):]
    parts = tail.rsplit('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    msg_id, _fig_idx, letter = parts

    dcm = ctx.get('dc_message_meta') or {}
    meta = dcm.get(msg_id) if hasattr(dcm, 'get') else None
    if meta is None:
        return {'ok': False, 'reason': 'msg_id_not_in_meta'}
    game_id = meta.get('gameId')
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    new_game = step(
        game, Action(type=ActionType.MOVE_LETTER, player=0,
                      params={'msg_id': msg_id, 'letter': letter}),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'msgId': msg_id, 'letter': letter}


register('move_figure_', _handle_move_figure, 'movement')
register('move_mp_', _handle_move_mp, 'movement')
register('move_pick_space_', _handle_move_pick_space, 'movement')
register('move_letter_', _handle_move_letter, 'movement')
