"""Per-game channel tracking — maps game-id to the Discord channels /
messages that render that game.

Each game's UI state is broken across:
  - board channel + board message (main game view, edited on every action)
  - log channel (append-only action log)
  - p1/p2 play-area channels (showing the player's DCs and hand)
  - p1/p2 hand threads (CC hand display, private to each player)

This module owns the bookkeeping so handler code can:
  get_board_message(game_id) → (channel_id, message_id)
  set_board_message(game_id, channel_id, message_id)
  refresh_game_view(game_id, game_store, backend?)

refresh_game_view re-renders the board-message with the current game
state. Called on every action that changes state.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


# In-memory mapping of game_id → channel assignments.
# Production uses a DB-backed version keyed by the game table.
_channel_map: Dict[str, Dict[str, Any]] = {}


def _slot(game_id: str) -> Dict[str, Any]:
    if game_id not in _channel_map:
        _channel_map[game_id] = {}
    return _channel_map[game_id]


def set_board_message(game_id: str, channel_id: str,
                       message_id: Optional[str]) -> None:
    """Remember where the main game view lives for this game."""
    s = _slot(game_id)
    s['board_channel_id'] = channel_id
    s['board_message_id'] = message_id


def get_board_message(game_id: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (channel_id, message_id) for the game's main view, if set."""
    s = _channel_map.get(game_id) or {}
    return s.get('board_channel_id'), s.get('board_message_id')


def set_log_channel(game_id: str, channel_id: str) -> None:
    _slot(game_id)['log_channel_id'] = channel_id


def get_log_channel(game_id: str) -> Optional[str]:
    return (_channel_map.get(game_id) or {}).get('log_channel_id')


def set_game_category(game_id: str, category_id: str) -> None:
    _slot(game_id)['game_category_id'] = category_id


def get_game_category(game_id: str) -> Optional[str]:
    return (_channel_map.get(game_id) or {}).get('game_category_id')


def set_chat_channel(game_id: str, channel_id: str) -> None:
    _slot(game_id)['chat_channel_id'] = channel_id


def get_chat_channel(game_id: str) -> Optional[str]:
    return (_channel_map.get(game_id) or {}).get('chat_channel_id')


def set_play_area(game_id: str, player_num: int, channel_id: str) -> None:
    key = f'p{player_num}_play_area_channel_id'
    _slot(game_id)[key] = channel_id


def get_play_area(game_id: str, player_num: int) -> Optional[str]:
    key = f'p{player_num}_play_area_channel_id'
    return (_channel_map.get(game_id) or {}).get(key)


def set_hand_channel(game_id: str, player_num: int,
                      channel_id: str,
                      message_id: Optional[str] = None) -> None:
    """Record the thread/channel id for a player's private CC hand view."""
    s = _slot(game_id)
    s[f'p{player_num}_hand_channel_id'] = channel_id
    if message_id is not None:
        s[f'p{player_num}_hand_message_id'] = message_id


def get_hand_channel(game_id: str, player_num: int
                      ) -> Tuple[Optional[str], Optional[str]]:
    s = _channel_map.get(game_id) or {}
    return (
        s.get(f'p{player_num}_hand_channel_id'),
        s.get(f'p{player_num}_hand_message_id'),
    )


def get_all(game_id: str) -> Dict[str, Any]:
    """Return the full channel-assignment dict for this game."""
    return dict(_channel_map.get(game_id) or {})


def clear(game_id: str) -> None:
    """Remove all channel assignments for a game (on delete/cleanup)."""
    _channel_map.pop(game_id, None)


def list_games() -> List[str]:
    return list(_channel_map.keys())


# ── Refresh helpers ────────────────────────────────────────────────────────

def refresh_game_view(game_id: str, game: Any,
                       backend: Optional[Any] = None) -> bool:
    """Re-render the main board message for game_id.

    Posts a new one if the message doesn't exist yet; edits the existing
    one otherwise. Returns True on success.
    """
    from python.discord_bot.channels import (
        post_game_view, update_game_view,
    )
    channel_id, message_id = get_board_message(game_id)
    if not channel_id:
        return False
    if message_id:
        ok = update_game_view(channel_id, message_id, game, backend=backend)
        if ok:
            return True
        # Message was deleted server-side — fall through to re-post.
    new_id = post_game_view(channel_id, game, backend=backend)
    if new_id:
        set_board_message(game_id, channel_id, new_id)
        return True
    return False


def refresh_hand_view(game_id: str, player_num: int, game: Any,
                      backend: Optional[Any] = None) -> bool:
    """Re-render the player's CC hand message."""
    from python.discord_bot.channels import get_default_backend
    from python.discord_bot.messages.updaters import build_hand_display
    channel_id, message_id = get_hand_channel(game_id, player_num)
    if not channel_id:
        return False
    be = backend or get_default_backend()
    payload = build_hand_display(game, player_num)
    if message_id:
        ok = be.edit(channel_id, message_id, payload)
        if ok:
            return True
    new_id = be.post(channel_id, payload)
    if new_id:
        set_hand_channel(game_id, player_num, channel_id, new_id)
        return True
    return False


# Test-only reset.
def _reset_for_tests() -> None:
    _channel_map.clear()
