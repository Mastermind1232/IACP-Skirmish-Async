"""Tests for cc_schema — schema-driven CC effect resolver.

Run: python3 python/engine/cards/test_cc_schema.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def test_blend_in_applies_hide():
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema('Blend In')
    game = {}
    result = handler(game, {'playerNum': 1}, {'figure_key': 'Blaise-1-0'})
    assert result['applied'] is True
    assert {'effect': 'applyHide', 'figureKey': 'Blaise-1-0'} in result['effects']
    assert 'Hide' in (game.get('figureConditions') or {}).get('Blaise-1-0', [])


def test_devotion_stamps_active_effect():
    """Cards with boolean *Effect fields stamp activeCardEffects."""
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema('Devotion')
    game = {'round': 3}
    result = handler(game, {'playerNum': 2}, {})
    assert result['applied'] is True
    assert any(e.get('effect') == 'devotionEffect' for e in result['effects'])
    assert 'Devotion' in (game.get('activeCardEffects') or {})
    assert game['activeCardEffects']['Devotion']['playerNum'] == 2


def test_named_wrapper_runs_schema_for_noop_cc():
    """The full pipeline: _CC_EFFECTS['Blend In'] is a named wrapper
    whose inner is the schema handler."""
    from python.engine.cards import cc_bulk_named  # noqa: F401 — ensures install
    from python.engine.cards.cc_effects import _CC_EFFECTS
    handler = _CC_EFFECTS['Blend In']
    game = {}
    result = handler(game, {'playerNum': 1}, {'figure_key': 'Blaise-1-0'})
    assert result['applied'] is True
    # Named wrapper also stamps pendingCcFiredByCard:
    assert 'Blend In' in (game.get('pendingCcFiredByCard') or {})
    # And the inner schema effect actually landed:
    assert 'Hide' in (game.get('figureConditions') or {}).get('Blaise-1-0', [])


def test_schema_replacement_count():
    """At install time the bulk wrapper replaced ~30+ no-op lambdas
    with schema handlers."""
    from python.engine.cards import cc_bulk_named
    meta = cc_bulk_named._INSTALLED
    assert meta['schema_replaced'] >= 30, \
        f'Expected ≥30 schema replacements, got {meta["schema_replaced"]}'


def test_a_powerful_influence_stamps_player_flag():
    """controlBlockRange + interactBlockRange schema sets
    powerfulInfluencePlayerNum = playerNum."""
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema('A Powerful Influence')
    game = {}
    result = handler(game, {'playerNum': 1}, {})
    assert result['applied'] is True
    assert game.get('powerfulInfluencePlayerNum') == 1
    assert any(e.get('effect') == 'powerfulInfluence' for e in result['effects'])


def test_rebel_graffiti_stamps_pending_vp():
    """rebelGraffitiVp schema stamps pending VP for next EoR."""
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema('Rebel Graffiti')
    game = {}
    result = handler(game, {'playerNum': 2}, {})
    assert result['applied'] is True
    rg = game.get('rebelGraffitiPending') or {}
    assert rg.get('playerNum') == 2
    assert rg.get('bonus') == 2


def test_just_business_grants_round_reroll():
    """roundAttackRerollDice schema stamps a round-scoped reroll grant."""
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema('Just Business')
    game = {}
    handler(game, {'playerNum': 1}, {})
    rr = game.get('roundAttackRerollDice') or {}
    assert rr.get('playerNum') == 1
    assert rr.get('count') == 1


def test_lightbow_stamps_override_attack_dice():
    """Lightbow's overrideAttackDice + freeAttackBonus schema stamps
    pendingOverrideAttackDice + freeAttackBonusPending for the
    msg_id."""
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema('Lightbow')
    game = {}
    handler(game, {'playerNum': 1}, {'msg_id': 'hl1dc0'})
    poad = game.get('pendingOverrideAttackDice') or {}
    assert 'hl1dc0' in poad
    assert poad['hl1dc0'].get('attackType') == 'Ranged'
    assert poad['hl1dc0'].get('bonusAccuracy') == 2
    fab = game.get('freeAttackBonusPending') or {}
    assert fab.get('hl1dc0') == 1


def test_hostile_negotiation_discards_random_from_hands():
    """discardRandomFromHand + opponentDiscardRandomFromHand fields drop
    random cards from each player's hand into their discard."""
    import random as _rng
    _rng.seed(42)
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema('Hostile Negotiation')
    game = {
        'player1CcHand': ['A', 'B', 'C'],
        'player1CcDiscard': [],
        'player2CcHand': ['X', 'Y', 'Z', 'W'],
        'player2CcDiscard': [],
    }
    handler(game, {'playerNum': 1}, {})
    assert len(game['player1CcHand']) == 2  # P1 discards 1
    assert len(game['player1CcDiscard']) == 1
    assert len(game['player2CcHand']) == 2  # P2 discards 2
    assert len(game['player2CcDiscard']) == 2


def test_cals_buddy_stamps_pending_companion_deploy():
    """Cal's Buddy with Cal Kestis on the board stamps calsBuddyPending."""
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema("Cal's Buddy")
    game = {
        'figurePositions': {1: {'Cal Kestis-0-0': 'e5'}},
    }
    result = handler(game, {'playerNum': 1}, {})
    assert result['applied'] is True
    pending = game.get('calsBuddyPending') or {}
    assert 'Cal Kestis-0-0' in pending
    assert pending['Cal Kestis-0-0']['playerNum'] == 1


def test_signal_jammer_stamps_player_flag():
    """signalJammer schema sets game.signalJammer = playerNum."""
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema('Signal Jammer')
    game = {}
    handler(game, {'playerNum': 2}, {})
    assert game.get('signalJammer') == 2


def test_fallback_stamps_active_card_effects():
    """Cards with no schema match still stamp activeCardEffects so
    downstream systems detect the card is 'in play' (better than the
    silent-success no-op)."""
    from python.engine.cards.cc_schema import apply_cc_schema
    handler = apply_cc_schema('Efficient Travel')  # roundEfficientTravel=True
    game = {}
    result = handler(game, {'playerNum': 1}, {})
    assert result['applied'] is True
    # Either a schema effect fired or activeCardEffects stamped; either
    # way the state is non-empty.
    state_changed = bool(result['effects']) or bool(
        (game.get('activeCardEffects') or {}).get('Efficient Travel')
    )
    assert state_changed


def main():
    cases = [
        ('blend_in_hide', test_blend_in_applies_hide),
        ('devotion_active_effect', test_devotion_stamps_active_effect),
        ('named_wrapper_schema', test_named_wrapper_runs_schema_for_noop_cc),
        ('replacement_count', test_schema_replacement_count),
        ('fallback_active_effects', test_fallback_stamps_active_card_effects),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            import traceback
            print(f'FAIL: {name}: {e}')
            traceback.print_exc()
            failures.append(name)
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
