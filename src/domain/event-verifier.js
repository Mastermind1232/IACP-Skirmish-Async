import { gameReducer } from './reducer/index.js';
import { getAllEventsSince } from './event-store.js';
import { loadLatestSnapshot } from './snapshot-store.js';

/**
 * Verify that replaying domain events produces the same state as actual game state.
 * @param {string} gameId
 * @param {object} actualState - the current game state from the state blob
 * @returns {{ match: boolean, mismatches: Array<{ key: string, replayed: any, actual: any }> }}
 */
export async function verifyGameEvents(gameId, actualState) {
  const snapshot = await loadLatestSnapshot(gameId);
  const events = await getAllEventsSince(gameId, snapshot?.version || 0);
  let replayedState = snapshot?.state || {};
  for (const event of events) {
    replayedState = gameReducer(replayedState, event);
  }
  return compareStates(replayedState, actualState);
}

const COMPARABLE_KEYS = [
  // Core game state
  'currentRound', 'roundPhase', 'phase', 'figurePositions', 'figureConditions',
  'figurePowerTokens', 'dcActionsData', 'pendingCombat', 'moveInProgress',
  'player1VP', 'player2VP', 'phaseGate',
  // Health & deployment
  'dcHealthState', 'player1Deployed', 'player2Deployed',
  // Setup state
  'selectedMap', 'initiativePlayerNum', 'dcAttachments', 'confirmedMapId',
  // Combat sub-state
  'lastCleaveTarget', 'lastCleaveDamage',
  // Hand state
  'player1Hand', 'player2Hand',
  // Terminal/crate state
  'terminalControl', 'collectedCrates',
];

export { COMPARABLE_KEYS };

function compareStates(replayed, actual) {
  const mismatches = [];
  for (const key of COMPARABLE_KEYS) {
    if (JSON.stringify(replayed?.[key]) !== JSON.stringify(actual?.[key])) {
      mismatches.push({ key, replayed: replayed?.[key], actual: actual?.[key] });
    }
  }
  // Track keys in replayed state not in COMPARABLE_KEYS for informational output
  const replayedKeys = Object.keys(replayed || {});
  const unknownKeys = replayedKeys.filter(k => !COMPARABLE_KEYS.includes(k));
  return { match: mismatches.length === 0, mismatches, unknownKeys };
}

/**
 * Shadow comparison: replay events and compare with blob state.
 * Returns summary suitable for logging. Never throws.
 * @param {string} gameId
 * @param {object} blobState - current state from the state blob
 * @returns {Promise<{ match: boolean, eventCount: number, mismatches: string[] }>}
 */
export async function shadowCompare(gameId, blobState) {
  try {
    const snapshot = await loadLatestSnapshot(gameId);
    const events = await getAllEventsSince(gameId, snapshot?.version || 0);
    let replayedState = snapshot?.state || {};
    for (const event of events) {
      replayedState = gameReducer(replayedState, event);
    }
    const result = compareStates(replayedState, blobState);
    return {
      match: result.match,
      eventCount: events.length + (snapshot?.version || 0),
      mismatches: result.mismatches.map(m => m.key),
    };
  } catch (e) {
    return { match: false, eventCount: -1, mismatches: [`error: ${e.message}`] };
  }
}
