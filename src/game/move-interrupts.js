/**
 * Per-step interrupt-opportunity scanner for "move N spaces" abilities.
 *
 * Given a movement path (a sequence of cells the mover walks), produce the
 * list of opportunities where an opponent could play a reaction CC
 * (Parting Blow, Dirty Trick, Self-Defense). The caller is responsible for
 * actually prompting the opponent + handling their response — this helper
 * is pure: it just enumerates the trigger windows.
 *
 * Trigger conditions (destruct 2026-05-06 spec):
 *
 *   - Parting Blow (PB):
 *       trigger: mover EXITS a cell that is adjacent to an opponent
 *                figure with the BRAWLER keyword.
 *       window: post-exit, before mover enters the next cell.
 *
 *   - Dirty Trick (DT):
 *       trigger: mover ENTERS a cell that is adjacent to an opponent
 *                figure with the SMUGGLER or HUNTER keyword.
 *       window: post-entry.
 *
 *   - Self-Defense (SD):
 *       trigger: mover ENTERS a cell that is adjacent to ANY opponent
 *                figure.
 *       window: post-entry.
 *       opt-out: each player can declare at game start that SD is not in
 *                their deck — set opts.selfDefenseInDeck[playerNum]=false
 *                to skip SD opportunities for that player's figures.
 *
 *   - skipInterrupts (per-ability opt-out): when set, no opportunities are
 *     returned. Used by abilities where opponent reactions can't matter
 *     (e.g. IG-11 Self-Destruct Protocol — IG-11 is already defeated, so
 *     the player has no incentive to interrupt the move).
 *
 * Opportunity shape:
 *   {
 *     step:               integer index in the path (0 = first transition)
 *     type:               'PB' | 'DT' | 'SD'
 *     triggerFigureKey:   the OPPONENT figure that may play the reaction
 *     triggerPlayerNum:   the OPPONENT player num
 *     triggerCell:        cell that produced the trigger (exited for PB,
 *                         entered for DT/SD)
 *   }
 *
 * Order within a step: PB first (post-exit), then DT, then SD (both
 * post-entry). Multiple opponent figures may produce multiple opportunities
 * for the same step + type.
 */

import { getFiguresAdjacentToCoord } from './movement.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { getDcKeywords } from '../data-loader.js';

export const PB_TYPE = 'PB';
export const DT_TYPE = 'DT';
export const SD_TYPE = 'SD';

function _figureKeywords(game, figureKey) {
  const dcName = dcNameFromFigureKey(figureKey);
  const kws = (getDcKeywords(game)?.[dcName] || []).map((k) => String(k).toUpperCase());
  return new Set(kws);
}

/**
 * @param {object} game
 * @param {string} mapId
 * @param {object} mover - { figureKey, playerNum }
 * @param {string[]} path - cell coords in order [start, c1, c2, ..., dest].
 *   Length 1 means the mover didn't actually move (no opportunities).
 * @param {object} [opts]
 * @param {boolean} [opts.skipInterrupts=false] - skip all (e.g. IG-11 SDP).
 * @param {object} [opts.selfDefenseInDeck] - { 1: bool, 2: bool }; when
 *   false for a given playerNum, SD opportunities for that player's
 *   figures are skipped.
 * @returns {Array} list of opportunities in step+type order.
 */
export function extractMoveInterruptOpportunities(game, mapId, mover, path, opts = {}) {
  if (opts.skipInterrupts) return [];
  if (!Array.isArray(path) || path.length < 2) return [];
  if (!mover?.figureKey || !mover.playerNum) return [];
  if (!game || !mapId) return [];

  const sdInDeck = opts.selfDefenseInDeck || { 1: true, 2: true };
  const mvPN = mover.playerNum;
  const oppPN = mvPN === 1 ? 2 : 1;
  const out = [];

  for (let step = 0; step < path.length - 1; step++) {
    const fromCell = path[step];
    const toCell = path[step + 1];

    // PB: opponent BRAWLERs adjacent to fromCell (exit-adjacent trigger).
    // Exclude the mover itself from adjacency (it's the figure walking).
    const exitAdj = getFiguresAdjacentToCoord(game, fromCell, mapId, mover.figureKey);
    for (const fig of exitAdj) {
      if (fig.playerNum !== oppPN) continue;
      const kws = _figureKeywords(game, fig.figureKey);
      if (!kws.has('BRAWLER')) continue;
      out.push({
        step,
        type: PB_TYPE,
        triggerFigureKey: fig.figureKey,
        triggerPlayerNum: fig.playerNum,
        triggerCell: fromCell,
      });
    }

    // DT + SD: opponent figures adjacent to toCell (entry-adjacent triggers).
    const entryAdj = getFiguresAdjacentToCoord(game, toCell, mapId, mover.figureKey);
    for (const fig of entryAdj) {
      if (fig.playerNum !== oppPN) continue;
      const kws = _figureKeywords(game, fig.figureKey);
      // Dirty Trick: SMUGGLER or HUNTER.
      if (kws.has('SMUGGLER') || kws.has('HUNTER')) {
        out.push({
          step,
          type: DT_TYPE,
          triggerFigureKey: fig.figureKey,
          triggerPlayerNum: fig.playerNum,
          triggerCell: toCell,
        });
      }
      // Self-Defense: any opponent figure (gated on per-player opt-out).
      // The opt-out sits on the OPPONENT (defender of the SD play) since
      // it's their CC deck. mvPN is moving, oppPN may have SD in deck.
      if (sdInDeck[oppPN] !== false) {
        out.push({
          step,
          type: SD_TYPE,
          triggerFigureKey: fig.figureKey,
          triggerPlayerNum: fig.playerNum,
          triggerCell: toCell,
        });
      }
    }
  }

  return out;
}
