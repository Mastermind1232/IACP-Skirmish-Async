"""D3.7 + D3.9 + D3.12 + D3.14 + D3.16 — Pattern D real handlers.

D3.7 through D3.14 replace stub handlers on the `combat-declare` trigger
with real behavior byte-identically ported from
`src/handlers/combat.js:1626-1879` ("passive-auto ability wiring" block).
D3.16 extends to the `combat-defense` trigger with four new handlers wired
at a DIFFERENT firing site — the two-walk orchestrator in
`python/engine/mechanics/combat_defense_friends.py` walks the DEFENDER's
FRIENDLY figures (JS site: `src/handlers/combat.js:1922-1984`).

**D3.7 landed six attacker-side stat-delta handlers:**

  - **Focus+green** via `conditions.apply_condition_with_die` (Slice 5):
      - `battle_meditation`      — unconditional (JS line 1638-1645)
      - `full_of_rage`           — gated on `atkDamageSuffered >= 3` (1648-1654)
      - `sharpshooter`           — gated on `distance_to_target >= 5` (1802-1808)

  - **Combat-dict numeric mutation** (no new primitive needed):
      - `acp_scattergun`         — `bonusHits += 2` if `distance <= 1` (1770-1773)
      - `scattergun`             — `bonusHits += 1` if `distance <= 1` (1774-1777)
      - `find_weakness`          — `bonusEvade  -= 1` unconditional (1811-1814)

**D3.9 adds five defender-side Relentless handlers** — the first defender-side
combat-declare family, all sharing `apply_strain_to_figure` (Slice 5) with a
uniform `distance_to_target <= 3` gate (JS `src/handlers/combat.js:1711-1715`):

  - `relentless_trandoshan_elite`  — Trandoshan Hunter Elite
  - `relentless_trandoshan_reg`    — Trandoshan Hunter Regular
  - `relentless_ig88`              — IG-88
  - `fifth_brother_relentless`     — Fifth Brother (Inquisitor)
  - `relentless_pursuit`           — **library orphan**: carries
    `wiredStatus='wired'` in the library but no JS firing site references
    it, and no DC in `data/dc-effects.json` lists it in `specialAbilityIds`.
    Registered here for dispatch parity so a future DC carrying it routes
    through the same shared primitive. Today it's unreachable via the live
    `fire_combat_declare_triggers` walk but callable via direct
    `dispatch.resolve(game, 'relentless_pursuit', ctx)`.

The JS uniform gate (`distanceToTarget <= 3`) is applied to all five here
even though the library description for `fifth_brother_relentless` and
`relentless_pursuit` omits the "within 3 spaces" clause — JS treats the
gate as an attribute of the firing site, not of the ability text.

**Defender-side ctx contract** (new in D3.9, reusable for every future
defender-side combat-declare handler — not relentless-specific):

  - `defender_figure_key`     str         — target figure key (JS `target.figureKey`)
  - `defender_player_num`     int         — target's player (JS `defenderPlayerNum`)
  - `dc_health_state`         dict        — `{msgId: [[hp, max], ...]}` map
                                           (JS `ctx.dcHealthState`)
  - `dc_message_meta`         dict        — `{msgId: {dcName, playerNum, gameId,
                                           displayName, ...}}` meta map
                                           (JS `ctx.dcMessageMeta`)
  - `distance_to_target`      int         — already threaded in D3.7; the gate
                                           key for Relentless, Sharpshooter, etc.

`game.gameId` is read directly off the game dict (mirrors JS `game.gameId`),
not duplicated in ctx. Every handler writes its state-mutation into either
`ctx['combat']` (attacker-side) or `ctx['dc_health_state']` (defender-side)
and returns a `{applied, log_message, ...}` dict.

**D3.12 adds three attacker-side dice-pool-surgery handlers** — the first
family that mutates `pendingCombat.attackInfo.dice` before the attack rolls.
All three share a single engine primitive
(`python/engine/mechanics/dice_pool_surgery.py`) that ports JS's
`findIndex` + `[...dice]` splice pattern byte-identically. Per-ability deltas
layered on top are (selector predicate, distance gate, once-per-round key,
log template). No new ctx keys — `attacker_figure_key` and
`distance_to_target` are already in the D3.7 attacker-side contract.

  - `shock_and_awe`  — Cara Dune: once-per-round (sticky on
                        `attackerFigureKey + '_shock_and_awe'`), replace 1
                        Yellow die with Red (JS `combat.js:1740-1755`).
  - `vanguard`       — AT-RT: within 3 spaces, replace 1 non-red die with
                        Red (JS `combat.js:1757-1767`).
  - `front_line`     — Echo Base Trooper: within 3 spaces, replace 1 blue
                        die with red (JS `combat.js:1845-1855`).

**D3.14 adds six combat-declare defender-side second-pass handlers** — the
first real handlers that fire on the *defender's* specialAbilityIds list
(previously D3.9 Relentless read defender-side ctx but fired from attacker's
list). Two of the six are attacker-side numeric mutations with simple gates
(`exploit_weakness` reads defender's conditions, `conclusion` fires
unconditionally); the other four fire on the defender's DC:

  - `exploit_weakness`          — attacker: `surgeBonus += 1` gated on
                                   defender having HARMFUL_CONDITIONS
                                   (Bleed/Stun/Weaken). JS 1817-1824.
  - `conclusion`                — attacker: `bonusEvade -= 1` unconditional.
                                   JS 1827-1830.
  - `disposable`                — defender: `bonusEvade -= 1` unconditional.
                                   JS 1840-1843.
  - `cortosis_weave`            — defender: `bonusPierce -= 2` unconditional.
                                   JS 1858-1861.
  - `gamorrean_honor_guard`     — defender: `bonusBlock += 1` gated on
                                   `is_ranged`. JS 1870-1873.
  - `composite_plating`         — defender: `bonusBlock += 1` gated on
                                   `distance_to_target >= 4`. JS 1876-1879.

The defender-side walk needs the attacker's passives to have already fired
(some attacker passives mutate fields the defender reads), so the fire-site
helper runs attacker → defender in sequence. Ctx contract unchanged from
D3.9: defender-side handlers read `defender_figure_key` + `is_ranged` +
`distance_to_target` already threaded through the trigger bus.

**D3.16 adds four combat-defense-friends handlers** — closes the
combat-defense library family (8/8 real post-slice). Firing site is a
SEPARATE JS location from `handleAttackTarget()` — JS iterates the
DEFENDER's FRIENDLY figures' DCs (not the attacker's or defender's own
specialAbilityIds) in two sequential walks at `combat.js:1922-1984`:

  - Walk 1 — Sentinel/Protector (shared `sentinel_applied` flag):
      - `sentinel`   — friendly +1 Block to defender, skips GUARDIAN defender.
                       JS 1938-1942.
      - `protector`  — friendly +1 Block to defender, no Guardian gate.
                       JS 1944-1948.
  - Walk 2 — Keep the Peace (shared `ktp_applied` flag):
      - `keep_the_peace_elite`   — friendly applies 1 Strain to ATTACKER
                                   via `apply_strain_to_figure` (Slice 5).
                                   Once-per-round sticky on
                                   `${fkDcName}_ktp_${currentRound}`.
                                   JS 1965-1972.
      - `keep_the_peace_regular` — friendly reminder text (no engine
                                   mutation). Skips GUARDIAN target.
                                   JS 1975-1981.

The orchestrator (`combat_defense_friends.py`) owns adjacency-set
construction (walk 1 includes target coord, walk 2 does not — delta),
shared-flag state, once-per-round sticky write BEFORE Elite dispatch
(mirrors JS :1968-1969 so a failing strain still consumes the round slot),
Guardian-keyword pre-gating, and defended-figure skip in walk 1. Individual
handlers below are stateless applicators.

**Remaining 22 - 5 - 3 - 6 = 8 combat-declare abilities stay as stubs** —
firing them raises `TriggerNotImplemented` at the bus layer, the intentional
fail-loud contract from D3.6. No silent no-ops, anywhere.

**What this module does NOT land** (explicit non-goals):
  - `adv_targeting_computer_dark_trooper` — the JS fires it at combat-declare,
    but the library entry has `category: 'passive'` with no `trigger`, so our
    classifier routes it to Pattern C. Porting it requires either a classifier
    change (library-wide ripple) or a Pattern C bite path for it. Deferred.
  - `flawless_execution` — triggers `pendingPowerTokenGrant` interactive flow
    when the attacker is already Focused. Needs D4 choice plumbing.
  - `cunning_*`, `distracting_*`, `hunker_down`, `bespin_security`,
    `forest_fighters`, `fly_by`, `mystic_hunter`, `much_to_learn`,
    `query_hk47`, `sniper` / `elite_sniper`, `ee3_carbine`,
    `arsenal` / `epic_arsenal` — each needs at least one of:
    map/terrain access, interactive choice, post-combat cleanup flag,
    attacker-condition ctx (not yet threaded), or a new compute_combat_result
    field. Deferred to later combat-declare passes.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from python.engine.abilities.pattern_d import register_trigger
from python.engine.mechanics.conditions import (
    HARMFUL_CONDITIONS, apply_condition, apply_condition_with_die,
)
from python.engine.mechanics.dice_pool_surgery import (
    is_once_per_round_used,
    mark_once_per_round_used,
    replace_die_in_pool,
)
from python.engine.mechanics.figure_lookup import (
    find_dc_message_id_for_figure,
    parse_figure_key,
)
from python.engine.mechanics.strain import apply_strain_to_figure


# ── Primitive: self-Focus + green die, shared by three abilities ────────────

def _apply_focus_green(game: Dict[str, Any],
                       combat: Dict[str, Any],
                       attacker_figure_key: str,
                       label: str) -> Dict[str, Any]:
    """Apply Focus to the attacker; if newly applied, append a green die.

    Mirrors the `applyConditionWithDie(game, attackerFigureKey, 'Focus',
    game.pendingCombat.attackInfo, 'green')` call in
    `src/handlers/combat.js`, plus the subsequent
    `game.pendingCombat.attackInfo = _result.attackInfo` assignment when the
    condition was newly applied.

    Returns `{applied: bool, log_message: Optional[str]}`. The log message
    format matches the JS `thread.send(...)` text so downstream callers can
    surface identical UX when D4 wires the handler layer back on top.
    """
    attack_info = combat.get('attackInfo') or {}
    result = apply_condition_with_die(game, attacker_figure_key,
                                      'Focus', attack_info, 'green')
    if result['applied']:
        combat['attackInfo'] = result['attackInfo']
        return {
            'applied': True,
            'log_message': f'**{label}** — {attacker_figure_key} is **Focused** before attacking (+1 green die).',
        }
    return {'applied': False, 'log_message': None}


# ── Handlers: self-Focus family (unconditional + ctx-gated) ─────────────────

def handle_battle_meditation(game: Dict[str, Any],
                             ability_id: str,
                             ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`battle_meditation` — unconditional auto-Focus.

    JS site: src/handlers/combat.js:1638-1645.
    """
    combat = ctx['combat']
    attacker_figure_key = ctx['attacker_figure_key']
    return _apply_focus_green(game, combat, attacker_figure_key, 'Battle Meditation')


def handle_full_of_rage(game: Dict[str, Any],
                        ability_id: str,
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`full_of_rage` — auto-Focus if attacker has suffered 3+ damage.

    JS site: src/handlers/combat.js:1648-1654.
    ctx contract: `attacker_damage_suffered` is caller-computed
    (`Math.max(0, atkFigHp[1] - atkFigHp[0])` in JS).
    """
    if (ctx.get('attacker_damage_suffered') or 0) < 3:
        return {'applied': False, 'log_message': None, 'gated_by': 'atkDamageSuffered<3'}
    combat = ctx['combat']
    attacker_figure_key = ctx['attacker_figure_key']
    return _apply_focus_green(game, combat, attacker_figure_key, 'Full of Rage')


def handle_sharpshooter(game: Dict[str, Any],
                        ability_id: str,
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`sharpshooter` — auto-Focus if target is 5+ spaces away.

    JS site: src/handlers/combat.js:1802-1808.
    ctx contract: `distance_to_target` is caller-computed.
    """
    if (ctx.get('distance_to_target') or 0) < 5:
        return {'applied': False, 'log_message': None, 'gated_by': 'distance<5'}
    combat = ctx['combat']
    attacker_figure_key = ctx['attacker_figure_key']
    return _apply_focus_green(game, combat, attacker_figure_key, 'Sharpshooter')


# ── Handlers: combat-dict numeric mutations ─────────────────────────────────

def handle_acp_scattergun(game: Dict[str, Any],
                          ability_id: str,
                          ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`acp_scattergun` — +2 bonusHits if attacker is adjacent to target.

    JS site: src/handlers/combat.js:1770-1773 (inside the
    `if (distanceToTarget <= 1) { ... }` block).
    """
    if (ctx.get('distance_to_target') or 0) > 1:
        return {'applied': False, 'log_message': None, 'gated_by': 'distance>1'}
    combat = ctx['combat']
    combat['bonusHits'] = (combat.get('bonusHits') or 0) + 2
    return {
        'applied': True,
        'log_message': '**ACP Scattergun** — adjacent to target: +2 Hits.',
    }


def handle_scattergun(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`scattergun` — +1 bonusHits if attacker is adjacent to target.

    JS site: src/handlers/combat.js:1774-1777.
    """
    if (ctx.get('distance_to_target') or 0) > 1:
        return {'applied': False, 'log_message': None, 'gated_by': 'distance>1'}
    combat = ctx['combat']
    combat['bonusHits'] = (combat.get('bonusHits') or 0) + 1
    return {
        'applied': True,
        'log_message': '**Scattergun** — adjacent to target: +1 Hit.',
    }


def handle_find_weakness(game: Dict[str, Any],
                         ability_id: str,
                         ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`find_weakness` — −1 bonusEvade unconditional (JS site line 1811-1814).

    Note: the library description mentions +3 Accuracy in addition, but the
    JS comment explicitly states "accuracy handled via passives" — the
    accuracy buff is applied elsewhere (Pattern A/C on the same DC). This
    handler mirrors JS exactly: bonusEvade only.
    """
    combat = ctx['combat']
    combat['bonusEvade'] = (combat.get('bonusEvade') or 0) - 1
    return {
        'applied': True,
        'log_message': '**Find Weakness** — −1 Evade applied to defense results.',
    }


# ── D3.9: Defender-side Relentless family (1 Strain to target) ─────────────

def _relentless_strain(game: Dict[str, Any],
                       ctx: Dict[str, Any],
                       label: str) -> Dict[str, Any]:
    """Shared primitive for the Relentless family.

    Applies 1 Strain to the defender (`ctx['defender_figure_key']`) if
    `distance_to_target <= 3`. Mirrors JS `src/handlers/combat.js:1711-1715`
    which fires `applyStrainToFigure(game, defenderPlayerNum,
    target.figureKey, 1, 'Relentless', meta.dcName, ctx, thread)` under the
    same gate.

    Returns a `{applied, log_message, ...}` dict. When the gate rejects the
    fire (distance too far, missing defender context, no matching
    dc_message_id), returns `applied=False` with a `gated_by` reason tag so
    the fire-site helper can record why the fire was skipped without
    surfacing it to Discord. Fireproof hits are reported with
    `fireproof=True` so the oracle can assert on the immune branch
    independently of the gate branches.

    **Context keys read** (all reusable for future defender-side handlers):
      - `distance_to_target`     (int)   — the gate key (same as Sharpshooter)
      - `defender_figure_key`    (str)   — target figure key
      - `defender_player_num`    (int)   — defender player number
      - `dc_health_state`        (dict)  — health-state map threaded from
                                           the D4 handler layer
      - `dc_message_meta`        (dict)  — meta map threaded from D4
      - `game.get('gameId')`     (str)   — read off `game` directly
    """
    if (ctx.get('distance_to_target') or 0) > 3:
        return {'applied': False, 'log_message': None, 'gated_by': 'distance>3'}

    defender_figure_key: Optional[str] = ctx.get('defender_figure_key')
    defender_player_num: Optional[int] = ctx.get('defender_player_num')
    if not defender_figure_key or not defender_player_num:
        return {'applied': False, 'log_message': None,
                'gated_by': 'missing-defender'}

    dc_health_state: Dict[str, Any] = ctx.get('dc_health_state') or {}
    dc_message_meta: Dict[str, Any] = ctx.get('dc_message_meta') or {}
    game_id: Optional[str] = (game or {}).get('gameId')

    msg_id = find_dc_message_id_for_figure(
        game_id, defender_player_num, defender_figure_key, dc_message_meta,
    )
    if not msg_id:
        return {'applied': False, 'log_message': None,
                'gated_by': 'no-dc-msg-id'}

    parsed = parse_figure_key(defender_figure_key)
    figure_index = parsed[2] if parsed is not None else 0

    result = apply_strain_to_figure(
        dc_health_state, game, msg_id, figure_index,
        defender_figure_key, defender_player_num, 1,
    )

    if result['fireproof']:
        return {
            'applied': False,
            'fireproof': True,
            'log_message': f'**Fireproof** — {defender_figure_key} is immune to Strain from **{label}**.',
        }
    if result['applied'] == 0:
        # Figure already at 0 HP — JS `applyStrainToFigure` also silently
        # no-ops this path; oracle preserves defeated flag so callers can
        # propagate to the D2.29 defeat pipeline.
        return {'applied': False, 'log_message': None,
                'gated_by': 'already-defeated'}

    return {
        'applied': True,
        'log_message': f'**{label}** — {defender_figure_key} suffers 1 Strain.',
        'prev_hp': result['prevHp'],
        'new_hp': result['newHp'],
        'defeated': result['defeated'],
    }


def handle_relentless_trandoshan_elite(game: Dict[str, Any],
                                       ability_id: str,
                                       ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`relentless_trandoshan_elite` — Trandoshan Hunter Elite Relentless.

    JS site: src/handlers/combat.js:1711-1715. Gate: distance_to_target <= 3.
    """
    return _relentless_strain(game, ctx, 'Relentless')


def handle_relentless_trandoshan_reg(game: Dict[str, Any],
                                     ability_id: str,
                                     ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`relentless_trandoshan_reg` — Trandoshan Hunter Regular Relentless.

    JS site: src/handlers/combat.js:1711-1715. Gate: distance_to_target <= 3.
    """
    return _relentless_strain(game, ctx, 'Relentless')


def handle_relentless_ig88(game: Dict[str, Any],
                           ability_id: str,
                           ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`relentless_ig88` — IG-88 Relentless.

    JS site: src/handlers/combat.js:1711-1715. Gate: distance_to_target <= 3.
    """
    return _relentless_strain(game, ctx, 'Relentless')


def handle_fifth_brother_relentless(game: Dict[str, Any],
                                    ability_id: str,
                                    ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`fifth_brother_relentless` — Fifth Brother Relentless.

    JS site: src/handlers/combat.js:1711-1715. The library description
    omits "within 3 spaces" for this entry, but JS applies the uniform
    `distanceToTarget <= 3` gate to all four firing IDs in the
    `relentlessIds` list at line 1712 — the gate is an attribute of the
    firing site, not the library text. Matches JS for byte-identical parity.
    """
    return _relentless_strain(game, ctx, 'Relentless')


def _dice_pool_replace(game: Dict[str, Any],
                       ctx: Dict[str, Any],
                       *,
                       selector: Callable[[str], bool],
                       replacement: str,
                       log_body,
                       distance_gate: Optional[int] = None,
                       once_per_round_key: Optional[str] = None) -> Dict[str, Any]:
    """Shared orchestration for Pattern D dice-pool surgery handlers.

    Gate order mirrors JS (distance first, then once-per-round, then pool
    scan, then sticky-flag write on success):

      1. If `distance_gate` is set and `ctx['distance_to_target'] >
         distance_gate`, skip with `gated_by='distance>N'`.
      2. If `once_per_round_key` is set and the sticky flag is truthy, skip
         with `gated_by='once-per-round'`.
      3. Call `replace_die_in_pool(combat, selector, replacement)`. If no die
         matches, skip with `gated_by='no-matching-die'`.
      4. If `once_per_round_key` is set, mark the sticky flag used (lazy-init
         the round-flag dict if absent).
      5. Return `{applied, log_message, replaced_color, index}`.

    `log_body` may be a static string or a callable `(prev_color, ctx) ->
    str` so per-ability log deltas (shock_and_awe's Title-Case Yellow vs
    vanguard's interpolated lowercase vs front_line's all-lowercase) are
    preserved without a second abstraction.
    """
    if distance_gate is not None:
        dist = ctx.get('distance_to_target') or 0
        if dist > distance_gate:
            return {'applied': False, 'log_message': None,
                    'gated_by': f'distance>{distance_gate}'}

    if once_per_round_key is not None:
        if is_once_per_round_used(game, once_per_round_key):
            return {'applied': False, 'log_message': None,
                    'gated_by': 'once-per-round'}

    combat = ctx['combat']
    surgery = replace_die_in_pool(combat, selector, replacement)
    if not surgery['applied']:
        return {'applied': False, 'log_message': None,
                'gated_by': 'no-matching-die'}

    if once_per_round_key is not None:
        mark_once_per_round_used(game, once_per_round_key)

    prev_color: str = surgery['replaced_color']
    log_message = log_body(prev_color, ctx) if callable(log_body) else log_body
    return {
        'applied': True,
        'log_message': log_message,
        'replaced_color': prev_color,
        'index': surgery['index'],
    }


def handle_shock_and_awe(game: Dict[str, Any],
                         ability_id: str,
                         ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`shock_and_awe` — Cara Dune: once-per-round, replace 1 Yellow die with Red.

    JS site: src/handlers/combat.js:1740-1755. The round-sticky key is
    `${attackerFigureKey}_shock_and_awe` (per-figure, so two Cara Dunes in
    the same game gate independently). The JS log line is Title-Case
    ("1 Yellow die replaced with Red.") — preserved verbatim.
    """
    attacker_figure_key = ctx['attacker_figure_key']
    return _dice_pool_replace(
        game, ctx,
        selector=lambda c: c == 'yellow',
        replacement='red',
        log_body='**Shock and Awe** — 1 Yellow die replaced with Red.',
        once_per_round_key=f'{attacker_figure_key}_shock_and_awe',
    )


def handle_vanguard(game: Dict[str, Any],
                    ability_id: str,
                    ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`vanguard` — AT-RT: within 3 spaces, replace 1 non-red die with Red.

    JS site: src/handlers/combat.js:1757-1767. `findIndex(d => d !== 'red')`
    takes the first non-red die in the pool (whichever colour is earliest).
    No once-per-round gate. Log line interpolates the replaced colour:
    `1 ${dice[nonRedIdx]} die replaced with Red (target within ${N} spaces)`.
    """
    def _log(color: str, ctx_inner: Dict[str, Any]) -> str:
        dist = ctx_inner.get('distance_to_target') or 0
        return (f'**Vanguard** — 1 {color} die replaced with Red '
                f'(target within {dist} spaces).')

    return _dice_pool_replace(
        game, ctx,
        selector=lambda c: c != 'red',
        replacement='red',
        log_body=_log,
        distance_gate=3,
    )


def handle_front_line(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`front_line` — Echo Base Trooper: within 3 spaces, replace 1 blue die
    with red.

    JS site: src/handlers/combat.js:1845-1855. No once-per-round gate. Log
    line is all-lowercase ("1 blue die replaced with red") — delta from
    shock_and_awe / vanguard, preserved verbatim.
    """
    def _log(color: str, ctx_inner: Dict[str, Any]) -> str:
        dist = ctx_inner.get('distance_to_target') or 0
        return (f'**Front Line** — 1 blue die replaced with red '
                f'(target within {dist} spaces).')

    return _dice_pool_replace(
        game, ctx,
        selector=lambda c: c == 'blue',
        replacement='red',
        log_body=_log,
        distance_gate=3,
    )


def handle_relentless_pursuit(game: Dict[str, Any],
                              ability_id: str,
                              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`relentless_pursuit` — library orphan, not fired by any JS DC today.

    Carries `wiredStatus='wired'` in the library, but:
      - No JS handler references the ID (`src/handlers/combat.js:1712`
        `relentlessIds` list has only the 4 other Relentless IDs).
      - No DC in `data/dc-effects.json` carries it in `specialAbilityIds`.

    Registered here as a real handler for dispatch parity — if a future
    DC picks up the ID in its `specialAbilityIds` list, the
    `fire_combat_declare_triggers` walk will route through the same shared
    `_relentless_strain` primitive without a code change. Direct
    `dispatch.resolve(game, 'relentless_pursuit', ctx)` calls are also
    honored. Today, the ID is unreachable via live game play but the
    dispatch surface is consistent with the other four.

    Uses label 'Relentless Pursuit' from the library entry (other firing
    IDs use the hardcoded JS label 'Relentless').
    """
    return _relentless_strain(game, ctx, 'Relentless Pursuit')


# ── D3.14: Defender-side combat-declare second pass ────────────────────────

def _defender_has_harmful_condition(game: Dict[str, Any],
                                    defender_figure_key: str) -> bool:
    """True iff the defender carries any of Bleed/Stun/Weaken.

    Mirrors JS `src/handlers/combat.js:1818-1820`:
        const harmfulConds = ['Bleed', 'Stun', 'Weaken'];
        const defConds = game.figureConditions?.[target.figureKey] || [];
        defConds.some(c => harmfulConds.includes(c))

    HARMFUL_CONDITIONS is imported from `python.engine.mechanics.conditions`
    where the tuple is declared as `('Stun', 'Bleed', 'Weaken')`. Order is
    different from the JS inline list but the set membership test is
    identical.
    """
    fc = (game or {}).get('figureConditions') or {}
    defender_conds = fc.get(defender_figure_key) or []
    return any(c in HARMFUL_CONDITIONS for c in defender_conds)


def handle_exploit_weakness(game: Dict[str, Any],
                            ability_id: str,
                            ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`exploit_weakness` — Scout Trooper Elite: +1 Surge if defender has a
    harmful condition (Bleed/Stun/Weaken).

    Attacker-side fire (atkSpecialIds), but reads defender-side conditions.
    JS site: src/handlers/combat.js:1817-1824.

    ctx contract:
      - `combat`               (dict) — mutated: `surgeBonus += 1` on success.
      - `defender_figure_key`  (str)  — already threaded in D3.9 for
                                       Relentless; reused here.

    Fail-soft branches:
      - Missing `defender_figure_key` → `{applied: False, gated_by: 'missing-defender'}`.
      - No harmful condition on defender → `{applied: False, gated_by: 'no-harmful-condition'}`.
    """
    combat = ctx['combat']
    defender_figure_key: Optional[str] = ctx.get('defender_figure_key')
    if not defender_figure_key:
        return {'applied': False, 'log_message': None,
                'gated_by': 'missing-defender'}
    if not _defender_has_harmful_condition(game, defender_figure_key):
        return {'applied': False, 'log_message': None,
                'gated_by': 'no-harmful-condition'}
    combat['surgeBonus'] = (combat.get('surgeBonus') or 0) + 1
    return {
        'applied': True,
        'log_message': '**Exploit Weakness** — defender has a harmful condition, +1 Surge.',
    }


def handle_conclusion(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`conclusion` — HK-47: −1 Evade to defense results while attacking.

    Attacker-side fire (atkSpecialIds), unconditional (fires every attack).
    JS site: src/handlers/combat.js:1827-1830. Shares effect shape with
    `find_weakness` but distinct ability ID — HK-47 / Query HK-47 are a
    cluster with separate ability IDs that may fire together.
    """
    combat = ctx['combat']
    combat['bonusEvade'] = (combat.get('bonusEvade') or 0) - 1
    return {
        'applied': True,
        'log_message': '**Conclusion** — −1 Evade applied to defense results.',
    }


def handle_disposable(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`disposable` — Hired Gun Regular: −1 Evade to own defense results.

    Defender-side fire (defSpecialIds), unconditional. JS site:
    src/handlers/combat.js:1840-1843. The DC "may be discarded" text in the
    library is a separate action-card-discard effect; the combat-declare
    firing here is the passive evade tax.
    """
    combat = ctx['combat']
    combat['bonusEvade'] = (combat.get('bonusEvade') or 0) - 1
    return {
        'applied': True,
        'log_message': "**Disposable** — −1 Evade applied to defender's defense results.",
    }


def handle_cortosis_weave(game: Dict[str, Any],
                          ability_id: str,
                          ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`cortosis_weave` — Echo Base Trooper Elite: reduce Pierce by 2.

    Defender-side fire (defSpecialIds), unconditional. JS site:
    src/handlers/combat.js:1858-1861. `bonusPierce` goes negative here; the
    min-0 clamp is handled later in `compute_combat_result` via pierce +
    defenderReducePierce accumulation (Slice 4 port).
    """
    combat = ctx['combat']
    combat['bonusPierce'] = (combat.get('bonusPierce') or 0) - 2
    return {
        'applied': True,
        'log_message': '**Cortosis Weave** — Pierce reduced by 2 (min 0).',
    }


def handle_gamorrean_honor_guard(game: Dict[str, Any],
                                 ability_id: str,
                                 ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`gamorrean_honor_guard` — +1 Block while defending against Ranged.

    Defender-side fire (defSpecialIds), gated on `is_ranged`. JS site:
    src/handlers/combat.js:1870-1873.

    ctx contract:
      - `is_ranged`  (bool) — caller-computed; true for Ranged attacks.
    """
    if not ctx.get('is_ranged'):
        return {'applied': False, 'log_message': None,
                'gated_by': 'not-ranged'}
    combat = ctx['combat']
    combat['bonusBlock'] = (combat.get('bonusBlock') or 0) + 1
    return {
        'applied': True,
        'log_message': '**Gamorrean Honor Guard** — +1 Block (defending against Ranged attack).',
    }


def handle_composite_plating(game: Dict[str, Any],
                             ability_id: str,
                             ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`composite_plating` — Heavy Stormtrooper Regular: +1 Block if attacker
    is 4+ spaces away.

    Defender-side fire (defSpecialIds), gated on `distance_to_target >= 4`.
    JS site: src/handlers/combat.js:1876-1879. Log line interpolates the
    distance — preserved verbatim.
    """
    distance = ctx.get('distance_to_target') or 0
    if distance < 4:
        return {'applied': False, 'log_message': None,
                'gated_by': 'distance<4'}
    combat = ctx['combat']
    combat['bonusBlock'] = (combat.get('bonusBlock') or 0) + 1
    return {
        'applied': True,
        'log_message': f'**Composite Plating** — +1 Block (attacker {distance} spaces away).',
    }


# ── D3.16: Combat-defense-friends family (Sentinel / Protector / Keep the Peace) ──
#
# Distinct firing site from D3.7/D3.9/D3.12/D3.14 — those fire on the
# attacker's or defender's own `specialAbilityIds`. This family walks the
# DEFENDER's FRIENDLY figures and checks each one's DC for one of four
# ability IDs: `sentinel`, `protector`, `keep_the_peace_elite`,
# `keep_the_peace_regular`. JS fires this site at
# `src/handlers/combat.js:1922-1984` via two sequential walks that share
# iteration shape but differ on three dimensions: adjacency-set (walk 1
# includes the target coord, walk 2 does not), walk-local shared-flag
# semantics (walk 1 has `sentinel_applied`, walk 2 has `ktp_applied`), and
# effect target (walk 1 grants +1 Block to the defender; walk 2 strains the
# ATTACKER via KTP Elite or surfaces a reminder via KTP Regular).
#
# The orchestrator lives in `python/engine/mechanics/combat_defense_friends.py`
# (`fire_combat_defense_friends_triggers`). It owns:
#   - adjacency-set construction + lowercase normalization
#   - shared-flag state (`sentinel_applied` / `ktp_applied`)
#   - once-per-round sticky write for KTP Elite (write BEFORE dispatch so
#     a failing strain still consumes the round slot, matching JS)
#   - Guardian-keyword pre-gating (Sentinel vs defender, KTP Regular vs target)
#   - defended-figure skip in walk 1
#   - `fk_dc_name` injection into ctx per iteration for log attribution
#
# The individual handlers below are stateless applicators. They read ctx
# and mutate `combat` (walk 1) or call `apply_strain_to_figure` against the
# attacker (walk 2 Elite) or return reminder text (walk 2 Regular).

def handle_protector(game: Dict[str, Any],
                     ability_id: str,
                     ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`protector` — friendly figure grants defender +1 Block when adjacent
    to target space (or on target space).

    Walk 1 of combat-defense-friends. JS site:
    `src/handlers/combat.js:1944-1948`. Fires iff Sentinel didn't fire on
    the same walk — the orchestrator enforces that via `sentinel_applied`
    and only dispatches here when the flag is False. Unlike Sentinel,
    Protector has no Guardian gate.

    ctx contract:
      - `combat`     (dict) — mutated: `bonusBlock += 1`.
      - `fk_dc_name` (str)  — friendly figure's DC name, injected by
                              orchestrator for log attribution.
    """
    combat = ctx['combat']
    fk_dc_name = ctx.get('fk_dc_name') or '?'
    combat['bonusBlock'] = (combat.get('bonusBlock') or 0) + 1
    return {
        'applied': True,
        'log_message': (f'**Protector** ({fk_dc_name}) — adjacent to target '
                        f'space, +1 Block for defender.'),
    }


def handle_sentinel(game: Dict[str, Any],
                    ability_id: str,
                    ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`sentinel` — friendly figure grants defender +1 Block when adjacent
    to target space (or on target space); skips if defender has GUARDIAN.

    Walk 1 of combat-defense-friends. JS site:
    `src/handlers/combat.js:1938-1942`. The Guardian-vs-defender pre-gate
    is enforced by the orchestrator — this handler only receives ctx when
    the defender is not a Guardian. Sets `sentinel_applied` (in orchestrator)
    so Protector does not fire in the same walk.

    ctx contract:
      - `combat`     (dict) — mutated: `bonusBlock += 1`.
      - `fk_dc_name` (str)  — friendly figure's DC name, injected by
                              orchestrator for log attribution.
    """
    combat = ctx['combat']
    fk_dc_name = ctx.get('fk_dc_name') or '?'
    combat['bonusBlock'] = (combat.get('bonusBlock') or 0) + 1
    return {
        'applied': True,
        'log_message': (f'**Sentinel** ({fk_dc_name}) — adjacent to target '
                        f'space, +1 Block for defender.'),
    }


def handle_keep_the_peace_elite(game: Dict[str, Any],
                                ability_id: str,
                                ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`keep_the_peace_elite` — friendly figure applies 1 Strain to ATTACKER.

    Walk 2 of combat-defense-friends. JS site:
    `src/handlers/combat.js:1965-1972`. Fires iff KTP didn't already fire
    in the same walk (shared `ktp_applied` flag in orchestrator) AND the
    round-sticky `${fkDcName}_ktp_${currentRound}` is not set.

    The sticky WRITE happens in the orchestrator BEFORE this handler is
    dispatched (mirrors JS :1968-1969 which writes the sticky before the
    awaitable strain call) — a failing strain (Fireproof, missing msg_id,
    already-defeated) still consumes the round slot. This handler just
    does the strain + log.

    Unlike the D3.9 Relentless family (which strains the DEFENDER), KTP
    Elite strains the ATTACKER. Same primitive (`apply_strain_to_figure`),
    different target.

    ctx contract:
      - `attacker_player_num`  (int)  — required for strain addressing.
      - `attacker_figure_key`  (str)  — required for strain addressing.
      - `dc_health_state`      (dict) — health-state map, D3.9 contract.
      - `dc_message_meta`      (dict) — meta map, D3.9 contract.
      - `game_id`              (str)  — read from `game.get('gameId')` by
                                        orchestrator; included in ctx.
      - `fk_dc_name`           (str)  — friendly figure's DC name, for log.

    Fail-soft branches:
      - Missing `attacker_figure_key` or `attacker_player_num` →
        `{applied: False, gated_by: 'missing-attacker'}`.
      - `find_dc_message_id_for_figure` returns None →
        `{applied: False, gated_by: 'no-dc-msg-id'}`.
      - Fireproof attachment on attacker's DC →
        `{applied: False, fireproof: True, log_message: '**Fireproof** — ...'}`.
      - Attacker already at 0 HP → `{applied: False, gated_by: 'already-defeated'}`.
    """
    attacker_figure_key: Optional[str] = ctx.get('attacker_figure_key')
    attacker_player_num: Optional[int] = ctx.get('attacker_player_num')
    fk_dc_name: str = ctx.get('fk_dc_name') or '?'

    if not attacker_figure_key or not attacker_player_num:
        return {'applied': False, 'log_message': None,
                'gated_by': 'missing-attacker'}

    dc_health_state: Dict[str, Any] = ctx.get('dc_health_state') or {}
    dc_message_meta: Dict[str, Any] = ctx.get('dc_message_meta') or {}
    game_id: Optional[str] = (game or {}).get('gameId')

    msg_id = find_dc_message_id_for_figure(
        game_id, attacker_player_num, attacker_figure_key, dc_message_meta,
    )
    if not msg_id:
        return {'applied': False, 'log_message': None,
                'gated_by': 'no-dc-msg-id'}

    parsed = parse_figure_key(attacker_figure_key)
    figure_index = parsed[2] if parsed is not None else 0

    result = apply_strain_to_figure(
        dc_health_state, game, msg_id, figure_index,
        attacker_figure_key, attacker_player_num, 1,
    )

    if result['fireproof']:
        return {
            'applied': False,
            'fireproof': True,
            'log_message': (f'**Fireproof** — {attacker_figure_key} is immune '
                            f'to Strain from **Keep the Peace**.'),
        }
    if result['applied'] == 0:
        return {'applied': False, 'log_message': None,
                'gated_by': 'already-defeated'}

    return {
        'applied': True,
        'log_message': (f'**Keep the Peace** ({fk_dc_name}) — '
                        f'{attacker_figure_key} suffers 1 Strain.'),
        'prev_hp': result['prevHp'],
        'new_hp': result['newHp'],
        'defeated': result['defeated'],
    }


def handle_keep_the_peace_regular(game: Dict[str, Any],
                                  ability_id: str,
                                  ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`keep_the_peace_regular` — reminder-only. Does NOT fire vs GUARDIAN target.

    Walk 2 of combat-defense-friends. JS site:
    `src/handlers/combat.js:1975-1981`. Fires iff KTP Elite didn't fire in
    the same walk (shared `ktp_applied` flag) AND the target (defender) does
    NOT have GUARDIAN keyword. The orchestrator pre-gates the Guardian
    check, so by the time this handler fires, the defender is not a Guardian.

    Reminder-only: no engine mutation. The D4 handler layer surfaces the
    reminder text to Discord so the defender can voluntarily pay 1 Strain
    to make the attacker suffer 1 Strain. Python pure-engine just emits the
    log line; the interactive response is future D4 work.

    ctx contract:
      - `fk_dc_name` (str) — friendly figure's DC name, for log attribution.
    """
    fk_dc_name: str = ctx.get('fk_dc_name') or '?'
    return {
        'applied': True,
        'log_message': (f'**Keep the Peace** reminder — **{fk_dc_name}** is '
                        f'adjacent to the target space. Defender may suffer '
                        f'1 Strain to make the attacker suffer 1 Strain.'),
    }


# ── Registry dispatch ──────────────────────────────────────────────────────

_COMBAT_DECLARE_HANDLERS = {
    'battle_meditation': handle_battle_meditation,
    'full_of_rage': handle_full_of_rage,
    'sharpshooter': handle_sharpshooter,
    'acp_scattergun': handle_acp_scattergun,
    'scattergun': handle_scattergun,
    'find_weakness': handle_find_weakness,
    # D3.9 defender-side Relentless family (5):
    'relentless_trandoshan_elite': handle_relentless_trandoshan_elite,
    'relentless_trandoshan_reg': handle_relentless_trandoshan_reg,
    'relentless_ig88': handle_relentless_ig88,
    'fifth_brother_relentless': handle_fifth_brother_relentless,
    'relentless_pursuit': handle_relentless_pursuit,
    # D3.12 attacker-side dice-pool surgery family (3):
    'shock_and_awe': handle_shock_and_awe,
    'vanguard': handle_vanguard,
    'front_line': handle_front_line,
    # D3.14 defender-side second pass (6):
    'exploit_weakness': handle_exploit_weakness,
    'conclusion': handle_conclusion,
    'disposable': handle_disposable,
    'cortosis_weave': handle_cortosis_weave,
    'gamorrean_honor_guard': handle_gamorrean_honor_guard,
    'composite_plating': handle_composite_plating,
}




def install_combat_declare_handlers() -> Dict[str, Any]:
    """Overwrite the stubs for the twenty combat-declare abilities landed here.

    D3.7 landed 6 attacker-side stat-delta handlers; D3.9 adds 5 defender-side
    Relentless handlers; D3.12 adds 3 attacker-side dice-pool surgery
    handlers; D3.14 adds 6 defender-side second-pass handlers (2 attacker-side
    fires that read defender ctx + 4 defender-side fires on the defender's DC
    specialAbilityIds). Idempotent — `register_trigger` replaces any prior
    registration, so calling this a second time is a no-op over the same
    registry state.

    Must be called AFTER `install_pattern_d_stubs()` so the registry has the
    ability slots. `dispatch.install_default_handlers()` enforces this
    ordering.

    Returns a summary dict for the dispatch report:
        {'installed': [ability_id, ...], 'trigger': 'combat-declare'}
    """
    for ability_id, handler in _COMBAT_DECLARE_HANDLERS.items():
        register_trigger('combat-declare', ability_id, handler)
    return {
        'installed': sorted(_COMBAT_DECLARE_HANDLERS.keys()),
        'trigger': 'combat-declare',
    }


def combat_declare_real_handler_ids() -> tuple:
    """Sorted tuple of ability IDs wired to real handlers (D3.7 + D3.9 + D3.12 + D3.14).

    Introspection helper: parity oracles use this to assert the landed set
    exactly matches the documented list — any drift (new handler landed but
    doc not updated, or vice versa) fails loudly.
    """
    return tuple(sorted(_COMBAT_DECLARE_HANDLERS.keys()))


def combat_declare_defender_side_ids() -> tuple:
    """Sorted tuple of D3.9 defender-side Relentless handler IDs (5).

    Introspection helper separating D3.9 additions from D3.7's attacker-side
    set, so oracles can pin the new behavior independently of the original
    six. Returned ordering matches `combat_declare_real_handler_ids()`.
    """
    return (
        'fifth_brother_relentless',
        'relentless_ig88',
        'relentless_pursuit',
        'relentless_trandoshan_elite',
        'relentless_trandoshan_reg',
    )


def combat_declare_dice_pool_surgery_ids() -> tuple:
    """Sorted tuple of D3.12 attacker-side dice-pool surgery handler IDs (3).

    Introspection helper separating the D3.12 additions from D3.7's six and
    D3.9's five, so oracles can pin the new behavior independently of the
    earlier passes. Returned ordering is alphabetical.
    """
    return ('front_line', 'shock_and_awe', 'vanguard')


def combat_declare_defender_second_pass_ids() -> tuple:
    """Sorted tuple of D3.14 defender-side second-pass handler IDs (6).

    Two of the six fire on attacker's specialAbilityIds list but read
    defender-side ctx (`exploit_weakness`, `conclusion`); the remaining
    four fire on the defender's specialAbilityIds list (`disposable`,
    `cortosis_weave`, `gamorrean_honor_guard`, `composite_plating`).

    Introspection helper separating D3.14 additions from D3.7/D3.9/D3.12,
    so oracles can pin the new behavior independently of earlier passes.
    Returned ordering is alphabetical.
    """
    return (
        'composite_plating',
        'conclusion',
        'cortosis_weave',
        'disposable',
        'exploit_weakness',
        'gamorrean_honor_guard',
    )


# ── D3.16: combat-defense-friends registry ─────────────────────────────────

_COMBAT_DEFENSE_FRIENDS_HANDLERS = {
    # Walk 1: Sentinel/Protector (shared `sentinel_applied` flag in orchestrator)
    'sentinel': handle_sentinel,
    'protector': handle_protector,
    # Walk 2: Keep the Peace (shared `ktp_applied` flag; Elite has sticky)
    'keep_the_peace_elite': handle_keep_the_peace_elite,
    'keep_the_peace_regular': handle_keep_the_peace_regular,
}


def install_combat_defense_friends_handlers() -> Dict[str, Any]:
    """Overwrite the stubs for the four D3.16 combat-defense-friends handlers.

    Closes the combat-defense library family (8/8 real post-slice). All four
    handlers register on library trigger `'combat-defense'` via the D3.6 bus —
    their firing surface is the two-walk orchestrator in
    `python/engine/mechanics/combat_defense_friends.py`, which walks the
    DEFENDER's FRIENDLY figures (not the attacker's or defender's own
    specialAbilityIds) and dispatches per-figure through the bus.

    Idempotent — `register_trigger` replaces any prior registration, so
    calling this a second time is a no-op over the same registry state.

    Must be called AFTER `install_pattern_d_stubs()` so the bus has the
    ability slots. `dispatch.install_default_handlers()` enforces this
    ordering.

    Returns a summary dict for the dispatch report:
        {'installed': [ability_id, ...], 'trigger': 'combat-defense'}
    """
    for ability_id, handler in _COMBAT_DEFENSE_FRIENDS_HANDLERS.items():
        register_trigger('combat-defense', ability_id, handler)
    return {
        'installed': sorted(_COMBAT_DEFENSE_FRIENDS_HANDLERS.keys()),
        'trigger': 'combat-defense',
    }


# ── Simple self-condition handlers (deploy / mission-start) ────────────────

def handle_stealthy_davith(game: Dict[str, Any],
                            ability_id: str,
                            ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`stealthy_davith` — at mission-start, Davith becomes Hidden.

    Library entry: {trigger: 'mission-start', description: "At the start of
    the mission, become Hidden."}. The mission-start bus walks all figures
    on the board with this ability and fires once per figure; ctx provides
    the figure_key of the owning Davith figure.
    """
    figure_key = ctx.get('figure_key')
    if not figure_key:
        return {'applied': False, 'log_message': None,
                'gated_by': 'no-figure-key'}
    added = apply_condition(game, figure_key, 'Hidden')
    if not added:
        return {'applied': False, 'log_message': None,
                'gated_by': 'already-hidden'}
    return {
        'applied': True,
        'log_message': f'**Stealthy** — {figure_key} is Hidden at mission start.',
    }


def install_mission_start_handlers() -> Dict[str, Any]:
    """Wire mission-start Pattern D handlers that are fully self-contained
    (no choice UI, no cross-figure lookup)."""
    register_trigger('mission-start', 'stealthy_davith', handle_stealthy_davith)
    return {
        'installed': ['stealthy_davith'],
        'trigger': 'mission-start',
    }


# ── Activation active-abilities (freeMoveEqualToSpeed family) ──────────────

def _handle_free_move_equal_to_speed(game: Dict[str, Any],
                                      ability_id: str,
                                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Grant MP equal to the DC's speed + optionally flag a free attack.

    Mirrors src/game/abilities.js:1895-1910 (Wall Run, Charge). ctx must
    supply `msg_id` and `dc_name` (or `meta.dcName`); the handler looks up
    the DC's stats from dc-effects.json to determine speed.
    """
    from python.engine.data.dc_effects_loader import get_dc_effect
    from python.engine.mechanics.game_helpers import grant_movement_bank
    from python.engine.data.ability_library_loader import get_ability

    dc_name = ctx.get('dc_name')
    msg_id = ctx.get('msg_id') or ctx.get('msgId')
    if not dc_name or not msg_id:
        return {'applied': False, 'log_message': None,
                'gated_by': 'missing-dc-name-or-msg-id'}

    effect = get_dc_effect(dc_name) or {}
    speed = effect.get('speed')
    if not isinstance(speed, int):
        speed = 4
    grant_movement_bank(game, msg_id, speed)

    entry = get_ability(ability_id) or {}
    free_attack = bool(entry.get('freeAttackBonus'))
    if free_attack:
        pending = game.get('freeAttackBonusPending') or {}
        pending[msg_id] = True
        game['freeAttackBonusPending'] = pending

    label = entry.get('label') or ability_id
    tail = (' Then your next attack costs no action.'
            if free_attack
            else ' You may ignore terrain adjacent to walls during this movement.')
    log_template = entry.get('logMessage')
    log = log_template or f'**{label}** — Gained {speed} free MP (your Speed).{tail}'
    return {
        'applied': True,
        'log_message': log,
        'mpGranted': speed,
        'freeAttackPending': free_attack,
        'msgId': msg_id,
    }


def install_free_move_equal_to_speed_handlers() -> Dict[str, Any]:
    """Wire `charge` and `wall_run` via the shared freeMoveEqualToSpeed
    handler. Both fire on the `activation` trigger per the ability library.
    """
    register_trigger('activation', 'charge', _handle_free_move_equal_to_speed)
    register_trigger('activation', 'wall_run', _handle_free_move_equal_to_speed)
    return {
        'installed': ['charge', 'wall_run'],
        'trigger': 'activation',
    }


# ── On-damage: self-Focus family ────────────────────────────────────────────

def _handle_self_preservation(game: Dict[str, Any],
                               ability_id: str,
                               ctx: Dict[str, Any]) -> Dict[str, Any]:
    """self_preservation / self_preservation_hired_gun_elite — when the
    figure suffers Damage, it becomes Focused.

    JS effect: `applyCondition(game, damagedFigureKey, 'Focus')`. No die
    append (on-damage fires OUTSIDE combat, so there's no attack pool to
    modify). ctx must supply `figure_key` (the damaged figure).
    """
    figure_key = ctx.get('figure_key') or ctx.get('damaged_figure_key')
    if not figure_key:
        return {'applied': False, 'log_message': None,
                'gated_by': 'missing-figure-key'}
    added = apply_condition(game, figure_key, 'Focus')
    if not added:
        return {'applied': False, 'log_message': None,
                'gated_by': 'already-focused'}
    return {
        'applied': True,
        'log_message': f'**Self-Preservation** — {figure_key} becomes Focused after suffering damage.',
        'figureKey': figure_key,
    }


def install_on_damage_handlers() -> Dict[str, Any]:
    """Wire the on-damage self-Focus pair."""
    register_trigger('on-damage', 'self_preservation', _handle_self_preservation)
    register_trigger('on-damage', 'self_preservation_hired_gun_elite',
                      _handle_self_preservation)
    return {
        'installed': ['self_preservation', 'self_preservation_hired_gun_elite'],
        'trigger': 'on-damage',
    }


# ── combat-declare: forest_fighters ────────────────────────────────────────

def handle_forest_fighters(game: Dict[str, Any],
                            ability_id: str,
                            ctx: Dict[str, Any]) -> Dict[str, Any]:
    """`forest_fighters` (Ewok Warrior Elite): +1 Hit during melee attack
    if attacker is Hidden.

    JS site: src/handlers/combat.js:2102-2110. Gates are:
      - isRanged == False (melee attack)
      - attacker's figureConditions contains 'Hidden'
    """
    combat = ctx.get('combat')
    if not isinstance(combat, dict):
        return {'applied': False, 'log_message': None,
                'gated_by': 'missing-combat'}

    # Melee gate: if the attack is ranged, skip
    is_ranged = ctx.get('is_ranged')
    if is_ranged is None:
        # Fall back to distance (melee ~= adjacent)
        dist = ctx.get('distance_to_target')
        if isinstance(dist, int):
            is_ranged = dist > 1
    if is_ranged:
        return {'applied': False, 'log_message': None,
                'gated_by': 'not-melee'}

    attacker_key = ctx.get('attacker_figure_key')
    if not attacker_key:
        return {'applied': False, 'log_message': None,
                'gated_by': 'missing-attacker'}
    conds = (game.get('figureConditions') or {}).get(attacker_key) or []
    if 'Hidden' not in conds:
        return {'applied': False, 'log_message': None,
                'gated_by': 'not-hidden'}

    combat['bonusHits'] = (combat.get('bonusHits') or 0) + 1
    return {
        'applied': True,
        'log_message': '**Forest Fighters** — +1 Hit (Hidden, Melee attack).',
    }


def install_forest_fighters_handler() -> Dict[str, Any]:
    """Wire forest_fighters on the combat-declare trigger."""
    register_trigger('combat-declare', 'forest_fighters', handle_forest_fighters)
    return {'installed': ['forest_fighters'], 'trigger': 'combat-declare'}


# ── Fury (Wookiee Warrior Elite/Regular) ────────────────────────────────────

FURY_MIN_DAMAGE = 5
FURY_SURGE_BONUS = 1


def handle_fury(game: Dict[str, Any],
                 ability_id: str,
                 ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Fury: while attacking, if attacker has suffered 5+ damage,
    grant +1 Surge (sets combat.furyBonus = 1).

    JS site: src/handlers/combat.js:1847-1851 + src/game/fury-helpers.js.
    Library trigger in inventory is `combat-dice`, but the JS fire site
    runs it inside the attack-declare pipeline — we register on
    combat-dice to match the library and forward same ctx.
    """
    damage = ctx.get('attacker_damage_suffered') or 0
    if not isinstance(damage, int) or damage < FURY_MIN_DAMAGE:
        return {'applied': False, 'log_message': None,
                'gated_by': f'atkDamageSuffered<{FURY_MIN_DAMAGE}'}
    combat = ctx.get('combat')
    if not isinstance(combat, dict):
        return {'applied': False, 'log_message': None,
                'gated_by': 'missing-combat'}
    combat['furyBonus'] = FURY_SURGE_BONUS
    return {
        'applied': True,
        'log_message': (
            f'**Fury** — Wookiee Warrior is **Furious** '
            f'(+{FURY_SURGE_BONUS} Surge, having suffered {damage} damage).'
        ),
    }


def install_fury_handlers() -> Dict[str, Any]:
    """Wire fury_wookiee_elite and fury_wookiee_reg on combat-dice.

    Both IDs share the `handle_fury` handler — same mechanic, two DCs.
    """
    register_trigger('combat-dice', 'fury_wookiee_elite', handle_fury)
    register_trigger('combat-dice', 'fury_wookiee_reg', handle_fury)
    return {
        'installed': ['fury_wookiee_elite', 'fury_wookiee_reg'],
        'trigger': 'combat-dice',
    }


def combat_defense_friends_ids() -> tuple:
    """Sorted tuple of D3.16 combat-defense-friends handler IDs (4).

    Introspection helper separating D3.16 additions from the D3.7/D3.9/
    D3.12/D3.14 combat-declare families. D3.16 is the first Pattern D slice
    that fires from a DIFFERENT site than `handleAttackTarget()` — these
    four handlers execute via the two-walk orchestrator in
    `python/engine/mechanics/combat_defense_friends.py`.

    Returned ordering is alphabetical (stable across runs).
    """
    return (
        'keep_the_peace_elite',
        'keep_the_peace_regular',
        'protector',
        'sentinel',
    )
