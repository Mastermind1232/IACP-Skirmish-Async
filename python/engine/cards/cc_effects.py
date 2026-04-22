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


def _cc_deadeye(game, pending, ctx):
    """Deadeye: +2 Accuracy to attack."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusAccuracy'] = int(c.get('bonusAccuracy') or 0) + 2
    data['pendingCombat'] = c
    return {'applied': True, 'bonusAccuracy': 2}


def _cc_positioning_advantage(game, pending, ctx):
    """Positioning Advantage: +1 Hit while attacking."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusHits'] = int(c.get('bonusHits') or 0) + 1
    data['pendingCombat'] = c
    return {'applied': True, 'bonusHits': 1}


def _cc_fleet_footed(game, pending, ctx):
    """Fleet Footed: +1 MP."""
    from python.engine.mechanics.game_helpers import grant_movement_bank
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('fleet_footed: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 1)
    return {'applied': True, 'msgId': msg_id, 'mpGranted': 1}


def _cc_heavy_armor(game, pending, ctx):
    """Heavy Armor: Pierce has no effect this attack."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['pierceNegated'] = True
    data['pendingCombat'] = c
    return {'applied': True, 'pierceNegated': True}


def _cc_parry(game, pending, ctx):
    """Parry: +1 Block OR +1 Evade (caller chooses via ctx.which)."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    which = (ctx or {}).get('which', 'block').lower()
    if which not in ('block', 'evade'):
        raise ValueError("parry: ctx.which must be 'block' or 'evade'")
    c = dict(combat)
    if which == 'block':
        c['bonusBlock'] = int(c.get('bonusBlock') or 0) + 1
    else:
        c['bonusEvade'] = int(c.get('bonusEvade') or 0) + 1
    data['pendingCombat'] = c
    return {'applied': True, 'bonusType': which}


def _cc_hour_of_need(game, pending, ctx):
    """Hour of Need: recover damage equal to current round number."""
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import (
        dc_name_from_figure_key, parse_figure_key,
    )

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    player_num = pending.get('playerNum')
    if not figure_key or player_num not in (1, 2):
        raise ValueError('hour_of_need: requires ctx.figure_key + playerNum')
    amount = int(data.get('round') or data.get('currentRound') or 1)

    dc_name = dc_name_from_figure_key(figure_key)
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    ids_list = (data.get('p1DcMessageIds') if player_num == 1
                else data.get('p2DcMessageIds')) or []
    dc_list = (data.get('p1DcList') if player_num == 1
               else data.get('p2DcList')) or []
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
    heal_hp(dc_health_state, data, msg_id, fig_idx, amount, player_num)
    return {'applied': True, 'figureKey': figure_key, 'healed': amount}


def _cc_force_push(game, pending, ctx):
    """Force Push: push a SMALL figure within 3 up to 2 spaces.

    Required: ctx.target_figure_key + ctx.destination. Stepper doesn't
    validate range/size here; caller should only pass valid targets.
    """
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    destination = (ctx or {}).get('destination')
    if not target_fk or not destination:
        raise ValueError('force_push: requires ctx.target_figure_key + destination')
    # Target may be on either player's side; find and move them
    positions_all = data.get('figurePositions') or {}
    for pn in (1, 2):
        pos_map = positions_all.get(pn)
        if isinstance(pos_map, dict) and target_fk in pos_map:
            pos_mut = dict(pos_map)
            pos_mut[target_fk] = str(destination).lower()
            positions_all[pn] = pos_mut
            data['figurePositions'] = positions_all
            return {
                'applied': True,
                'targetFigureKey': target_fk,
                'destination': str(destination).lower(),
            }
    return {'applied': False, 'reason': 'target_not_found'}


def _cc_grisly_contest(game, pending, ctx):
    """Grisly Contest: adjacent hostile suffers 2 Damage; self suffers 2 Strain.

    Required: ctx.target_figure_key (hostile), ctx.self_figure_key (activator).
    """
    target_fk = (ctx or {}).get('target_figure_key')
    self_fk = (ctx or {}).get('self_figure_key')
    player_num = pending.get('playerNum')
    if not target_fk or not self_fk or player_num not in (1, 2):
        raise ValueError('grisly_contest: requires target + self figure keys + playerNum')
    opp = 2 if player_num == 1 else 1
    _apply_hp_damage_via_health_state(game, target_fk, opp, 2)
    _apply_hp_damage_via_health_state(game, self_fk, player_num, 2)
    return {
        'applied': True, 'targetFigureKey': target_fk,
        'selfFigureKey': self_fk,
    }


def _apply_hp_damage_via_health_state(game, figure_key, player_num, damage):
    """Local mini of stepper's _apply_hp_damage helper (kept here to avoid
    circular import)."""
    from python.engine.mechanics.damage_helpers import reduce_hp
    from python.engine.mechanics.dc_helpers import (
        dc_name_from_figure_key, parse_figure_key,
    )

    data = game.data if hasattr(game, 'data') else game
    dc_name = dc_name_from_figure_key(figure_key)
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    ids_list = (data.get('p1DcMessageIds') if player_num == 1
                else data.get('p2DcMessageIds')) or []
    dc_list = (data.get('p1DcList') if player_num == 1
               else data.get('p2DcList')) or []
    msg_id = None
    for mid, entry in zip(ids_list, dc_list):
        if isinstance(entry, dict) and entry.get('dcName') == dc_name:
            msg_id = mid
            break
    if not msg_id:
        return {'newHp': 0, 'maxHp': 0, 'prevHp': 0, 'wasDefeated': False}
    dc_health_state = data.get('dcHealthState')
    if not isinstance(dc_health_state, dict):
        return {'newHp': 0, 'maxHp': 0, 'prevHp': 0, 'wasDefeated': False}
    return reduce_hp(dc_health_state, data, msg_id, fig_idx, damage, player_num)


def _cc_stimulants(game, pending, ctx):
    """Stimulants: adjacent figure (ally OR hostile) suffers 1 Damage, then
    gains +1 MP and becomes Focused.

    Required: ctx.target_figure_key, ctx.target_player_num, ctx.target_msg_id.
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank

    target_fk = (ctx or {}).get('target_figure_key')
    target_pn = (ctx or {}).get('target_player_num')
    target_msg_id = (ctx or {}).get('target_msg_id')
    if not target_fk or target_pn not in (1, 2) or not target_msg_id:
        raise ValueError(
            'stimulants: requires target_figure_key + target_player_num + target_msg_id'
        )
    _apply_hp_damage_via_health_state(game, target_fk, target_pn, 1)
    grant_movement_bank(game, target_msg_id, 1)
    _apply_condition_to_target(game, target_fk, 'Focus')
    return {
        'applied': True,
        'targetFigureKey': target_fk,
        'damage': 1,
        'mpGranted': 1,
    }


def _cc_mitigate(game, pending, ctx):
    """Mitigate: reroll 1 attack die. Records intent on pendingCombat."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['attackerRerollCount'] = int(c.get('attackerRerollCount') or 0) + 1
    data['pendingCombat'] = c
    return {'applied': True, 'rerolls': 1}


def _cc_hard_to_hit(game, pending, ctx):
    """Hard to Hit: reroll 1 defense die."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['defenderRerollCount'] = int(c.get('defenderRerollCount') or 0) + 1
    data['pendingCombat'] = c
    return {'applied': True, 'rerolls': 1}


def _cc_brace_for_impact(game, pending, ctx):
    """Brace for Impact: add 1 black die to defense pool."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    extra = list(c.get('bonusDefenseDice') or [])
    extra.append('black')
    c['bonusDefenseDice'] = extra
    data['pendingCombat'] = c
    return {'applied': True, 'dieAdded': 'black'}


def _cc_stealth_tactics(game, pending, ctx):
    """Stealth Tactics: add 1 white die to defense pool."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    extra = list(c.get('bonusDefenseDice') or [])
    extra.append('white')
    c['bonusDefenseDice'] = extra
    data['pendingCombat'] = c
    return {'applied': True, 'dieAdded': 'white'}


def _cc_lock_on(game, pending, ctx):
    """Lock On: +3 Accuracy OR -1 Dodge OR -1 Evade (ctx.effect)."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    effect = (ctx or {}).get('effect', 'accuracy').lower()
    if effect not in ('accuracy', 'dodge', 'evade'):
        raise ValueError("lock_on: ctx.effect must be 'accuracy', 'dodge', or 'evade'")
    c = dict(combat)
    if effect == 'accuracy':
        c['bonusAccuracy'] = int(c.get('bonusAccuracy') or 0) + 3
    elif effect == 'dodge':
        c['dodgeReduction'] = int(c.get('dodgeReduction') or 0) + 1
    else:
        c['evadeReduction'] = int(c.get('evadeReduction') or 0) + 1
    data['pendingCombat'] = c
    return {'applied': True, 'effect': effect}


def _cc_forward_march(game, pending, ctx):
    """Forward March: +1 MP to each friendly within 2 spaces.

    Required: ctx.friendly_msg_ids (list of msgIds within range — caller
    computes adjacency).
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank

    msg_ids = (ctx or {}).get('friendly_msg_ids') or []
    if not isinstance(msg_ids, list):
        raise ValueError('forward_march: requires ctx.friendly_msg_ids list')
    for mid in msg_ids:
        grant_movement_bank(game, mid, 1)
    return {'applied': True, 'grantedTo': list(msg_ids)}


def _cc_ready_weapons(game, pending, ctx):
    """Ready Weapons: distribute 3 Hit Tokens (Damage type) among group figures.

    Required: ctx.distribution — list of {figureKey, count} entries summing to 3.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    dist = (ctx or {}).get('distribution') or []
    if not isinstance(dist, list):
        raise ValueError('ready_weapons: requires ctx.distribution list')
    total = sum(int(e.get('count', 0)) for e in dist if isinstance(e, dict))
    if total != 3:
        raise ValueError(f'ready_weapons: distribution must sum to 3 (got {total})')
    applied = []
    for entry in dist:
        fk = entry.get('figureKey')
        count = int(entry.get('count', 0))
        if fk and count > 0:
            grant_power_tokens(data, fk, 'Damage', count)
            applied.append({'figureKey': fk, 'count': count})
    return {'applied': True, 'grants': applied}


def _cc_roar(game, pending, ctx):
    """Roar: if self has suffered ≥3 damage, up to 3 adjacent hostiles become
    Stunned.

    Required: ctx.self_damage_suffered (int), ctx.target_figure_keys (list).
    """
    damage_suffered = int((ctx or {}).get('self_damage_suffered') or 0)
    if damage_suffered < 3:
        return {'applied': False, 'reason': 'below_3_damage_threshold'}
    targets = (ctx or {}).get('target_figure_keys') or []
    if not isinstance(targets, list):
        raise ValueError('roar: requires ctx.target_figure_keys list')
    if len(targets) > 3:
        raise ValueError('roar: at most 3 targets')
    stunned = []
    for fk in targets:
        if _apply_condition_to_target(game, fk, 'Stun'):
            stunned.append(fk)
    return {'applied': True, 'stunned': stunned}


def _cc_reposition(game, pending, ctx):
    """Reposition: push a SMALL friendly figure within 3 up to 3 spaces.

    Required: ctx.target_figure_key + ctx.destination.
    """
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    destination = (ctx or {}).get('destination')
    if not target_fk or not destination:
        raise ValueError('reposition: requires ctx.target_figure_key + destination')
    positions_all = data.get('figurePositions') or {}
    for pn in (1, 2):
        pos_map = positions_all.get(pn)
        if isinstance(pos_map, dict) and target_fk in pos_map:
            pos_mut = dict(pos_map)
            pos_mut[target_fk] = str(destination).lower()
            positions_all[pn] = pos_mut
            data['figurePositions'] = positions_all
            return {
                'applied': True,
                'targetFigureKey': target_fk,
                'destination': str(destination).lower(),
            }
    return {'applied': False, 'reason': 'target_not_found'}


def _cc_regroup(game, pending, ctx):
    """Regroup: discard all HARMFUL conditions from adjacent friendly figures.

    Required: ctx.friendly_figure_keys (list) — adjacent friendlies.
    """
    from python.engine.mechanics.conditions import filter_condition

    harmful_conditions = ['Stun', 'Weaken', 'Bleed', 'Hide', 'Focus']
    # Only Stun/Weaken/Bleed are HARMFUL; Hide/Focus are beneficial.
    harmful_only = ['Stun', 'Weaken', 'Bleed']
    data = game.data if hasattr(game, 'data') else game
    figures = (ctx or {}).get('friendly_figure_keys') or []
    if not isinstance(figures, list):
        raise ValueError('regroup: requires ctx.friendly_figure_keys list')
    removed = []
    fig_conds = data.get('figureConditions') or {}
    for fk in figures:
        for cond in list(fig_conds.get(fk) or []):
            if cond in harmful_only:
                filter_condition(game, fk, cond)
                removed.append({'figureKey': fk, 'condition': cond})
    return {'applied': True, 'removed': removed}


def _cc_bladestorm(game, pending, ctx):
    """Bladestorm: +1 Surge to attack results; each adjacent hostile after
    attack suffers 1 Damage.

    The Damage phase is post-combat; here we just set the surge + queue
    a post-combat trigger.
    """
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if isinstance(combat, dict):
        c = dict(combat)
        c['bonusSurges'] = int(c.get('bonusSurges') or 0) + 1
        triggers = list(c.get('postCombatTriggers') or [])
        triggers.append({'effect': 'bladestorm_adjacent_damage', 'damage': 1})
        c['postCombatTriggers'] = triggers
        data['pendingCombat'] = c
        return {'applied': True, 'bonusSurges': 1, 'postCombatTrigger': True}
    return {'applied': False, 'reason': 'no_pending_combat'}


def _cc_spinning_kick(game, pending, ctx):
    """Spinning Kick: attack gains Cleave 1 and Cleave 2 keywords."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusCleave'] = int(c.get('bonusCleave') or 0) + 3  # 1 + 2
    data['pendingCombat'] = c
    return {'applied': True, 'cleave': 3}


def _cc_heightened_reflexes(game, pending, ctx):
    """Heightened Reflexes: remove results of 1 defense die.

    Required: ctx.die_index (int) — position in defenseRoll to zero out.
    """
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    die_index = (ctx or {}).get('die_index')
    if not isinstance(die_index, int):
        raise ValueError('heightened_reflexes: requires int ctx.die_index')
    c = dict(combat)
    remove_list = list(c.get('defenderDiceToZero') or [])
    if die_index not in remove_list:
        remove_list.append(die_index)
    c['defenderDiceToZero'] = remove_list
    data['pendingCombat'] = c
    return {'applied': True, 'dieIndex': die_index}


def _cc_looking_for_a_fight(game, pending, ctx):
    """Looking for a Fight: gain 1 Hit Token. Then move up to 1 space or push
    an adjacent SMALL figure 1 space.

    Required: ctx.figure_key. Optional: ctx.move_destination OR
    ctx.push_target_figure_key + ctx.push_destination.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('looking_for_a_fight: requires ctx.figure_key')
    grant_power_tokens(data, figure_key, 'Damage', 1)
    # Move or push branches
    move_dest = (ctx or {}).get('move_destination')
    push_target = (ctx or {}).get('push_target_figure_key')
    push_dest = (ctx or {}).get('push_destination')
    positions_all = data.get('figurePositions') or {}
    if move_dest:
        for pn in (1, 2):
            pos_map = positions_all.get(pn)
            if isinstance(pos_map, dict) and figure_key in pos_map:
                pm = dict(pos_map)
                pm[figure_key] = str(move_dest).lower()
                positions_all[pn] = pm
                break
    elif push_target and push_dest:
        for pn in (1, 2):
            pos_map = positions_all.get(pn)
            if isinstance(pos_map, dict) and push_target in pos_map:
                pm = dict(pos_map)
                pm[push_target] = str(push_dest).lower()
                positions_all[pn] = pm
                break
    data['figurePositions'] = positions_all
    return {
        'applied': True,
        'figureKey': figure_key,
        'moveDest': str(move_dest).lower() if move_dest else None,
        'pushTarget': push_target,
    }


def _cc_draw_emote(game, pending, ctx):
    """Draw!: perform an attack without using an action.

    Sets game.freeAttackBonusPending[msgId]=True.
    """
    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('draw: requires ctx.msg_id')
    pending_map = dict(data.get('freeAttackBonusPending') or {})
    pending_map[msg_id] = True
    data['freeAttackBonusPending'] = pending_map
    return {'applied': True, 'msgId': msg_id}


def _cc_hit_and_run(game, pending, ctx):
    """Hit and Run: perform attack, then gain 3 MP.

    Queues the MP bonus to apply after the attack resolves via
    game.postAttackMpBonus[msgId] = 3.
    """
    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('hit_and_run: requires ctx.msg_id')
    bonus = dict(data.get('postAttackMpBonus') or {})
    bonus[msg_id] = int(bonus.get(msg_id) or 0) + 3
    data['postAttackMpBonus'] = bonus
    return {'applied': True, 'msgId': msg_id, 'mpQueued': 3}


def _cc_expose_weakness(game, pending, ctx):
    """Expose Weakness: the next attack targeting an adjacent hostile gains Pierce 2.

    Sets game.exposeWeaknessTargets[target_figure_key] = {pierce: 2}.
    """
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    if not target_fk:
        raise ValueError('expose_weakness: requires ctx.target_figure_key')
    weakness = dict(data.get('exposeWeaknessTargets') or {})
    weakness[target_fk] = {'pierce': 2}
    data['exposeWeaknessTargets'] = weakness
    return {'applied': True, 'targetFigureKey': target_fk, 'pierce': 2}


def _cc_veteran_instincts(game, pending, ctx):
    """Veteran Instincts: gain 1 Hit OR Surge Token, then 1 Block OR Evade Token.

    Required: ctx.figure_key + ctx.first_token + ctx.second_token.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    first = (ctx or {}).get('first_token')
    second = (ctx or {}).get('second_token')
    if not figure_key:
        raise ValueError('veteran_instincts: requires ctx.figure_key')
    if first not in ('Damage', 'Surge'):
        raise ValueError("first_token must be 'Damage' or 'Surge'")
    if second not in ('Block', 'Evade'):
        raise ValueError("second_token must be 'Block' or 'Evade'")
    grant_power_tokens(data, figure_key, first, 1)
    grant_power_tokens(data, figure_key, second, 1)
    return {
        'applied': True,
        'figureKey': figure_key,
        'firstToken': first,
        'secondToken': second,
    }


def _cc_toxic_dart(game, pending, ctx):
    """Toxic Dart: hostile within 3 and in LOS suffers 1 Strain and becomes Weakened."""
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    target_pn = (ctx or {}).get('target_player_num')
    if not target_fk or target_pn not in (1, 2):
        raise ValueError('toxic_dart: requires target_figure_key + target_player_num')
    _apply_hp_damage_via_health_state(game, target_fk, target_pn, 1)
    _apply_condition_to_target(game, target_fk, 'Weaken')
    return {'applied': True, 'targetFigureKey': target_fk}


def _cc_take_position(game, pending, ctx):
    """Take Position: this round, +1 Block while defending + cannot be pushed."""
    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('take_position: requires ctx.figure_key')
    position_map = dict(data.get('takePositionActive') or {})
    position_map[figure_key] = {'bonusBlock': 1, 'pushImmune': True}
    data['takePositionActive'] = position_map
    return {'applied': True, 'figureKey': figure_key}


def _cc_camouflage(game, pending, ctx):
    """Camouflage: defender becomes Hidden when an attack is declared against them.

    Required: ctx.figure_key (self).
    """
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('camouflage: requires ctx.figure_key')
    _apply_condition_to_target(game, figure_key, 'Hide')
    return {'applied': True, 'figureKey': figure_key}


def _cc_celebration_cc(game, pending, ctx):
    """Celebration (CC effect path): +4 VP after defeating a unique hostile.

    Note: the CELEBRATION_PLAY stepper handler already provides this via
    pendingCelebration. This CC-effect variant is for when Celebration is
    resolved from the pendingCcEffect pipeline.
    """
    from python.engine.mechanics.vp_helpers import award_objective_vp

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    if player_num not in (1, 2):
        raise ValueError('celebration: pending missing playerNum')
    award_objective_vp(game, player_num, 4)
    return {'applied': True, 'vpAwarded': 4, 'playerNum': player_num}


def _cc_cut_lines(game, pending, ctx):
    """Cut Lines: neither player may draw Command cards this round."""
    data = game.data if hasattr(game, 'data') else game
    data['cutLinesActive'] = True
    return {'applied': True}


def _cc_deadly_precision(game, pending, ctx):
    """Deadly Precision: -1 Dodge to defense results this round (while attacking)."""
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    bonus = dict(data.get('roundDodgeReduction') or {})
    bonus[player_num] = int(bonus.get(player_num) or 0) + 1
    data['roundDodgeReduction'] = bonus
    return {'applied': True, 'playerNum': player_num}


def _cc_debts_repaid(game, pending, ctx):
    """Debts Repaid: when a friendly figure is defeated, ready own DC + Focus.

    Required: ctx.msg_id + ctx.figure_key.
    """
    from python.engine.mechanics.player_helpers import (
        get_activated_dc_indices, set_activated_dc_indices,
    )

    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    figure_key = (ctx or {}).get('figure_key')
    player_num = pending.get('playerNum')
    if not msg_id or not figure_key or player_num not in (1, 2):
        raise ValueError('debts_repaid: requires msg_id + figure_key + playerNum')
    _apply_condition_to_target(game, figure_key, 'Focus')
    ids_list = (data.get('p1DcMessageIds') if player_num == 1
                else data.get('p2DcMessageIds')) or []
    if msg_id in ids_list:
        idx = ids_list.index(msg_id)
        activated = get_activated_dc_indices(game, player_num) or []
        if idx in activated:
            set_activated_dc_indices(
                game, player_num, [i for i in activated if i != idx],
            )
    return {'applied': True, 'msgId': msg_id, 'figureKey': figure_key}


def _cc_disengage_cc(game, pending, ctx):
    """Disengage: +3 MP when a hostile enters within 3 spaces."""
    from python.engine.mechanics.game_helpers import grant_movement_bank

    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('disengage: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 3)
    return {'applied': True, 'msgId': msg_id, 'mpGranted': 3}


def _cc_force_rush(game, pending, ctx):
    """Force Rush: +2 MP at the start of activation."""
    from python.engine.mechanics.game_helpers import grant_movement_bank

    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('force_rush: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 2)
    return {'applied': True, 'msgId': msg_id, 'mpGranted': 2}


def _cc_force_illusion(game, pending, ctx):
    """Force Illusion: defender becomes Hidden (while attacker in LOS is attacking)."""
    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('force_illusion: requires ctx.figure_key')
    _apply_condition_to_target(game, figure_key, 'Hide')
    return {'applied': True, 'figureKey': figure_key}


def _cc_furious_charge(game, pending, ctx):
    """Furious Charge: if ≥3 damage suffered this attack, ready own DC.

    Required: ctx.damage_suffered, ctx.msg_id.
    """
    from python.engine.mechanics.player_helpers import (
        get_activated_dc_indices, set_activated_dc_indices,
    )

    data = game.data if hasattr(game, 'data') else game
    damage_suffered = int((ctx or {}).get('damage_suffered') or 0)
    msg_id = (ctx or {}).get('msg_id')
    player_num = pending.get('playerNum')
    if not msg_id or player_num not in (1, 2):
        raise ValueError('furious_charge: requires msg_id + playerNum')
    if damage_suffered < 3:
        return {'applied': False, 'reason': 'below_3_damage_threshold'}
    ids_list = (data.get('p1DcMessageIds') if player_num == 1
                else data.get('p2DcMessageIds')) or []
    if msg_id in ids_list:
        idx = ids_list.index(msg_id)
        activated = get_activated_dc_indices(game, player_num) or []
        if idx in activated:
            set_activated_dc_indices(
                game, player_num, [i for i in activated if i != idx],
            )
    return {'applied': True, 'readiedMsgId': msg_id}


def _cc_explosive_weaponry(game, pending, ctx):
    """Explosive Weaponry: attack gains Blast 1."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusBlast'] = int(c.get('bonusBlast') or 0) + 1
    data['pendingCombat'] = c
    return {'applied': True, 'blast': 1}


def _cc_glory_of_the_kill(game, pending, ctx):
    """Glory of the Kill: if defender was defeated, recover 3 damage.

    Required: ctx.defeated (bool), ctx.figure_key.
    """
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import (
        dc_name_from_figure_key, parse_figure_key,
    )

    data = game.data if hasattr(game, 'data') else game
    defeated = bool((ctx or {}).get('defeated'))
    if not defeated:
        return {'applied': False, 'reason': 'defender_not_defeated'}
    figure_key = (ctx or {}).get('figure_key')
    player_num = pending.get('playerNum')
    if not figure_key or player_num not in (1, 2):
        raise ValueError('glory_of_the_kill: requires figure_key + playerNum')

    dc_name = dc_name_from_figure_key(figure_key)
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    ids_list = (data.get('p1DcMessageIds') if player_num == 1
                else data.get('p2DcMessageIds')) or []
    dc_list = (data.get('p1DcList') if player_num == 1
               else data.get('p2DcList')) or []
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
    heal_hp(dc_health_state, data, msg_id, fig_idx, 3, player_num)
    return {'applied': True, 'figureKey': figure_key, 'healed': 3}


def _cc_hold_ground(game, pending, ctx):
    """Hold Ground: SMALL hostiles can't voluntarily exit adjacent spaces this round."""
    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('hold_ground: requires ctx.figure_key')
    hg_map = dict(data.get('holdGroundActive') or {})
    hg_map[figure_key] = True
    data['holdGroundActive'] = hg_map
    return {'applied': True, 'anchorFigureKey': figure_key}


def _cc_hunter_protocol(game, pending, ctx):
    """Hunter Protocol: may trigger the same Surge ability up to twice this attack."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['duplicateSurgesAllowed'] = True
    data['pendingCombat'] = c
    return {'applied': True}


def _cc_heart_of_freedom(game, pending, ctx):
    """Heart of Freedom: discard 1 HARMFUL condition, recover 2 HP, +2 MP."""
    from python.engine.mechanics.conditions import filter_condition
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import (
        dc_name_from_figure_key, parse_figure_key,
    )
    from python.engine.mechanics.game_helpers import grant_movement_bank

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    condition = (ctx or {}).get('condition')  # one of Stun/Weaken/Bleed
    player_num = pending.get('playerNum')
    if not figure_key or not msg_id or player_num not in (1, 2):
        raise ValueError('heart_of_freedom: requires figure_key + msg_id + playerNum')
    if condition:
        filter_condition(game, figure_key, condition)
    # Heal 2
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    dc_health_state = data.get('dcHealthState')
    if isinstance(dc_health_state, dict):
        heal_hp(dc_health_state, data, msg_id, fig_idx, 2, player_num)
    grant_movement_bank(game, msg_id, 2)
    return {
        'applied': True, 'figureKey': figure_key, 'conditionRemoved': condition,
        'healed': 2, 'mpGranted': 2,
    }


def _cc_marked_territory(game, pending, ctx):
    """Marked Territory: +1 Power Token to self, +1 to a group figure in an
    exterior space.

    Required: ctx.self_figure_key + optional ctx.exterior_figure_key.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    self_fk = (ctx or {}).get('self_figure_key')
    exterior_fk = (ctx or {}).get('exterior_figure_key')
    token_type = (ctx or {}).get('token_type', 'Surge')
    if not self_fk:
        raise ValueError('marked_territory: requires ctx.self_figure_key')
    grant_power_tokens(data, self_fk, token_type, 1)
    if exterior_fk:
        grant_power_tokens(data, exterior_fk, token_type, 1)
    return {'applied': True, 'selfFk': self_fk, 'exteriorFk': exterior_fk}


def _cc_out_of_time(game, pending, ctx):
    """Out of Time: hostile within 3 + LOS suffers Strain = current round."""
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    target_pn = (ctx or {}).get('target_player_num')
    if not target_fk or target_pn not in (1, 2):
        raise ValueError('out_of_time: requires target_figure_key + target_player_num')
    round_num = int(data.get('round') or data.get('currentRound') or 1)
    _apply_hp_damage_via_health_state(game, target_fk, target_pn, round_num)
    return {'applied': True, 'targetFigureKey': target_fk, 'strain': round_num}


def _cc_officers_training(game, pending, ctx):
    """Officer's Training: reroll 1 attack die; if LEADER, draw 1 CC."""
    from python.engine.cards.deck import draw_cc_cards

    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if isinstance(combat, dict):
        c = dict(combat)
        c['attackerRerollCount'] = int(c.get('attackerRerollCount') or 0) + 1
        data['pendingCombat'] = c
    is_leader = bool((ctx or {}).get('is_leader'))
    player_num = pending.get('playerNum')
    drew = []
    if is_leader and player_num in (1, 2):
        drew = draw_cc_cards(game, player_num, 1)
    return {'applied': True, 'rerolls': 1, 'drew': drew, 'isLeader': is_leader}


def _cc_black_market_prices(game, pending, ctx):
    """Black Market Prices: draw 2 CCs, discard 1; gain VP = discarded cost."""
    from python.engine.cards.deck import discard_from_hand, draw_with_reshuffle
    from python.engine.data.cc_effects_loader import get_cc_effect
    from python.engine.mechanics.vp_helpers import award_objective_vp

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    if player_num not in (1, 2):
        raise ValueError('black_market_prices: pending missing playerNum')
    drew = draw_with_reshuffle(game, player_num, 2)
    # ctx.discard_card or pick highest-cost drawn
    discard_card = (ctx or {}).get('discard_card')
    if not discard_card and drew:
        costs = [(c, (get_cc_effect(c) or {}).get('cost', 0) or 0) for c in drew]
        discard_card = max(costs, key=lambda x: x[1])[0]
    vp_gained = 0
    if discard_card and discard_from_hand(game, player_num, discard_card):
        cost = (get_cc_effect(discard_card) or {}).get('cost', 0) or 0
        vp_gained = int(cost)
        if vp_gained > 0:
            award_objective_vp(game, player_num, vp_gained)
    return {
        'applied': True, 'drew': drew, 'discarded': discard_card,
        'vpGained': vp_gained,
    }


def _cc_support_specialist(game, pending, ctx):
    """Support Specialist: choose a friendly DROID/TECHNICIAN/TROOPER within 3
    to interrupt and perform a move.

    Records intent on game.supportSpecialistPending for the move handler.
    """
    data = game.data if hasattr(game, 'data') else game
    target_msg_id = (ctx or {}).get('target_msg_id')
    if not target_msg_id:
        raise ValueError('support_specialist: requires ctx.target_msg_id')
    data['supportSpecialistPending'] = {
        'targetMsgId': target_msg_id,
        'playerNum': pending.get('playerNum'),
    }
    return {'applied': True, 'targetMsgId': target_msg_id}


def _cc_brace_yourself(game, pending, ctx):
    """Brace Yourself: +2 Block if not in the attacker's activation.

    Required: ctx.is_attackers_activation (bool).
    """
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    is_att_act = bool((ctx or {}).get('is_attackers_activation'))
    if is_att_act:
        return {'applied': False, 'reason': 'in_attackers_activation'}
    c = dict(combat)
    c['bonusBlock'] = int(c.get('bonusBlock') or 0) + 2
    data['pendingCombat'] = c
    return {'applied': True, 'bonusBlock': 2}


def _cc_battlefield_awareness(game, pending, ctx):
    """Battlefield Awareness: reroll 1 die of any kind for a friendly in LOS.

    Required: ctx.side ('attacker' or 'defender').
    """
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    side = (ctx or {}).get('side')
    if side not in ('attacker', 'defender'):
        raise ValueError("battlefield_awareness: ctx.side must be 'attacker' or 'defender'")
    c = dict(combat)
    key = 'attackerRerollCount' if side == 'attacker' else 'defenderRerollCount'
    c[key] = int(c.get(key) or 0) + 1
    data['pendingCombat'] = c
    return {'applied': True, 'side': side}


def _cc_collect_intel(game, pending, ctx):
    """Collect Intel: look at opponent's hand (info-only, no state change).

    Records game.collectIntelView = {opponentHand} for the caller.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    opp = 2 if player_num == 1 else 1
    opp_hand = list(
        data.get('player2CcHand' if opp == 2 else 'player1CcHand') or []
    )
    data['collectIntelView'] = {'opponentHand': opp_hand, 'viewedBy': player_num}
    return {'applied': True, 'opponentHand': opp_hand}


def _cc_dangerous_bargains(game, pending, ctx):
    """Dangerous Bargains: if you have ≤30 VP, both players gain 3 VP."""
    from python.engine.mechanics.vp_helpers import award_objective_vp

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    vp_key = 'player1VP' if player_num == 1 else 'player2VP'
    cur = int((data.get(vp_key) or {}).get('total') or 0)
    if cur > 30:
        return {'applied': False, 'reason': 'vp_too_high'}
    award_objective_vp(game, 1, 3)
    award_objective_vp(game, 2, 3)
    return {'applied': True, 'vpGrantedEach': 3}


def _cc_eerie_visage(game, pending, ctx):
    """Eerie Visage: each hostile in LOS suffers 1 Strain + becomes Weakened.

    Required: ctx.target_figure_keys (list of hostile fks in LOS) + their
    player_num via ctx.target_player_num.
    """
    targets = (ctx or {}).get('target_figure_keys') or []
    target_pn = (ctx or {}).get('target_player_num')
    if not isinstance(targets, list) or target_pn not in (1, 2):
        raise ValueError('eerie_visage: requires target_figure_keys + target_player_num')
    affected = []
    for fk in targets:
        _apply_hp_damage_via_health_state(game, fk, target_pn, 1)
        _apply_condition_to_target(game, fk, 'Weaken')
        affected.append(fk)
    return {'applied': True, 'affected': affected}


def _cc_espionage_mastery(game, pending, ctx):
    """Espionage Mastery: return discarded CC to hand + draw 1.

    Required: ctx.card_name — the CC to pull from discard to hand.
    """
    from python.engine.cards.deck import draw_cc_cards

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    card = (ctx or {}).get('card_name')
    if not card or player_num not in (1, 2):
        raise ValueError('espionage_mastery: requires card_name + playerNum')
    disc_key = 'player1CcDiscard' if player_num == 1 else 'player2CcDiscard'
    hand_key = 'player1CcHand' if player_num == 1 else 'player2CcHand'
    discard = list(data.get(disc_key) or [])
    if card not in discard:
        return {'applied': False, 'reason': 'card_not_in_discard'}
    discard.remove(card)
    data[disc_key] = discard
    hand = list(data.get(hand_key) or [])
    hand.append(card)
    data[hand_key] = hand
    drew = draw_cc_cards(game, player_num, 1)
    return {'applied': True, 'returned': card, 'drew': drew}


def _cc_flurry_of_blades(game, pending, ctx):
    """Flurry of Blades: perform 3 attacks (double action special).

    Records game.flurryOfBladesRemaining[msg_id] = 3 for the attack
    handler to consume (decrementing on each attack).
    """
    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('flurry_of_blades: requires ctx.msg_id')
    flurry = dict(data.get('flurryOfBladesRemaining') or {})
    flurry[msg_id] = 3
    data['flurryOfBladesRemaining'] = flurry
    return {'applied': True, 'msgId': msg_id, 'attacksRemaining': 3}


def _cc_maximum_firepower(game, pending, ctx):
    """Maximum Firepower: perform attack with +4 Hit.

    Queues the bonus for the next attack.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    bonus = dict(data.get('nextAttackBonuses') or {})
    existing = bonus.get(player_num) or {}
    bonus[player_num] = {
        'bonusHits': int(existing.get('bonusHits') or 0) + 4,
    }
    data['nextAttackBonuses'] = bonus
    return {'applied': True, 'playerNum': player_num, 'bonusHits': 4}


def _cc_marksman(game, pending, ctx):
    """Marksman: figures do not block LOS for this attack."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if isinstance(combat, dict):
        c = dict(combat)
        c['ignoreFigureLOS'] = True
        data['pendingCombat'] = c
        return {'applied': True}
    # Queue for next attack
    player_num = pending.get('playerNum')
    queued = dict(data.get('nextAttackFlags') or {})
    existing = queued.get(player_num) or {}
    existing['ignoreFigureLOS'] = True
    queued[player_num] = existing
    data['nextAttackFlags'] = queued
    return {'applied': True, 'queued': True}


def _cc_opportunistic(game, pending, ctx):
    """Opportunistic: +3 MP after a hostile suffers damage.

    Required: ctx.msg_id.
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank

    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('opportunistic: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 3)
    return {'applied': True, 'msgId': msg_id, 'mpGranted': 3}


def _cc_master_operative(game, pending, ctx):
    """Master Operative: become Focused + +1 Surge when declaring Close Quarters.

    Required: ctx.figure_key.
    """
    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('master_operative: requires ctx.figure_key')
    _apply_condition_to_target(game, figure_key, 'Focus')
    combat = data.get('pendingCombat')
    if isinstance(combat, dict):
        c = dict(combat)
        c['bonusSurges'] = int(c.get('bonusSurges') or 0) + 1
        data['pendingCombat'] = c
    return {'applied': True, 'figureKey': figure_key, 'bonusSurge': 1}


def _cc_new_orders(game, pending, ctx):
    """New Orders (doubleActionSpecial): ready an adjacent friendly's DC.

    Required: ctx.target_msg_id.
    """
    from python.engine.mechanics.player_helpers import (
        get_activated_dc_indices, set_activated_dc_indices,
    )

    data = game.data if hasattr(game, 'data') else game
    target_msg_id = (ctx or {}).get('target_msg_id')
    player_num = pending.get('playerNum')
    if not target_msg_id or player_num not in (1, 2):
        raise ValueError('new_orders: requires target_msg_id + playerNum')
    ids_list = (data.get('p1DcMessageIds') if player_num == 1
                else data.get('p2DcMessageIds')) or []
    if target_msg_id not in ids_list:
        return {'applied': False, 'reason': 'target_not_in_dc_list'}
    idx = ids_list.index(target_msg_id)
    activated = get_activated_dc_indices(game, player_num) or []
    if idx in activated:
        set_activated_dc_indices(
            game, player_num, [i for i in activated if i != idx],
        )
    return {'applied': True, 'readiedMsgId': target_msg_id}


def _cc_iron_will(game, pending, ctx):
    """Iron Will: cannot suffer more than 3 Damage from this attack.

    Sets pendingCombat.maxIncomingDamage = 3.
    """
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['maxIncomingDamage'] = 3
    data['pendingCombat'] = c
    return {'applied': True, 'maxIncomingDamage': 3}


def _cc_of_no_importance(game, pending, ctx):
    """Of No Importance: defeated non-unique figure is worth 4 fewer VPs (min 0).

    Modifies game.lastCombatResult retroactively OR marks the attacker's
    VP reduction via game.pendingVpReduction.

    Required: ctx.reduction_amount (normally 4).
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    opp = 2 if player_num == 1 else 1
    amount = int((ctx or {}).get('reduction_amount', 4))
    # Deduct opponent's VP (they got the kill VP earlier)
    from python.engine.mechanics.vp_helpers import deduct_vp
    deduct_vp(game, opp, amount)
    return {'applied': True, 'opponentVpReduction': amount}


def _cc_i_make_my_own_luck(game, pending, ctx):
    """I Make My Own Luck: claim initiative token this round (Han-only).

    Sets game.initiativeOverride = playerNum. Mentioned: Han Solo must
    activate first — caller enforces that ordering separately.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    data['initiativeOverride'] = player_num
    data['mustActivateFirst'] = 'Han Solo'
    return {'applied': True, 'playerNum': player_num}


def _cc_hunt_them_down(game, pending, ctx):
    """Hunt Them Down: +2 Accuracy + Cleave 2 on Lightsaber Throw attack."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusAccuracy'] = int(c.get('bonusAccuracy') or 0) + 2
    c['bonusCleave'] = int(c.get('bonusCleave') or 0) + 2
    data['pendingCombat'] = c
    return {'applied': True, 'bonusAccuracy': 2, 'cleave': 2}


def _cc_cruel_strike(game, pending, ctx):
    """Cruel Strike: attack gains Surge: Pierce 1, Weaken.

    Adds to pendingCombat.bonusSurgeAbilities.
    """
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    bonus_abilities = list(c.get('bonusSurgeAbilities') or [])
    bonus_abilities.append('cruel_strike')  # {pierce 1, weaken}
    c['bonusSurgeAbilities'] = bonus_abilities
    data['pendingCombat'] = c
    return {'applied': True, 'ability': 'cruel_strike'}


def _cc_face_to_face(game, pending, ctx):
    """Face to Face (specialAction): move up to 2, then attack adjacent.

    Grants 2 MP and flags the figure as "must attack adjacent" via
    faceToFaceActive[msg_id].
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank

    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('face_to_face: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 2)
    flag = dict(data.get('faceToFaceActive') or {})
    flag[msg_id] = True
    data['faceToFaceActive'] = flag
    return {'applied': True, 'msgId': msg_id, 'mpGranted': 2}


def _cc_negation(game, pending, ctx):
    """Negation: cancel an opponent's played 0-cost CC.

    Required: ctx.cancelled_card (the CC being cancelled).
    """
    from python.engine.cards.deck import discard_from_hand

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    cancelled = (ctx or {}).get('cancelled_card')
    if not cancelled or player_num not in (1, 2):
        raise ValueError('negation: requires cancelled_card + playerNum')
    data['pendingCcEffect'] = None
    data['lastCancelledCc'] = {
        'cardName': cancelled,
        'byPlayerNum': player_num,
        'method': 'negation',
    }
    return {'applied': True, 'cancelled': cancelled}


def _cc_change_of_plans(game, pending, ctx):
    """Change of Plans: switch next round's initiative to self."""
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    data['initiativeSwapNextRound'] = {'toPlayerNum': player_num}
    return {'applied': True, 'toPlayerNum': player_num}


def _cc_price_on_their_heads(game, pending, ctx):
    """Price on Their Heads: mark hostile DC; +4 VP when last figure defeated.

    Required: ctx.target_msg_id — opponent's DC msgId.
    Sets game.priceOnTheirHeadsTargets[target_msg_id] = {markerOwner: pn, bonus: 4}.
    """
    data = game.data if hasattr(game, 'data') else game
    target_msg_id = (ctx or {}).get('target_msg_id')
    player_num = pending.get('playerNum')
    if not target_msg_id or player_num not in (1, 2):
        raise ValueError('price_on_their_heads: requires target_msg_id + playerNum')
    marks = dict(data.get('priceOnTheirHeadsTargets') or {})
    marks[target_msg_id] = {'markerOwner': player_num, 'bonus': 4}
    data['priceOnTheirHeadsTargets'] = marks
    return {'applied': True, 'targetMsgId': target_msg_id}


def _cc_strategic_shift(game, pending, ctx):
    """Strategic Shift: chosen player shuffles hand into deck + draws 2.

    Required: ctx.target_player_num.
    """
    from python.engine.cards.deck import draw_cc_cards, shuffle_deck

    data = game.data if hasattr(game, 'data') else game
    target_pn = (ctx or {}).get('target_player_num')
    if target_pn not in (1, 2):
        raise ValueError('strategic_shift: requires ctx.target_player_num')
    hand_key = 'player1CcHand' if target_pn == 1 else 'player2CcHand'
    deck_key = 'player1CcDeck' if target_pn == 1 else 'player2CcDeck'
    hand = list(data.get(hand_key) or [])
    deck = list(data.get(deck_key) or [])
    deck.extend(hand)
    data[deck_key] = deck
    data[hand_key] = []
    shuffle_deck(game, target_pn)
    drew = draw_cc_cards(game, target_pn, 2)
    return {'applied': True, 'targetPlayerNum': target_pn, 'drew': drew}


def _cc_reduce_to_rubble(game, pending, ctx):
    """Reduce to Rubble: apply +3 Hit if attack didn't miss due to accuracy."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    if combat.get('hit') is False:
        return {'applied': False, 'reason': 'attack_missed'}
    c = dict(combat)
    c['bonusHits'] = int(c.get('bonusHits') or 0) + 3
    data['pendingCombat'] = c
    return {'applied': True, 'bonusHits': 3}


def _cc_size_advantage(game, pending, ctx):
    """Size Advantage (specialAction): attack SMALL figure w/ +2 Hit and Weaken surge.

    Queues on nextAttackBonuses for the attack handler.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    bonus = dict(data.get('nextAttackBonuses') or {})
    existing = bonus.get(player_num) or {}
    existing['bonusHits'] = int(existing.get('bonusHits') or 0) + 2
    existing['bonusSurgeAbilities'] = list(existing.get('bonusSurgeAbilities') or []) + [
        'weaken'
    ]
    bonus[player_num] = existing
    data['nextAttackBonuses'] = bonus
    return {'applied': True, 'playerNum': player_num, 'bonusHits': 2}


def _cc_field_tactician(game, pending, ctx):
    """Field Tactician (specialAction): chosen friendly within 2 interrupts to move.

    Required: ctx.target_msg_id — the friendly DC to trigger.
    """
    data = game.data if hasattr(game, 'data') else game
    target_msg_id = (ctx or {}).get('target_msg_id')
    if not target_msg_id:
        raise ValueError('field_tactician: requires ctx.target_msg_id')
    data['fieldTacticianPending'] = {
        'targetMsgId': target_msg_id,
        'playerNum': pending.get('playerNum'),
    }
    return {'applied': True, 'targetMsgId': target_msg_id}


def _cc_feral_swipes(game, pending, ctx):
    """Feral Swipes (specialAction): attack each die separately using red.

    Flags pendingCombat / nextAttackFlags for attack resolver.
    """
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if isinstance(combat, dict):
        c = dict(combat)
        c['feralSwipesActive'] = True
        data['pendingCombat'] = c
        return {'applied': True}
    player_num = pending.get('playerNum')
    flags = dict(data.get('nextAttackFlags') or {})
    existing = flags.get(player_num) or {}
    existing['feralSwipesActive'] = True
    flags[player_num] = existing
    data['nextAttackFlags'] = flags
    return {'applied': True, 'queued': True}


def _cc_guardian_stance(game, pending, ctx):
    """Guardian Stance: reroll 1 or more attack OR defense dice for
    adjacent friendly defender.

    Required: ctx.side ('attacker' or 'defender'), ctx.dice_count (int).
    """
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    side = (ctx or {}).get('side')
    count = int((ctx or {}).get('dice_count') or 1)
    if side not in ('attacker', 'defender'):
        raise ValueError("guardian_stance: side must be 'attacker' or 'defender'")
    c = dict(combat)
    key = 'attackerRerollCount' if side == 'attacker' else 'defenderRerollCount'
    c[key] = int(c.get(key) or 0) + count
    data['pendingCombat'] = c
    return {'applied': True, 'side': side, 'count': count}


def _cc_guild_programming(game, pending, ctx):
    """Guild Programming: each Rapid Fire sub-attack starts Focused.

    Sets game.guildProgrammingActive[msg_id] = True.
    """
    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('guild_programming: requires ctx.msg_id')
    flag = dict(data.get('guildProgrammingActive') or {})
    flag[msg_id] = True
    data['guildProgrammingActive'] = flag
    return {'applied': True, 'msgId': msg_id}


def _cc_hidden_trap(game, pending, ctx):
    """Hidden Trap: adjacent-to-terminal figures take 2 Damage each.

    Required: ctx.adjacent_targets — list of {figureKey, playerNum}.
    """
    targets = (ctx or {}).get('adjacent_targets') or []
    if not isinstance(targets, list):
        raise ValueError('hidden_trap: requires adjacent_targets list')
    hits = []
    for t in targets:
        if not isinstance(t, dict):
            continue
        fk = t.get('figureKey')
        pn = t.get('playerNum')
        if fk and pn in (1, 2):
            _apply_hp_damage_via_health_state(game, fk, pn, 2)
            hits.append(fk)
    return {'applied': True, 'hits': hits}


def _cc_lets_make_a_deal(game, pending, ctx):
    """Let's Make a Deal: pay X VP to apply -X Hits, then become Focused.

    Required: ctx.vp_paid + ctx.figure_key.
    """
    from python.engine.mechanics.vp_helpers import deduct_vp

    data = game.data if hasattr(game, 'data') else game
    vp_paid = int((ctx or {}).get('vp_paid') or 0)
    figure_key = (ctx or {}).get('figure_key')
    player_num = pending.get('playerNum')
    if vp_paid < 0 or not figure_key or player_num not in (1, 2):
        raise ValueError('lets_make_a_deal: requires vp_paid + figure_key + playerNum')
    # Transfer VP to opponent
    opp = 2 if player_num == 1 else 1
    deduct_vp(game, player_num, vp_paid)
    from python.engine.mechanics.vp_helpers import award_objective_vp
    award_objective_vp(game, opp, vp_paid)
    # Apply -X to pendingCombat hits
    combat = data.get('pendingCombat')
    if isinstance(combat, dict):
        c = dict(combat)
        c['bonusHits'] = int(c.get('bonusHits') or 0) - vp_paid
        data['pendingCombat'] = c
    _apply_condition_to_target(game, figure_key, 'Focus')
    return {
        'applied': True, 'vpPaid': vp_paid, 'hitsReduced': vp_paid,
        'figureKey': figure_key,
    }


def _cc_learn_by_example(game, pending, ctx):
    """Learn by Example: play as a copy of a FORCE USER CC in a discard pile.

    Required: ctx.copied_card — the name of the CC to copy.
    Queues the copied effect via game.pendingCcEffect.
    """
    data = game.data if hasattr(game, 'data') else game
    copied = (ctx or {}).get('copied_card')
    if not copied:
        raise ValueError('learn_by_example: requires ctx.copied_card')
    data['pendingCcEffect'] = {
        'cardName': copied,
        'playerNum': pending.get('playerNum'),
        'viaLearnByExample': True,
    }
    return {'applied': True, 'copiedCard': copied}


def _cc_transmit_the_plans(game, pending, ctx):
    """Transmit the Plans: distribute 2 Hit Tokens + 2 VP if adjacent to terminal.

    Required: ctx.distribution — list of {figureKey, count} summing ≤ 2.
    Optional: ctx.adjacent_to_terminal (bool).
    """
    from python.engine.mechanics.tokens import grant_power_tokens
    from python.engine.mechanics.vp_helpers import award_objective_vp

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    dist = (ctx or {}).get('distribution') or []
    if not isinstance(dist, list):
        raise ValueError('transmit_the_plans: requires ctx.distribution list')
    total = sum(int(e.get('count', 0)) for e in dist if isinstance(e, dict))
    if total > 2:
        raise ValueError(f'transmit_the_plans: distribution sum must be ≤2 (got {total})')
    for entry in dist:
        fk = entry.get('figureKey')
        count = int(entry.get('count', 0))
        if fk and count > 0:
            grant_power_tokens(data, fk, 'Damage', count)
    vp_awarded = 0
    if (ctx or {}).get('adjacent_to_terminal') and player_num in (1, 2):
        award_objective_vp(game, player_num, 2)
        vp_awarded = 2
    return {'applied': True, 'tokensDistributed': total, 'vpAwarded': vp_awarded}


def _cc_dark_energy(game, pending, ctx):
    """Dark Energy (duringActivation): push a SMALL figure within 3 up to 1 space,
    then that figure suffers 1 damage.

    Required: ctx.target_figure_key + ctx.target_player_num + ctx.destination.
    """
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    target_pn = (ctx or {}).get('target_player_num')
    destination = (ctx or {}).get('destination')
    if not target_fk or target_pn not in (1, 2) or not destination:
        raise ValueError(
            'dark_energy: requires target_figure_key + target_player_num + destination'
        )
    positions_all = data.get('figurePositions') or {}
    pos_map = positions_all.get(target_pn)
    if isinstance(pos_map, dict) and target_fk in pos_map:
        pm = dict(pos_map)
        pm[target_fk] = str(destination).lower()
        positions_all[target_pn] = pm
        data['figurePositions'] = positions_all
    _apply_hp_damage_via_health_state(game, target_fk, target_pn, 1)
    return {
        'applied': True, 'targetFigureKey': target_fk,
        'destination': str(destination).lower(), 'damage': 1,
    }


def _cc_dioxis_fumes(game, pending, ctx):
    """Dioxis Fumes: each non-DROID figure suffers 1 Strain; until end of
    round, non-DROIDs can't gain movement points.

    Required: ctx.non_droid_targets — list of {figureKey, playerNum}.
    """
    data = game.data if hasattr(game, 'data') else game
    targets = (ctx or {}).get('non_droid_targets') or []
    if not isinstance(targets, list):
        raise ValueError('dioxis_fumes: requires non_droid_targets list')
    hits = []
    for t in targets:
        if not isinstance(t, dict):
            continue
        fk = t.get('figureKey')
        pn = t.get('playerNum')
        if fk and pn in (1, 2):
            _apply_hp_damage_via_health_state(game, fk, pn, 1)
            hits.append(fk)
    data['dioxisFumesActive'] = True  # blocks MP grants to non-DROIDs this round
    return {'applied': True, 'hits': hits, 'mpBlockActive': True}


def _cc_take_it_down(game, pending, ctx):
    """Take it Down: chosen friendly performs attack with +2 Hit.

    Queues on nextAttackBonuses[target_player_num] and records a
    pendingTriggeredAttack marker.
    """
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    target_pn = (ctx or {}).get('target_player_num')
    if not target_fk or target_pn not in (1, 2):
        raise ValueError('take_it_down: requires target_figure_key + target_player_num')
    bonus = dict(data.get('nextAttackBonuses') or {})
    existing = bonus.get(target_pn) or {}
    existing['bonusHits'] = int(existing.get('bonusHits') or 0) + 2
    bonus[target_pn] = existing
    data['nextAttackBonuses'] = bonus
    data['pendingTriggeredAttack'] = {
        'attackerFigureKey': target_fk, 'playerNum': target_pn,
    }
    return {'applied': True, 'attackerFigureKey': target_fk, 'bonusHits': 2}


def _cc_sarlacc_sweep(game, pending, ctx):
    """Sarlacc Sweep: perform 2 attacks against different figures.

    Records game.sarlaccSweepRemaining[msg_id] = 2 for the attack handler.
    """
    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('sarlacc_sweep: requires ctx.msg_id')
    flag = dict(data.get('sarlaccSweepRemaining') or {})
    flag[msg_id] = 2
    data['sarlaccSweepRemaining'] = flag
    return {'applied': True, 'msgId': msg_id, 'attacksRemaining': 2}


def _cc_call_the_vanguard(game, pending, ctx):
    """Call the Vanguard: friendly TROOPER (cost ≥4) interrupts to move + attack.

    Required: ctx.target_msg_id.
    """
    data = game.data if hasattr(game, 'data') else game
    target_msg_id = (ctx or {}).get('target_msg_id')
    if not target_msg_id:
        raise ValueError('call_the_vanguard: requires ctx.target_msg_id')
    data['callTheVanguardPending'] = {
        'targetMsgId': target_msg_id,
        'playerNum': pending.get('playerNum'),
    }
    return {'applied': True, 'targetMsgId': target_msg_id}


def _cc_combat_resupply(game, pending, ctx):
    """Combat Resupply: distribute Hit tokens equal to current round to
    friendlies within 3.

    Required: ctx.distribution — list of {figureKey, count} summing ≤ round.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    dist = (ctx or {}).get('distribution') or []
    round_num = int(data.get('round') or data.get('currentRound') or 1)
    if not isinstance(dist, list):
        raise ValueError('combat_resupply: requires distribution list')
    total = sum(int(e.get('count', 0)) for e in dist if isinstance(e, dict))
    if total > round_num:
        raise ValueError(
            f'combat_resupply: distribution sum ({total}) > round ({round_num})'
        )
    for entry in dist:
        fk = entry.get('figureKey')
        count = int(entry.get('count', 0))
        if fk and count > 0:
            grant_power_tokens(data, fk, 'Damage', count)
    return {'applied': True, 'tokensDistributed': total, 'roundCap': round_num}


def _cc_behind_enemy_lines(game, pending, ctx):
    """Behind Enemy Lines: look at top 3 of opponent's deck.

    Records game.behindEnemyLinesView = {cards, viewedBy}.
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    opp = 2 if player_num == 1 else 1
    deck_key = 'player2CcDeck' if opp == 2 else 'player1CcDeck'
    top3 = list((data.get(deck_key) or [])[:3])
    data['behindEnemyLinesView'] = {'cards': top3, 'viewedBy': player_num}
    return {'applied': True, 'topCards': top3}


def _cc_against_the_odds(game, pending, ctx):
    """Against the Odds (endOfRound): if opponent has ≥8 more VP, up to 3 of
    your figures gain Focus and a power token.

    Required: ctx.target_figure_keys (list up to 3).
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    opp = 2 if player_num == 1 else 1
    own_key = 'player1VP' if player_num == 1 else 'player2VP'
    opp_key = 'player2VP' if opp == 2 else 'player1VP'
    own_vp = int((data.get(own_key) or {}).get('total') or 0)
    opp_vp = int((data.get(opp_key) or {}).get('total') or 0)
    if opp_vp - own_vp < 8:
        return {'applied': False, 'reason': 'vp_gap_below_8'}
    targets = (ctx or {}).get('target_figure_keys') or []
    if len(targets) > 3:
        raise ValueError('against_the_odds: at most 3 targets')
    applied_targets = []
    for fk in targets:
        _apply_condition_to_target(game, fk, 'Focus')
        grant_power_tokens(data, fk, 'Surge', 1)
        applied_targets.append(fk)
    return {'applied': True, 'targets': applied_targets}


def _cc_ballistics_matrix(game, pending, ctx):
    """Ballistics Matrix: place as attachment on own DC.

    Required: ctx.msg_id.
    """
    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    player_num = pending.get('playerNum')
    if not msg_id or player_num not in (1, 2):
        raise ValueError('ballistics_matrix: requires msg_id + playerNum')
    key = 'p1CcAttachments' if player_num == 1 else 'p2CcAttachments'
    attachments = dict(data.get(key) or {})
    card_list = list(attachments.get(msg_id) or [])
    if 'Ballistics Matrix' not in card_list:
        card_list.append('Ballistics Matrix')
    attachments[msg_id] = card_list
    data[key] = attachments
    return {'applied': True, 'attachedTo': msg_id}


def _cc_ballistics_matrix_exhaust(game, pending, ctx):
    """Ballistics Matrix exhaust trigger: spend to re-roll any number of attack dice."""
    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    count = int((ctx or {}).get('reroll_count') or 1)
    if not msg_id:
        raise ValueError('ballistics_matrix_exhaust: requires ctx.msg_id')
    # Mark exhausted
    exhausted_map = dict(data.get('exhaustedSkirmishUpgrades') or {})
    exh_list = list(exhausted_map.get(msg_id) or [])
    if 'Ballistics Matrix' not in exh_list:
        exh_list.append('Ballistics Matrix')
    exhausted_map[msg_id] = exh_list
    data['exhaustedSkirmishUpgrades'] = exhausted_map
    # Add rerolls to combat
    combat = data.get('pendingCombat')
    if isinstance(combat, dict):
        c = dict(combat)
        c['attackerRerollCount'] = int(c.get('attackerRerollCount') or 0) + count
        data['pendingCombat'] = c
    return {'applied': True, 'rerolls': count}


def _cc_blood_feud(game, pending, ctx):
    """Blood Feud (specialAction): place on hostile DC; when last figure
    defeated, +4 VP.

    Required: ctx.target_msg_id — opponent's DC msgId.
    Sets game.bloodFeudTargets[target_msg_id] = {markerOwner, bonus:4}.
    """
    data = game.data if hasattr(game, 'data') else game
    target_msg_id = (ctx or {}).get('target_msg_id')
    player_num = pending.get('playerNum')
    if not target_msg_id or player_num not in (1, 2):
        raise ValueError('blood_feud: requires target_msg_id + playerNum')
    marks = dict(data.get('bloodFeudTargets') or {})
    marks[target_msg_id] = {'markerOwner': player_num, 'bonus': 4}
    data['bloodFeudTargets'] = marks
    return {'applied': True, 'targetMsgId': target_msg_id}


def _cc_balancing_force(game, pending, ctx):
    """Balancing Force: each player chooses up to 3 figures, rolls 1 red die
    and applies damage equal to dots (simplified: take ctx.damage list).

    Required: ctx.hits — list of {figureKey, playerNum, damage}.
    """
    data = game.data if hasattr(game, 'data') else game
    hits = (ctx or {}).get('hits') or []
    if not isinstance(hits, list):
        raise ValueError('balancing_force: requires hits list')
    applied = []
    for h in hits:
        if not isinstance(h, dict):
            continue
        fk = h.get('figureKey')
        pn = h.get('playerNum')
        dmg = int(h.get('damage') or 0)
        if fk and pn in (1, 2) and dmg > 0:
            _apply_hp_damage_via_health_state(game, fk, pn, dmg)
            applied.append(fk)
    return {'applied': True, 'hits': applied}


def _cc_payday(game, pending, ctx):
    """Payday: gain 4 VP. Discard 2 random CCs from opponent's hand."""
    from python.engine.mechanics.vp_helpers import award_objective_vp

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    award_objective_vp(game, player_num, 4)
    # Opponent discards 2 from hand (caller picks which; default: first 2)
    opp = 2 if player_num == 1 else 1
    hand_key = 'player1CcHand' if opp == 1 else 'player2CcHand'
    disc_key = 'player1CcDiscard' if opp == 1 else 'player2CcDiscard'
    hand = list(data.get(hand_key) or [])
    discard = list(data.get(disc_key) or [])
    # Discard 2 (or fewer if hand smaller)
    discarded = hand[:2]
    discard.extend(discarded)
    data[hand_key] = hand[2:]
    data[disc_key] = discard
    return {'applied': True, 'vpGained': 4, 'oppDiscarded': discarded}


def _cc_provoke(game, pending, ctx):
    """Provoke: friendly TROOPER/GUARDIAN recovers 2 Damage.

    Required: ctx.figure_key + ctx.msg_id.
    """
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import parse_figure_key

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    player_num = pending.get('playerNum')
    if not figure_key or not msg_id or player_num not in (1, 2):
        raise ValueError('provoke: requires figure_key + msg_id + playerNum')
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    dc_health_state = data.get('dcHealthState')
    if isinstance(dc_health_state, dict):
        heal_hp(dc_health_state, data, msg_id, fig_idx, 2, player_num)
    return {'applied': True, 'figureKey': figure_key, 'healed': 2}


def _cc_on_a_mission(game, pending, ctx):
    """On a Mission: move up to 5 spaces + push SMALL entered figures.

    Required: ctx.msg_id. Grants +5 MP via grant_movement_bank with
    marker onAMissionActive[msg_id] = True for push logic.
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank

    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('on_a_mission: requires ctx.msg_id')
    grant_movement_bank(game, msg_id, 5)
    flag = dict(data.get('onAMissionActive') or {})
    flag[msg_id] = True
    data['onAMissionActive'] = flag
    return {'applied': True, 'msgId': msg_id, 'mpGranted': 5}


def _cc_last_stand(game, pending, ctx):
    """Last Stand: prevent defeat — figure stays at 1 HP instead.

    Required: ctx.figure_key + ctx.msg_id.
    """
    from python.engine.mechanics.dc_helpers import parse_figure_key

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    player_num = pending.get('playerNum')
    if not figure_key or not msg_id or player_num not in (1, 2):
        raise ValueError('last_stand: requires figure_key + msg_id + playerNum')
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    dc_health_state = data.get('dcHealthState')
    if isinstance(dc_health_state, dict):
        hs = dc_health_state.get(msg_id) or []
        if fig_idx < len(hs):
            entry = hs[fig_idx]
            if isinstance(entry, list) and len(entry) >= 2:
                entry[0] = max(1, entry[0])  # ensure ≥1 HP
                dc_health_state[msg_id] = hs
    return {'applied': True, 'figureKey': figure_key, 'survived': True}


def _cc_retreat(game, pending, ctx):
    """Retreat: +3 MP and remove all HARMFUL conditions.

    Required: ctx.figure_key + ctx.msg_id.
    """
    from python.engine.mechanics.conditions import filter_condition
    from python.engine.mechanics.game_helpers import grant_movement_bank

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    if not figure_key or not msg_id:
        raise ValueError('retreat: requires figure_key + msg_id')
    grant_movement_bank(game, msg_id, 3)
    for cond in ('Stun', 'Weaken', 'Bleed'):
        filter_condition(game, figure_key, cond)
    return {'applied': True, 'figureKey': figure_key, 'mpGranted': 3}


def _cc_stasis(game, pending, ctx):
    """Stasis: target hostile becomes Stunned."""
    target_fk = (ctx or {}).get('target_figure_key')
    if not target_fk:
        raise ValueError('stasis: requires ctx.target_figure_key')
    _apply_condition_to_target(game, target_fk, 'Stun')
    return {'applied': True, 'targetFigureKey': target_fk}


def _cc_targeted(game, pending, ctx):
    """Targeted: gain +3 Accuracy this attack."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusAccuracy'] = int(c.get('bonusAccuracy') or 0) + 3
    data['pendingCombat'] = c
    return {'applied': True, 'bonusAccuracy': 3}


def _cc_tactical_officer(game, pending, ctx):
    """Tactical Officer (specialAction): friendly interrupts to perform an action.

    Required: ctx.target_msg_id.
    """
    data = game.data if hasattr(game, 'data') else game
    target_msg_id = (ctx or {}).get('target_msg_id')
    if not target_msg_id:
        raise ValueError('tactical_officer: requires ctx.target_msg_id')
    data['tacticalOfficerPending'] = {
        'targetMsgId': target_msg_id,
        'playerNum': pending.get('playerNum'),
    }
    return {'applied': True, 'targetMsgId': target_msg_id}


def _cc_frenzy(game, pending, ctx):
    """Frenzy (duringActivation): gain an extra attack this activation.

    Sets game.frenzyBonusAttack[msg_id] = True.
    """
    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    if not msg_id:
        raise ValueError('frenzy: requires ctx.msg_id')
    flag = dict(data.get('frenzyBonusAttack') or {})
    flag[msg_id] = True
    data['frenzyBonusAttack'] = flag
    return {'applied': True, 'msgId': msg_id}


def _cc_grit(game, pending, ctx):
    """Grit: recover 3 Damage + become Focused."""
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import parse_figure_key

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    player_num = pending.get('playerNum')
    if not figure_key or not msg_id or player_num not in (1, 2):
        raise ValueError('grit: requires figure_key + msg_id + playerNum')
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    dc_health_state = data.get('dcHealthState')
    if isinstance(dc_health_state, dict):
        heal_hp(dc_health_state, data, msg_id, fig_idx, 3, player_num)
    _apply_condition_to_target(game, figure_key, 'Focus')
    return {'applied': True, 'figureKey': figure_key, 'healed': 3}


def _cc_shoot_to_kill(game, pending, ctx):
    """Shoot to Kill: +2 Hit for this attack."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusHits'] = int(c.get('bonusHits') or 0) + 2
    data['pendingCombat'] = c
    return {'applied': True, 'bonusHits': 2}


def _cc_skirmish(game, pending, ctx):
    """Skirmish: +2 Hit for a TROOPER friendly's next attack.

    Queues bonus on nextAttackBonuses[playerNum].
    """
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    bonus = dict(data.get('nextAttackBonuses') or {})
    existing = bonus.get(player_num) or {}
    existing['bonusHits'] = int(existing.get('bonusHits') or 0) + 2
    existing['trooperOnly'] = True
    bonus[player_num] = existing
    data['nextAttackBonuses'] = bonus
    return {'applied': True, 'bonusHits': 2}


def _cc_strategic_assault(game, pending, ctx):
    """Strategic Assault: +2 Hit and Pierce 2 for this attack."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusHits'] = int(c.get('bonusHits') or 0) + 2
    c['bonusPierce'] = int(c.get('bonusPierce') or 0) + 2
    data['pendingCombat'] = c
    return {'applied': True, 'bonusHits': 2, 'pierce': 2}


def _cc_bulk_up(game, pending, ctx):
    """Bulk Up: +3 Health this round (attached as marker)."""
    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('bulk_up: requires ctx.figure_key')
    bulk = dict(data.get('bulkUpActive') or {})
    bulk[figure_key] = 3
    data['bulkUpActive'] = bulk
    return {'applied': True, 'figureKey': figure_key, 'bonusHealth': 3}


def _cc_heroic_effort(game, pending, ctx):
    """Heroic Effort: ready DC + gain 2 Power Tokens.

    Required: ctx.msg_id + ctx.figure_key.
    """
    from python.engine.mechanics.player_helpers import (
        get_activated_dc_indices, set_activated_dc_indices,
    )
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    msg_id = (ctx or {}).get('msg_id')
    figure_key = (ctx or {}).get('figure_key')
    player_num = pending.get('playerNum')
    if not msg_id or not figure_key or player_num not in (1, 2):
        raise ValueError('heroic_effort: requires msg_id + figure_key + playerNum')
    ids_list = (data.get('p1DcMessageIds') if player_num == 1
                else data.get('p2DcMessageIds')) or []
    if msg_id in ids_list:
        idx = ids_list.index(msg_id)
        activated = get_activated_dc_indices(game, player_num) or []
        if idx in activated:
            set_activated_dc_indices(
                game, player_num, [i for i in activated if i != idx],
            )
    grant_power_tokens(data, figure_key, 'Surge', 2)
    return {'applied': True, 'msgId': msg_id, 'tokensGranted': 2}


def _cc_fear_and_dead_men(game, pending, ctx):
    """Fear and Dead Men (whileDefending): +3 Block."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusBlock'] = int(c.get('bonusBlock') or 0) + 3
    data['pendingCombat'] = c
    return {'applied': True, 'bonusBlock': 3}


def _cc_field_medic(game, pending, ctx):
    """Field Medic: choose up to 2 friendlies within 3 — each recovers 2 Damage.

    Required: ctx.targets — list of {figureKey, msgId}.
    """
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import parse_figure_key

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    targets = (ctx or {}).get('targets') or []
    if len(targets) > 2:
        raise ValueError('field_medic: at most 2 targets')
    dc_health_state = data.get('dcHealthState')
    if not isinstance(dc_health_state, dict):
        return {'applied': False, 'reason': 'no_health_state'}
    healed = []
    for t in targets:
        if not isinstance(t, dict):
            continue
        fk = t.get('figureKey')
        mid = t.get('msgId')
        if fk and mid:
            fig_idx = parse_figure_key(fk).get('figureIndex', 0)
            heal_hp(dc_health_state, data, mid, fig_idx, 2, player_num)
            healed.append(fk)
    return {'applied': True, 'healed': healed}


def _cc_in_the_crosshairs(game, pending, ctx):
    """In the Crosshairs: attack targeting this figure gains +2 Accuracy."""
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    if not target_fk:
        raise ValueError('in_the_crosshairs: requires ctx.target_figure_key')
    marks = dict(data.get('inTheCrosshairsTargets') or {})
    marks[target_fk] = {'bonusAccuracy': 2}
    data['inTheCrosshairsTargets'] = marks
    return {'applied': True, 'targetFigureKey': target_fk}


def _cc_throw(game, pending, ctx):
    """Throw: adjacent figure suffers 2 Damage."""
    target_fk = (ctx or {}).get('target_figure_key')
    target_pn = (ctx or {}).get('target_player_num')
    if not target_fk or target_pn not in (1, 2):
        raise ValueError('throw: requires target_figure_key + target_player_num')
    _apply_hp_damage_via_health_state(game, target_fk, target_pn, 2)
    return {'applied': True, 'targetFigureKey': target_fk, 'damage': 2}


def _cc_choke(game, pending, ctx):
    """Choke: adjacent hostile suffers 2 Strain."""
    target_fk = (ctx or {}).get('target_figure_key')
    target_pn = (ctx or {}).get('target_player_num')
    if not target_fk or target_pn not in (1, 2):
        raise ValueError('choke: requires target_figure_key + target_player_num')
    _apply_hp_damage_via_health_state(game, target_fk, target_pn, 2)
    return {'applied': True, 'targetFigureKey': target_fk, 'strain': 2}


def _cc_battle_meditation_cc(game, pending, ctx):
    """Battle Meditation: friendly FORCE USER within 3 performs a move + attack.

    Required: ctx.target_msg_id.
    """
    data = game.data if hasattr(game, 'data') else game
    target_msg_id = (ctx or {}).get('target_msg_id')
    if not target_msg_id:
        raise ValueError('battle_meditation: requires ctx.target_msg_id')
    data['battleMeditationPending'] = {
        'targetMsgId': target_msg_id,
        'playerNum': pending.get('playerNum'),
    }
    return {'applied': True, 'targetMsgId': target_msg_id}


def _cc_preservation_protocol(game, pending, ctx):
    """Preservation Protocol: when at 0 health, recover 4 HP.

    Required: ctx.figure_key + ctx.msg_id.
    """
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import parse_figure_key

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    player_num = pending.get('playerNum')
    if not figure_key or not msg_id or player_num not in (1, 2):
        raise ValueError('preservation_protocol: requires figure_key + msg_id + playerNum')
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    dc_health_state = data.get('dcHealthState')
    if isinstance(dc_health_state, dict):
        heal_hp(dc_health_state, data, msg_id, fig_idx, 4, player_num)
    return {'applied': True, 'figureKey': figure_key, 'healed': 4}


def _cc_dirty_trick(game, pending, ctx):
    """Dirty Trick (whenHostileFigureEntersAdjacentSpace): hostile Stunned and
    Weakened.

    Required: ctx.target_figure_key.
    """
    target_fk = (ctx or {}).get('target_figure_key')
    if not target_fk:
        raise ValueError('dirty_trick: requires ctx.target_figure_key')
    _apply_condition_to_target(game, target_fk, 'Stun')
    _apply_condition_to_target(game, target_fk, 'Weaken')
    return {'applied': True, 'targetFigureKey': target_fk}


def _cc_parting_blow(game, pending, ctx):
    """Parting Blow (whenHostileFigureExitsAdjacentSpace): perform a free attack
    against the exiting figure.

    Queues pendingTriggeredAttack for the attack flow.
    """
    data = game.data if hasattr(game, 'data') else game
    attacker_fk = (ctx or {}).get('attacker_figure_key')
    target_fk = (ctx or {}).get('target_figure_key')
    if not attacker_fk or not target_fk:
        raise ValueError('parting_blow: requires attacker_figure_key + target_figure_key')
    data['pendingTriggeredAttack'] = {
        'attackerFigureKey': attacker_fk,
        'targetFigureKey': target_fk,
        'playerNum': pending.get('playerNum'),
    }
    return {'applied': True, 'attackerFigureKey': attacker_fk, 'targetFigureKey': target_fk}


def _cc_extra_protection(game, pending, ctx):
    """Extra Protection: adjacent friendly that suffered 3+ damage recovers 2 HP.

    Required: ctx.figure_key + ctx.msg_id.
    """
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import parse_figure_key

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    player_num = pending.get('playerNum')
    if not figure_key or not msg_id or player_num not in (1, 2):
        raise ValueError('extra_protection: requires figure_key + msg_id + playerNum')
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    dc_health_state = data.get('dcHealthState')
    if isinstance(dc_health_state, dict):
        heal_hp(dc_health_state, data, msg_id, fig_idx, 2, player_num)
    return {'applied': True, 'figureKey': figure_key, 'healed': 2}


def _cc_final_stand(game, pending, ctx):
    """Final Stand: friendly at 0 health restores to 1 (prevents defeat).

    Required: ctx.figure_key + ctx.msg_id.
    """
    from python.engine.mechanics.dc_helpers import parse_figure_key

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    if not figure_key or not msg_id:
        raise ValueError('final_stand: requires figure_key + msg_id')
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    dc_health_state = data.get('dcHealthState')
    if isinstance(dc_health_state, dict):
        hs = dc_health_state.get(msg_id) or []
        if fig_idx < len(hs):
            entry = hs[fig_idx]
            if isinstance(entry, list) and len(entry) >= 2:
                entry[0] = max(1, entry[0])
                dc_health_state[msg_id] = hs
    return {'applied': True, 'figureKey': figure_key}


def _cc_get_behind_me(game, pending, ctx):
    """Get Behind Me!: redirect attack from SMALL friendly to self.

    Required: ctx.new_target_figure_key (self), ctx.original_target (small friend).
    """
    data = game.data if hasattr(game, 'data') else game
    new_target = (ctx or {}).get('new_target_figure_key')
    original = (ctx or {}).get('original_target')
    if not new_target:
        raise ValueError('get_behind_me: requires ctx.new_target_figure_key')
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['redirectedTargetFigureKey'] = new_target
    c['originalTarget'] = original
    data['pendingCombat'] = c
    return {'applied': True, 'newTarget': new_target}


def _cc_crush(game, pending, ctx):
    """Crush (whenYouEndMovementInSpacesWithOtherFigures): chosen SMALL figure
    suffers 4 Damage.

    Required: ctx.target_figure_key + ctx.target_player_num.
    """
    target_fk = (ctx or {}).get('target_figure_key')
    target_pn = (ctx or {}).get('target_player_num')
    if not target_fk or target_pn not in (1, 2):
        raise ValueError('crush: requires target_figure_key + target_player_num')
    _apply_hp_damage_via_health_state(game, target_fk, target_pn, 4)
    return {'applied': True, 'targetFigureKey': target_fk, 'damage': 4}


def _cc_self_defense(game, pending, ctx):
    """Self-Defense (whenHostileFigureEntersAdjacentSpace): hostile suffers
    2 Damage + becomes Stunned.

    Required: ctx.target_figure_key + ctx.target_player_num.
    """
    target_fk = (ctx or {}).get('target_figure_key')
    target_pn = (ctx or {}).get('target_player_num')
    if not target_fk or target_pn not in (1, 2):
        raise ValueError('self_defense: requires target_figure_key + target_player_num')
    _apply_hp_damage_via_health_state(game, target_fk, target_pn, 2)
    _apply_condition_to_target(game, target_fk, 'Stun')
    return {'applied': True, 'targetFigureKey': target_fk, 'damage': 2}


def _cc_slippery_target(game, pending, ctx):
    """Slippery Target (whenHostileFigureEntersAdjacentSpace): gain +1 Evade
    this round + Hide.

    Required: ctx.figure_key.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    if not figure_key:
        raise ValueError('slippery_target: requires ctx.figure_key')
    grant_power_tokens(data, figure_key, 'Evade', 1)
    _apply_condition_to_target(game, figure_key, 'Hide')
    return {'applied': True, 'figureKey': figure_key}


def _cc_survival_instinct(game, pending, ctx):
    """Survival Instinct: prevent defeat + heal 3 HP on friendly within 3.

    Required: ctx.figure_key + ctx.msg_id.
    """
    from python.engine.mechanics.damage_helpers import heal_hp
    from python.engine.mechanics.dc_helpers import parse_figure_key

    data = game.data if hasattr(game, 'data') else game
    figure_key = (ctx or {}).get('figure_key')
    msg_id = (ctx or {}).get('msg_id')
    player_num = pending.get('playerNum')
    if not figure_key or not msg_id or player_num not in (1, 2):
        raise ValueError('survival_instinct: requires figure_key + msg_id + playerNum')
    fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
    dc_health_state = data.get('dcHealthState')
    if isinstance(dc_health_state, dict):
        hs = dc_health_state.get(msg_id) or []
        if fig_idx < len(hs):
            entry = hs[fig_idx]
            if isinstance(entry, list) and len(entry) >= 2:
                entry[0] = max(1, entry[0])
                dc_health_state[msg_id] = hs
        heal_hp(dc_health_state, data, msg_id, fig_idx, 3, player_num)
    return {'applied': True, 'figureKey': figure_key, 'healed': 3}


def _cc_no_cheating(game, pending, ctx):
    """No Cheating (atStartOfActivationOfHostileFigureInYourLineOfSight):
    hostile becomes Stunned."""
    target_fk = (ctx or {}).get('target_figure_key')
    if not target_fk:
        raise ValueError('no_cheating: requires ctx.target_figure_key')
    _apply_condition_to_target(game, target_fk, 'Stun')
    return {'applied': True, 'targetFigureKey': target_fk}


def _cc_still_faster_than_you(game, pending, ctx):
    """Still Faster Than You: +3 MP + Focus (duringActivation)."""
    from python.engine.mechanics.game_helpers import grant_movement_bank

    msg_id = (ctx or {}).get('msg_id')
    figure_key = (ctx or {}).get('figure_key')
    if not msg_id or not figure_key:
        raise ValueError('still_faster_than_you: requires msg_id + figure_key')
    grant_movement_bank(game, msg_id, 3)
    _apply_condition_to_target(game, figure_key, 'Focus')
    return {'applied': True, 'mpGranted': 3, 'figureKey': figure_key}


def _cc_lord_of_the_sith(game, pending, ctx):
    """Lord of the Sith: +4 VP when hostile is defeated outside your activation."""
    from python.engine.mechanics.vp_helpers import award_objective_vp

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    award_objective_vp(game, player_num, 4)
    return {'applied': True, 'vpGained': 4}


def _cc_paid_in_beskar(game, pending, ctx):
    """Paid in Beskar: when you defeat a hostile within 3, gain 2 objective VP."""
    from python.engine.mechanics.vp_helpers import award_objective_vp

    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    award_objective_vp(game, player_num, 2)
    return {'applied': True, 'vpGained': 2}


def _cc_rapid_recalibration(game, pending, ctx):
    """Rapid Recalibration: reroll up to 3 attack dice (before defender rerolls)."""
    data = game.data if hasattr(game, 'data') else game
    count = int((ctx or {}).get('reroll_count') or 1)
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    if count > 3:
        count = 3
    c = dict(combat)
    c['attackerRerollCount'] = int(c.get('attackerRerollCount') or 0) + count
    data['pendingCombat'] = c
    return {'applied': True, 'rerolls': count}


def _cc_change_their_minds(game, pending, ctx):
    """Change Their Minds: opponent changes their mind — effectively moves 1
    figure of theirs.

    Required: ctx.target_figure_key + ctx.destination.
    """
    data = game.data if hasattr(game, 'data') else game
    target_fk = (ctx or {}).get('target_figure_key')
    destination = (ctx or {}).get('destination')
    target_pn = (ctx or {}).get('target_player_num')
    if not target_fk or not destination or target_pn not in (1, 2):
        raise ValueError(
            'change_their_minds: requires target_figure_key + destination + target_player_num'
        )
    positions_all = data.get('figurePositions') or {}
    pos_map = positions_all.get(target_pn)
    if isinstance(pos_map, dict) and target_fk in pos_map:
        pm = dict(pos_map)
        pm[target_fk] = str(destination).lower()
        positions_all[target_pn] = pm
        data['figurePositions'] = positions_all
    return {
        'applied': True, 'targetFigureKey': target_fk,
        'destination': str(destination).lower(),
    }


def _cc_overcharged_weapons(game, pending, ctx):
    """Overcharged Weapons: +1 damage to next attack this activation."""
    data = game.data if hasattr(game, 'data') else game
    player_num = pending.get('playerNum')
    bonus_map = dict(data.get('nextAttackBonusDamage') or {})
    bonus_map[player_num] = int(bonus_map.get(player_num) or 0) + 1
    data['nextAttackBonusDamage'] = bonus_map
    return {'applied': True, 'bonusDamage': 1}


def _cc_protect_the_old_ways(game, pending, ctx):
    """Protect the Old Ways: friendly within 3 defends with +1 Block."""
    data = game.data if hasattr(game, 'data') else game
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    c['bonusBlock'] = int(c.get('bonusBlock') or 0) + 1
    data['pendingCombat'] = c
    return {'applied': True, 'bonusBlock': 1}


def _cc_there_is_no_try(game, pending, ctx):
    """There Is No Try: reroll all dice in a friendly REBEL FORCE USER's pool."""
    data = game.data if hasattr(game, 'data') else game
    side = (ctx or {}).get('side', 'attacker').lower()
    if side not in ('attacker', 'defender'):
        raise ValueError("there_is_no_try: side must be 'attacker' or 'defender'")
    combat = data.get('pendingCombat')
    if not isinstance(combat, dict):
        return {'applied': False, 'reason': 'no_pending_combat'}
    c = dict(combat)
    key = 'attackerRerollAllEnabled' if side == 'attacker' else 'defenderRerollAllEnabled'
    c[key] = True
    data['pendingCombat'] = c
    return {'applied': True, 'side': side}


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
register('Deadeye', _cc_deadeye)
register('Positioning Advantage', _cc_positioning_advantage)
register('Fleet Footed', _cc_fleet_footed)
register('Heavy Armor', _cc_heavy_armor)
register('Parry', _cc_parry)
register('Hour of Need', _cc_hour_of_need)
register('Force Push', _cc_force_push)
register('Grisly Contest', _cc_grisly_contest)
register('Stimulants', _cc_stimulants)
register('Mitigate', _cc_mitigate)
register('Hard to Hit', _cc_hard_to_hit)
register('Brace for Impact', _cc_brace_for_impact)
register('Stealth Tactics', _cc_stealth_tactics)
register('Lock On', _cc_lock_on)
register('Forward March', _cc_forward_march)
register('Ready Weapons', _cc_ready_weapons)
register('Roar', _cc_roar)
register('Reposition', _cc_reposition)
register('Regroup', _cc_regroup)
register('Bladestorm', _cc_bladestorm)
register('Spinning Kick', _cc_spinning_kick)
register('Heightened Reflexes', _cc_heightened_reflexes)
register('Looking for a Fight', _cc_looking_for_a_fight)
register('Draw!', _cc_draw_emote)
register('Hit and Run', _cc_hit_and_run)
register('Expose Weakness', _cc_expose_weakness)
register('Veteran Instincts', _cc_veteran_instincts)
register('Toxic Dart', _cc_toxic_dart)
register('Take Position', _cc_take_position)
register('Camouflage', _cc_camouflage)
register('Celebration', _cc_celebration_cc)
register('Cut Lines', _cc_cut_lines)
register('Deadly Precision', _cc_deadly_precision)
register('Debts Repaid', _cc_debts_repaid)
register('Disengage', _cc_disengage_cc)
register('Force Rush', _cc_force_rush)
register('Force Illusion', _cc_force_illusion)
register('Furious Charge', _cc_furious_charge)
register('Explosive Weaponry', _cc_explosive_weaponry)
register('Glory of the Kill', _cc_glory_of_the_kill)
register('Hold Ground', _cc_hold_ground)
register('Hunter Protocol', _cc_hunter_protocol)
register('Heart of Freedom', _cc_heart_of_freedom)
register('Marked Territory', _cc_marked_territory)
register('Out of Time', _cc_out_of_time)
register("Officer's Training", _cc_officers_training)
register('Black Market Prices', _cc_black_market_prices)
register('Support Specialist', _cc_support_specialist)
register('Brace Yourself', _cc_brace_yourself)
register('Battlefield Awareness', _cc_battlefield_awareness)
register('Collect Intel', _cc_collect_intel)
register('Dangerous Bargains', _cc_dangerous_bargains)
register('Eerie Visage', _cc_eerie_visage)
register('Espionage Mastery', _cc_espionage_mastery)
register('Flurry of Blades', _cc_flurry_of_blades)
register('Maximum Firepower', _cc_maximum_firepower)
register('Marksman', _cc_marksman)
register('Opportunistic', _cc_opportunistic)
register('Master Operative', _cc_master_operative)
register('New Orders', _cc_new_orders)
register('Iron Will', _cc_iron_will)
register('Of No Importance', _cc_of_no_importance)
register('I Make My Own Luck', _cc_i_make_my_own_luck)
register('Hunt Them Down', _cc_hunt_them_down)
register('Cruel Strike', _cc_cruel_strike)
register('Face to Face', _cc_face_to_face)
register('Negation', _cc_negation)
register('Change of Plans', _cc_change_of_plans)
register('Price on Their Heads', _cc_price_on_their_heads)
register('Strategic Shift', _cc_strategic_shift)
register('Reduce to Rubble', _cc_reduce_to_rubble)
register('Size Advantage', _cc_size_advantage)
register('Field Tactician', _cc_field_tactician)
register('Feral Swipes', _cc_feral_swipes)
register('Guardian Stance', _cc_guardian_stance)
register('Guild Programming', _cc_guild_programming)
register('Hidden Trap', _cc_hidden_trap)
register("Let's Make a Deal", _cc_lets_make_a_deal)
register('Learn by Example', _cc_learn_by_example)
register('Transmit the Plans', _cc_transmit_the_plans)
register('Dark Energy', _cc_dark_energy)
register('Dioxis Fumes', _cc_dioxis_fumes)
register('Take it Down', _cc_take_it_down)
register('Sarlacc Sweep', _cc_sarlacc_sweep)
register('Call the Vanguard', _cc_call_the_vanguard)
register('Combat Resupply', _cc_combat_resupply)
register('Behind Enemy Lines', _cc_behind_enemy_lines)
register('Against the Odds', _cc_against_the_odds)
register('Ballistics Matrix', _cc_ballistics_matrix)
register('Blood Feud', _cc_blood_feud)
register('Balancing Force', _cc_balancing_force)
register('Payday', _cc_payday)
register('Provoke', _cc_provoke)
register('On a Mission', _cc_on_a_mission)
register('Last Stand', _cc_last_stand)
register('Retreat', _cc_retreat)
register('Stasis', _cc_stasis)
register('Targeted', _cc_targeted)
register('Tactical Officer', _cc_tactical_officer)
register('Frenzy', _cc_frenzy)
register('Grit', _cc_grit)
register('Shoot to Kill', _cc_shoot_to_kill)
register('Skirmish', _cc_skirmish)
register('Strategic Assault', _cc_strategic_assault)
register('Bulk Up', _cc_bulk_up)
register('Heroic Effort', _cc_heroic_effort)
register('Fear and Dead Men', _cc_fear_and_dead_men)
register('Field Medic', _cc_field_medic)
register('In the Crosshairs', _cc_in_the_crosshairs)
register('Throw', _cc_throw)
register('Choke', _cc_choke)
register('Battle Meditation', _cc_battle_meditation_cc)
register('Preservation Protocol', _cc_preservation_protocol)
register('Dirty Trick', _cc_dirty_trick)
register('Parting Blow', _cc_parting_blow)
register('Extra Protection', _cc_extra_protection)
register('Final Stand', _cc_final_stand)
register('Get Behind Me!', _cc_get_behind_me)
register('Crush', _cc_crush)
register('Self-Defense', _cc_self_defense)
register('Slippery Target', _cc_slippery_target)
register('Survival Instinct', _cc_survival_instinct)
register('No Cheating', _cc_no_cheating)
register('Still Faster Than You', _cc_still_faster_than_you)
register('Lord of the Sith', _cc_lord_of_the_sith)
register('Paid in Beskar', _cc_paid_in_beskar)
register('Rapid Recalibration', _cc_rapid_recalibration)
register('Change Their Minds', _cc_change_their_minds)
register('Overcharged Weapons', _cc_overcharged_weapons)
register('Protect the Old Ways', _cc_protect_the_old_ways)
register('There Is No Try', _cc_there_is_no_try)


def registered_cc_effects() -> list:
    """List all currently-registered CC effect names (for coverage tracking)."""
    return sorted(_CC_EFFECTS.keys())
