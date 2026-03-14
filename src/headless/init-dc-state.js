/**
 * Initialize DC state maps for headless games.
 * Populates dcMessageMeta, dcExhaustedState, dcHealthState,
 * and figurePositions from game squad data.
 */

import { getDcStats, getDcEffects } from '../data-loader.js';
import { isFigurelessDc } from '../game/dc-helpers.js';

/**
 * Generate synthetic message IDs and populate DC state maps.
 * Call after game squads are set but before gameplay begins.
 *
 * @param {object} game
 * @param {Map} dcMessageMeta
 * @param {Map} dcExhaustedState
 * @param {Map} dcHealthState
 */
export function initializeDcState(game, dcMessageMeta, dcExhaustedState, dcHealthState) {
  const gameId = game.gameId;

  for (const playerNum of [1, 2]) {
    const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
    const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
    if (!dcList?.length) continue;

    const dcMessageIds = [];

    for (let i = 0; i < dcList.length; i++) {
      const dc = dcList[i];
      const dcName = typeof dc === 'object' ? dc.dcName : dc;
      const displayName = typeof dc === 'object' ? (dc.displayName || dcName) : dcName;
      const msgId = `hl${playerNum}dc${i}`;

      dcMessageMeta.set(msgId, {
        dcName,
        displayName,
        gameId,
        playerNum,
      });

      dcExhaustedState.set(msgId, false);

      // Build health state for figures
      if (!isFigurelessDc(dcName)) {
        const stats = getDcStats(dcName);
        const figureCount = stats?.figures ?? 1;
        const maxHp = stats?.health ?? 1;
        const healthArr = [];
        for (let f = 0; f < figureCount; f++) {
          healthArr.push([maxHp, maxHp]); // [currentHp, maxHp]
        }
        dcHealthState.set(msgId, healthArr);

        // Sync health state to dcList entry
        if (typeof dc === 'object') {
          dc.healthState = healthArr.map(h => [...h]);
        }
      }

      dcMessageIds.push(msgId);
    }

    // Store message IDs on game for lookup
    if (playerNum === 1) {
      game.p1DcMessageIds = dcMessageIds;
    } else {
      game.p2DcMessageIds = dcMessageIds;
    }
  }
}

/**
 * Initialize figure positions for deployed games.
 * Places figures at valid deployment zone coordinates.
 *
 * @param {object} game
 * @param {Map} dcMessageMeta
 * @param {object} [opts]
 * @param {object} [opts.deploymentZones] - Zone data from getDeploymentZones
 * @param {object} [opts.mapSpaces] - Map spaces data
 */
export function initializeFigurePositions(game, dcMessageMeta, opts = {}) {
  game.figurePositions = game.figurePositions || { 1: {}, 2: {} };

  // Collect ALL playable spaces for placing figures near each other
  let allSpaces = [];
  if (opts.mapSpaces?.adjacency) {
    allSpaces = Object.keys(opts.mapSpaces.adjacency);
  }

  // Use a central cluster of adjacent spaces so figures are within attack range
  // Pick a central space and expand outward via adjacency
  let clusterSpaces = [];
  if (allSpaces.length > 0 && opts.mapSpaces?.adjacency) {
    const adj = opts.mapSpaces.adjacency;
    const start = allSpaces[Math.floor(allSpaces.length / 2)];
    const visited = new Set([start]);
    const queue = [start];
    while (queue.length > 0 && visited.size < 20) {
      const curr = queue.shift();
      for (const neighbor of (adj[curr] || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    clusterSpaces = [...visited];
  }

  // Count P1 figures to offset P2 placement (avoid overlap)
  let p1FigCount = 0;
  for (const [, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== 1) continue;
    if (isFigurelessDc(meta.dcName)) continue;
    const stats = getDcStats(meta.dcName);
    p1FigCount += stats?.figures ?? 1;
  }

  for (const playerNum of [1, 2]) {
    const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
    if (!dcList?.length) continue;

    let spaceIdx = playerNum === 1 ? 0 : p1FigCount;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
      const dcName = meta.dcName;
      if (isFigurelessDc(dcName)) continue;

      const stats = getDcStats(dcName);
      const figureCount = stats?.figures ?? 1;

      const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : '1';

      for (let f = 0; f < figureCount; f++) {
        const figureKey = `${dcName}-${dgIndex}-${f}`;
        if (clusterSpaces.length > 0) {
          game.figurePositions[playerNum][figureKey] = clusterSpaces[spaceIdx % clusterSpaces.length];
          spaceIdx++;
        } else {
          game.figurePositions[playerNum][figureKey] = `${String.fromCharCode(65 + (spaceIdx % 26))}${spaceIdx + 1}`;
          spaceIdx++;
        }
      }
    }
  }
}
