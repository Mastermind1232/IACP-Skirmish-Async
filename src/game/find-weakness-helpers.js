/**
 * Pure helpers for Scout Trooper (Elite)'s **Find Weakness**.
 *
 * Card text: "While attacking, apply +3 Accuracy and -1 Evade to
 *  the results."
 *
 * IMPORTANT — current handler (src/handlers/combat.js:1877) only
 * applies the -1 Evade; the comment says "accuracy handled via
 * passives" but no +3 Accuracy is actually wired. See the LATENT
 * tripwire in the probe.
 *
 * This helper pins the -1 Evade portion. The +3 Accuracy gap is
 * documented via a LATENT-* tripwire in the library probe.
 */

export const FIND_WEAKNESS_ABILITY_ID = 'find_weakness';
export const FIND_WEAKNESS_EVADE_DELTA = -1;

export function hasFindWeaknessAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(FIND_WEAKNESS_ABILITY_ID);
}

/**
 * Apply the -1 Evade debuff portion of Find Weakness. The +3
 * Accuracy portion is NOT applied here — see module header.
 */
export function applyFindWeaknessEvade({ bonusEvade = 0 } = {}) {
  return {
    applied: true,
    bonusEvade: (bonusEvade || 0) + FIND_WEAKNESS_EVADE_DELTA,
  };
}
