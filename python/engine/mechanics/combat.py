"""D2.21 + D2.23 — compute_combat_result, the core attack-pipeline resolver.

Byte-identical port of `computeCombatResult(combat)` in
`src/game/combat.js` lines 263-370. Consumes a pre-rolled attack/defense +
surge-spend context and produces the final `{hit, damage, effectiveBlock,
resultText}` quad. No Discord, no game-state writes — purely functional.

D2.22 — reroll window helpers (`grant_round_attack_reroll`,
`get_round_attack_rerolls_available`, `clear_round_attack_rerolls`) that
mirror the JS flow:

  - Set   (src/game/abilities.js:6112-6117, 8240-8241) via CC grant, keyed
    per-player: `game.roundAttackRerollDice[playerNum] += N`.
  - Read  (src/handlers/combat.js:2862) as one summand of the per-attack
    reroll-count; consumption is handler-driven and not gated by this module.
  - Reset (src/game/activation-state.js:164) via cleanupRoundStart →
    ROUND_OBJECT_FLAGS → `{}` at round start.

Python keeps the state in a plain dict so callers can drop it straight into
the GameState mapping once D1 state shape is wired up. The helpers are pure —
all pass the container explicitly.

Damage + armor reduction (D2.23) — armor in Imperial Assault is not a flat
reduction; it's `block` results rolled on defense dice (white/black) plus
bonus block from abilities (tokens, CCs) and Cunning evade→block. All of
those collapse into `effectiveBlock` inside `compute_combat_result`, which is
then subtracted from the damage total. No separate `apply_armor` step exists
in the JS engine, so none is added here.
"""
from __future__ import annotations

from typing import Any, Dict


def compute_combat_result(combat: Dict[str, Any]) -> Dict[str, Any]:
    """Compute the final combat outcome from a pre-rolled combat context.

    Mirrors JS `computeCombatResult`:
      - Applies Dodge / ranged-accuracy / forceMiss miss gates.
      - Converts Wookiee Avenger dodge→evade BEFORE the miss check (mutates
        `combat.defenseRoll` in place, matching JS).
      - Combines surge + bonus modifiers into pierce/acc/hits/block/evade.
      - Cunning: +1 block per defense evade.
      - ignoreDefenseResultsNotOnDice strips bonusBlock (keeps rolled block +
        Cunning).
      - Defender Weaken: −1 effective block. Attacker Weaken: −1 damage if >0.
      - maxDamageToDefender clamp applied last.
      - attackResultReplaceWithStun zeroes damage and appends 'Stun' to
        bonusConditions (mutates combat, matching JS).

    Returns `{hit: bool, damage: int, effectiveBlock: int, resultText: str}`.
    """
    roll = combat['attackRoll']
    def_roll = combat['defenseRoll']

    surge_d = combat.get('surgeDamage') or 0
    surge_p = combat.get('surgePierce') or 0
    bonus_pierce = combat.get('bonusPierce') or 0
    total_pierce = max(0, surge_p + bonus_pierce)

    surge_a = combat.get('surgeAccuracy') or 0
    bonus_acc = combat.get('bonusAccuracy') or 0
    bonus_hits = combat.get('bonusHits') or 0
    bonus_block = combat.get('bonusBlock') or 0
    bonus_evade = combat.get('bonusEvade') or 0
    evade_cancelled = combat.get('evadeCancelledSurge') or 0

    defender_conds = combat.get('defenderConds') or []
    attacker_conds = combat.get('attackerConds') or []

    defender_hidden = 'Hide' in defender_conds
    hidden_acc_penalty = 2 if defender_hidden else 0
    defender_acc_penalty = combat.get('defenderAccuracyPenalty') or 0
    total_accuracy = (roll.get('acc', 0) or 0) + surge_a + bonus_acc - hidden_acc_penalty - defender_acc_penalty

    hit = True
    miss_reason = ''
    # C4: On the Lam — forced miss.
    if combat.get('forceMiss'):
        hit = False
        miss_reason = 'On the Lam (target moved out of LOS)'

    # Wookiee Avenger: convert Dodge → Evade before the dodge miss check.
    if def_roll.get('dodge') and combat.get('wookieeAvengerDefend'):
        def_roll['evade'] = (def_roll.get('evade', 0) or 0) + 1
        def_roll['dodge'] = False

    if def_roll.get('dodge') and not combat.get('surgeCancelDodge'):
        hit = False
        miss_reason = 'Dodge'
    elif combat.get('isRanged') and combat.get('distanceToTarget') is not None:
        if total_accuracy < combat['distanceToTarget']:
            hit = False
            miss_reason = f'insufficient accuracy ({total_accuracy} < {combat["distanceToTarget"]} distance)'

    # Combat Suit: reduce pierce applied to defender by N.
    def_reduce_pierce = combat.get('defenderReducePierce') or 0
    pierce_to_use = 0 if combat.get('defenderIgnorePierce') else max(0, total_pierce - def_reduce_pierce)

    surge_cancel = combat.get('surgeCancel') or 0

    # Cunning: +1 block per rolled evade when defending.
    cunning_bonus = (def_roll.get('evade', 0) or 0) if combat.get('hasCunning') else 0

    if combat.get('ignoreDefenseResultsNotOnDice'):
        block_for_calc = (def_roll.get('block', 0) or 0) + cunning_bonus
    else:
        block_for_calc = (def_roll.get('block', 0) or 0) + bonus_block + cunning_bonus

    effective_block = max(0, block_for_calc - surge_cancel - pierce_to_use)

    # Defender Weakened: −1 effective block.
    defender_weakened = 'Weaken' in defender_conds
    if defender_weakened:
        effective_block = max(0, effective_block - 1)

    defense_dice_count = combat.get('defenseDiceCount')
    if defense_dice_count is None:
        defense_dice_count = 1
    per_def_die_damage = (combat.get('bonusDamagePerDefenseDie') or 0) * defense_dice_count

    if hit:
        damage = max(0, (roll.get('dmg', 0) or 0) + surge_d + bonus_hits + per_def_die_damage - effective_block)
    else:
        damage = 0

    # Attacker Weakened: −1 damage if >0.
    attacker_weakened = 'Weaken' in attacker_conds
    if attacker_weakened and damage > 0:
        damage = max(0, damage - 1)

    # Damage cap.
    max_dmg = combat.get('maxDamageToDefender')
    if max_dmg is not None and damage > max_dmg:
        damage = max_dmg

    surge_conds = list(combat.get('surgeConditions') or [])
    bonus_conds = list(combat.get('bonusConditions') or [])
    all_conds = surge_conds + bonus_conds

    # Set for Stun (attackResultReplaceWithStun): zero damage + add Stun to bonusConditions.
    if combat.get('attackResultReplaceWithStun') and damage > 0:
        damage = 0
        if 'Stun' not in (combat.get('bonusConditions') or []):
            if combat.get('bonusConditions') is None:
                combat['bonusConditions'] = []
            combat['bonusConditions'].append('Stun')

    # Result text — mirror JS formatting byte-for-byte.
    conditions_text = f' ({", ".join(all_conds)})' if all_conds else ''
    bonus_blast = combat.get('bonusBlast') or 0
    total_blast_display = (combat.get('surgeBlast') or 0) + bonus_blast
    blast_text = f' Blast {total_blast_display}' if total_blast_display else ''
    recover_text = f' Recover {combat["surgeRecover"]}' if combat.get('surgeRecover') else ''
    cleave_text = f' Cleave {combat["surgeCleave"]}' if combat.get('surgeCleave') else ''

    result_text = (
        f'**Result:** Attack: {roll.get("acc", 0) or 0} acc, '
        f'{roll.get("dmg", 0) or 0} dmg, {roll.get("surge", 0) or 0} surge | '
        f'Defense: {def_roll.get("block", 0) or 0} block, {def_roll.get("evade", 0) or 0} evade'
    )
    if bonus_acc:
        result_text += f' | bonus: +{bonus_acc} acc'
    if bonus_hits or per_def_die_damage:
        result_text += f' | bonus: +{(bonus_hits or 0) + per_def_die_damage} Hit'
    if bonus_block and not combat.get('ignoreDefenseResultsNotOnDice'):
        sign = '+' if bonus_block > 0 else ''
        result_text += f' | bonus: {sign}{bonus_block} Block'
    if cunning_bonus:
        result_text += f' | **Cunning**: +{cunning_bonus} Block (from {def_roll.get("evade", 0) or 0} evade)'
    if combat.get('ignoreDefenseResultsNotOnDice'):
        result_text += ' | CC: ignore defense not on dice'
    if evade_cancelled > 0:
        result_text += f' | Evade cancelled {evade_cancelled} surge'
    if bonus_evade:
        sign = '+' if bonus_evade > 0 else ''
        result_text += f' | bonus: {sign}{bonus_evade} Evade'
    if bonus_pierce:
        result_text += f' | bonus: +{bonus_pierce} pierce'
    if bonus_blast:
        result_text += f' | bonus: Blast {bonus_blast}'
    # JS reads combat.bonusConditions FRESH here (after the Set-for-Stun
    # mutation), not the pre-compute snapshot. See src/game/combat.js:352.
    live_bonus_conds = combat.get('bonusConditions') or []
    if live_bonus_conds:
        result_text += f' | CC bonus: {", ".join(live_bonus_conds)}'
    if surge_cancel:
        result_text += f' | **Cancel {surge_cancel}**: -{surge_cancel} block'
    if surge_d or surge_p or surge_a or conditions_text or blast_text or recover_text or cleave_text:
        result_text += f' | Surge: +{surge_d} dmg, +{surge_p} pierce, +{surge_a} acc{conditions_text}{blast_text}{recover_text}{cleave_text}'
    if combat.get('isRanged') and combat.get('distanceToTarget') is not None:
        result_text += f' | Accuracy: {total_accuracy} vs {combat["distanceToTarget"]} distance'
    if attacker_weakened:
        result_text += ' | **Weakened** (attacker -1 dmg)'
    if defender_weakened:
        result_text += ' | **Weakened** (defender -1 block)'
    if defender_hidden:
        result_text += ' | **Hidden** (defender -2 accuracy)'
    if defender_acc_penalty:
        result_text += f' | **CC** (defender -{defender_acc_penalty} accuracy)'
    if def_roll.get('dodge') and combat.get('surgeCancelDodge'):
        # After Wookiee-Avenger conversion def_roll.dodge is False, so this only
        # fires for the original-dodge + deadly_spin path. JS reads def_roll after
        # the mutation too.
        result_text += ' | **Deadly Spin**: Dodge cancelled'
    if not hit:
        result_text += f' → **Miss** ({miss_reason})' if miss_reason else ' → **Miss**'
    else:
        result_text += f' → **{damage} damage**{conditions_text}'
    if combat.get('attackResultReplaceWithStun'):
        result_text += ' (Set for Stun: 0 damage, Stunned)'

    return {
        'hit': hit,
        'damage': damage,
        'effectiveBlock': effective_block,
        'resultText': result_text,
    }


# ── D2.22 — Reroll window (roundAttackRerollDice) ───────────────────────────

def grant_round_attack_reroll(round_attack_reroll_dice: Dict[int, int],
                              player_num: int,
                              amount: int = 1) -> None:
    """Grant `amount` attack rerolls to `player_num` for the remainder of the
    round. Mirrors the JS abilities.js path: additive, per-player.

    The container (`round_attack_reroll_dice`) is a simple dict keyed by
    player number (1 or 2). GameState stores this as `game.roundAttackRerollDice`.
    """
    round_attack_reroll_dice[player_num] = (round_attack_reroll_dice.get(player_num, 0) or 0) + amount


def get_round_attack_rerolls_available(round_attack_reroll_dice: Dict[int, int],
                                       player_num: int) -> int:
    """Return the number of round-granted rerolls available to `player_num`."""
    return round_attack_reroll_dice.get(player_num, 0) or 0


def clear_round_attack_rerolls(round_attack_reroll_dice: Dict[int, int]) -> None:
    """Reset all per-round reroll grants — called from cleanupRoundStart.

    JS flow: `activation-state.js` lists `roundAttackRerollDice` in
    ROUND_OBJECT_FLAGS, which the cleanup helper resets to `{}`. Python
    preserves the dict identity and just clears it in place.
    """
    round_attack_reroll_dice.clear()
