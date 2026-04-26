"""P2.1 verification: apply_start_of_activation_effects port.

Smoke tests covering the major handler branches in
apply_start_of_activation_effects. JS source: src/engine/activation-effects.js.

Each test patches dc_effects to isolate one branch.
"""
from unittest.mock import patch

from python.engine.mechanics.activation_effects import (
    apply_start_of_activation_effects,
)


def _base_game(player_num=1):
    return {
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
        'movementBank': {},
    }


def test_mounted_grants_3_mp():
    g = _base_game()
    fake = {'Captain Terro': {'specialAbilityIds': ['mounted_terro']}}
    with patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value=fake,
    ):
        result = apply_start_of_activation_effects(
            g, dc_name='Captain Terro', player_num=1,
            display_name='Captain Terro [DG 1]', msg_id='hl1dc0',
        )
    bank = g['movementBank'].get('hl1dc0') or {}
    assert bank.get('remaining') == 3
    assert any(a['effect'] == 'Mounted' for a in result['applied'])


def test_mounted_via_passive_tag():
    """Mounted passive on dc_eff (no specific ability id) also fires."""
    g = _base_game()
    fake = {'Beastrider': {'specialAbilityIds': [], 'passives': ['Mounted']}}
    with patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value=fake,
    ):
        apply_start_of_activation_effects(
            g, dc_name='Beastrider', player_num=1,
            display_name='Beastrider [DG 1]', msg_id='hl1dc0',
        )
    bank = g['movementBank'].get('hl1dc0') or {}
    assert bank.get('remaining') == 3


def test_comms_jammer_stamps_player_num():
    g = _base_game()
    fake = {'ISB Infiltrator (Elite)': {'specialAbilityIds': ['comms_jammer_isb']}}
    with patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value=fake,
    ):
        apply_start_of_activation_effects(
            g, dc_name='ISB Infiltrator (Elite)', player_num=1,
            display_name='ISB Infiltrator (Elite) [DG 1]', msg_id='hl1dc0',
        )
    assert g['commsJammerActivePlayerNum'] == 1


def test_focused_on_the_kill_grants_2_mp():
    g = _base_game()
    g['p1DcAttachments'] = {'hl1dc0': ['Focused on the Kill']}
    fake = {'Han': {'specialAbilityIds': []}}
    with patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value=fake,
    ):
        apply_start_of_activation_effects(
            g, dc_name='Han', player_num=1,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    bank = g['movementBank'].get('hl1dc0') or {}
    assert bank.get('remaining') == 2


def test_scrap_battalion_marks_companion_co_activate():
    g = _base_game()
    fake = {'Ugnaught Tinkerer (Elite)': {'specialAbilityIds': ['scrap_battalion_ugnaught_elite']}}
    with patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value=fake,
    ):
        apply_start_of_activation_effects(
            g, dc_name='Ugnaught Tinkerer (Elite)', player_num=1,
            display_name='Ugnaught Tinkerer (Elite) [DG 1]', msg_id='hl1dc0',
        )
    assert g.get('companionActivatedBefore', {}).get('hl1dc0') == 'co-activate'


def test_imperial_loadout_logs_chosen_card():
    g = _base_game()
    g['figurePositions'][1]['Purge Trooper-1-0'] = 'a13'
    g['figureConfig'] = {'Purge Trooper-1-0': {'loadout': 'Heavy Repeater'}}
    fake = {'Purge Trooper': {'specialAbilityIds': ['imperial_loadout_purge_trooper']}}
    with patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value=fake,
    ):
        result = apply_start_of_activation_effects(
            g, dc_name='Purge Trooper', player_num=1,
            display_name='Purge Trooper [DG 1]', msg_id='hl1dc0',
        )
    msgs = [a['message'] for a in result['applied'] if a['effect'] == 'Imperial Loadout']
    assert any('Heavy Repeater' in m for m in msgs)


def test_no_passives_returns_empty_applied():
    g = _base_game()
    fake = {'Han': {'specialAbilityIds': []}}
    with patch(
        'python.engine.mechanics.activation_effects.get_dc_effects',
        return_value=fake,
    ):
        result = apply_start_of_activation_effects(
            g, dc_name='Han', player_num=1,
            display_name='Han [DG 1]', msg_id='hl1dc0',
        )
    assert result == {'applied': []}
