/**
 * Event-replay recovery: maps available actions to Discord prompt reconstruction.
 * Uses getAvailableActions to determine what prompts need to be re-sent
 * after a bot restart.
 */

import { getAvailableActions } from './available-actions.js';
import { ACTION_TYPES } from './action-types.js';
import { getPlayerId } from '../game/player-helpers.js';

/**
 * Describe what Discord prompt needs to be sent for a given action type.
 */
const PROMPT_DESCRIPTIONS = {
  [ACTION_TYPES.PHASE_GATE_READY]: 'Phase gate confirmation',
  [ACTION_TYPES.ACTIVATE_DC]: 'DC activation buttons',
  [ACTION_TYPES.MOVE_FIGURE]: 'Movement grid',
  [ACTION_TYPES.ATTACK_TARGET]: 'Attack target selection',
  [ACTION_TYPES.END_TURN]: 'End turn button',
  [ACTION_TYPES.END_ACTIVATION_PHASE]: 'End activation phase button',
  [ACTION_TYPES.COMBAT_GATE]: 'Combat ready confirmation',
  [ACTION_TYPES.COMBAT_ROLL]: 'Roll dice button',
  [ACTION_TYPES.COMBAT_REROLL]: 'Reroll options',
  [ACTION_TYPES.COMBAT_SURGE]: 'Surge assignment',
  [ACTION_TYPES.COMBAT_RESOLVE]: 'Combat resolution',
  [ACTION_TYPES.DEPLOY_FIGURE]: 'Deployment buttons',
  [ACTION_TYPES.DEPLOY_DONE]: 'Deployment done button',
  [ACTION_TYPES.DRAW_CC]: 'Command card draw button',
  [ACTION_TYPES.PICK_ZONE]: 'Zone selection buttons',
  [ACTION_TYPES.END_END_OF_ROUND]: 'End of round button',
  [ACTION_TYPES.END_START_OF_ROUND]: 'Start of round button',
};

/**
 * Get recovery prompts needed for the current game state.
 * Returns which players need which prompts re-sent.
 *
 * @param {object} game - The game state
 * @param {object} [deps] - Dependencies for available-actions
 * @returns {Array<{ playerNum: number, playerId: string, actions: object[], description: string }>}
 */
export function getRecoveryPrompts(game, deps = {}) {
  const prompts = [];

  for (const pn of [1, 2]) {
    const actions = getAvailableActions(game, pn, deps);
    if (actions.length > 0) {
      // Group by type for description
      const types = [...new Set(actions.map(a => a.type))];
      const descriptions = types.map(t => PROMPT_DESCRIPTIONS[t] || t).join(', ');

      prompts.push({
        playerNum: pn,
        playerId: getPlayerId(game, pn),
        actions,
        description: descriptions || 'Actions available',
      });
    }
  }

  return prompts;
}

/**
 * Return a short human-readable reason why a game needs recovery,
 * or null if it doesn't. Used for observability logging.
 * @param {object} game
 * @returns {string|null}
 */
export function getRecoveryReason(game) {
  if (!game || game.ended) return null;
  if (game.phaseGate) return `phaseGate(${game.phaseGate.phase || '?'})`;
  if (game.setupAttachmentPhase) return 'setupAttachmentPhase';
  if (game.pendingCombat) return `pendingCombat(reroll=${!!game.pendingCombat.rerollPhase})`;
  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) return 'moveInProgress';
  if (game.currentActivationTurnPlayerId) return 'currentActivationTurn';
  if (game.endOfRoundWhoseTurn) return 'endOfRoundWhoseTurn';
  if (game.pendingEndTurn && Object.keys(game.pendingEndTurn).length > 0) return 'pendingEndTurn';
  if (game.pendingNegation) return 'pendingNegation';
  if (game.pendingCoverFire) return 'pendingCoverFire';
  if (game.pendingStrainChoice && Object.keys(game.pendingStrainChoice).length > 0) return 'pendingStrainChoice';
  if (game.pendingCcConfirmation) return `pendingCcConfirmation(${game.pendingCcConfirmation.card || '?'})`;
  if (game.pendingCcChoice && game.pendingCcChoice.gameId) return 'pendingCcChoice';
  if (game.pendingCcSpaceChoice && game.pendingCcSpaceChoice.gameId) return 'pendingCcSpaceChoice';
  if (game.pendingStillFaster) return 'pendingStillFaster';
  if (game.pendingPowerTokenGrant) return 'pendingPowerTokenGrant';
  if (game.pendingCelebration) return 'pendingCelebration';
  if (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0) return 'pendingDcAbilityChoice';
  if (game.pendingRushPush) return 'pendingRushPush';
  // pendingBleeding: headless-only state, never set in production — skip
  if (game.pendingLastResort) return 'pendingLastResort';
  if (game.pendingFalseOrders) return 'pendingFalseOrders';
  if (game.pendingInterrogate) return 'pendingInterrogate';
  if (game.pendingMastery) return 'pendingMastery';
  if (game.pendingMilitaryEfficiency) return 'pendingMilitaryEfficiency';
  if (game.forceVisionPending) return 'forceVisionPending';
  if (game.phase === 'cc_draw' && (!game.player1CcDrawn || !game.player2CcDrawn)) return 'ccDrawPending';
  return null;
}

/**
 * Determine if a game needs recovery (has pending actions but no recent interaction).
 * @param {object} game
 * @returns {boolean}
 */
export function needsRecovery(game) {
  if (!game || game.ended) return false;

  // Games with a phase gate always need their prompts
  if (game.phaseGate) return true;

  // Games in setup attachment placement
  if (game.setupAttachmentPhase) return true;

  // Games mid-combat need the combat UI re-sent
  if (game.pendingCombat) return true;

  // Games mid-movement need movement grid
  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) return true;

  // Active games with a current turn player
  if (game.currentActivationTurnPlayerId) return true;

  // End-of-round window active
  if (game.endOfRoundWhoseTurn) return true;

  // End-turn buttons pending (belt-and-suspenders with currentActivationTurnPlayerId)
  if (game.pendingEndTurn && Object.keys(game.pendingEndTurn).length > 0) return true;

  // Blocking pending sub-states that prevent normal play
  if (game.pendingNegation) return true;
  if (game.pendingCoverFire) return true;
  if (game.pendingStrainChoice && Object.keys(game.pendingStrainChoice).length > 0) return true;
  if (game.pendingCcConfirmation) return true;
  if (game.pendingCcChoice && game.pendingCcChoice.gameId) return true;
  if (game.pendingCcSpaceChoice && game.pendingCcSpaceChoice.gameId) return true;
  if (game.pendingStillFaster) return true;
  if (game.pendingPowerTokenGrant) return true;
  if (game.pendingCelebration) return true;
  if (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0) return true;
  if (game.pendingRushPush) return true;
  // pendingBleeding: headless-only state, never set in production — skip
  if (game.pendingLastResort) return true;
  if (game.pendingFalseOrders) return true;
  if (game.pendingInterrogate) return true;
  if (game.pendingMastery) return true;
  if (game.pendingMilitaryEfficiency) return true;
  if (game.forceVisionPending) return true;

  // CC draw phase with undrawn hands
  if (game.phase === 'cc_draw' && (!game.player1CcDrawn || !game.player2CcDrawn)) return true;

  return false;
}
