/**
 * Movement logic: board state, profile, cache, reachable spaces, path cost. No Discord.
 */

/**
 * Build the set of cells "edge or corner adjacent to a wall" for use by
 * Wall Run (Cal Kestis). A wall is an impassable edge between two
 * 4-adjacent cells; the cells on either side are edge-adjacent, and the
 * 4 cells at the wall's two endpoints are corner-adjacent (perpendicular
 * to the wall axis). Per destruct 2026-05-07: "Wall Run means 8-direction
 * adjacency as always in this game."
 *
 * @param {Array<Array<string>>} impassableEdges - [[a,b], ...] from mapSpaces
 * @returns {Set<string>} normalized coords of wall-adjacent cells
 */
function buildWallAdjacentSet(impassableEdges) {
  const result = new Set();
  for (const edge of (impassableEdges || [])) {
    if (!Array.isArray(edge) || edge.length < 2) continue;
    const aRaw = edge[0], bRaw = edge[1];
    if (!aRaw || !bRaw) continue;
    const a = normalizeCoord(aRaw);
    const b = normalizeCoord(bRaw);
    result.add(a);
    result.add(b);
    const pA = parseCoord(a);
    const pB = parseCoord(b);
    if (pA.col < 0 || pA.row < 0 || pB.col < 0 || pB.row < 0) continue;
    const dc = pB.col - pA.col;
    const dr = pB.row - pA.row;
    if (dc !== 0 && dr === 0) {
      // Horizontal pair → vertical wall between them; corners share row±1
      for (const off of [-1, 1]) {
        result.add(colRowToCoord(pA.col, pA.row + off));
        result.add(colRowToCoord(pB.col, pB.row + off));
      }
    } else if (dc === 0 && dr !== 0) {
      // Vertical pair → horizontal wall between them; corners share col±1
      for (const off of [-1, 1]) {
        result.add(colRowToCoord(pA.col + off, pA.row));
        result.add(colRowToCoord(pB.col + off, pB.row));
      }
    }
    // Diagonal walls (rare in IA): edge-only treatment.
  }
  result.delete('');
  return result;
}
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
  getMapData,
  getMapRegistry,
  getMapTokensData,
  getDcKeywords,
  getDcEffects,
  getFigureSize,
  isDcCompanion,
} from '../data-loader.js';
import { getDcList, getDcMessageIds, getDcAttachments, opponentPlayerNum, pushFigure } from './player-helpers.js';
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
  const rawMapSpaces = getMapData(mapId);
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
      // G39: Companion figures can share spaces — don't block movement.
      // CRR-INCP-001: an incapacitated figure's space blocks movement-end
      // (even for companions that otherwise share). Current skirmish
      // substrate: The Child when game.childIncapacitated is true.
      const dcName = dcNameFromFigureKey(k);
      const _isIncap = dcName === 'The Child' && game.childIncapacitated;
      if (isDcCompanion(dcName) && !_isIncap) continue;
      const size = game.figureOrientations?.[k] || getFigureSize(dcName);
      occupied.push(...getFootprintCells(coord, size));
    }
  }
  // NPC figures (Thugs/Krykna) block end-of-movement for non-MASSIVE
  // figures per alexanbv 2026-05-10: "Figures except massive figures
  // cannot end in the same space as neutral figure." MASSIVE-mover
  // exemption is applied at end-of-move checks downstream (the moving
  // figure's size determines whether it can end here). All live NPCs
  // — regardless of hostility class — occupy a space.
  for (const [arrName] of [['npcThugs'], ['npcKrykna']]) {
    const arr = game[arrName];
    if (!Array.isArray(arr)) continue;
    for (const npc of arr) {
      if (!npc || npc.defeated || !npc.coord) continue;
      occupied.push(normalizeCoord(npc.coord));
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
  // NPCs with hostility='hostile' (Thugs) cost +1 MP to move through, per
  // alexanbv 2026-05-10. 'treatedAsHostile' (Krykna) do NOT add the cost.
  for (const [arrName] of [['npcThugs'], ['npcKrykna']]) {
    const arr = game[arrName];
    if (!Array.isArray(arr)) continue;
    for (const npc of arr) {
      if (!npc || npc.defeated || !npc.coord) continue;
      const h = npc.hostility || (npc.hostileToAll ? 'hostile' : 'neutral');
      if (h !== 'hostile') continue;
      hostile.push(normalizeCoord(npc.coord));
    }
  }
  return hostile;
}

/**
 * Get all figures on or adjacent to a given coordinate (1x1 space).
 * Used by Blast when the target's position may already be removed (defeat),
 * and by Cleave for attacker-based eligibility.
 */
/**
 * Adjacent-figures lookup. Pass `coordSize` for multi-cell origins (e.g.
 * blast adjacency around a defeated LARGE/MASSIVE target whose footprint
 * spanned multiple cells); without it, treats `coord` as a single 1x1 origin.
 *
 * Per CRR step 8: blast/cleave-eligible adjacency uses the target's full
 * pre-defeat footprint, not just one cell.
 */
export function getFiguresAdjacentToCoord(game, coord, mapId, excludeFigureKey, coordSize = null) {
  if (!coord || !mapId) return [];
  const rawMapSpaces = getMapData(mapId);
  if (!rawMapSpaces?.adjacency) return [];
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  // Origin cells: just the single normalized coord, or all footprint cells when coordSize is given.
  const originCells = coordSize
    ? getFootprintCells(coord, coordSize).map((c) => normalizeCoord(c))
    : [normalizeCoord(coord)];
  const adjacentSet = new Set();
  for (const oc of originCells) {
    adjacentSet.add(oc);
    for (const n of adjacency[oc] || []) adjacentSet.add(normalizeCoord(n));
  }
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
  // Neutral NPC figures (Thugs, Krykna) — per alexanbv 2026-05-10.
  for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
    const arr = game[arrName];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const npc = arr[i];
      if (!npc || npc.defeated) continue;
      const cell = normalizeCoord(npc.coord);
      if (!adjacentSet.has(cell)) continue;
      const fk = `npc_${npcType}_${i}`;
      if (fk === excludeFigureKey) continue;
      out.push({ figureKey: fk, playerNum: null, isNpc: true, npcType, npcIndex: i });
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
  const rawMapSpaces = getMapData(mapId);
  if (!rawMapSpaces?.adjacency) return [];
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const targetDcName = dcNameFromFigureKey(targetFigureKey);
  const targetSize = game.figureOrientations?.[targetFigureKey] || getFigureSize(targetDcName);
  const targetCells = getFootprintCells(targetCoord, targetSize).map((c) => normalizeCoord(c));
  const adjacentSet = new Set();
  for (const c of targetCells) {
    // Per CRR figure-adjacency: "Two figures are adjacent if a space one
    // occupies is adjacent to a space the other occupies, OR if both
    // figures occupy the same space." Companions (e.g. The Child via Clan
    // of Two) and other same-square cases must be returned as adjacent —
    // mirrors getFiguresAdjacentToCoord above which already does this for
    // blast/cleave. Live game 00001 (2026-05-04): C-3PO walked onto The
    // Child's square; Inform's "adjacent friendly" list excluded The
    // Child without this line.
    adjacentSet.add(c);
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
  // Neutral NPC figures (Thugs, Krykna) — per alexanbv 2026-05-10,
  // neutrals are figures and must be returned by every figure-iteration
  // helper. Yielded with playerNum=null + isNpc=true so caller branches
  // route to applyDamageToNpc / figureConditions[npc_thug_N] etc.
  for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
    const arr = game[arrName];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const npc = arr[i];
      if (!npc || npc.defeated) continue;
      const cell = normalizeCoord(npc.coord);
      if (!adjacentSet.has(cell)) continue;
      out.push({ figureKey: `npc_${npcType}_${i}`, playerNum: null, isNpc: true, npcType, npcIndex: i });
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
  const rawMapSpaces = getMapData(game.selectedMap.id);
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
  // Wall Run (Cal Kestis): cells edge/corner-adjacent to any impassable wall.
  // Consumed by evaluateMovementStep when profile.wallRunActive is set.
  const wallAdjacentSet = buildWallAdjacentSet(effectiveImpassable);
  return { mapSpaces, adjacency, terrain, blockingSet, occupiedSet, hostileOccupiedSet, movementBlockingSet, spacesSet, massiveOccupiedSet, wallAdjacentSet };
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
  // Wall Run (Cal Kestis): per-figure flag set by ability handler at activation.
  // Cleared when activation ends. Activates a per-step terrain-cost waiver
  // for cells edge/corner-adjacent to a wall (board.wallAdjacentSet).
  const wallRunActive = !!(figureKey && game?.figureWallRunActive?.[figureKey]);
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
    wallRunActive,
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
    wallAdjacentSet: buildWallAdjacentSet(effectiveImpassable),
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
    // CRR MOVE-016: rotation base cost is 1 MP, but Large figures without
    // Massive or Mobile pay the same additional MP costs as ordinary steps
    // for difficult terrain and hostile-figure cells in the newly-entered
    // footprint. Massive/Mobile set ignoreDifficult + ignoreFigureCost on
    // the profile (game/movement.js:getMovementProfile), so those figures
    // retain the flat 1-MP rotation cost per CRR-MOVE-015.
    const rotateEntering = nextFootprint.filter((cell) => !prevSet.has(cell));
    const rotateIntoDifficult =
      !profile.ignoreDifficult &&
      rotateEntering.some((cell) => (board.terrain[cell] || 'normal') === 'difficult');
    const rotateIntoHostile = board.hostileOccupiedSet
      ? rotateEntering.some((cell) => board.hostileOccupiedSet.has(cell))
      : rotateEntering.some((cell) => board.occupiedSet.has(cell));
    let extraCost = 0;
    if (rotateIntoDifficult) extraCost += 1;
    if (rotateIntoHostile && !profile.ignoreFigureCost) extraCost += 1;
    return {
      cost: 1 + extraCost,
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
  // Wall Run (Cal Kestis): per card text "ignore terrain in spaces that
  // share an edge or corner with a wall." Per alexanbv 2026-05-10:
  // this includes blocking AND impassable AND difficult terrain, not
  // just difficult. The waiver applies when every cell being entered
  // is wall-adjacent.
  const wallRunWaivesTerrain =
    profile.wallRunActive &&
    board.wallAdjacentSet &&
    entering.every((cell) => board.wallAdjacentSet.has(cell));
  const enteringBlockingCells = (!profile.ignoreBlocking && !wallRunWaivesTerrain)
    ? entering.filter((cell) => board.blockingSet.has(cell))
    : [];
  // Mortar Trooper Haul: blocking/impassable become difficult instead of impassable
  if (enteringBlockingCells.length > 0 && !profile.treatBlockingAsDifficult) return null;
  const enteringDifficult =
    !profile.ignoreDifficult &&
    !wallRunWaivesTerrain &&
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

// Min-heap keyed on cost with FIFO tie-break on _seq. Produces pop() order
// identical to Array.sort((a,b)=>a.cost-b.cost) + shift() (stable sort),
// so computeMovementCache output is bit-identical to the previous impl.
class MovementHeap {
  constructor() { this.arr = []; this._seq = 0; }
  get size() { return this.arr.length; }
  push(item) {
    item._seq = this._seq++;
    this.arr.push(item);
    let i = this.arr.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._cmp(this.arr[p], this.arr[i]) <= 0) break;
      const t = this.arr[p]; this.arr[p] = this.arr[i]; this.arr[i] = t;
      i = p;
    }
  }
  pop() {
    const n = this.arr.length;
    if (n === 0) return null;
    const top = this.arr[0];
    const last = this.arr.pop();
    if (n > 1) {
      this.arr[0] = last;
      const size = this.arr.length;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let best = i;
        if (l < size && this._cmp(this.arr[l], this.arr[best]) < 0) best = l;
        if (r < size && this._cmp(this.arr[r], this.arr[best]) < 0) best = r;
        if (best === i) break;
        const t = this.arr[best]; this.arr[best] = this.arr[i]; this.arr[i] = t;
        i = best;
      }
    }
    return top;
  }
  _cmp(a, b) {
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a._seq - b._seq;
  }
}

export function computeMovementCache(startCoord, mpLimit, board, profile) {
  const startTopLeft = normalizeCoord(startCoord);
  if (!board?.spacesSet?.has(startTopLeft)) return { nodes: new Map(), cells: new Map(), parent: new Map(), maxMp: mpLimit };
  const startKey = movementStateKey(startTopLeft, profile.size);
  const queue = new MovementHeap();
  queue.push({
    key: startKey,
    topLeft: startTopLeft,
    size: profile.size,
    cost: 0,
    footprint: getNormalizedFootprint(startTopLeft, profile.size),
  });
  const bestCost = new Map([[startKey, 0]]);
  const nodes = new Map();
  const cells = new Map();
  const parent = new Map();
  while (queue.size > 0) {
    const current = queue.pop();
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

/**
 * Reachability for "move up to N spaces" abilities.
 *
 * destruct 2026-05-06: in IACP, "move N spaces" is distinct from "gain N MP":
 * - "gain N MP" → respects difficult-terrain (+1) and hostile-occupancy (+1)
 *   surcharges. 3 MP through 1 difficult cell + 1 normal cell = 2 cells of
 *   movement (3 MP - 2 difficult - 1 normal = 0).
 * - "move up to N spaces" → each cell costs exactly 1, regardless of terrain
 *   or hostile occupancy. The figure can enter N cells regardless of what
 *   they're made of (still respecting walls / impassable / closed-door
 *   edges / blocking).
 *
 * Implementation reuses computeMovementCache by overriding the figure's
 * profile with `ignoreDifficult: true, ignoreFigureCost: true` and passing
 * the requested space-count as the MP-budget. The traversal still respects
 * impassable edges, closed doors, and (for non-Massive figures) blocking
 * terrain — it ONLY removes the per-cell surcharge.
 *
 * @param {string} startCoord - figure's current top-left.
 * @param {number} spaceCount - max cells the figure may enter.
 * @param {object} board - same board as computeMovementCache.
 * @param {object} baseProfile - the figure's regular movement profile.
 * @returns {object} same shape as computeMovementCache; cache.cells.cost
 *   represents cells entered (not MP), so getSpacesAtCost(cache, N) returns
 *   cells N spaces away.
 */
export function computeSpacesReachable(startCoord, spaceCount, board, baseProfile) {
  const profile = {
    ...baseProfile,
    ignoreDifficult: true,
    ignoreFigureCost: true,
  };
  return computeMovementCache(startCoord, spaceCount, board, profile);
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
  const cached = moveState.movementCache;
  if (!cached || (moveState.cacheMaxMp || 0) < mpLimit || !(cached.cells instanceof Map)) {
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
      pushFigure(game, playerNum, figureKey, topLeft);
      return true;
    }
    // CRR-PSH-006: a pushed LARGE figure cannot step diagonally — only
    // cardinal. Small figures can step in any of the 8 directions during
    // push (matching standard movement rules).
    const moveVectors = profile.isLarge
      ? [
          { dx: 1, dy: 0 },  { dx: -1, dy: 0 },
          { dx: 0, dy: 1 },  { dx: 0, dy: -1 },
        ]
      : [
          { dx: 1, dy: 0 },  { dx: -1, dy: 0 },
          { dx: 0, dy: 1 },  { dx: 0, dy: -1 },
          { dx: 1, dy: 1 },  { dx: -1, dy: 1 },
          { dx: 1, dy: -1 }, { dx: -1, dy: -1 },
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

// ── Iterative massive displacement engine ────────────────────────────────────
// Shared by Discord interactive flow and headless non-interactive flow.
// Rules source: RULES_REFERENCE.md lines 1906-1909
//   - figures pushed least spaces (controller's choice if tied)
//   - friendly figures first, then other players push their figures
//   - valid destinations recalculated after each individual displacement

/**
 * Initialize iterative massive displacement state. Pure — no side effects.
 * @returns {object|null} pending state, or null if no overlaps
 */
export function initMassiveDisplacement(game, movingPlayerNum, movingFigureKey, footprintSet) {
  const overlaps = collectOverlappingFigures(game, movingPlayerNum, movingFigureKey, footprintSet);
  if (overlaps.length === 0) return null;
  const friendly = overlaps.filter(e => e.playerNum === movingPlayerNum);
  const enemy = overlaps.filter(e => e.playerNum !== movingPlayerNum);
  return {
    movingPlayerNum,
    movingFigureKey,
    footprint: [...footprintSet],
    friendlyQueue: friendly,
    enemyQueue: enemy,
    phase: friendly.length > 0 ? 'friendly' : 'enemy',
    currentIndex: 0,
    totalDisplaced: overlaps.length,
  };
}

/**
 * Resolve displacements iteratively. Auto-resolves 0/1-space cases (mutates
 * game.figurePositions), stops when a figure has 2+ valid spaces (needs choice).
 *
 * When multiple unresolved entries remain in the active phase and the current
 * entry requires a space choice, first returns needsFigurePick so the controller
 * can choose displacement ORDER. Once applyFigurePick locks in the ordering for
 * the current index, a subsequent call returns needsChoice for that figure.
 *
 * Each call recalculates valid spaces with CURRENT board state before resolving.
 *
 * @returns {object}
 *   .autoResolved: [{entry, prevPos, newPos, bfs}] — figures auto-placed this call
 *   .needsFigurePick: null | {pickable:Entry[], controllerPlayerNum}
 *   .needsChoice: null | {entry, validSpaces, controllerPlayerNum}
 *   .done: boolean — true when all figures in both queues resolved
 */
export function resolveNextDisplacements(game, pending) {
  const forbiddenSet = new Set(pending.footprint);
  const autoResolved = [];

  while (true) {
    const queue = pending.phase === 'friendly' ? pending.friendlyQueue : pending.enemyQueue;
    if (pending.currentIndex >= queue.length) {
      // Advance from friendly → enemy phase, or finish
      if (pending.phase === 'friendly' && pending.enemyQueue.length > 0) {
        pending.phase = 'enemy';
        pending.currentIndex = 0;
        pending._figurePickLockedIdx = -1;
        continue;
      }
      return { autoResolved, needsFigurePick: null, needsChoice: null, done: true };
    }

    const entry = queue[pending.currentIndex];
    // Friendly phase: massive controller picks. Enemy phase: enemy player picks.
    // In 2-player Skirmish all entries in the enemy queue share the same
    // playerNum, so using the current entry's playerNum is safe.
    const controllerPlayerNum = pending.phase === 'friendly'
      ? pending.movingPlayerNum
      : entry.playerNum;

    // Order first: whenever 2+ figures remain in this phase, the controller
    // chooses which to place next — per alexanbv 2026-06-15, never auto-place
    // and always let the player pick order (recomputed after each placement, so
    // a boxed-in figure pushed first can change what's available for the rest).
    const unresolvedCount = queue.length - pending.currentIndex;
    const orderLocked = pending._figurePickLockedIdx === pending.currentIndex;
    if (unresolvedCount >= 2 && !orderLocked) {
      const pickable = queue.slice(pending.currentIndex);
      return {
        autoResolved,
        needsFigurePick: { pickable, controllerPlayerNum },
        needsChoice: null,
        done: false,
      };
    }

    // Nearest legal ring: all spaces within 1; if none, all within 2, etc.
    // (per alexanbv 2026-06-15). Recomputed against current board state.
    const options = getNearestDisplacementOptions(game, entry.figureKey, entry.playerNum, forbiddenSet);

    if (options.spaces.length === 0) {
      // No legal space reachable anywhere on the board — leave the figure in
      // place and advance. Effectively impossible in normal play; recorded as a
      // stuck auto-resolve so the engine still drains the queue.
      const prevPos = game.figurePositions?.[entry.playerNum]?.[entry.figureKey];
      autoResolved.push({ entry, prevPos, newPos: prevPos, bfs: true, stuck: true });
      pending.currentIndex++;
      pending._figurePickLockedIdx = -1;
      continue;
    }

    // Always prompt — even a single legal space is presented as a choice.
    return {
      autoResolved,
      needsFigurePick: null,
      needsChoice: { entry, validSpaces: options.spaces, distance: options.distance, controllerPlayerNum },
      done: false,
    };
  }
}

/**
 * Lock in the controller's chosen figure ORDER for the current index by
 * swapping the chosen entry into queue[currentIndex]. Does NOT advance the
 * index — a subsequent resolveNextDisplacements call returns needsChoice for
 * that figure so the controller can then pick its destination space.
 * @returns {boolean} true if pick applied, false if figureKey not pickable
 */
export function applyFigurePick(pending, figureKey) {
  const queue = pending.phase === 'friendly' ? pending.friendlyQueue : pending.enemyQueue;
  let targetIdx = -1;
  for (let i = pending.currentIndex; i < queue.length; i++) {
    if (queue[i].figureKey === figureKey) { targetIdx = i; break; }
  }
  if (targetIdx < 0) return false;
  if (targetIdx !== pending.currentIndex) {
    const tmp = queue[pending.currentIndex];
    queue[pending.currentIndex] = queue[targetIdx];
    queue[targetIdx] = tmp;
  }
  pending._figurePickLockedIdx = pending.currentIndex;
  return true;
}

/**
 * Apply a player's displacement choice for the current pending figure.
 * Call after resolveNextDisplacements returns needsChoice.
 */
export function applyDisplacementChoice(game, pending, chosenSpace) {
  const queue = pending.phase === 'friendly' ? pending.friendlyQueue : pending.enemyQueue;
  const entry = queue[pending.currentIndex];
  if (!entry) return null;
  const prevPos = game.figurePositions?.[entry.playerNum]?.[entry.figureKey];
  pushFigure(game, entry.playerNum, entry.figureKey, chosenSpace);
  pending.currentIndex++;
  pending._figurePickLockedIdx = -1;
  return { entry, prevPos, newPos: chosenSpace };
}

/**
 * Non-interactive massive displacement (headless / AI).
 * Uses the iterative engine — when 2+ spaces, picks the first deterministically.
 * Preserves the same iterative recalculation semantics as the interactive path.
 */
export async function resolveMassivePush(game, profile, figureKey, playerNum, newFootprint, client, logGameAction) {
  if (!profile.canEndOnOccupied) return;
  const footprintSet = new Set(newFootprint);
  const pending = initMassiveDisplacement(game, playerNum, figureKey, footprintSet);
  if (!pending) return;

  // Resolve all displacements iteratively
  while (true) {
    const result = resolveNextDisplacements(game, pending);
    // Log auto-resolved figures
    for (const r of result.autoResolved) {
      const from = r.prevPos ? String(r.prevPos).toUpperCase() : '?';
      const to = r.newPos ? String(r.newPos).toUpperCase() : '?';
      const suffix = r.bfs ? ' (no adjacent spaces)' : '';
      if (logGameAction) {
        await logGameAction(game, client, `**${r.entry.dcName}** displaced **${from}** → **${to}** by massive figure${suffix}.`, { icon: 'move', phase: 'ROUND' });
      }
    }
    if (result.done) break;
    // Non-interactive: when order matters, pick first pickable deterministically.
    if (result.needsFigurePick) {
      applyFigurePick(pending, result.needsFigurePick.pickable[0].figureKey);
      continue;
    }
    // Non-interactive: pick first valid space (deterministic)
    const choice = result.needsChoice;
    const applied = applyDisplacementChoice(game, pending, choice.validSpaces[0]);
    if (applied && logGameAction) {
      const from = applied.prevPos ? String(applied.prevPos).toUpperCase() : '?';
      const to = String(choice.validSpaces[0]).toUpperCase();
      await logGameAction(game, client, `**${choice.entry.dcName}** displaced **${from}** → **${to}** by massive figure.`, { icon: 'move', phase: 'ROUND' });
    }
  }

  // G66-G68: lock voluntary movement for rest of phase
  game.massiveMovementLocked = game.massiveMovementLocked || {};
  game.massiveMovementLocked[figureKey] = true;
  if (logGameAction) {
    await logGameAction(game, client, `Massive figure pushed ${pending.totalDisplaced} figure(s) aside. Movement locked for this phase.`, { icon: 'move', phase: 'ROUND' });
  }
}

/**
 * Get valid adjacent spaces where a displaced figure can be placed.
 * Returns only empty, non-blocked spaces adjacent to the figure's current position.
 * @param {object} game
 * @param {string} figureKey
 * @param {number} playerNum
 * @param {Set<string>} forbiddenSet - massive figure's footprint cells
 * @returns {string[]} array of valid coord strings
 */
export function getValidDisplacementSpaces(game, figureKey, playerNum, forbiddenSet) {
  const coord = game.figurePositions?.[playerNum]?.[figureKey];
  if (!coord) return [];
  const mapId = game.selectedMap?.id;
  if (!mapId) return [];
  const mapData = getMapData(mapId);
  if (!mapData?.adjacency) return [];
  const adjacent = mapData.adjacency[normalizeCoord(coord)] || [];
  // Companions can end on spaces occupied by FRIENDLY figures, mirroring their
  // normal movement rules — so when displacing a companion, those spaces must
  // remain candidates instead of being filtered as occupied.
  const displacedDcName = dcNameFromFigureKey(figureKey);
  const isCompanionBeingDisplaced = isDcCompanion(displacedDcName);
  const displacedSize = game.figureOrientations?.[figureKey] || getFigureSize(displacedDcName);
  const occupiedSet = new Set();
  for (const p of [1, 2]) {
    for (const [k, c] of Object.entries(game.figurePositions?.[p] || {})) {
      if (!c) continue;
      if (p === playerNum && k === figureKey) continue;
      if (isCompanionBeingDisplaced && p === playerNum) continue;
      const dcName = dcNameFromFigureKey(k);
      const size = game.figureOrientations?.[k] || getFigureSize(dcName);
      for (const cell of getNormalizedFootprint(c, size)) {
        occupiedSet.add(cell);
      }
    }
  }
  // Validate the displaced figure's FULL footprint at each candidate topLeft —
  // not just the topLeft cell. For 1x1 figures this is identical to the old
  // single-cell check; for 1x2 / 2x1 / 2x2+ it stops the chooser from
  // offering candidates whose second-or-later footprint cell is blocked,
  // occupied, off-map, or part of the moving massive's footprint.
  return adjacent.filter((s) => {
    const newFootprint = getNormalizedFootprint(normalizeCoord(s), displacedSize);
    return newFootprint.every((cell) =>
      !!mapData.adjacency[cell]
      && !occupiedSet.has(cell)
      && !forbiddenSet.has(cell)
    );
  });
}

/**
 * Nearest legal RING of displacement destinations for a figure shoved aside by
 * a MASSIVE figure. Returns ALL legal placements at the smallest push distance
 * — within 1 if any exist, else within 2, else within 3, ... — so the
 * controller chooses among them (the engine never auto-places). Per alexanbv
 * 2026-06-15: "if 0 spaces adjacent it is legal to push 2 spaces; among all
 * spaces that far away the player chooses." Distance respects movement-blocking
 * edges; the outward search may pass THROUGH occupied spaces to count further
 * rings (a figure can be pushed past another to the nearest empty space beyond).
 *
 * @returns {{distance:number, spaces:string[]}} {0, []} when no legal space is
 *   reachable anywhere on the board.
 */
export function getNearestDisplacementOptions(game, figureKey, playerNum, forbiddenSet) {
  // Ring 1 reuses the adjacency-based check (preserves prior distance-1 behavior).
  const adjacent = getValidDisplacementSpaces(game, figureKey, playerNum, forbiddenSet);
  if (adjacent.length > 0) {
    return { distance: 1, spaces: [...new Set(adjacent.map((s) => String(s).toLowerCase()))] };
  }
  // No adjacent space — BFS outward for the next non-empty ring (distance >= 2).
  const coord = game.figurePositions?.[playerNum]?.[figureKey];
  if (!coord) return { distance: 0, spaces: [] };
  const dcName = dcNameFromFigureKey(figureKey);
  const board = getBoardStateForMovement(game, figureKey);
  if (!board) return { distance: 0, spaces: [] };
  const profile = getMovementProfile(dcName, figureKey, game);
  // Companions may end on friendly-occupied spaces (mirrors normal movement).
  const isCompanion = isDcCompanion(dcName);
  const occupiedSet = new Set();
  for (const p of [1, 2]) {
    if (isCompanion && p === playerNum) continue;
    for (const [k, c] of Object.entries(game.figurePositions?.[p] || {})) {
      if (!c || (p === playerNum && k === figureKey)) continue;
      const kSize = game.figureOrientations?.[k] || getFigureSize(dcNameFromFigureKey(k));
      for (const cell of getNormalizedFootprint(c, kSize)) occupiedSet.add(cell);
    }
  }
  const isValidPlacement = (topLeft) => getNormalizedFootprint(topLeft, profile.size).every((cell) =>
    board.spacesSet.has(cell)
    && !forbiddenSet.has(cell)
    && !occupiedSet.has(cell)
    && (profile.ignoreBlocking || !board.blockingSet.has(cell)));
  const moveVectors = profile.isLarge
    ? [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }]
    : [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
       { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: -1 }];
  const startTopLeft = normalizeCoord(coord);
  let frontier = [startTopLeft];
  const visited = new Set([movementStateKey(startTopLeft, profile.size)]);
  let distance = 0;
  const MAX_RING = 30; // safety cap (boards are far smaller)
  while (frontier.length > 0 && distance < MAX_RING) {
    const next = [];
    for (const topLeft of frontier) {
      for (const vec of moveVectors) {
        const nb = shiftCoord(topLeft, vec.dx, vec.dy);
        if (!board.spacesSet.has(nb)) continue;
        if (board.movementBlockingSet && board.movementBlockingSet.has(edgeKey(topLeft, nb))) continue;
        const sk = movementStateKey(nb, profile.size);
        if (visited.has(sk)) continue;
        visited.add(sk);
        next.push(nb);
      }
    }
    distance++;
    const valid = next.filter(isValidPlacement);
    if (valid.length > 0) {
      return { distance, spaces: [...new Set(valid.map((s) => String(s).toLowerCase()))] };
    }
    frontier = next;
  }
  return { distance: 0, spaces: [] };
}

/**
 * Get valid push destinations adjacent to `fromCoord` for a single figure.
 *
 * Used by surge-push effects (Concussive Bolt, Slam, Smash, Ram, Durasteel
 * Fist, etc.). Different from `getValidDisplacementSpaces` (which assumes
 * the figure is being shoved aside by a Massive overlap and runs in the
 * iterative-displacement engine context) — this is a one-shot "where can
 * the attacker push this 1-space" check.
 *
 * Filters adjacent spaces to those where the pushed figure's FULL footprint:
 *   - Lies entirely on map (every cell is in `mapData.adjacency`).
 *   - Doesn't overlap any other figure (multi-cell-aware).
 *   - Doesn't enter blocking terrain (unless figure has Mobile or Massive).
 *   - Doesn't cross a movement-blocking edge (closed doors, cliffs).
 *
 * Also enforces Spiked Boots (Snowtrooper Elite): if the target has the
 * `spiked_boots_snowtrooper` ability AND the pusher isn't MASSIVE, the
 * push fails outright (returns []). Per CRR: "cannot be pushed except
 * by MASSIVE figures."
 *
 * @param {object} game
 * @param {string} pushedFigureKey
 * @param {number} pushedPlayerNum
 * @param {object} [opts]
 * @param {boolean} [opts.pusherIsMassive=false] - true if the pushing
 *   figure has the MASSIVE keyword. Used for Spiked Boots gate.
 * @returns {string[]} list of legal destination top-left coords (lowercased).
 *   Empty when no legal destination exists OR Spiked Boots blocks the push.
 */
export function getValidPushDestinations(game, pushedFigureKey, pushedPlayerNum, opts = {}) {
  const fromCoord = game.figurePositions?.[pushedPlayerNum]?.[pushedFigureKey];
  if (!fromCoord) return [];
  const mapId = game.selectedMap?.id;
  if (!mapId) return [];
  const mapData = getMapData(mapId);
  if (!mapData?.adjacency) return [];
  const fromLc = normalizeCoord(fromCoord);
  const adjacent = (mapData.adjacency[fromLc] || []).map(normalizeCoord);

  const dcName = dcNameFromFigureKey(pushedFigureKey);
  const size = game.figureOrientations?.[pushedFigureKey] || getFigureSize(dcName) || '1x1';

  // Spiked Boots gate: target with `spiked_boots_snowtrooper` cannot be
  // pushed except by MASSIVE figures.
  const targetEffects = getDcEffects()?.[dcName];
  const targetSpecials = targetEffects?.specialAbilityIds || [];
  if (targetSpecials.includes('spiked_boots_snowtrooper') && !opts.pusherIsMassive) {
    return [];
  }
  // Take Position (CC): the figure is push-immune until end of round except
  // when the pusher is MASSIVE. Round-scoped flag set in abilities.js when
  // the card resolves; reset by ROUND_OBJECT_FLAGS at start-of-round.
  if (game.roundPushImmuneUnlessMassive?.[pushedFigureKey] && !opts.pusherIsMassive) {
    return [];
  }

  // Figure ignores blocking if it has MOBILE or MASSIVE keyword.
  const keywords = (getDcKeywords(game)?.[dcName] || []).map((k) => String(k).toUpperCase());
  const ignoreBlocking = keywords.includes('MOBILE') || keywords.includes('MASSIVE');

  const blockingSet = new Set((ignoreBlocking ? [] : (mapData.blocking || [])).map((c) => String(c).toLowerCase()));

  // Build occupied set excluding the pushed figure's own footprint.
  const occupiedSet = new Set();
  for (const pn of [1, 2]) {
    const poses = game.figurePositions?.[pn] || {};
    for (const [fk, c] of Object.entries(poses)) {
      if (!c) continue;
      if (pn === pushedPlayerNum && fk === pushedFigureKey) continue;
      const fkDc = dcNameFromFigureKey(fk);
      const fkSize = game.figureOrientations?.[fk] || getFigureSize(fkDc) || '1x1';
      for (const cell of getNormalizedFootprint(c, fkSize)) occupiedSet.add(cell);
    }
  }

  // Movement-blocking edges (closed doors, cliffs). Open-door overrides apply.
  const movementBlockingEdges = mapData.movementBlockingEdges || [];
  const openedDoors = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  const blockedEdgeSet = new Set();
  for (const e of movementBlockingEdges) {
    const a = String(e[0]).toLowerCase();
    const b = String(e[1]).toLowerCase();
    const k1 = `${a}|${b}`;
    const k2 = `${b}|${a}`;
    if (openedDoors.has(k1) || openedDoors.has(k2)) continue;
    blockedEdgeSet.add(k1);
    blockedEdgeSet.add(k2);
  }

  // CRR-PSH-006: large figures cannot diagonal-step during push. Filter
  // out diagonal neighbors when the pushed figure is large.
  const sizeParts = String(size).toLowerCase().split('x').map(Number);
  const isLarge = (sizeParts[0] || 1) > 1 || (sizeParts[1] || 1) > 1;
  const fromParsed = parseCoord(fromLc);

  return adjacent.filter((s) => {
    // Edge between fromLc and s must not be movement-blocked.
    if (blockedEdgeSet.has(`${fromLc}|${s}`)) return false;
    // Large figures can't step diagonally during push (CRR-PSH-006).
    if (isLarge) {
      const sParsed = parseCoord(s);
      const dCol = Math.abs(sParsed.col - fromParsed.col);
      const dRow = Math.abs(sParsed.row - fromParsed.row);
      if (dCol > 0 && dRow > 0) return false;
    }
    // Full-footprint legality check.
    const newFootprint = getNormalizedFootprint(s, size);
    return newFootprint.every((cell) =>
      !!mapData.adjacency[cell]
      && !occupiedSet.has(cell)
      && !blockingSet.has(cell)
    );
  });
}
