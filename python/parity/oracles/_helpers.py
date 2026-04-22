"""Python mirrors of the JS oracle-test helpers.

The JS oracle suite (127 files under `tests/domain/oracle/`) rides three helpers:
    buildGame(fixtureSpec)     -> game object
    act(game, customId, userId, opts?) -> game'
    gateGame(game)             -> list of actionable prompts for the active player

This module declares thin Python equivalents so oracle tests port 1:1. The
actual implementations depend on engine deliverables: build_game needs D1 state
+ D4 card systems to construct a fully-populated mid-game state; act needs D2–D5
engine dispatch; gate_game needs D2 available-actions.

During the D1 slice these helpers are **stubs that raise NotImplementedError**
with a targeted message pointing to the blocking deliverable. This is the honest
reflection of state and the signal for test-suite discovery later: oracle tests
ported early fail with a clear "waiting on Dx" message until Dx lands.
"""
from typing import Any, Dict, List, Optional

from python.engine.state import GameState


class OracleHelperPending(NotImplementedError):
    """Raised when an oracle helper is called before its backing deliverable lands."""


def build_game(spec: Dict[str, Any]) -> GameState:
    """Construct a game state from a fixture spec (squads, map, mission,
    figure positions, hands, etc.).

    JS analogue: `buildGame` in `tests/fixtures/game-builder.js`.
    Blocked on: D4 (card systems — needs CC draw + DC activation state),
    D5 (mission rules — needs zone-control scaffolding), D2 mechanics for
    figure placement.
    """
    raise OracleHelperPending(
        'build_game requires D2+D4+D5. Stub only until those deliverables land.'
    )


def act(game: GameState, custom_id: str, user_id: str,
        opts: Optional[Dict[str, Any]] = None) -> GameState:
    """Submit an action and return the resulting state.

    JS analogue: `harness.submitAction` in `src/headless/game-harness.js`.
    Blocked on: D2–D5 action-dispatch pipeline. Engine-level action
    routing (action-types.py:build_custom_id) exists but the handlers it
    routes to do not yet.
    """
    raise OracleHelperPending(
        'act() requires D2+D3+D4 action dispatch. Stub only.'
    )


def gate_game(game: GameState) -> List[Dict[str, Any]]:
    """Return the list of actionable prompts for the acting player.

    JS analogue: `getAvailableActions` in `src/engine/available-actions.js`.
    Blocked on: D2 (movement/combat legality) + D4 (CC timing windows).
    """
    raise OracleHelperPending(
        'gate_game() requires D2 + D4 available-actions port.'
    )
