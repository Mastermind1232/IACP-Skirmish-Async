"""M3-I: phase-gate state management — Python mirror of src/game/phase-gate.js.

Phase gates are the "both players ready" confirmations between game-round
phases (deployment → CC draw, activation → end-of-round, etc.). Each gate
tracks per-player ready bits; transitions fire when both are True.

Scope of this module:
  - State shape: `game['phaseGate'] = {phase, p1Ready, p2Ready, p1MsgId, p2MsgId}`.
  - create / record-ready / record-unready / clear.
  - playerNumFromId helper.

Observability (getWaitingPlayers, per-phase combat sub-state inspection)
lives in `python/discord_bot/messages/*` when the Discord UI ports in
Phase 12 — it's UI-only, no game-state mutation.

Parity contract: byte-identical to phase-gate.js return shapes (camelCase
keys: alreadyReady, bothReady, playerNum, etc.) since these values flow
through the JS handlers that consume them during the parity window.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping, Optional


# Per-phase prompt labels. {round} is a stand-in patched by callers.
PHASE_GATE_LABELS: Dict[str, str] = {
    'deploy_done':         'Currently in Deployment. Ready to proceed to Command Card Draw?',
    'attach_done':         'Currently in Attachments. Ready to proceed to Deployment?',
    'cc_drawn':            'Currently in Command Card Draw. Ready to proceed to Round {round}?',
    'pre_end_of_round':    'Currently in Round {round} Activation. Ready to proceed to End of Round?',
    'post_end_of_round':   'Currently in Round {round} End of Round. Ready to proceed to Status Phase?',
    'post_start_of_round': 'Currently in Round {round} Start of Round. Effects resolved — ready to proceed?',
    'pre_activation':      'Currently in Round {round} Start of Round. Ready to begin Activation?',
}


def create_phase_gate(game: Any, phase: str) -> None:
    """Install a fresh phase gate on the game object.

    Mutates game['phaseGate']. Caller is responsible for ensuring the
    previous gate (if any) was cleared.
    """
    data = _data(game)
    data['phaseGate'] = {
        'phase': phase,
        'p1Ready': False,
        'p2Ready': False,
        'p1MsgId': None,
        'p2MsgId': None,
    }


def record_phase_gate_ready(game: Any, user_id: str) -> Dict[str, Any]:
    """Mark a player as ready.

    Test-game mode (`game.isTestGame` truthy): P1 clicks for both. First
    click = P1, second = P2 — matches src/game/phase-gate.js:43-60.

    Returns `{'alreadyReady': bool, 'bothReady': bool, 'playerNum': int}`.
    """
    data = _data(game)
    gate = data.get('phaseGate')
    if not gate:
        return {'alreadyReady': False, 'bothReady': False, 'playerNum': 0}

    player_num = player_num_from_id(game, user_id)

    if data.get('isTestGame') and player_num == 1:
        player_num = 2 if gate.get('p1Ready') else 1

    key = 'p1Ready' if player_num == 1 else 'p2Ready'
    if gate.get(key):
        return {'alreadyReady': True, 'bothReady': False, 'playerNum': player_num}

    gate[key] = True
    both_ready = bool(gate.get('p1Ready')) and bool(gate.get('p2Ready'))
    return {'alreadyReady': False, 'bothReady': both_ready, 'playerNum': player_num}


def record_phase_gate_unready(game: Any, user_id: str) -> Dict[str, Any]:
    """Mark a player as unready.

    Test-game mode: un-readies whichever was last readied (P2 first, then
    P1) — matches src/game/phase-gate.js:68-85.

    Returns `{'alreadyUnready': bool, 'playerNum': int}`.
    """
    data = _data(game)
    gate = data.get('phaseGate')
    if not gate:
        return {'alreadyUnready': True, 'playerNum': 0}

    player_num = player_num_from_id(game, user_id)

    if data.get('isTestGame') and player_num == 1:
        if gate.get('p2Ready'):
            player_num = 2
        else:
            player_num = 1

    key = 'p1Ready' if player_num == 1 else 'p2Ready'
    if not gate.get(key):
        return {'alreadyUnready': True, 'playerNum': player_num}

    gate[key] = False
    return {'alreadyUnready': False, 'playerNum': player_num}


def clear_phase_gate(game: Any) -> None:
    """Remove the phase gate from the game object (sets to None)."""
    data = _data(game)
    data['phaseGate'] = None


def player_num_from_id(game: Any, user_id: str) -> int:
    """Return player number (1 or 2) for a Discord user id, or 0 if unknown."""
    data = _data(game)
    if user_id and user_id == data.get('player1Id'):
        return 1
    if user_id and user_id == data.get('player2Id'):
        return 2
    return 0


# ---------------------------------------------------------------------------

def _data(game: Any) -> Dict[str, Any]:
    """Unwrap GameState → dict if needed. Tolerates plain dicts too."""
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'phase_gate expected GameState or dict, got {type(game).__name__}'
    )
