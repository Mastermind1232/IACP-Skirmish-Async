#!/usr/bin/env bash
# v4 training pipeline — runs AFTER buf-v4-raw.json data-gen completes.
# Filters decisive, merges with v3 buffer, trains with class-weighted value loss,
# compares checkpoints, runs v4-vs-original and v4-vs-v3 ladders at MCTS=25.
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
V3_CKPT="${CKPT_DIR}/warmed-20e-v3-lambda05.json"
V3_BUF="${CKPT_DIR}/buf-v3-merged-4661decisive.json"
V4_RAW="${CKPT_DIR}/buf-v4-raw.json"
V4_MERGED="${CKPT_DIR}/buf-v4-merged.json"
V4_CKPT="${CKPT_DIR}/warmed-20e-v4-classwt.json"
ORIG="tests/headless/learnings-data.json"

if [[ ! -f "$V4_RAW" ]]; then
  echo "ERROR: $V4_RAW not found. Wait for data-gen to finish."
  exit 1
fi

echo "=== [1/5] Filter v4 raw to decisive + merge with v3 buffer ==="
python3 python/filter_decisive_buffers.py "$V4_MERGED" "$V3_BUF" "$V4_RAW"

echo ""
echo "=== [2/5] Train v4 (20ep, λ_v=0.5, class-weighted, from v3 weights) ==="
python3 python/train_policy.py \
  --learnings "$V3_CKPT" \
  --buffer "$V4_MERGED" \
  --output "$V4_CKPT" \
  --epochs 20 --batch 256 --lr 3e-4 --lambda-v 0.5 \
  --class-weight-z --device cpu

echo ""
echo "=== [3/5] Compare v3 vs v4 ==="
python3 python/compare_checkpoints.py "$V3_CKPT" "$V4_CKPT"

echo ""
echo "=== [4/5] Ladder v4 vs original at MCTS=25 (40g) ==="
node tests/headless/eval-ladder.js "$V4_CKPT" "$ORIG" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  2>&1 | tee "${CKPT_DIR}/ladder-v4-vs-orig-mcts25-40g.log"

echo ""
echo "=== [5/5] Ladder v4 vs v3 head-to-head MCTS=25 (40g symmetric) ==="
node tests/headless/eval-ladder.js "$V4_CKPT" "$V3_CKPT" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=25 \
  2>&1 | tee "${CKPT_DIR}/ladder-v4-vs-v3-mcts25-40g.log"

echo ""
echo "=== v4 pipeline complete ==="
echo "v4 ckpt:   $V4_CKPT"
echo "v4 buf:    $V4_MERGED"
echo "Logs:      ${CKPT_DIR}/ladder-v4-*.log"
