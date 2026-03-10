/**
 * Handler registry: map handler key (prefix) to async (interaction, context) => void.
 * Single place to register all handlers. index.js dispatches via if-chains with hand-built context objects.
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
import { handleEndEndOfRound, handleEndStartOfRound, runStartOfRoundDcEffects, handleExtraArmorPick, handleRbfDiscard, handleRogueOneReturn, handleImpCitadel } from './round.js';
import {
  runPostDeployPhase, advancePostDeployQueue, onPostDeployMovementComplete, onExtraArmorComplete,
  handlePostDeployPick, handleSecurityDetailPick, handleStrikeTeamAdjPick,
  handleStrikeTeamTokenPick, handleStrikeTeamTokenDone,
  handlePostDeployMoveSkip,
  handleWalkerMove, handleWalkerSkip,
} from './post-deploy.js';
import { handleMoveMp, handleMoveAdjustMp, handleMovePick, handleMoveLetter, handleMoveLetterBack } from './movement.js';
import { handleAttackTarget, handleCombatReady, handleCombatResolveReady, handleCombatRoll, handleCombatSurge, handleCleaveTarget, handleCombatReroll, handlePreReroll, handleCombatPassive, handleCombatToken, handlePowerTokenChoice, handleSpreadThePainCondPick, handleFigureheadDecision, handleLasatDiePick, handleLasatFacePick, handleFalseOrdersAtkPick, handleCoverFireBlock, handleCoverFireDiscard, handleGuidanceSystems } from './combat.js';
import { handleStatusPhase, handlePassActivationTurn, handleEndTurn, handleDcEndActivation, handleConfirmActivate, handleCancelActivate, handleActPassive } from './activation.js';
import {
  handleMapSelection,
  handleMapTypeChoice,
  handleDraftRandom,
  handleDetermineInitiative,
  handleDeploymentZone,
  handleDeploymentFig,
  handleDeploymentOrient,
  handleDeployPick,
  handleDeployRow,
  handleDeployRowBack,
  handleLoadoutPick,
  handleFormPick,
  handleDeploymentDone,
  handleAutoDeploy,
  handleMapConfirm,
  handleMapGoBack,
  handleSetupAttachTo,
} from './setup.js';
import {
  handleDcActivate,
  handleDcUnactivate,
  handleDcToggle,
  handleDcDeplete,
  handleDcRename,
  handleDcCcSpecial,
  handleDcCcEndOfActivation,
  handleDcCcDoubleAction,
  handleDcAction,
  handlePounceSpacePick,
  handleDcAbilityChoice,
  handleArsenalPick,
  handleEe3DiePick,
  handleFalseOrdersAction,
  handleFalseOrdersMovePick,
  handleRushPushFig,
  handleRushPushSpace,
  handleRushPushSkip,
  handleShoulderRushFig,
  handleShoulderRushSpace,
  handleShoulderRushSkip,
  handleOverwatchSpacePick,
  handleOrbitalBombardmentDeplete,
  handleOrbitalBombardmentSkip,
  handleOrbitalBombardmentSpacePick,
} from './dc-play-area.js';
import {
  handleSquadModal,
  handleDeployModal,
  handleCcAttachTo,
  handleCcPlaySelect,
  handleCcConfirmPlay,
  handleCcCancelPlay,
  handleCcDiscardSelect,
  handleDeckIllegalPlay,
  handleDeckIllegalRedo,
  handleCcShuffleDraw,
  handleCcPlay,
  handleCcDraw,
  handleCcSearchDiscard,
  handleCcCloseDiscard,
  handleCcDiscard,
  handleCcChoice,
  handleCcSpacePick,
  handleSquadSelect,
  handleIllegalCcIgnore,
  handleIllegalCcUnplay,
  handleNegationPlay,
  handleNegationLetResolve,
  handleCelebrationPlay,
  handleCelebrationPass,
} from './cc-hand.js';
import {
  handleBotmenuArchive,
  handleBotmenuKill,
  handleBotmenuArchiveYes,
  handleBotmenuArchiveNo,
  handleBotmenuKillYes,
  handleBotmenuKillNo,
} from './botmenu.js';
import { handleFastForward, handleDefenderCcPlay } from './fast-forward.js';
import { handleToughLuck, handleThereIsNoTry, handleVetInstincts, handleHunterProtocol, handleStrikeMeDown, handleSlowOnTheDraw, handleSlowOnTheDrawResume, handlePowerConverter } from './combat-reactions.js';
import { handleReactionSkip, handleReactionUse, handleRightBack, handleMasteryPick, handleInterrogatePick } from './post-combat.js';
import { handleStillFaster, handleSquadSwarm, handleOverdrive, handleSelfDestructProbe, handleSelfDestructProtocol, handleLastResort, handleScavengedWalker, handleOnDiplomatic, handleBelReorder, handleAssassinsBladePickTarget, handleSuppressiveFireMpPick, handleForceSlowPick, handleExcavationPick } from './interrupts.js';
import { handleDevaronDoorOpen, handleDevaronCratePush, handleKryknaPush } from './map-events.js';
import {
  handleBleedResolve,
  handleSidewinderApply, handleSidewinderSkip,
  handleBoltslingerTarget, handleBoltslingerSkip,
  handleIndiscriminateFireDie, handleIndiscriminateFireSkip,
  handleFightingKnifeTarget, handleFightingKnifeSkip,
  handleConcussiveBoltPush, handleConcussiveBoltSkip,
  handleSpreadThePainFigPick, handleSpreadThePainSkip,
  handleMissileSalvoDie, handleMissileSalvoDone,
} from './combat-special-effects.js';

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
register('extra_armor_pick_', handleExtraArmorPick);
register('pd_pick_', handlePostDeployPick);
register('pd_security_pick_', handleSecurityDetailPick);
register('pd_strike_adj_', handleStrikeTeamAdjPick);
register('pd_strike_token_done_', handleStrikeTeamTokenDone);
register('pd_strike_token_', handleStrikeTeamTokenPick);
register('pd_move_skip_', handlePostDeployMoveSkip);
register('pd_walker_move_', handleWalkerMove);
register('pd_walker_skip_', handleWalkerSkip);
register('rbf_discard_', handleRbfDiscard);
register('rogue_one_return_', handleRogueOneReturn);
register('imp_citadel_', handleImpCitadel);
register('move_mp_', handleMoveMp);
register('move_adjust_mp_', handleMoveAdjustMp);
register('move_back_letters_', handleMoveLetterBack);
register('move_letter_', handleMoveLetter);
register('move_pick_', handleMovePick);
register('attack_target_', handleAttackTarget);
register('cleave_target_', handleCleaveTarget);
register('cover_fire_block_', handleCoverFireBlock);
register('cover_fire_discard_', handleCoverFireDiscard);
register('guidance_systems_', handleGuidanceSystems);
register('combat_resolve_ready_', handleCombatResolveReady);
  register('combat_ready_', handleCombatReady);
  register('combat_roll_', handleCombatRoll);
  register('combat_surge_', handleCombatSurge);
  register('combat_reroll_', handleCombatReroll);
  register('pre_reroll_', handlePreReroll);
register('combat_passive_', handleCombatPassive);
register('combat_token_', handleCombatToken);
register('power_token_choice_', handlePowerTokenChoice);
register('spread_pain_cond_', handleSpreadThePainCondPick);
register('figurehead_use_', handleFigureheadDecision);
register('figurehead_skip_', handleFigureheadDecision);
register('lasat_die_', handleLasatDiePick);
register('lasat_face_', handleLasatFacePick);
register('false_orders_action_', handleFalseOrdersAction);
register('false_orders_space_', handleFalseOrdersMovePick);
register('false_orders_atk_', handleFalseOrdersAtkPick);
register('act_passive_', handleActPassive);
register('status_phase_', handleStatusPhase);
register('pass_activation_turn_', handlePassActivationTurn);
register('end_turn_', handleEndTurn);
register('dc_end_activation_', handleDcEndActivation);
register('confirm_activate_', handleConfirmActivate);
register('cancel_activate_', handleCancelActivate);
register('map_selection_', handleMapSelection);
register('map_type_', handleMapTypeChoice);
register('draft_random_', handleDraftRandom);
register('determine_initiative_', handleDetermineInitiative);
register('deployment_zone_red_', handleDeploymentZone);
register('deployment_zone_blue_', handleDeploymentZone);
register('deployment_fig_', handleDeploymentFig);
register('deployment_orient_', handleDeploymentOrient);
register('deploy_pick_', handleDeployPick);
register('deploy_row_back_', handleDeployRowBack);
register('deploy_row_', handleDeployRow);
register('loadout_pick_', handleLoadoutPick);
register('form_pick_', handleFormPick);
register('deployment_done_', handleDeploymentDone);
register('auto_deploy_', handleAutoDeploy);
register('map_confirm_', handleMapConfirm);
register('map_goback_', handleMapGoBack);
register('setup_attach_to_', handleSetupAttachTo);
register('dc_activate_', handleDcActivate);
register('dc_unactivate_', handleDcUnactivate);
register('dc_toggle_', handleDcToggle);
register('dc_deplete_', handleDcDeplete);
register('dc_rename_', handleDcRename);
register('dc_cc_special_', handleDcCcSpecial);
register('dc_cc_eoa_', handleDcCcEndOfActivation);
register('dc_cc_double_', handleDcCcDoubleAction);
register('pounce_space_', handlePounceSpacePick);
register('rush_push_fig_', handleRushPushFig);
register('rush_push_space_', handleRushPushSpace);
register('rush_push_skip_', handleRushPushSkip);
register('shoulder_rush_fig_', handleShoulderRushFig);
register('shoulder_rush_space_', handleShoulderRushSpace);
register('shoulder_rush_skip_', handleShoulderRushSkip);
register('overwatch_space_', handleOverwatchSpacePick);
register('ob_deplete_', handleOrbitalBombardmentDeplete);
register('ob_skip_', handleOrbitalBombardmentSkip);
register('ob_space_', handleOrbitalBombardmentSpacePick);
register('dc_move_', (i, ctx) => handleDcAction(i, ctx, 'dc_move_'));
register('dc_attack_', (i, ctx) => handleDcAction(i, ctx, 'dc_attack_'));
register('dc_interact_', (i, ctx) => handleDcAction(i, ctx, 'dc_interact_'));
register('dc_special_', (i, ctx) => handleDcAction(i, ctx, 'dc_special_'));
register('dc_ability_choice_', handleDcAbilityChoice);
register('ee3_pick_die_', handleEe3DiePick);
register('deck_illegal_play_', handleDeckIllegalPlay);
register('deck_illegal_redo_', handleDeckIllegalRedo);
register('cc_shuffle_draw_', handleCcShuffleDraw);
register('cc_play_', handleCcPlay);
register('cc_confirm_play_', handleCcConfirmPlay);
register('cc_cancel_play_', handleCcCancelPlay);
register('cc_draw_', handleCcDraw);
register('cc_search_discard_', handleCcSearchDiscard);
register('cc_close_discard_', handleCcCloseDiscard);
register('cc_discard_', handleCcDiscard);
register('cc_choice_', handleCcChoice);
register('cc_space_', handleCcSpacePick);
register('squad_select_', handleSquadSelect);
register('illegal_cc_ignore_', handleIllegalCcIgnore);
register('illegal_cc_unplay_', handleIllegalCcUnplay);
register('negation_play_', handleNegationPlay);
register('negation_let_resolve_', handleNegationLetResolve);
register('celebration_play_', handleCelebrationPlay);
register('celebration_pass_', handleCelebrationPass);
register('botmenu_archive_', handleBotmenuArchive);
register('botmenu_kill_', handleBotmenuKill);
register('botmenu_archive_yes_', handleBotmenuArchiveYes);
register('botmenu_archive_no_', handleBotmenuArchiveNo);
register('botmenu_kill_yes_', handleBotmenuKillYes);
register('botmenu_kill_no_', handleBotmenuKillNo);
register('fast_forward_', handleFastForward);
register('dc_cc_defender_', handleDefenderCcPlay);

// New: extracted inline handlers
register('tough_luck_remove_', handleToughLuck);
register('tough_luck_skip_', handleToughLuck);
register('there_is_no_try_die_', handleThereIsNoTry);
register('there_is_no_try_face_', handleThereIsNoTry);
register('there_is_no_try_skip_', handleThereIsNoTry);
register('vet_instincts_pick_', handleVetInstincts);
register('hunter_protocol_trigger_', handleHunterProtocol);
register('hunter_protocol_skip_', handleHunterProtocol);
register('strike_me_down_yes_', handleStrikeMeDown);
register('strike_me_down_no_', handleStrikeMeDown);
register('slow_on_draw_yes_', handleSlowOnTheDraw);
register('slow_on_draw_no_', handleSlowOnTheDraw);
register('slow_on_draw_resume_', handleSlowOnTheDrawResume);
register('power_converter_approve_', handlePowerConverter);
register('power_converter_skip_', handlePowerConverter);
register('power_converter_die_', handlePowerConverter);
register('power_converter_color_', handlePowerConverter);
register('reaction_skip_', handleReactionSkip);
register('reaction_use_', handleReactionUse);
register('right_back_block_', handleRightBack);
register('right_back_nodmg_', handleRightBack);
register('mastery_pick_', handleMasteryPick);
register('mastery_skip_', handleMasteryPick);
register('interrogate_pick_', handleInterrogatePick);
register('interrogate_discard_', handleInterrogatePick);
register('interrogate_skip_', handleInterrogatePick);
register('still_faster_use_', handleStillFaster);
register('still_faster_skip_', handleStillFaster);
register('still_faster_dc_pick_', handleStillFaster);
register('squad_swarm_yes_', handleSquadSwarm);
register('squad_swarm_no_', handleSquadSwarm);
register('overdrive_use_', handleOverdrive);
register('self_destruct_probe_use_', handleSelfDestructProbe);
register('self_destruct_probe_skip_', handleSelfDestructProbe);
register('self_destruct_protocol_use_', handleSelfDestructProtocol);
register('self_destruct_protocol_skip_', handleSelfDestructProtocol);
register('last_resort_use_', handleLastResort);
register('last_resort_skip_', handleLastResort);
register('scavenged_walker_attack_', handleScavengedWalker);
register('scavenged_walker_skip_', handleScavengedWalker);
register('on_diplomatic_', handleOnDiplomatic);
register('bel_reorder_1_', handleBelReorder);
register('bel_reorder_2_', handleBelReorder);
register('ab_blade_pick_', handleAssassinsBladePickTarget);
register('sf_mp_pick_', handleSuppressiveFireMpPick);
register('force_slow_pick_', handleForceSlowPick);
register('excavation_pick_', handleExcavationPick);
register('devaron_door_open_', handleDevaronDoorOpen);
register('devaron_crate_push_', handleDevaronCratePush);
register('krykna_push_', handleKryknaPush);

// Combat special effects (extracted from index.js)
register('bleed_accept_', handleBleedResolve);
register('bleed_prevent_', handleBleedResolve);
register('sidewinder_apply_', handleSidewinderApply);
register('sidewinder_skip_', handleSidewinderSkip);
register('boltslinger_target_', handleBoltslingerTarget);
register('boltslinger_skip_', handleBoltslingerSkip);
register('indiscriminate_die_', handleIndiscriminateFireDie);
register('indiscriminate_skip_', handleIndiscriminateFireSkip);
register('fighting_knife_target_', handleFightingKnifeTarget);
register('fighting_knife_skip_', handleFightingKnifeSkip);
register('concussive_bolt_push_', handleConcussiveBoltPush);
register('concussive_bolt_skip_', handleConcussiveBoltSkip);
register('spread_pain_fig_', handleSpreadThePainFigPick);
register('spread_pain_skip_', handleSpreadThePainSkip);
register('missile_salvo_die_', handleMissileSalvoDie);
register('missile_salvo_done_', handleMissileSalvoDone);

// Context group mapping: handler key → context group name (from context-factory.js)
const HANDLER_GROUPS = new Map();
function setGroup(keys, group) { for (const k of keys) HANDLER_GROUPS.set(k, group); }

setGroup([
  'deck_illegal_play_', 'deck_illegal_redo_', 'cc_shuffle_draw_', 'cc_play_',
  'cc_confirm_play_', 'cc_cancel_play_', 'cc_draw_', 'cc_search_discard_',
  'cc_close_discard_', 'cc_discard_', 'cc_choice_', 'cc_space_', 'squad_select_',
  'illegal_cc_ignore_', 'illegal_cc_unplay_', 'negation_play_', 'negation_let_resolve_',
  'celebration_play_', 'celebration_pass_',
], 'ccHand');

setGroup([
  'dc_activate_', 'dc_unactivate_', 'dc_toggle_', 'dc_deplete_', 'dc_rename_',
  'dc_cc_special_', 'dc_cc_eoa_', 'dc_cc_double_', 'dc_move_', 'dc_attack_',
  'dc_interact_', 'dc_special_', 'pounce_space_', 'dc_ability_choice_', 'ee3_pick_die_',
  'false_orders_action_', 'false_orders_space_', 'rush_push_fig_', 'rush_push_space_',
  'rush_push_skip_', 'shoulder_rush_fig_', 'shoulder_rush_space_', 'shoulder_rush_skip_',
  'overwatch_space_', 'ob_deplete_', 'ob_skip_', 'ob_space_',
], 'dcPlayArea');

setGroup(['move_mp_'], 'move');
setGroup(['move_adjust_mp_'], 'moveAdjust');
setGroup(['move_letter_'], 'moveLetter');
setGroup(['move_back_letters_'], 'moveBackLetters');
setGroup(['move_pick_'], 'movePick');

setGroup([
  'cleave_target_', 'attack_target_', 'combat_resolve_ready_', 'combat_ready_',
  'combat_roll_', 'combat_surge_', 'combat_reroll_', 'pre_reroll_', 'combat_passive_',
  'combat_token_', 'power_token_choice_', 'spread_pain_cond_', 'figurehead_use_',
  'figurehead_skip_', 'lasat_die_', 'lasat_face_', 'false_orders_atk_',
  'guidance_systems_', 'cover_fire_block_', 'cover_fire_discard_',
], 'combat');

setGroup([
  'tough_luck_remove_', 'tough_luck_skip_', 'there_is_no_try_die_',
  'there_is_no_try_face_', 'there_is_no_try_skip_', 'vet_instincts_pick_',
  'hunter_protocol_trigger_', 'hunter_protocol_skip_',
  'strike_me_down_yes_', 'strike_me_down_no_',
  'slow_on_draw_yes_', 'slow_on_draw_no_', 'slow_on_draw_resume_',
  'power_converter_approve_', 'power_converter_skip_',
  'power_converter_die_', 'power_converter_color_',
], 'combatReactions');

setGroup([
  'reaction_skip_', 'reaction_use_', 'right_back_block_', 'right_back_nodmg_',
  'mastery_pick_', 'mastery_skip_', 'interrogate_pick_', 'interrogate_discard_',
  'interrogate_skip_',
], 'postCombat');

setGroup([
  'still_faster_use_', 'still_faster_skip_', 'still_faster_dc_pick_',
  'squad_swarm_yes_', 'squad_swarm_no_', 'overdrive_use_',
  'self_destruct_probe_use_', 'self_destruct_probe_skip_',
  'self_destruct_protocol_use_', 'self_destruct_protocol_skip_',
  'last_resort_use_', 'last_resort_skip_', 'scavenged_walker_attack_',
  'scavenged_walker_skip_', 'on_diplomatic_', 'bel_reorder_1_', 'bel_reorder_2_',
  'ab_blade_pick_', 'sf_mp_pick_', 'force_slow_pick_', 'excavation_pick_',
], 'interrupts');

setGroup([
  'act_passive_', 'status_phase_', 'pass_activation_turn_', 'end_turn_',
  'dc_end_activation_', 'confirm_activate_', 'cancel_activate_',
], 'activation');

setGroup(['end_end_of_round_'], 'round');
setGroup(['end_start_of_round_'], 'startOfRound');

setGroup([
  'pd_pick_', 'pd_security_pick_', 'pd_strike_adj_',
  'pd_strike_token_', 'pd_strike_token_done_',
  'pd_move_skip_',
  'pd_walker_move_', 'pd_walker_skip_',
], 'postDeploy');

setGroup([
  'devaron_door_open_', 'devaron_crate_push_', 'krykna_push_',
], 'mapEvents');

setGroup([
  'bleed_accept_', 'bleed_prevent_', 'sidewinder_apply_', 'sidewinder_skip_',
  'boltslinger_target_', 'boltslinger_skip_', 'indiscriminate_die_',
  'indiscriminate_skip_', 'fighting_knife_target_', 'fighting_knife_skip_',
  'concussive_bolt_push_', 'concussive_bolt_skip_', 'spread_pain_fig_',
  'spread_pain_skip_', 'missile_salvo_die_', 'missile_salvo_done_',
], 'combatSpecialEffects');

setGroup([
  'map_selection_', 'map_type_', 'map_confirm_', 'map_goback_', 'draft_random_',
  'determine_initiative_', 'deployment_zone_red_', 'deployment_zone_blue_',
  'deployment_fig_', 'deployment_orient_', 'deploy_pick_', 'deploy_row_back_',
  'deploy_row_', 'loadout_pick_', 'form_pick_', 'deployment_done_', 'auto_deploy_',
], 'setup');

setGroup(['interact_cancel_'], 'interactCancel');
setGroup(['interact_choice_'], 'interact');
setGroup(['refresh_map_'], 'refreshMap');
setGroup(['refresh_all_'], 'refreshAll');
setGroup(['undo_'], 'undo');
setGroup([
  'botmenu_archive_', 'botmenu_kill_', 'botmenu_archive_yes_',
  'botmenu_archive_no_', 'botmenu_kill_yes_', 'botmenu_kill_no_',
], 'botmenu');
setGroup(['fast_forward_'], 'fastForward');
setGroup(['dc_cc_defender_'], 'defenderCc');
setGroup(['kill_game_'], 'killGame');
setGroup(['default_deck_'], 'defaultDeck');
setGroup(['lobby_join_'], 'lobbyJoin');
setGroup(['lobby_start_'], 'lobbyStart');

/**
 * Return the handler for the given key (prefix), or null if none.
 * @param {string} handlerKey - e.g. 'lobby_join_', 'dc_activate_'
 * @returns {((interaction: import('discord.js').Interaction, context: object) => Promise<void>)|null}
 */
export function getHandler(handlerKey) {
  return HANDLERS.get(handlerKey) ?? null;
}

/**
 * Return the context group name for the given handler key, or null.
 * @param {string} handlerKey
 * @returns {string|null}
 */
export function getHandlerGroup(handlerKey) {
  return HANDLER_GROUPS.get(handlerKey) ?? null;
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
export { handleEndEndOfRound, handleEndStartOfRound, runStartOfRoundDcEffects, handleExtraArmorPick, handleRbfDiscard, handleRogueOneReturn, handleImpCitadel } from './round.js';
export {
  runPostDeployPhase, advancePostDeployQueue, onPostDeployMovementComplete, onExtraArmorComplete,
  handlePostDeployPick, handleSecurityDetailPick, handleStrikeTeamAdjPick,
  handleStrikeTeamTokenPick, handleStrikeTeamTokenDone,
  handlePostDeployMoveSkip,
  handleWalkerMove, handleWalkerSkip,
} from './post-deploy.js';
export { handleMoveMp, handleMoveAdjustMp, handleMovePick, handleMoveLetter, handleMoveLetterBack } from './movement.js';
export { handleAttackTarget, handleCleaveTarget, handleCoverFireBlock, handleCoverFireDiscard, handleGuidanceSystems, handleCombatReady, handleCombatResolveReady, handleCombatRoll, handleCombatSurge, handleCombatReroll, handlePreReroll, handleCombatPassive, handleCombatToken, handlePowerTokenChoice, handleSpreadThePainCondPick, handleFigureheadDecision, handleLasatDiePick, handleLasatFacePick, handleFalseOrdersAtkPick, sendRerollUI, proceedAfterRerolls, sendReadyToResolveRolls } from './combat.js';
export { handleStatusPhase, handlePassActivationTurn, handleEndTurn, handleDcEndActivation, handleConfirmActivate, handleCancelActivate, handleActPassive } from './activation.js';
export {
  handleMapSelection,
  handleMapTypeChoice,
  handleMapSelectionDraw,
  handleMapSelectionPick,
  handleDraftRandom,
  handleDetermineInitiative,
  handleDeploymentZone,
  handleDeploymentFig,
  handleDeploymentOrient,
  handleDeployPick,
  handleDeployRow,
  handleDeployRowBack,
  handleLoadoutPick,
  handleFormPick,
  handleDeploymentDone,
  handleAutoDeploy,
  handleMapConfirm,
  handleMapGoBack,
  handleSetupAttachTo,
} from './setup.js';
export {
  handleDcActivate,
  handleDcUnactivate,
  handleDcToggle,
  handleDcDeplete,
  handleDcRename,
  handleDcCcSpecial,
  handleDcCcEndOfActivation,
  handleDcCcDoubleAction,
  handleDcAction,
  handlePounceSpacePick,
  handleDcAbilityChoice,
  handleArsenalPick,
  handleEe3DiePick,
  handleFalseOrdersAction,
  handleFalseOrdersMovePick,
  handleRushPushFig,
  handleRushPushSpace,
  handleRushPushSkip,
  handleShoulderRushFig,
  handleShoulderRushSpace,
  handleShoulderRushSkip,
  handleOverwatchSpacePick,
  handleOrbitalBombardmentDeplete,
  handleOrbitalBombardmentSkip,
  handleOrbitalBombardmentSpacePick,
} from './dc-play-area.js';
export {
  handleSquadModal,
  handleDeployModal,
  handleCcAttachTo,
  handleCcPlaySelect,
  handleCcConfirmPlay,
  handleCcCancelPlay,
  handleCcDiscardSelect,
  handleDeckIllegalPlay,
  handleDeckIllegalRedo,
  handleCcShuffleDraw,
  handleCcPlay,
  handleCcDraw,
  handleCcSearchDiscard,
  handleCcCloseDiscard,
  handleCcDiscard,
  handleCcChoice,
  handleSquadSelect,
  handleIllegalCcIgnore,
  handleIllegalCcUnplay,
  handleNegationPlay,
  handleNegationLetResolve,
  handleCelebrationPlay,
  handleCelebrationPass,
  handleCcSpacePick,
} from './cc-hand.js';
export {
  handleBotmenuArchive,
  handleBotmenuKill,
  handleBotmenuArchiveYes,
  handleBotmenuArchiveNo,
  handleBotmenuKillYes,
  handleBotmenuKillNo,
} from './botmenu.js';
export { handleFastForward, handleDefenderCcPlay } from './fast-forward.js';
export { handleToughLuck, handleThereIsNoTry, handleVetInstincts, handleHunterProtocol, handleStrikeMeDown, handleSlowOnTheDraw, handleSlowOnTheDrawResume, handlePowerConverter } from './combat-reactions.js';
export { handleReactionSkip, handleReactionUse, handleRightBack, handleMasteryPick, handleInterrogatePick } from './post-combat.js';
export { handleStillFaster, handleSquadSwarm, handleOverdrive, handleSelfDestructProbe, handleSelfDestructProtocol, handleLastResort, handleScavengedWalker, handleOnDiplomatic, handleBelReorder, handleAssassinsBladePickTarget, handleSuppressiveFireMpPick, handleForceSlowPick, handleExcavationPick } from './interrupts.js';
export { handleDevaronDoorOpen, handleDevaronCratePush, handleKryknaPush } from './map-events.js';
export {
  handleBleedResolve,
  handleSidewinderApply, handleSidewinderSkip,
  handleBoltslingerTarget, handleBoltslingerSkip,
  handleIndiscriminateFireDie, handleIndiscriminateFireSkip,
  handleFightingKnifeTarget, handleFightingKnifeSkip,
  handleConcussiveBoltPush, handleConcussiveBoltSkip,
  handleSpreadThePainFigPick, handleSpreadThePainSkip,
  handleMissileSalvoDie, handleMissileSalvoDone,
} from './combat-special-effects.js';
