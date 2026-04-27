"""Board renderer — produces a PNG image of the game map + figures.

PIL-based renderer that:
  - Loads the real map image from vassal_extracted/images/maps/ when
    available (via map-registry.json grid params).
  - Overlays figure tokens, mission tokens, and terminal markers.
  - Falls back to a bare-bones grid when the map image is missing or
    PIL can't load GIFs.

Usage:
    from python.discord_bot.board_renderer import render_board_png
    png_bytes = render_board_png(game)
    # post alongside render_game_view's embeds
"""
from __future__ import annotations

import io
import json
import logging
import os
from functools import lru_cache
from typing import Any, Dict, Optional, Tuple

_LOG = logging.getLogger('skirbo.board_renderer')


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


@lru_cache(maxsize=1)
def _map_registry() -> Dict[str, Any]:
    root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    path = os.path.join(root, 'data', 'map-registry.json')
    try:
        with open(path) as f:
            raw = json.load(f)
    except Exception:
        return {}
    maps = raw.get('maps') if isinstance(raw, dict) else None
    if isinstance(maps, list):
        return {m.get('id'): m for m in maps if isinstance(m, dict)}
    return {}


def _map_image_and_grid(map_id: str):
    """Return (PIL.Image, grid_dict) or (None, None) if unavailable."""
    try:
        from PIL import Image  # type: ignore[import]
    except ImportError:
        return None, None
    registry = _map_registry().get(map_id) or {}
    rel_path = registry.get('imagePath')
    grid = registry.get('grid') or {}
    if not rel_path:
        return None, None
    root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    abs_path = os.path.join(root, rel_path)
    if not os.path.exists(abs_path):
        return None, None
    try:
        img = Image.open(abs_path).convert('RGB')
        return img, grid
    except Exception:
        return None, None


def render_board_png(game: Any,
                     *, cell_size: int = CELL_SIZE,
                     margin: int = MARGIN) -> Optional[bytes]:
    """Render the game state as a PNG. Returns raw bytes, or None if
    the map data isn't available.

    When the real map image is present (vassal_extracted/images/maps/),
    composites figures on top using the registry grid params. Otherwise
    falls back to the bare-bones grid renderer.
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

    # Prefer real map image if we have it; else fall back to grid draw.
    map_img, grid = _map_image_and_grid(map_id)
    if map_img is not None and grid and all(k in grid for k in ('dx', 'dy', 'x0', 'y0')):
        img = map_img.copy()
        draw = ImageDraw.Draw(img)
        cell_size = int(grid['dx'])

        def _center(coord: str):
            xy = _cell_xy(coord)
            if xy is None:
                return None
            col, row = xy
            cx = int(grid['x0']) + col * int(grid['dx']) + int(grid['dx']) // 2
            cy = int(grid['y0']) + row * int(grid['dy']) + int(grid['dy']) // 2
            return (cx, cy)

        _overlay_tokens(data, map_id, draw, selected, _center, cell_size)
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()

    # Fallback: grid-only render.
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

    def _center(coord: str):
        xy = _cell_xy(coord)
        if xy is None:
            return None
        col, row = xy
        return (
            margin + col * cell_size + cell_size // 2,
            margin + row * cell_size + cell_size // 2,
        )

    _overlay_tokens(data, map_id, draw, selected, _center, cell_size)

    # Output to PNG bytes.
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def _overlay_tokens(data, map_id, draw, selected, center_fn, cell_size):
    """Draw figures + mission tokens + terminals onto draw using center_fn."""
    # Figure positions.
    fp = data.get('figurePositions') or {}
    colors = {1: (60, 130, 220), 2: (220, 60, 60)}
    npc_color = (60, 200, 120)

    def _draw_token(coord: str, color, label: str = '') -> None:
        c = center_fn(str(coord).lower())
        if c is None:
            return
        cx, cy = c
        r = max(6, cell_size // 3)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color,
                      outline=(240, 240, 240), width=2)
        if label:
            draw.text((cx - r // 2, cy - r // 2), label[:2],
                       fill=(240, 240, 240))

    for pn in (1, 2):
        positions = fp.get(pn) or fp.get(str(pn)) or {}
        for fk, coord in positions.items():
            if not coord:
                continue
            _draw_token(str(coord).lower(), colors[pn],
                        label=fk[:1].upper())

    npc_pos = (data.get('figurePositions') or {}).get('npc') or {}
    for fk, coord in npc_pos.items():
        if not coord:
            continue
        _draw_token(str(coord).lower(), npc_color, label='N')

    # Mission tokens (yellow diamonds) + terminals (cyan squares).
    try:
        from python.engine.data.map_tokens_loader import get_map_tokens_data
        tokens = (get_map_tokens_data() or {}).get(map_id) or {}
        variant = (selected.get('variant') or 'a').lower()
        mission_key = 'missionA' if variant == 'a' else 'missionB'
        mission = tokens.get(mission_key) or {}
        positions = mission.get('positions') or {}
        r = max(5, cell_size // 4)
        for coords_list in positions.values():
            for coord in (coords_list or []):
                c = center_fn(str(coord).lower())
                if c is None:
                    continue
                cx, cy = c
                pts = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
                draw.polygon(pts, fill=(230, 200, 60),
                              outline=(250, 230, 90))
        for term in (tokens.get('terminals') or []):
            coord = term if isinstance(term, str) else (term or {}).get('coord')
            if not coord:
                continue
            c = center_fn(str(coord).lower())
            if c is None:
                continue
            cx, cy = c
            draw.rectangle([cx - r, cy - r, cx + r, cy + r],
                            fill=(80, 200, 220), outline=(130, 230, 250))
    except Exception:
        _LOG.exception('token overlay failed for map_id=%s', map_id)
