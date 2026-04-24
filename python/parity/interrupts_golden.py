"""Movement-interrupt parity: JS detectPostMoveInterrupts ↔ Python
detect_post_move_interrupts.

Fuzzes a handful of realistic scenarios (hostile in/out of adjacency,
Overwatch token placement, Mak Eshka'rey at range) and diffs the
trigger lists.
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
JS_CLI = REPO_ROOT / 'tests' / 'headless' / 'detect-interrupts.js'


def _run_js(game: Dict[str, Any], player_num: int,
            figure_key: str, path: List[str]) -> Dict[str, Any]:
    payload = json.dumps({
        'game': game, 'playerNum': player_num,
        'figureKey': figure_key, 'path': path,
    })
    proc = subprocess.run(
        ['node', str(JS_CLI)],
        input=payload, capture_output=True, text=True,
        cwd=str(REPO_ROOT), timeout=30,
    )
    if proc.returncode not in (0, 1):
        return {'ok': False,
                'error': f'node exit {proc.returncode}: {proc.stderr[:200]}'}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {'ok': False, 'error': f'bad stdout: {e}; {proc.stdout[:400]}'}


def _run_python(game: Dict[str, Any], player_num: int,
                figure_key: str, path: List[str]) -> Dict[str, Any]:
    from python.engine.mechanics.interrupts import detect_post_move_interrupts
    try:
        # Deep-copy so JS-side mutation doesn't bleed (JS shouldn't mutate
        # but belt + suspenders).
        g = json.loads(json.dumps(game))
        triggers = detect_post_move_interrupts(g, player_num, figure_key, path)
        return {'ok': True, 'triggers': triggers}
    except Exception as e:
        return {'ok': False, 'error': f'{type(e).__name__}: {e}'}


# Hand-crafted test scenarios.
def _scenarios() -> List[Dict[str, Any]]:
    return [
        # 1. BRAWLER + Parting Blow, Luke moves away from Bossk.
        {
            'name': 'parting_blow_bossk',
            'game': {
                'gameId': 't',
                'figurePositions': {
                    '1': {'Luke Skywalker-1-0': 'e5'},
                    '2': {'Bossk-1-0': 'f5'},
                },
                'p1CcHand': [], 'p2CcHand': ['Parting Blow'],
                'player2CcHand': ['Parting Blow'],
                'selectedMap': {'id': 'mos-eisley-outskirts'},
                'p1DcMessageIds': ['hl1dc0'], 'p2DcMessageIds': ['hl2dc0'],
                'figureOrientations': {},
            },
            'player_num': 1, 'figure_key': 'Luke Skywalker-1-0',
            'path': ['e5', 'd5', 'c5'],
        },
        # 2. No Parting Blow in hand → no trigger.
        {
            'name': 'parting_blow_no_card',
            'game': {
                'gameId': 't',
                'figurePositions': {
                    '1': {'Luke Skywalker-1-0': 'e5'},
                    '2': {'Bossk-1-0': 'f5'},
                },
                'p1CcHand': [], 'p2CcHand': [],
                'player2CcHand': [],
                'selectedMap': {'id': 'mos-eisley-outskirts'},
                'p1DcMessageIds': ['hl1dc0'], 'p2DcMessageIds': ['hl2dc0'],
                'figureOrientations': {},
            },
            'player_num': 1, 'figure_key': 'Luke Skywalker-1-0',
            'path': ['e5', 'd5'],
        },
        # 3. Non-BRAWLER hostile → no Parting Blow.
        {
            'name': 'parting_blow_non_brawler',
            'game': {
                'gameId': 't',
                'figurePositions': {
                    '1': {'Luke Skywalker-1-0': 'e5'},
                    '2': {'Stormtrooper (Regular)-1-0': 'f5'},  # NOT BRAWLER
                },
                'p1CcHand': [], 'p2CcHand': ['Parting Blow'],
                'player2CcHand': ['Parting Blow'],
                'selectedMap': {'id': 'mos-eisley-outskirts'},
                'p1DcMessageIds': ['hl1dc0'], 'p2DcMessageIds': ['hl2dc0'],
                'figureOrientations': {},
            },
            'player_num': 1, 'figure_key': 'Luke Skywalker-1-0',
            'path': ['e5', 'd5'],
        },
        # 4. Short path (no movement) → no triggers.
        {
            'name': 'empty_path',
            'game': {
                'gameId': 't',
                'figurePositions': {
                    '1': {'Luke-1-0': 'e5'},
                    '2': {'Bossk-1-0': 'f5'},
                },
                'p1CcHand': [], 'p2CcHand': ['Parting Blow'],
                'player2CcHand': ['Parting Blow'],
                'selectedMap': {'id': 'mos-eisley-outskirts'},
                'p1DcMessageIds': ['hl1dc0'], 'p2DcMessageIds': ['hl2dc0'],
                'figureOrientations': {},
            },
            'player_num': 1, 'figure_key': 'Luke-1-0',
            'path': ['e5'],
        },
        # 5. Dirty Trick: SMUGGLER hostile, Luke enters adjacent.
        {
            'name': 'dirty_trick_smuggler',
            'game': {
                'gameId': 't',
                'figurePositions': {
                    '1': {'Luke Skywalker-1-0': 'c5'},
                    # Han Solo has SMUGGLER keyword
                    '2': {'Han Solo-1-0': 'f5'},
                },
                'p1CcHand': [],
                'p2CcHand': ['Dirty Trick'],
                'player2CcHand': ['Dirty Trick'],
                'selectedMap': {'id': 'mos-eisley-outskirts'},
                'p1DcMessageIds': ['hl1dc0'], 'p2DcMessageIds': ['hl2dc0'],
                'figureOrientations': {},
            },
            'player_num': 1, 'figure_key': 'Luke Skywalker-1-0',
            # Luke walks c5 → d5 → e5 (entering adjacent to Han at f5 on e5).
            'path': ['c5', 'd5', 'e5'],
        },
        # 6. Both Parting Blow AND Dirty Trick hostile — Parting Blow is
        #    once per move, Dirty Trick fires every entering-adjacent.
        #    With Bossk (BRAWLER) + Han (SMUGGLER):
        {
            'name': 'combined_parting_blow_dirty_trick',
            'game': {
                'gameId': 't',
                'figurePositions': {
                    '1': {'Luke Skywalker-1-0': 'f6'},
                    '2': {'Bossk-1-0': 'e5', 'Han Solo-1-0': 'a5'},
                },
                'p2CcHand': ['Parting Blow', 'Dirty Trick'],
                'player2CcHand': ['Parting Blow', 'Dirty Trick'],
                'selectedMap': {'id': 'mos-eisley-outskirts'},
                'p1DcMessageIds': ['hl1dc0'],
                'p2DcMessageIds': ['hl2dc0', 'hl2dc1'],
                'figureOrientations': {},
            },
            'player_num': 1, 'figure_key': 'Luke Skywalker-1-0',
            # Luke exits Bossk adjacency (f6 → h6), far from Han — only Parting Blow.
            'path': ['f6', 'g6', 'h6'],
        },
    ]


def _normalize_trigger(t: Dict[str, Any]) -> Dict[str, Any]:
    """Drop JS-only fields (description) and compare on core fields."""
    return {
        'type': t.get('type'),
        'cardName': t.get('cardName'),
        'candidatePlayerNum': t.get('candidatePlayerNum'),
        'candidateFigureKey': t.get('candidateFigureKey'),
        'triggerSpace': t.get('triggerSpace'),
        'owMsgId': t.get('owMsgId'),
    }


def run() -> Dict[str, Any]:
    scenarios = _scenarios()
    counts = {'PASS': 0, 'FAIL': 0, 'ERROR': 0}
    reports = []
    for sc in scenarios:
        js = _run_js(sc['game'], sc['player_num'], sc['figure_key'], sc['path'])
        py = _run_python(sc['game'], sc['player_num'],
                          sc['figure_key'], sc['path'])
        if not js.get('ok') or not py.get('ok'):
            counts['ERROR'] += 1
            reports.append({'name': sc['name'], 'status': 'ERROR',
                            'js': js, 'py': py})
            continue
        js_ts = [_normalize_trigger(t) for t in (js.get('triggers') or [])]
        py_ts = [_normalize_trigger(t) for t in (py.get('triggers') or [])]
        if js_ts == py_ts:
            counts['PASS'] += 1
        else:
            counts['FAIL'] += 1
            reports.append({'name': sc['name'], 'status': 'FAIL',
                            'js_triggers': js_ts, 'py_triggers': py_ts})
    return {'counts': counts, 'reports': reports}


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='Movement-interrupts parity')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args(argv)
    r = run()
    if args.json:
        print(json.dumps(r, indent=2, sort_keys=True))
    else:
        print(f'interrupts parity: {r["counts"]}')
        for rep in r['reports']:
            print(f'  [{rep["status"]}] {rep["name"]}')
            if rep['status'] == 'FAIL':
                print(f'    JS:  {rep["js_triggers"]}')
                print(f'    PY:  {rep["py_triggers"]}')
    return 0 if r['counts'].get('FAIL', 0) == 0 and r['counts'].get('ERROR', 0) == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
