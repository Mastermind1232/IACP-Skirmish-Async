"""Mission rules engine — Python mirror of src/game/mission-rules.js.

Data-driven end-of-round + start-of-round effects keyed by
mission-cards.json 'rules' blocks. Each effect type has a dedicated
branch. Parameters (VP amounts, message templates, state keys) come from
the data.

Key differences from JS:
- Sync. The JS signatures are async because logGameAction /
  checkWinConditions are Discord IO. In Python we pass those in via ctx
  and they're optional — no await. If not provided, they're treated as
  no-ops. The Python rules engine itself is pure state mutation.
- All map_tokens / map_spaces lookups default to our loaders when the
  ctx doesn't inject them.

Ports:
  get_current_fluctuation_positions — lazy-init fluctuationPositions
  run_end_of_round_rules — 9 effect branches
  run_start_of_round_rules — 3 effect branches
  run_npc_krykna_activation — Chopper Base A lifecycle
  get_valid_krykna_placement_spaces
  run_npc_thug_activation — Mos Eisley / Thug BFS lifecycle

M3-K zone_control folds into run_end_of_round_rules via the
vpPerControlledDeploymentZone branch and vpPerControlledSpaceInList.
"""
from __future__ import annotations

import random
import re
from typing import Any, Callable, Dict, List, Optional, Set

from python.engine.data.deployment_zones_loader import get_deployment_zones
from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.data.map_tokens_loader import get_map_tokens_data
from python.engine.mechanics.board_helpers import (
    count_game_spaces,
    get_player_occupied_cells_for_control,
    get_space_controller,
    get_figures_on_or_adjacent_to_space,
)
from python.engine.mechanics.coords import normalize_coord
from python.engine.mechanics.dc_helpers import dc_name_from_figure_key
from python.engine.mechanics.player_helpers import (
    get_initiative_player_num,
    get_player_id,
)
from python.engine.mechanics.tokens import grant_power_tokens
from python.engine.mechanics.vp_helpers import award_objective_vp


NEUTRAL_COLOR_RE = re.compile(r'Neutral (\w+)\.', re.IGNORECASE)
COLOR_PREFIX_RE = re.compile(r'(Blue|Red|Yellow)', re.IGNORECASE)

_COLOR_TO_POWER_TOKEN_FULL = {
    'yellow': 'Surge', 'blue': 'Evade', 'green': 'Block', 'red': 'Damage',
}
_COLOR_TO_POWER_TOKEN_CRATE = {
    'blue': 'Block', 'red': 'Damage', 'yellow': 'Surge',
}


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'mission_rules expected GameState or dict, got {type(game).__name__}'
    )


def _log(ctx: Optional[Dict[str, Any]], message: str, *, phase: str = 'ROUND',
         icon: str = 'round') -> None:
    """Optional logging hook. Sync — no await."""
    if not ctx:
        return
    log_fn = ctx.get('logGameAction')
    if callable(log_fn):
        log_fn(message, {'phase': phase, 'icon': icon})


def _check_win(game: Any, ctx: Optional[Dict[str, Any]]) -> None:
    if not ctx:
        return
    fn = ctx.get('checkWinConditions')
    if callable(fn):
        fn(game)


def _map_tokens(ctx: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if ctx and callable(ctx.get('getMapTokensData')):
        return ctx['getMapTokensData']() or {}
    return get_map_tokens_data() or {}


# ---------------------------------------------------------------------------
# Fluctuation positions

def get_current_fluctuation_positions(game: Any, map_id: Optional[str],
                                      get_map_tokens_fn: Optional[Callable[[], Dict[str, Any]]] = None,
                                      ) -> Dict[str, List[str]]:
    """Canonical accessor for fluctuation positions. Lazy deep-copy from static JSON."""
    data = _data(game)
    if data.get('fluctuationPositions') is not None:
        return data['fluctuationPositions']
    all_tokens = (get_map_tokens_fn() if callable(get_map_tokens_fn)
                  else get_map_tokens_data()) or {}
    mission_data = (all_tokens.get(map_id) or {}).get('missionB') or {}
    positions = mission_data.get('positions') or {}
    result: Dict[str, List[str]] = {}
    for k, coords in positions.items():
        result[str(k)] = [normalize_coord(c) for c in (coords or [])]
    data['fluctuationPositions'] = result
    return result


# ---------------------------------------------------------------------------
# Helpers

def _extract_token_coords(mission_token_data: Any) -> List[str]:
    if not mission_token_data:
        return []
    if isinstance(mission_token_data, dict) and isinstance(mission_token_data.get('positions'), dict):
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


def _get_named_area_controller(game: Any, map_id: Optional[str], area_name: str,
                                get_map_tokens_fn: Optional[Callable[[], Dict[str, Any]]] = None,
                                ) -> Optional[int]:
    """Count-based controller of a named area.

    Companions excluded: Salacious always, The Child when incapacitated, Dio
    while Iden Versio is alive.
    """
    data = _data(game)
    all_tokens = (get_map_tokens_fn() if callable(get_map_tokens_fn)
                  else get_map_tokens_data()) or {}
    map_data = all_tokens.get(map_id) or {}
    areas = map_data.get('namedAreas') or []
    # areas may be single dict or list of dicts
    if isinstance(areas, dict):
        areas = [areas]
    area = None
    for a in areas:
        if isinstance(a, dict) and str(a.get('name') or '').lower() == str(area_name or '').lower():
            area = a
            break
    if not area or not isinstance(area.get('cells'), list) or not area['cells']:
        return None
    cell_set = {normalize_coord(c) for c in area['cells']}

    excluded_names = {'salacious b. crumb'}
    if data.get('childIncapacitated'):
        excluded_names.add('the child')

    iden_alive: Dict[int, bool] = {}
    for pn in (1, 2):
        poses = (data.get('figurePositions') or {}).get(pn) or {}
        iden_alive[pn] = any(dc_name_from_figure_key(fk) == 'Iden Versio' for fk in poses)

    p1 = 0
    p2 = 0
    for pn in (1, 2):
        poses = (data.get('figurePositions') or {}).get(pn) or {}
        for fk, cell in poses.items():
            if not cell:
                continue
            if normalize_coord(cell) not in cell_set:
                continue
            dc_name = (dc_name_from_figure_key(fk or '') or '').lower()
            if dc_name in excluded_names:
                continue
            if dc_name == 'dio' and iden_alive.get(pn):
                continue
            if pn == 1:
                p1 += 1
            else:
                p2 += 1
    if p1 > p2:
        return 1
    if p2 > p1:
        return 2
    return None


# ---------------------------------------------------------------------------
# End-of-round rules

def run_end_of_round_rules(game: Any, map_id: Optional[str], variant: str,
                           rules: Optional[Dict[str, Any]],
                           ctx: Optional[Dict[str, Any]] = None,
                           ) -> Dict[str, bool]:
    """Run EOR rules for a mission variant. Returns {'gameEnded': bool}.

    Mirrors JS runEndOfRoundRules. Sync; Discord IO hooks are optional via ctx.
    """
    data = _data(game)
    if not rules or not isinstance(rules, dict):
        return {'gameEnded': False}
    ctx = ctx or {}

    def _ended() -> bool:
        return bool(data.get('ended'))

    # 1. vpForControllingNamedArea
    cfg = rules.get('vpForControllingNamedArea')
    if cfg and map_id:
        area_name = cfg.get('areaName')
        vp = cfg.get('vp')
        if area_name and isinstance(vp, (int, float)):
            controller = _get_named_area_controller(
                game, map_id, area_name, ctx.get('getMapTokensData'),
            )
            if controller:
                pid = get_player_id(game, controller)
                award_objective_vp(game, controller, int(vp))
                _log(ctx, f'<@{pid}> gained **{int(vp)} VP** for controlling **{area_name}**.')
                _check_win(game, ctx)
                if _ended():
                    return {'gameEnded': True}

    # 2. vpPerContrabandInDeploymentZone
    cfg = rules.get('vpPerContrabandInDeploymentZone')
    if cfg and data.get('figureContraband'):
        vp = cfg.get('vp')
        vp_msg_tpl = cfg.get('vpMessage')
        if isinstance(vp, (int, float)):
            vp_per = int(vp)
            is_in_zone_fn = ctx.get('isFigureInDeploymentZone')
            for pn in (1, 2):
                scored = 0
                fig_contraband = data.get('figureContraband') or {}
                for fig_key, carrying in list(fig_contraband.items()):
                    if not carrying:
                        continue
                    poses = (data.get('figurePositions') or {}).get(pn) or {}
                    if fig_key not in poses:
                        continue
                    if is_in_zone_fn and not is_in_zone_fn(game, pn, fig_key, map_id):
                        continue
                    vp_key = 'player1VP' if pn == 1 else 'player2VP'
                    vp_state = data.get(vp_key) or {'total': 0, 'kills': 0, 'objectives': 0}
                    vp_state['total'] = (vp_state.get('total') or 0) + vp_per
                    vp_state['objectives'] = (vp_state.get('objectives') or 0) + vp_per
                    data[vp_key] = vp_state
                    del data['figureContraband'][fig_key]
                    scored += 1
                if scored > 0:
                    pid = get_player_id(game, pn)
                    msg = (vp_msg_tpl.replace('{vp}', str(vp_per * scored))
                                      .replace('{count}', str(scored))
                           if vp_msg_tpl else f'{scored} figure(s) scoring {vp_per} VP each (mission objective)')
                    _log(ctx, f'<@{pid}> gained **{vp_per * scored} VP** — {msg}.')
                    _check_win(game, ctx)
                    if _ended():
                        return {'gameEnded': True}

    # 3. vpPerLaunchPanelControlled
    cfg = rules.get('vpPerLaunchPanelControlled')
    if cfg and map_id:
        green = cfg.get('green')
        gray = cfg.get('gray')
        vp_msg_tpl = cfg.get('vpMessage')
        if isinstance(green, (int, float)) and isinstance(gray, (int, float)):
            selected = data.get('selectedMission') or {}
            current_variant = selected.get('variant') or 'a'
            mission_side = 'missionA' if current_variant == 'a' else 'missionB'
            tokens = _map_tokens(ctx)
            launch_panels = _extract_token_coords((tokens.get(map_id) or {}).get(mission_side))
            state = data.get('launchPanelState') or {}
            p1_vp = 0
            p2_vp = 0
            for coord in launch_panels:
                c = str(coord).lower()
                side = state.get(c)
                if not side:
                    continue
                controller = get_space_controller(game, map_id, coord)
                if not controller:
                    continue
                vpv = int(green) if side == 'colored' else int(gray)
                if controller == 1:
                    p1_vp += vpv
                else:
                    p2_vp += vpv
            if p1_vp > 0:
                award_objective_vp(game, 1, p1_vp)
                msg = vp_msg_tpl.replace('{vp}', str(p1_vp)) if vp_msg_tpl else 'mission objective'
                _log(ctx, f"<@{data.get('player1Id')}> gained **{p1_vp} VP** — {msg}.")
                _check_win(game, ctx)
                if _ended():
                    return {'gameEnded': True}
            if p2_vp > 0:
                award_objective_vp(game, 2, p2_vp)
                msg = vp_msg_tpl.replace('{vp}', str(p2_vp)) if vp_msg_tpl else 'mission objective'
                _log(ctx, f"<@{data.get('player2Id')}> gained **{p2_vp} VP** — {msg}.")
                _check_win(game, ctx)
                if _ended():
                    return {'gameEnded': True}

    # 4. vpPerTokenForControllingCell
    cfg = rules.get('vpPerTokenForControllingCell')
    if cfg and map_id:
        control_cell = cfg.get('controlCell')
        vp_per_token = cfg.get('vpPerToken')
        token_count_key = cfg.get('tokenCountKey')
        vp_msg_tpl = cfg.get('vpMessage')
        if control_cell and token_count_key and isinstance(vp_per_token, (int, float)):
            controller = get_space_controller(game, map_id, control_cell)
            count_val = data.get(token_count_key)
            count = count_val if isinstance(count_val, (int, float)) else 0
            if controller and count > 0:
                vp_val = int(vp_per_token) * int(count)
                pid = get_player_id(game, controller)
                award_objective_vp(game, controller, vp_val)
                data[token_count_key] = 0
                plural = 's' if count != 1 else ''
                ctrl_msg = (vp_msg_tpl.replace('{vp}', str(vp_val)).replace('{count}', str(count))
                            if vp_msg_tpl else f'controlling the objective ({count} token{plural})')
                _log(ctx, f'<@{pid}> gained **{vp_val} VP** — {ctrl_msg}.')
                _check_win(game, ctx)
                if _ended():
                    return {'gameEnded': True}
            elif count > 0:
                data[token_count_key] = 0

    # 5. vpPerControlledSpaceInList (Lothal Wastes A Blitz)
    cfg = rules.get('vpPerControlledSpaceInList')
    if cfg and map_id:
        vp = cfg.get('vp')
        vp_msg_tpl = cfg.get('vpMessage')
        if isinstance(vp, (int, float)):
            mission_side = 'missionA' if variant == 'a' else 'missionB'
            tokens = _map_tokens(ctx)
            mission_data = (tokens.get(map_id) or {}).get(mission_side) or {}
            all_spaces: List[str] = []
            for v in (mission_data.get('positions') or {}).values():
                if isinstance(v, list):
                    all_spaces.extend([s for s in v if s])
            vp_by_player = {1: 0, 2: 0}
            for coord in all_spaces:
                controller = get_space_controller(game, map_id, coord)
                if controller:
                    vp_by_player[controller] += int(vp)
            for pn in (1, 2):
                if vp_by_player[pn] > 0:
                    vp_val = vp_by_player[pn]
                    count = vp_val // int(vp)
                    pid = get_player_id(game, pn)
                    award_objective_vp(game, pn, vp_val)
                    plural = 's' if count != 1 else ''
                    msg = (vp_msg_tpl.replace('{vp}', str(vp_val)).replace('{count}', str(count))
                           if vp_msg_tpl else f'mission objective ({count} position{plural} × {int(vp)} VP)')
                    _log(ctx, f'<@{pid}> gained **{vp_val} VP** — {msg}.')
                    _check_win(game, ctx)
                    if _ended():
                        return {'gameEnded': True}

    # 6. vpPerControlledFluctuation (Lothal Wastes B)
    cfg = rules.get('vpPerControlledFluctuation')
    if cfg and map_id:
        vp = cfg.get('vp')
        grant_pt = cfg.get('grantPowerToken')
        vp_msg_tpl = cfg.get('vpMessage')
        if isinstance(vp, (int, float)):
            tokens = _map_tokens(ctx)
            mission_data = (tokens.get(map_id) or {}).get('missionB') or {}
            token_types = mission_data.get('tokenTypes') or []
            positions = get_current_fluctuation_positions(game, map_id, ctx.get('getMapTokensData'))
            vp_by_player = {1: 0, 2: 0}
            for id_, coords in positions.items():
                if not coords:
                    continue
                try:
                    type_info = token_types[int(id_)] or {}
                except (ValueError, IndexError):
                    type_info = {}
                image = str(type_info.get('image') or '')
                m = NEUTRAL_COLOR_RE.search(image)
                color = m.group(1).lower() if m else None
                power_token = _COLOR_TO_POWER_TOKEN_FULL.get(color) if color else None
                for coord in coords:
                    controller = get_space_controller(game, map_id, coord)
                    if controller:
                        vp_by_player[controller] += int(vp)
                    if grant_pt and power_token:
                        for pn in (1, 2):
                            poses = (data.get('figurePositions') or {}).get(pn) or {}
                            for fig_key, fig_coord in poses.items():
                                if fig_coord and normalize_coord(fig_coord) == normalize_coord(coord):
                                    grant_power_tokens(data, fig_key, power_token, 1)
            for pn in (1, 2):
                if vp_by_player[pn] > 0:
                    vp_val = vp_by_player[pn]
                    count = vp_val // int(vp)
                    pid = get_player_id(game, pn)
                    award_objective_vp(game, pn, vp_val)
                    plural = 's' if count != 1 else ''
                    msg = (vp_msg_tpl.replace('{vp}', str(vp_val)).replace('{count}', str(count))
                           if vp_msg_tpl else f'mission objective ({count} fluctuation{plural} controlled)')
                    _log(ctx, f'<@{pid}> gained **{vp_val} VP** — {msg}.')
                    _check_win(game, ctx)
                    if _ended():
                        return {'gameEnded': True}
            if grant_pt:
                _log(ctx, '**Fluctuations:** Figures on fluctuation spaces received power tokens '
                          '(Yellow→Surge, Blue→Evade, Green→Block, Red→Hit). _(Reminder: each player '
                          'may now swap 1 fluctuation.)_')

    # 7. vpPerStrainOnControlledSpaces (Chopper Base B Powered Perimeter)
    cfg = rules.get('vpPerStrainOnControlledSpaces')
    if cfg and map_id:
        vp_per_strain = cfg.get('vpPerStrain', 2)
        strain_state_key = cfg.get('strainStateKey', 'signalMarkerStrain')
        vp_msg_tpl = cfg.get('vpMessage')
        strain_map = data.get(strain_state_key)
        if isinstance(strain_map, dict):
            vp_by_player = {1: 0, 2: 0}
            strain_removed_by_player = {1: 0, 2: 0}
            for coord, strain_count in list(strain_map.items()):
                if not strain_count or strain_count <= 0:
                    continue
                controller = get_space_controller(game, map_id, coord)
                if not controller:
                    continue
                vp_by_player[controller] += int(vp_per_strain) * int(strain_count)
                strain_removed_by_player[controller] += int(strain_count)
                data[strain_state_key][coord] = 0
            for pn in (1, 2):
                if vp_by_player[pn] > 0:
                    vp_val = vp_by_player[pn]
                    removed = strain_removed_by_player[pn]
                    pid = get_player_id(game, pn)
                    award_objective_vp(game, pn, vp_val)
                    msg = (vp_msg_tpl.replace('{vp}', str(vp_val)).replace('{count}', str(removed))
                           if vp_msg_tpl else f'signal markers controlled ({removed} strain removed × {int(vp_per_strain)} VP)')
                    _log(ctx, f'<@{pid}> gained **{vp_val} VP** — {msg}.')
                    _check_win(game, ctx)
                    if _ended():
                        return {'gameEnded': True}

    # 8. autoDistributeCrateTokens (Devaron Garrison A)
    if 'autoDistributeCrateTokens' in rules and map_id:
        cfg = rules.get('autoDistributeCrateTokens') or {}
        vp_per_crate = cfg.get('vpPerCrate', 2)
        crate_tokens = data.get('crateTokens')
        if isinstance(crate_tokens, dict):
            vp_by_player = {1: 0, 2: 0}
            distribution_log = []
            for coord, tokens in list(crate_tokens.items()):
                if not isinstance(tokens, list) or not tokens:
                    continue
                controller = get_space_controller(game, map_id, coord)
                if not controller:
                    data['crateTokens'][coord] = []
                    continue
                vp_by_player[controller] += int(vp_per_crate)
                nearby = get_figures_on_or_adjacent_to_space(game, controller, coord, map_id)
                if nearby:
                    recipient = nearby[0]
                    for tok in tokens:
                        grant_power_tokens(data, recipient, tok, 1)
                    distribution_log.append(f"{coord}: [{', '.join(tokens)}] → {recipient}")
                else:
                    distribution_log.append(
                        f"{coord}: [{', '.join(tokens)}] — no adjacent friendly, tokens lost",
                    )
                data['crateTokens'][coord] = []
            if distribution_log:
                _log(ctx, f"**Crate tokens distributed:** {' | '.join(distribution_log)}")
            for pn in (1, 2):
                if vp_by_player[pn] > 0:
                    vp_val = vp_by_player[pn]
                    count = vp_val // int(vp_per_crate)
                    pid = get_player_id(game, pn)
                    award_objective_vp(game, pn, vp_val)
                    plural = 's' if count != 1 else ''
                    _log(ctx, f'<@{pid}> gained **{vp_val} VP** — {count} crate{plural} controlled ({int(vp_per_crate)} VP each).')
                    _check_win(game, ctx)
                    if _ended():
                        return {'gameEnded': True}

    # 9. vpPerControlledDeploymentZone (Hoth Battle Station A Inside Job)
    cfg = rules.get('vpPerControlledDeploymentZone')
    if cfg and map_id:
        vp = cfg.get('vp')
        vp_msg_tpl = cfg.get('vpMessage')
        if isinstance(vp, (int, float)):
            zone_data = (get_deployment_zones() or {}).get(map_id)
            if zone_data:
                p1_cells = get_player_occupied_cells_for_control(game, 1)
                p2_cells = get_player_occupied_cells_for_control(game, 2)
                vp_by_player = {1: 0, 2: 0}
                for zone_color in ('red', 'blue'):
                    zone_spaces = {normalize_coord(s) for s in (zone_data.get(zone_color) or [])}
                    if not zone_spaces:
                        continue
                    p1_count = sum(1 for c in zone_spaces if c in p1_cells)
                    p2_count = sum(1 for c in zone_spaces if c in p2_cells)
                    if p1_count > 0 and p2_count == 0:
                        vp_by_player[1] += int(vp)
                    elif p2_count > 0 and p1_count == 0:
                        vp_by_player[2] += int(vp)
                for pn in (1, 2):
                    if vp_by_player[pn] > 0:
                        vp_val = vp_by_player[pn]
                        pid = get_player_id(game, pn)
                        award_objective_vp(game, pn, vp_val)
                        msg = vp_msg_tpl or f'deployment zone(s) controlled ({int(vp)} VP each)'
                        _log(ctx, f'<@{pid}> gained **{vp_val} VP** — {msg}.')
                        _check_win(game, ctx)
                        if _ended():
                            return {'gameEnded': True}

    # 10. vpPerContrabandInOpponentDeploymentZone (Hoth B Bomb Drop)
    cfg = rules.get('vpPerContrabandInOpponentDeploymentZone')
    if cfg and data.get('figureContraband'):
        vp = cfg.get('vp')
        vp_msg_tpl = cfg.get('vpMessage')
        if isinstance(vp, (int, float)):
            opp_zone_data = (get_deployment_zones() or {}).get(map_id)
            if opp_zone_data:
                init_pn = get_initiative_player_num(game)
                for pn in (1, 2):
                    opp_pn = 3 - pn
                    chosen = data.get('deploymentZoneChosen')
                    if opp_pn == init_pn:
                        opp_zone_color = chosen
                    else:
                        opp_zone_color = 'blue' if chosen == 'red' else 'red'
                    opp_zone_spaces = {normalize_coord(s) for s in (opp_zone_data.get(opp_zone_color) or [])}
                    scored = 0
                    fig_contraband = data.get('figureContraband') or {}
                    for fig_key, carrying in list(fig_contraband.items()):
                        if not carrying:
                            continue
                        poses = (data.get('figurePositions') or {}).get(pn) or {}
                        if fig_key not in poses:
                            continue
                        fig_coord = normalize_coord(poses[fig_key])
                        if fig_coord not in opp_zone_spaces:
                            continue
                        scored += 1
                        del data['figureContraband'][fig_key]
                    if scored > 0:
                        vp_val = int(vp) * scored
                        pid = get_player_id(game, pn)
                        award_objective_vp(game, pn, vp_val)
                        msg = vp_msg_tpl or f"explosive(s) discarded in opponent's deployment zone ({int(vp)} VP each)"
                        _log(ctx, f'<@{pid}> gained **{vp_val} VP** — {msg}.')
                        _check_win(game, ctx)
                        if _ended():
                            return {'gameEnded': True}

    return {'gameEnded': False}


# ---------------------------------------------------------------------------
# Start-of-round rules

def run_start_of_round_rules(game: Any, map_id: Optional[str], variant: str,
                              rules: Optional[Dict[str, Any]],
                              ctx: Optional[Dict[str, Any]] = None,
                              rng: Optional[random.Random] = None,
                              ) -> None:
    """Run SoR rules. Sync. rng is optional — deterministic testing hook."""
    if not rules or not isinstance(rules, dict):
        return
    data = _data(game)
    ctx = ctx or {}
    rng = rng or random

    # setTokenCountFromInitiativeHand (Cantina token count)
    cfg = rules.get('setTokenCountFromInitiativeHand')
    if cfg:
        game_key = cfg.get('gameKey')
        if game_key:
            init_id = data.get('initiativePlayerId')
            if init_id == data.get('player1Id'):
                hand = data.get('player1CcHand') or []
            else:
                hand = data.get('player2CcHand') or []
            data[game_key] = len(hand)
            mission_name = (data.get('selectedMission') or {}).get('name') or 'Mission Effect'
            _log(ctx, f"📊 **{mission_name}** — Cantina tokens set to **{len(hand)}** (initiative player's hand size).")

    # randomRevealAndPlaceStrain (Chopper Base B Powered Perimeter)
    if 'randomRevealAndPlaceStrain' in rules and map_id:
        cfg = rules.get('randomRevealAndPlaceStrain') or {}
        strain_state_key = cfg.get('strainStateKey', 'signalMarkerStrain')
        mission_side = 'missionA' if variant == 'a' else 'missionB'
        tokens = _map_tokens(ctx)
        mission_data = (tokens.get(map_id) or {}).get(mission_side) or {}
        token_types = mission_data.get('tokenTypes') or []
        positions = mission_data.get('positions') or {}

        color_groups = []
        for id_, coords in positions.items():
            if not isinstance(coords, list) or not coords:
                continue
            try:
                type_info = token_types[int(id_)] or {}
            except (ValueError, IndexError):
                type_info = {}
            image = str(type_info.get('image') or '')
            m = NEUTRAL_COLOR_RE.search(image)
            color = m.group(1).lower() if m else None
            if color:
                color_groups.append({'id': id_, 'color': color, 'coords': coords})

        if color_groups:
            data.setdefault(strain_state_key, {})
            shuffled = list(color_groups)
            rng.shuffle(shuffled)
            reveals = []
            for p in (1, 2):
                if p - 1 >= len(shuffled):
                    break
                pick = shuffled[p - 1]
                reveals.append({'player': p, 'color': pick['color'], 'coords': pick['coords']})
                for coord in pick['coords']:
                    c = normalize_coord(coord)
                    data[strain_state_key][c] = (data[strain_state_key].get(c) or 0) + 1
            lines = [f"Player {r['player']} revealed **{r['color'].upper()}** "
                     f"(+1 strain on {', '.join(r['coords'])})"
                     for r in reveals]
            _log(ctx, f"**Powered Perimeter — token reveal:** {' | '.join(lines)}")

    # placeTokensOnCrates (Devaron Garrison A) — empty dict is truthy in JS so
    # we check presence rather than truthiness.
    if 'placeTokensOnCrates' in rules and map_id:
        mission_side = 'missionA' if variant == 'a' else 'missionB'
        tokens = _map_tokens(ctx)
        mission_data = (tokens.get(map_id) or {}).get(mission_side) or {}
        token_types = mission_data.get('tokenTypes') or []
        positions = mission_data.get('positions') or {}
        data.setdefault('crateTokens', {})
        placed = []
        for id_, coords in positions.items():
            if not isinstance(coords, list) or not coords:
                continue
            try:
                type_info = token_types[int(id_)] or {}
            except (ValueError, IndexError):
                type_info = {}
            image = str(type_info.get('image') or '')
            m = COLOR_PREFIX_RE.search(image)
            color = m.group(1).lower() if m else None
            token_name = _COLOR_TO_POWER_TOKEN_CRATE.get(color) if color else None
            if not token_name:
                continue
            for coord in coords:
                c = normalize_coord(coord)
                data['crateTokens'].setdefault(c, [])
                data['crateTokens'][c].append(token_name)
                placed.append(f'{c} ({token_name})')
        if placed:
            _log(ctx, f"**Crate tokens placed:** {', '.join(placed)}")


# ---------------------------------------------------------------------------
# NPC Krykna (Chopper Base A)

def run_npc_krykna_activation(game: Any, map_id: Optional[str],
                              ctx: Optional[Dict[str, Any]] = None
                              ) -> Dict[str, Any]:
    """Emit damage events for non-Krykna figures adjacent to any Krykna.

    Lazy-inits `game['npcKrykna']` from missionA token positions on first
    call. Returns {'logs', 'damageEvents', 'claimedPlacementNeeded'}.
    """
    data = _data(game)
    ctx = ctx or {}

    if 'npcKrykna' not in data or data.get('npcKrykna') is None:
        tokens = _map_tokens(ctx)
        mission_data = (tokens.get(map_id) or {}).get('missionA') or {}
        positions: List[str] = []
        for v in (mission_data.get('positions') or {}).values():
            if isinstance(v, list):
                positions.extend([s for s in v if s])
        if not positions:
            return {'logs': [], 'damageEvents': []}
        data['npcKrykna'] = [
            {'id': f'krykna-{i + 1}', 'coord': normalize_coord(c),
             'hp': 8, 'maxHp': 8, 'defeated': False}
            for i, c in enumerate(positions)
        ]

    active_krykna = [k for k in data['npcKrykna'] if not k.get('defeated')]
    if not active_krykna:
        return {'logs': ['All Krykna defeated.'], 'damageEvents': []}

    map_spaces = get_map_spaces(map_id) if map_id else None
    if not map_spaces or not map_spaces.get('adjacency'):
        return {'logs': ['No adjacency data — Krykna damage skipped'], 'damageEvents': []}
    adjacency = map_spaces.get('adjacency') or {}

    krykna_coords = {normalize_coord(k['coord']) for k in active_krykna}
    logs = []
    damage_events = []

    for pn in (1, 2):
        poses = (data.get('figurePositions') or {}).get(pn) or {}
        for fig_key, fig_coord in poses.items():
            if not fig_coord:
                continue
            fc = normalize_coord(fig_coord)
            adj_to_krykna = any(normalize_coord(n) in krykna_coords
                                 for n in (adjacency.get(fc) or []))
            if adj_to_krykna:
                damage_events.append({'figureKey': fig_key, 'playerNum': pn, 'damage': 2})

    if damage_events:
        logs.append(f'{len(damage_events)} hostile figure(s) adjacent to Krykna each suffer **2 damage**.')

    claimed1 = (data.get('claimedKrykna') or {}).get(1, 0) or 0
    claimed2 = (data.get('claimedKrykna') or {}).get(2, 0) or 0
    claimed_placement_needed = claimed1 > 0 or claimed2 > 0

    return {
        'logs': logs,
        'damageEvents': damage_events,
        'claimedPlacementNeeded': claimed_placement_needed,
    }


def get_valid_krykna_placement_spaces(game: Any, player_num: int,
                                      map_id: Optional[str]) -> List[str]:
    """Opponent's deployment zone minus occupied spaces (+ active Krykna)."""
    data = _data(game)
    zones = (get_deployment_zones() or {}).get(map_id)
    if not zones:
        return []
    opponent_zone_label = 'blue' if player_num == 1 else 'red'
    zone_coords = [normalize_coord(c) for c in (zones.get(opponent_zone_label) or [])]

    occupied: Set[str] = set()
    for pn in (1, 2):
        poses = (data.get('figurePositions') or {}).get(pn) or {}
        for coord in poses.values():
            if coord:
                occupied.add(normalize_coord(coord))
    for k in (data.get('npcKrykna') or []):
        if not k.get('defeated'):
            occupied.add(normalize_coord(k['coord']))

    return [c for c in zone_coords if c not in occupied]


# ---------------------------------------------------------------------------
# NPC Thug

def run_npc_thug_activation(game: Any, map_id: Optional[str],
                            ctx: Optional[Dict[str, Any]] = None
                            ) -> Dict[str, Any]:
    """Advance thugs toward nearest hostile via BFS, then emit damage events."""
    data = _data(game)
    ctx = ctx or {}

    if 'npcThugs' not in data or data.get('npcThugs') is None:
        tokens = _map_tokens(ctx)
        mission_data = (tokens.get(map_id) or {}).get('missionA') or {}
        positions: List[str] = []
        for v in (mission_data.get('positions') or {}).values():
            if isinstance(v, list):
                positions.extend([s for s in v if s])
        if not positions:
            return {'logs': [], 'damageEvents': []}
        data['npcThugs'] = [
            {'id': f'thug-{i + 1}', 'coord': normalize_coord(c),
             'hp': 4, 'maxHp': 4, 'defeated': False}
            for i, c in enumerate(positions)
        ]

    active_thugs = [t for t in data['npcThugs'] if not t.get('defeated')]
    if not active_thugs:
        return {'logs': [], 'damageEvents': []}

    map_spaces = get_map_spaces(map_id) if map_id else None
    if not map_spaces or not map_spaces.get('adjacency'):
        return {'logs': ['No map adjacency — thug movement skipped'], 'damageEvents': []}
    adjacency = map_spaces.get('adjacency') or {}

    hostile_by_coord: Dict[str, Dict[str, Any]] = {}
    for pn in (1, 2):
        poses = (data.get('figurePositions') or {}).get(pn) or {}
        for fig_key, coord in poses.items():
            if coord:
                hostile_by_coord[normalize_coord(coord)] = {'figureKey': fig_key, 'playerNum': pn}
    all_hostile_coords = set(hostile_by_coord.keys())

    logs = []
    for thug in active_thugs:
        start_coord = normalize_coord(thug['coord'])

        # BFS to nearest hostile (parent map for path reconstruction)
        visited: Dict[str, Optional[str]] = {start_coord: None}
        queue = [start_coord]
        target_coord: Optional[str] = None
        while queue:
            curr = queue.pop(0)
            for neighbor in (adjacency.get(curr) or []):
                n = normalize_coord(neighbor)
                if n in visited:
                    continue
                visited[n] = curr
                if n in all_hostile_coords:
                    target_coord = n
                    break
                queue.append(n)
            if target_coord:
                break

        if not target_coord:
            logs.append(f"Thug at {thug['coord']}: no hostile found, stays put.")
            continue

        # Reconstruct path (spaces from start → target, excluding start)
        path: List[str] = []
        cur = target_coord
        while cur and cur != start_coord:
            prev = visited.get(cur)
            if prev is not None:
                path.insert(0, cur)
            cur = visited.get(cur)

        # Move up to 2 steps, stopping 1 space short to stay adjacent
        max_steps = min(2, max(0, len(path) - 1))
        if max_steps > 0:
            thug['coord'] = path[max_steps - 1]
            plural = 's' if max_steps != 1 else ''
            logs.append(f"Thug moved {start_coord} → **{thug['coord']}** "
                        f"({max_steps} step{plural} toward {target_coord}).")
        else:
            logs.append(f'Thug at **{start_coord}**: already adjacent to hostile at {target_coord}.')

    # Emit damage events
    thug_coords = {normalize_coord(t['coord']) for t in data['npcThugs'] if not t.get('defeated')}
    damage_events = []
    for pn in (1, 2):
        poses = (data.get('figurePositions') or {}).get(pn) or {}
        for fig_key, fig_coord in poses.items():
            if not fig_coord:
                continue
            fc = normalize_coord(fig_coord)
            adj_to_thug = any(normalize_coord(n) in thug_coords for n in (adjacency.get(fc) or []))
            if adj_to_thug:
                damage_events.append({'figureKey': fig_key, 'playerNum': pn, 'damage': 2})

    return {'logs': logs, 'damageEvents': damage_events}
