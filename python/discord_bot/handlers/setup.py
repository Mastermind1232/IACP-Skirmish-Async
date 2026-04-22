"""Setup Discord handler — mirror of src/handlers/setup.js.

Handles the setup-phase button family:
  - map_selection_* / map_confirm_{gameId} / map_goback_{gameId} / map_type_*
  - draft_random_{gameId}
  - determine_initiative_{gameId}
  - deployment_zone_{red|blue}_{gameId}
  - deployment_fig_{gameId}_{flatIdx}
  - deployment_done_{gameId}

Each wraps a stepper action with Discord-side post-action UI state
(which phase message to edit, which buttons to render next). The
structured result tells the bot layer what to do with the interaction.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

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


def _tail(custom_id: str, prefix: str) -> str:
    return custom_id[len(prefix):] if custom_id.startswith(prefix) else ''


def _resolve(ctx: Dict[str, Any], game_id: str) -> Optional[Any]:
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _player_num_of(game: Any, user_id: str) -> int:
    data = game.data if hasattr(game, 'data') else game
    if user_id and user_id == str(data.get('player1Id') or ''):
        return 1
    if user_id and user_id == str(data.get('player2Id') or ''):
        return 2
    return 0


# ─── Map selection handlers ────────────────────────────────────────────────

def _handle_map_confirm(interaction, ctx) -> Dict[str, Any]:
    """Confirm selected map and advance to initiative phase."""
    from python.engine.stepper import Action, step

    game_id = _tail(_extract_custom_id(interaction), 'map_confirm_')
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _resolve(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    try:
        new_game = step(game, Action(type=ActionType.MAP_CONFIRM, player=0))
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'phase': 'initiative'}


def _handle_map_goback(interaction, ctx) -> Dict[str, Any]:
    """Clear pending map selection so the user can re-pick."""
    from python.engine.stepper import Action, step

    game_id = _tail(_extract_custom_id(interaction), 'map_goback_')
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _resolve(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    new_game = step(game, Action(type=ActionType.MAP_GO_BACK, player=0))
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game}


def _handle_map_type_choice(interaction, ctx) -> Dict[str, Any]:
    """User picked a map-selection type (random / draw / pick).

    customId: 'map_type_{type}_{gameId}' where type ∈ {random, draw, pick}.
    """
    from python.engine.stepper import Action, step

    custom_id = _extract_custom_id(interaction)
    tail = _tail(custom_id, 'map_type_')
    if not tail:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    parts = tail.split('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    selection_type, game_id = parts
    game = _resolve(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    try:
        new_game = step(
            game, Action(
                type=ActionType.MAP_TYPE_CHOICE, player=0,
                params={'selection_type': selection_type},
            ),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'selectionType': selection_type}


# ─── Zone pick ─────────────────────────────────────────────────────────────

def _handle_deployment_zone(interaction, ctx) -> Dict[str, Any]:
    """customId: 'deployment_zone_{red|blue}_{gameId}'"""
    from python.engine.stepper import Action, step

    custom_id = _extract_custom_id(interaction)
    tail = _tail(custom_id, 'deployment_zone_')
    if not tail:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    parts = tail.split('_', 1)
    if len(parts) != 2 or parts[0] not in ('red', 'blue'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    color, game_id = parts
    game = _resolve(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    # Restrict to initiative player
    user_id = _extract_user_id(interaction)
    data = game.data if hasattr(game, 'data') else game
    init_pid = str(data.get('initiativePlayerId') or '')
    if init_pid and user_id and user_id != init_pid:
        return {'ok': False, 'reason': 'not_initiative_player'}
    try:
        new_game = step(
            game, Action(type=ActionType.PICK_ZONE, player=1,
                          params={'zone': color}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    save = ctx.get('save_games')
    if callable(save):
        save()
    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line(f'<@{user_id}> chose {color.upper()} deployment zone.',
                             phase='DEPLOYMENT', icon='deploy'), {})
    return {'ok': True, 'game': new_game, 'zone': color}


# ─── Draft random + determine initiative ───────────────────────────────────

def _handle_draft_random(interaction, ctx) -> Dict[str, Any]:
    """customId: 'draft_random_{gameId}'. The squad payload comes from ctx.

    The bot layer's random-draft resolver (build_random_squad) generates
    the squad off-band and passes it in ctx['random_squad'] for the caller.
    This keeps the stepper layer stateless and the test layer deterministic.
    """
    from python.engine.stepper import Action, step

    game_id = _tail(_extract_custom_id(interaction), 'draft_random_')
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _resolve(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    user_id = _extract_user_id(interaction)
    player = _player_num_of(game, user_id)
    if player == 0:
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    squad = ctx.get('random_squad')
    if not isinstance(squad, dict):
        return {'ok': False, 'reason': 'no_random_squad_in_ctx'}
    new_game = step(
        game, Action(type=ActionType.DRAFT_RANDOM, player=player,
                      params={'squad': squad}),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'playerNum': player, 'squad': squad}


def _handle_determine_initiative(interaction, ctx) -> Dict[str, Any]:
    """customId: 'determine_initiative_{gameId}'.

    ctx['initiative_player_num'] must be 1 or 2 (the caller's resolver
    computes this from squad cost + tiebreaker).
    """
    from python.engine.stepper import Action, step

    game_id = _tail(_extract_custom_id(interaction), 'determine_initiative_')
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _resolve(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    player = ctx.get('initiative_player_num')
    if player not in (1, 2):
        return {'ok': False, 'reason': 'no_initiative_player_in_ctx'}
    new_game = step(
        game, Action(type=ActionType.DETERMINE_INITIATIVE, player=0,
                      params={'player': player}),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': new_game, 'initiativePlayerNum': player}


# ─── Deployment done ───────────────────────────────────────────────────────

def _handle_deployment_done(interaction, ctx) -> Dict[str, Any]:
    """customId: 'deployment_done_{gameId}'."""
    from python.engine.stepper import Action, step

    game_id = _tail(_extract_custom_id(interaction), 'deployment_done_')
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _resolve(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    user_id = _extract_user_id(interaction)
    player = _player_num_of(game, user_id)
    if player == 0:
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    new_game = step(
        game, Action(type=ActionType.DEPLOY_DONE, player=player),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    data = new_game.data if hasattr(new_game, 'data') else new_game
    return {
        'ok': True, 'game': new_game, 'playerNum': player,
        'bothDeployed': bool(data.get('deploymentComplete')),
    }


# ─── Registration ──────────────────────────────────────────────────────────

register('map_confirm_', _handle_map_confirm, 'setup')
register('map_goback_', _handle_map_goback, 'setup')
register('map_type_', _handle_map_type_choice, 'setup')
register('deployment_zone_', _handle_deployment_zone, 'setup')
register('draft_random_', _handle_draft_random, 'setup')
register('determine_initiative_', _handle_determine_initiative, 'setup')
register('deployment_done_', _handle_deployment_done, 'setup')
