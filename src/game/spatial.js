/**
 * Pure spatial utilities for Imperial Assault grid.
 * Zero Discord dependency, zero game mutation.
 * Manhattan distance, LOS, BFS adjacency, figure enumeration.
 */
import { parseCoord, colRowToCoord, getFootprintCells } from './coords.js';

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

/**
 * Whether two coords are exactly adjacent (Manhattan distance === 1).
 * @param {string} coord1
 * @param {string} coord2
 * @returns {boolean}
 */
export function isAdjacentCoords(coord1, coord2) {
  return getRange(coord1, coord2) === 1;
}

/**
 * Whether two coords are within range (Manhattan distance <= range).
 * @param {string} coord1
 * @param {string} coord2
 * @param {number} range
 * @returns {boolean}
 */
export function isWithinRange(coord1, coord2, range) {
  return getRange(coord1, coord2) <= range;
}

// ── LOS helpers (private) ───────────────────────────────────────────────────

function impassableEdgeToWallSegment(c1, c2) {
  const a = parseCoord(String(c1).toLowerCase());
  const b = parseCoord(String(c2).toLowerCase());
  if (a.col < 0 || b.col < 0) return null;
  const dc = b.col - a.col;
  const dr = b.row - a.row;
  if (Math.abs(dc) + Math.abs(dr) !== 1) return null;
  if (dr === 0) {
    const x = Math.min(a.col, b.col) + 0.5;
    return { x1: x, y1: a.row - 0.5, x2: x, y2: a.row + 0.5 };
  } else {
    const y = Math.min(a.row, b.row) + 0.5;
    return { x1: a.col - 0.5, y1: y, x2: a.col + 0.5, y2: y };
  }
}

function segmentsStrictlyIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d1x = x2 - x1, d1y = y2 - y1;
  const d2x = x4 - x3, d2y = y4 - y3;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false;
  const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / denom;
  const u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / denom;
  const EPS = 1e-6;
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
}

function getCellsAlongLine(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const seen = new Set();
  const result = [];
  const steps = Math.max(Math.ceil(len * 4), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const col = Math.round(x1 + t * dx);
    const row = Math.round(y1 + t * dy);
    const key = `${col},${row}`;
    if (!seen.has(key)) { seen.add(key); result.push([col, row]); }
  }
  return result;
}

// Grid corners are at half-integer coordinates (col+0.5, row+0.5).
// Returns every corner the open segment threads (excludes endpoints themselves).
// Only diagonal-slope rays thread corners; axis-aligned rays never do.
function getThreadedCorners(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const EPS = 1e-9;
  const corners = [];
  const xMin = Math.min(x1, x2), xMax = Math.max(x1, x2);
  const yMin = Math.min(y1, y2), yMax = Math.max(y1, y2);
  const kMin = Math.ceil(xMin - 0.5 - EPS);
  const kMax = Math.floor(xMax - 0.5 + EPS);
  const lMin = Math.ceil(yMin - 0.5 - EPS);
  const lMax = Math.floor(yMax - 0.5 + EPS);
  for (let k = kMin; k <= kMax; k++) {
    for (let l = lMin; l <= lMax; l++) {
      const cx = k + 0.5, cy = l + 0.5;
      let t;
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (Math.abs(dx) < EPS) continue;
        t = (cx - x1) / dx;
      } else {
        t = (cy - y1) / dy;
      }
      if (t <= EPS || t >= 1 - EPS) continue;
      const px = x1 + t * dx, py = y1 + t * dy;
      if (Math.abs(px - cx) > 1e-6 || Math.abs(py - cy) > 1e-6) continue;
      corners.push([cx, cy]);
    }
  }
  return corners;
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
 * @returns {boolean}
 */
export function hasLineOfSight(coord1, coord2, mapSpaces, figureBlockingCoords) {
  const blockingSet = new Set((mapSpaces?.blocking || []).map((s) => String(s).toLowerCase()));
  const impassableEdges = mapSpaces?.impassableEdges || [];
  const a = parseCoord(coord1);
  const b = parseCoord(coord2);
  if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) return false;
  if (a.col === b.col && a.row === b.row) return true;

  const walls = [];
  for (const edge of impassableEdges) {
    const seg = impassableEdgeToWallSegment(edge[0], edge[1]);
    if (seg) walls.push(seg);
  }

  const INSET = 0.49;
  const corners = (col, row) => [
    [col - INSET, row - INSET],
    [col + INSET, row - INSET],
    [col - INSET, row + INSET],
    [col + INSET, row + INSET],
  ];

  const aCorners = corners(a.col, a.row);
  const bCorners = corners(b.col, b.row);

  // IACP LOS rule: from any single point on the attacker's space, must see
  // at least 2 corners of the target's space.  We test from each attacker
  // corner as representative points.
  for (const [ax, ay] of aCorners) {
    let visibleTargetCorners = 0;
    for (const [bx, by] of bCorners) {
      let wallBlocked = false;
      for (const w of walls) {
        if (segmentsStrictlyIntersect(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2)) {
          wallBlocked = true;
          break;
        }
      }
      if (wallBlocked) continue;
      const cells = getCellsAlongLine(ax, ay, bx, by);
      let spaceBlocked = false;
      for (const [col, row] of cells) {
        if (col === a.col && row === a.row) continue;
        if (col === b.col && row === b.row) continue;
        if (blockingSet.has(colRowToCoord(col, row))) { spaceBlocked = true; break; }
        if (figureBlockingCoords?.has(colRowToCoord(col, row))) { spaceBlocked = true; break; }
      }
      if (!spaceBlocked) {
        // CRR p.22 / p.28: LOS cannot trace through a corner where
        // ≥2 obstacles (walls, blocking terrain, energy shields) intersect.
        // Only diagonal-slope rays thread half-integer grid corners.
        let cornerBlocked = false;
        for (const [cx, cy] of getThreadedCorners(ax, ay, bx, by)) {
          let count = 0;
          const k = Math.round(cx - 0.5), l = Math.round(cy - 0.5);
          for (const [cc, cr] of [[k, l], [k + 1, l], [k, l + 1], [k + 1, l + 1]]) {
            if (cc === a.col && cr === a.row) continue;
            if (cc === b.col && cr === b.row) continue;
            const coord = colRowToCoord(cc, cr);
            if (blockingSet.has(coord) || figureBlockingCoords?.has(coord)) count++;
          }
          for (const w of walls) {
            if ((Math.abs(w.x1 - cx) < 1e-6 && Math.abs(w.y1 - cy) < 1e-6) ||
                (Math.abs(w.x2 - cx) < 1e-6 && Math.abs(w.y2 - cy) < 1e-6)) count++;
          }
          if (count >= 2) { cornerBlocked = true; break; }
        }
        if (!cornerBlocked) visibleTargetCorners++;
      }
      if (visibleTargetCorners >= 2) return true;
    }
  }
  return false;
}

// ── Figure enumeration ──────────────────────────────────────────────────────

/**
 * Collect all figure coordinates from both players (normalized to lowercase).
 * Used as the blocking-figure list for LOS checks.
 * @param {object} game
 * @returns {Set<string>}
 */
export function getAllFigureCoords(game) {
  const coords = new Set();
  for (const [, fp] of Object.entries(game.figurePositions?.[1] || {})) if (fp) coords.add(String(fp).toLowerCase());
  for (const [, fp] of Object.entries(game.figurePositions?.[2] || {})) if (fp) coords.add(String(fp).toLowerCase());
  return coords;
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

// ── Figure enumeration ──────────────────────────────────────────────────────

/**
 * Get all figure keys within Manhattan range of a coord.
 * Accounts for large figure footprints — distance is computed to the closest footprint cell.
 * @param {object} game - game state with figurePositions, figureOrientations
 * @param {string} coord - center coord
 * @param {number} range - max Manhattan distance
 * @param {number|null} [playerNum] - filter to specific player (null = both)
 * @returns {Array<{figureKey: string, playerNum: number, coord: string, distance: number}>}
 */
export function getFiguresWithinRange(game, coord, range, playerNum = null) {
  const results = [];
  const players = playerNum ? [playerNum] : [1, 2];
  for (const pn of players) {
    const poses = game.figurePositions?.[pn] || {};
    for (const [fk, fCoord] of Object.entries(poses)) {
      if (!fCoord) continue;
      // For large figures, compute distance to closest footprint cell
      const size = game.figureOrientations?.[fk];
      let d;
      if (size && size !== '1x1') {
        const cells = getFootprintCells(fCoord, size);
        d = Math.min(...cells.map(c => getRange(coord, c)));
      } else {
        d = getRange(coord, fCoord);
      }
      if (d <= range) results.push({ figureKey: fk, playerNum: pn, coord: fCoord, distance: d });
    }
  }
  return results;
}

/**
 * Get all figure keys adjacent (Manhattan distance === 1) to a coord.
 * @param {object} game
 * @param {string} coord
 * @param {number|null} [playerNum]
 * @returns {Array<{figureKey: string, playerNum: number, coord: string}>}
 */
export function getFiguresAdjacentTo(game, coord, playerNum = null) {
  return getFiguresWithinRange(game, coord, 1, playerNum)
    .filter((f) => f.distance === 1);
}
