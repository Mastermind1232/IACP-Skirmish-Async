"""Combat-math parity harness: JS ↔ Python computeCombatResult diff.

The core combat math (src/game/combat.js:computeCombatResult and its
Python mirror python/engine/mechanics/combat.py:compute_combat_result)
is a pure function: given a combat dict, return {hit, damage,
effectiveBlock, resultText}. This harness fuzzes the input space
across all the fields that matter and asserts JS and Python produce
identical outputs.

Fuzz dimensions (multiplicative):
  - attack roll:     acc [0-5], dmg [0-4], surge [0-3]
  - defense roll:    block [0-3], evade [0-2], dodge [False, True]
  - surge spends:    surgeDamage [0-3], surgePierce [0-2],
                     surgeAccuracy [0-2], surgeCancel [0-2],
                     surgeCleave/surgeBlast/surgeRecover [0,2]
  - bonuses:         bonusHits, bonusAccuracy, bonusPierce,
                     bonusBlock, bonusEvade, bonusDamage, bonusBlast
  - ranged + distance: combinations that force miss / hit
  - conditions:      attacker Weaken, defender Weaken, defender Hide
  - flags:           hasCunning, forceMiss, wookieeAvengerDefend,
                     attackResultReplaceWithStun, surgeCancelDodge,
                     ignoreDefenseResultsNotOnDice, defenderIgnorePierce,
                     defenderReducePierce, maxDamageToDefender,
                     bonusDamagePerDefenseDie, defenseDiceCount

Runs a representative sample (~500 cases by default) to catch
divergences. Exit 0 if all PASS.

CLI:
    python3 -m python.parity.combat_golden --cases 200
    python3 -m python.parity.combat_golden --cases 2000 --json
"""
from __future__ import annotations

import argparse
import itertools
import json
import random
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
JS_CLI = REPO_ROOT / 'tests' / 'headless' / 'compute-combat.js'


def apply_js(combat: Dict[str, Any]) -> Dict[str, Any]:
    payload = json.dumps({'combat': combat})
    proc = subprocess.run(
        ['node', str(JS_CLI)],
        input=payload, capture_output=True, text=True,
        cwd=str(REPO_ROOT), timeout=30,
    )
    if proc.returncode not in (0, 1):
        return {'ok': False, 'error':
                f'node exit {proc.returncode}: {proc.stderr[:400]}'}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {'ok': False, 'error': f'bad stdout: {e}; {proc.stdout[:400]}'}


def apply_python(combat: Dict[str, Any]) -> Dict[str, Any]:
    from python.engine.mechanics.combat import compute_combat_result
    # Deep-copy so JS-side mutation vs Python-side mutation can be
    # compared cleanly.
    py_combat = json.loads(json.dumps(combat))
    try:
        result = compute_combat_result(py_combat)
    except Exception as e:
        return {'ok': False, 'error': f'{type(e).__name__}: {e}'}
    return {'ok': True, 'result': result, 'combat': py_combat}


def diff_results(js_resp: Dict[str, Any],
                 py_resp: Dict[str, Any]) -> List[str]:
    diffs = []
    js_r = js_resp.get('result') or {}
    py_r = py_resp.get('result') or {}
    for k in ('hit', 'damage', 'effectiveBlock'):
        if js_r.get(k) != py_r.get(k):
            diffs.append(f'result.{k}: JS={js_r.get(k)!r} PY={py_r.get(k)!r}')
    # Text may differ by trailing whitespace etc; compare up to a limit
    # but report clearly.
    js_t = (js_r.get('resultText') or '')
    py_t = (py_r.get('resultText') or '')
    if js_t != py_t:
        diffs.append(f'result.resultText differs (len JS={len(js_t)} PY={len(py_t)})')
        # Include first diff position for debugging.
        for i, (a, b) in enumerate(zip(js_t, py_t)):
            if a != b:
                diffs.append(f'  first-char diff at [{i}]: JS={a!r} PY={b!r}')
                diffs.append(f'  JS: {js_t[max(0,i-20):i+30]}')
                diffs.append(f'  PY: {py_t[max(0,i-20):i+30]}')
                break
        else:
            # Strings share prefix; one is longer.
            diffs.append(f'  JS suffix: ...{js_t[-80:]!r}')
            diffs.append(f'  PY suffix: ...{py_t[-80:]!r}')
    # Also check mutated combat.bonusConditions (Set-for-Stun).
    js_bc = (js_resp.get('combat') or {}).get('bonusConditions') or []
    py_bc = (py_resp.get('combat') or {}).get('bonusConditions') or []
    if js_bc != py_bc:
        diffs.append(f'combat.bonusConditions: JS={js_bc} PY={py_bc}')
    return diffs


def _make_combat(case_id: int, rng: random.Random) -> Dict[str, Any]:
    """Build one fuzzed combat dict."""
    is_ranged = rng.random() < 0.5
    acc = rng.randint(0, 5)
    dmg = rng.randint(0, 4)
    surge = rng.randint(0, 3)
    block = rng.randint(0, 3)
    evade = rng.randint(0, 2)
    dodge = rng.random() < 0.15

    attacker_conds = []
    defender_conds = []
    if rng.random() < 0.15:
        attacker_conds.append('Weaken')
    if rng.random() < 0.15:
        defender_conds.append('Weaken')
    if rng.random() < 0.15:
        defender_conds.append('Hide')

    return {
        'attackRoll': {'acc': acc, 'dmg': dmg, 'surge': surge},
        'defenseRoll': {
            'block': block, 'evade': evade, 'dodge': dodge,
            'color': 'white',
        },
        'attackerConds': attacker_conds,
        'defenderConds': defender_conds,
        'isRanged': is_ranged,
        'distanceToTarget': rng.randint(1, 6) if is_ranged else None,
        'surgeDamage': rng.randint(0, 3),
        'surgePierce': rng.randint(0, 2),
        'surgeAccuracy': rng.randint(0, 2),
        'surgeCancel': rng.randint(0, 2),
        'surgeCleave': rng.choice([0, 2]),
        'surgeBlast': rng.choice([0, 2]),
        'surgeRecover': rng.choice([0, 1]),
        'surgeConditions': (
            ['Bleed'] if rng.random() < 0.2 else []
        ),
        'bonusHits': rng.randint(0, 2),
        'bonusAccuracy': rng.randint(-1, 2),
        'bonusPierce': rng.randint(0, 2),
        'bonusBlock': rng.randint(-1, 2),
        'bonusEvade': rng.randint(-1, 1),
        'bonusDamage': rng.randint(0, 2),
        'bonusBlast': rng.choice([0, 1]),
        'bonusConditions': (
            ['Stun'] if rng.random() < 0.1 else []
        ),
        'hasCunning': rng.random() < 0.15,
        'forceMiss': rng.random() < 0.05,
        'wookieeAvengerDefend': rng.random() < 0.05,
        'attackResultReplaceWithStun': rng.random() < 0.05,
        'surgeCancelDodge': rng.random() < 0.05,
        'ignoreDefenseResultsNotOnDice': rng.random() < 0.05,
        'defenderIgnorePierce': rng.random() < 0.05,
        'defenderReducePierce': rng.randint(0, 1),
        'maxDamageToDefender': (
            rng.randint(1, 3) if rng.random() < 0.1 else None
        ),
        'bonusDamagePerDefenseDie': rng.choice([0, 1]),
        'defenseDiceCount': rng.choice([1, 2]),
        'defenderAccuracyPenalty': rng.randint(0, 1),
        'evadeCancelledSurge': rng.randint(0, 1),
    }


def _edge_cases() -> List[Dict[str, Any]]:
    """A handful of deliberate edge cases to exercise rare branches."""
    return [
        # Basic hit
        {'attackRoll': {'acc': 2, 'dmg': 3, 'surge': 0},
         'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False, 'color': 'white'},
         'attackerConds': [], 'defenderConds': [],
         'isRanged': False},
        # Dodge miss
        {'attackRoll': {'acc': 5, 'dmg': 5, 'surge': 0},
         'defenseRoll': {'block': 0, 'evade': 0, 'dodge': True, 'color': 'white'},
         'attackerConds': [], 'defenderConds': [],
         'isRanged': False},
        # Ranged insufficient accuracy
        {'attackRoll': {'acc': 1, 'dmg': 5, 'surge': 0},
         'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False, 'color': 'white'},
         'attackerConds': [], 'defenderConds': [],
         'isRanged': True, 'distanceToTarget': 4},
        # Set for Stun
        {'attackRoll': {'acc': 4, 'dmg': 3, 'surge': 0},
         'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False, 'color': 'white'},
         'attackerConds': [], 'defenderConds': [],
         'isRanged': False,
         'attackResultReplaceWithStun': True},
        # Wookiee Avenger dodge→evade
        {'attackRoll': {'acc': 4, 'dmg': 3, 'surge': 0},
         'defenseRoll': {'block': 0, 'evade': 0, 'dodge': True, 'color': 'white'},
         'attackerConds': [], 'defenderConds': [],
         'isRanged': False,
         'wookieeAvengerDefend': True},
        # Surge cancel dodge
        {'attackRoll': {'acc': 4, 'dmg': 3, 'surge': 1},
         'defenseRoll': {'block': 0, 'evade': 0, 'dodge': True, 'color': 'white'},
         'attackerConds': [], 'defenderConds': [],
         'isRanged': False,
         'surgeCancelDodge': True},
        # Cunning + evade
        {'attackRoll': {'acc': 4, 'dmg': 5, 'surge': 0},
         'defenseRoll': {'block': 1, 'evade': 2, 'dodge': False, 'color': 'white'},
         'attackerConds': [], 'defenderConds': [],
         'isRanged': False,
         'hasCunning': True},
        # Pierce through block
        {'attackRoll': {'acc': 4, 'dmg': 3, 'surge': 2},
         'defenseRoll': {'block': 5, 'evade': 0, 'dodge': False, 'color': 'white'},
         'attackerConds': [], 'defenderConds': [],
         'isRanged': False,
         'surgePierce': 3},
        # Weakened attacker + defender
        {'attackRoll': {'acc': 4, 'dmg': 3, 'surge': 0},
         'defenseRoll': {'block': 2, 'evade': 0, 'dodge': False, 'color': 'white'},
         'attackerConds': ['Weaken'], 'defenderConds': ['Weaken'],
         'isRanged': False},
        # Hidden defender imposes accuracy penalty
        {'attackRoll': {'acc': 3, 'dmg': 4, 'surge': 0},
         'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False, 'color': 'white'},
         'attackerConds': [], 'defenderConds': ['Hide'],
         'isRanged': True, 'distanceToTarget': 2},
        # Max damage clamp
        {'attackRoll': {'acc': 4, 'dmg': 10, 'surge': 0},
         'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False, 'color': 'white'},
         'attackerConds': [], 'defenderConds': [],
         'isRanged': False,
         'maxDamageToDefender': 3},
    ]


def run_cases(n: int, seed: int = 42) -> Dict[str, Any]:
    rng = random.Random(seed)
    cases: List[Dict[str, Any]] = list(_edge_cases())
    # Fill the rest with fuzzed.
    for i in range(n):
        cases.append(_make_combat(i, rng))

    passed = 0
    failed = 0
    fails: List[Dict[str, Any]] = []
    for idx, combat in enumerate(cases):
        js = apply_js(combat)
        py = apply_python(combat)
        if not js.get('ok'):
            failed += 1
            fails.append({'idx': idx, 'status': 'ERROR_JS',
                          'error': js.get('error'), 'combat': combat})
            continue
        if not py.get('ok'):
            failed += 1
            fails.append({'idx': idx, 'status': 'ERROR_PY',
                          'error': py.get('error'), 'combat': combat})
            continue
        diffs = diff_results(js, py)
        if not diffs:
            passed += 1
        else:
            failed += 1
            fails.append({
                'idx': idx, 'status': 'FAIL',
                'combat': combat,
                'diffs': diffs[:8],
                'js_result': js.get('result'),
                'py_result': py.get('result'),
            })
    return {
        'total': len(cases), 'passed': passed, 'failed': failed,
        'fails': fails,
    }


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='Combat-math parity harness')
    ap.add_argument('--cases', type=int, default=200)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args(argv)

    report = run_cases(args.cases, seed=args.seed)

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f'combat parity: {report["passed"]}/{report["total"]} PASS, '
              f'{report["failed"]} failures')
        for f in report['fails'][:10]:
            print(f'  [{f["status"]}] case #{f["idx"]}')
            for d in f.get('diffs', [])[:4]:
                print(f'    {d}')
            if 'error' in f:
                print(f'    {f["error"][:200]}')
    return 0 if report['failed'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
