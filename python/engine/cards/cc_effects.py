"""CC effect resolver + per-card handler registry (C5-D skeleton).

When PLAY_CC or CC_CONFIRM_PLAY completes, it sets
game.pendingCcEffect = {cardName, playerNum, timing, playableBy, dcName}.
The game loop then calls `resolve_pending_cc_effect(game, ctx)` to apply
the card's actual state change.

Per-card effect handlers register into the _CC_EFFECTS dict keyed by
card name. Each handler takes (game, pending, ctx) and returns a dict
describing the outcome. Unknown cards raise `UnknownCcEffect` so the
caller knows the coverage gap is explicit, not silent.

Scope of this skeleton (5 representative cards — rest is batch grind
in Phase 5-D):
  - 'Reinforcements' — draw 3 CCs
  - 'Hold On' — add Focus to a target figure
  - 'Hit the Deck' — add Hide to a target figure
  - 'Rally' — remove one condition from a target figure
  - 'Take Initiative' — transfer initiative
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional


class UnknownCcEffect(KeyError):
    """Raised when a pending CC has no registered effect handler."""


_CC_EFFECTS: Dict[str, Callable[[Any, Dict[str, Any], Dict[str, Any]], Dict[str, Any]]] = {}


def register(card_name: str, handler: Callable) -> None:
    if card_name in _CC_EFFECTS:
        raise ValueError(f'duplicate cc effect handler for {card_name!r}')
    _CC_EFFECTS[card_name] = handler


def resolve_pending_cc_effect(game: Any, ctx: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Dispatch game.pendingCcEffect to its per-card handler.

    Returns the handler's result dict. Clears pendingCcEffect on success.
    Raises UnknownCcEffect if no handler is registered.
    """
    data = game.data if hasattr(game, 'data') else game
    pending = data.get('pendingCcEffect')
    if not pending:
        return {'applied': False, 'reason': 'no_pending_cc_effect'}
    card_name = pending.get('cardName')
    if not card_name:
        raise ValueError('resolve_pending_cc_effect: pendingCcEffect missing cardName')
    handler = _CC_EFFECTS.get(card_name)
    if handler is None:
        raise UnknownCcEffect(card_name)
    result = handler(game, dict(pending), ctx or {})
    data['pendingCcEffect'] = None
    data['lastCcEffectResult'] = {'cardName': card_name, 'result': result}
    return result


# ---------------------------------------------------------------------------
# Built-in per-card handlers (C5-D seed)

def _apply_condition_to_target(game: Any, target_fk: str, condition: str) -> bool:
    """Add `condition` to the target figure's condition list (dedupe)."""
    from python.engine.mechanics.conditions import apply_condition
    return apply_condition(game, target_fk, condition)


def _cc_reinforcements(game: Any, pending: Dict[str, Any],
                       ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Reinforcements: draw 3 CCs. Once per SoR."""
    from python.engine.cards.deck import draw_with_reshuffle

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    if player_num not in (1, 2):
        raise ValueError('reinforcements: pending missing playerNum')
    drew = draw_with_reshuffle(game, player_num, 3)
    data['reinforcementsPlayedThisSor'] = True
    return {'applied': True, 'drew': drew}


def _cc_hold_on(game: Any, pending: Dict[str, Any],
                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Hold On: gain Focus on target figure.

    ctx must supply target_figure_key.
    """
    target_fk = (ctx or {}).get('target_figure_key') or pending.get('targetFigureKey')
    if not target_fk:
        raise ValueError('hold_on: requires target_figure_key in ctx')
    added = _apply_condition_to_target(game, target_fk, 'Focus')
    return {'applied': True, 'conditionAdded': added, 'targetFigureKey': target_fk}


def _cc_hit_the_deck(game: Any, pending: Dict[str, Any],
                     ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Hit the Deck: target figure gains Hide."""
    target_fk = (ctx or {}).get('target_figure_key') or pending.get('targetFigureKey')
    if not target_fk:
        raise ValueError('hit_the_deck: requires target_figure_key in ctx')
    added = _apply_condition_to_target(game, target_fk, 'Hide')
    return {'applied': True, 'conditionAdded': added, 'targetFigureKey': target_fk}


def _cc_rally(game: Any, pending: Dict[str, Any],
              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Rally: remove one chosen condition from target figure.

    ctx must supply target_figure_key + condition.
    """
    from python.engine.mechanics.conditions import filter_condition

    target_fk = (ctx or {}).get('target_figure_key') or pending.get('targetFigureKey')
    condition = (ctx or {}).get('condition') or pending.get('condition')
    if not target_fk or not condition:
        raise ValueError('rally: requires target_figure_key + condition in ctx')
    filter_condition(game, target_fk, condition)
    return {
        'applied': True,
        'targetFigureKey': target_fk,
        'conditionRemoved': condition,
    }


def _cc_take_initiative(game: Any, pending: Dict[str, Any],
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Take Initiative: swap initiative to the playing player for next round.

    Sets game.initiativeSwapNextRound = {toPlayerNum}.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    data['initiativeSwapNextRound'] = {'toPlayerNum': player_num}
    return {'applied': True, 'toPlayerNum': player_num}


def _cc_blitz(game: Any, pending: Dict[str, Any],
              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Blitz: +1 Surge to attack results (active pendingCombat)."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    combat_mut = dict(combat)
    combat_mut['bonusSurges'] = int(combat_mut.get('bonusSurges') or 0) + 1
    data['pendingCombat'] = combat_mut
    return {'applied': True, 'bonusSurgesAdded': 1}


def _cc_advance_warning(game: Any, pending: Dict[str, Any],
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Advance Warning: self and an adjacent friendly each gain 1 MP.

    Requires ctx.msg_id (self DC) + ctx.adjacent_msg_id (the chosen
    adjacent friendly DC).
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank

    msg_id = (ctx or {}).get('msg_id')
    adjacent_msg_id = (ctx or {}).get('adjacent_msg_id')
    if not msg_id:
        raise ValueError('advance_warning: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 1)
    if adjacent_msg_id:
        grant_movement_bank(game, adjacent_msg_id, 1)
    return {
        'applied': True,
        'selfMsgId': msg_id,
        'adjacentMsgId': adjacent_msg_id,
    }


def _cc_battle_scars(game: Any, pending: Dict[str, Any],
                     ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Battle Scars: grant 1 Power Token; 2 if figure suffered ≥3 damage
    during the activation. Target type comes from ctx.token_type (defaults
    to 'Surge' — caller should prompt via POWER_TOKEN_CHOICE).
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('battle_scars: requires ctx.figure_key')
    damage_this_activation = int(
        ((data.get('figureDamageThisActivation') or {}).get(figure_key)) or 0
    )
    token_count = 2 if damage_this_activation >= 3 else 1
    token_type = (ctx or {}).get('token_type', 'Surge')
    grant_power_tokens(data, figure_key, token_type, token_count)
    return {
        'applied': True,
        'figureKey': figure_key,
        'tokenType': token_type,
        'count': token_count,
    }


def _cc_adrenaline(game: Any, pending: Dict[str, Any],
                   ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Adrenaline: apply +5 Health to each WOOKIEE for this round.

    Sets game.roundWookieeHealthBonus[playerNum] = 5 which the health
    lookup engine + damage_helpers consume for the round.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    bonus_map = dict(data.get('roundWookieeHealthBonus') or {})
    bonus_map[player_num] = 5
    data['roundWookieeHealthBonus'] = bonus_map
    return {'applied': True, 'playerNum': player_num, 'bonus': 5}


def _cc_armed_escort(game: Any, pending: Dict[str, Any],
                     ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Armed Escort: +1 Evade to other friendlies within 2 of self this round."""
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('armed_escort: requires ctx.msg_id')
    data['armedEscortActive'] = {
        'playerNum': player_num, 'anchorMsgId': msg_id, 'bonusEvade': 1,
    }
    return {'applied': True, 'anchorMsgId': msg_id}


def _cc_beatdown(game: Any, pending: Dict[str, Any],
                 ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Beatdown: +1 Hit to the next 2 attacks during this activation."""
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    pending_map = dict(data.get('nextAttacksBonusHits') or {})
    existing = int(pending_map.get(player_num) or 0)
    pending_map[player_num] = {'count': 2, 'bonusHits': 1, 'existing': existing}
    data['nextAttacksBonusHits'] = pending_map
    return {'applied': True, 'attacksBoosted': 2, 'bonusHits': 1}


def _cc_close_and_personal(game: Any, pending: Dict[str, Any],
                           ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Close and Personal: +2 Damage to the next attack (melee only)."""
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    bonus_map = dict(data.get('nextAttackBonusDamage') or {})
    bonus_map[player_num] = int(bonus_map.get(player_num) or 0) + 2
    data['nextAttackBonusDamage'] = bonus_map
    data['closeAndPersonalActive'] = {
        'playerNum': player_num, 'meleeOnly': True,
    }
    return {'applied': True, 'playerNum': player_num, 'bonusDamage': 2}


def _cc_primary_target(game: Any, pending: Dict[str, Any],
                       ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Primary Target: +1 Hit, +2 Accuracy to the next attack vs highest-cost
    hostile. Marks the bonus on pendingCombat when present, otherwise queues
    it for the next attack.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    combat = data.get('pendingCombat')
    if isinstance(combat, dict):
        combat_mut = dict(combat)
        combat_mut['bonusHits'] = int(combat_mut.get('bonusHits') or 0) + 1
        combat_mut['bonusAccuracy'] = int(combat_mut.get('bonusAccuracy') or 0) + 2
        data['pendingCombat'] = combat_mut
    else:
        pending_map = dict(data.get('nextAttackBonuses') or {})
        existing = pending_map.get(player_num) or {}
        pending_map[player_num] = {
            'bonusHits': int(existing.get('bonusHits') or 0) + 1,
            'bonusAccuracy': int(existing.get('bonusAccuracy') or 0) + 2,
        }
        data['nextAttackBonuses'] = pending_map
    return {'applied': True, 'bonusHits': 1, 'bonusAccuracy': 2}


def _cc_focus(game: Any, pending: Dict[str, Any],
              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Focus: self becomes Focused.

    Requires ctx.figure_key (the activating figure).
    """
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('focus: requires ctx.figure_key')
    added = _apply_condition_to_target(game, figure_key, 'Focus')
    return {'applied': True, 'figureKey': figure_key, 'conditionAdded': added}


def _cc_recovery(game: Any, pending: Dict[str, Any],
                 ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Recovery: recover 2 Damage (heal 2 HP to self).

    Requires ctx.figure_key. Uses damage_helpers.heal_hp via the DC's
    msgId, located via p{n}DcMessageIds.
    """
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import (
        dc_name_from_figure_key, parse_figure_key,
    )

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    player_num = pending.get('playerNum')
    if not figure_key or player_num not in (1, 2):
        raise ValueError('recovery: requires ctx.figure_key + pending.playerNum')

    dc_name = dc_name_from_figure_key(figure_key)
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    ids_list = (
        data.get('p1DcMessageIds') if player_num == 1
        else data.get('p2DcMessageIds')
    ) or []
    dc_list = (
        data.get('p1DcList') if player_num == 1
        else data.get('p2DcList')
    ) or []
    msg_id = None
    for mid, entry in zip(ids_list, dc_list):
        if isinstance(entry, dict) and entry.get('dcName') == dc_name:
            msg_id = mid
            break
    if not msg_id:
        return {'applied': False, 'reason': 'dc_not_found'}
    dc_health_state = data.get('dcHealthState')
    if not isinstance(dc_health_state, dict):
        return {'applied': False, 'reason': 'no_health_state'}
    heal_hp(dc_health_state, data, msg_id, fig_idx, 2, player_num)
    return {'applied': True, 'figureKey': figure_key, 'healed': 2}


def _cc_urgency(game: Any, pending: Dict[str, Any],
                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Urgency: gain MP equal to Speed + 2.

    Requires ctx.msg_id + ctx.speed (activator's Speed stat). Marks
    urgencyMustSpendAll[msg_id] = True.
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank

    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    speed = (ctx or {}).get('speed')
    if not msg_id or not isinstance(speed, int):
        raise ValueError('urgency: requires ctx.msg_id + int ctx.speed')
    amount = speed + 2
    grant_movement_bank(game, msg_id, amount)
    urgency_map = dict(data.get('urgencyMustSpendAll') or {})
    urgency_map[msg_id] = True
    data['urgencyMustSpendAll'] = urgency_map
    return {'applied': True, 'msgId': msg_id, 'mpGranted': amount}


def _cc_hide_in_plain_sight(game: Any, pending: Dict[str, Any],
                            ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Hide in Plain Sight: self cannot be targeted this round."""
    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('hide_in_plain_sight: requires ctx.figure_key')
    untargetable = dict(data.get('roundUntargetable') or {})
    untargetable[figure_key] = True
    data['roundUntargetable'] = untargetable
    return {'applied': True, 'figureKey': figure_key}


def _cc_take_cover(game: Any, pending: Dict[str, Any],
                   ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Take Cover: +1 Block, -2 Accuracy while defending this round."""
    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('take_cover: requires ctx.figure_key')
    cover_map = dict(data.get('takeCoverActive') or {})
    cover_map[figure_key] = {'bonusBlock': 1, 'accuracyPenalty': 2}
    data['takeCoverActive'] = cover_map
    return {'applied': True, 'figureKey': figure_key}


def _cc_shadow_ops(game: Any, pending: Dict[str, Any],
                   ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Shadow Ops: opponent cannot play CCs this round.

    Sets game.shadowOpsBlockedPlayer = opponent's player_num.
    is_cc_playable_now already honors this flag.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    if player_num not in (1, 2):
        raise ValueError('shadow_ops: pending missing playerNum')
    opp = 2 if player_num == 1 else 1
    data['shadowOpsBlockedPlayer'] = opp
    return {'applied': True, 'blockedPlayerNum': opp}


def _cc_inspiring_speech(game: Any, pending: Dict[str, Any],
                         ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Inspiring Speech: up to 2 adjacent friendlies become Focused.

    Requires ctx.target_figure_keys (list of 1-2 figure keys).
    """
    targets = (ctx or {}).get('target_figure_keys') or []
    if not isinstance(targets, list) or not targets:
        raise ValueError('inspiring_speech: requires ctx.target_figure_keys list')
    if len(targets) > 2:
        raise ValueError('inspiring_speech: at most 2 targets')
    focused = []
    for fk in targets:
        if _apply_condition_to_target(game, fk, 'Focus'):
            focused.append(fk)
    return {'applied': True, 'focused': focused}


def _cc_cripple(game: Any, pending: Dict[str, Any],
                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Cripple: adjacent hostile cannot voluntarily exit its space this round.

    Sets game.roundCannotVoluntarilyExit[target_figure_key] = True.
    """
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    if not target_fk:
        raise ValueError('cripple: requires ctx.target_figure_key')
    cripple_map = dict(data.get('roundCannotVoluntarilyExit') or {})
    cripple_map[target_fk] = True
    data['roundCannotVoluntarilyExit'] = cripple_map
    return {'applied': True, 'targetFigureKey': target_fk}


def _cc_disable(game: Any, pending: Dict[str, Any],
                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Disable: adjacent hostile can't use Surge abilities or Special actions
    this round.
    """
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    if not target_fk:
        raise ValueError('disable: requires ctx.target_figure_key')
    disabled_map = dict(data.get('roundDisabledFigures') or {})
    disabled_map[target_fk] = True
    data['roundDisabledFigures'] = disabled_map
    return {'applied': True, 'targetFigureKey': target_fk}


def _cc_jump_jets(game: Any, pending: Dict[str, Any],
                  ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Jump Jets: place self in an empty space within 5 spaces.

    Requires ctx.figure_key + ctx.destination.
    """
    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    destination = (ctx or {}).get('destination')
    player_num = pending.get('playerNum')
    if not figure_key or not destination or player_num not in (1, 2):
        raise ValueError(
            'jump_jets: requires ctx.figure_key + ctx.destination + pending.playerNum'
        )
    positions_all = data.get('figurePositions') or {}
    player_positions = dict(positions_all.get(player_num) or {})
    player_positions[figure_key] = str(destination).lower()
    positions_all[player_num] = player_positions
    data['figurePositions'] = positions_all
    return {
        'applied': True,
        'figureKey': figure_key,
        'destination': str(destination).lower(),
    }


def _cc_planning(game: Any, pending: Dict[str, Any],
                 ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Planning: draw 2 CCs; if activating figure is not a LEADER, discard 1."""
    from python.engine.cards.deck import discard_from_hand, draw_with_reshuffle

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    is_leader = bool((ctx or {}).get('is_leader'))
    drew = draw_with_reshuffle(game, player_num, 2)
    discarded = None
    if not is_leader and drew:
        # Default: discard the last-drawn (caller can override via
        # ctx.discard_card). Real Discord UI would prompt.
        discard_card = (ctx or {}).get('discard_card') or drew[-1]
        if discard_from_hand(game, player_num, discard_card):
            discarded = discard_card
    return {
        'applied': True, 'drew': drew, 'discarded': discarded,
        'isLeader': is_leader,
    }


def _cc_rally_the_troops(game: Any, pending: Dict[str, Any],
                         ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Rally the Troops: ready another friendly TROOPER within 3 spaces.

    Requires ctx.target_msg_id. Removes that DC from activated indices.
    """
    from python.engine.mechanics.player_helpers import (
        get_activated_dc_indices, set_activated_dc_indices,
    )

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    target_msg_id = (ctx or {}).get('target_msg_id')
    if player_num not in (1, 2) or not target_msg_id:
        raise ValueError('rally_the_troops: requires pending.playerNum + ctx.target_msg_id')
    ids_list = (
        data.get('p1DcMessageIds') if player_num == 1
        else data.get('p2DcMessageIds')
    ) or []
    if target_msg_id not in ids_list:
        return {'applied': False, 'reason': 'target_not_in_dc_list'}
    idx = ids_list.index(target_msg_id)
    activated = get_activated_dc_indices(game, player_num) or []
    if idx in activated:
        set_activated_dc_indices(
            game, player_num, [i for i in activated if i != idx],
        )
    return {'applied': True, 'readiedMsgId': target_msg_id}


def _cc_second_chance(game: Any, pending: Dict[str, Any],
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Second Chance: attach card as Attachment to own DC.

    Requires ctx.msg_id — the target DC message id. Adds 'Second Chance'
    to game.p{n}CcAttachments[msg_id].
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    msg_id = (ctx or {}).get('msg_id')
    if player_num not in (1, 2) or not msg_id:
        raise ValueError('second_chance: requires pending.playerNum + ctx.msg_id')
    key = 'p1CcAttachments' if player_num == 1 else 'p2CcAttachments'
    attachments = dict(data.get(key) or {})
    card_list = list(attachments.get(msg_id) or [])
    if 'Second Chance' not in card_list:
        card_list.append('Second Chance')
    attachments[msg_id] = card_list
    data[key] = attachments
    return {'applied': True, 'msgId': msg_id, 'attachedTo': msg_id}


def _cc_apex_predator(game: Any, pending: Dict[str, Any],
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Apex Predator: self becomes Focused + Hidden, gains 2 Power Tokens, 2 MP.

    Requires ctx.figure_key + ctx.msg_id. token_type defaults to Surge.
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    if not figure_key or not msg_id:
        raise ValueError('apex_predator: requires ctx.figure_key + ctx.msg_id')
    token_type = (ctx or {}).get('token_type', 'Surge')
    _apply_condition_to_target(game, figure_key, 'Focus')
    _apply_condition_to_target(game, figure_key, 'Hide')
    grant_power_tokens(data, figure_key, token_type, 2)
    grant_movement_bank(game, msg_id, 2)
    return {
        'applied': True,
        'figureKey': figure_key,
        'msgId': msg_id,
        'tokensGranted': 2,
        'mpGranted': 2,
    }


def _cc_burst_fire(game: Any, pending: Dict[str, Any],
                   ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Burst Fire: next attack this activation stuns figures adjacent to
    target on damage.

    Sets game.nextAttackBonusConditions[playerNum] including an
    'adjacentOnDamage' payload. The attack resolver consumes it.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    pending_map = dict(data.get('nextAttackBonusConditions') or {})
    existing = list(pending_map.get(player_num) or [])
    existing.append({'condition': 'Stun', 'scope': 'adjacentOnDamage'})
    pending_map[player_num] = existing
    data['nextAttackBonusConditions'] = pending_map
    return {'applied': True, 'playerNum': player_num}


def _cc_stealth(game: Any, pending: Dict[str, Any],
                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Stealth: self becomes Hidden."""
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('stealth: requires ctx.figure_key')
    added = _apply_condition_to_target(game, figure_key, 'Hide')
    return {'applied': True, 'figureKey': figure_key, 'conditionAdded': added}


def _cc_sprint(game: Any, pending: Dict[str, Any],
               ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Sprint: +3 MP to activating DC."""
    from python.engine.mechanics.game_helpers import grant_movement_bank

    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('sprint: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 3)
    return {'applied': True, 'msgId': msg_id, 'mpGranted': 3}


def _cc_reload(game: Any, pending: Dict[str, Any],
               ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Reload: gain 2 Power Tokens.

    Requires ctx.figure_key. token_type from ctx (defaults to Surge).
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('reload: requires ctx.figure_key')
    token_type = (ctx or {}).get('token_type', 'Surge')
    grant_power_tokens(data, figure_key, token_type, 2)
    return {'applied': True, 'figureKey': figure_key, 'tokensGranted': 2}


def _cc_swift(game: Any, pending: Dict[str, Any],
              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Swift: +3 MP."""
    from python.engine.mechanics.game_helpers import grant_movement_bank

    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('swift: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 3)
    return {'applied': True, 'msgId': msg_id, 'mpGranted': 3}


def _cc_tough_luck(game: Any, pending: Dict[str, Any],
                   ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Tough Luck: +1 Block to defense this attack."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    combat_mut = dict(combat)
    combat_mut['bonusBlock'] = int(combat_mut.get('bonusBlock') or 0) + 1
    data['pendingCombat'] = combat_mut
    return {'applied': True, 'bonusBlock': 1}


def _cc_pulse_targeting(game: Any, pending: Dict[str, Any],
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Pulse Targeting: +2 Accuracy while attacking."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    combat_mut = dict(combat)
    combat_mut['bonusAccuracy'] = int(combat_mut.get('bonusAccuracy') or 0) + 2
    data['pendingCombat'] = combat_mut
    return {'applied': True, 'bonusAccuracy': 2}


def _cc_blaze_of_glory(game: Any, pending: Dict[str, Any],
                       ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Blaze of Glory: ready a DC (remove from activatedDcIndices). The
    3-damage cost is queued as game.blazeOfGloryEorDamage for EoR.

    Requires ctx.target_msg_id (the DC to re-ready).
    """
    from python.engine.mechanics.player_helpers import (
        get_activated_dc_indices, set_activated_dc_indices,
    )

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    target_msg_id = (ctx or {}).get('target_msg_id')
    if player_num not in (1, 2) or not target_msg_id:
        raise ValueError('blaze_of_glory: requires pending.playerNum + ctx.target_msg_id')

    ids_list = (
        data.get('p1DcMessageIds') if player_num == 1
        else data.get('p2DcMessageIds')
    ) or []
    if target_msg_id not in ids_list:
        return {'applied': False, 'reason': 'target_not_in_dc_list'}
    idx = ids_list.index(target_msg_id)
    activated = get_activated_dc_indices(game, player_num) or []
    if idx in activated:
        set_activated_dc_indices(
            game, player_num, [i for i in activated if i != idx],
        )
    # Queue 3-damage end-of-round penalty on the DC that played Blaze of Glory
    data['blazeOfGloryEorDamage'] = {
        'msgId': target_msg_id,
        'playerNum': player_num,
        'amount': 3,
    }
    return {'applied': True, 'readiedMsgId': target_msg_id, 'eorDamageQueued': 3}


# ---------------------------------------------------------------------------
# Registry install

register('Reinforcements', _cc_reinforcements)
register('Hold On', _cc_hold_on)
register('Hit the Deck', _cc_hit_the_deck)
register('Rally', _cc_rally)
register('Take Initiative', _cc_take_initiative)
register('Blitz', _cc_blitz)
register('Advance Warning', _cc_advance_warning)
register('Battle Scars', _cc_battle_scars)
register('Blaze of Glory', _cc_blaze_of_glory)
register('Adrenaline', _cc_adrenaline)
register('Armed Escort', _cc_armed_escort)
register('Beatdown', _cc_beatdown)
register('Close and Personal', _cc_close_and_personal)
register('Primary Target', _cc_primary_target)
register('Focus', _cc_focus)
register('Recovery', _cc_recovery)
register('Urgency', _cc_urgency)
register('Hide in Plain Sight', _cc_hide_in_plain_sight)
register('Take Cover', _cc_take_cover)
register('Shadow Ops', _cc_shadow_ops)
register('Inspiring Speech', _cc_inspiring_speech)
register('Cripple', _cc_cripple)
register('Disable', _cc_disable)
register('Jump Jets', _cc_jump_jets)
register('Planning', _cc_planning)
register('Rally the Troops', _cc_rally_the_troops)
register('Second Chance', _cc_second_chance)
register('Apex Predator', _cc_apex_predator)
register('Burst Fire', _cc_burst_fire)
register('Stealth', _cc_stealth)
register('Sprint', _cc_sprint)
register('Reload', _cc_reload)
register('Swift', _cc_swift)
register('Tough Luck', _cc_tough_luck)
register('Pulse Targeting', _cc_pulse_targeting)


def registered_cc_effects() -> list:
    """List all currently-registered CC effect names (for coverage tracking)."""
    return sorted(_CC_EFFECTS.keys())
