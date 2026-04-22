"""Randomized JS ↔ Python LOS parity fuzz (D2.4+D2.5+D2.6 broad verification).

Shells out to `tests/headless/dump-los-fuzz.js` for N deterministic fuzz
cases covering attacker, target, blocking terrain, impassable edges, and
figure-blocking coords. Asserts Python `has_line_of_sight` matches JS
`hasLineOfSight` on every case.

Pass condition: 0 mismatches across 500 cases.

Run as: python3 -m python.parity.oracles.los.test_los_fuzz_js_parity
"""
import json
import subprocess
import sys
from pathlib import Path

from python.engine.mechanics.los import has_line_of_sight


REPO_ROOT = Path(__file__).resolve().parents[4]
DUMP_SCRIPT = REPO_ROOT / 'tests' / 'headless' / 'dump-los-fuzz.js'


def _run_js(count: int, seed: int) -> list:
    proc = subprocess.run(
        ['node', str(DUMP_SCRIPT), '--count', str(count), '--seed', str(seed)],
        capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f'dump-los-fuzz.js failed ({proc.returncode}):\n'
            f'STDOUT={proc.stdout}\nSTDERR={proc.stderr}')
    out = []
    for line in proc.stdout.strip().split('\n'):
        if line.strip():
            out.append(json.loads(line))
    return out


def test_los_parity_500_fuzz_cases():
    cases = _run_js(count=500, seed=42)
    assert len(cases) == 500, f'Expected 500 JS cases, got {len(cases)}'
    failures = []
    for case in cases:
        map_spaces = {
            'blocking': case['blocking'],
            'impassableEdges': case['impassableEdges'],
        }
        fig = set(case['figureBlocking']) if case['figureBlocking'] else None
        py_los = has_line_of_sight(case['a'], case['b'], map_spaces, fig)
        if py_los != case['los']:
            failures.append(
                f"seq={case['seq']} a={case['a']} b={case['b']} "
                f"blk={case['blocking']} edges={case['impassableEdges']} "
                f"fig={case['figureBlocking']} : py={py_los} js={case['los']}")
    assert not failures, (
        f'{len(failures)} of {len(cases)} LOS fuzz cases diverged:\n  '
        + '\n  '.join(failures[:10]))


def test_figure_blocking_direct_probe():
    """Hand-built minimal case exercising figure_blocking_coords param.
    Open line a3→e3 except figure squatting on c3; LOS must be False."""
    map_spaces = {'blocking': [], 'impassableEdges': []}
    assert has_line_of_sight('a3', 'e3', map_spaces, None) is True, (
        'Open line a3→e3 must have LOS with no figures.')
    assert has_line_of_sight('a3', 'e3', map_spaces, {'c3'}) is False, (
        'Figure on c3 must block LOS a3→e3.')
    # Ally-vs-enemy semantics: the figure_blocking_coords set is a raw set;
    # callers (handlers) decide who to include. LOS function treats the set
    # as "these cells block." Self-exclusion still applies at endpoints.
    assert has_line_of_sight('a3', 'e3', map_spaces, {'a3'}) is True, (
        'Figure on source cell a3 must not block its own LOS (self-exclusion).')
    assert has_line_of_sight('a3', 'e3', map_spaces, {'e3'}) is True, (
        'Figure on target cell e3 must not block LOS to self (self-exclusion).')


ALL_TESTS = [
    test_los_parity_500_fuzz_cases,
    test_figure_blocking_direct_probe,
]


def _main():
    ok, bad = 0, 0
    for t in ALL_TESTS:
        try:
            t()
            ok += 1
            print(f'  ok  {t.__name__}')
        except AssertionError as e:
            bad += 1
            print(f'  FAIL {t.__name__}: {e}')
        except RuntimeError as e:
            bad += 1
            print(f'  FAIL {t.__name__}: {e}')
    print(f'\n{ok}/{ok+bad} tests pass')
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    _main()
