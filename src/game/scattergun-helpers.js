/**
 * Pure helpers for **Scattergun** pair — Trandoshan Hunter Elite
 *  (ACP Scattergun, +2 Damage) and Regular (Scattergun, +1 Damage).
 *
 * Card text: "When attacking an adjacent hostile figure, apply
 *  +N Hits to the attack results." (N=2 elite, N=1 regular.)
 *
 * Helper owns slug ids, range predicate, and hit deltas. Adjacency
 * distance + hit math application stay handler-owned.
 *
 * Extracted from src/handlers/combat.js:1877.
 */

export const ACP_SCATTERGUN_ABILITY_ID = 'acp_scattergun';
export const SCATTERGUN_ABILITY_ID = 'scattergun';

export const ACP_SCATTERGUN_HIT_DELTA = 2;
export const SCATTERGUN_HIT_DELTA = 1;

export const SCATTERGUN_MAX_DISTANCE = 1;

export function hasAcpScattergun(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(ACP_SCATTERGUN_ABILITY_ID);
}

export function hasScattergun(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(SCATTERGUN_ABILITY_ID);
}

export function scattergunInRange(distance) {
  return Number.isFinite(distance) && distance <= SCATTERGUN_MAX_DISTANCE;
}

export function applyScattergunHits({ bonusHits = 0 } = {}, delta) {
  return {
    applied: true,
    bonusHits: (bonusHits || 0) + delta,
  };
}
