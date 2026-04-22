#!/usr/bin/env bash
# v6: same v4-merged buffer as v4/v4b/v5 but λ_v=1.0 (double value-head weight).
# Ablation: did v3's λ_v=0.5 leave value-head under-trained? If MSE=0.23 is a floor
# (not a ceiling), boosting λ shouldn't help. If V head is under-trained, it should.
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
V3_CKPT="${CKPT_DIR}/warmed-20e-v3-lambda05.json"
V4_MERGED="${CKPT_DIR}/buf-v4-merged.json"
V6_CKPT="${CKPT_DIR}/warmed-20e-v6-lambda10.json"
ORIG="tests/headless/learnings-data.json"

echo "=== [1/3] Train v6 (20ep, λ_v=1.0, no class-weight, from v3 weights) ==="
python3 python/train_policy.py \
  --learnings "$V3_CKPT" \
  --buffer "$V4_MERGED" \
  --output "$V6_CKPT" \
  --epochs 20 --batch 256 --lr 3e-4 --lambda-v 1.0 --device cpu

echo ""
echo "=== [2/3] Compare v3 vs v6 ==="
python3 python/compare_checkpoints.py "$V3_CKPT" "$V6_CKPT"

echo ""
echo "=== [3/3] Ladder v6 vs original at MCTS=25 (40g) ==="
node tests/headless/eval-ladder.js "$V6_CKPT" "$ORIG" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  2>&1 | tee "${CKPT_DIR}/ladder-v6-vs-orig-mcts25-40g.log"

echo ""
echo "=== v6 pipeline complete ==="
