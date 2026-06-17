/**
 * Game state reader functions extracted from index.js.
 * Read game state + dcMessageMeta, no Discord writes.
 */

export function hasActionsRemainingInGame(game, gameId, dcMessageMeta) {
  for (const [mid, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    const data = game.dcActionsData?.[mid];
    if (data?.remaining > 0) {
      // Skip fully defeated DCs — stale remaining count on a dead group is not real
      const figs = game.figurePositions?.[meta.playerNum] || {};
      if (!Object.keys(figs).some(fk => fk.startsWith(meta.dcName + '-'))) continue;
      return true;
    }
  }
  return false;
}

/** True when both players have no readied DCs and no actions left to spend. */
export function shouldShowEndActivationPhaseButton(game, gameId, dcMessageMeta) {
  const r1 = game.p1ActivationsRemaining ?? 0;
  const r2 = game.p2ActivationsRemaining ?? 0;
  if (r1 > 0 || r2 > 0) return false;
  if (hasActionsRemainingInGame(game, gameId, dcMessageMeta)) return false;
  return true;
}

/** True if all figures in this deployment group are defeated (or never deployed). */
export function isGroupDefeated(game, playerNum, dcIndex, deps) {
  const dcList = deps.getDcList(game, playerNum) || [];
  const dc = dcList[dcIndex];
  if (!dc) return true;
  const dcName = dc.dcName || dc;
  const displayName = typeof dc === 'object' ? dc.displayName : dcName;
  const dgMatch = displayName?.match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const poses = game.figurePositions?.[playerNum] || {};
  // Any figure with this group's prefix on the board → not defeated. Iterating by
  // prefix (rather than a fixed base figure count) automatically counts a Squad
  // Upgrade figure (e.g. `${dcName}-${dgIndex}-2`), so a group is still "alive"
  // while only its SU figure remains — per the IACP rule. alexanbv 2026-06-17.
  const prefix = `${dcName}-${dgIndex}-`;
  for (const k of Object.keys(poses)) {
    if (k.startsWith(prefix)) return false;
  }
  return true;
}

export function isDepletedRemovedFromGame(game, msgId) {
  if (!game || !msgId) return false;
  const p1 = game.p1DepletedDcMessageIds || [];
  const p2 = game.p2DepletedDcMessageIds || [];
  return p1.includes(msgId) || p2.includes(msgId);
}

export function findDcMessageIdForFigure(gameId, playerNum, figureKey, dcMessageMeta) {
  const m = figureKey.match(/^(.+)-(\d+)-(\d+)$/);
  const dcName = m ? m[1] : figureKey;
  const dgIndex = m ? m[2] : '1';
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId || meta.playerNum !== playerNum) continue;
    const dn = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const metaDgIndex = dn ? String(dn[1]) : '1';
    if (meta.dcName === dcName && metaDgIndex === String(dgIndex)) return msgId;
  }
  return null;
}

export function lookupFigureDcIndex(game, playerNum, figureKey, deps) {
  const msgId = findDcMessageIdForFigure(game.gameId, playerNum, figureKey, deps.dcMessageMeta);
  const dcIds = deps.getDcMessageIds(game, playerNum);
  const dcList = deps.getDcList(game, playerNum);
  const idx = (dcIds || []).indexOf(msgId);
  return { msgId, dcList, idx };
}

export function getFigureLabel(game, playerNum, figureKey, fallback, maxLen, deps) {
  const { msgId, dcList, idx } = lookupFigureDcIndex(game, playerNum, figureKey, deps);
  const raw = (idx >= 0 && dcList?.[idx]?.displayName) ? dcList[idx].displayName : (fallback ?? deps.dcNameFromFigureKey(figureKey));
  return { msgId, label: String(raw).slice(0, maxLen || 80) };
}

export function getPlayerZoneLabel(game, playerId) {
  if (!playerId) return '';
  let zone = playerId === game.player1Id ? game.player1DeploymentZone : game.player2DeploymentZone;
  if (!zone && game.deploymentZoneChosen) {
    zone = (playerId === game.initiativePlayerId) ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  }
  return zone ? `[${zone.toUpperCase()}] ` : '';
}

export function countActiveGamesForPlayer(playerId, gamesMap) {
  if (!playerId) return 0;
  let count = 0;
  for (const [, game] of gamesMap) {
    if (game.ended) continue;
    if (game.player1Id === playerId || game.player2Id === playerId) count++;
  }
  return count;
}
