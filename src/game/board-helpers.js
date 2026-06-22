/**
 * Pure board-state helper functions — NO Discord dependency.
 * Extracted from index.js for modularity.
 */
import { normalizeCoord, parseCoord, colRowToCoord, edgeKey, toLowerSet, getFootprintCells } from './coords.js';
import { getBoundedMapSpaces } from './movement.js';
import { countSpaces } from './spatial.js';
import { dcNameFromFigureKey, getDcEffect } from './dc-helpers.js';
import { squadUpgradeFigureCard } from './squad-upgrades.js';
import { opponentPlayerNum, getInitiativePlayerNum } from './player-helpers.js';
import {
  getMapTokensData,
  getMapData,
  getDeploymentZones,
  getDcStats,
  getDcEffects,
  getMissionCardsData,
  getFigureSize,
  isDcCompanion,
} from '../data-loader.js';

/**
 * Active terminals for the current mission — the map's terminals minus
 * any that were discarded by BD-1's **Terminal Slicing** (Double Action
 * Special). Discarded terminals are tracked additively on
 * `game.discardedTerminals`. Use this helper at every terminal-read
 * site so Scomp Link / Terminal Network / control counting / Use
 * Terminal interact all respect Terminal Slicing.
 *
 * @param {object} game
 * @param {string} mapId
 * @returns {string[]} terminal coords (canonical case from map-tokens) still in play
 */
export function getActiveTerminals(game, mapId) {
  const mapData = getMapTokensData()?.[mapId];
  const all = mapData?.terminals || [];
  const discarded = game?.discardedTerminals || [];
  if (discarded.length === 0) return all;
  const discardedSet = new Set(discarded.map((c) => normalizeCoord(c)));
  return all.filter((t) => !discardedSet.has(normalizeCoord(t)));
}

/** True iff the given terminal coord has been discarded this game. */
export function isTerminalDiscarded(game, coord) {
  if (!game?.discardedTerminals || !coord) return false;
  const c = normalizeCoord(coord);
  return game.discardedTerminals.some((d) => normalizeCoord(d) === c);
}

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
 *  Per canonical IACP rule (alexanbv 2026-05-09): companions count for
 *  control by default; only specific abilities exclude them.
 *
 *  - BD-1: "Damaged Scomplink" on its own card — always excluded.
 *  - The Child: "[Clan of Two]" attachment — excluded only while
 *    `game.childIncapacitated` (Force Exhaustion).
 *  - Dio: "ID10 Seeker Droid" on Iden Versio's card — excluded while
 *    Iden Versio is alive. When Iden dies, the rule stops and Dio counts.
 *  - J4X-7: "Droid Master" on Jarrod Kelvin's card — same pattern as Dio,
 *    keyed on Jarrod Kelvin alive.
 *  - Salacious B. Crumb: "[Indentured Jester]" attachment — always
 *    excluded. Per alexanbv 2026-05-09: the upgrade's "not counted for
 *    control" rule remains in effect even after the host figure is
 *    defeated, unlike Dio / J4X-7 (whose rules live on the host's DC card
 *    and stop when the host dies).
 */
export function isExcludedFromControl(game, playerNum, figureKey) {
  return _isExcludedFromControl(game, playerNum, figureKey);
}
function _isExcludedFromControl(game, playerNum, figureKey) {
  const dcName = dcNameFromFigureKey(figureKey);
  const lowerName = dcName.toLowerCase();
  if (lowerName === 'bd-1') return true;
  if (lowerName === 'salacious b. crumb') return true;
  if (lowerName === 'the child' && game.childIncapacitated) return true;
  const hostFigureName = lowerName === 'dio' ? 'Iden Versio'
    : lowerName === 'j4x-7' ? 'Jarrod Kelvin'
    : null;
  if (hostFigureName) {
    const poses = game.figurePositions?.[playerNum] || {};
    const hostAlive = Object.keys(poses).some((fk) => dcNameFromFigureKey(fk) === hostFigureName);
    if (hostAlive) return true;
    return false;
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
  const tokenSet = toLowerSet(coords);
  return getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, tokenSet).length > 0;
}

/**
 * Eyes on the Prize (Scum CC): the friendly figureKeys eligible for the
 * per-figure benefit — those carrying or controlling a crate or mission token.
 *   - carrying: the figure holds a crate/contraband token (game.figureContraband)
 *   - controlling: the figure is on or adjacent to a crate token (game.crateTokens)
 *     or a mission token whose space the player controls (getSpaceController)
 * Control is resolved per token space via getSpaceController so contested tokens
 * don't qualify. The effect is an optional self-buff, so adjacency-based control
 * (the same test mission rules use) is the intended granularity. alexanbv 2026-06-17.
 * @returns {string[]} eligible friendly figure keys
 */
export function eyesOnThePrizeEligibleFigures(game, playerNum, mapId) {
  const positions = game.figurePositions?.[playerNum] || {};
  const eligible = new Set();
  // (a) carrying a crate / contraband
  for (const [fk, carrying] of Object.entries(game.figureContraband || {})) {
    if (carrying && positions[fk]) eligible.add(fk);
  }
  // (b) controlling a crate or mission token — collect the token spaces the
  // player controls, then any friendly figure on/adjacent to one qualifies.
  const controlledTokenCoords = new Set();
  for (const [coord, toks] of Object.entries(game.crateTokens || {})) {
    if (Array.isArray(toks) && toks.length && getSpaceController(game, mapId, coord) === playerNum) {
      controlledTokenCoords.add(normalizeCoord(coord));
    }
  }
  const variant = game?.selectedMission?.variant || 'a';
  const missionSide = variant === 'a' ? 'missionA' : 'missionB';
  const missionCoords = getMissionTokenCoords(getMapTokensData()?.[mapId]?.[missionSide]);
  for (const coord of missionCoords) {
    if (getSpaceController(game, mapId, coord) === playerNum) controlledTokenCoords.add(normalizeCoord(coord));
  }
  if (controlledTokenCoords.size > 0) {
    const tokenSet = toLowerSet([...controlledTokenCoords]);
    for (const fk of Object.keys(positions)) {
      if (eligible.has(fk)) continue;
      if (getFigureAdjacentCoordsFromSet(game, playerNum, fk, mapId, tokenSet).length > 0) eligible.add(fk);
    }
  }
  return [...eligible];
}

/** Effective speed, accounting for mission-defined carry penalty and round bonuses (Fuel Upgrade, etc.). */
export function getEffectiveSpeed(dcName, figureKey, game, playerNum) {
  // SU-aware: a Squad Upgrade figure uses its OWN card's speed, not the host's.
  const _suCard = (game && figureKey) ? squadUpgradeFigureCard(game, figureKey) : null;
  const effName = _suCard ? `[${_suCard}]` : dcName;
  let base = getDcStats(effName).speed ?? 4;
  const mech = game?.selectedMission?.mechanics;
  if (mech?.type === 'carry' && mech.speedPenalty && game.figureContraband?.[figureKey]) {
    base = Math.max(0, base + mech.speedPenalty);
  }
  // Fuel Upgrade: round VEHICLE speed bonus
  if (playerNum && game?.roundVehicleSpeedBonus?.[playerNum]) {
    const eff = getDcEffect(effName);
    const keywords = (eff?.keywords || []).map((k) => String(k).toUpperCase());
    if (keywords.includes('VEHICLE')) base += game.roundVehicleSpeedBonus[playerNum];
  }
  // Utinni! (roundUtinniJawaBuffs): each friendly Jawa Scavenger gains +1 Speed
  // this round (the matching +1 Accuracy is applied at attack-declare in
  // handlers/combat.js). Mirrors the bare-flag + Jawa-name check used there.
  if (game?.roundUtinniJawaBuffs && String(dcName || '').toLowerCase().includes('jawa scavenger')) {
    base += 1;
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

/** True if `playerNum`'s figure occupies the OPPONENT's deployment zone.
 *  Used by zone-conditional CCs (Behind Enemy Lines: "in your opponent's
 *  deployment zone"). The figure position is read from playerNum's own
 *  positions; the zone color is the OTHER player's. */
export function isFigureInOpponentDeploymentZone(game, playerNum, figureKey, mapId) {
  const zoneData = getDeploymentZones()[mapId];
  if (!zoneData) return false;
  const initPlayerNum = getInitiativePlayerNum(game);
  // The opponent's zone color is the inverse of playerNum's own zone.
  const ownZone = playerNum === initPlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const oppZone = ownZone === 'red' ? 'blue' : 'red';
  const zoneSpaces = toLowerSet(zoneData[oppZone] || []);
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return false;
  const dcName = dcNameFromFigureKey(figureKey);
  const footprint = getFootprintCells(pos, getEffectiveFigureSize(game, figureKey, dcName));
  return footprint.some((c) => zoneSpaces.has(normalizeCoord(c)));
}

/** 8-connected geometric neighbors of a coordinate (ignores walls/blocking). */
function geometricNeighbors(coord) {
  const { col, row } = parseCoord(coord);
  const out = [];
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      const nc = col + dc, nr = row + dr;
      if (nc >= 0 && nr >= 0) out.push(normalizeCoord(colRowToCoord(nc, nr)));
    }
  }
  return out;
}

/** True if figure footprint or any adjacent cell is in the given coord set. */
export function isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, coordSet) {
  return getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, coordSet).length > 0;
}

/** Returns coords from coordSet that the figure is on or adjacent to.
 *  Uses graph adjacency first, then geometric fallback for blocking-terrain targets (e.g. mission panels). */
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
    // Geometric fallback: blocking-terrain targets (mission panels) are excluded from the
    // movement adjacency graph but are still geometrically adjacent for interact purposes.
    for (const gn of geometricNeighbors(n)) {
      if (coordSet.has(gn)) result.add(gn);
    }
  }
  return [...result];
}

/**
 * The set of board coords that contain blocking or difficult terrain on a map.
 * Used by terrain-prerequisite checks (e.g. Ambush: "you share an edge or corner
 * with a space containing blocking, impassable, or difficult terrain").
 *
 * NOTE: "impassable terrain" is modeled in this engine as impassableEdges (an
 * edge between two spaces), not as a space type — so a space-based check cannot
 * represent "adjacent to an impassable-terrain space". This helper covers the
 * two space-based terrain types (blocking + difficult); impassable-edge
 * adjacency is a known limitation (flagged for Ambush).
 */
export function getBlockingDifficultTerrainCoords(mapId) {
  const mapSpaces = getBoundedMapSpaces(mapId);
  const out = new Set();
  if (!mapSpaces) return out;
  for (const b of mapSpaces.blocking || []) out.add(normalizeCoord(b));
  for (const [coord, type] of Object.entries(mapSpaces.terrain || {})) {
    const t = String(type || '').toLowerCase();
    if (t === 'difficult' || t === 'blocking' || t === 'impassable') out.add(normalizeCoord(coord));
  }
  return out;
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
    // Per destruct 2026-05-07: no per-figure carry cap on most missions.
    // EXCEPT when the mission card explicitly states a cap via
    // mechanics.maxCarry — e.g. Line of Fire (Anchorhead B): "Each figure
    // can carry only 1 crate." Apply the cap only when set.
    const _maxCarry = (typeof mech?.maxCarry === 'number' && mech.maxCarry > 0) ? mech.maxCarry : Infinity;
    const _curCarry = typeof game.figureContraband?.[figureKey] === 'number'
      ? game.figureContraband[figureKey]
      : (game.figureContraband?.[figureKey] ? 1 : 0);
    if (_curCarry < _maxCarry) {
      let eligible = isFigureAdjacentOrOnMissionToken(game, playerNum, figureKey, mapId, missionSide);
      // CRR RTK-002: dropped-on-defeat tokens are also retrievable.
      if (!eligible) {
        const dropped = game.droppedContrabandSpaces || [];
        if (dropped.length) {
          const droppedSet = toLowerSet(dropped);
          eligible = getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, droppedSet).length > 0;
        }
      }
      if (eligible) options.push({ id: 'retrieve_contraband', label: interactLabel, missionSpecific: true });
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

  const terminals = getActiveTerminals(game, mapId);
  if (terminals.length && isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, toLowerSet(terminals))) {
    options.push({ id: 'use_terminal', label: 'Use Terminal', missionSpecific: false });
  }

  // Retrieve The Child (Clan of Two): a UNIQUE non-companion figure may
  // interact with The Child or its incapacitated token to gain 1 VP. Per
  // alexanbv 2026-05-09: trigger is the Child being incapacitated (host
  // need not be defeated); either player's UNIQUE figure can retrieve;
  // companion figures (even unique ones — Dio, BD-1, J4X-7, Crumb) cannot
  // retrieve because companions cannot interact (rules: COMPANIONS).
  if (figPos && game.childIncapacitated) {
    const _retrIntDcName = dcNameFromFigureKey(figureKey);
    const _retrIntEff = getDcEffects()?.[_retrIntDcName];
    if (_retrIntEff?.unique && !isDcCompanion(_retrIntDcName)) {
      for (const ownerPN of [1, 2]) {
        const _childPoses = game.figurePositions?.[ownerPN] || {};
        const _childFk = Object.keys(_childPoses).find((fk) => dcNameFromFigureKey(fk) === 'The Child');
        if (!_childFk) continue;
        const _childCoord = _childPoses[_childFk];
        if (!_childCoord) continue;
        const _childCoordLower = normalizeCoord(_childCoord);
        if (isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, new Set([_childCoordLower]))) {
          options.push({ id: `retrieve_child_${ownerPN}`, label: 'Retrieve The Child (+1 VP)', missionSpecific: false });
        }
      }
    }
  }

  // M11 Gaining Favor (Anchorhead Cantina Bar A): figure can interact with
  // a patron it CONTROLS to mark it with one of its player's mission tokens.
  // Per destruct 2026-05-08: control = standard space control (player has
  // figure on/adjacent and opponent does not). Patron is unclaimed if not
  // yet in anchorheadPatronTokens. Player must have tokens remaining
  // (anchorheadTokensRemaining starts at 4 each at SoG).
  if (mapId === 'anchorhead-cantina-bar' && variant === 'a') {
    const patronCoords = getMissionTokenCoords(mapData.missionA);
    const anchorheadTokens = game.anchorheadPatronTokens || {};
    const tokensRemaining = (game.anchorheadTokensRemaining || {})[playerNum] ?? 4;
    if (tokensRemaining > 0 && patronCoords.length > 0) {
      const patronSet = toLowerSet(patronCoords);
      const adjacentPatrons = getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, patronSet);
      const oppNum = opponentPlayerNum(playerNum);
      for (const coord of adjacentPatrons) {
        // Per destruct 2026-05-08: a patron can be marked by BOTH
        // players at different times. Skip only if THIS player has
        // already marked. Both legacy single-owner shape and per-player
        // object shape supported.
        const _ahEntry = anchorheadTokens[coord];
        const _ahMarked = (_ahEntry && typeof _ahEntry === 'object')
          ? !!(_ahEntry[playerNum])
          : (_ahEntry === playerNum);
        if (_ahMarked) continue;
        // Check standard control: opponent has no figure on/adjacent.
        const oppPositions = game.figurePositions?.[oppNum] || {};
        let oppContests = false;
        for (const [oppFk, oppCoord] of Object.entries(oppPositions)) {
          if (!oppCoord) continue;
          const oppSize = getEffectiveFigureSize(game, oppFk, dcNameFromFigureKey(oppFk));
          const oppFootprint = getFootprintCells(oppCoord, oppSize).map((c) => normalizeCoord(c));
          if (oppFootprint.some((c) => c === coord)) { oppContests = true; break; }
          // also check opponent adjacency to patron
          const oppAdj = getFigureAdjacentCoordsFromSet(game, oppNum, oppFk, mapId, new Set([coord]));
          if (oppAdj.length > 0) { oppContests = true; break; }
        }
        if (oppContests) continue;
        const upper = String(coord).toUpperCase();
        options.push({ id: `mark_patron_${coord}`, label: `Mark Patron (${upper}) — ${tokensRemaining} token${tokensRemaining !== 1 ? 's' : ''} left`, missionSpecific: true });
      }
    }
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

/** Alter Mind: returns { 1: Set<coord>, 2: Set<coord>, npc: Set<coord> } of cells
 *  that don't count for control. Npc set covers hostile NPCs (Thugs) within
 *  3 of Obi-Wan — per alexanbv 2026-05-11 Alter Mind prevents Thug control.
 *  NPC cost is 0 (≤9), so they qualify. */
function _getAlterMindExcludedCells(game) {
  const excluded = {};
  const allEff = getDcEffects();
  const _npcExcluded = new Set();
  let _anyObiWan = false;
  for (const pn of [1, 2]) {
    const oppPn = 3 - pn;
    // Check if opponent has Alter Mind active
    for (const [fk, pos] of Object.entries(game.figurePositions?.[oppPn] || {})) {
      if (!pos) continue;
      const dcName = dcNameFromFigureKey(fk);
      const eff = allEff[dcName];
      if (!(eff?.specialAbilityIds || []).includes('alter_mind_obiwan')) continue;
      _anyObiWan = true;
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
      // NPC sweep — Thugs/Krykna within 3 of Obi-Wan (cost 0, hostile to
      // both players). Adds to the npc-excluded set used by
      // _npcBlocksControlIn.
      for (const arrName of ['npcThugs', 'npcKrykna']) {
        const arr = game?.[arrName];
        if (!Array.isArray(arr)) continue;
        for (const npc of arr) {
          if (!npc || npc.defeated || !npc.coord) continue;
          if (countGameSpaces(game, pos, npc.coord) > 3) continue;
          _npcExcluded.add(normalizeCoord(npc.coord));
        }
      }
    }
  }
  if (_anyObiWan && _npcExcluded.size > 0) excluded.npc = _npcExcluded;
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
  // Terminal Network: the playing player controls all TERMINALS regardless of
  // adjacency (scoped to terminals — launch panels etc. are unaffected).
  if (game.terminalControlPlayerNum) {
    const _tnTerminals = getActiveTerminals(game, mapId).map((x) => normalizeCoord(x));
    if (_tnTerminals.includes(t)) return game.terminalControlPlayerNum;
  }
  const graphNeighbors = (adjacency[t] || []).map((n) => normalizeCoord(n));
  // Geometric fallback for blocking-terrain spaces (e.g. mission panels) with no graph neighbors
  const neighbors = graphNeighbors.length > 0 ? graphNeighbors : geometricNeighbors(t);
  const controlSet = new Set([t, ...neighbors]);
  // Alter Mind (Obi-Wan): figures cost ≤9 within 3 spaces don't count for control
  const alterMindExcluded = _getAlterMindExcludedCells(game);
  // A Powerful Influence (CC): hostile figures within 3 spaces of REBEL FORCE USER don't count for control
  const apiExcluded = _getPowerfulInfluenceExcludedCells(game);
  const p1Cells = getPlayerOccupiedCellsForControl(game, 1);
  const p2Cells = getPlayerOccupiedCellsForControl(game, 2);
  const p1Has = [...controlSet].some((c) => p1Cells.has(c) && !alterMindExcluded[1]?.has(c) && !apiExcluded[1]?.has(c));
  const p2Has = [...controlSet].some((c) => p2Cells.has(c) && !alterMindExcluded[2]?.has(c) && !apiExcluded[2]?.has(c));
  // NPC with hostility='hostile' (Thug) in the controlSet blocks control
  // for both players — per alexanbv 2026-05-10. 'treatedAsHostile' (Krykna)
  // and 'neutral' NPCs do NOT block control. Alter Mind (alexanbv 2026-05-11)
  // removes Thugs within 3 of Obi-Wan from the block list.
  if (_npcBlocksControlIn(game, controlSet, alterMindExcluded.npc)) return null;
  if (p1Has && !p2Has) return 1;
  if (p2Has && !p1Has) return 2;
  return null;
}

function _npcBlocksControlIn(game, controlSet, alterMindExcludedNpcCells) {
  for (const arrName of ['npcThugs', 'npcKrykna']) {
    const arr = game?.[arrName];
    if (!Array.isArray(arr)) continue;
    for (const npc of arr) {
      if (!npc || npc.defeated || !npc.coord) continue;
      const h = npc.hostility || (npc.hostileToAll ? 'hostile' : 'neutral');
      if (h !== 'hostile') continue;
      const _npcCoordNorm = normalizeCoord(npc.coord);
      if (alterMindExcludedNpcCells?.has(_npcCoordNorm)) continue;
      if (controlSet.has(_npcCoordNorm)) return true;
    }
  }
  return false;
}

/** Returns array of figure keys for playerNum whose positions are on or adjacent to coord.
 *
 * Multi-cell figures (Massive: AT-DP, AT-ST, walkers) are detected via their full
 * footprint, not just the anchor. CRR figure-occupancy semantics: a figure occupies
 * every cell of its footprint, so a 2x2 figure whose anchor sits offset from `coord`
 * but whose footprint touches `coord` (or a neighbor of `coord`) must still be
 * counted as "on or adjacent." Without this, crate-explosion damage and crate-
 * control rules silently miss Massive figures whose anchor isn't in the controlSet
 * — same shape as the same-square gap in getFiguresAdjacentToTarget patched
 * 2026-05-04. Mirrors the footprint loop in getFiguresAdjacentToCoord.
 */
export function getFiguresOnOrAdjacentToSpace(game, playerNum, coord, mapId) {
  const mapSpaces = getBoundedMapSpaces(mapId);
  if (!mapSpaces?.adjacency) return [];
  const adjacency = mapSpaces?.adjacency || {};
  const t = normalizeCoord(coord);
  const graphNeighbors = (adjacency[t] || []).map((n) => normalizeCoord(n));
  const neighbors = graphNeighbors.length > 0 ? graphNeighbors : geometricNeighbors(t);
  const controlSet = new Set([t, ...neighbors]);
  const result = [];
  const poses = game.figurePositions?.[playerNum] || {};
  for (const [figKey, figCoord] of Object.entries(poses)) {
    if (!figCoord) continue;
    const dcName = dcNameFromFigureKey(figKey);
    const size = game.figureOrientations?.[figKey] || getFigureSize(dcName);
    const cells = getFootprintCells(figCoord, size).map((c) => normalizeCoord(c));
    if (cells.some((cell) => controlSet.has(cell))) result.push(figKey);
  }
  return result;
}

/** Count terminals exclusively controlled by player (on or adjacent; only they have presence). */
export function countTerminalsControlledByPlayer(game, playerNum, mapId) {
  const terminals = getActiveTerminals(game, mapId);
  if (!terminals.length) return 0;
  // Terminal Network (CSV row 848): until start of next round, the player who
  // played it controls ALL terminals regardless of figure adjacency (alexanbv
  // 2026-06-20; the flag was set but never consulted).
  if (game.terminalControlPlayerNum) {
    return game.terminalControlPlayerNum === playerNum ? terminals.length : 0;
  }
  const mapSpaces = getBoundedMapSpaces(mapId);
  if (!mapSpaces?.adjacency) return 0;
  const adjacency = mapSpaces.adjacency || {};

  const alterMindExcluded = _getAlterMindExcludedCells(game);
  const apiExcluded = _getPowerfulInfluenceExcludedCells(game);
  const p1Cells = getPlayerOccupiedCellsForControl(game, 1);
  const p2Cells = getPlayerOccupiedCellsForControl(game, 2);

  let count = 0;
  for (const term of terminals) {
    const t = normalizeCoord(term);
    const controlSet = new Set([t, ...(adjacency[t] || []).map((n) => normalizeCoord(n))]);
    if (_npcBlocksControlIn(game, controlSet)) continue; // Thug adjacent → uncontrolled
    const p1Has = [...controlSet].some((c) => p1Cells.has(c) && !alterMindExcluded[1]?.has(c) && !apiExcluded[1]?.has(c));
    const p2Has = [...controlSet].some((c) => p2Cells.has(c) && !alterMindExcluded[2]?.has(c) && !apiExcluded[2]?.has(c));
    if (playerNum === 1 && p1Has && !p2Has) count++;
    if (playerNum === 2 && p2Has && !p1Has) count++;
  }
  return count;
}
