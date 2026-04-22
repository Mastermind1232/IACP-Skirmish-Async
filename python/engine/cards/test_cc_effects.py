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


def test_deadeye_adds_accuracy():
    g = {
        'pendingCcEffect': {'cardName': 'Deadeye', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusAccuracy'] == 2


def test_positioning_advantage_adds_hit():
    g = {
        'pendingCcEffect': {'cardName': 'Positioning Advantage', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusHits'] == 1


def test_fleet_footed_grants_1_mp():
    g = {'pendingCcEffect': {'cardName': 'Fleet Footed', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0'})
    assert g['movementBank']['hl1dc0']['total'] == 1


def test_heavy_armor_negates_pierce():
    g = {
        'pendingCcEffect': {'cardName': 'Heavy Armor', 'playerNum': 2},
        'pendingCombat': {'defenderPlayerNum': 2},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['pierceNegated'] is True


def test_parry_block_variant():
    g = {
        'pendingCcEffect': {'cardName': 'Parry', 'playerNum': 2},
        'pendingCombat': {'defenderPlayerNum': 2},
    }
    resolve_pending_cc_effect(g, {'which': 'block'})
    assert g['pendingCombat']['bonusBlock'] == 1


def test_parry_evade_variant():
    g = {
        'pendingCcEffect': {'cardName': 'Parry', 'playerNum': 2},
        'pendingCombat': {'defenderPlayerNum': 2},
    }
    resolve_pending_cc_effect(g, {'which': 'evade'})
    assert g['pendingCombat']['bonusEvade'] == 1


def test_hour_of_need_heals_by_round_number():
    g = {
        'pendingCcEffect': {'cardName': 'Hour of Need', 'playerNum': 1},
        'round': 4,
        'p1DcMessageIds': ['hl1dc0'],
        'p1DcList': [{'dcName': 'Luke'}],
        'dcHealthState': {'hl1dc0': [[3, 10]]},
    }
    r = resolve_pending_cc_effect(g, {'figure_key': 'Luke-0-0'})
    assert r['healed'] == 4
    assert g['dcHealthState']['hl1dc0'][0][0] == 7


def test_force_push_moves_target_either_side():
    g = {
        'pendingCcEffect': {'cardName': 'Force Push', 'playerNum': 1},
        'figurePositions': {1: {}, 2: {'Trooper-0-0': 'a1'}},
    }
    r = resolve_pending_cc_effect(g, {
        'target_figure_key': 'Trooper-0-0', 'destination': 'c3',
    })
    assert r['applied'] is True
    assert g['figurePositions'][2]['Trooper-0-0'] == 'c3'


def test_grisly_contest_deals_dmg_both_sides():
    g = {
        'pendingCcEffect': {'cardName': 'Grisly Contest', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0'],
        'p1DcList': [{'dcName': 'Han'}],
        'p2DcMessageIds': ['hl2dc0'],
        'p2DcList': [{'dcName': 'Vader'}],
        'dcHealthState': {
            'hl1dc0': [[10, 10]],
            'hl2dc0': [[8, 8]],
        },
    }
    resolve_pending_cc_effect(g, {
        'target_figure_key': 'Vader-0-0',
        'self_figure_key': 'Han-0-0',
    })
    assert g['dcHealthState']['hl2dc0'][0][0] == 6  # 8-2
    assert g['dcHealthState']['hl1dc0'][0][0] == 8  # 10-2


def test_stimulants_damage_mp_and_focus():
    g = {
        'pendingCcEffect': {'cardName': 'Stimulants', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0'],
        'p1DcList': [{'dcName': 'Han'}],
        'dcHealthState': {'hl1dc0': [[8, 8]]},
    }
    resolve_pending_cc_effect(g, {
        'target_figure_key': 'Han-0-0',
        'target_player_num': 1,
        'target_msg_id': 'hl1dc0',
    })
    assert g['dcHealthState']['hl1dc0'][0][0] == 7  # 8-1
    assert g['movementBank']['hl1dc0']['total'] == 1
    assert 'Focus' in g['figureConditions']['Han-0-0']


def test_mitigate_bumps_attacker_reroll_count():
    g = {
        'pendingCcEffect': {'cardName': 'Mitigate', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['attackerRerollCount'] == 1


def test_hard_to_hit_bumps_defender_reroll_count():
    g = {
        'pendingCcEffect': {'cardName': 'Hard to Hit', 'playerNum': 2},
        'pendingCombat': {'defenderPlayerNum': 2},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['defenderRerollCount'] == 1


def test_brace_for_impact_adds_black_die():
    g = {
        'pendingCcEffect': {'cardName': 'Brace for Impact', 'playerNum': 2},
        'pendingCombat': {'defenderPlayerNum': 2},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusDefenseDice'] == ['black']


def test_stealth_tactics_adds_white_die():
    g = {
        'pendingCcEffect': {'cardName': 'Stealth Tactics', 'playerNum': 2},
        'pendingCombat': {'defenderPlayerNum': 2},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusDefenseDice'] == ['white']


def test_lock_on_accuracy_variant():
    g = {
        'pendingCcEffect': {'cardName': 'Lock On', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g, {'effect': 'accuracy'})
    assert g['pendingCombat']['bonusAccuracy'] == 3


def test_lock_on_dodge_variant():
    g = {
        'pendingCcEffect': {'cardName': 'Lock On', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g, {'effect': 'dodge'})
    assert g['pendingCombat']['dodgeReduction'] == 1


def test_forward_march_grants_mp_to_list():
    g = {'pendingCcEffect': {'cardName': 'Forward March', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'friendly_msg_ids': ['hl1dc0', 'hl1dc1']})
    assert g['movementBank']['hl1dc0']['total'] == 1
    assert g['movementBank']['hl1dc1']['total'] == 1


def test_ready_weapons_distributes_3_hits():
    g = {'pendingCcEffect': {'cardName': 'Ready Weapons', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {
        'distribution': [
            {'figureKey': 'Luke-0-0', 'count': 2},
            {'figureKey': 'Han-0-0', 'count': 1},
        ],
    })
    assert r['applied'] is True
    assert g['figurePowerTokens']['Luke-0-0'] == ['Damage', 'Damage']
    assert g['figurePowerTokens']['Han-0-0'] == ['Damage']


def test_ready_weapons_rejects_wrong_total():
    g = {'pendingCcEffect': {'cardName': 'Ready Weapons', 'playerNum': 1}}
    try:
        resolve_pending_cc_effect(g, {
            'distribution': [{'figureKey': 'Luke-0-0', 'count': 2}],
        })
    except ValueError as e:
        assert 'sum to 3' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_roar_stuns_targets_when_damaged():
    g = {'pendingCcEffect': {'cardName': 'Roar', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {
        'self_damage_suffered': 3,
        'target_figure_keys': ['Vader-0-0', 'Trooper-0-0'],
    })
    assert r['applied'] is True
    assert 'Stun' in g['figureConditions']['Vader-0-0']
    assert 'Stun' in g['figureConditions']['Trooper-0-0']


def test_roar_no_op_below_threshold():
    g = {'pendingCcEffect': {'cardName': 'Roar', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {
        'self_damage_suffered': 2,
        'target_figure_keys': ['Vader-0-0'],
    })
    assert r['applied'] is False
    assert r['reason'] == 'below_3_damage_threshold'


def test_reposition_moves_friendly():
    g = {
        'pendingCcEffect': {'cardName': 'Reposition', 'playerNum': 1},
        'figurePositions': {1: {'Han-0-0': 'a1'}, 2: {}},
    }
    r = resolve_pending_cc_effect(g, {
        'target_figure_key': 'Han-0-0', 'destination': 'D5',
    })
    assert r['applied'] is True
    assert g['figurePositions'][1]['Han-0-0'] == 'd5'


def test_regroup_removes_only_harmful_conditions():
    g = {
        'pendingCcEffect': {'cardName': 'Regroup', 'playerNum': 1},
        'figureConditions': {
            'Luke-0-0': ['Stun', 'Focus', 'Bleed'],
            'Han-0-0': ['Weaken', 'Hide'],
        },
    }
    r = resolve_pending_cc_effect(g, {
        'friendly_figure_keys': ['Luke-0-0', 'Han-0-0'],
    })
    assert r['applied'] is True
    assert 'Stun' not in g['figureConditions']['Luke-0-0']
    assert 'Bleed' not in g['figureConditions']['Luke-0-0']
    assert 'Focus' in g['figureConditions']['Luke-0-0']  # beneficial preserved
    assert 'Weaken' not in g['figureConditions']['Han-0-0']
    assert 'Hide' in g['figureConditions']['Han-0-0']


def test_bladestorm_surge_and_post_combat_trigger():
    g = {
        'pendingCcEffect': {'cardName': 'Bladestorm', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusSurges'] == 1
    triggers = g['pendingCombat']['postCombatTriggers']
    assert len(triggers) == 1
    assert triggers[0]['effect'] == 'bladestorm_adjacent_damage'


def test_spinning_kick_adds_cleave():
    g = {
        'pendingCcEffect': {'cardName': 'Spinning Kick', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusCleave'] == 3


def test_heightened_reflexes_records_die_to_zero():
    g = {
        'pendingCcEffect': {'cardName': 'Heightened Reflexes', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g, {'die_index': 1})
    assert g['pendingCombat']['defenderDiceToZero'] == [1]


def test_looking_for_a_fight_grants_token_and_moves():
    g = {
        'pendingCcEffect': {'cardName': 'Looking for a Fight', 'playerNum': 1},
        'figurePositions': {1: {'Han-0-0': 'a1'}, 2: {}},
    }
    r = resolve_pending_cc_effect(g, {
        'figure_key': 'Han-0-0', 'move_destination': 'A2',
    })
    assert r['applied'] is True
    assert g['figurePowerTokens']['Han-0-0'] == ['Damage']
    assert g['figurePositions'][1]['Han-0-0'] == 'a2'


def test_draw_sets_free_attack_bonus():
    g = {'pendingCcEffect': {'cardName': 'Draw!', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0'})
    assert g['freeAttackBonusPending']['hl1dc0'] is True


def test_hit_and_run_queues_post_attack_mp():
    g = {'pendingCcEffect': {'cardName': 'Hit and Run', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0'})
    assert g['postAttackMpBonus']['hl1dc0'] == 3


def test_expose_weakness_stamps_pierce_target():
    g = {'pendingCcEffect': {'cardName': 'Expose Weakness', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'target_figure_key': 'Vader-0-0'})
    assert g['exposeWeaknessTargets']['Vader-0-0'] == {'pierce': 2}


def test_veteran_instincts_grants_both_tokens():
    g = {'pendingCcEffect': {'cardName': 'Veteran Instincts', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {
        'figure_key': 'Han-0-0',
        'first_token': 'Damage', 'second_token': 'Evade',
    })
    assert r['applied'] is True
    assert sorted(g['figurePowerTokens']['Han-0-0']) == ['Damage', 'Evade']


def test_toxic_dart_strain_and_weaken():
    g = {
        'pendingCcEffect': {'cardName': 'Toxic Dart', 'playerNum': 1},
        'p2DcMessageIds': ['hl2dc0'],
        'p2DcList': [{'dcName': 'Vader'}],
        'dcHealthState': {'hl2dc0': [[8, 8]]},
    }
    resolve_pending_cc_effect(g, {
        'target_figure_key': 'Vader-0-0', 'target_player_num': 2,
    })
    assert g['dcHealthState']['hl2dc0'][0][0] == 7
    assert 'Weaken' in g['figureConditions']['Vader-0-0']


def test_take_position_marks_push_immune():
    g = {'pendingCcEffect': {'cardName': 'Take Position', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'figure_key': 'Han-0-0'})
    assert g['takePositionActive']['Han-0-0'] == {
        'bonusBlock': 1, 'pushImmune': True,
    }


def test_camouflage_applies_hide():
    g = {'pendingCcEffect': {'cardName': 'Camouflage', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'figure_key': 'L-0-0'})
    assert 'Hide' in g['figureConditions']['L-0-0']


def test_celebration_cc_awards_4_objective_vp():
    g = {'pendingCcEffect': {'cardName': 'Celebration', 'playerNum': 1}}
    resolve_pending_cc_effect(g)
    assert g['player1VP']['objectives'] == 4


def test_cut_lines_sets_round_flag():
    g = {'pendingCcEffect': {'cardName': 'Cut Lines', 'playerNum': 1}}
    resolve_pending_cc_effect(g)
    assert g['cutLinesActive'] is True


def test_deadly_precision_stamps_round_dodge_reduction():
    g = {'pendingCcEffect': {'cardName': 'Deadly Precision', 'playerNum': 1}}
    resolve_pending_cc_effect(g)
    assert g['roundDodgeReduction'][1] == 1


def test_disengage_cc_grants_3_mp():
    g = {'pendingCcEffect': {'cardName': 'Disengage', 'playerNum': 1}}
    resolve_pending_cc_effect(g, {'msg_id': 'hl1dc0'})
    assert g['movementBank']['hl1dc0']['total'] == 3


def test_furious_charge_readies_when_damage_over_3():
    g = {
        'pendingCcEffect': {'cardName': 'Furious Charge', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0'],
        'p1ActivatedDcIndices': [0],
    }
    r = resolve_pending_cc_effect(g, {'damage_suffered': 5, 'msg_id': 'hl1dc0'})
    assert r['applied'] is True
    assert g['p1ActivatedDcIndices'] == []


def test_furious_charge_below_threshold():
    g = {'pendingCcEffect': {'cardName': 'Furious Charge', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'damage_suffered': 1, 'msg_id': 'hl1dc0'})
    assert r['applied'] is False


def test_explosive_weaponry_adds_blast():
    g = {
        'pendingCcEffect': {'cardName': 'Explosive Weaponry', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['bonusBlast'] == 1


def test_glory_of_the_kill_heals_on_defeat():
    g = {
        'pendingCcEffect': {'cardName': 'Glory of the Kill', 'playerNum': 1},
        'p1DcMessageIds': ['hl1dc0'],
        'p1DcList': [{'dcName': 'Vader'}],
        'dcHealthState': {'hl1dc0': [[5, 12]]},
    }
    r = resolve_pending_cc_effect(g, {'defeated': True, 'figure_key': 'Vader-0-0'})
    assert r['healed'] == 3
    assert g['dcHealthState']['hl1dc0'][0][0] == 8


def test_hunter_protocol_allows_duplicate_surges():
    g = {
        'pendingCcEffect': {'cardName': 'Hunter Protocol', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['duplicateSurgesAllowed'] is True


def test_heart_of_freedom_triple_effect():
    g = {
        'pendingCcEffect': {'cardName': 'Heart of Freedom', 'playerNum': 1},
        'dcHealthState': {'hl1dc0': [[5, 10]]},
        'figureConditions': {'L-0-0': ['Stun', 'Focus']},
    }
    r = resolve_pending_cc_effect(g, {
        'figure_key': 'L-0-0', 'msg_id': 'hl1dc0', 'condition': 'Stun',
    })
    assert r['applied'] is True
    assert 'Stun' not in g['figureConditions']['L-0-0']
    assert 'Focus' in g['figureConditions']['L-0-0']
    assert g['dcHealthState']['hl1dc0'][0][0] == 7  # 5 + 2
    assert g['movementBank']['hl1dc0']['total'] == 2


def test_black_market_prices_draws_and_vps():
    from python.engine.data import cc_effects_loader
    cc_effects_loader._cc_effects = {
        'Card A': {'cost': 3},
        'Card B': {'cost': 1},
    }
    try:
        g = {
            'pendingCcEffect': {'cardName': 'Black Market Prices', 'playerNum': 1},
            'player1CcDeck': ['Card A', 'Card B'],
        }
        r = resolve_pending_cc_effect(g)
        # Default: highest-cost card discarded (Card A = 3)
        assert r['discarded'] == 'Card A'
        assert r['vpGained'] == 3
        assert g['player1VP']['objectives'] == 3
    finally:
        cc_effects_loader.reset_cache()


def test_brace_yourself_rejects_in_attacker_activation():
    g = {
        'pendingCcEffect': {'cardName': 'Brace Yourself', 'playerNum': 2},
        'pendingCombat': {'attackerPlayerNum': 1},
    }
    r = resolve_pending_cc_effect(g, {'is_attackers_activation': True})
    assert r['applied'] is False
    assert r['reason'] == 'in_attackers_activation'


def test_collect_intel_reveals_opponent_hand():
    g = {
        'pendingCcEffect': {'cardName': 'Collect Intel', 'playerNum': 1},
        'player2CcHand': ['X', 'Y', 'Z'],
    }
    r = resolve_pending_cc_effect(g)
    assert r['opponentHand'] == ['X', 'Y', 'Z']
    assert g['collectIntelView']['viewedBy'] == 1


def test_dangerous_bargains_both_players_gain_3_when_low_vp():
    g = {'pendingCcEffect': {'cardName': 'Dangerous Bargains', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g)
    assert r['applied'] is True
    assert g['player1VP']['total'] == 3
    assert g['player2VP']['total'] == 3


def test_dangerous_bargains_no_op_when_vp_too_high():
    g = {
        'pendingCcEffect': {'cardName': 'Dangerous Bargains', 'playerNum': 1},
        'player1VP': {'total': 35, 'kills': 35, 'objectives': 0},
    }
    r = resolve_pending_cc_effect(g)
    assert r['applied'] is False
    assert r['reason'] == 'vp_too_high'


def test_espionage_mastery_returns_card_and_draws():
    g = {
        'pendingCcEffect': {'cardName': 'Espionage Mastery', 'playerNum': 1},
        'player1CcDiscard': ['X', 'Target'],
        'player1CcDeck': ['Y'],
    }
    r = resolve_pending_cc_effect(g, {'card_name': 'Target'})
    assert r['returned'] == 'Target'
    assert 'Target' in g['player1CcHand']
    assert 'Target' not in g['player1CcDiscard']


def test_iron_will_caps_incoming_damage():
    g = {
        'pendingCcEffect': {'cardName': 'Iron Will', 'playerNum': 2},
        'pendingCombat': {'defenderPlayerNum': 2},
    }
    resolve_pending_cc_effect(g)
    assert g['pendingCombat']['maxIncomingDamage'] == 3


def test_of_no_importance_deducts_opponent_vp():
    g = {
        'pendingCcEffect': {'cardName': 'Of No Importance', 'playerNum': 1},
        'player2VP': {'total': 10, 'kills': 10, 'objectives': 0},
    }
    r = resolve_pending_cc_effect(g)
    assert r['opponentVpReduction'] == 4
    assert g['player2VP']['total'] == 6


def test_negation_cancels_pending_cc_effect():
    g = {
        'pendingCcEffect': {'cardName': 'Negation', 'playerNum': 2},
    }
    # Normally pendingCcEffect would be the triggering card; Negation is
    # the response. After resolution, pendingCcEffect is cleared and
    # lastCancelledCc records the method.
    r = resolve_pending_cc_effect(g, {'cancelled_card': 'Reinforcements'})
    assert r['applied'] is True
    assert g['pendingCcEffect'] is None
    assert g['lastCancelledCc'] == {
        'cardName': 'Reinforcements', 'byPlayerNum': 2, 'method': 'negation',
    }


def test_strategic_shift_shuffles_target_hand():
    g = {
        'pendingCcEffect': {'cardName': 'Strategic Shift', 'playerNum': 1},
        'player2CcHand': ['A', 'B'],
        'player2CcDeck': ['C', 'D'],
    }
    resolve_pending_cc_effect(g, {'target_player_num': 2})
    # Player 2's hand is shuffled into deck then draws 2
    assert len(g['player2CcHand']) == 2
    assert len(g['player2CcDeck']) == 2


def test_reduce_to_rubble_no_op_on_miss():
    g = {
        'pendingCcEffect': {'cardName': 'Reduce to Rubble', 'playerNum': 1},
        'pendingCombat': {'attackerPlayerNum': 1, 'hit': False},
    }
    r = resolve_pending_cc_effect(g)
    assert r['applied'] is False
    assert r['reason'] == 'attack_missed'


def test_price_on_their_heads_marks_target():
    g = {'pendingCcEffect': {'cardName': 'Price on Their Heads', 'playerNum': 1}}
    r = resolve_pending_cc_effect(g, {'target_msg_id': 'hl2dc0'})
    assert r['applied'] is True
    assert g['priceOnTheirHeadsTargets']['hl2dc0'] == {
        'markerOwner': 1, 'bonus': 4,
    }


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
        ('deadeye_accuracy', test_deadeye_adds_accuracy),
        ('positioning_advantage_hit', test_positioning_advantage_adds_hit),
        ('fleet_footed_1_mp', test_fleet_footed_grants_1_mp),
        ('heavy_armor_pierce_negated', test_heavy_armor_negates_pierce),
        ('parry_block', test_parry_block_variant),
        ('parry_evade', test_parry_evade_variant),
        ('hour_of_need_heals_by_round', test_hour_of_need_heals_by_round_number),
        ('force_push_moves_target', test_force_push_moves_target_either_side),
        ('grisly_contest_both_sides', test_grisly_contest_deals_dmg_both_sides),
        ('stimulants_dmg_mp_focus', test_stimulants_damage_mp_and_focus),
        ('mitigate_bumps_attacker_reroll', test_mitigate_bumps_attacker_reroll_count),
        ('hard_to_hit_bumps_defender_reroll', test_hard_to_hit_bumps_defender_reroll_count),
        ('brace_for_impact_black_die', test_brace_for_impact_adds_black_die),
        ('stealth_tactics_white_die', test_stealth_tactics_adds_white_die),
        ('lock_on_accuracy', test_lock_on_accuracy_variant),
        ('lock_on_dodge', test_lock_on_dodge_variant),
        ('forward_march_grants_mp', test_forward_march_grants_mp_to_list),
        ('ready_weapons_distributes_3', test_ready_weapons_distributes_3_hits),
        ('ready_weapons_rejects_wrong_total', test_ready_weapons_rejects_wrong_total),
        ('roar_stuns_when_damaged', test_roar_stuns_targets_when_damaged),
        ('roar_no_op_below_threshold', test_roar_no_op_below_threshold),
        ('reposition_moves_friendly', test_reposition_moves_friendly),
        ('regroup_removes_harmful_only', test_regroup_removes_only_harmful_conditions),
        ('bladestorm_surge_and_trigger', test_bladestorm_surge_and_post_combat_trigger),
        ('spinning_kick_cleave', test_spinning_kick_adds_cleave),
        ('heightened_reflexes_die_to_zero', test_heightened_reflexes_records_die_to_zero),
        ('looking_for_a_fight_token_and_move', test_looking_for_a_fight_grants_token_and_moves),
        ('draw_free_attack', test_draw_sets_free_attack_bonus),
        ('hit_and_run_post_attack_mp', test_hit_and_run_queues_post_attack_mp),
        ('expose_weakness_pierce_target', test_expose_weakness_stamps_pierce_target),
        ('veteran_instincts_both_tokens', test_veteran_instincts_grants_both_tokens),
        ('toxic_dart_strain_weaken', test_toxic_dart_strain_and_weaken),
        ('take_position_push_immune', test_take_position_marks_push_immune),
        ('camouflage_hide', test_camouflage_applies_hide),
        ('celebration_cc_vp', test_celebration_cc_awards_4_objective_vp),
        ('cut_lines_flag', test_cut_lines_sets_round_flag),
        ('deadly_precision_dodge_reduction', test_deadly_precision_stamps_round_dodge_reduction),
        ('disengage_cc_3_mp', test_disengage_cc_grants_3_mp),
        ('furious_charge_readies', test_furious_charge_readies_when_damage_over_3),
        ('furious_charge_below_threshold', test_furious_charge_below_threshold),
        ('explosive_weaponry_blast', test_explosive_weaponry_adds_blast),
        ('glory_of_the_kill_heals', test_glory_of_the_kill_heals_on_defeat),
        ('hunter_protocol_duplicate_surges', test_hunter_protocol_allows_duplicate_surges),
        ('heart_of_freedom_triple', test_heart_of_freedom_triple_effect),
        ('black_market_prices_draws_vps', test_black_market_prices_draws_and_vps),
        ('brace_yourself_rejects_att_act', test_brace_yourself_rejects_in_attacker_activation),
        ('collect_intel_reveals', test_collect_intel_reveals_opponent_hand),
        ('dangerous_bargains_both_gain', test_dangerous_bargains_both_players_gain_3_when_low_vp),
        ('dangerous_bargains_no_op_high_vp', test_dangerous_bargains_no_op_when_vp_too_high),
        ('espionage_mastery_returns_card', test_espionage_mastery_returns_card_and_draws),
        ('iron_will_caps_damage', test_iron_will_caps_incoming_damage),
        ('of_no_importance_deducts_vp', test_of_no_importance_deducts_opponent_vp),
        ('negation_cancels_pending_cc', test_negation_cancels_pending_cc_effect),
        ('strategic_shift_shuffles_hand', test_strategic_shift_shuffles_target_hand),
        ('reduce_to_rubble_miss_no_op', test_reduce_to_rubble_no_op_on_miss),
        ('price_on_their_heads_marks', test_price_on_their_heads_marks_target),
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
