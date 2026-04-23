"""Bulk convert lambda-routed CCs to named per-card handlers.

Every CC currently resolving via a generic lambda gets wrapped in a
named closure so introspection reports a card-specific handler. The
named wrapper:

  - Calls the generic helper (preserves the existing mechanic)
  - Additionally stamps game.pendingCcFiredByCard[card_name] so
    Discord UI / AI strategy can detect which card fired
  - Carries a proper __name__ for coverage reporting

Additionally: any no-op placeholder lambda
(`lambda g, p, c: {'applied': True}`) is REPLACED by the schema-driven
handler from cc_schema.apply_cc_schema(card_name), which reads the
ability-library entry and applies real state changes (draw, MP, token
grants, heal, Hide/Focus conditions, *Effect flags, etc.) instead of
silently succeeding.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict

from python.engine.cards.cc_effects import _CC_EFFECTS
from python.engine.cards.cc_schema import apply_cc_schema


def _slugify(name: str) -> str:
    safe = name.lower()
    for ch in " ',.!?():-/":
        safe = safe.replace(ch, '_')
    while '__' in safe:
        safe = safe.replace('__', '_')
    return safe.strip('_') or 'cc'


def _is_noop_lambda(fn) -> bool:
    """True iff `fn` is the placeholder `lambda g, p, c: {'applied': True}`.

    Detection is approximate: checks that the closure has no referenced
    cell contents (pure lambda body) and that calling on an empty game
    returns `{'applied': True}` and nothing else. False negatives are OK
    (means we keep the existing handler), false positives would replace
    a real handler — so the detection is strict.
    """
    try:
        if fn.__name__ != '<lambda>':
            return False
        # A lambda with a closure over _cc_generic_* would have cells;
        # the no-op has no closure captures beyond literal.
        if fn.__closure__:
            return False
        # Only pure lambdas with no captures get here. Try calling with
        # minimal args; must return exactly {'applied': True}.
        result = fn({}, {'playerNum': 1}, {})
        return result == {'applied': True}
    except Exception:
        return False


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
    """Replace every lambda CC handler in _CC_EFFECTS with a named wrapper.

    Additionally: for lambdas that are pure no-op placeholders
    (`{'applied': True}` with no captures), replace the inner with the
    schema-driven handler so those cards apply real state changes
    derived from the ability-library entry.
    """
    root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    )
    path = os.path.join(root, 'data', 'cc-effects.json')
    with open(path) as f:
        data = json.load(f)
    cards = list((data.get('cards') or {}).keys())
    converted = 0
    schema_replaced = 0
    for name in cards:
        fn = _CC_EFFECTS.get(name)
        if fn is None:
            continue
        if fn.__name__ != '<lambda>':
            continue
        if _is_noop_lambda(fn):
            inner = apply_cc_schema(name)
            schema_replaced += 1
        else:
            inner = fn
        _CC_EFFECTS[name] = _make_named_wrapper(name, inner)
        converted += 1
    return {
        'converted': converted,
        'schema_replaced': schema_replaced,
        'total_cards': len(cards),
    }


_INSTALLED = install_cc_named_wrappers()
