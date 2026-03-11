/**
 * Pure VP mutation helpers. No Discord dependency.
 */

/**
 * Ensure the VP object exists for the given player number.
 * @param {object} game
 * @param {number} playerNum - 1 or 2
 * @returns {{ total: number, kills: number, objectives: number }}
 */
function ensureVp(game, playerNum) {
  const key = playerNum === 1 ? 'player1VP' : 'player2VP';
  game[key] = game[key] || { total: 0, kills: 0, objectives: 0 };
  return game[key];
}

/**
 * Award VP for a kill (figure defeated). Increments kills + total.
 * @param {object} game
 * @param {number} playerNum - player who earns the VP
 * @param {number} amount - VP to award (positive)
 */
export function awardKillVp(game, playerNum, amount) {
  const vp = ensureVp(game, playerNum);
  vp.kills += amount;
  vp.total += amount;
}

/**
 * Award VP for an objective (mission reward, surge ability, etc.). Increments objectives + total.
 * @param {object} game
 * @param {number} playerNum - player who earns the VP
 * @param {number} amount - VP to award (positive)
 */
export function awardObjectiveVp(game, playerNum, amount) {
  const vp = ensureVp(game, playerNum);
  vp.objectives += amount;
  vp.total += amount;
}

/**
 * Nefarious Gains (Jabba the Hutt): when any hostile figure is defeated,
 * check if Jabba is alive on the opposing team and award 1 objective VP.
 * Pure data mutation — no Discord dependency.
 * @param {object} game
 * @param {number} defeatedOwnerPN - playerNum who owned the defeated figure
 * @returns {{ jabbaOwnerPN: number, vpTotal: number } | null} - info for logging, or null if Jabba not found
 */
export function checkNefariousGains(game, defeatedOwnerPN) {
  const jabbaOwnerPN = defeatedOwnerPN === 1 ? 2 : 1;
  const jabbaAlive = Object.keys(game.figurePositions?.[jabbaOwnerPN] || {}).some(fk => fk.startsWith('Jabba the Hutt-'));
  if (!jabbaAlive) return null;
  awardObjectiveVp(game, jabbaOwnerPN, 1);
  const vpKey = jabbaOwnerPN === 1 ? 'player1VP' : 'player2VP';
  return { jabbaOwnerPN, vpTotal: game[vpKey]?.total ?? 0 };
}

/**
 * Deduct VP (clamped to 0). Deducts from objectives first, then kills.
 * @param {object} game
 * @param {number} playerNum
 * @param {number} amount - VP to deduct (positive)
 */
export function deductVp(game, playerNum, amount) {
  const vp = ensureVp(game, playerNum);
  let remaining = amount;
  // Deduct from objectives first
  const objDeduct = Math.min(vp.objectives || 0, remaining);
  vp.objectives = (vp.objectives || 0) - objDeduct;
  remaining -= objDeduct;
  // Then from kills
  if (remaining > 0) {
    vp.kills = Math.max(0, (vp.kills || 0) - remaining);
  }
  vp.total = Math.max(0, vp.total - amount);
}
