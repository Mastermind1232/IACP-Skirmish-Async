"""Post-combat Discord handlers — thin port of src/handlers/post-combat.js.

Covers the skip/dismiss paths of post-combat surge abilities. Each
clears the relevant `pending*` key; the "actually resolve" variants
(pick a card to interrogate / mastery pick) stay deferred until the
combat-orchestrator port advances the combat flow.

  reaction_skip_{gameId}      — clears pendingReaction
  mastery_skip_{gameId}       — clears pendingMastery
  interrogate_skip_{gameId}   — clears pendingInterrogate
"""
from __future__ import annotations

from typing import Any, Dict

from python.discord_bot.handlers import register
from python.discord_bot.handlers.combat_reactions import _make_reaction_skip


_handle_reaction_skip = _make_reaction_skip(
    'reaction_skip_', 'pendingReaction',
)
_handle_mastery_skip = _make_reaction_skip(
    'mastery_skip_', 'pendingMastery',
)
_handle_interrogate_skip = _make_reaction_skip(
    'interrogate_skip_', 'pendingInterrogate',
)


register('reaction_skip_', _handle_reaction_skip, 'core')
register('mastery_skip_', _handle_mastery_skip, 'core')
register('interrogate_skip_', _handle_interrogate_skip, 'core')
