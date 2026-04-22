/**
 * Pure helpers for Heavy Stormtrooper (Elite)'s **Spray Fire**.
 *
 * Card text: "While attacking, you may apply -3 Accuracy and +1 Surge
 *  to the attack results."
 *
 * Current implementation applies the trade-off unconditionally
 * whenever the slug is present (combat.js:2179). The card text's
 * "may apply" wording signals an optional clause — at long ranges the
 * -3 Accuracy outweighs +1 Surge, so real play would decline Spray
 * Fire there. Tripwire on the optionality lives in the probe; see
 * memory/project_latent_bugs_probe_grind.md.
 */

export const SPRAY_FIRE_ABILITY_ID = 'spray_fire_heavy_stormtrooper';
export const SPRAY_FIRE_ACCURACY_DELTA = -3;
export const SPRAY_FIRE_SURGE_DELTA = 1;

export function hasSprayFireAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(SPRAY_FIRE_ABILITY_ID);
}

export function applySprayFire({ bonusAccuracy = 0, surgeBonus = 0 } = {}) {
  return {
    applied: true,
    bonusAccuracy: (bonusAccuracy || 0) + SPRAY_FIRE_ACCURACY_DELTA,
    surgeBonus: (surgeBonus || 0) + SPRAY_FIRE_SURGE_DELTA,
  };
}
