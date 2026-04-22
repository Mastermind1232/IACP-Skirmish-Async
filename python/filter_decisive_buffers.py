"""Filter and merge policy buffer JSONs to decisive-only samples (z ∈ {-1, +1}).

Reads one or more policy buffer JSONs (each produced by savePolicyBuffer), drops
all z=0 / z=null samples, and writes a merged output buffer.

Usage:
    python python/filter_decisive_buffers.py <out.json> <in1.json> [in2.json ...]
"""
from __future__ import annotations

import json
import sys
from collections import Counter


def main() -> int:
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <out.json> <in1.json> [in2.json ...]")
        return 1
    out_path, *in_paths = sys.argv[1:]

    merged = []
    total_in = 0
    by_source = []
    for p in in_paths:
        with open(p) as f:
            data = json.load(f)
        samples = data.get("samples", data) if isinstance(data, dict) else data
        if not isinstance(samples, list):
            print(f"  {p}: unexpected format")
            continue
        total_in += len(samples)
        kept = [s for s in samples if s.get("z") in (-1, 1)]
        z_hist = Counter(s.get("z") for s in samples)
        by_source.append((p, len(samples), len(kept), z_hist))
        merged.extend(kept)

    z_hist_out = Counter(s["z"] for s in merged)

    print("Per-source:")
    for p, n, k, hist in by_source:
        print(f"  {p}: {n} in → {k} decisive  z-hist={dict(hist)}")
    print(f"Merged: {len(merged)} decisive / {total_in} total  z-hist={dict(z_hist_out)}")

    out = {"samples": merged, "writeIdx": 0, "count": len(merged)}
    with open(out_path, "w") as f:
        json.dump(out, f)
    print(f"Saved: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
