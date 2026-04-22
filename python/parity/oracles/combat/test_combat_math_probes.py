"""Port of tests/domain/oracle/phase-d-combat-math-probes.test.js (D6.8b).

PROBE-PD-ACC-004 — Attacking in the same space requires 0 Accuracy (ranged
acc<dist gate must NOT trip at distanceToTarget=0). Pins CRR-ACC-004.

PROBE-PD-PRC-003 — Multiple Pierce sources add together on one attack. Pins
CRR-PRC-003. 003b: pierce total clamps at block (no negative-block overflow).

Run as: python3 -m python.parity.oracles.combat.test_combat_math_probes
"""
import sys

from python.engine.mechanics.combat import compute_combat_result


# ── PROBE-PD-ACC-004 ────────────────────────────────────────────────────────

def test_acc_004_distance_zero_passes_acc_gate():
    r = compute_combat_result({
        'attackRoll': {'acc': 0, 'dmg': 3, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'isRanged': True,
        'distanceToTarget': 0,
        'surgeDamage': 0,
        'surgePierce': 0,
        'surgeAccuracy': 0,
    })
    assert r['hit'] is True, f'same-space attack with acc=0 must hit — CRR-ACC-004. Got hit={r["hit"]}'
    assert r['damage'] == 3, 'damage resolves normally'


# ── PROBE-PD-PRC-003 ────────────────────────────────────────────────────────

def test_prc_003_surge_plus_bonus_pierce_additive():
    r = compute_combat_result({
        'attackRoll': {'acc': 5, 'dmg': 4, 'surge': 0},
        'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False},
        'isRanged': False,
        'surgeDamage': 0,
        'surgePierce': 1,
        'bonusPierce': 2,
        'surgeAccuracy': 0,
    })
    assert r['hit'] is True, 'hits'
    assert r['damage'] == 4, (
        f'CRR-PRC-003: 1 surgePierce + 2 bonusPierce = 3 total pierce; '
        f'3 block - 3 pierce = 0 effective block; 4 dmg - 0 = 4. Got damage={r["damage"]}'
    )


def test_prc_003b_pierce_clamps_at_block_no_negative():
    r = compute_combat_result({
        'attackRoll': {'acc': 5, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'isRanged': False,
        'surgeDamage': 0,
        'surgePierce': 2,
        'bonusPierce': 3,
        'surgeAccuracy': 0,
    })
    assert r['damage'] == 2, (
        'pierce total of 5 clamps against 1 block → 0 effective block; damage = 2 - 0 = 2'
    )


ALL_TESTS = [
    test_acc_004_distance_zero_passes_acc_gate,
    test_prc_003_surge_plus_bonus_pierce_additive,
    test_prc_003b_pierce_clamps_at_block_no_negative,
]


def _main() -> int:
    failures = 0
    for t in ALL_TESTS:
        try:
            t()
            print(f'PASS  {t.__name__}')
        except AssertionError as e:  # noqa: BLE001 — oracle failures are assertion-shaped
            failures += 1
            print(f'FAIL  {t.__name__}: {e}')
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f'ERROR {t.__name__}: {type(e).__name__}: {e}')
    total = len(ALL_TESTS)
    print(f'\n{total - failures}/{total} passed')
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(_main())
