"""Board renderer — produces a PNG image of the game map + figures.

Minimal PIL-based renderer that draws:
  - Grid cells (from map-spaces.json adjacency keys)
  - Blocking terrain as dark fill
  - P1 figures as blue circles, P2 as red, NPCs as green
  - Cell coord labels along edges

Not a drop-in replacement for the JS canvas renderer (which uses high-
res map backgrounds from data/map-pdfs). This is a bare-bones
representation good enough for non-graphical play + debug.

Usage:
    from python.discord_bot.board_renderer import render_board_png
    png_bytes = render_board_png(game)
    # post alongside render_game_view's embeds
"""
from __future__ import annotations

import io
from typing import Any, Dict, Optional, Tuple


CELL_SIZE = 24
MARGIN = 20


def _unwrap(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    return game if isinstance(game, dict) else {}


def _cell_xy(coord: str) -> Optional[Tuple[int, int]]:
    """Convert 'a3' → (col=0, row=2) via parse_coord."""
    from python.engine.mechanics.coords import parse_coord
    try:
        return parse_coord(coord)
    except Exception:
        return None


def render_board_png(game: Any,
                     *, cell_size: int = CELL_SIZE,
                     margin: int = MARGIN) -> Optional[bytes]:
    """Render the game state as a PNG. Returns raw bytes, or None if
    the map data isn't available.
    """
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return None

    data = _unwrap(game)
    selected = data.get('selectedMap') or {}
    map_id = selected.get('id') if isinstance(selected, dict) else None
    if not map_id:
        return None
    from python.engine.data.map_spaces_loader import get_map_spaces
    ms = get_map_spaces(map_id)
    if not ms:
        return None

    cells = list((ms.get('adjacency') or {}).keys())
    if not cells:
        return None

    # Compute grid bounds.
    xy_list = [_cell_xy(c) for c in cells]
    xy_list = [p for p in xy_list if p is not None]
    if not xy_list:
        return None
    max_col = max(p[0] for p in xy_list) + 1
    max_row = max(p[1] for p in xy_list) + 1

    img_w = margin * 2 + cell_size * max_col
    img_h = margin * 2 + cell_size * max_row
    img = Image.new('RGB', (img_w, img_h), color=(40, 40, 48))
    draw = ImageDraw.Draw(img)

    # Draw traversable cells as gray.
    cell_set = set(cells)
    blocking = set(ms.get('blocking') or [])
    for coord in cell_set:
        xy = _cell_xy(coord)
        if xy is None:
            continue
        col, row = xy
        x0 = margin + col * cell_size
        y0 = margin + row * cell_size
        x1 = x0 + cell_size
        y1 = y0 + cell_size
        if coord in blocking:
            draw.rectangle([x0, y0, x1, y1], fill=(20, 20, 28), outline=(60, 60, 70))
        else:
            draw.rectangle([x0, y0, x1, y1], fill=(60, 60, 72), outline=(90, 90, 110))

    # Draw figure positions.
    fp = data.get('figurePositions') or {}
    colors = {1: (60, 130, 220), 2: (220, 60, 60)}
    npc_color = (60, 200, 120)

    def _draw_token(coord: str, color: Tuple[int, int, int],
                    label: str = '') -> None:
        xy = _cell_xy(coord)
        if xy is None:
            return
        col, row = xy
        cx = margin + col * cell_size + cell_size // 2
        cy = margin + row * cell_size + cell_size // 2
        r = cell_size // 3
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color,
                      outline=(240, 240, 240), width=1)
        if label:
            draw.text((cx - 4, cy - 6), label[:2], fill=(240, 240, 240))

    for pn in (1, 2):
        positions = fp.get(pn) or fp.get(str(pn)) or {}
        for fk, coord in positions.items():
            if not coord:
                continue
            _draw_token(str(coord).lower(), colors[pn],
                        label=fk[:1].upper())

    # NPCs (crates, Krykna, etc.)
    npc_pos = (data.get('figurePositions') or {}).get('npc') or {}
    for fk, coord in npc_pos.items():
        if not coord:
            continue
        _draw_token(str(coord).lower(), npc_color, label='N')

    # Output to PNG bytes.
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()
