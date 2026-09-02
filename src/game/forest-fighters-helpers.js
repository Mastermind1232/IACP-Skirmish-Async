/**
 * Pure helpers for Ewok Warrior Elite's **Forest Fighters**.
 *
 * Card text: "While performing a melee attack, if you are Hidden,
 *  apply +1 Damage to the attack results."
 *
 * Helper owns slug id, required condition, hit delta, and the
 * qualification predicate (melee attack + attacker Hidden).
 * Condition lookup + attack-type flag stay handler-owned inputs.
 *
 * Extracted from src/handlers/combat.js:2045.
 */

export const FOREST_FIGHTERS_ABILITY_ID = 'forest_fighters';
export const FOREST_FIGHTERS_HIT_DELTA = 1;
export const FOREST_FIGHTERS_REQUIRED_CONDITION = 'Hide';

export function hasForestFightersAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(FOREST_FIGHTERS_ABILITY_ID);
}

/**
 * Qualifies iff attack is melee (isRanged === false) AND the
 * attacker is Hidden.
 */
export function forestFightersQualifies({ isRanged, attackerConditions } = {}) {
  if (isRanged) return false;
  if (!Array.isArray(attackerConditions)) return false;
  return attackerConditions.includes(FOREST_FIGHTERS_REQUIRED_CONDITION);
}

export function applyForestFightersHit({ bonusHits = 0 } = {}) {
  return {
    applied: true,
    bonusHits: (bonusHits || 0) + FOREST_FIGHTERS_HIT_DELTA,
  };
}
