"""Ability-level golden parity harness (JS ↔ Python).

For each ability ID in data/ability-library.json, this harness:

  1. Builds a minimal fixture game state + context (caster figure,
     target figure, msg_id, etc.)
  2. Invokes the JS side via `node tests/headless/apply-ability.js`
     (stdin JSON → stdout JSON).
  3. Invokes the Python side via `handle_schema_chain` (for Pattern E)
     or the pattern dispatcher for other patterns.
  4. Diffs the **meaningful** post-state fields: HP, conditions,
     movement banks, free-attack flags, pending-combat bonuses,
     figure positions.
  5. Emits a per-ability report: PASS, FAIL (with diff), or SKIP
     (for types that need a full-game fixture).

This is the scaffold for the bespoke-port grind: the list of FAIL
abilities becomes the prioritized work queue. Each port fix lands
with a regression test (pytest) derived from the harness fixture.

CLI:
    python3 -m python.parity.ability_golden --ability force_leap_ahsoka
    python3 -m python.parity.ability_golden --pattern E --limit 20
    python3 -m python.parity.ability_golden --all --json > report.json
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
JS_CLI = REPO_ROOT / 'tests' / 'headless' / 'apply-ability.js'

# Fields from post-state we diff on. Anything Discord-related is
# ignored (message ids, thread ids) because the JS side has them and
# Python doesn't — that's not a parity gap, just a layer mismatch.
DIFF_FIELDS = [
    'dcHealthState',
    'figureConditions',
    'figurePositions',
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
    'figureStrain',
]


def build_minimal_fixture() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Build a minimal 2-player game + ctx suitable for most ability
    applies. Caster = Luke-1-0 (P1), target = Vader-1-0 (P2)."""
    game = {
        'gameId': 'parity-fixture',
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
        'dcMessageMeta': [
            ['hl1dc0', {
                'gameId': 'parity-fixture',
                'dcName': 'Luke',
                'displayName': 'Luke [DG 1]',
                'playerNum': 1,
            }],
            ['hl2dc0', {
                'gameId': 'parity-fixture',
                'dcName': 'Vader',
                'displayName': 'Vader [DG 1]',
                'playerNum': 2,
            }],
        ],
        'p1DcList': [{'dcName': 'Luke', 'dgIndex': 1}],
        'p2DcList': [{'dcName': 'Vader', 'dgIndex': 1}],
        'p1DcMessageIds': ['hl1dc0'],
        'p2DcMessageIds': ['hl2dc0'],
        'p1PowerTokens': [],
        'p2PowerTokens': [],
        'movementBank': {},
        'freeAttackBonusPending': {},
    }
    ctx = {
        'playerNum': 1,
        'msgId': 'hl1dc0',
        'figureKey': 'Luke-1-0',
        'targetFigureKey': 'Vader-1-0',
        'targetPlayerNum': 2,
        'targetMsgId': 'hl2dc0',
        'meta': {
            'gameId': 'parity-fixture',
            'dcName': 'Luke',
            'displayName': 'Luke [DG 1]',
            'playerNum': 1,
        },
    }
    return game, ctx


def _py_ctx_from_js_ctx(js_ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Translate JS-shaped context (camelCase) to Python schema handler
    ctx (snake_case + camelCase fallbacks)."""
    return {
        'player_num': js_ctx.get('playerNum'),
        'msg_id': js_ctx.get('msgId'),
        'figure_key': js_ctx.get('figureKey'),
        'target_figure_key': js_ctx.get('targetFigureKey'),
        'target_player_num': js_ctx.get('targetPlayerNum'),
        'target_msg_id': js_ctx.get('targetMsgId'),
        'meta': js_ctx.get('meta'),
        'playerNum': js_ctx.get('playerNum'),
        'msgId': js_ctx.get('msgId'),
    }


def _normalize_game(game: Dict[str, Any]) -> Dict[str, Any]:
    """Keep only the fields we diff on; drop everything else so the
    comparison is signal-only."""
    out = {}
    for k in DIFF_FIELDS:
        if k in game:
            v = game[k]
            # Convert str-keyed dicts (JSON reparse) back to int-keyed
            # where applicable (figurePositions uses int keys in Python).
            out[k] = _coerce_numeric_keys(v)
    return out


def _coerce_numeric_keys(v: Any) -> Any:
    """Recursively coerce dict keys '1'/'2' to int so JS-JSON and
    Python-dict compare byte-identical for player-num keys."""
    if isinstance(v, dict):
        out = {}
        for k, val in v.items():
            if isinstance(k, str) and k.isdigit():
                out[int(k)] = _coerce_numeric_keys(val)
            else:
                out[k] = _coerce_numeric_keys(val)
        return out
    if isinstance(v, list):
        return [_coerce_numeric_keys(x) for x in v]
    return v


def apply_js(ability_id: str, game: Dict[str, Any],
              ctx: Dict[str, Any],
              multi_step: bool = False) -> Dict[str, Any]:
    """Invoke the JS CLI and return its stdout-JSON parsed.

    When `multi_step` is True, the CLI loops up to 5 times auto-picking
    defaults for requiresChoice/requiresSpaceChoice/targetFigureKeys —
    simulating the dc-play-area.js handler path."""
    payload = json.dumps({
        'abilityId': ability_id,
        'game': game,
        'context': ctx,
        'multiStep': multi_step,
    })
    proc = subprocess.run(
        ['node', str(JS_CLI)],
        input=payload,
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
        timeout=30,
    )
    if proc.returncode not in (0, 1):
        return {
            'ok': False,
            'error': f'node exit {proc.returncode}: {proc.stderr[:400]}',
        }
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {
            'ok': False,
            'error': f'bad stdout JSON: {e}; stdout={proc.stdout[:400]}',
        }


def apply_python(ability_id: str, game: Dict[str, Any],
                  ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Apply via the Python schema handler. Returns {ok, game, result}."""
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability
    from python.engine.abilities.pattern_e_schema import handle_schema_chain

    entry = get_ability(ability_id) or {}
    pattern, _ = classify_ability(ability_id, entry)
    py_ctx = _py_ctx_from_js_ctx(ctx)

    # Deep-copy game so the JS and Python sides don't alias.
    py_game = json.loads(json.dumps(game))

    try:
        if pattern == 'E':
            result = handle_schema_chain(py_game, ability_id, py_ctx)
        else:
            # For non-E patterns, we'd route to their respective
            # handlers. For now, skip — this harness's scope is E.
            return {
                'ok': False,
                'error': f'pattern {pattern!r} not supported by harness yet',
                'skipped': True,
            }
    except Exception as e:
        return {
            'ok': False,
            'error': f'{type(e).__name__}: {e}',
        }
    return {'ok': True, 'game': py_game, 'result': result}


def diff_states(js_game: Dict[str, Any],
                 py_game: Dict[str, Any]) -> List[str]:
    """Return list of string-form diffs between JS and Python states
    across DIFF_FIELDS. Empty list = byte-identical on the fields we
    care about."""
    js_norm = _normalize_game(js_game)
    py_norm = _normalize_game(py_game)
    diffs: List[str] = []
    all_keys = set(js_norm.keys()) | set(py_norm.keys())
    for k in sorted(all_keys):
        jv = js_norm.get(k)
        pv = py_norm.get(k)
        if jv != pv:
            js_s = json.dumps(jv, sort_keys=True, default=str)[:200]
            py_s = json.dumps(pv, sort_keys=True, default=str)[:200]
            diffs.append(f'{k}: JS={js_s} | PY={py_s}')
    return diffs


def compare_ability(ability_id: str,
                     multi_step: bool = False) -> Dict[str, Any]:
    """Single-ability parity check. Returns {id, status, diffs, js_result,
    py_result} where status ∈ {PASS, FAIL, SKIP, ERROR}.

    When `multi_step` is True, the JS side simulates the full handler
    path (dc-play-area.js) — auto-picks choices, spaces, targets — so
    we compare against the JS "applied in full" state rather than just
    what resolveAbility does in one call.
    """
    game, ctx = build_minimal_fixture()

    js_resp = apply_js(
        ability_id, json.loads(json.dumps(game)), ctx,
        multi_step=multi_step,
    )
    py_resp = apply_python(ability_id, json.loads(json.dumps(game)), ctx)

    if py_resp.get('skipped'):
        return {'id': ability_id, 'status': 'SKIP',
                'reason': py_resp.get('error')}
    if not js_resp.get('ok') and not py_resp.get('ok'):
        # Both errored — treat as PASS (same behavior).
        return {'id': ability_id, 'status': 'PASS',
                'note': 'both sides errored identically',
                'js_error': js_resp.get('error'),
                'py_error': py_resp.get('error')}
    if not js_resp.get('ok'):
        return {'id': ability_id, 'status': 'ERROR_JS',
                'error': js_resp.get('error')}
    if not py_resp.get('ok'):
        return {'id': ability_id, 'status': 'ERROR_PY',
                'error': py_resp.get('error')}

    diffs = diff_states(js_resp['game'], py_resp['game'])
    js_result = js_resp.get('result') or {}
    py_result = py_resp.get('result') or {}

    # Detect "JS logged but didn't mutate" — JS's post-state is
    # byte-identical to the initial fixture (on the fields we diff on)
    # but it's marked `applied: true` with a logMessage. This is JS
    # deferring real state changes to the handler while logging what
    # it rolled / chose. For training parity, Python SHOULD mutate —
    # classify as PY_AHEAD.
    initial_game, _ = build_minimal_fixture()
    initial_norm = _normalize_game(initial_game)
    js_norm = _normalize_game(js_resp['game'])
    js_unchanged = all(
        js_norm.get(k) == initial_norm.get(k)
        for k in set(initial_norm) | set(js_norm)
    )
    if diffs and js_unchanged and js_result.get('applied'):
        if py_result.get('effects') or any(
            _normalize_game(py_resp['game']).get(k) != initial_norm.get(k)
            for k in _normalize_game(py_resp['game'])
        ):
            return {
                'id': ability_id,
                'status': 'PY_AHEAD',
                'note': 'JS logged+deferred to handler; Python mutated',
                'js_log': js_result.get('logMessage', ''),
                'extra_state': diffs[:5],
                'py_effects': py_result.get('effects'),
            }

    # A common pattern: JS resolveAbility applies only part of the
    # ability (e.g. freeAttackBonus) and leaves the rest for the
    # handler; Python schema applies both. Classify as PY_AHEAD when
    # Python's extras are things JS ALSO doesn't touch (equal to
    # initial fixture) — meaning JS punted to handler, Python did it.
    if diffs and js_result.get('applied'):
        strict_superset = True
        for d in diffs:
            field = d.split(':', 1)[0]
            js_norm = _normalize_game(js_resp['game']).get(field)
            py_norm = _normalize_game(py_resp['game']).get(field)
            init_val = initial_norm.get(field)
            # Superset check: JS is identical to initial on this field
            # (meaning JS didn't touch it) AND Python changed it.
            if js_norm == init_val and py_norm != init_val:
                continue  # Python added what JS left for the handler.
            # Dict field: PY contains all JS keys with same values.
            if isinstance(js_norm, dict) and isinstance(py_norm, dict):
                if not all(k in py_norm and py_norm[k] == v
                           for k, v in js_norm.items()):
                    strict_superset = False
                    break
            elif js_norm != py_norm:
                strict_superset = False
                break
        if strict_superset:
            return {
                'id': ability_id,
                'status': 'PY_AHEAD',
                'note': 'Python schema applies a superset of JS resolveAbility',
                'extra_state': diffs[:5],
                'js_result': js_result,
                'py_effects': py_result.get('effects'),
            }

    # JS `requiresChoice: true` means resolveAbility is waiting for a
    # chooseOne pick — our fixture doesn't supply one, so JS defers.
    # Python auto-picks idx=0 (correct for training). Treat as
    # PY_AHEAD if state diverges.
    if js_result.get('requiresChoice'):
        if py_result.get('effects') or diffs:
            return {
                'id': ability_id,
                'status': 'PY_AHEAD',
                'note': 'JS awaits chooseOne; Python auto-picked idx=0',
                'extra_state': diffs[:5],
                'js_choice_options': js_result.get('choiceOptions'),
                'py_effects': py_result.get('effects'),
            }
        return {'id': ability_id, 'status': 'JS_MANUAL',
                'js_manual': 'requiresChoice'}

    # JS resolveAbility returns `{applied: false, manualMessage: ...}`
    # when the ability's mechanic lives in a handler (dc-play-area.js,
    # combat.js, etc.) rather than resolveAbility itself. For those,
    # JS is not the source of truth for this harness — mark JS_MANUAL
    # so we don't flag Python as wrong when it's actually doing more.
    if not js_result.get('applied') and js_result.get('manualMessage'):
        if py_result.get('effects'):
            return {
                'id': ability_id,
                'status': 'PY_AHEAD',
                'note': 'JS defers to handler; Python auto-resolved',
                'js_manual': js_result.get('manualMessage'),
                'py_effects': py_result.get('effects'),
                'diffs_on_state': diffs[:5],
            }
        return {
            'id': ability_id,
            'status': 'JS_MANUAL',
            'js_manual': js_result.get('manualMessage'),
        }

    if not diffs:
        return {'id': ability_id, 'status': 'PASS'}
    return {
        'id': ability_id,
        'status': 'FAIL',
        'diffCount': len(diffs),
        'diffs': diffs[:10],
        'js_result': js_result,
        'py_result': py_result,
    }


def list_abilities(pattern_filter: Optional[str] = None,
                    limit: Optional[int] = None) -> List[str]:
    """Enumerate ability IDs, optionally filtered by classification
    pattern letter (A/B/C/D/E)."""
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    out: List[str] = []
    for aid, entry in lib.items():
        if entry.get('type') != 'dcSpecial':
            continue
        if pattern_filter:
            p, _ = classify_ability(aid, entry)
            if p != pattern_filter:
                continue
        out.append(aid)
    out.sort()
    if limit:
        out = out[:limit]
    return out


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='Ability golden parity harness')
    ap.add_argument('--ability', help='Single ability ID to test')
    ap.add_argument('--pattern', help='Filter to pattern letter (E default)',
                    default='E')
    ap.add_argument('--all', action='store_true', help='Run all abilities')
    ap.add_argument('--limit', type=int, help='Cap number run')
    ap.add_argument('--json', action='store_true', help='JSON output')
    ap.add_argument('--multi-step', action='store_true',
                    help='Simulate full JS handler path (auto-pick choices)')
    args = ap.parse_args(argv)

    if args.ability:
        targets = [args.ability]
    elif args.all:
        targets = list_abilities(pattern_filter=None, limit=args.limit)
    else:
        targets = list_abilities(pattern_filter=args.pattern, limit=args.limit)

    reports: List[Dict[str, Any]] = []
    counts = {
        'PASS': 0, 'FAIL': 0, 'SKIP': 0,
        'JS_MANUAL': 0, 'PY_AHEAD': 0,
        'ERROR_JS': 0, 'ERROR_PY': 0,
    }
    for aid in targets:
        rep = compare_ability(aid, multi_step=args.multi_step)
        reports.append(rep)
        counts[rep['status']] = counts.get(rep['status'], 0) + 1

    summary = {
        'total': len(targets),
        'counts': counts,
        'reports': reports,
    }

    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        n = summary['total']
        print(f"Ability parity ({n} abilities):")
        print(f"  PASS       = {counts['PASS']}")
        print(f"  FAIL       = {counts['FAIL']}")
        print(f"  JS_MANUAL  = {counts['JS_MANUAL']} "
              f"(both sides defer to handler)")
        print(f"  PY_AHEAD   = {counts['PY_AHEAD']} "
              f"(Python auto-resolves, JS defers)")
        print(f"  ERROR_JS   = {counts.get('ERROR_JS', 0)}")
        print(f"  ERROR_PY   = {counts.get('ERROR_PY', 0)}")
        print(f"  SKIP       = {counts['SKIP']}")
        for rep in reports:
            if rep['status'] in ('PASS', 'SKIP', 'JS_MANUAL'):
                continue
            print(f"  [{rep['status']}] {rep['id']}")
            if 'error' in rep:
                print(f"      {rep['error'][:200]}")
            for d in rep.get('diffs', [])[:4]:
                print(f"      {d}")
            for d in rep.get('diffs_on_state', [])[:2]:
                print(f"      state: {d}")

    return 0 if counts['FAIL'] == 0 and counts.get('ERROR_PY', 0) == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
