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
from python.engine.mechanics.interrupts import detect_post_move_interrupts
from python.engine.mechanics.los import has_line_of_sight
from python.engine.mechanics.movement_cache import get_path_cost
from python.engine.mechanics.win_conditions import check_win_conditions
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

    # Multi-figure group: activate every figure in the same group so they
    # can all move/attack this activation. Group identity is derived from
    # the figure-key's DC-name + group-index prefix.
    from python.engine.mechanics.figure_lookup import parse_figure_key as _pfk
    parsed_init = _pfk(figure_key)
    group_figs = [figure_key]
    all_figs = (game.data.get('figurePositions') or {}).get(player, {})
    if parsed_init is not None:
        grp_name, grp_idx, _ = parsed_init
        for fk in all_figs.keys():
            if fk == figure_key:
                continue
            p = _pfk(fk)
            if p is None:
                continue
            if p[0] == grp_name and p[1] == grp_idx:
                group_figs.append(fk)

    game['activeFigureKeys'] = group_figs
    game['activePlayer'] = player

    starts = dict(game.get('activationStartPositions') or {})
    pstarts = dict(starts.get(player, starts.get(str(player), {})))
    for fk in group_figs:
        fk_coord = coord if fk == figure_key else all_figs.get(fk)
        if fk_coord:
            pstarts[fk] = fk_coord
    starts[player] = pstarts
    game['activationStartPositions'] = starts

    # Per-figure MP pool for multi-figure groups. Each figure gets its
    # own MP so they don't share a global bank. `movementPoints` stays
    # as the "first figure" pool for backward compatibility with any
    # code that reads it.
    per_fig_mp: Dict[str, int] = {}
    for fk in group_figs:
        per_fig_mp[fk] = 0  # filled with speed below

    dc_name = _dc_name_from_figure_key(figure_key)
    effect = get_dc_effect(dc_name) or {}
    speed = effect.get('speed')
    if not isinstance(speed, (int, float)):
        speed = 4
    mp = int(speed)

    # Pull bonus MP from movementBank[msg_id] if the figure's DC has a
    # message-id entry. Covers abilities like Lift Off (freeMoveBonus=4)
    # and CCs like On the Lam / Close the Gap.
    from python.engine.mechanics.figure_lookup import parse_figure_key
    dc_list_key = 'p1DcList' if player == 1 else 'p2DcList'
    msg_ids_key = 'p1DcMessageIds' if player == 1 else 'p2DcMessageIds'
    dc_list = game.get(dc_list_key) or []
    msg_ids = game.get(msg_ids_key) or []
    parsed = parse_figure_key(figure_key)
    if parsed is not None:
        tname, tgroup, _ = parsed
        for i, dc in enumerate(dc_list):
            if not isinstance(dc, Mapping):
                continue
            if (dc.get('dcName') == tname
                    and int(dc.get('dgIndex') or 0) == tgroup
                    and i < len(msg_ids)):
                msg_id_cur = msg_ids[i]
                bank_all = dict(game.get('movementBank') or {})
                entry = bank_all.get(msg_id_cur)
                if isinstance(entry, Mapping):
                    bonus = int(entry.get('remaining') or 0)
                    if bonus > 0:
                        mp += bonus
                        bank_all[msg_id_cur] = {
                            **entry, 'remaining': 0,
                        }
                        game['movementBank'] = bank_all
                break
    game['movementPoints'] = mp
    # Copy the same MP to every figure in the group (they each get a
    # fresh speed pool).
    for fk in group_figs:
        per_fig_mp[fk] = mp
    game['perFigureMp'] = per_fig_mp

    # Clear per-activation damage counter for this figure.
    dmg = dict(game.get('figureDamageThisActivation') or {})
    pdmg = dict(dmg.get(player, dmg.get(str(player), {})))
    pdmg.pop(figure_key, None)
    dmg[player] = pdmg
    game['figureDamageThisActivation'] = dmg

    return game


def _handle_dc_end_activation(game: GameState, action: Action) -> GameState:
    """End the current figure's activation.

    For multi-figure groups: advances to the next figure in the group
    (pops the leader off activeFigureKeys, updates global MP to the
    next figure's pool). When no more figures remain, ends the whole
    group activation and alternates player.
    """
    active_keys = list(game.get('activeFigureKeys') or [])
    if len(active_keys) > 1:
        # Multi-figure group: advance to next figure.
        active_keys.pop(0)
        game['activeFigureKeys'] = active_keys
        per_mp = game.get('perFigureMp') or {}
        next_fk = active_keys[0]
        game['movementPoints'] = int(per_mp.get(next_fk, 0) or 0)
        return game
    # Single figure (or last figure in a group): end group activation.
    game['activeFigureKeys'] = []
    game['movementPoints'] = 0
    game['perFigureMp'] = None
    active = int(game.get('activePlayer') or 1)
    game['activePlayer'] = 2 if active == 1 else 1
    # Auto-skip any unresolved move interrupts at end of activation.
    # In the Discord flow, the non-active player would have reacted
    # button-by-button; headless AI skips them so they don't accumulate.
    game['pendingInterrupts'] = []
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

    # Prefer per-figure MP for multi-figure groups; fall back to global
    # movementPoints for single-figure activations.
    per_mp_map = game.get('perFigureMp') or {}
    if figure_key in per_mp_map:
        mp = int(per_mp_map[figure_key] or 0)
    else:
        mp = int(game.get('movementPoints') or 0)
    map_id = game.get('mapId')
    map_spaces = get_map_spaces(map_id)
    if not map_spaces:
        raise ValueError(f'move_pick_space: no map spaces for mapId={map_id!r}')

    # Resolve this figure's msg_id to check mobileMovementActive.
    from python.engine.mechanics.figure_lookup import parse_figure_key
    mm_active_map = game.get('mobileMovementActive') or {}
    mobile_active = False
    if mm_active_map:
        dc_list_key = 'p1DcList' if player == 1 else 'p2DcList'
        msg_ids_key = 'p1DcMessageIds' if player == 1 else 'p2DcMessageIds'
        dc_list = game.get(dc_list_key) or []
        msg_ids = game.get(msg_ids_key) or []
        parsed = parse_figure_key(figure_key)
        if parsed is not None:
            tname, tgroup, _ = parsed
            for i, dc in enumerate(dc_list):
                if not isinstance(dc, Mapping):
                    continue
                if (dc.get('dcName') == tname
                        and int(dc.get('dgIndex') or 0) == tgroup
                        and i < len(msg_ids)):
                    if msg_ids[i] in mm_active_map:
                        mobile_active = True
                    break

    # Mobile movement ignores blocking figures (empty occupied_set).
    occupied = [] if mobile_active else _occupied_cells(game, exclude_key=figure_key)
    cost = get_path_cost(start_coord, coord, map_spaces, occupied)
    if cost == float('inf'):
        raise ValueError(f'move_pick_space: {coord} unreachable from {start_coord}')
    if cost > mp:
        raise ValueError(
            f'move_pick_space: insufficient MP (need {cost}, have {mp})'
        )

    new_mp = mp - int(cost)
    # Update per-figure MP; sync global for single-figure compat.
    if per_mp_map:
        per_mp_map = dict(per_mp_map)
        per_mp_map[figure_key] = new_mp
        game['perFigureMp'] = per_mp_map
    game['movementPoints'] = new_mp

    fp = dict(game.get('figurePositions') or {})
    ppos = dict(fp.get(player, fp.get(str(player), {})))
    ppos[figure_key] = coord
    fp[player] = ppos
    game['figurePositions'] = fp

    moved = list(game.get('figuresMovedThisRound') or [])
    if figure_key not in moved:
        moved.append(figure_key)
    game['figuresMovedThisRound'] = moved

    # Post-move interrupt detection: Parting Blow / Dirty Trick / Disengage /
    # Overwatch. Each trigger is a pending choice for the reacting player.
    triggers = detect_post_move_interrupts(
        game, player, figure_key, [start_coord, coord]
    )
    if triggers:
        pending = list(game.get('pendingInterrupts') or [])
        pending.extend(triggers)
        game['pendingInterrupts'] = pending

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
        orchestrated (bool): when True, route through the full combat
            orchestrator (Pattern D triggers, Focus/Hide consumption,
            reroll window, token spends, post-defeat triggers). When
            False (default), use the lightweight MVP path below.
        surge_spends, attacker_rerolls, defender_rerolls, spent_tokens:
            forwarded to the orchestrator when orchestrated=True.

    Scope (MVP):
        - Validates adjacency for melee, LOS for range.
        - No surges spent (surges contribute 0 to the attack).
        - No rerolls, no cover, no Hide/Focus condition effects.
        - Tracks figureAttacksThisActivation; one attack per activation.
        - On defeat: removes figure, awards kill VP (+ Jabba bonus).
    """
    if action.params.get('orchestrated'):
        from python.engine.mechanics.attack_orchestrator import orchestrate_attack
        attacker_key = (
            action.params.get('attacker_key') or action.params.get('attackerKey')
        )
        target_key = (
            action.params.get('target_key') or action.params.get('targetKey')
        )
        if not attacker_key or not target_key:
            raise ValueError(
                'attack_target requires attacker_key and target_key',
            )
        seed = action.params.get('rng_seed')
        rng = _random.Random(seed) if seed is not None else None
        result = orchestrate_attack(
            game, attacker_key, target_key, rng=rng,
            surge_spends=action.params.get('surge_spends'),
            attacker_rerolls=int(action.params.get('attacker_rerolls') or 0),
            defender_rerolls=int(action.params.get('defender_rerolls') or 0),
            spent_tokens=action.params.get('spent_tokens'),
        )
        game.data['lastAttackOrchestration'] = result
        return game
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

    # Enforce one attack per activation per figure, unless the attacker has
    # a freeAttackBonusPending entry (Heroic, Charge, Vader's Finest, etc.)
    # which grants an extra attack for free.
    atk_log = dict(game.get('figureAttacksThisActivation') or {})
    patk = dict(atk_log.get(atk_player, atk_log.get(str(atk_player), {})))
    already = patk.get(attacker_key, 0)

    # Resolve attacker's msg_id early — consumers (free-attack-bonus,
    # override-attack-dice, next-attack-bonus-hits, payback-surge,
    # conditions) all need it regardless of attack number.
    from python.engine.mechanics.figure_lookup import parse_figure_key
    dc_list_key = 'p1DcList' if atk_player == 1 else 'p2DcList'
    msg_ids_key = 'p1DcMessageIds' if atk_player == 1 else 'p2DcMessageIds'
    dc_list_early = game.get(dc_list_key) or []
    msg_ids_early = game.get(msg_ids_key) or []
    atk_msg_id = None
    parsed_early = parse_figure_key(attacker_key)
    if parsed_early is not None:
        target_name, target_group, _ = parsed_early
        for i, dc in enumerate(dc_list_early):
            if not isinstance(dc, Mapping):
                continue
            if (dc.get('dcName') == target_name
                    and int(dc.get('dgIndex') or 0) == target_group
                    and i < len(msg_ids_early)):
                atk_msg_id = msg_ids_early[i]
                break

    if already >= 1:
        free_attack_map = game.get('freeAttackBonusPending') or {}
        if atk_msg_id and atk_msg_id in free_attack_map:
            # Consume one free-attack credit; do NOT increment the
            # per-activation attack counter.
            entry = free_attack_map[atk_msg_id]
            if isinstance(entry, int):
                if entry > 1:
                    free_attack_map[atk_msg_id] = entry - 1
                else:
                    del free_attack_map[atk_msg_id]
            else:
                # dict or True — consume fully.
                del free_attack_map[atk_msg_id]
            game['freeAttackBonusPending'] = free_attack_map
        else:
            raise ValueError(
                f'attack_target: {attacker_key!r} already attacked this activation'
            )

    atk_dc = _dc_name_from_figure_key(attacker_key)
    def_dc = _dc_name_from_figure_key(target_key)
    atk_effect = get_dc_effect(atk_dc) or {}
    def_effect = get_dc_effect(def_dc) or {}

    attack_spec = atk_effect.get('attack') or {}
    dice_colors = attack_spec.get('dice') or []
    attack_type = attack_spec.get('type') or 'range'

    # Consume pendingOverrideAttackDice[atk_msg_id] if set (Arsenal,
    # Saber Orbit, etc.). Overrides both dice + attackType for this
    # one attack, then clears.
    if atk_msg_id:
        override_map = game.data.get('pendingOverrideAttackDice') or {}
        override = override_map.get(atk_msg_id)
        if isinstance(override, Mapping):
            overridden_dice = override.get('dice')
            if isinstance(overridden_dice, list) and overridden_dice:
                dice_colors = list(overridden_dice)
            if override.get('type'):
                attack_type = str(override['type'])
            new_map = dict(override_map)
            new_map.pop(atk_msg_id, None)
            game.data['pendingOverrideAttackDice'] = new_map if new_map else None

    if not dice_colors:
        raise ValueError(f'attack_target: {atk_dc!r} has no attack dice')

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

    # Consume nextAttacksBonusHits[atk_msg_id] → apply {bonus} to attackRoll
    # and decrement the count (remove entry at 0).
    bonus_hits = 0
    # atk_msg_id was resolved early (before free-attack-bonus check).
    if atk_msg_id:
        nab_map = dict(game.get('nextAttacksBonusHits') or {})
        entry = nab_map.get(atk_msg_id)
        if isinstance(entry, Mapping):
            bonus_hits = int(entry.get('bonus') or 0)
            count = int(entry.get('count') or 1)
            if count <= 1:
                nab_map.pop(atk_msg_id, None)
            else:
                nab_map[atk_msg_id] = {
                    **entry, 'count': count - 1,
                }
            game['nextAttacksBonusHits'] = nab_map

    # Consume paybackBonusSurge[atk_msg_id] → +N surges on this attack.
    bonus_surge = 0
    if atk_msg_id:
        pb_map = dict(game.get('paybackBonusSurge') or {})
        if atk_msg_id in pb_map:
            bonus_surge = int(pb_map.pop(atk_msg_id) or 0)
            game['paybackBonusSurge'] = pb_map if pb_map else None

    # Add bonus hits directly to attack_roll dmg so compute_combat_result
    # sees the higher value. Same for bonus surge.
    if bonus_hits or bonus_surge:
        attack_roll = dict(attack_roll)
        if bonus_hits:
            attack_roll['dmg'] = int(attack_roll.get('dmg') or 0) + bonus_hits
        if bonus_surge:
            attack_roll['surge'] = int(attack_roll.get('surge') or 0) + bonus_surge

    # Merge pendingCombat bonuses (set by CCs/abilities via schema) into
    # the combat dict so compute_combat_result applies them. Conditions
    # (Focus, Hide, Weaken, Stun) feed in via attackerConds/defenderConds.
    conditions_map = game.get('figureConditions') or {}
    atk_conds = list(conditions_map.get(attacker_key) or [])
    def_conds = list(conditions_map.get(target_key) or [])
    combat = {
        'attackRoll': attack_roll,
        'defenseRoll': defense_roll,
        'attackerConds': atk_conds,
        'defenderConds': def_conds,
        'attackerFigureKey': attacker_key,
        'defenderFigureKey': target_key,
        'attackerPlayerNum': atk_player,
        'defenderPlayerNum': def_player,
        'attackInfo': {'dice': list(dice_colors)},
    }

    # Fire Pattern D combat-declare triggers (ability bonuses stamped
    # before dice are evaluated: Weighted Thrust, Precise Targeting, etc.)
    try:
        from python.engine.mechanics.combat_declare import (
            fire_combat_declare_triggers,
        )
        atk_sids = atk_effect.get('specialAbilityIds') or []
        def_sids = def_effect.get('specialAbilityIds') or []
        if atk_sids or def_sids:
            fire_combat_declare_triggers(
                game.data, combat, atk_sids, attacker_key,
                defender_special_ids=def_sids,
                ctx={
                    'attacker_figure_key': attacker_key,
                    'defender_figure_key': target_key,
                    'defender_player_num': def_player,
                    'is_ranged': attack_type == 'range',
                },
            )
    except (NotImplementedError, RuntimeError, Exception):
        # Trigger firing must not crash the attack. Pattern D stubs
        # raise NotImplementedError; UnregisteredPatternD is RuntimeError.
        pass
    pending_combat = game.get('pendingCombat')
    if isinstance(pending_combat, Mapping):
        for k in ('bonusHits', 'bonusBlock', 'bonusEvade', 'bonusAccuracy',
                  'bonusPierce', 'bonusSurges', 'bonusBlast', 'bonusCleave',
                  'defenseDiceRemoved', 'attackerDiceToRemove',
                  'attackerBonusDice', 'defenderBonusDice',
                  'attackerRerollCount', 'defenderRerollCount'):
            if k in pending_combat:
                combat[k] = pending_combat[k]
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

    # Record attack on attacker — unless this was a free attack (already >= 1
    # at entry AND a freeAttackBonusPending credit was consumed above, which
    # would leave `already` unchanged since we skipped the raise path).
    if already == 0:
        patk[attacker_key] = already + 1
        atk_log[atk_player] = patk
        game['figureAttacksThisActivation'] = atk_log

    # Clear one-shot pendingCombat after the attack resolves (bonuses
    # from CCs/abilities were single-attack unless tagged round-scoped).
    pc = game.get('pendingCombat')
    if isinstance(pc, Mapping) and not pc.get('roundScoped'):
        game['pendingCombat'] = None

    # Check for VP-based / elimination win after damage/defeat.
    check_win_conditions(game)

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
      - Fire end-of-round DC passives (Regenerate, etc.) before the round
        number ticks.
      - round/currentRound += 1.
      - activationsRemaining[p] = count of live deployment groups.
      - Clear per-round tracking (moved, attacks, damage, active, starts).
      - roundPhase -> 'activation'.
      - If either side has zero groups: phase -> 'game_over'.
    """
    from python.engine.mechanics.round_effects import apply_end_of_round_dc_effects
    eor_events = apply_end_of_round_dc_effects(game)
    if eor_events:
        game.data['lastEndOfRoundDcEvents'] = eor_events

    cur_round = int(game.get('round') or game.get('currentRound') or 1)
    game['round'] = cur_round + 1
    # Keep currentRound in sync if it was being used.
    if 'currentRound' in game.data:
        game['currentRound'] = cur_round + 1

    p1_groups = _count_activations_from_board(game, 1)
    p2_groups = _count_activations_from_board(game, 2)

    # Full win-conditions check: covers VP >= 40 + elimination.
    win_result = check_win_conditions(game)
    if win_result.get('ended'):
        game['roundPhase'] = 'end'
    elif p1_groups == 0 or p2_groups == 0:
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
    # Start-of-round CC draw: each player draws 2 CCs (with reshuffle
    # from discard when deck runs out). IACP standard rule. Skip when
    # the game has ended.
    if not win_result.get('ended'):
        from python.engine.cards.deck import draw_with_reshuffle
        for pn in (1, 2):
            try:
                draw_with_reshuffle(game, pn, 2)
            except Exception:
                pass

    # Clear round-scoped CC/ability state: Fuel Upgrade, Elusive,
    # Cheat to Win, Covering Fire, Built on Hope, Arcing Shot, etc.
    # These set roundDefenseBonus*, activeCardEffects flags, or
    # *Active fields that should reset at round boundary.
    game['pendingCombat'] = None
    game['nextAttacksBonusHits'] = None
    game['nextAttacksBonusAcc'] = None
    game['freeAttackBonusPending'] = None
    game['mobileMovementActive'] = None
    game['activeCardEffects'] = None
    game['fluctuationSwappedThisRound'] = []
    game['paybackBonusSurge'] = None
    game['reinforcementsPlayedThisSor'] = False

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

    # Seed CC decks from squad config (if supplied) and fall back to a
    # random starter pool from data/cc-effects.json. Each player starts
    # with 2 CCs in hand (per IACP round-1 default).
    for pn_key, squad_key, deck_key, hand_key in (
        (1, 'player1Squad', 'player1CcDeck', 'player1CcHand'),
        (2, 'player2Squad', 'player2CcDeck', 'player2CcHand'),
    ):
        squad = game.data.get(squad_key) or {}
        cc_cards = list(squad.get('ccCards') or squad.get('commandCards') or [])
        if not cc_cards:
            # Fallback: use a pool of affiliation-neutral CCs so the
            # game still has CC plays available in headless/AI mode.
            # Prioritise duringActivation / startOfActivation timings
            # so the AI has broadly-playable CCs in hand.
            from python.engine.data.cc_effects_loader import get_cc_effects
            all_cc = get_cc_effects() or {}
            generic = [
                (name, eff) for name, eff in all_cc.items()
                if isinstance(eff, dict)
                and eff.get('playableBy') in (None, 'Any Figure', 'Any')
            ]
            # Bucket by timing, prefer broadly-playable ones first.
            broad_timings = (
                'duringActivation', 'startOfActivation',
                'beforeYouDeclareAttack',
            )
            broad = [n for n, e in generic if e.get('timing') in broad_timings]
            rest = [n for n, e in generic if e.get('timing') not in broad_timings]
            cc_cards = (broad + rest)[:10]
        if cc_cards:
            import random as _r
            rng = _r.Random(42 + pn_key)
            shuffled = list(cc_cards)
            rng.shuffle(shuffled)
            initial_hand = shuffled[:2]
            remaining_deck = shuffled[2:]
            game.data[hand_key] = initial_hand
            game.data[deck_key] = remaining_deck
            game.data[f'player{pn_key}CcDiscard'] = []

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

    # Auto-resolve: when params.auto_resolve=True (default for AI self-play),
    # immediately invoke the CC effect resolver with ctx. Tests / Discord
    # flow can opt out to keep pendingCcEffect around for choice UI.
    auto = action.params.get('auto_resolve', True)
    if auto:
        from python.engine.cards.cc_effects import (
            UnknownCcEffect, resolve_pending_cc_effect,
        )
        cc_ctx = dict(action.params.get('cc_ctx') or {})

        # Auto-populate ctx from the active figure if caller didn't supply
        # figure_key / msg_id. Lets CCs that need a self-figure (mpBonus,
        # applyFocus, applyHide, recoverDamage) fire without the caller
        # threading every field.
        active_keys = game.data.get('activeFigureKeys') or []
        if not cc_ctx.get('figure_key') and active_keys:
            cc_ctx['figure_key'] = active_keys[0]
        if not cc_ctx.get('msg_id') and cc_ctx.get('figure_key'):
            from python.engine.mechanics.figure_lookup import (
                parse_figure_key,
            )
            dc_list_key = 'p1DcList' if player == 1 else 'p2DcList'
            msg_ids_key = 'p1DcMessageIds' if player == 1 else 'p2DcMessageIds'
            dc_list = game.data.get(dc_list_key) or []
            msg_ids = game.data.get(msg_ids_key) or []
            parsed = parse_figure_key(cc_ctx['figure_key'])
            if parsed is not None:
                tname, tgroup, _ = parsed
                for i, dc in enumerate(dc_list):
                    if not isinstance(dc, Mapping):
                        continue
                    if (dc.get('dcName') == tname
                            and int(dc.get('dgIndex') or 0) == tgroup
                            and i < len(msg_ids)):
                        cc_ctx['msg_id'] = msg_ids[i]
                        break

        # Auto-pick target: if CC needs a target and none supplied, default
        # to the first opponent figure within Chebyshev-adjacent range of
        # the active figure (for chooseAdjacentHostileThen), or the first
        # opponent on the board otherwise.
        if not cc_ctx.get('target_figure_key'):
            opp = 2 if player == 1 else 1
            opp_positions = (game.data.get('figurePositions') or {}).get(opp) or {}
            if opp_positions:
                target_fk = next(iter(opp_positions))
                cc_ctx['target_figure_key'] = target_fk
                cc_ctx['target_player_num'] = opp
                # Resolve target msg_id too.
                dc_list_key = 'p2DcList' if opp == 2 else 'p1DcList'
                msg_ids_key = 'p2DcMessageIds' if opp == 2 else 'p1DcMessageIds'
                from python.engine.mechanics.figure_lookup import (
                    parse_figure_key,
                )
                dc_list = game.data.get(dc_list_key) or []
                msg_ids = game.data.get(msg_ids_key) or []
                parsed = parse_figure_key(target_fk)
                if parsed is not None:
                    tname, tgroup, _ = parsed
                    for i, dc in enumerate(dc_list):
                        if not isinstance(dc, Mapping):
                            continue
                        if (dc.get('dcName') == tname
                                and int(dc.get('dgIndex') or 0) == tgroup
                                and i < len(msg_ids)):
                            cc_ctx['target_msg_id'] = msg_ids[i]
                            break

        try:
            resolve_pending_cc_effect(game, cc_ctx)
        except UnknownCcEffect:
            # Unknown-card guard belongs to the pipeline; we already
            # validated via get_cc_effect above, so this branch is
            # unreachable except for registry drift. Swallow and let the
            # pendingCcEffect linger — the card still got discarded.
            pass
        except ValueError:
            # Per-card handlers raise ValueError when required ctx keys
            # are missing (target_figure_key, etc.). For non-auto paths
            # the Discord UI supplies them; for AI self-play without the
            # UI, the placeholder/no-op branches let play proceed.
            pass

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

    # Pass-through target info: lets schema handlers resolve damage/
    # effects inline instead of stamping pending markers when the caller
    # (AI/headless loop) already knows the target. Resolves target msg_id
    # automatically if target_figure_key + target_player_num supplied.
    for tkey in ('target_figure_key', 'target_player_num',
                 'target_msg_id', 'target_coord'):
        tval = action.params.get(tkey)
        if tval is not None:
            ctx[tkey] = tval

    # Auto-default target to first opponent figure (for headless AI self-play
    # where the caller emits bare DC_SPECIAL actions without target info).
    if not ctx.get('target_figure_key'):
        opp = 2 if player_num == 1 else 1
        opp_positions = (game.data.get('figurePositions') or {}).get(opp) or {}
        if opp_positions:
            ctx['target_figure_key'] = next(iter(opp_positions))
            ctx['target_player_num'] = opp

    if ctx.get('target_figure_key') and ctx.get('target_player_num') \
            and not ctx.get('target_msg_id'):
        from python.engine.mechanics.figure_lookup import (
            find_dc_message_id_for_figure, parse_figure_key,
        )
        dc_meta = game.data.get('dcMessageMeta')
        if dc_meta:
            resolved_tmsg = find_dc_message_id_for_figure(
                game.data.get('gameId'),
                int(ctx['target_player_num']),
                str(ctx['target_figure_key']),
                dc_meta,
            )
            if resolved_tmsg:
                ctx['target_msg_id'] = resolved_tmsg
        # Fallback: lookup in p{N}DcList/MessageIds directly.
        if not ctx.get('target_msg_id'):
            tpn = int(ctx['target_player_num'])
            dc_list_key = 'p1DcList' if tpn == 1 else 'p2DcList'
            msg_ids_key = 'p1DcMessageIds' if tpn == 1 else 'p2DcMessageIds'
            t_dc_list = game.data.get(dc_list_key) or []
            t_msg_ids = game.data.get(msg_ids_key) or []
            parsed_t = parse_figure_key(str(ctx['target_figure_key']))
            if parsed_t is not None:
                tname, tgroup, _ = parsed_t
                for i, dc in enumerate(t_dc_list):
                    if not isinstance(dc, Mapping):
                        continue
                    if (dc.get('dcName') == tname
                            and int(dc.get('dgIndex') or 0) == tgroup
                            and i < len(t_msg_ids)):
                        ctx['target_msg_id'] = t_msg_ids[i]
                        break

    # Resolve msg_id from the DC list — handlers that need it (Charge,
    # Wall Run) can pull it out of ctx instead of re-deriving.
    from python.engine.mechanics.figure_lookup import parse_figure_key
    dc_list_key = 'p1DcList' if player_num == 1 else 'p2DcList'
    msg_ids_key = 'p1DcMessageIds' if player_num == 1 else 'p2DcMessageIds'
    dc_list = game.data.get(dc_list_key) or []
    msg_ids = game.data.get(msg_ids_key) or []
    parsed = parse_figure_key(figure_key) if isinstance(figure_key, str) else None
    if parsed is not None:
        target_name, target_group, _ = parsed
        for i, dc in enumerate(dc_list):
            if not isinstance(dc, Mapping):
                continue
            if (dc.get('dcName') == target_name
                    and int(dc.get('dgIndex') or 0) == target_group
                    and i < len(msg_ids)):
                ctx['msg_id'] = msg_ids[i]
                break

    try:
        result = ability_dispatch.resolve(game.data, ability_id, ctx)
    except ability_dispatch.UnknownAbility:
        result = {'applied': False, 'reason': 'unknown_ability', 'abilityId': ability_id}
    except ability_dispatch.PatternNotImplemented as e:
        result = {'applied': False, 'reason': 'pattern_not_implemented', 'message': str(e)}
    except NotImplementedError as e:
        # Catches TriggerNotImplemented / ChainNotImplemented / subclasses
        result = {'applied': False, 'reason': 'handler_not_implemented', 'message': str(e)}
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
    from python.engine.mechanics.round_effects import apply_start_of_round_dc_effects
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

    # DC-passive start-of-round effects (Brush, etc.)
    sor_events = apply_start_of_round_dc_effects(game)
    if sor_events:
        data['lastStartOfRoundDcEvents'] = sor_events

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
    """Finish Missile Salvo extra-attacks for a specific DC.

    Optional param: msg_id (str). When provided, clears just that msgId
    from game.pendingMissileSalvo; collapses the map to None when empty.
    Without msg_id, clears the whole map (backwards-compat).
    """
    pending = game.data.get('pendingMissileSalvo')
    if not pending:
        raise ValueError('missile_salvo_done: no pendingMissileSalvo open')
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    if msg_id:
        if not isinstance(pending, Mapping) or msg_id not in pending:
            raise ValueError(
                f'missile_salvo_done: no pendingMissileSalvo for msg_id {msg_id!r}'
            )
        pending = dict(pending)
        del pending[msg_id]
        game.data['pendingMissileSalvo'] = pending if pending else None
    else:
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


# ---------------------------------------------------------------------------
# Map-selection helpers (MAP_TYPE_CHOICE / MAP_CONFIRM / MAP_GO_BACK)
# ---------------------------------------------------------------------------

_MAP_SELECTION_TYPES = frozenset({'random', 'draw', 'pick'})


def _handle_map_type_choice(game: GameState, action: Action) -> GameState:
    """Record the map-selection type the user chose in the pre-confirm UI.

    Required param:
        selection_type (str) ∈ {'random', 'draw', 'pick'}.
    """
    sel = str(action.params.get('selection_type') or '').lower()
    if sel not in _MAP_SELECTION_TYPES:
        raise ValueError(
            f"map_type_choice: selection_type must be one of "
            f"{sorted(_MAP_SELECTION_TYPES)}, got {sel!r}"
        )
    game.data['mapSelectionType'] = sel
    return game


def _handle_map_confirm(game: GameState, action: Action) -> GameState:
    """Confirm the currently-selected map/mission and advance the setup phase.

    Requires game.selectedMap to be present. Idempotent no-op if already
    mapSelected.
    """
    if game.data.get('mapSelected'):
        return game
    if not game.data.get('selectedMap'):
        raise ValueError('map_confirm: no map selected yet (call SELECT_MAP first)')
    game.data['mapSelected'] = True
    game.data.pop('mapSelectionType', None)
    # Advance phase marker
    game.data['phase'] = 'initiative'
    return game


def _handle_map_go_back(game: GameState, action: Action) -> GameState:
    """Clear the pending map selection so the user can pick again.

    No-op once mapSelected=True (confirmed maps cannot be rolled back here).
    """
    if game.data.get('mapSelected'):
        return game
    for k in ('selectedMap', 'selectedMission', 'mapSelectionType', 'mapId'):
        game.data.pop(k, None)
    return game


register(ActionType.MAP_TYPE_CHOICE, _handle_map_type_choice)
register(ActionType.MAP_CONFIRM, _handle_map_confirm)
register(ActionType.MAP_GO_BACK, _handle_map_go_back)


# ---------------------------------------------------------------------------
# END_TURN — alias for DC_END_ACTIVATION in the headless stepper
# ---------------------------------------------------------------------------

def _handle_end_turn(game: GameState, action: Action) -> GameState:
    """End the current DC's turn.

    In JS this is two buttons (in the thread vs. the general channel);
    in the headless stepper we collapse both onto DC_END_ACTIVATION
    semantics. Additionally:
      - Clears game.pendingEndTurn[msg_id] when msg_id is provided.
      - Clears next-attack bonus scratch fields and movement bank for the
        msg_id (mirrors the JS cleanup on END_TURN).
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')

    if msg_id:
        pending = game.data.get('pendingEndTurn') or {}
        if msg_id in pending:
            del pending[msg_id]
            game.data['pendingEndTurn'] = pending if pending else None
        mb = game.data.get('movementBank') or {}
        if msg_id in mb:
            del mb[msg_id]
            game.data['movementBank'] = mb if mb else None

    # Delegate to DC_END_ACTIVATION's state change
    return _handle_dc_end_activation(game, action)


register(ActionType.END_TURN, _handle_end_turn)


# ---------------------------------------------------------------------------
# Space-picker / choice-picker ability-dispatch batch
# ---------------------------------------------------------------------------

def _dispatch_ability_pick(game: GameState, action: Action, *,
                           pending_key: str,
                           ctx_params: Dict[str, Any],
                           result_field: str,
                           label: str) -> GameState:
    """Shared dispatcher for space/choice pickers that resolve an ability.

    Reads game.data[pending_key] for the active window, merges ctx_params
    into the ability ctx, dispatches via abilities.dispatch.resolve,
    stores the outcome on game.data[result_field], and clears the pending.

    Raises ValueError on missing pending window. Tolerates
    UnknownAbility / PatternNotImplemented (records reason on result).
    """
    from python.engine.abilities import dispatch as ability_dispatch

    pending = game.data.get(pending_key)
    if not pending or not isinstance(pending, Mapping):
        raise ValueError(f'{label}: no {pending_key} open')
    ability_id = pending.get('abilityId')
    if not ability_id:
        raise ValueError(f'{label}: {pending_key} missing abilityId')
    ctx: Dict[str, Any] = {
        'ability_id': ability_id,
        'player_num': pending.get('playerNum'),
    }
    for k in ('msgId', 'figureIndex', 'card', 'specialIdx'):
        if k in pending:
            ctx[k] = pending[k]
    ctx.update(ctx_params)
    try:
        result = ability_dispatch.resolve(game.data, ability_id, ctx)
    except ability_dispatch.UnknownAbility:
        result = {'applied': False, 'reason': 'unknown_ability'}
    except ability_dispatch.PatternNotImplemented as e:
        result = {
            'applied': False,
            'reason': 'pattern_not_implemented',
            'message': str(e),
        }
    game.data[pending_key] = None
    game.data[result_field] = {
        'abilityId': ability_id,
        'playerNum': pending.get('playerNum'),
        'result': result,
    }
    return game


def _handle_pounce_space(game: GameState, action: Action) -> GameState:
    """Nexu Pounce: resolve after the player picks a landing space.

    Required params: space (str). Consumes game.pendingPounceSpaceChoice[msgId].
    """
    space = action.params.get('space')
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    if not space or not msg_id:
        raise ValueError('pounce_space requires space + msg_id params')
    chosen = str(space).lower()
    pending_map = game.data.get('pendingPounceSpaceChoice') or {}
    pending = pending_map.get(msg_id)
    if not pending:
        raise ValueError(
            f'pounce_space: no pendingPounceSpaceChoice for msg_id {msg_id!r}'
        )
    valid = [str(s).lower() for s in (pending.get('validSpaces') or [])]
    if valid and chosen not in valid:
        raise ValueError(f'pounce_space: {chosen!r} not a valid landing space')
    # Inline dispatch (the pending state is keyed by msgId, not a flat slot)
    from python.engine.abilities import dispatch as ability_dispatch

    ability_id = pending.get('abilityId')
    ctx: Dict[str, Any] = {
        'msgId': msg_id,
        'player_num': pending.get('playerNum'),
        'chosen_space': chosen,
        'target_figure_key': pending.get('targetFigureKey'),
        'figureIndex': pending.get('figureIndex'),
        'specialIdx': pending.get('specialIdx'),
    }
    try:
        result = ability_dispatch.resolve(game.data, ability_id, ctx)
    except ability_dispatch.UnknownAbility:
        result = {'applied': False, 'reason': 'unknown_ability'}
    except ability_dispatch.PatternNotImplemented as e:
        result = {'applied': False, 'reason': 'pattern_not_implemented', 'message': str(e)}
    del pending_map[msg_id]
    game.data['pendingPounceSpaceChoice'] = pending_map if pending_map else None
    game.data['lastPounceResult'] = {
        'abilityId': ability_id,
        'playerNum': pending.get('playerNum'),
        'chosenSpace': chosen,
        'result': result,
    }
    return game


def _handle_cc_choice(game: GameState, action: Action) -> GameState:
    """CC effect chooseOne resolver.

    Required param: choice_index (int).
    Consumes game.pendingCcChoice.
    """
    choice_index = action.params.get('choice_index')
    if choice_index is None:
        choice_index = action.params.get('choiceIndex')
    if not isinstance(choice_index, int) or choice_index < 0:
        raise ValueError('cc_choice requires non-negative int choice_index')
    pending = game.data.get('pendingCcChoice')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('cc_choice: no pendingCcChoice open')
    choice_options = pending.get('choiceOptions') or []
    if choice_index >= len(choice_options):
        raise ValueError(
            f'cc_choice: choice_index {choice_index} out of range '
            f'({len(choice_options)} options)'
        )
    choice_values = pending.get('choiceValues') or []
    chosen_value = (
        choice_values[choice_index]
        if 0 <= choice_index < len(choice_values) else None
    )
    return _dispatch_ability_pick(
        game, action,
        pending_key='pendingCcChoice',
        ctx_params={
            'choice_index': choice_index,
            'chosen_option': choice_options[choice_index],
            'chosen_figure_key': chosen_value,
        },
        result_field='lastCcChoiceResult',
        label='cc_choice',
    )


def _handle_cc_space(game: GameState, action: Action) -> GameState:
    """CC effect space-picker resolver.

    Required param: space (str).
    Consumes game.pendingCcSpaceChoice.
    """
    space = action.params.get('space')
    if not space:
        raise ValueError('cc_space requires space param')
    chosen = str(space).lower()
    pending = game.data.get('pendingCcSpaceChoice')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('cc_space: no pendingCcSpaceChoice open')
    valid = [str(s).lower() for s in (pending.get('validSpaces') or [])]
    if valid and chosen not in valid:
        raise ValueError(f'cc_space: {chosen!r} not a valid space')
    return _dispatch_ability_pick(
        game, action,
        pending_key='pendingCcSpaceChoice',
        ctx_params={
            'chosen_space': chosen,
            'chosen_figure_key': pending.get('chosenFigureKey'),
        },
        result_field='lastCcSpaceResult',
        label='cc_space',
    )


def _handle_arsenal_pick(game: GameState, action: Action) -> GameState:
    """Arsenal (Greedo et al) attack-dice loadout pick.

    Required param: dice (list[str]) — the chosen attack dice pool.
    Sets game.pendingOverrideAttackDice[msgId] and clears pendingArsenalPick.
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    dice = action.params.get('dice')
    if not msg_id:
        raise ValueError('arsenal_pick requires msg_id param')
    if not isinstance(dice, list) or not all(isinstance(d, str) for d in dice):
        raise ValueError('arsenal_pick requires dice (list[str]) param')
    pending = game.data.get('pendingArsenalPick') or {}
    if msg_id in pending:
        del pending[msg_id]
        game.data['pendingArsenalPick'] = pending if pending else None
    override = game.data.get('pendingOverrideAttackDice') or {}
    override[msg_id] = {'dice': list(dice)}
    game.data['pendingOverrideAttackDice'] = override
    return game


register(ActionType.POUNCE_SPACE, _handle_pounce_space)
register(ActionType.CC_CHOICE, _handle_cc_choice)
register(ActionType.CC_SPACE, _handle_cc_space)
register(ActionType.ARSENAL_PICK, _handle_arsenal_pick)


# ---------------------------------------------------------------------------
# MISSILE_SALVO_DIE — pick a color die for the bonus salvo attack
# ---------------------------------------------------------------------------

def _handle_missile_salvo_die(game: GameState, action: Action) -> GameState:
    """Missile Salvo die pick: consume one color from diceAvailable and set
    the next attack's override dice + +3 accuracy bonus.

    Required params:
        msg_id (str), color (str) — one of diceAvailable on the pending
        entry.
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    color = action.params.get('color')
    if not msg_id or not color:
        raise ValueError('missile_salvo_die requires msg_id + color params')
    color = str(color).lower()
    pending_map = game.data.get('pendingMissileSalvo') or {}
    pending = pending_map.get(msg_id)
    if not pending:
        raise ValueError(
            f'missile_salvo_die: no pendingMissileSalvo for msg_id {msg_id!r}'
        )
    dice_available = list(pending.get('diceAvailable') or [])
    if color not in dice_available:
        raise ValueError(
            f'missile_salvo_die: {color!r} not in diceAvailable '
            f'{dice_available!r}'
        )

    dice_available.remove(color)
    pending_mut = dict(pending)
    pending_mut['diceAvailable'] = dice_available
    pending_map = dict(pending_map)
    pending_map[msg_id] = pending_mut
    game.data['pendingMissileSalvo'] = pending_map

    override = game.data.get('pendingOverrideAttackDice') or {}
    override[msg_id] = {
        'dice': [color], 'type': 'ranged', 'bonusAccuracy': 3,
    }
    game.data['pendingOverrideAttackDice'] = override

    free_bonus = game.data.get('freeAttackBonusPending') or {}
    free_bonus[msg_id] = True
    game.data['freeAttackBonusPending'] = free_bonus
    return game


register(ActionType.MISSILE_SALVO_DIE, _handle_missile_salvo_die)


# ---------------------------------------------------------------------------
# Combat state machine (thin — operates on pendingCombat dict)
# ---------------------------------------------------------------------------

def _require_pending_combat(game: GameState, label: str) -> Dict[str, Any]:
    combat = game.data.get('pendingCombat')
    if combat is None or not isinstance(combat, Mapping):
        raise ValueError(f'{label}: no pendingCombat open')
    return dict(combat)


def _handle_combat_ready(game: GameState, action: Action) -> GameState:
    """Mark a player as ready during the combat confirmation gate.

    Paired with the JS 'I'm ready to resolve' buttons on both sides.
    Required: action.player ∈ {1, 2}. When both p1Ready and p2Ready are
    set, stamps combat.phase='ready'.
    """
    player = int(action.player or 0)
    if player not in (1, 2):
        raise ValueError('combat_ready requires player ∈ {1, 2}')
    combat = _require_pending_combat(game, 'combat_ready')
    key = 'p1Ready' if player == 1 else 'p2Ready'
    combat[key] = True
    if combat.get('p1Ready') and combat.get('p2Ready'):
        combat['phase'] = 'ready'
    game.data['pendingCombat'] = combat
    return game


def _handle_combat_gate(game: GameState, action: Action) -> GameState:
    """Combat mid-attack gate — advance pendingCombat.phase by gate name.

    Required param: gate (str) — arbitrary phase label the caller wants
    to stamp. Used for Assassinate / Close Quarters sub-phase dispatch.
    """
    gate = action.params.get('gate')
    if not isinstance(gate, str) or not gate:
        raise ValueError('combat_gate requires gate (str) param')
    combat = _require_pending_combat(game, 'combat_gate')
    combat['phase'] = gate
    game.data['pendingCombat'] = combat
    return game


def _handle_combat_reroll(game: GameState, action: Action) -> GameState:
    """Record that specific dice indices were re-rolled.

    Does NOT perform the actual dice recomputation (atomic ATTACK_TARGET
    does that for AI; Discord UI consumers plug in their own dice-roll
    service). Instead it tracks which indices were rerolled so the
    resolve step can reconcile.

    Required params:
        side (str) — 'attacker' or 'defender'.
        indices (list[int]) — dice positions to mark as rerolled.
    Optional:
        new_values (list) — if provided, overwrites the dice values at
        those positions (used by RNG-tested flows).
    """
    side = action.params.get('side')
    indices = action.params.get('indices')
    if side not in ('attacker', 'defender'):
        raise ValueError("combat_reroll: side must be 'attacker' or 'defender'")
    if not isinstance(indices, list) or not all(isinstance(i, int) for i in indices):
        raise ValueError('combat_reroll: indices must be list[int]')
    combat = _require_pending_combat(game, 'combat_reroll')
    key = 'attackerRerolledIndices' if side == 'attacker' else 'defenderRerolledIndices'
    existing = list(combat.get(key) or [])
    for i in indices:
        if i not in existing:
            existing.append(i)
    combat[key] = existing

    new_values = action.params.get('new_values')
    if new_values is not None:
        dice_field = 'attackRoll' if side == 'attacker' else 'defenseRoll'
        dice = list(combat.get(dice_field) or [])
        for pos, val in zip(indices, new_values):
            if 0 <= pos < len(dice):
                dice[pos] = val
        combat[dice_field] = dice
    game.data['pendingCombat'] = combat
    return game


def _handle_combat_surge(game: GameState, action: Action) -> GameState:
    """Spend one surge on an ability ID.

    Required param: ability (str). Decrements pendingCombat.surgeRemaining
    (clamped at 0) and appends the ability to pendingCombat.triggeredSurges.
    """
    ability = action.params.get('ability')
    if not isinstance(ability, str) or not ability:
        raise ValueError('combat_surge requires ability (str) param')
    combat = _require_pending_combat(game, 'combat_surge')
    surge_remaining = int(combat.get('surgeRemaining') or 0)
    if surge_remaining <= 0:
        raise ValueError('combat_surge: no surges remaining')
    combat['surgeRemaining'] = surge_remaining - 1
    triggered = list(combat.get('triggeredSurges') or [])
    triggered.append(ability)
    combat['triggeredSurges'] = triggered
    if combat['surgeRemaining'] == 0:
        combat['phase'] = 'surges_done'
    game.data['pendingCombat'] = combat
    return game


def _handle_combat_skip_surges(game: GameState, action: Action) -> GameState:
    """End the surge-spending phase — sets surgeRemaining=0 + phase='surges_done'."""
    combat = _require_pending_combat(game, 'combat_skip_surges')
    combat['surgeRemaining'] = 0
    combat['phase'] = 'surges_done'
    game.data['pendingCombat'] = combat
    return game


def _handle_combat_passive(game: GameState, action: Action) -> GameState:
    """Record a passive effect that fired during combat resolution.

    Required param: passive (str) — the passive id/name.
    """
    passive = action.params.get('passive')
    if not isinstance(passive, str) or not passive:
        raise ValueError('combat_passive requires passive (str) param')
    combat = _require_pending_combat(game, 'combat_passive')
    triggered = list(combat.get('triggeredPassives') or [])
    if passive not in triggered:
        triggered.append(passive)
    combat['triggeredPassives'] = triggered
    game.data['pendingCombat'] = combat
    return game


def _handle_combat_token(game: GameState, action: Action) -> GameState:
    """Spend a power token from a figure during combat.

    Required params:
        figure_key (str), token_type (str), index (int) — position in the
        figure's figurePowerTokens list.

    Effects:
        - Validates the token at index matches token_type.
        - Removes it from figurePowerTokens[figure_key].
        - Appends to pendingCombat.spentTokens for resolve-time reconciliation.
    """
    figure_key = action.params.get('figure_key') or action.params.get('figureKey')
    token_type = action.params.get('token_type') or action.params.get('tokenType')
    token_index = action.params.get('index')
    if token_index is None:
        token_index = action.params.get('tokenIndex')
    if not figure_key or not token_type or not isinstance(token_index, int):
        raise ValueError(
            'combat_token requires figure_key + token_type + int index params'
        )
    combat = _require_pending_combat(game, 'combat_token')
    tokens_all = game.data.get('figurePowerTokens') or {}
    tokens = list(tokens_all.get(figure_key) or [])
    if token_index < 0 or token_index >= len(tokens):
        raise ValueError(
            f'combat_token: index {token_index} out of range '
            f'({len(tokens)} tokens on {figure_key!r})'
        )
    if tokens[token_index] != token_type:
        raise ValueError(
            f"combat_token: token at index {token_index} is "
            f"{tokens[token_index]!r}, expected {token_type!r}"
        )
    tokens.pop(token_index)
    tokens_all[figure_key] = tokens
    game.data['figurePowerTokens'] = tokens_all
    spent = list(combat.get('spentTokens') or [])
    spent.append({'figureKey': figure_key, 'tokenType': token_type})
    combat['spentTokens'] = spent
    game.data['pendingCombat'] = combat
    return game


def _handle_combat_resolve(game: GameState, action: Action) -> GameState:
    """Resolve pendingCombat: applies damage, optional kill, clears pendingCombat.

    Required params (most from the caller, reflecting the already-rolled
    combat state):
        damage (int) — final damage after all modifiers.
        defeated (bool, default False) — whether the target was defeated.

    Effects:
        - Applies damage to the target figure via damage_helpers.reduce_hp
          when dc_health_state is accessible on the game dict.
        - When defeated=True: removes the target from figurePositions,
          awards kill VP (kill cost from pendingCombat.targetStats.cost).
        - Clears pendingCombat.
    """
    from python.engine.mechanics.damage_helpers import reduce_hp
    from python.engine.mechanics.player_helpers import remove_figure_position
    from python.engine.mechanics.vp_helpers import award_kill_vp, check_nefarious_gains

    damage = action.params.get('damage')
    defeated = bool(action.params.get('defeated'))
    if not isinstance(damage, int) or damage < 0:
        raise ValueError('combat_resolve requires non-negative int damage param')
    combat = _require_pending_combat(game, 'combat_resolve')

    target = combat.get('target') or {}
    target_fk = target.get('figureKey') if isinstance(target, Mapping) else None
    target_pn = combat.get('defenderPlayerNum')
    attacker_pn = combat.get('attackerPlayerNum')

    applied = False
    if damage > 0 and target_fk and target_pn:
        msg_id_key = 'defenderMsgId'
        defender_msg_id = combat.get(msg_id_key) or target.get('msgId')
        dc_health_state = game.data.get('dcHealthState')
        if defender_msg_id and isinstance(dc_health_state, dict):
            try:
                fig_idx = int(target_fk.rsplit('-', 1)[-1])
            except (ValueError, AttributeError):
                fig_idx = 0
            reduce_hp(dc_health_state, game.data, defender_msg_id, fig_idx,
                      damage, target_pn)
            applied = True

    if defeated and target_fk and target_pn:
        target_stats = combat.get('targetStats') or {}
        kill_vp = int(target_stats.get('cost') or 0)
        sub_cost = target_stats.get('subCost')
        if sub_cost is not None:
            kill_vp = max(kill_vp, int(sub_cost))
        if kill_vp > 0 and attacker_pn:
            award_kill_vp(game, attacker_pn, kill_vp)
        remove_figure_position(game, target_pn, target_fk)
        check_nefarious_gains(game, target_pn)

    game.data['pendingCombat'] = None
    game.data['lastCombatResult'] = {
        'attackerPlayerNum': attacker_pn,
        'defenderPlayerNum': target_pn,
        'targetFigureKey': target_fk,
        'damage': damage,
        'defeated': defeated,
        'applied': applied,
    }
    return game


register(ActionType.COMBAT_READY, _handle_combat_ready)
register(ActionType.COMBAT_GATE, _handle_combat_gate)
register(ActionType.COMBAT_REROLL, _handle_combat_reroll)
register(ActionType.COMBAT_SURGE, _handle_combat_surge)
register(ActionType.COMBAT_SKIP_SURGES, _handle_combat_skip_surges)
register(ActionType.COMBAT_PASSIVE, _handle_combat_passive)
register(ActionType.COMBAT_TOKEN, _handle_combat_token)
register(ActionType.COMBAT_RESOLVE, _handle_combat_resolve)


# ---------------------------------------------------------------------------
# DEPLOY_FIGURE (setup) — place a figure at a coord
# ---------------------------------------------------------------------------

def _handle_deploy_figure(game: GameState, action: Action) -> GameState:
    """Place a figure on the board.

    Required params:
        figure_key (str), coord (str).

    The stepper collapses the JS two-click "pick figure → pick space"
    flow into one atomic placement. Params carry both pieces.

    Effects:
        - Sets game.figurePositions[player_num][figure_key] = coord.lower()
        - Validates player_num ∈ {1, 2}.
    """
    player = int(action.player or 0)
    if player not in (1, 2):
        raise ValueError('deploy_figure requires player ∈ {1, 2}')
    figure_key = action.params.get('figure_key') or action.params.get('figureKey')
    coord = action.params.get('coord') or action.params.get('space')
    if not figure_key or not coord:
        raise ValueError('deploy_figure requires figure_key + coord params')
    positions = game.data.get('figurePositions') or {1: {}, 2: {}}
    # JSON keys can come back as strings when serialized
    for k in (1, 2):
        if str(k) in positions and k not in positions:
            positions[k] = positions.pop(str(k))
    player_positions = dict(positions.get(player) or {})
    player_positions[figure_key] = str(coord).lower()
    positions[player] = player_positions
    game.data['figurePositions'] = positions
    return game


register(ActionType.DEPLOY_FIGURE, _handle_deploy_figure)


# ---------------------------------------------------------------------------
# UI-trigger shims: DEPLOY_PICK, DEPLOY_ROW, MOVE_FIGURE, MOVE_MP, MOVE_LETTER,
# DC_ACTION, SPECIAL_ACTION, REFRESH_MAP, CONFIRM_ATTACHMENT
#
# These are button-open-picker events in the JS flow. The stepper version
# just records the player's intent (or no-ops). Follow-up actions carry the
# actual state change.
# ---------------------------------------------------------------------------

def _handle_deploy_pick(game: GameState, action: Action) -> GameState:
    """Record which figure slot was selected for deployment (UI shim).

    Optional param: flat_index (int) — the squad position being deployed.
    Sets game.pendingDeployPick[player_num] = flat_index.
    """
    player = int(action.player or 0)
    if player not in (1, 2):
        raise ValueError('deploy_pick requires player ∈ {1, 2}')
    flat_index = action.params.get('flat_index')
    if flat_index is None:
        flat_index = action.params.get('flatIndex')
    pending = game.data.get('pendingDeployPick') or {}
    pending[player] = flat_index
    game.data['pendingDeployPick'] = pending
    return game


def _handle_deploy_row(game: GameState, action: Action) -> GameState:
    """Record row filter choice during deployment (UI shim)."""
    row = action.params.get('row')
    pending = game.data.get('pendingDeployPick') or {}
    pending['row'] = row
    game.data['pendingDeployPick'] = pending
    return game


def _handle_move_figure(game: GameState, action: Action) -> GameState:
    """Open movement for a specific figure (UI shim).

    Required params: figure_key, msg_id.
    Records game.moveInProgress[msg_id] = {figureKey, playerNum}. Real
    MP consumption happens via MOVE_PICK_SPACE.
    """
    figure_key = action.params.get('figure_key') or action.params.get('figureKey')
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    if not figure_key or not msg_id:
        raise ValueError('move_figure requires figure_key + msg_id params')
    player = int(action.player or 0)
    if player not in (1, 2):
        player, _ = _find_figure(game, figure_key)
        if player is None:
            raise ValueError(f'move_figure: figure {figure_key!r} not on board')
    move_in_progress = game.data.get('moveInProgress') or {}
    move_in_progress[msg_id] = {'figureKey': figure_key, 'playerNum': player}
    game.data['moveInProgress'] = move_in_progress
    return game


def _handle_move_mp(game: GameState, action: Action) -> GameState:
    """Set MP budget for the in-progress move (UI shim).

    Required params: msg_id, mp (int).
    Updates game.moveInProgress[msg_id].mpRemaining.
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    mp = action.params.get('mp')
    if not msg_id or not isinstance(mp, int) or mp < 0:
        raise ValueError('move_mp requires msg_id + non-negative int mp params')
    move_in_progress = game.data.get('moveInProgress') or {}
    entry = dict(move_in_progress.get(msg_id) or {})
    entry['mpRemaining'] = mp
    move_in_progress[msg_id] = entry
    game.data['moveInProgress'] = move_in_progress
    return game


def _handle_move_letter(game: GameState, action: Action) -> GameState:
    """Record letter pick for multi-figure group movement (UI shim).

    Required params: msg_id, letter (str).
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    letter = action.params.get('letter')
    if not msg_id or not letter:
        raise ValueError('move_letter requires msg_id + letter params')
    move_in_progress = game.data.get('moveInProgress') or {}
    entry = dict(move_in_progress.get(msg_id) or {})
    entry['letter'] = letter
    move_in_progress[msg_id] = entry
    game.data['moveInProgress'] = move_in_progress
    return game


def _handle_dc_action(game: GameState, action: Action) -> GameState:
    """Dispatcher wrapper: a DC's generic action button (Attack / Move / Special).

    Required params: msg_id, action_name (str).
    Records game.pendingDcActionChoice[msg_id] = action_name so follow-up
    actions (ATTACK_TARGET, MOVE_PICK_SPACE, etc.) know the activation
    slot being consumed.
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    action_name = action.params.get('action_name') or action.params.get('actionName')
    if not msg_id or not action_name:
        raise ValueError('dc_action requires msg_id + action_name params')
    pending = game.data.get('pendingDcActionChoice') or {}
    pending[msg_id] = action_name
    game.data['pendingDcActionChoice'] = pending
    return game


def _handle_special_action(game: GameState, action: Action) -> GameState:
    """Thin relay to DC_SPECIAL via the stepper.

    Required params: figure_key, special_idx.
    """
    return _handle_dc_special(game, action)


def _handle_refresh_map(game: GameState, action: Action) -> GameState:
    """Discord map-refresh trigger (no-op in the headless stepper)."""
    return game


def _handle_confirm_attachment(game: GameState, action: Action) -> GameState:
    """Mark attachments as confirmed for a player.

    Required: action.player ∈ {1, 2}.
    Sets game.p{n}AttachmentsConfirmed = True.
    """
    player = int(action.player or 0)
    if player not in (1, 2):
        raise ValueError('confirm_attachment requires player ∈ {1, 2}')
    key = 'p1AttachmentsConfirmed' if player == 1 else 'p2AttachmentsConfirmed'
    game.data[key] = True
    return game


register(ActionType.DEPLOY_PICK, _handle_deploy_pick)
register(ActionType.DEPLOY_ROW, _handle_deploy_row)
register(ActionType.MOVE_FIGURE, _handle_move_figure)
register(ActionType.MOVE_MP, _handle_move_mp)
register(ActionType.MOVE_LETTER, _handle_move_letter)
register(ActionType.DC_ACTION, _handle_dc_action)
register(ActionType.SPECIAL_ACTION, _handle_special_action)
register(ActionType.REFRESH_MAP, _handle_refresh_map)
register(ActionType.CONFIRM_ATTACHMENT, _handle_confirm_attachment)


# ---------------------------------------------------------------------------
# Rush / Shoulder Rush accept handlers — push target + mutual 1 damage
# ---------------------------------------------------------------------------

def _apply_hp_damage_via_health_state(game: GameState, figure_key: str,
                                      player_num: int, damage: int) -> Dict[str, Any]:
    """Apply damage to a figure via dcHealthState; returns reduce_hp result.

    Returns {'newHp', 'maxHp', 'prevHp', 'wasDefeated'} with zeros on miss.
    """
    from python.engine.mechanics.damage_helpers import reduce_hp

    dc_ids = (
        game.data.get('p1DcMessageIds') if player_num == 1
        else game.data.get('p2DcMessageIds')
    ) or []
    dc_list = (
        game.data.get('p1DcList') if player_num == 1
        else game.data.get('p2DcList')
    ) or []

    from python.engine.mechanics.dc_helpers import (
        dc_name_from_figure_key, parse_figure_key,
    )
    dc_name = dc_name_from_figure_key(figure_key)
    parsed = parse_figure_key(figure_key)
    fig_idx = parsed.get('figureIndex', 0)

    msg_id = None
    for mid, entry in zip(dc_ids, dc_list):
        if isinstance(entry, Mapping) and entry.get('dcName') == dc_name:
            msg_id = mid
            break
    if not msg_id:
        return {'newHp': 0, 'maxHp': 0, 'prevHp': 0, 'wasDefeated': False}

    dc_health_state = game.data.get('dcHealthState')
    if not isinstance(dc_health_state, dict):
        return {'newHp': 0, 'maxHp': 0, 'prevHp': 0, 'wasDefeated': False}
    return reduce_hp(dc_health_state, game.data, msg_id, fig_idx, damage, player_num)


def _handle_rush_push(game: GameState, action: Action) -> GameState:
    """Rush (Onar): push a hostile to an adjacent space, mutual 1 damage.

    Required params:
        target_figure_key (str)
        destination (str) — coord for the target (can equal current pos = no push)
    Effects:
        - Moves target to destination in figurePositions.
        - Both activator + target take 1 HP damage via dcHealthState.
        - Clears game.pendingRushPush.
    """
    target_fk = action.params.get('target_figure_key') or action.params.get('targetFigureKey')
    dest = action.params.get('destination') or action.params.get('space')
    if not target_fk or not dest:
        raise ValueError('rush_push_fig requires target_figure_key + destination params')
    pending = game.data.get('pendingRushPush')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('rush_push_fig: no pendingRushPush open')

    activator_pn = pending.get('playerNum')
    activator_fk = pending.get('activatorFigureKey')
    opp_pn = 2 if activator_pn == 1 else 1

    # Move target to destination
    positions_all = game.data.get('figurePositions') or {}
    opp_positions = dict(positions_all.get(opp_pn) or {})
    opp_positions[target_fk] = str(dest).lower()
    positions_all[opp_pn] = opp_positions
    game.data['figurePositions'] = positions_all

    # Apply 1 damage to both figures
    if target_fk:
        _apply_hp_damage_via_health_state(game, target_fk, opp_pn, 1)
    if activator_fk and activator_pn:
        _apply_hp_damage_via_health_state(game, activator_fk, activator_pn, 1)

    game.data['pendingRushPush'] = None
    return game


def _handle_shoulder_rush(game: GameState, action: Action) -> GameState:
    """Shoulder Rush: push target, apply damage from pending.damage (default 2).

    Required params: target_figure_key, destination.
    """
    target_fk = action.params.get('target_figure_key') or action.params.get('targetFigureKey')
    dest = action.params.get('destination') or action.params.get('space')
    if not target_fk or not dest:
        raise ValueError('shoulder_rush_fig requires target_figure_key + destination params')
    pending = game.data.get('pendingShoulderRush')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('shoulder_rush_fig: no pendingShoulderRush open')

    activator_pn = pending.get('playerNum')
    opp_pn = 2 if activator_pn == 1 else 1
    damage = int(pending.get('damage', 2))

    positions_all = game.data.get('figurePositions') or {}
    opp_positions = dict(positions_all.get(opp_pn) or {})
    opp_positions[target_fk] = str(dest).lower()
    positions_all[opp_pn] = opp_positions
    game.data['figurePositions'] = positions_all

    _apply_hp_damage_via_health_state(game, target_fk, opp_pn, damage)

    game.data['pendingShoulderRush'] = None
    return game


register(ActionType.RUSH_PUSH_FIG, _handle_rush_push)
register(ActionType.SHOULDER_RUSH_FIG, _handle_shoulder_rush)


# ---------------------------------------------------------------------------
# False Orders — accept "Move" or "Attack" for the controlled figure
# ---------------------------------------------------------------------------

def _handle_false_orders_move(game: GameState, action: Action) -> GameState:
    """False Orders: controlled figure moves to destination.

    Required param: destination (str).
    Uses pendingFalseOrders.controlledFigureKey + controlledPlayerNum.
    Clears pendingFalseOrders.
    """
    dest = action.params.get('destination') or action.params.get('space')
    if not dest:
        raise ValueError('false_orders_move requires destination param')
    pending = game.data.get('pendingFalseOrders')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('false_orders_move: no pendingFalseOrders open')
    controlled_fk = pending.get('controlledFigureKey')
    controlled_pn = pending.get('controlledPlayerNum')
    if not controlled_fk or controlled_pn not in (1, 2):
        raise ValueError('false_orders_move: pending missing controlled fields')

    positions_all = game.data.get('figurePositions') or {}
    player_positions = dict(positions_all.get(controlled_pn) or {})
    player_positions[controlled_fk] = str(dest).lower()
    positions_all[controlled_pn] = player_positions
    game.data['figurePositions'] = positions_all
    game.data['pendingFalseOrders'] = None
    return game


def _handle_false_orders_attack(game: GameState, action: Action) -> GameState:
    """False Orders: controlled figure attacks a target.

    Required param: target_figure_key (str).
    Records the attack intent on game.pendingFalseOrdersAttack; downstream
    combat handlers consume it when the attack resolves.
    Clears pendingFalseOrders.
    """
    target_fk = action.params.get('target_figure_key') or action.params.get('targetFigureKey')
    if not target_fk:
        raise ValueError('false_orders_attack requires target_figure_key param')
    pending = game.data.get('pendingFalseOrders')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('false_orders_attack: no pendingFalseOrders open')

    game.data['pendingFalseOrdersAttack'] = {
        'controlledFigureKey': pending.get('controlledFigureKey'),
        'controlledPlayerNum': pending.get('controlledPlayerNum'),
        'targetFigureKey': target_fk,
        'controllerPlayerNum': pending.get('controllerPlayerNum'),
    }
    game.data['pendingFalseOrders'] = None
    return game


register(ActionType.FALSE_ORDERS_MOVE, _handle_false_orders_move)
register(ActionType.FALSE_ORDERS_ATTACK, _handle_false_orders_attack)


# ---------------------------------------------------------------------------
# Strain choice — apply strain damage or discard CCs from deck top
# ---------------------------------------------------------------------------

def _handle_strain_choice_alldmg(game: GameState, action: Action) -> GameState:
    """Take all strain damage as HP damage on the strained figure.

    Consumes pendingStrainChoice.{amount, figureKey, playerNum}.
    Reduces HP via dcHealthState; clears pendingStrainChoice.
    """
    pending = game.data.get('pendingStrainChoice')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('strain_choice_alldmg: no pendingStrainChoice open')
    amount = int(pending.get('amount') or 0)
    fk = pending.get('figureKey')
    pn = pending.get('playerNum')
    if fk and pn in (1, 2) and amount > 0:
        _apply_hp_damage_via_health_state(game, fk, pn, amount)
    game.data['pendingStrainChoice'] = None
    return game


def _handle_strain_choice_discard(game: GameState, action: Action) -> GameState:
    """Discard N CCs from deck top to prevent strain damage.

    Required param: discard_count (int) — the number of CC discards chosen.
    ccCostPerStrain (default 1) is read from pending — under-duress effect
    raises it.

    Effects:
        - Drains discard_count * ccCostPerStrain CCs from deck top to discard
        - Remaining un-prevented strain applies as HP damage
        - Clears pendingStrainChoice
    """
    from python.engine.cards.deck import deck_size, discard_from_deck_top

    discard_count = action.params.get('discard_count')
    if discard_count is None:
        discard_count = action.params.get('discardCount')
    if not isinstance(discard_count, int) or discard_count < 0:
        raise ValueError('strain_choice_discard requires non-negative int discard_count')
    pending = game.data.get('pendingStrainChoice')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('strain_choice_discard: no pendingStrainChoice open')

    amount = int(pending.get('amount') or 0)
    cc_cost_per_strain = max(1, int(pending.get('ccCostPerStrain', 1)))
    fk = pending.get('figureKey')
    pn = pending.get('playerNum')

    total_to_drain = discard_count * cc_cost_per_strain
    if pn in (1, 2):
        available = deck_size(game, pn)
        actual_drain = min(total_to_drain, available)
        if actual_drain > 0:
            discard_from_deck_top(game, pn, actual_drain)
        strain_prevented = actual_drain // cc_cost_per_strain
    else:
        strain_prevented = 0

    remaining_strain = max(0, amount - strain_prevented)
    if fk and pn in (1, 2) and remaining_strain > 0:
        _apply_hp_damage_via_health_state(game, fk, pn, remaining_strain)
    game.data['pendingStrainChoice'] = None
    game.data['lastStrainChoice'] = {
        'amount': amount,
        'strainPrevented': strain_prevented,
        'hpDamage': remaining_strain,
    }
    return game


register(ActionType.STRAIN_CHOICE_ALLDMG, _handle_strain_choice_alldmg)
register(ActionType.STRAIN_CHOICE_DISCARD, _handle_strain_choice_discard)


# ---------------------------------------------------------------------------
# Bomb Drop / Orbital Bombardment space pickers — damage figures on coord(s)
# ---------------------------------------------------------------------------

def _apply_damage_to_figures_on_coord(game: GameState, coord: str,
                                      damage: int) -> List[Dict[str, Any]]:
    """Apply `damage` to every figure on `coord` (both players). Returns
    a list of {figureKey, playerNum, newHp, defeated} for the caller.
    """
    results = []
    coord_lc = str(coord).lower()
    positions_all = game.data.get('figurePositions') or {}
    for pn in (1, 2):
        poses = positions_all.get(pn) or {}
        for fk, pos in list(poses.items()):
            if not pos or str(pos).lower() != coord_lc:
                continue
            r = _apply_hp_damage_via_health_state(game, fk, pn, damage)
            results.append({
                'figureKey': fk, 'playerNum': pn,
                'newHp': r.get('newHp'), 'defeated': r.get('wasDefeated'),
            })
    return results


def _handle_bomb_drop_space(game: GameState, action: Action) -> GameState:
    """Bomb Drop: apply pending damage to figures on chosen space.

    Required params: msg_id, space.
    Consumes pendingBombDrop[msg_id].damage (default 2).
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    space = action.params.get('space')
    if not msg_id or not space:
        raise ValueError('bomb_drop_space requires msg_id + space params')
    pending_map = game.data.get('pendingBombDrop') or {}
    pending = pending_map.get(msg_id)
    if not pending:
        raise ValueError(
            f'bomb_drop_space: no pendingBombDrop for msg_id {msg_id!r}'
        )
    damage = int(pending.get('damage', 2))
    hits = _apply_damage_to_figures_on_coord(game, space, damage)
    pending_map = dict(pending_map)
    del pending_map[msg_id]
    game.data['pendingBombDrop'] = pending_map if pending_map else None
    game.data['lastBombDropHits'] = {'msgId': msg_id, 'hits': hits}
    return game


def _handle_ob_space(game: GameState, action: Action) -> GameState:
    """Orbital Bombardment: apply damage to figures on chosen space.

    Required params: msg_id, space.
    Tracks pendingOrbitalBombardment.{spacesChosen, spacesRemaining, damage}.
    On last space: applies damage to figures on all chosen spaces and
    clears the pending state.
    """
    msg_id = action.params.get('msg_id') or action.params.get('msgId')
    space = action.params.get('space')
    if not msg_id or not space:
        raise ValueError('ob_space requires msg_id + space params')
    pending = game.data.get('pendingOrbitalBombardment')
    if not pending or not isinstance(pending, Mapping):
        raise ValueError('ob_space: no pendingOrbitalBombardment open')
    spaces_chosen = list(pending.get('spacesChosen') or [])
    spaces_remaining = int(pending.get('spacesRemaining') or 1)
    damage = int(pending.get('damage', 2))
    spaces_chosen.append(str(space).lower())

    pending_mut = dict(pending)
    pending_mut['spacesChosen'] = spaces_chosen
    game.data['pendingOrbitalBombardment'] = pending_mut

    if len(spaces_chosen) >= spaces_remaining:
        all_hits = []
        for sp in spaces_chosen:
            all_hits.extend(_apply_damage_to_figures_on_coord(game, sp, damage))
        game.data['pendingOrbitalBombardment'] = None
        game.data['lastOrbitalBombardmentHits'] = {
            'msgId': msg_id, 'hits': all_hits, 'spaces': spaces_chosen,
        }
    return game


register(ActionType.BOMB_DROP_SPACE, _handle_bomb_drop_space)
register(ActionType.OB_SPACE, _handle_ob_space)


# ---------------------------------------------------------------------------
# DRAFT_RANDOM + UNDO — remaining setup / utility handlers
# ---------------------------------------------------------------------------

def _handle_draft_random(game: GameState, action: Action) -> GameState:
    """Record that a random draft was requested.

    Required params:
        player (int) ∈ {1, 2}
        squad (dict) — the randomly-drafted squad (caller generates it).

    Effects: equivalent to SUBMIT_SQUAD; stamps game.p{n}DraftedRandom = True
    so the caller can log the provenance.
    """
    player = int(action.player or 0)
    if player == 0:
        player = int(action.params.get('player') or 0)
    if player not in (1, 2):
        raise ValueError('draft_random requires player ∈ {1, 2}')
    squad = action.params.get('squad')
    if not isinstance(squad, Mapping):
        raise ValueError('draft_random requires squad (dict) param')
    key = 'player1Squad' if player == 1 else 'player2Squad'
    game.data[key] = dict(squad)
    drafted_key = 'p1DraftedRandom' if player == 1 else 'p2DraftedRandom'
    game.data[drafted_key] = True
    return game


register(ActionType.DRAFT_RANDOM, _handle_draft_random)
