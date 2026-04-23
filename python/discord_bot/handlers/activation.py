"""Activation Discord handler — mirror of src/handlers/activation.js.

Covers the core activation flow:
  - activate_dc_{gameId}_{msgId}_{figureIdx}  → ACTIVATE_DC
  - pass_activation_turn_{gameId}            → PASS_ACTIVATION_TURN
  - end_activation_phase_{gameId}            → END_ACTIVATION_PHASE
  - dc_end_activation_{gameId}_{msgId}       → DC_END_ACTIVATION
  - end_turn_{gameId}_{msgId}                → END_TURN

Each wraps the stepper action with owner validation + structured result
for the bot layer to update DC card embeds + swap the active-player
marker.
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
    return ''


def _parse_activate_id(custom_id: str) -> Optional[Tuple[str, str, int]]:
    """'activate_dc_{gameId}_{msgId}_{figureIdx}' → (gameId, msgId, figureIdx)."""
    if not custom_id.startswith('activate_dc_'):
        return None
    tail = custom_id[len('activate_dc_'):]
    parts = tail.rsplit('_', 1)
    if len(parts) != 2:
        return None
    head, fig_str = parts
    try:
        figure_idx = int(fig_str)
    except ValueError:
        return None
    # head = gameId_msgId. msgId may contain underscores (unlikely) — assume none
    head_parts = head.split('_', 1)
    if len(head_parts) != 2:
        return None
    return head_parts[0], head_parts[1], figure_idx


def _player_num_of(game: Any, user_id: str) -> int:
    data = game.data if hasattr(game, 'data') else game
    if user_id and user_id == str(data.get('player1Id') or ''):
        return 1
    if user_id and user_id == str(data.get('player2Id') or ''):
        return 2
    return 0


def _resolve_game(ctx: Dict[str, Any], game_id: str) -> Optional[Any]:
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _find_dc_owner(game: Any, msg_id: str) -> Optional[Tuple[int, Dict[str, Any]]]:
    """Return (player_num, dc_entry) for the DC that owns msg_id."""
    data = game.data if hasattr(game, 'data') else game
    for pn in (1, 2):
        ids = data.get(f'p{pn}DcMessageIds') or []
        dc_list = data.get(f'p{pn}DcList') or []
        if msg_id in ids:
            idx = ids.index(msg_id)
            if idx < len(dc_list):
                return pn, dc_list[idx]
    return None


# ─── Activate DC ──────────────────────────────────────────────────────────

def _handle_activate_dc(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    parsed = _parse_activate_id(_extract_custom_id(interaction))
    if parsed is None:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id, figure_idx = parsed

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    owner = _find_dc_owner(game, msg_id)
    if owner is None:
        return {'ok': False, 'reason': 'dc_not_found_for_msg_id'}
    player_num, dc = owner

    user_id = _extract_user_id(interaction)
    if user_id and _player_num_of(game, user_id) != player_num:
        return {'ok': False, 'reason': 'not_owner_of_dc'}

    dc_name = dc.get('dcName')
    if not dc_name:
        return {'ok': False, 'reason': 'dc_entry_missing_name'}
    figure_key = f'{dc_name}-{dc.get("dgIndex", 1)}-{figure_idx}'

    try:
        new_game = step(
            game, Action(type=ActionType.ACTIVATE_DC, player=player_num,
                          params={'figure_key': figure_key}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()

    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line(f'P{player_num} activated {dc_name}.',
                             phase='ACTIVATION', icon='activate'), {})

    return {
        'ok': True, 'game': new_game, 'playerNum': player_num,
        'msgId': msg_id, 'dcName': dc_name, 'figureKey': figure_key,
    }


# ─── Pass / End activation phase ──────────────────────────────────────────

def _handle_pass_activation_turn(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    custom_id = _extract_custom_id(interaction)
    if not custom_id.startswith('pass_activation_turn_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = custom_id[len('pass_activation_turn_'):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    user_id = _extract_user_id(interaction)
    player = _player_num_of(game, user_id)
    if player == 0:
        return {'ok': False, 'reason': 'not_a_player_in_game'}

    new_game = step(
        game, Action(type=ActionType.PASS_ACTIVATION_TURN, player=player),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'playerNum': player}


def _handle_end_activation_phase(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    custom_id = _extract_custom_id(interaction)
    if not custom_id.startswith('end_activation_phase_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = custom_id[len('end_activation_phase_'):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.END_ACTIVATION_PHASE, player=0),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game}


# ─── End a DC's activation / end turn ─────────────────────────────────────

def _handle_dc_end_activation(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    custom_id = _extract_custom_id(interaction)
    if not custom_id.startswith('dc_end_activation_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = custom_id[len('dc_end_activation_'):]
    parts = tail.split('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id = parts

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    owner = _find_dc_owner(game, msg_id)
    if owner is None:
        return {'ok': False, 'reason': 'dc_not_found_for_msg_id'}
    player_num, dc = owner

    user_id = _extract_user_id(interaction)
    if user_id and _player_num_of(game, user_id) != player_num:
        return {'ok': False, 'reason': 'not_owner_of_dc'}

    new_game = step(
        game, Action(type=ActionType.DC_END_ACTIVATION, player=player_num),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': new_game, 'playerNum': player_num,
        'msgId': msg_id, 'dcName': dc.get('dcName'),
    }


def _handle_end_turn(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """'end_turn_{gameId}_{msgId}' → END_TURN (wraps DC_END_ACTIVATION)."""
    from python.engine.stepper import Action, step

    custom_id = _extract_custom_id(interaction)
    if not custom_id.startswith('end_turn_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = custom_id[len('end_turn_'):]
    parts = tail.split('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, msg_id = parts

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    owner = _find_dc_owner(game, msg_id)
    if owner is None:
        return {'ok': False, 'reason': 'dc_not_found_for_msg_id'}
    player_num, dc = owner

    user_id = _extract_user_id(interaction)
    if user_id and _player_num_of(game, user_id) != player_num:
        return {'ok': False, 'reason': 'not_owner_of_dc'}

    new_game = step(
        game, Action(type=ActionType.END_TURN, player=player_num,
                      params={'msg_id': msg_id}),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': new_game, 'playerNum': player_num,
        'msgId': msg_id, 'dcName': dc.get('dcName'),
    }


# ─── Cancel / confirm activation ──────────────────────────────────────────

def _handle_scav_weapon_transfer(interaction: Any,
                                    ctx: Dict[str, Any]) -> Dict[str, Any]:
    """scav_weapon_transfer_{gameId}_{playerNum}_{targetIdx} — Scavenged
    Weaponry transfer: move the 'Scavenged Weaponry' attachment from a
    defeated figure to a chosen eligible target. Mirrors
    src/handlers/activation.js:2130-2158.
    """
    cid = _extract_custom_id(interaction)
    if not cid.startswith('scav_weapon_transfer_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('scav_weapon_transfer_'):]
    parts = rest.split('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, player_num_str, target_idx_str = parts
    try:
        player_num = int(player_num_str)
        target_idx = int(target_idx_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    get_game = ctx.get('get_game')
    game = get_game(game_id) if callable(get_game) else None
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    pending = data.get('pendingScavengedWeaponryTransfer')
    if not pending or pending.get('playerNum') != player_num:
        return {'ok': False, 'reason': 'no_pending_transfer'}

    eligible = pending.get('eligible') or []
    if target_idx < 0 or target_idx >= len(eligible):
        return {'ok': False, 'reason': 'target_index_out_of_range'}
    target = eligible[target_idx]

    att_key = 'p1DcAttachments' if player_num == 1 else 'p2DcAttachments'
    atts = data.get(att_key) or {}
    target_msg_id = target.get('msgId')
    if not target_msg_id:
        return {'ok': False, 'reason': 'target_missing_msg_id'}
    atts[target_msg_id] = list(atts.get(target_msg_id) or []) + ['Scavenged Weaponry']
    data[att_key] = atts
    data.pop('pendingScavengedWeaponryTransfer', None)

    save = ctx.get('save_games')
    if callable(save):
        save()
    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line(
            f'**Scavenged Weaponry** — Transferred to '
            f'**{target.get("displayName") or target_msg_id}** after defeat.',
            phase='ROUND', icon='activate',
        ), {})
    return {
        'ok': True, 'game': game, 'playerNum': player_num,
        'targetMsgId': target_msg_id,
        'displayName': target.get('displayName'),
    }


def _handle_hair_trigger_skip(interaction: Any,
                                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """hair_trigger_skip_{gameId}_{figureKey} — pure UI dismiss; JS
    version only edits the message. Mirrors
    src/handlers/activation.js:2259-2269.
    """
    cid = _extract_custom_id(interaction)
    if not cid.startswith('hair_trigger_skip_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('hair_trigger_skip_'):]
    parts = rest.split('_', 1)
    if not parts or not parts[0]:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    return {'ok': True, 'gameId': parts[0]}


def _handle_iwba_skip(interaction: Any,
                       ctx: Dict[str, Any]) -> Dict[str, Any]:
    """iwba_skip_{gameId}_{figureKey} — 'It Will Be Alright' skip.
    Clears game.pendingItWillBeAlright. Mirrors
    src/handlers/activation.js:2340-2352.
    """
    import re
    cid = _extract_custom_id(interaction)
    m = re.match(r'^iwba_skip_([^_]+)_(.+)$', cid)
    if not m:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = m.group(1)
    get_game = ctx.get('get_game')
    game = get_game(game_id) if callable(get_game) else None
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game
    data.pop('pendingItWillBeAlright', None)
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': game, 'gameId': game_id}


def _handle_cancel_activate(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """cancel_activate_{gameId}_{ownerId} — dismiss the pending activate
    confirmation. No state mutation; just validates that the presser is
    the activation's owner. Mirrors src/handlers/activation.js:1054-1060.
    """
    import re
    cid = _extract_custom_id(interaction)
    m = re.match(r'^cancel_activate_([^_]+)_(.+)$', cid)
    if not m:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, owner_id = m.group(1), m.group(2)
    user_id = _extract_user_id(interaction)
    if user_id and user_id != owner_id:
        return {'ok': False, 'reason': 'not_owner'}
    return {'ok': True, 'gameId': game_id, 'ownerId': owner_id}


# ─── Registration ─────────────────────────────────────────────────────────

register('activate_dc_', _handle_activate_dc, 'activation')
register('pass_activation_turn_', _handle_pass_activation_turn, 'activation')
register('end_activation_phase_', _handle_end_activation_phase, 'activation')
register('dc_end_activation_', _handle_dc_end_activation, 'activation')
register('end_turn_', _handle_end_turn, 'activation')
register('cancel_activate_', _handle_cancel_activate, 'activation')
register('hair_trigger_skip_', _handle_hair_trigger_skip, 'activation')
register('iwba_skip_', _handle_iwba_skip, 'activation')
register('scav_weapon_transfer_', _handle_scav_weapon_transfer, 'activation')
