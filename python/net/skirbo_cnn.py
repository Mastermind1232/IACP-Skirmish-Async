"""D8 — AlphaZero-style CNN for the D7 tensor encoding.

Inputs:
    spatial: [B, C=96, H=32, W=32] float32
    scalar:  [B, S=1481]           float32

Outputs:
    policy_logits: [B, n_policy]
    value:         [B, 1]  in (-1, 1) via tanh

Architecture (standard AlphaZero template):
    - Project scalar to a small embedding, tile to [B, E, H, W], concat
      with spatial along the channel axis so global context flows into
      the conv trunk.
    - Conv stem (C+E -> n_channels), BN, ReLU.
    - N residual blocks of Conv3x3 -> BN -> ReLU -> Conv3x3 -> BN + skip.
    - Policy head: 1x1 conv -> 2 channels -> flatten -> Linear -> n_policy.
    - Value head:  1x1 conv -> 1 channel  -> flatten -> Linear(H*W -> 256)
                   -> ReLU -> Linear(256 -> 1) -> tanh.

Action-space size is a placeholder — see `DEFAULT_N_POLICY`. The AlphaZero
loop will mask illegal actions before softmax.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


SPATIAL_CHANNELS = 96
BOARD_H = 32
BOARD_W = 32
SCALAR_DIM = 1481

DEFAULT_N_POLICY = 4096
DEFAULT_CHANNELS = 128
DEFAULT_N_RES_BLOCKS = 6
DEFAULT_SCALAR_EMBED = 64
DEFAULT_VALUE_HIDDEN = 256
POLICY_HEAD_CHANNELS = 2
VALUE_HEAD_CHANNELS = 1


@dataclass
class CNNConfig:
    n_channels: int = DEFAULT_CHANNELS
    n_res_blocks: int = DEFAULT_N_RES_BLOCKS
    scalar_embed: int = DEFAULT_SCALAR_EMBED
    value_hidden: int = DEFAULT_VALUE_HIDDEN
    n_policy: int = DEFAULT_N_POLICY


class ResBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = F.relu(self.bn1(self.conv1(x)))
        h = self.bn2(self.conv2(h))
        return F.relu(h + x)


class SkirboCNN(nn.Module):
    def __init__(self, config: CNNConfig | None = None):
        super().__init__()
        self.config = config or CNNConfig()
        c = self.config

        # Scalar -> small spatial-broadcast embedding.
        self.scalar_proj = nn.Linear(SCALAR_DIM, c.scalar_embed)

        # Stem.
        stem_in = SPATIAL_CHANNELS + c.scalar_embed
        self.stem_conv = nn.Conv2d(stem_in, c.n_channels, 3, padding=1, bias=False)
        self.stem_bn = nn.BatchNorm2d(c.n_channels)

        # Residual trunk.
        self.res_blocks = nn.ModuleList([ResBlock(c.n_channels) for _ in range(c.n_res_blocks)])

        # Policy head: 1x1 conv -> flatten -> Linear.
        self.policy_conv = nn.Conv2d(c.n_channels, POLICY_HEAD_CHANNELS, 1, bias=False)
        self.policy_bn = nn.BatchNorm2d(POLICY_HEAD_CHANNELS)
        self.policy_fc = nn.Linear(POLICY_HEAD_CHANNELS * BOARD_H * BOARD_W, c.n_policy)

        # Value head: 1x1 conv -> flatten -> Linear -> ReLU -> Linear -> tanh.
        self.value_conv = nn.Conv2d(c.n_channels, VALUE_HEAD_CHANNELS, 1, bias=False)
        self.value_bn = nn.BatchNorm2d(VALUE_HEAD_CHANNELS)
        self.value_fc1 = nn.Linear(VALUE_HEAD_CHANNELS * BOARD_H * BOARD_W, c.value_hidden)
        self.value_fc2 = nn.Linear(c.value_hidden, 1)

    def _fuse_inputs(self, spatial: torch.Tensor, scalar: torch.Tensor) -> torch.Tensor:
        """Project scalar -> [B, scalar_embed], broadcast-tile to
        [B, scalar_embed, H, W], concat with spatial along channel dim."""
        B = spatial.shape[0]
        s = F.relu(self.scalar_proj(scalar))                        # [B, E]
        s = s.view(B, -1, 1, 1).expand(-1, -1, BOARD_H, BOARD_W)    # [B, E, H, W]
        return torch.cat([spatial, s], dim=1)

    def forward(self, spatial: torch.Tensor, scalar: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        x = self._fuse_inputs(spatial, scalar)
        x = F.relu(self.stem_bn(self.stem_conv(x)))
        for block in self.res_blocks:
            x = block(x)

        p = F.relu(self.policy_bn(self.policy_conv(x)))
        policy_logits = self.policy_fc(p.flatten(1))

        v = F.relu(self.value_bn(self.value_conv(x)))
        v = F.relu(self.value_fc1(v.flatten(1)))
        value = torch.tanh(self.value_fc2(v))
        return policy_logits, value

    def num_params(self) -> int:
        return sum(p.numel() for p in self.parameters())
