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
import { handleEndEndOfRound, handleEndStartOfRound, runStartOfRoundDcEffects, runStatusPhaseAfterEndOfRound, handleExtraArmorPick, handleExtraArmorConfirm, handleExtraArmorCancel, handleRbfDiscard, handleRogueOneReturn, handleImpCitadel, handleProgrammingOverride } from './round.js';
import {
  runPostDeployPhase, advancePostDeployQueue, onPostDeployMovementComplete, onExtraArmorComplete,
  handlePostDeployPick, handleSecurityDetailPick, handleStrikeTeamAdjPick,
  handleStrikeTeamTokenPick, handleStrikeTeamTokenDone,
  handlePostDeployMoveSkip,
  handleWalkerMove, handleWalkerSkip,
} from './post-deploy.js';
import { handleMoveMp, handleMoveAdjustMp, handleMovePick, handleMoveLetter, handleMoveLetterBack, handleMoveInterruptPlay, handleMoveInterruptSkip } from './movement.js';
import { handleAttackTarget, handleCombatReady, handleCombatResolveReady, handleCombatRoll, handleCombatSurge, handleCleaveTarget, handleCombatReroll, handlePreReroll, handleCombatPassive, handleCombatToken, handlePowerTokenChoice, handlePowerTokenOverflowDiscard, handleSpreadThePainCondPick, handleFigureheadDecision, handleLasatDiePick, handleLasatFacePick, handleFalseOrdersAtkPick, handleCoverFireBlock, handleCoverFireDiscard, handleGuidanceSystems, handleZilloDiscard, handleStrainChoice, handleStrainCcPick, handleUnderDuress, handleRogueOneTokenPick } from './combat.js';
import { handleStatusPhase, handlePassActivationTurn, handleEndTurn, handleDcEndActivation, handleConfirmActivate, handleCancelActivate, handleActPassive, handleFieldTacticsPick, handleForceVisionPick } from './activation.js';
import {
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
  handleAttachConfirm,
  handleAttachReselect,
  handleAttachDoneConfirm,
  handleAttachDoneRedo,
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
  handleBoRiflePick,
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
  handleBombDropSpacePick,
} from './dc-play-area.js';
import {
  handleSquadModal,
  handleDeployModal,
  handleCcAttachTo,
  handleCcPlaySelect,
  handleCcConfirmPlay,
  handleCcCancelPlay,
  handleCcDiscardSelect,
  handleSquadConfirm,
  handleSquadCancel,
  handleDeckIllegalPlay,
  handleDeckIllegalRedo,
  handleCcShuffleDraw,
  handleIKnowEverythingKeep,
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
  handleCommDisruptionPlay,
  handleCommDisruptionSkip,
} from './cc-hand.js';
import {
  handleBotmenuKill,
  handleBotmenuKillYes,
  handleBotmenuKillNo,
} from './botmenu.js';
import { handleBotmenuRecover } from './recover.js';
import { handlePhaseGateReady, handlePhaseGateUnready, sendPhaseGateMessages } from './phase-gate.js';
import { handleFastForward, handleDefenderCcPlay } from './fast-forward.js';
import { handleToughLuck, handleThereIsNoTry, handleVetInstincts, handleHunterProtocol, handleStrikeMeDown, handleSlowOnTheDraw, handleSlowOnTheDrawResume, handlePowerConverter, handleIllicitArms, handleForceExhaustion } from './combat-reactions.js';
import { handleReactionSkip, handleReactionUse, handleRightBack, handleMasteryPick, handleInterrogatePick } from './post-combat.js';
import { handleStillFaster, handleSquadSwarm, handleOverdrive, handleSelfDestructProbe, handleSelfDestructProtocol, handleLastResort, handleScavengedWalker, handleOnDiplomatic, handleBelReorder, handleAssassinsBladePickTarget, handleSuppressiveFireMpPick, handleForceSlowPick, handleExcavationPick, handleYHSIW, handleSubmitOrFight, handleDrivenByHatred, handleBlackMarket, handlePunishingStrike, handleExecutor, handleExtraProtection } from './interrupts.js';
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
  handleHeavyFireUse, handleHeavyFireSkip,
  handleHeavyFireTarget, handleHeavyFireDone,
  handleHeavyFireCondition,
} from './combat-special-effects.js';
import { getValidGroupNames } from '../context-factory.js';

const HANDLERS = new Map();
const HANDLER_GROUPS = new Map();

function register(key, fn, group = null) {
  if (HANDLERS.has(key)) throw new Error(`Duplicate handler: ${key}`);
  if (group && !getValidGroupNames().includes(group)) {
    throw new Error(`Unknown context group "${group}" for handler "${key}"`);
  }
  HANDLERS.set(key, fn);
  if (group) HANDLER_GROUPS.set(key, group);
}

// --- Lobby & misc ---
register('lobby_join_', handleLobbyJoin, 'lobbyJoin');
register('lobby_start_', handleLobbyStart, 'lobbyStart');
register('request_resolve_', handleRequestResolve, 'requests');
register('request_reject_', handleRequestReject, 'requests');
register('refresh_map_', handleRefreshMap, 'refreshMap');
register('refresh_all_', handleRefreshAll, 'refreshAll');
register('undo_', handleUndo, 'undo');
register('kill_game_', handleKillGame, 'killGame');
register('default_deck_', handleDefaultDeck, 'defaultDeck');
register('special_done_', handleSpecialDone);
register('interact_cancel_', handleInteractCancel, 'interactCancel');
register('interact_choice_', handleInteractChoice, 'interact');

// --- Round ---
register('end_end_of_round_', handleEndEndOfRound, 'round');
register('end_start_of_round_', handleEndStartOfRound, 'startOfRound');
register('extra_armor_pick_', handleExtraArmorPick, 'round');
register('extra_armor_confirm_', handleExtraArmorConfirm, 'round');
register('extra_armor_cancel_', handleExtraArmorCancel, 'round');
register('rbf_discard_', handleRbfDiscard, 'round');
register('rogue_one_return_', handleRogueOneReturn, 'round');
register('imp_citadel_', handleImpCitadel, 'round');
register('prog_override_', handleProgrammingOverride, 'round');

// --- Post-deploy ---
register('pd_pick_', handlePostDeployPick, 'postDeploy');
register('pd_security_pick_', handleSecurityDetailPick, 'postDeploy');
register('pd_strike_adj_', handleStrikeTeamAdjPick, 'postDeploy');
register('pd_strike_token_done_', handleStrikeTeamTokenDone, 'postDeploy');
register('pd_strike_token_', handleStrikeTeamTokenPick, 'postDeploy');
register('pd_move_skip_', handlePostDeployMoveSkip, 'postDeploy');
register('pd_walker_move_', handleWalkerMove, 'postDeploy');
register('pd_walker_skip_', handleWalkerSkip, 'postDeploy');

// --- Movement ---
register('move_mp_', handleMoveMp, 'move');
register('move_adjust_mp_', handleMoveAdjustMp, 'moveAdjust');
register('move_back_letters_', handleMoveLetterBack, 'moveBackLetters');
register('move_letter_', handleMoveLetter, 'moveLetter');
register('move_pick_', handleMovePick, 'movePick');
register('mvint_play_', handleMoveInterruptPlay, 'movePick');
register('mvint_skip_', handleMoveInterruptSkip, 'movePick');

// --- Combat ---
register('attack_target_', handleAttackTarget, 'combat');
register('cleave_target_', handleCleaveTarget, 'combat');
register('cover_fire_block_', handleCoverFireBlock, 'combat');
register('cover_fire_discard_', handleCoverFireDiscard, 'combat');
register('guidance_systems_', handleGuidanceSystems, 'combat');
register('combat_resolve_ready_', handleCombatResolveReady, 'combat');
register('combat_ready_', handleCombatReady, 'combat');
register('combat_roll_', handleCombatRoll, 'combat');
register('combat_surge_', handleCombatSurge, 'combat');
register('combat_reroll_', handleCombatReroll, 'combat');
register('pre_reroll_', handlePreReroll, 'combat');
register('combat_passive_', handleCombatPassive, 'combat');
register('combat_token_', handleCombatToken, 'combat');
register('power_token_choice_', handlePowerTokenChoice, 'combat');
register('pt_overflow_', handlePowerTokenOverflowDiscard, 'combat');
register('spread_pain_cond_', handleSpreadThePainCondPick, 'combat');
register('rogue_one_token_', handleRogueOneTokenPick, 'combat');
register('figurehead_use_', handleFigureheadDecision, 'combat');
register('figurehead_skip_', handleFigureheadDecision, 'combat');
register('lasat_die_', handleLasatDiePick, 'combat');
register('lasat_face_', handleLasatFacePick, 'combat');
register('false_orders_action_', handleFalseOrdersAction, 'dcPlayArea');
register('false_orders_space_', handleFalseOrdersMovePick, 'dcPlayArea');
register('false_orders_atk_', handleFalseOrdersAtkPick, 'combat');
register('zillo_discard_skip_', handleZilloDiscard, 'combat');
register('zillo_discard_', handleZilloDiscard, 'combat');
register('strain_choice_alldmg_', handleStrainChoice, 'combat');
register('strain_choice_discard_', handleStrainChoice, 'combat');
register('strain_cc_pick_', handleStrainCcPick, 'combat');
register('ud_deplete_use_', handleUnderDuress, 'combat');
register('ud_deplete_skip_', handleUnderDuress, 'combat');

// --- Activation ---
register('act_passive_', handleActPassive, 'activation');
register('status_phase_', handleStatusPhase, 'activation');
register('pass_activation_turn_', handlePassActivationTurn, 'activation');
register('end_turn_', handleEndTurn, 'activation');
register('dc_end_activation_', handleDcEndActivation, 'activation');
register('confirm_activate_', handleConfirmActivate, 'activation');
register('cancel_activate_', handleCancelActivate, 'activation');
register('field_tactics_pick_', handleFieldTacticsPick, 'activation');
register('fv_pick_', handleForceVisionPick, 'activation');

// --- Setup ---
register('map_selection_', handleMapSelection, 'setup');
register('map_type_', handleMapTypeChoice, 'setup');
register('draft_random_', handleDraftRandom, 'setup');
register('determine_initiative_', handleDetermineInitiative, 'setup');
register('deployment_zone_red_', handleDeploymentZone, 'setup');
register('deployment_zone_blue_', handleDeploymentZone, 'setup');
register('deployment_fig_', handleDeploymentFig, 'setup');
register('deployment_orient_', handleDeploymentOrient, 'setup');
register('deploy_pick_', handleDeployPick, 'setup');
register('deploy_row_back_', handleDeployRowBack, 'setup');
register('deploy_row_', handleDeployRow, 'setup');
register('loadout_pick_', handleLoadoutPick, 'setup');
register('form_pick_', handleFormPick, 'setup');
register('deployment_done_', handleDeploymentDone, 'setup');
register('auto_deploy_', handleAutoDeploy, 'setup');
register('map_confirm_', handleMapConfirm, 'setup');
register('map_goback_', handleMapGoBack, 'setup');
register('setup_attach_to_', handleSetupAttachTo, 'setup');
register('attach_confirm_', handleAttachConfirm, 'setup');
register('attach_reselect_', handleAttachReselect, 'setup');
register('attach_done_confirm_', handleAttachDoneConfirm, 'setup');
register('attach_done_redo_', handleAttachDoneRedo, 'setup');

// --- DC Play Area ---
register('dc_activate_', handleDcActivate, 'dcPlayArea');
register('dc_unactivate_', handleDcUnactivate, 'dcPlayArea');
register('dc_toggle_', handleDcToggle, 'dcPlayArea');
register('dc_deplete_', handleDcDeplete, 'dcPlayArea');
register('dc_rename_', handleDcRename, 'dcPlayArea');
register('dc_cc_special_', handleDcCcSpecial, 'dcPlayArea');
register('dc_cc_eoa_', handleDcCcEndOfActivation, 'dcPlayArea');
register('dc_cc_double_', handleDcCcDoubleAction, 'dcPlayArea');
register('pounce_space_', handlePounceSpacePick, 'dcPlayArea');
register('rush_push_fig_', handleRushPushFig, 'dcPlayArea');
register('rush_push_space_', handleRushPushSpace, 'dcPlayArea');
register('rush_push_skip_', handleRushPushSkip, 'dcPlayArea');
register('shoulder_rush_fig_', handleShoulderRushFig, 'dcPlayArea');
register('shoulder_rush_space_', handleShoulderRushSpace, 'dcPlayArea');
register('shoulder_rush_skip_', handleShoulderRushSkip, 'dcPlayArea');
register('overwatch_space_', handleOverwatchSpacePick, 'dcPlayArea');
register('ob_deplete_', handleOrbitalBombardmentDeplete, 'dcPlayArea');
register('ob_skip_', handleOrbitalBombardmentSkip, 'dcPlayArea');
register('ob_space_', handleOrbitalBombardmentSpacePick, 'dcPlayArea');
register('bomb_drop_space_', handleBombDropSpacePick, 'dcPlayArea');
register('dc_move_', (i, ctx) => handleDcAction(i, ctx, 'dc_move_'), 'dcPlayArea');
register('dc_attack_', (i, ctx) => handleDcAction(i, ctx, 'dc_attack_'), 'dcPlayArea');
register('dc_interact_', (i, ctx) => handleDcAction(i, ctx, 'dc_interact_'), 'dcPlayArea');
register('dc_special_', (i, ctx) => handleDcAction(i, ctx, 'dc_special_'), 'dcPlayArea');
register('dc_ability_choice_', handleDcAbilityChoice, 'dcPlayArea');
register('ee3_pick_die_', handleEe3DiePick, 'dcPlayArea');
register('bo_rifle_pick_', handleBoRiflePick, 'dcPlayArea');

// --- CC Hand ---
register('squad_confirm_', handleSquadConfirm, 'ccHand');
register('squad_cancel_', handleSquadCancel, 'ccHand');
register('deck_illegal_play_', handleDeckIllegalPlay, 'ccHand');
register('deck_illegal_redo_', handleDeckIllegalRedo, 'ccHand');
register('cc_shuffle_draw_', handleCcShuffleDraw, 'ccHand');
register('ike_keep_', handleIKnowEverythingKeep, 'ccHand');
register('cc_play_', handleCcPlay, 'ccHand');
register('cc_confirm_play_', handleCcConfirmPlay, 'ccHand');
register('cc_cancel_play_', handleCcCancelPlay, 'ccHand');
register('cc_draw_', handleCcDraw, 'ccHand');
register('cc_search_discard_', handleCcSearchDiscard, 'ccHand');
register('cc_close_discard_', handleCcCloseDiscard, 'ccHand');
register('cc_discard_', handleCcDiscard, 'ccHand');
register('cc_choice_', handleCcChoice, 'ccHand');
register('cc_space_', handleCcSpacePick, 'ccHand');
register('squad_select_', handleSquadSelect, 'ccHand');
register('illegal_cc_ignore_', handleIllegalCcIgnore, 'ccHand');
register('illegal_cc_unplay_', handleIllegalCcUnplay, 'ccHand');
register('negation_play_', handleNegationPlay, 'ccHand');
register('negation_let_resolve_', handleNegationLetResolve, 'ccHand');
register('celebration_play_', handleCelebrationPlay, 'ccHand');
register('celebration_pass_', handleCelebrationPass, 'ccHand');
register('comm_disruption_play_', handleCommDisruptionPlay, 'ccHand');
register('comm_disruption_skip_', handleCommDisruptionSkip, 'ccHand');

// --- Phase gate ---
register('phase_gate_ready_', handlePhaseGateReady, 'phaseGate');
register('phase_gate_unready_', handlePhaseGateUnready, 'phaseGate');

// --- Botmenu ---
register('botmenu_recover_', handleBotmenuRecover, 'recover');
register('botmenu_kill_', handleBotmenuKill, 'botmenu');
register('botmenu_kill_yes_', handleBotmenuKillYes, 'botmenu');
register('botmenu_kill_no_', handleBotmenuKillNo, 'botmenu');

// --- Fast-forward & defender CC ---
register('fast_forward_', handleFastForward, 'fastForward');
register('dc_cc_defender_', handleDefenderCcPlay, 'defenderCc');

// --- Combat reactions ---
register('tough_luck_remove_', handleToughLuck, 'combatReactions');
register('tough_luck_skip_', handleToughLuck, 'combatReactions');
register('there_is_no_try_die_', handleThereIsNoTry, 'combatReactions');
register('there_is_no_try_face_', handleThereIsNoTry, 'combatReactions');
register('there_is_no_try_skip_', handleThereIsNoTry, 'combatReactions');
register('vet_instincts_pick_', handleVetInstincts, 'combatReactions');
register('hunter_protocol_trigger_', handleHunterProtocol, 'combatReactions');
register('hunter_protocol_skip_', handleHunterProtocol, 'combatReactions');
register('strike_me_down_yes_', handleStrikeMeDown, 'combatReactions');
register('strike_me_down_no_', handleStrikeMeDown, 'combatReactions');
register('slow_on_draw_yes_', handleSlowOnTheDraw, 'combatReactions');
register('slow_on_draw_no_', handleSlowOnTheDraw, 'combatReactions');
register('slow_on_draw_resume_', handleSlowOnTheDrawResume, 'combatReactions');
register('power_converter_approve_', handlePowerConverter, 'combatReactions');
register('power_converter_skip_', handlePowerConverter, 'combatReactions');
register('power_converter_die_', handlePowerConverter, 'combatReactions');
register('power_converter_color_', handlePowerConverter, 'combatReactions');
register('illicit_arms_use_', handleIllicitArms, 'combatReactions');
register('illicit_arms_skip_', handleIllicitArms, 'combatReactions');
register('illicit_arms_pick_', handleIllicitArms, 'combatReactions');
register('force_exhaustion_yes_', handleForceExhaustion, 'combatReactions');
register('force_exhaustion_no_', handleForceExhaustion, 'combatReactions');

// --- Post-combat ---
register('reaction_skip_', handleReactionSkip, 'postCombat');
register('reaction_use_', handleReactionUse, 'postCombat');
register('right_back_block_', handleRightBack, 'postCombat');
register('right_back_nodmg_', handleRightBack, 'postCombat');
register('mastery_pick_', handleMasteryPick, 'postCombat');
register('mastery_skip_', handleMasteryPick, 'postCombat');
register('interrogate_pick_', handleInterrogatePick, 'postCombat');
register('interrogate_discard_', handleInterrogatePick, 'postCombat');
register('interrogate_skip_', handleInterrogatePick, 'postCombat');

// --- Interrupts ---
register('still_faster_use_', handleStillFaster, 'interrupts');
register('still_faster_skip_', handleStillFaster, 'interrupts');
register('still_faster_dc_pick_', handleStillFaster, 'interrupts');
register('squad_swarm_yes_', handleSquadSwarm, 'interrupts');
register('squad_swarm_no_', handleSquadSwarm, 'interrupts');
register('overdrive_use_', handleOverdrive, 'interrupts');
register('self_destruct_probe_use_', handleSelfDestructProbe, 'interrupts');
register('self_destruct_probe_skip_', handleSelfDestructProbe, 'interrupts');
register('self_destruct_protocol_use_', handleSelfDestructProtocol, 'interrupts');
register('self_destruct_protocol_skip_', handleSelfDestructProtocol, 'interrupts');
register('last_resort_use_', handleLastResort, 'interrupts');
register('last_resort_skip_', handleLastResort, 'interrupts');
register('yhsiw_transfer_', handleYHSIW, 'interrupts');
register('yhsiw_damage_', handleYHSIW, 'interrupts');
register('submit_fight_use_', handleSubmitOrFight, 'interrupts');
register('submit_fight_skip_', handleSubmitOrFight, 'interrupts');
register('scavenged_walker_attack_', handleScavengedWalker, 'interrupts');
register('scavenged_walker_skip_', handleScavengedWalker, 'interrupts');
register('dbh_force_choke_', handleDrivenByHatred, 'interrupts');
register('dbh_attack_', handleDrivenByHatred, 'interrupts');
register('dbh_skip_', handleDrivenByHatred, 'interrupts');
register('on_diplomatic_', handleOnDiplomatic, 'interrupts');
register('bel_reorder_1_', handleBelReorder, 'interrupts');
register('bel_reorder_2_', handleBelReorder, 'interrupts');
register('ab_blade_pick_', handleAssassinsBladePickTarget, 'interrupts');
register('sf_mp_pick_', handleSuppressiveFireMpPick, 'interrupts');
register('ps_replace_', handlePunishingStrike, 'interrupts');
register('force_slow_pick_', handleForceSlowPick, 'interrupts');
register('excavation_pick_', handleExcavationPick, 'interrupts');
register('bm_draw_', handleBlackMarket, 'interrupts');
register('bm_discard_', handleBlackMarket, 'interrupts');
register('bm_return_', handleBlackMarket, 'interrupts');
register('bm_skip_', handleBlackMarket, 'interrupts');
register('executor_use_', handleExecutor, 'interrupts');
register('executor_skip_', handleExecutor, 'interrupts');
register('extra_protection_play_', handleExtraProtection, 'interrupts');
register('extra_protection_skip_', handleExtraProtection, 'interrupts');

// --- Map events ---
register('devaron_door_open_', handleDevaronDoorOpen, 'mapEvents');
register('devaron_crate_push_', handleDevaronCratePush, 'mapEvents');
register('krykna_push_', handleKryknaPush, 'mapEvents');

// --- Combat special effects ---
register('bleed_accept_', handleBleedResolve, 'combatSpecialEffects');
register('bleed_prevent_', handleBleedResolve, 'combatSpecialEffects');
register('sidewinder_apply_', handleSidewinderApply, 'combatSpecialEffects');
register('sidewinder_skip_', handleSidewinderSkip, 'combatSpecialEffects');
register('boltslinger_target_', handleBoltslingerTarget, 'combatSpecialEffects');
register('boltslinger_skip_', handleBoltslingerSkip, 'combatSpecialEffects');
register('indiscriminate_die_', handleIndiscriminateFireDie, 'combatSpecialEffects');
register('indiscriminate_skip_', handleIndiscriminateFireSkip, 'combatSpecialEffects');
register('fighting_knife_target_', handleFightingKnifeTarget, 'combatSpecialEffects');
register('fighting_knife_skip_', handleFightingKnifeSkip, 'combatSpecialEffects');
register('concussive_bolt_push_', handleConcussiveBoltPush, 'combatSpecialEffects');
register('concussive_bolt_skip_', handleConcussiveBoltSkip, 'combatSpecialEffects');
register('spread_pain_fig_', handleSpreadThePainFigPick, 'combatSpecialEffects');
register('spread_pain_skip_', handleSpreadThePainSkip, 'combatSpecialEffects');
register('missile_salvo_die_', handleMissileSalvoDie, 'combatSpecialEffects');
register('missile_salvo_done_', handleMissileSalvoDone, 'combatSpecialEffects');
register('heavy_fire_use_', handleHeavyFireUse, 'combatSpecialEffects');
register('heavy_fire_skip_', handleHeavyFireSkip, 'combatSpecialEffects');
register('heavy_fire_tgt_done_', handleHeavyFireDone, 'combatSpecialEffects');
register('heavy_fire_tgt_', handleHeavyFireTarget, 'combatSpecialEffects');
register('heavy_fire_cond_', handleHeavyFireCondition, 'combatSpecialEffects');

// --- Select-menu handlers (dispatched via table-driven select dispatch in index.js) ---
register('arsenal_pick_', handleArsenalPick, 'dcPlayArea');
register('map_selection_draw_', handleMapSelectionDraw, 'setup');
register('map_selection_pick_', handleMapSelectionPick, 'setup');
register('cc_attach_to_', handleCcAttachTo, 'ccHand');
register('cc_play_select_', handleCcPlaySelect, 'ccHand');
register('cc_discard_select_', handleCcDiscardSelect, 'ccHand');

/**
 * Return the handler for the given key (prefix), or null if none.
 * @param {string} handlerKey - e.g. 'lobby_join_', 'dc_activate_'
 * @returns {((interaction: import('discord.js').Interaction, context: object) => Promise<void>)|null}
 */
export function getHandler(handlerKey) {
  return HANDLERS.get(handlerKey) ?? null;
}

/** Return all registered handler prefixes (used by router.js to auto-derive BUTTON_PREFIXES). */
export function getRegisteredButtonPrefixes() {
  return [...HANDLERS.keys()];
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
export { handleEndEndOfRound, handleEndStartOfRound, runStartOfRoundDcEffects, runStatusPhaseAfterEndOfRound, handleExtraArmorPick, handleExtraArmorConfirm, handleExtraArmorCancel, handleRbfDiscard, handleRogueOneReturn, handleImpCitadel, handleProgrammingOverride } from './round.js';
export {
  runPostDeployPhase, advancePostDeployQueue, onPostDeployMovementComplete, onExtraArmorComplete,
  handlePostDeployPick, handleSecurityDetailPick, handleStrikeTeamAdjPick,
  handleStrikeTeamTokenPick, handleStrikeTeamTokenDone,
  handlePostDeployMoveSkip,
  handleWalkerMove, handleWalkerSkip,
} from './post-deploy.js';
export { handleMoveMp, handleMoveAdjustMp, handleMovePick, handleMoveLetter, handleMoveLetterBack, handleMoveInterruptPlay, handleMoveInterruptSkip } from './movement.js';
export { handleAttackTarget, handleCleaveTarget, handleCoverFireBlock, handleCoverFireDiscard, handleGuidanceSystems, handleCombatReady, handleCombatResolveReady, handleCombatRoll, handleCombatSurge, handleCombatReroll, handlePreReroll, handleCombatPassive, handleCombatToken, handlePowerTokenChoice, handlePowerTokenOverflowDiscard, sendPowerTokenOverflowUI, handleSpreadThePainCondPick, handleFigureheadDecision, handleLasatDiePick, handleLasatFacePick, handleFalseOrdersAtkPick, sendRerollUI, proceedAfterRerolls, sendReadyToResolveRolls, handleStrainChoice, handleStrainCcPick, handleRogueOneTokenPick } from './combat.js';
export { handleStatusPhase, handlePassActivationTurn, handleEndTurn, handleDcEndActivation, handleConfirmActivate, handleCancelActivate, handleActPassive, handleFieldTacticsPick, handleForceVisionPick } from './activation.js';
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
  handleAttachConfirm,
  handleAttachReselect,
  handleAttachDoneConfirm,
  handleAttachDoneRedo,
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
  handleBoRiflePick,
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
  handleBombDropSpacePick,
} from './dc-play-area.js';
export {
  handleSquadModal,
  handleDeployModal,
  handleCcAttachTo,
  handleCcPlaySelect,
  handleCcConfirmPlay,
  handleCcCancelPlay,
  handleCcDiscardSelect,
  handleSquadConfirm,
  handleSquadCancel,
  handleDeckIllegalPlay,
  handleDeckIllegalRedo,
  handleCcShuffleDraw,
  handleIKnowEverythingKeep,
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
  handleBotmenuKill,
  handleBotmenuKillYes,
  handleBotmenuKillNo,
} from './botmenu.js';
export { handleBotmenuRecover, runRecovery } from './recover.js';
export { handlePhaseGateReady, handlePhaseGateUnready, sendPhaseGateMessages } from './phase-gate.js';
export { getWaitingPlayers } from '../game/phase-gate.js';
export { handleFastForward, handleDefenderCcPlay } from './fast-forward.js';
export { handleToughLuck, handleThereIsNoTry, handleVetInstincts, handleHunterProtocol, handleStrikeMeDown, handleSlowOnTheDraw, handleSlowOnTheDrawResume, handlePowerConverter, handleIllicitArms } from './combat-reactions.js';
export { handleReactionSkip, handleReactionUse, handleRightBack, handleMasteryPick, handleInterrogatePick } from './post-combat.js';
export { handleStillFaster, handleSquadSwarm, handleOverdrive, handleSelfDestructProbe, handleSelfDestructProtocol, handleLastResort, handleScavengedWalker, handleOnDiplomatic, handleBelReorder, handleAssassinsBladePickTarget, handleSuppressiveFireMpPick, handleForceSlowPick, handleExcavationPick, handleYHSIW, handleSubmitOrFight, handleDrivenByHatred, handleBlackMarket, handlePunishingStrike, handleExecutor, handleExtraProtection } from './interrupts.js';
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
  handleHeavyFireUse, handleHeavyFireSkip,
  handleHeavyFireTarget, handleHeavyFireDone,
  handleHeavyFireCondition,
} from './combat-special-effects.js';
