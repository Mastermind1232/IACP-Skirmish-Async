"""Skirbo dueling-DQN + policy-head network — PyTorch port of tests/headless/learnings.js.

JS source-of-truth architecture (constants):
  NUM_FEATURES = 50, HIDDEN_SIZE = 64, NUM_ACTIONS = 23
  Trunk: h = ReLU(W1 @ x + b1)                   (W1: [HIDDEN, NUM_FEATURES])
  Value: V = Wv @ h + bv                          (Wv: [HIDDEN], bv scalar)
  Advantage: A = Wa @ h + ba                      (Wa: [NUM_ACTIONS, HIDDEN])
  Dueling: Q = V + A - mean(A)
  Policy:  P = softmax(Wp @ h + bp)               (Wp: [NUM_ACTIONS, HIDDEN])

Weight conversion JS<->PyTorch:
  JS W1[j][i]  <-> trunk.weight[j, i]      ;  b1[j]   <-> trunk.bias[j]
  JS Wv[j]     <-> value.weight[0, j]      ;  bv      <-> value.bias[0]
  JS Wa[k][j]  <-> advantage.weight[k, j]  ;  ba[k]   <-> advantage.bias[k]
  JS Wp[k][j]  <-> policy.weight[k, j]     ;  bp[k]   <-> policy.bias[k]

Enlargement (e.g. 64->256 hidden): JS weights copied into upper-left block,
remainder He/Xavier re-initialized. Preserves JS-checkpoint behavior until
fine-tuning exercises the extra capacity.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F


NUM_FEATURES_DEFAULT = 50
HIDDEN_DEFAULT = 64
NUM_ACTIONS_DEFAULT = 23


@dataclass
class NetConfig:
    n_features: int = NUM_FEATURES_DEFAULT
    hidden: int = HIDDEN_DEFAULT
    n_actions: int = NUM_ACTIONS_DEFAULT

    def to_dict(self) -> dict:
        return {"n_features": self.n_features, "hidden": self.hidden, "n_actions": self.n_actions}


class SkirboNet(nn.Module):
    """Dueling net with shared trunk + value/advantage/policy heads.

    Forward returns (Q, V_raw, policy_logits). V_raw is pre-tanh; training loss
    applies tanh when computing value MSE so it matches JS `policyUpdate` (which
    tanh-squashes for loss only).
    """

    def __init__(self, config: NetConfig | None = None):
        super().__init__()
        self.config = config or NetConfig()
        c = self.config
        self.trunk = nn.Linear(c.n_features, c.hidden)
        self.value = nn.Linear(c.hidden, 1)
        self.advantage = nn.Linear(c.hidden, c.n_actions)
        self.policy = nn.Linear(c.hidden, c.n_actions)
        self._init_weights()

    def _init_weights(self) -> None:
        c = self.config
        he_std = math.sqrt(2.0 / c.n_features)
        xavier_v = math.sqrt(2.0 / (c.hidden + 1))
        xavier_a = math.sqrt(2.0 / (c.hidden + c.n_actions))
        xavier_p = xavier_a
        with torch.no_grad():
            nn.init.normal_(self.trunk.weight, 0.0, he_std)
            nn.init.zeros_(self.trunk.bias)
            nn.init.normal_(self.value.weight, 0.0, xavier_v)
            nn.init.zeros_(self.value.bias)
            nn.init.normal_(self.advantage.weight, 0.0, xavier_a)
            nn.init.zeros_(self.advantage.bias)
            nn.init.normal_(self.policy.weight, 0.0, xavier_p)
            nn.init.zeros_(self.policy.bias)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        h = F.relu(self.trunk(x))
        v_raw = self.value(h).squeeze(-1)
        a = self.advantage(h)
        q = v_raw.unsqueeze(-1) + a - a.mean(dim=-1, keepdim=True)
        logits = self.policy(h)
        return q, v_raw, logits


# -- JSON (JS format) I/O ----------------------------------------------------

def _copy_block(target: torch.Tensor, source: list, max_rows: int, max_cols: int | None = None) -> None:
    if max_cols is None:
        n = min(len(source), max_rows)
        for i in range(n):
            target[i] = float(source[i])
        return
    rows = min(len(source), max_rows)
    for j in range(rows):
        row = source[j]
        cols = min(len(row), max_cols)
        for i in range(cols):
            target[j, i] = float(row[i])


def load_js_network(net: SkirboNet, js_network: dict, *, strict: bool = False) -> dict:
    """Copy a JS learnings.network dict into a SkirboNet in place.

    JS layout:
        W1: [HIDDEN][NUM_FEATURES]   b1: [HIDDEN]
        Wv: [HIDDEN]                 bv: scalar
        Wa: [NUM_ACTIONS][HIDDEN]    ba: [NUM_ACTIONS]
        Wp: [NUM_ACTIONS][HIDDEN]    bp: [NUM_ACTIONS]    (optional - Phase C)

    If `strict`, raises on size mismatch. Otherwise copies upper-left block and
    leaves extra rows/cols at their init values (enlargement mode).
    """
    c = net.config
    w1 = js_network.get("W1"); b1 = js_network.get("b1")
    wv = js_network.get("Wv"); bv = js_network.get("bv", 0.0)
    wa = js_network.get("Wa"); ba = js_network.get("ba")
    wp = js_network.get("Wp"); bp = js_network.get("bp")

    if strict:
        if len(w1) != c.hidden or len(w1[0]) != c.n_features:
            raise ValueError(f"W1 shape {len(w1)}x{len(w1[0])} != {c.hidden}x{c.n_features}")
        if len(wa) != c.n_actions or len(wa[0]) != c.hidden:
            raise ValueError(f"Wa shape {len(wa)}x{len(wa[0])} != {c.n_actions}x{c.hidden}")

    info = {
        "src_hidden": len(w1),
        "src_n_features": len(w1[0]),
        "src_n_actions": len(wa),
        "has_policy": wp is not None and bp is not None,
    }

    with torch.no_grad():
        _copy_block(net.trunk.weight, w1, c.hidden, c.n_features)
        _copy_block(net.trunk.bias, b1, c.hidden)

        for j in range(min(len(wv), c.hidden)):
            net.value.weight[0, j] = float(wv[j])
        net.value.bias[0] = float(bv)

        _copy_block(net.advantage.weight, wa, c.n_actions, c.hidden)
        _copy_block(net.advantage.bias, ba, c.n_actions)

        if wp is not None and bp is not None:
            _copy_block(net.policy.weight, wp, c.n_actions, c.hidden)
            _copy_block(net.policy.bias, bp, c.n_actions)

    return info


def export_js_network(net: SkirboNet) -> dict:
    """Export a SkirboNet as a JS-format network dict."""
    W1 = net.trunk.weight.detach().cpu().tolist()
    b1 = net.trunk.bias.detach().cpu().tolist()
    Wv = net.value.weight.detach().cpu()[0].tolist()
    bv = float(net.value.bias.detach().cpu()[0])
    Wa = net.advantage.weight.detach().cpu().tolist()
    ba = net.advantage.bias.detach().cpu().tolist()
    Wp = net.policy.weight.detach().cpu().tolist()
    bp = net.policy.bias.detach().cpu().tolist()
    return {
        "W1": W1, "b1": b1,
        "Wv": Wv, "bv": bv,
        "Wa": Wa, "ba": ba,
        "Wp": Wp, "bp": bp,
    }


def load_learnings_file(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def write_learnings_network(src_path: str, dst_path: str, network: dict) -> None:
    """Read src learnings, replace .network, write to dst. Preserves other top-
    level keys (replay buffer, stats, etc.) so downstream JS loader still works.
    """
    data = load_learnings_file(src_path)
    data["network"] = network
    with open(dst_path, "w") as f:
        json.dump(data, f)


# -- Forward-pass parity helper (for tests) ----------------------------------

def forward_sample(net: SkirboNet, features: list[float]) -> dict:
    """Single-sample forward pass for parity testing vs JS `forwardPass`."""
    net.train(False)
    with torch.no_grad():
        x = torch.tensor([features], dtype=torch.float32)
        q, v_raw, logits = net(x)
        p = F.softmax(logits, dim=-1)
    return {
        "Q": q[0].cpu().tolist(),
        "V": float(v_raw[0].cpu()),
        "V_tanh": float(torch.tanh(v_raw[0]).cpu()),
        "P": p[0].cpu().tolist(),
    }
