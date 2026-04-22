#!/usr/bin/env bash
# v5-h128: capacity bump 64→128 via PyTorch block-copy from v3 weights.
# Same decisive buffer (buf-v4-merged.json, 8861 samples) as v4/v4b, no class-weight.
# Lane J (64→96 DQN) failed earlier; this probes whether MCTS supervised regime
# behaves differently. HIDDEN_SIZE=128 already bumped in tests/headless/learnings.js.
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
V3_CKPT="${CKPT_DIR}/warmed-20e-v3-lambda05.json"
V4_MERGED="${CKPT_DIR}/buf-v4-merged.json"
V5_CKPT="${CKPT_DIR}/warmed-20e-v5-h128.json"
ORIG="tests/headless/learnings-data.json"

echo "=== [1/3] Train v5-h128 (20ep, λ_v=0.5, hidden=128 block-copy from v3) ==="
python3 python/train_policy.py \
  --learnings "$V3_CKPT" \
  --buffer "$V4_MERGED" \
  --output "$V5_CKPT" \
  --epochs 20 --batch 256 --lr 3e-4 --lambda-v 0.5 --hidden 128 --device cpu

echo ""
echo "=== [2/3] Compare v3 (64h) vs v5 (128h) — expect mismatch warning ==="
python3 python/compare_checkpoints.py "$V3_CKPT" "$V5_CKPT" || true

echo ""
echo "=== [3/3] Ladder v5-h128 vs original at MCTS=25 (40g) ==="
node tests/headless/eval-ladder.js "$V5_CKPT" "$ORIG" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  2>&1 | tee "${CKPT_DIR}/ladder-v5-h128-vs-orig-mcts25-40g.log"

echo ""
echo "=== v5-h128 pipeline complete ==="
