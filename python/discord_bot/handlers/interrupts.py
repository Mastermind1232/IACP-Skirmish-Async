"""Interrupt Discord handlers — thin port of src/handlers/interrupts.js.

Covers the pure-skip / dismiss paths of interrupt-window CCs and
special abilities. Each clears the relevant `pending*` key. The
"actually use" variants (still_faster_use_, squad_swarm_yes_, etc.)
still need the combat/movement orchestrator integration.

  still_faster_skip_{gameId}_{msgId}         — clears pendingStillFaster
  squad_swarm_no_{gameId}_{msgId}             — clears pendingSquadSwarm
  self_destruct_probe_skip_{gameId}           — clears pendingSelfDestructProbe
  self_destruct_protocol_skip_{gameId}        — clears pendingSelfDestructProtocol
  last_resort_skip_{gameId}                   — clears pendingLastResort
  submit_fight_skip_{gameId}                  — clears pendingSubmitToFight
  scavenged_walker_skip_{gameId}              — clears pendingScavengedWalkerAttack
  dbh_skip_{gameId}                           — clears pendingDrivenByHatred
  executor_skip_{gameId}                      — clears pendingExecutor
  extra_protection_skip_{gameId}              — clears pendingExtraProtection
  bm_skip_{gameId}_{msgId}_{playerNum}        — clears pendingBlackMarket[playerNum]
"""
from __future__ import annotations

from typing import Any, Dict

from python.discord_bot.handlers import register
from python.discord_bot.handlers.combat_special_effects import (
    _make_pending_skip_handler,
)


_handle_still_faster_skip = _make_pending_skip_handler(
    'still_faster_skip_', 'pendingStillFaster', allow_trailing=True,
)
_handle_squad_swarm_no = _make_pending_skip_handler(
    'squad_swarm_no_', 'pendingSquadSwarm', allow_trailing=True,
)
_handle_self_destruct_probe_skip = _make_pending_skip_handler(
    'self_destruct_probe_skip_', 'pendingSelfDestructProbe',
)
_handle_self_destruct_protocol_skip = _make_pending_skip_handler(
    'self_destruct_protocol_skip_', 'pendingSelfDestructProtocol',
)
_handle_last_resort_skip = _make_pending_skip_handler(
    'last_resort_skip_', 'pendingLastResort',
)
_handle_submit_fight_skip = _make_pending_skip_handler(
    'submit_fight_skip_', 'pendingSubmitToFight',
)
_handle_scavenged_walker_skip = _make_pending_skip_handler(
    'scavenged_walker_skip_', 'pendingScavengedWalkerAttack',
)
_handle_dbh_skip = _make_pending_skip_handler(
    'dbh_skip_', 'pendingDrivenByHatred',
)
_handle_executor_skip = _make_pending_skip_handler(
    'executor_skip_', 'pendingExecutor',
)
_handle_extra_protection_skip = _make_pending_skip_handler(
    'extra_protection_skip_', 'pendingExtraProtection',
)


register('still_faster_skip_', _handle_still_faster_skip, 'core')
register('squad_swarm_no_', _handle_squad_swarm_no, 'core')
register('self_destruct_probe_skip_', _handle_self_destruct_probe_skip, 'core')
register('self_destruct_protocol_skip_', _handle_self_destruct_protocol_skip, 'core')
register('last_resort_skip_', _handle_last_resort_skip, 'core')
register('submit_fight_skip_', _handle_submit_fight_skip, 'core')
register('scavenged_walker_skip_', _handle_scavenged_walker_skip, 'core')
register('dbh_skip_', _handle_dbh_skip, 'core')
register('executor_skip_', _handle_executor_skip, 'core')
register('extra_protection_skip_', _handle_extra_protection_skip, 'core')


# bm_skip_ is Black Market skip — JS parses (gameId, msgId, playerNum)
# and clears game.pendingBlackMarket?.[playerNum]. The factory doesn't
# handle per-player pending maps, so keep it as a small explicit handler.
def _handle_bm_skip(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """bm_skip_{gameId}_{msgId}_{playerNum} — Black Market skip.
    Mirrors src/handlers/interrupts.js:850-854 skip branch. Clears
    game.pendingBlackMarket[playerNum]; drops the outer key when empty.
    """
    import re
    data_cid = getattr(interaction, 'data', None)
    if isinstance(data_cid, dict) and 'custom_id' in data_cid:
        cid = data_cid['custom_id']
    else:
        cid = (getattr(interaction, 'customId', None)
               or getattr(interaction, 'custom_id', None) or '')
    m = re.match(r'^bm_skip_([^_]+)_([^_]+)_([12])$', cid)
    if not m:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = m.group(1)
    player_num = int(m.group(3))

    get_game = ctx.get('get_game')
    game = get_game(game_id) if callable(get_game) else None
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game
    pending_map = dict(data.get('pendingBlackMarket') or {})
    pending_map.pop(player_num, None)
    pending_map.pop(str(player_num), None)
    if pending_map:
        data['pendingBlackMarket'] = pending_map
    else:
        data.pop('pendingBlackMarket', None)

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': game, 'playerNum': player_num}


register('bm_skip_', _handle_bm_skip, 'core')
