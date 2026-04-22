"""D10 — distributed v2 smoke test (multi-process + inference server).

Run as: python3 python/mcts/test_distributed_v2.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def test_v2_smoke():
    from python.mcts.distributed_v2 import DistributedV2Config, run_distributed_v2
    config = DistributedV2Config(
        n_workers=2,
        games_per_worker=1,
        n_iterations=1,
        mcts_simulations=2,
        training_steps_per_iter=2,
        batch_size=4,
        buffer_capacity=100,
        learning_rate=1e-3,
        max_moves_per_game=15,
        temperature_moves=5,
        seed=0,
        device='cpu',
        n_channels=16,
        n_res_blocks=1,
        checkpoint_every=0,
        max_inference_batch=8,
        heartbeat_every_s=10.0,
    )
    run_distributed_v2(config, resume=False)


def main():
    try:
        test_v2_smoke()
        print('PASS: v2_smoke')
        print('1/1 passed')
    except Exception as e:
        print(f'FAIL: v2_smoke: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
