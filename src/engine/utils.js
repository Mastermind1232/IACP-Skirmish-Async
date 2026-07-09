/**
 * Pure utility functions extracted from index.js.
 * No Discord, no game state dependencies (single exception below).
 */
// buildCountingOverlay: CRR occupied-blocking + Spire counting exceptions for
// isWithinN when a caller supplies `game` (spatial.js is itself pure).
import { buildCountingOverlay } from '../game/spatial.js';

export function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Filter zone spaces to only those valid as top-left for a unit of given size
 * (all footprint cells in zone, unoccupied, and not blocking terrain).
 * @param {string[]} zoneSpaces
 * @param {string[]} occupiedSpaces
 * @param {string} size - e.g. '1x1', '1x2', '2x3'
 * @param {Function} getFootprintCells
 * @param {string[]} [blockingSpaces] - blocking terrain spaces (excluded unless ignoreBlocking)
 * @param {boolean} [ignoreBlocking] - true for Mobile/Massive figures
 */
export function filterValidTopLeftSpaces(zoneSpaces, occupiedSpaces, size, getFootprintCells, blockingSpaces, ignoreBlocking) {
  const zoneSet = new Set((zoneSpaces || []).map((s) => String(s).toLowerCase()));
  const occupiedSet = new Set((occupiedSpaces || []).map((s) => String(s).toLowerCase()));
  const blockingSet = (!ignoreBlocking && blockingSpaces?.length)
    ? new Set(blockingSpaces.map((s) => String(s).toLowerCase()))
    : null;
  const sizeNorm = (size || '1x1').toLowerCase();
  if (sizeNorm === '1x1') {
    return [...zoneSet].filter((s) => !occupiedSet.has(s) && (!blockingSet || !blockingSet.has(s)));
  }
  return [...zoneSet].filter((topLeft) => {
    const cells = getFootprintCells(topLeft, sizeNorm);
    return cells.every((c) => zoneSet.has(c) && !occupiedSet.has(c) && (!blockingSet || !blockingSet.has(c)));
  });
}

export function isWithinN(posA, posB, maxDist, mapId, getMapData, game = null) {
  const ms = getMapData(mapId);
  if (!ms?.adjacency || !posA || !posB) return false;
  const a = String(posA).toLowerCase(), b = String(posB).toLowerCase();
  if (a === b) return true;
  // CRR occupied-blocking / Spire counting exceptions activate only when a
  // measurement endpoint is a blocking cell with a figure on it (possible now
  // that Mobile/Massive may end there). Callers that pass `game` get them.
  const extraAdj = game ? buildCountingOverlay(game, ms, [a, b]) : null;
  const visited = new Set([a]);
  let frontier = [a];
  for (let d = 1; d <= maxDist; d++) {
    const next = [];
    for (const c of frontier) {
      const nbrs = extraAdj ? [...(ms.adjacency[c] || []), ...(extraAdj.get(c) || [])] : (ms.adjacency[c] || []);
      for (const adj of nbrs) {
        const s = String(adj).toLowerCase();
        if (s === b) return true;
        if (!visited.has(s)) { visited.add(s); next.push(s); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return false;
}
