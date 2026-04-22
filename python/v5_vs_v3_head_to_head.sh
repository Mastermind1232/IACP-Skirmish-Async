#!/usr/bin/env bash
# v5-h128 vs v3 head-to-head at MCTS=25 (40g, symmetric).
# Run AFTER v5_h128_train_and_eval.sh completes.
# Answers: did the 128→64 capacity bump actually improve decisions?
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
V5_CKPT="${CKPT_DIR}/warmed-20e-v5-h128.json"
V3_CKPT="${CKPT_DIR}/warmed-20e-v3-lambda05.json"

if [[ ! -f "$V5_CKPT" ]]; then
  echo "ERROR: $V5_CKPT not found. Run v5_h128_train_and_eval.sh first."
  exit 1
fi

echo "=== Ladder v5-h128 vs v3 at MCTS=25 (40g symmetric) ==="
node tests/headless/eval-ladder.js "$V5_CKPT" "$V3_CKPT" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=25 \
  2>&1 | tee "${CKPT_DIR}/ladder-v5-h128-vs-v3-mcts25-40g.log"

echo ""
echo "=== v5-vs-v3 ladder complete ==="
