/**
 * Pure helpers for Ko-Tun Feralo's **Dead Precise**.
 *
 * Card text: "If you have not exited a space during this activation,
 *  apply +2 Accuracy to your attack results."
 *
 * Movement-gate attacker passive. Same gate as Aim (Rebel Trooper
 * Regular) but half the payload (only +2 Accuracy, no Hit bump).
 *
 * Extracted from src/handlers/combat.js (Dead Precise block ~line 2121).
 */

export const DEAD_PRECISE_ABILITY_ID = 'dead_precise_kotun';
export const DEAD_PRECISE_BONUS_ACCURACY = 2;

export function hasDeadPreciseAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(DEAD_PRECISE_ABILITY_ID);
}

export function deadPreciseBonusApplies(figureKey, figureMoved = {}) {
  if (!figureKey) return false;
  return !figureMoved?.[figureKey];
}

export function applyDeadPreciseBonus({ bonusAccuracy = 0 } = {}) {
  return {
    applied: true,
    bonusAccuracy: (bonusAccuracy || 0) + DEAD_PRECISE_BONUS_ACCURACY,
  };
}
