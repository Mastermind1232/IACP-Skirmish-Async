# Skirbo PyTorch Training (Phase D)

GPU training pipeline for the AlphaZero-Skirbo network. JavaScript remains the
source of truth for feature extraction, simulator, and inference; Python handles
the heavy training lift.

## Data flow

```
[JS] mcts-selfplay.js            ->  /tmp/buf.json     (policy buffer)
[JS] checkpoint (learnings.json) ->  python/train_policy.py
                                           |
                                           v
                               GPU training (Adam + joint loss)
                                           |
                                           v
[PY] write_learnings_network    ->  /tmp/ckpt-pytorch.json
[JS] eval-ladder.js / mcts.js   <-  loads same format
```

## Files
- `skirbo_net.py` — `SkirboNet` (PyTorch nn.Module mirroring JS dueling+policy
  architecture) + JS<->PyTorch weight converters.
- `train_policy.py` — joint CE + value-MSE + entropy trainer. Reads a policy
  buffer JSON, trains, writes a refreshed learnings JSON.
- `test_roundtrip.py` — parity check: JS `getFullQ` vs PyTorch `forward`
  within float32 tolerance.
- `requirements.txt` — minimal deps (just torch).

## Parity verification

```
python python/test_roundtrip.py tests/headless/learnings-data.json
```

Confirms PyTorch forward-pass matches JS within 1e-4 for Q/V and 1e-5 for P.

## Training a checkpoint

```
python python/train_policy.py \
    --learnings tests/headless/learnings-data.json \
    --buffer /tmp/warmup-buf.json \
    --output /tmp/warmup-ckpt-pytorch.json \
    --epochs 20 --batch 256 --lr 3e-4
```

Auto-detects GPU (CUDA) when available; falls back to CPU.

### Enlargement (64 -> 256 hidden)

```
python python/train_policy.py ... --hidden 256
```

Copies 64-hidden JS weights into the upper-left block of a 256-hidden PyTorch
net; remaining rows/cols are He/Xavier re-initialized. Note: JS does not yet
support loading a 256-hidden checkpoint — treat these as PyTorch-only weights
until a JS-side enlargement lands.

## Value-head caveat

The value head only learns when the buffer contains a mix of z outcomes. A
buffer of all-draws (z=0) gives no value signal; the head saturates and the
trainer logs a warning. Use an asymmetric headless-training run (e.g.
`--mcts-side=1`) to guarantee decisive outcomes.
