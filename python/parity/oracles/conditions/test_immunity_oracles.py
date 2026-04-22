"""Port of tests/domain/oracle/immunity-oracles.test.js (D6.8d).

Ports ORACLE-IMMUNE-001..005 — behavioral oracles for is_condition_immune
against DC specialAbilityIds and the youWillNotDenyMeActive passive gate.

Covered:
  001 Onar Koma (immune_onar) — harmful-condition immune
  002 Fifth Brother gated by youWillNotDenyMeActive
  003 Snowtrooper (Elite) (immune_snowtrooper_elite)
  004 Focus still applies via apply_condition (immunity is harmful-only)
  005 apply_condition dedup

Run as: python3 -m python.parity.oracles.conditions.test_immunity_oracles
"""
import sys

from python.engine.mechanics.conditions import apply_condition, is_condition_immune


# ── ORACLE-IMMUNE-001: Onar Koma is immune ──────────────────────────────────

def test_001a_onar_koma_immune():
    assert is_condition_immune({}, 'Onar Koma-1-0') is True


def test_001b_non_immune_figure_not_immune():
    assert is_condition_immune({}, 'Stormtrooper (Regular)-1-0') is False


# ── ORACLE-IMMUNE-002: Fifth Brother + YWNDM gate ───────────────────────────

def test_002a_fifth_brother_immune_when_ywndm_active():
    game = {'youWillNotDenyMeActive': True}
    assert is_condition_immune(game, 'Fifth Brother-1-0') is True


def test_002b_fifth_brother_not_immune_without_ywndm():
    assert is_condition_immune({}, 'Fifth Brother-1-0') is False


# ── ORACLE-IMMUNE-003: Snowtrooper (Elite) ──────────────────────────────────

def test_003_snowtrooper_elite_immune():
    assert is_condition_immune({}, 'Snowtrooper (Elite)-1-0') is True


# ── ORACLE-IMMUNE-004: Non-harmful conditions still apply ───────────────────

def test_004_focus_applies_to_immune_figure():
    game = {}
    applied = apply_condition(game, 'Onar Koma-1-0', 'Focus')
    assert applied is True, 'Focus is not harmful — should still apply'
    assert game['figureConditions']['Onar Koma-1-0'] == ['Focus']


# ── ORACLE-IMMUNE-005: apply_condition dedup ────────────────────────────────

def test_005_apply_condition_dedup():
    game = {}
    first = apply_condition(game, 'Rebel Trooper-1-0', 'Stun')
    second = apply_condition(game, 'Rebel Trooper-1-0', 'Stun')
    assert first is True
    assert second is False, 'duplicate condition should not be re-applied'
    assert len(game['figureConditions']['Rebel Trooper-1-0']) == 1


ALL_TESTS = [
    test_001a_onar_koma_immune,
    test_001b_non_immune_figure_not_immune,
    test_002a_fifth_brother_immune_when_ywndm_active,
    test_002b_fifth_brother_not_immune_without_ywndm,
    test_003_snowtrooper_elite_immune,
    test_004_focus_applies_to_immune_figure,
    test_005_apply_condition_dedup,
]


def _main() -> int:
    failures = 0
    for t in ALL_TESTS:
        try:
            t()
            print(f'PASS  {t.__name__}')
        except AssertionError as e:
            failures += 1
            print(f'FAIL  {t.__name__}: {e}')
        except Exception as e:
            failures += 1
            print(f'ERROR {t.__name__}: {type(e).__name__}: {e}')
    total = len(ALL_TESTS)
    print(f'\n{total - failures}/{total} passed')
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(_main())
