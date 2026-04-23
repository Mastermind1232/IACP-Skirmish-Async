"""Game action log — append-only history channel for a game.

Each game has a dedicated log channel (from game_channels.get_log_channel).
Every state-changing action (attack resolved, figure defeated, VP
awarded, round advanced, CC played, DC special fired) posts a formatted
line here.

Tests verify that log entries append in order; production sends via
the Discord backend as normal text messages.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _get_backend(backend: Optional[Any] = None):
    if backend is not None:
        return backend
    from python.discord_bot.channels import get_default_backend
    return get_default_backend()


def log_action(game_id: str, message: str,
               *, phase: Optional[str] = None,
               icon: Optional[str] = None,
               backend: Optional[Any] = None) -> Optional[str]:
    """Post a formatted action-log line to the game's log channel.

    Returns the posted message id on success, None on failure.
    """
    from python.discord_bot import game_channels as gc
    from python.discord_bot.messages.updaters import format_log_line

    channel_id = gc.get_log_channel(game_id)
    if not channel_id:
        return None

    be = _get_backend(backend)
    formatted = format_log_line(message, phase=phase, icon=icon)
    return be.post(channel_id, {'content': formatted})


def log_attack(game_id: str, attacker: str, target: str, damage: int,
               defeated: bool, *,
               backend: Optional[Any] = None) -> Optional[str]:
    """Log an attack event: attacker → target for N damage."""
    defeated_suffix = ' (**defeated**)' if defeated else ''
    msg = f'⚡ **{attacker}** attacks **{target}** — {damage} damage{defeated_suffix}.'
    return log_action(game_id, msg, phase='ATTACK', icon='attack',
                      backend=backend)


def log_activation(game_id: str, figure_key: str, player_num: int,
                   *, backend: Optional[Any] = None) -> Optional[str]:
    """Log a figure activation."""
    msg = f'🚩 Player {player_num} activates **{figure_key}**.'
    return log_action(game_id, msg, phase='ACTIVATION', icon='activate',
                      backend=backend)


def log_round_transition(game_id: str, new_round: int,
                         *, backend: Optional[Any] = None) -> Optional[str]:
    msg = f'🔵 Round **{new_round}** begins.'
    return log_action(game_id, msg, phase='ROUND', icon='round',
                      backend=backend)


def log_vp_award(game_id: str, player_num: int, amount: int, reason: str,
                 *, backend: Optional[Any] = None) -> Optional[str]:
    msg = f'🏆 Player {player_num} gains **{amount} VP** ({reason}).'
    return log_action(game_id, msg, phase='ROUND', icon='round',
                      backend=backend)


def log_game_over(game_id: str, winner: Optional[int], reason: str,
                  *, backend: Optional[Any] = None) -> Optional[str]:
    if winner is None:
        msg = f'🏁 **Game Over** — draw ({reason}).'
    else:
        msg = f'🏁 **Game Over** — Player {winner} wins ({reason}).'
    return log_action(game_id, msg, phase='ROUND', icon='round',
                      backend=backend)


def log_cc_play(game_id: str, player_num: int, card_name: str,
                *, backend: Optional[Any] = None) -> Optional[str]:
    msg = f'🃏 Player {player_num} plays **{card_name}**.'
    return log_action(game_id, msg, phase='ACTION', icon='card',
                      backend=backend)


def log_dc_special(game_id: str, figure_key: str, ability_label: str,
                   *, backend: Optional[Any] = None) -> Optional[str]:
    msg = f'✨ **{figure_key}** uses **{ability_label}**.'
    return log_action(game_id, msg, phase='ACTION', icon='attack',
                      backend=backend)


def get_log_history(game_id: str,
                    *, backend: Optional[Any] = None) -> List[Dict[str, Any]]:
    """Return the full log-message history for a game.

    Used by tests + /logs slash command. Order is insertion order.
    """
    from python.discord_bot import game_channels as gc
    channel_id = gc.get_log_channel(game_id)
    if not channel_id:
        return []
    be = _get_backend(backend)
    return be.list_messages(channel_id)
