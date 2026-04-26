"""P2.9 verification: dc_play_area.handle_move engine port.

Validates pure-state move dispatch: bank decrement, position update,
Cripple gate, validation rejects.
"""
from python.engine.dc_play_area import handle_move


def _game(mp=4):
    return {
        'figurePositions': {1: {'Han-1-0': 'a13'}, 2: {}},
        'movementBank': {'hl1dc0': {'total': mp, 'remaining': mp}},
    }


def test_handle_move_updates_position_and_decrements_bank():
    g = _game(mp=4)
    result = handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Han-1-0', target_space='a15', cost=2,
    )
    assert result['ok'] is True
    assert result['newPosition'] == 'a15'
    assert result['mpRemaining'] == 2
    assert result['previousPosition'] == 'a13'
    assert g['figurePositions'][1]['Han-1-0'] == 'a15'
    assert g['movementBank']['hl1dc0']['remaining'] == 2


def test_handle_move_stamps_figure_moved_flag():
    g = _game()
    handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Han-1-0', target_space='a15', cost=2,
    )
    assert g['figureMoved']['Han-1-0'] is True


def test_handle_move_rejects_when_figure_not_on_board():
    g = _game()
    result = handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Ghost-1-0', target_space='a15', cost=1,
    )
    assert result['ok'] is False
    assert result['code'] == 'no_position'


def test_handle_move_rejects_when_cost_exceeds_mp():
    g = _game(mp=2)
    result = handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Han-1-0', target_space='a17', cost=4,
    )
    assert result['ok'] is False
    assert result['code'] == 'insufficient_mp'
    # State unchanged on rejection.
    assert g['figurePositions'][1]['Han-1-0'] == 'a13'
    assert g['movementBank']['hl1dc0']['remaining'] == 2


def test_handle_move_rejects_when_no_bank_entry():
    g = _game()
    g['movementBank'] = {}
    result = handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Han-1-0', target_space='a15', cost=1,
    )
    assert result['ok'] is False
    assert result['code'] == 'no_bank'


def test_handle_move_rejects_negative_cost():
    g = _game()
    result = handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Han-1-0', target_space='a15', cost=-1,
    )
    assert result['ok'] is False
    assert result['code'] == 'invalid_cost'


def test_handle_move_zero_cost_does_not_move():
    """Zero-cost move (e.g. 'stay') is allowed."""
    g = _game(mp=4)
    result = handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Han-1-0', target_space='a13', cost=0,
    )
    assert result['ok'] is True
    assert result['mpRemaining'] == 4


def test_cripple_gate_blocks_exit():
    g = _game()
    g['crippledFigures'] = ['Han-1-0']
    result = handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Han-1-0', target_space='a15', cost=2,
    )
    assert result['ok'] is False
    assert result['code'] == 'cripple'
    assert g['figurePositions'][1]['Han-1-0'] == 'a13'


def test_cripple_gate_allows_stay_in_place():
    """Crippled figure can still stay in current space."""
    g = _game()
    g['crippledFigures'] = ['Han-1-0']
    result = handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Han-1-0', target_space='a13', cost=0,
    )
    assert result['ok'] is True


def test_handle_move_lowercase_compare_for_cripple():
    """Cripple compare is case-insensitive on coords."""
    g = _game()
    g['crippledFigures'] = ['Han-1-0']
    result = handle_move(
        g, msg_id='hl1dc0', player_num=1,
        figure_key='Han-1-0', target_space='A13', cost=0,
    )
    assert result['ok'] is True
