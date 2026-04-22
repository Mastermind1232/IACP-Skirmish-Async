"""Unit tests for coords.py (D2.1 verify).

Parity spec: every function mirrors `src/game/coords.js`. These tests cover
20+ coord round-trips + edge cases (Excel-style columns, negative parses,
size rotations, footprints at various sizes).

Run as: python3 -m python.engine.mechanics.test_coords
"""
import sys

from python.engine.mechanics.coords import (
    normalize_coord, parse_coord, col_row_to_coord, bottom_left_coord,
    edge_key, to_lower_set, parse_size_string, size_to_string,
    rotate_size_string, shift_coord, get_footprint_cells,
)


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


def test_normalize_coord():
    _assert(normalize_coord('A1') == 'a1', 'uppercase lowered')
    _assert(normalize_coord('  b2 ') == 'b2', 'trim whitespace')
    _assert(normalize_coord('') == '', 'empty stays empty')
    _assert(normalize_coord(None) == '', 'None returns empty string')
    _assert(normalize_coord(5) == '', 'non-string returns empty string')


def test_parse_coord_basic():
    _assert(parse_coord('a1') == (0, 0), 'a1 -> (0,0)')
    _assert(parse_coord('a2') == (0, 1), 'a2 -> (0,1)')
    _assert(parse_coord('b1') == (1, 0), 'b1 -> (1,0)')
    _assert(parse_coord('Z1') == (25, 0), 'Z1 -> (25,0) after lowercase')
    _assert(parse_coord('') == (-1, -1), 'empty -> invalid')
    _assert(parse_coord('z20') == (25, 19), 'z20 -> (25, 19)')


def test_parse_coord_multi_letter():
    _assert(parse_coord('aa1') == (26, 0), 'aa1 -> (26,0) Excel-style')
    _assert(parse_coord('ab1') == (27, 0), 'ab1 -> (27,0)')
    _assert(parse_coord('az1') == (51, 0), 'az1 -> (51,0)')
    _assert(parse_coord('ba1') == (52, 0), 'ba1 -> (52,0)')


def test_col_row_round_trip():
    # Round-trip 20 random-looking coords spanning letter widths
    samples = ['a1', 'b5', 'c12', 'd3', 'e17', 'z1', 'z26',
               'aa1', 'aa26', 'ab3', 'az99', 'ba1', 'bz50',
               'm13', 'q7', 'p21', 'n30', 'a100', 's4', 'k9']
    for s in samples:
        col, row = parse_coord(s)
        back = col_row_to_coord(col, row)
        _assert(back == s.lower(), f'{s} -> ({col},{row}) -> {back}; round-trip broken')


def test_col_row_invalid():
    _assert(col_row_to_coord(-1, 0) == '', 'negative col -> empty')
    _assert(col_row_to_coord(0, -1) == '', 'negative row -> empty')


def test_bottom_left_coord():
    _assert(bottom_left_coord('a1', '1x1') == 'a1', '1x1 unchanged')
    _assert(bottom_left_coord('a1', '1x2') == 'a2', '1x2 drops one row')
    _assert(bottom_left_coord('a1', '2x2') == 'a2', '2x2 drops one row')
    _assert(bottom_left_coord('a1', '2x3') == 'a3', '2x3 drops two rows')
    _assert(bottom_left_coord('', '2x2') == '', 'empty in -> empty out')


def test_edge_key_order_insensitive():
    _assert(edge_key('a1', 'a2') == 'a1|a2', 'natural order')
    _assert(edge_key('a2', 'a1') == 'a1|a2', 'reversed order sorted')
    _assert(edge_key('B5', 'a1') == 'a1|b5', 'case-insensitive sort')


def test_to_lower_set():
    _assert(to_lower_set(['A1', 'b2']) == {'a1', 'b2'}, 'lowercased')
    _assert(to_lower_set([]) == set(), 'empty list -> empty set')
    _assert(to_lower_set(None) == set(), 'None -> empty set')


def test_parse_size_string():
    _assert(parse_size_string('1x1') == (1, 1), '1x1')
    _assert(parse_size_string('2x2') == (2, 2), '2x2')
    _assert(parse_size_string('3x2') == (3, 2), '3x2')
    _assert(parse_size_string('') == (1, 1), 'empty -> 1x1')
    _assert(parse_size_string('garbage') == (1, 1), 'garbage -> 1x1')
    _assert(parse_size_string('0x0') == (1, 1), '0x0 -> 1x1 (JS: NaN||1)')


def test_size_to_string():
    _assert(size_to_string(2, 3) == '2x3', '2x3')
    _assert(size_to_string(1, 1) == '1x1', '1x1')
    _assert(size_to_string(0, 0) == '1x1', 'clamps to 1x1')


def test_rotate_size_string():
    _assert(rotate_size_string('1x2') == '2x1', '1x2 rotates to 2x1')
    _assert(rotate_size_string('2x2') == '2x2', 'square unchanged')
    _assert(rotate_size_string('2x3') == '3x2', '2x3 rotates to 3x2')


def test_shift_coord():
    _assert(shift_coord('a1', 1, 0) == 'b1', 'shift right')
    _assert(shift_coord('a1', 0, 1) == 'a2', 'shift down')
    _assert(shift_coord('b2', -1, -1) == 'a1', 'shift up-left')
    _assert(shift_coord('a1', 25, 0) == 'z1', 'shift to end of letter range')
    _assert(shift_coord('z1', 1, 0) == 'aa1', 'shift past z into aa')


def test_get_footprint_cells_1x1():
    _assert(get_footprint_cells('a1', '1x1') == ['a1'], '1x1 single cell')
    _assert(get_footprint_cells('m10', '1x1') == ['m10'], 'm10 1x1')


def test_get_footprint_cells_2x2():
    cells = get_footprint_cells('a1', '2x2')
    _assert(set(cells) == {'a1', 'b1', 'a2', 'b2'}, f'2x2 at a1 -> 4 cells; got {cells}')
    _assert(len(cells) == 4, '2x2 length 4')


def test_get_footprint_cells_1x2():
    cells = get_footprint_cells('c3', '1x2')
    _assert(cells == ['c3', 'c4'], f'1x2 at c3 -> c3,c4; got {cells}')


def test_get_footprint_cells_2x3():
    cells = get_footprint_cells('b1', '2x3')
    _assert(set(cells) == {'b1', 'c1', 'b2', 'c2', 'b3', 'c3'}, f'2x3 at b1; got {cells}')
    _assert(len(cells) == 6, '2x3 length 6')


def test_get_footprint_cells_invalid_coord():
    _assert(get_footprint_cells('', '2x2') == [''], 'empty coord returns [""]')


ALL_TESTS = [
    test_normalize_coord,
    test_parse_coord_basic,
    test_parse_coord_multi_letter,
    test_col_row_round_trip,
    test_col_row_invalid,
    test_bottom_left_coord,
    test_edge_key_order_insensitive,
    test_to_lower_set,
    test_parse_size_string,
    test_size_to_string,
    test_rotate_size_string,
    test_shift_coord,
    test_get_footprint_cells_1x1,
    test_get_footprint_cells_2x2,
    test_get_footprint_cells_1x2,
    test_get_footprint_cells_2x3,
    test_get_footprint_cells_invalid_coord,
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
