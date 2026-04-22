"""Port of tests/domain/oracle/los-06-diagonal-corner-probes.test.js (D6).

CRR rule (p.22, p.28): "Line of sight cannot be traced through a corner where
any combination of walls, doors, blocking terrain, or Energy Shield intersect."

Shared geometry: attacker a1 (0,0), target b2 (1,1). The only corner the
a1→b2 diagonal threads is (0.5, 0.5) where cells a1, b1, a2, b2 meet.
Obstacles on a2 + b1 (the two non-endpoint diagonal cells) create the
CRR corner-intersection test.

PROBE-LOS-06-DC-001: single obstacle at corner — LOS NOT blocked (CRR carveout)
PROBE-LOS-06-DC-002: two shields diagonal-corner — LOS BLOCKED
PROBE-LOS-06-DC-003: shield + wall corner — LOS BLOCKED
PROBE-LOS-06-DC-004: wall+wall corner (shield-free control) — LOS BLOCKED
PROBE-LOS-06-DC-005: source pin on python/engine/mechanics/los.py primitives.
   (JS version pins src/game/spatial.js; the Python pin guards the port.)

Run as: python3 -m python.parity.oracles.los.test_los_06_diagonal_corner_probes
"""
import re
import sys
from pathlib import Path

from python.engine.mechanics.los import has_line_of_sight


ATTACKER = 'a1'
TARGET = 'b2'

LOS_PY_PATH = Path(__file__).resolve().parents[4] / 'python' / 'engine' / 'mechanics' / 'los.py'


# ── PROBE-LOS-06-DC-001: single obstacle — LOS allowed ─────────────────────

def test_probe_dc_001_shield_on_a2_only_los_allowed():
    ms = {'blocking': ['a2'], 'impassableEdges': []}
    los = has_line_of_sight(ATTACKER, TARGET, ms, None)
    assert los is True, (
        'Single shield at a corner must not block diagonal LOS — '
        'CRR only blocks when TWO or more obstacles intersect at the corner.')


def test_probe_dc_001_shield_on_b1_only_los_allowed():
    ms = {'blocking': ['b1'], 'impassableEdges': []}
    los = has_line_of_sight(ATTACKER, TARGET, ms, None)
    assert los is True, 'Mirror of the a2-only case on the opposite diagonal cell.'


# ── PROBE-LOS-06-DC-002: two shields diagonal-corner — LOS BLOCKED ─────────

def test_probe_dc_002_shields_a2_b1_los_blocked_at_corner():
    ms = {'blocking': ['a2', 'b1'], 'impassableEdges': []}
    los = has_line_of_sight(ATTACKER, TARGET, ms, None)
    assert los is False, (
        'Two shields on diagonally-adjacent cells must block LOS at their '
        'shared corner (0.5, 0.5). CRR p.28 energy-shield corner rule.')


# ── PROBE-LOS-06-DC-003: shield + wall corner — LOS BLOCKED ────────────────

def test_probe_dc_003_shield_a2_wall_b1_b2_los_blocked():
    # Wall b1|b2 has endpoints (0.5, 0.5) and (1.5, 0.5); its west endpoint
    # exactly coincides with the intersection corner of the shield at a2.
    ms = {'blocking': ['a2'], 'impassableEdges': [['b1', 'b2']]}
    los = has_line_of_sight(ATTACKER, TARGET, ms, None)
    assert los is False, (
        'Energy shield + wall endpoint sharing corner (0.5, 0.5) must block '
        'diagonal LOS. CRR p.28 shield-wall corner rule.')


# ── PROBE-LOS-06-DC-004: wall + wall corner (shield-free control) ──────────

def test_probe_dc_004_walls_a1_a2_and_b1_b2_los_blocked():
    ms = {'blocking': [], 'impassableEdges': [['a1', 'a2'], ['b1', 'b2']]}
    los = has_line_of_sight(ATTACKER, TARGET, ms, None)
    assert los is False, (
        'Two walls sharing endpoint (0.5, 0.5) must block diagonal LOS. '
        'CRR p.22 line-of-sight corner rule. Shield-free control — confirms '
        'the fix is geometric, not shield-specific.')


# ── PROBE-LOS-06-DC-005: Python-side source pin ────────────────────────────

def test_probe_dc_005_python_los_primitives_pinned():
    """The JS analog pins src/game/spatial.js. The Python port must keep
    equivalent primitives; if any of these disappear, corner-intersection
    behavior drifts."""
    src = LOS_PY_PATH.read_text(encoding='utf-8')

    assert re.search(r'INSET\s*=\s*0\.49\b', src), (
        'INSET=0.49 constant missing — corner-threading-ray geometry depends on it.')

    assert '_EPS_T = 1e-6' in src, (
        '_EPS_T = 1e-6 endpoint-exclusion constant missing.')

    assert re.search(r'_EPS_T\s*<\s*t\s*<\s*1\s*-\s*_EPS_T', src), (
        'segments_strictly_intersect strict-endpoint EPS guard missing — '
        'DC-003/DC-004 wall-corner gap depends on this exclusion.')

    assert re.search(r'def\s+_js_round\s*\(', src), (
        '_js_round helper missing — JS-Python parity for Math.round rasterizer.')

    assert re.search(r'col\s*=\s*_js_round\(', src), (
        'get_cells_along_line must sample with _js_round to match JS Math.round.')

    assert re.search(r'if\s+col\s*==\s*a_col\s+and\s+row\s*==\s*a_row', src), (
        'source-cell self-exclusion missing from has_line_of_sight.')

    assert re.search(r'if\s+col\s*==\s*b_col\s+and\s+row\s*==\s*b_row', src), (
        'destination-cell self-exclusion missing from has_line_of_sight.')

    assert re.search(r'def\s+get_threaded_corners\s*\(', src), (
        'get_threaded_corners helper missing — corner-intersection fix removed.')

    assert re.search(r'get_threaded_corners\s*\(\s*ax\s*,\s*ay\s*,\s*bx\s*,\s*by\s*\)', src), (
        'has_line_of_sight must invoke get_threaded_corners for each target-corner ray.')

    assert re.search(r'count\s*>=\s*2', src), (
        'Corner-obstacle counter must block when ≥2 obstacles meet at a threaded corner.')


ALL_TESTS = [
    test_probe_dc_001_shield_on_a2_only_los_allowed,
    test_probe_dc_001_shield_on_b1_only_los_allowed,
    test_probe_dc_002_shields_a2_b1_los_blocked_at_corner,
    test_probe_dc_003_shield_a2_wall_b1_b2_los_blocked,
    test_probe_dc_004_walls_a1_a2_and_b1_b2_los_blocked,
    test_probe_dc_005_python_los_primitives_pinned,
]


def _main():
    ok, bad = 0, 0
    for t in ALL_TESTS:
        try:
            t()
            ok += 1
            print(f'  ok  {t.__name__}')
        except AssertionError as e:
            bad += 1
            print(f'  FAIL {t.__name__}: {e}')
    print(f'\n{ok}/{ok+bad} tests pass')
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    _main()
