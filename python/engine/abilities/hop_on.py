"""D3.13 — Pattern E Hop On chain handler (Kuiil companion push).

JS firing site: `src/game/abilities.js:8075-8124`. Library entry
`hop_on_kuiil` is `dcSpecial` + `hopOnPush: true`. Three-phase interactive
chain — push a FRIENDLY SMALL figure up to 4 spaces.

**Shape vs Pattern E.1 Force Push** (D3.8, `force_push.py`):

  - Phase 1 iterates ONLY the activating player (`playerNum`) — always
    friendly. Force Push iterates both players.
  - Phase 1 excludes the active DC's figure keys via `actKeys` (same as
    Force Push's `active_figure_keys`).
  - Phase 1 has NO distance gate. Force Push has range-3. JS reads
    `actPos` but never uses it; we drop the unused field from ctx.
  - Phase 1 label is just the DC name (`'Push: {dcN}'`) — no `(P1)/(P2)`
    tag since targets are always friendly. Force Push labels are P-tagged.
  - Phase 2 uses `get_reachable_spaces(target_pos, 4, ...)` with 4 MP
    (Force Push uses 2). Occupied set is footprint-based via
    `force_push._derive_occupied_set` — same shape Force Push uses
    (still only two consumers of the footprint set, so it stays private
    to `force_push.py` and Hop On imports it directly).
  - Phase 2 label omits the P-tag: `'Choose destination (within 4 of {dcN}):'`.
  - Phase 3 log line `**Hop On!** — **{dcName}** pushed from **{OLD}** to
    **{DEST}**{path_str}.` — coords ARE bolded (matches Force Push, differs
    from Force Throw's un-bolded format).
  - Return keys match Force Push: Phase 1 `choiceValues`, Phase 2
    `chosenFigureKey`. Force Throw uses `targetFigureKeys`/`targetFigureKey`.
  - No strain-to-self (Force Throw pays 1 Strain when valid targets exist;
    Hop On does not).

**Ctx contract:**

  ctx = {
    'player_num':         int, 1 or 2       (required; activating player)
    'active_figure_keys': list[str] | None  (active DC figure keys — excluded
                                             from Phase 1 target pool;
                                             JS `actKeys` via
                                             `getFigureKeysForDcMsg`)
    'chosen_figure_key':  str | None        (Phase 2/3 input — target figure)
    'chosen_space':       str | None        (Phase 3 input — destination coord)
    'map_spaces':         dict | None       (optional override; default =
                                             load via game.selectedMap.id)
    'occupied_set':       iterable[str] | None  (optional override; default =
                                             derive from figurePositions +
                                             figureOrientations footprints)
  }

**Return payload shapes** (camelCase, mirrors JS handler returns):

  Phase 1: {'requiresChoice': True, 'choiceOptions': [...],
            'choiceValues': [...]}
           or {'applied': False, 'manualMessage': 'No friendly SMALL figures
                                                   to push.'}

  Phase 2: {'requiresSpaceChoice': True, 'validSpaces': [...],
            'spaceChoiceLabel': '...', 'chosenFigureKey': '...'}
           or {'applied': False, 'manualMessage': ...}

  Phase 3: {'applied': True, 'logMessage': '...', 'refreshBoard': True,
            'warnings': [{'name': '...', 'space': '...'}]}
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from python.engine.abilities._chain_helpers import resolve_map_spaces
from python.engine.abilities.force_push import _derive_occupied_set
from python.engine.data.dc_effects_loader import get_dc_effects
from python.engine.mechanics.coords import normalize_coord
from python.engine.mechanics.displacement import (
    _dc_name_from_figure_key,
    compute_push_path_and_warnings,
    push_figure,
)
from python.engine.mechanics.movement_cache import get_reachable_spaces


def handle_hop_on(game: Dict[str, Any],
                  ability_id: str,
                  ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Three-phase Hop On handler. Mirrors `src/game/abilities.js:8075-8124`."""
    if game is None or not ctx.get('player_num'):
        return {
            'applied': False,
            'manualMessage': 'Hop On!',
        }

    player_num: int = ctx['player_num']
    chosen_figure_key: Optional[str] = ctx.get('chosen_figure_key')
    chosen_space: Optional[str] = ctx.get('chosen_space')
    active_figure_keys: List[str] = list(ctx.get('active_figure_keys') or [])

    # ── Phase 3: chosenFigureKey AND chosenSpace ───────────────────────────
    if chosen_figure_key and chosen_space:
        target_pn = player_num  # always friendly — JS `targetPn = playerNum`
        push_result = push_figure(game, target_pn, chosen_figure_key, chosen_space)
        if push_result is None:
            old_pos: Optional[str] = None
            dest_lower = normalize_coord(chosen_space)
        else:
            old_pos = push_result['prevPos']
            dest_lower = push_result['newPos']
        dc_name = _dc_name_from_figure_key(chosen_figure_key)
        map_spaces = resolve_map_spaces(game, ctx)
        map_adjacency = (map_spaces or {}).get('adjacency') if map_spaces else None
        path = compute_push_path_and_warnings(
            game, old_pos, dest_lower, target_pn, map_adjacency,
        )
        old_up = str(old_pos).upper() if old_pos else '?'
        dest_up = str(chosen_space).upper()
        log_msg = (
            f"**Hop On!** — **{dc_name}** pushed from **{old_up}** to "
            f"**{dest_up}**{path['path_str']}."
        )
        if path['warnings']:
            warn_list = ', '.join(
                f"**{w['name']}** (exited adj at {w['space']})"
                for w in path['warnings']
            )
            log_msg += (
                f"\n⚠️ Exits adjacency to: {warn_list} — opponent may play "
                f"**Parting Blow** or similar interrupts."
            )
        return {
            'applied': True,
            'logMessage': log_msg,
            'refreshBoard': True,
            'warnings': path['warnings'],
        }

    # ── Phase 2: chosenFigureKey only — pick destination within 4 ──────────
    if chosen_figure_key:
        target_pos = (
            (game.get('figurePositions') or {}).get(player_num, {}).get(chosen_figure_key)
        )
        if not target_pos:
            return {
                'applied': False,
                'manualMessage': 'Could not locate target figure position. Push manually.',
            }
        map_spaces = resolve_map_spaces(game, ctx)
        if not map_spaces:
            return {
                'applied': False,
                'manualMessage': 'Push manually (no map data).',
            }
        occ_override = ctx.get('occupied_set')
        if occ_override is not None:
            occ_set = {normalize_coord(c) for c in occ_override}
        else:
            occ_set = _derive_occupied_set(game)
        occ_list = list(occ_set)
        reachable = get_reachable_spaces(target_pos, 4, map_spaces, occ_list)
        valid_spaces = [
            normalize_coord(s) for s in reachable if normalize_coord(s) not in occ_set
        ]
        if not valid_spaces:
            return {
                'applied': False,
                'manualMessage': 'No empty spaces within 4 to push the figure to.',
            }
        dc_name = _dc_name_from_figure_key(chosen_figure_key)
        return {
            'requiresSpaceChoice': True,
            'validSpaces': valid_spaces,
            'spaceChoiceLabel': (
                f"**Hop On!** — Choose destination (within 4 of {dc_name}):"
            ),
            'chosenFigureKey': chosen_figure_key,
        }

    # ── Phase 1: enumerate friendly SMALL figures ───────────────────────────
    dc_effects = get_dc_effects()
    poses = (game.get('figurePositions') or {})
    bucket = poses.get(player_num) or {}
    valid_keys: List[str] = []
    valid_labels: List[str] = []
    for fk, pos in bucket.items():
        if not pos or fk in active_figure_keys:
            continue
        dc_n = _dc_name_from_figure_key(fk)
        eff = dc_effects.get(dc_n) or {}
        kws = [str(k).upper() for k in (eff.get('keywords') or [])]
        if 'MASSIVE' in kws or 'LARGE' in kws:
            continue
        valid_keys.append(fk)
        valid_labels.append(dc_n)
    if not valid_keys:
        return {
            'applied': False,
            'manualMessage': 'No friendly SMALL figures to push.',
        }
    return {
        'requiresChoice': True,
        'choiceOptions': [f"Push: {n}" for n in valid_labels],
        'choiceValues': valid_keys,
    }
