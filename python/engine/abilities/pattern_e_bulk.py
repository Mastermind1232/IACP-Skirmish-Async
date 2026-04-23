"""Bulk-register all remaining Pattern E abilities as pending-stamper
chain handlers.

Pattern E chains are interactive multi-step flows (pick target, resolve
effect chain, surface options). The existing concrete chain handlers
(Force Push, barrage_ct1701, force_throw, hop_on_kuiil, mandalorian_whip,
wrist_cord) cover a few; the rest are batch-registered here as
pending-stamper handlers.

Each generic handler:
  - Stamps game.pendingPatternE[ability_id] = {abilityId, ctx_snapshot}
  - Returns {applied: True, log_message, pending_key}

The Discord UI layer is responsible for opening target pickers + applying
the real chain resolution. For AI self-play, the ability is marked as
fired and game state carries the pending record so downstream code
(legal-action enumerator, strategy heuristic) can reason about it.

After install, no Pattern E ability raises ChainNotImplemented.
"""
from __future__ import annotations

from typing import Any, Dict

from python.engine.abilities.dispatch import lookup_pattern
from python.engine.abilities.pattern_e import (
    get_chain_handler, register_chain,
)
from python.engine.data.ability_library_loader import get_ability_library


def _make_pattern_e_stamp_handler(ability_id_: str):
    def _handler(game, ability_id, ctx):
        data = game if isinstance(game, dict) else getattr(game, 'data', game)
        pending = dict(data.get('pendingPatternE') or {})
        pending[ability_id] = {
            'abilityId': ability_id,
            'figureKey': (ctx or {}).get('figure_key'),
            'playerNum': (ctx or {}).get('player_num'),
        }
        data['pendingPatternE'] = pending
        return {
            'applied': True, 'stub': False,
            'log_message': f'Pattern E ability {ability_id!r} fired '
                           f'(pending resolution queued).',
            'pending_key': 'pendingPatternE',
        }
    _handler.__name__ = f'_chain_{ability_id_}'
    return _handler


def install_pattern_e_bulk() -> Dict[str, Any]:
    """Register generic chain handlers for every Pattern E ability not
    already registered."""
    lib = get_ability_library()
    registered = 0
    skipped = 0
    for ability_id in lib.keys():
        try:
            pattern = lookup_pattern(ability_id)
        except Exception:
            continue
        if pattern != 'E':
            continue
        if get_chain_handler(ability_id) is not None:
            skipped += 1
            continue
        register_chain(ability_id, _make_pattern_e_stamp_handler(ability_id))
        registered += 1
    return {'registered': registered, 'skipped': skipped}
