/**
 * Pure helpers for defender +1-reroll passives: **Foresight** (Darth
 * Vader) and **Defensive Stance** (Diala Passil).
 *
 * Card text (Foresight): "While defending, you may reroll 1 defense die."
 * Card text (Defensive Stance): "While defending, you may reroll 1
 *  defense die. If you do, convert each Dodge result to 2 Block and
 *  1 Evade."
 *
 * This helper covers the shared reroll-budget bump (combat.js:2692 &
 * :2694). The Defensive-Stance Dodge-conversion clause lives
 * separately at combat.js:4400 and is NOT in scope here — that clause
 * is a later-phase dice-mutation step, not a pre-roll reroll.
 */

export const FORESIGHT_ABILITY_ID = 'foresight';
export const DEFENSIVE_STANCE_ABILITY_ID = 'defensive_stance';
export const DEFENSIVE_REROLL = 1;

export function hasForesightAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(FORESIGHT_ABILITY_ID);
}

export function hasDefensiveStanceAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(DEFENSIVE_STANCE_ABILITY_ID);
}

export function applyDefensiveReroll(defSpecialReroll = 0) {
  return (defSpecialReroll || 0) + DEFENSIVE_REROLL;
}
