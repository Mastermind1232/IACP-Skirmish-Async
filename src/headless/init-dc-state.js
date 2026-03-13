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
      const msgId = `headless_p${playerNum}_dc${i}`;

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

  for (const playerNum of [1, 2]) {
    const zone = playerNum === 1 ? game.player1DeploymentZone : game.player2DeploymentZone;
    const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
    if (!dcList?.length) continue;

    // Collect valid deployment spaces
    let deploySpaces = [];
    if (opts.deploymentZones && game.selectedMap?.id) {
      const mapZones = opts.deploymentZones[game.selectedMap.id];
      if (mapZones?.[zone]) {
        deploySpaces = Object.keys(mapZones[zone]);
      }
    }

    // If no zone data, use map spaces as fallback
    if (deploySpaces.length === 0 && opts.mapSpaces) {
      deploySpaces = Object.keys(opts.mapSpaces).slice(0, 50);
    }

    let spaceIdx = 0;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
      const dcName = meta.dcName;
      if (isFigurelessDc(dcName)) continue;

      const stats = getDcStats(dcName);
      const figureCount = stats?.figures ?? 1;

      // Extract dgIndex from displayName
      const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : '1';

      for (let f = 0; f < figureCount; f++) {
        const figureKey = `${dcName}-${dgIndex}-${f}`;
        if (deploySpaces.length > 0) {
          game.figurePositions[playerNum][figureKey] = deploySpaces[spaceIdx % deploySpaces.length];
          spaceIdx++;
        } else {
          // Fallback: synthetic positions
          game.figurePositions[playerNum][figureKey] = `${String.fromCharCode(65 + (spaceIdx % 26))}${spaceIdx + 1}`;
          spaceIdx++;
        }
      }
    }
  }
}
