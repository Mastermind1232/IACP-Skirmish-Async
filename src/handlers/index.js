/**
 * Handler registry: map handler key (prefix) to async (interaction, context) => void.
 * Single place to register all handlers; index builds context and calls getHandler(key)(interaction, context).
 */
import { handleLobbyJoin, handleLobbyStart } from './lobby.js';
import { handleRequestResolve, handleRequestReject } from './requests.js';
import {
  handleRefreshMap,
  handleRefreshAll,
  handleUndo,
  handleKillGame,
  handleDefaultDeck,
} from './game-tools.js';
import { handleSpecialDone } from './special.js';
import { handleInteractCancel, handleInteractChoice } from './interact.js';
import { handleEndEndOfRound, handleEndStartOfRound } from './round.js';
import { handleMoveMp, handleMoveAdjustMp, handleMovePick } from './movement.js';
import { handleAttackTarget, handleCombatReady, handleCombatRoll, handleCombatSurge } from './combat.js';
import { handleStatusPhase, handlePassActivationTurn, handleEndTurn, handleConfirmActivate, handleCancelActivate } from './activation.js';
import {
  handleMapSelection,
  handleDraftRandom,
  handleDetermineInitiative,
  handleDeploymentZone,
  handleDeploymentFig,
  handleDeploymentOrient,
  handleDeployPick,
  handleDeploymentDone,
} from './setup.js';
import {
  handleDcActivate,
  handleDcUnactivate,
  handleDcToggle,
  handleDcDeplete,
  handleDcCcSpecial,
  handleDcAction,
} from './dc-play-area.js';

const HANDLERS = new Map();

function register(key, fn) {
  if (HANDLERS.has(key)) throw new Error(`Duplicate handler: ${key}`);
  HANDLERS.set(key, fn);
}

register('lobby_join_', handleLobbyJoin);
register('lobby_start_', handleLobbyStart);
register('request_resolve_', handleRequestResolve);
register('request_reject_', handleRequestReject);
register('refresh_map_', handleRefreshMap);
register('refresh_all_', handleRefreshAll);
register('undo_', handleUndo);
register('kill_game_', handleKillGame);
register('default_deck_', handleDefaultDeck);
register('special_done_', handleSpecialDone);
register('interact_cancel_', handleInteractCancel);
register('interact_choice_', handleInteractChoice);
register('end_end_of_round_', handleEndEndOfRound);
register('end_start_of_round_', handleEndStartOfRound);
register('move_mp_', handleMoveMp);
register('move_adjust_mp_', handleMoveAdjustMp);
register('move_pick_', handleMovePick);
register('attack_target_', handleAttackTarget);
register('combat_ready_', handleCombatReady);
register('combat_roll_', handleCombatRoll);
register('combat_surge_', handleCombatSurge);
register('status_phase_', handleStatusPhase);
register('pass_activation_turn_', handlePassActivationTurn);
register('end_turn_', handleEndTurn);
register('confirm_activate_', handleConfirmActivate);
register('cancel_activate_', handleCancelActivate);
register('map_selection_', handleMapSelection);
register('draft_random_', handleDraftRandom);
register('determine_initiative_', handleDetermineInitiative);
register('deployment_zone_red_', handleDeploymentZone);
register('deployment_zone_blue_', handleDeploymentZone);
register('deployment_fig_', handleDeploymentFig);
register('deployment_orient_', handleDeploymentOrient);
register('deploy_pick_', handleDeployPick);
register('deployment_done_', handleDeploymentDone);
register('dc_activate_', handleDcActivate);
register('dc_unactivate_', handleDcUnactivate);
register('dc_toggle_', handleDcToggle);
register('dc_deplete_', handleDcDeplete);
register('dc_cc_special_', handleDcCcSpecial);
register('dc_move_', (i, ctx) => handleDcAction(i, ctx, 'dc_move_'));
register('dc_attack_', (i, ctx) => handleDcAction(i, ctx, 'dc_attack_'));
register('dc_interact_', (i, ctx) => handleDcAction(i, ctx, 'dc_interact_'));
register('dc_special_', (i, ctx) => handleDcAction(i, ctx, 'dc_special_'));

/**
 * Return the handler for the given key (prefix), or null if none.
 * @param {string} handlerKey - e.g. 'lobby_join_', 'dc_activate_'
 * @returns {((interaction: import('discord.js').Interaction, context: object) => Promise<void>)|null}
 */
export function getHandler(handlerKey) {
  return HANDLERS.get(handlerKey) ?? null;
}

export { handleLobbyJoin, handleLobbyStart } from './lobby.js';
export { handleRequestResolve, handleRequestReject } from './requests.js';
export {
  handleRefreshMap,
  handleRefreshAll,
  handleUndo,
  handleKillGame,
  handleDefaultDeck,
} from './game-tools.js';
export { handleSpecialDone } from './special.js';
export { handleInteractCancel, handleInteractChoice } from './interact.js';
export { handleEndEndOfRound, handleEndStartOfRound } from './round.js';
export { handleMoveMp, handleMoveAdjustMp, handleMovePick } from './movement.js';
export { handleAttackTarget, handleCombatReady, handleCombatRoll, handleCombatSurge } from './combat.js';
export { handleStatusPhase, handlePassActivationTurn, handleEndTurn, handleConfirmActivate, handleCancelActivate } from './activation.js';
export {
  handleMapSelection,
  handleDraftRandom,
  handleDetermineInitiative,
  handleDeploymentZone,
  handleDeploymentFig,
  handleDeploymentOrient,
  handleDeployPick,
  handleDeploymentDone,
} from './setup.js';
export {
  handleDcActivate,
  handleDcUnactivate,
  handleDcToggle,
  handleDcDeplete,
  handleDcCcSpecial,
  handleDcAction,
} from './dc-play-area.js';
