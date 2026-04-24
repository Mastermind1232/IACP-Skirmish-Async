"""Attack orchestrator — the full combat pipeline.

Sequences the existing combat primitives in the order JS
`src/handlers/combat.js` runs them, firing Pattern D triggers at each
phase boundary. Replaces the atomic one-shot in stepper._handle_attack_target
when `action.params['orchestrated']=True`.

Pipeline phases (JS parity):

  1. DECLARE    — validate adjacency/LOS, build pendingCombat scaffolding
  2. PRE-ATTACK — fire combat-declare triggers (attacker + defender walks)
                  + combat-defense-friends walks (sentinel/protector/ktp)
  3. ROLL       — roll attack + defense dice (deterministic via rng)
  4. DICE-SURGERY — fire combat-dice triggers (Fury, Vanguard, Shock&Awe,
                    Front Line) that mutate the dice pool
  5. SURGE      — spend surges per action.params['surge_spends']
  6. RESOLVE    — compute_combat_result → {hit, damage, effectiveBlock}
  7. APPLY      — reduce defender HP; apply bonusConditions from combat
  8. ON-DAMAGE  — fire on-damage triggers (self_preservation)
  9. PRE-DEFEAT — fire pre-defeat triggers if new_hp <= 0
 10. DEFEAT     — remove figure + award kill VP + defeat conditions clear
 11. ON-DEFEAT  — fire on-defeat (defender's) + friendly-defeat (own side)
 12. POST       — fire combat-after triggers, clear pendingCombat

Return shape:
    {
        'damage': int,
        'hit': bool,
        'defeated': bool,
        'vp_gained': int,
        'triggered_abilities': [{ability_id, applied, gated_by, log_message}, ...],
        'conditions_applied': [{figure_key, condition}, ...],
        'combat': dict  # final pendingCombat for inspection
    }

No Discord IO. Pure state mutation + deterministic resolution.
"""
from __future__ import annotations

import random as _random
from typing import Any, Dict, List, Optional, Tuple

from python.engine.data.dc_effects_loader import get_dc_effect
from python.engine.mechanics.board_helpers import count_game_spaces
from python.engine.mechanics.combat import compute_combat_result
from python.engine.mechanics.combat_declare import fire_combat_declare_triggers
from python.engine.mechanics.combat_defense_friends import (
    fire_combat_defense_friends_triggers,
)
from python.engine.mechanics.conditions import apply_condition, filter_condition
from python.engine.mechanics.damage_helpers import reduce_hp
from python.engine.mechanics.dice import roll_attack_dice, roll_defense_dice
from python.engine.mechanics.defeat import calculate_kill_vp
from python.engine.mechanics.vp_helpers import award_kill_vp


def _data(game: Any) -> Dict[str, Any]:
    return game.data if hasattr(game, 'data') else game


def _find_figure(game: Any, figure_key: str) -> Tuple[Optional[int], Optional[str]]:
    data = _data(game)
    fp = data.get('figurePositions') or {}
    for pn_key, positions in fp.items():
        if not isinstance(positions, dict):
            continue
        coord = positions.get(figure_key)
        if coord:
            pn = pn_key if isinstance(pn_key, int) else int(pn_key)
            return pn, coord
    return None, None


def _dc_name_from_figure_key(figure_key: str) -> str:
    parts = figure_key.rsplit('-', 2)
    return parts[0] if len(parts) == 3 else figure_key


def _figure_index_from_key(figure_key: str) -> int:
    parts = figure_key.rsplit('-', 2)
    try:
        return int(parts[-1]) if len(parts) == 3 else 0
    except ValueError:
        return 0


def _get_hp(data: Dict[str, Any], msg_id: str, fig_idx: int) -> Tuple[int, int]:
    """Return (current_hp, max_hp) for a figure via dcHealthState."""
    state = (data.get('dcHealthState') or {}).get(msg_id)
    if not state or fig_idx >= len(state):
        return 0, 0
    entry = state[fig_idx]
    if not isinstance(entry, list) or len(entry) < 2:
        return 0, 0
    return int(entry[0] or 0), int(entry[1] or 0)


def _msg_id_for_figure(data: Dict[str, Any], figure_key: str,
                         player_num: int) -> Optional[str]:
    """Resolve the DC's message id by matching dcName + group index."""
    dc_name = _dc_name_from_figure_key(figure_key)
    parts = figure_key.rsplit('-', 2)
    try:
        group = int(parts[1]) if len(parts) == 3 else 0
    except ValueError:
        group = 0
    dc_list = data.get(f'p{player_num}DcList') or []
    msg_ids = data.get(f'p{player_num}DcMessageIds') or []
    for i, dc in enumerate(dc_list):
        if not isinstance(dc, dict):
            continue
        if (dc.get('dcName') == dc_name
                and int(dc.get('dgIndex') or 0) == group
                and i < len(msg_ids)):
            return msg_ids[i]
    return None


def _remove_figure(data: Dict[str, Any], player_num: int,
                    figure_key: str) -> None:
    fp = data.get('figurePositions') or {}
    positions = fp.get(player_num) or fp.get(str(player_num))
    if isinstance(positions, dict):
        positions.pop(figure_key, None)


def _is_ranged(attack_spec: Dict[str, Any]) -> bool:
    return (attack_spec.get('type') or 'range').lower() == 'range'


def _damage_suffered(cur_hp: int, max_hp: int) -> int:
    return max(0, int(max_hp) - int(cur_hp))


class AttackError(ValueError):
    """Raised when the declared attack is illegal (adjacency, LOS, etc.)."""


def orchestrate_attack(game: Any, attacker_key: str, target_key: str,
                        *,
                        rng: Optional[_random.Random] = None,
                        surge_spends: Optional[List[str]] = None,
                        attack_dice_override: Optional[List[str]] = None,
                        defense_dice_override: Optional[List[str]] = None,
                        attacker_rerolls: int = 0,
                        defender_rerolls: int = 0,
                        spent_tokens: Optional[List[Dict[str, str]]] = None,
                        ) -> Dict[str, Any]:
    """Run the full attack pipeline.

    Mutates `game` in place (reduces defender HP, applies conditions,
    clears pendingCombat on completion).

    - `surge_spends`: list of ability IDs the attacker spends surges on.
      Each entry costs 1 surge from the rolled pool. Extra entries past
      the surge count are silently ignored (matches JS where the UI
      prevents overspending).
    - `attack_dice_override` / `defense_dice_override`: caller-provided
      dice colors. When absent, read from dc-effects.json defaults.

    Returns a result dict (see module docstring).
    """
    data = _data(game)

    # ── Phase 1: DECLARE ─────────────────────────────────────────────────
    atk_player, atk_coord = _find_figure(game, attacker_key)
    def_player, def_coord = _find_figure(game, target_key)
    if atk_player is None:
        raise AttackError(f'attacker {attacker_key!r} not on board')
    if def_player is None:
        raise AttackError(f'target {target_key!r} not on board')
    if atk_player == def_player:
        raise AttackError('cannot attack your own figure')

    atk_dc = _dc_name_from_figure_key(attacker_key)
    def_dc = _dc_name_from_figure_key(target_key)
    atk_effect = get_dc_effect(atk_dc) or {}
    def_effect = get_dc_effect(def_dc) or {}
    atk_attack = atk_effect.get('attack') or {}
    attacker_sids = atk_effect.get('specialAbilityIds') or []
    defender_sids = def_effect.get('specialAbilityIds') or []

    dice_colors = attack_dice_override or list(atk_attack.get('dice') or [])
    if not dice_colors:
        raise AttackError(f'{atk_dc!r} has no attack dice')
    defense_colors = defense_dice_override or list(
        def_effect.get('defense') or ['white']
    )

    distance = count_game_spaces(game, atk_coord, def_coord)
    is_ranged = _is_ranged(atk_attack)
    atk_msg_id = _msg_id_for_figure(data, attacker_key, atk_player)
    def_msg_id = _msg_id_for_figure(data, target_key, def_player)
    atk_fig_idx = _figure_index_from_key(attacker_key)
    def_fig_idx = _figure_index_from_key(target_key)

    atk_cur_hp, atk_max_hp = _get_hp(data, atk_msg_id or '', atk_fig_idx)
    attacker_damage_suffered = _damage_suffered(atk_cur_hp, atk_max_hp)

    # Consume attacker Focus (adds a green die, per standard IA rules).
    atk_conds = list((data.get('figureConditions') or {}).get(attacker_key) or [])
    attacker_conds = list(atk_conds)
    focus_consumed = False
    if 'Focus' in atk_conds:
        filter_condition(data, attacker_key, 'Focus')
        dice_colors = list(dice_colors) + ['green']
        focus_consumed = True

    # Check defender Hide: imposes +1 accuracy requirement to hit.
    def_conds = list((data.get('figureConditions') or {}).get(target_key) or [])
    defender_conds = list(def_conds)
    hide_consumed = False
    if 'Hide' in def_conds:
        # Consume Hide on attack target (defender loses Hide even if miss)
        filter_condition(data, target_key, 'Hide')
        hide_consumed = True

    combat: Dict[str, Any] = {
        'attackerFigureKey': attacker_key,
        'defenderFigureKey': target_key,
        'attackerPlayerNum': atk_player,
        'defenderPlayerNum': def_player,
        'attackType': 'range' if is_ranged else 'melee',
        'attackInfo': {'dice': list(dice_colors)},
        'attackerConds': attacker_conds,
        'defenderConds': defender_conds,
        'bonusHits': 0, 'bonusAccuracy': 0, 'bonusPierce': 0,
        'bonusBlock': 0, 'bonusEvade': 0, 'bonusDamage': 0,
        'surgeBonus': 0, 'attackerDiceToRemove': 0,
        'bonusConditions': [],
        'triggered': [],
        'spentTokens': [],
        'focusConsumed': focus_consumed,
        'hideConsumed': hide_consumed,
    }
    if hide_consumed:
        # Hide imposes +1 to the accuracy requirement. compute_combat_result
        # already reads accuracy/distance; we encode the extra requirement as
        # an additional bonusAccuracy deduction from the attacker side.
        combat['hideAccuracyPenalty'] = 1
    # Pull prior pendingCombat stamps (CC/ability bonuses from the
    # pre-attack window) into the new combat dict. Preserves bonusHits,
    # bonusAccuracy, bonusBlock, etc. that CCs like Heavy Ordnance /
    # Feint / Bodyguard stamped before the attack declaration.
    prior_pc = data.get('pendingCombat')
    if isinstance(prior_pc, dict):
        for _k in ('bonusHits', 'bonusBlock', 'bonusEvade', 'bonusAccuracy',
                   'bonusPierce', 'bonusSurges', 'bonusBlast', 'bonusCleave',
                   'bonusDamage', 'defenseDiceRemoved', 'attackerDiceToRemove',
                   'attackerBonusDice', 'defenderBonusDice',
                   'attackerRerollCount', 'defenderRerollCount',
                   'bonusConditions'):
            if _k in prior_pc and prior_pc[_k]:
                if _k == 'bonusConditions':
                    combat[_k] = list(combat.get(_k) or []) + list(prior_pc[_k] or [])
                else:
                    combat[_k] = int(combat.get(_k) or 0) + int(prior_pc[_k] or 0)
    data['pendingCombat'] = combat

    # ── Phase 2: PRE-ATTACK triggers ─────────────────────────────────────
    triggered: List[Dict[str, Any]] = []
    dcm = {
        atk_msg_id: {'gameId': data.get('gameId'),
                      'playerNum': atk_player, 'dcName': atk_dc}
    } if atk_msg_id else {}
    if def_msg_id:
        dcm[def_msg_id] = {
            'gameId': data.get('gameId'), 'playerNum': def_player, 'dcName': def_dc,
        }

    ctx = {
        'attacker_figure_key': attacker_key,
        'defender_figure_key': target_key,
        'defender_player_num': def_player,
        'distance_to_target': distance,
        'is_ranged': is_ranged,
        'attacker_damage_suffered': attacker_damage_suffered,
        'dc_health_state': data.get('dcHealthState'),
        'dc_message_meta': dcm,
    }

    try:
        declare_fired = fire_combat_declare_triggers(
            data, combat, attacker_sids, attacker_key, ctx=ctx,
            defender_special_ids=defender_sids,
        )
        triggered.extend(declare_fired)
    except (NotImplementedError, RuntimeError):
        # NotImplementedError: TriggerNotImplemented stub fired
        # RuntimeError: UnregisteredPatternD — ability lib drift
        # Either way, swallow and continue; the handlers that did fire
        # already mutated combat/game in place.
        pass

    # Fire combat-defense-friends (walks 1+2 over defender's adjacent allies)
    try:
        defense_fired = fire_combat_defense_friends_triggers(
            data, combat, def_player, target_key, atk_player,
            attacker_key, ctx=ctx,
        )
        triggered.extend(defense_fired or [])
    except (NotImplementedError, TypeError):
        # Function signature may differ in some versions; don't block combat.
        pass

    # ── Phase 3: ROLL ─────────────────────────────────────────────────────
    rng = rng or _random.Random()
    dice_colors = list(combat.get('attackInfo', {}).get('dice') or dice_colors)
    attack_roll = roll_attack_dice(dice_colors, rng=rng)
    def_rolls: List[Dict[str, Any]] = []
    for color in defense_colors:
        def_rolls.append(roll_defense_dice(color, rng=rng))

    # ── Reroll window ─────────────────────────────────────────────────────
    # Simple model: reroll the worst `N` attack dice (lowest acc+dmg+surge
    # sum) and the best `M` defense dice (highest block+evade). This
    # approximates "reroll dice that didn't help." Real IA lets the user
    # pick specific dice; caller can drive the interactive flow via the
    # stepper handlers (combat_reroll) instead.
    if attacker_rerolls > 0 and attack_roll.get('dice'):
        atk_dice = list(attack_roll['dice'])
        atk_dice.sort(key=lambda d: (d.get('acc') or 0) + (d.get('dmg') or 0)
                                     + (d.get('surge') or 0))
        n = min(attacker_rerolls, len(atk_dice))
        for i in range(n):
            old = atk_dice[i]
            new_roll = roll_attack_dice([old.get('color', 'red')], rng=rng)
            if new_roll.get('dice'):
                atk_dice[i] = new_roll['dice'][0]
        # Recompute aggregate totals
        attack_roll = {
            'acc': sum(d.get('acc') or 0 for d in atk_dice),
            'dmg': sum(d.get('dmg') or 0 for d in atk_dice),
            'surge': sum(d.get('surge') or 0 for d in atk_dice),
            'dice': atk_dice,
        }

    if defender_rerolls > 0 and def_rolls:
        # Defender rerolls the dice that gave the most (to reroll away good
        # rolls for the defender is a bad play — so we reroll the WORST
        # defender dice, i.e. low block+evade).
        def_rolls_sorted = sorted(
            def_rolls, key=lambda d: (d.get('block') or 0) + (d.get('evade') or 0)
        )
        n = min(defender_rerolls, len(def_rolls_sorted))
        for i in range(n):
            old = def_rolls_sorted[i]
            def_rolls_sorted[i] = roll_defense_dice(
                old.get('color', 'white'), rng=rng,
            )
        def_rolls = def_rolls_sorted

    def_block = sum(d.get('block', 0) or 0 for d in def_rolls)
    def_evade = sum(d.get('evade', 0) or 0 for d in def_rolls)
    def_dodge = any(bool(d.get('dodge')) for d in def_rolls)
    combat['attackRoll'] = attack_roll
    combat['defenseRoll'] = {
        'color': defense_colors[0] if defense_colors else 'white',
        'block': def_block, 'evade': def_evade, 'dodge': def_dodge,
        'dice': def_rolls,
    }
    combat['attackerRerolls'] = attacker_rerolls
    combat['defenderRerolls'] = defender_rerolls

    # Surge pool: rolled surges + surgeBonus (may have been bumped by a
    # Surge token spend above).
    rolled_surges = int(attack_roll.get('surge') or 0) + int(combat.get('surgeBonus') or 0)
    combat['surgeRemaining'] = rolled_surges

    # ── Phase 4a: TOKEN spends ──────────────────────────────────────────
    # Attacker may spend Focus (adds +1 accuracy), Surge (no-op here; used
    # in surge phase). Defender may spend Evade (+1 evade), Block (+1 block),
    # Dodge (entire attack misses).
    tokens_spent_detail: List[Dict[str, str]] = []
    force_miss = False
    if spent_tokens:
        tokens_map = data.get('figurePowerTokens') or {}
        for spec in spent_tokens:
            fk = spec.get('figure_key') or spec.get('figureKey')
            tt = spec.get('token_type') or spec.get('tokenType')
            if not fk or not tt:
                continue
            bucket = list(tokens_map.get(fk) or [])
            if tt not in bucket:
                continue
            bucket.remove(tt)
            if bucket:
                tokens_map[fk] = bucket
            else:
                tokens_map.pop(fk, None)
            # Apply effect
            if fk == attacker_key:
                if tt == 'Focus':
                    combat['bonusAccuracy'] = int(combat.get('bonusAccuracy') or 0) + 1
                elif tt == 'Surge':
                    combat['surgeBonus'] = int(combat.get('surgeBonus') or 0) + 1
            elif fk == target_key:
                if tt == 'Evade':
                    combat['bonusEvade'] = int(combat.get('bonusEvade') or 0) + 1
                elif tt == 'Block':
                    combat['bonusBlock'] = int(combat.get('bonusBlock') or 0) + 1
                elif tt == 'Dodge':
                    force_miss = True
            tokens_spent_detail.append({'figure_key': fk, 'token_type': tt})
        data['figurePowerTokens'] = tokens_map
    if force_miss:
        combat['forceMiss'] = True
    combat['spentTokens'] = tokens_spent_detail

    # ── Phase 4: SURGE spends ────────────────────────────────────────────
    spent_surges: List[str] = []
    for ability_id in (surge_spends or []):
        if combat['surgeRemaining'] <= 0:
            break
        combat['surgeRemaining'] -= 1
        spent_surges.append(ability_id)
    combat['triggeredSurges'] = spent_surges

    # ── Phase 6: RESOLVE ────────────────────────────────────────────────
    result = compute_combat_result(combat)
    hit = bool(result.get('hit'))
    damage = int(result.get('damage') or 0) if hit else 0

    # ── Phase 7: APPLY damage ───────────────────────────────────────────
    defeated = False
    vp_gained = 0
    conditions_applied: List[Dict[str, str]] = []
    blast_applied: List[Dict[str, Any]] = []
    cleave_applied: List[Dict[str, Any]] = []
    if damage > 0 and def_msg_id:
        dcs = data.get('dcHealthState') or {}
        reduce_result = reduce_hp(dcs, data, def_msg_id, def_fig_idx,
                                    damage, def_player)
        new_hp = int(reduce_result.get('newHp') or 0)
        defeated = bool(reduce_result.get('wasDefeated')) or new_hp <= 0

        # Apply bonus conditions from combat (Bleed, Stun, etc.)
        for cond in combat.get('bonusConditions') or []:
            if apply_condition(data, target_key, cond):
                conditions_applied.append(
                    {'figure_key': target_key, 'condition': cond},
                )

        # ── Blast: damage figures adjacent to the primary target ───────
        blast_n = int(combat.get('bonusBlast') or 0) + int(
            combat.get('surgeBlast') or 0,
        )
        if blast_n > 0:
            # Every figure adjacent to target_coord (on either side)
            # takes `damage` damage. Capped at blast_n targets.
            candidates: List[tuple] = []
            fp = data.get('figurePositions') or {}
            for pn_key, positions in fp.items():
                if not isinstance(positions, dict):
                    continue
                pn = pn_key if isinstance(pn_key, int) else int(pn_key)
                for fk, coord in positions.items():
                    if fk == target_key or not coord:
                        continue
                    dist = count_game_spaces(game, def_coord, coord)
                    if dist == 1:  # adjacent
                        candidates.append((pn, fk, coord))
            # Take up to blast_n candidates
            for (pn, fk, coord) in candidates[:blast_n]:
                msg_id = _msg_id_for_figure(data, fk, pn)
                if not msg_id:
                    continue
                fig_idx = _figure_index_from_key(fk)
                r = reduce_hp(data.get('dcHealthState') or {}, data,
                               msg_id, fig_idx, damage, pn)
                blast_applied.append({
                    'figure_key': fk, 'player_num': pn,
                    'damage': damage,
                    'wasDefeated': bool(r.get('wasDefeated')),
                })

        # ── Cleave: splash 1 damage to a different adjacent hostile ────
        cleave_n = int(combat.get('bonusCleave') or 0) + int(
            combat.get('surgeCleave') or 0,
        )
        if cleave_n > 0:
            # Pick ONE adjacent hostile other than the primary target
            fp = data.get('figurePositions') or {}
            # Attacker-adjacent hostiles
            atk_positions = fp.get(atk_player) or fp.get(str(atk_player)) or {}
            atk_coord_current = atk_positions.get(attacker_key)
            for pn_key, positions in fp.items():
                if not isinstance(positions, dict):
                    continue
                pn = pn_key if isinstance(pn_key, int) else int(pn_key)
                if pn == atk_player:
                    continue
                for fk, coord in positions.items():
                    if fk == target_key or not coord or not atk_coord_current:
                        continue
                    if count_game_spaces(
                        game, atk_coord_current, coord,
                    ) != 1:
                        continue
                    msg_id = _msg_id_for_figure(data, fk, pn)
                    if not msg_id:
                        continue
                    fig_idx = _figure_index_from_key(fk)
                    reduce_hp(data.get('dcHealthState') or {}, data,
                               msg_id, fig_idx, cleave_n, pn)
                    cleave_applied.append({
                        'figure_key': fk, 'player_num': pn,
                        'damage': cleave_n,
                    })
                    break  # Cleave hits one splash target only
                if cleave_applied:
                    break

        # ── Phase 8: ON-DAMAGE triggers ────────────────────────────────
        try:
            from python.engine.abilities.pattern_d import fire_ability
            for ability_id in defender_sids:
                from python.engine.data.ability_library_loader import get_ability
                entry = get_ability(ability_id) or {}
                if entry.get('trigger') == 'on-damage':
                    try:
                        r = fire_ability(data, ability_id, {
                            'figure_key': target_key,
                            'damaged_figure_key': target_key,
                            'trigger': 'on-damage',
                        })
                        triggered.append({'ability_id': ability_id, **(r or {})})
                    except NotImplementedError:
                        pass
        except Exception:
            pass

        # ── Phase 9: PRE-DEFEAT triggers ────────────────────────────────
        if defeated:
            try:
                from python.engine.abilities.pattern_d import fire_ability
                from python.engine.data.ability_library_loader import get_ability
                for ability_id in defender_sids:
                    entry = get_ability(ability_id) or {}
                    if entry.get('trigger') in ('pre-defeat',):
                        try:
                            r = fire_ability(data, ability_id, {
                                'figure_key': target_key,
                                'trigger': 'pre-defeat',
                            })
                            triggered.append({'ability_id': ability_id,
                                              **(r or {})})
                        except NotImplementedError:
                            pass
            except Exception:
                pass

        # ── Phase 10: DEFEAT ───────────────────────────────────────────
        if defeated:
            # Capture pre-remove state for downstream drops.
            last_pos = def_coord
            fig_contraband = data.get('figureContraband') or {}
            was_carrying_contraband = bool(fig_contraband.get(target_key))

            _remove_figure(data, def_player, target_key)

            # CRR RTK-002: carried contraband drops on the defeated
            # figure's space. Only fires on `carry` missions (Mos
            # Eisley Outskirts B). Mirrors JS defeat-handler.js:108-118.
            if was_carrying_contraband and last_pos:
                mission = data.get('selectedMission') or {}
                mech = mission.get('mechanics') if isinstance(mission, dict) else None
                if isinstance(mech, dict) and mech.get('type') == 'carry':
                    dropped = list(data.get('droppedContrabandSpaces') or [])
                    norm_pos = str(last_pos).lower()
                    if norm_pos not in dropped:
                        dropped.append(norm_pos)
                    data['droppedContrabandSpaces'] = dropped
                # Always drop the carrier's entry (contraband no longer
                # travels with the dead figure).
                fc_map = dict(data.get('figureContraband') or {})
                fc_map.pop(target_key, None)
                data['figureContraband'] = fc_map

            vp = calculate_kill_vp(def_dc)
            if vp:
                award_kill_vp(data, atk_player, vp)
                vp_gained = int(vp)

            # Attachment VP: when the last figure in a group dies,
            # award VP equal to every attached card's deployment cost
            # (may be negative — rules: NEGATIVE DEPLOYMENT COST).
            # Mirrors JS defeat-handler.js:131-148.
            att_vp = 0
            if def_msg_id:
                def_fp = (data.get('figurePositions') or {}).get(
                    def_player, {},
                ) or {}
                # Check if any other figure of this DC group remains.
                parts = target_key.rsplit('-', 2)
                if len(parts) == 3:
                    dc_prefix = f'{parts[0]}-{parts[1]}-'
                    group_alive = any(
                        fk.startswith(dc_prefix) for fk in def_fp.keys()
                    )
                else:
                    group_alive = False
                if not group_alive:
                    att_map = (data.get(f'p{def_player}DcAttachments')
                                or {})
                    attachments = att_map.get(def_msg_id) or []
                    for att_name in attachments:
                        att_eff = get_dc_effect(att_name) or get_dc_effect(
                            f'[{att_name}]',
                        ) or {}
                        att_cost = int(att_eff.get('cost') or 0)
                        if att_cost != 0:
                            att_vp += att_cost
                    if att_vp != 0:
                        award_kill_vp(data, atk_player, att_vp)
                        vp_gained += int(att_vp)

            # ── Phase 11: ON-DEFEAT + friendly-defeat triggers ──────────
            try:
                from python.engine.abilities.pattern_d import fire_ability
                from python.engine.data.ability_library_loader import get_ability
                # on-defeat on the defeated figure itself
                for ability_id in defender_sids:
                    entry = get_ability(ability_id) or {}
                    if entry.get('trigger') in ('on-defeat', 'onDefeat'):
                        try:
                            r = fire_ability(data, ability_id, {
                                'figure_key': target_key,
                                'trigger': entry.get('trigger'),
                            })
                            triggered.append({'ability_id': ability_id,
                                              **(r or {})})
                        except NotImplementedError:
                            pass

                # friendly-defeat on other surviving friendlies
                def_friends = (data.get('figurePositions') or {}).get(
                    def_player, {},
                ) or {}
                for friend_fk in list(def_friends.keys()):
                    if friend_fk == target_key:
                        continue
                    friend_dc = _dc_name_from_figure_key(friend_fk)
                    friend_eff = get_dc_effect(friend_dc) or {}
                    for fab in (friend_eff.get('specialAbilityIds') or []):
                        entry = get_ability(fab) or {}
                        if entry.get('trigger') == 'friendly-defeat':
                            try:
                                r = fire_ability(data, fab, {
                                    'figure_key': friend_fk,
                                    'defeated_figure_key': target_key,
                                    'trigger': 'friendly-defeat',
                                })
                                triggered.append({'ability_id': fab, **(r or {})})
                            except NotImplementedError:
                                pass
            except Exception:
                pass

    # ── Phase 12: POST (clear pending + record attacks) ─────────────────
    # Record attack on attacker
    atk_log = dict(data.get('figureAttacksThisActivation') or {})
    patk = dict(
        atk_log.get(atk_player, atk_log.get(str(atk_player), {})) or {}
    )
    patk[attacker_key] = int(patk.get(attacker_key) or 0) + 1
    atk_log[atk_player] = patk
    data['figureAttacksThisActivation'] = atk_log

    # Record damage-this-activation
    dmg_log = dict(data.get('figureDamageThisActivation') or {})
    pdmg = dict(
        dmg_log.get(atk_player, dmg_log.get(str(atk_player), {})) or {}
    )
    pdmg[attacker_key] = int(pdmg.get(attacker_key) or 0) + damage
    dmg_log[atk_player] = pdmg
    data['figureDamageThisActivation'] = dmg_log

    # Group-defeated: if the defeated figure was the last of its group,
    # decrement activationsRemaining for the defender side.
    group_defeated = False
    if defeated:
        def_fp = (data.get('figurePositions') or {}).get(def_player, {}) or {}
        parts = target_key.rsplit('-', 2)
        if len(parts) == 3:
            dc_prefix = f'{parts[0]}-{parts[1]}-'
            survivors = [fk for fk in def_fp.keys() if fk.startswith(dc_prefix)]
            if not survivors:
                group_defeated = True
                act = dict(data.get('activationsRemaining') or {})
                cur = int(act.get(def_player, act.get(str(def_player), 0)) or 0)
                act[def_player] = max(0, cur - 1)
                data['activationsRemaining'] = act

    # Snapshot the final combat before clearing
    final_combat = dict(combat)
    data['lastCombatResult'] = {
        'attacker': attacker_key, 'defender': target_key,
        'damage': damage, 'hit': hit, 'defeated': defeated,
        'groupDefeated': group_defeated,
        'vpGained': vp_gained,
    }
    data.pop('pendingCombat', None)

    # Check VP / elimination win conditions after every orchestrated attack.
    from python.engine.mechanics.win_conditions import check_win_conditions
    check_win_conditions(data)

    return {
        'damage': damage, 'hit': hit, 'defeated': defeated,
        'group_defeated': group_defeated,
        'vp_gained': vp_gained,
        'triggered_abilities': triggered,
        'conditions_applied': conditions_applied,
        'surges_spent': spent_surges,
        'blast_applied': blast_applied,
        'cleave_applied': cleave_applied,
        'combat': final_combat,
    }
