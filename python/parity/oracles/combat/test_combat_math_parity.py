"""Regression oracle: Python `compute_combat_result` matches JS
`computeCombatResult` across a deterministic fuzz.

Runs 100 seeded fuzz cases + 11 hand-crafted edge cases on every test
run. If anyone changes either implementation in a way that diverges,
the test fails.

The larger 2000-case sweep is run manually via the CLI
(`python3 -m python.parity.combat_golden --cases 2000`).
"""
from __future__ import annotations

from python.parity.combat_golden import run_cases


def test_combat_math_100_fuzz_plus_edges():
    """100 seeded fuzz cases + 11 edge cases = 111 tests; all must PASS."""
    report = run_cases(n=100, seed=42)
    assert report['failed'] == 0, (
        f"combat math divergences: {report['failed']}/{report['total']}. "
        f"First fail: {report['fails'][0] if report['fails'] else None}"
    )
    assert report['total'] >= 111
