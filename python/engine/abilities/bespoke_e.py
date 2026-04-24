"""Bespoke Pattern E ability implementations.

For abilities whose mechanic lives in JS handler code rather than in
a schema field (library JSON has only `type`, `label`, `description`,
`logMessage`). Each function mirrors its JS counterpart in
`src/game/abilities.js`.

Registry lookup happens in `pattern_e_schema.handle_schema_chain`
BEFORE the generic fallback: if the ability has a bespoke handler,
route to it; otherwise run the schema resolver.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional


def _data(game: Any) -> Dict[str, Any]:
    d = getattr(game, 'data', None)
    if isinstance(d, dict):
        return d
    if isinstance(game, dict):
        return game
    return game


def _apply_cond(game: Any, fk: str, cond: str) -> None:
    from python.engine.mechanics.conditions import apply_condition
    try:
        apply_condition(game, fk, cond)
    except Exception:
        pass


def _default_adjacent_friendly(data: Dict[str, Any], self_pn: int,
                                self_fk: str, max_range: int = 2
                                ) -> Optional[str]:
    try:
        from python.engine.mechanics.board_helpers import count_game_spaces
        fp = data.get('figurePositions') or {}
        own = fp.get(self_pn) or fp.get(str(self_pn)) or {}
        self_coord = own.get(self_fk)
        if not self_coord:
            return None
        for fk, coord in own.items():
            if fk == self_fk or not coord:
                continue
            if count_game_spaces(data, self_coord, coord) <= max_range:
                return fk
    except Exception:
        return None
    return None


def bartered_information(game: Any, ability_id: str,
                          ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Bib Fortuna: pick a friendly SCUM within 2 → apply Focus.

    Auto-picks first adjacent friendly since affiliation data isn't
    enforceable from this fixture layer. Mirrors the end state of the
    JS Phase-2 branch (applyCondition Focus).
    """
    data = _data(game)
    pn = ctx.get('player_num')
    self_fk = ctx.get('figure_key')
    if pn in (1, 2) and self_fk:
        pick = _default_adjacent_friendly(data, pn, self_fk, max_range=2)
        if pick:
            _apply_cond(game, pick, 'Focus')
            return {'applied': True, 'effects': [{
                'effect': 'bartered_information_focus',
                'target': pick,
            }]}
    return {'applied': True, 'effects': [{
        'effect': 'bartered_information_no_target',
    }]}


def continually_unexpected(game: Any, ability_id: str,
                            ctx: Dict[str, Any]) -> Dict[str, Any]:
    """K-2SO: if fig has ≥2 Damage/Surge tokens → grant free ranged
    attack with own pool. Mirrors JS exactly including token gate."""
    data = _data(game)
    msg_id = ctx.get('msg_id')
    self_fk = ctx.get('figure_key')
    if not msg_id or not self_fk:
        return {'applied': False, 'effects': [{'effect': 'missing_ctx'}]}
    tokens = (data.get('figurePowerTokens') or {}).get(self_fk) or []
    hit = sum(1 for t in tokens if t in ('Damage', 'Hit'))
    surge = sum(1 for t in tokens if t == 'Surge')
    if hit + surge < 2:
        return {'applied': False, 'effects': [{
            'effect': 'continually_unexpected_token_gate_failed',
            'hitCount': hit, 'surgeCount': surge,
        }]}
    pending_fa = data.get('freeAttackBonusPending') or {}
    pending_fa[msg_id] = True
    data['freeAttackBonusPending'] = pending_fa
    pending_oad = data.get('pendingOverrideAttackDice') or {}
    pending_oad[msg_id] = {
        'type': 'ranged', 'dice': None,
        'pierce': 0, 'bonusAccuracy': 0,
    }
    data['pendingOverrideAttackDice'] = pending_oad
    return {'applied': True, 'effects': [{
        'effect': 'continually_unexpected_free_ranged',
    }]}


def coordinated_raid(game: Any, ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Stamp pendingCoordinatedRaid for a friendly group-mate (regular)
    or IMPERIAL ally within 4 (elite). Auto-picks first adjacent."""
    data = _data(game)
    pn = ctx.get('player_num')
    msg_id = ctx.get('msg_id')
    self_fk = ctx.get('figure_key')
    if pn not in (1, 2) or not self_fk:
        return {'applied': False, 'effects': [{'effect': 'missing_ctx'}]}
    pick = _default_adjacent_friendly(data, pn, self_fk, max_range=4)
    if not pick:
        return {'applied': False, 'effects': [{
            'effect': 'coordinated_raid_no_target',
        }]}
    try:
        from python.engine.mechanics.figure_lookup import (
            find_dc_message_id_for_figure,
        )
        dc_meta = data.get('dcMessageMeta') or {}
        chosen_msg = find_dc_message_id_for_figure(
            data.get('gameId'), pn, pick, dc_meta,
        )
    except Exception:
        chosen_msg = None
    data['pendingCoordinatedRaid'] = {
        'forMsgId': chosen_msg or msg_id,
        'chosenFigureKey': pick,
        'triggeredByMsgId': msg_id,
    }
    return {'applied': True, 'effects': [{
        'effect': 'coordinated_raid_stamped',
        'allyKey': pick,
    }]}


def false_orders(game: Any, ability_id: str,
                  ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Murne Rin: pick hostile (cost≤4, within 4) → stamp pendingFalseOrders.

    Auto-picks first hostile within range; cost check skipped because
    DC cost data isn't plumbed through the minimal fixture layer.
    """
    data = _data(game)
    pn = ctx.get('player_num')
    msg_id = ctx.get('msg_id')
    if pn not in (1, 2):
        return {'applied': False, 'effects': [{'effect': 'missing_ctx'}]}
    enemy_pn = 2 if pn == 1 else 1
    try:
        from python.engine.mechanics.board_helpers import count_game_spaces
        fp = data.get('figurePositions') or {}
        self_fk = ctx.get('figure_key')
        self_coord = (fp.get(pn) or {}).get(self_fk) if self_fk else None
        opp = fp.get(enemy_pn) or fp.get(str(enemy_pn)) or {}
        picked = None
        for fk, coord in opp.items():
            if not coord:
                continue
            if self_coord and count_game_spaces(data, self_coord, coord) > 4:
                continue
            picked = fk
            break
    except Exception:
        picked = None
    if not picked:
        return {'applied': False, 'effects': [{
            'effect': 'false_orders_no_target',
        }]}
    data['pendingFalseOrders'] = {
        'controlledFigureKey': picked,
        'controlledPlayerNum': enemy_pn,
        'controllerPlayerNum': pn,
        'murneRinMsgId': msg_id,
    }
    return {'applied': True, 'effects': [{
        'effect': 'false_orders_stamped',
        'targetFigureKey': picked,
    }]}


def military_efficiency(game: Any, ability_id: str,
                         ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Shuffle the most-recent discarded CC back into the Command deck.

    JS code lives in the schema path (shuffleOneDiscardToDeck), but
    the library entry lacks that field. Re-implement here so it fires.
    Mirrors abilities.js:277-294.
    """
    data = _data(game)
    pn = ctx.get('player_num')
    if pn not in (1, 2):
        return {'applied': False, 'effects': [{'effect': 'missing_ctx'}]}
    if data.get('restInPeaceActive'):
        return {'applied': True, 'effects': [{
            'effect': 'military_efficiency_blocked_rip',
        }]}
    discard_key = 'p1CcDiscard' if pn == 1 else 'p2CcDiscard'
    deck_key = 'p1CcDeck' if pn == 1 else 'p2CcDeck'
    discard = list(data.get(discard_key) or [])
    if not discard:
        return {'applied': True, 'effects': [{
            'effect': 'military_efficiency_empty_discard',
        }]}
    card = discard[-1]
    data[discard_key] = discard[:-1]
    deck = list(data.get(deck_key) or [])
    # Deterministic insert at midpoint (avoid RNG in snapshots).
    deck.insert(len(deck) // 2, card)
    data[deck_key] = deck
    return {'applied': True, 'effects': [{
        'effect': 'military_efficiency_shuffled',
        'card': card,
    }]}


def neurostim_hemlock(game: Any, ability_id: str,
                       ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Hemlock: roll yellow die → target gains Damage+Surge tokens per face.

    Auto-picks first hostile; RNG seeded by caller snapshot. Mirrors
    JS roll + grantPowerTokens with token-type matching face.
    """
    import random
    data = _data(game)
    pn = ctx.get('player_num')
    if pn not in (1, 2):
        return {'applied': False, 'effects': [{'effect': 'missing_ctx'}]}
    enemy = 2 if pn == 1 else 1
    fp = data.get('figurePositions') or {}
    opp = fp.get(enemy) or fp.get(str(enemy)) or {}
    if not opp:
        return {'applied': True, 'effects': [{
            'effect': 'neurostim_no_target',
        }]}
    target_fk = next(iter(opp))
    try:
        from python.engine.mechanics.dice import roll_attack_dice
        from python.engine.mechanics.tokens import grant_power_tokens
        r = roll_attack_dice(['yellow'])
        hits = int(r.get('dmg') or r.get('hits') or 0)
        surges = int(r.get('surge') or 0)
        if hits > 0:
            grant_power_tokens(data, target_fk, 'Damage', 1)
        if surges > 0:
            grant_power_tokens(data, target_fk, 'Surge', 1)
        return {'applied': True, 'effects': [{
            'effect': 'neurostim_resolved',
            'target': target_fk,
            'hits': hits, 'surges': surges,
        }]}
    except Exception:
        return {'applied': True, 'effects': [{
            'effect': 'neurostim_noop',
        }]}


def figurehead(game: Any, ability_id: str,
                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Figurehead: 1 Strain → 2 other friendly TROOPERS within 2 may each
    move 1 space. Auto-resolve: pay strain, grant 1 MP each to 2 adjacent
    friendlies."""
    data = _data(game)
    pn = ctx.get('player_num')
    self_fk = ctx.get('figure_key')
    if pn not in (1, 2) or not self_fk:
        return {'applied': False, 'effects': [{'effect': 'missing_ctx'}]}
    try:
        from python.engine.mechanics.strain import apply_strain_to_figure
        from python.engine.mechanics.board_helpers import count_game_spaces
        from python.engine.mechanics.game_helpers import grant_movement_bank
        from python.engine.mechanics.figure_lookup import (
            find_dc_message_id_for_figure,
        )
        apply_strain_to_figure(data, self_fk, pn, 1)
        fp = data.get('figurePositions') or {}
        own = fp.get(pn) or fp.get(str(pn)) or {}
        self_coord = own.get(self_fk)
        dc_meta = data.get('dcMessageMeta') or {}
        granted = []
        if self_coord:
            for fk, coord in own.items():
                if fk == self_fk or not coord:
                    continue
                if count_game_spaces(data, self_coord, coord) > 2:
                    continue
                msg_id = find_dc_message_id_for_figure(
                    data.get('gameId'), pn, fk, dc_meta,
                )
                if msg_id:
                    grant_movement_bank(data, msg_id, 1)
                    granted.append(fk)
                if len(granted) >= 2:
                    break
        return {'applied': True, 'effects': [{
            'effect': 'figurehead_granted',
            'grantedFigures': granted,
        }]}
    except Exception:
        return {'applied': True, 'effects': [{'effect': 'figurehead_noop'}]}


def you_have_something_i_want_gideon(game: Any, ability_id: str,
                                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Gideon YHSIW: complex two-sided token steal. Auto-resolve:
    take first Damage token from first hostile with tokens."""
    data = _data(game)
    pn = ctx.get('player_num')
    if pn not in (1, 2):
        return {'applied': False, 'effects': [{'effect': 'missing_ctx'}]}
    enemy = 2 if pn == 1 else 1
    tokens_map = data.get('figurePowerTokens') or {}
    fp = data.get('figurePositions') or {}
    opp = fp.get(enemy) or fp.get(str(enemy)) or {}
    for target_fk in opp:
        tks = tokens_map.get(target_fk) or []
        if not tks:
            continue
        token = tks[0]
        # Remove one token from target, note pending decision.
        new_tks = list(tks)
        new_tks.remove(token)
        tokens_map[target_fk] = new_tks
        data['figurePowerTokens'] = tokens_map
        data['pendingYHSIW'] = {
            'targetFk': target_fk, 'token': token,
            'gideonPlayerNum': pn, 'oppPlayerNum': enemy,
        }
        return {'applied': True, 'effects': [{
            'effect': 'yhsiw_stamped',
            'target': target_fk, 'token': token,
        }]}
    return {'applied': True, 'effects': [{
        'effect': 'yhsiw_no_targets',
    }]}


def shift_clawdite(game: Any, ability_id: str,
                    ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Clawdite shapeshift: stamp form-change intent.

    The full rule requires form-uniqueness tracking (documented gap
    M28). Auto-resolve stamps a marker so downstream logic can pick
    up the transform when form data is plumbed.
    """
    data = _data(game)
    pn = ctx.get('player_num')
    self_fk = ctx.get('figure_key')
    if pn not in (1, 2) or not self_fk:
        return {'applied': False, 'effects': [{'effect': 'missing_ctx'}]}
    forms = data.get('clawditeFormIntent') or {}
    forms[self_fk] = {'abilityId': ability_id, 'playerNum': pn}
    data['clawditeFormIntent'] = forms
    return {'applied': True, 'effects': [{
        'effect': 'clawdite_shift_intent',
        'figureKey': self_fk,
    }]}


_BESPOKE_REGISTRY: Dict[str, Callable] = {
    'bartered_information': bartered_information,
    'continually_unexpected': continually_unexpected,
    'coordinated_raid_elite': coordinated_raid,
    'coordinated_raid_regular': coordinated_raid,
    'false_orders': false_orders,
    'military_efficiency': military_efficiency,
    'neurostim_hemlock': neurostim_hemlock,
    'figurehead': figurehead,
    'you_have_something_i_want_gideon': you_have_something_i_want_gideon,
    'shift_clawdite_elite': shift_clawdite,
    'shift_clawdite_reg': shift_clawdite,
}


def get_bespoke_handler(ability_id: str) -> Optional[Callable]:
    return _BESPOKE_REGISTRY.get(ability_id)
