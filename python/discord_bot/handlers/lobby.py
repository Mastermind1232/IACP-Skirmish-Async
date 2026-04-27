"""Lobby Discord handlers — thin port of src/handlers/lobby.js.

The bot keeps an in-memory `lobbies` dict keyed by threadId. Join and
Start buttons mutate those lobby entries. The heavy setup (channel
creation, createGameChannels) stays deferred — this module owns the
state-mutation half only.

  lobby_join_{threadId}   — second player joins the lobby
  lobby_start_{threadId}  — creator starts the game (sets 'Started')
"""
from __future__ import annotations

from typing import Any, Dict

from python.discord_bot.handlers import register


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


def _handle_lobby_join(interaction: Any,
                         ctx: Dict[str, Any]) -> Dict[str, Any]:
    """lobby_join_{threadId} — second player joins the lobby. Sets
    lobby.joinedId and lobby.status='Full'. Enforces the
    MAX_ACTIVE_GAMES_PER_PLAYER cap when ctx provides the counter.
    Mirrors src/handlers/lobby.js:16-61 state-mutation half.
    """
    cid = _cid(interaction)
    if not cid.startswith('lobby_join_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    thread_id = cid[len('lobby_join_'):]
    if not thread_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    lobbies = ctx.get('lobbies')
    if lobbies is None:
        return {'ok': False, 'reason': 'lobbies_not_in_context'}
    lobby = lobbies.get(thread_id)
    if lobby is None:
        return {'ok': False, 'reason': 'lobby_not_found',
                'threadId': thread_id}
    if lobby.get('joinedId'):
        return {'ok': False, 'reason': 'lobby_full'}

    joiner_id = _uid(interaction)
    creator_id = str(lobby.get('creatorId') or '')
    max_games = ctx.get('MAX_ACTIVE_GAMES_PER_PLAYER')
    count_fn = ctx.get('count_active_games_for_player')
    if (joiner_id and joiner_id != creator_id
            and callable(count_fn) and isinstance(max_games, int)):
        if count_fn(joiner_id) >= max_games:
            return {'ok': False, 'reason': 'max_active_games_reached',
                    'maxGames': max_games}

    lobby['joinedId'] = joiner_id
    lobby['status'] = 'Full'
    return {
        'ok': True, 'threadId': thread_id,
        'joinedId': joiner_id, 'creatorId': creator_id,
    }


def _handle_lobby_start(interaction: Any,
                          ctx: Dict[str, Any]) -> Dict[str, Any]:
    """lobby_start_{threadId} — creator starts the game. Validates both
    players present + creator is the presser + cap on active games.
    Mutates lobby.status='Started' but does NOT create channels (that's
    a Discord API call handled by the bot layer).

    Mirrors src/handlers/lobby.js:68-130 state-mutation half.
    """
    cid = _cid(interaction)
    if not cid.startswith('lobby_start_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    thread_id = cid[len('lobby_start_'):]
    if not thread_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    lobbies = ctx.get('lobbies')
    if lobbies is None:
        return {'ok': False, 'reason': 'lobbies_not_in_context'}
    lobby = lobbies.get(thread_id)
    if lobby is None or not lobby.get('joinedId'):
        return {'ok': False, 'reason': 'lobby_not_ready',
                'threadId': thread_id}

    starter_id = _uid(interaction)
    creator_id = str(lobby.get('creatorId') or '')
    if starter_id != creator_id:
        return {'ok': False, 'reason': 'only_creator_can_start'}

    lobby['status'] = 'Started'
    return {
        'ok': True, 'threadId': thread_id,
        'creatorId': creator_id, 'joinedId': lobby.get('joinedId'),
    }


# Lobby buttons migrated to discord.py-native DynamicItems in
# python/discord_bot/views/lobby.py. Custom-router registration
# is intentionally disabled to avoid double-dispatch.
#
# register('lobby_join_', _handle_lobby_join, 'core')
# register('lobby_start_', _handle_lobby_start, 'core')
