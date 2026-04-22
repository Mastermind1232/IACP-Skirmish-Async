"""Parity test: JS network -> PyTorch -> JS network -> forward on same features.

Verifies that load_js_network / export_js_network round-trip preserves forward
pass to float-precision. Run locally (CPU only) before deploying to GPU.

Usage:
    python python/test_roundtrip.py [path/to/learnings.json]

Default path: tests/headless/learnings-data.json
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

import torch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "python"))

from skirbo_net import (  # noqa: E402
    NetConfig,
    SkirboNet,
    export_js_network,
    forward_sample,
    load_js_network,
    load_learnings_file,
)


NODE_PARITY_SCRIPT = r"""
import { getFullQ } from './tests/headless/learnings.js';
import { readFileSync } from 'node:fs';

const [, learningsPath, featuresJsonPath] = process.argv;
const data = JSON.parse(readFileSync(learningsPath));
const features = JSON.parse(readFileSync(featuresJsonPath));
const fp = getFullQ(data.network, features);
const vTanh = Math.tanh(fp.V);
let P = null;
if (fp.policyLogits) {
  const maxL = Math.max(...fp.policyLogits);
  let z = 0;
  P = fp.policyLogits.map(l => { const e = Math.exp(l - maxL); z += e; return e; });
  for (let i = 0; i < P.length; i++) P[i] /= z;
}
console.log(JSON.stringify({ Q: fp.Q, V: fp.V, V_tanh: vTanh, P }));
"""


def run_js_forward(learnings_path: str, features: list[float]) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as sf:
        sf.write(NODE_PARITY_SCRIPT)
        script_path = sf.name
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as ff:
        json.dump(features, ff)
        features_path = ff.name
    try:
        out = subprocess.run(
            ["node", "--input-type=module", "-e", NODE_PARITY_SCRIPT,
             learnings_path, features_path],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        )
        return json.loads(out.stdout)
    finally:
        os.unlink(script_path)
        os.unlink(features_path)


def max_abs(a: list[float], b: list[float]) -> float:
    return max(abs(x - y) for x, y in zip(a, b))


def main():
    learnings_path = (
        sys.argv[1] if len(sys.argv) > 1
        else os.path.join(REPO_ROOT, "tests", "headless", "learnings-data.json")
    )
    print(f"Loading {learnings_path}")
    data = load_learnings_file(learnings_path)
    net_dict = data["network"]

    src_hidden = len(net_dict["W1"])
    src_features = len(net_dict["W1"][0])
    src_actions = len(net_dict["Wa"])
    print(f"Source net: hidden={src_hidden}, features={src_features}, actions={src_actions}, "
          f"has_policy={'Wp' in net_dict and 'bp' in net_dict}")

    cfg = NetConfig(n_features=src_features, hidden=src_hidden, n_actions=src_actions)
    py_net = SkirboNet(cfg)
    info = load_js_network(py_net, net_dict, strict=True)
    print(f"Loaded into PyTorch: {info}")

    features = [0.15, 0.0392, 0.76, -0.72, 0.57, 0.14, 0.0, 0.0, 0.2, 0.25]
    features += [0.0] * (src_features - len(features))

    py_out = forward_sample(py_net, features)
    print(f"PyTorch V_tanh={py_out['V_tanh']:.6f}, top-3 Q: "
          f"{sorted(enumerate(py_out['Q']), key=lambda x: -x[1])[:3]}")

    try:
        js_out = run_js_forward(learnings_path, features)
    except subprocess.CalledProcessError as e:
        print(f"Node run failed: {e.stderr}")
        return 2
    print(f"JS      V_tanh={js_out['V_tanh']:.6f}, top-3 Q: "
          f"{sorted(enumerate(js_out['Q']), key=lambda x: -x[1])[:3]}")
    q_err = max_abs(py_out["Q"], js_out["Q"])
    v_err = abs(py_out["V"] - js_out["V"])
    p_err = max_abs(py_out["P"], js_out["P"]) if js_out.get("P") else 0.0
    print(f"Max-abs diffs: Q={q_err:.2e}, V={v_err:.2e}, P={p_err:.2e}")

    rt = export_js_network(py_net)
    for key in ("W1", "b1", "Wv", "Wa", "ba"):
        assert key in rt, f"Round-trip missing {key}"
    if info["has_policy"]:
        assert "Wp" in rt and "bp" in rt
    print("JS-format round-trip: OK")

    ok = q_err < 1e-4 and v_err < 1e-4 and p_err < 1e-5
    print("PARITY OK" if ok else "PARITY FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
