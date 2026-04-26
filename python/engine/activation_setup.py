"""Pure-state subset of src/engine/activation-setup.js: finalizeActivation.

JS finalizeActivation is async and tightly coupled to Discord (thread
creation, embed rendering, button sending, log messages). The pure-state
subset extracted here mirrors the state mutations only:

  B3.  Mark DC exhausted (dcExhaustedState[msg_id] = True via game flag)
  B4-B5. Decrement activationsRemaining + push dcIndex
  B7.  Clear Strength in Numbers data
  B10. Init movementBank entry (merge pendingMpBonus + deployBonusMp)
  B11. Track activationStartPositions for the activated group
  B12. Init dcActionsData entry
  D    Apply start-of-activation passives (delegated to
       activation_effects.apply_start_of_activation_effects)

Discord layer (Phase 3) wraps with:
  - thread creation, embed re-render, action-button send
  - reaction-card prompts (Hair Trigger, Vigor, Responsive, Fulcrum, etc.)
  - log_game_action / save_games

Constants:
  DC_ACTIONS_PER_ACTIVATION = 2  (mirrors JS export)
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


DC_ACTIONS_PER_ACTIVATION: int = 2


def _data(game: Any) -> Dict[str, Any]:
    return game.data if hasattr(game, 'data') else game


def _dg_index(display_name: Optional[str]) -> str:
    if not display_name:
        return '1'
    import re
    m = re.search(r'\[(?:DG|Group) (\d+)\]', display_name)
    return m.group(1) if m else '1'


def finalize_activation(game: Any, *, dc_name: str, player_num: int,
                        dc_index: int, display_name: str, msg_id: str,
                        dc_health_state: Optional[Dict[str, Any]] = None,
                        thread_id: Optional[str] = None,
                        ) -> Dict[str, Any]:
    """Pure-state finalize-activation. Mirrors JS finalizeActivation
    state mutations (B-section + start-of-activation D-section).

    Discord-side effects (thread creation, embed render, log messages)
    are NOT in scope — Phase 3 handlers wrap this with that logic.

    Args:
      thread_id: optional thread id stamped onto movementBank /
        dcActionsData entries. Discord layer passes the real Discord
        thread id; headless training can pass None or a synthetic id.

    Returns:
      {'startEffects': [{effect, message}, ...], 'msgId': msg_id,
       'dcActionsData': <inited entry>}
    """
    from python.engine.mechanics.player_helpers import (
        get_activated_dc_indices,
        get_activations_remaining,
        set_activated_dc_indices,
        set_activations_remaining,
    )
    from python.engine.mechanics.activation_effects import (
        apply_start_of_activation_effects,
    )
    from python.engine.mechanics.game_helpers import grant_movement_bank

    data = _data(game)

    # B3. Mark DC exhausted.
    exhausted = data.get('dcExhaustedState')
    if not isinstance(exhausted, dict):
        exhausted = {}
        data['dcExhaustedState'] = exhausted
    exhausted[msg_id] = True

    # B4-B5. Decrement activationsRemaining + push dcIndex.
    cur_remaining = get_activations_remaining(game, player_num) or 0
    set_activations_remaining(game, player_num, cur_remaining - 1)
    indices = get_activated_dc_indices(game, player_num) or []
    if dc_index not in indices:
        set_activated_dc_indices(game, player_num, [*indices, dc_index])

    # B7. Clear Strength in Numbers data.
    sin_data = data.get('strengthInNumbersData')
    sin_pn = sin_data.get('playerNum') if isinstance(sin_data, dict) else None
    if sin_pn == player_num:
        data['strengthInNumbersData'] = None
        data['strengthInNumbersPlayerNum'] = None

    # B10. Init movementBank entry. Merge pendingMpBonus and deployBonusMp.
    bank = data.get('movementBank')
    if not isinstance(bank, dict):
        bank = {}
        data['movementBank'] = bank
    pending_mp_map = data.get('pendingMpBonus')
    pending_mp = 0
    if isinstance(pending_mp_map, dict) and msg_id in pending_mp_map:
        pending_mp = int(pending_mp_map.get(msg_id) or 0)
        del pending_mp_map[msg_id]
    bank[msg_id] = {
        'total': pending_mp,
        'remaining': pending_mp,
        'threadId': thread_id,
        'messageId': None,
        'displayName': display_name,
    }

    # Deploy bonus MP (legacy backward-compat).
    deploy_bonus = data.get('deployBonusMp')
    if isinstance(deploy_bonus, dict):
        dg = _dg_index(display_name)
        prefix = f'{dc_name}-{dg}-'
        db_total = 0
        for db_fk in list(deploy_bonus.keys()):
            db_amt = deploy_bonus.get(db_fk) or 0
            if db_fk.startswith(prefix) and db_amt > 0:
                if db_amt > db_total:
                    db_total = db_amt
                del deploy_bonus[db_fk]
        if db_total > 0:
            grant_movement_bank(game, msg_id, db_total)
        if not deploy_bonus:
            data.pop('deployBonusMp', None)

    # B11. Track activation start positions for figures in this group.
    start_positions = data.get('activationStartPositions')
    if not isinstance(start_positions, dict):
        start_positions = {}
        data['activationStartPositions'] = start_positions
    dg = _dg_index(display_name)
    prefix = f'{dc_name}-{dg}-'
    fig_pos = (data.get('figurePositions') or {}).get(player_num) or {}
    for fk, pos in fig_pos.items():
        if isinstance(fk, str) and fk.startswith(prefix):
            start_positions[fk] = pos

    # B12. Init dcActionsData entry.
    actions_data = data.get('dcActionsData')
    if not isinstance(actions_data, dict):
        actions_data = {}
        data['dcActionsData'] = actions_data
    entry = {
        'remaining': DC_ACTIONS_PER_ACTIVATION,
        'total': DC_ACTIONS_PER_ACTIVATION,
        'messageId': None,
        'threadId': thread_id,
        'specialsUsed': [],
    }
    actions_data[msg_id] = entry

    # D. Start-of-activation passives.
    start_result = apply_start_of_activation_effects(
        game,
        dc_name=dc_name,
        player_num=player_num,
        display_name=display_name,
        msg_id=msg_id,
        dc_health_state=dc_health_state,
    )
    start_effects: List[Dict[str, str]] = start_result.get('applied') or []

    return {
        'msgId': msg_id,
        'startEffects': start_effects,
        'dcActionsData': entry,
    }
