/**
 * Headless dependency builder: provides the full allDeps bag
 * using real game logic + fake Discord primitives.
 *
 * Any dep that touches Discord (sends messages, fetches channels) is
 * replaced with a no-op or capture stub. Pure game logic is imported
 * from the real modules.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ThreadAutoArchiveDuration,
} from 'discord.js';

import { createFakeClient } from './fake-client.js';

// ── Pure game logic ─────────────────────────────────────────────────────────

import {
  validateDeckLegal, parseCoord, normalizeCoord, getFootprintCells,
  getBoardStateForMovement, getMovementProfile,
  computeMovementCache, getSpacesAtCost, getMovementTarget,
  getMovementPath, ensureMovementCache, getNormalizedFootprint,
  resolveMassivePush, rollAttackDice, rollDefenseDice,
  rollSingleAttackDie, rollSingleDefenseDie, recalcAttackTotals,
  recalcDefenseTotals, getInnateRerolls, getAttackerSurgeAbilities,
  parseSurgeEffect, SURGE_LABELS, getAbility, resolveSurgeAbility,
  getSurgeAbilityLabel, resolveAbility, getPlayableCcFromHand,
  isCcPlayableNow, isCcPlayLegalByRestriction, filterMapSpacesByBounds,
  reduceHp, healHp, awardKillVp, awardObjectiveVp, deductVp,
  getEffectiveSpeed, getLegalInteractOptions, getSpaceController,
  getFiguresOnOrAdjacentToSpace, countTerminalsControlledByPlayer,
  isFigureInDeploymentZone, filterCondition, isConditionImmune,
  HARMFUL_CONDITIONS, applyCondition,
  getRange, hasLineOfSight,
  resolveDcName, isFigurelessDc,
} from '../game/index.js';

import { removeFigurePosition } from '../game/player-helpers.js';

// ── Data loaders ────────────────────────────────────────────────────────────

import {
  getDcEffects, getDiceData, getCcEffect, isCcAttachment, isDcAttachment,
  isDcUnique, getMapSpaces, getMapRegistry, getMapTokensData,
  getTournamentRotation, getMissionCardsData, getMissionRules,
  getDeploymentZones, getDcStats, getFigureSize,
} from '../data-loader.js';

// ── Discord UI (imported, real functions — they build embeds/components, not send) ──

import {
  getInitiativePlayerZoneLabel, PHASE_COLOR, GAME_PHASES, ACTION_ICONS,
  logGameAction as _logGameAction,
  getHandTooltipEmbed, getHandSquadButtons, getMapSelectionTooltipEmbed,
  getMoveMpButtonRows, getMoveSpaceGridRows, buildLetterRows,
  getSpaceChoiceRows, buildSpaceSelectMenu, getActionsCounterContent,
  DC_ACTIONS_PER_ACTIVATION, FIGURE_LETTERS,
  getGeneralSetupButtons, getMapTypeButtons, getMapConfirmButton,
  getMissionSelectDrawMenu, getMissionSelectionPickMenu,
  getDeploymentZoneButtons, getCcShuffleDrawButton,
  getIllegalCcPlayButtons, getNegationResponseButtons, getCelebrationButtons,
  getLobbyEmbed, getLobbyStartButton, updateThreadName,
  getDeploySpaceGridRows, buildDeployRowButtons,
  getDcActionButtons as getDcActionButtonsFromDiscord,
  getActivateDcButtons as getActivateDcButtonsFromDiscord,
  updateActivationsMessage,
} from '../discord/index.js';

// ── Game logic helpers ──────────────────────────────────────────────────────

import {
  getPlayableCcSpecialsForDc,
  getPlayableCcEndOfActivationForDc,
  getPlayableCcDoubleActionsForDc,
} from '../game/cc-timing.js';

import {
  runEndOfRoundRules, runStartOfRoundRules,
  runNpcThugActivation, runNpcKryknaActivation,
} from '../game/mission-rules.js';

import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { MAX_ACTIVE_GAMES_PER_PLAYER, PENDING_ILLEGAL_TTL_MS } from '../constants.js';
import { getCommandCardImagePath, getConditionCardPath } from '../asset-paths.js';

// ── Extracted engine modules ────────────────────────────────────────────────

import { shuffleArray, filterValidTopLeftSpaces } from '../engine/utils.js';
import {
  getMissionTokenLabel, calculateKillVp,
} from '../engine/mission-helpers.js';
import {
  hasActionsRemainingInGame as _hasActionsRemainingInGameRaw,
  shouldShowEndActivationPhaseButton as _shouldShowEndActivationPhaseButtonRaw,
  isGroupDefeated as _isGroupDefeatedRaw,
  isDepletedRemovedFromGame as _isDepletedRemovedFromGameRaw,
  findDcMessageIdForFigure as _findDcMessageIdForFigureRaw,
  getFigureLabel as _getFigureLabelRaw,
  getPlayerZoneLabel as _getPlayerZoneLabelRaw,
  countActiveGamesForPlayer as _countActiveGamesForPlayerRaw,
} from '../engine/game-readers.js';
import {
  getDcUpgradeAttachments, getConditionsForDcMessage, getNicknamesForDcMessage,
} from '../engine/dc-ui-helpers.js';
import { getPlayReadyMaps } from '../engine/board-ui-helpers.js';

// ── Rendering stubs ─────────────────────────────────────────────────────────

import {
  buildDcEmbedAndFiles,
  buildDiscardPileDisplayPayload,
  buildHandDisplayPayload as buildHandDisplayPayloadFromRendering,
  getActivationMinimapAttachment,
  getMovementMinimapAttachment,
  getDeploymentMapAttachment,
} from '../rendering.js';

// ── Handler-level re-exports ────────────────────────────────────────────────

import {
  runStartOfRoundDcEffects,
  runPostDeployPhase,
  sendRerollUI,
  proceedAfterRerolls,
  sendReadyToResolveRolls,
} from '../handlers/index.js';

import { sendPhaseGateMessages } from '../handlers/phase-gate.js';

/**
 * Build the complete headless deps bag.
 *
 * @param {object} options
 * @param {Map} options.gamesMap — in-memory game storage
 * @param {object} [options.client] — fake client (auto-created if omitted)
 * @returns {object} allDeps — satisfies every key in getAllRequiredDepKeys()
 */
export function buildHeadlessDeps(options = {}) {
  const gamesMap = options.gamesMap || new Map();
  const client = options.client || createFakeClient();

  // In-memory state maps
  const dcMessageMeta = options.dcMessageMeta || new Map();
  const dcExhaustedState = options.dcExhaustedState || new Map();
  const dcHealthState = options.dcHealthState || new Map();
  const pendingIllegalSquad = options.pendingIllegalSquad || new Map();
  const pendingSquadConfirm = options.pendingSquadConfirm || new Map();

  // Core state accessors
  const getGame = (id) => gamesMap.get(id) || null;
  const setGame = (id, game) => { gamesMap.set(id, game); };
  const saveGames = () => {}; // no-op in headless
  const deleteGame = (id) => { gamesMap.delete(id); };
  const deleteGameFromDb = async () => {};

  // Action log capture
  const actionLog = [];
  const logGameAction = async (game, clientArg, msg, opts) => {
    actionLog.push({ gameId: game?.gameId, msg, opts });
  };
  const logGameErrorToBotLogs = async () => {};

  // UI functions that send Discord messages → no-op stubs
  const noopAsync = async () => {};
  const noopSync = () => {};
  const noopReturnsNull = () => null;
  const noopReturnsEmptyArr = () => [];
  const noopReturnsEmptyObj = () => ({});

  // Locally-defined wrappers that need state closures
  const replyIfGameEnded = async (game, interaction) => {
    if (game?.ended) return true;
    return false;
  };

  const pushUndo = (game) => {
    if (!game) return;
    game.undoStack = game.undoStack || [];
    game.undoStack.push(JSON.parse(JSON.stringify(game)));
    if (game.undoStack.length > 5) game.undoStack.shift();
  };

  const extractGameIdFromInteraction = (interaction) => {
    if (!interaction?.customId) return null;
    const match = interaction.customId.match(/(\d{5})/);
    return match ? match[1] : null;
  };

  // Build board map payload — stub that returns empty payload
  const buildBoardMapPayload = async () => ({ content: '[headless: board map]', files: [] });

  // Update messages — all no-ops in headless
  const updateAttachmentMessageForDc = noopAsync;
  const updateMovementBankMessage = noopAsync;
  const ensureMovementBankMessage = noopAsync;
  const updateDcActionsMessage = noopAsync;
  const updateHandChannelMessages = noopAsync;
  const updateHandVisualMessage = noopAsync;
  const updateDiscardPileMessage = noopAsync;
  const updatePlayAreaDcButtons = noopAsync;
  const clearMoveGridMessages = noopAsync;
  const maybeShowEndActivationPhaseButton = noopAsync;
  const refreshAllGameComponents = noopAsync;
  const sendRoundActivationPhaseMessage = noopAsync;
  const sendBleedingPrompt = noopAsync;
  const sendDeckIllegalAlert = noopAsync;
  const sendSquadConfirmation = noopAsync;
  const postDevaronDoorButtons = noopAsync;
  const postDevaronCratePushPrompts = noopAsync;
  const postKryknaPushButtons = noopAsync;
  const updateDeployPromptMessages = noopAsync;

  // Setup/creation stubs
  const createPlayAreaChannels = noopAsync;
  const createBoardChannel = noopAsync;
  const createHandThreads = noopAsync;
  const createGameChannels = noopAsync;
  const applySquadSubmission = noopAsync;
  const finishSetupAttachments = noopAsync;
  const runDraftRandom = noopAsync;
  const clearPreGameSetup = noopAsync;

  // Rendering helpers that return embeds/components (stubs)
  const buildHandDisplayPayload = () => ({ embeds: [], components: [], files: [] });
  const getMapAttachmentForSpaces = async () => ({ files: [], embed: null });
  const getDcPlayAreaComponents = () => [];
  const getDcActionButtons = () => [];
  const getActivateDcButtons = () => [];

  // Game-logic wrappers that need deps injection
  const checkWinConditions = async () => false;
  const resolveCombatAfterRolls = noopAsync;
  const applyDamageAndFinishCombat = noopAsync;
  const finishCombatResolution = noopAsync;
  const checkPostCombatSurges = noopAsync;
  const applyDirectDamageToFigure = noopAsync;
  const applyNpcDamageToFigure = noopAsync;
  const decrementActivationIfGroupDefeated = noopSync;

  // Mission helpers
  const postMissionCardAfterMapSelection = noopAsync;
  const postPinnedMissionCardFromGameState = noopAsync;

  // Deployment helpers
  const getDeployFigureLabels = () => [];
  const getDeployButtonRows = () => [];
  const getDeploymentMapAttachmentStub = async () => ({ files: [] });

  return {
    // Core state
    getGame, setGame, saveGames, deleteGame, deleteGameFromDb,
    dcMessageMeta, dcExhaustedState, dcHealthState,
    pendingIllegalSquad, pendingSquadConfirm,
    client,

    // Auth & utility
    canActAsPlayer, extractGameIdFromInteraction, logGameErrorToBotLogs,
    replyIfGameEnded, pushUndo,

    // Constants
    PENDING_ILLEGAL_TTL_MS, MAX_ACTIVE_GAMES_PER_PLAYER,
    DC_ACTIONS_PER_ACTIVATION, GAME_PHASES, PHASE_COLOR, ACTION_ICONS,
    SURGE_LABELS, FIGURE_LETTERS, ThreadAutoArchiveDuration,
    DEFAULT_DECK_REBELS: [], DEFAULT_DECK_SCUM: [], DEFAULT_DECK_IMPERIAL: [],

    // Discord.js builders
    ButtonBuilder, ActionRowBuilder, ButtonStyle, EmbedBuilder,

    // Game logic (real implementations)
    validateDeckLegal, parseCoord, normalizeCoord, getFootprintCells,
    getBoardStateForMovement, getMovementProfile,
    computeMovementCache, getSpacesAtCost, getMovementTarget,
    getMovementPath, ensureMovementCache, getNormalizedFootprint,
    resolveMassivePush, rollAttackDice, rollDefenseDice,
    rollSingleAttackDie, rollSingleDefenseDie, recalcAttackTotals,
    recalcDefenseTotals, getInnateRerolls, getAttackerSurgeAbilities,
    parseSurgeEffect, getAbility, resolveSurgeAbility, getSurgeAbilityLabel,
    resolveAbility, getPlayableCcFromHand, isCcPlayableNow,
    isCcPlayLegalByRestriction, filterMapSpacesByBounds,
    reduceHp, healHp, awardKillVp, awardObjectiveVp, deductVp, removeFigurePosition,

    // Data loaders (real implementations)
    getDcEffects, getDiceData, getCcEffect, isCcAttachment, isDcAttachment,
    isDcUnique, getMapSpaces, getMapRegistry, getMapTokensData,
    getTournamentRotation, getMissionCardsData, getMissionRules,
    resolveDcName, isFigurelessDc, getFigureSize,

    // Discord UI (real functions that build data structures)
    logGameAction,
    getInitiativePlayerZoneLabel,
    getHandTooltipEmbed, getHandSquadButtons, getMapSelectionTooltipEmbed,
    getMoveMpButtonRows, getMoveSpaceGridRows, buildLetterRows,
    getSpaceChoiceRows, buildSpaceSelectMenu, getActionsCounterContent,
    updateActivationsMessage, getGeneralSetupButtons, getMapTypeButtons,
    getMapConfirmButton, getMissionSelectDrawMenu, getMissionSelectionPickMenu,
    getDeploymentZoneButtons, getCcShuffleDrawButton,
    getIllegalCcPlayButtons, getNegationResponseButtons, getCelebrationButtons,
    getLobbyEmbed, getLobbyStartButton, updateThreadName,
    getDeploySpaceGridRows, buildDeployRowButtons,

    // Combat (from handlers)
    sendRerollUI, proceedAfterRerolls, sendReadyToResolveRolls,

    // Mission rules (real)
    runEndOfRoundRules, runStartOfRoundRules,
    runNpcThugActivation, runNpcKryknaActivation,

    // Rendering (real where possible, stubbed where Discord-dependent)
    buildDcEmbedAndFiles, buildDiscardPileDisplayPayload,
    buildBoardMapPayload, buildHandDisplayPayload,
    getActivationMinimapAttachment, getMovementMinimapAttachment,
    getDeploymentMapAttachment: getDeploymentMapAttachmentStub,
    getMapAttachmentForSpaces,

    // Extracted engine modules (real)
    shuffleArray, filterValidTopLeftSpaces,
    getMissionTokenLabel, calculateKillVp,
    // Game readers — wrapped to close over in-memory Maps (matching index.js wrapper signatures)
    hasActionsRemainingInGame: (game, gameId) => _hasActionsRemainingInGameRaw(game, gameId, dcMessageMeta),
    shouldShowEndActivationPhaseButton: (game, gameId) => _shouldShowEndActivationPhaseButtonRaw(game, gameId, dcMessageMeta),
    isGroupDefeated: (game, playerNum, dcIndex) => _isGroupDefeatedRaw(game, playerNum, dcIndex, { getDcList: (g, pn) => (pn === 1 ? g.player1Squad?.dcList : g.player2Squad?.dcList) || [] }),
    isDepletedRemovedFromGame: (game, msgId) => _isDepletedRemovedFromGameRaw(game, msgId),
    findDcMessageIdForFigure: (gameId, playerNum, figureKey) => _findDcMessageIdForFigureRaw(gameId, playerNum, figureKey, dcMessageMeta),
    getFigureLabel: (game, playerNum, figureKey, fallback, maxLen) => _getFigureLabelRaw(game, playerNum, figureKey, fallback, maxLen, { dcMessageMeta }),
    getPlayerZoneLabel: (game, playerId) => _getPlayerZoneLabelRaw(game, playerId),
    countActiveGamesForPlayer: (playerId) => _countActiveGamesForPlayerRaw(playerId, gamesMap),
    getDcUpgradeAttachments, getConditionsForDcMessage, getNicknamesForDcMessage,
    getPlayReadyMaps,

    // Locally-defined stubs
    updateAttachmentMessageForDc, updateMovementBankMessage,
    ensureMovementBankMessage, updateDcActionsMessage,
    updateHandChannelMessages, updateHandVisualMessage,
    updateDiscardPileMessage, updatePlayAreaDcButtons,
    clearMoveGridMessages, maybeShowEndActivationPhaseButton,
    refreshAllGameComponents, sendRoundActivationPhaseMessage,
    sendBleedingPrompt, sendDeckIllegalAlert, sendSquadConfirmation,
    postDevaronDoorButtons, postDevaronCratePushPrompts, postKryknaPushButtons,
    updateDeployPromptMessages, getDcPlayAreaComponents,
    getDcActionButtons, getActivateDcButtons,

    // Game operations (stubs for headless)
    checkWinConditions, resolveCombatAfterRolls, applyDamageAndFinishCombat,
    finishCombatResolution, checkPostCombatSurges,
    applyDirectDamageToFigure, applyNpcDamageToFigure,
    decrementActivationIfGroupDefeated,

    // Setup/creation stubs
    createPlayAreaChannels, createBoardChannel, createHandThreads,
    createGameChannels, applySquadSubmission, finishSetupAttachments,
    runDraftRandom, clearPreGameSetup,
    postMissionCardAfterMapSelection, postPinnedMissionCardFromGameState,
    getDeployFigureLabels, getDeployButtonRows,

    // Phase gate / round (real)
    sendPhaseGateMessages,
    runStartOfRoundDcEffects, runPostDeployPhase,

    // Conditions (real)
    filterCondition, isConditionImmune, applyCondition, HARMFUL_CONDITIONS,
    getEffectiveSpeed,
    getRange, hasLineOfSight,
    getDeploymentZones, getDcStats,
    getLegalInteractOptions, countTerminalsControlledByPlayer,
    isFigureInDeploymentZone, getSpaceController, getFiguresOnOrAdjacentToSpace,
    getPlayableCcSpecialsForDc, getPlayableCcEndOfActivationForDc,
    getPlayableCcDoubleActionsForDc,
    getCommandCardImagePath, getConditionCardPath,

    // Lobby
    lobbies: new Map(),

    // Capture accessors for tests
    _actionLog: actionLog,
    _gamesMap: gamesMap,
    _client: client,
  };
}
