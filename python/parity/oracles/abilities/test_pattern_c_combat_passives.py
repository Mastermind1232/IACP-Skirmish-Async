"""Pattern C combat-passive oracle.

Verifies the starter set in `python/engine/mechanics/passive_combat.py` fires
the right `combat[bonus*]` deltas under the right gates, and is a no-op
otherwise.

Run as: python3 -m pytest python/parity/oracles/abilities/test_pattern_c_combat_passives.py
"""
import pytest

from python.engine.mechanics.passive_combat import (
    apply_combat_passives,
    registered_ids,
    _figure_has_moved_this_activation,
    _group_caused_damage_to_target,
)


def _base_data():
    return {
        'gameId': 'test',
        'figurePositions': {
            1: {'Rebel Trooper (Regular)-0-0': 'a3'},
            2: {'Stormtrooper (Regular)-0-0': 'h8'},
        },
        'activationStartPositions': {
            1: {'Rebel Trooper (Regular)-0-0': 'a1'},  # moved a1 -> a3
        },
        'activeFigureKeys': ['Rebel Trooper (Regular)-0-0'],
    }


def _ctx(atk_key='Rebel Trooper (Regular)-0-0',
         def_key='Stormtrooper (Regular)-0-0',
         atk_player=1, def_player=2):
    return {
        'attacker_key': atk_key,
        'defender_key': def_key,
        'attacker_player': atk_player,
        'defender_player': def_player,
        'distance': 5,
        'is_ranged': True,
    }


# ── aim_rebel_trooper_reg ──────────────────────────────────────────────────

def test_aim_reg_fires_when_attacker_did_not_move():
    data = _base_data()
    # Reset start position so it equals current position (no move).
    data['activationStartPositions'][1]['Rebel Trooper (Regular)-0-0'] = 'a3'
    combat = {}
    fired = apply_combat_passives(
        data, combat, ['aim_rebel_trooper_reg'], [], _ctx(),
    )
    assert combat['bonusHits'] == 1
    assert combat['bonusAccuracy'] == 2
    assert any(f['effect'] == 'aim_rebel_trooper_reg' for f in fired)


def test_aim_reg_no_fire_when_attacker_moved():
    data = _base_data()  # default: a1 -> a3
    combat = {}
    fired = apply_combat_passives(
        data, combat, ['aim_rebel_trooper_reg'], [], _ctx(),
    )
    assert 'bonusHits' not in combat
    assert 'bonusAccuracy' not in combat
    assert not fired


# ── aim_rebel_trooper_elite ────────────────────────────────────────────────

def test_aim_elite_fires_when_target_already_damaged_by_group():
    data = _base_data()
    data['damageDealtThisActivation'] = {
        'Rebel Trooper (Regular)-0-0': {'Stormtrooper (Regular)-0-0': 2},
    }
    combat = {}
    fired = apply_combat_passives(
        data, combat, ['aim_rebel_trooper_elite'], [], _ctx(),
    )
    assert combat['bonusHits'] == 1
    assert combat['bonusAccuracy'] == 2
    assert any(f['effect'] == 'aim_rebel_trooper_elite' for f in fired)


def test_aim_elite_no_fire_when_target_undamaged():
    data = _base_data()  # no damageDealtThisActivation
    combat = {}
    fired = apply_combat_passives(
        data, combat, ['aim_rebel_trooper_elite'], [], _ctx(),
    )
    assert 'bonusHits' not in combat
    assert not fired


# ── take_cover_jawa_* ──────────────────────────────────────────────────────

def test_take_cover_elite_fires_for_defender():
    data = _base_data()
    combat = {'bonusBlock': 0, 'bonusEvade': 0}
    fired = apply_combat_passives(
        data, combat, [], ['take_cover_jawa_elite'], _ctx(),
    )
    assert combat['bonusBlock'] == 1
    assert combat['bonusEvade'] == -1
    assert any(f['effect'] == 'take_cover' for f in fired)


def test_take_cover_reg_does_not_fire_when_in_attacker_role():
    """Registered as defender-only — putting it on the attacker side is a no-op."""
    data = _base_data()
    combat = {}
    fired = apply_combat_passives(
        data, combat, ['take_cover_jawa_reg'], [], _ctx(),
    )
    assert combat == {}
    assert not fired


# ── Helpers ────────────────────────────────────────────────────────────────

def test_figure_has_moved_helper():
    data = _base_data()
    # Default fixture: a1 -> a3 (moved).
    assert _figure_has_moved_this_activation(
        data, 1, 'Rebel Trooper (Regular)-0-0') is True
    # Reset start to current.
    data['activationStartPositions'][1]['Rebel Trooper (Regular)-0-0'] = 'a3'
    assert _figure_has_moved_this_activation(
        data, 1, 'Rebel Trooper (Regular)-0-0') is False


def test_group_caused_damage_helper():
    data = _base_data()
    assert _group_caused_damage_to_target(
        data, 1, 'Rebel Trooper (Regular)-0-0',
        'Stormtrooper (Regular)-0-0') is False
    data['damageDealtThisActivation'] = {
        'Rebel Trooper (Regular)-0-0': {'Stormtrooper (Regular)-0-0': 1},
    }
    assert _group_caused_damage_to_target(
        data, 1, 'Rebel Trooper (Regular)-0-0',
        'Stormtrooper (Regular)-0-0') is True


def test_registry_includes_starter_set():
    ids = registered_ids()
    expected = {
        'aim_rebel_trooper_reg', 'aim_rebel_trooper_elite',
        'take_cover_jawa_elite', 'take_cover_jawa_reg',
        'adv_targeting_computer_dark_trooper',
        'dead_precise_kotun', 'improvised_cover_verena',
        'lucky_r2d2',
        'agile_jet_trooper_elite', 'agile_jet_trooper_reg',
        'squad_training_stormtrooper_elite', 'squad_training_stormtrooper_reg',
        'squad_training_shoretrooper_elite', 'squad_training_shoretrooper_reg',
    }
    assert expected.issubset(set(ids))


# ── adv_targeting_computer_dark_trooper ────────────────────────────────────

def test_adv_targeting_computer_grants_focus_and_green_die():
    data = _base_data()
    combat = {'attackInfo': {'dice': ['blue', 'red']}}
    fired = apply_combat_passives(
        data, combat, ['adv_targeting_computer_dark_trooper'], [], _ctx(),
    )
    # Focus condition applied to attacker.
    cond = (data.get('figureConditions') or {}).get(
        'Rebel Trooper (Regular)-0-0') or []
    assert 'Focus' in cond
    # Green die appended to attack pool.
    assert 'green' in (combat.get('attackInfo') or {}).get('dice', [])
    assert any(f['effect'] == 'adv_targeting_computer' for f in fired)


# ── dead_precise_kotun ─────────────────────────────────────────────────────

def test_dead_precise_fires_when_attacker_did_not_move():
    data = _base_data()
    data['activationStartPositions'][1]['Rebel Trooper (Regular)-0-0'] = 'a3'
    combat = {}
    fired = apply_combat_passives(
        data, combat, ['dead_precise_kotun'], [], _ctx(),
    )
    assert combat.get('bonusAccuracy') == 2
    assert 'bonusHits' not in combat  # accuracy-only, no hits
    assert any(f['effect'] == 'dead_precise_kotun' for f in fired)


def test_dead_precise_no_fire_when_moved():
    data = _base_data()  # default: moved
    combat = {}
    fired = apply_combat_passives(
        data, combat, ['dead_precise_kotun'], [], _ctx(),
    )
    assert 'bonusAccuracy' not in combat
    assert not fired


# ── improvised_cover_verena ────────────────────────────────────────────────

def test_improvised_cover_fires_when_defender_adjacent_to_non_attacker_hostile():
    data = _base_data()
    # Move defender to h7 with a non-attacker hostile (Stormtrooper at h8 is
    # the attacker; add a third unit, "K-2S0", on player 1, adjacent to h8).
    data['figurePositions'][1]['K-2S0-0-0'] = 'h7'
    data['figurePositions'][2]['Stormtrooper (Regular)-0-0'] = 'h8'
    # Attacker is K-2S0 on player 1; defender Stormtrooper on player 2.
    # Defender at h8 is adjacent to K-2S0 (h7) — but K-2S0 IS the attacker,
    # so improvised_cover should NOT fire from the attacker's adjacency.
    ctx = _ctx(atk_key='K-2S0-0-0', def_key='Stormtrooper (Regular)-0-0',
               atk_player=1, def_player=2)
    combat = {}
    fired = apply_combat_passives(
        data, combat, [], ['improvised_cover_verena'], ctx,
    )
    assert 'bonusBlock' not in combat
    # Now add a SECOND p1 figure adjacent to defender (h7 → h8 adj).
    data['figurePositions'][1]['Rebel Trooper (Regular)-0-0'] = 'g8'
    fired = apply_combat_passives(
        data, combat, [], ['improvised_cover_verena'], ctx,
    )
    assert combat.get('bonusBlock') == 1
    assert any(f['effect'] == 'improvised_cover_verena' for f in fired)


def test_improvised_cover_no_fire_when_no_adjacent_non_friendly():
    data = _base_data()
    # Stormtrooper at h8, Rebel at a3 — defender has no nearby non-friendly.
    combat = {}
    fired = apply_combat_passives(
        data, combat, [],  ['improvised_cover_verena'],
        _ctx(atk_key='Rebel Trooper (Regular)-0-0',
             def_key='Stormtrooper (Regular)-0-0'),
    )
    assert 'bonusBlock' not in combat


def test_adv_targeting_computer_idempotent_when_already_focused():
    data = _base_data()
    data['figureConditions'] = {'Rebel Trooper (Regular)-0-0': ['Focus']}
    combat = {'attackInfo': {'dice': ['blue', 'red']}}
    fired = apply_combat_passives(
        data, combat, ['adv_targeting_computer_dark_trooper'], [], _ctx(),
    )
    # Already focused: don't double-stack the green die.
    assert (combat.get('attackInfo') or {}).get('dice') == ['blue', 'red']
    assert not fired


# ── agile_jet_trooper (post-roll) ──────────────────────────────────────────

def test_agile_jet_trooper_converts_block_to_evade():
    from python.engine.mechanics.passive_combat import apply_post_roll_passives
    data = _base_data()
    combat = {'defenseRoll': {'block': 2, 'evade': 1, 'dodge': False}}
    fired = apply_post_roll_passives(
        data, combat, [], ['agile_jet_trooper_elite'], _ctx(),
    )
    assert combat['defenseRoll']['block'] == 1
    assert combat['defenseRoll']['evade'] == 2
    assert any(f['effect'] == 'agile_jet_trooper' for f in fired)


def test_agile_jet_trooper_no_fire_with_zero_blocks():
    from python.engine.mechanics.passive_combat import apply_post_roll_passives
    data = _base_data()
    combat = {'defenseRoll': {'block': 0, 'evade': 1, 'dodge': False}}
    fired = apply_post_roll_passives(
        data, combat, [], ['agile_jet_trooper_reg'], _ctx(),
    )
    assert combat['defenseRoll']['block'] == 0
    assert combat['defenseRoll']['evade'] == 1
    assert not fired


# ── squad_training (post-roll) ─────────────────────────────────────────────

def test_squad_training_no_fire_without_adjacent_trooper():
    from python.engine.mechanics.passive_combat import apply_post_roll_passives
    import random
    data = _base_data()
    # No adjacent friendly TROOPER.
    combat = {'attackRoll': {'dice': [{'color': 'blue', 'acc': 0, 'dmg': 0, 'surge': 0}],
                              'acc': 0, 'dmg': 0, 'surge': 0}}
    ctx = _ctx()
    ctx['rng'] = random.Random(42)
    fired = apply_post_roll_passives(
        data, combat, ['squad_training_stormtrooper_elite'], [], ctx,
    )
    assert not fired


def test_squad_training_fires_with_adjacent_trooper():
    from python.engine.mechanics.passive_combat import apply_post_roll_passives
    import random
    data = _base_data()
    # Add an adjacent friendly TROOPER (Stormtrooper Reg keyword TROOPER).
    # Attacker on a3, put a Stormtrooper at a4 (adjacent).
    data['figurePositions'][1] = {
        'Rebel Trooper (Regular)-0-0': 'a3',
        'Stormtrooper (Regular)-0-1': 'a4',
    }
    # Set up an attack roll with a known-worst die at index 0.
    combat = {'attackRoll': {
        'dice': [
            {'color': 'blue', 'acc': 0, 'dmg': 0, 'surge': 0},
            {'color': 'red', 'acc': 1, 'dmg': 2, 'surge': 1},
        ],
        'acc': 1, 'dmg': 2, 'surge': 1,
    }, 'surgeBonus': 0}
    ctx = _ctx()
    ctx['rng'] = random.Random(42)
    fired = apply_post_roll_passives(
        data, combat, ['squad_training_stormtrooper_elite'], [], ctx,
    )
    assert any(f['effect'] == 'squad_training' for f in fired)
    # The die at index 0 (worst) was rerolled — totals recomputed.
    assert combat['attackRoll']['dice'][0] != {'color': 'blue',
                                                'acc': 0, 'dmg': 0, 'surge': 0}


# ── lucky_r2d2 (post-roll) ─────────────────────────────────────────────────

def test_lucky_r2d2_recovers_2_hp_on_dodge():
    from python.engine.mechanics.passive_combat import apply_post_roll_passives
    data = _base_data()
    data['dcHealthState'] = {'msg_def': [[5, 10]]}  # currentHP=5, max=10
    combat = {'defenseRoll': {'dodge': True}}
    ctx = _ctx()
    ctx['defender_msg_id'] = 'msg_def'
    ctx['defender_figure_index'] = 0
    fired = apply_post_roll_passives(
        data, combat, [], ['lucky_r2d2'], ctx,
    )
    assert any(f['effect'] == 'lucky_r2d2' for f in fired)
    # HP recovered up to 7 (5 + 2).
    assert data['dcHealthState']['msg_def'][0][0] == 7


def test_lucky_r2d2_no_fire_without_dodge():
    from python.engine.mechanics.passive_combat import apply_post_roll_passives
    data = _base_data()
    data['dcHealthState'] = {'msg_def': [[5, 10]]}
    combat = {'defenseRoll': {'dodge': False}}
    ctx = _ctx()
    ctx['defender_msg_id'] = 'msg_def'
    ctx['defender_figure_index'] = 0
    fired = apply_post_roll_passives(
        data, combat, [], ['lucky_r2d2'], ctx,
    )
    assert not fired
    assert data['dcHealthState']['msg_def'][0][0] == 5


def test_unknown_passive_id_is_silently_ignored():
    data = _base_data()
    combat = {}
    fired = apply_combat_passives(
        data, combat, ['no_such_ability_id'], [], _ctx(),
    )
    assert combat == {}
    assert not fired
