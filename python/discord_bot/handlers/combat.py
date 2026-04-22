"""Combat Discord handler — mirror of src/handlers/combat.js.

Wraps the combat state machine (COMBAT_READY/GATE/REROLL/SURGE/
SKIP_SURGES/RESOLVE/PASSIVE/TOKEN) plus the atomic ATTACK_TARGET entry
point.

Also owns:
- power_token_choice_{gameId}_{type}
- strain_choice_alldmg_{gameId} / strain_choice_discard_{gameId}_{n}
- spread_pain_cond_{gameId}_{cond}
- pt_overflow_{...}  (discard)

Each wraps its stepper action with guards + returns a structured result
the bot layer uses to edit the combat thread.
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


def _game_of(ctx: Dict[str, Any], game_id: str) -> Optional[Any]:
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


def _save(ctx: Dict[str, Any]) -> None:
    f = ctx.get('save_games')
    if callable(f):
        f()


# ─── Power token choice ──────────────────────────────────────────────────

def _handle_power_token_choice(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('power_token_choice_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('power_token_choice_'):]
    parts = tail.split('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, token_type = parts

    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.POWER_TOKEN_CHOICE, player=0,
                          params={'type': token_type}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    _save(ctx)
    return {'ok': True, 'game': new_game, 'tokenType': token_type}


# ─── Strain choice ──────────────────────────────────────────────────────

def _handle_strain_choice_alldmg(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('strain_choice_alldmg_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('strain_choice_alldmg_'):]
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.STRAIN_CHOICE_ALLDMG, player=0),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    _save(ctx)
    return {'ok': True, 'game': new_game}


def _handle_strain_choice_discard(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('strain_choice_discard_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('strain_choice_discard_'):]
    parts = tail.rsplit('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, n_str = parts
    try:
        n = int(n_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.STRAIN_CHOICE_DISCARD, player=0,
                          params={'discard_count': n}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    _save(ctx)
    return {'ok': True, 'game': new_game, 'discardCount': n}


# ─── Spread the Pain condition pick ─────────────────────────────────────

def _handle_spread_pain_cond(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('spread_pain_cond_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('spread_pain_cond_'):]
    parts = tail.rsplit('_', 1)
    if len(parts) != 2 or parts[1] not in ('stun', 'weaken', 'bleed', 'skip'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, cond = parts
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.SPREAD_PAIN_COND, player=0,
                          params={'cond': cond}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    _save(ctx)
    return {'ok': True, 'game': new_game, 'cond': cond}


# ─── Combat state-machine transitions ───────────────────────────────────

def _handle_combat_ready(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('combat_ready_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('combat_ready_'):]
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    user_id = _uid(interaction)
    player = _player_num_of(game, user_id)
    if player == 0:
        return {'ok': False, 'reason': 'not_a_player_in_game'}

    try:
        new_game = step(
            game, Action(type=ActionType.COMBAT_READY, player=player),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    _save(ctx)
    combat = (new_game.data.get('pendingCombat') or {}) if hasattr(new_game, 'data') else {}
    return {
        'ok': True, 'game': new_game, 'playerNum': player,
        'bothReady': bool(combat.get('p1Ready') and combat.get('p2Ready')),
    }


def _handle_combat_skip_surges(interaction, ctx) -> Dict[str, Any]:
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('combat_skip_surges_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('combat_skip_surges_'):]
    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.COMBAT_SKIP_SURGES, player=0),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    _save(ctx)
    return {'ok': True, 'game': new_game}


# ─── pt_overflow_discard  (power-token overflow resolution) ─────────────

def _handle_pt_overflow(interaction, ctx) -> Dict[str, Any]:
    """'pt_overflow_{gameId}_{figure_key_url}_{tokenIdx}' shape varies by caller."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('pt_overflow_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len('pt_overflow_'):]
    parts = tail.split('_')
    if len(parts) < 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = parts[0]
    # Last segment is token index; middle is figure_key with underscores
    try:
        token_idx = int(parts[-1])
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    figure_key = '_'.join(parts[1:-1])

    game = _game_of(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.PT_OVERFLOW_DISCARD, player=0,
                          params={'figure_key': figure_key, 'token_index': token_idx}),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}
    _save(ctx)
    return {'ok': True, 'game': new_game, 'figureKey': figure_key,
            'tokenIndex': token_idx}


# ─── Registration ─────────────────────────────────────────────────────

register('power_token_choice_', _handle_power_token_choice, 'combat')
register('strain_choice_alldmg_', _handle_strain_choice_alldmg, 'combat')
register('strain_choice_discard_', _handle_strain_choice_discard, 'combat')
register('spread_pain_cond_', _handle_spread_pain_cond, 'combat')
register('combat_ready_', _handle_combat_ready, 'combat')
register('combat_skip_surges_', _handle_combat_skip_surges, 'combat')
register('pt_overflow_', _handle_pt_overflow, 'combat')
