/**
 * Pure helpers for Weequay Pirate (Elite/Regular)'s **Raider**.
 *
 * Card text: "While attacking, you may choose 1 die. The player that
 *  rolled that die must reroll that die."
 *
 * Attacker-controlled forced reroll on any pool. Extracted from
 * src/handlers/combat.js:2883. Two slugs share identical behavior.
 */

export const RAIDER_WEEQUAY_ABILITY_IDS = Object.freeze([
  'raider_weequay_elite',
  'raider_weequay_reg',
]);

export const RAIDER_FORCED_REROLL_POOL = 'any';
export const RAIDER_FORCED_REROLL_COUNT = 1;
export const RAIDER_SOURCE_LABEL = 'Raider';

export function hasRaiderAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return RAIDER_WEEQUAY_ABILITY_IDS.some((id) => specialAbilityIds.includes(id));
}

export function buildRaiderForcedReroll(attackerPlayerNum) {
  return {
    controlPlayer: attackerPlayerNum,
    pool: RAIDER_FORCED_REROLL_POOL,
    remaining: RAIDER_FORCED_REROLL_COUNT,
    source: RAIDER_SOURCE_LABEL,
  };
}
