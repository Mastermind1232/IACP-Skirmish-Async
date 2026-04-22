"""Tests for cards.deck — draw, discard, shuffle, reshuffle-on-empty."""
from __future__ import annotations

import random
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.cards.deck import (
    deck_size,
    discard_from_deck_top,
    discard_from_hand,
    discard_size,
    draw_cc_cards,
    draw_to_hand_size,
    draw_with_reshuffle,
    hand_size,
    shuffle_deck,
    shuffle_discard_into_deck,
)


def test_draw_cc_cards_from_empty_hand():
    g = {'player1CcDeck': ['A', 'B', 'C', 'D']}
    drew = draw_cc_cards(g, 1, 3)
    assert drew == ['A', 'B', 'C']
    assert g['player1CcDeck'] == ['D']
    assert g['player1CcHand'] == ['A', 'B', 'C']


def test_draw_cc_cards_appends_to_existing_hand():
    g = {'player1CcDeck': ['B'], 'player1CcHand': ['X']}
    drew = draw_cc_cards(g, 1, 1)
    assert drew == ['B']
    assert g['player1CcHand'] == ['X', 'B']


def test_draw_cc_cards_runs_out_deck():
    g = {'player1CcDeck': ['A']}
    drew = draw_cc_cards(g, 1, 5)
    assert drew == ['A']
    assert g['player1CcDeck'] == []
    assert g['player1CcHand'] == ['A']


def test_draw_cc_cards_zero_noop():
    g = {'player1CcDeck': ['A']}
    drew = draw_cc_cards(g, 1, 0)
    assert drew == []
    # hand/deck unchanged:
    assert g.get('player1CcHand') is None
    assert g['player1CcDeck'] == ['A']


def test_draw_routes_by_player():
    g = {'player1CcDeck': ['A'], 'player2CcDeck': ['X']}
    draw_cc_cards(g, 1, 1)
    draw_cc_cards(g, 2, 1)
    assert g['player1CcHand'] == ['A']
    assert g['player2CcHand'] == ['X']


def test_discard_from_hand_happy_path():
    g = {'player1CcHand': ['A', 'B', 'C']}
    assert discard_from_hand(g, 1, 'B') is True
    assert g['player1CcHand'] == ['A', 'C']
    assert g['player1CcDiscard'] == ['B']


def test_discard_from_hand_missing_returns_false():
    g = {'player1CcHand': ['A']}
    assert discard_from_hand(g, 1, 'B') is False
    assert g['player1CcHand'] == ['A']
    assert g.get('player1CcDiscard') is None


def test_discard_from_hand_only_first_instance():
    g = {'player1CcHand': ['A', 'A', 'B']}
    discard_from_hand(g, 1, 'A')
    assert g['player1CcHand'] == ['A', 'B']  # second 'A' remains
    assert g['player1CcDiscard'] == ['A']


def test_discard_from_deck_top():
    g = {'player1CcDeck': ['A', 'B', 'C', 'D']}
    drained = discard_from_deck_top(g, 1, 2)
    assert drained == ['A', 'B']
    assert g['player1CcDeck'] == ['C', 'D']
    assert g['player1CcDiscard'] == ['A', 'B']


def test_discard_from_deck_top_short_deck():
    g = {'player1CcDeck': ['A']}
    drained = discard_from_deck_top(g, 1, 3)
    assert drained == ['A']
    assert g['player1CcDeck'] == []


def test_shuffle_deck_deterministic_with_seeded_rng():
    g = {'player1CcDeck': ['A', 'B', 'C', 'D', 'E']}
    shuffle_deck(g, 1, rng=random.Random(42))
    # With a seed we can rely on the specific permutation
    shuffled1 = list(g['player1CcDeck'])
    g['player1CcDeck'] = ['A', 'B', 'C', 'D', 'E']
    shuffle_deck(g, 1, rng=random.Random(42))
    assert g['player1CcDeck'] == shuffled1  # reproducible
    assert sorted(shuffled1) == ['A', 'B', 'C', 'D', 'E']  # still complete


def test_shuffle_discard_into_deck_empties_discard():
    g = {
        'player1CcDeck': ['A'],
        'player1CcDiscard': ['B', 'C'],
    }
    moved = shuffle_discard_into_deck(g, 1, rng=random.Random(1))
    assert moved == 2
    assert g['player1CcDiscard'] == []
    assert sorted(g['player1CcDeck']) == ['A', 'B', 'C']


def test_shuffle_discard_into_deck_no_discard_noop():
    g = {'player1CcDeck': ['A']}
    moved = shuffle_discard_into_deck(g, 1, rng=random.Random(1))
    assert moved == 0
    assert g['player1CcDeck'] == ['A']


def test_draw_with_reshuffle_pulls_from_discard_when_deck_empty():
    g = {
        'player1CcDeck': ['A'],
        'player1CcDiscard': ['X', 'Y'],
    }
    drew = draw_with_reshuffle(g, 1, 3, rng=random.Random(0))
    # Draws A, then reshuffles {X,Y} into deck and draws both
    assert len(drew) == 3
    assert drew[0] == 'A'
    assert sorted(drew[1:]) == ['X', 'Y']
    assert g['player1CcDiscard'] == []
    assert g['player1CcDeck'] == []
    assert sorted(g['player1CcHand']) == ['A', 'X', 'Y']


def test_draw_to_hand_size_targets_current_plus_delta():
    g = {
        'player1CcHand': ['A'],
        'player1CcDeck': ['B', 'C', 'D'],
    }
    drew = draw_to_hand_size(g, 1, 3)
    assert drew == ['B', 'C']
    assert g['player1CcHand'] == ['A', 'B', 'C']


def test_draw_to_hand_size_over_target_noop():
    g = {'player1CcHand': ['A', 'B', 'C', 'D'], 'player1CcDeck': ['X']}
    drew = draw_to_hand_size(g, 1, 3)
    assert drew == []
    assert g['player1CcHand'] == ['A', 'B', 'C', 'D']


def test_size_helpers():
    g = {'player1CcHand': ['A', 'B'], 'player1CcDeck': [], 'player1CcDiscard': ['X']}
    assert hand_size(g, 1) == 2
    assert deck_size(g, 1) == 0
    assert discard_size(g, 1) == 1
    assert hand_size(g, 2) == 0
    assert deck_size({}, 1) == 0


def main():
    cases = [
        ('draw_cc_cards_from_empty_hand', test_draw_cc_cards_from_empty_hand),
        ('draw_cc_cards_appends_to_existing_hand', test_draw_cc_cards_appends_to_existing_hand),
        ('draw_cc_cards_runs_out_deck', test_draw_cc_cards_runs_out_deck),
        ('draw_cc_cards_zero_noop', test_draw_cc_cards_zero_noop),
        ('draw_routes_by_player', test_draw_routes_by_player),
        ('discard_from_hand_happy_path', test_discard_from_hand_happy_path),
        ('discard_from_hand_missing', test_discard_from_hand_missing_returns_false),
        ('discard_from_hand_only_first', test_discard_from_hand_only_first_instance),
        ('discard_from_deck_top', test_discard_from_deck_top),
        ('discard_from_deck_top_short', test_discard_from_deck_top_short_deck),
        ('shuffle_deterministic', test_shuffle_deck_deterministic_with_seeded_rng),
        ('shuffle_discard_into_deck', test_shuffle_discard_into_deck_empties_discard),
        ('shuffle_discard_empty_noop', test_shuffle_discard_into_deck_no_discard_noop),
        ('draw_with_reshuffle', test_draw_with_reshuffle_pulls_from_discard_when_deck_empty),
        ('draw_to_hand_size', test_draw_to_hand_size_targets_current_plus_delta),
        ('draw_to_hand_size_over_target', test_draw_to_hand_size_over_target_noop),
        ('size_helpers', test_size_helpers),
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
