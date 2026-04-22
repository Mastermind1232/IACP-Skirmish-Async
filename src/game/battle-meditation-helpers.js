/**
 * Pure helpers for **Battle Meditation** (Diala Passil) /
 *  **Assassin** (BT-1).
 *
 * Card text: "While attacking, become Focused." (Same mechanic,
 *  different card labels on Diala vs BT-1.)
 *
 * Helper owns slug id, Focus + green-die parameters, and the
 * label selector. Focus application via applyConditionWithDie
 * stays handler-owned.
 *
 * Extracted from src/handlers/combat.js:1801.
 */

export const BATTLE_MEDITATION_ABILITY_ID = 'battle_meditation';
export const BATTLE_MEDITATION_CONDITION = 'Focus';
export const BATTLE_MEDITATION_BONUS_DIE = 'green';

/** DC names that carry the "Assassin" label instead of "Battle Meditation". */
export const BATTLE_MEDITATION_ASSASSIN_DC_NAMES = Object.freeze(['BT-1']);

export function hasBattleMeditationAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(BATTLE_MEDITATION_ABILITY_ID);
}

/** Returns 'Assassin' for BT-1, 'Battle Meditation' otherwise. */
export function battleMeditationLabel(dcName) {
  return BATTLE_MEDITATION_ASSASSIN_DC_NAMES.includes(dcName)
    ? 'Assassin'
    : 'Battle Meditation';
}
