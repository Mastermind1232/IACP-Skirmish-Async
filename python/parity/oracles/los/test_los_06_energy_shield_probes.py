"""Port of tests/domain/oracle/los-06-energy-shield-probes.test.js (D6).

Three CRR carve-outs for energy-shield LOS (p.28):
  1. A shield space blocks LOS (generic blocking-terrain behavior).
  2. LOS can be traced TO a figure on a shield space (target self-exclusion).
  3. LOS can be drawn OUT OF a shield space (source self-exclusion).

Python port: `has_line_of_sight` mirrors the JS self-exclusion at source
and destination cells, so rules 2 and 3 fall out automatically. Rule 1 is
the generic blocking-set check on intermediate cells.

PROBE-LOS-06-001: LOS drawn OUT of shield (attacker ON shield)
PROBE-LOS-06-002: LOS drawn INTO shield (target ON shield)
PROBE-LOS-06-003: LOS NOT drawn through shield (shield between)
PROBE-LOS-06-004: Multi-cell attacker — shield cell allowed via self-exclusion

Run as: python3 -m python.parity.oracles.los.test_los_06_energy_shield_probes
"""
import sys

from python.engine.mechanics.coords import get_footprint_cells
from python.engine.mechanics.los import has_line_of_sight


# ── PROBE-LOS-06-001: LOS drawn OUT of shield ──────────────────────────────

def test_probe_001_b3_to_e3_with_shield_on_b3_returns_true():
    map_spaces = {'blocking': ['b3'], 'impassableEdges': []}
    los = has_line_of_sight('b3', 'e3', map_spaces, None)
    assert los is True, 'Attacker on shield space b3 must still have LOS out to e3.'


# ── PROBE-LOS-06-002: LOS drawn INTO shield ────────────────────────────────

def test_probe_002_b3_to_e3_with_shield_on_e3_returns_true():
    map_spaces = {'blocking': ['e3'], 'impassableEdges': []}
    los = has_line_of_sight('b3', 'e3', map_spaces, None)
    assert los is True, 'Target on shield space e3 must still be visible from b3.'


# ── PROBE-LOS-06-003: LOS NOT drawn through shield ─────────────────────────

def test_probe_003_b3_to_e3_with_shield_between_at_c3_returns_false():
    map_spaces = {'blocking': ['c3'], 'impassableEdges': []}
    los = has_line_of_sight('b3', 'e3', map_spaces, None)
    assert los is False, 'Shield on c3 between attacker b3 and target e3 must block LOS.'


def test_probe_003_b3_to_e3_with_shield_between_at_d3_returns_false():
    map_spaces = {'blocking': ['d3'], 'impassableEdges': []}
    los = has_line_of_sight('b3', 'e3', map_spaces, None)
    assert los is False, 'Shield on d3 between attacker b3 and target e3 must block LOS.'


# ── PROBE-LOS-06-004: Multi-cell attacker + shield self-exclusion ──────────

def test_probe_004_2x2_attacker_shield_on_b3_any_cell_los_to_f3():
    map_spaces = {'blocking': ['b3'], 'impassableEdges': []}
    attacker_cells = get_footprint_cells('a3', '2x2')
    assert len(attacker_cells) == 4, (
        f'2x2 footprint must expand to 4 cells. Got: {attacker_cells}')
    los_per_cell = {c: has_line_of_sight(c, 'f3', map_spaces, None)
                     for c in attacker_cells}
    any_has_los = any(los_per_cell.values())
    assert any_has_los, (
        f'2x2 attacker at a3 with shield on b3 must have LOS to f3 from at '
        f'least one footprint cell. Per-cell LOS: {los_per_cell}')
    assert los_per_cell['b3'] is True, (
        f'LOS from b3 (the shield cell itself) must be allowed by self-exclusion. '
        f'Per-cell LOS: {los_per_cell}')


ALL_TESTS = [
    test_probe_001_b3_to_e3_with_shield_on_b3_returns_true,
    test_probe_002_b3_to_e3_with_shield_on_e3_returns_true,
    test_probe_003_b3_to_e3_with_shield_between_at_c3_returns_false,
    test_probe_003_b3_to_e3_with_shield_between_at_d3_returns_false,
    test_probe_004_2x2_attacker_shield_on_b3_any_cell_los_to_f3,
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
