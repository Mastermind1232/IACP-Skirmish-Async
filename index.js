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
async function applyNpcDamageToFigure(game, playerNum, figureKey, damage, sourceLabel, logGameAction, client, dcHealthState, dcMessageMeta) {
  const dcName = dcNameFromFigureKey(figureKey);
  const { dgIndex, figureIndex } = parseFigureKey(figureKey);

  // Locate the DC message for this figure
  let msgId = null;
  for (const [mid, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
    const dn = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    if (meta.dcName === dcName && dn && String(dn[1]) === String(dgIndex)) { msgId = mid; break; }
  }

  if (msgId) {
    const { newHp, maxHp, wasDefeated } = reduceHp(dcHealthState, game, msgId, figureIndex, damage, playerNum);
    if (dcHealthState.get(msgId)?.[figureIndex]) {
      if (wasDefeated) {
        removeFigurePosition(game, playerNum, figureKey);
        const oppPN = opponentPlayerNum(playerNum);
        const vp = calculateKillVp(dcName);
        awardKillVp(game, oppPN, vp);
        await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** was defeated! +${vp} VP to Player ${oppPN}.`, { phase: 'ROUND', icon: 'attack' });
      } else {
        await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** suffered **${damage} damage** (${newHp}/${maxHp} HP remaining).`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  } else {
    await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** suffered **${damage} damage** (HP not found in memory — update DC card manually).`, { phase: 'ROUND', icon: 'attack' });
  }
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
  if (!msgId) return;
  const figMatch = figKey.match(/-\d+-(\d+)$/);
  const figIdx = figMatch ? parseInt(figMatch[1], 10) : 0;
  const { newHp, wasDefeated } = reduceHp(dcHealthState, game, msgId, figIdx, damage, playerNum);
  const figName = dcNameFromFigureKey(figKey);
  if (thread) await thread.send(`**${sourceName}** — ${figName} suffers **${damage} Damage**.`).catch(discordCatch);
  const dcIds = getDcMessageIds(game, playerNum);
  const dcList = getDcList(game, playerNum);
  const idx = (dcIds || []).indexOf(msgId);
  if (wasDefeated && idx >= 0) {
    removeFigurePosition(game, playerNum, figKey);
    // VP goes to the opponent (the one dealing the damage)
    const oppPN = opponentPlayerNum(playerNum);
    const vp = calculateKillVp(dcList[idx]?.dcName);
    awardKillVp(game, oppPN, vp);
    if (thread) await thread.send(`**${sourceName}** — ${figName} was **defeated**! +${vp} VP.`).catch(discordCatch);
    await checkWinConditions(game, client);
  }
}

/** Remove a specific condition from a figure. No-op if figure or condition not found. */
const filterCondition = _filterCondition;
const isConditionImmune = _isConditionImmune;
const HARMFUL_CONDITIONS = _HARMFUL_CONDITIONS;

/** Send a Bleeding damage prompt to the given channel. Offers "Take 1 damage" or "Prevent (discard CC)". */
async function sendBleedingPrompt(game, channel, figureKey, playerNum, displayName) {
  const deckKey = ccDeckKey(playerNum);
  const deckCount = (game[deckKey] || []).length;
  const acceptBtn = new ButtonBuilder()
    .setCustomId(`bleed_accept_${game.gameId}_${playerNum}_${figureKey}`)
    .setLabel('Take 1 damage')
    .setStyle(ButtonStyle.Danger);
  const preventBtn = new ButtonBuilder()
    .setCustomId(`bleed_prevent_${game.gameId}_${playerNum}_${figureKey}`)
    .setLabel(`Prevent (discard CC, ${deckCount} left)`)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(deckCount === 0);
  const row = new ActionRowBuilder().addComponents(acceptBtn, preventBtn);
  await channel.send({
    content: `🩸 **Bleeding** — **${displayName}** suffers 1 damage after resolving their action. Take damage or discard top CC to prevent?`,
    components: [row],
  }).catch(discordCatch);
}

/** Check if a Figurehead-capable figure is available to intercept damage for targetFigureKey. Returns { figureKey, msgId, figIndex, label } or null. */
function findFigureheadFigure(game, defenderPlayerNum, targetFigureKey) {
  if (!game.selectedMap?.id) return null;
  const targetPos = game.figurePositions?.[defenderPlayerNum]?.[targetFigureKey];
  if (!targetPos) return null;
  const dcList = getDcList(game, defenderPlayerNum);
  if (!dcList) return null;
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    if (!dc) continue;
    const dcName = dc.dcName;
    const eff = getDcEffect(dcName);
    if (!(eff?.specialAbilityIds || []).includes('figurehead')) continue;
    const figures = game.figurePositions?.[defenderPlayerNum] || {};
    for (const [fk, pos] of Object.entries(figures)) {
      if (fk === targetFigureKey) continue;
      if (dcNameFromFigureKey(fk) !== dcName) continue;
      if (!isWithinN(pos, targetPos, 4, game.selectedMap.id)) continue;
      const msgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, fk);
      const { figureIndex: figIndex } = parseFigureKey(fk);
      return { figureKey: fk, msgId, figIndex, label: dc.displayName || dcName };
    }
  }
  return null;
}

/** Resolve combat after rolls (and optional surge). Applies damage, VP, updates embeds/board, clears pendingCombat. */
async function resolveCombatAfterRolls(game, combat, client) {
  // Beatdown / nextAttacksBonusHits: consume one charge and add bonus to this attack
  const pending = game.nextAttacksBonusHits?.[combat.attackerPlayerNum];
  if (pending && pending.count > 0 && pending.bonus > 0) {
    combat.bonusHits = (combat.bonusHits || 0) + pending.bonus;
    pending.count -= 1;
    if (pending.count <= 0) delete game.nextAttacksBonusHits[combat.attackerPlayerNum];
  }
  // Size Advantage / nextAttacksBonusConditions: consume and add conditions to defender
  const condPending = game.nextAttacksBonusConditions?.[combat.attackerPlayerNum];
  if (condPending && condPending.count > 0 && condPending.conditions?.length) {
    combat.bonusConditions = combat.bonusConditions || [];
    combat.bonusConditions.push(...condPending.conditions);
    condPending.count -= 1;
    if (condPending.count <= 0) delete game.nextAttacksBonusConditions[combat.attackerPlayerNum];
  }
  const defenderPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
  const roundBlock = game.roundDefenseBonusBlock?.[defenderPlayerNum] || 0;
  const roundEvade = game.roundDefenseBonusEvade?.[defenderPlayerNum] || 0;
  if (roundBlock) combat.bonusBlock = (combat.bonusBlock || 0) + roundBlock;
  if (roundEvade) combat.bonusEvade = (combat.bonusEvade || 0) + roundEvade;
  const perEvade = game.roundDefenderBonusBlockPerEvade?.[defenderPlayerNum] || 0;
  if (perEvade && combat.defenseRoll) combat.bonusBlock = (combat.bonusBlock || 0) + (combat.defenseRoll.evade || 0) * perEvade;
  // Harsh Environment: exterior spaces -1 Evade; interior spaces +1 Block (applied once per combat resolution)
  if (game.harshEnvironmentActive && !combat.harshEnvApplied) {
    const _heMapId = game.selectedMap?.id;
    const _heMsData = _heMapId ? getMapSpaces(_heMapId) : null;
    const _heFigKey = combat.target?.figureKey;
    const _hePos = _heFigKey ? (game.figurePositions?.[defenderPlayerNum]?.[_heFigKey]) : null;
    if (_heMsData && _hePos) {
      combat.harshEnvApplied = true;
      const _heExterior = !!_heMsData.exterior?.[_hePos];
      if (_heExterior) {
        combat.bonusEvade = (combat.bonusEvade || 0) - 1;
        await logGameAction(game, client, `\u26A1 **Harsh Environment** \u2014 **${combat.target.label}** on exterior space: \u22121 Evade.`, { phase: 'ROUND', icon: 'attack' });
      } else {
        combat.bonusBlock = (combat.bonusBlock || 0) + 1;
        await logGameAction(game, client, `\u26A1 **Harsh Environment** \u2014 **${combat.target.label}** on interior space: +1 Block.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Cavalry Charge: round TROOPER attack hit bonus
  const trooperHitBonus = game.roundTrooperAttackHitBonus?.[combat.attackerPlayerNum] || 0;
  if (trooperHitBonus) {
    const attackerEff = getDcEffect(combat.attackerDcName);
    const attackerKws = (attackerEff?.keywords || []).map((k) => String(k).toUpperCase());
    if (attackerKws.includes('TROOPER')) combat.bonusHits = (combat.bonusHits || 0) + trooperHitBonus;
  }
  // Query (HK-47): if +1 Hit was applied but defender became Bleeding from surges, remove the bonus
  if (combat.queryBonusHitApplied && (combat.surgeConditions || []).includes('Bleed')) {
    combat.bonusHits = Math.max(0, (combat.bonusHits || 0) - 1);
    combat.queryBonusHitApplied = false;
    await logGameAction(game, client, '**Query** — +1 Hit removed (defender became Bleeding).', { phase: 'ROUND', icon: 'attack' });
  }
  let { hit, damage, resultText } = computeCombatResult(combat);
  const totalBlast = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
  const attackerPlayerNum = combat.attackerPlayerNum;
  // Store target + adjacent spaces for Reduce to Rubble (only when attack hit)
  if (hit && game.selectedMap?.id) {
    const targetCoord = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
    if (targetCoord) {
      const board = getBoardStateForMovement(game, null);
      if (board?.adjacency) {
        const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
        const targetSize = getEffectiveFigureSize(game, combat.target.figureKey, targetDcName);
        const targetCells = getFootprintCells(targetCoord, targetSize || '1x1').map((c) => normalizeCoord(c));
        const rubbleSet = new Set(targetCells);
        for (const c of targetCells) {
          for (const n of board.adjacency[c] || []) rubbleSet.add(normalizeCoord(n));
        }
        game.lastAttackTargetSpacesForRubble = [...rubbleSet];
        game.lastAttackAttackerPlayerNum = attackerPlayerNum;
      }
    }
  }
  const ownerId = getPlayerId(game, attackerPlayerNum);
  const targetMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, combat.target.figureKey);
  const { figureIndex: targetFigIndex } = parseFigureKey(combat.target.figureKey);

  // Figurehead (Murne Rin): before friendly figure suffers damage, may redirect to self (prevent 1)
  if (damage > 0 && hit) {
    const fhResult = findFigureheadFigure(game, defenderPlayerNum, combat.target.figureKey);
    if (fhResult) {
      const fhOwnerId = getPlayerId(game, defenderPlayerNum);
      const fhThread = await client.channels.fetch(combat.combatThreadId);
      game.pendingFigurehead = {
        damage, hit, resultText, totalBlast,
        defenderPlayerNum, attackerPlayerNum, ownerId,
        targetMsgId, targetFigIndex,
        fhFigKey: fhResult.figureKey, fhMsgId: fhResult.msgId, fhFigIndex: fhResult.figIndex,
        fhLabel: fhResult.label,
      };
      await fhThread.send({
        content: `<@${fhOwnerId}> — **Figurehead**: **${combat.target.label}** is about to suffer **${damage} damage**. Murne Rin suffers **${Math.max(0, damage - 1)} damage** instead (prevents 1)?`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`figurehead_use_${game.gameId}`).setLabel('Use Figurehead').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`figurehead_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary),
        )],
        allowedMentions: { users: [fhOwnerId] },
      });
      return;
    }
  }
  await applyDamageAndFinishCombat(game, combat, { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client);
}

/** Apply damage, conditions, defeat logic, and finish combat resolution. Called from resolveCombatAfterRolls and handleFigureheadDecision. */
async function applyDamageAndFinishCombat(game, combat, { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client) {
  const thread = await client.channels.fetch(combat.combatThreadId);
  // Store last attack metadata for post-attack CC effect handlers
  game.lastAttackAttackerMsgId = combat.attackerMsgId ?? null;
  game.lastAttackAttackerFigureIndex = combat.attackerFigureIndex ?? 0;
  game.lastAttackTargetFigureKey = combat.target?.figureKey ?? null;
  // Track that an attack was performed during this activation (for On a Diplomatic Mission, etc.)
  if (combat.attackerMsgId) {
    game.attackPerformedThisActivation = game.attackPerformedThisActivation || {};
    game.attackPerformedThisActivation[combat.attackerMsgId] = true;
  }

  // NPC target (thug / Krykna / Crate): apply damage directly, skip dcHealthState
  if (combat.target?.isNpc) {
    // Crate target (Devaron B)
    if (combat.target.npcType === 'crate') {
      const origCoord = combat.target.crateOrigCoord;
      if (origCoord && game.cratePositions?.[origCoord] !== undefined) {
        game.crateHealth = game.crateHealth || {};
        if (typeof game.crateHealth[origCoord] !== 'number') game.crateHealth[origCoord] = 5;
        if (damage > 0 && hit) {
          game.crateHealth[origCoord] = Math.max(0, game.crateHealth[origCoord] - damage);
          const curCoord = String(game.cratePositions[origCoord] || origCoord).toUpperCase();
          resultText += ` — Crate @ ${curCoord}: ${game.crateHealth[origCoord]}/5 HP remaining.`;
          if (game.crateHealth[origCoord] <= 0) {
            resultText += ` **Crate DESTROYED! Adjacent figures suffer 2 Damage.**`;
            const curCoordLow = String(game.cratePositions[origCoord] || origCoord).toLowerCase();
            delete game.cratePositions[origCoord];
            await logGameAction(game, client, `💥 Crate at **${curCoord}** destroyed! All adjacent figures suffer 2 Damage.`, { phase: 'ROUND', icon: 'attack' });
            for (const pn of [1, 2]) {
              for (const figKey of getFiguresOnOrAdjacentToSpace(game, pn, curCoordLow, 'devaron-garrison')) {
                await applyNpcDamageToFigure(game, pn, figKey, 2, 'Crate explosion', logGameAction, client, dcHealthState, dcMessageMeta);
              }
            }
            await checkWinConditions(game, client);
          }
        }
      }
      await thread.send({ content: resultText || '(No effect)', components: [] });
      saveGames();
      return;
    }
    // Thug / Krykna
    const npcArray = combat.target.npcType === 'thug' ? game.npcThugs : game.npcKrykna;
    const npc = npcArray?.[combat.target.npcIndex];
    if (npc && !npc.defeated) {
      if (damage > 0 && hit) {
        npc.hp = Math.max(0, npc.hp - damage);
        resultText += ` — ${combat.target.label}: ${npc.hp}/${npc.maxHp} HP remaining.`;
        if (npc.hp <= 0) {
          npc.defeated = true;
          awardKillVp(game, attackerPlayerNum, 2);
          resultText += ` **${combat.target.label} defeated! +2 VP**`;
          // Krykna claim: track on game state for end-of-round deploy option
          if (combat.target.npcType === 'krykna') {
            game.claimedKrykna = game.claimedKrykna || { 1: 0, 2: 0 };
            game.claimedKrykna[attackerPlayerNum] = (game.claimedKrykna[attackerPlayerNum] || 0) + 1;
          }
          await logGameAction(game, client, `<@${ownerId}> defeated **${combat.target.label}** (+2 VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
          await checkWinConditions(game, client);
        }
      }
    }
    await thread.send({ content: resultText || '(No effect)', components: [] });
    saveGames();
    return;
  }

  // Track figures damaged by this group's activation (for Aim: Rebel Trooper Elite, etc.)
  if (damage > 0 && combat.attackerMsgId && combat.target?.figureKey) {
    game.activationDamagedFigures = game.activationDamagedFigures || {};
    game.activationDamagedFigures[combat.attackerMsgId] = game.activationDamagedFigures[combat.attackerMsgId] || [];
    if (!game.activationDamagedFigures[combat.attackerMsgId].includes(combat.target.figureKey)) {
      game.activationDamagedFigures[combat.attackerMsgId].push(combat.target.figureKey);
    }
  }

  let _fdNeedsEmbedRefresh = false;
  if (damage > 0 && targetMsgId) {
    let { newHp: newCur } = reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, damage, defenderPlayerNum);
    if (dcHealthState.get(targetMsgId)?.[targetFigIndex]) {
      // Achievement: Devastator (10+ damage in a single attack)
      if (damage >= 10 && isDbConfigured() && achievementsChannelId) {
        const _devUserId = getPlayerId(game, attackerPlayerNum);
        checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, _devUserId, 'single_attack_damage', damage)
          .catch((err) => console.error('[Achievements] Devastator check failed:', err.message));
      }
      const dcMessageIds = getDcMessageIds(game, defenderPlayerNum);
      const dcList = getDcList(game, defenderPlayerNum);
      const idx = (dcMessageIds || []).indexOf(targetMsgId);
      let allConditions = [...(combat.surgeConditions || []), ...(combat.bonusConditions || [])];
      // Condition Immunity: filter out harmful conditions for immune figures
      if (allConditions.length && isConditionImmune(game, combat.target.figureKey)) {
        const blocked = allConditions.filter((c) => HARMFUL_CONDITIONS.includes(c));
        allConditions = allConditions.filter((c) => !HARMFUL_CONDITIONS.includes(c));
        if (blocked.length) {
          await logGameAction(game, client, `**Condition Immunity** — **${combat.target.label}** is immune to ${blocked.join(', ')}.`, { phase: 'ROUND', icon: 'card' });
        }
      }
      for (const _ac of allConditions) _applyCondition(game, combat.target.figureKey, _ac);
      // Furious Charge: if defender's player played this CC, and suffered >= threshold damage, grant Focus
      if (game.conditionalFocusIfDamagedGte?.playerNum === defenderPlayerNum && damage >= game.conditionalFocusIfDamagedGte.threshold) {
        if (_applyCondition(game, combat.target.figureKey, 'Focus')) {
          await logGameAction(game, client, `**Furious Charge** — **${combat.target.label}** is now **Focused** (suffered ${damage} Damage).`, { phase: 'ROUND', icon: 'card' });
        }
        game.conditionalFocusIfDamagedGte = null;
      }
      // Stun Batons (Riot Trooper E/R): after attack, if target suffered damage, target suffers 1 Strain
      if (damage > 0) {
        const _sbAttDcName = combat.attackerDcName || '';
        const _sbAttEff = getDcEffects()?.[_sbAttDcName];
        if ((_sbAttEff?.passives || []).includes('Stun Batons')) {
          // Flame Trooper Fireproof: cannot suffer Strain
          const _sbTargetUpgrades = game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || [];
          if (_sbTargetUpgrades.includes('Flame Trooper')) {
            await logGameAction(game, client, `**Fireproof** — **${combat.target.label}** is immune to Strain from Stun Batons.`, { phase: 'ROUND', icon: 'card' });
          } else {
          game.figureConditions = game.figureConditions || {};
          game.figureConditions[combat.target.figureKey] = game.figureConditions[combat.target.figureKey] || [];
          // Strain = 1 direct HP damage (apply via health reduction)
          const _sbResult = reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
          newCur = _sbResult.newHp;
          await logGameAction(game, client, `⚡ **Stun Batons** — **${combat.target.label}** suffers 1 Strain (1 HP damage).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Self-Preservation (Hired Gun Elite): when you suffer damage, become Focused
      if (newCur > 0) {
        const _spDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _spEff = getDcEffects()?.[_spDcName];
        if ((_spEff?.passives || []).includes('Self-Preservation')) {
          if (_applyCondition(game, combat.target.figureKey, 'Focus')) {
            await logGameAction(game, client, `🛡️ **Self-Preservation** — **${_spDcName}** became **Focused** (suffered damage).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Fury of Kashyyyk (army-wide): when a friendly WOOKIEE suffers 3+ damage and survives, become Focused
      if (damage >= 3 && newCur > 0) {
        const _fokDefDcList = getDcList(game, defenderPlayerNum) || [];
        const _fokHasFury = _fokDefDcList.some(dc => dc.dcName === '[Fury of Kashyyyk]');
        if (_fokHasFury) {
          const _fokTargetName = dcNameFromFigureKey(combat.target.figureKey);
          const _fokTargetKws = (getDcKeywords()[_fokTargetName] || []).map(k => String(k).toUpperCase());
          if (_fokTargetKws.includes('WOOKIEE')) {
            if (_applyCondition(game, combat.target.figureKey, 'Focus')) {
              await logGameAction(game, client, `**Fury of Kashyyyk** — **${_fokTargetName}** became **Focused** (suffered ${damage} Damage).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
      }
      // Guerilla (Rebel Pathfinder E/R, Alliance Ranger E): after attack, if defender defeated, attacker becomes Hidden
      if (newCur <= 0) {
        const _guerAttEff = getDcEffects()?.[combat.attackerDcName];
        if ((_guerAttEff?.abilityText || '').includes('Guerilla') || (_guerAttEff?.abilityText || '').includes('guerilla')) {
          if (_applyCondition(game, combat.attackerFigureKey, 'Hide')) {
            await logGameAction(game, client, `🥷 **Guerilla** — **${combat.attackerDcName}** became **Hidden** (defender defeated).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Jets (Sabine Wren): after attack, if target within 2 spaces, gain 1 MP
      if (combat.attackerDcName === 'Sabine Wren' && combat.distanceToTarget != null && combat.distanceToTarget <= 2) {
        const _jetsMsgId = combat.attackerMsgId;
        if (_jetsMsgId && game.movementBank?.[_jetsMsgId]) {
          game.movementBank[_jetsMsgId].total = (game.movementBank[_jetsMsgId].total || 0) + 1;
          game.movementBank[_jetsMsgId].remaining = (game.movementBank[_jetsMsgId].remaining || 0) + 1;
          await logGameAction(game, client, `🚀 **Jets** — **Sabine Wren** gains 1 MP (target within 2 spaces).`, { phase: 'ROUND', icon: 'attack' });
        }
      }
      // Fly-By (Jet Trooper Elite): after attack, gain 2 MP if target was within 2 spaces
      {
        const _fbAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_fbAtkEff?.passives || []).includes('Fly-By') && combat.distanceToTarget != null && combat.distanceToTarget <= 2) {
          const _fbMsgId = combat.attackerMsgId;
          if (_fbMsgId) {
            grantMovementBank(game, _fbMsgId, 2);
            await logGameAction(game, client, `🚀 **Fly-By** — **${combat.attackerDcName}** gains 2 MP (target within 2 spaces).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Jets (Jet Trooper Regular): after attack, gain 1 MP if target within 2 spaces
      {
        const _jtAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_jtAtkEff?.passives || []).includes('Jets') && combat.distanceToTarget != null && combat.distanceToTarget <= 2) {
          const _jtMsgId = combat.attackerMsgId;
          if (_jtMsgId) {
            grantMovementBank(game, _jtMsgId, 1);
            await logGameAction(game, client, `🚀 **Jets** — **${combat.attackerDcName}** gains 1 MP (target within 2 spaces).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Leg Hydraulics (Tress Hacnua): handled via specialAbilityIds check below (not passives) to avoid double-granting
      // Locked and Loaded (Migs Mayfeld): after attack, gain 2 Power Tokens (max 3 total)
      {
        const _llAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_llAtkEff?.passives || []).includes('Locked and Loaded')) {
          const _llFk = combat.attackerFigureKey;
          if (_llFk) {
            game.figurePowerTokens = game.figurePowerTokens || {};
            game.figurePowerTokens[_llFk] = game.figurePowerTokens[_llFk] || [];
            const _llCurrent = game.figurePowerTokens[_llFk].length;
            const _llGain = Math.min(2, 3 - _llCurrent);
            if (_llGain > 0) {
              game.pendingPowerTokenGrant = { grants: [{ figureKey: _llFk, figName: combat.attackerDcName, count: _llGain }], channelId: combat.combatThreadId, playerNum: attackerPlayerNum };
              const _llBtns = ['Hit', 'Surge', 'Block', 'Evade'].map(t =>
                new ButtonBuilder().setCustomId(`power_token_choice_${game.gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary)
              );
              await thread.send({
                content: `🔫 **Locked and Loaded** — **${combat.attackerDcName}** gains ${_llGain} Power Token${_llGain > 1 ? 's' : ''} (${_llCurrent} → ${_llCurrent + _llGain}, max 3). Choose type:`,
                components: [new ActionRowBuilder().addComponents(_llBtns)],
              }).catch(discordCatch);
            } else {
              await logGameAction(game, client, `🔫 **Locked and Loaded** — **${combat.attackerDcName}** already at max 3 Power Tokens; no tokens gained.`, { phase: 'ROUND', icon: 'attack' });
            }
          }
        }
      }
      // Open-Minded (Del Meeko): after attack, gain 1 MP or 1 Power Token (choice)
      {
        const _omAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_omAtkEff?.passives || []).includes('Open-Minded')) {
          const _omMsgId = combat.attackerMsgId;
          const _omFk = combat.attackerFigureKey;
          if (_omMsgId && _omFk) {
            const _omBtns = [
              new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${_omMsgId}_openminded_mp`).setLabel('Gain 1 MP').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${_omMsgId}_openminded_token`).setLabel('Gain 1 Power Token').setStyle(ButtonStyle.Secondary),
            ];
            await thread.send({
              content: `🧠 **Open-Minded** — **${combat.attackerDcName}**: Choose one:`,
              components: [new ActionRowBuilder().addComponents(_omBtns)],
            }).catch(discordCatch);
          }
        }
      }
      // Nimble (Asajj Ventress): after attack resolves, defender gains 2 MP per Block result
      {
        const _nimDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _nimEff = getDcEffects()?.[_nimDcName];
        if ((_nimEff?.specialAbilityIds || []).includes('nimble_asajj') && combat.defenseRoll) {
          const _nimTotalBlock = combat.defenseRoll.block || 0;
          if (_nimTotalBlock > 0) {
            const _nimMp = _nimTotalBlock * 2;
            const _nimMsgId = targetMsgId;
            if (_nimMsgId) {
              grantMovementBank(game, _nimMsgId, _nimMp);
            }
            await logGameAction(game, client, `🦎 **Nimble** — **${_nimDcName}** gained ${_nimMp} MP (${_nimTotalBlock} Block result${_nimTotalBlock !== 1 ? 's' : ''} × 2).`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
          }
        }
      }
      // Slippery (Alliance Smuggler E/R): after attack resolves, defender gains 2 MP
      {
        const _slipDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _slipEff = getDcEffects()?.[_slipDcName];
        if ((_slipEff?.specialAbilityIds || []).some(id => id === 'slippery_smuggler_elite' || id === 'slippery_smuggler_reg')) {
          const _slipMsgId = targetMsgId;
          if (_slipMsgId) {
            grantMovementBank(game, _slipMsgId, 2);
          }
          await logGameAction(game, client, `🏃 **Slippery** — **${_slipDcName}** gains 2 MP after being attacked.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
        }
      }
      // Leg Hydraulics (Tress Hacnua): after resolving an attack, attacker gains 1 MP
      {
        const _lhAtkDcName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey);
        const _lhEff = getDcEffects()?.[_lhAtkDcName];
        if ((_lhEff?.specialAbilityIds || []).includes('leg_hydraulics_tress') && combat.attackerMsgId) {
          grantMovementBank(game, combat.attackerMsgId, 1);
          await logGameAction(game, client, `🦿 **Leg Hydraulics** — **${_lhAtkDcName}** gains 1 MP after attacking.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
        }
      }
      // Loku Recon Token: Set Your Sights — after Loku's attack resolves, place recon token on target
      {
        const _lkAtkDcName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey);
        const _lkAtkEff = getDcEffects()?.[_lkAtkDcName];
        if ((_lkAtkEff?.specialAbilityIds || []).includes('set_your_sights_loku') && combat.target?.figureKey) {
          game.reconToken = { figureKey: combat.target.figureKey, playerNum: combat.attackerPlayerNum };
          await logGameAction(game, client, `🎯 **Set Your Sights** — Recon token placed on **${dcNameFromFigureKey(combat.target.figureKey)}**.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
        }
      }
      // Force Deflection (Yoda): after attack targeting Yoda or adjacent friendly REBEL resolves,
      // attacker suffers Damage = number of attack dice rolled. Limit once per round.
      {
        const _fdDefDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _fdDefEff = getDcEffects()?.[_fdDefDcName];
        const _fdDefIsTarget = (_fdDefEff?.specialAbilityIds || []).includes('force_deflection_yoda');
        let _fdYodaFigKey = null;
        if (_fdDefIsTarget) {
          // Yoda is the defender — use Yoda's own figure key for round tracking
          _fdYodaFigKey = combat.target.figureKey;
        } else {
          // Check if any Yoda figure on defender's team is adjacent to the target space AND defender is REBEL
          const _fdDefAffil = _fdDefEff?.affiliation || '';
          if (_fdDefAffil === 'Rebel') {
            const _fdFriendlyFigs = game.figurePositions?.[defenderPlayerNum] || {};
            const _fdTargetCoord = _fdFriendlyFigs[combat.target.figureKey];
            if (_fdTargetCoord) {
              for (const [fk, fCoord] of Object.entries(_fdFriendlyFigs)) {
                if (fk === combat.target.figureKey) continue;
                const fDcName = dcNameFromFigureKey(fk);
                const fEff = getDcEffects()?.[fDcName];
                if (!(fEff?.specialAbilityIds || []).includes('force_deflection_yoda')) continue;
                // Check adjacency (within 1 space)
                if (isWithinN(fCoord, _fdTargetCoord, 1, game.selectedMap?.id)) {
                  _fdYodaFigKey = fk;
                  break;
                }
              }
            }
          }
        }
        if (_fdYodaFigKey) {
          game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
          const _fdKey = `${_fdYodaFigKey}_force_deflection`;
          if (!game.roundFigureAbilityUsed[_fdKey]) {
            game.roundFigureAbilityUsed[_fdKey] = true;
            const _fdDiceCount = combat.attackDiceResults?.length || 0;
            if (_fdDiceCount > 0 && combat.attackerMsgId) {
              const _fdAtkFigIdx = combat.attackerFigureIndex ?? 0;
              const { newHp: _fdAtkNew, prevHp: _fdAtkPrev, wasDefeated: _fdAtkDefeated } = reduceHp(dcHealthState, game, combat.attackerMsgId, _fdAtkFigIdx, _fdDiceCount, attackerPlayerNum);
              if (_fdAtkPrev > 0) {
                _fdNeedsEmbedRefresh = true;
                const _fdYodaDcName = dcNameFromFigureKey(_fdYodaFigKey);
                await logGameAction(game, client, `🔵 **Force Deflection** — **${_fdYodaDcName}** deflects! **${combat.attackerDcName}** suffers **${_fdDiceCount} Damage** (${_fdDiceCount} attack dice rolled). HP: ${_fdAtkPrev} → ${_fdAtkNew}.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
                // Check if attacker was defeated by Force Deflection
                if (_fdAtkDefeated) {
                  removeFigurePosition(game, attackerPlayerNum, combat.attackerFigureKey);
                  if (game.figureConditions?.[combat.attackerFigureKey]) delete game.figureConditions[combat.attackerFigureKey];
                  const _fdAtkStats = getDcStats(combat.attackerDcName);
                  const _fdAtkEffects = getDcEffects()?.[combat.attackerDcName];
                  const _fdAtkFigures = _fdAtkStats?.figures ?? 1;
                  const _fdAtkVp = (_fdAtkFigures > 1 && _fdAtkEffects?.subCost != null) ? _fdAtkEffects.subCost : (_fdAtkStats?.cost ?? 5);
                  awardKillVp(game, defenderPlayerNum, _fdAtkVp);
                  await logGameAction(game, client, `**Force Deflection** — **${combat.attackerDcName}** was defeated! +${_fdAtkVp} VP to Player ${defenderPlayerNum}.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
                }
              }
            }
          }
        }
      }
      // You Will Not Deny Me: prevent Fifth Brother from being defeated (restore HP to 1)
      if (newCur <= 0 && game.youWillNotDenyMeActive?.playerNum === defenderPlayerNum) {
        const _ywndmDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        if (_ywndmDcName?.toLowerCase().includes('fifth')) {
          const { newHp: _ywndmNew } = healHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
          newCur = _ywndmNew;
          game.youWillNotDenyMeActive = null;
          await logGameAction(game, client, `**You Will Not Deny Me** — Fifth Brother cannot be defeated! HP restored to 1.`, { phase: 'ROUND', icon: 'card' });
        }
      }
      // Sustained by Rage (Maul): cannot be defeated if has not activated this round — set HP to 1
      let _sbrImmune = false;
      if (newCur <= 0) {
        const _sbrDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _sbrEff = getDcEffects()?.[_sbrDcName];
        if ((_sbrEff?.specialAbilityIds || []).includes('sustained_by_rage')) {
          const _sbrActivatedIndices = getActivatedDcIndices(game, defenderPlayerNum) || [];
          if (idx >= 0 && !_sbrActivatedIndices.includes(idx)) {
            _sbrImmune = true;
            const { newHp: _sbrNew } = healHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
            newCur = _sbrNew;
            await logGameAction(game, client, `**Sustained by Rage** — **${_sbrDcName}** cannot be defeated (has not activated this round)! HP set to 1.`, { phase: 'ROUND', icon: 'card' });
          }
        }
      }
      // Self-Destruct Protocol: pre-defeat interrupt — prompt owner to use ability before defeat
      if (newCur <= 0 && !game.selfDestructProtocolTriggered?.[targetMsgId]) {
        const _sdpDcName2 = idx >= 0 ? dcList?.[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _sdpEff2 = getDcEffects()?.[_sdpDcName2];
        if ((_sdpEff2?.specialAbilityIds || []).includes('self_destruct_protocol')) {
          game.selfDestructProtocolTriggered = game.selfDestructProtocolTriggered || {};
          game.selfDestructProtocolTriggered[targetMsgId] = true;
          game.pendingSelfDestruct = { targetMsgId, defenderPlayerNum, attackerPlayerNum, damage, hit, resultText, totalBlast, ownerId, targetFigIndex };
          const _sdpOwnerId2 = game[`player${defenderPlayerNum}Id`];
          const _sdpRow2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`self_destruct_protocol_use_${game.gameId}_${targetMsgId}`).setLabel('Use Self-Destruct').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`self_destruct_protocol_skip_${game.gameId}_${targetMsgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await logGameAction(game, client, `<@${_sdpOwnerId2}> **Self-Destruct Protocol** — **${combat.target.label || _sdpDcName2}** is about to be defeated! Roll 1 red die, apply Hits to adjacent figures, then the figure is defeated.`, { components: [_sdpRow2], allowedMentions: { users: [_sdpOwnerId2] } });
          saveGames();
          return;
        }
      }
      // Parting Shot (Greedo, Hired Gun): pre-defeat interrupt — may perform an attack before being defeated
      if (newCur <= 0 && !_sbrImmune && !game.partingShotTriggered?.[targetMsgId]) {
        const _psDcName = idx >= 0 ? dcList?.[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _psEff = getDcEffects()?.[_psDcName];
        const _psSIds = _psEff?.specialAbilityIds || [];
        const _psHas = _psSIds.some(id => id.startsWith('parting_shot_'));
        if (_psHas) {
          game.partingShotTriggered = game.partingShotTriggered || {};
          game.partingShotTriggered[targetMsgId] = true;
          const _psOwnerId = game[`player${defenderPlayerNum}Id`];
          await logGameAction(game, client, `<@${_psOwnerId}> ⚠️ **Parting Shot** — **${combat.target.label || _psDcName}** is about to be defeated! You may interrupt to perform an attack before defeat. Use the DC's Attack action to fire your parting shot, then click End Turn to proceed with defeat.`, { allowedMentions: { users: [_psOwnerId] } });
        }
      }
      // Last Resort (Skirmish Upgrade): pre-defeat interrupt — roll 1 red die, adjacent figures suffer Hits as damage
      if (newCur <= 0 && !_sbrImmune && !game.lastResortTriggered?.[targetMsgId]) {
        const _lrUpgrades = game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || [];
        if (_lrUpgrades.includes('Last Resort')) {
          game.lastResortTriggered = game.lastResortTriggered || {};
          game.lastResortTriggered[targetMsgId] = true;
          game.pendingLastResort = { targetMsgId, defenderPlayerNum, attackerPlayerNum, damage, hit, resultText, totalBlast, ownerId, targetFigIndex };
          const _lrOwnerId = game[`player${defenderPlayerNum}Id`];
          const _lrRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`last_resort_use_${game.gameId}_${targetMsgId}`).setLabel('Use Last Resort').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`last_resort_skip_${game.gameId}_${targetMsgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await logGameAction(game, client, `<@${_lrOwnerId}> **Last Resort** — **${combat.target.label}** is about to be defeated! Deplete to roll 1 red die — adjacent figures suffer Hits as Damage.`, { components: [_lrRow], allowedMentions: { users: [_lrOwnerId] } });
          saveGames();
          return;
        }
      }
      if (newCur <= 0 && !_sbrImmune && !(game.youWillNotDenyMeActive?.playerNum === defenderPlayerNum && ((idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey))?.toLowerCase().includes('fifth')))) {
        // F7: Keep healthState, figurePositions, and DC embed in sync when one figure in a group dies.
        removeFigurePosition(game, defenderPlayerNum, combat.target.figureKey);
        if (game.figureConditions?.[combat.target.figureKey]) delete game.figureConditions[combat.target.figureKey];
        const vp = calculateKillVp(targetDcName);
        const _vpK = vpKey(attackerPlayerNum);
        awardKillVp(game, attackerPlayerNum, vp);
        // Achievement: activation kill streak (Double Kill / Triple Kill / PENTAKILL)
        if (combat.attackerMsgId) {
          game.activationKills = game.activationKills || {};
          game.activationKills[combat.attackerMsgId] = (game.activationKills[combat.attackerMsgId] || 0) + 1;
          if (isDbConfigured() && achievementsChannelId) {
            const _akUserId = getPlayerId(game, attackerPlayerNum);
            checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, _akUserId, 'activation_kills', game.activationKills[combat.attackerMsgId])
              .catch((err) => console.error('[Achievements] activation_kills check failed:', err.message));
          }
        }
        // Of No Importance: reduce VP gained when CC owner's own non-unique figure is defeated
        if (game.nextDefeatedFriendlyVpReduction?.playerNum === defenderPlayerNum) {
          const _noImportDcName = idx >= 0 ? dcList[idx]?.dcName : null;
          if (_noImportDcName && !isDcUnique(_noImportDcName)) {
            const _reduceAmt = game.nextDefeatedFriendlyVpReduction.amount || 0;
            const _reduced = Math.min(_reduceAmt, vp);
            game[_vpK].kills = Math.max(0, game[_vpK].kills - _reduced);
            game[_vpK].total = Math.max(0, game[_vpK].total - _reduced);
            resultText += ` (−${_reduced} VP: Of No Importance)`;
            await logGameAction(game, client, `**Of No Importance** — VP reduced by ${_reduced}.`, { phase: 'ROUND', icon: 'card' });
          }
          game.nextDefeatedFriendlyVpReduction = null;
        }
        // Price on Their Heads: award bounty VP to setter when target group is defeated
        const _priceBounty = game.priceBounties?.[combat.target.label];
        if (_priceBounty) {
          const _bountyAmt = typeof _priceBounty === 'object' ? _priceBounty.amount : _priceBounty;
          const _bountySetterNum = typeof _priceBounty === 'object' ? _priceBounty.playerNum : attackerPlayerNum;
          awardObjectiveVp(game, _bountySetterNum, _bountyAmt);
          delete game.priceBounties[combat.target.label];
          const _bountyVpK = vpKey(_bountySetterNum);
          await logGameAction(game, client, `**Price on Their Heads** — +${_bountyAmt} VP bounty awarded to P${_bountySetterNum} (${game[_bountyVpK].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // Paid in Beskar: grant Block tokens when hostile is defeated within range
        if (game.whenDefeatHostileWithin3GainBlockTokens) {
          const _beskarData = game.whenDefeatHostileWithin3GainBlockTokens;
          const _beskarDist = combat.distanceToTarget ?? 0;
          const _beskarRange = _beskarData.range ?? 3;
          if (_beskarDist <= _beskarRange) {
            const _beskarTokens = _beskarData.tokens ?? 1;
            const _beskarFigKey = combat.attackerFigureKey;
            grantPowerTokens(game, _beskarFigKey, 'Block', _beskarTokens);
            await logGameAction(game, client, `**Paid in Beskar** — +${_beskarTokens} Block Token${_beskarTokens !== 1 ? 's' : ''} granted to ${combat.attackerDisplayName}.`, { phase: 'ROUND', icon: 'card' });
          }
          game.whenDefeatHostileWithin3GainBlockTokens = null;
        }
        // Worth Every Credit: bonus VP when hostile is defeated this activation
        if (game.nextHostileDefeatVpBonus?.[attackerPlayerNum]) {
          const _wecData = game.nextHostileDefeatVpBonus[attackerPlayerNum];
          const _wecAmt = typeof _wecData === 'object' ? (_wecData.amount ?? 2) : _wecData;
          awardObjectiveVp(game, attackerPlayerNum, _wecAmt);
          delete game.nextHostileDefeatVpBonus[attackerPlayerNum];
          await logGameAction(game, client, `**Worth Every Credit** — +${_wecAmt} bonus VP (${game[_vpK].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // You Will Not Deny Me: prevent Fifth Brother defeat; on any hostile defeat recover 2 HP
        if (game.youWillNotDenyMeActive) {
          const _ywndmData = game.youWillNotDenyMeActive;
          const _fifthKey = Object.keys(game.figurePositions?.[_ywndmData.playerNum] || {}).find(k => dcNameFromFigureKey(k).toLowerCase() === 'fifth brother' || dcNameFromFigureKey(k) === 'fifth-brother');
          if (_fifthKey) {
            const _fifthMsgId = (() => { for (const [mid, mm] of dcMessageMeta) { if (mm.playerNum === _ywndmData.playerNum && mm.dcName?.toLowerCase().includes('fifth')) return mid; } return null; })();
            if (_fifthMsgId) {
              const { healed: _fifthHealed } = healHp(dcHealthState, game, _fifthMsgId, 0, 2, _ywndmData.playerNum);
              if (_fifthHealed > 0) {
                await logGameAction(game, client, `**You Will Not Deny Me** — Fifth Brother recovered 2 HP after hostile defeat.`, { phase: 'ROUND', icon: 'card' });
              }
              game.youWillNotDenyMeActive = null;
            }
          }
        }
        // Apex Predator: recover HP when a hostile within range is defeated this activation
        if (game.recoverOnHostileDefeat?.[attackerPlayerNum]) {
          const _apData = game.recoverOnHostileDefeat[attackerPlayerNum];
          const _apRange = _apData.range ?? 2;
          const _apDist = combat.distanceToTarget ?? 0;
          if (_apDist <= _apRange) {
            const _apMsgId = _apData.msgId ?? combat.attackerMsgId;
            const _apAmt = _apData.amount ?? 2;
            if (_apMsgId) {
              const _apFigIdx = combat.attackerFigureIndex ?? 0;
              const { healed: _apHealed } = healHp(dcHealthState, game, _apMsgId, _apFigIdx, _apAmt, attackerPlayerNum);
              if (_apHealed > 0) {
                await logGameAction(game, client, `**Apex Predator** — Recovered ${_apAmt} HP after defeating hostile within ${_apRange}.`, { phase: 'ROUND', icon: 'card' });
              }
            }
          }
          delete game.recoverOnHostileDefeat[attackerPlayerNum];
        }
        // Last Stand (Stormtrooper Elite): when defeated, another figure in the group becomes Focused
        const _lsDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _lsEff = getDcEffects()?.[_lsDcName];
        if ((_lsEff?.passives || []).includes('Last Stand')) {
          const _lsDgMatch = (combat.target.figureKey || '').match(/-(\d+)-\d+$/);
          const _lsDgIdx = _lsDgMatch ? _lsDgMatch[1] : '1';
          const _lsPrefix = `${_lsDcName}-${_lsDgIdx}-`;
          const _lsAlive = Object.keys(game.figurePositions?.[defenderPlayerNum] || {}).filter(k => k.startsWith(_lsPrefix) && k !== combat.target.figureKey);
          if (_lsAlive.length > 0) {
            const _lsTarget = _lsAlive[0];
            if (_applyCondition(game, _lsTarget, 'Focus')) {
              const _lsName = dcNameFromFigureKey(_lsTarget);
              await logGameAction(game, client, `⚡ **Last Stand** — **${_lsName}** becomes **Focused** (another figure in the group was defeated).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
        // Nefarious Gains (Jabba): when a hostile figure is defeated, Jabba's owner gains 1 VP
        const _jabbaOwner = attackerPlayerNum; // attacker defeated the hostile, so Jabba must be on attacker's side
        for (const pn of [1, 2]) {
          if (pn === defenderPlayerNum) continue; // Jabba's owner must be the one who defeated someone
          const _jabbaOnBoard = Object.keys(game.figurePositions?.[pn] || {}).some(fk => fk.startsWith('Jabba the Hutt-'));
          if (_jabbaOnBoard) {
            const vpObj = game[vpKey(pn)];
            if (vpObj) {
              vpObj.total = (vpObj.total || 0) + 1;
              vpObj.objectives = (vpObj.objectives || 0) + 1;
            }
            await logGameAction(game, client, `💰 **Nefarious Gains** — **Jabba the Hutt** gains 1 VP (hostile defeated). P${pn} VP: ${vpObj?.total ?? 0}`, { phase: 'ROUND', icon: 'card' });
          }
        }
        // Into the Force (Obi-Wan): when defeated, a friendly figure becomes Focused
        if (_lsDcName === 'Obi-Wan Kenobi') {
          const _obiAlive = Object.keys(game.figurePositions?.[defenderPlayerNum] || {}).filter(k => !k.startsWith('Obi-Wan Kenobi-'));
          if (_obiAlive.length > 0) {
            const _obiTarget = _obiAlive[0];
            if (_applyCondition(game, _obiTarget, 'Focus')) {
              const _obiName = dcNameFromFigureKey(_obiTarget);
              await logGameAction(game, client, `✨ **Into the Force** — **${_obiName}** becomes **Focused** (Obi-Wan was defeated).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
        // Vengeance (Royal Guard Regular): when adjacent friendly non-GUARDIAN defeated, become Focused
        {
          const _defPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
          if (_defPos) {
            const _defDcEff = getDcEffects()?.[_lsDcName];
            const _defKws = (_defDcEff?.keywords || []).map(k => k.toUpperCase());
            const _defIsGuardian = _defKws.includes('GUARDIAN');
            if (!_defIsGuardian) {
              const _ms = getMapSpaces(game.selectedMap?.id);
              const _defAdj = (_ms?.adjacency?.[String(_defPos).toLowerCase()] || []).map(a => String(a).toLowerCase());
              for (const [rgFk, rgPos] of Object.entries(game.figurePositions?.[defenderPlayerNum] || {})) {
                if (!rgPos || rgFk === combat.target.figureKey) continue;
                if (!_defAdj.includes(String(rgPos).toLowerCase())) continue;
                const rgDcName = dcNameFromFigureKey(rgFk);
                if (rgDcName !== 'Royal Guard (Regular)' && rgDcName !== 'Royal Guard (Elite)') continue;
                if (_applyCondition(game, rgFk, 'Focus')) {
                  const vLabel = rgDcName === 'Royal Guard (Elite)' ? 'Forward Vengeance' : 'Vengeance';
                  await logGameAction(game, client, `⚔️ **${vLabel}** — **${rgDcName}** becomes **Focused** (adjacent friendly defeated).`, { phase: 'ROUND', icon: 'card' });
                }
              }
            }
          }
        }
        // This is the Way (The Armorer): when attacker defeats defender, attacker gains 1 Block Token
        {
          const _armorerOnBoard = Object.keys(game.figurePositions?.[attackerPlayerNum] || {}).some(fk => fk.startsWith('The Armorer-'));
          if (_armorerOnBoard) {
            const _armorerGranted = grantPowerTokens(game, combat.attackerFigureKey, 'Block', 1, 2);
            if (_armorerGranted > 0) {
              await logGameAction(game, client, `🛡️ **This is the Way** — **${combat.attackerDcName}** gains 1 **Block Token** (defeated hostile).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
        // Bounty (Fennec Shand): when defeated, opponent (= attacker) gains 2 VP
        {
          const _bountyDcName = _lsDcName;
          const _bountyEff = getDcEffects()?.[_bountyDcName];
          if ((_bountyEff?.passives || []).includes('Bounty')) {
            awardObjectiveVp(game, attackerPlayerNum, 2);
            const _bountyVpK2 = vpKey(attackerPlayerNum);
            await logGameAction(game, client, `💰 **Bounty** — **${_bountyDcName}** was defeated. Opponent (P${attackerPlayerNum}) gains **2 VP** (${game[_bountyVpK2].total} total).`, { phase: 'ROUND', icon: 'card' });
          }
        }
        // Brutal Tactics (Saw Gerrerra): when a hostile figure is defeated, each hostile within 3 of that figure becomes Weakened
        {
          const _btPlayerNum = attackerPlayerNum; // attacker's side has Saw
          const _btAllFigs = Object.keys(game.figurePositions?.[_btPlayerNum] || {});
          const _btHasSaw = _btAllFigs.some(fk => {
            const dcN = dcNameFromFigureKey(fk);
            return (getDcEffects()?.[dcN]?.passives || []).includes('Brutal Tactics');
          });
          if (_btHasSaw) {
            // defeated figure's position
            const _btDefPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey || ''];
            if (_btDefPos) {
              const _btEnemyPos = game.figurePositions?.[defenderPlayerNum] || {};
              let _btWeakened = 0;
              for (const [fk, pos] of Object.entries(_btEnemyPos)) {
                if (!pos || fk === (combat.target.figureKey || '')) continue;
                const dist = getRange(_btDefPos, pos);
                if (dist <= 3) {
                  if (isConditionImmune(game, fk)) continue; // Condition Immunity: skip Weaken
                  if (_applyCondition(game, fk, 'Weaken')) {
                    _btWeakened++;
                  }
                }
              }
              if (_btWeakened > 0) {
                await logGameAction(game, client, `⚔️ **Brutal Tactics** — ${_btWeakened} hostile figure${_btWeakened !== 1 ? 's' : ''} within 3 spaces of the defeated figure became **Weakened**.`, { phase: 'ROUND', icon: 'card' });
              }
            }
          }
        }
        resultText += ` — **${combat.target.label} defeated!** +${vp} VP`;
        await logGameAction(game, client, `<@${ownerId}> defeated **${combat.target.label}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
        if (idx >= 0) {
          await decrementActivationIfGroupDefeated(game, defenderPlayerNum, idx, client);
          const ccAttachKey = ccAttachmentsKey(defenderPlayerNum);
          if (game[ccAttachKey]?.[targetMsgId]?.length) {
            delete game[ccAttachKey][targetMsgId];
            await updateAttachmentMessageForDc(game, defenderPlayerNum, targetMsgId, client);
          }
        }
        await checkWinConditions(game, client);
        // Celebration: after unique hostile defeated, offer attacker a chance to play it
        const defeatedDcName = idx >= 0 ? dcList[idx]?.dcName : null;
        if (isDcUnique(defeatedDcName)) {
          game.pendingCelebration = { attackerPlayerNum, combatThreadId: combat.combatThreadId };
          await thread.send({
            content: `<@${ownerId}> — You defeated a unique figure. Play **Celebration** to gain 4 VP?`,
            components: [getCelebrationButtons(game.gameId)],
            allowedMentions: { users: [ownerId] },
          }).catch(discordCatch);
        }
        // Auto-prompt for defeat-triggered reaction cards
        try {
          const ccCards = getCcEffectsData?.()?.cards || {};
          const _defeatTimings = new Set([
            'whenHostileFigureDefeatedNotYourActivation',
            'whenHostileFigureWithin3SpacesDefeated',
            'afterUniqueHostileDefeated',
          ]);
          const _ownDefeatTimings = new Set([
            'whenOneOfYourFiguresDefeated',
          ]);
          // Notify attacker about hostile-defeat reactions in hand
          const atkHand = getCcHand(game, attackerPlayerNum) || [];
          const atkDefeatCards = [...new Set(atkHand)].filter(c => ccCards[c]?.timing && _defeatTimings.has(ccCards[c].timing));
          if (atkDefeatCards.length) {
            await thread.send({ content: `<@${ownerId}> — Hostile defeated! You have ${atkDefeatCards.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [ownerId] } }).catch(() => {});
          }
          // Notify defender about own-figure-defeat reactions in hand
          const defId = getPlayerId(game, defenderPlayerNum);
          const defHand = getCcHand(game, defenderPlayerNum) || [];
          const defDefeatCards = [...new Set(defHand)].filter(c => ccCards[c]?.timing && _ownDefeatTimings.has(ccCards[c].timing));
          if (defDefeatCards.length) {
            await thread.send({ content: `<@${defId}> — Your figure was defeated! You have ${defDefeatCards.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [defId] } }).catch(() => {});
          }
        } catch (_defeatPromptErr) {
          console.error('Defeat reaction prompt error:', _defeatPromptErr?.message ?? _defeatPromptErr);
        }
      }
    }
    // Sustained by Rage: block recovery for figures with this passive
    const _sbrBlockRecover = getDcEffects()?.[combat.attackerDcName]?.specialAbilityIds?.includes('sustained_by_rage');
    if (combat.surgeRecover > 0 && combat.attackerMsgId != null && !_sbrBlockRecover) {
      healHp(dcHealthState, game, combat.attackerMsgId, combat.attackerFigureIndex ?? 0, combat.surgeRecover || 0, combat.attackerPlayerNum);
    }
    if (combat.superchargeStrainAfterAttackCount > 0 && combat.attackerMsgId != null) {
      reduceHp(dcHealthState, game, combat.attackerMsgId, combat.attackerFigureIndex ?? 0, combat.superchargeStrainAfterAttackCount || 0, combat.attackerPlayerNum);
    }
    // The Darksaber: convert Blast X → Cleave X during Darksaber Strike attack (before blast applies)
    let effectiveBlast = totalBlast;
    if (combat.darksaberBlastToCleave && (combat.surgeBlast || 0) > 0) {
      combat.surgeCleave = (combat.surgeCleave || 0) + combat.surgeBlast;
      const _dsConvertedBlast = combat.surgeBlast;
      combat.surgeBlast = 0;
      effectiveBlast = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
      await logGameAction(game, client, `**The Darksaber** — Blast ${_dsConvertedBlast} converted to Cleave ${_dsConvertedBlast}.`, { phase: 'ROUND', icon: 'card' });
    }
    if (effectiveBlast > 0 && hit && damage > 0 && game.selectedMap?.id) {
      const adjacent = getFiguresAdjacentToTarget(game, combat.target.figureKey, game.selectedMap.id);
      for (const { figureKey: blastFigureKey, playerNum: blastPlayerNum } of adjacent) {
        // Flame Trooper Fireproof: own Blast does not affect friendly figures
        if (blastPlayerNum === attackerPlayerNum && _ftAtkUpgrades.includes('Flame Trooper')) continue;
        const blastMsgId = findDcMessageIdForFigure(game.gameId, blastPlayerNum, blastFigureKey);
        if (!blastMsgId) continue;
        const { figureIndex: blastFigIndex } = parseFigureKey(blastFigureKey);
        const { newHp: newBCur, wasDefeated: blastDefeated } = reduceHp(dcHealthState, game, blastMsgId, blastFigIndex, effectiveBlast, blastPlayerNum);
        const { dcList: blastDcList, idx: blastIdx } = lookupFigureDcIndex(game, blastPlayerNum, blastFigureKey);
        if (blastDefeated) {
          removeFigurePosition(game, blastPlayerNum, blastFigureKey);
          if (game.figureConditions?.[blastFigureKey]) delete game.figureConditions[blastFigureKey];
          const vp = calculateKillVp(blastDcList[blastIdx]?.dcName);
          awardKillVp(game, attackerPlayerNum, vp);
          // Achievement: count blast kills for activation streak
          if (combat.attackerMsgId) {
            game.activationKills = game.activationKills || {};
            game.activationKills[combat.attackerMsgId] = (game.activationKills[combat.attackerMsgId] || 0) + 1;
            if (isDbConfigured() && achievementsChannelId) {
              const _akUserId2 = getPlayerId(game, attackerPlayerNum);
              checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, _akUserId2, 'activation_kills', game.activationKills[combat.attackerMsgId])
                .catch((err) => console.error('[Achievements] blast activation_kills check failed:', err.message));
            }
          }
          const blastLabel = blastDcList[blastIdx]?.displayName || blastFigureKey;
          await logGameAction(game, client, `Blast: <@${ownerId}> defeated **${blastLabel}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
          if (blastIdx >= 0) {
            await decrementActivationIfGroupDefeated(game, blastPlayerNum, blastIdx, client);
            const blastCcAttachKey = ccAttachmentsKey(blastPlayerNum);
            if (game[blastCcAttachKey]?.[blastMsgId]?.length) {
              delete game[blastCcAttachKey][blastMsgId];
              await updateAttachmentMessageForDc(game, blastPlayerNum, blastMsgId, client);
            }
          }
          await checkWinConditions(game, client);
          const blastDefeatedDcName = blastDcList[blastIdx]?.dcName;
          if (!game.pendingCelebration && isDcUnique(blastDefeatedDcName)) {
            game.pendingCelebration = { attackerPlayerNum, combatThreadId: combat.combatThreadId };
            await thread.send({
              content: `<@${ownerId}> — You defeated a unique figure (Blast). Play **Celebration** to gain 4 VP?`,
              components: [getCelebrationButtons(game.gameId)],
              allowedMentions: { users: [ownerId] },
            }).catch(discordCatch);
          }
        }
      }
    }
  } else if (hit && damage === 0) {
    await logGameAction(game, client, `<@${ownerId}> attacked **${combat.target.label}** — blocked`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
  } else if (!hit) {
    await logGameAction(game, client, `<@${ownerId}> attacked **${combat.target.label}** — miss`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
  } else if (damage > 0) {
    await logGameAction(game, client, `<@${ownerId}> dealt **${damage}** damage to **${combat.target.label}**`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
  }
  // Discard consumed conditions post-combat
  if (combat.attackerFigureKey) {
    const _hadFocus = (game.figureConditions?.[combat.attackerFigureKey] || []).includes('Focus');
    filterCondition(game, combat.attackerFigureKey, 'Focus');  // Focus consumed after attacking
    if (_hadFocus) await logGameAction(game, client, `🎯 **Focus** consumed on **${combat.attackerDcName}** \u2014 used in this attack.`, { phase: 'ROUND', icon: 'attack' });
    const _atkHidden = (game.figureConditions?.[combat.attackerFigureKey] || []).includes('Hide');
    filterCondition(game, combat.attackerFigureKey, 'Hide');   // Attacker loses Hidden after resolving an attack
    if (_atkHidden) await logGameAction(game, client, `\uD83D\uDC7B **Hidden** removed from **${combat.attackerDcName}** \u2014 resolved an attack.`, { phase: 'ROUND', icon: 'attack' });
  }
  if (combat.target?.figureKey) {
    const _defHidden = (game.figureConditions?.[combat.target.figureKey] || []).includes('Hide');
    filterCondition(game, combat.target.figureKey, 'Hide');    // Defender loses Hidden after being attacked
    if (_defHidden) await logGameAction(game, client, `\uD83D\uDC7B **Hidden** removed from **${combat.target.label}** \u2014 was targeted by an attack.`, { phase: 'ROUND', icon: 'attack' });
  }
  // Burst Fire: apply Stun to all figures adjacent to target if target suffered damage
  if (game.burstFirePendingMsgId?.[combat.attackerMsgId]) {
    const _bfPending = game.burstFirePendingMsgId[combat.attackerMsgId];
    delete game.burstFirePendingMsgId[combat.attackerMsgId];
    if (damage > 0 && combat.target?.figureKey) {
      const _bfMapId = game.selectedMap?.id;
      const _bfMs = _bfMapId ? getMapSpaces(_bfMapId) : null;
      const _bfTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      if (_bfMs && _bfTargetPos) {
        // Collect all spaces adjacent to the target's footprint (handles multi-space figures)
        const _bfTargetDcName = dcNameFromFigureKey(combat.target.figureKey);
        const _bfTargetSize = getFigureSize(_bfTargetDcName) || '1x1';
        const _bfTargetCells = getFootprintCells(_bfTargetPos, _bfTargetSize);
        const _bfAdjSet = new Set();
        for (const _bfCell of _bfTargetCells) {
          for (const _bfA of (_bfMs.adjacency?.[_bfCell] || [])) _bfAdjSet.add(_bfA);
        }
        // Remove the target's own cells from adjacency
        for (const _bfCell of _bfTargetCells) _bfAdjSet.delete(_bfCell);
        for (const _bfPn of [1, 2]) {
          for (const [_bfFk, _bfPos] of Object.entries(game.figurePositions?.[_bfPn] || {})) {
            // Check if any cell of this figure's footprint is adjacent to the target
            const _bfFkDcName = dcNameFromFigureKey(_bfFk);
            const _bfFkSize = getFigureSize(_bfFkDcName) || '1x1';
            const _bfFkCells = getFootprintCells(_bfPos, _bfFkSize);
            if (!_bfFkCells.some(c => _bfAdjSet.has(c))) continue;
            if (_bfFk === combat.target.figureKey) continue;
            if (isConditionImmune(game, _bfFk)) continue; // Condition Immunity: skip Stun
            if (_applyCondition(game, _bfFk, 'Stun')) {
              const _bfDcName = dcNameFromFigureKey(_bfFk);
              await logGameAction(game, client, `\uD83D\uDCA5 **Burst Fire** \u2014 **${_bfDcName}** (adjacent) is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' });
            }
          }
        }
      }
    }
  }
  // Crippling Blow: Stun defender if attack didn't miss
  if (game.cripplingBlowPending?.[combat.attackerMsgId]) {
    delete game.cripplingBlowPending[combat.attackerMsgId];
    if (hit && combat.target?.figureKey) {
      if (!isConditionImmune(game, combat.target.figureKey)) {
        if (_applyCondition(game, combat.target.figureKey, 'Stun')) {
          await logGameAction(game, client, `⚡ **Crippling Blow** — **${combat.target.label || dcNameFromFigureKey(combat.target.figureKey)}** is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' });
        }
      } else {
        await logGameAction(game, client, `**Crippling Blow** — **${combat.target.label || dcNameFromFigureKey(combat.target.figureKey)}** is immune to Stun.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Disruptor Rifle: if attack didn't miss and defender at exactly 1 HP, deal 1 more damage
  if (game.disruptorRiflePending?.[combat.attackerMsgId]) {
    delete game.disruptorRiflePending[combat.attackerMsgId];
    if (hit && targetMsgId) {
      const _drHS = dcHealthState.get(targetMsgId) || [];
      const _drEntry = _drHS[targetFigIndex];
      if (_drEntry) {
        const [_drCur] = _drEntry;
        if (_drCur === 1) {
          reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
          await logGameAction(game, client, `💀 **Disruptor Rifle** — **${combat.target?.label || ''}** had 1 HP remaining — suffers 1 additional Damage and is **defeated**.`, { phase: 'ROUND', icon: 'attack' });
        }
      }
    }
  }
  // Tonfa Strike: grant second free attack after first resolves
  if (game.tonfaStrikeSecondAttack?.[combat.attackerMsgId]) {
    delete game.tonfaStrikeSecondAttack[combat.attackerMsgId];
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[combat.attackerMsgId] = true;
    await thread.send('**Tonfa Strike** — You may perform an additional attack (use Attack button).');
  }
  // Imperial Loadout post-attack effects
  if (combat.loadoutPostAttack) {
    const _lpa = combat.loadoutPostAttack;
    // Electro-pulse (Electrohammer): each other figure adjacent to target suffers 1 Damage
    if (_lpa === 'electro_pulse' && combat.target?.figureKey) {
      const _epTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      if (_epTargetPos) {
        const _epLines = [];
        for (const [pNum, poses] of [[1, game.figurePositions?.[1] || {}], [2, game.figurePositions?.[2] || {}]]) {
          for (const [fk, pos] of Object.entries(poses)) {
            if (fk === combat.target.figureKey) continue;
            if (getRange(pos, _epTargetPos) !== 1) continue;
            const _epFkDcName = dcNameFromFigureKey(fk);
            const _epMid = getDcMessageIds(game, pNum) || [];
            const _epDcL = getDcList(game, pNum);
            const { dgIndex: _epDgIdx, figureIndex: _epFigIdx } = parseFigureKey(fk);
            const _epMsgId = _epMid.find((mid, idx) => _epDcL?.[idx]?.dcName === _epFkDcName && _epDcL?.[idx]?.dgIndex === _epDgIdx);
            if (_epMsgId) {
              reduceHp(dcHealthState, game, _epMsgId, _epFigIdx, 1, pNum);
            }
            _epLines.push(`**${_epFkDcName}** suffers 1 Damage`);
          }
        }
        if (_epLines.length > 0) {
          await logGameAction(game, client, `⚡ **Electro-pulse** — Adjacent figures:\n${_epLines.join('\n')}`, { phase: 'ROUND', icon: 'attack' });
        }
      }
    }
    // Quick Strike (Electrostaff): if defender rerolled/modified dice, defender suffers 1 Damage
    if (_lpa === 'quick_strike' && hit && combat.target?.figureKey && targetMsgId) {
      const _qsModified = combat.defenderRerolledOrModified;
      if (_qsModified) {
        reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
        await logGameAction(game, client, `⚡ **Quick Strike** — Defender modified dice/results: **${combat.target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
    // Flurry of Blows (Electrobatons): free melee attack with 1 green die + +1 Hit, limit once per activation
    if (_lpa === 'flurry_of_blows' && hit && combat.attackerMsgId) {
      const _fobKey = `flurryOfBlows_${combat.attackerMsgId}`;
      if (!game.roundFigureAbilityUsed?.[_fobKey]) {
        if (!game.roundFigureAbilityUsed) game.roundFigureAbilityUsed = {};
        game.roundFigureAbilityUsed[_fobKey] = true;
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[combat.attackerMsgId] = true;
        game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
        game.pendingOverrideAttackDice[combat.attackerMsgId] = { dice: ['green'], type: 'melee', bonusHits: 1 };
        await thread.send('**Flurry of Blows** — You may perform a Melee attack using 1 green die (+1 Hit). Use the Attack button.');
      }
    }
  }
  // Clawdite Streetrat Assassin's Blade post-attack: choose an adjacent hostile, roll 1 red die, deal Hits
  if (combat.formPostAttack === 'assassins_blade' && combat.attackerFigureKey) {
    const _abAttackerPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    if (_abAttackerPos) {
      // Find adjacent hostile figures
      const _abAdjacentHostiles = [];
      for (const [_abFk, _abPos] of Object.entries(game.figurePositions?.[defenderPlayerNum] || {})) {
        if (!_abPos) continue;
        if (getRange(_abAttackerPos, _abPos) === 1) _abAdjacentHostiles.push({ fk: _abFk, pos: _abPos });
      }
      if (_abAdjacentHostiles.length === 0) {
        await thread.send(`🗡️ **Assassin's Blade** — No adjacent hostile figures.`).catch(discordCatch);
      } else {
        const _abDiceData = getDiceData();
        const _abRedFaces = _abDiceData?.attack?.red || [];
        if (_abRedFaces.length > 0) {
          const _abRoll = _abRedFaces[Math.floor(Math.random() * _abRedFaces.length)];
          const _abHits = (_abRoll.damage || 0);
          const _abRollStr = Object.entries(_abRoll).filter(([k,v]) => v > 0 && k !== 'blank').map(([k,v]) => `${v} ${k}`).join(', ') || 'blank';
          if (_abAdjacentHostiles.length === 1 && _abHits > 0) {
            // Auto-apply to the only adjacent hostile
            const { fk: _abFk2 } = _abAdjacentHostiles[0];
            const _abDcName = dcNameFromFigureKey(_abFk2);
            for (const [_abMsgId, _abMeta] of dcMessageMeta) {
              if (_abMeta.gameId !== game.gameId || _abMeta.playerNum !== defenderPlayerNum || _abMeta.dcName !== _abDcName) continue;
              const _abFigIdx = parseInt(_abFk2.split('-').pop(), 10) || 0;
              reduceHp(dcHealthState, game, _abMsgId, _abFigIdx, _abHits, defenderPlayerNum);
              break;
            }
            await thread.send(`🗡️ **Assassin's Blade** — Rolled 1 red die: **${_abRollStr}**. **${_abDcName}** suffers **${_abHits} Damage**.`).catch(discordCatch);
            await logGameAction(game, client, `🗡️ **Assassin's Blade** — **${_abDcName}** suffers **${_abHits} Damage**.`, { phase: 'ROUND', icon: 'attack' });
          } else if (_abHits > 0) {
            // Multiple adjacent hostiles — show picker buttons
            game.pendingAssassinsBlade = { hits: _abHits, rollStr: _abRollStr, defenderPlayerNum, attackerPlayerNum };
            const _abBtns = _abAdjacentHostiles.map(({ fk }) => {
              const name = dcNameFromFigureKey(fk);
              return new ButtonBuilder()
                .setCustomId(`ab_blade_pick_${game.gameId}_${fk}`)
                .setLabel(name)
                .setStyle(ButtonStyle.Danger);
            });
            const _abRows = [];
            for (let _r = 0; _r < _abBtns.length; _r += 5) _abRows.push(new ActionRowBuilder().addComponents(_abBtns.slice(_r, _r + 5)));
            await thread.send({ content: `🗡️ **Assassin's Blade** — Rolled 1 red die: **${_abRollStr}** (${_abHits} Damage). Choose an adjacent hostile figure:`, components: _abRows }).catch(discordCatch);
          } else {
            await thread.send(`🗡️ **Assassin's Blade** — Rolled 1 red die: **${_abRollStr}**. No hits.`).catch(discordCatch);
          }
        }
      }
    }
  }
  // Suppressive Fire (Skirmish Upgrade): exhaust after Ranged attack → Weaken target + 2 MP to SMALL friendly within 3
  const _sfUpgrades = combat.attackerMsgId ? (game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || []) : [];
  const _sfExh = game.exhaustedSkirmishUpgrades?.[combat.attackerMsgId] || [];
  if (_sfUpgrades.includes('Suppressive Fire') && !_sfExh.includes('Suppressive Fire') && combat.isRanged && damage > 0) {
    game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
    game.exhaustedSkirmishUpgrades[combat.attackerMsgId] = [..._sfExh, 'Suppressive Fire'];
    // Apply Weaken to the target
    const _sfTargetFk = combat.target?.figureKey;
    if (_sfTargetFk && !isConditionImmune(game, _sfTargetFk)) {
      _applyCondition(game, _sfTargetFk, 'Weaken');
    }
    const _sfTargetName = dcNameFromFigureKey(combat.target?.figureKey) || combat.defenderDcName;
    // Find SMALL friendly figures within 3 spaces of attacker for MP grant
    const _sfAttackerPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    const _sfSmallFriendlies = [];
    if (_sfAttackerPos) {
      const _sfEffects = getDcEffects();
      for (const [_sfFk, _sfPos] of Object.entries(game.figurePositions?.[attackerPlayerNum] || {})) {
        if (!_sfPos || _sfFk === combat.attackerFigureKey) continue;
        if (getRange(_sfAttackerPos, _sfPos) > 3) continue;
        // SMALL check: skip LARGE and MASSIVE figures
        const _sfDcName = dcNameFromFigureKey(_sfFk);
        const _sfKwds = (_sfEffects[_sfDcName]?.keywords || []).map(k => String(k).toUpperCase());
        if (_sfKwds.includes('LARGE') || _sfKwds.includes('MASSIVE')) continue;
        // Find msgId for this figure's DC
        const _sfFigMsgId = findDcMessageIdForFigure(game.gameId, attackerPlayerNum, _sfFk);
        if (_sfFigMsgId) _sfSmallFriendlies.push({ fk: _sfFk, msgId: _sfFigMsgId, dcName: _sfDcName });
      }
    }
    if (_sfSmallFriendlies.length === 1) {
      // Auto-grant 2 MP to the only eligible friendly
      const _sfF = _sfSmallFriendlies[0];
      game.movementBank = game.movementBank || {};
      if (!game.movementBank[_sfF.msgId]) {
        game.movementBank[_sfF.msgId] = { total: 2, remaining: 2, threadId: null, messageId: null, displayName: _sfF.dcName };
      } else {
        game.movementBank[_sfF.msgId].total += 2;
        game.movementBank[_sfF.msgId].remaining += 2;
      }
      await thread.send(`**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. **${_sfF.dcName}** gains **2 MP**.`).catch(discordCatch);
      await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened; **${_sfF.dcName}** gains 2 MP.`, { phase: 'ROUND', icon: 'card' });
    } else if (_sfSmallFriendlies.length > 1) {
      // Show picker buttons
      game.pendingSuppressiveFireMp = { attackerPlayerNum };
      const _sfBtns = _sfSmallFriendlies.map(({ fk, dcName }) =>
        new ButtonBuilder().setCustomId(`sf_mp_pick_${game.gameId}_${fk}`).setLabel(dcName).setStyle(ButtonStyle.Primary)
      );
      const _sfRows = [];
      for (let _r = 0; _r < _sfBtns.length; _r += 5) _sfRows.push(new ActionRowBuilder().addComponents(_sfBtns.slice(_r, _r + 5)));
      await thread.send({ content: `**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. Choose a SMALL friendly figure within 3 spaces to gain 2 MP:`, components: _sfRows }).catch(discordCatch);
      await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened after Ranged attack.`, { phase: 'ROUND', icon: 'card' });
    } else {
      await thread.send(`**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. No eligible SMALL friendly figures within 3 spaces for MP grant.`).catch(discordCatch);
      await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened after Ranged attack.`, { phase: 'ROUND', icon: 'card' });
    }
  }
  // Flame Trooper Incinerate: after attacking, each figure that suffered damage suffers 1 Strain (HP loss). Place Rubble in target space.
  const _ftAtkUpgrades = combat.attackerMsgId ? (game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || []) : [];
  const _ftBlastRefreshMsgIds = [];
  if (_ftAtkUpgrades.includes('Flame Trooper') && hit) {
    // Apply 1 Strain (1 HP loss) to target if it suffered damage and survived
    if (damage > 0 && targetMsgId) {
      // Fireproof: target immune to Strain if it also has Flame Trooper attachment
      const _ftTargetUpgrades = game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || [];
      if (_ftTargetUpgrades.includes('Flame Trooper')) {
        await thread.send('**Incinerate** — Target is **Fireproof**, immune to Strain.').catch(discordCatch);
      } else {
        const _ftHsBefore = dcHealthState.get(targetMsgId);
        if (_ftHsBefore?.[targetFigIndex]?.[0] > 0) {
            const { newHp: _ftNew, wasDefeated: _ftDefeated } = reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
            await thread.send(`**Incinerate** — **${combat.target.label}** suffers 1 Strain (1 HP damage).`).catch(discordCatch);
            if (_ftDefeated || _ftNew <= 0) {
              removeFigurePosition(game, defenderPlayerNum, combat.target.figureKey);
              if (game.figureConditions?.[combat.target.figureKey]) delete game.figureConditions[combat.target.figureKey];
              const _ftVp = calculateKillVp(combat.defenderDcName);
              awardKillVp(game, attackerPlayerNum, _ftVp);
              await logGameAction(game, client, `💀 **Incinerate** — **${combat.target.label}** defeated from Strain (+${_ftVp} VP).`, { phase: 'ROUND', icon: 'attack' });
              const { dcList: _ftDcList, idx: _ftIdx } = lookupFigureDcIndex(game, defenderPlayerNum, combat.target.figureKey);
              if (_ftIdx >= 0) {
                await decrementActivationIfGroupDefeated(game, defenderPlayerNum, _ftIdx, client);
                const _ftCcKey = ccAttachmentsKey(defenderPlayerNum);
                if (game[_ftCcKey]?.[targetMsgId]?.length) {
                  delete game[_ftCcKey][targetMsgId];
                  await updateAttachmentMessageForDc(game, defenderPlayerNum, targetMsgId, client);
                }
              }
              await checkWinConditions(game, client);
            }
        }
      }
    }
    // Blast damage also triggers Incinerate Strain on adjacent damaged figures — auto-apply
    if (effectiveBlast > 0 && game.selectedMap?.id) {
      const _ftBlastAdj = getFiguresAdjacentToTarget(game, combat.target.figureKey, game.selectedMap.id);
      for (const { figureKey: _ftBlastFk, playerNum: _ftBlastPn } of _ftBlastAdj) {
        // Fireproof: skip friendly figures with Flame Trooper attachment
        if (_ftBlastPn === attackerPlayerNum && _ftAtkUpgrades.includes('Flame Trooper')) continue;
        const _ftBlastMsgId = findDcMessageIdForFigure(game.gameId, _ftBlastPn, _ftBlastFk);
        if (!_ftBlastMsgId) continue;
        // Fireproof: target immune to Strain if it also has Flame Trooper attachment
        const _ftBlastUpgrades = game.p1DcAttachments?.[_ftBlastMsgId] || game.p2DcAttachments?.[_ftBlastMsgId] || [];
        if (_ftBlastUpgrades.includes('Flame Trooper')) continue;
        const { figureIndex: _ftBlastFigIdx } = parseFigureKey(_ftBlastFk);
        const _ftBlastHsBefore = dcHealthState.get(_ftBlastMsgId);
        if (!_ftBlastHsBefore?.[_ftBlastFigIdx] || _ftBlastHsBefore[_ftBlastFigIdx][0] <= 0) continue;
        const { newHp: _ftBlastNew, wasDefeated: _ftBlastDied } = reduceHp(dcHealthState, game, _ftBlastMsgId, _ftBlastFigIdx, 1, _ftBlastPn);
        const _ftBlastName = dcNameFromFigureKey(_ftBlastFk);
        await thread.send(`**Incinerate** — **${_ftBlastName}** suffers 1 Strain from Blast.`).catch(() => {});
        _ftBlastRefreshMsgIds.push(_ftBlastMsgId);
        if (_ftBlastDied || _ftBlastNew <= 0) {
          removeFigurePosition(game, _ftBlastPn, _ftBlastFk);
          if (game.figureConditions?.[_ftBlastFk]) delete game.figureConditions[_ftBlastFk];
          const _ftBlastVp = calculateKillVp(_ftBlastName);
          awardKillVp(game, _ftBlastPn === attackerPlayerNum ? defenderPlayerNum : attackerPlayerNum, _ftBlastVp);
          await logGameAction(game, client, `💀 **Incinerate** — **${_ftBlastName}** defeated from Blast Strain (+${_ftBlastVp} VP).`, { phase: 'ROUND', icon: 'attack' });
          const { dcList: _ftBlastDcList, idx: _ftBlastIdx } = lookupFigureDcIndex(game, _ftBlastPn, _ftBlastFk);
          if (_ftBlastIdx >= 0) {
            await decrementActivationIfGroupDefeated(game, _ftBlastPn, _ftBlastIdx, client);
          }
          await checkWinConditions(game, client);
        }
      }
    }
    // Place Rubble token in target space (if attack didn't miss)
    if (combat.target?.figureKey) {
      const _ftTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      if (_ftTargetPos) {
        game.rubbleTokens = game.rubbleTokens || [];
        const _ftCoord = String(_ftTargetPos).toLowerCase();
        if (!game.rubbleTokens.includes(_ftCoord)) {
          game.rubbleTokens.push(_ftCoord);
        }
        await thread.send(`**Incinerate** — Rubble token placed at **${String(_ftTargetPos).toUpperCase()}**.`).catch(() => {});
      }
    }
  }

  const embedRefreshMsgIds = new Set(damage > 0 && targetMsgId ? [targetMsgId] : []);
  if (combat.surgeRecover > 0 && combat.attackerMsgId != null) embedRefreshMsgIds.add(combat.attackerMsgId);
  // Force Deflection embed refresh (flag set earlier in pre-defeat section)
  if (_fdNeedsEmbedRefresh && combat.attackerMsgId) embedRefreshMsgIds.add(combat.attackerMsgId);
  // Incinerate Blast Strain embed refreshes (collected earlier)
  if (_ftBlastRefreshMsgIds?.length) for (const _mid of _ftBlastRefreshMsgIds) embedRefreshMsgIds.add(_mid);

  // Concentrated Fire: apply Stun to the attacker figure after attack resolves
  if (game.applySelfStunAfterAttackPlayerNum?.[attackerPlayerNum] && combat.attackerMsgId) {
    delete game.applySelfStunAfterAttackPlayerNum[attackerPlayerNum];
    const _cfaFigKey = combat.attackerFigureKey;
    if (_cfaFigKey && !isConditionImmune(game, _cfaFigKey)) {
      if (_applyCondition(game, _cfaFigKey, 'Stun')) {
        const _cfaDcName = dcNameFromFigureKey(_cfaFigKey);
        await logGameAction(game, client, `**Concentrated Fire** — **${_cfaDcName}** is now **Stunned**.`, { phase: 'ROUND', icon: 'card' });
        embedRefreshMsgIds.add(combat.attackerMsgId);
      }
    }
  }
  // Wild Fury: after final free attack, apply postActivationConditions (Stun + Bleed) to attacker figure
  if (game.pendingPostAttackConditions?.[combat.attackerMsgId] && combat.attackerFigureKey) {
    let _ppaConditions = game.pendingPostAttackConditions[combat.attackerMsgId];
    delete game.pendingPostAttackConditions[combat.attackerMsgId];
    if (Array.isArray(_ppaConditions) && _ppaConditions.length > 0) {
      // Condition Immunity: filter out harmful conditions for immune figures
      if (isConditionImmune(game, combat.attackerFigureKey)) {
        _ppaConditions = _ppaConditions.filter((c) => !HARMFUL_CONDITIONS.includes(c));
      }
      if (_ppaConditions.length > 0) {
        for (const _ppaC of _ppaConditions) {
          _applyCondition(game, combat.attackerFigureKey, _ppaC);
        }
        const _ppaDcName = dcNameFromFigureKey(combat.attackerFigureKey);
        await logGameAction(game, client, `**Wild Fury** — **${_ppaDcName}** is now **${_ppaConditions.join(' + ')}**.`, { phase: 'ROUND', icon: 'card' });
        embedRefreshMsgIds.add(combat.attackerMsgId);
      }
    }
  }
  // Dying Lunge / Final Stand: attacker defeats itself after the attack resolves
  if (game.selfDefeatsAfterAttackMsgId?.[combat.attackerMsgId] && combat.attackerMsgId) {
    delete game.selfDefeatsAfterAttackMsgId[combat.attackerMsgId];
    const _sdaMsgId = combat.attackerMsgId;
    const _sdaFigKey = combat.attackerFigureKey;
    const _sdaFigIdx = combat.attackerFigureIndex ?? 0;
    if (_sdaFigKey) {
      const _sdaPrevHs = dcHealthState.get(_sdaMsgId);
      if (_sdaPrevHs?.[_sdaFigIdx]) {
        const _sdaMaxHp = _sdaPrevHs[_sdaFigIdx][1] ?? _sdaPrevHs[_sdaFigIdx][0] ?? 99;
        reduceHp(dcHealthState, game, _sdaMsgId, _sdaFigIdx, _sdaMaxHp, attackerPlayerNum);
        const _sdaDcIds = getDcMessageIds(game, attackerPlayerNum);
        const _sdaDcList = getDcList(game, attackerPlayerNum);
        const _sdaIdx = (_sdaDcIds || []).indexOf(_sdaMsgId);
        removeFigurePosition(game, attackerPlayerNum, _sdaFigKey);
        if (game.figureConditions?.[_sdaFigKey]) delete game.figureConditions[_sdaFigKey];
        const _sdaName = _sdaDcList?.[_sdaIdx]?.displayName || dcNameFromFigureKey(_sdaFigKey);
        const _sdaStats = _sdaIdx >= 0 ? getDcStats(_sdaDcList[_sdaIdx]?.dcName) : null;
        const _sdaVp = _sdaStats?.cost ?? 5;
        awardKillVp(game, defenderPlayerNum, _sdaVp);
        embedRefreshMsgIds.add(_sdaMsgId);
        await logGameAction(game, client, `**${_sdaName}** defeated itself (self-sacrifice). Opponent gains **${_sdaVp} VP**.`, { phase: 'ROUND', icon: 'attack' });
        await checkWinConditions(game, client);
      }
    }
  }

  // --- Named surge post-combat effects ---
  if (hit && targetMsgId) {
    // Harass: defender suffers N Strain after a non-miss
    if ((combat.surgeHarass || 0) > 0) {
      reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, combat.surgeHarass, defenderPlayerNum);
      embedRefreshMsgIds.add(targetMsgId);
      await logGameAction(game, client, `**Harass** — **${combat.target.label}** suffers **${combat.surgeHarass}** Strain`, { phase: 'ROUND', icon: 'attack' });
    }
    // Suppression: target suffers Strain = min(block + evade + [1 if dodge], 2)
    if (combat.surgeSuppressionStrain) {
      const supRoll = combat.defenseRoll || {};
      const supAmt = Math.min((supRoll.block || 0) + (supRoll.evade || 0) + (supRoll.dodge ? 1 : 0), 2);
      if (supAmt > 0) {
        reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, supAmt, defenderPlayerNum);
        embedRefreshMsgIds.add(targetMsgId);
        await logGameAction(game, client, `**Suppression** — **${combat.target.label}** suffers **${supAmt}** Strain (${supRoll.block || 0} block, ${supRoll.evade || 0} evade${supRoll.dodge ? ', 1 dodge' : ''})`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Mandalorian Steel: if defender spent a Block Token this attack, recover 1 Damage on the defending figure
  if (combat.defenderSpentBlock && game.mandaAsteelPlayerNum === defenderPlayerNum && targetMsgId) {
    const { healed } = healHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
    if (healed > 0) {
      embedRefreshMsgIds.add(targetMsgId);
      await logGameAction(game, client, `**Mandalorian Steel** — **${combat.target.label}** spent a Block Token; recovered 1 Damage`, { phase: 'ROUND', icon: 'card' });
    }
  }

  // Stalk Prey: attacker gains +2 MP and +1 Hit Token on hit
  if (hit && combat.surgeStalkPrey && combat.attackerMsgId) {
    game.movementBank = game.movementBank || {};
    const spBank = game.movementBank[combat.attackerMsgId] || { total: 0, remaining: 0 };
    spBank.total = (spBank.total ?? 0) + 2;
    spBank.remaining = (spBank.remaining ?? 0) + 2;
    game.movementBank[combat.attackerMsgId] = spBank;
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[combat.attackerFigureKey] = [...(game.figurePowerTokens[combat.attackerFigureKey] || []), 'Hit'];
    await logGameAction(game, client, `**Stalk Prey** — **${combat.attackerDcName}** gained +2 MP and +1 Hit Token`, { phase: 'ROUND', icon: 'card' });
    await ensureMovementBankMessage(game, combat.attackerMsgId, client);
    embedRefreshMsgIds.add(combat.attackerMsgId);
  }
  // Squad Command: Focus an adjacent friendly TROOPER
  if (hit && combat.surgeSquadCommand && game.selectedMap?.id && combat.attackerFigureKey) {
    const sqAdj = getFiguresAdjacentToTarget(game, combat.attackerFigureKey, game.selectedMap.id);
    for (const { figureKey: sqFk, playerNum: sqPn } of sqAdj) {
      if (sqPn !== attackerPlayerNum) continue;
      const sqDcName = dcNameFromFigureKey(sqFk);
      const sqEff = getDcEffect(sqDcName);
      const sqKws = (sqEff?.keywords || []).map((k) => String(k).toUpperCase());
      if (!sqKws.includes('TROOPER')) continue;
      if (_applyCondition(game, sqFk, 'Focus')) {
        const sqMsgId = findDcMessageIdForFigure(game.gameId, sqPn, sqFk);
        if (sqMsgId) embedRefreshMsgIds.add(sqMsgId);
        await logGameAction(game, client, `**Squad Command** — **${sqDcName}** is now **Focused**`, { phase: 'ROUND', icon: 'card' });
      }
    }
  }

  // Bleed: attacker prompted to take 1 damage or prevent by discarding CC after Attack action
  // (skipped if player spent a surge to prevent Bleed during the surge window)
  if (combat.attackerConds?.includes('Bleed') && !combat.surgePreventBleed) {
    const bleedThread = await client.channels.fetch(combat.combatThreadId);
    await sendBleedingPrompt(game, bleedThread, combat.attackerFigureKey, combat.attackerPlayerNum, combat.attackerDisplayName);
  }
  // Deflection: if defender took 0 damage (attack hit but was fully blocked), attacker suffers N damage
  const deflectDmg = game.deflectionPending?.[defenderPlayerNum];
  if (deflectDmg && deflectDmg > 0 && hit && damage === 0) {
    delete game.deflectionPending[defenderPlayerNum];
    const attMsgId = combat.attackerMsgId;
    const attFigIdx = combat.attackerFigureIndex ?? 0;
    if (attMsgId) {
      const { maxHp: deflectMax } = reduceHp(dcHealthState, game, attMsgId, attFigIdx, deflectDmg, attackerPlayerNum);
      if (deflectMax > 0) {
        embedRefreshMsgIds.add(attMsgId);
        const defOwnerId = getPlayerId(game, defenderPlayerNum);
        await logGameAction(game, client, `<@${defOwnerId}> **Deflection** — Attacker suffers **${deflectDmg} Damage** (you took no damage).`, { allowedMentions: { users: [defOwnerId] }, phase: 'ROUND', icon: 'card' });
      }
    }
  }
  // Embed refresh for Blast damage already applied earlier in this function
  if (totalBlast > 0 && hit && game.selectedMap?.id) {
    const blastAdjacent = getFiguresAdjacentToTarget(game, combat.target.figureKey, game.selectedMap.id);
    for (const { figureKey: bk, playerNum: bp } of blastAdjacent) {
      const mid = findDcMessageIdForFigure(game.gameId, bp, bk);
      if (mid) embedRefreshMsgIds.add(mid);
    }
  }
  // Cover Fire (CT-1701): after resolving an attack, distribute 1 Block Token to a friendly figure within 3 spaces.
  // If the attack hit, may discard 1 condition or Power Token from the target. Limit once per round.
  const _cfAttEff = getDcEffects()?.[combat.attackerDcName || ''];
  const _cfKey = `coverFire_${combat.attackerMsgId}`;
  if ((_cfAttEff?.passives || []).includes('Cover Fire') && combat.attackerMsgId && !game.roundFigureAbilityUsed?.[_cfKey]) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    game.roundFigureAbilityUsed[_cfKey] = true;
    const _cfAttPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    const _cfMapId = game.selectedMap?.id;
    if (_cfAttPos && _cfMapId) {
      // Find all friendly figures within 3 spaces
      const _cfFriendlies = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[attackerPlayerNum] || {})) {
        if (!pos) continue;
        if (getRange(_cfAttPos, pos) <= 3) _cfFriendlies.push({ fk, pos });
      }
      if (_cfFriendlies.length === 1) {
        // Auto-grant to the only option
        grantPowerTokens(game, _cfFriendlies[0].fk, 'Block', 1);
        const _cfName = dcNameFromFigureKey(_cfFriendlies[0].fk);
        await logGameAction(game, client, `🛡️ **Cover Fire** — **${_cfName}** gained 1 Block Token.`, { phase: 'ROUND', icon: 'card' });
        const _cfMid = findDcMessageIdForFigure(game.gameId, attackerPlayerNum, _cfFriendlies[0].fk);
        if (_cfMid) embedRefreshMsgIds.add(_cfMid);
      } else if (_cfFriendlies.length > 1) {
        // Picker buttons for Block token target
        const _cfBtns = _cfFriendlies.slice(0, 20).map(({ fk }) => {
          const _cfLabel = dcNameFromFigureKey(fk);
          return new ButtonBuilder()
            .setCustomId(`cover_fire_block_${game.gameId}_${attackerPlayerNum}_${fk}`)
            .setLabel(_cfLabel.slice(0, 80))
            .setStyle(ButtonStyle.Primary);
        });
        const _cfRows = [];
        for (let i = 0; i < _cfBtns.length; i += 5) {
          _cfRows.push(new ActionRowBuilder().addComponents(_cfBtns.slice(i, i + 5)));
        }
        game.pendingCoverFire = { gameId: game.gameId, attackerPlayerNum, attackerMsgId: combat.attackerMsgId, hit: !!(hit && damage > 0), targetFigureKey: combat.target?.figureKey, targetMsgId, targetFigIndex, defenderPlayerNum, combat: { combatThreadId: combat.combatThreadId, resultText }, embedRefreshMsgIds: [...embedRefreshMsgIds] };
        await thread.send({ content: `🛡️ **Cover Fire** — <@${ownerId}> Choose a friendly figure within 3 spaces to receive 1 Block Token:`, allowedMentions: { users: [ownerId] }, components: _cfRows });
        // Don't return — the Block token choice is async but we continue combat resolution
      }
    }
    // If hit and damage > 0, offer to discard a condition or power token from the target
    if (hit && damage > 0 && combat.target?.figureKey) {
      const _cfTargetConds = (game.figureConditions?.[combat.target.figureKey] || []).filter(c => c !== 'Bleed' || c); // all conditions
      const _cfTargetTokens = game.figurePowerTokens?.[combat.target.figureKey] || [];
      const _cfRemovables = [..._cfTargetConds.map(c => ({ type: 'condition', value: c })), ..._cfTargetTokens.map(t => ({ type: 'token', value: t }))];
      if (_cfRemovables.length > 0) {
        const _cfRemBtns = _cfRemovables.slice(0, 20).map(({ type, value }, i) => {
          const label = type === 'condition' ? `Discard ${value}` : `Discard ${value} Token`;
          return new ButtonBuilder()
            .setCustomId(`cover_fire_discard_${game.gameId}_${type}_${i}_${combat.target.figureKey}`)
            .setLabel(label.slice(0, 80))
            .setStyle(ButtonStyle.Danger);
        });
        _cfRemBtns.push(new ButtonBuilder().setCustomId(`cover_fire_discard_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const _cfRemRows = [];
        for (let i = 0; i < _cfRemBtns.length; i += 5) {
          _cfRemRows.push(new ActionRowBuilder().addComponents(_cfRemBtns.slice(i, i + 5)));
        }
        await thread.send({ content: `🛡️ **Cover Fire** — <@${ownerId}> You may discard 1 condition or Power Token from **${combat.target.label}**:`, allowedMentions: { users: [ownerId] }, components: _cfRemRows });
      }
    }
  }

  // F6 Cleave: attacker may choose one other figure in melee (adjacent to attacker) to apply cleave damage
  // Triggered by either surge Cleave ability or Cleave N passive on deployment card
  const effectiveCleave = (combat.surgeCleave || 0) + (combat.passiveCleave || 0);
  if (hit && damage > 0 && effectiveCleave > 0 && game.selectedMap?.id) {
    const attMeta = combat.attackerMsgId ? dcMessageMeta.get(combat.attackerMsgId) : null;
    const attDg = (attMeta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const attackerFigureKey = attMeta ? `${attMeta.dcName}-${attDg}-${combat.attackerFigureIndex ?? 0}` : null;
    if (attackerFigureKey) {
      const adjacentToAttacker = getFiguresAdjacentToTarget(game, attackerFigureKey, game.selectedMap.id);
      const cleaveTargets = adjacentToAttacker.filter(
        (c) => c.playerNum === defenderPlayerNum && c.figureKey !== combat.target.figureKey
      );
      if (cleaveTargets.length > 0) {
        const targetsWithLabels = cleaveTargets.map((c) => {
          const { msgId, label } = getFigureLabel(game, c.playerNum, c.figureKey, c.figureKey);
          return { figureKey: c.figureKey, playerNum: c.playerNum, label };
        });
        game.pendingCleave = {
          gameId: game.gameId,
          combatThreadId: combat.combatThreadId,
          surgeCleave: effectiveCleave,
          attackerPlayerNum,
          ownerId,
          targets: targetsWithLabels,
          resultText,
          combat,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        };
        const cleaveRows = getCleaveTargetButtons(game.gameId, targetsWithLabels);
        await thread.send({
          content: `**Cleave (${effectiveCleave} damage):** <@${ownerId}> — Choose one target in melee to apply cleave damage:`,
          allowedMentions: { users: [ownerId] },
          components: cleaveRows,
        });
        return;
      }
    }
  }
  const fkTriggered = await checkPostCombatSurges(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum);
  if (!fkTriggered) await finishCombatResolution(game, combat, resultText, embedRefreshMsgIds, client);
}

/** BFS distance check on mapSpaces adjacency (used for Boltslinger, etc.). */
function isWithinN(posA, posB, maxDist, mapId) {
  const ms = getMapSpaces(mapId);
  if (!ms?.adjacency || !posA || !posB) return false;
  const a = String(posA).toLowerCase(), b = String(posB).toLowerCase();
  if (a === b) return true;
  const visited = new Set([a]);
  let frontier = [a];
  for (let d = 1; d <= maxDist; d++) {
    const next = [];
    for (const c of frontier) {
      for (const adj of (ms.adjacency[c] || [])) {
        const s = String(adj).toLowerCase();
        if (s === b) return true;
        if (!visited.has(s)) { visited.add(s); next.push(s); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return false;
}

/**
 * Check for post-combat surge effects that need UI interaction, before finishCombatResolution.
 * Returns true if a pending interaction was triggered (caller should NOT call finishCombatResolution yet).
 * Returns false if nothing triggered (caller should call finishCombatResolution).
 */
async function checkPostCombatSurges(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum) {
  const hit = !resultText.includes('**Miss**');
  // Fighting Knife (Verena Talos): after non-miss, choose adjacent hostile, roll 1 red die, apply hits
  if (hit && combat.surgeFightingKnife && combat.attackerFigureKey && game.selectedMap?.id) {
    const adjHostiles = getFiguresAdjacentToTarget(game, combat.attackerFigureKey, game.selectedMap.id)
      .filter((c) => c.playerNum === defenderPlayerNum);
    if (adjHostiles.length > 0) {
      const targetsWithLabels = adjHostiles.map((c) => {
        const { msgId: mid, label } = getFigureLabel(game, c.playerNum, c.figureKey);
        return { figureKey: c.figureKey, playerNum: c.playerNum, label, msgId: mid };
      });
      game.pendingFightingKnife = {
        gameId: game.gameId,
        combatThreadId: combat.combatThreadId,
        attackerPlayerNum: combat.attackerPlayerNum,
        ownerId,
        targets: targetsWithLabels,
        resultText,
        combat,
        initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
      };
      const rows = getFightingKnifeTargetButtons(game.gameId, targetsWithLabels);
      await thread.send({
        content: `<@${ownerId}> **Fighting Knife** — Choose an adjacent hostile figure to roll 1 red die:`,
        allowedMentions: { users: [ownerId] },
        components: rows,
      }).catch(discordCatch);
      return true;
    }
  }
  // Concussive Bolt (4-LOM): after non-miss on SMALL target, push target 1 space (attacker picks direction)
  if (hit && combat.surgeConcussiveBolt && combat.target?.figureKey && game.selectedMap?.id) {
    const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
    const targetSize = getFigureSize(targetDcName);
    if (targetSize === '1x1') {
      const targetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      const ms = getMapSpaces(game.selectedMap.id);
      const adjSpaces = (ms?.adjacency?.[String(targetPos).toLowerCase()] || []).map((s) => String(s).toLowerCase());
      if (adjSpaces.length > 0) {
        const { msgId: targetMsgId, label: targetLabel } = getFigureLabel(game, defenderPlayerNum, combat.target.figureKey, targetDcName);
        game.pendingConcussiveBolt = {
          gameId: game.gameId,
          combatThreadId: combat.combatThreadId,
          attackerPlayerNum: combat.attackerPlayerNum,
          defenderPlayerNum,
          ownerId,
          figureKey: combat.target.figureKey,
          figureLabel: String(targetLabel).slice(0, 80),
          currentPos: targetPos,
          adjSpaces,
          resultText,
          combat,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        };
        const btns = adjSpaces.slice(0, 4).map((sp) =>
          new ButtonBuilder().setCustomId(`concussive_bolt_push_${game.gameId}_${sp}`).setLabel(sp.toUpperCase()).setStyle(ButtonStyle.Danger)
        );
        btns.push(new ButtonBuilder().setCustomId(`concussive_bolt_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({
          content: `<@${ownerId}> **Concussive Bolt** — Push **${targetLabel}** 1 space. Choose a destination:`,
          allowedMentions: { users: [ownerId] },
          components: [new ActionRowBuilder().addComponents(btns)],
        }).catch(discordCatch);
        return true;
      }
    }
  }
  // Spread the Pain (Dengar): after non-miss, apply each chosen HARMFUL condition to a figure on/adjacent to target
  if (hit && combat.spreadThePainConditions?.length > 0 && combat.target?.figureKey && game.selectedMap?.id) {
    const conditions = [...combat.spreadThePainConditions];
    const targetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
    if (targetPos) {
      const ms = getMapSpaces(game.selectedMap.id);
      const adjacency = ms?.adjacency || {};
      const candSpaces = new Set([String(targetPos).toLowerCase(), ...(adjacency[String(targetPos).toLowerCase()] || []).map((s) => String(s).toLowerCase())]);
      const figuresAtSpaces = [];
      for (const p of [1, 2]) {
        for (const [figKey, figPos] of Object.entries(game.figurePositions?.[p] || {})) {
          if (candSpaces.has(String(figPos).toLowerCase())) {
            const { msgId: mid, label } = getFigureLabel(game, p, figKey, undefined, 70);
            figuresAtSpaces.push({ figureKey: figKey, playerNum: p, label, msgId: mid });
          }
        }
      }
      if (figuresAtSpaces.length > 0) {
        const firstCond = conditions[0];
        game.pendingSpreadThePain = {
          gameId: game.gameId,
          combatThreadId: combat.combatThreadId,
          attackerPlayerNum: combat.attackerPlayerNum,
          defenderPlayerNum,
          ownerId,
          conditions,
          conditionIdx: 0,
          resultText,
          combat,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        };
        const btns = figuresAtSpaces.slice(0, 4).map((f) =>
          new ButtonBuilder()
            .setCustomId(`spread_pain_fig_${game.gameId}_${f.figureKey}`)
            .setLabel(f.label)
            .setStyle(f.playerNum === defenderPlayerNum ? ButtonStyle.Danger : ButtonStyle.Secondary)
        );
        btns.push(new ButtonBuilder().setCustomId(`spread_pain_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({
          content: `<@${ownerId}> **Spread the Pain** — Apply **${firstCond}** to a figure at or adjacent to target (${String(targetPos).toUpperCase()}):`,
          allowedMentions: { users: [ownerId] },
          components: [new ActionRowBuilder().addComponents(btns)],
        }).catch(discordCatch);
        return true;
      }
    }
  }
  // Post-attack reactions: check if defender has Payback, Dangerous Prey, or Right Back At Ya!
  const defenderHand = getCcHand(game, defenderPlayerNum) || [];
  const REACTION_CARDS = [
    { name: 'Payback', targetDcName: 'Dengar' },
    { name: 'Dangerous Prey', targetDcName: 'Bossk' },
    { name: "Right Back At Ya!", targetDcName: 'Boba Fett' },
  ];
  combat.promptedReactions = combat.promptedReactions || new Set();
  for (const { name, targetDcName } of REACTION_CARDS) {
    if (combat.promptedReactions.has(name)) continue;
    if (!defenderHand.includes(name)) continue;
    const targetFigKey = combat.target?.figureKey || '';
    if (!targetFigKey.startsWith(targetDcName + '-')) continue;
    // Prompt the defender for this reaction
    combat.promptedReactions.add(name);
    const defOwnerId = getPlayerId(game, defenderPlayerNum);
    // Tentatively remove from hand to prevent double-prompt; restored on skip
    const handKey = ccHandKey(defenderPlayerNum);
    const cardIdx = (game[handKey] || []).indexOf(name);
    if (cardIdx >= 0) game[handKey].splice(cardIdx, 1);
    game.pendingReaction = {
      gameId: game.gameId,
      combatThreadId: combat.combatThreadId,
      attackerPlayerNum: combat.attackerPlayerNum,
      defenderPlayerNum,
      ownerId: defOwnerId,
      cardName: name,
      targetDcName,
      targetFigKey,
      attackerFigKey: combat.attackerFigureKey,
      attackerMsgId: combat.attackerMsgId,
      resultText,
      combat,
      initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
    };
    const btnUse = new ButtonBuilder()
      .setCustomId(`reaction_use_${game.gameId}`)
      .setLabel(`React: ${name}`)
      .setStyle(ButtonStyle.Danger);
    const btnSkip = new ButtonBuilder()
      .setCustomId(`reaction_skip_${game.gameId}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary);
    await thread.send({
      content: `<@${defOwnerId}> — You have **${name}** in hand! React to this attack?`,
      allowedMentions: { users: [defOwnerId] },
      components: [new ActionRowBuilder().addComponents(btnUse, btnSkip)],
    }).catch(discordCatch);
    return true;
  }
  // Agitate (Cam Droid): on hit, defender's group must activate next, if able
  if (hit && combat.surgeAgitate && combat.target?.figureKey) {
    const defenderDcName = dcNameFromFigureKey(combat.target.figureKey);
    game.agitateNextActivation = { playerNum: defenderPlayerNum, dcName: defenderDcName };
    const defLabel = combat.target.label || defenderDcName;
    await thread.send(`**Agitate** — **${defLabel}**'s group must be the next to activate this round, if able.`).catch(discordCatch);
  }
  // Fell Swoop (Davith Elso): after attack, become Hidden, gain 2 MP, free attack. Limit once per round.
  if (combat.surgeFellSwoop && combat.attackerFigureKey) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    const fsKey = `${combat.attackerFigureKey}_fell_swoop`;
    if (!game.roundFigureAbilityUsed[fsKey]) {
      game.roundFigureAbilityUsed[fsKey] = true;
      _applyCondition(game, combat.attackerFigureKey, 'Hide');
      if (game.movementBank?.[combat.attackerMsgId]) {
        game.movementBank[combat.attackerMsgId].remaining += 2;
        game.movementBank[combat.attackerMsgId].total += 2;
        updateMovementBankMessage(game, combat.attackerMsgId, client).catch(() => {});
      }
      game.fellSwoopFreeAttack = game.fellSwoopFreeAttack || {};
      game.fellSwoopFreeAttack[combat.attackerMsgId] = true;
      const attName = combat.attackerDisplayName || dcNameFromFigureKey(combat.attackerFigureKey);
      await thread.send(`**Fell Swoop** — **${attName}** becomes **Hidden** and gains **2 Movement Points**. Use Move in the DC thread, then click Attack for a free Fell Swoop attack (costs no action).`).catch(discordCatch);
    }
  }
  // Mastery (Second Sister): redraw a FORCE USER CC of cost ≤ 1 from discard. Limit once per round.
  if (combat.surgeMastery && combat.attackerFigureKey) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    const mastKey = `${combat.attackerFigureKey}_mastery`;
    if (!game.roundFigureAbilityUsed[mastKey]) {
      game.roundFigureAbilityUsed[mastKey] = true;
      const mastPlayerNum = combat.attackerPlayerNum;
      const mastDiscardKey = ccDiscardKey(mastPlayerNum);
      const mastDiscard = game[mastDiscardKey] || [];
      const mastEligible = mastDiscard.filter((cardName) => {
        const entry = getCcEffect(cardName);
        return entry && (entry.cost ?? 99) <= 1 && String(entry.playableBy || '').toUpperCase().includes('FORCE USER');
      });
      if (mastEligible.length === 0) {
        await thread.send(`**Mastery** — No eligible FORCE USER Command cards (cost ≤ 1) in your discard pile.`).catch(discordCatch);
      } else {
        game.pendingMastery = { gameId: game.gameId, attackerPlayerNum: mastPlayerNum, discardKey: mastDiscardKey, eligible: mastEligible, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum };
        const mastOwnerId = getPlayerId(game, mastPlayerNum);
        const mastBtns = mastEligible.slice(0, 4).map((cardName, i) =>
          new ButtonBuilder().setCustomId(`mastery_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Primary)
        );
        mastBtns.push(new ButtonBuilder().setCustomId(`mastery_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({
          content: `<@${mastOwnerId}> **Mastery** — Choose a FORCE USER CC (cost ≤ 1) from your discard pile to return to hand:`,
          allowedMentions: { users: [mastOwnerId] },
          components: [new ActionRowBuilder().addComponents(mastBtns)],
        }).catch(discordCatch);
        return true;
      }
    }
  }
  // Interrogate (Agent Blaise): look at opponent's hand, choose a CC; may discard equal/greater cost to force discard.
  if (combat.surgeInterrogate) {
    const intAttackerPlayerNum = combat.attackerPlayerNum;
    const intOpponentPlayerNum = defenderPlayerNum;
    const intOpponentHandKey = ccHandKey(intOpponentPlayerNum);
    const intOpponentHand = game[intOpponentHandKey] || [];
    if (intOpponentHand.length === 0) {
      await thread.send(`**Interrogate** — Opponent's hand is empty; no card to choose.`).catch(discordCatch);
    } else {
      game.pendingInterrogate = { gameId: game.gameId, attackerPlayerNum: intAttackerPlayerNum, opponentPlayerNum: intOpponentPlayerNum, opponentHandSnapshot: [...intOpponentHand], chosenCardName: null, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum };
      const intOwnerId = getPlayerId(game, intAttackerPlayerNum);
      const intBtns = intOpponentHand.slice(0, 4).map((cardName, i) =>
        new ButtonBuilder().setCustomId(`interrogate_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Danger)
      );
      await thread.send({
        content: `<@${intOwnerId}> **Interrogate** — ⚠️ *Opponent: look away!* Pick the card you want to target:`,
        allowedMentions: { users: [intOwnerId] },
        components: [new ActionRowBuilder().addComponents(intBtns)],
      }).catch(discordCatch);
      return true;
    }
  }
  // Military Efficiency (Leia Organa): shuffle 1 CC from discard back into deck
  if (combat.surgeMilitaryEfficiency && combat.attackerPlayerNum) {
    const mePlayerNum = combat.attackerPlayerNum;
    const meDiscardKey = ccDiscardKey(mePlayerNum);
    const meDeckKey = ccDeckKey(mePlayerNum);
    const meDiscard = game[meDiscardKey] || [];
    if (meDiscard.length === 0) {
      await thread.send(`**Military Efficiency** — No cards in discard pile to return.`).catch(discordCatch);
    } else {
      // Shuffle the most-recently-discarded card back into the deck
      const meCard = meDiscard[meDiscard.length - 1];
      game[meDiscardKey] = meDiscard.slice(0, -1);
      const meDeck = [...(game[meDeckKey] || [])];
      const meInsertIdx = Math.floor(Math.random() * (meDeck.length + 1));
      meDeck.splice(meInsertIdx, 0, meCard);
      game[meDeckKey] = meDeck;
      await thread.send(`**Military Efficiency** — **${meCard}** shuffled from discard back into your Command deck.`).catch(discordCatch);
      await logGameAction(game, client, `**Military Efficiency** — **${meCard}** shuffled back into P${mePlayerNum}'s Command deck.`, { phase: 'ROUND', icon: 'card' });
    }
  }
  return false;
}

/** Send result to thread, clear combat/roll UI, refresh DC embeds and board. */
async function finishCombatResolution(game, combat, resultText, embedRefreshMsgIds, client) {
  const thread = await client.channels.fetch(combat.combatThreadId);
  await thread.send(resultText);
  // Hit and Run: add pending MP when attack resolves
  const pending = game.hitAndRunPendingMp;
  if (pending && pending.msgId === combat.attackerMsgId && pending.amount > 0) {
    const n = pending.amount;
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[pending.msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + n;
    bank.remaining = (bank.remaining ?? 0) + n;
    game.movementBank[pending.msgId] = bank;
    const ownerId = getPlayerId(game, combat.attackerPlayerNum);
    await logGameAction(game, client, `Hit and Run: <@${ownerId}> gained **${n}** movement point${n === 1 ? '' : 's'} after the attack.`, { allowedMentions: { users: [ownerId] }, phase: 'ACTION', icon: 'card' });
    await ensureMovementBankMessage(game, pending.msgId, client);
    delete game.hitAndRunPendingMp;
  }
  // --- Post-combat ability prompts (before clearing pendingCombat) ---
  const pcAttEff = getDcEffect(combat.attackerDcName);
  const pcAttIds = pcAttEff?.specialAbilityIds || [];
  const pcOwnerId = getPlayerId(game, combat.attackerPlayerNum);
  // Sidewinder (Jyn Odan): suffer 1 Strain to move 2 after attack (once/round)
  if (pcAttIds.includes('sidewinder') && combat.attackerMsgId != null) {
    const swKey = combat.attackerFigureKey + '_sidewinder';
    if (!game.roundFigureAbilityUsed?.[swKey]) {
      await thread.send({
        content: `<@${pcOwnerId}> **Sidewinder** — Suffer 1 Strain to move up to 2 spaces? (once per round)`,
        allowedMentions: { users: [pcOwnerId] },
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`sidewinder_apply_${game.gameId}_${combat.attackerMsgId}_${combat.attackerFigureIndex ?? 0}`).setLabel('Suffer 1 Strain → +2 MP').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`sidewinder_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary),
        )],
      }).catch(discordCatch);
    }
  }
  // Boltslinger (Vinto Hreeda): deal 1 Dmg to another hostile within 3 after attack
  if (pcAttIds.includes('boltslinger') && game.selectedMap?.id && combat.attackerFigureKey) {
    const blDefPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const atkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
    const defFigs = game.figurePositions?.[blDefPlayerNum] || {};
    const boltslingerTargets = [];
    for (const [fk, pos] of Object.entries(defFigs)) {
      if (fk === combat.target?.figureKey) continue;
      if (!isWithinN(atkPos, pos, 3, game.selectedMap.id)) continue;
      const { label: blLabel } = getFigureLabel(game, blDefPlayerNum, fk);
      boltslingerTargets.push({ figureKey: fk, playerNum: blDefPlayerNum, label: blLabel });
    }
    if (boltslingerTargets.length > 0) {
      game.pendingBoltslinger = { gameId: game.gameId, attackerPlayerNum: combat.attackerPlayerNum, combatThreadId: combat.combatThreadId, targets: boltslingerTargets };
      const btns = boltslingerTargets.slice(0, 4).map((t, i) =>
        new ButtonBuilder().setCustomId(`boltslinger_target_${game.gameId}_${i}`).setLabel(t.label).setStyle(ButtonStyle.Danger)
      );
      btns.push(new ButtonBuilder().setCustomId(`boltslinger_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
      await thread.send({
        content: `<@${pcOwnerId}> **Boltslinger** — Choose a hostile within 3 spaces to deal 1 Damage (verify LOS):`,
        allowedMentions: { users: [pcOwnerId] },
        components: [new ActionRowBuilder().addComponents(btns)],
      }).catch(discordCatch);
    }
  }
  // Indiscriminate Fire (Bossk): after attack, if not a miss, choose 1 non-red attack die;
  // each figure within 2 spaces of target (other than the defender) suffers Damage = Hits and Strain = Surges on that die.
  if (pcAttIds.includes('indiscriminate_fire') && !resultText.includes('**Miss**') && game.selectedMap?.id && combat.target?.figureKey) {
    const ifDefPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const targetPos = game.figurePositions?.[ifDefPlayerNum]?.[combat.target.figureKey];
    const rolledDice = combat.attackRoll?.dice || [];
    const nonRedDice = rolledDice.filter((d) => (d.color || '').toLowerCase() !== 'red');
    if (nonRedDice.length > 0 && targetPos) {
      const splashTargets = [];
      for (const pn of [1, 2]) {
        const figs = game.figurePositions?.[pn] || {};
        for (const [fk, pos] of Object.entries(figs)) {
          if (fk === combat.target.figureKey) continue;
          if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
          const { label: lbl } = getFigureLabel(game, pn, fk);
          splashTargets.push({ figureKey: fk, playerNum: pn, label: lbl });
        }
      }
      if (nonRedDice.length === 1) {
        await applyIndiscriminateFireSplash(game, combat.attackerPlayerNum, combat.combatThreadId, nonRedDice[0], splashTargets, thread, {
          client, saveGames, dcMessageMeta, dcHealthState, dcExhaustedState,
          findDcMessageIdForFigure, buildDcEmbedAndFiles, getConditionsForDcMessage,
          getDcUpgradeAttachments, getDcEffects, logGameAction,
        });
      } else {
        game.pendingIndiscriminateFire = { attackerPlayerNum: combat.attackerPlayerNum, combatThreadId: combat.combatThreadId, targets: splashTargets, availableDice: nonRedDice };
        const ifBtns = nonRedDice.slice(0, 5).map((d, i) =>
          new ButtonBuilder().setCustomId(`indiscriminate_die_${game.gameId}_${i}`).setLabel(`${String(d.color).slice(0, 1).toUpperCase()}${String(d.color).slice(1)} (${d.dmg}dmg/${d.surge}↯)`).setStyle(ButtonStyle.Secondary)
        );
        ifBtns.push(new ButtonBuilder().setCustomId(`indiscriminate_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
        await thread.send({
          content: `<@${pcOwnerId}> **Indiscriminate Fire** — Choose 1 non-red attack die for splash:`,
          allowedMentions: { users: [pcOwnerId] },
          components: [new ActionRowBuilder().addComponents(ifBtns)],
        }).catch(discordCatch);
      }
    }
  }

  // Missile Salvo: after each salvo attack, record target + show remaining die buttons
  if (combat.attackerMsgId && game.pendingMissileSalvo?.[combat.attackerMsgId]) {
    const ms = game.pendingMissileSalvo[combat.attackerMsgId];
    if (combat.target?.figureKey) ms.targetsFired = [...(ms.targetsFired || []), combat.target.figureKey];
    if (ms.diceAvailable?.length > 0) {
      const salvoOwnerId = getPlayerId(game, combat.attackerPlayerNum);
      const colorStyle = { blue: ButtonStyle.Primary, red: ButtonStyle.Danger, yellow: ButtonStyle.Secondary };
      const salvoBtns = ms.diceAvailable.map((c) =>
        new ButtonBuilder().setCustomId(`missile_salvo_die_${c}_${game.gameId}_${combat.attackerMsgId}`).setLabel(`${c.charAt(0).toUpperCase() + c.slice(1)} Die`).setStyle(colorStyle[c] || ButtonStyle.Secondary)
      );
      salvoBtns.push(new ButtonBuilder().setCustomId(`missile_salvo_done_${game.gameId}_${combat.attackerMsgId}`).setLabel('End Salvo').setStyle(ButtonStyle.Success));
      await thread.send({
        content: `<@${salvoOwnerId}> **Missile Salvo** — ${ms.diceAvailable.length} shot${ms.diceAvailable.length !== 1 ? 's' : ''} remaining. Choose a die for your next attack (different target):`,
        components: [new ActionRowBuilder().addComponents(salvoBtns)],
        allowedMentions: { users: [salvoOwnerId] },
      }).catch(discordCatch);
    } else {
      delete game.pendingMissileSalvo[combat.attackerMsgId];
      await thread.send('**Missile Salvo** — All shots fired. Salvo complete.').catch(discordCatch);
    }
  }

  // Auto-prompt for post-attack reaction cards (Counter Attack, Dangerous Prey, Payback, etc.)
  try {
    const _ccCardsAll = getCcEffectsData?.()?.cards || {};
    const _postAtkTimings = new Set([
      'afterAttackTargetingYouResolved',
      'afterAttack',
      'afterDamage',
      'afterHostileFigureSuffersDamage',
      'afterYouResolveAttackTargetingFigure',
    ]);
    // Defender: cards triggered by being attacked
    const _defPostPn = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const _defPostId = getPlayerId(game, _defPostPn);
    const _defPostHand = getCcHand(game, _defPostPn) || [];
    const _defPostCards = [...new Set(_defPostHand)].filter(c => _ccCardsAll[c]?.timing && _postAtkTimings.has(_ccCardsAll[c].timing));
    if (_defPostCards.length) {
      await thread.send({ content: `<@${_defPostId}> — Attack resolved! You have ${_defPostCards.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [_defPostId] } }).catch(() => {});
    }
    // Attacker: cards triggered by resolving an attack
    const _atkPostTimings = new Set(['afterAttack', 'afterYouResolveAttackTargetingFigure', 'afterYouResolveAttackThatDidNotMissDueToAccuracy']);
    const _atkPostId = getPlayerId(game, combat.attackerPlayerNum);
    const _atkPostHand = getCcHand(game, combat.attackerPlayerNum) || [];
    const _atkPostCards = [...new Set(_atkPostHand)].filter(c => _ccCardsAll[c]?.timing && _atkPostTimings.has(_ccCardsAll[c].timing));
    if (_atkPostCards.length) {
      await thread.send({ content: `<@${_atkPostId}> — Attack resolved! You have ${_atkPostCards.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [_atkPostId] } }).catch(() => {});
    }
  } catch (_postAtkErr) {
    console.error('Post-attack reaction prompt error:', _postAtkErr?.message ?? _postAtkErr);
  }

  delete game.pendingCombat;
  delete game.pendingCleave;
  if (combat.rollMessageId) {
    try {
      const rollMsg = await thread.messages.fetch(combat.rollMessageId);
      await rollMsg.edit({ components: [] }).catch(discordCatch);
    } catch {}
  }
  // Autofire chain attack: grant free attack restricted to within 3 of target
  if (combat.autofireChainPending && combat.attackerMsgId) {
    game.fellSwoopFreeAttack = game.fellSwoopFreeAttack || {};
    game.fellSwoopFreeAttack[combat.attackerMsgId] = true;
    if (combat.autofireChainTargetSpace) {
      game.autofireChainTargetSpace = game.autofireChainTargetSpace || {};
      game.autofireChainTargetSpace[combat.attackerMsgId] = combat.autofireChainTargetSpace;
    }
    await logGameAction(game, client, `**Autofire** — Chain attack available! Target must be within 3 of the original target space.`, { phase: 'ROUND', icon: 'attack' });
  }
  // The Darksaber: "then you may perform an attack" — grant second free attack
  if (game.darksaberSecondAttack?.[combat.attackerMsgId]) {
    delete game.darksaberSecondAttack[combat.attackerMsgId];
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[combat.attackerMsgId] = { from: 'Darksaber Strike' };
    // Clear the override so the second attack uses normal dice
    if (game.pendingOverrideAttackDice?.[combat.attackerMsgId]) delete game.pendingOverrideAttackDice[combat.attackerMsgId];
    await thread.send('**The Darksaber** — You may now perform a normal attack (use Attack button).').catch(() => {});
  }

  for (const msgId of embedRefreshMsgIds) {
    try {
      const meta = dcMessageMeta.get(msgId);
      if (meta) {
        const channelId = getPlayAreaId(game, meta.playerNum);
        const channel = await client.channels.fetch(channelId);
        const dcMsg = await channel.messages.fetch(msgId);
        const exhausted = dcExhaustedState.get(msgId) ?? false;
        const healthState = dcHealthState.get(msgId) || [];
        const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, meta.displayName, healthState, getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, msgId));
        await dcMsg.edit({ embeds: [embed], files }).catch(discordCatch);
      }
    } catch (err) {
      console.error('Failed to update DC embed:', err);
    }
  }
  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to update map after attack:', err);
    }
  }
  // Refresh activation thread minimap after combat (conditions/actions may have changed)
  if (combat.attackerMsgId) {
    await updateDcActionsMessage(game, combat.attackerMsgId, client).catch(discordCatch);
  }
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
  // Don't deferUpdate for handlers that need to show a modal (modal requires unacknowledged interaction)
  const MODAL_PREFIXES = ['devaron_crate_push_', 'krykna_push_'];
  if (!MODAL_PREFIXES.includes(buttonKey)) {
    await interaction.deferUpdate().catch(discordCatch);
  }

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
      reduceHp, healHp, awardKillVp, awardObjectiveVp, deductVp, removeFigurePosition,

      // Data loader (imported)
      getDcEffects, getDiceData, getCcEffect, isCcAttachment, isDcAttachment,
      isDcUnique, getMapSpaces, getMapRegistry, getMapTokensData,
      getTournamentRotation, getMissionCardsData, getMissionRules, resolveDcName, isFigurelessDc,

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
