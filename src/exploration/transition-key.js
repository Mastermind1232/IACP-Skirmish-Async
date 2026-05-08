/**
 * Canonical transition identity for coverage tracking.
 * Shared between headless explorer and Discord self-play.
 *
 * Transition key = "roundPhase|frozenPendingSet|actionType"
 *
 * This module is the single source of truth for PENDING_STATE_KEYS and
 * the transition key computation. Both headless (flow-harness, explorer-coverage)
 * and Discord (self-play.js) import from here.
 */

// Canonical list: every pending state key that affects game-state identity.
// Order matters (determines frozenPendingSet string). Do not reorder.
export const PENDING_STATE_KEYS = [
  'pendingCombat',
  'pendingNegation',
  'pendingCelebration',
  'pendingPowerTokenGrant',
  'pendingDcAbilityChoice',
  'pendingPounceSpaceChoice',
  'pendingMissileSalvo',
  'pendingCoverFire',
  'pendingSpreadThePainCondPick',
  'pendingStrainChoice',
  'pendingStillFaster',
  'pendingLastResort',
  'pendingDefeatPick',
  'pendingPartingShot',
  'pendingStrikeMeDown',
  'pendingSlowOnTheDraw',
  'pendingForceExhaustion',
  'pendingIllicitArms',
  'pendingPowerConverter',
  'pendingThereIsNoTry',
  'pendingToughLuck',
  'pendingHunterProtocol',
  'pendingBleeding',
  'pendingEe3Carbine',
  'pendingBoRifle',
  'pendingRushPush',
  'pendingShoulderRush',
  'pendingFalseOrders',
  'pendingOverwatchPlacement',
  'pendingOrbitalBombardment',
  'pendingBombDrop',
  'pendingCcConfirmation',
  'pendingCcChoice',
  'pendingCcSpaceChoice',
  'moveInProgress',
  'endOfRoundWhoseTurn',
];

/** Check if a pending field is "active" (truthy, non-empty object). */
function isPendingActive(val) {
  if (!val) return false;
  if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return false;
  return true;
}

/** Snapshot which pending states are active on a game. */
export function snapshotPendingStates(game) {
  const snap = {};
  for (const key of PENDING_STATE_KEYS) {
    snap[key] = isPendingActive(game[key]);
  }
  return snap;
}

/**
 * Compute the transition key for a game state + action type.
 * Key format: "roundPhase|pendingSet|actionType"
 */
export function computeTransitionKey(game, actionType) {
  const roundPhase = game.roundPhase || 'null';
  const activePending = PENDING_STATE_KEYS.filter(k => isPendingActive(game[k]));
  return `${roundPhase}|${activePending.join(',')}|${actionType}`;
}

/**
 * Parse a transition key back into its component parts.
 */
export function parseTransitionKey(key) {
  const parts = key.split('|');
  return {
    roundPhase: parts[0] || 'null',
    pendingSet: parts[1] || '',
    actionType: parts[2] || '',
  };
}
