"""D8 — shape oracle for SkirboCNN. Verifies forward pass produces
policy [B, n_policy] and value [B, 1] in (-1, 1).

Run as: python3 python/net/test_skirbo_cnn_shape.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.encoding.encode import C, H, S, W, encode_state
from python.engine.creation import create_game
from python.net.skirbo_cnn import (
    BOARD_H,
    BOARD_W,
    CNNConfig,
    DEFAULT_N_POLICY,
    SCALAR_DIM,
    SPATIAL_CHANNELS,
    SkirboCNN,
)


def test_constants_match_encoder():
    assert SPATIAL_CHANNELS == C, f'channel mismatch {SPATIAL_CHANNELS} vs {C}'
    assert BOARD_H == H and BOARD_W == W, f'board size mismatch'
    assert SCALAR_DIM == S, f'scalar-dim mismatch {SCALAR_DIM} vs {S}'


def test_forward_random_input():
    net = SkirboCNN(CNNConfig(n_res_blocks=2, n_channels=32))
    net.eval()
    B = 4
    spatial = torch.randn(B, SPATIAL_CHANNELS, BOARD_H, BOARD_W)
    scalar = torch.randn(B, SCALAR_DIM)
    with torch.no_grad():
        policy, value = net(spatial, scalar)
    assert policy.shape == (B, DEFAULT_N_POLICY), policy.shape
    assert value.shape == (B, 1), value.shape
    assert (value >= -1.0).all() and (value <= 1.0).all()


def test_forward_real_encoded_state():
    g = create_game(map_id='mos-eisley-outskirts')
    g.data['mapId'] = 'mos-eisley-outskirts'
    sp, sc = encode_state(g, 1)
    net = SkirboCNN(CNNConfig(n_res_blocks=2, n_channels=32))
    net.eval()
    with torch.no_grad():
        policy, value = net(sp.unsqueeze(0), sc.unsqueeze(0))
    assert policy.shape == (1, DEFAULT_N_POLICY)
    assert value.shape == (1, 1)


def test_backward_pass():
    net = SkirboCNN(CNNConfig(n_res_blocks=2, n_channels=32))
    net.train()
    spatial = torch.randn(2, SPATIAL_CHANNELS, BOARD_H, BOARD_W)
    scalar = torch.randn(2, SCALAR_DIM)
    policy, value = net(spatial, scalar)
    loss = policy.mean() + value.mean()
    loss.backward()
    # Every parameter should have a grad after backward.
    for name, p in net.named_parameters():
        assert p.grad is not None, f'{name} has no grad'


def test_default_config_param_count():
    net = SkirboCNN()
    n = net.num_params()
    # Sanity band — not a hard spec, just catches gross regressions.
    assert 1_000_000 < n < 100_000_000, f'param count {n} outside reasonable band'
    print(f'default SkirboCNN has {n:,} params')


def main():
    cases = [
        ('constants_match_encoder', test_constants_match_encoder),
        ('forward_random_input', test_forward_random_input),
        ('forward_real_encoded_state', test_forward_real_encoded_state),
        ('backward_pass', test_backward_pass),
        ('default_config_param_count', test_default_config_param_count),
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
