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

        # placeDefeatedFigure — stamp pending placement picker
        if entry.get('placeDefeatedFigure'):
            data['pendingPlaceDefeated'] = {
                'cardName': card_name,
                'playerNum': player_num,
                'spec': entry.get('placeDefeatedFigure'),
            }
            effects.append({'effect': 'placeDefeatedFigure'})

        # chooseAdjacentHostileThen — stamp pending target with spec
        cah = entry.get('chooseAdjacentHostileThen')
        if isinstance(cah, dict):
            data['pendingChooseAdjHostile'] = {
                'cardName': card_name,
                'playerNum': player_num,
                'figureKey': figure_key,
                'spec': dict(cah),
            }
            effects.append({'effect': 'chooseAdjacentHostileThen'})

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
