"""D9 — tests for batched-eval pipeline.

Run as: python3 python/net/test_batched_eval.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.engine.creation import create_game
from python.net.batched_eval import (
    BatchEvaluator,
    batched_forward,
    encode_batch,
    select_device,
)
from python.net.skirbo_cnn import (
    BOARD_H,
    BOARD_W,
    DEFAULT_N_POLICY,
    SCALAR_DIM,
    SPATIAL_CHANNELS,
    CNNConfig,
    SkirboCNN,
)


def _tiny_net():
    return SkirboCNN(CNNConfig(n_res_blocks=2, n_channels=16))


def _games(n: int):
    games = []
    for i in range(n):
        g = create_game(map_id='mos-eisley-outskirts')
        g.data['mapId'] = 'mos-eisley-outskirts'
        g.data['round'] = (i % 5) + 1
        games.append(g)
    return games


def test_select_device_returns_valid_device():
    dev = select_device()
    assert dev.type in ('cpu', 'cuda', 'mps'), dev
    # Explicit override must be honored.
    assert select_device('cpu').type == 'cpu'


def test_encode_batch_stacks_correctly():
    games = _games(5)
    sp, sc = encode_batch(games, [1, 2, 1, 2, 1])
    assert sp.shape == (5, SPATIAL_CHANNELS, BOARD_H, BOARD_W), sp.shape
    assert sc.shape == (5, SCALAR_DIM), sc.shape


def test_encode_batch_rejects_length_mismatch():
    try:
        encode_batch(_games(2), [1])
    except ValueError:
        return
    raise AssertionError('expected ValueError on mismatched lengths')


def test_batched_forward_shapes():
    net = _tiny_net()
    games = _games(4)
    sp, sc = encode_batch(games, [1, 1, 2, 2])
    policy, value = batched_forward(net, sp, sc, device=torch.device('cpu'))
    assert policy.shape == (4, DEFAULT_N_POLICY), policy.shape
    assert value.shape == (4, 1), value.shape
    assert (value >= -1.0).all() and (value <= 1.0).all()


def test_batch_equals_single_up_to_tolerance():
    """Running 4 games as a batch should match running them one at a time
    within floating-point tolerance (BN is in eval mode with running stats
    initialized, so results should be deterministic batch-vs-single)."""
    net = _tiny_net()
    net.eval()
    games = _games(3)
    povs = [1, 2, 1]
    sp_batch, sc_batch = encode_batch(games, povs)
    p_batch, v_batch = batched_forward(net, sp_batch, sc_batch, torch.device('cpu'))
    for i in range(3):
        sp_one = sp_batch[i:i+1]
        sc_one = sc_batch[i:i+1]
        p_one, v_one = batched_forward(net, sp_one, sc_one, torch.device('cpu'))
        assert torch.allclose(p_batch[i:i+1], p_one, atol=1e-5), 'policy batch/single drift'
        assert torch.allclose(v_batch[i:i+1], v_one, atol=1e-5), 'value batch/single drift'


def test_evaluator_round_trip():
    net = _tiny_net()
    ev = BatchEvaluator(net, device=torch.device('cpu'))
    games = _games(6)
    policy, value = ev.evaluate(games, [1] * 6)
    assert policy.shape == (6, DEFAULT_N_POLICY)
    assert value.shape == (6, 1)


def test_evaluator_tensors_path():
    net = _tiny_net()
    ev = BatchEvaluator(net, device=torch.device('cpu'))
    sp = torch.randn(3, SPATIAL_CHANNELS, BOARD_H, BOARD_W)
    sc = torch.randn(3, SCALAR_DIM)
    policy, value = ev.evaluate_tensors(sp, sc)
    assert policy.shape == (3, DEFAULT_N_POLICY)
    assert value.shape == (3, 1)


def test_evaluator_rejects_bad_shape():
    net = _tiny_net()
    ev = BatchEvaluator(net, device=torch.device('cpu'))
    try:
        ev.evaluate_tensors(torch.randn(3, 32, 32), torch.randn(3, SCALAR_DIM))
    except ValueError:
        return
    raise AssertionError('expected ValueError on bad spatial shape')


def main():
    cases = [
        ('select_device_returns_valid_device', test_select_device_returns_valid_device),
        ('encode_batch_stacks_correctly', test_encode_batch_stacks_correctly),
        ('encode_batch_rejects_length_mismatch', test_encode_batch_rejects_length_mismatch),
        ('batched_forward_shapes', test_batched_forward_shapes),
        ('batch_equals_single_up_to_tolerance', test_batch_equals_single_up_to_tolerance),
        ('evaluator_round_trip', test_evaluator_round_trip),
        ('evaluator_tensors_path', test_evaluator_tensors_path),
        ('evaluator_rejects_bad_shape', test_evaluator_rejects_bad_shape),
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
