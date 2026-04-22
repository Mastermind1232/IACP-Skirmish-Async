"""D10 — headless action-application dispatcher.

`step(game, action) -> GameState` applies a single action to a game and
returns the resulting state. This is the inverse of the encoder: the
encoder turns a GameState into tensors for the net, the stepper turns
(state, action) back into new state for the self-play loop.

Unlike the JS handlers in src/handlers/*.js, this dispatcher is
headless: no Discord interaction, no UI message updates, no two-player
confirmation dances — just game-state transitions. The self-play loop
supplies actions from one side at a time, and the stepper advances
state accordingly.

Action space coverage is filled in incrementally. Unimplemented actions
raise NotImplementedError with a clear message so the self-play loop
surfaces gaps rather than silently producing wrong states.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Mapping, Optional

import random as _random

from python.engine.actions import ActionType
from python.engine.data.dc_effects_loader import get_dc_effect
from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.mechanics.adjacency import is_chebyshev_adjacent
from python.engine.mechanics.combat import compute_combat_result
from python.engine.mechanics.defeat import (
    award_kill_vp,
    calculate_kill_vp,
    check_nefarious_gains,
    remove_figure_position,
)
from python.engine.mechanics.dice import roll_attack_dice, roll_defense_dice
from python.engine.mechanics.los import has_line_of_sight
from python.engine.mechanics.movement_cache import get_path_cost
from python.engine.state import GameState


@dataclass
class Action:
    """A headless action description.

    Attributes:
        type: the ActionType enum value.
        player: the player (1 or 2) taking the action. Some actions
            (round-level) may use player=0 for system-initiated steps.
        params: action-specific parameters. Keys mirror the JS
            buildCustomId parameter names (coord, figureIndex, etc.).
    """
    type: ActionType
    player: int = 0
    params: Dict[str, Any] = field(default_factory=dict)

    def __repr__(self) -> str:
        return f'Action({self.type.value}, p{self.player}, {self.params})'


Handler = Callable[[GameState, Action], GameState]

_HANDLERS: Dict[ActionType, Handler] = {}


def register(action_type: ActionType, handler: Handler) -> None:
    """Register a handler for an action type."""
    if action_type in _HANDLERS:
        raise ValueError(f'duplicate handler for {action_type}')
    _HANDLERS[action_type] = handler


def step(game: GameState, action: Action) -> GameState:
    """Apply `action` to `game`, returning the new state.

    The returned state is a fresh GameState; the input is not mutated.
    """
    handler = _HANDLERS.get(action.type)
    if handler is None:
        raise NotImplementedError(
            f'stepper: no handler registered for {action.type.value}'
        )
    new_game = game.copy()
    result = handler(new_game, action)
    if not isinstance(result, GameState):
        raise TypeError(
            f'handler for {action.type.value} returned {type(result).__name__}, '
            f'expected GameState'
        )
    return result


def is_implemented(action_type: ActionType) -> bool:
    return action_type in _HANDLERS


def implemented_action_types() -> list:
    return sorted(_HANDLERS.keys(), key=lambda a: a.value)


# ---------------------------------------------------------------------------
# Handler implementations
# ---------------------------------------------------------------------------

def _has_any_activations_remaining(game: GameState) -> bool:
    rem = game.get('activationsRemaining') or {}
    if isinstance(rem, Mapping):
        for v in rem.values():
            if isinstance(v, (int, float)) and v > 0:
                return True
    return False


def _handle_pass_activation_turn(game: GameState, action: Action) -> GameState:
    """A player declines to activate this turn.

    Effect: swap the active player (the initiative alternation continues).
    If no activations remain for either side, this becomes a no-op from
    the state's perspective — the next action will be END_ACTIVATION_PHASE.
    """
    active = int(game.get('activePlayer') or 1)
    new_active = 2 if active == 1 else 1
    game['activePlayer'] = new_active
    return game


def _handle_end_activation_phase(game: GameState, action: Action) -> GameState:
    """End the activation phase and advance to end-of-round.

    Preconditions (enforced):
      - Both players must have 0 activations remaining.
    Effects:
      - roundPhase -> 'end'
      - Clears per-round activation-phase ready flags.
    """
    if _has_any_activations_remaining(game):
        raise ValueError(
            'end_activation_phase: activations remaining; '
            f'state={game.get("activationsRemaining")}'
        )
    game['roundPhase'] = 'end'
    game['p1ActivationPhaseEnded'] = False
    game['p2ActivationPhaseEnded'] = False
    return game


# ---------------------------------------------------------------------------
# Activation + movement
# ---------------------------------------------------------------------------

def _dc_name_from_figure_key(figure_key: str) -> str:
    """'Rebel Trooper (Regular)-0-0' -> 'Rebel Trooper (Regular)'."""
    parts = figure_key.rsplit('-', 2)
    if len(parts) == 3:
        return parts[0]
    return figure_key


def _occupied_cells(game: GameState, exclude_key: Optional[str] = None) -> list:
    """Flatten figurePositions to a list of cells, optionally dropping one."""
    out = []
    fp = game.get('figurePositions') or {}
    if not isinstance(fp, Mapping):
        return out
    for player_key, positions in fp.items():
        if not isinstance(positions, Mapping):
            continue
        for fkey, coord in positions.items():
            if fkey == exclude_key:
                continue
            if isinstance(coord, str) and coord:
                out.append(coord)
    return out


def _find_figure(game: GameState, figure_key: str):
    """Return (player, coord) for figure_key, or (None, None)."""
    fp = game.get('figurePositions') or {}
    if not isinstance(fp, Mapping):
        return None, None
    for player_key, positions in fp.items():
        if isinstance(positions, Mapping) and figure_key in positions:
            try:
                return int(player_key), positions[figure_key]
            except (TypeError, ValueError):
                return None, None
    return None, None


def _handle_activate_dc(game: GameState, action: Action) -> GameState:
    """Start an activation for a specific figure.

    Required params: figure_key (str).
    Effects:
      - Mark figure_key as the sole entry in activeFigureKeys.
      - Record starting position in activationStartPositions[player].
      - Set movementPoints = DC speed stat.
      - Decrement activationsRemaining[player] by 1.
      - Clear figureDamageThisActivation[player][figure_key] if present.
    """
    figure_key = action.params.get('figure_key') or action.params.get('figureKey')
    if not figure_key:
        raise ValueError('activate_dc requires figure_key param')

    player, coord = _find_figure(game, figure_key)
    if player is None:
        raise ValueError(f'activate_dc: figure {figure_key!r} not on board')
    if action.player and action.player != player:
        raise ValueError(
            f'activate_dc: action.player={action.player} does not own {figure_key!r} '
            f'(owned by p{player})'
        )

    rem = dict(game.get('activationsRemaining') or {})
    # Allow both int and str keys.
    cur = rem.get(player, rem.get(str(player), 0))
    if not isinstance(cur, (int, float)) or cur <= 0:
        raise ValueError(f'activate_dc: player {player} has no activations remaining')
    rem[player] = int(cur) - 1
    game['activationsRemaining'] = rem

    game['activeFigureKeys'] = [figure_key]
    game['activePlayer'] = player

    starts = dict(game.get('activationStartPositions') or {})
    pstarts = dict(starts.get(player, starts.get(str(player), {})))
    pstarts[figure_key] = coord
    starts[player] = pstarts
    game['activationStartPositions'] = starts

    dc_name = _dc_name_from_figure_key(figure_key)
    effect = get_dc_effect(dc_name) or {}
    speed = effect.get('speed')
    if not isinstance(speed, (int, float)):
        speed = 4
    game['movementPoints'] = int(speed)

    # Clear per-activation damage counter for this figure.
    dmg = dict(game.get('figureDamageThisActivation') or {})
    pdmg = dict(dmg.get(player, dmg.get(str(player), {})))
    pdmg.pop(figure_key, None)
    dmg[player] = pdmg
    game['figureDamageThisActivation'] = dmg

    return game


def _handle_dc_end_activation(game: GameState, action: Action) -> GameState:
    """End the currently-active figure's activation.

    Effects:
      - Clear activeFigureKeys and movementPoints.
      - Swap activePlayer (alternation).
    """
    game['activeFigureKeys'] = []
    game['movementPoints'] = 0
    active = int(game.get('activePlayer') or 1)
    game['activePlayer'] = 2 if active == 1 else 1
    return game


def _handle_move_pick_space(game: GameState, action: Action) -> GameState:
    """Move the currently-active figure to `coord`.

    Required params: coord (str), optionally figure_key (defaults to the
    first active figure).
    Effects:
      - Charge MP equal to path cost; require MP >= cost.
      - Update figurePositions and figuresMovedThisRound.
    """
    coord = action.params.get('coord')
    if not isinstance(coord, str) or not coord:
        raise ValueError('move_pick_space requires coord param')

    active_keys = game.get('activeFigureKeys') or []
    figure_key = action.params.get('figure_key') or action.params.get('figureKey')
    if not figure_key:
        if not active_keys:
            raise ValueError('move_pick_space: no active figure to move')
        figure_key = active_keys[0]

    player, start_coord = _find_figure(game, figure_key)
    if player is None:
        raise ValueError(f'move_pick_space: figure {figure_key!r} not on board')
    if start_coord == coord:
        return game  # no-op

    mp = int(game.get('movementPoints') or 0)
    map_id = game.get('mapId')
    map_spaces = get_map_spaces(map_id)
    if not map_spaces:
        raise ValueError(f'move_pick_space: no map spaces for mapId={map_id!r}')

    occupied = _occupied_cells(game, exclude_key=figure_key)
    cost = get_path_cost(start_coord, coord, map_spaces, occupied)
    if cost == float('inf'):
        raise ValueError(f'move_pick_space: {coord} unreachable from {start_coord}')
    if cost > mp:
        raise ValueError(
            f'move_pick_space: insufficient MP (need {cost}, have {mp})'
        )

    game['movementPoints'] = mp - int(cost)

    fp = dict(game.get('figurePositions') or {})
    ppos = dict(fp.get(player, fp.get(str(player), {})))
    ppos[figure_key] = coord
    fp[player] = ppos
    game['figurePositions'] = fp

    moved = list(game.get('figuresMovedThisRound') or [])
    if figure_key not in moved:
        moved.append(figure_key)
    game['figuresMovedThisRound'] = moved

    return game


# ---------------------------------------------------------------------------
# Attack
# ---------------------------------------------------------------------------

def _figure_hp_key(player: int, dc_name: str) -> str:
    return f'{player}:{dc_name}'


def _get_figure_hp(game: GameState, player: int, figure_key: str) -> tuple:
    """Return (current_hp, max_hp) for figure_key, reading from dcHealthState
    or falling back to the DC's base health."""
    dc_name = _dc_name_from_figure_key(figure_key)
    effect = get_dc_effect(dc_name) or {}
    max_hp = effect.get('health')
    if not isinstance(max_hp, (int, float)):
        max_hp = 3
    max_hp = int(max_hp)

    try:
        idx = int(figure_key.rsplit('-', 1)[-1])
    except (ValueError, AttributeError):
        idx = 0

    dc_health = game.get('dcHealthState') or {}
    key = _figure_hp_key(player, dc_name)
    hp_list = dc_health.get(key) if isinstance(dc_health, Mapping) else None
    if isinstance(hp_list, list) and 0 <= idx < len(hp_list):
        entry = hp_list[idx]
        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            cur, mx = entry[0], entry[1]
            if isinstance(cur, (int, float)) and isinstance(mx, (int, float)):
                return int(cur), int(mx)
    return max_hp, max_hp


def _set_figure_hp(game: GameState, player: int, figure_key: str, cur: int, mx: int) -> None:
    dc_name = _dc_name_from_figure_key(figure_key)
    try:
        idx = int(figure_key.rsplit('-', 1)[-1])
    except (ValueError, AttributeError):
        idx = 0
    dc_health = dict(game.get('dcHealthState') or {})
    key = _figure_hp_key(player, dc_name)
    hp_list = list(dc_health.get(key) or [])
    while len(hp_list) <= idx:
        hp_list.append([mx, mx])
    hp_list[idx] = [int(cur), int(mx)]
    dc_health[key] = hp_list
    game['dcHealthState'] = dc_health


def _attack_legal(
    game: GameState, attacker_coord: str, target_coord: str, attack_type: str,
) -> Optional[str]:
    """Return an error string if the attack is illegal, else None."""
    attack_type = (attack_type or 'range').lower()
    if attack_type == 'melee':
        if not is_chebyshev_adjacent(attacker_coord, target_coord):
            return f'melee target {target_coord} not adjacent to {attacker_coord}'
        return None
    map_id = game.get('mapId')
    map_spaces = get_map_spaces(map_id) if map_id else {}
    if not map_spaces:
        return f'no map spaces for mapId={map_id!r}'
    if not has_line_of_sight(attacker_coord, target_coord, map_spaces):
        return f'no LOS from {attacker_coord} to {target_coord}'
    return None


def _handle_attack_target(game: GameState, action: Action) -> GameState:
    """Atomic combat resolution: declare -> roll -> resolve -> apply damage.

    Required params:
        attacker_key (str), target_key (str).
    Optional params:
        rng_seed (int): deterministic dice stream. Defaults to Python's
            module random if absent.

    Scope (MVP):
        - Validates adjacency for melee, LOS for range.
        - No surges spent (surges contribute 0 to the attack).
        - No rerolls, no cover, no Hide/Focus condition effects.
        - Tracks figureAttacksThisActivation; one attack per activation.
        - On defeat: removes figure, awards kill VP (+ Jabba bonus).
    """
    attacker_key = action.params.get('attacker_key') or action.params.get('attackerKey')
    target_key = action.params.get('target_key') or action.params.get('targetKey')
    if not attacker_key or not target_key:
        raise ValueError('attack_target requires attacker_key and target_key')

    atk_player, atk_coord = _find_figure(game, attacker_key)
    def_player, def_coord = _find_figure(game, target_key)
    if atk_player is None:
        raise ValueError(f'attack_target: attacker {attacker_key!r} not on board')
    if def_player is None:
        raise ValueError(f'attack_target: target {target_key!r} not on board')
    if atk_player == def_player:
        raise ValueError(
            f'attack_target: cannot attack own figure (both p{atk_player})'
        )

    # Enforce one attack per activation per figure.
    atk_log = dict(game.get('figureAttacksThisActivation') or {})
    patk = dict(atk_log.get(atk_player, atk_log.get(str(atk_player), {})))
    already = patk.get(attacker_key, 0)
    if already >= 1:
        raise ValueError(
            f'attack_target: {attacker_key!r} already attacked this activation'
        )

    atk_dc = _dc_name_from_figure_key(attacker_key)
    def_dc = _dc_name_from_figure_key(target_key)
    atk_effect = get_dc_effect(atk_dc) or {}
    def_effect = get_dc_effect(def_dc) or {}

    attack_spec = atk_effect.get('attack') or {}
    dice_colors = attack_spec.get('dice') or []
    if not dice_colors:
        raise ValueError(f'attack_target: {atk_dc!r} has no attack dice')
    attack_type = attack_spec.get('type') or 'range'

    err = _attack_legal(game, atk_coord, def_coord, attack_type)
    if err:
        raise ValueError(f'attack_target: {err}')

    defense_colors = def_effect.get('defense') or ['white']
    # Multi-color defense: roll each and sum block/evade/dodge.

    rng = _random.Random(action.params.get('rng_seed'))

    attack_roll = roll_attack_dice(dice_colors, rng=rng)
    def_block = def_evade = 0
    def_dodge = False
    for color in defense_colors:
        d = roll_defense_dice(color, rng=rng)
        def_block += d.get('block', 0) or 0
        def_evade += d.get('evade', 0) or 0
        def_dodge = def_dodge or bool(d.get('dodge'))
    defense_roll = {
        'color': defense_colors[0],
        'block': def_block,
        'evade': def_evade,
        'dodge': def_dodge,
    }

    combat = {
        'attackRoll': attack_roll,
        'defenseRoll': defense_roll,
        'attackerConds': [],
        'defenderConds': [],
    }
    result = compute_combat_result(combat)
    damage = int(result.get('damage') or 0) if result.get('hit') else 0

    if damage > 0:
        cur, mx = _get_figure_hp(game, def_player, target_key)
        new_hp = max(0, cur - damage)
        _set_figure_hp(game, def_player, target_key, new_hp, mx)
        if new_hp <= 0:
            # Defeat.
            remove_figure_position(game.data, def_player, target_key)
            vp = calculate_kill_vp(def_dc)
            if vp:
                award_kill_vp(game.data, atk_player, vp)
            check_nefarious_gains(game.data, def_player)

    # Record attack on attacker.
    patk[attacker_key] = already + 1
    atk_log[atk_player] = patk
    game['figureAttacksThisActivation'] = atk_log

    # Record damage-this-activation.
    dmg_log = dict(game.get('figureDamageThisActivation') or {})
    pdmg = dict(dmg_log.get(atk_player, dmg_log.get(str(atk_player), {})))
    pdmg[attacker_key] = (pdmg.get(attacker_key, 0) or 0) + damage
    dmg_log[atk_player] = pdmg
    game['figureDamageThisActivation'] = dmg_log

    return game


# ---------------------------------------------------------------------------
# Round cycling
# ---------------------------------------------------------------------------

def _count_activations_from_board(game: GameState, player: int) -> int:
    """Count distinct deployment groups for `player` on the board.

    A figure_key shaped like 'DC Name-g-f' belongs to group `g`. Each
    (dc_name, group_index) pair contributes one activation regardless of
    how many surviving figures the group has.
    """
    fp = game.get('figurePositions') or {}
    if not isinstance(fp, Mapping):
        return 0
    positions = fp.get(player, fp.get(str(player), {}))
    if not isinstance(positions, Mapping):
        return 0
    groups = set()
    for fkey, coord in positions.items():
        if not coord:
            continue
        parts = fkey.rsplit('-', 2)
        if len(parts) == 3:
            groups.add((parts[0], parts[1]))
    return len(groups)


def _handle_end_end_of_round(game: GameState, action: Action) -> GameState:
    """Close out the round and set up the next one.

    Effects:
      - round/currentRound += 1.
      - activationsRemaining[p] = count of live deployment groups.
      - Clear per-round tracking (moved, attacks, damage, active, starts).
      - roundPhase -> 'activation'.
      - If either side has zero groups: phase -> 'game_over'.
    """
    cur_round = int(game.get('round') or game.get('currentRound') or 1)
    game['round'] = cur_round + 1
    # Keep currentRound in sync if it was being used.
    if 'currentRound' in game.data:
        game['currentRound'] = cur_round + 1

    p1_groups = _count_activations_from_board(game, 1)
    p2_groups = _count_activations_from_board(game, 2)

    if p1_groups == 0 or p2_groups == 0:
        game['phase'] = 'game_over'
        game['roundPhase'] = 'end'
    else:
        game['roundPhase'] = 'activation'

    game['activationsRemaining'] = {1: p1_groups, 2: p2_groups}
    game['figuresMovedThisRound'] = []
    game['figureAttacksThisActivation'] = {}
    game['figureDamageThisActivation'] = {}
    game['activeFigureKeys'] = []
    game['activationStartPositions'] = {}
    game['movementPoints'] = 0
    game['p1ActivationPhaseEnded'] = False
    game['p2ActivationPhaseEnded'] = False

    return game


register(ActionType.PASS_ACTIVATION_TURN, _handle_pass_activation_turn)
register(ActionType.END_ACTIVATION_PHASE, _handle_end_activation_phase)
register(ActionType.ACTIVATE_DC, _handle_activate_dc)
register(ActionType.DC_END_ACTIVATION, _handle_dc_end_activation)
register(ActionType.MOVE_PICK_SPACE, _handle_move_pick_space)
register(ActionType.ATTACK_TARGET, _handle_attack_target)
# ---------------------------------------------------------------------------
# Auto-deploy (headless game start)
# ---------------------------------------------------------------------------

def _coord_row(coord: str) -> int:
    """Extract the numeric row from a coord like 'a12'."""
    for i, ch in enumerate(coord):
        if ch.isdigit():
            try:
                return int(coord[i:])
            except ValueError:
                return 0
    return 0


def _handle_auto_deploy(game: GameState, action: Action) -> GameState:
    """Place every figure in each player's squad onto the map, then start
    round 1. Picks low-row cells for p1, high-row cells for p2 so the
    sides start apart.

    Reads:
        game['player1Squad']['deploymentCards']: list of DC names.
        game['player2Squad']['deploymentCards']: list of DC names.
        game['selectedMap'] (or game['mapId']).

    Multi-figure groups: a DC with `figures=N` in dc-effects gets N
    figure keys (-0-0, -0-1, ... -0-(N-1)) and one shared group index.
    Duplicate DC entries in the squad list spawn separate groups (group
    index increments).

    Effects:
        figurePositions populated for both sides.
        round = 1, roundPhase = 'activation', phase = 'round_active'.
        activationsRemaining set from board.
        mapId mirrored from selectedMap if missing.
    """
    map_id = game.get('mapId') or game.get('selectedMap')
    if not map_id:
        raise ValueError('auto_deploy: no map_id / selectedMap on game')
    if 'mapId' not in game.data:
        game['mapId'] = map_id
    map_data = get_map_spaces(map_id)
    spaces = map_data.get('spaces') if isinstance(map_data, Mapping) else None
    if not spaces:
        raise ValueError(f'auto_deploy: no spaces for map {map_id!r}')

    sorted_by_row = sorted(spaces, key=lambda c: (_coord_row(c), c))
    p1_pool = list(sorted_by_row)                 # low rows first
    p2_pool = list(reversed(sorted_by_row))       # high rows first
    used = set()

    def _take(pool):
        while pool:
            cell = pool.pop(0)
            if cell not in used:
                used.add(cell)
                return cell
        return None

    def _build_positions(squad_key: str, pool) -> Dict[str, str]:
        out: Dict[str, str] = {}
        squad = game.get(squad_key) or {}
        dcs = squad.get('deploymentCards') if isinstance(squad, Mapping) else None
        if not isinstance(dcs, (list, tuple)):
            return out
        group_counts: Dict[str, int] = {}
        for dc_name in dcs:
            if not isinstance(dc_name, str) or not dc_name:
                continue
            if dc_name.startswith('[') and dc_name.endswith(']'):
                continue  # attachment/upgrade — no figure on board
            group_idx = group_counts.get(dc_name, 0)
            group_counts[dc_name] = group_idx + 1
            effect = get_dc_effect(dc_name) or {}
            n_figs = effect.get('figures')
            if not isinstance(n_figs, int) or n_figs < 1:
                n_figs = 1
            for fig_idx in range(n_figs):
                cell = _take(pool)
                if cell is None:
                    raise ValueError(
                        f'auto_deploy: ran out of cells placing {dc_name!r}'
                    )
                key = f'{dc_name}-{group_idx}-{fig_idx}'
                out[key] = cell
        return out

    p1_pos = _build_positions('player1Squad', p1_pool)
    p2_pos = _build_positions('player2Squad', p2_pool)
    game['figurePositions'] = {1: p1_pos, 2: p2_pos}

    game['round'] = 1
    game['currentRound'] = 1
    game['phase'] = 'round_active'
    game['roundPhase'] = 'activation'
    game['activePlayer'] = 1
    game['initiativeHolder'] = 1
    game['activationsRemaining'] = {
        1: _count_activations_from_board(game, 1),
        2: _count_activations_from_board(game, 2),
    }
    game['figuresMovedThisRound'] = []
    game['figureAttacksThisActivation'] = {}
    game['figureDamageThisActivation'] = {}
    game['activeFigureKeys'] = []
    game['activationStartPositions'] = {}
    game['movementPoints'] = 0
    return game


register(ActionType.END_END_OF_ROUND, _handle_end_end_of_round)
register(ActionType.AUTO_DEPLOY, _handle_auto_deploy)
