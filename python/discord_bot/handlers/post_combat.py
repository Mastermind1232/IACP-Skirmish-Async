"""Post-combat Discord handlers — port of src/handlers/post-combat.js.

Real-resolution paths for post-combat reaction CCs, Mastery, and Interrogate.
State changes mirror the JS handlers; Discord-UI side effects (thread.send,
interaction.message.edit) live in the Discord bot wiring layer.

Prefixes covered:
  reaction_skip_{gameId}
  reaction_use_{gameId}
  right_back_block_{gameId} / right_back_nodmg_{gameId}
  mastery_skip_{gameId}       / mastery_pick_{gameId}_{idx}
  interrogate_skip_{gameId}   / interrogate_pick_{gameId}_{idx}
                              / interrogate_discard_{gameId}_{idx}
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from python.discord_bot.handlers import register
from python.discord_bot.handlers.combat_reactions import (
    _cid,
    _make_reaction_skip,
    _resolve_game,
)
from python.engine.data.cc_effects_loader import get_cc_effect
from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.mechanics.damage_helpers import reduce_hp
from python.engine.mechanics.dc_helpers import dc_name_from_figure_key
from python.engine.mechanics.figure_lookup import (
    find_dc_message_id_for_figure,
    parse_figure_key,
)
from python.engine.mechanics.game_helpers import grant_movement_bank
from python.engine.mechanics.player_helpers import cc_discard_key, cc_hand_key


# ---------------------------------------------------------------------------
# Skip handlers (kept for backward-compatibility wiring).
# ---------------------------------------------------------------------------
_handle_reaction_skip = _make_reaction_skip(
    'reaction_skip_', 'pendingReaction',
)
_handle_mastery_skip = _make_reaction_skip(
    'mastery_skip_', 'pendingMastery',
)
_handle_interrogate_skip = _make_reaction_skip(
    'interrogate_skip_', 'pendingInterrogate',
)


def _save(ctx: Dict[str, Any]) -> None:
    save = ctx.get('save_games')
    if callable(save):
        save()


def _fig_msg_id(data: Dict[str, Any], game_id: Optional[str],
                player_num: int, figure_key: str) -> Optional[str]:
    meta = data.get('dcMessageMeta')
    if meta is None:
        return None
    return find_dc_message_id_for_figure(game_id, player_num, figure_key, meta)


def _restore_card_to_hand(data: Dict[str, Any], player_num: int,
                          card_name: str) -> None:
    key = cc_hand_key(player_num)
    hand = data.get(key) or []
    hand.append(card_name)
    data[key] = hand


def _discard_card(data: Dict[str, Any], player_num: int, card_name: str) -> None:
    key = cc_discard_key(player_num)
    pile = data.get(key) or []
    pile.append(card_name)
    data[key] = pile


def _apply_direct_damage(data: Dict[str, Any], player_num: int,
                         figure_key: str, msg_id: Optional[str],
                         damage: int) -> None:
    """Mirror applyDirectDamageToFigure — reduces HP for the figure index."""
    if not msg_id or damage <= 0:
        return
    parsed = parse_figure_key(figure_key)
    fig_idx = parsed[2] if parsed else 0
    dc_health = data.get('dcHealthState') or {}
    reduce_hp(dc_health, data, msg_id, fig_idx, damage, player_num)


def _is_adjacent(data: Dict[str, Any], coord_a: Optional[str],
                 coord_b: Optional[str]) -> bool:
    if not coord_a or not coord_b:
        return False
    selected = data.get('selectedMap') or {}
    ms = get_map_spaces(selected.get('id')) if isinstance(selected, dict) else None
    if not ms:
        return False
    adj = (ms.get('adjacency') or {}).get(str(coord_a).lower()) or []
    target = str(coord_b).lower()
    return any(str(s).lower() == target for s in adj)


# ---------------------------------------------------------------------------
# reaction_use_: Payback / Dangerous Prey / Right Back At Ya!
# ---------------------------------------------------------------------------
def _handle_reaction_use(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    cid = _cid(interaction)
    prefix = 'reaction_use_'
    if not cid.startswith(prefix):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len(prefix):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game

    pending = data.get('pendingReaction')
    if not isinstance(pending, dict):
        return {'ok': False, 'reason': 'no_pending_reaction'}

    card_name = pending.get('cardName')
    target_fig_key = pending.get('targetFigKey')
    attacker_fig_key = pending.get('attackerFigKey')
    attacker_msg_id = pending.get('attackerMsgId')
    defender_pn = pending.get('defenderPlayerNum')
    combat = pending.get('combat') or {}
    attacker_pn = combat.get('attackerPlayerNum')

    # Clear pending; move card from tentatively-held to discard.
    data.pop('pendingReaction', None)
    if isinstance(defender_pn, int) and isinstance(card_name, str):
        _discard_card(data, defender_pn, card_name)

    effects_applied: List[Dict[str, Any]] = []

    if card_name == 'Payback':
        dengar_msg_id = _fig_msg_id(data, game_id, defender_pn, target_fig_key)
        if dengar_msg_id:
            bonus = data.get('paybackBonusSurge') or {}
            bonus[dengar_msg_id] = int(bonus.get(dengar_msg_id, 0)) + 2
            data['paybackBonusSurge'] = bonus
            effects_applied.append({
                'effect': 'Payback',
                'dengarMsgId': dengar_msg_id,
                'bonusSurge': 2,
            })

    elif card_name == 'Dangerous Prey':
        fp = data.get('figurePositions') or {}
        atk_pos = (fp.get(attacker_pn) or {}).get(attacker_fig_key)
        bossk_pos = (fp.get(defender_pn) or {}).get(target_fig_key)
        is_adj = _is_adjacent(data, atk_pos, bossk_pos)
        dmg = 3 if is_adj else 1
        atk_msg_id = attacker_msg_id or _fig_msg_id(
            data, game_id, attacker_pn, attacker_fig_key
        )
        _apply_direct_damage(data, attacker_pn, attacker_fig_key, atk_msg_id, dmg)
        bossk_msg_id = _fig_msg_id(data, game_id, defender_pn, target_fig_key)
        if bossk_msg_id:
            grant_movement_bank(data, bossk_msg_id, 2)
        effects_applied.append({
            'effect': 'Dangerous Prey',
            'attackerDamage': dmg,
            'adjacent': is_adj,
            'bosskMp': 2,
        })

    elif card_name == 'Right Back At Ya!':
        tokens = (data.get('figurePowerTokens') or {}).get(target_fig_key) or []
        if 'Block' in tokens:
            # Stage a pending for the block-vs-nodmg follow-up choice.
            data['pendingRightBackAtYa'] = {
                'gameId': data.get('gameId') or game_id,
                'combatThreadId': pending.get('combatThreadId'),
                'attackerPlayerNum': attacker_pn,
                'defenderPlayerNum': defender_pn,
                'ownerId': pending.get('ownerId'),
                'attackerFigKey': attacker_fig_key,
                'attackerMsgId': attacker_msg_id or _fig_msg_id(
                    data, game_id, attacker_pn, attacker_fig_key
                ),
                'defenderFigKey': target_fig_key,
                'resultText': pending.get('resultText'),
                'combat': combat,
                'initialEmbedRefreshMsgIds': pending.get(
                    'initialEmbedRefreshMsgIds'
                ),
            }
            _save(ctx)
            return {
                'ok': True,
                'game': game,
                'gameId': game_id,
                'card': card_name,
                'awaiting': 'right_back_choice',
            }
        atk_msg_id2 = attacker_msg_id or _fig_msg_id(
            data, game_id, attacker_pn, attacker_fig_key
        )
        _apply_direct_damage(data, attacker_pn, attacker_fig_key, atk_msg_id2, 1)
        effects_applied.append({
            'effect': 'Right Back At Ya!',
            'attackerDamage': 1,
            'blockSpent': False,
        })

    _save(ctx)
    return {
        'ok': True,
        'game': game,
        'gameId': game_id,
        'card': card_name,
        'effects': effects_applied,
    }


# ---------------------------------------------------------------------------
# right_back_block_ / right_back_nodmg_ — follow-up for Right Back At Ya!
# ---------------------------------------------------------------------------
def _handle_right_back(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    cid = _cid(interaction)
    if cid.startswith('right_back_block_'):
        prefix = 'right_back_block_'
        is_block = True
    elif cid.startswith('right_back_nodmg_'):
        prefix = 'right_back_nodmg_'
        is_block = False
    else:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game_id = cid[len(prefix):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game

    pending = data.get('pendingRightBackAtYa')
    if not isinstance(pending, dict):
        return {'ok': False, 'reason': 'no_pending_right_back'}

    attacker_pn = pending.get('attackerPlayerNum')
    defender_pn = pending.get('defenderPlayerNum')
    attacker_fig_key = pending.get('attackerFigKey')
    attacker_msg_id = pending.get('attackerMsgId')
    defender_fig_key = pending.get('defenderFigKey')
    data.pop('pendingRightBackAtYa', None)

    dmg = 1
    if is_block:
        tokens_map = data.get('figurePowerTokens') or {}
        tokens = list(tokens_map.get(defender_fig_key) or [])
        if 'Block' in tokens:
            tokens.remove('Block')
            tokens_map[defender_fig_key] = tokens
            data['figurePowerTokens'] = tokens_map
            dmg = 3

    atk_msg_id = attacker_msg_id or _fig_msg_id(
        data, game_id, attacker_pn, attacker_fig_key
    )
    _apply_direct_damage(data, attacker_pn, attacker_fig_key, atk_msg_id, dmg)
    _save(ctx)
    return {
        'ok': True,
        'game': game,
        'gameId': game_id,
        'blockSpent': is_block,
        'attackerDamage': dmg,
    }


# ---------------------------------------------------------------------------
# mastery_pick_{gameId}_{cardIdx}
# ---------------------------------------------------------------------------
def _handle_mastery_pick(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    cid = _cid(interaction)
    prefix = 'mastery_pick_'
    if not cid.startswith(prefix):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len(prefix):]
    # customId: mastery_pick_{gameId}_{idx} — idx is trailing integer.
    underscore = tail.rfind('_')
    if underscore < 0:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = tail[:underscore]
    try:
        card_idx = int(tail[underscore + 1:])
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game

    pending = data.get('pendingMastery')
    if not isinstance(pending, dict):
        return {'ok': False, 'reason': 'no_pending_mastery'}

    attacker_pn = pending.get('attackerPlayerNum')
    discard_key = pending.get('discardKey')
    eligible = pending.get('eligible') or []
    data.pop('pendingMastery', None)

    # Rest in Peace blocks discard retrieval.
    if data.get('restInPeaceActive'):
        _save(ctx)
        return {
            'ok': True, 'game': game, 'gameId': game_id,
            'blockedBy': 'Rest in Peace',
        }

    if card_idx < 0 or card_idx >= len(eligible):
        _save(ctx)
        return {'ok': False, 'reason': 'card_idx_out_of_range'}
    card = eligible[card_idx]
    discard = list(data.get(discard_key) or [])
    if card in discard:
        discard.remove(card)
        data[discard_key] = discard
        hand_key = cc_hand_key(attacker_pn)
        hand = data.get(hand_key) or []
        hand.append(card)
        data[hand_key] = hand

    _save(ctx)
    return {
        'ok': True, 'game': game, 'gameId': game_id,
        'cardRetrieved': card,
    }


# ---------------------------------------------------------------------------
# interrogate_pick_{gameId}_{idx} (step 1) and interrogate_discard_{gameId}_{idx} (step 2)
# ---------------------------------------------------------------------------
def _handle_interrogate_pick(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    cid = _cid(interaction)
    prefix = 'interrogate_pick_'
    if not cid.startswith(prefix):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len(prefix):]
    underscore = tail.rfind('_')
    if underscore < 0:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = tail[:underscore]
    try:
        pick_idx = int(tail[underscore + 1:])
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game

    pending = data.get('pendingInterrogate')
    if not isinstance(pending, dict):
        return {'ok': False, 'reason': 'no_pending_interrogate'}

    attacker_pn = pending.get('attackerPlayerNum')
    snapshot = pending.get('opponentHandSnapshot') or []
    if pick_idx < 0 or pick_idx >= len(snapshot):
        _save(ctx)
        return {'ok': False, 'reason': 'pick_idx_out_of_range'}
    chosen = snapshot[pick_idx]
    pending['chosenCardName'] = chosen
    chosen_cost_eff = get_cc_effect(chosen) or {}
    chosen_cost = int(chosen_cost_eff.get('cost') or 0)
    hand_key = cc_hand_key(attacker_pn)
    own_hand = data.get(hand_key) or []
    eligible: List[str] = []
    for c in own_hand:
        eff = get_cc_effect(c) or {}
        if int(eff.get('cost') or 0) >= chosen_cost:
            eligible.append(c)
    pending['ownEligibleSnapshot'] = eligible
    data['pendingInterrogate'] = pending
    _save(ctx)
    return {
        'ok': True, 'game': game, 'gameId': game_id,
        'chosen': chosen,
        'chosenCost': chosen_cost,
        'ownEligible': list(eligible),
        'awaiting': 'interrogate_discard_choice' if eligible else 'none',
    }


def _handle_interrogate_discard(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    cid = _cid(interaction)
    prefix = 'interrogate_discard_'
    if not cid.startswith(prefix):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    tail = cid[len(prefix):]
    underscore = tail.rfind('_')
    if underscore < 0:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = tail[:underscore]
    try:
        dis_idx = int(tail[underscore + 1:])
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game

    pending = data.get('pendingInterrogate')
    if not isinstance(pending, dict):
        return {'ok': False, 'reason': 'no_pending_interrogate'}

    attacker_pn = pending.get('attackerPlayerNum')
    opponent_pn = pending.get('opponentPlayerNum')
    chosen = pending.get('chosenCardName')
    own_eligible = pending.get('ownEligibleSnapshot') or []
    data.pop('pendingInterrogate', None)

    if not chosen:
        _save(ctx)
        return {'ok': False, 'reason': 'missing_chosen_card'}
    if dis_idx < 0 or dis_idx >= len(own_eligible):
        _save(ctx)
        return {'ok': False, 'reason': 'dis_idx_out_of_range'}
    own_card = own_eligible[dis_idx]

    # Discard attacker's chosen card.
    own_hand_key = cc_hand_key(attacker_pn)
    own_hand = list(data.get(own_hand_key) or [])
    if own_card in own_hand:
        own_hand.remove(own_card)
    data[own_hand_key] = own_hand
    own_discard_key = cc_discard_key(attacker_pn)
    own_discard = list(data.get(own_discard_key) or [])
    own_discard.append(own_card)
    data[own_discard_key] = own_discard

    # Force-discard opponent's chosen card.
    opp_hand_key = cc_hand_key(opponent_pn)
    opp_hand = list(data.get(opp_hand_key) or [])
    if chosen in opp_hand:
        opp_hand.remove(chosen)
    data[opp_hand_key] = opp_hand
    opp_discard_key = cc_discard_key(opponent_pn)
    opp_discard = list(data.get(opp_discard_key) or [])
    opp_discard.append(chosen)
    data[opp_discard_key] = opp_discard

    _save(ctx)
    return {
        'ok': True, 'game': game, 'gameId': game_id,
        'attackerDiscarded': own_card,
        'opponentDiscarded': chosen,
    }


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------
register('reaction_skip_', _handle_reaction_skip, 'core')
register('reaction_use_', _handle_reaction_use, 'core')
register('right_back_block_', _handle_right_back, 'core')
register('right_back_nodmg_', _handle_right_back, 'core')
register('mastery_skip_', _handle_mastery_skip, 'core')
register('mastery_pick_', _handle_mastery_pick, 'core')
register('interrogate_skip_', _handle_interrogate_skip, 'core')
register('interrogate_pick_', _handle_interrogate_pick, 'core')
register('interrogate_discard_', _handle_interrogate_discard, 'core')
