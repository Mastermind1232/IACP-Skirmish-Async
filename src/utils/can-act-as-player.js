/**
 * Check if a user can perform actions as a given player.
 * In test games where P2 is the bot, P1 can act as both sides.
 * In test games with a real P2, each player acts only as themselves.
 * @param {object} game - Game state
 * @param {string} userId - Discord user ID
 * @param {number} playerNum - 1 or 2
 * @returns {boolean}
 */
export function canActAsPlayer(game, userId, playerNum) {
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (userId === ownerId) return true;
  if (game.isTestGame && game.testP2IsBot && userId === game.player1Id) return true;
  return false;
}
