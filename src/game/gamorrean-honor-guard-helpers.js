/**
 * Pure helpers for Gamorrean Guard (Elite)'s **Gamorrean Honor Guard**.
 *
 * Card text: "While defending against a Ranged attack, apply +1 Block."
 *
 * Defender passive with ranged-attack gate. Extracted from
 * src/handlers/combat.js:1892.
 */

export const GAMORREAN_HONOR_GUARD_ABILITY_ID = 'gamorrean_honor_guard';
export const GAMORREAN_HONOR_GUARD_BONUS_BLOCK = 1;

export function hasGamorreanHonorGuardAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(GAMORREAN_HONOR_GUARD_ABILITY_ID);
}

export function gamorreanHonorGuardApplies(isRanged) {
  return isRanged === true;
}

export function applyGamorreanHonorGuardBonus({ bonusBlock = 0 } = {}) {
  return {
    applied: true,
    bonusBlock: (bonusBlock || 0) + GAMORREAN_HONOR_GUARD_BONUS_BLOCK,
  };
}
