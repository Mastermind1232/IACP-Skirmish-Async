"""Port of tests/domain/oracle/combat-oracles.test.js (D6.8b).

Ports ORACLE-COMBAT-001 through ORACLE-COMBAT-012 — pure-function oracles
against compute_combat_result covering base damage, zero-damage foundation,
Weakened ordering, miss paths, pierce-vs-block, Hidden, Cunning,
maxDamageToDefender, Wookiee Avenger, bonusBlock, perDefDieDamage, and
ignoreDefenseResultsNotOnDice.

Each oracle encodes ONE IACP rule as a deterministic input/output pair. Any
divergence fails the oracle.

Run as: python3 -m python.parity.oracles.combat.test_compute_combat_result
"""
import sys

from python.engine.mechanics.combat import compute_combat_result


# ── ORACLE-COMBAT-001: Base Damage Formula ──────────────────────────────────

def test_001a_simple_melee_3_dmg_vs_1_block():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
    })
    assert r['hit'] is True
    assert r['damage'] == 2
    assert r['effectiveBlock'] == 1


def test_001b_with_surge_damage_2_plus_1_surge_dmg_vs_1_block():
    r = compute_combat_result({
        'attackRoll': {'acc': 4, 'dmg': 2, 'surge': 1},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'surgeDamage': 1,
        'isRanged': True, 'distanceToTarget': 3,
    })
    assert r['hit'] is True
    assert r['damage'] == 2
    assert r['effectiveBlock'] == 1


def test_001c_block_exceeds_damage_floors_at_0():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 1, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
    })
    assert r['hit'] is True
    assert r['damage'] == 0
    assert r['effectiveBlock'] == 3


def test_001d_bonus_hits_included():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'bonusHits': 1,
    })
    assert r['hit'] is True
    assert r['damage'] == 2


# ── ORACLE-COMBAT-002: Zero Damage Foundation (Condition Gating Prereq) ─────

def test_002a_fully_blocked_with_surge_conditions_still_hit():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 1, 'surge': 1},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'surgeDamage': 1,
        'surgeConditions': ['Stun'],
    })
    assert r['hit'] is True
    assert r['damage'] == 0
    assert 'Stun' in r['resultText'], 'conditions appear in resultText (gating is handler responsibility)'


def test_002b_exact_block_equals_damage_floors_to_0():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 2, 'evade': 0, 'dodge': False},
    })
    assert r['hit'] is True
    assert r['damage'] == 0
    assert r['effectiveBlock'] == 2


def test_002c_attack_result_replace_with_stun_damage_becomes_0_stun_added():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'attackResultReplaceWithStun': True,
    })
    assert r['hit'] is True
    assert r['damage'] == 0
    assert 'Set for Stun' in r['resultText']


def test_002d_attack_result_replace_with_stun_noop_when_damage_0():
    combat = {
        'attackRoll': {'acc': 0, 'dmg': 1, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'attackResultReplaceWithStun': True,
        'bonusConditions': [],
    }
    compute_combat_result(combat)
    assert 'Stun' not in combat['bonusConditions'], 'Set for Stun does not fire when damage is 0'


# ── ORACLE-COMBAT-003: Weakened Modifier Ordering ───────────────────────────

def test_003a_defender_weakened_reduces_effective_block_after_pierce():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'surgePierce': 1,
        'defenderConds': ['Weaken'],
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 1
    assert r['damage'] == 1


def test_003b_attacker_weakened_reduces_damage_after_block_subtraction():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'attackerConds': ['Weaken'],
    })
    assert r['hit'] is True
    assert r['damage'] == 1


def test_003c_attacker_weakened_can_reduce_damage_to_0():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'attackerConds': ['Weaken'],
    })
    assert r['hit'] is True
    assert r['damage'] == 0


def test_003d_attacker_weakened_noop_when_damage_already_0():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 1, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'attackerConds': ['Weaken'],
    })
    assert r['hit'] is True
    assert r['damage'] == 0


def test_003e_both_weakened_sequential_reduction():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 2, 'evade': 0, 'dodge': False},
        'attackerConds': ['Weaken'],
        'defenderConds': ['Weaken'],
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 1
    assert r['damage'] == 1


# ── ORACLE-COMBAT-004: Miss-Path Semantics ──────────────────────────────────

def test_004a_dodge_causes_miss():
    r = compute_combat_result({
        'attackRoll': {'acc': 5, 'dmg': 5, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': True},
    })
    assert r['hit'] is False
    assert r['damage'] == 0
    assert 'Dodge' in r['resultText']


def test_004b_ranged_accuracy_miss():
    r = compute_combat_result({
        'attackRoll': {'acc': 2, 'dmg': 5, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'isRanged': True, 'distanceToTarget': 4,
    })
    assert r['hit'] is False
    assert r['damage'] == 0
    assert 'insufficient accuracy' in r['resultText']


def test_004c_melee_bypasses_accuracy_gate_RNG03():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'isRanged': False, 'distanceToTarget': 5,
    })
    assert r['hit'] is True, 'melee attack must hit regardless of accuracy/distance'
    assert r['damage'] == 3


def test_004d_force_miss_overrides_everything():
    r = compute_combat_result({
        'attackRoll': {'acc': 10, 'dmg': 10, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'forceMiss': True,
    })
    assert r['hit'] is False
    assert r['damage'] == 0
    assert 'On the Lam' in r['resultText']


def test_004e_surge_cancel_dodge_deadly_spin_cancels_dodge():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': True},
        'surgeCancelDodge': True,
    })
    assert r['hit'] is True, 'dodge cancelled by surgeCancelDodge'
    assert r['damage'] == 2


def test_004f_ranged_hit_sufficient_accuracy():
    r = compute_combat_result({
        'attackRoll': {'acc': 4, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'isRanged': True, 'distanceToTarget': 3,
    })
    assert r['hit'] is True
    assert r['damage'] == 2


def test_004g_ranged_accuracy_exactly_equals_distance_hits():
    r = compute_combat_result({
        'attackRoll': {'acc': 4, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'isRanged': True, 'distanceToTarget': 4,
    })
    assert r['hit'] is True, 'accuracy == distance is a hit, not a miss'
    assert r['damage'] == 2


# ── ORACLE-COMBAT-005: Pierce vs Block vs Combat Suit ───────────────────────

def test_005a_basic_pierce_3dmg_pierce2_vs_3block():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'surgePierce': 2,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 1
    assert r['damage'] == 2


def test_005b_combat_suit_reduces_pierce():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'surgePierce': 2,
        'defenderReducePierce': 1,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 2
    assert r['damage'] == 1


def test_005c_defender_ignore_pierce():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'surgePierce': 3,
        'defenderIgnorePierce': True,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 3
    assert r['damage'] == 0


def test_005d_surge_cancel_kuiil_removes_block_before_pierce():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'surgeCancel': 2,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 1
    assert r['damage'] == 2


def test_005e_surge_cancel_plus_pierce_combined():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'surgeCancel': 1,
        'surgePierce': 1,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 1
    assert r['damage'] == 2


def test_005f_pierce_exceeds_block_effective_block_floors_to_0():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'surgePierce': 3,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 0
    assert r['damage'] == 3


# ── ORACLE-COMBAT-006: Hidden (Defender Accuracy Penalty) ───────────────────

def test_006a_ranged_miss_due_to_hidden():
    r = compute_combat_result({
        'attackRoll': {'acc': 4, 'dmg': 5, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'isRanged': True, 'distanceToTarget': 4,
        'defenderConds': ['Hide'],
    })
    assert r['hit'] is False
    assert r['damage'] == 0
    assert 'insufficient accuracy' in r['resultText']
    assert 'Hidden' in r['resultText']


def test_006b_ranged_hit_despite_hidden():
    r = compute_combat_result({
        'attackRoll': {'acc': 6, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'isRanged': True, 'distanceToTarget': 4,
        'defenderConds': ['Hide'],
    })
    assert r['hit'] is True
    assert r['damage'] == 2


def test_006c_melee_unaffected_by_hidden():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'isRanged': False, 'distanceToTarget': 1,
        'defenderConds': ['Hide'],
    })
    assert r['hit'] is True, 'melee ignores accuracy gate even with Hidden penalty'
    assert r['damage'] == 2


# ── ORACLE-COMBAT-007: Cunning (Block from Evade) ───────────────────────────

def test_007a_cunning_converts_2_evade_into_2_block():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 2, 'dodge': False},
        'hasCunning': True,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 3
    assert r['damage'] == 0
    assert 'Cunning' in r['resultText']


def test_007b_cunning_with_0_evade_no_bonus():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'hasCunning': True,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 1
    assert r['damage'] == 2


def test_007c_cunning_plus_pierce_pierce_reduces_total_block():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 2, 'dodge': False},
        'hasCunning': True,
        'surgePierce': 1,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 2
    assert r['damage'] == 1


# ── ORACLE-COMBAT-008: maxDamageToDefender (Damage Cap) ─────────────────────

def test_008a_damage_capped():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 5, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'maxDamageToDefender': 3,
    })
    assert r['hit'] is True
    assert r['damage'] == 3


def test_008b_damage_below_cap_no_effect():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'maxDamageToDefender': 3,
    })
    assert r['hit'] is True
    assert r['damage'] == 2


def test_008c_attacker_weaken_applies_before_cap():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 5, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'attackerConds': ['Weaken'],
        'maxDamageToDefender': 3,
    })
    assert r['hit'] is True
    assert r['damage'] == 3


# ── ORACLE-COMBAT-009: Wookiee Avenger (Dodge-to-Evade Conversion) ──────────

def test_009a_dodge_converted_to_evade_attack_hits():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': True},
        'wookieeAvengerDefend': True,
    })
    assert r['hit'] is True, 'Wookiee Avenger converts dodge → no miss'
    assert r['damage'] == 2


def test_009b_no_dodge_rolled_wookiee_avenger_noop():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'wookieeAvengerDefend': True,
    })
    assert r['hit'] is True
    assert r['damage'] == 2


def test_009c_dodge_plus_wookiee_plus_cunning_chains():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 2, 'evade': 0, 'dodge': True},
        'wookieeAvengerDefend': True,
        'hasCunning': True,
    })
    assert r['hit'] is True, 'dodge converted, not a miss'
    assert r['effectiveBlock'] == 3
    assert r['damage'] == 0


# ── ORACLE-COMBAT-010: bonusBlock ───────────────────────────────────────────

def test_010a_bonus_block_increases_effective_block():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 4, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'bonusBlock': 2,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 3
    assert r['damage'] == 1


def test_010b_bonus_block_plus_pierce():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 4, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'bonusBlock': 2,
        'surgePierce': 1,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 2
    assert r['damage'] == 2


def test_010c_bonus_block_alone_fully_absorbs():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'bonusBlock': 3,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 3
    assert r['damage'] == 0


# ── ORACLE-COMBAT-011: perDefDieDamage ──────────────────────────────────────

def test_011a_one_bonus_per_die_one_die_default():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'bonusDamagePerDefenseDie': 1,
    })
    assert r['hit'] is True
    assert r['damage'] == 2


def test_011b_one_bonus_per_die_two_dice():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 2, 'evade': 0, 'dodge': False},
        'bonusDamagePerDefenseDie': 1,
        'defenseDiceCount': 2,
    })
    assert r['hit'] is True
    assert r['damage'] == 2


def test_011c_bonus_overcomes_block():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 1, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'bonusDamagePerDefenseDie': 1,
        'defenseDiceCount': 3,
    })
    assert r['hit'] is True
    assert r['damage'] == 1


# ── ORACLE-COMBAT-012: ignoreDefenseResultsNotOnDice (unambiguous) ─────────

def test_012a_bonus_block_stripped():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'bonusBlock': 2,
        'ignoreDefenseResultsNotOnDice': True,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 1
    assert r['damage'] == 2


def test_012b_rolled_block_preserved():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 2, 'evade': 0, 'dodge': False},
        'ignoreDefenseResultsNotOnDice': True,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 2
    assert r['damage'] == 1


def test_012c_flag_plus_pierce():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 2, 'evade': 0, 'dodge': False},
        'bonusBlock': 3,
        'surgePierce': 1,
        'ignoreDefenseResultsNotOnDice': True,
    })
    assert r['hit'] is True
    assert r['effectiveBlock'] == 1
    assert r['damage'] == 2


ALL_TESTS = [
    test_001a_simple_melee_3_dmg_vs_1_block,
    test_001b_with_surge_damage_2_plus_1_surge_dmg_vs_1_block,
    test_001c_block_exceeds_damage_floors_at_0,
    test_001d_bonus_hits_included,
    test_002a_fully_blocked_with_surge_conditions_still_hit,
    test_002b_exact_block_equals_damage_floors_to_0,
    test_002c_attack_result_replace_with_stun_damage_becomes_0_stun_added,
    test_002d_attack_result_replace_with_stun_noop_when_damage_0,
    test_003a_defender_weakened_reduces_effective_block_after_pierce,
    test_003b_attacker_weakened_reduces_damage_after_block_subtraction,
    test_003c_attacker_weakened_can_reduce_damage_to_0,
    test_003d_attacker_weakened_noop_when_damage_already_0,
    test_003e_both_weakened_sequential_reduction,
    test_004a_dodge_causes_miss,
    test_004b_ranged_accuracy_miss,
    test_004c_melee_bypasses_accuracy_gate_RNG03,
    test_004d_force_miss_overrides_everything,
    test_004e_surge_cancel_dodge_deadly_spin_cancels_dodge,
    test_004f_ranged_hit_sufficient_accuracy,
    test_004g_ranged_accuracy_exactly_equals_distance_hits,
    test_005a_basic_pierce_3dmg_pierce2_vs_3block,
    test_005b_combat_suit_reduces_pierce,
    test_005c_defender_ignore_pierce,
    test_005d_surge_cancel_kuiil_removes_block_before_pierce,
    test_005e_surge_cancel_plus_pierce_combined,
    test_005f_pierce_exceeds_block_effective_block_floors_to_0,
    test_006a_ranged_miss_due_to_hidden,
    test_006b_ranged_hit_despite_hidden,
    test_006c_melee_unaffected_by_hidden,
    test_007a_cunning_converts_2_evade_into_2_block,
    test_007b_cunning_with_0_evade_no_bonus,
    test_007c_cunning_plus_pierce_pierce_reduces_total_block,
    test_008a_damage_capped,
    test_008b_damage_below_cap_no_effect,
    test_008c_attacker_weaken_applies_before_cap,
    test_009a_dodge_converted_to_evade_attack_hits,
    test_009b_no_dodge_rolled_wookiee_avenger_noop,
    test_009c_dodge_plus_wookiee_plus_cunning_chains,
    test_010a_bonus_block_increases_effective_block,
    test_010b_bonus_block_plus_pierce,
    test_010c_bonus_block_alone_fully_absorbs,
    test_011a_one_bonus_per_die_one_die_default,
    test_011b_one_bonus_per_die_two_dice,
    test_011c_bonus_overcomes_block,
    test_012a_bonus_block_stripped,
    test_012b_rolled_block_preserved,
    test_012c_flag_plus_pierce,
]


def _main():
    ok, bad = 0, 0
    for t in ALL_TESTS:
        try:
            t()
            ok += 1
            print(f'  ok  {t.__name__}')
        except AssertionError as e:
            bad += 1
            print(f'  FAIL {t.__name__}: {e}')
    print(f'\n{ok}/{ok+bad} tests pass')
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    _main()
