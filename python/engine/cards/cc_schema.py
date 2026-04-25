"""Schema-driven CC effect resolver.

Reads a Command Card's ability-library entry and applies the common
schema fields directly to game state. Replaces the "no-op" placeholder
lambdas (`lambda g, p, c: {'applied': True}`) that previously just
marked the card as played without doing anything.

Supported schema fields:

  draw (int)                  → draw N cards from own CC deck
  applyFocus (bool)           → add Focus to ctx.figure_key
  applyHide (bool)            → add Hide to ctx.figure_key
  applyHideWhenDefending      → add Hide for this combat only
  mpBonus (int)               → grant MP to ctx.msg_id
  powerTokenGain (obj|int)    → grant Power token(s) to ctx.figure_key
  recoverDamage (int)         → heal ctx.figure_key by N
  placeDefeatedFigure         → stamp pendingPlaceDefeated
  chooseAdjacentHostileThen   → stamp pendingChooseAdjHostile
  *Effect (bool)              → stamp game.activeCardEffects[cardName] = {…}
                                so downstream systems can detect the effect

Unknown fields fall back to stamping `game.activeCardEffects[cardName]`
with the full schema so the card still "fires" meaningfully.
"""
from __future__ import annotations

from typing import Any, Dict

from python.engine.data.ability_library_loader import get_ability


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    return game


def apply_cc_schema(card_name: str):
    """Factory: return a CC handler that applies the schema fields of
    `card_name`'s ability-library entry to game state.

    The returned callable has the standard CC handler signature:
        handler(game, pending, ctx) -> dict
    """
    def _handler(game, pending, ctx):
        ctx = ctx or {}
        pending = pending or {}
        entry = get_ability(card_name) or {}
        # chooseOne: auto-pick option 0 (or ctx.choice_index) and merge
        # its fields into the entry. Mirrors pattern_e_schema's same
        # treatment.
        choose_one = entry.get('chooseOne')
        if isinstance(choose_one, list) and choose_one:
            idx = int(ctx.get('choice_index') or 0)
            if 0 <= idx < len(choose_one) and isinstance(choose_one[idx], dict):
                merged = dict(entry)
                merged.pop('chooseOne', None)
                for k, v in choose_one[idx].items():
                    merged[k] = v
                entry = merged
        data = _data(game)
        effects = []

        player_num = pending.get('playerNum')
        figure_key = ctx.get('figure_key') or pending.get('figureKey')
        msg_id = ctx.get('msg_id') or pending.get('msgId')

        # draw N cards from own CC deck
        draw_n = entry.get('draw')
        if isinstance(draw_n, int) and draw_n > 0 and player_num in (1, 2):
            try:
                from python.engine.cards.deck import draw_with_reshuffle
                drew = draw_with_reshuffle(game, player_num, draw_n)
                effects.append({'effect': 'draw', 'count': len(drew or [])})
            except Exception:
                pass

        # applyFocus — add Focus to figure_key
        if entry.get('applyFocus') and figure_key:
            try:
                from python.engine.mechanics.conditions import apply_condition
                apply_condition(game, figure_key, 'Focus')
                effects.append({'effect': 'applyFocus', 'figureKey': figure_key})
            except Exception:
                pass

        # applyHide — add Hide to figure_key
        if entry.get('applyHide') and figure_key:
            try:
                from python.engine.mechanics.conditions import apply_condition
                apply_condition(game, figure_key, 'Hide')
                effects.append({'effect': 'applyHide', 'figureKey': figure_key})
            except Exception:
                pass

        # mpBonus — grant MP to ctx.msg_id
        mp_bonus = entry.get('mpBonus')
        if isinstance(mp_bonus, int) and mp_bonus > 0 and msg_id:
            try:
                from python.engine.mechanics.game_helpers import grant_movement_bank
                grant_movement_bank(game, msg_id, mp_bonus)
                effects.append({'effect': 'mpBonus', 'amount': mp_bonus})
            except Exception:
                pass

        # powerTokenGain — grant tokens
        ptg = entry.get('powerTokenGain')
        if ptg and figure_key:
            try:
                from python.engine.mechanics.tokens import grant_power_tokens
                if isinstance(ptg, int):
                    grant_power_tokens(data, figure_key, 'Block', ptg)
                    effects.append({'effect': 'powerTokenGain', 'count': ptg})
                elif isinstance(ptg, dict):
                    ttype = ptg.get('type') or 'Block'
                    cnt = int(ptg.get('count') or 1)
                    grant_power_tokens(data, figure_key, ttype, cnt)
                    effects.append({'effect': 'powerTokenGain',
                                    'tokenType': ttype, 'count': cnt})
            except Exception:
                pass

        # recoverDamage — heal N
        recover = entry.get('recoverDamage')
        if isinstance(recover, int) and recover > 0 and figure_key and msg_id \
                and player_num in (1, 2):
            try:
                from python.engine.mechanics.damage_helpers import heal_hp
                from python.engine.mechanics.dc_helpers import parse_figure_key
                fig_idx = parse_figure_key(figure_key).get('figureIndex', 0)
                dc_health_state = data.get('dcHealthState')
                if isinstance(dc_health_state, dict):
                    heal_hp(dc_health_state, data, msg_id, fig_idx, recover, player_num)
                effects.append({'effect': 'recoverDamage', 'amount': recover})
            except Exception:
                pass

        # placeDefeatedFigure — Auto-resolve: mark the first defeated
        # friendly as "available for return" via a flag the round
        # cleanup can read. No pending stamp; in headless we can't
        # pick a coord without a full board-picker.
        if entry.get('placeDefeatedFigure'):
            defeated_flag = data.get('defeatedReturnQueue') or {}
            defeated_flag[card_name] = {
                'playerNum': player_num,
                'spec': entry.get('placeDefeatedFigure'),
            }
            data['defeatedReturnQueue'] = defeated_flag
            effects.append({
                'effect': 'placeDefeatedFigure_flagged',
                'note': 'placement-picker not modelled in headless',
            })

        # chooseAdjacentHostileThen — if target supplied in ctx, apply
        # damage/condition/strain; otherwise stamp pending.
        cah = entry.get('chooseAdjacentHostileThen')
        if isinstance(cah, dict):
            target_fk = ctx.get('target_figure_key') or ctx.get('targetFigureKey')
            target_pn = ctx.get('target_player_num') or ctx.get('targetPlayerNum')
            target_msg = ctx.get('target_msg_id') or ctx.get('targetMsgId')
            if target_fk and target_pn in (1, 2):
                damage = int(cah.get('damage') or 0)
                strain = int(cah.get('strain') or 0)
                condition = cah.get('applyCondition') or cah.get('condition')
                if damage > 0 and target_msg:
                    try:
                        from python.engine.mechanics.damage_helpers import reduce_hp
                        from python.engine.mechanics.figure_lookup import parse_figure_key
                        parsed = parse_figure_key(target_fk)
                        fig_idx = parsed[2] if parsed else 0
                        dc_health = data.get('dcHealthState') or {}
                        reduce_hp(dc_health, data, target_msg, fig_idx, damage, target_pn)
                    except Exception:
                        pass
                if isinstance(condition, str) and condition:
                    try:
                        from python.engine.mechanics.conditions import apply_condition
                        apply_condition(game, target_fk, condition)
                    except Exception:
                        pass
                effects.append({
                    'effect': 'chooseAdjacentHostileThen_resolved',
                    'target': target_fk,
                    'damage': damage, 'strain': strain, 'condition': condition,
                })
            else:
                # Auto-pick first adjacent hostile; if none, first
                # hostile on the board.
                picked = None
                try:
                    from python.engine.mechanics.adjacency import (
                        is_chebyshev_adjacent,
                    )
                    fp = data.get('figurePositions') or {}
                    self_coord = None
                    if figure_key and player_num in (1, 2):
                        self_coord = (fp.get(player_num) or {}).get(figure_key)
                    opp = 2 if player_num == 1 else 1
                    opp_positions = fp.get(opp) or {}
                    if self_coord:
                        for fk, coord in opp_positions.items():
                            if coord and is_chebyshev_adjacent(self_coord, coord):
                                picked = (fk, opp)
                                break
                    if picked is None and opp_positions:
                        fk = next(iter(opp_positions))
                        picked = (fk, opp)
                except Exception:
                    pass
                if picked:
                    pfk, ppn = picked
                    try:
                        from python.engine.mechanics.figure_lookup import (
                            find_dc_message_id_for_figure, parse_figure_key,
                        )
                        dc_meta = data.get('dcMessageMeta') or {}
                        tmsg = find_dc_message_id_for_figure(
                            data.get('gameId'), ppn, pfk, dc_meta,
                        )
                        damage = int(cah.get('damage') or 0)
                        if damage > 0 and tmsg:
                            from python.engine.mechanics.damage_helpers import reduce_hp
                            parsed = parse_figure_key(pfk)
                            fig_idx = parsed[2] if parsed else 0
                            dc_health = data.get('dcHealthState') or {}
                            reduce_hp(dc_health, data, tmsg, fig_idx, damage, ppn)
                        condition = cah.get('applyCondition') or cah.get('condition')
                        if isinstance(condition, str) and condition:
                            from python.engine.mechanics.conditions import apply_condition
                            apply_condition(game, pfk, condition)
                    except Exception:
                        pass
                    effects.append({
                        'effect': 'chooseAdjacentHostileThen_autoresolved',
                        'target': pfk,
                    })
                else:
                    effects.append({
                        'effect': 'chooseAdjacentHostileThen_no_target',
                    })

        # Combat-phase bonuses — stamp on pendingCombat if present.
        _COMBAT_FIELDS = {
            'attackBonusHits': 'bonusHits',
            'attackAccuracyBonus': 'bonusAccuracy',
            'attackBonusDice': 'attackerBonusDice',
            'attackSurgeBonus': 'bonusSurges',
            'defensePoolRemoveMax': 'defenseDiceRemoved',
            'roundDefenseBonusBlock': 'bonusBlock',
            'roundDefenseBonusEvade': 'bonusEvade',
            'applyDefenseBonusBlock': 'bonusBlock',
            'applyDefenseBonusEvade': 'bonusEvade',
            'defenseBonusDice': 'defenderBonusDice',
            'rerollOneAttackDie': 'attackerRerollCount',
        }
        combat = data.get('pendingCombat')
        if isinstance(combat, dict):
            c = None
            for field, combat_key in _COMBAT_FIELDS.items():
                val = entry.get(field)
                if isinstance(val, (int, float)) and val:
                    if c is None:
                        c = dict(combat)
                    c[combat_key] = int(c.get(combat_key) or 0) + int(val)
                    effects.append({
                        'effect': field, 'combatKey': combat_key,
                        'delta': int(val),
                    })
            if c is not None:
                data['pendingCombat'] = c

        # Boolean *Effect flags — stamp activeCardEffects so other systems
        # detect this card's effect is active (used for complex multi-turn
        # effects like coveringFireEffect, devotionEffect, etc.).
        active = data.get('activeCardEffects') or {}
        stamped = False
        for k, v in entry.items():
            if k.endswith('Effect') and v is True:
                active[card_name] = {
                    'cardName': card_name,
                    'flag': k,
                    'playerNum': player_num,
                    'figureKey': figure_key,
                    'round': data.get('round'),
                }
                stamped = True
                effects.append({'effect': k})
                break
        if stamped:
            data['activeCardEffects'] = active

        # ── Per-card named-flag stamps (Phase 2A continuation) ─────────
        # Each of these CC schemas stamps a per-card / per-player flag
        # that downstream code (combat, EoR rules, condition appliers)
        # reads at the appropriate window. The schema handler ensures
        # the flag is set on game state regardless of whether the
        # downstream consumer is fully ported.

        # A Powerful Influence: hostile figures within range can't interact
        # / count for control. JS sets game.powerfulInfluencePlayerNum.
        if entry.get('interactBlockRange') and entry.get('controlBlockRange'):
            data['powerfulInfluencePlayerNum'] = player_num
            effects.append({'effect': 'powerfulInfluence',
                            'playerNum': player_num})

        # Data Theft (stealsFromOpponentDiscard): mark active so combat
        # / EoR logic can route the steal effect.
        if entry.get('stealsFromOpponentDiscard'):
            data['dataTheftActive'] = {'playerNum': player_num}
            effects.append({'effect': 'dataTheft', 'playerNum': player_num})

        # Efficient Travel: round-scoped MP bonus marker.
        if entry.get('roundEfficientTravel'):
            data['efficientTravelPlayerNum'] = player_num
            effects.append({'effect': 'efficientTravel',
                            'playerNum': player_num})

        # Harsh Environment: round-wide environment flag.
        if entry.get('setsHarshEnvironment'):
            data['harshEnvironmentActive'] = {'playerNum': player_num}
            effects.append({'effect': 'harshEnvironment',
                            'playerNum': player_num})

        # Hostile Negotiation: each player discards N random cards from
        # hand. Implements the symmetric hand-discard pattern directly.
        own_disc = entry.get('discardRandomFromHand')
        opp_disc = entry.get('opponentDiscardRandomFromHand')

        def _discard_random(pn: int, n: int) -> int:
            hand_key = f'player{pn}CcHand'
            disc_key = f'player{pn}CcDiscard'
            hand = list(data.get(hand_key) or [])
            disc = list(data.get(disc_key) or [])
            import random as _rng
            removed = 0
            for _ in range(n):
                if not hand:
                    break
                idx = _rng.randrange(len(hand))
                disc.append(hand.pop(idx))
                removed += 1
            data[hand_key] = hand
            data[disc_key] = disc
            return removed

        if (isinstance(own_disc, int) or isinstance(opp_disc, int)) \
                and player_num in (1, 2):
            opp = 2 if player_num == 1 else 1
            if isinstance(own_disc, int) and own_disc > 0:
                n = _discard_random(player_num, own_disc)
                effects.append({'effect': 'discardRandomFromHand',
                                'playerNum': player_num, 'count': n})
            if isinstance(opp_disc, int) and opp_disc > 0:
                n = _discard_random(opp, opp_disc)
                effects.append({'effect': 'opponentDiscardRandomFromHand',
                                'playerNum': opp, 'count': n})

        # Just Business: round-scoped reroll grant for the playing player.
        rerolls = entry.get('roundAttackRerollDice')
        if isinstance(rerolls, int) and rerolls > 0:
            data['roundAttackRerollDice'] = {
                'playerNum': player_num, 'count': rerolls,
            }
            effects.append({'effect': 'roundAttackRerollDice',
                            'count': rerolls})

        # freeAttackBonus (Lightbow + similar): JS stamps a boolean true
        # gate on the msgId. Python previously incremented a count which
        # diverged from JS shape. Match JS exactly.
        if entry.get('freeAttackBonus') and msg_id:
            fab = dict(data.get('freeAttackBonusPending') or {})
            fab[msg_id] = True
            data['freeAttackBonusPending'] = fab
            effects.append({'effect': 'freeAttackBonus',
                            'msgId': msg_id})

        # overrideAttackDice / overrideAttackType / overrideBonusAccuracy
        # (Lightbow): stamp pendingOverrideAttackDice. JS shape is fully
        # populated with blockSurgeAbilities/mustTargetNonAdjacent/pierce
        # defaults so the consumer doesn't need to fill them.
        if (entry.get('overrideAttackDice')
                or entry.get('overrideAttackType')
                or entry.get('overrideBonusAccuracy')) and msg_id:
            poad = dict(data.get('pendingOverrideAttackDice') or {})
            poad[msg_id] = {
                'dice': entry.get('overrideAttackDice'),
                'type': entry.get('overrideAttackType'),
                'bonusAccuracy': entry.get('overrideBonusAccuracy') or 0,
                'blockSurgeAbilities': bool(entry.get('blockSurgeAbilities')),
                'mustTargetNonAdjacent': bool(entry.get('mustTargetNonAdjacent')),
                'pierce': int(entry.get('pierce') or 0),
            }
            data['pendingOverrideAttackDice'] = poad
            effects.append({'effect': 'overrideAttackDice',
                            'msgId': msg_id})

        # Rebel Graffiti: +N VP next EoR for terminal-controller.
        rg = entry.get('rebelGraffitiVp')
        if isinstance(rg, int) and rg > 0:
            data['rebelGraffitiPending'] = {
                'playerNum': player_num, 'bonus': rg,
            }
            effects.append({'effect': 'rebelGraffitiVp', 'bonus': rg})

        # Cal's Buddy: stamp a pending companion-deploy. Empty schema in
        # the ability library — handler is hardcoded by card name.
        if card_name == "Cal's Buddy":
            atk_fp = (data.get('figurePositions') or {}).get(player_num) or {}
            cal_key = next(
                (k for k in atk_fp if k.startswith('Cal Kestis-')),
                None,
            )
            if cal_key:
                pending = dict(data.get('calsBuddyPending') or {})
                pending[cal_key] = {'playerNum': player_num,
                                    'calFigureKey': cal_key}
                data['calsBuddyPending'] = pending
                effects.append({'effect': 'calsBuddyPending',
                                'playerNum': player_num,
                                'calFigureKey': cal_key})

        # Single-flag CCs that just toggle a game-wide marker.
        # Pattern: field name == game state field. Stamp playerNum.
        for flag_field in ('signalJammer', 'sitTightPlayerNum',
                            'lureOfTheDarkSide', 'setsWreakVengeance'):
            if entry.get(flag_field):
                # Field name strips trailing 'PlayerNum' if present so
                # we end up with a clean flag name for game state.
                clean = flag_field
                if clean.endswith('PlayerNum'):
                    clean = clean[:-len('PlayerNum')] + 'PlayerNum'
                data[clean] = player_num
                effects.append({'effect': flag_field,
                                'playerNum': player_num})

        if effects:
            return {
                'applied': True,
                'effects': effects,
                'log_message': entry.get('logMessage') or (
                    f'{card_name} — {len(effects)} schema effect(s) applied.'
                ),
            }

        # Fallback: stamp activeCardEffects with the full schema so the
        # card at least registers as "active" for downstream inspection.
        active = data.get('activeCardEffects') or {}
        active[card_name] = {
            'cardName': card_name,
            'playerNum': player_num,
            'figureKey': figure_key,
            'schema': {
                k: v for k, v in entry.items()
                if k not in ('type', 'label', 'description', 'wiredStatus',
                             'logMessage', 'category')
            },
        }
        data['activeCardEffects'] = active
        return {
            'applied': True,
            'effects': [],
            'log_message': f'{card_name} — played (complex mechanic stamped on activeCardEffects).',
        }

    safe = card_name.lower()
    for ch in " ,.!?():-/'":
        safe = safe.replace(ch, '_')
    while '__' in safe:
        safe = safe.replace('__', '_')
    safe = safe.strip('_') or 'cc'
    _handler.__name__ = f'_cc_schema_{safe}'
    _handler.__doc__ = f'Schema-driven CC handler for {card_name!r}.'
    return _handler
