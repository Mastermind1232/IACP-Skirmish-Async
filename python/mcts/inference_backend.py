"""D10 — inference backends for BatchedMCTS.

Two backends share a tiny interface so MCTS doesn't care who owns the GPU:

    class InferenceBackend:
        def evaluate(spatial, scalar) -> (logits, values)

LocalInferenceBackend: the usual case. Holds a net on some device, runs
forward in-process. Used by single-process training + tests.

RemoteInferenceBackend: for worker processes in the distributed-v2
architecture. Serializes (spatial, scalar) to a request queue; blocks
on a reply queue until the inference server returns (logits, values).
The server-side batches across all workers so every GPU forward is
maximally packed — the fix for the CUDA-context-time-slicing issue
we hit with the per-worker-GPU design.
"""
from __future__ import annotations

from typing import Any, Optional, Tuple

import torch


class InferenceBackend:
    """Duck-typed interface — subclasses implement evaluate()."""

    def evaluate(
        self,
        spatial: torch.Tensor,
        scalar: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Return (logits [B, n_policy], values [B, 1]) on CPU."""
        raise NotImplementedError


class LocalInferenceBackend(InferenceBackend):
    """Directly calls `net(spatial, scalar)` on `device`."""

    def __init__(self, net, device: Optional[torch.device] = None) -> None:
        self.net = net
        self.device = device or torch.device('cpu')
        self.net.eval()

    @torch.no_grad()
    def evaluate(
        self,
        spatial: torch.Tensor,
        scalar: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        sp = spatial.to(self.device, non_blocking=True)
        sc = scalar.to(self.device, non_blocking=True)
        logits, values = self.net(sp, sc)
        return logits.cpu(), values.cpu()


class RemoteInferenceBackend(InferenceBackend):
    """Sends (spatial, scalar) to a central inference server via queues.

    The request queue is shared across all worker processes. The reply
    queue is per-worker so responses are routed back to the caller.
    """

    def __init__(self, request_q, reply_q, worker_rank: int, req_id_seed: int = 0) -> None:
        self.request_q = request_q
        self.reply_q = reply_q
        self.worker_rank = worker_rank
        self._next_req_id = req_id_seed

    def evaluate(
        self,
        spatial: torch.Tensor,
        scalar: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        req_id = self._next_req_id
        self._next_req_id += 1
        self.request_q.put({
            'worker_rank': self.worker_rank,
            'req_id': req_id,
            'spatial': spatial,
            'scalar': scalar,
        })
        # Block until the server responds with our req_id. In practice
        # the server processes requests in FIFO + batching order, but
        # individual replies may interleave across workers; each worker's
        # reply_q is dedicated, so req_id ordering within one worker is
        # all we need to guard against (and it's sequential here).
        reply = self.reply_q.get()
        if reply.get('req_id') != req_id:
            raise RuntimeError(
                f'worker {self.worker_rank}: req_id mismatch '
                f'expected={req_id} got={reply.get("req_id")}'
            )
        return reply['logits'], reply['values']
