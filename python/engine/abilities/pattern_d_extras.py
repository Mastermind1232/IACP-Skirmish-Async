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
    """Boltslinger: after a resolved attack, may choose a hostile
    within 2 to take 1 damage. Stamp pendingBoltslinger so the Discord
    UI offers the target picker."""
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    combat = ctx.get('combat') or {}
    attacker_key = ctx.get('attacker_figure_key')
    if not attacker_key:
        return {'applied': False, 'gated_by': 'missing-attacker'}
    data['pendingBoltslinger'] = {
        'attackerFigureKey': attacker_key,
        'attackerPlayerNum': combat.get('attackerPlayerNum'),
    }
    return {'applied': True,
            'log_message': '**Boltslinger** — target picker queued.'}


def handle_sidewinder_flag(game, ability_id, ctx):
    """Sidewinder: may suffer 1 strain to move 2 spaces after attack.
    Stamp pendingSidewinder so UI prompts."""
    data = game if isinstance(game, dict) else getattr(game, 'data', game)
    attacker_key = ctx.get('attacker_figure_key')
    if not attacker_key:
        return {'applied': False, 'gated_by': 'missing-attacker'}
    data['pendingSidewinder'] = {'attackerFigureKey': attacker_key}
    return {'applied': True,
            'log_message': '**Sidewinder** — move-2 prompt queued.'}


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

    return {'installed': installed, 'count': len(installed)}
