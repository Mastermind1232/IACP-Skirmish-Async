/**
 * Pure helpers for Ezra Bridger's **Much to Learn**.
 *
 * Card text: "While attacking, if a friendly Unique figure is
 *  within 3 spaces of you, you may reroll 1 attack die. If that
 *  friendly Unique is a Force User, you may choose a side instead."
 *
 * Helper owns slug id, range predicate (distance ≤ 3), reroll
 * delta, FORCE USER keyword string, and small DC-effect-shape
 * predicates. Iteration over friendly positions + distance
 * counting stay handler-owned.
 *
 * Extracted from src/handlers/combat.js:2033.
 */

export const MUCH_TO_LEARN_ABILITY_ID = 'much_to_learn';
export const MUCH_TO_LEARN_MAX_DISTANCE = 3;
export const MUCH_TO_LEARN_REROLL_DELTA = 1;
export const MUCH_TO_LEARN_FORCE_USER_KEYWORD = 'FORCE USER';

export function hasMuchToLearnAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(MUCH_TO_LEARN_ABILITY_ID);
}

export function muchToLearnInRange(distance) {
  return Number.isFinite(distance) && distance <= MUCH_TO_LEARN_MAX_DISTANCE;
}

/** True iff the DC effect entry is flagged unique. */
export function isUniqueFriendly(fkEff) {
  return Boolean(fkEff?.unique);
}

/** True iff the DC effect has FORCE USER in its keywords (case-insensitive). */
export function isForceUserFriendly(fkEff) {
  const kws = fkEff?.keywords;
  if (!Array.isArray(kws)) return false;
  return kws.map(k => String(k).toUpperCase()).includes(MUCH_TO_LEARN_FORCE_USER_KEYWORD);
}

export function applyMuchToLearnReroll({ rerollOneAttackDie = 0 } = {}) {
  return {
    applied: true,
    rerollOneAttackDie: (rerollOneAttackDie || 0) + MUCH_TO_LEARN_REROLL_DELTA,
  };
}
