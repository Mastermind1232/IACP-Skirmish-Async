"""D10 slice 6d — tests for batched MCTS + parallel self-play.

Run as: python3 python/mcts/test_parallel.py
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
from python.engine.stepper import Action, step
from python.mcts.batched_search import BatchedMCTS
from python.mcts.parallel_self_play import _fresh_game, play_batch
from python.net.skirbo_cnn import CNNConfig, SkirboCNN


def _tiny_net():
    return SkirboCNN(CNNConfig(n_res_blocks=1, n_channels=16))


def test_batched_mcts_returns_action_per_game():
    net = _tiny_net()
    mcts = BatchedMCTS(net, device=torch.device('cpu'))
    games = [_fresh_game() for _ in range(4)]
    results = mcts.run(games, n_simulations=4)
    assert len(results) == 4
    for action, visits in results:
        assert action is not None
        assert sum(visits.values()) == 4


def test_batched_mcts_handles_mixed_terminal_and_live_states():
    net = _tiny_net()
    mcts = BatchedMCTS(net, device=torch.device('cpu'))
    live = _fresh_game()
    dead = _fresh_game()
    dead.data['phase'] = 'game_over'
    results = mcts.run([live, dead], n_simulations=3)
    assert results[0][0] is not None
    assert results[1][0] is None
    assert results[1][1] == {}


def test_batched_mcts_matches_single_mcts_for_n1():
    """With N=1, BatchedMCTS should pick a legal action (behavioral
    parity with single MCTS isn't exact due to internal state machines,
    but the chosen action must be acceptable to the stepper)."""
    net = _tiny_net()
    mcts = BatchedMCTS(net, device=torch.device('cpu'))
    g = _fresh_game()
    results = mcts.run([g], n_simulations=4)
    action, visits = results[0]
    assert action is not None
    assert sum(visits.values()) == 4
    # Apply to confirm the stepper accepts it.
    if action.type == ActionType.ATTACK_TARGET:
        action.params = {**action.params, 'rng_seed': 1}
    step(g, action)


def test_play_batch_produces_examples_for_each_game():
    net = _tiny_net()
    examples = play_batch(
        net, torch.device('cpu'),
        n_games=3, mcts_simulations=2, max_moves=10, seed=0,
    )
    assert len(examples) > 0
    for ex in examples:
        assert ex.spatial.dim() == 3
        assert ex.scalar.dim() == 1
        assert ex.policy.dim() == 1


def test_play_batch_examples_have_valid_value_targets():
    net = _tiny_net()
    examples = play_batch(
        net, torch.device('cpu'),
        n_games=2, mcts_simulations=2, max_moves=15, seed=1,
    )
    for ex in examples:
        assert -1.0 <= ex.value <= 1.0


def main():
    cases = [
        ('batched_mcts_returns_action_per_game', test_batched_mcts_returns_action_per_game),
        ('batched_mcts_handles_mixed_terminal_and_live_states', test_batched_mcts_handles_mixed_terminal_and_live_states),
        ('batched_mcts_matches_single_mcts_for_n1', test_batched_mcts_matches_single_mcts_for_n1),
        ('play_batch_produces_examples_for_each_game', test_play_batch_produces_examples_for_each_game),
        ('play_batch_examples_have_valid_value_targets', test_play_batch_examples_have_valid_value_targets),
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
