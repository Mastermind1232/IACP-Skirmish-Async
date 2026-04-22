#!/usr/bin/env bash
# v9: new data-gen cycle with v5-h128 as both actors.
# Post-ship flywheel turn 1 — generate fresh training data using shipped v5-h128
# (128-hidden + policy head), then train a stronger v9 on merged v4+v9 data.
#
# Ship gate: v9 beats v5 at MCTS=25 by ≥ +20 Elo (1σ well above noise).
# If v9 ships, live learnings-data.json gets replaced the same way v5 did.
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
V5_CKPT="${CKPT_DIR}/warmed-20e-v5-h128.json"
V4_MERGED="${CKPT_DIR}/buf-v4-merged.json"
V9_RAW="${CKPT_DIR}/buf-v9-raw.json"
V9_MERGED="${CKPT_DIR}/buf-v9-merged.json"
V9_CKPT="${CKPT_DIR}/warmed-20e-v9-h128.json"
ORIG_64H="${CKPT_DIR}/orig-64h-baseline.json"
LOG="${CKPT_DIR}/v9-pipeline.log"

exec > >(tee -a "$LOG") 2>&1

echo "=== v9 pipeline start: $(date) ==="

echo ""
echo "=== [1/6] Data-gen: v5-h128 vs v5-h128, 40g, MCTS=25, noise(0.3/0.05), record both sides ==="
echo "NOTE: using eval-ladder (stuck-breakers) with --root-temp/--dirichlet-eps for self-match diversity."
rm -f "$V9_RAW"
node tests/headless/eval-ladder.js "$V5_CKPT" "$V5_CKPT" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=25 \
  --root-temp=0.3 --dirichlet-eps=0.05 \
  --record-policy="$V9_RAW" --record-side=both

echo ""
echo "=== [2/6] Filter decisive + merge with v4-merged ==="
python3 python/filter_decisive_buffers.py "$V9_MERGED" "$V4_MERGED" "$V9_RAW"

echo ""
echo "=== [3/6] Train v9 (20ep, λ_v=0.5, from v5 weights, 128-hidden) ==="
python3 python/train_policy.py \
  --learnings "$V5_CKPT" \
  --buffer "$V9_MERGED" \
  --output "$V9_CKPT" \
  --epochs 20 --batch 256 --lr 3e-4 --lambda-v 0.5 --hidden 128 --device cpu

echo ""
echo "=== [4/6] Compare v5 vs v9 ==="
python3 python/compare_checkpoints.py "$V5_CKPT" "$V9_CKPT" || true

echo ""
echo "=== [5/6] Ladder v9 vs v5 MCTS=25 (40g symmetric — primary ship gate) ==="
node tests/headless/eval-ladder.js "$V9_CKPT" "$V5_CKPT" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=25 \
  2>&1 | tee "${CKPT_DIR}/ladder-v9-vs-v5-mcts25-40g.log"

echo ""
echo "=== [6/6] Ladder v9 vs orig-64h MCTS=25 (40g asymmetric — historical track) ==="
node tests/headless/eval-ladder.js "$V9_CKPT" "$ORIG_64H" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  2>&1 | tee "${CKPT_DIR}/ladder-v9-vs-orig64h-mcts25-40g.log"

echo ""
echo "=== v9 pipeline complete: $(date) ==="
echo "v9 ckpt:   $V9_CKPT"
echo "v9 buf:    $V9_MERGED"
echo "Logs:      ${CKPT_DIR}/ladder-v9-*.log  ${LOG}"
