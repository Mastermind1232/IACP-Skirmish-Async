"""D10 — central-GPU inference server.

Pulls (spatial, scalar) requests off a shared request queue, batches
across all in-flight workers, runs one CNN forward pass on the GPU,
and routes the per-request (logits, value) slice back to each worker
via its dedicated reply queue.

Batching strategy: pop the first request (blocking, with a short
timeout so we can poll a stop flag), then drain the queue
non-blockingly up to `max_batch` requests before dispatching. This
gives maximum batch size when multiple workers are simultaneously
stalled on an eval, and minimum latency when only one worker is live.
"""
from __future__ import annotations

from queue import Empty
from typing import Dict, List, Optional

import torch


def serve_inference_once(
    net,
    device: torch.device,
    request_q,
    reply_qs: List,
    max_batch: int = 128,
    poll_timeout_s: float = 0.05,
    use_amp: bool = False,
) -> int:
    """Pull one mega-batch worth of requests, run one forward, reply.

    Each request from a worker already contains a batched (spatial,
    scalar) of shape [B_i, ...] (where B_i is that worker's local
    batch size, usually games_per_worker). We concatenate across
    requests until total rows reach `max_batch`, run ONE GPU forward,
    then slice the output back per-request.

    Returns total rows served (0 if no requests arrived).
    """
    try:
        first = request_q.get(timeout=poll_timeout_s)
    except Empty:
        return 0

    batch_requests = [first]
    total_rows = int(first['spatial'].shape[0])
    while total_rows < max_batch:
        try:
            req = request_q.get_nowait()
        except Empty:
            break
        batch_requests.append(req)
        total_rows += int(req['spatial'].shape[0])

    spatial = torch.cat([r['spatial'] for r in batch_requests], dim=0).to(
        device, non_blocking=True,
    )
    scalar = torch.cat([r['scalar'] for r in batch_requests], dim=0).to(
        device, non_blocking=True,
    )

    net.eval()
    with torch.no_grad():
        if use_amp and device.type == 'cuda':
            with torch.autocast(device_type='cuda', dtype=torch.float16):
                logits, values = net(spatial, scalar)
            logits = logits.float()
            values = values.float()
        else:
            logits, values = net(spatial, scalar)
    logits = logits.cpu()
    values = values.cpu()

    # Slice per-request.
    offset = 0
    for req in batch_requests:
        size = int(req['spatial'].shape[0])
        reply_qs[req['worker_rank']].put({
            'req_id': req['req_id'],
            'logits': logits[offset:offset + size],
            'values': values[offset:offset + size],
        })
        offset += size

    return total_rows


def run_inference_server(
    net,
    device: torch.device,
    request_q,
    reply_qs: List,
    stop_event,
    max_batch: int = 64,
    poll_timeout_s: float = 0.05,
) -> None:
    """Serve requests until `stop_event` is set.

    Designed to run on the main (trainer) process between training
    phases. The trainer can also interleave training steps with
    inference serving by calling `serve_inference_once` directly in
    its own loop — this helper exists for when the trainer wants a
    dedicated inference-only window.
    """
    while not stop_event.is_set():
        serve_inference_once(net, device, request_q, reply_qs, max_batch, poll_timeout_s)
