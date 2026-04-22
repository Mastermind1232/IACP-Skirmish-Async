"""Merge v5-h128's trained network into orig's metadata envelope.

Output: drop-in replacement for tests/headless/learnings-data.json with:
  - network: from v5-h128 (128-hidden, has Wp/bp)
  - all other fields: from orig (DC stats, matchups, training stats, etc.)

This is the production-deploy artifact. Only run after v5-h128 confirms on
both confirmation ladders (v5-vs-v3 head-to-head AND v5-vs-orig 80g).

Usage:
    python python/merge_v5_into_orig.py \
        --orig tests/headless/learnings-data.json \
        --v5 tests/headless/checkpoints/phase-d/warmed-20e-v5-h128.json \
        --output tests/headless/learnings-data-v5h128.json
"""
import argparse
import json
import sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--orig", required=True)
    p.add_argument("--v5", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    with open(args.orig) as f:
        orig = json.load(f)
    with open(args.v5) as f:
        v5 = json.load(f)

    orig_keys = set(orig.keys())
    v5_keys = set(v5.keys())
    if orig_keys != v5_keys:
        print(f"WARNING: schema mismatch orig={orig_keys - v5_keys} v5={v5_keys - orig_keys}")

    merged = dict(orig)
    merged["network"] = v5["network"]

    W1 = merged["network"]["W1"]
    Wa = merged["network"]["Wa"]
    has_Wp = "Wp" in merged["network"]
    print(f"Merged network: W1={len(W1)}x{len(W1[0])} Wa={len(Wa)}x{len(Wa[0])} has_Wp={has_Wp}")
    print(f"Preserved from orig: matchups={len(merged.get('matchups',[]))} "
          f"dcStats={len(merged.get('dcStats',{}))} "
          f"deckStats={len(merged.get('deckStats',{}))} "
          f"mapStats={len(merged.get('mapStats',{}))}")

    with open(args.output, "w") as f:
        json.dump(merged, f)
    print(f"Wrote: {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
