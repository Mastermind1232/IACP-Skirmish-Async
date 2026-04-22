"""Interact option resolver — Python mirror of src/handlers/interact.js
effect dispatch (without Discord IO).

Public API:

  resolve_interact_option(game, player_num, figure_key, map_id, option_id)
      -> {'appliedEffect', 'logMessage', 'undoSnapshot'}

  Translates an interact option id (retrieve_contraband, use_terminal,
  open_door_<edgeKey,...>, launch_panel_<coord>_<colored|gray>) into
  the state change the Phase 7 INTERACT handler would apply. Discord
  IO (message edits, log posts) stays in the handler layer; this module
  owns pure state mutation + a log string.

Enumeration of legal options lives in
board_helpers.get_legal_interact_options. This module assumes the
caller already validated that option_id is in that list.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from python.engine.mechanics.board_helpers import (
    get_figure_adjacent_coords_from_set,
)
from python.engine.mechanics.coords import to_lower_set


class UnknownInteractOption(ValueError):
    """Raised when option_id doesn't match any known interact dispatch."""


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'interact expected GameState or dict, got {type(game).__name__}'
    )


def resolve_interact_option(game: Any, player_num: int, figure_key: str,
                            map_id: Optional[str], option_id: str
                            ) -> Dict[str, Any]:
    """Apply the effect of option_id and return a summary.

    Returns {'appliedEffect', 'logMessage', 'undoSnapshot'}:
      - appliedEffect: 'retrieve_contraband' | 'launch_panel' | 'use_terminal' |
        'open_door' | 'other'
      - logMessage: canonical string (Phase 12 Discord UI will format for embed)
      - undoSnapshot: dict of state-keys-to-restore for the undo stack

    Raises UnknownInteractOption when option_id is unrecognized.
    """
    data = _data(game)
    snapshot: Dict[str, Any] = {}
    msg_upper_id = option_id

    # retrieve_contraband — pick up mission token (or dropped-on-defeat token)
    if option_id == 'retrieve_contraband':
        snapshot['previousContraband'] = (
            (data.get('figureContraband') or {}).get(figure_key)
        )
        snapshot['previousDroppedContrabandSpaces'] = (
            list(data.get('droppedContrabandSpaces') or [])
            if data.get('droppedContrabandSpaces') else None
        )
        data.setdefault('figureContraband', {})
        data['figureContraband'][figure_key] = True
        # RTK-002: if picking up a dropped-on-defeat token, consume one dropped
        # entry the figure is adjacent to / on.
        dropped = data.get('droppedContrabandSpaces') or []
        if dropped:
            dropped_set = to_lower_set(dropped)
            hits = get_figure_adjacent_coords_from_set(
                game, player_num, figure_key, map_id, dropped_set,
            )
            if hits:
                consumed = str(hits[0]).lower()
                if consumed in data['droppedContrabandSpaces']:
                    data['droppedContrabandSpaces'].remove(consumed)
        return {
            'appliedEffect': 'retrieve_contraband',
            'logMessage': f'{figure_key} retrieved mission token.',
            'undoSnapshot': snapshot,
        }

    # launch_panel_<coord>_<colored|gray> — flip panel side
    if option_id.startswith('launch_panel_'):
        rest = option_id[len('launch_panel_'):]
        parts = rest.split('_')
        if len(parts) < 2:
            raise UnknownInteractOption(f'malformed launch_panel option: {option_id}')
        coord = parts[0].lower()
        side = parts[1]
        snapshot['previousLaunchPanelState'] = (
            dict(data.get('launchPanelState') or {})
        )
        snapshot['previousP1LaunchFlipped'] = data.get('p1LaunchPanelFlippedThisRound')
        snapshot['previousP2LaunchFlipped'] = data.get('p2LaunchPanelFlippedThisRound')
        data.setdefault('launchPanelState', {})
        data['launchPanelState'][coord] = side
        if player_num == 1:
            data['p1LaunchPanelFlippedThisRound'] = True
        else:
            data['p2LaunchPanelFlippedThisRound'] = True
        return {
            'appliedEffect': 'launch_panel',
            'logMessage': f'{figure_key} flipped panel {coord.upper()} → {side}.',
            'undoSnapshot': snapshot,
            'launchPanelCoord': coord,
        }

    # use_terminal — no state mutation in the handler port itself; mission rules
    # apply terminal-control effects via count_terminals_controlled_by_player.
    if option_id == 'use_terminal':
        return {
            'appliedEffect': 'use_terminal',
            'logMessage': f'{figure_key} used terminal.',
            'undoSnapshot': snapshot,
        }

    # open_door_<edgeKey1,edgeKey2,...> — open every edge in the multi-cell door
    if option_id.startswith('open_door_'):
        edge_keys_csv = option_id[len('open_door_'):]
        edge_keys = edge_keys_csv.split(',')
        snapshot['previousOpenedDoors'] = list(data.get('openedDoors') or [])
        snapshot['openDoorEdgeKey'] = edge_keys_csv
        data.setdefault('openedDoors', [])
        for ek in edge_keys:
            if ek not in data['openedDoors']:
                data['openedDoors'].append(ek)
        door_label = '–'.join(s.upper() for s in edge_keys[0].split('|'))
        return {
            'appliedEffect': 'open_door',
            'logMessage': f'{figure_key} opened door ({door_label}).',
            'undoSnapshot': snapshot,
        }

    raise UnknownInteractOption(f'unknown interact option: {option_id}')
