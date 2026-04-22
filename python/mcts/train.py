"""D10 — AlphaZero-Skirbo training driver.

Run:
    python3 python/mcts/train.py --iters 50 --games 8 --sims 50

Saves a checkpoint (net state + config + iteration) to
`python/mcts/checkpoints/skirbo_iter_<N>.pt` every --checkpoint-every
iterations and a `latest.pt` after each iteration so runs are
recoverable. Resumes from `latest.pt` if --resume is passed.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.mcts.self_play import (
    ReplayBuffer,
    SelfPlayConfig,
    play_one_game,
    train_step,
)
from python.net.batched_eval import select_device
from python.net.skirbo_cnn import CNNConfig, SkirboCNN


CHECKPOINT_DIR = Path(__file__).resolve().parent / 'checkpoints'
LATEST_PATH = CHECKPOINT_DIR / 'latest.pt'


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description='AlphaZero-Skirbo trainer')
    ap.add_argument('--iters', type=int, default=10, help='outer iterations')
    ap.add_argument('--games', type=int, default=4, help='self-play games per iter')
    ap.add_argument('--sims', type=int, default=30, help='MCTS simulations per move')
    ap.add_argument('--batch-size', type=int, default=32)
    ap.add_argument('--train-steps', type=int, default=30, help='gradient steps per iter')
    ap.add_argument('--buffer', type=int, default=20_000)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--weight-decay', type=float, default=1e-4)
    ap.add_argument('--max-moves', type=int, default=300)
    ap.add_argument('--tau-moves', type=int, default=15, help='moves using tau=1 exploration')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--device', default=None, help='cpu / cuda / mps (default: auto)')
    ap.add_argument('--checkpoint-every', type=int, default=5)
    ap.add_argument('--resume', action='store_true', help='load latest.pt if present')
    ap.add_argument('--n-channels', type=int, default=128)
    ap.add_argument('--n-res-blocks', type=int, default=6)
    return ap.parse_args()


def _save_checkpoint(path: Path, net: SkirboCNN, iteration: int, cfg: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        'state_dict': net.state_dict(),
        'iteration': iteration,
        'net_config': asdict(net.config),
        'train_config': cfg,
    }, path)


def _load_checkpoint(path: Path, net: SkirboCNN) -> int:
    payload = torch.load(path, map_location='cpu', weights_only=False)
    net.load_state_dict(payload['state_dict'])
    return int(payload.get('iteration', 0))


def main() -> None:
    args = _parse_args()
    device = torch.device(args.device) if args.device else select_device()

    net_cfg = CNNConfig(n_channels=args.n_channels, n_res_blocks=args.n_res_blocks)
    net = SkirboCNN(net_cfg)
    start_iter = 0
    if args.resume and LATEST_PATH.exists():
        start_iter = _load_checkpoint(LATEST_PATH, net) + 1
        print(f'resumed from iter {start_iter - 1}')
    net.to(device)

    optimizer = torch.optim.Adam(
        net.parameters(), lr=args.lr, weight_decay=args.weight_decay,
    )
    buffer = ReplayBuffer(capacity=args.buffer)
    rng = __import__('random').Random(args.seed + start_iter)

    print(f'device={device} params={net.num_params():,} '
          f'iters={args.iters} games/iter={args.games} sims={args.sims}')

    train_cfg = {
        'iters': args.iters, 'games': args.games, 'sims': args.sims,
        'batch_size': args.batch_size, 'train_steps': args.train_steps,
        'lr': args.lr, 'weight_decay': args.weight_decay,
        'max_moves': args.max_moves, 'tau_moves': args.tau_moves,
        'seed': args.seed,
    }

    for it in range(start_iter, start_iter + args.iters):
        it_start = time.perf_counter()
        game_examples = 0
        for g in range(args.games):
            examples = play_one_game(
                net, device,
                mcts_simulations=args.sims,
                max_moves=args.max_moves,
                temperature_moves=args.tau_moves,
                seed=rng.randint(0, 1 << 30),
            )
            buffer.extend(examples)
            game_examples += len(examples)
        play_secs = time.perf_counter() - it_start

        train_start = time.perf_counter()
        losses = []
        for _ in range(args.train_steps):
            batch = buffer.sample(args.batch_size, rng)
            if not batch:
                break
            losses.append(train_step(net, optimizer, batch, device))
        train_secs = time.perf_counter() - train_start

        if losses:
            mean_loss = sum(m['loss'] for m in losses) / len(losses)
            mean_p = sum(m['policy_loss'] for m in losses) / len(losses)
            mean_v = sum(m['value_loss'] for m in losses) / len(losses)
        else:
            mean_loss = mean_p = mean_v = float('nan')

        print(
            f'iter={it:03d} buffer={len(buffer):6d} '
            f'moves={game_examples:4d} play={play_secs:5.1f}s train={train_secs:5.1f}s '
            f'loss={mean_loss:7.4f} (p={mean_p:7.4f} v={mean_v:.4f})'
        )

        _save_checkpoint(LATEST_PATH, net, it, train_cfg)
        if args.checkpoint_every and (it + 1) % args.checkpoint_every == 0:
            _save_checkpoint(
                CHECKPOINT_DIR / f'skirbo_iter_{it:04d}.pt', net, it, train_cfg,
            )


if __name__ == '__main__':
    main()
