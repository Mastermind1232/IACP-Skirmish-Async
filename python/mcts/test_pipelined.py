"""D10 — tests for pipelined/async BatchedMCTS.

Run as: python3 python/mcts/test_pipelined.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.engine.actions import ActionType
from python.engine.stepper import Action, step
from python.mcts.parallel_self_play import _fresh_game
from python.mcts.pipelined_search import PipelinedBatchedMCTS
from python.net.skirbo_cnn import CNNConfig, SkirboCNN


def _tiny_net():
    return SkirboCNN(CNNConfig(n_res_blocks=1, n_channels=16))


def test_pipelined_mcts_returns_legal_actions():
    net = _tiny_net()
    mcts = PipelinedBatchedMCTS(
        net=net, device=torch.device('cpu'),
        pipeline_depth=4,
    )
    games = [_fresh_game() for _ in range(3)]
    results = mcts.run(games, n_simulations=8)
    assert len(results) == 3
    for game, (action, visits) in zip(games, results):
        assert action is not None
        # Applying to the stepper must not raise.
        if action.type == ActionType.ATTACK_TARGET:
            action.params = {**action.params, 'rng_seed': 1}
        step(game, action)


def test_pipelined_visit_counts_respect_sims():
    net = _tiny_net()
    mcts = PipelinedBatchedMCTS(
        net=net, device=torch.device('cpu'),
        pipeline_depth=4,
    )
    game = _fresh_game()
    results = mcts.run([game], n_simulations=8)
    _, visits = results[0]
    # Visits per child = sims that descended into that child.
    # Sum across children should equal total simulations.
    assert sum(visits.values()) == 8


def test_pipelined_matches_serial_shape_for_depth_1():
    """With pipeline_depth=1, each step handles one descent per game —
    behaviorally equivalent to BatchedMCTS. Just verify it runs."""
    net = _tiny_net()
    mcts = PipelinedBatchedMCTS(
        net=net, device=torch.device('cpu'),
        pipeline_depth=1,
    )
    games = [_fresh_game() for _ in range(2)]
    results = mcts.run(games, n_simulations=4)
    for game, (action, visits) in zip(games, results):
        assert action is not None
        assert sum(visits.values()) == 4


def test_pipelined_handles_terminal_states():
    net = _tiny_net()
    mcts = PipelinedBatchedMCTS(
        net=net, device=torch.device('cpu'),
        pipeline_depth=4,
    )
    live = _fresh_game()
    dead = _fresh_game()
    dead.data['phase'] = 'game_over'
    results = mcts.run([live, dead], n_simulations=4)
    assert results[0][0] is not None
    assert results[1][0] is None
    assert results[1][1] == {}


def main():
    cases = [
        ('pipelined_mcts_returns_legal_actions', test_pipelined_mcts_returns_legal_actions),
        ('pipelined_visit_counts_respect_sims', test_pipelined_visit_counts_respect_sims),
        ('pipelined_matches_serial_shape_for_depth_1', test_pipelined_matches_serial_shape_for_depth_1),
        ('pipelined_handles_terminal_states', test_pipelined_handles_terminal_states),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            print(f'FAIL: {name}: {e}')
            import traceback
            traceback.print_exc()
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
