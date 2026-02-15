/**
 * Mission rules engine: runs data-driven end-of-round (and future) effects from mission-cards.json "rules".
 * Each effect type is implemented here; mission-cards.json supplies parameters (e.g. vp: 15).
 */

function normalizeCoord(c) {
  if (c == null || typeof c !== 'string') return '';
  return String(c).toLowerCase().trim();
}

/** Who controls a named area: player with more figures in the area's cells; tie or none = null. */
function getNamedAreaController(game, mapId, areaName, getMapTokensDataFn) {
  const allTokens = typeof getMapTokensDataFn === 'function' ? getMapTokensDataFn() : {};
  const mapData = allTokens[mapId];
  const areas = mapData?.namedAreas || [];
  const area = [].concat(areas).find((a) => a && String(a.name || '').toLowerCase() === String(areaName || '').toLowerCase());
  if (!area || !Array.isArray(area.cells) || area.cells.length === 0) return null;
  const cellSet = new Set(area.cells.map((c) => normalizeCoord(c)));
  let p1 = 0;
  let p2 = 0;
  for (const pn of [1, 2]) {
    const poses = game.figurePositions?.[pn] || {};
    for (const cell of Object.values(poses)) {
      if (cellSet.has(normalizeCoord(cell))) {
        if (pn === 1) p1++;
        else p2++;
      }
    }
  }
  if (p1 > p2) return 1;
  if (p2 > p1) return 2;
  return null;
}

/**
 * Run end-of-round rules for the given mission variant.
 * @param {object} game - Game state
 * @param {string} mapId - Selected map id
 * @param {string} variant - 'a' or 'b'
 * @param {object} rules - getMissionRules(mapId, variant).endOfRound (object keyed by effect type)
 * @param {object} ctx - { logGameAction, checkWinConditions, getMapTokensData, getSpaceController, client }
 * @returns {Promise<{ gameEnded: boolean }>}
 */
export async function runEndOfRoundRules(game, mapId, variant, rules, ctx) {
  const { logGameAction, checkWinConditions, getMapTokensData, getSpaceController, client } = ctx;
  let gameEnded = false;

  if (!rules || typeof rules !== 'object') return { gameEnded };

  if (rules.vpForControllingNamedArea && mapId) {
    const { areaName, vp = 6 } = rules.vpForControllingNamedArea;
    if (areaName) {
      const controller = getNamedAreaController(game, mapId, areaName, getMapTokensData);
      if (controller) {
        const vpVal = typeof vp === 'number' ? vp : 6;
        const pid = controller === 1 ? game.player1Id : game.player2Id;
        const vpState = game[`player${controller}VP`] || { total: 0, kills: 0, objectives: 0 };
        vpState.total = (vpState.total || 0) + vpVal;
        vpState.objectives = (vpState.objectives || 0) + vpVal;
        game[`player${controller}VP`] = vpState;
        await logGameAction(game, client, `<@${pid}> gained **${vpVal} VP** for controlling **${areaName}**.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) return { gameEnded: true };
      }
    }
  }

  if (rules.vpPerContrabandInDeploymentZone && game.figureContraband) {
    const { vp } = rules.vpPerContrabandInDeploymentZone;
    const vpPerFigure = typeof vp === 'number' ? vp : 15;
    const { isFigureInDeploymentZone } = ctx;
    for (const pn of [1, 2]) {
      let scored = 0;
      for (const [figureKey, carrying] of Object.entries(game.figureContraband)) {
        if (!carrying) continue;
        const poses = game.figurePositions?.[pn] || {};
        if (!(figureKey in poses)) continue;
        if (!isFigureInDeploymentZone(game, pn, figureKey, mapId)) continue;
        const vpState = game[`player${pn}VP`] || { total: 0, kills: 0, objectives: 0 };
        vpState.total = (vpState.total || 0) + vpPerFigure;
        vpState.objectives = (vpState.objectives || 0) + vpPerFigure;
        game[`player${pn}VP`] = vpState;
        delete game.figureContraband[figureKey];
        scored++;
      }
      if (scored > 0) {
        const pid = pn === 1 ? game.player1Id : game.player2Id;
        await logGameAction(game, client, `<@${pid}> gained **${vpPerFigure * scored} VP** for ${scored} figure(s) delivering contraband to deployment zone.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) {
          gameEnded = true;
          return { gameEnded };
        }
      }
    }
  }

  if (rules.vpPerLaunchPanelControlled && mapId) {
    const { green = 5, gray = 2 } = rules.vpPerLaunchPanelControlled;
    const launchPanels = getMapTokensData()[mapId]?.missionA?.launchPanels || [];
    const state = game.launchPanelState || {};
    let p1Vp = 0;
    let p2Vp = 0;
    for (const coord of launchPanels) {
      const c = String(coord).toLowerCase();
      const side = state[c];
      if (!side) continue;
      const controller = getSpaceController(game, mapId, coord);
      if (!controller) continue;
      const vp = side === 'colored' ? green : gray;
      if (controller === 1) p1Vp += vp;
      else p2Vp += vp;
    }
    if (p1Vp > 0) {
      game.player1VP = game.player1VP || { total: 0, kills: 0, objectives: 0 };
      game.player1VP.total += p1Vp;
      game.player1VP.objectives += p1Vp;
      await logGameAction(game, client, `<@${game.player1Id}> gained **${p1Vp} VP** for launch panels controlled.`, { allowedMentions: { users: [game.player1Id] }, phase: 'ROUND', icon: 'round' });
      await checkWinConditions(game, client);
      if (game.ended) return { gameEnded: true };
    }
    if (p2Vp > 0) {
      game.player2VP = game.player2VP || { total: 0, kills: 0, objectives: 0 };
      game.player2VP.total += p2Vp;
      game.player2VP.objectives += p2Vp;
      await logGameAction(game, client, `<@${game.player2Id}> gained **${p2Vp} VP** for launch panels controlled.`, { allowedMentions: { users: [game.player2Id] }, phase: 'ROUND', icon: 'round' });
      await checkWinConditions(game, client);
      if (game.ended) gameEnded = true;
    }
  }

  if (rules.vpPerTokenForControllingCell && mapId) {
    const { controlCell, vpPerToken = 1, tokenCountKey } = rules.vpPerTokenForControllingCell;
    if (controlCell && tokenCountKey) {
      const controller = getSpaceController(game, mapId, controlCell);
      const count = typeof game[tokenCountKey] === 'number' ? game[tokenCountKey] : 0;
      if (controller && count > 0) {
        const vpVal = (typeof vpPerToken === 'number' ? vpPerToken : 1) * count;
        const pid = controller === 1 ? game.player1Id : game.player2Id;
        const vpState = game[`player${controller}VP`] || { total: 0, kills: 0, objectives: 0 };
        vpState.total = (vpState.total || 0) + vpVal;
        vpState.objectives = (vpState.objectives || 0) + vpVal;
        game[`player${controller}VP`] = vpState;
        game[tokenCountKey] = 0;
        await logGameAction(game, client, `<@${pid}> gained **${vpVal} VP** for controlling the objective (${count} token${count !== 1 ? 's' : ''}).`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) return { gameEnded: true };
      } else if (count > 0) {
        game[tokenCountKey] = 0;
      }
    }
  }

  return { gameEnded };
}

/**
 * Run start-of-round rules (e.g. set token count from initiative player's hand).
 * Call when a new round has started (after advancing currentRound).
 * @param {object} game - Game state
 * @param {string} mapId - Selected map id
 * @param {string} variant - 'a' or 'b'
 * @param {object} rules - getMissionRules(mapId, variant).startOfRound (object keyed by effect type)
 * @param {object} ctx - { logGameAction, client } (optional)
 */
export function runStartOfRoundRules(game, mapId, variant, rules, ctx = {}) {
  if (!rules || typeof rules !== 'object') return;
  if (rules.setTokenCountFromInitiativeHand) {
    const { gameKey } = rules.setTokenCountFromInitiativeHand;
    if (gameKey) {
      const initId = game.initiativePlayerId;
      const hand = initId === game.player1Id ? (game.player1CcHand || []) : (game.player2CcHand || []);
      game[gameKey] = hand.length;
    }
  }
}
