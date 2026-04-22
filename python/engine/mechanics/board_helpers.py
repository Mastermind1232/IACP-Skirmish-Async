"""Pure board-state helpers — Python mirror of src/game/board-helpers.js.

Full port covering:
  - get_closed_door_edges / count_game_spaces (leaf for M3-G)
  - get_effective_figure_size / get_player_occupied_cells /
    get_player_occupied_cells_for_control
  - get_mission_token_coords
  - is_figure_adjacent_or_on_mission_token / is_figure_adjacent_or_on_any /
    get_figure_adjacent_coords_from_set
  - get_effective_speed (mission carry penalty, round VEHICLE bonus)
  - is_figure_in_deployment_zone
  - get_space_controller (with Alter Mind + Powerful Influence exclusions)
  - count_terminals_controlled_by_player
  - get_figures_on_or_adjacent_to_space
  - get_legal_interact_options (carry/flip missions, terminals, door groups)

Private helpers ported verbatim:
  - _is_excluded_from_control (Salacious, Child, Dio)
  - _get_alter_mind_excluded_cells
  - _get_powerful_influence_excluded_cells
  - _group_door_edges
  - _geometric_neighbors
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from python.engine.data.deployment_zones_loader import get_deployment_zones
from python.engine.data.dc_effects_loader import get_dc_effect, get_dc_effects
from python.engine.data.figure_sizes_loader import get_figure_size
from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.data.map_tokens_loader import get_map_tokens_data
from python.engine.mechanics.coords import (
    col_row_to_coord,
    edge_key,
    get_footprint_cells,
    normalize_coord,
    parse_coord,
    to_lower_set,
)
from python.engine.mechanics.dc_helpers import dc_name_from_figure_key
from python.engine.mechanics.player_helpers import get_initiative_player_num
from python.engine.mechanics.spatial import INFINITY, count_spaces


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'board_helpers expected GameState or dict, got {type(game).__name__}'
    )


# ---------------------------------------------------------------------------
# Closed-door edges + graph distance (leaf — already shipped in M3-G)

def get_closed_door_edges(game: Any) -> Set[str]:
    """Set of edge-key strings for doors that are NOT yet opened."""
    data = _data(game)
    selected = data.get('selectedMap') or {}
    map_id = selected.get('id') if isinstance(selected, dict) else None
    if not map_id:
        return set()
    all_doors = (get_map_tokens_data().get(map_id) or {}).get('doors') or []
    if not all_doors:
        return set()
    opened_set = {str(k).lower() for k in (data.get('openedDoors') or [])}
    closed: Set[str] = set()
    for edge in all_doors:
        a = str(edge[0]).lower()
        b = str(edge[1]).lower()
        if f'{a}|{b}' in opened_set or f'{b}|{a}' in opened_set:
            continue
        closed.add(edge_key(edge[0], edge[1]))
    return closed


def count_game_spaces(game: Any, coord_a: str, coord_b: str) -> float:
    """Graph distance between two spaces, respecting closed doors."""
    data = _data(game)
    selected = data.get('selectedMap') or {}
    map_id = selected.get('id') if isinstance(selected, dict) else None
    ms = get_map_spaces(map_id) if map_id else None
    if not ms:
        return INFINITY
    return count_spaces(ms, coord_a, coord_b, get_closed_door_edges(game))


# ---------------------------------------------------------------------------
# Figure size / occupancy

def get_effective_figure_size(game: Any, figure_key: str, dc_name: str) -> str:
    """Effective size (figureOrientations override, else base size from data)."""
    data = _data(game)
    orientations = data.get('figureOrientations') or {}
    return orientations.get(figure_key) or get_figure_size(dc_name)


def get_player_occupied_cells(game: Any, player_num: int) -> Set[str]:
    """Normalized coord set of cells occupied by a player's figures."""
    data = _data(game)
    cells: Set[str] = set()
    poses = (data.get('figurePositions') or {}).get(player_num) or {}
    for fk, coord in poses.items():
        if not coord:
            continue
        dc_name = dc_name_from_figure_key(fk)
        size = get_effective_figure_size(game, fk, dc_name)
        for c in get_footprint_cells(coord, size):
            cells.add(normalize_coord(c))
    return cells


def _is_excluded_from_control(game: Any, player_num: int, figure_key: str) -> bool:
    """Companion figures that don't count for control.

    - Salacious B. Crumb: always
    - The Child: when incapacitated
    - Dio: while Iden Versio is alive on same side
    """
    data = _data(game)
    dc_name = dc_name_from_figure_key(figure_key).lower()
    if dc_name == 'salacious b. crumb':
        return True
    if dc_name == 'the child' and data.get('childIncapacitated'):
        return True
    if dc_name == 'dio':
        poses = (data.get('figurePositions') or {}).get(player_num) or {}
        iden_alive = any(dc_name_from_figure_key(fk) == 'Iden Versio' for fk in poses)
        if iden_alive:
            return True
    return False


def get_player_occupied_cells_for_control(game: Any, player_num: int) -> Set[str]:
    """Like get_player_occupied_cells but excludes companion figures."""
    data = _data(game)
    cells: Set[str] = set()
    poses = (data.get('figurePositions') or {}).get(player_num) or {}
    for fk, coord in poses.items():
        if not coord:
            continue
        if _is_excluded_from_control(game, player_num, fk):
            continue
        dc_name = dc_name_from_figure_key(fk)
        size = get_effective_figure_size(game, fk, dc_name)
        for c in get_footprint_cells(coord, size):
            cells.add(normalize_coord(c))
    return cells


# ---------------------------------------------------------------------------
# Mission token coords + adjacency queries

def get_mission_token_coords(mission_token_data: Any) -> List[str]:
    """Extract flat coord list from a missionA/missionB block (generic)."""
    if not mission_token_data:
        return []
    if isinstance(mission_token_data, dict) and 'positions' in mission_token_data \
            and isinstance(mission_token_data['positions'], dict):
        flat: List[str] = []
        for v in mission_token_data['positions'].values():
            if isinstance(v, list):
                flat.extend(v)
        return flat
    if isinstance(mission_token_data, dict):
        for val in mission_token_data.values():
            if isinstance(val, list) and val and isinstance(val[0], str):
                return val
    return []


def _geometric_neighbors(coord: str) -> List[str]:
    """8-connected geometric neighbors (no walls/blocking)."""
    col, row = parse_coord(coord)
    out: List[str] = []
    for dc in (-1, 0, 1):
        for dr in (-1, 0, 1):
            if dc == 0 and dr == 0:
                continue
            nc, nr = col + dc, row + dr
            if nc >= 0 and nr >= 0:
                out.append(normalize_coord(col_row_to_coord(nc, nr)))
    return out


def get_figure_adjacent_coords_from_set(game: Any, player_num: int, figure_key: str,
                                        map_id: Optional[str],
                                        coord_set: Set[str]) -> List[str]:
    """Return coords from coord_set on-or-adjacent to the figure's footprint.

    Uses graph adjacency first, then geometric fallback (for blocking-terrain
    targets like mission panels that sit outside the movement adjacency graph).
    """
    data = _data(game)
    if not coord_set:
        return []
    map_spaces = get_map_spaces(map_id) if map_id else None
    if not map_spaces or not map_spaces.get('adjacency'):
        return []
    adjacency = map_spaces.get('adjacency') or {}
    pos = ((data.get('figurePositions') or {}).get(player_num) or {}).get(figure_key)
    if not pos:
        return []
    dc_name = dc_name_from_figure_key(figure_key)
    footprint = get_footprint_cells(pos, get_effective_figure_size(game, figure_key, dc_name))
    result: Set[str] = set()
    for c in footprint:
        n = normalize_coord(c)
        if n in coord_set:
            result.add(n)
        for adj in (adjacency.get(n) or []):
            na = normalize_coord(adj)
            if na in coord_set:
                result.add(na)
        for gn in _geometric_neighbors(n):
            if gn in coord_set:
                result.add(gn)
    return list(result)


def is_figure_adjacent_or_on_any(game: Any, player_num: int, figure_key: str,
                                 map_id: Optional[str],
                                 coord_set: Set[str]) -> bool:
    return len(get_figure_adjacent_coords_from_set(game, player_num, figure_key, map_id, coord_set)) > 0


def is_figure_adjacent_or_on_mission_token(game: Any, player_num: int,
                                           figure_key: str, map_id: Optional[str],
                                           mission_side: str) -> bool:
    map_data = (get_map_tokens_data() or {}).get(map_id) or {}
    coords = get_mission_token_coords(map_data.get(mission_side))
    if not coords:
        return False
    token_set = to_lower_set(coords)
    return is_figure_adjacent_or_on_any(game, player_num, figure_key, map_id, token_set)


# ---------------------------------------------------------------------------
# Effective speed (mission carry penalty + round VEHICLE bonus)

def get_effective_speed(dc_name: str, figure_key: str, game: Any,
                        player_num: Optional[int] = None) -> int:
    """Base speed with mission carry-penalty and round VEHICLE bonus applied."""
    data = _data(game)
    stats = get_dc_effect(dc_name) or {}
    base = int(stats.get('speed') or 4)
    mech = ((data.get('selectedMission') or {}).get('mechanics')
            if isinstance(data.get('selectedMission'), dict) else None) or {}
    if mech.get('type') == 'carry' and mech.get('speedPenalty') \
            and (data.get('figureContraband') or {}).get(figure_key):
        base = max(0, base + mech['speedPenalty'])
    if player_num and (data.get('roundVehicleSpeedBonus') or {}).get(player_num):
        eff = get_dc_effect(dc_name) or {}
        keywords = [str(k).upper() for k in (eff.get('keywords') or [])]
        if 'VEHICLE' in keywords:
            base += data['roundVehicleSpeedBonus'][player_num]
    return base


# ---------------------------------------------------------------------------
# Deployment zones

def is_figure_in_deployment_zone(game: Any, player_num: int, figure_key: str,
                                 map_id: Optional[str]) -> bool:
    """True if figure's footprint intersects that player's deployment zone."""
    data = _data(game)
    zone_data = (get_deployment_zones() or {}).get(map_id)
    if not zone_data:
        return False
    init_player_num = get_initiative_player_num(game)
    chosen = data.get('deploymentZoneChosen')
    if player_num == init_player_num:
        zone = chosen
    else:
        zone = 'blue' if chosen == 'red' else 'red'
    zone_spaces = to_lower_set(zone_data.get(zone) or [])
    pos = ((data.get('figurePositions') or {}).get(player_num) or {}).get(figure_key)
    if not pos:
        return False
    dc_name = dc_name_from_figure_key(figure_key)
    footprint = get_footprint_cells(pos, get_effective_figure_size(game, figure_key, dc_name))
    return any(normalize_coord(c) in zone_spaces for c in footprint)


# ---------------------------------------------------------------------------
# Alter Mind + Powerful Influence exclusion maps (private helpers)

def _get_alter_mind_excluded_cells(game: Any) -> Dict[int, Set[str]]:
    """{pn: set(cells)} — cells that don't count for control due to Alter Mind.

    Alter Mind (Obi-Wan Kenobi): opposing figures cost ≤9 within 3 spaces of
    Obi-Wan don't count for control.
    """
    data = _data(game)
    excluded: Dict[int, Set[str]] = {}
    all_eff = get_dc_effects() or {}
    for pn in (1, 2):
        opp_pn = 3 - pn
        for fk, pos in ((data.get('figurePositions') or {}).get(opp_pn) or {}).items():
            if not pos:
                continue
            dc_name = dc_name_from_figure_key(fk)
            eff = all_eff.get(dc_name) or {}
            if 'alter_mind_obiwan' not in (eff.get('specialAbilityIds') or []):
                continue
            excluded.setdefault(pn, set())
            for t_fk, t_pos in ((data.get('figurePositions') or {}).get(pn) or {}).items():
                if not t_pos:
                    continue
                t_dc_name = dc_name_from_figure_key(t_fk)
                t_eff = all_eff.get(t_dc_name) or {}
                if (t_eff.get('cost') or 99) > 9:
                    continue
                if count_game_spaces(game, pos, t_pos) > 3:
                    continue
                size = get_effective_figure_size(game, t_fk, t_dc_name)
                for c in get_footprint_cells(t_pos, size):
                    excluded[pn].add(normalize_coord(c))
    return excluded


def _get_powerful_influence_excluded_cells(game: Any) -> Dict[int, Set[str]]:
    """{pn: set(cells)} — cells excluded due to A Powerful Influence CC.

    REBEL FORCE USER figures within 3 spaces block opposing control.
    """
    data = _data(game)
    excluded: Dict[int, Set[str]] = {}
    api_pn = data.get('powerfulInfluencePlayerNum')
    if not api_pn:
        return excluded
    all_eff = get_dc_effects() or {}
    opp_pn = 3 - api_pn
    for fk, pos in ((data.get('figurePositions') or {}).get(api_pn) or {}).items():
        if not pos:
            continue
        dc_name = dc_name_from_figure_key(fk)
        eff = all_eff.get(dc_name) or {}
        kw = [str(k).upper() for k in (eff.get('keywords') or [])]
        if 'FORCE USER' not in kw:
            continue
        excluded.setdefault(opp_pn, set())
        for t_fk, t_pos in ((data.get('figurePositions') or {}).get(opp_pn) or {}).items():
            if not t_pos:
                continue
            if count_game_spaces(game, pos, t_pos) > 3:
                continue
            t_dc_name = dc_name_from_figure_key(t_fk)
            size = get_effective_figure_size(game, t_fk, t_dc_name)
            for c in get_footprint_cells(t_pos, size):
                excluded[opp_pn].add(normalize_coord(c))
    return excluded


# ---------------------------------------------------------------------------
# Space / terminal / figures controller queries

def get_space_controller(game: Any, map_id: Optional[str],
                         coord: str) -> Optional[int]:
    """Returns 1, 2, or None for exclusive controller of a space."""
    map_spaces = get_map_spaces(map_id) if map_id else None
    if not map_spaces or not map_spaces.get('adjacency'):
        return None
    adjacency = map_spaces.get('adjacency') or {}
    t = normalize_coord(coord)
    graph_neighbors = [normalize_coord(n) for n in (adjacency.get(t) or [])]
    neighbors = graph_neighbors if graph_neighbors else _geometric_neighbors(t)
    control_set = {t, *neighbors}
    alter_mind_excluded = _get_alter_mind_excluded_cells(game)
    api_excluded = _get_powerful_influence_excluded_cells(game)
    p1_cells = get_player_occupied_cells_for_control(game, 1)
    p2_cells = get_player_occupied_cells_for_control(game, 2)
    p1_has = any(
        c in p1_cells
        and c not in alter_mind_excluded.get(1, set())
        and c not in api_excluded.get(1, set())
        for c in control_set
    )
    p2_has = any(
        c in p2_cells
        and c not in alter_mind_excluded.get(2, set())
        and c not in api_excluded.get(2, set())
        for c in control_set
    )
    if p1_has and not p2_has:
        return 1
    if p2_has and not p1_has:
        return 2
    return None


def get_figures_on_or_adjacent_to_space(game: Any, player_num: int,
                                         coord: str,
                                         map_id: Optional[str]) -> List[str]:
    """Return figure keys for player_num whose position is on or adjacent to coord."""
    data = _data(game)
    map_spaces = get_map_spaces(map_id) if map_id else None
    if not map_spaces or not map_spaces.get('adjacency'):
        return []
    adjacency = map_spaces.get('adjacency') or {}
    t = normalize_coord(coord)
    graph_neighbors = [normalize_coord(n) for n in (adjacency.get(t) or [])]
    neighbors = graph_neighbors if graph_neighbors else _geometric_neighbors(t)
    control_set = {t, *neighbors}
    poses = (data.get('figurePositions') or {}).get(player_num) or {}
    return [fk for fk, fc in poses.items() if fc and normalize_coord(fc) in control_set]


def count_terminals_controlled_by_player(game: Any, player_num: int,
                                         map_id: Optional[str]) -> int:
    """Count terminals exclusively controlled by player_num."""
    map_data = (get_map_tokens_data() or {}).get(map_id) or {}
    terminals = map_data.get('terminals') or []
    if not terminals:
        return 0
    map_spaces = get_map_spaces(map_id) if map_id else None
    if not map_spaces or not map_spaces.get('adjacency'):
        return 0
    adjacency = map_spaces.get('adjacency') or {}
    alter_mind_excluded = _get_alter_mind_excluded_cells(game)
    api_excluded = _get_powerful_influence_excluded_cells(game)
    p1_cells = get_player_occupied_cells_for_control(game, 1)
    p2_cells = get_player_occupied_cells_for_control(game, 2)
    count = 0
    for term in terminals:
        t = normalize_coord(term)
        control_set = {t, *[normalize_coord(n) for n in (adjacency.get(t) or [])]}
        p1_has = any(c in p1_cells
                     and c not in alter_mind_excluded.get(1, set())
                     and c not in api_excluded.get(1, set())
                     for c in control_set)
        p2_has = any(c in p2_cells
                     and c not in alter_mind_excluded.get(2, set())
                     and c not in api_excluded.get(2, set())
                     for c in control_set)
        if player_num == 1 and p1_has and not p2_has:
            count += 1
        if player_num == 2 and p2_has and not p1_has:
            count += 1
    return count


# ---------------------------------------------------------------------------
# Door grouping + legal interact options

def _group_door_edges(doors: List[List[str]]) -> List[List[List[str]]]:
    """Group adjacent parallel door edges into logical door groups.

    Same-wall + adjacent-position edges collapse into one group (multi-cell door).
    """
    if not doors:
        return []
    parsed = []
    for edge in doors:
        a_col, a_row = parse_coord(edge[0])
        b_col, b_row = parse_coord(edge[1])
        same_col = a_col == b_col
        wall_key = f'h_{min(a_row, b_row)}' if same_col else f'v_{min(a_col, b_col)}'
        perp_pos = a_col if same_col else a_row
        parsed.append({'edge': edge, 'wallKey': wall_key, 'perpPos': perp_pos})

    used: Set[int] = set()
    groups: List[List[List[str]]] = []
    for i in range(len(parsed)):
        if i in used:
            continue
        used.add(i)
        group = [parsed[i]]
        changed = True
        while changed:
            changed = False
            for j in range(len(parsed)):
                if j in used:
                    continue
                if parsed[j]['wallKey'] != parsed[i]['wallKey']:
                    continue
                if any(abs(g['perpPos'] - parsed[j]['perpPos']) == 1 for g in group):
                    group.append(parsed[j])
                    used.add(j)
                    changed = True
        groups.append([g['edge'] for g in group])
    return groups


def get_legal_interact_options(game: Any, player_num: int, figure_key: str,
                               map_id: Optional[str]) -> List[Dict[str, Any]]:
    """Legal interact options for a figure. Mission-specific first, then standard.

    Mirrors src/game/board-helpers.js:getLegalInteractOptions. Respects Alter
    Mind and A Powerful Influence cross-3-spaces blocks.
    """
    data = _data(game)
    options: List[Dict[str, Any]] = []
    map_data = (get_map_tokens_data() or {}).get(map_id)
    if not map_data:
        return options

    opp_num = 2 if player_num == 1 else 1
    opp_positions = (data.get('figurePositions') or {}).get(opp_num) or {}
    fig_pos = ((data.get('figurePositions') or {}).get(player_num) or {}).get(figure_key)

    if fig_pos:
        dc_name = dc_name_from_figure_key(figure_key)
        fig_dc_eff = (get_dc_effects() or {}).get(dc_name) or {}
        fig_cost = fig_dc_eff.get('cost')
        if fig_cost is None:
            fig_cost = 99
        if fig_cost <= 9:
            for opp_fk, opp_coord in opp_positions.items():
                opp_dc_name = dc_name_from_figure_key(opp_fk)
                opp_eff = (get_dc_effects() or {}).get(opp_dc_name) or {}
                if 'alter_mind_obiwan' in (opp_eff.get('specialAbilityIds') or []):
                    if count_game_spaces(game, fig_pos, opp_coord) <= 3:
                        return options

    # A Powerful Influence CC block
    if data.get('powerfulInfluencePlayerNum') and fig_pos:
        api_pn = data['powerfulInfluencePlayerNum']
        if player_num != api_pn:
            api_positions = (data.get('figurePositions') or {}).get(api_pn) or {}
            all_eff = get_dc_effects() or {}
            for api_fk, api_coord in api_positions.items():
                if not api_coord:
                    continue
                api_dc_name = dc_name_from_figure_key(api_fk)
                api_eff = all_eff.get(api_dc_name) or {}
                api_kw = [str(k).upper() for k in (api_eff.get('keywords') or [])]
                if 'FORCE USER' not in api_kw:
                    continue
                if count_game_spaces(game, fig_pos, api_coord) <= 3:
                    return options

    selected = data.get('selectedMission') or {}
    variant = selected.get('variant') if isinstance(selected, dict) else None
    interact_label = selected.get('interactLabel') if isinstance(selected, dict) else None
    mech = selected.get('mechanics') if isinstance(selected, dict) else None
    mech = mech or {}

    # Carry mission: retrieve_contraband
    if interact_label and mech.get('type') == 'carry':
        mission_side = 'missionA' if variant == 'a' else 'missionB'
        already_carrying = bool((data.get('figureContraband') or {}).get(figure_key))
        if not already_carrying:
            eligible = is_figure_adjacent_or_on_mission_token(
                game, player_num, figure_key, map_id, mission_side,
            )
            if not eligible:
                dropped = data.get('droppedContrabandSpaces') or []
                if dropped:
                    dropped_set = to_lower_set(dropped)
                    eligible = len(get_figure_adjacent_coords_from_set(
                        game, player_num, figure_key, map_id, dropped_set,
                    )) > 0
            if eligible:
                options.append({
                    'id': 'retrieve_contraband',
                    'label': interact_label,
                    'missionSpecific': True,
                })

    # Flip mission: launch panel variants
    if interact_label and mech.get('type') == 'flip':
        mission_side = 'missionA' if variant == 'a' else 'missionB'
        token_coords = get_mission_token_coords(map_data.get(mission_side))
        flipped_this_round = (
            data.get('p1LaunchPanelFlippedThisRound') if player_num == 1
            else data.get('p2LaunchPanelFlippedThisRound')
        )
        if token_coords and not (mech.get('flipLimitPerRound') and flipped_this_round):
            panel_set = to_lower_set(token_coords)
            adjacent = get_figure_adjacent_coords_from_set(
                game, player_num, figure_key, map_id, panel_set,
            )
            for coord in adjacent:
                upper = str(coord).upper()
                options.append({
                    'id': f'launch_panel_{coord}_colored',
                    'label': f'{interact_label} ({upper}) → Colored',
                    'missionSpecific': True,
                })
                options.append({
                    'id': f'launch_panel_{coord}_gray',
                    'label': f'{interact_label} ({upper}) → Gray',
                    'missionSpecific': True,
                })

    # Terminals (standard)
    terminals = map_data.get('terminals') or []
    if terminals and is_figure_adjacent_or_on_any(
            game, player_num, figure_key, map_id, to_lower_set(terminals)):
        options.append({'id': 'use_terminal', 'label': 'Use Terminal', 'missionSpecific': False})

    # Doors
    opened_set = {str(k).lower() for k in (data.get('openedDoors') or [])}
    door_groups = _group_door_edges(map_data.get('doors') or [])
    if fig_pos:
        dc_name_for_door = dc_name_from_figure_key(figure_key)
        door_footprint = get_footprint_cells(
            fig_pos, get_effective_figure_size(game, figure_key, dc_name_for_door),
        )
        for group in door_groups:
            all_opened = all(edge_key(e[0], e[1]) in opened_set for e in group)
            if all_opened:
                continue
            all_coords: Set[str] = set()
            for e in group:
                all_coords.add(normalize_coord(e[0]))
                all_coords.add(normalize_coord(e[1]))
            # Door adjacency = edge-sharing only (no diagonals); door's own cells
            # ARE those spaces.
            if any(normalize_coord(c) in all_coords for c in door_footprint):
                edge_keys = [edge_key(e[0], e[1]) for e in group]
                label = (
                    f'Open Door ({str(group[0][0]).upper()}–{str(group[0][1]).upper()})'
                )
                options.append({
                    'id': f'open_door_{",".join(edge_keys)}',
                    'label': label,
                    'missionSpecific': False,
                })

    return options
