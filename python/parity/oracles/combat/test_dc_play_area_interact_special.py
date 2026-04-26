"""P2.10 verification: dc_play_area.handle_interact + handle_special.

Validates pure-state interact + special action gating and decrement.
Mission-specific resolution (terminal VP) is in mission_rules; ability
resolution is in pattern_e (P2.11). This test focuses on the action
plumbing.
"""
from python.engine.dc_play_area import handle_interact, handle_special


def _game(remaining=2, specials_used=None):
    return {
        'figurePositions': {1: {'Han-1-0': 'a13'}, 2: {}},
        'dcActionsData': {
            'hl1dc0': {
                'remaining': remaining,
                'total': 2,
                'specialsUsed': list(specials_used or []),
            }
        },
    }


# ── handle_interact ─────────────────────────────────────────────────────


def test_handle_interact_decrements_actions():
    g = _game(remaining=2)
    result = handle_interact(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
    )
    assert result['ok'] is True
    assert result['actionsRemaining'] == 1
    assert g['dcActionsData']['hl1dc0']['remaining'] == 1


def test_handle_interact_rejects_when_no_actions():
    g = _game(remaining=0)
    result = handle_interact(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
    )
    assert result['ok'] is False
    assert result['code'] == 'no_actions'


def test_handle_interact_rejects_when_no_position():
    g = _game()
    result = handle_interact(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Ghost-1-0',
    )
    assert result['ok'] is False
    assert result['code'] == 'no_position'


# ── handle_special ──────────────────────────────────────────────────────


def test_handle_special_pushes_specials_used_and_decrements():
    g = _game(remaining=2)
    result = handle_special(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
        special_idx=0, special_name='Quick Draw', action_cost=1,
    )
    assert result['ok'] is True
    assert result['actionsRemaining'] == 1
    entry = g['dcActionsData']['hl1dc0']
    assert 0 in entry['specialsUsed']
    assert entry['remaining'] == 1


def test_handle_special_zero_cost_does_not_decrement():
    g = _game(remaining=2)
    result = handle_special(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
        special_idx=0, special_name='Free Move', action_cost=0,
    )
    assert result['ok'] is True
    assert result['actionsRemaining'] == 2
    assert 0 in g['dcActionsData']['hl1dc0']['specialsUsed']


def test_handle_special_two_cost_decrements_both():
    g = _game(remaining=2)
    result = handle_special(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
        special_idx=0, special_name='Heroic Action', action_cost=2,
    )
    assert result['ok'] is True
    assert result['actionsRemaining'] == 0


def test_handle_special_rejects_already_used():
    g = _game(remaining=2, specials_used=[0])
    result = handle_special(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
        special_idx=0, special_name='Quick Draw', action_cost=1,
    )
    assert result['ok'] is False
    assert result['code'] == 'special_already_used'
    # State unchanged.
    assert g['dcActionsData']['hl1dc0']['remaining'] == 2


def test_handle_special_rejects_when_disabled():
    g = _game(remaining=2)
    g['disabledFigures'] = ['Han [DG 1]']
    result = handle_special(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
        special_idx=0, special_name='Quick Draw', action_cost=1,
    )
    assert result['ok'] is False
    assert result['code'] == 'disabled'


def test_handle_special_rejects_when_two_cost_with_one_remaining():
    g = _game(remaining=1)
    result = handle_special(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
        special_idx=0, special_name='Heroic Action', action_cost=2,
    )
    assert result['ok'] is False
    assert result['code'] == 'insufficient_actions'


def test_handle_special_zero_cost_works_at_zero_actions():
    """MP-based zero-cost specials work even at 0 actions remaining."""
    g = _game(remaining=0)
    result = handle_special(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
        special_idx=0, special_name='Spend MP', action_cost=0,
    )
    assert result['ok'] is True
    assert g['dcActionsData']['hl1dc0']['remaining'] == 0


def test_handle_special_separate_specials_can_both_be_used():
    g = _game(remaining=2)
    handle_special(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
        special_idx=0, special_name='A', action_cost=1,
    )
    result = handle_special(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
        special_idx=1, special_name='B', action_cost=1,
    )
    assert result['ok'] is True
    assert sorted(g['dcActionsData']['hl1dc0']['specialsUsed']) == [0, 1]
    assert g['dcActionsData']['hl1dc0']['remaining'] == 0


# ── Interact + Special: To the Limit gate ───────────────────────────────


def test_handle_interact_blocked_by_to_the_limit_only_for_move():
    """To the Limit blocks Move only, not Interact."""
    g = _game(remaining=1)
    g['activationExtraActionThenStun'] = {'hl1dc0': True}
    result = handle_interact(
        g, msg_id='hl1dc0', player_num=1,
        dc_name='Han', display_name='Han [DG 1]',
        figure_key='Han-1-0',
    )
    assert result['ok'] is True
