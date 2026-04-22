"""D9 — throughput benchmark for batched SkirboCNN forward.

Measures states/sec at various batch sizes to confirm batching actually
pays off. Includes a warmup pass; encoded once per batch-size so we isolate
forward-pass cost from encode cost.

Run as: python3 python/net/benchmark_forward.py [--cpu]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.engine.creation import create_game
from python.net.batched_eval import BatchEvaluator, encode_batch, select_device
from python.net.skirbo_cnn import CNNConfig, SkirboCNN


BATCH_SIZES = (1, 4, 16, 64, 128, 256)
WARMUP_ITERS = 2
MEASURE_ITERS = 5


def _make_games(n: int):
    games = []
    for i in range(n):
        g = create_game(map_id='mos-eisley-outskirts')
        g.data['mapId'] = 'mos-eisley-outskirts'
        g.data['round'] = (i % 6) + 1
        games.append(g)
    return games


def _sync(device: torch.device):
    if device.type == 'cuda':
        torch.cuda.synchronize()
    elif device.type == 'mps':
        torch.mps.synchronize()


def _time_forward(net, spatial, scalar, device, iters: int) -> float:
    _sync(device)
    t0 = time.perf_counter()
    for _ in range(iters):
        with torch.no_grad():
            sp = spatial.to(device, non_blocking=True)
            sc = scalar.to(device, non_blocking=True)
            net(sp, sc)
    _sync(device)
    return time.perf_counter() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cpu', action='store_true', help='force CPU device')
    args = ap.parse_args()

    device = torch.device('cpu') if args.cpu else select_device()
    print(f'device: {device}')

    net = SkirboCNN(CNNConfig()).to(device)
    net.eval()
    print(f'params: {net.num_params():,}')
    print()
    print(f'{"batch":>8} {"fwd_ms":>10} {"states/s":>12}  (avg over '
          f'{MEASURE_ITERS} iters, {WARMUP_ITERS} warmup)')
    print('-' * 44)

    # Reuse the largest encoded batch for all smaller sizes by slicing.
    max_b = max(BATCH_SIZES)
    games = _make_games(max_b)
    spatial_big, scalar_big = encode_batch(games, [1] * max_b)

    for B in BATCH_SIZES:
        sp = spatial_big[:B]
        sc = scalar_big[:B]
        # Warmup
        _time_forward(net, sp, sc, device, WARMUP_ITERS)
        elapsed = _time_forward(net, sp, sc, device, MEASURE_ITERS)
        per_call_ms = (elapsed / MEASURE_ITERS) * 1000.0
        states_per_sec = (B * MEASURE_ITERS) / elapsed
        print(f'{B:>8} {per_call_ms:>10.2f} {states_per_sec:>12,.0f}')


if __name__ == '__main__':
    main()
