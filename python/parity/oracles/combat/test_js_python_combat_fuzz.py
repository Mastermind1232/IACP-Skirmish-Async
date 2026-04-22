"""JS ↔ Python combat-parity fuzz (D6.8b).

Shells out to `node tests/headless/dump-combat-fuzz.js`, reads N randomized
JS combat cases from stdout, and for each case:

  1. Rebuilds a `DiceStream` from the recorded face indices.
  2. Re-runs `roll_attack_dice(diceColors, stream=ds)` + `roll_defense_dice`
     and asserts the rolled totals match JS exactly.
  3. Feeds the JS-produced combat context into `compute_combat_result` and
     asserts `{hit, damage, effectiveBlock, resultText}` match JS byte-for-byte.
  4. Verifies the post-compute mutations to `combat.defenseRoll` (Wookiee
     Avenger) and `combat.bonusConditions` (Set for Stun) match JS.

Any divergence is a fatal parity failure — the Python engine would have
trained a CNN on the wrong game.

Run as: python3 -m python.parity.oracles.combat.test_js_python_combat_fuzz
       [--count N] [--seed S]
"""
import argparse
import copy
import json
import subprocess
import sys
from pathlib import Path

from python.engine.mechanics.combat import compute_combat_result
from python.engine.mechanics.dice import (
    DiceStream,
    roll_attack_dice,
    roll_defense_dice,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
DUMP_SCRIPT = REPO_ROOT / 'tests' / 'headless' / 'dump-combat-fuzz.js'


def _run_js_dump(count: int, seed: int) -> list[dict]:
    result = subprocess.run(
        ['node', str(DUMP_SCRIPT), '--count', str(count), '--seed', str(seed)],
        cwd=str(REPO_ROOT),
        check=True,
        capture_output=True,
        text=True,
    )
    cases = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        cases.append(json.loads(line))
    return cases


def _check_dice_parity(case: dict) -> None:
    """Replay recorded faces through Python rollers; assert totals match JS."""
    pools = {
        'attack': {k: list(v) for k, v in case['recordedPools']['attack'].items()},
        'defense': {k: list(v) for k, v in case['recordedPools']['defense'].items()},
    }
    ds = DiceStream(pools=pools)

    py_attack = roll_attack_dice(case['diceColors'], stream=ds)
    py_defense = roll_defense_dice(case['defenseColor'], stream=ds)

    js_a = case['attackRoll']
    js_d = case['defenseRoll']

    for k in ('acc', 'dmg', 'surge'):
        assert py_attack[k] == js_a[k], (
            f'seq {case["seq"]}: attack {k} mismatch — JS={js_a[k]} Python={py_attack[k]}'
        )
    for k in ('block', 'evade', 'dodge'):
        assert py_defense[k] == js_d[k], (
            f'seq {case["seq"]}: defense {k} mismatch — JS={js_d[k]} Python={py_defense[k]}'
        )


def _check_compute_parity(case: dict) -> None:
    combat = copy.deepcopy(case['combat'])
    py = compute_combat_result(combat)
    js = case['expected']

    for k in ('hit', 'damage', 'effectiveBlock'):
        assert py[k] == js[k], (
            f'seq {case["seq"]}: {k} mismatch — JS={js[k]!r} Python={py[k]!r}\n'
            f'  combat={case["combat"]!r}'
        )
    assert py['resultText'] == js['resultText'], (
        f'seq {case["seq"]}: resultText mismatch\n'
        f'  JS:     {js["resultText"]!r}\n'
        f'  Python: {py["resultText"]!r}\n'
        f'  combat: {case["combat"]!r}'
    )

    js_after = case['combatAfter']
    for k in ('block', 'evade', 'dodge'):
        py_val = combat['defenseRoll'].get(k, 0) if k != 'dodge' else combat['defenseRoll'].get(k, False)
        assert py_val == js_after['defenseRoll'][k], (
            f'seq {case["seq"]}: post-compute defenseRoll.{k} mismatch — '
            f'JS={js_after["defenseRoll"][k]} Python={py_val}'
        )
    py_bc = combat.get('bonusConditions') or []
    js_bc = js_after['bonusConditions'] or []
    assert py_bc == js_bc, (
        f'seq {case["seq"]}: post-compute bonusConditions mismatch — '
        f'JS={js_bc} Python={py_bc}'
    )


def run(count: int, seed: int) -> int:
    print(f'Running JS dump: count={count} seed={seed}...', file=sys.stderr)
    try:
        cases = _run_js_dump(count, seed)
    except subprocess.CalledProcessError as e:
        print(f'JS dump failed (exit {e.returncode}):\n{e.stderr}', file=sys.stderr)
        return 2
    print(f'Loaded {len(cases)} cases; verifying parity...', file=sys.stderr)

    failures = 0
    for case in cases:
        try:
            _check_dice_parity(case)
            _check_compute_parity(case)
        except AssertionError as e:
            failures += 1
            print(f'FAIL seq={case.get("seq")}: {e}')

    total = len(cases)
    print(f'\n{total - failures}/{total} parity cases matched')
    return 0 if failures == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', type=int, default=200)
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()
    return run(args.count, args.seed)


if __name__ == '__main__':
    sys.exit(main())
