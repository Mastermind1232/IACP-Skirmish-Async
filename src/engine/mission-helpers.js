/**
 * VP/mission helper functions extracted from index.js.
 * Pure game-state readers — no Discord dependency.
 */

/** Get the mission-specific token label for the current game. */
export function getMissionTokenLabel(game, deps) {
  if (game?.selectedMission?.tokenLabel) return game.selectedMission.tokenLabel;
  const mapId = game?.selectedMap?.id;
  const variant = game?.selectedMission?.variant;
  if (mapId && variant) {
    const missionData = deps.getMissionCardsData()?.[mapId]?.[variant];
    if (missionData?.tokenLabel) return missionData.tokenLabel;
  }
  return 'Mission Token';
}

/** Compute persistent VP bonus from crates in deployment zones (Devaron Garrison B). */
export function getCrateDeploymentVpBonus(game, deps) {
  if (game.selectedMap?.id !== 'devaron-garrison' || game.selectedMission?.variant !== 'b') return { p1: 0, p2: 0 };
  const mapData = deps.getMapTokensData()['devaron-garrison'];
  const allCrateCoords = Object.values(mapData?.missionB?.positions || {}).flat().filter(Boolean);
  const cratePositions = allCrateCoords.map((c) => deps.normalizeCoord(game.cratePositions?.[deps.normalizeCoord(c)] || c));
  const initPlayerNum = deps.getInitiativePlayerNum(game);
  const zones = deps.getDeploymentZones()['devaron-garrison'] || {};
  const { p1Zone, p2Zone } = deps.getPlayerDeploymentZones(game, initPlayerNum);
  const p1ZoneSet = new Set((zones[p1Zone] || []).map((c) => deps.normalizeCoord(c)));
  const p2ZoneSet = new Set((zones[p2Zone] || []).map((c) => deps.normalizeCoord(c)));
  let p1 = 0;
  let p2 = 0;
  for (const coord of cratePositions) {
    if (p1ZoneSet.has(coord)) p1 += 6;
    else if (p2ZoneSet.has(coord)) p2 += 6;
  }
  return { p1, p2 };
}

/** Compute persistent VP bonus from Anchorhead A patron tokens. */
export function getAnchorheadPatronVpBonus(game) {
  if (game.selectedMap?.id !== 'anchorhead-cantina-bar' || game.selectedMission?.variant !== 'a') return { p1: 0, p2: 0 };
  const VP_TABLE = [0, 2, 5, 10, 20];
  const patronTokens = game.anchorheadPatronTokens || {};
  let p1 = 0;
  let p2 = 0;
  for (const owner of Object.values(patronTokens)) {
    if (owner === 1) p1++;
    else if (owner === 2) p2++;
  }
  return { p1: VP_TABLE[Math.min(p1, 4)] || 0, p2: VP_TABLE[Math.min(p2, 4)] || 0 };
}

/** Combined mission VP bonus. Returns { p1, p2 } or undefined if no bonuses apply. */
export function getMissionVpBonus(game, deps) {
  const crate = getCrateDeploymentVpBonus(game, deps);
  const patron = getAnchorheadPatronVpBonus(game);
  const p1 = crate.p1 + patron.p1;
  const p2 = crate.p2 + patron.p2;
  return (p1 || p2) ? { p1, p2 } : undefined;
}

/** Calculate VP value for killing a deployment card's figures. */
export function calculateKillVp(dcName, deps) {
  if (deps.isDcCompanion(dcName)) return 0;
  const stats = deps.getDcStats(dcName);
  const effects = deps.getDcEffects()?.[dcName];
  const figures = stats?.figures ?? 1;
  return (figures > 1 && effects?.subCost != null) ? effects.subCost : (stats?.cost ?? 5);
}
