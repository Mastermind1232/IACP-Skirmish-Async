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
  handleClearStaleCombat,
} from './game-tools.js';
import { handleSpecialDone } from './special.js';
import { handleInteractCancel, handleInteractChoice } from './interact.js';
import { handleEndEndOfRound, handleEndStartOfRound, handleSorMissionReveal, runStartOfRoundDcEffects, runStartOfRoundContinuation, runStatusPhaseAfterEndOfRound, handleExtraArmorPick, handleExtraArmorConfirm, handleExtraArmorCancel, handleRbfDiscard, handleRogueOneReturn, handleImpCitadel, handleProgrammingOverride, handleCtfPick, handleCtfStrain, handleDoubtFigPick, handleDoubtRemove, handleSmugglingCompartmentReorder, resolveStartOfRoundEffect, handleSpectreCellDist } from './round.js';
import {
  runPostDeployPhase, advancePostDeployQueue, onPostDeployMovementComplete, onExtraArmorComplete,
  cleanupCompanionEmbedDeps, createCompanionDcEmbed,
  handlePostDeployPick, handleSecurityDetailPick, handleStrikeTeamAdjPick,
  handleStrikeTeamTokenPick, handleStrikeTeamTokenDone,
  handlePostDeployMoveStay, handleSmoothLandingPick,
  handleWalkerMove, handleWalkerSkip,
  handleArmsDistFigPick, handleArmsDistTokenPick,
  handleSetYourSightsPick,
  handleCompanionDeployPick,
} from './post-deploy.js';
import { handleMoveMp, handleMoveAdjustMp, handleMovePick, handleMoveStepModeToggle, handleMoveInterruptPlay, handleMoveInterruptSkip, handleOverwatchInterruptUse, handleOverwatchInterruptSkip, handleDioFollowPick, handleDioStay, handleMassivePushSpace, handleMassivePushFigure } from './movement.js';
import { handleThugPick, handleThugDest } from './thug-movement.js';
import { handleMoveXStep, handleMoveXRotate, handleMoveXDone, handleMoveXSeqPick, handleGrantedMoveX, handleOnAMissionPush } from './move-x-handler.js';
import { handleAttackTarget, handleTargetSquarePick, handleCombatResolveReady, handleCombatRoll, handleCombatSurge, handleCleaveTarget, handleCombatReroll, handleCombatRerollYn, handleCombatModsYn, handleCrossTrainingReroll, handlePreReroll, handleCombatPassive, handleCombatToken, handlePowerTokenChoice, handlePowerTokenOverflowDiscard, handleSpreadThePainCondPick, handleLasatDiePick, handleLasatFacePick, handleFalseOrdersAtkPick, handleCoverFireBlock, handleCoverFireDiscard, handleGuidanceSystems, handleZilloDiscard, handleZilloUseYes, handleZilloPierceCancel, handleDemoralizingMonologueReveal, handleStrainChoice, handleUnderDuress, handleRogueOneTokenPick, handleCombatGateReady, handleUnhingedDirectorChoice, handleDbhPickDie, handleOnDeclareDieSwap, handleBlFriendlyPick, handleCqDefPick, handleMtlFacePick, handleMerciless, handleFlawlessDie, handleFlawlessToken, handleModsPick, handleModsSubChoice, handleToughLuckGate, handleDonGate } from './combat.js';
import { handleAarFire, handleAarDone } from './after-attack-resolve.js';
import { handleStatusPhase, handlePassActivationTurn, handleEndTurn, handleDcEndActivation, handleClanOfTwoTeleport, handleDcSwitchFig, handleConfirmActivate, handleCancelActivate, handleActPassive, handleFieldTacticsPick, handleForceVisionPick, handleLiaDeployZone, handleHeroicEffortReturn, handleScavWeaponTransfer, handleScFigPick, handleHairTriggerUse, handleHairTriggerSkip, handleItWillBeAlrightUse, handleItWillBeAlrightSkip, handleItWillBeAlrightPick, handleItWillBeAlrightAction } from './activation.js';
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
  handleLoadoutSelect,
  handleLoadoutConfirm,
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
  startDeploymentAfterAttachments,
  _sendAttachmentDropdown,
  _sendAttachDonePrompt,
} from './setup.js';
import {
  handleBlitzGroupSelect,
  handleBlitzPass,
  handleBlitzMoveFig,
  handleBlitzMovePick,
  handleBlitzMoveDone,
} from './blitz-deploy.js';
import {
  handleDcActivate,
  handleDcUnactivate,
  handleDcToggle,
  handleDcDeplete,
  handleDcRename,
  handleDcRemoveStun,
  handleDcRemoveBleed,
  handleDcDoneImmediateMp,
  handleDcCcSpecial,
  handleDcCcEndOfActivation,
  handleDcCcDoubleAction,
  handleDcAction,
  handleDcHeroicAttack,
  handleDcBoRifleAttack,
  handleDcWaSlam,
  handleDcEndFigure,
  handleDcFigPick,
  handleGrantedAttack,
  handleGrantedMove,
  handlePounceSpacePick,
  handlePounceSkipPush,
  handleDcAbilityChoice,
  handleArsenalPick,
  handleEe3DiePick,
  handleVanguardDiePick,
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
import { handleSoaPick, handleSoaFire, handleSoaSkipAll } from './soa-handler.js';
import { handleEoaPick, handleEoaFire, handleEoaSkipAll } from './eoa-handler.js';
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
  handleIllegalCcIgnore,
  handleIllegalCcUnplay,
  handleCelebrationPlay,
  handleCelebrationPass,
  handleExcavationPlay,
  handleScCcOpen,
  handleScCcSkip,
  handleScCcConfirm,
  handleCcCounterNegate,
  handleCcCounterComms,
  handleCcCounterPass,
} from './cc-hand.js';
import {
  handleBotmenuKill,
  handleBotmenuKillYes,
  handleBotmenuKillNo,
  handleForfeit,
  handleForfeitYes,
  handleForfeitNo,
} from './botmenu.js';
import {
  handleCheckpointSavePrompt,
  handleCheckpointSaveModal,
  handleCheckpointNewGameOpen,
  handleCheckpointNewGamePick,
  handleCheckpointNewGameConfirm,
  handleCheckpointNewGameBack,
  handleCheckpointInGameOpen,
  handleCheckpointInGamePick,
  handleCheckpointInGameConfirm,
  handleCheckpointInGameBack,
} from './checkpoint.js';
import { handleBotmenuRecover, handleResync } from './recover.js';
import { handlePhaseGateReady, handlePhaseGateUnready, sendPhaseGateMessages } from './phase-gate.js';
import { handleFastForward, handleDefenderCcPlay } from './fast-forward.js';
import { handleThereIsNoTry, handleVetInstincts, handleHunterProtocol, handleStrikeMeDown, handleSlowOnTheDraw, handleSlowOnTheDrawResume, handlePowerConverter, handleIllicitArms, handleForceExhaustion, handleForceExhaustionDiePick, handleDoubtReroll, handleLastStandPick, handleErgPick, handleForceIsWithMe } from './combat-reactions.js';
import { handleReactionSkip, handleReactionUse, handleRightBack, handleMasteryPick, handleMilitaryEfficiencyPick, handleInterrogatePick, handleScInterrogateOpen, handleScInterrogateSkip, handleScInterrogateConfirm } from './post-combat.js';
import { handleStillFaster, handleSquadSwarm, handleOverdrive, handleSelfDestructProbe, handleSelfDestructProtocol, handleLastResort, handleScavengedWalker, handleMortarEor, handleOnDiplomatic, handleBelReorder, handleAssassinsBladePickTarget, handleSuppressiveFireMpPick, handleSuppressiveFireOptin, handleForceSlowPick, handleExcavationPick, handleYHSIW, handleDrivenByHatred, handleDbhPostMove, handleRogueSmuggler, handleWildBeastTrample, handleBlackMarket, handlePunishingStrike, handleExecutor, handleExtraProtection, handleFindsmanMeditation } from './interrupts.js';
import { handleHuntDissentPick } from './hunt-dissent.js';
import { handleAdaptBlaisePick } from './blaise-adapt.js';
import { handleDefeatPick } from './defeat-pick.js';
import { handleFirePartingShot, handleSkipPartingShot } from './parting-shot.js';
import { handleFireFinalStand, handleSkipFinalStand } from './final-stand.js';
import {
  handleFireDyingLunge, handleSkipDyingLunge,
  handlePlayMiracleWorker, handleSkipMiracleWorker,
  handlePlayPreservationProtocol, handleSkipPreservationProtocol,
} from './before-defeated-ccs.js';
import {
  handlePlayDefeatCcPrompt, handleSkipDefeatCcPrompt,
  handleDefeatCcTargetPick, handleDefeatCcModePick,
} from './defeat-cc-prompts.js';
import { handleFastLearnerPickNamed, handleFastLearnerPickMara } from './fast-learner-picker.js';
import { handleSpacesMoveInterruptPlay, handleSpacesMoveInterruptSkip, handleSpacesMoveInterruptContinue } from './move-interrupts-handler.js';
import { handleStrainUdDeplete, handleStrainUdSkip, handleStrainChoiceDamage, handleStrainChoiceDiscard, handleStrainChoicePaz, handleFigureheadStrainDecision, applyStrain, handleScHeadhunterOpen, handleScHeadhunterSkip, handleScHeadhunterConfirm } from './strain-handler.js';
import { handleDevaronDoorOpen, handleDevaronCratePush, handleDevaronCrateDone, handleKryknaPush, handleKryknaPlace, handleKryknaPlaceSkip, handleKryknaPlacePick, handleFluctuationSwap, handleFluctuationSkip, handleArmsDistributePick, handleArmsDistributeSkip, handlePrototypePick, handlePrototypeSkip, handlePrototypeDestPick } from './map-events.js';
import {
  handleFavSave, handleFavRemove, handleFavRename,
  handleFavChoose, handleFavChooseSelect,
  handleFavListSelect, handleFavListRename, handleFavListRemove, handleFavListBack,
  handleFavNameModal, handleFavRenameModal, handleFavListRenameModal,
  buildFavoritesListPayload,
} from './favorites.js';
import {
  handleBleedResolve,
  handleSidewinderApply, handleSidewinderSkip,
  handleBoltslingerTarget, handleBoltslingerSkip,
  handleIndiscriminateFireDie, handleIndiscriminateFireSkip,
  handleFightingKnifeTarget, handleFightingKnifeSkip,
  handleConcussiveBoltPush, handleConcussiveBoltSkip,
  handleDurasteelPush,
  handleSpreadThePainFigPick, handleSpreadThePainSkip,
  handleMissileSalvoDie, handleMissileSalvoDone,
  handleHeavyFireUse, handleHeavyFireSkip,
  handleHeavyFireTarget, handleHeavyFireDone,
  handleHeavyFireCondition,
  handleHavocShotUse, handleHavocShotSkip, handleHavocShotPick, handleHavocShotDone,
  handleDeflectPick, handleDeflectSkip,
  handleWantonUse, handleWantonCcPick, handleWantonPick, handleWantonDone, handleWantonSkip,
} from './combat-special-effects.js';
import { handleSpaceRow, handleSpaceRowBack } from './space-picker.js';
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
register('clear_stale_combat_', handleClearStaleCombat, 'clearStaleCombat');
register('undo_', handleUndo, 'undo');
register('kill_game_', handleKillGame, 'killGame');
register('default_deck_', handleDefaultDeck, 'defaultDeck');
register('special_done_', handleSpecialDone);
register('interact_cancel_', handleInteractCancel, 'interactCancel');
register('interact_choice_', handleInteractChoice, 'interact');

// --- Round ---
register('end_end_of_round_', handleEndEndOfRound, 'round');
register('end_start_of_round_', handleEndStartOfRound, 'startOfRound');
register('sor_mission_reveal_', handleSorMissionReveal, 'round');
register('extra_armor_pick_', handleExtraArmorPick, 'round');
register('extra_armor_confirm_', handleExtraArmorConfirm, 'round');
register('extra_armor_cancel_', handleExtraArmorCancel, 'round');
register('rbf_discard_', handleRbfDiscard, 'round');
register('rogue_one_return_', handleRogueOneReturn, 'round');
register('ctf_pick_', handleCtfPick, 'round');
register('ctf_strain_', handleCtfStrain, 'round');
register('sc_reorder_', handleSmugglingCompartmentReorder, 'round');
register('imp_citadel_', handleImpCitadel, 'round');
register('spectre_cell_dist_', handleSpectreCellDist, 'round');
register('prog_override_', handleProgrammingOverride, 'round');
register('doubt_fig_', handleDoubtFigPick, 'round');
register('doubt_remove_', handleDoubtRemove, 'round');

// --- Post-deploy ---
register('pd_pick_', handlePostDeployPick, 'postDeploy');
register('pd_security_pick_', handleSecurityDetailPick, 'postDeploy');
register('pd_strike_adj_', handleStrikeTeamAdjPick, 'postDeploy');
register('pd_strike_token_done_', handleStrikeTeamTokenDone, 'postDeploy');
register('pd_strike_token_', handleStrikeTeamTokenPick, 'postDeploy');
register('pd_move_stay_', handlePostDeployMoveStay, 'postDeploy');
register('pd_sl_pick_', handleSmoothLandingPick, 'postDeploy');
register('pd_walker_move_', handleWalkerMove, 'postDeploy');
register('pd_walker_skip_', handleWalkerSkip, 'postDeploy');
register('pd_arms_dist_fig_', handleArmsDistFigPick, 'postDeploy');
register('pd_arms_dist_token_', handleArmsDistTokenPick, 'postDeploy');
register('pd_set_your_sights_pick_', handleSetYourSightsPick, 'postDeploy');
register('pd_comp_space_', handleCompanionDeployPick, 'postDeploy');

// --- Movement ---
register('move_mp_', handleMoveMp, 'move');
register('move_adjust_mp_', handleMoveAdjustMp, 'moveAdjust');
register('move_pick_', handleMovePick, 'movePick');
register('move_stepmode_', handleMoveStepModeToggle, 'movePick');
register('massive_push_space_', handleMassivePushSpace, 'movePick');
register('massive_push_figure_', handleMassivePushFigure, 'movePick');
register('thug_pick_', handleThugPick, 'thugMove');
register('thug_dest_', handleThugDest, 'thugMove');
register('mvint_play_', handleMoveInterruptPlay, 'movePick');
register('mvint_skip_', handleMoveInterruptSkip, 'movePick');
register('ow_interrupt_use_', handleOverwatchInterruptUse, 'movePick');
register('ow_interrupt_skip_', handleOverwatchInterruptSkip, 'movePick');
register('dio_follow_pick_', handleDioFollowPick, 'movePick');
register('dio_stay_', handleDioStay, 'movePick');
register('move_x_step_', handleMoveXStep, 'moveX');
register('move_x_rotate_', handleMoveXRotate, 'moveX');
register('move_x_done_', handleMoveXDone, 'moveX');
register('move_x_seq_pick_', handleMoveXSeqPick, 'moveX');
register('granted_move_x_', handleGrantedMoveX, 'moveX');
register('on_a_mission_push_', handleOnAMissionPush, 'moveX');

// --- Combat ---
register('attack_target_', handleAttackTarget, 'combat');
register('attack_tgtsq_', handleTargetSquarePick, 'combat'); // large-target square declaration
register('cleave_target_', handleCleaveTarget, 'combat');
register('cover_fire_block_', handleCoverFireBlock, 'combat');
register('cover_fire_discard_', handleCoverFireDiscard, 'combat');
register('guidance_systems_', handleGuidanceSystems, 'combat');
register('combat_resolve_ready_', handleCombatResolveReady, 'combat');
register('combat_gate_', handleCombatGateReady, 'combat');
register('aar_fire_', handleAarFire, 'postCombat');
register('aar_done_atk_', handleAarDone, 'postCombat');
register('aar_done_def_', handleAarDone, 'postCombat');
register('combat_roll_', handleCombatRoll, 'combat');
register('dbh_pick_die_', handleDbhPickDie, 'combat');
register('combat_surge_', handleCombatSurge, 'combat');
register('combat_reroll_yn_', handleCombatRerollYn, 'combat');
register('combat_reroll_', handleCombatReroll, 'combat');
register('combat_mods_yn_', handleCombatModsYn, 'combat');
register('merciless_use_', handleMerciless, 'combat');
register('merciless_skip_', handleMerciless, 'combat');
register('flawless_die_', handleFlawlessDie, 'combat');
register('flawless_token_', handleFlawlessToken, 'combat');
register('ct_reroll_', handleCrossTrainingReroll, 'combat');
register('pre_reroll_', handlePreReroll, 'combat');
register('combat_passive_', handleCombatPassive, 'combat');
register('combat_mods_pick_', handleModsPick, 'combat');
// Generic gate pick handler also serves the other attack windows (alexanbv
// 2026-06-15 "build the WHOLE sequence with all the gates"). handleModsPick
// recovers the window from the per-window prefix.
register('combat_ondeclare_pick_', handleModsPick, 'combat');
register('combat_rerolls_pick_', handleModsPick, 'combat');
register('combat_afterresolve_pick_', handleModsPick, 'combat');
register('combat_special_pick_', handleModsPick, 'combat');
register('combat_modsub_', handleModsSubChoice, 'combat');
// Tough Luck gate reaction (generic post-reroll: attack die → defender, defense
// die → attacker may remove the rerolled die's result). alexanbv 2026-06-17.
register('tlgate_remove_', handleToughLuckGate, 'combat');
register('tlgate_skip_', handleToughLuckGate, 'combat');
// Double or Nothing (CSV row 625): discrete post-reroll Double/Cancel/Decline
// reaction routed to the CC controller (mirrors tlgate_*). alexanbv 2026-06-20.
register('dongate_double_', handleDonGate, 'combat');
register('dongate_cancel_', handleDonGate, 'combat');
register('dongate_skip_', handleDonGate, 'combat');
register('combat_token_', handleCombatToken, 'combat');
register('od_dieswap_', handleOnDeclareDieSwap, 'combat');
register('def_remove_pick_', handleCqDefPick, 'combat');
register('mtl_face_', handleMtlFacePick, 'combat');
register('bl_friendly_', handleBlFriendlyPick, 'combat');
register('unhinged_director_', handleUnhingedDirectorChoice, 'combat');
// Unhinged Director Strain absorb handler RETIRED 2026-05-09 — the
// custom CC-vs-damage prompt duplicated applyStrain's per-strain
// choice. Strain now flows through the canonical applyStrain pipeline
// at the +2 click site (handleUnhingedDirectorChoice).
register('power_token_choice_', handlePowerTokenChoice, 'combat');
register('pt_overflow_', handlePowerTokenOverflowDiscard, 'combat');
register('spread_pain_cond_', handleSpreadThePainCondPick, 'combat');
register('rogue_one_token_', handleRogueOneTokenPick, 'combat');
// Figurehead is a STRAIN reaction (alexanbv 2026-06-20), prompted from the
// applyStrain pipeline → resolved in the interrupts ctx (strain-handler.js).
register('figurehead_use_', handleFigureheadStrainDecision, 'interrupts');
register('figurehead_skip_', handleFigureheadStrainDecision, 'interrupts');
register('lasat_die_', handleLasatDiePick, 'combat');
register('lasat_face_', handleLasatFacePick, 'combat');
register('false_orders_action_', handleFalseOrdersAction, 'dcPlayArea');
register('false_orders_space_', handleFalseOrdersMovePick, 'dcPlayArea');
register('false_orders_atk_', handleFalseOrdersAtkPick, 'combat');
register('zillo_discard_skip_', handleZilloDiscard, 'combat');
register('zillo_discard_', handleZilloDiscard, 'combat');
register('zillo_use_yes_', handleZilloUseYes, 'combat');
register('zillo_pierce_use_', handleZilloPierceCancel, 'combat');
register('zillo_pierce_skip_', handleZilloPierceCancel, 'combat');
register('demoralizing_reveal_use_', handleDemoralizingMonologueReveal, 'combat');
register('demoralizing_reveal_skip_', handleDemoralizingMonologueReveal, 'combat');
// Legacy strain prompt handlers (strain_choice_alldmg_, strain_choice_discard_,
// ud_deplete_use_, ud_deplete_skip_) retired in slice 8 of the strain
// migration (destruct 2026-05-06). All voluntary strain now routes through
// applyStrain → strain_resolve_*. The legacy functions remain in
// handlers/combat.js for any in-flight save state but are unreachable.

// --- Activation ---
register('act_passive_', handleActPassive, 'activation');
register('status_phase_', handleStatusPhase, 'activation');
register('pass_activation_turn_', handlePassActivationTurn, 'activation');
register('end_turn_', handleEndTurn, 'activation');
register('dc_switch_fig_', handleDcSwitchFig, 'activation');
register('dc_end_activation_', handleDcEndActivation, 'activation');
register('clan_of_two_teleport_', handleClanOfTwoTeleport, 'activation');
register('confirm_activate_', handleConfirmActivate, 'activation');
register('cancel_activate_', handleCancelActivate, 'activation');
register('field_tactics_pick_', handleFieldTacticsPick, 'activation');
register('fv_pick_', handleForceVisionPick, 'activation');
register('lia_deploy_zone_', handleLiaDeployZone, 'activation');
register('heroic_effort_return_', handleHeroicEffortReturn, 'activation');
register('scav_weapon_transfer_', handleScavWeaponTransfer, 'activation');
register('sc_fig_pick_', handleScFigPick, 'activation');
register('hair_trigger_use_', handleHairTriggerUse, 'activation');
register('hair_trigger_skip_', handleHairTriggerSkip, 'activation');
register('iwba_use_', handleItWillBeAlrightUse, 'activation');
register('iwba_skip_', handleItWillBeAlrightSkip, 'activation');
register('iwba_pick_', handleItWillBeAlrightPick, 'activation');
register('iwba_action_', handleItWillBeAlrightAction, 'activation');

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
register('loadout_select_', handleLoadoutSelect, 'setup');
register('loadout_confirm_', handleLoadoutConfirm, 'setup');
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

// --- Blitz Deployment (Lothal-Wastes-A) ---
register('blitz_group_', handleBlitzGroupSelect, 'setup');
register('blitz_pass_', handleBlitzPass, 'setup');
register('blitz_move_fig_', handleBlitzMoveFig, 'setup');
register('blitz_move_pick_', handleBlitzMovePick, 'setup');
register('blitz_move_done_', handleBlitzMoveDone, 'setup');

// --- DC Play Area ---
register('dc_activate_', handleDcActivate, 'dcPlayArea');
register('dc_unactivate_', handleDcUnactivate, 'dcPlayArea');
register('dc_toggle_', handleDcToggle, 'dcPlayArea');
register('dc_deplete_', handleDcDeplete, 'dcPlayArea');
register('dc_rename_', handleDcRename, 'dcPlayArea');
register('dc_remove_stun_', handleDcRemoveStun, 'dcPlayArea');
register('dc_remove_bleed_', handleDcRemoveBleed, 'dcPlayArea');
register('dc_done_immediate_mp_', handleDcDoneImmediateMp, 'dcPlayArea');
register('dc_cc_special_', handleDcCcSpecial, 'dcPlayArea');
register('dc_cc_eoa_', handleDcCcEndOfActivation, 'dcPlayArea');
register('dc_cc_double_', handleDcCcDoubleAction, 'dcPlayArea');
register('pounce_space_', handlePounceSpacePick, 'dcPlayArea');
register('pounce_skip_push_', handlePounceSkipPush, 'dcPlayArea');
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
register('dc_spend_mp_', (i, ctx) => handleDcAction(i, ctx, 'dc_spend_mp_'), 'dcPlayArea');
register('dc_move_', (i, ctx) => handleDcAction(i, ctx, 'dc_move_'), 'dcPlayArea');
register('dc_attack_', (i, ctx) => handleDcAction(i, ctx, 'dc_attack_'), 'dcPlayArea');
register('dc_heroic_attack_', handleDcHeroicAttack, 'dcPlayArea');
register('dc_bo_rifle_attack_', handleDcBoRifleAttack, 'dcPlayArea');
register('dc_wa_slam_', handleDcWaSlam, 'dcPlayArea');
register('dc_end_figure_', handleDcEndFigure, 'dcPlayArea');
register('dc_fig_pick_', handleDcFigPick, 'dcPlayArea');
register('granted_attack_', handleGrantedAttack, 'dcPlayArea');
register('granted_move_', handleGrantedMove, 'dcPlayArea');
register('soa_pick_', handleSoaPick, 'dcPlayArea');
register('soa_fire_', handleSoaFire, 'dcPlayArea');
register('soa_skip_all_', handleSoaSkipAll, 'dcPlayArea');
register('eoa_pick_', handleEoaPick, 'dcPlayArea');
register('eoa_fire_', handleEoaFire, 'dcPlayArea');
register('eoa_skip_all_', handleEoaSkipAll, 'dcPlayArea');
register('dc_interact_', (i, ctx) => handleDcAction(i, ctx, 'dc_interact_'), 'dcPlayArea');
register('dc_special_', (i, ctx) => handleDcAction(i, ctx, 'dc_special_'), 'dcPlayArea');
register('dc_ability_choice_', handleDcAbilityChoice, 'dcPlayArea');
register('ee3_pick_die_', handleEe3DiePick, 'dcPlayArea');
register('vanguard_pick_', handleVanguardDiePick, 'dcPlayArea');
register('bo_rifle_pick_', handleBoRiflePick, 'dcPlayArea');

// --- Generic Space Picker (2-step row→cell) ---
register('space_row_back_', handleSpaceRowBack, 'spacePicker');
register('space_row_', handleSpaceRow, 'spacePicker');

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
register('cc_fl_pick_named_', handleFastLearnerPickNamed, 'ccHand');
register('cc_fl_pick_mara_', handleFastLearnerPickMara, 'ccHand');
register('cc_draw_', handleCcDraw, 'ccHand');
register('cc_search_discard_', handleCcSearchDiscard, 'ccHand');
register('cc_close_discard_', handleCcCloseDiscard, 'ccHand');
register('cc_discard_', handleCcDiscard, 'ccHand');
register('cc_choice_', handleCcChoice, 'ccHand');
register('cc_space_', handleCcSpacePick, 'ccHand');
register('illegal_cc_ignore_', handleIllegalCcIgnore, 'ccHand');
register('illegal_cc_unplay_', handleIllegalCcUnplay, 'ccHand');
register('celebration_play_', handleCelebrationPlay, 'ccHand');
register('celebration_pass_', handleCelebrationPass, 'ccHand');
register('excavation_play_', handleExcavationPlay, 'ccHand');

// --- Favorites ---
register('fav_save_', handleFavSave, 'favorites');
register('fav_remove_', handleFavRemove, 'favorites');
register('fav_rename_', handleFavRename, 'favorites');
register('fav_choose_', handleFavChoose, 'favorites');
register('fav_choose_select_', handleFavChooseSelect, 'favorites');
register('fav_list_select_', handleFavListSelect, 'favList');
register('fav_list_rename_', handleFavListRename, 'favList');
register('fav_list_remove_', handleFavListRemove, 'favList');
register('fav_list_back_', handleFavListBack, 'favList');

// --- Phase gate ---
register('phase_gate_ready_', handlePhaseGateReady, 'phaseGate');
register('phase_gate_unready_', handlePhaseGateUnready, 'phaseGate');

// --- Botmenu ---
register('botmenu_recover_', handleBotmenuRecover, 'recover');
register('resync_', handleResync, 'recover');
register('cp_save_modal_', handleCheckpointSaveModal, 'checkpoint');
register('cp_save_', handleCheckpointSavePrompt, 'checkpoint');
register('cp_newgame_confirm_', handleCheckpointNewGameConfirm, 'checkpoint');
register('cp_newgame_back_', handleCheckpointNewGameBack, 'checkpoint');
register('cp_newgame_pick_', handleCheckpointNewGamePick, 'checkpoint');
register('cp_newgame_open_', handleCheckpointNewGameOpen, 'checkpoint');
register('cp_load_ingame_confirm_', handleCheckpointInGameConfirm, 'checkpoint');
register('cp_load_ingame_back_', handleCheckpointInGameBack, 'checkpoint');
register('cp_load_ingame_pick_', handleCheckpointInGamePick, 'checkpoint');
register('cp_load_ingame_open_', handleCheckpointInGameOpen, 'checkpoint');
register('botmenu_kill_', handleBotmenuKill, 'botmenu');
register('botmenu_kill_yes_', handleBotmenuKillYes, 'botmenu');
register('botmenu_kill_no_', handleBotmenuKillNo, 'botmenu');
register('forfeit_yes_', handleForfeitYes, 'forfeit');
register('forfeit_no_', handleForfeitNo, 'forfeit');
register('forfeit_', handleForfeit, 'forfeit');

// --- Fast-forward & defender CC ---
register('fast_forward_', handleFastForward, 'fastForward');
register('dc_cc_defender_', handleDefenderCcPlay, 'ccHand');

// --- Combat reactions ---
// Tough Luck's legacy round-long tough_luck_* reaction was removed 2026-06-18.
// It is now the discrete tlgate_* gate reaction (handleToughLuckGate, registered
// with the combat group above).
register('there_is_no_try_die_', handleThereIsNoTry, 'combatReactions');
register('there_is_no_try_face_', handleThereIsNoTry, 'combatReactions');
register('there_is_no_try_skip_', handleThereIsNoTry, 'combatReactions');
register('hunter_protocol_trigger_', handleHunterProtocol, 'combatReactions');
register('hunter_protocol_skip_', handleHunterProtocol, 'combatReactions');
register('strike_me_down_yes_', handleStrikeMeDown, 'combatReactions');
register('strike_me_down_no_', handleStrikeMeDown, 'combatReactions');
register('last_stand_pick_', handleLastStandPick, 'combatReactions');
register('erg_pick_', handleErgPick, 'combatReactions');
register('slow_on_draw_yes_', handleSlowOnTheDraw, 'combatReactions');
register('slow_on_draw_no_', handleSlowOnTheDraw, 'combatReactions');
register('slow_on_draw_resume_', handleSlowOnTheDrawResume, 'combatReactions');
register('force_with_me_pick_', handleForceIsWithMe, 'combatReactions');
register('force_with_me_skip_', handleForceIsWithMe, 'combatReactions');
register('power_converter_approve_', handlePowerConverter, 'combatReactions');
register('power_converter_skip_', handlePowerConverter, 'combatReactions');
register('power_converter_die_', handlePowerConverter, 'combatReactions');
register('power_converter_color_', handlePowerConverter, 'combatReactions');
register('illicit_arms_use_', handleIllicitArms, 'combatReactions');
register('illicit_arms_skip_', handleIllicitArms, 'combatReactions');
register('illicit_arms_pick_', handleIllicitArms, 'combatReactions');
register('force_exhaustion_yes_', handleForceExhaustion, 'combatReactions');
register('force_exhaustion_no_', handleForceExhaustion, 'combatReactions');
register('fe_die_pick_', handleForceExhaustionDiePick, 'combatReactions');
// alexanbv 2026-05-13: doubt_reroll_use_/skip_ buttons retired.
// [Doubt] now registers directly into the defender's reroll bucket
// via handleCombatRoll detection; no on-declare/post-roll prompt.
// handleDoubtReroll function kept exported for back-compat callers.

// --- Post-combat ---
register('reaction_skip_', handleReactionSkip, 'postCombat');
register('reaction_use_', handleReactionUse, 'postCombat');
register('right_back_block_', handleRightBack, 'postCombat');
register('right_back_nodmg_', handleRightBack, 'postCombat');
register('mastery_pick_', handleMasteryPick, 'postCombat');
register('mastery_skip_', handleMasteryPick, 'postCombat');
register('me_pick_', handleMilitaryEfficiencyPick, 'postCombat');
register('me_skip_', handleMilitaryEfficiencyPick, 'postCombat');
register('interrogate_pick_', handleInterrogatePick, 'postCombat');
register('interrogate_discard_', handleInterrogatePick, 'postCombat');
register('interrogate_skip_', handleInterrogatePick, 'postCombat');
register('sc_int_open_', handleScInterrogateOpen, 'postCombat');
register('sc_int_skip_', handleScInterrogateSkip, 'postCombat');
register('sc_int_confirm_', handleScInterrogateConfirm, 'postCombat');

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
// sdp_move_pick_ / sdp_move_skip_ handlers retired — Self-Destruct
// Protocol's destination picker now flows through the unified Move-X
// picker (move_x_step_ / move_x_done_) with an `sdpExplode`
// continuation that fires _runSelfDestructExplode at the end.
register('move_interrupt_play_', handleSpacesMoveInterruptPlay, 'interrupts');
register('move_interrupt_skip_', handleSpacesMoveInterruptSkip, 'interrupts');
register('move_interrupt_continue_', handleSpacesMoveInterruptContinue, 'interrupts');
register('strain_resolve_ud_deplete_', handleStrainUdDeplete, 'interrupts');
register('strain_resolve_ud_skip_', handleStrainUdSkip, 'interrupts');
register('strain_resolve_damage_', handleStrainChoiceDamage, 'interrupts');
register('strain_resolve_discard_', handleStrainChoiceDiscard, 'interrupts');
register('strain_resolve_paz_', handleStrainChoicePaz, 'interrupts');
register('sc_hh_open_', handleScHeadhunterOpen, 'interrupts');
register('sc_hh_skip_', handleScHeadhunterSkip, 'interrupts');
register('sc_hh_confirm_', handleScHeadhunterConfirm, 'interrupts');
register('last_resort_use_', handleLastResort, 'interrupts');
register('last_resort_skip_', handleLastResort, 'interrupts');
register('yhsiw_transfer_', handleYHSIW, 'interrupts');
register('yhsiw_damage_', handleYHSIW, 'interrupts');
// submit_fight_* handlers removed 2026-06-20 — Submit or Fight is now the
// canonical PAZ_RETURN_FROM_DISCARD strain option (strain_resolve_paz_).
register('scavenged_walker_attack_', handleScavengedWalker, 'interrupts');
register('scavenged_walker_skip_', handleScavengedWalker, 'interrupts');
register('mortar_eor_use_', handleMortarEor, 'interrupts');
register('mortar_eor_skip_', handleMortarEor, 'interrupts');
register('rs_attack_', handleRogueSmuggler, 'interrupts');
register('rs_skip_', handleRogueSmuggler, 'interrupts');
register('wild_beast_trample_', handleWildBeastTrample, 'interrupts');
register('dbh_move_', handleDrivenByHatred, 'interrupts');
register('dbh_skip_', handleDrivenByHatred, 'interrupts');
register('dbh_post_choke_', handleDbhPostMove, 'interrupts');
register('dbh_post_attack_', handleDbhPostMove, 'interrupts');
register('dbh_post_skip_', handleDbhPostMove, 'interrupts');
register('findsman_med_', handleFindsmanMeditation, 'interrupts');
register('hunt_dissent_pick_', handleHuntDissentPick, 'interrupts');
register('adapt_blaise_pick_', handleAdaptBlaisePick, 'interrupts');
register('on_diplomatic_', handleOnDiplomatic, 'interrupts');
register('bel_reorder_1_', handleBelReorder, 'interrupts');
register('bel_reorder_2_', handleBelReorder, 'interrupts');
register('ab_blade_pick_', handleAssassinsBladePickTarget, 'interrupts');
register('sf_mp_pick_', handleSuppressiveFireMpPick, 'interrupts');
register('sf_optin_yes_', handleSuppressiveFireOptin, 'interrupts');
register('sf_optin_no_', handleSuppressiveFireOptin, 'interrupts');
register('ps_replace_', handlePunishingStrike, 'interrupts');
register('force_slow_pick_', handleForceSlowPick, 'interrupts');
register('excavation_pick_', handleExcavationPick, 'interrupts');
register('excavation_skip_', handleExcavationPick, 'interrupts');
register('bm_draw_', handleBlackMarket, 'interrupts');
register('bm_discard_', handleBlackMarket, 'interrupts');
register('bm_return_', handleBlackMarket, 'interrupts');
register('bm_skip_', handleBlackMarket, 'interrupts');
register('executor_use_', handleExecutor, 'interrupts');
register('executor_skip_', handleExecutor, 'interrupts');
register('extra_protection_play_', handleExtraProtection, 'interrupts');
register('extra_protection_skip_', handleExtraProtection, 'interrupts');
register('defeat_pick_skip_', handleDefeatPick, 'interrupts');
register('defeat_pick_', handleDefeatPick, 'interrupts');
register('parting_shot_fire_', handleFirePartingShot, 'interrupts');
register('parting_shot_skip_', handleSkipPartingShot, 'interrupts');
register('final_stand_play_', handleFireFinalStand, 'interrupts');
register('final_stand_skip_', handleSkipFinalStand, 'interrupts');
register('dying_lunge_play_', handleFireDyingLunge, 'interrupts');
register('dying_lunge_skip_', handleSkipDyingLunge, 'interrupts');
register('miracle_worker_play_', handlePlayMiracleWorker, 'interrupts');
register('miracle_worker_skip_', handleSkipMiracleWorker, 'interrupts');
register('preservation_protocol_play_', handlePlayPreservationProtocol, 'interrupts');
register('preservation_protocol_skip_', handleSkipPreservationProtocol, 'interrupts');
register('defeat_cc_play_', handlePlayDefeatCcPrompt, 'interrupts');
register('defeat_cc_skip_', handleSkipDefeatCcPrompt, 'interrupts');
register('defeat_cc_target_', handleDefeatCcTargetPick, 'interrupts');
register('defeat_cc_mode_', handleDefeatCcModePick, 'interrupts');

// --- Map events ---
register('devaron_door_open_', handleDevaronDoorOpen, 'mapEvents');
register('devaron_crate_push_', handleDevaronCratePush, 'mapEvents');
register('devaron_crate_done_', handleDevaronCrateDone, 'mapEvents');
register('krykna_push_', handleKryknaPush, 'mapEvents');
register('krykna_place_pick_', handleKryknaPlacePick, 'mapEvents');
register('krykna_place_skip_', handleKryknaPlaceSkip, 'mapEvents');
register('krykna_place_', handleKryknaPlace, 'mapEvents');
register('fluctuation_swap_', handleFluctuationSwap, 'round');
register('fluctuation_skip_', handleFluctuationSkip, 'round');
register('arms_distribute_pick_', handleArmsDistributePick, 'mapEvents');
register('into_the_force_pick_', async (interaction, ctx) => {
  const { getGame, saveGames, client, logGameAction } = ctx;
  const m = interaction.customId.match(/^into_the_force_pick_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, figureKey] = m;
  const game = getGame(gameId);
  if (!game?.pendingIntoTheForce) {
    await interaction.followUp({ content: 'No pending Into the Force.', ephemeral: true }).catch(() => {});
    return;
  }
  const itf = game.pendingIntoTheForce;
  const expectedId = itf.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== expectedId) {
    await interaction.followUp({ content: 'Only Obi-Wan\'s owner may pick.', ephemeral: true }).catch(() => {});
    return;
  }
  if (!itf.eligible.includes(figureKey)) {
    await interaction.followUp({ content: 'That figure is no longer eligible.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate().catch(() => {});
  const { applyCondition } = await import('../game/conditions.js');
  if (applyCondition(game, figureKey, 'Focus')) {
    await logGameAction(game, client, `🌌 **Into the Force** — **${figureKey}** becomes Focused.`, { phase: 'ROUND', icon: 'card' });
  }
  await interaction.message.edit({ components: [] }).catch(() => {});
  delete game.pendingIntoTheForce;
  saveGames(game.gameId);
}, 'mapEvents');
register('arms_distribute_skip_', handleArmsDistributeSkip, 'mapEvents');
register('prototype_dest_pick_', handlePrototypeDestPick, 'mapEvents');
register('prototype_pick_', handlePrototypePick, 'mapEvents');
register('prototype_skip_', handlePrototypeSkip, 'mapEvents');

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
register('durasteel_push_', handleDurasteelPush, 'combatSpecialEffects');
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
register('havoc_shot_use_', handleHavocShotUse, 'combatSpecialEffects');
register('havoc_shot_skip_', handleHavocShotSkip, 'combatSpecialEffects');
register('havoc_shot_pick_', handleHavocShotPick, 'combatSpecialEffects');
register('havoc_shot_done_', handleHavocShotDone, 'combatSpecialEffects');
register('deflect_pick_', handleDeflectPick, 'combatSpecialEffects');
register('deflect_skip_', handleDeflectSkip, 'combatSpecialEffects');
register('wanton_use_', handleWantonUse, 'combatSpecialEffects');
register('wanton_cc_', handleWantonCcPick, 'combatSpecialEffects');
register('wanton_pick_', handleWantonPick, 'combatSpecialEffects');
register('wanton_done_', handleWantonDone, 'combatSpecialEffects');
register('wanton_skip_', handleWantonSkip, 'combatSpecialEffects');

// --- Select-menu handlers (dispatched via table-driven select dispatch in index.js) ---
register('arsenal_pick_', handleArsenalPick, 'dcPlayArea');
register('map_selection_draw_', handleMapSelectionDraw, 'setup');
register('map_selection_pick_', handleMapSelectionPick, 'setup');
register('cc_attach_to_', handleCcAttachTo, 'ccHand');
register('cc_play_select_', handleCcPlaySelect, 'ccHand');
register('cc_discard_select_', handleCcDiscardSelect, 'ccHand');
register('sc_cc_confirm_', handleScCcConfirm, 'ccHand');
register('cc_counter_negate_', handleCcCounterNegate, 'ccHand');
register('cc_counter_comms_', handleCcCounterComms, 'ccHand');
register('cc_counter_pass_', handleCcCounterPass, 'ccHand');
register('sc_cc_skip_', handleScCcSkip, 'ccHand');
register('sc_cc_open_', handleScCcOpen, 'ccHand');

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
export { handleEndEndOfRound, handleEndStartOfRound, handleSorMissionReveal, runStartOfRoundDcEffects, runStartOfRoundContinuation, runStatusPhaseAfterEndOfRound, handleExtraArmorPick, handleExtraArmorConfirm, handleExtraArmorCancel, handleRbfDiscard, handleRogueOneReturn, handleImpCitadel, handleProgrammingOverride, handleCtfPick, handleCtfStrain, handleDoubtFigPick, handleDoubtRemove, handleSmugglingCompartmentReorder, resolveStartOfRoundEffect, handleSpectreCellDist } from './round.js';
export {
  runPostDeployPhase, advancePostDeployQueue, onPostDeployMovementComplete, onExtraArmorComplete,
  cleanupCompanionEmbedDeps, createCompanionDcEmbed,
  handlePostDeployPick, handleSecurityDetailPick, handleStrikeTeamAdjPick,
  handleStrikeTeamTokenPick, handleStrikeTeamTokenDone,
  handlePostDeployMoveStay, handleSmoothLandingPick,
  handleWalkerMove, handleWalkerSkip,
  handleArmsDistFigPick, handleArmsDistTokenPick,
  handleSetYourSightsPick,
  handleCompanionDeployPick,
} from './post-deploy.js';
export { handleMoveMp, handleMoveAdjustMp, handleMovePick, handleMoveStepModeToggle, handleMoveInterruptPlay, handleMoveInterruptSkip, handleOverwatchInterruptUse, handleOverwatchInterruptSkip } from './movement.js';
export { handleAttackTarget, handleCleaveTarget, handleCoverFireBlock, handleCoverFireDiscard, handleGuidanceSystems, handleCombatResolveReady, handleCombatRoll, handleCombatSurge, handleCombatReroll, handlePreReroll, handleCombatPassive, handleCombatToken, handlePowerTokenChoice, handlePowerTokenOverflowDiscard, sendPowerTokenOverflowUI, handleSpreadThePainCondPick, handleLasatDiePick, handleLasatFacePick, handleFalseOrdersAtkPick, sendRerollUI, proceedAfterRerolls, sendReadyToResolveRolls, handleStrainChoice, handleRogueOneTokenPick, handleCombatGateReady, sendCombatGate, sendOnDeclareTokenWindow } from './combat.js';
export { handleStatusPhase, handlePassActivationTurn, handleEndTurn, handleDcEndActivation, handleClanOfTwoTeleport, handleDcSwitchFig, handleConfirmActivate, handleCancelActivate, handleActPassive, handleFieldTacticsPick, handleForceVisionPick, handleLiaDeployZone, handleHeroicEffortReturn, handleScavWeaponTransfer, handleScFigPick, handleHairTriggerUse, handleHairTriggerSkip} from './activation.js';
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
  handleLoadoutSelect,
  handleLoadoutConfirm,
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
  startDeploymentAfterAttachments,
  _sendAttachmentDropdown,
  _sendAttachDonePrompt,
} from './setup.js';
export {
  handleBlitzGroupSelect,
  handleBlitzPass,
  handleBlitzMoveFig,
  handleBlitzMovePick,
  handleBlitzMoveDone,
} from './blitz-deploy.js';
export {
  handleDcActivate,
  handleDcUnactivate,
  handleDcToggle,
  handleDcDeplete,
  handleDcRename,
  handleDcRemoveStun,
  handleDcRemoveBleed,
  handleDcDoneImmediateMp,
  handleDcCcSpecial,
  handleDcCcEndOfActivation,
  handleDcCcDoubleAction,
  handleDcAction,
  handleDcHeroicAttack,
  handleDcBoRifleAttack,
  handleDcWaSlam,
  handleDcEndFigure,
  handleDcFigPick,
  handleGrantedAttack,
  handleGrantedMove,
  handlePounceSpacePick,
  handlePounceSkipPush,
  handleDcAbilityChoice,
  handleArsenalPick,
  handleEe3DiePick,
  handleVanguardDiePick,
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
  handleIllegalCcIgnore,
  handleIllegalCcUnplay,
  handleCelebrationPlay,
  handleCelebrationPass,
  handleExcavationPlay,
  handleCcSpacePick,
} from './cc-hand.js';
export {
  handleBotmenuKill,
  handleBotmenuKillYes,
  handleBotmenuKillNo,
  handleForfeit,
  handleForfeitYes,
  handleForfeitNo,
} from './botmenu.js';
export { handleBotmenuRecover, handleResync, runRecovery } from './recover.js';
export { handlePhaseGateReady, handlePhaseGateUnready, sendPhaseGateMessages } from './phase-gate.js';
export { getWaitingPlayers } from '../game/phase-gate.js';
export { handleFastForward, handleDefenderCcPlay } from './fast-forward.js';
export { handleThereIsNoTry, handleVetInstincts, handleHunterProtocol, handleStrikeMeDown, handleSlowOnTheDraw, handleSlowOnTheDrawResume, handlePowerConverter, handleIllicitArms, handleDoubtReroll, handleForceIsWithMe } from './combat-reactions.js';
export { handleReactionSkip, handleReactionUse, handleRightBack, handleMasteryPick, handleMilitaryEfficiencyPick, handleInterrogatePick } from './post-combat.js';
export { handleStillFaster, handleSquadSwarm, handleOverdrive, handleSelfDestructProbe, handleSelfDestructProtocol, handleLastResort, handleScavengedWalker, handleMortarEor, handleOnDiplomatic, handleBelReorder, handleAssassinsBladePickTarget, handleSuppressiveFireMpPick, handleSuppressiveFireOptin, handleForceSlowPick, handleExcavationPick, handleYHSIW, handleDrivenByHatred, handleBlackMarket, handlePunishingStrike, handleExecutor, handleExtraProtection } from './interrupts.js';
export { handleSpacesMoveInterruptPlay, handleSpacesMoveInterruptSkip, handleSpacesMoveInterruptContinue, startMoveInterruptLoop } from './move-interrupts-handler.js';
export { applyStrain, handleStrainUdDeplete, handleStrainUdSkip, handleStrainChoiceDamage, handleStrainChoiceDiscard, handleStrainChoicePaz } from './strain-handler.js';
export { handleDevaronDoorOpen, handleDevaronCratePush, handleDevaronCrateDone, handleKryknaPush, handleKryknaPlace, handleKryknaPlaceSkip, handleKryknaPlacePick, handleFluctuationSwap, handleFluctuationSkip, handleArmsDistributePick, handleArmsDistributeSkip, handlePrototypePick, handlePrototypeSkip, handlePrototypeDestPick } from './map-events.js';
export { buildFavoritesListPayload, handleFavNameModal, handleFavRenameModal, handleFavListRenameModal } from './favorites.js';
export {
  handleBleedResolve,
  handleSidewinderApply, handleSidewinderSkip,
  handleBoltslingerTarget, handleBoltslingerSkip,
  handleIndiscriminateFireDie, handleIndiscriminateFireSkip,
  handleFightingKnifeTarget, handleFightingKnifeSkip,
  handleConcussiveBoltPush, handleConcussiveBoltSkip,
  handleDurasteelPush,
  handleSpreadThePainFigPick, handleSpreadThePainSkip,
  handleMissileSalvoDie, handleMissileSalvoDone,
  handleHeavyFireUse, handleHeavyFireSkip,
  handleHeavyFireTarget, handleHeavyFireDone,
  handleHeavyFireCondition,
  handleHavocShotUse, handleHavocShotSkip, handleHavocShotPick, handleHavocShotDone,
  handleDeflectPick, handleDeflectSkip,
  handleWantonUse, handleWantonCcPick, handleWantonPick, handleWantonDone, handleWantonSkip,
} from './combat-special-effects.js';
