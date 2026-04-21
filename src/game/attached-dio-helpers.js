/**
 * Pure helpers for Iden Versio's **Attached** (Dio).
 *
 * Card text: "When Iden Versio exits Dio's space during movement, Dio
 *  may interrupt to move up to 1 space."
 *
 * Extracted from src/handlers/movement.js so the trigger/move logic is
 * testable without discord.js.
 */
import { getMapData } from '../data-loader.js';

/**
 * Detect whether Iden's move should trigger Attached.
 *
 * Returns null if no trigger fires; otherwise an object with the info
 * needed to render the Discord prompt:
 *
 *   { dioFigureKey, dioPos, adjacencies, defaultFollowSpace }
 *
 * @param {object} game - game state
 * @param {number} playerNum - Iden's (and Dio's) player number
 * @param {string} movingDcName - moving figure's DC name
 * @param {string|null} startCoord - coord the moving figure just left
 * @param {string} newTopLeft - coord the moving figure arrived at
 * @param {string[]|null} path - ordered path of the move (path[0] = start)
 */
export function detectAttachedTrigger(game, playerNum, movingDcName, startCoord, newTopLeft, path) {
  if (movingDcName !== 'Iden Versio') return null;
  if (!startCoord) return null;
  if (String(newTopLeft).toLowerCase() === String(startCoord).toLowerCase()) return null;

  const positions = game?.figurePositions?.[playerNum] || {};
  for (const [fk, pos] of Object.entries(positions)) {
    if (!pos) continue;
    if (!fk.startsWith('Dio-')) continue;
    if (String(pos).toLowerCase() !== String(startCoord).toLowerCase()) continue;

    const mapId = game?.selectedMap?.id;
    if (!mapId) continue;
    const adj = getMapData(mapId)?.adjacency?.[pos] || [];
    if (adj.length === 0) continue;
    const defaultFollowSpace = (path && path.length >= 2)
      ? String(path[1]).toLowerCase()
      : adj[0];
    return {
      dioFigureKey: fk,
      dioPos: pos,
      adjacencies: adj,
      defaultFollowSpace,
    };
  }
  return null;
}

/**
 * Apply Dio's follow-move. Mutates game.figurePositions in place.
 */
export function applyDioFollow(game, dioFigureKey, dioPlayerNum, space) {
  game.figurePositions = game.figurePositions || {};
  game.figurePositions[dioPlayerNum] = game.figurePositions[dioPlayerNum] || {};
  const from = game.figurePositions[dioPlayerNum][dioFigureKey] || null;
  game.figurePositions[dioPlayerNum][dioFigureKey] = space;
  return { from, to: space };
}
