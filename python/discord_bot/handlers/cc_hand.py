"""cc_hand Discord handler — mirror of src/handlers/cc-hand.js.

Covers the hand-side CC flow:
  play_cc_{gameId}_{cardIdx}       → pick from hand, open confirm prompt
  cc_confirm_play_{gameId}         → commit (PLAY_CC)
  cc_cancel_play_{gameId}          → cancel pendingCcConfirmation
  cc_choice_{gameId}_{option}      → pick an option for a pending CC choice
  cc_space_{gameId}_{space}        → pick a space for a pending CC effect
  cc_shuffle_draw_{gameId}         → initial starting-hand draw

celebration_play / celebration_pass / comm_disruption_play /
comm_disruption_skip are already handled via stepper-bridge for their
straightforward paths.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

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


def _resolve_game(ctx, game_id):
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _player_num_of(game, user_id):
    data = game.data if hasattr(game, 'data') else game
    if user_id and user_id == str(data.get('player1Id') or ''):
        return 1
    if user_id and user_id == str(data.get('player2Id') or ''):
        return 2
    return 0


# ─── play_cc_{gameId}_{cardIdx}  (stage the play) ──────────────────────────

def _handle_play_cc_from_hand(interaction, ctx) -> Dict[str, Any]:
    """Stage a CC from the user's hand into pendingCcConfirmation.

    customId: 'play_cc_{gameId}_{cardIdx}'. Reads the hand, validates
    the index, sets game.pendingCcConfirmation = {playerNum, card, ts}.
    The caller confirms via cc_confirm_play_{gameId}.
    """
    import time

    cid = _cid(interaction)
    if not cid.startswith('play_cc_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('play_cc_'):]
    parts = tail.rsplit('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, idx_str = parts
    try:
        idx = int(idx_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    user_id = _uid(interaction)
    player = _player_num_of(game, user_id)
    if player == 0:
        return {'ok': False, 'reason': 'not_a_player_in_game'}

    data = game.data if hasattr(game, 'data') else game
    hand_key = f'player{player}CcHand'
    hand = data.get(hand_key) or []
    if idx < 0 or idx >= len(hand):
        return {'ok': False, 'reason': 'card_index_out_of_range'}

    card = hand[idx]
    data['pendingCcConfirmation'] = {
        'playerNum': player, 'card': card, 'ts': int(time.time() * 1000),
    }
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'card': card, 'playerNum': player,
        'cardIndex': idx,
    }


# ─── cc_shuffle_draw_{gameId}  (initial starting-hand draw) ───────────────

def _handle_cc_shuffle_draw(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('cc_shuffle_draw_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('cc_shuffle_draw_'):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    user_id = _uid(interaction)
    player = _player_num_of(game, user_id)
    if player == 0:
        return {'ok': False, 'reason': 'not_a_player_in_game'}

    try:
        new_game = step(
            game, Action(type=ActionType.DRAW_CC, player=player,
                          params={'starting_size': 3}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()
    drew = (new_game.data.get('lastCcDraw') or {}).get('cards') \
        if hasattr(new_game, 'data') else []
    return {
        'ok': True, 'game': new_game, 'playerNum': player, 'drew': drew,
    }


# ─── cc_choice_{gameId}_{option}  (pick an option for a pending choice) ────

def _handle_cc_choice(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('cc_choice_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('cc_choice_'):]
    parts = tail.split('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, option = parts
    try:
        choice_index = int(option)
    except ValueError:
        choice_index = None  # option may be a label string; caller maps

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    # If option is a label, map it to the index via pendingCcChoice
    data = game.data if hasattr(game, 'data') else game
    pending = data.get('pendingCcChoice') or {}
    options = pending.get('choiceOptions') or []
    if choice_index is None:
        if option in options:
            choice_index = options.index(option)
        else:
            return {'ok': False, 'reason': 'unknown_choice_option'}

    try:
        new_game = step(
            game, Action(type=ActionType.CC_CHOICE, player=0,
                          params={'choice_index': choice_index}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'choiceIndex': choice_index}


# ─── cc_space_{gameId}_{space}  (pick a coord for a pending CC) ───────────

def _handle_cc_space(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('cc_space_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('cc_space_'):]
    parts = tail.split('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, space = parts

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.CC_SPACE, player=0,
                          params={'space': space}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'space': space}


def _player_num_from_channel(interaction: Any, game: Any) -> Optional[int]:
    """Determine which player's hand channel the interaction came from.

    Returns 1 / 2 / None. Matches JS's `channelId === game.p1HandId`
    comparison. Uses interaction.channel.id when present.
    """
    channel = getattr(interaction, 'channel', None)
    channel_id = getattr(channel, 'id', None) if channel is not None else None
    if channel_id is None:
        return None
    data = game.data if hasattr(game, 'data') else game
    if str(channel_id) == str(data.get('p1HandId') or ''):
        return 1
    if str(channel_id) == str(data.get('p2HandId') or ''):
        return 2
    return None


def _handle_cc_discard_select(interaction: Any,
                                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """cc_discard_select_{gameId} — select-menu handler for discarding a
    single CC from hand. The chosen card arrives via
    `interaction.values[0]`. Mirrors src/handlers/cc-hand.js:1183-1230.

    Ownership check: interaction.channel.id must match the acting
    player's hand-channel id (p1HandId / p2HandId).
    """
    cid = _cid(interaction)
    if not cid.startswith('cc_discard_select_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('cc_discard_select_'):]
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    player_num = _player_num_from_channel(interaction, game)
    if player_num not in (1, 2):
        return {'ok': False, 'reason': 'wrong_channel'}

    values = getattr(interaction, 'values', None) or []
    if not values:
        return {'ok': False, 'reason': 'no_card_selected'}
    card = values[0]

    data = game.data if hasattr(game, 'data') else game
    hand_key = f'player{player_num}CcHand'
    disc_key = f'player{player_num}CcDiscard'
    hand = list(data.get(hand_key) or [])
    if card not in hand:
        return {'ok': False, 'reason': 'card_not_in_hand'}

    hand.remove(card)
    discard = list(data.get(disc_key) or [])
    discard.append(card)
    data[hand_key] = hand
    data[disc_key] = discard

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'playerNum': player_num, 'card': card,
    }


# ─── Registration ────────────────────────────────────────────────────────

register('play_cc_', _handle_play_cc_from_hand, 'ccHand')
register('cc_shuffle_draw_', _handle_cc_shuffle_draw, 'ccHand')
register('cc_choice_', _handle_cc_choice, 'ccHand')
register('cc_space_', _handle_cc_space, 'ccHand')
register('cc_discard_select_', _handle_cc_discard_select, 'ccHand')
