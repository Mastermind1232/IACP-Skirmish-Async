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
  dcNameFromFigureKey, parseFigureKey, getDcEffect, getEffectiveFigureSize,
  computeCombatResult, getEffectiveMapSpaces, getFiguresAdjacentToTarget,
  grantMovementBank, grantPowerTokens, opponentPlayerNum, checkNefariousGains as _checkNefariousGainsVp,
  cleanupGameLock,
} from '../game/index.js';

import {
  removeFigurePosition,
  getPlayerId, getDcList, getDcMessageIds,
  getCcHand, getCcDiscard, getCcDeck,
  getActivatedDcIndices, getActivationsRemaining, setActivationsRemaining,
  vpKey, ccHandKey, ccDiscardKey, ccDeckKey, ccAttachmentsKey,
} from '../game/player-helpers.js';

// ── Data loaders ────────────────────────────────────────────────────────────

import {
  getDcEffects, getDiceData, getCcEffect, isCcAttachment, isDcAttachment,
  isDcUnique, getMapSpaces, getMapRegistry, getMapTokensData,
  getTournamentRotation, getMissionCardsData, getMissionRules,
  getDeploymentZones, getDcStats, getFigureSize,
  getDcKeywords, getCcEffectsData,
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

// ── Engine modules: combat bridge, win conditions, etc. ─────────────────────

import {
  applyNpcDamageToFigure as _realApplyNpcDamageToFigure,
  applyDirectDamageToFigure as _realApplyDirectDamageToFigure,
  resolveCombatAfterRolls as _realResolveCombatAfterRolls,
  applyDamageAndFinishCombat as _realApplyDamageAndFinishCombat,
  finishCombatResolution as _realFinishCombatResolution,
  checkPostCombatSurges as _realCheckPostCombatSurges,
} from '../engine/combat-bridge.js';

import {
  checkWinConditions as _realCheckWinConditions,
  checkNefariousGains as _realCheckNefariousGains,
  checkHuntDissent as _realCheckHuntDissent,
  decrementActivationIfGroupDefeated as _realDecrementActivation,
  postGameOver as _realPostGameOver,
} from '../engine/win-conditions.js';

import { checkFriendlyDefeatedPassiveRedraws } from '../game/cc-passive-redraw.js';
import { isWithinN } from '../engine/utils.js';
import { lookupFigureDcIndex as _lookupFigureDcIndex } from '../engine/game-readers.js';
import { findFigureheadFigure as _findFigureheadFigureRaw } from '../engine/misc-helpers.js';
import { getCleaveTargetButtons, getFightingKnifeTargetButtons } from '../discord/components.js';
import { PHASES } from '../game/phase.js';
import { setPhase } from '../game/phase.js';

// ── Extracted engine modules ────────────────────────────────────────────────

import { shuffleArray, filterValidTopLeftSpaces } from '../engine/utils.js';
import {
  getMissionTokenLabel, calculateKillVp as _calculateKillVpRaw,
} from '../engine/mission-helpers.js';
import { isDcCompanion } from '../data-loader.js';
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
  getDcUpgradeAttachments,
  getConditionsForDcMessage as _getConditionsForDcMessageRaw,
  getNicknamesForDcMessage as _getNicknamesForDcMessageRaw,
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
  runStatusPhaseAfterEndOfRound,
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
    const { undoStack: _, ...rest } = game;
    game.undoStack.push(JSON.parse(JSON.stringify(rest)));
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
  // Use real UI builders (remove override stubs — Task 3.28)
  const getDcActionButtons = getDcActionButtonsFromDiscord;
  const getActivateDcButtons = getActivateDcButtonsFromDiscord;

  // ── Shared helpers needed by combat deps ──────────────────────────────────
  const discordCatch = () => {};
  const calculateKillVp = (dcName) => _calculateKillVpRaw(dcName, { isDcCompanion, getDcStats, getDcEffects });
  const isDbConfigured = () => false;
  const achievementsChannelId = null;
  const checkAndGrantAchievements = noopAsync;
  const checkAndPostAchievements = noopAsync;
  const postAchievementNotification = noopAsync;

  const _isGroupDefeated = (game, playerNum, dcIndex) => _isGroupDefeatedRaw(game, playerNum, dcIndex, { getDcList: (g, pn) => (pn === 1 ? g.p1DcList : g.p2DcList) || [], getDcStats });
  const _findDcMessageIdForFigure = (gameId, playerNum, figureKey) => _findDcMessageIdForFigureRaw(gameId, playerNum, figureKey, dcMessageMeta);
  const _getFigureLabel = (game, playerNum, figureKey, fallback, maxLen) => _getFigureLabelRaw(game, playerNum, figureKey, fallback, maxLen, { dcMessageMeta, dcNameFromFigureKey, getDcList, getDcMessageIds });
  const _findFigureheadFigure = (game, defenderPlayerNum, targetFigureKey) => _findFigureheadFigureRaw(game, defenderPlayerNum, targetFigureKey, {
    getDcList, getDcEffect, dcNameFromFigureKey,
    isWithinN: (a, b, n, mapId) => isWithinN(a, b, n, mapId, getMapSpaces),
    findDcMessageIdForFigure: _findDcMessageIdForFigure, parseFigureKey,
  });
  // Wrap DC UI helpers that need deps.getDcStats bound
  const getConditionsForDcMessage = (game, meta) => _getConditionsForDcMessageRaw(game, meta, { getDcStats });
  const getNicknamesForDcMessage = (game, meta) => _getNicknamesForDcMessageRaw(game, meta, { getDcStats });

  // Build the shared deps object used by combat-bridge and win-conditions functions
  const _buildCombatDeps = () => ({
    logGameAction, saveGames, dcHealthState, dcMessageMeta, dcExhaustedState,
    dcNameFromFigureKey, parseFigureKey, opponentPlayerNum, discordCatch,
    reduceHp, healHp, removeFigurePosition,
    calculateKillVp, awardKillVp, awardObjectiveVp, vpKey,
    getDcList, getDcMessageIds, getDcStats, getDcEffects, getDcEffect, getDcKeywords,
    getPlayerId, getMapSpaces, getEffectiveMapSpaces,
    isWithinN: (a, b, n, mapId) => isWithinN(a, b, n, mapId, getMapSpaces),
    hasLineOfSight, getRange,
    getFiguresAdjacentToTarget, getFiguresOnOrAdjacentToSpace,
    getEffectiveFigureSize, getFootprintCells, getFigureSize,
    findDcMessageIdForFigure: _findDcMessageIdForFigure,
    lookupFigureDcIndex: (game, pn, fk) => _lookupFigureDcIndex(game, pn, fk, { dcMessageMeta, getDcMessageIds, getDcList }),
    getFigureLabel: _getFigureLabel,
    getCcHand, getCcEffectsData, getCcEffect,
    ccHandKey, ccDiscardKey, ccDeckKey, ccAttachmentsKey,
    _applyCondition: applyCondition, filterCondition, isConditionImmune, HARMFUL_CONDITIONS,
    isDcUnique, getActivatedDcIndices,
    isDbConfigured, achievementsChannelId, checkAndGrantAchievements, checkAndPostAchievements, postAchievementNotification,
    grantMovementBank, grantPowerTokens, getDiceData,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    getCelebrationButtons, getCleaveTargetButtons, getFightingKnifeTargetButtons,
    normalizeCoord, computeCombatResult, getBoardStateForMovement,
    findFigureheadFigure: _findFigureheadFigure,
    updateAttachmentMessageForDc, updateMovementBankMessage, ensureMovementBankMessage,
    updateDcActionsMessage, updateHandChannelMessages, updateHandVisualMessage,
    sendPowerTokenOverflowUI: noopAsync,
    applyIndiscriminateFireSplash: noopAsync,
    buildDcEmbedAndFiles, getConditionsForDcMessage, getDcUpgradeAttachments, getNicknamesForDcMessage,
    buildBoardMapPayload,
    getPlayAreaId: () => null,
    syncHealthStateToList: (game, pn, msgId, hs) => {
      const dcIds = getDcMessageIds(game, pn);
      const dcList = getDcList(game, pn);
      const idx = dcIds ? dcIds.indexOf(msgId) : -1;
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...hs];
    },
    client,
    // headless flag for skipping Discord-only prompts
    headless: true,
  });

  // ── Wire real game-logic functions ──────────────────────────────────────────

  // checkWinConditions: uses real implementation with headless postGameOver
  const checkWinConditions = async (game, clientArg) => {
    const combatDeps = _buildCombatDeps();
    const result = await _realCheckWinConditions(game, clientArg || client, {
      ...combatDeps,
      getCrateDeploymentVpBonus: () => ({ p1: 0, p2: 0 }),
      getAnchorheadPatronVpBonus: () => ({ p1: 0, p2: 0 }),
      postGameOver: async (g, c, winnerId, reason) => {
        g.ended = true;
        setPhase(g, PHASES.ENDED);
        g.winnerId = winnerId ?? null;
        await logGameAction(g, c, `GAME OVER — ${winnerId ? `Player ${winnerId} wins` : reason}`, { phase: 'ROUND', icon: 'round' });
        saveGames();
      },
      logGameAction,
    });
    return result;
  };

  // checkNefariousGains, checkHuntDissent, decrementActivationIfGroupDefeated
  const checkNefariousGains = async (game, defeatedOwnerPN, clientArg) => {
    await _realCheckNefariousGains(game, defeatedOwnerPN, clientArg || client, {
      _checkNefariousGainsVp, logGameAction,
    });
  };
  const checkHuntDissent = async (game, attackerPN, attackerFigKey, clientArg) => {
    await _realCheckHuntDissent(game, attackerPN, attackerFigKey, clientArg || client, {
      getDcEffects, dcNameFromFigureKey, grantPowerTokens, getRange, logGameAction,
    });
  };
  const decrementActivationIfGroupDefeated = async (game, playerNum, dcIdx, clientArg) => {
    await _realDecrementActivation(game, playerNum, dcIdx, clientArg || client, {
      isGroupDefeated: _isGroupDefeated,
      getActivatedDcIndices,
      getActivationsRemaining,
      setActivationsRemaining,
      updateActivationsMessage,
    });
  };

  // applyDamageAndFinishCombat: real implementation with full deps
  const applyDamageAndFinishCombat = async (game, combat, params, clientArg) => {
    const combatDeps = _buildCombatDeps();
    combatDeps.checkNefariousGains = checkNefariousGains;
    combatDeps.checkWinConditions = checkWinConditions;
    combatDeps.checkHuntDissent = checkHuntDissent;
    combatDeps.checkFriendlyDefeatedPassiveRedraws = checkFriendlyDefeatedPassiveRedraws;
    combatDeps.decrementActivationIfGroupDefeated = decrementActivationIfGroupDefeated;
    // Wire circular deps (combat bridge calls itself recursively for Blast/Cleave)
    combatDeps.applyNpcDamageToFigure = applyNpcDamageToFigure;
    combatDeps.checkPostCombatSurges = checkPostCombatSurges;
    combatDeps.finishCombatResolution = finishCombatResolution;
    await _realApplyDamageAndFinishCombat(game, combat, params, clientArg || client, combatDeps);
  };

  // resolveCombatAfterRolls
  const resolveCombatAfterRolls = async (game, combat, clientArg) => {
    const combatDeps = _buildCombatDeps();
    combatDeps.applyDamageAndFinishCombat = applyDamageAndFinishCombat;
    await _realResolveCombatAfterRolls(game, combat, clientArg || client, combatDeps);
  };

  // finishCombatResolution
  const finishCombatResolution = async (game, combat, resultText, embedRefreshMsgIds, clientArg) => {
    const combatDeps = _buildCombatDeps();
    await _realFinishCombatResolution(game, combat, resultText, embedRefreshMsgIds, clientArg || client, combatDeps);
  };

  // checkPostCombatSurges
  const checkPostCombatSurges = async (game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum) => {
    const combatDeps = _buildCombatDeps();
    combatDeps.finishCombatResolution = finishCombatResolution;
    await _realCheckPostCombatSurges(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum, combatDeps);
  };

  // applyDirectDamageToFigure
  const applyDirectDamageToFigure = async (game, playerNum, figKey, msgId, damage, clientArg, thread, sourceName) => {
    const combatDeps = _buildCombatDeps();
    combatDeps.checkNefariousGains = checkNefariousGains;
    combatDeps.checkWinConditions = checkWinConditions;
    combatDeps.checkHuntDissent = checkHuntDissent;
    combatDeps.checkFriendlyDefeatedPassiveRedraws = checkFriendlyDefeatedPassiveRedraws;
    combatDeps.decrementActivationIfGroupDefeated = decrementActivationIfGroupDefeated;
    await _realApplyDirectDamageToFigure(game, playerNum, figKey, msgId, damage, clientArg || client, thread, sourceName, combatDeps);
  };

  // applyNpcDamageToFigure
  const applyNpcDamageToFigure = async (game, playerNum, figureKey, damage, sourceLabel) => {
    const combatDeps = _buildCombatDeps();
    combatDeps.checkNefariousGains = checkNefariousGains;
    combatDeps.checkWinConditions = checkWinConditions;
    combatDeps.checkHuntDissent = checkHuntDissent;
    combatDeps.checkFriendlyDefeatedPassiveRedraws = checkFriendlyDefeatedPassiveRedraws;
    combatDeps.decrementActivationIfGroupDefeated = decrementActivationIfGroupDefeated;
    await _realApplyNpcDamageToFigure(game, playerNum, figureKey, damage, sourceLabel, combatDeps);
  };

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
    dcNameFromFigureKey, parseFigureKey, getDcEffect, getEffectiveFigureSize,
    computeCombatResult, getEffectiveMapSpaces, getFiguresAdjacentToTarget,
    grantMovementBank, grantPowerTokens, opponentPlayerNum,
    getPlayerId, getDcList, getDcMessageIds, getCcHand,
    vpKey, ccHandKey, ccDiscardKey, ccDeckKey, ccAttachmentsKey,
    getActivatedDcIndices, getActivationsRemaining, setActivationsRemaining,

    // Data loaders (real implementations)
    getDcEffects, getDiceData, getCcEffect, isCcAttachment, isDcAttachment,
    isDcUnique, getMapSpaces, getMapRegistry, getMapTokensData,
    getTournamentRotation, getMissionCardsData, getMissionRules,
    resolveDcName, isFigurelessDc, getFigureSize,
    getDcKeywords, getCcEffectsData,

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
    isGroupDefeated: _isGroupDefeated,
    isDepletedRemovedFromGame: (game, msgId) => _isDepletedRemovedFromGameRaw(game, msgId),
    findDcMessageIdForFigure: _findDcMessageIdForFigure,
    getFigureLabel: _getFigureLabel,
    getPlayerZoneLabel: (game, playerId) => _getPlayerZoneLabelRaw(game, playerId),
    countActiveGamesForPlayer: (playerId) => _countActiveGamesForPlayerRaw(playerId, gamesMap),
    getDcUpgradeAttachments, getConditionsForDcMessage, getNicknamesForDcMessage,
    getPlayReadyMaps,
    checkFriendlyDefeatedPassiveRedraws,

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

    // Game operations (real implementations wired with headless deps)
    checkWinConditions, resolveCombatAfterRolls, applyDamageAndFinishCombat,
    finishCombatResolution, checkPostCombatSurges,
    applyDirectDamageToFigure, applyNpcDamageToFigure,
    decrementActivationIfGroupDefeated,
    checkNefariousGains, checkHuntDissent,

    // Setup/creation stubs
    createPlayAreaChannels, createBoardChannel, createHandThreads,
    createGameChannels, applySquadSubmission, finishSetupAttachments,
    runDraftRandom, clearPreGameSetup,
    postMissionCardAfterMapSelection, postPinnedMissionCardFromGameState,
    getDeployFigureLabels, getDeployButtonRows,

    // Phase gate / round (real)
    sendPhaseGateMessages,
    runStartOfRoundDcEffects, runPostDeployPhase, runStatusPhaseAfterEndOfRound,

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
