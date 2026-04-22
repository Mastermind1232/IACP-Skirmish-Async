/**
 * Pure helpers for AT-ST's **Awkward**.
 *
 * Card text: "You cannot attack adjacent figures."
 *
 * Predicate-only: if the attacker has this slug and the target is
 * adjacent (distance ≤ 1), the attack is cancelled outright. See
 * src/handlers/combat.js:2083.
 */

export const AWKWARD_ATST_ABILITY_ID = 'awkward_atst';
export const AWKWARD_ADJACENT_DISTANCE = 1;

export function hasAwkwardAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(AWKWARD_ATST_ABILITY_ID);
}

export function awkwardBlocks(distanceToTarget) {
  if (typeof distanceToTarget !== 'number') return false;
  return distanceToTarget <= AWKWARD_ADJACENT_DISTANCE;
}
