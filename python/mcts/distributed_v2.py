"""D10 — distributed self-play v2: central-GPU inference server.

Architecture:
    Trainer (main proc)         Workers (CPU-only)
    ─────────────────           ────────────────────
    Owns CNN on GPU             Own MCTS tree + game state
    Owns replay buffer          Send eval requests via shared queue
    Runs inference server       Block on dedicated reply queue
    (serves requests from       When self-play done, ship
     all workers, one big       TrainingExamples back via
     batched forward each       examples queue
     time)

Per iteration:
  1. Trainer dispatches a self-play command to each worker.
  2. Workers start running MCTS; every eval sends an inference request.
  3. Trainer loops: serve inference requests AND poll for finished
     workers until all workers return examples.
  4. Trainer runs training_steps_per_iter gradient steps.
  5. Checkpoint + repeat.

This fixes the CUDA-context-time-slicing issue of distributed.py — the
GPU has one owner, all forward passes are maximally batched across
workers.
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


@dataclass
class DistributedV2Config:
    n_workers: int = 4
    games_per_worker: int = 8
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
    device: str = 'cuda'
    n_channels: int = 128
    n_res_blocks: int = 6
    checkpoint_every: int = 5
    max_inference_batch: int = 128
    inference_poll_timeout_s: float = 0.01
    heartbeat_every_s: float = 30.0
    transport: str = 'shared'  # 'shared' (zero-copy) or 'queue' (pickled)
    pipeline_depth: int = 1    # >1 enables virtual-loss pipelined MCTS
    fp16_inference: bool = True   # autocast inference forward in float16
    compile_net: bool = False  # torch.compile the trained net (slow first call)


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

def _v2_worker_main(
    rank: int,
    command_q: mp.Queue,
    examples_q: mp.Queue,
    request_q,              # queue OR None (shared transport)
    reply_q,                # queue OR None (shared transport)
    stop_event: mp.Event,
    shared_pool=None,       # SharedPool or None
) -> None:
    """Worker loop: CPU-only, uses RemoteInferenceBackend for evals.

    Commands:
        None                              -> clean exit.
        {'n_games', 'mcts_simulations',
         'max_moves', 'temperature_moves',
         'seed'}                          -> run one self-play batch.
    """
    try:
        import torch
        from python.engine.actions import ActionType
        from python.engine.creation import create_game
        from python.engine.stepper import Action, step
        from python.mcts.actions import policy_index_to_action
        from python.mcts.batched_search import BatchedMCTS
        from python.mcts.inference_backend import RemoteInferenceBackend
        from python.mcts.pipelined_search import PipelinedBatchedMCTS
        from python.mcts.search import _terminal_reward_p1
        from python.mcts.self_play import TrainingExample, _visit_counts_to_policy
        from python.encoding.encode import encode_state

        if shared_pool is not None:
            from python.mcts.shared_inference import SharedMemoryInferenceBackend
            backend = SharedMemoryInferenceBackend(shared_pool, rank)
            transport_label = 'shared'
        else:
            backend = RemoteInferenceBackend(request_q, reply_q, rank)
            transport_label = 'queue'
        print(
            f'[worker {rank}] ready (cpu, {transport_label} backend)',
            flush=True,
        )

        while not stop_event.is_set():
            try:
                cmd = command_q.get(timeout=0.5)
            except Empty:
                continue
            if cmd is None:
                break

            try:
                rng = _random.Random(cmd['seed'])
                pipeline_depth = int(cmd.get('pipeline_depth', 1) or 1)
                if pipeline_depth > 1:
                    mcts = PipelinedBatchedMCTS(
                        backend=backend,
                        attack_rng_seed=rng.randint(0, 1 << 30),
                        pipeline_depth=pipeline_depth,
                    )
                else:
                    mcts = BatchedMCTS(
                        backend=backend,
                        attack_rng_seed=rng.randint(0, 1 << 30),
                    )
                n_games = cmd['n_games']
                games = []
                for _ in range(n_games):
                    g = create_game(
                        map_id='mos-eisley-outskirts',
                        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                                  'deploymentCards': ['Rebel Trooper (Regular)']},
                        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                                  'deploymentCards': ['Stormtrooper (Regular)']},
                    )
                    g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
                    games.append(g)

                histories = [[] for _ in range(n_games)]
                actors = [[] for _ in range(n_games)]

                t0 = time.perf_counter()
                for move_idx in range(cmd['max_moves']):
                    active = [i for i, g in enumerate(games)
                              if g.get('phase') != 'game_over']
                    if not active:
                        break

                    move_tensors = {}
                    for i in active:
                        pov = int(games[i].get('activePlayer') or 1)
                        sp, sc = encode_state(games[i], pov)
                        move_tensors[i] = (sp, sc, pov)

                    mcts_states = [games[i] for i in active]
                    results = mcts.run(mcts_states, cmd['mcts_simulations'])

                    temperature = 1.0 if move_idx < cmd['temperature_moves'] else 1e-9

                    for local_idx, gi in enumerate(active):
                        chosen, visits = results[local_idx]
                        if not visits:
                            continue
                        policy_target = _visit_counts_to_policy(
                            visits, 4096, temperature,
                        )
                        if temperature > 1e-6:
                            idxs = list(visits.keys())
                            weights = [policy_target[k].item() for k in idxs]
                            total = sum(weights)
                            if total > 0:
                                picked = rng.choices(idxs, weights=weights, k=1)[0]
                                try:
                                    chosen = policy_index_to_action(picked, games[gi])
                                except ValueError:
                                    pass
                        if chosen is None:
                            continue
                        sp, sc, actor = move_tensors[gi]
                        histories[gi].append(TrainingExample(
                            spatial=sp, scalar=sc, policy=policy_target, value=0.0,
                        ))
                        actors[gi].append(actor)
                        if chosen.type == ActionType.ATTACK_TARGET:
                            chosen.params = {
                                **chosen.params,
                                'rng_seed': rng.randint(0, 1 << 30),
                            }
                        try:
                            games[gi] = step(games[gi], chosen)
                        except Exception:
                            games[gi].data['phase'] = 'game_over'

                all_examples: List[TrainingExample] = []
                for game, history, actor_list in zip(games, histories, actors):
                    reward_p1 = _terminal_reward_p1(game) if game.get('phase') == 'game_over' else 0.0
                    for ex, actor in zip(history, actor_list):
                        ex.value = reward_p1 if actor == 1 else -reward_p1
                        all_examples.append(ex)
                elapsed = time.perf_counter() - t0

                examples_q.put({
                    'rank': rank,
                    'examples': all_examples,
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


def _save_checkpoint(path: Path, net, iteration: int, config) -> None:
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


def run_distributed_v2(config: DistributedV2Config, resume: bool = False) -> None:
    """Entry point."""
    from python.mcts.inference_server import serve_inference_once
    from python.mcts.self_play import ReplayBuffer, train_step
    from python.net.skirbo_cnn import CNNConfig, SkirboCNN

    try:
        mp.set_start_method('spawn', force=True)
    except RuntimeError:
        pass

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
    if config.compile_net:
        try:
            net = torch.compile(net)
            print('[trainer] torch.compile applied to net')
        except Exception as e:
            print(f'[trainer] torch.compile failed ({e}); continuing uncompiled')

    optimizer = torch.optim.Adam(
        net.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay,
    )
    buffer = ReplayBuffer(capacity=config.buffer_capacity)
    rng = _random.Random(config.seed + start_iter)

    print(
        f'device={device} params={net.num_params():,} '
        f'workers={config.n_workers} games/worker={config.games_per_worker} '
        f'sims={config.mcts_simulations} max_batch={config.max_inference_batch}'
    )

    use_shared = (config.transport == 'shared')
    if use_shared:
        from python.mcts.shared_inference import SharedPool
        # Pipelined MCTS can submit up to games_per_worker * pipeline_depth
        # rows per call. Size the pool slots accordingly.
        slot_size = config.games_per_worker * max(1, config.pipeline_depth)
        shared_pool = SharedPool.build(
            n_workers=config.n_workers,
            max_batch=slot_size,
        )
        request_q = None
        reply_qs = [None] * config.n_workers
    else:
        shared_pool = None
        request_q = mp.Queue()
        reply_qs = [mp.Queue() for _ in range(config.n_workers)]

    command_qs: List[mp.Queue] = [mp.Queue() for _ in range(config.n_workers)]
    examples_q: mp.Queue = mp.Queue()
    stop_event = mp.Event()
    processes: List[mp.Process] = []

    def _shutdown(signum=None, frame=None):
        print('\n[trainer] shutdown requested', flush=True)
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

    for rank in range(config.n_workers):
        p = mp.Process(
            target=_v2_worker_main,
            args=(rank, command_qs[rank], examples_q,
                  request_q, reply_qs[rank] if reply_qs[rank] else None,
                  stop_event, shared_pool),
            daemon=False,
        )
        p.start()
        processes.append(p)

    original_sigint = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGINT, _shutdown)

    try:
        for it in range(start_iter, start_iter + config.n_iterations):
            iter_start = time.perf_counter()

            # Dispatch self-play jobs.
            for rank in range(config.n_workers):
                command_qs[rank].put({
                    'n_games': config.games_per_worker,
                    'mcts_simulations': config.mcts_simulations,
                    'max_moves': config.max_moves_per_game,
                    'temperature_moves': config.temperature_moves,
                    'seed': rng.randint(0, 1 << 30),
                    'pipeline_depth': config.pipeline_depth,
                })

            # Interleave inference serving with example collection.
            pending = config.n_workers
            total_examples = 0
            worker_elapsed: List[float] = []
            errors: List[str] = []
            total_inference_rows = 0
            last_heartbeat = time.perf_counter()

            while pending > 0:
                # Check for completed workers (non-blocking).
                try:
                    while True:
                        msg = examples_q.get_nowait()
                        pending -= 1
                        if msg.get('error'):
                            errors.append(msg['error'])
                        buffer.extend(msg.get('examples', []))
                        total_examples += len(msg.get('examples', []))
                        worker_elapsed.append(msg.get('elapsed', 0.0))
                except Empty:
                    pass

                if pending == 0:
                    break

                # Serve one batch of inference.
                if use_shared:
                    from python.mcts.shared_inference import serve_shared_once
                    served = serve_shared_once(
                        net, device, shared_pool,
                        max_wait_s=config.inference_poll_timeout_s,
                        use_amp=config.fp16_inference,
                    )
                else:
                    served = serve_inference_once(
                        net, device, request_q, reply_qs,
                        max_batch=config.max_inference_batch,
                        poll_timeout_s=config.inference_poll_timeout_s,
                        use_amp=config.fp16_inference,
                    )
                total_inference_rows += served

                # Health check + heartbeat.
                now = time.perf_counter()
                if now - last_heartbeat > config.heartbeat_every_s:
                    last_heartbeat = now
                    alive = sum(1 for p in processes if p.is_alive())
                    print(
                        f'[trainer] iter={it:03d} heartbeat: '
                        f'workers_pending={pending}/{config.n_workers} '
                        f'alive={alive} '
                        f'inference_rows={total_inference_rows} '
                        f'elapsed={now - iter_start:.1f}s',
                        flush=True,
                    )
                    for p in processes:
                        if not p.is_alive():
                            errors.append(f'worker pid={p.pid} died')
                            pending -= 1  # consider it done so loop can exit

            play_secs = time.perf_counter() - iter_start

            if errors:
                for e in errors:
                    print(f'[worker error] {e[:800]}', flush=True)

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

            slowest = max(worker_elapsed) if worker_elapsed else 0.0
            print(
                f'iter={it:03d} buffer={len(buffer):6d} '
                f'moves={total_examples:5d} '
                f'play={play_secs:6.1f}s (slowest_worker={slowest:5.1f}s) '
                f'infer_rows={total_inference_rows:6d} '
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
