/**
 * Pure helpers for Dark Trooper Mk III's **Advanced Targeting
 * Computer**.
 *
 * Card text: "While attacking, become Focused. If you resolve an
 *  attack die reroll that results in fewer Hits on that die, apply
 *  +1 Hit to the attack results."
 *
 * Helper owns slug id, the Focus-on-declare parameters, the
 * reroll-hit comparison predicate, and the +1 Hit delta. The
 * once-per-attack latch (advTcBonusApplied) and applyConditionWithDie
 * engine call stay handler-owned.
 *
 * Extracted from src/handlers/combat.js:1859 + :3477.
 */

export const ADV_TARGETING_COMPUTER_ABILITY_ID = 'adv_targeting_computer_dark_trooper';
export const ADV_TARGETING_COMPUTER_CONDITION = 'Focus';
export const ADV_TARGETING_COMPUTER_BONUS_DIE = 'green';
export const ADV_TARGETING_COMPUTER_HIT_DELTA = 1;

export function hasAdvTargetingComputerAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(ADV_TARGETING_COMPUTER_ABILITY_ID);
}

/**
 * True iff the rerolled die produced strictly fewer Hits than the
 * original (treating undefined dmg as 0).
 *
 * Note the card text says "fewer Hits", and the handler reads
 * die.dmg (damage icons on this game's dice = Hit count). Helper
 * preserves that mapping.
 */
export function advTcRerollLostHits(oldDie, newDie) {
  const oldDmg = (oldDie?.dmg || 0);
  const newDmg = (newDie?.dmg || 0);
  return newDmg < oldDmg;
}

export function applyAdvTcHitBonus({ bonusHits = 0 } = {}) {
  return {
    applied: true,
    bonusHits: (bonusHits || 0) + ADV_TARGETING_COMPUTER_HIT_DELTA,
  };
}
