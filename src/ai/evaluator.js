/**
 * Game state evaluation for AI decision-making.
 * Scores a game state from a specific player's perspective.
 */

import { getPlayerId, opponentPlayerNum } from '../game/player-helpers.js';

/**
 * Evaluate the game state from a player's perspective.
 * Higher score = better for that player.
 *
 * @param {object} game - The game state
 * @param {number} playerNum - 1 or 2
 * @returns {number} Score (higher = better)
 */
export function evaluateState(game, playerNum) {
  if (!game) return 0;

  let score = 0;
  const oppPN = opponentPlayerNum(playerNum);

  // VP differential (heavily weighted)
  score += vpScore(game, playerNum);

  // Material advantage (HP remaining)
  score += materialScore(game, playerNum);

  // Positional advantage (figures on map)
  score += positionScore(game, playerNum);

  // Game-ending bonus
  if (game.ended) {
    if (game.winnerId === getPlayerId(game, playerNum)) return 10000;
    if (game.winnerId === getPlayerId(game, oppPN)) return -10000;
    return 0; // Draw
  }

  return score;
}

/**
 * VP differential score. 10 points per VP advantage.
 */
function vpScore(game, playerNum) {
  const myVP = getVpTotal(game, playerNum);
  const oppVP = getVpTotal(game, opponentPlayerNum(playerNum));
  return (myVP - oppVP) * 10;
}

/**
 * Material score: total remaining HP across all figures.
 */
function materialScore(game, playerNum) {
  const oppPN = opponentPlayerNum(playerNum);
  const myHP = getTotalHP(game, playerNum);
  const oppHP = getTotalHP(game, oppPN);
  return (myHP - oppHP) * 2;
}

/**
 * Position score: number of figures on the map.
 */
function positionScore(game, playerNum) {
  const oppPN = opponentPlayerNum(playerNum);
  const myFigures = Object.keys(game.figurePositions?.[playerNum] || {}).length;
  const oppFigures = Object.keys(game.figurePositions?.[oppPN] || {}).length;
  return (myFigures - oppFigures) * 3;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getVpTotal(game, playerNum) {
  const vpKey = playerNum === 1 ? 'player1VP' : 'player2VP';
  return game[vpKey]?.total ?? 0;
}

function getTotalHP(game, playerNum) {
  const positions = game.figurePositions?.[playerNum] || {};
  // Without dcHealthState, approximate from the number of living figures
  // Each figure is worth ~5 HP on average
  return Object.keys(positions).length * 5;
}
