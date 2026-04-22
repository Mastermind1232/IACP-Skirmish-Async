#!/usr/bin/env bash
# v7: train from ORIGINAL weights (not v3) — ablation on warm-start basin.
# Hypothesis: v3's weight basin may trap later iterations; training from scratch-ish
# (orig) may find a different/better basin.
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
ORIG="tests/headless/learnings-data.json"
V4_MERGED="${CKPT_DIR}/buf-v4-merged.json"
V7_CKPT="${CKPT_DIR}/warmed-20e-v7-from-orig.json"

echo "=== [1/3] Train v7 (20ep, λ_v=0.5, from ORIG weights — not v3) ==="
python3 python/train_policy.py \
  --learnings "$ORIG" \
  --buffer "$V4_MERGED" \
  --output "$V7_CKPT" \
  --epochs 20 --batch 256 --lr 3e-4 --lambda-v 0.5 --device cpu

echo ""
echo "=== [2/3] Compare orig vs v7 ==="
python3 python/compare_checkpoints.py "$ORIG" "$V7_CKPT"

echo ""
echo "=== [3/3] Ladder v7 vs original at MCTS=25 (40g) ==="
node tests/headless/eval-ladder.js "$V7_CKPT" "$ORIG" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  2>&1 | tee "${CKPT_DIR}/ladder-v7-vs-orig-mcts25-40g.log"

echo ""
echo "=== v7 pipeline complete ==="
