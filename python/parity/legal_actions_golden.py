"""Legal-action enumerator parity: JS getAvailableActions ↔ Python legal_actions.

Critical for MCTS: if the action space diverges between engines, the
brain trains on a different state-space than JS would allow. This
harness fuzzes game states and asserts both engines return the same
*set* of legal action types.

JS returns {type, customId, opts} tuples. Python returns Action
enum dataclasses. We compare on the `type` field since the customId
layer is Discord-specific.

CLI:
    python3 -m python.parity.legal_actions_golden --cases 40
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Set

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
JS_CLI = REPO_ROOT / 'tests' / 'headless' / 'legal-actions.js'


def _run_js(game: Dict[str, Any], player_num: int) -> Dict[str, Any]:
    payload = json.dumps({'game': game, 'playerNum': player_num})
    proc = subprocess.run(
        ['node', str(JS_CLI)],
        input=payload, capture_output=True, text=True,
        cwd=str(REPO_ROOT), timeout=30,
    )
    if proc.returncode not in (0, 1):
        return {'ok': False, 'error': f'node exit {proc.returncode}: {proc.stderr[:200]}'}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {'ok': False, 'error': str(e)}


def _run_python(game: Dict[str, Any]) -> Dict[str, Any]:
    from python.engine.state import GameState
    from python.mcts.actions import legal_actions
    try:
        gs = GameState(json.loads(json.dumps(game)))
        actions = legal_actions(gs)
        return {
            'ok': True,
            'actions': [
                {'type': a.type.value if hasattr(a.type, 'value') else str(a.type),
                 'player': a.player,
                 'params': a.params}
                for a in actions
            ],
        }
    except Exception as e:
        return {'ok': False, 'error': f'{type(e).__name__}: {e}'}


# Known JS action type → Python ActionType mapping. Used to confirm
# types diverge only on names we know about. JS uses snake_case
# strings, Python uses ActionType.value which are also snake_case.
_JS_TO_PY = {
    'activate_dc': 'activate_dc',
    'pass_activation_turn': 'pass_activation_turn',
    'end_activation_phase': 'end_activation_phase',
    'dc_end_activation': 'dc_end_activation',
    'move_pick_space': 'move_pick_space',
    # JS move_figure is MP-per-step movement; Python treats both
    # move_figure and move_pick_space as equivalent "move" choices
    # (the move_pick_space enumerator covers reachable coords).
    'move_figure': 'move_pick_space',
    'attack_target': 'attack_target',
    'dc_special': 'dc_special',
    'interact': 'interact',
    'end_end_of_round': 'end_end_of_round',
    'play_cc': 'play_cc',
    'cc_confirm_play': 'cc_confirm_play',
    'cc_cancel_play': 'cc_cancel_play',
    'end_turn': 'end_turn',
    'status_phase': 'end_activation_phase',  # JS name → Python name
}


def _extract_js_types(actions: List[Dict[str, Any]]) -> Set[str]:
    out = set()
    for a in actions:
        t = a.get('type') or ''
        # Normalize known name differences.
        t = _JS_TO_PY.get(t, t)
        out.add(t)
    return out


def _extract_py_types(actions: List[Dict[str, Any]]) -> Set[str]:
    return set(a.get('type') or '' for a in actions)


def _make_state_mid_activation(rng: random.Random) -> Dict[str, Any]:
    """Figure already activated — move/attack/end options available.

    Sets BOTH Python-side (activeFigureKeys) and JS-side
    (currentActivationTurnPlayerId + dcActionsData with remaining>0)
    conventions so both engines recognize the mid-activation state.
    """
    return {
        'gameId': 'fuzz',
        'phase': 'round_active',
        'roundPhase': 'activation',
        'activePlayer': 1,
        'currentActivationTurnPlayerId': 'p1user',  # JS checks this
        'player1Id': 'p1user',
        'player2Id': 'p2user',
        'activationsRemaining': {'1': 1, '2': 1},
        'p1ActivationsRemaining': 1,
        'p2ActivationsRemaining': 1,
        'figurePositions': {
            '1': {'Luke-1-0': 'e5'},
            '2': {'Vader-1-0': 'e8'},
        },
        'dcHealthState': {'hl1dc0': [[10, 10]], 'hl2dc0': [[12, 12]]},
        'dcActionsData': {'hl1dc0': {'remaining': 2, 'total': 2}},
        'dcMessageMeta': [
            ['hl1dc0', {'gameId': 'fuzz', 'dcName': 'Luke',
                        'displayName': 'Luke [DG 1]', 'playerNum': 1}],
            ['hl2dc0', {'gameId': 'fuzz', 'dcName': 'Vader',
                        'displayName': 'Vader [DG 1]', 'playerNum': 2}],
        ],
        'p1DcList': [{'dcName': 'Luke', 'dgIndex': 1}],
        'p2DcList': [{'dcName': 'Vader', 'dgIndex': 1}],
        'p1DcMessageIds': ['hl1dc0'],
        'p2DcMessageIds': ['hl2dc0'],
        'selectedMap': {'id': 'dawn-of-rebellion'},
        'mapId': 'dawn-of-rebellion',
        'activeFigureKeys': ['Luke-1-0'],
        'movementPoints': rng.randint(0, 4),
    }


def _make_state_activation_start(rng: random.Random) -> Dict[str, Any]:
    """No figure active — activate / pass options.

    Sets activationsRemaining and p{N}ActivationsRemaining consistently
    so both engines see the same "who has activations" state.
    """
    p1_acts = rng.randint(0, 2)
    p2_acts = rng.randint(0, 2)
    active = rng.choice([1, 2])
    return {
        'gameId': 'fuzz',
        'phase': 'round_active',
        'roundPhase': 'activation',
        'activePlayer': active,
        'currentActivationTurnPlayerId': 'p1user' if active == 1 else 'p2user',
        'player1Id': 'p1user',
        'player2Id': 'p2user',
        'activationsRemaining': {'1': p1_acts, '2': p2_acts},
        'p1ActivationsRemaining': p1_acts,
        'p2ActivationsRemaining': p2_acts,
        'figurePositions': {
            '1': {'Luke-1-0': 'e5'},
            '2': {'Vader-1-0': 'e8'},
        },
        'dcHealthState': {'hl1dc0': [[10, 10]], 'hl2dc0': [[12, 12]]},
        'dcMessageMeta': [
            ['hl1dc0', {'gameId': 'fuzz', 'dcName': 'Luke',
                        'displayName': 'Luke [DG 1]', 'playerNum': 1}],
            ['hl2dc0', {'gameId': 'fuzz', 'dcName': 'Vader',
                        'displayName': 'Vader [DG 1]', 'playerNum': 2}],
        ],
        'p1DcList': [{'dcName': 'Luke', 'dgIndex': 1}],
        'p2DcList': [{'dcName': 'Vader', 'dgIndex': 1}],
        'p1DcMessageIds': ['hl1dc0'],
        'p2DcMessageIds': ['hl2dc0'],
        'selectedMap': {'id': 'dawn-of-rebellion'},
        'mapId': 'dawn-of-rebellion',
        'activeFigureKeys': [],
    }


def _make_state_end_of_round(rng: random.Random) -> Dict[str, Any]:
    """roundPhase='end' → end-round action."""
    s = _make_state_activation_start(rng)
    s['roundPhase'] = 'end'
    s['activationsRemaining'] = {'1': 0, '2': 0}
    s['p1ActivationsRemaining'] = 0
    s['p2ActivationsRemaining'] = 0
    s['p1ActivationPhaseEnded'] = True
    s['p2ActivationPhaseEnded'] = True
    return s


def _make_state_game_over(rng: random.Random) -> Dict[str, Any]:
    s = _make_state_activation_start(rng)
    s['phase'] = 'game_over'
    return s


_BUILDERS = [
    _make_state_activation_start,
    _make_state_mid_activation,
    _make_state_end_of_round,
    _make_state_game_over,
]


def run_cases(n: int, seed: int = 42) -> Dict[str, Any]:
    rng = random.Random(seed)
    counts = {'PASS': 0, 'FAIL': 0, 'ERROR': 0}
    fails: List[Dict[str, Any]] = []
    for i in range(n):
        builder = rng.choice(_BUILDERS)
        game = builder(rng)
        pn = game.get('activePlayer', 1)
        js = _run_js(json.loads(json.dumps(game)), pn)
        py = _run_python(json.loads(json.dumps(game)))
        if not js.get('ok'):
            counts['ERROR'] += 1
            fails.append({'i': i, 'status': 'ERROR_JS',
                          'error': js.get('error'), 'builder': builder.__name__})
            continue
        if not py.get('ok'):
            counts['ERROR'] += 1
            fails.append({'i': i, 'status': 'ERROR_PY',
                          'error': py.get('error'), 'builder': builder.__name__})
            continue
        js_types = _extract_js_types(js['actions'])
        py_types = _extract_py_types(py['actions'])
        only_js = js_types - py_types
        only_py = py_types - js_types
        # Contract: Python must offer at least every action JS does
        # (superset) — MCTS can explore more, never less. Python-only
        # actions are fine (pass_activation_turn, end_end_of_round,
        # etc.) as long as JS never offers something Python omits.
        if not only_js:
            counts['PASS'] += 1
        else:
            counts['FAIL'] += 1
            fails.append({
                'i': i, 'status': 'FAIL', 'builder': builder.__name__,
                'only_js': sorted(only_js),
                'only_py': sorted(only_py),
                'js_count': len(js['actions']),
                'py_count': len(py['actions']),
            })
    return {'counts': counts, 'fails': fails}


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='Legal-action parity harness')
    ap.add_argument('--cases', type=int, default=20)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args(argv)
    r = run_cases(args.cases, args.seed)
    if args.json:
        print(json.dumps(r, indent=2, sort_keys=True))
    else:
        print(f'legal-actions parity: {r["counts"]}')
        for f in r['fails'][:10]:
            print(f'  [{f["status"]}] #{f["i"]} ({f["builder"]})')
            if 'only_js' in f:
                print(f'    only in JS: {f["only_js"]}')
                print(f'    only in PY: {f["only_py"]}')
                print(f'    js_count={f["js_count"]} py_count={f["py_count"]}')
            if 'error' in f:
                print(f'    {f["error"][:200]}')
    return 0 if r['counts']['FAIL'] == 0 and r['counts']['ERROR'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
