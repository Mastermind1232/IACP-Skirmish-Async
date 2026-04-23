"""Round Discord handler — mirror of src/handlers/round.js.

Handles the end-of-round and start-of-round window buttons:
  - end_end_of_round_{gameId}      → END_END_OF_ROUND (advance to next round)
  - end_start_of_round_{gameId}    → END_START_OF_ROUND (close SoR window)

Each wraps the stepper action with logging + returns the new round
state for the bot layer to re-render the round banner.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from python.discord_bot.handlers import register
from python.discord_bot.messages.updaters import format_log_line
from python.engine.actions import ActionType


def _cid(interaction):
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    return (
        getattr(interaction, 'customId', None)
        or getattr(interaction, 'custom_id', None)
        or ''
    )


def _uid(interaction):
    user = getattr(interaction, 'user', None)
    if user is not None:
        uid = getattr(user, 'id', None)
        if uid is not None:
            return str(uid)
    return ''


def _resolve_game(ctx, game_id):
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _handle_end_end_of_round(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """'end_end_of_round_{gameId}' → advance round, reset per-round state."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('end_end_of_round_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('end_end_of_round_'):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step(
            game, Action(type=ActionType.END_END_OF_ROUND, player=0),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()

    data = new_game.data if hasattr(new_game, 'data') else new_game
    round_num = data.get('round') or data.get('currentRound') or 1
    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line(f'→ Round {round_num} begins.',
                             phase='ROUND', icon='round'), {})
    return {
        'ok': True, 'game': new_game, 'round': round_num,
        'phase': data.get('phase'),
        'roundPhase': data.get('roundPhase'),
    }


def _handle_end_start_of_round(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """'end_start_of_round_{gameId}' → close SoR window, run mission SoR rules."""
    from python.engine.stepper import Action, step

    cid = _cid(interaction)
    if not cid.startswith('end_start_of_round_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('end_start_of_round_'):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    user_id = _uid(interaction)
    data = game.data if hasattr(game, 'data') else game
    sor_holder = data.get('startOfRoundWhoseTurn')
    if sor_holder and user_id and user_id != str(sor_holder):
        return {'ok': False, 'reason': 'not_sor_holder'}

    try:
        new_game = step(
            game, Action(type=ActionType.END_START_OF_ROUND, player=1),
        )
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()
    data2 = new_game.data if hasattr(new_game, 'data') else new_game
    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line('→ Activation phase begins.',
                             phase='ROUND', icon='round'), {})
    return {
        'ok': True, 'game': new_game,
        'startOfRoundWhoseTurn': data2.get('startOfRoundWhoseTurn'),
        'roundPhase': data2.get('roundPhase'),
    }


# ── Extra Armor (Honoring the Fallen CC / Crit Hit handler) ────────────────

def _handle_extra_armor_pick(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """extra_armor_pick_{gameId}_{playerNum}_{figureKey} — cycle the
    token count for a figure in the pending allocation (0→1→2→0),
    capped by per-figure max and total remaining budget.

    JS site: src/handlers/round.js:1625-1676.
    """
    from python.engine.mechanics.dc_helpers import get_max_power_tokens

    cid = _cid(interaction)
    if not cid.startswith('extra_armor_pick_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('extra_armor_pick_'):]
    parts = rest.split('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, player_num_str, figure_key = parts
    try:
        player_num = int(player_num_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    owner_id = data.get(f'player{player_num}Id')
    if user_id and str(user_id) != str(owner_id or ''):
        return {'ok': False, 'reason': 'not_owner'}

    key = f'pendingExtraArmor_p{player_num}'
    pending = data.get(key)
    if not pending:
        return {'ok': False, 'reason': 'no_pending_extra_armor'}
    total = int(pending.get('total') or 4)
    allocation = dict(pending.get('allocation') or {})
    existing = len((data.get('figurePowerTokens') or {}).get(figure_key) or [])
    max_for_figure = get_max_power_tokens(figure_key) - existing
    current = int(allocation.get(figure_key) or 0)
    placed = sum(int(v or 0) for v in allocation.values())

    # Cycle 0 → 1 → 2 → 0, bounded by per-figure max and total budget.
    next_val = (current + 1) % 3
    if next_val > max_for_figure:
        next_val = 0
    # Ensure we don't exceed total — new total = placed - current + next_val
    if placed - current + next_val > total:
        next_val = max(0, total - (placed - current))
    allocation[figure_key] = next_val
    pending['allocation'] = allocation
    data[key] = pending

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game,
        'figureKey': figure_key, 'tokenCount': next_val,
        'totalAllocated': sum(int(v or 0) for v in allocation.values()),
        'totalBudget': total,
    }


def _handle_extra_armor_confirm(interaction: Any,
                                 ctx: Dict[str, Any]) -> Dict[str, Any]:
    """extra_armor_confirm_{gameId}_{playerNum} — apply all pending
    allocations as power tokens and clear the pending state. Rejects
    until the full budget is allocated.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    cid = _cid(interaction)
    if not cid.startswith('extra_armor_confirm_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('extra_armor_confirm_'):]
    parts = rest.split('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, player_num_str = parts
    try:
        player_num = int(player_num_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    owner_id = data.get(f'player{player_num}Id')
    if user_id and str(user_id) != str(owner_id or ''):
        return {'ok': False, 'reason': 'not_owner'}

    key = f'pendingExtraArmor_p{player_num}'
    pending = data.get(key)
    if not pending:
        return {'ok': False, 'reason': 'no_pending_extra_armor'}
    total = int(pending.get('total') or 4)
    allocation = dict(pending.get('allocation') or {})
    placed = sum(int(v or 0) for v in allocation.values())
    if placed < total:
        return {
            'ok': False, 'reason': 'budget_not_exhausted',
            'remaining': total - placed,
        }

    applied = []
    for figure_key, count in allocation.items():
        count = int(count or 0)
        if count <= 0:
            continue
        grant_power_tokens(data, figure_key, 'Block', count)
        applied.append({'figureKey': figure_key, 'granted': count})

    # Clear pending
    data[key] = None

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': game, 'applied': applied, 'total': total}


def _handle_extra_armor_cancel(interaction: Any,
                                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """extra_armor_cancel_{gameId}_{playerNum} — no-op (UI-only in JS;
    defers the Discord interaction without changing state). We mirror
    by simply returning ok so the router doesn't complain.
    """
    return {'ok': True, 'noop': True}


def _handle_doubt_remove(interaction: Any,
                          ctx: Dict[str, Any]) -> Dict[str, Any]:
    """doubt_remove_{gameId}_{playerNum}_{figureKey}_{condition|token}_{idx}
    — [Doubt] prompt resolution: remove one condition or power token
    from the targeted figure. Mirrors src/handlers/round.js:2117-2154.
    """
    from python.engine.mechanics.conditions import filter_condition

    cid = _cid(interaction)
    if not cid.startswith('doubt_remove_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('doubt_remove_'):]
    parts = rest.split('_')
    # Last two segments are type + idx; everything between gameId/pn and those
    # is the figure_key (which itself may contain underscores).
    if len(parts) < 5:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    idx_str = parts.pop()
    type_str = parts.pop()
    game_id = parts[0]
    try:
        player_num = int(parts[1])
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    figure_key = '_'.join(parts[2:])
    if not figure_key:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    try:
        idx = int(idx_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    if type_str not in ('condition', 'token'):
        return {'ok': False, 'reason': 'invalid_type'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game

    if type_str == 'condition':
        conds = (data.get('figureConditions') or {}).get(figure_key) or []
        if idx < 0 or idx >= len(conds):
            return {'ok': False, 'reason': 'index_out_of_range'}
        removed = conds[idx]
        filter_condition(data, figure_key, removed)
        save = ctx.get('save_games')
        if callable(save):
            save()
        return {
            'ok': True, 'game': game, 'type': 'condition',
            'removed': removed, 'figureKey': figure_key,
        }

    # token
    tokens_map = data.get('figurePowerTokens') or {}
    tokens = list(tokens_map.get(figure_key) or [])
    if idx < 0 or idx >= len(tokens):
        return {'ok': False, 'reason': 'index_out_of_range'}
    removed = tokens.pop(idx)
    if tokens:
        tokens_map[figure_key] = tokens
    else:
        tokens_map.pop(figure_key, None)
    data['figurePowerTokens'] = tokens_map
    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'type': 'token',
        'removed': removed, 'figureKey': figure_key,
    }


def _handle_rbf_discard(interaction: Any,
                         ctx: Dict[str, Any]) -> Dict[str, Any]:
    """rbf_discard_{gameId}_{playerNum}_{cardIdx} — Rule by Fear (Emperor
    Palpatine): opponent picks a card from hand to discard. Mirrors
    src/handlers/round.js:1738-1770.
    """
    cid = _cid(interaction)
    if not cid.startswith('rbf_discard_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('rbf_discard_'):]
    parts = rest.split('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, player_num_str, card_idx_str = parts
    try:
        player_num = int(player_num_str)
        card_idx = int(card_idx_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    owner_id = data.get(f'player{player_num}Id')
    if user_id and str(user_id) != str(owner_id or ''):
        return {'ok': False, 'reason': 'not_owner'}

    hand_key = f'player{player_num}CcHand'
    disc_key = f'player{player_num}CcDiscard'
    hand = list(data.get(hand_key) or [])
    if card_idx < 0 or card_idx >= len(hand):
        return {'ok': False, 'reason': 'card_index_out_of_range'}
    card = hand.pop(card_idx)
    discard = list(data.get(disc_key) or [])
    discard.append(card)
    data[hand_key] = hand
    data[disc_key] = discard

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'card': card, 'playerNum': player_num,
    }


def _handle_prog_override(interaction: Any,
                           ctx: Dict[str, Any]) -> Dict[str, Any]:
    """prog_override_{gameId}_{playerNum}_{TRAIT} — Programming Override
    (4-LOM): 4-LOM gains the chosen TRAIT until end of round. Mirrors
    src/handlers/round.js:2033-2048.

    Trait segments are underscore-joined in the customId
    (e.g. `FORCE_USER`) and collapsed to a single TRAIT string with
    underscores → spaces to match the JS key format.
    """
    cid = _cid(interaction)
    if not cid.startswith('prog_override_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('prog_override_'):]
    parts = rest.split('_')
    if len(parts) < 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = parts[0]
    try:
        player_num = int(parts[1])
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    trait = ' '.join(parts[2:])

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    owner_id = data.get(f'player{player_num}Id')
    if user_id and str(user_id) != str(owner_id or ''):
        return {'ok': False, 'reason': 'not_owner'}

    trait_map = dict(data.get('roundProgrammingOverrideTrait') or {})
    trait_map[player_num] = trait
    data['roundProgrammingOverrideTrait'] = trait_map

    save = ctx.get('save_games')
    if callable(save):
        save()
    log = ctx.get('log_game_action')
    if callable(log):
        log(format_log_line(
            f'**Programming Override** — **4-LOM** gains **{trait}** until end of round.',
            phase='ROUND', icon='round',
        ), {})
    return {'ok': True, 'game': game, 'playerNum': player_num, 'trait': trait}


def _handle_imp_citadel(interaction: Any,
                         ctx: Dict[str, Any]) -> Dict[str, Any]:
    """imp_citadel_{gameId}_{playerNum}_{damage|block} — place one token
    on [Imperial Citadel] at start of round.

    JS site: src/handlers/round.js:1987-2040. Mutates
    game.imperialCitadelTokens = {damage: N, block: N}. Legacy 'focus'
    slot is migrated into 'block' to match the JS migration branch.
    """
    cid = _cid(interaction)
    if not cid.startswith('imp_citadel_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('imp_citadel_'):]
    parts = rest.rsplit('_', 1)
    if len(parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    head, token_type = parts
    head_parts = head.split('_', 1)
    if len(head_parts) != 2:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, player_num_str = head_parts
    try:
        player_num = int(player_num_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    if token_type not in ('damage', 'block'):
        return {'ok': False, 'reason': 'invalid_token_type'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    owner_id = data.get(f'player{player_num}Id')
    if user_id and str(user_id) != str(owner_id or ''):
        return {'ok': False, 'reason': 'not_owner'}

    tokens = dict(data.get('imperialCitadelTokens') or {})
    # Migrate legacy focus→block
    if 'focus' in tokens:
        tokens['block'] = int(tokens.get('block') or 0) + int(tokens.get('focus') or 0)
        del tokens['focus']
    tokens.setdefault('damage', 0)
    tokens.setdefault('block', 0)
    tokens[token_type] = int(tokens.get(token_type) or 0) + 1
    data['imperialCitadelTokens'] = tokens

    save = ctx.get('save_games')
    if callable(save):
        save()
    log = ctx.get('log_game_action')
    label = 'Damage' if token_type == 'damage' else 'Block'
    if callable(log):
        log(format_log_line(
            f'**Imperial Citadel** — placed **1 {label}** token '
            f'(now: {tokens["damage"]} Damage, {tokens["block"]} Block).',
            phase='ROUND', icon='round',
        ), {})
    return {
        'ok': True, 'game': game, 'tokenType': token_type,
        'tokens': dict(tokens),
    }


def _handle_rogue_one_return(interaction: Any,
                              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """rogue_one_return_{gameId}_{playerNum}_{cardIdx} — player picks a
    card from hand to place on top of their deck (Rogue One SoR effect).

    JS site: src/handlers/round.js:1773-1826. Pending state key:
      game.pendingRogueOne_p{playerNum} = {'remaining': N}
    Each press pops the card from hand, unshifts to deck, decrements
    remaining. When remaining hits 0 the pending state is cleared.
    """
    cid = _cid(interaction)
    if not cid.startswith('rogue_one_return_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    rest = cid[len('rogue_one_return_'):]
    parts = rest.split('_', 2)
    if len(parts) != 3:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, player_num_str, card_idx_str = parts
    try:
        player_num = int(player_num_str)
        card_idx = int(card_idx_str)
    except ValueError:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    pending_key = f'pendingRogueOne_p{player_num}'
    pending = data.get(pending_key)
    if not pending or int(pending.get('remaining') or 0) <= 0:
        return {'ok': False, 'reason': 'no_pending_rogue_one'}

    user_id = _uid(interaction)
    owner_id = data.get(f'player{player_num}Id')
    if user_id and str(user_id) != str(owner_id or ''):
        return {'ok': False, 'reason': 'not_owner'}

    hand_key = f'player{player_num}CcHand'
    deck_key = f'player{player_num}CcDeck'
    hand = list(data.get(hand_key) or [])
    if card_idx < 0 or card_idx >= len(hand):
        return {'ok': False, 'reason': 'card_index_out_of_range'}

    card = hand.pop(card_idx)
    deck = list(data.get(deck_key) or [])
    deck.insert(0, card)
    data[hand_key] = hand
    data[deck_key] = deck
    pending = dict(pending)
    pending['remaining'] = int(pending.get('remaining') or 0) - 1
    if pending['remaining'] <= 0:
        data[pending_key] = None
    else:
        data[pending_key] = pending

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'card': card, 'playerNum': player_num,
        'remaining': pending['remaining'],
    }


def _handle_sor_mission_reveal(interaction: Any,
                                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """sor_mission_reveal_{gameId} — either player reveals the mission's
    set-aside start-of-round tokens. Clears pendingMissionSorReveal and
    runs the mission's startOfRound rules if present.

    JS site: src/handlers/round.js:1035-1061.
    """
    from python.engine.mechanics.mission_rules import run_start_of_round_rules

    cid = _cid(interaction)
    if not cid.startswith('sor_mission_reveal_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('sor_mission_reveal_'):]
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    if user_id and str(user_id) not in (str(data.get('player1Id') or ''),
                                          str(data.get('player2Id') or '')):
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    if not data.get('pendingMissionSorReveal'):
        return {'ok': False, 'reason': 'already_revealed'}

    data['pendingMissionSorReveal'] = False

    selected_mission = data.get('selectedMission') or {}
    selected_map = data.get('selectedMap') or {}
    map_id = data.get('mapId') or (
        selected_map.get('id') if isinstance(selected_map, dict) else None
    )
    variant = selected_mission.get('variant') if isinstance(selected_mission, dict) else None
    mission_rules = selected_mission.get('rules') if isinstance(selected_mission, dict) else None
    sor_rules = None
    if isinstance(mission_rules, dict):
        sor_rules = mission_rules.get('startOfRound')
    if isinstance(sor_rules, dict):
        run_start_of_round_rules(data, map_id, variant or 'a', dict(sor_rules))

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'mapId': map_id, 'variant': variant,
        'ranSorRules': isinstance(sor_rules, dict),
    }


register('end_end_of_round_', _handle_end_end_of_round, 'round')
register('end_start_of_round_', _handle_end_start_of_round, 'round')
register('extra_armor_pick_', _handle_extra_armor_pick, 'round')
register('extra_armor_confirm_', _handle_extra_armor_confirm, 'round')
register('extra_armor_cancel_', _handle_extra_armor_cancel, 'round')
register('sor_mission_reveal_', _handle_sor_mission_reveal, 'round')
register('rogue_one_return_', _handle_rogue_one_return, 'round')
register('imp_citadel_', _handle_imp_citadel, 'round')
register('rbf_discard_', _handle_rbf_discard, 'round')
register('prog_override_', _handle_prog_override, 'round')
register('doubt_remove_', _handle_doubt_remove, 'round')
