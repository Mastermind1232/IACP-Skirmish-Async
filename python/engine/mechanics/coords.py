"""Coordinate + size helpers for the map/grid (D2.1).

Mirrors `src/game/coords.js` byte-for-byte. No game state, no Discord, no
mutation. Used by adjacency, LOS, movement, pathfinding.

The grid uses letter-column + 1-based row (e.g., 'a1', 'z20', 'aa1'). Columns
beyond 'z' wrap to 'aa'/'ab' using Excel-style lettering. Internal ops use
0-based (col, row) integers.
"""
import re
from typing import List, Set, Tuple


_LETTER_RE = re.compile(r'[a-z]+')
_NUM_RE = re.compile(r'\d+')


def normalize_coord(coord) -> str:
    """Lowercase + strip. JS: returns '' for null/undefined/non-string."""
    if coord is None or not isinstance(coord, str):
        return ''
    return coord.lower().strip()


def parse_coord(coord) -> Tuple[int, int]:
    """Return (col, row) as 0-based ints. Unparseable -> (-1, -1)."""
    s = str(coord or '').lower()
    letter_m = _LETTER_RE.search(s)
    num_m = _NUM_RE.search(s)
    letter = letter_m.group(0) if letter_m else ''
    num = int(num_m.group(0)) if num_m else 0
    if letter:
        col = 0
        for ch in letter:
            col = col * 26 + (ord(ch) - 96)
        col -= 1
    else:
        col = -1
    row = num - 1
    return (col, row)


def col_row_to_coord(col: int, row: int) -> str:
    """Inverse of parse_coord. Negative inputs -> ''."""
    if col < 0 or row < 0:
        return ''
    letter = ''
    c = col
    while c >= 0:
        letter = chr(65 + (c % 26)) + letter
        c = c // 26 - 1
    return letter.lower() + str(row + 1)


def bottom_left_coord(top_left: str, size: str) -> str:
    """Topleft + size -> bottom-left cell for display. size is '1x1'/'2x2'/etc."""
    if not top_left:
        return top_left
    parts = str(size or '1x1').split('x')
    try:
        rows = int(parts[1]) if len(parts) > 1 else 1
    except ValueError:
        rows = 1
    if rows <= 1:
        return str(top_left).lower()
    col, row = parse_coord(top_left)
    return col_row_to_coord(col, row + rows - 1)


def edge_key(a: str, b: str) -> str:
    """Order-independent string key for a pair of coords."""
    parts = sorted([str(a).lower(), str(b).lower()])
    return '|'.join(parts)


def to_lower_set(arr) -> Set[str]:
    """Lowercase + stripped set. None/falsy entries become empty string (matched by JS)."""
    return {normalize_coord(s) for s in (arr or [])}


def parse_size_string(size: str) -> Tuple[int, int]:
    """'3x2' -> (cols=3, rows=2). Fallback 1x1. JS: any int <= 0 becomes 1."""
    parts = str(size or '1x1').lower().split('x')
    def _p(x):
        try:
            v = int(x)
        except ValueError:
            v = 1
        return v or 1
    cols = _p(parts[0]) if len(parts) > 0 else 1
    rows = _p(parts[1]) if len(parts) > 1 else 1
    return (cols or 1, rows or 1)


def size_to_string(cols: int, rows: int) -> str:
    return f'{max(1, cols)}x{max(1, rows)}'


def rotate_size_string(size: str) -> str:
    cols, rows = parse_size_string(size)
    if cols == rows:
        return size_to_string(cols, rows)
    return size_to_string(rows, cols)


def shift_coord(coord: str, dx: int, dy: int) -> str:
    col, row = parse_coord(coord)
    return normalize_coord(col_row_to_coord(col + dx, row + dy))


def get_footprint_cells(top_left_coord: str, size: str) -> List[str]:
    """All cells a unit occupies with its top-left at top_left_coord."""
    col, row = parse_coord(top_left_coord)
    if col < 0 or row < 0:
        return [top_left_coord]
    # Match JS parsing: split on 'x', map to Number, default 1 on NaN-ish
    parts = (size or '1x1').split('x')
    try:
        cols_n = int(parts[0]) if len(parts) > 0 and parts[0] else 1
    except ValueError:
        cols_n = 1
    try:
        rows_n = int(parts[1]) if len(parts) > 1 and parts[1] else 1
    except ValueError:
        rows_n = 1
    cells: List[str] = []
    for r in range(rows_n or 1):
        for c in range(cols_n or 1):
            cells.append(col_row_to_coord(col + c, row + r))
    return cells
