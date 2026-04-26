"""Pure-state movement / activation interrupts engine layer.

Mirrors src/handlers/interrupts.js state mutations sans Discord IO.

Scope (P2.13):
  - still_faster_use / still_faster_skip
  - squad_swarm_use / squad_swarm_skip
  - overdrive_use
  - self_destruct_probe_use / self_destruct_probe_skip
  - self_destruct_protocol_use / self_destruct_protocol_skip

Each function is a pure-state mutation: it consumes pendingXxx flags
and applies damage / position changes via the byte-identical helpers
in mechanics.damage_helpers, defeat_handler, etc.

Discord-side bits (logging, button removal, embed refresh) belong in
Phase 3 handler wrappers.
"""
from __future__ import annotations

import random
from typing import Any, Dict, List, Optional

from python.engine.mechanics.damage_helpers import reduce_hp
from python.engine.mechanics.player_helpers import opponent_player_num


def _data(game: Any) -> Dict[str, Any]:
    return game.data if hasattr(game, 'data') else game


# ---------------------------------------------------------------------------
# Still Faster Than You


def still_faster_use(game: Any, *, msg_id: str, target_msg_id: str
                     ) -> Dict[str, Any]:
    """Activate the second group via Still Faster. Stamps
    fellSwoopFreeAttack[msg_id] (caller will fire pending free attack)
    and stillFasterExcludeMsgId for target restriction.

    Returns: {'ok': True, 'fellSwoopFreeAttack': True}
    """
    data = _data(game)
    fs = data.get('fellSwoopFreeAttack')
    if not isinstance(fs, dict):
        fs = {}
        data['fellSwoopFreeAttack'] = fs
    fs[msg_id] = True
    data['stillFasterExcludeMsgId'] = target_msg_id
    return {'ok': True, 'fellSwoopFreeAttack': True}


def still_faster_skip(game: Any) -> Dict[str, Any]:
    """Skip the Still Faster prompt. Clears stillFasterPending."""
    data = _data(game)
    data['stillFasterPending'] = None
    return {'ok': True, 'skipped': True}


# ---------------------------------------------------------------------------
# Squad Swarm


def squad_swarm_use(game: Any, *, msg_id: str, target_msg_id: str
                    ) -> Dict[str, Any]:
    """Choose to chain-activate a second group. Cumulative cost stays
    so the next chain continues the tally. Clears squadSwarmPlayerNum
    (the prompt has been answered).
    """
    data = _data(game)
    data['squadSwarmPlayerNum'] = None
    data['squadSwarmTargetMsgId'] = target_msg_id
    return {'ok': True, 'targetMsgId': target_msg_id}


def squad_swarm_skip(game: Any) -> Dict[str, Any]:
    """Skip Squad Swarm. Clears player flag + cumulative cost."""
    data = _data(game)
    data['squadSwarmPlayerNum'] = None
    data.pop('squadSwarmCumulativeCost', None)
    return {'ok': True, 'skipped': True}


# ---------------------------------------------------------------------------
# Overdrive


def overdrive_use(game: Any, *, msg_id: str, dc_name: str, player_num: int,
                  display_name: str,
                  dc_health_state: Optional[Dict[str, Any]] = None,
                  dg_index: int = 1,
                  ) -> Dict[str, Any]:
    """Trigger Overdrive: take 1 damage, gain +1 action.

    Returns:
      {'ok': True, 'prevHp': ..., 'newHp': ..., 'maxHp': ...,
       'defeated': bool, 'figureKey': ..., 'actionsRemaining': ...}
    """
    data = _data(game)
    actions_data = (data.get('dcActionsData') or {}).get(msg_id)
    if not isinstance(actions_data, dict):
        return {'ok': False, 'code': 'no_active_activation',
                'message': 'No active activation found.'}

    if dc_health_state is None:
        dc_health_state = data.get('dcHealthState') or {}

    hp_change = reduce_hp(dc_health_state, data, msg_id, 0, 1, player_num)
    prev_hp = (hp_change or {}).get('prevHp')
    new_hp = (hp_change or {}).get('newHp')
    max_hp = (hp_change or {}).get('maxHp', 0)

    # +1 action up to total+1 cap.
    DC_ACTIONS_PER_ACTIVATION = 2
    total = int(actions_data.get('total') or DC_ACTIONS_PER_ACTIVATION)
    cur_remaining = int(actions_data.get('remaining') or 0)
    actions_data['remaining'] = min(total + 1, cur_remaining + 1)

    figure_key = f'{dc_name}-{dg_index}-0'
    overdrive_used = data.get('overdriveUsedThisActivation')
    if not isinstance(overdrive_used, dict):
        overdrive_used = {}
        data['overdriveUsedThisActivation'] = overdrive_used
    overdrive_used[figure_key] = True

    return {
        'ok': True,
        'prevHp': prev_hp,
        'newHp': new_hp,
        'maxHp': max_hp,
        'defeated': new_hp is not None and new_hp <= 0 and max_hp > 0,
        'figureKey': figure_key,
        'actionsRemaining': actions_data['remaining'],
    }


# ---------------------------------------------------------------------------
# Self-Destruct Probe (round-2+ start-of-round trigger)


def self_destruct_probe_skip(game: Any, *, msg_id: str) -> Dict[str, Any]:
    """Skip the probe self-destruct prompt. Clears pendingSorActions
    entry for this msg_id if present.
    """
    data = _data(game)
    pending = data.get('pendingSorActions')
    if isinstance(pending, dict) and msg_id in pending:
        del pending[msg_id]
        if not pending:
            data.pop('pendingSorActions', None)
    return {'ok': True, 'skipped': True}


def self_destruct_probe_use(game: Any, *, msg_id: str, dc_name: str,
                            player_num: int,
                            dc_health_state: Optional[Dict[str, Any]] = None,
                            rng: Optional[random.Random] = None,
                            dg_index: int = 1,
                            ) -> Dict[str, Any]:
    """Roll 1 red die, deal Hits to adjacent hostiles, defeat the probe.

    Returns:
      {'ok': True, 'hits': N, 'damaged': [{figureKey, prevHp, newHp,
       defeated}], 'defeatedTargets': [...]}
    """
    from python.engine.data.dice_loader import get_dice_data
    from python.engine.data.map_spaces_loader import get_map_spaces

    data = _data(game)
    if dc_health_state is None:
        dc_health_state = data.get('dcHealthState') or {}

    # Roll 1 red die.
    dice_data = get_dice_data() or {}
    faces = ((dice_data.get('attack') or {}).get('red') or [])
    r = rng if rng is not None else random
    face = r.choice(faces) if faces else {}
    hits = int(face.get('dmg') or 0)

    # Locate probe position.
    probe_fk = f'{dc_name}-{dg_index}-0'
    fp = (data.get('figurePositions') or {}).get(player_num) or {}
    probe_pos = fp.get(probe_fk)

    damaged: List[Dict[str, Any]] = []
    defeated_targets: List[Dict[str, Any]] = []

    if hits > 0 and probe_pos:
        sel_map = data.get('selectedMap') or {}
        ms = get_map_spaces(sel_map.get('id')) if isinstance(sel_map, dict) else None
        adj = []
        if isinstance(ms, dict):
            adj = (ms.get('adjacency') or {}).get(str(probe_pos).lower(), []) or []
        all_adj = {str(probe_pos).lower()}
        all_adj.update(str(s).lower() for s in adj)

        hostile_num = opponent_player_num(player_num)
        hostile_figs = (data.get('figurePositions') or {}).get(hostile_num) or {}

        for fk, pos in hostile_figs.items():
            if not pos or str(pos).lower() not in all_adj:
                continue
            # Resolve hostile msg_id from p{N}DcList ordering.
            from python.engine.mechanics.dc_helpers import dc_name_from_figure_key
            tgt_dc = dc_name_from_figure_key(fk)
            from python.engine.mechanics.player_helpers import (
                get_dc_list,
                get_dc_message_ids,
            )
            tgt_dc_list = get_dc_list(game, hostile_num) or []
            tgt_msg_ids = get_dc_message_ids(game, hostile_num) or []
            tgt_msg_id = None
            for i, dc in enumerate(tgt_dc_list):
                if isinstance(dc, dict) and dc.get('dcName') == tgt_dc \
                        and i < len(tgt_msg_ids):
                    tgt_msg_id = tgt_msg_ids[i]
                    break
            if not tgt_msg_id:
                continue
            parts = fk.rsplit('-', 1)
            try:
                fig_idx = int(parts[1])
            except (ValueError, IndexError):
                continue
            hp_change = reduce_hp(dc_health_state, data, tgt_msg_id,
                                  fig_idx, hits, hostile_num) or {}
            prev_hp = hp_change.get('prevHp')
            new_hp = hp_change.get('newHp')
            max_hp = hp_change.get('maxHp', 0)
            if max_hp == 0 or prev_hp is None or prev_hp <= 0:
                continue
            damaged.append({
                'figureKey': fk,
                'prevHp': prev_hp,
                'newHp': new_hp,
                'defeated': new_hp is not None and new_hp <= 0,
            })
            if new_hp is not None and new_hp <= 0:
                defeated_targets.append({'figureKey': fk,
                                         'playerNum': hostile_num})

    # Defeat the probe.
    reduce_hp(dc_health_state, data, msg_id, 0, 9999, player_num)

    # Clear pending entry.
    pending = data.get('pendingSorActions')
    if isinstance(pending, dict) and msg_id in pending:
        del pending[msg_id]
        if not pending:
            data.pop('pendingSorActions', None)

    return {
        'ok': True,
        'hits': hits,
        'probeFigureKey': probe_fk,
        'damaged': damaged,
        'defeatedTargets': defeated_targets,
    }


# ---------------------------------------------------------------------------
# Self-Destruct Protocol (defender during attack)


def self_destruct_protocol_skip(game: Any) -> Dict[str, Any]:
    """Skip Self-Destruct Protocol. Clears pendingSelfDestruct."""
    data = _data(game)
    data.pop('pendingSelfDestruct', None)
    return {'ok': True, 'skipped': True}


def self_destruct_protocol_use(game: Any, *,
                               dc_health_state: Optional[Dict[str, Any]] = None,
                               rng: Optional[random.Random] = None,
                               ) -> Dict[str, Any]:
    """Defender uses Self-Destruct Protocol: roll 1 red die, damage
    adjacent hostiles (excluding the target itself, which dies via the
    attack).

    Reads pendingSelfDestruct + pendingCombat.target for context.

    Returns:
      {'ok': True, 'hits': N, 'damaged': [...], 'defeatedTargets': [...]}
    """
    from python.engine.data.dice_loader import get_dice_data
    from python.engine.data.map_spaces_loader import get_map_spaces

    data = _data(game)
    pending = data.get('pendingSelfDestruct')
    if not isinstance(pending, dict):
        return {'ok': False, 'code': 'no_pending',
                'message': 'No pending Self-Destruct Protocol.'}
    defender_pn = pending.get('defenderPlayerNum')
    pending_combat = data.get('pendingCombat') or {}
    target = pending_combat.get('target') or {}
    target_fk = target.get('figureKey')

    if dc_health_state is None:
        dc_health_state = data.get('dcHealthState') or {}

    # Consume pending flag.
    data.pop('pendingSelfDestruct', None)

    dice_data = get_dice_data() or {}
    faces = ((dice_data.get('attack') or {}).get('red') or [])
    r = rng if rng is not None else random
    face = r.choice(faces) if faces else {}
    hits = int(face.get('dmg') or 0)

    damaged: List[Dict[str, Any]] = []
    defeated_targets: List[Dict[str, Any]] = []

    if hits > 0 and target_fk and defender_pn:
        target_pos = (data.get('figurePositions') or {}).get(defender_pn, {}).get(target_fk)
        sel_map = data.get('selectedMap') or {}
        ms = get_map_spaces(sel_map.get('id')) if isinstance(sel_map, dict) else None
        adj = []
        if target_pos and isinstance(ms, dict):
            adj = (ms.get('adjacency') or {}).get(str(target_pos).lower(), []) or []
        all_adj = set()
        if target_pos:
            all_adj.add(str(target_pos).lower())
            all_adj.update(str(s).lower() for s in adj)

        hostile_num = opponent_player_num(defender_pn)
        hostile_figs = (data.get('figurePositions') or {}).get(hostile_num) or {}

        for fk, pos in hostile_figs.items():
            if not pos or str(pos).lower() not in all_adj:
                continue
            if fk == target_fk:
                continue
            from python.engine.mechanics.dc_helpers import dc_name_from_figure_key
            tgt_dc = dc_name_from_figure_key(fk)
            from python.engine.mechanics.player_helpers import (
                get_dc_list,
                get_dc_message_ids,
            )
            tgt_dc_list = get_dc_list(game, hostile_num) or []
            tgt_msg_ids = get_dc_message_ids(game, hostile_num) or []
            tgt_msg_id = None
            for i, dc in enumerate(tgt_dc_list):
                if isinstance(dc, dict) and dc.get('dcName') == tgt_dc \
                        and i < len(tgt_msg_ids):
                    tgt_msg_id = tgt_msg_ids[i]
                    break
            if not tgt_msg_id:
                continue
            parts = fk.rsplit('-', 1)
            try:
                fig_idx = int(parts[1])
            except (ValueError, IndexError):
                continue
            hp_change = reduce_hp(dc_health_state, data, tgt_msg_id,
                                  fig_idx, hits, hostile_num) or {}
            prev_hp = hp_change.get('prevHp')
            new_hp = hp_change.get('newHp')
            max_hp = hp_change.get('maxHp', 0)
            if max_hp == 0 or prev_hp is None or prev_hp <= 0:
                continue
            damaged.append({
                'figureKey': fk,
                'prevHp': prev_hp,
                'newHp': new_hp,
                'defeated': new_hp is not None and new_hp <= 0,
            })
            if new_hp is not None and new_hp <= 0:
                defeated_targets.append({'figureKey': fk,
                                         'playerNum': hostile_num})

    return {
        'ok': True,
        'hits': hits,
        'damaged': damaged,
        'defeatedTargets': defeated_targets,
    }
