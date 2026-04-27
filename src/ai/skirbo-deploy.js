/**
 * Programmatic deployment for SKIRBO.
 *
 * The deployment UI requires typing a coordinate into a modal popup, which
 * AI fakeInteraction can't fill — so the AI got stuck in a loop clicking
 * `deploy_figure_<idx>` over and over.
 *
 * This helper bypasses the UI: it walks SKIRBO's deploy metadata, picks
 * a valid space in the AI's deployment zone for each figure, and writes
 * positions directly to game.figurePositions. Then the deployment_done
 * button is clickable and the game can advance.
 *
 * Multi-cell figures + blocking-terrain rules are respected. Figures with
 * a MOBILE / MASSIVE keyword may sit on blocking spaces.
 */
import { getDeploymentZones, getMapData, getDcKeywords, getFigureSize } from '../data-loader.js';
import { getFootprintCells } from '../game/coords.js';
import { getInitiativePlayerNum } from '../game/player-helpers.js';

/**
 * Place every undeployed figure for `playerNum` at a random valid space.
 * @param {object} game
 * @param {number} playerNum - 1 or 2
 * @returns {{ placed: number, skipped: number, alreadyDeployed: number }}
 */
export function autoDeployForAi(game, playerNum) {
  const result = { placed: 0, skipped: 0, alreadyDeployed: 0 };
  const meta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
  if (!Array.isArray(meta) || meta.length === 0) return result;

  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  if (!zones) return result;

  const initiativePn = getInitiativePlayerNum(game);
  const playerZone = playerNum === initiativePn
    ? game.deploymentZoneChosen
    : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const zoneSpaces = (zones[playerZone] || []).map((s) => String(s).toLowerCase());
  if (zoneSpaces.length === 0) return result;

  const ms = getMapData(mapId);
  const blockingSet = new Set((ms?.blocking || []).map((s) => String(s).toLowerCase()));
  const dcKws = getDcKeywords(game) || {};

  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  const positions = game.figurePositions[playerNum];

  // Track occupied cells to avoid overlap.
  const occupied = new Set();
  for (const otherPn of [1, 2]) {
    const otherPos = game.figurePositions?.[otherPn] || {};
    for (const space of Object.values(otherPos)) {
      const cells = getFootprintCells(String(space).toLowerCase(), '1x1');
      for (const c of cells) occupied.add(String(c).toLowerCase());
    }
  }

  for (const figMeta of meta) {
    if (!figMeta?.dcName) { result.skipped++; continue; }
    const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
    if (positions[figureKey]) { result.alreadyDeployed++; continue; }

    const kws = (dcKws[figMeta.dcName] || []).map((k) => String(k).toUpperCase());
    const canIgnoreBlocking = kws.includes('MOBILE') || kws.includes('MASSIVE');
    const figSize = getFigureSize(figMeta.dcName) || '1x1';

    // Try spaces in random order so SKIRBO doesn't bunch up at A1.
    const candidates = shuffled(zoneSpaces);
    let placedAt = null;
    for (const space of candidates) {
      const cells = getFootprintCells(space, figSize).map((c) => String(c).toLowerCase());
      // Footprint must fit fully inside the zone, not overlap occupied cells,
      // and respect blocking terrain unless figure is MOBILE/MASSIVE.
      if (cells.some((c) => !zoneSpaces.includes(c))) continue;
      if (cells.some((c) => occupied.has(c))) continue;
      if (!canIgnoreBlocking && cells.some((c) => blockingSet.has(c))) continue;
      placedAt = space;
      for (const c of cells) occupied.add(c);
      break;
    }
    if (placedAt) {
      positions[figureKey] = placedAt;
      result.placed++;
    } else {
      result.skipped++;
    }
  }
  return result;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
