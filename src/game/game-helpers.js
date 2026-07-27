/**
 * Shared game-state mutation helpers.
 * Pure game logic — no Discord dependency.
 */
import { getMaxPowerTokens } from './dc-helpers.js';

/**
 * Marks the activation minimap stale so the next updateDcActionsMessage
 * re-renders the PNG. Per alexanbv 2026-05-12: the minimap is the
 * dominant per-click cost; skip the render on clicks that don't move a
 * figure or apply damage. Call this from movement settle, damage
 * application, defeat removal, door opens, and token-placement helpers.
 *
 * The minimap is keyed per DC msgId via data._minimapRenderedVersion in
 * dcActionsData. updateDcActionsMessage compares each msgId's last
 * version against game._mapStateVersion and only re-renders when they
 * diverge; otherwise the edit payload omits files/attachments so the
 * existing image stays attached on Discord's side.
 */
export function markMapDirty(game) {
  if (!game) return;
  game._mapStateVersion = (game._mapStateVersion || 0) + 1;
}

/**
 * Get the active per-figure MP bank for `msgId`. If figureIndex is
 * passed AND a per-figure entry exists, returns that figure's bank;
 * otherwise returns the top-level bank entry (single-figure path).
 *
 * Per alexanbv 2026-06-13: MP is STRICTLY per-figure — there is no
 * shared/top-level group bank. Each figure's MP lives in
 * `movementBank[msgId].perFig[figureIndex]`; the top-level entry holds
 * only UI metadata (threadId, messageId, displayName). figureIndex
 * defaults to 0 (the sole figure of a single-figure DC).
 *
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number|null} [figureIndex] - figure index (defaults to 0)
 * @returns {object|null} the figure's bank { total, remaining } or null
 */
export function getMovementBankForFigure(game, msgId, figureIndex) {
  const top = game.movementBank?.[msgId];
  if (!top) return null;
  const idx = figureIndex ?? 0;
  return top.perFig?.[idx] || null;
}

/**
 * Get (creating if needed) a figure's per-figure MP sub-bank. The
 * top-level movementBank[msgId] holds only UI metadata. Internal.
 */
function _ensureFigureBank(game, msgId, figureIndex) {
  game.movementBank = game.movementBank || {};
  const top = game.movementBank[msgId] || {};
  top.perFig = top.perFig || {};
  const idx = figureIndex ?? 0;
  top.perFig[idx] = top.perFig[idx] || { total: 0, remaining: 0 };
  game.movementBank[msgId] = top;
  return top.perFig[idx];
}

/** Remaining MP for a specific figure (defaults to figure 0). */
export function figureMpRemaining(game, msgId, figureIndex) {
  return game.movementBank?.[msgId]?.perFig?.[figureIndex ?? 0]?.remaining ?? 0;
}

/**
 * Set a figure's remaining MP outright (and optionally bump its total).
 * Used by the Move-action settle path which recomputes remaining after
 * each step. Per alexanbv 2026-06-13.
 */
export function setFigureMp(game, msgId, figureIndex, remaining, addTotal) {
  const fig = _ensureFigureBank(game, msgId, figureIndex);
  fig.remaining = Math.max(0, remaining);
  if (addTotal) fig.total = (fig.total || 0) + addTotal;
  return fig;
}

/**
 * Grant movement points to a SPECIFIC figure's bank (figureIndex
 * defaults to 0). There is no shared group bank — MP never spreads to
 * sibling figures. Per alexanbv 2026-06-13.
 *
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number} amount - MP to grant
 * @param {number} [figureIndex] - figure index (defaults to 0)
 */
export function grantMovementBank(game, msgId, amount, figureIndex) {
  if (!msgId || !amount) return;
  const fig = _ensureFigureBank(game, msgId, figureIndex);
  fig.total = (fig.total || 0) + amount;
  fig.remaining = (fig.remaining || 0) + amount;
}

/**
 * Grant immediate-spend MP that must be used at once (cannot bank).
 * Used by special-action MP grants outside of abilities.js (e.g. Hit and Run
 * in combat-bridge). Mirrors the forceImmediate path in addMovementPoints:
 * saves any pre-existing banked MP into _savedBankedMp so it survives the
 * "Done spending" click, then tags the entry _mustSpendImmediately.
 *
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number} n - MP to grant
 * @param {number} [figureIndex] - figure index (defaults to 0)
 */
export function grantImmediateMp(game, msgId, n, figureIndex) {
  if (!msgId || !n) return;
  const fig = _ensureFigureBank(game, msgId, figureIndex ?? 0);
  fig.total = (fig.total ?? 0) + n;
  fig.remaining = (fig.remaining ?? 0) + n;
  if (!fig._mustSpendImmediately) {
    const bankedBefore = fig.remaining - n;
    if (bankedBefore > 0) {
      fig._savedBankedMp = (fig._savedBankedMp ?? 0) + bankedBefore;
      fig.remaining = n;
    }
  }
  fig._mustSpendImmediately = true;
}

/**
 * Spend MP from a SPECIFIC figure's bank (figureIndex defaults to 0).
 * Clamps at 0. No-op if the figure has no bank entry. Per alexanbv
 * 2026-06-13.
 *
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number} amount - MP to consume (positive)
 * @param {number} [figureIndex] - figure index (defaults to 0)
 * @returns {number} - MP actually consumed (clamped at available remaining)
 */
export function consumeMovementPoints(game, msgId, amount, figureIndex) {
  if (!msgId || !amount || amount <= 0) return 0;
  const fig = game.movementBank?.[msgId]?.perFig?.[figureIndex ?? 0];
  if (!fig) return 0;
  const have = fig.remaining || 0;
  const spent = Math.min(have, amount);
  fig.remaining = have - spent;
  return spent;
}

/**
 * Discard a figure's per-figure MP flagged "must spend immediately".
 *
 * Per alexanbv 2026-06-12/13: MP gained outside a figure's own activation
 * (Order Hit and similar grants) OR as part of a special action (Urgency)
 * must be spent at once. While the window is open the MP lives in the
 * figure's per-figure sub-bank (movementBank[msgId].perFig[figureIndex])
 * so it can feed both the "Spend Remaining MP" movement button and the
 * MP-cost ability buttons (Wrist Cord, Super Commando rockets). This
 * helper closes the window: it drops the figure's sub-bank when it carries
 * the _mustSpendImmediately flag, so leftover MP never carries forward and
 * never spreads to a sibling figure.
 *
 * Pass figureIndex (defaults to 0) to clear that figure's immediate MP;
 * pass figureIndex === 'all' to sweep every flagged figure of the DC
 * (used by the after-attack backstop, which doesn't track the index).
 *
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number|'all'} [figureIndex] - figure to clear (defaults to 0)
 * @returns {number} MP discarded (0 if nothing was flagged/cleared)
 */
export function expireImmediateMp(game, msgId, figureIndex) {
  const entry = game.movementBank?.[msgId];
  if (!entry?.perFig) return 0;

  let lost = 0;
  const clearFig = (idx) => {
    const fig = entry.perFig[idx];
    if (!fig || !fig._mustSpendImmediately) return;
    lost += fig.remaining || 0;
    const savedBank = fig._savedBankedMp ?? 0;
    if (savedBank > 0) {
      // Restore banked MP (e.g. Heart of Freedom) that was set aside when the
      // urgency window opened; only the urgency remainder is lost.
      fig.remaining = savedBank;
      delete fig._savedBankedMp;
      delete fig._mustSpendImmediately;
      delete fig._outOfActivation;
    } else {
      delete entry.perFig[idx];
    }
  };

  if (figureIndex === 'all') {
    for (const idx of Object.keys(entry.perFig)) clearFig(idx);
  } else {
    clearFig(figureIndex ?? 0);
  }

  if (Object.keys(entry.perFig).length === 0) {
    delete entry.perFig;
    // Drop the whole entry if nothing but (now-gone) perFig remained.
    if (!entry.threadId && !entry.messageId && !entry.displayName) {
      delete game.movementBank[msgId];
    }
  }
  if (game.movementBank && Object.keys(game.movementBank).length === 0) delete game.movementBank;
  return lost;
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
