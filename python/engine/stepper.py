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

from python.engine.actions import ActionType
from python.engine.data.dc_effects_loader import get_dc_effect
from python.engine.data.map_spaces_loader import get_map_spaces
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


register(ActionType.PASS_ACTIVATION_TURN, _handle_pass_activation_turn)
register(ActionType.END_ACTIVATION_PHASE, _handle_end_activation_phase)
register(ActionType.ACTIVATE_DC, _handle_activate_dc)
register(ActionType.DC_END_ACTIVATION, _handle_dc_end_activation)
register(ActionType.MOVE_PICK_SPACE, _handle_move_pick_space)
