"""D10 slice 6a — legal-action enumeration + policy-index bijection.

Given a GameState, `legal_actions(game)` returns the set of Action
objects the current active player may take. The stepper's implemented
surface defines the set: move picks (per reachable cell), attacks (per
in-range enemy), activation starts (per own figure with activations
available), and the universal control actions (end activation, pass,
end phase, end round).

Every legal Action also maps to a stable index in the CNN's policy
output via `action_to_policy_index(action, game)`. The MCTS layer uses
these indices to read priors from the CNN and to build the visit-count
target vector for training.

Policy-index layout (n_policy = 4096, see python/net/skirbo_cnn.py):
    0..1023   MOVE_PICK_SPACE  (row*W + col)
    1024..1055 ATTACK_TARGET   (target_idx within sorted opp roster)
    1056..1087 ACTIVATE_DC     (figure_idx within sorted own roster)
    1088      DC_END_ACTIVATION
    1089      PASS_ACTIVATION_TURN
    1090      END_ACTIVATION_PHASE
    1091      END_END_OF_ROUND
    1092..    reserved (future actions)
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from python.encoding.encode import H as BOARD_H, W as BOARD_W
from python.engine.actions import ActionType
from python.engine.data.dc_effects_loader import get_dc_effect
from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.mechanics.adjacency import is_chebyshev_adjacent
from python.engine.mechanics.los import has_line_of_sight
from python.engine.mechanics.movement_cache import get_reachable_spaces
from python.engine.state import GameState
from python.engine.stepper import Action


# Policy-index layout.
_MOVE_BASE = 0
_MOVE_SPAN = BOARD_H * BOARD_W          # 1024

_ATTACK_BASE = _MOVE_BASE + _MOVE_SPAN  # 1024
_ATTACK_SPAN = 32

_ACTIVATE_BASE = _ATTACK_BASE + _ATTACK_SPAN  # 1056
_ACTIVATE_SPAN = 32

_IDX_DC_END_ACTIVATION = _ACTIVATE_BASE + _ACTIVATE_SPAN    # 1088
_IDX_PASS_ACTIVATION_TURN = _IDX_DC_END_ACTIVATION + 1      # 1089
_IDX_END_ACTIVATION_PHASE = _IDX_DC_END_ACTIVATION + 2      # 1090
_IDX_END_END_OF_ROUND = _IDX_DC_END_ACTIVATION + 3          # 1091

POLICY_INDEX_FIRST_RESERVED = _IDX_END_END_OF_ROUND + 1     # 1092


# ---------------------------------------------------------------------------
# Coord helpers
# ---------------------------------------------------------------------------

def _coord_to_xy(coord: str) -> Tuple[int, int]:
    col_ch = coord[0].lower()
    row = int(coord[1:])
    return (row - 1, ord(col_ch) - ord('a'))


def _xy_to_coord(y: int, x: int) -> str:
    return f'{chr(ord("a") + x)}{y + 1}'


def _coord_policy_index(coord: str) -> int:
    y, x = _coord_to_xy(coord)
    if y < 0 or y >= BOARD_H or x < 0 or x >= BOARD_W:
        raise ValueError(f'coord {coord!r} outside policy grid')
    return _MOVE_BASE + y * BOARD_W + x


# ---------------------------------------------------------------------------
# Roster helpers (stable sort so indices are deterministic)
# ---------------------------------------------------------------------------

def _sorted_figures(game: GameState, player: int) -> List[Tuple[str, str]]:
    """Return [(figure_key, coord)] for `player`, sorted by figure_key."""
    fp = game.get('figurePositions') or {}
    if not isinstance(fp, Mapping):
        return []
    positions = fp.get(player, fp.get(str(player), {}))
    if not isinstance(positions, Mapping):
        return []
    return sorted(
        ((k, v) for k, v in positions.items() if isinstance(v, str) and v),
        key=lambda p: p[0],
    )


def _dc_name_from_figure_key(figure_key: str) -> str:
    parts = figure_key.rsplit('-', 2)
    return parts[0] if len(parts) == 3 else figure_key


def _occupied_cells(game: GameState, exclude: Optional[str] = None) -> List[str]:
    out: List[str] = []
    fp = game.get('figurePositions') or {}
    if not isinstance(fp, Mapping):
        return out
    for _, positions in fp.items():
        if not isinstance(positions, Mapping):
            continue
        for fkey, coord in positions.items():
            if fkey == exclude or not isinstance(coord, str) or not coord:
                continue
            out.append(coord)
    return out


# ---------------------------------------------------------------------------
# Legal-action enumeration
# ---------------------------------------------------------------------------

def _activated_group_prefixes(game: GameState, player: int) -> set:
    """Return {'DC-groupIdx-'} for deployment groups whose figures have
    all used up their activation (simple approximation: the group has
    attacked at least once and no figures of the group have un-attacked
    remaining; for MVP treat ANY group whose first figure is in
    figureAttacksThisActivation as activated)."""
    attacks = game.get('figureAttacksThisActivation') or {}
    patk = attacks.get(player, attacks.get(str(player), {})) if isinstance(attacks, Mapping) else {}
    out = set()
    if isinstance(patk, Mapping):
        for fkey in patk:
            parts = fkey.rsplit('-', 2)
            if len(parts) == 3:
                out.add(f'{parts[0]}-{parts[1]}-')
    return out


def legal_actions(game: GameState) -> List[Action]:
    """Enumerate legal actions for the current active player.

    The returned Actions are ready to pass to `stepper.step`.
    """
    if game.get('phase') == 'game_over':
        return []

    round_phase = game.get('roundPhase')
    if round_phase == 'end':
        return [Action(type=ActionType.END_END_OF_ROUND, player=0)]

    active = int(game.get('activePlayer') or 1)
    rem = game.get('activationsRemaining') or {}
    rem_active = 0
    rem_other = 0
    if isinstance(rem, Mapping):
        rem_active = int(rem.get(active, rem.get(str(active), 0)) or 0)
        other = 2 if active == 1 else 1
        rem_other = int(rem.get(other, rem.get(str(other), 0)) or 0)

    active_keys = game.get('activeFigureKeys') or []

    # Case: a figure is mid-activation — move / attack / end-activation.
    if active_keys:
        out: List[Action] = [Action(type=ActionType.DC_END_ACTIVATION, player=active)]
        figure_key = active_keys[0]
        figures = _sorted_figures(game, active)
        coord_map = dict(figures)
        start_coord = coord_map.get(figure_key)
        if not start_coord:
            return out
        mp = int(game.get('movementPoints') or 0)
        map_id = game.get('mapId') or game.get('selectedMap')
        map_spaces = get_map_spaces(map_id) if map_id else {}
        if mp > 0 and map_spaces:
            occ = _occupied_cells(game, exclude=figure_key)
            reachable = get_reachable_spaces(start_coord, mp, map_spaces, occ)
            for coord in reachable:
                if coord != start_coord:
                    out.append(Action(
                        type=ActionType.MOVE_PICK_SPACE,
                        player=active,
                        params={'coord': coord, 'figure_key': figure_key},
                    ))

        # Attacks — one per activation.
        attacks = game.get('figureAttacksThisActivation') or {}
        pa = attacks.get(active, attacks.get(str(active), {})) if isinstance(attacks, Mapping) else {}
        already_attacked = isinstance(pa, Mapping) and pa.get(figure_key, 0) >= 1
        if not already_attacked:
            atk_dc = _dc_name_from_figure_key(figure_key)
            atk_effect = get_dc_effect(atk_dc) or {}
            spec = atk_effect.get('attack') or {}
            attack_type = (spec.get('type') or 'range').lower()
            opp = 2 if active == 1 else 1
            opp_figs = _sorted_figures(game, opp)
            for tgt_key, tgt_coord in opp_figs:
                if attack_type == 'melee':
                    if not is_chebyshev_adjacent(start_coord, tgt_coord):
                        continue
                else:
                    if not map_spaces or not has_line_of_sight(
                        start_coord, tgt_coord, map_spaces,
                    ):
                        continue
                out.append(Action(
                    type=ActionType.ATTACK_TARGET,
                    player=active,
                    params={'attacker_key': figure_key, 'target_key': tgt_key},
                ))
        return out

    # Case: no active figure — choose which to activate, or pass / end phase.
    out2: List[Action] = []
    if rem_active > 0:
        used_prefixes = _activated_group_prefixes(game, active)
        own_figs = _sorted_figures(game, active)
        seen_groups = set()
        for fkey, _ in own_figs:
            parts = fkey.rsplit('-', 2)
            if len(parts) != 3:
                continue
            group_prefix = f'{parts[0]}-{parts[1]}-'
            if group_prefix in used_prefixes or group_prefix in seen_groups:
                continue
            seen_groups.add(group_prefix)
            out2.append(Action(
                type=ActionType.ACTIVATE_DC, player=active,
                params={'figure_key': fkey},
            ))
        # Pass turn is legal when the opponent still has activations — it
        # lets the initiative-holder stall. If opponent has zero, the
        # current player must activate or end phase.
        if rem_other > 0:
            out2.append(Action(type=ActionType.PASS_ACTIVATION_TURN, player=active))
    if rem_active == 0 and rem_other == 0:
        out2.append(Action(type=ActionType.END_ACTIVATION_PHASE, player=active))
    return out2


# ---------------------------------------------------------------------------
# Action <-> policy-index bijection
# ---------------------------------------------------------------------------

def action_to_policy_index(action: Action, game: GameState) -> int:
    """Map `action` to its slot in the CNN policy logits.

    Raises ValueError if the action isn't expressible in the current
    policy layout (e.g. an ATTACK_TARGET against a non-enumerated target
    or a roster with >32 figures).
    """
    t = action.type
    if t == ActionType.MOVE_PICK_SPACE:
        coord = action.params.get('coord')
        if not isinstance(coord, str) or not coord:
            raise ValueError('MOVE_PICK_SPACE missing coord')
        return _coord_policy_index(coord)
    if t == ActionType.ATTACK_TARGET:
        target_key = action.params.get('target_key') or action.params.get('targetKey')
        if not target_key:
            raise ValueError('ATTACK_TARGET missing target_key')
        opp = 2 if action.player == 1 else 1
        opp_figs = _sorted_figures(game, opp)
        for i, (fk, _) in enumerate(opp_figs):
            if fk == target_key:
                if i >= _ATTACK_SPAN:
                    raise ValueError(f'target index {i} exceeds ATTACK span')
                return _ATTACK_BASE + i
        raise ValueError(f'ATTACK_TARGET target {target_key!r} not in opp roster')
    if t == ActionType.ACTIVATE_DC:
        figure_key = action.params.get('figure_key') or action.params.get('figureKey')
        if not figure_key:
            raise ValueError('ACTIVATE_DC missing figure_key')
        own_figs = _sorted_figures(game, action.player)
        for i, (fk, _) in enumerate(own_figs):
            if fk == figure_key:
                if i >= _ACTIVATE_SPAN:
                    raise ValueError(f'figure index {i} exceeds ACTIVATE span')
                return _ACTIVATE_BASE + i
        raise ValueError(f'ACTIVATE_DC figure {figure_key!r} not on own roster')
    if t == ActionType.DC_END_ACTIVATION:
        return _IDX_DC_END_ACTIVATION
    if t == ActionType.PASS_ACTIVATION_TURN:
        return _IDX_PASS_ACTIVATION_TURN
    if t == ActionType.END_ACTIVATION_PHASE:
        return _IDX_END_ACTIVATION_PHASE
    if t == ActionType.END_END_OF_ROUND:
        return _IDX_END_END_OF_ROUND
    raise ValueError(f'no policy-index mapping for {t.value}')


def policy_index_to_action(idx: int, game: GameState) -> Action:
    """Inverse of action_to_policy_index — rebuilds an Action from an
    index + the current state (needed to resolve figure-key references).
    Raises ValueError if idx isn't legal in this state.
    """
    active = int(game.get('activePlayer') or 1)
    if _MOVE_BASE <= idx < _MOVE_BASE + _MOVE_SPAN:
        off = idx - _MOVE_BASE
        y, x = divmod(off, BOARD_W)
        coord = _xy_to_coord(y, x)
        active_keys = game.get('activeFigureKeys') or []
        figure_key = active_keys[0] if active_keys else None
        params = {'coord': coord}
        if figure_key:
            params['figure_key'] = figure_key
        return Action(type=ActionType.MOVE_PICK_SPACE, player=active, params=params)
    if _ATTACK_BASE <= idx < _ATTACK_BASE + _ATTACK_SPAN:
        opp = 2 if active == 1 else 1
        opp_figs = _sorted_figures(game, opp)
        off = idx - _ATTACK_BASE
        if off >= len(opp_figs):
            raise ValueError(f'attack index {off} out of roster (size {len(opp_figs)})')
        target_key = opp_figs[off][0]
        active_keys = game.get('activeFigureKeys') or []
        if not active_keys:
            raise ValueError('attack index but no active figure')
        return Action(
            type=ActionType.ATTACK_TARGET, player=active,
            params={'attacker_key': active_keys[0], 'target_key': target_key},
        )
    if _ACTIVATE_BASE <= idx < _ACTIVATE_BASE + _ACTIVATE_SPAN:
        own_figs = _sorted_figures(game, active)
        off = idx - _ACTIVATE_BASE
        if off >= len(own_figs):
            raise ValueError(f'activate index {off} out of roster (size {len(own_figs)})')
        return Action(
            type=ActionType.ACTIVATE_DC, player=active,
            params={'figure_key': own_figs[off][0]},
        )
    if idx == _IDX_DC_END_ACTIVATION:
        return Action(type=ActionType.DC_END_ACTIVATION, player=active)
    if idx == _IDX_PASS_ACTIVATION_TURN:
        return Action(type=ActionType.PASS_ACTIVATION_TURN, player=active)
    if idx == _IDX_END_ACTIVATION_PHASE:
        return Action(type=ActionType.END_ACTIVATION_PHASE, player=active)
    if idx == _IDX_END_END_OF_ROUND:
        return Action(type=ActionType.END_END_OF_ROUND, player=0)
    raise ValueError(f'policy index {idx} not mapped')


def legal_action_mask(game: GameState, n_policy: int) -> List[bool]:
    """Return a len-`n_policy` bool list — True for indices of legal actions."""
    mask = [False] * n_policy
    for action in legal_actions(game):
        try:
            idx = action_to_policy_index(action, game)
        except ValueError:
            continue
        if 0 <= idx < n_policy:
            mask[idx] = True
    return mask
