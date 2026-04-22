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

    This mirrors JS `hl{pn}dc{i}` → `{dc_name}-{group_index}-{figure_index}`
    mapping. Returns None if the DC/figure can't be found.
    """
    dc_list_key = 'p1DcList' if player_num == 1 else 'p2DcList'
    dc_list = game.get(dc_list_key) or []
    if not (0 <= dc_index < len(dc_list)):
        return None
    dc = dc_list[dc_index]
    dc_name = dc.get('dcName') if isinstance(dc, dict) else dc
    if not dc_name:
        return None
    # Count how many groups of this DC precede this index (for group_index).
    group_index = 0
    for i in range(dc_index):
        prior = dc_list[i]
        prior_name = prior.get('dcName') if isinstance(prior, dict) else prior
        if prior_name == dc_name:
            group_index += 1
    # Find the first live figure (figure_index 0..N) of that group on board.
    fps = (game.get('figurePositions') or {})
    positions = fps.get(player_num) or fps.get(str(player_num)) or {}
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


# Dispatch table: exact prefix → parser function.
_PARSERS = (
    ('auto_deploy_', _parse_auto_deploy),
    ('pass_activation_turn_', _parse_pass_activation_turn),
    ('status_phase_', _parse_end_activation_phase),
    ('end_end_of_round_', _parse_end_end_of_round),
    ('dc_end_activation_', _parse_dc_end_activation),
    ('dc_activate_', _parse_dc_activate),
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
