"""D10 — shared-memory inference transport.

Replaces queue-pickled tensors with zero-copy shared-memory tensors.
Every worker gets a dedicated slot in pre-allocated shared tensors:

    spatial_shm [N_workers, max_batch, C, H, W] float32 (shared)
    scalar_shm  [N_workers, max_batch, S]       float32 (shared)
    logits_shm  [N_workers, max_batch, n_policy] float32 (shared)
    values_shm  [N_workers, max_batch, 1]       float32 (shared)
    size_shm    [N_workers] int64                        (shared)
    flag_shm    [N_workers] int32  (1=pending, 0=idle)   (shared)

Synchronization:
    request_sem   (Semaphore, starts at 0)
    reply_sems[N] (one Semaphore per worker)

Request flow (worker side):
    1. Copy spatial/scalar into spatial_shm[rank, :B] / scalar_shm[rank, :B]
    2. size_shm[rank] = B; flag_shm[rank] = 1
    3. request_sem.release()
    4. reply_sems[rank].acquire()   (blocks)
    5. Return clone(logits_shm[rank, :B]), clone(values_shm[rank, :B])

Server flow (trainer side):
    1. request_sem.acquire()  (blocks until at least one worker posts)
    2. request_sem.acquire(block=False) * K  (drain queued ready signals)
    3. Scan flag_shm to find ready ranks
    4. torch.cat ready slots, run forward, write results into reply slots
    5. For each ready rank: flag_shm[rank] = 0; reply_sems[rank].release()

Cost vs queue-pickling:
    Old: ~3MB pickle per request + ~12MB pickle per reply. 15MB/rtrip.
    New: ~0. Tensors are views of shared pages.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

import torch
import torch.multiprocessing as mp

from python.mcts.inference_backend import InferenceBackend
from python.net.skirbo_cnn import (
    BOARD_H,
    BOARD_W,
    DEFAULT_N_POLICY,
    SCALAR_DIM,
    SPATIAL_CHANNELS,
)


@dataclass
class SharedPool:
    """Shared-memory tensors + semaphores for zero-copy inference IPC.

    Constructed once by the trainer, then shared to workers via spawn.
    """
    n_workers: int
    max_batch: int
    n_policy: int

    # Tensors (shared).
    spatial: torch.Tensor
    scalar: torch.Tensor
    logits: torch.Tensor
    values: torch.Tensor
    size: torch.Tensor
    flag: torch.Tensor

    # Synchronization.
    request_sem: any
    reply_sems: List[any]

    @classmethod
    def build(cls, n_workers: int, max_batch: int, n_policy: int = DEFAULT_N_POLICY) -> 'SharedPool':
        spatial = torch.zeros(
            n_workers, max_batch, SPATIAL_CHANNELS, BOARD_H, BOARD_W,
            dtype=torch.float32,
        ).share_memory_()
        scalar = torch.zeros(
            n_workers, max_batch, SCALAR_DIM, dtype=torch.float32,
        ).share_memory_()
        logits = torch.zeros(
            n_workers, max_batch, n_policy, dtype=torch.float32,
        ).share_memory_()
        values = torch.zeros(
            n_workers, max_batch, 1, dtype=torch.float32,
        ).share_memory_()
        size = torch.zeros(n_workers, dtype=torch.int64).share_memory_()
        flag = torch.zeros(n_workers, dtype=torch.int32).share_memory_()
        return cls(
            n_workers=n_workers,
            max_batch=max_batch,
            n_policy=n_policy,
            spatial=spatial,
            scalar=scalar,
            logits=logits,
            values=values,
            size=size,
            flag=flag,
            request_sem=mp.Semaphore(0),
            reply_sems=[mp.Semaphore(0) for _ in range(n_workers)],
        )


class SharedMemoryInferenceBackend(InferenceBackend):
    """Worker-side backend: writes into the pool's slot and blocks on a
    per-worker reply semaphore."""

    def __init__(self, pool: SharedPool, worker_rank: int) -> None:
        self.pool = pool
        self.rank = worker_rank
        if worker_rank < 0 or worker_rank >= pool.n_workers:
            raise ValueError(f'worker_rank {worker_rank} out of range')

    def evaluate(
        self,
        spatial: torch.Tensor,
        scalar: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        B = int(spatial.shape[0])
        if B > self.pool.max_batch:
            raise ValueError(
                f'batch {B} exceeds pool max_batch {self.pool.max_batch}'
            )
        rank = self.rank

        # Copy into shared slot.
        self.pool.spatial[rank, :B].copy_(spatial)
        self.pool.scalar[rank, :B].copy_(scalar)
        self.pool.size[rank] = B
        self.pool.flag[rank] = 1

        # Signal + wait.
        self.pool.request_sem.release()
        self.pool.reply_sems[rank].acquire()

        # Clone the reply — the pool will be reused on the next call.
        logits = self.pool.logits[rank, :B].clone()
        values = self.pool.values[rank, :B].clone()
        return logits, values


def serve_shared_once(
    net,
    device: torch.device,
    pool: SharedPool,
    max_wait_s: float = 0.05,
) -> int:
    """Drain any pending requests, run one forward, release replies.

    Blocks up to `max_wait_s` for the first request. Returns the total
    row count served (0 if no requests arrived).
    """
    if not pool.request_sem.acquire(block=True, timeout=max_wait_s):
        return 0
    # Count additional ready signals non-blockingly.
    extra = 0
    while pool.request_sem.acquire(block=False):
        extra += 1
    want = 1 + extra

    # Scan flags; gather all ranks flagged 1.
    ranks: List[int] = []
    sizes: List[int] = []
    for r in range(pool.n_workers):
        if int(pool.flag[r]) == 1:
            ranks.append(r)
            sizes.append(int(pool.size[r]))
            if len(ranks) == want:
                break

    if not ranks:
        # Shouldn't happen (we acquired at least 1), but guard anyway.
        return 0

    spatial_chunks = [pool.spatial[r, :sizes[i]] for i, r in enumerate(ranks)]
    scalar_chunks = [pool.scalar[r, :sizes[i]] for i, r in enumerate(ranks)]
    spatial = torch.cat(spatial_chunks, dim=0).to(device, non_blocking=True)
    scalar = torch.cat(scalar_chunks, dim=0).to(device, non_blocking=True)

    net.eval()
    with torch.no_grad():
        logits, values = net(spatial, scalar)
    logits = logits.cpu()
    values = values.cpu()

    # Slice back and write into reply slots.
    offset = 0
    for r, size in zip(ranks, sizes):
        pool.logits[r, :size].copy_(logits[offset:offset + size])
        pool.values[r, :size].copy_(values[offset:offset + size])
        pool.flag[r] = 0
        pool.reply_sems[r].release()
        offset += size

    return int(offset)
