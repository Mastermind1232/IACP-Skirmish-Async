"""D3.9 — figure_key ↔ DC-message-id helpers.

Pure-engine port of two helpers from `src/engine/game-readers.js`:

  - `parse_figure_key` — regex split a figure key "DcName-dgIdx-figIdx" into
    (dc_name, dg_index, figure_index). Mirrors the JS
    `figureKey.match(/^(.+)-(\\d+)-(\\d+)$/)` parse used throughout the JS
    handler layer (combat.js, movement.js, abilities.js).

  - `find_dc_message_id_for_figure` — given a figure key and a
    `dcMessageMeta` map, find the matching DC message id by (gameId,
    playerNum, dcName, dgIndex). Port of JS `findDcMessageIdForFigure`
    at `src/engine/game-readers.js:55-66`.

**Why these land in a shared mechanics module** (not inline in
`pattern_d_handlers.py`): every defender-side combat-declare handler lands
with the same need — go from a defender `figureKey` to a DC-message-id so
`apply_strain_to_figure` / `reduce_hp` / condition appliers can target the
right health-state slot. Co-locating the lookup here keeps the primitive
reusable for future D3 and E-chain handlers (exploit_weakness,
distracting_*, conclusion, Force Throw damage-on-landing, Havoc Shot
multi-target, etc.) instead of forcing each handler to re-derive it.

The helpers are agnostic of what trigger fires them — they're pure mappings
over the figure-key string shape and the live `dcMessageMeta` state.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Mapping, Optional, Tuple


_FIGURE_KEY_RE = re.compile(r'^(.+)-(\d+)-(\d+)$')
"""Matches "DcName-dgIdx-figIdx". Group 1 = dc_name (greedy to allow hyphens
in DC names like 'IG-88'), groups 2/3 = dg_index and figure_index as digits."""

_DISPLAY_NAME_DG_RE = re.compile(r'\[(?:DG|Group) (\d+)\]')
"""Extracts the group index from a DC displayName like
'Imperial Officer [DG 1]' or 'Probe Droid [Group 2]'."""


def parse_figure_key(figure_key: str) -> Optional[Tuple[str, int, int]]:
    """Split a figure key into (dc_name, dg_index, figure_index).

    Returns `None` for strings that don't match the expected shape — matches
    JS `figureKey.match(...)` returning null and the downstream `m ? m[1] :
    figureKey` / `m ? m[2] : '1'` fallbacks. Callers decide whether to treat
    a failed parse as an error or fall back on the raw string.
    """
    if not isinstance(figure_key, str):
        return None
    m = _FIGURE_KEY_RE.match(figure_key)
    if not m:
        return None
    return m.group(1), int(m.group(2)), int(m.group(3))


def find_dc_message_id_for_figure(game_id: Optional[str],
                                  player_num: int,
                                  figure_key: str,
                                  dc_message_meta: Optional[Mapping[str, Dict[str, Any]]]
                                  ) -> Optional[str]:
    """Find the DC message id for a figure.

    Port of `src/engine/game-readers.js:55-66`. Walks `dc_message_meta`
    looking for the first entry matching (gameId, playerNum, dcName,
    dgIndex). Returns `None` when no entry matches — mirrors JS `null`.

    Falls back to `dc_name = figure_key` and `dg_index = '1'` when the
    figure key doesn't split via the regex (matches JS's `m ? m[1] :
    figureKey` / `m ? m[2] : '1'` defaults).

    `dc_message_meta` can be either a dict or any iterable of `(msg_id,
    meta)` pairs — the JS side uses a Map, Python tests often use a dict;
    either works here.
    """
    parsed = parse_figure_key(figure_key) if isinstance(figure_key, str) else None
    if parsed is None:
        dc_name: str = figure_key if isinstance(figure_key, str) else ''
        dg_index_str = '1'
    else:
        dc_name, dg_idx, _fig_idx = parsed
        dg_index_str = str(dg_idx)

    if not dc_message_meta:
        return None

    # Accept either a dict-like mapping or an iterable of (msgId, meta) pairs.
    if isinstance(dc_message_meta, Mapping):
        items: Iterable = dc_message_meta.items()
    else:
        items = dc_message_meta

    for msg_id, meta in items:
        if not isinstance(meta, dict):
            continue
        if meta.get('gameId') != game_id:
            continue
        if meta.get('playerNum') != player_num:
            continue
        display_name = meta.get('displayName') or ''
        dn_match = _DISPLAY_NAME_DG_RE.search(display_name)
        meta_dg_index = str(dn_match.group(1)) if dn_match else '1'
        if meta.get('dcName') == dc_name and meta_dg_index == dg_index_str:
            return msg_id

    return None
