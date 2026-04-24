"""Snapshot-based regression oracle for Pattern E abilities.

Strategy
--------
For each Pattern E dcSpecial ability, apply it through
`handle_schema_chain` on the minimal fixture and record the post-state
as JSON under `python/parity/oracles/abilities/_pattern_e_snapshots/`.

The accompanying pytest (`test_pattern_e_snapshots.py`) re-runs each
ability and asserts the fresh post-state matches the frozen snapshot.

Why this exists
---------------
The JS↔Python harness (`ability_golden.py`) can only compare against
JS `resolveAbility`. For 80/117 Pattern E abilities, JS defers the
mechanic to its handler body (which isn't callable from a CLI shim
without mocking Discord). Snapshot tests fill that gap: they freeze
the Python behavior we just got into a good state and fail loudly
if a future refactor changes any ability's post-state silently.

CLI
---
    python3 -m python.parity.ability_snapshot           # write snapshots
    python3 -m python.parity.ability_snapshot --check   # diff mode
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SNAP_DIR = (REPO_ROOT / 'python' / 'parity' / 'oracles' / 'abilities'
            / '_pattern_e_snapshots')

# Fields we snapshot on (mechanic-relevant post-state).
SNAP_FIELDS = [
    'dcHealthState',
    'figureConditions',
    'figurePositions',
    'figureStrain',
    'movementBank',
    'freeAttackBonusPending',
    'nextAttackBonusSurgeAbilities',
    'nextAttackReach',
    'nextAttacksBonusHits',
    'nextAttacksBonusAcc',
    'mobileMovementActive',
    'pendingCombat',
    'pendingOverrideAttackDice',
    'hopOnPushActive',
    'p1PowerTokens',
    'p2PowerTokens',
    'multiFireActive',
    'focusFireActive',
    'saberOrbitAttacksRemaining',
    'pendingSlingBarrage',
    'defeatedReturnQueue',
]


def _fixture() -> tuple:
    from python.parity.ability_golden import build_minimal_fixture
    return build_minimal_fixture()


def _apply(ability_id: str) -> Dict[str, Any]:
    """Apply an ability through Python schema handler; return post-state
    filtered to SNAP_FIELDS (+ effects).

    Seeds random before apply so dice-driven mechanics (rollOneDie) are
    deterministic across runs.
    """
    import random
    random.seed(42)
    from python.parity.ability_golden import (
        apply_python, build_minimal_fixture,
    )
    game, ctx = build_minimal_fixture()
    resp = apply_python(ability_id, game, ctx)
    if not resp.get('ok'):
        return {'error': resp.get('error')}
    post = resp['game']
    # Prune to snap fields; canonicalize numeric-str dict keys.
    out = {}
    for f in SNAP_FIELDS:
        if f in post and post[f] not in (None, {}, []):
            out[f] = _coerce_keys(post[f])
    effects = (resp.get('result') or {}).get('effects') or []
    # Keep effect labels only (actual values aren't stable across runs).
    out['_effect_labels'] = sorted({
        e.get('effect') for e in effects if isinstance(e, dict) and e.get('effect')
    })
    return out


def _coerce_keys(v: Any) -> Any:
    if isinstance(v, dict):
        out = {}
        for k, val in v.items():
            if isinstance(k, (int,)):
                out[str(k)] = _coerce_keys(val)
            else:
                out[k] = _coerce_keys(val)
        return out
    if isinstance(v, list):
        return [_coerce_keys(x) for x in v]
    return v


def _list_pattern_e() -> List[str]:
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    out = []
    for aid, entry in lib.items():
        if entry.get('type') != 'dcSpecial':
            continue
        p, _ = classify_ability(aid, entry)
        if p == 'E':
            out.append(aid)
    out.sort()
    return out


def write_snapshots() -> Dict[str, Any]:
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    ids = _list_pattern_e()
    written = 0
    for aid in ids:
        snap = _apply(aid)
        path = SNAP_DIR / f'{aid}.json'
        with path.open('w') as f:
            json.dump(snap, f, indent=2, sort_keys=True)
            f.write('\n')
        written += 1
    return {'written': written, 'dir': str(SNAP_DIR)}


def check_snapshots() -> Dict[str, Any]:
    """Diff every snapshot against a fresh apply. Returns
    {total, matched, mismatched, missing, mismatches[]}."""
    ids = _list_pattern_e()
    matched = 0
    missing: List[str] = []
    mismatches: List[Dict[str, Any]] = []
    for aid in ids:
        path = SNAP_DIR / f'{aid}.json'
        if not path.exists():
            missing.append(aid)
            continue
        expected = json.loads(path.read_text())
        actual = _apply(aid)
        if expected == actual:
            matched += 1
        else:
            mismatches.append({
                'id': aid,
                'diff_fields': sorted(
                    set(expected) ^ set(actual)
                    | {k for k in set(expected) & set(actual)
                       if expected[k] != actual[k]}
                )[:8],
            })
    return {
        'total': len(ids),
        'matched': matched,
        'mismatched': len(mismatches),
        'missing': missing,
        'mismatches': mismatches,
    }


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='Pattern E snapshot oracle')
    ap.add_argument('--check', action='store_true',
                    help='Diff mode: fail if any snapshot mismatches')
    args = ap.parse_args(argv)
    if args.check:
        report = check_snapshots()
        print(f"snapshots: {report['matched']}/{report['total']} match, "
              f"{report['mismatched']} mismatched, "
              f"{len(report['missing'])} missing")
        for m in report['mismatches'][:20]:
            print(f"  MISMATCH {m['id']}: {m['diff_fields']}")
        if report['missing']:
            print(f"  MISSING: {report['missing'][:20]}")
        return 0 if (report['mismatched'] == 0
                     and not report['missing']) else 1
    report = write_snapshots()
    print(f"wrote {report['written']} snapshots to {report['dir']}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
