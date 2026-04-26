"""P2.7 verification: dc_play_area.handle_dc_activate engine port.

Validates the full activation pipeline: validate_activation gate stack,
Force Slow skip, finalize_activation. Discord IO is out of scope.
"""
from unittest.mock import patch

from python.engine.dc_play_area import (
    handle_dc_activate,
    validate_activation,
)


def _game(p1_remaining=3, p2_remaining=3):
    return {
        'p1ActivationsRemaining': p1_remaining,
        'p2ActivationsRemaining': p2_remaining,
        'p1ActivatedDcIndices': [],
        'p2ActivatedDcIndices': [],
        'p1DcList': [{'dcName': 'Han', 'displayName': 'Han [DG 1]'}],
        'p2DcList': [{'dcName': 'Vader', 'displayName': 'Vader [DG 1]'}],
        'p1DcMessageIds': ['hl1dc0'],
        'p2DcMessageIds': ['hl2dc0'],
        'figurePositions': {1: {'Han-1-0': 'a13'}, 2: {'Vader-1-0': 'a20'}},
        'p1DcAttachments': {},
        'p2DcAttachments': {},
        'p1CcHand': [],
        'p2CcHand': [],
    }


def _no_passives():
    return patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value={'Han': {'specialAbilityIds': []}, 'Vader': {'specialAbilityIds': []}},
    )


# ── validate_activation ─────────────────────────────────────────────────


def test_validate_rejects_unknown_dc_index():
    g = _game()
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=99)
    assert result['ok'] is False
    assert result['code'] == 'dc_not_found'


def test_validate_rejects_when_no_activations_remaining():
    g = _game(p1_remaining=0)
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is False
    assert result['code'] == 'no_activations'


def test_validate_passes_baseline():
    g = _game()
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is True
    assert result['dcName'] == 'Han'
    assert result['msgId'] == 'hl1dc0'


def test_validate_sit_tight_blocks_when_remaining_le_opponent():
    g = _game(p1_remaining=3, p2_remaining=3)
    g['sitTightPlayerNum'] = 1
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is False
    assert result['code'] == 'sit_tight'


def test_validate_sit_tight_allows_when_remaining_gt_opponent():
    g = _game(p1_remaining=4, p2_remaining=3)
    g['sitTightPlayerNum'] = 1
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is True


def test_validate_agitate_blocks_wrong_dc():
    g = _game()
    g['p1DcList'] = [
        {'dcName': 'Han', 'displayName': 'Han [DG 1]'},
        {'dcName': 'Chewie', 'displayName': 'Chewie [DG 1]'},
    ]
    g['p1DcMessageIds'] = ['hl1dc0', 'hl1dc1']
    g['agitateNextActivation'] = {'playerNum': 1, 'dcName': 'Chewie'}
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is False
    assert result['code'] == 'agitate'


def test_validate_agitate_clears_when_correct_dc_chosen():
    g = _game()
    g['agitateNextActivation'] = {'playerNum': 1, 'dcName': 'Han'}
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is True
    assert g['agitateNextActivation'] is None
    assert any(s['effect'] == 'agitate_cleared' for s in result['sideEffects'])


def test_validate_force_vision_pending_blocks():
    g = _game()
    g['forceVisionPending'] = 1
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is False
    assert result['code'] == 'force_vision_pending'


def test_validate_force_vision_next_blocks_wrong_dc_when_alive():
    g = _game()
    g['p1DcList'] = [
        {'dcName': 'Han', 'displayName': 'Han [DG 1]'},
        {'dcName': 'Chewie', 'displayName': 'Chewie [DG 1]'},
    ]
    g['p1DcMessageIds'] = ['hl1dc0', 'hl1dc1']
    g['figurePositions'][1]['Chewie-1-0'] = 'b13'
    g['forceVisionNextActivation'] = {'playerNum': 1, 'dcName': 'Chewie'}
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is False
    assert result['code'] == 'force_vision'


def test_validate_force_vision_clears_when_forced_dc_defeated():
    g = _game()
    g['p1DcList'] = [
        {'dcName': 'Han', 'displayName': 'Han [DG 1]'},
        {'dcName': 'Chewie', 'displayName': 'Chewie [DG 1]'},
    ]
    g['p1DcMessageIds'] = ['hl1dc0', 'hl1dc1']
    # Chewie not in figurePositions → defeated.
    g['forceVisionNextActivation'] = {'playerNum': 1, 'dcName': 'Chewie'}
    with patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is True
    assert g['forceVisionNextActivation'] is None


def test_validate_strength_in_numbers_rejects_over_12():
    g = _game()
    g['strengthInNumbersData'] = {
        'playerNum': 1,
        'triggeringGroupCost': 8,
        'triggeringGroupName': 'Trigger',
    }
    with patch(
        'python.engine.dc_play_area.get_dc_effects',
        return_value={'Han': {'cost': 5}},
    ):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is False
    assert result['code'] == 'strength_in_numbers'


def test_validate_strength_in_numbers_allows_at_12():
    g = _game()
    g['strengthInNumbersData'] = {
        'playerNum': 1,
        'triggeringGroupCost': 7,
        'triggeringGroupName': 'Trigger',
    }
    with patch(
        'python.engine.dc_play_area.get_dc_effects',
        return_value={'Han': {'cost': 5}},
    ):
        result = validate_activation(g, player_num=1, dc_index=0)
    assert result['ok'] is True


# ── handle_dc_activate ──────────────────────────────────────────────────


def test_handle_dc_activate_succeeds_and_finalizes():
    g = _game()
    with _no_passives(), \
         patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = handle_dc_activate(g, player_num=1, dc_index=0,
                                    thread_id='thread-1')
    assert result['status'] == 'activated'
    assert result['msgId'] == 'hl1dc0'
    # finalize_activation side effects.
    assert g['p1ActivationsRemaining'] == 2
    assert g['p1ActivatedDcIndices'] == [0]
    assert g['dcExhaustedState']['hl1dc0'] is True
    assert g['movementBank']['hl1dc0']['threadId'] == 'thread-1'
    assert g['dcActionsData']['hl1dc0']['threadId'] == 'thread-1'


def test_handle_dc_activate_rejected_does_not_finalize():
    g = _game(p1_remaining=0)
    with _no_passives(), \
         patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = handle_dc_activate(g, player_num=1, dc_index=0)
    assert result['status'] == 'rejected'
    # Activations not consumed.
    assert g['p1ActivationsRemaining'] == 0
    assert g.get('dcExhaustedState') is None or 'hl1dc0' not in (g.get('dcExhaustedState') or {})


def test_handle_dc_activate_force_slow_skip_consumes_activation():
    g = _game()
    g['forceSlowSkipActivation'] = {'Han-1-0': True}
    with _no_passives(), \
         patch('python.engine.dc_play_area.get_dc_effects', return_value={}):
        result = handle_dc_activate(g, player_num=1, dc_index=0)
    assert result['status'] == 'force_slow_skipped'
    assert g['p1ActivatedDcIndices'] == [0]
    # Flag consumed entirely.
    assert 'forceSlowSkipActivation' not in g
    # finalize_activation NOT called → no movementBank/dcActionsData.
    assert g.get('movementBank', {}).get('hl1dc0') is None
    assert g.get('dcActionsData', {}).get('hl1dc0') is None


def test_handle_dc_activate_companion_host_defeated():
    g = _game()
    g['p1DcList'] = [{'dcName': 'J4X-7', 'displayName': 'J4X-7 [DG 1]'}]
    g['p1DcMessageIds'] = ['hl1dc0']
    g['figurePositions'][1] = {'J4X-7-1-0': 'a13'}  # only companion alive
    g['companionHostMap'] = {
        'J4X-7-1-0': {'playerNum': 1, 'hostFigureKey': 'Boba Fett-1-0'},
    }
    with _no_passives(), \
         patch(
             'python.engine.dc_play_area.get_dc_effects',
             return_value={'J4X-7': {'companion': True}},
         ):
        result = handle_dc_activate(g, player_num=1, dc_index=0)
    assert result['status'] == 'rejected'
    assert result['code'] == 'companion_host_defeated'
