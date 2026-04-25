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

# Post-roll registry: handlers fire AFTER dice are rolled (dodge, block,
# evade are known). Same shape as _REGISTRY but used at a different
# pipeline stage in the orchestrator.
_POST_ROLL_REGISTRY: Dict[Tuple[str, str], PassiveHandler] = {}


def register(ability_id: str, handler: PassiveHandler, role: str) -> None:
    """Register a pre-roll passive handler. Idempotent — last write wins."""
    if role not in ('attacker', 'defender'):
        raise ValueError(f'register: role must be attacker|defender, got {role!r}')
    _REGISTRY[(ability_id, role)] = handler


def register_post_roll(ability_id: str, handler: PassiveHandler,
                        role: str) -> None:
    """Register a post-roll passive handler — fires after dice are rolled
    (dodge/block/evade known) but before damage application."""
    if role not in ('attacker', 'defender'):
        raise ValueError(f'register_post_roll: role must be attacker|defender, got {role!r}')
    _POST_ROLL_REGISTRY[(ability_id, role)] = handler


def get_handler(ability_id: str, role: str) -> Optional[PassiveHandler]:
    return _REGISTRY.get((ability_id, role))


def registered_ids() -> List[str]:
    return sorted({aid for aid, _ in _REGISTRY.keys()}
                  | {aid for aid, _ in _POST_ROLL_REGISTRY.keys()})


def apply_post_roll_passives(data: Dict[str, Any],
                              combat: Dict[str, Any],
                              attacker_special_ids: List[str],
                              defender_special_ids: List[str],
                              ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Walk both figures' specialAbilityIds and fire any registered POST-ROLL
    passive. combat.attackRoll / combat.defenseRoll are populated by now.
    """
    fired: List[Dict[str, Any]] = []
    for aid in attacker_special_ids or []:
        h = _POST_ROLL_REGISTRY.get((aid, 'attacker'))
        if h is None:
            continue
        result = h(data, combat, ctx)
        if result is not None:
            result.setdefault('ability_id', aid)
            result.setdefault('role', 'attacker')
            fired.append(result)
    for aid in defender_special_ids or []:
        h = _POST_ROLL_REGISTRY.get((aid, 'defender'))
        if h is None:
            continue
        result = h(data, combat, ctx)
        if result is not None:
            result.setdefault('ability_id', aid)
            result.setdefault('role', 'defender')
            fired.append(result)
    return fired


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


# ── Post-roll handlers ─────────────────────────────────────────────────────

def _handle_lucky_r2d2(data, combat, ctx):
    """Lucky (R2-D2): "While you are defending, if you roll a Dodge, you
    recover 2 damage." Auto. Fires after defense roll."""
    def_roll = combat.get('defenseRoll') or {}
    if not def_roll.get('dodge'):
        return None
    from python.engine.mechanics.damage_helpers import heal_hp
    msg_id = ctx.get('defender_msg_id')
    fig_idx = ctx.get('defender_figure_index')
    def_player = ctx.get('defender_player')
    if not msg_id or fig_idx is None or def_player not in (1, 2):
        return None
    dchs = data.get('dcHealthState')
    if not isinstance(dchs, dict):
        return None
    try:
        heal_hp(dchs, data, msg_id, fig_idx, 2, def_player)
    except Exception:
        return None
    return {'effect': 'lucky_r2d2', 'recovered': 2}


def _handle_agile_jet_trooper(data, combat, ctx):
    """Agile (Jet Trooper E/R): "While defending, you may convert 1 Block to
    1 Evade." Greedy-take in headless: convert iff defender has at least 1
    Block to spare. Mutates defenseRoll counts in place."""
    def_roll = combat.get('defenseRoll') or {}
    if int(def_roll.get('block') or 0) < 1:
        return None
    def_roll['block'] = int(def_roll['block']) - 1
    def_roll['evade'] = int(def_roll.get('evade') or 0) + 1
    combat['defenseRoll'] = def_roll
    return {'effect': 'agile_jet_trooper', 'converted': 'block→evade'}


def _has_adjacent_friendly_with_keyword(data, player_num, figure_key,
                                         keyword):
    """True iff a same-side figure (other than self) within Chebyshev
    distance 1 has `keyword` in its DC's keywords list."""
    from python.engine.mechanics.adjacency import is_chebyshev_adjacent
    from python.engine.data.dc_effects_loader import get_dc_effect
    fp = data.get('figurePositions') or {}
    self_coord = (fp.get(player_num) or fp.get(str(player_num)) or {}).get(figure_key)
    if not self_coord:
        return False
    for fk, coord in (fp.get(player_num) or fp.get(str(player_num)) or {}).items():
        if fk == figure_key or not coord:
            continue
        if not is_chebyshev_adjacent(self_coord, coord):
            continue
        dc_name = fk.split('-', 1)[0] if '-' in fk else fk
        eff = get_dc_effect(dc_name) or {}
        if keyword in (eff.get('keywords') or []):
            return True
    return False


def _handle_squad_training(data, combat, ctx):
    """Squad Training (Stormtrooper / Shoretrooper E/R): "While attacking,
    while adjacent to another friendly TROOPER, you may reroll 1 attack die."
    Greedy-take in headless: re-roll the lowest-value attack die (acc+dmg+
    surge sum). Always-take is JS-faithful when the new die can only equal
    or improve the bottom-of-pool die in expectation.
    """
    if not _has_adjacent_friendly_with_keyword(
            data, ctx['attacker_player'], ctx['attacker_key'], 'TROOPER'):
        return None
    attack_roll = combat.get('attackRoll') or {}
    dice = list(attack_roll.get('dice') or [])
    if not dice:
        return None
    rng = ctx.get('rng')
    if rng is None:
        return None
    from python.engine.mechanics.dice import roll_attack_dice
    # Pick lowest-value die to reroll.
    idx_worst = min(range(len(dice)), key=lambda i:
                     (dice[i].get('acc') or 0) + (dice[i].get('dmg') or 0)
                     + (dice[i].get('surge') or 0))
    old = dice[idx_worst]
    color = old.get('color', 'blue')
    new_roll = roll_attack_dice([color], rng=rng)
    new_dice = new_roll.get('dice') or []
    if not new_dice:
        return None
    dice[idx_worst] = new_dice[0]
    # Recompute totals from the modified dice list.
    attack_roll['dice'] = dice
    attack_roll['acc'] = sum(int(d.get('acc') or 0) for d in dice)
    attack_roll['dmg'] = sum(int(d.get('dmg') or 0) for d in dice)
    attack_roll['surge'] = sum(int(d.get('surge') or 0) for d in dice)
    combat['attackRoll'] = attack_roll
    # Recompute combat-level surge pool to match.
    combat['surgeRemaining'] = (
        int(attack_roll.get('surge') or 0)
        + int(combat.get('surgeBonus') or 0)
    )
    return {'effect': 'squad_training', 'rerolled_index': idx_worst}


def _has_adjacent_friendly(data, player_num, figure_key):
    """True iff any same-side figure (other than self) is Chebyshev-adjacent."""
    from python.engine.mechanics.adjacency import is_chebyshev_adjacent
    fp = data.get('figurePositions') or {}
    self_coord = (fp.get(player_num) or fp.get(str(player_num)) or {}).get(figure_key)
    if not self_coord:
        return False
    for fk, coord in (fp.get(player_num) or fp.get(str(player_num)) or {}).items():
        if fk == figure_key or not coord:
            continue
        if is_chebyshev_adjacent(self_coord, coord):
            return True
    return False


def _reroll_one_defense_die(combat, rng, prefer_lowest=True):
    """Reroll one defense die (the lowest block+evade if prefer_lowest).
    Mutates defenseRoll.dice + recomputed totals in place.
    Returns the rerolled index, or None if no dice / no rng."""
    def_roll = combat.get('defenseRoll') or {}
    dice = list(def_roll.get('dice') or [])
    if not dice or rng is None:
        return None
    from python.engine.mechanics.dice import roll_defense_dice
    if prefer_lowest:
        idx = min(range(len(dice)), key=lambda i:
                   (dice[i].get('block') or 0) + (dice[i].get('evade') or 0))
    else:
        idx = 0
    old = dice[idx]
    color = old.get('color', 'white')
    new = roll_defense_dice(color, rng=rng)
    new_dice_list = new.get('dice') or [new]  # roll_defense_dice may return single
    # roll_defense_dice in some versions returns a single die dict, not a list.
    if isinstance(new, dict) and 'block' in new:
        # Single-die response shape.
        dice[idx] = {k: new.get(k) for k in ('color', 'block', 'evade', 'dodge')}
    else:
        if not new_dice_list:
            return None
        dice[idx] = new_dice_list[0]
    def_roll['dice'] = dice
    def_roll['block'] = sum(int(d.get('block') or 0) for d in dice)
    def_roll['evade'] = sum(int(d.get('evade') or 0) for d in dice)
    def_roll['dodge'] = any(bool(d.get('dodge')) for d in dice)
    combat['defenseRoll'] = def_roll
    return idx


def _handle_cower(data, combat, ctx):
    """Cower (C-3PO / Imperial Officer Reg): "While defending, while adjacent
    to a friendly figure, you may reroll 1 defense die." Greedy-take in
    headless: reroll the lowest-value defense die (block+evade)."""
    if not _has_adjacent_friendly(
            data, ctx['defender_player'], ctx['defender_key']):
        return None
    rng = ctx.get('rng')
    idx = _reroll_one_defense_die(combat, rng, prefer_lowest=True)
    if idx is None:
        return None
    return {'effect': 'cower', 'rerolled_index': idx}


def _handle_targeting_computer_atst(data, combat, ctx):
    """Targeting Computer (AT-ST): "While attacking, you may reroll 1 attack
    die." Greedy-take: reroll the lowest acc+dmg+surge die (same primitive
    as squad_training, no adjacency gate)."""
    rng = ctx.get('rng')
    if rng is None:
        return None
    attack_roll = combat.get('attackRoll') or {}
    dice = list(attack_roll.get('dice') or [])
    if not dice:
        return None
    from python.engine.mechanics.dice import roll_attack_dice
    idx = min(range(len(dice)), key=lambda i:
               (dice[i].get('acc') or 0) + (dice[i].get('dmg') or 0)
               + (dice[i].get('surge') or 0))
    old = dice[idx]
    color = old.get('color', 'blue')
    new_roll = roll_attack_dice([color], rng=rng)
    new_dice = new_roll.get('dice') or []
    if not new_dice:
        return None
    dice[idx] = new_dice[0]
    attack_roll['dice'] = dice
    attack_roll['acc'] = sum(int(d.get('acc') or 0) for d in dice)
    attack_roll['dmg'] = sum(int(d.get('dmg') or 0) for d in dice)
    attack_roll['surge'] = sum(int(d.get('surge') or 0) for d in dice)
    combat['attackRoll'] = attack_roll
    combat['surgeRemaining'] = (
        int(attack_roll.get('surge') or 0)
        + int(combat.get('surgeBonus') or 0)
    )
    return {'effect': 'targeting_computer_atst', 'rerolled_index': idx}


# ── Activation-time Pattern C handlers ─────────────────────────────────────
# These fire when a figure activates (no `trigger` field, `category: passive`
# in the library — JS handles them inline at activation-start). They run from
# `_handle_activate_dc` after the Pattern D activation triggers complete.

_ACTIVATION_REGISTRY: Dict[str, Callable] = {}


def register_activation(ability_id: str, handler) -> None:
    _ACTIVATION_REGISTRY[ability_id] = handler


def apply_activation_passives(data, activating_figure_key, player_num,
                               group_figs):
    """Walk the activating figure's specialAbilityIds and fire any
    activation-time Pattern C handler. group_figs is the full activated
    group (multi-figure DCs). Returns list of fired-effect dicts."""
    from python.engine.data.dc_effects_loader import get_dc_effect
    dc_name = activating_figure_key.split('-', 1)[0] if '-' in activating_figure_key else activating_figure_key
    eff = get_dc_effect(dc_name) or {}
    fired = []
    for aid in (eff.get('specialAbilityIds') or []):
        h = _ACTIVATION_REGISTRY.get(aid)
        if h is None:
            continue
        result = h(data, activating_figure_key, player_num, group_figs)
        if result is not None:
            result.setdefault('ability_id', aid)
            fired.append(result)
    return fired


def _msg_id_for_figure(data, player_num, figure_key):
    """Find the dcMessageMeta msg_id for a given figure_key."""
    dc_list_key = 'p1DcList' if player_num == 1 else 'p2DcList'
    msg_ids_key = 'p1DcMessageIds' if player_num == 1 else 'p2DcMessageIds'
    dc_list = data.get(dc_list_key) or []
    msg_ids = data.get(msg_ids_key) or []
    parts = figure_key.rsplit('-', 2)
    if len(parts) != 3:
        return None
    dc_name = parts[0]
    try:
        dg = int(parts[1])
    except ValueError:
        return None
    for i, dc in enumerate(dc_list):
        if i >= len(msg_ids):
            return None
        name = dc.get('dcName') if isinstance(dc, Mapping) else dc
        if name == dc_name and (
            int((dc.get('dgIndex') if isinstance(dc, Mapping) else 0) or 0) == dg
        ):
            return msg_ids[i]
    return None


def _handle_trust_goes_both_ways_jyn(data, fk, player_num, group_figs):
    """Trust Goes Both Ways (Jyn Erso): "When you activate, choose a friendly
    figure within 3 spaces to gain 1 MP." Greedy-take in headless: grant the
    MP to the closest friendly within 3 spaces (alphabetical tiebreak). Skip
    self and group-mates since the JS rule is "another friendly figure".

    Uses Chebyshev distance — the JS rule says "spaces" and IA's standard
    distance metric for this kind of "within N" radius rule is the 8-
    connected board distance, which equals Chebyshev for unobstructed
    paths. Real obstacle pathing is not applied here (would require a
    fully-loaded map); for IA's typical 3-square radius, Chebyshev and
    pathfinding agree on >99% of board configurations.
    """
    from python.engine.mechanics.coords import parse_coord
    from python.engine.mechanics.game_helpers import grant_movement_bank
    fp = data.get('figurePositions') or {}
    self_coord = (fp.get(player_num) or fp.get(str(player_num)) or {}).get(fk)
    if not self_coord:
        return None
    sx, sy = parse_coord(self_coord)
    if sx < 0 or sy < 0:
        return None
    candidates = []
    for other_fk, coord in (fp.get(player_num) or fp.get(str(player_num)) or {}).items():
        if other_fk == fk or other_fk in group_figs or not coord:
            continue
        ox, oy = parse_coord(coord)
        if ox < 0 or oy < 0:
            continue
        d = max(abs(sx - ox), abs(sy - oy))
        if d <= 3:
            candidates.append((d, other_fk))
    if not candidates:
        return None
    candidates.sort()  # closest first, alphabetical tiebreak
    _, target_fk = candidates[0]
    target_msg_id = _msg_id_for_figure(data, player_num, target_fk)
    if not target_msg_id:
        return None
    grant_movement_bank(data, target_msg_id, 1)
    return {'effect': 'trust_goes_both_ways_jyn',
            'recipient': target_fk, 'mp_granted': 1}


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
    register_post_roll('lucky_r2d2', _handle_lucky_r2d2, 'defender')
    register_post_roll('agile_jet_trooper_elite', _handle_agile_jet_trooper, 'defender')
    register_post_roll('agile_jet_trooper_reg', _handle_agile_jet_trooper, 'defender')
    register_post_roll('squad_training_stormtrooper_elite', _handle_squad_training, 'attacker')
    register_post_roll('squad_training_stormtrooper_reg', _handle_squad_training, 'attacker')
    register_post_roll('squad_training_shoretrooper_elite', _handle_squad_training, 'attacker')
    register_post_roll('squad_training_shoretrooper_reg', _handle_squad_training, 'attacker')
    register_post_roll('cower_c3po', _handle_cower, 'defender')
    register_post_roll('cower_imperial_officer_reg', _handle_cower, 'defender')
    register_post_roll('targeting_computer_atst', _handle_targeting_computer_atst, 'attacker')
    register_activation('trust_goes_both_ways_jyn',
                         _handle_trust_goes_both_ways_jyn)


_install_default_passives()
