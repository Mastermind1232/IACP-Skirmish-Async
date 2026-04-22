"""D7.5 — data/figure-sizes.json loader.

The JSON has top keys `{source, extractedAt, figureSizes, ...}`; we unwrap
to `.figureSizes` — a dict keyed by DC name whose value is a size string
like '1x1' / '2x2' / '1x2' / '2x3'.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
FIGURE_SIZES_PATH = REPO_ROOT / 'data' / 'figure-sizes.json'

_figure_sizes: Optional[Dict[str, str]] = None


def reset_cache() -> None:
    global _figure_sizes
    _figure_sizes = None


def get_figure_sizes() -> Dict[str, str]:
    """Return {dc_name: size_string} for all known figures."""
    global _figure_sizes
    if _figure_sizes is None:
        with open(FIGURE_SIZES_PATH, 'r') as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            sizes = raw.get('figureSizes', {})
            _figure_sizes = sizes if isinstance(sizes, dict) else {}
        else:
            _figure_sizes = {}
    return _figure_sizes


def get_figure_size(dc_name: str, default: str = '1x1') -> str:
    """Look up a DC's footprint size; falls back to 1x1."""
    if not dc_name:
        return default
    sizes = get_figure_sizes()
    if dc_name in sizes:
        return sizes[dc_name]
    # Bracket-strip fallback (same pattern as dc_effects_loader).
    import re
    stripped = re.sub(r'\s*\[.*\]\s*$', '', dc_name)
    return sizes.get(stripped, default)
