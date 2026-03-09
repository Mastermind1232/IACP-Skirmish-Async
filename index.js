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
  cleanupGameMaps,
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
import { getHandler, getHandlerGroup } from './src/handlers/index.js';
import { applyIndiscriminateFireSplash } from './src/handlers/combat-special-effects.js';
import {
  applyNpcDamageToFigure as _applyNpcDamageToFigure,
  applyDirectDamageToFigure as _applyDirectDamageToFigure,
  sendBleedingPrompt as _sendBleedingPrompt,
  resolveCombatAfterRolls as _resolveCombatAfterRolls,
  applyDamageAndFinishCombat as _applyDamageAndFinishCombat,
  checkPostCombatSurges as _checkPostCombatSurges,
  finishCombatResolution as _finishCombatResolution,
} from './src/handlers/combat-damage.js';
import { buildContext } from './src/context-factory.js';
import { replyOrFollowUpWithRetry } from './src/error-handling.js';
import { getCommandCardImagePath, getDcImagePath, getConditionCardPath, getFigureImagePath, resolveAssetPath, resolveDcImagePath, resolveMissionCardImagePath, UPGRADE_IMAGE_OVERRIDES } from './src/asset-paths.js';
import { canActAsPlayer } from './src/utils/can-act-as-player.js';
import { requirePlayer } from './src/utils/guards.js';
import { findGameByChannel, findGameByCommonChannel } from './src/discord/game-channel-lookup.js';
import { checkAndPostAchievements } from './src/discord/achievement-helpers.js';
import { MAX_ACTIVE_GAMES_PER_PLAYER, PENDING_ILLEGAL_TTL_MS, MAX_UNDO_DEPTH } from './src/constants.js';
import { withGameLock, cleanupGameLock } from './src/game/action-queue.js';
import {
  getLobby,
  setLobby,
  hasLobby,
  hasLobbyEmbedSent,
  markLobbyEmbedSent,
  getLobbiesMap,
} from './src/lobby-state.js';
import {
  // Still directly called in select/modal dispatch sections
  handleRequestResolve, handleRequestReject,
  handleSquadModal, handleDeployModal,
  handleMapSelectionDraw, handleMapSelectionPick,
  handleSetupAttachTo, handleArsenalPick,
  handleCcAttachTo, handleCcPlaySelect, handleCcDiscardSelect,
  handleCcSpacePick, handlePounceSpacePick, handleOverwatchSpacePick,
  handleFalseOrdersMovePick, handleRushPushSpace,
  // Used in allDeps
  runStartOfRoundDcEffects,
  handlePreReroll,
  handleCombatPassive,
  handleCombatToken,
  handleStatusPhase,
  sendRerollUI,
  proceedAfterRerolls,
  sendReadyToResolveRolls,
} from './src/handlers/index.js';
import {
  validateDeckLegal,
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
  getCompanionDescriptionForDc as _getCompanionDescriptionForDc,
  reduceHp,
  healHp,
  awardKillVp,
  awardObjectiveVp,
  deductVp,
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
  getMoveSpaceGridRows,
  buildLetterRows,
  getSpaceChoiceRows,
  buildSpaceSelectMenu,
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
  getMapSpacesData,
  getMapSpaces,
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
import { runEndOfRoundRules, runStartOfRoundRules, runNpcThugActivation, runNpcKryknaActivation } from './src/game/mission-rules.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getPlayAreaId, getHandChannelId,
  getSquad, getCcHand, getCcDeck, getCcDiscard, getCcAttachments, getDcAttachments,
  getActivationsRemaining, getActivationsTotal, getActivatedDcIndices,
  getDiscardThreadId, getActivationsMessageId,
  setActivationsRemaining, setActivationsTotal, setActivatedDcIndices,
  ccHandKey, ccDiscardKey, ccDeckKey, ccDrawnKey, ccAttachmentsKey, dcAttachmentsKey,
  dcAttachmentMessageIdsKey, vpKey, deployMetadataKey, deployLabelsKey, armyCostModifierKey,
  removeFigurePosition,
} from './src/game/player-helpers.js';
import { discordCatch } from './src/error-handling.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname);

// Resolved once at startup; undefined if env var not set
let achievementsChannelId = process.env.ACHIEVEMENTS_CHANNEL_ID || null;

/** Build embeds and files for the "Attachments" message under a DC: CC attachments then DC (Skirmish Upgrade) attachments. */
async function buildAttachmentEmbedsAndFiles(ccNames, dcNames = [], attachedToDcName = null) {
  const embeds = [];
  const files = [];
  const items = [
    ...(ccNames || []).map((name, i) => ({ name, prefix: 'cc-attach', fallbackLabel: `Attachment ${i + 1}`, resolvePath: getCommandCardImagePath })),
    ...(dcNames || []).map((name, i) => ({ name, prefix: 'dc-attach', fallbackLabel: `Skirmish Upgrade ${i + 1}`, resolvePath: (n) => { const rel = getDcImagePath(n); return rel ? join(rootDir, rel) : null; } })),
  ];
  for (let i = 0; i < items.length; i++) {
    const { name, prefix, fallbackLabel, resolvePath } = items[i];
    const path = resolvePath(name);
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `${prefix}-${i}-${(name || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(`📎 ${name || fallbackLabel}`)
      .setColor(COLORS.BLURPLE);
    if (attachedToDcName) embed.setDescription(`Attached to: **${attachedToDcName}**`);
    if (path && existsSync(path)) {
      files.push(new AttachmentBuilder(path, { name: fileName }));
      embed.setThumbnail(`attachment://${fileName}`);
    }
    embeds.push(embed);
  }
  return { embeds, files };
}

/** Update the Play Area "Attachments" message for a DC (CC + DC Skirmish Upgrade attachments).
 * Creates the message on demand when first attachment is added; deletes when last is removed. */
async function updateAttachmentMessageForDc(game, playerNum, dcMsgId, client) {
  const ccKey = ccAttachmentsKey(playerNum);
  const dcKey = dcAttachmentsKey(playerNum);
  const msgIds = getDcMessageIds(game, playerNum) || [];
  const attachMsgIdsKey = dcAttachmentMessageIdsKey(playerNum);
  game[attachMsgIdsKey] = game[attachMsgIdsKey] || [];
  const attachMsgIds = game[attachMsgIdsKey];
  const idx = msgIds.indexOf(dcMsgId);
  if (idx < 0) return;
  while (attachMsgIds.length <= idx) attachMsgIds.push(null);
  const attachMsgId = attachMsgIds[idx];
  const channelId = getPlayAreaId(game, playerNum);
  const ccList = (game[ccKey] || {})[dcMsgId] || [];
  const dcList = (game[dcKey] || {})[dcMsgId] || [];
  const hasContent = ccList.length > 0 || dcList.length > 0;
  const dcDisplayName = dcMessageMeta.get(dcMsgId)?.displayName || null;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!attachMsgId) {
      if (!hasContent) return;
      const { embeds, files } = await buildAttachmentEmbedsAndFiles(ccList, dcList, dcDisplayName);
      const newMsg = await channel.send({ embeds, files });
      attachMsgIds[idx] = newMsg.id;
      return;
    }
    if (!hasContent) {
      const msg = await channel.messages.fetch(attachMsgId);
      await msg.delete().catch(discordCatch);
      attachMsgIds[idx] = null;
      return;
    }
    const msg = await channel.messages.fetch(attachMsgId);
    const { embeds, files } = await buildAttachmentEmbedsAndFiles(ccList, dcList, dcDisplayName);
    await msg.edit({ embeds, files });
  } catch (err) {
    console.error('Failed to update attachment message for DC:', err);
  }
}

/** Get the mission-specific token label for the current game (from selectedMission.tokenLabel or mission-cards.json fallback). */
function getMissionTokenLabel(game) {
  if (game?.selectedMission?.tokenLabel) return game.selectedMission.tokenLabel;
  const mapId = game?.selectedMap?.id;
  const variant = game?.selectedMission?.variant;
  if (mapId && variant) {
    const missionData = getMissionCardsData()?.[mapId]?.[variant];
    if (missionData?.tokenLabel) return missionData.tokenLabel;
  }
  return 'Mission Token';
}

/** Manhattan distance in spaces between two coords. */
// Delegate to src/game/spatial.js (canonical implementation)
const getRange = _getRange;

// LOS + helpers delegated to src/game/spatial.js (canonical implementation)
const hasLineOfSight = _hasLineOfSight;

async function clearMoveGridMessages(game, moveKey, channel) {
  if (!channel) return;
  const ids = game.moveGridMessageIds?.[moveKey] || [];
  for (const id of ids) {
    try {
      const msg = await channel.messages.fetch(id);
      await msg.delete();
    } catch {
      // ignore missing messages
    }
  }
  if (game.moveGridMessageIds) delete game.moveGridMessageIds[moveKey];
}

async function editDistanceMessage(moveState, channel, content, components) {
  if (!moveState?.distanceMessageId || !channel) return;
  try {
    const msg = await channel.messages.fetch(moveState.distanceMessageId);
    await msg.edit({ content, components });
  } catch {
    // ignore
  }
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
  const safeTotal = Math.max(0, total ?? 0);
  const safeRemaining = Math.max(0, Math.min(remaining ?? 0, safeTotal));
  const bar = '🟢'.repeat(safeRemaining) + '⚪'.repeat(Math.max(0, safeTotal - safeRemaining));
  const name = displayName ? ` — ${displayName}` : '';
  return `**Movement Bank${name}:** ${safeRemaining}/${safeTotal} MP remaining ${bar ? `\n${bar}` : ''}`;
}

async function updateMovementBankMessage(game, msgId, client) {
  const bank = game.movementBank?.[msgId];
  if (!bank) return;
  const { threadId, messageId, remaining, total, displayName } = bank;
  if (!threadId) return;
  try {
    if (remaining <= 0 && messageId) {
      const thread = await client.channels.fetch(threadId);
      const msg = await thread.messages.fetch(messageId).catch(() => null);
      if (msg) await msg.delete().catch(discordCatch);
      bank.messageId = null;
      return;
    }
    if (!messageId) return;
    const thread = await client.channels.fetch(threadId);
    const msg = await thread.messages.fetch(messageId);
    await msg.edit({ content: getMovementBankText(displayName, remaining, total) });
  } catch {}
}

async function ensureMovementBankMessage(game, msgId, client) {
  const bank = game.movementBank?.[msgId];
  if (!bank) return null;
  if (bank.messageId) return bank;
  if (!bank.threadId) return bank;
  try {
    const thread = await client.channels.fetch(bank.threadId);
    const msg = await thread.send({ content: getMovementBankText(bank.displayName, bank.remaining, bank.total) });
    bank.messageId = msg.id;
  } catch (err) {
    console.error('Failed to create movement bank message:', err);
  }
  return bank;
}

/** Fisher-Yates shuffle. Mutates array in place. */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Filter zone spaces to only those valid as top-left for a unit of given size (all footprint cells in zone and unoccupied). */
function filterValidTopLeftSpaces(zoneSpaces, occupiedSpaces, size) {
  const zoneSet = new Set((zoneSpaces || []).map((s) => String(s).toLowerCase()));
  const occupiedSet = new Set((occupiedSpaces || []).map((s) => String(s).toLowerCase()));
  const sizeNorm = (size || '1x1').toLowerCase();
  if (sizeNorm === '1x1') {
    return [...zoneSet].filter((s) => !occupiedSet.has(s));
  }
  return [...zoneSet].filter((topLeft) => {
    const cells = getFootprintCells(topLeft, sizeNorm);
    return cells.every((c) => zoneSet.has(c) && !occupiedSet.has(c));
  });
}

/** Maps that are play-ready: have deployment zones, map-spaces (spaces/adjacency), and Play ready? checked so the bot can draw from the pool. */
function getPlayReadyMaps() {
  const dz = getDeploymentZones();
  return getMapRegistry().filter((m) => {
    if (!dz[m.id]?.red?.length || !dz[m.id]?.blue?.length) return false;
    const ms = getMapSpaces(m.id);
    if (!ms || ms.playReady === false) return false;
    return (Array.isArray(ms.spaces) && ms.spaces.length > 0) || (ms.adjacency && typeof ms.adjacency === 'object' && Object.keys(ms.adjacency).length > 0);
  });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/** User IDs currently creating a test game (prevents duplicate creation from double-send or double-click). */
const testGameCreationInProgress = new Set();
/** Message IDs we've already handled for testgame (prevents duplicate from Discord firing messageCreate twice). */
const processedTestGameMessageIds = new Set();
let gameIdCounter = 1;

/** Pick a random scenario with status "testready" and implemented in runDraftRandom. Skips opponent-required scenarios when p2IsBot. */
function getRandomTestreadyScenario(p2IsBot = true) {
  try {
    const path = join(rootDir, 'data', 'test-scenarios.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const scenarios = data.scenarios || {};
    const testready = Object.entries(scenarios).filter(
      ([id, s]) => s && s.status === 'testready' && IMPLEMENTED_SCENARIOS.includes(id)
    ).filter(([id]) => {
      const v = validateTestreadyScenario(id, p2IsBot);
      return v.valid;
    });
    if (testready.length === 0) return null;
    return testready[Math.floor(Math.random() * testready.length)][0];
  } catch {
    return null;
  }
}

/** Read primaryCard for a scenario from test-scenarios.json. Returns card name or null. */
function getScenarioPrimaryCard(scenarioId) {
  try {
    const path = join(rootDir, 'data', 'test-scenarios.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const scenario = (data.scenarios || {})[scenarioId];
    return (scenario && scenario.primaryCard) || null;
  } catch {
    return null;
  }
}

/** Count active (non-ended) games the player is in. */
function countActiveGamesForPlayer(playerId) {
  if (!playerId) return 0;
  let count = 0;
  for (const [, game] of getGamesMap()) {
    if (game.ended) continue;
    if (game.player1Id === playerId || game.player2Id === playerId) count++;
  }
  return count;
}

// Load games at startup (async)
await loadGames();

const CATEGORIES = {
  general: '📢 General',
  lfg: '🎮 Looking for Game',
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

/** Parse playableBy from cc-effects into traits (e.g. "TROOPER or TECHNICIAN" → ["trooper","technician"]). "Any Figure" → []. */
function parsePlayableByToTraits(playableBy) {
  if (!playableBy || typeof playableBy !== 'string') return [];
  const s = playableBy.trim().toLowerCase();
  if (s === 'any figure') return [];
  return s.split(/\s+or\s+|\s+and\s+/i).map((t) => t.trim()).filter(Boolean);
}

/** Build DC_BY_TRAIT from dc-effects: affiliation → trait → [dcNames]. */
let _dcByTraitCache = null;
function getDcByTrait() {
  if (_dcByTraitCache) return _dcByTraitCache;
  const effects = getDcEffects() || {};
  const byTrait = { rebel: {}, scum: {}, imperial: {} };
  for (const [dcName, card] of Object.entries(effects)) {
    if (!card || typeof card !== 'object') continue;
    const affil = (card.affiliation || '').toLowerCase();
    if (affil !== 'rebel' && affil !== 'scum' && affil !== 'imperial') continue;
    const keywords = card.keywords || [];
    for (const kw of keywords) {
      const t = String(kw).toLowerCase().trim();
      if (!t) continue;
      if (!byTrait[affil][t]) byTrait[affil][t] = [];
      byTrait[affil][t].push(dcName);
    }
    const nameKey = (dcName || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (nameKey && (!byTrait[affil][nameKey] || !byTrait[affil][nameKey].includes(dcName))) {
      if (!byTrait[affil][nameKey]) byTrait[affil][nameKey] = [];
      byTrait[affil][nameKey].push(dcName);
    }
  }
  _dcByTraitCache = byTrait;
  return byTrait;
}

/** Check and retool decks so the scenario is viable. Dynamically infers requirements from scenario cards + cc-effects playableBy. Runs before every testready launch. */
function retoolDecksForScenario(p1Deck, p2Deck, scenarioId) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const hasTrait = (dc, traits) => traits.some((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(dc));

  let primaryCard = null;
  let scenarioCards = [];
  try {
    const path = join(rootDir, 'data', 'test-scenarios.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const scenario = (data.scenarios || {})[scenarioId];
    if (scenario && Array.isArray(scenario.cards) && scenario.cards.length > 0) {
      scenarioCards = scenario.cards;
      primaryCard = scenario.primaryCard || scenario.cards[0];
    }
  } catch {}

  const ccEffect = primaryCard ? getCcEffect(primaryCard) : null;
  const traits = ccEffect ? parsePlayableByToTraits(ccEffect.playableBy) : [];
  const byTrait = getDcByTrait();

  if (traits.length > 0) {
    const p1DcList = p1Deck.dcList || [];
    if (!p1DcList.some((dc) => hasTrait(dc, traits))) {
      // Search all affiliations — required DC may be Imperial or Scum
      const eligibles = traits.flatMap((t) => [
        ...(byTrait.rebel?.[t] || []),
        ...(byTrait.imperial?.[t] || []),
        ...(byTrait.scum?.[t] || []),
      ]).filter(Boolean);
      if (eligibles.length > 0) p1Deck.dcList[0] = pick(eligibles);
    }
  }

  if (primaryCard && !(p1Deck.ccList || []).includes(primaryCard)) {
    const swapTarget = scenarioCards.find((c) => c !== primaryCard && (p1Deck.ccList || []).includes(c)) || (p1Deck.ccList || [])[0];
    if (swapTarget) {
      const idx = (p1Deck.ccList || []).indexOf(swapTarget);
      if (idx >= 0) p1Deck.ccList[idx] = primaryCard;
      else p1Deck.ccList[0] = primaryCard;
    } else if ((p1Deck.ccList || []).length > 0) {
      p1Deck.ccList[0] = primaryCard;
    }
  }

  return { p1Deck, p2Deck };
}

const CHANNELS = {
  announcements: { name: 'announcements', parent: 'general', type: ChannelType.GuildText },
  rulesAndFaq: { name: 'rules-and-faq', parent: 'general', type: ChannelType.GuildText },
  general: { name: 'general', parent: 'general', type: ChannelType.GuildText },
  lfg: { name: 'lfg', parent: 'lfg', type: ChannelType.GuildText },
  newGamesPosts: { name: 'new-games', parent: 'lfg', type: ChannelType.GuildForum },
  activeGames: { name: 'active-games', parent: 'lfg', type: ChannelType.GuildText },
  botLogs: { name: 'bot-logs', parent: 'admin', type: ChannelType.GuildText },
  suggestions: { name: 'suggestions', parent: 'admin', type: ChannelType.GuildText },
  requestsAndSuggestions: { name: 'bot-requests-and-suggestions', parent: 'general', type: ChannelType.GuildForum },
};


/** Get window button row for Hand channel when in End of Round window and it's this player's turn. */
function getHandWindowButtonRow(game, playerNum, gameId) {
  if (!game) return null;
  const whoseTurn = game.endOfRoundWhoseTurn;
  const playerId = getPlayerId(game, playerNum);
  if (!whoseTurn || whoseTurn !== playerId) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`end_end_of_round_${gameId}`)
      .setLabel(`End 'End of Round' window`)
      .setStyle(ButtonStyle.Primary)
  );
}

/** Build hand channel message payload (delegates to src/rendering.js, injecting local getHandWindowButtonRow). */
function buildHandDisplayPayload(hand, deck, gameId, game = null, playerNum = 1) {
  return _buildHandDisplayPayload(hand, deck, gameId, game, playerNum, { getHandWindowButtonRow });
}

// createPlayAreaChannels – delegated to src/game-creation.js
const createPlayAreaChannels = _createPlayAreaChannels;

// createHandThreads – delegated to src/game-creation.js
function createHandThreads(client, game) {
  return _createHandThreads(client, game, { discordCatch });
}

// createGameChannels – delegated to src/game-creation.js
function createGameChannels(guild, player1Id, player2Id) {
  return _createGameChannels(guild, player1Id, player2Id, {
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
function validateTestreadyScenario(scenarioId, p2IsBot = true) {
  try {
    const path = join(rootDir, 'data', 'test-scenarios.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const scenario = (data.scenarios || {})[scenarioId];
    if (!scenario) return { valid: false, reason: 'Scenario not found.' };
    const primaryCard = scenario.primaryCard;
    if (!primaryCard) return { valid: false, reason: 'No primaryCard defined.' };
    const info = getTimingTestInfo(primaryCard);
    if (info.needsOpponent && p2IsBot) {
      return { valid: false, reason: `"${primaryCard}" has timing that requires an opponent (${info.category}). Use \`testready @player2\` to test with a real P2.`, needsOpponent: true };
    }
    return { valid: true, reason: null, needsOpponent: info.needsOpponent };
  } catch {
    return { valid: false, reason: 'Failed to read scenario data.' };
  }
}

const IMPLEMENTED_SCENARIOS = [
  'smoke_grenade', 'focus', 'blitz', 'smuggled_supplies', 'dangerous_bargains',
  'recovery', 'take_initiative', 'positioning_advantage', 'rally', 'brace_yourself',
  'strategic_shift', 'inspiring_speech', 'wild_attack', 'stimulants', 'hit_and_run',
  'brace_for_impact', 'against_the_odds', 'force_surge', 'counter_attack', 'negation',
  'celebration', 'flurry_of_blades', 'cut_lines', 'battle_scars', 'shoot_the_messenger',
];

// createTestGame – delegated to src/game-creation.js
function createTestGame(client, guild, userId, scenarioId, feedbackChannel, options = {}) {
  return _createTestGame(client, guild, userId, scenarioId, feedbackChannel, options, {
    testGameCreationInProgress, countActiveGamesForPlayer, MAX_ACTIVE_GAMES_PER_PLAYER,
    createGameChannelsFn: createGameChannels, CURRENT_GAME_VERSION, setGame, getScenarioPrimaryCard,
    IMPLEMENTED_SCENARIOS, runDraftRandom, getCcEffect, getTimingTestInfo,
    discordCatch, COLORS, getGeneralSetupButtons, saveGames,
  });
}

function extractGameIdFromInteraction(interaction) {
  const id = interaction.customId || interaction.values?.[0] || '';
  const prefixes = [
    'status_phase_', 'end_end_of_round_', 'end_start_of_round_', 'map_selection_', 'draft_random_',
    'pass_activation_turn_', 'combat_ready_', 'combat_roll_', 'cc_play_select_', 'cc_discard_select_', 'cc_attach_to_',
    'botmenu_archive_yes_', 'botmenu_archive_no_', 'botmenu_kill_yes_', 'botmenu_kill_no_', 'botmenu_archive_', 'botmenu_kill_',
    'kill_game_', 'refresh_map_', 'refresh_all_', 'undo_', 'deployment_zone_red_', 'deployment_zone_blue_',
  ];
  for (const p of prefixes) {
    if (id.startsWith(p)) {
      const rest = id.slice(p.length);
      const gameId = rest.split('_')[0];
      if (gameId && games.has(gameId)) return gameId;
      return gameId || null;
    }
  }
  const m = id.match(/^(?:squad_modal_|deploy_modal_|special_done_|interact_choice_|interact_cancel_)([^_]+)/);
  if (m && games.has(m[1])) return m[1];
  const dcMatch = id.match(/^dc_(?:activate|move|attack|interact|special)_([^_]+)/);
  if (dcMatch) {
    const part = dcMatch[1];
    if (games.has(part)) return part;
    for (const [gid, g] of getGamesMap()) {
      if (g.p1DcMessageIds?.includes(part) || g.p2DcMessageIds?.includes(part)) return gid;
      for (const [msgId, meta] of dcMessageMeta) {
        if (meta.gameId === gid && (String(msgId) === part || part.startsWith(msgId))) return gid;
      }
    }
  }
  const moveMatch = id.match(/^move_(?:mp|pick)_([^_]+)/);
  if (moveMatch && games.has(moveMatch[1])) return moveMatch[1];
  const attackMatch = id.match(/^attack_target_(.+)_\d+_\d+$/);
  if (attackMatch) {
    const msgId = attackMatch[1];
    for (const [gid, g] of getGamesMap()) {
      if ([...(g.p1DcMessageIds || []), ...(g.p2DcMessageIds || [])].includes(msgId)) return gid;
    }
  }
  return null;
}

/**
 * Resolve game ID for per-game mutex locking.
 * Tries multiple strategies: prefix stripping, dcMessageMeta lookup, existing extractor, channel-based.
 * Returns null for interactions that don't belong to a game (lobby, menu, etc.) — those run without lock.
 */
function resolveGameIdForLock(interaction) {
  const customId = interaction.customId || '';
  if (!customId) return null;

  const type = interaction.isButton?.() ? 'button'
    : interaction.isStringSelectMenu?.() ? 'select'
    : interaction.isModalSubmit?.() ? 'modal'
    : null;
  if (!type) return null;

  const prefix = getHandlerKey(customId, type);
  if (!prefix) return null;

  const payload = customId.slice(prefix.length);
  const firstSegment = payload.split('_')[0];

  // Strategy 1: first segment is a gameId directly (5-digit zero-padded)
  if (firstSegment && getGame(firstSegment)) return firstSegment;

  // Strategy 2: first segment is a Discord message ID → look up in dcMessageMeta
  if (firstSegment && /^\d{10,}$/.test(firstSegment)) {
    const meta = dcMessageMeta.get(firstSegment);
    if (meta?.gameId) return meta.gameId;
  }

  // Strategy 3: fall back to existing extractor (handles more complex patterns)
  const existing = extractGameIdFromInteraction(interaction);
  if (existing) return existing;

  // Strategy 4: resolve by channel (covers thread-based interactions)
  const _chMatch = findGameByChannel(getGamesMap(), interaction.channelId);
  if (_chMatch) return _chMatch.gameId;

  return null;
}

function extractGameIdFromMessage(message) {
  const chId = message.channel?.id;
  if (!chId) return null;
  const _msgMatch = findGameByChannel(getGamesMap(), chId);
  if (_msgMatch) return _msgMatch.gameId;
  if (message.channel?.isThread?.()) {
    const parent = message.channel.parent;
    if (parent?.name === 'new-games') return null;
    for (const [gameId, g] of getGamesMap()) {
      const cat = message.guild?.channels?.cache?.get(g.gameCategoryId);
      if (cat && message.channel.parentId === cat.id) return gameId;
    }
  }
  return null;
}

/** After map selection: randomly pick A or B mission card, post to Game Log, pin it. */
async function postMissionCardAfterMapSelection(game, client, map) {
  const missions = getMissionCardsData()[map.id];
  if (!missions?.a || !missions?.b) return;
  const variant = Math.random() < 0.5 ? 'a' : 'b';
  const mission = missions[variant];
  const mapName = map.name || map.id;
  const fullName = `${mapName} — ${mission.name}`;
  game.selectedMission = { variant, name: mission.name, fullName, tokenLabel: mission.tokenLabel || '', interactLabel: mission.interactLabel || '', mechanics: mission.mechanics || {} };
  await postPinnedMissionCardFromGameState(game, client);
}

/** Post mission card when game.selectedMission and game.selectedMap are already set (e.g. Competitive). */
async function postPinnedMissionCardFromGameState(game, client) {
  const mission = game.selectedMission;
  const map = game.selectedMap;
  if (!mission || !map) return;
  const missionData = getMissionCardsData()[map.id]?.[mission.variant];
  // Build variant label: always show "Variant A — Name" explicitly.
  // Strip leading "X. " or "X: " from missionData.name if it duplicates the variant letter.
  const variantLetter = mission.variant ? String(mission.variant).toUpperCase() : '';
  let missionName = missionData?.name || mission.name || '';
  const dupPattern = new RegExp(`^${variantLetter}[.:] ?`, 'i');
  if (variantLetter && dupPattern.test(missionName)) missionName = missionName.replace(dupPattern, '').trim();
  const variantLabel = variantLetter ? `Variant ${variantLetter} — ${missionName}` : missionName;
  const mapLabel = map.name || map.id;
  const fullName = `${mapLabel}: ${variantLabel}`;
  try {
    const ch = await client.channels.fetch(game.generalId);
    let sentMsg;
    const cardImagePath = missionData?.customImagePath || missionData?.imagePath;
    if (cardImagePath) {
      const resolvedPath = resolveMissionCardImagePath(cardImagePath);
      const imagePath = resolvedPath ? join(rootDir, resolvedPath) : null;
      if (imagePath && existsSync(imagePath)) {
        const attachment = new AttachmentBuilder(imagePath, { name: 'mission-card.jpg' });
        sentMsg = await ch.send({ content: `🎯 **Mission:** ${fullName}`, files: [attachment] });
      } else {
        sentMsg = await ch.send({ content: `🎯 **Mission:** ${fullName}` });
      }
    } else {
      const parts = [`🎯 **Mission:** ${fullName}`];
      if (missionData?.setup) parts.push(`**Setup:** ${missionData.setup}`);
      if (missionData?.persistent) parts.push(`**Persistent:** ${missionData.persistent}`);
      if (missionData?.startOfRound) parts.push(`**Start of Round:** ${missionData.startOfRound}`);
      if (missionData?.endOfRound) parts.push(`**End of Round:** ${missionData.endOfRound}`);
      sentMsg = await ch.send({ content: parts.join('\n') });
    }
    await sentMsg.pin().catch(discordCatch);
    await logGameAction(game, client, `Mission selected: **${fullName}** (pinned above).`, { phase: 'SETUP', icon: 'map' });
  } catch (err) {
    console.error('Mission card post error:', err);
    await logGameAction(game, client, `Mission selected: **${fullName}**`, { phase: 'SETUP', icon: 'map' });
  }
}

/** Per-figure deploy labels (delegates to discord with helpers). */
function getDeployFigureLabels(dcList) {
  return getDeployFigureLabelsFromDiscord(dcList, { resolveDcName, isFigurelessDc, getDcStats });
}

/** Deploy button rows (delegates to discord with helpers). */
function getDeployButtonRows(gameId, playerNum, dcList, zone, figurePositions) {
  return getDeployButtonRowsFromDiscord(gameId, playerNum, dcList, zone, figurePositions, { resolveDcName, isFigurelessDc, getDcStats });
}

/** Rebuilds deploy prompt messages for a player, removing buttons for already-deployed figures. */
async function updateDeployPromptMessages(game, playerNum, client) {
  const isInitiative = playerNum === getInitiativePlayerNum(game);
  const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
  const msgIds = game[idsKey];
  if (!msgIds?.length) return;
  const handId = getHandChannelId(game, playerNum);
  const { p1Zone: _dp1z, p2Zone: _dp2z } = getPlayerDeploymentZones(game, getInitiativePlayerNum(game));
  const zone = playerNum === 1 ? _dp1z : _dp2z;
  const squad = getSquad(game, playerNum);
  const dcList = squad?.dcList || [];
  try {
    const handChannel = await client.channels.fetch(handId);
    for (const msgId of msgIds) {
      try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
    }
    game[idsKey] = [];
    const { deployRows, doneRow } = getDeployButtonRows(game.gameId, playerNum, dcList, zone, game.figurePositions);
    const DEPLOY_ROWS_PER_MSG = 4;
    const zoneLabel = zone === 'red' ? 'red' : 'blue';
    const firstContent = isInitiative
      ? `You chose the **${zoneLabel}** zone. Deploy each figure below (one per row), then click **Deployment Completed** when finished.`
      : `Your opponent has deployed. Deploy each figure in the **${zoneLabel}** zone below (one per row), then click **Deployment Completed** when finished.`;
    const mapAttachment = await getDeploymentMapAttachment(game, zone);
    if (deployRows.length === 0) {
      const payload = {
        content: isInitiative ? `You chose the **${zoneLabel}** zone. When finished, click **Deployment Completed** below.` : `Your opponent has deployed. Deploy in the **${zoneLabel}** zone. When finished, click **Deployment Completed** below.`,
        components: [doneRow],
      };
      if (mapAttachment) payload.files = [mapAttachment];
      const msg = await handChannel.send(payload);
      game[idsKey].push(msg.id);
    } else {
      for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
        const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
        const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
        const components = isLastChunk ? [...chunk, doneRow] : chunk;
        const payload = { content: i === 0 ? firstContent : null, components };
        if (i === 0 && mapAttachment) payload.files = [mapAttachment];
        const msg = await handChannel.send(payload);
        game[idsKey].push(msg.id);
      }
    }
    game[isInitiative ? 'initiativeDeployMessageId' : 'nonInitiativeDeployMessageId'] = game[idsKey][game[idsKey].length - 1];
  } catch (err) {
    console.error('updateDeployPromptMessages error:', err);
  }
}

// getFiguresForRender, buildMissionTokens, getMapTokensForRender — imported from src/rendering.js

// getActivationMinimapAttachment, getMovementMinimapAttachment — imported from src/rendering.js

/** Returns AttachmentBuilder for CC/DC space choice (zoomed to validSpaces, labels on those coords). */
async function getMapAttachmentForSpaces(game, validSpaces) {
  const map = game?.selectedMap;
  if (!map?.id || !validSpaces?.length) return null;
  try {
    const figures = getFiguresForRender(game);
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token');
    const labelCoords = validSpaces.map((s) => String(s).toLowerCase());
    const buffer = await renderMap(map.id, {
      figures,
      tokens,
      showGrid: true,
      maxWidth: 800,
      cropToZone: validSpaces,
      gridStyle: 'black',
      showGridOnlyOnCoords: labelCoords,
    });
    return new AttachmentBuilder(buffer, { name: 'space-choice.png' });
  } catch (err) {
    console.error('Map for space choice error:', err);
    return null;
  }
}

// getDeploymentMapAttachment — imported from src/rendering.js

/**
 * Compute persistent VP bonus from crates in deployment zones (Devaron Garrison B).
 * "For each crate in a player's deployment zone, that player counts as having 6 additional VPs."
 */
function getCrateDeploymentVpBonus(game) {
  if (game.selectedMap !== 'devaron-garrison' || game.selectedMission?.variant !== 'b') return { p1: 0, p2: 0 };
  const mapData = getMapTokensData()['devaron-garrison'];
  const allCrateCoords = Object.values(mapData?.missionB?.positions || {}).flat().filter(Boolean);
  // Apply any pushed positions tracked in game.cratePositions
  const cratePositions = allCrateCoords.map((c) => normalizeCoord(game.cratePositions?.[normalizeCoord(c)] || c));
  const initPlayerNum = getInitiativePlayerNum(game);
  const zones = getDeploymentZones()['devaron-garrison'] || {};
  const { p1Zone, p2Zone } = getPlayerDeploymentZones(game, initPlayerNum);
  const p1ZoneSet = new Set((zones[p1Zone] || []).map((c) => normalizeCoord(c)));
  const p2ZoneSet = new Set((zones[p2Zone] || []).map((c) => normalizeCoord(c)));
  let p1 = 0;
  let p2 = 0;
  for (const coord of cratePositions) {
    if (p1ZoneSet.has(coord)) p1 += 6;
    else if (p2ZoneSet.has(coord)) p2 += 6;
  }
  return { p1, p2 };
}

/**
 * Post Devaron Garrison B door-selection buttons for the next player in game.pendingDoorSelections.
 * @param {object} game
 * @param {Array} allDoors - from map-tokens.json, array of [a, b] coordinate pairs
 * @param {import('discord.js').TextChannel} channel - general channel
 * @param {string} gameId
 */
async function postDevaronDoorButtons(game, allDoors, channel, gameId) {
  if (!game.pendingDoorSelections || game.pendingDoorSelections.length === 0) return;
  const pending = game.pendingDoorSelections[0];
  const { playerNum, doorsRemaining } = pending;
  const pid = getPlayerId(game, playerNum);
  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  const available = (allDoors || []).filter(([a, b]) => {
    const ek1 = `${a}|${b}`.toLowerCase();
    const ek2 = `${b}|${a}`.toLowerCase();
    return !openedSet.has(ek1) && !openedSet.has(ek2);
  });
  if (available.length === 0) {
    game.pendingDoorSelections.shift();
    await channel.send({ content: `<@${pid}> — All doors are already open (no more selections needed).`, allowedMentions: { users: [pid] } }).catch(discordCatch);
    return;
  }
  const rows = [];
  for (let i = 0; i < Math.min(available.length, 20); i += 5) {
    const chunk = available.slice(i, i + 5);
    rows.push(new ActionRowBuilder().addComponents(
      chunk.map(([a, b]) => new ButtonBuilder()
        .setCustomId(`devaron_door_open_${gameId}_${a.toLowerCase()}|${b.toLowerCase()}`)
        .setLabel(`Open door ${a.toUpperCase()}↔${b.toUpperCase()}`)
        .setStyle(ButtonStyle.Primary)
      )
    ));
  }
  await channel.send({
    content: `<@${pid}> — **Crate Rush (EoR)**: You control ${doorsRemaining} terminal${doorsRemaining !== 1 ? 's' : ''}. Choose a door to open (${doorsRemaining} remaining):`,
    components: rows,
    allowedMentions: { users: [pid] },
  }).catch(discordCatch);
}

/**
 * Post crate-push buttons for Devaron Garrison B end-of-round crate push phase.
 * @param {object} game
 * @param {import('discord.js').TextChannel} channel - general channel
 * @param {string} gameId
 */
async function postDevaronCratePushPrompts(game, channel, gameId) {
  const mapData = getMapTokensData()['devaron-garrison'];
  const allOrigCoords = Object.values(mapData?.missionB?.positions || {}).flat().filter(Boolean).map((c) => String(c).toLowerCase());
  if (allOrigCoords.length === 0) return;
  for (const pn of [1, 2]) {
    const pid = getPlayerId(game, pn);
    const controlled = allOrigCoords.filter((origCoord) => {
      const cur = String(game.cratePositions?.[origCoord] || origCoord).toLowerCase();
      return getSpaceController(game, 'devaron-garrison', cur) === pn;
    });
    if (controlled.length === 0) continue;
    const rows = [];
    for (let i = 0; i < Math.min(controlled.length, 20); i += 5) {
      const chunk = controlled.slice(i, i + 5);
      rows.push(new ActionRowBuilder().addComponents(
        chunk.map((origCoord) => {
          const cur = String(game.cratePositions?.[origCoord] || origCoord).toLowerCase();
          return new ButtonBuilder()
            .setCustomId(`devaron_crate_push_${gameId}_${origCoord}`)
            .setLabel(`Push crate @ ${cur.toUpperCase()}`)
            .setStyle(ButtonStyle.Secondary);
        })
      ));
    }
    await channel.send({
      content: `<@${pid}> — **Crate Rush (EoR)**: Push each controlled crate up to 3 spaces. Select a crate:`,
      components: rows,
      allowedMentions: { users: [pid] },
    }).catch(discordCatch);
  }
}

/**
 * Post Krykna push selection buttons for Chopper Base A end-of-round push phase.
 * Shows the next player in game.pendingKryknaPushQueue buttons for each un-pushed Krykna.
 */
async function postKryknaPushButtons(game, channel, gameId) {
  if (!game.pendingKryknaPushQueue || game.pendingKryknaPushQueue.length === 0) return;
  const playerNum = game.pendingKryknaPushQueue[0];
  const pid = getPlayerId(game, playerNum);
  const pushedIds = new Set(game.kryknaPushedIds || []);
  const activeKrykna = (game.npcKrykna || []).filter((k) => !k.defeated && !pushedIds.has(k.id));
  if (activeKrykna.length === 0) return;
  const remaining = game.pendingKryknaPushQueue.length;
  const buttons = activeKrykna.map((k) =>
    new ButtonBuilder()
      .setCustomId(`krykna_push_${gameId}_${k.id}`)
      .setLabel(`Push ${k.id} @ ${String(k.coord).toUpperCase()}`)
      .setStyle(ButtonStyle.Danger)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  await channel.send({
    content: `🕷️ **Krykna Push Phase** (${remaining} push${remaining !== 1 ? 'es' : ''} remaining) — <@${pid}>, choose a Krykna to push up to 3 spaces (end adjacent to most figures if possible):`,
    components: rows,
    allowedMentions: { users: [pid] },
  }).catch(discordCatch);
}

/** Check win conditions. Returns { ended, winnerId?, reason? }. Posts game-over and sets game.ended if ended. */
/**
 * Compute persistent VP bonus from Anchorhead A patron tokens.
 * Table: 0 patrons=0VP, 1=2VP, 2=5VP, 3=10VP, 4=20VP.
 */
function getAnchorheadPatronVpBonus(game) {
  if (game.selectedMap?.id !== 'anchorhead-cantina-bar' || game.selectedMission?.variant !== 'a') return { p1: 0, p2: 0 };
  const VP_TABLE = [0, 2, 5, 10, 20];
  const patronTokens = game.anchorheadPatronTokens || {};
  let p1 = 0;
  let p2 = 0;
  for (const owner of Object.values(patronTokens)) {
    if (owner === 1) p1++;
    else if (owner === 2) p2++;
  }
  return { p1: VP_TABLE[Math.min(p1, 4)] || 0, p2: VP_TABLE[Math.min(p2, 4)] || 0 };
}

/** Combined mission VP bonus (crate deployment + patron tokens). Returns { p1, p2 } or undefined if no bonuses apply. */
function getMissionVpBonus(game) {
  const crate = getCrateDeploymentVpBonus(game);
  const patron = getAnchorheadPatronVpBonus(game);
  const p1 = crate.p1 + patron.p1;
  const p2 = crate.p2 + patron.p2;
  return (p1 || p2) ? { p1, p2 } : undefined;
}

async function checkWinConditions(game, client) {
  const crateBonus = getCrateDeploymentVpBonus(game);
  const patronBonus = getAnchorheadPatronVpBonus(game);
  const vp1 = (game.player1VP?.total ?? 0) + crateBonus.p1 + patronBonus.p1;
  const vp2 = (game.player2VP?.total ?? 0) + crateBonus.p2 + patronBonus.p2;
  const p1Figures = Object.keys(game.figurePositions?.[1] || {}).length;
  const p2Figures = Object.keys(game.figurePositions?.[2] || {}).length;

  if (vp1 >= 40 || vp2 >= 40) {
    // If both players hit 40+ VP simultaneously, player with more VP wins
    const winnerId = vp1 > vp2 ? game.player1Id : vp2 > vp1 ? game.player2Id : (vp1 >= 40 ? game.player1Id : game.player2Id);
    const reason = vp1 >= 40 && vp2 >= 40 ? `40 VP (${vp1} vs ${vp2})` : '40 VP';
    await postGameOver(game, client, winnerId, reason);
    return { ended: true, winnerId, reason };
  }
  if (p1Figures === 0 && p2Figures === 0) {
    await postGameOver(game, client, null, 'draw (both eliminated)');
    return { ended: true, winnerId: null, reason: 'draw' };
  }
  if (p1Figures === 0 || p2Figures === 0) {
    const winnerId = p1Figures === 0 ? game.player2Id : game.player1Id;
    const reason = 'elimination';
    await postGameOver(game, client, winnerId, reason);
    return { ended: true, winnerId, reason };
  }
  return { ended: false };
}

/** Post a public achievement unlock notification to #achievements. */
async function postAchievementNotification(client, channelId, userId, def) {
  try {
    const ch = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setTitle(`${def.icon || '🏆'} Achievement Unlocked!`)
      .setDescription(`<@${userId}> unlocked **${def.name}**\n${def.description}`);
    await ch.send({ content: `<@${userId}>`, embeds: [embed], allowedMentions: { users: [userId] } });
  } catch (err) {
    console.error('[Achievements] Failed to post notification:', err.message);
  }
}

async function postGameOver(game, client, winnerId, reason) {
  game.ended = true;
  game.winnerId = winnerId ?? game.winnerId ?? null;
  cleanupGameLock(game.gameId);
  cleanupGameMaps(game.gameId);
  pendingIllegalSquad.delete(`${game.gameId}_1`);
  pendingIllegalSquad.delete(`${game.gameId}_2`);
  const embed = buildScorecardEmbed(game, getMissionVpBonus(game));
  const content = winnerId
    ? `\uD83C\uDFC1 **GAME OVER** — <@${winnerId}> wins by ${reason}!`
    : `\uD83C\uDFC1 **GAME OVER** — ${reason}`;
  try {
    const ch = await client.channels.fetch(game.generalId);
    await ch.send({
      content,
      embeds: [embed],
      allowedMentions: winnerId ? { users: [winnerId] } : undefined,
    });
  } catch (err) {
    console.error('Failed to post game over:', err);
  }
  if (isDbConfigured()) {
    insertCompletedGame(game).catch((err) => console.error('[DB] insertCompletedGame:', err));
    if (achievementsChannelId && game.player1Id && game.player2Id) {
      (async () => {
        try {
          const [stats1, stats2] = await Promise.all([
            getStatsSummaryForPlayer(game.player1Id),
            getStatsSummaryForPlayer(game.player2Id),
          ]);
          await Promise.all([
            checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, game.player1Id, 'game_complete', stats1.games),
            checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, game.player2Id, 'game_complete', stats2.games),
          ]);
          const wId = game.winnerId;
          if (wId) {
            const winnerStats = wId === game.player1Id ? stats1 : stats2;
            await checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, wId, 'game_win', winnerStats.wins);
            // Shutout: opponent scored 0 VP
            const loserId = wId === game.player1Id ? game.player2Id : game.player1Id;
            const loserVP = wId === game.player1Id ? game.player2VP : game.player1VP;
            if ((loserVP?.total ?? 0) === 0) {
              await checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, wId, 'shutout_win', 1);
            }
            // Survivor: winner lost no figures (all health entries have HP > 0)
            const winnerDcList = wId === game.player1Id ? game.p1DcList : game.p2DcList;
            const allSurvived = (winnerDcList || []).every((dc) => {
              if (!dc?.healthState?.length) return true;
              return dc.healthState.every((entry) => !entry || entry[0] > 0);
            });
            if (allSurvived && winnerDcList?.length > 0) {
              await checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, wId, 'no_losses_win', 1);
            }
            // Brutalist: win by eliminating all opponent figures
            if (reason && reason.toLowerCase().includes('eliminat')) {
              await checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, wId, 'full_wipe_win', 1);
            }
          }
        } catch (err) {
          console.error('[Achievements] postGameOver hook failed:', err.message);
        }
      })();
    }
  }
  saveGames();
}

/** Returns true if game ended (and replied to user). Call after getGame() in handlers to block further actions. */
async function replyIfGameEnded(game, interaction) {
  if (game?.ended) {
    await interaction.followUp({ content: 'This game has ended.', ephemeral: true }).catch(discordCatch);
    return true;
  }
  return false;
}

/** Returns a player's zone label, e.g. "[RED] " or "[BLUE] ", or "" if unknown. Used by handlers. */
function getPlayerZoneLabel(game, playerId) {
  if (!playerId) return '';
  let zone = playerId === game.player1Id ? game.player1DeploymentZone : game.player2DeploymentZone;
  if (!zone && game.deploymentZoneChosen) {
    zone = (playerId === game.initiativePlayerId) ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  }
  return zone ? `[${zone.toUpperCase()}] ` : '';
}

/** Refresh all game components with latest data (DC stats, CC images, etc.). Reloads JSON data first. */
async function refreshAllGameComponents(game, client) {
  await reloadGameData();
  const gameId = game.gameId;

  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Refresh All: board failed', err);
    }
  }

  const allDcMsgIds = [...(game.p1DcMessageIds || []), ...(game.p2DcMessageIds || [])];
  for (const msgId of allDcMsgIds) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.gameId !== gameId) continue;
    if (isDepletedRemovedFromGame(game, msgId)) continue;
    const exhausted = dcExhaustedState.get(msgId) ?? false;
    const displayName = meta.displayName || meta.dcName;
    let healthState = dcHealthState.get(msgId) ?? [];
    const stats = getDcStats(meta.dcName);
    const figureless = isFigurelessDc(meta.dcName);
    if (!figureless && stats.health != null) {
      const figures = stats.figures ?? 1;
      healthState = Array.from({ length: figures }, (_, i) => {
        const existing = healthState[i];
        const cur = existing?.[0] != null ? existing[0] : stats.health;
        const max = existing?.[1] != null ? existing[1] : stats.health;
        return [cur, max];
      });
      dcHealthState.set(msgId, healthState);
    }
    try {
      const channelId = getPlayAreaId(game, meta.playerNum);
      const channel = await client.channels.fetch(channelId);
      const msg = await channel.messages.fetch(msgId);
      const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, displayName, healthState, getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, msgId));
      const components = getDcPlayAreaComponents(msgId, exhausted, game, meta.dcName);
      await msg.edit({ embeds: [embed], files: files?.length ? files : [], components });
    } catch (err) {
      console.error('Refresh All: DC message failed', msgId, err);
    }
  }

  // Update Companion embeds from dc-effects (so figure DC companions show after edit + Refresh All)
  const p1PlayAreaId = game.p1PlayAreaId;
  const p2PlayAreaId = game.p2PlayAreaId;
  const p1CompanionIds = game.p1DcCompanionMessageIds || [];
  const p2CompanionIds = game.p2DcCompanionMessageIds || [];
  const p1DcList = game.p1DcList || [];
  const p2DcList = game.p2DcList || [];
  for (let i = 0; i < p1CompanionIds.length; i++) {
    if (!p1CompanionIds[i]) continue;
    const dcName = p1DcList[i]?.dcName;
    if (!dcName) continue;
    try {
      const ch = await client.channels.fetch(p1PlayAreaId);
      const companionMsg = await ch.messages.fetch(p1CompanionIds[i]);
      const desc = getCompanionDescriptionForDc(dcName);
      await companionMsg.edit({ embeds: [new EmbedBuilder().setTitle('Companion').setDescription(desc).setColor(COLORS.DARK_EMBED)] });
    } catch (err) {
      console.error('Refresh All: P1 companion message failed', p1CompanionIds[i], err);
    }
  }
  for (let i = 0; i < p2CompanionIds.length; i++) {
    if (!p2CompanionIds[i]) continue;
    const dcName = p2DcList[i]?.dcName;
    if (!dcName) continue;
    try {
      const ch = await client.channels.fetch(p2PlayAreaId);
      const companionMsg = await ch.messages.fetch(p2CompanionIds[i]);
      const desc = getCompanionDescriptionForDc(dcName);
      await companionMsg.edit({ embeds: [new EmbedBuilder().setTitle('Companion').setDescription(desc).setColor(COLORS.DARK_EMBED)] });
    } catch (err) {
      console.error('Refresh All: P2 companion message failed', p2CompanionIds[i], err);
    }
  }

  await updateHandChannelMessages(game, client);
  for (const pn of [1, 2]) {
    await updateHandVisualMessage(game, pn, client);
    await updateDiscardPileMessage(game, pn, client);
  }
}

/** Returns { content, files?, embeds?, components } for posting the game map. Delegates to src/rendering.js with local deps injected. */
async function buildBoardMapPayload(gameId, map, game) {
  return _buildBoardMapPayload(gameId, map, game, client, { getMissionVpBonus });
}

/** Delete setup messages from Game Log when Round 1 begins. */
async function clearPreGameSetup(game, client) {
  const ids = [
    ...(game.generalSetupMessageId ? [game.generalSetupMessageId] : []),
    ...(game.bothReadyMessageId ? [game.bothReadyMessageId] : []),
    ...(game.deploymentZoneMessageId ? [game.deploymentZoneMessageId] : []),
    ...(game.setupLogMessageIds || []),
  ];
  if (ids.length === 0) return;
  try {
    const ch = await client.channels.fetch(game.generalId);
    for (const id of ids) {
      try {
        const msg = await ch.messages.fetch(id);
        await msg.delete();
      } catch {}
    }
    game.generalSetupMessageId = null;
    game.bothReadyMessageId = null;
    game.deploymentZoneMessageId = null;
    game.setupLogMessageIds = [];
  } catch (err) {
    console.error('Failed to clear pre-game setup:', err);
  }
}

/**
 * Reorder one player's play area so attachment messages appear directly after their parent DC.
 * Deletes all DC + attachment messages, then re-sends them interleaved in correct order.
 * Only runs when the player actually has attachment messages to interleave.
 */
async function reorderPlayAreaAfterAttachments(game, playerNum, client) {
  const dcList = getDcList(game, playerNum);
  const dcMsgIds = getDcMessageIds(game, playerNum);
  const attachMsgIds = game[dcAttachmentMessageIdsKey(playerNum)] || [];
  const ccAttachKey = ccAttachmentsKey(playerNum);
  const dcAttachKey = dcAttachmentsKey(playerNum);
  const channelId = getPlayAreaId(game, playerNum);

  // Only reorder if there are attachment messages to interleave
  const hasAttachments = attachMsgIds.some((id) => id != null);
  if (!hasAttachments) return;

  const channel = await client.channels.fetch(channelId);
  const oldDcMsgIds = [...dcMsgIds];
  const oldAttachMsgIds = [...attachMsgIds];

  // 1. Delete all existing DC messages and attachment messages
  for (const msgId of oldDcMsgIds) {
    if (msgId) {
      try { await (await channel.messages.fetch(msgId)).delete(); }
      catch (err) { console.error('[reorder] Failed to delete DC msg:', err.message); }
    }
  }
  for (const msgId of oldAttachMsgIds) {
    if (msgId) {
      try { await (await channel.messages.fetch(msgId)).delete(); }
      catch (err) { console.error('[reorder] Failed to delete attachment msg:', err.message); }
    }
  }

  // 2. Re-send in correct interleaved order: DC → its attachments → next DC → ...
  const newDcMsgIds = [];
  const newAttachMsgIds = [];
  const dcMsgIdRemap = new Map();

  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    const oldDcMsgId = oldDcMsgIds[i];
    const healthState = dc.healthState || [];

    // Re-send DC embed
    const { embed, files } = await buildDcEmbedAndFiles(dc.dcName, false, dc.displayName, healthState);
    const newDcMsg = await channel.send({ embeds: [embed], files });
    const newDcMsgId = newDcMsg.id;
    newDcMsgIds.push(newDcMsgId);

    // Clean up old Map entries and set new ones
    if (oldDcMsgId) {
      dcMessageMeta.delete(oldDcMsgId);
      dcExhaustedState.delete(oldDcMsgId);
      dcHealthState.delete(oldDcMsgId);
      dcMsgIdRemap.set(oldDcMsgId, newDcMsgId);
    }
    dcMessageMeta.set(newDcMsgId, { gameId: game.gameId, playerNum, dcName: dc.dcName, displayName: dc.displayName });
    dcExhaustedState.set(newDcMsgId, false);
    dcHealthState.set(newDcMsgId, healthState);

    // Add components (buttons)
    const components = getDcPlayAreaComponents(newDcMsgId, false, game, dc.dcName);
    await newDcMsg.edit({ components });

    // Re-send attachment message interleaved right after its DC
    const ccAttachments = oldDcMsgId ? ((game[ccAttachKey] || {})[oldDcMsgId] || []) : [];
    const dcAttachments = oldDcMsgId ? ((game[dcAttachKey] || {})[oldDcMsgId] || []) : [];
    if (ccAttachments.length > 0 || dcAttachments.length > 0) {
      const { embeds, files: attachFiles } = await buildAttachmentEmbedsAndFiles(ccAttachments, dcAttachments, dc.displayName);
      const attachMsg = await channel.send({ embeds, files: attachFiles });
      newAttachMsgIds.push(attachMsg.id);
    } else {
      newAttachMsgIds.push(null);
    }
  }

  // 3. Update game arrays
  if (playerNum === 1) {
    game.p1DcMessageIds = newDcMsgIds;
    game.p1DcAttachmentMessageIds = newAttachMsgIds;
    game.p1DcCompanionMessageIds = newDcMsgIds.map(() => null);
  } else {
    game.p2DcMessageIds = newDcMsgIds;
    game.p2DcAttachmentMessageIds = newAttachMsgIds;
    game.p2DcCompanionMessageIds = newDcMsgIds.map(() => null);
  }

  // 4. Remap msgId-keyed attachment objects (CC and DC attachments)
  for (const key of [ccAttachKey, dcAttachKey]) {
    const obj = game[key];
    if (!obj) continue;
    const newObj = {};
    for (const [oldId, val] of Object.entries(obj)) {
      const newId = dcMsgIdRemap.get(oldId) || oldId;
      newObj[newId] = val;
    }
    game[key] = newObj;
  }
}

/** Called when all setup attachments are placed: start Round 1 and send shuffle/draw prompts. */
async function finishSetupAttachments(game, client) {
  // Reorder play area messages so attachments appear right after their parent DCs
  try {
    await reorderPlayAreaAfterAttachments(game, 1, client);
    await reorderPlayAreaAfterAttachments(game, 2, client);
  } catch (err) {
    console.error('Failed to reorder play area after attachments:', err);
  }
  game.currentRound = 1;
  const generalChannel = await client.channels.fetch(game.generalId);
  const initPlayerNum = getInitiativePlayerNum(game);
  const deployContent = `<@${game.initiativePlayerId}> (${getInitiativePlayerZoneLabel(game)}**Player ${initPlayerNum}**) **Both players have deployed.** Both players: draw your starting hands in the **Your Hand** thread (inside your Play Area). Round 1 will begin when both have drawn.`;
  await generalChannel.send({
    content: deployContent,
    allowedMentions: { users: [game.initiativePlayerId] },
  });
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  await clearPreGameSetup(game, client);
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
  const { scenarioId } = options;
  const generalChannel = await client.channels.fetch(game.generalId);

  // Map selection
  if (!game.mapSelected) {
    const playReadyMaps = getPlayReadyMaps();
    if (playReadyMaps.length === 0) throw new Error('No play-ready maps available.');
    const map = playReadyMaps[Math.floor(Math.random() * playReadyMaps.length)];
    game.selectedMap = { id: map.id, name: map.name, imagePath: map.imagePath };
    game.mapSelected = true;
    await postMissionCardAfterMapSelection(game, client, map);
  }

  // Play areas first (hand threads live inside them)
  if (!game.p1PlayAreaId || !game.p2PlayAreaId) {
    const guild = generalChannel.guild;
    const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
    const prefix = `IA${game.gameId}`;
    const { p1PlayAreaChannel, p2PlayAreaChannel } = await createPlayAreaChannels(
      guild, gameCategory, prefix, game.player1Id, game.player2Id
    );
    game.p1PlayAreaId = p1PlayAreaChannel.id;
    game.p2PlayAreaId = p2PlayAreaChannel.id;
  }

  // Map Updates channel created AFTER play areas so it appears last in the category
  if (!game.boardId) {
    const guild = generalChannel.guild;
    const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
    const prefix = `IA${game.gameId}`;
    const boardChannel = await createBoardChannel(guild, gameCategory, prefix, game.player1Id, game.player2Id);
    game.boardId = boardChannel.id;
    if (game.selectedMap) {
      try {
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('runDraftRandom: failed to post map to Map Updates:', err);
      }
    }
  }

  // Hand threads live inside each player's play area
  if (!game.p1HandId || !game.p2HandId) {
    await createHandThreads(client, game);
  }

  // One side Rebels, one side Scum. Testready: load sample deck, then run viability check and retool before every launch
  let p1Deck = { ...DEFAULT_DECK_REBELS, dcList: [...(DEFAULT_DECK_REBELS.dcList || [])], ccList: [...(DEFAULT_DECK_REBELS.ccList || [])] };
  let p2Deck = { ...DEFAULT_DECK_SCUM, dcList: [...(DEFAULT_DECK_SCUM.dcList || [])], ccList: [...(DEFAULT_DECK_SCUM.ccList || [])] };
  if (scenarioId) {
    ({ p1Deck, p2Deck } = retoolDecksForScenario(p1Deck, p2Deck, scenarioId));
  }
  await applySquadSubmission(game, true, p1Deck, client);
  await applySquadSubmission(game, false, p2Deck, client);

  // Initiative + deployment zone
  if (!game.initiativeDetermined) {
    const winner = Math.random() < 0.5 ? game.player1Id : game.player2Id;
    const playerNum = winner === game.player1Id ? 1 : 2;
    game.initiativePlayerId = winner;
    game.initiativeDetermined = true;
    await logGameAction(
      game,
      client,
      `<@${winner}> (**Player ${playerNum}**) won initiative! Chooses deployment zone and activates first each round.`,
      { allowedMentions: { users: [winner] }, phase: 'INITIATIVE', icon: 'initiative' }
    );
  }
  if (!game.deploymentZoneChosen) {
    const zone = Math.random() < 0.5 ? 'red' : 'blue';
    const otherZone = zone === 'red' ? 'blue' : 'red';
    game.deploymentZoneChosen = zone;
    const initiativePlayerNum = getInitiativePlayerNum(game);
    const { p1Zone: _p1z, p2Zone: _p2z } = getPlayerDeploymentZones(game, initiativePlayerNum);
    game.player1DeploymentZone = _p1z;
    game.player2DeploymentZone = _p2z;
    const zoneLabel = `[${zone.toUpperCase()}] `;
    await logGameAction(
      game,
      client,
      `<@${game.initiativePlayerId}> (${zoneLabel}**Player ${initiativePlayerNum}**) chose the **${zone}** deployment zone`,
      { allowedMentions: { users: [game.initiativePlayerId] }, phase: 'INITIATIVE', icon: 'zone' }
    );
  }

  // Auto-deploy figures
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  if (!zones) throw new Error('Deployment zones not found for selected map.');
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[1]) game.figurePositions[1] = {};
  if (!game.figurePositions[2]) game.figurePositions[2] = {};
  game.figureOrientations = game.figureOrientations || {};

  const deployForPlayer = (playerNum, zone, opponentZone) => {
    const squad = getSquad(game, playerNum);
    const dcList = squad?.dcList || [];
    const { metadata } = getDeployFigureLabels(dcList);
    // Compute centroid of opponent zone to rank spaces by proximity to the "entrance"
    const oppZoneCoords = (zones?.[opponentZone] || []).map((s) => parseCoord(String(s).toLowerCase()));
    const oppCx = oppZoneCoords.length ? oppZoneCoords.reduce((s, c) => s + c.col, 0) / oppZoneCoords.length : 0;
    const oppCy = oppZoneCoords.length ? oppZoneCoords.reduce((s, c) => s + c.row, 0) / oppZoneCoords.length : 0;
    for (const meta of metadata) {
      const figureKey = `${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`;
      const occupied = [];
      for (const p of [1, 2]) {
        for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
          const dcName = dcNameFromFigureKey(k);
          const size = getEffectiveFigureSize(game, k, dcName);
          occupied.push(...getFootprintCells(s, size));
        }
      }
      const baseSize = getFigureSize(meta.dcName);
      const size = baseSize === '2x3' ? (Math.random() < 0.5 ? '2x3' : '3x2') : baseSize;
      const zoneSpaces = (zones?.[zone] || []).map((s) => String(s).toLowerCase());
      const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, size);
      if (!validSpaces.length) throw new Error(`No valid deploy spaces for ${meta.dcName} in ${zone} zone.`);
      // Sort by Manhattan distance to opponent zone centroid (ascending = closest to enemy entrance first)
      validSpaces.sort((a, b) => {
        const pa = parseCoord(a), pb = parseCoord(b);
        const da = Math.abs(pa.col - oppCx) + Math.abs(pa.row - oppCy);
        const db = Math.abs(pb.col - oppCx) + Math.abs(pb.row - oppCy);
        return da - db;
      });
      const space = validSpaces[0];
      game.figurePositions[playerNum][figureKey] = space;
      if (baseSize === '2x3') {
        game.figureOrientations[figureKey] = size;
      }
    }
  };

  const initiativePlayerNum = getInitiativePlayerNum(game);
  const nonInitiativePlayerNum = opponentPlayerNum(initiativePlayerNum);
  const zone = game.deploymentZoneChosen;
  const otherZone = zone === 'red' ? 'blue' : 'red';
  deployForPlayer(initiativePlayerNum, zone, otherZone);
  deployForPlayer(nonInitiativePlayerNum, otherZone, zone);

  game.initiativePlayerDeployed = true;
  game.nonInitiativePlayerDeployed = true;
  game.currentRound = 1;
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  game.draftRandomUsed = true;

  if (game.boardId && game.selectedMap) {
    const boardChannel = await client.channels.fetch(game.boardId);
    const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
    await boardChannel.send(payload);
  }

  // Shuffle + draw starting 3 CCs. Scenario may seed P1 hand (e.g. smoke_grenade forces Smoke Grenade)
  const drawStartingHand = async (playerNum) => {
    const squad = getSquad(game, playerNum);
    const ccList = squad?.ccList || [];
    const deck = [...ccList];
    shuffleArray(deck);
    let hand = deck.splice(0, 3);
    if (scenarioId && playerNum === 1) {
      const primaryCard = getScenarioPrimaryCard(scenarioId);
      if (primaryCard && !hand.includes(primaryCard)) {
        const replaced = hand[0];
        hand = [primaryCard, hand[1], hand[2]].filter(Boolean);
        if (replaced) deck.push(replaced);
        const pcIdx = deck.indexOf(primaryCard);
        if (pcIdx >= 0) deck.splice(pcIdx, 1);
      }
    }
    const deckKey = ccDeckKey(playerNum);
    const handKey = ccHandKey(playerNum);
    const drawnKey = ccDrawnKey(playerNum);
    game[deckKey] = deck;
    game[handKey] = hand;
    game[drawnKey] = true;
    const playerId = getPlayerId(game, playerNum);
    await logGameAction(game, client, `<@${playerId}> shuffled and drew 3 Command Cards.`, { phase: 'DEPLOYMENT', icon: 'card', allowedMentions: { users: [playerId] } });
    const handChannelId = getHandChannelId(game, playerNum);
    const handChannel = await client.channels.fetch(handChannelId);
    const existingMsgs = await handChannel.messages.fetch({ limit: 5 });
    if (existingMsgs.size === 0) {
      const playerId = getPlayerId(game, playerNum);
      await handChannel.send({
        content: `<@${playerId}>, this is your hand.`,
        embeds: [getHandTooltipEmbed(game, playerNum)],
        allowedMentions: { users: [playerId] },
      });
    }
    const handPayload = buildHandDisplayPayload(hand, deck, game.gameId, game, playerNum);
    await handChannel.send({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    });
    await updateHandVisualMessage(game, playerNum, client);
  };
  await drawStartingHand(1);
  await drawStartingHand(2);

  await logGameAction(game, client, '**Draft Random** — Auto-deployed all figures and drew starting CCs.', { phase: 'DEPLOYMENT', icon: 'deployed' });

  await updatePlayAreaDcButtons(game, client);
  await runStartOfRoundDcEffects(game, game.gameId, client, { logGameAction });
  await sendRoundActivationPhaseMessage(game, client);
  await clearPreGameSetup(game, client);
  saveGames();
}

/** F14: Push one undo step. Trims to MAX_UNDO_DEPTH to prevent unbounded growth. */
function pushUndo(game, entry) {
  game.undoStack = game.undoStack || [];
  const { undoStack, ...rest } = game;
  const snapshot = JSON.parse(JSON.stringify(rest));
  game.undoStack.push({ ...entry, snapshot, ts: Date.now() });
  if (game.undoStack.length > MAX_UNDO_DEPTH) game.undoStack.shift();
}

function getSquadSelectEmbed(playerNum, squad) {
  const embed = new EmbedBuilder()
    .setTitle(`Player ${playerNum} – Deck Selection`)
    .setDescription(
      squad
        ? `**Squad:** ${squad.name}\n**Deployment Cards:** ${squad.dcCount ?? '—'} cards\n**Command Cards:** ${squad.ccCount ?? '—'} cards\n\n✓ Squad submitted.`
        : 'Submit your squad using any of these methods:\n' +
          '1. **Select Squad** — fill out the form\n' +
          '2. **Upload a .vsav file** — export from [IACP List Builder](https://iacp-list-builder.onrender.com/)\n' +
          '3. **Copy-paste your list** — from the IACP builder, press the **Share** button and paste the full list below'
    )
    .setColor(COLORS.DARK_EMBED);
  return embed;
}

/** Find msgId for DC message containing the given figure (for dcHealthState lookup). */
function findDcMessageIdForFigure(gameId, playerNum, figureKey) {
  const m = figureKey.match(/^(.+)-(\d+)-(\d+)$/);
  const dcName = m ? m[1] : figureKey;
  const dgIndex = m ? m[2] : '1';
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId || meta.playerNum !== playerNum) continue;
    const dn = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    if (meta.dcName === dcName && dn && String(dn[1]) === String(dgIndex)) return msgId;
  }
  return null;
}

/** Calculate VP awarded for defeating a figure of the given DC. */
function calculateKillVp(dcName) {
  const stats = getDcStats(dcName);
  const effects = getDcEffects()?.[dcName];
  const figures = stats?.figures ?? 1;
  return (figures > 1 && effects?.subCost != null) ? effects.subCost : (stats?.cost ?? 5);
}

/**
 * If a deployment group is fully defeated and hasn't activated yet,
 * decrement the owner's remaining activations.
 */
async function decrementActivationIfGroupDefeated(game, playerNum, dcIdx, client) {
  if (dcIdx < 0 || !isGroupDefeated(game, playerNum, dcIdx)) return;
  const activatedIndices = getActivatedDcIndices(game, playerNum) || [];
  if (activatedIndices.includes(dcIdx)) return;
  setActivationsRemaining(game, playerNum, Math.max(0, (getActivationsRemaining(game, playerNum) ?? 0) - 1));
  await updateActivationsMessage(game, playerNum, client);
}

/**
 * Look up a figure's DC message and its index in the player's DC list.
 * Combines findDcMessageIdForFigure + getDcMessageIds + getDcList + indexOf.
 * @returns {{ msgId: string|null, dcList: Array, idx: number }}
 */
function lookupFigureDcIndex(game, playerNum, figureKey) {
  const msgId = findDcMessageIdForFigure(game.gameId, playerNum, figureKey);
  const dcIds = getDcMessageIds(game, playerNum);
  const dcList = getDcList(game, playerNum);
  const idx = (dcIds || []).indexOf(msgId);
  return { msgId, dcList, idx };
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
  const { msgId, dcList, idx } = lookupFigureDcIndex(game, playerNum, figureKey);
  const raw = (idx >= 0 && dcList?.[idx]?.displayName) ? dcList[idx].displayName : (fallback ?? dcNameFromFigureKey(figureKey));
  return { msgId, label: String(raw).slice(0, maxLen) };
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
// applyNpcDamageToFigure — extracted to src/handlers/combat-damage.js
const applyNpcDamageToFigure = _applyNpcDamageToFigure;

/** Remove a specific condition from a figure. No-op if figure or condition not found. */
const filterCondition = _filterCondition;
const isConditionImmune = _isConditionImmune;
const HARMFUL_CONDITIONS = _HARMFUL_CONDITIONS;

// sendBleedingPrompt — extracted to src/handlers/combat-damage.js
const sendBleedingPrompt = _sendBleedingPrompt;

/**
 * Build the shared context object for combat-damage functions.
 * Captures index.js closure variables so extracted functions can access them.
 */
function buildCombatDamageCtx() {
  return {
    logGameAction, saveGames, dcHealthState, dcMessageMeta, dcExhaustedState,
    findDcMessageIdForFigure, calculateKillVp, lookupFigureDcIndex, getFigureLabel,
    checkWinConditions, decrementActivationIfGroupDefeated, updateAttachmentMessageForDc,
    buildDcEmbedAndFiles, getConditionsForDcMessage, getDcUpgradeAttachments,
    getCelebrationButtons, getCleaveTargetButtons, getFightingKnifeTargetButtons,
    buildBoardMapPayload, updateDcActionsMessage, ensureMovementBankMessage,
    updateMovementBankMessage, isDbConfigured, achievementsChannelId,
    checkAndGrantAchievements, postAchievementNotification,
    getFiguresOnOrAdjacentToSpace, applyIndiscriminateFireSplash, getFigureSize,
    applyDirectDamageToFigure, getFigureLabel,
  };
}

// applyDirectDamageToFigure — extracted to src/handlers/combat-damage.js (wrapper adds ctx)
function applyDirectDamageToFigure(game, playerNum, figKey, msgId, damage, client, thread, sourceName) {
  return _applyDirectDamageToFigure(game, playerNum, figKey, msgId, damage, client, thread, sourceName, buildCombatDamageCtx());
}

// resolveCombatAfterRolls — extracted to src/handlers/combat-damage.js (wrapper adds ctx)
function resolveCombatAfterRolls(game, combat, client) {
  return _resolveCombatAfterRolls(game, combat, client, buildCombatDamageCtx());
}

// applyDamageAndFinishCombat — extracted to src/handlers/combat-damage.js (wrapper adds ctx)
function applyDamageAndFinishCombat(game, combat, params, client) {
  return _applyDamageAndFinishCombat(game, combat, params, client, buildCombatDamageCtx());
}

// checkPostCombatSurges — extracted to src/handlers/combat-damage.js (wrapper adds ctx)
function checkPostCombatSurges(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum) {
  return _checkPostCombatSurges(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum, buildCombatDamageCtx());
}

// finishCombatResolution — extracted to src/handlers/combat-damage.js (wrapper adds ctx)
function finishCombatResolution(game, combat, resultText, embedRefreshMsgIds, client) {
  return _finishCombatResolution(game, combat, resultText, embedRefreshMsgIds, client, buildCombatDamageCtx());
}

// handleSidewinderApply, handleSidewinderSkip — extracted to src/handlers/combat-special-effects.js

// handleBoltslingerTarget, handleBoltslingerSkip — extracted to src/handlers/combat-special-effects.js

// handleBoltslingerTarget..handleMissileSalvoDone, applyIndiscriminateFireSplash, advanceSpreadThePain
// — extracted to src/handlers/combat-special-effects.js

/** DCs whose image is in DC Skirmish Upgrades are figureless (incl. Squad Upgrades like [Flame Trooper]); if image is in dc-figures, it's a figure. */
const isFigurelessDc = _isFigurelessDc;
const hasDepleteEffect = _hasDepleteEffect;
const getCompanionDescriptionForDc = _getCompanionDescriptionForDc;

function getDeckIllegalPlayCustomId(gameId, playerNum) {
  return `deck_illegal_play_${gameId}_${playerNum}`;
}
function getDeckIllegalRedoCustomId(gameId, playerNum) {
  return `deck_illegal_redo_${gameId}_${playerNum}`;
}

async function sendDeckIllegalAlert(game, isP1, squad, validation, client) {
  const gameId = game.gameId;
  const playerNum = isP1 ? 1 : 2;
  const playerId = isP1 ? game.player1Id : game.player2Id;
  const key = `${gameId}_${playerNum}`;
  pendingIllegalSquad.set(key, { squad, timestamp: Date.now() });
  const handChannelId = isP1 ? game.p1HandId : game.p2HandId;
  const handChannel = await client.channels.fetch(handChannelId);
  const errorList = validation.errors.map((e) => `• ${e}`).join('\n');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(getDeckIllegalPlayCustomId(gameId, playerNum))
      .setLabel('PLAY IT ANYWAY')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(getDeckIllegalRedoCustomId(gameId, playerNum))
      .setLabel('REDO')
      .setStyle(ButtonStyle.Danger)
  );
  await handChannel.send({
    content: `<@${playerId}> — Your deck is **not legal**.\n\n${errorList}\n\nChoose an option below:`,
    components: [row],
    allowedMentions: { users: [playerId] },
  });
}

/** True if any DC in this game has actions remaining to spend. */
function hasActionsRemainingInGame(game, gameId) {
  for (const [mid, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    const data = game.dcActionsData?.[mid];
    if (data?.remaining > 0) return true;
  }
  return false;
}

/** True when both players have no readied DCs and no actions left to spend in any activated DC. */
function shouldShowEndActivationPhaseButton(game, gameId) {
  const r1 = game.p1ActivationsRemaining ?? 0;
  const r2 = game.p2ActivationsRemaining ?? 0;
  if (r1 > 0 || r2 > 0) return false;
  if (hasActionsRemainingInGame(game, gameId)) return false;
  return true;
}

/** Send the round activation phase message (Round X — Your turn!) to Game Log. Skips Start of Round window. */
async function sendRoundActivationPhaseMessage(game, client) {
  const gameId = game.gameId;
  const generalChannel = await client.channels.fetch(game.generalId);
  const round = game.currentRound || 1;
  const roundEmbed = new EmbedBuilder()
    .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${round} - Start of Round`)
    .setColor(PHASE_COLOR);
  const showBtn = shouldShowEndActivationPhaseButton(game, gameId);
  const components = [];
  if (showBtn) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${game.currentRound || 1} Activation Phase`)
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  const initRem = game.initiativePlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const otherRem = game.initiativePlayerId === game.player1Id ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
  if (otherRem > initRem && initRem > 0) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pass_activation_turn_${gameId}`)
        .setLabel('Pass turn to opponent')
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  const initPlayerNum = getInitiativePlayerNum(game);
  const initZone = getInitiativePlayerZoneLabel(game);
  const passHint = otherRem > initRem && initRem > 0 ? ' You may pass back (opponent has more activations).' : '';
  const content = showBtn
    ? `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Your turn! All deployment groups readied. Both players: click **End R${round} Activation Phase** when you've used all activations and any end-of-activation effects.${passHint}`
    : `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Your turn! All deployment groups readied. Use all activations and actions. The **End R${round} Activation Phase** button will appear when both players have done so.${passHint}`;
  const sent = await generalChannel.send({
    content,
    embeds: [roundEmbed],
    components,
    allowedMentions: { users: [game.initiativePlayerId] },
  });
  game.roundActivationMessageId = sent.id;
  game.roundActivationButtonShown = showBtn;
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  await updateHandChannelMessages(game, client);
}

/** Edit the round message to add the End Activation Phase button when conditions are met. */
async function maybeShowEndActivationPhaseButton(game, client) {
  const gameId = game.gameId;
  if (!shouldShowEndActivationPhaseButton(game, gameId)) return;
  if (game.roundActivationButtonShown) return;
    const roundMsgId = game.roundActivationMessageId;
  if (!roundMsgId || !game.generalId) return;
  try {
    const ch = await client.channels.fetch(game.generalId);
    const msg = await ch.messages.fetch(roundMsgId);
    const round = game.currentRound || 1;
    const roundEmbed = new EmbedBuilder()
      .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${round} - Activation Phase`)
      .setColor(PHASE_COLOR);
    const endBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${round} Activation Phase`)
        .setStyle(ButtonStyle.Secondary)
    );
    const initPlayerNum = getInitiativePlayerNum(game);
    const initZone = getInitiativePlayerZoneLabel(game);
    await msg.edit({
      content: `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Both players have used all activations and actions. Both players: click **End R${round} Activation Phase** when done with any end-of-activation effects.`,
      embeds: [roundEmbed],
      components: [endBtn],
      allowedMentions: { users: [game.initiativePlayerId] },
    }).catch(discordCatch);
    game.roundActivationButtonShown = true;
    saveGames();
  } catch (err) {
    console.error('Failed to show End Activation Phase button:', err);
  }
}

/** Update the DC thread's Actions message with current counter. If all actions exhausted, @ the other player to activate. */
async function updateDcActionsMessage(game, msgId, client) {
  const data = game.dcActionsData?.[msgId];
  if (!data?.threadId) return;
  const meta = dcMessageMeta.get(msgId);
  const displayName = meta?.displayName || meta?.dcName || '';

  if (data?.messageId) {
    try {
      const thread = await client.channels.fetch(data.threadId);
      const msg = await thread.messages.fetch(data.messageId);
      const components = meta && game ? getDcActionButtons(msgId, meta.dcName, displayName, data, game) : [];
      const editPayload = {
        content: getActionsCounterContent(data.remaining, data.total),
        components,
      };
      const actMinimap = await getActivationMinimapAttachment(game, msgId);
      if (actMinimap) {
        editPayload.files = [actMinimap];
        editPayload.attachments = []; // replace old minimap image rather than accumulating
      }
      await msg.edit(editPayload).catch(discordCatch);
    } catch (err) {
      console.error('Failed to update DC actions message:', err);
    }
  }
  // P4/P5: Refresh the DC embed in the play area with live action count + power tokens
  if (meta && game) {
    try {
      const _chId = getPlayAreaId(game, meta.playerNum);
      const _ch = await client.channels.fetch(_chId);
      const _dcMsg = await _ch.messages.fetch(msgId);
      const _hs = dcHealthState.get(msgId) || [];
      const { embed: _emb, files: _files } = await buildDcEmbedAndFiles(
        meta.dcName, true, displayName, _hs,
        getConditionsForDcMessage(game, meta),
        getDcUpgradeAttachments(game, msgId),
        getTokensForDcMessage(game, meta),
        data,
        getNicknamesForDcMessage(game, meta),
      );
      const _comps = getDcPlayAreaComponents(msgId, true, game, meta.dcName);
      await _dcMsg.edit({ embeds: [_emb], files: _files, components: _comps }).catch(discordCatch);
    } catch (_err) {
      console.error('Failed to update DC embed with action count/tokens:', _err);
    }
  }

  if (data?.remaining === 0 && meta) {
    game.dcFinishedPinged = game.dcFinishedPinged || {};
    game.pendingEndTurn = game.pendingEndTurn || {};
    if (!game.dcFinishedPinged[msgId] && !game.pendingEndTurn[msgId]) {
      const ownerId = getPlayerId(game, meta.playerNum);
      const initPlayerNum = meta.playerNum;
      try {
        const ch = await client.channels.fetch(game.generalId);
        const icon = ACTION_ICONS.activate || '⚡';
        const timestamp = `<t:${Math.floor(Date.now() / 1000)}:t>`;
        const endTurnBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`end_turn_${game.gameId}_${msgId}`)
            .setLabel('End Turn')
            .setStyle(ButtonStyle.Primary)
        );
        const endTurnMsg = await ch.send({
          content: `${icon} ${timestamp} — <@${ownerId}> (**Player ${initPlayerNum}**) **${displayName}** finished all actions. Press **End Turn** when ready to pass the turn.`,
          components: [endTurnBtn],
          allowedMentions: { users: [ownerId] },
        });
        game.pendingEndTurn[msgId] = { playerNum: meta.playerNum, displayName, messageId: endTurnMsg.id };
      } catch (err) {
        console.error('Failed to send End Turn prompt:', err);
      }
    }
    await maybeShowEndActivationPhaseButton(game, client);
  }
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
  if (!game || !msgId) return false;
  const p1 = game.p1DepletedDcMessageIds || [];
  const p2 = game.p2DepletedDcMessageIds || [];
  return p1.includes(msgId) || p2.includes(msgId);
}

/** Returns component rows for a DC message in Play Area (delegates to discord with game-specific helpers). */
function getDcPlayAreaComponents(msgId, exhausted, game, dcName) {
  const gameStarted = (game?.currentRound || 0) >= 1;
  return getDcPlayAreaComponentsFromDiscord(msgId, exhausted, game, dcName, { isDepletedRemovedFromGame, hasDepleteEffect, getDcStats, gameStarted });
}

/** True if all figures in this deployment group are defeated (or never deployed). */
function isGroupDefeated(game, playerNum, dcIndex) {
  const dcList = getDcList(game, playerNum) || [];
  const dc = dcList[dcIndex];
  if (!dc) return true;
  const dcName = dc.dcName || dc;
  const displayName = typeof dc === 'object' ? dc.displayName : dcName;
  const dgMatch = displayName?.match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const stats = getDcStats(dcName);
  const figureCount = stats.figures ?? 1;
  const poses = game.figurePositions?.[playerNum] || {};
  for (let f = 0; f < figureCount; f++) {
    const figureKey = `${dcName}-${dgIndex}-${f}`;
    if (figureKey in poses) return false;
  }
  return true;
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
  if (!game || !msgId) return [];
  return (game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || []);
}

function getConditionsForDcMessage(game, meta) {
  if (!game?.figureConditions || !meta?.dcName) return undefined;
  const stats = getDcStats(meta.dcName);
  const figures = stats.figures ?? 1;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const out = [];
  let hasAny = false;
  for (let i = 0; i < figures; i++) {
    const fk = `${meta.dcName}-${dgIndex}-${i}`;
    const list = game.figureConditions[fk] || [];
    out.push(Array.isArray(list) ? list : [list]);
    if (out[out.length - 1].length) hasAny = true;
  }
  return hasAny ? out : undefined;
}

/** Per-figure power tokens for a DC message (for embed display). */
function getTokensForDcMessage(game, meta) {
  if (!game?.figurePowerTokens || !meta?.dcName) return undefined;
  const stats = getDcStats(meta.dcName);
  const figures = stats.figures ?? 1;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const out = [];
  let hasAny = false;
  for (let i = 0; i < figures; i++) {
    const fk = `${meta.dcName}-${dgIndex}-${i}`;
    const list = game.figurePowerTokens[fk] || [];
    out.push(Array.isArray(list) ? [...list] : []);
    if (out[out.length - 1].length) hasAny = true;
  }
  return hasAny ? out : undefined;
}

function getNicknamesForDcMessage(game, meta) {
  if (!game?.figureNicknames || !meta?.dcName) return undefined;
  const stats = getDcStats(meta.dcName);
  const figures = stats.figures ?? 1;
  if (figures <= 1) return undefined;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const out = [];
  let hasAny = false;
  for (let i = 0; i < figures; i++) {
    const fk = `${meta.dcName}-${dgIndex}-${i}`;
    const nick = game.figureNicknames[fk] || null;
    out.push(nick);
    if (nick) hasAny = true;
  }
  return hasAny ? out : undefined;
}

// buildDcEmbedAndFiles — imported from src/rendering.js

// buildDiscardPileDisplayPayload — imported from src/rendering.js

/** Update both Hand channel messages (for window buttons). Call when entering/exiting Start or End of Round window. */
async function updateHandChannelMessages(game, client) {
  for (const pn of [1, 2]) {
    const hand = getCcHand(game, pn) || [];
    const deck = getCcDeck(game, pn) || [];
    const handId = getHandChannelId(game, pn);
    if (!handId) continue;
    try {
      const handCh = await client.channels.fetch(handId);
      const msgs = await handCh.messages.fetch({ limit: 20 });
      const handMsg = msgs.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      if (handMsg) {
        const payload = buildHandDisplayPayload(hand, deck, game.gameId, game, pn);
        await handMsg.edit({ content: payload.content, embeds: payload.embeds, files: payload.files || [], components: payload.components }).catch(discordCatch);
      }
    } catch (err) {
      console.error('Failed to update hand channel message:', err);
    }
  }
}

/** Call after changing player1CcHand/player2CcHand to refresh the Play Area hand visual. */
async function updateHandVisualMessage(game, playerNum, client) {
  const msgId = playerNum === 1 ? game.p1HandVisualMessageId : game.p2HandVisualMessageId;
  const hand = getCcHand(game, playerNum) || [];
  if (msgId == null) return;
  try {
    const channelId = getPlayAreaId(game, playerNum);
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(msgId);
    await msg.edit({ embeds: [getHandVisualEmbed(hand.length)] });
  } catch (err) {
    console.error('Failed to update hand visual message:', err);
  }
}

/** Green = remaining, red = used. Returns e.g. "**Activations:** 🟢🟢🟢🔴 (3/4 remaining)" */
/** Call after changing discard pile to refresh the Play Area discard embed and buttons. */
async function updateDiscardPileMessage(game, playerNum, client) {
  const msgId = playerNum === 1 ? game.p1DiscardPileMessageId : game.p2DiscardPileMessageId;
  if (msgId == null) return;
  const discard = getCcDiscard(game, playerNum) || [];
  const threadId = getDiscardThreadId(game, playerNum);
  const hasOpenThread = !!threadId;
  try {
    const channelId = getPlayAreaId(game, playerNum);
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(msgId);
    await msg.edit({
      embeds: [getDiscardPileEmbed(discard.length)],
      components: [getDiscardPileButtons(game.gameId, playerNum, hasOpenThread)],
    });
  } catch (err) {
    console.error('Failed to update discard pile message:', err);
  }
}

/** Update all DC messages in both Play Areas to show Activate buttons (when both players have drawn). */
async function updatePlayAreaDcButtons(game, client) {
  if (!game.player1CcDrawn || !game.player2CcDrawn) return;
  for (const playerNum of [1, 2]) {
    const msgIds = getDcMessageIds(game, playerNum) || [];
    const channelId = getPlayAreaId(game, playerNum);
    if (!channelId || msgIds.length === 0) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      for (const msgId of msgIds) {
        const meta = dcMessageMeta.get(msgId);
        if (!meta || meta.gameId !== game.gameId) continue;
        if (isDepletedRemovedFromGame(game, msgId)) continue;
        const exhausted = dcExhaustedState.get(msgId) ?? false;
        const components = getDcPlayAreaComponents(msgId, exhausted, game, meta.dcName);
        const msg = await channel.messages.fetch(msgId);
        await msg.edit({ components }).catch(discordCatch);
      }
    } catch (err) {
      console.error('Failed to update Play Area DC buttons:', err);
    }
  }
}

async function populatePlayAreas(game, client) {
  const p1PlayArea = await client.channels.fetch(game.p1PlayAreaId);
  const p2PlayArea = await client.channels.fetch(game.p2PlayAreaId);
  const gameId = game.gameId;

  const p1FigureDcs = (game.player1Squad?.dcList || []).filter((d) => !isFigurelessDc(resolveDcName(d)));
  const p2FigureDcs = (game.player2Squad?.dcList || []).filter((d) => !isFigurelessDc(resolveDcName(d)));
  const p1Total = p1FigureDcs.length || game.player1Squad?.dcCount || 0;
  const p2Total = p2FigureDcs.length || game.player2Squad?.dcCount || 0;
  game.p1ActivationsTotal = p1Total;
  game.p2ActivationsTotal = p2Total;
  game.p1ActivationsRemaining = p1Total;
  game.p2ActivationsRemaining = p2Total;

  const processDcList = (dcList) => {
    const counts = {};
    const totals = {};
    for (const d of dcList) {
      const n = resolveDcName(d);
      if (n) totals[n] = (totals[n] || 0) + 1;
    }
    return dcList.map((entry) => {
      const dcName = resolveDcName(entry);
      counts[dcName] = (counts[dcName] || 0) + 1;
      const dgIndex = counts[dcName];
      const displayName = totals[dcName] > 1 ? `${dcName} [DG ${dgIndex}]` : dcName;
      const stats = getDcStats(dcName);
      const figureless = isFigurelessDc(dcName);
      const health = figureless ? null : (stats.health ?? '?');
      const figures = figureless ? 0 : (stats.figures ?? 1);
      const healthState = figureless ? [] : Array.from({ length: figures }, () => [health, health]);
      return { dcName, displayName, healthState };
    });
  };

  const p1DcsRaw = processDcList(game.player1Squad.dcList || []);
  const p2DcsRaw = processDcList(game.player2Squad.dcList || []);
  const p1Dcs = p1DcsRaw.filter((dc) => !isDcAttachment(dc.dcName));
  const p2Dcs = p2DcsRaw.filter((dc) => !isDcAttachment(dc.dcName));
  // Sort: figure DCs first (preserve squad order), figureless DCs (skirmish upgrades) last
  p1Dcs.sort((a, b) => {
    const af = isFigurelessDc(a.dcName) ? 1 : 0;
    const bf = isFigurelessDc(b.dcName) ? 1 : 0;
    return af - bf;
  });
  p2Dcs.sort((a, b) => {
    const af = isFigurelessDc(a.dcName) ? 1 : 0;
    const bf = isFigurelessDc(b.dcName) ? 1 : 0;
    return af - bf;
  });
  game.p1DcList = p1Dcs;
  game.p2DcList = p2Dcs;
  game.p1ActivatedDcIndices = game.p1ActivatedDcIndices || [];
  game.p2ActivatedDcIndices = game.p2ActivatedDcIndices || [];
  game.p1DcMessageIds = [];
  game.p2DcMessageIds = [];
  game.p1DcAttachmentMessageIds = [];
  game.p2DcAttachmentMessageIds = [];
  game.p1DcCompanionMessageIds = [];
  game.p2DcCompanionMessageIds = [];
  game.p1CcAttachments = game.p1CcAttachments || {};
  game.p2CcAttachments = game.p2CcAttachments || {};
  game.p1DcAttachments = game.p1DcAttachments || {};
  game.p2DcAttachments = game.p2DcAttachments || {};

  // Tooltip embeds at top of each Play Area
  await p1PlayArea.send({ embeds: [getPlayAreaTooltipEmbed(game, 1)] });
  await p2PlayArea.send({ embeds: [getPlayAreaTooltipEmbed(game, 2)] });

  const p1HandCount = (game.player1CcHand || []).length;
  const p2HandCount = (game.player2CcHand || []).length;
  const p1HandVisualMsg = await p1PlayArea.send({ embeds: [getHandVisualEmbed(p1HandCount)] });
  const p2HandVisualMsg = await p2PlayArea.send({ embeds: [getHandVisualEmbed(p2HandCount)] });
  game.p1HandVisualMessageId = p1HandVisualMsg.id;
  game.p2HandVisualMessageId = p2HandVisualMsg.id;

  const p1DiscardCount = (game.player1CcDiscard || []).length;
  const p2DiscardCount = (game.player2CcDiscard || []).length;
  const p1DiscardMsg = await p1PlayArea.send({
    embeds: [getDiscardPileEmbed(p1DiscardCount)],
    components: [getDiscardPileButtons(gameId, 1, false)],
  });
  const p2DiscardMsg = await p2PlayArea.send({
    embeds: [getDiscardPileEmbed(p2DiscardCount)],
    components: [getDiscardPileButtons(gameId, 2, false)],
  });
  game.p1DiscardPileMessageId = p1DiscardMsg.id;
  game.p2DiscardPileMessageId = p2DiscardMsg.id;

  const p1ActivationsMsg = await p1PlayArea.send(getActivationsLine(p1Total, p1Total));
  const p2ActivationsMsg = await p2PlayArea.send(getActivationsLine(p2Total, p2Total));
  game.p1ActivationsMessageId = p1ActivationsMsg.id;
  game.p2ActivationsMessageId = p2ActivationsMsg.id;

  for (const { dcName, displayName, healthState } of p1Dcs) {
    const { embed, files } = await buildDcEmbedAndFiles(dcName, false, displayName, healthState);
    const msg = await p1PlayArea.send({ embeds: [embed], files });
    dcMessageMeta.set(msg.id, { gameId, playerNum: 1, dcName, displayName });
    dcExhaustedState.set(msg.id, false);
    dcHealthState.set(msg.id, healthState);
    const p1Components = getDcPlayAreaComponents(msg.id, false, game, dcName);
    await msg.edit({ components: p1Components });
    game.p1DcMessageIds.push(msg.id);
    // Attachments: only create when DC has attachments; create on demand in updateAttachmentMessageForDc
    game.p1DcAttachmentMessageIds.push(null);
    game.p1DcCompanionMessageIds.push(null);
  }
  for (const { dcName, displayName, healthState } of p2Dcs) {
    const { embed, files } = await buildDcEmbedAndFiles(dcName, false, displayName, healthState);
    const msg = await p2PlayArea.send({ embeds: [embed], files });
    dcMessageMeta.set(msg.id, { gameId, playerNum: 2, dcName, displayName });
    dcExhaustedState.set(msg.id, false);
    dcHealthState.set(msg.id, healthState);
    const p2Components = getDcPlayAreaComponents(msg.id, false, game, dcName);
    await msg.edit({ components: p2Components });
    game.p2DcMessageIds.push(msg.id);
    // Attachments: only create when DC has attachments; create on demand in updateAttachmentMessageForDc
    game.p2DcAttachmentMessageIds.push(null);
    game.p2DcCompanionMessageIds.push(null);
  }

}

// applySquadSubmission – delegated to src/game-creation.js
function applySquadSubmission(game, isP1, squad, client) {
  return _applySquadSubmission(game, isP1, squad, client, {
    logGameAction, getHandTooltipEmbed, createPlayAreaChannelsFn: createPlayAreaChannels,
    createBoardChannelFn: createBoardChannel, buildBoardMapPayload, discordCatch,
    populatePlayAreas, COLORS, getDetermineInitiativeButtons, saveGames,
  });
}

// setupServer – delegated to src/game-creation.js
function setupServer(guild) {
  return _setupServer(guild, { CATEGORIES, CHANNELS, GAME_TAGS });
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    const botmenu = new SlashCommandBuilder()
      .setName('botmenu')
      .setDescription('Open Bot Stuff menu (Archive, Kill Game). Use in the Game Log channel of a game.');
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
          .addStringOption((o) => o.setName('figure').setDescription('Figure key, e.g. Stormtrooper (Regular)-1-0').setRequired(true))
          .addStringOption((o) =>
            o.setName('type').setDescription('Token type').setRequired(true).addChoices(
              { name: 'Hit (Damage)', value: 'Hit' },
              { name: 'Surge', value: 'Surge' },
              { name: 'Block', value: 'Block' },
              { name: 'Evade', value: 'Evade' },
              { name: 'Wild', value: 'Wild' },
            )
          )
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a Power Token from a figure')
          .addStringOption((o) => o.setName('figure').setDescription('Figure key').setRequired(true))
          .addIntegerOption((o) => o.setName('index').setDescription('Which token to remove (1 or 2)').setMinValue(1).setMaxValue(2).setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName('list')
          .setDescription('List figures with Power Tokens')
      );
    const movefigure = new SlashCommandBuilder()
      .setName('move-figure')
      .setDescription('Manually move a figure to any coordinate (bypasses movement rules). Use in Game Log channel.')
      .addStringOption((o) => o.setName('figure').setDescription('Figure key, e.g. Nexu (Regular)-1-0').setRequired(true))
      .addStringOption((o) => o.setName('coord').setDescription('Destination coordinate, e.g. m10').setRequired(true));
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: [
        botmenu.toJSON(), statcheck.toJSON(), powertoken.toJSON(), movefigure.toJSON(),
        affiliationwinrateglobal.toJSON(), affiliationwinratepersonal.toJSON(),
        affiliationpickrateglobal.toJSON(), affiliationpickratepersonal.toJSON(),
        dcwinrateglobaltopten.toJSON(), dcwinratepersonaltopten.toJSON(),
        leaderboard.toJSON(), achievements.toJSON(),
      ],
    });
    console.log('Slash commands registered: /botmenu, /statcheck, /power-token, /move-figure, /affiliationwinrateglobal, /affiliationwinratepersonal, /affiliationpickrateglobal, /affiliationpickratepersonal, /dcwinrateglobaltopten, /dcwinratepersonaltopten, /leaderboard, /achievements');
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

  // Local HTTP endpoint to create a test game from Cursor/terminal (no need to type in #lfg)
  const guildId = process.env.DISCORD_GUILD_ID;
  const port = Number(process.env.TESTGAME_PORT) || 3999;
  if (guildId) {
    createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/testgame') {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = body ? JSON.parse(body) : {};
          const userId = data.userId || process.env.TESTGAME_USER_ID;
          const scenarioId = data.scenarioId || null;
          if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing userId (set in body or TESTGAME_USER_ID)' }));
            return;
          }
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          if (!guild) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Guild not found' }));
            return;
          }
          await guild.channels.fetch();
          const lfg = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === 'lfg');
          if (!lfg) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '#lfg channel not found' }));
            return;
          }
          const player2Id = data.player2Id || undefined;
          const { gameId } = await createTestGame(client, guild, userId, scenarioId, lfg, { player2Id });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ gameId, message: 'Test game created. Check #lfg in Discord.' }));
        } catch (err) {
          console.error('POST /testgame error:', err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Test game creation failed' }));
        }
      });
    }).listen(port, '127.0.0.1', () => {
      console.log(`Testgame HTTP: POST http://127.0.0.1:${port}/testgame (body: { "userId?", "scenarioId?", "player2Id?" }, or set TESTGAME_USER_ID)`);
    });
  }
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

  // .vsav file upload in Player Hand channel
  const vsavAttach = message.attachments?.find((a) => a.name?.toLowerCase().endsWith('.vsav'));
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
          await message.reply('Could not parse that .vsav file. Make sure it was exported from the IACP List Builder.');
          return;
        }
        const squadName = vsavAttach.name
          ? vsavAttach.name.replace(/\.vsav$/i, '').replace(/^IA List \[[^\]]+\] - /, '').trim()
          : 'From .vsav';
        const squad = {
          name: squadName || 'From .vsav',
          dcList: parsed.dcList,
          ccList: parsed.ccList,
          dcCount: parsed.dcList.length,
          ccCount: parsed.ccList.length,
        };
        normalizeSquadInput(squad);
        const validation = validateDeckLegal(squad);
        await applySquadSubmission(game, isP1, squad, message.client);
        if (!validation.legal) {
          const errorList = validation.errors.map((e) => `• ${e}`).join('\n');
          await message.reply(`✓ Squad **${squad.name}** submitted from .vsav (${squad.dcCount} DCs, ${squad.ccCount} CCs)\n\n⚠️ **Heads up** — the bot detected possible issues with this list:\n${errorList}\n\nIf the bot is wrong here, ignore this message!`);
        } else {
          await message.reply(`✓ Squad **${squad.name}** submitted from .vsav (${squad.dcCount} DCs, ${squad.ccCount} CCs)`);
        }
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
        await applySquadSubmission(game, isP1, squad, message.client);
        if (!validation.legal) {
          const errorList = validation.errors.map((e) => `• ${e}`).join('\n');
          await message.reply(`✓ Squad **${squad.name}** submitted from pasted list (${squad.dcCount} DCs, ${squad.ccCount} CCs)\n\n⚠️ **Heads up** — the bot detected possible issues with this list:\n${errorList}\n\nIf the bot is wrong here, ignore this message!`);
        } else {
          await message.reply(`✓ Squad **${squad.name}** submitted from pasted list (${squad.dcCount} DCs, ${squad.ccCount} CCs)`);
        }
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
  if (prev) await prev.catch(() => {});
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
              getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, id)
            );
            const components = getDcPlayAreaComponents(id, exhausted, game, meta.dcName);
            await msg.edit({ embeds: [embed], files, components }).catch(err => console.error('[refresh:dc-embed]', id, err?.message ?? err));
          } catch (err) { console.error('[refresh:dc-embed] fetch failed', id, err?.message ?? err); }
        }
      } catch (err) { console.error('[refresh:dc-embeds] channel fetch failed', channelId, err?.message ?? err); }
    })();
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
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
      await interaction.reply({
        content: '**Bot Stuff** — Choose an action:',
        components: [getBotmenuButtons(gameByChannel.gameId)],
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
    if (buttonKey === 'request_resolve_') {
      await handleRequestResolve(interaction, { logGameErrorToBotLogs });
      return;
    }
    if (buttonKey === 'request_reject_') {
      await handleRequestReject(interaction, { logGameErrorToBotLogs });
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    const modalKey = getHandlerKey(interaction.customId, 'modal');
    if (!modalKey) return;
    const _modalLockId = resolveGameIdForLock(interaction);
    await withGameLock(_modalLockId, async () => {
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
        const { logs: kryknaLogs2, damageEvents: kryknaEvt2 } = runNpcKryknaActivation(game2, mapId2, { getMapTokensData, getMapSpaces, getMapRegistry, filterMapSpacesByBounds });
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
      if (!renameMeta) { await interaction.reply({ content: 'DC not found.', ephemeral: true }).catch(() => {}); return; }
      const renameGame = getGame(renameMeta.gameId);
      if (!renameGame) { await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
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
      await interaction.reply({ content: 'Figures renamed!', ephemeral: true }).catch(() => {});
      saveGames();
    }
    }); // end withGameLock (modal)
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const selectKey = getHandlerKey(interaction.customId, 'select');
    if (!selectKey) return;
    const _selectLockId = resolveGameIdForLock(interaction);
    await withGameLock(_selectLockId, async () => {
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
    if (selectKey === 'arsenal_pick_') {
      const arsenalCtx = {
        getGame, dcMessageMeta, getDcStats, getDcEffects, getMapSpaces, saveGames, replyIfGameEnded,
        getFigureSize, getFootprintCells, getRange, hasLineOfSight, FIGURE_LETTERS,
      };
      await handleArsenalPick(interaction, arsenalCtx);
      return;
    }
    if (selectKey === 'map_selection_draw_' || selectKey === 'map_selection_pick_') {
      const setupChoiceContext = {
        getGame,
        getPlayReadyMaps,
        getMissionCardsData,
        getMapRegistry,
        getMapTypeButtons,
        getMapConfirmButton,
        getMissionSelectDrawMenu,
        getMissionSelectionPickMenu,
        postPinnedMissionCardFromGameState,
        isDcAttachment,
        resolveDcName,
        isFigurelessDc,
        finishSetupAttachments,
        client,
        saveGames,
      };
      if (selectKey === 'map_selection_draw_') await handleMapSelectionDraw(interaction, setupChoiceContext);
      else if (selectKey === 'map_selection_pick_') await handleMapSelectionPick(interaction, setupChoiceContext);
      return;
    }
    if (selectKey === 'setup_attach_to_') {
      const setupSelectContext = {
        getGame,
        updateAttachmentMessageForDc,
        getCcShuffleDrawButton,
        clearPreGameSetup,
        getInitiativePlayerZoneLabel,
        logGameAction,
        client,
        saveGames,
        finishSetupAttachments,
        dcHealthState,
        dcMessageMeta,
      };
      await handleSetupAttachTo(interaction, setupSelectContext);
      return;
    }
    const ccHandSelectContext = {
      getGame,
      dcMessageMeta,
      dcHealthState,
      getCcEffect,
      getCommandCardImagePath,
      buildHandDisplayPayload,
      updateAttachmentMessageForDc,
      updateHandVisualMessage,
      updateDiscardPileMessage,
      logGameAction,
      saveGames,
      isCcAttachment,
      isCcPlayableNow,
      isCcPlayLegalByRestriction,
      getIllegalCcPlayButtons,
      getNegationResponseButtons,
      client,
      resolveAbility,
      pushUndo,
      getBoardStateForMovement,
      getSpaceChoiceRows,
      buildSpaceSelectMenu,
      getMapAttachmentForSpaces,
      buildBoardMapPayload,
    };
    if (selectKey === 'cc_attach_to_') await handleCcAttachTo(interaction, ccHandSelectContext);
    else if (selectKey === 'cc_play_select_') await handleCcPlaySelect(interaction, ccHandSelectContext);
    else if (selectKey === 'cc_discard_select_') await handleCcDiscardSelect(interaction, ccHandSelectContext);

    // Space-select overflow adapters: rewrite customId as if it were a button click, then delegate.
    const SPACE_SEL_MAP = {
      'overwatch_space_sel_': 'overwatch_space_',
      'pounce_space_sel_': 'pounce_space_',
      'false_orders_space_sel_': 'false_orders_space_',
      'rush_push_space_sel_': 'rush_push_space_',
      'cc_space_sel_': 'cc_space_',
    };
    if (SPACE_SEL_MAP[selectKey]) {
      const space = interaction.values?.[0];
      if (!space) return;
      const suffix = interaction.customId.slice(selectKey.length);
      // Reconstruct button-style customId: buttonPrefix + suffix + _ + space
      interaction.customId = `${SPACE_SEL_MAP[selectKey]}${suffix}_${space}`;
      await interaction.deferUpdate().catch(discordCatch);
      // Re-dispatch as button
      const fakeButtonKey = SPACE_SEL_MAP[selectKey];
      if (fakeButtonKey === 'overwatch_space_' || fakeButtonKey === 'pounce_space_' || fakeButtonKey === 'false_orders_space_' || fakeButtonKey === 'rush_push_space_') {
        const dcPlayAreaContext = {
          getGame,
          replyIfGameEnded,
          saveGames,
          pushUndo,
          client,
          dcMessageMeta,
          dcExhaustedState,
          dcHealthState,
          buildDcEmbedAndFiles,
          getConditionsForDcMessage,
          getDcPlayAreaComponents,
          getDcActionButtons,
          getActionsCounterContent,
          getActivationMinimapAttachment,
          updateActivationsMessage,
          getActivateDcButtons,
          DC_ACTIONS_PER_ACTIVATION,
          ACTION_ICONS,
          getDcStats,
          getDcEffects,
          resolveDcName,
          isFigurelessDc,
          resolveAbility,
          logGameAction,
          getBoardStateForMovement,
          buildLetterRows,
          getMoveSpaceGridRows,
          getSpaceChoiceRows,
          buildSpaceSelectMenu,
          getMapAttachmentForSpaces,
          buildBoardMapPayload,
          FIGURE_LETTERS,
          getFigureSize,
          getFootprintCells,
          getRange,
          hasLineOfSight,
          getMapSpaces,
          updateHandVisualMessage,
          updateDiscardPileMessage,
        };
        if (fakeButtonKey === 'overwatch_space_') await handleOverwatchSpacePick(interaction, dcPlayAreaContext);
        else if (fakeButtonKey === 'pounce_space_') await handlePounceSpacePick(interaction, dcPlayAreaContext);
        else if (fakeButtonKey === 'false_orders_space_') await handleFalseOrdersMovePick(interaction, dcPlayAreaContext);
        else if (fakeButtonKey === 'rush_push_space_') await handleRushPushSpace(interaction, dcPlayAreaContext);
      } else if (fakeButtonKey === 'cc_space_') {
        await handleCcSpacePick(interaction, ccHandSelectContext);
      }
      return;
    }
    }); // end withGameLock (select)
    return;
  }

  if (!interaction.isButton()) return;
  const buttonKey = getHandlerKey(interaction.customId, 'button');
  if (!buttonKey) return;
  await interaction.deferUpdate().catch(discordCatch);

  const _buttonLockId = resolveGameIdForLock(interaction);
  await withGameLock(_buttonLockId, async () => {

    // ── Table-driven dispatch ─────────────────────────────────────────
    // Build the shared dependencies bag once per interaction.
    const allDeps = {
      // Core state
      getGame, setGame, saveGames, deleteGame, deleteGameFromDb,
      dcMessageMeta, dcExhaustedState, dcHealthState, pendingIllegalSquad,
      client,

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
      reduceHp, healHp, awardKillVp, awardObjectiveVp, deductVp,

      // Data loader (imported)
      getDcEffects, getDiceData, getCcEffect, isCcAttachment, isDcAttachment,
      isDcUnique, getMapSpaces, getMapRegistry, getMapTokensData,
      getTournamentRotation, getMissionRules, resolveDcName, isFigurelessDc,

      // Discord UI (imported)
      logGameAction, getInitiativePlayerZoneLabel,
      getHandTooltipEmbed, getHandSquadButtons, getMapSelectionTooltipEmbed,
      getMoveMpButtonRows, getMoveSpaceGridRows, buildLetterRows,
      getSpaceChoiceRows, buildSpaceSelectMenu, getActionsCounterContent,
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
      sendRoundActivationPhaseMessage, runStartOfRoundDcEffects,
      buildDiscardPileDisplayPayload, updateDiscardPileMessage,
      updateAttachmentMessageForDc, updateDcActionsMessage,
      buildDcEmbedAndFiles, getConditionsForDcMessage, getDcPlayAreaComponents,
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
      postDevaronDoorButtons, postDevaronCratePushPrompts, postKryknaPushButtons,
      getSpaceController, shouldShowEndActivationPhaseButton, getPlayReadyMaps,
      postMissionCardAfterMapSelection, postPinnedMissionCardFromGameState,
      clearPreGameSetup, getDeployFigureLabels, getDeployButtonRows,
      getDeploymentMapAttachment, filterValidTopLeftSpaces,
      updateDeployPromptMessages, finishSetupAttachments,
      createPlayAreaChannels, createBoardChannel, createHandThreads,
      refreshAllGameComponents, applyDirectDamageToFigure,
      getMissionTokenLabel, countActiveGamesForPlayer, sendDeckIllegalAlert,
      runDraftRandom, getRange, hasLineOfSight,
      getDeploymentZones,
      // Combat special effects deps
      calculateKillVp, decrementActivationIfGroupDefeated,
      getDcUpgradeAttachments, getFigureLabel,
      filterCondition, isConditionImmune,
      applyCondition: _applyCondition, HARMFUL_CONDITIONS,

      // Lobby
      lobbies: getLobbiesMap(),
      createGameChannels,
    };

    // Look up handler and context group from the dispatch table
    const _handler = getHandler(buttonKey);
    if (_handler) {
      const _group = getHandlerGroup(buttonKey);
      if (_group) {
        const _ctx = buildContext(_group, allDeps);
        await _handler(interaction, _ctx);
      } else {
        await _handler(interaction);
      }
      return;
    }

    // ── Local handlers (non-combat closures over index.js scope) ──
    const LOCAL_HANDLERS = {
      'create_game': async (i) => {
        await i.followUp({ content: 'Go to **#new-games** and click **Create Post** to start a lobby. The bot will add the Join Game button.', components: [getMainMenu()], ephemeral: true }).catch(discordCatch);
      },
      'join_game': async (i) => {
        await i.followUp({ content: 'Browse **#new-games** and click **Join Game** on a lobby post that needs an opponent.', components: [getMainMenu()], ephemeral: true }).catch(discordCatch);
      },
    };
    const localHandler = LOCAL_HANDLERS[buttonKey];
    if (localHandler) {
      await localHandler(interaction);
      return;
    }


  }); // end withGameLock (button)

  } catch (err) {
    console.error('Interaction error:', err);
    const guild = interaction?.guild;
    const gameId = extractGameIdFromInteraction(interaction);
    const messageLink = guild?.id && interaction?.channelId && interaction?.message?.id
      ? { guildId: guild.id, channelId: interaction.channelId, messageId: interaction.message.id }
      : undefined;
    await logGameErrorToBotLogs(interaction.client, guild, gameId, err, 'interactionCreate', { messageLink });
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

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});

if (process.argv.includes('--test-movement')) {
  runMovementTests()
    .then((code) => process.exit(code || 0))
    .catch((err) => { console.error(err); process.exit(1); });
} else {
  client.login(process.env.DISCORD_TOKEN);
}
