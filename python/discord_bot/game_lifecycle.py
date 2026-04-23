"""Game lifecycle — Discord-layer wrapper around the engine's game flow.

Provides a small API the Discord slash-command / button handlers can
call to manage a game's full arc:

  new_game(player1_id, player2_id, ...) → GameState
  setup_game(game, squads, map_id, variant) → GameState  (deploys + init)
  end_game(game, winner=..., reason=...) → GameState      (marks terminal)
  format_game_status(game) → dict                         (for embed rendering)

No Discord imports here — kept pure so tests can exercise without a
discord.py dependency. The Discord bot's event wiring calls into these
functions and renders the results via components/action_buttons and
messages/updaters.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

from python.engine.creation import create_game
from python.engine.setup import run_setup
from python.engine.state import GameState


def new_game(player1_id: str, player2_id: str,
             map_id: Optional[str] = None,
             game_id: Optional[str] = None) -> GameState:
    """Create a fresh GameState with both player IDs attached.

    Initializes the state to the squad-submission phase. No figures
    deployed; no map selected yet unless `map_id` is supplied (in which
    case caller can go straight to setup_game).
    """
    g = create_game(map_id=map_id) if map_id else create_game()
    g.data['player1Id'] = player1_id
    g.data['player2Id'] = player2_id
    if game_id:
        g.data['gameId'] = game_id
    # Pre-setup state: phase is 'lobby'/None until both squads submitted
    # and run_setup called. UI layer uses 'lobby' to show squad-pick UI.
    g.data['phase'] = 'lobby'
    return g


def setup_game(game: GameState,
               player1_squad: Mapping[str, Any],
               player2_squad: Mapping[str, Any],
               map_id: str,
               variant: str = 'a',
               zone: str = 'red') -> GameState:
    """Run the full setup chain: squads → map → initiative → zone → deploy
    → CC draw → round 1.

    Wraps python.engine.setup.run_setup with lifecycle bookkeeping.
    After return, game is in 'round_active' and legal_actions() returns
    the initiative player's activation options.
    """
    return run_setup(game, player1_squad, player2_squad, map_id, variant, zone)


def end_game(game: GameState,
             winner: Optional[int] = None,
             reason: str = 'manual') -> GameState:
    """Mark a game as terminated. Idempotent — no-op when already ended.

    Sets phase='game_over', winner (player_num or None for draw), and
    gameEndedReason.
    """
    if game.data.get('phase') == 'game_over':
        return game
    game.data['phase'] = 'game_over'
    game.data['winner'] = winner
    game.data['gameEndedReason'] = reason
    return game


def format_game_status(game: GameState) -> Dict[str, Any]:
    """Extract a renderable snapshot for Discord embeds.

    Returns a dict with:
      phase, round, roundPhase, activePlayer, initiativeHolder
      activationsRemaining, p1/p2 VP totals, p1/p2 figure count,
      winner (if any), gameEndedReason (if any).
    """
    data = game.data if hasattr(game, 'data') else game
    vp1 = (data.get('player1VP') or {}).get('total', 0) or 0
    vp2 = (data.get('player2VP') or {}).get('total', 0) or 0
    f1 = len((data.get('figurePositions') or {}).get(1, {}) or {})
    f2 = len((data.get('figurePositions') or {}).get(2, {}) or {})
    return {
        'phase': data.get('phase'),
        'round': data.get('round'),
        'roundPhase': data.get('roundPhase'),
        'activePlayer': data.get('activePlayer'),
        'initiativeHolder': data.get('initiativeHolder'),
        'activationsRemaining': data.get('activationsRemaining'),
        'player1Id': data.get('player1Id'),
        'player2Id': data.get('player2Id'),
        'vp': {1: vp1, 2: vp2},
        'figureCount': {1: f1, 2: f2},
        'winner': data.get('winner'),
        'gameEndedReason': data.get('gameEndedReason'),
        'mapId': data.get('mapId') or (data.get('selectedMap') or {}).get('id'),
    }


def is_ready_to_play(game: GameState) -> bool:
    """True iff the game is mid-round and legal actions should be offered."""
    return (
        game.data.get('phase') == 'round_active'
        and game.data.get('roundPhase') == 'activation'
    )


def is_game_over(game: GameState) -> bool:
    """True iff terminal."""
    return game.data.get('phase') == 'game_over'
