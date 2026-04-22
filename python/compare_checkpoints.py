"""Compare two JS learnings checkpoints on probe states.

Reads two checkpoints, feeds the same probe features through both, and reports:
  - max / mean |diff| on Q values
  - V delta (pre- and post-tanh)
  - P distribution entropy + top-action
  - Trunk weight stats (norm, max |dW1|)

Use this to verify weight changes after GPU training are visible at inference time.

Usage:
    python python/compare_checkpoints.py <ckpt_a.json> <ckpt_b.json>
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).parent))
from skirbo_net import NetConfig, SkirboNet, load_js_network


# Probe states from tests/headless/learnings.js PROBE_STATES
PROBE_STATES = [
    [0, 0.9, 0.9, 0, 0.5, 0, 0.7, 0.8, 0.2, 0.5, 1, 0, 0.5, 1, 0.3, 0.2,
     0.8, 0.8, 0, 0, 0, 0, 0.5, 0.5, 0.33, 0.33, 0.2, 0.2, 0, 0, 0, 0, 0,
     1, 0.75, 0.75, 1.0, 0.5, 0.54, 0.08, 0.3, 0, 0, 0.67, 0, 1, 0, 0, 0, 0],
    [0.25, 0.8, 0.5, 0.3, 0.57, 0.14, 0.8, 0.9, 0.6, 0.6, 1, 0, 0.7, 1, 0.4,
     0.3, 0.7, 0.4, 0.25, 0, 0, 0, 0.33, 0.33, 0.5, 0.25, 0.5, 0.33, 0.1,
     0, 0.125, 0, 0, 1, 0.5, 0.75, 0.8, 0.63, 0.29, 0.42, 0.7, 0, 1, 0.33,
     0, 0.5, 0, 0, 0, 0],
    [-0.25, 0.4, 0.7, -0.3, 0.43, -0.14, 0.9, 0.9, 0.8, 0.4, 1, 0, 0.4, 1,
     0.6, 0.5, 0.3, 0.7, 0, 0.25, 0.25, 0, 0.17, 0.5, 0.25, 0.5, 0.67, 0.33,
     -0.2, 0.125, 0, 0, 0, 0, 0.9, 0.5, 0.3, 0.5, 0.54, 0.08, 0.8, 1, 0,
     0.33, 0.33, 0, 0, 0, 0, 0],
]
PROBE_NAMES = ["EARLY_GAME_COMBAT", "MID_GAME_WINNING", "LATE_GAME_LOSING"]


def load_net(path: str) -> SkirboNet:
    with open(path) as f:
        data = json.load(f)
    n = data["network"]
    cfg = NetConfig(
        n_features=len(n["W1"][0]),
        hidden=len(n["W1"]),
        n_actions=len(n["Wa"]),
    )
    net = SkirboNet(cfg)
    info = load_js_network(net, n)
    net.train(False)
    return net, info


def entropy(probs: list[float]) -> float:
    return -sum(p * math.log(p + 1e-12) for p in probs)


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <ckpt_a.json> <ckpt_b.json>")
        return 1
    path_a, path_b = sys.argv[1], sys.argv[2]
    print(f"A: {path_a}")
    print(f"B: {path_b}")
    net_a, info_a = load_net(path_a)
    net_b, info_b = load_net(path_b)
    print(f"A info: {info_a}")
    print(f"B info: {info_b}")
    print()

    # Weight-space deltas — handle shape mismatch (e.g., 64 → 128 enlargement).
    w1_a = net_a.trunk.weight
    w1_b = net_b.trunk.weight
    if w1_a.shape == w1_b.shape:
        dw1 = (w1_b - w1_a).abs()
        print(f"Trunk W1 delta: max={dw1.max().item():.4e} mean={dw1.mean().item():.4e} "
              f"L2={(w1_b - w1_a).norm().item():.4e}")
    else:
        h_min = min(w1_a.shape[0], w1_b.shape[0])
        dw1 = (w1_b[:h_min] - w1_a[:h_min]).abs()
        print(f"Trunk W1 [shape mismatch A={tuple(w1_a.shape)} B={tuple(w1_b.shape)}]")
        print(f"  overlap[0:{h_min}] delta: max={dw1.max().item():.4e} mean={dw1.mean().item():.4e}")
        if w1_b.shape[0] > h_min:
            new_rows = w1_b[h_min:]
            print(f"  new rows[{h_min}:{w1_b.shape[0]}] |W| mean={new_rows.abs().mean().item():.4e}")

    if net_a.config.n_actions == net_b.config.n_actions:
        wp_a = net_a.policy.weight
        wp_b = net_b.policy.weight
        if wp_a.shape == wp_b.shape:
            dwp = (wp_b - wp_a).abs()
            print(f"Policy Wp delta: max={dwp.max().item():.4e} mean={dwp.mean().item():.4e} "
                  f"L2={(wp_b - wp_a).norm().item():.4e}")
        else:
            h_min = min(wp_a.shape[1], wp_b.shape[1])
            dwp = (wp_b[:, :h_min] - wp_a[:, :h_min]).abs()
            print(f"Policy Wp [shape mismatch A={tuple(wp_a.shape)} B={tuple(wp_b.shape)}]")
            print(f"  overlap[:, :{h_min}] delta: max={dwp.max().item():.4e} mean={dwp.mean().item():.4e}")
        print(f"Wp L2 norms: A={wp_a.norm().item():.4e} B={wp_b.norm().item():.4e}")

    print()
    for name, features in zip(PROBE_NAMES, PROBE_STATES):
        x = torch.tensor([features], dtype=torch.float32)
        with torch.no_grad():
            qa, va, la_ = net_a(x)
            qb, vb, lb = net_b(x)
            pa = F.softmax(la_, dim=-1)
            pb = F.softmax(lb, dim=-1)
        qa_l = qa[0].tolist(); qb_l = qb[0].tolist()
        pa_l = pa[0].tolist(); pb_l = pb[0].tolist()

        top_a = sorted(enumerate(qa_l), key=lambda kv: -kv[1])[:3]
        top_b = sorted(enumerate(qb_l), key=lambda kv: -kv[1])[:3]
        top_pa = sorted(enumerate(pa_l), key=lambda kv: -kv[1])[:3]
        top_pb = sorted(enumerate(pb_l), key=lambda kv: -kv[1])[:3]

        q_diff = max(abs(a - b) for a, b in zip(qa_l, qb_l))
        v_diff = abs(float(va.item()) - float(vb.item()))
        p_diff = max(abs(a - b) for a, b in zip(pa_l, pb_l))

        print(f"=== {name} ===")
        print(f"  V: A={float(va.item()):+.3f} (tanh={math.tanh(float(va.item())):+.3f})  "
              f"B={float(vb.item()):+.3f} (tanh={math.tanh(float(vb.item())):+.3f})  "
              f"|diff|={v_diff:.3e}")
        print(f"  Q diff max={q_diff:.3e}   top-3 A:{[(k, f'{v:.2f}') for k,v in top_a]}")
        print(f"  {' '*25}           B:{[(k, f'{v:.2f}') for k,v in top_b]}")
        print(f"  P diff max={p_diff:.3e}   entropy A={entropy(pa_l):.3f} B={entropy(pb_l):.3f}")
        print(f"  top-3 P A:{[(k, f'{v:.3f}') for k,v in top_pa]}")
        print(f"  top-3 P B:{[(k, f'{v:.3f}') for k,v in top_pb]}")
        same_top = top_a[0][0] == top_b[0][0]
        same_top_p = top_pa[0][0] == top_pb[0][0]
        print(f"  argmax(Q) same: {same_top} (A={top_a[0][0]} B={top_b[0][0]})  "
              f"argmax(P) same: {same_top_p} (A={top_pa[0][0]} B={top_pb[0][0]})")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
