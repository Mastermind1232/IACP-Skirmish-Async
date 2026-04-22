/**
 * Pure helpers for E-Web Engineer (Elite/Regular) **Tripod**.
 *
 * Card text: "You cannot attack on the same activation on which
 *  you exited a space."
 *
 * Helper owns slug id and the block-predicate (slug present AND
 * the attacker has moved this activation). Aborting the attack
 * (pendingCombat teardown + save) stays handler-owned.
 *
 * Extracted from src/handlers/combat.js:2317.
 */

export const TRIPOD_EWEB_ABILITY_ID = 'tripod_eweb';

export function hasTripodEwebAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(TRIPOD_EWEB_ABILITY_ID);
}

/**
 * True iff Tripod must block this attack — the slug is present AND
 * the attacker has already moved (exited a space) this activation.
 *
 * moved is the raw game.figureMoved[figureKey] flag (truthy/falsy).
 */
export function tripodBlocksAttack({ specialAbilityIds, moved } = {}) {
  if (!hasTripodEwebAbility(specialAbilityIds)) return false;
  return Boolean(moved);
}
