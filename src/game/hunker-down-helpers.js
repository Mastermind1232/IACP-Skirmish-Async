/**
 * Pure helpers for Cara Dune's **Hunker Down**.
 *
 * Card text: "While defending, if you share a corner or edge with
 *  a space containing blocking, impassable, or difficult terrain,
 *  apply +1 Evade to the defense results."
 *
 * Helper owns the terrain-type list, predicate, and evade math.
 * Adjacency lookup + terrain-map composition stay handler-owned.
 *
 * Extracted from src/handlers/combat.js:1794.
 */

export const HUNKER_DOWN_ABILITY_ID = 'hunker_down';
export const HUNKER_DOWN_EVADE_DELTA = 1;
export const HUNKER_DOWN_TERRAIN = Object.freeze([
  'blocking',
  'impassable',
  'difficult',
]);

export function hasHunkerDownAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(HUNKER_DOWN_ABILITY_ID);
}

/**
 * Does any adjacent space contain Hunker Down-qualifying terrain?
 *   - adjCoords: iterable of coord strings (already lowercased by
 *     caller to match terrainMap keys).
 *   - terrainMap: { coord → 'normal' | 'blocking' | ... }
 *
 * Returns true iff at least one adj coord maps to a terrain type
 * in HUNKER_DOWN_TERRAIN (case-insensitive).
 */
export function hasQualifyingTerrainAdjacent(adjCoords, terrainMap = {}) {
  if (!adjCoords || typeof adjCoords[Symbol.iterator] !== 'function') return false;
  for (const coord of adjCoords) {
    const t = (terrainMap?.[coord] || 'normal').toLowerCase();
    if (HUNKER_DOWN_TERRAIN.includes(t)) return true;
  }
  return false;
}

export function applyHunkerDownEvade({ bonusEvade = 0 } = {}) {
  return {
    applied: true,
    bonusEvade: (bonusEvade || 0) + HUNKER_DOWN_EVADE_DELTA,
  };
}
