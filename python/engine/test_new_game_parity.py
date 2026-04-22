"""New-game parity test — D1 quality gate.

Drives `tests/headless/dump-new-game.js` via subprocess with a matrix of
squad/map/mission specs. For each spec:

  1. JS emits canonical JSON.
  2. Python builds an equivalent state via `create_game(**spec)`.
  3. Python serializes via `GameState.to_json()`.
  4. Assert Python's bytes == JS's bytes.
  5. Round-trip check: `from_json(to_json(x)) == x`.

Failure of (4) is a structural divergence between the JS new-game literal and
the Python creation.py. Failure of (5) is a Python-side serialization bug.

Run with:
    pytest python/engine/test_new_game_parity.py -v
or:
    python -m python.engine.test_new_game_parity        # runs as a script
"""
import json
import subprocess
import sys
from pathlib import Path

from python.engine.creation import create_game
from python.engine.state import GameState


REPO_ROOT = Path(__file__).resolve().parents[2]
DUMP_SCRIPT = REPO_ROOT / 'tests' / 'headless' / 'dump-new-game.js'


SPECS = [
    # Bare lobby / map-only intermediates
    {'gameId': 'G001', 'player1Id': 'p1', 'player2Id': 'p2'},
    {'gameId': 'G002', 'player1Id': 'alice', 'player2Id': 'bob',
     'selectedMap': 'mos-eisley'},

    # Both squads + map → phase INITIATIVE
    {'gameId': 'G003', 'player1Id': 'p1', 'player2Id': 'p2',
     'selectedMap': 'mos-eisley', 'mission': 'mos-eisley',
     'player1Squad': {'name': 'Rebels-A', 'dcCount': 5, 'ccCount': 15},
     'player2Squad': {'name': 'Imperials-A', 'dcCount': 5, 'ccCount': 15}},
    {'gameId': 'G004', 'player1Id': 'p1', 'player2Id': 'p2',
     'selectedMap': 'lothal', 'mission': 'lothal',
     'player1Squad': {'name': 'Scum-A', 'dcCount': 4, 'ccCount': 15},
     'player2Squad': {'name': 'Rebels-B', 'dcCount': 6, 'ccCount': 15}},
    {'gameId': 'G005', 'player1Id': 'p1', 'player2Id': 'p2',
     'selectedMap': 'chopper-base', 'mission': 'chopper-base',
     'player1Squad': {'name': 'Imperials-B', 'dcCount': 5, 'ccCount': 15},
     'player2Squad': {'name': 'Scum-B', 'dcCount': 5, 'ccCount': 15}},
    {'gameId': 'G006', 'player1Id': 'p1', 'player2Id': 'p2',
     'selectedMap': 'jabba-realm', 'mission': 'jabba-realm',
     'player1Squad': {'name': 'S6', 'dcCount': 5, 'ccCount': 15},
     'player2Squad': {'name': 'S6b', 'dcCount': 5, 'ccCount': 15}},
    {'gameId': 'G007', 'player1Id': 'p1', 'player2Id': 'p2',
     'selectedMap': 'corellian', 'mission': 'corellian',
     'player1Squad': {'name': 'S7', 'dcCount': 3, 'ccCount': 15},
     'player2Squad': {'name': 'S7b', 'dcCount': 7, 'ccCount': 15}},
    {'gameId': 'G008', 'player1Id': 'p1', 'player2Id': 'p2',
     'selectedMap': 'development-facility', 'mission': 'development-facility',
     'player1Squad': {'name': 'S8', 'dcCount': 5, 'ccCount': 15},
     'player2Squad': {'name': 'S8b', 'dcCount': 5, 'ccCount': 15}},
    {'gameId': 'G009', 'player1Id': 'p1', 'player2Id': 'p2',
     'selectedMap': 'devaron', 'mission': 'devaron',
     'player1Squad': {'name': 'S9', 'dcCount': 5, 'ccCount': 15},
     'player2Squad': {'name': 'S9b', 'dcCount': 5, 'ccCount': 15}},
    {'gameId': 'G010', 'player1Id': 'p1', 'player2Id': 'p2',
     'selectedMap': 'wasskah', 'mission': 'wasskah',
     'player1Squad': {'name': 'S10', 'dcCount': 5, 'ccCount': 15},
     'player2Squad': {'name': 'S10b', 'dcCount': 5, 'ccCount': 15}},
]


def js_dump(spec: dict) -> str:
    """Invoke the JS dump helper with a given spec. Returns the JS output string."""
    proc = subprocess.run(
        ['node', str(DUMP_SCRIPT), '--spec', '-'],
        input=json.dumps(spec),
        capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f'dump-new-game.js failed ({proc.returncode}):\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}'
        )
    return proc.stdout


def python_dump(spec: dict) -> str:
    kwargs = {}
    if 'gameId' in spec: kwargs['game_id'] = spec['gameId']
    if 'player1Id' in spec: kwargs['player1_id'] = spec['player1Id']
    if 'player2Id' in spec: kwargs['player2_id'] = spec['player2Id']
    if 'player1Squad' in spec: kwargs['p1_squad'] = spec['player1Squad']
    if 'player2Squad' in spec: kwargs['p2_squad'] = spec['player2Squad']
    if 'selectedMap' in spec: kwargs['map_id'] = spec['selectedMap']
    if 'mission' in spec: kwargs['mission'] = spec['mission']
    return create_game(**kwargs).to_json()


def run_one(spec: dict) -> dict:
    js_out = js_dump(spec)
    py_out = python_dump(spec)
    roundtrip = GameState.from_json(py_out).to_json()
    return {
        'spec': spec,
        'js_bytes': js_out,
        'py_bytes': py_out,
        'roundtrip_bytes': roundtrip,
        'match_js_py': js_out == py_out,
        'match_roundtrip': py_out == roundtrip,
    }


def test_all_specs_parity():
    failures = []
    for spec in SPECS:
        result = run_one(spec)
        if not result['match_js_py']:
            failures.append(
                f'[js-py-diff] gameId={spec.get("gameId")}\n'
                f'  JS:    {result["js_bytes"]}\n'
                f'  PY:    {result["py_bytes"]}'
            )
        if not result['match_roundtrip']:
            failures.append(
                f'[roundtrip-diff] gameId={spec.get("gameId")}\n'
                f'  first:  {result["py_bytes"]}\n'
                f'  second: {result["roundtrip_bytes"]}'
            )
    assert not failures, 'New-game parity failures:\n' + '\n'.join(failures)


def _main():
    ok, bad = 0, 0
    for spec in SPECS:
        r = run_one(spec)
        label = spec.get('gameId', '?')
        if r['match_js_py'] and r['match_roundtrip']:
            ok += 1
            print(f'  ok  {label}')
        else:
            bad += 1
            print(f'  FAIL {label}')
            if not r['match_js_py']:
                print(f'    JS: {r["js_bytes"]}')
                print(f'    PY: {r["py_bytes"]}')
            if not r['match_roundtrip']:
                print(f'    ROUND-TRIP DIFF')
    print(f'\n{ok}/{ok+bad} specs match')
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    _main()
