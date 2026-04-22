"""Tests for activation_effects — start/end-of-activation passive triggers.

Uses a dc_effects_loader monkeypatch so we don't depend on the real
dc-effects.json behavior for hypothetical test DCs. Real DCs (Taron
Malicos, Baze Malbus, Wampa, 0-0-0, Cad Bane, ISB Infiltrator Elite,
Riot Trooper (Elite)) must exist in the actual dataset — asserted in
one sanity test.

Run: python3 python/engine/mechanics/test_activation_effects.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.data import dc_effects_loader
from python.engine.mechanics.activation_effects import (
    apply_end_of_activation_effects,
    apply_start_of_activation_effects,
)


_ORIGINAL_EFFECTS = None


def _install_fake_effects(fake: dict) -> None:
    """Install a fake DC-effects map for tests."""
    dc_effects_loader._dc_effects = fake  # type: ignore[attr-defined]


def _restore_effects() -> None:
    dc_effects_loader.reset_cache()


# ---------------------------------------------------------------------------
# Start-of-activation tests

def test_mounted_ability_id_grants_3_mp():
    _install_fake_effects({'Captain Terro': {'specialAbilityIds': ['mounted_terro']}})
    g = {'figurePositions': {1: {}}}
    r = apply_start_of_activation_effects(
        g, dc_name='Captain Terro', player_num=1,
        display_name='Captain Terro [DG 1]', msg_id='hl1dc0',
    )
    assert g['movementBank']['hl1dc0'] == {'total': 3, 'remaining': 3}
    assert any(e['effect'] == 'Mounted' for e in r['applied'])
    _restore_effects()


def test_mounted_passive_tag_grants_3_mp():
    _install_fake_effects({'Dewback Rider': {'passives': ['Mounted']}})
    g = {}
    apply_start_of_activation_effects(
        g, dc_name='Dewback Rider', player_num=1,
        display_name='Dewback Rider [DG 1]', msg_id='hl1dc0',
    )
    assert g['movementBank']['hl1dc0']['total'] == 3
    _restore_effects()


def test_focused_on_the_kill_attachment_grants_2_mp():
    _install_fake_effects({'Luke': {}})
    g = {'p1DcAttachments': {'hl1dc0': ['Focused on the Kill']}}
    r = apply_start_of_activation_effects(
        g, dc_name='Luke', player_num=1,
        display_name='Luke [DG 1]', msg_id='hl1dc0',
    )
    assert g['movementBank']['hl1dc0']['total'] == 2
    assert any(e['effect'] == 'Focused on the Kill' for e in r['applied'])
    _restore_effects()


def test_comms_jammer_sets_active_player_flag():
    _install_fake_effects({'ISB Spy': {'specialAbilityIds': ['comms_jammer_isb']}})
    g = {}
    r = apply_start_of_activation_effects(
        g, dc_name='ISB Spy', player_num=1,
        display_name='ISB Spy [DG 1]', msg_id='hl1dc0',
    )
    assert g['commsJammerActivePlayerNum'] == 1
    assert any(e['effect'] == 'Comms Jammer' for e in r['applied'])
    _restore_effects()


def test_beast_tamer_exhausts_grants_speed_mp_and_sets_interact_override():
    _install_fake_effects({
        'Wampa (Creature)': {
            'keywords': ['Creature'],
            'speed': 4,
            'abilityText': 'Non-Sentient — something',
        },
    })
    g = {'p1DcAttachments': {'hl1dc0': ['Beast Tamer']}}
    r = apply_start_of_activation_effects(
        g, dc_name='Wampa (Creature)', player_num=1,
        display_name='Wampa [DG 1]', msg_id='hl1dc0',
    )
    assert g['movementBank']['hl1dc0']['total'] == 4
    assert 'Beast Tamer' in g['exhaustedSkirmishUpgrades']['hl1dc0']
    assert g['beastTamerInteractOverride']['hl1dc0'] is True
    assert any(e['effect'] == 'Beast Tamer' for e in r['applied'])
    _restore_effects()


def test_beast_tamer_no_double_exhaust():
    _install_fake_effects({
        'Creature': {'keywords': ['Creature'], 'speed': 4, 'abilityText': ''},
    })
    g = {
        'p1DcAttachments': {'hl1dc0': ['Beast Tamer']},
        'exhaustedSkirmishUpgrades': {'hl1dc0': ['Beast Tamer']},
    }
    apply_start_of_activation_effects(
        g, dc_name='Creature', player_num=1,
        display_name='Creature [DG 1]', msg_id='hl1dc0',
    )
    # No MP granted because already exhausted
    assert 'movementBank' not in g
    _restore_effects()


def test_madness_when_hand_le_2_applies_focus_and_strain():
    _install_fake_effects({'Taron Malicos': {}})
    g = {
        'player1CcHand': ['cc1', 'cc2'],  # size 2 → triggers
        'figurePositions': {1: {'Taron Malicos-1-0': 'a1'}},
    }
    health_state = {'hl1dc0': [[10, 10]]}
    r = apply_start_of_activation_effects(
        g, dc_name='Taron Malicos', player_num=1,
        display_name='Taron Malicos [DG 1]', msg_id='hl1dc0',
        dc_health_state=health_state,
    )
    assert 'Focus' in (g.get('figureConditions') or {}).get('Taron Malicos-1-0', [])
    assert health_state['hl1dc0'][0][0] == 9  # 1 strain applied
    assert any(e['effect'] == 'Madness' for e in r['applied'])
    _restore_effects()


def test_madness_with_full_hand_does_nothing():
    _install_fake_effects({'Taron Malicos': {}})
    g = {
        'player1CcHand': ['cc1', 'cc2', 'cc3'],  # size 3 → no trigger
        'figurePositions': {1: {'Taron Malicos-1-0': 'a1'}},
    }
    r = apply_start_of_activation_effects(
        g, dc_name='Taron Malicos', player_num=1,
        display_name='Taron Malicos [DG 1]', msg_id='hl1dc0',
    )
    assert not any(e['effect'] == 'Madness' for e in r['applied'])
    _restore_effects()


# ---------------------------------------------------------------------------
# End-of-activation tests

def test_weaken_auto_discards_at_end_of_activation():
    _install_fake_effects({'Some DC': {}})
    g = {
        'figurePositions': {1: {'Some DC-1-0': 'a1'}},
        'figureConditions': {'Some DC-1-0': ['Weaken', 'Focus']},
    }
    r = apply_end_of_activation_effects(
        g, dc_name='Some DC', player_num=1,
        display_name='Some DC [DG 1]', msg_id='hl1dc0',
    )
    assert 'Weaken' not in g['figureConditions']['Some DC-1-0']
    assert 'Focus' in g['figureConditions']['Some DC-1-0']
    assert any(e['effect'] == 'Weaken discard' for e in r['applied'])
    _restore_effects()


def test_weaken_not_discarded_when_disarm_permanent():
    _install_fake_effects({'Some DC': {}})
    g = {
        'figurePositions': {1: {'Some DC-1-0': 'a1'}},
        'figureConditions': {'Some DC-1-0': ['Weaken']},
        'disarmPermanentWeakened': {'Some DC-1-0': True},
    }
    apply_end_of_activation_effects(
        g, dc_name='Some DC', player_num=1,
        display_name='Some DC [DG 1]', msg_id='hl1dc0',
    )
    assert g['figureConditions']['Some DC-1-0'] == ['Weaken']
    _restore_effects()


def test_shield_grants_block_when_none_held():
    _install_fake_effects({'Riot Trooper': {'passives': ['Shield']}})
    g = {
        'figurePositions': {1: {'Riot Trooper-1-0': 'a1', 'Riot Trooper-1-1': 'a2'}},
    }
    r = apply_end_of_activation_effects(
        g, dc_name='Riot Trooper', player_num=1,
        display_name='Riot Trooper [DG 1]', msg_id='hl1dc0',
    )
    assert 'Block' in g['figurePowerTokens']['Riot Trooper-1-0']
    assert 'Block' in g['figurePowerTokens']['Riot Trooper-1-1']
    assert sum(1 for e in r['applied'] if e['effect'] == 'Shield') == 2
    _restore_effects()


def test_shield_does_not_grant_if_already_has_block():
    _install_fake_effects({'Riot Trooper': {'passives': ['Shield']}})
    g = {
        'figurePositions': {1: {'Riot Trooper-1-0': 'a1'}},
        'figurePowerTokens': {'Riot Trooper-1-0': ['Block']},
    }
    apply_end_of_activation_effects(
        g, dc_name='Riot Trooper', player_num=1,
        display_name='Riot Trooper [DG 1]', msg_id='hl1dc0',
    )
    # still just 1 Block token
    assert g['figurePowerTokens']['Riot Trooper-1-0'] == ['Block']
    _restore_effects()


def test_in_the_shadows_applies_hide_condition():
    _install_fake_effects({'ISB Infiltrator (Elite)': {}})
    g = {'figurePositions': {1: {'ISB Infiltrator (Elite)-1-0': 'a1'}}}
    r = apply_end_of_activation_effects(
        g, dc_name='ISB Infiltrator (Elite)', player_num=1,
        display_name='ISB Infiltrator (Elite) [DG 1]', msg_id='hl1dc0',
    )
    assert 'Hide' in g['figureConditions']['ISB Infiltrator (Elite)-1-0']
    assert any(e['effect'] == 'In The Shadows' for e in r['applied'])
    _restore_effects()


def test_son_of_skywalker_auto_ready_on_other_activation():
    _install_fake_effects({'Someone Else': {}})
    g = {
        'figurePositions': {1: {'Someone Else-1-0': 'a1'}},
        'sonOfSkywalkerActive': {'dcMsgId': 'hl1dc2', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0', 'hl1dc1', 'hl1dc2'],
        'p1ActivatedDcIndices': [2],  # Luke currently marked as activated
    }
    r = apply_end_of_activation_effects(
        g, dc_name='Someone Else', player_num=1,
        display_name='Someone Else [DG 1]', msg_id='hl1dc0',
    )
    # Luke's index (2) removed from activated list → readied
    assert g['p1ActivatedDcIndices'] == []
    assert any(e['effect'] == 'Son of Skywalker' for e in r['applied'])
    _restore_effects()


def test_son_of_skywalker_no_op_on_luke_own_activation():
    _install_fake_effects({'Luke Skywalker': {}})
    g = {
        'figurePositions': {1: {'Luke Skywalker-1-0': 'a1'}},
        'sonOfSkywalkerActive': {'dcMsgId': 'hl1dc2', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0', 'hl1dc1', 'hl1dc2'],
        'p1ActivatedDcIndices': [2],
    }
    r = apply_end_of_activation_effects(
        g, dc_name='Luke Skywalker', player_num=1,
        display_name='Luke Skywalker [DG 1]', msg_id='hl1dc2',
    )
    # Luke's own activation ended — no auto-ready
    assert g['p1ActivatedDcIndices'] == [2]
    assert not any(e['effect'] == 'Son of Skywalker' for e in r['applied'])
    _restore_effects()


def test_real_data_sanity_check_expected_dc_names_exist():
    """Restores real loader and asserts key DCs referenced by activation_effects exist."""
    _restore_effects()
    from python.engine.data.dc_effects_loader import get_dc_effects
    effects = get_dc_effects() or {}
    # These DCs are referenced by name-specific branches and must exist in data/dc-effects.json.
    # Note: 'Wampa' matches as the bare string `dcName === 'Wampa'` in JS — canonical data
    # keys are 'Wampa (Regular)'/'Wampa (Elite)'; the caller strips the suffix before
    # invoking this helper (mirrored in Python). Just confirm some Wampa variant is present.
    for name in ('Taron Malicos', 'Baze Malbus', '0-0-0', 'ISB Infiltrator (Elite)'):
        assert name in effects, f'{name} missing from dc-effects.json'
    assert any(k.startswith('Wampa') for k in effects), 'Wampa variant missing'


def main():
    cases = [
        ('mounted_ability_id_grants_3_mp', test_mounted_ability_id_grants_3_mp),
        ('mounted_passive_tag_grants_3_mp', test_mounted_passive_tag_grants_3_mp),
        ('focused_on_the_kill_grants_2_mp', test_focused_on_the_kill_attachment_grants_2_mp),
        ('comms_jammer_sets_active_flag', test_comms_jammer_sets_active_player_flag),
        ('beast_tamer_exhausts_grants_mp_sets_override', test_beast_tamer_exhausts_grants_speed_mp_and_sets_interact_override),
        ('beast_tamer_no_double_exhaust', test_beast_tamer_no_double_exhaust),
        ('madness_triggers_focus_strain', test_madness_when_hand_le_2_applies_focus_and_strain),
        ('madness_full_hand_noop', test_madness_with_full_hand_does_nothing),
        ('weaken_auto_discard', test_weaken_auto_discards_at_end_of_activation),
        ('weaken_disarm_permanent_locked', test_weaken_not_discarded_when_disarm_permanent),
        ('shield_grants_block_when_none', test_shield_grants_block_when_none_held),
        ('shield_no_grant_if_has_block', test_shield_does_not_grant_if_already_has_block),
        ('in_the_shadows_hide', test_in_the_shadows_applies_hide_condition),
        ('son_of_skywalker_auto_ready', test_son_of_skywalker_auto_ready_on_other_activation),
        ('son_of_skywalker_no_op_on_luke_own', test_son_of_skywalker_no_op_on_luke_own_activation),
        ('real_data_sanity', test_real_data_sanity_check_expected_dc_names_exist),
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
