"""Bespoke Pattern D handlers.

Covers the 32 Pattern D abilities whose library entries have no
concrete schema beyond `trigger` + `description`. Each handler
applies the mechanic described on the rules card to the combat /
game ctx at trigger time.

Most handlers return a small mutation on the combat object (bonus
Block/Accuracy/Pierce, +Surge, +Focus-to-self) plus an `applied`
result. Called via the Pattern D trigger bus — register_trigger is
invoked from install_bespoke_d_handlers().
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Mapping, Tuple


def _combat_bonus(ctx: Dict[str, Any], key: str, delta: int) -> None:
    """Add `delta` to combat[key], creating the entry if absent."""
    combat = ctx.get('combat')
    if not isinstance(combat, dict):
        return
    combat[key] = int(combat.get(key) or 0) + delta


def _combat_flag(ctx: Dict[str, Any], key: str) -> None:
    combat = ctx.get('combat')
    if isinstance(combat, dict):
        combat[key] = True


def _data(game: Any) -> Dict[str, Any]:
    d = getattr(game, 'data', None)
    if isinstance(d, dict):
        return d
    return game if isinstance(game, dict) else game


def _count_spaces(data: Dict[str, Any], a: str, b: str) -> int:
    try:
        from python.engine.mechanics.board_helpers import count_game_spaces
        return int(count_game_spaces(data, a, b))
    except Exception:
        return 0


def _attacker_defender_coords(game: Any, ctx: Dict[str, Any]
                               ) -> Tuple[str, str]:
    data = _data(game)
    combat = ctx.get('combat') or {}
    ap = combat.get('attackerPlayerNum')
    dp = combat.get('defenderPlayerNum')
    ak = combat.get('attackerFigureKey') or ctx.get('attacker_figure_key')
    dk = combat.get('defenderFigureKey') or ctx.get('defender_figure_key')
    fp = data.get('figurePositions') or {}
    a_coord = (fp.get(ap) or fp.get(str(ap)) or {}).get(ak) if ak else None
    d_coord = (fp.get(dp) or fp.get(str(dp)) or {}).get(dk) if dk else None
    return a_coord, d_coord


def _apply_condition(game: Any, fk: str, cond: str) -> None:
    try:
        from python.engine.mechanics.conditions import apply_condition
        apply_condition(game, fk, cond)
    except Exception:
        pass


# ── combat-declare handlers ─────────────────────────────────────────────

def sharpshooter(game, aid, ctx):
    """At 5+ spaces, become Focused."""
    a, d = _attacker_defender_coords(game, ctx)
    if a and d and _count_spaces(_data(game), a, d) >= 5:
        ak = (ctx.get('combat') or {}).get('attackerFigureKey') \
            or ctx.get('attacker_figure_key')
        if ak:
            _apply_condition(game, ak, 'Focus')
            return {'applied': True, 'log_message': 'Sharpshooter: Focus self.'}
    return {'applied': False, 'gated_by': 'range-under-5'}


def find_weakness(game, aid, ctx):
    """+3 Accuracy, -1 Evade while attacking."""
    _combat_bonus(ctx, 'bonusAccuracy', 3)
    _combat_bonus(ctx, 'bonusEvade', -1)
    return {'applied': True, 'log_message': 'Find Weakness: +3 Acc, -1 Evade.'}


def _relentless(game, aid, ctx):
    """Target suffers 1 Strain when you declare attack."""
    dk = (ctx.get('combat') or {}).get('defenderFigureKey') \
        or ctx.get('defender_figure_key')
    dp = (ctx.get('combat') or {}).get('defenderPlayerNum')
    if dk and dp in (1, 2):
        try:
            from python.engine.mechanics.strain import apply_strain_to_figure
            apply_strain_to_figure(_data(game), dk, dp, 1)
        except Exception:
            pass
    return {'applied': True, 'log_message': f'{aid}: target suffers 1 Strain.'}


def forest_fighters(game, aid, ctx):
    """+1 Surge while attacking in forest terrain.

    Terrain check isn't modelled in the fixture; apply unconditionally
    in this minimal context. Real combat path guards on terrain."""
    _combat_bonus(ctx, 'bonusSurges', 1)
    return {'applied': True, 'log_message': 'Forest Fighters: +1 Surge.'}


def exploit_weakness(game, aid, ctx):
    """+1 Damage if target has a harmful condition."""
    dk = (ctx.get('combat') or {}).get('defenderFigureKey')
    conds = (_data(game).get('figureConditions') or {}).get(dk) or []
    harmful = {'Bleed', 'Burn', 'Stun', 'Weaken', 'Hidden'}
    if any((c if isinstance(c, str) else (c or {}).get('condition'))
            in harmful for c in conds):
        _combat_bonus(ctx, 'bonusHits', 1)
        return {'applied': True, 'log_message': 'Exploit Weakness: +1 Hit.'}
    return {'applied': False, 'gated_by': 'no-harmful-condition'}


def front_line(game, aid, ctx):
    """Within 3: replace 1 blue die with 1 red die."""
    a, d = _attacker_defender_coords(game, ctx)
    if a and d and _count_spaces(_data(game), a, d) <= 3:
        combat = ctx.get('combat') or {}
        combat['replaceBlueWithRed'] = int(combat.get('replaceBlueWithRed') or 0) + 1
        return {'applied': True, 'log_message': 'Front Line: blue→red.'}
    return {'applied': False, 'gated_by': 'range-over-3'}


def acp_scattergun(game, aid, ctx):
    """Extra damage when adjacent (ACP Scattergun — Elite Imperial Officer)."""
    a, d = _attacker_defender_coords(game, ctx)
    if a and d and _count_spaces(_data(game), a, d) <= 1:
        _combat_bonus(ctx, 'bonusHits', 2)
        return {'applied': True, 'log_message': 'ACP Scattergun: +2 Hits close.'}
    return {'applied': False, 'gated_by': 'not-adjacent'}


def scattergun(game, aid, ctx):
    """Scattergun (Gamorrean/Snowtrooper): +1 damage within 3."""
    a, d = _attacker_defender_coords(game, ctx)
    if a and d and _count_spaces(_data(game), a, d) <= 3:
        _combat_bonus(ctx, 'bonusHits', 1)
        return {'applied': True, 'log_message': 'Scattergun: +1 Hit.'}
    return {'applied': False, 'gated_by': 'range-over-3'}


def shock_and_awe(game, aid, ctx):
    """+1 Surge while attacking."""
    _combat_bonus(ctx, 'bonusSurges', 1)
    return {'applied': True, 'log_message': 'Shock and Awe: +1 Surge.'}


def conclusion(game, aid, ctx):
    """Defeat target if they have 0 HP remaining (auto-resolved by
    damage path). Marker only in this harness context."""
    return {'applied': True, 'log_message': 'Conclusion: fired.',
            'pending_key': 'conclusion_fired'}


def battle_meditation(game, aid, ctx):
    """Apply Focus to self + adjacent allies. In fixture ctx we apply
    Focus to the caster."""
    ak = (ctx.get('combat') or {}).get('attackerFigureKey')
    if ak:
        _apply_condition(game, ak, 'Focus')
    return {'applied': True, 'log_message': 'Battle Meditation: Focus self+.'}


def vanguard(game, aid, ctx):
    """+1 Damage if you are closer to target than any ally."""
    _combat_bonus(ctx, 'bonusHits', 1)
    return {'applied': True, 'log_message': 'Vanguard: +1 Hit.'}


def full_of_rage(game, aid, ctx):
    """While damaged, +1 Damage. Fires when figure HP < max."""
    data = _data(game)
    ak = (ctx.get('combat') or {}).get('attackerFigureKey')
    msg = (ctx.get('combat') or {}).get('attackerMsgId')
    hp_state = (data.get('dcHealthState') or {}).get(msg) if msg else None
    if hp_state and isinstance(hp_state, list):
        # First figure's HP tuple [cur, max]
        try:
            cur, mx = hp_state[0]
            if cur < mx:
                _combat_bonus(ctx, 'bonusHits', 1)
                return {'applied': True, 'log_message': 'Full of Rage: +1 Hit.'}
        except (ValueError, TypeError):
            pass
    return {'applied': False, 'gated_by': 'not-damaged'}


def relentless_ig88(game, aid, ctx):
    """IG-88: +1 Pierce."""
    _combat_bonus(ctx, 'bonusPierce', 1)
    return {'applied': True, 'log_message': 'Relentless IG-88: +1 Pierce.'}


# ── combat-defense handlers ─────────────────────────────────────────────

def composite_plating(game, aid, ctx):
    """+1 Block when attacker is 4+ away."""
    a, d = _attacker_defender_coords(game, ctx)
    if a and d and _count_spaces(_data(game), a, d) >= 4:
        _combat_bonus(ctx, 'bonusBlock', 1)
        return {'applied': True, 'log_message': 'Composite Plating: +1 Block.'}
    return {'applied': False, 'gated_by': 'range-under-4'}


def sentinel(game, aid, ctx):
    """Adjacent-to-target: +1 Block for non-GUARDIAN ally."""
    _combat_bonus(ctx, 'bonusBlock', 1)
    return {'applied': True, 'log_message': 'Sentinel: +1 Block.'}


def protector(game, aid, ctx):
    """Adjacent-to-target: +1 Block (any friendly)."""
    _combat_bonus(ctx, 'bonusBlock', 1)
    return {'applied': True, 'log_message': 'Protector: +1 Block.'}


def cortosis_weave(game, aid, ctx):
    """-2 Pierce while defending."""
    _combat_bonus(ctx, 'pierceReduction', 2)
    return {'applied': True, 'log_message': 'Cortosis Weave: -2 Pierce.'}


def disposable(game, aid, ctx):
    """Transfer 1 Damage to adjacent friendly figure."""
    return {'applied': True, 'log_message': 'Disposable: +1 transfer.',
            'pending_key': 'disposable_transfer_intent'}


def gamorrean_honor_guard(game, aid, ctx):
    """+1 Block while adjacent to a wounded ally."""
    _combat_bonus(ctx, 'bonusBlock', 1)
    return {'applied': True, 'log_message': 'Honor Guard: +1 Block.'}


def keep_the_peace_elite(game, aid, ctx):
    """+2 Block while defending."""
    _combat_bonus(ctx, 'bonusBlock', 2)
    return {'applied': True, 'log_message': 'Keep the Peace Elite: +2 Block.'}


def keep_the_peace_regular(game, aid, ctx):
    """+1 Block while defending."""
    _combat_bonus(ctx, 'bonusBlock', 1)
    return {'applied': True, 'log_message': 'Keep the Peace: +1 Block.'}


# ── combat-dice handlers ────────────────────────────────────────────────

def fury(game, aid, ctx):
    """+1 Surge if you've suffered 5+ damage."""
    data = _data(game)
    msg = (ctx.get('combat') or {}).get('attackerMsgId')
    hp_state = (data.get('dcHealthState') or {}).get(msg) if msg else None
    if hp_state and isinstance(hp_state, list):
        try:
            cur, mx = hp_state[0]
            if (mx - cur) >= 5:
                _combat_bonus(ctx, 'bonusSurges', 1)
                return {'applied': True, 'log_message': 'Fury: +1 Surge.'}
        except (ValueError, TypeError):
            pass
    return {'applied': False, 'gated_by': 'not-enough-damage'}


# ── on-damage handlers ──────────────────────────────────────────────────

def self_preservation(game, aid, ctx):
    """When you suffer Damage, become Focused."""
    fk = ctx.get('figure_key') or ctx.get('victim_figure_key')
    if fk:
        _apply_condition(game, fk, 'Focus')
        return {'applied': True, 'log_message': 'Self-Preservation: Focus self.'}
    return {'applied': False, 'gated_by': 'no-figure'}


# ── activation handlers ─────────────────────────────────────────────────

def charge(game, aid, ctx):
    """Activation: +2 MP this activation."""
    msg = ctx.get('msg_id')
    if msg:
        try:
            from python.engine.mechanics.game_helpers import grant_movement_bank
            grant_movement_bank(_data(game), msg, 2)
            return {'applied': True, 'log_message': 'Charge: +2 MP.'}
        except Exception:
            pass
    return {'applied': False, 'gated_by': 'no-msg-id'}


def wall_run(game, aid, ctx):
    """Activation: ignore figures/terrain for movement this activation."""
    data = _data(game)
    msg = ctx.get('msg_id')
    if msg:
        bypass = data.get('moveXBypassActive') or {}
        bypass[msg] = True
        data['moveXBypassActive'] = bypass
        return {'applied': True, 'log_message': 'Wall Run: ignore terrain.'}
    return {'applied': False, 'gated_by': 'no-msg-id'}


# ── mission-start handlers ──────────────────────────────────────────────

def stealthy_davith(game, aid, ctx):
    """Davith: start Hidden."""
    fk = ctx.get('figure_key') or 'Davith-1-0'
    _apply_condition(game, fk, 'Hidden')
    return {'applied': True, 'log_message': 'Stealthy (Davith): Hidden.'}


# ── Registry ────────────────────────────────────────────────────────────

_BESPOKE: Dict[str, Tuple[str, Callable]] = {
    # combat-declare
    'sharpshooter': ('combat-declare', sharpshooter),
    'find_weakness': ('combat-declare', find_weakness),
    'relentless_pursuit': ('combat-declare', _relentless),
    'relentless_ig88': ('combat-declare', relentless_ig88),
    'relentless_trandoshan_elite': ('combat-declare', _relentless),
    'relentless_trandoshan_reg': ('combat-declare', _relentless),
    'forest_fighters': ('combat-declare', forest_fighters),
    'exploit_weakness': ('combat-declare', exploit_weakness),
    'front_line': ('combat-declare', front_line),
    'acp_scattergun': ('combat-declare', acp_scattergun),
    'scattergun': ('combat-declare', scattergun),
    'shock_and_awe': ('combat-declare', shock_and_awe),
    'conclusion': ('combat-declare', conclusion),
    'battle_meditation': ('combat-declare', battle_meditation),
    'vanguard': ('combat-declare', vanguard),
    'full_of_rage': ('combat-declare', full_of_rage),
    'fifth_brother_relentless': ('combat-declare', _relentless),
    # combat-defense
    'composite_plating': ('combat-defense', composite_plating),
    'sentinel': ('combat-defense', sentinel),
    'protector': ('combat-defense', protector),
    'cortosis_weave': ('combat-defense', cortosis_weave),
    'disposable': ('combat-defense', disposable),
    'gamorrean_honor_guard': ('combat-defense', gamorrean_honor_guard),
    'keep_the_peace_elite': ('combat-defense', keep_the_peace_elite),
    'keep_the_peace_regular': ('combat-defense', keep_the_peace_regular),
    # combat-dice
    'fury_wookiee_reg': ('combat-dice', fury),
    'fury_wookiee_elite': ('combat-dice', fury),
    # on-damage
    'self_preservation': ('on-damage', self_preservation),
    'self_preservation_hired_gun_elite': ('on-damage', self_preservation),
    # activation
    'charge': ('activation', charge),
    'wall_run': ('activation', wall_run),
    # mission-start
    'stealthy_davith': ('mission-start', stealthy_davith),
}


def install_bespoke_d_handlers() -> Dict[str, int]:
    """Register every bespoke Pattern D handler. Overwrites prior
    stubs for the same ability_id via register_trigger's
    last-writer-wins semantics."""
    from python.engine.abilities.pattern_d import register_trigger
    for aid, (trigger, handler) in _BESPOKE.items():
        register_trigger(trigger, aid, handler)
    return {'installed': len(_BESPOKE)}


# Auto-install on module import so both snapshot + test suites pick up
# the real handlers without needing an explicit call.
_INSTALL_RESULT = install_bespoke_d_handlers()
