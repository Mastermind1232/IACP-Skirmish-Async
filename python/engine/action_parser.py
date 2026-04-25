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


# Mid-activation customIds — recorded by the JS recorder once both fast-paths
# (dc_end_activation_ + pass_activation_turn_) start letting full activation
# cycles run. Python doesn't yet have stepper handlers that mutate state for
# these (handlers/dc-play-area.js + handlers/combat.js are not ported), so
# replay treats them as "applied no-ops": the action is parsed and dispatched,
# but the dispatch handler in stepper.py either no-ops or routes to a stub.
# This is intentional — it keeps drift surfacing real diffs (Python state
# diverges from JS state on each mid-activation step) instead of hiding them
# behind UnparseableCustomId/"unsupported" markers.
def _parse_dc_move(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    # dc_move_{msgId}_f{figureIndex}
    rest = cid[len('dc_move_'):]
    m = re.match(r'^(.+)_f(\d+)$', rest)
    if not m:
        return None
    msg_id = m.group(1)
    figure_idx = int(m.group(2))
    # Resolve figure_key from msgId via the headless `hl{pn}dc{i}` convention.
    pd = _msg_id_to_player_and_dc(msg_id)
    figure_key = None
    player_num = _user_to_player_num(game, uid)
    if pd is not None:
        player_num = pd[0]
        figure_key = _dc_index_to_figure_key(game, pd[0], pd[1])
        # Replace tail `-0` group index with `-{figure_idx}` for multi-figure DCs.
        if figure_key and figure_idx > 0:
            figure_key = re.sub(r'-(\d+)$', f'-{figure_idx}', figure_key)
    return Action(
        type=ActionType.MOVE_FIGURE, player=player_num,
        params={'msg_id': msg_id, 'figure_idx': figure_idx, 'figure_key': figure_key},
    )


def _parse_move_pick(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    # move_pick_{moveKey}_{coord} | move_pick_{moveKey}_done
    # moveKey is `{msgId}_{figureIdx}` (msgId = hl{pn}dc{i} so safe to rsplit).
    # The "done" variant means "stop moving here" — no coord, so skip in
    # replay (returning None lets the harness mark it unsupported).
    rest = cid[len('move_pick_'):]
    if rest.endswith('_done'):
        return None
    parts = rest.rsplit('_', 1)
    if len(parts) != 2:
        return None
    move_key, coord = parts
    # move_key shape: `hl{pn}dc{i}_f{idx}` — split off the `_f{idx}` tail.
    msg_id = move_key
    figure_idx = 0
    fk_match = re.match(r'^(.+)_f(\d+)$', move_key)
    if fk_match:
        msg_id = fk_match.group(1)
        figure_idx = int(fk_match.group(2))
    pd = _msg_id_to_player_and_dc(msg_id)
    figure_key = None
    player_num = _user_to_player_num(game, uid)
    if pd is not None:
        player_num = pd[0]
        figure_key = _dc_index_to_figure_key(game, pd[0], pd[1])
        if figure_key and figure_idx > 0:
            figure_key = re.sub(r'-(\d+)$', f'-{figure_idx}', figure_key)
    return Action(
        type=ActionType.MOVE_PICK_SPACE, player=player_num,
        params={'move_key': move_key, 'coord': coord, 'figure_key': figure_key},
    )


def _parse_dc_special(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    # dc_special_{specialIdx}_{msgId}
    rest = cid[len('dc_special_'):]
    m = re.match(r'^(\d+)_(.+)$', rest)
    if not m:
        return None
    special_idx = int(m.group(1))
    msg_id = m.group(2)
    pd = _msg_id_to_player_and_dc(msg_id)
    figure_key = None
    player_num = _user_to_player_num(game, uid)
    if pd is not None:
        player_num = pd[0]
        figure_key = _dc_index_to_figure_key(game, pd[0], pd[1])
    return Action(
        type=ActionType.DC_SPECIAL, player=player_num,
        params={'msg_id': msg_id, 'special_idx': special_idx, 'figure_key': figure_key},
    )


def _parse_dc_ability_choice(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    # dc_ability_choice_{gameId}_{msgId}_{abilityIdx}_{choiceIdx}
    # gameId can contain leading zeros but no underscores; msgId is `hl{pn}dc{i}`
    # also without underscores. So splitting by '_' from the right is safe:
    # last two segments are choiceIdx + abilityIdx, prior is msgId, head is gameId.
    rest = cid[len('dc_ability_choice_'):]
    parts = rest.split('_')
    if len(parts) < 4:
        return None
    try:
        choice_index = int(parts[-1])
        ability_idx = int(parts[-2])
    except ValueError:
        return None
    msg_id = parts[-3]
    pd = _msg_id_to_player_and_dc(msg_id)
    player_num = pd[0] if pd is not None else _user_to_player_num(game, uid)
    return Action(
        type=ActionType.DC_ABILITY_CHOICE, player=player_num,
        params={
            'msg_id': msg_id,
            'special_idx': ability_idx,
            'choice_index': choice_index,
        },
    )


def _parse_phase_gate_ready(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    # phase_gate_ready_{gameId}
    return Action(
        type=ActionType.PHASE_GATE_READY, player=_user_to_player_num(game, uid),
    )


def _parse_combat_ready(cid: str, uid: str, game: Mapping[str, Any], opts: Mapping[str, Any]) -> Optional[Action]:
    # combat_ready_{gameId}
    return Action(
        type=ActionType.COMBAT_READY, player=_user_to_player_num(game, uid),
    )


# Dispatch table: exact prefix → parser function.
_PARSERS = (
    ('auto_deploy_', _parse_auto_deploy),
    ('pass_activation_turn_', _parse_pass_activation_turn),
    ('status_phase_', _parse_end_activation_phase),
    ('end_end_of_round_', _parse_end_end_of_round),
    ('dc_end_activation_', _parse_dc_end_activation),
    ('dc_activate_', _parse_dc_activate),
    # Mid-activation prefixes (recorded but no Python state mutation yet)
    ('dc_move_', _parse_dc_move),
    ('move_pick_', _parse_move_pick),
    ('dc_special_', _parse_dc_special),
    ('dc_ability_choice_', _parse_dc_ability_choice),
    ('phase_gate_ready_', _parse_phase_gate_ready),
    ('combat_ready_', _parse_combat_ready),
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
    # Prefer the JS-resolved keys from pendingCombat (set by the attack
    # handler the moment it ran). Falls back to msgId resolution +
    # attackTargets list when pendingCombat isn't populated.
    pd = _msg_id_to_player_and_dc(msg_id)
    attacker_key = None
    target_key = None
    player_num = _user_to_player_num(game, uid)
    pc = game.get('pendingCombat') if isinstance(game, Mapping) else None
    if isinstance(pc, Mapping):
        attacker_key = (pc.get('attackerFigureKey')
                        or (pc.get('attacker') or {}).get('figureKey')
                        if isinstance(pc.get('attacker'), Mapping) else
                        pc.get('attackerFigureKey'))
        target = pc.get('target')
        if isinstance(target, Mapping):
            target_key = target.get('figureKey') or target.get('figure_key')
        if pc.get('attackerPlayerNum'):
            player_num = int(pc['attackerPlayerNum'])
    if not attacker_key and pd is not None:
        player_num = pd[0]
        attacker_key = _dc_index_to_figure_key(game, pd[0], pd[1])
        if attacker_key and figure_idx > 0:
            attacker_key = re.sub(r'-(\d+)$', f'-{figure_idx}', attacker_key)
    if not target_key:
        targets_map = game.get('attackTargets') if isinstance(game, Mapping) else None
        if isinstance(targets_map, Mapping):
            bucket = targets_map.get(f'{msg_id}_{figure_idx}')
            if isinstance(bucket, list) and 0 <= target_idx < len(bucket):
                t = bucket[target_idx]
                if isinstance(t, Mapping):
                    target_key = t.get('figureKey') or t.get('figure_key')
    return Action(
        type=ActionType.ATTACK_TARGET, player=player_num,
        params={'msg_id': msg_id, 'figure_idx': figure_idx,
                'target_idx': target_idx,
                'attacker_key': attacker_key, 'target_key': target_key},
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
    side_raw = parts[1]
    # Python handler expects full names ('attacker' / 'defender'); the JS
    # customId carries shorthand ('atk' / 'def'). Normalize.
    side = {'atk': 'attacker', 'def': 'defender'}.get(side_raw, side_raw)
    tail = parts[2]
    if tail == 'done':
        return Action(
            type=ActionType.COMBAT_REROLL, player=_user_to_player_num(game, uid),
            params={'side': side, 'done': True, 'indices': []},
        )
    try:
        idx = int(tail)
    except ValueError:
        return None
    return Action(
        type=ActionType.COMBAT_REROLL, player=_user_to_player_num(game, uid),
        params={'side': side, 'die_idx': idx, 'indices': [idx]},
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
            type=ActionType.COMBAT_SKIP_SURGES, player=_user_to_player_num(game, uid),
            params={},
        )
    if tail == 'bleed_prevention':
        return Action(
            type=ActionType.COMBAT_SURGE, player=_user_to_player_num(game, uid),
            params={'ability': 'bleed_prevention'},
        )
    try:
        idx = int(tail)
    except ValueError:
        return None
    # Look up the surge ability id from game.pendingCombat.surges[idx].
    pc = game.get('pendingCombat') if isinstance(game, Mapping) else None
    ability = None
    if isinstance(pc, Mapping):
        surges = pc.get('surges') or pc.get('availableSurges') or []
        if isinstance(surges, list) and 0 <= idx < len(surges):
            entry = surges[idx]
            if isinstance(entry, Mapping):
                ability = entry.get('id') or entry.get('abilityId') or entry.get('ability')
            elif isinstance(entry, str):
                ability = entry
    if not ability:
        ability = f'surge_{idx}'  # fallback so handler doesn't crash
    return Action(
        type=ActionType.COMBAT_SURGE, player=_user_to_player_num(game, uid),
        params={'surge_idx': idx, 'ability': ability},
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
    # Handler needs `damage (int)` and optionally `defeated (bool)`. Read
    # them from the pendingCombat snapshot the JS engine has already filled.
    pc = game.get('pendingCombat') if isinstance(game, Mapping) else None
    damage = 0
    defeated = False
    if isinstance(pc, Mapping):
        # JS stamps `damage`/`finalDamage`/`netDamage` depending on phase.
        for k in ('finalDamage', 'damage', 'netDamage', 'damageDealt'):
            v = pc.get(k)
            if isinstance(v, int) and v >= 0:
                damage = v
                break
        defeated = bool(pc.get('defeated') or pc.get('targetDefeated'))
    return Action(
        type=ActionType.COMBAT_RESOLVE, player=_user_to_player_num(game, uid),
        params={'damage': damage, 'defeated': defeated},
    )


def _parse_combat_gate(cid, uid, game, opts):
    # combat_gate_{gameId}
    # The handler requires a `gate (str)` param to stamp. The customId
    # carries no gate info; in JS the gate is implicit in the current UI
    # phase. Best proxy in replay: read the next-step phase from
    # pendingCombat.nextPhase or pendingCombat.phase.
    pc = game.get('pendingCombat') if isinstance(game, Mapping) else None
    gate = None
    if isinstance(pc, Mapping):
        gate = pc.get('nextPhase') or pc.get('phase') or 'gate'
    if not gate:
        gate = 'gate'
    return Action(
        type=ActionType.COMBAT_GATE, player=_user_to_player_num(game, uid),
        params={'gate': gate},
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
    parse_state: Optional[Mapping[str, Any]] = None,
) -> GameState:
    """Parse a JS customId into a Python Action and apply it.

    parse_state: optional alternate state for the parser (typically the
    previous recorded JS snapshot, used during drift replay so parsers can
    read transient UI fields Python's stubs don't populate). Falls back to
    `game` when omitted.

    Raises UnparseableCustomId if no parser handles the prefix.
    Any error from the action handler itself propagates unchanged.
    """
    from python.engine.stepper import step  # local import avoids cycle
    parsed = parse_custom_id(
        custom_id, user_id, parse_state if parse_state is not None else game,
        action_opts,
    )
    if parsed is None:
        raise UnparseableCustomId(
            f'no parser for customId={custom_id!r} '
            f'(supported prefixes: {supported_prefixes()})'
        )
    return step(game, parsed.action)
