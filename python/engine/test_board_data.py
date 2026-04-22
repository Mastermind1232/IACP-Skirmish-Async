"""Verify map-spaces loader (D2.2).

Parity check: JS `generate-map-spaces.js` emits the shared JSON file; Python
reads it and must see the same spaces/adjacency/blocking counts. These counts
are taken from the live `data/map-spaces.json` and pin any accidental drift.

Run as: python3 -m python.engine.test_board_data
"""
import sys

from python.engine.board_data import (
    list_map_ids, load_map_spaces, UnknownMap,
)


EXPECTED = {
    'mos-eisley-outskirts':  {'spaces': 658, 'adjacency': 658, 'blocking': 11, 'impassableEdges': 117, 'movementBlockingEdges': 13, 'terrain': 658},
    'corellian-underground': {'spaces': 936, 'adjacency': 936, 'blocking': 4,  'impassableEdges': 107, 'movementBlockingEdges': 0,  'terrain': 936},
    'chopper-base-atollon':  {'spaces': 227, 'adjacency': 227, 'blocking': 13, 'impassableEdges': 11,  'movementBlockingEdges': 8,  'terrain': 13},
    'lothal-wastes':         {'spaces': 297, 'adjacency': 297, 'blocking': 13, 'impassableEdges': 125, 'movementBlockingEdges': 18, 'terrain': 22},
    'development-facility':  {'spaces': 624, 'adjacency': 624, 'blocking': 0,  'impassableEdges': 0,   'movementBlockingEdges': 0,  'terrain': 624},
    'devaron-garrison':      {'spaces': 728, 'adjacency': 728, 'blocking': 10, 'impassableEdges': 129, 'movementBlockingEdges': 4,  'terrain': 728},
    'anchorhead-cantina-bar':{'spaces': 624, 'adjacency': 624, 'blocking': 7,  'impassableEdges': 0,   'movementBlockingEdges': 8,  'terrain': 624},
    'hoth-battle-station':   {'spaces': 186, 'adjacency': 186, 'blocking': 3,  'impassableEdges': 103, 'movementBlockingEdges': 0,  'terrain': 7},
}


def test_all_map_ids_present():
    ids = set(list_map_ids())
    expected = set(EXPECTED.keys())
    assert ids == expected, f'Map ids drift: missing={expected-ids} extra={ids-expected}'


def test_per_map_counts():
    failures = []
    for mid, want in EXPECTED.items():
        m = load_map_spaces(mid)
        got = {
            'spaces': len(m['spaces']),
            'adjacency': len(m['adjacency']),
            'blocking': len(m['blocking']),
            'impassableEdges': len(m['impassableEdges']),
            'movementBlockingEdges': len(m['movementBlockingEdges']),
            'terrain': len(m['terrain']),
        }
        if got != want:
            failures.append(f'{mid}: got={got} want={want}')
    assert not failures, 'Map count mismatch:\n  ' + '\n  '.join(failures)


def test_adjacency_is_symmetric():
    """Every edge in the adjacency graph is bidirectional. This is a JS
    invariant (generate-map-spaces.js walks both sides of each edge); any
    asymmetry would break both pathfinding and LOS rasters."""
    for mid in EXPECTED.keys():
        m = load_map_spaces(mid)
        adj = m['adjacency']
        for a, neighbors in adj.items():
            for b in neighbors:
                neighbors_of_b = adj.get(b, [])
                assert a in neighbors_of_b, (
                    f'{mid}: adjacency asymmetric — {a}->{b} exists but {b}->{a} does not')


def test_unknown_map_raises():
    try:
        load_map_spaces('not-a-real-map')
    except UnknownMap:
        return
    raise AssertionError('Expected UnknownMap for unknown map id')


def test_load_returns_fresh_dicts():
    """Callers must be safe to mutate returned collections."""
    m1 = load_map_spaces('mos-eisley-outskirts')
    m2 = load_map_spaces('mos-eisley-outskirts')
    m1['spaces'].append('x999')
    assert 'x999' not in m2['spaces'], 'spaces list was shared across calls'
    m1['adjacency']['a1'] = ['bogus']
    assert m2['adjacency'].get('a1') != ['bogus'], 'adjacency dict was shared across calls'


ALL_TESTS = [
    test_all_map_ids_present,
    test_per_map_counts,
    test_adjacency_is_symmetric,
    test_unknown_map_raises,
    test_load_returns_fresh_dicts,
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
    print(f'\n{ok}/{ok+bad} tests pass')
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    _main()
