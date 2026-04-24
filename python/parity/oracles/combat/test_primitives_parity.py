"""Regression oracle: state-primitive parity (damage / conditions).

Runs a deterministic fuzz across the atomic primitives that the
attack orchestrator composes on top of. Any JS↔Python divergence in
these fails the test.
"""
from __future__ import annotations

from python.parity.primitives_golden import run_cases, _CASE_BUILDERS


def test_primitives_parity_20_each():
    """20 fuzz cases per primitive (4 primitives = 80 total)."""
    ops = list(_CASE_BUILDERS.keys())
    report = run_cases(ops, n_each=20, seed=42)
    assert report['counts'].get('FAIL', 0) == 0, (
        f"primitive parity failures: {report['counts']}. "
        f"First: {next((r for r in report['reports'] if r['status']!='PASS'), None)}"
    )
    assert report['counts'].get('ERROR', 0) == 0
    assert report['counts']['PASS'] == 80
