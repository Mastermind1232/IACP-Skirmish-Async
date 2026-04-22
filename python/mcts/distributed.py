"""D10 — multiprocessing self-play orchestrator.

Trainer process holds the authoritative CNN, optimizer, replay buffer.
N worker processes each run parallel batched self-play with their own
CNN copy on the GPU, sending TrainingExamples back via a multiprocessing
queue. Per iteration:
    1. Trainer snapshots CPU weights.
    2. Trainer dispatches a self-play command (weights + seed) to every
       worker via its per-worker command queue.
    3. Workers load weights, call play_batch, return examples via a
       shared examples queue.
    4. Trainer collects N batches, extends the replay buffer, runs
       training_steps_per_iter gradient steps, saves a checkpoint.
Repeat.

Windows + CUDA requires start_method='spawn' (CUDA contexts can't be
forked). Workers use the same device as the trainer by default.

On Ctrl-C the trainer sets a stop_event, sends None sentinels to each
command queue, and joins all workers with a short timeout before
exiting — no orphaned Python processes.
"""
from __future__ import annotations

import os
import random as _random
import signal
import sys
import time
import traceback
from dataclasses import asdict, dataclass
from pathlib import Path
from queue import Empty
from typing import Any, Dict, List, Optional

import torch
import torch.multiprocessing as mp


CHECKPOINT_DIR = Path(__file__).resolve().parent / 'checkpoints'
LATEST_PATH = CHECKPOINT_DIR / 'latest.pt'


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@dataclass
class DistributedConfig:
    n_workers: int = 2
    games_per_worker: int = 8            # play_batch n_games per call
    n_iterations: int = 20
    mcts_simulations: int = 30
    training_steps_per_iter: int = 40
    batch_size: int = 64
    buffer_capacity: int = 100_000
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    max_moves_per_game: int = 300
    temperature_moves: int = 15
    seed: int = 0
    device: str = 'cuda'                 # trainer + each worker uses this
    n_channels: int = 128
    n_res_blocks: int = 6
    checkpoint_every: int = 5


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

def _worker_main(
    rank: int,
    command_q: mp.Queue,
    examples_q: mp.Queue,
    stop_event: mp.Event,
    config_dict: Dict[str, Any],
) -> None:
    """Worker loop: wait for commands, run self-play, ship examples back.

    Each command is a dict {'state_dict': CPU state dict, 'n_games': int,
    'mcts_simulations': int, 'seed': int, 'max_moves': int,
    'temperature_moves': int}.

    A command of None = clean shutdown.
    """
    try:
        # Silence Windows console; SSH sees stdout.
        import sys as _sys
        # Re-import everything the worker needs (spawn starts a fresh
        # interpreter, so top-of-file imports don't carry over).
        import torch
        from python.mcts.parallel_self_play import play_batch
        from python.net.skirbo_cnn import CNNConfig, SkirboCNN

        device = torch.device(config_dict.get('device') or 'cpu')
        net = SkirboCNN(CNNConfig(
            n_channels=config_dict['n_channels'],
            n_res_blocks=config_dict['n_res_blocks'],
        )).to(device)

        print(f'[worker {rank}] ready on {device}', flush=True)

        while not stop_event.is_set():
            try:
                cmd = command_q.get(timeout=0.5)
            except Empty:
                continue
            if cmd is None:
                break
            try:
                net.load_state_dict(cmd['state_dict'])
                t0 = time.perf_counter()
                examples = play_batch(
                    net, device,
                    n_games=cmd['n_games'],
                    mcts_simulations=cmd['mcts_simulations'],
                    max_moves=cmd['max_moves'],
                    temperature_moves=cmd['temperature_moves'],
                    seed=cmd['seed'],
                )
                elapsed = time.perf_counter() - t0
                examples_q.put({
                    'rank': rank,
                    'examples': examples,
                    'elapsed': elapsed,
                    'error': None,
                })
            except Exception as e:
                examples_q.put({
                    'rank': rank,
                    'examples': [],
                    'elapsed': 0.0,
                    'error': f'{type(e).__name__}: {e}\n{traceback.format_exc()}',
                })
    except KeyboardInterrupt:
        pass
    except Exception as e:
        try:
            examples_q.put({
                'rank': rank,
                'examples': [],
                'elapsed': 0.0,
                'error': f'worker_main crash: {e}\n{traceback.format_exc()}',
            })
        except Exception:
            pass
    finally:
        print(f'[worker {rank}] exited', flush=True)


# ---------------------------------------------------------------------------
# Trainer
# ---------------------------------------------------------------------------

def _cpu_state_dict(net) -> Dict[str, torch.Tensor]:
    return {k: v.detach().cpu().clone() for k, v in net.state_dict().items()}


def _save_checkpoint(path: Path, net, iteration: int, config: DistributedConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        'state_dict': net.state_dict(),
        'iteration': iteration,
        'net_config': {
            'n_channels': net.config.n_channels,
            'n_res_blocks': net.config.n_res_blocks,
        },
        'train_config': asdict(config),
    }, path)


def run_distributed_training(config: DistributedConfig, resume: bool = False) -> None:
    """Entry point. Spawns workers, runs the outer loop, handles Ctrl-C."""
    from python.mcts.self_play import ReplayBuffer, train_step
    from python.net.skirbo_cnn import CNNConfig, SkirboCNN

    # CUDA-safe start method.
    try:
        mp.set_start_method('spawn', force=True)
    except RuntimeError:
        pass  # already set

    device = torch.device(config.device)
    net = SkirboCNN(CNNConfig(
        n_channels=config.n_channels, n_res_blocks=config.n_res_blocks,
    ))
    start_iter = 0
    if resume and LATEST_PATH.exists():
        payload = torch.load(LATEST_PATH, map_location='cpu', weights_only=False)
        net.load_state_dict(payload['state_dict'])
        start_iter = int(payload.get('iteration', 0)) + 1
        print(f'resumed from iter {start_iter - 1}')
    net.to(device)
    optimizer = torch.optim.Adam(
        net.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay,
    )
    buffer = ReplayBuffer(capacity=config.buffer_capacity)
    rng = _random.Random(config.seed + start_iter)

    print(
        f'device={device} params={net.num_params():,} '
        f'workers={config.n_workers} games/worker={config.games_per_worker} '
        f'sims={config.mcts_simulations}'
    )

    worker_config = {
        'device': config.device,
        'n_channels': config.n_channels,
        'n_res_blocks': config.n_res_blocks,
    }
    command_qs: List[mp.Queue] = [mp.Queue() for _ in range(config.n_workers)]
    examples_q: mp.Queue = mp.Queue()
    stop_event = mp.Event()
    processes: List[mp.Process] = []

    def _shutdown(signum=None, frame=None):
        print('\n[trainer] shutdown requested — stopping workers')
        stop_event.set()
        for q in command_qs:
            try:
                q.put_nowait(None)
            except Exception:
                pass
        for p in processes:
            p.join(timeout=5.0)
            if p.is_alive():
                p.terminate()
        sys.exit(0)

    # Spawn workers.
    for rank in range(config.n_workers):
        p = mp.Process(
            target=_worker_main,
            args=(rank, command_qs[rank], examples_q, stop_event, worker_config),
            daemon=False,
        )
        p.start()
        processes.append(p)

    # Install Ctrl-C handler (main process only).
    original_sigint = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGINT, _shutdown)

    try:
        for it in range(start_iter, start_iter + config.n_iterations):
            iter_start = time.perf_counter()
            state_dict_cpu = _cpu_state_dict(net)

            # Dispatch one job to each worker.
            for rank in range(config.n_workers):
                command_qs[rank].put({
                    'state_dict': state_dict_cpu,
                    'n_games': config.games_per_worker,
                    'mcts_simulations': config.mcts_simulations,
                    'max_moves': config.max_moves_per_game,
                    'temperature_moves': config.temperature_moves,
                    'seed': rng.randint(0, 1 << 30),
                })

            # Collect results.
            total_examples = 0
            worker_elapsed: List[float] = []
            errors: List[str] = []
            received = 0
            while received < config.n_workers and not stop_event.is_set():
                try:
                    msg = examples_q.get(timeout=1.0)
                except Empty:
                    # Health check: any worker died?
                    for p in processes:
                        if not p.is_alive():
                            raise RuntimeError(f'worker pid={p.pid} died')
                    continue
                received += 1
                if msg.get('error'):
                    errors.append(msg['error'])
                buffer.extend(msg.get('examples', []))
                total_examples += len(msg.get('examples', []))
                worker_elapsed.append(msg.get('elapsed', 0.0))
            play_secs = time.perf_counter() - iter_start

            if errors:
                print('\n'.join(f'[worker error] {e[:500]}' for e in errors))

            # Training.
            train_start = time.perf_counter()
            losses = []
            for _ in range(config.training_steps_per_iter):
                batch = buffer.sample(config.batch_size, rng)
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

            slowest_worker = max(worker_elapsed) if worker_elapsed else 0.0
            print(
                f'iter={it:03d} buffer={len(buffer):6d} '
                f'moves={total_examples:5d} '
                f'play={play_secs:5.1f}s (slowest_worker={slowest_worker:4.1f}s) '
                f'train={train_secs:5.1f}s '
                f'loss={mean_loss:7.4f} (p={mean_p:7.4f} v={mean_v:.4f})',
                flush=True,
            )

            _save_checkpoint(LATEST_PATH, net, it, config)
            if config.checkpoint_every and (it + 1) % config.checkpoint_every == 0:
                _save_checkpoint(
                    CHECKPOINT_DIR / f'skirbo_iter_{it:04d}.pt', net, it, config,
                )

    finally:
        # Restore SIGINT handler before joining so child errors don't spiral.
        signal.signal(signal.SIGINT, original_sigint)
        stop_event.set()
        for q in command_qs:
            try:
                q.put_nowait(None)
            except Exception:
                pass
        for p in processes:
            p.join(timeout=10.0)
            if p.is_alive():
                p.terminate()
                p.join(timeout=5.0)
