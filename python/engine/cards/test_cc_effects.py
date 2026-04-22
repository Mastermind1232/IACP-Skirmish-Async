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


def test_blitz_adds_bonus_surge_to_pending_combat():
    g = {
        'pendingCcEffect': {'cardName': 'Blitz', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1, 'bonusSurges': 0},
    }
    r = resolve_pending_cc_effect(g)
    assert r['applied'] is True
    assert g['pendingCombat']['bonusSurges'] == 1


def test_blitz_no_op_without_pending_combat():
    g = {'pendingCcEffect': {'cardName': 'Blitz', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g)
    assert r['applied'] is False
    assert r['reason'] == 'no_pending_combat'


def test_advance_warning_grants_mp_self_and_adjacent():
    g = {'pendingCcEffect': {'cardName': 'Advance Warning', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {
        'msg_id': 'hl1dc0', 'adjacent_msg_id': 'hl1dc1',
    })
    assert g['movementBank']['hl1dc0']['total'] == 1
    assert g['movementBank']['hl1dc1']['total'] == 1


def test_advance_warning_no_adjacent_only_self_gains_mp():
    g = {'pendingCcEffect': {'cardName': 'Advance Warning', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0'})
    assert g['movementBank']['hl1dc0']['total'] == 1
    assert 'hl1dc1' not in g.get('movementBank', {})


def test_battle_scars_grants_1_token_below_threshold():
    g = {'pendingCcEffect': {'cardName': 'Battle Scars', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'figure_key': 'Han-0-0', 'token_type': 'Surge'})
    assert r['count'] == 1
    assert g['figurePowerTokens']['Han-0-0'] == ['Surge']


def test_battle_scars_grants_2_tokens_after_3_plus_damage():
    g = {
        'pendingCcEffect': {'cardName': 'Battle Scars', 'playerNum': 1},
        'figureDamageThisActivation': {'Han-0-0': 4},
    }
    r = resolve_pending_cc_effect(g, {'figure_key': 'Han-0-0', 'token_type': 'Damage'})
    assert r['count'] == 2
    assert g['figurePowerTokens']['Han-0-0'] == ['Damage', 'Damage']


def test_blaze_of_glory_readies_dc_and_queues_eor_damage():
    g = {
        'pendingCcEffect': {'cardName': 'Blaze of Glory', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0', 'hl1dc1'],
        'p1ActivatedDcIndices': [0, 1],
    }
    r = resolve_pending_cc_effect(g, {'target_msg_id': 'hl1dc1'})
    assert r['applied'] is True
    # hl1dc1's index (1) was removed from activated list
    assert g['p1ActivatedDcIndices'] == [0]
    assert g['blazeOfGloryEorDamage'] == {
        'msgId': 'hl1dc1', 'playerNum': 1, 'amount': 3,
    }


def test_adrenaline_stamps_round_wookiee_health_bonus():
    g = {'pendingCcEffect': {'cardName': 'Adrenaline', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g)
    assert r['bonus'] == 5
    assert g['roundWookieeHealthBonus'][1] == 5


def test_armed_escort_sets_active_marker():
    g = {'pendingCcEffect': {'cardName': 'Armed Escort', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0'})
    assert r['applied'] is True
    assert g['armedEscortActive'] == {
        'playerNum': 1, 'anchorMsgId': 'hl1dc0', 'bonusEvade': 1,
    }


def test_beatdown_queues_bonus_hits_for_two_attacks():
    g = {'pendingCcEffect': {'cardName': 'Beatdown', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g)
    assert r['attacksBoosted'] == 2
    assert g['nextAttacksBonusHits'][1]['count'] == 2


def test_close_and_personal_stamps_damage_bonus():
    g = {'pendingCcEffect': {'cardName': 'Close and Personal', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g)
    assert r['bonusDamage'] == 2
    assert g['nextAttackBonusDamage'][1] == 2
    assert g['closeAndPersonalActive']['meleeOnly'] is True


def test_primary_target_applies_to_pending_combat():
    g = {
        'pendingCcEffect': {'cardName': 'Primary Target', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusHits'] == 1
    assert g['pendingCombat']['bonusAccuracy'] == 2


def test_primary_target_queues_for_next_attack_without_combat():
    g = {'pendingCcEffect': {'cardName': 'Primary Target', 'playerNum': 2}}
    resolve_pending_cc_effect(g)
    assert g['nextAttackBonuses'][2] == {'bonusHits': 1, 'bonusAccuracy': 2}


def test_focus_adds_focus_condition():
    g = {'pendingCcEffect': {'cardName': 'Focus', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'figure_key': 'Luke-0-0'})
    assert r['applied'] is True
    assert 'Focus' in g['figureConditions']['Luke-0-0']


def test_recovery_heals_2_hp():
    g = {
        'pendingCcEffect': {'cardName': 'Recovery', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0'],
        'p1DcList': [{'dcName': 'Luke'}],
        'dcHealthState': {'hl1dc0': [[3, 8]]},
    }
    r = resolve_pending_cc_effect(g, {'figure_key': 'Luke-0-0'})
    assert r['applied'] is True
    assert g['dcHealthState']['hl1dc0'][0][0] == 5


def test_urgency_grants_speed_plus_2_mp():
    g = {'pendingCcEffect': {'cardName': 'Urgency', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0', 'speed': 4})
    assert r['mpGranted'] == 6
    assert g['movementBank']['hl1dc0']['total'] == 6
    assert g['urgencyMustSpendAll']['hl1dc0'] is True


def test_hide_in_plain_sight_marks_untargetable():
    g = {'pendingCcEffect': {'cardName': 'Hide in Plain Sight', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'figure_key': 'Luke-0-0'})
    assert g['roundUntargetable']['Luke-0-0'] is True


def test_take_cover_sets_defense_bonus():
    g = {'pendingCcEffect': {'cardName': 'Take Cover', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'figure_key': 'Luke-0-0'})
    assert g['takeCoverActive']['Luke-0-0'] == {
        'bonusBlock': 1, 'accuracyPenalty': 2,
    }


def test_shadow_ops_blocks_opponent_ccs():
    g = {'pendingCcEffect': {'cardName': 'Shadow Ops', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g)
    assert g['shadowOpsBlockedPlayer'] == 2
    assert r['blockedPlayerNum'] == 2


def test_inspiring_speech_focuses_up_to_2():
    g = {'pendingCcEffect': {'cardName': 'Inspiring Speech', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {
        'target_figure_keys': ['Han-0-0', 'Chewbacca-0-0'],
    })
    assert len(r['focused']) == 2
    assert 'Focus' in g['figureConditions']['Han-0-0']
    assert 'Focus' in g['figureConditions']['Chewbacca-0-0']


def test_inspiring_speech_rejects_too_many():
    g = {'pendingCcEffect': {'cardName': 'Inspiring Speech', 'playerNum': 1}}
    try:
        resolve_pending_cc_effect(g, {
            'target_figure_keys': ['A-0-0', 'B-0-0', 'C-0-0'],
        })
    except ValueError as e:
        assert 'at most 2' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_cripple_marks_target_cannot_exit():
    g = {'pendingCcEffect': {'cardName': 'Cripple', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'target_figure_key': 'Vader-0-0'})
    assert r['applied'] is True
    assert g['roundCannotVoluntarilyExit']['Vader-0-0'] is True


def test_disable_marks_target_disabled():
    g = {'pendingCcEffect': {'cardName': 'Disable', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'target_figure_key': 'Vader-0-0'})
    assert g['roundDisabledFigures']['Vader-0-0'] is True


def test_jump_jets_moves_figure():
    g = {
        'pendingCcEffect': {'cardName': 'Jump Jets', 'playerNum': 1},
        'figurePositions': {1: {'Luke-0-0': 'a1'}, 2: {}},
    }
    r = resolve_pending_cc_effect(g, {
        'figure_key': 'Luke-0-0', 'destination': 'E5',
    })
    assert r['destination'] == 'e5'
    assert g['figurePositions'][1]['Luke-0-0'] == 'e5'


def test_planning_draws_two_and_discards_one_for_non_leader():
    g = {
        'pendingCcEffect': {'cardName': 'Planning', 'playerNum': 1},
        'player1CcDeck': ['A', 'B', 'C'],
    }
    r = resolve_pending_cc_effect(g, {'is_leader': False, 'discard_card': 'B'})
    assert sorted(r['drew']) == ['A', 'B']
    assert r['discarded'] == 'B'
    assert g['player1CcHand'] == ['A']
    assert g['player1CcDiscard'] == ['B']


def test_planning_leader_keeps_both_cards():
    g = {
        'pendingCcEffect': {'cardName': 'Planning', 'playerNum': 1},
        'player1CcDeck': ['A', 'B', 'C'],
    }
    r = resolve_pending_cc_effect(g, {'is_leader': True})
    assert r['discarded'] is None
    assert g['player1CcHand'] == ['A', 'B']


def test_rally_the_troops_readies_target():
    g = {
        'pendingCcEffect': {'cardName': 'Rally the Troops', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0', 'hl1dc1'],
        'p1ActivatedDcIndices': [0, 1],
    }
    r = resolve_pending_cc_effect(g, {'target_msg_id': 'hl1dc0'})
    assert r['applied'] is True
    assert g['p1ActivatedDcIndices'] == [1]


def test_second_chance_attaches_to_dc():
    g = {'pendingCcEffect': {'cardName': 'Second Chance', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0'})
    assert r['applied'] is True
    assert 'Second Chance' in g['p1CcAttachments']['hl1dc0']


def test_apex_predator_applies_bundle():
    g = {'pendingCcEffect': {'cardName': 'Apex Predator', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {
        'figure_key': 'Nexu-0-0', 'msg_id': 'hl1dc0', 'token_type': 'Damage',
    })
    assert r['applied'] is True
    assert 'Focus' in g['figureConditions']['Nexu-0-0']
    assert 'Hide' in g['figureConditions']['Nexu-0-0']
    assert g['figurePowerTokens']['Nexu-0-0'] == ['Damage', 'Damage']
    assert g['movementBank']['hl1dc0']['total'] == 2


def test_burst_fire_queues_adjacent_stun():
    g = {'pendingCcEffect': {'cardName': 'Burst Fire', 'playerNum': 1}}
    resolve_pending_cc_effect(g)
    assert g['nextAttackBonusConditions'][1] == [
        {'condition': 'Stun', 'scope': 'adjacentOnDamage'},
    ]


def test_stealth_applies_hide():
    g = {'pendingCcEffect': {'cardName': 'Stealth', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'figure_key': 'Boba-0-0'})
    assert 'Hide' in g['figureConditions']['Boba-0-0']


def test_sprint_grants_3_mp():
    g = {'pendingCcEffect': {'cardName': 'Sprint', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0'})
    assert r['mpGranted'] == 3
    assert g['movementBank']['hl1dc0']['total'] == 3


def test_reload_grants_2_tokens():
    g = {'pendingCcEffect': {'cardName': 'Reload', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'figure_key': 'Han-0-0', 'token_type': 'Damage'})
    assert r['tokensGranted'] == 2
    assert g['figurePowerTokens']['Han-0-0'] == ['Damage', 'Damage']


def test_swift_grants_3_mp():
    g = {'pendingCcEffect': {'cardName': 'Swift', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0'})
    assert g['movementBank']['hl1dc0']['total'] == 3


def test_tough_luck_adds_bonus_block_to_combat():
    g = {
        'pendingCcEffect': {'cardName': 'Tough Luck', 'playerNum': 2},
        'pendingCombat': {'defenderPlayerNum': 2, 'bonusBlock': 0},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusBlock'] == 1


def test_pulse_targeting_adds_accuracy_to_combat():
    g = {
        'pendingCcEffect': {'cardName': 'Pulse Targeting', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusAccuracy'] == 2


def test_blaze_of_glory_no_op_when_target_unknown():
    g = {
        'pendingCcEffect': {'cardName': 'Blaze of Glory', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0'],
        'p1ActivatedDcIndices': [0],
    }
    r = resolve_pending_cc_effect(g, {'target_msg_id': 'hl2dc99'})
    assert r['applied'] is False
    assert r['reason'] == 'target_not_in_dc_list'


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
        ('blitz_adds_bonus_surge', test_blitz_adds_bonus_surge_to_pending_combat),
        ('blitz_no_op_without_combat', test_blitz_no_op_without_pending_combat),
        ('advance_warning_self_and_adjacent', test_advance_warning_grants_mp_self_and_adjacent),
        ('advance_warning_self_only', test_advance_warning_no_adjacent_only_self_gains_mp),
        ('battle_scars_1_token_below_threshold', test_battle_scars_grants_1_token_below_threshold),
        ('battle_scars_2_tokens_after_3_damage', test_battle_scars_grants_2_tokens_after_3_plus_damage),
        ('blaze_of_glory_readies_and_queues_damage', test_blaze_of_glory_readies_dc_and_queues_eor_damage),
        ('blaze_of_glory_noop_unknown_target', test_blaze_of_glory_no_op_when_target_unknown),
        ('adrenaline_wookiee_health_bonus', test_adrenaline_stamps_round_wookiee_health_bonus),
        ('armed_escort_active_marker', test_armed_escort_sets_active_marker),
        ('beatdown_queues_bonus_hits', test_beatdown_queues_bonus_hits_for_two_attacks),
        ('close_and_personal_damage_bonus', test_close_and_personal_stamps_damage_bonus),
        ('primary_target_on_pending_combat', test_primary_target_applies_to_pending_combat),
        ('primary_target_queued_no_combat', test_primary_target_queues_for_next_attack_without_combat),
        ('focus_adds_focus_condition', test_focus_adds_focus_condition),
        ('recovery_heals_2_hp', test_recovery_heals_2_hp),
        ('urgency_grants_speed_plus_2', test_urgency_grants_speed_plus_2_mp),
        ('hide_in_plain_sight_untargetable', test_hide_in_plain_sight_marks_untargetable),
        ('take_cover_defense_bonus', test_take_cover_sets_defense_bonus),
        ('shadow_ops_blocks_opponent', test_shadow_ops_blocks_opponent_ccs),
        ('inspiring_speech_focuses', test_inspiring_speech_focuses_up_to_2),
        ('inspiring_speech_rejects_too_many', test_inspiring_speech_rejects_too_many),
        ('cripple_marks_cannot_exit', test_cripple_marks_target_cannot_exit),
        ('disable_marks_disabled', test_disable_marks_target_disabled),
        ('jump_jets_moves_figure', test_jump_jets_moves_figure),
        ('planning_draws_and_discards_non_leader', test_planning_draws_two_and_discards_one_for_non_leader),
        ('planning_leader_keeps_both', test_planning_leader_keeps_both_cards),
        ('rally_the_troops_readies', test_rally_the_troops_readies_target),
        ('second_chance_attaches', test_second_chance_attaches_to_dc),
        ('apex_predator_bundle', test_apex_predator_applies_bundle),
        ('burst_fire_queues_stun', test_burst_fire_queues_adjacent_stun),
        ('stealth_applies_hide', test_stealth_applies_hide),
        ('sprint_grants_3_mp', test_sprint_grants_3_mp),
        ('reload_grants_2_tokens', test_reload_grants_2_tokens),
        ('swift_grants_3_mp', test_swift_grants_3_mp),
        ('tough_luck_bonus_block', test_tough_luck_adds_bonus_block_to_combat),
        ('pulse_targeting_accuracy', test_pulse_targeting_adds_accuracy_to_combat),
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
