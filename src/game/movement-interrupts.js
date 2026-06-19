/**
 * Post-move interrupt detection for Command Cards that trigger during movement:
 *   C23 — Parting Blow (BRAWLER): when hostile exits adjacent space
 *   C15 — Dirty Trick (SMUGGLER or HUNTER): when hostile enters adjacent space
 *   C43 — Disengage (Mak Eshka'rey): when hostile enters space within 3 spaces
 *
 * These functions walk the reconstructed movement path and check for interrupt
 * opportunities, then return structured trigger data for the handler to post
 * notifications/buttons.
 */
import { normalizeCoord, getFootprintCells, edgeKey } from './coords.js';
import { getMapData, getMapTokensData, getDcEffects } from '../data-loader.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { getCcHand, getPlayerId, opponentPlayerNum, getDcMessageIds, getDcList } from './player-helpers.js';
import { countSpaces } from './spatial.js';
import { cardNameIncludes } from './card-names.js';

/**
 * Check whether a DC name has any of the given trait keywords (case-insensitive).
 * @param {string} dcName
 * @param {string[]} traits - e.g. ['BRAWLER']
 * @returns {boolean}
 */
function dcHasTrait(dcName, traits) {
  const effects = getDcEffects();
  const entry = effects?.[dcName];
  if (!entry) return false;
  const kws = (entry.keywords || []).map(k => String(k).toUpperCase());
  return traits.some(t => kws.includes(t.toUpperCase()));
}

/**
 * Check whether a player has a specific CC name in hand.
 * @param {object} game
 * @param {number} playerNum
 * @param {string} cardName - exact card name, e.g. 'Parting Blow'
 * @returns {boolean}
 */
function hasCardInHand(game, playerNum, cardName) {
  const hand = getCcHand(game, playerNum) || [];
  return hand.some(c => c === cardName);
}

/**
 * Walk the movement path and detect interrupt opportunities for C23, C15, C43.
 *
 * @param {object} game - game state
 * @param {number} movingPlayerNum - player who moved
 * @param {string} movingFigureKey - figure key that moved
 * @param {string[]} path - array of coordinate strings (from getMovementPath)
 * @returns {Array<{type: string, cardName: string, candidatePlayerNum: number, candidateFigureKey: string, candidateDcName: string, triggerSpace: string, description: string}>}
 */
export function detectPostMoveInterrupts(game, movingPlayerNum, movingFigureKey, path) {
  if (!path || path.length < 2) return [];

  const mapId = game.selectedMap?.id;
  const rawMapSpaces = mapId ? getMapData(mapId) : null;
  const adjacency = rawMapSpaces?.adjacency || {};
  const _miAllDoors = (mapId && getMapTokensData) ? (getMapTokensData()[mapId]?.doors || []) : [];
  const _miOpenedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
  const _miClosedDoorEdges = new Set(
    _miAllDoors
      .filter(e => { const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase(); return !_miOpenedSet.has(`${a}|${b}`) && !_miOpenedSet.has(`${b}|${a}`); })
      .map(e => edgeKey(e[0], e[1]))
  );
  const oppNum = opponentPlayerNum(movingPlayerNum);
  const hostilePositions = game.figurePositions?.[oppNum] || {};
  const triggers = [];
  let partingBlowTriggered = false;

  // Pre-compute hostile figure info
  const hostileFigures = [];
  for (const [hfk, hPos] of Object.entries(hostilePositions)) {
    if (!hPos) continue;
    const hDcName = dcNameFromFigureKey(hfk);
    const hSize = game.figureOrientations?.[hfk] || '1x1';
    const hCells = getFootprintCells(hPos, hSize).map(c => normalizeCoord(c));
    hostileFigures.push({ figureKey: hfk, dcName: hDcName, cells: hCells, pos: hPos });
  }

  for (let i = 0; i < path.length - 1; i++) {
    const exitingSpace = normalizeCoord(path[i]);
    const enteringSpace = normalizeCoord(path[i + 1]);
    const exitAdj = new Set((adjacency[exitingSpace] || []).map(n => normalizeCoord(n)));
    const enterAdj = new Set((adjacency[enteringSpace] || []).map(n => normalizeCoord(n)));

    for (const hf of hostileFigures) {
      // --- C23: Parting Blow (BRAWLER, once per move) ---
      // alexanbv 2026-06-19: "exiting ANY adjacent space counts" — the trigger
      // is exiting a space adjacent to the Brawler, even if the mover is STILL
      // adjacent after the step (matches the cell-by-cell extractMoveInterrupt-
      // Opportunities path). Previously required fully leaving adjacency.
      if (!partingBlowTriggered) {
        const wasAdjacent = hf.cells.some(c => exitAdj.has(c) || c === exitingSpace);
        if (wasAdjacent) {
          if (dcHasTrait(hf.dcName, ['BRAWLER']) && hasCardInHand(game, oppNum, 'Parting Blow')) {
            partingBlowTriggered = true;
            const displayName = hf.dcName.replace(/_/g, ' ');
            triggers.push({
              type: 'partingBlow',
              cardName: 'Parting Blow',
              candidatePlayerNum: oppNum,
              candidateFigureKey: hf.figureKey,
              candidateDcName: hf.dcName,
              triggerSpace: exitingSpace,
              description: `**${displayName}** (Brawler) — hostile exited adjacent space **${exitingSpace.toUpperCase()}**. Parting Blow opportunity.`,
            });
          }
        }
      }

      // --- C15: Dirty Trick (SMUGGLER or HUNTER, entering adjacent) ---
      {
        const nowAdjacent = hf.cells.some(c => enterAdj.has(c) || c === enteringSpace);
        // alexanbv 2026-06-19: entering ANY adjacent space counts (reading (a)),
        // even if the mover was already adjacent before the step — matches the
        // cell-by-cell extractMoveInterruptOpportunities path.
        if (nowAdjacent) {
          if (dcHasTrait(hf.dcName, ['SMUGGLER', 'HUNTER']) && hasCardInHand(game, oppNum, 'Dirty Trick')) {
            const displayName = hf.dcName.replace(/_/g, ' ');
            // Avoid duplicate triggers for the same figure in the same move
            const alreadyTriggered = triggers.some(t => t.type === 'dirtyTrick' && t.candidateFigureKey === hf.figureKey);
            if (!alreadyTriggered) {
              triggers.push({
                type: 'dirtyTrick',
                cardName: 'Dirty Trick',
                candidatePlayerNum: oppNum,
                candidateFigureKey: hf.figureKey,
                candidateDcName: hf.dcName,
                triggerSpace: enteringSpace,
                description: `**${displayName}** (Smuggler/Hunter) — hostile entered adjacent space **${enteringSpace.toUpperCase()}**. Dirty Trick opportunity.`,
              });
            }
          }
        }
      }

      // --- C43: Disengage (Mak Eshka'rey, entering within 3 spaces) ---
      {
        // Only check for Mak specifically
        if (hf.dcName === "Mak Eshka'rey") {
          const distAfter = countSpaces(rawMapSpaces, enteringSpace, hf.pos, _miClosedDoorEdges);
          const distBefore = countSpaces(rawMapSpaces, exitingSpace, hf.pos, _miClosedDoorEdges);
          // Trigger when entering within 3 spaces (was further, now within)
          if (distAfter <= 3 && distBefore > 3) {
            if (hasCardInHand(game, oppNum, 'Disengage')) {
              const alreadyTriggered = triggers.some(t => t.type === 'disengage' && t.candidateFigureKey === hf.figureKey);
              if (!alreadyTriggered) {
                triggers.push({
                  type: 'disengage',
                  cardName: 'Disengage',
                  candidatePlayerNum: oppNum,
                  candidateFigureKey: hf.figureKey,
                  candidateDcName: hf.dcName,
                  triggerSpace: enteringSpace,
                  description: `**Mak Eshka'rey** — hostile entered within 3 spaces (at **${enteringSpace.toUpperCase()}**). Disengage opportunity.`,
                });
              }
            }
          }
        }
      }
    }

    // --- Overwatch: hostile enters space on/adjacent to Overwatch token ---
    for (const [owMsgId, owSpace] of Object.entries(game.overwatchTokenPosition || {})) {
      const normOwSpace = normalizeCoord(owSpace);
      // Check entering space is on or adjacent to token
      const isOnOrAdj = enteringSpace === normOwSpace || enterAdj.has(normOwSpace);
      if (!isOnOrAdj) continue;
      // Check was NOT already on or adjacent (only trigger on entering the zone)
      const wasOnOrAdj = exitingSpace === normOwSpace || exitAdj.has(normOwSpace);
      if (wasOnOrAdj) continue;
      // Determine owner of this Overwatch
      let owPlayerNum = null;
      if ((getDcMessageIds(game, 1) || []).includes(owMsgId)) owPlayerNum = 1;
      else if ((getDcMessageIds(game, 2) || []).includes(owMsgId)) owPlayerNum = 2;
      if (!owPlayerNum || owPlayerNum === movingPlayerNum) continue;
      // Check not already exhausted
      if (cardNameIncludes(game.exhaustedSkirmishUpgrades?.[owMsgId], 'Overwatch')) continue;
      // Avoid duplicate triggers for same token in same move
      if (triggers.some(t => t.type === 'overwatch' && t.owMsgId === owMsgId)) continue;
      // Find DC name
      const owDcList = getDcList(game, owPlayerNum) || [];
      const owMsgIds = getDcMessageIds(game, owPlayerNum) || [];
      const owIdx = owMsgIds.indexOf(owMsgId);
      const owDcName = owIdx >= 0 ? (owDcList[owIdx]?.dcName || 'E-Web Engineer') : 'E-Web Engineer';
      const owDisplayName = owIdx >= 0 ? (owDcList[owIdx]?.displayName || owDcName) : owDcName;
      triggers.push({
        type: 'overwatch',
        cardName: 'Overwatch',
        candidatePlayerNum: owPlayerNum,
        candidateFigureKey: null,
        candidateDcName: owDcName,
        triggerSpace: enteringSpace,
        description: `**${owDisplayName}** (Overwatch) — hostile entered space on/adjacent to Overwatch token at **${normOwSpace.toUpperCase()}**. Interrupt attack opportunity.`,
        owMsgId,
        owTokenSpace: normOwSpace,
      });
    }
  }

  return triggers;
}
