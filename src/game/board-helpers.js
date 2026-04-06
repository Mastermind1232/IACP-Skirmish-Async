/**
 * Pure board-state helper functions — NO Discord dependency.
 * Extracted from index.js for modularity.
 */
import { normalizeCoord, parseCoord, edgeKey, toLowerSet, getFootprintCells } from './coords.js';
import { getBoundedMapSpaces } from './movement.js';
import { countSpaces } from './spatial.js';
import { dcNameFromFigureKey, getDcEffect } from './dc-helpers.js';
import { opponentPlayerNum, getInitiativePlayerNum } from './player-helpers.js';
import {
  getMapTokensData,
  getMapData,
  getDeploymentZones,
  getDcStats,
  getDcEffects,
  getMissionCardsData,
  getFigureSize,
} from '../data-loader.js';

/** Compute the set of edge keys for closed (not-yet-opened) doors on the current map. */
export function getClosedDoorEdges(game) {
  const mapId = game?.selectedMap?.id;
  if (!mapId) return new Set();
  const allDoors = getMapTokensData()?.[mapId]?.doors || [];
  if (!allDoors.length) return new Set();
  const openedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
  return new Set(
    allDoors
      .filter(e => { const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase(); return !openedSet.has(`${a}|${b}`) && !openedSet.has(`${b}|${a}`); })
      .map(e => edgeKey(e[0], e[1]))
  );
}

/** Graph-distance between two spaces, respecting closed doors. */
export function countGameSpaces(game, coordA, coordB) {
  const mapId = game?.selectedMap?.id;
  const ms = mapId ? getMapData(mapId) : null;
  if (!ms) return Infinity;
  return countSpaces(ms, coordA, coordB, getClosedDoorEdges(game));
}

/** Get a figure's effective size, preferring stored orientation over base size. */
export function getEffectiveFigureSize(game, figureKey, dcName) {
  return game.figureOrientations?.[figureKey] || getFigureSize(dcName);
}

/** Get set of normalized coords occupied by a player's figures. */
export function getPlayerOccupiedCells(game, playerNum) {
  const cells = new Set();
  const poses = game.figurePositions?.[playerNum] || {};
  for (const [k, coord] of Object.entries(poses)) {
    const dcName = dcNameFromFigureKey(k);
    const size = getEffectiveFigureSize(game, k, dcName);
    for (const c of getFootprintCells(coord, size)) {
      cells.add(normalizeCoord(c));
    }
  }
  return cells;
}

/** Check if a figure should be excluded from control counting.
 *  - Salacious B. Crumb: always excluded (Indentured Jester).
 *  - The Child: excluded when incapacitated (game.childIncapacitated).
 *  - Dio: excluded while Iden Versio is alive (has a figure in figurePositions for the same player).
 *    When Iden is defeated (removed from figurePositions), Dio counts for control. */
function _isExcludedFromControl(game, playerNum, figureKey) {
  const dcName = dcNameFromFigureKey(figureKey).toLowerCase();
  if (dcName === 'salacious b. crumb') return true;
  if (dcName === 'the child' && game.childIncapacitated) return true;
  if (dcName === 'dio') {
    // Dio is excluded while its owner Iden Versio is alive (present in figurePositions)
    const poses = game.figurePositions?.[playerNum] || {};
    const idenAlive = Object.keys(poses).some((fk) => dcNameFromFigureKey(fk) === 'Iden Versio');
    if (idenAlive) return true;
  }
  return false;
}

/** Like getPlayerOccupiedCells, but excludes companion figures not counted for control.
 *  Used by getSpaceController, countTerminalsControlledByPlayer, and deployment-zone control. */
export function getPlayerOccupiedCellsForControl(game, playerNum) {
  const cells = new Set();
  const poses = game.figurePositions?.[playerNum] || {};
  for (const [k, coord] of Object.entries(poses)) {
    if (_isExcludedFromControl(game, playerNum, k)) continue;
    const dcName = dcNameFromFigureKey(k);
    const size = getEffectiveFigureSize(game, k, dcName);
    for (const c of getFootprintCells(coord, size)) {
      cells.add(normalizeCoord(c));
    }
  }
  return cells;
}

/** Extract flat coordinate array from a missionA/missionB token data block (generic — no hardcoded key names). */
export function getMissionTokenCoords(missionTokenData) {
  if (!missionTokenData) return [];
  if (missionTokenData.positions && typeof missionTokenData.positions === 'object') {
    return Object.values(missionTokenData.positions).flat();
  }
  for (const val of Object.values(missionTokenData)) {
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') return val;
  }
  return [];
}

/** True if figure is adjacent to or on a mission token space (for the given mission side). */
export function isFigureAdjacentOrOnMissionToken(game, playerNum, figureKey, mapId, missionSide) {
  const mapData = getMapTokensData()[mapId];
  const coords = getMissionTokenCoords(mapData?.[missionSide]);
  if (!coords.length) return false;
  const mapSpaces = getBoundedMapSpaces(mapId);
  if (!mapSpaces?.adjacency) return false;
  const adjacency = mapSpaces.adjacency || {};
  const tokenSet = toLowerSet(coords);
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return false;
  const dcName = dcNameFromFigureKey(figureKey);
  const footprint = getFootprintCells(pos, getEffectiveFigureSize(game, figureKey, dcName));
  for (const c of footprint) {
    const n = normalizeCoord(c);
    if (tokenSet.has(n)) return true;
    for (const adj of adjacency[n] || []) {
      if (tokenSet.has(normalizeCoord(adj))) return true;
    }
  }
  return false;
}

/** Effective speed, accounting for mission-defined carry penalty and round bonuses (Fuel Upgrade, etc.). */
export function getEffectiveSpeed(dcName, figureKey, game, playerNum) {
  let base = getDcStats(dcName).speed ?? 4;
  const mech = game?.selectedMission?.mechanics;
  if (mech?.type === 'carry' && mech.speedPenalty && game.figureContraband?.[figureKey]) {
    base = Math.max(0, base + mech.speedPenalty);
  }
  // Fuel Upgrade: round VEHICLE speed bonus
  if (playerNum && game?.roundVehicleSpeedBonus?.[playerNum]) {
    const eff = getDcEffect(dcName);
    const keywords = (eff?.keywords || []).map((k) => String(k).toUpperCase());
    if (keywords.includes('VEHICLE')) base += game.roundVehicleSpeedBonus[playerNum];
  }
  return base;
}

/** True if figure is in player's deployment zone. */
export function isFigureInDeploymentZone(game, playerNum, figureKey, mapId) {
  const zoneData = getDeploymentZones()[mapId];
  if (!zoneData) return false;
  const initPlayerNum = getInitiativePlayerNum(game);
  const zone = playerNum === initPlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const zoneSpaces = toLowerSet(zoneData[zone] || []);
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return false;
  const dcName = dcNameFromFigureKey(figureKey);
  const footprint = getFootprintCells(pos, getEffectiveFigureSize(game, figureKey, dcName));
  return footprint.some((c) => zoneSpaces.has(normalizeCoord(c)));
}

/** True if figure footprint or any adjacent cell is in the given coord set. */
export function isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, coordSet) {
  return getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, coordSet).length > 0;
}

/** Returns coords from coordSet that the figure is on or adjacent to. */
export function getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, coordSet) {
  if (!coordSet?.size) return [];
  const mapSpaces = getBoundedMapSpaces(mapId);
  if (!mapSpaces?.adjacency) return [];
  const adjacency = mapSpaces.adjacency || {};
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return [];
  const dcName = dcNameFromFigureKey(figureKey);
  const footprint = getFootprintCells(pos, getEffectiveFigureSize(game, figureKey, dcName));
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

/**
 * Group adjacent parallel door edges into logical doors.
 * E.g., [["o15","o16"], ["p15","p16"]] → one group (same horizontal wall, adjacent columns).
 */
function groupDoorEdges(doors) {
  if (!doors?.length) return [];
  // Parse each edge: determine wall orientation and position
  const parsed = doors.map(edge => {
    const a = parseCoord(edge[0]), b = parseCoord(edge[1]);
    // Same column, different row → wall runs horizontally; perp axis = col
    // Same row, different column → wall runs vertically; perp axis = row
    const sameCol = a.col === b.col;
    return {
      edge,
      wallKey: sameCol ? `h_${Math.min(a.row, b.row)}` : `v_${Math.min(a.col, b.col)}`,
      perpPos: sameCol ? a.col : a.row,
    };
  });
  const used = new Set();
  const groups = [];
  for (let i = 0; i < parsed.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const group = [parsed[i]];
    // Flood-fill: find all adjacent edges on the same wall
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < parsed.length; j++) {
        if (used.has(j)) continue;
        if (parsed[j].wallKey !== parsed[i].wallKey) continue;
        if (group.some(g => Math.abs(g.perpPos - parsed[j].perpPos) === 1)) {
          group.push(parsed[j]);
          used.add(j);
          changed = true;
        }
      }
    }
    groups.push(group.map(g => g.edge));
  }
  return groups;
}

/** Returns legal interact options for a figure. Mission-specific first (blue), standard (grey). */
export function getLegalInteractOptions(game, playerNum, figureKey, mapId) {
  const options = [];
  const mapData = getMapTokensData()[mapId];
  if (!mapData) return options;

  // Alter Mind (Obi-Wan Kenobi - Jedi Master): hostile figures with cost ≤ 9 within 3 spaces cannot interact
  const oppNum = opponentPlayerNum(playerNum);
  const oppPositions = game.figurePositions?.[oppNum] || {};
  const figPos = game.figurePositions?.[playerNum]?.[figureKey];
  if (figPos) {
    const dcName = dcNameFromFigureKey(figureKey);
    const figDcEff = getDcEffects()?.[dcName];
    const figCost = figDcEff?.cost ?? 99;
    if (figCost <= 9) {
      for (const [oppFk, oppCoord] of Object.entries(oppPositions)) {
        const oppDcName = dcNameFromFigureKey(oppFk);
        const oppEff = getDcEffects()?.[oppDcName];
        if ((oppEff?.specialAbilityIds || []).includes('alter_mind_obiwan')) {
          if (countGameSpaces(game, figPos, oppCoord) <= 3) return options; // blocked — return empty
        }
      }
    }
  }

  // A Powerful Influence (CC): hostile figures within 3 spaces of any friendly REBEL FORCE USER cannot interact
  if (game.powerfulInfluencePlayerNum && figPos) {
    const apiPn = game.powerfulInfluencePlayerNum;
    if (playerNum !== apiPn) {
      const apiPositions = game.figurePositions?.[apiPn] || {};
      const allEff = getDcEffects();
      for (const [apiFk, apiCoord] of Object.entries(apiPositions)) {
        if (!apiCoord) continue;
        const apiDcName = dcNameFromFigureKey(apiFk);
        const apiEff = allEff[apiDcName];
        const apiKw = (apiEff?.keywords || []).map(k => String(k).toUpperCase());
        if (!apiKw.includes('FORCE USER')) continue;
        if (countGameSpaces(game, figPos, apiCoord) <= 3) return options; // blocked — return empty
      }
    }
  }

  const variant = game?.selectedMission?.variant;
  const interactLabel = game?.selectedMission?.interactLabel;
  const mech = game?.selectedMission?.mechanics;

  if (interactLabel && mech?.type === 'carry') {
    const missionSide = variant === 'a' ? 'missionA' : 'missionB';
    if (!game.figureContraband?.[figureKey] && isFigureAdjacentOrOnMissionToken(game, playerNum, figureKey, mapId, missionSide)) {
      options.push({ id: 'retrieve_contraband', label: interactLabel, missionSpecific: true });
    }
  }

  if (interactLabel && mech?.type === 'flip') {
    const missionSide = variant === 'a' ? 'missionA' : 'missionB';
    const tokenCoords = getMissionTokenCoords(mapData[missionSide]);
    const flippedThisRound = playerNum === 1 ? game.p1LaunchPanelFlippedThisRound : game.p2LaunchPanelFlippedThisRound;
    if (tokenCoords.length && !(mech?.flipLimitPerRound && flippedThisRound)) {
      const panelSet = toLowerSet(tokenCoords);
      const adjacent = getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, panelSet);
      for (const coord of adjacent) {
        const upper = String(coord).toUpperCase();
        options.push({ id: `launch_panel_${coord}_colored`, label: `${interactLabel} (${upper}) → Colored`, missionSpecific: true });
        options.push({ id: `launch_panel_${coord}_gray`, label: `${interactLabel} (${upper}) → Gray`, missionSpecific: true });
      }
    }
  }

  const terminals = mapData.terminals || [];
  if (terminals.length && isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, toLowerSet(terminals))) {
    options.push({ id: 'use_terminal', label: 'Use Terminal', missionSpecific: false });
  }

  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  // Group adjacent parallel door edges into logical doors
  const doorGroups = groupDoorEdges(mapData.doors || []);
  for (const group of doorGroups) {
    const allOpened = group.every(edge => openedSet.has(edgeKey(edge[0], edge[1])));
    if (allOpened) continue;
    const allCoords = toLowerSet(group.flat());
    // Door adjacency: only the spaces sharing an edge with the door count (RRG p.23)
    // — no diagonal adjacency. The door's own cells ARE those spaces.
    if (figPos) {
      const doorDcName = dcNameFromFigureKey(figureKey);
      const doorFootprint = getFootprintCells(figPos, getEffectiveFigureSize(game, figureKey, doorDcName));
      if (doorFootprint.some(c => allCoords.has(normalizeCoord(c)))) {
        const edgeKeys = group.map(edge => edgeKey(edge[0], edge[1]));
        const label = `Open Door (${String(group[0][0]).toUpperCase()}–${String(group[0][1]).toUpperCase()})`;
        options.push({ id: `open_door_${edgeKeys.join(',')}`, label, missionSpecific: false });
      }
    }
  }

  return options;
}

/** Alter Mind: returns { 1: Set<coord>, 2: Set<coord> } of cells that don't count for control. */
function _getAlterMindExcludedCells(game) {
  const excluded = {};
  const allEff = getDcEffects();
  for (const pn of [1, 2]) {
    const oppPn = 3 - pn;
    // Check if opponent has Alter Mind active
    for (const [fk, pos] of Object.entries(game.figurePositions?.[oppPn] || {})) {
      if (!pos) continue;
      const dcName = dcNameFromFigureKey(fk);
      const eff = allEff[dcName];
      if (!(eff?.specialAbilityIds || []).includes('alter_mind_obiwan')) continue;
      // This player's figures with cost ≤9 within 3 spaces of Obi-Wan don't count for control
      if (!excluded[pn]) excluded[pn] = new Set();
      for (const [tFk, tPos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!tPos) continue;
        const tDcName = dcNameFromFigureKey(tFk);
        const tEff = allEff[tDcName];
        if ((tEff?.cost ?? 99) > 9) continue;
        if (countGameSpaces(game, pos, tPos) > 3) continue;
        const size = getEffectiveFigureSize(game, tFk, tDcName);
        for (const c of getFootprintCells(tPos, size)) excluded[pn].add(normalizeCoord(c));
      }
    }
  }
  return excluded;
}

/** A Powerful Influence (CC): returns { 1: Set<coord>, 2: Set<coord> } of cells that don't count for control. */
function _getPowerfulInfluenceExcludedCells(game) {
  const excluded = {};
  const apiPn = game.powerfulInfluencePlayerNum;
  if (!apiPn) return excluded;
  const allEff = getDcEffects();
  const oppPn = 3 - apiPn;
  // Find all REBEL FORCE USER figures belonging to the CC player
  for (const [fk, pos] of Object.entries(game.figurePositions?.[apiPn] || {})) {
    if (!pos) continue;
    const dcName = dcNameFromFigureKey(fk);
    const eff = allEff[dcName];
    const kw = (eff?.keywords || []).map(k => String(k).toUpperCase());
    if (!kw.includes('FORCE USER')) continue;
    // Opponent's figures within 3 spaces don't count for control
    if (!excluded[oppPn]) excluded[oppPn] = new Set();
    for (const [tFk, tPos] of Object.entries(game.figurePositions?.[oppPn] || {})) {
      if (!tPos) continue;
      if (countGameSpaces(game, pos, tPos) > 3) continue;
      const tDcName = dcNameFromFigureKey(tFk);
      const size = getEffectiveFigureSize(game, tFk, tDcName);
      for (const c of getFootprintCells(tPos, size)) excluded[oppPn].add(normalizeCoord(c));
    }
  }
  return excluded;
}

/** Returns 1, 2, or null for who controls this space (only they have figure on/adjacent). Same logic as terminals. */
export function getSpaceController(game, mapId, coord) {
  const mapSpaces = getBoundedMapSpaces(mapId);
  if (!mapSpaces?.adjacency) return null;
  const adjacency = mapSpaces.adjacency || {};
  const t = normalizeCoord(coord);
  const controlSet = new Set([t, ...(adjacency[t] || []).map((n) => normalizeCoord(n))]);
  // Alter Mind (Obi-Wan): figures cost ≤9 within 3 spaces don't count for control
  const alterMindExcluded = _getAlterMindExcludedCells(game);
  // A Powerful Influence (CC): hostile figures within 3 spaces of REBEL FORCE USER don't count for control
  const apiExcluded = _getPowerfulInfluenceExcludedCells(game);
  const p1Cells = getPlayerOccupiedCellsForControl(game, 1);
  const p2Cells = getPlayerOccupiedCellsForControl(game, 2);
  const p1Has = [...controlSet].some((c) => p1Cells.has(c) && !alterMindExcluded[1]?.has(c) && !apiExcluded[1]?.has(c));
  const p2Has = [...controlSet].some((c) => p2Cells.has(c) && !alterMindExcluded[2]?.has(c) && !apiExcluded[2]?.has(c));
  if (p1Has && !p2Has) return 1;
  if (p2Has && !p1Has) return 2;
  return null;
}

/** Returns array of figure keys for playerNum whose positions are on or adjacent to coord. */
export function getFiguresOnOrAdjacentToSpace(game, playerNum, coord, mapId) {
  const mapSpaces = getBoundedMapSpaces(mapId);
  if (!mapSpaces?.adjacency) return [];
  const adjacency = mapSpaces?.adjacency || {};
  const t = normalizeCoord(coord);
  const controlSet = new Set([t, ...(adjacency[t] || []).map((n) => normalizeCoord(n))]);
  const result = [];
  const poses = game.figurePositions?.[playerNum] || {};
  for (const [figKey, figCoord] of Object.entries(poses)) {
    if (controlSet.has(normalizeCoord(figCoord))) result.push(figKey);
  }
  return result;
}

/** Count terminals exclusively controlled by player (on or adjacent; only they have presence). */
export function countTerminalsControlledByPlayer(game, playerNum, mapId) {
  const mapData = getMapTokensData()[mapId];
  if (!mapData?.terminals?.length) return 0;
  const mapSpaces = getBoundedMapSpaces(mapId);
  if (!mapSpaces?.adjacency) return 0;
  const adjacency = mapSpaces.adjacency || {};

  const alterMindExcluded = _getAlterMindExcludedCells(game);
  const apiExcluded = _getPowerfulInfluenceExcludedCells(game);
  const p1Cells = getPlayerOccupiedCellsForControl(game, 1);
  const p2Cells = getPlayerOccupiedCellsForControl(game, 2);

  let count = 0;
  for (const term of mapData.terminals) {
    const t = normalizeCoord(term);
    const controlSet = new Set([t, ...(adjacency[t] || []).map((n) => normalizeCoord(n))]);
    const p1Has = [...controlSet].some((c) => p1Cells.has(c) && !alterMindExcluded[1]?.has(c) && !apiExcluded[1]?.has(c));
    const p2Has = [...controlSet].some((c) => p2Cells.has(c) && !alterMindExcluded[2]?.has(c) && !apiExcluded[2]?.has(c));
    if (playerNum === 1 && p1Has && !p2Has) count++;
    if (playerNum === 2 && p2Has && !p1Has) count++;
  }
  return count;
}
