#!/usr/bin/env bash
# v4b: same buf-v4-merged.json as v4 but NO --class-weight-z (ablation on whether
# class-weighting caused v4's regression from v3).
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
V3_CKPT="${CKPT_DIR}/warmed-20e-v3-lambda05.json"
V4_MERGED="${CKPT_DIR}/buf-v4-merged.json"
V4B_CKPT="${CKPT_DIR}/warmed-20e-v4b-noclasswt.json"
ORIG="tests/headless/learnings-data.json"

echo "=== [1/3] Train v4b (20ep, λ_v=0.5, NO class-weight, from v3 weights) ==="
python3 python/train_policy.py \
  --learnings "$V3_CKPT" \
  --buffer "$V4_MERGED" \
  --output "$V4B_CKPT" \
  --epochs 20 --batch 256 --lr 3e-4 --lambda-v 0.5 --device cpu

echo ""
echo "=== [2/3] Compare v3 vs v4b ==="
python3 python/compare_checkpoints.py "$V3_CKPT" "$V4B_CKPT"

echo ""
echo "=== [3/3] Ladder v4b vs original at MCTS=25 (40g) ==="
node tests/headless/eval-ladder.js "$V4B_CKPT" "$ORIG" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  2>&1 | tee "${CKPT_DIR}/ladder-v4b-vs-orig-mcts25-40g.log"

echo ""
echo "=== v4b pipeline complete ==="
