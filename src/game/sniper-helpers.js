/**
 * Pure helpers for Alliance Ranger (Regular/Elite)'s **Sniper** /
 * **Elite Sniper**.
 *
 * Card text (Regular — Sniper): "While attacking, if the target space
 *  is 5 or more spaces away, you reroll 1 attack die."
 * Card text (Elite — Elite Sniper): same gate, reroll 2 attack dice.
 *
 * Two slugs share the 5+ space gate but differ in reroll count. See
 * src/handlers/combat.js:1893 (sniper) and :1899 (elite_sniper).
 */

export const SNIPER_ABILITY_ID = 'sniper';
export const ELITE_SNIPER_ABILITY_ID = 'elite_sniper';
export const SNIPER_MIN_DISTANCE = 5;
export const SNIPER_REROLLS = 1;
export const ELITE_SNIPER_REROLLS = 2;

export function hasSniperAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(SNIPER_ABILITY_ID);
}

export function hasEliteSniperAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(ELITE_SNIPER_ABILITY_ID);
}

export function sniperGateOpen(distanceToTarget) {
  if (typeof distanceToTarget !== 'number') return false;
  return distanceToTarget >= SNIPER_MIN_DISTANCE;
}

export function applySniperRerolls({ rerollOneAttackDie = 0 } = {}, elite = false) {
  const bonus = elite ? ELITE_SNIPER_REROLLS : SNIPER_REROLLS;
  return {
    applied: true,
    rerollOneAttackDie: (rerollOneAttackDie || 0) + bonus,
  };
}
