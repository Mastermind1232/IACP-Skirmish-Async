"""D10 — tests for shared-memory inference transport.

Run as: python3 python/mcts/test_shared_inference.py
"""
from __future__ import annotations

import sys
import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.mcts.shared_inference import (
    SharedMemoryInferenceBackend,
    SharedPool,
    serve_shared_once,
)
from python.net.skirbo_cnn import (
    BOARD_H,
    BOARD_W,
    CNNConfig,
    DEFAULT_N_POLICY,
    SCALAR_DIM,
    SPATIAL_CHANNELS,
    SkirboCNN,
)


def _tiny_net():
    return SkirboCNN(CNNConfig(n_res_blocks=1, n_channels=16))


def test_pool_build_allocates_correct_shapes():
    pool = SharedPool.build(n_workers=2, max_batch=4)
    assert pool.spatial.shape == (2, 4, SPATIAL_CHANNELS, BOARD_H, BOARD_W)
    assert pool.scalar.shape == (2, 4, SCALAR_DIM)
    assert pool.logits.shape == (2, 4, DEFAULT_N_POLICY)
    assert pool.values.shape == (2, 4, 1)
    assert pool.size.shape == (2,)
    assert pool.flag.shape == (2,)
    assert len(pool.reply_sems) == 2


def test_single_worker_round_trip():
    """Single worker posts a request; server serves it in the same thread."""
    net = _tiny_net()
    pool = SharedPool.build(n_workers=1, max_batch=3)
    be = SharedMemoryInferenceBackend(pool, worker_rank=0)

    spatial = torch.randn(2, SPATIAL_CHANNELS, BOARD_H, BOARD_W)
    scalar = torch.randn(2, SCALAR_DIM)

    # Worker runs in a thread so main thread can serve.
    result_holder = [None]

    def _worker():
        result_holder[0] = be.evaluate(spatial, scalar)

    t = threading.Thread(target=_worker)
    t.start()
    # Main thread: serve one request.
    served = serve_shared_once(net, torch.device('cpu'), pool, max_wait_s=1.0)
    assert served == 2
    t.join(timeout=5.0)
    logits, values = result_holder[0]
    assert logits.shape == (2, DEFAULT_N_POLICY)
    assert values.shape == (2, 1)


def test_two_workers_concurrent_requests_batched():
    """Two worker threads post requests; server should concatenate them
    into one forward. Validated by checking total rows served."""
    net = _tiny_net()
    pool = SharedPool.build(n_workers=2, max_batch=4)
    be0 = SharedMemoryInferenceBackend(pool, worker_rank=0)
    be1 = SharedMemoryInferenceBackend(pool, worker_rank=1)

    sp0 = torch.randn(3, SPATIAL_CHANNELS, BOARD_H, BOARD_W)
    sc0 = torch.randn(3, SCALAR_DIM)
    sp1 = torch.randn(2, SPATIAL_CHANNELS, BOARD_H, BOARD_W)
    sc1 = torch.randn(2, SCALAR_DIM)

    results = [None, None]

    def _worker(i, be, sp, sc):
        results[i] = be.evaluate(sp, sc)

    t0 = threading.Thread(target=_worker, args=(0, be0, sp0, sc0))
    t1 = threading.Thread(target=_worker, args=(1, be1, sp1, sc1))
    t0.start()
    t1.start()

    # Server may need one or two serve calls depending on worker timing.
    total = 0
    import time
    start = time.time()
    while (t0.is_alive() or t1.is_alive()) and time.time() - start < 5.0:
        total += serve_shared_once(net, torch.device('cpu'), pool, max_wait_s=0.2)
    t0.join(timeout=2.0)
    t1.join(timeout=2.0)
    assert total == 5
    assert results[0][0].shape == (3, DEFAULT_N_POLICY)
    assert results[1][0].shape == (2, DEFAULT_N_POLICY)


def test_batch_exceeding_pool_raises():
    pool = SharedPool.build(n_workers=1, max_batch=2)
    be = SharedMemoryInferenceBackend(pool, worker_rank=0)
    try:
        be.evaluate(
            torch.randn(3, SPATIAL_CHANNELS, BOARD_H, BOARD_W),
            torch.randn(3, SCALAR_DIM),
        )
    except ValueError as e:
        assert 'exceeds pool max_batch' in str(e)
        return
    raise AssertionError('expected ValueError')


def main():
    cases = [
        ('pool_build_allocates_correct_shapes', test_pool_build_allocates_correct_shapes),
        ('single_worker_round_trip', test_single_worker_round_trip),
        ('two_workers_concurrent_requests_batched', test_two_workers_concurrent_requests_batched),
        ('batch_exceeding_pool_raises', test_batch_exceeding_pool_raises),
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
