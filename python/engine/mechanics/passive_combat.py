"""Pattern C combat-passive registry.

Pattern C abilities are passive auras read at firing sites. The JS reference
sites for the combat-related ones are in `src/handlers/combat.js`, which
populates `combat.bonus*` fields BEFORE handing off to the resolver.

This module mirrors that pattern in Python: per-attack, after the
`combat-declare` Pattern D triggers fire, we walk both attacker's and
defender's `specialAbilityIds`, look each up in the registry below, and
apply any handler that's registered for it. Each handler is responsible
for both its gate (do conditions allow firing) and its effect (mutating
the `combat` dict).

Registered handlers may freely read:
  - `data` (the game state dict)
  - `combat` (mutable in-flight combat dict — bonusHits, bonusAccuracy,
    bonusEvade, bonusBlock, bonusSurge, attackerFigureKey, defenderFigureKey,
    attackerPlayerNum, defenderPlayerNum, isRanged, distance, attackInfo, …)
  - `ctx` (per-attack metadata: attacker_key, defender_key, attacker_player,
    defender_player, distance, is_ranged, attacker_figure_index, …)

Adding a new passive:
  1. Define `_handle_<ability_id>(data, combat, ctx) -> Optional[dict]`
     that returns either None (no fire) or a dict describing the effect.
  2. Register via `register('<ability_id>', _handle_<ability_id>, role)`
     where role is 'attacker' (only fires when this figure attacks) or
     'defender' (only fires when this figure defends).

Greedy player-choice modeling: for "while attacking, you MAY apply +X" type
abilities, the headless engine takes the bonus when it's strictly positive
(no downside). Mixed-trade abilities (e.g. spray_fire's -3 Acc / +1 Surge)
require an AI policy hook and are intentionally NOT registered here yet.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple


PassiveHandler = Callable[[Dict[str, Any], Dict[str, Any], Dict[str, Any]],
                          Optional[Dict[str, Any]]]


# (ability_id, role) → handler. role ∈ {'attacker', 'defender'}.
_REGISTRY: Dict[Tuple[str, str], PassiveHandler] = {}


def register(ability_id: str, handler: PassiveHandler, role: str) -> None:
    """Register a passive handler. Idempotent — last write wins."""
    if role not in ('attacker', 'defender'):
        raise ValueError(f'register: role must be attacker|defender, got {role!r}')
    _REGISTRY[(ability_id, role)] = handler


def get_handler(ability_id: str, role: str) -> Optional[PassiveHandler]:
    return _REGISTRY.get((ability_id, role))


def registered_ids() -> List[str]:
    return sorted({aid for aid, _ in _REGISTRY.keys()})


def apply_combat_passives(data: Dict[str, Any],
                          combat: Dict[str, Any],
                          attacker_special_ids: List[str],
                          defender_special_ids: List[str],
                          ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Walk both figures' specialAbilityIds and fire any registered passive.

    Returns a list of fired-effect descriptions (for logging / parity tracing).
    """
    fired: List[Dict[str, Any]] = []
    for aid in attacker_special_ids or []:
        h = _REGISTRY.get((aid, 'attacker'))
        if h is None:
            continue
        result = h(data, combat, ctx)
        if result is not None:
            result.setdefault('ability_id', aid)
            result.setdefault('role', 'attacker')
            fired.append(result)
    for aid in defender_special_ids or []:
        h = _REGISTRY.get((aid, 'defender'))
        if h is None:
            continue
        result = h(data, combat, ctx)
        if result is not None:
            result.setdefault('ability_id', aid)
            result.setdefault('role', 'defender')
            fired.append(result)
    return fired


# ── Helpers ────────────────────────────────────────────────────────────────

def _figure_has_moved_this_activation(data: Mapping[str, Any],
                                       player_num: int,
                                       figure_key: str) -> bool:
    """True iff figure_key's current position differs from its activation
    start position. JS equivalent: 'figure has exited a space this activation'.
    """
    starts = (data.get('activationStartPositions') or {})
    pstarts = starts.get(player_num) or starts.get(str(player_num)) or {}
    start_coord = pstarts.get(figure_key)
    if start_coord is None:
        return False
    fp = data.get('figurePositions') or {}
    cur = (fp.get(player_num) or fp.get(str(player_num)) or {}).get(figure_key)
    if cur is None:
        return False
    return str(cur).lower() != str(start_coord).lower()


def _figure_damage_this_activation(data: Mapping[str, Any],
                                    player_num: int,
                                    figure_key: str) -> int:
    """Total damage this figure has dealt this activation (any victim)."""
    fdta = data.get('figureDamageThisActivation') or {}
    pdta = fdta.get(player_num) or fdta.get(str(player_num)) or {}
    return int(pdta.get(figure_key) or 0)


def _group_caused_damage_to_target(data: Mapping[str, Any],
                                    attacker_player: int,
                                    attacker_figure_key: str,
                                    defender_figure_key: str) -> bool:
    """True iff any figure in the attacker's activation group has damaged
    the defender during this activation. JS: walks attackerActivationGroup
    + checks per-target damage tally."""
    active_group = data.get('activeFigureKeys') or []
    dt = data.get('damageDealtThisActivation') or {}
    # JS shape: {attackerFigureKey: {defenderFigureKey: hits}}
    for fk in active_group:
        per_target = dt.get(fk) or {}
        if int(per_target.get(defender_figure_key) or 0) > 0:
            return True
    return False


# ── Handlers ────────────────────────────────────────────────────────────────

def _handle_aim_rebel_trooper_reg(data, combat, ctx):
    """Aim (Rebel Trooper Regular): if attacker has NOT exited a space this
    activation, apply +1 Hit and +2 Accuracy. Auto."""
    if _figure_has_moved_this_activation(
            data, ctx['attacker_player'], ctx['attacker_key']):
        return None
    combat['bonusHits'] = int(combat.get('bonusHits') or 0) + 1
    combat['bonusAccuracy'] = int(combat.get('bonusAccuracy') or 0) + 2
    return {'effect': 'aim_rebel_trooper_reg',
            'bonusHits': 1, 'bonusAccuracy': 2}


def _handle_aim_rebel_trooper_elite(data, combat, ctx):
    """Aim (Rebel Trooper Elite): while attacking, if the target has suffered
    damage during this group's activation, apply +1 Hit and +2 Accuracy. Auto.
    """
    if not _group_caused_damage_to_target(
            data, ctx['attacker_player'], ctx['attacker_key'],
            ctx['defender_key']):
        return None
    combat['bonusHits'] = int(combat.get('bonusHits') or 0) + 1
    combat['bonusAccuracy'] = int(combat.get('bonusAccuracy') or 0) + 2
    return {'effect': 'aim_rebel_trooper_elite',
            'bonusHits': 1, 'bonusAccuracy': 2}


def _handle_adv_targeting_computer(data, combat, ctx):
    """Advanced Targeting Computer (Dark Trooper Mk III): "When you declare
    an attack, you become Focused." Auto-Focus + green die — same primitive
    as Pattern D's battle_meditation. The optional reroll-1-attack-die
    clause is a player-choice that we don't model here (orchestrator-level
    rerolls are a separate path)."""
    from python.engine.mechanics.conditions import apply_condition_with_die
    attacker_key = ctx['attacker_key']
    attack_info = combat.get('attackInfo') or {}
    result = apply_condition_with_die(data, attacker_key, 'Focus',
                                      attack_info, 'green')
    if not result.get('applied'):
        return None
    combat['attackInfo'] = result['attackInfo']
    return {'effect': 'adv_targeting_computer', 'condition_applied': 'Focus',
            'bonus_die': 'green'}


def _handle_dead_precise_kotun(data, combat, ctx):
    """Dead Precise (Ko-Tun Feralo): "While attacking, if you did not move
    during this activation, apply +2 Accuracy." Auto."""
    if _figure_has_moved_this_activation(
            data, ctx['attacker_player'], ctx['attacker_key']):
        return None
    combat['bonusAccuracy'] = int(combat.get('bonusAccuracy') or 0) + 2
    return {'effect': 'dead_precise_kotun', 'bonusAccuracy': 2}


def _handle_improvised_cover_verena(data, combat, ctx):
    """Improvised Cover (Verena Talos): "While defending, if you are adjacent
    to an object or a non-friendly figure (not the attacker), apply +1 Block."
    Object/crate detection is deferred (crates aren't ported yet); we honor
    the non-friendly-non-attacker figure clause, which is the JS-frequent
    case in test traces.
    """
    from python.engine.mechanics.adjacency import is_chebyshev_adjacent
    fp = data.get('figurePositions') or {}
    def_player = ctx['defender_player']
    def_coord = (fp.get(def_player) or fp.get(str(def_player)) or {}).get(
        ctx['defender_key'])
    if not def_coord:
        return None
    atk_key = ctx['attacker_key']
    found_non_friendly = False
    for pn in (1, 2):
        if pn == def_player:
            continue
        for fk, coord in (fp.get(pn) or fp.get(str(pn)) or {}).items():
            if fk == atk_key or not coord:
                continue
            if is_chebyshev_adjacent(def_coord, coord):
                found_non_friendly = True
                break
        if found_non_friendly:
            break
    if not found_non_friendly:
        return None
    combat['bonusBlock'] = int(combat.get('bonusBlock') or 0) + 1
    return {'effect': 'improvised_cover_verena', 'bonusBlock': 1}


def _handle_take_cover_defender(data, combat, ctx):
    """Take Cover (Jawa Scavenger): while defending, MAY apply +1 Block,
    -1 Evade. Greedy-take in headless: +1 Block traded for -1 Evade is
    strictly stronger against attackers whose dice mostly threaten via
    accuracy (typical case for ranged ⇒ rebel-melee dyads). For exact
    JS parity in mixed traces, this needs an AI policy hook; for now we
    take the bonus unconditionally."""
    combat['bonusBlock'] = int(combat.get('bonusBlock') or 0) + 1
    combat['bonusEvade'] = int(combat.get('bonusEvade') or 0) - 1
    return {'effect': 'take_cover', 'bonusBlock': 1, 'bonusEvade': -1}


def _install_default_passives() -> None:
    register('aim_rebel_trooper_reg', _handle_aim_rebel_trooper_reg, 'attacker')
    register('aim_rebel_trooper_elite', _handle_aim_rebel_trooper_elite, 'attacker')
    register('take_cover_jawa_elite', _handle_take_cover_defender, 'defender')
    register('take_cover_jawa_reg', _handle_take_cover_defender, 'defender')
    register('adv_targeting_computer_dark_trooper',
             _handle_adv_targeting_computer, 'attacker')
    register('dead_precise_kotun', _handle_dead_precise_kotun, 'attacker')
    register('improvised_cover_verena', _handle_improvised_cover_verena,
             'defender')


_install_default_passives()
