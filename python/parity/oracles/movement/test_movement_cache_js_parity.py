"""Randomized JS ↔ Python movement-cache parity fuzz (D2.7 / D2.8 / D2.9 broad
verification).

Shells out to `tests/headless/dump-movement-cache.js` for N deterministic fuzz
cases covering grid size, start cell, MP budget, profile flags, blocking cells,
occupied set, hostile set, and movement-blocking edges. Asserts that for every
case, the Python `compute_movement_cache` returns identical (cell, cost, size)
triples to JS `computeMovementCache`.

Pass condition: 0 mismatches across 200 cases.

Run as: python3 -m python.parity.oracles.movement.test_movement_cache_js_parity
"""
import json
import subprocess
import sys
from pathlib import Path

from python.engine.mechanics.movement_board import (
    MovementProfile,
    build_temp_board_state,
)
from python.engine.mechanics.movement_cache import compute_movement_cache


REPO_ROOT = Path(__file__).resolve().parents[4]
DUMP_SCRIPT = REPO_ROOT / 'tests' / 'headless' / 'dump-movement-cache.js'


def _run_js(count: int, seed: int) -> list:
    proc = subprocess.run(
        ['node', str(DUMP_SCRIPT), '--count', str(count), '--seed', str(seed)],
        capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f'dump-movement-cache.js failed ({proc.returncode}):\n'
            f'STDOUT={proc.stdout}\nSTDERR={proc.stderr}')
    out = []
    for line in proc.stdout.strip().split('\n'):
        if line.strip():
            out.append(json.loads(line))
    return out


def _build_grid_map(cols: int, rows: int, difficult, blocking, mbe) -> dict:
    """Mirrors the JS dump-movement-cache grid: blocking cells STAY in spaces
    and adjacency (JS only uses the `blocked` buildGrid arg to remove cells
    entirely, and that path isn't exercised — blocking is applied later via
    mapSpaces.blocking which only populates blockingSet).
    """
    diff_set = set(difficult)
    spaces = []
    adjacency = {}
    terrain = {}

    def coord(c, r):
        return f'{chr(97 + c)}{r + 1}'

    for r in range(rows):
        for c in range(cols):
            k = coord(c, r)
            spaces.append(k)
            terrain[k] = 'difficult' if k in diff_set else 'normal'
            neighbors = []
            for dc, dr in ((0, -1), (0, 1), (-1, 0), (1, 0)):
                nc, nr = c + dc, r + dr
                if 0 <= nc < cols and 0 <= nr < rows:
                    neighbors.append(coord(nc, nr))
            adjacency[k] = neighbors
    return {
        'spaces': spaces,
        'adjacency': adjacency,
        'terrain': terrain,
        'blocking': list(blocking),
        'movementBlockingEdges': list(mbe),
        'impassableEdges': [],
    }


def _profile_from_js_dict(d: dict) -> MovementProfile:
    return MovementProfile(
        size=d['size'], cols=d['cols'], rows=d['rows'],
        is_large=d['isLarge'], allow_diagonal=d['allowDiagonal'], can_rotate=d['canRotate'],
        is_massive=d['isMassive'], is_mobile=d['isMobile'],
        ignore_difficult=d['ignoreDifficult'],
        ignore_blocking=d['ignoreBlocking'],
        ignore_figure_cost=d['ignoreFigureCost'],
        can_end_on_occupied=d['canEndOnOccupied'],
        treat_blocking_as_difficult=d['treatBlockingAsDifficult'],
    )


def test_movement_cache_parity_200_fuzz_cases():
    cases = _run_js(count=200, seed=42)
    assert len(cases) == 200, f'Expected 200 JS cases, got {len(cases)}'
    failures = []
    for case in cases:
        map_spaces = _build_grid_map(
            case['cols'], case['rows'], case['difficult'], case['blocking'], case['mbe'],
        )
        board = build_temp_board_state(map_spaces, case['occupied'], case['hostile'])
        profile = _profile_from_js_dict(case['profile'])
        cache = compute_movement_cache(case['start'], case['mp'], board, profile)
        py_cells = sorted(
            [(k, {'cost': v['cost'], 'size': v['size']}) for k, v in cache['cells'].items()],
            key=lambda x: x[0],
        )
        js_cells = [(k, v) for k, v in case['cells']]
        if py_cells != js_cells:
            py_map = {k: v for k, v in py_cells}
            js_map = {k: v for k, v in js_cells}
            all_keys = sorted(set(py_map.keys()) | set(js_map.keys()))
            diffs = []
            for k in all_keys:
                p = py_map.get(k)
                j = js_map.get(k)
                if p != j:
                    diffs.append(f'{k}: py={p} js={j}')
            failures.append(
                f"seq={case['seq']} cols={case['cols']} rows={case['rows']} "
                f"start={case['start']} mp={case['mp']} profile_flags="
                f"{[k for k in ['ignoreDifficult','ignoreBlocking','ignoreFigureCost','canEndOnOccupied','treatBlockingAsDifficult'] if case['profile'].get(k)]} "
                f": {len(diffs)} cell diffs: {diffs[:6]}"
            )
    assert not failures, (
        f'{len(failures)} of {len(cases)} movement-cache fuzz cases diverged:\n  '
        + '\n  '.join(failures[:5]))


ALL_TESTS = [test_movement_cache_parity_200_fuzz_cases]


def _main():
    ok, bad = 0, 0
    for t in ALL_TESTS:
        try:
            t()
            ok += 1
            print(f'  ok  {t.__name__}')
        except (AssertionError, RuntimeError) as e:
            bad += 1
            print(f'  FAIL {t.__name__}: {e}')
    print(f'\n{ok}/{ok+bad} tests pass')
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    _main()
