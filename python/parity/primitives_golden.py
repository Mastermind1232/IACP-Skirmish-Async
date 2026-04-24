"""State-primitive parity harness: atomic damage / condition / etc.

The orchestrator is hard to parity-test directly (JS side is async +
Discord-glued). But the orchestrator composes a small set of atomic
primitives that mutate game state. If each primitive is byte-identical
JS ↔ Python, and the orchestrator glue is just function calls in the
same order, state divergence is impossible at the primitive layer.

Verified primitives:
  - reduce_hp / reduceHp
  - heal_hp / healHp
  - apply_condition / applyCondition
  - filter_condition / filterCondition

Each runs a fuzz of realistic inputs and asserts post-state identity.

CLI:
    python3 -m python.parity.primitives_golden --cases 100
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
JS_CLI = REPO_ROOT / 'tests' / 'headless' / 'state-primitive.js'


def _run_js(op: str, args: List[Any]) -> Dict[str, Any]:
    payload = json.dumps({'op': op, 'args': args})
    proc = subprocess.run(
        ['node', str(JS_CLI)],
        input=payload, capture_output=True, text=True,
        cwd=str(REPO_ROOT), timeout=30,
    )
    if proc.returncode not in (0, 1):
        return {'ok': False, 'error': f'node exit {proc.returncode}'}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {'ok': False, 'error': str(e)}


def _normalize_result(r: Any) -> Any:
    """JS `undefined`/missing values serialize to absent keys; Python may
    return explicit None. Normalize both sides to drop None/undefined."""
    if isinstance(r, dict):
        return {k: _normalize_result(v) for k, v in r.items()
                if v is not None}
    if isinstance(r, list):
        return [_normalize_result(x) for x in r]
    return r


def _case_reduce_hp(rng: random.Random) -> Dict[str, Any]:
    cur = rng.randint(1, 12)
    max_hp = rng.randint(cur, 15)
    damage = rng.randint(0, 20)
    health = {'m1': [[cur, max_hp]]}
    game = {'gameId': 'parity', 'totalDamageReceived': {1: 0, 2: 0}}
    return {
        'op': 'reduce_hp',
        'args': [health, game, 'm1', 0, damage, 1],
        'expected_fields': ['newHp', 'maxHp', 'prevHp', 'wasDefeated'],
    }


def _case_heal_hp(rng: random.Random) -> Dict[str, Any]:
    max_hp = rng.randint(5, 15)
    cur = rng.randint(1, max_hp)
    amount = rng.randint(0, 10)
    health = {'m1': [[cur, max_hp]]}
    game = {'gameId': 'parity'}
    return {
        'op': 'heal_hp',
        'args': [health, game, 'm1', 0, amount, 1],
        'expected_fields': ['newHp', 'maxHp', 'healed'],
    }


def _case_apply_condition(rng: random.Random) -> Dict[str, Any]:
    cond = rng.choice(['Focus', 'Hide', 'Stun', 'Bleed', 'Weaken'])
    pre = rng.choice([None, ['Focus'], ['Bleed', 'Stun']])
    fc = {'Luke-0-0': list(pre)} if pre else {}
    game = {'gameId': 'parity', 'figureConditions': fc}
    return {
        'op': 'apply_condition',
        'args': [game, 'Luke-0-0', cond],
        'expected_fields': [],  # bool return
    }


def _case_filter_condition(rng: random.Random) -> Dict[str, Any]:
    pre = rng.choice([
        ['Focus'], ['Bleed', 'Stun'], ['Hide'], ['Focus', 'Hide', 'Bleed'],
    ])
    cond = rng.choice(pre + ['Weaken'])  # may target a missing cond
    game = {'gameId': 'parity',
            'figureConditions': {'Luke-0-0': list(pre)}}
    return {
        'op': 'filter_condition',
        'args': [game, 'Luke-0-0', cond],
        'expected_fields': [],
    }


_CASE_BUILDERS = {
    'reduce_hp': _case_reduce_hp,
    'heal_hp': _case_heal_hp,
    'apply_condition': _case_apply_condition,
    'filter_condition': _case_filter_condition,
}


def _apply_python(case: Dict[str, Any]) -> Dict[str, Any]:
    op = case['op']
    args = case['args']
    try:
        if op == 'reduce_hp':
            from python.engine.mechanics.damage_helpers import reduce_hp
            health, game, msg_id, fig_idx, damage, pn = args
            # deepcopy to isolate
            health = json.loads(json.dumps(health))
            game = json.loads(json.dumps(game))
            result = reduce_hp(health, game, msg_id, fig_idx, damage, pn)
            return {'ok': True, 'op': op, 'result': result,
                    'state': {'dcHealthState': health, 'game': game}}
        if op == 'heal_hp':
            from python.engine.mechanics.damage_helpers import heal_hp
            health, game, msg_id, fig_idx, amount, pn = args
            health = json.loads(json.dumps(health))
            game = json.loads(json.dumps(game))
            result = heal_hp(health, game, msg_id, fig_idx, amount, pn)
            return {'ok': True, 'op': op, 'result': result,
                    'state': {'dcHealthState': health, 'game': game}}
        if op == 'apply_condition':
            from python.engine.mechanics.conditions import apply_condition
            game, fk, cond = args
            game = json.loads(json.dumps(game))
            result = apply_condition(game, fk, cond)
            return {'ok': True, 'op': op, 'result': result,
                    'state': {'game': game}}
        if op == 'filter_condition':
            from python.engine.mechanics.conditions import filter_condition
            game, fk, cond = args
            game = json.loads(json.dumps(game))
            result = filter_condition(game, fk, cond)
            return {'ok': True, 'op': op, 'result': result,
                    'state': {'game': game}}
    except Exception as e:
        return {'ok': False, 'op': op,
                'error': f'{type(e).__name__}: {e}'}
    return {'ok': False, 'op': op, 'error': 'unknown op'}


def _compare(js_out: Dict[str, Any],
             py_out: Dict[str, Any]) -> List[str]:
    diffs: List[str] = []
    if not js_out.get('ok'):
        diffs.append(f'JS_ERR: {js_out.get("error")}')
    if not py_out.get('ok'):
        diffs.append(f'PY_ERR: {py_out.get("error")}')
    if diffs:
        return diffs
    # Compare return value (bool / dict).
    jr = _normalize_result(js_out.get('result'))
    pr = _normalize_result(py_out.get('result'))
    if jr != pr:
        diffs.append(f'result: JS={jr!r} PY={pr!r}')
    # Compare mutated state (dcHealthState + game.figureConditions).
    js_state = _normalize_result(js_out.get('state') or {})
    py_state = _normalize_result(py_out.get('state') or {})
    # Focus only on fields the primitive touches.
    for key in ('dcHealthState', 'game'):
        js_v = js_state.get(key)
        py_v = py_state.get(key)
        if js_v != py_v:
            diffs.append(f'state.{key}: JS={js_v!r} PY={py_v!r}')
    return diffs


def run_cases(ops: List[str], n_each: int, seed: int = 42) -> Dict[str, Any]:
    rng = random.Random(seed)
    reports: List[Dict[str, Any]] = []
    counts = {'PASS': 0, 'FAIL': 0, 'ERROR': 0}
    for op in ops:
        builder = _CASE_BUILDERS[op]
        for i in range(n_each):
            case = builder(rng)
            js = _run_js(op, case['args'])
            py = _apply_python(case)
            diffs = _compare(js, py)
            if not diffs:
                counts['PASS'] += 1
                reports.append({'op': op, 'i': i, 'status': 'PASS'})
            else:
                counts['FAIL' if 'ERR' not in ''.join(diffs) else 'ERROR'] += 1
                reports.append({
                    'op': op, 'i': i, 'status': 'FAIL',
                    'case': case['args'], 'diffs': diffs[:4],
                })
    return {'counts': counts, 'reports': reports}


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='State-primitive parity harness')
    ap.add_argument('--cases', type=int, default=20)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args(argv)
    ops = list(_CASE_BUILDERS.keys())
    report = run_cases(ops, args.cases, args.seed)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f'primitives parity: {report["counts"]}')
        for r in report['reports'][:15]:
            if r['status'] != 'PASS':
                print(f'  [{r["status"]}] {r["op"]}#{r["i"]}')
                for d in r.get('diffs', []):
                    print(f'    {d}')
    return 0 if report['counts'].get('FAIL', 0) == 0 and report['counts'].get('ERROR', 0) == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
