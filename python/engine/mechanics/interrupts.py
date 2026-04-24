"""Post-move interrupt detection — Python mirror of
src/game/movement-interrupts.js.

Walks the reconstructed movement path of the just-moved figure and
yields interrupt-trigger records for the handler to turn into
notifications/buttons. Covers four interrupt sources:

  C23 — Parting Blow (BRAWLER): hostile exits adjacent space (once per move)
  C15 — Dirty Trick (SMUGGLER or HUNTER): hostile enters adjacent space
  C43 — Disengage (Mak Eshka'rey): hostile enters within 3 spaces
  Overwatch (skirmish upgrade token): hostile enters space on/adjacent to token

Each trigger is a dict with camelCase keys identical to JS return shape.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from python.engine.data.dc_effects_loader import get_dc_effects
from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.data.map_tokens_loader import get_map_tokens_data
from python.engine.mechanics.card_names import card_name_includes
from python.engine.mechanics.coords import (
    edge_key,
    get_footprint_cells,
    normalize_coord,
)
from python.engine.mechanics.dc_helpers import dc_name_from_figure_key
from python.engine.mechanics.player_helpers import (
    get_cc_hand,
    get_dc_list,
    get_dc_message_ids,
    opponent_player_num,
)
from python.engine.mechanics.spatial import count_spaces


def _dc_has_trait(dc_name: str, traits: List[str]) -> bool:
    """True if the DC has any of the given trait keywords (case-insensitive)."""
    entry = (get_dc_effects() or {}).get(dc_name)
    if not entry:
        return False
    kws = [str(k).upper() for k in (entry.get('keywords') or [])]
    wanted = [t.upper() for t in traits]
    return any(t in kws for t in wanted)


def _has_card_in_hand(game: Any, player_num: int, card_name: str) -> bool:
    hand = get_cc_hand(game, player_num) or []
    return any(c == card_name for c in hand)


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'interrupts expected GameState or dict, got {type(game).__name__}'
    )


def detect_post_move_interrupts(game: Any, moving_player_num: int,
                                moving_figure_key: str,
                                path: Optional[List[str]]) -> List[Dict[str, Any]]:
    """Walk the movement path and return a list of interrupt trigger dicts.

    Mirrors src/game/movement-interrupts.js:detectPostMoveInterrupts.
    """
    if not path or len(path) < 2:
        return []

    data = _data(game)
    selected = data.get('selectedMap') or {}
    map_id = selected.get('id') if isinstance(selected, dict) else None
    raw_map_spaces = get_map_spaces(map_id) if map_id else None
    adjacency = (raw_map_spaces or {}).get('adjacency') or {}

    all_doors = (get_map_tokens_data().get(map_id) or {}).get('doors') if map_id else None
    all_doors = all_doors or []
    opened_set = {str(k).lower() for k in (data.get('openedDoors') or [])}
    closed_door_edges: Set[str] = set()
    for edge in all_doors:
        a = str(edge[0]).lower()
        b = str(edge[1]).lower()
        if f'{a}|{b}' in opened_set or f'{b}|{a}' in opened_set:
            continue
        closed_door_edges.add(edge_key(edge[0], edge[1]))

    opp_num = opponent_player_num(moving_player_num)
    _fp = data.get('figurePositions') or {}
    # Tolerate both int and string player-num keys (JSON-loaded state
    # uses strings; Python-native uses ints).
    hostile_positions = _fp.get(opp_num) or _fp.get(str(opp_num)) or {}
    triggers: List[Dict[str, Any]] = []
    parting_blow_triggered = False

    # Pre-compute hostile figure info (footprint cells per figure).
    hostile_figures = []
    orientations = data.get('figureOrientations') or {}
    for hfk, h_pos in hostile_positions.items():
        if not h_pos:
            continue
        h_dc_name = dc_name_from_figure_key(hfk)
        h_size = orientations.get(hfk) or '1x1'
        h_cells = [normalize_coord(c) for c in get_footprint_cells(h_pos, h_size)]
        hostile_figures.append({
            'figureKey': hfk, 'dcName': h_dc_name,
            'cells': h_cells, 'pos': h_pos,
        })

    for i in range(len(path) - 1):
        exiting_space = normalize_coord(path[i])
        entering_space = normalize_coord(path[i + 1])
        exit_adj = {normalize_coord(n) for n in (adjacency.get(exiting_space) or [])}
        enter_adj = {normalize_coord(n) for n in (adjacency.get(entering_space) or [])}

        for hf in hostile_figures:
            # --- C23: Parting Blow (once per move, BRAWLER exiting adjacency) ---
            if not parting_blow_triggered:
                was_adjacent = any(c in exit_adj or c == exiting_space for c in hf['cells'])
                still_adjacent = any(c in enter_adj or c == entering_space for c in hf['cells'])
                if was_adjacent and not still_adjacent:
                    if _dc_has_trait(hf['dcName'], ['BRAWLER']) and _has_card_in_hand(game, opp_num, 'Parting Blow'):
                        parting_blow_triggered = True
                        display_name = hf['dcName'].replace('_', ' ')
                        triggers.append({
                            'type': 'partingBlow',
                            'cardName': 'Parting Blow',
                            'candidatePlayerNum': opp_num,
                            'candidateFigureKey': hf['figureKey'],
                            'candidateDcName': hf['dcName'],
                            'triggerSpace': exiting_space,
                            'description': (
                                f"**{display_name}** (Brawler) — hostile exited adjacent space "
                                f"**{exiting_space.upper()}**. Parting Blow opportunity."
                            ),
                        })

            # --- C15: Dirty Trick (SMUGGLER or HUNTER, entering adjacency) ---
            now_adjacent = any(c in enter_adj or c == entering_space for c in hf['cells'])
            was_adjacent_before = any(c in exit_adj or c == exiting_space for c in hf['cells'])
            if now_adjacent and not was_adjacent_before:
                if _dc_has_trait(hf['dcName'], ['SMUGGLER', 'HUNTER']) and _has_card_in_hand(game, opp_num, 'Dirty Trick'):
                    already = any(
                        t['type'] == 'dirtyTrick' and t['candidateFigureKey'] == hf['figureKey']
                        for t in triggers
                    )
                    if not already:
                        display_name = hf['dcName'].replace('_', ' ')
                        triggers.append({
                            'type': 'dirtyTrick',
                            'cardName': 'Dirty Trick',
                            'candidatePlayerNum': opp_num,
                            'candidateFigureKey': hf['figureKey'],
                            'candidateDcName': hf['dcName'],
                            'triggerSpace': entering_space,
                            'description': (
                                f"**{display_name}** (Smuggler/Hunter) — hostile entered "
                                f"adjacent space **{entering_space.upper()}**. Dirty Trick opportunity."
                            ),
                        })

            # --- C43: Disengage (Mak Eshka'rey, entering within 3 spaces) ---
            if hf['dcName'] == "Mak Eshka'rey":
                dist_after = count_spaces(raw_map_spaces, entering_space, hf['pos'], closed_door_edges)
                dist_before = count_spaces(raw_map_spaces, exiting_space, hf['pos'], closed_door_edges)
                if dist_after <= 3 and dist_before > 3:
                    if _has_card_in_hand(game, opp_num, 'Disengage'):
                        already = any(
                            t['type'] == 'disengage' and t['candidateFigureKey'] == hf['figureKey']
                            for t in triggers
                        )
                        if not already:
                            triggers.append({
                                'type': 'disengage',
                                'cardName': 'Disengage',
                                'candidatePlayerNum': opp_num,
                                'candidateFigureKey': hf['figureKey'],
                                'candidateDcName': hf['dcName'],
                                'triggerSpace': entering_space,
                                'description': (
                                    f"**Mak Eshka'rey** — hostile entered within 3 spaces "
                                    f"(at **{entering_space.upper()}**). Disengage opportunity."
                                ),
                            })

        # --- Overwatch: hostile enters space on/adjacent to Overwatch token ---
        overwatch_map = data.get('overwatchTokenPosition') or {}
        for ow_msg_id, ow_space in overwatch_map.items():
            norm_ow_space = normalize_coord(ow_space)
            is_on_or_adj = entering_space == norm_ow_space or norm_ow_space in enter_adj
            if not is_on_or_adj:
                continue
            was_on_or_adj = exiting_space == norm_ow_space or norm_ow_space in exit_adj
            if was_on_or_adj:
                continue
            # Determine owner
            ow_player_num: Optional[int] = None
            if ow_msg_id in (get_dc_message_ids(game, 1) or []):
                ow_player_num = 1
            elif ow_msg_id in (get_dc_message_ids(game, 2) or []):
                ow_player_num = 2
            if not ow_player_num or ow_player_num == moving_player_num:
                continue
            exhausted = (data.get('exhaustedSkirmishUpgrades') or {}).get(ow_msg_id)
            if card_name_includes(exhausted, 'Overwatch'):
                continue
            if any(t['type'] == 'overwatch' and t.get('owMsgId') == ow_msg_id for t in triggers):
                continue
            ow_dc_list = get_dc_list(game, ow_player_num) or []
            ow_msg_ids = get_dc_message_ids(game, ow_player_num) or []
            ow_idx = ow_msg_ids.index(ow_msg_id) if ow_msg_id in ow_msg_ids else -1
            ow_dc_name = (
                (ow_dc_list[ow_idx].get('dcName') if ow_idx >= 0 and isinstance(ow_dc_list[ow_idx], dict)
                 else None) or 'E-Web Engineer'
            )
            ow_display_name = (
                (ow_dc_list[ow_idx].get('displayName') if ow_idx >= 0 and isinstance(ow_dc_list[ow_idx], dict)
                 else None) or ow_dc_name
            )
            triggers.append({
                'type': 'overwatch',
                'cardName': 'Overwatch',
                'candidatePlayerNum': ow_player_num,
                'candidateFigureKey': None,
                'candidateDcName': ow_dc_name,
                'triggerSpace': entering_space,
                'description': (
                    f"**{ow_display_name}** (Overwatch) — hostile entered space "
                    f"on/adjacent to Overwatch token at **{norm_ow_space.upper()}**. "
                    f"Interrupt attack opportunity."
                ),
                'owMsgId': ow_msg_id,
                'owTokenSpace': norm_ow_space,
            })

    return triggers
