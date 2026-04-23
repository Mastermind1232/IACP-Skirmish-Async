"""Schema-driven Pattern E chain handler.

Many Pattern E DC abilities follow a small set of state-change recipes
expressed in the ability JSON as boolean/numeric flags. Rather than
hand-writing one chain handler per ability, this module reads the
ability entry and applies the schema fields directly.

Supported schema fields (mirror of src/game/abilities.js dispatch):

  freeMoveBonus (int)        → add N MP via grant_movement_bank
  mobileMovement (bool)      → set game.mobileMovementActive[msgId] = True
  freeAttackBonus (bool|obj) → set game.freeAttackBonusPending[msgId] = payload
  pounceRange (int)          → stamp pendingPounce with range (space picker)
  pounceNoAttack (bool)      → stamped alongside pounceRange
  nextAttacksBonusHits (obj) → stamp pendingNextAttacksBonusHits
  nextAttacksBonusAcc (obj)  → stamp pendingNextAttacksBonusAcc
  envRecoveryGearEffect      → apply self + adjacent TROOPER heal/condition
  freeMoveBonus variants: handled first, can combine with freeAttackBonus

For any remaining fields not recognized, falls back to stamping
pendingPatternE so the ability still "fires" for training purposes.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from python.engine.data.ability_library_loader import get_ability
from python.engine.mechanics.game_helpers import grant_movement_bank


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    return game  # best-effort; tolerate mapping-like


def handle_schema_chain(game: Any, ability_id: str,
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Generic schema-driven chain resolver.

    Applies the common schema fields of the ability directly to game
    state. Returns {applied, effects, pending_key, log_message}.
    """
    entry = get_ability(ability_id) or {}
    data = _data(game)
    msg_id = ctx.get('msg_id') or ctx.get('msgId')
    if not msg_id:
        figure_key = ctx.get('figure_key') or ctx.get('figureKey')
        player_num = ctx.get('player_num') or ctx.get('playerNum')
        dc_meta = data.get('dcMessageMeta')
        if figure_key and player_num and dc_meta:
            from python.engine.mechanics.figure_lookup import (
                find_dc_message_id_for_figure,
            )
            msg_id = find_dc_message_id_for_figure(
                data.get('gameId'), player_num, figure_key, dc_meta,
            )

    effects = []

    free_move = entry.get('freeMoveBonus')
    if isinstance(free_move, (int, float)) and free_move > 0 and msg_id:
        grant_movement_bank(data, msg_id, int(free_move))
        effects.append({'effect': 'freeMoveBonus', 'amount': int(free_move)})

    if entry.get('mobileMovement') and msg_id:
        mobile = data.get('mobileMovementActive') or {}
        mobile[msg_id] = True
        data['mobileMovementActive'] = mobile
        effects.append({'effect': 'mobileMovement'})

    free_attack = entry.get('freeAttackBonus')
    if free_attack and msg_id:
        pending_fa = data.get('freeAttackBonusPending') or {}
        # JS uses True OR a dict `{from: '...'}`; mirror both.
        pending_fa[msg_id] = (
            {'from': entry.get('label') or ability_id}
            if isinstance(free_attack, bool)
            else dict(free_attack)
        )
        data['freeAttackBonusPending'] = pending_fa
        effects.append({'effect': 'freeAttackBonus'})

    pounce_range = entry.get('pounceRange')
    if isinstance(pounce_range, (int, float)) and pounce_range > 0:
        pounce = {
            'abilityId': ability_id,
            'range': int(pounce_range),
            'noAttack': bool(entry.get('pounceNoAttack')),
            'figureKey': ctx.get('figure_key') or ctx.get('figureKey'),
            'playerNum': ctx.get('player_num') or ctx.get('playerNum'),
            'msgId': msg_id,
        }
        data['pendingPounce'] = pounce
        effects.append({'effect': 'pounceRange', 'range': int(pounce_range)})

    next_hits = entry.get('nextAttacksBonusHits')
    if isinstance(next_hits, dict) and msg_id:
        pend = data.get('nextAttacksBonusHits') or {}
        pend[msg_id] = dict(next_hits)
        data['nextAttacksBonusHits'] = pend
        effects.append({'effect': 'nextAttacksBonusHits', 'payload': dict(next_hits)})

    next_acc = entry.get('nextAttacksBonusAcc')
    if isinstance(next_acc, dict) and msg_id:
        pend = data.get('nextAttacksBonusAcc') or {}
        pend[msg_id] = dict(next_acc)
        data['nextAttacksBonusAcc'] = pend
        effects.append({'effect': 'nextAttacksBonusAcc', 'payload': dict(next_acc)})

    # envRecoveryGearEffect — self + adjacent friendly TROOPERs heal 1 HP OR
    # discard 1 harmful condition. Apply the recovery to whichever eligible
    # figures have the choice; treat it as blanket heal for simplicity
    # (JS prompts player choice). This stamps a pending for the UI/AI to
    # pick per-figure and also auto-applies a self-heal.
    if entry.get('envRecoveryGearEffect') and msg_id:
        data['pendingEnvRecoveryGear'] = {
            'abilityId': ability_id,
            'msgId': msg_id,
            'figureKey': ctx.get('figure_key'),
            'playerNum': ctx.get('player_num'),
        }
        effects.append({'effect': 'envRecoveryGearEffect'})

    # targetHostileFigure — if ctx supplies target_figure_key +
    # target_player_num + target_msg_id, apply damage/strain/condition
    # directly. Otherwise stamp pendingTargetHostile for the UI/AI to
    # resolve.
    thf = entry.get('targetHostileFigure')
    if isinstance(thf, dict):
        target_fk = ctx.get('target_figure_key') or ctx.get('targetFigureKey')
        target_pn = ctx.get('target_player_num') or ctx.get('targetPlayerNum')
        target_msg = ctx.get('target_msg_id') or ctx.get('targetMsgId')
        if target_fk and target_pn in (1, 2):
            damage = int(thf.get('damage') or 0)
            strain = int(thf.get('strain') or 0)
            condition = thf.get('applyCondition')
            if damage > 0 and target_msg:
                from python.engine.mechanics.damage_helpers import reduce_hp
                from python.engine.mechanics.figure_lookup import parse_figure_key
                parsed = parse_figure_key(target_fk)
                fig_idx = parsed[2] if parsed else 0
                dc_health = data.get('dcHealthState') or {}
                reduce_hp(dc_health, data, target_msg, fig_idx, damage, target_pn)
            if strain > 0:
                try:
                    from python.engine.mechanics.strain import apply_strain_to_figure
                    apply_strain_to_figure(data, target_fk, target_pn, strain)
                except Exception:
                    pass
            if isinstance(condition, str) and condition:
                try:
                    from python.engine.mechanics.conditions import apply_condition
                    apply_condition(game, target_fk, condition)
                except Exception:
                    pass
            effects.append({
                'effect': 'targetHostileFigure_resolved',
                'target': target_fk, 'damage': damage, 'strain': strain,
                'condition': condition,
            })
        else:
            data['pendingTargetHostile'] = {
                'abilityId': ability_id,
                'spec': dict(thf),
                'figureKey': ctx.get('figure_key'),
                'playerNum': ctx.get('player_num'),
                'msgId': msg_id,
            }
            effects.append({'effect': 'targetHostileFigure'})

    # fixedAreaEffect — if ctx supplies target_coord, iterate every
    # figure within fixedAreaRange and apply damage/strain/conditions.
    # Otherwise stamp pendingFixedArea for UI/AI to resolve.
    if entry.get('fixedAreaEffect'):
        area_range = int(entry.get('fixedAreaRange') or 0)
        area_damage = int(entry.get('fixedAreaDamage') or 0)
        area_strain = int(entry.get('fixedAreaStrain') or 0)
        area_conditions = list(entry.get('fixedAreaConditions') or [])
        target_coord = ctx.get('target_coord') or ctx.get('targetCoord')
        caster_pn = ctx.get('player_num')
        if target_coord and area_range > 0 and caster_pn in (1, 2):
            try:
                from python.engine.mechanics.board_helpers import count_game_spaces
                fp = data.get('figurePositions') or {}
                dc_health = data.get('dcHealthState') or {}
                dc_meta = data.get('dcMessageMeta') or {}
                hits: List[Dict[str, Any]] = []
                for pn in (1, 2):
                    for fk, coord in (fp.get(pn) or {}).items():
                        if not coord:
                            continue
                        dist = count_game_spaces(game, target_coord, coord)
                        if dist <= area_range:
                            # Apply damage via reduce_hp if we can find msg_id
                            target_msg = None
                            from python.engine.mechanics.figure_lookup import (
                                find_dc_message_id_for_figure,
                                parse_figure_key,
                            )
                            target_msg = find_dc_message_id_for_figure(
                                data.get('gameId'), pn, fk, dc_meta,
                            )
                            if area_damage > 0 and target_msg:
                                parsed = parse_figure_key(fk)
                                fig_idx = parsed[2] if parsed else 0
                                try:
                                    from python.engine.mechanics.damage_helpers import reduce_hp
                                    reduce_hp(dc_health, data, target_msg, fig_idx, area_damage, pn)
                                except Exception:
                                    pass
                            for cond in area_conditions:
                                try:
                                    from python.engine.mechanics.conditions import apply_condition
                                    apply_condition(game, fk, cond)
                                except Exception:
                                    pass
                            hits.append({
                                'figureKey': fk, 'playerNum': pn,
                                'distance': int(dist),
                                'damageDealt': area_damage,
                                'conditions': list(area_conditions),
                            })
                effects.append({
                    'effect': 'fixedAreaEffect_resolved',
                    'center': target_coord,
                    'range': area_range,
                    'hitsCount': len(hits),
                    'hits': hits,
                })
            except Exception:
                data['pendingFixedArea'] = {
                    'abilityId': ability_id,
                    'range': area_range, 'damage': area_damage,
                    'strain': area_strain, 'conditions': area_conditions,
                    'figureKey': ctx.get('figure_key'),
                    'playerNum': caster_pn, 'msgId': msg_id,
                }
                effects.append({'effect': 'fixedAreaEffect'})
        else:
            data['pendingFixedArea'] = {
                'abilityId': ability_id,
                'range': area_range, 'damage': area_damage,
                'strain': area_strain, 'conditions': area_conditions,
                'figureKey': ctx.get('figure_key'),
                'playerNum': caster_pn, 'msgId': msg_id,
            }
            effects.append({'effect': 'fixedAreaEffect'})

    # rollOneDie — if ctx.target_figure_key provided, roll a single attack
    # die and apply damage equal to the hit count to the target. Otherwise
    # stamp pendingRollOneDie for UI/AI to resolve.
    roll_spec = entry.get('rollOneDie')
    if roll_spec:
        target_fk = ctx.get('target_figure_key') or ctx.get('targetFigureKey')
        target_pn = ctx.get('target_player_num') or ctx.get('targetPlayerNum')
        target_msg = ctx.get('target_msg_id') or ctx.get('targetMsgId')
        if target_fk and target_pn in (1, 2) and target_msg:
            try:
                from python.engine.mechanics.dice import roll_attack_dice
                from python.engine.mechanics.damage_helpers import reduce_hp
                from python.engine.mechanics.figure_lookup import parse_figure_key
                die_color = roll_spec if isinstance(roll_spec, str) else 'red'
                roll_result = roll_attack_dice([die_color])
                hits = int(roll_result.get('dmg') or 0)
                if hits > 0:
                    parsed = parse_figure_key(target_fk)
                    fig_idx = parsed[2] if parsed else 0
                    dc_health = data.get('dcHealthState') or {}
                    reduce_hp(dc_health, data, target_msg, fig_idx, hits, target_pn)
                effects.append({
                    'effect': 'rollOneDie_resolved',
                    'dieColor': die_color,
                    'hits': hits,
                    'target': target_fk,
                    'damage': hits,
                })
            except Exception:
                data['pendingRollOneDie'] = {
                    'abilityId': ability_id,
                    'targetMode': entry.get('rollOneDieTarget'),
                    'range': int(entry.get('rollOneDieRange') or 0),
                    'maxTargets': int(entry.get('rollOneDieMaxTargets') or 0),
                    'figureKey': ctx.get('figure_key'),
                    'playerNum': ctx.get('player_num'),
                    'msgId': msg_id,
                }
                effects.append({'effect': 'rollOneDie'})
        else:
            data['pendingRollOneDie'] = {
                'abilityId': ability_id,
                'targetMode': entry.get('rollOneDieTarget'),
                'range': int(entry.get('rollOneDieRange') or 0),
                'maxTargets': int(entry.get('rollOneDieMaxTargets') or 0),
                'figureKey': ctx.get('figure_key'),
                'playerNum': ctx.get('player_num'),
                'msgId': msg_id,
            }
            effects.append({'effect': 'rollOneDie'})

    # pushTargetWithinRange — stamp pending push (handled concretely by
    # force_throw/wrist_cord/mandalorian_whip; this is for the remaining
    # schema-only refs).
    if entry.get('pushTargetWithinRange'):
        ptr = entry['pushTargetWithinRange']
        data['pendingPushTarget'] = {
            'abilityId': ability_id,
            'spec': dict(ptr) if isinstance(ptr, dict) else {'value': ptr},
            'figureKey': ctx.get('figure_key'),
            'playerNum': ctx.get('player_num'),
            'msgId': msg_id,
        }
        effects.append({'effect': 'pushTargetWithinRange'})

    # targetFriendlyFigureAdjacent — pick an adjacent friendly to apply the
    # effect (e.g., heal, focus).
    tff = entry.get('targetFriendlyFigureAdjacent')
    if tff:
        data['pendingTargetFriendlyAdjacent'] = {
            'abilityId': ability_id,
            'spec': dict(tff) if isinstance(tff, dict) else {'value': tff},
            'figureKey': ctx.get('figure_key'),
            'playerNum': ctx.get('player_num'),
            'msgId': msg_id,
        }
        effects.append({'effect': 'targetFriendlyFigureAdjacent'})

    # chooseFriendlyToFocus — add Focus token to a chosen friendly.
    if entry.get('chooseFriendlyToFocus'):
        data['pendingChooseFriendlyFocus'] = {
            'abilityId': ability_id,
            'figureKey': ctx.get('figure_key'),
            'playerNum': ctx.get('player_num'),
            'msgId': msg_id,
        }
        effects.append({'effect': 'chooseFriendlyToFocus'})

    # freeAction — boolean hint; surface on the payload so stepper/UI can
    # restore the spent action counter.
    free_action = bool(entry.get('freeAction'))

    if effects:
        return {
            'applied': True,
            'effects': effects,
            'freeAction': free_action,
            'log_message': entry.get('logMessage') or (
                f'{entry.get("label") or ability_id} fired '
                f'({len(effects)} schema effect{"s" if len(effects) != 1 else ""}).'
            ),
        }

    # Fallback: stamp pendingPatternE so downstream code knows the
    # ability fired but mechanics are still TBD.
    pending = dict(data.get('pendingPatternE') or {})
    pending[ability_id] = {
        'abilityId': ability_id,
        'figureKey': ctx.get('figure_key'),
        'playerNum': ctx.get('player_num'),
    }
    data['pendingPatternE'] = pending
    return {
        'applied': True,
        'effects': [],
        'pending_key': 'pendingPatternE',
        'log_message': (
            f'{entry.get("label") or ability_id} fired (no schema match; '
            f'pending resolution queued).'
        ),
    }
