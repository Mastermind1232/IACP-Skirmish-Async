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


# ---------------------------------------------------------------------------
# Phase gate handlers (P7)
# ---------------------------------------------------------------------------

def _user_id_for_player(game: GameState, player: int) -> str:
    """Convert stepper player number → Discord-style user id for phase-gate helpers."""
    if player == 1:
        return str(game.get('player1Id') or 'p1')
    return str(game.get('player2Id') or 'p2')


def _handle_phase_gate_ready(game: GameState, action: Action) -> GameState:
    """A player clicks "I'm ready" on the current phase gate.

    Required: action.player ∈ {1, 2}. If no gate exists, the helper
    returns a no-op shape; we just mirror that (state unchanged).
    Advances through the gate when both players have readied — callers
    (round-flow handlers) read phaseGate.p1Ready / p2Ready to trigger
    the transition.
    """
    from python.engine.mechanics.phase_gate import record_phase_gate_ready
    user_id = _user_id_for_player(game, int(action.player or 0))
    record_phase_gate_ready(game, user_id)
    return game


def _handle_phase_gate_unready(game: GameState, action: Action) -> GameState:
    """A player un-readies from the current phase gate."""
    from python.engine.mechanics.phase_gate import record_phase_gate_unready
    user_id = _user_id_for_player(game, int(action.player or 0))
    record_phase_gate_unready(game, user_id)
    return game


register(ActionType.PHASE_GATE_READY, _handle_phase_gate_ready)
register(ActionType.PHASE_GATE_UNREADY, _handle_phase_gate_unready)


# ---------------------------------------------------------------------------
# Interact handler (P7)
# ---------------------------------------------------------------------------

def _handle_interact(game: GameState, action: Action) -> GameState:
    """Resolve an interact option (retrieve_contraband, use_terminal,
    open_door_*, launch_panel_*).

    Required params:
        figure_key (or figureKey): the figure performing the interact.
        option_id (or optionId): the interact option string.

    Preconditions:
        - option_id must be in get_legal_interact_options for the figure.

    Effects:
        - Dispatches through interact.resolve_interact_option (door-open,
          panel-flip, contraband-pickup).
        - Decrements actionsRemaining when present on the active DC.

    Returns the mutated state. Raises ValueError on invalid option_id,
    missing figure_key, or figure not on the board.
    """
    from python.engine.mechanics.board_helpers import get_legal_interact_options
    from python.engine.mechanics.interact import (
        UnknownInteractOption,
        resolve_interact_option,
    )

    figure_key = action.params.get('figure_key') or action.params.get('figureKey')
    option_id = action.params.get('option_id') or action.params.get('optionId')
    if not figure_key:
        raise ValueError('interact requires figure_key param')
    if not option_id:
        raise ValueError('interact requires option_id param')

    player_num = int(action.player or 0)
    if player_num not in (1, 2):
        # Fall back: find the figure on the board
        player_num, _ = _find_figure(game, figure_key)
        if player_num is None:
            raise ValueError(f'interact: figure {figure_key!r} not on board')

    map_id = game.get('mapId')
    if not map_id:
        selected = game.get('selectedMap') or {}
        map_id = selected.get('id') if isinstance(selected, Mapping) else None
    if not map_id:
        raise ValueError('interact: no mapId / selectedMap on game')

    legal_options = get_legal_interact_options(game, player_num, figure_key, map_id)
    legal_ids = {opt['id'] for opt in legal_options}
    if option_id not in legal_ids:
        raise ValueError(
            f'interact: option {option_id!r} not legal for {figure_key!r} '
            f'(legal: {sorted(legal_ids)})'
        )

    try:
        resolve_interact_option(game, player_num, figure_key, map_id, option_id)
    except UnknownInteractOption as e:
        raise ValueError(f'interact: {e}') from e

    return game


register(ActionType.INTERACT, _handle_interact)


# ---------------------------------------------------------------------------
# Power-token overflow (P7)
# ---------------------------------------------------------------------------

def _handle_pt_overflow_discard(game: GameState, action: Action) -> GameState:
    """Resolve one overflow slot by discarding a specific token.

    Required params:
        figure_key (or figureKey): the figure whose queue is being drained.
        token_index (or tokenIndex): the index in figurePowerTokens[fk] to pop.
    """
    from python.engine.mechanics.tokens import resolve_overflow_discard

    figure_key = action.params.get('figure_key') or action.params.get('figureKey')
    token_index = action.params.get('token_index')
    if token_index is None:
        token_index = action.params.get('tokenIndex')
    if not figure_key:
        raise ValueError('pt_overflow_discard requires figure_key param')
    if not isinstance(token_index, int):
        raise ValueError('pt_overflow_discard requires int token_index param')

    resolve_overflow_discard(game.data, figure_key, token_index)
    return game


register(ActionType.PT_OVERFLOW_DISCARD, _handle_pt_overflow_discard)


# ---------------------------------------------------------------------------
# CC draw (P7 / C5-A)
# ---------------------------------------------------------------------------

def _handle_cc_draw(game: GameState, action: Action) -> GameState:
    """Draw command cards for a player.

    Required: action.player ∈ {1, 2}.
    Optional params:
        n (int): cards to draw (default 1).
        target_hand_size (int): if set, draw to reach this hand size
            (takes precedence over `n`).
        reshuffle (bool): when True, reshuffle discard into deck if deck
            runs out mid-draw. Default False (strict mode — may return
            fewer cards than requested).
        rng_seed (int): optional — for deterministic shuffle when
            reshuffle=True and the deck empties.

    Mirrors the round.js CC-draw loop. Puts drawn cards into the player's
    hand and stores them on the transient `lastCcDraw` field so callers
    can render the draw animation.
    """
    from python.engine.cards.deck import (
        draw_cc_cards,
        draw_to_hand_size,
        draw_with_reshuffle,
    )

    player = int(action.player or 0)
    if player not in (1, 2):
        raise ValueError('cc_draw requires player ∈ {1, 2}')

    params = action.params or {}
    target = params.get('target_hand_size')
    if target is not None:
        if not isinstance(target, int) or target < 0:
            raise ValueError('cc_draw target_hand_size must be a non-negative int')
        drew = draw_to_hand_size(game, player, target)
    else:
        n = params.get('n', 1)
        if not isinstance(n, int) or n < 0:
            raise ValueError('cc_draw n must be a non-negative int')
        if params.get('reshuffle'):
            rng = None
            seed = params.get('rng_seed')
            if seed is not None:
                rng = _random.Random(int(seed))
            drew = draw_with_reshuffle(game, player, n, rng=rng)
        else:
            drew = draw_cc_cards(game, player, n)

    game.data['lastCcDraw'] = {'playerNum': player, 'cards': drew}
    return game


register(ActionType.CC_DRAW, _handle_cc_draw)


# ---------------------------------------------------------------------------
# Play Command Card (P7 / C5-A)
# ---------------------------------------------------------------------------

def _handle_play_cc(game: GameState, action: Action) -> GameState:
    """Play a CC from hand: validate → move hand → discard → record pending effect.

    Required params:
        card (str) — CC name in the player's hand.
    Optional params:
        force (bool) — skip timing + restriction gates (test / scripted path).

    Effects:
        - Validates card is in hand.
        - Enforces is_cc_playable_now + is_cc_play_legal_by_restriction
          unless force=True.
        - Moves the card from hand → discard.
        - Sets game.pendingCcEffect = {cardName, playerNum, timing,
          playableBy} so the downstream per-CC resolver (Phase 5-D) can
          apply the effect when it lands.
        - Stamps game.lastPlayedCc for triggers (whenCommandCardPlayed).

    Individual CC effects (game-state changes per-card) live in Phase 5-D
    batch work — this handler owns the common play-pipeline.
    """
    from python.engine.cards.deck import discard_from_hand, hand_size
    from python.engine.data.cc_effects_loader import get_cc_effect
    from python.engine.mechanics.cc_timing import (
        is_cc_play_legal_by_restriction,
        is_cc_playable_now,
    )

    player = int(action.player or 0)
    if player not in (1, 2):
        raise ValueError('play_cc requires player ∈ {1, 2}')

    card = action.params.get('card') or action.params.get('cardName')
    if not card or not isinstance(card, str):
        raise ValueError('play_cc requires card param (str)')

    hand_key = 'player1CcHand' if player == 1 else 'player2CcHand'
    hand = game.data.get(hand_key) or []
    if card not in hand:
        raise ValueError(f'play_cc: {card!r} not in P{player} hand')

    force = bool(action.params.get('force'))
    effect = get_cc_effect(card)
    if effect is None:
        raise ValueError(f'play_cc: unknown card {card!r}')

    if not force:
        if not is_cc_playable_now(game, player, card):
            raise ValueError(
                f'play_cc: {card!r} not playable now (timing={effect.get("timing")!r})'
            )
        verdict = is_cc_play_legal_by_restriction(game, player, card)
        if not verdict.get('legal'):
            raise ValueError(
                f'play_cc: {card!r} restriction fails — {verdict.get("reason")}'
            )

    # Move hand → discard
    moved = discard_from_hand(game, player, card)
    if not moved:
        # Shouldn't happen (we just checked); defensive
        raise ValueError(f'play_cc: failed to move {card!r} from hand')

    game.data['pendingCcEffect'] = {
        'cardName': card,
        'playerNum': player,
        'timing': effect.get('timing'),
        'playableBy': effect.get('playableBy'),
    }
    game.data['lastPlayedCc'] = {
        'cardName': card,
        'playerNum': player,
    }
    return game


register(ActionType.PLAY_CC, _handle_play_cc)


# ---------------------------------------------------------------------------
# DC Special Ability dispatch (P7 / P4-A)
# ---------------------------------------------------------------------------

def _handle_dc_special(game: GameState, action: Action) -> GameState:
    """Resolve a DC's special ability via the abilities dispatcher.

    Required params:
        figure_key (str) — the activating figure.
        special_idx (int) — index into dcEff.specialAbilityIds for the DC.

    Effects:
        - Looks up the DC's ability_id from dc-effects.json.
        - Calls abilities.dispatch.resolve(game, ability_id, ctx).
        - Stores the resolver result on game.lastDcSpecialResult for callers
          to inspect/log.

    Raises:
        ValueError: figure_key missing from board, special_idx out of range.
        UnknownAbility / PatternNotImplemented: propagated from dispatch.

    Note: action-cost decrement is NOT handled here (stepper doesn't yet
    model the dcActionsData.remaining field). Caller or a higher-level
    orchestrator owns that until the full DC activation flow ports.
    """
    from python.engine.abilities import dispatch as ability_dispatch
    from python.engine.data.dc_effects_loader import get_dc_effect

    figure_key = action.params.get('figure_key') or action.params.get('figureKey')
    special_idx = action.params.get('special_idx')
    if special_idx is None:
        special_idx = action.params.get('specialIdx')
    if not figure_key:
        raise ValueError('dc_special requires figure_key param')
    if not isinstance(special_idx, int) or special_idx < 0:
        raise ValueError('dc_special requires non-negative int special_idx param')

    player_num, pos = _find_figure(game, figure_key)
    if player_num is None:
        raise ValueError(f'dc_special: figure {figure_key!r} not on board')

    dc_name = _dc_name_from_figure_key(figure_key)
    effect = get_dc_effect(dc_name) or {}
    ability_ids = effect.get('specialAbilityIds') or []
    if special_idx >= len(ability_ids):
        raise ValueError(
            f'dc_special: special_idx {special_idx} out of range for '
            f'{dc_name!r} (has {len(ability_ids)} specials)'
        )

    ability_id = ability_ids[special_idx]
    ctx: Dict[str, Any] = {
        'figure_key': figure_key,
        'player_num': player_num,
        'dc_name': dc_name,
        'special_idx': special_idx,
    }
    try:
        idx = int(figure_key.rsplit('-', 1)[-1])
        ctx['figure_index'] = idx
    except (ValueError, AttributeError):
        pass

    result = ability_dispatch.resolve(game.data, ability_id, ctx)
    game.data['lastDcSpecialResult'] = {
        'abilityId': ability_id,
        'figureKey': figure_key,
        'playerNum': player_num,
        'result': result,
    }
    return game


register(ActionType.DC_SPECIAL, _handle_dc_special)


# ---------------------------------------------------------------------------
# END_START_OF_ROUND (P7)
# ---------------------------------------------------------------------------

def _handle_end_start_of_round(game: GameState, action: Action) -> GameState:
    """Close out the Start-of-Round window.

    JS flow (round.js): initiative player clicks "end SoR" first, which
    advances to the non-initiative player; they click → window ends. The
    Python stepper collapses this into a single transition (it doesn't
    model the mid-window handoff per-player).

    Effects:
        - Clear startOfRoundWhoseTurn (None → window closed).
        - Runs mission_rules.run_start_of_round_rules (if a mission is
          selected) — handles Cantina tokens, random reveals, crate tokens.
        - Transitions roundPhase → 'activation' when not already set.

    DC-specific SoR passives (Brush, Force Slow, Excavation, Shape/Shift)
    flow through their individual ability ports in Phase 4 — this handler
    owns the data-driven mission layer + the window-closure state change.
    """
    from python.engine.mechanics.mission_rules import run_start_of_round_rules
    from python.engine.data.dc_effects_loader import get_dc_effects

    data = game.data
    data['startOfRoundWhoseTurn'] = None

    selected = data.get('selectedMission') or {}
    if isinstance(selected, Mapping):
        variant = selected.get('variant') or 'a'
        map_id = data.get('mapId')
        if not map_id:
            selected_map = data.get('selectedMap') or {}
            map_id = selected_map.get('id') if isinstance(selected_map, Mapping) else None
        # Resolve mission rules lazily; they may be stashed on game or
        # looked up from mission-cards.json via a ctx-injected getter.
        rules = selected.get('rules') if isinstance(selected, Mapping) else None
        if isinstance(rules, Mapping):
            sor_rules = rules.get('startOfRound')
            if isinstance(sor_rules, Mapping):
                run_start_of_round_rules(game.data, map_id, variant, dict(sor_rules))

    if data.get('roundPhase') not in ('activation', 'end', 'game_over'):
        data['roundPhase'] = 'activation'

    return game


register(ActionType.END_START_OF_ROUND, _handle_end_start_of_round)


# ---------------------------------------------------------------------------
# Celebration (C-23 CC) — attacker chooses to play or pass after a kill
# ---------------------------------------------------------------------------

def _handle_celebration_play(game: GameState, action: Action) -> GameState:
    """Play Celebration from hand after defeating a hostile: +4 objective VP.

    Requires:
        - game.pendingCelebration present with attackerPlayerNum.
        - 'Celebration' in the attacker's hand.

    Effects:
        - Removes 'Celebration' from hand, pushes to discard.
        - Awards 4 objective VP to attackerPlayerNum.
        - Clears game.pendingCelebration.
    """
    from python.engine.cards.deck import discard_from_hand
    from python.engine.mechanics.vp_helpers import award_objective_vp

    pending = game.data.get('pendingCelebration')
    if not pending:
        raise ValueError('celebration_play: no pendingCelebration window open')
    attacker_pn = pending.get('attackerPlayerNum')
    if attacker_pn not in (1, 2):
        raise ValueError('celebration_play: pendingCelebration missing attackerPlayerNum')
    if not discard_from_hand(game, attacker_pn, 'Celebration'):
        raise ValueError('celebration_play: Celebration not in hand')
    award_objective_vp(game, attacker_pn, 4)
    game.data['pendingCelebration'] = None
    return game


def _handle_celebration_pass(game: GameState, action: Action) -> GameState:
    """Pass on the Celebration window — just clears pendingCelebration."""
    pending = game.data.get('pendingCelebration')
    if not pending:
        raise ValueError('celebration_pass: no pendingCelebration window open')
    game.data['pendingCelebration'] = None
    return game


register(ActionType.CELEBRATION_PLAY, _handle_celebration_play)
register(ActionType.CELEBRATION_PASS, _handle_celebration_pass)


# ---------------------------------------------------------------------------
# Cover Fire (CC response) — attacker picks a figure to receive 1 Block Token
# ---------------------------------------------------------------------------

def _handle_cover_fire_block(game: GameState, action: Action) -> GameState:
    """Cover Fire block-token grant — attacker picks a figure to receive 1 Block.

    Required param:
        figure_key (str) — the figure to receive the token.

    Effects:
        - grant_power_tokens(figure_key, 'Block', 1)
        - Clears game.pendingCoverFire
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    figure_key = action.params.get('figure_key') or action.params.get('figureKey')
    if not figure_key:
        raise ValueError('cover_fire_block requires figure_key param')
    if not game.data.get('pendingCoverFire'):
        raise ValueError('cover_fire_block: no pendingCoverFire window open')
    grant_power_tokens(game.data, figure_key, 'Block', 1)
    game.data['pendingCoverFire'] = None
    return game


def _handle_cover_fire_skip(game: GameState, action: Action) -> GameState:
    """Skip the Cover Fire window — just clears pending state."""
    if not game.data.get('pendingCoverFire'):
        raise ValueError('cover_fire_skip: no pendingCoverFire window open')
    game.data['pendingCoverFire'] = None
    return game


register(ActionType.COVER_FIRE_BLOCK, _handle_cover_fire_block)
register(ActionType.COVER_FIRE_SKIP, _handle_cover_fire_skip)


# ---------------------------------------------------------------------------
# Bo-Rifle mode pick (melee vs. ranged) — pre-attack decision window
# ---------------------------------------------------------------------------

def _handle_bo_rifle_use(game: GameState, action: Action) -> GameState:
    """Use Bo-Rifle in melee mode: swap attack dice to pendingBoRifle.meleeDice.

    Required params:
        msg_id (str) — DC message id (the Discord msgId for the attacking DC).
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    if not msg_id:
        raise ValueError('bo_rifle_use requires msg_id param')
    pending = game.data.get('pendingBoRifle') or {}
    entry = pending.get(msg_id)
    if not entry:
        raise ValueError(f'bo_rifle_use: no pendingBoRifle for msgId {msg_id!r}')
    melee_dice = entry.get('meleeDice') or []
    override = game.data.get('pendingOverrideAttackDice') or {}
    override[msg_id] = {'dice': list(melee_dice), 'type': 'melee'}
    game.data['pendingOverrideAttackDice'] = override
    del pending[msg_id]
    game.data['pendingBoRifle'] = pending if pending else None
    return game


def _handle_bo_rifle_skip(game: GameState, action: Action) -> GameState:
    """Skip Bo-Rifle melee mode: clear pendingBoRifle for the msgId."""
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    if not msg_id:
        raise ValueError('bo_rifle_skip requires msg_id param')
    pending = game.data.get('pendingBoRifle') or {}
    if msg_id in pending:
        del pending[msg_id]
    game.data['pendingBoRifle'] = pending if pending else None
    return game


register(ActionType.BO_RIFLE_USE, _handle_bo_rifle_use)
register(ActionType.BO_RIFLE_SKIP, _handle_bo_rifle_skip)


# ---------------------------------------------------------------------------
# EE-3 Carbine die-color upgrade pick
# ---------------------------------------------------------------------------

def _handle_ee3_pick_die(game: GameState, action: Action) -> GameState:
    """EE-3 Carbine: upgrade one attack die to red (2 MP cost).

    Required params:
        msg_id (str) — DC message id for the attacking DC.
        color (str) — die color to upgrade ('blue', 'green', 'yellow').
    Optional param:
        base_dice (list[str]) — the attacker's base attack dice list.
          Falls back to dc_effects.attack.dice when absent.

    Effects:
        - Deducts 2 MP from game.movementBank[msg_id].remaining (clamped).
        - Sets pendingOverrideAttackDice[msg_id] = {'dice': [...], 'type': 'range'}
          with the first `color` die swapped to 'red'.
        - Stamps pendingEe3Carbine[msg_id] = 'decided'.
    """
    from python.engine.data.dc_effects_loader import get_dc_effects

    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    color = action.params.get('color')
    if not msg_id or not color:
        raise ValueError('ee3_pick_die requires msg_id + color params')
    if color not in ('blue', 'green', 'yellow'):
        raise ValueError(
            f'ee3_pick_die: color must be blue|green|yellow, got {color!r}'
        )

    base_dice = action.params.get('base_dice') or action.params.get('baseDice')
    if base_dice is None:
        # Fall back to lookup via msgId → dcName
        dc_name = None
        for pn in (1, 2):
            msg_ids = game.data.get('p1DcMessageIds' if pn == 1 else 'p2DcMessageIds') or []
            dc_list = game.data.get('p1DcList' if pn == 1 else 'p2DcList') or []
            if msg_id in msg_ids:
                idx = msg_ids.index(msg_id)
                if idx < len(dc_list) and isinstance(dc_list[idx], Mapping):
                    dc_name = dc_list[idx].get('dcName')
                break
        if not dc_name:
            raise ValueError(f'ee3_pick_die: no DC found for msg_id {msg_id!r}')
        effect = (get_dc_effects() or {}).get(dc_name) or {}
        attack = effect.get('attack') or {}
        base_dice = list(attack.get('dice') or ['red'])
    else:
        base_dice = list(base_dice)

    # Deduct 2 MP
    bank_all = game.data.get('movementBank') or {}
    bank = bank_all.get(msg_id)
    if isinstance(bank, Mapping):
        bank_mut = dict(bank)
        bank_mut['remaining'] = max(0, int(bank_mut.get('remaining') or 0) - 2)
        bank_all[msg_id] = bank_mut
        game.data['movementBank'] = bank_all

    # Swap first matching die to red
    if color in base_dice:
        swap_idx = base_dice.index(color)
        base_dice[swap_idx] = 'red'

    override = game.data.get('pendingOverrideAttackDice') or {}
    override[msg_id] = {'dice': base_dice}
    game.data['pendingOverrideAttackDice'] = override

    pending = game.data.get('pendingEe3Carbine') or {}
    pending[msg_id] = 'decided'
    game.data['pendingEe3Carbine'] = pending

    return game


def _handle_ee3_pick_skip(game: GameState, action: Action) -> GameState:
    """Skip EE-3 die upgrade — just stamp pendingEe3Carbine[msgId] = 'decided'."""
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    if not msg_id:
        raise ValueError('ee3_pick_skip requires msg_id param')
    pending = game.data.get('pendingEe3Carbine') or {}
    pending[msg_id] = 'decided'
    game.data['pendingEe3Carbine'] = pending
    return game


register(ActionType.EE3_PICK_DIE, _handle_ee3_pick_die)
register(ActionType.EE3_PICK_SKIP, _handle_ee3_pick_skip)


# ---------------------------------------------------------------------------
# Spread the Pain — condition pick (stun / weaken / bleed / skip)
# ---------------------------------------------------------------------------

def _handle_spread_pain_cond(game: GameState, action: Action) -> GameState:
    """Spread the Pain: attacker picks a condition to apply post-combat.

    Required param:
        cond (str) — one of 'stun', 'weaken', 'bleed', 'skip'.

    Effects:
        - On non-skip: appends capitalized condition to
          game.pendingCombat.spreadThePainConditions.
        - Clears game.pendingSpreadThePainCondPick either way.
    """
    cond = str(action.params.get('cond') or '').lower()
    if cond not in ('stun', 'weaken', 'bleed', 'skip'):
        raise ValueError(
            f"spread_pain_cond: cond must be stun|weaken|bleed|skip, got {cond!r}"
        )
    if not game.data.get('pendingSpreadThePainCondPick'):
        raise ValueError('spread_pain_cond: no pending pick open')

    game.data['pendingSpreadThePainCondPick'] = None
    if cond != 'skip':
        combat = game.data.get('pendingCombat') or {}
        if isinstance(combat, Mapping):
            combat_mut = dict(combat)
            existing = list(combat_mut.get('spreadThePainConditions') or [])
            existing.append(cond.capitalize())
            combat_mut['spreadThePainConditions'] = existing
            game.data['pendingCombat'] = combat_mut
    return game


register(ActionType.SPREAD_PAIN_COND, _handle_spread_pain_cond)


# ---------------------------------------------------------------------------
# Overwatch token placement
# ---------------------------------------------------------------------------

def _handle_overwatch_space(game: GameState, action: Action) -> GameState:
    """Place an Overwatch token at chosen space for the given DC msgId.

    Required params:
        msg_id (str)
        space (str) — coord (will be lowercased)
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    space = action.params.get('space')
    if not msg_id or not space:
        raise ValueError('overwatch_space requires msg_id + space params')
    tokens = game.data.get('overwatchTokenPosition') or {}
    tokens[msg_id] = str(space).lower()
    game.data['overwatchTokenPosition'] = tokens
    pending = game.data.get('pendingOverwatchPlacement') or {}
    if msg_id in pending:
        del pending[msg_id]
        game.data['pendingOverwatchPlacement'] = pending if pending else None
    return game


register(ActionType.OVERWATCH_SPACE, _handle_overwatch_space)


# ---------------------------------------------------------------------------
# Pending-window cancels (CC confirm flow, Comm Disruption skip)
# ---------------------------------------------------------------------------

def _handle_cc_cancel_play(game: GameState, action: Action) -> GameState:
    """Cancel a pending CC play (clears game.pendingCcConfirmation)."""
    if not game.data.get('pendingCcConfirmation'):
        raise ValueError('cc_cancel_play: no pendingCcConfirmation open')
    game.data['pendingCcConfirmation'] = None
    return game


def _handle_comm_disruption_skip(game: GameState, action: Action) -> GameState:
    """Skip playing Comm Disruption — clears the prompt so the target CC resolves."""
    if not game.data.get('pendingCommDisruptionPrompt'):
        raise ValueError('comm_disruption_skip: no pendingCommDisruptionPrompt open')
    game.data['pendingCommDisruptionPrompt'] = None
    return game


register(ActionType.CC_CANCEL_PLAY, _handle_cc_cancel_play)
register(ActionType.COMM_DISRUPTION_SKIP, _handle_comm_disruption_skip)


# ---------------------------------------------------------------------------
# Shoulder Rush / Rush Push skip handlers (decline to push)
# ---------------------------------------------------------------------------

def _handle_rush_push_skip(game: GameState, action: Action) -> GameState:
    """Decline the Rush Push option — clears game.pendingRushPush."""
    if not game.data.get('pendingRushPush'):
        raise ValueError('rush_push_skip: no pendingRushPush open')
    game.data['pendingRushPush'] = None
    return game


def _handle_shoulder_rush_skip(game: GameState, action: Action) -> GameState:
    """Decline the Shoulder Rush option — clears game.pendingShoulderRush."""
    if not game.data.get('pendingShoulderRush'):
        raise ValueError('shoulder_rush_skip: no pendingShoulderRush open')
    game.data['pendingShoulderRush'] = None
    return game


def _handle_false_orders_skip(game: GameState, action: Action) -> GameState:
    """Skip False Orders — clears game.pendingFalseOrders."""
    if not game.data.get('pendingFalseOrders'):
        raise ValueError('false_orders_skip: no pendingFalseOrders open')
    game.data['pendingFalseOrders'] = None
    return game


def _handle_missile_salvo_done(game: GameState, action: Action) -> GameState:
    """Finish Missile Salvo die-reroll picks — clears game.pendingMissileSalvo."""
    if not game.data.get('pendingMissileSalvo'):
        raise ValueError('missile_salvo_done: no pendingMissileSalvo open')
    game.data['pendingMissileSalvo'] = None
    return game


register(ActionType.RUSH_PUSH_SKIP, _handle_rush_push_skip)
register(ActionType.SHOULDER_RUSH_SKIP, _handle_shoulder_rush_skip)
register(ActionType.FALSE_ORDERS_SKIP, _handle_false_orders_skip)
register(ActionType.MISSILE_SALVO_DONE, _handle_missile_salvo_done)


# ---------------------------------------------------------------------------
# POWER_TOKEN_CHOICE — player picks type for a pending token grant
# ---------------------------------------------------------------------------

_POWER_TOKEN_CHOICE_TYPES = frozenset({'Damage', 'Surge', 'Block', 'Evade'})


def _handle_power_token_choice(game: GameState, action: Action) -> GameState:
    """Resolve a pending power-token-grant: apply chosen token type to each figure.

    Required param:
        type (str) — one of 'Damage' | 'Surge' | 'Block' | 'Evade' (also
            accepts lowercase / 'hit' as alias for Damage).

    Consumes game.pendingPowerTokenGrant.grants (list of
    {figureKey, figName, count}); for each grant, calls
    grant_power_tokens(figureKey, type, count). Clears pendingPowerTokenGrant.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    raw = action.params.get('type') or action.params.get('tokenType')
    if not raw:
        raise ValueError('power_token_choice requires type param')
    type_lower = str(raw).lower()
    if type_lower == 'hit':
        type_lower = 'damage'
    token_type = type_lower.capitalize()
    if token_type not in _POWER_TOKEN_CHOICE_TYPES:
        raise ValueError(
            f'power_token_choice: type must be Damage|Surge|Block|Evade, got {raw!r}'
        )

    pending = game.data.get('pendingPowerTokenGrant')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('power_token_choice: no pendingPowerTokenGrant open')
    grants = pending.get('grants') or []
    for g in grants:
        if not isinstance(g, Mapping):
            continue
        fk = g.get('figureKey')
        count = int(g.get('count') or 0)
        if fk and count > 0:
            grant_power_tokens(game.data, fk, token_type, count)
    game.data['pendingPowerTokenGrant'] = None
    return game


register(ActionType.POWER_TOKEN_CHOICE, _handle_power_token_choice)


# ---------------------------------------------------------------------------
# COMM_DISRUPTION_PLAY — cancel a played CC by discarding Comm Disruption
# ---------------------------------------------------------------------------

def _handle_comm_disruption_play(game: GameState, action: Action) -> GameState:
    """Play Comm Disruption from hand to cancel the prompt-trigger CC.

    Requires:
        - game.pendingCommDisruptionPrompt present with targetPlayerNum.
        - 'Comm Disruption' in the target's hand.

    Effects:
        - Removes 'Comm Disruption' from the target's hand, pushes to discard.
        - Clears game.pendingCcEffect (the prompt-triggering card is cancelled).
        - Clears game.pendingCommDisruptionPrompt.
    """
    from python.engine.cards.deck import discard_from_hand

    pending = game.data.get('pendingCommDisruptionPrompt')
    if not pending:
        raise ValueError('comm_disruption_play: no pendingCommDisruptionPrompt open')
    target_pn = pending.get('targetPlayerNum') if isinstance(pending, Mapping) else None
    if target_pn not in (1, 2):
        raise ValueError(
            'comm_disruption_play: pendingCommDisruptionPrompt missing targetPlayerNum'
        )
    if not discard_from_hand(game, target_pn, 'Comm Disruption'):
        raise ValueError('comm_disruption_play: Comm Disruption not in hand')
    # Cancel the prompt-triggering CC's pending effect
    game.data['pendingCcEffect'] = None
    game.data['pendingCommDisruptionPrompt'] = None
    game.data['lastCancelledCc'] = {
        'cardName': pending.get('playedCard') if isinstance(pending, Mapping) else None,
        'byPlayerNum': target_pn,
    }
    return game


register(ActionType.COMM_DISRUPTION_PLAY, _handle_comm_disruption_play)


# ---------------------------------------------------------------------------
# DC_ABILITY_CHOICE — choose one of multiple options for a pending ability
# ---------------------------------------------------------------------------

def _handle_dc_ability_choice(game: GameState, action: Action) -> GameState:
    """Resolve a pending DC ability that required a chooseOne picker.

    Required params:
        msg_id (str) — DC message id.
        special_idx (int) — ability slot index.
        choice_index (int) — selected option from pendingDcAbilityChoice.choiceOptions.

    Looks up game.pendingDcAbilityChoice[f'{msg_id}_{special_idx}'] for the
    abilityId + playerNum + choiceOptions, dispatches through
    abilities.dispatch.resolve with the choice baked into ctx, then clears
    the pending entry.

    Records the dispatch result on game.lastDcAbilityChoiceResult.
    """
    from python.engine.abilities import dispatch as ability_dispatch

    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    special_idx = action.params.get('special_idx')
    if special_idx is None:
        special_idx = action.params.get('specialIdx')
    choice_index = action.params.get('choice_index')
    if choice_index is None:
        choice_index = action.params.get('choiceIndex')
    if not msg_id or not isinstance(special_idx, int) or not isinstance(choice_index, int):
        raise ValueError(
            'dc_ability_choice requires msg_id + int special_idx + int choice_index'
        )
    if choice_index < 0:
        raise ValueError('dc_ability_choice: choice_index must be non-negative')

    pending_map = game.data.get('pendingDcAbilityChoice') or {}
    key = f'{msg_id}_{special_idx}'
    pending = pending_map.get(key)
    if not pending:
        raise ValueError(
            f'dc_ability_choice: no pending choice for key {key!r}'
        )

    ability_id = pending.get('abilityId')
    player_num = pending.get('playerNum')
    choice_options = pending.get('choiceOptions') or []
    if choice_index >= len(choice_options):
        raise ValueError(
            f'dc_ability_choice: choice_index {choice_index} out of range '
            f'({len(choice_options)} options)'
        )
    target_figure_keys = pending.get('targetFigureKeys') or []
    target_fk = (
        target_figure_keys[choice_index]
        if 0 <= choice_index < len(target_figure_keys) else None
    )

    ctx: Dict[str, Any] = {
        'msg_id': msg_id,
        'special_idx': special_idx,
        'player_num': player_num,
        'choice_index': choice_index,
        'chosen_option': choice_options[choice_index],
        'target_figure_key': target_fk,
        'figure_index': pending.get('figureIndex'),
    }
    try:
        result = ability_dispatch.resolve(game.data, ability_id, ctx)
    except ability_dispatch.UnknownAbility:
        result = {'applied': False, 'reason': 'unknown_ability'}
    except ability_dispatch.PatternNotImplemented as e:
        result = {'applied': False, 'reason': 'pattern_not_implemented', 'message': str(e)}

    del pending_map[key]
    game.data['pendingDcAbilityChoice'] = pending_map if pending_map else None
    game.data['lastDcAbilityChoiceResult'] = {
        'abilityId': ability_id,
        'playerNum': player_num,
        'choiceIndex': choice_index,
        'result': result,
    }
    return game


register(ActionType.DC_ABILITY_CHOICE, _handle_dc_ability_choice)


# ---------------------------------------------------------------------------
# CC_CONFIRM_PLAY — confirm the pending CC from the hand-pick window
# ---------------------------------------------------------------------------

def _handle_cc_confirm_play(game: GameState, action: Action) -> GameState:
    """Resolve a pending CC confirmation: execute the play using PLAY_CC logic.

    Requires game.pendingCcConfirmation = {playerNum, card}. Paired with
    CC_CANCEL_PLAY (which simply clears the pending).

    Signal Jammer intercept: when game.signalJammerActive is set and the
    pending card is NOT 'Signal Jammer', both cards go to discard and the
    played card is cancelled — byte-identical to JS behavior.

    Otherwise delegates to the PLAY_CC pipeline (timing + restriction
    checks, hand → discard, set pendingCcEffect).
    """
    from python.engine.cards.deck import discard_from_hand

    pending = game.data.get('pendingCcConfirmation')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('cc_confirm_play: no pendingCcConfirmation open')
    player_num = pending.get('playerNum')
    card = pending.get('card')
    if player_num not in (1, 2) or not isinstance(card, str):
        raise ValueError(
            'cc_confirm_play: pendingCcConfirmation missing playerNum or card'
        )
    game.data['pendingCcConfirmation'] = None

    # Signal Jammer intercept
    sj = game.data.get('signalJammerActive')
    if sj and card != 'Signal Jammer':
        jammer_owner = sj.get('playerNum') if isinstance(sj, Mapping) else None
        game.data['signalJammerActive'] = None
        # Discard played card from player's hand
        discard_from_hand(game, player_num, card)
        # Discard Signal Jammer from jammer owner's hand
        if jammer_owner in (1, 2):
            discard_from_hand(game, jammer_owner, 'Signal Jammer')
        game.data['lastCancelledCc'] = {
            'cardName': card,
            'byPlayerNum': jammer_owner,
            'method': 'signal_jammer',
        }
        return game

    # Delegate to the PLAY_CC pipeline
    play_action = Action(
        type=ActionType.PLAY_CC, player=player_num,
        params={'card': card},
    )
    return _handle_play_cc(game, play_action)


register(ActionType.CC_CONFIRM_PLAY, _handle_cc_confirm_play)


# ---------------------------------------------------------------------------
# PLAY_CC_SPECIAL / PLAY_CC_DOUBLE — CC played from DC (special-action timing)
# ---------------------------------------------------------------------------

def _play_cc_from_dc(game: GameState, action: Action, *,
                     check_fn, timing_label: str) -> GameState:
    """Shared pipeline for DC-triggered CC plays (Special / Double Action).

    - Validates card is in the attacker's hand
    - Uses check_fn(cc_name, dc_name, display_name, darksaber, extra_kw, game)
      to enforce per-DC playability (timing + restrictions)
    - Moves hand → discard
    - Sets pendingCcEffect + lastPlayedCc
    """
    from python.engine.cards.deck import discard_from_hand
    from python.engine.data.cc_effects_loader import get_cc_effect
    from python.engine.mechanics.cc_timing import has_darksaber_imperial

    player = int(action.player or 0)
    if player not in (1, 2):
        raise ValueError(f'{timing_label} requires player ∈ {{1, 2}}')

    card = action.params.get('card') or action.params.get('cardName')
    dc_name = action.params.get('dc_name') or action.params.get('dcName')
    display_name = action.params.get('display_name') or action.params.get('displayName') or dc_name
    if not card or not dc_name:
        raise ValueError(f'{timing_label} requires card + dc_name params')

    hand_key = 'player1CcHand' if player == 1 else 'player2CcHand'
    hand = game.data.get(hand_key) or []
    if card not in hand:
        raise ValueError(f'{timing_label}: {card!r} not in P{player} hand')

    effect = get_cc_effect(card)
    if effect is None:
        raise ValueError(f'{timing_label}: unknown card {card!r}')

    if not action.params.get('force'):
        darksaber = has_darksaber_imperial(game, player, dc_name)
        if not check_fn(card, dc_name, display_name, darksaber, None, game):
            raise ValueError(
                f'{timing_label}: {card!r} not playable by {dc_name!r} '
                f'(timing + restriction gate failed)'
            )

    discard_from_hand(game, player, card)
    game.data['pendingCcEffect'] = {
        'cardName': card,
        'playerNum': player,
        'timing': effect.get('timing'),
        'playableBy': effect.get('playableBy'),
        'dcName': dc_name,
    }
    game.data['lastPlayedCc'] = {
        'cardName': card,
        'playerNum': player,
        'dcName': dc_name,
    }
    return game


def _handle_play_cc_special(game: GameState, action: Action) -> GameState:
    """Play a CC with specialAction timing, triggered from a DC."""
    from python.engine.mechanics.cc_timing import is_cc_playable_by_dc
    return _play_cc_from_dc(
        game, action, check_fn=is_cc_playable_by_dc,
        timing_label='play_cc_special',
    )


def _handle_play_cc_double(game: GameState, action: Action) -> GameState:
    """Play a CC with doubleActionSpecial timing, triggered from a DC."""
    from python.engine.mechanics.cc_timing import is_cc_double_action_playable_by_dc
    return _play_cc_from_dc(
        game, action, check_fn=is_cc_double_action_playable_by_dc,
        timing_label='play_cc_double',
    )


register(ActionType.PLAY_CC_SPECIAL, _handle_play_cc_special)
register(ActionType.PLAY_CC_DOUBLE, _handle_play_cc_double)


# ---------------------------------------------------------------------------
# SELECT_MAP (setup) — set selectedMap + selectedMission from missionId
# ---------------------------------------------------------------------------

def _handle_select_map(game: GameState, action: Action) -> GameState:
    """Pick a map + variant from a missionId string.

    Required param:
        mission_id (str) — 'mapId:variant' e.g. 'mos-eisley-outskirts:a'.
          Variant defaults to 'a' when omitted.

    Effects:
        - Sets game.selectedMap = {id, name} (imagePath omitted — Discord-only)
        - Sets game.selectedMission = {variant, name, fullName, tokenLabel,
          interactLabel, mechanics, rules}
        - Sets game.mapId for backwards-compat with existing handlers
        - Marks game.mapSelected = True

    Raises ValueError if map_id / variant unknown in mission-cards.json.
    """
    from python.engine.data.mission_cards_loader import get_mission

    mission_id = action.params.get('mission_id') or action.params.get('missionId')
    if not mission_id:
        raise ValueError('select_map requires mission_id param')
    parts = str(mission_id).split(':')
    map_id = parts[0]
    variant = parts[1] if len(parts) > 1 else 'a'
    if variant not in ('a', 'b'):
        raise ValueError(f'select_map: variant must be a|b, got {variant!r}')

    mission_data = get_mission(map_id, variant)
    if not mission_data:
        raise ValueError(
            f'select_map: no mission data for {map_id!r}:{variant!r}'
        )

    game.data['selectedMap'] = {'id': map_id, 'name': mission_data.get('name') or map_id}
    game.data['selectedMission'] = {
        'variant': variant,
        'name': mission_data.get('name'),
        'fullName': f"{mission_data.get('name') or map_id}",
        'tokenLabel': mission_data.get('tokenLabel') or '',
        'interactLabel': mission_data.get('interactLabel') or '',
        'mechanics': mission_data.get('mechanics') or {},
        'rules': mission_data.get('rules') or {},
    }
    game.data['mapId'] = map_id
    game.data['mapSelected'] = True
    return game


register(ActionType.SELECT_MAP, _handle_select_map)


# ---------------------------------------------------------------------------
# PICK_ZONE (setup) — deployment zone color pick
# ---------------------------------------------------------------------------

def _handle_pick_zone(game: GameState, action: Action) -> GameState:
    """Initiative player picks which deployment zone color they get.

    Required param: zone (str) ∈ {'red', 'blue'}.

    Sets game.deploymentZoneChosen. The opposite color automatically goes
    to the non-initiative player via get_player_deployment_zones.
    """
    zone = str(action.params.get('zone') or '').lower()
    if zone not in ('red', 'blue'):
        raise ValueError(f"pick_zone: zone must be 'red' or 'blue', got {zone!r}")
    game.data['deploymentZoneChosen'] = zone
    return game


register(ActionType.PICK_ZONE, _handle_pick_zone)


# ---------------------------------------------------------------------------
# DETERMINE_INITIATIVE (setup) — random tiebreaker, or pick cheaper squad
# ---------------------------------------------------------------------------

def _handle_determine_initiative(game: GameState, action: Action) -> GameState:
    """Set the initiative player.

    Required param:
        player (int) ∈ {1, 2} — the player with initiative.
          (CRR Skirmish-Setup Step 2: lower-cost squad chooses; ties broken
          randomly. The stepper takes the decision as input rather than
          re-deriving it.)

    Effects:
        - Sets game.initiativePlayerId to player1Id or player2Id.
        - Sets game.initiativeHolder = player (used by headless flow).
    """
    player = int(action.params.get('player') or 0)
    if player not in (1, 2):
        raise ValueError('determine_initiative requires player ∈ {1, 2}')
    pid_key = 'player1Id' if player == 1 else 'player2Id'
    game.data['initiativePlayerId'] = game.data.get(pid_key)
    game.data['initiativeHolder'] = player
    return game


register(ActionType.DETERMINE_INITIATIVE, _handle_determine_initiative)


# ---------------------------------------------------------------------------
# SUBMIT_SQUAD (setup) — player submits their deck for the game
# ---------------------------------------------------------------------------

def _handle_submit_squad(game: GameState, action: Action) -> GameState:
    """Attach a player's squad (dcList + ccList) to the game.

    Required params:
        player (int) ∈ {1, 2}
        squad (dict) — {name, dcList, ccList, ...} shape, stored as-is.
    """
    player = int(action.player or 0)
    if player == 0:
        player = int(action.params.get('player') or 0)
    if player not in (1, 2):
        raise ValueError('submit_squad requires player ∈ {1, 2}')

    squad = action.params.get('squad')
    if not isinstance(squad, Mapping):
        raise ValueError('submit_squad requires squad (dict) param')

    key = 'player1Squad' if player == 1 else 'player2Squad'
    game.data[key] = dict(squad)
    return game


register(ActionType.SUBMIT_SQUAD, _handle_submit_squad)


# ---------------------------------------------------------------------------
# DEPLOY_DONE (setup) — player signals they've finished deploying
# ---------------------------------------------------------------------------

def _handle_deploy_done(game: GameState, action: Action) -> GameState:
    """Mark a player as done deploying.

    Required: action.player ∈ {1, 2}. Sets initiativePlayerDeployed when
    the player is the initiative holder, otherwise
    nonInitiativePlayerDeployed. When both are set, also sets
    game.deploymentComplete = True.
    """
    player = int(action.player or 0)
    if player not in (1, 2):
        raise ValueError('deploy_done requires player ∈ {1, 2}')
    init_holder = game.data.get('initiativeHolder')
    if init_holder is None:
        # Fall back to deriving from initiativePlayerId
        init_pid = game.data.get('initiativePlayerId')
        init_holder = 1 if init_pid and init_pid == game.data.get('player1Id') else 2

    if player == init_holder:
        game.data['initiativePlayerDeployed'] = True
    else:
        game.data['nonInitiativePlayerDeployed'] = True

    if (game.data.get('initiativePlayerDeployed')
            and game.data.get('nonInitiativePlayerDeployed')):
        game.data['deploymentComplete'] = True
    return game


register(ActionType.DEPLOY_DONE, _handle_deploy_done)


# ---------------------------------------------------------------------------
# DRAW_CC (setup) — player's initial starting-hand draw
# ---------------------------------------------------------------------------

def _handle_draw_cc(game: GameState, action: Action) -> GameState:
    """Shuffle-and-draw starting hand for a player (setup-phase initial draw).

    Required param: player ∈ {1, 2}.
    Optional params:
        starting_size (int, default 3) — cards to draw initially.
        rng_seed (int) — seeds shuffle determinism.

    Effects:
        - Reads squad.ccList, filters out cards placed as attachments (via
          p{n}CcAttachments), shuffles the remainder, sets as the deck.
        - Draws starting_size cards from top into hand.
        - Stamps p{n}CcDrawn = True (ccDrawnKey).

    Raises ValueError if the player hasn't submitted a squad yet or the
    starting hand has already been drawn.
    """
    from python.engine.cards.deck import draw_cc_cards, shuffle_deck
    from python.engine.mechanics.player_helpers import (
        cc_attachments_key,
        cc_deck_key,
        cc_drawn_key,
    )

    player = int(action.player or 0)
    if player not in (1, 2):
        raise ValueError('draw_cc requires player ∈ {1, 2}')
    drawn_key = cc_drawn_key(player)
    if game.data.get(drawn_key):
        raise ValueError('draw_cc: starting hand already drawn')

    squad = game.data.get('player1Squad' if player == 1 else 'player2Squad')
    if not isinstance(squad, Mapping):
        raise ValueError(f'draw_cc: no squad submitted for player {player}')
    cc_list = squad.get('ccList') or []
    if not isinstance(cc_list, list):
        raise ValueError('draw_cc: squad.ccList must be a list')

    attach_key = cc_attachments_key(player)
    attach_map = game.data.get(attach_key) or {}
    placed: List[str] = []
    for attached in attach_map.values():
        if isinstance(attached, list):
            placed.extend(attached)

    deck = [c for c in cc_list if c not in placed]
    game.data[cc_deck_key(player)] = deck

    seed = action.params.get('rng_seed')
    rng = _random.Random(int(seed)) if seed is not None else None
    shuffle_deck(game, player, rng=rng)

    starting_size = int(action.params.get('starting_size', 3))
    if starting_size < 0:
        raise ValueError('draw_cc: starting_size must be non-negative')
    drew = draw_cc_cards(game, player, starting_size)
    game.data[drawn_key] = True
    game.data['lastCcDraw'] = {'playerNum': player, 'cards': drew}
    return game


register(ActionType.DRAW_CC, _handle_draw_cc)
