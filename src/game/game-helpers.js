/**
 * Shared game-state mutation helpers.
 * Pure game logic — no Discord dependency.
 */
import { getMaxPowerTokens } from './dc-helpers.js';

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
 * Grant power tokens to a figure. Always adds the tokens, then checks whether
 * the figure exceeds its per-figure maximum (default from getMaxPowerTokens).
 * When overflow occurs, queues a `game.pendingPowerTokenOverflow` entry so the
 * Discord layer can prompt the player to discard down.
 *
 * @param {object} game
 * @param {string} figureKey
 * @param {string} tokenType - e.g. 'Block', 'Evade', 'Damage', 'Surge'
 * @param {number} count - tokens to grant
 * @param {number} [max] - optional maximum total tokens allowed (overrides per-figure default)
 * @returns {number} tokens actually added (always === count when count > 0)
 */
export function grantPowerTokens(game, figureKey, tokenType, count, max) {
  if (!figureKey || count <= 0) return 0;
  if (tokenType === 'Wild') { console.warn(`grantPowerTokens: Wild is a gain-time selector (CRR p.50), not a stored type — figureKey=${figureKey}`); return 0; }
  game.figurePowerTokens = game.figurePowerTokens || {};
  game.figurePowerTokens[figureKey] = game.figurePowerTokens[figureKey] || [];
  const cap = max != null ? max : getMaxPowerTokens(figureKey);
  // Always grant the tokens
  for (let i = 0; i < count; i++) game.figurePowerTokens[figureKey].push(tokenType);
  // Check for overflow
  const totalTokens = game.figurePowerTokens[figureKey].length;
  const overflow = totalTokens - cap;
  if (overflow > 0) {
    if (game.selfPlay && !game.testPvpOverflowPath) {
      // Auto-discard oldest tokens to stay at cap — AI keeps the newly granted ones
      game.figurePowerTokens[figureKey].splice(0, overflow);
    } else {
      // Queue or update overflow — Discord layer will prompt a discard choice
      game.pendingPowerTokenOverflow = game.pendingPowerTokenOverflow || [];
      const existing = game.pendingPowerTokenOverflow.find(e => e.figureKey === figureKey);
      if (existing) {
        // Update to reflect total overflow (tokens minus cap)
        existing.discardCount = overflow;
      } else {
        game.pendingPowerTokenOverflow.push({ figureKey, discardCount: overflow });
      }
    }
  }
  return count;
}

/**
 * Discard a specific power token from a figure to resolve overflow.
 * Removes the token at the given index and decrements the first matching
 * pendingPowerTokenOverflow entry. When an entry's discardCount reaches 0 it is
 * removed; when the array is empty the field is cleared.
 *
 * @param {object} game
 * @param {string} figureKey
 * @param {number} tokenIndex - index into game.figurePowerTokens[figureKey]
 * @returns {{ discarded: string|null, remaining: number }} the discarded token type and remaining overflow
 */
export function resolveOverflowDiscard(game, figureKey, tokenIndex) {
  const tokens = game.figurePowerTokens?.[figureKey];
  if (!tokens || tokenIndex < 0 || tokenIndex >= tokens.length) return { discarded: null, remaining: 0 };
  const [discarded] = tokens.splice(tokenIndex, 1);
  // Decrement the overflow counter
  const overflowArr = game.pendingPowerTokenOverflow || [];
  const entry = overflowArr.find(e => e.figureKey === figureKey && e.discardCount > 0);
  if (entry) {
    entry.discardCount--;
    if (entry.discardCount <= 0) {
      const idx = overflowArr.indexOf(entry);
      overflowArr.splice(idx, 1);
    }
  }
  if (overflowArr.length === 0) game.pendingPowerTokenOverflow = null;
  const remaining = overflowArr.filter(e => e.figureKey === figureKey).reduce((s, e) => s + e.discardCount, 0);
  return { discarded, remaining };
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
