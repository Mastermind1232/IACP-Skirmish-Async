"""P2.2 verification: pure-state finalize_activation port.

Validates the B-section + D-section state mutations of
finalize_activation. Discord side-effects (thread creation, embed
render, log messages) are out of scope — Phase 3 handlers wrap this.
"""
from unittest.mock import patch

from python.engine.activation_setup import (
    DC_ACTIONS_PER_ACTIVATION,
    finalize_activation,
)


def _game(player_num=1):
    return {
        'p1ActivationsRemaining': 3,
        'p2ActivationsRemaining': 3,
        'p1ActivatedDcIndices': [],
        'p2ActivatedDcIndices': [],
        'figurePositions': {1: {}, 2: {}},
        'figureConditions': {},
        'figurePowerTokens': {},
        'p1DcAttachments': {},
        'p2DcAttachments': {},
        'p1CcHand': [],
        'p2CcHand': [],
        'p1DcList': [],
        'p2DcList': [],
        'p1DcMessageIds': [],
        'p2DcMessageIds': [],
    }


def _patch_no_passives():
    return patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value={'Han': {'specialAbilityIds': []}},
    )


def test_marks_dc_exhausted():
    g = _game()
    with _patch_no_passives():
        finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=0,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    assert g['dcExhaustedState']['hl1dc0'] is True


def test_decrements_activations_remaining():
    g = _game()
    with _patch_no_passives():
        finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=0,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    assert g['p1ActivationsRemaining'] == 2
    # Other player untouched.
    assert g['p2ActivationsRemaining'] == 3


def test_pushes_dc_index_to_activated_list():
    g = _game()
    with _patch_no_passives():
        finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=2,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    assert g['p1ActivatedDcIndices'] == [2]


def test_clears_strength_in_numbers_for_active_player():
    g = _game()
    g['strengthInNumbersData'] = {'playerNum': 1, 'foo': 'bar'}
    g['strengthInNumbersPlayerNum'] = 1
    with _patch_no_passives():
        finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=0,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    assert g['strengthInNumbersData'] is None
    assert g['strengthInNumbersPlayerNum'] is None


def test_does_not_clear_strength_in_numbers_for_other_player():
    g = _game()
    g['strengthInNumbersData'] = {'playerNum': 2, 'foo': 'bar'}
    g['strengthInNumbersPlayerNum'] = 2
    with _patch_no_passives():
        finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=0,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    assert g['strengthInNumbersData'] == {'playerNum': 2, 'foo': 'bar'}


def test_inits_movement_bank_with_zero_when_no_pending():
    g = _game()
    with _patch_no_passives():
        finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=0,
            display_name='Han [DG 1]', msg_id='hl1dc0',
            thread_id='thread-1',
        )
    bank = g['movementBank']['hl1dc0']
    assert bank['total'] == 0
    assert bank['remaining'] == 0
    assert bank['threadId'] == 'thread-1'
    assert bank['displayName'] == 'Han [DG 1]'


def test_consumes_pending_mp_bonus_into_movement_bank():
    g = _game()
    g['pendingMpBonus'] = {'hl1dc0': 4, 'hl2dc0': 2}
    with _patch_no_passives():
        finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=0,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    bank = g['movementBank']['hl1dc0']
    assert bank['total'] == 4
    assert bank['remaining'] == 4
    # Other entries preserved.
    assert g['pendingMpBonus'].get('hl2dc0') == 2
    # Activated entry consumed.
    assert 'hl1dc0' not in g['pendingMpBonus']


def test_consumes_deploy_bonus_mp_for_active_group():
    g = _game()
    g['deployBonusMp'] = {'Han-1-0': 2, 'Han-1-1': 3, 'Other-1-0': 1}
    with _patch_no_passives():
        finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=0,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    # Max of {2, 3} = 3 added to bank.
    bank = g['movementBank']['hl1dc0']
    assert bank['remaining'] == 3
    # Active-group entries consumed; other-group preserved.
    assert g['deployBonusMp'].get('Other-1-0') == 1
    assert 'Han-1-0' not in g['deployBonusMp']
    assert 'Han-1-1' not in g['deployBonusMp']


def test_tracks_activation_start_positions():
    g = _game()
    g['figurePositions'][1] = {
        'Han-1-0': 'a13',
        'Han-1-1': 'a14',
        'Chewie-1-0': 'b13',
    }
    with _patch_no_passives():
        finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=0,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    asp = g['activationStartPositions']
    assert asp.get('Han-1-0') == 'a13'
    assert asp.get('Han-1-1') == 'a14'
    # Other group not tracked.
    assert 'Chewie-1-0' not in asp


def test_inits_dc_actions_data():
    g = _game()
    with _patch_no_passives():
        result = finalize_activation(
            g, dc_name='Han', player_num=1, dc_index=0,
            display_name='Han [DG 1]', msg_id='hl1dc0',
            thread_id='thread-1',
        )
    entry = g['dcActionsData']['hl1dc0']
    assert entry['remaining'] == DC_ACTIONS_PER_ACTIVATION
    assert entry['total'] == DC_ACTIONS_PER_ACTIVATION
    assert entry['threadId'] == 'thread-1'
    assert entry['specialsUsed'] == []
    assert result['dcActionsData'] == entry


def test_returns_start_effects_from_passives():
    g = _game()
    fake = {'Captain Terro': {'specialAbilityIds': ['mounted_terro']}}
    with patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value=fake,
    ):
        result = finalize_activation(
            g, dc_name='Captain Terro', player_num=1, dc_index=0,
            display_name='Captain Terro [DG 1]', msg_id='hl1dc0',
        )
    effects = result['startEffects']
    assert any(e['effect'] == 'Mounted' for e in effects)
    # Mounted granted 3 MP.
    assert g['movementBank']['hl1dc0']['remaining'] == 3
