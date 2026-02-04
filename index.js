import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  AttachmentBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { parseVsav, parseIacpListPaste } from './src/vsav-parser.js';
import { isDbConfigured, initDb, loadGamesFromDb, saveGamesToDb } from './src/db.js';
import { rotateImage90 } from './src/dc-image-utils.js';
import { renderMap } from './src/map-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname);

// DC message metadata (messageId -> { gameId, playerNum, dcName, displayName })
const dcMessageMeta = new Map();
const dcExhaustedState = new Map(); // messageId -> boolean

let dcImages = {};
let figureImages = {};
let dcStats = {};
try {
  const dcData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-images.json'), 'utf8'));
  dcImages = dcData.dcImages || {};
} catch {}
try {
  const figData = JSON.parse(readFileSync(join(rootDir, 'data', 'figure-images.json'), 'utf8'));
  figureImages = figData.figureImages || {};
} catch {}
let figureSizes = {};
try {
  const szData = JSON.parse(readFileSync(join(rootDir, 'data', 'figure-sizes.json'), 'utf8'));
  figureSizes = szData.figureSizes || {};
} catch {}
try {
  const statsData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-stats.json'), 'utf8'));
  dcStats = statsData.dcStats || {};
} catch {}
let mapRegistry = [];
try {
  const mapData = JSON.parse(readFileSync(join(rootDir, 'data', 'map-registry.json'), 'utf8'));
  mapRegistry = mapData.maps || [];
} catch {}
let deploymentZones = {};
try {
  const dzData = JSON.parse(readFileSync(join(rootDir, 'data', 'deployment-zones.json'), 'utf8'));
  deploymentZones = dzData.maps || {};
} catch {}
let mapSpacesData = {};
try {
  const msData = JSON.parse(readFileSync(join(rootDir, 'data', 'map-spaces.json'), 'utf8'));
  mapSpacesData = msData.maps || {};
} catch {}
let dcKeywords = {};
try {
  const kwData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-keywords.json'), 'utf8'));
  dcKeywords = kwData.keywords || {};
} catch {}
let diceData = { attack: {}, defense: {} };
try {
  const dData = JSON.parse(readFileSync(join(rootDir, 'data', 'dice.json'), 'utf8'));
  diceData = dData;
} catch {}
let missionCardsData = {};
try {
  const mcData = JSON.parse(readFileSync(join(rootDir, 'data', 'mission-cards.json'), 'utf8'));
  missionCardsData = mcData.maps || {};
} catch {}
let mapTokensData = {};
try {
  const mtData = JSON.parse(readFileSync(join(rootDir, 'data', 'map-tokens.json'), 'utf8'));
  mapTokensData = mtData.maps || {};
} catch {}
let ccEffectsData = { cards: {} };
try {
  const ccData = JSON.parse(readFileSync(join(rootDir, 'data', 'cc-effects.json'), 'utf8'));
  if (ccData?.cards) ccEffectsData = ccData;
} catch {}

/** Reload game data from JSON files (dc-stats, dc-images, etc.). Call before Refresh All to pick up new entries. */
function reloadGameData() {
  try {
    const dcData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-images.json'), 'utf8'));
    dcImages = dcData.dcImages || {};
  } catch {}
  try {
    const figData = JSON.parse(readFileSync(join(rootDir, 'data', 'figure-images.json'), 'utf8'));
    figureImages = figData.figureImages || {};
  } catch {}
  try {
    const szData = JSON.parse(readFileSync(join(rootDir, 'data', 'figure-sizes.json'), 'utf8'));
    figureSizes = szData.figureSizes || {};
  } catch {}
  try {
    const statsData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-stats.json'), 'utf8'));
    dcStats = statsData.dcStats || {};
  } catch {}
  try {
    const ccData = JSON.parse(readFileSync(join(rootDir, 'data', 'cc-effects.json'), 'utf8'));
    if (ccData?.cards) ccEffectsData = ccData;
  } catch {}
}

function getCcEffect(cardName) {
  return ccEffectsData.cards?.[cardName] || null;
}

function getMapSpaces(mapId) {
  return mapSpacesData[mapId] || null;
}

/** Return true if coord is within optional gridBounds (maxCol/maxRow are 0-based inclusive). */
function isWithinGridBounds(coord, gridBounds) {
  if (!gridBounds || (gridBounds.maxCol == null && gridBounds.maxRow == null)) return true;
  const { col, row } = parseCoord(coord);
  if (col < 0 || row < 0) return false;
  if (gridBounds.maxCol != null && col > gridBounds.maxCol) return false;
  if (gridBounds.maxRow != null && row > gridBounds.maxRow) return false;
  return true;
}

/** Filter map data (spaces, adjacency, etc.) to only include coords within gridBounds. */
function filterMapSpacesByBounds(rawMapSpaces, gridBounds) {
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

/** Get set of normalized coords occupied by a player's figures. */
function getPlayerOccupiedCells(game, playerNum) {
  const cells = new Set();
  const poses = game.figurePositions?.[playerNum] || {};
  for (const [k, coord] of Object.entries(poses)) {
    const dcName = k.replace(/-\d+-\d+$/, '');
    const size = game.figureOrientations?.[k] || getFigureSize(dcName);
    for (const c of getFootprintCells(coord, size)) {
      cells.add(normalizeCoord(c));
    }
  }
  return cells;
}

/** Mission B: True if figure is adjacent to or on a contraband space. */
function isFigureAdjacentOrOnContraband(game, playerNum, figureKey, mapId) {
  if (game?.selectedMission?.variant !== 'b') return false;
  const mapData = mapTokensData[mapId];
  const contraband = mapData?.missionB?.contraband || mapData?.missionB?.crates || [];
  if (!contraband.length) return false;
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return false;
  const mapDef = mapRegistry.find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const contrabandSet = toLowerSet(contraband);
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return false;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const footprint = getFootprintCells(pos, game.figureOrientations?.[figureKey] || getFigureSize(dcName));
  for (const c of footprint) {
    const n = normalizeCoord(c);
    if (contrabandSet.has(n)) return true;
    for (const adj of adjacency[n] || []) {
      if (contrabandSet.has(normalizeCoord(adj))) return true;
    }
  }
  return false;
}

/** Mission B: Effective speed (base - 2 when carrying contraband). */
function getEffectiveSpeed(dcName, figureKey, game) {
  const base = getDcStats(dcName).speed ?? 4;
  if (game?.selectedMission?.variant !== 'b') return base;
  if (game.figureContraband?.[figureKey]) return Math.max(0, base - 2);
  return base;
}

/** Mission B: True if figure is in player's deployment zone. */
function isFigureInDeploymentZone(game, playerNum, figureKey, mapId) {
  const zoneData = deploymentZones[mapId];
  if (!zoneData) return false;
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const zone = playerNum === initPlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const zoneSpaces = toLowerSet(zoneData[zone] || []);
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return false;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const footprint = getFootprintCells(pos, game.figureOrientations?.[figureKey] || getFigureSize(dcName));
  return footprint.some((c) => zoneSpaces.has(normalizeCoord(c)));
}

/** True if figure footprint or any adjacent cell is in the given coord set. */
function isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, coordSet) {
  return getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, coordSet).length > 0;
}

/** Returns coords from coordSet that the figure is on or adjacent to. */
function getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, coordSet) {
  if (!coordSet?.size) return [];
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return [];
  const mapDef = mapRegistry.find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return [];
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const footprint = getFootprintCells(pos, game.figureOrientations?.[figureKey] || getFigureSize(dcName));
  const result = new Set();
  for (const c of footprint) {
    const n = normalizeCoord(c);
    if (coordSet.has(n)) result.add(n);
    for (const adj of adjacency[n] || []) {
      const na = normalizeCoord(adj);
      if (coordSet.has(na)) result.add(na);
    }
  }
  return [...result];
}

/** Returns legal interact options for a figure. Mission-specific first (blue), standard (grey). */
function getLegalInteractOptions(game, playerNum, figureKey, mapId) {
  const options = [];
  const mapData = mapTokensData[mapId];
  if (!mapData) return options;

  const variant = game?.selectedMission?.variant;

  if (variant === 'b') {
    if (!game.figureContraband?.[figureKey] && isFigureAdjacentOrOnContraband(game, playerNum, figureKey, mapId)) {
      options.push({ id: 'retrieve_contraband', label: 'Retrieve Contraband', missionSpecific: true });
    }
  }

  if (variant === 'a') {
    const launchPanels = mapData.missionA?.launchPanels || [];
    const flippedThisRound = playerNum === 1 ? game.p1LaunchPanelFlippedThisRound : game.p2LaunchPanelFlippedThisRound;
    if (launchPanels.length && !flippedThisRound) {
      const panelSet = toLowerSet(launchPanels);
      const adjacent = getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, panelSet);
      for (const coord of adjacent) {
        const upper = String(coord).toUpperCase();
        options.push({ id: `launch_panel_${coord}_colored`, label: `Launch Panel (${upper}) → Colored`, missionSpecific: true });
        options.push({ id: `launch_panel_${coord}_gray`, label: `Launch Panel (${upper}) → Gray`, missionSpecific: true });
      }
    }
  }

  const terminals = mapData.terminals || [];
  if (terminals.length && isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, toLowerSet(terminals))) {
    options.push({ id: 'use_terminal', label: 'Use Terminal', missionSpecific: false });
  }

  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  for (const edge of mapData.doors || []) {
    if (edge?.length < 2) continue;
    const ek = edgeKey(edge[0], edge[1]);
    if (openedSet.has(ek)) continue;
    const coordSet = toLowerSet(edge);
    if (isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, coordSet)) {
      const label = `Open Door (${String(edge[0]).toUpperCase()}–${String(edge[1]).toUpperCase()})`;
      options.push({ id: `open_door_${ek}`, label, missionSpecific: false });
    }
  }

  return options;
}

/** Returns 1, 2, or null for who controls this space (only they have figure on/adjacent). Same logic as terminals. */
function getSpaceController(game, mapId, coord) {
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return null;
  const mapDef = mapRegistry.find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const t = normalizeCoord(coord);
  const controlSet = new Set([t, ...(adjacency[t] || []).map((n) => normalizeCoord(n))]);
  const p1Cells = getPlayerOccupiedCells(game, 1);
  const p2Cells = getPlayerOccupiedCells(game, 2);
  const p1Has = [...controlSet].some((c) => p1Cells.has(c));
  const p2Has = [...controlSet].some((c) => p2Cells.has(c));
  if (p1Has && !p2Has) return 1;
  if (p2Has && !p1Has) return 2;
  return null;
}

/** Count terminals exclusively controlled by player (on or adjacent; only they have presence). */
function countTerminalsControlledByPlayer(game, playerNum, mapId) {
  const mapData = mapTokensData[mapId];
  if (!mapData?.terminals?.length) return 0;
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return 0;
  const mapDef = mapRegistry.find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};

  const p1Cells = getPlayerOccupiedCells(game, 1);
  const p2Cells = getPlayerOccupiedCells(game, 2);

  let count = 0;
  for (const term of mapData.terminals) {
    const t = normalizeCoord(term);
    const controlSet = new Set([t, ...(adjacency[t] || []).map((n) => normalizeCoord(n))]);
    const p1Has = [...controlSet].some((c) => p1Cells.has(c));
    const p2Has = [...controlSet].some((c) => p2Cells.has(c));
    if (playerNum === 1 && p1Has && !p2Has) count++;
    if (playerNum === 2 && p2Has && !p1Has) count++;
  }
  return count;
}

/** Get all occupied spaces (any figure's footprint) for movement validation. */
function getOccupiedSpacesForMovement(game, excludeFigureKey = null) {
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

/** Get spaces occupied by hostile figures only (opponent's figures). Per rules: +1 MP to enter hostile; no extra cost for friendly. */
function getHostileOccupiedSpacesForMovement(game, excludeFigureKey = null) {
  const poses = game.figurePositions || { 1: {}, 2: {} };
  let moverPlayer = null;
  for (const p of [1, 2]) {
    if (excludeFigureKey in (poses[p] || {})) {
      moverPlayer = p;
      break;
    }
  }
  if (moverPlayer == null) return [];
  const hostilePlayer = moverPlayer === 1 ? 2 : 1;
  const occupied = [];
  for (const [k, coord] of Object.entries(poses[hostilePlayer] || {})) {
    const dcName = k.replace(/-\d+-\d+$/, '');
    const size = game.figureOrientations?.[k] || getFigureSize(dcName);
    occupied.push(...getFootprintCells(coord, size));
  }
  return occupied;
}

/** Manhattan distance in spaces between two coords. */
function getRange(coord1, coord2) {
  const a = parseCoord(coord1);
  const b = parseCoord(coord2);
  if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) return 999;
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function edgeKey(a, b) {
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|');
}

function normalizeCoord(coord) {
  return String(coord || '').toLowerCase();
}

function toLowerSet(arr = []) {
  return new Set(arr.map((s) => normalizeCoord(s)));
}

function parseSizeString(size) {
  const [colsRaw, rowsRaw] = String(size || '1x1')
    .toLowerCase()
    .split('x')
    .map((n) => parseInt(n, 10) || 1);
  return { cols: colsRaw || 1, rows: rowsRaw || 1 };
}

function sizeToString(cols, rows) {
  return `${Math.max(1, cols)}x${Math.max(1, rows)}`;
}

function rotateSizeString(size) {
  const { cols, rows } = parseSizeString(size);
  if (cols === rows) return sizeToString(cols, rows);
  return sizeToString(rows, cols);
}

function shiftCoord(coord, dx, dy) {
  const { col, row } = parseCoord(coord);
  return normalizeCoord(colRowToCoord(col + dx, row + dy));
}

function getMovementKeywords(dcName) {
  const raw = dcKeywords?.[dcName] || [];
  return new Set(raw.map((k) => String(k).toLowerCase()));
}

function getBoardStateForMovement(game, excludeFigureKey = null) {
  if (!game?.selectedMap?.id) return null;
  const rawMapSpaces = getMapSpaces(game.selectedMap.id);
  if (!rawMapSpaces) return null;
  const mapDef = mapRegistry.find((m) => m.id === game.selectedMap.id);
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
  const mapData = mapTokensData[game.selectedMap.id];
  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  for (const edge of mapData?.doors || []) {
    if (edge?.length >= 2) {
      const ek = edgeKey(edge[0], edge[1]);
      if (!openedSet.has(ek)) movementBlockingSet.add(ek);
    }
  }
  return { mapSpaces, adjacency, terrain, blockingSet, occupiedSet, hostileOccupiedSet, movementBlockingSet, spacesSet };
}

function getMovementProfile(dcName, figureKey, game) {
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

/** Line-of-sight: true if no blocking terrain or solid walls on line. Dotted red (movementBlockingEdges) do NOT block LOS. */
function hasLineOfSight(coord1, coord2, mapSpaces) {
  const blocking = new Set((mapSpaces?.blocking || []).map((s) => String(s).toLowerCase()));
  const impSet = new Set((mapSpaces?.impassableEdges || []).map((e) => edgeKey(e[0], e[1])));
  const a = parseCoord(coord1);
  const b = parseCoord(coord2);
  if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) return false;
  const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row), 1);
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const col = Math.round(a.col + t * (b.col - a.col));
    const row = Math.round(a.row + t * (b.row - a.row));
    const c = colRowToCoord(col, row);
    if (blocking.has(c)) return false;
    if (prev && prev !== c) {
      const p = parseCoord(prev);
      const dc = Math.abs(col - p.col), dr = Math.abs(row - p.row);
      if (dc === 1 && dr === 0 && impSet.has(edgeKey(prev, c))) return false;
      if (dc === 0 && dr === 1 && impSet.has(edgeKey(prev, c))) return false;
      if (dc === 1 && dr === 1) {
        const mid1 = colRowToCoord(p.col, row);
        const mid2 = colRowToCoord(col, p.row);
        if (impSet.has(edgeKey(prev, mid1)) || impSet.has(edgeKey(prev, mid2))) return false;
      }
    }
    prev = c;
  }
  return true;
}

/** BFS: reachable spaces from startCoord within mp movement points. 1 MP per adjacent step. Cannot end on occupied. */
function buildTempBoardState(mapSpaces, occupiedSet, hostileOccupiedSet = null) {
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

function movementStateKey(coord, size) {
  return `${normalizeCoord(coord)}|${size}`;
}

function getNormalizedFootprint(topLeft, size) {
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

function computeMovementCache(startCoord, mpLimit, board, profile) {
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

function getSpacesAtCost(cache, mpCost) {
  const matches = [];
  for (const [cell, info] of cache.cells.entries()) {
    if (info.cost === mpCost) matches.push(cell);
  }
  return matches;
}

function getMovementTarget(cache, coord) {
  return cache.cells.get(normalizeCoord(coord)) || null;
}

/** Returns path of coords from start to dest (including both), or empty array if unreachable. */
function getMovementPath(cache, startCoord, destTopLeft, destSize, profile) {
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

function ensureMovementCache(moveState, startCoord, mpLimit, board, profile) {
  if (!moveState.movementCache || (moveState.cacheMaxMp || 0) < mpLimit) {
    moveState.movementCache = computeMovementCache(startCoord, mpLimit, board, profile);
    moveState.cacheMaxMp = mpLimit;
  }
  return moveState.movementCache;
}

async function clearMoveGridMessages(game, moveKey, channel) {
  if (!channel) return;
  const ids = game.moveGridMessageIds?.[moveKey] || [];
  for (const id of ids) {
    try {
      const msg = await channel.messages.fetch(id);
      await msg.delete();
    } catch {
      // ignore missing messages
    }
  }
  if (game.moveGridMessageIds) delete game.moveGridMessageIds[moveKey];
}

async function editDistanceMessage(moveState, channel, content, components) {
  if (!moveState?.distanceMessageId || !channel) return;
  try {
    const msg = await channel.messages.fetch(moveState.distanceMessageId);
    await msg.edit({ content, components });
  } catch {
    // ignore
  }
}

function collectOverlappingFigures(game, movingPlayerNum, movingFigureKey, footprint) {
  const overlapsFriendly = [];
  const overlapsEnemy = [];
  for (const p of [1, 2]) {
    const poses = game.figurePositions?.[p] || {};
    for (const [key, coord] of Object.entries(poses)) {
      if (key === movingFigureKey) continue;
      const dcName = key.replace(/-\d+-\d+$/, '');
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

function pushFigureToNearestValid(game, playerNum, figureKey, forbiddenSet) {
  const coord = game.figurePositions?.[playerNum]?.[figureKey];
  if (!coord) return false;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
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
      const stateKey = movementStateKey(nextTopLeft, profile.size);
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      queue.push(nextTopLeft);
    }
  }
  return false;
}

async function resolveMassivePush(game, profile, figureKey, playerNum, newFootprint, client) {
  if (!profile.canEndOnOccupied) return;
  const footprintSet = new Set(newFootprint);
  const overlaps = collectOverlappingFigures(game, playerNum, figureKey, footprintSet);
  for (const entry of overlaps) {
    const success = pushFigureToNearestValid(game, entry.playerNum, entry.figureKey, footprintSet);
    if (!success) {
      console.warn(`Failed to push ${entry.figureKey} away from massive figure ${figureKey}`);
    }
  }
  if (overlaps.length > 0) {
    await logGameAction(game, client, `Massive figure pushed ${overlaps.length} figure(s) aside.`, { icon: 'move', phase: 'ROUND' });
  }
}
function getReachableSpaces(startCoord, mp, mapSpaces, occupiedSet) {
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

function getPathCost(startCoord, destCoord, mapSpaces, occupiedSet) {
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

/** Build 5x5 grid for movement tests. */
function buildTestGrid5x5(overrides = {}) {
  const { blocked = [], difficult = [], movementBlockingEdges = [] } = overrides;
  const spaces = [];
  const adjacency = {};
  const terrain = {};
  const blocking = [...blocked];
  const coord = (col, row) => String.fromCharCode(97 + col) + (row + 1);

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const k = coord(col, row);
      if (blocking.includes(k)) continue;
      spaces.push(k);
      terrain[k] = difficult.includes(k) ? 'difficult' : 'normal';
      const neighbors = [];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nc = col + dc, nr = row + dr;
        if (nc >= 0 && nc < 5 && nr >= 0 && nr < 5) {
          const nk = coord(nc, nr);
          if (!blocking.includes(nk)) {
            const ek = [k, nk].sort().join('|');
            const isBlocked = (movementBlockingEdges || []).some(([a, b]) =>
              [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|') === ek
            );
            if (!isBlocked) neighbors.push(nk);
          }
        }
      }
      adjacency[k] = neighbors;
    }
  }
  return { spaces, adjacency, terrain, blocking, movementBlockingEdges: movementBlockingEdges || [] };
}

/** Run movement tests. Returns 0 if pass, 1 if fail. */
async function runMovementTests() {
  const profile = {
    size: '1x1', cols: 1, rows: 1, isLarge: false, allowDiagonal: true, canRotate: false,
    isMassive: false, isMobile: false, ignoreDifficult: false, ignoreBlocking: false,
    ignoreFigureCost: false, canEndOnOccupied: false,
  };
  let passed = 0, failed = 0;

  const assert = (name, ok, detail = '') => {
    if (ok) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); failed++; }
  };

  console.log('\n=== Movement Tests ===\n');

  // Case 1: Empty board, basic reachability
  {
    const grid = buildTestGrid5x5();
    const board = buildTempBoardState(grid, []);
    const reachable = [...(computeMovementCache('a1', 4, board, profile).cells.keys())];
    assert('Empty 4 MP from a1 reaches multiple spaces', reachable.length >= 10);
  }

  // Case 2: Diagonal past enemy (corner cut) - 1 MP
  {
    const grid = buildTestGrid5x5();
    const board = buildTempBoardState(grid, ['b2']);
    const cache = computeMovementCache('a1', 4, board, profile);
    const costToC3 = cache.cells.get('c3')?.cost;
    const path = getMovementPath(cache, 'a1', 'c3', '1x1', profile);
    assert('Reach c3 within 4 MP (enemy at b2)', costToC3 !== undefined && costToC3 <= 4);
    assert('Path a1→c3 exists', path.length >= 2 && path[0] === 'a1' && path[path.length - 1] === 'c3');
  }

  // Case 3: Through enemy costs +1 MP; cannot end on occupied
  {
    const grid = buildTestGrid5x5({ blocked: ['a2', 'b2'] });
    const board = buildTempBoardState(grid, ['b1'], ['b1']);
    const cache = computeMovementCache('a1', 5, board, profile);
    const targetB1 = getMovementTarget(cache, 'b1');
    assert('Cannot end on b1 (occupied)', targetB1 == null);
    const costToC1 = cache.cells.get('c1')?.cost;
    assert('A1→B1→C1 through hostile: 2+1=3 MP (only path)', costToC1 === 3, `got ${costToC1}`);
  }

  // Case 3b: Through friendly costs no extra; cannot end on occupied
  {
    const grid = buildTestGrid5x5({ blocked: ['a2', 'b2'] });
    const board = buildTempBoardState(grid, ['b1'], []);
    const cache = computeMovementCache('a1', 5, board, profile);
    const targetB1 = getMovementTarget(cache, 'b1');
    assert('Cannot end on b1 (occupied by friendly)', targetB1 == null);
    const costToC1 = cache.cells.get('c1')?.cost;
    assert('A1→B1→C1 through friendly: 2 MP (no extra)', costToC1 === 2, `got ${costToC1}`);
  }

  // Case 3c: Through two hostiles = 5 MP (2+2+1)
  {
    const grid = buildTestGrid5x5({ blocked: ['a2', 'b2', 'c2', 'd2'] });
    const board = buildTempBoardState(grid, ['b1', 'c1'], ['b1', 'c1']);
    const cache = computeMovementCache('a1', 6, board, profile);
    const costToD1 = cache.cells.get('d1')?.cost;
    assert('A1→B1→C1→D1 through two hostiles: 2+2+1=5 MP', costToD1 === 5, `got ${costToD1}`);
  }

  // Case 3d: Difficult + hostile in same space = 3 MP (costs stack)
  {
    const grid = buildTestGrid5x5({ blocked: ['a2', 'b2'], difficult: ['b1'] });
    const board = buildTempBoardState(grid, ['b1'], ['b1']);
    const cache = computeMovementCache('a1', 5, board, profile);
    const costToC1 = cache.cells.get('c1')?.cost;
    assert('B1 difficult+hostile costs 3 MP (1+1+1)', costToC1 === 4, `got ${costToC1}`);
  }

  // Case 4: Difficult terrain
  {
    const grid = buildTestGrid5x5({ difficult: ['b1'] });
    const board = buildTempBoardState(grid, []);
    const cache = computeMovementCache('a1', 4, board, profile);
    const costB1 = cache.cells.get('b1')?.cost;
    assert('Difficult b1 costs 2 MP', costB1 === 2);
  }

  // Case 4b: Massive/Mobile ignore difficult terrain
  {
    const grid = buildTestGrid5x5({ difficult: ['b1'] });
    const board = buildTempBoardState(grid, []);
    const massiveProfile = { ...profile, ignoreDifficult: true };
    const cache = computeMovementCache('a1', 4, board, massiveProfile);
    const costB1 = cache.cells.get('b1')?.cost;
    assert('Massive/Mobile: difficult b1 costs 1 MP', costB1 === 1, `got ${costB1}`);
  }

  // Case 5: Blocking
  {
    const grid = buildTestGrid5x5({ blocked: ['b1'] });
    const board = buildTempBoardState(grid, []);
    const cache = computeMovementCache('a1', 4, board, profile);
    assert('Blocked b1 unreachable', cache.cells.get('b1') == null);
  }

  // Case 6: Movement-blocking edge
  {
    const grid = buildTestGrid5x5({ movementBlockingEdges: [['a1', 'b1']] });
    const board = buildTempBoardState(grid, []);
    const cache = computeMovementCache('a1', 4, board, profile);
    const directB1 = cache.cells.get('b1')?.cost === 1;
    assert('Movement-blocking a1-b1: cannot move directly', !directB1);
  }

  // Case 7: Path includes waypoints
  {
    const grid = buildTestGrid5x5();
    const board = buildTempBoardState(grid, []);
    const cache = computeMovementCache('a1', 4, board, profile);
    const path = getMovementPath(cache, 'a1', 'c3', '1x1', profile);
    assert('Path a1→c3 exists and starts with a1', path.length >= 2 && path[0] === 'a1');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  return failed > 0 ? 1 : 0;
}

/** Movement bank display text (green progress bar). */
function getMovementBankText(displayName, remaining, total) {
  const safeTotal = Math.max(0, total ?? 0);
  const safeRemaining = Math.max(0, Math.min(remaining ?? 0, safeTotal));
  const bar = '🟢'.repeat(safeRemaining) + '⚪'.repeat(Math.max(0, safeTotal - safeRemaining));
  const name = displayName ? ` — ${displayName}` : '';
  return `**Movement Bank${name}:** ${safeRemaining}/${safeTotal} MP remaining ${bar ? `\n${bar}` : ''}`;
}

async function updateMovementBankMessage(game, msgId, client) {
  const bank = game.movementBank?.[msgId];
  if (!bank) return;
  const { threadId, messageId, remaining, total, displayName } = bank;
  if (!threadId) return;
  try {
    if (remaining <= 0 && messageId) {
      const thread = await client.channels.fetch(threadId);
      const msg = await thread.messages.fetch(messageId).catch(() => null);
      if (msg) await msg.delete().catch(() => {});
      bank.messageId = null;
      return;
    }
    if (!messageId) return;
    const thread = await client.channels.fetch(threadId);
    const msg = await thread.messages.fetch(messageId);
    await msg.edit({ content: getMovementBankText(displayName, remaining, total) });
  } catch {}
}

async function ensureMovementBankMessage(game, msgId, client) {
  const bank = game.movementBank?.[msgId];
  if (!bank) return null;
  if (bank.messageId) return bank;
  if (!bank.threadId) return bank;
  try {
    const thread = await client.channels.fetch(bank.threadId);
    const msg = await thread.send({ content: getMovementBankText(bank.displayName, bank.remaining, bank.total) });
    bank.messageId = msg.id;
  } catch (err) {
    console.error('Failed to create movement bank message:', err);
  }
  return bank;
}

/** Fisher-Yates shuffle. Mutates array in place. */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Parse coord "a1" -> { col, row } (0-based). */
function parseCoord(coord) {
  const s = String(coord || '').toLowerCase();
  const letter = s.match(/[a-z]+/)?.[0] || '';
  const num = parseInt(s.match(/\d+/)?.[0] || '0', 10);
  const col = letter
    ? [...letter].reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 96), 0) - 1
    : -1;
  const row = num - 1;
  return { col, row };
}

/** Col/row (0-based) -> coord string "a1". */
function colRowToCoord(col, row) {
  if (col < 0 || row < 0) return '';
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode(65 + (c % 26)) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter.toLowerCase() + (row + 1);
}

/** Get all cells a unit occupies when its top-left is at topLeftCoord. size: "1x1"|"1x2"|"2x2"|"2x3". */
function getFootprintCells(topLeftCoord, size) {
  const { col, row } = parseCoord(topLeftCoord);
  if (col < 0 || row < 0) return [topLeftCoord];
  const [cols, rows] = (size || '1x1').split('x').map(Number) || [1, 1];
  const cells = [];
  for (let r = 0; r < (rows || 1); r++) {
    for (let c = 0; c < (cols || 1); c++) {
      cells.push(colRowToCoord(col + c, row + r));
    }
  }
  return cells;
}

/** Filter zone spaces to only those valid as top-left for a unit of given size (all footprint cells in zone and unoccupied). */
function filterValidTopLeftSpaces(zoneSpaces, occupiedSpaces, size) {
  const zoneSet = new Set((zoneSpaces || []).map((s) => String(s).toLowerCase()));
  const occupiedSet = new Set((occupiedSpaces || []).map((s) => String(s).toLowerCase()));
  const sizeNorm = (size || '1x1').toLowerCase();
  if (sizeNorm === '1x1') {
    return [...zoneSet].filter((s) => !occupiedSet.has(s));
  }
  return [...zoneSet].filter((topLeft) => {
    const cells = getFootprintCells(topLeft, sizeNorm);
    return cells.every((c) => zoneSet.has(c) && !occupiedSet.has(c));
  });
}

/** Maps with deployment zones configured are play-ready. */
function getPlayReadyMaps() {
  return mapRegistry.filter(
    (m) => deploymentZones[m.id]?.red?.length > 0 && deploymentZones[m.id]?.blue?.length > 0
  );
}

// DC health state: msgId -> [[current, max], ...] per figure
const dcHealthState = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const lobbies = new Map();
const games = new Map(); // gameId -> { ..., p1ActivationsMessageId, p2ActivationsMessageId, p1ActivationsRemaining, p2ActivationsRemaining, p1ActivationsTotal, p2ActivationsTotal }
let gameIdCounter = 1;

const GAMES_STATE_PATH = join(rootDir, 'data', 'games-state.json');

async function loadGames() {
  if (isDbConfigured()) {
    try {
      await initDb();
      const data = await loadGamesFromDb();
      for (const [id, g] of Object.entries(data)) {
        if (g && typeof g === 'object') delete g.pendingAttack;
        games.set(id, g);
      }
      console.log(`[Games] Loaded ${games.size} game(s) from PostgreSQL.`);
    } catch (err) {
      console.error('Failed to load games from DB:', err);
    }
    return;
  }
  try {
    if (!existsSync(GAMES_STATE_PATH)) return;
    const raw = readFileSync(GAMES_STATE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      for (const [id, g] of Object.entries(data)) {
        if (g && typeof g === 'object') delete g.pendingAttack;
        games.set(id, g);
      }
    }
  } catch (err) {
    console.error('Failed to load games state:', err);
  }
}

/** Repopulate dcMessageMeta, dcExhaustedState, dcHealthState from loaded games. Call after loadGames() so in-memory Maps survive redeploys. */
function repopulateDcMapsFromGames() {
  for (const [gameId, game] of games) {
    for (const playerNum of [1, 2]) {
      const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const dcMessageIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
      const activatedIndices = new Set(playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []));
      for (let i = 0; i < dcMessageIds.length && i < dcList.length; i++) {
        const msgId = dcMessageIds[i];
        const dc = dcList[i];
        if (!msgId || !dc) continue;
        dcMessageMeta.set(msgId, {
          gameId,
          playerNum,
          dcName: dc.dcName,
          displayName: dc.displayName || dc.dcName,
        });
        dcExhaustedState.set(msgId, activatedIndices.has(i));
        dcHealthState.set(msgId, dc.healthState || [[null, null]]);
      }
    }
  }
}

function saveGames() {
  if (isDbConfigured()) {
    void saveGamesToDb(games);
    return;
  }
  try {
    const data = Object.fromEntries(games);
    writeFileSync(GAMES_STATE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save games state:', err);
  }
}

// Load games at startup (async)
await loadGames();
repopulateDcMapsFromGames();

const CATEGORIES = {
  general: '📢 General',
  lfg: '🎮 Looking for Game',
  games: '⚔️ Games',
  archived: '📁 Archived Games',
  admin: '🛠️ Bot / Admin',
};

const GAME_TAGS = [
  { name: 'Slow' },
  { name: 'Fast' },
  { name: 'Hyperspeed' },
  { name: 'Ranked' },
  { name: 'Test' },
];

const SAMPLE_DECK_P1 = {
  name: 'Imperial Test Deck',
  dcList: ['Darth Vader', 'Stormtrooper (Elite)', 'Stormtrooper (Regular)', 'Stormtrooper (Regular)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Lightning', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
  dcCount: 4,
  ccCount: 15,
};

const SAMPLE_DECK_P2 = {
  name: 'Rebel Test Deck',
  dcList: ['Luke Skywalker', 'Rebel Trooper (Elite)', 'Rebel Trooper (Regular)', 'Rebel Trooper (Regular)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Push', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
  dcCount: 4,
  ccCount: 15,
};

const DEFAULT_DECK_REBELS = {
  name: 'Default Rebels',
  dcList: ['Luke Skywalker', 'Wookiee Warrior (Elite)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Push', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
  dcCount: 2,
  ccCount: 15,
};

const DEFAULT_DECK_SCUM = {
  name: 'Default Scum',
  dcList: ['Boba Fett', 'Nexu (Elite)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lure of the Dark Side', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons', 'Urgency', 'Wookiee Rage'],
  dcCount: 2,
  ccCount: 15,
};

const DEFAULT_DECK_IMPERIAL = {
  name: 'Default Imperial',
  dcList: ['Darth Vader', 'Emperor Palpatine', 'Stormtrooper (Elite)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Lightning', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
  dcCount: 3,
  ccCount: 15,
};

const CHANNELS = {
  announcements: { name: 'announcements', parent: 'general', type: ChannelType.GuildText },
  rulesAndFaq: { name: 'rules-and-faq', parent: 'general', type: ChannelType.GuildText },
  general: { name: 'general', parent: 'general', type: ChannelType.GuildText },
  lfg: { name: 'lfg', parent: 'lfg', type: ChannelType.GuildText },
  newGamesPosts: { name: 'new-games', parent: 'lfg', type: ChannelType.GuildForum },
  activeGames: { name: 'active-games', parent: 'lfg', type: ChannelType.GuildText },
  botLogs: { name: 'bot-logs', parent: 'admin', type: ChannelType.GuildText },
  suggestions: { name: 'suggestions', parent: 'admin', type: ChannelType.GuildText },
  requestsAndSuggestions: { name: 'requests-and-suggestions', parent: 'admin', type: ChannelType.GuildForum },
};

function getMainMenu() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('create_game')
      .setLabel('Create Game')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('join_game')
      .setLabel('Join Game')
      .setStyle(ButtonStyle.Secondary),
  );
}

function getLobbyJoinButton(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_join_${threadId}`)
      .setLabel('Join Game')
      .setStyle(ButtonStyle.Success),
  );
}

function getLobbyStartButton(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_start_${threadId}`)
      .setLabel('Start Game')
      .setStyle(ButtonStyle.Primary),
  );
}

function getCcShuffleDrawButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cc_shuffle_draw_${gameId}`)
      .setLabel('Shuffle deck and draw starting 3 Command Cards')
      .setStyle(ButtonStyle.Success),
  );
}

/** Play CC (green), Draw CC (green), Discard CC (red). Pass hand/deck to disable when empty. */
function getCcActionButtons(gameId, hand = [], deck = []) {
  const hasHand = hand.length > 0;
  const hasDeck = deck.length > 0;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cc_play_${gameId}`)
      .setLabel('Play CC')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasHand),
    new ButtonBuilder()
      .setCustomId(`cc_draw_${gameId}`)
      .setLabel('Draw CC')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasDeck),
    new ButtonBuilder()
      .setCustomId(`cc_discard_${gameId}`)
      .setLabel('Discard CC')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasHand),
  );
}

const IMAGES_DIR = join(rootDir, 'vassal_extracted', 'images');
const CC_DIR = join(IMAGES_DIR, 'cc');
const CARDBACKS_DIR = join(IMAGES_DIR, 'cardbacks');

/** Resolve command card image path. Looks in cc/ subfolder first, then root. Tries C card--Name, IACP variants. Returns cardback path if not found. */
function getCommandCardImagePath(cardName) {
  if (!cardName || typeof cardName !== 'string') return null;
  const candidates = [
    `C card--${cardName}.jpg`,
    `C card--${cardName}.png`,
    `IACP_C card--${cardName}.png`,
    `IACP_C card--${cardName}.jpg`,
    `IACP9_C card--${cardName}.png`,
    `IACP9_C card--${cardName}.jpg`,
    `IACP11_C card--${cardName}.png`,
    `IACP11_C card--${cardName}.jpg`,
  ];
  for (const c of candidates) {
    const inCc = join(CC_DIR, c);
    if (existsSync(inCc)) return inCc;
    const inRoot = join(IMAGES_DIR, c);
    if (existsSync(inRoot)) return inRoot;
  }
  const cardbackCandidates = [
    join(CARDBACKS_DIR, 'Command cardback.jpg'),
    join(CC_DIR, 'Command cardback.jpg'),
    join(IMAGES_DIR, 'Command cardback.jpg'),
  ];
  for (const p of cardbackCandidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Get window button row for Hand channel when in Start/End of Round window and it's this player's turn. */
function getHandWindowButtonRow(game, playerNum, gameId) {
  if (!game) return null;
  const whoseTurn = game.endOfRoundWhoseTurn ?? game.startOfRoundWhoseTurn;
  const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (whoseTurn !== playerId) return null;
  if (game.endOfRoundWhoseTurn) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`end_end_of_round_${gameId}`)
        .setLabel(`End 'End of Round' window`)
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (game.startOfRoundWhoseTurn) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`end_start_of_round_${gameId}`)
        .setLabel(`End 'Start of Round' window`)
        .setStyle(ButtonStyle.Primary)
    );
  }
  return null;
}

/** Build hand channel message payload: vertical list of embeds, one per CC, same thumbnail size as DC embeds in Play Area. */
function buildHandDisplayPayload(hand, deck, gameId, game = null, playerNum = 1) {
  const files = [];
  const embeds = [];

  // Header embed
  embeds.push(new EmbedBuilder()
    .setTitle('Command Cards in Hand')
    .setDescription(`**${hand.length}** cards in hand • **${deck.length}** in deck`)
    .setColor(0x2f3136));

  // One embed per card (thumbnail = same size as DC embeds in Play Area)
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    const path = getCommandCardImagePath(card);
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `cc-${i}-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(card || `Card ${i + 1}`)
      .setColor(0x2f3136);
    if (path && existsSync(path)) {
      files.push(new AttachmentBuilder(path, { name: fileName }));
      embed.setThumbnail(`attachment://${fileName}`);
    }
    embeds.push(embed);
  }

  const content = hand.length > 0
    ? `**Hand:** ${hand.join(', ')}\n**Deck:** ${deck.length} cards remaining.`
    : `**Hand:** (empty)\n**Deck:** ${deck.length} cards remaining.`;
  const hasHandOrDeck = hand.length > 0 || deck.length > 0;
  const rows = hasHandOrDeck ? [getCcActionButtons(gameId, hand, deck)] : [];
  const windowRow = getHandWindowButtonRow(game, playerNum, gameId);
  if (windowRow) rows.push(windowRow);
  return {
    content,
    embeds,
    files: files.length > 0 ? files : undefined,
    components: rows,
  };
}

function getLobbyRosterText(lobby) {
  const p1 = `1. **Player 1:** <@${lobby.creatorId}>`;
  const p2 = lobby.joinedId
    ? `2. **Player 2:** <@${lobby.joinedId}>`
    : `2. **Player 2:** *(not yet joined)*`;
  return `${p1}\n${p2}`;
}

function getLobbyEmbed(lobby) {
  const roster = getLobbyRosterText(lobby);
  const isReady = !!lobby.joinedId;
  const embed = new EmbedBuilder()
    .setTitle('Game Lobby')
    .setDescription(`${roster}\n\n${isReady ? 'Both players ready! Click **Start Game** to begin.' : 'Click **Join Game** to play!'}`)
    .setColor(0x2f3136);
  return embed;
}

async function getThreadName(thread, lobby) {
  const truncate = (s) => (s.length > 18 ? s.slice(0, 15) + '…' : s);
  let p1Name = 'Creator';
  let p2Name = lobby.joinedId ? 'Joiner' : '(waiting)';
  try {
    const p1 = await thread.client.users.fetch(lobby.creatorId);
    p1Name = truncate(p1.username || p1.globalName || 'P1');
    if (lobby.joinedId) {
      const p2 = await thread.client.users.fetch(lobby.joinedId);
      p2Name = truncate(p2.username || p2.globalName || 'P2');
    }
  } catch {
    // fallback to IDs if fetch fails
  }
  const status = lobby.status || (lobby.joinedId ? 'Full' : 'LFG');
  return `[${status}] ${p1Name} vs ${p2Name}`;
}

async function updateThreadName(thread, lobby) {
  try {
    const name = await getThreadName(thread, lobby);
    await thread.setName(name.slice(0, 100));
  } catch (err) {
    console.error('Failed to update thread name:', err);
  }
}

/** Create p1 and p2 Hand channels (called when map is selected). */
async function createHandChannels(guild, gameCategory, prefix, player1Id, player2Id) {
  const p1Only = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel },
    { id: guild.client.user.id, allow: PermissionFlagsBits.ViewChannel },
  ];
  const p2Only = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel },
    { id: guild.client.user.id, allow: PermissionFlagsBits.ViewChannel },
  ];
  const p1 = await guild.channels.create({
    name: `${prefix} p1-hand`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: p1Only,
  });
  const p2 = await guild.channels.create({
    name: `${prefix} p2-hand`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: p2Only,
  });
  return { p1HandChannel: p1, p2HandChannel: p2 };
}

/** Create p1 and p2 Play Area channels (called when both squads are ready). */
async function createPlayAreaChannels(guild, gameCategory, prefix, player1Id, player2Id) {
  const playAreaPerms = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: guild.client.user.id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.ManageThreads },
  ];
  const p1 = await guild.channels.create({
    name: `${prefix} p1-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  const p2 = await guild.channels.create({
    name: `${prefix} p2-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  return { p1PlayAreaChannel: p1, p2PlayAreaChannel: p2 };
}

async function createGameChannels(guild, player1Id, player2Id, options = {}) {
  const { createPlayAreas = false, createHandChannels = false } = options;
  // Scan for existing IA Game #XXXXX categories (active, archived, completed) so we never reuse an ID
  await guild.channels.fetch();
  const gameCategories = guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildCategory && /^IA Game #(\d+)$/.test(c.name)
  );
  const maxId = gameCategories.reduce((max, c) => {
    const m = c.name.match(/^IA Game #(\d+)$/);
    const n = m ? parseInt(m[1], 10) : 0;
    return Math.max(max, n);
  }, 0);
  const nextId = maxId + 1;
  gameIdCounter = nextId + 1; // keep in sync for any future use
  const gameId = String(nextId).padStart(5, '0');
  const prefix = `IA${gameId}`;
  const everyoneRole = guild.roles.everyone;
  const botId = guild.client.user.id;

  const playerPerms = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel },
    { id: botId, allow: PermissionFlagsBits.ViewChannel },
  ];

  const gamesCategory = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORIES.games
  );
  const position = gamesCategory ? gamesCategory.position + 1 : 0;

  const gameCategory = await guild.channels.create({
    name: `IA Game #${gameId}`,
    type: ChannelType.GuildCategory,
    permissionOverwrites: playerPerms,
    position,
  });

  const p1Only = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel },
    { id: botId, allow: PermissionFlagsBits.ViewChannel },
  ];
  const p2Only = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel },
    { id: botId, allow: PermissionFlagsBits.ViewChannel },
  ];
  // Play Area: both players can view, but only bot can send (static channel; DCs get threads)
  const playAreaPerms = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: botId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.ManageThreads },
  ];

  const chatChannel = await guild.channels.create({
    name: `${prefix} General chat`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playerPerms,
  });
  const gameLogPerms = [
    ...playerPerms.filter((p) => p.id !== botId),
    { id: botId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageMessages },
  ];
  const generalChannel = await guild.channels.create({
    name: `${prefix} Game Log`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: gameLogPerms,
  });
  const boardChannel = await guild.channels.create({
    name: `${prefix} Board`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playerPerms,
  });
  let p1HandChannel = null;
  let p2HandChannel = null;
  if (createHandChannels) {
    p1HandChannel = await guild.channels.create({
      name: `${prefix} p1-hand`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: p1Only,
    });
    p2HandChannel = await guild.channels.create({
      name: `${prefix} p2-hand`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: p2Only,
    });
  }
  let p1PlayAreaChannel = null;
  let p2PlayAreaChannel = null;
  if (createPlayAreas) {
    p1PlayAreaChannel = await guild.channels.create({
      name: `${prefix} p1-play-area`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: playAreaPerms,
    });
    p2PlayAreaChannel = await guild.channels.create({
      name: `${prefix} p2-play-area`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: playAreaPerms,
    });
  }

  return { gameCategory, gameId, generalChannel, chatChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel };
}

/** Game phases for visual organization - all use orange sidebar */
const PHASE_COLOR = 0xf39c12;
const GAME_PHASES = {
  SETUP: { name: 'PRE-GAME SETUP', emoji: '⚙️', color: PHASE_COLOR },
  INITIATIVE: { name: 'INITIATIVE', emoji: '🎲', color: PHASE_COLOR },
  DEPLOYMENT: { name: 'DEPLOYMENT', emoji: '📍', color: PHASE_COLOR },
  ROUND: { name: 'ROUND', emoji: '⚔️', color: PHASE_COLOR },
};

/** Action icons for game log */
const ACTION_ICONS = {
  squad: '📋',
  map: '🗺️',
  initiative: '🎲',
  zone: '🏁',
  deploy: '📍',
  exhaust: '😴',
  activate: '⚡',
  ready: '✨',
  move: '🚶',
  attack: '⚔️',
  interact: '🤝',
  special: '✴️',
  deployed: '✅',
  card: '🎴',
};

/** Post a phase header to the game log (only when phase changes) */
async function logPhaseHeader(game, client, phase, roundNum = null) {
  const phaseKey = `currentPhase`;
  const phaseName = roundNum ? `${phase.name} ${roundNum}` : phase.name;
  const fullKey = roundNum ? `${phase.name}_${roundNum}` : phase.name;
  if (game[phaseKey] === fullKey) return;
  game[phaseKey] = fullKey;
  try {
    const ch = await client.channels.fetch(game.generalId);
    const embed = new EmbedBuilder()
      .setTitle(`${phase.emoji}  ${phaseName}`)
      .setColor(phase.color);
    const msg = await ch.send({ embeds: [embed] });
    const setupPhases = ['SETUP', 'INITIATIVE', 'DEPLOYMENT'];
    if (setupPhases.includes(phase.name)) {
      game.setupLogMessageIds = game.setupLogMessageIds || [];
      game.setupLogMessageIds.push(msg.id);
    }
  } catch (err) {
    console.error('Phase header error:', err);
  }
}

/** Log a game action with icon and clean formatting */
async function logGameAction(game, client, content, options = {}) {
  try {
    const ch = await client.channels.fetch(game.generalId);
    const icon = options.icon ? `${ACTION_ICONS[options.icon] || ''} ` : '';
    const phase = options.phase;
    if (phase) {
      await logPhaseHeader(game, client, GAME_PHASES[phase], options.roundNum);
    }
    const timestamp = `<t:${Math.floor(Date.now() / 1000)}:t>`;
    const msgContent = `${icon}${timestamp} — ${content}`;
    const sentMsg = await ch.send({ content: msgContent, allowedMentions: options.allowedMentions });
    const setupPhases = ['SETUP', 'INITIATIVE', 'DEPLOYMENT'];
    if (phase && setupPhases.includes(phase)) {
      game.setupLogMessageIds = game.setupLogMessageIds || [];
      game.setupLogMessageIds.push(sentMsg.id);
    }
  } catch (err) {
    console.error('Game log error:', err);
  }
}

const gameErrorThreads = new Map();

function extractGameIdFromInteraction(interaction) {
  const id = interaction.customId || interaction.values?.[0] || '';
  const prefixes = [
    'status_phase_', 'end_end_of_round_', 'end_start_of_round_', 'map_selection_', 'draft_random_',
    'pass_activation_turn_', 'combat_ready_', 'combat_roll_', 'cc_play_select_', 'cc_discard_select_',
    'kill_game_', 'refresh_map_', 'refresh_all_', 'undo_', 'deployment_zone_red_', 'deployment_zone_blue_',
  ];
  for (const p of prefixes) {
    if (id.startsWith(p)) {
      const rest = id.slice(p.length);
      const gameId = rest.split('_')[0];
      if (gameId && games.has(gameId)) return gameId;
      return gameId || null;
    }
  }
  const m = id.match(/^(?:squad_modal_|deploy_modal_|special_done_|interact_choice_|interact_cancel_)([^_]+)/);
  if (m && games.has(m[1])) return m[1];
  const dcMatch = id.match(/^dc_(?:activate|move|attack|interact|special)_([^_]+)/);
  if (dcMatch) {
    const part = dcMatch[1];
    if (games.has(part)) return part;
    for (const [gid, g] of games) {
      if (g.p1DcMessageIds?.includes(part) || g.p2DcMessageIds?.includes(part)) return gid;
      for (const [msgId, meta] of dcMessageMeta) {
        if (meta.gameId === gid && (String(msgId) === part || part.startsWith(msgId))) return gid;
      }
    }
  }
  const moveMatch = id.match(/^move_(?:mp|pick)_([^_]+)/);
  if (moveMatch && games.has(moveMatch[1])) return moveMatch[1];
  const attackMatch = id.match(/^attack_target_(.+)_\d+_\d+$/);
  if (attackMatch) {
    const msgId = attackMatch[1];
    for (const [gid, g] of games) {
      if ([...(g.p1DcMessageIds || []), ...(g.p2DcMessageIds || [])].includes(msgId)) return gid;
    }
  }
  return null;
}

function extractGameIdFromMessage(message) {
  const chId = message.channel?.id;
  if (!chId) return null;
  for (const [gameId, g] of games) {
    if (g.generalId === chId || g.chatId === chId || g.boardId === chId ||
        g.p1HandId === chId || g.p2HandId === chId || g.p1PlayAreaId === chId || g.p2PlayAreaId === chId) {
      return gameId;
    }
  }
  if (message.channel?.isThread?.()) {
    const parent = message.channel.parent;
    if (parent?.name === 'new-games') return null;
    for (const [gameId, g] of games) {
      const cat = message.guild?.channels?.cache?.get(g.gameCategoryId);
      if (cat && message.channel.parentId === cat.id) return gameId;
    }
  }
  return null;
}

async function logGameErrorToBotLogs(client, guild, gameId, error, context = '') {
  try {
    await guild?.channels?.fetch().catch(() => {});
    const ch = guild?.channels?.cache?.find((c) => c.name === 'bot-logs' && c.type === ChannelType.GuildText);
    if (!ch) return;
    const errMsg = error?.message || String(error);
    const stack = error?.stack ? `\n\`\`\`\n${error.stack.slice(0, 800)}\n\`\`\`` : '';
    const ctx = context ? ` (${context})` : '';
    const content = `⚠️ **Game Error**${gameId ? ` — IA Game #${gameId}` : ''}${ctx}\n${errMsg}${stack}`;

    if (gameId) {
      const key = `${guild.id}_${gameId}`;
      let threadId = gameErrorThreads.get(key);
      if (!threadId) {
        try {
          const thread = await ch.threads.create({
            name: `IA${gameId} errors`,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
          });
          threadId = thread.id;
          gameErrorThreads.set(key, threadId);
        } catch {
          threadId = null;
        }
      }
      const target = threadId ? await client.channels.fetch(threadId).catch(() => null) : ch;
      if (target) await target.send({ content });
    } else {
      await ch.send({ content });
    }
  } catch (e) {
    console.error('Failed to log game error to bot-logs:', e);
  }
}

/** After map selection: randomly pick A or B mission card, post to Game Log, pin it. */
async function postMissionCardAfterMapSelection(game, client, map) {
  const missions = missionCardsData[map.id];
  if (!missions?.a || !missions?.b) return;
  const variant = Math.random() < 0.5 ? 'a' : 'b';
  const mission = missions[variant];
  const mapName = map.name || map.id;
  const fullName = `${mapName} — ${mission.name}`;
  game.selectedMission = { variant, name: mission.name, fullName };
  try {
    const ch = await client.channels.fetch(game.generalId);
    const resolvedPath = resolveAssetPath(mission.imagePath, 'mission-cards');
    const imagePath = join(rootDir, resolvedPath);
    let sentMsg;
    if (existsSync(imagePath)) {
      const attachment = new AttachmentBuilder(imagePath, { name: 'mission-card.jpg' });
      sentMsg = await ch.send({
        content: `🎯 **Mission:** ${fullName}`,
        files: [attachment],
      });
    } else {
      sentMsg = await ch.send({ content: `🎯 **Mission:** ${fullName}` });
    }
    await sentMsg.pin().catch(() => {});
    await logGameAction(game, client, `Mission selected: **${fullName}** (pinned above).`, { phase: 'SETUP', icon: 'map' });
  } catch (err) {
    console.error('Mission card post error:', err);
    await logGameAction(game, client, `Mission selected: **${fullName}**`, { phase: 'SETUP', icon: 'map' });
  }
}

function getSelectSquadButton(gameId, playerNum) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`squad_select_${gameId}_${playerNum}`)
      .setLabel('Select Squad')
      .setStyle(ButtonStyle.Primary)
  );
}

/** Select Squad (grey) + Default Rebels (red), Default Scum (green), Default Imperial (blurple) for testing. */
function getHandSquadButtons(gameId, playerNum) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`squad_select_${gameId}_${playerNum}`)
      .setLabel('Select Squad')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`default_deck_${gameId}_${playerNum}_rebel`)
      .setLabel('Default Rebels')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`default_deck_${gameId}_${playerNum}_scum`)
      .setLabel('Default Scum')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`default_deck_${gameId}_${playerNum}_imperial`)
      .setLabel('Default Imperial')
      .setStyle(ButtonStyle.Primary)
  );
}

function getKillGameButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`kill_game_${gameId}`)
      .setLabel('Kill Game (testing)')
      .setStyle(ButtonStyle.Danger)
  );
}

function getUndoButton(gameId) {
  return new ButtonBuilder()
    .setCustomId(`undo_${gameId}`)
    .setLabel('UNDO')
    .setStyle(ButtonStyle.Secondary);
}

function getBoardButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`refresh_map_${gameId}`)
      .setLabel('Refresh Map')
      .setStyle(ButtonStyle.Primary),
    getUndoButton(gameId),
    new ButtonBuilder()
      .setCustomId(`refresh_all_${gameId}`)
      .setLabel('Refresh All')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`kill_game_${gameId}`)
      .setLabel('Kill Game (testing)')
      .setStyle(ButtonStyle.Danger)
  );
}

/** Red Zone = Danger (red), Blue Zone = Primary (blue). Only valid before deployment zone is chosen. */
function getDeploymentZoneButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`deployment_zone_red_${gameId}`)
      .setLabel('Red Zone')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`deployment_zone_blue_${gameId}`)
      .setLabel('Blue Zone')
      .setStyle(ButtonStyle.Primary)
  );
}

function getDeploymentDoneButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`deployment_done_${gameId}`)
      .setLabel("Deployment Completed")
      .setStyle(ButtonStyle.Success)
  );
}

/** Same display names as Play Area: duplicate DCs get [Group 1], [Group 2], etc. */
function getDeployDisplayNames(dcList) {
  if (!dcList?.length) return [];
  const totals = {};
  const counts = {};
  for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
  return dcList.map((dcName) => {
    counts[dcName] = (counts[dcName] || 0) + 1;
    const dgIndex = counts[dcName];
    return totals[dcName] > 1 ? `${dcName} [Group ${dgIndex}]` : dcName;
  });
}

const FIGURE_LETTERS = 'abcdefghij';

function resolveDcName(entry) {
  return typeof entry === 'object' ? (entry.dcName || entry.displayName) : entry;
}

/** Per-figure deploy labels: one entry per figure (e.g. multi-figure DCs get "1a", "1b", "2a", "2b"). Figure-less DCs excluded. */
function getDeployFigureLabels(dcList) {
  if (!dcList?.length) return { labels: [], metadata: [] };
  const figureDcs = dcList.map(resolveDcName).filter((n) => n && !isFigurelessDc(n));
  const totals = {};
  const counts = {};
  for (const d of figureDcs) totals[d] = (totals[d] || 0) + 1;
  const labels = [];
  const metadata = [];
  for (let i = 0; i < figureDcs.length; i++) {
    const dcName = figureDcs[i];
    counts[dcName] = (counts[dcName] || 0) + 1;
    const dgIndex = counts[dcName];
    const displayName = totals[dcName] > 1 ? `${dcName} [Group ${dgIndex}]` : dcName;
    const baseName = displayName.replace(/\s*\[Group \d+\]$/, '');
    const figures = getDcStats(dcName).figures ?? 1;
    if (figures <= 1) {
      labels.push(`Deploy ${displayName}`);
      metadata.push({ dcName, dgIndex, figureIndex: 0 });
    } else {
      for (let f = 0; f < figures; f++) {
        labels.push(`Deploy ${baseName} ${dgIndex}${FIGURE_LETTERS[f]}`);
        metadata.push({ dcName, dgIndex, figureIndex: f });
      }
    }
  }
  return { labels, metadata };
}

/** One button per row. Undeployed: colored Deploy X. Deployed: grey Deploy X (Location: B1). All clear when Deployment Completed. */
function getDeployButtonRows(gameId, playerNum, dcList, zone, figurePositions) {
  const { labels, metadata } = getDeployFigureLabels(dcList);
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  const pos = figurePositions?.[playerNum] || {};
  const deployRows = [];
  for (let i = 0; i < labels.length; i++) {
    const meta = metadata[i];
    const figureKey = `${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`;
    const space = pos[figureKey];
    const displaySpace = space ? space.toUpperCase() : '';
    const label = space
      ? `${labels[i]} (Location: ${displaySpace})`.slice(0, 80)
      : labels[i].slice(0, 80);
    deployRows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`deployment_fig_${gameId}_${playerNum}_${i}`)
          .setLabel(label)
          .setStyle(space ? ButtonStyle.Secondary : zoneStyle)
      )
    );
  }
  const doneRow = getDeploymentDoneButton(gameId);
  return { deployRows, doneRow };
}

/** Rebuilds deploy prompt messages for a player, removing buttons for already-deployed figures. */
async function updateDeployPromptMessages(game, playerNum, client) {
  const isInitiative = playerNum === (game.initiativePlayerId === game.player1Id ? 1 : 2);
  const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
  const msgIds = game[idsKey];
  if (!msgIds?.length) return;
  const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
  const zone = isInitiative ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
  const dcList = squad?.dcList || [];
  try {
    const handChannel = await client.channels.fetch(handId);
    for (const msgId of msgIds) {
      try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
    }
    game[idsKey] = [];
    const { deployRows, doneRow } = getDeployButtonRows(game.gameId, playerNum, dcList, zone, game.figurePositions);
    const DEPLOY_ROWS_PER_MSG = 4;
    const zoneLabel = zone === 'red' ? 'red' : 'blue';
    const firstContent = isInitiative
      ? `You chose the **${zoneLabel}** zone. Deploy each figure below (one per row), then click **Deployment Completed** when finished.`
      : `Your opponent has deployed. Deploy each figure in the **${zoneLabel}** zone below (one per row), then click **Deployment Completed** when finished.`;
    if (deployRows.length === 0) {
      const msg = await handChannel.send({
        content: isInitiative ? `You chose the **${zoneLabel}** zone. When finished, click **Deployment Completed** below.` : `Your opponent has deployed. Deploy in the **${zoneLabel}** zone. When finished, click **Deployment Completed** below.`,
        components: [doneRow],
      });
      game[idsKey].push(msg.id);
    } else {
      for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
        const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
        const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
        const components = isLastChunk ? [...chunk, doneRow] : chunk;
        const msg = await handChannel.send({
          content: i === 0 ? firstContent : null,
          components,
        });
        game[idsKey].push(msg.id);
      }
    }
    game[isInitiative ? 'initiativeDeployMessageId' : 'nonInitiativeDeployMessageId'] = game[idsKey][game[idsKey].length - 1];
  } catch (err) {
    console.error('updateDeployPromptMessages error:', err);
  }
}

/** Returns action rows of space buttons grouped by map row (never mix row 17 and 18 in same line). Max 5 buttons per Discord row. */
function getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, occupiedSpaces, zone) {
  const occupied = new Set((occupiedSpaces || []).map((s) => String(s).toLowerCase()));
  const available = (validSpaces || [])
    .map((s) => String(s).toLowerCase())
    .filter((s) => !occupied.has(s));
  const byRow = {};
  for (const s of available) {
    const m = s.match(/^([a-z]+)(\d+)$/i);
    const row = m ? parseInt(m[2], 10) : 0;
    if (!byRow[row]) byRow[row] = [];
    byRow[row].push(s);
  }
  const sortedRows = Object.keys(byRow).map(Number).sort((a, b) => a - b);
  for (const r of sortedRows) {
    byRow[r].sort((a, b) => (a || '').localeCompare(b || ''));
  }
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  const rows = [];
  for (const rowNum of sortedRows) {
    const tiles = byRow[rowNum];
    for (let i = 0; i < tiles.length; i += 5) {
      const chunk = tiles.slice(i, i + 5);
      rows.push(
        new ActionRowBuilder().addComponents(
          chunk.map((space) =>
            new ButtonBuilder()
              .setCustomId(`deploy_pick_${gameId}_${playerNum}_${flatIndex}_${space}`)
              .setLabel(space.toUpperCase())
              .setStyle(zoneStyle)
          )
        )
      );
    }
  }
  return { rows, available };
}

/** Returns action rows for MP distance selection: buttons with move_mp_${msgId}_${figureIndex}_${mp}. */
function getMoveMpButtonRows(msgId, figureIndex, mpRemaining) {
  if (!mpRemaining || mpRemaining < 1) return [];
  const btns = [];
  for (let mp = 1; mp <= mpRemaining; mp++) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`move_mp_${msgId}_${figureIndex}_${mp}`)
        .setLabel(`${mp} MP`)
        .setStyle(ButtonStyle.Primary)
    );
  }
  const rows = [];
  for (let r = 0; r < btns.length; r += 5) {
    rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
  }
  return rows;
}

/** Returns action rows for movement: buttons with move_pick_${msgId}_${figureIndex}_${space}. */
function getMoveSpaceGridRows(msgId, figureIndex, validSpaces, mapSpaces) {
  const available = (validSpaces || []).map((s) => normalizeCoord(s));
  const orderMap = new Map(
    (mapSpaces?.spaces || []).map((coord, idx) => [normalizeCoord(coord), idx])
  );
  available.sort((a, b) => {
    const diff = (orderMap.get(a) ?? Infinity) - (orderMap.get(b) ?? Infinity);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
  const byRow = {};
  const rowOrder = [];
  for (const s of available) {
    const m = s.match(/^([a-z]+)(\d+)$/i);
    const row = m ? parseInt(m[2], 10) : 0;
    if (!byRow[row]) {
      byRow[row] = [];
      rowOrder.push(row);
    }
    byRow[row].push(s);
  }
  const rows = [];
  for (const rowNum of rowOrder) {
    const tiles = byRow[rowNum] || [];
    for (let i = 0; i < tiles.length; i += 5) {
      const chunk = tiles.slice(i, i + 5);
      rows.push(
        new ActionRowBuilder().addComponents(
          chunk.map((space) =>
            new ButtonBuilder()
              .setCustomId(`move_pick_${msgId}_${figureIndex}_${space}`)
              .setLabel(space.toUpperCase())
              .setStyle(ButtonStyle.Success)
          )
        )
      );
    }
  }
  return { rows, available };
}

/** Convert game.figurePositions to renderMap figures format. Uses circular figure images from figure-images.json. */
function getFiguresForRender(game) {
  const pos = game.figurePositions;
  if (!pos || (!pos[1] && !pos[2])) return [];
  const figures = [];
  const zoneColors = { red: '#e74c3c', blue: '#3498db' };
  const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const chosen = game.deploymentZoneChosen;
  if (!chosen) return figures;
  const otherZone = chosen === 'red' ? 'blue' : 'red';
  for (const p of [1, 2]) {
    const zone = p === initiativePlayerNum ? chosen : otherZone;
    const color = zoneColors[zone] || '#888';
    const poses = pos[p] || {};
    const dcList = (p === 1 ? game.player1Squad : game.player2Squad)?.dcList || [];
    const totals = {};
    for (const d of dcList) {
      const n = resolveDcName(d);
      if (n && !isFigurelessDc(n)) totals[n] = (totals[n] || 0) + 1;
    }
    for (const [figureKey, space] of Object.entries(poses)) {
      const dcName = figureKey.replace(/-\d+-\d+$/, '');
      const m = figureKey.match(/-(\d+)-(\d+)$/);
      const dgIndex = m ? parseInt(m[1], 10) : 1;
      const figureIndex = m ? parseInt(m[2], 10) : 0;
      const figureCount = getDcStats(dcName).figures ?? 1;
      const dcCopies = totals[dcName] ?? 1;
      let label = null;
      if (dcCopies > 1) {
        label = figureCount > 1 ? `${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : String(dgIndex);
      } else if (figureCount > 1) {
        label = `${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}`;
      }
      const imagePath = getFigureImagePath(dcName);
      const baseSize = getFigureSize(dcName);
      const figureSize = game.figureOrientations?.[figureKey] || baseSize;
      figures.push({
        coord: space,
        color,
        imagePath: imagePath || undefined,
        dcName,
        figureSize,
        label,
      });
    }
  }
  return figures;
}

/** Get map tokens (terminals + mission-specific) for renderMap. */
function getMapTokensForRender(mapId, missionVariant) {
  const mapData = mapTokensData[mapId];
  if (!mapData) return { terminals: [], missionA: [], missionB: [] };
  const terminals = mapData.terminals || [];
  const missionA = mapData.missionA?.launchPanels || [];
  const missionB = mapData.missionB?.contraband || mapData.missionB?.crates || [];
  return {
    terminals,
    missionA: missionVariant === 'a' ? missionA : [],
    missionB: missionVariant === 'b' ? missionB : [],
  };
}

/** Check win conditions. Returns { ended, winnerId?, reason? }. Posts game-over and sets game.ended if ended. */
async function checkWinConditions(game, client) {
  const vp1 = game.player1VP?.total ?? 0;
  const vp2 = game.player2VP?.total ?? 0;
  const p1Figures = Object.keys(game.figurePositions?.[1] || {}).length;
  const p2Figures = Object.keys(game.figurePositions?.[2] || {}).length;

  if (vp1 >= 40 || vp2 >= 40) {
    const winnerId = vp1 >= 40 ? game.player1Id : game.player2Id;
    const reason = '40 VP';
    await postGameOver(game, client, winnerId, reason);
    return { ended: true, winnerId, reason };
  }
  if (p1Figures === 0 && p2Figures === 0) {
    await postGameOver(game, client, null, 'draw (both eliminated)');
    return { ended: true, winnerId: null, reason: 'draw' };
  }
  if (p1Figures === 0 || p2Figures === 0) {
    const winnerId = p1Figures === 0 ? game.player2Id : game.player1Id;
    const reason = 'elimination';
    await postGameOver(game, client, winnerId, reason);
    return { ended: true, winnerId, reason };
  }
  return { ended: false };
}

async function postGameOver(game, client, winnerId, reason) {
  game.ended = true;
  const embed = buildScorecardEmbed(game);
  const content = winnerId
    ? `\uD83C\uDFC1 **GAME OVER** — <@${winnerId}> wins by ${reason}!`
    : `\uD83C\uDFC1 **GAME OVER** — ${reason}`;
  try {
    const ch = await client.channels.fetch(game.generalId);
    await ch.send({
      content,
      embeds: [embed],
      allowedMentions: winnerId ? { users: [winnerId] } : undefined,
    });
  } catch (err) {
    console.error('Failed to post game over:', err);
  }
  saveGames();
}

/** Returns true if game ended (and replied to user). Call after games.get() in handlers to block further actions. */
async function replyIfGameEnded(game, interaction) {
  if (game?.ended) {
    await interaction.reply({ content: 'This game has ended.', ephemeral: true }).catch(() => {});
    return true;
  }
  return false;
}

/** Build Scorecard embed with VP breakdown per player. */
function buildScorecardEmbed(game) {
  const vp1 = game.player1VP || { total: 0, kills: 0, objectives: 0 };
  const vp2 = game.player2VP || { total: 0, kills: 0, objectives: 0 };
  return new EmbedBuilder()
    .setTitle('Scorecard')
    .setColor(0x2f3136)
    .addFields(
      { name: 'Player 1', value: `<@${game.player1Id}>`, inline: true },
      { name: 'Player 2', value: `<@${game.player2Id}>`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Total VP', value: `${vp1.total}`, inline: true },
      { name: 'Total VP', value: `${vp2.total}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Kills', value: `${vp1.kills}`, inline: true },
      { name: 'Kills', value: `${vp2.kills}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Objectives', value: `${vp1.objectives}`, inline: true },
      { name: 'Objectives', value: `${vp2.objectives}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    );
}

/** Refresh all game components with latest data (DC stats, CC images, etc.). Reloads JSON data first. */
async function refreshAllGameComponents(game, client) {
  reloadGameData();
  const gameId = game.gameId;

  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Refresh All: board failed', err);
    }
  }

  const allDcMsgIds = [...(game.p1DcMessageIds || []), ...(game.p2DcMessageIds || [])];
  for (const msgId of allDcMsgIds) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.gameId !== gameId) continue;
    const exhausted = dcExhaustedState.get(msgId) ?? false;
    const displayName = meta.displayName || meta.dcName;
    let healthState = dcHealthState.get(msgId) ?? [];
    const stats = getDcStats(meta.dcName);
    const figureless = isFigurelessDc(meta.dcName);
    if (!figureless && stats.health != null) {
      const figures = stats.figures ?? 1;
      healthState = Array.from({ length: figures }, (_, i) => {
        const existing = healthState[i];
        const cur = existing?.[0] != null ? existing[0] : stats.health;
        const max = existing?.[1] != null ? existing[1] : stats.health;
        return [cur, max];
      });
      dcHealthState.set(msgId, healthState);
    }
    try {
      const channelId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
      const channel = await client.channels.fetch(channelId);
      const msg = await channel.messages.fetch(msgId);
      const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, displayName, healthState);
      const components = exhausted ? [getDcToggleButton(msgId, true)] : [getDcToggleButton(msgId, false)];
      await msg.edit({ embeds: [embed], files: files?.length ? files : [], components });
    } catch (err) {
      console.error('Refresh All: DC message failed', msgId, err);
    }
  }

  await updateHandChannelMessages(game, client);
  for (const pn of [1, 2]) {
    await updateHandVisualMessage(game, pn, client);
    await updateDiscardPileMessage(game, pn, client);
  }
}

/** Returns { content, files?, embeds?, components } for posting the game map. Includes Scorecard embed. */
async function buildBoardMapPayload(gameId, map, game) {
  const components = [getBoardButtons(gameId)];
  const embeds = game ? [buildScorecardEmbed(game)] : [];
  const figures = game ? getFiguresForRender(game) : [];
  const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant);
  const hasFigures = figures.length > 0;
  const hasTokens = tokens.terminals?.length > 0 || tokens.missionA?.length > 0 || tokens.missionB?.length > 0;
  const resolvedMapPath = map.imagePath ? resolveAssetPath(map.imagePath, 'maps') : null;
  const imagePath = resolvedMapPath ? join(rootDir, resolvedMapPath) : null;
  const pdfPath = join(rootDir, 'data', 'map-pdfs', `${map.id}.pdf`);

  const allowedMentions = game ? { users: [...new Set([game.player1Id, game.player2Id])] } : undefined;
  if ((hasFigures || hasTokens) && imagePath && existsSync(imagePath)) {
    try {
      const buffer = await renderMap(map.id, { figures, tokens, showGrid: false, maxWidth: 1200 });
      return {
        content: `**Game map: ${map.name}** — Refresh to update figure positions.`,
        files: [new AttachmentBuilder(buffer, { name: 'map-with-figures.png' })],
        embeds,
        components,
        allowedMentions,
      };
    } catch (err) {
      console.error('Map render error:', err);
    }
  }
  if (existsSync(pdfPath)) {
    return {
      content: `**Game map: ${map.name}** (high-res PDF)`,
      files: [new AttachmentBuilder(pdfPath, { name: `${map.id}.pdf` })],
      embeds,
      components,
      allowedMentions,
    };
  }
  if (imagePath && existsSync(imagePath)) {
    return {
      content: `**Game map: ${map.name}** *(Add \`data/map-pdfs/${map.id}.pdf\` for high-res PDF)*`,
      files: [new AttachmentBuilder(imagePath, { name: `map.${(map.imagePath || '').split('.').pop() || 'gif'}` })],
      embeds,
      components,
      allowedMentions,
    };
  }
  return {
    content: `**Game map: ${map.name}** — Add high-res PDF at \`data/map-pdfs/${map.id}.pdf\` to display it here.`,
    embeds,
    components,
    allowedMentions,
  };
}

/** Returns one row: Map Selection (if not yet selected), Kill Game. Determine Initiative appears on the Both Squads Ready message. */
function getGeneralSetupButtons(game) {
  const killBtn = new ButtonBuilder()
    .setCustomId(`kill_game_${game.gameId}`)
    .setLabel('Kill Game (testing)')
    .setStyle(ButtonStyle.Danger);
  const draftBtn = new ButtonBuilder()
    .setCustomId(`draft_random_${game.gameId}`)
    .setLabel('Draft Random')
    .setStyle(ButtonStyle.Secondary);
  const components = [];
  if (!game.mapSelected) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`map_selection_${game.gameId}`)
        .setLabel('MAP SELECTION')
        .setStyle(ButtonStyle.Success)
    );
  }
  if (game.isTestGame && !game.mapSelected && !game.draftRandomUsed && !game.initiativeDetermined) {
    components.push(draftBtn);
  }
  components.push(killBtn);
  return new ActionRowBuilder().addComponents(...components);
}

/** Delete setup messages from Game Log when Round 1 begins. */
async function clearPreGameSetup(game, client) {
  const ids = [
    ...(game.generalSetupMessageId ? [game.generalSetupMessageId] : []),
    ...(game.bothReadyMessageId ? [game.bothReadyMessageId] : []),
    ...(game.deploymentZoneMessageId ? [game.deploymentZoneMessageId] : []),
    ...(game.setupLogMessageIds || []),
  ];
  if (ids.length === 0) return;
  try {
    const ch = await client.channels.fetch(game.generalId);
    for (const id of ids) {
      try {
        const msg = await ch.messages.fetch(id);
        await msg.delete();
      } catch {}
    }
    game.generalSetupMessageId = null;
    game.bothReadyMessageId = null;
    game.deploymentZoneMessageId = null;
    game.setupLogMessageIds = [];
  } catch (err) {
    console.error('Failed to clear pre-game setup:', err);
  }
}

/** Returns Determine Initiative + Kill Game for the Both Squads Ready message. */
function getDetermineInitiativeButtons(game) {
  const components = [];
  if (!game.initiativeDetermined) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`determine_initiative_${game.gameId}`)
        .setLabel('Determine Initiative')
        .setStyle(ButtonStyle.Primary)
    );
  }
  components.push(
    new ButtonBuilder()
      .setCustomId(`kill_game_${game.gameId}`)
      .setLabel('Kill Game (testing)')
      .setStyle(ButtonStyle.Danger)
  );
  return new ActionRowBuilder().addComponents(...components);
}

async function runDraftRandom(game, client) {
  const generalChannel = await client.channels.fetch(game.generalId);

  // Map selection
  if (!game.mapSelected) {
    const playReadyMaps = getPlayReadyMaps();
    if (playReadyMaps.length === 0) throw new Error('No play-ready maps available.');
    const map = playReadyMaps[Math.floor(Math.random() * playReadyMaps.length)];
    game.selectedMap = { id: map.id, name: map.name, imagePath: map.imagePath };
    game.mapSelected = true;
    await postMissionCardAfterMapSelection(game, client, map);
    if (game.boardId) {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, map, game);
      await boardChannel.send(payload);
    }
    await logGameAction(game, client, `Map selected: **${map.name}** — View in Board channel.`, { phase: 'SETUP', icon: 'map' });
  }

  // Hand channels
  if (!game.p1HandId || !game.p2HandId) {
    const guild = generalChannel.guild;
    const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
    const prefix = `IA${game.gameId}`;
    const { p1HandChannel, p2HandChannel } = await createHandChannels(
      guild, gameCategory, prefix, game.player1Id, game.player2Id
    );
    game.p1HandId = p1HandChannel.id;
    game.p2HandId = p2HandChannel.id;
  }

  // One side Rebels, one side Scum (fixed for Draft Random)
  const p1Deck = DEFAULT_DECK_REBELS;
  const p2Deck = DEFAULT_DECK_SCUM;
  await applySquadSubmission(game, true, { ...p1Deck }, client);
  await applySquadSubmission(game, false, { ...p2Deck }, client);

  // Initiative + deployment zone
  if (!game.initiativeDetermined) {
    const winner = Math.random() < 0.5 ? game.player1Id : game.player2Id;
    const playerNum = winner === game.player1Id ? 1 : 2;
    game.initiativePlayerId = winner;
    game.initiativeDetermined = true;
    await logGameAction(
      game,
      client,
      `<@${winner}> (**Player ${playerNum}**) won initiative! Chooses deployment zone and activates first each round.`,
      { allowedMentions: { users: [winner] }, phase: 'INITIATIVE', icon: 'initiative' }
    );
  }
  if (!game.deploymentZoneChosen) {
    const zone = Math.random() < 0.5 ? 'red' : 'blue';
    game.deploymentZoneChosen = zone;
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    await logGameAction(
      game,
      client,
      `<@${game.initiativePlayerId}> (**Player ${initiativePlayerNum}**) chose the **${zone}** deployment zone`,
      { allowedMentions: { users: [game.initiativePlayerId] }, phase: 'INITIATIVE', icon: 'zone' }
    );
  }

  // Auto-deploy figures
  const mapId = game.selectedMap?.id;
  const zones = mapId ? deploymentZones[mapId] : null;
  if (!zones) throw new Error('Deployment zones not found for selected map.');
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[1]) game.figurePositions[1] = {};
  if (!game.figurePositions[2]) game.figurePositions[2] = {};
  game.figureOrientations = game.figureOrientations || {};

  const deployForPlayer = (playerNum, zone) => {
    const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
    const dcList = squad?.dcList || [];
    const { metadata } = getDeployFigureLabels(dcList);
    for (const meta of metadata) {
      const figureKey = `${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`;
      const occupied = [];
      for (const p of [1, 2]) {
        for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
          const dcName = k.split('-')[0];
          const size = game.figureOrientations?.[k] || getFigureSize(dcName);
          occupied.push(...getFootprintCells(s, size));
        }
      }
      const baseSize = getFigureSize(meta.dcName);
      const size = baseSize === '2x3' ? (Math.random() < 0.5 ? '2x3' : '3x2') : baseSize;
      const zoneSpaces = (zones?.[zone] || []).map((s) => String(s).toLowerCase());
      const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, size);
      if (!validSpaces.length) throw new Error(`No valid deploy spaces for ${meta.dcName} in ${zone} zone.`);
      const space = validSpaces[Math.floor(Math.random() * validSpaces.length)];
      game.figurePositions[playerNum][figureKey] = space;
      if (baseSize === '2x3') {
        game.figureOrientations[figureKey] = size;
      }
    }
  };

  const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const nonInitiativePlayerNum = initiativePlayerNum === 1 ? 2 : 1;
  const zone = game.deploymentZoneChosen;
  const otherZone = zone === 'red' ? 'blue' : 'red';
  deployForPlayer(initiativePlayerNum, zone);
  deployForPlayer(nonInitiativePlayerNum, otherZone);

  game.initiativePlayerDeployed = true;
  game.nonInitiativePlayerDeployed = true;
  game.currentRound = 1;

  if (game.boardId && game.selectedMap) {
    const boardChannel = await client.channels.fetch(game.boardId);
    const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
    await boardChannel.send(payload);
  }

  // Shuffle + draw starting 3 CCs
  const drawStartingHand = async (playerNum) => {
    const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
    const ccList = squad?.ccList || [];
    const deck = [...ccList];
    shuffleArray(deck);
    const hand = deck.splice(0, 3);
    const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const drawnKey = playerNum === 1 ? 'player1CcDrawn' : 'player2CcDrawn';
    game[deckKey] = deck;
    game[handKey] = hand;
    game[drawnKey] = true;
    const handChannelId = playerNum === 1 ? game.p1HandId : game.p2HandId;
    const handChannel = await client.channels.fetch(handChannelId);
    const existingMsgs = await handChannel.messages.fetch({ limit: 5 });
    if (existingMsgs.size === 0) {
      const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
      await handChannel.send({
        content: `<@${playerId}>, this is your hand.`,
        embeds: [getHandTooltipEmbed(game, playerNum)],
        allowedMentions: { users: [playerId] },
      });
    }
    const handPayload = buildHandDisplayPayload(hand, deck, game.gameId, game, playerNum);
    await handChannel.send({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    });
    await updateHandVisualMessage(game, playerNum, client);
  };
  await drawStartingHand(1);
  await drawStartingHand(2);

  await logGameAction(game, client, '**Draft Random** — Auto-deployed all figures and drew starting CCs.', { phase: 'DEPLOYMENT', icon: 'deployed' });

  game.startOfRoundWhoseTurn = game.initiativePlayerId;
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const otherId = game.initiativePlayerId === game.player1Id ? game.player2Id : game.player1Id;
  await logGameAction(game, client, `**Start of Round** — 1. Mission Rules/Effects (resolve as needed). 2. <@${game.initiativePlayerId}> (Initiative). 3. <@${otherId}>. 4. Go. Initiative player: play any start-of-round effects/CCs, then click **End 'Start of Round' window** in your Hand.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [game.initiativePlayerId] } });
  const roundEmbed = new EmbedBuilder()
    .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND 1 — Start of Round window`)
    .setDescription(`1. Mission Rules/Effects 2. <@${game.initiativePlayerId}> (Initiative) 3. <@${otherId}> 4. Go. Both must click **End 'Start of Round' window** in their Hand.`)
    .setColor(PHASE_COLOR);
  await generalChannel.send({
    content: `**Start of Round** — <@${game.initiativePlayerId}> (Player ${initPlayerNum}), play any start-of-round effects/CCs, then click **End 'Start of Round' window** in your Hand.`,
    embeds: [roundEmbed],
    allowedMentions: { users: [game.initiativePlayerId] },
  });
  game.roundActivationMessageId = null;
  game.roundActivationButtonShown = false;
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  await clearPreGameSetup(game, client);
  await updateHandChannelMessages(game, client);
  saveGames();
}

function pushUndo(game, entry) {
  game.undoStack = game.undoStack || [];
  game.undoStack.push({ ...entry, ts: Date.now() });
  if (game.undoStack.length > 50) game.undoStack.shift();
}

function getSquadSelectEmbed(playerNum, squad) {
  const embed = new EmbedBuilder()
    .setTitle(`Player ${playerNum} – Deck Selection`)
    .setDescription(
      squad
        ? `**Squad:** ${squad.name}\n**Deployment Cards:** ${squad.dcCount ?? '—'} cards\n**Command Cards:** ${squad.ccCount ?? '—'} cards\n\n✓ Squad submitted.`
        : 'Submit your squad using any of these methods:\n' +
          '1. **Select Squad** — fill out the form\n' +
          '2. **Upload a .vsav file** — export from [IACP List Builder](https://iacp-list-builder.onrender.com/)\n' +
          '3. **Copy-paste your list** — from the IACP builder, press the **Share** button and paste the full list below'
    )
    .setColor(0x2f3136);
  return embed;
}

/** Resolve DC name to DC card image path (for deployment card embeds). Looks in dc-figures/ or dc-figureless/ first, then root. */
function getDcImagePath(dcName) {
  if (!dcName || typeof dcName !== 'string') return null;
  const exact = dcImages[dcName];
  if (exact) return resolveDcImagePath(exact, dcName);
  const trimmed = dcName.trim();
  if (!/^\[.+\]$/.test(trimmed) && dcImages[`[${trimmed}]`]) return resolveDcImagePath(dcImages[`[${trimmed}]`], `[${trimmed}]`);
  const lower = dcName.toLowerCase();
  let key = Object.keys(dcImages).find((k) => k.toLowerCase() === lower);
  if (key) return resolveDcImagePath(dcImages[key], key);
  const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  if (base !== dcName) {
    key = Object.keys(dcImages).find((k) => k.toLowerCase() === base.toLowerCase());
    if (key) return resolveDcImagePath(dcImages[key], key);
    key = Object.keys(dcImages).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
    if (key) return resolveDcImagePath(dcImages[key], key);
  }
  key = Object.keys(dcImages).find((k) => k.toLowerCase().startsWith(lower) || lower.startsWith(k.toLowerCase()));
  return key ? resolveDcImagePath(dcImages[key], key) : null;
}

/** Prefer dc-figures/ or dc-figureless/ subfolder over root for a given dc-images path. */
function resolveDcImagePath(relPath, dcName) {
  if (!relPath || typeof relPath !== 'string') return null;
  const filename = relPath.split(/[/\\]/).pop() || relPath;
  const subfolder = dcName && isFigurelessDc(dcName) ? 'dc-figureless' : 'dc-figures';
  const inSub = `vassal_extracted/images/${subfolder}/${filename}`;
  if (existsSync(join(rootDir, inSub))) return inSub;
  const otherSub = subfolder === 'dc-figures' ? 'dc-figureless' : 'dc-figures';
  const inOther = `vassal_extracted/images/${otherSub}/${filename}`;
  if (existsSync(join(rootDir, inOther))) return inOther;
  if (existsSync(join(rootDir, relPath))) return relPath;
  return relPath;
}

/** Get figure base size (1x1, 1x2, 2x2, 2x3) for map rendering. Default 1x1. */
function getFigureSize(dcName) {
  const exact = figureSizes[dcName];
  if (exact) return exact;
  const lower = dcName?.toLowerCase?.() || '';
  const key = Object.keys(figureSizes).find((k) => k.toLowerCase() === lower);
  if (key) return figureSizes[key];
  const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const key2 = Object.keys(figureSizes).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
  return key2 ? figureSizes[key2] : '1x1';
}

/** Resolve DC name to circular figure image (for map tokens). Tries figures/ subfolder first, then root. */
function getFigureImagePath(dcName) {
  if (!dcName || typeof dcName !== 'string') return null;
  const exact = figureImages[dcName];
  if (exact) return resolveAssetPath(exact, 'figures');
  const lower = dcName.toLowerCase();
  let key = Object.keys(figureImages).find((k) => k.toLowerCase() === lower);
  if (key) return resolveAssetPath(figureImages[key], 'figures');
  const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  if (base !== dcName) {
    key = Object.keys(figureImages).find((k) => k.toLowerCase() === base.toLowerCase());
    if (key) return resolveAssetPath(figureImages[key], 'figures');
    key = Object.keys(figureImages).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
    if (key) return resolveAssetPath(figureImages[key], 'figures');
  }
  key = Object.keys(figureImages).find((k) => k.toLowerCase().startsWith(lower) || lower.startsWith(k.toLowerCase()));
  return key ? resolveAssetPath(figureImages[key], 'figures') : null;
}

/** Try subfolder first, then root. relPath is e.g. "vassal_extracted/images/X.gif". */
function resolveAssetPath(relPath, subfolder) {
  if (!relPath || typeof relPath !== 'string') return null;
  const filename = relPath.split(/[/\\]/).pop() || relPath;
  const inSub = `vassal_extracted/images/${subfolder}/${filename}`;
  if (existsSync(join(rootDir, inSub))) return inSub;
  if (existsSync(join(rootDir, relPath))) return relPath;
  return relPath;
}

function rollAttackDice(diceColors) {
  let acc = 0, dmg = 0, surge = 0;
  for (const color of diceColors || []) {
    const faces = diceData.attack?.[color.toLowerCase()];
    if (!faces?.length) continue;
    const face = faces[Math.floor(Math.random() * faces.length)];
    acc += face.acc ?? 0;
    dmg += face.dmg ?? 0;
    surge += face.surge ?? 0;
  }
  return { acc, dmg, surge };
}

function rollDefenseDice(defenseType) {
  const faces = diceData.defense?.[(defenseType || 'white').toLowerCase()];
  if (!faces?.length) return { block: 0, evade: 0 };
  const face = faces[Math.floor(Math.random() * faces.length)];
  return { block: face.block ?? 0, evade: face.evade ?? 0 };
}

/** Find msgId for DC message containing the given figure (for dcHealthState lookup). */
function findDcMessageIdForFigure(gameId, playerNum, figureKey) {
  const m = figureKey.match(/^(.+)-(\d+)-(\d+)$/);
  const dcName = m ? m[1] : figureKey;
  const dgIndex = m ? m[2] : '1';
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId || meta.playerNum !== playerNum) continue;
    const dn = (meta.displayName || '').match(/\[Group (\d+)\]/);
    if (meta.dcName === dcName && dn && String(dn[1]) === String(dgIndex)) return msgId;
  }
  return null;
}

/** DCs in brackets (e.g. [Zillo Technique], [Extra Armor]) are upgrades with no figure; no health, no deployment. */
function isFigurelessDc(dcName) {
  if (!dcName || typeof dcName !== 'string') return false;
  const n = dcName.trim();
  if (!n) return false;
  if (/^\[.+\]$/.test(n)) return true;
  if (dcImages[`[${n}]`]) return true;
  return Object.keys(dcImages).some((k) => /^\[.+\]$/.test(k) && (k.slice(1, -1) === n || k === n));
}

function getDcStats(dcName) {
  const exact = dcStats[dcName];
  if (exact) return { ...exact, figures: isFigurelessDc(dcName) ? 0 : (exact.figures ?? 1) };
  const lower = dcName?.toLowerCase?.() || '';
  const key = Object.keys(dcStats).find((k) => k.toLowerCase() === lower);
  if (key) {
    const base = dcStats[key];
    return { ...base, figures: isFigurelessDc(dcName) ? 0 : (base.figures ?? 1) };
  }
  return { health: null, figures: isFigurelessDc(dcName) ? 0 : 1, specials: [] };
}

const DC_ACTIONS_PER_ACTIVATION = 2;

/** Returns "X/2 Actions Remaining" with green/red square visual (🟩=remaining, 🟥=used). */
function getActionsCounterContent(remaining, total = DC_ACTIONS_PER_ACTIVATION) {
  const r = Math.max(0, Math.min(remaining, total));
  const used = total - r;
  const green = '🟩'.repeat(r);
  const red = '🟥'.repeat(used);
  return `**Actions** • ${r}/${total} ${green}${red}`;
}

/** True if any DC in this game has actions remaining to spend. */
function hasActionsRemainingInGame(game, gameId) {
  for (const [mid, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    const data = game.dcActionsData?.[mid];
    if (data?.remaining > 0) return true;
  }
  return false;
}

/** True when both players have no readied DCs and no actions left to spend in any activated DC. */
function shouldShowEndActivationPhaseButton(game, gameId) {
  const r1 = game.p1ActivationsRemaining ?? 0;
  const r2 = game.p2ActivationsRemaining ?? 0;
  if (r1 > 0 || r2 > 0) return false;
  if (hasActionsRemainingInGame(game, gameId)) return false;
  return true;
}

/** Edit the round message to add the End Activation Phase button when conditions are met. */
async function maybeShowEndActivationPhaseButton(game, client) {
  const gameId = game.gameId;
  if (!shouldShowEndActivationPhaseButton(game, gameId)) return;
  if (game.roundActivationButtonShown) return;
  const roundMsgId = game.roundActivationMessageId;
  if (!roundMsgId || !game.generalId) return;
  try {
    const ch = await client.channels.fetch(game.generalId);
    const msg = await ch.messages.fetch(roundMsgId);
    const round = game.currentRound || 1;
    const roundEmbed = new EmbedBuilder()
      .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${round}`)
      .setColor(PHASE_COLOR);
    const endBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${round} Activation Phase`)
        .setStyle(ButtonStyle.Secondary)
    );
    const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    await msg.edit({
      content: `<@${game.initiativePlayerId}> (**Player ${initPlayerNum}**) **Round ${round}** — Both players have used all activations and actions. Both players: click **End R${round} Activation Phase** when done with any end-of-activation effects.`,
      embeds: [roundEmbed],
      components: [endBtn],
      allowedMentions: { users: [game.initiativePlayerId] },
    }).catch(() => {});
    game.roundActivationButtonShown = true;
    saveGames();
  } catch (err) {
    console.error('Failed to show End Activation Phase button:', err);
  }
}

/** Update the DC thread's Actions message with current counter. If all actions exhausted, @ the other player to activate. */
async function updateDcActionsMessage(game, msgId, client) {
  const data = game.dcActionsData?.[msgId];
  if (!data?.threadId) return;
  const meta = dcMessageMeta.get(msgId);
  const displayName = meta?.displayName || meta?.dcName || '';

  if (data?.messageId) {
    try {
      const thread = await client.channels.fetch(data.threadId);
      const msg = await thread.messages.fetch(data.messageId);
      const components = meta && game ? getDcActionButtons(msgId, meta.dcName, displayName, data.remaining, game) : [];
      await msg.edit({
        content: getActionsCounterContent(data.remaining, data.total),
        components,
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to update DC actions message:', err);
    }
  }

  if (data?.remaining === 0 && meta) {
    game.dcFinishedPinged = game.dcFinishedPinged || {};
    game.pendingEndTurn = game.pendingEndTurn || {};
    if (!game.dcFinishedPinged[msgId] && !game.pendingEndTurn[msgId]) {
      const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
      const initPlayerNum = meta.playerNum;
      try {
        const ch = await client.channels.fetch(game.generalId);
        const icon = ACTION_ICONS.activate || '⚡';
        const timestamp = `<t:${Math.floor(Date.now() / 1000)}:t>`;
        const endTurnBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`end_turn_${game.gameId}_${msgId}`)
            .setLabel('End Turn')
            .setStyle(ButtonStyle.Primary)
        );
        const endTurnMsg = await ch.send({
          content: `${icon} ${timestamp} — <@${ownerId}> (**Player ${initPlayerNum}**) **${displayName}** finished all actions. Press **End Turn** when ready to pass the turn.`,
          components: [endTurnBtn],
          allowedMentions: { users: [ownerId] },
        });
        game.pendingEndTurn[msgId] = { playerNum: meta.playerNum, displayName, messageId: endTurnMsg.id };
      } catch (err) {
        console.error('Failed to send End Turn prompt:', err);
      }
    }
    await maybeShowEndActivationPhaseButton(game, client);
  }
}

/** Returns action rows: one [Move][Attack][Interact] row per figure, plus specials. Max 5 rows. */
function getDcActionButtons(msgId, dcName, displayName, actionsRemaining = 2, game = null) {
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  const specials = stats.specials || [];
  const dgIndex = displayName?.match(/\[Group (\d+)\]/)?.[1] ?? 1;
  const noActions = (actionsRemaining ?? 2) <= 0;
  const playerNum = game ? (dcMessageMeta.get(msgId)?.playerNum ?? 1) : 1;
  const rows = [];
  for (let f = 0; f < figures && rows.length < 5; f++) {
    const suffix = figures <= 1 ? '' : ` ${dgIndex}${FIGURE_LETTERS[f]}`;
    const figureKey = `${dcName}-${dgIndex}-${f}`;
    const comps = [
      new ButtonBuilder().setCustomId(`dc_move_${msgId}_f${f}`).setLabel(`Move${suffix}`).setStyle(ButtonStyle.Success).setDisabled(noActions),
      new ButtonBuilder().setCustomId(`dc_attack_${msgId}_f${f}`).setLabel(`Attack${suffix}`).setStyle(ButtonStyle.Danger).setDisabled(noActions),
      new ButtonBuilder().setCustomId(`dc_interact_${msgId}_f${f}`).setLabel(`Interact${suffix}`).setStyle(ButtonStyle.Secondary).setDisabled(noActions),
    ];
    rows.push(new ActionRowBuilder().addComponents(...comps));
  }
  if (specials.length > 0 && rows.length < 5) {
    const specialBtns = specials.slice(0, 5).map((name, idx) =>
      new ButtonBuilder()
        .setCustomId(`dc_special_${idx}_${msgId}`)
        .setLabel(name.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(noActions)
    );
    rows.push(new ActionRowBuilder().addComponents(...specialBtns));
  }
  return rows;
}

function formatHealthSection(dgIndex, healthState) {
  if (!healthState?.length) return 'Health\n—/—';
  const labels = 'abcdefghij';
  const lines = healthState.map(([cur, max], i) => {
    const c = cur != null ? cur : (max != null ? max : '?');
    const m = max != null ? max : '?';
    if (healthState.length === 1) return `${c}/${m}`;
    return `${dgIndex}${labels[i]}: ${c}/${m}`;
  });
  return `Health\n${lines.join('\n')}`;
}

function getDcToggleButton(msgId, exhausted) {
  if (exhausted) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dc_unactivate_${msgId}`)
        .setLabel('Un-activate')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`dc_toggle_${msgId}`)
        .setLabel('Ready')
        .setStyle(ButtonStyle.Success)
    );
  }
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dc_toggle_${msgId}`)
      .setLabel('Activate')
      .setStyle(ButtonStyle.Success)
  );
}

/** True if all figures in this deployment group are defeated (or never deployed). */
function isGroupDefeated(game, playerNum, dcIndex) {
  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const dc = dcList[dcIndex];
  if (!dc) return true;
  const dcName = dc.dcName || dc;
  const displayName = typeof dc === 'object' ? dc.displayName : dcName;
  const dgMatch = displayName?.match(/\[Group (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const stats = getDcStats(dcName);
  const figureCount = stats.figures ?? 1;
  const poses = game.figurePositions?.[playerNum] || {};
  for (let f = 0; f < figureCount; f++) {
    const figureKey = `${dcName}-${dgIndex}-${f}`;
    if (figureKey in poses) return false;
  }
  return true;
}

/** Returns ActionRow(s) for Activate buttons (DCs not yet activated). Includes Pass turn to opponent when other has more activations. */
function getActivateDcButtons(game, playerNum) {
  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const activated = playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
  const activatedSet = new Set(activated);
  const gameId = game.gameId;
  const btns = [];
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    const dcName = resolveDcName(dc);
    if (isFigurelessDc(dcName)) continue;
    if (activatedSet.has(i)) continue;
    if (isGroupDefeated(game, playerNum, i)) continue;
    const displayName = dc?.displayName || dcName;
    const fullLabel = `Activate ${displayName}`;
    const label = fullLabel.length > 80 ? fullLabel.slice(0, 77) + '…' : fullLabel;
    btns.push(new ButtonBuilder()
      .setCustomId(`dc_activate_${gameId}_${playerNum}_${i}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Success));
  }
  const rows = [];
  for (let r = 0; r < btns.length; r += 5) {
    rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
  }
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
  const myRemaining = playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const otherRemaining = playerNum === 1 ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
  if (turnPlayerId === playerId && otherRemaining > myRemaining && myRemaining > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pass_activation_turn_${gameId}`)
        .setLabel('Pass turn to opponent')
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  return rows;
}

async function buildDcEmbedAndFiles(dcName, exhausted, displayName, healthState) {
  const status = exhausted ? 'EXHAUSTED' : 'READIED';
  const color = exhausted ? 0xed4245 : 0x57f287; // red : green
  const figureless = isFigurelessDc(dcName);
  const dgIndex = displayName.match(/\[Group (\d+)\]/)?.[1] ?? 1;
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  const variant = dcName?.includes('(Elite)') ? 'Elite' : dcName?.includes('(Regular)') ? 'Regular' : null;
  const healthSection = figureless ? null : formatHealthSection(Number(dgIndex), healthState);
  const lines = figureless
    ? [variant ? `**Variant:** ${variant}` : null].filter(Boolean)
    : [
        `**Figures:** ${figures}`,
        variant ? `**Variant:** ${variant}` : null,
        '',
        healthSection,
      ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setTitle(`${status} — ${displayName}`)
    .setDescription(lines.length ? lines.join('\n') : '*Upgrade — no figure*')
    .setColor(color);

  let files = [];
  const imagePath = getDcImagePath(dcName?.trim());
  if (imagePath) {
    const fullPath = join(rootDir, imagePath);
    if (existsSync(fullPath)) {
      const attachName = 'dc-thumb.png';
      if (exhausted) {
        const buffer = await rotateImage90(imagePath);
        if (buffer) {
          files.push(new AttachmentBuilder(buffer, { name: attachName }));
          embed.setThumbnail(`attachment://${attachName}`);
        } else {
          files.push(new AttachmentBuilder(fullPath, { name: attachName }));
          embed.setThumbnail(`attachment://${attachName}`);
        }
      } else {
        const ext = imagePath.split('.').pop() || 'png';
        const name = `dc-thumb.${ext}`;
        files.push(new AttachmentBuilder(fullPath, { name }));
        embed.setThumbnail(`attachment://${name}`);
      }
    }
  }
  return { embed, files };
}

/** Card-back character (vertical rectangle) for hand visual. */
const CARD_BACK_CHAR = '▮';

/** Tooltip embed at top of Play Area: player, CC count, DC list. */
function getPlayAreaTooltipEmbed(game, playerNum) {
  const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
  const deckCount = (playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || [])).length;
  const dcList = playerNum === 1 ? (game.p1DcList || game.player1Squad?.dcList || []) : (game.p2DcList || game.player2Squad?.dcList || []);
  const dcNames = Array.isArray(dcList) ? dcList.map((d) => (typeof d === 'object' ? d.dcName || d.displayName : d)).filter(Boolean) : [];
  const dcText = dcNames.length > 0 ? dcNames.join(', ') : '—';
  return new EmbedBuilder()
    .setTitle(`This is Player ${playerNum}'s Play Area`)
    .setDescription(
      `**Player:** <@${playerId}>\n` +
      `**Command Cards in Deck:** ${deckCount}\n` +
      `**Deployment Cards:** ${dcText}`
    )
    .setColor(0x5865f2);
}

/** Tooltip embed for Hand channel: explains the private hand. */
function getHandTooltipEmbed(game, playerNum) {
  return new EmbedBuilder()
    .setTitle('Your Hand')
    .setDescription(
      'Your private channel for **Command Cards** and squad selection. Only you can see this channel.\n\n' +
      '• Select your squad below (form), **upload a .vsav file**, or **copy-paste** your list from the IACP builder Share button\n' +
      '• During the game, your hand is shown here — played cards will show up in the **Game Log**'
    )
    .setColor(0x5865f2);
}

/** Returns embed showing command cards in hand as card backs (e.g. ▮▮▮ for 3 cards). */
function getHandVisualEmbed(handCount) {
  const count = Math.max(0, handCount ?? 0);
  const cards = CARD_BACK_CHAR.repeat(count) || '—';
  return new EmbedBuilder()
    .setTitle('Command Cards in Hand')
    .setDescription(`**${count}** cards\n${cards}`)
    .setColor(0x2f3136);
}

/** Returns embed showing discard pile count (card backs). */
function getDiscardPileEmbed(discardCount) {
  const count = Math.max(0, discardCount ?? 0);
  const cards = CARD_BACK_CHAR.repeat(count) || '—';
  return new EmbedBuilder()
    .setTitle('Command Cards in Discard Pile')
    .setDescription(`**${count}** cards\n${cards}`)
    .setColor(0x2f3136);
}

/** Search (blue) and Close (red) buttons for discard pile. */
function getDiscardPileButtons(gameId, playerNum, hasOpenThread) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cc_search_discard_${gameId}_${playerNum}`)
      .setLabel('Search Discard Pile')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cc_close_discard_${gameId}_${playerNum}`)
      .setLabel('Close Discard Pile')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasOpenThread)
  );
}

const EMBEDS_PER_MESSAGE = 10;

/** Build discard pile display for thread (embeds with card images, like hand view). Returns array of { embeds, files } for chunked sends. */
function buildDiscardPileDisplayPayload(discard) {
  const cardData = [];
  for (let i = 0; i < discard.length; i++) {
    const card = discard[i];
    const path = getCommandCardImagePath(card);
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `cc-discard-${i}-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(card || `Card ${i + 1}`)
      .setColor(0x2f3136);
    let file = null;
    if (path && existsSync(path)) {
      file = new AttachmentBuilder(path, { name: fileName });
      embed.setThumbnail(`attachment://${fileName}`);
    }
    cardData.push({ embed, file });
  }
  const header = new EmbedBuilder()
    .setTitle('Command Cards in Discard Pile')
    .setDescription(`**${discard.length}** cards discarded`)
    .setColor(0x2f3136);
  const chunks = [];
  let embeds = [header];
  let files = [];
  for (let i = 0; i < cardData.length; i++) {
    if (embeds.length >= EMBEDS_PER_MESSAGE) {
      chunks.push({ embeds, files: files.length > 0 ? files : undefined });
      embeds = [];
      files = [];
    }
    embeds.push(cardData[i].embed);
    if (cardData[i].file) files.push(cardData[i].file);
  }
  if (embeds.length > 0) chunks.push({ embeds, files: files.length > 0 ? files : undefined });
  return chunks;
}

/** Update both Hand channel messages (for window buttons). Call when entering/exiting Start or End of Round window. */
async function updateHandChannelMessages(game, client) {
  for (const pn of [1, 2]) {
    const hand = pn === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
    const deck = pn === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
    const handId = pn === 1 ? game.p1HandId : game.p2HandId;
    if (!handId) continue;
    try {
      const handCh = await client.channels.fetch(handId);
      const msgs = await handCh.messages.fetch({ limit: 20 });
      const handMsg = msgs.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      if (handMsg) {
        const payload = buildHandDisplayPayload(hand, deck, game.gameId, game, pn);
        await handMsg.edit({ content: payload.content, embeds: payload.embeds, files: payload.files || [], components: payload.components }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to update hand channel message:', err);
    }
  }
}

/** Call after changing player1CcHand/player2CcHand to refresh the Play Area hand visual. */
async function updateHandVisualMessage(game, playerNum, client) {
  const msgId = playerNum === 1 ? game.p1HandVisualMessageId : game.p2HandVisualMessageId;
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  if (msgId == null) return;
  try {
    const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(msgId);
    await msg.edit({ embeds: [getHandVisualEmbed(hand.length)] });
  } catch (err) {
    console.error('Failed to update hand visual message:', err);
  }
}

/** Green = remaining, red = used. Returns e.g. "**Activations:** 🟢🟢🟢🔴 (3/4 remaining)" */
function getActivationsLine(remaining, total) {
  const green = '🟢';
  const red = '🔴';
  const used = Math.max(0, total - remaining);
  const circles = green.repeat(remaining) + red.repeat(used);
  return `**Activations:** ${circles} (${remaining}/${total} remaining)`;
}

/** Call after changing discard pile to refresh the Play Area discard embed and buttons. */
async function updateDiscardPileMessage(game, playerNum, client) {
  const msgId = playerNum === 1 ? game.p1DiscardPileMessageId : game.p2DiscardPileMessageId;
  if (msgId == null) return;
  const discard = playerNum === 1 ? (game.player1CcDiscard || []) : (game.player2CcDiscard || []);
  const threadId = playerNum === 1 ? game.p1DiscardThreadId : game.p2DiscardThreadId;
  const hasOpenThread = !!threadId;
  try {
    const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(msgId);
    await msg.edit({
      embeds: [getDiscardPileEmbed(discard.length)],
      components: [getDiscardPileButtons(game.gameId, playerNum, hasOpenThread)],
    });
  } catch (err) {
    console.error('Failed to update discard pile message:', err);
  }
}

/** Call after changing game.p1ActivationsRemaining or game.p2ActivationsRemaining to refresh the Play Area header. */
async function updateActivationsMessage(game, playerNum, client) {
  const msgId = playerNum === 1 ? game.p1ActivationsMessageId : game.p2ActivationsMessageId;
  const remaining = playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
  const total = playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
  if (msgId == null || total === 0) return;
  try {
    const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(msgId);
    await msg.edit(getActivationsLine(remaining, total));
  } catch (err) {
    console.error('Failed to update activations message:', err);
  }
}

async function populatePlayAreas(game, client) {
  const p1PlayArea = await client.channels.fetch(game.p1PlayAreaId);
  const p2PlayArea = await client.channels.fetch(game.p2PlayAreaId);
  const gameId = game.gameId;

  const p1FigureDcs = (game.player1Squad?.dcList || []).filter((d) => !isFigurelessDc(resolveDcName(d)));
  const p2FigureDcs = (game.player2Squad?.dcList || []).filter((d) => !isFigurelessDc(resolveDcName(d)));
  const p1Total = p1FigureDcs.length || game.player1Squad?.dcCount || 0;
  const p2Total = p2FigureDcs.length || game.player2Squad?.dcCount || 0;
  game.p1ActivationsTotal = p1Total;
  game.p2ActivationsTotal = p2Total;
  game.p1ActivationsRemaining = p1Total;
  game.p2ActivationsRemaining = p2Total;

  const processDcList = (dcList) => {
    const counts = {};
    const totals = {};
    for (const d of dcList) {
      const n = resolveDcName(d);
      if (n) totals[n] = (totals[n] || 0) + 1;
    }
    return dcList.map((entry) => {
      const dcName = resolveDcName(entry);
      counts[dcName] = (counts[dcName] || 0) + 1;
      const dgIndex = counts[dcName];
      const displayName = totals[dcName] > 1 ? `${dcName} [Group ${dgIndex}]` : dcName;
      const stats = getDcStats(dcName);
      const figureless = isFigurelessDc(dcName);
      const health = figureless ? null : (stats.health ?? '?');
      const figures = figureless ? 0 : (stats.figures ?? 1);
      const healthState = figureless ? [] : Array.from({ length: figures }, () => [health, health]);
      return { dcName, displayName, healthState };
    });
  };

  const p1Dcs = processDcList(game.player1Squad.dcList || []);
  const p2Dcs = processDcList(game.player2Squad.dcList || []);
  game.p1DcList = p1Dcs;
  game.p2DcList = p2Dcs;
  game.p1ActivatedDcIndices = game.p1ActivatedDcIndices || [];
  game.p2ActivatedDcIndices = game.p2ActivatedDcIndices || [];
  game.p1DcMessageIds = [];
  game.p2DcMessageIds = [];

  // Tooltip embeds at top of each Play Area
  await p1PlayArea.send({ embeds: [getPlayAreaTooltipEmbed(game, 1)] });
  await p2PlayArea.send({ embeds: [getPlayAreaTooltipEmbed(game, 2)] });

  const p1HandCount = (game.player1CcHand || []).length;
  const p2HandCount = (game.player2CcHand || []).length;
  const p1HandVisualMsg = await p1PlayArea.send({ embeds: [getHandVisualEmbed(p1HandCount)] });
  const p2HandVisualMsg = await p2PlayArea.send({ embeds: [getHandVisualEmbed(p2HandCount)] });
  game.p1HandVisualMessageId = p1HandVisualMsg.id;
  game.p2HandVisualMessageId = p2HandVisualMsg.id;

  const p1DiscardCount = (game.player1CcDiscard || []).length;
  const p2DiscardCount = (game.player2CcDiscard || []).length;
  const p1DiscardMsg = await p1PlayArea.send({
    embeds: [getDiscardPileEmbed(p1DiscardCount)],
    components: [getDiscardPileButtons(gameId, 1, false)],
  });
  const p2DiscardMsg = await p2PlayArea.send({
    embeds: [getDiscardPileEmbed(p2DiscardCount)],
    components: [getDiscardPileButtons(gameId, 2, false)],
  });
  game.p1DiscardPileMessageId = p1DiscardMsg.id;
  game.p2DiscardPileMessageId = p2DiscardMsg.id;

  const p1ActivationsMsg = await p1PlayArea.send(getActivationsLine(p1Total, p1Total));
  const p2ActivationsMsg = await p2PlayArea.send(getActivationsLine(p2Total, p2Total));
  game.p1ActivationsMessageId = p1ActivationsMsg.id;
  game.p2ActivationsMessageId = p2ActivationsMsg.id;

  for (const { dcName, displayName, healthState } of p1Dcs) {
    const { embed, files } = await buildDcEmbedAndFiles(dcName, false, displayName, healthState);
    const msg = await p1PlayArea.send({ embeds: [embed], files });
    dcMessageMeta.set(msg.id, { gameId, playerNum: 1, dcName, displayName });
    dcExhaustedState.set(msg.id, false);
    dcHealthState.set(msg.id, healthState);
    await msg.edit({ components: [getDcToggleButton(msg.id, false)] });
    game.p1DcMessageIds.push(msg.id);
  }
  for (const { dcName, displayName, healthState } of p2Dcs) {
    const { embed, files } = await buildDcEmbedAndFiles(dcName, false, displayName, healthState);
    const msg = await p2PlayArea.send({ embeds: [embed], files });
    dcMessageMeta.set(msg.id, { gameId, playerNum: 2, dcName, displayName });
    dcExhaustedState.set(msg.id, false);
    dcHealthState.set(msg.id, healthState);
    await msg.edit({ components: [getDcToggleButton(msg.id, false)] });
    game.p2DcMessageIds.push(msg.id);
  }

}

async function applySquadSubmission(game, isP1, squad, client) {
  if (isP1) game.player1Squad = squad;
  else game.player2Squad = squad;
  const playerId = isP1 ? game.player1Id : game.player2Id;
  const playerNum = isP1 ? 1 : 2;
  await logGameAction(game, client, `<@${playerId}> submitted squad **${squad.name || 'Unnamed'}** (${squad.dcCount ?? 0} DCs, ${squad.ccCount ?? 0} CCs)`, { allowedMentions: { users: [playerId] }, phase: 'SETUP', icon: 'squad' });
  const handChannelId = isP1 ? game.p1HandId : game.p2HandId;
  const handChannel = await client.channels.fetch(handChannelId);
  const handMessages = await handChannel.messages.fetch({ limit: 10 });
  const botMsg = handMessages.find((m) => m.author.bot && m.components.length > 0);
  if (botMsg) {
    await botMsg.edit({
      embeds: [getHandTooltipEmbed(game, isP1 ? 1 : 2), getSquadSelectEmbed(isP1 ? 1 : 2, squad)],
      components: [],
    });
  }
  const generalChannel = await client.channels.fetch(game.generalId);
  const bothReady = game.player1Squad && game.player2Squad && !game.bothReadyPosted;
  if (bothReady) {
    game.bothReadyPosted = true;
    try {
      if (!game.p1PlayAreaId || !game.p2PlayAreaId) {
        const guild = generalChannel.guild;
        const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
        const prefix = `IA${game.gameId}`;
        const { p1PlayAreaChannel, p2PlayAreaChannel } = await createPlayAreaChannels(
          guild, gameCategory, prefix, game.player1Id, game.player2Id
        );
        game.p1PlayAreaId = p1PlayAreaChannel.id;
        game.p2PlayAreaId = p2PlayAreaChannel.id;
      }
      await populatePlayAreas(game, client);
    } catch (err) {
      console.error('Failed to create/populate Play Areas:', err);
    }
    const bothReadyMsg = await generalChannel.send({
      content: `<@${game.player1Id}> <@${game.player2Id}> — Both squads are ready! Determine initiative below.`,
      allowedMentions: { users: [...new Set([game.player1Id, game.player2Id])] },
      embeds: [
        new EmbedBuilder()
          .setTitle('Both Squads Ready')
          .setDescription(
            `**Player 1:** ${game.player1Squad.name || 'Unnamed'} (${game.player1Squad.dcCount} DCs, ${game.player1Squad.ccCount} CCs)\n` +
              `**Player 2:** ${game.player2Squad.name || 'Unnamed'} (${game.player2Squad.dcCount} DCs, ${game.player2Squad.ccCount} CCs)\n\n` +
              'Play Area channels have been populated with one thread per Deployment Card. Next: Determine Initiative.'
          )
          .setColor(0x57f287),
      ],
      components: [getDetermineInitiativeButtons(game)],
    });
    game.bothReadyMessageId = bothReadyMsg.id;
  }
  saveGames();
}

async function setupServer(guild) {
  const categories = {};
  for (const [key, name] of Object.entries(CATEGORIES)) {
    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === name
    );
    categories[key] =
      existing ||
      (await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
      }));
  }

  let forumChannel = null;
  for (const [key, config] of Object.entries(CHANNELS)) {
    const parent = categories[config.parent];
    const existing = guild.channels.cache.find(
      (c) => c.parentId === parent.id && c.name === config.name
    );
    if (!existing) {
      const created = await guild.channels.create({
        name: config.name,
        type: config.type,
        parent: parent.id,
        ...(config.type === ChannelType.GuildForum && config.name === 'new-games' && { availableTags: GAME_TAGS }),
      });
      if (config.type === ChannelType.GuildForum && config.name === 'new-games') forumChannel = created;
    } else if (config.type === ChannelType.GuildForum && config.name === 'new-games') {
      forumChannel = existing;
    }
  }

  if (forumChannel) {
    await forumChannel.setAvailableTags(GAME_TAGS);
  }

  return 'Server structure created: General, LFG (with #lfg chat + #new-games Forum with tags: Slow, Fast, Hyperspeed, Ranked), Games, Archived Games, Bot/Admin.';
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch();
      const hasLfg = guild.channels.cache.some(
        (c) => c.type === ChannelType.GuildText && c.name === 'lfg'
      );
      const hasNewGamesForum = guild.channels.cache.some(
        (c) => c.type === ChannelType.GuildForum && c.name === 'new-games'
      );
      if (!hasLfg || !hasNewGamesForum) {
        console.log(`Setting up server: ${guild.name}`);
        await setupServer(guild);
        console.log(`Setup complete for ${guild.name}`);
      } else {
        const forum = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildForum && c.name === 'new-games'
        );
        if (forum) {
          await forum.setAvailableTags(GAME_TAGS);
        }
        const adminCat = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORIES.admin
        );
        const hasRequestsForum = guild.channels.cache.some(
          (c) => c.type === ChannelType.GuildForum && c.name === 'requests-and-suggestions'
        );
        if (adminCat && !hasRequestsForum) {
          await guild.channels.create({
            name: 'requests-and-suggestions',
            type: ChannelType.GuildForum,
            parent: adminCat.id,
          });
        }
      }
    } catch (err) {
      console.error(`Setup failed for ${guild.name}:`, err);
    }
  }
});

/** Resolve/Reject buttons for requests-and-suggestions forum posts. Admin-only (checked on click). */
function getRequestActionButtons(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_resolve_${threadId}`)
      .setLabel('Resolve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`request_reject_${threadId}`)
      .setLabel('Reject')
      .setStyle(ButtonStyle.Danger),
  );
}

const requestsWithButtons = new Set();

// Forum posts: thread isn't messageable until the author sends their first message.
// So we set up the lobby on the first message in a new-games thread.
async function maybeSetupLobbyFromFirstMessage(message) {
  const thread = message.channel;
  if (!thread?.isThread?.()) return false;
  const parent = thread.parent;
  if (parent?.name !== 'new-games') return false;
  if (lobbies.has(thread.id)) return false;
  const creator = message.author.id;
  const lobby = { creatorId: creator, joinedId: null, status: 'LFG' };
  lobbies.set(thread.id, lobby);
  await thread.send({
    embeds: [getLobbyEmbed(lobby)],
    components: [getLobbyJoinButton(thread.id)],
  });
  await updateThreadName(thread, lobby);
  return true;
}

async function maybeAddRequestButtons(message) {
  const thread = message.channel;
  if (!thread?.isThread?.()) return false;
  const parent = thread.parent;
  if (parent?.name !== 'requests-and-suggestions') return false;
  if (requestsWithButtons.has(thread.id)) return false;
  requestsWithButtons.add(thread.id);
  await thread.send({
    content: 'Admins: mark this request as resolved or rejected.',
    components: [getRequestActionButtons(thread.id)],
  });
  return true;
}

client.on('messageCreate', async (message) => {
  try {
  if (message.author.bot) return;

  // Forum post first message: set up lobby buttons (thread isn't messageable until author posts)
  try {
    if (await maybeSetupLobbyFromFirstMessage(message)) return;
  } catch (err) {
    console.error('Lobby setup error:', err);
  }

  // Requests-and-suggestions: add Resolve/Reject buttons (admin-only on click)
  try {
    if (await maybeAddRequestButtons(message)) return;
  } catch (err) {
    console.error('Request buttons error:', err);
  }

  const content = message.content.toLowerCase().trim();

  if (content === 'testgame' && message.channel?.name === 'lfg') {
    const userId = message.author.id;
    const creatingMsg = await message.reply('Creating test game (you as both players)...');
    try {
      const guild = message.guild;
      const { gameId, generalChannel, chatChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel } =
        await createGameChannels(guild, userId, userId, { createPlayAreas: false, createHandChannels: false });
      const game = {
        gameId,
        gameCategoryId: generalChannel.parentId,
        player1Id: userId,
        player2Id: userId,
        generalId: generalChannel.id,
        chatId: chatChannel.id,
        boardId: boardChannel.id,
        p1HandId: p1HandChannel?.id ?? null,
        p2HandId: p2HandChannel?.id ?? null,
        p1PlayAreaId: p1PlayAreaChannel?.id ?? null,
        p2PlayAreaId: p2PlayAreaChannel?.id ?? null,
        player1Squad: null,
        player2Squad: null,
        player1VP: { total: 0, kills: 0, objectives: 0 },
        player2VP: { total: 0, kills: 0, objectives: 0 },
        isTestGame: true,
        ended: false,
      };
      games.set(gameId, game);

      const setupMsg = await generalChannel.send({
        content: `<@${userId}> — **Test game** created. You are both players. Map Selection below — Hand channels will appear after map selection. Use **General chat** for notes.`,
        allowedMentions: { users: [userId] },
        embeds: [
          new EmbedBuilder()
            .setTitle('Game Setup (Test)')
            .setDescription(
              '**Test game** — Select the map below. Hand channels will then appear; use them to pick decks (Select Squad or Default Rebels / Scum / Imperial) for each "side".'
            )
            .setColor(0x2f3136),
        ],
        components: [getGeneralSetupButtons(game)],
      });
      game.generalSetupMessageId = setupMsg.id;
      await creatingMsg.edit(`Test game **IA Game #${gameId}** is ready! Select the map in Game Log — Hand channels will appear after map selection.`);
      saveGames();
    } catch (err) {
      console.error('Test game creation error:', err);
      await creatingMsg.edit(`Failed to create test game: ${err.message}`).catch(() => {});
    }
    return;
  }

  if (content === 'ping') {
    message.reply('Pong!');
    return;
  }

  if (content === 'cleanup' || content === 'kill games') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply('You need **Manage Channels** permission to run cleanup.');
      return;
    }
    await message.reply('Cleaning up game channels...');
    try {
      await message.guild.channels.fetch();
      const gameCategories = message.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildCategory && /^IA Game #\d+$/.test(c.name)
      );
      let deleted = 0;
      for (const cat of gameCategories.values()) {
        const children = message.guild.channels.cache.filter((c) => c.parentId === cat.id);
        for (const ch of children.values()) {
          await ch.delete();
          deleted++;
        }
        await cat.delete();
        deleted++;
      }
      games.clear();
      dcMessageMeta.clear();
      dcExhaustedState.clear();
      dcHealthState.clear();
      await message.channel.send(`Done. Deleted ${deleted} channel(s).`);
    } catch (err) {
      console.error('Cleanup error:', err);
      await message.channel.send(`Cleanup failed: ${err.message}`);
    }
    return;
  }

  if (content === 'setup') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply('You need **Manage Server** permission to run setup.');
      return;
    }
    await message.reply('Setting up server structure...');
    try {
      const result = await setupServer(message.guild);
      await message.channel.send(result);
    } catch (err) {
      console.error(err);
      await message.channel.send(
        `Setup failed. Ensure the bot has **Manage Channels** permission. Error: ${err.message}`
      );
    }
    return;
  }

  if (content === 'play' || content === 'skirmish' || content === 'ia') {
    const embed = new EmbedBuilder()
      .setTitle('Imperial Assault Skirmish')
      .setDescription('Choose an action:')
      .setColor(0x2f3136);
    await message.reply({
      embeds: [embed],
      components: [getMainMenu()],
    });
    return;
  }

  // .vsav file upload in Player Hand channel
  const vsavAttach = message.attachments?.find((a) => a.name?.toLowerCase().endsWith('.vsav'));
  if (vsavAttach) {
    const channelId = message.channel.id;
    for (const [gameId, game] of games) {
      const isP1 = game.p1HandId === channelId;
      const isP2 = game.p2HandId === channelId;
      if (!isP1 && !isP2) continue;
      const userId = isP1 ? game.player1Id : game.player2Id;
      if (message.author.id !== userId) {
        await message.reply('Only the owner of this hand can submit a squad.');
        return;
      }
      if (!game.mapSelected) {
        await message.reply('Map selection must be completed before you can submit your squad.');
        return;
      }
      try {
        const res = await fetch(vsavAttach.url);
        const content = await res.text();
        const parsed = parseVsav(content);
        if (!parsed || (parsed.dcList.length === 0 && parsed.ccList.length === 0)) {
          await message.reply('Could not parse that .vsav file. Make sure it was exported from the IACP List Builder.');
          return;
        }
        const squadName = vsavAttach.name
          ? vsavAttach.name.replace(/\.vsav$/i, '').replace(/^IA List \[[^\]]+\] - /, '').trim()
          : 'From .vsav';
        const squad = {
          name: squadName || 'From .vsav',
          dcList: parsed.dcList,
          ccList: parsed.ccList,
          dcCount: parsed.dcList.length,
          ccCount: parsed.ccList.length,
        };
        await applySquadSubmission(game, isP1, squad, message.client);
        await message.reply(`✓ Squad **${squad.name}** submitted from .vsav (${squad.dcCount} DCs, ${squad.ccCount} CCs)`);
      } catch (err) {
        console.error('vsav parse error:', err);
        await message.reply(`Failed to parse .vsav: ${err.message}`);
      }
      return;
    }
  }

  // Pasted IACP list (from Share button) in Player Hand channel
  const channelId = message.channel.id;
  for (const [gameId, game] of games) {
    const isP1 = game.p1HandId === channelId;
    const isP2 = game.p2HandId === channelId;
    if (!isP1 && !isP2) continue;
    const userId = isP1 ? game.player1Id : game.player2Id;
    if (message.author.id !== userId) continue;
    if (!game.mapSelected) continue;
    const parsed = parseIacpListPaste(message.content || '');
    if (parsed && (parsed.dcList.length > 0 || parsed.ccList.length > 0)) {
      const squad = {
        name: parsed.name || 'From pasted list',
        dcList: parsed.dcList,
        ccList: parsed.ccList,
        dcCount: parsed.dcList.length,
        ccCount: parsed.ccList.length,
      };
      await applySquadSubmission(game, isP1, squad, message.client);
      await message.reply(`✓ Squad **${squad.name}** submitted from pasted list (${squad.dcCount} DCs, ${squad.ccCount} CCs)`);
      return;
    }
  }
  } catch (err) {
    console.error('Message handler error:', err);
    const guild = message?.guild;
    const gameId = extractGameIdFromMessage(message);
    await logGameErrorToBotLogs(message.client, guild, gameId, err, 'messageCreate');
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('request_resolve_')) {
      const threadId = interaction.customId.replace('request_resolve_', '');
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'Only admins can resolve requests.', ephemeral: true }).catch(() => {});
        return;
      }
      try {
        const thread = await interaction.client.channels.fetch(threadId);
        if (!thread?.isThread?.()) {
          await interaction.reply({ content: 'Thread not found.', ephemeral: true }).catch(() => {});
          return;
        }
        const name = thread.name;
        const prefix = '[IMPLEMENTED] ';
        const newName = name.startsWith(prefix) ? name : prefix + name.replace(/^\[REJECTED\] /, '');
        await thread.setName(newName);
        await interaction.deferUpdate();
        await interaction.message.edit({ content: '✓ Marked as resolved.', components: [] }).catch(() => {});
      } catch (err) {
        await interaction.reply({ content: `Failed: ${err.message}`, ephemeral: true }).catch(() => {});
      }
      return;
    }
    if (interaction.customId.startsWith('request_reject_')) {
      const threadId = interaction.customId.replace('request_reject_', '');
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'Only admins can reject requests.', ephemeral: true }).catch(() => {});
        return;
      }
      try {
        const thread = await interaction.client.channels.fetch(threadId);
        if (!thread?.isThread?.()) {
          await interaction.reply({ content: 'Thread not found.', ephemeral: true }).catch(() => {});
          return;
        }
        const name = thread.name;
        const prefix = '[REJECTED] ';
        const newName = name.startsWith(prefix) ? name : prefix + name.replace(/^\[IMPLEMENTED\] /, '');
        await thread.setName(newName);
        await interaction.deferUpdate();
        await interaction.message.edit({ content: '✓ Marked as rejected.', components: [] }).catch(() => {});
      } catch (err) {
        await interaction.reply({ content: `Failed: ${err.message}`, ephemeral: true }).catch(() => {});
      }
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('squad_modal_')) {
      const [, , gameId, playerNum] = interaction.customId.split('_');
      const game = games.get(gameId);
      if (!game) {
        await interaction.reply({ content: 'This game no longer exists.', ephemeral: true });
        return;
      }
      if (!game.mapSelected) {
        await interaction.reply({ content: 'Map selection must be completed before you can submit your squad.', ephemeral: true });
        return;
      }
      const isP1 = playerNum === '1';
      const userId = isP1 ? game.player1Id : game.player2Id;
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: 'Only the player for this hand can submit.', ephemeral: true });
        return;
      }
      const name = interaction.fields.getTextInputValue('squad_name').trim() || 'Unnamed Squad';
      const dcText = interaction.fields.getTextInputValue('squad_dc').trim();
      const ccText = interaction.fields.getTextInputValue('squad_cc').trim();
      const dcList = dcText ? dcText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
      const ccList = ccText ? ccText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
      const squad = { name, dcList, ccList, dcCount: dcList.length, ccCount: ccList.length };
      await applySquadSubmission(game, isP1, squad, interaction.client);
      await interaction.reply({ content: `Squad **${name}** submitted. (${dcList.length} DCs, ${ccList.length} CCs)`, ephemeral: true });
    }
    if (interaction.customId.startsWith('deploy_modal_')) {
      const parts = interaction.customId.split('_');
      if (parts.length < 5) {
        await interaction.reply({ content: 'Invalid modal.', ephemeral: true }).catch(() => {});
        return;
      }
      const gameId = parts[2];
      const playerNum = parseInt(parts[3], 10);
      const flatIndex = parseInt(parts[4], 10);
      const game = games.get(gameId);
      if (!game) {
        await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
        return;
      }
      const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
      if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
        return;
      }
      const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
      const deployLabels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
      const figMeta = deployMeta?.[flatIndex];
      const figLabel = deployLabels?.[flatIndex];
      if (!figMeta || !figLabel) {
        await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
        return;
      }
      const space = (interaction.fields.getTextInputValue('deploy_space') || '').trim().toLowerCase();
      if (!space) {
        await interaction.reply({ content: 'Please enter a space (e.g. A1).', ephemeral: true }).catch(() => {});
        return;
      }
      const mapId = game.selectedMap?.id;
      const zones = mapId ? deploymentZones[mapId] : null;
      if (zones) {
        const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
        const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
        const validSpaces = (zones[playerZone] || []).map((s) => String(s).toLowerCase());
        if (validSpaces.length > 0 && !validSpaces.includes(space)) {
          await interaction.reply({ content: `**${space.toUpperCase()}** is not in your deployment zone. Check the map for valid cells (e.g. A1, B2).`, ephemeral: true }).catch(() => {});
          return;
        }
      }
      const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
      if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
      if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
      game.figurePositions[playerNum][figureKey] = space;
      saveGames();
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> deployed **${figLabel.replace(/^Deploy /, '')}** at **${space.toUpperCase()}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
      await updateDeployPromptMessages(game, playerNum, interaction.client);
      await interaction.reply({ content: `Deployed **${figLabel.replace(/^Deploy /, '')}** at **${space.toUpperCase()}**.`, ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('cc_play_select_')) {
      const gameId = interaction.customId.replace('cc_play_select_', '');
      const game = games.get(gameId);
      if (!game) {
        await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
        return;
      }
      const channelId = interaction.channel?.id;
      const isP1Hand = channelId === game.p1HandId;
      const isP2Hand = channelId === game.p2HandId;
      if (!isP1Hand && channelId !== game.p2HandId) {
        await interaction.reply({ content: 'Use this in your Hand channel.', ephemeral: true }).catch(() => {});
        return;
      }
      const playerNum = isP1Hand ? 1 : 2;
      const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
      const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
      const hand = game[handKey] || [];
      const card = interaction.values[0];
      const idx = hand.indexOf(card);
      if (idx < 0) {
        await interaction.reply({ content: "That card isn't in your hand.", ephemeral: true }).catch(() => {});
        return;
      }
      await interaction.deferUpdate();
      hand.splice(idx, 1);
      game[handKey] = hand;
      game[discardKey] = game[discardKey] || [];
      game[discardKey].push(card);
      const handChannel = await interaction.client.channels.fetch(isP1Hand ? game.p1HandId : game.p2HandId);
      const handMessages = await handChannel.messages.fetch({ limit: 20 });
      const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
      if (handMsg) {
        const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
        const effectData = getCcEffect(card);
        const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
        handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
        await handMsg.edit({
          content: handPayload.content,
          embeds: handPayload.embeds,
          files: handPayload.files || [],
          components: handPayload.components,
        }).catch(() => {});
      }
      await interaction.message.delete().catch(() => {});
      await updateHandVisualMessage(game, playerNum, interaction.client);
      await updateDiscardPileMessage(game, playerNum, interaction.client);
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      saveGames();
    }
    if (interaction.customId.startsWith('cc_discard_select_')) {
      const gameId = interaction.customId.replace('cc_discard_select_', '');
      const game = games.get(gameId);
      if (!game) {
        await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
        return;
      }
      const channelId = interaction.channel?.id;
      const isP1Hand = channelId === game.p1HandId;
      const isP2Hand = channelId === game.p2HandId;
      if (!isP1Hand && channelId !== game.p2HandId) {
        await interaction.reply({ content: 'Use this in your Hand channel.', ephemeral: true }).catch(() => {});
        return;
      }
      const playerNum = isP1Hand ? 1 : 2;
      const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
      const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
      const hand = game[handKey] || [];
      const card = interaction.values[0];
      const idx = hand.indexOf(card);
      if (idx < 0) {
        await interaction.reply({ content: "That card isn't in your hand.", ephemeral: true }).catch(() => {});
        return;
      }
      await interaction.deferUpdate();
      hand.splice(idx, 1);
      game[handKey] = hand;
      game[discardKey] = game[discardKey] || [];
      game[discardKey].push(card);
      const handChannel = await interaction.client.channels.fetch(isP1Hand ? game.p1HandId : game.p2HandId);
      const handMessages = await handChannel.messages.fetch({ limit: 20 });
      const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')));
      const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
      if (handMsg) {
        const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
        handPayload.content = `**Discard CC** — Discarded **${card}**.\n\n` + handPayload.content;
        await handMsg.edit({
          content: handPayload.content,
          embeds: handPayload.embeds,
          files: handPayload.files || [],
          components: handPayload.components,
        }).catch(() => {});
      }
      await interaction.message.delete().catch(() => {});
      await updateHandVisualMessage(game, playerNum, interaction.client);
      await updateDiscardPileMessage(game, playerNum, interaction.client);
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> discarded **${card}**`, { allowedMentions: { users: [interaction.user.id] }, icon: 'card' });
      saveGames();
    }
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith('dc_activate_')) {
    const parts = interaction.customId.replace('dc_activate_', '').split('_');
    const gameId = parts[0];
    const playerNum = parseInt(parts[1], 10);
    const dcIndex = parseInt(parts[2], 10);
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (await replyIfGameEnded(game, interaction)) return;
    const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this Play Area can activate their DCs.', ephemeral: true }).catch(() => {});
      return;
    }
    const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const dc = dcList[dcIndex];
    if (!dc) {
      await interaction.reply({ content: 'DC not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const { dcName, displayName, healthState } = dc;
    const remaining = playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
    if (remaining <= 0) {
      await interaction.reply({ content: 'No activations remaining this round.', ephemeral: true }).catch(() => {});
      return;
    }
    const dcMessageIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const msgId = dcMessageIds[dcIndex];
    if (!msgId) {
      await interaction.reply({ content: 'DC message not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
    const isMyTurn = ownerId === turnPlayerId;
    if (!isMyTurn) {
      await interaction.deferUpdate().catch(() => {});
      const playAreaCh = await client.channels.fetch(playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId);
      const promptRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_activate_${gameId}_${msgId}_${interaction.message.id}`).setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel_activate_${gameId}_${ownerId}`).setLabel('No').setStyle(ButtonStyle.Danger)
      );
      await playAreaCh.send({
        content: `<@${ownerId}> You are not first to act. Activate anyway?`,
        components: [promptRow],
        allowedMentions: { users: [ownerId] },
      });
      return;
    }
    const channel = await client.channels.fetch(playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId);
    const msg = await channel.messages.fetch(msgId);
    dcExhaustedState.set(msgId, true);
    const { embed, files } = await buildDcEmbedAndFiles(dcName, true, displayName, healthState);
    await msg.edit({ embeds: [embed], files, components: [getDcToggleButton(msgId, true)] });
    const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
    const thread = await msg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
    const speed = getDcStats(dcName).speed ?? 4;
    game.movementBank = game.movementBank || {};
    game.movementBank[msgId] = { total: 0, remaining: 0, threadId: thread.id, messageId: null, displayName };
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id };
    const pingContent = `<@${ownerId}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
    const actionsMsg = await thread.send({
      content: pingContent,
      components: getDcActionButtons(msgId, dcName, displayName, DC_ACTIONS_PER_ACTIVATION, game),
      allowedMentions: { users: [ownerId] },
    });
    game.dcActionsData[msgId].messageId = actionsMsg.id;
    if (playerNum === 1) { game.p1ActivationsRemaining--; game.p1ActivatedDcIndices.push(dcIndex); }
    else { game.p2ActivationsRemaining--; game.p2ActivatedDcIndices.push(dcIndex); }
    await updateActivationsMessage(game, playerNum, client);
    saveGames();
    const logCh = await client.channels.fetch(game.generalId);
    const icon = ACTION_ICONS.activate || '⚡';
    const pLabel = `P${playerNum}`;
    const logMsg = await logCh.send({
      content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${ownerId}> activated **${displayName}**!`,
      allowedMentions: { users: [ownerId] },
    });
    game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
    game.dcActivationLogMessageIds[msgId] = logMsg.id;
    const activateRows = getActivateDcButtons(game, playerNum);
    await interaction.update({ content: '**Activate a Deployment Card**', components: activateRows.length > 0 ? activateRows : [] }).catch(() => interaction.deferUpdate().catch(() => {}));
    return;
  }

  if (interaction.customId.startsWith('dc_unactivate_')) {
    const msgId = interaction.customId.replace('dc_unactivate_', '');
    const meta = dcMessageMeta.get(msgId);
    if (!meta) {
      await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
      return;
    }
    const game = games.get(meta.gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner can un-activate.', ephemeral: true }).catch(() => {});
      return;
    }
    const wasExhausted = dcExhaustedState.get(msgId) ?? false;
    if (!wasExhausted) {
      await interaction.reply({ content: 'DC is not activated.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    const displayName = meta.displayName || meta.dcName;
    dcExhaustedState.set(msgId, false);
    const total = meta.playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
    const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
    if (remaining < total) {
      if (meta.playerNum === 1) {
        game.p1ActivationsRemaining++;
        const dcIndex = (game.p1DcMessageIds || []).indexOf(msgId);
        if (dcIndex !== -1 && game.p1ActivatedDcIndices) game.p1ActivatedDcIndices = game.p1ActivatedDcIndices.filter((i) => i !== dcIndex);
      } else {
        game.p2ActivationsRemaining++;
        const dcIndex = (game.p2DcMessageIds || []).indexOf(msgId);
        if (dcIndex !== -1 && game.p2ActivatedDcIndices) game.p2ActivatedDcIndices = game.p2ActivatedDcIndices.filter((i) => i !== dcIndex);
      }
      await updateActivationsMessage(game, meta.playerNum, client);
    }
    const threadId = game.dcActionsData?.[msgId]?.threadId;
    if (threadId) {
      try {
        const thread = await client.channels.fetch(threadId);
        await thread.delete();
      } catch (err) {
        console.error('Failed to delete activation thread on un-activate:', err);
      }
    }
    if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
    if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
    if (game.dcFinishedPinged?.[msgId]) delete game.dcFinishedPinged[msgId];
    if (game.pendingEndTurn?.[msgId]) delete game.pendingEndTurn[msgId];
    if (game.dcActivationLogMessageIds?.[msgId]) {
      try {
        const logCh = await client.channels.fetch(game.generalId);
        const logMsg = await logCh.messages.fetch(game.dcActivationLogMessageIds[msgId]);
        await logMsg.delete().catch(() => {});
      } catch {}
      delete game.dcActivationLogMessageIds[msgId];
    }
    const healthState = dcHealthState.get(msgId) ?? [[null, null]];
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, displayName, healthState);
    await interaction.message.edit({
      embeds: [embed],
      files,
      components: [getDcToggleButton(msgId, false)],
    });
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('dc_toggle_')) {
    const msgId = interaction.customId.replace('dc_toggle_', '');
    const meta = dcMessageMeta.get(msgId);
    if (!meta) {
      await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
      return;
    }
    const game = games.get(meta.gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this Play Area can toggle their DCs.', ephemeral: true }).catch(() => {});
      return;
    }
    const wasExhausted = dcExhaustedState.get(msgId) ?? false;
    const nowExhausted = !wasExhausted;
    const healthState = dcHealthState.get(msgId) ?? [[null, null]];
    const displayName = meta.displayName || meta.dcName;
    const playerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;

    // When going ready → exhausted, that uses an activation and starts the action thread
    if (!wasExhausted && nowExhausted) {
      const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
      const isMyTurn = playerId === turnPlayerId;
      if (!isMyTurn) {
        await interaction.deferUpdate().catch(() => {});
        const playAreaCh = await client.channels.fetch(meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId);
        const promptRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`confirm_activate_${game.gameId}_${msgId}_0`).setLabel('Yes').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`cancel_activate_${game.gameId}_${playerId}`).setLabel('No').setStyle(ButtonStyle.Danger)
        );
        await playAreaCh.send({
          content: `<@${playerId}> You are not first to act. Activate anyway?`,
          components: [promptRow],
          allowedMentions: { users: [playerId] },
        });
        return;
      }
      dcExhaustedState.set(msgId, true);
      const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
      if (remaining > 0) {
        if (meta.playerNum === 1) {
          game.p1ActivationsRemaining--;
          const dcIndex = (game.p1DcMessageIds || []).indexOf(msgId);
          if (dcIndex !== -1) {
            game.p1ActivatedDcIndices = game.p1ActivatedDcIndices || [];
            game.p1ActivatedDcIndices.push(dcIndex);
          }
        } else {
          game.p2ActivationsRemaining--;
          const dcIndex = (game.p2DcMessageIds || []).indexOf(msgId);
          if (dcIndex !== -1) {
            game.p2ActivatedDcIndices = game.p2ActivatedDcIndices || [];
            game.p2ActivatedDcIndices.push(dcIndex);
          }
        }
        await updateActivationsMessage(game, meta.playerNum, client);
        const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
        const thread = await interaction.message.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
        const speed = getDcStats(meta.dcName).speed ?? 4;
        game.movementBank = game.movementBank || {};
        game.movementBank[msgId] = { total: 0, remaining: 0, threadId: thread.id, messageId: null, displayName };
        game.dcActionsData = game.dcActionsData || {};
        game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id };
        const pingContent = `<@${meta.playerNum === 1 ? game.player1Id : game.player2Id}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
        const actionsMsg = await thread.send({
          content: pingContent,
          components: getDcActionButtons(msgId, meta.dcName, displayName, DC_ACTIONS_PER_ACTIVATION, game),
          allowedMentions: { users: [meta.playerNum === 1 ? game.player1Id : game.player2Id] },
        });
        game.dcActionsData[msgId].messageId = actionsMsg.id;
        const logCh = await client.channels.fetch(game.generalId);
        const icon = ACTION_ICONS.activate || '⚡';
        const pLabel = `P${meta.playerNum}`;
        const logMsg = await logCh.send({
          content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${playerId}> activated **${displayName}**!`,
          allowedMentions: { users: [playerId] },
        });
        game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
        game.dcActivationLogMessageIds[msgId] = logMsg.id;
      }
    }
    // When going exhausted → ready, give an activation back (cap at total)
    if (wasExhausted && !nowExhausted) {
      dcExhaustedState.set(msgId, false);
      const total = meta.playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
      const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
      if (remaining < total) {
        if (meta.playerNum === 1) {
          game.p1ActivationsRemaining++;
          const dcIndex = (game.p1DcMessageIds || []).indexOf(msgId);
          if (dcIndex !== -1 && game.p1ActivatedDcIndices) game.p1ActivatedDcIndices = game.p1ActivatedDcIndices.filter((i) => i !== dcIndex);
        } else {
          game.p2ActivationsRemaining++;
          const dcIndex = (game.p2DcMessageIds || []).indexOf(msgId);
          if (dcIndex !== -1 && game.p2ActivatedDcIndices) game.p2ActivatedDcIndices = game.p2ActivatedDcIndices.filter((i) => i !== dcIndex);
        }
        await updateActivationsMessage(game, meta.playerNum, client);
      }
      const threadId = game.dcActionsData?.[msgId]?.threadId;
      if (threadId) {
        try {
          const thread = await client.channels.fetch(threadId);
          await thread.delete();
        } catch (err) {
          console.error('Failed to delete activation thread on ready:', err);
        }
      }
      if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
      if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
      if (game.dcFinishedPinged?.[msgId]) delete game.dcFinishedPinged[msgId];
      if (game.pendingEndTurn?.[msgId]) delete game.pendingEndTurn[msgId];
      if (game.dcActivationLogMessageIds?.[msgId]) {
        try {
          const logCh = await client.channels.fetch(game.generalId);
          const logMsg = await logCh.messages.fetch(game.dcActivationLogMessageIds[msgId]);
          await logMsg.delete().catch(() => {});
        } catch {}
        delete game.dcActivationLogMessageIds[msgId];
      }
    }
    saveGames();
    const actionIcon = nowExhausted ? 'activate' : 'ready';
    const pLabel = `P${meta.playerNum}`;
    const actionText = nowExhausted ? `**${pLabel}:** <@${playerId}> activated **${displayName}**!` : `**${pLabel}:** <@${playerId}> readied **${displayName}**`;
    await logGameAction(game, client, actionText, { allowedMentions: { users: [playerId] }, icon: actionIcon });
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, nowExhausted, displayName, healthState);
    await interaction.update({
      embeds: [embed],
      files,
      components: [getDcToggleButton(msgId, nowExhausted)],
    });
    return;
  }

  if (interaction.customId.startsWith('dc_move_') || interaction.customId.startsWith('dc_attack_') || interaction.customId.startsWith('dc_interact_') || interaction.customId.startsWith('dc_special_')) {
    let msgId, action, figureIndex = 0;
    if (interaction.customId.startsWith('dc_move_')) {
      const m = interaction.customId.match(/^dc_move_(.+)_f(\d+)$/);
      msgId = m ? m[1] : interaction.customId.replace('dc_move_', '');
      figureIndex = m ? parseInt(m[2], 10) : 0;
      action = 'Move';
    } else if (interaction.customId.startsWith('dc_attack_')) {
      const m = interaction.customId.match(/^dc_attack_(.+)_f(\d+)$/);
      msgId = m ? m[1] : interaction.customId.replace('dc_attack_', '');
      figureIndex = m ? parseInt(m[2], 10) : 0;
      action = 'Attack';
    } else if (interaction.customId.startsWith('dc_interact_')) {
      const m = interaction.customId.match(/^dc_interact_(.+)_f(\d+)$/);
      msgId = m ? m[1] : interaction.customId.replace('dc_interact_', '');
      figureIndex = m ? parseInt(m[2], 10) : 0;
      action = 'Interact';
    } else {
      const parts = interaction.customId.replace('dc_special_', '').split('_');
      const specialIdx = parseInt(parts[0], 10);
      msgId = parts.slice(1).join('_');
      const metaForAction = dcMessageMeta.get(msgId);
      const stats = metaForAction ? getDcStats(metaForAction.dcName) : { specials: [] };
      action = stats.specials?.[specialIdx] || 'Special';
    }
    const meta = dcMessageMeta.get(msgId);
    if (!meta) {
      await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
      return;
    }
    const game = games.get(meta.gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (await replyIfGameEnded(game, interaction)) return;
    const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this Play Area can use these actions.', ephemeral: true }).catch(() => {});
      return;
    }
    const actionsData = game.dcActionsData?.[msgId];
    const actionsRemaining = actionsData?.remaining ?? DC_ACTIONS_PER_ACTIVATION;
    if (actionsRemaining <= 0) {
      await interaction.reply({ content: 'No actions remaining this activation (2 per DC).', ephemeral: true }).catch(() => {});
      return;
    }
    if (action === 'Move') {
      try {
      const dgIndex = (meta.displayName || '').match(/\[Group (\d+)\]/)?.[1] ?? 1;
      const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
      const playerNum = meta.playerNum;
      const pos = game.figurePositions?.[playerNum]?.[figureKey];
      if (!pos) {
        await interaction.reply({ content: 'This figure has no position yet (deploy first).', ephemeral: true }).catch(() => {});
        return;
      }
      const stats = getDcStats(meta.dcName);
      const speed = getEffectiveSpeed(meta.dcName, figureKey, game);
      const bank = game.movementBank?.[msgId];
      const currentMp = bank?.remaining ?? 0;
      const mpRemaining = currentMp + speed;
      const displayName = meta.displayName || meta.dcName;
      const figLabel = (stats.figures ?? 1) > 1 ? `${displayName} ${FIGURE_LETTERS[figureIndex] || 'a'}` : displayName;
      game.movementBank = game.movementBank || {};
      if (!game.movementBank[msgId]) {
        game.movementBank[msgId] = {
          total: speed,
          remaining: mpRemaining,
          threadId: bank?.threadId ?? null,
          messageId: bank?.messageId ?? null,
          displayName: figLabel,
        };
      } else {
        game.movementBank[msgId].displayName = game.movementBank[msgId].displayName || figLabel;
        game.movementBank[msgId].remaining = mpRemaining;
        game.movementBank[msgId].total = (game.movementBank[msgId].total ?? 0) + speed;
      }
      await ensureMovementBankMessage(game, msgId, interaction.client);
      const boardState = getBoardStateForMovement(game, figureKey);
      if (!boardState) {
        await interaction.reply({ content: 'Map spaces data not found for this map. Run: npm run generate-map-spaces', ephemeral: true }).catch(() => {});
        return;
      }
      const profile = getMovementProfile(meta.dcName, figureKey, game);
      const cache = computeMovementCache(pos, mpRemaining, boardState, profile);
      if (cache.cells.size === 0) {
        await interaction.reply({ content: 'No valid movement spaces.', ephemeral: true }).catch(() => {});
        return;
      }
      const actionsData = game.dcActionsData?.[msgId];
      if (actionsData) {
        actionsData.remaining = Math.max(0, actionsData.remaining - 1);
        await updateDcActionsMessage(game, msgId, interaction.client);
      }
      game.moveInProgress = game.moveInProgress || {};
      const moveKey = `${msgId}_${figureIndex}`;
      const mpRows = getMoveMpButtonRows(msgId, figureIndex, mpRemaining);
      const replyMsg = await interaction.reply({
        content: `**Move** — Pick distance (**${mpRemaining}** MP remaining):`,
        components: mpRows,
        ephemeral: false,
        fetchReply: true,
      }).catch(() => null);
      game.moveInProgress[moveKey] = {
        figureKey,
        playerNum,
        mpRemaining,
        displayName: figLabel,
        msgId,
        movementProfile: profile,
        boardState,
        movementCache: cache,
        cacheMaxMp: mpRemaining,
        startCoord: pos,
        pendingMp: null,
        distanceMessageId: replyMsg?.id || null,
      };
      game.moveGridMessageIds = game.moveGridMessageIds || {};
      game.moveGridMessageIds[moveKey] = [];
      return;
      } catch (err) {
        console.error('Move button error:', err);
        await interaction.reply({ content: `Move failed: ${err.message}. Check bot console for details.`, ephemeral: true }).catch(() => {});
        return;
      }
    }
    if (action === 'Attack') {
      const dgIndex = (meta.displayName || '').match(/\[Group (\d+)\]/)?.[1] ?? 1;
      const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
      const playerNum = meta.playerNum;
      const attackerPos = game.figurePositions?.[playerNum]?.[figureKey];
      if (!attackerPos) {
        await interaction.reply({ content: 'This figure has no position yet.', ephemeral: true }).catch(() => {});
        return;
      }
      const stats = getDcStats(meta.dcName);
      const attackInfo = stats.attack || { dice: ['red'], range: [1, 3] };
      const [minRange, maxRange] = attackInfo.range || [1, 3];
      const ms = getMapSpaces(game.selectedMap?.id);
      if (!ms) {
        await interaction.reply({ content: 'Map spaces not found.', ephemeral: true }).catch(() => {});
        return;
      }
      const enemyPlayerNum = playerNum === 1 ? 2 : 1;
      const targets = [];
      const poses = game.figurePositions?.[enemyPlayerNum] || {};
      const dcList = enemyPlayerNum === 1 ? game.player1Squad?.dcList : game.player2Squad?.dcList || [];
      const totals = {};
      for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
      for (const [k, coord] of Object.entries(poses)) {
        const dcName = k.replace(/-\d+-\d+$/, '');
        const size = game.figureOrientations?.[k] || getFigureSize(dcName);
        const cells = getFootprintCells(coord, size);
        const dist = Math.min(...cells.map((c) => getRange(attackerPos, c)));
        if (dist < minRange || dist > maxRange) continue;
        if (!hasLineOfSight(attackerPos, coord, ms)) continue;
        const m = k.match(/-(\d+)-(\d+)$/);
        const dg = m ? parseInt(m[1], 10) : 1;
        const fi = m ? parseInt(m[2], 10) : 0;
        const figCount = getDcStats(dcName).figures ?? 1;
        const label = figCount > 1 ? `${dcName} ${FIGURE_LETTERS[fi] || 'a'}` : (totals[dcName] > 1 ? `${dcName} [Group ${dg}]` : dcName);
        targets.push({ figureKey: k, coord, label });
      }
      if (targets.length === 0) {
        await interaction.reply({ content: 'No valid targets in range with line of sight.', ephemeral: true }).catch(() => {});
        return;
      }
      const displayName = meta.displayName || meta.dcName;
      const figLabel = (stats.figures ?? 1) > 1 ? `${displayName} ${FIGURE_LETTERS[figureIndex] || 'a'}` : displayName;
      const targetRows = [];
      for (let i = 0; i < targets.length; i += 5) {
        const chunk = targets.slice(i, i + 5);
        targetRows.push(
          new ActionRowBuilder().addComponents(
            chunk.map((t, idx) => {
              const targetIndex = i + idx;
              return new ButtonBuilder()
                .setCustomId(`attack_target_${msgId}_${figureIndex}_${targetIndex}`)
                .setLabel(`${t.label} (${t.coord.toUpperCase()})`.slice(0, 80))
                .setStyle(ButtonStyle.Danger);
            })
          )
        );
      }
      game.attackTargets = game.attackTargets || {};
      game.attackTargets[`${msgId}_${figureIndex}`] = targets;
      await interaction.reply({
        content: `**Attack** — Choose target for **${figLabel}**:`,
        components: targetRows.slice(0, 5),
        ephemeral: false,
      }).catch(() => {});
      return;
    }
    if (action === 'Interact') {
      const dgIndex = (meta.displayName || '').match(/\[Group (\d+)\]/)?.[1] ?? 1;
      const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
      const playerNum = meta.playerNum;
      const mapId = game.selectedMap?.id;
      const pos = game.figurePositions?.[playerNum]?.[figureKey];
      if (!pos) {
        await interaction.reply({ content: 'This figure has no position yet (deploy first).', ephemeral: true }).catch(() => {});
        return;
      }
      const options = mapId ? getLegalInteractOptions(game, playerNum, figureKey, mapId) : [];
      if (options.length === 0) {
        await interaction.reply({ content: 'No valid interact options (must be on or adjacent to terminal, door, contraband, or launch panel).', ephemeral: true }).catch(() => {});
        return;
      }
      const missionOpts = options.filter((o) => o.missionSpecific);
      const standardOpts = options.filter((o) => !o.missionSpecific);
      const sorted = [...missionOpts, ...standardOpts];
      const rows = [];
      for (let i = 0; i < sorted.length; i += 5) {
        const chunk = sorted.slice(i, i + 5);
        rows.push(
          new ActionRowBuilder().addComponents(
            chunk.map((opt) =>
              new ButtonBuilder()
                .setCustomId(`interact_choice_${game.gameId}_${msgId}_${figureIndex}_${opt.id}`)
                .setLabel(opt.label)
                .setStyle(opt.missionSpecific ? ButtonStyle.Primary : ButtonStyle.Secondary)
            )
          )
        );
      }
      const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`interact_cancel_${game.gameId}_${msgId}_${figureIndex}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
      );
      rows.push(cancelRow);
      const stats = getDcStats(meta.dcName);
      const displayName = meta.displayName || meta.dcName;
      const figLabel = (stats.figures ?? 1) > 1 ? `${displayName} ${FIGURE_LETTERS[figureIndex] || 'a'}` : displayName;
      await interaction.reply({
        content: `**Interact** — Choose action for **${figLabel}**:`,
        components: rows.slice(0, 5),
        ephemeral: false,
      }).catch(() => {});
      return;
    }
    if (actionsData) {
      actionsData.remaining = Math.max(0, actionsData.remaining - 1);
      await updateDcActionsMessage(game, msgId, interaction.client);
    }
    const displayName = meta.displayName || meta.dcName;
    const pLabel = `P${meta.playerNum}`;
    await logGameAction(game, interaction.client, `**${pLabel}:** <@${ownerId}> used **${action}**.`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'activate' });
    const doneRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`special_done_${game.gameId}_${msgId}`)
        .setLabel('Done')
        .setStyle(ButtonStyle.Success)
    );
    await interaction.reply({
      content: `**${action}** — Resolve manually (see rules). Click **Done** when finished.`,
      components: [doneRow],
      ephemeral: false,
    }).catch(() => {});
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('special_done_')) {
    const match = interaction.customId.match(/^special_done_(.+)_(.+)$/);
    if (match) {
      await interaction.deferUpdate();
      await interaction.message.edit({
        content: (interaction.message.content || '').replace('Click **Done** when finished.', '✓ Resolved.'),
        components: [],
      }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith('move_mp_')) {
    const m = interaction.customId.match(/^move_mp_(.+)_(\d+)_(\d+)$/);
    if (!m) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const [, msgId, figureIndexStr, mpStr] = m;
    const figureIndex = parseInt(figureIndexStr, 10);
    const mp = parseInt(mpStr, 10);
    const meta = dcMessageMeta.get(msgId);
    if (!meta) {
      await interaction.reply({ content: 'DC no longer tracked.', ephemeral: true }).catch(() => {});
      return;
    }
    const game = games.get(meta.gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const moveKey = `${msgId}_${figureIndex}`;
    const moveState = game.moveInProgress?.[moveKey];
    if (!moveState) {
      await interaction.reply({ content: 'Move session expired.', ephemeral: true }).catch(() => {});
      return;
    }
    const { figureKey, playerNum, mpRemaining, displayName } = moveState;
    const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner can move.', ephemeral: true }).catch(() => {});
      return;
    }
    if (mp < 1 || mp > mpRemaining) {
      await interaction.reply({ content: `Choose 1–${mpRemaining} MP.`, ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    const boardState = moveState.boardState || getBoardStateForMovement(game, figureKey);
    if (!boardState) {
      delete game.moveInProgress[moveKey];
      await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch(() => {});
      return;
    }
    const profile = moveState.movementProfile || getMovementProfile(meta.dcName, figureKey, game);
    moveState.boardState = boardState;
    moveState.movementProfile = profile;
    const startCoord = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
    if (!startCoord) {
      delete game.moveInProgress[moveKey];
      await interaction.followUp({ content: 'Figure position missing. Movement cancelled.', ephemeral: true }).catch(() => {});
      return;
    }
    const cache = ensureMovementCache(moveState, startCoord, mpRemaining, boardState, profile);
    const spaces = getSpacesAtCost(cache, mp);
    if (spaces.length === 0) {
      await interaction.followUp({ content: `No spaces exactly **${mp}** MP away.`, ephemeral: true }).catch(() => {});
      return;
    }
    moveState.pendingMp = mp;
    await clearMoveGridMessages(game, moveKey, interaction.channel);
    game.moveGridMessageIds = game.moveGridMessageIds || {};
    delete game.moveGridMessageIds[moveKey];
    if (moveState.distanceMessageId && interaction.message?.id === moveState.distanceMessageId) {
      await interaction.message.edit({
        content: `**Move** — Pick a destination (**${mp}** MP) — see buttons below.`,
        components: [],
      }).catch(() => {});
    }
    const { rows } = getMoveSpaceGridRows(msgId, figureIndex, spaces, boardState.mapSpaces);
    const gridIds = [];
    const BTM_PER_MSG = 5;
    const firstRows = rows.slice(0, BTM_PER_MSG);
    const gridMsg = await interaction.followUp({
      content: `**Move** — Pick destination (**${mp}** MP):`,
      components: firstRows,
      fetchReply: true,
    }).catch(() => null);
    if (gridMsg?.id) gridIds.push(gridMsg.id);
    for (let i = BTM_PER_MSG; i < rows.length; i += BTM_PER_MSG) {
      const more = rows.slice(i, i + BTM_PER_MSG);
      if (more.length > 0) {
        const follow = await interaction.channel.send({ content: null, components: more }).catch(() => null);
        if (follow?.id) gridIds.push(follow.id);
      }
    }
    game.moveGridMessageIds = game.moveGridMessageIds || {};
    game.moveGridMessageIds[moveKey] = gridIds;
    return;
  }

  if (interaction.customId.startsWith('move_pick_')) {
    const m = interaction.customId.match(/^move_pick_(.+)_(\d+)_(.+)$/);
    if (!m) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const [, msgId, figureIndexStr, space] = m;
    const figureIndex = parseInt(figureIndexStr, 10);
    const meta = dcMessageMeta.get(msgId);
    if (!meta) {
      await interaction.reply({ content: 'DC no longer tracked.', ephemeral: true }).catch(() => {});
      return;
    }
    const game = games.get(meta.gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const moveKey = `${msgId}_${figureIndex}`;
    const moveState = game.moveInProgress?.[moveKey];
    if (!moveState) {
      await interaction.reply({ content: 'Move session expired.', ephemeral: true }).catch(() => {});
      return;
    }
    const { figureKey, playerNum, mpRemaining, displayName } = moveState;
    const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner can move.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    await clearMoveGridMessages(game, moveKey, interaction.channel);
    const boardState = getBoardStateForMovement(game, figureKey);
    if (!boardState) {
      delete game.moveInProgress[moveKey];
      await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch(() => {});
      return;
    }
    const profile = getMovementProfile(meta.dcName, figureKey, game);
    const startCoord = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
    if (!startCoord) {
      delete game.moveInProgress[moveKey];
      await interaction.followUp({ content: 'Figure position missing. Movement cancelled.', ephemeral: true }).catch(() => {});
      return;
    }
    const cache = ensureMovementCache(moveState, startCoord, mpRemaining, boardState, profile);
    const targetLower = normalizeCoord(space);
    const targetInfo = getMovementTarget(cache, targetLower);
    if (!targetInfo) {
      await interaction.followUp({ content: 'Destination not valid for the selected MP.', ephemeral: true }).catch(() => {});
      return;
    }
    if (moveState.pendingMp && targetInfo.cost !== moveState.pendingMp) {
      await interaction.followUp({ content: 'Select a destination from the most recent distance choice.', ephemeral: true }).catch(() => {});
      return;
    }
    const cost = targetInfo.cost;
    if (cost > mpRemaining) {
      await interaction.followUp({ content: 'Not enough movement points.', ephemeral: true }).catch(() => {});
      return;
    }
    moveState.pendingMp = null;
    const mapId = game.selectedMap?.id;
    const terminalsBefore = mapId ? countTerminalsControlledByPlayer(game, playerNum, mapId) : 0;
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
    const newTopLeft = targetInfo.topLeft;
    game.figurePositions[playerNum][figureKey] = newTopLeft;
    const newSize = targetInfo.size;
    const storedSize = game.figureOrientations?.[figureKey] || getFigureSize(meta.dcName);
    if (newSize !== storedSize) {
      game.figureOrientations = game.figureOrientations || {};
      game.figureOrientations[figureKey] = newSize;
    }
    const footprintSet = new Set(getNormalizedFootprint(newTopLeft, newSize));
    const updatedProfile = getMovementProfile(meta.dcName, figureKey, game);
    await resolveMassivePush(game, updatedProfile, figureKey, playerNum, footprintSet, client);
    const newMp = mpRemaining - cost;
    moveState.mpRemaining = newMp;
    moveState.startCoord = targetInfo.topLeft;
    moveState.boardState = null;
    moveState.movementCache = null;
    moveState.cacheMaxMp = 0;
    if (game.movementBank?.[msgId]) {
      game.movementBank[msgId].remaining = Math.max(0, newMp);
      await updateMovementBankMessage(game, msgId, client);
    }
    const destDisplay = space.toUpperCase();
    const shortName = (displayName || meta.displayName || '').replace(/\s*\[Group \d+\]$/, '') || displayName;
    const pLabel = `P${playerNum}`;
    const path = getMovementPath(cache, startCoord, newTopLeft, newSize, profile);
    const pathStr = path.length > 1
      ? ` (path: ${path.map((c) => String(c).toUpperCase()).join(' → ')})`
      : '';
    await logGameAction(game, client, `<@${ownerId}> moved **${displayName}** to **${destDisplay}**${pathStr}`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'move' });
    const terminalsAfter = mapId ? countTerminalsControlledByPlayer(game, playerNum, mapId) : 0;
    if (terminalsAfter > terminalsBefore) {
      await logGameAction(game, client, `**${pLabel}: ${shortName}** has taken control of a terminal!`, { phase: 'ROUND', icon: 'deploy' });
    }
    if (newMp <= 0) {
      await editDistanceMessage(moveState, interaction.channel, `✓ Moved **${displayName}** to **${destDisplay}**.`, []);
      delete game.moveInProgress[moveKey];
    } else {
      const nextBoard = getBoardStateForMovement(game, figureKey);
      if (nextBoard) {
        const nextProfile = getMovementProfile(meta.dcName, figureKey, game);
        const nextCache = computeMovementCache(newTopLeft, newMp, nextBoard, nextProfile);
        moveState.boardState = nextBoard;
        moveState.movementProfile = nextProfile;
        moveState.movementCache = nextCache;
        moveState.cacheMaxMp = newMp;
      }
      const mpRows = getMoveMpButtonRows(msgId, figureIndex, newMp);
      await editDistanceMessage(moveState, interaction.channel, `**Move** — Pick distance (**${newMp}** MP remaining):`, mpRows);
      game.moveGridMessageIds = game.moveGridMessageIds || {};
      game.moveGridMessageIds[moveKey] = [];
    }
    if (game.boardId && game.selectedMap) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to update map after move:', err);
      }
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('attack_target_')) {
    const m = interaction.customId.match(/^attack_target_(.+)_(\d+)_(\d+)$/);
    if (!m) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const [, msgId, figureIndexStr, targetIndexStr] = m;
    const figureIndex = parseInt(figureIndexStr, 10);
    const targetIndex = parseInt(targetIndexStr, 10);
    const meta = dcMessageMeta.get(msgId);
    if (!meta) {
      await interaction.reply({ content: 'DC no longer tracked.', ephemeral: true }).catch(() => {});
      return;
    }
    const game = games.get(meta.gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (await replyIfGameEnded(game, interaction)) return;
    const targets = game.attackTargets?.[`${msgId}_${figureIndex}`];
    const target = targets?.[targetIndex];
    if (!target) {
      await interaction.reply({ content: 'Target no longer valid.', ephemeral: true }).catch(() => {});
      return;
    }
    const attackerPlayerNum = meta.playerNum;
    const ownerId = attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner can attack.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    delete game.attackTargets[`${msgId}_${figureIndex}`];
    const actionsData = game.dcActionsData?.[msgId];
    if (actionsData) {
      actionsData.remaining = Math.max(0, actionsData.remaining - 1);
      await updateDcActionsMessage(game, msgId, interaction.client);
    }

    const attackerStats = getDcStats(meta.dcName);
    const attackInfo = attackerStats.attack || { dice: ['red'], range: [1, 3] };
    const targetDcName = target.figureKey.replace(/-\d+-\d+$/, '');
    const targetStats = getDcStats(targetDcName);
    const attackerDisplayName = meta.displayName || meta.dcName;
    const defenderPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
    const combatDeclare = `**P${attackerPlayerNum}:** "${attackerDisplayName}" is attacking **P${defenderPlayerNum}:** "${target.label}"!`;

    const generalChannel = await client.channels.fetch(game.generalId);
    const declareMsg = await generalChannel.send({
      content: `${ACTION_ICONS.attack || '⚔️'} <t:${Math.floor(Date.now() / 1000)}:t> — ${combatDeclare}`,
      allowedMentions: { users: [game.player1Id, game.player2Id] },
    });
    const thread = await declareMsg.startThread({
      name: `Combat: P${attackerPlayerNum} vs P${defenderPlayerNum}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });
    const readyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`combat_ready_${game.gameId}`)
        .setLabel('Ready to roll combat dice')
        .setStyle(ButtonStyle.Secondary)
    );
    const preCombatMsg = await thread.send({
      content: '**Pre-combat window** — Both players: resolve any Command Cards, add/remove dice, apply/block damage, etc. When ready, click **Ready to roll combat dice** below.',
      components: [readyRow],
    });
    game.pendingCombat = {
      gameId: game.gameId,
      attackerPlayerNum,
      attackerMsgId: msgId,
      attackerDcName: meta.dcName,
      attackerDisplayName,
      attackerFigureIndex: figureIndex,
      target: { ...target },
      targetStats: { defense: targetStats.defense || 'white', cost: targetStats.cost ?? 5 },
      attackInfo,
      combatThreadId: thread.id,
      combatDeclareMsgId: declareMsg.id,
      combatPreMsgId: preCombatMsg.id,
      p1Ready: false,
      p2Ready: false,
      attackRoll: null,
      defenseRoll: null,
      attackTargetMsgId: interaction.message.id,
    };

    await interaction.message.edit({
      content: `**Combat declared** — See thread in Game Log.`,
      components: [],
    }).catch(() => {});
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('combat_ready_')) {
    const gameId = interaction.customId.replace('combat_ready_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (await replyIfGameEnded(game, interaction)) return;
    const combat = game.pendingCombat;
    if (!combat || combat.gameId !== gameId) {
      await interaction.reply({ content: 'No pending combat.', ephemeral: true }).catch(() => {});
      return;
    }
    const clickerIsP1 = interaction.user.id === game.player1Id;
    const clickerIsP2 = interaction.user.id === game.player2Id;
    if (!clickerIsP1 && !clickerIsP2) {
      await interaction.reply({ content: 'Only players in this game can indicate ready.', ephemeral: true }).catch(() => {});
      return;
    }
    const playerNum = clickerIsP1 ? 1 : 2;
    if (playerNum === 1) combat.p1Ready = true;
    else combat.p2Ready = true;
    await interaction.deferUpdate();
    await interaction.message.channel.send(`**Player ${playerNum}** has indicated they are ready to roll combat.`);
    if (!combat.p1Ready || !combat.p2Ready) {
      saveGames();
      return;
    }
    const combatRound = game.currentRound ?? 1;
    const combatEmbed = new EmbedBuilder()
      .setTitle(`COMBAT: ROUND ${combatRound}`)
      .setColor(0xe67e22)
      .setDescription(`Attacker rolls offense, Defender rolls defense.`);
    const rollRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`combat_roll_${gameId}`)
        .setLabel('Roll Combat Dice')
        .setStyle(ButtonStyle.Danger)
    );
    const thread = await interaction.client.channels.fetch(combat.combatThreadId);
    const rollMsgSent = await thread.send({
      embeds: [combatEmbed],
      components: [rollRow],
    });
    combat.rollMessageId = rollMsgSent.id;
    try {
      const preMsg = await thread.messages.fetch(combat.combatPreMsgId);
      await preMsg.edit({ components: [] }).catch(() => {});
    } catch {}
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('combat_roll_')) {
    const gameId = interaction.customId.replace('combat_roll_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (await replyIfGameEnded(game, interaction)) return;
    const combat = game.pendingCombat;
    if (!combat || combat.gameId !== gameId) {
      await interaction.reply({ content: 'No pending combat.', ephemeral: true }).catch(() => {});
      return;
    }
    const clickerIsP1 = interaction.user.id === game.player1Id;
    const clickerIsP2 = interaction.user.id === game.player2Id;
    if (!clickerIsP1 && !clickerIsP2) {
      await interaction.reply({ content: 'Only players in this game can roll.', ephemeral: true }).catch(() => {});
      return;
    }
    const attackerPlayerNum = combat.attackerPlayerNum;
    const defenderPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
    const thread = await interaction.client.channels.fetch(combat.combatThreadId);

    if (!combat.attackRoll) {
      if (!clickerIsP1 && attackerPlayerNum === 1) {
        await interaction.reply({ content: 'Only the attacker (P1) may roll attack dice.', ephemeral: true }).catch(() => {});
        return;
      }
      if (!clickerIsP2 && attackerPlayerNum === 2) {
        await interaction.reply({ content: 'Only the attacker (P2) may roll attack dice.', ephemeral: true }).catch(() => {});
        return;
      }
      combat.attackRoll = rollAttackDice(combat.attackInfo.dice);
      await interaction.deferUpdate();
      await thread.send(`**Attack roll** — ${combat.attackRoll.acc} accuracy, ${combat.attackRoll.dmg} damage, ${combat.attackRoll.surge} surge`);
      saveGames();
      return;
    }

    if (!combat.defenseRoll) {
      if (!clickerIsP1 && defenderPlayerNum === 1) {
        await interaction.reply({ content: 'Only the defender (P1) may roll defense dice.', ephemeral: true }).catch(() => {});
        return;
      }
      if (!clickerIsP2 && defenderPlayerNum === 2) {
        await interaction.reply({ content: 'Only the defender (P2) may roll defense dice.', ephemeral: true }).catch(() => {});
        return;
      }
      combat.defenseRoll = rollDefenseDice(combat.targetStats.defense);
      await interaction.deferUpdate();
      await thread.send(`**Defense roll** — ${combat.defenseRoll.block} block, ${combat.defenseRoll.evade} evade`);
      const roll = combat.attackRoll;
      const defRoll = combat.defenseRoll;
      const hit = roll.acc >= defRoll.evade;
      const damage = hit ? Math.max(0, roll.dmg - defRoll.block) : 0;
      const ownerId = attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
      const targetMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, combat.target.figureKey);
      const tm = combat.target.figureKey.match(/-(\d+)-(\d+)$/);
      const targetFigIndex = tm ? parseInt(tm[2], 10) : 0;

      let resultText = `**Result:** Attack: ${roll.acc} acc, ${roll.dmg} dmg, ${roll.surge} surge | Defense: ${defRoll.block} block, ${defRoll.evade} evade`;
      if (!hit) resultText += ' → **Miss**';
      else resultText += ` → **${damage} damage**`;

      if (damage > 0 && targetMsgId) {
        const healthState = dcHealthState.get(targetMsgId) || [];
        const entry = healthState[targetFigIndex];
        if (entry) {
          const [cur, max] = entry;
          const newCur = Math.max(0, (cur ?? max) - damage);
          healthState[targetFigIndex] = [newCur, max ?? newCur];
          dcHealthState.set(targetMsgId, healthState);
          const dcMessageIds = defenderPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
          const dcList = defenderPlayerNum === 1 ? game.p1DcList : game.p2DcList;
          const idx = (dcMessageIds || []).indexOf(targetMsgId);
          if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
          if (newCur <= 0) {
            if (game.figurePositions?.[defenderPlayerNum]) {
              delete game.figurePositions[defenderPlayerNum][combat.target.figureKey];
            }
            const vp = combat.targetStats.cost ?? 5;
            const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
            game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
            game[vpKey].kills += vp;
            game[vpKey].total += vp;
            resultText += ` — **${combat.target.label} defeated!** +${vp} VP`;
            await logGameAction(game, interaction.client, `<@${ownerId}> defeated **${combat.target.label}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
            if (idx >= 0 && isGroupDefeated(game, defenderPlayerNum, idx)) {
              const activatedIndices = defenderPlayerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
              if (!activatedIndices.includes(idx)) {
                if (defenderPlayerNum === 1) game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining ?? 0) - 1);
                else game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining ?? 0) - 1);
                await updateActivationsMessage(game, defenderPlayerNum, interaction.client);
              }
            }
            await checkWinConditions(game, interaction.client);
          }
        }
      } else if (hit && damage === 0) {
        await logGameAction(game, interaction.client, `<@${ownerId}> attacked **${combat.target.label}** — blocked`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
      } else if (!hit) {
        await logGameAction(game, interaction.client, `<@${ownerId}> attacked **${combat.target.label}** — miss`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
      } else if (damage > 0) {
        await logGameAction(game, interaction.client, `<@${ownerId}> dealt **${damage}** damage to **${combat.target.label}**`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
      }

      await thread.send(resultText);
      delete game.pendingCombat;
      if (combat.rollMessageId) {
        try {
          const rollMsg = await thread.messages.fetch(combat.rollMessageId);
          await rollMsg.edit({ components: [] }).catch(() => {});
        } catch {}
      }
      if (damage > 0 && targetMsgId) {
        try {
          const targetMeta = dcMessageMeta.get(targetMsgId);
          if (targetMeta) {
            const channelId = targetMeta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
            const channel = await interaction.client.channels.fetch(channelId);
            const dcMsg = await channel.messages.fetch(targetMsgId);
            const exhausted = dcExhaustedState.get(targetMsgId) ?? false;
            const healthState = dcHealthState.get(targetMsgId) || [];
            const { embed, files } = await buildDcEmbedAndFiles(targetMeta.dcName, exhausted, targetMeta.displayName, healthState);
            await dcMsg.edit({ embeds: [embed], files }).catch(() => {});
          }
        } catch (err) {
          console.error('Failed to update target DC embed:', err);
        }
      }
      if (game.boardId && game.selectedMap) {
        try {
          const boardChannel = await interaction.client.channels.fetch(game.boardId);
          const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        } catch (err) {
          console.error('Failed to update map after attack:', err);
        }
      }
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('status_phase_')) {
    const gameId = interaction.customId.replace('status_phase_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (await replyIfGameEnded(game, interaction)) return;
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can end the activation phase.', ephemeral: true }).catch(() => {});
      return;
    }
    const r1 = game.p1ActivationsRemaining ?? 0;
    const r2 = game.p2ActivationsRemaining ?? 0;
    const hasActions = hasActionsRemainingInGame(game, gameId);
    if (r1 > 0 || r2 > 0 || hasActions) {
      const parts = [];
      if (r1 > 0 || r2 > 0) parts.push(`P1: ${r1} activations left, P2: ${r2} activations left`);
      if (hasActions) parts.push('some DCs still have actions to spend');
      await interaction.reply({
        content: `Both players must use all activations and actions first. (${parts.join('; ')})`,
        ephemeral: true,
      }).catch(() => {});
      return;
    }
    const round = game.currentRound || 1;
    const clickerIsP1 = interaction.user.id === game.player1Id;
    game.p1ActivationPhaseEnded = game.p1ActivationPhaseEnded || false;
    game.p2ActivationPhaseEnded = game.p2ActivationPhaseEnded || false;
    if (clickerIsP1) game.p1ActivationPhaseEnded = true;
    else game.p2ActivationPhaseEnded = true;
    const bothEnded = game.p1ActivationPhaseEnded && game.p2ActivationPhaseEnded;
    if (!bothEnded) {
      const waiting = !game.p1ActivationPhaseEnded ? 'P1' : 'P2';
      await interaction.reply({
        content: `${clickerIsP1 ? 'P1' : 'P2'} has ended activation. Waiting for **${waiting}** to click **End R${round} Activation Phase**.`,
        ephemeral: true,
      }).catch(() => {});
      const generalChannel = await client.channels.fetch(game.generalId);
      const roundEmbed = new EmbedBuilder()
        .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${round}`)
        .setColor(PHASE_COLOR);
      const endBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`status_phase_${gameId}`)
          .setLabel(`End R${round} Activation Phase`)
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.message.edit({
        content: `**Round ${round}** — ${game.p1ActivationPhaseEnded ? '✓ P1' : 'P1'} ended activation. ${game.p2ActivationPhaseEnded ? '✓ P2' : 'P2'} ended activation. Both players must click the button when done with activations and any end-of-activation effects.`,
        embeds: [roundEmbed],
        components: [endBtn],
      }).catch(() => {});
      saveGames();
      return;
    }
    game.p1ActivationPhaseEnded = false;
    game.p2ActivationPhaseEnded = false;
    await interaction.deferUpdate();
    game.endOfRoundWhoseTurn = game.initiativePlayerId;
    const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const otherPlayerId = game.initiativePlayerId === game.player1Id ? game.player2Id : game.player1Id;
    await logGameAction(game, client, `**End of Round** — 1. Mission Rules/Effects (resolve as needed). 2. <@${game.initiativePlayerId}> (Initiative). 3. <@${otherPlayerId}>. 4. Next phase. Initiative player: play any end-of-round effects or CCs, then click **End 'End of Round' window** in your Hand.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [game.initiativePlayerId, otherPlayerId] } });
    const generalChannel = await client.channels.fetch(game.generalId);
    const roundEmbed = new EmbedBuilder()
      .setTitle(`${GAME_PHASES.ROUND.emoji}  End of Round — waiting for both players`)
      .setDescription(`1. Mission Rules/Effects 2. <@${game.initiativePlayerId}> (Initiative) 3. <@${otherPlayerId}> 4. Go. Both must click **End 'End of Round' window** in their Hand.`)
      .setColor(PHASE_COLOR);
    await generalChannel.send({
      content: `**End of Round window** — <@${game.initiativePlayerId}> (Player ${initPlayerNum}), play any end-of-round effects/CCs, then click the button in your Hand.`,
      embeds: [roundEmbed],
      allowedMentions: { users: [game.initiativePlayerId] },
    });
    await interaction.message.edit({ components: [] }).catch(() => {});
    await updateHandChannelMessages(game, client);
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('end_end_of_round_')) {
    const gameId = interaction.customId.replace('end_end_of_round_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (await replyIfGameEnded(game, interaction)) return;
    if (!game.endOfRoundWhoseTurn) {
      await interaction.reply({ content: 'Not in End of Round window.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.endOfRoundWhoseTurn) {
      await interaction.reply({ content: "It's not your turn in the End of Round window.", ephemeral: true }).catch(() => {});
      return;
    }
    const initiativeId = game.initiativePlayerId;
    const otherId = initiativeId === game.player1Id ? game.player2Id : game.player1Id;
    if (interaction.user.id === initiativeId) {
      game.endOfRoundWhoseTurn = otherId;
      const initNum = initiativeId === game.player1Id ? 1 : 2;
      const otherNum = 3 - initNum;
      await logGameAction(game, client, `**End of Round** — 2. Initiative done ✓. 3. <@${otherId}> (Player ${otherNum}) — your turn for end-of-round effects. Click **End 'End of Round' window** in your Hand when done.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [otherId] } });
      await updateHandChannelMessages(game, client);
      saveGames();
      return;
    }
    game.endOfRoundWhoseTurn = null;
    await interaction.deferUpdate();
    game.dcFinishedPinged = {};
    game.pendingEndTurn = {};
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === gameId) {
        dcExhaustedState.set(msgId, false);
        if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
        if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
        try {
          const chId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
          const ch = await client.channels.fetch(chId);
          const msg = await ch.messages.fetch(msgId);
          const healthState = dcHealthState.get(msgId) || [];
          const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, meta.displayName, healthState);
          await msg.edit({ embeds: [embed], files, components: [getDcToggleButton(msgId, false)] }).catch(() => {});
        } catch (err) {
          console.error('Failed to ready DC embed:', err);
        }
      }
    }
    game.p1ActivationsRemaining = game.p1ActivationsTotal ?? 0;
    game.p2ActivationsRemaining = game.p2ActivationsTotal ?? 0;
    const mapId = game.selectedMap?.id;
    const p1Terminals = mapId ? countTerminalsControlledByPlayer(game, 1, mapId) : 0;
    const p2Terminals = mapId ? countTerminalsControlledByPlayer(game, 2, mapId) : 0;
    const p1DrawCount = 1 + p1Terminals;
    const p2DrawCount = 1 + p2Terminals;
    const p1Deck = game.player1CcDeck || [];
    const p2Deck = game.player2CcDeck || [];
    const p1Drawn = [];
    const p2Drawn = [];
    for (let i = 0; i < p1DrawCount && p1Deck.length > 0; i++) {
      const drawn = p1Deck.shift();
      p1Drawn.push(drawn);
    }
    game.player1CcHand = [...(game.player1CcHand || []), ...p1Drawn];
    game.player1CcDeck = p1Deck;
    for (let i = 0; i < p2DrawCount && p2Deck.length > 0; i++) {
      const drawn = p2Deck.shift();
      p2Drawn.push(drawn);
    }
    game.player2CcHand = [...(game.player2CcHand || []), ...p2Drawn];
    game.player2CcDeck = p2Deck;
    if (game.selectedMission?.variant === 'b' && mapId && game.figureContraband) {
      for (const pn of [1, 2]) {
        let scored = 0;
        for (const [figureKey, carrying] of Object.entries(game.figureContraband)) {
          if (!carrying) continue;
          const poses = game.figurePositions?.[pn] || {};
          if (!(figureKey in poses)) continue;
          if (!isFigureInDeploymentZone(game, pn, figureKey, mapId)) continue;
          const vp = game[`player${pn}VP`] || { total: 0, kills: 0, objectives: 0 };
          vp.total = (vp.total || 0) + 15;
          vp.objectives = (vp.objectives || 0) + 15;
          game[`player${pn}VP`] = vp;
          delete game.figureContraband[figureKey];
          scored++;
        }
        if (scored > 0) {
          const pid = pn === 1 ? game.player1Id : game.player2Id;
          await logGameAction(game, client, `<@${pid}> gained **${15 * scored} VP** for ${scored} figure(s) delivering contraband to deployment zone.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
          await checkWinConditions(game, client);
          if (game.ended) {
            await interaction.message.edit({ components: [] }).catch(() => {});
            saveGames();
            return;
          }
        }
      }
    }
    if (game.selectedMission?.variant === 'a' && mapId) {
      const launchPanels = mapTokensData[mapId]?.missionA?.launchPanels || [];
      const state = game.launchPanelState || {};
      let p1Vp = 0, p2Vp = 0;
      for (const coord of launchPanels) {
        const c = String(coord).toLowerCase();
        const side = state[c];
        if (!side) continue;
        const controller = getSpaceController(game, mapId, coord);
        if (!controller) continue;
        const vp = side === 'colored' ? 5 : 2;
        if (controller === 1) p1Vp += vp;
        else p2Vp += vp;
      }
      if (p1Vp > 0 || p2Vp > 0) {
        if (p1Vp > 0) {
          game.player1VP = game.player1VP || { total: 0, kills: 0, objectives: 0 };
          game.player1VP.total += p1Vp;
          game.player1VP.objectives += p1Vp;
          await logGameAction(game, client, `<@${game.player1Id}> gained **${p1Vp} VP** for launch panels controlled.`, { allowedMentions: { users: [game.player1Id] }, phase: 'ROUND', icon: 'round' });
          await checkWinConditions(game, client);
          if (game.ended) {
            await interaction.message.edit({ components: [] }).catch(() => {});
            saveGames();
            return;
          }
        }
        if (p2Vp > 0) {
          game.player2VP = game.player2VP || { total: 0, kills: 0, objectives: 0 };
          game.player2VP.total += p2Vp;
          game.player2VP.objectives += p2Vp;
          await logGameAction(game, client, `<@${game.player2Id}> gained **${p2Vp} VP** for launch panels controlled.`, { allowedMentions: { users: [game.player2Id] }, phase: 'ROUND', icon: 'round' });
          await checkWinConditions(game, client);
          if (game.ended) {
            await interaction.message.edit({ components: [] }).catch(() => {});
            saveGames();
            return;
          }
        }
      }
    }
    game.p1LaunchPanelFlippedThisRound = false;
    game.p2LaunchPanelFlippedThisRound = false;
    const prevInitiative = game.initiativePlayerId;
    game.initiativePlayerId = prevInitiative === game.player1Id ? game.player2Id : game.player1Id;
    game.currentRound = (game.currentRound || 1) + 1;
    await updateHandVisualMessage(game, 1, client);
    await updateHandVisualMessage(game, 2, client);
    for (const pn of [1, 2]) {
      const hand = pn === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
      const deck = pn === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
      const handId = pn === 1 ? game.p1HandId : game.p2HandId;
      if (!handId) continue;
      try {
        const handCh = await client.channels.fetch(handId);
        const msgs = await handCh.messages.fetch({ limit: 20 });
        const handMsg = msgs.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
        if (handMsg) {
          const payload = buildHandDisplayPayload(hand, deck, game.gameId, game, pn);
          await handMsg.edit({ content: payload.content, embeds: payload.embeds, files: payload.files || [], components: payload.components }).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to update hand message:', err);
      }
    }
    const generalChannel = await client.channels.fetch(game.generalId);
    const drawDesc = p1Terminals > 0 || p2Terminals > 0
      ? `Draw 1 CC each (P1 +${p1Terminals} terminal${p1Terminals !== 1 ? 's' : ''}, P2 +${p2Terminals} terminal${p2Terminals !== 1 ? 's' : ''}).`
      : 'Draw 1 command card each.';
    await logGameAction(game, client, `**Status Phase** — 1. Ready cards ✓ 2. ${drawDesc} 3. End of round effects (scoring) ✓ 4. Initiative passes to <@${game.initiativePlayerId}> (after end of round effects). Round **${game.currentRound}** — **Start of Round** window: 1. Mission Rules/Effects 2. Initiative 3. Non-initiative 4. Go.`, { phase: 'ROUND', icon: 'round' });
    game.startOfRoundWhoseTurn = game.initiativePlayerId;
    const startInitPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const startOtherId = game.initiativePlayerId === game.player1Id ? game.player2Id : game.player1Id;
    const startRoundEmbed = new EmbedBuilder()
      .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${game.currentRound} — Start of Round window`)
      .setDescription(`1. Mission Rules/Effects 2. <@${game.initiativePlayerId}> (Initiative) 3. <@${startOtherId}> 4. Go. Both must click **End 'Start of Round' window** in their Hand.`)
      .setColor(PHASE_COLOR);
    await generalChannel.send({
      content: `**Start of Round** — <@${game.initiativePlayerId}> (Player ${startInitPlayerNum}), play any start-of-round effects/CCs, then click **End 'Start of Round' window** in your Hand.`,
      embeds: [startRoundEmbed],
      allowedMentions: { users: [game.initiativePlayerId] },
    });
    await updateHandChannelMessages(game, client);
    await interaction.message.edit({ components: [] }).catch(() => {});
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('end_start_of_round_')) {
    const gameId = interaction.customId.replace('end_start_of_round_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (await replyIfGameEnded(game, interaction)) return;
    if (!game.startOfRoundWhoseTurn) {
      await interaction.reply({ content: 'Not in Start of Round window.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.startOfRoundWhoseTurn) {
      await interaction.reply({ content: "It's not your turn in the Start of Round window.", ephemeral: true }).catch(() => {});
      return;
    }
    const initiativeId = game.initiativePlayerId;
    const otherId = initiativeId === game.player1Id ? game.player2Id : game.player1Id;
    if (interaction.user.id === initiativeId) {
      game.startOfRoundWhoseTurn = otherId;
      const initNum = initiativeId === game.player1Id ? 1 : 2;
      const otherNum = 3 - initNum;
      await logGameAction(game, client, `**Start of Round** — 2. Initiative done ✓. 3. <@${otherId}> (Player ${otherNum}) — your turn for start-of-round effects. Click **End 'Start of Round' window** in your Hand when done.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [otherId] } });
      await updateHandChannelMessages(game, client);
      saveGames();
      return;
    }
    game.startOfRoundWhoseTurn = null;
    await interaction.deferUpdate();
    const generalChannel = await client.channels.fetch(game.generalId);
    const roundEmbed = new EmbedBuilder()
      .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${game.currentRound}`)
      .setColor(PHASE_COLOR);
    const showBtn = shouldShowEndActivationPhaseButton(game, gameId);
    const components = [];
    if (showBtn) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`status_phase_${gameId}`)
          .setLabel(`End R${game.currentRound} Activation Phase`)
          .setStyle(ButtonStyle.Secondary)
      ));
    }
    const initRem = game.initiativePlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
    const otherRem = game.initiativePlayerId === game.player1Id ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
    if (otherRem > initRem && initRem > 0) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pass_activation_turn_${gameId}`)
          .setLabel('Pass turn to opponent')
          .setStyle(ButtonStyle.Secondary)
      ));
    }
    const p1Terminals = game.selectedMap?.id ? countTerminalsControlledByPlayer(game, 1, game.selectedMap.id) : 0;
    const p2Terminals = game.selectedMap?.id ? countTerminalsControlledByPlayer(game, 2, game.selectedMap.id) : 0;
    const drawRule = (p1Terminals > 0 || p2Terminals > 0)
      ? 'Draw 1 CC (+1 per controlled terminal). '
      : 'Draw 1 CC. ';
    const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const passHint = otherRem > initRem && initRem > 0 ? ' You may pass back (opponent has more activations).' : '';
    const content = showBtn
      ? `<@${game.initiativePlayerId}> (**Player ${initPlayerNum}**) **Round ${game.currentRound}** — Your turn! All deployment groups readied. ${drawRule}Both players: click **End R${game.currentRound} Activation Phase** when you've used all activations and any end-of-activation effects.${passHint}`
      : `<@${game.initiativePlayerId}> (**Player ${initPlayerNum}**) **Round ${game.currentRound}** — Your turn! All deployment groups readied. ${drawRule}Use all activations and actions. The **End R${game.currentRound} Activation Phase** button will appear when both players have done so.${passHint}`;
    const sent = await generalChannel.send({
      content,
      embeds: [roundEmbed],
      components,
      allowedMentions: { users: [game.initiativePlayerId] },
    });
    game.roundActivationMessageId = sent.id;
    game.roundActivationButtonShown = showBtn;
    game.currentActivationTurnPlayerId = game.initiativePlayerId;
    await updateHandChannelMessages(game, client);
    await interaction.message.edit({ components: [] }).catch(() => {});
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('map_selection_')) {
    const gameId = interaction.customId.replace('map_selection_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can select the map.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.mapSelected) {
      await interaction.reply({ content: `Map already selected: **${game.selectedMap?.name ?? 'Unknown'}**.`, ephemeral: true }).catch(() => {});
      return;
    }
    const playReadyMaps = getPlayReadyMaps();
    if (playReadyMaps.length === 0) {
      await interaction.reply({
        content: 'No maps have deployment zones configured yet. Add zone data to `data/deployment-zones.json` for at least one map.',
        ephemeral: true,
      }).catch(() => {});
      return;
    }
    const map = playReadyMaps[Math.floor(Math.random() * playReadyMaps.length)];
    game.selectedMap = { id: map.id, name: map.name, imagePath: map.imagePath };
    game.mapSelected = true;
    await interaction.deferUpdate();
    await postMissionCardAfterMapSelection(game, client, map);
    if (game.boardId) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, map, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to post map to Board channel:', err);
      }
    }
    await logGameAction(game, client, `Map selected: **${map.name}** — View in Board channel.`, { phase: 'SETUP', icon: 'map' });
    if (game.generalSetupMessageId) {
      try {
        const generalChannel = await client.channels.fetch(game.generalId);
        const setupMsg = await generalChannel.messages.fetch(game.generalSetupMessageId);
        await setupMsg.edit({ components: [getGeneralSetupButtons(game)] });
      } catch (err) {
        console.error('Failed to remove Map Selection button:', err);
      }
    }
    try {
      if (!game.p1HandId || !game.p2HandId) {
        const generalCh = await client.channels.fetch(game.generalId);
        const guild = generalCh.guild;
        const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalCh.parentId);
        const prefix = `IA${game.gameId}`;
        const { p1HandChannel, p2HandChannel } = await createHandChannels(
          guild, gameCategory, prefix, game.player1Id, game.player2Id
        );
        game.p1HandId = p1HandChannel.id;
        game.p2HandId = p2HandChannel.id;
      }
      const p1Hand = await client.channels.fetch(game.p1HandId);
      const p2Hand = await client.channels.fetch(game.p2HandId);
      const isTest = game.player1Id === game.player2Id;
      const p1Id = game.player1Id;
      const p2Id = game.player2Id;
      await p1Hand.send({
        content: `<@${p1Id}>, this is your hand — pick your squad below!${isTest ? ' *(Test — use Select Squad or Default deck buttons for each side.)*' : ''}`,
        allowedMentions: { users: [p1Id] },
        embeds: [getHandTooltipEmbed(game, 1), getSquadSelectEmbed(1, null)],
        components: [getHandSquadButtons(game.gameId, 1)],
      });
      await p2Hand.send({
        content: `<@${p2Id}>, this is your hand — pick your squad below!${isTest ? ' *(Test — use Select Squad or Default deck buttons for each side.)*' : ''}`,
        allowedMentions: { users: [p2Id] },
        embeds: [getHandTooltipEmbed(game, 2), getSquadSelectEmbed(2, null)],
        components: [getHandSquadButtons(game.gameId, 2)],
      });
    } catch (err) {
      console.error('Failed to create/populate Hand channels:', err);
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('draft_random_')) {
    const gameId = interaction.customId.replace('draft_random_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can use Draft Random.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.draftRandomUsed || game.currentRound || game.initiativeDetermined || game.deploymentZoneChosen) {
      await interaction.reply({ content: 'Draft Random is only available at game setup.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    try {
      await runDraftRandom(game, client);
      game.draftRandomUsed = true;
      if (game.generalSetupMessageId) {
        try {
          const generalChannel = await client.channels.fetch(game.generalId);
          const setupMsg = await generalChannel.messages.fetch(game.generalSetupMessageId);
          await setupMsg.edit({ components: [getGeneralSetupButtons(game)] });
        } catch (err) {
          console.error('Failed to update setup buttons after Draft Random:', err);
        }
      }
      saveGames();
    } catch (err) {
      console.error('Draft Random error:', err);
      await interaction.followUp({ content: `Draft Random failed: ${err.message}`, ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith('pass_activation_turn_')) {
    const gameId = interaction.customId.replace('pass_activation_turn_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (await replyIfGameEnded(game, interaction)) return;
    const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
    if (interaction.user.id !== turnPlayerId) {
      await interaction.reply({ content: "It's not your turn to pass.", ephemeral: true }).catch(() => {});
      return;
    }
    const myRem = turnPlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
    const otherRem = turnPlayerId === game.player1Id ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
    if (otherRem <= myRem) {
      await interaction.reply({ content: 'The other player does not have more activations than you.', ephemeral: true }).catch(() => {});
      return;
    }
    const otherPlayerId = turnPlayerId === game.player1Id ? game.player2Id : game.player1Id;
    const otherPlayerNum = otherPlayerId === game.player1Id ? 1 : 2;
    game.currentActivationTurnPlayerId = otherPlayerId;
    await interaction.deferUpdate();
    await logGameAction(game, client, `<@${turnPlayerId}> passed the turn to <@${otherPlayerId}> (Player ${otherPlayerNum} has more activations remaining).`, { phase: 'ROUND', icon: 'activate', allowedMentions: { users: [otherPlayerId] } });
    if (game.roundActivationMessageId && game.generalId) {
      try {
        const ch = await client.channels.fetch(game.generalId);
        const msg = await ch.messages.fetch(game.roundActivationMessageId);
        const round = game.currentRound || 1;
        const initNum = otherPlayerId === game.player1Id ? 1 : 2;
        const newCurrentRem = otherPlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
        const justPassedRem = turnPlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
        const passRows = [];
        if (justPassedRem > newCurrentRem && newCurrentRem > 0) {
          passRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`pass_activation_turn_${gameId}`)
              .setLabel('Pass turn to opponent')
              .setStyle(ButtonStyle.Secondary)
          ));
        }
        await msg.edit({
          content: `<@${otherPlayerId}> (**Player ${initNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back if the other player has more activations.' : ''}`,
          components: passRows,
          allowedMentions: { users: [otherPlayerId] },
        }).catch(() => {});
      } catch (err) {
        console.error('Failed to update round message for pass:', err);
      }
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('end_turn_')) {
    const match = interaction.customId.match(/^end_turn_([^_]+)_(.+)$/);
    if (!match) return;
    const gameId = match[1];
    const dcMsgId = match[2];
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const meta = dcMessageMeta.get(dcMsgId);
    if (!meta || meta.gameId !== gameId) {
      await interaction.reply({ content: 'Invalid End Turn.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the player who finished that activation can end the turn.', ephemeral: true }).catch(() => {});
      return;
    }
    const pending = game.pendingEndTurn?.[dcMsgId];
    if (!pending) {
      await interaction.reply({ content: 'This turn was already ended.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    const otherPlayerId = meta.playerNum === 1 ? game.player2Id : game.player1Id;
    const otherPlayerNum = meta.playerNum === 1 ? 2 : 1;
    game.dcFinishedPinged = game.dcFinishedPinged || {};
    game.dcFinishedPinged[dcMsgId] = true;
    delete game.pendingEndTurn[dcMsgId];
    if (pending.messageId) {
      try {
        const ch = await client.channels.fetch(game.generalId);
        const endTurnMsg = await ch.messages.fetch(pending.messageId);
        await endTurnMsg.edit({ components: [] }).catch(() => {});
      } catch {}
    }
    // Delete the DC activation thread
    const actionsData = game.dcActionsData?.[dcMsgId];
    if (actionsData?.threadId) {
      try {
        const thread = await client.channels.fetch(actionsData.threadId);
        await thread.delete();
      } catch (err) {
        console.error('Failed to delete DC activation thread:', err);
      }
      if (game.dcActionsData?.[dcMsgId]) delete game.dcActionsData[dcMsgId];
      if (game.movementBank?.[dcMsgId]) delete game.movementBank[dcMsgId];
    }
    // Update the DC card to show only Ready (remove Un-activate)
    try {
      const playAreaId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
      const playChannel = await client.channels.fetch(playAreaId);
      const dcMsg = await playChannel.messages.fetch(dcMsgId);
      const healthState = dcHealthState.get(dcMsgId) ?? [[null, null]];
      const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, meta.displayName, healthState);
      await dcMsg.edit({
        embeds: [embed],
        files,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dc_toggle_${dcMsgId}`)
            .setLabel('Ready')
            .setStyle(ButtonStyle.Success)
        )],
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to update DC card after End Turn:', err);
    }
    game.currentActivationTurnPlayerId = otherPlayerId;
    await logGameAction(game, client, `<@${otherPlayerId}> (**Player ${otherPlayerNum}'s turn**) **${pending.displayName}** finished all actions — your turn to activate a figure!`, {
      allowedMentions: { users: [otherPlayerId] },
      phase: 'ROUND',
      icon: 'activate',
    });
    if (game.roundActivationMessageId && game.generalId && !game.roundActivationButtonShown) {
      try {
        const ch = await client.channels.fetch(game.generalId);
        const msg = await ch.messages.fetch(game.roundActivationMessageId);
        const round = game.currentRound || 1;
        const newCurrentRem = otherPlayerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
        const justActedRem = meta.playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
        const passRows = [];
        if (justActedRem > newCurrentRem && newCurrentRem > 0) {
          passRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`pass_activation_turn_${gameId}`)
              .setLabel('Pass turn to opponent')
              .setStyle(ButtonStyle.Secondary)
          ));
        }
        await msg.edit({
          content: `<@${otherPlayerId}> (**Player ${otherPlayerNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back (opponent has more activations).' : ''}`,
          components: passRows,
          allowedMentions: { users: [otherPlayerId] },
        }).catch(() => {});
      } catch (err) {
        console.error('Failed to update round message after end turn:', err);
      }
    }
    await maybeShowEndActivationPhaseButton(game, client);
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('confirm_activate_')) {
    const match = interaction.customId.match(/^confirm_activate_([^_]+)_(.+)_(\d+)$/);
    if (!match) return;
    const [, gameId, msgId, activateCardMsgIdStr] = match;
    const activateCardMsgId = activateCardMsgIdStr === '0' ? null : activateCardMsgIdStr;
    const game = games.get(gameId);
    if (!game) return;
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.gameId !== gameId) return;
    const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) return;
    const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
    if (remaining <= 0) {
      await interaction.reply({ content: 'No activations remaining.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    await interaction.message.edit({ components: [] }).catch(() => {});
    dcExhaustedState.set(msgId, true);
    if (meta.playerNum === 1) {
      game.p1ActivationsRemaining--;
      const dcIndex = (game.p1DcMessageIds || []).indexOf(msgId);
      if (dcIndex !== -1) { game.p1ActivatedDcIndices = game.p1ActivatedDcIndices || []; game.p1ActivatedDcIndices.push(dcIndex); }
    } else {
      game.p2ActivationsRemaining--;
      const dcIndex = (game.p2DcMessageIds || []).indexOf(msgId);
      if (dcIndex !== -1) { game.p2ActivatedDcIndices = game.p2ActivatedDcIndices || []; game.p2ActivatedDcIndices.push(dcIndex); }
    }
    await updateActivationsMessage(game, meta.playerNum, client);
    const displayName = meta.displayName || meta.dcName;
    const playAreaId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
    const playChannel = await client.channels.fetch(playAreaId);
    const dcMsg = await playChannel.messages.fetch(msgId);
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, displayName, dcHealthState.get(msgId) ?? [[null, null]]);
    await dcMsg.edit({ embeds: [embed], files, components: [getDcToggleButton(msgId, true)] });
    const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
    const thread = await dcMsg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
    game.movementBank = game.movementBank || {};
    game.movementBank[msgId] = { total: 0, remaining: 0, threadId: thread.id, messageId: null, displayName };
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id };
    const pingContent = `<@${ownerId}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
    const actionsMsg = await thread.send({
      content: pingContent,
      components: getDcActionButtons(msgId, meta.dcName, displayName, DC_ACTIONS_PER_ACTIVATION, game),
      allowedMentions: { users: [ownerId] },
    });
    game.dcActionsData[msgId].messageId = actionsMsg.id;
    const logCh = await client.channels.fetch(game.generalId);
    const icon = ACTION_ICONS.activate || '⚡';
    const pLabel = `P${meta.playerNum}`;
    const logMsg = await logCh.send({
      content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${ownerId}> activated **${displayName}**!`,
      allowedMentions: { users: [ownerId] },
    });
    game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
    game.dcActivationLogMessageIds[msgId] = logMsg.id;
    if (activateCardMsgId) {
      try {
        const activateCardMsg = await logCh.messages.fetch(activateCardMsgId);
        const activateRows = getActivateDcButtons(game, meta.playerNum);
        await activateCardMsg.edit({ content: '**Activate a Deployment Card**', components: activateRows.length > 0 ? activateRows : [] }).catch(() => {});
      } catch {}
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('cancel_activate_')) {
    const match = interaction.customId.match(/^cancel_activate_([^_]+)_(.+)$/);
    if (!match) return;
    const [, gameId, ownerId] = match;
    if (interaction.user.id !== ownerId) return;
    await interaction.deferUpdate();
    await interaction.message.edit({ components: [] }).catch(() => {});
    return;
  }

  if (interaction.customId.startsWith('interact_cancel_')) {
    const match = interaction.customId.match(/^interact_cancel_([^_]+)_(.+)_(\d+)$/);
    if (!match) return;
    const [, gameId, msgId, figureIdxStr] = match;
    const game = games.get(gameId);
    if (!game) return;
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.gameId !== gameId) return;
    const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) return;
    await interaction.deferUpdate();
    await interaction.message.edit({ components: [] }).catch(() => {});
    return;
  }

  if (interaction.customId.startsWith('interact_choice_')) {
    const match = interaction.customId.match(/^interact_choice_([^_]+)_(.+)_(\d+)_(.+)$/);
    if (!match) return;
    const [, gameId, msgId, figureIdxStr, optionId] = match;
    const figureIndex = parseInt(figureIdxStr, 10);
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.gameId !== gameId) {
      await interaction.reply({ content: 'Invalid.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner can perform this action.', ephemeral: true }).catch(() => {});
      return;
    }
    const actionsData = game.dcActionsData?.[msgId];
    if ((actionsData?.remaining ?? 2) <= 0) {
      await interaction.reply({ content: 'No actions remaining this activation.', ephemeral: true }).catch(() => {});
      return;
    }
    const dgIndex = (meta.displayName || '').match(/\[Group (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
    const playerNum = meta.playerNum;
    const mapId = game.selectedMap?.id;
    const options = mapId ? getLegalInteractOptions(game, playerNum, figureKey, mapId) : [];
    const opt = options.find((o) => o.id === optionId);
    if (!opt) {
      await interaction.reply({ content: 'That interact is no longer valid.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    await interaction.message.edit({ components: [] }).catch(() => {});

    actionsData.remaining = Math.max(0, (actionsData?.remaining ?? 2) - 1);
    await updateDcActionsMessage(game, msgId, interaction.client);

    const stats = getDcStats(meta.dcName);
    const displayName = meta.displayName || meta.dcName;
    const shortName = (displayName || meta.dcName || '').replace(/\s*\[Group \d+\]$/, '') || displayName;
    const figLabel = (stats.figures ?? 1) > 1 ? `${shortName} ${FIGURE_LETTERS[figureIndex] || 'a'}` : shortName;
    const pLabel = `P${playerNum}`;

    if (optionId === 'retrieve_contraband') {
      game.figureContraband = game.figureContraband || {};
      game.figureContraband[figureKey] = true;
      await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** retrieved contraband!`, { phase: 'ROUND', icon: 'deploy' });
    } else if (optionId.startsWith('launch_panel_')) {
      const parts = optionId.replace('launch_panel_', '').split('_');
      const coord = parts[0];
      const side = parts[1];
      game.launchPanelState = game.launchPanelState || {};
      game.launchPanelState[coord.toLowerCase()] = side;
      if (playerNum === 1) game.p1LaunchPanelFlippedThisRound = true;
      else game.p2LaunchPanelFlippedThisRound = true;
      const upper = String(coord).toUpperCase();
      await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** flipped Launch Panel (${upper}) to **${side}**.`, { phase: 'ROUND', icon: 'deploy' });
    } else if (optionId === 'use_terminal') {
      await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** used terminal.`, { phase: 'ROUND', icon: 'deploy' });
    } else if (optionId.startsWith('open_door_')) {
      const edgeKey = optionId.replace('open_door_', '');
      game.openedDoors = game.openedDoors || [];
      if (!game.openedDoors.includes(edgeKey)) game.openedDoors.push(edgeKey);
      const doorLabel = edgeKey.split('|').map((s) => s.toUpperCase()).join('–');
      await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** opened door (${doorLabel}).`, { phase: 'ROUND', icon: 'deploy' });
    } else {
      await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** — ${opt.label}.`, { phase: 'ROUND', icon: 'deploy' });
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('refresh_map_')) {
    const gameId = interaction.customId.replace('refresh_map_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can refresh the map.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!game.selectedMap) {
      await interaction.reply({ content: 'No map selected yet.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to refresh map:', err);
      await interaction.followUp({ content: 'Failed to refresh map.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith('refresh_all_')) {
    const gameId = interaction.customId.replace('refresh_all_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can refresh.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    try {
      await refreshAllGameComponents(game, client);
      await interaction.followUp({ content: '✓ Refreshed all components (map, DCs, hand).', ephemeral: true }).catch(() => {});
    } catch (err) {
      console.error('Failed to refresh all:', err);
      await interaction.followUp({ content: 'Failed to refresh: ' + (err?.message || String(err)), ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith('undo_')) {
    const gameId = interaction.customId.replace('undo_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can use Undo.', ephemeral: true }).catch(() => {});
      return;
    }
    const last = game.undoStack?.pop();
    if (!last) {
      await interaction.reply({ content: 'Nothing to undo yet.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.currentRound) {
      await interaction.reply({ content: 'Undo is only available during deployment.', ephemeral: true }).catch(() => {});
      return;
    }
    if (last.type === 'deploy_pick') {
      if (game.figurePositions?.[last.playerNum]) {
        delete game.figurePositions[last.playerNum][last.figureKey];
      }
      if (game.figureOrientations?.[last.figureKey]) {
        delete game.figureOrientations[last.figureKey];
      }
      await updateDeployPromptMessages(game, last.playerNum, client);
      if (game.boardId && game.selectedMap) {
        try {
          const boardChannel = await client.channels.fetch(game.boardId);
          const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        } catch (err) {
          console.error('Failed to update map after undo:', err);
        }
      }
      await logGameAction(game, client, `<@${interaction.user.id}> undid deployment of **${last.figLabel}** at **${last.space}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
      saveGames();
      await interaction.reply({ content: 'Last deployment undone.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.reply({ content: 'That action cannot be undone yet.', ephemeral: true }).catch(() => {});
    return;
  }

  if (interaction.customId.startsWith('determine_initiative_')) {
    const gameId = interaction.customId.replace('determine_initiative_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can determine initiative.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.initiativeDetermined) {
      await interaction.reply({ content: 'Initiative was already determined.', ephemeral: true }).catch(() => {});
      return;
    }
    const missing = [];
    if (!game.player1Squad) missing.push(`<@${game.player1Id}> (Player 1)`);
    if (!game.player2Squad) missing.push(`<@${game.player2Id}> (Player 2)`);
    if (missing.length > 0) {
      await interaction.reply({ content: 'Both players must select their squads before initiative can be determined.', ephemeral: true }).catch(() => {});
      const generalChannel = await client.channels.fetch(game.generalId).catch(() => null);
      if (generalChannel) {
        await generalChannel.send({
          content: `⚠️ **Initiative blocked** — Squad selection required first.\n\nStill needed: ${missing.join(', ')}`,
          allowedMentions: { users: [...new Set([game.player1Id, game.player2Id])] },
        }).catch(() => {});
      }
      return;
    }
    const winner = Math.random() < 0.5 ? game.player1Id : game.player2Id;
    const playerNum = winner === game.player1Id ? 1 : 2;
    game.initiativePlayerId = winner;
    game.initiativeDetermined = true;
    await interaction.deferUpdate();
    await clearPreGameSetup(game, client);
    await logGameAction(game, client, `<@${winner}> (**Player ${playerNum}**) won initiative! Chooses deployment zone and activates first each round.`, { allowedMentions: { users: [winner] }, phase: 'INITIATIVE', icon: 'initiative' });
    const generalChannel = await client.channels.fetch(game.generalId);
    const zoneMsg = await generalChannel.send({
      content: `<@${winner}> (**Player ${playerNum}**) — Pick your deployment zone:`,
      allowedMentions: { users: [winner] },
      components: [getDeploymentZoneButtons(gameId)],
    });
    game.deploymentZoneMessageId = zoneMsg.id;
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('deployment_zone_red_') || interaction.customId.startsWith('deployment_zone_blue_')) {
    const isRed = interaction.customId.startsWith('deployment_zone_red_');
    const gameId = interaction.customId.replace(isRed ? 'deployment_zone_red_' : 'deployment_zone_blue_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.initiativePlayerId) {
      await interaction.reply({ content: 'Only the player with initiative can choose the deployment zone.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.deploymentZoneChosen) {
      await interaction.reply({ content: `Deployment zone already chosen: **${game.deploymentZoneChosen}**.`, ephemeral: true }).catch(() => {});
      return;
    }
    const zone = isRed ? 'red' : 'blue';
    game.deploymentZoneChosen = zone;
    await interaction.deferUpdate();
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    await logGameAction(game, client, `<@${game.initiativePlayerId}> (**Player ${initiativePlayerNum}**) chose the **${zone}** deployment zone`, { allowedMentions: { users: [game.initiativePlayerId] }, phase: 'INITIATIVE', icon: 'zone' });
    if (game.deploymentZoneMessageId) {
      try {
        const generalChannel = await client.channels.fetch(game.generalId);
        const zoneMsg = await generalChannel.messages.fetch(game.deploymentZoneMessageId);
        await zoneMsg.edit({ content: `~~Pick your deployment zone~~ — **${zone}** chosen.`, components: [] });
      } catch (err) {
        console.error('Failed to remove deployment zone buttons:', err);
      }
    }
    const initiativeHandId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
    const initiativeSquad = initiativePlayerNum === 1 ? game.player1Squad : game.player2Squad;
    const initiativeDcList = initiativeSquad?.dcList || [];
    const { labels: initiativeLabels, metadata: initiativeMetadata } = getDeployFigureLabels(initiativeDcList);
    const deployLabelsKey = initiativePlayerNum === 1 ? 'player1DeployLabels' : 'player2DeployLabels';
    const deployMetadataKey = initiativePlayerNum === 1 ? 'player1DeployMetadata' : 'player2DeployMetadata';
    game[deployLabelsKey] = initiativeLabels;
    game[deployMetadataKey] = initiativeMetadata;
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    try {
      const initiativeHandChannel = await client.channels.fetch(initiativeHandId);
      const { deployRows, doneRow } = getDeployButtonRows(game.gameId, initiativePlayerNum, initiativeDcList, zone, game.figurePositions);
      const DEPLOY_ROWS_PER_MSG = 4;
      game.initiativeDeployMessageIds = game.initiativeDeployMessageIds || [];
      const initiativePing = `<@${game.initiativePlayerId}>`;
      if (deployRows.length === 0) {
        const msg = await initiativeHandChannel.send({
          content: `${initiativePing} — You chose the **${zone}** zone. When finished, click **Deployment Completed** below.`,
          components: [doneRow],
          allowedMentions: { users: [game.initiativePlayerId] },
        });
        game.initiativeDeployMessageIds = [msg.id];
      } else {
        for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
          const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
          const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
          const components = isLastChunk ? [...chunk, doneRow] : chunk;
          const msg = await initiativeHandChannel.send({
            content: i === 0 ? `${initiativePing} — You chose the **${zone}** zone. Deploy each figure below (one per row), then click **Deployment Completed** when finished.` : null,
            components,
            allowedMentions: { users: [game.initiativePlayerId] },
          });
          game.initiativeDeployMessageIds.push(msg.id);
        }
      }
      game.initiativeDeployMessageId = game.initiativeDeployMessageIds[game.initiativeDeployMessageIds.length - 1];
    } catch (err) {
      console.error('Failed to send deploy prompt to initiative player:', err);
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('deployment_fig_')) {
    const parts = interaction.customId.split('_');
    if (parts.length < 5) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const gameId = parts[2];
    const playerNum = parseInt(parts[3], 10);
    const flatIndex = parseInt(parts[4], 10);
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
      return;
    }
    const labels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
    const label = labels?.[flatIndex];
    if (!label) {
      await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const mapId = game.selectedMap?.id;
    const zones = mapId ? deploymentZones[mapId] : null;
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
    const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
    const figMeta = deployMeta?.[flatIndex];
    const figureKey = figMeta ? `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}` : null;
    const occupied = [];
    if (game.figurePositions) {
      for (const p of [1, 2]) {
        for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
          if (p === playerNum && k === figureKey) continue;
          const dcName = k.replace(/-\d+-\d+$/, '');
          const size = game.figureOrientations?.[k] || getFigureSize(dcName);
          occupied.push(...getFootprintCells(s, size));
        }
      }
    }
    const zoneSpaces = (zones?.[playerZone] || []).map((s) => String(s).toLowerCase());
    const dcName = figMeta?.dcName;
    const figureSize = dcName ? getFigureSize(dcName) : '1x1';
    const isLarge = figureSize !== '1x1';
    const needsOrientation = figureSize === '2x3';
    if (zoneSpaces.length > 0 && needsOrientation) {
      const orientationRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`deployment_orient_${gameId}_${playerNum}_${flatIndex}_2x3`)
          .setLabel('2×3 (2 wide, 3 tall)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`deployment_orient_${gameId}_${playerNum}_${flatIndex}_3x2`)
          .setLabel('3×2 (3 wide, 2 tall)')
          .setStyle(ButtonStyle.Primary)
      );
      await interaction.reply({
        content: `Choose orientation for **${label.replace(/^Deploy /, '')}** (large unit):`,
        components: [orientationRow],
        ephemeral: false,
      }).catch(() => {});
      return;
    }
    const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, figureSize);
    if (zoneSpaces.length > 0) {
      const { rows, available } = getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, [], playerZone);
      if (available.length === 0) {
        await interaction.reply({ content: 'No spaces left in your deployment zone (all occupied or no valid spot for this size).', ephemeral: true }).catch(() => {});
        return;
      }
      const BTM_PER_MSG = 5;
      const firstRows = rows.slice(0, BTM_PER_MSG);
      game.deploySpaceGridMessageIds = game.deploySpaceGridMessageIds || {};
      const gridKey = `${playerNum}_${flatIndex}`;
      const promptText = isLarge
        ? `Pick the **top-left square** for **${label.replace(/^Deploy /, '')}** (${figureSize} unit):`
        : `Pick a space for **${label.replace(/^Deploy /, '')}**:`;
      const replyMsg = await interaction.reply({
        content: promptText,
        components: firstRows,
        ephemeral: false,
        fetchReply: true,
      }).catch(() => null);
      const gridIds = [];
      if (replyMsg?.id) gridIds.push(replyMsg.id);
      for (let i = BTM_PER_MSG; i < rows.length; i += BTM_PER_MSG) {
        const more = rows.slice(i, i + BTM_PER_MSG);
        if (more.length > 0) {
          const followMsg = await interaction.followUp({ content: null, components: more, fetchReply: true }).catch(() => null);
          if (followMsg?.id) gridIds.push(followMsg.id);
        }
      }
      game.deploySpaceGridMessageIds[gridKey] = gridIds;
    } else {
      const modal = new ModalBuilder()
        .setCustomId(`deploy_modal_${gameId}_${playerNum}_${flatIndex}`)
        .setTitle('Deploy figure');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('deploy_space')
            .setLabel('Space (e.g. A1)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. A1')
            .setRequired(true)
        )
      );
      await interaction.showModal(modal).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith('deployment_orient_')) {
    const parts = interaction.customId.split('_');
    if (parts.length < 6) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const gameId = parts[2];
    const playerNum = parseInt(parts[3], 10);
    const flatIndex = parseInt(parts[4], 10);
    const orientation = parts[5];
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
      return;
    }
    const labels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
    const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
    const label = labels?.[flatIndex];
    const figMeta = deployMeta?.[flatIndex];
    if (!label || !figMeta) {
      await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
    game.pendingDeployOrientation = game.pendingDeployOrientation || {};
    game.pendingDeployOrientation[`${playerNum}_${flatIndex}`] = orientation;
    const mapId = game.selectedMap?.id;
    const zones = mapId ? deploymentZones[mapId] : null;
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
    const occupied = [];
    if (game.figurePositions) {
      for (const p of [1, 2]) {
        for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
          if (p === playerNum && k === figureKey) continue;
          const dcName = k.replace(/-\d+-\d+$/, '');
          const size = game.figureOrientations?.[k] || getFigureSize(dcName);
          occupied.push(...getFootprintCells(s, size));
        }
      }
    }
    const zoneSpaces = (zones?.[playerZone] || []).map((s) => String(s).toLowerCase());
    const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, orientation);
    if (validSpaces.length === 0) {
      delete game.pendingDeployOrientation[`${playerNum}_${flatIndex}`];
      await interaction.reply({ content: 'No valid spots for this orientation in your zone. Try the other orientation.', ephemeral: true }).catch(() => {});
      return;
    }
    const { rows, available } = getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, [], playerZone);
    const BTM_PER_MSG = 5;
    const firstRows = rows.slice(0, BTM_PER_MSG);
    game.deploySpaceGridMessageIds = game.deploySpaceGridMessageIds || {};
    const gridKey = `${playerNum}_${flatIndex}`;
    await interaction.deferUpdate();
    const gridIds = [];
    try {
      await interaction.message.edit({
        content: `Pick the **top-left square** for **${label.replace(/^Deploy /, '')}** (${orientation} unit):`,
        components: firstRows,
      });
      if (interaction.message?.id) gridIds.push(interaction.message.id);
      for (let i = BTM_PER_MSG; i < rows.length; i += BTM_PER_MSG) {
        const more = rows.slice(i, i + BTM_PER_MSG);
        if (more.length > 0) {
          const sent = await interaction.channel.send({ content: null, components: more });
          if (sent?.id) gridIds.push(sent.id);
        }
      }
    } catch (err) {
      console.error('Failed to show deploy grid after orientation:', err);
    }
    game.deploySpaceGridMessageIds[gridKey] = gridIds;
    return;
  }

  if (interaction.customId.startsWith('deploy_pick_')) {
    const match = interaction.customId.match(/^deploy_pick_([^_]+)_(\d+)_(\d+)_(.+)$/);
    if (!match) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const [, gameId, playerNumStr, flatIndexStr, space] = match;
    const playerNum = parseInt(playerNumStr, 10);
    const flatIndex = parseInt(flatIndexStr, 10);
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
      return;
    }
    const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
    const deployLabels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
    const figMeta = deployMeta?.[flatIndex];
    const figLabel = deployLabels?.[flatIndex];
    if (!figMeta || !figLabel) {
      await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
    game.figurePositions[playerNum][figureKey] = space.toLowerCase();
    const pendingOrientation = game.pendingDeployOrientation?.[`${playerNum}_${flatIndex}`];
    if (pendingOrientation) {
      game.figureOrientations = game.figureOrientations || {};
      game.figureOrientations[figureKey] = pendingOrientation;
      delete game.pendingDeployOrientation[`${playerNum}_${flatIndex}`];
    }
    saveGames();
    const spaceUpper = space.toUpperCase();
    const gridKey = `${playerNum}_${flatIndex}`;
    const gridMsgIds = game.deploySpaceGridMessageIds?.[gridKey] || [];
    const clickedMsgId = interaction.message?.id;
    if (gridMsgIds.length > 0) {
      try {
        const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
        const handChannel = await client.channels.fetch(handId);
        for (const msgId of gridMsgIds) {
          if (msgId === clickedMsgId) continue;
          try {
            const msg = await handChannel.messages.fetch(msgId);
            await msg.delete();
          } catch {}
        }
      } catch (err) {
        console.error('Failed to delete space grid messages:', err);
      }
      if (game.deploySpaceGridMessageIds) {
        delete game.deploySpaceGridMessageIds[gridKey];
      }
    }
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const isInitiative = playerNum === initiativePlayerNum;
    const confirmIdsKey = isInitiative ? 'initiativeDeployedConfirmIds' : 'nonInitiativeDeployedConfirmIds';
    if (clickedMsgId) {
      game[confirmIdsKey] = game[confirmIdsKey] || [];
      game[confirmIdsKey].push(clickedMsgId);
    }
    await logGameAction(game, client, `<@${interaction.user.id}> deployed **${figLabel.replace(/^Deploy /, '')}** at **${spaceUpper}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
    pushUndo(game, {
      type: 'deploy_pick',
      playerNum,
      figureKey,
      space: spaceUpper,
      figLabel: figLabel.replace(/^Deploy /, ''),
    });
    await updateDeployPromptMessages(game, playerNum, client);
    if (game.boardId && game.selectedMap) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to update map after deployment:', err);
      }
    }
    await interaction.editReply({
      content: `✓ Deployed **${figLabel.replace(/^Deploy /, '')}** at **${spaceUpper}**.`,
      components: [],
    }).catch(() => {});
    return;
  }

  if (interaction.customId.startsWith('deployment_done_')) {
    const gameId = interaction.customId.replace('deployment_done_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can use this.', ephemeral: true }).catch(() => {});
      return;
    }
    const channelId = interaction.channel?.id;
    const isP1Hand = channelId === game.p1HandId;
    const isP2Hand = channelId === game.p2HandId;
    if (!isP1Hand && !isP2Hand) {
      await interaction.reply({ content: 'Use the Deployment Completed button in your Hand channel.', ephemeral: true }).catch(() => {});
      return;
    }
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const isInitiativeSide = (isP1Hand && initiativePlayerNum === 1) || (isP2Hand && initiativePlayerNum === 2);
    const otherZone = game.deploymentZoneChosen === 'red' ? 'blue' : 'red';

    if (isInitiativeSide) {
      if (game.initiativePlayerDeployed) {
        await interaction.reply({ content: "You've already marked deployed.", ephemeral: true }).catch(() => {});
        return;
      }
      game.initiativePlayerDeployed = true;
      await logGameAction(game, client, `<@${interaction.user.id}> finished deploying`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deployed' });
      await interaction.deferUpdate();
      const initiativeHandId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
      try {
        const handChannel = await client.channels.fetch(initiativeHandId);
        const toDelete = [...(game.initiativeDeployMessageIds || []), ...(game.initiativeDeployedConfirmIds || [])];
        for (const msgId of toDelete) {
          try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
        }
        game.initiativeDeployMessageIds = [];
        game.initiativeDeployedConfirmIds = [];
        await handChannel.send({ content: '✓ **Deployed.**' });
      } catch (err) {
        console.error('Failed to update initiative deploy message:', err);
      }
      if (game.boardId && game.selectedMap) {
        try {
          const boardChannel = await client.channels.fetch(game.boardId);
          const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        } catch (err) {
          console.error('Failed to update map after initiative deployment:', err);
        }
      }
      const nonInitiativeHandId = game.initiativePlayerId === game.player1Id ? game.p2HandId : game.p1HandId;
      const nonInitiativePlayerNum = game.initiativePlayerId === game.player1Id ? 2 : 1;
      const nonInitiativeSquad = nonInitiativePlayerNum === 1 ? game.player1Squad : game.player2Squad;
      const nonInitiativeDcList = nonInitiativeSquad?.dcList || [];
      const { labels: nonInitiativeLabels, metadata: nonInitiativeMetadata } = getDeployFigureLabels(nonInitiativeDcList);
      const deployLabelsKey = nonInitiativePlayerNum === 1 ? 'player1DeployLabels' : 'player2DeployLabels';
      const deployMetadataKey = nonInitiativePlayerNum === 1 ? 'player1DeployMetadata' : 'player2DeployMetadata';
      game[deployLabelsKey] = nonInitiativeLabels;
      game[deployMetadataKey] = nonInitiativeMetadata;
      if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
      try {
        const nonInitiativePlayerId = nonInitiativePlayerNum === 1 ? game.player1Id : game.player2Id;
        const nonInitiativeHandChannel = await client.channels.fetch(nonInitiativeHandId);
        const { deployRows, doneRow } = getDeployButtonRows(gameId, nonInitiativePlayerNum, nonInitiativeDcList, otherZone, game.figurePositions);
        const DEPLOY_ROWS_PER_MSG = 4;
        game.nonInitiativeDeployMessageIds = game.nonInitiativeDeployMessageIds || [];
        game.nonInitiativeDeployedConfirmIds = game.nonInitiativeDeployedConfirmIds || [];
        const nonInitiativePing = `<@${nonInitiativePlayerId}>`;
        if (deployRows.length === 0) {
          const msg = await nonInitiativeHandChannel.send({
            content: `${nonInitiativePing} — Your opponent has deployed. Deploy in the **${otherZone}** zone. When finished, click **Deployment Completed** below.`,
            components: [doneRow],
            allowedMentions: { users: [nonInitiativePlayerId] },
          });
          game.nonInitiativeDeployMessageIds = [msg.id];
        } else {
          for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
            const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
            const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
            const components = isLastChunk ? [...chunk, doneRow] : chunk;
            const msg = await nonInitiativeHandChannel.send({
              content: i === 0 ? `${nonInitiativePing} — Your opponent has deployed. Deploy each figure in the **${otherZone}** zone below (one per row), then click **Deployment Completed** when finished.` : null,
              components,
              allowedMentions: { users: [nonInitiativePlayerId] },
            });
            game.nonInitiativeDeployMessageIds.push(msg.id);
          }
        }
        game.nonInitiativeDeployMessageId = game.nonInitiativeDeployMessageIds[game.nonInitiativeDeployMessageIds.length - 1];
      } catch (err) {
        console.error('Failed to send deploy prompt to non-initiative player:', err);
      }
      saveGames();
      return;
    }

    if (!game.initiativePlayerDeployed) {
      await interaction.reply({ content: 'Wait for the initiative player to deploy first.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.nonInitiativePlayerDeployed) {
      await interaction.reply({ content: "You've already marked deployed.", ephemeral: true }).catch(() => {});
      return;
    }
    game.nonInitiativePlayerDeployed = true;
    await interaction.deferUpdate();
    const nonInitiativeHandId = game.initiativePlayerId === game.player1Id ? game.p2HandId : game.p1HandId;
    try {
      const handChannel = await client.channels.fetch(nonInitiativeHandId);
      const toDelete = [...(game.nonInitiativeDeployMessageIds || []), ...(game.nonInitiativeDeployedConfirmIds || [])];
      for (const msgId of toDelete) {
        try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
      }
      game.nonInitiativeDeployMessageIds = [];
      game.nonInitiativeDeployedConfirmIds = [];
      await handChannel.send({ content: '✓ **Deployed.**' });
    } catch (err) {
      console.error('Failed to update non-initiative deploy message:', err);
    }
    game.currentRound = 1;
    const generalChannel = await client.channels.fetch(game.generalId);
    const roundEmbed = new EmbedBuilder()
      .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND 1`)
      .setColor(PHASE_COLOR);
    const showBtn = shouldShowEndActivationPhaseButton(game, gameId);
    const components = showBtn ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel('End R1 Activation Phase')
        .setStyle(ButtonStyle.Secondary)
    )] : [];
    const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const content = showBtn
      ? `<@${game.initiativePlayerId}> (**Player ${initPlayerNum}**) **Both players have deployed.** Both players: draw your starting hands below. After both have drawn, the **Start of Round** window begins. Then click **End R1 Activation Phase** when you've used all activations.`
      : `<@${game.initiativePlayerId}> (**Player ${initPlayerNum}**) **Both players have deployed.** Both players: draw your starting hands below. After both have drawn, the **Start of Round** window begins.`;
    const sent = await generalChannel.send({
      content,
      embeds: [roundEmbed],
      components,
      allowedMentions: { users: [game.initiativePlayerId] },
    });
    game.roundActivationMessageId = sent.id;
    game.roundActivationButtonShown = showBtn;
    game.currentActivationTurnPlayerId = game.initiativePlayerId;
    await clearPreGameSetup(game, client);
    try {
      const p1HandChannel = await client.channels.fetch(game.p1HandId);
      const p2HandChannel = await client.channels.fetch(game.p2HandId);
      const p1CcList = game.player1Squad?.ccList || [];
      const p2CcList = game.player2Squad?.ccList || [];
      const ccDeckText = (list) => list.length ? list.join(', ') : '(no command cards)';
      await p1HandChannel.send({
        content: `**Your Command Card deck** (${p1CcList.length} cards):\n${ccDeckText(p1CcList)}\n\nWhen ready, shuffle and draw your starting 3.`,
        components: [getCcShuffleDrawButton(gameId)],
      });
      await p2HandChannel.send({
        content: `**Your Command Card deck** (${p2CcList.length} cards):\n${ccDeckText(p2CcList)}\n\nWhen ready, shuffle and draw your starting 3.`,
        components: [getCcShuffleDrawButton(gameId)],
      });
    } catch (err) {
      console.error('Failed to send CC deck prompt:', err);
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('cc_shuffle_draw_')) {
    const gameId = interaction.customId.replace('cc_shuffle_draw_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const channelId = interaction.channel?.id;
    const isP1Hand = channelId === game.p1HandId;
    const isP2Hand = channelId === game.p2HandId;
    if (!isP1Hand && !isP2Hand) {
      await interaction.reply({ content: 'Use this in your Hand channel.', ephemeral: true }).catch(() => {});
      return;
    }
    const playerNum = isP1Hand ? 1 : 2;
    const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
    const ccList = squad?.ccList || [];
    const drawnKey = playerNum === 1 ? 'player1CcDrawn' : 'player2CcDrawn';
    if (game[drawnKey]) {
      await interaction.reply({ content: "You've already drawn your starting hand.", ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    const deck = [...ccList];
    shuffleArray(deck);
    const hand = deck.splice(0, 3);
    const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    game[deckKey] = deck;
    game[handKey] = hand;
    game[drawnKey] = true;
    const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
    await interaction.message.edit({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    }).catch(() => {});
    await updateHandVisualMessage(game, playerNum, client);
    if (game.player1CcDrawn && game.player2CcDrawn) {
      game.startOfRoundWhoseTurn = game.initiativePlayerId;
      const generalChannel = await client.channels.fetch(game.generalId);
      const initNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
      const otherId = game.initiativePlayerId === game.player1Id ? game.player2Id : game.player1Id;
      await logGameAction(game, client, `**Start of Round** — 1. Mission Rules/Effects (resolve as needed). 2. <@${game.initiativePlayerId}> (Initiative). 3. <@${game.initiativePlayerId === game.player1Id ? game.player2Id : game.player1Id}>. 4. Go. Initiative player: play any start-of-round effects/CCs, then click **End 'Start of Round' window** in your Hand.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [game.initiativePlayerId] } });
      const startRoundEmbed = new EmbedBuilder()
        .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND 1 — Start of Round window`)
        .setDescription(`1. Mission Rules/Effects 2. <@${game.initiativePlayerId}> (Initiative) 3. <@${otherId}>. Both must click **End 'Start of Round' window** in their Hand.`)
        .setColor(PHASE_COLOR);
      await generalChannel.send({
        content: `**Start of Round** — <@${game.initiativePlayerId}> (Player ${initNum}), play any start-of-round effects/CCs, then click **End 'Start of Round' window** in your Hand.`,
        embeds: [startRoundEmbed],
        allowedMentions: { users: [game.initiativePlayerId] },
      });
      await updateHandChannelMessages(game, client);
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('cc_play_')) {
    const gameId = interaction.customId.replace('cc_play_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const channelId = interaction.channel?.id;
    const isP1Hand = channelId === game.p1HandId;
    const isP2Hand = channelId === game.p2HandId;
    if (!isP1Hand && !isP2Hand) {
      await interaction.reply({ content: 'Use this in your Hand channel.', ephemeral: true }).catch(() => {});
      return;
    }
    const playerNum = isP1Hand ? 1 : 2;
    const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
    if (hand.length === 0) {
      await interaction.reply({ content: 'No cards in hand to play.', ephemeral: true }).catch(() => {});
      return;
    }
    const select = new StringSelectMenuBuilder()
      .setCustomId(`cc_play_select_${gameId}`)
      .setPlaceholder('Choose a card to play')
      .addOptions(hand.slice(0, 25).map((c) => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c)));
    await interaction.reply({
      content: '**Play CC** — Select a card:',
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: false,
    });
    return;
  }

  if (interaction.customId.startsWith('cc_draw_')) {
    const gameId = interaction.customId.replace('cc_draw_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const channelId = interaction.channel?.id;
    const isP1Hand = channelId === game.p1HandId;
    const isP2Hand = channelId === game.p2HandId;
    if (!isP1Hand && !isP2Hand) {
      await interaction.reply({ content: 'Use this in your Hand channel.', ephemeral: true }).catch(() => {});
      return;
    }
    const playerNum = isP1Hand ? 1 : 2;
    const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    let deck = (game[deckKey] || []).slice();
    const hand = (game[handKey] || []).slice();
    if (deck.length === 0) {
      await interaction.reply({ content: 'No cards in deck to draw.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    const card = deck.shift();
    hand.push(card);
    game[deckKey] = deck;
    game[handKey] = hand;
    const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
    handPayload.content = `**Draw CC** — Drew **${card}**.\n\n` + handPayload.content;
    await interaction.message.edit({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    }).catch(() => {});
    await updateHandVisualMessage(game, playerNum, client);
    await logGameAction(game, client, `<@${interaction.user.id}> drew **${card}**`, { allowedMentions: { users: [interaction.user.id] }, icon: 'card' });
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('cc_search_discard_')) {
    const match = interaction.customId.match(/^cc_search_discard_([^_]+)_(\d+)$/);
    if (!match) return;
    const [, gameId, playerNumStr] = match;
    const playerNum = parseInt(playerNumStr, 10);
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const channelId = interaction.channel?.id;
    const isP1Area = channelId === game.p1PlayAreaId;
    const isP2Area = channelId === game.p2PlayAreaId;
    if ((!isP1Area && !isP2Area) || (isP1Area && playerNum !== 1) || (isP2Area && playerNum !== 2)) {
      await interaction.reply({ content: 'Use this in your Play Area.', ephemeral: true }).catch(() => {});
      return;
    }
    const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== playerId) {
      await interaction.reply({ content: 'Only the owner of this Play Area can search their discard pile.', ephemeral: true }).catch(() => {});
      return;
    }
    const existingThreadId = playerNum === 1 ? game.p1DiscardThreadId : game.p2DiscardThreadId;
    if (existingThreadId) {
      try {
        const existing = await client.channels.fetch(existingThreadId);
        if (existing) {
          await interaction.reply({ content: 'Discard pile thread is already open. Close it first.', ephemeral: true }).catch(() => {});
          return;
        }
      } catch { /* thread was deleted */ }
      if (playerNum === 1) delete game.p1DiscardThreadId;
      else delete game.p2DiscardThreadId;
    }
    await interaction.deferUpdate();
    const discard = playerNum === 1 ? (game.player1CcDiscard || []) : (game.player2CcDiscard || []);
    const threadName = `Discard Pile (${discard.length} cards)`;
    const thread = await interaction.message.startThread({
      name: threadName.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });
    if (playerNum === 1) game.p1DiscardThreadId = thread.id;
    else game.p2DiscardThreadId = thread.id;
    const chunks = buildDiscardPileDisplayPayload(discard);
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cc_close_discard_${gameId}_${playerNum}`)
        .setLabel('Close Discard Pile')
        .setStyle(ButtonStyle.Danger)
    );
    if (chunks.length === 0) {
      await thread.send({
        content: 'Discard pile is empty.',
        embeds: [new EmbedBuilder().setTitle('Command Cards in Discard Pile').setDescription('*Empty*').setColor(0x2f3136)],
        components: [closeRow],
      });
    } else {
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        await thread.send({
          embeds: chunks[i].embeds,
          files: chunks[i].files,
          components: isLast ? [closeRow] : [],
        });
      }
    }
    await updateDiscardPileMessage(game, playerNum, client);
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('cc_close_discard_')) {
    const match = interaction.customId.match(/^cc_close_discard_([^_]+)_(\d+)$/);
    if (!match) return;
    const [, gameId, playerNumStr] = match;
    const playerNum = parseInt(playerNumStr, 10);
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const threadId = playerNum === 1 ? game.p1DiscardThreadId : game.p2DiscardThreadId;
    if (!threadId) {
      await interaction.reply({ content: 'No discard pile thread is open.', ephemeral: true }).catch(() => {});
      return;
    }
    const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== playerId) {
      await interaction.reply({ content: 'Only the owner can close the discard pile thread.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    try {
      const thread = await client.channels.fetch(threadId);
      await thread.delete();
    } catch (err) {
      console.error('Failed to delete discard pile thread:', err);
    }
    if (playerNum === 1) delete game.p1DiscardThreadId;
    else delete game.p2DiscardThreadId;
    await updateDiscardPileMessage(game, playerNum, client);
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('cc_discard_')) {
    const gameId = interaction.customId.replace('cc_discard_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const channelId = interaction.channel?.id;
    const isP1Hand = channelId === game.p1HandId;
    const isP2Hand = channelId === game.p2HandId;
    if (!isP1Hand && !isP2Hand) {
      await interaction.reply({ content: 'Use this in your Hand channel.', ephemeral: true }).catch(() => {});
      return;
    }
    const playerNum = isP1Hand ? 1 : 2;
    const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
    if (hand.length === 0) {
      await interaction.reply({ content: 'No cards in hand to discard.', ephemeral: true }).catch(() => {});
      return;
    }
    const select = new StringSelectMenuBuilder()
      .setCustomId(`cc_discard_select_${gameId}`)
      .setPlaceholder('Choose a card to discard')
      .addOptions(hand.slice(0, 25).map((c) => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c)));
    await interaction.reply({
      content: '**Discard CC** — Select a card to discard:',
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: false,
    });
    return;
  }

  if (interaction.customId.startsWith('kill_game_')) {
    const gameId = interaction.customId.replace('kill_game_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found or already deleted.', ephemeral: true });
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can kill it.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      let categoryId = game.gameCategoryId;
      if (!categoryId) {
        const generalCh = await client.channels.fetch(game.generalId).catch(() => null);
        categoryId = generalCh?.parentId;
      }
      if (!categoryId) {
        await interaction.editReply({ content: 'Could not find game category.' });
        return;
      }
      const guild = interaction.guild;
      const category = await guild.channels.fetch(categoryId);
      const children = guild.channels.cache.filter((c) => c.parentId === categoryId);
      for (const ch of children.values()) {
        await ch.delete().catch(() => {});
      }
      await category.delete();
      games.delete(gameId);
      saveGames();
      for (const [msgId, meta] of dcMessageMeta) {
        if (meta.gameId === gameId) {
          dcMessageMeta.delete(msgId);
          dcExhaustedState.delete(msgId);
          dcHealthState.delete(msgId);
        }
      }
      try {
        await interaction.editReply({ content: `Game **IA Game #${gameId}** deleted. All channels removed.` });
      } catch {
        // Channel was deleted, reply fails - ignore
      }
    } catch (err) {
      console.error('Kill game error:', err);
      try {
        await interaction.editReply({ content: `Failed to delete: ${err.message}` }).catch(() => {});
      } catch {
        // ignore
      }
    }
    return;
  }

  if (interaction.customId.startsWith('default_deck_')) {
    const parts = interaction.customId.split('_');
    if (parts.length < 5) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const gameId = parts[2];
    const playerNum = parts[3];
    const faction = parts[4];
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!game.mapSelected) {
      await interaction.reply({ content: 'Map selection must be completed before you can load a squad.', ephemeral: true }).catch(() => {});
      return;
    }
    const isP1 = playerNum === '1';
    const userId = isP1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== userId) {
      await interaction.reply({ content: 'Only the owner of this hand can load a default deck.', ephemeral: true }).catch(() => {});
      return;
    }
    const squadMap = { rebel: DEFAULT_DECK_REBELS, scum: DEFAULT_DECK_SCUM, imperial: DEFAULT_DECK_IMPERIAL };
    const squad = squadMap[faction];
    if (!squad) {
      await interaction.reply({ content: 'Unknown faction.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      await applySquadSubmission(game, isP1, { ...squad }, client);
      await interaction.editReply({ content: `Loaded **${squad.name}** (${squad.dcCount} DCs, ${squad.ccCount} CCs).` }).catch(() => {});
    } catch (err) {
      console.error('Failed to apply default deck:', err);
      await interaction.editReply({ content: `Failed to load deck: ${err.message}` }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith('squad_select_')) {
    const [, , gameId, playerNum] = interaction.customId.split('_');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'This game no longer exists.', ephemeral: true });
      return;
    }
    if (!game.mapSelected) {
      await interaction.reply({ content: 'Map selection must be completed before you can select your squad.', ephemeral: true });
      return;
    }
    const isP1 = playerNum === '1';
    const userId = isP1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== userId) {
      await interaction.reply({ content: 'Only the owner of this hand can select a squad.', ephemeral: true });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`squad_modal_${gameId}_${playerNum}`)
      .setTitle('Submit Squad');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('squad_name')
          .setLabel('Squad name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Vader\'s Fist')
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('squad_dc')
          .setLabel('Deployment Cards (one per line, max 40 pts)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Darth Vader\nStormtrooper\nStormtrooper\n...')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('squad_cc')
          .setLabel('Command Cards (one per line, exactly 15)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Force Lightning\nBurst Fire\n...')
          .setRequired(true)
      )
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId.startsWith('lobby_join_')) {
    const threadId = interaction.customId.replace('lobby_join_', '');
    const lobby = lobbies.get(threadId);
    if (!lobby) {
      await interaction.reply({ content: 'This lobby no longer exists.', ephemeral: true });
      return;
    }
    if (lobby.joinedId) {
      await interaction.reply({ content: 'This game already has two players.', ephemeral: true });
      return;
    }
    if (interaction.user.id === lobby.creatorId) {
      lobby.joinedId = interaction.user.id;
      lobby.status = 'Full';
      await interaction.update({
        embeds: [getLobbyEmbed(lobby)],
        components: [getLobbyStartButton(threadId)],
      });
      await updateThreadName(interaction.channel, lobby);
      await interaction.followUp({ content: '*(Testing: you joined as Player 2. Use a second account for real games.)*', ephemeral: true });
      return;
    }
    lobby.joinedId = interaction.user.id;
    lobby.status = 'Full';
    await interaction.update({
      embeds: [getLobbyEmbed(lobby)],
      components: [getLobbyStartButton(threadId)],
    });
    await updateThreadName(interaction.channel, lobby);
    return;
  }

  if (interaction.customId.startsWith('lobby_start_')) {
    const threadId = interaction.customId.replace('lobby_start_', '');
    const lobby = lobbies.get(threadId);
    if (!lobby || !lobby.joinedId) {
      await interaction.reply({ content: 'Both players must join before starting. Player 2 has not joined yet.', ephemeral: true });
      return;
    }
    if (interaction.user.id !== lobby.creatorId && interaction.user.id !== lobby.joinedId) {
      await interaction.reply({ content: 'Only players in this game can start it.', ephemeral: true });
      return;
    }
    lobby.status = 'Launched';

    // Check if this is a Test game (thread has Test tag)
    let isTestGame = false;
    try {
      const thread = interaction.channel;
      const parent = thread.parent;
      if (parent?.availableTags) {
        const testTag = parent.availableTags.find((t) => t.name === 'Test');
        if (testTag && thread.appliedTags?.includes(testTag.id)) {
          isTestGame = true;
        }
      }
    } catch {
      // ignore
    }

    await interaction.reply({ content: 'Creating your game channels...', ephemeral: true });
    try {
      const guild = interaction.guild;
      const { gameId, generalChannel, chatChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel } =
        await createGameChannels(guild, lobby.creatorId, lobby.joinedId, { createPlayAreas: false, createHandChannels: false });
      const game = {
        gameId,
        gameCategoryId: generalChannel.parentId,
        player1Id: lobby.creatorId,
        player2Id: lobby.joinedId,
        generalId: generalChannel.id,
        chatId: chatChannel.id,
        boardId: boardChannel.id,
        p1HandId: p1HandChannel?.id ?? null,
        p2HandId: p2HandChannel?.id ?? null,
        p1PlayAreaId: p1PlayAreaChannel?.id ?? null,
        p2PlayAreaId: p2PlayAreaChannel?.id ?? null,
        player1Squad: null,
        player2Squad: null,
        player1VP: { total: 0, kills: 0, objectives: 0 },
        player2VP: { total: 0, kills: 0, objectives: 0 },
        isTestGame: !!isTestGame,
        ended: false,
      };
      games.set(gameId, game);

      const setupMsg = await generalChannel.send({
        content: `<@${game.player1Id}> <@${game.player2Id}> — Game created. Map Selection below — Hand channels will appear after map selection. Use **General chat** to talk with your opponent.`,
        allowedMentions: { users: [...new Set([game.player1Id, game.player2Id])] },
        embeds: [
          new EmbedBuilder()
            .setTitle(isTestGame ? 'Game Setup (Test)' : 'Game Setup')
            .setDescription(
              isTestGame
                ? '**Test game** — Complete **MAP SELECTION** first (button below). This will randomly select a Map and its A or B mission variant. Hand channels will then appear for picking decks.'
                : 'Complete **MAP SELECTION** first (button below). This will randomly select a Map and its A or B mission variant. Hand channels will then appear — both players pick their deck there (Select Squad or default deck buttons).'
            )
            .setColor(0x2f3136),
        ],
        components: [getGeneralSetupButtons(game)],
      });
      game.generalSetupMessageId = setupMsg.id;
      await interaction.followUp({
        content: `Game **IA Game #${gameId}** is ready!${isTestGame ? ' (Test)' : ''} Select the map in Game Log — Hand channels will appear after map selection.`,
        ephemeral: true,
      });
      await updateThreadName(interaction.channel, lobby);
      await interaction.channel.setArchived(true);
    } catch (err) {
      console.error('Failed to create game channels:', err);
      await interaction.followUp({
        content: `Failed to create game: ${err.message}. Ensure the bot has **Manage Channels** permission.`,
        ephemeral: true,
      });
    }
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  if (interaction.customId === 'create_game') {
    await interaction.editReply({
      content: 'Go to **#new-games** and click **Create Post** to start a lobby. The bot will add the Join Game button.',
      components: [getMainMenu()],
    });
  }
  if (interaction.customId === 'join_game') {
    await interaction.editReply({
      content: 'Browse **#new-games** and click **Join Game** on a lobby post that needs an opponent.',
      components: [getMainMenu()],
    });
  }
  } catch (err) {
    console.error('Interaction error:', err);
    const guild = interaction?.guild;
    const gameId = extractGameIdFromInteraction(interaction);
    await logGameErrorToBotLogs(interaction.client, guild, gameId, err, 'interactionCreate');
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'An error occurred. It has been logged to bot-logs.', ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: 'An error occurred. It has been logged to bot-logs.', ephemeral: true }).catch(() => {});
      }
    } catch {}
  }
});

if (process.argv.includes('--test-movement')) {
  runMovementTests()
    .then((code) => process.exit(code || 0))
    .catch((err) => { console.error(err); process.exit(1); });
} else {
  client.login(process.env.DISCORD_TOKEN);
}
