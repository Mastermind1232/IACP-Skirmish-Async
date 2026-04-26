"""Undo stack for the engine.

Mirrors JS pushUndo / popUndo in src/game-state.js. Each mutating
handler (move, attack, special, CC play) deep-copies the prior game
state and appends to game['undoStack']. pop_undo restores it.

Stack capped at 10 entries so we don't blow up game-state size.
JSON-serializable: each stack entry is a plain dict snapshot.
"""
from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional


# Maximum stack depth. JS's UI offers undo for the last action;
# 10 gives some headroom while keeping state size bounded.
UNDO_STACK_MAX = 10


# Fields excluded from the undo snapshot. These are either:
#   - Per-step ephemera that shouldn't restore (lastCombatResult,
#     lastDcSpecialResult)
#   - Heavy or recursive references (the undoStack itself!)
#   - Non-serializable Discord runtime IDs that don't affect engine state
EXCLUDE_FROM_UNDO_SNAPSHOT = frozenset({
    'undoStack',
    'lastCombatResult',
    'lastDcSpecialResult',
    'lastAttackOrchestration',
    'lastDcAbilityChoiceResult',
    'lastPounceResult',
    'lastEndOfRoundDcEvents',
    'lastStartOfRoundDcEvents',
    'lastDefeatInfo',
    'recordedAt',
})


def _state(game: Any) -> Dict[str, Any]:
    return game.data if hasattr(game, 'data') else game


def _build_snapshot(data: Dict[str, Any]) -> Dict[str, Any]:
    """Return a deep-copy of `data` with excluded fields stripped."""
    snapshot: Dict[str, Any] = {}
    for k, v in data.items():
        if k in EXCLUDE_FROM_UNDO_SNAPSHOT:
            continue
        snapshot[k] = copy.deepcopy(v)
    return snapshot


def push_undo(game: Any) -> None:
    """Append a snapshot of the game state to game['undoStack'].

    Mirrors JS pushUndo. Cap at UNDO_STACK_MAX entries — older entries
    are discarded FIFO.
    """
    data = _state(game)
    stack: List[Dict[str, Any]] = list(data.get('undoStack') or [])
    snapshot = _build_snapshot(data)
    stack.append(snapshot)
    if len(stack) > UNDO_STACK_MAX:
        stack = stack[-UNDO_STACK_MAX:]
    data['undoStack'] = stack


def pop_undo(game: Any) -> bool:
    """Restore the most recent snapshot. Returns True when an undo was
    performed, False when the stack was empty.

    Restores the snapshot's fields onto the live game, leaving the
    excluded fields (undoStack itself, lastCombatResult, etc.) alone.
    """
    data = _state(game)
    stack = list(data.get('undoStack') or [])
    if not stack:
        return False
    snapshot = stack.pop()
    # Pop the snapshot off the stack first so the stack itself is in
    # the correct shape after restore.
    data['undoStack'] = stack
    # Restore each field; deep-copy again so subsequent mutations don't
    # touch the snapshot.
    for k, v in snapshot.items():
        if k in EXCLUDE_FROM_UNDO_SNAPSHOT:
            continue
        data[k] = copy.deepcopy(v)
    return True


def peek_undo(game: Any) -> Optional[Dict[str, Any]]:
    """Read the top of the undo stack without popping. Returns None
    when the stack is empty."""
    data = _state(game)
    stack = data.get('undoStack') or []
    if not stack:
        return None
    return stack[-1]


def clear_undo(game: Any) -> None:
    """Empty the undo stack. Called at end of round / end of game so the
    next round starts fresh."""
    data = _state(game)
    data['undoStack'] = []
