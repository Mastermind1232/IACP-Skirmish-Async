"""D10 slice 6c — self-play orchestrator tests.

Run as: python3 python/mcts/test_self_play.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.mcts.self_play import (
    ReplayBuffer,
    SelfPlayConfig,
    TrainingExample,
    _visit_counts_to_policy,
    play_one_game,
    run_self_play_loop,
    train_step,
)
from python.net.skirbo_cnn import CNNConfig, SkirboCNN


def _tiny_net():
    return SkirboCNN(CNNConfig(n_res_blocks=1, n_channels=16))


def test_visit_counts_to_policy_normalizes():
    p = _visit_counts_to_policy({0: 3, 5: 1}, n_policy=16)
    assert abs(float(p.sum()) - 1.0) < 1e-5
    assert p[0] > p[5]
    assert p[0] > 0.0 and p[5] > 0.0


def test_visit_counts_to_policy_temperature_zero_argmax():
    p = _visit_counts_to_policy({0: 1, 5: 3}, n_policy=16, temperature=0.0)
    assert p[5] == 1.0
    assert abs(float(p.sum()) - 1.0) < 1e-5


def test_replay_buffer_capacity_evicts_fifo():
    buf = ReplayBuffer(capacity=3)
    def _ex(v): return TrainingExample(
        spatial=torch.zeros(1), scalar=torch.zeros(1),
        policy=torch.zeros(1), value=v,
    )
    buf.extend([_ex(1), _ex(2), _ex(3), _ex(4)])
    assert len(buf) == 3
    assert [e.value for e in buf.buffer] == [2, 3, 4]


def test_replay_buffer_sample_under_size_returns_all():
    buf = ReplayBuffer(capacity=10)
    buf.extend([TrainingExample(
        spatial=torch.zeros(1), scalar=torch.zeros(1),
        policy=torch.zeros(1), value=float(i),
    ) for i in range(3)])
    assert len(buf.sample(10)) == 3


def test_play_one_game_produces_examples():
    net = _tiny_net()
    examples = play_one_game(
        net, torch.device('cpu'),
        mcts_simulations=2, max_moves=20, seed=0,
    )
    assert len(examples) > 0
    ex = examples[0]
    assert ex.spatial.dim() == 3      # [C, H, W]
    assert ex.scalar.dim() == 1
    assert ex.policy.dim() == 1
    assert abs(float(ex.policy.sum()) - 1.0) < 1e-4 or float(ex.policy.sum()) == 0.0


def test_train_step_reduces_value_loss_on_fixed_batch():
    """Overfit a tiny net to a tiny batch with a sparse target. Value loss
    reliably drops; we use it as a proxy that training is wired. Policy
    loss on a full-support random target + BN on tiny batches is noisier,
    so we don't gate on that here."""
    torch.manual_seed(0)
    net = _tiny_net()
    device = torch.device('cpu')
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    from python.net.skirbo_cnn import BOARD_H, BOARD_W, DEFAULT_N_POLICY, SCALAR_DIM, SPATIAL_CHANNELS
    sparse_policy = torch.zeros(DEFAULT_N_POLICY)
    sparse_policy[7] = 1.0
    batch = [TrainingExample(
        spatial=torch.randn(SPATIAL_CHANNELS, BOARD_H, BOARD_W),
        scalar=torch.randn(SCALAR_DIM),
        policy=sparse_policy.clone(),
        value=0.5,
    ) for _ in range(8)]
    first = train_step(net, opt, batch, device)
    for _ in range(15):
        last = train_step(net, opt, batch, device)
    assert last['value_loss'] < first['value_loss'], (
        f'value loss did not decrease: {first} -> {last}'
    )


def test_self_play_loop_smoke():
    """Two iterations of 1 game each, 2 training steps. Must complete."""
    torch.manual_seed(0)
    net = _tiny_net()
    config = SelfPlayConfig(
        n_iterations=2, games_per_iter=1, mcts_simulations=2,
        training_steps_per_iter=2, batch_size=4, max_moves_per_game=15,
        temperature_moves=5, seed=0,
    )
    metrics = run_self_play_loop(net, config, device=torch.device('cpu'))
    assert 'mean_loss' in metrics
    assert metrics['iter'] == 1


def main():
    cases = [
        ('visit_counts_to_policy_normalizes', test_visit_counts_to_policy_normalizes),
        ('visit_counts_to_policy_temperature_zero_argmax', test_visit_counts_to_policy_temperature_zero_argmax),
        ('replay_buffer_capacity_evicts_fifo', test_replay_buffer_capacity_evicts_fifo),
        ('replay_buffer_sample_under_size_returns_all', test_replay_buffer_sample_under_size_returns_all),
        ('play_one_game_produces_examples', test_play_one_game_produces_examples),
        ('train_step_reduces_value_loss_on_fixed_batch', test_train_step_reduces_value_loss_on_fixed_batch),
        ('self_play_loop_smoke', test_self_play_loop_smoke),
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
