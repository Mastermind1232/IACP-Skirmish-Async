/**
 * Movement logic: board state, profile, cache, reachable spaces, path cost. No Discord.
 */
import {
  parseCoord,
  normalizeCoord,
  colRowToCoord,
  edgeKey,
  toLowerSet,
  parseSizeString,
  sizeToString,
  getFootprintCells,
  shiftCoord,
  rotateSizeString,
} from './coords.js';
import {
  getMapSpaces,
  getMapRegistry,
  getMapTokensData,
  getDcKeywords,
  getFigureSize,
  isDcCompanion,
} from '../data-loader.js';
import { getDcList, getDcMessageIds, getDcAttachments, opponentPlayerNum } from './player-helpers.js';
import { dcNameFromFigureKey } from './dc-helpers.js';

// ---------------------------------------------------------------------------
// Wasskah Hunting Ground: breakable walls (blue-line edges on the map diagram).
// Per mission rules: "Walls between spaces containing difficult terrain
// (indicated by blue lines on the map diagram) do not block movement,
// adjacency, line of sight, or counting spaces."
// Each entry is [spaceA, spaceB] — the two spaces on either side of a
// blue-line wall edge.  When BOTH spaces contain difficult terrain (including
// rubble tokens), the wall is passable.
// ---------------------------------------------------------------------------
const WASSKAH_BREAKABLE_WALLS = [
  // Upper-left building — south wall (row 8 → 9 boundary)
  ['e8', 'e9'],
  ['f8', 'f9'],
  // Upper-left building — east wall (col F → G boundary)
  ['f6', 'g6'],
  ['f7', 'g7'],
  // Central building cluster — west walls
  ['h9', 'h10'],
  ['h13', 'h14'],
  // Central building cluster — east walls
  ['n9', 'o9'],
  ['n13', 'o13'],
  // Lower-left building — north wall (row 16 → 15 boundary)
  ['i15', 'i16'],
  ['j15', 'j16'],
  // Lower-left building — east wall
  ['l17', 'm17'],
  ['l18', 'm18'],
  // Lower-right building — north wall
  ['o18', 'o19'],
  ['p18', 'p19'],
  // Lower-right building — west wall
  ['n19', 'n20'],
  ['n21', 'n22'],
];

/**
 * Build a Set of edgeKey strings for breakable walls that are currently passable
 * because both adjacent spaces contain difficult terrain.
 * @param {object} game - game state (for map id, rubble tokens, terrain)
 * @param {object} mapSpaces - the map's spatial data ({ terrain })
 * @returns {Set<string>} set of edgeKey strings for currently-broken walls
 */
export function getBrokenWallEdges(game, mapSpaces) {
  if (game?.selectedMap?.id !== 'wasskah-hunting-ground') return new Set();
  // Collect all difficult-terrain spaces: map terrain + rubble tokens (both storage locations)
  const difficultSet = new Set();
  for (const [coord, type] of Object.entries(mapSpaces?.terrain || {})) {
    if (String(type).toLowerCase() === 'difficult') difficultSet.add(normalizeCoord(coord));
  }
  // game.rubbleTokens (Flame Trooper Incinerate)
  if (Array.isArray(game.rubbleTokens)) {
    for (const rc of game.rubbleTokens) difficultSet.add(normalizeCoord(rc));
  }
  // game.ancillaryTokens.rubble (Demolish, Boulder Barrage, Reduce to Rubble)
  if (Array.isArray(game.ancillaryTokens?.rubble)) {
    for (const rc of game.ancillaryTokens.rubble) difficultSet.add(normalizeCoord(rc));
  }
  const broken = new Set();
  for (const [a, b] of WASSKAH_BREAKABLE_WALLS) {
    if (difficultSet.has(a) && difficultSet.has(b)) {
      broken.add(edgeKey(a, b));
    }
  }
  return broken;
}

/**
 * Return impassableEdges filtered to exclude currently-broken Wasskah walls.
 * Safe to call for any map — returns the original array unchanged for non-Wasskah maps.
 * @param {object} game
 * @param {object} mapSpaces - { impassableEdges, terrain, ... }
 * @returns {Array} filtered impassableEdges array
 */
export function getEffectiveImpassableEdges(game, mapSpaces) {
  const edges = mapSpaces?.impassableEdges || [];
  const broken = getBrokenWallEdges(game, mapSpaces);
  if (broken.size === 0) return edges;
  return edges.filter((e) => !broken.has(edgeKey(e[0], e[1])));
}

/**
 * Return a copy of mapSpaces with impassableEdges filtered for Wasskah breakable walls.
 * Useful for standalone LOS checks that pass mapSpaces directly.
 * Returns the original object unchanged for non-Wasskah maps or when no walls are broken.
 */
export function getEffectiveMapSpaces(game, mapSpaces) {
  if (!mapSpaces) return mapSpaces;
  const filtered = getEffectiveImpassableEdges(game, mapSpaces);
  if (filtered === mapSpaces?.impassableEdges) return mapSpaces;
  return { ...mapSpaces, impassableEdges: filtered };
}

export function isWithinGridBounds(coord, gridBounds) {
  if (!gridBounds || (gridBounds.maxCol == null && gridBounds.maxRow == null)) return true;
  const { col, row } = parseCoord(coord);
  if (col < 0 || row < 0) return false;
  if (gridBounds.maxCol != null && col > gridBounds.maxCol) return false;
  if (gridBounds.maxRow != null && row > gridBounds.maxRow) return false;
  return true;
}

export function filterMapSpacesByBounds(rawMapSpaces, gridBounds) {
  if (!gridBounds || (gridBounds.maxCol == null && gridBounds.maxRow == null)) return rawMapSpaces;
  const inBounds = (c) => isWithinGridBounds(c, gridBounds);
  const spaces = (rawMapSpaces.spaces || []).filter(inBounds);
  const spaceSet = new Set(spaces.map((s) => normalizeCoord(s)));
  const adjacency = {};
  for (const [coord, neighbors] of Object.entries(rawMapSpaces.adjacency || {})) {
    if (!inBounds(coord)) continue;
    adjacency[normalizeCoord(coord)] = (neighbors || []).filter((n) => spaceSet.has(normalizeCoord(n))).map((n) => normalizeCoord(n));
  }
  const terrain = {};
  for (const [coord, type] of Object.entries(rawMapSpaces.terrain || {})) {
    if (inBounds(coord)) terrain[normalizeCoord(coord)] = String(type || 'normal').toLowerCase();
  }
  const blocking = (rawMapSpaces.blocking || []).filter(inBounds);
  const movementBlockingEdges = (rawMapSpaces.movementBlockingEdges || []).filter(
    ([a, b]) => spaceSet.has(normalizeCoord(a)) && spaceSet.has(normalizeCoord(b))
  );
  const impassableEdges = (rawMapSpaces.impassableEdges || []).filter(
    ([a, b]) => spaceSet.has(normalizeCoord(a)) && spaceSet.has(normalizeCoord(b))
  );
  return {
    ...rawMapSpaces,
    spaces,
    adjacency,
    terrain,
    blocking,
    movementBlockingEdges,
    impassableEdges,
  };
}

/**
 * Get map spaces filtered by the map's gridBounds (convenience wrapper).
 * @param {string} mapId
 * @returns {object} Filtered map spaces with adjacency, terrain, etc.
 */
export function getBoundedMapSpaces(mapId) {
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces) return rawMapSpaces;
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  return filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
}

export function getOccupiedSpacesForMovement(game, excludeFigureKey = null) {
  const occupied = [];
  const poses = game.figurePositions || { 1: {}, 2: {} };
  for (const p of [1, 2]) {
    for (const [k, coord] of Object.entries(poses[p] || {})) {
      if (k === excludeFigureKey) continue;
      // G39: Companion figures can share spaces — don't block movement
      const dcName = dcNameFromFigureKey(k);
      if (isDcCompanion(dcName)) continue;
      const size = game.figureOrientations?.[k] || getFigureSize(dcName);
      occupied.push(...getFootprintCells(coord, size));
    }
  }
  return occupied;
}

export function getHostileOccupiedSpacesForMovement(game, excludeFigureKey = null) {
  const hostile = [];
  const poses = game.figurePositions || { 1: {}, 2: {} };
  const movingPlayerNum = excludeFigureKey
    ? (poses[1]?.[excludeFigureKey] != null ? 1 : 2)
    : null;
  if (movingPlayerNum == null) return hostile;
  const other = opponentPlayerNum(movingPlayerNum);
  for (const [k, coord] of Object.entries(poses[other] || {})) {
    const dcName = dcNameFromFigureKey(k);
    const size = game.figureOrientations?.[k] || getFigureSize(dcName);
    hostile.push(...getFootprintCells(coord, size));
  }
  return hostile;
}

/**
 * Get all figures on or adjacent to a given coordinate (1x1 space).
 * Used by Blast when the target's position may already be removed (defeat),
 * and by Cleave for attacker-based eligibility.
 */
export function getFiguresAdjacentToCoord(game, coord, mapId, excludeFigureKey) {
  if (!coord || !mapId) return [];
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return [];
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const normCoord = normalizeCoord(coord);
  const adjacentSet = new Set();
  for (const n of adjacency[normCoord] || []) adjacentSet.add(normalizeCoord(n));
  adjacentSet.add(normCoord);
  const poses = game?.figurePositions || { 1: {}, 2: {} };
  const out = [];
  for (const p of [1, 2]) {
    for (const [figureKey, fCoord] of Object.entries(poses[p] || {})) {
      if (figureKey === excludeFigureKey) continue;
      const dcName = dcNameFromFigureKey(figureKey);
      const size = game.figureOrientations?.[figureKey] || getFigureSize(dcName);
      const cells = getFootprintCells(fCoord, size).map((c) => normalizeCoord(c));
      if (cells.some((cell) => adjacentSet.has(cell))) out.push({ figureKey, playerNum: p });
    }
  }
  return out;
}

/** F6 Blast: Figures with at least one space adjacent to the target figure. Returns [{ figureKey, playerNum }, ...]. */
export function getFiguresAdjacentToTarget(game, targetFigureKey, mapId) {
  const poses = game?.figurePositions || { 1: {}, 2: {} };
  let targetCoord = null;
  let targetPlayerNum = null;
  for (const p of [1, 2]) {
    if (poses[p]?.[targetFigureKey]) {
      targetCoord = poses[p][targetFigureKey];
      targetPlayerNum = p;
      break;
    }
  }
  if (!targetCoord || !mapId) return [];
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return [];
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const targetDcName = dcNameFromFigureKey(targetFigureKey);
  const targetSize = game.figureOrientations?.[targetFigureKey] || getFigureSize(targetDcName);
  const targetCells = getFootprintCells(targetCoord, targetSize).map((c) => normalizeCoord(c));
  const adjacentSet = new Set();
  for (const c of targetCells) {
    for (const n of adjacency[c] || []) adjacentSet.add(normalizeCoord(n));
  }
  const out = [];
  for (const p of [1, 2]) {
    for (const [figureKey, coord] of Object.entries(poses[p] || {})) {
      if (figureKey === targetFigureKey) continue;
      const dcName = dcNameFromFigureKey(figureKey);
      const size = game.figureOrientations?.[figureKey] || getFigureSize(dcName);
      const cells = getFootprintCells(coord, size).map((c) => normalizeCoord(c));
      if (cells.some((cell) => adjacentSet.has(cell))) out.push({ figureKey, playerNum: p });
    }
  }
  return out;
}

export function getMovementKeywords(dcName, game) {
  const raw = getDcKeywords(game)?.[dcName] || [];
  return new Set(raw.map((k) => String(k).toLowerCase()));
}

export function getBoardStateForMovement(game, excludeFigureKey = null) {
  if (!game?.selectedMap?.id) return null;
  const rawMapSpaces = getMapSpaces(game.selectedMap.id);
  if (!rawMapSpaces) return null;
  const mapDef = getMapRegistry().find((m) => m.id === game.selectedMap.id);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const occupiedSet = new Set(
    getOccupiedSpacesForMovement(game, excludeFigureKey).map((s) => normalizeCoord(s))
  );
  const hostileOccupiedSet = new Set(
    getHostileOccupiedSpacesForMovement(game, excludeFigureKey).map((s) => normalizeCoord(s))
  );
  const blockingSet = toLowerSet(mapSpaces.blocking || []);
  const spacesSet = toLowerSet(mapSpaces.spaces || []);
  const terrain = {};
  for (const [coord, type] of Object.entries(mapSpaces.terrain || {})) {
    terrain[normalizeCoord(coord)] = String(type || 'normal').toLowerCase();
  }
  // Rubble tokens (Flame Trooper Incinerate): treat as difficult terrain
  if (Array.isArray(game.rubbleTokens)) {
    for (const rc of game.rubbleTokens) {
      const nc = normalizeCoord(rc);
      if (!terrain[nc] || terrain[nc] === 'normal') terrain[nc] = 'difficult';
    }
  }
  // Rubble tokens (Demolish, Boulder Barrage, Reduce to Rubble): also difficult terrain
  if (Array.isArray(game.ancillaryTokens?.rubble)) {
    for (const rc of game.ancillaryTokens.rubble) {
      const nc = normalizeCoord(rc);
      if (!terrain[nc] || terrain[nc] === 'normal') terrain[nc] = 'difficult';
    }
  }
  const adjacency = {};
  for (const [coord, neighbors] of Object.entries(mapSpaces.adjacency || {})) {
    adjacency[normalizeCoord(coord)] = (neighbors || []).map((n) => normalizeCoord(n));
  }
  const movementBlockingSet = new Set(
    (mapSpaces.movementBlockingEdges || []).map((edge) => edgeKey(edge[0], edge[1]))
  );
  // Wasskah breakable walls: filter out edges that are passable due to difficult terrain
  const effectiveImpassable = getEffectiveImpassableEdges(game, mapSpaces);
  for (const edge of effectiveImpassable) {
    if (edge?.length >= 2) movementBlockingSet.add(edgeKey(edge[0], edge[1]));
  }
  const mapData = getMapTokensData()[game.selectedMap.id];
  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  for (const edge of mapData?.doors || []) {
    if (edge?.length >= 2) {
      const ek = edgeKey(edge[0], edge[1]);
      if (!openedSet.has(ek)) movementBlockingSet.add(ek);
    }
  }
  // G64: Track cells occupied by Massive figures (Massive cannot enter other Massive)
  const massiveOccupiedSet = new Set();
  const poses = game.figurePositions || { 1: {}, 2: {} };
  for (const p of [1, 2]) {
    for (const [k, coord] of Object.entries(poses[p] || {})) {
      if (k === excludeFigureKey) continue;
      const dn = dcNameFromFigureKey(k);
      const kws = getDcKeywords(game)?.[dn] || [];
      if (kws.some((kw) => String(kw).toUpperCase() === 'MASSIVE')) {
        const sz = game.figureOrientations?.[k] || getFigureSize(dn);
        for (const cell of getFootprintCells(coord, sz)) massiveOccupiedSet.add(normalizeCoord(cell));
      }
    }
  }
  return { mapSpaces, adjacency, terrain, blockingSet, occupiedSet, hostileOccupiedSet, movementBlockingSet, spacesSet, massiveOccupiedSet };
}

export function getMovementProfile(dcName, figureKey, game) {
  const baseSize = getFigureSize(dcName) || '1x1';
  const storedSize = game.figureOrientations?.[figureKey] || baseSize;
  const { cols, rows } = parseSizeString(storedSize);
  const keywords = getMovementKeywords(dcName, game);
  const isMassive = keywords.has('massive');
  const isMobile = keywords.has('mobile');
  let hasEfficientTravel = keywords.has('efficient travel');
  // Check round flag from Efficient Travel CC card
  if (!hasEfficientTravel && figureKey) {
    for (const pn of [1, 2]) {
      if (figureKey in (game.figurePositions?.[pn] || {})) {
        if (game.roundEfficientTravel?.[pn]) hasEfficientTravel = true;
        break;
      }
    }
  }
  // Survivalist (Skirmish Upgrade): ignore difficult terrain and hostile figure movement costs
  let hasSurvivalist = false;
  if (figureKey && game) {
    const _svDcName = dcNameFromFigureKey(figureKey);
    for (const pn of [1, 2]) {
      if (!(figureKey in (game.figurePositions?.[pn] || {}))) continue;
      const _svList = getDcList(game, pn) || [];
      const _svIds = getDcMessageIds(game, pn) || [];
      for (let i = 0; i < _svList.length; i++) {
        if (_svList[i]?.dcName !== _svDcName) continue;
        const _svAtt = getDcAttachments(game, pn)?.[_svIds[i]];
        if (_svAtt?.includes('Survivalist')) hasSurvivalist = true;
        break;
      }
      break;
    }
  }
  // Mortar Trooper Haul: treat blocking and impassable terrain as difficult terrain
  let hasMortarHaul = false;
  if (figureKey && game) {
    const _mhDcName = dcNameFromFigureKey(figureKey);
    for (const pn of [1, 2]) {
      if (!(figureKey in (game.figurePositions?.[pn] || {}))) continue;
      const _mhList = getDcList(game, pn) || [];
      const _mhIds = getDcMessageIds(game, pn) || [];
      for (let i = 0; i < _mhList.length; i++) {
        if (_mhList[i]?.dcName !== _mhDcName) continue;
        const _mhAtt = getDcAttachments(game, pn)?.[_mhIds[i]];
        if (_mhAtt?.includes('Mortar Trooper')) hasMortarHaul = true;
        break;
      }
      break;
    }
  }
  return {
    size: storedSize,
    cols,
    rows,
    isLarge: cols !== 1 || rows !== 1,
    allowDiagonal: cols === 1 && rows === 1,
    canRotate: cols !== rows,
    isMassive,
    isMobile,
    ignoreDifficult: isMassive || isMobile || hasEfficientTravel || hasSurvivalist,
    ignoreBlocking: isMassive || isMobile,
    ignoreFigureCost: isMassive || isMobile || hasEfficientTravel || hasSurvivalist,
    canEndOnOccupied: isMassive,
    treatBlockingAsDifficult: hasMortarHaul,
    keywords,
  };
}

export function buildTempBoardState(mapSpaces, occupiedSet, hostileOccupiedSet = null, game = null) {
  if (!mapSpaces) return null;
  const blockingSet = toLowerSet(mapSpaces.blocking || []);
  const spacesSet = toLowerSet(mapSpaces.spaces || []);
  const terrain = {};
  for (const [coord, type] of Object.entries(mapSpaces.terrain || {})) {
    terrain[normalizeCoord(coord)] = String(type || 'normal').toLowerCase();
  }
  const adjacency = {};
  for (const [coord, neighbors] of Object.entries(mapSpaces.adjacency || {})) {
    adjacency[normalizeCoord(coord)] = (neighbors || []).map((n) => normalizeCoord(n));
  }
  const movementBlockingSet = new Set(
    (mapSpaces.movementBlockingEdges || []).map((edge) => edgeKey(edge[0], edge[1]))
  );
  // Wasskah breakable walls: filter out edges passable due to difficult terrain
  const effectiveImpassable = game ? getEffectiveImpassableEdges(game, mapSpaces) : (mapSpaces.impassableEdges || []);
  for (const edge of effectiveImpassable) {
    if (edge?.length >= 2) movementBlockingSet.add(edgeKey(edge[0], edge[1]));
  }
  const board = {
    mapSpaces,
    adjacency,
    terrain,
    blockingSet,
    occupiedSet: new Set((occupiedSet || []).map((s) => normalizeCoord(s))),
    movementBlockingSet,
    spacesSet,
  };
  if (hostileOccupiedSet != null) {
    board.hostileOccupiedSet = new Set((hostileOccupiedSet || []).map((s) => normalizeCoord(s)));
  }
  return board;
}

export function movementStateKey(coord, size) {
  return `${normalizeCoord(coord)}|${size}`;
}

export function getNormalizedFootprint(topLeft, size) {
  return getFootprintCells(topLeft, size).map((c) => normalizeCoord(c));
}

function canMoveDiagonally(start, dx, dy, board) {
  if (!dx || !dy) return true;
  const startLower = normalizeCoord(start);
  const { col, row } = parseCoord(startLower);
  const aNorm = normalizeCoord(colRowToCoord(col + dx, row));  // lateral corner (same row)
  const bNorm = normalizeCoord(colRowToCoord(col, row + dy));  // vertical corner (same col)
  const destNorm = normalizeCoord(colRowToCoord(col + dx, row + dy));
  const aExists = board.spacesSet.has(aNorm);
  const bExists = board.spacesSet.has(bNorm);
  // Fully sealed corner — both sides absent, cannot cut through
  if (!aExists && !bExists) return false;
  // IA corner-cut rule: diagonal is allowed if at least one full path (corner → dest) is open.
  // First half: start → corner (adjacency encodes impassable walls; movementBlockingSet catches doors)
  const adjList = board.adjacency?.[startLower] || [];
  const adjSet = new Set(adjList);
  const aFirstOpen = aExists && adjSet.has(aNorm) && !board.movementBlockingSet.has(edgeKey(startLower, aNorm));
  const bFirstOpen = bExists && adjSet.has(bNorm) && !board.movementBlockingSet.has(edgeKey(startLower, bNorm));
  // Second half: corner → dest (must not be walled off from the corner)
  const aSecondOpen =
    aFirstOpen &&
    !board.movementBlockingSet.has(edgeKey(aNorm, destNorm)) &&
    (!board.adjacency?.[aNorm] || (board.adjacency[aNorm] || []).includes(destNorm));
  const bSecondOpen =
    bFirstOpen &&
    !board.movementBlockingSet.has(edgeKey(bNorm, destNorm)) &&
    (!board.adjacency?.[bNorm] || (board.adjacency[bNorm] || []).includes(destNorm));
  return aSecondOpen || bSecondOpen;
}

function getNeighborStates(state, board, profile) {
  const neighbors = [];
  const moveVectors = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  if (profile.allowDiagonal) {
    moveVectors.push(
      { dx: 1, dy: 1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: -1 }
    );
  }
  // When adjacency data is present for this cell, use it to restrict moves to genuinely
  // connected cells. This handles maps where walls are encoded as adjacency restrictions
  // rather than (or in addition to) movementBlockingEdges.
  const adjForCell = board.adjacency?.[state.topLeft];
  const adjSet = adjForCell ? new Set(adjForCell) : null;

  for (const vec of moveVectors) {
    const isDiagonal = !!(vec.dx && vec.dy);
    if (isDiagonal && profile.isLarge) continue;
    if (isDiagonal && !canMoveDiagonally(state.topLeft, vec.dx, vec.dy, board)) continue;
    const nextTopLeft = shiftCoord(state.topLeft, vec.dx, vec.dy);
    if (!nextTopLeft || !board.spacesSet.has(nextTopLeft)) continue;
    // For orthogonal moves, adjacency is the source of truth for wall encoding.
    // For diagonal moves, canMoveDiagonally handles corner logic (adjacency data may not
    // list diagonal targets that are reachable by the IA corner-cut rule).
    if (!isDiagonal && adjSet && !adjSet.has(nextTopLeft)) continue;
    neighbors.push({ type: 'move', topLeft: nextTopLeft, size: state.size, dx: vec.dx, dy: vec.dy });
  }
  if (profile.canRotate) {
    const rotatedSize = rotateSizeString(state.size);
    neighbors.push({ type: 'rotate', topLeft: state.topLeft, size: rotatedSize, dx: 0, dy: 0 });
  }
  return neighbors;
}

function evaluateMovementStep(current, neighbor, board, profile) {
  const nextFootprint = getNormalizedFootprint(neighbor.topLeft, neighbor.size);
  if (!nextFootprint.length) return null;
  for (const cell of nextFootprint) {
    if (!board.spacesSet.has(cell)) return null;
  }
  if (!profile.ignoreBlocking && !profile.treatBlockingAsDifficult) {
    for (const cell of nextFootprint) {
      if (board.blockingSet.has(cell)) return null;
    }
  }
  const prevFootprint = current.footprint;
  const prevSet = new Set(prevFootprint);
  // Large figures must keep at least half their footprint in previously occupied cells each step
  if (profile.isLarge) {
    const overlapCount = nextFootprint.filter((c) => prevSet.has(c)).length;
    if (overlapCount < Math.ceil(nextFootprint.length / 2)) return null;
  }
  if (neighbor.type === 'rotate') {
    const overlapping = nextFootprint.some((c) => board.occupiedSet.has(c));
    if (overlapping && !profile.canEndOnOccupied) return null;
    return {
      cost: 1,
      occupied: overlapping,
      canEnd: !overlapping || profile.canEndOnOccupied,
      footprint: nextFootprint,
    };
  }
  const entering = nextFootprint.filter((cell) => !prevSet.has(cell));
  if (!entering.length) return null;
  const dx = neighbor.dx;
  const dy = neighbor.dy;
  if (board.movementBlockingSet.size > 0) {
    const backDx = dx ? -Math.sign(dx) : 0;
    const backDy = dy ? -Math.sign(dy) : 0;
    for (const cell of entering) {
      const { col, row } = parseCoord(cell);
      const prevCoord = colRowToCoord(col + backDx, row + backDy);
      if (!prevSet.has(normalizeCoord(prevCoord))) continue;
      if (board.movementBlockingSet.has(edgeKey(cell, prevCoord))) return null;
    }
  }
  const enteringBlockingCells = !profile.ignoreBlocking ? entering.filter((cell) => board.blockingSet.has(cell)) : [];
  // Mortar Trooper Haul: blocking/impassable become difficult instead of impassable
  if (enteringBlockingCells.length > 0 && !profile.treatBlockingAsDifficult) return null;
  const enteringDifficult =
    !profile.ignoreDifficult &&
    (entering.some((cell) => (board.terrain[cell] || 'normal') === 'difficult') || (profile.treatBlockingAsDifficult && enteringBlockingCells.length > 0));
  const enteringOccupied = entering.some((cell) => board.occupiedSet.has(cell));
  const enteringHostile = board.hostileOccupiedSet
    ? entering.some((cell) => board.hostileOccupiedSet.has(cell))
    : enteringOccupied;
  const baseCost = 1;
  let extraCost = 0;
  if (enteringDifficult) extraCost += 1;
  if (enteringHostile && !profile.ignoreFigureCost) extraCost += 1;
  return {
    cost: baseCost + extraCost,
    occupied: enteringOccupied,
    canEnd: !enteringOccupied || profile.canEndOnOccupied,
    footprint: nextFootprint,
  };
}

export function computeMovementCache(startCoord, mpLimit, board, profile) {
  const startTopLeft = normalizeCoord(startCoord);
  if (!board?.spacesSet?.has(startTopLeft)) return { nodes: new Map(), cells: new Map(), parent: new Map(), maxMp: mpLimit };
  const startKey = movementStateKey(startTopLeft, profile.size);
  const queue = [
    {
      key: startKey,
      topLeft: startTopLeft,
      size: profile.size,
      cost: 0,
      footprint: getNormalizedFootprint(startTopLeft, profile.size),
    },
  ];
  const bestCost = new Map([[startKey, 0]]);
  const nodes = new Map();
  const cells = new Map();
  const parent = new Map();
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (current.cost > mpLimit) continue;
    // G64: Massive figures cannot enter spaces occupied by other Massive figures
    const hitsMassive = profile.isMassive && board.massiveOccupiedSet &&
      current.footprint.some((cell) => board.massiveOccupiedSet.has(cell));
    if (hitsMassive) continue; // skip entirely — cannot pass through or end here
    const isOccupied = current.footprint.some((cell) => board.occupiedSet.has(cell));
    const canEnd = !isOccupied || profile.canEndOnOccupied;
    nodes.set(current.key, { ...current, isOccupied, canEnd });
    // Only record the topLeft cell, never non-topLeft footprint cells.
    // Recording all footprint cells causes permanent poisoning: a cell that is a
    // non-topLeft member of a cheaper placement (lower cost) can never be updated
    // when that same cell is the topLeft of a more-expensive placement, because
    // the cost comparison (newCost < cheaperCost) always fails.  This would make
    // destinations invisible for any multi-tile figure move beyond the first step
    // in a straight line.
    if (canEnd && current.cost > 0) {
      const prev = cells.get(current.topLeft);
      if (!prev || current.cost < prev.cost) {
        cells.set(current.topLeft, {
          cost: current.cost,
          topLeft: current.topLeft,
          size: current.size,
        });
      }
    }
    const neighbors = getNeighborStates(current, board, profile);
    for (const neighbor of neighbors) {
      const step = evaluateMovementStep(current, neighbor, board, profile);
      if (!step) continue;
      const newCost = current.cost + step.cost;
      if (newCost > mpLimit) continue;
      const neighborKey = movementStateKey(neighbor.topLeft, neighbor.size);
      if (bestCost.has(neighborKey) && bestCost.get(neighborKey) <= newCost) continue;
      bestCost.set(neighborKey, newCost);
      parent.set(neighborKey, current.key);
      queue.push({
        key: neighborKey,
        topLeft: neighbor.topLeft,
        size: neighbor.size,
        cost: newCost,
        footprint: step.footprint,
      });
    }
  }
  return { nodes, cells, parent, maxMp: mpLimit };
}

export function getSpacesAtCost(cache, mpCost) {
  const matches = [];
  for (const [cell, info] of cache.cells.entries()) {
    if (info.cost === mpCost) matches.push(cell);
  }
  return matches;
}

export function getMovementTarget(cache, coord) {
  return cache.cells.get(normalizeCoord(coord)) || null;
}

export function getMovementPath(cache, startCoord, destTopLeft, destSize, profile) {
  if (!cache?.parent) return [];
  const startKey = movementStateKey(normalizeCoord(startCoord), profile.size);
  const destKey = movementStateKey(normalizeCoord(destTopLeft), destSize || profile.size);
  const path = [];
  let key = destKey;
  while (key) {
    const node = cache.nodes.get(key);
    if (!node) break;
    path.unshift(node.topLeft);
    if (key === startKey) break;
    key = cache.parent.get(key);
  }
  return path;
}

export function ensureMovementCache(moveState, startCoord, mpLimit, board, profile) {
  if (!moveState.movementCache || (moveState.cacheMaxMp || 0) < mpLimit) {
    moveState.movementCache = computeMovementCache(startCoord, mpLimit, board, profile);
    moveState.cacheMaxMp = mpLimit;
  }
  return moveState.movementCache;
}

export function getReachableSpaces(startCoord, mp, mapSpaces, occupiedSet) {
  const board = buildTempBoardState(mapSpaces, occupiedSet);
  if (!board || mp <= 0) return [];
  const profile = {
    size: '1x1',
    cols: 1,
    rows: 1,
    isLarge: false,
    allowDiagonal: true,
    canRotate: false,
    isMassive: false,
    isMobile: false,
    ignoreDifficult: false,
    ignoreBlocking: false,
    ignoreFigureCost: false,
    canEndOnOccupied: false,
  };
  const cache = computeMovementCache(startCoord, mp, board, profile);
  return [...cache.cells.keys()];
}

export function getPathCost(startCoord, destCoord, mapSpaces, occupiedSet) {
  const board = buildTempBoardState(mapSpaces, occupiedSet);
  if (!board) return Infinity;
  const profile = {
    size: '1x1',
    cols: 1,
    rows: 1,
    isLarge: false,
    allowDiagonal: true,
    canRotate: false,
    isMassive: false,
    isMobile: false,
    ignoreDifficult: false,
    ignoreBlocking: false,
    ignoreFigureCost: false,
    canEndOnOccupied: false,
  };
  const cache = computeMovementCache(startCoord, 50, board, profile);
  const target = cache.cells.get(normalizeCoord(destCoord));
  return target ? target.cost : Infinity;
}

/**
 * Find figures whose footprint overlaps with the given footprint set.
 * Returns friendly overlaps first, then enemy.
 */
export function collectOverlappingFigures(game, movingPlayerNum, movingFigureKey, footprint) {
  const overlapsFriendly = [];
  const overlapsEnemy = [];
  for (const p of [1, 2]) {
    const poses = game.figurePositions?.[p] || {};
    for (const [key, coord] of Object.entries(poses)) {
      if (key === movingFigureKey) continue;
      const dcName = dcNameFromFigureKey(key);
      const size = game.figureOrientations?.[key] || getFigureSize(dcName);
      const cells = getNormalizedFootprint(coord, size);
      const intersects = cells.some((cell) => footprint.has(cell));
      if (!intersects) continue;
      const entry = { playerNum: p, figureKey: key, dcName };
      if (p === movingPlayerNum) overlapsFriendly.push(entry);
      else overlapsEnemy.push(entry);
    }
  }
  return [...overlapsFriendly, ...overlapsEnemy];
}

/**
 * BFS to push a figure to the nearest valid (unoccupied, non-blocked) space.
 */
export function pushFigureToNearestValid(game, playerNum, figureKey, forbiddenSet) {
  const coord = game.figurePositions?.[playerNum]?.[figureKey];
  if (!coord) return false;
  const dcName = dcNameFromFigureKey(figureKey);
  const board = getBoardStateForMovement(game, figureKey);
  if (!board) return false;
  const profile = getMovementProfile(dcName, figureKey, game);
  const startTopLeft = normalizeCoord(coord);
  const queue = [startTopLeft];
  const visited = new Set([movementStateKey(startTopLeft, profile.size)]);
  while (queue.length > 0) {
    const topLeft = queue.shift();
    const footprint = new Set(getNormalizedFootprint(topLeft, profile.size));
    const overlapForbidden = [...footprint].some((cell) => forbiddenSet.has(cell));
    const overlapOther = [...footprint].some((cell) => board.occupiedSet.has(cell));
    const blocked = !profile.ignoreBlocking && [...footprint].some((cell) => board.blockingSet.has(cell));
    if (!overlapForbidden && !overlapOther && !blocked) {
      game.figurePositions[playerNum][figureKey] = topLeft;
      return true;
    }
    const moveVectors = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    for (const vec of moveVectors) {
      const nextTopLeft = shiftCoord(topLeft, vec.dx, vec.dy);
      if (!board.spacesSet.has(nextTopLeft)) continue;
      if (board.movementBlockingSet && board.movementBlockingSet.has(edgeKey(topLeft, nextTopLeft))) continue;
      const stateKey = movementStateKey(nextTopLeft, profile.size);
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      queue.push(nextTopLeft);
    }
  }
  return false;
}

/**
 * Handle collision resolution for massive figures that can end on occupied spaces.
 * Pushes each displaced figure to the nearest valid space. When multiple figures
 * overlap, they are pushed one at a time — the order matters because each push
 * changes the board state (freed spaces) for subsequent pushes.
 * @param {Function} logGameAction - Discord logging function passed from caller
 */
export async function resolveMassivePush(game, profile, figureKey, playerNum, newFootprint, client, logGameAction) {
  if (!profile.canEndOnOccupied) return;
  const footprintSet = new Set(newFootprint);
  const overlaps = collectOverlappingFigures(game, playerNum, figureKey, footprintSet);
  if (overlaps.length === 0) return;
  // Push each figure one at a time; earlier pushes free spaces for later ones
  for (const entry of overlaps) {
    const prevPos = game.figurePositions?.[entry.playerNum]?.[entry.figureKey];
    const success = pushFigureToNearestValid(game, entry.playerNum, entry.figureKey, footprintSet);
    const newPos = game.figurePositions?.[entry.playerNum]?.[entry.figureKey];
    if (!success) {
      console.warn(`Failed to push ${entry.figureKey} away from massive figure ${figureKey}`);
    } else if (logGameAction) {
      const from = prevPos ? String(prevPos).toUpperCase() : '?';
      const to = newPos ? String(newPos).toUpperCase() : '?';
      await logGameAction(game, client, `**${entry.dcName}** displaced **${from}** → **${to}** by massive figure.`, { icon: 'move', phase: 'ROUND' });
    }
  }
  // G66-G68: After Massive ends on occupied space and pushes, lock voluntary movement for rest of phase
  game.massiveMovementLocked = game.massiveMovementLocked || {};
  game.massiveMovementLocked[figureKey] = true;
  await logGameAction(game, client, `Massive figure pushed ${overlaps.length} figure(s) aside. Movement locked for this phase.`, { icon: 'move', phase: 'ROUND' });
}
