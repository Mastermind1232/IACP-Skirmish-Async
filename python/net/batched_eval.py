"""D9 — batched GPU evaluation pipeline.

Takes a list of GameStates, encodes them in parallel, stacks into
tensors, moves to the selected device, runs SkirboCNN forward, and
returns per-game (policy_logits, value).

This is the primitive every parallel game loop builds on: the AlphaZero
self-play loop in D10 collects states from N workers and calls
`batched_forward` once per eval-wave instead of N separate calls.
"""
from __future__ import annotations

from typing import Iterable, List, Optional, Sequence, Tuple

import torch

from python.encoding.encode import encode_state
from python.net.skirbo_cnn import BOARD_H, BOARD_W, SCALAR_DIM, SPATIAL_CHANNELS, SkirboCNN


def select_device(prefer: Optional[str] = None) -> torch.device:
    """Pick the best available device.

    Order: explicit override > CUDA > MPS (Apple Silicon) > CPU.
    """
    if prefer:
        return torch.device(prefer)
    if torch.cuda.is_available():
        return torch.device('cuda')
    if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')


def encode_batch(
    games: Sequence,
    povs: Sequence[int],
) -> Tuple[torch.Tensor, torch.Tensor]:
    """Encode N games into stacked tensors.

    Args:
        games: sequence of GameState objects (len N).
        povs: per-game POV values (len N), each 1 or 2.

    Returns:
        spatial: [N, 96, 32, 32] float32
        scalar:  [N, 1481]       float32
    """
    if len(games) != len(povs):
        raise ValueError(f'len(games)={len(games)} != len(povs)={len(povs)}')
    sp_list: List[torch.Tensor] = []
    sc_list: List[torch.Tensor] = []
    for game, pov in zip(games, povs):
        sp, sc = encode_state(game, pov)
        sp_list.append(sp)
        sc_list.append(sc)
    spatial = torch.stack(sp_list, dim=0)
    scalar = torch.stack(sc_list, dim=0)
    return spatial, scalar


@torch.no_grad()
def batched_forward(
    net: SkirboCNN,
    spatial: torch.Tensor,
    scalar: torch.Tensor,
    device: Optional[torch.device] = None,
) -> Tuple[torch.Tensor, torch.Tensor]:
    """Run net(spatial, scalar) on `device`, returning (policy, value) on CPU.

    Eval mode is forced (BN uses running stats). Gradients are not computed.
    """
    if device is None:
        device = next(net.parameters()).device
    net.eval()
    spatial = spatial.to(device, non_blocking=True)
    scalar = scalar.to(device, non_blocking=True)
    policy, value = net(spatial, scalar)
    return policy.detach().to('cpu'), value.detach().to('cpu')


class BatchEvaluator:
    """Convenience wrapper: holds a net + device, exposes one-shot
    `evaluate(games, povs)` that returns per-game (policy_logits, value).

    The CNN is moved to `device` on construction. BatchNorm layers switch
    to eval mode so single-sample batches don't explode.
    """

    def __init__(
        self,
        net: SkirboCNN,
        device: Optional[torch.device] = None,
    ) -> None:
        self.device = device or select_device()
        self.net = net.to(self.device)
        self.net.eval()

    def evaluate(
        self,
        games: Sequence,
        povs: Sequence[int],
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        spatial, scalar = encode_batch(games, povs)
        return batched_forward(self.net, spatial, scalar, self.device)

    def evaluate_tensors(
        self,
        spatial: torch.Tensor,
        scalar: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Skip the encode step — caller supplies pre-stacked tensors."""
        if spatial.dim() != 4 or spatial.shape[1:] != (SPATIAL_CHANNELS, BOARD_H, BOARD_W):
            raise ValueError(f'bad spatial shape {tuple(spatial.shape)}')
        if scalar.dim() != 2 or scalar.shape[1] != SCALAR_DIM:
            raise ValueError(f'bad scalar shape {tuple(scalar.shape)}')
        return batched_forward(self.net, spatial, scalar, self.device)
