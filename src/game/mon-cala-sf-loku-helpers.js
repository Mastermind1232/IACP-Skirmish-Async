/**
 * Pure helpers for **Mon Cala Special Forces** (Loku recon synergy).
 *
 * Card text: "While Loku attacks a figure with a Recon Token, Loku
 *  becomes Focused."
 *
 * Helper owns slug id + condition. The recon-token gate and the
 * applyCondition engine call stay handler-owned (recon-token is not
 * a per-attacker property).
 *
 * Extracted from src/handlers/combat.js:2434.
 */

export const MON_CALA_SF_LOKU_ABILITY_ID = 'mon_cala_sf_loku';
export const MON_CALA_SF_LOKU_CONDITION = 'Focus';

export function hasMonCalaSfLokuAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(MON_CALA_SF_LOKU_ABILITY_ID);
}
