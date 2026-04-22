/**
 * Pure helpers for two simple -1 Evade passives:
 *  - **Disposable** (Hired Gun Regular, defender side): own defense
 *    takes -1 Evade. "Paid to take hits."
 *  - **Conclusion** (HK-47, attacker side): -1 Evade to defender
 *    defense results.
 *
 * Both share identical math (bonusEvade -= 1) and the same helper
 * shape. Extracted from src/handlers/combat.js:1880 (Conclusion) and
 * :1892 (Disposable).
 */

export const DISPOSABLE_ABILITY_ID = 'disposable';
export const CONCLUSION_ABILITY_ID = 'conclusion';
export const EVADE_DEBUFF_DELTA = -1;

export function hasDisposableAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(DISPOSABLE_ABILITY_ID);
}

export function hasConclusionAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(CONCLUSION_ABILITY_ID);
}

export function applyEvadeDebuff({ bonusEvade = 0 } = {}) {
  return {
    applied: true,
    bonusEvade: (bonusEvade || 0) + EVADE_DEBUFF_DELTA,
  };
}
