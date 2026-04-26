"""P2.12 verification: cc_hand engine layer.

Validates state-mutation primitives wrapped from JS cc-hand handlers:
select-to-play, cancel, attach, confirm-play, discard, shuffle-draw.
"""
import random

from python.engine.cc_hand import (
    attach_cc_to_dc,
    cancel_pending_play,
    confirm_play_cc,
    discard_card_from_hand,
    select_card_to_play,
    shuffle_draw,
)


def _game(p1_hand=None, p1_deck=None, p1_discard=None):
    return {
        'player1CcHand': list(p1_hand or []),
        'player1CcDeck': list(p1_deck or []),
        'player1CcDiscard': list(p1_discard or []),
        'player2CcHand': [],
        'player2CcDeck': [],
        'player2CcDiscard': [],
    }


# ── select_card_to_play ─────────────────────────────────────────────────


def test_select_card_to_play_stamps_pending():
    g = _game(p1_hand=['Take Cover', 'Negation'])
    result = select_card_to_play(g, player_num=1, card='Take Cover')
    assert result['ok'] is True
    assert g['pendingCcConfirmation'] == {'playerNum': 1, 'card': 'Take Cover'}


def test_select_card_to_play_rejects_not_in_hand():
    g = _game(p1_hand=['Take Cover'])
    result = select_card_to_play(g, player_num=1, card='Cunning')
    assert result['ok'] is False
    assert result['code'] == 'not_in_hand'
    assert 'pendingCcConfirmation' not in g


def test_cancel_pending_play_clears_flag():
    g = _game(p1_hand=['Take Cover'])
    g['pendingCcConfirmation'] = {'playerNum': 1, 'card': 'Take Cover'}
    cleared = cancel_pending_play(g)
    assert cleared is True
    assert g['pendingCcConfirmation'] is None


def test_cancel_pending_play_no_op_when_no_pending():
    g = _game()
    cleared = cancel_pending_play(g)
    assert cleared is False


# ── attach_cc_to_dc ─────────────────────────────────────────────────────


def test_attach_moves_card_from_hand_to_attachment_list():
    g = _game(p1_hand=['Combat Vet', 'Take Cover'])
    result = attach_cc_to_dc(g, player_num=1, card='Combat Vet', msg_id='hl1dc0')
    assert result['ok'] is True
    assert 'Combat Vet' not in g['player1CcHand']
    assert g['p1CcAttachments']['hl1dc0'] == ['Combat Vet']


def test_attach_appends_when_dc_already_has_attachments():
    g = _game(p1_hand=['B'])
    g['p1CcAttachments'] = {'hl1dc0': ['A']}
    attach_cc_to_dc(g, player_num=1, card='B', msg_id='hl1dc0')
    assert g['p1CcAttachments']['hl1dc0'] == ['A', 'B']


def test_attach_rejects_card_not_in_hand():
    g = _game(p1_hand=['A'])
    result = attach_cc_to_dc(g, player_num=1, card='B', msg_id='hl1dc0')
    assert result['ok'] is False
    assert result['code'] == 'not_in_hand'
    # Hand unchanged.
    assert g['player1CcHand'] == ['A']


def test_attach_clears_pending_attachment_flag():
    g = _game(p1_hand=['A'])
    g['pendingCcAttachment'] = {'playerNum': 1, 'card': 'A'}
    attach_cc_to_dc(g, player_num=1, card='A', msg_id='hl1dc0')
    assert g['pendingCcAttachment'] is None


# ── confirm_play_cc ─────────────────────────────────────────────────────


def test_confirm_play_moves_card_from_hand_to_discard():
    g = _game(p1_hand=['Take Cover', 'Negation'])
    result = confirm_play_cc(g, player_num=1, card='Take Cover')
    assert result['ok'] is True
    assert g['player1CcHand'] == ['Negation']
    assert g['player1CcDiscard'] == ['Take Cover']


def test_confirm_play_rejects_not_in_hand():
    g = _game(p1_hand=['A'])
    result = confirm_play_cc(g, player_num=1, card='B')
    assert result['ok'] is False
    assert result['code'] == 'not_in_hand'


def test_confirm_play_clears_pending_confirmation():
    g = _game(p1_hand=['A'])
    g['pendingCcConfirmation'] = {'playerNum': 1, 'card': 'A'}
    confirm_play_cc(g, player_num=1, card='A')
    assert g['pendingCcConfirmation'] is None


# ── discard_card_from_hand ──────────────────────────────────────────────


def test_discard_card_from_hand_moves_to_discard():
    g = _game(p1_hand=['A', 'B'])
    result = discard_card_from_hand(g, player_num=1, card='A')
    assert result['ok'] is True
    assert g['player1CcHand'] == ['B']
    assert g['player1CcDiscard'] == ['A']


def test_discard_card_rejects_not_in_hand():
    g = _game(p1_hand=['A'])
    result = discard_card_from_hand(g, player_num=1, card='Z')
    assert result['ok'] is False
    assert result['code'] == 'not_in_hand'


# ── shuffle_draw ────────────────────────────────────────────────────────


def test_shuffle_draw_moves_discard_to_deck_and_draws():
    g = _game(p1_deck=[], p1_discard=['A', 'B', 'C'])
    rng = random.Random(42)
    result = shuffle_draw(g, player_num=1, draw_n=2, rng=rng)
    assert result['shuffled'] == 3
    assert len(result['drew']) == 2
    # Discard now empty; drew + remaining-deck total = original 3.
    assert g['player1CcDiscard'] == []
    total = list(result['drew']) + list(g['player1CcDeck'])
    assert sorted(total) == sorted(['A', 'B', 'C'])


def test_shuffle_draw_zero_draws():
    g = _game(p1_discard=['A'])
    result = shuffle_draw(g, player_num=1, draw_n=0)
    assert result['shuffled'] == 1
    assert result['drew'] == []
    assert g['player1CcDiscard'] == []


def test_shuffle_draw_with_empty_discard_no_op_on_shuffle():
    g = _game(p1_deck=['A'], p1_discard=[])
    result = shuffle_draw(g, player_num=1, draw_n=1)
    assert result['shuffled'] == 0
    assert result['drew'] == ['A']
    assert g['player1CcHand'] == ['A']
