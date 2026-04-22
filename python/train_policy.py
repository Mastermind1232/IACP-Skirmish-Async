"""Joint CE + value-MSE + entropy trainer — PyTorch port of learnings.js policyUpdate.

Reads a policy buffer JSON (from mcts-selfplay.js `savePolicyBuffer`), trains the
network via Adam with mini-batches on GPU (or CPU fallback), writes a refreshed
learnings JSON back out so JS can load it unchanged.

Loss (matches JS, with Adam replacing raw SGD):
    L = CE(pi, softmax(Wp h + bp))
      + lambda_v * (tanh(V) - z)^2
      - beta * H(softmax(Wp h + bp))

Usage:
    python python/train_policy.py \
        --learnings tests/headless/learnings-data.json \
        --buffer /tmp/warmup-buf.json \
        --output /tmp/warmup-ckpt-pytorch.json \
        --epochs 20 --batch 256 --lr 3e-4 --hidden 64

Enlargement: pass --hidden 256 to load a 64-hidden JS net into a 256-hidden
PyTorch net (block-copies, remainder randomly init'd).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "python"))

from skirbo_net import (  # noqa: E402
    NetConfig,
    SkirboNet,
    export_js_network,
    load_js_network,
    load_learnings_file,
    write_learnings_network,
)


class PolicyBufferDataset(Dataset):
    """Serves (features, piTarget, z, weight) tuples. Filters out unfinished samples
    (z is None) so training only sees finalized outcomes. When class_weight_z is True,
    per-sample weight = inverse frequency of that sample's z class (normalized so
    sum(weight) == n_samples). Otherwise weight is 1.0 for all samples."""

    def __init__(self, samples: list[dict], *, require_z: bool = True,
                 class_weight_z: bool = False):
        self.samples = [s for s in samples if not require_z or s.get("z") is not None]
        if not self.samples:
            raise ValueError("No samples with z != None in buffer — cannot train value head.")
        self.n_features = len(self.samples[0]["features"])
        self.n_actions = len(self.samples[0]["piTarget"])

        if class_weight_z:
            z_counts: dict[int, int] = {}
            for s in self.samples:
                zi = int(s["z"])
                z_counts[zi] = z_counts.get(zi, 0) + 1
            n_total = sum(z_counts.values())
            n_classes = len(z_counts)
            self.class_weights = {zi: n_total / (n_classes * c) for zi, c in z_counts.items()}
        else:
            self.class_weights = None

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int):
        s = self.samples[idx]
        if self.class_weights is not None:
            w = self.class_weights[int(s["z"])]
        else:
            w = 1.0
        return (
            torch.tensor(s["features"], dtype=torch.float32),
            torch.tensor(s["piTarget"], dtype=torch.float32),
            torch.tensor(float(s["z"]), dtype=torch.float32),
            torch.tensor(w, dtype=torch.float32),
        )


def joint_loss(
    logits: torch.Tensor,
    v_raw: torch.Tensor,
    pi_target: torch.Tensor,
    z: torch.Tensor,
    weight: torch.Tensor,
    *,
    lambda_v: float,
    beta: float,
) -> tuple[torch.Tensor, dict[str, float]]:
    """Port of JS policyUpdate loss. Returns (loss, metrics). `weight` is a per-sample
    scalar applied to the value MSE term only (CE/entropy stay unweighted — piTarget
    distribution is not class-imbalanced)."""
    log_probs = F.log_softmax(logits, dim=-1)
    probs = log_probs.exp()

    ce = -(pi_target * log_probs).sum(dim=-1).mean()
    entropy = -(probs * log_probs).sum(dim=-1).mean()

    v_tanh = torch.tanh(v_raw)
    sq_err = (v_tanh - z) ** 2
    w_sum = weight.sum().clamp_min(1e-8)
    mse = (weight * sq_err).sum() / w_sum

    loss = ce + lambda_v * mse - beta * entropy
    return loss, {
        "ce": float(ce.item()),
        "mse": float(mse.item()),
        "entropy": float(entropy.item()),
        "loss": float(loss.item()),
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--learnings", required=True, help="Source learnings JSON (for network init).")
    p.add_argument("--buffer", required=True, help="Policy buffer JSON from savePolicyBuffer.")
    p.add_argument("--output", required=True, help="Destination learnings JSON (with trained network).")
    p.add_argument("--epochs", type=int, default=20)
    p.add_argument("--batch", type=int, default=256)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--lambda-v", type=float, default=0.25)
    p.add_argument("--beta", type=float, default=0.001)
    p.add_argument("--hidden", type=int, default=None,
                   help="Override hidden dim (enlargement if > source; default: match source).")
    p.add_argument("--device", default="auto", help="auto|cpu|cuda")
    p.add_argument("--log-every", type=int, default=50, help="Log every N batches.")
    p.add_argument("--require-z", action="store_true", default=True,
                   help="Filter unfinished samples (default true).")
    p.add_argument("--class-weight-z", action="store_true", default=False,
                   help="Weight value-MSE by inverse z-class frequency. Default: off.")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if args.device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        device = args.device
    print(f"Device: {device}")
    if device == "cuda":
        print(f"  GPU: {torch.cuda.get_device_name(0)}")

    print(f"Loading learnings: {args.learnings}")
    learnings = load_learnings_file(args.learnings)
    src_net = learnings["network"]
    src_hidden = len(src_net["W1"])
    src_features = len(src_net["W1"][0])
    src_actions = len(src_net["Wa"])
    print(f"  source net: hidden={src_hidden} features={src_features} actions={src_actions} "
          f"has_policy={'Wp' in src_net and 'bp' in src_net}")

    print(f"Loading buffer: {args.buffer}")
    with open(args.buffer) as f:
        buf = json.load(f)
    samples = buf["samples"]
    print(f"  {len(samples)} samples in buffer")

    ds = PolicyBufferDataset(samples, require_z=args.require_z,
                              class_weight_z=args.class_weight_z)
    print(f"  {len(ds)} samples with z != None (features={ds.n_features} actions={ds.n_actions})")
    if ds.class_weights is not None:
        print(f"  class-weight-z: {ds.class_weights}")

    if ds.n_features != src_features:
        raise ValueError(f"Feature-dim mismatch: buffer={ds.n_features} net={src_features}")
    if ds.n_actions != src_actions:
        raise ValueError(f"Action-dim mismatch: buffer={ds.n_actions} net={src_actions}")

    tgt_hidden = args.hidden or src_hidden
    if tgt_hidden != src_hidden:
        print(f"  ENLARGEMENT: hidden {src_hidden} -> {tgt_hidden}")
    cfg = NetConfig(n_features=src_features, hidden=tgt_hidden, n_actions=src_actions)
    net = SkirboNet(cfg)
    load_info = load_js_network(net, src_net, strict=(tgt_hidden == src_hidden))
    print(f"  loaded JS -> PyTorch: {load_info}")
    net = net.to(device)

    opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    loader = DataLoader(
        ds, batch_size=args.batch, shuffle=True, drop_last=False,
        num_workers=0, pin_memory=(device == "cuda"),
    )

    # Check z distribution — log once so operator sees when value signal is absent.
    z_counts = {-1: 0, 0: 0, 1: 0}
    for s in ds.samples:
        z_counts[int(s["z"])] = z_counts.get(int(s["z"]), 0) + 1
    print(f"  z distribution: {z_counts}  "
          f"(value head can only learn when at least two classes are present)")

    print(f"\nTraining: epochs={args.epochs} batch={args.batch} lr={args.lr} "
          f"wd={args.weight_decay} lambda_v={args.lambda_v} beta={args.beta}")
    t0 = time.time()
    net.train(True)
    step = 0
    for epoch in range(1, args.epochs + 1):
        ep_ce = ep_mse = ep_ent = ep_loss = 0.0
        nb = 0
        for features, pi, z, weight in loader:
            features = features.to(device, non_blocking=True)
            pi = pi.to(device, non_blocking=True)
            z = z.to(device, non_blocking=True)
            weight = weight.to(device, non_blocking=True)

            _q, v_raw, logits = net(features)
            loss, metrics = joint_loss(
                logits, v_raw, pi, z, weight,
                lambda_v=args.lambda_v, beta=args.beta,
            )
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), max_norm=5.0)
            opt.step()

            ep_ce += metrics["ce"]; ep_mse += metrics["mse"]
            ep_ent += metrics["entropy"]; ep_loss += metrics["loss"]
            nb += 1; step += 1
            if step % args.log_every == 0:
                print(f"  step {step:5d}  ep {epoch:3d}  "
                      f"ce={metrics['ce']:.4f} mse={metrics['mse']:.4f} "
                      f"ent={metrics['entropy']:.4f} loss={metrics['loss']:.4f}")
        nb = max(nb, 1)
        print(f"epoch {epoch:3d}/{args.epochs}  "
              f"ce={ep_ce/nb:.4f} mse={ep_mse/nb:.4f} ent={ep_ent/nb:.4f} "
              f"loss={ep_loss/nb:.4f}  [{time.time()-t0:.1f}s]")

    print(f"\nDone in {time.time()-t0:.1f}s. Exporting network...")
    net_out = export_js_network(net)
    # Only write back network weights at the SOURCE shape. If we enlarged,
    # caller must use the PyTorch side to run inference (JS can't yet handle
    # mismatched dims). For now, insist the output shape matches source or
    # warn loudly.
    out_hidden = len(net_out["W1"])
    if out_hidden != src_hidden:
        print(f"NOTE: output hidden={out_hidden} != source={src_hidden}. "
              f"JS learnings.js auto-migrates 64-hidden checkpoints on load "
              f"(see learnings.js:5152 migrateLearnings), so the output can be "
              f"consumed by JS as-is when HIDDEN_SIZE matches the output.")
    write_learnings_network(args.learnings, args.output, net_out)
    print(f"Saved: {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
