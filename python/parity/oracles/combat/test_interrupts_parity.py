"""Regression oracle: movement-interrupt detection parity.

Mirrors python.parity.interrupts_golden.run() in pytest form.
Runs 6 hand-crafted scenarios (Parting Blow with / without BRAWLER /
with / without card, Dirty Trick SMUGGLER, combined). Must match
JS detectPostMoveInterrupts exactly.
"""
from __future__ import annotations

from python.parity.interrupts_golden import run


def test_interrupts_parity_6_scenarios():
    r = run()
    assert r['counts'].get('FAIL', 0) == 0, (
        f"interrupt parity failures: {r['counts']}. "
        f"First: {r['reports'][0] if r['reports'] else None}"
    )
    assert r['counts'].get('ERROR', 0) == 0
    assert r['counts']['PASS'] == 6
