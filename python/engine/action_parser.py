"""Parse a JS customId into a Python Action object.

The JS game engine routes button clicks by customId string (e.g.
`auto_deploy_00001`, `dc_activate_00001_1_0`). For the Python replay
harness and eventual full stack, we need the inverse of
`build_custom_id`: take a customId + userId + game state, return an
Action ready for `stepper.step()`.

This parser is INTENTIONALLY SMALL at bootstrap. It covers only the
action types that have Python handlers registered today. As new
handlers land (per the Phase 7 atomic task list in the Path-A+ plan),
their parsers are registered here alongside them.

Call sites:
    parse_custom_id(custom_id, user_id, game, action_opts) -> Action or None
    unparseable → None (caller decides how to treat — usually "skip + report")
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, Mapping, Optional

from python.engine.actions import ActionType
from python.engine.state import GameState


class ParsedAction:
    """Tiny wrapper so the parser can return both the Action and metadata
    (e.g. which customId prefix it matched, for diagnostics)."""

    __slots__ = ('action', 'prefix', 'raw_custom_id')

    def __init__(self, action, prefix: str, raw_custom_id: str) -> None:
        self.action = action
        self.prefix = prefix
        self.raw_custom_id = raw_custom_id


# -- Helpers ----------------------------------------------------------------

def _user_to_player_num(game: Mapping[str, Any], user_id: str) -> int:
    """Map a Discord-style user id to player number (1 or 2). Falls back
    to the game's active player if no match."""
    p1_id = game.get('player1Id')
    p2_id = game.get('player2Id')
    if user_id and user_id == p1_id:
        return 1
    if user_id and user_id == p2_id:
        return 2
    active = game.get('currentActivationTurnPlayerId') or game.get('activePlayer')
    if active == p1_id:
        return 1
    if active == p2_id:
        return 2
    if isinstance(active, int):
        return active
    return 1


def _dc_index_to_figure_key(game: Mapping[str, Any], player_num: int, dc_index: int) -> Optional[str]:
    """Look up a player's figure_key for the first live figure of the DC
    at `dc_index` in the player's DC list.

    Mirrors JS `hl{pn}dc{i}` → `{dc_name}-{group_index}-{figure_index}`.
    Prefers the DC entry's `dgIndex` field (JS-native, 1-based for
    unique DCs, sequential for multi-group) — falls back to counting
    priors when dgIndex is missing.
    """
    dc_list_key = 'p1DcList' if player_num == 1 else 'p2DcList'
    dc_list = game.get(dc_list_key) or []
    if not (0 <= dc_index < len(dc_list)):
        return None
    dc = dc_list[dc_index]
    dc_name = dc.get('dcName') if isinstance(dc, dict) else dc
    if not dc_name:
        return None

    # Prefer dgIndex from the DC entry (JS-native).
    dg = dc.get('dgIndex') if isinstance(dc, dict) else None

    fps = (game.get('figurePositions') or {})
    positions = fps.get(player_num) or fps.get(str(player_num)) or {}

    if dg is not None:
        prefix = f'{dc_name}-{dg}-'
        for fkey, coord in positions.items():
            if isinstance(fkey, str) and fkey.startswith(prefix) and coord:
                return fkey
        # dgIndex didn't match — fall through to prior-counting.

    # Fallback: count prior entries of the same DC name.
    group_index = 0
    for i in range(dc_index):
        prior = dc_list[i]
        prior_name = prior.get('dcName') if isinstance(prior, dict) else prior
        if prior_name == dc_name:
            group_index += 1
    prefix = f'{dc_name}-{group_index}-'
    for fkey, coord in positions.items():
        if isinstance(fkey, str) and fkey.startswith(prefix) and coord:
            return fkey
    return None


_MSG_ID_RE = re.compile(r'hl(\d)dc(\d+)')


def _msg_id_to_player_and_dc(msg_id: str) -> Optional[tuple]:
    """Parse `hl1dc0` → (player_num=1, dc_index=0). Returns None if
    the msg_id is not in the headless format."""
    m = _MSG_ID_RE.match(msg_id or '')
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


# -- Parsers ---------------------------------------------------------------

from python.engine.stepper import Action


def _parse_auto_deploy(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    return Action(type=ActionType.AUTO_DEPLOY, player=0)


def _parse_pass_activation_turn(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    player = _user_to_player_num(game, uid)
    return Action(type=ActionType.PASS_ACTIVATION_TURN, player=player)


def _parse_end_activation_phase(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    player = _user_to_player_num(game, uid)
    return Action(type=ActionType.END_ACTIVATION_PHASE, player=player)


def _parse_end_end_of_round(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    return Action(type=ActionType.END_END_OF_ROUND, player=0)


def _parse_dc_end_activation(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    # customId: dc_end_activation_{msg_id}
    remainder = cid[len('dc_end_activation_'):]
    parsed = _msg_id_to_player_and_dc(remainder)
    if parsed is None:
        return Action(type=ActionType.DC_END_ACTIVATION, player=_user_to_player_num(game, uid))
    player_num, _ = parsed
    return Action(type=ActionType.DC_END_ACTIVATION, player=player_num)


def _parse_dc_activate(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    # customId: dc_activate_{game_id}_{player_num}_{dc_index}
    # Split off the prefix, then take the last two trailing integers.
    remainder = cid[len('dc_activate_'):]
    parts = remainder.rsplit('_', 2)
    if len(parts) != 3:
        return None
    try:
        player_num = int(parts[1])
        dc_index = int(parts[2])
    except ValueError:
        return None
    figure_key = _dc_index_to_figure_key(game, player_num, dc_index)
    if not figure_key:
        return None
    return Action(
        type=ActionType.ACTIVATE_DC, player=player_num,
        params={'figure_key': figure_key},
    )


# -- Parsers for the bridge-fallback prefixes ------------------------------

def _tail(cid: str, prefix: str) -> str:
    return cid[len(prefix):]


def _parse_cc_confirm_play(cid, uid, game, opts):
    # cc_confirm_play_{gameId}
    return Action(type=ActionType.CC_CONFIRM_PLAY, player=_user_to_player_num(game, uid))


def _parse_cc_cancel_play(cid, uid, game, opts):
    return Action(type=ActionType.CC_CANCEL_PLAY, player=_user_to_player_num(game, uid))


def _parse_celebration_play(cid, uid, game, opts):
    # celebration_play_{gameId}
    return Action(type=ActionType.CELEBRATION_PLAY, player=_user_to_player_num(game, uid))


def _parse_celebration_pass(cid, uid, game, opts):
    return Action(type=ActionType.CELEBRATION_PASS, player=_user_to_player_num(game, uid))


def _parse_cover_fire_block(cid, uid, game, opts):
    # cover_fire_block_{gameId}_{playerNum}_{figureKey}
    rest = _tail(cid, 'cover_fire_block_')
    parts = rest.split('_', 2)
    if len(parts) < 3:
        return None
    try:
        player_num = int(parts[1])
    except ValueError:
        player_num = _user_to_player_num(game, uid)
    figure_key = parts[2]
    return Action(
        type=ActionType.COVER_FIRE_BLOCK, player=player_num,
        params={'figure_key': figure_key},
    )


def _parse_cover_fire_skip(cid, uid, game, opts):
    return Action(type=ActionType.COVER_FIRE_SKIP, player=_user_to_player_num(game, uid))


def _parse_comm_disruption_play(cid, uid, game, opts):
    return Action(type=ActionType.COMM_DISRUPTION_PLAY, player=_user_to_player_num(game, uid))


def _parse_comm_disruption_skip(cid, uid, game, opts):
    return Action(type=ActionType.COMM_DISRUPTION_SKIP, player=_user_to_player_num(game, uid))


def _parse_rush_push_skip(cid, uid, game, opts):
    # rush_push_skip_{gameId}_{msgId}
    rest = _tail(cid, 'rush_push_skip_')
    parts = rest.split('_', 1)
    msg_id = parts[1] if len(parts) > 1 else ''
    return Action(
        type=ActionType.RUSH_PUSH_SKIP, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id},
    )


def _parse_rush_push_fig(cid, uid, game, opts):
    # rush_push_fig_{gameId}_{msgId}_{figIndex}
    rest = _tail(cid, 'rush_push_fig_')
    parts = rest.rsplit('_', 1)
    if len(parts) != 2:
        return None
    head, idx = parts
    head_parts = head.split('_', 1)
    msg_id = head_parts[1] if len(head_parts) > 1 else ''
    try:
        fig_idx = int(idx)
    except ValueError:
        return None
    return Action(
        type=ActionType.RUSH_PUSH_FIG, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id, 'fig_idx': fig_idx},
    )


def _parse_shoulder_rush_skip(cid, uid, game, opts):
    rest = _tail(cid, 'shoulder_rush_skip_')
    parts = rest.split('_', 1)
    msg_id = parts[1] if len(parts) > 1 else ''
    return Action(
        type=ActionType.SHOULDER_RUSH_SKIP, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id},
    )


def _parse_shoulder_rush_fig(cid, uid, game, opts):
    rest = _tail(cid, 'shoulder_rush_fig_')
    parts = rest.rsplit('_', 1)
    if len(parts) != 2:
        return None
    head, idx = parts
    head_parts = head.split('_', 1)
    msg_id = head_parts[1] if len(head_parts) > 1 else ''
    try:
        fig_idx = int(idx)
    except ValueError:
        return None
    return Action(
        type=ActionType.SHOULDER_RUSH_FIG, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id, 'fig_idx': fig_idx},
    )


def _parse_false_orders_skip(cid, uid, game, opts):
    rest = _tail(cid, 'false_orders_skip_')
    parts = rest.split('_', 1)
    msg_id = parts[1] if len(parts) > 1 else ''
    return Action(
        type=ActionType.FALSE_ORDERS_SKIP, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id},
    )


def _parse_false_orders_action(cid, uid, game, opts):
    # false_orders_action_{gameId}_{msgId}_{kind: move|attack|skip}
    rest = _tail(cid, 'false_orders_action_')
    parts = rest.rsplit('_', 1)
    if len(parts) != 2:
        return None
    head, kind = parts
    head_parts = head.split('_', 1)
    msg_id = head_parts[1] if len(head_parts) > 1 else ''
    player = _user_to_player_num(game, uid)
    if kind == 'move':
        return Action(type=ActionType.FALSE_ORDERS_MOVE, player=player,
                       params={'msg_id': msg_id})
    if kind == 'attack':
        return Action(type=ActionType.FALSE_ORDERS_ATTACK, player=player,
                       params={'msg_id': msg_id})
    if kind == 'skip':
        return Action(type=ActionType.FALSE_ORDERS_SKIP, player=player,
                       params={'msg_id': msg_id})
    return None


def _parse_missile_salvo_done(cid, uid, game, opts):
    rest = _tail(cid, 'missile_salvo_done_')
    parts = rest.split('_', 1)
    msg_id = parts[1] if len(parts) > 1 else ''
    return Action(
        type=ActionType.MISSILE_SALVO_DONE, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id},
    )


def _parse_missile_salvo_die(cid, uid, game, opts):
    # missile_salvo_die_{color}_{gameId}_{msgId}
    rest = _tail(cid, 'missile_salvo_die_')
    parts = rest.split('_', 2)
    if len(parts) < 3:
        return None
    color, _game_id, msg_id = parts[0], parts[1], parts[2]
    return Action(
        type=ActionType.MISSILE_SALVO_DIE, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id, 'color': color},
    )


def _parse_arsenal_pick(cid, uid, game, opts):
    # arsenal_pick_{gameId}_{msgId}_{figureIndex}
    rest = _tail(cid, 'arsenal_pick_')
    parts = rest.rsplit('_', 1)
    if len(parts) != 2:
        return None
    head, idx = parts
    head_parts = head.split('_', 1)
    msg_id = head_parts[1] if len(head_parts) > 1 else ''
    try:
        fig_idx = int(idx)
    except ValueError:
        return None
    return Action(
        type=ActionType.ARSENAL_PICK, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id, 'figure_idx': fig_idx},
    )


def _parse_pounce_space(cid, uid, game, opts):
    # pounce_space_{gameId}_{msgId}_{figureIndex}_{space}
    rest = _tail(cid, 'pounce_space_')
    parts = rest.split('_', 3)
    if len(parts) != 4:
        return None
    _game_id, msg_id, fig_idx_str, space = parts
    try:
        fig_idx = int(fig_idx_str)
    except ValueError:
        return None
    return Action(
        type=ActionType.POUNCE_SPACE, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id, 'figure_idx': fig_idx, 'space': space},
    )


def _parse_deployment_fig(cid, uid, game, opts):
    # deployment_fig_{gameId}_{playerNum}_{dcIndex}
    rest = _tail(cid, 'deployment_fig_')
    parts = rest.rsplit('_', 2)
    if len(parts) != 3:
        return None
    try:
        player_num = int(parts[1])
        dc_idx = int(parts[2])
    except ValueError:
        return None
    return Action(
        type=ActionType.DEPLOY_FIGURE, player=player_num,
        params={'dc_index': dc_idx},
    )


# Dispatch table: exact prefix → parser function.
_PARSERS = (
    ('auto_deploy_', _parse_auto_deploy),
    ('pass_activation_turn_', _parse_pass_activation_turn),
    ('status_phase_', _parse_end_activation_phase),
    ('end_end_of_round_', _parse_end_end_of_round),
    ('dc_end_activation_', _parse_dc_end_activation),
    ('dc_activate_', _parse_dc_activate),
    # Bridge-fallback prefixes (owned by stepper_bridge)
    ('cc_confirm_play_', _parse_cc_confirm_play),
    ('cc_cancel_play_', _parse_cc_cancel_play),
    ('celebration_play_', _parse_celebration_play),
    ('celebration_pass_', _parse_celebration_pass),
    ('cover_fire_block_', _parse_cover_fire_block),
    ('cover_fire_skip_', _parse_cover_fire_skip),
    ('comm_disruption_play_', _parse_comm_disruption_play),
    ('comm_disruption_skip_', _parse_comm_disruption_skip),
    ('rush_push_skip_', _parse_rush_push_skip),
    ('rush_push_fig_', _parse_rush_push_fig),
    ('shoulder_rush_skip_', _parse_shoulder_rush_skip),
    ('shoulder_rush_fig_', _parse_shoulder_rush_fig),
    ('false_orders_skip_', _parse_false_orders_skip),
    ('false_orders_action_', _parse_false_orders_action),
    ('missile_salvo_done_', _parse_missile_salvo_done),
    ('missile_salvo_die_', _parse_missile_salvo_die),
    ('arsenal_pick_', _parse_arsenal_pick),
    ('pounce_space_', _parse_pounce_space),
    ('deployment_fig_', _parse_deployment_fig),
)


def _parse_attack_target(cid, uid, game, opts):
    # attack_target_{msgId}_{figureIndex}_{targetIndex}
    rest = cid[len('attack_target_'):]
    parts = rest.rsplit('_', 2)
    if len(parts) != 3:
        return None
    msg_id, fig_str, tgt_str = parts
    try:
        figure_idx = int(fig_str)
        target_idx = int(tgt_str)
    except ValueError:
        return None
    return Action(
        type=ActionType.ATTACK_TARGET, player=_user_to_player_num(game, uid),
        params={'msg_id': msg_id, 'figure_idx': figure_idx,
                'target_idx': target_idx},
    )


def _parse_combat_roll(cid, uid, game, opts):
    # combat_roll_{gameId}
    return Action(type=ActionType.COMBAT_ROLL, player=_user_to_player_num(game, uid))


def _parse_combat_reroll(cid, uid, game, opts):
    # combat_reroll_{gameId}_{side}_{idx|done} where side ∈ {atk, def}
    rest = cid[len('combat_reroll_'):]
    parts = rest.split('_')
    if len(parts) < 3:
        return None
    side = parts[1]
    tail = parts[2]
    if tail == 'done':
        return Action(
            type=ActionType.COMBAT_REROLL, player=_user_to_player_num(game, uid),
            params={'side': side, 'done': True},
        )
    try:
        idx = int(tail)
    except ValueError:
        return None
    return Action(
        type=ActionType.COMBAT_REROLL, player=_user_to_player_num(game, uid),
        params={'side': side, 'die_idx': idx},
    )


def _parse_combat_surge(cid, uid, game, opts):
    # combat_surge_{gameId}_{idx} | combat_surge_{gameId}_done | combat_surge_{gameId}_bleed_prevention
    rest = cid[len('combat_surge_'):]
    parts = rest.split('_', 1)
    if len(parts) < 2:
        return None
    tail = parts[1]
    if tail == 'done':
        return Action(
            type=ActionType.COMBAT_SURGE, player=_user_to_player_num(game, uid),
            params={'done': True},
        )
    if tail == 'bleed_prevention':
        return Action(
            type=ActionType.COMBAT_SURGE, player=_user_to_player_num(game, uid),
            params={'spend': 'bleed_prevention'},
        )
    try:
        idx = int(tail)
    except ValueError:
        return None
    return Action(
        type=ActionType.COMBAT_SURGE, player=_user_to_player_num(game, uid),
        params={'surge_idx': idx},
    )


def _parse_combat_token(cid, uid, game, opts):
    # combat_token_{gameId}_{prefix}_{index}
    rest = cid[len('combat_token_'):]
    parts = rest.rsplit('_', 1)
    if len(parts) != 2:
        return None
    head, idx_str = parts
    head_parts = head.split('_', 1)
    token_prefix = head_parts[1] if len(head_parts) > 1 else ''
    try:
        idx = int(idx_str)
    except ValueError:
        return None
    return Action(
        type=ActionType.COMBAT_TOKEN, player=_user_to_player_num(game, uid),
        params={'token_prefix': token_prefix, 'idx': idx},
    )


def _parse_combat_resolve_ready(cid, uid, game, opts):
    # combat_resolve_ready_{gameId}
    return Action(
        type=ActionType.COMBAT_RESOLVE, player=_user_to_player_num(game, uid),
    )


def _parse_combat_gate(cid, uid, game, opts):
    # combat_gate_{gameId}
    return Action(
        type=ActionType.COMBAT_GATE, player=_user_to_player_num(game, uid),
    )


def _parse_combat_passive(cid, uid, game, opts):
    # combat_passive_{gameId}_{choiceIdx}
    rest = cid[len('combat_passive_'):]
    parts = rest.rsplit('_', 1)
    if len(parts) == 2:
        try:
            idx = int(parts[1])
        except ValueError:
            idx = None
    else:
        idx = None
    return Action(
        type=ActionType.COMBAT_PASSIVE, player=_user_to_player_num(game, uid),
        params={'choice_idx': idx} if idx is not None else {},
    )


def _parse_pre_reroll(cid, uid, game, opts):
    # pre_reroll_{gameId}_{variant} (variant = twin_sabers_atk | _def | skip | shrewd_N | resourceful_atk ...)
    rest = cid[len('pre_reroll_'):]
    parts = rest.split('_', 1)
    if len(parts) < 2:
        return None
    variant = parts[1]
    # No real stepper action yet — pre_reroll is a UI-side modal that resolves
    # via combat_reroll. We just mark the game with the variant for downstream
    # parsers. Route to COMBAT_REROLL with a 'variant' param; the stepper can
    # choose to no-op or resolve based on its own state.
    return Action(
        type=ActionType.COMBAT_REROLL, player=_user_to_player_num(game, uid),
        params={'pre_reroll_variant': variant},
    )


# Append the core-combat parsers after their defs so the tuple references
# resolve cleanly at import time.
_PARSERS = _PARSERS + (
    ('attack_target_', _parse_attack_target),
    ('combat_roll_', _parse_combat_roll),
    ('combat_reroll_', _parse_combat_reroll),
    ('combat_surge_', _parse_combat_surge),
    ('combat_token_', _parse_combat_token),
    ('combat_resolve_ready_', _parse_combat_resolve_ready),
    ('combat_gate_', _parse_combat_gate),
    ('combat_passive_', _parse_combat_passive),
    ('pre_reroll_', _parse_pre_reroll),
)


def parse_custom_id(
    custom_id: str,
    user_id: str = '',
    game: Optional[Mapping[str, Any]] = None,
    action_opts: Optional[Mapping[str, Any]] = None,
) -> Optional[ParsedAction]:
    """Parse a JS customId into a Python Action.

    Returns None (not an exception) when the customId isn't a prefix we
    currently handle — callers can treat as "skip, not error".
    """
    if not isinstance(custom_id, str) or not custom_id:
        return None
    game_data = game.data if isinstance(game, GameState) else (game or {})
    opts = action_opts or {}
    # Longest-prefix-first ensures dc_end_activation_ wins over dc_ if
    # we ever add a broader dc_ parser.
    for prefix, fn in sorted(_PARSERS, key=lambda p: -len(p[0])):
        if custom_id.startswith(prefix):
            action = fn(custom_id, user_id, game_data, opts)
            if action is None:
                return None
            return ParsedAction(action=action, prefix=prefix, raw_custom_id=custom_id)
    return None


def supported_prefixes() -> tuple:
    """List of customId prefixes this parser currently handles."""
    return tuple(p for p, _ in _PARSERS)


class UnparseableCustomId(ValueError):
    """Raised by `step_custom_id` when a customId has no registered parser
    (or the parser returned None because the game state didn't have the
    required references)."""


def step_custom_id(
    game: GameState,
    custom_id: str,
    user_id: str = '',
    action_opts: Optional[Mapping[str, Any]] = None,
) -> GameState:
    """Parse a JS customId into a Python Action and apply it.

    Raises UnparseableCustomId if no parser handles the prefix.
    Any error from the action handler itself propagates unchanged.
    """
    from python.engine.stepper import step  # local import avoids cycle
    parsed = parse_custom_id(custom_id, user_id, game, action_opts)
    if parsed is None:
        raise UnparseableCustomId(
            f'no parser for customId={custom_id!r} '
            f'(supported prefixes: {supported_prefixes()})'
        )
    return step(game, parsed.action)
