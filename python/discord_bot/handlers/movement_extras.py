"""Movement-related dismiss/skip Discord handlers (thin UI layer).

Covers the pure-dismiss buttons from src/handlers/movement.js that
only clear a pending scratch-state key. The heavy interactive paths
(move interrupt play, overwatch interrupt use, dio follow pick,
massive push, etc.) will land when their full UI scaffolding does.

  mvint_skip_{gameId}_{triggerType}_{figureKey}   — move interrupt skip
  ow_interrupt_skip_{gameId}_{msgId}              — overwatch interrupt skip
  dio_stay_{gameId}                               — Dio stay (no follow)
"""
from __future__ import annotations

from typing import Any, Dict

from python.discord_bot.handlers import register
from python.discord_bot.handlers.combat_special_effects import (
    _make_pending_skip_handler,
)


_handle_mvint_skip = _make_pending_skip_handler(
    'mvint_skip_', 'pendingMoveInterrupt', allow_trailing=True,
)
_handle_ow_interrupt_skip = _make_pending_skip_handler(
    'ow_interrupt_skip_', 'pendingOverwatchInterrupt', allow_trailing=True,
)
_handle_dio_stay = _make_pending_skip_handler(
    'dio_stay_', 'pendingDioFollow',
)


register('mvint_skip_', _handle_mvint_skip, 'core')
register('ow_interrupt_skip_', _handle_ow_interrupt_skip, 'core')
register('dio_stay_', _handle_dio_stay, 'core')
