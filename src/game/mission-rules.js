/**
 * Mission rules engine: runs data-driven end-of-round (and future) effects from mission-cards.json "rules".
 * Each effect type is implemented here; mission-cards.json supplies parameters (e.g. vp: 15).
 */
import { awardObjectiveVp } from './vp-helpers.js';
import { getPlayerId, getCcHand, getInitiativePlayerNum } from './player-helpers.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { grantPowerTokens } from './game-helpers.js';
import { getDeploymentZones, getMissionFlag } from '../data-loader.js';
import { getPlayerOccupiedCellsForControl } from './board-helpers.js';
import { snowflakeUsers } from '../discord/channel-helpers.js';
import { normalizeCoord } from './coords.js';

/**
 * Canonical accessor for current fluctuation positions.
 * Lazily deep-copies static JSON positions into game.fluctuationPositions on first access.
 * All consumers (VP scoring, power token grant, map rendering, swap UI) use this single function.
 * @param {object} game
 * @param {string} mapId
 * @param {Function} getMapTokensDataFn
 * @returns {object} { "0": ["j10", "p10"], "2": ["h21", "t21"], ... } — string keys, string arrays
 */
export function getCurrentFluctuationPositions(game, mapId, getMapTokensDataFn) {
  if (game.fluctuationPositions) return game.fluctuationPositions;
  const allTokens = typeof getMapTokensDataFn === 'function' ? getMapTokensDataFn() : {};
  const missionData = allTokens[mapId]?.missionB;
  const positions = missionData?.positions || {};
  game.fluctuationPositions = {};
  for (const [id, coords] of Object.entries(positions)) {
    game.fluctuationPositions[id] = (coords || []).map(c => normalizeCoord(c));
  }
  return game.fluctuationPositions;
}

/** Extract flat coordinate array from a missionA/missionB token data block (generic). */
function extractTokenCoords(missionTokenData) {
  if (!missionTokenData) return [];
  if (missionTokenData.positions && typeof missionTokenData.positions === 'object') {
    return Object.values(missionTokenData.positions).flat();
  }
  for (const val of Object.values(missionTokenData)) {
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') return val;
  }
  return [];
}

/** Who controls a named area: player with more figures in the area's cells; tie or none = null.
 *  Excludes companion figures not counted for control (Indentured Jester, Clan of Two incapacitated,
 *  Dio while Iden Versio is alive). */
function getNamedAreaController(game, mapId, areaName, getMapTokensDataFn) {
  const allTokens = typeof getMapTokensDataFn === 'function' ? getMapTokensDataFn() : {};
  const mapData = allTokens[mapId];
  const areas = mapData?.namedAreas || [];
  const area = [].concat(areas).find((a) => a && String(a.name || '').toLowerCase() === String(areaName || '').toLowerCase());
  if (!area || !Array.isArray(area.cells) || area.cells.length === 0) return null;
  const cellSet = new Set(area.cells.map((c) => normalizeCoord(c)));
  // Companions not counted for control: Salacious B. Crumb (Indentured Jester — always excluded),
  // The Child (Clan of Two — excluded while incapacitated, i.e. when game.childIncapacitated is true),
  // Dio (excluded while Iden Versio is alive; counts after Iden is defeated)
  const excludedNames = new Set(['salacious b. crumb']);
  if (game.childIncapacitated) excludedNames.add('the child');
  // Pre-check whether Iden Versio is alive for each player (Dio excluded only while Iden lives)
  const idenAlive = {};
  for (const pn of [1, 2]) {
    idenAlive[pn] = Object.keys(game.figurePositions?.[pn] || {}).some((fk) => dcNameFromFigureKey(fk) === 'Iden Versio');
  }
  let p1 = 0;
  let p2 = 0;
  for (const pn of [1, 2]) {
    const poses = game.figurePositions?.[pn] || {};
    for (const [fk, cell] of Object.entries(poses)) {
      if (!cellSet.has(normalizeCoord(cell))) continue;
      const dcName = dcNameFromFigureKey((fk || '')).toLowerCase();
      if (excludedNames.has(dcName)) continue;
      // Dio excluded while its owner Iden Versio is alive
      if (dcName === 'dio' && idenAlive[pn]) continue;
      if (pn === 1) p1++;
      else p2++;
    }
  }
  if (p1 > p2) return 1;
  if (p2 > p1) return 2;
  return null;
}

/**
 * Experimental Weapons (Development Facility B) rule reader. Per
 * destruct 2026-05-08 the carrier gains 3 special-action / double-action
 * options as extra buttons on their DC actions message; combat-bridge
 * applies weaponPrototypeCarrierBlockPenalty to defense; the action list
 * (weaponPrototypeCarrierActions) is consumed by components.js when
 * rendering the carrier's button row.
 *
 * @param {object} game
 * @returns {{ blockPenalty: number, carrierActions: Array }}
 */
export function getExperimentalWeaponsRules(game) {
  const persistent = game?.selectedMission?.rules?.persistent;
  return {
    blockPenalty: typeof persistent?.weaponPrototypeCarrierBlockPenalty === 'number' ? persistent.weaponPrototypeCarrierBlockPenalty : 0,
    carrierActions: Array.isArray(persistent?.weaponPrototypeCarrierActions) ? persistent.weaponPrototypeCarrierActions : [],
  };
}

/**
 * Line of Fire (Anchorhead Cantina Bar B) rule readers. The actual dispatch
 * happens in:
 *   • src/handlers/movement.js — extractionPointVp on figure entry
 *   • src/engine/combat-bridge.js — crateBlockSink during attack resolution
 *   • src/handlers/dc-play-area.js — smallFigureCarryNoAttack on dc_attack_
 * These tiny readers expose the rule shape from a centrally-tested file so
 * the dispatch-parity test can recognize the keys, and consumers can opt in
 * to data-driven access without re-walking the rules tree.
 *
 * @param {object} game
 * @returns {{ extractionPointVp: ?{vpBase:number,vpPenaltyPerBlockSuffered:number}, crateBlockSink: ?{maxBlockPerAttack:number,healthPerCrate:number}, smallFigureCarryNoAttack: boolean }}
 */
export function getLineOfFireRules(game) {
  const persistent = game?.selectedMission?.rules?.persistent;
  return {
    extractionPointVp: persistent?.extractionPointVp || null,
    crateBlockSink: persistent?.crateBlockSink || null,
    smallFigureCarryNoAttack: persistent?.smallFigureCarryNoAttack === true,
  };
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
    const { areaName, vp, vpMessage } = rules.vpForControllingNamedArea;
    if (areaName && typeof vp === 'number') {
      const controller = getNamedAreaController(game, mapId, areaName, getMapTokensData);
      if (controller) {
        const vpVal = vp;
        const pid = getPlayerId(game, controller);
        awardObjectiveVp(game, controller, vpVal);
        const msg = vpMessage
          ? vpMessage.replace('{vp}', String(vpVal)).replace('{area}', areaName)
          : `controlling **${areaName}**`;
        await logGameAction(game, client, `<@${pid}> gained **${vpVal} VP** — ${msg}.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) return { gameEnded: true };
      }
    }
  }

  if (rules.vpPerContrabandInDeploymentZone && game.figureContraband) {
    const { vp, vpMessage } = rules.vpPerContrabandInDeploymentZone;
    if (typeof vp === 'number') {
      const vpPerToken = vp;
      const { isFigureInDeploymentZone } = ctx;
      for (const pn of [1, 2]) {
        let tokensScored = 0;
        let figuresScored = 0;
        for (const [figureKey, carrying] of Object.entries(game.figureContraband)) {
          if (!carrying) continue;
          const poses = game.figurePositions?.[pn] || {};
          if (!(figureKey in poses)) continue;
          if (!isFigureInDeploymentZone(game, pn, figureKey, mapId)) continue;
          // Per destruct 2026-05-07: figures may carry multiple tokens.
          // Score VP per token, then drop the carrier's stack to zero.
          const carryCount = typeof carrying === 'number' ? carrying : 1;
          const vpEarned = vpPerToken * carryCount;
          const vpState = game[`player${pn}VP`] || { total: 0, kills: 0, objectives: 0 };
          vpState.total = (vpState.total || 0) + vpEarned;
          vpState.objectives = (vpState.objectives || 0) + vpEarned;
          game[`player${pn}VP`] = vpState;
          delete game.figureContraband[figureKey];
          tokensScored += carryCount;
          figuresScored++;
        }
        if (tokensScored > 0) {
          const pid = getPlayerId(game, pn);
          const totalVp = vpPerToken * tokensScored;
          const msg = vpMessage
            ? vpMessage.replace('{vp}', String(totalVp)).replace('{count}', String(tokensScored))
            : `${tokensScored} contraband token(s) across ${figuresScored} figure(s) — ${vpPerToken} VP each`;
          await logGameAction(game, client, `<@${pid}> gained **${totalVp} VP** — ${msg}.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
          await checkWinConditions(game, client);
          if (game.ended) return { gameEnded: true };
        }
      }
    }
  }

  if (rules.vpPerLaunchPanelControlled && mapId) {
    const { green, gray, vpMessage } = rules.vpPerLaunchPanelControlled;
    if (typeof green === 'number' && typeof gray === 'number') {
      const variant = game?.selectedMission?.variant || 'a';
      const missionSide = variant === 'a' ? 'missionA' : 'missionB';
      const launchPanels = extractTokenCoords(getMapTokensData()[mapId]?.[missionSide]);
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
        awardObjectiveVp(game, 1, p1Vp);
        const msg = vpMessage ? vpMessage.replace('{vp}', String(p1Vp)) : `mission objective`;
        await logGameAction(game, client, `<@${game.player1Id}> gained **${p1Vp} VP** — ${msg}.`, { allowedMentions: { users: snowflakeUsers([game.player1Id]) }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) return { gameEnded: true };
      }
      if (p2Vp > 0) {
        awardObjectiveVp(game, 2, p2Vp);
        const msg = vpMessage ? vpMessage.replace('{vp}', String(p2Vp)) : `mission objective`;
        await logGameAction(game, client, `<@${game.player2Id}> gained **${p2Vp} VP** — ${msg}.`, { allowedMentions: { users: snowflakeUsers([game.player2Id]) }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) return { gameEnded: true };
      }
    }
  }

  // setTemporaryVpBuffForControllingCell: per CRR "is considered to have N
  // additional VP" mechanic (Sabacc Standoff). Per destruct 2026-05-07:
  // tokens accumulate next to the Cantina across rounds (e.g. 3 + 4 + 2 = 9
  // by round 3). The buff is recomputed each EoR from the running total —
  // it is "until end of next round" for the *current controller's claim*,
  // not for the tokens themselves (tokens persist). If a different player
  // controls the Cantina next round they can score against the same pool.
  if (rules.setTemporaryVpBuffForControllingCell && mapId) {
    const { controlCell, vpPerToken, tokenCountKey, buffStateKey, vpMessage: tokenVpMsg } = rules.setTemporaryVpBuffForControllingCell;
    if (controlCell && tokenCountKey && buffStateKey && typeof vpPerToken === 'number') {
      // Reset both players' buff slots — only the current controller's
      // buff applies during the next round.
      game[buffStateKey] = { p1: 0, p2: 0 };
      const controller = getSpaceController(game, mapId, controlCell);
      const count = typeof game[tokenCountKey] === 'number' ? game[tokenCountKey] : 0;
      if (controller && count > 0) {
        const vpVal = vpPerToken * count;
        game[buffStateKey][`p${controller}`] = vpVal;
        // Tokens are NOT consumed — they persist next to the Cantina and
        // accumulate further as more rounds add to the pool.
        const pid = getPlayerId(game, controller);
        const ctrlMsg = tokenVpMsg
          ? tokenVpMsg.replace('{vp}', String(vpVal)).replace('{count}', String(count))
          : `controlling the objective (${count} token${count !== 1 ? 's' : ''})`;
        await logGameAction(game, client, `<@${pid}> is considered to have **+${vpVal} VP** during the next round — ${ctrlMsg}.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) return { gameEnded: true };
      } else if (controller === null && count > 0) {
        // Tokens still on table but no one controls — log and keep them in
        // the pool for next round.
        await logGameAction(game, client, `🎯 **[Mission VP] Sabacc Standoff** — no one controls the Cantina; **${count}** token${count !== 1 ? 's' : ''} remain in the pool for next round.`, { phase: 'ROUND', icon: 'round' });
      }
    }
  }

  // vpPerTokenForControllingCell handler removed: orphan after Sabacc Standoff
  // switched to setTemporaryVpBuffForControllingCell (CRR "considered to have +N
  // VP until end of next round"). No mission-cards.json data uses this key any
  // more. Re-add only when a mission with permanent token-VP scoring ships.

  // vpPerControlledSpaceInList: iterate all mission token positions, award vp to controller of each space.
  // Used by Lothal Wastes A (Blitz): 2 VP per critical position controlled.
  if (rules.vpPerControlledSpaceInList && mapId) {
    const { vp, vpMessage } = rules.vpPerControlledSpaceInList;
    if (typeof vp === 'number') {
      const missionSide = variant === 'a' ? 'missionA' : 'missionB';
      const missionData = getMapTokensData()[mapId]?.[missionSide];
      const allSpaces = Object.values(missionData?.positions || {}).flat().filter(Boolean);
      const vpByPlayer = { 1: 0, 2: 0 };
      for (const coord of allSpaces) {
        const controller = getSpaceController(game, mapId, coord);
        if (controller) vpByPlayer[controller] += vp;
      }
      for (const pn of [1, 2]) {
        if (vpByPlayer[pn] > 0) {
          const vpVal = vpByPlayer[pn];
          const count = vpByPlayer[pn] / vp;
          const pid = getPlayerId(game, pn);
          awardObjectiveVp(game, pn, vpVal);
          const msg = vpMessage
            ? vpMessage.replace('{vp}', String(vpVal)).replace('{count}', String(count))
            : `mission objective (${count} position${count !== 1 ? 's' : ''} × ${vp} VP)`;
          await logGameAction(game, client, `<@${pid}> gained **${vpVal} VP** — ${msg}.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
          await checkWinConditions(game, client);
          if (game.ended) return { gameEnded: true };
        }
      }
    }
  }

  // vpPerControlledFluctuation: for each fluctuation space, award vp to controller and grant a color-matched
  // power token to any figure standing on that space. Used by Lothal Wastes B (Fluctuations).
  if (rules.vpPerControlledFluctuation && mapId) {
    const { vp, grantPowerToken, vpMessage } = rules.vpPerControlledFluctuation;
    if (typeof vp === 'number') {
      const missionData = getMapTokensData()[mapId]?.missionB;
      const tokenTypes = missionData?.tokenTypes || [];
      const positions = getCurrentFluctuationPositions(game, mapId, getMapTokensData);
      const colorToPowerToken = { yellow: 'Surge', blue: 'Evade', green: 'Block', red: 'Damage' };
      const vpByPlayer = { 1: 0, 2: 0 };
      const tokensGranted = [];
      for (const [id, coords] of Object.entries(positions)) {
        if (!Array.isArray(coords) || coords.length === 0) continue;
        const typeInfo = tokenTypes[parseInt(id)];
        const imageMatch = (typeInfo?.image || '').match(/Neutral (\w+)\./i);
        const color = imageMatch ? imageMatch[1].toLowerCase() : null;
        const powerToken = color ? (colorToPowerToken[color] || null) : null;
        for (const coord of coords) {
          const controller = getSpaceController(game, mapId, coord);
          if (controller) vpByPlayer[controller] += vp;
          if (grantPowerToken && powerToken) {
            for (const pn of [1, 2]) {
              const poses = game.figurePositions?.[pn] || {};
              for (const [figKey, figCoord] of Object.entries(poses)) {
                if (normalizeCoord(figCoord) === normalizeCoord(coord)) {
                  grantPowerTokens(game, figKey, powerToken, 1);
                  tokensGranted.push(`${figKey} → ${powerToken}`);
                }
              }
            }
          }
        }
      }
      for (const pn of [1, 2]) {
        if (vpByPlayer[pn] > 0) {
          const vpVal = vpByPlayer[pn];
          const count = vpByPlayer[pn] / vp;
          const pid = getPlayerId(game, pn);
          awardObjectiveVp(game, pn, vpVal);
          const msg = vpMessage
            ? vpMessage.replace('{vp}', String(vpVal)).replace('{count}', String(count))
            : `mission objective (${count} fluctuation${count !== 1 ? 's' : ''} controlled)`;
          await logGameAction(game, client, `<@${pid}> gained **${vpVal} VP** — ${msg}.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
          await checkWinConditions(game, client);
          if (game.ended) return { gameEnded: true };
        }
      }
      if (grantPowerToken) {
        await logGameAction(game, client, `🎯 **[Mission Effect] Fluctuations** — Figures standing on fluctuation spaces received Power Tokens (Yellow→Surge, Blue→Evade, Green→Block, Red→Damage). _Reminder: each player may now swap 1 fluctuation with another._`, { phase: 'ROUND', icon: 'round' });
      }
    }
  }

  // vpPerStrainOnControlledSpaces: score 2 VP per strain token on each signal marker the player controls.
  // Strain is removed after scoring. Used by Chopper Base B (Powered Perimeter).
  if (rules.vpPerStrainOnControlledSpaces && mapId) {
    const { vpPerStrain = 2, strainStateKey = 'signalMarkerStrain', vpMessage } = rules.vpPerStrainOnControlledSpaces;
    const strainMap = game[strainStateKey];
    if (strainMap && typeof strainMap === 'object') {
      const vpByPlayer = { 1: 0, 2: 0 };
      const strainRemovedByPlayer = { 1: 0, 2: 0 };
      for (const [coord, strainCount] of Object.entries(strainMap)) {
        if (!strainCount || strainCount <= 0) continue;
        const controller = getSpaceController(game, mapId, coord);
        if (!controller) continue; // uncontrolled markers retain strain
        vpByPlayer[controller] += vpPerStrain * strainCount;
        strainRemovedByPlayer[controller] += strainCount;
        game[strainStateKey][coord] = 0;
      }
      for (const pn of [1, 2]) {
        if (vpByPlayer[pn] > 0) {
          const vpVal = vpByPlayer[pn];
          const removed = strainRemovedByPlayer[pn];
          const pid = getPlayerId(game, pn);
          awardObjectiveVp(game, pn, vpVal);
          const msg = vpMessage
            ? vpMessage.replace('{vp}', String(vpVal)).replace('{count}', String(removed))
            : `signal markers controlled (${removed} strain removed × ${vpPerStrain} VP)`;
          await logGameAction(game, client, `<@${pid}> gained **${vpVal} VP** — ${msg}.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
          await checkWinConditions(game, client);
          if (game.ended) return { gameEnded: true };
        }
      }
    }
  }

  // autoDistributeCrateTokens: per destruct 2026-05-07, the controlling
  // player MAY distribute the Power Tokens among friendly figures on or
  // adjacent to the crate (player choice — not auto-pick first). We award
  // 2 VP per controlled crate immediately (deterministic), and queue
  // each crate's tokens for an interactive distribute prompt that
  // _continueAfterMissionSor (round.js) posts to the general channel.
  // Crates with no eligible nearby friendly are dropped without grant.
  if (rules.autoDistributeCrateTokens && mapId) {
    const { vpPerCrate = 2 } = rules.autoDistributeCrateTokens;
    const { getFiguresOnOrAdjacentToSpace } = ctx;
    const crateTokens = game.crateTokens;
    if (crateTokens && typeof crateTokens === 'object') {
      const vpByPlayer = { 1: 0, 2: 0 };
      const queue = [];
      const droppedLog = [];
      for (const [coord, tokens] of Object.entries(crateTokens)) {
        if (!Array.isArray(tokens) || tokens.length === 0) continue;
        const controller = getSpaceController(game, mapId, coord);
        if (!controller) { game.crateTokens[coord] = []; continue; }
        vpByPlayer[controller] += vpPerCrate;
        const nearbyFigs = getFiguresOnOrAdjacentToSpace
          ? getFiguresOnOrAdjacentToSpace(game, controller, coord, mapId)
          : [];
        if (nearbyFigs.length === 0) {
          droppedLog.push(`${coord}: [${tokens.join(', ')}] — no friendly adjacent; tokens lost`);
        } else {
          queue.push({ playerNum: controller, crateCoord: coord, tokens: [...tokens], eligibleFigs: [...nearbyFigs] });
        }
        game.crateTokens[coord] = [];
      }
      if (queue.length > 0) {
        game.pendingArmsDistribution = { queue, postedFor: null };
      }
      if (droppedLog.length > 0) {
        await logGameAction(game, client, `**Arms Salvage:** ${droppedLog.join(' | ')}`, { phase: 'ROUND', icon: 'round' });
      }
      for (const pn of [1, 2]) {
        if (vpByPlayer[pn] > 0) {
          const vpVal = vpByPlayer[pn];
          const count = vpByPlayer[pn] / vpPerCrate;
          const pid = getPlayerId(game, pn);
          awardObjectiveVp(game, pn, vpVal);
          await logGameAction(game, client, `<@${pid}> gained **${vpVal} VP** — ${count} crate${count !== 1 ? 's' : ''} controlled (${vpPerCrate} VP each).`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
          await checkWinConditions(game, client);
          if (game.ended) return { gameEnded: true };
        }
      }
    }
  }

  // vpPerControlledDeploymentZone: award VP for each deployment zone a player controls.
  // CRR CONTROL: "a player Controls a deployment zone if there is at least one
  // friendly figure in any space of that deployment zone and no hostile figures
  // in any space of that deployment zone." Used by Hoth Battle Station A
  // (Inside Job): 3 VP per zone controlled.
  if (rules.vpPerControlledDeploymentZone && mapId) {
    const { vp, vpMessage } = rules.vpPerControlledDeploymentZone;
    if (typeof vp === 'number') {
      const zoneData = getDeploymentZones()?.[mapId];
      if (zoneData) {
        const p1Cells = getPlayerOccupiedCellsForControl(game, 1);
        const p2Cells = getPlayerOccupiedCellsForControl(game, 2);
        const vpByPlayer = { 1: 0, 2: 0 };
        for (const zoneColor of ['red', 'blue']) {
          const zoneSpaces = new Set((zoneData[zoneColor] || []).map(s => normalizeCoord(s)));
          if (zoneSpaces.size === 0) continue;
          let p1Count = 0, p2Count = 0;
          for (const c of zoneSpaces) {
            if (p1Cells.has(c)) p1Count++;
            if (p2Cells.has(c)) p2Count++;
          }
          if (p1Count > 0 && p2Count === 0) vpByPlayer[1] += vp;
          else if (p2Count > 0 && p1Count === 0) vpByPlayer[2] += vp;
        }
        for (const pn of [1, 2]) {
          if (vpByPlayer[pn] > 0) {
            const vpVal = vpByPlayer[pn];
            const count = vpVal / vp;
            const pid = getPlayerId(game, pn);
            awardObjectiveVp(game, pn, vpVal);
            const msg = vpMessage || `deployment zone(s) controlled (${vp} VP each)`;
            await logGameAction(game, client, `<@${pid}> gained **${vpVal} VP** — ${msg}.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
            await checkWinConditions(game, client);
            if (game.ended) return { gameEnded: true };
          }
        }
      }
    }
  }

  // movePrototypePerTerminal: builds a per-terminal pick queue that the
  // round.js continuation pops via interactive prompts. Used by The
  // Art of Robotics (Development Facility A): each terminal a player
  // controls grants one prototype-move (up to 4 spaces). Per destruct
  // 2026-05-08. Awards no VP itself — the companion rule
  // vpForControllingAtLeastOnePrototype handles scoring AFTER moves.
  if (rules.movePrototypePerTerminal && mapId) {
    const { movePerPick = 4 } = rules.movePrototypePerTerminal;
    const { countTerminalsControlledByPlayer } = ctx;
    if (typeof countTerminalsControlledByPlayer === 'function') {
      const initPn = getInitiativePlayerNum(game);
      const otherPn = initPn === 1 ? 2 : 1;
      const queue = [];
      for (const pn of [initPn, otherPn]) {
        const tCount = countTerminalsControlledByPlayer(game, pn, mapId) || 0;
        for (let i = 0; i < tCount; i++) queue.push({ playerNum: pn, movePerPick });
      }
      if (queue.length > 0) {
        // Lazy-init prototypePositions from missionA token positions.
        if (!game.prototypePositions) {
          const _ppData = getMapTokensData?.()[mapId]?.missionA;
          const _ppCoords = Object.values(_ppData?.positions || {}).flat().filter(Boolean);
          game.prototypePositions = {};
          _ppCoords.forEach((c, i) => { game.prototypePositions[`prototype-${i + 1}`] = normalizeCoord(c); });
        }
        game.pendingPrototypeMoveQueue = queue;
      }
    }
  }

  // vpForControllingAtLeastOnePrototype: 8 VP per player who controls
  // at least one Droid prototype (post-move). Used by The Art of
  // Robotics (Development Facility A). Per destruct 2026-05-08.
  if (rules.vpForControllingAtLeastOnePrototype && mapId) {
    const { vp = 8, vpMessage } = rules.vpForControllingAtLeastOnePrototype;
    const positions = game.prototypePositions;
    if (positions && typeof positions === 'object') {
      // For each player, check if they control any prototype space.
      for (const pn of [1, 2]) {
        let controlsAny = false;
        for (const coord of Object.values(positions)) {
          if (!coord) continue;
          const _ppController = getSpaceController(game, mapId, coord);
          if (_ppController === pn) { controlsAny = true; break; }
        }
        if (controlsAny) {
          const pid = getPlayerId(game, pn);
          awardObjectiveVp(game, pn, vp);
          const msg = vpMessage || `controlling at least 1 Droid prototype (${vp} VP)`;
          await logGameAction(game, client, `<@${pid}> gained **${vp} VP** — ${msg}.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
          await checkWinConditions(game, client);
          if (game.ended) return { gameEnded: true };
        }
      }
    }
  }

  // vpPerContrabandInOpponentDeploymentZone: score VP for figures carrying contraband in the OPPONENT's deployment zone.
  // Used by Hoth Battle Station B (Bomb Drop): 4 VP per explosive discarded.
  if (rules.vpPerContrabandInOpponentDeploymentZone && game.figureContraband) {
    const { vp, vpMessage } = rules.vpPerContrabandInOpponentDeploymentZone;
    if (typeof vp === 'number') {
      const oppZoneData = getDeploymentZones()?.[mapId];
      if (oppZoneData) {
        const initPn = getInitiativePlayerNum(game);
        for (const pn of [1, 2]) {
          const oppPn = 3 - pn;
          const oppZoneColor = oppPn === initPn ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
          const oppZoneSpaces = new Set((oppZoneData[oppZoneColor] || []).map(s => normalizeCoord(s)));
          let tokensScored = 0;
          for (const [figureKey, carrying] of Object.entries(game.figureContraband)) {
            if (!carrying) continue;
            const poses = game.figurePositions?.[pn] || {};
            if (!(figureKey in poses)) continue;
            const figCoord = normalizeCoord(poses[figureKey]);
            if (!oppZoneSpaces.has(figCoord)) continue;
            // Per destruct 2026-05-07: multi-carry — discard ALL carried
            // explosives on this figure and score VP per discarded.
            const carryCount = typeof carrying === 'number' ? carrying : 1;
            tokensScored += carryCount;
            delete game.figureContraband[figureKey];
          }
          if (tokensScored > 0) {
            const vpVal = vp * tokensScored;
            const pid = getPlayerId(game, pn);
            awardObjectiveVp(game, pn, vpVal);
            const msg = vpMessage
              ? vpMessage.replace('{vp}', String(vpVal)).replace('{count}', String(tokensScored))
              : `${tokensScored} explosive(s) discarded in opponent's deployment zone (${vp} VP each)`;
            await logGameAction(game, client, `<@${pid}> gained **${vpVal} VP** — ${msg}.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
            await checkWinConditions(game, client);
            if (game.ended) return { gameEnded: true };
          }
        }
      }
    }
  }

  return { gameEnded };
}

/**
 * Run start-of-round rules.
 * Now async so rules can log via logGameAction.
 * @param {object} game
 * @param {string} mapId
 * @param {string} variant - 'a' | 'b'
 * @param {object} rules - getMissionRules(mapId, variant).startOfRound
 * @param {object} ctx - { logGameAction, client, getMapTokensData }
 */
export async function runStartOfRoundRules(game, mapId, variant, rules, ctx = {}) {
  if (!rules || typeof rules !== 'object') return;
  const { logGameAction, client, getMapTokensData } = ctx;

  if (rules.setTokenCountFromInitiativeHand) {
    const { gameKey } = rules.setTokenCountFromInitiativeHand;
    if (gameKey) {
      const initId = game.initiativePlayerId;
      const hand = initId === game.player1Id ? (game.player1CcHand || []) : (game.player2CcHand || []);
      // Per destruct 2026-05-07: tokens accumulate next to the Cantina
      // across rounds (round 1 places 3, round 2 places 4, etc → total 7,
      // and so on). Add to the running count rather than overwriting.
      const prior = typeof game[gameKey] === 'number' ? game[gameKey] : 0;
      const placed = hand.length;
      game[gameKey] = prior + placed;
      if (logGameAction && client) {
        const missionName = game.selectedMission?.name || 'Mission Effect';
        await logGameAction(game, client, `🎯 **[Mission VP] ${missionName}** — initiative player places **${placed}** token${placed !== 1 ? 's' : ''} next to the Cantina (total now **${game[gameKey]}**). Control the Cantina at end of round to claim +1 VP per token.`, { phase: 'ROUND', icon: 'round' });
      }
    }
  }

  // randomRevealAndPlaceStrain: each player randomly reveals one token from the face-down set.
  // +1 strain placed on each signal marker matching the revealed color.
  // Used by Chopper Base B (Powered Perimeter).
  if (rules.randomRevealAndPlaceStrain && mapId && getMapTokensData) {
    const { strainStateKey = 'signalMarkerStrain' } = rules.randomRevealAndPlaceStrain;
    const missionSide = variant === 'a' ? 'missionA' : 'missionB';
    const missionData = getMapTokensData()[mapId]?.[missionSide];
    const tokenTypes = missionData?.tokenTypes || [];
    const positions = missionData?.positions || {};
    // Build list of color groups (skip empty position groups)
    const colorGroups = [];
    for (const [id, coords] of Object.entries(positions)) {
      if (!Array.isArray(coords) || coords.length === 0) continue;
      const typeInfo = tokenTypes[parseInt(id)];
      const imageMatch = (typeInfo?.image || '').match(/Neutral (\w+)\./i);
      const color = imageMatch ? imageMatch[1].toLowerCase() : null;
      if (color) colorGroups.push({ id, color, coords });
    }
    if (colorGroups.length > 0) {
      game[strainStateKey] = game[strainStateKey] || {};
      // Shuffle tokens (Fisher-Yates) — draw without replacement like physical tokens
      const shuffled = [...colorGroups];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const reveals = [];
      for (let p = 1; p <= 2; p++) {
        const pick = shuffled[p - 1]; // each player gets a distinct token
        reveals.push({ player: p, color: pick.color, coords: pick.coords });
        for (const coord of pick.coords) {
          const c = normalizeCoord(coord);
          game[strainStateKey][c] = (game[strainStateKey][c] || 0) + 1;
        }
      }
      const lines = reveals.map((r) => `Player ${r.player} revealed **${r.color.toUpperCase()}** (+1 strain on ${r.coords.join(', ')})`);
      if (logGameAction && client) {
        await logGameAction(game, client, `**Powered Perimeter — token reveal:** ${lines.join(' | ')}`, { phase: 'ROUND', icon: 'round' });
      }
    }
  }

  // placeTokensOnCrates: each start-of-round, +1 power token on each crate matching its color.
  // Used by Devaron Garrison A.
  if (rules.placeTokensOnCrates && mapId && getMapTokensData) {
    const missionSide = variant === 'a' ? 'missionA' : 'missionB';
    const missionData = getMapTokensData()[mapId]?.[missionSide];
    const tokenTypes = missionData?.tokenTypes || [];
    const positions = missionData?.positions || {};
    const colorToPowerToken = { blue: 'Block', red: 'Damage', yellow: 'Surge' };
    game.crateTokens = game.crateTokens || {};
    const placed = [];
    for (const [id, coords] of Object.entries(positions)) {
      if (!Array.isArray(coords) || coords.length === 0) continue;
      const typeInfo = tokenTypes[parseInt(id)];
      const imageMatch = (typeInfo?.image || '').match(/(Blue|Red|Yellow)/i);
      const color = imageMatch ? imageMatch[1].toLowerCase() : null;
      const token = color ? (colorToPowerToken[color] || null) : null;
      if (!token) continue;
      for (const coord of coords) {
        const c = normalizeCoord(coord);
        game.crateTokens[c] = game.crateTokens[c] || [];
        game.crateTokens[c].push(token);
        placed.push(`${c} (${token})`);
      }
    }
    if (placed.length > 0 && logGameAction && client) {
      await logGameAction(game, client, `**Crate tokens placed:** ${placed.join(', ')}`, { phase: 'ROUND', icon: 'round' });
    }
  }
}

/**
 * Process end-of-round Krykna effects for Chopper Base A.
 * Lazy-inits game.npcKrykna from missionA token positions.
 * Emits damage events for all non-Krykna figures adjacent to any Krykna.
 * (The player-driven push phase is handled interactively via pendingKryknaPush — see round.js)
 * @returns { logs, damageEvents }
 */
export function runNpcKryknaActivation(game, mapId, ctx = {}) {
  const { getMapTokensData, getMapData, getMapRegistry, filterMapSpacesByBounds } = ctx;

  // Lazy-init from missionA token positions
  if (!game.npcKrykna) {
    const missionData = getMapTokensData?.()[mapId]?.missionA;
    const positions = Object.values(missionData?.positions || {}).flat().filter(Boolean);
    if (positions.length === 0) return { logs: [], damageEvents: [] };
    // alexanbv 2026-05-10: Krykna card text "can be targeted by attacks
    // and abilities that can target hostile figures" → hostileToAll: true.
    // The enumerateHostileFigures helper consults this flag.
    game.npcKrykna = positions.map((coord, i) => ({ id: `krykna-${i + 1}`, coord: normalizeCoord(coord), hp: 8, maxHp: 8, defeated: false, hostileToAll: true }));
  }

  const activeKrykna = game.npcKrykna.filter((k) => !k.defeated);
  if (activeKrykna.length === 0) return { logs: [`All Krykna defeated.`], damageEvents: [] };

  const rawMapSpaces = getMapData?.(mapId);
  if (!rawMapSpaces?.adjacency) return { logs: ['No adjacency data — Krykna damage skipped'], damageEvents: [] };
  const mapDef = getMapRegistry?.()?.find?.((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds?.(rawMapSpaces, mapDef?.gridBounds) || rawMapSpaces;
  const adjacency = mapSpaces.adjacency || {};

  const kryknaCoords = new Set(activeKrykna.map((k) => normalizeCoord(k.coord)));
  const logs = [];
  const damageEvents = [];

  // Read damage value from the mission rule's damageAdjacentToNpc payload
  // rather than hardcoding 2. Per data: chopper-base-atollon a's
  // damageAdjacentToNpc = { npcTag: "Krykna", damage: 2 }.
  const variant = ctx.variant || game.selectedMission?.variant || 'a';
  const adjacentDamageRule = getMissionFlag(mapId, variant, 'damageAdjacentToNpc');
  const adjDamage = (typeof adjacentDamageRule?.damage === 'number') ? adjacentDamageRule.damage : 2;

  for (const pn of [1, 2]) {
    for (const [figKey, figCoord] of Object.entries(game.figurePositions?.[pn] || {})) {
      const fc = normalizeCoord(figCoord);
      const adjToKrykna = (adjacency[fc] || []).some((n) => kryknaCoords.has(normalizeCoord(n)));
      if (adjToKrykna) damageEvents.push({ figureKey: figKey, playerNum: pn, damage: adjDamage });
    }
  }

  if (damageEvents.length > 0) {
    logs.push(`${damageEvents.length} hostile figure(s) adjacent to Krykna each suffer **${adjDamage} damage**.`);
  }

  // Flag whether any claimed Krykna need interactive placement (after damage resolves)
  const claimed1 = game.claimedKrykna?.[1] || 0;
  const claimed2 = game.claimedKrykna?.[2] || 0;
  const claimedPlacementNeeded = claimed1 > 0 || claimed2 > 0;

  return { logs, damageEvents, claimedPlacementNeeded };
}

/**
 * Get valid spaces for placing a claimed Krykna — opponent's deployment zone minus occupied spaces.
 * @param {object} game
 * @param {number} playerNum - the player placing (they place in the OPPONENT's zone)
 * @param {string} mapId
 * @returns {string[]} normalized coords that are valid for placement
 */
export function getValidKryknaPlacementSpaces(game, playerNum, mapId) {
  const zones = getDeploymentZones()[mapId];
  if (!zones) return [];

  // Player places in opponent's deployment zone
  const opponentZoneLabel = playerNum === 1 ? 'blue' : 'red';
  const zoneCoords = (zones[opponentZoneLabel] || []).map(c => normalizeCoord(c));

  // Collect all occupied spaces (both players' figures + active Krykna)
  const occupied = new Set();
  for (const pn of [1, 2]) {
    for (const coord of Object.values(game.figurePositions?.[pn] || {})) {
      occupied.add(normalizeCoord(coord));
    }
  }
  for (const k of (game.npcKrykna || [])) {
    if (!k.defeated) occupied.add(normalizeCoord(k.coord));
  }

  return zoneCoords.filter(c => !occupied.has(c));
}

/**
 * Advance all NPC thugs toward the nearest hostile figure, then emit damage events for adjacent hostiles.
 * Returns { logs, damageEvents } — damage is NOT applied here; round.js handles it.
 * Lazily initializes game.npcThugs from map-tokens if not already set.
 * @param {object} game
 * @param {string} mapId
 * @param {object} ctx - { getMapData, getMapRegistry, filterMapSpacesByBounds, getMapTokensData }
 */
export function runNpcThugActivation(game, mapId, ctx = {}) {
  const { getMapData, getMapRegistry, filterMapSpacesByBounds, getMapTokensData } = ctx;

  // Lazy-init: create npcThugs from missionA token positions if not yet set
  if (!game.npcThugs) {
    const missionData = getMapTokensData?.()[mapId]?.missionA;
    const positions = Object.values(missionData?.positions || {}).flat().filter(Boolean);
    if (positions.length === 0) return { logs: [], damageEvents: [] };
    // alexanbv 2026-05-10: Thugs "hostile to all figures except other
    // thugs" → hostileToAll: true (consumed by enumerateHostileFigures).
    game.npcThugs = positions.map((coord, i) => ({ id: `thug-${i + 1}`, coord: normalizeCoord(coord), hp: 4, maxHp: 4, defeated: false, hostileToAll: true }));
  }

  const activeThugs = game.npcThugs.filter((t) => !t.defeated);
  if (activeThugs.length === 0) return { logs: [], damageEvents: [] };

  const rawMapSpaces = getMapData?.(mapId);
  if (!rawMapSpaces?.adjacency) return { logs: ['No map adjacency — thug movement skipped'], damageEvents: [] };
  const mapDef = getMapRegistry?.()?.find?.((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds?.(rawMapSpaces, mapDef?.gridBounds) || rawMapSpaces;
  const adjacency = mapSpaces.adjacency || {};

  // Map coord → { figureKey, playerNum } for all hostile figures
  const hostileByCoord = new Map();
  for (const pn of [1, 2]) {
    for (const [figKey, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
      hostileByCoord.set(normalizeCoord(coord), { figureKey: figKey, playerNum: pn });
    }
  }
  const allHostileCoords = new Set(hostileByCoord.keys());

  const logs = [];

  for (const thug of activeThugs) {
    const startCoord = normalizeCoord(thug.coord);

    // BFS from thug to find nearest hostile
    const visited = new Map([[startCoord, null]]);
    const queue = [startCoord];
    let targetCoord = null;
    outer: while (queue.length > 0) {
      const curr = queue.shift();
      for (const neighbor of (adjacency[curr] || [])) {
        const n = normalizeCoord(neighbor);
        if (visited.has(n)) continue;
        visited.set(n, curr);
        if (allHostileCoords.has(n)) { targetCoord = n; break outer; }
        queue.push(n);
      }
    }
    if (!targetCoord) { logs.push(`Thug at ${thug.coord}: no hostile found, stays put.`); continue; }

    // Reconstruct path (list of spaces from start to target, not including start)
    const path = [];
    let cur = targetCoord;
    while (cur && cur !== startCoord) {
      const prev = visited.get(cur);
      if (prev !== undefined && prev !== null) path.unshift(cur);
      cur = visited.get(cur);
    }

    // Move up to 2 steps, stopping 1 space short of the hostile (to be adjacent)
    const maxSteps = Math.min(2, Math.max(0, path.length - 1));
    if (maxSteps > 0) {
      thug.coord = path[maxSteps - 1];
      logs.push(`Thug moved ${startCoord} → **${thug.coord}** (${maxSteps} step${maxSteps !== 1 ? 's' : ''} toward ${targetCoord}).`);
    } else {
      logs.push(`Thug at **${startCoord}**: already adjacent to hostile at ${targetCoord}.`);
    }
  }

  // Emit damage events: each hostile adjacent to any active thug takes 2 damage
  const thugCoords = new Set(game.npcThugs.filter((t) => !t.defeated).map((t) => normalizeCoord(t.coord)));
  const damageEvents = [];
  for (const pn of [1, 2]) {
    for (const [figKey, figCoord] of Object.entries(game.figurePositions?.[pn] || {})) {
      const fc = normalizeCoord(figCoord);
      const adjToThug = (adjacency[fc] || []).some((n) => thugCoords.has(normalizeCoord(n)));
      if (adjToThug) damageEvents.push({ figureKey: figKey, playerNum: pn, damage: 2 });
    }
  }

  return { logs, damageEvents };
}
