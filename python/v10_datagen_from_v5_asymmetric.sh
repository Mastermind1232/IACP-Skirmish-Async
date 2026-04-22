#!/usr/bin/env bash
# v10: fix P1-seat-bias of v9 using v4's proven ASYMMETRIC-MCTS regime.
#
# v9 failed (ΔElo -6.7 vs v5) because v5-vs-v5 symmetric MCTS self-match
# produced 0 z=-1 samples (P1 first-mover wins ~100% of decisive games,
# regardless of policy strength). v10 smoke with v5-vs-orig --mcts-a=25
# --mcts-b=25 also failed (disproved asymmetric-pairing alone).
#
# The REAL fix is asymmetric MCTS STRENGTH: v4 data-gen used --mcts-a=25
# --mcts-b=0 and produced balanced samples (80g: z-dist -1=554/+1=3646, ~7:1).
# Stronger side wins from BOTH seats (v3 at 80g: 17.5% wins vs 6.3% losses),
# so z=+1 samples come from both P1 and P2 trajectories of v5, and orig's
# occasional first-mover wins at P1 contribute z=-1 samples.
#
# Ship gate: v10 beats v5 at MCTS=25 by ≥ +20 Elo (1σ above noise, CI excludes 0).
set -euo pipefail

CKPT_DIR="tests/headless/checkpoints/phase-d"
V5_CKPT="${CKPT_DIR}/warmed-20e-v5-h128.json"
V4_MERGED="${CKPT_DIR}/buf-v4-merged.json"
ORIG_64H="${CKPT_DIR}/orig-64h-baseline.json"
V10_RAW="${CKPT_DIR}/buf-v10-raw.json"
V10_MERGED="${CKPT_DIR}/buf-v10-merged.json"
V10_CKPT="${CKPT_DIR}/warmed-20e-v10-h128.json"
LOG="${CKPT_DIR}/v10-pipeline.log"

exec > >(tee -a "$LOG") 2>&1

echo "=== v10 pipeline start: $(date) ==="

echo ""
echo "=== [1/6] Data-gen: v5 vs orig-64h ASYMMETRIC-MCTS, 40g, A=25sims B=0sims, noise(0.3/0.05) ==="
echo "NOTE: eval-mode regime — v5(MCTS=25) beats orig(MCTS=0) from both seats (matches v4's proven recipe)."
rm -f "$V10_RAW"
node tests/headless/eval-ladder.js "$V5_CKPT" "$ORIG_64H" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  --root-temp=0.3 --dirichlet-eps=0.05 \
  --record-policy="$V10_RAW" --record-side=a

echo ""
echo "=== [2/6] Filter decisive + merge with v4-merged ==="
python3 python/filter_decisive_buffers.py "$V10_MERGED" "$V4_MERGED" "$V10_RAW"

echo ""
echo "=== [3/6] Train v10 (20ep, λ_v=0.5, from v5 weights, 128-hidden) ==="
python3 python/train_policy.py \
  --learnings "$V5_CKPT" \
  --buffer "$V10_MERGED" \
  --output "$V10_CKPT" \
  --epochs 20 --batch 256 --lr 3e-4 --lambda-v 0.5 --hidden 128 --device cpu

echo ""
echo "=== [4/6] Compare v5 vs v10 ==="
python3 python/compare_checkpoints.py "$V5_CKPT" "$V10_CKPT" || true

echo ""
echo "=== [5/6] Ladder v10 vs v5 MCTS=25 (40g symmetric — primary ship gate) ==="
node tests/headless/eval-ladder.js "$V10_CKPT" "$V5_CKPT" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=25 \
  2>&1 | tee "${CKPT_DIR}/ladder-v10-vs-v5-mcts25-40g.log"

echo ""
echo "=== [6/6] Ladder v10 vs orig-64h MCTS=25 (40g asymmetric — historical track) ==="
node tests/headless/eval-ladder.js "$V10_CKPT" "$ORIG_64H" 40 \
  --matchups=4 --mcts-a=25 --mcts-b=0 \
  2>&1 | tee "${CKPT_DIR}/ladder-v10-vs-orig64h-mcts25-40g.log"

echo ""
echo "=== v10 pipeline complete: $(date) ==="
echo "v10 ckpt:  $V10_CKPT"
echo "v10 buf:   $V10_MERGED"
echo "Logs:      ${CKPT_DIR}/ladder-v10-*.log  ${LOG}"
