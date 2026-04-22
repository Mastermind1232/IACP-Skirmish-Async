#!/usr/bin/env bash
# v8-h256: further capacity bump 128→256 via PyTorch block-copy from v5-h128.
# Run ONLY AFTER v5-h128 confirmation succeeds. HIDDEN_SIZE in learnings.js must
# also be bumped to 256 before running this ladder (or the auto-migration will
# extend orig's 64-hidden → 256-hidden with Xavier rows).
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
V5_CKPT="${CKPT_DIR}/warmed-20e-v5-h128.json"
V4_MERGED="${CKPT_DIR}/buf-v4-merged.json"
V8_CKPT="${CKPT_DIR}/warmed-20e-v8-h256.json"
ORIG="tests/headless/learnings-data.json"

echo "=== [1/3] Train v8-h256 (20ep, λ_v=0.5, hidden=256 block-copy from v5) ==="
python3 python/train_policy.py \
  --learnings "$V5_CKPT" \
  --buffer "$V4_MERGED" \
  --output "$V8_CKPT" \
  --epochs 20 --batch 256 --lr 3e-4 --lambda-v 0.5 --hidden 256 --device cpu

echo ""
echo "=== [2/3] Compare v5 (128h) vs v8 (256h) ==="
python3 python/compare_checkpoints.py "$V5_CKPT" "$V8_CKPT" || true

echo ""
echo "=== [3/3] Ladder v8-h256 vs original at MCTS=25 (40g) ==="
echo "NOTE: requires HIDDEN_SIZE=256 in tests/headless/learnings.js"
node tests/headless/eval-ladder.js "$V8_CKPT" "$ORIG" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  2>&1 | tee "${CKPT_DIR}/ladder-v8-h256-vs-orig-mcts25-40g.log"

echo ""
echo "=== v8-h256 pipeline complete ==="
