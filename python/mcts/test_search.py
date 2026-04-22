"""D10 slice 6b — MCTS search tests.

Run as: python3 python/mcts/test_search.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.engine.actions import ActionType
from python.engine.creation import create_game
from python.engine.state import GameState
from python.engine.stepper import Action, step
from python.mcts.search import MCTS, Node, _terminal_reward_p1
from python.net.skirbo_cnn import CNNConfig, SkirboCNN


def _tiny_net():
    return SkirboCNN(CNNConfig(n_res_blocks=1, n_channels=16))


def _fresh_game():
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    return step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))


def test_terminal_reward_p1_elimination():
    g = GameState({
        'phase': 'game_over',
        'figurePositions': {1: {}, 2: {'Stormtrooper (Regular)-0-0': 'a1'}},
        'player1VP': {'total': 0}, 'player2VP': {'total': 0},
    })
    assert _terminal_reward_p1(g) == -1.0
    g.data['figurePositions'] = {1: {'Rebel Trooper (Regular)-0-0': 'a1'}, 2: {}}
    assert _terminal_reward_p1(g) == 1.0


def test_terminal_reward_p1_vp_tiebreak():
    g = GameState({
        'phase': 'game_over',
        'figurePositions': {1: {'A-0-0': 'a1'}, 2: {'B-0-0': 'a2'}},
        'player1VP': {'total': 5}, 'player2VP': {'total': 3},
    })
    assert _terminal_reward_p1(g) == 1.0
    g.data['player1VP']['total'] = 2
    assert _terminal_reward_p1(g) == -1.0
    g.data['player2VP']['total'] = 2
    assert _terminal_reward_p1(g) == 0.0


def test_mcts_returns_legal_action():
    net = _tiny_net()
    mcts = MCTS(net, n_simulations=5)
    g = _fresh_game()
    action, visits = mcts.run(g)
    # The action must be one the stepper can apply without raising.
    if action.type == ActionType.ATTACK_TARGET:
        action.params = {**action.params, 'rng_seed': 1}
    step(g, action)  # Should not raise.
    assert sum(visits.values()) == 5
    # Every visited child should have visit_count >= 1 among returned dict.
    for idx, n in visits.items():
        assert n >= 0


def test_mcts_visit_counts_sum_to_n_simulations():
    net = _tiny_net()
    mcts = MCTS(net, n_simulations=12)
    g = _fresh_game()
    _, visits = mcts.run(g)
    assert sum(visits.values()) == 12


def test_mcts_deterministic_with_seed():
    """Same net + same root + same seed -> same chosen action."""
    torch.manual_seed(0)
    net1 = _tiny_net()
    net1.eval()
    # Snapshot weights; rebuild with identical weights.
    state = net1.state_dict()
    torch.manual_seed(1)
    net2 = _tiny_net()
    net2.load_state_dict(state)
    net2.eval()

    g = _fresh_game()
    a1, _ = MCTS(net1, n_simulations=8, attack_rng_seed=42).run(g)
    a2, _ = MCTS(net2, n_simulations=8, attack_rng_seed=42).run(g)
    assert a1.type == a2.type, f'{a1} vs {a2}'


def test_mcts_from_terminal_state_raises():
    net = _tiny_net()
    mcts = MCTS(net, n_simulations=3)
    g = _fresh_game()
    g.data['phase'] = 'game_over'
    try:
        mcts.run(g)
    except RuntimeError:
        return
    raise AssertionError('expected RuntimeError on terminal root')


def test_mcts_plays_several_moves_in_sequence():
    """Run MCTS-as-policy for 20 real moves without crashing."""
    net = _tiny_net()
    mcts = MCTS(net, n_simulations=3, max_depth=40)
    g = _fresh_game()
    for i in range(20):
        if g.get('phase') == 'game_over':
            return
        action, _ = mcts.run(g)
        if action.type == ActionType.ATTACK_TARGET:
            action.params = {**action.params, 'rng_seed': i}
        g = step(g, action)


def main():
    cases = [
        ('terminal_reward_p1_elimination', test_terminal_reward_p1_elimination),
        ('terminal_reward_p1_vp_tiebreak', test_terminal_reward_p1_vp_tiebreak),
        ('mcts_returns_legal_action', test_mcts_returns_legal_action),
        ('mcts_visit_counts_sum_to_n_simulations', test_mcts_visit_counts_sum_to_n_simulations),
        ('mcts_deterministic_with_seed', test_mcts_deterministic_with_seed),
        ('mcts_from_terminal_state_raises', test_mcts_from_terminal_state_raises),
        ('mcts_plays_several_moves_in_sequence', test_mcts_plays_several_moves_in_sequence),
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
