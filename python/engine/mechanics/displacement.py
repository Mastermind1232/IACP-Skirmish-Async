"""Massive displacement engine + figure push primitives (D2.12 + D2.13).

Port of the displacement half of `src/game/movement.js`:
  - collectOverlappingFigures         → collect_overlapping_figures
  - pushFigureToNearestValid          → push_figure_to_nearest_valid
  - initMassiveDisplacement           → init_massive_displacement
  - resolveNextDisplacements          → resolve_next_displacements
  - applyFigurePick                   → apply_figure_pick
  - applyDisplacementChoice           → apply_displacement_choice
  - getValidDisplacementSpaces        → get_valid_displacement_spaces
  - (synchronous) resolveMassivePush  → resolve_massive_push

Slice boundary: figure-size lookup (`figure_size_fn`) is injected so this module
stays decoupled from the D4 DC data-loader. Tests either pass sizes from
`figure_orientations` explicitly or provide a minimal size-lookup callable.

`push_figure` in JS mutates `game.figurePositions[pn][figureKey]` and normalizes
the coord. The Python version does the same. Per JS semantics: if the figure is
absent from `figurePositions`, it returns `None` and no-ops.
"""
from typing import Any, Callable, Dict, Iterable, List, Optional, Set

from python.engine.mechanics.coords import (
    edge_key,
    get_footprint_cells,
    normalize_coord,
    shift_coord,
)
from python.engine.mechanics.movement_board import (
    MovementProfile,
    get_normalized_footprint,
    movement_state_key,
)


SizeLookup = Callable[[str, str], str]  # (dc_name, figure_key) -> size string


def _default_size_lookup(dc_name: str, figure_key: str) -> str:
    """Fallback: everybody is 1x1. Tests needing large figures override this
    per-call or rely on figure_orientations entries."""
    return '1x1'


def _dc_name_from_figure_key(figure_key: str) -> str:
    """Mirror JS dcNameFromFigureKey: the part before the last two hyphen-separated segments."""
    parts = figure_key.split('-')
    if len(parts) >= 3:
        return '-'.join(parts[:-2])
    return figure_key


def _figure_size(game: Dict[str, Any], figure_key: str, size_lookup: SizeLookup) -> str:
    """Resolve size from figure_orientations then fall back to size_lookup."""
    orient = (game.get('figureOrientations') or {}).get(figure_key)
    if orient:
        return orient
    dc_name = _dc_name_from_figure_key(figure_key)
    return size_lookup(dc_name, figure_key) or '1x1'


def push_figure(game: Dict[str, Any], player_num: int, figure_key: str, new_coord: str) -> Optional[Dict[str, str]]:
    """Port of JS player-helpers.pushFigure. Normalizes coord to lowercase.
    No-ops (returns None) when figure has no prior position in game."""
    poses = game.setdefault('figurePositions', {1: {}, 2: {}})
    bucket = poses.get(player_num)
    if bucket is None:
        poses[player_num] = {}
        bucket = poses[player_num]
    prev = bucket.get(figure_key)
    if prev is None:
        return None
    norm = normalize_coord(new_coord)
    bucket[figure_key] = norm
    return {'prevPos': prev, 'newPos': norm}


def compute_push_path_and_warnings(
    game: Dict[str, Any],
    from_pos: Optional[str],
    to_pos: str,
    pushed_figure_player_num: int,
    map_adjacency: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, Any]:
    """Port of JS src/game/abilities.js:68-136 computePushPathAndWarnings.

    BFS-shortest-path walker that produces two things:
      - `path_str` — " via **X** → **Y**" for intermediate cells when path > 2 long
      - `warnings` — [{name, space}] for each hostile figure the pushed figure
        *exits adjacency to* at some step along the path. Mirrors the Parting-
        Blow interrupt trigger condition (adjacent-before, not-adjacent-after).

    JS signature reads map via `getMapData(game.selectedMap.id)`; the Python
    version accepts `map_adjacency` directly so callers building tests don't
    need a full mission/map-data wiring. Passing `None` makes the function
    resolve the map from `game.selectedMap.id` via `load_map_spaces` (production
    path). Missing map data → `{path_str: '', warnings: []}`.

    Return shape matches JS camelCase for the two keys (pathStr, warnings) via
    snake_case Python keys (path_str, warnings). Callers format the final log
    string themselves.
    """
    result: Dict[str, Any] = {'path_str': '', 'warnings': []}

    adjacency: Dict[str, List[str]]
    if map_adjacency is not None:
        adjacency = map_adjacency
    else:
        selected_map = (game or {}).get('selectedMap') or {}
        map_id = selected_map.get('id')
        if not map_id:
            return result
        try:
            from python.engine.board_data import load_map_spaces
            ms = load_map_spaces(map_id)
        except Exception:
            return result
        adjacency = ms.get('adjacency') or {}

    if not from_pos or not adjacency:
        return result
    start_norm = normalize_coord(from_pos)
    dest_norm = normalize_coord(to_pos)
    if not start_norm or not dest_norm or start_norm == dest_norm:
        return result

    # BFS: ignore occupied spaces — pushed figures pass through.
    visited: Dict[str, Optional[str]] = {start_norm: None}
    queue: List[str] = [start_norm]
    found = False
    while queue and not found:
        cur = queue.pop(0)
        for neighbor_raw in adjacency.get(cur, []) or []:
            neighbor = normalize_coord(neighbor_raw)
            if neighbor in visited:
                continue
            visited[neighbor] = cur
            if neighbor == dest_norm:
                found = True
                break
            queue.append(neighbor)

    # Reconstruct path.
    path: List[str] = []
    if found:
        node: Optional[str] = dest_norm
        safety = 0
        while node is not None:
            safety += 1
            if safety > 10000:
                break
            path.insert(0, node)
            node = visited.get(node)

    if len(path) > 2:
        intermediates = path[1:-1]
        result['path_str'] = ' via ' + ' \u2192 '.join(f'**{c.upper()}**' for c in intermediates)

    # Exits-adjacency check: emit warnings for each hostile figure that was
    # adjacent at exitingSpace but not adjacent at enteringSpace.
    if len(path) >= 2:
        hostile_pn = 2 if pushed_figure_player_num == 1 else 1
        hostile_positions = (game.get('figurePositions') or {}).get(hostile_pn) or {}
        seen_keys: set = set()
        for i in range(len(path) - 1):
            exiting_space = path[i]
            entering_space = path[i + 1]
            exit_adj = {normalize_coord(n) for n in (adjacency.get(exiting_space, []) or [])}
            enter_adj = {normalize_coord(n) for n in (adjacency.get(entering_space, []) or [])}
            for hfk, h_pos in hostile_positions.items():
                if not h_pos:
                    continue
                h_pos_norm = normalize_coord(h_pos)
                h_dc_name = _dc_name_from_figure_key(hfk)
                h_size = (game.get('figureOrientations') or {}).get(hfk) or '1x1'
                h_cells = [normalize_coord(c) for c in get_footprint_cells(h_pos_norm, h_size)]
                is_adjacent_before = any(c in exit_adj for c in h_cells)
                if not is_adjacent_before:
                    continue
                is_adjacent_after = any(
                    (c in enter_adj) or (c == entering_space) for c in h_cells
                )
                if is_adjacent_after:
                    continue
                warn_key = f'{hfk}@{exiting_space}'
                if warn_key in seen_keys:
                    continue
                seen_keys.add(warn_key)
                warn_name = h_dc_name.replace('_', ' ')
                result['warnings'].append({'name': warn_name, 'space': exiting_space.upper()})

    return result


def collect_overlapping_figures(
    game: Dict[str, Any],
    moving_player_num: int,
    moving_figure_key: str,
    footprint: Iterable[str],
    size_lookup: SizeLookup = _default_size_lookup,
) -> List[Dict[str, Any]]:
    """Port of JS collectOverlappingFigures. Friendly-first ordering preserved."""
    footprint_set = {normalize_coord(c) for c in footprint}
    overlaps_friendly: List[Dict[str, Any]] = []
    overlaps_enemy: List[Dict[str, Any]] = []
    poses = game.get('figurePositions') or {1: {}, 2: {}}
    for p in (1, 2):
        bucket = poses.get(p) or {}
        for figure_key, coord in bucket.items():
            if figure_key == moving_figure_key:
                continue
            size = _figure_size(game, figure_key, size_lookup)
            cells = get_normalized_footprint(coord, size)
            if not any(cell in footprint_set for cell in cells):
                continue
            entry = {
                'playerNum': p,
                'figureKey': figure_key,
                'dcName': _dc_name_from_figure_key(figure_key),
            }
            if p == moving_player_num:
                overlaps_friendly.append(entry)
            else:
                overlaps_enemy.append(entry)
    return overlaps_friendly + overlaps_enemy


def get_valid_displacement_spaces(
    game: Dict[str, Any],
    figure_key: str,
    player_num: int,
    forbidden_set: Iterable[str],
    map_adjacency: Dict[str, List[str]],
    size_lookup: SizeLookup = _default_size_lookup,
) -> List[str]:
    """Port of JS getValidDisplacementSpaces.

    `map_adjacency` is injected (the JS version reads it from the map loader).
    Returns adjacent spaces that are neither forbidden nor occupied by another
    figure (excluding the displaced figure itself).
    """
    poses = game.get('figurePositions') or {}
    bucket = poses.get(player_num) or {}
    coord = bucket.get(figure_key)
    if not coord:
        return []
    forbidden = {normalize_coord(c) for c in forbidden_set}
    adjacent = (map_adjacency or {}).get(normalize_coord(coord)) or []
    occupied_set: Set[str] = set()
    for p in (1, 2):
        pb = poses.get(p) or {}
        for k, c in pb.items():
            if not c:
                continue
            if p == player_num and k == figure_key:
                continue
            size = _figure_size(game, k, size_lookup)
            for cell in get_normalized_footprint(c, size):
                occupied_set.add(cell)
    return [
        normalize_coord(s)
        for s in adjacent
        if normalize_coord(s) not in occupied_set and normalize_coord(s) not in forbidden
    ]


def push_figure_to_nearest_valid(
    game: Dict[str, Any],
    player_num: int,
    figure_key: str,
    forbidden_set: Iterable[str],
    board: Dict[str, Any],
    profile: MovementProfile,
) -> bool:
    """Port of JS pushFigureToNearestValid.

    Caller supplies `board` (built via build_temp_board_state) and `profile`
    so this module stays independent of the DC data-loader.
    """
    poses = game.get('figurePositions') or {}
    coord = (poses.get(player_num) or {}).get(figure_key)
    if not coord:
        return False
    forbidden = {normalize_coord(c) for c in forbidden_set}
    start_top_left = normalize_coord(coord)
    queue: List[str] = [start_top_left]
    visited: Set[str] = {movement_state_key(start_top_left, profile.size)}
    occupied_set = board.get('occupiedSet') or set()
    blocking_set = board.get('blockingSet') or set()
    mb = board.get('movementBlockingSet') or set()
    spaces_set = board.get('spacesSet') or set()
    while queue:
        top_left = queue.pop(0)
        footprint = get_normalized_footprint(top_left, profile.size)
        overlap_forbidden = any(cell in forbidden for cell in footprint)
        overlap_other = any(cell in occupied_set for cell in footprint)
        blocked = (not profile.ignore_blocking) and any(cell in blocking_set for cell in footprint)
        if not overlap_forbidden and not overlap_other and not blocked:
            push_figure(game, player_num, figure_key, top_left)
            return True
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            next_top_left = shift_coord(top_left, dx, dy)
            if not next_top_left or next_top_left not in spaces_set:
                continue
            if edge_key(top_left, next_top_left) in mb:
                continue
            state_key = movement_state_key(next_top_left, profile.size)
            if state_key in visited:
                continue
            visited.add(state_key)
            queue.append(next_top_left)
    return False


# ── Massive displacement engine ─────────────────────────────────────────────

def init_massive_displacement(
    game: Dict[str, Any],
    moving_player_num: int,
    moving_figure_key: str,
    footprint_set: Iterable[str],
    size_lookup: SizeLookup = _default_size_lookup,
) -> Optional[Dict[str, Any]]:
    """Port of JS initMassiveDisplacement.

    Returns pending state object, or None if no overlaps were detected.
    """
    footprint = [normalize_coord(c) for c in footprint_set]
    overlaps = collect_overlapping_figures(
        game, moving_player_num, moving_figure_key, footprint, size_lookup,
    )
    if not overlaps:
        return None
    friendly = [e for e in overlaps if e['playerNum'] == moving_player_num]
    enemy = [e for e in overlaps if e['playerNum'] != moving_player_num]
    return {
        'movingPlayerNum': moving_player_num,
        'movingFigureKey': moving_figure_key,
        'footprint': list(footprint),
        'friendlyQueue': friendly,
        'enemyQueue': enemy,
        'phase': 'friendly' if friendly else 'enemy',
        'currentIndex': 0,
        'totalDisplaced': len(overlaps),
        '_figurePickLockedIdx': -1,
    }


def _active_queue(pending: Dict[str, Any]) -> List[Dict[str, Any]]:
    return pending['friendlyQueue'] if pending['phase'] == 'friendly' else pending['enemyQueue']


def resolve_next_displacements(
    game: Dict[str, Any],
    pending: Dict[str, Any],
    map_adjacency: Dict[str, List[str]],
    board: Dict[str, Any],
    profile_for: Callable[[str, int], MovementProfile],
    size_lookup: SizeLookup = _default_size_lookup,
) -> Dict[str, Any]:
    """Port of JS resolveNextDisplacements.

    `profile_for(figure_key, player_num)` must return a MovementProfile suitable
    for that figure — only used for BFS fallback. For 1x1 figures the caller
    can return `profile_from_size('1x1')`.
    """
    forbidden_set = {normalize_coord(c) for c in pending['footprint']}
    auto_resolved: List[Dict[str, Any]] = []
    while True:
        queue = _active_queue(pending)
        if pending['currentIndex'] >= len(queue):
            if pending['phase'] == 'friendly' and pending['enemyQueue']:
                pending['phase'] = 'enemy'
                pending['currentIndex'] = 0
                pending['_figurePickLockedIdx'] = -1
                continue
            return {
                'autoResolved': auto_resolved,
                'needsFigurePick': None,
                'needsChoice': None,
                'done': True,
            }
        entry = queue[pending['currentIndex']]
        valid_spaces = get_valid_displacement_spaces(
            game, entry['figureKey'], entry['playerNum'], forbidden_set, map_adjacency, size_lookup,
        )
        if not valid_spaces:
            prev_pos = (game.get('figurePositions') or {}).get(entry['playerNum'], {}).get(entry['figureKey'])
            profile = profile_for(entry['figureKey'], entry['playerNum'])
            push_figure_to_nearest_valid(
                game, entry['playerNum'], entry['figureKey'], forbidden_set, board, profile,
            )
            new_pos = (game.get('figurePositions') or {}).get(entry['playerNum'], {}).get(entry['figureKey'])
            auto_resolved.append({'entry': entry, 'prevPos': prev_pos, 'newPos': new_pos, 'bfs': True})
            pending['currentIndex'] += 1
            continue
        if len(valid_spaces) == 1:
            prev_pos = (game.get('figurePositions') or {}).get(entry['playerNum'], {}).get(entry['figureKey'])
            push_figure(game, entry['playerNum'], entry['figureKey'], valid_spaces[0])
            auto_resolved.append({'entry': entry, 'prevPos': prev_pos, 'newPos': valid_spaces[0], 'bfs': False})
            pending['currentIndex'] += 1
            continue
        controller_player_num = (
            pending['movingPlayerNum'] if pending['phase'] == 'friendly' else entry['playerNum']
        )
        unresolved_count = len(queue) - pending['currentIndex']
        order_locked = pending.get('_figurePickLockedIdx') == pending['currentIndex']
        if unresolved_count >= 2 and not order_locked:
            pickable = queue[pending['currentIndex']:]
            return {
                'autoResolved': auto_resolved,
                'needsFigurePick': {'pickable': pickable, 'controllerPlayerNum': controller_player_num},
                'needsChoice': None,
                'done': False,
            }
        return {
            'autoResolved': auto_resolved,
            'needsFigurePick': None,
            'needsChoice': {'entry': entry, 'validSpaces': valid_spaces, 'controllerPlayerNum': controller_player_num},
            'done': False,
        }


def apply_figure_pick(pending: Dict[str, Any], figure_key: str) -> bool:
    """Port of JS applyFigurePick. Swaps the chosen entry into currentIndex slot."""
    queue = _active_queue(pending)
    target_idx = -1
    for i in range(pending['currentIndex'], len(queue)):
        if queue[i]['figureKey'] == figure_key:
            target_idx = i
            break
    if target_idx < 0:
        return False
    if target_idx != pending['currentIndex']:
        queue[pending['currentIndex']], queue[target_idx] = queue[target_idx], queue[pending['currentIndex']]
    pending['_figurePickLockedIdx'] = pending['currentIndex']
    return True


def apply_displacement_choice(game: Dict[str, Any], pending: Dict[str, Any], chosen_space: str) -> Optional[Dict[str, Any]]:
    """Port of JS applyDisplacementChoice. Commits the pick + advances index."""
    queue = _active_queue(pending)
    if pending['currentIndex'] >= len(queue):
        return None
    entry = queue[pending['currentIndex']]
    prev_pos = (game.get('figurePositions') or {}).get(entry['playerNum'], {}).get(entry['figureKey'])
    push_figure(game, entry['playerNum'], entry['figureKey'], chosen_space)
    pending['currentIndex'] += 1
    pending['_figurePickLockedIdx'] = -1
    return {'entry': entry, 'prevPos': prev_pos, 'newPos': normalize_coord(chosen_space)}


def resolve_massive_push(
    game: Dict[str, Any],
    profile: MovementProfile,
    figure_key: str,
    player_num: int,
    new_footprint: Iterable[str],
    map_adjacency: Dict[str, List[str]],
    board: Dict[str, Any],
    profile_for: Callable[[str, int], MovementProfile],
    size_lookup: SizeLookup = _default_size_lookup,
    log_action: Optional[Callable[[str], None]] = None,
) -> None:
    """Port of JS resolveMassivePush (synchronous).

    The JS version is async only because it awaits logGameAction; parity callers
    don't need that, so the Python version accepts a sync log callable.
    """
    if not profile.can_end_on_occupied:
        return
    footprint_set = {normalize_coord(c) for c in new_footprint}
    pending = init_massive_displacement(game, player_num, figure_key, footprint_set, size_lookup)
    if pending is None:
        return
    safety = 0
    while True:
        safety += 1
        if safety > 1000:
            raise RuntimeError('resolve_massive_push: engine loop did not terminate')
        result = resolve_next_displacements(game, pending, map_adjacency, board, profile_for, size_lookup)
        for r in result['autoResolved']:
            if log_action:
                suffix = ' (no adjacent spaces)' if r['bfs'] else ''
                frm = (r.get('prevPos') or '?').upper()
                to = (r.get('newPos') or '?').upper()
                log_action(f"{r['entry']['dcName']} displaced {frm} -> {to} by massive figure{suffix}.")
        if result['done']:
            break
        if result['needsFigurePick']:
            apply_figure_pick(pending, result['needsFigurePick']['pickable'][0]['figureKey'])
            continue
        choice = result['needsChoice']
        applied = apply_displacement_choice(game, pending, choice['validSpaces'][0])
        if applied and log_action:
            frm = (applied.get('prevPos') or '?').upper()
            to = normalize_coord(choice['validSpaces'][0]).upper()
            log_action(f"{choice['entry']['dcName']} displaced {frm} -> {to} by massive figure.")
    locked = game.setdefault('massiveMovementLocked', {})
    locked[figure_key] = True
    if log_action:
        log_action(f"Massive figure pushed {pending['totalDisplaced']} figure(s) aside. Movement locked for this phase.")
