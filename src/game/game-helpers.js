/**
 * Shared game-state mutation helpers.
 * Pure game logic — no Discord dependency.
 */

/**
 * Grant movement points to a figure's movement bank.
 * Initializes the bank and entry if needed.
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number} amount - MP to grant
 */
export function grantMovementBank(game, msgId, amount) {
  if (!msgId || !amount) return;
  game.movementBank = game.movementBank || {};
  game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
  game.movementBank[msgId].total = (game.movementBank[msgId].total || 0) + amount;
  game.movementBank[msgId].remaining = (game.movementBank[msgId].remaining || 0) + amount;
}

/**
 * Grant power tokens to a figure, respecting an optional cap.
 * @param {object} game
 * @param {string} figureKey
 * @param {string} tokenType - e.g. 'Block', 'Evade', 'Hit', 'Surge'
 * @param {number} count - tokens to grant
 * @param {number} [max] - optional maximum total tokens allowed
 * @returns {number} tokens actually granted
 */
export function grantPowerTokens(game, figureKey, tokenType, count, max) {
  if (!figureKey || count <= 0) return 0;
  game.figurePowerTokens = game.figurePowerTokens || {};
  game.figurePowerTokens[figureKey] = game.figurePowerTokens[figureKey] || [];
  const current = game.figurePowerTokens[figureKey].length;
  const actual = max != null ? Math.min(count, Math.max(0, max - current)) : count;
  for (let i = 0; i < actual; i++) game.figurePowerTokens[figureKey].push(tokenType);
  return actual;
}

/**
 * Resolve deployment zones for each player based on initiative and chosen zone.
 * @param {object} game
 * @param {number} initiativePlayerNum
 * @returns {{ p1Zone: string, p2Zone: string }}
 */
export function getPlayerDeploymentZones(game, initiativePlayerNum) {
  const chosen = game.deploymentZoneChosen;
  const other = chosen === 'red' ? 'blue' : 'red';
  const p1Zone = initiativePlayerNum === 1 ? chosen : other;
  const p2Zone = p1Zone === 'red' ? 'blue' : 'red';
  return { p1Zone, p2Zone };
}
