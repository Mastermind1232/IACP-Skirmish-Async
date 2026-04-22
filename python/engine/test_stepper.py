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
        step(g, Action(type=ActionType.ATTACK_TARGET, player=1))
    except NotImplementedError as e:
        assert 'attack_target' in str(e)
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
    assert not is_implemented(ActionType.ATTACK_TARGET)
    impl = implemented_action_types()
    assert ActionType.PASS_ACTIVATION_TURN in impl
    assert ActionType.END_ACTIVATION_PHASE in impl


def main():
    cases = [
        ('unknown_action_raises', test_unknown_action_raises),
        ('step_does_not_mutate_input', test_step_does_not_mutate_input),
        ('pass_activation_turn_swaps_active_player', test_pass_activation_turn_swaps_active_player),
        ('end_activation_phase_requires_zero_activations', test_end_activation_phase_requires_zero_activations),
        ('end_activation_phase_transitions_to_end', test_end_activation_phase_transitions_to_end),
        ('end_activation_phase_accepts_missing_activations', test_end_activation_phase_accepts_missing_activations),
        ('is_implemented_reports_correctly', test_is_implemented_reports_correctly),
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
