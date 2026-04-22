/**
 * Pure helpers for Royal Guard Champion's **Overpower**.
 *
 * Card text: "While attacking, you may reroll 1 red die. While
 *  defending, you may reroll 1 black die."
 *
 * In combat.js this is implemented as +1 to each side's reroll budget
 * (atkSpecialReroll / defSpecialReroll), not die-color-specific. The
 * slug is wired at src/handlers/combat.js:2684 (attacker) and :2685
 * (defender).
 */

export const OVERPOWER_ABILITY_ID = 'overpower';
export const OVERPOWER_REROLL = 1;

export function hasOverpowerAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(OVERPOWER_ABILITY_ID);
}

export function applyOverpowerAttackerReroll(atkSpecialReroll = 0) {
  return (atkSpecialReroll || 0) + OVERPOWER_REROLL;
}

export function applyOverpowerDefenderReroll(defSpecialReroll = 0) {
  return (defSpecialReroll || 0) + OVERPOWER_REROLL;
}
