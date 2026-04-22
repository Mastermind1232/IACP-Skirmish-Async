"""dc_play_area Discord handler — mirror of src/handlers/dc-play-area.js.

Owns the DC-card button family:
  dc_action_{gameId}_{msgId}_{actionName}    → DC_ACTION (Attack/Move/Special routing)
  dc_special_{specialIdx}_{msgId}            → DC_SPECIAL (ability dispatch)
  dc_cc_special_{msgId}_{cardIdx}            → PLAY_CC_SPECIAL
  dc_cc_double_{msgId}_{cardIdx}             → PLAY_CC_DOUBLE
  dc_ability_choice_{gameId}_{msgId}_{specialIdx}_{choiceIdx} → DC_ABILITY_CHOICE
  bo_rifle_pick_{use|skip}_{gameId}_{msgId}_{figIdx}
  ee3_pick_die_{color|skip}_{gameId}_{msgId}_{figIdx}
  arsenal_pick_{gameId}_{msgId}_{figIdx}  (select menu — dice in values)
  pounce_space_{gameId}_{msgId}_{figIdx}_{space}
  overwatch_space_{gameId}_{msgId}_{space}
  bomb_drop_space_{gameId}_{msgId}_{space}
  ob_space_{gameId}_{msgId}_{space}
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


# ─── dc_action / dc_special ────────────────────────────────────────────────

def _handle_dc_action(interaction, ctx) -> Dict[str, Any]:
    """'dc_action_{gameId}_{msgId}_{actionName}'"""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('dc_action_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('dc_action_'):]
    parts = tail.split('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id, action_name = parts

    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found'}
    new_game = step(
        game, Action(type=ActionType.DC_ACTION, player=0,
                      params={'msg_id': msg_id, 'action_name': action_name}),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': new_game, 'msgId': msg_id,
        'actionName': action_name,
    }


def _handle_dc_special(interaction, ctx) -> Dict[str, Any]:
    """'dc_special_{specialIdx}_{msgId}' → DC_SPECIAL on the DC's first figure."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('dc_special_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('dc_special_'):]
    parts = tail.split('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    try:
        special_idx = int(parts[0])
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    msg_id = parts[1]

    # No game_id in customId — look up via ctx.dc_message_meta
    dcm = ctx.get('dc_message_meta') or {}
    meta = dcm.get(msg_id) if hasattr(dcm, 'get') else None
    if meta is None:
        return {'ok': False, 'reason': 'msg_id_not_in_meta'}
    game_id = meta.get('gameId')
    if not game_id:
        return {'ok': False, 'reason': 'meta_missing_game_id'}
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found'}

    owner = _find_dc_owner(game, msg_id)
    if owner is None:
        return {'ok': False, 'reason': 'dc_not_found_for_msg_id'}
    player_num, dc = owner
    dc_name = dc.get('dcName')
    figure_key = f'{dc_name}-{dc.get("dgIndex", 1)}-0'
    try:
        new_game = step(
            game, Action(type=ActionType.DC_SPECIAL, player=player_num,
                          params={'figure_key': figure_key, 'special_idx': special_idx}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    result = new_game.data.get('lastDcSpecialResult') if hasattr(new_game, 'data') else None
    return {
        'ok': True, 'game': new_game, 'msgId': msg_id,
        'specialIdx': special_idx, 'result': result,
    }


# ─── dc_cc_special / dc_cc_double  ─────────────────────────────────────────

def _play_cc_from_dc(interaction, ctx, timing_prefix: str) -> Dict[str, Any]:
    """Shared parser for dc_cc_special_ / dc_cc_double_."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith(timing_prefix):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len(timing_prefix):]
    parts = tail.rsplit('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    msg_id, card_idx_str = parts
    try:
        card_idx = int(card_idx_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    dcm = ctx.get('dc_message_meta') or {}
    meta = dcm.get(msg_id) if hasattr(dcm, 'get') else None
    if meta is None:
        return {'ok': False, 'reason': 'msg_id_not_in_meta'}
    game_id = meta.get('gameId')
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found'}

    owner = _find_dc_owner(game, msg_id)
    if owner is None:
        return {'ok': False, 'reason': 'dc_not_found_for_msg_id'}
    player_num, dc = owner

    # Resolve cardIdx → card name from the player's hand
    data = game.data if hasattr(game, 'data') else game
    hand = data.get(f'player{player_num}CcHand') or []
    if card_idx < 0 or card_idx >= len(hand):
        return {'ok': False, 'reason': 'card_index_out_of_range'}
    card = hand[card_idx]
    dc_name = dc.get('dcName')
    action_type = (
        ActionType.PLAY_CC_DOUBLE if timing_prefix == 'dc_cc_double_'
        else ActionType.PLAY_CC_SPECIAL
    )
    try:
        new_game = step(
            game, Action(type=action_type, player=player_num,
                          params={'card': card, 'dc_name': dc_name,
                                   'display_name': dc.get('displayName')}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': new_game, 'msgId': msg_id,
        'card': card, 'dcName': dc_name,
    }


def _handle_dc_cc_special(interaction, ctx) -> Dict[str, Any]:
    return _play_cc_from_dc(interaction, ctx, 'dc_cc_special_')


def _handle_dc_cc_double(interaction, ctx) -> Dict[str, Any]:
    return _play_cc_from_dc(interaction, ctx, 'dc_cc_double_')


# ─── dc_ability_choice ─────────────────────────────────────────────────────

def _handle_dc_ability_choice(interaction, ctx) -> Dict[str, Any]:
    """'dc_ability_choice_{gameId}_{msgId}_{specialIdx}_{choiceIdx}'."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('dc_ability_choice_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('dc_ability_choice_'):]
    parts = tail.rsplit('_', 3)
    if len(parts) != 4:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id, special_idx_str, choice_idx_str = parts
    try:
        special_idx = int(special_idx_str)
        choice_idx = int(choice_idx_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found'}
    try:
        new_game = step(
            game, Action(type=ActionType.DC_ABILITY_CHOICE, player=0,
                          params={'msg_id': msg_id, 'special_idx': special_idx,
                                   'choice_index': choice_idx}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': new_game, 'msgId': msg_id,
        'specialIdx': special_idx, 'choiceIdx': choice_idx,
    }


# ─── bo_rifle_pick / ee3_pick_die  ─────────────────────────────────────────

def _handle_bo_rifle_pick(interaction, ctx) -> Dict[str, Any]:
    """'bo_rifle_pick_{use|skip}_{gameId}_{msgId}_{figIdx}'."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('bo_rifle_pick_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('bo_rifle_pick_'):]
    parts = tail.split('_', 3)
    if len(parts) < 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    choice = parts[0]
    game_id = parts[1]
    msg_id = parts[2]
    # parts[3] is figIdx; ignored here

    if choice not in ('use', 'skip'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found'}

    action_type = (ActionType.BO_RIFLE_USE if choice == 'use'
                    else ActionType.BO_RIFLE_SKIP)
    try:
        new_game = step(
            game, Action(type=action_type, player=0,
                          params={'msg_id': msg_id}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'choice': choice, 'msgId': msg_id}


def _handle_ee3_pick_die(interaction, ctx) -> Dict[str, Any]:
    """'ee3_pick_die_{color|skip}_{gameId}_{msgId}_{figIdx}'."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('ee3_pick_die_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('ee3_pick_die_'):]
    parts = tail.split('_', 3)
    if len(parts) < 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    color_or_skip = parts[0]
    game_id = parts[1]
    msg_id = parts[2]

    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found'}

    if color_or_skip == 'skip':
        try:
            new_game = step(
                game, Action(type=ActionType.EE3_PICK_SKIP, player=0,
                              params={'msg_id': msg_id}),
            )
        except ValueError as e:
            return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    else:
        try:
            new_game = step(
                game, Action(type=ActionType.EE3_PICK_DIE, player=0,
                              params={'msg_id': msg_id, 'color': color_or_skip}),
            )
        except ValueError as e:
            return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'choice': color_or_skip, 'msgId': msg_id}


# ─── Space pickers (overwatch, bomb_drop, ob, pounce) ──────────────────────

def _handle_overwatch_space(interaction, ctx) -> Dict[str, Any]:
    """'overwatch_space_{gameId}_{msgId}_{space}'."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('overwatch_space_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('overwatch_space_'):]
    parts = tail.split('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id, space = parts
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found'}
    try:
        new_game = step(
            game, Action(type=ActionType.OVERWATCH_SPACE, player=0,
                          params={'msg_id': msg_id, 'space': space}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'msgId': msg_id, 'space': space}


def _handle_bomb_drop_space(interaction, ctx) -> Dict[str, Any]:
    """'bomb_drop_space_{gameId}_{msgId}_{space}'."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('bomb_drop_space_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('bomb_drop_space_'):]
    parts = tail.split('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id, space = parts
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found'}
    try:
        new_game = step(
            game, Action(type=ActionType.BOMB_DROP_SPACE, player=0,
                          params={'msg_id': msg_id, 'space': space}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'msgId': msg_id, 'space': space}


def _handle_ob_space(interaction, ctx) -> Dict[str, Any]:
    """'ob_space_{gameId}_{msgId}_{space}'."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('ob_space_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('ob_space_'):]
    parts = tail.split('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id, space = parts
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found'}
    try:
        new_game = step(
            game, Action(type=ActionType.OB_SPACE, player=0,
                          params={'msg_id': msg_id, 'space': space}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'msgId': msg_id, 'space': space}


# ─── Registration ─────────────────────────────────────────────────────────

register('dc_action_', _handle_dc_action, 'dcPlayArea')
register('dc_special_', _handle_dc_special, 'dcPlayArea')
register('dc_cc_special_', _handle_dc_cc_special, 'dcPlayArea')
register('dc_cc_double_', _handle_dc_cc_double, 'dcPlayArea')
register('dc_ability_choice_', _handle_dc_ability_choice, 'dcPlayArea')
register('bo_rifle_pick_', _handle_bo_rifle_pick, 'dcPlayArea')
register('ee3_pick_die_', _handle_ee3_pick_die, 'dcPlayArea')
register('overwatch_space_', _handle_overwatch_space, 'dcPlayArea')
register('bomb_drop_space_', _handle_bomb_drop_space, 'dcPlayArea')
register('ob_space_', _handle_ob_space, 'dcPlayArea')
