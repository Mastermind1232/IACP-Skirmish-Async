"""D3.17 — Pattern E.5 Barrage (two-attack sequence, shared msgId state).

JS firing topology: Barrage is NOT a 3-phase choice chain like Force Push or
Hop On. It's a **state-flag mutator** split across 4 firing sites, one per
lifecycle moment of the two-attack sequence. The pure engine ports the flag
mutations; the full combat runs use `compute_combat_result` (Slice 4) against
a pre-assembled `combat` dict — defense-pool assembly itself (the +1 white
die on the second attack) lives in the D4 handler layer, which is why the
handler exposes `barrage_defense_pool_extra_die(combat)` as a helper for the
handler to consult when building the defense pool.

**JS firing sites** (pinned exact — no code invented):

  1. `src/game/abilities.js:1827-1831` — declare:
       ```js
       if (entry.label === 'Barrage') {
         game.barrageSecondAttack = game.barrageSecondAttack || {};
         game.barrageSecondAttack[msgId] = true;
       }
       ```

  2. `src/engine/combat-bridge.js:1499-1514` — after first attack resolves:
       ```js
       if (game.barrageSecondAttack?.[combat.attackerMsgId]) {
         delete game.barrageSecondAttack[combat.attackerMsgId];
         game.freeAttackBonusPending = game.freeAttackBonusPending || {};
         game.freeAttackBonusPending[combat.attackerMsgId] = true;
         const _pos = game.figurePositions?.[defenderPlayerNum]?.[combat.target?.figureKey];
         if (_pos) {
           game.barrageTargetSpace = game.barrageTargetSpace || {};
           game.barrageTargetSpace[combat.attackerMsgId] = _pos;
         }
         game.barrageDefenseBonus = game.barrageDefenseBonus || {};
         game.barrageDefenseBonus[combat.attackerMsgId] = true;
         await thread.send('**Barrage** — You may perform a second attack ...');
       }
       ```

  3. `src/handlers/combat.js:1512-1516` — before second attack resolves:
       ```js
       if (game.barrageDefenseBonus?.[msgId]) {
         game.pendingCombat.barrageAttack = true;
         delete game.barrageDefenseBonus[msgId]; // consumed
       }
       ```

  4. `src/handlers/dc-play-area.js:1137-1143` — second-attack target gate:
       ```js
       if (game.barrageTargetSpace?.[msgId]) {
         const _barrageSpace = game.barrageTargetSpace[msgId];
         const _barrageFiltered = targets.filter(
           t => countSpaces(ms, _barrageSpace, t.coord, closedDoorEdges) <= 3);
         if (_barrageFiltered.length > 0)
           targets.splice(0, targets.length, ..._barrageFiltered);
         delete game.barrageTargetSpace[msgId];
       }
       ```
     Empty-filter fallback: when `_barrageFiltered.length === 0`, the targets
     array is unchanged but the flag is STILL deleted. Handler-layer UX
     recovers by falling through to the usual target picker.

  5. `src/handlers/combat.js:2594-2598` — defense-pool white-die add
     (referenced by `barrage_defense_pool_extra_die`, not executed here —
     defense-pool assembly is D4 handler-layer work):
       ```js
       if (combat.barrageAttack) {
         pool.push('white');
         await thread.send('**Barrage** — Defender adds 1 white die ...');
       }
       ```

**Pattern E dispatch shape:**

  The pure-engine handler is `handle_barrage(game, ability_id, ctx)` with
  `ctx['phase']` discriminating which firing site to execute. This is a
  deliberate departure from Force Push / Hop On / Force Throw (which use
  implicit phase detection via which ctx keys are populated). Barrage's
  4 firing sites are structurally distinct from each other — implicit
  detection via key-presence would conflate them. The explicit phase tag
  also makes the D4 handler-layer site-to-dispatch mapping byte-honest.

  Phase values: `'declare'`, `'after_first_attack'`,
  `'before_second_attack'`, `'second_attack_target_gate'`.

**Ctx contract:**

  Required (all phases): `msg_id: str`
  Phase `'after_first_attack'`: `defender_player_num: int`,
                                `target_figure_key: str`
  Phase `'before_second_attack'`: `combat: dict` (must carry `attackerMsgId`
                                  or callers pass `msg_id` separately)
  Phase `'second_attack_target_gate'`: `targets: list[dict]` (each with
                                       `coord: str`),
                                       `map_spaces: dict`,
                                       `closed_door_edges: Optional[set]`

**Return shapes** (camelCase to mirror JS payload):

  declare:                    {'applied': True, 'msg': '...'}
  after_first_attack:         {'applied': True, 'freeAttackPending': True,
                               'targetSpace': str|None,
                               'defenseBonusArmed': True, 'msg': '...'}
  before_second_attack:       {'applied': True, 'defenseBonusConsumed': bool,
                               'barrageAttack': bool}
  second_attack_target_gate:  {'applied': True, 'filteredTargets': list,
                               'filterApplied': bool}

**Design decisions pinned:**

  - `game.barrageSecondAttack`, `game.barrageTargetSpace`, and
    `game.barrageDefenseBonus` are lazy-init dicts. JS uses the `x = x || {}`
    idiom at every write site, so if a flag field is absent the handler
    creates it; this preserves dict identity on subsequent writes because
    the D2.29 / `activation-state.js` ROUND_OBJECT_FLAGS reset resets to
    `{}` (not delete), and the existing dict is reused.
  - `combat['barrageAttack']` is the boolean the defense-pool assembler
    reads. The helper `barrage_defense_pool_extra_die(combat)` is the
    only public surface for D4 to consume this flag without re-reading
    the raw key; keeps the contract explicit.
  - Empty-filter fallback mirrors JS verbatim: when filtering returns
    zero targets, the original targets list is unchanged and the flag is
    still consumed. The handler returns `'filterApplied': False` in that
    case so the D4 caller can decide whether to surface a warning.
  - The handler does NOT assemble the defense pool, does NOT run the two
    `compute_combat_result` calls, and does NOT emit Discord messages.
    All of that is handler-layer / D4 work. Pure engine's job is the
    4 state-flag mutations plus the white-die-color helper.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from python.engine.mechanics.adjacency import count_spaces


class BarragePhaseError(ValueError):
    """Raised when `handle_barrage` receives an unknown or missing phase tag."""


_VALID_PHASES = frozenset({
    'declare',
    'after_first_attack',
    'before_second_attack',
    'second_attack_target_gate',
})


# ── Public handler entry point ──────────────────────────────────────────────

def handle_barrage(game: Dict[str, Any],
                   ability_id: str,
                   ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Barrage phase dispatcher. See module docstring for per-phase contract.

    Raises:
      - `BarragePhaseError` if ctx lacks `phase` or the value is unknown —
        fail-loud discipline. Silent fallthrough on an unknown phase would
        let callers train on a different state than JS produces.
      - `ValueError` if ctx lacks `msg_id`.
    """
    if game is None:
        raise ValueError('handle_barrage: game is required')
    if not isinstance(ctx, dict):
        raise ValueError('handle_barrage: ctx dict required')
    phase = ctx.get('phase')
    if phase not in _VALID_PHASES:
        raise BarragePhaseError(
            f'handle_barrage: unknown phase {phase!r}; expected one of '
            f'{sorted(_VALID_PHASES)}'
        )
    msg_id = ctx.get('msg_id')
    if not msg_id:
        raise ValueError("handle_barrage: ctx['msg_id'] is required")

    if phase == 'declare':
        return _phase_declare(game, msg_id)
    if phase == 'after_first_attack':
        return _phase_after_first_attack(
            game,
            msg_id,
            defender_player_num=ctx.get('defender_player_num'),
            target_figure_key=ctx.get('target_figure_key'),
        )
    if phase == 'before_second_attack':
        return _phase_before_second_attack(
            game,
            msg_id,
            combat=ctx.get('combat'),
        )
    # second_attack_target_gate
    return _phase_second_attack_target_gate(
        game,
        msg_id,
        targets=ctx.get('targets') or [],
        map_spaces=ctx.get('map_spaces'),
        closed_door_edges=ctx.get('closed_door_edges'),
    )


# ── Phase 1: declare (abilities.js:1828-1831) ───────────────────────────────

def _phase_declare(game: Dict[str, Any], msg_id: str) -> Dict[str, Any]:
    """Mark the ability so that the second free attack fires when the first
    attack resolves. Mirrors `x = x || {}` lazy-init idiom."""
    flags = game.get('barrageSecondAttack')
    if flags is None:
        flags = {}
        game['barrageSecondAttack'] = flags
    flags[msg_id] = True
    return {
        'applied': True,
        'msg': (
            '**Barrage** — Perform 2 attacks (2nd target within 3 of 1st, '
            'defender +1 white die on 2nd). Click **Attack** for the first '
            'attack.'
        ),
    }


# ── Phase 2: after_first_attack (combat-bridge.js:1500-1513) ────────────────

def _phase_after_first_attack(game: Dict[str, Any],
                              msg_id: str,
                              defender_player_num: Optional[int],
                              target_figure_key: Optional[str]) -> Dict[str, Any]:
    """After the first attack resolves: consume the declare flag, grant the
    second free attack, store the first target's position for the target
    gate, and arm the defense bonus.

    JS guards the whole block under `if (game.barrageSecondAttack?.[msgId])`
    — when the decl flag is absent (e.g. caller fired this phase without
    the attack being Barrage), the block no-ops. Python mirrors: return
    `{'applied': False}` so callers can introspect.
    """
    sec_flags = game.get('barrageSecondAttack') or {}
    if not sec_flags.get(msg_id):
        return {'applied': False, 'reason': 'no-declare-flag'}

    # Consume declare flag.
    sec_flags.pop(msg_id, None)

    # Grant second free attack.
    free_pending = game.get('freeAttackBonusPending')
    if free_pending is None:
        free_pending = {}
        game['freeAttackBonusPending'] = free_pending
    free_pending[msg_id] = True

    # Store first target's position so target-gate can filter second attack.
    target_space: Optional[str] = None
    if defender_player_num is not None and target_figure_key:
        positions = (
            (game.get('figurePositions') or {}).get(defender_player_num, {})
        )
        pos = positions.get(target_figure_key)
        if pos:
            target_space = pos
            target_flags = game.get('barrageTargetSpace')
            if target_flags is None:
                target_flags = {}
                game['barrageTargetSpace'] = target_flags
            target_flags[msg_id] = pos

    # Arm defense bonus (consumed by before_second_attack).
    def_flags = game.get('barrageDefenseBonus')
    if def_flags is None:
        def_flags = {}
        game['barrageDefenseBonus'] = def_flags
    def_flags[msg_id] = True

    return {
        'applied': True,
        'freeAttackPending': True,
        'targetSpace': target_space,
        'defenseBonusArmed': True,
        'msg': (
            '**Barrage** — You may perform a second attack (target within 3 '
            'of first target, defender +1 white die). Use the **Attack** '
            'button.'
        ),
    }


# ── Phase 3: before_second_attack (handlers/combat.js:1513-1515) ─────────────

def _phase_before_second_attack(game: Dict[str, Any],
                                msg_id: str,
                                combat: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Consume the defense bonus flag and mark the combat dict so the
    defender-pool assembler will add 1 white die.

    JS writes `game.pendingCombat.barrageAttack = true`. We accept either
    `combat` directly in ctx (preferred — callers pre-compute it) or fall
    back to `game['pendingCombat']` to mirror JS literally.
    """
    def_flags = game.get('barrageDefenseBonus') or {}
    if not def_flags.get(msg_id):
        return {
            'applied': False,
            'defenseBonusConsumed': False,
            'barrageAttack': False,
            'reason': 'no-defense-bonus-flag',
        }

    # Consume flag.
    def_flags.pop(msg_id, None)

    # Mark combat dict. Prefer ctx-supplied combat, fall back to game.pendingCombat.
    combat_dict = combat if combat is not None else game.get('pendingCombat')
    if isinstance(combat_dict, dict):
        combat_dict['barrageAttack'] = True
        flagged = True
    else:
        flagged = False

    return {
        'applied': True,
        'defenseBonusConsumed': True,
        'barrageAttack': flagged,
    }


# ── Phase 4: second_attack_target_gate (dc-play-area.js:1138-1142) ───────────

def _phase_second_attack_target_gate(game: Dict[str, Any],
                                     msg_id: str,
                                     targets: List[Dict[str, Any]],
                                     map_spaces: Optional[Dict[str, Any]],
                                     closed_door_edges) -> Dict[str, Any]:
    """Restrict second-attack targets to within 3 spaces of the first target.

    Empty-filter fallback (JS verbatim): when zero targets pass the filter,
    return the ORIGINAL targets list unchanged. The flag is consumed
    regardless, matching JS's unconditional `delete`.

    `closed_door_edges` is the edge-key set built by the D4 handler (same
    set the autofire chain-target filter consumes). Pure engine threads it
    through `count_spaces` verbatim. None → no edge blocking.
    """
    target_flags = game.get('barrageTargetSpace') or {}
    if msg_id not in target_flags:
        return {
            'applied': False,
            'filteredTargets': list(targets),
            'filterApplied': False,
            'reason': 'no-target-space-flag',
        }

    first_space = target_flags[msg_id]
    # Consume flag regardless of filter outcome (JS verbatim).
    target_flags.pop(msg_id, None)

    if not map_spaces:
        # No map data — cannot filter. JS `countSpaces` with empty map_spaces
        # returns inf, so EVERY target would be filtered out → empty-filter
        # fallback kicks in → original targets survive. Short-circuit to the
        # same outcome without the redundant walk.
        return {
            'applied': True,
            'filteredTargets': list(targets),
            'filterApplied': False,
        }

    blocked = closed_door_edges if isinstance(closed_door_edges, set) else None
    filtered: List[Dict[str, Any]] = []
    for t in targets:
        if not isinstance(t, dict):
            continue
        coord = t.get('coord')
        if not coord:
            continue
        dist = count_spaces(map_spaces, first_space, coord, blocked)
        if dist != math.inf and dist <= 3:
            filtered.append(t)

    if filtered:
        return {
            'applied': True,
            'filteredTargets': filtered,
            'filterApplied': True,
        }
    # Empty-filter fallback.
    return {
        'applied': True,
        'filteredTargets': list(targets),
        'filterApplied': False,
    }


# ── Defense-pool helper (combat.js:2594-2598, handler-layer consumer) ───────

def barrage_defense_pool_extra_die(combat: Optional[Dict[str, Any]]) -> Optional[str]:
    """Return the extra die color ('white') for the defense pool when the
    combat dict is flagged as a Barrage second attack, else None.

    Called by the D4 defense-pool assembler while building the pool. Pure
    engine exposes this so the assembler doesn't have to reach into the
    raw `combat['barrageAttack']` key (and so any future rename of the
    flag has exactly one call site).
    """
    if not isinstance(combat, dict):
        return None
    if combat.get('barrageAttack'):
        return 'white'
    return None
