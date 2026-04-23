"""Tests for board_renderer — PIL-based map image.

Run: python3 python/discord_bot/test_board_renderer.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot.board_renderer import render_board_png


def test_render_returns_none_without_map():
    from python.engine.creation import create_game
    g = create_game()
    # No selectedMap → None.
    assert render_board_png(g) is None


def test_render_returns_png_bytes_with_map():
    from python.engine.creation import create_game
    g = create_game(map_id='mos-eisley-outskirts')
    g.data['selectedMap'] = {'id': 'mos-eisley-outskirts'}
    g.data['figurePositions'] = {
        1: {'Luke-1-0': 'a1'},
        2: {'Storm-1-0': 'h8'},
    }
    png = render_board_png(g)
    assert png is not None
    assert png.startswith(b'\x89PNG\r\n\x1a\n'), 'Not a PNG'


def test_render_fixed_size_for_canonical_map():
    """Image dimensions should be deterministic given the same cell_size."""
    from python.engine.creation import create_game
    g = create_game(map_id='mos-eisley-outskirts')
    g.data['selectedMap'] = {'id': 'mos-eisley-outskirts'}
    png1 = render_board_png(g, cell_size=16)
    png2 = render_board_png(g, cell_size=16)
    assert png1 is not None
    # Same inputs → same output bytes (PIL deterministic for our drawing).
    assert len(png1) == len(png2)


def test_render_includes_figures_from_positions():
    """Adding figures shouldn't error and should change the image."""
    from python.engine.creation import create_game
    g = create_game(map_id='mos-eisley-outskirts')
    g.data['selectedMap'] = {'id': 'mos-eisley-outskirts'}
    g.data['figurePositions'] = {1: {}, 2: {}}
    empty = render_board_png(g, cell_size=16)
    g.data['figurePositions'] = {
        1: {'Luke-1-0': 'a1', 'Rebel-2-0': 'b1'},
        2: {'Storm-1-0': 'h8', 'Storm-1-1': 'h9'},
    }
    filled = render_board_png(g, cell_size=16)
    assert empty != filled


def test_render_handles_unknown_map_gracefully():
    from python.engine.creation import create_game
    g = create_game()
    g.data['selectedMap'] = {'id': 'nope-not-a-map'}
    # Should return None, not crash.
    assert render_board_png(g) is None


def main():
    cases = [
        ('no_map', test_render_returns_none_without_map),
        ('png_bytes', test_render_returns_png_bytes_with_map),
        ('deterministic', test_render_fixed_size_for_canonical_map),
        ('with_figures', test_render_includes_figures_from_positions),
        ('unknown_map', test_render_handles_unknown_map_gracefully),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            import traceback
            print(f'FAIL: {name}: {e}')
            traceback.print_exc()
            failures.append(name)
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
