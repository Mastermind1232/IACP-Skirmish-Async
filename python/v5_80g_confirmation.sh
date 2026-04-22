#!/usr/bin/env bash
# v5-h128 80g confirmation ladder vs original at MCTS=25.
# Tightens CI from ±54 (40g) to ~±38 (80g).
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
V5_CKPT="${CKPT_DIR}/warmed-20e-v5-h128.json"
ORIG="tests/headless/learnings-data.json"

echo "=== Ladder v5-h128 vs orig at MCTS=25 (80g confirmation) ==="
node tests/headless/eval-ladder.js "$V5_CKPT" "$ORIG" 80 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  2>&1 | tee "${CKPT_DIR}/ladder-v5-h128-vs-orig-mcts25-80g.log"

echo ""
echo "=== v5-h128 80g confirmation complete ==="
