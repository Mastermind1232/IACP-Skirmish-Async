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
} from '../data-loader.js';

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

export function getOccupiedSpacesForMovement(game, excludeFigureKey = null) {
  const occupied = [];
  const poses = game.figurePositions || { 1: {}, 2: {} };
  for (const p of [1, 2]) {
    for (const [k, coord] of Object.entries(poses[p] || {})) {
      if (k === excludeFigureKey) continue;
      const dcName = k.replace(/-\d+-\d+$/, '');
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
  const other = movingPlayerNum === 1 ? 2 : 1;
  for (const [k, coord] of Object.entries(poses[other] || {})) {
    const dcName = k.replace(/-\d+-\d+$/, '');
    const size = game.figureOrientations?.[k] || getFigureSize(dcName);
    hostile.push(...getFootprintCells(coord, size));
  }
  return hostile;
}

export function getMovementKeywords(dcName) {
  const raw = getDcKeywords()?.[dcName] || [];
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
  const adjacency = {};
  for (const [coord, neighbors] of Object.entries(mapSpaces.adjacency || {})) {
    adjacency[normalizeCoord(coord)] = (neighbors || []).map((n) => normalizeCoord(n));
  }
  const movementBlockingSet = new Set(
    (mapSpaces.movementBlockingEdges || []).map((edge) => edgeKey(edge[0], edge[1]))
  );
  for (const edge of mapSpaces.impassableEdges || []) {
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
  return { mapSpaces, adjacency, terrain, blockingSet, occupiedSet, hostileOccupiedSet, movementBlockingSet, spacesSet };
}

export function getMovementProfile(dcName, figureKey, game) {
  const baseSize = getFigureSize(dcName) || '1x1';
  const storedSize = game.figureOrientations?.[figureKey] || baseSize;
  const { cols, rows } = parseSizeString(storedSize);
  const keywords = getMovementKeywords(dcName);
  const isMassive = keywords.has('massive');
  const isMobile = keywords.has('mobile');
  return {
    size: storedSize,
    cols,
    rows,
    isLarge: cols !== 1 || rows !== 1,
    allowDiagonal: cols === 1 && rows === 1,
    canRotate: cols !== rows,
    isMassive,
    isMobile,
    ignoreDifficult: isMassive || isMobile,
    ignoreBlocking: isMassive || isMobile,
    ignoreFigureCost: isMassive || isMobile,
    canEndOnOccupied: isMassive,
    keywords,
  };
}

export function buildTempBoardState(mapSpaces, occupiedSet, hostileOccupiedSet = null) {
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
  for (const edge of mapSpaces.impassableEdges || []) {
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
  const intermediateA = colRowToCoord(col + dx, row);
  const intermediateB = colRowToCoord(col, row + dy);
  if (!board.spacesSet.has(normalizeCoord(intermediateA)) || !board.spacesSet.has(normalizeCoord(intermediateB))) {
    return false;
  }
  const adj = board.adjacency[startLower] || [];
  return adj.includes(normalizeCoord(intermediateA)) && adj.includes(normalizeCoord(intermediateB));
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
  for (const vec of moveVectors) {
    if ((vec.dx && vec.dy) && profile.isLarge) continue;
    if ((vec.dx && vec.dy) && !canMoveDiagonally(state.topLeft, vec.dx, vec.dy, board)) continue;
    const nextTopLeft = shiftCoord(state.topLeft, vec.dx, vec.dy);
    if (!nextTopLeft || !board.spacesSet.has(nextTopLeft)) continue;
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
  if (!profile.ignoreBlocking) {
    for (const cell of nextFootprint) {
      if (board.blockingSet.has(cell)) return null;
    }
  }
  const prevFootprint = current.footprint;
  const prevSet = new Set(prevFootprint);
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
  const enteringBlocking = !profile.ignoreBlocking && entering.some((cell) => board.blockingSet.has(cell));
  if (enteringBlocking) return null;
  const enteringDifficult =
    !profile.ignoreDifficult &&
    entering.some((cell) => (board.terrain[cell] || 'normal') === 'difficult');
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
    const isOccupied = current.footprint.some((cell) => board.occupiedSet.has(cell));
    const canEnd = !isOccupied || profile.canEndOnOccupied;
    nodes.set(current.key, { ...current, isOccupied, canEnd });
    if (canEnd) {
      for (const cell of current.footprint) {
        if (!board.spacesSet.has(cell)) continue;
        if (current.cost === 0 && cell === startTopLeft) continue;
        const prev = cells.get(cell);
        if (!prev || current.cost < prev.cost) {
          cells.set(cell, {
            cost: current.cost,
            topLeft: current.topLeft,
            size: current.size,
          });
        }
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
