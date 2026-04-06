import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  AttachmentBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
} from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import 'dotenv/config';
import { COLORS } from './src/discord/colors.js';
import { parseVsav, parseIacpListPaste } from './src/vsav-parser.js';
import {
  isDbConfigured,
  deleteGameFromDb,
  insertCompletedGame,
  getStatsSummary,
  getStatsSummaryForPlayer,
  getAffiliationWinRates,
  getAffiliationWinRatesPersonal,
  getAffiliationPickRates,
  getAffiliationPickRatesPersonal,
  getDcWinRates,
  getDcWinRatesPersonal,
  getLeaderboard,
  getEarnedAchievements,
  checkAndGrantAchievements,
  upsertCoverageLiveStatus,
  getCoverageLiveStatuses,
  getCoverageRegions,
  updateCoverageVerification,
  insertCoverageIncident,
  getCoverageIncidents,
  upsertDiscordTransition,
  insertExplorationEpisode,
  resolveIncident,
  getCoverageSummary,
  getCoverageGaps,
} from './src/db.js';
import {
  getGame,
  setGame,
  saveGames,
  loadGames,
  getGamesMap,
  deleteGame,
  CURRENT_GAME_VERSION,
  dcMessageMeta,
  dcExhaustedState,
  dcHealthState,
  pendingIllegalSquad,
  pendingSquadConfirm,
  cleanupGameMaps,
  repopulateDcMapsForGame,
} from './src/game-state.js';
import {
  createPlayAreaChannels as _createPlayAreaChannels,
  createHandThreads as _createHandThreads,
  createGameChannels as _createGameChannels,
  createBoardChannel as _createBoardChannel,
  createTestGame as _createTestGame,
  applySquadSubmission as _applySquadSubmission,
  setupServer as _setupServer,
} from './src/game-creation.js';
import { rotateImage90 } from './src/dc-image-utils.js';
import { renderMap } from './src/map-renderer.js';
import {
  buildBoardMapPayload as _buildBoardMapPayload,
  buildDcEmbedAndFiles,
  buildDiscardPileDisplayPayload,
  buildHandDisplayPayload as _buildHandDisplayPayload,
  getFiguresForRender,
  buildMissionTokens,
  getMapTokensForRender,
  getActivationMinimapAttachment,
  getMovementMinimapAttachment,
  getDeploymentMapAttachment,
} from './src/rendering.js';
import { getHandlerKey } from './src/router.js';
import { checkFriendlyDefeatedPassiveRedraws, checkStartOfRoundPassiveRedraws } from './src/game/cc-passive-redraw.js';
import { getHandler, getHandlerGroup } from './src/handlers/index.js';
import { sendPhaseGateMessages } from './src/handlers/phase-gate.js';
import { setPhase, setRoundPhase, PHASES, ROUND_PHASES } from './src/game/phase.js';
import { SCENARIO_MUTATORS } from './src/engine/scenario-mutators.js';
import { deleteGameChannelsAndGame } from './src/handlers/botmenu.js';
import { cleanupRoundStart } from './src/game/activation-state.js';
import { getRecoveryReason } from './src/engine/recovery.js';
import { applyIndiscriminateFireSplash } from './src/handlers/combat-special-effects.js';
import { buildContext, getAllRequiredDepKeys } from './src/context-factory.js';
import { replyOrFollowUpWithRetry } from './src/error-handling.js';
import { captureSnapshot, computeDiff, createEvent, appendToBuffer, getRecentEvents, clearBuffer, clearSeqCounter as clearEventLogSeqCounter } from './src/event-log.js';
import { translateDiffToEvents } from './src/domain/diff-translator.js';
import { appendEvents as appendDomainEvents } from './src/domain/event-store.js';
import { customIdToCommand } from './src/domain/commands/command-router.js';
import { handlePhaseGateReady, handlePhaseGateUnready } from './src/domain/commands/phase-gate-commands.js';
import { handleEndTurn as cmdEndTurn, handlePassActivationTurn as cmdPassTurn, handleActivateDc as cmdActivateDc } from './src/domain/commands/activation-commands.js';
import { handleStartRound as cmdStartRound, handleEndRound as cmdEndRound, handleEndOfRoundStart as cmdEndOfRoundStart, handleActivationPhaseStart as cmdActivationPhaseStart } from './src/domain/commands/round-commands.js';
import { handleDeclareAttack as cmdDeclareAttack, handleReadyForCombat as cmdReadyForCombat, handleRollCombatDice as cmdRollDice, handleSpendSurge as cmdSpendSurge, handlePerformReroll as cmdPerformReroll } from './src/domain/commands/combat-commands.js';
import { handleStartMovement as cmdStartMovement, handleMoveToSpace as cmdMoveToSpace, handleCompleteMovement as cmdCompleteMovement } from './src/domain/commands/movement-commands.js';
import { handleResolveCombat as cmdResolveCombat, handleCancelCombat as cmdCancelCombat, handleCombatPassive as cmdCombatPassive, handleCombatToken as cmdCombatToken, handleCleaveTarget as cmdCleaveTarget } from './src/domain/commands/combat-reaction-commands.js';
import { handlePlayCommandCard as cmdPlayCard, handleDiscardCommandCard as cmdDiscardCard, handleDrawCommandCards as cmdDrawCards, handleNegationAttempt as cmdNegationAttempt, handleNegationResolve as cmdNegationResolve } from './src/domain/commands/hand-commands.js';
import { handleSelectMap as cmdSelectMap, handleConfirmMap as cmdConfirmMap, handleDetermineInitiative as cmdDetermineInitiative, handleChooseDeploymentZone as cmdChooseZone, handleDeployFigure as cmdDeployFigure, handleFinishDeployment as cmdFinishDeployment, handleSubmitSquad as cmdSubmitSquad } from './src/domain/commands/setup-commands.js';
import { handlePerformAction as cmdPerformAction, handleDcEndActivation as cmdDcEndActivation } from './src/domain/commands/dc-play-area-commands.js';
import { createDomainEvent, clearSeqCounter as clearDomainSeqCounter } from './src/domain/events.js';
import { getAiPlayer, runAiTurnLive, markGameAsAi, AI_USER_PREFIX } from './src/ai/ai-discord.js';
import { getActiveSelfPlayGameId, runSelfPlayLoop, captureManualKillDiagnostic, formatCoverageSummary } from './src/ai/self-play.js';
import { startQueue, stopQueue, pauseQueue, resumeQueue, getQueueStatus } from './src/ai/self-play-queue.js';
import { parseTransitionKey } from './src/exploration/transition-key.js';
import { getTopValidationCandidate } from './src/exploration/rank-seeds.js';
import { snowflakeUsers, sanitizeMentions } from './src/discord/channel-helpers.js';
import { shuffleArray as _shuffleArrayPure, filterValidTopLeftSpaces as _filterValidTopLeftSpacesPure, isWithinN as _isWithinNPure } from './src/engine/utils.js';
import {
  getMissionTokenLabel as _getMissionTokenLabelPure,
  getCrateDeploymentVpBonus as _getCrateDeploymentVpBonusPure,
  getAnchorheadPatronVpBonus as _getAnchorheadPatronVpBonusPure,
  getMissionVpBonus as _getMissionVpBonusPure,
  calculateKillVp as _calculateKillVpPure,
} from './src/engine/mission-helpers.js';
import {
  hasActionsRemainingInGame as _hasActionsRemainingInGamePure,
  shouldShowEndActivationPhaseButton as _shouldShowEndActivationPhaseButtonPure,
  isGroupDefeated as _isGroupDefeatedPure,
  isDepletedRemovedFromGame as _isDepletedRemovedFromGamePure,
  findDcMessageIdForFigure as _findDcMessageIdForFigurePure,
  lookupFigureDcIndex as _lookupFigureDcIndexPure,
  getFigureLabel as _getFigureLabelPure,
  getPlayerZoneLabel as _getPlayerZoneLabelPure,
  countActiveGamesForPlayer as _countActiveGamesForPlayerPure,
} from './src/engine/game-readers.js';
import {
  getDcUpgradeAttachments as _getDcUpgradeAttachmentsPure,
  getConditionsForDcMessage as _getConditionsForDcMessagePure,
  getTokensForDcMessage as _getTokensForDcMessagePure,
  getNicknamesForDcMessage as _getNicknamesForDcMessagePure,
} from './src/engine/dc-ui-helpers.js';
import {
  getPlayReadyMaps as _getPlayReadyMapsPure,
  postMissionCardAfterMapSelection as _postMissionCardAfterMapSelectionPure,
  postPinnedMissionCardFromGameState as _postPinnedMissionCardFromGameStatePure,
  clearPreGameSetup as _clearPreGameSetupPure,
} from './src/engine/board-ui-helpers.js';
import {
  getMovementBankText as _getMovementBankTextPure,
  getDeployFigureLabels as _getDeployFigureLabelsPure,
  getDeployButtonRows as _getDeployButtonRowsPure,
  updateDeployPromptMessages as _updateDeployPromptMessagesPure,
  getMapAttachmentForSpaces as _getMapAttachmentForSpacesPure,
} from './src/engine/deploy-ui-helpers.js';
import {
  applyNpcDamageToFigure as _applyNpcDamageToFigurePure,
  applyDirectDamageToFigure as _applyDirectDamageToFigurePure,
  sendBleedingPrompt as _sendBleedingPromptPure,
  resolveCombatAfterRolls as _resolveCombatAfterRollsPure,
  applyDamageAndFinishCombat as _applyDamageAndFinishCombatPure,
  checkPostCombatSurges as _checkPostCombatSurgesPure,
  finishCombatResolution as _finishCombatResolutionPure,
} from './src/engine/combat-bridge.js';
import {
  getHandWindowButtonRow as _getHandWindowButtonRowPure,
  buildHandDisplayPayload as _buildHandDisplayPayloadPure,
  getSquadSelectEmbed as _getSquadSelectEmbedPure,
  buildSquadConfirmText as _buildSquadConfirmTextPure,
  getDeckIllegalPlayCustomId as _getDeckIllegalPlayCustomIdPure,
  getDeckIllegalRedoCustomId as _getDeckIllegalRedoCustomIdPure,
} from './src/engine/hand-ui-helpers.js';
import {
  checkWinConditions as _checkWinConditionsPure,
  resolveVpTiebreaker as _resolveVpTiebreakerPure,
  postGameOver as _postGameOverPure,
  checkNefariousGains as _checkNefariousGainsPure,
  checkHuntDissent as _checkHuntDissentPure,
  decrementActivationIfGroupDefeated as _decrementActivationIfGroupDefeatedPure,
} from './src/engine/win-conditions.js';
import {
  reorderPlayAreaAfterAttachments as _reorderPlayAreaAfterAttachmentsPure,
  finishSetupAttachments as _finishSetupAttachmentsPure,
  runDraftRandom as _runDraftRandomPure,
  populatePlayAreas as _populatePlayAreasPure,
} from './src/engine/setup-bridge.js';
import {
  getRandomTestreadyScenario as _getRandomTestreadyScenarioPure,
  getScenarioPrimaryCard as _getScenarioPrimaryCardPure,
  parsePlayableByToTraits as _parsePlayableByToTraitsPure,
  getDcByTrait as _getDcByTraitPure,
  retoolDecksForScenario as _retoolDecksForScenarioPure,
  validateTestreadyScenario as _validateTestreadyScenarioPure,
  createHandThreads as _createHandThreadsBridge,
  createGameChannels as _createGameChannelsBridge,
  createTestGame as _createTestGameBridge,
  applySquadSubmission as _applySquadSubmissionBridge,
  setupServer as _setupServerBridge,
} from './src/engine/game-creation-bridge.js';
import {
  buildAttachmentEmbedsAndFiles as _buildAttachmentEmbedsAndFilesPure,
  replyIfGameEnded as _replyIfGameEndedPure,
  pushUndo as _pushUndoPure,
  extractGameIdFromInteraction as _extractGameIdFromInteractionPure,
  resolveGameIdForLock as _resolveGameIdForLockPure,
  extractGameIdFromMessage as _extractGameIdFromMessagePure,
  sendRoundActivationPhaseMessage as _sendRoundActivationPhaseMessagePure,
  findFigureheadFigure as _findFigureheadFigurePure,
  sendDeckIllegalAlert as _sendDeckIllegalAlertPure,
  sendSquadConfirmation as _sendSquadConfirmationPure,
  postDevaronDoorButtons as _postDevaronDoorButtonsPure,
  postDevaronCratePushPrompts as _postDevaronCratePushPromptsPure,
  postKryknaPushButtons as _postKryknaPushButtonsPure,
  postFluctuationSwapButtons as _postFluctuationSwapButtonsPure,
} from './src/engine/misc-helpers.js';
import {
  updateAttachmentMessageForDc as _updateAttachmentMessageForDcPure,
  updateMovementBankMessage as _updateMovementBankMessagePure,
  ensureMovementBankMessage as _ensureMovementBankMessagePure,
  updateDcActionsMessage as _updateDcActionsMessagePure,
  updateHandChannelMessages as _updateHandChannelMessagesPure,
  updateHandVisualMessage as _updateHandVisualMessagePure,
  updateDiscardPileMessage as _updateDiscardPileMessagePure,
  updatePlayAreaDcButtons as _updatePlayAreaDcButtonsPure,
  clearMoveGridMessages as _clearMoveGridMessagesPure,
  editDistanceMessage as _editDistanceMessagePure,
  maybeShowEndActivationPhaseButton as _maybeShowEndActivationPhaseButtonPure,
  refreshAllGameComponents as _refreshAllGameComponentsPure,
} from './src/engine/message-updaters.js';
import { getCommandCardImagePath, getDcImagePath, getConditionCardPath, getFigureImagePath, resolveAssetPath, resolveDcImagePath, resolveMissionCardImagePath, UPGRADE_IMAGE_OVERRIDES } from './src/asset-paths.js';
import { canActAsPlayer } from './src/utils/can-act-as-player.js';
import { requirePlayer } from './src/utils/guards.js';
import { findGameByChannel, findGameByCommonChannel } from './src/discord/game-channel-lookup.js';
import { checkAndPostAchievements } from './src/discord/achievement-helpers.js';
import { updateGameView } from './src/discord/pvp-thread.js';
import { MAX_ACTIVE_GAMES_PER_PLAYER, PENDING_ILLEGAL_TTL_MS, MAX_UNDO_DEPTH } from './src/constants.js';
import { withGameLock, withAtomicGameLock, cleanupGameLock } from './src/game/action-queue.js';
import {
  getLobby,
  setLobby,
  hasLobby,
  hasLobbyEmbedSent,
  markLobbyEmbedSent,
  getLobbiesMap,
} from './src/lobby-state.js';
import {
  // Still directly called in modal dispatch section
  handleSquadModal, handleDeployModal,
  handleFavNameModal, handleFavRenameModal, handleFavListRenameModal,
  buildFavoritesListPayload,
  // Used in allDeps
  runStartOfRoundDcEffects,
  runStatusPhaseAfterEndOfRound,
  runPostDeployPhase,
  handlePreReroll,
  handleCombatPassive,
  handleCombatToken,
  handleStatusPhase,
  sendRerollUI,
  proceedAfterRerolls,
  sendReadyToResolveRolls,
  sendPowerTokenOverflowUI,
  cleanupCompanionEmbedDeps,
  startDeploymentAfterAttachments as _startDeploymentAfterAttachments,
} from './src/handlers/index.js';
import {
  validateDeckLegal,
  validateUpgradeWarnings,
  validateArmyAffiliation,
  normalizeSquadInput,
  resolveDcName,
  DC_POINTS_LEGAL,
  CC_CARDS_LEGAL,
  CC_COST_LEGAL,
  parseCoord,
  normalizeCoord,
  colRowToCoord,
  edgeKey,
  toLowerSet,
  getFootprintCells,
  parseSizeString,
  sizeToString,
  rotateSizeString,
  shiftCoord,
  filterMapSpacesByBounds,
  getBoundedMapSpaces,
  isWithinGridBounds,
  getBoardStateForMovement,
  getMovementProfile,
  buildTempBoardState,
  movementStateKey,
  getNormalizedFootprint,
  computeMovementCache,
  getSpacesAtCost,
  getMovementTarget,
  getMovementPath,
  ensureMovementCache,
  getOccupiedSpacesForMovement,
  getHostileOccupiedSpacesForMovement,
  getMovementKeywords,
  getReachableSpaces,
  getPathCost,
  getFiguresAdjacentToTarget,
  collectOverlappingFigures,
  pushFigureToNearestValid,
  resolveMassivePush,
  getEffectiveMapSpaces,
  rollAttackDice,
  rollDefenseDice,
  rollSingleAttackDie,
  rollSingleDefenseDie,
  recalcAttackTotals,
  recalcDefenseTotals,
  getInnateRerolls,
  getAttackerSurgeAbilities,
  parseSurgeEffect,
  SURGE_LABELS,
  computeCombatResult,
  getAbility,
  resolveSurgeAbility,
  getSurgeAbilityLabel,
  resolveAbility,
  getPlayableCcFromHand,
  isCcPlayableNow,
  isCcPlayLegalByRestriction,
  getRange as _getRange,
  hasLineOfSight as _hasLineOfSight,
  isWithinSpaces,
  isAdjacentCoords,
  isWithinRange,
  getFiguresWithinRange,
  getFiguresAdjacentTo,
  filterCondition as _filterCondition,
  isConditionImmune as _isConditionImmune,
  HARMFUL_CONDITIONS as _HARMFUL_CONDITIONS,
  applyCondition as _applyCondition,
  dcNameFromFigureKey,
  parseFigureKey,
  getDcEffect,
  isFigurelessDc as _isFigurelessDc,
  hasDepleteEffect as _hasDepleteEffect,
  hasExhaustEffect as _hasExhaustEffect,
  getCompanionDescriptionForDc as _getCompanionDescriptionForDc,
  reduceHp,
  healHp,
  awardKillVp,
  awardObjectiveVp,
  deductVp,
  checkNefariousGains as _checkNefariousGainsVp,
  opponentPlayerNum,
  getInitiativePlayerNum,
  getEffectiveFigureSize,
  getPlayerOccupiedCells,
  getMissionTokenCoords,
  isFigureAdjacentOrOnMissionToken,
  getEffectiveSpeed,
  isFigureInDeploymentZone,
  isFigureAdjacentOrOnAny,
  getFigureAdjacentCoordsFromSet,
  getLegalInteractOptions,
  getSpaceController,
  getFiguresOnOrAdjacentToSpace,
  countTerminalsControlledByPlayer,
  grantMovementBank,
  grantPowerTokens,
  getPlayerDeploymentZones,
} from './src/game/index.js';
import {
  buildScorecardEmbed,
  getInitiativePlayerZoneLabel,
  PHASE_COLOR,
  GAME_PHASES,
  ACTION_ICONS,
  logPhaseHeader,
  logGameAction,
  logGameErrorToBotLogs,
  clearGameErrorThread,
  formatHealthSection,
  CARD_BACK_CHAR,
  getPlayAreaTooltipEmbed,
  getHandTooltipEmbed,
  getHandVisualEmbed,
  getDiscardPileEmbed,
  getLobbyRosterText,
  getLobbyEmbed,
  getMapSelectionTooltipEmbed,
  getDeployDisplayNames,
  EMBEDS_PER_MESSAGE,
  getDiscardPileButtons,
  getDcToggleButton,
  getDcPlayAreaComponents as getDcPlayAreaComponentsFromDiscord,
  getMoveMpButtonRows,
  getSpaceChoiceRows,
  getDeployFigureLabelsFromDiscord,
  getDeployButtonRowsFromDiscord,
  getDeploySpaceGridRows,
  buildDeployRowButtons,
  getActivationsLine,
  getThreadName,
  updateThreadName,
  DC_ACTIONS_PER_ACTIVATION,
  getActionsCounterContent,
  updateActivationsMessage,
  FIGURE_LETTERS,
  getUndoButton,
  getBoardButtons,
  getGeneralSetupButtons,
  getMapTypeButtons,
  getMapConfirmButton,
  getMissionSelectDrawMenu,
  getMissionSelectionPickMenu,
  getBotmenuButtons,
  getDetermineInitiativeButtons,
  getDeploymentZoneButtons,
  getDeploymentDoneButton,
  getMainMenu,
  getLobbyJoinButton,
  getLobbyStartButton,
  getCcShuffleDrawButton,
  getCcActionButtons,
  getIllegalCcPlayButtons,
  getNegationResponseButtons,
  getCelebrationButtons,
  getSelectSquadButton,
  getHandSquadButtons,
  getKillGameButton,
  getRequestActionButtons,
  getCleaveTargetButtons,
  getFightingKnifeTargetButtons,
  getDcActionButtons as getDcActionButtonsFromDiscord,
  getActivateDcButtons as getActivateDcButtonsFromDiscord,
} from './src/discord/index.js';
import {
  reloadGameData,
  getDcImages,
  getFigureImages,
  getFigureSizes,
  getFigureSize,
  getMapRegistry,
  getDeploymentZones,
  getMapData,
  getDcEffects,
  getDcKeywords,
  getDiceData,
  getMissionCardsData,
  getMapTokensData,
  getCcEffectsData,
  getCcEffect,
  isCcAttachment,
  isDcAttachment,
  isDcUnique,
  isDcCompanion,
  getTournamentRotation,
  getMissionRules,
  getAbilityLibrary,
  getLoadoutCards,
  getDcStats,
} from './src/data-loader.js';
import { getConfig as getLoadoutConfig } from './src/game/figure-config.js';
import {
  ccPlayableByMatches as _ccPlayableByMatches,
  hasDarksaberImperial as _hasDarksaberImperial,
  isCcPlayableByDc,
  getPlayableCcSpecialsForDc,
  isCcDoubleActionPlayableByDc,
  getPlayableCcDoubleActionsForDc,
  getPlayableCcEndOfActivationForDc,
} from './src/game/cc-timing.js';
import { runEndOfRoundRules, runStartOfRoundRules, runNpcThugActivation, runNpcKryknaActivation, getCurrentFluctuationPositions } from './src/game/mission-rules.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getPlayAreaId, getHandChannelId,
  getSquad, getCcHand, getCcDeck, getCcDiscard, getCcAttachments, getDcAttachments,
  getActivationsRemaining, getActivationsTotal, getActivatedDcIndices,
  getDiscardThreadId, getActivationsMessageId,
  setActivationsRemaining, setActivationsTotal, setActivatedDcIndices,
  ccHandKey, ccDiscardKey, ccDeckKey, ccDrawnKey, ccAttachmentsKey, dcAttachmentsKey,
  dcAttachmentMessageIdsKey, vpKey, deployMetadataKey, deployLabelsKey, armyCostModifierKey,
  removeFigurePosition, syncHealthStateToList,
} from './src/game/player-helpers.js';
import { discordCatch } from './src/error-handling.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname);

// Resolved once at startup; undefined if env var not set
let achievementsChannelId = process.env.ACHIEVEMENTS_CHANNEL_ID || null;

/** Build embeds and files for the "Attachments" message under a DC. */
async function buildAttachmentEmbedsAndFiles(ccNames, dcNames = [], attachedToDcName = null) {
  return _buildAttachmentEmbedsAndFilesPure(ccNames, dcNames, attachedToDcName, {
    getCommandCardImagePath, getDcImagePath, join, rootDir, COLORS, existsSync,
  });
}

/** Update the Play Area "Attachments" message for a DC (CC + DC Skirmish Upgrade attachments).
 * Creates the message on demand when first attachment is added; deletes when last is removed. */
async function updateAttachmentMessageForDc(game, playerNum, dcMsgId, client) {
  return _updateAttachmentMessageForDcPure(game, playerNum, dcMsgId, client, {
    ccAttachmentsKey, dcAttachmentsKey, getDcMessageIds, dcAttachmentMessageIdsKey,
    getPlayAreaId, dcMessageMeta, buildAttachmentEmbedsAndFiles, discordCatch,
  });
}

/** Get the mission-specific token label for the current game (from selectedMission.tokenLabel or mission-cards.json fallback). */
function getMissionTokenLabel(game) {
  return _getMissionTokenLabelPure(game, { getMissionCardsData });
}

/** Manhattan distance in spaces between two coords. */
// Delegate to src/game/spatial.js (canonical implementation)
const getRange = _getRange;

// LOS + helpers delegated to src/game/spatial.js (canonical implementation)
const hasLineOfSight = _hasLineOfSight;

async function clearMoveGridMessages(game, moveKey, channel) {
  return _clearMoveGridMessagesPure(game, moveKey, channel);
}

async function editDistanceMessage(moveState, channel, content, components) {
  return _editDistanceMessagePure(moveState, channel, content, components);
}

/** Build 5x5 grid for movement tests. */
function buildTestGrid5x5(overrides = {}) {
  const { blocked = [], difficult = [], movementBlockingEdges = [] } = overrides;
  const spaces = [];
  const adjacency = {};
  const terrain = {};
  const blocking = [...blocked];
  const coord = (col, row) => String.fromCharCode(97 + col) + (row + 1);

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const k = coord(col, row);
      if (blocking.includes(k)) continue;
      spaces.push(k);
      terrain[k] = difficult.includes(k) ? 'difficult' : 'normal';
      const neighbors = [];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nc = col + dc, nr = row + dr;
        if (nc >= 0 && nc < 5 && nr >= 0 && nr < 5) {
          const nk = coord(nc, nr);
          if (!blocking.includes(nk)) {
            const ek = [k, nk].sort().join('|');
            const isBlocked = (movementBlockingEdges || []).some(([a, b]) =>
              [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|') === ek
            );
            if (!isBlocked) neighbors.push(nk);
          }
        }
      }
      adjacency[k] = neighbors;
    }
  }
  return { spaces, adjacency, terrain, blocking, movementBlockingEdges: movementBlockingEdges || [] };
}

/** Run movement tests. Returns 0 if pass, 1 if fail. */
async function runMovementTests() {
  const profile = {
    size: '1x1', cols: 1, rows: 1, isLarge: false, allowDiagonal: true, canRotate: false,
    isMassive: false, isMobile: false, ignoreDifficult: false, ignoreBlocking: false,
    ignoreFigureCost: false, canEndOnOccupied: false,
  };
  let passed = 0, failed = 0;

  const assert = (name, ok, detail = '') => {
    if (ok) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); failed++; }
  };

  console.log('\n=== Movement Tests ===\n');

  // Case 1: Empty board, basic reachability
  {
    const grid = buildTestGrid5x5();
    const board = buildTempBoardState(grid, []);
    const reachable = [...(computeMovementCache('a1', 4, board, profile).cells.keys())];
    assert('Empty 4 MP from a1 reaches multiple spaces', reachable.length >= 10);
  }

  // Case 2: Diagonal past enemy (corner cut) - 1 MP
  {
    const grid = buildTestGrid5x5();
    const board = buildTempBoardState(grid, ['b2']);
    const cache = computeMovementCache('a1', 4, board, profile);
    const costToC3 = cache.cells.get('c3')?.cost;
    const path = getMovementPath(cache, 'a1', 'c3', '1x1', profile);
    assert('Reach c3 within 4 MP (enemy at b2)', costToC3 !== undefined && costToC3 <= 4);
    assert('Path a1→c3 exists', path.length >= 2 && path[0] === 'a1' && path[path.length - 1] === 'c3');
  }

  // Case 3: Through enemy costs +1 MP; cannot end on occupied
  {
    const grid = buildTestGrid5x5({ blocked: ['a2', 'b2'] });
    const board = buildTempBoardState(grid, ['b1'], ['b1']);
    const cache = computeMovementCache('a1', 5, board, profile);
    const targetB1 = getMovementTarget(cache, 'b1');
    assert('Cannot end on b1 (occupied)', targetB1 == null);
    const costToC1 = cache.cells.get('c1')?.cost;
    assert('A1→B1→C1 through hostile: 2+1=3 MP (only path)', costToC1 === 3, `got ${costToC1}`);
  }

  // Case 3b: Through friendly costs no extra; cannot end on occupied
  {
    const grid = buildTestGrid5x5({ blocked: ['a2', 'b2'] });
    const board = buildTempBoardState(grid, ['b1'], []);
    const cache = computeMovementCache('a1', 5, board, profile);
    const targetB1 = getMovementTarget(cache, 'b1');
    assert('Cannot end on b1 (occupied by friendly)', targetB1 == null);
    const costToC1 = cache.cells.get('c1')?.cost;
    assert('A1→B1→C1 through friendly: 2 MP (no extra)', costToC1 === 2, `got ${costToC1}`);
  }

  // Case 3c: Through two hostiles = 5 MP (2+2+1)
  {
    const grid = buildTestGrid5x5({ blocked: ['a2', 'b2', 'c2', 'd2'] });
    const board = buildTempBoardState(grid, ['b1', 'c1'], ['b1', 'c1']);
    const cache = computeMovementCache('a1', 6, board, profile);
    const costToD1 = cache.cells.get('d1')?.cost;
    assert('A1→B1→C1→D1 through two hostiles: 2+2+1=5 MP', costToD1 === 5, `got ${costToD1}`);
  }

  // Case 3d: Difficult + hostile in same space = 3 MP (costs stack)
  {
    const grid = buildTestGrid5x5({ blocked: ['a2', 'b2'], difficult: ['b1'] });
    const board = buildTempBoardState(grid, ['b1'], ['b1']);
    const cache = computeMovementCache('a1', 5, board, profile);
    const costToC1 = cache.cells.get('c1')?.cost;
    assert('B1 difficult+hostile costs 3 MP (1+1+1)', costToC1 === 4, `got ${costToC1}`);
  }

  // Case 4: Difficult terrain
  {
    const grid = buildTestGrid5x5({ difficult: ['b1'] });
    const board = buildTempBoardState(grid, []);
    const cache = computeMovementCache('a1', 4, board, profile);
    const costB1 = cache.cells.get('b1')?.cost;
    assert('Difficult b1 costs 2 MP', costB1 === 2);
  }

  // Case 4b: Massive/Mobile ignore difficult terrain
  {
    const grid = buildTestGrid5x5({ difficult: ['b1'] });
    const board = buildTempBoardState(grid, []);
    const massiveProfile = { ...profile, ignoreDifficult: true };
    const cache = computeMovementCache('a1', 4, board, massiveProfile);
    const costB1 = cache.cells.get('b1')?.cost;
    assert('Massive/Mobile: difficult b1 costs 1 MP', costB1 === 1, `got ${costB1}`);
  }

  // Case 5: Blocking
  {
    const grid = buildTestGrid5x5({ blocked: ['b1'] });
    const board = buildTempBoardState(grid, []);
    const cache = computeMovementCache('a1', 4, board, profile);
    assert('Blocked b1 unreachable', cache.cells.get('b1') == null);
  }

  // Case 6: Movement-blocking edge
  {
    const grid = buildTestGrid5x5({ movementBlockingEdges: [['a1', 'b1']] });
    const board = buildTempBoardState(grid, []);
    const cache = computeMovementCache('a1', 4, board, profile);
    const directB1 = cache.cells.get('b1')?.cost === 1;
    assert('Movement-blocking a1-b1: cannot move directly', !directB1);
  }

  // Case 7: Path includes waypoints
  {
    const grid = buildTestGrid5x5();
    const board = buildTempBoardState(grid, []);
    const cache = computeMovementCache('a1', 4, board, profile);
    const path = getMovementPath(cache, 'a1', 'c3', '1x1', profile);
    assert('Path a1→c3 exists and starts with a1', path.length >= 2 && path[0] === 'a1');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  return failed > 0 ? 1 : 0;
}

/** Movement bank display text (green progress bar). */
function getMovementBankText(displayName, remaining, total) {
  return _getMovementBankTextPure(displayName, remaining, total);
}

async function updateMovementBankMessage(game, msgId, client) {
  return _updateMovementBankMessagePure(game, msgId, client, { getMovementBankText, discordCatch });
}

async function ensureMovementBankMessage(game, msgId, client) {
  return _ensureMovementBankMessagePure(game, msgId, client, { getMovementBankText });
}

/** Fisher-Yates shuffle. Mutates array in place. */
function shuffleArray(arr) { return _shuffleArrayPure(arr); }

/** Filter zone spaces to only those valid as top-left for a unit of given size (all footprint cells in zone, unoccupied, and not blocking).
 *  Accepts both 5-arg (without getFootprintCells) and 6-arg (with getFootprintCells) call conventions. */
function filterValidTopLeftSpaces(zoneSpaces, occupiedSpaces, size, arg4, arg5, arg6) {
  // Callers in setup.js pass 6 args: (zones, occupied, size, getFootprintCells, blocking, ignoreBlocking)
  // The wrapper injects getFootprintCells, so detect and skip the caller's copy when present.
  if (typeof arg4 === 'function') {
    return _filterValidTopLeftSpacesPure(zoneSpaces, occupiedSpaces, size, getFootprintCells, arg5, arg6);
  }
  // 5-arg form: (zones, occupied, size, blocking, ignoreBlocking)
  return _filterValidTopLeftSpacesPure(zoneSpaces, occupiedSpaces, size, getFootprintCells, arg4, arg5);
}

/** Maps that are play-ready: have deployment zones, map-spaces (spaces/adjacency), and Play ready? checked so the bot can draw from the pool. */
function getPlayReadyMaps() {
  return _getPlayReadyMapsPure({ getDeploymentZones, getMapRegistry, getMapData });
}

/** Lazy-cached destruct test decks (for seed validation autocomplete + game creation). */
let _destructTestDecks = null;
function getDestructTestDecks() {
  if (!_destructTestDecks) {
    _destructTestDecks = JSON.parse(readFileSync(join(rootDir, 'data', 'destruct-test-decks.json'), 'utf8'));
  }
  return _destructTestDecks;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/** Global readiness gate — false until the ready handler completes. */
let botReady = false;
let _verifyCounter = 0;

/** User IDs currently creating a test game (prevents duplicate creation from double-send or double-click). */
const testGameCreationInProgress = new Set();
/** Message IDs we've already handled for testgame (prevents duplicate from Discord firing messageCreate twice). */
const processedTestGameMessageIds = new Set();
let gameIdCounter = 1;

/** Pick a random scenario with status "testready" and implemented in runDraftRandom. */
function getRandomTestreadyScenario(p2IsBot = true) {
  return _getRandomTestreadyScenarioPure(p2IsBot, { rootDir, IMPLEMENTED_SCENARIOS, getTimingTestInfo });
}

/** Read primaryCard for a scenario from test-scenarios.json. Returns card name or null. */
function getScenarioPrimaryCard(scenarioId) {
  return _getScenarioPrimaryCardPure(scenarioId, { rootDir });
}

/** Count active (non-ended) games the player is in. */
function countActiveGamesForPlayer(playerId) {
  return _countActiveGamesForPlayerPure(playerId, getGamesMap());
}

// Load games at startup (async)
await loadGames();

const CATEGORIES = {
  general: '📢 General',
  games: '⚔️ Games',
  archived: '📁 Archived Games',
  admin: '🛠️ Bot / Admin',
};

const GAME_TAGS = [
  { name: 'Slow' },
  { name: 'Normal' },
  { name: 'Fast' },
  { name: 'Hyperspeed' },
];

const SAMPLE_DECK_P1 = {
  name: 'Imperial Test Deck',
  dcList: ['Darth Vader', 'Stormtrooper (Elite)', 'Stormtrooper (Regular)', 'Stormtrooper (Regular)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Lightning', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
  dcCount: 4,
  ccCount: 15,
};

const SAMPLE_DECK_P2 = {
  name: 'Rebel Test Deck',
  dcList: ['Luke Skywalker', 'Rebel Trooper (Elite)', 'Rebel Trooper (Regular)', 'Rebel Trooper (Regular)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Push', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
  dcCount: 4,
  ccCount: 15,
};

const DEFAULT_DECK_REBELS = {
  name: 'Default Rebels',
  dcList: ['Luke Skywalker', 'Wookiee Warrior (Elite)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Push', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
  dcCount: 2,
  ccCount: 15,
};

const DEFAULT_DECK_SCUM = {
  name: 'Default Scum',
  dcList: ['Boba Fett', 'Nexu (Elite)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lure of the Dark Side', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons', 'Urgency', 'Wookiee Rage'],
  dcCount: 2,
  ccCount: 15,
};

const DEFAULT_DECK_IMPERIAL = {
  name: 'Default Imperial',
  dcList: ['Darth Vader', 'Emperor Palpatine', 'Stormtrooper (Elite)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Lightning', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
  dcCount: 3,
  ccCount: 15,
};

/** Parse playableBy from cc-effects into traits. */
function parsePlayableByToTraits(playableBy) {
  return _parsePlayableByToTraitsPure(playableBy);
}

/** Build DC_BY_TRAIT from dc-effects: affiliation -> trait -> [dcNames]. */
function getDcByTrait() {
  return _getDcByTraitPure({ getDcEffects });
}

/** Check and retool decks so the scenario is viable. */
function retoolDecksForScenario(p1Deck, p2Deck, scenarioId) {
  return _retoolDecksForScenarioPure(p1Deck, p2Deck, scenarioId, { rootDir, getCcEffect, getDcEffects });
}

const CHANNELS = {
  announcements: { name: 'announcements', parent: 'general', type: ChannelType.GuildText },
  rulesAndFaq: { name: 'rules-and-faq', parent: 'general', type: ChannelType.GuildText },
  general: { name: 'general', parent: 'general', type: ChannelType.GuildText },
  lfg: { name: 'lfg', parent: 'general', type: ChannelType.GuildText },
  newGamesPosts: { name: 'new-games', parent: 'general', type: ChannelType.GuildForum },
  activeGames: { name: 'active-games', parent: 'general', type: ChannelType.GuildText },
  botLogs: { name: 'bot-logs', parent: 'admin', type: ChannelType.GuildText },
  suggestions: { name: 'suggestions', parent: 'admin', type: ChannelType.GuildText },
  requestsAndSuggestions: { name: 'bot-requests-and-suggestions', parent: 'general', type: ChannelType.GuildForum },
};


/** Get window button row for Hand channel when in End of Round window and it's this player's turn. */
function getHandWindowButtonRow(game, playerNum, gameId) {
  return _getHandWindowButtonRowPure(game, playerNum, gameId, { getPlayerId });
}

/** Build hand channel message payload (delegates to src/rendering.js, injecting local getHandWindowButtonRow). */
function buildHandDisplayPayload(hand, deck, gameId, game = null, playerNum = 1) {
  return _buildHandDisplayPayloadPure(_buildHandDisplayPayload, hand, deck, gameId, game, playerNum, { getPlayerId });
}

// createPlayAreaChannels – delegated to src/game-creation.js
const createPlayAreaChannels = _createPlayAreaChannels;

// createHandThreads – delegated to src/engine/game-creation-bridge.js
function createHandThreads(client, game) {
  return _createHandThreadsBridge(client, game, { _createHandThreads, discordCatch });
}

// createGameChannels – delegated to src/engine/game-creation-bridge.js
function createGameChannels(guild, player1Id, player2Id) {
  return _createGameChannelsBridge(guild, player1Id, player2Id, {
    _createGameChannels,
    CATEGORIES,
    getGameIdCounter: () => gameIdCounter,
    setGameIdCounter: (v) => { gameIdCounter = v; },
  });
}

// createBoardChannel – delegated to src/game-creation.js
const createBoardChannel = _createBoardChannel;

/**
 * Create a test game (shared by #lfg message handler and HTTP POST /testgame).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {string} userId - Discord user ID (P1)
 * @param {string|null} scenarioId - e.g. 'smoke_grenade'
 * @param {import('discord.js').TextChannel} feedbackChannel - where to send "Test game #X created" (or editMessageInstead)
 * @param {{ editMessageInstead?: import('discord.js').Message, player2Id?: string }} [options]
 * @returns {Promise<{ gameId: string }>}
 */
/**
 * Timing → test requirements. Each timing describes what game state is needed to trigger the card,
 * whether P2 must be a real player, and what the test prompt should tell the user.
 */
const TIMING_TEST_REQUIREMENTS = {
  specialAction:                  { needsOpponent: false, category: 'selfAction',    prompt: 'Activate a DC, then use it as one of your actions.' },
  doubleActionSpecial:            { needsOpponent: false, category: 'selfAction',    prompt: 'Activate a DC — this costs both actions. Make sure you have 2 remaining.' },
  duringActivation:               { needsOpponent: false, category: 'selfAction',    prompt: 'Activate a DC. The card can be played during that activation.' },
  startOfActivation:              { needsOpponent: false, category: 'selfAction',    prompt: 'Activate a DC. A prompt should appear at the start of activation.' },
  endOfActivation:                { needsOpponent: false, category: 'selfAction',    prompt: 'Activate a DC and use your actions. The card triggers at the end of activation.' },
  whenYouDeclareAttack:           { needsOpponent: false, category: 'selfAttack',    prompt: 'Activate a DC and choose Attack. The card triggers when you declare the attack.' },
  duringAttack:                   { needsOpponent: false, category: 'selfAttack',    prompt: 'Activate a DC and choose Attack on a target. The card triggers during the attack.' },
  afterAttacking:                 { needsOpponent: false, category: 'selfAttack',    prompt: 'Activate a DC, Attack a target, and resolve. The card triggers after combat resolves.' },
  whileDefending:                 { needsOpponent: true,  category: 'opponentAttack', prompt: 'Switch to P2, activate a P2 DC, and Attack one of P1\'s figures. The card triggers during defense.' },
  whenAttackDeclaredOnYou:        { needsOpponent: true,  category: 'opponentAttack', prompt: 'Switch to P2, activate a P2 DC, and Attack one of P1\'s figures. The card triggers when the attack is declared.' },
  afterAttackTargetingYouResolved:{ needsOpponent: true,  category: 'opponentAttack', prompt: 'Switch to P2, Attack one of P1\'s figures, and resolve combat. The card triggers after the attack resolves.' },
  startOfRound:                   { needsOpponent: false, category: 'roundPhase',    prompt: 'The card triggers at the start of a round. Check the Game Log for the prompt.' },
  endOfRound:                     { needsOpponent: false, category: 'roundPhase',    prompt: 'End the round (both players pass/finish all activations). The card triggers at end of round.' },
  startOfStatusPhase:             { needsOpponent: false, category: 'roundPhase',    prompt: 'End the round so the Status Phase begins. The card triggers at the start of the Status Phase.' },
  afterUniqueHostileDefeated:     { needsOpponent: false, category: 'eventBased',    prompt: 'Defeat a unique hostile figure (Attack until one is eliminated). The card triggers after the defeat.' },
  whenCcPlayed:                   { needsOpponent: true,  category: 'eventBased',    prompt: 'Have the opponent play a CC first. This card reacts to an opponent\'s CC being played.' },
  immediate:                      { needsOpponent: false, category: 'immediate',     prompt: 'Play the card — its effect resolves immediately.' },
};

/** Get timing-aware test instructions for a CC. Returns { needsOpponent, prompt, category } or a fallback. */
function getTimingTestInfo(ccName) {
  const effect = getCcEffect(ccName);
  if (!effect) return { needsOpponent: false, prompt: 'Activate a DC, then play the card.', category: 'unknown' };
  const timing = (effect.timing || '').trim();
  const req = TIMING_TEST_REQUIREMENTS[timing];
  if (req) return req;
  return { needsOpponent: false, prompt: 'Activate a DC, then play the card.', category: 'unknown' };
}

/** Validate whether a testready scenario can actually be tested. Returns { valid, reason, needsOpponent }. */
/** Validate whether a testready scenario can actually be tested. */
function validateTestreadyScenario(scenarioId, p2IsBot = true) {
  return _validateTestreadyScenarioPure(scenarioId, p2IsBot, { rootDir, getTimingTestInfo });
}

const IMPLEMENTED_SCENARIOS = [
  'smoke_grenade', 'focus', 'blitz', 'smuggled_supplies', 'dangerous_bargains',
  'recovery', 'take_initiative', 'positioning_advantage', 'rally', 'brace_yourself',
  'strategic_shift', 'inspiring_speech', 'wild_attack', 'stimulants', 'hit_and_run',
  'brace_for_impact', 'against_the_odds', 'force_surge', 'counter_attack', 'negation',
  'celebration', 'flurry_of_blades', 'cut_lines', 'battle_scars', 'shoot_the_messenger',
  'eor_cc_window', 'sor_cc_window', 'mid_combat',
];

// ── Phase-jump scenario mutator helpers ──────────────────────────────────────
function getScenarioMutator(scenarioId) {
  return SCENARIO_MUTATORS[scenarioId] || null;
}

/** Read howToTest for a scenario from test-scenarios.json. */
function getScenarioHowToTest(scenarioId) {
  try {
    const data = JSON.parse(readFileSync(join(rootDir, 'data', 'test-scenarios.json'), 'utf8'));
    return (data.scenarios || {})[scenarioId]?.howToTest || null;
  } catch { return null; }
}

// createTestGame – delegated to src/engine/game-creation-bridge.js
function createTestGame(client, guild, userId, scenarioId, feedbackChannel, options = {}) {
  return _createTestGameBridge(client, guild, userId, scenarioId, feedbackChannel, options, {
    _createTestGame, testGameCreationInProgress, countActiveGamesForPlayer, MAX_ACTIVE_GAMES_PER_PLAYER,
    createGameChannels, CURRENT_GAME_VERSION, setGame, getScenarioPrimaryCard,
    IMPLEMENTED_SCENARIOS, runDraftRandom, getCcEffect, getTimingTestInfo,
    discordCatch, COLORS, getGeneralSetupButtons, saveGames,
    // Phase-jump mutator deps
    getScenarioMutator,
    getScenarioHowToTest,
    mutatorDeps: {
      setRoundPhase, ROUND_PHASES, logGameAction, updatePlayAreaDcButtons,
      dcExhaustedState, saveGames, cleanupRoundStart, sendPhaseGateMessages,
      updateHandChannelMessages,
    },
    deleteGameChannelsAndGame,
    cleanupCtx: {
      client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
      deleteGameFromDb,
    },
  });
}

function extractGameIdFromInteraction(interaction) {
  return _extractGameIdFromInteractionPure(interaction, { getGamesMap, dcMessageMeta });
}

/** Resolve game ID for per-game mutex locking. */
function resolveGameIdForLock(interaction) {
  return _resolveGameIdForLockPure(interaction, {
    getHandlerKey, getGame, dcMessageMeta, extractGameIdFromInteraction,
    findGameByChannel, getGamesMap,
  });
}

/** Shared options for withAtomicGameLock — snapshot/rollback + commit save. */
const atomicOpts = {
  getGame,
  setGame,
  commitFn: () => saveGames(),
  onRollback: (gid) => repopulateDcMapsForGame(gid),
};


function extractGameIdFromMessage(message) {
  return _extractGameIdFromMessagePure(message, { findGameByChannel, getGamesMap });
}

/** After map selection: randomly pick A or B mission card, post to Game Log, pin it. */
async function postMissionCardAfterMapSelection(game, client, map) {
  return _postMissionCardAfterMapSelectionPure(game, client, map, {
    getMissionCardsData, logGameAction, resolveMissionCardImagePath, rootDir,
    AttachmentBuilder, discordCatch,
  });
}

/** Post mission card when game.selectedMission and game.selectedMap are already set (e.g. Competitive). */
async function postPinnedMissionCardFromGameState(game, client) {
  return _postPinnedMissionCardFromGameStatePure(game, client, {
    getMissionCardsData, logGameAction, resolveMissionCardImagePath, rootDir,
    AttachmentBuilder, discordCatch,
  });
}

/** Per-figure deploy labels (delegates to discord with helpers). */
function getDeployFigureLabels(dcList, game) {
  return _getDeployFigureLabelsPure(dcList, game, { getDeployFigureLabelsFromDiscord, resolveDcName, isFigurelessDc, getDcStats });
}

/** Deploy button rows (delegates to discord with helpers). */
function getDeployButtonRows(gameId, playerNum, dcList, zone, figurePositions, game) {
  return _getDeployButtonRowsPure(gameId, playerNum, dcList, zone, figurePositions, game, { getDeployButtonRowsFromDiscord, resolveDcName, isFigurelessDc, getDcStats });
}

/** Rebuilds deploy prompt messages for a player, removing buttons for already-deployed figures. */
async function updateDeployPromptMessages(game, playerNum, client) {
  return _updateDeployPromptMessagesPure(game, playerNum, client, {
    getInitiativePlayerNum, getHandChannelId, getPlayerDeploymentZones, getSquad,
    getDeployButtonRowsFromDiscord, resolveDcName, isFigurelessDc, getDcStats,
    getDeploymentMapAttachment,
  });
}

// getFiguresForRender, buildMissionTokens, getMapTokensForRender — imported from src/rendering.js

// getActivationMinimapAttachment, getMovementMinimapAttachment — imported from src/rendering.js

/** Returns AttachmentBuilder for CC/DC space choice (zoomed to validSpaces, labels on those coords). */
async function getMapAttachmentForSpaces(game, validSpaces) {
  return _getMapAttachmentForSpacesPure(game, validSpaces, { getFiguresForRender, getMapTokensForRender, renderMap, AttachmentBuilder });
}

// getDeploymentMapAttachment — imported from src/rendering.js

/**
 * Compute persistent VP bonus from crates in deployment zones (Devaron Garrison B).
 * "For each crate in a player's deployment zone, that player counts as having 6 additional VPs."
 */
function getCrateDeploymentVpBonus(game) {
  return _getCrateDeploymentVpBonusPure(game, { getMapTokensData, normalizeCoord, getInitiativePlayerNum, getDeploymentZones, getPlayerDeploymentZones });
}

/**
 * Post Devaron Garrison B door-selection buttons for the next player in game.pendingDoorSelections.
 * @param {object} game
 * @param {Array} allDoors - from map-tokens.json, array of [a, b] coordinate pairs
 * @param {import('discord.js').TextChannel} channel - general channel
 * @param {string} gameId
 */
async function postDevaronDoorButtons(game, allDoors, channel, gameId) {
  return _postDevaronDoorButtonsPure(game, allDoors, channel, gameId, {
    getPlayerId, discordCatch,
  });
}

/**
 * Post crate-push buttons for Devaron Garrison B end-of-round crate push phase.
 * @param {object} game
 * @param {import('discord.js').TextChannel} channel - general channel
 * @param {string} gameId
 */
async function postDevaronCratePushPrompts(game, channel, gameId) {
  return _postDevaronCratePushPromptsPure(game, channel, gameId, {
    getMapTokensData, getPlayerId, getSpaceController, discordCatch,
  });
}

/**
 * Post Krykna push selection buttons for Chopper Base A end-of-round push phase.
 * Shows the next player in game.pendingKryknaPushQueue buttons for each un-pushed Krykna.
 */
async function postKryknaPushButtons(game, channel, gameId) {
  return _postKryknaPushButtonsPure(game, channel, gameId, {
    getPlayerId, discordCatch,
  });
}

async function postFluctuationSwapButtons(game, channel, gameId, playerNum) {
  return _postFluctuationSwapButtonsPure(game, channel, gameId, playerNum, {
    getPlayerId, getMapTokensData, discordCatch, getCurrentFluctuationPositions,
  });
}

/** Check win conditions. Returns { ended, winnerId?, reason? }. Posts game-over and sets game.ended if ended. */
/**
 * Compute persistent VP bonus from Anchorhead A patron tokens.
 * Table: 0 patrons=0VP, 1=2VP, 2=5VP, 3=10VP, 4=20VP.
 */
function getAnchorheadPatronVpBonus(game) {
  return _getAnchorheadPatronVpBonusPure(game);
}

/** Combined mission VP bonus (crate deployment + patron tokens). Returns { p1, p2 } or undefined if no bonuses apply. */
function getMissionVpBonus(game) {
  return _getMissionVpBonusPure(game, { getMapTokensData, normalizeCoord, getInitiativePlayerNum, getDeploymentZones, getPlayerDeploymentZones });
}

async function checkWinConditions(game, client) {
  return _checkWinConditionsPure(game, client, {
    getCrateDeploymentVpBonus, getAnchorheadPatronVpBonus, postGameOver, logGameAction, getDiceData,
  });
}

/** Resolve a VP tie when both players reach 40+ VP with the same total. */
async function resolveVpTiebreaker(game, client, tiedVp) {
  return _resolveVpTiebreakerPure(game, client, tiedVp, { logGameAction, getDiceData });
}

/** Post a public achievement unlock notification to #achievements. */
async function postAchievementNotification(client, channelId, userId, def) {
  try {
    const ch = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setTitle(`${def.icon || '🏆'} Achievement Unlocked!`)
      .setDescription(`<@${userId}> unlocked **${def.name}**\n${def.description}`);
    await ch.send(sanitizeMentions({ content: `<@${userId}>`, embeds: [embed], allowedMentions: { users: [userId] } }));
  } catch (err) {
    console.error('[Achievements] Failed to post notification:', err.message);
  }
}

async function postGameOver(game, client, winnerId, reason) {
  return _postGameOverPure(game, client, winnerId, reason, {
    setPhase, PHASES, cleanupGameLock, cleanupGameMaps, pendingIllegalSquad, pendingSquadConfirm,
    buildScorecardEmbed, getMissionVpBonus, isDbConfigured, insertCompletedGame,
    achievementsChannelId, getStatsSummaryForPlayer, checkAndPostAchievements,
    checkAndGrantAchievements, postAchievementNotification, saveGames,
    clearBuffer, clearEventLogSeqCounter, clearDomainSeqCounter,
    clearGameErrorThread, cleanupCompanionEmbedDeps,
  });
}

/** Returns true if game ended (and replied to user). Call after getGame() in handlers to block further actions. */
async function replyIfGameEnded(game, interaction) {
  return _replyIfGameEndedPure(game, interaction, { discordCatch });
}

/** Returns a player's zone label, e.g. "[RED] " or "[BLUE] ", or "" if unknown. Used by handlers. */
function getPlayerZoneLabel(game, playerId) {
  return _getPlayerZoneLabelPure(game, playerId);
}

/** Refresh all game components with latest data (DC stats, CC images, etc.). Reloads JSON data first. */
async function refreshAllGameComponents(game, client) {
  return _refreshAllGameComponentsPure(game, client, {
    reloadGameData, buildBoardMapPayload, dcMessageMeta, isDepletedRemovedFromGame,
    dcExhaustedState, dcHealthState, getDcStats, isFigurelessDc, getPlayAreaId,
    buildDcEmbedAndFiles, getConditionsForDcMessage, getDcUpgradeAttachments,
    getDcPlayAreaComponents, getCompanionDescriptionForDc, EmbedBuilder, COLORS,
    getNicknamesForDcMessage, getCcHand, getCcDeck, getHandChannelId,
    buildHandDisplayPayload, discordCatch, getHandVisualEmbed, getCcDiscard,
    getDiscardThreadId, getDiscardPileEmbed, getDiscardPileButtons,
    getDcMessageIds, dcAttachmentMessageIdsKey, ccAttachmentsKey, dcAttachmentsKey,
    buildAttachmentEmbedsAndFiles, getTokensForDcMessage,
  });
}

/** Returns { content, files?, embeds?, components } for posting the game map. Delegates to src/rendering.js with local deps injected. */
async function buildBoardMapPayload(gameId, map, game) {
  return _buildBoardMapPayload(gameId, map, game, client, { getMissionVpBonus });
}

/** Delete setup messages from Game Log when Round 1 begins. */
async function clearPreGameSetup(game, client) {
  return _clearPreGameSetupPure(game, client);
}

/**
 * Reorder one player's play area so attachment messages appear directly after their parent DC.
 * Deletes all DC + attachment messages, then re-sends them interleaved in correct order.
 * Only runs when the player actually has attachment messages to interleave.
 */
async function reorderPlayAreaAfterAttachments(game, playerNum, client) {
  return _reorderPlayAreaAfterAttachmentsPure(game, playerNum, client, {
    getDcList, getDcMessageIds, dcAttachmentMessageIdsKey, ccAttachmentsKey, dcAttachmentsKey,
    getPlayAreaId, buildDcEmbedAndFiles, getNicknamesForDcMessage, dcMessageMeta, dcExhaustedState,
    dcHealthState, getDcPlayAreaComponents, buildAttachmentEmbedsAndFiles,
  });
}

/** Called when all setup attachments are placed: reorder play area, then start deployment. */
async function finishSetupAttachments(game, client) {
  return _finishSetupAttachmentsPure(game, client, {
    reorderPlayAreaAfterAttachments, setPhase, PHASES, clearPreGameSetup,
    runPostDeployPhase, logGameAction, saveGames, _sendCcShuffleDrawPrompts,
    startDeploymentAfterAttachments: (g, c) => _startDeploymentAfterAttachments(g, c, buildAllDeps()),
  });
}

/** Send CC shuffle/draw prompts to both players' hand channels. */
async function _sendCcShuffleDrawPrompts(game, client) {
  const generalChannel = await client.channels.fetch(game.generalId);
  const initPlayerNum = getInitiativePlayerNum(game);
  const deployContent = `<@${game.initiativePlayerId}> (${getInitiativePlayerZoneLabel(game)}**Player ${initPlayerNum}**) **Both players have deployed.** Both players: draw your starting hands in the **Your Hand** thread (inside your Play Area). Round 1 will begin when both have drawn.`;
  await generalChannel.send(sanitizeMentions({
    content: deployContent,
    allowedMentions: { users: [game.initiativePlayerId] },
  }));
  const p1CcList = game.player1Squad?.ccList || [];
  const p2CcList = game.player2Squad?.ccList || [];
  const p1Placed = (game.p1CcAttachments && Object.values(game.p1CcAttachments).flat()) || [];
  const p2Placed = (game.p2CcAttachments && Object.values(game.p2CcAttachments).flat()) || [];
  const p1DeckCount = p1CcList.length - p1Placed.length;
  const p2DeckCount = p2CcList.length - p2Placed.length;
  const ccDeckText = (list) => list.length ? list.join(', ') : '(no command cards)';
  try {
    const p1HandChannel = await client.channels.fetch(game.p1HandId);
    const p2HandChannel = await client.channels.fetch(game.p2HandId);
    const p1DeckList = p1CcList.filter((c) => !p1Placed.includes(c));
    const p2DeckList = p2CcList.filter((c) => !p2Placed.includes(c));
    await p1HandChannel.send({
      content: `**Your Command Card deck** (${p1DeckCount} cards):\n${ccDeckText(p1DeckList)}\n\nWhen ready, shuffle and draw your starting 3.`,
      components: [getCcShuffleDrawButton(game.gameId)],
    });
    await p2HandChannel.send({
      content: `**Your Command Card deck** (${p2DeckCount} cards):\n${ccDeckText(p2DeckList)}\n\nWhen ready, shuffle and draw your starting 3.`,
      components: [getCcShuffleDrawButton(game.gameId)],
    });
  } catch (err) {
    console.error('Failed to send CC deck prompt after setup attachments:', err);
  }
}

/**
 * Run full Draft Random setup: map, hand channels, squads, initiative, deploy, draw.
 * @param {object} game
 * @param {import('discord.js').Client} client
 * @param {{ scenarioId?: string }} [options] - When scenarioId (e.g. 'smoke_grenade'), use scenario decks and seed P1 hand
 */
async function runDraftRandom(game, client, options = {}) {
  return _runDraftRandomPure(game, client, {
    getPlayReadyMaps, setPhase, PHASES, ROUND_PHASES, postMissionCardAfterMapSelection,
    createPlayAreaChannels, createBoardChannel, buildBoardMapPayload, createHandThreads,
    DEFAULT_DECK_REBELS, DEFAULT_DECK_SCUM, retoolDecksForScenario, applySquadSubmission,
    getInitiativePlayerNum, getPlayerDeploymentZones, opponentPlayerNum, logGameAction,
    getDeploymentZones, getSquad, getDeployFigureLabels, parseCoord, dcNameFromFigureKey,
    getEffectiveFigureSize, getFootprintCells, getFigureSize, filterValidTopLeftSpaces, getMapData, getDcKeywords,
    shuffleArray, getScenarioPrimaryCard, ccDeckKey, ccHandKey, ccDrawnKey, getPlayerId,
    getHandChannelId, getHandTooltipEmbed, buildHandDisplayPayload, updateHandVisualMessage,
    updatePlayAreaDcButtons, runStartOfRoundDcEffects, runPostDeployPhase, setRoundPhase,
    sendRoundActivationPhaseMessage, clearPreGameSetup, saveGames,
    // Companion DC embed deps (threaded to runPostDeployPhase → resolveAutoAbility)
    buildDcEmbedAndFiles, dcMessageMeta, dcExhaustedState, dcHealthState,
    getDcPlayAreaComponents, getNicknamesForDcMessage,
  }, options);
}

/** F14: Push one undo step. Trims to MAX_UNDO_DEPTH to prevent unbounded growth. */
function pushUndo(game, entry) {
  return _pushUndoPure(game, entry, { MAX_UNDO_DEPTH });
}

function getSquadSelectEmbed(playerNum, squad) {
  return _getSquadSelectEmbedPure(playerNum, squad);
}

/** Find msgId for DC message containing the given figure (for dcHealthState lookup). */
function findDcMessageIdForFigure(gameId, playerNum, figureKey) {
  return _findDcMessageIdForFigurePure(gameId, playerNum, figureKey, dcMessageMeta);
}

/** Calculate VP awarded for defeating a figure of the given DC. */
function calculateKillVp(dcName) {
  return _calculateKillVpPure(dcName, { isDcCompanion, getDcStats, getDcEffects });
}

/** Nefarious Gains (Jabba the Hutt): when ANY hostile figure is defeated, award 1 objective VP if Jabba alive. */
async function checkNefariousGains(game, defeatedOwnerPN, client) {
  return _checkNefariousGainsPure(game, defeatedOwnerPN, client, { _checkNefariousGainsVp, logGameAction });
}

/** Hunt Dissent (Agent Kallus): on hostile defeat, grant Kallus Block Token if conditions met. */
async function checkHuntDissent(game, attackerPlayerNum, attackerFigureKey, client) {
  return _checkHuntDissentPure(game, attackerPlayerNum, attackerFigureKey, client, {
    getDcEffects, dcNameFromFigureKey, grantPowerTokens, getRange, logGameAction,
  });
}

/** If a deployment group is fully defeated and hasn't activated yet, decrement remaining activations. */
async function decrementActivationIfGroupDefeated(game, playerNum, dcIdx, client) {
  return _decrementActivationIfGroupDefeatedPure(game, playerNum, dcIdx, client, {
    isGroupDefeated, getActivatedDcIndices, setActivationsRemaining, getActivationsRemaining, updateActivationsMessage,
  });
}

/**
 * Look up a figure's DC message and its index in the player's DC list.
 * Combines findDcMessageIdForFigure + getDcMessageIds + getDcList + indexOf.
 * @returns {{ msgId: string|null, dcList: Array, idx: number }}
 */
function lookupFigureDcIndex(game, playerNum, figureKey) {
  return _lookupFigureDcIndexPure(game, playerNum, figureKey, { dcMessageMeta, getDcMessageIds, getDcList });
}

/**
 * Get a display label for a figure — uses DC displayName if found, otherwise falls back.
 * @param {object} game
 * @param {number} playerNum
 * @param {string} figureKey
 * @param {string} [fallback] - if omitted, uses dcNameFromFigureKey(figureKey)
 * @param {number} [maxLen=80] - truncate label to this length
 * @returns {{ msgId: string|null, label: string }}
 */
function getFigureLabel(game, playerNum, figureKey, fallback, maxLen = 80) {
  return _getFigureLabelPure(game, playerNum, figureKey, fallback, maxLen, { dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey });
}

/**
 * Apply direct damage to a figure (NPC damage, env hazards, etc.).
 * Handles HP reduction, death, VP award, and logging.
 * @param {object} game
 * @param {number} playerNum - owning player
 * @param {string} figureKey
 * @param {number} damage
 * @param {string} sourceLabel - shown in log (e.g., "Thug")
 * @param {function} logGameAction
 * @param {object} client
 * @param {Map} dcHealthState
 * @param {Map} dcMessageMeta
 */
async function applyNpcDamageToFigure(game, playerNum, figureKey, damage, sourceLabel, _logGameAction, _client, _dcHealthState, _dcMessageMeta) {
  return _applyNpcDamageToFigurePure(game, playerNum, figureKey, damage, sourceLabel, {
    logGameAction: _logGameAction, client: _client, dcHealthState: _dcHealthState, dcMessageMeta: _dcMessageMeta,
    dcNameFromFigureKey, parseFigureKey, reduceHp, removeFigurePosition,
    opponentPlayerNum, calculateKillVp, awardKillVp, checkNefariousGains,
    getDcMessageIds, getDcList,
    checkHuntDissent, checkWinConditions, checkFriendlyDefeatedPassiveRedraws,
    decrementActivationIfGroupDefeated, ccAttachmentsKey, updateAttachmentMessageForDc,
  });
}

/**
 * Apply direct (non-combat) damage to a figure (reactions, post-combat effects, etc.).
 * Handles HP reduction, death, VP award to the opponent, and thread logging.
 * @param {object} game
 * @param {number} playerNum - owning player of the figure taking damage
 * @param {string} figKey
 * @param {string|null} msgId - DC message ID (may be null; damage skipped if not found)
 * @param {number} damage
 * @param {object} client
 * @param {object|null} thread - Discord thread to send result messages to
 * @param {string} sourceName - label for messages (e.g. "Payback")
 */
async function applyDirectDamageToFigure(game, playerNum, figKey, msgId, damage, client, thread, sourceName) {
  return _applyDirectDamageToFigurePure(game, playerNum, figKey, msgId, damage, client, thread, sourceName, {
    dcHealthState, reduceHp, dcNameFromFigureKey, discordCatch,
    getDcMessageIds, getDcList, removeFigurePosition, opponentPlayerNum,
    calculateKillVp, awardKillVp, checkNefariousGains, checkWinConditions,
    logGameAction, client,
    checkHuntDissent, checkFriendlyDefeatedPassiveRedraws,
    decrementActivationIfGroupDefeated, ccAttachmentsKey, updateAttachmentMessageForDc,
  });
}

/** Remove a specific condition from a figure. No-op if figure or condition not found. */
const filterCondition = _filterCondition;
const isConditionImmune = _isConditionImmune;
const HARMFUL_CONDITIONS = _HARMFUL_CONDITIONS;

/** Send a Bleeding damage prompt to the given channel. Offers "Take 1 damage" or "Prevent (discard CC)". */
async function sendBleedingPrompt(game, channel, figureKey, playerNum, displayName) {
  return _sendBleedingPromptPure(game, channel, figureKey, playerNum, displayName, {
    ccDeckKey, ButtonBuilder, ButtonStyle, ActionRowBuilder, discordCatch,
  });
}

/** Check if a Figurehead-capable figure is available to intercept damage for targetFigureKey. Returns { figureKey, msgId, figIndex, label } or null. */
function findFigureheadFigure(game, defenderPlayerNum, targetFigureKey) {
  return _findFigureheadFigurePure(game, defenderPlayerNum, targetFigureKey, {
    getDcList, getDcEffect, dcNameFromFigureKey, isWithinN,
    findDcMessageIdForFigure, parseFigureKey,
  });
}

/** Resolve combat after rolls (and optional surge). Applies damage, VP, updates embeds/board, clears pendingCombat. */
async function resolveCombatAfterRolls(game, combat, client) {
  return _resolveCombatAfterRollsPure(game, combat, client, {
    logGameAction, dcNameFromFigureKey, parseFigureKey, opponentPlayerNum,
    getDcEffects, getDcEffect, getMapData, computeCombatResult,
    getBoardStateForMovement, getEffectiveFigureSize, getFootprintCells, normalizeCoord,
    getPlayerId, findDcMessageIdForFigure, findFigureheadFigure,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    applyDamageAndFinishCombat,
    discordCatch,
  });
}

/** Apply damage, conditions, defeat logic, and finish combat resolution. Called from resolveCombatAfterRolls and handleFigureheadDecision. */
async function applyDamageAndFinishCombat(game, combat, { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client) {
  return _applyDamageAndFinishCombatPure(game, combat, { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client, {
    logGameAction, saveGames, dcHealthState, dcMessageMeta,
    dcNameFromFigureKey, parseFigureKey, opponentPlayerNum, discordCatch,
    reduceHp, healHp, removeFigurePosition,
    calculateKillVp, awardKillVp, awardObjectiveVp, vpKey,
    getDcList, getDcMessageIds, getDcStats, getDcEffects, getDcEffect, getDcKeywords,
    getPlayerId, getMapData, getEffectiveMapSpaces,
    isWithinN, hasLineOfSight, getRange,
    getFiguresAdjacentToTarget, getFiguresOnOrAdjacentToSpace,
    getEffectiveFigureSize, getFootprintCells, getFigureSize,
    findDcMessageIdForFigure, lookupFigureDcIndex, getFigureLabel,
    getCcHand, getCcEffectsData, getCcEffect,
    ccHandKey, ccDiscardKey, ccDeckKey, ccAttachmentsKey,
    _applyCondition, filterCondition, isConditionImmune, HARMFUL_CONDITIONS,
    isDcUnique, getActivatedDcIndices,
    isDbConfigured, achievementsChannelId, checkAndGrantAchievements, checkAndPostAchievements, postAchievementNotification,
    checkNefariousGains, checkWinConditions, checkHuntDissent,
    checkFriendlyDefeatedPassiveRedraws,
    decrementActivationIfGroupDefeated, updateAttachmentMessageForDc,
    grantMovementBank, grantPowerTokens, getDiceData,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    getCelebrationButtons, getCleaveTargetButtons,
    applyNpcDamageToFigure,
    checkPostCombatSurges,
    finishCombatResolution,
    normalizeCoord,
    sendBleedingPrompt,
  });
}

/** BFS distance check on mapSpaces adjacency (used for Boltslinger, etc.). */
function isWithinN(posA, posB, maxDist, mapId) {
  return _isWithinNPure(posA, posB, maxDist, mapId, getMapData);
}

/**
 * Check for post-combat surge effects that need UI interaction, before finishCombatResolution.
 * Returns true if a pending interaction was triggered (caller should NOT call finishCombatResolution yet).
 * Returns false if nothing triggered (caller should call finishCombatResolution).
 */
async function checkPostCombatSurges(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum) {
  return _checkPostCombatSurgesPure(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum, {
    logGameAction, dcNameFromFigureKey, getFigureLabel, getFigureSize,
    getMapData, getPlayerId, getCcHand, getCcEffect, getCcEffectsData,
    getDcEffects, getFiguresAdjacentToTarget,
    _applyCondition, HARMFUL_CONDITIONS, isConditionImmune,
    ccHandKey, ccDiscardKey, ccDeckKey,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    getFightingKnifeTargetButtons,
    discordCatch,
    updateMovementBankMessage,
    client,
  });
}

/** Send result to thread, clear combat/roll UI, refresh DC embeds and board. */
async function finishCombatResolution(game, combat, resultText, embedRefreshMsgIds, client) {
  return _finishCombatResolutionPure(game, combat, resultText, embedRefreshMsgIds, client, {
    logGameAction, saveGames, dcHealthState, dcMessageMeta, dcExhaustedState,
    dcNameFromFigureKey, parseFigureKey, opponentPlayerNum, discordCatch,
    reduceHp, healHp,
    getDcList, getDcMessageIds, getDcStats, getDcEffect, getDcEffects, getDcKeywords,
    getPlayerId, getPlayAreaId, getMapData,
    isWithinN, getRange,
    findDcMessageIdForFigure, getFigureLabel,
    getCcHand, getCcEffectsData,
    _applyCondition,
    grantMovementBank, grantPowerTokens,
    buildDcEmbedAndFiles, getConditionsForDcMessage, getDcUpgradeAttachments, getNicknamesForDcMessage,
    buildBoardMapPayload,
    updateDcActionsMessage, ensureMovementBankMessage, updateMovementBankMessage,
    sendPowerTokenOverflowUI,
    applyIndiscriminateFireSplash,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    syncHealthStateToList,
  });
}

// handleSidewinderApply, handleSidewinderSkip — extracted to src/handlers/combat-special-effects.js

// handleBoltslingerTarget, handleBoltslingerSkip — extracted to src/handlers/combat-special-effects.js

// handleBoltslingerTarget..handleMissileSalvoDone, applyIndiscriminateFireSplash, advanceSpreadThePain
// — extracted to src/handlers/combat-special-effects.js

/** DCs whose image is in DC Skirmish Upgrades are figureless (incl. Squad Upgrades like [Flame Trooper]); if image is in dc-figures, it's a figure. */
const isFigurelessDc = _isFigurelessDc;
const hasDepleteEffect = _hasDepleteEffect;
const hasExhaustEffect = _hasExhaustEffect;
const getCompanionDescriptionForDc = _getCompanionDescriptionForDc;

function getDeckIllegalPlayCustomId(gameId, playerNum) {
  return _getDeckIllegalPlayCustomIdPure(gameId, playerNum);
}
function getDeckIllegalRedoCustomId(gameId, playerNum) {
  return _getDeckIllegalRedoCustomIdPure(gameId, playerNum);
}

async function sendDeckIllegalAlert(game, isP1, squad, validation, client) {
  return _sendDeckIllegalAlertPure(game, isP1, squad, validation, client, {
    pendingIllegalSquad, getDeckIllegalPlayCustomId, getDeckIllegalRedoCustomId,
  });
}

/**
 * Build a formatted squad confirmation message showing DCs and CCs sorted by cost.
 * @param {object} squad - { dcList, ccList, name }
 * @param {object} validation - { legal, errors, dcTotal, ccCount, ccCost }
 * @returns {string}
 */
function buildSquadConfirmText(squad, validation) {
  return _buildSquadConfirmTextPure(squad, validation, {
    getDcStats, getCcEffect, DC_POINTS_LEGAL, CC_COST_LEGAL,
    validateUpgradeWarnings, validateArmyAffiliation,
  });
}

/**
 * Send squad confirmation message with Confirm/Cancel buttons to the hand channel.
 */
async function sendSquadConfirmation(game, isP1, squad, validation, client) {
  return _sendSquadConfirmationPure(game, isP1, squad, validation, client, {
    pendingSquadConfirm, buildSquadConfirmText,
  });
}

/** True if any DC in this game has actions remaining to spend. */
function hasActionsRemainingInGame(game, gameId) {
  return _hasActionsRemainingInGamePure(game, gameId, dcMessageMeta);
}

/** True when both players have no readied DCs and no actions left to spend in any activated DC. */
function shouldShowEndActivationPhaseButton(game, gameId) {
  return _shouldShowEndActivationPhaseButtonPure(game, gameId, dcMessageMeta);
}

/** Send the round activation phase message (Round X — Your turn!) to Game Log. */
async function sendRoundActivationPhaseMessage(game, client) {
  return _sendRoundActivationPhaseMessagePure(game, client, {
    GAME_PHASES, PHASE_COLOR, shouldShowEndActivationPhaseButton,
    getInitiativePlayerNum, getInitiativePlayerZoneLabel, updateHandChannelMessages,
  });
}

/** Edit the round message to add the End Activation Phase button when conditions are met. */
async function maybeShowEndActivationPhaseButton(game, client) {
  return _maybeShowEndActivationPhaseButtonPure(game, client, {
    shouldShowEndActivationPhaseButton, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, GAME_PHASES, PHASE_COLOR, getInitiativePlayerNum,
    getInitiativePlayerZoneLabel, discordCatch, saveGames,
  });
}

/** Update the DC thread's Actions message with current counter. If all actions exhausted, @ the other player to activate. */
async function updateDcActionsMessage(game, msgId, client) {
  return _updateDcActionsMessagePure(game, msgId, client, {
    dcMessageMeta, getActionsCounterContent, getDcActionButtons,
    getActivationMinimapAttachment, discordCatch, getPlayAreaId,
    dcHealthState, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getDcUpgradeAttachments, getTokensForDcMessage, getDcPlayAreaComponents,
    getPlayerId, ACTION_ICONS, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    shouldShowEndActivationPhaseButton, EmbedBuilder, GAME_PHASES, PHASE_COLOR,
    getInitiativePlayerNum, getInitiativePlayerZoneLabel, saveGames,
    getNicknamesForDcMessage,
  });
}

/** Returns action rows for DC (delegates to discord with game-specific helpers). */
function getDcActionButtons(msgId, dcName, displayName, actionsDataOrRemaining = 2, game = null) {
  return getDcActionButtonsFromDiscord(msgId, dcName, displayName, actionsDataOrRemaining, game, {
    getDcStats,
    getPlayerNumForMsgId: (id) => dcMessageMeta.get(id)?.playerNum ?? 1,
    getPlayableCcSpecialsForDc,
    getPlayableCcEndOfActivationForDc,
    getPlayableCcDoubleActionsForDc,
  });
}

/** True if this DC message was depleted and removed from the game (one-time use). */
function isDepletedRemovedFromGame(game, msgId) {
  return _isDepletedRemovedFromGamePure(game, msgId);
}

/** Returns component rows for a DC message in Play Area (delegates to discord with game-specific helpers). */
function getDcPlayAreaComponents(msgId, exhausted, game, dcName) {
  const gameStarted = (game?.currentRound || 0) >= 1;
  return getDcPlayAreaComponentsFromDiscord(msgId, exhausted, game, dcName, { isDepletedRemovedFromGame, hasDepleteEffect, hasExhaustEffect, isFigurelessDc, getDcStats, gameStarted });
}

/** True if all figures in this deployment group are defeated (or never deployed). */
function isGroupDefeated(game, playerNum, dcIndex) {
  return _isGroupDefeatedPure(game, playerNum, dcIndex, { getDcList, getDcStats });
}

/** Returns ActionRow(s) for Activate buttons (delegates to discord with game-specific helpers). */
function getActivateDcButtons(game, playerNum) {
  return getActivateDcButtonsFromDiscord(game, playerNum, { resolveDcName, isFigurelessDc, isGroupDefeated });
}

/**
 * Per-figure conditions for a DC message (for embed display).
 * @param {object} game
 * @param {{ dcName: string, displayName: string }} meta
 * @returns {string[][]|undefined} conditionsByFigure, or undefined if none
 */
/** Return the list of DC Skirmish Upgrade names attached to the given msgId (checks both players). */
function getDcUpgradeAttachments(game, msgId) {
  return _getDcUpgradeAttachmentsPure(game, msgId);
}

function getConditionsForDcMessage(game, meta) {
  return _getConditionsForDcMessagePure(game, meta, { getDcStats });
}

/** Per-figure power tokens for a DC message (for embed display). */
function getTokensForDcMessage(game, meta) {
  return _getTokensForDcMessagePure(game, meta, { getDcStats });
}

function getNicknamesForDcMessage(game, meta) {
  return _getNicknamesForDcMessagePure(game, meta, { getDcStats });
}

// buildDcEmbedAndFiles — imported from src/rendering.js

// buildDiscardPileDisplayPayload — imported from src/rendering.js

/** Update both Hand channel messages (for window buttons). Call when entering/exiting Start or End of Round window. */
async function updateHandChannelMessages(game, client) {
  return _updateHandChannelMessagesPure(game, client, {
    getCcHand, getCcDeck, getHandChannelId, buildHandDisplayPayload, discordCatch,
  });
}

/** Call after changing player1CcHand/player2CcHand to refresh the Play Area hand visual. */
async function updateHandVisualMessage(game, playerNum, client) {
  return _updateHandVisualMessagePure(game, playerNum, client, {
    getCcHand, getPlayAreaId, getHandVisualEmbed,
  });
}

/** Green = remaining, red = used. Returns e.g. "**Activations:** 🟢🟢🟢🔴 (3/4 remaining)" */
/** Call after changing discard pile to refresh the Play Area discard embed and buttons. */
async function updateDiscardPileMessage(game, playerNum, client) {
  return _updateDiscardPileMessagePure(game, playerNum, client, {
    getCcDiscard, getDiscardThreadId, getPlayAreaId, getDiscardPileEmbed, getDiscardPileButtons,
  });
}

/** Update all DC messages in both Play Areas to show Activate buttons (when both players have drawn). */
async function updatePlayAreaDcButtons(game, client) {
  return _updatePlayAreaDcButtonsPure(game, client, {
    getDcMessageIds, getPlayAreaId, dcMessageMeta, isDepletedRemovedFromGame,
    dcExhaustedState, getDcPlayAreaComponents, discordCatch,
  });
}

async function populatePlayAreas(game, client) {
  return _populatePlayAreasPure(game, client, {
    isFigurelessDc, resolveDcName, getDcStats, isDcAttachment, buildDcEmbedAndFiles,
    getNicknamesForDcMessage, dcMessageMeta, dcExhaustedState, dcHealthState,
    getDcPlayAreaComponents, getPlayAreaTooltipEmbed, getHandVisualEmbed,
    getDiscardPileEmbed, getDiscardPileButtons, getActivationsLine,
  });
}

// applySquadSubmission – delegated to src/engine/game-creation-bridge.js
function applySquadSubmission(game, isP1, squad, client) {
  return _applySquadSubmissionBridge(game, isP1, squad, client, {
    _applySquadSubmission, logGameAction, getHandTooltipEmbed, createPlayAreaChannels,
    createBoardChannel, buildBoardMapPayload, discordCatch,
    populatePlayAreas, COLORS, getDetermineInitiativeButtons, saveGames,
  });
}

// setupServer – delegated to src/engine/game-creation-bridge.js
function setupServer(guild) {
  return _setupServerBridge(guild, { _setupServer, CATEGORIES, CHANNELS, GAME_TAGS });
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    const botmenu = new SlashCommandBuilder()
      .setName('botmenu')
      .setDescription('Open Bot Stuff menu (Kill Game). Use in the Game Log channel of a game.');
    const statcheck = new SlashCommandBuilder()
      .setName('statcheck')
      .setDescription('Show completed games summary, or a specific player\'s record. Use in #statistics.')
      .addUserOption((o) => o.setName('player').setDescription('Show stats for this player (optional)').setRequired(false));
    const affiliationwinrateglobal = new SlashCommandBuilder()
      .setName('affiliationwinrateglobal')
      .setDescription('Win rate by affiliation across all completed games. Use in #statistics.');
    const affiliationwinratepersonal = new SlashCommandBuilder()
      .setName('affiliationwinratepersonal')
      .setDescription('Your win rate by affiliation. Use in #statistics.');
    const affiliationpickrateglobal = new SlashCommandBuilder()
      .setName('affiliationpickrateglobal')
      .setDescription('Pick rate by affiliation across all completed games. Use in #statistics.');
    const affiliationpickratepersonal = new SlashCommandBuilder()
      .setName('affiliationpickratepersonal')
      .setDescription('Your pick rate by affiliation. Use in #statistics.');
    const dcwinrateglobaltopten = new SlashCommandBuilder()
      .setName('dcwinrateglobaltopten')
      .setDescription('Win rate by Deployment Card (top N by games played, global). Use in #statistics.')
      .addIntegerOption((o) => o.setName('limit').setDescription('Max number of DCs to show (default 20)').setMinValue(5).setMaxValue(50));
    const dcwinratepersonaltopten = new SlashCommandBuilder()
      .setName('dcwinratepersonaltopten')
      .setDescription('Your win rate by Deployment Card (top N by games played). Use in #statistics.')
      .addIntegerOption((o) => o.setName('limit').setDescription('Max number of DCs to show (default 20)').setMinValue(5).setMaxValue(50));
    const leaderboard = new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Top players by win rate (min. 5 completed games). Use in #statistics.')
      .addIntegerOption((o) => o.setName('limit').setDescription('Number of players to show (default 10)').setMinValue(3).setMaxValue(50));
    const achievements = new SlashCommandBuilder()
      .setName('achievements')
      .setDescription('Show your earned achievements, or another player\'s.')
      .addUserOption((o) => o.setName('player').setDescription('Show achievements for this player (optional)').setRequired(false));
    const powertoken = new SlashCommandBuilder()
      .setName('power-token')
      .setDescription('Add or remove a Power Token on a figure. Use in Game Log / Map Updates channel.')
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a Power Token to a figure (max 2 per figure)')
          .addStringOption((o) => o.setName('figure').setDescription('Figure key, e.g. Stormtrooper (Regular)-1-0').setRequired(true).setAutocomplete(true))
          .addStringOption((o) =>
            o.setName('type').setDescription('Token type').setRequired(true).addChoices(
              { name: 'Hit (Damage)', value: 'Hit' },
              { name: 'Surge', value: 'Surge' },
              { name: 'Block', value: 'Block' },
              { name: 'Evade', value: 'Evade' },
            )
          )
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a Power Token from a figure')
          .addStringOption((o) => o.setName('figure').setDescription('Figure key').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('index').setDescription('Which token to remove (1 or 2)').setMinValue(1).setMaxValue(2).setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName('list')
          .setDescription('List figures with Power Tokens')
      );
    const condition = new SlashCommandBuilder()
      .setName('condition')
      .setDescription('Add or remove a condition on a figure. Use in Game Log / Map Updates channel.')
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Apply a condition to a figure')
          .addStringOption((o) => o.setName('figure').setDescription('Figure key, e.g. Stormtrooper (Regular)-1-0').setRequired(true).setAutocomplete(true))
          .addStringOption((o) =>
            o.setName('type').setDescription('Condition').setRequired(true).addChoices(
              { name: 'Focus', value: 'Focus' },
              { name: 'Stun', value: 'Stun' },
              { name: 'Bleed', value: 'Bleed' },
              { name: 'Weaken', value: 'Weaken' },
              { name: 'Hide', value: 'Hide' },
            )
          )
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a condition from a figure')
          .addStringOption((o) => o.setName('figure').setDescription('Figure key').setRequired(true).setAutocomplete(true))
          .addStringOption((o) =>
            o.setName('type').setDescription('Condition to remove').setRequired(true).addChoices(
              { name: 'Focus', value: 'Focus' },
              { name: 'Stun', value: 'Stun' },
              { name: 'Bleed', value: 'Bleed' },
              { name: 'Weaken', value: 'Weaken' },
              { name: 'Hide', value: 'Hide' },
            )
          )
      )
      .addSubcommand((s) =>
        s
          .setName('list')
          .setDescription('List figures with conditions')
      );
    const movefigure = new SlashCommandBuilder()
      .setName('move-figure')
      .setDescription('Manually move a figure to any coordinate (bypasses movement rules). Use in Game Log channel.')
      .addStringOption((o) => o.setName('figure').setDescription('Figure key, e.g. Nexu (Regular)-1-0').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('coord').setDescription('Destination coordinate, e.g. m10').setRequired(true));
    const events = new SlashCommandBuilder()
      .setName('events')
      .setDescription('Show recent game events (audit trail). Use in a game channel.')
      .addIntegerOption((o) => o.setName('count').setDescription('Number of events to show (default 10)').setMinValue(1).setMaxValue(50));
    const playai = new SlashCommandBuilder()
      .setName('play-ai')
      .setDescription('Create a new test game against the AI bot. Use in #lfg.')
      .addStringOption((o) => o.setName('scenario').setDescription('Scenario ID (optional, e.g. smoke_grenade)').setRequired(false));
    const addai = new SlashCommandBuilder()
      .setName('add-ai')
      .setDescription('Replace player 2 with AI in the current game. Use in a Game Log channel.')
      .addIntegerOption((o) => o.setName('player').setDescription('Which player to replace with AI (default: 2)').setMinValue(1).setMaxValue(2));
    const favorites = new SlashCommandBuilder()
      .setName('favorites')
      .setDescription('View, rename, or remove your saved favorite decks.');
    const selfplay = new SlashCommandBuilder()
      .setName('selfplay')
      .setDescription('Dev-only AI-vs-AI self-play (admin only). Cycles through all scenarios.')
      .addStringOption((o) => o.setName('action').setDescription('start, stop, status, or seed').setRequired(true)
        .addChoices({ name: 'start', value: 'start' }, { name: 'stop', value: 'stop' }, { name: 'status', value: 'status' }, { name: 'seed', value: 'seed' }))
      .addStringOption((o) => o.setName('p1_deck').setDescription('P1 deck name from destruct-test-decks.json (for seed)').setRequired(false).setAutocomplete(true))
      .addStringOption((o) => o.setName('p2_deck').setDescription('P2 deck name from destruct-test-decks.json (for seed)').setRequired(false).setAutocomplete(true))
      .addStringOption((o) => o.setName('map_id').setDescription('Map ID (for seed)').setRequired(false).setAutocomplete(true));
    const gamestate = new SlashCommandBuilder()
      .setName('gamestate')
      .setDescription('Show diagnostic game state snapshot. Use in a game channel.');
    const commandBody = [
      botmenu.toJSON(), statcheck.toJSON(), powertoken.toJSON(), condition.toJSON(), movefigure.toJSON(),
      events.toJSON(), playai.toJSON(), addai.toJSON(),
      affiliationwinrateglobal.toJSON(), affiliationwinratepersonal.toJSON(),
      affiliationpickrateglobal.toJSON(), affiliationpickratepersonal.toJSON(),
      dcwinrateglobaltopten.toJSON(), dcwinratepersonaltopten.toJSON(),
      leaderboard.toJSON(), achievements.toJSON(), favorites.toJSON(), selfplay.toJSON(),
      gamestate.toJSON(),
    ];
    // Register as guild commands (instant propagation) for each guild
    for (const g of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, g.id), { body: commandBody });
      console.log(`Slash commands registered for guild ${g.name} (${g.id})`);
    }
    // Clear stale global commands
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] }).catch(() => {});
  } catch (err) {
    console.error('Failed to register slash commands:', err.message);
  }
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch();
      const hasLfg = guild.channels.cache.some(
        (c) => c.type === ChannelType.GuildText && c.name === 'lfg'
      );
      const hasNewGamesForum = guild.channels.cache.some(
        (c) => c.type === ChannelType.GuildForum && c.name === 'new-games'
      );
      if (!hasLfg || !hasNewGamesForum) {
        console.log(`Setting up server: ${guild.name}`);
        await setupServer(guild);
        console.log(`Setup complete for ${guild.name}`);
      } else {
        const forum = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildForum && c.name === 'new-games'
        );
        if (forum) {
          await forum.setAvailableTags(GAME_TAGS);
        }
        const generalCat = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORIES.general
        );
        const hasRequestsForum = guild.channels.cache.some(
          (c) => c.type === ChannelType.GuildForum && REQUEST_FORUM_NAMES.includes(c.name)
        );
        if (generalCat && !hasRequestsForum) {
          await guild.channels.create({
            name: 'bot-requests-and-suggestions',
            type: ChannelType.GuildForum,
            parent: generalCat.id,
          });
        }
      }
    } catch (err) {
      console.error(`Setup failed for ${guild.name}:`, err);
    }
  }

  // Reconstruct lobbies from Discord threads so they survive bot restarts
  for (const guild of client.guilds.cache.values()) {
    try {
      const forum = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildForum && c.name === 'new-games'
      );
      if (!forum) continue;
      const activeThreads = await forum.threads.fetchActive();
      let reconstructed = 0;
      for (const [threadId, thread] of activeThreads.threads) {
        if (hasLobby(threadId)) continue; // already in memory
        try {
          const messages = await thread.messages.fetch({ limit: 10, after: '0' });
          const botMsg = messages.find(
            (m) => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title === 'Game Lobby'
          );
          if (!botMsg) continue;
          const desc = botMsg.embeds[0].description || '';
          const playerIds = [...desc.matchAll(/<@(\d+)>/g)].map((m) => m[1]);
          if (playerIds.length === 0) continue;
          const creatorId = playerIds[0];
          const joinedId = playerIds.length >= 2 ? playerIds[1] : null;
          // Determine status from thread name prefix
          let status = 'LFG';
          if (thread.name.startsWith('[Launched]')) continue; // game already created, skip
          if (thread.name.startsWith('[Full]') || joinedId) status = 'Full';
          setLobby(threadId, { creatorId, joinedId, status });
          markLobbyEmbedSent(threadId);
          reconstructed++;
        } catch (err) {
          console.error(`Failed to reconstruct lobby for thread ${threadId}:`, err.message);
        }
      }
      if (reconstructed > 0) {
        console.log(`Reconstructed ${reconstructed} lobby(s) from #new-games in ${guild.name}`);
      }
    } catch (err) {
      console.error(`Lobby reconstruction failed for ${guild.name}:`, err.message);
    }
  }

  // Auto-refresh all active games on startup (picks up any data/code changes from redeploy)
  const allGames = [...getGamesMap().values()];
  const activeGames = allGames.filter(g => g.selectedMap && !g.archived && !g.killed);
  if (activeGames.length > 0) {
    console.log(`Auto-refreshing ${activeGames.length} active game(s)...`);
    for (const game of activeGames) {
      try {
        await refreshAllGameComponents(game, client);
        console.log(`  Refreshed game ${game.gameId}`);
      } catch (err) {
        console.error(`  Failed to refresh game ${game.gameId}:`, err.message);
      }
    }
    console.log('Auto-refresh complete.');
  }

  // Auto-recovery is available on-demand via the Recover button in /botmenu.
  // Both startup and periodic auto-recovery have been removed — async games idle for hours normally.

  // Local HTTP endpoint to create a test game from Cursor/terminal (no need to type in #lfg)
  const guildId = process.env.DISCORD_GUILD_ID;
  const port = Number(process.env.PORT) || Number(process.env.TESTGAME_PORT) || 3999;
  // Helper: read JSON body from request
  function readBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch { resolve({}); }
      });
    });
  }
  // Helper: JSON response with CORS
  function jsonRes(res, status, data) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(data));
  }

  createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // --- Coverage API ---

    // GET /api/coverage/ping — health check for viewer
    if (req.method === 'GET' && req.url === '/api/coverage/ping') {
      jsonRes(res, 200, { ok: true, db: isDbConfigured() });
      return;
    }

    // GET /api/coverage/regions — full coverage map from DB
    if (req.method === 'GET' && req.url === '/api/coverage/regions') {
      const regions = await getCoverageRegions();
      if (regions) {
        jsonRes(res, 200, { regions });
      } else {
        jsonRes(res, 503, { error: 'DB not available' });
      }
      return;
    }

    // GET /api/coverage/statuses — all live statuses
    if (req.method === 'GET' && req.url === '/api/coverage/statuses') {
      const statuses = await getCoverageLiveStatuses();
      jsonRes(res, 200, statuses);
      return;
    }

    // POST /api/coverage/status — upsert one live status
    if (req.method === 'POST' && req.url === '/api/coverage/status') {
      const data = await readBody(req);
      if (!data.regionId || !data.status) {
        jsonRes(res, 400, { error: 'Missing regionId or status' });
        return;
      }
      await upsertCoverageLiveStatus(data.regionId, data.status, data.lastCheck);
      jsonRes(res, 200, { ok: true });
      return;
    }

    // GET /api/coverage/incidents — query incidents
    if (req.method === 'GET' && req.url?.startsWith('/api/coverage/incidents')) {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const opts = {};
      if (url.searchParams.get('severity')) opts.severity = url.searchParams.get('severity');
      if (url.searchParams.get('regionId')) opts.regionId = url.searchParams.get('regionId');
      if (url.searchParams.get('since')) opts.since = url.searchParams.get('since');
      if (url.searchParams.get('limit')) opts.limit = Number(url.searchParams.get('limit'));
      const incidents = await getCoverageIncidents(opts);
      jsonRes(res, 200, incidents);
      return;
    }

    // POST /api/coverage/incident — insert one incident
    if (req.method === 'POST' && req.url === '/api/coverage/incident') {
      const data = await readBody(req);
      if (!data.regionId || !data.severity || !data.note) {
        jsonRes(res, 400, { error: 'Missing regionId, severity, or note' });
        return;
      }
      const row = await insertCoverageIncident(data);
      if (row) {
        // Also update the live status for this region
        await upsertCoverageLiveStatus(data.regionId, data.liveStatus || 'broken', data.lastCheck);
        jsonRes(res, 200, { ok: true, id: row.id, createdAt: row.created_at });
      } else {
        jsonRes(res, 500, { error: 'DB insert failed (DB may not be configured)' });
      }
      return;
    }

    // --- Selfplay API (MCP / external trigger) ---

    if (req.method === 'POST' && req.url === '/api/selfplay' && guildId) {
      const data = await readBody(req);
      const action = data.action || 'start';

      if (action === 'status') {
        const qs = getQueueStatus();
        const activeId = getActiveSelfPlayGameId();
        jsonRes(res, 200, { ...qs, activeGameId: activeId });
        return;
      }

      if (action === 'stop') {
        try {
          stopQueue();
          jsonRes(res, 200, { ok: true, message: 'Self-play stopping after current game.' });
        } catch (err) {
          jsonRes(res, 400, { error: err.message });
        }
        return;
      }

      // action === 'start'
      const qs = getQueueStatus();
      if (qs.state === 'paused') {
        try {
          resumeQueue();
          jsonRes(res, 200, { ok: true, message: `Self-play resumed (was paused: ${qs.pauseReason}).` });
        } catch (err) {
          jsonRes(res, 400, { error: err.message });
        }
        return;
      }
      try {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) { jsonRes(res, 500, { error: 'Guild not found' }); return; }
        const bothelpersChannel = await client.channels.fetch('1481314970666008607').catch(() => null);
        if (!bothelpersChannel) { jsonRes(res, 500, { error: '#bothelpers channel not found' }); return; }

        startQueue({
          client,
          guild,
          guildId: guild.id,
          buildAllDeps,
          getGame,
          atomicOpts,
          actionDeps: { dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData, computeMovementCache, getBoardStateForMovement, getMovementProfile, getPlayableCcFromHand },
          createTestGame,
          deleteGameChannelsAndGame,
          cleanupCtx: {
            client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
            deleteGameFromDb,
          },
          scenarios: [],
          seedMode: true,
          getNextSeed: () => getTopValidationCandidate(getDestructTestDecks),
          onSeedRunComplete: async (artifact, seedConfig) => {
            const dedupedKeys = artifact?.transitions_hit || [];
            for (const key of dedupedKeys) {
              const { roundPhase, pendingSet, actionType } = parseTransitionKey(key);
              await upsertDiscordTransition(key, roundPhase, pendingSet, actionType);
            }
            await insertExplorationEpisode({
              episode_id: randomUUID(),
              source: 'discord',
              seed_config: { mapId: seedConfig.mapId, p1Deck: seedConfig.p1Deck.name, p2Deck: seedConfig.p2Deck.name },
              total_steps: artifact?.total_steps || 0,
              unique_transitions: dedupedKeys.length,
              novel_transitions: 0,
              invariant_errors: 0,
              transitions_hit: dedupedKeys,
              result: artifact?.result || 'unknown',
              stop_reason: artifact?.stop_reason || 'unknown',
              duration_ms: artifact?.duration_ms || 0,
            });
          },
          interGameDelayMs: 5000,
          delayMs: 200,
          feedbackChannel: bothelpersChannel,
          logChannel: bothelpersChannel,
          saveGames,
          AI_USER_PREFIX,
          botLogsPost: async (artifact) => {
            try {
              await logGameErrorToBotLogs(client, guild, artifact.game_id,
                new Error(`Self-play ${artifact.stop_reason}: ${artifact.error_message || 'no details'}`),
                'selfplay');
            } catch {}
          },
        });
        jsonRes(res, 200, { ok: true, message: 'Self-play started — auto-selecting seeds.' });
      } catch (err) {
        jsonRes(res, 400, { error: err.message });
      }
      return;
    }

    // --- Testgame (existing) ---

    if (req.method === 'POST' && req.url === '/testgame' && guildId) {
      const data = await readBody(req);
      try {
        const userId = data.userId || process.env.TESTGAME_USER_ID;
        const scenarioId = data.scenarioId || null;
        if (!userId) {
          jsonRes(res, 400, { error: 'Missing userId (set in body or TESTGAME_USER_ID)' });
          return;
        }
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
          jsonRes(res, 500, { error: 'Guild not found' });
          return;
        }
        await guild.channels.fetch();
        const lfg = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === 'lfg');
        if (!lfg) {
          jsonRes(res, 500, { error: '#lfg channel not found' });
          return;
        }
        const player2Id = data.player2Id || undefined;
        const { gameId } = await createTestGame(client, guild, userId, scenarioId, lfg, { player2Id });
        jsonRes(res, 200, { gameId, message: 'Test game created. Check #lfg in Discord.' });
      } catch (err) {
        console.error('POST /testgame error:', err);
        jsonRes(res, 400, { error: err.message || 'Test game creation failed' });
      }
      return;
    }

    // --- Coverage Viewer (static files) ---

    const coverageFiles = {
      '/coverage': 'tests/headless/coverage-viewer.html',
      '/coverage-ledger.json': 'tests/headless/coverage-ledger.json',
      '/coverage-telemetry.json': 'tests/headless/coverage-telemetry.json',
      '/coverage-incidents.json': 'tests/headless/coverage-incidents.json',
    };
    const mimeTypes = { '.html': 'text/html', '.json': 'application/json' };

    const filePath = coverageFiles[req.url?.split('?')[0]];
    if (req.method === 'GET' && filePath) {
      try {
        const __indexDirname = dirname(fileURLToPath(import.meta.url));
        const fullPath = join(__indexDirname, filePath);
        const content = readFileSync(fullPath, 'utf8');
        const ext = filePath.slice(filePath.lastIndexOf('.'));
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(content);
      } catch (err) {
        res.writeHead(404);
        res.end('File not found');
      }
      return;
    }

    res.writeHead(404);
    res.end();
  }).listen(port, '0.0.0.0', () => {
    console.log(`Bot HTTP API: http://0.0.0.0:${port} (testgame + coverage API + viewer)`);
  });
  botReady = true;
  console.log('Bot fully ready — accepting interactions.');
});

const requestsWithButtons = new Set();

// Forum posts: thread isn't messageable until the author sends their first message.
// So we set up the lobby on the first message in a new-games thread.
async function maybeSetupLobbyFromFirstMessage(message) {
  const thread = message.channel;
  if (!thread?.isThread?.()) return false;
  const parent = thread.parent;
  if (parent?.name !== 'new-games') return false;
  // Guard against duplicates: claim synchronously before any await (prevents race when two messages fire)
  if (hasLobby(thread.id) || hasLobbyEmbedSent(thread.id)) return false;
  markLobbyEmbedSent(thread.id);
  const creator = message.author.id;
  const lobby = { creatorId: creator, joinedId: null, status: 'LFG' };
  setLobby(thread.id, lobby);
  await thread.send({
    embeds: [getLobbyEmbed(lobby)],
    components: [getLobbyJoinButton(thread.id)],
  });
  await updateThreadName(thread, lobby);
  return true;
}

const REQUEST_FORUM_NAMES = ['bot-requests-and-suggestions', 'bot-feedback-and-requests'];

async function maybeAddRequestButtons(message) {
  const thread = message.channel;
  if (!thread?.isThread?.()) return false;
  const parent = thread.parent;
  const parentName = (parent?.name || '').toLowerCase().replace(/\s+/g, '-');
  if (!parentName || !REQUEST_FORUM_NAMES.some((n) => parentName === n)) return false;
  if (requestsWithButtons.has(thread.id)) return false;
  requestsWithButtons.add(thread.id);
  await thread.send({
    content: 'Admins: mark this request as **IMPLEMENTED** or **REJECTED**.',
    components: [getRequestActionButtons(thread.id)],
  });
  return true;
}

client.on('messageCreate', async (message) => {
  try {
  if (!botReady) return;

  // ── Kill all selfplay games (MCP) ────────────────────────────────────────────
  // Deletes all active games (channels + DB) — use before starting fresh selfplay.
  if (message.content.startsWith('killgamemcp')) {
    const mcpBothelpersId = '1481314970666008607';
    if (message.channel.id !== mcpBothelpersId) return;
    const reply = (text) => message.channel.send(text).catch(() => {});

    // Stop selfplay queue first if running
    try { stopQueue(); } catch {}

    const gamesMap = getGamesMap();
    const gameIds = [...gamesMap.keys()];
    if (gameIds.length === 0) {
      await reply('No active games to kill.');
      return;
    }
    let killed = 0;
    for (const gid of gameIds) {
      const game = gamesMap.get(gid);
      if (!game) continue;
      try {
        try { await captureManualKillDiagnostic(game, gid); } catch (e) { console.warn(`[killgamemcp] Pre-kill dump failed for ${gid}:`, e.message); }
        await deleteGameChannelsAndGame(game, gid, {
          client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
          deleteGameFromDb,
        });
        killed++;
      } catch (err) {
        console.error(`[killgamemcp] Failed to delete game ${gid}:`, err.message);
      }
    }
    await reply(`**Killed ${killed}/${gameIds.length} game(s).** Channels and DB cleaned up.`);
    return;
  }

  // ── MCP selfplay trigger ────────────────────────────────────────────────────
  // Allows starting/stopping self-play via text message in #bothelpers.
  // Accepts messages from any source (human, webhook, MCP) — bothelpers is admin-gated.
  if (message.content.startsWith('selfplaymcp')) {
    const mcpBothelpersId = '1481314970666008607';
    if (message.channel.id !== mcpBothelpersId) return;

    const mcpArgs = message.content.trim().split(/\s+/).slice(1);
    const mcpAction = mcpArgs[0] || 'start';
    const reply = (text) => message.channel.send(text).catch(() => {});

    if (mcpAction === 'status') {
      const qs = getQueueStatus();
      const activeId = getActiveSelfPlayGameId();
      if (qs.state === 'idle' && !activeId) {
        await reply('Self-play idle.');
      } else {
        const modeLabel = qs.seedMode ? 'seed auto-select' : 'scenario round-robin';
        const lines = [
          `**State:** ${qs.state} (${modeLabel})`,
          `**Runs:** ${qs.runCount} (${qs.failCount} failed)`,
          `**Current:** ${qs.currentRunScenario || 'none'}`,
        ];
        if (activeId) lines.push(`**Active game:** ${activeId}`);
        if (qs.pauseReason) lines.push(`**Pause reason:** ${qs.pauseReason}`);
        await reply(lines.join('\n'));
      }
      return;
    }

    if (mcpAction === 'pause') {
      try {
        pauseQueue('manual (MCP)');
        await reply('**Self-play paused** (MCP). Send `selfplaymcp start` to resume.');
      } catch (err) {
        await reply(`Pause failed: ${err.message}`);
      }
      return;
    }

    if (mcpAction === 'stop') {
      try {
        stopQueue();
        await reply('Self-play stopping after current game.');
      } catch (err) {
        await reply(`Stop failed: ${err.message}`);
      }
      return;
    }

    // Coverage report
    if (mcpAction === 'coverage') {
      const subCmd = mcpArgs[1] || 'summary';

      if (subCmd === 'gaps') {
        const categories = ['dc', 'cc', 'ability_dc_special', 'ability_surge', 'pending_state', 'handler', 'end_condition', 'vp_source'];
        const lines = ['**Coverage Gaps** (top unexercised wired items per category)\n'];
        for (const cat of categories) {
          const gaps = await getCoverageGaps({ category: cat, limit: 5, minDiscord: 0 });
          if (gaps.length === 0) continue;
          lines.push(`**${cat}** — ${gaps.length} shown:`);
          for (const g of gaps) {
            lines.push(`  \`${g.item_id}\` (${g.discord_count}x)`);
          }
        }
        // Split if too long for Discord (2000 char limit)
        const text = lines.join('\n');
        if (text.length > 1900) {
          const mid = Math.floor(lines.length / 2);
          await reply(lines.slice(0, mid).join('\n'));
          await reply(lines.slice(mid).join('\n'));
        } else {
          await reply(text);
        }
        return;
      }

      // Default: summary
      const rows = await getCoverageSummary();
      if (!rows.length) {
        await reply('No coverage data. Run `node scripts/seed-coverage.js` first.');
        return;
      }
      const header = '```\nPvP Coverage Report\n═══════════════════════════════════════════════════════════════\nCategory             Total  Wired  Exercised  Verified  Gap%  HardGaps\n';
      const lines = [];
      let grandTotal = 0, grandWired = 0, grandExercised = 0, grandVerified = 0, grandHardGaps = 0;
      for (const r of rows) {
        const gap = r.wired > 0 ? Math.round(100 * (1 - r.exercised / r.wired)) : 0;
        lines.push(
          `${r.category.padEnd(21)}${String(r.total).padStart(5)}${String(r.wired).padStart(7)}${String(r.exercised).padStart(10)}${String(r.verified).padStart(10)}${String(gap + '%').padStart(5)}${String(r.hard_gaps).padStart(10)}`
        );
        grandTotal += r.total;
        grandWired += r.wired;
        grandExercised += r.exercised;
        grandVerified += r.verified;
        grandHardGaps += r.hard_gaps;
      }
      const grandGap = grandWired > 0 ? Math.round(100 * (1 - grandExercised / grandWired)) : 0;
      lines.push('───────────────────────────────────────────────────────────────');
      lines.push(
        `${'TOTAL'.padEnd(21)}${String(grandTotal).padStart(5)}${String(grandWired).padStart(7)}${String(grandExercised).padStart(10)}${String(grandVerified).padStart(10)}${String(grandGap + '%').padStart(5)}${String(grandHardGaps).padStart(10)}`
      );
      await reply(header + lines.join('\n') + '\n```');
      return;
    }

    // mcpAction === 'seed' — single seeded game (same pattern as /selfplay seed slash command)
    if (mcpAction === 'seed') {
      // Parse: selfplaymcp seed <p1deck> <p2deck> <mapId>
      // Deck names may contain spaces, so we match: seed <name> <name> <mapId>
      // Convention: mapId is always hyphenated (no spaces), deck names are everything between
      const seedTextRaw = message.content.replace(/^selfplaymcp\s+seed\s+/i, '').trim();
      const seedText = seedTextRaw.replace(/--test-overflow\s*/g, '').trim();
      // Split from the end: last token is mapId, second-to-last group is p2deck, first group is p1deck
      // Since deck names have spaces, use known map list to find the split point
      const maps = getPlayReadyMaps();
      const mapIds = maps.map(m => m.id);
      let mapId = null, decksPart = null;
      for (const mid of mapIds) {
        if (seedText.endsWith(mid)) {
          mapId = mid;
          decksPart = seedText.slice(0, -(mid.length)).trim();
          break;
        }
      }
      if (!mapId || !decksPart) {
        await reply('Usage: `selfplaymcp seed <p1deck> <p2deck> <mapId>`\nExample: `selfplaymcp seed Imperial Hunters Double Lammy corellian-underground`');
        return;
      }
      // Split deck names: try all possible split points and match against known decks
      const decks = getDestructTestDecks();
      const deckNames = decks.map(d => d.name);
      let p1Deck = null, p2Deck = null;
      for (const dName of deckNames) {
        if (decksPart.startsWith(dName + ' ')) {
          const remainder = decksPart.slice(dName.length + 1).trim();
          if (deckNames.includes(remainder)) {
            p1Deck = decks.find(d => d.name === dName);
            p2Deck = decks.find(d => d.name === remainder);
            break;
          }
        }
      }
      if (!p1Deck || !p2Deck) {
        await reply(`Could not parse deck names from: "${decksPart}"\nKnown decks: ${deckNames.join(', ')}`);
        return;
      }
      if (getActiveSelfPlayGameId()) {
        await reply(`Self-play already active for game ${getActiveSelfPlayGameId()}. Stop it first.`);
        return;
      }

      await reply(`**Seed game starting (MCP)**: ${p1Deck.name} vs ${p2Deck.name} @ ${mapId}`);

      try {
        // Auto-cleanup stale games
        const gamesMap = getGamesMap();
        const staleIds = [...gamesMap.keys()];
        if (staleIds.length > 0) {
          for (const gid of staleIds) {
            const g = gamesMap.get(gid);
            if (!g) continue;
            try {
              await deleteGameChannelsAndGame(g, gid, {
                client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
                deleteGameFromDb,
              });
            } catch (err) {
              console.error(`[selfplaymcp seed] Pre-start cleanup failed for ${gid}:`, err.message);
            }
          }
          await reply(`Cleaned up ${staleIds.length} stale game(s) before starting.`);
        }

        const seedConfig = { mapId, p1Deck, p2Deck };
        const aiP1 = `${AI_USER_PREFIX}1`;
        const aiP2 = `${AI_USER_PREFIX}2`;
        const created = await createTestGame(client, message.guild, aiP1, null, message.channel, { player2Id: aiP2, seedConfig });
        const gameId = created.gameId;

        const game = getGame(gameId);
        if (!game) throw new Error('Game creation returned no game state');
        game.selfPlay = true;
        game.guildId = message.guild.id;
        // Test flag: --test-overflow routes through PvP overflow prompt path
        if (seedTextRaw.includes('--test-overflow')) game.testPvpOverflowPath = true;
        saveGames();

        const loopResult = await runSelfPlayLoop(game, client, {
          buildAllDeps,
          getGame,
          atomicOpts,
          actionDeps: { dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData, computeMovementCache, getBoardStateForMovement, getMovementProfile, getPlayableCcFromHand },
          scenario: `seed:${p1Deck.name}_vs_${p2Deck.name}@${mapId}`,
          guildId: message.guild.id,
          delayMs: 200,
          explorationMode: 'seed_validation',
        });

        const artifact = loopResult.artifact;
        const dedupedKeys = artifact?.transitions_hit || [];
        for (const key of dedupedKeys) {
          const { roundPhase, pendingSet, actionType } = parseTransitionKey(key);
          await upsertDiscordTransition(key, roundPhase, pendingSet, actionType);
        }
        await insertExplorationEpisode({
          episode_id: randomUUID(),
          source: 'discord',
          seed_config: { mapId, p1Deck: p1Deck.name, p2Deck: p2Deck.name },
          total_steps: artifact?.total_steps || 0,
          unique_transitions: dedupedKeys.length,
          novel_transitions: 0,
          invariant_errors: 0,
          transitions_hit: dedupedKeys,
          result: artifact?.result || loopResult.result,
          stop_reason: artifact?.stop_reason || 'unknown',
          duration_ms: artifact?.duration_ms || 0,
        });

        // Post full artifact to bothelpers
        if (artifact) {
          try {
            const summary = formatCoverageSummary(artifact);
            const discordSummary = summary.length > 1950
              ? summary.slice(0, 1950) + '\n... (truncated)'
              : summary;
            await reply(`\`\`\`\n${discordSummary}\n\`\`\``);
          } catch {}
        }

        // Cleanup on success; preserve on failure
        if (loopResult.result !== 'failed' && gameId) {
          try {
            const finalGame = getGame(gameId);
            if (finalGame) {
              await deleteGameChannelsAndGame(finalGame, gameId, {
                client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
                deleteGameFromDb,
              });
            }
          } catch (cleanErr) {
            console.error(`[selfplaymcp seed] Post-game cleanup failed:`, cleanErr.message);
          }
        }
      } catch (err) {
        await reply(`Seed game failed: ${err.message}`);
        console.error(`[selfplaymcp seed] Error:`, err);
      }
      return;
    }

    // mcpAction === 'start' (default)
    const qs = getQueueStatus();
    if (qs.state === 'paused') {
      try {
        resumeQueue();
        await reply(`**Self-play resumed** — was paused (${qs.pauseReason || 'unknown'}).`);
      } catch (err) {
        await reply(`Resume failed: ${err.message}`);
      }
      return;
    }
    try {
      // Auto-cleanup: delete any existing games before starting fresh selfplay
      const gamesMap = getGamesMap();
      const staleIds = [...gamesMap.keys()];
      if (staleIds.length > 0) {
        for (const gid of staleIds) {
          const g = gamesMap.get(gid);
          if (!g) continue;
          try {
            await deleteGameChannelsAndGame(g, gid, {
              client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
              deleteGameFromDb,
            });
          } catch (err) {
            console.error(`[selfplaymcp] Pre-start cleanup failed for ${gid}:`, err.message);
          }
        }
        await reply(`Cleaned up ${staleIds.length} stale game(s) before starting.`);
      }
      const guild = message.guild;
      startQueue({
        client,
        guild,
        guildId: guild.id,
        buildAllDeps,
        getGame,
        atomicOpts,
        actionDeps: { dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData, computeMovementCache, getBoardStateForMovement, getMovementProfile, getPlayableCcFromHand },
        createTestGame,
        deleteGameChannelsAndGame,
        cleanupCtx: {
          client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
          deleteGameFromDb,
        },
        scenarios: [],
        seedMode: true,
        getNextSeed: () => getTopValidationCandidate(getDestructTestDecks),
        onSeedRunComplete: async (artifact, seedConfig) => {
          const dedupedKeys = artifact?.transitions_hit || [];
          for (const key of dedupedKeys) {
            const { roundPhase, pendingSet, actionType } = parseTransitionKey(key);
            await upsertDiscordTransition(key, roundPhase, pendingSet, actionType);
          }
          await insertExplorationEpisode({
            episode_id: randomUUID(),
            source: 'discord',
            seed_config: { mapId: seedConfig.mapId, p1Deck: seedConfig.p1Deck.name, p2Deck: seedConfig.p2Deck.name },
            total_steps: artifact?.total_steps || 0,
            unique_transitions: dedupedKeys.length,
            novel_transitions: 0,
            invariant_errors: 0,
            transitions_hit: dedupedKeys,
            result: artifact?.result || 'unknown',
            stop_reason: artifact?.stop_reason || 'unknown',
            duration_ms: artifact?.duration_ms || 0,
          });
        },
        interGameDelayMs: 5000,
        delayMs: 200,
        feedbackChannel: message.channel,
        logChannel: message.channel,
        saveGames,
        AI_USER_PREFIX,
        botLogsPost: async (artifact) => {
          try {
            await logGameErrorToBotLogs(client, guild, artifact.game_id,
              new Error(`Self-play ${artifact.stop_reason}: ${artifact.error_message || 'no details'}`),
              'selfplay');
          } catch {}
        },
      });
      await reply('**Self-play started (MCP)** — auto-selecting highest-ranked unvalidated seeds.');
    } catch (err) {
      await reply(`Start failed: ${err.message}`);
    }
    return;
  }
  // ── End MCP selfplay trigger ────────────────────────────────────────────────

  // ── MCP killgame trigger ──────────────────────────────────────────────────
  if (message.content.startsWith('killgamemcp')) {
    const mcpBothelpersId = '1481314970666008607';
    if (message.channel.id !== mcpBothelpersId) return;
    const killArgs = message.content.trim().split(/\s+/).slice(1);
    const killGameId = killArgs[0];
    const reply = (text) => message.channel.send(text).catch(() => {});
    if (!killGameId) {
      await reply('Usage: `killgamemcp <gameId>` (e.g., `killgamemcp 00001`)');
      return;
    }
    const game = getGame(killGameId);
    if (!game) {
      await reply(`Game **${killGameId}** not found.`);
      return;
    }
    try {
      try { await captureManualKillDiagnostic(game, killGameId); } catch (e) { console.warn(`[killgamemcp] Pre-kill dump failed for ${killGameId}:`, e.message); }
      await deleteGameChannelsAndGame(game, killGameId, {
        client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
        deleteGameFromDb,
      });
      await reply(`Game **IA Game #${killGameId}** deleted. All channels removed.`);
    } catch (err) {
      await reply(`Kill failed: ${err.message}`);
    }
    return;
  }
  // ── End MCP killgame trigger ──────────────────────────────────────────────

  if (message.author.bot) return;

  // Forum post first message: set up lobby buttons (thread isn't messageable until author posts)
  try {
    if (await maybeSetupLobbyFromFirstMessage(message)) return;
  } catch (err) {
    console.error('Lobby setup error:', err);
  }

  // Requests-and-suggestions: add Resolve/Reject buttons (admin-only on click)
  try {
    if (await maybeAddRequestButtons(message)) return;
  } catch (err) {
    console.error('Request buttons error:', err);
  }

  // Bothelper support request: detect @bothelpers role mention in a game channel
  const BOTHELPERS_ROLE_ID = '1472145489817374720';
  const BOTHELPERS_CHANNEL_ID = '1481314970666008607';
  try {
    if (message.mentions.roles.has(BOTHELPERS_ROLE_ID)) {
      const gameMatch = findGameByChannel(getGamesMap(), message.channel.id);
      if (gameMatch) {
        const { gameId, game } = gameMatch;
        const bothelpersCh = await client.channels.fetch(BOTHELPERS_CHANNEL_ID).catch(() => null);
        if (bothelpersCh) {
          const requester = message.author;
          const sourceLink = `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;
          const jumpRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bothelper_jump_${gameId}`).setLabel('Jump In!').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`bothelper_resolve_${gameId}_${message.id}`).setLabel('Resolve').setStyle(ButtonStyle.Secondary),
          );
          await bothelpersCh.send({
            content: `<@&${BOTHELPERS_ROLE_ID}> **Support requested** in **IA Game #${gameId}** by <@${requester.id}>:\n\n> ${message.content.replace(/<@&\d+>/g, '@bothelpers').split('\n').join('\n> ')}\n\n[Jump to message](${sourceLink})`,
            components: [jumpRow],
            allowedMentions: { roles: [BOTHELPERS_ROLE_ID] },
          });
          await message.react('✅').catch(discordCatch);
        }
      }
    }
  } catch (err) {
    console.error('Bothelper support request error:', err);
  }

  const content = message.content.toLowerCase().trim();

  const channelNameLc = message.channel?.name?.toLowerCase();
  if (content.startsWith('testready') && channelNameLc === 'lfg') {
    if (!message.guild) {
      await message.reply('This command must be used in a server channel.').catch(discordCatch);
      return;
    }
    const userId = message.author.id;
    const mentionedP2 = message.mentions.users.first();
    const player2Id = mentionedP2 && mentionedP2.id !== userId ? mentionedP2.id : undefined;
    const p2IsBot = !player2Id;
    const scenarioId = getRandomTestreadyScenario(p2IsBot);
    if (!scenarioId) {
      const hint = p2IsBot ? ' Some scenarios require a real P2 — try `testready @player2`.' : '';
      await message.reply(`No testready scenarios available.${hint}`).catch(discordCatch);
      return;
    }
    const msgId = message.id;
    if (processedTestGameMessageIds.has(msgId)) return;
    processedTestGameMessageIds.add(msgId);
    if (processedTestGameMessageIds.size > 500) processedTestGameMessageIds.clear();
    const p2Desc = player2Id ? ` vs <@${player2Id}>` : '';
    const creatingMsg = await message.reply(`Creating test game (random testready scenario: **${scenarioId}**${p2Desc})...`);
    try {
      await createTestGame(message.client, message.guild, userId, scenarioId, message.channel, { editMessageInstead: creatingMsg, player2Id });
    } catch (err) {
      console.error('Test game creation error:', err);
      await logGameErrorToBotLogs(message.client, message.guild, null, err, 'test_game_create');
      await creatingMsg.edit(`Failed to create test game: ${err.message}`).catch(discordCatch);
    }
    return;
  }

  const isTestGameCmd = content.startsWith('testgame') && channelNameLc === 'lfg';
  if (isTestGameCmd) {
    if (!message.guild) {
      await message.reply('This command must be used in a server channel.').catch(discordCatch);
      return;
    }
    const parts = message.content.trim().split(/\s+/);
    let scenarioId = null;
    for (let i = 1; i < parts.length; i++) {
      if (!parts[i].startsWith('<@')) { scenarioId = parts[i].toLowerCase(); break; }
    }
    const mentionedP2 = message.mentions.users.first();
    const player2Id = mentionedP2 && mentionedP2.id !== message.author.id ? mentionedP2.id : undefined;
    const msgId = message.id;
    if (processedTestGameMessageIds.has(msgId)) return;
    processedTestGameMessageIds.add(msgId);
    if (processedTestGameMessageIds.size > 500) processedTestGameMessageIds.clear();
    const userId = message.author.id;
    const p2Desc = player2Id ? ` vs <@${player2Id}>` : '';
    const creatingMsg = await message.reply(scenarioId ? `Creating test game (scenario: **${scenarioId}**${p2Desc})...` : `Creating test game${player2Id ? p2Desc : ' (you as both players)'}...`);
    try {
      await createTestGame(message.client, message.guild, userId, scenarioId, message.channel, { editMessageInstead: creatingMsg, player2Id });
    } catch (err) {
      console.error('Test game creation error:', err);
      await logGameErrorToBotLogs(message.client, message.guild, null, err, 'test_game_create');
      await creatingMsg.edit(`Failed to create test game: ${err.message}`).catch(discordCatch);
    }
    return;
  }

  if (content === 'ping') {
    message.reply('Pong!');
    return;
  }

  if (content === 'cleanup' || content === 'kill games') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply('You need **Manage Channels** permission to run cleanup.');
      return;
    }
    await message.reply('Cleaning up game channels...');
    try {
      await message.guild.channels.fetch();
      const gameCategories = message.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildCategory && /^IA Game #\d+$/.test(c.name)
      );
      let deleted = 0;
      for (const cat of gameCategories.values()) {
        const children = message.guild.channels.cache.filter((c) => c.parentId === cat.id);
        for (const ch of children.values()) {
          await ch.delete();
          deleted++;
        }
        await cat.delete();
        deleted++;
      }
      games.clear();
      dcMessageMeta.clear();
      dcExhaustedState.clear();
      dcHealthState.clear();
      await message.channel.send(`Done. Deleted ${deleted} channel(s).`);
    } catch (err) {
      console.error('Cleanup error:', err);
      await logGameErrorToBotLogs(message.client, message.guild, null, err, 'cleanup');
      await message.channel.send(`Cleanup failed: ${err.message}`);
    }
    return;
  }

  if (content === 'setup') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply('You need **Manage Server** permission to run setup.');
      return;
    }
    await message.reply('Setting up server structure...');
    try {
      const result = await setupServer(message.guild);
      await message.channel.send(result);
    } catch (err) {
      console.error(err);
      await message.channel.send(
        `Setup failed. Ensure the bot has **Manage Channels** permission. Error: ${err.message}`
      );
    }
    return;
  }

  if (content === 'play' || content === 'skirmish' || content === 'ia') {
    const embed = new EmbedBuilder()
      .setTitle('Imperial Assault Skirmish')
      .setDescription('Choose an action:')
      .setColor(COLORS.DARK_EMBED);
    await message.reply({
      embeds: [embed],
      components: [getMainMenu()],
    });
    return;
  }

  // /editvp +N or /editvp -N in Game Log or General chat — manual VP adjustment (author's side only)
  const editVpMatch = content.match(/^\/editvp\s*([+-]\d+)$/i);
  if (editVpMatch) {
    const chId = message.channel?.id;
    for (const [gameId, game] of getGamesMap()) {
      if (game.generalId !== chId && game.chatId !== chId) continue;
      if (game.ended) {
        await message.reply('This game has ended. VP cannot be changed.').catch(discordCatch);
        return;
      }
      const authorId = message.author.id;
      const isP1 = authorId === game.player1Id;
      const isP2 = authorId === game.player2Id;
      if (!isP1 && !isP2) {
        await message.reply('Only players in this game can use /editvp.').catch(discordCatch);
        return;
      }
      const raw = editVpMatch[1];
      const delta = raw.startsWith('+') ? parseInt(raw.slice(1), 10) : -parseInt(raw.slice(1), 10);
      const vpKey = isP1 ? 'player1VP' : 'player2VP';
      const vp = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
      game[vpKey] = vp;
      const before = vp.total;
      vp.total = Math.max(0, before + delta);
      const actualDelta = vp.total - before;
      setGame(gameId, game);
      saveGames();
      const newTotal = vp.total;
      const side = isP1 ? 'Player 1' : 'Player 2';
      await message.reply(`✓ **${side}** VP adjusted ${actualDelta >= 0 ? '+' : ''}${actualDelta}. Total is now **${newTotal}** VP.`).catch(discordCatch);
      // Update scorecard embed in Map Updates channel if present
      if (game.boardId && game.selectedMap) {
        try {
          const boardChannel = await message.client.channels.fetch(game.boardId);
          const messages = await boardChannel.messages.fetch({ limit: 15 });
          const withScorecard = messages.find((m) => m.embeds?.[0]?.title === 'Scorecard');
          if (withScorecard) {
            const embed = buildScorecardEmbed(game, getMissionVpBonus(game));
            await withScorecard.edit({ embeds: [embed] }).catch(discordCatch);
          }
        } catch (err) {
          // ignore
        }
      }
      const winCheck = await checkWinConditions(game, message.client);
      if (winCheck.ended) {
        // Game over already posted by checkWinConditions
      }
      return;
    }
    // No game channel matched — ignore so we don't reply in unrelated channels
    return;
  }

  // .vsav / .vpt file upload in Player Hand channel
  const vsavAttach = message.attachments?.find((a) => {
    const name = a.name?.toLowerCase() || '';
    return name.endsWith('.vsav') || name.startsWith('vpt_') || name.endsWith('.vpt');
  });
  if (vsavAttach) {
    const _vsavMatch = findGameByChannel(getGamesMap(), message.channel.id);
    if (_vsavMatch && (_vsavMatch.isP1 || _vsavMatch.isP2)) {
      const { game, isP1, isP2 } = _vsavMatch;
      const userId = isP1 ? game.player1Id : game.player2Id;
      if (message.author.id !== userId) {
        await message.reply('Only the owner of this hand can submit a squad.');
        return;
      }
      if (!game.mapSelected) {
        await message.reply('Map selection must be completed before you can submit your squad.');
        return;
      }
      try {
        const res = await fetch(vsavAttach.url);
        const content = await res.text();
        const parsed = parseVsav(content);
        if (!parsed || (parsed.dcList.length === 0 && parsed.ccList.length === 0)) {
          await message.reply('Could not parse that file. Make sure it was exported from the IACP List Builder.');
          return;
        }
        const squadName = vsavAttach.name
          ? vsavAttach.name.replace(/\.vsav$/i, '').replace(/^IA List \[[^\]]+\] - /, '').replace(/^VPT_\w*/i, '').trim()
          : 'From file';
        const squad = {
          name: squadName || 'From file',
          dcList: parsed.dcList,
          ccList: parsed.ccList,
          unclassified: parsed.unclassified,
          dcCount: parsed.dcList.length,
          ccCount: parsed.ccList.length,
        };
        normalizeSquadInput(squad);
        const validation = validateDeckLegal(squad);
        await sendSquadConfirmation(game, isP1, squad, validation, message.client);
        await message.reply(`Parsed **${squad.name}** (${squad.dcCount} DCs, ${squad.ccCount} CCs). Review your list above and confirm.`);
      } catch (err) {
        console.error('vsav parse error:', err);
        await logGameErrorToBotLogs(message.client, message.guild, null, err, 'messageCreate_vsav');
        await message.reply(`Failed to parse .vsav: ${err.message}`);
      }
      return;
    }
  }

  // Pasted IACP list (from Share button) in Player Hand channel
  const _pasteMatch = findGameByChannel(getGamesMap(), message.channel.id);
  if (_pasteMatch && (_pasteMatch.isP1 || _pasteMatch.isP2)) {
    const { game, isP1 } = _pasteMatch;
    const userId = isP1 ? game.player1Id : game.player2Id;
    if (message.author.id === userId && game.mapSelected) {
      const parsed = parseIacpListPaste(message.content || '');
      if (parsed && (parsed.dcList.length > 0 || parsed.ccList.length > 0)) {
        const squad = {
          name: parsed.name || 'From pasted list',
          dcList: parsed.dcList,
          ccList: parsed.ccList,
          dcCount: parsed.dcList.length,
          ccCount: parsed.ccList.length,
        };
        normalizeSquadInput(squad);
        const validation = validateDeckLegal(squad);
        await sendSquadConfirmation(game, isP1, squad, validation, message.client);
        await message.reply(`Parsed **${squad.name}** (${squad.dcCount} DCs, ${squad.ccCount} CCs). Review your list above and confirm.`);
        return;
      }
    }
  }
  } catch (err) {
    console.error('Message handler error:', err);
    const guild = message?.guild;
    const gameId = extractGameIdFromMessage(message);
    await logGameErrorToBotLogs(message.client, guild, gameId, err, 'messageCreate');
  }
});

// ── Auto-refresh: serialization maps for minimap (one message, rapid edits) ──
const _minimapInFlight = new Map();    // msgId → Promise
const _minimapLatestToken = new Map(); // msgId → Symbol (newest request wins)

async function _serializedMinimapUpdate(game, msgId) {
  const token = Symbol();
  _minimapLatestToken.set(msgId, token);
  const prev = _minimapInFlight.get(msgId);
  if (prev) await prev.catch(discordCatch);
  if (_minimapLatestToken.get(msgId) !== token) return; // superseded by newer request
  const p = updateDcActionsMessage(game, msgId, client).catch(err => console.error('[refresh:minimap]', err?.message ?? err));
  _minimapInFlight.set(msgId, p);
  await p;
  if (_minimapLatestToken.get(msgId) === token) { _minimapInFlight.delete(msgId); _minimapLatestToken.delete(msgId); }
}

/**
 * Fire-and-forget: post new board map, refresh minimap(s), rebuild all DC play-area embeds.
 * Called in the finally block of every interactionCreate — no awaiting, no blocking.
 */
async function refreshGameVisuals(game) {
  if (!game?.gameId || !game.selectedMap) return;

  // 1. Board map — new post to board channel (running timeline)
  if (game.boardId) {
    (async () => {
      try {
        const ch = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await ch.send(payload);
      } catch (err) { console.error('[refresh:board]', err?.message ?? err); }
    })();
  }

  // 2. Minimap — serialized edit-in-place for every active activation thread
  for (const msgId of Object.keys(game.dcActionsData || {})) {
    _serializedMinimapUpdate(game, msgId).catch(err => console.error('[refresh:minimap]', err?.message ?? err));
  }

  // 3. DC play-area embeds — rebuild all deployed DCs for both players
  for (const playerNum of [1, 2]) {
    const msgIds = getDcMessageIds(game, playerNum) || [];
    const channelId = getPlayAreaId(game, playerNum);
    if (!channelId || !msgIds.length) continue;
    (async () => {
      try {
        const ch = await client.channels.fetch(channelId);
        for (const id of msgIds) {
          if (!id) continue;
          const meta = dcMessageMeta.get(id);
          if (!meta || meta.gameId !== game.gameId) continue;
          try {
            const msg = await ch.messages.fetch(id);
            const healthState = dcHealthState.get(id) || [];
            const exhausted = dcExhaustedState.get(id) || false;
            const { embed, files } = await buildDcEmbedAndFiles(
              meta.dcName, exhausted, meta.displayName, healthState,
              getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, id),
              null, null, getNicknamesForDcMessage(game, meta)
            );
            const components = getDcPlayAreaComponents(id, exhausted, game, meta.dcName);
            await msg.edit({ embeds: [embed], files, components }).catch(err => console.error('[refresh:dc-embed]', id, err?.message ?? err));
          } catch (err) { console.error('[refresh:dc-embed] fetch failed', id, err?.message ?? err); }
        }
      } catch (err) { console.error('[refresh:dc-embeds] channel fetch failed', channelId, err?.message ?? err); }
    })();
  }
}

/**
 * Build the shared dependencies bag for handler dispatch.
 * Defined once; called wherever a handler needs its context built via buildContext().
 */
/** Guard set: game IDs currently being cleaned up, prevents channelDelete re-entrancy. */
const channelDeleteGuard = new Set();

function buildAllDeps() {
  return {
    // Core state
    getGame, setGame, saveGames, deleteGame, deleteGameFromDb,
    dcMessageMeta, dcExhaustedState, dcHealthState, pendingIllegalSquad, pendingSquadConfirm,
    client, channelDeleteGuard,

    // Auth & utility
    canActAsPlayer, extractGameIdFromInteraction, logGameErrorToBotLogs,
    replyIfGameEnded, pushUndo,

    // Constants
    PENDING_ILLEGAL_TTL_MS, MAX_ACTIVE_GAMES_PER_PLAYER,
    DC_ACTIONS_PER_ACTIVATION, GAME_PHASES, PHASE_COLOR, ACTION_ICONS,
    SURGE_LABELS, FIGURE_LETTERS, ThreadAutoArchiveDuration,
    DEFAULT_DECK_REBELS, DEFAULT_DECK_SCUM, DEFAULT_DECK_IMPERIAL,

    // Discord.js builders
    ButtonBuilder, ActionRowBuilder, ButtonStyle, EmbedBuilder,

    // Game logic (imported)
    validateDeckLegal, parseCoord, normalizeCoord, getFootprintCells,
    getFigureSize, getBoardStateForMovement, getMovementProfile,
    computeMovementCache, getSpacesAtCost, getMovementTarget,
    getMovementPath, ensureMovementCache, getNormalizedFootprint,
    resolveMassivePush, rollAttackDice, rollDefenseDice,
    rollSingleAttackDie, rollSingleDefenseDie, recalcAttackTotals,
    recalcDefenseTotals, getInnateRerolls, getAttackerSurgeAbilities,
    parseSurgeEffect, getAbility, resolveSurgeAbility, getSurgeAbilityLabel,
    resolveAbility, getPlayableCcFromHand, isCcPlayableNow,
    isCcPlayLegalByRestriction, filterMapSpacesByBounds,
    reduceHp, healHp, awardKillVp, awardObjectiveVp, deductVp, removeFigurePosition,

    // Data loader (imported)
    getDcEffects, getDiceData, getCcEffect, isCcAttachment, isDcAttachment,
    isDcUnique, getMapData, getMapRegistry, getMapTokensData,
    getTournamentRotation, getMissionCardsData, getMissionRules, resolveDcName, isFigurelessDc,

    // Discord UI (imported)
    logGameAction, getInitiativePlayerZoneLabel,
    getHandTooltipEmbed, getHandSquadButtons, getMapSelectionTooltipEmbed,
    getMoveMpButtonRows,
    getSpaceChoiceRows, getActionsCounterContent,
    updateActivationsMessage, getGeneralSetupButtons, getMapTypeButtons,
    getMapConfirmButton, getMissionSelectDrawMenu, getMissionSelectionPickMenu,
    getDeploymentZoneButtons, getCcShuffleDrawButton,
    getIllegalCcPlayButtons, getNegationResponseButtons, getCelebrationButtons,
    getLobbyEmbed, getLobbyStartButton, updateThreadName, getDeploySpaceGridRows,
    buildDeployRowButtons,

    // Combat (imported from handlers)
    sendRerollUI, proceedAfterRerolls, sendReadyToResolveRolls,

    // Mission rules (imported)
    runEndOfRoundRules, runStartOfRoundRules,
    runNpcThugActivation, runNpcKryknaActivation,

    // Locally defined helpers
    applySquadSubmission, shuffleArray, buildHandDisplayPayload,
    updateHandVisualMessage, updatePlayAreaDcButtons,
    sendRoundActivationPhaseMessage, runStartOfRoundDcEffects, runStatusPhaseAfterEndOfRound, runPostDeployPhase, sendPhaseGateMessages,
    buildDiscardPileDisplayPayload, updateDiscardPileMessage,
    updateAttachmentMessageForDc, updateDcActionsMessage,
    buildDcEmbedAndFiles, getConditionsForDcMessage, getNicknamesForDcMessage, getDcPlayAreaComponents,
    buildBoardMapPayload, getMapAttachmentForSpaces, ensureMovementBankMessage,
    updateMovementBankMessage, getConditionCardPath, getDcActionButtons,
    getActivationMinimapAttachment, getActivateDcButtons,
    isDepletedRemovedFromGame, getPlayableCcSpecialsForDc,
    getPlayableCcEndOfActivationForDc, getPlayableCcDoubleActionsForDc,
    getDcStats, getEffectiveSpeed, getMovementMinimapAttachment,
    clearMoveGridMessages, getLegalInteractOptions, sendBleedingPrompt,
    getCommandCardImagePath, findDcMessageIdForFigure, isGroupDefeated,
    checkWinConditions, applyDamageAndFinishCombat, finishCombatResolution,
    checkPostCombatSurges, resolveCombatAfterRolls, hasActionsRemainingInGame,
    getPlayerZoneLabel, updateHandChannelMessages, maybeShowEndActivationPhaseButton,
    countTerminalsControlledByPlayer, isFigureInDeploymentZone,
    getFiguresOnOrAdjacentToSpace, applyNpcDamageToFigure,
    postDevaronDoorButtons, postDevaronCratePushPrompts, postKryknaPushButtons, postFluctuationSwapButtons,
    getSpaceController, shouldShowEndActivationPhaseButton, getPlayReadyMaps,
    getDetermineInitiativeButtons, populatePlayAreas,
    postMissionCardAfterMapSelection, postPinnedMissionCardFromGameState,
    clearPreGameSetup, getDeployFigureLabels, getDeployButtonRows,
    getDeploymentMapAttachment, filterValidTopLeftSpaces,
    updateDeployPromptMessages, finishSetupAttachments,
    createPlayAreaChannels, createBoardChannel, createHandThreads,
    refreshAllGameComponents, applyDirectDamageToFigure,
    getMissionTokenLabel, countActiveGamesForPlayer, sendDeckIllegalAlert, sendSquadConfirmation, buildSquadConfirmText,
    runDraftRandom, getRange, hasLineOfSight,
    getDeploymentZones,
    // Combat special effects deps
    calculateKillVp, decrementActivationIfGroupDefeated,
    checkHuntDissent, checkFriendlyDefeatedPassiveRedraws, checkNefariousGains,
    ccAttachmentsKey,
    getDcUpgradeAttachments, getFigureLabel,
    filterCondition, isConditionImmune,
    applyCondition: _applyCondition, HARMFUL_CONDITIONS,

    // Game lifecycle
    postGameOver,

    // Lobby
    lobbies: getLobbiesMap(),
    createGameChannels,
  };
}

// Startup validation: every dep key in CONTEXT_GROUPS must exist in buildAllDeps()
{
  const _allDeps = buildAllDeps();
  const _required = getAllRequiredDepKeys();
  const _missing = [..._required].filter(k => !(k in _allDeps));
  if (_missing.length) throw new Error(`buildAllDeps() missing keys used by CONTEXT_GROUPS: ${_missing.join(', ')}`);
}

client.on('interactionCreate', async (interaction) => {
  // Global readiness gate — reject all interactions while the bot is still starting up
  if (!botReady) {
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: '🔄 **Bot is rebooting.** Please wait a few minutes and try again.', ephemeral: true });
      }
    } catch {}
    return;
  }
  try {
  if (interaction.isAutocomplete()) {
    const cmd = interaction.commandName;
    if (cmd === 'move-figure' || cmd === 'power-token' || cmd === 'condition') {
      const focused = interaction.options.getFocused(true);
      if (focused.name === 'figure') {
        const result = findGameByChannel(getGamesMap(), interaction.channelId);
        if (!result) return interaction.respond([]).catch(() => {});
        const game = result.game;
        const poses = game.figurePositions || { 1: {}, 2: {} };
        const allKeys = [...Object.keys(poses[1] || {}), ...Object.keys(poses[2] || {})];
        const query = focused.value.toLowerCase();
        const filtered = allKeys
          .filter((k) => k.toLowerCase().includes(query))
          .slice(0, 25);
        return interaction.respond(
          filtered.map((k) => ({ name: k, value: k }))
        ).catch(() => {});
      }
    }
    if (cmd === 'selfplay') {
      const focused = interaction.options.getFocused(true);
      const query = focused.value.toLowerCase();
      if (focused.name === 'p1_deck' || focused.name === 'p2_deck') {
        const decks = getDestructTestDecks();
        const filtered = decks.map(d => d.name).filter(n => n.toLowerCase().includes(query)).slice(0, 25);
        return interaction.respond(filtered.map(n => ({ name: n, value: n }))).catch(() => {});
      }
      if (focused.name === 'map_id') {
        const maps = getPlayReadyMaps();
        const filtered = maps.map(m => m.id).filter(id => id.toLowerCase().includes(query)).slice(0, 25);
        return interaction.respond(filtered.map(id => ({ name: id, value: id }))).catch(() => {});
      }
    }
    return;
  }
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;
    if (cmd === 'botmenu') {
      const channelId = interaction.channelId;
      let gameByChannel = null;
      for (const [gid, g] of getGamesMap()) {
        if (g.generalId === channelId) {
          gameByChannel = g;
          break;
        }
      }
      if (!gameByChannel) {
        await interaction.reply({
          content: 'Use /botmenu in the **Game Log** channel of the game you want to manage.',
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
      const showForfeit = !gameByChannel.ended && (gameByChannel.player1Id === interaction.user.id || gameByChannel.player2Id === interaction.user.id);
      await interaction.reply({
        content: '**Bot Stuff** — Choose an action:',
        components: [getBotmenuButtons(gameByChannel.gameId, { showForfeit })],
        ephemeral: false,
      }).catch(discordCatch);
      return;
    }
    if (cmd === 'power-token') {
      const game = findGameByCommonChannel(getGamesMap(), interaction.channelId);
      if (!game) {
        await interaction.reply({
          content: 'Use /power-token in the **Game Log** or **Board** channel of an active game.',
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
      if (await replyIfGameEnded(game, interaction)) return;
      const sub = interaction.options.getSubcommand();
      if (sub === 'list') {
        const tokens = game.figurePowerTokens || {};
        const entries = Object.entries(tokens).filter(([, arr]) => arr?.length > 0);
        const lines = entries.length
          ? entries.map(([fk, arr]) => `**${fk}**: ${arr.join(', ')}`).join('\n')
          : 'No Power Tokens on any figure.';
        await interaction.reply({
          content: `**Power Tokens**\n${lines}`,
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
      const figureKey = interaction.options.getString('figure');
      const poses = game.figurePositions || { 1: {}, 2: {} };
      const allFigureKeys = [...Object.keys(poses[1] || {}), ...Object.keys(poses[2] || {})];
      const match = allFigureKeys.find((k) => k.toLowerCase() === figureKey.toLowerCase());
      const fk = match || (allFigureKeys.includes(figureKey) ? figureKey : null);
      if (!fk) {
        await interaction.reply({
          content: `Figure **${figureKey}** not found. Valid keys: ${allFigureKeys.slice(0, 8).join(', ')}${allFigureKeys.length > 8 ? '...' : ''}`,
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
      if (sub === 'add') {
        const type = interaction.options.getString('type');
        if (game.figurePowerTokens[fk].length >= 2) {
          await interaction.reply({
            content: `${fk} already has 2 Power Tokens (max). Remove one first.`,
            ephemeral: true,
          }).catch(discordCatch);
          return;
        }
        game.figurePowerTokens[fk] = [...game.figurePowerTokens[fk], type];
        saveGames();
        await interaction.reply({
          content: `Added **${type}** Power Token to **${fk}**.`,
          ephemeral: false,
        }).catch(discordCatch);
      } else {
        const idx = interaction.options.getInteger('index');
        const arr = game.figurePowerTokens[fk];
        if (!arr || arr.length < idx) {
          await interaction.reply({
            content: `${fk} does not have a token at index ${idx}. Current: ${(arr || []).join(', ') || 'none'}`,
            ephemeral: true,
          }).catch(discordCatch);
          return;
        }
        const removed = arr[idx - 1];
        game.figurePowerTokens[fk] = arr.filter((_, i) => i !== idx - 1);
        if (game.figurePowerTokens[fk].length === 0) delete game.figurePowerTokens[fk];
        saveGames();
        await interaction.reply({
          content: `Removed **${removed}** Power Token from **${fk}**.`,
          ephemeral: false,
        }).catch(discordCatch);
      }
      if (game.boardId && game.selectedMap) {
        try {
          const boardChannel = await interaction.client.channels.fetch(game.boardId);
          const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        } catch (e) {
          console.error('Power token: refresh map failed', e);
        }
      }
      return;
    }
    if (cmd === 'condition') {
      const game = findGameByCommonChannel(getGamesMap(), interaction.channelId);
      if (!game) {
        await interaction.reply({
          content: 'Use /condition in the **Game Log** or **Board** channel of an active game.',
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
      if (await replyIfGameEnded(game, interaction)) return;
      const sub = interaction.options.getSubcommand();
      if (sub === 'list') {
        const conds = game.figureConditions || {};
        const entries = Object.entries(conds).filter(([, arr]) => arr?.length > 0);
        const lines = entries.length
          ? entries.map(([fk, arr]) => `**${fk}**: ${arr.join(', ')}`).join('\n')
          : 'No conditions on any figure.';
        await interaction.reply({
          content: `**Conditions**\n${lines}`,
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
      const figureKey = interaction.options.getString('figure');
      const poses = game.figurePositions || { 1: {}, 2: {} };
      const allFigureKeys = [...Object.keys(poses[1] || {}), ...Object.keys(poses[2] || {})];
      const match = allFigureKeys.find((k) => k.toLowerCase() === figureKey.toLowerCase());
      const fk = match || (allFigureKeys.includes(figureKey) ? figureKey : null);
      if (!fk) {
        await interaction.reply({
          content: `Figure **${figureKey}** not found. Valid keys: ${allFigureKeys.slice(0, 8).join(', ')}${allFigureKeys.length > 8 ? '...' : ''}`,
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
      const condType = interaction.options.getString('type');
      if (sub === 'add') {
        const applied = _applyCondition(game, fk, condType);
        saveGames();
        await interaction.reply({
          content: applied
            ? `Applied **${condType}** to **${fk}**.`
            : `**${fk}** already has **${condType}**.`,
          ephemeral: false,
        }).catch(discordCatch);
      } else {
        const had = game.figureConditions?.[fk]?.includes(condType);
        filterCondition(game, fk, condType);
        saveGames();
        await interaction.reply({
          content: had
            ? `Removed **${condType}** from **${fk}**.`
            : `**${fk}** does not have **${condType}**.`,
          ephemeral: false,
        }).catch(discordCatch);
      }
      if (game.boardId && game.selectedMap) {
        try {
          const boardChannel = await interaction.client.channels.fetch(game.boardId);
          const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        } catch (e) {
          console.error('Condition: refresh map failed', e);
        }
      }
      return;
    }
    if (cmd === 'move-figure') {
      const game = findGameByCommonChannel(getGamesMap(), interaction.channelId);
      if (!game) {
        await interaction.reply({ content: 'Use /move-figure in the **Game Log** or **Board** channel of an active game.', ephemeral: true }).catch(discordCatch);
        return;
      }
      if (await replyIfGameEnded(game, interaction)) return;
      const figureKey = interaction.options.getString('figure');
      const coordRaw = interaction.options.getString('coord').trim().toLowerCase();
      const poses = game.figurePositions || { 1: {}, 2: {} };
      let playerNum = null;
      let fk = null;
      for (const pNum of [1, 2]) {
        const keys = Object.keys(poses[pNum] || {});
        const match = keys.find((k) => k.toLowerCase() === figureKey.toLowerCase());
        if (match) { playerNum = pNum; fk = match; break; }
      }
      if (!fk) {
        const allKeys = [...Object.keys(poses[1] || {}), ...Object.keys(poses[2] || {})];
        await interaction.reply({ content: `Figure **${figureKey}** not found on map. On-map keys: ${allKeys.slice(0, 10).join(', ')}${allKeys.length > 10 ? '...' : ''}`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const prevCoord = poses[playerNum][fk];
      game.figurePositions[playerNum][fk] = coordRaw;
      saveGames();
      await logGameAction(game, interaction.client, `🔧 **Manual move**: **${fk}** from **${String(prevCoord).toUpperCase()}** → **${coordRaw.toUpperCase()}** (by <@${interaction.user.id}>)`, { phase: 'ROUND', icon: 'move' });
      if (game.boardId && game.selectedMap) {
        try {
          const boardChannel = await interaction.client.channels.fetch(game.boardId);
          const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        } catch (e) { console.error('move-figure: refresh map failed', e); }
      }
      await interaction.reply({ content: `Moved **${fk}** to **${coordRaw.toUpperCase()}**.`, ephemeral: false }).catch(discordCatch);
      return;
    }
    if (cmd === 'events') {
      const match = findGameByCommonChannel(getGamesMap(), interaction.channelId)
                 || findGameByChannel(getGamesMap(), interaction.channelId);
      if (!match) {
        await interaction.reply({ content: 'Use /events in a game channel.', ephemeral: true }).catch(discordCatch);
        return;
      }
      const gameId = match.gameId || match;
      const count = interaction.options.getInteger('count') || 10;
      const recent = getRecentEvents(gameId, count);
      if (recent.length === 0) {
        await interaction.reply({ content: `No events recorded for game **${gameId}** yet.`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const lines = recent.map((evt) => {
        const ts = new Date(evt.timestamp);
        const time = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}`;
        const changedKeys = evt.diff ? Object.keys(evt.diff.set || {}).concat(evt.diff.deleted || []).join(', ') : '(no diff)';
        return `\`${time}\` **${evt.handlerKey}** by <@${evt.playerId}> — changed: ${changedKeys}`;
      });
      await interaction.reply({ content: `**Recent events for ${gameId}** (last ${recent.length}):\n${lines.join('\n')}`, ephemeral: true }).catch(discordCatch);
      return;
    }
    if (cmd === 'gamestate') {
      const match = findGameByCommonChannel(getGamesMap(), interaction.channelId)
                 || findGameByChannel(getGamesMap(), interaction.channelId);
      if (!match) {
        await interaction.reply({ content: 'Use /gamestate in a game channel.', ephemeral: true }).catch(discordCatch);
        return;
      }
      const game = match.game || match;
      const gid = game.gameId || match.gameId;
      const p1Figs = Object.keys(game.figurePositions?.[1] || {}).length;
      const p2Figs = Object.keys(game.figurePositions?.[2] || {}).length;
      const p1Conditions = Object.entries(game.figureConditions?.[1] || {}).filter(([, v]) => v?.length).length;
      const p2Conditions = Object.entries(game.figureConditions?.[2] || {}).filter(([, v]) => v?.length).length;
      const pendingReason = getRecoveryReason(game) || 'none';
      const p1Hand = game.player1CcHand?.length ?? '?';
      const p2Hand = game.player2CcHand?.length ?? '?';
      const p1Deck = game.player1CcDeck?.length ?? '?';
      const p2Deck = game.player2CcDeck?.length ?? '?';
      const lines = [
        `**Game #${gid}** — Diagnostic Snapshot`,
        `**Phase:** ${game.phase || '?'} | **Round phase:** ${game.roundPhase || '?'}`,
        `**Round:** ${game.currentRound ?? '?'} | **Ended:** ${game.ended || false}`,
        `**Map:** ${game.selectedMap?.name || 'none'}`,
        `**P1 squad:** ${game.player1Squad?.name || 'null'} | **P2 squad:** ${game.player2Squad?.name || 'null'}`,
        `**Initiative:** ${game.initiativePlayerId ? `<@${game.initiativePlayerId}>` : 'undetermined'}`,
        `**Current turn:** ${game.currentActivationTurnPlayerId ? `<@${game.currentActivationTurnPlayerId}>` : 'none'}`,
        `**Figures alive:** P1=${p1Figs}, P2=${p2Figs}`,
        `**Conditions:** P1=${p1Conditions} figs, P2=${p2Conditions} figs`,
        `**VP:** P1=${game.player1VP?.total ?? 0} (${game.player1VP?.kills ?? 0}k/${game.player1VP?.objectives ?? 0}o) | P2=${game.player2VP?.total ?? 0} (${game.player2VP?.kills ?? 0}k/${game.player2VP?.objectives ?? 0}o)`,
        `**CC hand/deck:** P1=${p1Hand}/${p1Deck}, P2=${p2Hand}/${p2Deck}`,
        `**Pending state:** ${pendingReason}`,
        `**AI player:** ${game.aiPlayerNum || 'none'} | **Self-play:** ${game.selfPlay || false}`,
        `**DC msg IDs:** P1=${(game.p1DcMessageIds || []).filter(Boolean).length}, P2=${(game.p2DcMessageIds || []).filter(Boolean).length}`,
      ];
      await interaction.reply({ content: lines.join('\n'), ephemeral: true }).catch(discordCatch);
      return;
    }
    if (cmd === 'play-ai') {
      const channelName = (interaction.channel?.name || '').toLowerCase();
      if (channelName !== 'lfg') {
        await interaction.reply({ content: 'Use /play-ai in the **#lfg** channel.', ephemeral: true }).catch(discordCatch);
        return;
      }
      const scenarioId = interaction.options.getString('scenario') || null;
      await interaction.deferReply({ ephemeral: false }).catch(discordCatch);
      try {
        const aiUserId = `${AI_USER_PREFIX}2`;
        // Auto-setup: when no scenario, use seedConfig so createTestGame calls runDraftRandom
        let aiSeedConfig;
        if (!scenarioId) {
          const maps = getPlayReadyMaps();
          if (maps.length === 0) throw new Error('No play-ready maps available.');
          const map = maps[Math.floor(Math.random() * maps.length)];
          aiSeedConfig = { mapId: map.id, p1Deck: DEFAULT_DECK_REBELS, p2Deck: DEFAULT_DECK_IMPERIAL };
        }
        const { gameId } = await createTestGame(client, interaction.guild, interaction.user.id, scenarioId, interaction.channel, { player2Id: aiUserId, seedConfig: aiSeedConfig });
        const game = getGame(gameId);
        if (game) {
          game.aiPlayerNum = 2;
          game.guildId = interaction.guild.id;
          saveGames();
          // Kick off AI turns after a brief delay
          setTimeout(async () => {
            try {
              await runAiTurnLive(game, client, buildAllDeps, getGame, {
                maxSteps: 50,
                delayMs: 2000,
                deps: { dcMessageMeta, dcExhaustedState },
                atomicOpts,
              });
            } catch (err) {
              console.error('[play-ai] AI turn error:', err.message);
            }
          }, 3000);
        }
        await interaction.editReply({
          content: `**AI Game #${gameId}** created! The AI will play as Player 2. Head to the game channels to start playing.`,
        }).catch(discordCatch);
      } catch (err) {
        console.error('/play-ai error:', err);
        await interaction.editReply({ content: `Failed to create AI game: ${err.message}` }).catch(discordCatch);
      }
      return;
    }
    if (cmd === 'add-ai') {
      const match = findGameByCommonChannel(getGamesMap(), interaction.channelId)
                 || findGameByChannel(getGamesMap(), interaction.channelId);
      if (!match) {
        await interaction.reply({ content: 'Use /add-ai in a **Game Log** channel.', ephemeral: true }).catch(discordCatch);
        return;
      }
      const game = match.game || getGame(match.gameId || match);
      if (!game) {
        await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(discordCatch);
        return;
      }
      if (game.ended) {
        await interaction.reply({ content: 'This game has already ended.', ephemeral: true }).catch(discordCatch);
        return;
      }
      if (game.aiPlayerNum) {
        await interaction.reply({ content: `This game already has an AI on Player ${game.aiPlayerNum}.`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const playerNum = interaction.options.getInteger('player') || 2;
      const aiUserId = `${AI_USER_PREFIX}${playerNum}`;
      markGameAsAi(game, playerNum);
      game.guildId = interaction.guild?.id || game.guildId;
      saveGames();
      await interaction.reply({
        content: `AI added as **Player ${playerNum}** in game **${game.gameId}**. The AI will respond automatically after your actions.`,
      }).catch(discordCatch);
      // Kick off AI turns immediately
      setTimeout(async () => {
        try {
          await runAiTurnLive(game, client, buildAllDeps, getGame, {
            maxSteps: 50,
            delayMs: 2000,
            deps: { dcMessageMeta, dcExhaustedState },
            atomicOpts,
          });
        } catch (err) {
          console.error('[add-ai] AI turn error:', err.message);
        }
      }, 1500);
      return;
    }

    // /favorites — view/rename/remove saved decks
    if (cmd === 'favorites') {
      const { isFavoritesAvailable, getFavoriteDecks } = await import('./src/db.js');
      if (!isFavoritesAvailable()) {
        await interaction.reply({ content: 'Favorites are unavailable right now.', ephemeral: true }).catch(discordCatch);
        return;
      }
      const favs = await getFavoriteDecks(interaction.user.id);
      if (favs === null) {
        await interaction.reply({ content: 'Favorites are unavailable right now.', ephemeral: true }).catch(discordCatch);
        return;
      }
      const payload = buildFavoritesListPayload(favs);
      await interaction.reply({ ...payload, ephemeral: true }).catch(discordCatch);
      return;
    }

    // /selfplay — dev-only AI-vs-AI self-play (admin only)
    if (cmd === 'selfplay') {
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: 'Admin only (Manage Server required).', ephemeral: true }).catch(discordCatch);
        return;
      }
      const action = interaction.options.getString('action');

      if (action === 'status') {
        const qs = getQueueStatus();
        const activeId = getActiveSelfPlayGameId();
        if (qs.state === 'idle' && !activeId) {
          await interaction.reply({ content: 'Self-play idle.', ephemeral: true }).catch(discordCatch);
          return;
        }
        const modeLabel = qs.seedMode ? 'seed auto-select' : 'scenario round-robin';
        const lines = [
          `**State:** ${qs.state} (${modeLabel})`,
          `**Runs:** ${qs.runCount} (${qs.failCount} failed)`,
          `**Current:** ${qs.currentRunScenario || 'none'}`,
        ];
        if (!qs.seedMode) lines.push(`**Rotation:** ${qs.rotationIndex} / ${qs.totalScenarios} scenarios`);
        if (activeId) lines.push(`**Active game:** ${activeId}`);
        if (qs.pauseReason) lines.push(`**Pause reason:** ${qs.pauseReason}`);
        await interaction.reply({ content: lines.join('\n'), ephemeral: true }).catch(discordCatch);
        return;
      }

      if (action === 'stop') {
        try {
          stopQueue();
          await interaction.reply({ content: 'Self-play stopping after current game.', ephemeral: false }).catch(discordCatch);
        } catch (err) {
          await interaction.reply({ content: err.message, ephemeral: true }).catch(discordCatch);
        }
        return;
      }

      // action === 'seed' — config-family replay of a ranked headless seed
      if (action === 'seed') {
        const p1DeckName = interaction.options.getString('p1_deck');
        const p2DeckName = interaction.options.getString('p2_deck');
        const mapId = interaction.options.getString('map_id');
        if (!p1DeckName || !p2DeckName || !mapId) {
          await interaction.reply({ content: 'Seed validation requires p1_deck, p2_deck, and map_id.', ephemeral: true }).catch(discordCatch);
          return;
        }
        if (getActiveSelfPlayGameId()) {
          await interaction.reply({ content: `Self-play already active for game ${getActiveSelfPlayGameId()}. Stop it first.`, ephemeral: true }).catch(discordCatch);
          return;
        }
        const decks = getDestructTestDecks();
        const p1Deck = decks.find(d => d.name === p1DeckName);
        const p2Deck = decks.find(d => d.name === p2DeckName);
        if (!p1Deck) {
          await interaction.reply({ content: `Deck not found: "${p1DeckName}"`, ephemeral: true }).catch(discordCatch);
          return;
        }
        if (!p2Deck) {
          await interaction.reply({ content: `Deck not found: "${p2DeckName}"`, ephemeral: true }).catch(discordCatch);
          return;
        }
        const maps = getPlayReadyMaps();
        if (!maps.find(m => m.id === mapId)) {
          await interaction.reply({ content: `Map not found in play-ready maps: "${mapId}"`, ephemeral: true }).catch(discordCatch);
          return;
        }

        await interaction.reply({
          content: `**Seed validation starting**: ${p1DeckName} vs ${p2DeckName} @ ${mapId}\nConfig-family replay (initiative/zone/CC draw randomized).`,
          ephemeral: false,
        }).catch(discordCatch);

        // Create game with seed config override (bypass queue, single game)
        const seedConfig = { mapId, p1Deck, p2Deck };
        let gameId = null;
        try {
          const aiP1 = `${AI_USER_PREFIX}1`;
          const aiP2 = `${AI_USER_PREFIX}2`;
          const created = await createTestGame(client, interaction.guild, aiP1, null, interaction.channel, { player2Id: aiP2, seedConfig });
          gameId = created.gameId;

          const game = getGame(gameId);
          if (!game) throw new Error('Game creation returned no game state');
          game.selfPlay = true;
          game.guildId = interaction.guild.id;
          saveGames();

          // Run self-play loop (single game, not queued)
          const loopResult = await runSelfPlayLoop(game, client, {
            buildAllDeps,
            getGame,
            atomicOpts,
            actionDeps: { dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData, computeMovementCache, getBoardStateForMovement, getMovementProfile, getPlayableCcFromHand },
            scenario: `seed:${p1DeckName}_vs_${p2DeckName}@${mapId}`,
            guildId: interaction.guild.id,
            delayMs: 200,
            explorationMode: 'seed_validation',
          });

          const artifact = loopResult.artifact;
          const dedupedKeys = artifact?.transitions_hit || [];

          // Persist transition coverage to exploration_transitions (discord_count)
          for (const key of dedupedKeys) {
            const { roundPhase, pendingSet, actionType } = parseTransitionKey(key);
            await upsertDiscordTransition(key, roundPhase, pendingSet, actionType);
          }

          // Persist episode to exploration_episodes (source='discord')
          await insertExplorationEpisode({
            episode_id: randomUUID(),
            source: 'discord',
            seed_config: { mapId, p1Deck: p1DeckName, p2Deck: p2DeckName },
            total_steps: artifact?.total_steps || 0,
            unique_transitions: dedupedKeys.length,
            novel_transitions: 0,
            invariant_errors: 0,
            transitions_hit: dedupedKeys,
            result: artifact?.result || loopResult.result,
            stop_reason: artifact?.stop_reason || 'unknown',
            duration_ms: artifact?.duration_ms || 0,
          });

          // Cleanup on success; preserve on failure
          if (loopResult.result !== 'failed' && gameId) {
            try {
              const g = getGame(gameId);
              if (g) await deleteGameChannelsAndGame(g, gameId, {
                client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
                deleteGameFromDb,
              });
            } catch (err) {
              console.error(`[seed-validation] Cleanup failed for ${gameId}:`, err.message);
            }
          }

          const resultMsg = [
            `**Seed validation ${loopResult.result}**: ${p1DeckName} vs ${p2DeckName} @ ${mapId}`,
            `Steps: ${artifact?.total_steps || 0} | Transitions: ${dedupedKeys.length} | Stop: ${artifact?.stop_reason || 'unknown'}`,
          ].join('\n');
          await interaction.followUp({ content: resultMsg }).catch(discordCatch);

        } catch (err) {
          console.error('[seed-validation] Error:', err);
          await interaction.followUp({ content: `Seed validation failed: ${err.message}` }).catch(discordCatch);
        }
        return;
      }

      // action === 'start' — begin self-play, or resume if paused
      const qs = getQueueStatus();
      if (qs.state === 'paused') {
        try {
          resumeQueue();
          await interaction.reply({ content: `**Self-play resumed** — was paused (${qs.pauseReason || 'unknown'}). Run ${qs.runCount + 1} next.`, ephemeral: false }).catch(discordCatch);
        } catch (err) {
          await interaction.reply({ content: err.message, ephemeral: true }).catch(discordCatch);
        }
        return;
      }
      try {
        startQueue({
          client,
          guild: interaction.guild,
          guildId: interaction.guild.id,
          buildAllDeps,
          getGame,
          atomicOpts,
          actionDeps: { dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData, computeMovementCache, getBoardStateForMovement, getMovementProfile, getPlayableCcFromHand },
          createTestGame,
          deleteGameChannelsAndGame,
          cleanupCtx: {
            client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState,
            deleteGameFromDb,
          },
          scenarios: [], // unused in seed mode
          seedMode: true,
          getNextSeed: () => getTopValidationCandidate(getDestructTestDecks),
          onSeedRunComplete: async (artifact, seedConfig) => {
            const dedupedKeys = artifact?.transitions_hit || [];
            // Persist transition coverage (discord_count)
            for (const key of dedupedKeys) {
              const { roundPhase, pendingSet, actionType } = parseTransitionKey(key);
              await upsertDiscordTransition(key, roundPhase, pendingSet, actionType);
            }
            // Persist episode (source='discord')
            await insertExplorationEpisode({
              episode_id: randomUUID(),
              source: 'discord',
              seed_config: { mapId: seedConfig.mapId, p1Deck: seedConfig.p1Deck.name, p2Deck: seedConfig.p2Deck.name },
              total_steps: artifact?.total_steps || 0,
              unique_transitions: dedupedKeys.length,
              novel_transitions: 0,
              invariant_errors: 0,
              transitions_hit: dedupedKeys,
              result: artifact?.result || 'unknown',
              stop_reason: artifact?.stop_reason || 'unknown',
              duration_ms: artifact?.duration_ms || 0,
            });
          },
          interGameDelayMs: 5000,
          delayMs: 200,
          feedbackChannel: interaction.channel,
          logChannel: interaction.channel,
          saveGames,
          AI_USER_PREFIX,
          botLogsPost: async (artifact) => {
            try {
              await logGameErrorToBotLogs(client, interaction.guild, artifact.game_id,
                new Error(`Self-play ${artifact.stop_reason}: ${artifact.error_message || 'no details'}`),
                'selfplay');
            } catch {}
          },
        });
        await interaction.reply({
          content: '**Self-play started** — auto-selecting highest-ranked unvalidated seeds. Use `/selfplay status` to check.',
          ephemeral: false,
        }).catch(discordCatch);
      } catch (err) {
        await interaction.reply({ content: `Start failed: ${err.message}`, ephemeral: true }).catch(discordCatch);
      }
      return;
    }

    // Stats commands: only in #statistics channel; require DB
    const statsChannelName = (interaction.channel?.name || '').toLowerCase();
    const statsCmds = ['statcheck', 'affiliationwinrateglobal', 'affiliationwinratepersonal', 'affiliationpickrateglobal', 'affiliationpickratepersonal', 'dcwinrateglobaltopten', 'dcwinratepersonaltopten', 'leaderboard'];
    if (statsCmds.includes(cmd)) {
      if (statsChannelName !== 'statistics') {
        await interaction.reply({
          content: 'Use this command in the **#statistics** channel.',
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
      if (!isDbConfigured()) {
        await interaction.reply({
          content: 'Stats require a database (DATABASE_URL). No data available.',
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
      await interaction.deferReply({ ephemeral: false }).catch(discordCatch);
      try {
        if (cmd === 'statcheck') {
          const targetUser = interaction.options.getUser('player');
          if (targetUser) {
            const s = await getStatsSummaryForPlayer(targetUser.id);
            await interaction.editReply({
              content: `**Stats for ${targetUser.username}**\nGames: **${s.games}** | Wins: **${s.wins}** | Losses: **${s.losses}** | Win rate: **${s.winRate}%**`,
            }).catch(discordCatch);
          } else {
            const { totalGames } = await getStatsSummary();
            await interaction.editReply({
              content: `**Completed games:** ${totalGames}`,
            }).catch(discordCatch);
          }
        } else if (cmd === 'affiliationwinrateglobal') {
          const rows = await getAffiliationWinRates();
          const lines = rows.length
            ? rows.map((r) => `${r.affiliation}: **${r.wins}** / **${r.games}** (${r.winRate}% win rate)`).join('\n')
            : 'No completed games with affiliation data yet.';
          await interaction.editReply({ content: `**Win rate by affiliation (global)**\n${lines}` }).catch(discordCatch);
        } else if (cmd === 'affiliationwinratepersonal') {
          const rows = await getAffiliationWinRatesPersonal(interaction.user.id);
          const lines = rows.length
            ? rows.map((r) => `${r.affiliation}: **${r.wins}** / **${r.games}** (${r.winRate}% win rate)`).join('\n')
            : 'No completed games with affiliation data for you yet.';
          await interaction.editReply({ content: `**Your win rate by affiliation**\n${lines}` }).catch(discordCatch);
        } else if (cmd === 'affiliationpickrateglobal') {
          const rows = await getAffiliationPickRates();
          const lines = rows.length
            ? rows.map((r) => `${r.affiliation}: **${r.picks}** picks / **${r.totalArmies}** armies (${r.pickRate}%)`).join('\n')
            : 'No completed games with affiliation data yet.';
          await interaction.editReply({ content: `**Pick rate by affiliation (global)**\n${lines}` }).catch(discordCatch);
        } else if (cmd === 'affiliationpickratepersonal') {
          const rows = await getAffiliationPickRatesPersonal(interaction.user.id);
          const lines = rows.length
            ? rows.map((r) => `${r.affiliation}: **${r.picks}** picks / **${r.totalArmies}** armies (${r.pickRate}%)`).join('\n')
            : 'No completed games with affiliation data for you yet.';
          await interaction.editReply({ content: `**Your pick rate by affiliation**\n${lines}` }).catch(discordCatch);
        } else if (cmd === 'dcwinrateglobaltopten') {
          const limit = interaction.options.getInteger('limit') ?? 20;
          const rows = await getDcWinRates(limit);
          const lines = rows.length
            ? rows.map((r) => `${r.dcName}: **${r.wins}** / **${r.games}** (${r.winRate}%)`).join('\n')
            : 'No completed games with army data yet.';
          await interaction.editReply({
            content: `**Win rate by Deployment Card** (top ${limit} by games played, global)\n${lines}`,
          }).catch(discordCatch);
        } else if (cmd === 'dcwinratepersonaltopten') {
          const limit = interaction.options.getInteger('limit') ?? 20;
          const rows = await getDcWinRatesPersonal(interaction.user.id, limit);
          const lines = rows.length
            ? rows.map((r) => `${r.dcName}: **${r.wins}** / **${r.games}** (${r.winRate}%)`).join('\n')
            : 'No completed games with army data for you yet.';
          await interaction.editReply({
            content: `**Your win rate by Deployment Card** (top ${limit} by games played)\n${lines}`,
          }).catch(discordCatch);
        } else if (cmd === 'leaderboard') {
          const limit = interaction.options.getInteger('limit') ?? 5;
          const rows = await getLeaderboard(limit);
          const lines = rows.length
            ? rows.map((r, i) => `**${i + 1}.** <@${r.playerId}> — **${r.winRate}%** (${r.wins}W / ${r.losses}L / ${r.draws}D over ${r.games} games)`).join('\n')
            : 'No player has completed their 5 preliminary games yet.';
          await interaction.editReply({
            content: `**Leaderboard** (top ${limit} by win rate, min. 5 games)\n${lines}`,
            allowedMentions: { users: [] },
          }).catch(discordCatch);
        }
      } catch (err) {
        console.error(`Stats command /${cmd} failed:`, err);
        await interaction.editReply({
          content: `Something went wrong: ${err.message}`,
        }).catch(discordCatch);
      }
      return;
    }
    if (cmd === 'achievements') {
      if (!isDbConfigured()) {
        await interaction.reply({ content: 'Achievements require a database (DATABASE_URL). No data available.', ephemeral: true }).catch(discordCatch);
        return;
      }
      await interaction.deferReply({ ephemeral: false }).catch(discordCatch);
      try {
        const targetUser = interaction.options.getUser('player') || interaction.user;
        const earned = await getEarnedAchievements(targetUser.id);
        const embed = new EmbedBuilder()
          .setColor(COLORS.GOLD)
          .setTitle(`${targetUser.username}'s Achievements`)
          .setDescription(
            earned.length
              ? earned.map((a) => `${a.icon || '🏆'} **${a.name}** — ${a.description} *(${new Date(a.earned_at).toLocaleDateString()})*`).join('\n')
              : 'No achievements yet — play some games!'
          );
        await interaction.editReply({ embeds: [embed], allowedMentions: { users: [] } }).catch(discordCatch);
      } catch (err) {
        console.error('[Achievements] /achievements command failed:', err.message);
        await interaction.editReply({ content: `Something went wrong: ${err.message}` }).catch(discordCatch);
      }
      return;
    }
  }

  if (interaction.isButton()) {
    const buttonKey = getHandlerKey(interaction.customId, 'button');
    if (!buttonKey) return;
    if (buttonKey === 'ping_active_') {
      await interaction.deferUpdate().catch(discordCatch);
      const gameId = interaction.customId.replace('ping_active_', '');
      const game = getGame(gameId);
      if (!game || game.ended) {
        await interaction.followUp({ content: 'Game not found or already ended.', ephemeral: true }).catch(discordCatch);
        return;
      }
      // 5-minute cooldown
      const PING_COOLDOWN_MS = 5 * 60 * 1000;
      const now = Date.now();
      if (game._lastPingActive && now - game._lastPingActive < PING_COOLDOWN_MS) {
        const remaining = Math.ceil((PING_COOLDOWN_MS - (now - game._lastPingActive)) / 1000);
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        await interaction.followUp({ content: `Ping on cooldown. Try again in ${mins}m ${secs}s.`, ephemeral: true }).catch(discordCatch);
        return;
      }
      game._lastPingActive = now;

      // Pre-game checks (map/squad) — handle before getWaitingPlayers
      const p1HasSquad = !!(game.p1DcList?.length);
      const p2HasSquad = !!(game.p2DcList?.length);
      if (!game.mapSelected) {
        const pingId = game.currentActivationTurnPlayerId || game.initiativePlayerId || game.player1Id;
        await logGameAction(game, client, `🔔 **Nudge** — <@${pingId}> Map selection is pending.`, { allowedMentions: { users: [pingId] } }).catch(discordCatch);
        await interaction.followUp({ content: `Pinged <@${pingId}>.`, ephemeral: true }).catch(discordCatch);
        return;
      }
      if (!p1HasSquad && !p2HasSquad) {
        await logGameAction(game, client, `🔔 **Nudge** — <@${game.player1Id}> <@${game.player2Id}> it's time to submit your squads!`, { allowedMentions: { users: snowflakeUsers([game.player1Id, game.player2Id]) } }).catch(discordCatch);
        await interaction.followUp({ content: 'Pinged both players to submit squads.', ephemeral: true }).catch(discordCatch);
        return;
      }
      if (!p1HasSquad) {
        await logGameAction(game, client, `🔔 **Nudge** — <@${game.player1Id}> Squad submission is pending.`, { allowedMentions: { users: snowflakeUsers([game.player1Id]) } }).catch(discordCatch);
        await interaction.followUp({ content: `Pinged <@${game.player1Id}>.`, ephemeral: true }).catch(discordCatch);
        return;
      }
      if (!p2HasSquad) {
        await logGameAction(game, client, `🔔 **Nudge** — <@${game.player2Id}> Squad submission is pending.`, { allowedMentions: { users: snowflakeUsers([game.player2Id]) } }).catch(discordCatch);
        await interaction.followUp({ content: `Pinged <@${game.player2Id}>.`, ephemeral: true }).catch(discordCatch);
        return;
      }

      // Use getWaitingPlayers to determine who to ping
      const { getWaitingPlayers } = await import('./src/game/phase-gate.js');
      const waiting = getWaitingPlayers(game);
      const playerIds = waiting.playerNums.map(pn => pn === 1 ? game.player1Id : game.player2Id);
      const mentions = playerIds.map(id => `<@${id}>`).join(' and ');
      await logGameAction(game, client, `⏳ ${mentions} — ${waiting.description}`, { allowedMentions: { users: playerIds } }).catch(discordCatch);
      await interaction.followUp({ content: `Pinged ${mentions}.`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    const modalKey = getHandlerKey(interaction.customId, 'modal');
    if (!modalKey) return;
    const _modalLockId = resolveGameIdForLock(interaction);
    await withAtomicGameLock(_modalLockId, atomicOpts, async () => {
    const ccHandContext = {
      getGame,
      saveGames,
      validateDeckLegal,
      sendDeckIllegalAlert,
      applySquadSubmission,
      getDeploymentZones,
      updateDeployPromptMessages,
      logGameAction,
    };
    if (modalKey === 'squad_modal_') await handleSquadModal(interaction, ccHandContext);
    else if (modalKey === 'deploy_modal_') await handleDeployModal(interaction, ccHandContext);
    else if (modalKey === 'devaron_crate_modal_') {
      // customId: devaron_crate_modal_{gameId}_{origCoord}
      const rest2 = interaction.customId.replace('devaron_crate_modal_', '');
      const lu = rest2.lastIndexOf('_');
      const gameId2 = rest2.substring(0, lu);
      const origCoord2 = rest2.substring(lu + 1);
      const game2 = getGame(gameId2);
      if (!game2) { await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(discordCatch); return; }
      const targetRaw = interaction.fields.getTextInputValue('target_coord').trim().toLowerCase();
      const curCoord2 = String(game2.cratePositions?.[origCoord2] || origCoord2).toLowerCase();
      const dist = getRange(curCoord2, targetRaw);
      if (dist === 0) { await interaction.reply({ content: `Crate stays at ${curCoord2.toUpperCase()} — no change.`, ephemeral: true }).catch(discordCatch); return; }
      if (dist > 3) { await interaction.reply({ content: `❌ ${targetRaw.toUpperCase()} is ${dist} spaces from ${curCoord2.toUpperCase()} (max 3). Try again.`, ephemeral: true }).catch(discordCatch); return; }
      await interaction.deferReply({ ephemeral: true }).catch(discordCatch);
      game2.cratePositions = game2.cratePositions || {};
      game2.cratePositions[origCoord2] = targetRaw;
      const ctrl = getSpaceController(game2, 'devaron-garrison', curCoord2);
      const pid2 = ctrl ? (ctrl === 1 ? game2.player1Id : game2.player2Id) : interaction.user.id;
      await logGameAction(game2, client, `📦 <@${pid2}> pushed crate from **${curCoord2.toUpperCase()}** → **${targetRaw.toUpperCase()}** (${dist} space${dist !== 1 ? 's' : ''}).`, { allowedMentions: { users: [pid2] }, phase: 'ROUND', icon: 'round' });
      await interaction.editReply({ content: `Crate pushed: ${curCoord2.toUpperCase()} → ${targetRaw.toUpperCase()} ✓` }).catch(discordCatch);
      saveGames();
    } else if (modalKey === 'krykna_push_modal_') {
      // customId: krykna_push_modal_{gameId}_krykna-{N}
      const rest2 = interaction.customId.replace('krykna_push_modal_', '');
      const kryknaIdx2 = rest2.indexOf('krykna-');
      if (kryknaIdx2 < 0) return;
      const gameId2 = rest2.substring(0, kryknaIdx2 - 1);
      const kryknaId2 = rest2.substring(kryknaIdx2);
      const game2 = getGame(gameId2);
      if (!game2) { await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(discordCatch); return; }
      const krykna2 = (game2.npcKrykna || []).find((k) => k.id === kryknaId2);
      if (!krykna2) { await interaction.reply({ content: 'Krykna not found.', ephemeral: true }).catch(discordCatch); return; }
      const targetRaw2 = interaction.fields.getTextInputValue('target_coord').trim().toLowerCase();
      const dist2 = getRange(String(krykna2.coord).toLowerCase(), targetRaw2);
      if (dist2 === 0) { await interaction.reply({ content: `Krykna stays at ${String(krykna2.coord).toUpperCase()} — no change.`, ephemeral: true }).catch(discordCatch); return; }
      if (dist2 === null || dist2 > 3) { await interaction.reply({ content: `❌ ${targetRaw2.toUpperCase()} is ${dist2 ?? '?'} spaces away (max 3). Try again.`, ephemeral: true }).catch(discordCatch); return; }
      await interaction.deferReply({ ephemeral: true }).catch(discordCatch);
      const oldCoord2 = String(krykna2.coord).toUpperCase();
      krykna2.coord = targetRaw2;
      game2.kryknaPushedIds = game2.kryknaPushedIds || [];
      game2.kryknaPushedIds.push(kryknaId2);
      game2.pendingKryknaPushQueue.shift();
      const pnActor2 = game2.player1Id === interaction.user.id ? 1 : 2;
      await logGameAction(game2, client, `🕷️ **Krykna Push:** P${pnActor2} pushed ${kryknaId2} from **${oldCoord2}** → **${targetRaw2.toUpperCase()}** (${dist2} space${dist2 !== 1 ? 's' : ''}).`, { phase: 'ROUND', icon: 'move' });
      await interaction.editReply({ content: `${kryknaId2} pushed: ${oldCoord2} → ${targetRaw2.toUpperCase()} ✓` }).catch(discordCatch);
      const generalCh2 = await client.channels.fetch(game2.generalId).catch(() => null);
      if (game2.pendingKryknaPushQueue.length > 0) {
        // More pushes needed — post next player's buttons
        if (generalCh2) await postKryknaPushButtons(game2, generalCh2, gameId2);
      } else {
        // All pushes done — run damage phase
        game2.kryknaPushedIds = null;
        const mapId2 = game2.selectedMap?.id;
        const { logs: kryknaLogs2, damageEvents: kryknaEvt2 } = runNpcKryknaActivation(game2, mapId2, { getMapTokensData, getMapData, getMapRegistry, filterMapSpacesByBounds });
        for (const line of kryknaLogs2) {
          if (generalCh2) await logGameAction(game2, client, `🕷️ **Krykna:** ${line}`, { phase: 'ROUND', icon: 'attack' });
        }
        for (const { figureKey, playerNum: pnDmg, damage } of kryknaEvt2) {
          await applyNpcDamageToFigure(game2, pnDmg, figureKey, damage, 'Krykna', logGameAction, client, dcHealthState, dcMessageMeta);
        }
        if (kryknaEvt2.length > 0) await checkWinConditions(game2, client);
      }
      saveGames();
    } else if (modalKey === 'dc_rename_modal_') {
      const renameMsgId = interaction.customId.replace('dc_rename_modal_', '');
      const renameMeta = dcMessageMeta.get(renameMsgId);
      if (!renameMeta) { await interaction.reply({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
      const renameGame = getGame(renameMeta.gameId);
      if (!renameGame) { await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(discordCatch); return; }
      const renameStats = getDcStats(renameMeta.dcName);
      const renameFigures = renameStats?.figures ?? 1;
      const renameDgMatch = (renameMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const renameDgIndex = renameDgMatch ? renameDgMatch[1] : '1';
      renameGame.figureNicknames = renameGame.figureNicknames || {};
      const renameCount = Math.min(renameFigures, 5);
      for (let ri = 0; ri < renameCount; ri++) {
        const val = interaction.fields.getTextInputValue(`fig_${ri}`).trim();
        const figKey = `${renameMeta.dcName}-${renameDgIndex}-${ri}`;
        if (val) renameGame.figureNicknames[figKey] = val;
        else delete renameGame.figureNicknames[figKey];
      }
      // Refresh the DC embed to show nicknames
      try {
        const renameChId = renameMeta.playerNum === 1 ? renameGame.p1PlayAreaId : renameGame.p2PlayAreaId;
        const renameCh = await client.channels.fetch(renameChId);
        const renameMsg = await renameCh.messages.fetch(renameMsgId);
        const renameExhausted = dcExhaustedState.get(renameMsgId) ?? false;
        const renameHs = dcHealthState.get(renameMsgId) || [];
        const { embed: renameEmbed, files: renameFiles } = await buildDcEmbedAndFiles(
          renameMeta.dcName, renameExhausted, renameMeta.displayName, renameHs,
          getConditionsForDcMessage(renameGame, renameMeta),
          getDcUpgradeAttachments(renameGame, renameMsgId),
          getTokensForDcMessage(renameGame, renameMeta),
          null,
          getNicknamesForDcMessage(renameGame, renameMeta),
        );
        const renameComponents = getDcPlayAreaComponents(renameMsgId, renameExhausted, renameGame, renameMeta.dcName);
        await renameMsg.edit({ embeds: [renameEmbed], files: renameFiles, components: renameComponents });
      } catch (err) {
        console.error('Failed to refresh DC embed after rename:', err);
      }
      await interaction.reply({ content: 'Figures renamed!', ephemeral: true }).catch(discordCatch);
      saveGames();
    } else if (modalKey === 'fav_name_modal_' || modalKey === 'fav_rename_modal_' || modalKey === 'fav_list_rename_modal_') {
      const favGroup = modalKey === 'fav_list_rename_modal_' ? 'favList' : 'favorites';
      const favCtx = buildContext(favGroup, buildAllDeps());
      if (modalKey === 'fav_name_modal_') await handleFavNameModal(interaction, favCtx);
      else if (modalKey === 'fav_rename_modal_') await handleFavRenameModal(interaction, favCtx);
      else await handleFavListRenameModal(interaction, favCtx);
    }
    }); // end withAtomicGameLock (modal)
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const selectKey = getHandlerKey(interaction.customId, 'select');
    if (!selectKey) return;
    const _selectLockId = resolveGameIdForLock(interaction);
    await withAtomicGameLock(_selectLockId, atomicOpts, async () => {
    if (selectKey === 'dc_fig_select_') {
      const msgId = interaction.customId.replace('dc_fig_select_', '');
      const selectedFigure = parseInt(interaction.values[0], 10);
      const meta = dcMessageMeta.get(msgId);
      if (!meta) { await interaction.reply({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
      const game = getGame(meta.gameId);
      if (!game) { await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(discordCatch); return; }
      if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the owner can pick a figure.', { useReply: true })) return;
      await interaction.deferUpdate().catch(discordCatch);
      game.dcActionsData = game.dcActionsData || {};
      game.dcActionsData[msgId] = game.dcActionsData[msgId] || {};
      game.dcActionsData[msgId].selectedFigure = selectedFigure;
      saveGames();
      await updateDcActionsMessage(game, msgId, interaction.client);
      return;
    }
    // Space-select overflow adapters: rewrite customId as if it were a button click, then
    // dispatch through the same table-driven system used for buttons (getHandler + buildContext).
    const SPACE_SEL_MAP = {
      'overwatch_space_sel_': 'overwatch_space_',
      'pounce_space_sel_': 'pounce_space_',
      'false_orders_space_sel_': 'false_orders_space_',
      'rush_push_space_sel_': 'rush_push_space_',
      'shoulder_rush_space_sel_': 'shoulder_rush_space_',
      'bomb_drop_space_sel_': 'bomb_drop_space_',
      'cc_space_sel_': 'cc_space_',
    };
    if (SPACE_SEL_MAP[selectKey]) {
      const space = interaction.values?.[0];
      if (!space) return;
      const suffix = interaction.customId.slice(selectKey.length);
      interaction.customId = `${SPACE_SEL_MAP[selectKey]}${suffix}_${space}`;
      await interaction.deferUpdate().catch(discordCatch);
      const fakeButtonKey = SPACE_SEL_MAP[selectKey];
      const _selHandler = getHandler(fakeButtonKey);
      if (_selHandler) {
        // Event log: capture before snapshot
        const _evtGameId = _selectLockId;
        const _evtBefore = _evtGameId ? captureSnapshot(getGame(_evtGameId)) : null;

        const _selGroup = getHandlerGroup(fakeButtonKey);
        const _selCtx = _selGroup ? buildContext(_selGroup, buildAllDeps()) : {};
        await _selHandler(interaction, _selCtx);

        // Event log: capture after snapshot and record diff
        if (_evtBefore && _evtGameId) {
          const _evtAfter = captureSnapshot(getGame(_evtGameId));
          const _evtDiff = computeDiff(_evtBefore, _evtAfter);
          if (_evtDiff) {
            const _evt = createEvent(_evtGameId, fakeButtonKey, interaction.customId, interaction.user.id, _evtDiff);
            appendToBuffer(_evt);
            // Domain events (dual-write)
            const _domainEvents = translateDiffToEvents(fakeButtonKey, _evtDiff, {
              gameId: _evtGameId, playerId: interaction.user.id, before: _evtBefore, after: _evtAfter,
            });
            if (_domainEvents.length > 0) {
              appendDomainEvents(_evtGameId, _domainEvents).catch(e => console.error('[domain-events]', e));
            }
          }
        }

        // AI hook (modal): after a human action, check if the AI should respond
        if (_evtGameId) {
          const _aiGame = getGame(_evtGameId);
          if (_aiGame && !_aiGame.ended && _aiGame.aiPlayerNum && !_aiGame.selfPlay) {
            const _aiUserId = interaction.user.id;
            if (!_aiUserId.startsWith(AI_USER_PREFIX)) {
              setTimeout(async () => {
                try {
                  await runAiTurnLive(_aiGame, client, buildAllDeps, getGame, {
                    maxSteps: 50,
                    delayMs: 1500,
                    deps: { dcMessageMeta, dcExhaustedState },
                    atomicOpts,
                  });
                } catch (err) {
                  console.error('[AI hook modal] Error:', err.message);
                }
              }, 1000);
            }
          }
        }
      }
      return;
    }

    // Table-driven select dispatch: catches all registered select handlers
    const _selHandler = getHandler(selectKey);
    if (_selHandler) {
      // Event log: capture before snapshot
      const _evtGameId = _selectLockId;
      const _evtBefore = _evtGameId ? captureSnapshot(getGame(_evtGameId)) : null;

      const _selGroup = getHandlerGroup(selectKey);
      const _selCtx = _selGroup ? buildContext(_selGroup, buildAllDeps()) : {};
      await _selHandler(interaction, _selCtx);

      // Event log: capture after snapshot and record diff
      if (_evtBefore && _evtGameId) {
        const _evtAfter = captureSnapshot(getGame(_evtGameId));
        const _evtDiff = computeDiff(_evtBefore, _evtAfter);
        if (_evtDiff) {
          const _evt = createEvent(_evtGameId, selectKey, interaction.customId, interaction.user.id, _evtDiff);
          appendToBuffer(_evt);
          // Domain events (dual-write)
          const _domainEvents = translateDiffToEvents(selectKey, _evtDiff, {
            gameId: _evtGameId, playerId: interaction.user.id, before: _evtBefore, after: _evtAfter,
          });
          if (_domainEvents.length > 0) {
            appendDomainEvents(_evtGameId, _domainEvents).catch(e => console.error('[domain-events]', e));
          }
        }
      }

      // AI hook (select menu): after a human action, check if the AI should respond
      if (_evtGameId) {
        const _aiGame = getGame(_evtGameId);
        if (_aiGame && !_aiGame.ended && _aiGame.aiPlayerNum && !_aiGame.selfPlay) {
          const _aiUserId = interaction.user.id;
          if (!_aiUserId.startsWith(AI_USER_PREFIX)) {
            setTimeout(async () => {
              try {
                await runAiTurnLive(_aiGame, client, buildAllDeps, getGame, {
                  maxSteps: 50,
                  delayMs: 1500,
                  deps: { dcMessageMeta, dcExhaustedState },
                  atomicOpts,
                });
              } catch (err) {
                console.error('[AI hook select] Error:', err.message);
              }
            }, 1000);
          }
        }
      }
      return;
    }
    }); // end withAtomicGameLock (select)
    return;
  }

  if (!interaction.isButton()) return;
  const buttonKey = getHandlerKey(interaction.customId, 'button');
  if (!buttonKey) {
    console.warn('[dispatch] No handler key for button customId:', interaction.customId);
    return;
  }
  // Don't deferUpdate for handlers that need to show a modal (modal requires unacknowledged interaction)
  const MODAL_PREFIXES = ['devaron_crate_push_', 'krykna_push_', 'fav_save_', 'fav_rename_', 'fav_list_rename_', 'fav_choose_'];
  if (!MODAL_PREFIXES.includes(buttonKey)) {
    await interaction.deferUpdate().catch(discordCatch);
  }

  const _buttonLockId = resolveGameIdForLock(interaction);
  await withAtomicGameLock(_buttonLockId, atomicOpts, async () => {

    // ── Command-mode dispatch (event sourcing pipeline) ───────────────
    // Handlers in this set run through the command→event→reducer pipeline
    // BEFORE falling through to the existing handler for Discord output.
    const COMMAND_MODE_HANDLERS = new Set([
      // Phase gates
      'phase_gate_ready_',
      'phase_gate_unready_',
      // Round transitions
      'end_end_of_round_',
      'end_start_of_round_',
      'status_phase_',
      // Activation
      'dc_activate_',
      'end_turn_',
      'dc_end_activation_',
      'pass_activation_turn_',
      'confirm_activate_',
      'cancel_activate_',
      // Movement
      'move_mp_',
      'move_pick_',
      'move_adjust_mp_',
      // Combat core
      'attack_target_',
      'combat_ready_',
      'combat_roll_',
      'combat_surge_',
      'combat_reroll_',
      'combat_resolve_ready_',
      'combat_passive_',
      'combat_token_',
      // Combat reactions
      'cleave_target_',
      // Hand/CC operations
      'cc_play_',
      'cc_confirm_play_',
      'cc_cancel_play_',
      'cc_draw_',
      'cc_shuffle_draw_',
      'cc_discard_',
      'cc_discard_select_',
      'cc_search_discard_',
      'cc_close_discard_',
      'cc_play_select_',
      'cc_choice_',
      'cc_attach_to_',
      'cc_space_',
      'negation_play_',
      'negation_let_resolve_',
      'dc_cc_special_',
      'dc_cc_double_',
      'dc_cc_eoa_',
      'dc_cc_defender_',
      'bm_draw_',
      'bm_discard_',
      'bm_return_',
      'bm_skip_',
      'deck_illegal_play_',
      'deck_illegal_redo_',
      'illegal_cc_ignore_',
      'illegal_cc_unplay_',
      // Setup operations
      'map_selection_',
      'map_type_',
      'map_confirm_',
      'map_goback_',
      'map_selection_draw_',
      'map_selection_pick_',
      'determine_initiative_',
      'deployment_zone_red_',
      'deployment_zone_blue_',
      'deploy_pick_',
      'deploy_row_',
      'deploy_row_back_',
      'deployment_fig_',
      'deployment_orient_',
      'deployment_done_',
      'auto_deploy_',
      'squad_select_',
      'squad_confirm_',
      'squad_cancel_',
      'form_pick_',
      'loadout_select_',
      'loadout_confirm_',
      // DC play area
      'dc_attack_',
      'dc_move_',
      'dc_interact_',
      'dc_special_',
      'dc_toggle_',
      'dc_deplete_',
      'dc_unactivate_',
      'dc_ability_choice_',
      'dc_rename_',
      'special_done_',
      'interact_choice_',
      'interact_cancel_',
      'fast_forward_',
    ]);

    const COMMAND_HANDLER_MAP = {
      'PhaseGateReady': handlePhaseGateReady,
      'PhaseGateUnready': handlePhaseGateUnready,
      'ActivateDc': cmdActivateDc,
      'EndTurn': cmdEndTurn,
      'PassActivationTurn': cmdPassTurn,
      'DeclareAttack': cmdDeclareAttack,
      'AttackTarget': cmdDeclareAttack,
      'ReadyForCombat': cmdReadyForCombat,
      'RollCombatDice': cmdRollDice,
      'SpendSurge': cmdSpendSurge,
      'PerformReroll': cmdPerformReroll,
      'StartMovement': cmdStartMovement,
      'MoveToSpace': cmdMoveToSpace,
      'CompleteMovement': cmdCompleteMovement,
      'EndEndOfRound': cmdEndRound,
      'EndStartOfRound': cmdStartRound,
      'StatusPhase': cmdActivationPhaseStart,
      // Combat reactions
      'ResolveCombat': cmdResolveCombat,
      'CombatResolveReady': cmdResolveCombat,
      'CancelCombat': cmdCancelCombat,
      'CombatPassive': cmdCombatPassive,
      'CombatToken': cmdCombatToken,
      'CleaveTarget': cmdCleaveTarget,
      // Hand/CC
      'PlayCommandCard': cmdPlayCard,
      'DiscardCommandCard': cmdDiscardCard,
      'DrawCommandCards': cmdDrawCards,
      'NegationAttempt': cmdNegationAttempt,
      'NegationResolve': cmdNegationResolve,
      // Setup
      'SelectMap': cmdSelectMap,
      'ConfirmMap': cmdConfirmMap,
      'DetermineInitiative': cmdDetermineInitiative,
      'ChooseDeploymentZone': cmdChooseZone,
      'DeployFigure': cmdDeployFigure,
      'FinishDeployment': cmdFinishDeployment,
      'SubmitSquad': cmdSubmitSquad,
      // DC play area
      'PerformAction': cmdPerformAction,
      'DcEndActivation': cmdDcEndActivation,
    };

    // Periodic event verification (env VERIFY_INTERVAL, default 0 = disabled)
    const _verifyInterval = parseInt(process.env.VERIFY_INTERVAL, 10) || 0;

    let _cmdEmittedTypes = null;
    if (COMMAND_MODE_HANDLERS.has(buttonKey)) {
      const _cmdGameId = _buttonLockId;
      const _cmdState = _cmdGameId ? getGame(_cmdGameId) : null;
      const _cmd = customIdToCommand(interaction.customId, buttonKey, interaction.user.id, _cmdGameId);
      if (_cmd && _cmdState) {
        const _cmdHandler = COMMAND_HANDLER_MAP[_cmd.type];
        if (_cmdHandler) {
          const { events: _cmdEvents, error: _cmdError } = _cmdHandler(_cmdState, _cmd);
          if (!_cmdError && _cmdEvents.length > 0) {
            appendDomainEvents(_cmdGameId, _cmdEvents).catch(e => console.error('[command-mode]', e));
            _cmdEmittedTypes = _cmdEvents.map(e => e.type);
          }
          if (_cmdError) {
            console.warn('[command-mode] Command error:', _cmdError, 'for', buttonKey);
          }
        }
        // No handler = command recorded but no direct events emitted
        // (diff-translator will still capture state changes downstream)
      }
      // Fall through to existing handler for Discord output
    }

    // Catch-all: record unhandled button presses as GenericInteraction events
    if (!COMMAND_MODE_HANDLERS.has(buttonKey) && _buttonLockId) {
      try {
        const _genericEvent = createDomainEvent(
          'GenericInteraction', _buttonLockId, interaction.user.id,
          { prefix: buttonKey, customId: interaction.customId }
        );
        appendDomainEvents(_buttonLockId, [_genericEvent]).catch(e => console.error('[domain-events] generic:', e));
      } catch (_e) { /* never block */ }
    }

    // Periodic shadow comparison (env VERIFY_INTERVAL, default 0 = disabled)
    if (_verifyInterval > 0 && _buttonLockId) {
      _verifyCounter++;
      if (_verifyCounter % _verifyInterval === 0) {
        try {
          const { shadowCompare } = await import('./src/domain/event-verifier.js');
          const _verifyState = getGame(_buttonLockId);
          if (_verifyState) {
            shadowCompare(_buttonLockId, _verifyState).then(result => {
              if (!result.match) {
                console.warn(`[shadow] Mismatch in game ${_buttonLockId} (${result.eventCount} events): ${result.mismatches.join(', ')}`);
              }
            }).catch(() => {});
          }
        } catch (_verifyErr) {
          // Never block gameplay
        }
      }
    }

    // ── Table-driven dispatch ─────────────────────────────────────────
    const allDeps = buildAllDeps();

    // Look up handler and context group from the dispatch table
    const _handler = getHandler(buttonKey);
    if (_handler) {
      // Event log: capture before snapshot
      const _evtGameId = _buttonLockId;
      const _evtBefore = _evtGameId ? captureSnapshot(getGame(_evtGameId)) : null;

      const _group = getHandlerGroup(buttonKey);
      if (_group) {
        const _ctx = buildContext(_group, allDeps);
        await _handler(interaction, _ctx);
      } else {
        await _handler(interaction);
      }

      // PvP thread refresh: edit both pinned messages to reflect new state
      if (_evtGameId) {
        const _pvpGame = getGame(_evtGameId);
        if (_pvpGame?.pvpThreadId) {
          try {
            await updateGameView(_pvpGame, client, { dcMessageMeta, dcExhaustedState });
          } catch (_pvpErr) {
            console.error('[pvp-thread] Post-handler updateGameView failed:', _pvpErr?.message ?? _pvpErr);
          }
        }
      }

      // Event log: capture after snapshot and record diff
      if (_evtBefore && _evtGameId) {
        const _evtAfter = captureSnapshot(getGame(_evtGameId));
        const _evtDiff = computeDiff(_evtBefore, _evtAfter);
        if (_evtDiff) {
          const _evt = createEvent(_evtGameId, buttonKey, interaction.customId, interaction.user.id, _evtDiff);
          appendToBuffer(_evt);
          // Domain events (dual-write)
          const _domainEvents = translateDiffToEvents(buttonKey, _evtDiff, {
            gameId: _evtGameId, playerId: interaction.user.id, before: _evtBefore, after: _evtAfter,
          }, _cmdEmittedTypes);
          if (_domainEvents.length > 0) {
            appendDomainEvents(_evtGameId, _domainEvents).catch(e => console.error('[domain-events]', e));
          }
        }
      }

      // AI hook: after a human action, check if the AI should respond
      if (_evtGameId) {
        const _aiGame = getGame(_evtGameId);
        if (_aiGame && !_aiGame.ended && _aiGame.aiPlayerNum && !_aiGame.selfPlay) {
          // Don't block the handler — run AI asynchronously
          const _aiUserId = interaction.user.id;
          if (!_aiUserId.startsWith(AI_USER_PREFIX)) {
            setTimeout(async () => {
              try {
                await runAiTurnLive(_aiGame, client, buildAllDeps, getGame, {
                  maxSteps: 50,
                  delayMs: 1500,
                  deps: { dcMessageMeta, dcExhaustedState },
                  atomicOpts,
                });
              } catch (err) {
                console.error('[AI hook] Error:', err.message);
              }
            }, 1000);
          }
        }
      }

      return;
    }
    console.warn('[dispatch] No registered handler for buttonKey:', buttonKey, 'customId:', interaction.customId);

    // ── Local handlers (non-combat closures over index.js scope) ──
    const LOCAL_HANDLERS = {
      'create_game': async (i) => {
        await i.followUp({ content: 'Go to **#new-games** and click **Create Post** to start a lobby. The bot will add the Join Game button.', components: [getMainMenu()], ephemeral: true }).catch(discordCatch);
      },
      'join_game': async (i) => {
        await i.followUp({ content: 'Browse **#new-games** and click **Join Game** on a lobby post that needs an opponent.', components: [getMainMenu()], ephemeral: true }).catch(discordCatch);
      },
      'bothelper_jump_': async (i) => {
        const gameId = i.customId.replace('bothelper_jump_', '');
        const game = getGame(gameId);
        if (!game) {
          await i.followUp({ content: 'Game not found.', ephemeral: true }).catch(discordCatch);
          return;
        }
        const helperId = i.user.id;
        if (helperId === game.player1Id || helperId === game.player2Id) {
          await i.followUp({ content: 'You are already a player in this game.', ephemeral: true }).catch(discordCatch);
          return;
        }
        const guild = i.guild;
        if (!guild) return;
        // Grant read access to all game channels via category + individual channels
        const channelIds = [game.gameCategoryId, game.generalId, game.chatId, game.boardId, game.p1PlayAreaId, game.p2PlayAreaId].filter(Boolean);
        for (const chId of channelIds) {
          try {
            const ch = await guild.channels.fetch(chId);
            if (ch) {
              await ch.permissionOverwrites.create(helperId, {
                ViewChannel: true,
                SendMessagesInThreads: true,
              });
            }
          } catch (err) {
            console.error(`Bothelper permission error for channel ${chId}:`, err);
          }
        }
        // Add to hand threads (private threads need explicit member add)
        for (const threadId of [game.p1HandId, game.p2HandId].filter(Boolean)) {
          try {
            const thread = await client.channels.fetch(threadId);
            if (thread?.isThread()) await thread.members.add(helperId).catch(discordCatch);
          } catch (err) {
            console.error(`Bothelper thread add error for ${threadId}:`, err);
          }
        }
        // Track helpers on the game object
        if (!game.bothelpers) game.bothelpers = [];
        if (!game.bothelpers.includes(helperId)) {
          game.bothelpers.push(helperId);
          saveGames();
        }
        // Update the bothelpers channel message to show who jumped in
        const existingContent = i.message.content;
        const helperMention = `<@${helperId}>`;
        const updatedContent = existingContent + `\n${helperMention} has jumped in to assist!`;
        await i.message.edit({ content: updatedContent, components: i.message.components }).catch(discordCatch);
        await i.followUp({ content: `You now have access to **IA Game #${gameId}**. Head to the game channels to help out!`, ephemeral: true }).catch(discordCatch);
        // Notify the game log
        try {
          const generalCh = await client.channels.fetch(game.generalId);
          if (generalCh) {
            await generalCh.send(sanitizeMentions({ content: `🛟 <@${helperId}> has joined as a **Bothelper** to assist with this game.`, allowedMentions: { users: [helperId] } })).catch(discordCatch);
          }
        } catch (err) {
          console.error('Bothelper game log notification error:', err);
        }
      },
      'botlog_resolve_': async (i) => {
        // Resolve incident in Postgres (source of truth)
        const incidentId = i.customId.replace('botlog_resolve_', '');
        if (incidentId) {
          resolveIncident(incidentId, i.user.id).catch(discordCatch);
        }
        // If the message is in an error thread, delete the thread and its header message
        const ch = i.message.channel;
        if (ch?.isThread()) {
          const parentChannel = ch.parent;
          // For message-based threads, the starter message ID equals the thread ID
          const starterMsgId = ch.id;
          await ch.delete().catch(discordCatch);
          // Delete the header message in bot-logs that the thread was created from
          if (parentChannel) {
            try {
              const headerMsg = await parentChannel.messages.fetch(starterMsgId).catch(() => null);
              if (headerMsg) await headerMsg.delete();
            } catch {}
          }
          return;
        }
        // Otherwise collapse the error message to a resolved one-liner
        const original = i.message.content;
        const firstLine = original.split('\n')[0] || '';
        const resolved = firstLine.replace('⚠️ **Game Error**', '✅ ~~Game Error~~ **Resolved**');
        await i.message.edit({
          content: `${resolved}\n-# Resolved by <@${i.user.id}> at <t:${Math.floor(Date.now() / 1000)}:t>`,
          components: [],
          allowedMentions: { users: [] },
        }).catch(discordCatch);
      },
      'bothelper_resolve_': async (i) => {
        const remainder = i.customId.replace('bothelper_resolve_', '');
        const sepIdx = remainder.indexOf('_');
        const gameId = sepIdx >= 0 ? remainder.slice(0, sepIdx) : remainder;
        const game = getGame(gameId);
        if (!game) {
          await i.followUp({ content: 'Game not found.', ephemeral: true }).catch(discordCatch);
          return;
        }
        const helperId = i.user.id;
        // Only bothelpers who jumped in (or players) can resolve
        const isHelper = game.bothelpers?.includes(helperId);
        const isPlayer = helperId === game.player1Id || helperId === game.player2Id;
        if (!isHelper && !isPlayer) {
          await i.followUp({ content: 'Only bothelpers who jumped in or game players can resolve this request.', ephemeral: true }).catch(discordCatch);
          return;
        }
        // Mark message as resolved
        const existingContent = i.message.content;
        await i.message.edit({
          content: existingContent + `\n\n**Resolved** by <@${helperId}>`,
          components: [], // remove buttons
        }).catch(discordCatch);
        await i.followUp({ content: 'Support request resolved.', ephemeral: true }).catch(discordCatch);
      },
    };
    const localHandler = LOCAL_HANDLERS[buttonKey];
    if (localHandler) {
      await localHandler(interaction);
      return;
    }


  }); // end withAtomicGameLock (button)

  } catch (err) {
    console.error('Interaction error:', err);
    const guild = interaction?.guild;
    const gameId = extractGameIdFromInteraction(interaction);
    const messageLink = guild?.id && interaction?.channelId && interaction?.message?.id
      ? { guildId: guild.id, channelId: interaction.channelId, messageId: interaction.message.id }
      : undefined;
    // Enrich error log with game state snapshot for faster diagnosis
    let errorMetadata;
    if (gameId) {
      const _errGame = getGame(gameId);
      if (_errGame) {
        errorMetadata = {
          phase: _errGame.phase,
          roundPhase: _errGame.roundPhase,
          round: _errGame.currentRound,
          pendingState: getRecoveryReason(_errGame) || 'none',
          p1Figs: Object.keys(_errGame.figurePositions?.[1] || {}).length,
          p2Figs: Object.keys(_errGame.figurePositions?.[2] || {}).length,
          aiPlayer: _errGame.aiPlayerNum || null,
          customId: interaction?.customId || null,
        };
      }
    }
    await logGameErrorToBotLogs(interaction.client, guild, gameId, err, 'interactionCreate', { messageLink, metadata: errorMetadata });
    await replyOrFollowUpWithRetry(interaction, {
      content: 'An error occurred. It has been logged to bot-logs.',
      ephemeral: true,
    });
  } finally {
    // Auto-refresh: after every interaction, fire board map + minimap + DC embeds (fire-and-forget)
    try {
      const _refreshGameId = extractGameIdFromInteraction(interaction);
      if (_refreshGameId) {
        const _refreshGame = getGame(_refreshGameId);
        if (_refreshGame) refreshGameVisuals(_refreshGame).catch(err => console.error('[refresh]', err?.message ?? err));
      }
    } catch (_) {}
  }
});

/* ── channelDelete: clean up orphaned game records when channels are deleted outside the bot ── */

client.on('channelDelete', async (channel) => {
  if (!botReady) return;
  try {
    const channelId = channel.id;
    const gamesMap = getGamesMap();

    // Match on game channels (generalId, chatId, boardId, play-areas, hands)
    let gameId;
    let game;
    const match = findGameByChannel(gamesMap, channelId);
    if (match) {
      gameId = match.gameId;
      game = match.game;
    } else {
      // Also check gameCategoryId (not covered by findGameByChannel)
      for (const [gid, g] of gamesMap) {
        if (g.gameCategoryId === channelId) {
          gameId = gid;
          game = g;
          break;
        }
      }
    }
    if (!gameId) return;

    // Guard against re-entrancy (bot-initiated deletions via Kill Game / deleteGameChannelsAndGame)
    if (channelDeleteGuard.has(gameId)) return;
    channelDeleteGuard.add(gameId);

    console.log(`[channelDelete] External channel deletion detected for game #${gameId} (channel ${channelId}). Cleaning up.`);
    try {
      await deleteGameChannelsAndGame(game, gameId, {
        client,
        deleteGame,
        saveGames,
        dcMessageMeta,
        dcExhaustedState,
        dcHealthState,
        deleteGameFromDb,
        channelDeleteGuard,
      });
      console.log(`[channelDelete] Game #${gameId} cleanup complete.`);
    } finally {
      channelDeleteGuard.delete(gameId);
    }
  } catch (err) {
    console.error('[channelDelete] Error:', err);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});

if (process.env.BOT_STARTUP_SMOKE === '1') {
  // Dry-boot mode: all modules loaded, deps validated, no Discord connection.
  // Only exit if this is the main entrypoint (not when imported by smoke-imports.js).
  const _isMain = process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index'));
  if (_isMain) {
    console.log('[smoke] All modules loaded and startup validation passed.');
    process.exit(0);
  }
} else if (process.argv.includes('--test-movement')) {
  runMovementTests()
    .then((code) => process.exit(code || 0))
    .catch((err) => { console.error(err); process.exit(1); });
} else {
  client.login(process.env.DISCORD_TOKEN);
}
