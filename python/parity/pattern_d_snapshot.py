"""Snapshot-based regression oracle for Pattern D abilities.

Pattern D abilities are trigger-bus routed (combat-declare,
activation-start, post-deploy, etc.) rather than click-to-activate.
This harness fires each ability via its registered handler on a
minimal fixture and records the post-state for regression testing.

Why this is coarser than the Pattern E harness
-----------------------------------------------
Pattern D triggers bring their own contextual requirements (combat
object, attacker+defender figure keys, round numbers, phase gates)
that vary per trigger. This harness supplies a generic fixture that
exercises the handler's entry path; handlers that require richer ctx
return early with a gating response. That's fine for regression
tracking — the snapshot captures exactly what the handler does with
what's provided, so any silent behavioral change trips the diff.

CLI:
    python3 -m python.parity.pattern_d_snapshot           # write
    python3 -m python.parity.pattern_d_snapshot --check   # diff
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SNAP_DIR = (REPO_ROOT / 'python' / 'parity' / 'oracles' / 'abilities'
            / '_pattern_d_snapshots')

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
    'mobileMovementActive',
    'pendingCombat',
    'pendingOverrideAttackDice',
    'hopOnPushActive',
    'figurePowerTokens',
    'pendingBoltslinger',
    'pendingSidewinder',
    'pendingCoordinatedRaid',
]


def _ensure_registered() -> None:
    """Install Pattern D stubs, overlay extras, then bespoke handlers.

    Order matters: stubs register everything, extras overwrite 129
    with real handlers, bespoke overwrites the remaining 32 stubs.
    Bespoke install is invoked explicitly (not relying on the one-time
    import side-effect) because _ensure_registered may run multiple
    times per session and install_pattern_d_stubs wipes prior state.
    """
    from python.engine.abilities.pattern_d import install_pattern_d_stubs
    from python.engine.abilities.pattern_d_extras import install_pattern_d_batch2
    from python.engine.abilities.bespoke_d import install_bespoke_d_handlers
    install_pattern_d_stubs()
    install_pattern_d_batch2()
    install_bespoke_d_handlers()


def _list_pattern_d() -> List[str]:
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    out = []
    for aid, entry in lib.items():
        p, _ = classify_ability(aid, entry)
        if p == 'D':
            out.append(aid)
    out.sort()
    return out


def _fixture() -> tuple:
    """Minimal fixture for firing Pattern D triggers."""
    game = {
        'gameId': 'pattern-d-fixture',
        'round': 1,
        'figurePositions': {
            1: {'Luke-1-0': 'e5'},
            2: {'Vader-1-0': 'e8'},
        },
        'dcHealthState': {
            'hl1dc0': [[10, 10]],
            'hl2dc0': [[12, 12]],
        },
        'figureConditions': {},
        'figureStrain': {},
        'figurePowerTokens': {},
        'dcMessageMeta': [
            ['hl1dc0', {
                'gameId': 'pattern-d-fixture',
                'dcName': 'Luke', 'displayName': 'Luke [DG 1]',
                'playerNum': 1,
            }],
            ['hl2dc0', {
                'gameId': 'pattern-d-fixture',
                'dcName': 'Vader', 'displayName': 'Vader [DG 1]',
                'playerNum': 2,
            }],
        ],
        'p1DcList': [{'dcName': 'Luke', 'dgIndex': 1}],
        'p2DcList': [{'dcName': 'Vader', 'dgIndex': 1}],
        'p1DcMessageIds': ['hl1dc0'],
        'p2DcMessageIds': ['hl2dc0'],
    }
    # Generic combat object for combat-* triggers.
    combat = {
        'attackerFigureKey': 'Luke-1-0',
        'attackerPlayerNum': 1,
        'attackerMsgId': 'hl1dc0',
        'defenderFigureKey': 'Vader-1-0',
        'defenderPlayerNum': 2,
        'defenderMsgId': 'hl2dc0',
        'attackType': 'ranged',
        'phase': 'declare',
    }
    ctx = {
        'combat': combat,
        'attacker_figure_key': 'Luke-1-0',
        'defender_figure_key': 'Vader-1-0',
        'figure_key': 'Luke-1-0',
        'player_num': 1,
        'msg_id': 'hl1dc0',
        'meta': game['dcMessageMeta'][0][1],
        'round': 1,
    }
    return game, ctx


def _apply(ability_id: str) -> Dict[str, Any]:
    """Fire the Pattern D handler; return filtered post-state + result."""
    random.seed(42)
    _ensure_registered()
    from python.engine.abilities.pattern_d import get_handler_for
    info = get_handler_for(ability_id)
    if info is None:
        return {'error': 'no handler registered'}
    trigger, handler = info
    game, ctx = _fixture()
    try:
        result = handler(game, ability_id, ctx)
    except Exception as e:
        return {
            'trigger': trigger,
            'error': f'{type(e).__name__}: {e}',
        }
    out = {'trigger': trigger}
    for f in SNAP_FIELDS:
        if f in game and game[f] not in (None, {}, []):
            out[f] = _coerce_keys(game[f])
    if isinstance(result, dict):
        out['_result_keys'] = sorted(
            k for k in result
            if k in ('applied', 'gated_by', 'log_message', 'pending_key')
        )
        if 'applied' in result:
            out['_applied'] = result['applied']
        if 'gated_by' in result:
            out['_gated_by'] = result['gated_by']
    return out


def _coerce_keys(v: Any) -> Any:
    if isinstance(v, dict):
        out = {}
        for k, val in v.items():
            if isinstance(k, int):
                out[str(k)] = _coerce_keys(val)
            else:
                out[k] = _coerce_keys(val)
        return out
    if isinstance(v, list):
        return [_coerce_keys(x) for x in v]
    return v


def write_snapshots() -> Dict[str, Any]:
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    ids = _list_pattern_d()
    written = 0
    for aid in ids:
        snap = _apply(aid)
        (SNAP_DIR / f'{aid}.json').write_text(
            json.dumps(snap, indent=2, sort_keys=True) + '\n'
        )
        written += 1
    return {'written': written, 'dir': str(SNAP_DIR)}


def check_snapshots() -> Dict[str, Any]:
    ids = _list_pattern_d()
    matched = 0
    missing = []
    mismatches = []
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
    ap = argparse.ArgumentParser(description='Pattern D snapshot oracle')
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args(argv)
    if args.check:
        r = check_snapshots()
        print(f"D snapshots: {r['matched']}/{r['total']} match, "
              f"{r['mismatched']} mismatched, {len(r['missing'])} missing")
        for m in r['mismatches'][:20]:
            print(f"  MISMATCH {m['id']}: {m['diff_fields']}")
        if r['missing']:
            print(f"  MISSING: {r['missing'][:20]}")
        return 0 if r['mismatched'] == 0 and not r['missing'] else 1
    r = write_snapshots()
    print(f"wrote {r['written']} snapshots to {r['dir']}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
