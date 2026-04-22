"""Initial game-state constructor — mirrors the JS literal at
`src/game-creation.js:242-266` with Discord-only fields excluded.

At this lifecycle point (post-squad-submit, pre-initiative) only a small
subset of the 411-field surface is populated; everything else remains
absent (JS: undefined) and is recovered by downstream phase handlers as
the game progresses.
"""
from .phases import Phase
from .state import GameState

CURRENT_GAME_VERSION = 1


def create_game(p1_squad=None, p2_squad=None, map_id=None, mission=None,
                game_id='TEST_GAME', player1_id='p1', player2_id='p2'):
    """Build a fresh GameState equivalent to the JS initial literal.

    Args:
        p1_squad, p2_squad: Squad dicts (or None pre-submit).
        map_id: Selected map identifier (or None pre-selection).
        mission: Mission identifier.
        game_id, player1_id, player2_id: Identity fields.

    Phase starts at LOBBY (no map), advances to MAP_SELECTION if only
    identity known, INITIATIVE if map + both squads present.
    """
    if map_id and p1_squad and p2_squad:
        phase = Phase.INITIATIVE.value
    elif game_id:
        phase = Phase.MAP_SELECTION.value
    else:
        phase = Phase.LOBBY.value

    data = {
        'gameId': game_id,
        'version': CURRENT_GAME_VERSION,
        'player1Id': player1_id,
        'player2Id': player2_id,
        'player1Squad': p1_squad,
        'player2Squad': p2_squad,
        'selectedMap': map_id,
        'mission': mission,
        'player1VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'player2VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'phase': phase,
        'ended': False,
    }
    return GameState(data)
