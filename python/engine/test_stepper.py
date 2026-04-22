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


def test_auto_deploy_places_figures_and_starts_round():
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    new_g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
    # 3 figures per group (Regular has figures=3).
    p1 = new_g.data['figurePositions'][1]
    p2 = new_g.data['figurePositions'][2]
    assert len(p1) == 3, p1
    assert len(p2) == 3, p2
    # All cells distinct.
    all_cells = list(p1.values()) + list(p2.values())
    assert len(set(all_cells)) == len(all_cells)
    assert new_g.data['round'] == 1
    assert new_g.data['phase'] == 'round_active'
    assert new_g.data['roundPhase'] == 'activation'
    # One deployment group each -> 1 activation each.
    assert new_g.data['activationsRemaining'] == {1: 1, 2: 1}


def test_auto_deploy_separates_sides_by_row():
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    new_g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
    p1_rows = [int(c[1:]) for c in new_g.data['figurePositions'][1].values()]
    p2_rows = [int(c[1:]) for c in new_g.data['figurePositions'][2].values()]
    # p1 on low rows, p2 on high rows.
    assert max(p1_rows) < min(p2_rows), f'p1 rows {p1_rows} vs p2 rows {p2_rows}'


def test_auto_deploy_skips_bracketed_upgrades():
    """[Heroic Effort]-style attachments must not get a board slot."""
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)', '[Heroic Effort]']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    new_g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
    p1 = new_g.data['figurePositions'][1]
    # Only the Rebel Trooper (3 figures); no bracketed key.
    assert all('Rebel Trooper' in k for k in p1)
    assert len(p1) == 3


def test_auto_deploy_multiple_dcs_distinct_groups():
    """Same DC twice in deploymentCards => group indices 0 and 1."""
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 40,
                  'deploymentCards': ['Rebel Trooper (Regular)', 'Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    new_g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
    p1_keys = list(new_g.data['figurePositions'][1].keys())
    # 2 groups * 3 figs = 6 keys.
    assert len(p1_keys) == 6
    groups = {k.rsplit('-', 2)[1] for k in p1_keys}
    assert groups == {'0', '1'}, groups
    # 2 activations for p1.
    assert new_g.data['activationsRemaining'][1] == 2


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


def test_phase_gate_ready_marks_player_ready():
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    # Install a gate
    from python.engine.mechanics.phase_gate import create_phase_gate
    create_phase_gate(g, 'deploy_done')

    g2 = step(g, Action(type=ActionType.PHASE_GATE_READY, player=1))
    assert g2.data['phaseGate']['p1Ready'] is True
    assert g2.data['phaseGate']['p2Ready'] is False

    g3 = step(g2, Action(type=ActionType.PHASE_GATE_READY, player=2))
    assert g3.data['phaseGate']['p1Ready'] is True
    assert g3.data['phaseGate']['p2Ready'] is True


def test_phase_gate_unready_flips_back():
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    from python.engine.mechanics.phase_gate import create_phase_gate, record_phase_gate_ready
    create_phase_gate(g, 'deploy_done')
    record_phase_gate_ready(g, 'alice')
    assert g.data['phaseGate']['p1Ready'] is True

    g2 = step(g, Action(type=ActionType.PHASE_GATE_UNREADY, player=1))
    assert g2.data['phaseGate']['p1Ready'] is False


def test_phase_gate_ready_no_gate_is_noop():
    g = create_game()
    g.data['player1Id'] = 'alice'
    # No phaseGate installed — record_ready returns no-op shape; state unchanged
    g2 = step(g, Action(type=ActionType.PHASE_GATE_READY, player=1))
    assert g2.data.get('phaseGate') is None


def test_interact_open_door_dispatch():
    from python.engine.data import map_spaces_loader, map_tokens_loader, dc_effects_loader
    dc_effects_loader._dc_effects = {'Luke': {'figures': 1, 'speed': 4}}
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': {'a1': ['a2'], 'a2': ['a1']},
        'spaces': ['a1', 'a2'],
        'blocking': [], 'impassableEdges': [], 'movementBlockingEdges': [],
    }}
    map_tokens_loader._cache = {'utest': {
        'terminals': [], 'doors': [['a1', 'a2']],
    }}
    try:
        g = create_game()
        g.data['mapId'] = 'utest'
        g.data['selectedMap'] = {'id': 'utest'}
        g.data['figurePositions'] = {1: {'Luke-0-0': 'a1'}, 2: {}}
        new_g = step(g, Action(
            type=ActionType.INTERACT, player=1,
            params={'figure_key': 'Luke-0-0', 'option_id': 'open_door_a1|a2'},
        ))
        assert new_g.data['openedDoors'] == ['a1|a2']
    finally:
        dc_effects_loader.reset_cache()
        map_spaces_loader.reset_cache()
        map_tokens_loader.reset_cache()


def test_interact_rejects_illegal_option():
    from python.engine.data import map_spaces_loader, map_tokens_loader, dc_effects_loader
    dc_effects_loader._dc_effects = {'Luke': {'figures': 1}}
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': {'a1': ['a2']},
        'spaces': ['a1', 'a2'],
        'blocking': [], 'impassableEdges': [],
    }}
    map_tokens_loader._cache = {'utest': {'terminals': [], 'doors': []}}
    try:
        g = create_game()
        g.data['mapId'] = 'utest'
        g.data['selectedMap'] = {'id': 'utest'}
        g.data['figurePositions'] = {1: {'Luke-0-0': 'a1'}, 2: {}}
        try:
            step(g, Action(
                type=ActionType.INTERACT, player=1,
                params={'figure_key': 'Luke-0-0', 'option_id': 'open_door_z9|z10'},
            ))
        except ValueError as e:
            assert 'not legal' in str(e)
            return
        raise AssertionError('expected ValueError for illegal interact option')
    finally:
        dc_effects_loader.reset_cache()
        map_spaces_loader.reset_cache()
        map_tokens_loader.reset_cache()


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
        ('phase_gate_ready_marks_player_ready', test_phase_gate_ready_marks_player_ready),
        ('phase_gate_unready_flips_back', test_phase_gate_unready_flips_back),
        ('phase_gate_ready_no_gate_is_noop', test_phase_gate_ready_no_gate_is_noop),
        ('interact_open_door_dispatch', test_interact_open_door_dispatch),
        ('interact_rejects_illegal_option', test_interact_rejects_illegal_option),
        ('attack_target_requires_different_owner', test_attack_target_requires_different_owner),
        ('attack_target_is_deterministic_with_seed', test_attack_target_is_deterministic_with_seed),
        ('attack_target_rejects_second_attack_same_activation', test_attack_target_rejects_second_attack_same_activation),
        ('attack_target_kills_and_awards_vp', test_attack_target_kills_and_awards_vp),
        ('end_end_of_round_refreshes_activations', test_end_end_of_round_refreshes_activations),
        ('end_end_of_round_detects_game_over', test_end_end_of_round_detects_game_over),
        ('end_end_of_round_counts_multi_figure_group_as_one', test_end_end_of_round_counts_multi_figure_group_as_one),
        ('auto_deploy_places_figures_and_starts_round', test_auto_deploy_places_figures_and_starts_round),
        ('auto_deploy_separates_sides_by_row', test_auto_deploy_separates_sides_by_row),
        ('auto_deploy_skips_bracketed_upgrades', test_auto_deploy_skips_bracketed_upgrades),
        ('auto_deploy_multiple_dcs_distinct_groups', test_auto_deploy_multiple_dcs_distinct_groups),
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
