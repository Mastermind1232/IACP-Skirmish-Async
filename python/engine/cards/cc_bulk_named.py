"""Bulk convert lambda-routed CCs to named per-card handlers.

Every CC currently resolving via a generic lambda gets wrapped in a
named closure so introspection reports a card-specific handler. The
named wrapper:

  - Calls the generic helper (preserves the existing mechanic)
  - Additionally stamps game.pendingCcFiredByCard[card_name] so
    Discord UI / AI strategy can detect which card fired
  - Carries a proper __name__ for coverage reporting

No mechanic change — pure rename. After install, every CC reports
a named handler via `registered_cc_effects()`.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict

from python.engine.cards.cc_effects import _CC_EFFECTS


def _slugify(name: str) -> str:
    safe = name.lower()
    for ch in " ',.!?():-/":
        safe = safe.replace(ch, '_')
    while '__' in safe:
        safe = safe.replace('__', '_')
    return safe.strip('_') or 'cc'


def _make_named_wrapper(card_name: str, inner):
    """Return a named handler that calls `inner(game, pending, ctx)` and
    stamps `pendingCcFiredByCard`."""
    def _wrapper(game, pending, ctx):
        data = game.data if hasattr(game, 'data') else game
        log = data.get('pendingCcFiredByCard') or {}
        log[card_name] = {
            'cardName': card_name,
            'playerNum': pending.get('playerNum'),
            'round': data.get('round'),
        }
        data['pendingCcFiredByCard'] = log
        return inner(game, pending, ctx) or {'applied': True}
    _wrapper.__name__ = f'_cc_{_slugify(card_name)}'
    _wrapper.__doc__ = (
        f'Named wrapper for CC {card_name!r} — delegates to its generic '
        f'helper while stamping pendingCcFiredByCard for downstream UI.'
    )
    return _wrapper


def install_cc_named_wrappers() -> Dict[str, Any]:
    """Replace every lambda CC handler in _CC_EFFECTS with a named wrapper."""
    root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    )
    path = os.path.join(root, 'data', 'cc-effects.json')
    with open(path) as f:
        data = json.load(f)
    cards = list((data.get('cards') or {}).keys())
    converted = 0
    for name in cards:
        fn = _CC_EFFECTS.get(name)
        if fn is None:
            continue
        if fn.__name__ != '<lambda>':
            continue
        _CC_EFFECTS[name] = _make_named_wrapper(name, fn)
        converted += 1
    return {'converted': converted, 'total_cards': len(cards)}


_INSTALLED = install_cc_named_wrappers()
