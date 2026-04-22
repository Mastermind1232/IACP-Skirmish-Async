"""D10 — tests for the headless action-application stepper.

Run as: python3 python/engine/test_stepper.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.actions import ActionType
from python.engine.creation import create_game
from python.engine.state import GameState
from python.engine.stepper import (
    Action,
    implemented_action_types,
    is_implemented,
    step,
)


def test_unknown_action_raises():
    g = create_game()
    try:
        step(g, Action(type=ActionType.CC_DRAW, player=1))
    except NotImplementedError as e:
        assert 'cc_draw' in str(e)
        return
    raise AssertionError('expected NotImplementedError')


def test_step_does_not_mutate_input():
    g = create_game()
    g.data['activePlayer'] = 1
    orig_json = g.to_json()
    step(g, Action(type=ActionType.PASS_ACTIVATION_TURN, player=1))
    assert g.to_json() == orig_json, 'step() mutated input'


def test_pass_activation_turn_swaps_active_player():
    g = create_game()
    g.data['activePlayer'] = 1
    new_g = step(g, Action(type=ActionType.PASS_ACTIVATION_TURN, player=1))
    assert new_g.data['activePlayer'] == 2
    next_g = step(new_g, Action(type=ActionType.PASS_ACTIVATION_TURN, player=2))
    assert next_g.data['activePlayer'] == 1


def test_end_activation_phase_requires_zero_activations():
    g = create_game()
    g.data['activationsRemaining'] = {1: 2, 2: 0}
    try:
        step(g, Action(type=ActionType.END_ACTIVATION_PHASE, player=1))
    except ValueError as e:
        assert 'activations remaining' in str(e)
        return
    raise AssertionError('expected ValueError when activations remain')


def test_end_activation_phase_transitions_to_end():
    g = create_game()
    g.data['activationsRemaining'] = {1: 0, 2: 0}
    g.data['roundPhase'] = 'activation'
    new_g = step(g, Action(type=ActionType.END_ACTIVATION_PHASE, player=1))
    assert new_g.data['roundPhase'] == 'end'
    assert new_g.data['p1ActivationPhaseEnded'] is False
    assert new_g.data['p2ActivationPhaseEnded'] is False


def test_end_activation_phase_accepts_missing_activations():
    """Missing activationsRemaining should be treated as zero."""
    g = create_game()
    g.data.pop('activationsRemaining', None)
    g.data['roundPhase'] = 'activation'
    new_g = step(g, Action(type=ActionType.END_ACTIVATION_PHASE, player=1))
    assert new_g.data['roundPhase'] == 'end'


def test_is_implemented_reports_correctly():
    assert is_implemented(ActionType.PASS_ACTIVATION_TURN)
    assert is_implemented(ActionType.END_ACTIVATION_PHASE)
    assert is_implemented(ActionType.ACTIVATE_DC)
    assert is_implemented(ActionType.MOVE_PICK_SPACE)
    assert is_implemented(ActionType.DC_END_ACTIVATION)
    assert is_implemented(ActionType.ATTACK_TARGET)
    assert not is_implemented(ActionType.CC_DRAW)


def _two_figure_game():
    g = create_game(map_id='mos-eisley-outskirts')
    g.data['mapId'] = 'mos-eisley-outskirts'
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {'Stormtrooper (Regular)-0-0': 'h8'},
    }
    g.data['activationsRemaining'] = {1: 1, 2: 1}
    g.data['activePlayer'] = 1
    return g


def test_activate_dc_sets_movement_points_from_speed():
    g = _two_figure_game()
    action = Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
    )
    new_g = step(g, action)
    # Rebel Trooper (Regular) speed = 4.
    assert new_g.data['movementPoints'] == 4
    assert new_g.data['activeFigureKeys'] == ['Rebel Trooper (Regular)-0-0']
    assert new_g.data['activationsRemaining'][1] == 0
    # Start position recorded.
    starts = new_g.data['activationStartPositions']
    assert starts[1]['Rebel Trooper (Regular)-0-0'] == 'a1'


def test_activate_dc_rejects_no_activations():
    g = _two_figure_game()
    g.data['activationsRemaining'] = {1: 0, 2: 1}
    try:
        step(g, Action(
            type=ActionType.ACTIVATE_DC, player=1,
            params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
        ))
    except ValueError as e:
        assert 'no activations remaining' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_activate_dc_rejects_wrong_owner():
    g = _two_figure_game()
    try:
        step(g, Action(
            type=ActionType.ACTIVATE_DC, player=2,
            params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
        ))
    except ValueError as e:
        assert 'does not own' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_move_pick_space_updates_position_and_charges_mp():
    g = _two_figure_game()
    g = step(g, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
    ))
    assert g.data['movementPoints'] == 4
    g = step(g, Action(
        type=ActionType.MOVE_PICK_SPACE, player=1,
        params={'coord': 'a3'},
    ))
    assert g.data['figurePositions'][1]['Rebel Trooper (Regular)-0-0'] == 'a3'
    # 2 orthogonal steps -> 2 MP charged.
    assert g.data['movementPoints'] == 2
    assert 'Rebel Trooper (Regular)-0-0' in g.data['figuresMovedThisRound']


def test_move_pick_space_rejects_insufficient_mp():
    g = _two_figure_game()
    g = step(g, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
    ))
    # Manually clamp MP to 1 to force rejection on a 2-step move.
    g.data['movementPoints'] = 1
    try:
        step(g, Action(
            type=ActionType.MOVE_PICK_SPACE, player=1,
            params={'coord': 'a3'},
        ))
    except ValueError as e:
        assert 'insufficient MP' in str(e)
        return
    raise AssertionError('expected ValueError')


def _attack_ready_game():
    g = _two_figure_game()
    # a1/a2 known LOS-clear on mos-eisley-outskirts.
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {'Stormtrooper (Regular)-0-0': 'a2'},
    }
    g.data['activePlayer'] = 1
    g.data['activeFigureKeys'] = ['Rebel Trooper (Regular)-0-0']
    return g


def test_attack_target_requires_different_owner():
    g = _attack_ready_game()
    g.data['figurePositions'][2]['Rebel Trooper (Regular)-0-1'] = 'h9'
    try:
        step(g, Action(
            type=ActionType.ATTACK_TARGET, player=1,
            params={
                'attacker_key': 'Rebel Trooper (Regular)-0-0',
                'target_key': 'Rebel Trooper (Regular)-0-1',
                'rng_seed': 1,
            },
        ))
    except ValueError as e:
        # Under test fixture the "friendly" with same DC is on p2 — so this
        # test actually validates the missing-figure path. Rewrite: attack
        # a key that doesn't exist.
        pass
    # Attack own figure via forced construction:
    g2 = _attack_ready_game()
    g2.data['figurePositions'][1]['Rebel Trooper (Regular)-0-1'] = 'h9'
    try:
        step(g2, Action(
            type=ActionType.ATTACK_TARGET, player=1,
            params={
                'attacker_key': 'Rebel Trooper (Regular)-0-0',
                'target_key': 'Rebel Trooper (Regular)-0-1',
                'rng_seed': 1,
            },
        ))
    except ValueError as e:
        assert 'own figure' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_attack_target_is_deterministic_with_seed():
    g = _attack_ready_game()
    a = step(g, Action(
        type=ActionType.ATTACK_TARGET, player=1,
        params={
            'attacker_key': 'Rebel Trooper (Regular)-0-0',
            'target_key': 'Stormtrooper (Regular)-0-0',
            'rng_seed': 42,
        },
    ))
    b = step(g, Action(
        type=ActionType.ATTACK_TARGET, player=1,
        params={
            'attacker_key': 'Rebel Trooper (Regular)-0-0',
            'target_key': 'Stormtrooper (Regular)-0-0',
            'rng_seed': 42,
        },
    ))
    assert a.data.get('dcHealthState') == b.data.get('dcHealthState'), 'seeded attack not deterministic'


def test_attack_target_rejects_second_attack_same_activation():
    g = _attack_ready_game()
    # Pump target HP so the first attack can't possibly kill, keeping the
    # figure on the board for the second-attack check.
    g.data['dcHealthState'] = {'2:Stormtrooper (Regular)': [[50, 50]]}
    g = step(g, Action(
        type=ActionType.ATTACK_TARGET, player=1,
        params={
            'attacker_key': 'Rebel Trooper (Regular)-0-0',
            'target_key': 'Stormtrooper (Regular)-0-0',
            'rng_seed': 1,
        },
    ))
    try:
        step(g, Action(
            type=ActionType.ATTACK_TARGET, player=1,
            params={
                'attacker_key': 'Rebel Trooper (Regular)-0-0',
                'target_key': 'Stormtrooper (Regular)-0-0',
                'rng_seed': 2,
            },
        ))
    except ValueError as e:
        assert 'already attacked' in str(e)
        return
    raise AssertionError('expected ValueError on double attack')


def test_attack_target_kills_and_awards_vp():
    """Walk seeds until one produces a lethal attack, then validate VP + removal."""
    base = _attack_ready_game()
    # Stormtrooper has 3 HP; crank target HP to 1 so any damage kills.
    # dcHealthState = {'2:Stormtrooper (Regular)': [[1, 3]]}
    base.data['dcHealthState'] = {'2:Stormtrooper (Regular)': [[1, 3]]}
    # Try seeds until we land a hit with >=1 damage.
    for seed in range(500):
        g = base.copy()
        try:
            new_g = step(g, Action(
                type=ActionType.ATTACK_TARGET, player=1,
                params={
                    'attacker_key': 'Rebel Trooper (Regular)-0-0',
                    'target_key': 'Stormtrooper (Regular)-0-0',
                    'rng_seed': seed,
                },
            ))
        except Exception:
            continue
        # Check defeat
        fp = new_g.data.get('figurePositions') or {}
        if 'Stormtrooper (Regular)-0-0' not in (fp.get(2) or {}):
            vp = (new_g.data.get('player1VP') or {}).get('kills', 0)
            assert vp >= 1, f'no VP after kill seed={seed}'
            return
    raise AssertionError('no kill in 500 seeds — dice distribution broken')


def test_end_end_of_round_refreshes_activations():
    g = _two_figure_game()
    g.data['round'] = 1
    g.data['activationsRemaining'] = {1: 0, 2: 0}
    g.data['figuresMovedThisRound'] = ['Rebel Trooper (Regular)-0-0']
    g.data['figureAttacksThisActivation'] = {1: {'Rebel Trooper (Regular)-0-0': 1}}
    new_g = step(g, Action(type=ActionType.END_END_OF_ROUND, player=0))
    assert new_g.data['round'] == 2
    assert new_g.data['roundPhase'] == 'activation'
    assert new_g.data['activationsRemaining'] == {1: 1, 2: 1}
    assert new_g.data['figuresMovedThisRound'] == []
    assert new_g.data['figureAttacksThisActivation'] == {}


def test_end_end_of_round_detects_game_over():
    g = _two_figure_game()
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {},
    }
    new_g = step(g, Action(type=ActionType.END_END_OF_ROUND, player=0))
    assert new_g.data['phase'] == 'game_over'
    assert new_g.data['activationsRemaining'][2] == 0


def test_end_end_of_round_counts_multi_figure_group_as_one():
    g = _two_figure_game()
    g.data['figurePositions'] = {
        1: {
            'Rebel Trooper (Regular)-0-0': 'a1',
            'Rebel Trooper (Regular)-0-1': 'a2',
            'Rebel Trooper (Regular)-0-2': 'a3',
        },
        2: {'Stormtrooper (Regular)-0-0': 'h8'},
    }
    new_g = step(g, Action(type=ActionType.END_END_OF_ROUND, player=0))
    assert new_g.data['activationsRemaining'] == {1: 1, 2: 1}


def test_dc_end_activation_clears_active_and_swaps_player():
    g = _two_figure_game()
    g = step(g, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
    ))
    g = step(g, Action(type=ActionType.DC_END_ACTIVATION, player=1))
    assert g.data['activeFigureKeys'] == []
    assert g.data['movementPoints'] == 0
    assert g.data['activePlayer'] == 2


def main():
    cases = [
        ('unknown_action_raises', test_unknown_action_raises),
        ('step_does_not_mutate_input', test_step_does_not_mutate_input),
        ('pass_activation_turn_swaps_active_player', test_pass_activation_turn_swaps_active_player),
        ('end_activation_phase_requires_zero_activations', test_end_activation_phase_requires_zero_activations),
        ('end_activation_phase_transitions_to_end', test_end_activation_phase_transitions_to_end),
        ('end_activation_phase_accepts_missing_activations', test_end_activation_phase_accepts_missing_activations),
        ('is_implemented_reports_correctly', test_is_implemented_reports_correctly),
        ('activate_dc_sets_movement_points_from_speed', test_activate_dc_sets_movement_points_from_speed),
        ('activate_dc_rejects_no_activations', test_activate_dc_rejects_no_activations),
        ('activate_dc_rejects_wrong_owner', test_activate_dc_rejects_wrong_owner),
        ('move_pick_space_updates_position_and_charges_mp', test_move_pick_space_updates_position_and_charges_mp),
        ('move_pick_space_rejects_insufficient_mp', test_move_pick_space_rejects_insufficient_mp),
        ('dc_end_activation_clears_active_and_swaps_player', test_dc_end_activation_clears_active_and_swaps_player),
        ('attack_target_requires_different_owner', test_attack_target_requires_different_owner),
        ('attack_target_is_deterministic_with_seed', test_attack_target_is_deterministic_with_seed),
        ('attack_target_rejects_second_attack_same_activation', test_attack_target_rejects_second_attack_same_activation),
        ('attack_target_kills_and_awards_vp', test_attack_target_kills_and_awards_vp),
        ('end_end_of_round_refreshes_activations', test_end_end_of_round_refreshes_activations),
        ('end_end_of_round_detects_game_over', test_end_end_of_round_detects_game_over),
        ('end_end_of_round_counts_multi_figure_group_as_one', test_end_end_of_round_counts_multi_figure_group_as_one),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            print(f'FAIL: {name}: {e}')
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
