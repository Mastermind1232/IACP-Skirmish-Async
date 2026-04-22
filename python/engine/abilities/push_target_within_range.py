"""D3.15 — Pattern E push-target-within-range dispatch.

JS firing site: `src/game/abilities.js:296-452`. Single `dcSpecial` +
`pushTargetWithinRange` dispatch path covering THREE chains with shared
library-field-driven behavior:

  - `force_throw`        (E.16 — D3.11) — 1 Strain cost, max 2 from target
  - `wrist_cord`         (E.3  — D3.15) — 2 MP cost, once/round, LOS,
                                           adjacent-to-activator
  - `mandalorian_whip`   (E.15 — D3.15) — LOS, hostile-only,
                                           adjacent-to-activator, max 3 from
                                           target, post-push free attack

D3.15 generalizes the D3.11 force_throw handler into a data-driven dispatcher
that reads the library entry's `pushTargetWithinRange` + `pushLandingEffect`
+ top-level side-effect fields and branches accordingly.
`handle_force_throw` in `force_throw.py` is preserved as a thin alias for
back-compat with D3.11 oracles.

Library field contract (observed in `data/ability-library.json`):

  entry.type == 'dcSpecial'
  entry.label == <str>
  entry.pushTargetWithinRange = {
    range: int,            # max graph-distance from attacker, default 3
    requiresSmall: bool,   # skip LARGE / MASSIVE keyword figures
    requiresLos: bool,     # gate targets by LOS from attacker
    hostileOnly: bool,     # enemies only (skip friendlies pool entirely)
  }
  entry.pushLandingEffect = {          # optional — absent → no Phase-2 gate
    maxDistanceFromTarget: int,        # landing must be within N of target
    mustAdjacentToActivator: bool,     # landing must be exactly 1 from attacker
  }
  entry.strainCostToSelf: int          # Phase-1 Strain paid when ≥1 target
  entry.mpCostToActivate: int          # Phase-3 MP deducted on success
  entry.oncePer: 'round' | None        # informational — ability-gate enforces,
                                        # NOT this handler (mirrors JS)
  entry.postPushFreeAttack: bool       # Phase-3 writes freeAttackBonusPending +
                                        # forcedAttackTarget; log suffix

Phase-3 side effects (library-driven):

  - MP deduction: JS `:331-333`. Deducts from `game.movementBank[msgId].remaining`
    (floor at 0) when `mpCostToActivate` present AND a movement bank entry
    exists for msgId.
  - Free-attack setup: JS `:337-342`. Writes
    `game.freeAttackBonusPending[msgId] = True` +
    `game.forcedAttackTarget[msgId] = target_figure_key`.
  - Log suffix: JS `:345`. Appends ' Now attack that figure (free action).'
    when `postPushFreeAttack`.
  - Spiked Boots guard: JS `:316-327`. Target carrying
    `spiked_boots_snowtrooper` refuses push unless attacker has MASSIVE
    keyword. Ctx threads attacker keywords via `ctx['attacker_keywords']`.
    When attacker keywords absent, guard is permissive (matches JS's
    `(pusherStats?.keywords || [])` short-circuit to empty list; Spiked
    Boots blocks any non-MASSIVE pusher).

Phase-1 gates (library-driven):

  - Candidate pool: JS `:398-406`. Enemies-first, friendlies-second
    (attacker excluded). When `hostileOnly`, friendlies skipped entirely.
  - requiresSmall: JS `:413`. LARGE or MASSIVE keyword → skip.
  - Spiked Boots guard: JS `:415-421`. Applied during enumeration so we
    can't propose an invalid target.
  - Range: JS `:423`. `count_spaces(attacker, target) <= range`.
    Short-circuits when `active_position` is None (JS `if (attackerPos && ...)`).
  - requiresLos: JS `:425-427`. `has_line_of_sight(attacker, target)` must hold.
    Short-circuits when `active_position` or `map_spaces` is None.
  - strainCostToSelf: JS `:432-443`. Paid ONLY when `valid_targets` non-empty
    (pay-on-confirm, not pay-on-trigger).

Phase-2 gates (library-driven):

  - Occupied set: JS `:369-374`. Top-left-only
    (`Object.values(figurePositions)`). Target's own cell removed so it can
    vacate its existing space.
  - maxDistanceFromTarget: JS `:379-381`. `count_spaces(target, coord) <= N`.
    Absent → no gate.
  - mustAdjacentToActivator: JS `:382-384`. `count_spaces(attacker, coord) == 1`
    (EXACTLY 1, not ≤1). Absent → no gate. Short-circuits when
    `active_position` is None.

Return payload shapes (camelCase to mirror JS):

  Phase 1: {'applied': False, 'requiresChoice': True,
            'choiceOptions': [...], 'targetFigureKeys': [...],
            'refreshDcEmbed': bool, 'strainApplied': bool}
           or {'applied': False, 'manualMessage': '...'}

  Phase 2: {'applied': False, 'requiresSpaceChoice': True,
            'validSpaces': [...], 'targetFigureKey': '...',
            'spaceChoiceLabel': '...'}
           or {'applied': False, 'manualMessage': '...'}

  Phase 3: {'applied': True, 'logMessage': '...', 'refreshBoard': True,
            'warnings': [...], 'refreshMovementBank': bool (optional)}

Ctx shape (adds `attacker_keywords` + reuses Force Throw's keys):

  ctx = {
    'player_num':          int, 1 or 2   (REQUIRED — activating player)
    'attacker_figure_key': str | None    (activating figure — excluded from
                                          Phase 1 friendlies pool)
    'active_position':     str | None    (activating figure's top-left; None
                                          disables range/LOS/Phase-2-adj gates,
                                          matching JS `if (attackerPos ...)`)
    'attacker_keywords':   Iterable[str] | None  (attacker's DC keywords — for
                                          Spiked Boots MASSIVE bypass check)
    'attacker_msg_id':     str | None    (msgId for strain-to-self + MP deduct
                                          + free-attack pending writes)
    'chosen_figure_key':   str | None    (Phase 2/3 input — target figure)
    'chosen_space':        str | None    (Phase 3 input — destination coord)
    'map_spaces':          dict | None   (optional override; else loaded via
                                          game.selectedMap.id)
    'dc_health_state':     dict-like | None  (Phase 1 strain-to-self path)
  }
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set

from python.engine.abilities._chain_helpers import resolve_map_spaces
from python.engine.data.ability_library_loader import get_ability
from python.engine.data.dc_effects_loader import get_dc_effects
from python.engine.mechanics.adjacency import count_spaces
from python.engine.mechanics.coords import normalize_coord
from python.engine.mechanics.displacement import (
    _dc_name_from_figure_key,
    compute_push_path_and_warnings,
    push_figure,
)
from python.engine.mechanics.figure_lookup import parse_figure_key
from python.engine.mechanics.los import has_line_of_sight
from python.engine.mechanics.strain import apply_strain_to_figure

_FIGURE_LETTERS = 'abcdefghij'
"""Matches JS `FIGURE_LETTERS` in `src/game/dc-helpers.js:136`."""


def _occupied_topleft_set(game: Dict[str, Any],
                          exclude_coord: Optional[str] = None) -> Set[str]:
    """Top-left-only occupied cells, with optional exclusion.

    Mirrors JS `abilities.js:369-374`. Distinct from Force Push's
    full-footprint `_derive_occupied_set`.
    """
    occ: Set[str] = set()
    poses = (game or {}).get('figurePositions') or {}
    for pn in (1, 2):
        bucket = poses.get(pn) or {}
        for _fk, pos in bucket.items():
            if not pos:
                continue
            occ.add(normalize_coord(pos))
    if exclude_coord is not None:
        occ.discard(normalize_coord(exclude_coord))
    return occ


def _figure_choice_labels(figure_keys: List[str],
                          dc_effects: Dict[str, Any]) -> List[str]:
    """Port of `src/game/dc-helpers.js:figureChoiceLabels`."""
    dc_counts: Dict[str, int] = {}
    for fk in figure_keys:
        dc = _dc_name_from_figure_key(fk)
        dc_counts[dc] = dc_counts.get(dc, 0) + 1
    labels: List[str] = []
    for fk in figure_keys:
        dc = _dc_name_from_figure_key(fk)
        eff = dc_effects.get(dc) or {}
        try:
            figs_count = int(eff.get('figures') or 0)
        except (TypeError, ValueError):
            figs_count = 0
        if dc_counts[dc] > 1 or figs_count > 1:
            parsed = parse_figure_key(fk)
            if parsed is not None:
                _, dg_idx, fig_idx = parsed
                letter = _FIGURE_LETTERS[fig_idx] if 0 <= fig_idx < len(_FIGURE_LETTERS) else 'a'
                labels.append(f"{dc} ({dg_idx}{letter})")
            else:
                labels.append(dc)
        else:
            labels.append(dc)
    return labels


def _target_has_spiked_boots(target_figure_key: str,
                             dc_effects: Dict[str, Any]) -> bool:
    """JS `:319 / :415`. Target carries spiked_boots_snowtrooper passive."""
    dc = _dc_name_from_figure_key(target_figure_key)
    eff = dc_effects.get(dc) or {}
    sids = eff.get('specialAbilityIds') or []
    return 'spiked_boots_snowtrooper' in sids


def _attacker_is_massive(attacker_keywords: Optional[Iterable[str]]) -> bool:
    """JS `:323-324 / :418-419`. Attacker's DC keywords include MASSIVE."""
    if not attacker_keywords:
        return False
    for kw in attacker_keywords:
        if str(kw).upper() == 'MASSIVE':
            return True
    return False


def _spiked_boots_blocks(target_figure_key: str,
                         dc_effects: Dict[str, Any],
                         attacker_keywords: Optional[Iterable[str]]) -> bool:
    """True iff Spiked Boots blocks this push."""
    if not _target_has_spiked_boots(target_figure_key, dc_effects):
        return False
    return not _attacker_is_massive(attacker_keywords)


def _apply_strain_to_self(game: Dict[str, Any],
                          ctx: Dict[str, Any],
                          attacker_figure_key: Optional[str],
                          player_num: int,
                          strain_cost: int) -> bool:
    """Return True iff `strain_cost` strain landed on the attacker.

    Mirrors JS `abilities.js:432-443` — only called AFTER Phase 1 confirms
    ≥1 valid target. Requires ctx `dc_health_state` + `attacker_msg_id`.
    """
    if strain_cost <= 0:
        return False
    dc_health_state = ctx.get('dc_health_state')
    attacker_msg_id = ctx.get('attacker_msg_id')
    if not dc_health_state or not attacker_msg_id or not attacker_figure_key:
        return False
    parsed = parse_figure_key(attacker_figure_key)
    if parsed is None:
        return False
    _, _dg_idx, fig_idx = parsed
    result = apply_strain_to_figure(
        dc_health_state,
        game,
        attacker_msg_id,
        fig_idx,
        attacker_figure_key,
        player_num,
        strain_cost,
    )
    return bool(result.get('applied', 0) > 0)


def _deduct_mp(game: Dict[str, Any], msg_id: Optional[str], mp_cost: int) -> bool:
    """Mirror of JS `:331-333`. Returns True iff MP was actually deducted.

    Writes `game.movementBank[msgId].remaining = max(0, remaining - mp_cost)`.
    No-op when `msg_id` absent or `movementBank[msg_id]` missing (matches
    JS's optional-chaining `game.movementBank?.[msgId]` short-circuit).
    """
    if mp_cost <= 0 or not msg_id:
        return False
    bank = (game or {}).get('movementBank')
    if not isinstance(bank, dict):
        return False
    slot = bank.get(msg_id)
    if not isinstance(slot, dict):
        return False
    remaining = slot.get('remaining')
    if not isinstance(remaining, (int, float)):
        return False
    slot['remaining'] = max(0, int(remaining) - int(mp_cost))
    return True


def _set_free_attack_pending(game: Dict[str, Any],
                             msg_id: Optional[str],
                             target_figure_key: str) -> bool:
    """Mirror of JS `:337-342`. Returns True iff pending keys were written."""
    if not msg_id:
        return False
    if game is None:
        return False
    pending = game.get('freeAttackBonusPending')
    if not isinstance(pending, dict):
        pending = {}
        game['freeAttackBonusPending'] = pending
    pending[msg_id] = True
    forced = game.get('forcedAttackTarget')
    if not isinstance(forced, dict):
        forced = {}
        game['forcedAttackTarget'] = forced
    forced[msg_id] = target_figure_key
    return True


def handle_push_target_within_range(game: Dict[str, Any],
                                    ability_id: str,
                                    ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Data-driven 3-phase push handler. Mirrors `src/game/abilities.js:296-452`.

    Reads the library entry's `pushTargetWithinRange` / `pushLandingEffect`
    / top-level side-effect fields and branches accordingly. Covers
    `force_throw`, `wrist_cord`, and `mandalorian_whip`.
    """
    entry = get_ability(ability_id) or {}
    label: str = entry.get('label') or 'Push'
    ptwr: Dict[str, Any] = entry.get('pushTargetWithinRange') or {}
    ple: Dict[str, Any] = entry.get('pushLandingEffect') or {}
    ptwr_range: int = int(ptwr.get('range', 3))
    requires_small: bool = bool(ptwr.get('requiresSmall', False))
    requires_los: bool = bool(ptwr.get('requiresLos', False))
    hostile_only: bool = bool(ptwr.get('hostileOnly', False))
    must_adj_activator: bool = bool(ple.get('mustAdjacentToActivator', False))
    max_dist_from_target = ple.get('maxDistanceFromTarget')
    strain_cost: int = int(entry.get('strainCostToSelf') or 0)
    mp_cost: int = int(entry.get('mpCostToActivate') or 0)
    post_push_free_attack: bool = bool(entry.get('postPushFreeAttack'))

    if game is None or not ctx.get('player_num'):
        return {
            'applied': False,
            'manualMessage': f'Resolve **{label}** manually.',
        }

    chosen_figure_key = ctx.get('chosen_figure_key')
    chosen_space = ctx.get('chosen_space')
    attacker_figure_key: Optional[str] = ctx.get('attacker_figure_key')
    active_position: Optional[str] = ctx.get('active_position')
    attacker_keywords = ctx.get('attacker_keywords')
    attacker_msg_id: Optional[str] = ctx.get('attacker_msg_id')
    player_num: int = int(ctx['player_num'])
    enemy_pn = 2 if player_num == 1 else 1

    dc_effects = get_dc_effects()

    # ── Phase 3: chosen_figure_key + chosen_space ─────────────────────────
    if chosen_figure_key and chosen_space:
        # Spiked Boots guard — JS `:316-327`.
        if _spiked_boots_blocks(chosen_figure_key, dc_effects, attacker_keywords):
            target_dc = _dc_name_from_figure_key(chosen_figure_key)
            return {
                'applied': False,
                'manualMessage': (
                    f'**Spiked Boots** — **{target_dc}** cannot be pushed '
                    f'except by MASSIVE figures.'
                ),
            }
        pos_p1 = ((game.get('figurePositions') or {}).get(1) or {})
        target_pn = 1 if pos_p1.get(chosen_figure_key) is not None else 2
        push_result = push_figure(game, target_pn, chosen_figure_key, chosen_space)
        if push_result is None:
            old_pos: Optional[str] = None
            dest_lower = normalize_coord(chosen_space)
        else:
            old_pos = push_result['prevPos']
            dest_lower = push_result['newPos']

        mp_deducted = _deduct_mp(game, attacker_msg_id, mp_cost)
        if post_push_free_attack:
            _set_free_attack_pending(game, attacker_msg_id, chosen_figure_key)

        target_dc_name = _dc_name_from_figure_key(chosen_figure_key)
        attacker_dc_name = (
            _dc_name_from_figure_key(attacker_figure_key)
            if attacker_figure_key else label
        )
        map_spaces = resolve_map_spaces(game, ctx)
        map_adjacency = (map_spaces or {}).get('adjacency') if map_spaces else None
        path = compute_push_path_and_warnings(
            game, old_pos, dest_lower, target_pn, map_adjacency,
        )
        old_up = str(old_pos).upper() if old_pos else '?'
        dest_up = str(chosen_space).upper()
        log_msg = (
            f"**{label}** — **{attacker_dc_name}** pushed **{target_dc_name}** "
            f"from {old_up} to {dest_up}{path['path_str']}."
        )
        if post_push_free_attack:
            log_msg += ' Now attack that figure (free action).'
        if path['warnings']:
            warn_list = ', '.join(
                f"**{w['name']}** (exited adj at {w['space']})"
                for w in path['warnings']
            )
            log_msg += (
                f"\n⚠️ Exits adjacency to: {warn_list} — opponent may play "
                f"**Parting Blow** or similar interrupts."
            )
        payload: Dict[str, Any] = {
            'applied': True,
            'logMessage': log_msg,
            'refreshBoard': True,
            'warnings': path['warnings'],
        }
        if mp_deducted:
            payload['refreshMovementBank'] = True
        return payload

    # ── Phase 2: chosen_figure_key only — pick landing ────────────────────
    if chosen_figure_key:
        pos_p1 = ((game.get('figurePositions') or {}).get(1) or {})
        target_pn = 1 if pos_p1.get(chosen_figure_key) is not None else 2
        target_pos = (
            (game.get('figurePositions') or {}).get(target_pn, {}).get(chosen_figure_key)
        )
        if not target_pos:
            return {
                'applied': False,
                'manualMessage': f'**{label}** — target figure has no position.',
            }
        map_spaces = resolve_map_spaces(game, ctx)
        if not map_spaces:
            return {
                'applied': False,
                'manualMessage': (
                    f'**{label}** — map data not available. Resolve manually.'
                ),
            }
        target_pos_norm = normalize_coord(target_pos)
        occ_set = _occupied_topleft_set(game, exclude_coord=target_pos_norm)
        valid_spaces: List[str] = []
        all_coords = map_spaces.get('spaces') or list((map_spaces.get('adjacency') or {}).keys())
        for coord in all_coords:
            coord_norm = normalize_coord(coord)
            if coord_norm in occ_set:
                continue
            if max_dist_from_target is not None:
                if count_spaces(map_spaces, target_pos_norm, coord_norm) > max_dist_from_target:
                    continue
            if must_adj_activator and active_position:
                if count_spaces(map_spaces, active_position, coord_norm) != 1:
                    continue
            valid_spaces.append(coord_norm)
        if not valid_spaces:
            return {
                'applied': False,
                'manualMessage': (
                    f'**{label}** — no valid landing spaces. Resolve manually.'
                ),
            }
        target_dc_name = _dc_name_from_figure_key(chosen_figure_key)
        return {
            'applied': False,
            'requiresSpaceChoice': True,
            'validSpaces': valid_spaces,
            'targetFigureKey': chosen_figure_key,
            'spaceChoiceLabel': (
                f"**{label}** — Pick a landing space for **{target_dc_name}**:"
            ),
        }

    # ── Phase 1: enumerate valid targets ──────────────────────────────────
    map_spaces = resolve_map_spaces(game, ctx)
    poses = (game.get('figurePositions') or {})
    valid_keys: List[str] = []

    candidate_entries: List = []
    for fk, pos in (poses.get(enemy_pn) or {}).items():
        candidate_entries.append((fk, pos, enemy_pn))
    if not hostile_only:
        for fk, pos in (poses.get(player_num) or {}).items():
            if attacker_figure_key is not None and fk == attacker_figure_key:
                continue
            candidate_entries.append((fk, pos, player_num))

    for fk, pos, _pn in candidate_entries:
        if not pos:
            continue
        dc_n = _dc_name_from_figure_key(fk)
        eff = dc_effects.get(dc_n) or {}
        kws = [str(k).upper() for k in (eff.get('keywords') or [])]
        # requiresSmall: skip LARGE and MASSIVE figures.
        if requires_small and ('LARGE' in kws or 'MASSIVE' in kws):
            continue
        # Spiked Boots guard (Phase 1) — JS `:415-421`.
        if _spiked_boots_blocks(fk, dc_effects, attacker_keywords):
            continue
        # Range gate (short-circuits when active_position is None).
        if active_position and map_spaces is not None:
            if count_spaces(map_spaces, active_position, pos) > ptwr_range:
                continue
        # LOS gate (short-circuits when active_position or map_spaces is None).
        if requires_los and active_position and map_spaces is not None:
            if not has_line_of_sight(active_position, pos, map_spaces):
                continue
        valid_keys.append(fk)

    if not valid_keys:
        return {
            'applied': False,
            'manualMessage': (
                f'**{label}** — no valid SMALL targets in range. Resolve manually '
                f'if applicable.'
            ),
        }

    strain_applied = _apply_strain_to_self(
        game, ctx, attacker_figure_key, player_num, strain_cost,
    )
    return {
        'applied': False,
        'requiresChoice': True,
        'choiceOptions': _figure_choice_labels(valid_keys, dc_effects),
        'targetFigureKeys': valid_keys,
        'refreshDcEmbed': strain_applied,
        'strainApplied': strain_applied,
    }
