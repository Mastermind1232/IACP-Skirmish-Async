"""Pure-state subset of src/handlers/dc-play-area.js + handle_attack_target.

JS handle_dc_activate / handle_attack_target are async and tightly coupled
to Discord (channel fetch, button rows, follow-ups). The pure-state
subset here mirrors the validation gates + state mutations only:

  - validate_activation: gate stack (Sit Tight, Agitate, Force Vision,
    Force Slow, companion-host, Strength in Numbers) returning either
    {ok: True, ...} or {ok: False, code, message, sideEffects}.
  - handle_dc_activate: full pipeline. Validation → finalize_activation
    (P2.2). Returns {'status': 'activated' | 'force_slow_skipped' |
    'rejected', ...}.
  - handle_attack_target: free-attack vs normal-attack actions decrement,
    pendingOverrideAttackDice / closeQuartersActive merging, pendingCombat
    construction, advance to ROLL phase. Caller is responsible for
    LOS/range validation before invoking.

Discord layer (Phase 3) wraps with off-turn confirmation prompt, error
follow-ups, channel/message fetch.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from python.engine.data.dc_effects_loader import get_dc_effects
from python.engine.mechanics.dc_helpers import dc_name_from_figure_key
from python.engine.mechanics.player_helpers import (
    get_activations_remaining,
    get_dc_list,
    get_dc_message_ids,
    opponent_player_num,
    recompute_activation_counts,
)


def _data(game: Any) -> Dict[str, Any]:
    return game.data if hasattr(game, 'data') else game


# ---------------------------------------------------------------------------
# Companion host check (mirror of JS isCompanionHostDefeated)


def is_companion_host_defeated(game: Any, dc_name: str, player_num: int) -> bool:
    """True when `dc_name` is a companion whose host group has no figures
    left on the board. Mirror of JS isCompanionHostDefeated.
    """
    data = _data(game)
    eff = (get_dc_effects() or {}).get(dc_name) or {}
    if eff.get('companion') is not True:
        return False
    host_map = data.get('companionHostMap') or {}
    if not isinstance(host_map, dict):
        return False
    for companion_key, entry in host_map.items():
        if not isinstance(entry, dict):
            continue
        if entry.get('playerNum') != player_num:
            continue
        if not isinstance(companion_key, str) or not companion_key.startswith(dc_name + '-'):
            continue
        host_fig_key = entry.get('hostFigureKey')
        if not host_fig_key:
            continue
        host_dc_name = dc_name_from_figure_key(host_fig_key)
        figs = (data.get('figurePositions') or {}).get(player_num) or {}
        host_alive = any(
            isinstance(fk, str) and fk.startswith(host_dc_name + '-') and figs.get(fk)
            for fk in figs
        )
        if not host_alive:
            return True
    return False


# ---------------------------------------------------------------------------
# Validation gates


def validate_activation(game: Any, *, player_num: int, dc_index: int,
                        ) -> Dict[str, Any]:
    """Run all activation gates. Returns:

    On success:
      {'ok': True, 'dcName': ..., 'displayName': ..., 'msgId': ...,
       'sideEffects': [{'effect': 'agitate_cleared', ...}, ...]}

    On rejection:
      {'ok': False, 'code': '<gate>', 'message': '<user msg>',
       'sideEffects': [...]}
    """
    data = _data(game)
    dc_list = get_dc_list(game, player_num) or []
    if dc_index < 0 or dc_index >= len(dc_list):
        return {'ok': False, 'code': 'dc_not_found', 'message': 'DC not found.',
                'sideEffects': []}
    dc = dc_list[dc_index]
    if not isinstance(dc, dict):
        return {'ok': False, 'code': 'dc_not_found', 'message': 'DC not found.',
                'sideEffects': []}
    dc_name = dc.get('dcName')
    display_name = dc.get('displayName') or dc_name
    if not dc_name:
        return {'ok': False, 'code': 'dc_not_found', 'message': 'DC not found.',
                'sideEffects': []}

    msg_ids = get_dc_message_ids(game, player_num) or []
    if dc_index >= len(msg_ids) or not msg_ids[dc_index]:
        return {'ok': False, 'code': 'msg_not_found',
                'message': 'DC message not found.', 'sideEffects': []}
    msg_id = msg_ids[dc_index]

    remaining = get_activations_remaining(game, player_num) or 0
    if remaining <= 0:
        return {'ok': False, 'code': 'no_activations',
                'message': 'No activations remaining this round.',
                'sideEffects': []}

    side_effects: List[Dict[str, Any]] = []

    # Sit Tight: cannot activate when ready DCs ≤ opponent's.
    if data.get('sitTightPlayerNum') == player_num:
        opp_num = opponent_player_num(player_num)
        opp_rem = get_activations_remaining(game, opp_num) or 0
        if remaining <= opp_rem:
            return {'ok': False, 'code': 'sit_tight',
                    'message': '**Sit Tight** — you cannot activate until you '
                               'have more ready Deployment cards than your '
                               'opponent.',
                    'sideEffects': []}

    # Agitate: opponent's surge forced this player's group to activate next.
    agitate = data.get('agitateNextActivation')
    if isinstance(agitate, dict) and agitate.get('playerNum') == player_num:
        forced_dc = agitate.get('dcName')
        if dc_name != forced_dc:
            forced_idx = next(
                (i for i, d in enumerate(dc_list)
                 if isinstance(d, dict) and d.get('dcName') == forced_dc),
                -1,
            )
            activated_key = f'p{player_num}ActivatedDcIndices'
            activated = data.get(activated_key) or []
            if forced_idx >= 0 and forced_idx not in activated:
                return {'ok': False, 'code': 'agitate',
                        'message': f'**Agitate** — **{forced_dc}** must be '
                                   f'the next group to activate, if able.',
                        'sideEffects': []}
            data['agitateNextActivation'] = None
            side_effects.append({'effect': 'agitate_cleared',
                                 'reason': 'forced_already_activated_or_missing'})
        else:
            data['agitateNextActivation'] = None
            side_effects.append({'effect': 'agitate_cleared',
                                 'reason': 'forced_dc_chosen'})

    # Force Vision: block while pending.
    if data.get('forceVisionPending') == player_num:
        return {'ok': False, 'code': 'force_vision_pending',
                'message': '**Force Vision** — You must first choose a group '
                           'from the Force Vision prompt before activating.',
                'sideEffects': []}

    # Force Vision next-activation gate.
    fv_next = data.get('forceVisionNextActivation')
    if isinstance(fv_next, dict) and fv_next.get('playerNum') == player_num:
        forced_dc = fv_next.get('dcName')
        if dc_name != forced_dc:
            forced_idx = next(
                (i for i, d in enumerate(dc_list)
                 if isinstance(d, dict) and d.get('dcName') == forced_dc),
                -1,
            )
            activated_key = f'p{player_num}ActivatedDcIndices'
            activated = data.get(activated_key) or []
            if forced_idx >= 0 and forced_idx not in activated:
                figs = (data.get('figurePositions') or {}).get(player_num) or {}
                forced_alive = any(
                    isinstance(fk, str) and fk.startswith(forced_dc + '-')
                    and figs.get(fk) for fk in figs
                )
                if forced_alive:
                    return {'ok': False, 'code': 'force_vision',
                            'message': f'**Force Vision** — **{forced_dc}** '
                                       f'must be the next group to activate, '
                                       f'if able.',
                            'sideEffects': []}
                data['forceVisionNextActivation'] = None
                side_effects.append({'effect': 'force_vision_cleared',
                                     'reason': 'forced_dc_defeated'})
            else:
                data['forceVisionNextActivation'] = None
                side_effects.append({'effect': 'force_vision_cleared',
                                     'reason': 'forced_already_activated'})
        else:
            data['forceVisionNextActivation'] = None
            side_effects.append({'effect': 'force_vision_cleared',
                                 'reason': 'forced_dc_chosen'})

    # Companion host defeated.
    if is_companion_host_defeated(game, dc_name, player_num):
        return {'ok': False, 'code': 'companion_host_defeated',
                'message': f'**{display_name}** cannot activate — its '
                           f'associated group has left play.',
                'sideEffects': []}

    # Strength in Numbers: combined cost ≤ 12.
    sin = data.get('strengthInNumbersData')
    if isinstance(sin, dict) and sin.get('playerNum') == player_num:
        try:
            eff = (get_dc_effects() or {}).get(dc_name) or {}
            candidate_cost = int(eff.get('cost') or 0)
        except Exception:
            candidate_cost = 0
        triggering_cost = int(sin.get('triggeringGroupCost') or 0)
        combined = triggering_cost + candidate_cost
        if combined > 12:
            triggering_name = sin.get('triggeringGroupName') or 'previous group'
            return {'ok': False, 'code': 'strength_in_numbers',
                    'message': (
                        f'**Strength in Numbers** — Combined deployment cost '
                        f'of **{triggering_name}** ({triggering_cost}) + '
                        f'**{display_name}** ({candidate_cost}) = '
                        f'**{combined}**, which exceeds the 12-point cap.'
                    ),
                    'sideEffects': []}

    return {
        'ok': True,
        'dcName': dc_name,
        'displayName': display_name,
        'msgId': msg_id,
        'sideEffects': side_effects,
    }


# ---------------------------------------------------------------------------
# Force Slow skip path


def _apply_force_slow_skip(game: Any, *, dc_name: str, player_num: int,
                           dc_index: int, display_name: str) -> Dict[str, Any]:
    """If any figure of this DC is flagged in forceSlowSkipActivation,
    consume the flag, mark the DC as activated, recompute counts, and
    return the skip result. Otherwise return None.
    """
    data = _data(game)
    flag_map = data.get('forceSlowSkipActivation')
    if not isinstance(flag_map, dict):
        return None
    figs = (data.get('figurePositions') or {}).get(player_num) or {}
    for fk in list(figs.keys()):
        if not isinstance(fk, str) or not fk.startswith(dc_name + '-'):
            continue
        if not figs.get(fk):
            continue
        if not flag_map.get(fk):
            continue
        # Consume flag.
        del flag_map[fk]
        if not flag_map:
            data.pop('forceSlowSkipActivation', None)
        # Mark DC activated.
        activated_key = f'p{player_num}ActivatedDcIndices'
        activated = list(data.get(activated_key) or [])
        if dc_index not in activated:
            activated.append(dc_index)
        data[activated_key] = activated
        # Recompute counts.
        try:
            recompute_activation_counts(game, player_num)
        except Exception:
            pass
        return {
            'status': 'force_slow_skipped',
            'dcName': dc_name,
            'displayName': display_name,
            'message': (
                f'🐌 **Force Slow** — **{display_name}** must skip this '
                f'activation.'
            ),
        }
    return None


# ---------------------------------------------------------------------------
# Top-level activation dispatch


def handle_dc_activate(game: Any, *, player_num: int, dc_index: int,
                       dc_health_state: Optional[Dict[str, Any]] = None,
                       thread_id: Optional[str] = None,
                       ) -> Dict[str, Any]:
    """Pure-state DC activation. Mirrors handle_dc_activate from
    src/handlers/dc-play-area.js, minus Discord IO.

    Pipeline:
      1. validate_activation (gate stack)
      2. Force Slow skip check (different success path)
      3. finalize_activation (P2.2)

    Returns one of:
      {'status': 'activated', 'msgId': ..., 'startEffects': [...],
       'dcActionsData': {...}, 'sideEffects': [...]}
      {'status': 'force_slow_skipped', 'dcName': ..., 'displayName': ...,
       'message': ...}
      {'status': 'rejected', 'code': ..., 'message': ...,
       'sideEffects': [...]}
    """
    from python.engine.activation_setup import finalize_activation

    validation = validate_activation(
        game, player_num=player_num, dc_index=dc_index,
    )
    if not validation.get('ok'):
        return {
            'status': 'rejected',
            'code': validation.get('code'),
            'message': validation.get('message'),
            'sideEffects': validation.get('sideEffects') or [],
        }

    dc_name = validation['dcName']
    display_name = validation['displayName']
    msg_id = validation['msgId']
    side_effects = validation.get('sideEffects') or []

    # Force Slow skip path: consumes activation, no finalize.
    skip = _apply_force_slow_skip(
        game,
        dc_name=dc_name,
        player_num=player_num,
        dc_index=dc_index,
        display_name=display_name,
    )
    if skip is not None:
        skip['sideEffects'] = side_effects
        return skip

    # Normal activation: finalize.
    final = finalize_activation(
        game,
        dc_name=dc_name,
        player_num=player_num,
        dc_index=dc_index,
        display_name=display_name,
        msg_id=msg_id,
        dc_health_state=dc_health_state,
        thread_id=thread_id,
    )
    return {
        'status': 'activated',
        'msgId': final['msgId'],
        'startEffects': final['startEffects'],
        'dcActionsData': final['dcActionsData'],
        'sideEffects': side_effects,
    }


# ---------------------------------------------------------------------------
# Attack target dispatch (P2.8)


# Free-attack source flags. Attack action does NOT consume a regular
# action slot when one of these is set.
_FREE_ATTACK_FLAGS = (
    ('pendingBattlefieldLeadership', 'forMsgId', 'delete'),
    ('fellSwoopFreeAttack',          None,        'msgkey'),
    ('pendingEmperorInterrupt',      'forMsgId', 'delete'),
    ('pendingExecutiveOrder',        'forMsgId', 'delete'),
    ('pendingBombardmentSorin',      'forMsgId', 'delete'),
    ('pendingCoordinatedRaid',       'forMsgId', 'delete'),
    ('pendingFieldTactics',          'forMsgId', 'delete'),
)


def _consume_free_attack_flag(data: Dict[str, Any], msg_id: str) -> Optional[str]:
    """If any free-attack flag matches `msg_id`, consume it and return
    its name. Returns None when no free-attack flag matches.

    Also handles pendingFiringSquad (a list rather than a scalar) and
    fellSwoopFreeAttack (a dict keyed by msg_id).
    """
    # pendingFiringSquad list match.
    pfs = data.get('pendingFiringSquad') or []
    if isinstance(pfs, list) and any(
        isinstance(p, dict) and p.get('forMsgId') == msg_id for p in pfs
    ):
        new_list = [p for p in pfs if not (isinstance(p, dict)
                                           and p.get('forMsgId') == msg_id)]
        if new_list:
            data['pendingFiringSquad'] = new_list
        else:
            data.pop('pendingFiringSquad', None)
        return 'pendingFiringSquad'

    # Scalar / msg-keyed flags.
    for flag, field, mode in _FREE_ATTACK_FLAGS:
        cur = data.get(flag)
        if mode == 'delete':
            if isinstance(cur, dict) and cur.get(field) == msg_id:
                data.pop(flag, None)
                return flag
        elif mode == 'msgkey':
            if isinstance(cur, dict) and msg_id in cur:
                del cur[msg_id]
                if not cur:
                    data.pop(flag, None)
                # Clear stillFasterExcludeMsgId companion flag.
                if flag == 'fellSwoopFreeAttack' and data.get('stillFasterExcludeMsgId'):
                    data['stillFasterExcludeMsgId'] = None
                return flag
    return None


def _build_attack_info(data: Dict[str, Any], *, attacker_dc_name: str,
                       msg_id: str, attacker_stats: Dict[str, Any],
                       target: Dict[str, Any]) -> Dict[str, Any]:
    """Build attackInfo for pendingCombat. Mirrors JS combat.js:1162-1188.

    Reads attackerStats.attack as base, then merges:
      - pendingOverrideAttackDice[msgId]: dice/type/removeDieColor
      - closeQuartersActive[msgId]: replace with adjacent hostile's dice
        (handled in JS at 1189-1240; engine port keeps simpler shape —
        full close-quarters resolution is in pattern_d).
    """
    base = (attacker_stats or {}).get('attack') or {'dice': ['red'], 'range': [1, 3]}
    attack_info: Dict[str, Any] = dict(base)

    override_map = data.get('pendingOverrideAttackDice') or {}
    override = override_map.get(msg_id) if isinstance(override_map, dict) else None
    if isinstance(override, dict):
        if override.get('dice'):
            attack_info['dice'] = list(override['dice'])
        if override.get('type') == 'melee':
            attack_info['range'] = [1, 1]
        elif override.get('type') == 'ranged':
            existing = attack_info.get('range') or [1, 3]
            attack_info['attackType'] = 'Ranged'
            attack_info['range'] = [
                existing[0] if existing else 1,
                max(existing[1] if len(existing) > 1 else 3, 99),
            ]
        if override.get('removeDieColor'):
            new_dice = list(attack_info.get('dice') or [])
            try:
                new_dice.remove(override['removeDieColor'])
            except ValueError:
                pass
            attack_info['dice'] = new_dice
        if override.get('blockSurgeAbilities'):
            data['_pendingBlockSurgeAbilities'] = True
        # Consume override.
        del override_map[msg_id]
        if not override_map:
            data.pop('pendingOverrideAttackDice', None)

    return attack_info


def handle_attack_target(game: Any, *, msg_id: str, attacker_player_num: int,
                         attacker_dc_name: str, attacker_figure_key: str,
                         attacker_figure_index: int, target: Dict[str, Any],
                         attacker_stats: Optional[Dict[str, Any]] = None,
                         ) -> Dict[str, Any]:
    """Pure-state attack-target dispatch. Mirrors JS handle_attack_target.

    Caller is responsible for LOS/range/declare-time validation. This
    function:
      1. Validates forced-target / multi-fire blocked / etiquette gates
         that require state mutation (deletion of consumed flags).
      2. Decides free-attack vs normal-attack and decrements
         dcActionsData accordingly.
      3. Builds attackInfo (with pendingOverrideAttackDice merging).
      4. Stamps pendingCombat and sets phase to DECLARE.

    Args:
      target: dict with at least {'figureKey', 'playerNum', 'dist',
        'isNpc', 'defense', 'defenseType', 'figureIndex'}.
      attacker_stats: precomputed dc-stats dict (cost, attack, defense).
        If None, falls back to dc_effects.

    Returns:
      {'ok': True, 'pendingCombat': <ref>, 'consumedFreeAttack': <flag>,
       'attackInfo': {...}}
      {'ok': False, 'code': <gate>, 'message': <user msg>}
    """
    data = _data(game)
    target_fk = target.get('figureKey')

    # Etiquette and Protocol gate.
    etiq_pairs = data.get('etiquetteBlockPairs') or []
    if etiq_pairs and target_fk:
        for pair in etiq_pairs:
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                continue
            a, b = pair[0], pair[1]
            if (a == attacker_figure_key and b == target_fk) or \
               (b == attacker_figure_key and a == target_fk):
                return {'ok': False, 'code': 'etiquette',
                        'message': '🚫 **Etiquette and Protocol**: these '
                                   'two figures cannot attack each other '
                                   'this round.'}

    # Forced attack target gate.
    forced_map = data.get('forcedAttackTarget') or {}
    if isinstance(forced_map, dict) and msg_id in forced_map:
        forced_fk = forced_map.get(msg_id)
        if forced_fk and target_fk and target_fk != forced_fk:
            forced_name = dc_name_from_figure_key(forced_fk)
            return {'ok': False, 'code': 'forced_target',
                    'message': f'You must target the specified figure '
                               f'(**{forced_name}**).'}
        # Consume on satisfaction.
        del forced_map[msg_id]
        if not forced_map:
            data.pop('forcedAttackTarget', None)

    # Multi-Fire blocked target gate.
    mfbt = data.get('multiFireBlockedTarget') or {}
    if isinstance(mfbt, dict) and msg_id in mfbt:
        if mfbt.get(msg_id) == target_fk:
            return {'ok': False, 'code': 'multi_fire',
                    'message': '**Multi-Fire** — Second attack must target '
                               'a **different figure**.'}
        del mfbt[msg_id]
        if not mfbt:
            data.pop('multiFireBlockedTarget', None)

    # Decrement actions or consume free-attack flag.
    consumed_free = _consume_free_attack_flag(data, msg_id)
    if consumed_free is None:
        actions_map = data.get('dcActionsData') or {}
        entry = actions_map.get(msg_id) if isinstance(actions_map, dict) else None
        if isinstance(entry, dict):
            entry['remaining'] = max(0, int(entry.get('remaining') or 0) - 1)

    # Resolve attacker_stats from dc_effects if not provided.
    if not attacker_stats:
        eff = (get_dc_effects() or {}).get(attacker_dc_name) or {}
        attacker_stats = eff

    # Build attackInfo.
    attack_info = _build_attack_info(
        data,
        attacker_dc_name=attacker_dc_name,
        msg_id=msg_id,
        attacker_stats=attacker_stats,
        target=target,
    )

    # Construct pendingCombat. Shape mirrors what step_roll expects.
    pending = {
        'phase': 'declare',
        'attackerMsgId': msg_id,
        'attackerPlayerNum': attacker_player_num,
        'attackerDcName': attacker_dc_name,
        'attackerFigureKey': attacker_figure_key,
        'attackerFigureIndex': attacker_figure_index,
        'attackInfo': attack_info,
        'target': dict(target),
        'isRanged': attack_info.get('attackType') == 'Ranged'
                    or (attack_info.get('range') or [1, 1])[1] > 1,
    }

    # Default defense type for step_roll fallback.
    if 'defenseType' not in pending['target']:
        defense_colors = pending['target'].get('defense')
        if isinstance(defense_colors, list) and defense_colors:
            pending['target']['defenseType'] = defense_colors[0]
        else:
            pending['target']['defenseType'] = 'white'

    data['pendingCombat'] = pending

    return {
        'ok': True,
        'pendingCombat': pending,
        'consumedFreeAttack': consumed_free,
        'attackInfo': attack_info,
    }


# ---------------------------------------------------------------------------
# Move dispatch (P2.9)


def handle_move(game: Any, *, msg_id: str, player_num: int,
                figure_key: str, target_space: str, cost: int,
                ) -> Dict[str, Any]:
    """Pure-state move dispatch. Mirrors JS handleMovePick state mutations.

    Caller (Discord layer or stepper) is responsible for resolving
    `target_space` + `cost` from the movement cache. This function:
      1. Validates figure is on the board.
      2. Applies Cripple gate (cannot voluntarily exit space).
      3. Validates cost ≤ movementBank remaining.
      4. Updates figurePositions[player_num][figure_key].
      5. Decrements movementBank[msg_id].remaining by cost.
      6. Stamps figureMoved[figure_key] = True for trigger lookups.

    Returns:
      {'ok': True, 'newPosition': ..., 'mpRemaining': ...}
      {'ok': False, 'code': ..., 'message': ...}
    """
    data = _data(game)
    fig_pos = (data.get('figurePositions') or {}).get(player_num) or {}
    cur_pos = fig_pos.get(figure_key)
    if not cur_pos:
        return {'ok': False, 'code': 'no_position',
                'message': f'Figure {figure_key} not on board.'}

    # Cripple gate: cannot voluntarily exit current space.
    crippled = data.get('crippledFigures') or []
    if isinstance(crippled, list) and figure_key in crippled:
        if str(target_space).lower() != str(cur_pos).lower():
            return {'ok': False, 'code': 'cripple',
                    'message': (
                        f'**{figure_key}** is Crippled — cannot voluntarily '
                        f'exit its space this round.'
                    )}

    # Movement bank check.
    bank = data.get('movementBank') or {}
    bank_entry = bank.get(msg_id) if isinstance(bank, dict) else None
    if not isinstance(bank_entry, dict):
        return {'ok': False, 'code': 'no_bank',
                'message': f'No movement bank for {msg_id}.'}
    mp_remaining = int(bank_entry.get('remaining') or 0)
    cost = int(cost)
    if cost < 0:
        return {'ok': False, 'code': 'invalid_cost',
                'message': 'Move cost cannot be negative.'}
    if cost > mp_remaining:
        return {'ok': False, 'code': 'insufficient_mp',
                'message': (
                    f'Not enough movement points '
                    f'(need {cost}, have {mp_remaining}).'
                )}

    # Apply move.
    fp_all = data.get('figurePositions')
    if not isinstance(fp_all, dict):
        fp_all = {}
        data['figurePositions'] = fp_all
    fp_player = fp_all.get(player_num)
    if not isinstance(fp_player, dict):
        fp_player = dict(fig_pos)
        fp_all[player_num] = fp_player
    fp_player[figure_key] = target_space

    # Decrement bank.
    bank_entry['remaining'] = mp_remaining - cost

    # Stamp figureMoved (per-activation flag, msg_id-keyed sub-dict).
    moved_map = data.get('figureMoved')
    if not isinstance(moved_map, dict):
        moved_map = {}
        data['figureMoved'] = moved_map
    moved_map[figure_key] = True

    return {
        'ok': True,
        'newPosition': target_space,
        'mpRemaining': bank_entry['remaining'],
        'previousPosition': cur_pos,
        'cost': cost,
    }
