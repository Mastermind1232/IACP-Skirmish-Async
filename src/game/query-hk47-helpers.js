/**
 * Pure helpers for HK-47's **Query**.
 *
 * Card text: "When declaring an attack, apply +1 Hit unless the
 *  defender becomes Bleeding."
 *
 * Attacker passive. +1 Hit applies at declare-time; if the attack
 * later inflicts Bleeding on the defender, the bonus is REMOVED via
 * the `queryBonusHitApplied` flag tracked in pendingCombat. This
 * helper covers only the declare-time bonus + flag. The remove-on-
 * Bleeding reversal lives in the surge-resolution pipeline and is
 * out of scope.
 *
 * Extracted from src/handlers/combat.js:1885.
 */

export const QUERY_HK47_ABILITY_ID = 'query_hk47';
export const QUERY_BONUS_HITS = 1;

export function hasQueryAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(QUERY_HK47_ABILITY_ID);
}

export function applyQueryBonus({ bonusHits = 0 } = {}) {
  return {
    applied: true,
    bonusHits: (bonusHits || 0) + QUERY_BONUS_HITS,
    queryBonusHitApplied: true,
  };
}
