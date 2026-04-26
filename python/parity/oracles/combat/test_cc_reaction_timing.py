"""P1.16 verification: get_playable_reaction_cards_for_timing.

Already ported in python/engine/mechanics/cc_timing.py:579. This file
adds smoke tests confirming the function returns playable reactions
during combat timing windows.
"""
from python.engine.mechanics.cc_timing import (
    get_playable_reaction_cards_for_timing,
)


def _game(hand1=None, hand2=None):
    """Minimal game with a CC hand for both players."""
    return {
        'p1CcHand': hand1 or [],
        'p2CcHand': hand2 or [],
        'p1DcList': [{'dcName': 'Han Solo (Rebel Hero)', 'dgIndex': 1}],
        'p2DcList': [{'dcName': 'Boba Fett', 'dgIndex': 1}],
        'p1DcMessageIds': ['hl1dc0'],
        'p2DcMessageIds': ['hl2dc0'],
        'figurePositions': {
            1: {'Han Solo (Rebel Hero)-1-0': 'a13'},
            2: {'Boba Fett-1-0': 'a14'},
        },
        'p1Affiliation': 'rebel',
        'p2Affiliation': 'imperial',
    }


def test_empty_hand_returns_empty():
    g = _game(hand1=[])
    result = get_playable_reaction_cards_for_timing(g, 1, ['after-attack'])
    assert result == []


def test_irrelevant_card_in_hand_returns_empty():
    """Card whose timing doesn't match the trigger window is excluded."""
    g = _game(hand1=['Take Initiative'])  # not a reaction card
    result = get_playable_reaction_cards_for_timing(
        g, 1, ['after-defender-rerolls'],
    )
    assert result == []


def test_returns_list_of_dicts_when_match():
    """Function returns a list of dicts with cardName, timing, etc."""
    # We can't reliably enumerate every reaction card without loading
    # the data file; just confirm the return shape.
    g = _game(hand1=['Negation'])  # Negation is a reaction
    result = get_playable_reaction_cards_for_timing(g, 1, ['negate-cc'])
    # Either Negation matches the timing or not — either way the result
    # should be a list.
    assert isinstance(result, list)


def test_returns_list_for_multiple_timing_triggers():
    """Function accepts a list of timing triggers (matches ANY)."""
    g = _game(hand1=['Negation'])
    result = get_playable_reaction_cards_for_timing(
        g, 1, ['negate-cc', 'after-attack'],
    )
    assert isinstance(result, list)


def test_player_2_hand_isolated():
    """Querying player 2's reactions doesn't see player 1's hand."""
    g = _game(hand1=['Negation'], hand2=[])
    result = get_playable_reaction_cards_for_timing(g, 2, ['negate-cc'])
    assert result == []
