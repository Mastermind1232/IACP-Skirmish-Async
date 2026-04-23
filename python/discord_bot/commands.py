"""Slash command handlers — pure Python, no discord.py imports.

These functions implement the business logic behind the bot's slash
commands (/startgame, /squad, /status, /forfeit, etc.). The Discord
event wiring in main.py attaches them to discord.Client's
command tree; tests exercise them directly.

Each command takes (user_id, deps, **params) and returns a dict with
at minimum {'ok': bool} plus command-specific fields.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

from python.discord_bot.game_lifecycle import (
    end_game,
    format_game_status,
    is_game_over,
    new_game,
    setup_game,
)


def _game_store(deps: Dict[str, Any]):
    return deps.get('game_store') or deps.get('_store')


def _save(deps: Dict[str, Any], game_id: str, game: Any) -> None:
    store = _game_store(deps)
    if store is None:
        return
    if hasattr(store, 'save'):
        store.save(game_id, game)
    elif isinstance(store, dict):
        store[game_id] = game


def _get(deps: Dict[str, Any], game_id: str) -> Any:
    store = _game_store(deps)
    if store is None:
        return None
    if hasattr(store, 'get'):
        return store.get(game_id)
    if isinstance(store, dict):
        return store.get(game_id)
    return None


def cmd_startgame(user_id: str, deps: Dict[str, Any], *,
                  opponent_id: str,
                  game_id: Optional[str] = None) -> Dict[str, Any]:
    """Start a new game between user_id (P1) and opponent_id (P2).

    Creates a GameState with phase='lobby'. Caller must follow up with
    cmd_squad (both players) and cmd_startbattle to run setup.
    """
    if not user_id or not opponent_id:
        return {'ok': False, 'reason': 'missing_user_ids'}
    if user_id == opponent_id:
        return {'ok': False, 'reason': 'cannot_play_self'}
    gid = game_id or _default_game_id(user_id, opponent_id)
    if _get(deps, gid) is not None:
        return {'ok': False, 'reason': 'game_id_taken', 'gameId': gid}
    g = new_game(user_id, opponent_id, game_id=gid)
    _save(deps, gid, g)
    return {
        'ok': True, 'gameId': gid, 'player1Id': user_id,
        'player2Id': opponent_id, 'phase': 'lobby',
    }


def cmd_squad(user_id: str, deps: Dict[str, Any], *,
              game_id: str,
              deployment_cards: list,
              cc_cards: Optional[list] = None) -> Dict[str, Any]:
    """Submit this user's squad for game_id. Stores under
    player{1|2}Squad based on the player's slot.
    """
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    if game.data.get('phase') != 'lobby':
        return {'ok': False, 'reason': 'game_not_in_lobby'}
    if user_id == game.data.get('player1Id'):
        slot = 1
    elif user_id == game.data.get('player2Id'):
        slot = 2
    else:
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    squad = {'deploymentCards': list(deployment_cards)}
    if cc_cards:
        squad['ccCards'] = list(cc_cards)
    game.data[f'player{slot}Squad'] = squad
    _save(deps, game_id, game)
    both_in = bool(
        game.data.get('player1Squad') and game.data.get('player2Squad')
    )
    return {
        'ok': True, 'gameId': game_id, 'playerNum': slot,
        'bothSquadsSubmitted': both_in,
    }


def cmd_startbattle(user_id: str, deps: Dict[str, Any], *,
                    game_id: str,
                    map_id: str,
                    variant: str = 'a',
                    zone: str = 'red') -> Dict[str, Any]:
    """Transition game from lobby → round_active by running setup.

    Requires both squads submitted. Map + variant + zone chosen by the
    initiative player (usually).
    """
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    if game.data.get('phase') != 'lobby':
        return {'ok': False, 'reason': 'game_not_in_lobby'}
    p1_squad = game.data.get('player1Squad')
    p2_squad = game.data.get('player2Squad')
    if not p1_squad or not p2_squad:
        return {'ok': False, 'reason': 'squads_not_submitted'}
    if user_id not in (game.data.get('player1Id'), game.data.get('player2Id')):
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    game = setup_game(game, p1_squad, p2_squad, map_id, variant=variant, zone=zone)
    _save(deps, game_id, game)
    return {
        'ok': True, 'gameId': game_id,
        'phase': game.data.get('phase'),
        'round': game.data.get('round'),
        'activePlayer': game.data.get('activePlayer'),
        'initiativeHolder': game.data.get('initiativeHolder'),
    }


def cmd_status(user_id: str, deps: Dict[str, Any], *,
               game_id: str) -> Dict[str, Any]:
    """Return a snapshot of the game for embed rendering."""
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    status = format_game_status(game)
    return {'ok': True, 'gameId': game_id, 'status': status}


def cmd_forfeit(user_id: str, deps: Dict[str, Any], *,
                game_id: str) -> Dict[str, Any]:
    """Forfeit the game — user_id loses, opponent wins."""
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    if is_game_over(game):
        return {'ok': False, 'reason': 'game_already_ended'}
    if user_id == game.data.get('player1Id'):
        loser = 1
    elif user_id == game.data.get('player2Id'):
        loser = 2
    else:
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    winner = 2 if loser == 1 else 1
    game = end_game(game, winner=winner, reason='forfeit')
    _save(deps, game_id, game)
    return {
        'ok': True, 'gameId': game_id, 'winner': winner,
        'reason': 'forfeit', 'forfeitedBy': loser,
    }


def cmd_list_games(user_id: str, deps: Dict[str, Any]) -> Dict[str, Any]:
    """List all games where user_id is a player."""
    store = _game_store(deps)
    if store is None:
        return {'ok': False, 'reason': 'no_game_store'}
    if hasattr(store, 'list_ids'):
        ids = store.list_ids()
    elif isinstance(store, dict):
        ids = list(store.keys())
    else:
        return {'ok': False, 'reason': 'no_list_method'}
    mine = []
    for gid in ids:
        g = _get(deps, gid)
        if g is None:
            continue
        if user_id in (g.data.get('player1Id'), g.data.get('player2Id')):
            mine.append({
                'gameId': gid,
                'status': format_game_status(g),
            })
    return {'ok': True, 'userId': user_id, 'games': mine}


def _default_game_id(p1: str, p2: str) -> str:
    """Deterministic short id for the {p1, p2} pair."""
    a, b = sorted([p1 or '_', p2 or '_'])
    return f'{a[:6]}-{b[:6]}'
