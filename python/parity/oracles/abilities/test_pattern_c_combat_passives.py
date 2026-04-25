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
    }
    assert expected.issubset(set(ids))


def test_unknown_passive_id_is_silently_ignored():
    data = _base_data()
    combat = {}
    fired = apply_combat_passives(
        data, combat, ['no_such_ability_id'], [], _ctx(),
    )
    assert combat == {}
    assert not fired
