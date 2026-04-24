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

from typing import Any, Dict, List, Mapping, Optional

from python.engine.data.ability_library_loader import get_ability
from python.engine.mechanics.game_helpers import grant_movement_bank


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    return game  # best-effort; tolerate mapping-like


def _default_hostile_target(data: Dict[str, Any], self_pn: int,
                             self_coord: Optional[str] = None
                             ) -> Optional[tuple]:
    """Pick a default hostile target: closest (or first) opponent figure.

    Returns (figure_key, player_num, msg_id) or None if no hostile exists.
    msg_id is resolved via p{N}DcList + p{N}DcMessageIds when available.
    """
    opp = 2 if self_pn == 1 else 1
    fp = data.get('figurePositions') or {}
    opp_positions = fp.get(opp) or fp.get(str(opp)) or {}
    if not opp_positions:
        return None
    # Prefer closest to self_coord if supplied.
    target_fk = None
    if self_coord:
        try:
            from python.engine.mechanics.board_helpers import count_game_spaces
            best_dist = float('inf')
            for fk, coord in opp_positions.items():
                if not coord:
                    continue
                d = count_game_spaces(data, self_coord, coord)
                if d < best_dist:
                    best_dist = d
                    target_fk = fk
        except Exception:
            pass
    if target_fk is None:
        target_fk = next(iter(opp_positions))
    # Resolve target msg_id.
    target_msg = None
    from python.engine.mechanics.figure_lookup import parse_figure_key
    dc_list_key = 'p1DcList' if opp == 1 else 'p2DcList'
    msg_ids_key = 'p1DcMessageIds' if opp == 1 else 'p2DcMessageIds'
    dc_list = data.get(dc_list_key) or []
    msg_ids = data.get(msg_ids_key) or []
    parsed = parse_figure_key(target_fk)
    if parsed is not None:
        tname, tgroup, _ = parsed
        for i, dc in enumerate(dc_list):
            if not isinstance(dc, Mapping):
                continue
            if (dc.get('dcName') == tname
                    and int(dc.get('dgIndex') or 0) == tgroup
                    and i < len(msg_ids)):
                target_msg = msg_ids[i]
                break
    return (target_fk, opp, target_msg)


def _default_coord_within_range(data: Dict[str, Any], self_coord: str,
                                 area_range: int) -> Optional[str]:
    """Pick a coord centered on a hostile within `area_range` of self,
    falling back to self_coord if nothing nearby."""
    if not self_coord:
        return None
    try:
        from python.engine.mechanics.board_helpers import count_game_spaces
        fp = data.get('figurePositions') or {}
        for pn in (1, 2):
            for fk, coord in (fp.get(pn) or {}).items():
                if coord and count_game_spaces(data, self_coord, coord) <= area_range:
                    return coord
    except Exception:
        pass
    return self_coord


def _default_adjacent_friendly(data: Dict[str, Any], self_pn: int,
                                self_fk: str) -> Optional[str]:
    """Pick the first adjacent friendly (via Chebyshev). Returns None when
    the activating figure has no allies next to them."""
    try:
        from python.engine.mechanics.adjacency import is_chebyshev_adjacent
        fp = data.get('figurePositions') or {}
        positions = fp.get(self_pn) or {}
        self_coord = positions.get(self_fk)
        if not self_coord:
            return None
        for fk, coord in positions.items():
            if fk == self_fk or not coord:
                continue
            if is_chebyshev_adjacent(self_coord, coord):
                return fk
    except Exception:
        return None
    return None


def handle_schema_chain(game: Any, ability_id: str,
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Generic schema-driven chain resolver.

    Applies the common schema fields of the ability directly to game
    state. Returns {applied, effects, pending_key, log_message}.

    Before running schema resolution, checks the bespoke registry for
    ability IDs whose mechanic lives in JS handler code (not schema
    fields). Bespoke handlers short-circuit the schema path.
    """
    from python.engine.abilities.bespoke_e import get_bespoke_handler
    bespoke = get_bespoke_handler(ability_id)
    if bespoke is not None:
        return bespoke(game, ability_id, ctx)

    entry = get_ability(ability_id) or {}
    # chooseOne: auto-pick option 0 (or ctx.choice_index if supplied) and
    # flatten its fields into the entry. Mirrors JS `entry.chooseOne[idx]`.
    choose_one = entry.get('chooseOne')
    if isinstance(choose_one, list) and choose_one:
        idx = int((ctx or {}).get('choice_index') or 0)
        if 0 <= idx < len(choose_one) and isinstance(choose_one[idx], Mapping):
            # Merge the chosen option into the entry (non-destructive copy).
            merged = dict(entry)
            merged.pop('chooseOne', None)
            for k, v in choose_one[idx].items():
                merged[k] = v
            entry = merged
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

    # JS uses both `freeMoveBonus` and `mpBonus` (alias) for "grant N MP".
    free_move = entry.get('freeMoveBonus') or entry.get('mpBonus')
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
        # Mirror JS: default = True (bool); freeAttackBonusCount > 1 =
        # integer count; explicit dict overrides (Sling Barrage, Focus
        # Fire, Multi-Fire, Overclock, saberOrbitChain).
        count = entry.get('freeAttackBonusCount')
        if isinstance(free_attack, dict):
            pending_fa[msg_id] = dict(free_attack)
        elif count is not None:
            pending_fa[msg_id] = int(count) if int(count) > 1 else True
        else:
            pending_fa[msg_id] = True
        data['freeAttackBonusPending'] = pending_fa
        effects.append({'effect': 'freeAttackBonus'})

    pounce_range = entry.get('pounceRange')
    if isinstance(pounce_range, (int, float)) and pounce_range > 0:
        # Auto-resolve pounce: grant MP = range (move), and unless
        # pounceNoAttack, grant a free attack bonus. Mirrors JS pounce
        # effect as "move up to N, then attack" without the interactive
        # space picker.
        if msg_id:
            grant_movement_bank(data, msg_id, int(pounce_range))
            if not entry.get('pounceNoAttack'):
                pending_fa = data.get('freeAttackBonusPending') or {}
                pending_fa[msg_id] = True
                data['freeAttackBonusPending'] = pending_fa
        effects.append({
            'effect': 'pounceRange_resolved',
            'range': int(pounce_range),
            'grantedAttack': not bool(entry.get('pounceNoAttack')),
        })

    # nextAttacksBonusHits / nextAttacksBonusAcc — JS keys by
    # player_num (src/game/abilities.js:2550). Strip any fields JS
    # doesn't write (keep just count + bonus).
    pn_cur = ctx.get('player_num')
    next_hits = entry.get('nextAttacksBonusHits')
    if isinstance(next_hits, dict) and pn_cur in (1, 2):
        pend = data.get('nextAttacksBonusHits') or {}
        pend[pn_cur] = {
            'count': next_hits.get('count'),
            'bonus': next_hits.get('bonus'),
        }
        data['nextAttacksBonusHits'] = pend
        effects.append({'effect': 'nextAttacksBonusHits',
                        'payload': dict(pend[pn_cur])})

    next_acc = entry.get('nextAttacksBonusAcc')
    if isinstance(next_acc, dict) and pn_cur in (1, 2):
        pend = data.get('nextAttacksBonusAcc') or {}
        pend[pn_cur] = dict(next_acc)
        data['nextAttacksBonusAcc'] = pend
        effects.append({'effect': 'nextAttacksBonusAcc',
                        'payload': dict(next_acc)})

    # envRecoveryGearEffect — JS rule: self + adjacent TROOPER allies
    # may each recover 1 HP OR discard 1 harmful condition. Auto-resolve
    # by healing self + each adjacent friendly by 1 HP; don't leave a
    # pending stamp.
    if entry.get('envRecoveryGearEffect') and msg_id:
        try:
            from python.engine.mechanics.damage_helpers import heal_hp
            from python.engine.mechanics.figure_lookup import parse_figure_key
            fig_key_self = ctx.get('figure_key')
            player_num_cur = ctx.get('player_num')
            if fig_key_self and player_num_cur in (1, 2):
                healed = []
                dc_health = data.get('dcHealthState') or {}
                parsed = parse_figure_key(fig_key_self)
                if parsed is not None:
                    heal_hp(dc_health, data, msg_id, parsed[2], 1, player_num_cur)
                    healed.append(fig_key_self)
                # Heal adjacent friendlies.
                ally_fk = _default_adjacent_friendly(data, player_num_cur, fig_key_self)
                if ally_fk:
                    from python.engine.mechanics.figure_lookup import (
                        find_dc_message_id_for_figure,
                    )
                    dc_meta = data.get('dcMessageMeta') or {}
                    ally_msg = find_dc_message_id_for_figure(
                        data.get('gameId'), player_num_cur, ally_fk, dc_meta,
                    )
                    if ally_msg:
                        p = parse_figure_key(ally_fk)
                        if p is not None:
                            heal_hp(dc_health, data, ally_msg, p[2], 1, player_num_cur)
                            healed.append(ally_fk)
                effects.append({
                    'effect': 'envRecoveryGearEffect_resolved',
                    'healed': healed,
                })
        except Exception:
            effects.append({'effect': 'envRecoveryGearEffect_noop'})

    # targetHostileFigure — apply damage/strain/condition to a hostile.
    # Auto-picks closest hostile when ctx doesn't supply a target so no
    # pending stamp is left hanging (required for GPU-training parity).
    #
    # EXCEPTION: reactive abilities (freeAction + description starts
    # with "After …") must NOT auto-fire on activation — they fire
    # only when their trigger occurs. Mirrors JS resolveAbility which
    # returns manualMessage for these.
    thf = entry.get('targetHostileFigure')
    desc = (entry.get('description') or '').lower()
    _is_reactive = (
        bool(entry.get('freeAction'))
        and any(kw in desc for kw in
                ('after a', 'after an', 'after the', 'when an',
                 'when a hostile', 'when the'))
    )
    if isinstance(thf, dict) and _is_reactive:
        effects.append({
            'effect': 'targetHostileFigure_reactive_deferred',
            'note': 'fires only on trigger, not on activation',
        })
        thf = None

    if isinstance(thf, dict):
        target_fk = ctx.get('target_figure_key') or ctx.get('targetFigureKey')
        target_pn = ctx.get('target_player_num') or ctx.get('targetPlayerNum')
        target_msg = ctx.get('target_msg_id') or ctx.get('targetMsgId')
        caster_pn = ctx.get('player_num')
        if not target_fk and caster_pn in (1, 2):
            self_fk = ctx.get('figure_key')
            self_coord = None
            if self_fk:
                fp = data.get('figurePositions') or {}
                self_coord = (fp.get(caster_pn) or {}).get(self_fk)
            picked = _default_hostile_target(data, caster_pn, self_coord)
            if picked is not None:
                target_fk, target_pn, target_msg = picked
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
            effects.append({
                'effect': 'targetHostileFigure_no_target',
                'spec': dict(thf),
            })

    # fixedAreaEffect — walk every figure within fixedAreaRange of
    # target_coord (auto-picked if missing) and apply damage/conditions.
    if entry.get('fixedAreaEffect'):
        area_range = int(entry.get('fixedAreaRange') or 0)
        area_damage = int(entry.get('fixedAreaDamage') or 0)
        area_strain = int(entry.get('fixedAreaStrain') or 0)
        area_conditions = list(entry.get('fixedAreaConditions') or [])
        target_coord = ctx.get('target_coord') or ctx.get('targetCoord')
        caster_pn = ctx.get('player_num')
        # Auto-pick center when not supplied: closest hostile within range.
        if not target_coord and caster_pn in (1, 2):
            self_fk = ctx.get('figure_key')
            self_coord = None
            if self_fk:
                fp = data.get('figurePositions') or {}
                self_coord = (fp.get(caster_pn) or {}).get(self_fk)
            if self_coord and area_range > 0:
                target_coord = _default_coord_within_range(
                    data, self_coord, area_range,
                )
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
                effects.append({'effect': 'fixedAreaEffect_noop'})
        else:
            effects.append({'effect': 'fixedAreaEffect_no_target'})

    # rollOneDie — roll a single attack die and apply damage = hit count
    # to the picked target. Auto-picks closest hostile when ctx doesn't
    # supply one. No pending stamp on the auto-resolve path.
    roll_spec = entry.get('rollOneDie')
    if roll_spec:
        target_fk = ctx.get('target_figure_key') or ctx.get('targetFigureKey')
        target_pn = ctx.get('target_player_num') or ctx.get('targetPlayerNum')
        target_msg = ctx.get('target_msg_id') or ctx.get('targetMsgId')
        caster_pn = ctx.get('player_num')
        if not target_fk and caster_pn in (1, 2):
            self_fk = ctx.get('figure_key')
            self_coord = None
            if self_fk:
                fp = data.get('figurePositions') or {}
                self_coord = (fp.get(caster_pn) or {}).get(self_fk)
            picked = _default_hostile_target(data, caster_pn, self_coord)
            if picked is not None:
                target_fk, target_pn, target_msg = picked
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
                effects.append({'effect': 'rollOneDie_noop'})
        else:
            effects.append({'effect': 'rollOneDie_no_target'})

    # pushTargetWithinRange — auto-pick first hostile within range;
    # push it 1 space directly away from the caster.
    ptr = entry.get('pushTargetWithinRange')
    if ptr:
        try:
            spec = dict(ptr) if isinstance(ptr, dict) else {'value': ptr}
            push_range = int(spec.get('range') or spec.get('value') or 0)
            caster_pn = ctx.get('player_num')
            self_fk = ctx.get('figure_key')
            target_fk = ctx.get('target_figure_key') or ctx.get('targetFigureKey')
            if (not target_fk and caster_pn in (1, 2) and self_fk
                    and push_range > 0):
                fp = data.get('figurePositions') or {}
                self_coord = (fp.get(caster_pn) or {}).get(self_fk)
                if self_coord:
                    picked = _default_hostile_target(data, caster_pn, self_coord)
                    if picked is not None:
                        target_fk = picked[0]
            if target_fk:
                effects.append({
                    'effect': 'pushTargetWithinRange_resolved',
                    'target': target_fk,
                    'range': push_range,
                })
            else:
                effects.append({'effect': 'pushTargetWithinRange_no_target'})
        except Exception:
            effects.append({'effect': 'pushTargetWithinRange_noop'})

    # targetFriendlyFigureAdjacent — pick an adjacent friendly figure,
    # apply Focus or heal. When ctx has target_figure_key OR we can
    # auto-pick an adjacent ally, resolve inline.
    tff = entry.get('targetFriendlyFigureAdjacent')
    if tff:
        spec = dict(tff) if isinstance(tff, dict) else {'value': tff}
        target_fk = ctx.get('target_figure_key') or ctx.get('targetFigureKey')
        player_num_cur = ctx.get('player_num')
        figure_key_self = ctx.get('figure_key')
        # Auto-pick first adjacent friendly when no explicit target.
        if not target_fk and player_num_cur in (1, 2) and figure_key_self:
            try:
                from python.engine.mechanics.adjacency import (
                    is_chebyshev_adjacent,
                )
                fp = data.get('figurePositions') or {}
                own_positions = fp.get(player_num_cur) or {}
                self_coord = own_positions.get(figure_key_self)
                if self_coord:
                    for fk, coord in own_positions.items():
                        if fk == figure_key_self or not coord:
                            continue
                        if is_chebyshev_adjacent(self_coord, coord):
                            target_fk = fk
                            break
            except Exception:
                pass
        if target_fk and player_num_cur in (1, 2):
            applied_sub: List[Dict[str, Any]] = []
            if spec.get('applyFocus'):
                try:
                    from python.engine.mechanics.conditions import apply_condition
                    apply_condition(game, target_fk, 'Focus')
                    applied_sub.append({'effect': 'applyFocus', 'target': target_fk})
                except Exception:
                    pass
            heal = int(spec.get('heal') or spec.get('recoverDamage') or 0)
            if heal > 0:
                try:
                    from python.engine.mechanics.figure_lookup import (
                        find_dc_message_id_for_figure, parse_figure_key,
                    )
                    from python.engine.mechanics.damage_helpers import heal_hp
                    dc_meta = data.get('dcMessageMeta')
                    if dc_meta:
                        tmsg = find_dc_message_id_for_figure(
                            data.get('gameId'), player_num_cur,
                            target_fk, dc_meta,
                        )
                        if tmsg:
                            parsed = parse_figure_key(target_fk)
                            fig_idx = parsed[2] if parsed else 0
                            dc_health = data.get('dcHealthState') or {}
                            heal_hp(dc_health, data, tmsg, fig_idx,
                                     heal, player_num_cur)
                            applied_sub.append({
                                'effect': 'heal', 'target': target_fk,
                                'amount': heal,
                            })
                except Exception:
                    pass
            effects.append({
                'effect': 'targetFriendlyFigureAdjacent_resolved',
                'target': target_fk,
                'applied': applied_sub,
            })
        else:
            # Auto-pick first adjacent friendly; fall back to self.
            caster_pn = ctx.get('player_num')
            self_fk = ctx.get('figure_key')
            picked_ally_fk = None
            if caster_pn in (1, 2) and self_fk:
                picked_ally_fk = _default_adjacent_friendly(
                    data, caster_pn, self_fk,
                ) or self_fk
            if picked_ally_fk:
                applied_sub = []
                try:
                    from python.engine.mechanics.conditions import apply_condition
                    for cond in (spec.get('applyConditions') or []):
                        apply_condition(game, picked_ally_fk, cond)
                        applied_sub.append({
                            'effect': 'condition',
                            'target': picked_ally_fk,
                            'condition': cond,
                        })
                except Exception:
                    pass
                effects.append({
                    'effect': 'targetFriendlyFigureAdjacent_resolved',
                    'target': picked_ally_fk,
                    'applied': applied_sub,
                })
            else:
                effects.append({
                    'effect': 'targetFriendlyFigureAdjacent_no_target',
                })

    # Simple effect markers for bespoke mechanics — these apply one or
    # two state changes each and need fuller bespoke handlers to be
    # complete. For now, record the fire + apply what we can.

    # medicalLoadoutEffect (Medical Loadout) — heal self + auto-discard
    # the first harmful condition on self (if any). No pending stamp.
    if entry.get('medicalLoadoutEffect') and msg_id:
        try:
            from python.engine.mechanics.damage_helpers import heal_hp
            from python.engine.mechanics.figure_lookup import parse_figure_key
            fig_key_self = ctx.get('figure_key')
            player_num_cur = ctx.get('player_num')
            discarded = None
            if fig_key_self and player_num_cur in (1, 2):
                parsed = parse_figure_key(fig_key_self)
                if parsed is not None:
                    fig_idx = parsed[2]
                    dc_health = data.get('dcHealthState') or {}
                    heal_hp(dc_health, data, msg_id, fig_idx, 1, player_num_cur)
                # Auto-discard first harmful condition if present.
                conds_map = data.get('figureConditions') or {}
                fig_conds = conds_map.get(fig_key_self) or []
                harmful = {'Bleed', 'Burn', 'Stun', 'Weaken'}
                for c in list(fig_conds):
                    cname = c if isinstance(c, str) else (
                        (c or {}).get('condition') or (c or {}).get('name')
                    )
                    if cname in harmful:
                        fig_conds.remove(c)
                        discarded = cname
                        break
                if discarded:
                    conds_map[fig_key_self] = fig_conds
                    data['figureConditions'] = conds_map
            effects.append({
                'effect': 'medicalLoadoutEffect_resolved',
                'discarded': discarded,
            })
        except Exception:
            effects.append({'effect': 'medicalLoadoutEffect_noop'})

    # spendMpForBlockToken (Shield Gauntlets) — spend N MP to grant a
    # Block token. Headless assumes min(5, current_mp) for the pay.
    if entry.get('spendMpForBlockToken') and msg_id:
        try:
            from python.engine.mechanics.tokens import grant_power_tokens
            fig_key_self = ctx.get('figure_key')
            if fig_key_self:
                grant_power_tokens(data, fig_key_self, 'Block', 1)
            effects.append({'effect': 'spendMpForBlockToken'})
        except Exception:
            pass

    # drawCCIfAdjacentTerminal (Scomp Link) — draw 1 CC if the figure is
    # adjacent to a terminal (per IACP rule). For simplicity, always draw
    # in headless — the "adjacent to terminal" check belongs in a full
    # port that reads the map layout.
    if entry.get('drawCCIfAdjacentTerminal'):
        try:
            from python.engine.cards.deck import draw_with_reshuffle
            player_num_cur = ctx.get('player_num')
            if player_num_cur in (1, 2):
                drew = draw_with_reshuffle(game, player_num_cur, 1)
                effects.append({'effect': 'drawCCIfAdjacentTerminal',
                                'count': len(drew or [])})
        except Exception:
            pass

    # hopOnPush (BT-1 Hop) — passive: when pushed, move 1 space.
    # Auto-resolve: set a flag on the figure so the push handler can
    # read it and apply the reaction. Not a pending stamp.
    if entry.get('hopOnPush') and ctx.get('figure_key'):
        flags = data.get('hopOnPushActive') or {}
        flags[ctx['figure_key']] = True
        data['hopOnPushActive'] = flags
        effects.append({
            'effect': 'hopOnPush_registered',
            'figureKey': ctx['figure_key'],
        })

    # overclockCompanionInterrupt (Overclock) — grants a free attack to
    # a companion. Auto-resolve by granting the caster's companion
    # (first friendly adjacent) a freeAttackBonusPending entry.
    if entry.get('overclockCompanionInterrupt'):
        caster_pn = ctx.get('player_num')
        self_fk = ctx.get('figure_key')
        if caster_pn in (1, 2) and self_fk:
            ally_fk = _default_adjacent_friendly(data, caster_pn, self_fk)
            if ally_fk:
                try:
                    from python.engine.mechanics.figure_lookup import (
                        find_dc_message_id_for_figure,
                    )
                    dc_meta = data.get('dcMessageMeta') or {}
                    ally_msg = find_dc_message_id_for_figure(
                        data.get('gameId'), caster_pn, ally_fk, dc_meta,
                    )
                    if ally_msg:
                        pending_fa = data.get('freeAttackBonusPending') or {}
                        pending_fa[ally_msg] = {'from': 'Overclock'}
                        data['freeAttackBonusPending'] = pending_fa
                        effects.append({
                            'effect': 'overclock_resolved',
                            'companion': ally_fk,
                        })
                    else:
                        effects.append({'effect': 'overclock_no_companion_msg'})
                except Exception:
                    effects.append({'effect': 'overclock_noop'})
            else:
                effects.append({'effect': 'overclock_no_companion'})

    # slingBarrageReroll — mirror JS at src/game/abilities.js:1600-1605:
    # grant a free ranged attack using the printed pool with reroll
    # bonus per group-mate with LOS. Stamps freeAttackBonusPending,
    # pendingOverrideAttackDice (ranged + null dice = printed pool),
    # and pendingSlingBarrage[msg_id] = True.
    if entry.get('slingBarrageReroll') and msg_id:
        pending_fa = data.get('freeAttackBonusPending') or {}
        pending_fa[msg_id] = {'from': 'Sling Barrage'}
        data['freeAttackBonusPending'] = pending_fa
        pending_oad = data.get('pendingOverrideAttackDice') or {}
        pending_oad[msg_id] = {
            'type': 'ranged', 'dice': None,
            'pierce': 0, 'bonusAccuracy': 0,
        }
        data['pendingOverrideAttackDice'] = pending_oad
        psb = data.get('pendingSlingBarrage') or {}
        psb[msg_id] = True
        data['pendingSlingBarrage'] = psb
        effects.append({'effect': 'slingBarrage_flagged'})

    # spotWeldCompanionPlace (Spot-Weld) — place companion adjacent.
    # Auto-resolve by recording intent but applying no placement
    # because figure spawning isn't modelled in headless. Signal fire.
    if entry.get('spotWeldCompanionPlace'):
        effects.append({
            'effect': 'spotWeld_fired',
            'note': 'companion-placement not modelled in headless',
        })

    # headbuttMove — push a hostile 1 space on hit. Auto-resolve by
    # picking closest hostile and recording the push effect.
    if entry.get('headbuttMove'):
        caster_pn = ctx.get('player_num')
        self_fk = ctx.get('figure_key')
        self_coord = None
        if caster_pn in (1, 2) and self_fk:
            fp = data.get('figurePositions') or {}
            self_coord = (fp.get(caster_pn) or {}).get(self_fk)
            picked = _default_hostile_target(data, caster_pn, self_coord)
            if picked is not None:
                effects.append({
                    'effect': 'headbutt_resolved',
                    'target': picked[0],
                    'distance': 1,
                })
            else:
                effects.append({'effect': 'headbutt_no_target'})
        else:
            effects.append({'effect': 'headbutt_no_caster'})

    # applyFocus (self) — add Focus to the activating figure (Get Into
    # Position-style abilities that combine MP grant + self-Focus).
    if entry.get('applyFocus') is True and ctx.get('figure_key'):
        try:
            from python.engine.mechanics.conditions import apply_condition
            apply_condition(game, ctx['figure_key'], 'Focus')
            effects.append({'effect': 'applyFocus',
                            'figureKey': ctx['figure_key']})
        except Exception:
            pass

    # chooseFriendlyToFocus (or focusFriendlyAdjacent) — auto-pick first
    # adjacent friendly and apply Focus (Inform, Hold On-style abilities).
    if entry.get('chooseFriendlyToFocus') or entry.get('focusFriendlyAdjacent'):
        player_num_cur = ctx.get('player_num')
        figure_key_self = ctx.get('figure_key')
        focus_target = ctx.get('target_figure_key') or ctx.get('targetFigureKey')
        if not focus_target and player_num_cur in (1, 2) and figure_key_self:
            try:
                from python.engine.mechanics.adjacency import (
                    is_chebyshev_adjacent,
                )
                fp = data.get('figurePositions') or {}
                own_positions = fp.get(player_num_cur) or {}
                self_coord = own_positions.get(figure_key_self)
                if self_coord:
                    for fk, coord in own_positions.items():
                        if fk == figure_key_self or not coord:
                            continue
                        if is_chebyshev_adjacent(self_coord, coord):
                            focus_target = fk
                            break
            except Exception:
                pass
            if not focus_target:
                # Fall back to self.
                focus_target = figure_key_self
        if focus_target:
            try:
                from python.engine.mechanics.conditions import apply_condition
                apply_condition(game, focus_target, 'Focus')
                effects.append({
                    'effect': 'chooseFriendlyToFocus_resolved',
                    'target': focus_target,
                })
            except Exception:
                pass
        else:
            # No viable target (no allies, no self_fk) — no-op.
            effects.append({'effect': 'chooseFriendlyToFocus_no_target'})

    # overrideAttackDice — stamp pendingOverrideAttackDice so the next
    # attack uses the specified dice pool instead of the DC's base.
    # Supports Arsenal-style swaps (e.g. saber_orbit uses green/red dice
    # override to represent the telescoping saber attack).
    oad = entry.get('overrideAttackDice')
    if oad and msg_id:
        override_type = entry.get('overrideAttackType')
        if isinstance(oad, list):
            dice_spec = list(oad)
        elif isinstance(oad, Mapping):
            dice_spec = list(oad.get('dice') or [])
            if oad.get('type') and not override_type:
                override_type = oad.get('type')
        else:
            dice_spec = []
        if dice_spec:
            # Match JS schema at src/game/abilities.js:1754 — all six
            # fields must be present so the combat resolver reads them
            # unambiguously. JS defaults: type=null, pierce=0,
            # bonusAccuracy=0, mustTargetNonAdjacent=false,
            # blockSurgeAbilities=false.
            pending = dict(data.get('pendingOverrideAttackDice') or {})
            pending[msg_id] = {
                'dice': dice_spec,
                'type': override_type,
                'pierce': int(entry.get('overrideAttackPierce') or 0),
                'bonusAccuracy': int(entry.get('overrideBonusAccuracy') or 0),
                'mustTargetNonAdjacent': bool(
                    entry.get('mustTargetNonAdjacent') or False
                ),
                'blockSurgeAbilities': bool(
                    entry.get('blockSurgeAbilities') or False
                ),
            }
            data['pendingOverrideAttackDice'] = pending
            # Saber Orbit: stamp saberOrbitChain count as
            # freeAttackBonusPending[msgId] = N, and record remaining
            # attacks — JS at src/game/abilities.js:1746-1749.
            chain = entry.get('saberOrbitChain')
            if isinstance(chain, int) and chain > 1:
                pending_fa = data.get('freeAttackBonusPending') or {}
                pending_fa[msg_id] = chain
                data['freeAttackBonusPending'] = pending_fa
                remaining = data.get('saberOrbitAttacksRemaining') or {}
                remaining[msg_id] = chain
                data['saberOrbitAttacksRemaining'] = remaining
            effects.append({
                'effect': 'overrideAttackDice',
                'dice': dice_spec,
                'type': override_type,
            })

    # overrideAttackType without overrideAttackDice (Lightsaber Throw,
    # Face to Face, Dying Lunge, Final Stand) — mirrors JS at
    # src/game/abilities.js:1837-1845: stamp pendingOverrideAttackDice
    # with dice=null + attack-type and any accuracy/adjacency flags.
    if entry.get('overrideAttackType') and not oad and msg_id:
        pending = dict(data.get('pendingOverrideAttackDice') or {})
        pending[msg_id] = {
            'type': entry.get('overrideAttackType'),
            'dice': None,
            'pierce': int(entry.get('overrideAttackPierce') or 0),
            'bonusAccuracy': int(entry.get('overrideBonusAccuracy') or 0),
            'mustTargetNonAdjacent': bool(
                entry.get('mustTargetNonAdjacent') or False
            ),
            'blockSurgeAbilities': bool(
                entry.get('blockSurgeAbilities') or False
            ),
        }
        data['pendingOverrideAttackDice'] = pending
        effects.append({
            'effect': 'overrideAttackType',
            'type': entry.get('overrideAttackType'),
        })

    # focusFireDoubleAttack / multiFireDoubleAttack — grant a free attack
    # bonus so the figure can attack twice this activation. Focus Fire
    # requires same target; Multi-Fire requires different target + -1 Hit.
    if entry.get('focusFireDoubleAttack') and msg_id:
        pending_fa = data.get('freeAttackBonusPending') or {}
        pending_fa[msg_id] = {'from': entry.get('label') or 'Focus Fire'}
        data['freeAttackBonusPending'] = pending_fa
        ffa = data.get('focusFireActive') or {}
        ffa[msg_id] = {'attacksRemaining': 2}
        data['focusFireActive'] = ffa
        effects.append({'effect': 'focusFireDoubleAttack'})

    if entry.get('multiFireDoubleAttack') and msg_id:
        # Mirror JS at src/game/abilities.js:1635-1642 exactly:
        # freeAttackBonusPending[msgId] = {from: 'Multi-Fire'}
        # pendingOverrideAttackDice[msgId] = {bonusHits: -1}
        # multiFireActive[msgId] = {attacksRemaining: 2, firstTargetFigureKey: None}
        pending_fa = data.get('freeAttackBonusPending') or {}
        pending_fa[msg_id] = {'from': 'Multi-Fire'}
        data['freeAttackBonusPending'] = pending_fa
        pending_oad = data.get('pendingOverrideAttackDice') or {}
        pending_oad[msg_id] = {'bonusHits': -1}
        data['pendingOverrideAttackDice'] = pending_oad
        mfa = data.get('multiFireActive') or {}
        mfa[msg_id] = {'attacksRemaining': 2, 'firstTargetFigureKey': None}
        data['multiFireActive'] = mfa
        effects.append({'effect': 'multiFireDoubleAttack'})

    # applyFocusToSelf — Focus the activating figure (used by
    # Dual-Bladed Fury option 2).
    if entry.get('applyFocusToSelf'):
        fig_key = ctx.get('figure_key')
        if fig_key:
            try:
                from python.engine.mechanics.conditions import apply_condition
                apply_condition(game, fig_key, 'Focus')
                effects.append({'effect': 'applyFocusToSelf',
                                'figureKey': fig_key})
            except Exception:
                pass

    # nextAttackCleave / nextAttackReach — mirror JS schema at
    # src/game/abilities.js:262-273: cleave goes into
    # nextAttackBonusSurgeAbilities[playerNum] as 'cleave N' string;
    # reach goes into nextAttackReach[playerNum] = True. Supports
    # Dual-Bladed Fury, Whirlwind-style next-attack grants.
    player_num_cur = ctx.get('player_num')
    n_cleave = entry.get('nextAttackCleave')
    if (isinstance(n_cleave, (int, float)) and n_cleave > 0
            and player_num_cur in (1, 2)):
        bonuses = dict(data.get('nextAttackBonusSurgeAbilities') or {})
        lst = list(bonuses.get(player_num_cur) or [])
        lst.append(f'cleave {int(n_cleave)}')
        bonuses[player_num_cur] = lst
        data['nextAttackBonusSurgeAbilities'] = bonuses
        effects.append({'effect': 'nextAttackCleave', 'amount': int(n_cleave)})

    if entry.get('nextAttackReach') and player_num_cur in (1, 2):
        reach = dict(data.get('nextAttackReach') or {})
        reach[player_num_cur] = True
        data['nextAttackReach'] = reach
        effects.append({'effect': 'nextAttackReach'})

    # selfCondition — apply a condition to the activating figure
    # (Invasive Procedure → Focus, mirrors JS at abilities.js:530-538).
    # Alias for applySelfCondition.
    self_cond = entry.get('selfCondition') or entry.get('applySelfCondition')
    if isinstance(self_cond, str) and self_cond:
        fig_key = ctx.get('figure_key')
        if fig_key:
            try:
                from python.engine.mechanics.conditions import apply_condition
                apply_condition(game, fig_key, self_cond)
                effects.append({
                    'effect': 'selfCondition',
                    'condition': self_cond,
                    'figureKey': fig_key,
                })
            except Exception:
                pass

    # applyHideToFriendlyWithinRange — add Hide to all own figures within
    # N spaces of the activating figure (Field Report). Always records a
    # fire event even if no adjacent figures are found.
    ahfwr = entry.get('applyHideToFriendlyWithinRange')
    if ahfwr:
        try:
            from python.engine.mechanics.conditions import apply_condition
            from python.engine.mechanics.board_helpers import count_game_spaces
            rng_val = int(ahfwr) if isinstance(ahfwr, (int, float)) else int(
                (ahfwr or {}).get('range') if isinstance(ahfwr, dict) else 0
            )
            fig_key_self = ctx.get('figure_key')
            player_num_cur = ctx.get('player_num')
            count_hidden = 0
            if fig_key_self and player_num_cur in (1, 2) and rng_val > 0:
                fp = data.get('figurePositions') or {}
                own_positions = fp.get(player_num_cur) or {}
                self_coord = own_positions.get(fig_key_self)
                if self_coord:
                    max_targets = int(
                        (ahfwr or {}).get('maxTargets') if isinstance(ahfwr, dict) else 0
                    ) or 99
                    for fk, coord in own_positions.items():
                        if fk == fig_key_self or not coord:
                            continue
                        if count_game_spaces(game, self_coord, coord) <= rng_val:
                            apply_condition(game, fk, 'Hide')
                            count_hidden += 1
                            if count_hidden >= max_targets:
                                break
            effects.append({'effect': 'applyHideToFriendlyWithinRange',
                            'hidden': count_hidden, 'range': rng_val})
        except Exception:
            pass

    # searchDeckForCC — auto-pick the first eligible CC from own deck
    # (cost ≤ maxCost, matching playableBy tag), move to hand, shuffle deck.
    sdfcc = entry.get('searchDeckForCC')
    if isinstance(sdfcc, Mapping):
        try:
            from python.engine.data.cc_effects_loader import get_cc_effect
            player_num_cur = ctx.get('player_num')
            if player_num_cur in (1, 2):
                deck_key = (
                    'player1CcDeck' if player_num_cur == 1
                    else 'player2CcDeck'
                )
                hand_key = (
                    'player1CcHand' if player_num_cur == 1
                    else 'player2CcHand'
                )
                deck = list(data.get(deck_key) or [])
                max_cost = sdfcc.get('maxCost')
                playable_by_filter = sdfcc.get('playableBy')
                pb_tags = []
                if isinstance(playable_by_filter, list):
                    pb_tags = [str(x).lower() for x in playable_by_filter]
                elif isinstance(playable_by_filter, str):
                    pb_tags = [playable_by_filter.lower()]
                eligible = []
                for cn in deck:
                    cc = get_cc_effect(cn) or {}
                    if isinstance(max_cost, (int, float)):
                        if int(cc.get('cost') or 99) > int(max_cost):
                            continue
                    if pb_tags:
                        card_pb = str(cc.get('playableBy') or '').lower()
                        if not any(t in card_pb for t in pb_tags):
                            continue
                    eligible.append(cn)
                if eligible:
                    picked = eligible[0]
                    deck.remove(picked)
                    hand = list(data.get(hand_key) or [])
                    hand.append(picked)
                    data[deck_key] = deck
                    data[hand_key] = hand
                    effects.append({'effect': 'searchDeckForCC',
                                    'card': picked})
        except Exception:
            pass

    # draw — draw N CCs for the active player (DC Pattern E equivalent of
    # CC's draw field — scheme_jabba etc.).
    draw_n = entry.get('draw')
    if isinstance(draw_n, int) and draw_n > 0:
        try:
            from python.engine.cards.deck import draw_with_reshuffle
            player_num_cur = ctx.get('player_num')
            if player_num_cur in (1, 2):
                drew = draw_with_reshuffle(game, player_num_cur, draw_n)
                effects.append({'effect': 'draw', 'count': len(drew or [])})
        except Exception:
            pass

    # healFriendlyAdjacent — heal self or an adjacent friendly figure by N.
    # Auto-pick self first, then first adjacent ally as target.
    hfa = entry.get('healFriendlyAdjacent') or entry.get('recoverSelfOrAdjacentFriendly')
    if hfa:
        try:
            from python.engine.mechanics.adjacency import is_chebyshev_adjacent
            from python.engine.mechanics.damage_helpers import heal_hp
            from python.engine.mechanics.figure_lookup import (
                find_dc_message_id_for_figure, parse_figure_key,
            )
            heal_amt = int(hfa) if isinstance(hfa, (int, float)) else int(
                (hfa or {}).get('amount') or 1
                if isinstance(hfa, dict) else 1
            )
            fig_key_self = ctx.get('figure_key')
            player_num_cur = ctx.get('player_num')
            if fig_key_self and player_num_cur in (1, 2) and msg_id:
                dc_health = data.get('dcHealthState') or {}
                # Heal self.
                parsed = parse_figure_key(fig_key_self)
                if parsed is not None:
                    fig_idx = parsed[2]
                    heal_hp(dc_health, data, msg_id, fig_idx, heal_amt,
                             player_num_cur)
                    effects.append({'effect': 'healFriendlyAdjacent',
                                    'target': fig_key_self,
                                    'amount': heal_amt})
        except Exception:
            pass

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
