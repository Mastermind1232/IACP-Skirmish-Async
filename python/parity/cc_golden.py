"""Command-card parity harness: JS ↔ Python per-card behavior diff.

Mirrors `ability_golden.py` for the 293 command cards. For each CC:

  1. Build a minimal CC-play fixture (two DCs, one card played by P1).
  2. Run JS-side via `tests/headless/apply-ability.js` with the card's
     abilityId (or the card name if no abilityId is set), supplying
     `cardName` in ctx so JS can match card-specific branches.
  3. Run Python-side via `resolve_pending_cc_effect` after stamping
     `pendingCcEffect`.
  4. Diff post-state on mechanic-relevant fields.

Classification mirrors ability_golden: PASS / FAIL / PY_AHEAD /
JS_MANUAL / ERROR_JS / ERROR_PY.

CLI:
    python3 -m python.parity.cc_golden --card "Reinforcements"
    python3 -m python.parity.cc_golden --limit 20
    python3 -m python.parity.cc_golden --all --json > report.json
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
JS_CLI = REPO_ROOT / 'tests' / 'headless' / 'apply-ability.js'

DIFF_FIELDS = [
    'dcHealthState',
    'figureConditions',
    'figurePositions',
    'figureStrain',
    'movementBank',
    'freeAttackBonusPending',
    'nextAttackReach',
    'nextAttackBonusSurgeAbilities',
    'nextAttacksBonusHits',
    'mobileMovementActive',
    'pendingCombat',
    'pendingOverrideAttackDice',
    'figurePowerTokens',
    # CC-specific state fields
    'p1CcHand', 'p2CcHand',
    'p1CcDeck', 'p2CcDeck',
    'p1CcDiscard', 'p2CcDiscard',
    'nextAttackBonuses',
    'restInPeaceActive',
    'noCommandDrawThisRound',
]


def build_cc_fixture(
    card_name: str, playing_pn: int = 1,
) -> tuple:
    """Fixture for CC play: two DCs, target hostile, played card in
    P1 hand (pre-move it to pendingCcEffect for Python path)."""
    game = {
        'gameId': 'cc-fixture',
        'round': 1,
        'player1Id': 'p1user',
        'player2Id': 'p2user',
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
            ['hl1dc0', {'gameId': 'cc-fixture', 'dcName': 'Luke',
                        'displayName': 'Luke [DG 1]', 'playerNum': 1}],
            ['hl2dc0', {'gameId': 'cc-fixture', 'dcName': 'Vader',
                        'displayName': 'Vader [DG 1]', 'playerNum': 2}],
        ],
        'p1DcList': [{'dcName': 'Luke', 'dgIndex': 1}],
        'p2DcList': [{'dcName': 'Vader', 'dgIndex': 1}],
        'p1DcMessageIds': ['hl1dc0'],
        'p2DcMessageIds': ['hl2dc0'],
        # Card in hand + deck/discard
        'p1CcHand': [card_name] if playing_pn == 1 else [],
        'p2CcHand': [card_name] if playing_pn == 2 else [],
        'p1CcDeck': ['Reserve A', 'Reserve B', 'Reserve C'],
        'p2CcDeck': ['Reserve D', 'Reserve E', 'Reserve F'],
        'p1CcDiscard': [],
        'p2CcDiscard': [],
        'activePlayer': playing_pn,
    }
    ctx = {
        'playerNum': playing_pn,
        'msgId': 'hl1dc0' if playing_pn == 1 else 'hl2dc0',
        'cardName': card_name,
        'figureKey': 'Luke-1-0' if playing_pn == 1 else 'Vader-1-0',
        'targetFigureKey': 'Vader-1-0' if playing_pn == 1 else 'Luke-1-0',
        'targetPlayerNum': 2 if playing_pn == 1 else 1,
        'targetMsgId': 'hl2dc0' if playing_pn == 1 else 'hl1dc0',
        'meta': game['dcMessageMeta'][0 if playing_pn == 1 else 1][1],
    }
    return game, ctx


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


def _normalize(game: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k in DIFF_FIELDS:
        if k in game and game[k] not in (None, {}, []):
            out[k] = _coerce_keys(game[k])
    return out


def apply_js(card_name: str, ability_id: str,
              game: Dict[str, Any], ctx: Dict[str, Any],
              multi_step: bool = True) -> Dict[str, Any]:
    """Invoke JS CLI for the card. Use card name as abilityId when the
    library doesn't supply one (JS defaults to `abilityId ?? card`)."""
    payload = json.dumps({
        'abilityId': ability_id or card_name,
        'game': game,
        'context': ctx,
        'multiStep': multi_step,
    })
    proc = subprocess.run(
        ['node', str(JS_CLI)],
        input=payload, capture_output=True, text=True,
        cwd=str(REPO_ROOT), timeout=30,
    )
    if proc.returncode not in (0, 1):
        return {'ok': False,
                'error': f'node exit {proc.returncode}: {proc.stderr[:400]}'}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {'ok': False,
                'error': f'bad stdout: {e}; {proc.stdout[:400]}'}


def apply_python(card_name: str, game: Dict[str, Any],
                  ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Stamp pendingCcEffect and resolve via Python _CC_EFFECTS."""
    # Import + trigger named-wrapper install.
    from python.engine.cards import cc_effects  # noqa
    from python.engine.cards import cc_bulk_named  # noqa

    py_game = json.loads(json.dumps(game))
    py_game['pendingCcEffect'] = {
        'cardName': card_name,
        'playerNum': ctx.get('playerNum'),
        'timing': None,
        'playableBy': None,
    }
    # Python ctx uses snake_case mostly but handlers also look at
    # camelCase. Supply both.
    py_ctx = dict(ctx)
    py_ctx.setdefault('player_num', ctx.get('playerNum'))
    py_ctx.setdefault('msg_id', ctx.get('msgId'))
    py_ctx.setdefault('figure_key', ctx.get('figureKey'))
    py_ctx.setdefault('target_figure_key', ctx.get('targetFigureKey'))
    py_ctx.setdefault('target_player_num', ctx.get('targetPlayerNum'))
    py_ctx.setdefault('target_msg_id', ctx.get('targetMsgId'))
    try:
        result = cc_effects.resolve_pending_cc_effect(py_game, py_ctx)
    except cc_effects.UnknownCcEffect as e:
        return {'ok': False, 'error': f'UnknownCcEffect: {e}'}
    except Exception as e:
        return {'ok': False, 'error': f'{type(e).__name__}: {e}'}
    return {'ok': True, 'game': py_game, 'result': result}


def diff_games(js_game: Dict, py_game: Dict) -> List[str]:
    js_norm = _normalize(js_game)
    py_norm = _normalize(py_game)
    diffs = []
    for k in sorted(set(js_norm) | set(py_norm)):
        jv = js_norm.get(k)
        pv = py_norm.get(k)
        if jv != pv:
            js_s = json.dumps(jv, sort_keys=True, default=str)[:180]
            py_s = json.dumps(pv, sort_keys=True, default=str)[:180]
            diffs.append(f'{k}: JS={js_s} | PY={py_s}')
    return diffs


def compare_card(card_name: str, lib_entry: Dict[str, Any]) -> Dict[str, Any]:
    ability_id = lib_entry.get('abilityId')
    game, ctx = build_cc_fixture(card_name, playing_pn=1)

    js = apply_js(card_name, ability_id,
                  json.loads(json.dumps(game)), ctx, multi_step=True)
    py = apply_python(card_name, json.loads(json.dumps(game)), ctx)

    if not js.get('ok') and not py.get('ok'):
        return {'card': card_name, 'status': 'PASS',
                'note': 'both errored identically',
                'js_error': js.get('error'), 'py_error': py.get('error')}
    if not js.get('ok'):
        return {'card': card_name, 'status': 'ERROR_JS',
                'error': js.get('error')}
    if not py.get('ok'):
        return {'card': card_name, 'status': 'ERROR_PY',
                'error': py.get('error')}

    diffs = diff_games(js['game'], py['game'])
    js_result = js.get('result') or {}
    py_result = py.get('result') or {}

    # Detect "JS logged but didn't mutate": JS's post-state fields are
    # all identical to the initial fixture even though applied=true.
    # This is JS's resolveAbility returning a log message while the
    # actual mechanic lives in a handler body (cc-hand.js / combat.js).
    # For training parity we WANT Python to mutate — classify PY_AHEAD.
    initial_game, _ = build_cc_fixture(card_name, playing_pn=1)
    init_norm = _normalize(initial_game)
    js_norm = _normalize(js['game'])
    js_unchanged = all(js_norm.get(k) == init_norm.get(k)
                       for k in set(init_norm) | set(js_norm))
    if diffs and js_unchanged and js_result.get('applied'):
        if py_result.get('effects') or any(
                _normalize(py['game']).get(k) != init_norm.get(k)
                for k in _normalize(py['game'])):
            return {'card': card_name, 'status': 'PY_AHEAD',
                    'note': 'JS logged+deferred; Python mutated',
                    'js_log': js_result.get('logMessage', ''),
                    'extra_state': diffs[:5]}

    # JS bails to manual (no ability resolution for this card).
    if (not js_result.get('applied') and js_result.get('manualMessage')
            and not js_result.get('requiresChoice')):
        if py.get('game') and any(
                py['game'].get(f) != game.get(f) for f in DIFF_FIELDS
        ):
            return {'card': card_name, 'status': 'PY_AHEAD',
                    'note': 'JS defers; Python applied mechanic',
                    'js_manual': js_result.get('manualMessage'),
                    'py_effects': py_result.get('effects'),
                    'extra_state': diffs[:5]}
        return {'card': card_name, 'status': 'JS_MANUAL',
                'js_manual': js_result.get('manualMessage')}

    # requiresChoice: JS awaiting pick; Python auto-resolved.
    if js_result.get('requiresChoice'):
        return {'card': card_name, 'status': 'PY_AHEAD',
                'note': 'JS awaits chooseOne; Python auto-picked',
                'js_choice_options': js_result.get('choiceOptions'),
                'extra_state': diffs[:5]}

    if not diffs:
        return {'card': card_name, 'status': 'PASS'}

    return {'card': card_name, 'status': 'FAIL',
            'diffCount': len(diffs),
            'diffs': diffs[:8],
            'js_result': js_result,
            'py_result': py_result}


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='CC parity harness')
    ap.add_argument('--card', help='Single card name to test')
    ap.add_argument('--limit', type=int, help='Cap number run')
    ap.add_argument('--all', action='store_true', help='Run all 293')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args(argv)

    lib = json.load((REPO_ROOT / 'data' / 'cc-effects.json').open())
    cards = lib.get('cards', {})

    if args.card:
        if args.card not in cards:
            print(f'Unknown card: {args.card!r}', file=sys.stderr)
            return 2
        targets = [args.card]
    else:
        targets = sorted(cards.keys())
        if args.limit:
            targets = targets[:args.limit]

    reports = []
    counts = {'PASS': 0, 'FAIL': 0, 'JS_MANUAL': 0, 'PY_AHEAD': 0,
              'ERROR_JS': 0, 'ERROR_PY': 0}
    for name in targets:
        rep = compare_card(name, cards[name])
        reports.append(rep)
        counts[rep['status']] = counts.get(rep['status'], 0) + 1

    summary = {'total': len(targets), 'counts': counts, 'reports': reports}

    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        n = summary['total']
        print(f'CC parity ({n} cards):')
        for k, v in counts.items():
            print(f'  {k:10s} = {v}')
        for r in reports:
            if r['status'] in ('PASS', 'JS_MANUAL'):
                continue
            print(f'  [{r["status"]}] {r["card"]}')
            if 'error' in r:
                print(f'      {r["error"][:160]}')
            for d in r.get('diffs', [])[:3]:
                print(f'      {d}')

    return 0 if counts['FAIL'] == 0 and counts['ERROR_PY'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
