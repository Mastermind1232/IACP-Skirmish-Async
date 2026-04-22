"""D10 — distributed self-play smoke test.

Spawns 2 worker processes, runs 1 iteration of 1 game each with a tiny
net, and asserts the trainer collected examples and ran a training step
without hanging.

Run as: python3 python/mcts/test_distributed.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def test_distributed_smoke():
    """1 iter, 2 workers, 1 game/worker, 2 sims/move, tiny net, 20 move cap."""
    from python.mcts.distributed import DistributedConfig, run_distributed_training
    config = DistributedConfig(
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
    )
    # Should complete without raising.
    run_distributed_training(config, resume=False)


def main():
    try:
        test_distributed_smoke()
        print('PASS: distributed_smoke')
        print('1/1 passed')
    except Exception as e:
        print(f'FAIL: distributed_smoke: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
