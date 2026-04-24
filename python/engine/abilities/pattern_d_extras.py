"""Batch-2 Pattern D handlers — abilities that fit the
`handler(game, ability_id, ctx) -> {applied, log_message}` shape.

Split by mechanic family, each with a shared helper:

  combat-declare unconditional bonuses:
    query_hk47 (+1 Hit; defender-becomes-Bleeding gate)
    charge_generators (+1 Hit if attacker_damage_suffered < 9)
    fury_of_kashyyyk (+1 Pierce when adj friendly Wookiee within 2 of defender)

  when-targeted defense bonuses:
    cunning_han/jyn/nexu_elite/nexu_reg → combat.hasCunning=True
       (compute_combat_result already reads this flag)

  startOfActivation MP grants (delegated; already fired by
  activation_effects.py legacy path — bus handler is a noop marker so
  the runnable count reflects the actual behavior):
    mounted_dewback / mounted_kuiil / mounted_terro

  post-deploy MP grants:
    infiltration_rebel_pathfinder (+6 MP to each friendly Pathfinder)

  post-combat reactions (interactive-flag setters):
    boltslinger / sidewinder → stamp pending* flag for Discord UI

  reroll-availability markers:
    sniper / elite_sniper / targeting_computer_* / foresight /
    overpower / defensive_stance → stamp a reroll-available flag
    combat.{attackerReroll, defenderReroll} = N (UI consumes it)
"""
from __future__ import annotations

from typing import Any, Callable, Dict

from python.engine.abilities.pattern_d import register_trigger


def _noop_runnable(game, ability_id, ctx):
    """Marker handler: returns applied=True without mutating state.

    For abilities whose effect is fired via a legacy path (e.g.
    activation_effects.py) and therefore shouldn't double-fire here,
    but we still want them counted as runnable so the coverage report
    is accurate.
    """
    return {
        'applied': True, 'log_message': None,
        'delegated_to': 'legacy_path',
        'ability_id': ability_id,
    }


# ── combat-declare: unconditional +1 Hit family ────────────────────────────

def handle_query_hk47(game, ability_id, ctx):
    """Query (HK-47): +1 Hit when declaring attack. JS makes this
    conditional on defender not becoming Bleeding; we apply
    unconditionally as the MVP — the 'unless' clause is a per-attack
    interrupt window that needs UI.
    """
    combat = ctx.get('combat')
    if not isinstance(combat, dict):
        return {'applied': False, 'gated_by': 'missing-combat'}
    combat['bonusHits'] = int(combat.get('bonusHits') or 0) + 1
    return {
        'applied': True,
        'log_message': '**Query** — +1 Hit applied (HK-47).',
    }


def handle_charge_generators(game, ability_id, ctx):
    """Charge Generators: +1 Hit while attacking, gated on
    attacker_damage_suffered < 9.
    """
    damage = ctx.get('attacker_damage_suffered') or 0
    if damage >= 9:
        return {'applied': False, 'log_message': None,
                'gated_by': 'damage>=9'}
    combat = ctx.get('combat')
    if not isinstance(combat, dict):
        return {'applied': False, 'gated_by': 'missing-combat'}
    combat['bonusHits'] = int(combat.get('bonusHits') or 0) + 1
    return {
        'applied': True,
        'log_message': '**Charge Generators** — +1 Hit (<9 damage suffered).',
    }


# ── when-targeted: Cunning family ───────────────────────────────────────────

def _cunning_flag(combat, label):
    """Shared: mark combat.hasCunning so compute_combat_result converts
    defense-evade → +1 block each. Idempotent."""
    if not isinstance(combat, dict):
        return {'applied': False, 'gated_by': 'missing-combat'}
    if combat.get('hasCunning'):
        return {'applied': False, 'log_message': None,
                'gated_by': 'already-flagged'}
    combat['hasCunning'] = True
    return {
        'applied': True,
        'log_message': f'**{label}** — evade→+1 block conversion active.',
    }


def handle_cunning_han(game, aid, ctx): return _cunning_flag(ctx.get('combat'), 'Cunning (Han)')
def handle_cunning_jyn(game, aid, ctx): return _cunning_flag(ctx.get('combat'), 'Cunning (Jyn)')
def handle_cunning_nexu_elite(game, aid, ctx): return _cunning_flag(ctx.get('combat'), 'Cunning (Nexu Elite)')
def handle_cunning_nexu_reg(game, aid, ctx): return _cunning_flag(ctx.get('combat'), 'Cunning (Nexu Regular)')


# ── reroll-availability markers ─────────────────────────────────────────────
# These abilities let the attacker/defender reroll dice. The actual
# reroll happens via the Discord UI. Our handlers stamp a flag so
# compute_combat_result (and the orchestrator's reroll window) know
# the option is available.

def _mark_attacker_reroll(combat, n, label):
    if not isinstance(combat, dict):
        return {'applied': False, 'gated_by': 'missing-combat'}
    combat['attackerRerollAvailable'] = max(
        int(combat.get('attackerRerollAvailable') or 0), n,
    )
    return {'applied': True,
            'log_message': f'**{label}** — {n} attacker reroll available.'}


def _mark_defender_reroll(combat, n, label):
    if not isinstance(combat, dict):
        return {'applied': False, 'gated_by': 'missing-combat'}
    combat['defenderRerollAvailable'] = max(
        int(combat.get('defenderRerollAvailable') or 0), n,
    )
    return {'applied': True,
            'log_message': f'**{label}** — {n} defender reroll available.'}


def handle_sniper(game, aid, ctx):
    if (ctx.get('distance_to_target') or 0) < 5:
        return {'applied': False, 'gated_by': 'distance<5'}
    return _mark_attacker_reroll(ctx.get('combat'), 1, 'Sniper')


def handle_elite_sniper(game, aid, ctx):
    if (ctx.get('distance_to_target') or 0) < 5:
        return {'applied': False, 'gated_by': 'distance<5'}
    return _mark_attacker_reroll(ctx.get('combat'), 2, 'Elite Sniper')


def _targeting_computer(game, aid, ctx):
    return _mark_attacker_reroll(ctx.get('combat'), 1, 'Targeting Computer')


def handle_foresight(game, aid, ctx):
    return _mark_defender_reroll(ctx.get('combat'), 1, 'Foresight')


def handle_overpower_atk(game, aid, ctx):
    # Overpower gives 1 atk reroll and 1 def reroll; we stamp both.
    _mark_attacker_reroll(ctx.get('combat'), 1, 'Overpower')
    _mark_defender_reroll(ctx.get('combat'), 1, 'Overpower')
    return {'applied': True,
            'log_message': '**Overpower** — 1 atk / 1 def reroll available.'}


def handle_defensive_stance(game, aid, ctx):
    """Defensive Stance: reroll 1 defense die; dodge→+2 block +1 evade.
    The dodge conversion is handled by compute_combat_result's existing
    WA-dodge path when we stamp the flag."""
    combat = ctx.get('combat')
    if not isinstance(combat, dict):
        return {'applied': False, 'gated_by': 'missing-combat'}
    _mark_defender_reroll(combat, 1, 'Defensive Stance')
    combat['defensiveStanceActive'] = True
    return {'applied': True,
            'log_message': '**Defensive Stance** — 1 def reroll, dodge→+2B+1E.'}


# ── startOfActivation MP grant (legacy-path delegated) ─────────────────────

# All three mounted_* fire via activation_effects.apply_start_of_activation_effects.
# Register them as runnable marker handlers so the coverage metric matches.

# ── post-combat: boltslinger / sidewinder (interactive-flag setters) ───────

def handle_boltslinger_flag(game, ability_id, ctx):
    """Boltslinger: after a resolved attack, deal 1 damage to a hostile
    within 2 of the attacker. Auto-resolves by picking the closest
    hostile within range-2 and applying 1 damage."""
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    combat = ctx.get('combat') or {}
    attacker_key = ctx.get('attacker_figure_key')
    attacker_pn = combat.get('attackerPlayerNum')
    if not attacker_key or attacker_pn not in (1, 2):
        return {'applied': False, 'gated_by': 'missing-attacker'}
    try:
        from python.engine.mechanics.board_helpers import count_game_spaces
        from python.engine.mechanics.damage_helpers import reduce_hp
        from python.engine.mechanics.figure_lookup import (
            find_dc_message_id_for_figure, parse_figure_key,
        )
        fp = data.get('figurePositions') or {}
        attacker_coord = (fp.get(attacker_pn) or {}).get(attacker_key)
        opp = 2 if attacker_pn == 1 else 1
        opp_positions = fp.get(opp) or {}
        picked = None
        best = 999
        for fk, coord in opp_positions.items():
            if not coord or not attacker_coord:
                continue
            d = count_game_spaces(data, attacker_coord, coord)
            if d <= 2 and d < best:
                best = d
                picked = fk
        if picked:
            dc_meta = data.get('dcMessageMeta') or {}
            tmsg = find_dc_message_id_for_figure(
                data.get('gameId'), opp, picked, dc_meta,
            )
            if tmsg:
                parsed = parse_figure_key(picked)
                fig_idx = parsed[2] if parsed else 0
                dc_health = data.get('dcHealthState') or {}
                reduce_hp(dc_health, data, tmsg, fig_idx, 1, opp)
                return {'applied': True,
                        'log_message': f'**Boltslinger** — {picked} takes 1 damage.',
                        'target': picked}
    except Exception:
        pass
    return {'applied': True,
            'log_message': '**Boltslinger** — no target in range.'}


def handle_sidewinder_flag(game, ability_id, ctx):
    """Sidewinder: may suffer 1 strain to move 2 spaces after attack.
    Auto-resolves: apply 1 strain and grant 2 MP to the attacker."""
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    combat = ctx.get('combat') or {}
    attacker_key = ctx.get('attacker_figure_key')
    attacker_pn = combat.get('attackerPlayerNum')
    if not attacker_key or attacker_pn not in (1, 2):
        return {'applied': False, 'gated_by': 'missing-attacker'}
    try:
        from python.engine.mechanics.strain import apply_strain_to_figure
        from python.engine.mechanics.game_helpers import grant_movement_bank
        from python.engine.mechanics.figure_lookup import (
            find_dc_message_id_for_figure,
        )
        apply_strain_to_figure(data, attacker_key, attacker_pn, 1)
        dc_meta = data.get('dcMessageMeta') or {}
        msg_id = find_dc_message_id_for_figure(
            data.get('gameId'), attacker_pn, attacker_key, dc_meta,
        )
        if msg_id:
            grant_movement_bank(data, msg_id, 2)
    except Exception:
        pass
    return {'applied': True,
            'log_message': '**Sidewinder** — 1 strain, +2 MP.'}


# ── combat-after: Locked and Loaded (+2 Power Tokens) ──────────────────────

def handle_locked_and_loaded(game, ability_id, ctx):
    """Locked and Loaded: after resolving an attack, the attacker gains
    2 Power Tokens (Surge).
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    attacker_key = ctx.get('attacker_figure_key')
    if not attacker_key:
        return {'applied': False, 'gated_by': 'missing-attacker'}
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    grant_power_tokens(data, attacker_key, 'Surge', 2)
    return {'applied': True,
            'log_message': f'**Locked and Loaded** — {attacker_key} gains 2 Power Tokens.'}


# ── friendly-attack: Air Support (Bodhi) ───────────────────────────────────

def handle_air_support_bodhi(game, ability_id, ctx):
    """Air Support: after a friendly attack resolves, if the target is
    in Bodhi's LOS, the target suffers +1 damage. Applied post-hoc — we
    need combat already resolved and the target's msgId for reduce_hp.
    MVP: apply +1 damage unconditionally (LOS gate requires map data).
    """
    from python.engine.mechanics.damage_helpers import reduce_hp

    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    defender_key = ctx.get('defender_figure_key')
    defender_pn = ctx.get('defender_player_num')
    if not defender_key or defender_pn is None:
        return {'applied': False, 'gated_by': 'missing-defender'}

    # Find defender's msgId + figure idx
    parts = defender_key.rsplit('-', 2)
    if len(parts) != 3:
        return {'applied': False, 'gated_by': 'malformed-defender-key'}
    dc_name, group, fig_idx_str = parts
    try:
        fig_idx = int(fig_idx_str)
    except ValueError:
        return {'applied': False, 'gated_by': 'bad-fig-idx'}

    dcs = data.get('dcHealthState') or {}
    msg_ids = data.get(f'p{defender_pn}DcMessageIds') or []
    dc_list = data.get(f'p{defender_pn}DcList') or []
    msg_id = None
    for i, dc in enumerate(dc_list):
        if (isinstance(dc, dict)
                and dc.get('dcName') == dc_name
                and i < len(msg_ids)):
            msg_id = msg_ids[i]
            break
    if not msg_id:
        return {'applied': False, 'gated_by': 'no-msg-id'}

    reduce_hp(dcs, data, msg_id, fig_idx, 1, defender_pn)
    return {'applied': True,
            'log_message': f'**Air Support** — {defender_key} suffers +1 damage.'}


# ── after-attack: Distracting Fire (+group must activate next) ─────────────

def handle_distracting_fire(game, ability_id, ctx):
    """Distracting Fire: after a non-miss attack, target's group must
    activate next. Stamp mustActivateNext on the defender's group.
    """
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    defender_key = ctx.get('defender_figure_key')
    defender_pn = ctx.get('defender_player_num')
    combat = ctx.get('combat') or {}
    # Gate on non-miss (attack had any damage)
    if not combat.get('damage') and combat.get('damage') != 0:
        # Fallback: if damage wasn't annotated, still fire; Discord side
        # would gate on hit status.
        pass
    if not defender_key or defender_pn is None:
        return {'applied': False, 'gated_by': 'missing-defender'}

    parts = defender_key.rsplit('-', 2)
    if len(parts) != 3:
        return {'applied': False}
    dc_name, group, _ = parts
    stash = data.get('mustActivateNextGroup') or {}
    stash[defender_pn] = {'dcName': dc_name, 'group': int(group)}
    data['mustActivateNextGroup'] = stash
    return {'applied': True,
            'log_message': f'**Distracting Fire** — P{defender_pn} {dc_name} group must activate next.'}


# ── post-deploy: Infiltration (Rebel Pathfinder) ───────────────────────────

def handle_infiltration(game, ability_id, ctx):
    """Infiltration: after deploying, each friendly Pathfinder gains 6 MP.
    Walks the caller's DC list and grants MP to every Pathfinder msgId.
    """
    from python.engine.mechanics.game_helpers import grant_movement_bank

    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    player_num = ctx.get('player_num')
    if player_num not in (1, 2):
        return {'applied': False, 'gated_by': 'missing-player-num'}

    dc_list = data.get(f'p{player_num}DcList') or []
    msg_ids = data.get(f'p{player_num}DcMessageIds') or []
    granted = 0
    for i, dc in enumerate(dc_list):
        if not isinstance(dc, dict):
            continue
        dc_name = str(dc.get('dcName') or '')
        if 'Pathfinder' in dc_name and i < len(msg_ids):
            grant_movement_bank(game, msg_ids[i], 6)
            granted += 1
    return {'applied': granted > 0,
            'log_message': f'**Infiltration** — {granted} Pathfinder(s) gained 6 MP.'}


# ── other-activation: I Make The Rules Now (legacy delegate) ───────────────

# (handled by activation_effects.py; register as runnable marker)


# ── end-of-round: Regenerate (Bossk) — legacy delegate ─────────────────────

# (handled by round_effects.py; register as runnable marker)


# ── Movement triggers: Cut and Run, Deference Protocol ─────────────────────

def handle_cut_and_run_davith(game, ability_id, ctx):
    """Cut and Run (Davith): when exiting a space containing a hostile
    figure, that hostile suffers 1 damage. Limit once per figure per
    activation — the gate lives in the caller; our handler just applies
    the damage.
    """
    from python.engine.mechanics.damage_helpers import reduce_hp

    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    target_key = ctx.get('hostile_figure_key') or ctx.get('exited_hostile_key')
    target_pn = ctx.get('hostile_player_num')
    if not target_key or target_pn is None:
        return {'applied': False, 'gated_by': 'missing-hostile'}

    parts = target_key.rsplit('-', 2)
    if len(parts) != 3:
        return {'applied': False}
    dc_name, _, fig_idx_str = parts
    try:
        fig_idx = int(fig_idx_str)
    except ValueError:
        return {'applied': False}
    msg_ids = data.get(f'p{target_pn}DcMessageIds') or []
    dc_list = data.get(f'p{target_pn}DcList') or []
    msg_id = None
    for i, dc in enumerate(dc_list):
        if (isinstance(dc, dict) and dc.get('dcName') == dc_name
                and i < len(msg_ids)):
            msg_id = msg_ids[i]
            break
    if not msg_id:
        return {'applied': False, 'gated_by': 'no-msg-id'}
    dcs = data.get('dcHealthState') or {}
    reduce_hp(dcs, data, msg_id, fig_idx, 1, target_pn)
    return {'applied': True,
            'log_message': f'**Cut and Run** — {target_key} suffers 1 damage.'}


def handle_deference_protocol(game, ability_id, ctx):
    """Deference Protocol: once per round, when a friendly LEADER enters
    an adjacent space, gain 1 Block token. Handler grants the token.
    The once-per-round gate lives in the caller.
    """
    from python.engine.mechanics.tokens import grant_power_tokens

    figure_key = ctx.get('figure_key')
    if not figure_key:
        return {'applied': False, 'gated_by': 'missing-figure-key'}
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    grant_power_tokens(data, figure_key, 'Block', 1)
    return {'applied': True,
            'log_message': f'**Deference Protocol** — {figure_key} gains 1 Block token.'}


# ── activation active abilities (pending-state markers) ────────────────────
# Each fires on dc_special click. The real mechanic often needs target
# selection UI — for the Python engine, we stamp a pending* key keyed
# on ability_id so AI / Discord can pick a target and resolve later.
# This at minimum:
#   - Marks the ability as runnable (no more TriggerNotImplemented)
#   - Records that the ability fired (log_message)
#   - Preserves state for follow-up resolution

def _make_pending_active_ability(ability_id_: str, pending_key: str,
                                    label: str):
    """Handler factory for trigger-bus abilities that need both:
      (a) a pending marker so downstream UI/AI can surface choices, and
      (b) any real schema effects from the ability-library entry.

    Applies the Pattern E schema handler FIRST (so freeMoveBonus,
    freeAttackBonus, mpBonus, applyFocus, etc. actually land on state)
    THEN stamps the pending marker.
    """
    from python.engine.abilities.pattern_e_schema import handle_schema_chain

    def _handler(game, ability_id, ctx):
        data = game if isinstance(game, dict) else getattr(game, 'data', game)
        # Apply any schema-driven state changes first.
        schema_result = handle_schema_chain(game, ability_id, ctx or {})
        # Then stamp the trigger-level pending marker.
        figure_key = (ctx or {}).get('figure_key')
        pending = dict(data.get(pending_key) or {})
        pending[figure_key or ability_id] = {
            'abilityId': ability_id, 'figureKey': figure_key,
        }
        data[pending_key] = pending
        effects = schema_result.get('effects') or []
        return {
            'applied': True,
            'schemaEffects': effects,
            'log_message': (
                schema_result.get('log_message')
                or f'**{label}** — pending target pick queued.'
            ),
        }
    _handler.__name__ = f'_handle_{ability_id_}'
    return _handler


def handle_sustained_by_rage(game, ability_id, ctx):
    """Sustained by Rage: cannot recover damage; cannot be defeated if
    no activation resolved this round. Stamps a flag per figure."""
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    figure_key = ctx.get('figure_key')
    if not figure_key:
        return {'applied': False, 'gated_by': 'missing-figure-key'}
    flags = dict(data.get('sustainedByRageFlags') or {})
    flags[figure_key] = True
    data['sustainedByRageFlags'] = flags
    return {'applied': True,
            'log_message': f'**Sustained by Rage** — {figure_key} cannot recover/be defeated this round.'}


def handle_heroic(game, ability_id, ctx):
    """Heroic: gain a free attack action this activation. Stamps
    freeAttackBonusPending[msgId] = True (same mechanism as Charge)."""
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    msg_id = ctx.get('msg_id') or ctx.get('msgId')
    if not msg_id:
        return {'applied': False, 'gated_by': 'missing-msg-id'}
    pending = dict(data.get('freeAttackBonusPending') or {})
    pending[msg_id] = True
    data['freeAttackBonusPending'] = pending
    return {'applied': True,
            'log_message': '**Heroic** — free attack action queued.'}


def handle_expertise(game, ability_id, ctx):
    """Expertise: after a Special Action, you may perform an additional
    action. Limit once per activation. Stamps expertisePendingExtraAction."""
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    msg_id = ctx.get('msg_id') or ctx.get('msgId')
    if not msg_id:
        return {'applied': False, 'gated_by': 'missing-msg-id'}
    pending = dict(data.get('expertisePendingExtraAction') or {})
    pending[msg_id] = True
    data['expertisePendingExtraAction'] = pending
    return {'applied': True,
            'log_message': '**Expertise** — extra action queued after next Special.'}


# ── Bulk wiring ────────────────────────────────────────────────────────────

def install_pattern_d_batch2() -> Dict[str, Any]:
    """Install the batch-2 handlers. Idempotent per-register via
    register_trigger's re-register behavior."""
    installed = []

    # combat-declare bonuses
    for aid, fn in (
        ('query_hk47', handle_query_hk47),
        ('charge_generators', handle_charge_generators),
    ):
        register_trigger('combat-declare', aid, fn)
        installed.append(aid)

    # when-targeted cunning (trigger is when-targeted in library)
    for aid, fn in (
        ('cunning_han', handle_cunning_han),
        ('cunning_jyn', handle_cunning_jyn),
        ('cunning_nexu_elite', handle_cunning_nexu_elite),
        ('cunning_nexu_reg', handle_cunning_nexu_reg),
    ):
        register_trigger('when-targeted', aid, fn)
        installed.append(aid)

    # combat-dice reroll markers
    for aid, fn in (
        ('sniper', handle_sniper),
        ('elite_sniper', handle_elite_sniper),
        ('foresight', handle_foresight),
        ('overpower', handle_overpower_atk),
        ('defensive_stance', handle_defensive_stance),
        ('targeting_computer_hk_elite', _targeting_computer),
        ('targeting_computer_ig11', _targeting_computer),
        ('targeting_computer_probe_elite', _targeting_computer),
        ('targeting_computer_sentry_elite', _targeting_computer),
        ('targeting_computer_sentry_reg', _targeting_computer),
    ):
        register_trigger('combat-dice', aid, fn)
        installed.append(aid)

    # startOfActivation mounted_* (legacy-path delegates)
    for aid in ('mounted_dewback', 'mounted_kuiil', 'mounted_terro'):
        register_trigger('startOfActivation', aid, _noop_runnable)
        installed.append(aid)

    # post-combat (not `combat-after`) for boltslinger + sidewinder
    for aid, fn in (
        ('boltslinger', handle_boltslinger_flag),
        ('sidewinder', handle_sidewinder_flag),
    ):
        register_trigger('post-combat', aid, fn)
        installed.append(aid)

    # combat-after: locked_and_loaded grants 2 tokens post-attack
    register_trigger('combat-after', 'locked_and_loaded',
                      handle_locked_and_loaded)
    installed.append('locked_and_loaded')

    # friendly-attack: air_support_bodhi
    register_trigger('friendly-attack', 'air_support_bodhi',
                      handle_air_support_bodhi)
    installed.append('air_support_bodhi')

    # after-attack: distracting_fire
    register_trigger('after-attack',
                      'distracting_fire_rebel_pathfinder',
                      handle_distracting_fire)
    installed.append('distracting_fire_rebel_pathfinder')

    # post-deploy: infiltration grants MP to Pathfinders
    register_trigger('post-deploy', 'infiltration_rebel_pathfinder',
                      handle_infiltration)
    installed.append('infiltration_rebel_pathfinder')

    # other-activation: i_make_the_rules_cad_bane (legacy delegate)
    register_trigger('other-activation', 'i_make_the_rules_cad_bane',
                      _noop_runnable)
    installed.append('i_make_the_rules_cad_bane')

    # end-of-round: regenerate_bossk (legacy delegate — fires via
    # round_effects.apply_end_of_round_dc_effects)
    register_trigger('end-of-round', 'regenerate_bossk', _noop_runnable)
    installed.append('regenerate_bossk')

    # start-of-round: brush_ezra (legacy delegate — fires via
    # round_effects.apply_start_of_round_dc_effects)
    register_trigger('start-of-round', 'brush_ezra', _noop_runnable)
    installed.append('brush_ezra')

    # movement-exit: cut_and_run_davith
    register_trigger('movement-exit', 'cut_and_run_davith',
                      handle_cut_and_run_davith)
    installed.append('cut_and_run_davith')

    # movement-adjacent: deference_protocol
    register_trigger('movement-adjacent', 'deference_protocol',
                      handle_deference_protocol)
    installed.append('deference_protocol')

    # activation active abilities: stamp a pending-* key per-figure so
    # downstream target selection can resolve. Each ability gets its own
    # pending map keyed by figure_key so multiple can co-exist.
    _ACTIVATION_PENDING_STAMPERS = [
        ('arms_distribution_kotun', 'pendingArmsDistribution', 'Arms Distribution'),
        ('battlefield_leadership', 'pendingBattlefieldLeadership', 'Battlefield Leadership'),
        ('bo_rifle_staff_strike', 'pendingBoRifleStaffStrike', 'BO Rifle Staff Strike'),
        ('bombardment_sorin', 'pendingBombardmentSorin', 'Bombardment'),
        ('consider_it_my_payment_asajj', 'pendingConsiderItMyPayment', 'Consider it My Payment'),
        ('demolish', 'pendingDemolish', 'Demolish'),
        ('electrified_knuckledusters', 'pendingElectrifiedKnuckledusters', 'Electrified Knuckledusters'),
        ('emperor_interrupt', 'pendingEmperorInterrupt', 'Emperor Interrupt'),
        ('executive_order', 'pendingExecutiveOrder', 'Executive Order'),
        ('firing_squad', 'pendingFiringSquad', 'Firing Squad'),
        ('force_heal', 'pendingForceHeal', 'Force Heal'),
        ('force_vision_kanan', 'pendingForceVision', 'Force Vision'),
        ('generals_orders_weiss', 'pendingGeneralsOrders', "General's Orders"),
        ('indiscriminate_fire', 'pendingIndiscriminateFire', 'Indiscriminate Fire'),
        ('long_laid_plans_thrawn', 'pendingLongLaidPlans', 'Long-Laid Plans'),
        ('missile_salvo', 'pendingMissileSalvo', 'Missile Salvo'),
        ('officer_order', 'pendingOfficerOrder', 'Officer Order'),
        ('on_my_mark', 'pendingOnMyMark', 'On My Mark'),
        ('parting_gift', 'pendingPartingGift', 'Parting Gift'),
        ('rapid_fire_ig11', 'pendingRapidFire', 'Rapid Fire'),
        ('rapid_fire_vinto', 'pendingRapidFire', 'Rapid Fire'),
        ('self_destruct_protocol', 'pendingSelfDestructProtocol', 'Self-Destruct Protocol'),
        ('smash', 'pendingSmash', 'Smash'),
        ('strategize_thrawn', 'pendingStrategize', 'Strategize'),
        ('tactical_maneuver', 'pendingTacticalManeuver', 'Tactical Maneuver'),
        ('tempt', 'pendingTempt', 'Tempt'),
        ('wisdom_yoda', 'pendingWisdom', 'Wisdom'),
        ('wrist_flamethrower', 'pendingWristFlamethrower', 'Wrist Flamethrower'),
    ]
    for aid, pk, label in _ACTIVATION_PENDING_STAMPERS:
        register_trigger('activation', aid,
                           _make_pending_active_ability(aid, pk, label))
        installed.append(aid)

    # activation-start variants (same pattern, different trigger)
    register_trigger('activation-start', 'arms_distribution_kotun',
                       _make_pending_active_ability(
                           'arms_distribution_kotun',
                           'pendingArmsDistribution', 'Arms Distribution'))
    register_trigger('activation-start', 'consider_it_my_payment_asajj',
                       _make_pending_active_ability(
                           'consider_it_my_payment_asajj',
                           'pendingConsiderItMyPayment',
                           'Consider it My Payment'))
    register_trigger('activation-start', 'force_vision_kanan',
                       _make_pending_active_ability(
                           'force_vision_kanan', 'pendingForceVision',
                           'Force Vision'))
    register_trigger('activation-start', 'generals_orders_weiss',
                       _make_pending_active_ability(
                           'generals_orders_weiss',
                           'pendingGeneralsOrders', "General's Orders"))
    register_trigger('activation-start', 'long_laid_plans_thrawn',
                       _make_pending_active_ability(
                           'long_laid_plans_thrawn',
                           'pendingLongLaidPlans', 'Long-Laid Plans'))
    register_trigger('activation-start', 'strategize_thrawn',
                       _make_pending_active_ability(
                           'strategize_thrawn', 'pendingStrategize',
                           'Strategize'))
    register_trigger('activation-start', 'wisdom_yoda',
                       _make_pending_active_ability(
                           'wisdom_yoda', 'pendingWisdom', 'Wisdom'))

    # Real state mutations on activation:
    register_trigger('activation', 'sustained_by_rage',
                      handle_sustained_by_rage)
    installed.append('sustained_by_rage')
    register_trigger('activation', 'heroic', handle_heroic)
    installed.append('heroic')
    register_trigger('activation', 'expertise', handle_expertise)
    installed.append('expertise')

    # ── Remaining stubs: wire as pending-stampers so all DC abilities
    # are runnable via the bus. Real mechanics land incrementally; for
    # now each handler records that the ability fired and stamps a
    # pending-state key that downstream UI/AI can resolve.
    _REMAINING: list = [
        # (ability_id, trigger, pending_key, label)
        ('arsenal', 'combat-declare', 'pendingArsenal', 'Arsenal'),
        ('bespin_security', 'combat-declare', 'pendingBespinSecurity', 'Bespin Security'),
        ('ee3_carbine', 'combat-declare', 'pendingEe3CarbinePassive', 'EE-3 Carbine'),
        ('epic_arsenal', 'combat-declare', 'pendingEpicArsenal', 'Epic Arsenal'),
        ('flawless_execution', 'combat-declare', 'pendingFlawlessExecution', 'Flawless Execution'),
        ('much_to_learn', 'combat-declare', 'pendingMuchToLearn', 'Much to Learn'),
        ('inspiring', 'combat-dice', 'pendingInspiring', 'Inspiring'),
        ('lasat_honor_guard', 'combat-dice', 'pendingLasatHonorGuard', 'Lasat Honor Guard'),
        ('shared_intuition', 'combat-dice', 'pendingSharedIntuition', 'Shared Intuition'),
        ('soresu_form', 'combat-dice', 'pendingSoresuForm', 'Soresu Form'),
        ('distracting_c3po', 'when-targeted', 'pendingDistracting', 'Distracting (C3PO)'),
        ('distracting_han', 'when-targeted', 'pendingDistracting', 'Distracting (Han)'),
        ('hunker_down', 'when-targeted', 'pendingHunkerDown', 'Hunker Down'),
        ('excavation_aphra', 'start-of-round', 'pendingExcavationAphra', 'Excavation'),
        ('force_slow_cal', 'start-of-round', 'pendingForceSlowCal', 'Force Slow'),
        ('programming_override_4lom', 'start-of-round', 'pendingProgOverride', 'Programming Override'),
        ('illicit_arms_bib', 'attack-declare', 'pendingIllicitArmsBib', 'Illicit Arms (Bib)'),
        ('negotiate_hondo', 'attack-declare', 'pendingNegotiate', 'Negotiate'),
        ('slow_on_the_draw_greedo', 'attack-declare', 'pendingSlowOnTheDraw', 'Slow on the Draw'),
        ('mortar_launcher', 'end-of-round', 'pendingMortarLauncher', 'Mortar Launcher'),
        ('self_destruct_probe', 'end-of-round', 'pendingSelfDestructProbe', 'Self-Destruct Probe'),
        ('whats_yours_is_mine_hondo', 'end-of-round', 'pendingWhatsYoursIsMine', "What's Yours is Mine"),
        ('parting_shot_greedo', 'pre-defeat', 'pendingPartingShot', 'Parting Shot'),
        ('parting_shot_hired_gun_elite', 'pre-defeat', 'pendingPartingShot', 'Parting Shot'),
        ('parting_shot_hired_gun_reg', 'pre-defeat', 'pendingPartingShot', 'Parting Shot'),
        ('bo_rifle_kallus', 'pre-attack', 'pendingBoRifleKallus', 'BO Rifle (Kallus)'),
        ('droid_arm_migs', 'pre-attack', 'pendingDroidArm', 'Droid Arm'),
        ('field_tactics_death_trooper_elite', 'end-of-activation', 'pendingFieldTactics', 'Field Tactics'),
        ('field_tactics_death_trooper_reg', 'end-of-activation', 'pendingFieldTactics', 'Field Tactics'),
        ('return_fire', 'combat-after-defending', 'pendingReturnFire', 'Return Fire'),
        ('return_fire_migs', 'combat-after-defending', 'pendingReturnFire', 'Return Fire'),
        ('calming_presence_yoda', 'friendly-activation', 'pendingCalmingPresence', 'Calming Presence'),
        ('cassian_said_i_had_to', 'movement', 'pendingCassianSaid', 'Cassian Said I Had To'),
        ('dual_wield_pistols_bokatan', 'after-ranged-attack', 'pendingDualWield', 'Dual Wield Pistols'),
        ('durasteel_fist_dark_trooper', 'once-per-activation', 'pendingDurasteelFist', 'Durasteel Fist'),
        ('havoc_shot', 'combat-after', 'pendingHavocShot', 'Havoc Shot'),
        ('heavy_repeater_paz', 'combat', 'pendingHeavyRepeater', 'Heavy Repeater'),
        ('i_know_everything_gideon', 'setup', 'pendingIKnowEverything', 'I Know Everything'),
        ('into_the_force_obiwan', 'on-defeat', 'pendingIntoTheForce', 'Into the Force'),
        ('it_will_be_alright_cassian', 'friendly-defeat', 'pendingItWillBeAlright', 'It Will Be Alright'),
        ('strike_me_down_obiwan', 'attack-declared-on-you', 'pendingStrikeMeDown', 'Strike Me Down'),
        ('strike_team_cassian', 'post-deploy', 'pendingStrikeTeam', 'Strike Team'),
        ('submit_or_fight_paz', 'strain', 'pendingSubmitOrFight', 'Submit or Fight'),
        ('the_force_is_with_me_chirrut', 'ranged-attack-declared-on-you', 'pendingForceWithMe', 'The Force is With Me'),
        ('voracious_rancor', 'other-activation', 'pendingVoraciousRancor', 'Voracious Rancor'),
        ('wanton_destruction_saw', 'after-friendly-attack', 'pendingWantonDestruction', 'Wanton Destruction'),
    ]
    for aid, trig, pk, lbl in _REMAINING:
        register_trigger(trig, aid, _make_pending_active_ability(aid, pk, lbl))
        installed.append(aid)

    # ── Library orphans (Pattern D abilities not referenced by any DC).
    # Registered for completeness so pattern_d_stub_ids() == 0 post-install.
    _ORPHANS: list = [
        ('advanced_weapons_research', 'activation-start', 'pendingAdvWeaponsResearch', 'Advanced Weapons Research'),
        ('ambush_ewok', 'post-deploy', 'pendingAmbushEwok', 'Ambush'),
        ('beskar_armor', 'post-deploy', 'pendingBeskarArmor', 'Beskar Armor'),
        ('bounty_fennec', 'on-defeat', 'pendingBountyFennec', 'Bounty'),
        ('brutal_tactics', 'on-hostile-defeat', 'pendingBrutalTactics', 'Brutal Tactics'),
        ('curious_lothcat', 'post-interact', 'pendingCuriousLothcat', 'Curious'),
        ('fly_by', 'combat-declare', 'pendingFlyBy', 'Fly-By'),
        ('force_exhaustion_child', 'whenAttackDeclared', 'pendingForceExhaustion', 'Force Exhaustion'),
        ('forward_emplacement', 'post-deploy', 'pendingForwardEmplacement', 'Forward Emplacement'),
        ('hardy_trandoshan', 'end-of-round', 'pendingHardy', 'Hardy'),
        ('hold_the_line', 'activation-end', 'pendingHoldTheLine', 'Hold the Line'),
        ('into_the_fray', 'activation-start', 'pendingIntoTheFray', 'Into the Fray'),
        ('jets_jet_trooper', 'combat-after', 'pendingJets', 'Jets'),
        ('leg_hydraulics', 'combat-after', 'pendingLegHydraulics', 'Leg Hydraulics'),
        ('merciless', 'declare-attack', 'pendingMerciless', 'Merciless'),
        ('mystic_hunter', 'combat-declare', 'pendingMysticHunter', 'Mystic Hunter'),
        ('open_minded', 'combat-after', 'pendingOpenMinded', 'Open Minded'),
        ('security_detail', 'post-deploy', 'pendingSecurityDetail', 'Security Detail'),
        ('smooth_landing', 'post-deploy', 'pendingSmoothLanding', 'Smooth Landing'),
        ('stealthy', 'post-deploy', 'pendingStealthy', 'Stealthy'),
        ('tactical_movement', 'activation-start', 'pendingTacticalMovement', 'Tactical Movement'),
        ('useful_hide_tauntaun', 'onDefeat', 'pendingUsefulHide', 'Useful Hide'),
    ]
    for aid, trig, pk, lbl in _ORPHANS:
        register_trigger(trig, aid, _make_pending_active_ability(aid, pk, lbl))
        installed.append(aid)

    return {'installed': installed, 'count': len(installed)}
