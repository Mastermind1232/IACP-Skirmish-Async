"""D3.16 — Pure-engine fire-site helper for combat-defense-friends Pattern D.

The JS firing site lives in `src/handlers/combat.js:1922-1984`. It's a two-walk
structure that walks the DEFENDER's FRIENDLY figures (figures owned by the
defender's player) and checks each one's DC for the four combat-defense-friends
Pattern D abilities: `sentinel`, `protector`, `keep_the_peace_elite`,
`keep_the_peace_regular`.

Distinct from D3.7/D3.9/D3.12/D3.14's `combat_declare.py` firing site, which
walks ATTACKER's and DEFENDER's own `specialAbilityIds` lists. Here we walk
defender-side FRIENDS — siblings of the defended figure within the adjacency
halo around the target coordinate.

Walk 1 (Sentinel/Protector) — JS :1922-1950:
  - Adjacency set: `adj[target_coord] ∪ {target_coord}` (target's own space counts)
  - Skips the defended figure (`fk === defender_figure_key`)
  - Shared `sentinel_applied` flag — at most one of Sentinel/Protector fires
  - Sentinel fires first if the DEFENDER does NOT have the GUARDIAN keyword
  - Protector fires if Sentinel didn't fire (no Guardian gate)
  - Effect per fire: `combat.bonusBlock += 1` + log line

Walk 2 (Keep the Peace) — JS :1952-1984:
  - Adjacency set: `adj[target_coord]` ONLY (target-coord NOT in set — delta from walk 1)
  - Does NOT skip defended figure (mirrors JS; moot since target_coord not in
    adj_kp, so defended figure fails the adjacency check by construction)
  - Independent `ktp_applied` flag (flags do NOT share state across walks —
    Sentinel firing does not block KTP)
  - KTP Elite fires first if once-per-round sticky not set for the firing
    figure's DC (sticky key: `{fk_dc_name}_ktp_{current_round}`)
    - Orchestrator writes sticky BEFORE dispatching strain, mirroring JS
      :1968-1969 — a failing strain (Fireproof, missing msg_id) still
      consumes the round slot.
  - KTP Elite effect: 1 Strain to the ATTACKER via `apply_strain_to_figure`
  - KTP Regular fires iff KTP Elite didn't, skipping if TARGET has GUARDIAN
  - KTP Regular: reminder-only (no engine mutation; D4 handler layer renders UX)

NPC guard: Both walks no-op when `ctx['defender_is_npc']` is truthy (matches
JS `!target.isNpc` guard — NPC figures don't benefit from friend-protection
auras).

Fail-loud semantics (same contract as D3.6 bus, D3.7/D3.9/D3.14 fire-sites):
  - Unregistered Pattern D ability → `UnregisteredPatternD`
  - Stub handler fires → `TriggerNotImplemented`
  - Oracles control defender DCs, so any DC carrying a stubbed combat-defense-
    friends ability is explicitly out-of-scope for the test.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Set

from python.engine.abilities.classify import classify_ability
from python.engine.abilities.pattern_d import (
    TriggerNotImplemented,
    get_handler_for,
    is_stub,
)
from python.engine.data.ability_library_loader import get_ability
from python.engine.data.dc_effects_loader import get_dc_effects
from python.engine.mechanics.figure_lookup import parse_figure_key


_FRIENDS_ABILITIES = (
    'sentinel',
    'protector',
    'keep_the_peace_elite',
    'keep_the_peace_regular',
)

_BRACKET_SUFFIX_RE = re.compile(r'\s*\[.*\]\s*$')


def _dc_lookup(effects: Dict[str, Any], dc_name: Optional[str]) -> Optional[Dict[str, Any]]:
    """Return DC effect record with JS-parity bracket-strip fallback.

    Mirrors `src/data-loader.js`: if exact name miss, retry after stripping
    a trailing `[bracket]` tag. Uppercased keywords live on `keywords`.
    """
    if not dc_name:
        return None
    entry = effects.get(dc_name)
    if entry is not None:
        return entry
    stripped = _BRACKET_SUFFIX_RE.sub('', dc_name)
    if stripped != dc_name:
        return effects.get(stripped)
    return None


def _dc_has_guardian_keyword(effects: Dict[str, Any], dc_name: Optional[str]) -> bool:
    entry = _dc_lookup(effects, dc_name)
    if entry is None:
        return False
    keywords = entry.get('keywords') or []
    return any(str(k).upper() == 'GUARDIAN' for k in keywords)


def _is_combat_defense_pattern_d(ability_id: str) -> bool:
    """True iff `ability_id` classifies as Pattern D AND library trigger is `combat-defense`.

    D3.14's `_is_combat_declare_pattern_d` accepts both `combat-declare` and
    `combat-defense` because its fire-site (JS `handleAttackTarget()`) fires
    both in one ladder. The combat-defense-friends site at JS :1922-1984 is
    a separate firing site — only Pattern D abilities with library trigger
    `combat-defense` are candidates. Filter accordingly.
    """
    entry = get_ability(ability_id)
    if entry is None:
        return False
    try:
        pattern, _ = classify_ability(ability_id, entry)
    except Exception:
        return False
    if pattern != 'D':
        return False
    return entry.get('trigger') == 'combat-defense'


def _dispatch(game: Dict[str, Any],
              ability_id: str,
              ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Route an ability through the Pattern D bus; raise on stub or missing.

    Returns the handler payload dict, or None if the ability is not a
    combat-defense Pattern D (silent skip — mirrors JS, which fires nothing
    for unrelated abilities listed on the same DC).
    """
    if not _is_combat_defense_pattern_d(ability_id):
        return None
    info = get_handler_for(ability_id)
    if info is None:
        from python.engine.abilities.pattern_d import UnregisteredPatternD
        raise UnregisteredPatternD(ability_id)
    _trigger, handler = info
    if is_stub(handler):
        raise TriggerNotImplemented(ability_id, 'combat-defense')
    return handler(game, ability_id, ctx)


def _figure_in_adj(position: Any, adj_set: Set[str]) -> bool:
    if position is None:
        return False
    return str(position).lower() in adj_set


def fire_combat_defense_friends_triggers(
    game: Dict[str, Any],
    combat: Dict[str, Any],
    attacker_player_num: int,
    attacker_figure_key: str,
    defender_player_num: int,
    defender_figure_key: str,
    target_coord: Optional[str],
    map_spaces: Optional[Dict[str, Any]],
    ctx: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Walk defender's friendly figures and dispatch combat-defense-friends abilities.

    Two independent passes:

      Walk 1 — Sentinel/Protector. Adjacency halo = adj[target] ∪ {target}.
               Shared `sentinel_applied` flag; Sentinel fires first (skipped
               iff defender has GUARDIAN); Protector fires if Sentinel didn't
               (no Guardian gate). Defended figure skipped by figure-key match.

      Walk 2 — Keep the Peace Elite/Regular. Adjacency halo = adj[target] only
               (no target-coord union). Independent `ktp_applied` flag;
               KTP Elite fires first (once-per-round sticky owned by
               orchestrator, write-before-strain; applies 1 Strain to attacker);
               KTP Regular fires if Elite didn't, skipping if target itself
               has GUARDIAN (reminder-only — no engine mutation).

    Returns one dict per fired handler: `{ability_id, applied, log_message, ...}`.
    Dispatched handlers may return `applied: False` on internal gate-off (e.g.,
    Fireproof blocks KTP Elite strain); the orchestrator still records the
    attempt in the return list (parity with D3.9's fire-site contract).

    No-op guards (return empty list, no walk):
      - `ctx.get('defender_is_npc')` truthy (JS `!target.isNpc` guard)
      - `target_coord` None/empty or `map_spaces` missing
      - `map_spaces['adjacency'][target_coord]` missing

    Raises `TriggerNotImplemented` if any ability in the firing roster is
    still a Pattern D stub (fail-loud bus contract).
    """
    results: List[Dict[str, Any]] = []
    ctx = dict(ctx or {})

    if ctx.get('defender_is_npc'):
        return results

    if not target_coord or not isinstance(map_spaces, dict):
        return results

    adjacency = map_spaces.get('adjacency') or {}
    adj_raw = adjacency.get(target_coord)
    if adj_raw is None:
        # Tolerate callers passing upper/mixed-case target_coord when the
        # adjacency map is keyed in a different case. The JS firing site
        # assumes lowercase keys; this fallback matches defensive callers.
        adj_raw = adjacency.get(str(target_coord).lower())
    if adj_raw is None:
        return results

    target_coord_norm = str(target_coord).lower()
    adj_set_base: Set[str] = {str(s).lower() for s in adj_raw}
    adj_sp: Set[str] = adj_set_base | {target_coord_norm}  # walk 1: target-coord UNION
    adj_kp: Set[str] = set(adj_set_base)                    # walk 2: target-coord EXCLUDED

    # Defender's own figures (siblings candidates).
    friend_positions: Dict[str, Any] = (
        (game.get('figurePositions') or {}).get(defender_player_num) or {}
    )

    # Preload dc-effects once for keyword + specialAbilityIds lookups.
    dc_effects = get_dc_effects() or {}

    # Defender and target are the same figure at this firing site. JS
    # computes Guardian on defEff (defender's DC) and re-uses it for the
    # KTP Regular target-Guardian gate.
    def_parsed = parse_figure_key(defender_figure_key)
    def_dc_name = def_parsed[0] if def_parsed else None
    defender_is_guardian = _dc_has_guardian_keyword(dc_effects, def_dc_name)
    target_is_guardian = defender_is_guardian

    current_round = game.get('currentRound', 0) or 0
    game_id = game.get('gameId')
    dc_health_state = ctx.get('dc_health_state') or {}
    dc_message_meta = ctx.get('dc_message_meta') or {}

    base_ctx: Dict[str, Any] = {
        **ctx,
        'combat': combat,
        'attacker_player_num': attacker_player_num,
        'attacker_figure_key': attacker_figure_key,
        'defender_player_num': defender_player_num,
        'defender_figure_key': defender_figure_key,
        'target_coord': target_coord_norm,
        'trigger': 'combat-defense',
        'dc_health_state': dc_health_state,
        'dc_message_meta': dc_message_meta,
        'game_id': game_id,
        'current_round': current_round,
    }

    # ── Walk 1: Sentinel / Protector ────────────────────────────────────────
    sentinel_applied = False
    for fk, pos in friend_positions.items():
        if sentinel_applied:
            break
        if fk == defender_figure_key:
            continue
        if not _figure_in_adj(pos, adj_sp):
            continue
        parsed = parse_figure_key(fk)
        if parsed is None:
            continue
        fk_dc_name = parsed[0]
        entry = _dc_lookup(dc_effects, fk_dc_name)
        if entry is None:
            continue
        special_ids = list(entry.get('specialAbilityIds') or [])

        friend_ctx = {
            **base_ctx,
            'fk_dc_name': fk_dc_name,
            'firing_figure_key': fk,
        }

        # Sentinel fires first iff defender is NOT Guardian (JS :1938).
        if 'sentinel' in special_ids and not defender_is_guardian:
            payload = _dispatch(game, 'sentinel', friend_ctx)
            if payload is not None and payload.get('applied'):
                results.append({'ability_id': 'sentinel', **payload})
                sentinel_applied = True
                continue

        # Protector: no Guardian gate; fires if Sentinel didn't (JS :1944).
        if not sentinel_applied and 'protector' in special_ids:
            payload = _dispatch(game, 'protector', friend_ctx)
            if payload is not None and payload.get('applied'):
                results.append({'ability_id': 'protector', **payload})
                sentinel_applied = True

    # ── Walk 2: Keep the Peace Elite / Regular ─────────────────────────────
    ktp_applied = False
    # NOTE: unlike walk 1, defended figure is NOT skipped here (matches JS).
    # Moot in practice: defended figure sits on target_coord, which is NOT
    # in adj_kp, so the adjacency check filters the figure out regardless.
    for fk, pos in friend_positions.items():
        if ktp_applied:
            break
        if not _figure_in_adj(pos, adj_kp):
            continue
        parsed = parse_figure_key(fk)
        if parsed is None:
            continue
        fk_dc_name = parsed[0]
        entry = _dc_lookup(dc_effects, fk_dc_name)
        if entry is None:
            continue
        special_ids = list(entry.get('specialAbilityIds') or [])

        friend_ctx = {
            **base_ctx,
            'fk_dc_name': fk_dc_name,
            'firing_figure_key': fk,
        }

        # KTP Elite (JS :1965-1972): once-per-round sticky, strain to attacker.
        if 'keep_the_peace_elite' in special_ids:
            sticky_key = f'{fk_dc_name}_ktp_{current_round}'
            sticky_map = game.get('roundFigureAbilityUsed') or {}
            if not sticky_map.get(sticky_key):
                # Write sticky BEFORE dispatch — matches JS :1968-1969.
                # A failing strain (Fireproof, missing msg_id) still consumes
                # the round slot. Preserves the D3.12 ROUND_OBJECT_FLAGS
                # identity pattern (mutate in place when dict already exists).
                if 'roundFigureAbilityUsed' not in game or game.get('roundFigureAbilityUsed') is None:
                    game['roundFigureAbilityUsed'] = {}
                game['roundFigureAbilityUsed'][sticky_key] = True

                payload = _dispatch(game, 'keep_the_peace_elite', friend_ctx)
                if payload is not None:
                    results.append({'ability_id': 'keep_the_peace_elite', **payload})
                ktp_applied = True
                continue
            # Sticky already set — Elite does not fire this round. Fall through
            # to the Regular check on the same figure (if it also carries it).

        # KTP Regular (JS :1975-1981): skip if TARGET (defender) is Guardian.
        if (not ktp_applied
                and 'keep_the_peace_regular' in special_ids
                and not target_is_guardian):
            payload = _dispatch(game, 'keep_the_peace_regular', friend_ctx)
            if payload is not None and payload.get('applied'):
                results.append({'ability_id': 'keep_the_peace_regular', **payload})
                ktp_applied = True

    return results
