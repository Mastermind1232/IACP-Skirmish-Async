/**
 * Pure helpers for **Fury** (Wookiee Warrior Elite / Regular).
 *
 * Card text: "While attacking, if you have suffered 5 or more
 *  damage, apply +1 Surge to the attack results (Furious)."
 *
 * Helper owns slug list, damage gate (≥ 5), surge bonus (+1),
 * and damage-trigger predicate. State write (pendingCombat.furyBonus)
 * and display-line composition stay handler-owned.
 *
 * Extracted from src/handlers/combat.js:1832.
 */

export const FURY_ABILITY_IDS = Object.freeze([
  'fury_wookiee_elite',
  'fury_wookiee_reg',
]);

export const FURY_MIN_DAMAGE = 5;
export const FURY_SURGE_BONUS = 1;

export function hasFuryAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.some(id => FURY_ABILITY_IDS.includes(id));
}

/** True iff accumulated damage meets the 5-damage trigger. */
export function furyDamageTriggered(damageSuffered) {
  return Number.isFinite(damageSuffered) && damageSuffered >= FURY_MIN_DAMAGE;
}
