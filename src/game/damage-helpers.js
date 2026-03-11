/**
 * Pure HP math helpers + dcHealthState/dcList sync.
 * No Discord dependency. Used by combat, abilities, handlers.
 */
import { getDcMessageIds, getDcList } from './player-helpers.js';

/**
 * Sync healthState from dcHealthState Map to the redundant copy in game.p1/p2DcList.
 * @param {object} game
 * @param {string} msgId
 * @param {number} playerNum - 1 or 2
 * @param {Array} healthState - the full healthState array for this DC
 */
function syncDcList(game, msgId, playerNum, healthState) {
  const dcIds = getDcMessageIds(game, playerNum);
  const dcList = getDcList(game, playerNum);
  const idx = (dcIds || []).indexOf(msgId);
  if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
}

/**
 * Reduce HP for a figure. Clamps to 0. Syncs dcHealthState + dcList.
 * @param {Map} dcHealthState - external health state Map
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number} figureIndex - 0-based figure index within healthState
 * @param {number} damage - amount to reduce (non-negative)
 * @param {number} playerNum - 1 or 2
 * @returns {{ newHp: number, maxHp: number, prevHp: number, wasDefeated: boolean }}
 */
export function reduceHp(dcHealthState, game, msgId, figureIndex, damage, playerNum) {
  const healthState = dcHealthState.get(msgId);
  if (!healthState || !Array.isArray(healthState[figureIndex])) {
    return { newHp: 0, maxHp: 0, prevHp: 0, wasDefeated: false };
  }
  const [cur, max] = healthState[figureIndex];
  const prevHp = cur ?? max ?? 0;
  const maxHp = max ?? cur ?? 0;
  const newHp = Math.max(0, prevHp - damage);
  healthState[figureIndex] = [newHp, maxHp];
  dcHealthState.set(msgId, healthState);
  syncDcList(game, msgId, playerNum, healthState);

  // Track actual damage received for tiebreaker scoring
  const actualDamage = prevHp - newHp;
  if (actualDamage > 0 && game.totalDamageReceived) {
    game.totalDamageReceived[playerNum] = (game.totalDamageReceived[playerNum] || 0) + actualDamage;
  }

  return { newHp, maxHp, prevHp, wasDefeated: newHp <= 0 };
}

/**
 * Heal HP for a figure. Clamps to max. Syncs dcHealthState + dcList.
 * @param {Map} dcHealthState - external health state Map
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number} figureIndex - 0-based figure index within healthState
 * @param {number} amount - amount to heal (non-negative)
 * @param {number} playerNum - 1 or 2
 * @returns {{ newHp: number, maxHp: number, healed: number }}
 */
export function healHp(dcHealthState, game, msgId, figureIndex, amount, playerNum) {
  const healthState = dcHealthState.get(msgId);
  if (!healthState || !Array.isArray(healthState[figureIndex])) {
    return { newHp: 0, maxHp: 0, healed: 0 };
  }
  const [cur, max] = healthState[figureIndex];
  const prevHp = cur ?? max ?? 0;
  const maxHp = max ?? cur ?? 0;
  const newHp = Math.min(prevHp + amount, maxHp);
  const healed = newHp - prevHp;
  healthState[figureIndex] = [newHp, maxHp];
  dcHealthState.set(msgId, healthState);
  syncDcList(game, msgId, playerNum, healthState);
  return { newHp, maxHp, healed };
}

/**
 * Heal HP across all figures in a DC, distributing up to totalAmount.
 * Heals figures in order (index 0 first). Syncs dcHealthState + dcList.
 * @param {Map} dcHealthState
 * @param {object} game
 * @param {string} msgId
 * @param {number} totalAmount - total HP to distribute
 * @param {number} playerNum
 * @returns {{ totalRecovered: number, perFigure: Array<{index: number, healed: number, newHp: number}> }}
 */
export function healHpDistributed(dcHealthState, game, msgId, totalAmount, playerNum) {
  const healthState = dcHealthState.get(msgId);
  if (!healthState) return { totalRecovered: 0, perFigure: [] };
  let remaining = totalAmount;
  const perFigure = [];
  for (let i = 0; i < healthState.length; i++) {
    if (remaining <= 0) break;
    if (!Array.isArray(healthState[i])) continue;
    const [cur, max] = healthState[i];
    const prevHp = cur ?? max ?? 0;
    const maxHp = max ?? cur ?? 0;
    const damage = maxHp - prevHp;
    if (damage <= 0) continue;
    const heal = Math.min(remaining, damage);
    healthState[i] = [prevHp + heal, maxHp];
    remaining -= heal;
    perFigure.push({ index: i, healed: heal, newHp: prevHp + heal });
  }
  if (perFigure.length > 0) {
    dcHealthState.set(msgId, healthState);
    syncDcList(game, msgId, playerNum, healthState);
  }
  return { totalRecovered: totalAmount - remaining, perFigure };
}
