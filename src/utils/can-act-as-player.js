/**
 * Check if a user can perform actions as a given player.
 * In test games (human vs bot), the human (player1Id) can act as both P1 and P2.
 * @param {object} game - Game state
 * @param {string} userId - Discord user ID
 * @param {number} playerNum - 1 or 2
 * @returns {boolean}
 */
export function canActAsPlayer(game, userId, playerNum) {
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (userId === ownerId) return true;
  if (game.isTestGame && userId === game.player1Id) return true;
  return false;
}
