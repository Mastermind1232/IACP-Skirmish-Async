#!/usr/bin/env bash
# Full cycle: upload decisive buffer, train on adamspc GPU, download ckpt, run ladder.
set -euo pipefail

BUFFER="${1:-/tmp/decisive-buf.json}"
EPOCHS="${2:-30}"
BATCH="${3:-256}"
LR="${4:-3e-4}"
REMOTE_USER="theme"
REMOTE_DIR="C:/Users/theme/skirbo_python"
LOCAL_CKPT="/tmp/pytorch-ckpt-decisive.json"
LEARNINGS="/Users/adammeehan/Public/IACP-Skirmish-Async/tests/headless/learnings-data.json"

echo "=== Upload buffer ==="
scp "$BUFFER" "adamspc:${REMOTE_DIR}/decisive-buf.json"

echo "=== GPU training (${EPOCHS} epochs, batch ${BATCH}, lr ${LR}) ==="
ssh adamspc "cd skirbo_python && python train_policy.py --learnings learnings-data.json --buffer decisive-buf.json --output pytorch-ckpt-decisive.json --epochs ${EPOCHS} --batch ${BATCH} --lr ${LR}"

echo "=== Download ckpt ==="
scp "adamspc:${REMOTE_DIR}/pytorch-ckpt-decisive.json" "$LOCAL_CKPT"

echo "=== Compare checkpoints ==="
python3 /Users/adammeehan/Public/IACP-Skirmish-Async/python/compare_checkpoints.py "$LEARNINGS" "$LOCAL_CKPT"

echo "=== Ladder eval: warmed vs original (asymmetric, MCTS=10) ==="
node /Users/adammeehan/Public/IACP-Skirmish-Async/tests/headless/eval-ladder.js "$LOCAL_CKPT" "$LEARNINGS" 10 --matchups=4 --mcts-a=10
