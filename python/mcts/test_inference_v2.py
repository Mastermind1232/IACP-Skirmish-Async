"""D10 — tests for inference-server architecture (backend, server, v2 e2e).

Run as: python3 python/mcts/test_inference_v2.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import queue

import torch

from python.mcts.batched_search import BatchedMCTS
from python.mcts.inference_backend import (
    LocalInferenceBackend,
    RemoteInferenceBackend,
)
from python.mcts.inference_server import serve_inference_once
from python.mcts.parallel_self_play import _fresh_game
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


def test_local_backend_shapes():
    net = _tiny_net()
    be = LocalInferenceBackend(net, torch.device('cpu'))
    sp = torch.randn(3, SPATIAL_CHANNELS, BOARD_H, BOARD_W)
    sc = torch.randn(3, SCALAR_DIM)
    logits, values = be.evaluate(sp, sc)
    assert logits.shape == (3, DEFAULT_N_POLICY)
    assert values.shape == (3, 1)


def test_server_batches_and_routes_replies():
    """Queue 2 requests from rank 0 and 1 with distinct batches; the
    server should concatenate them, run one forward, and return the
    correct slice to each reply queue."""
    net = _tiny_net()
    req_q = queue.Queue()
    reply_qs = [queue.Queue(), queue.Queue()]
    req_q.put({
        'worker_rank': 0, 'req_id': 1,
        'spatial': torch.randn(2, SPATIAL_CHANNELS, BOARD_H, BOARD_W),
        'scalar': torch.randn(2, SCALAR_DIM),
    })
    req_q.put({
        'worker_rank': 1, 'req_id': 1,
        'spatial': torch.randn(3, SPATIAL_CHANNELS, BOARD_H, BOARD_W),
        'scalar': torch.randn(3, SCALAR_DIM),
    })
    served = serve_inference_once(net, torch.device('cpu'), req_q, reply_qs, max_batch=16)
    assert served == 5
    r0 = reply_qs[0].get_nowait()
    r1 = reply_qs[1].get_nowait()
    assert r0['req_id'] == 1
    assert r0['logits'].shape == (2, DEFAULT_N_POLICY)
    assert r0['values'].shape == (2, 1)
    assert r1['req_id'] == 1
    assert r1['logits'].shape == (3, DEFAULT_N_POLICY)
    assert r1['values'].shape == (3, 1)


def test_server_returns_zero_on_empty():
    net = _tiny_net()
    req_q = queue.Queue()
    reply_qs = [queue.Queue()]
    served = serve_inference_once(
        net, torch.device('cpu'), req_q, reply_qs,
        max_batch=4, poll_timeout_s=0.01,
    )
    assert served == 0


def test_remote_backend_matches_local_when_same_weights():
    """A BatchedMCTS run through the remote backend should descend to
    the same initial action as through the local backend (both see the
    exact same weights and the same state)."""
    torch.manual_seed(0)
    net = _tiny_net()
    net.eval()
    device = torch.device('cpu')

    # Local run.
    local_be = LocalInferenceBackend(net, device)
    mcts_local = BatchedMCTS(backend=local_be, attack_rng_seed=0)
    game = _fresh_game()
    local_results = mcts_local.run([game], n_simulations=3)

    # Remote run — drive manually: worker enqueues requests, we run
    # server synchronously in-thread.
    req_q = queue.Queue()
    reply_qs = [queue.Queue()]
    remote_be = RemoteInferenceBackend(req_q, reply_qs[0], worker_rank=0)
    mcts_remote = BatchedMCTS(backend=remote_be, attack_rng_seed=0)

    # Run remote MCTS in a thread; server loop in main.
    import threading
    remote_results = [None]

    def _remote_thread():
        remote_results[0] = mcts_remote.run([game], n_simulations=3)

    t = threading.Thread(target=_remote_thread)
    t.start()

    # Server drains requests until remote thread finishes.
    while t.is_alive() or not req_q.empty():
        serve_inference_once(
            net, device, req_q, reply_qs,
            max_batch=16, poll_timeout_s=0.05,
        )
    t.join(timeout=10)
    assert remote_results[0] is not None
    # Both runs should produce the same action type at least (exact
    # tree may vary if random seeding diverges, but the top-1 child
    # under identical net + identical root should match).
    assert local_results[0][0].type == remote_results[0][0][0].type


def main():
    cases = [
        ('local_backend_shapes', test_local_backend_shapes),
        ('server_batches_and_routes_replies', test_server_batches_and_routes_replies),
        ('server_returns_zero_on_empty', test_server_returns_zero_on_empty),
        ('remote_backend_matches_local_when_same_weights', test_remote_backend_matches_local_when_same_weights),
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
