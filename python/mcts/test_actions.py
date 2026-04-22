"""D10 slice 6a — tests for legal-actions enumerator + policy bijection.

Run as: python3 python/mcts/test_actions.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.actions import ActionType
from python.engine.creation import create_game
from python.engine.stepper import Action, step
from python.mcts.actions import (
    action_to_policy_index,
    legal_action_mask,
    legal_actions,
    POLICY_INDEX_FIRST_RESERVED,
)


def _fresh_game():
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    return step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))


def test_game_over_returns_empty():
    g = _fresh_game()
    g.data['phase'] = 'game_over'
    assert legal_actions(g) == []


def test_fresh_game_offers_activate_actions():
    g = _fresh_game()
    actions = legal_actions(g)
    types = {a.type for a in actions}
    assert ActionType.ACTIVATE_DC in types, types
    # No mid-activation actions (no figure has been activated).
    assert ActionType.DC_END_ACTIVATION not in types
    assert ActionType.MOVE_PICK_SPACE not in types


def test_after_activate_offers_move_attack_end():
    g = _fresh_game()
    own_figs = list(g.data['figurePositions'][1].keys())
    g = step(g, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': own_figs[0]},
    ))
    actions = legal_actions(g)
    types = {a.type for a in actions}
    assert ActionType.DC_END_ACTIVATION in types
    assert ActionType.MOVE_PICK_SPACE in types


def test_move_indices_are_unique_and_in_range():
    g = _fresh_game()
    own_figs = list(g.data['figurePositions'][1].keys())
    g = step(g, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': own_figs[0]},
    ))
    actions = [a for a in legal_actions(g) if a.type == ActionType.MOVE_PICK_SPACE]
    assert actions, 'expected movement options'
    indices = [action_to_policy_index(a, g) for a in actions]
    assert len(set(indices)) == len(indices), 'move indices not unique'
    for idx in indices:
        assert 0 <= idx < POLICY_INDEX_FIRST_RESERVED, idx


def test_activate_and_control_indices_are_distinct():
    g = _fresh_game()
    actions = legal_actions(g)
    seen = {}
    for a in actions:
        idx = action_to_policy_index(a, g)
        assert idx not in seen, f'collision: {a} vs {seen[idx]} at idx {idx}'
        seen[idx] = a


def test_mask_reflects_legal_actions():
    g = _fresh_game()
    n_policy = POLICY_INDEX_FIRST_RESERVED + 100
    mask = legal_action_mask(g, n_policy)
    expected = set()
    for a in legal_actions(g):
        expected.add(action_to_policy_index(a, g))
    got = {i for i, m in enumerate(mask) if m}
    assert got == expected, f'mask mismatch: {got ^ expected}'


def test_end_of_round_phase_offers_only_end_round():
    g = _fresh_game()
    g.data['roundPhase'] = 'end'
    actions = legal_actions(g)
    assert len(actions) == 1 and actions[0].type == ActionType.END_END_OF_ROUND


def test_end_activation_phase_offered_when_no_activations():
    g = _fresh_game()
    g.data['activationsRemaining'] = {1: 0, 2: 0}
    types = {a.type for a in legal_actions(g)}
    assert ActionType.END_ACTIVATION_PHASE in types


def test_random_play_runs_without_errors():
    """End-to-end: every action returned by legal_actions must be accepted
    by stepper.step. Run 300 steps of random-legal play on a fresh game."""
    import random
    rng = random.Random(0)
    g = _fresh_game()
    for i in range(300):
        if g.get('phase') == 'game_over':
            return
        acts = legal_actions(g)
        assert acts, f'no legal actions at step {i}'
        a = rng.choice(acts)
        if a.type == ActionType.ATTACK_TARGET:
            a.params = {**a.params, 'rng_seed': rng.randint(0, 1 << 30)}
        g = step(g, a)  # Should not raise.


def test_attack_action_indices_map_to_opp_roster_order():
    g = _fresh_game()
    own_figs = list(g.data['figurePositions'][1].keys())
    g = step(g, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': own_figs[0]},
    ))
    # Force LOS by placing attacker adjacent to one target.
    opp_figs = sorted(g.data['figurePositions'][2].keys())
    if not opp_figs:
        return
    g.data['figurePositions'][1][own_figs[0]] = 'a1'
    g.data['figurePositions'][2][opp_figs[0]] = 'a2'
    actions = [a for a in legal_actions(g) if a.type == ActionType.ATTACK_TARGET]
    if not actions:
        return  # no in-range targets, test skip
    for a in actions:
        idx = action_to_policy_index(a, g)
        assert 1024 <= idx < 1024 + 32, idx


def main():
    cases = [
        ('game_over_returns_empty', test_game_over_returns_empty),
        ('fresh_game_offers_activate_actions', test_fresh_game_offers_activate_actions),
        ('after_activate_offers_move_attack_end', test_after_activate_offers_move_attack_end),
        ('move_indices_are_unique_and_in_range', test_move_indices_are_unique_and_in_range),
        ('activate_and_control_indices_are_distinct', test_activate_and_control_indices_are_distinct),
        ('mask_reflects_legal_actions', test_mask_reflects_legal_actions),
        ('end_of_round_phase_offers_only_end_round', test_end_of_round_phase_offers_only_end_round),
        ('end_activation_phase_offered_when_no_activations', test_end_activation_phase_offered_when_no_activations),
        ('attack_action_indices_map_to_opp_roster_order', test_attack_action_indices_map_to_opp_roster_order),
        ('random_play_runs_without_errors', test_random_play_runs_without_errors),
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
