/**
 * Look up a game by channel ID.
 * Scans the games map for a game whose channels include the given channelId.
 */

/**
 * Find a game whose game-log, board, chat, hand, or play-area channel matches.
 * @param {Map} gamesMap - from getGamesMap()
 * @param {string} channelId
 * @returns {{ gameId: string, game: object, isP1: boolean, isP2: boolean } | null}
 */
export function findGameByChannel(gamesMap, channelId) {
  if (!channelId) return null;
  for (const [gameId, g] of gamesMap) {
    const isP1Hand = g.p1HandId === channelId;
    const isP2Hand = g.p2HandId === channelId;
    const isP1PlayArea = g.p1PlayAreaId === channelId;
    const isP2PlayArea = g.p2PlayAreaId === channelId;
    if (g.generalId === channelId || g.chatId === channelId || g.boardId === channelId ||
        isP1Hand || isP2Hand || isP1PlayArea || isP2PlayArea) {
      return {
        gameId,
        game: g,
        isP1: isP1Hand || isP1PlayArea,
        isP2: isP2Hand || isP2PlayArea,
      };
    }
  }
  return null;
}

/**
 * Find a game by common channels (generalId, boardId, chatId only — no hand/play-area).
 * @param {Map} gamesMap
 * @param {string} channelId
 * @returns {object|null} the game object, or null
 */
export function findGameByCommonChannel(gamesMap, channelId) {
  if (!channelId) return null;
  for (const [, g] of gamesMap) {
    if (g.generalId === channelId || g.boardId === channelId || g.chatId === channelId) {
      return g;
    }
  }
  return null;
}
