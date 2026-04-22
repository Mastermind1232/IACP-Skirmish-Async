"""Phase-gate Discord handler — mirror of src/handlers/phase-gate.js.

Handles the 'I'm ready' / 'I changed my mind' buttons for phase
transitions. Wraps the stepper's PHASE_GATE_READY / PHASE_GATE_UNREADY
actions with Discord-side UI updates (ready-count message edit + phase
transition dispatch when both sides ready up).

This is the first concrete Discord handler replacing the generic
stepper_bridge for this prefix family. The stepper_bridge's
'phase_gate_ready_' / 'phase_gate_unready_' registrations are
shadowed by the more-specific prefixes below (longest-match wins).
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from python.discord_bot.handlers import register
from python.discord_bot.messages.updaters import COLOR_NEUTRAL, format_log_line
from python.engine.actions import ActionType
from python.engine.mechanics.phase_gate import (
    PHASE_GATE_LABELS,
    player_num_from_id,
)


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


def _parse_ready_id(custom_id: str, prefix: str) -> str:
    """Return the gameId tail of the customId, or '' if malformed."""
    if not custom_id.startswith(prefix):
        return ''
    return custom_id[len(prefix):]


def _format_gate_status(gate: Dict[str, Any], game: Any,
                        round_num: int) -> str:
    """Render the 'X is ready / waiting on Y' status line."""
    phase = gate.get('phase') or ''
    label = PHASE_GATE_LABELS.get(phase, phase).replace('{round}', str(round_num))
    p1_ready = bool(gate.get('p1Ready'))
    p2_ready = bool(gate.get('p2Ready'))
    if p1_ready and p2_ready:
        status = '✅ Both players ready.'
    elif p1_ready:
        status = '🟩 P1 ready · ⏳ waiting on P2'
    elif p2_ready:
        status = '⏳ waiting on P1 · 🟩 P2 ready'
    else:
        status = '⏳ waiting on both players'
    return f'{label}\n{status}'


def _resolve_game(ctx: Dict[str, Any], game_id: str) -> Optional[Any]:
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _handle_phase_gate_ready(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Mark the clicking player ready + edit the prompt message."""
    from python.engine.stepper import Action, step

    custom_id = _extract_custom_id(interaction)
    user_id = _extract_user_id(interaction)
    game_id = _parse_ready_id(custom_id, 'phase_gate_ready_')
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    player = player_num_from_id(game, user_id)
    if player == 0:
        return {'ok': False, 'reason': 'not_a_player_in_game'}

    new_game = step(
        game, Action(type=ActionType.PHASE_GATE_READY, player=player),
    )

    # Persist + return the formatted status for the caller to render
    save = ctx.get('save_games')
    if callable(save):
        save()
    gate = (new_game.data.get('phaseGate') or {}) if hasattr(new_game, 'data') else {}
    round_num = (
        (new_game.data.get('round') or new_game.data.get('currentRound') or 1)
        if hasattr(new_game, 'data') else 1
    )
    status_text = _format_gate_status(gate, new_game, round_num)
    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line(f'<@{user_id}> ready.', phase='ROUND',
                             icon='round'), {})

    return {
        'ok': True,
        'game': new_game,
        'gate': gate,
        'statusText': status_text,
        'statusEmbed': {
            'description': status_text,
            'color': COLOR_NEUTRAL,
        },
        'bothReady': bool(gate.get('p1Ready') and gate.get('p2Ready')),
    }


def _handle_phase_gate_unready(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Un-ready the clicking player; symmetric with ready."""
    from python.engine.stepper import Action, step

    custom_id = _extract_custom_id(interaction)
    user_id = _extract_user_id(interaction)
    game_id = _parse_ready_id(custom_id, 'phase_gate_unready_')
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    player = player_num_from_id(game, user_id)
    if player == 0:
        return {'ok': False, 'reason': 'not_a_player_in_game'}

    new_game = step(
        game, Action(type=ActionType.PHASE_GATE_UNREADY, player=player),
    )
    save = ctx.get('save_games')
    if callable(save):
        save()
    gate = (new_game.data.get('phaseGate') or {}) if hasattr(new_game, 'data') else {}
    round_num = (
        (new_game.data.get('round') or new_game.data.get('currentRound') or 1)
        if hasattr(new_game, 'data') else 1
    )
    return {
        'ok': True,
        'game': new_game,
        'gate': gate,
        'statusText': _format_gate_status(gate, new_game, round_num),
        'statusEmbed': {
            'description': _format_gate_status(gate, new_game, round_num),
            'color': COLOR_NEUTRAL,
        },
    }


# Register the concrete handlers. The stepper_bridge registered the same
# prefixes, but install() on stepper_bridge checks _PREFIX_SET and skips
# any prefix we already own — so as long as this module imports AFTER the
# bridge, we override; imports BEFORE, and the bridge wins.
#
# main.py's _HANDLER_MODULES list orders this module before stepper_bridge,
# so these concrete registrations claim the prefixes first.
register('phase_gate_ready_', _handle_phase_gate_ready, 'phaseGate')
register('phase_gate_unready_', _handle_phase_gate_unready, 'phaseGate')
