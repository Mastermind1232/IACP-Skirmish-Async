"""Tests for cc_effects resolver + seed handlers."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.cards.cc_effects import (
    UnknownCcEffect,
    registered_cc_effects,
    resolve_pending_cc_effect,
)


def test_no_pending_returns_no_op():
    r = resolve_pending_cc_effect({})
    assert r == {'applied': False, 'reason': 'no_pending_cc_effect'}


def test_unknown_cc_raises():
    g = {'pendingCcEffect': {'cardName': 'Made Up Card', 'playerNum': 1}}
    try:
        resolve_pending_cc_effect(g)
    except UnknownCcEffect as e:
        assert 'Made Up Card' in str(e)
        return
    raise AssertionError('expected UnknownCcEffect')


def test_reinforcements_draws_three_and_stamps_sor_flag():
    g = {
        'pendingCcEffect': {'cardName': 'Reinforcements', 'playerNum': 1},
        'player1CcDeck': ['A', 'B', 'C', 'D'],
    }
    r = resolve_pending_cc_effect(g)
    assert r['applied'] is True
    assert r['drew'] == ['A', 'B', 'C']
    assert g['player1CcHand'] == ['A', 'B', 'C']
    assert g['reinforcementsPlayedThisSor'] is True
    assert g['pendingCcEffect'] is None
    assert g['lastCcEffectResult']['cardName'] == 'Reinforcements'


def test_hold_on_adds_focus_to_target():
    g = {'pendingCcEffect': {'cardName': 'Hold On', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'target_figure_key': 'Luke-0-0'})
    assert r['applied'] is True
    assert 'Focus' in g['figureConditions']['Luke-0-0']


def test_hit_the_deck_adds_hide():
    g = {'pendingCcEffect': {'cardName': 'Hit the Deck', 'playerNum': 2}}
    resolve_pending_cc_effect(g, {'target_figure_key': 'Vader-0-0'})
    assert 'Hide' in g['figureConditions']['Vader-0-0']


def test_rally_removes_chosen_condition():
    g = {
        'pendingCcEffect': {'cardName': 'Rally', 'playerNum': 1},
        'figureConditions': {'Luke-0-0': ['Stun', 'Bleed']},
    }
    r = resolve_pending_cc_effect(
        g, {'target_figure_key': 'Luke-0-0', 'condition': 'Stun'},
    )
    assert r['applied'] is True
    assert 'Stun' not in g['figureConditions']['Luke-0-0']
    assert 'Bleed' in g['figureConditions']['Luke-0-0']


def test_take_initiative_sets_swap():
    g = {'pendingCcEffect': {'cardName': 'Take Initiative', 'playerNum': 2}}
    r = resolve_pending_cc_effect(g)
    assert r['applied'] is True
    assert g['initiativeSwapNextRound'] == {'toPlayerNum': 2}


def test_hold_on_requires_target_figure_key():
    g = {'pendingCcEffect': {'cardName': 'Hold On', 'playerNum': 1}}
    try:
        resolve_pending_cc_effect(g, {})
    except ValueError as e:
        assert 'target_figure_key' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_registered_cc_effects_lists_seeds():
    names = registered_cc_effects()
    assert 'Reinforcements' in names
    assert 'Hold On' in names
    assert 'Take Initiative' in names


def main():
    cases = [
        ('no_pending_no_op', test_no_pending_returns_no_op),
        ('unknown_cc_raises', test_unknown_cc_raises),
        ('reinforcements_draws_and_stamps', test_reinforcements_draws_three_and_stamps_sor_flag),
        ('hold_on_adds_focus', test_hold_on_adds_focus_to_target),
        ('hit_the_deck_adds_hide', test_hit_the_deck_adds_hide),
        ('rally_removes_condition', test_rally_removes_chosen_condition),
        ('take_initiative_sets_swap', test_take_initiative_sets_swap),
        ('hold_on_requires_target', test_hold_on_requires_target_figure_key),
        ('registered_effects_lists_seeds', test_registered_cc_effects_lists_seeds),
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
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
