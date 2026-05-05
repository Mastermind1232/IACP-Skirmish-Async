/**
 * Pure spatial utilities for Imperial Assault grid.
 * Zero Discord dependency, zero game mutation.
 * Manhattan distance, LOS, BFS adjacency, figure enumeration.
 */
import { parseCoord, colRowToCoord, getFootprintCells } from './coords.js';
import { nickLineOfSight } from './los-engine-vendored.js';
import { dcNameFromFigureKey } from './dc-helpers.js';

/**
 * Manhattan distance between two coords.
 * Returns 999 if either coord is unparseable.
 * @param {string} coord1
 * @param {string} coord2
 * @returns {number}
 */
export function getRange(coord1, coord2) {
  const a = parseCoord(coord1);
  const b = parseCoord(coord2);
  if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) return 999;
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

// isAdjacentCoords + isWithinRange removed 2026-05-05 — Manhattan-based
// helpers that excluded same-square (CRR-incorrect) and undercounted
// diagonals. Zero production callers; only test files referenced them.
// Adjacency / range queries in rules code go through the map-graph
// helpers: getFiguresAdjacentToTarget / getFiguresAdjacentToCoord
// (movement.js) for figure adjacency, isWithinN (engine/utils.js) and
// isWithinSpaces (this file) for "within N" counts. All map-graph based
// (8-direction, walls + same-square correct).

// ── LOS helpers (private) ───────────────────────────────────────────────────

function edgeKey2(a, b) {
  const aL = String(a).toLowerCase(), bL = String(b).toLowerCase();
  return aL < bL ? `${aL}|${bL}` : `${bL}|${aL}`;
}

/** Return edges in `a` that are not in `b`, normalizing each to lowercase
 *  unordered pairs. */
function subtractEdgeSets(a, b) {
  const bSet = new Set((b || []).map(e => edgeKey2(e[0], e[1])));
  return (a || []).filter(e => !bSet.has(edgeKey2(e[0], e[1])));
}

// Convert one cell-pair edge (e.g. ['x16','x17']) into Nick's wall-segment
// format `[{x:..,y:..},{x:..,y:..}]` — corner pair on the boundary between
// the two cells. The pair is ordered with the smaller-y (or smaller-x) corner
// first to match Nick's edge enumeration in getVerticalEdges/getHorizontalEdges.
function cellPairToWallSegment(c1, c2) {
  const a = parseCoord(String(c1).toLowerCase());
  const b = parseCoord(String(c2).toLowerCase());
  if (a.col < 0 || b.col < 0) return null;
  const dc = b.col - a.col;
  const dr = b.row - a.row;
  if (Math.abs(dc) + Math.abs(dr) !== 1) return null;
  if (dr === 0) {
    // Horizontal cell adjacency → vertical wall segment between them.
    const x = Math.min(a.col, b.col) + 1;
    return [{ x, y: a.row }, { x, y: a.row + 1 }];
  } else {
    // Vertical cell adjacency → horizontal wall segment between them.
    const y = Math.min(a.row, b.row) + 1;
    return [{ x: a.col, y }, { x: a.col + 1, y }];
  }
}

// ── LOS (public) ────────────────────────────────────────────────────────────

/**
 * Corner-to-corner LOS check per IA rules.
 * LOS exists if ANY line from a corner of coord1 to a corner of coord2
 * is unobstructed by blocking terrain or solid walls (impassable edges).
 * @param {string} coord1
 * @param {string} coord2
 * @param {object} mapSpaces - { blocking, impassableEdges }
 * @param {Set<string>|null} [figureBlockingCoords] - additional blocking coords (large figures)
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.excludeBlocking] - coords to drop from
 *   figureBlockingCoords for this check. Used by callers iterating
 *   attacker × target footprint cells to exclude the target's OWN cells
 *   (multi-cell figures don't block LOS to themselves).
 * @returns {boolean}
 */
export function hasLineOfSight(coord1, coord2, mapSpaces, figureBlockingCoords, opts) {
  const excludeBlockingSet = opts?.excludeBlocking
    ? new Set([...opts.excludeBlocking].map(s => String(s).toLowerCase()))
    : null;
  const a = parseCoord(coord1);
  const b = parseCoord(coord2);
  if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) return false;
  if (a.col === b.col && a.row === b.row) return true;

  // ── Nick-native path (preferred) ────────────────────────────────────────
  // If the map has `nickLos`, all geometry data lives in Nick's native
  // (x, y) frame, with a transform spec mapping our (col, row) → (x, y).
  // Nick's state machine reads connection directions in absolute terms, so
  // running it natively is the only correctness-preserving option.
  if (mapSpaces?.nickLos) {
    const nl = mapSpaces.nickLos;
    // Generalized transform: x and y each derive from {col, row} with sign
    // and offset. Supports all 8 grid isometries (rotations + reflections),
    // not just the original 90°-rotated lothal-wastes case.
    const tx = nl.transform.x, ty = nl.transform.y;
    const toX = (col, row) => tx.scale * (tx.from === 'col' ? col : row) + tx.offset;
    const toY = (col, row) => ty.scale * (ty.from === 'col' ? col : row) + ty.offset;

    const aX = toX(a.col, a.row), aY = toY(a.col, a.row);
    const bX = toX(b.col, b.row), bY = toY(b.col, b.row);

    // Augment Nick's blockingTiles with shield cells passed via the test
    // fixture / runtime callers (`cornerBlockingTiles`), translated into
    // Nick's frame. Exclude the attacker/target cells.
    const blockingTiles = [...nl.blockingTiles];
    const shieldCells = [];   // shield cells, in Nick frame
    for (const cell of (mapSpaces.cornerBlockingTiles || [])) {
      const p = parseCoord(String(cell).toLowerCase());
      if (p.col < 0) continue;
      if ((p.col === a.col && p.row === a.row) || (p.col === b.col && p.row === b.row)) continue;
      const x = toX(p.col, p.row), y = toY(p.col, p.row);
      if (!blockingTiles.some(t => t.x === x && t.y === y)) {
        blockingTiles.push({ x, y });
      }
      shieldCells.push({ x, y });
    }
    // Energy shield × other-obstacle corner rule (CRR p.28 + Destruct):
    // a corner that touches a shield AND any other obstacle (wall endpoint
    // or another shield) blocks LOS through it. Tangent to a single shield
    // alone is legal. Count obstacles per corner.
    const blockingCornerSet = new Set();
    if (shieldCells.length) {
      const cornerCount = new Map();
      const bump = (x, y) => {
        const k = `${x},${y}`;
        cornerCount.set(k, (cornerCount.get(k) || 0) + 1);
      };
      for (const w of (nl.walls || [])) {
        bump(w[0].x, w[0].y);
        bump(w[1].x, w[1].y);
      }
      for (const s of shieldCells) {
        bump(s.x,     s.y);
        bump(s.x + 1, s.y);
        bump(s.x,     s.y + 1);
        bump(s.x + 1, s.y + 1);
      }
      // Mark a corner as a blocking corner only if a shield touches it AND
      // at least one other obstacle does too.
      for (const s of shieldCells) {
        for (const [cx, cy] of [[s.x,s.y],[s.x+1,s.y],[s.x,s.y+1],[s.x+1,s.y+1]]) {
          const k = `${cx},${cy}`;
          if ((cornerCount.get(k) || 0) >= 2) blockingCornerSet.add(k);
        }
      }
    }

    const blockers = [];
    if (figureBlockingCoords) {
      for (const cell of figureBlockingCoords) {
        const cellLc = String(cell).toLowerCase();
        if (excludeBlockingSet && excludeBlockingSet.has(cellLc)) continue;
        const p = parseCoord(cellLc);
        if (p.col < 0) continue;
        if ((p.col === a.col && p.row === a.row) || (p.col === b.col && p.row === b.row)) continue;
        blockers.push({ x: toX(p.col, p.row), y: toY(p.col, p.row) });
      }
    }

    return nickLineOfSight(aX, aY, bX, bY, {
      walls:                 nl.walls                 || [],
      blockingTiles,
      blockingEdges:         nl.blockingEdges         || [],
      blockingIntersections: nl.blockingIntersections || [],
      blockers,
      offMapTiles:           nl.offMapTiles           || [],
      spireTiles:            nl.spireTiles            || [],
      blockingCornerSet:     blockingCornerSet.size ? blockingCornerSet : null,
    });
  }

  // ── Legacy path: derive Nick state from our cell-pair / cell-list data ──
  // Used for maps that don't yet have a `nickLos` import. Walls and BIs
  // live in our (col, row) frame here; we treat (col, row) as Nick's
  // (x, y) directly. This is correct only when the data was authored in
  // our frame — it's not a Nick-data drop-in.
  const losCellPairs = mapSpaces?.wallEdges
    ?? subtractEdgeSets(mapSpaces?.impassableEdges || [], mapSpaces?.movementBlockingEdges || []);
  const walls = [];
  for (const e of losCellPairs) {
    const seg = cellPairToWallSegment(e[0], e[1]);
    if (seg) walls.push(seg);
  }

  const blockingTiles = [];
  for (const cell of (mapSpaces?.blocking || [])) {
    const p = parseCoord(String(cell).toLowerCase());
    if (p.col >= 0) blockingTiles.push({ x: p.col, y: p.row });
  }
  for (const cell of (mapSpaces?.cornerBlockingTiles || [])) {
    const p = parseCoord(String(cell).toLowerCase());
    if (p.col < 0) continue;
    if ((p.col === a.col && p.row === a.row) || (p.col === b.col && p.row === b.row)) continue;
    if (!blockingTiles.some(t => t.x === p.col && t.y === p.row)) {
      blockingTiles.push({ x: p.col, y: p.row });
    }
  }

  const blockers = [];
  if (figureBlockingCoords) {
    for (const cell of figureBlockingCoords) {
      const cellLc = String(cell).toLowerCase();
      if (excludeBlockingSet && excludeBlockingSet.has(cellLc)) continue;
      const p = parseCoord(cellLc);
      if (p.col < 0) continue;
      if ((p.col === a.col && p.row === a.row) || (p.col === b.col && p.row === b.row)) continue;
      blockers.push({ x: p.col, y: p.row });
    }
  }

  // Derive blockingIntersections from wall endpoints (legacy fallback).
  const biMap = new Map();
  const addConn = (cx, cy, ox, oy) => {
    const key = `${cx},${cy}`;
    let bi = biMap.get(key);
    if (!bi) {
      bi = { x: cx, y: cy, connections: [] };
      biMap.set(key, bi);
    }
    if (!bi.connections.some(c => c.x === ox && c.y === oy)) {
      bi.connections.push({ x: ox, y: oy });
    }
  };
  for (const w of walls) {
    addConn(w[0].x, w[0].y, w[1].x, w[1].y);
    addConn(w[1].x, w[1].y, w[0].x, w[0].y);
  }
  const blockingIntersections = [...biMap.values()];

  return nickLineOfSight(a.col, a.row, b.col, b.row, {
    walls,
    blockingTiles,
    blockingEdges: [],
    blockingIntersections,
    blockers,
    offMapTiles: [],
    spireTiles: [],
  });
}

// ── Figure enumeration ──────────────────────────────────────────────────────

/**
 * Collect HEAD coordinates of all figures (lowercased).
 * NOTE: this returns single head cells, NOT full multi-cell footprints.
 * For LOS blocking purposes, prefer `getAllFigureFootprints(game, getFigureSize)`
 * which expands multi-cell figures (AT-ST, Rancor, etc.) to all their cells.
 * @param {object} game
 * @returns {Set<string>}
 */
export function getAllFigureCoords(game) {
  const coords = new Set();
  for (const [, fp] of Object.entries(game.figurePositions?.[1] || {})) if (fp) coords.add(String(fp).toLowerCase());
  for (const [, fp] of Object.entries(game.figurePositions?.[2] || {})) if (fp) coords.add(String(fp).toLowerCase());
  return coords;
}

/**
 * Get the full footprint (all occupied cells, lowercased) of a figure.
 * @param {object} game
 * @param {number} playerNum 1 or 2
 * @param {string} figureKey
 * @param {function} getFigureSize - (dcName) => '1x1'|'2x1'|'2x2'|'3x3'|...
 * @returns {string[]} list of lowercased coords, or [] if figure is missing
 */
export function getFigureFootprint(game, playerNum, figureKey, getFigureSize) {
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return [];
  const dcName = dcNameFromFigureKey(figureKey);
  const size = game.figureOrientations?.[figureKey]
    || (typeof getFigureSize === 'function' ? getFigureSize(dcName) : null);
  if (!size || size === '1x1') return [String(pos).toLowerCase()];
  return getFootprintCells(pos, size).map(c => String(c).toLowerCase());
}

/**
 * Collect FULL footprint coords of every figure (both players, lowercased).
 * Use this — not getAllFigureCoords — when building a figure-blocking set
 * for LOS checks. Multi-cell figures contribute all their cells, so they
 * block LOS through their full footprint per IA rules.
 * @param {object} game
 * @param {function} getFigureSize
 * @returns {Set<string>}
 */
export function getAllFigureFootprints(game, getFigureSize) {
  const set = new Set();
  for (const pn of [1, 2]) {
    for (const fk of Object.keys(game.figurePositions?.[pn] || {})) {
      for (const c of getFigureFootprint(game, pn, fk, getFigureSize)) set.add(c);
    }
  }
  return set;
}

/**
 * Expand a coord to the full footprint of whichever figure is at that coord
 * (head cell). If no figure occupies the coord, returns just the coord itself.
 * Useful for auxiliary LOS callers that have a `pos` (head) but want to do
 * multi-cell-aware LOS without a figureKey lookup.
 */
export function expandCoordToFigureFootprint(game, coord, getFigureSize) {
  if (!coord) return [];
  const lc = String(coord).toLowerCase();
  for (const pn of [1, 2]) {
    const poses = game?.figurePositions?.[pn] || {};
    for (const [fk, fp] of Object.entries(poses)) {
      if (!fp) continue;
      if (String(fp).toLowerCase() === lc) {
        return getFigureFootprint(game, pn, fk, getFigureSize);
      }
    }
  }
  return [lc];
}

/**
 * Multi-cell-aware LOS by raw coords. Auto-expands each coord to its
 * occupying figure's full footprint (or single cell if no figure there).
 * Default blocking set is `getAllFigureFootprints(game)` if `blocking`
 * isn't passed; pass `null` to skip figure blocking entirely (MASSIVE,
 * Priority Target, Marksman, etc.).
 */
export function hasLineOfSightByCoord(game, fromCoord, toCoord, mapSpaces, getFigureSize, opts) {
  const fromFp = expandCoordToFigureFootprint(game, fromCoord, getFigureSize);
  const toFp   = expandCoordToFigureFootprint(game, toCoord, getFigureSize);
  const blocking = (opts && 'blocking' in opts)
    ? opts.blocking
    : getAllFigureFootprints(game, getFigureSize);
  return hasFigureLineOfSight(fromFp, toFp, mapSpaces, blocking);
}

/**
 * Multi-cell-aware LOS check between two figures (or between two arbitrary
 * footprints).
 *
 * Iterates every (from-cell × to-cell) pair and excludes BOTH footprints
 * from the figure-blocking set — IA rule: a figure's own cells don't block
 * its own LOS, and a target's cells don't block LOS to itself.
 *
 * @param {string[]|Set<string>} fromFootprint - source figure cells (or a
 *   single coord wrapped in a list — works for both 1x1 and multi-cell).
 * @param {string[]|Set<string>} toFootprint - target cells.
 * @param {object} mapSpaces
 * @param {Set<string>|null} figureBlockingCoords - all blocker cells
 *   (typically `getAllFigureFootprints(game, getFigureSize)` or a curated
 *   subset like `buildFigureBlockingCoords` produces). Pass `null` to
 *   skip figure blocking entirely (e.g. MASSIVE / Priority Target / Marksman).
 * @returns {boolean} true if LOS exists between any cell pair.
 */
export function hasFigureLineOfSight(fromFootprint, toFootprint, mapSpaces, figureBlockingCoords) {
  const fromArr = [...fromFootprint].map(c => String(c).toLowerCase());
  const toArr   = [...toFootprint  ].map(c => String(c).toLowerCase());
  if (!fromArr.length || !toArr.length) return false;
  // Exclude both footprints from the blocking set for this check.
  const exclude = new Set([...fromArr, ...toArr]);
  for (const a of fromArr) {
    for (const b of toArr) {
      if (hasLineOfSight(a, b, mapSpaces, figureBlockingCoords, { excludeBlocking: exclude })) {
        return true;
      }
    }
  }
  return false;
}

// ── BFS adjacency ───────────────────────────────────────────────────────────

/**
 * BFS adjacency check: can you walk from coordA to coordB in <= maxDist steps
 * using the map's adjacency graph?
 * @param {object} mapSpaces - { adjacency: { [coord]: string[] } }
 * @param {string} coordA
 * @param {string} coordB
 * @param {number} maxDist
 * @returns {boolean}
 */
export function isWithinSpaces(mapSpaces, coordA, coordB, maxDist) {
  if (!mapSpaces?.adjacency || !coordA || !coordB) return false;
  const a = coordA.toLowerCase(), b = coordB.toLowerCase();
  if (a === b) return true;
  const visited = new Set([a]);
  let frontier = [a];
  for (let d = 1; d <= maxDist; d++) {
    const next = [];
    for (const c of frontier) {
      for (const adj of (mapSpaces.adjacency[c] || [])) {
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

/**
 * Counting-spaces distance: BFS shortest-path on the map adjacency graph.
 * Returns the number of movement steps a small figure would need.
 * Respects walls/blocking terrain (pre-excluded from adjacency graph).
 * Optionally blocks closed-door edges via blockedEdges set.
 * @param {object} mapSpaces - { adjacency: { [coord]: string[] } }
 * @param {string} coordA - source coord
 * @param {string} coordB - target coord
 * @param {Set<string>|null} [blockedEdges] - edgeKey-format strings for closed doors
 * @param {number} [maxDist=50] - BFS depth cap
 * @returns {number} distance (0 if same, Infinity if unreachable)
 */
export function countSpaces(mapSpaces, coordA, coordB, blockedEdges = null, maxDist = 50) {
  if (!mapSpaces?.adjacency || !coordA || !coordB) return Infinity;
  const a = coordA.toLowerCase(), b = coordB.toLowerCase();
  if (a === b) return 0;
  const visited = new Set([a]);
  let frontier = [a];
  for (let d = 1; d <= maxDist; d++) {
    const next = [];
    for (const c of frontier) {
      for (const adj of (mapSpaces.adjacency[c] || [])) {
        const s = String(adj).toLowerCase();
        if (blockedEdges) {
          const ek = [c, s].sort().join('|');
          if (blockedEdges.has(ek)) continue;
        }
        if (s === b) return d;
        if (!visited.has(s)) { visited.add(s); next.push(s); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return Infinity;
}

// getFiguresWithinRange + getFiguresAdjacentTo removed 2026-05-05.
// Manhattan-based — diagonals undercounted, same-square excluded.
// Zero production callers (only test files referenced them; tests
// removed alongside). Figure-adjacency / range queries in rules code
// use the map-graph helpers: getFiguresAdjacentToCoord /
// getFiguresAdjacentToTarget (movement.js) for figure adjacency,
// isWithinN (engine/utils.js) and isWithinSpaces (this file) for
// "within N" counts.
