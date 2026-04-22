"""D3.8 — Pattern E.1 Force Push chain handler.

JS firing site: `src/game/abilities.js:8020-8073`. Library entry is
`ccEffect` with `forcePushEffect: true`. Three-phase interactive chain:

  Phase 1 — pick SMALL figure within 3 of the active DC
  Phase 2 — pick destination within 2 of the chosen figure
  Phase 3 — push figure + emit parting-blow warnings along the path

The Python handler accepts an explicit `active_figure_keys` + `active_position`
in ctx rather than going through the JS dcMessageMeta machinery (that lookup
— `findActiveActivationMsgId` + `getFigureKeysForDcMsg` — is D4 handler-layer
plumbing). Keeping this split means the engine-side chain is testable without
the full activation-msgId wiring.

Ctx shape (snake_case in, JS-camelCase out to mirror the handler payload that
D4 will forward to the UI):

  ctx = {
    'player_num':         int, 1 or 2   (activating player)
    'active_figure_keys': list[str]     (figure keys belonging to the active DC;
                                         excluded from the target list)
    'active_position':    str | None    (active DC top-left; None = skip
                                         distance gate, matching JS `if (actPos && ...)`)
    'chosen_figure_key':  str | None    (phase-2/3 input — pushes target figure)
    'chosen_space':       str | None    (phase-3 input — destination coord)
    'map_spaces':         dict | None   (optional override; default = resolve
                                         from game.selectedMap.id via board_data)
    'occupied_set':       iterable[str] | None  (optional override; default =
                                         derive from figurePositions +
                                         figureOrientations footprints)
  }

Return payload shape (camelCase, mirrors JS abilities.js return objects):

  Phase 1: {'requiresChoice': True, 'choiceOptions': [...], 'choiceValues': [...]}
           or {'applied': False, 'manualMessage': 'No SMALL figures within 3 spaces to push.'}

  Phase 2: {'requiresSpaceChoice': True, 'validSpaces': [...],
            'spaceChoiceLabel': '...', 'chosenFigureKey': '...'}
           or {'applied': False, 'manualMessage': ...}

  Phase 3: {'applied': True, 'logMessage': '...', 'refreshBoard': True,
            'warnings': [{'name': '...', 'space': '...'}]}
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from python.engine.abilities._chain_helpers import resolve_map_spaces
from python.engine.data.dc_effects_loader import get_dc_effects
from python.engine.mechanics.adjacency import count_spaces
from python.engine.mechanics.coords import (
    get_footprint_cells,
    normalize_coord,
)
from python.engine.mechanics.displacement import (
    _dc_name_from_figure_key,
    compute_push_path_and_warnings,
    push_figure,
)
from python.engine.mechanics.movement_cache import get_reachable_spaces


def _derive_occupied_set(game: Dict[str, Any]) -> Set[str]:
    """Walk figurePositions + figureOrientations and return the union of all
    footprint cells currently occupied. Mirrors the JS `getBoardStateForMovement`
    occupied-set derivation for the Force Push / Hop On! use case."""
    occ: Set[str] = set()
    poses = (game or {}).get('figurePositions') or {}
    oris = (game or {}).get('figureOrientations') or {}
    for pn in (1, 2):
        bucket = poses.get(pn) or {}
        for fk, pos in bucket.items():
            if not pos:
                continue
            size = oris.get(fk) or '1x1'
            for c in get_footprint_cells(normalize_coord(pos), size):
                occ.add(normalize_coord(c))
    return occ


def handle_force_push(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Three-phase Force Push handler. Mirrors `src/game/abilities.js:8020-8073`."""
    if game is None or not ctx.get('player_num'):
        return {
            'applied': False,
            'manualMessage': 'Push a SMALL figure within 3 up to 2 spaces',
        }

    chosen_figure_key = ctx.get('chosen_figure_key')
    chosen_space = ctx.get('chosen_space')
    active_figure_keys: List[str] = list(ctx.get('active_figure_keys') or [])
    active_position: Optional[str] = ctx.get('active_position')

    # ── Phase 3: chosenFigureKey AND chosenSpace ───────────────────────────
    if chosen_figure_key and chosen_space:
        pos_p1 = ((game.get('figurePositions') or {}).get(1) or {})
        target_pn = 1 if pos_p1.get(chosen_figure_key) is not None else 2
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
            f"**Force Push** — **{dc_name}** pushed from **{old_up}** to "
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

    # ── Phase 2: chosenFigureKey only — pick destination within 2 ───────────
    if chosen_figure_key:
        pos_p1 = ((game.get('figurePositions') or {}).get(1) or {})
        target_pn = 1 if pos_p1.get(chosen_figure_key) is not None else 2
        target_pos = (
            (game.get('figurePositions') or {}).get(target_pn, {}).get(chosen_figure_key)
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
        reachable = get_reachable_spaces(target_pos, 2, map_spaces, occ_list)
        valid_spaces = [
            normalize_coord(s) for s in reachable if normalize_coord(s) not in occ_set
        ]
        if not valid_spaces:
            return {
                'applied': False,
                'manualMessage': 'No empty spaces within 2 to push the figure to.',
            }
        dc_name = _dc_name_from_figure_key(chosen_figure_key)
        return {
            'requiresSpaceChoice': True,
            'validSpaces': valid_spaces,
            'spaceChoiceLabel': (
                f"**Force Push** — Choose destination (within 2 of {dc_name}):"
            ),
            'chosenFigureKey': chosen_figure_key,
        }

    # ── Phase 1: enumerate SMALL figures within 3 of active DC ─────────────
    map_spaces = resolve_map_spaces(game, ctx)
    dc_effects = get_dc_effects()
    poses = (game.get('figurePositions') or {})
    valid_keys: List[str] = []
    valid_labels: List[str] = []
    for pn in (1, 2):
        bucket = poses.get(pn) or {}
        for fk, pos in bucket.items():
            if not pos or fk in active_figure_keys:
                continue
            dc_n = _dc_name_from_figure_key(fk)
            eff = dc_effects.get(dc_n) or {}
            kws = [str(k).upper() for k in (eff.get('keywords') or [])]
            if 'MASSIVE' in kws or 'LARGE' in kws:
                continue
            if active_position and map_spaces is not None:
                dist = count_spaces(map_spaces, active_position, pos)
                if dist > 3:
                    continue
            valid_keys.append(fk)
            valid_labels.append(f"{dc_n} (P{pn})")
    if not valid_keys:
        return {
            'applied': False,
            'manualMessage': 'No SMALL figures within 3 spaces to push.',
        }
    return {
        'requiresChoice': True,
        'choiceOptions': [f"Push: {n}" for n in valid_labels],
        'choiceValues': valid_keys,
    }
