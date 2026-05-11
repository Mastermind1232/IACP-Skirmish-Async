/**
 * Thug end-of-round movement — picker-driven (alexanbv 2026-05-10).
 *
 * Rules (per alexanbv 2026-05-10):
 *  - Mission rule, runs in the EoR phase BEFORE either player's DC EoR.
 *  - Player with initiative chooses the order to move thugs (1 at a time).
 *  - For each thug:
 *      * Targets = non-thug figures (other thugs are NOT targets).
 *      * If already adjacent to ≥1 non-thug, the thug must end adjacent
 *        to at least one of those figures it is currently adjacent to.
 *      * Otherwise, the thug must decrease distance to the closest
 *        non-thug as much as possible (in ≤2 moves of 1 space each).
 *      * If multiple candidate destinations are tied, initiative player
 *        chooses.
 *      * Incidental proximity-increase to other thugs is allowed.
 *  - After all thugs moved, every non-thug figure adjacent to any thug
 *    suffers 2 damage (capped at 2 even if adjacent to multiple thugs).
 *
 * State stored on game.pendingThugMovement:
 *   {
 *     gameId,
 *     initiativePlayerNum,
 *     remainingThugIndexes: number[],   // not-yet-moved thug indexes
 *     selectedThugIndex: number | null, // current pick in progress
 *     mapId,
 *   }
 */

import { normalizeCoord } from './coords.js';

/** Get the manhattan-style shortest distance through the adjacency graph (BFS). Returns Infinity if unreachable. */
function _bfsDistance(adjacency, fromCoord, toCoord) {
  if (fromCoord === toCoord) return 0;
  const visited = new Set([fromCoord]);
  const queue = [[fromCoord, 0]];
  while (queue.length > 0) {
    const [curr, d] = queue.shift();
    for (const nb of (adjacency[curr] || [])) {
      const n = normalizeCoord(nb);
      if (visited.has(n)) continue;
      if (n === toCoord) return d + 1;
      visited.add(n);
      queue.push([n, d + 1]);
    }
  }
  return Infinity;
}

/** All non-thug figure coords (player figures only — other thugs don't count as targets). */
function _collectNonThugCoords(game) {
  const coords = new Map(); // coord → label
  for (const pn of [1, 2]) {
    for (const [fk, c] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!c) continue;
      coords.set(normalizeCoord(c), { figureKey: fk, playerNum: pn });
    }
  }
  // Krykna are not "thugs" but they are NPCs. Per CRR: thugs are hostile
  // to all figures EXCEPT other thugs. Krykna are figures; treat them as
  // valid targets for thug movement.
  for (const arrName of ['npcKrykna']) {
    const arr = game[arrName];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const npc = arr[i];
      if (!npc || npc.defeated || !npc.coord) continue;
      coords.set(normalizeCoord(npc.coord), { figureKey: `npc_krykna_${i}`, playerNum: null });
    }
  }
  return coords;
}

/** Coords occupied by other live thugs (the moving thug is excluded by its own index). */
function _collectOtherThugCoords(game, excludeIndex) {
  const set = new Set();
  const arr = game.npcThugs || [];
  for (let i = 0; i < arr.length; i++) {
    if (i === excludeIndex) continue;
    const npc = arr[i];
    if (!npc || npc.defeated || !npc.coord) continue;
    set.add(normalizeCoord(npc.coord));
  }
  return set;
}

/**
 * Compute candidate destination coords for a given thug per rule (b).
 *
 * Returns an array of coord strings. Empty array = thug stays put
 * (no valid move; caller should log and skip).
 */
export function computeThugCandidates(game, mapId, thugIndex, mapAdjacency) {
  const thug = game.npcThugs?.[thugIndex];
  if (!thug || thug.defeated || !thug.coord) return [];
  const adjacency = mapAdjacency || {};
  const start = normalizeCoord(thug.coord);

  const nonThugCoords = _collectNonThugCoords(game);
  if (nonThugCoords.size === 0) return [];

  const otherThugCoords = _collectOtherThugCoords(game, thugIndex);
  // Reachable cells in ≤2 steps that are not blocked by other thugs at
  // the destination (thug can pass through its own current cell trivially).
  // Spaces occupied by player figures or Krykna are not valid destinations
  // either (end-on-space rule). Other thug-occupied cells are also blocked.
  const blocked = new Set([...otherThugCoords, ...nonThugCoords.keys()]);
  // The thug's current space is always a valid 'destination' (stay put)
  // when no improvement is possible.
  const reachable = new Map([[start, 0]]); // coord → steps
  const queue = [start];
  while (queue.length > 0) {
    const curr = queue.shift();
    const d = reachable.get(curr);
    if (d >= 2) continue;
    for (const nb of (adjacency[curr] || [])) {
      const n = normalizeCoord(nb);
      if (reachable.has(n)) continue;
      if (blocked.has(n)) continue;
      reachable.set(n, d + 1);
      queue.push(n);
    }
  }
  const candidatesAll = [...reachable.keys()];

  // Compute current adjacency to non-thug figures: set of non-thug coords
  // currently adjacent to the thug's starting space.
  const startNeighbors = new Set((adjacency[start] || []).map(normalizeCoord));
  const currentlyAdjacentNonThugs = [...nonThugCoords.keys()].filter((c) =>
    startNeighbors.has(c) || c === start);

  // Rule: if already adjacent to ≥1 non-thug, must end adjacent to at
  // least one of THOSE figures.
  if (currentlyAdjacentNonThugs.length > 0) {
    const validDests = candidatesAll.filter((cand) => {
      const candNeighbors = new Set([cand, ...(adjacency[cand] || []).map(normalizeCoord)]);
      return currentlyAdjacentNonThugs.some((tgt) => candNeighbors.has(tgt));
    });
    // Always keep "stay put" as a fallback if nothing else preserves
    // adjacency (shouldn't happen since start always satisfies, but defensive).
    if (validDests.length === 0) return [start];
    return validDests;
  }

  // Otherwise: must minimize distance to closest non-thug. For each
  // candidate, compute min BFS distance to any non-thug target.
  let bestDist = Infinity;
  const candWithDist = candidatesAll.map((cand) => {
    let d = Infinity;
    for (const tgt of nonThugCoords.keys()) {
      const dist = _bfsDistance(adjacency, cand, tgt);
      if (dist < d) d = dist;
      if (d === 0) break;
    }
    if (d < bestDist) bestDist = d;
    return { cand, dist: d };
  });
  if (bestDist === Infinity) return [start];
  return candWithDist.filter((e) => e.dist === bestDist).map((e) => e.cand);
}

/**
 * Initialize the picker queue. Called when end-of-round triggers the
 * mission rule. Stores game.pendingThugMovement; subsequent picker steps
 * read from it.
 */
export function initThugMovementQueue(game, initiativePlayerNum, mapId) {
  const activeIndexes = (game.npcThugs || [])
    .map((t, i) => (t && !t.defeated ? i : -1))
    .filter((i) => i >= 0);
  if (activeIndexes.length === 0) return null;
  game.pendingThugMovement = {
    gameId: game.gameId,
    initiativePlayerNum,
    remainingThugIndexes: activeIndexes,
    selectedThugIndex: null,
    mapId,
  };
  return game.pendingThugMovement;
}

/** Move a single thug to a destination coord and remove it from the remaining queue. */
export function applyThugMove(game, thugIndex, destCoord) {
  const thug = game.npcThugs?.[thugIndex];
  if (!thug || thug.defeated) return null;
  const prev = thug.coord;
  thug.coord = normalizeCoord(destCoord);
  const p = game.pendingThugMovement;
  if (p) {
    p.remainingThugIndexes = p.remainingThugIndexes.filter((i) => i !== thugIndex);
    p.selectedThugIndex = null;
  }
  return { prevCoord: prev, newCoord: thug.coord };
}

/**
 * Final damage step after all thugs have moved. Returns an array of
 * { figureKey, playerNum, damage } events — each adjacent non-thug figure
 * takes 2 damage, capped at 2 even if adjacent to multiple thugs.
 */
export function computeThugDamageEvents(game, mapAdjacency) {
  const adjacency = mapAdjacency || {};
  const thugCoords = new Set((game.npcThugs || [])
    .filter((t) => t && !t.defeated && t.coord)
    .map((t) => normalizeCoord(t.coord)));
  if (thugCoords.size === 0) return [];
  const events = [];
  const seen = new Set();
  for (const pn of [1, 2]) {
    for (const [fk, c] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!c) continue;
      const fc = normalizeCoord(c);
      const adjToThug = (adjacency[fc] || []).some((n) => thugCoords.has(normalizeCoord(n)));
      if (adjToThug && !seen.has(fk)) {
        events.push({ figureKey: fk, playerNum: pn, damage: 2 });
        seen.add(fk);
      }
    }
  }
  return events;
}

/** Clear pending state — called after the queue drains. */
export function clearPendingThugMovement(game) {
  delete game.pendingThugMovement;
}
