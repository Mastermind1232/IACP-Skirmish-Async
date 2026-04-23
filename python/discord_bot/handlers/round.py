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


# ── Extra Armor (Honoring the Fallen CC / Crit Hit handler) ────────────────

def _handle_extra_armor_pick(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """extra_armor_pick_{gameId}_{playerNum}_{figureKey} — cycle the
    token count for a figure in the pending allocation (0→1→2→0),
    capped by per-figure max and total remaining budget.

    JS site: src/handlers/round.js:1625-1676.
    """
    from python.engine.mechanics.dc_helpers import get_max_power_tokens

    cid = _cid(interaction)
    if not cid.startswith('extra_armor_pick_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('extra_armor_pick_'):]
    parts = rest.split('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, player_num_str, figure_key = parts
    try:
        player_num = int(player_num_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    owner_id = data.get(f'player{player_num}Id')
    if user_id and str(user_id) != str(owner_id or ''):
        return {'ok': False, 'reason': 'not_owner'}

    key = f'pendingExtraArmor_p{player_num}'
    pending = data.get(key)
    if not pending:
        return {'ok': False, 'reason': 'no_pending_extra_armor'}
    total = int(pending.get('total') or 4)
    allocation = dict(pending.get('allocation') or {})
    existing = len((data.get('figurePowerTokens') or {}).get(figure_key) or [])
    max_for_figure = get_max_power_tokens(figure_key) - existing
    current = int(allocation.get(figure_key) or 0)
    placed = sum(int(v or 0) for v in allocation.values())

    # Cycle 0 → 1 → 2 → 0, bounded by per-figure max and total budget.
    next_val = (current + 1) % 3
    if next_val > max_for_figure:
        next_val = 0
    # Ensure we don't exceed total — new total = placed - current + next_val
    if placed - current + next_val > total:
        next_val = max(0, total - (placed - current))
    allocation[figure_key] = next_val
    pending['allocation'] = allocation
    data[key] = pending

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game,
        'figureKey': figure_key, 'tokenCount': next_val,
        'totalAllocated': sum(int(v or 0) for v in allocation.values()),
        'totalBudget': total,
    }


def _handle_extra_armor_confirm(interaction: Any,
                                 ctx: Dict[str, Any]) -> Dict[str, Any]:
    """extra_armor_confirm_{gameId}_{playerNum} — apply all pending
    allocations as power tokens and clear the pending state. Rejects
    until the full budget is allocated.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    cid = _cid(interaction)
    if not cid.startswith('extra_armor_confirm_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('extra_armor_confirm_'):]
    parts = rest.split('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, player_num_str = parts
    try:
        player_num = int(player_num_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    owner_id = data.get(f'player{player_num}Id')
    if user_id and str(user_id) != str(owner_id or ''):
        return {'ok': False, 'reason': 'not_owner'}

    key = f'pendingExtraArmor_p{player_num}'
    pending = data.get(key)
    if not pending:
        return {'ok': False, 'reason': 'no_pending_extra_armor'}
    total = int(pending.get('total') or 4)
    allocation = dict(pending.get('allocation') or {})
    placed = sum(int(v or 0) for v in allocation.values())
    if placed < total:
        return {
            'ok': False, 'reason': 'budget_not_exhausted',
            'remaining': total - placed,
        }

    applied = []
    for figure_key, count in allocation.items():
        count = int(count or 0)
        if count <= 0:
            continue
        grant_power_tokens(data, figure_key, 'Block', count)
        applied.append({'figureKey': figure_key, 'granted': count})

    # Clear pending
    data[key] = None

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': game, 'applied': applied, 'total': total}


def _handle_extra_armor_cancel(interaction: Any,
                                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """extra_armor_cancel_{gameId}_{playerNum} — no-op (UI-only in JS;
    defers the Discord interaction without changing state). We mirror
    by simply returning ok so the router doesn't complain.
    """
    return {'ok': True, 'noop': True}


register('end_end_of_round_', _handle_end_end_of_round, 'round')
register('end_start_of_round_', _handle_end_start_of_round, 'round')
register('extra_armor_pick_', _handle_extra_armor_pick, 'round')
register('extra_armor_confirm_', _handle_extra_armor_confirm, 'round')
register('extra_armor_cancel_', _handle_extra_armor_cancel, 'round')
