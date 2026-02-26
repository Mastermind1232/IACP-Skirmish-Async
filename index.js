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
  dcDepletedState,
  dcHealthState,
  pendingIllegalSquad,
} from './src/game-state.js';
import { rotateImage90 } from './src/dc-image-utils.js';
import { renderMap } from './src/map-renderer.js';
import { getHandlerKey } from './src/router.js';
import { replyOrFollowUpWithRetry } from './src/error-handling.js';
import { canActAsPlayer } from './src/utils/can-act-as-player.js';
import { MAX_ACTIVE_GAMES_PER_PLAYER, PENDING_ILLEGAL_TTL_MS, MAX_UNDO_DEPTH } from './src/constants.js';
import {
  getLobby,
  setLobby,
  hasLobby,
  hasLobbyEmbedSent,
  markLobbyEmbedSent,
  getLobbiesMap,
} from './src/lobby-state.js';
import {
  handleLobbyJoin,
  handleLobbyStart,
  handleRequestResolve,
  handleRequestReject,
  handleRefreshMap,
  handleRefreshAll,
  handleUndo,
  handleKillGame,
  handleBotmenuArchive,
  handleBotmenuKill,
  handleBotmenuArchiveYes,
  handleBotmenuArchiveNo,
  handleBotmenuKillYes,
  handleBotmenuKillNo,
  handleDefaultDeck,
  handleSpecialDone,
  handleInteractCancel,
  handleInteractChoice,
  handleEndEndOfRound,
  handleEndStartOfRound,
  handleMoveMp,
  handleMoveAdjustMp,
  handleMovePick,
  handleMoveLetter,
  handleMoveLetterBack,
  handleAttackTarget,
  handleCleaveTarget,
  handleCombatReady,
  handleCombatResolveReady,
  handleCombatRoll,
  handleCombatSurge,
  handleCombatReroll,
  handleCombatToken,
  handleStatusPhase,
  handlePassActivationTurn,
  handleEndTurn,
  handleDcEndActivation,
  handleConfirmActivate,
  handleCancelActivate,
  handleMapSelection,
  handleMapSelectionChoice,
  handleMapSelectionDraw,
  handleMapSelectionPick,
  handleDraftRandom,
  handleDetermineInitiative,
  handleDeploymentZone,
  handleDeploymentFig,
  handleDeploymentOrient,
  handleDeployPick,
  handleDeploymentDone,
  handleSetupAttachTo,
  handleDcActivate,
  handleDcUnactivate,
  handleDcToggle,
  handleDcDeplete,
  handleDcCcSpecial,
  handleDcCcEndOfActivation,
  handleDcCcDoubleAction,
  handleDcAction,
  handleDcAbilityChoice,
  handleArsenalPick,
  handleEe3DiePick,
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
  handlePounceSpacePick,
  handleSquadSelect,
  handleIllegalCcIgnore,
  handleIllegalCcUnplay,
  handleNegationPlay,
  handleNegationLetResolve,
  handleCelebrationPlay,
  handleCelebrationPass,
  handleFastForward,
  handleDefenderCcPlay,
  handleSpreadThePainCondPick,
  handleFigureheadDecision,
  handleLasatDiePick,
  handleLasatFacePick,
  handleFalseOrdersAtkPick,
  handleFalseOrdersAction,
  handleFalseOrdersMovePick,
  sendRerollUI,
  proceedAfterRerolls,
  sendReadyToResolveRolls,
} from './src/handlers/index.js';
import {
  validateDeckLegal,
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
  getDeployDisplayNames,
  EMBEDS_PER_MESSAGE,
  getDiscardPileButtons,
  getDcToggleButton,
  getDcPlayAreaComponents as getDcPlayAreaComponentsFromDiscord,
  getMoveMpButtonRows,
  getMoveSpaceGridRows,
  buildLetterRows,
  getSpaceChoiceRows,
  getDeployFigureLabelsFromDiscord,
  getDeployButtonRowsFromDiscord,
  getDeploySpaceGridRows,
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
  getMapSelectionMenu,
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
} from './src/data-loader.js';
import { runEndOfRoundRules, runStartOfRoundRules, runNpcThugActivation, runNpcKryknaActivation } from './src/game/mission-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname);

// Resolved once at startup; undefined if env var not set
let achievementsChannelId = process.env.ACHIEVEMENTS_CHANNEL_ID || null;

/** Build embeds and files for the "Attachments" message under a DC: CC attachments then DC (Skirmish Upgrade) attachments. */
async function buildAttachmentEmbedsAndFiles(ccNames, dcNames = []) {
  const embeds = [];
  const files = [];
  for (let i = 0; i < (ccNames || []).length; i++) {
    const card = ccNames[i];
    const path = getCommandCardImagePath(card);
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `cc-attach-${i}-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(`📎 ${card || `Attachment ${i + 1}`}`)
      .setColor(0x5865f2);
    if (path && existsSync(path)) {
      files.push(new AttachmentBuilder(path, { name: fileName }));
      embed.setThumbnail(`attachment://${fileName}`);
    }
    embeds.push(embed);
  }
  for (let i = 0; i < (dcNames || []).length; i++) {
    const dcName = dcNames[i];
    const relPath = getDcImagePath(dcName);
    const path = relPath ? join(rootDir, relPath) : null;
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `dc-attach-${i}-${(dcName || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(`📎 ${dcName || `Skirmish Upgrade ${i + 1}`}`)
      .setColor(0x5865f2);
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
  const ccKey = playerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
  const dcKey = playerNum === 1 ? 'p1DcAttachments' : 'p2DcAttachments';
  const msgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
  const attachMsgIdsKey = playerNum === 1 ? 'p1DcAttachmentMessageIds' : 'p2DcAttachmentMessageIds';
  game[attachMsgIdsKey] = game[attachMsgIdsKey] || [];
  const attachMsgIds = game[attachMsgIdsKey];
  const idx = msgIds.indexOf(dcMsgId);
  if (idx < 0) return;
  while (attachMsgIds.length <= idx) attachMsgIds.push(null);
  const attachMsgId = attachMsgIds[idx];
  const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
  const ccList = (game[ccKey] || {})[dcMsgId] || [];
  const dcList = (game[dcKey] || {})[dcMsgId] || [];
  const hasContent = ccList.length > 0 || dcList.length > 0;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!attachMsgId) {
      if (!hasContent) return;
      const { embeds, files } = await buildAttachmentEmbedsAndFiles(ccList, dcList);
      const newMsg = await channel.send({ embeds, files });
      attachMsgIds[idx] = newMsg.id;
      return;
    }
    if (!hasContent) {
      const msg = await channel.messages.fetch(attachMsgId);
      await msg.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
      attachMsgIds[idx] = null;
      return;
    }
    const msg = await channel.messages.fetch(attachMsgId);
    const { embeds, files } = await buildAttachmentEmbedsAndFiles(ccList, dcList);
    await msg.edit({ embeds, files });
  } catch (err) {
    console.error('Failed to update attachment message for DC:', err);
  }
}

/** True if this DC can legally play this CC (for Special Action timing). playableBy: "Any Figure", specific name, or trait. Handles compound "X or Y" playableBy. */
function isCcPlayableByDc(ccName, dcName, displayName) {
  const effect = getCcEffect(ccName);
  if (!effect || (effect.timing || '').toLowerCase() !== 'specialaction') return false;
  const playableBy = (effect.playableBy || '').trim();
  if (!playableBy) return false;
  if (playableBy.toLowerCase() === 'any figure') return true;
  const dcBase = (dcName || '')
    .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
    .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
    .trim();
  const displayBase = (displayName || dcBase)
    .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
    .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
    .trim();
  const d = dcBase.toLowerCase();
  const disp = displayBase.toLowerCase();
  const keywords = getDcKeywords()[dcName] || getDcKeywords()[dcBase];
  const alternatives = playableBy.split(/\s+or\s+/i).map((s) => s.trim().toLowerCase());
  for (const p of alternatives) {
    if (d.includes(p) || p.includes(d) || disp.includes(p) || p.includes(disp)) return true;
    if (keywords && Array.isArray(keywords) && keywords.some((k) => String(k).toLowerCase() === p)) return true;
  }
  return false;
}

/** CC names in hand that are Special Action and legally playable by this DC. */
function getPlayableCcSpecialsForDc(game, playerNum, dcName, displayName) {
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  return hand.filter((ccName) => isCcPlayableByDc(ccName, dcName, displayName));
}

/** True if this DC can legally play this CC (for Double Action Special timing). */
function isCcDoubleActionPlayableByDc(ccName, dcName, displayName) {
  const effect = getCcEffect(ccName);
  if (!effect || (effect.timing || '').toLowerCase() !== 'doubleactionspecial') return false;
  const playableBy = (effect.playableBy || '').trim();
  if (!playableBy) return false;
  if (playableBy.toLowerCase() === 'any figure') return true;
  const dcBase = (dcName || '')
    .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
    .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
    .trim();
  const displayBase = (displayName || dcBase)
    .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
    .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
    .trim();
  const d = dcBase.toLowerCase();
  const disp = displayBase.toLowerCase();
  const keywords = getDcKeywords()[dcName] || getDcKeywords()[dcBase];
  const alternatives = playableBy.split(/\s+or\s+/i).map((s) => s.trim().toLowerCase());
  for (const p of alternatives) {
    if (d.includes(p) || p.includes(d) || disp.includes(p) || p.includes(disp)) return true;
    if (keywords && Array.isArray(keywords) && keywords.some((k) => String(k).toLowerCase() === p)) return true;
  }
  return false;
}

/** CC names in hand that are Double Action Special and legally playable by this DC. */
function getPlayableCcDoubleActionsForDc(game, playerNum, dcName, displayName) {
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  return hand.filter((ccName) => isCcDoubleActionPlayableByDc(ccName, dcName, displayName));
}

/** CC names in hand that are End-of-Activation timing and legally playable by this DC. */
function getPlayableCcEndOfActivationForDc(game, playerNum, dcName, displayName) {
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  return hand.filter((ccName) => {
    const effect = getCcEffect(ccName);
    if (!effect || (effect.timing || '').toLowerCase() !== 'endofactivation') return false;
    const playableBy = (effect.playableBy || '').trim();
    if (!playableBy || playableBy.toLowerCase() === 'any figure') return true;
    const dcBase = (dcName || '').replace(/\s*\[(?:DG|Group) \d+\]$/i, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
    const displayBase = (displayName || dcBase).replace(/\s*\[(?:DG|Group) \d+\]$/i, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
    const d = dcBase.toLowerCase();
    const disp = displayBase.toLowerCase();
    const keywords = getDcKeywords()[dcName] || getDcKeywords()[dcBase];
    const alternatives = playableBy.split(/\s+or\s+/i).map((s) => s.trim().toLowerCase());
    for (const p of alternatives) {
      if (d.includes(p) || p.includes(d) || disp.includes(p) || p.includes(disp)) return true;
      if (keywords && Array.isArray(keywords) && keywords.some((k) => String(k).toLowerCase() === p)) return true;
    }
    return false;
  });
}

/** Get set of normalized coords occupied by a player's figures. */
function getPlayerOccupiedCells(game, playerNum) {
  const cells = new Set();
  const poses = game.figurePositions?.[playerNum] || {};
  for (const [k, coord] of Object.entries(poses)) {
    const dcName = k.replace(/-\d+-\d+$/, '');
    const size = game.figureOrientations?.[k] || getFigureSize(dcName);
    for (const c of getFootprintCells(coord, size)) {
      cells.add(normalizeCoord(c));
    }
  }
  return cells;
}

/** Extract flat coordinate array from a missionA/missionB token data block (generic — no hardcoded key names). */
function getMissionTokenCoords(missionTokenData) {
  if (!missionTokenData) return [];
  if (missionTokenData.positions && typeof missionTokenData.positions === 'object') {
    return Object.values(missionTokenData.positions).flat();
  }
  for (const val of Object.values(missionTokenData)) {
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') return val;
  }
  return [];
}

/** True if figure is adjacent to or on a mission token space (for the given mission side). */
function isFigureAdjacentOrOnMissionToken(game, playerNum, figureKey, mapId, missionSide) {
  const mapData = getMapTokensData()[mapId];
  const coords = getMissionTokenCoords(mapData?.[missionSide]);
  if (!coords.length) return false;
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return false;
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const tokenSet = toLowerSet(coords);
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return false;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const footprint = getFootprintCells(pos, game.figureOrientations?.[figureKey] || getFigureSize(dcName));
  for (const c of footprint) {
    const n = normalizeCoord(c);
    if (tokenSet.has(n)) return true;
    for (const adj of adjacency[n] || []) {
      if (tokenSet.has(normalizeCoord(adj))) return true;
    }
  }
  return false;
}

/** Effective speed, accounting for mission-defined carry penalty and round bonuses (Fuel Upgrade, etc.). */
function getEffectiveSpeed(dcName, figureKey, game, playerNum) {
  let base = getDcStats(dcName).speed ?? 4;
  const mech = game?.selectedMission?.mechanics;
  if (mech?.type === 'carry' && mech.speedPenalty && game.figureContraband?.[figureKey]) {
    base = Math.max(0, base + mech.speedPenalty);
  }
  // Fuel Upgrade: round VEHICLE speed bonus
  if (playerNum && game?.roundVehicleSpeedBonus?.[playerNum]) {
    const eff = getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
    const keywords = (eff?.keywords || []).map((k) => String(k).toUpperCase());
    if (keywords.includes('VEHICLE')) base += game.roundVehicleSpeedBonus[playerNum];
  }
  return base;
}

/** True if figure is in player's deployment zone. */
function isFigureInDeploymentZone(game, playerNum, figureKey, mapId) {
  const zoneData = getDeploymentZones()[mapId];
  if (!zoneData) return false;
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const zone = playerNum === initPlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const zoneSpaces = toLowerSet(zoneData[zone] || []);
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return false;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const footprint = getFootprintCells(pos, game.figureOrientations?.[figureKey] || getFigureSize(dcName));
  return footprint.some((c) => zoneSpaces.has(normalizeCoord(c)));
}

/** True if figure footprint or any adjacent cell is in the given coord set. */
function isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, coordSet) {
  return getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, coordSet).length > 0;
}

/** Returns coords from coordSet that the figure is on or adjacent to. */
function getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, coordSet) {
  if (!coordSet?.size) return [];
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return [];
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return [];
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const footprint = getFootprintCells(pos, game.figureOrientations?.[figureKey] || getFigureSize(dcName));
  const result = new Set();
  for (const c of footprint) {
    const n = normalizeCoord(c);
    if (coordSet.has(n)) result.add(n);
    for (const adj of adjacency[n] || []) {
      const na = normalizeCoord(adj);
      if (coordSet.has(na)) result.add(na);
    }
  }
  return [...result];
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

/** Returns legal interact options for a figure. Mission-specific first (blue), standard (grey). */
function getLegalInteractOptions(game, playerNum, figureKey, mapId) {
  const options = [];
  const mapData = getMapTokensData()[mapId];
  if (!mapData) return options;

  const variant = game?.selectedMission?.variant;
  const interactLabel = game?.selectedMission?.interactLabel;
  const mech = game?.selectedMission?.mechanics;

  if (interactLabel && mech?.type === 'carry') {
    const missionSide = variant === 'a' ? 'missionA' : 'missionB';
    if (!game.figureContraband?.[figureKey] && isFigureAdjacentOrOnMissionToken(game, playerNum, figureKey, mapId, missionSide)) {
      options.push({ id: 'retrieve_contraband', label: interactLabel, missionSpecific: true });
    }
  }

  if (interactLabel && mech?.type === 'flip') {
    const missionSide = variant === 'a' ? 'missionA' : 'missionB';
    const tokenCoords = getMissionTokenCoords(mapData[missionSide]);
    const flippedThisRound = playerNum === 1 ? game.p1LaunchPanelFlippedThisRound : game.p2LaunchPanelFlippedThisRound;
    if (tokenCoords.length && !(mech?.flipLimitPerRound && flippedThisRound)) {
      const panelSet = toLowerSet(tokenCoords);
      const adjacent = getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, panelSet);
      for (const coord of adjacent) {
        const upper = String(coord).toUpperCase();
        options.push({ id: `launch_panel_${coord}_colored`, label: `${interactLabel} (${upper}) → Colored`, missionSpecific: true });
        options.push({ id: `launch_panel_${coord}_gray`, label: `${interactLabel} (${upper}) → Gray`, missionSpecific: true });
      }
    }
  }

  const terminals = mapData.terminals || [];
  if (terminals.length && isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, toLowerSet(terminals))) {
    options.push({ id: 'use_terminal', label: 'Use Terminal', missionSpecific: false });
  }

  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  for (const edge of mapData.doors || []) {
    if (edge?.length < 2) continue;
    const ek = edgeKey(edge[0], edge[1]);
    if (openedSet.has(ek)) continue;
    const coordSet = toLowerSet(edge);
    if (isFigureAdjacentOrOnAny(game, playerNum, figureKey, mapId, coordSet)) {
      const label = `Open Door (${String(edge[0]).toUpperCase()}–${String(edge[1]).toUpperCase()})`;
      options.push({ id: `open_door_${ek}`, label, missionSpecific: false });
    }
  }

  return options;
}

/** Returns 1, 2, or null for who controls this space (only they have figure on/adjacent). Same logic as terminals. */
function getSpaceController(game, mapId, coord) {
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return null;
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const t = normalizeCoord(coord);
  const controlSet = new Set([t, ...(adjacency[t] || []).map((n) => normalizeCoord(n))]);
  const p1Cells = getPlayerOccupiedCells(game, 1);
  const p2Cells = getPlayerOccupiedCells(game, 2);
  const p1Has = [...controlSet].some((c) => p1Cells.has(c));
  const p2Has = [...controlSet].some((c) => p2Cells.has(c));
  if (p1Has && !p2Has) return 1;
  if (p2Has && !p1Has) return 2;
  return null;
}

/** Returns array of figure keys for playerNum whose positions are on or adjacent to coord. */
function getFiguresOnOrAdjacentToSpace(game, playerNum, coord, mapId) {
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return [];
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces?.adjacency || {};
  const t = normalizeCoord(coord);
  const controlSet = new Set([t, ...(adjacency[t] || []).map((n) => normalizeCoord(n))]);
  const result = [];
  const poses = game.figurePositions?.[playerNum] || {};
  for (const [figKey, figCoord] of Object.entries(poses)) {
    if (controlSet.has(normalizeCoord(figCoord))) result.push(figKey);
  }
  return result;
}

/** Count terminals exclusively controlled by player (on or adjacent; only they have presence). */
function countTerminalsControlledByPlayer(game, playerNum, mapId) {
  const mapData = getMapTokensData()[mapId];
  if (!mapData?.terminals?.length) return 0;
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return 0;
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};

  const p1Cells = getPlayerOccupiedCells(game, 1);
  const p2Cells = getPlayerOccupiedCells(game, 2);

  let count = 0;
  for (const term of mapData.terminals) {
    const t = normalizeCoord(term);
    const controlSet = new Set([t, ...(adjacency[t] || []).map((n) => normalizeCoord(n))]);
    const p1Has = [...controlSet].some((c) => p1Cells.has(c));
    const p2Has = [...controlSet].some((c) => p2Cells.has(c));
    if (playerNum === 1 && p1Has && !p2Has) count++;
    if (playerNum === 2 && p2Has && !p1Has) count++;
  }
  return count;
}

/** Manhattan distance in spaces between two coords. */
function getRange(coord1, coord2) {
  const a = parseCoord(coord1);
  const b = parseCoord(coord2);
  if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) return 999;
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * Convert an impassable edge (pair of coord strings for adjacent spaces) to its
 * geometric wall segment — the shared boundary line between the two spaces.
 */
function impassableEdgeToWallSegment(c1, c2) {
  const a = parseCoord(String(c1).toLowerCase());
  const b = parseCoord(String(c2).toLowerCase());
  if (a.col < 0 || b.col < 0) return null;
  const dc = b.col - a.col;
  const dr = b.row - a.row;
  if (Math.abs(dc) + Math.abs(dr) !== 1) return null; // non-adjacent, skip
  if (dr === 0) {
    // Horizontal neighbors → vertical wall between them
    const x = Math.min(a.col, b.col) + 0.5;
    return { x1: x, y1: a.row - 0.5, x2: x, y2: a.row + 0.5 };
  } else {
    // Vertical neighbors → horizontal wall between them
    const y = Math.min(a.row, b.row) + 0.5;
    return { x1: a.col - 0.5, y1: y, x2: a.col + 0.5, y2: y };
  }
}

/** Check if two line segments strictly intersect (not at endpoints). */
function segmentsStrictlyIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d1x = x2 - x1, d1y = y2 - y1;
  const d2x = x4 - x3, d2y = y4 - y3;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false; // parallel
  const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / denom;
  const u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / denom;
  const EPS = 1e-6;
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
}

/**
 * Collect all grid cells (col, row) whose interior a line segment passes through.
 * Samples every 0.25 units along the line — fine enough for 1-unit cells.
 */
function getCellsAlongLine(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const seen = new Set();
  const result = [];
  const steps = Math.max(Math.ceil(len * 4), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const col = Math.round(x1 + t * dx);
    const row = Math.round(y1 + t * dy);
    const key = `${col},${row}`;
    if (!seen.has(key)) { seen.add(key); result.push([col, row]); }
  }
  return result;
}

/**
 * Line-of-sight: corner-to-corner tracing per IA rules.
 * LOS exists if ANY line from a corner of coord1's space to a corner of coord2's space
 * is unobstructed by blocking terrain or solid walls (impassable edges).
 * Dotted red movementBlockingEdges do NOT block LOS.
 */
function hasLineOfSight(coord1, coord2, mapSpaces, figureBlockingCoords) {
  const blockingSet = new Set((mapSpaces?.blocking || []).map((s) => String(s).toLowerCase()));
  const impassableEdges = mapSpaces?.impassableEdges || [];
  const a = parseCoord(coord1);
  const b = parseCoord(coord2);
  if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) return false;
  if (a.col === b.col && a.row === b.row) return true;

  // Pre-build wall segments from impassable edges
  const walls = [];
  for (const edge of impassableEdges) {
    const seg = impassableEdgeToWallSegment(edge[0], edge[1]);
    if (seg) walls.push(seg);
  }

  // 4 corners of a space, slightly inset so exact corner touches don't count
  const INSET = 0.49;
  const corners = (col, row) => [
    [col - INSET, row - INSET],
    [col + INSET, row - INSET],
    [col - INSET, row + INSET],
    [col + INSET, row + INSET],
  ];

  const aCorners = corners(a.col, a.row);
  const bCorners = corners(b.col, b.row);

  // LOS exists if ANY corner-to-corner pair has a clear line
  for (const [ax, ay] of aCorners) {
    for (const [bx, by] of bCorners) {
      // 1. Check wall crossings
      let wallBlocked = false;
      for (const w of walls) {
        if (segmentsStrictlyIntersect(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2)) {
          wallBlocked = true;
          break;
        }
      }
      if (wallBlocked) continue;
      // 2. Check for blocking spaces along the path (skip attacker and target cells)
      const cells = getCellsAlongLine(ax, ay, bx, by);
      let spaceBlocked = false;
      for (const [col, row] of cells) {
        if (col === a.col && row === a.row) continue;
        if (col === b.col && row === b.row) continue;
        if (blockingSet.has(colRowToCoord(col, row))) { spaceBlocked = true; break; }
        if (figureBlockingCoords?.has(colRowToCoord(col, row))) { spaceBlocked = true; break; }
      }
      if (!spaceBlocked) return true; // this corner pair is clear
    }
  }
  return false;
}

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

function collectOverlappingFigures(game, movingPlayerNum, movingFigureKey, footprint) {
  const overlapsFriendly = [];
  const overlapsEnemy = [];
  for (const p of [1, 2]) {
    const poses = game.figurePositions?.[p] || {};
    for (const [key, coord] of Object.entries(poses)) {
      if (key === movingFigureKey) continue;
      const dcName = key.replace(/-\d+-\d+$/, '');
      const size = game.figureOrientations?.[key] || getFigureSize(dcName);
      const cells = getNormalizedFootprint(coord, size);
      const intersects = cells.some((cell) => footprint.has(cell));
      if (!intersects) continue;
      const entry = { playerNum: p, figureKey: key, dcName };
      if (p === movingPlayerNum) overlapsFriendly.push(entry);
      else overlapsEnemy.push(entry);
    }
  }
  return [...overlapsFriendly, ...overlapsEnemy];
}

function pushFigureToNearestValid(game, playerNum, figureKey, forbiddenSet) {
  const coord = game.figurePositions?.[playerNum]?.[figureKey];
  if (!coord) return false;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const board = getBoardStateForMovement(game, figureKey);
  if (!board) return false;
  const profile = getMovementProfile(dcName, figureKey, game);
  const startTopLeft = normalizeCoord(coord);
  const queue = [startTopLeft];
  const visited = new Set([movementStateKey(startTopLeft, profile.size)]);
  while (queue.length > 0) {
    const topLeft = queue.shift();
    const footprint = new Set(getNormalizedFootprint(topLeft, profile.size));
    const overlapForbidden = [...footprint].some((cell) => forbiddenSet.has(cell));
    const overlapOther = [...footprint].some((cell) => board.occupiedSet.has(cell));
    const blocked = !profile.ignoreBlocking && [...footprint].some((cell) => board.blockingSet.has(cell));
    if (!overlapForbidden && !overlapOther && !blocked) {
      game.figurePositions[playerNum][figureKey] = topLeft;
      return true;
    }
    const moveVectors = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    for (const vec of moveVectors) {
      const nextTopLeft = shiftCoord(topLeft, vec.dx, vec.dy);
      if (!board.spacesSet.has(nextTopLeft)) continue;
      const stateKey = movementStateKey(nextTopLeft, profile.size);
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      queue.push(nextTopLeft);
    }
  }
  return false;
}

async function resolveMassivePush(game, profile, figureKey, playerNum, newFootprint, client) {
  if (!profile.canEndOnOccupied) return;
  const footprintSet = new Set(newFootprint);
  const overlaps = collectOverlappingFigures(game, playerNum, figureKey, footprintSet);
  for (const entry of overlaps) {
    const success = pushFigureToNearestValid(game, entry.playerNum, entry.figureKey, footprintSet);
    if (!success) {
      console.warn(`Failed to push ${entry.figureKey} away from massive figure ${figureKey}`);
    }
  }
  if (overlaps.length > 0) {
    await logGameAction(game, client, `Massive figure pushed ${overlaps.length} figure(s) aside.`, { icon: 'move', phase: 'ROUND' });
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
      if (msg) await msg.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  { name: 'Fast' },
  { name: 'Hyperspeed' },
  { name: 'Ranked' },
  { name: 'Test' },
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

const IMAGES_DIR = join(rootDir, 'vassal_extracted', 'images');
const CC_DIR = join(IMAGES_DIR, 'cc');
const CARDBACKS_DIR = join(IMAGES_DIR, 'cardbacks');

/** Resolve command card image path. Looks in cc/ subfolder first, then root. Tries C card--Name, IACP variants. Returns cardback path if not found. */
function getCommandCardImagePath(cardName) {
  if (!cardName || typeof cardName !== 'string') return null;
  const clean = cardName.replace(/[':]/g, '').replace(/\s+/g, ' ').trim();
  const iacp = `${cardName} (IACP)`;
  const cleanIacp = `${clean} (IACP)`;
  const candidates = [];
  if (cardName.trim().toLowerCase() === 'smoke grenade') {
    candidates.push('Smoke Grenade Final.png', '003 Smoke Grenade Final.png');
  }
  for (const base of [iacp, cleanIacp, cardName, clean]) {
    candidates.push(`${base}.jpg`, `${base}.png`);
  }
  for (const base of [cardName, clean]) {
    candidates.push(
      `C card--${base}.jpg`,
      `C card--${base}.png`,
      `IACP_C card--${base}.png`,
      `IACP_C card--${base}.jpg`,
      `IACP9_C card--${base}.png`,
      `IACP9_C card--${base}.jpg`,
      `IACP10_C card--${base}.png`,
      `IACP10_C card--${base}.jpg`,
      `IACP11_C card--${base}.png`,
      `IACP11_C card--${base}.jpg`,
    );
  }
  for (const c of candidates) {
    const inCc = join(CC_DIR, c);
    if (existsSync(inCc)) return inCc;
    const inRoot = join(IMAGES_DIR, c);
    if (existsSync(inRoot)) return inRoot;
  }
  const cardbackCandidates = [
    join(CARDBACKS_DIR, 'Command cardback.jpg'),
    join(CC_DIR, 'Command cardback.jpg'),
    join(IMAGES_DIR, 'Command cardback.jpg'),
  ];
  for (const p of cardbackCandidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Get window button row for Hand channel when in End of Round window and it's this player's turn. */
function getHandWindowButtonRow(game, playerNum, gameId) {
  if (!game) return null;
  const whoseTurn = game.endOfRoundWhoseTurn;
  const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (!whoseTurn || whoseTurn !== playerId) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`end_end_of_round_${gameId}`)
      .setLabel(`End 'End of Round' window`)
      .setStyle(ButtonStyle.Primary)
  );
}

/** Build hand channel message payload: vertical list of embeds, one per CC, same thumbnail size as DC embeds in Play Area. */
function buildHandDisplayPayload(hand, deck, gameId, game = null, playerNum = 1) {
  const files = [];
  const embeds = [];

  // Header embed
  embeds.push(new EmbedBuilder()
    .setTitle('Command Cards in Hand')
    .setDescription(`**${hand.length}** cards in hand • **${deck.length}** in deck`)
    .setColor(0x2f3136));

  // One embed per card (thumbnail = same size as DC embeds in Play Area)
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    const path = getCommandCardImagePath(card);
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `cc-${i}-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(card || `Card ${i + 1}`)
      .setColor(0x2f3136);
    if (path && existsSync(path)) {
      files.push(new AttachmentBuilder(path, { name: fileName }));
      embed.setThumbnail(`attachment://${fileName}`);
    }
    embeds.push(embed);
  }

  const content = hand.length > 0
    ? `**Hand:** ${hand.join(', ')}\n**Deck:** ${deck.length} cards remaining.`
    : `**Hand:** (empty)\n**Deck:** ${deck.length} cards remaining.`;
  const hasHandOrDeck = hand.length > 0 || deck.length > 0;
  const rows = hasHandOrDeck ? [getCcActionButtons(gameId, hand, deck)] : [];
  const windowRow = getHandWindowButtonRow(game, playerNum, gameId);
  if (windowRow) rows.push(windowRow);
  return {
    content,
    embeds,
    files: files.length > 0 ? files : undefined,
    components: rows,
  };
}

/** Sanitize a display name for use in Discord channel names (lowercase, alphanumeric + hyphens, max 16 chars). */
function channelSafeName(displayName) {
  return (displayName || 'player')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 16) || 'player';
}

/** Get a short channel-safe display name for a user ID. */
async function getPlayerChannelName(guild, userId) {
  try {
    const member = await guild.members.fetch(userId);
    return channelSafeName(member.displayName);
  } catch {
    return channelSafeName(userId.slice(-6));
  }
}

/** Create p1 and p2 Play Area channels. */
async function createPlayAreaChannels(guild, gameCategory, prefix, player1Id, player2Id) {
  const p1Name = await getPlayerChannelName(guild, player1Id);
  const p2Name = await getPlayerChannelName(guild, player2Id);
  const playAreaPerms = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessagesInThreads, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessagesInThreads, deny: PermissionFlagsBits.SendMessages },
    { id: guild.client.user.id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads | PermissionFlagsBits.ManageThreads | PermissionFlagsBits.SendMessagesInThreads },
  ];
  const p1 = await guild.channels.create({
    name: `${prefix} ${p1Name}-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  const p2 = await guild.channels.create({
    name: `${prefix} ${p2Name}-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  return { p1PlayAreaChannel: p1, p2PlayAreaChannel: p2 };
}

/** Create private hand threads inside each player's play area channel. */
async function createHandThreads(client, game) {
  const p1PlayArea = await client.channels.fetch(game.p1PlayAreaId);
  const p2PlayArea = await client.channels.fetch(game.p2PlayAreaId);
  const p1Thread = await p1PlayArea.threads.create({
    name: 'Your Hand',
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    type: ChannelType.PrivateThread,
    invitable: false,
  });
  await p1Thread.members.add(game.player1Id).catch((err) => { console.error('[discord]', err?.message ?? err); });
  const p2Thread = await p2PlayArea.threads.create({
    name: 'Your Hand',
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    type: ChannelType.PrivateThread,
    invitable: false,
  });
  await p2Thread.members.add(game.player2Id).catch((err) => { console.error('[discord]', err?.message ?? err); });
  game.p1HandId = p1Thread.id;
  game.p2HandId = p2Thread.id;
  return { p1HandThread: p1Thread, p2HandThread: p2Thread };
}

async function createGameChannels(guild, player1Id, player2Id) {
  // Scan for existing IA Game #XXXXX categories (active, archived, completed) so we never reuse an ID
  await guild.channels.fetch();
  const gameCategories = guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildCategory && /^IA Game #(\d+)$/.test(c.name)
  );
  const maxId = gameCategories.reduce((max, c) => {
    const m = c.name.match(/^IA Game #(\d+)$/);
    const n = m ? parseInt(m[1], 10) : 0;
    return Math.max(max, n);
  }, 0);
  const nextId = maxId + 1;
  gameIdCounter = nextId + 1; // keep in sync for any future use
  const gameId = String(nextId).padStart(5, '0');
  const prefix = `IA${gameId}`;
  const everyoneRole = guild.roles.everyone;
  const botId = guild.client.user.id;

  const playerPerms = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel },
    { id: botId, allow: PermissionFlagsBits.ViewChannel },
  ];

  const gamesCategory = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORIES.games
  );
  const position = gamesCategory ? gamesCategory.position + 1 : 0;

  const gameCategory = await guild.channels.create({
    name: `IA Game #${gameId}`,
    type: ChannelType.GuildCategory,
    permissionOverwrites: playerPerms,
    position,
  });

  const gameLogPerms = [
    ...playerPerms.filter((p) => p.id !== botId),
    { id: botId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageMessages },
  ];
  const generalChannel = await guild.channels.create({
    name: `${prefix} Game Log`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: gameLogPerms,
  });
  return { gameCategory, gameId, generalChannel };
}

/** Create the Map Updates channel for a game. Call AFTER play area channels so it appears last. */
async function createBoardChannel(guild, gameCategory, prefix, player1Id, player2Id) {
  const everyoneRole = guild.roles.everyone;
  const botId = guild.client.user.id;
  const boardPerms = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: botId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageMessages },
  ];
  return await guild.channels.create({
    name: `${prefix} Map Updates`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: boardPerms,
  });
}

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

async function createTestGame(client, guild, userId, scenarioId, feedbackChannel, options = {}) {
  if (testGameCreationInProgress.has(userId)) {
    throw new Error('A test game is already being created. Please wait.');
  }
  if (countActiveGamesForPlayer(userId) >= MAX_ACTIVE_GAMES_PER_PLAYER) {
    throw new Error(`You are already in **${MAX_ACTIVE_GAMES_PER_PLAYER}** active games. Finish or leave a game before creating another.`);
  }
  testGameCreationInProgress.add(userId);
  try {
    const botId = client.user.id;
    const p2Id = options.player2Id || botId;
    const p2IsBot = p2Id === botId;
    const { gameId, generalChannel } =
      await createGameChannels(guild, userId, p2Id);
    const game = {
      gameId,
      version: CURRENT_GAME_VERSION,
      gameCategoryId: generalChannel.parentId,
      player1Id: userId,
      player2Id: p2Id,
      generalId: generalChannel.id,
      chatId: null,
      boardId: null,
      p1HandId: null,
      p2HandId: null,
      p1PlayAreaId: null,
      p2PlayAreaId: null,
      player1Squad: null,
      player2Squad: null,
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },
      isTestGame: true,
      testP2IsBot: p2IsBot,
      testScenario: scenarioId || undefined,
      testScenarioPrimaryCard: scenarioId ? getScenarioPrimaryCard(scenarioId) : undefined,
      ended: false,
    };
    setGame(gameId, game);

    const scenarioImplemented = scenarioId && IMPLEMENTED_SCENARIOS.includes(scenarioId);
    const p2Label = p2IsBot ? 'the bot' : `<@${p2Id}>`;
    const mentionUsers = p2IsBot ? [userId] : [userId, p2Id];
    const killRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kill_game_${gameId}`).setLabel('Kill Test Game').setStyle(ButtonStyle.Danger),
    );
    if (scenarioImplemented) {
      await runDraftRandom(game, client, { scenarioId });
      const scenarioPrimaryCard = getScenarioPrimaryCard(scenarioId);
      const ccEffectData = scenarioPrimaryCard ? getCcEffect(scenarioPrimaryCard) : null;
      const effectText = ccEffectData?.effect || '';
      const timingText = ccEffectData?.timing || '';
      const costText = ccEffectData?.cost != null ? `Cost: ${ccEffectData.cost}` : '';
      const cardDetails = [costText, timingText].filter(Boolean).join(' · ');
      const timingInfo = scenarioPrimaryCard ? getTimingTestInfo(scenarioPrimaryCard) : null;
      const howToTest = timingInfo?.prompt || 'Activate a DC, then play the card.';
      const opponentNote = timingInfo?.needsOpponent ? '\n⚠️ **This card requires P2 to act.** Switch to your P2 account when instructed.' : '';
      const testPrompt = scenarioPrimaryCard
        ? `🧪 <@${userId}> — **Testing: ${scenarioPrimaryCard}** (scenario: \`${scenarioId}\`)\n${cardDetails ? `*${cardDetails}*\n` : ''}> *${effectText}*\n\n**How to test:** ${howToTest}${opponentNote}\nThe card is in P1's **Your Hand** thread (inside Play Area).`
        : `🧪 <@${userId}> — **Testing scenario: \`${scenarioId}\`**`;
      await generalChannel.send({ content: testPrompt, allowedMentions: { users: [userId] } }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      await generalChannel.send({ content: `Done testing? Kill the game here:`, components: [killRow] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      const scenarioDoneText = scenarioPrimaryCard
        ? `Test game **IA Game #${gameId}** ready (P1 <@${userId}> vs P2 ${p2Label})! Go to **Game Log** for Round 1. P1's **Your Hand** thread (inside Play Area) has **${scenarioPrimaryCard}**. **How to test:** ${howToTest}`
        : `Test game **IA Game #${gameId}** ready (P1 <@${userId}> vs P2 ${p2Label})! Go to **Game Log** for Round 1. Scenario: **${scenarioId}**.`;
      if (options.editMessageInstead) {
        await options.editMessageInstead.edit({ content: scenarioDoneText, allowedMentions: { users: mentionUsers } }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      } else {
        await feedbackChannel.send({
          content: scenarioDoneText,
          allowedMentions: { users: mentionUsers },
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
    } else {
      const setupDesc = p2IsBot
        ? '**Test game** — You play as P1 vs the bot as P2. Select the map below. Play Areas with **Your Hand** threads will then appear; use them to pick decks (Select Squad or Default Rebels / Scum / Imperial) for each side.'
        : `**Test game** — <@${userId}> is P1, <@${p2Id}> is P2. Select the map below. Play Areas with **Your Hand** threads will then appear; use them to pick decks.`;
      const setupMsg = await generalChannel.send({
        content: `<@${userId}> — **Test game** created. You are P1, P2 is ${p2Label}. Map Selection below — Play Areas (with **Your Hand** threads) will appear after map selection.`,
        allowedMentions: { users: mentionUsers },
        embeds: [
          new EmbedBuilder()
            .setTitle('Game Setup (Test)')
            .setDescription(setupDesc)
            .setColor(0x2f3136),
        ],
        components: [getGeneralSetupButtons(game)],
      });
      game.generalSetupMessageId = setupMsg.id;
      await generalChannel.send({ content: `🧪 **Test Game #${gameId}** — done? Kill it here:`, components: [killRow] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      const doneText = scenarioId && !scenarioImplemented
        ? `Scenario **${scenarioId}** is not yet implemented. Test game **IA Game #${gameId}** created with standard setup — select the map in Game Log.`
        : `Test game **IA Game #${gameId}** is ready (P1 <@${userId}> vs P2 ${p2Label})! Select the map in Game Log — Play Areas (with **Your Hand** threads) will appear after map selection.`;
      if (options.editMessageInstead) {
        await options.editMessageInstead.edit({ content: doneText, allowedMentions: { users: mentionUsers } }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      } else {
        await feedbackChannel.send({
          content: doneText,
          allowedMentions: { users: mentionUsers },
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
    }
    saveGames();
    return { gameId };
  } finally {
    testGameCreationInProgress.delete(userId);
  }
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

function extractGameIdFromMessage(message) {
  const chId = message.channel?.id;
  if (!chId) return null;
  for (const [gameId, g] of getGamesMap()) {
    if (g.generalId === chId || g.chatId === chId || g.boardId === chId ||
        g.p1HandId === chId || g.p2HandId === chId || g.p1PlayAreaId === chId || g.p2PlayAreaId === chId) {
      return gameId;
    }
  }
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
    await sentMsg.pin().catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  const isInitiative = playerNum === (game.initiativePlayerId === game.player1Id ? 1 : 2);
  const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
  const msgIds = game[idsKey];
  if (!msgIds?.length) return;
  const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
  const zone = isInitiative ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
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

/** Convert game.figurePositions to renderMap figures format. Uses circular figure images from figure-images.json. */
function getFiguresForRender(game) {
  const pos = game.figurePositions;
  if (!pos || (!pos[1] && !pos[2])) return [];
  const figures = [];
  const zoneColors = { red: '#e74c3c', blue: '#3498db' };
  const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const chosen = game.deploymentZoneChosen;
  if (!chosen) return figures;
  const otherZone = chosen === 'red' ? 'blue' : 'red';
  for (const p of [1, 2]) {
    const zone = p === initiativePlayerNum ? chosen : otherZone;
    const color = zoneColors[zone] || '#888';
    const poses = pos[p] || {};
    const dcList = (p === 1 ? game.player1Squad : game.player2Squad)?.dcList || [];
    const totals = {};
    for (const d of dcList) {
      const n = resolveDcName(d);
      if (n && !isFigurelessDc(n)) totals[n] = (totals[n] || 0) + 1;
    }
    for (const [figureKey, space] of Object.entries(poses)) {
      const dcName = figureKey.replace(/-\d+-\d+$/, '');
      const m = figureKey.match(/-(\d+)-(\d+)$/);
      const dgIndex = m ? parseInt(m[1], 10) : 1;
      const figureIndex = m ? parseInt(m[2], 10) : 0;
      let figureCount = getDcStats(dcName).figures ?? 1;
      if (figureCount <= 1 && dcName) {
        const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
        const allEffects = getDcEffects();
        const key = Object.keys(allEffects).find(
          (k) => k.toLowerCase().startsWith(base.toLowerCase() + ' ') || k.toLowerCase() === base.toLowerCase()
        );
        if (key) figureCount = allEffects[key]?.figures ?? figureCount;
      }
      const dcCopies = totals[dcName] ?? 1;
      let label = null;
      if (figureCount > 1 || figureIndex > 0) {
        label = `${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}`;
      } else if (dcCopies > 1) {
        label = String(dgIndex);
      }
      const imagePath = getFigureImagePath(dcName);
      const baseSize = getFigureSize(dcName);
      const figureSize = game.figureOrientations?.[figureKey] || baseSize;
      const powerTokens = game.figurePowerTokens?.[figureKey] || [];
      const conditions = game.figureConditions?.[figureKey] || [];
      figures.push({
        coord: space,
        color,
        imagePath: imagePath || undefined,
        dcName,
        figureSize,
        label,
        figureKey,
        powerTokens,
        conditions,
      });
    }
  }
  return figures;
}

/** Build rich token array from tokenTypes + positions. Returns [{coord, label, image}]. Falls back to flat coord array with fallbackLabel. */
function buildMissionTokens(missionData, fallbackLabel) {
  if (!missionData) return [];
  const tokenTypes = missionData.tokenTypes;
  const positions = missionData.positions;
  if (Array.isArray(tokenTypes) && positions && typeof positions === 'object') {
    const typeMap = {};
    for (const t of tokenTypes) typeMap[t.id] = t;
    const result = [];
    for (const [typeId, coords] of Object.entries(positions)) {
      const tDef = typeMap[typeId] || {};
      for (const coord of Array.isArray(coords) ? coords : [coords]) {
        result.push({ coord, label: tDef.label || fallbackLabel, image: tDef.image || null });
      }
    }
    return result;
  }
  const flat = getMissionTokenCoords(missionData);
  return flat.map((coord) => ({ coord, label: fallbackLabel, image: null }));
}

/** Get map tokens (terminals + mission-specific + closed doors + ancillary) for renderMap. */
function getMapTokensForRender(mapId, missionVariant, openedDoors = [], ancillaryTokens = null, tokenLabel = 'Token') {
  const mapData = getMapTokensData()[mapId];
  if (!mapData) return { terminals: [], missionA: [], missionB: [], doors: [], smoke: [], rubble: [], energyShield: [], device: [], napalm: [] };
  const terminals = mapData.terminals || [];
  const missionA = buildMissionTokens(mapData.missionA, tokenLabel);
  const missionB = buildMissionTokens(mapData.missionB, tokenLabel);
  const doorEdges = mapData.doors || [];
  const openedSet = new Set((openedDoors || []).map((k) => String(k).toLowerCase()));
  const doors = doorEdges.filter((edge) => {
    if (!edge || edge.length < 2) return false;
    const ek = edgeKey(edge[0], edge[1]);
    return !openedSet.has(ek);
  });
  const anc = ancillaryTokens || {};
  return {
    terminals,
    missionA: missionVariant === 'a' ? missionA : [],
    missionB: missionVariant === 'b' ? missionB : [],
    doors,
    smoke: anc.smoke || [],
    rubble: anc.rubble || [],
    energyShield: anc.energyShield || [],
    device: anc.device || [],
    napalm: anc.napalm || [],
  };
}

/** Returns AttachmentBuilder for activation minimap (zoomed on figure, size = speed * 1.75 cells). msgId = DC message ID. */
async function getActivationMinimapAttachment(game, msgId) {
  const meta = dcMessageMeta.get(msgId);
  const map = game?.selectedMap;
  if (!meta || !map?.id) return null;
  const playerNum = meta.playerNum;
  const dcName = meta.dcName;
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const poses = game.figurePositions?.[playerNum] || {};
  let figureKey = null;
  let pos = null;
  for (let fi = 0; fi < 10; fi++) {
    const fk = `${dcName}-${dgIndex}-${fi}`;
    if (fk in poses) {
      figureKey = fk;
      pos = poses[fk];
      break;
    }
  }
  if (!figureKey || !pos) return null;
  const speed = getEffectiveSpeed(dcName, figureKey, game, playerNum);
  const size = game.figureOrientations?.[figureKey] || getFigureSize(dcName);
  const { col: tlCol, row: tlRow } = parseCoord(pos);
  const [cols = 1, rows = 1] = String(size || '1x1').split('x').map(Number);
  const centerCol = Math.floor(tlCol + (cols - 1) / 2);
  const centerRow = Math.floor(tlRow + (rows - 1) / 2);
  const halfExtent = Math.max(1, Math.ceil((speed * 1.75) / 2));
  const cropCoords = [];
  for (let dr = -halfExtent; dr <= halfExtent; dr++) {
    for (let dc = -halfExtent; dc <= halfExtent; dc++) {
      const c = colRowToCoord(centerCol + dc, centerRow + dr);
      if (c) cropCoords.push(c);
    }
  }
  if (cropCoords.length === 0) return null;
  try {
    const figures = getFiguresForRender(game);
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token');
    const buffer = await renderMap(map.id, {
      figures,
      tokens,
      showGrid: true,
      maxWidth: 800,
      cropToZone: cropCoords,
      gridStyle: 'black',
    });
    return new AttachmentBuilder(buffer, { name: 'activation-minimap.png' });
  } catch (err) {
    console.error('Activation minimap render error:', err);
    return null;
  }
}

/** Returns AttachmentBuilder for movement minimap (zoomed on figure, coords only on spacesAtCost). */
async function getMovementMinimapAttachment(game, msgId, figureKey, spacesAtCost) {
  const meta = dcMessageMeta.get(msgId);
  const map = game?.selectedMap;
  if (!meta || !map?.id || !spacesAtCost?.length) return null;
  const playerNum = meta.playerNum;
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return null;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const speed = getEffectiveSpeed(dcName, figureKey, game, playerNum);
  const size = game.figureOrientations?.[figureKey] || getFigureSize(dcName);
  const { col: tlCol, row: tlRow } = parseCoord(pos);
  const [cols = 1, rows = 1] = String(size || '1x1').split('x').map(Number);
  const centerCol = Math.floor(tlCol + (cols - 1) / 2);
  const centerRow = Math.floor(tlRow + (rows - 1) / 2);
  const halfExtent = Math.max(1, Math.ceil((speed * 2.5) / 2));
  const cropCoords = [];
  for (let dr = -halfExtent; dr <= halfExtent; dr++) {
    for (let dc = -halfExtent; dc <= halfExtent; dc++) {
      const c = colRowToCoord(centerCol + dc, centerRow + dr);
      if (c) cropCoords.push(c);
    }
  }
  if (cropCoords.length === 0) return null;
  const labelCoords = spacesAtCost.map((s) => String(s).toLowerCase());
  try {
    const figures = getFiguresForRender(game);
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token');
    const buffer = await renderMap(map.id, {
      figures,
      tokens,
      showGrid: true,
      maxWidth: 800,
      cropToZone: cropCoords,
      gridStyle: 'black',
      showGridOnlyOnCoords: labelCoords,
    });
    return new AttachmentBuilder(buffer, { name: 'move-destinations.png' });
  } catch (err) {
    console.error('Movement minimap render error:', err);
    return null;
  }
}

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

/** Returns AttachmentBuilder for deployment zone map (zoomed, black coords). zone = 'red' | 'blue'. */
async function getDeploymentMapAttachment(game, zone) {
  const map = game?.selectedMap;
  if (!map?.id) return null;
  try {
    const figures = getFiguresForRender(game);
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token');
    const zoneSpaces = zone && getDeploymentZones()[map.id]?.[zone] ? getDeploymentZones()[map.id][zone] : null;
    const occupiedSet = toLowerSet(getOccupiedSpacesForMovement(game) || []);
    const validLabelCoords =
      zoneSpaces && zoneSpaces.length > 0
        ? zoneSpaces.filter((c) => !occupiedSet.has(String(c).toLowerCase()))
        : null;
    const buffer = await renderMap(map.id, {
      figures,
      tokens,
      showGrid: true,
      maxWidth: 900,
      cropToZone: zoneSpaces && zoneSpaces.length > 0 ? zoneSpaces : null,
      gridStyle: 'black',
      showGridOnlyOnCoords: validLabelCoords && validLabelCoords.length > 0 ? validLabelCoords : null,
    });
    return new AttachmentBuilder(buffer, { name: 'deployment-zone.png' });
  } catch (err) {
    console.error('Deployment map render error:', err);
    return null;
  }
}

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
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const zones = getDeploymentZones()['devaron-garrison'] || {};
  const p1Zone = initPlayerNum === 1 ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const p2Zone = p1Zone === 'red' ? 'blue' : 'red';
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
  const pid = playerNum === 1 ? game.player1Id : game.player2Id;
  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  const available = (allDoors || []).filter(([a, b]) => {
    const ek1 = `${a}|${b}`.toLowerCase();
    const ek2 = `${b}|${a}`.toLowerCase();
    return !openedSet.has(ek1) && !openedSet.has(ek2);
  });
  if (available.length === 0) {
    game.pendingDoorSelections.shift();
    await channel.send({ content: `<@${pid}> — All doors are already open (no more selections needed).`, allowedMentions: { users: [pid] } }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    const pid = pn === 1 ? game.player1Id : game.player2Id;
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
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
}

/**
 * Post Krykna push selection buttons for Chopper Base A end-of-round push phase.
 * Shows the next player in game.pendingKryknaPushQueue buttons for each un-pushed Krykna.
 */
async function postKryknaPushButtons(game, channel, gameId) {
  if (!game.pendingKryknaPushQueue || game.pendingKryknaPushQueue.length === 0) return;
  const playerNum = game.pendingKryknaPushQueue[0];
  const pid = playerNum === 1 ? game.player1Id : game.player2Id;
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
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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

async function checkWinConditions(game, client) {
  const crateBonus = getCrateDeploymentVpBonus(game);
  const patronBonus = getAnchorheadPatronVpBonus(game);
  const vp1 = (game.player1VP?.total ?? 0) + crateBonus.p1 + patronBonus.p1;
  const vp2 = (game.player2VP?.total ?? 0) + crateBonus.p2 + patronBonus.p2;
  const p1Figures = Object.keys(game.figurePositions?.[1] || {}).length;
  const p2Figures = Object.keys(game.figurePositions?.[2] || {}).length;

  if (vp1 >= 40 || vp2 >= 40) {
    const winnerId = vp1 >= 40 ? game.player1Id : game.player2Id;
    const reason = '40 VP';
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
      .setColor(0xffd700)
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
  pendingIllegalSquad.delete(`${game.gameId}_1`);
  pendingIllegalSquad.delete(`${game.gameId}_2`);
  const embed = buildScorecardEmbed(game);
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
          const [granted1, granted2] = await Promise.all([
            checkAndGrantAchievements(game.player1Id, 'game_complete', stats1.games),
            checkAndGrantAchievements(game.player2Id, 'game_complete', stats2.games),
          ]);
          for (const def of granted1) await postAchievementNotification(client, achievementsChannelId, game.player1Id, def);
          for (const def of granted2) await postAchievementNotification(client, achievementsChannelId, game.player2Id, def);
          const wId = game.winnerId;
          if (wId) {
            const winnerStats = wId === game.player1Id ? stats1 : stats2;
            const grantedWin = await checkAndGrantAchievements(wId, 'game_win', winnerStats.wins);
            for (const def of grantedWin) await postAchievementNotification(client, achievementsChannelId, wId, def);
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
    await interaction.followUp({ content: 'This game has ended.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      const channelId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
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
      await companionMsg.edit({ embeds: [new EmbedBuilder().setTitle('Companion').setDescription(desc).setColor(0x2f3136)] });
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
      await companionMsg.edit({ embeds: [new EmbedBuilder().setTitle('Companion').setDescription(desc).setColor(0x2f3136)] });
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

/** Returns { content, files?, embeds?, components } for posting the game map. Includes Scorecard embed. */
async function buildBoardMapPayload(gameId, map, game) {
  const components = getBoardButtons(gameId, { game });
  const embeds = game ? [buildScorecardEmbed(game)] : [];
  const figures = game ? getFiguresForRender(game) : [];
  const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token');
  const hasFigures = figures.length > 0;
  const hasAncillary = (tokens.smoke?.length || 0) + (tokens.rubble?.length || 0) + (tokens.energyShield?.length || 0) + (tokens.device?.length || 0) + (tokens.napalm?.length || 0) > 0;
  const hasTokens = tokens.terminals?.length > 0 || tokens.missionA?.length > 0 || tokens.missionB?.length > 0 || tokens.doors?.length > 0 || hasAncillary;
  const resolvedMapPath = map.imagePath ? resolveAssetPath(map.imagePath, 'maps') : null;
  const imagePath = resolvedMapPath ? join(rootDir, resolvedMapPath) : null;
  const pdfPath = join(rootDir, 'data', 'map-pdfs', `${map.id}.pdf`);

  const allowedMentions = game ? { users: [...new Set([game.player1Id, game.player2Id])] } : undefined;
  // Player labels: Discord names over each player's deployment zone
  const playerLabels = [];
  if (game?.deploymentZoneChosen && game?.player1Id && game?.player2Id) {
    const zoneData = getDeploymentZones()[map.id] || {};
    const initZone = game.deploymentZoneChosen;
    const otherZone = initZone === 'red' ? 'blue' : 'red';
    const p1IsInit = game.player1Id === game.initiativePlayerId;
    const p1ZoneCells = zoneData[p1IsInit ? initZone : otherZone] || [];
    const p2ZoneCells = zoneData[p1IsInit ? otherZone : initZone] || [];
    const p1User = client.users.cache.get(game.player1Id);
    const p2User = client.users.cache.get(game.player2Id);
    const p1Name = p1User?.globalName || p1User?.username || 'P1';
    const p2Name = p2User?.globalName || p2User?.username || 'P2';
    if (p1ZoneCells.length > 0) playerLabels.push({ label: p1Name, zone: p1ZoneCells });
    if (p2ZoneCells.length > 0) playerLabels.push({ label: p2Name, zone: p2ZoneCells });
  }

  if ((hasFigures || hasTokens) && imagePath && existsSync(imagePath)) {
    try {
      const buffer = await renderMap(map.id, { figures, tokens, showGrid: false, maxWidth: 1200, playerLabels });
      return {
        content: `**Game map: ${map.name}** — Refresh to update figure positions.`,
        files: [new AttachmentBuilder(buffer, { name: 'map-with-figures.png' })],
        embeds,
        components,
        allowedMentions,
      };
    } catch (err) {
      console.error('Map render error:', err);
    }
  }
  if (existsSync(pdfPath)) {
    return {
      content: `**Game map: ${map.name}** (high-res PDF)`,
      files: [new AttachmentBuilder(pdfPath, { name: `${map.id}.pdf` })],
      embeds,
      components,
      allowedMentions,
    };
  }
  if (imagePath && existsSync(imagePath)) {
    return {
      content: `**Game map: ${map.name}** *(Add \`data/map-pdfs/${map.id}.pdf\` for high-res PDF)*`,
      files: [
        new AttachmentBuilder(imagePath, { name: `map.${(map.imagePath || '').split('.').pop() || 'gif'}` }),
      ],
      embeds,
      components,
      allowedMentions,
    };
  }
  return {
    content: `**Game map: ${map.name}** — Add high-res PDF at \`data/map-pdfs/${map.id}.pdf\` to display it here.`,
    files: undefined,
    embeds,
    components,
    allowedMentions,
  };
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

/** Called when all setup attachments are placed: start Round 1 and send shuffle/draw prompts. */
async function finishSetupAttachments(game, client) {
  game.currentRound = 1;
  const generalChannel = await client.channels.fetch(game.generalId);
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
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
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    game.player1DeploymentZone = initiativePlayerNum === 1 ? zone : otherZone;
    game.player2DeploymentZone = initiativePlayerNum === 2 ? zone : otherZone;
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
    const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
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
          const dcName = k.split('-')[0];
          const size = game.figureOrientations?.[k] || getFigureSize(dcName);
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

  const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const nonInitiativePlayerNum = initiativePlayerNum === 1 ? 2 : 1;
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
    const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
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
    const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const drawnKey = playerNum === 1 ? 'player1CcDrawn' : 'player2CcDrawn';
    game[deckKey] = deck;
    game[handKey] = hand;
    game[drawnKey] = true;
    const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
    await logGameAction(game, client, `<@${playerId}> shuffled and drew 3 Command Cards.`, { phase: 'DEPLOYMENT', icon: 'card', allowedMentions: { users: [playerId] } });
    const handChannelId = playerNum === 1 ? game.p1HandId : game.p2HandId;
    const handChannel = await client.channels.fetch(handChannelId);
    const existingMsgs = await handChannel.messages.fetch({ limit: 5 });
    if (existingMsgs.size === 0) {
      const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
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
  await sendRoundActivationPhaseMessage(game, client);
  await clearPreGameSetup(game, client);
  saveGames();
}

/** F14: Push one undo step. Trims to MAX_UNDO_DEPTH to prevent unbounded growth. */
function pushUndo(game, entry) {
  game.undoStack = game.undoStack || [];
  game.undoStack.push({ ...entry, ts: Date.now() });
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
    .setColor(0x2f3136);
  return embed;
}

/**
 * Maps figure DC name → { upgradeName → upgraded card image path }.
 * When a figure has the named skirmish upgrade attached, the embed shows the upgraded art.
 */
const UPGRADE_IMAGE_OVERRIDES = {
  'Darth Vader': { 'Driven by Hatred': 'vassal_extracted/images/dc-figures/Darth Vader Driven by Hatred.jpg' },
  'Han Solo':    { 'Rogue Smuggler':   'vassal_extracted/images/dc-figures/Han Solo Rogue Smuggler.jpg' },
  'Chewbacca':   { 'Wookiee Avenger':  'vassal_extracted/images/dc-figures/Chewbacca Wookiee Avenger.jpg' },
  'IG-88':       { 'Focused on the Kill': 'vassal_extracted/images/dc-figures/IG-88 Focused on the Kill.jpg' },
};

/** Resolve DC name to DC card image path (for deployment card embeds). Looks in dc-figures/ or DC Skirmish Upgrades/ first, then root. */
function getDcImagePath(dcName) {
  if (!dcName || typeof dcName !== 'string') return null;
  const exact = getDcImages()[dcName];
  if (exact) return resolveDcImagePath(exact, dcName);
  const trimmed = dcName.trim();
  if (!/^\[.+\]$/.test(trimmed) && getDcImages()[`[${trimmed}]`]) return resolveDcImagePath(getDcImages()[`[${trimmed}]`], `[${trimmed}]`);
  const lower = dcName.toLowerCase();
  let key = Object.keys(getDcImages()).find((k) => k.toLowerCase() === lower);
  if (key) return resolveDcImagePath(getDcImages()[key], key);
  const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  if (base !== dcName) {
    key = Object.keys(getDcImages()).find((k) => k.toLowerCase() === base.toLowerCase());
    if (key) return resolveDcImagePath(getDcImages()[key], key);
    key = Object.keys(getDcImages()).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
    if (key) return resolveDcImagePath(getDcImages()[key], key);
  }
  key = Object.keys(getDcImages()).find((k) => k.toLowerCase().startsWith(lower) || lower.startsWith(k.toLowerCase()));
  return key ? resolveDcImagePath(getDcImages()[key], key) : null;
}

/** Prefer IACP variant image when it exists (e.g. "Boba Fett (IACP).jpg" in same folder). Then prefer dc-figures/ or DC Skirmish Upgrades/ subfolder. */
function resolveDcImagePath(relPath, dcName) {
  if (!relPath || typeof relPath !== 'string') return null;
  const parts = relPath.split(/[/\\]/);
  const dirRel = parts.slice(0, -1).join('/');
  const baseWithExt = parts[parts.length - 1] || relPath;
  const baseName = baseWithExt.replace(/\.[^.]+$/, '');
  for (const ext of ['.jpg', '.png', '.gif']) {
    const iacpRel = dirRel + '/' + baseName + ' (IACP)' + ext;
    if (existsSync(join(rootDir, ...iacpRel.split('/')))) return iacpRel;
  }
  const filename = baseWithExt;
  const subfolder = dcName && isFigurelessDc(dcName) ? 'DC Skirmish Upgrades' : 'dc-figures';
  const inSub = `vassal_extracted/images/${subfolder}/${filename}`;
  if (existsSync(join(rootDir, inSub))) return inSub;
  const otherSub = subfolder === 'dc-figures' ? 'DC Skirmish Upgrades' : 'dc-figures';
  const inOther = `vassal_extracted/images/${otherSub}/${filename}`;
  if (existsSync(join(rootDir, inOther))) return inOther;
  if (existsSync(join(rootDir, relPath))) return relPath;
  return relPath;
}


/** Return absolute path to condition card image, or null if not found. */
function getConditionCardPath(conditionName) {
  if (!conditionName) return null;
  const fname = `Condition card--${conditionName}.jpg`;
  const p = join(rootDir, 'vassal_extracted', 'images', 'conditions', fname);
  return existsSync(p) ? p : null;
}

/** Resolve DC name to circular figure image (for map tokens). Tries figures/ subfolder first, then root. */
function getFigureImagePath(dcName) {
  if (!dcName || typeof dcName !== 'string') return null;
  const exact = getFigureImages()[dcName];
  if (exact) return resolveAssetPath(exact, 'figures');
  const lower = dcName.toLowerCase();
  let key = Object.keys(getFigureImages()).find((k) => k.toLowerCase() === lower);
  if (key) return resolveAssetPath(getFigureImages()[key], 'figures');
  const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  if (base !== dcName) {
    key = Object.keys(getFigureImages()).find((k) => k.toLowerCase() === base.toLowerCase());
    if (key) return resolveAssetPath(getFigureImages()[key], 'figures');
    key = Object.keys(getFigureImages()).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
    if (key) return resolveAssetPath(getFigureImages()[key], 'figures');
  }
  key = Object.keys(getFigureImages()).find((k) => k.toLowerCase().startsWith(lower) || lower.startsWith(k.toLowerCase()));
  return key ? resolveAssetPath(getFigureImages()[key], 'figures') : null;
}

/** Try subfolder first, then root. relPath is e.g. "vassal_extracted/images/X.gif". */
function resolveAssetPath(relPath, subfolder) {
  if (!relPath || typeof relPath !== 'string') return null;
  const filename = relPath.split(/[/\\]/).pop() || relPath;
  const inSub = `vassal_extracted/images/${subfolder}/${filename}`;
  if (existsSync(join(rootDir, inSub))) return inSub;
  // figure-tokens/ is the physical folder for Vassal figure GIFs (figure-images.json stores paths as figures/)
  if (subfolder === 'figures') {
    const inTokens = `vassal_extracted/images/figure-tokens/${filename}`;
    if (existsSync(join(rootDir, inTokens))) return inTokens;
  }
  if (existsSync(join(rootDir, relPath))) return relPath;
  return relPath;
}

/** Resolve mission card image path; tries .png, .jpg, .jpeg so data can say .png while files are .jpg. */
function resolveMissionCardImagePath(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  const subfolder = 'mission-cards';
  const filename = relPath.split(/[/\\]/).pop() || relPath;
  const base = filename.replace(/\.[^.]+$/i, '') || filename;
  const exts = ['.png', '.jpg', '.jpeg'];
  const tried = new Set();
  for (const ext of exts) {
    const name = base + ext;
    if (tried.has(name.toLowerCase())) continue;
    tried.add(name.toLowerCase());
    const inSub = `vassal_extracted/images/${subfolder}/${name}`;
    if (existsSync(join(rootDir, inSub))) return inSub;
  }
  return resolveAssetPath(relPath, subfolder);
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
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const figMatch = figureKey.match(/-(\d+)-(\d+)$/);
  const figureIndex = figMatch ? parseInt(figMatch[2], 10) : 0;
  const dgIndex = figMatch ? figMatch[1] : '1';

  // Locate the DC message for this figure
  let msgId = null;
  for (const [mid, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
    const dn = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    if (meta.dcName === dcName && dn && String(dn[1]) === String(dgIndex)) { msgId = mid; break; }
  }

  if (msgId) {
    const healthState = dcHealthState.get(msgId) || [];
    const entry = healthState[figureIndex];
    if (entry) {
      const [cur, max] = entry;
      const newCur = Math.max(0, cur - damage);
      healthState[figureIndex] = [newCur, max];
      dcHealthState.set(msgId, healthState);
      const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
      const idx = (dcIds || []).indexOf(msgId);
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
      if (newCur <= 0) {
        if (game.figurePositions?.[playerNum]) delete game.figurePositions[playerNum][figureKey];
        const opponentPlayerNum = playerNum === 1 ? 2 : 1;
        const stats = getDcStats(dcName);
        const effects = getDcEffects()?.[dcName];
        const figures = stats?.figures ?? 1;
        const vp = (figures > 1 && effects?.subCost != null) ? effects.subCost : (stats?.cost ?? 5);
        const vpKey = `player${opponentPlayerNum}VP`;
        game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
        game[vpKey].kills += vp;
        game[vpKey].total += vp;
        await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** was defeated! +${vp} VP to Player ${opponentPlayerNum}.`, { phase: 'ROUND', icon: 'attack' });
      } else {
        await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** suffered **${damage} damage** (${newCur}/${max} HP remaining).`, { phase: 'ROUND', icon: 'attack' });
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
  const hs = dcHealthState.get(msgId) || [];
  const entry = hs[figIdx];
  if (!entry) return;
  const [cur, max] = entry;
  const newCur = Math.max(0, (cur ?? max) - damage);
  hs[figIdx] = [newCur, max];
  dcHealthState.set(msgId, hs);
  const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
  const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
  const idx = (dcIds || []).indexOf(msgId);
  if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...hs];
  const figName = figKey.replace(/-\d+-\d+$/, '');
  if (thread) await thread.send(`**${sourceName}** — ${figName} suffers **${damage} Damage**.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
  if (newCur <= 0 && idx >= 0) {
    if (game.figurePositions?.[playerNum]) delete game.figurePositions[playerNum][figKey];
    // VP goes to the opponent (the one dealing the damage)
    const opponentPlayerNum = playerNum === 1 ? 2 : 1;
    const vpKey = `player${opponentPlayerNum}VP`;
    const stats = getDcStats(dcList[idx]?.dcName);
    const effects = getDcEffects()?.[dcList[idx]?.dcName];
    const figures = stats?.figures ?? 1;
    const vp = (figures > 1 && effects?.subCost != null) ? effects.subCost : (stats?.cost ?? 5);
    game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
    game[vpKey].kills += vp;
    game[vpKey].total += vp;
    if (thread) await thread.send(`**${sourceName}** — ${figName} was **defeated**! +${vp} VP.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
    await checkWinConditions(game, client);
  }
}

/** Remove a specific condition from a figure. No-op if figure or condition not found. */
function filterCondition(game, figureKey, cond) {
  if (!game.figureConditions?.[figureKey]) return;
  game.figureConditions[figureKey] = game.figureConditions[figureKey].filter((c) => c !== cond);
  if (game.figureConditions[figureKey].length === 0) delete game.figureConditions[figureKey];
}

/** Send a Bleeding damage prompt to the given channel. Offers "Take 1 damage" or "Prevent (discard CC)". */
async function sendBleedingPrompt(game, channel, figureKey, playerNum, displayName) {
  const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
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
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/** Handle bleed_accept_ / bleed_prevent_ button clicks. */
async function handleBleedResolve(interaction) {
  const match = interaction.customId.match(/^bleed_(accept|prevent)_(\d+)_(1|2)_(.+)$/);
  if (!match) return;
  const [, action, gameId, playerNumStr, figureKey] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== playerId && !game.isTestGame) {
    await interaction.followUp({ content: 'Only the figure owner can resolve Bleeding.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const msgId = findDcMessageIdForFigure(gameId, playerNum, figureKey);
  const figMatch = figureKey.match(/-(\d+)-(\d+)$/);
  const figureIndex = figMatch ? parseInt(figMatch[2], 10) : 0;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');

  if (action === 'accept') {
    if (msgId) {
      const healthState = dcHealthState.get(msgId) || [];
      const entry = healthState[figureIndex];
      if (entry) {
        const [cur, max] = entry;
        const newCur = Math.max(0, (cur ?? max) - 1);
        healthState[figureIndex] = [newCur, max ?? newCur];
        dcHealthState.set(msgId, healthState);
        const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
        const idx = (dcIds || []).indexOf(msgId);
        if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
        await logGameAction(game, interaction.client, `🩸 **Bleeding** — **${dcName}** suffered 1 damage.`, { phase: 'ROUND', icon: 'attack' });
        if (newCur <= 0) {
          if (game.figurePositions?.[playerNum]) delete game.figurePositions[playerNum][figureKey];
          const opponentPlayerNum = playerNum === 1 ? 2 : 1;
          const stats = getDcStats(dcName);
          const effects = getDcEffects()?.[dcName];
          const figures = stats?.figures ?? 1;
          const vp = (figures > 1 && effects?.subCost != null) ? effects.subCost : (stats?.cost ?? 5);
          const vpKey = opponentPlayerNum === 1 ? 'player1VP' : 'player2VP';
          game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
          game[vpKey].kills += vp;
          game[vpKey].total += vp;
          await logGameAction(game, interaction.client, `🩸 **Bleeding** — **${dcName}** was defeated! +${vp} VP to P${opponentPlayerNum}`, { phase: 'ROUND', icon: 'attack' });
          if (idx >= 0 && isGroupDefeated(game, playerNum, idx)) {
            const activatedIndices = playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
            if (!activatedIndices.includes(idx)) {
              if (playerNum === 1) game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining ?? 0) - 1);
              else game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining ?? 0) - 1);
              await updateActivationsMessage(game, playerNum, interaction.client);
            }
          }
          await checkWinConditions(game, interaction.client);
        }
        // Refresh DC embed
        try {
          const meta = dcMessageMeta.get(msgId);
          if (meta) {
            const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
            const ch = await interaction.client.channels.fetch(channelId);
            const dcMsg = await ch.messages.fetch(msgId);
            const exhausted = dcExhaustedState.get(msgId) ?? false;
            const health = dcHealthState.get(msgId) || [];
            const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, meta.displayName, health, getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, msgId));
            await dcMsg.edit({ embeds: [embed], files }).catch((err) => { console.error('[discord]', err?.message ?? err); });
          }
        } catch (err) {
          console.error('Failed to update DC embed after Bleeding:', err);
        }
      }
    }
  } else {
    // prevent: discard top CC from deck
    const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const deck = game[deckKey] || [];
    if (deck.length === 0) {
      await interaction.followUp({ content: 'No CCs in deck to discard!', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const discardedCard = deck.splice(0, 1)[0];
    game[deckKey] = deck;
    await logGameAction(game, interaction.client, `🩸 **Bleeding** — **${dcName}** prevented 1 damage (discarded **${discardedCard}** from deck top).`, { phase: 'ROUND', icon: 'card' });
  }
  filterCondition(game, figureKey, 'Bleed');  // Bleed resolved — discard condition
  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  saveGames();
}

/** Check if a Figurehead-capable figure is available to intercept damage for targetFigureKey. Returns { figureKey, msgId, figIndex, label } or null. */
function findFigureheadFigure(game, defenderPlayerNum, targetFigureKey) {
  if (!game.selectedMap?.id) return null;
  const targetPos = game.figurePositions?.[defenderPlayerNum]?.[targetFigureKey];
  if (!targetPos) return null;
  const dcList = defenderPlayerNum === 1 ? game.p1DcList : game.p2DcList;
  if (!dcList) return null;
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    if (!dc) continue;
    const dcName = dc.dcName;
    const eff = getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
    if (!(eff?.specialAbilityIds || []).includes('figurehead')) continue;
    const figures = game.figurePositions?.[defenderPlayerNum] || {};
    for (const [fk, pos] of Object.entries(figures)) {
      if (fk === targetFigureKey) continue;
      if (fk.replace(/-\d+-\d+$/, '') !== dcName) continue;
      if (!isWithinN(pos, targetPos, 4, game.selectedMap.id)) continue;
      const msgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, fk);
      const fm = fk.match(/-(\d+)-(\d+)$/);
      const figIndex = fm ? parseInt(fm[2], 10) : 0;
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
  const defenderPlayerNum = combat.attackerPlayerNum === 1 ? 2 : 1;
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
    const attackerEff = getDcEffects()?.[combat.attackerDcName] || getDcEffects()?.[combat.attackerDcName?.replace(/\s*\[.*\]\s*$/, '')];
    const attackerKws = (attackerEff?.keywords || []).map((k) => String(k).toUpperCase());
    if (attackerKws.includes('TROOPER')) combat.bonusHits = (combat.bonusHits || 0) + trooperHitBonus;
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
        const targetDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
        const targetSize = game.figureOrientations?.[combat.target.figureKey] || getFigureSize(targetDcName);
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
  const ownerId = attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
  const targetMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, combat.target.figureKey);
  const tm = combat.target.figureKey.match(/-(\d+)-(\d+)$/);
  const targetFigIndex = tm ? parseInt(tm[2], 10) : 0;

  // Figurehead (Murne Rin): before friendly figure suffers damage, may redirect to self (prevent 1)
  if (damage > 0 && hit) {
    const fhResult = findFigureheadFigure(game, defenderPlayerNum, combat.target.figureKey);
    if (fhResult) {
      const fhOwnerId = defenderPlayerNum === 1 ? game.player1Id : game.player2Id;
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
          const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
          game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
          game[vpKey].kills += 2;
          game[vpKey].total += 2;
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

  if (damage > 0 && targetMsgId) {
    const healthState = dcHealthState.get(targetMsgId) || [];
    const entry = healthState[targetFigIndex];
    if (entry) {
      const [cur, max] = entry;
      const newCur = Math.max(0, (cur ?? max) - damage);
      healthState[targetFigIndex] = [newCur, max ?? newCur];
      dcHealthState.set(targetMsgId, healthState);
      const dcMessageIds = defenderPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList = defenderPlayerNum === 1 ? game.p1DcList : game.p2DcList;
      const idx = (dcMessageIds || []).indexOf(targetMsgId);
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
      const allConditions = [...(combat.surgeConditions || []), ...(combat.bonusConditions || [])];
      if (allConditions.length) {
        game.figureConditions = game.figureConditions || {};
        const existing = game.figureConditions[combat.target.figureKey] || [];
        game.figureConditions[combat.target.figureKey] = [...new Set([...existing, ...allConditions])];
      }
      // Furious Charge: if defender's player played this CC, and suffered >= threshold damage, grant Focus
      if (game.conditionalFocusIfDamagedGte?.playerNum === defenderPlayerNum && damage >= game.conditionalFocusIfDamagedGte.threshold) {
        game.figureConditions = game.figureConditions || {};
        game.figureConditions[combat.target.figureKey] = game.figureConditions[combat.target.figureKey] || [];
        if (!game.figureConditions[combat.target.figureKey].includes('Focus')) {
          game.figureConditions[combat.target.figureKey].push('Focus');
          await logGameAction(game, client, `**Furious Charge** — **${combat.target.label}** is now **Focused** (suffered ${damage} Damage).`, { phase: 'ROUND', icon: 'card' });
        }
        game.conditionalFocusIfDamagedGte = null;
      }
      // You Will Not Deny Me: prevent Fifth Brother from being defeated (restore HP to 1)
      if (newCur <= 0 && game.youWillNotDenyMeActive?.playerNum === defenderPlayerNum) {
        const _ywndmDcName = idx >= 0 ? dcList[idx]?.dcName : (combat.target.figureKey || '').replace(/-\d+-\d+$/, '');
        if (_ywndmDcName?.toLowerCase().includes('fifth')) {
          healthState[targetFigIndex] = [1, max ?? 1];
          dcHealthState.set(targetMsgId, healthState);
          if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
          game.youWillNotDenyMeActive = null;
          await logGameAction(game, client, `**You Will Not Deny Me** — Fifth Brother cannot be defeated! HP restored to 1.`, { phase: 'ROUND', icon: 'card' });
        }
      }
      // Self-Destruct Protocol: pre-defeat interrupt — prompt owner to use ability before defeat
      if (newCur <= 0 && !game.selfDestructProtocolTriggered?.[targetMsgId]) {
        const _sdpDcName2 = idx >= 0 ? dcList?.[idx]?.dcName : (combat.target.figureKey || '').replace(/-\d+-\d+$/, '');
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
      if (newCur <= 0 && !(game.youWillNotDenyMeActive?.playerNum === defenderPlayerNum && ((idx >= 0 ? dcList[idx]?.dcName : (combat.target.figureKey || '').replace(/-\d+-\d+$/, ''))?.toLowerCase().includes('fifth')))) {
        // F7: Keep healthState, figurePositions, and DC embed in sync when one figure in a group dies.
        if (game.figurePositions?.[defenderPlayerNum]) delete game.figurePositions[defenderPlayerNum][combat.target.figureKey];
        if (game.figureConditions?.[combat.target.figureKey]) delete game.figureConditions[combat.target.figureKey];
        const { cost, subCost, figures } = combat.targetStats;
        const vp = (figures > 1 && subCost != null) ? subCost : (cost ?? 5);
        const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
        game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
        game[vpKey].kills += vp;
        game[vpKey].total += vp;
        // Of No Importance: reduce VP gained when CC owner's own non-unique figure is defeated
        if (game.nextDefeatedFriendlyVpReduction?.playerNum === defenderPlayerNum) {
          const _noImportDcName = idx >= 0 ? dcList[idx]?.dcName : null;
          if (_noImportDcName && !isDcUnique(_noImportDcName)) {
            const _reduceAmt = game.nextDefeatedFriendlyVpReduction.amount || 0;
            const _reduced = Math.min(_reduceAmt, vp);
            game[vpKey].kills = Math.max(0, game[vpKey].kills - _reduced);
            game[vpKey].total = Math.max(0, game[vpKey].total - _reduced);
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
          const _bountyVpKey = _bountySetterNum === 1 ? 'player1VP' : 'player2VP';
          game[_bountyVpKey] = game[_bountyVpKey] || { total: 0, kills: 0, objectives: 0 };
          game[_bountyVpKey].total += _bountyAmt;
          game[_bountyVpKey].objectives += _bountyAmt;
          delete game.priceBounties[combat.target.label];
          await logGameAction(game, client, `**Price on Their Heads** — +${_bountyAmt} VP bounty awarded to P${_bountySetterNum} (${game[_bountyVpKey].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // Paid in Beskar: grant Block tokens when hostile is defeated within range
        if (game.whenDefeatHostileWithin3GainBlockTokens) {
          const _beskarData = game.whenDefeatHostileWithin3GainBlockTokens;
          const _beskarDist = combat.distanceToTarget ?? 0;
          const _beskarRange = _beskarData.range ?? 3;
          if (_beskarDist <= _beskarRange) {
            const _beskarTokens = _beskarData.tokens ?? 1;
            const _beskarFigKey = combat.attackerFigureKey;
            game.figurePowerTokens = game.figurePowerTokens || {};
            game.figurePowerTokens[_beskarFigKey] = game.figurePowerTokens[_beskarFigKey] || [];
            for (let _bt = 0; _bt < _beskarTokens; _bt++) game.figurePowerTokens[_beskarFigKey].push('Block');
            await logGameAction(game, client, `**Paid in Beskar** — +${_beskarTokens} Block Token${_beskarTokens !== 1 ? 's' : ''} granted to ${combat.attackerDisplayName}.`, { phase: 'ROUND', icon: 'card' });
          }
          game.whenDefeatHostileWithin3GainBlockTokens = null;
        }
        // Worth Every Credit: bonus VP when hostile is defeated this activation
        if (game.nextHostileDefeatVpBonus?.[attackerPlayerNum]) {
          const _wecData = game.nextHostileDefeatVpBonus[attackerPlayerNum];
          const _wecAmt = typeof _wecData === 'object' ? (_wecData.amount ?? 2) : _wecData;
          game[vpKey].total += _wecAmt;
          game[vpKey].objectives += _wecAmt;
          delete game.nextHostileDefeatVpBonus[attackerPlayerNum];
          await logGameAction(game, client, `**Worth Every Credit** — +${_wecAmt} bonus VP (${game[vpKey].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // You Will Not Deny Me: prevent Fifth Brother defeat; on any hostile defeat recover 2 HP
        if (game.youWillNotDenyMeActive) {
          const _ywndmData = game.youWillNotDenyMeActive;
          const _fifthKey = Object.keys(game.figurePositions?.[_ywndmData.playerNum] || {}).find(k => k.replace(/-\d+-\d+$/, '').toLowerCase() === 'fifth brother' || k.replace(/-\d+-\d+$/, '') === 'fifth-brother');
          if (_fifthKey) {
            const _fifthMsgId = (() => { for (const [mid, mm] of dcMessageMeta) { if (mm.playerNum === _ywndmData.playerNum && mm.dcName?.toLowerCase().includes('fifth')) return mid; } return null; })();
            if (_fifthMsgId) {
              const _fifthHS = dcHealthState.get(_fifthMsgId);
              const _fifthFigIdx = 0;
              if (_fifthHS?.[_fifthFigIdx]) {
                const [_fc, _fm] = _fifthHS[_fifthFigIdx];
                const _fNew = Math.min((_fc ?? _fm) + 2, _fm ?? _fc);
                _fifthHS[_fifthFigIdx] = [_fNew, _fm ?? _fc];
                dcHealthState.set(_fifthMsgId, _fifthHS);
                const _fifthDcIds = _ywndmData.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
                const _fifthDcList = _ywndmData.playerNum === 1 ? game.p1DcList : game.p2DcList;
                const _fifthIdx = (_fifthDcIds || []).indexOf(_fifthMsgId);
                if (_fifthIdx >= 0 && _fifthDcList?.[_fifthIdx]) _fifthDcList[_fifthIdx].healthState = [..._fifthHS];
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
              const _apHS = dcHealthState.get(_apMsgId);
              const _apFigIdx = combat.attackerFigureIndex ?? 0;
              if (_apHS?.[_apFigIdx]) {
                const [_apCur, _apMax] = _apHS[_apFigIdx];
                const _apNew = Math.min((_apCur ?? _apMax) + _apAmt, _apMax ?? _apCur);
                _apHS[_apFigIdx] = [_apNew, _apMax ?? _apCur];
                dcHealthState.set(_apMsgId, _apHS);
                const _apDcList = attackerPlayerNum === 1 ? game.p1DcList : game.p2DcList;
                const _apDcIds = attackerPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
                const _apIdx = (_apDcIds || []).indexOf(_apMsgId);
                if (_apIdx >= 0 && _apDcList?.[_apIdx]) _apDcList[_apIdx].healthState = [..._apHS];
                await logGameAction(game, client, `**Apex Predator** — Recovered ${_apAmt} HP after defeating hostile within ${_apRange}.`, { phase: 'ROUND', icon: 'card' });
              }
            }
          }
          delete game.recoverOnHostileDefeat[attackerPlayerNum];
        }
        resultText += ` — **${combat.target.label} defeated!** +${vp} VP`;
        await logGameAction(game, client, `<@${ownerId}> defeated **${combat.target.label}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
        if (idx >= 0 && isGroupDefeated(game, defenderPlayerNum, idx)) {
          const activatedIndices = defenderPlayerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
          if (!activatedIndices.includes(idx)) {
            if (defenderPlayerNum === 1) game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining ?? 0) - 1);
            else game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining ?? 0) - 1);
            await updateActivationsMessage(game, defenderPlayerNum, client);
          }
          const ccAttachKey = defenderPlayerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
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
          }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        }
      }
    }
    if (combat.surgeRecover > 0 && combat.attackerMsgId != null) {
      const attMsgId = combat.attackerMsgId;
      const attIdx = combat.attackerFigureIndex ?? 0;
      const attHS = dcHealthState.get(attMsgId) || [];
      const attEntry = attHS[attIdx];
      if (attEntry) {
        const [c, m] = attEntry;
        const maxVal = m ?? c ?? 99;
        const newCur = Math.min((c ?? maxVal) + (combat.surgeRecover || 0), maxVal);
        attHS[attIdx] = [newCur, maxVal];
        dcHealthState.set(attMsgId, attHS);
        const attP = combat.attackerPlayerNum;
        const dcIds = attP === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcL = attP === 1 ? game.p1DcList : game.p2DcList;
        const i = (dcIds || []).indexOf(attMsgId);
        if (i >= 0 && dcL?.[i]) dcL[i].healthState = [...attHS];
      }
    }
    if (combat.superchargeStrainAfterAttackCount > 0 && combat.attackerMsgId != null) {
      const attMsgId = combat.attackerMsgId;
      const attIdx = combat.attackerFigureIndex ?? 0;
      const attHS = dcHealthState.get(attMsgId) || [];
      const attEntry = attHS[attIdx];
      if (attEntry) {
        const [c, m] = attEntry;
        const maxVal = m ?? c ?? 99;
        const strain = combat.superchargeStrainAfterAttackCount || 0;
        const newCur = Math.max(0, (c ?? maxVal) - strain);
        attHS[attIdx] = [newCur, maxVal];
        dcHealthState.set(attMsgId, attHS);
        const attP = combat.attackerPlayerNum;
        const dcIds = attP === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcL = attP === 1 ? game.p1DcList : game.p2DcList;
        const i = (dcIds || []).indexOf(attMsgId);
        if (i >= 0 && dcL?.[i]) dcL[i].healthState = [...attHS];
      }
    }
    if (totalBlast > 0 && hit && damage > 0 && game.selectedMap?.id) {
      const adjacent = getFiguresAdjacentToTarget(game, combat.target.figureKey, game.selectedMap.id);
      const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
      for (const { figureKey: blastFigureKey, playerNum: blastPlayerNum } of adjacent) {
        const blastMsgId = findDcMessageIdForFigure(game.gameId, blastPlayerNum, blastFigureKey);
        if (!blastMsgId) continue;
        const blastM = blastFigureKey.match(/-(\d+)-(\d+)$/);
        const blastFigIndex = blastM ? parseInt(blastM[2], 10) : 0;
        const blastHS = dcHealthState.get(blastMsgId) || [];
        const blastEntry = blastHS[blastFigIndex];
        if (!blastEntry) continue;
        const [bCur, bMax] = blastEntry;
        const blastDmg = totalBlast;
        const newBCur = Math.max(0, (bCur ?? bMax) - blastDmg);
        blastHS[blastFigIndex] = [newBCur, bMax ?? newBCur];
        dcHealthState.set(blastMsgId, blastHS);
        const blastDcIds = blastPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const blastDcList = blastPlayerNum === 1 ? game.p1DcList : game.p2DcList;
        const blastIdx = (blastDcIds || []).indexOf(blastMsgId);
        if (blastIdx >= 0 && blastDcList?.[blastIdx]) blastDcList[blastIdx].healthState = [...blastHS];
        if (newBCur <= 0) {
          if (game.figurePositions?.[blastPlayerNum]) delete game.figurePositions[blastPlayerNum][blastFigureKey];
          if (game.figureConditions?.[blastFigureKey]) delete game.figureConditions[blastFigureKey];
          const blastStats = getDcStats(blastDcList[blastIdx]?.dcName);
          const cost = blastStats?.cost ?? 5;
          const figures = blastStats?.figures ?? 1;
          const subCost = getDcEffects()[blastDcList[blastIdx]?.dcName]?.subCost;
          const vp = (figures > 1 && subCost != null) ? subCost : cost;
          game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
          game[vpKey].kills += vp;
          game[vpKey].total += vp;
          const blastLabel = blastDcList[blastIdx]?.displayName || blastFigureKey;
          await logGameAction(game, client, `Blast: <@${ownerId}> defeated **${blastLabel}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
          if (blastIdx >= 0 && isGroupDefeated(game, blastPlayerNum, blastIdx)) {
            const activatedIndices = blastPlayerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
            if (!activatedIndices.includes(blastIdx)) {
              if (blastPlayerNum === 1) game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining ?? 0) - 1);
              else game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining ?? 0) - 1);
              await updateActivationsMessage(game, blastPlayerNum, client);
            }
            const blastCcAttachKey = blastPlayerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
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
            }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
        const _bfAdj = _bfMs.adjacency?.[_bfTargetPos] || [];
        for (const _bfPn of [1, 2]) {
          for (const [_bfFk, _bfPos] of Object.entries(game.figurePositions?.[_bfPn] || {})) {
            if (!_bfAdj.includes(_bfPos)) continue;
            if (_bfFk === combat.target.figureKey) continue;
            game.figureConditions = game.figureConditions || {};
            game.figureConditions[_bfFk] = game.figureConditions[_bfFk] || [];
            if (!game.figureConditions[_bfFk].includes('Stun')) {
              game.figureConditions[_bfFk].push('Stun');
              const _bfDcName = _bfFk.replace(/-\d+-\d+$/, '');
              await logGameAction(game, client, `\uD83D\uDCA5 **Burst Fire** \u2014 **${_bfDcName}** (adjacent) is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' });
            }
          }
        }
      }
    }
  }
  const embedRefreshMsgIds = new Set(damage > 0 && targetMsgId ? [targetMsgId] : []);
  if (combat.surgeRecover > 0 && combat.attackerMsgId != null) embedRefreshMsgIds.add(combat.attackerMsgId);

  // Concentrated Fire: apply Stun to the attacker figure after attack resolves
  if (game.applySelfStunAfterAttackPlayerNum?.[attackerPlayerNum] && combat.attackerMsgId) {
    delete game.applySelfStunAfterAttackPlayerNum[attackerPlayerNum];
    const _cfaFigKey = combat.attackerFigureKey;
    if (_cfaFigKey) {
      game.figureConditions = game.figureConditions || {};
      game.figureConditions[_cfaFigKey] = game.figureConditions[_cfaFigKey] || [];
      if (!game.figureConditions[_cfaFigKey].includes('Stun')) {
        game.figureConditions[_cfaFigKey].push('Stun');
        const _cfaDcName = _cfaFigKey.replace(/-\d+-\d+$/, '');
        await logGameAction(game, client, `**Concentrated Fire** — **${_cfaDcName}** is now **Stunned**.`, { phase: 'ROUND', icon: 'card' });
        embedRefreshMsgIds.add(combat.attackerMsgId);
      }
    }
  }
  // Wild Fury: after final free attack, apply postActivationConditions (Stun + Bleed) to attacker figure
  if (game.pendingPostAttackConditions?.[combat.attackerMsgId] && combat.attackerFigureKey) {
    const _ppaConditions = game.pendingPostAttackConditions[combat.attackerMsgId];
    delete game.pendingPostAttackConditions[combat.attackerMsgId];
    if (Array.isArray(_ppaConditions) && _ppaConditions.length > 0) {
      game.figureConditions = game.figureConditions || {};
      game.figureConditions[combat.attackerFigureKey] = game.figureConditions[combat.attackerFigureKey] || [];
      for (const _ppaC of _ppaConditions) {
        if (!game.figureConditions[combat.attackerFigureKey].includes(_ppaC)) {
          game.figureConditions[combat.attackerFigureKey].push(_ppaC);
        }
      }
      const _ppaDcName = combat.attackerFigureKey.replace(/-\d+-\d+$/, '');
      await logGameAction(game, client, `**Wild Fury** — **${_ppaDcName}** is now **${_ppaConditions.join(' + ')}**.`, { phase: 'ROUND', icon: 'card' });
      embedRefreshMsgIds.add(combat.attackerMsgId);
    }
  }
  // Dying Lunge / Final Stand: attacker defeats itself after the attack resolves
  if (game.selfDefeatsAfterAttackMsgId?.[combat.attackerMsgId] && combat.attackerMsgId) {
    delete game.selfDefeatsAfterAttackMsgId[combat.attackerMsgId];
    const _sdaMsgId = combat.attackerMsgId;
    const _sdaFigKey = combat.attackerFigureKey;
    const _sdaFigIdx = combat.attackerFigureIndex ?? 0;
    if (_sdaFigKey) {
      const _sdaHS = dcHealthState.get(_sdaMsgId) || [];
      if (_sdaHS[_sdaFigIdx]) {
        const [_sdaC, _sdaM] = _sdaHS[_sdaFigIdx];
        _sdaHS[_sdaFigIdx] = [0, _sdaM ?? _sdaC];
        dcHealthState.set(_sdaMsgId, _sdaHS);
        const _sdaDcIds = attackerPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const _sdaDcList = attackerPlayerNum === 1 ? game.p1DcList : game.p2DcList;
        const _sdaIdx = (_sdaDcIds || []).indexOf(_sdaMsgId);
        if (_sdaIdx >= 0 && _sdaDcList?.[_sdaIdx]) _sdaDcList[_sdaIdx].healthState = [..._sdaHS];
        if (game.figurePositions?.[attackerPlayerNum]) delete game.figurePositions[attackerPlayerNum][_sdaFigKey];
        if (game.figureConditions?.[_sdaFigKey]) delete game.figureConditions[_sdaFigKey];
        const _sdaName = _sdaDcList?.[_sdaIdx]?.displayName || _sdaFigKey.replace(/-\d+-\d+$/, '');
        const _sdaVpKey = defenderPlayerNum === 1 ? 'player1VP' : 'player2VP';
        game[_sdaVpKey] = game[_sdaVpKey] || { total: 0, kills: 0, objectives: 0 };
        const _sdaStats = _sdaIdx >= 0 ? getDcStats(_sdaDcList[_sdaIdx]?.dcName) : null;
        const _sdaVp = _sdaStats?.cost ?? 5;
        game[_sdaVpKey].kills += _sdaVp;
        game[_sdaVpKey].total += _sdaVp;
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
      const hHS = dcHealthState.get(targetMsgId) || [];
      const hEntry = hHS[targetFigIndex];
      if (hEntry) {
        const [hC, hM] = hEntry;
        const hNew = Math.max(0, (hC ?? hM) - combat.surgeHarass);
        hHS[targetFigIndex] = [hNew, hM ?? hNew];
        dcHealthState.set(targetMsgId, hHS);
        const hDcIds = defenderPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const hDcL = defenderPlayerNum === 1 ? game.p1DcList : game.p2DcList;
        const hIdx = (hDcIds || []).indexOf(targetMsgId);
        if (hIdx >= 0 && hDcL?.[hIdx]) hDcL[hIdx].healthState = [...hHS];
        embedRefreshMsgIds.add(targetMsgId);
        await logGameAction(game, client, `**Harass** — **${combat.target.label}** suffers **${combat.surgeHarass}** Strain`, { phase: 'ROUND', icon: 'attack' });
      }
    }
    // Suppression: target suffers Strain = min(block + evade + [1 if dodge], 2)
    if (combat.surgeSuppressionStrain) {
      const supRoll = combat.defenseRoll || {};
      const supAmt = Math.min((supRoll.block || 0) + (supRoll.evade || 0) + (supRoll.dodge ? 1 : 0), 2);
      if (supAmt > 0) {
        const sHS = dcHealthState.get(targetMsgId) || [];
        const sEntry = sHS[targetFigIndex];
        if (sEntry) {
          const [sC, sM] = sEntry;
          const sNew = Math.max(0, (sC ?? sM) - supAmt);
          sHS[targetFigIndex] = [sNew, sM ?? sNew];
          dcHealthState.set(targetMsgId, sHS);
          const sDcIds = defenderPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
          const sDcL = defenderPlayerNum === 1 ? game.p1DcList : game.p2DcList;
          const sIdx = (sDcIds || []).indexOf(targetMsgId);
          if (sIdx >= 0 && sDcL?.[sIdx]) sDcL[sIdx].healthState = [...sHS];
          embedRefreshMsgIds.add(targetMsgId);
          await logGameAction(game, client, `**Suppression** — **${combat.target.label}** suffers **${supAmt}** Strain (${supRoll.block || 0} block, ${supRoll.evade || 0} evade${supRoll.dodge ? ', 1 dodge' : ''})`, { phase: 'ROUND', icon: 'attack' });
        }
      }
    }
  }
  // Mandalorian Steel: if defender spent a Block Token this attack, recover 1 Damage on the defending figure
  if (combat.defenderSpentBlock && game.mandaAsteelPlayerNum === defenderPlayerNum && targetMsgId) {
    const msHS = dcHealthState.get(targetMsgId) || [];
    const msEntry = msHS[targetFigIndex];
    if (msEntry) {
      const [msC, msM] = msEntry;
      const msNew = Math.min(msM ?? msC ?? 99, (msC ?? msM ?? 0) + 1);
      if (msNew > (msC ?? msM ?? 0)) {
        msHS[targetFigIndex] = [msNew, msM ?? msNew];
        dcHealthState.set(targetMsgId, msHS);
        const msDcIds = defenderPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const msDcList = defenderPlayerNum === 1 ? game.p1DcList : game.p2DcList;
        const msIdx = (msDcIds || []).indexOf(targetMsgId);
        if (msIdx >= 0 && msDcList?.[msIdx]) msDcList[msIdx].healthState = [...msHS];
        embedRefreshMsgIds.add(targetMsgId);
        await logGameAction(game, client, `**Mandalorian Steel** — **${combat.target.label}** spent a Block Token; recovered 1 Damage`, { phase: 'ROUND', icon: 'card' });
      }
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
      const sqDcName = sqFk.replace(/-\d+-\d+$/, '');
      const sqEff = getDcEffects()?.[sqDcName] || getDcEffects()?.[sqDcName?.replace(/\s*\[.*\]\s*$/, '')];
      const sqKws = (sqEff?.keywords || []).map((k) => String(k).toUpperCase());
      if (!sqKws.includes('TROOPER')) continue;
      game.figureConditions = game.figureConditions || {};
      const sqExisting = game.figureConditions[sqFk] || [];
      if (!sqExisting.includes('Focus')) {
        game.figureConditions[sqFk] = [...sqExisting, 'Focus'];
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
      const attHS = dcHealthState.get(attMsgId) || [];
      const attEntry = attHS[attFigIdx];
      if (attEntry) {
        const [aC, aM] = attEntry;
        const aNew = Math.max(0, (aC ?? aM) - deflectDmg);
        attHS[attFigIdx] = [aNew, aM ?? aNew];
        dcHealthState.set(attMsgId, attHS);
        const attDcIds = attackerPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const attDcList = attackerPlayerNum === 1 ? game.p1DcList : game.p2DcList;
        const attDcIdx = (attDcIds || []).indexOf(attMsgId);
        if (attDcIdx >= 0 && attDcList?.[attDcIdx]) attDcList[attDcIdx].healthState = [...attHS];
        embedRefreshMsgIds.add(attMsgId);
        const defOwnerId = defenderPlayerNum === 1 ? game.player1Id : game.player2Id;
        await logGameAction(game, client, `<@${defOwnerId}> **Deflection** — Attacker suffers **${deflectDmg} Damage** (you took no damage).`, { allowedMentions: { users: [defOwnerId] }, phase: 'ROUND', icon: 'card' });
      }
    }
  }
  if (totalBlast > 0 && hit && game.selectedMap?.id) {
    const blastAdjacent = getFiguresAdjacentToTarget(game, combat.target.figureKey, game.selectedMap.id);
    for (const { figureKey: bk, playerNum: bp } of blastAdjacent) {
      const mid = findDcMessageIdForFigure(game.gameId, bp, bk);
      if (mid) embedRefreshMsgIds.add(mid);
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
          const msgId = findDcMessageIdForFigure(game.gameId, c.playerNum, c.figureKey);
          const dcIds = c.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
          const dcList = c.playerNum === 1 ? game.p1DcList : game.p2DcList;
          const idx = (dcIds || []).indexOf(msgId);
          const label = (idx >= 0 && dcList?.[idx]?.displayName) ? dcList[idx].displayName : c.figureKey;
          return { figureKey: c.figureKey, playerNum: c.playerNum, label: String(label).slice(0, 80) };
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
        const mid = findDcMessageIdForFigure(game.gameId, c.playerNum, c.figureKey);
        const dcList = c.playerNum === 1 ? game.p1DcList : game.p2DcList;
        const dcIds = c.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const idx = (dcIds || []).indexOf(mid);
        const label = idx >= 0 && dcList?.[idx]?.displayName ? dcList[idx].displayName : c.figureKey.replace(/-\d+-\d+$/, '');
        return { figureKey: c.figureKey, playerNum: c.playerNum, label: String(label).slice(0, 80), msgId: mid };
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
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return true;
    }
  }
  // Concussive Bolt (4-LOM): after non-miss on SMALL target, push target 1 space (attacker picks direction)
  if (hit && combat.surgeConcussiveBolt && combat.target?.figureKey && game.selectedMap?.id) {
    const targetDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
    const targetSize = getFigureSize(targetDcName);
    if (targetSize === '1x1') {
      const targetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      const ms = getMapSpaces(game.selectedMap.id);
      const adjSpaces = (ms?.adjacency?.[String(targetPos).toLowerCase()] || []).map((s) => String(s).toLowerCase());
      if (adjSpaces.length > 0) {
        const targetMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, combat.target.figureKey);
        const defDcList = defenderPlayerNum === 1 ? game.p1DcList : game.p2DcList;
        const defDcIds = defenderPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const defIdx = (defDcIds || []).indexOf(targetMsgId);
        const targetLabel = (defIdx >= 0 && defDcList?.[defIdx]?.displayName) ? defDcList[defIdx].displayName : targetDcName;
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
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
            const mid = findDcMessageIdForFigure(game.gameId, p, figKey);
            const dcList = p === 1 ? game.p1DcList : game.p2DcList;
            const dcIds = p === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
            const idx = (dcIds || []).indexOf(mid);
            const dcName = figKey.replace(/-\d+-\d+$/, '');
            const label = idx >= 0 && dcList?.[idx]?.displayName ? dcList[idx].displayName : dcName;
            figuresAtSpaces.push({ figureKey: figKey, playerNum: p, label: String(label).slice(0, 70), msgId: mid });
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
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return true;
      }
    }
  }
  // Post-attack reactions: check if defender has Payback, Dangerous Prey, or Right Back At Ya!
  const defenderHand = defenderPlayerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
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
    const defOwnerId = defenderPlayerNum === 1 ? game.player1Id : game.player2Id;
    // Tentatively remove from hand to prevent double-prompt; restored on skip
    const handKey = defenderPlayerNum === 1 ? 'player1CcHand' : 'player2CcHand';
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
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return true;
  }
  // Agitate (Cam Droid): on hit, defender's group must activate next, if able
  if (hit && combat.surgeAgitate && combat.target?.figureKey) {
    const defenderDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
    game.agitateNextActivation = { playerNum: defenderPlayerNum, dcName: defenderDcName };
    const defLabel = combat.target.label || defenderDcName;
    await thread.send(`**Agitate** — **${defLabel}**'s group must be the next to activate this round, if able.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
  // Fell Swoop (Davith Elso): after attack, become Hidden, gain 2 MP, free attack. Limit once per round.
  if (combat.surgeFellSwoop && combat.attackerFigureKey) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    const fsKey = `${combat.attackerFigureKey}_fell_swoop`;
    if (!game.roundFigureAbilityUsed[fsKey]) {
      game.roundFigureAbilityUsed[fsKey] = true;
      game.figureConditions = game.figureConditions || {};
      const existing = game.figureConditions[combat.attackerFigureKey] || [];
      if (!existing.includes('Hide')) game.figureConditions[combat.attackerFigureKey] = [...existing, 'Hide'];
      if (game.movementBank?.[combat.attackerMsgId]) {
        game.movementBank[combat.attackerMsgId].remaining += 2;
        game.movementBank[combat.attackerMsgId].total += 2;
        updateMovementBankMessage(game, combat.attackerMsgId, client).catch(() => {});
      }
      game.fellSwoopFreeAttack = game.fellSwoopFreeAttack || {};
      game.fellSwoopFreeAttack[combat.attackerMsgId] = true;
      const attName = combat.attackerDisplayName || combat.attackerFigureKey.replace(/-\d+-\d+$/, '');
      await thread.send(`**Fell Swoop** — **${attName}** becomes **Hidden** and gains **2 Movement Points**. Use Move in the DC thread, then click Attack for a free Fell Swoop attack (costs no action).`).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  // Mastery (Second Sister): redraw a FORCE USER CC of cost ≤ 1 from discard. Limit once per round.
  if (combat.surgeMastery && combat.attackerFigureKey) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    const mastKey = `${combat.attackerFigureKey}_mastery`;
    if (!game.roundFigureAbilityUsed[mastKey]) {
      game.roundFigureAbilityUsed[mastKey] = true;
      const mastPlayerNum = combat.attackerPlayerNum;
      const mastDiscardKey = mastPlayerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
      const mastDiscard = game[mastDiscardKey] || [];
      const mastEligible = mastDiscard.filter((cardName) => {
        const entry = getCcEffect(cardName);
        return entry && (entry.cost ?? 99) <= 1 && String(entry.playableBy || '').toUpperCase().includes('FORCE USER');
      });
      if (mastEligible.length === 0) {
        await thread.send(`**Mastery** — No eligible FORCE USER Command cards (cost ≤ 1) in your discard pile.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
      } else {
        game.pendingMastery = { gameId: game.gameId, attackerPlayerNum: mastPlayerNum, discardKey: mastDiscardKey, eligible: mastEligible, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum };
        const mastOwnerId = mastPlayerNum === 1 ? game.player1Id : game.player2Id;
        const mastBtns = mastEligible.slice(0, 4).map((cardName, i) =>
          new ButtonBuilder().setCustomId(`mastery_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Primary)
        );
        mastBtns.push(new ButtonBuilder().setCustomId(`mastery_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({
          content: `<@${mastOwnerId}> **Mastery** — Choose a FORCE USER CC (cost ≤ 1) from your discard pile to return to hand:`,
          allowedMentions: { users: [mastOwnerId] },
          components: [new ActionRowBuilder().addComponents(mastBtns)],
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return true;
      }
    }
  }
  // Interrogate (Agent Blaise): look at opponent's hand, choose a CC; may discard equal/greater cost to force discard.
  if (combat.surgeInterrogate) {
    const intAttackerPlayerNum = combat.attackerPlayerNum;
    const intOpponentPlayerNum = defenderPlayerNum;
    const intOpponentHandKey = intOpponentPlayerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const intOpponentHand = game[intOpponentHandKey] || [];
    if (intOpponentHand.length === 0) {
      await thread.send(`**Interrogate** — Opponent's hand is empty; no card to choose.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } else {
      game.pendingInterrogate = { gameId: game.gameId, attackerPlayerNum: intAttackerPlayerNum, opponentPlayerNum: intOpponentPlayerNum, opponentHandSnapshot: [...intOpponentHand], chosenCardName: null, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum };
      const intOwnerId = intAttackerPlayerNum === 1 ? game.player1Id : game.player2Id;
      const intBtns = intOpponentHand.slice(0, 4).map((cardName, i) =>
        new ButtonBuilder().setCustomId(`interrogate_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Danger)
      );
      await thread.send({
        content: `<@${intOwnerId}> **Interrogate** — ⚠️ *Opponent: look away!* Pick the card you want to target:`,
        allowedMentions: { users: [intOwnerId] },
        components: [new ActionRowBuilder().addComponents(intBtns)],
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return true;
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
    const ownerId = combat.attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
    await logGameAction(game, client, `Hit and Run: <@${ownerId}> gained **${n}** movement point${n === 1 ? '' : 's'} after the attack.`, { allowedMentions: { users: [ownerId] }, phase: 'ACTION', icon: 'card' });
    await ensureMovementBankMessage(game, pending.msgId, client);
    delete game.hitAndRunPendingMp;
  }
  // --- Post-combat ability prompts (before clearing pendingCombat) ---
  const pcAttEff = getDcEffects()?.[combat.attackerDcName] || getDcEffects()?.[combat.attackerDcName?.replace(/\s*\[.*\]\s*$/, '')];
  const pcAttIds = pcAttEff?.specialAbilityIds || [];
  const pcOwnerId = combat.attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
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
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  // Boltslinger (Vinto Hreeda): deal 1 Dmg to another hostile within 3 after attack
  if (pcAttIds.includes('boltslinger') && game.selectedMap?.id && combat.attackerFigureKey) {
    const blDefPlayerNum = combat.attackerPlayerNum === 1 ? 2 : 1;
    const atkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
    const defFigs = game.figurePositions?.[blDefPlayerNum] || {};
    const boltslingerTargets = [];
    for (const [fk, pos] of Object.entries(defFigs)) {
      if (fk === combat.target?.figureKey) continue;
      if (!isWithinN(atkPos, pos, 3, game.selectedMap.id)) continue;
      const blMsgId = findDcMessageIdForFigure(game.gameId, blDefPlayerNum, fk);
      const blDcIds = blDefPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const blDcList = blDefPlayerNum === 1 ? game.p1DcList : game.p2DcList;
      const blIdx = (blDcIds || []).indexOf(blMsgId);
      const blLabel = (blIdx >= 0 && blDcList?.[blIdx]?.displayName) ? blDcList[blIdx].displayName : fk.replace(/-\d+-\d+$/, '');
      boltslingerTargets.push({ figureKey: fk, playerNum: blDefPlayerNum, label: String(blLabel).slice(0, 80) });
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
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  // Indiscriminate Fire (Bossk): after attack, if not a miss, choose 1 non-red attack die;
  // each figure within 2 spaces of target (other than the defender) suffers Damage = Hits and Strain = Surges on that die.
  if (pcAttIds.includes('indiscriminate_fire') && !resultText.includes('**Miss**') && game.selectedMap?.id && combat.target?.figureKey) {
    const ifDefPlayerNum = combat.attackerPlayerNum === 1 ? 2 : 1;
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
          const mid = findDcMessageIdForFigure(game.gameId, pn, fk);
          const dcIds = pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
          const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
          const idx2 = (dcIds || []).indexOf(mid);
          const lbl = (idx2 >= 0 && dcList?.[idx2]?.displayName) ? dcList[idx2].displayName : fk.replace(/-\d+-\d+$/, '');
          splashTargets.push({ figureKey: fk, playerNum: pn, label: String(lbl).slice(0, 80) });
        }
      }
      if (nonRedDice.length === 1) {
        await applyIndiscriminateFireSplash(game, combat.attackerPlayerNum, combat.combatThreadId, nonRedDice[0], splashTargets, thread, client);
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
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
    }
  }

  // Missile Salvo: after each salvo attack, record target + show remaining die buttons
  if (combat.attackerMsgId && game.pendingMissileSalvo?.[combat.attackerMsgId]) {
    const ms = game.pendingMissileSalvo[combat.attackerMsgId];
    if (combat.target?.figureKey) ms.targetsFired = [...(ms.targetsFired || []), combat.target.figureKey];
    if (ms.diceAvailable?.length > 0) {
      const salvoOwnerId = combat.attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
      const colorStyle = { blue: ButtonStyle.Primary, red: ButtonStyle.Danger, yellow: ButtonStyle.Secondary };
      const salvoBtns = ms.diceAvailable.map((c) =>
        new ButtonBuilder().setCustomId(`missile_salvo_die_${c}_${game.gameId}_${combat.attackerMsgId}`).setLabel(`${c.charAt(0).toUpperCase() + c.slice(1)} Die`).setStyle(colorStyle[c] || ButtonStyle.Secondary)
      );
      salvoBtns.push(new ButtonBuilder().setCustomId(`missile_salvo_done_${game.gameId}_${combat.attackerMsgId}`).setLabel('End Salvo').setStyle(ButtonStyle.Success));
      await thread.send({
        content: `<@${salvoOwnerId}> **Missile Salvo** — ${ms.diceAvailable.length} shot${ms.diceAvailable.length !== 1 ? 's' : ''} remaining. Choose a die for your next attack (different target):`,
        components: [new ActionRowBuilder().addComponents(salvoBtns)],
        allowedMentions: { users: [salvoOwnerId] },
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } else {
      delete game.pendingMissileSalvo[combat.attackerMsgId];
      await thread.send('**Missile Salvo** — All shots fired. Salvo complete.').catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }

  delete game.pendingCombat;
  delete game.pendingCleave;
  if (combat.rollMessageId) {
    try {
      const rollMsg = await thread.messages.fetch(combat.rollMessageId);
      await rollMsg.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch {}
  }
  for (const msgId of embedRefreshMsgIds) {
    try {
      const meta = dcMessageMeta.get(msgId);
      if (meta) {
        const channelId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
        const channel = await client.channels.fetch(channelId);
        const dcMsg = await channel.messages.fetch(msgId);
        const exhausted = dcExhaustedState.get(msgId) ?? false;
        const healthState = dcHealthState.get(msgId) || [];
        const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, meta.displayName, healthState, getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, msgId));
        await dcMsg.edit({ embeds: [embed], files }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await updateDcActionsMessage(game, combat.attackerMsgId, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
}

/** Sidewinder (Jyn Odan): apply 1 Strain + grant 2 MP after attack. */
async function handleSidewinderApply(interaction) {
  const m = interaction.customId.match(/^sidewinder_apply_([^_]+)_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, attackerMsgId, figIndexStr] = m;
  const game = getGame(gameId);
  if (!game) return;
  const figureIndex = parseInt(figIndexStr, 10);
  const meta = dcMessageMeta.get(attackerMsgId);
  if (!meta) return;
  if (!canActAsPlayer(game, interaction.user.id, meta.playerNum)) {
    await interaction.followUp({ content: 'Only the attacker can use Sidewinder.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const swKey = figureKey + '_sidewinder';
  if (game.roundFigureAbilityUsed?.[swKey]) {
    await interaction.followUp({ content: 'Sidewinder already used this round.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  // Apply 1 Strain
  const attHS = dcHealthState.get(attackerMsgId) || [];
  const attEntry = attHS[figureIndex];
  if (attEntry) {
    const [aC, aM] = attEntry;
    const aMVal = aM ?? aC ?? 99;
    const aNew = Math.max(0, (aC ?? aMVal) - 1);
    attHS[figureIndex] = [aNew, aMVal];
    dcHealthState.set(attackerMsgId, attHS);
    const dcIds = meta.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcList = meta.playerNum === 1 ? game.p1DcList : game.p2DcList;
    const idx = (dcIds || []).indexOf(attackerMsgId);
    if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...attHS];
  }
  // Grant 2 MP
  game.movementBank = game.movementBank || {};
  const bank = game.movementBank[attackerMsgId] || { total: 0, remaining: 0 };
  bank.total = (bank.total ?? 0) + 2;
  bank.remaining = (bank.remaining ?? 0) + 2;
  game.movementBank[attackerMsgId] = bank;
  // Mark used this round
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  game.roundFigureAbilityUsed[swKey] = true;
  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.channel.send('**Sidewinder** — Jyn Odan suffered 1 Strain and gained +2 MP.');
  await logGameAction(game, client, `**Sidewinder** — Jyn Odan suffered 1 Strain and gained +2 MP.`, { phase: 'ROUND', icon: 'card' });
  await ensureMovementBankMessage(game, attackerMsgId, client);
  try {
    const ch = await client.channels.fetch(meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId);
    const msg = await ch.messages.fetch(attackerMsgId);
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, dcExhaustedState.get(attackerMsgId) ?? false, meta.displayName, dcHealthState.get(attackerMsgId) || [], getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, attackerMsgId));
    await msg.edit({ embeds: [embed], files }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch (e) { console.error('Failed to refresh Sidewinder DC embed:', e); }
  saveGames();
}

async function handleSidewinderSkip(interaction) {
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  saveGames();
}

/** Boltslinger (Vinto Hreeda): deal 1 Dmg to chosen nearby hostile. */
async function handleBoltslingerTarget(interaction) {
  const m = interaction.customId.match(/^boltslinger_target_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingBoltslinger) return;
  const { attackerPlayerNum, combatThreadId, targets } = game.pendingBoltslinger;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
    await interaction.followUp({ content: 'Only the attacker can use Boltslinger.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const target = targets[parseInt(idxStr, 10)];
  if (!target) return;
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  const targetMsgId = findDcMessageIdForFigure(gameId, target.playerNum, target.figureKey);
  if (targetMsgId) {
    const figMatch = target.figureKey.match(/-(\d+)-(\d+)$/);
    const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;
    const hs = dcHealthState.get(targetMsgId) || [];
    const entry = hs[figIdx];
    if (entry) {
      const [c, mVal] = entry;
      const maxHp = mVal ?? c ?? 99;
      const nNew = Math.max(0, (c ?? maxHp) - 1);
      hs[figIdx] = [nNew, maxHp];
      dcHealthState.set(targetMsgId, hs);
      const dcIds = target.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList = target.playerNum === 1 ? game.p1DcList : game.p2DcList;
      const idx = (dcIds || []).indexOf(targetMsgId);
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...hs];
      try {
        const tMeta = dcMessageMeta.get(targetMsgId);
        if (tMeta) {
          const ch = await client.channels.fetch(tMeta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId);
          const msg = await ch.messages.fetch(targetMsgId);
          const { embed, files } = await buildDcEmbedAndFiles(tMeta.dcName, dcExhaustedState.get(targetMsgId) ?? false, tMeta.displayName, dcHealthState.get(targetMsgId) || [], getConditionsForDcMessage(game, tMeta), getDcUpgradeAttachments(game, targetMsgId));
          await msg.edit({ embeds: [embed], files }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        }
      } catch (e) { console.error('Failed to refresh Boltslinger target embed:', e); }
    }
  }
  const blThread = await client.channels.fetch(combatThreadId).catch(() => null);
  if (blThread) await blThread.send(`**Boltslinger** — **${target.label}** suffers 1 Damage.`);
  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  await logGameAction(game, client, `**Boltslinger** — **${target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' });
  delete game.pendingBoltslinger;
  saveGames();
}

async function handleBoltslingerSkip(interaction) {
  const m = interaction.customId.match(/^boltslinger_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  if (game) delete game.pendingBoltslinger;
  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  saveGames();
}

/** Indiscriminate Fire (Bossk): apply splash damage/strain to all figures within 2 of target (except defender). */
async function applyIndiscriminateFireSplash(game, attackerPlayerNum, combatThreadId, die, splashTargets, thread, client) {
  const totalDmg = die.dmg || 0;
  const totalStrain = die.surge || 0;
  const totalEffect = totalDmg + totalStrain;
  const dieColor = String(die.color || '').replace(/^\w/, (c) => c.toUpperCase());
  const dieDesc = `${dieColor} die (${totalDmg} dmg, ${totalStrain} strain)`;
  if (splashTargets.length === 0) {
    await thread.send(`**Indiscriminate Fire** — ${dieDesc}: No figures within 2 spaces of the target.`).catch(() => {});
    return;
  }
  if (totalEffect === 0) {
    await thread.send(`**Indiscriminate Fire** — ${dieDesc}: 0 effect on splash targets.`).catch(() => {});
    return;
  }
  const lines = [];
  for (const t of splashTargets) {
    const mid = findDcMessageIdForFigure(game.gameId, t.playerNum, t.figureKey);
    if (!mid) continue;
    const figM = t.figureKey.match(/-(\d+)-(\d+)$/);
    const figIdx = figM ? parseInt(figM[2], 10) : 0;
    const hs = dcHealthState.get(mid) || [];
    const entry = hs[figIdx];
    if (!entry) continue;
    const [cur, maxHp] = entry;
    const newHp = Math.max(0, (cur ?? maxHp) - totalEffect);
    hs[figIdx] = [newHp, maxHp ?? newHp];
    dcHealthState.set(mid, hs);
    const dcIds = t.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcList = t.playerNum === 1 ? game.p1DcList : game.p2DcList;
    const idx = (dcIds || []).indexOf(mid);
    if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...hs];
    const parts = [];
    if (totalDmg > 0) parts.push(`${totalDmg} Damage`);
    if (totalStrain > 0) parts.push(`${totalStrain} Strain`);
    lines.push(`• **${t.label}** suffers ${parts.join(' + ')}`);
    if (newHp <= 0) {
      if (game.figurePositions?.[t.playerNum]) delete game.figurePositions[t.playerNum][t.figureKey];
      if (game.figureConditions?.[t.figureKey]) delete game.figureConditions[t.figureKey];
      const splashDcEff = getDcEffects()?.[t.figureKey.replace(/-\d+-\d+$/, '')];
      const splashVP = splashDcEff?.cost ?? 1;
      const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
      game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
      game[vpKey].kills += splashVP; game[vpKey].total += splashVP;
      lines.push(`  → **${t.label} defeated!** +${splashVP} VP`);
    }
    try {
      const tMeta = dcMessageMeta.get(mid);
      if (tMeta) {
        const ch = await client.channels.fetch(tMeta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId);
        const msg = await ch.messages.fetch(mid);
        const { embed, files } = await buildDcEmbedAndFiles(tMeta.dcName, dcExhaustedState.get(mid) ?? false, tMeta.displayName, dcHealthState.get(mid) || [], getConditionsForDcMessage(game, tMeta), getDcUpgradeAttachments(game, mid));
        await msg.edit({ embeds: [embed], files }).catch(() => {});
      }
    } catch {}
  }
  const msg = `**Indiscriminate Fire** — ${dieDesc}:\n${lines.join('\n')}`;
  await thread.send(msg).catch(() => {});
  await logGameAction(game, client, `**Indiscriminate Fire** — ${dieDesc}: splash to ${lines.length} figure(s).`, { phase: 'ROUND', icon: 'attack' });
  saveGames();
}

/** Indiscriminate Fire die choice button: indiscriminate_die_{gameId}_{dieIndex} */
async function handleIndiscriminateFireDie(interaction) {
  const m = interaction.customId.match(/^indiscriminate_die_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingIndiscriminateFire) return;
  const { attackerPlayerNum, combatThreadId, targets, availableDice } = game.pendingIndiscriminateFire;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
    await interaction.followUp({ content: 'Only the attacker can choose the Indiscriminate Fire die.', ephemeral: true }).catch(() => {});
    return;
  }
  const die = availableDice[parseInt(idxStr, 10)];
  if (!die) return;
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  delete game.pendingIndiscriminateFire;
  await interaction.message.edit({ components: [] }).catch(() => {});
  const thread = await client.channels.fetch(combatThreadId).catch(() => null);
  if (thread) await applyIndiscriminateFireSplash(game, attackerPlayerNum, combatThreadId, die, targets, thread, client);
  saveGames();
}

/** Indiscriminate Fire skip button: indiscriminate_skip_{gameId} */
async function handleIndiscriminateFireSkip(interaction) {
  const m = interaction.customId.match(/^indiscriminate_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  if (game) delete game.pendingIndiscriminateFire;
  await interaction.message.edit({ components: [] }).catch(() => {});
  saveGames();
}

/** Fighting Knife target pick: fighting_knife_target_{gameId}_{index} */
async function handleFightingKnifeTarget(interaction) {
  const m = interaction.customId.match(/^fighting_knife_target_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingFightingKnife) return;
  const pending = game.pendingFightingKnife;
  if (!canActAsPlayer(game, interaction.user.id, pending.attackerPlayerNum)) {
    await interaction.followUp({ content: 'Only the attacker can pick the Fighting Knife target.', ephemeral: true }).catch(() => {});
    return;
  }
  const target = pending.targets[parseInt(idxStr, 10)];
  if (!target) return;
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.edit({ components: [] }).catch(() => {});
  delete game.pendingFightingKnife;
  // Roll 1 red die
  const die = rollSingleAttackDie('red');
  const hits = die.dmg || 0;
  const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
  if (!thread) { saveGames(); return; }
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  if (hits > 0 && target.msgId) {
    const fkMatch = target.figureKey.match(/-(\d+)-(\d+)$/);
    const figIndex = fkMatch ? parseInt(fkMatch[2], 10) : 0;
    const healthState = dcHealthState.get(target.msgId) || [];
    const entry = healthState[figIndex];
    if (entry) {
      const [cur, max] = entry;
      const newCur = Math.max(0, (cur ?? max) - hits);
      healthState[figIndex] = [newCur, max ?? newCur];
      dcHealthState.set(target.msgId, healthState);
      const dcIds = target.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList = target.playerNum === 1 ? game.p1DcList : game.p2DcList;
      const idx = (dcIds || []).indexOf(target.msgId);
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
      embedRefreshMsgIds.add(target.msgId);
      if (newCur <= 0) {
        if (game.figurePositions?.[target.playerNum]) delete game.figurePositions[target.playerNum][target.figureKey];
        const dcName = target.figureKey.replace(/-\d+-\d+$/, '');
        const stats = getDcStats(dcName);
        const effects = getDcEffects()?.[dcName];
        const figures = stats?.figures ?? 1;
        const vp = (figures > 1 && effects?.subCost != null) ? effects.subCost : (stats?.cost ?? 5);
        const vpKey = pending.attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
        game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
        game[vpKey].kills += vp;
        game[vpKey].total += vp;
        await logGameAction(game, client, `**Fighting Knife** — **${target.label}** was defeated! +${vp} VP`, { phase: 'ROUND', icon: 'attack' });
        if (idx >= 0 && isGroupDefeated(game, target.playerNum, idx)) {
          const activatedIndices = target.playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
          if (!activatedIndices.includes(idx)) {
            if (target.playerNum === 1) game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining ?? 0) - 1);
            else game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining ?? 0) - 1);
            await updateActivationsMessage(game, target.playerNum, client);
          }
        }
        await checkWinConditions(game, client);
      }
    }
  }
  const dieDesc = `${die.dmg}dmg${die.surge ? `/${die.surge}↯` : ''}`;
  await logGameAction(game, client, `**Fighting Knife** — ${target.label}: rolled 1 red die (${dieDesc}), dealt **${hits}** damage`, { phase: 'ROUND', icon: 'attack' });
  await thread.send(`**Fighting Knife** — Rolled 1 red die on **${target.label}**: ${dieDesc} → **${hits} Damage**.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
}

/** Fighting Knife skip: fighting_knife_skip_{gameId} */
async function handleFightingKnifeSkip(interaction) {
  const m = interaction.customId.match(/^fighting_knife_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingFightingKnife) return;
  const pending = game.pendingFightingKnife;
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.edit({ components: [] }).catch(() => {});
  delete game.pendingFightingKnife;
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
}

/** Concussive Bolt push target: concussive_bolt_push_{gameId}_{space} */
async function handleConcussiveBoltPush(interaction) {
  const m = interaction.customId.match(/^concussive_bolt_push_([^_]+)_([a-z0-9]+)$/);
  if (!m) return;
  const [, gameId, space] = m;
  const game = getGame(gameId);
  if (!game?.pendingConcussiveBolt) return;
  const pending = game.pendingConcussiveBolt;
  if (!canActAsPlayer(game, interaction.user.id, pending.attackerPlayerNum)) {
    await interaction.followUp({ content: 'Only the attacker can choose the Concussive Bolt push direction.', ephemeral: true }).catch(() => {});
    return;
  }
  if (!pending.adjSpaces.includes(space)) {
    await interaction.followUp({ content: 'Invalid push destination.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.edit({ components: [] }).catch(() => {});
  delete game.pendingConcussiveBolt;
  // Move the figure to the chosen space
  game.figurePositions = game.figurePositions || {};
  game.figurePositions[pending.defenderPlayerNum] = game.figurePositions[pending.defenderPlayerNum] || {};
  game.figurePositions[pending.defenderPlayerNum][pending.figureKey] = space;
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  await logGameAction(game, client, `**Concussive Bolt** — **${pending.figureLabel}** pushed from ${String(pending.currentPos).toUpperCase()} to **${space.toUpperCase()}**`, { phase: 'ROUND', icon: 'attack' });
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
}

/** Concussive Bolt skip: concussive_bolt_skip_{gameId} */
async function handleConcussiveBoltSkip(interaction) {
  const m = interaction.customId.match(/^concussive_bolt_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingConcussiveBolt) return;
  const pending = game.pendingConcussiveBolt;
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.edit({ components: [] }).catch(() => {});
  delete game.pendingConcussiveBolt;
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
}

/** Internal: show next Spread the Pain figure-pick prompt, or finish if all conditions applied. */
async function advanceSpreadThePain(game, pending) {
  const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
  if (!thread) { await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds || []), client); saveGames(); return; }
  if (pending.conditionIdx >= pending.conditions.length) {
    delete game.pendingSpreadThePain;
    await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds || []), client);
    saveGames();
    return;
  }
  const nextCond = pending.conditions[pending.conditionIdx];
  // Rebuild figure list for the next condition
  const targetPos = game.figurePositions?.[pending.defenderPlayerNum]?.[pending.combat.target?.figureKey];
  const figuresAtSpaces = [];
  if (targetPos && game.selectedMap?.id) {
    const ms = getMapSpaces(game.selectedMap.id);
    const adjacency = ms?.adjacency || {};
    const candSpaces = new Set([String(targetPos).toLowerCase(), ...(adjacency[String(targetPos).toLowerCase()] || []).map((s) => String(s).toLowerCase())]);
    for (const p of [1, 2]) {
      for (const [figKey, figPos] of Object.entries(game.figurePositions?.[p] || {})) {
        if (candSpaces.has(String(figPos).toLowerCase())) {
          const mid = findDcMessageIdForFigure(game.gameId, p, figKey);
          const dcList = p === 1 ? game.p1DcList : game.p2DcList;
          const dcIds = p === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
          const idx = (dcIds || []).indexOf(mid);
          const dcName = figKey.replace(/-\d+-\d+$/, '');
          const label = idx >= 0 && dcList?.[idx]?.displayName ? dcList[idx].displayName : dcName;
          figuresAtSpaces.push({ figureKey: figKey, playerNum: p, label: String(label).slice(0, 70) });
        }
      }
    }
  }
  if (figuresAtSpaces.length === 0) {
    delete game.pendingSpreadThePain;
    await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds || []), client);
    saveGames();
    return;
  }
  const btns = figuresAtSpaces.slice(0, 4).map((f) =>
    new ButtonBuilder()
      .setCustomId(`spread_pain_fig_${game.gameId}_${f.figureKey}`)
      .setLabel(f.label)
      .setStyle(f.playerNum === pending.defenderPlayerNum ? ButtonStyle.Danger : ButtonStyle.Secondary)
  );
  btns.push(new ButtonBuilder().setCustomId(`spread_pain_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
  await thread.send({
    content: `<@${pending.ownerId}> **Spread the Pain** — Apply **${nextCond}** to a figure at or adjacent to target (${String(targetPos).toUpperCase()}):`,
    allowedMentions: { users: [pending.ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  saveGames();
}

/** Spread the Pain figure pick: spread_pain_fig_{gameId}_{figureKey} */
async function handleSpreadThePainFigPick(interaction) {
  const m = interaction.customId.match(/^spread_pain_fig_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, figureKey] = m;
  const game = getGame(gameId);
  if (!game?.pendingSpreadThePain) return;
  const pending = game.pendingSpreadThePain;
  if (!canActAsPlayer(game, interaction.user.id, pending.attackerPlayerNum)) {
    await interaction.followUp({ content: 'Only the attacker can choose the Spread the Pain target.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.edit({ components: [] }).catch(() => {});
  const cond = pending.conditions[pending.conditionIdx];
  // Apply condition to figureKey
  game.figureConditions = game.figureConditions || {};
  const existing = game.figureConditions[figureKey] || [];
  if (!existing.includes(cond)) game.figureConditions[figureKey] = [...existing, cond];
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  await logGameAction(game, client, `**Spread the Pain** — **${dcName}** gains **${cond}**`, { phase: 'ROUND', icon: 'attack' });
  pending.conditionIdx++;
  await advanceSpreadThePain(game, pending);
}

/** Spread the Pain skip: spread_pain_skip_{gameId} */
async function handleSpreadThePainSkip(interaction) {
  const m = interaction.customId.match(/^spread_pain_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingSpreadThePain) return;
  const pending = game.pendingSpreadThePain;
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.edit({ components: [] }).catch(() => {});
  pending.conditionIdx++;
  await advanceSpreadThePain(game, pending);
}

/** Missile Salvo die choice: missile_salvo_die_{color}_{gameId}_{msgId} */
async function handleMissileSalvoDie(interaction) {
  const m = interaction.customId.match(/^missile_salvo_die_([a-z]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, color, gameId, msgId] = m;
  const game = getGame(gameId);
  if (!game?.pendingMissileSalvo?.[msgId]) return;
  const { playerNum, diceAvailable } = game.pendingMissileSalvo[msgId];
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the activating player can choose the Missile Salvo die.', ephemeral: true }).catch(() => {});
    return;
  }
  if (!diceAvailable.includes(color)) {
    await interaction.followUp({ content: `The ${color} die is no longer available for this salvo.`, ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  // Remove chosen die from available pool
  game.pendingMissileSalvo[msgId].diceAvailable = diceAvailable.filter((c) => c !== color);
  // Set up overridden ranged attack with this die + +3 accuracy
  game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
  game.pendingOverrideAttackDice[msgId] = { dice: [color], type: 'ranged', bonusAccuracy: 3 };
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  game.freeAttackBonusPending[msgId] = true;
  await interaction.message.edit({ components: [] }).catch(() => {});
  const threadId = game.pendingMissileSalvo[msgId].threadId || game.dcActionsData?.[msgId]?.threadId;
  const salvoThread = threadId ? await client.channels.fetch(threadId).catch(() => null) : null;
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
  const colorLabel = color.charAt(0).toUpperCase() + color.slice(1);
  const msg = `<@${ownerId}> **Missile Salvo** — **${colorLabel} die** selected (+3 Accuracy). Click **Attack** to target a different hostile figure. This attack costs no action.`;
  if (salvoThread) await salvoThread.send({ content: msg, allowedMentions: { users: [ownerId] } }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  saveGames();
}

/** Missile Salvo done: missile_salvo_done_{gameId}_{msgId} */
async function handleMissileSalvoDone(interaction) {
  const m = interaction.customId.match(/^missile_salvo_done_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId] = m;
  const game = getGame(gameId);
  if (!game?.pendingMissileSalvo?.[msgId]) return;
  const { playerNum } = game.pendingMissileSalvo[msgId];
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the activating player can end the salvo.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  delete game.pendingMissileSalvo[msgId];
  await interaction.message.edit({ components: [] }).catch(() => {});
  saveGames();
}

/** DCs whose image is in DC Skirmish Upgrades are figureless (incl. Squad Upgrades like [Flame Trooper]); if image is in dc-figures, it's a figure. */
function isFigurelessDc(dcName) {
  if (!dcName || typeof dcName !== 'string') return false;
  const n = dcName.trim();
  if (!n) return false;
  const path = getDcImages()[n] || getDcImages()[`[${n}]`] || (() => { const k = Object.keys(getDcImages()).find((key) => key === n || (key.startsWith('[') && key.slice(1, -1) === n)); return k ? getDcImages()[k] : ''; })();
  if (path && path.includes('dc-figures')) return false;
  if (path && path.includes('DC Skirmish Upgrades')) return true;
  if (/^\[.+\]$/.test(n)) return true;
  if (getDcImages()[`[${n}]`]) return true;
  return Object.keys(getDcImages()).some((k) => /^\[.+\]$/.test(k) && (k.slice(1, -1) === n || k === n));
}

/** True if this Skirmish Upgrade has a Deplete effect (ability text contains "Deplete"). */
function hasDepleteEffect(dcName) {
  if (!dcName || !isFigurelessDc(dcName)) return false;
  const card = getDcEffects()[dcName] || (typeof dcName === 'string' && !dcName.startsWith('[') ? getDcEffects()[`[${dcName}]`] : null);
  const text = card?.abilityText || '';
  return /deplete/i.test(text);
}

/** Description for the Companion embed under a DC (from dc-effects.companion). */
function getCompanionDescriptionForDc(dcName) {
  const card = getDcEffects()[dcName] || (typeof dcName === 'string' && !dcName.startsWith('[') ? getDcEffects()[`[${dcName}]`] : null);
  const c = card?.companion;
  if (!c) return '*None*';
  if (typeof c === 'string' && c.trim()) return c.trim();
  return 'Companion (see ability text)';
}

function getDcStats(dcName) {
  const effects = getDcEffects();
  const lower = dcName?.toLowerCase?.() || '';
  const ciKey = Object.keys(effects).find((k) => k.toLowerCase() === lower);
  const eff =
    effects[dcName] ||
    (ciKey ? effects[ciKey] : null) ||
    (typeof dcName === 'string' && !dcName.startsWith('[') ? effects[`[${dcName}]`] : null);
  if (eff) {
    // Auto-generate specials labels from specialAbilityIds when specials array is absent.
    // Skip passive-auto/passive-reactive categories and IDs that need no player-facing button.
    const PASSIVE_ONLY_IDS = new Set(['battle_meditation','cunning_han','cunning_jyn','cunning_nexu_elite','cunning_nexu_reg',
      'distracting_han','distracting_c3po','hunker_down','full_of_rage','fury_wookiee_elite','fury_wookiee_reg',
      'relentless_trandoshan_elite','relentless_trandoshan_reg','relentless_ig88','fifth_brother_relentless',
      'lasat_honor_guard','shock_and_awe','flawless_execution','expertise','regenerate_bossk',
      'sidestep_nexu_elite','sidestep_nexu_reg','ee3_carbine']);
    let specials = eff.specials;
    if (!specials && eff.specialAbilityIds?.length) {
      const lib = getAbilityLibrary() || {};
      specials = eff.specialAbilityIds
        .filter((id) => !PASSIVE_ONLY_IDS.has(id))
        .map((id) => {
          const entry = lib.abilities?.[id];
          return entry?.label || id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        });
    }
    return {
      health: eff.health ?? null,
      figures: isFigurelessDc(dcName) ? 0 : (eff.figures ?? 1),
      speed: eff.speed ?? null,
      cost: eff.cost ?? null,
      attack: eff.attack ?? null,
      defense: eff.defense ?? null,
      specials: specials || [],
      specialCosts: eff.specialCosts || [],
      passives: eff.passives || [],
      abilityText: eff.abilityText || '',
    };
  }
  return { health: null, figures: isFigurelessDc(dcName) ? 0 : 1, specials: [], specialCosts: [], passives: [], abilityText: '' };
}

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
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
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
    const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const initZone = getInitiativePlayerZoneLabel(game);
    await msg.edit({
      content: `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Both players have used all activations and actions. Both players: click **End R${round} Activation Phase** when done with any end-of-activation effects.`,
      embeds: [roundEmbed],
      components: [endBtn],
      allowedMentions: { users: [game.initiativePlayerId] },
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      await msg.edit(editPayload).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch (err) {
      console.error('Failed to update DC actions message:', err);
    }
  }
  // P4/P5: Refresh the DC embed in the play area with live action count + power tokens
  if (meta && game) {
    try {
      const _chId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
      const _ch = await client.channels.fetch(_chId);
      const _dcMsg = await _ch.messages.fetch(msgId);
      const _hs = dcHealthState.get(msgId) || [];
      const { embed: _emb, files: _files } = await buildDcEmbedAndFiles(
        meta.dcName, true, displayName, _hs,
        getConditionsForDcMessage(game, meta),
        getDcUpgradeAttachments(game, msgId),
        getTokensForDcMessage(game, meta),
        data,
      );
      const _comps = getDcPlayAreaComponents(msgId, true, game, meta.dcName);
      await _dcMsg.edit({ embeds: [_emb], files: _files, components: _comps }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch (_err) {
      console.error('Failed to update DC embed with action count/tokens:', _err);
    }
  }

  if (data?.remaining === 0 && meta) {
    game.dcFinishedPinged = game.dcFinishedPinged || {};
    game.pendingEndTurn = game.pendingEndTurn || {};
    if (!game.dcFinishedPinged[msgId] && !game.pendingEndTurn[msgId]) {
      const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
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
  return getDcPlayAreaComponentsFromDiscord(msgId, exhausted, game, dcName, { isDepletedRemovedFromGame, hasDepleteEffect });
}

/** True if all figures in this deployment group are defeated (or never deployed). */
function isGroupDefeated(game, playerNum, dcIndex) {
  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
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

async function buildDcEmbedAndFiles(dcName, exhausted, displayName, healthState, conditionsByFigure, dcAttachments = [], tokensByFigure = null, actionsData = null) {
  const status = exhausted ? 'EXHAUSTED' : 'READIED';
  const color = exhausted ? 0xed4245 : 0x57f287; // red : green
  const figureless = isFigurelessDc(dcName);
  const dgIndex = displayName.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  const variant = dcName?.includes('(Elite)') ? 'Elite' : dcName?.includes('(Regular)') ? 'Regular' : null;
  const healthSection = figureless ? null : formatHealthSection(Number(dgIndex), healthState, conditionsByFigure, tokensByFigure);
  const actionsLine = (actionsData != null && exhausted) ? getActionsCounterContent(actionsData.remaining, actionsData.total) : null;
  const lines = figureless
    ? [actionsLine, variant ? `**Variant:** ${variant}` : null].filter(Boolean)
    : [
        actionsLine,
        `**Figures:** ${figures}`,
        variant ? `**Variant:** ${variant}` : null,
        '',
        healthSection,
      ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setTitle(`${status} — ${displayName}`)
    .setDescription(lines.length ? lines.join('\n') : '*Upgrade — no figure*')
    .setColor(color);

  let files = [];
  // Check if any attached skirmish upgrade overrides the card image
  const baseDcForOverride = (dcName || '').replace(/\s*\[.*\]\s*$/, '').trim();
  const upgradeMap = UPGRADE_IMAGE_OVERRIDES[baseDcForOverride];
  let imagePath = getDcImagePath(dcName?.trim());
  if (upgradeMap && dcAttachments?.length) {
    for (const attachName of dcAttachments) {
      if (upgradeMap[attachName]) { imagePath = upgradeMap[attachName]; break; }
    }
  }
  if (imagePath) {
    const fullPath = join(rootDir, imagePath);
    if (existsSync(fullPath)) {
      const ext = imagePath.split('.').pop() || 'png';
      const attachName = `dc-card.${ext}`;
      files.push(new AttachmentBuilder(fullPath, { name: attachName }));
      embed.setImage(`attachment://${attachName}`);
    }
  }
  return { embed, files };
}

/** Build discard pile display for thread (embeds with card images, like hand view). Returns array of { embeds, files } for chunked sends. */
function buildDiscardPileDisplayPayload(discard) {
  const cardData = [];
  for (let i = 0; i < discard.length; i++) {
    const card = discard[i];
    const path = getCommandCardImagePath(card);
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `cc-discard-${i}-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(card || `Card ${i + 1}`)
      .setColor(0x2f3136);
    let file = null;
    if (path && existsSync(path)) {
      file = new AttachmentBuilder(path, { name: fileName });
      embed.setThumbnail(`attachment://${fileName}`);
    }
    cardData.push({ embed, file });
  }
  const header = new EmbedBuilder()
    .setTitle('Command Cards in Discard Pile')
    .setDescription(`**${discard.length}** cards discarded`)
    .setColor(0x2f3136);
  const chunks = [];
  let embeds = [header];
  let files = [];
  for (let i = 0; i < cardData.length; i++) {
    if (embeds.length >= EMBEDS_PER_MESSAGE) {
      chunks.push({ embeds, files: files.length > 0 ? files : undefined });
      embeds = [];
      files = [];
    }
    embeds.push(cardData[i].embed);
    if (cardData[i].file) files.push(cardData[i].file);
  }
  if (embeds.length > 0) chunks.push({ embeds, files: files.length > 0 ? files : undefined });
  return chunks;
}

/** Update both Hand channel messages (for window buttons). Call when entering/exiting Start or End of Round window. */
async function updateHandChannelMessages(game, client) {
  for (const pn of [1, 2]) {
    const hand = pn === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
    const deck = pn === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
    const handId = pn === 1 ? game.p1HandId : game.p2HandId;
    if (!handId) continue;
    try {
      const handCh = await client.channels.fetch(handId);
      const msgs = await handCh.messages.fetch({ limit: 20 });
      const handMsg = msgs.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      if (handMsg) {
        const payload = buildHandDisplayPayload(hand, deck, game.gameId, game, pn);
        await handMsg.edit({ content: payload.content, embeds: payload.embeds, files: payload.files || [], components: payload.components }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
    } catch (err) {
      console.error('Failed to update hand channel message:', err);
    }
  }
}

/** Call after changing player1CcHand/player2CcHand to refresh the Play Area hand visual. */
async function updateHandVisualMessage(game, playerNum, client) {
  const msgId = playerNum === 1 ? game.p1HandVisualMessageId : game.p2HandVisualMessageId;
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  if (msgId == null) return;
  try {
    const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
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
  const discard = playerNum === 1 ? (game.player1CcDiscard || []) : (game.player2CcDiscard || []);
  const threadId = playerNum === 1 ? game.p1DiscardThreadId : game.p2DiscardThreadId;
  const hasOpenThread = !!threadId;
  try {
    const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
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
    const msgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
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
        await msg.edit({ components }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    dcDepletedState.set(msg.id, false);
    dcHealthState.set(msg.id, healthState);
    const p1Components = getDcPlayAreaComponents(msg.id, false, game, dcName);
    await msg.edit({ components: p1Components });
    game.p1DcMessageIds.push(msg.id);
    // Attachments: only create when DC has attachments; create on demand in updateAttachmentMessageForDc
    game.p1DcAttachmentMessageIds.push(null);
    const p1CompanionDesc = getCompanionDescriptionForDc(dcName);
    if (p1CompanionDesc !== '*None*') {
      const companionMsg = await p1PlayArea.send({
        embeds: [new EmbedBuilder().setTitle('Companion').setDescription(p1CompanionDesc).setColor(0x2f3136)],
      });
      game.p1DcCompanionMessageIds.push(companionMsg.id);
    } else {
      game.p1DcCompanionMessageIds.push(null);
    }
  }
  for (const { dcName, displayName, healthState } of p2Dcs) {
    const { embed, files } = await buildDcEmbedAndFiles(dcName, false, displayName, healthState);
    const msg = await p2PlayArea.send({ embeds: [embed], files });
    dcMessageMeta.set(msg.id, { gameId, playerNum: 2, dcName, displayName });
    dcExhaustedState.set(msg.id, false);
    dcDepletedState.set(msg.id, false);
    dcHealthState.set(msg.id, healthState);
    const p2Components = getDcPlayAreaComponents(msg.id, false, game, dcName);
    await msg.edit({ components: p2Components });
    game.p2DcMessageIds.push(msg.id);
    // Attachments: only create when DC has attachments; create on demand in updateAttachmentMessageForDc
    game.p2DcAttachmentMessageIds.push(null);
    const p2CompanionDesc = getCompanionDescriptionForDc(dcName);
    if (p2CompanionDesc !== '*None*') {
      const companionMsg = await p2PlayArea.send({
        embeds: [new EmbedBuilder().setTitle('Companion').setDescription(p2CompanionDesc).setColor(0x2f3136)],
      });
      game.p2DcCompanionMessageIds.push(companionMsg.id);
    } else {
      game.p2DcCompanionMessageIds.push(null);
    }
  }

}

async function applySquadSubmission(game, isP1, squad, client) {
  if (isP1) game.player1Squad = squad;
  else game.player2Squad = squad;
  const playerId = isP1 ? game.player1Id : game.player2Id;
  const playerNum = isP1 ? 1 : 2;
  await logGameAction(game, client, `<@${playerId}> submitted squad **${squad.name || 'Unnamed'}** (${squad.dcCount ?? 0} DCs, ${squad.ccCount ?? 0} CCs)`, { allowedMentions: { users: [playerId] }, phase: 'SETUP', icon: 'squad' });
  const handChannelId = isP1 ? game.p1HandId : game.p2HandId;
  const handChannel = await client.channels.fetch(handChannelId);
  const handMessages = await handChannel.messages.fetch({ limit: 10 });
  const botMsg = handMessages.find((m) => m.author.bot && m.components.length > 0);
  if (botMsg) {
    await botMsg.edit({
      embeds: [getHandTooltipEmbed(game, isP1 ? 1 : 2, squad)],
      components: [],
    });
  }
  const generalChannel = await client.channels.fetch(game.generalId);
  const bothReady = game.player1Squad && game.player2Squad && !game.bothReadyPosted;
  if (bothReady) {
    game.bothReadyPosted = true;
    try {
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
      // Map Updates channel created AFTER play areas so it appears last
      if (!game.boardId) {
        try {
          const guild = generalChannel.guild;
          const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
          const prefix = `IA${game.gameId}`;
          const boardChannel = await createBoardChannel(guild, gameCategory, prefix, game.player1Id, game.player2Id);
          game.boardId = boardChannel.id;
          if (game.selectedMap) {
            const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
            await boardChannel.send(payload).catch((err) => { console.error('[discord]', err?.message ?? err); });
          }
        } catch (err) {
          console.error('Failed to create Map Updates channel:', err);
        }
      }
      await populatePlayAreas(game, client);
    } catch (err) {
      console.error('Failed to create/populate Play Areas:', err);
    }
    const bothReadyMsg = await generalChannel.send({
      content: `<@${game.player1Id}> <@${game.player2Id}> — Both squads are ready! Determine initiative below.`,
      allowedMentions: { users: [...new Set([game.player1Id, game.player2Id])] },
      embeds: [
        new EmbedBuilder()
          .setTitle('Both Squads Ready')
          .setDescription(
            `**Player 1:** ${game.player1Squad.name || 'Unnamed'} (${game.player1Squad.dcCount} DCs, ${game.player1Squad.ccCount} CCs)\n` +
              `**Player 2:** ${game.player2Squad.name || 'Unnamed'} (${game.player2Squad.dcCount} DCs, ${game.player2Squad.ccCount} CCs)\n\n` +
              'Play Area channels have been populated with one thread per Deployment Card. Next: Determine Initiative.'
          )
          .setColor(0x57f287),
      ],
      components: [getDetermineInitiativeButtons(game)],
    });
    game.bothReadyMessageId = bothReadyMsg.id;
  }
  saveGames();
}

async function setupServer(guild) {
  const categories = {};
  for (const [key, name] of Object.entries(CATEGORIES)) {
    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === name
    );
    categories[key] =
      existing ||
      (await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
      }));
  }

  let forumChannel = null;
  for (const [key, config] of Object.entries(CHANNELS)) {
    const parent = categories[config.parent];
    const existing = guild.channels.cache.find(
      (c) => c.parentId === parent.id && c.name === config.name
    );
    if (!existing) {
      const created = await guild.channels.create({
        name: config.name,
        type: config.type,
        parent: parent.id,
        ...(config.type === ChannelType.GuildForum && config.name === 'new-games' && { availableTags: GAME_TAGS }),
      });
      if (config.type === ChannelType.GuildForum && config.name === 'new-games') forumChannel = created;
    } else if (config.type === ChannelType.GuildForum && config.name === 'new-games') {
      forumChannel = existing;
    }
  }

  if (forumChannel) {
    await forumChannel.setAvailableTags(GAME_TAGS);
  }

  return 'Server structure created: General, LFG (with #lfg chat + #new-games Forum with tags: Slow, Fast, Hyperspeed, Ranked), Games, Archived Games, Bot/Admin.';
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
      await message.reply('This command must be used in a server channel.').catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const userId = message.author.id;
    const mentionedP2 = message.mentions.users.first();
    const player2Id = mentionedP2 && mentionedP2.id !== userId ? mentionedP2.id : undefined;
    const p2IsBot = !player2Id;
    const scenarioId = getRandomTestreadyScenario(p2IsBot);
    if (!scenarioId) {
      const hint = p2IsBot ? ' Some scenarios require a real P2 — try `testready @player2`.' : '';
      await message.reply(`No testready scenarios available.${hint}`).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      await creatingMsg.edit(`Failed to create test game: ${err.message}`).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
    return;
  }

  const isTestGameCmd = content.startsWith('testgame') && channelNameLc === 'lfg';
  if (isTestGameCmd) {
    if (!message.guild) {
      await message.reply('This command must be used in a server channel.').catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      await creatingMsg.edit(`Failed to create test game: ${err.message}`).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      dcDepletedState.clear();
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
      .setColor(0x2f3136);
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
        await message.reply('This game has ended. VP cannot be changed.').catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
      const authorId = message.author.id;
      const isP1 = authorId === game.player1Id;
      const isP2 = authorId === game.player2Id;
      if (!isP1 && !isP2) {
        await message.reply('Only players in this game can use /editvp.').catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      await message.reply(`✓ **${side}** VP adjusted ${actualDelta >= 0 ? '+' : ''}${actualDelta}. Total is now **${newTotal}** VP.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
      // Update scorecard embed in Map Updates channel if present
      if (game.boardId && game.selectedMap) {
        try {
          const boardChannel = await message.client.channels.fetch(game.boardId);
          const messages = await boardChannel.messages.fetch({ limit: 15 });
          const withScorecard = messages.find((m) => m.embeds?.[0]?.title === 'Scorecard');
          if (withScorecard) {
            const embed = buildScorecardEmbed(game);
            await withScorecard.edit({ embeds: [embed] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    const channelId = message.channel.id;
    for (const [gameId, game] of getGamesMap()) {
      const isP1 = game.p1HandId === channelId;
      const isP2 = game.p2HandId === channelId;
      if (!isP1 && !isP2) continue;
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
        const validation = validateDeckLegal(squad);
        if (!validation.legal) {
          await sendDeckIllegalAlert(game, isP1, squad, validation, message.client);
          await message.reply(`Your deck did not pass validation. Check the message above for details and choose **PLAY IT ANYWAY** or **REDO**.`);
          return;
        }
        await applySquadSubmission(game, isP1, squad, message.client);
        await message.reply(`✓ Squad **${squad.name}** submitted from .vsav (${squad.dcCount} DCs, ${squad.ccCount} CCs)`);
      } catch (err) {
        console.error('vsav parse error:', err);
        await logGameErrorToBotLogs(message.client, message.guild, null, err, 'messageCreate_vsav');
        await message.reply(`Failed to parse .vsav: ${err.message}`);
      }
      return;
    }
  }

  // Pasted IACP list (from Share button) in Player Hand channel
  const channelId = message.channel.id;
  for (const [gameId, game] of getGamesMap()) {
    const isP1 = game.p1HandId === channelId;
    const isP2 = game.p2HandId === channelId;
    if (!isP1 && !isP2) continue;
    const userId = isP1 ? game.player1Id : game.player2Id;
    if (message.author.id !== userId) continue;
    if (!game.mapSelected) continue;
    const parsed = parseIacpListPaste(message.content || '');
    if (parsed && (parsed.dcList.length > 0 || parsed.ccList.length > 0)) {
      const squad = {
        name: parsed.name || 'From pasted list',
        dcList: parsed.dcList,
        ccList: parsed.ccList,
        dcCount: parsed.dcList.length,
        ccCount: parsed.ccList.length,
      };
      const validation = validateDeckLegal(squad);
      if (!validation.legal) {
        await sendDeckIllegalAlert(game, isP1, squad, validation, message.client);
        await message.reply(`Your deck did not pass validation. Check the message above for details and choose **PLAY IT ANYWAY** or **REDO**.`);
        return;
      }
      await applySquadSubmission(game, isP1, squad, message.client);
      await message.reply(`✓ Squad **${squad.name}** submitted from pasted list (${squad.dcCount} DCs, ${squad.ccCount} CCs)`);
      return;
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
    const msgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
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
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
      await interaction.reply({
        content: '**Bot Stuff** — Choose an action:',
        components: [getBotmenuButtons(gameByChannel.gameId)],
        ephemeral: false,
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    if (cmd === 'power-token') {
      const channelId = interaction.channelId;
      let game = null;
      for (const [, g] of getGamesMap()) {
        if (g.generalId === channelId || g.boardId === channelId || g.chatId === channelId) {
          game = g;
          break;
        }
      }
      if (!game) {
        await interaction.reply({
          content: 'Use /power-token in the **Game Log** or **Board** channel of an active game.',
          ephemeral: true,
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
          }).catch((err) => { console.error('[discord]', err?.message ?? err); });
          return;
        }
        game.figurePowerTokens[fk] = [...game.figurePowerTokens[fk], type];
        saveGames();
        await interaction.reply({
          content: `Added **${type}** Power Token to **${fk}**.`,
          ephemeral: false,
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      } else {
        const idx = interaction.options.getInteger('index');
        const arr = game.figurePowerTokens[fk];
        if (!arr || arr.length < idx) {
          await interaction.reply({
            content: `${fk} does not have a token at index ${idx}. Current: ${(arr || []).join(', ') || 'none'}`,
            ephemeral: true,
          }).catch((err) => { console.error('[discord]', err?.message ?? err); });
          return;
        }
        const removed = arr[idx - 1];
        game.figurePowerTokens[fk] = arr.filter((_, i) => i !== idx - 1);
        if (game.figurePowerTokens[fk].length === 0) delete game.figurePowerTokens[fk];
        saveGames();
        await interaction.reply({
          content: `Removed **${removed}** Power Token from **${fk}**.`,
          ephemeral: false,
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      const channelId = interaction.channelId;
      let game = null;
      for (const [, g] of getGamesMap()) {
        if (g.generalId === channelId || g.boardId === channelId || g.chatId === channelId) { game = g; break; }
      }
      if (!game) {
        await interaction.reply({ content: 'Use /move-figure in the **Game Log** or **Board** channel of an active game.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
        await interaction.reply({ content: `Figure **${figureKey}** not found on map. On-map keys: ${allKeys.slice(0, 10).join(', ')}${allKeys.length > 10 ? '...' : ''}`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      await interaction.reply({ content: `Moved **${fk}** to **${coordRaw.toUpperCase()}**.`, ephemeral: false }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
      if (!isDbConfigured()) {
        await interaction.reply({
          content: 'Stats require a database (DATABASE_URL). No data available.',
          ephemeral: true,
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
      await interaction.deferReply({ ephemeral: false }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      try {
        if (cmd === 'statcheck') {
          const targetUser = interaction.options.getUser('player');
          if (targetUser) {
            const s = await getStatsSummaryForPlayer(targetUser.id);
            await interaction.editReply({
              content: `**Stats for ${targetUser.username}**\nGames: **${s.games}** | Wins: **${s.wins}** | Losses: **${s.losses}** | Win rate: **${s.winRate}%**`,
            }).catch((err) => { console.error('[discord]', err?.message ?? err); });
          } else {
            const { totalGames } = await getStatsSummary();
            await interaction.editReply({
              content: `**Completed games:** ${totalGames}`,
            }).catch((err) => { console.error('[discord]', err?.message ?? err); });
          }
        } else if (cmd === 'affiliationwinrateglobal') {
          const rows = await getAffiliationWinRates();
          const lines = rows.length
            ? rows.map((r) => `${r.affiliation}: **${r.wins}** / **${r.games}** (${r.winRate}% win rate)`).join('\n')
            : 'No completed games with affiliation data yet.';
          await interaction.editReply({ content: `**Win rate by affiliation (global)**\n${lines}` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        } else if (cmd === 'affiliationwinratepersonal') {
          const rows = await getAffiliationWinRatesPersonal(interaction.user.id);
          const lines = rows.length
            ? rows.map((r) => `${r.affiliation}: **${r.wins}** / **${r.games}** (${r.winRate}% win rate)`).join('\n')
            : 'No completed games with affiliation data for you yet.';
          await interaction.editReply({ content: `**Your win rate by affiliation**\n${lines}` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        } else if (cmd === 'affiliationpickrateglobal') {
          const rows = await getAffiliationPickRates();
          const lines = rows.length
            ? rows.map((r) => `${r.affiliation}: **${r.picks}** picks / **${r.totalArmies}** armies (${r.pickRate}%)`).join('\n')
            : 'No completed games with affiliation data yet.';
          await interaction.editReply({ content: `**Pick rate by affiliation (global)**\n${lines}` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        } else if (cmd === 'affiliationpickratepersonal') {
          const rows = await getAffiliationPickRatesPersonal(interaction.user.id);
          const lines = rows.length
            ? rows.map((r) => `${r.affiliation}: **${r.picks}** picks / **${r.totalArmies}** armies (${r.pickRate}%)`).join('\n')
            : 'No completed games with affiliation data for you yet.';
          await interaction.editReply({ content: `**Your pick rate by affiliation**\n${lines}` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        } else if (cmd === 'dcwinrateglobaltopten') {
          const limit = interaction.options.getInteger('limit') ?? 20;
          const rows = await getDcWinRates(limit);
          const lines = rows.length
            ? rows.map((r) => `${r.dcName}: **${r.wins}** / **${r.games}** (${r.winRate}%)`).join('\n')
            : 'No completed games with army data yet.';
          await interaction.editReply({
            content: `**Win rate by Deployment Card** (top ${limit} by games played, global)\n${lines}`,
          }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        } else if (cmd === 'dcwinratepersonaltopten') {
          const limit = interaction.options.getInteger('limit') ?? 20;
          const rows = await getDcWinRatesPersonal(interaction.user.id, limit);
          const lines = rows.length
            ? rows.map((r) => `${r.dcName}: **${r.wins}** / **${r.games}** (${r.winRate}%)`).join('\n')
            : 'No completed games with army data for you yet.';
          await interaction.editReply({
            content: `**Your win rate by Deployment Card** (top ${limit} by games played)\n${lines}`,
          }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        } else if (cmd === 'leaderboard') {
          const limit = interaction.options.getInteger('limit') ?? 5;
          const rows = await getLeaderboard(limit);
          const lines = rows.length
            ? rows.map((r, i) => `**${i + 1}.** <@${r.playerId}> — **${r.winRate}%** (${r.wins}W / ${r.losses}L / ${r.draws}D over ${r.games} games)`).join('\n')
            : 'No player has completed their 5 preliminary games yet.';
          await interaction.editReply({
            content: `**Leaderboard** (top ${limit} by win rate, min. 5 games)\n${lines}`,
            allowedMentions: { users: [] },
          }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        }
      } catch (err) {
        console.error(`Stats command /${cmd} failed:`, err);
        await interaction.editReply({
          content: `Something went wrong: ${err.message}`,
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
      return;
    }
    if (cmd === 'achievements') {
      if (!isDbConfigured()) {
        await interaction.reply({ content: 'Achievements require a database (DATABASE_URL). No data available.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
      await interaction.deferReply({ ephemeral: false }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      try {
        const targetUser = interaction.options.getUser('player') || interaction.user;
        const earned = await getEarnedAchievements(targetUser.id);
        const embed = new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle(`${targetUser.username}'s Achievements`)
          .setDescription(
            earned.length
              ? earned.map((a) => `${a.icon || '🏆'} **${a.name}** — ${a.description} *(${new Date(a.earned_at).toLocaleDateString()})*`).join('\n')
              : 'No achievements yet — play some games!'
          );
        await interaction.editReply({ embeds: [embed], allowedMentions: { users: [] } }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      } catch (err) {
        console.error('[Achievements] /achievements command failed:', err.message);
        await interaction.editReply({ content: `Something went wrong: ${err.message}` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      if (!game2) { await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      const targetRaw = interaction.fields.getTextInputValue('target_coord').trim().toLowerCase();
      const curCoord2 = String(game2.cratePositions?.[origCoord2] || origCoord2).toLowerCase();
      const dist = getRange(curCoord2, targetRaw);
      if (dist === 0) { await interaction.reply({ content: `Crate stays at ${curCoord2.toUpperCase()} — no change.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      if (dist > 3) { await interaction.reply({ content: `❌ ${targetRaw.toUpperCase()} is ${dist} spaces from ${curCoord2.toUpperCase()} (max 3). Try again.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      await interaction.deferReply({ ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      game2.cratePositions = game2.cratePositions || {};
      game2.cratePositions[origCoord2] = targetRaw;
      const ctrl = getSpaceController(game2, 'devaron-garrison', curCoord2);
      const pid2 = ctrl ? (ctrl === 1 ? game2.player1Id : game2.player2Id) : interaction.user.id;
      await logGameAction(game2, client, `📦 <@${pid2}> pushed crate from **${curCoord2.toUpperCase()}** → **${targetRaw.toUpperCase()}** (${dist} space${dist !== 1 ? 's' : ''}).`, { allowedMentions: { users: [pid2] }, phase: 'ROUND', icon: 'round' });
      await interaction.editReply({ content: `Crate pushed: ${curCoord2.toUpperCase()} → ${targetRaw.toUpperCase()} ✓` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      saveGames();
    } else if (modalKey === 'krykna_push_modal_') {
      // customId: krykna_push_modal_{gameId}_krykna-{N}
      const rest2 = interaction.customId.replace('krykna_push_modal_', '');
      const kryknaIdx2 = rest2.indexOf('krykna-');
      if (kryknaIdx2 < 0) return;
      const gameId2 = rest2.substring(0, kryknaIdx2 - 1);
      const kryknaId2 = rest2.substring(kryknaIdx2);
      const game2 = getGame(gameId2);
      if (!game2) { await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      const krykna2 = (game2.npcKrykna || []).find((k) => k.id === kryknaId2);
      if (!krykna2) { await interaction.reply({ content: 'Krykna not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      const targetRaw2 = interaction.fields.getTextInputValue('target_coord').trim().toLowerCase();
      const dist2 = getRange(String(krykna2.coord).toLowerCase(), targetRaw2);
      if (dist2 === 0) { await interaction.reply({ content: `Krykna stays at ${String(krykna2.coord).toUpperCase()} — no change.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      if (dist2 === null || dist2 > 3) { await interaction.reply({ content: `❌ ${targetRaw2.toUpperCase()} is ${dist2 ?? '?'} spaces away (max 3). Try again.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      await interaction.deferReply({ ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      const oldCoord2 = String(krykna2.coord).toUpperCase();
      krykna2.coord = targetRaw2;
      game2.kryknaPushedIds = game2.kryknaPushedIds || [];
      game2.kryknaPushedIds.push(kryknaId2);
      game2.pendingKryknaPushQueue.shift();
      const pnActor2 = game2.player1Id === interaction.user.id ? 1 : 2;
      await logGameAction(game2, client, `🕷️ **Krykna Push:** P${pnActor2} pushed ${kryknaId2} from **${oldCoord2}** → **${targetRaw2.toUpperCase()}** (${dist2} space${dist2 !== 1 ? 's' : ''}).`, { phase: 'ROUND', icon: 'move' });
      await interaction.editReply({ content: `${kryknaId2} pushed: ${oldCoord2} → ${targetRaw2.toUpperCase()} ✓` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const selectKey = getHandlerKey(interaction.customId, 'select');
    if (!selectKey) return;
    if (selectKey === 'dc_fig_select_') {
      const msgId = interaction.customId.replace('dc_fig_select_', '');
      const selectedFigure = parseInt(interaction.values[0], 10);
      const meta = dcMessageMeta.get(msgId);
      if (!meta) { await interaction.reply({ content: 'DC not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      const game = getGame(meta.gameId);
      if (!game) { await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      if (!canActAsPlayer(game, interaction.user.id, meta.playerNum)) { await interaction.reply({ content: 'Only the owner can pick a figure.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    if (selectKey === 'map_selection_menu_' || selectKey === 'map_selection_draw_' || selectKey === 'map_selection_pick_') {
      const setupChoiceContext = {
        getGame,
        getPlayReadyMaps,
        getTournamentRotation,
        getMissionCardsData,
        getMapRegistry,
        getMissionSelectDrawMenu,
        getMissionSelectionPickMenu,
        postMissionCardAfterMapSelection,
        postPinnedMissionCardFromGameState,
        buildBoardMapPayload,
        logGameAction,
        getGeneralSetupButtons,
        createPlayAreaChannels,
        createBoardChannel,
        createHandThreads,
        getHandTooltipEmbed,
        getHandSquadButtons,
        client,
        saveGames,
      };
      if (selectKey === 'map_selection_menu_') await handleMapSelectionChoice(interaction, setupChoiceContext);
      else if (selectKey === 'map_selection_draw_') await handleMapSelectionDraw(interaction, setupChoiceContext);
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
      getMapAttachmentForSpaces,
      buildBoardMapPayload,
    };
    if (selectKey === 'cc_attach_to_') await handleCcAttachTo(interaction, ccHandSelectContext);
    else if (selectKey === 'cc_play_select_') await handleCcPlaySelect(interaction, ccHandSelectContext);
    else if (selectKey === 'cc_discard_select_') await handleCcDiscardSelect(interaction, ccHandSelectContext);
    return;
  }

  if (!interaction.isButton()) return;
  const buttonKey = getHandlerKey(interaction.customId, 'button');
  if (!buttonKey) return;
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });

    if (buttonKey === 'deck_illegal_play_' || buttonKey === 'deck_illegal_redo_' || buttonKey === 'cc_shuffle_draw_' || buttonKey === 'cc_play_' || buttonKey === 'cc_confirm_play_' || buttonKey === 'cc_cancel_play_' || buttonKey === 'cc_draw_' || buttonKey === 'cc_search_discard_' || buttonKey === 'cc_close_discard_' || buttonKey === 'cc_discard_' || buttonKey === 'cc_choice_' || buttonKey === 'cc_space_' || buttonKey === 'squad_select_' || buttonKey === 'illegal_cc_ignore_' || buttonKey === 'illegal_cc_unplay_' || buttonKey === 'negation_play_' || buttonKey === 'negation_let_resolve_' || buttonKey === 'celebration_play_' || buttonKey === 'celebration_pass_') {
    const ccHandButtonContext = {
      getGame,
      dcMessageMeta,
      dcHealthState,
      dcExhaustedState,
      saveGames,
      pushUndo,
      client,
      pendingIllegalSquad,
      PENDING_ILLEGAL_TTL_MS,
      validateDeckLegal,
      sendDeckIllegalAlert,
      applySquadSubmission,
      getHandTooltipEmbed,
      getHandSquadButtons,
      shuffleArray,
      buildHandDisplayPayload,
      updateHandVisualMessage,
      updatePlayAreaDcButtons,
      sendRoundActivationPhaseMessage,
      logGameAction,
      buildDiscardPileDisplayPayload,
      updateDiscardPileMessage,
      getCcEffect,
      isCcAttachment,
      isCcPlayableNow,
      isCcPlayLegalByRestriction,
      getIllegalCcPlayButtons,
      getNegationResponseButtons,
      updateAttachmentMessageForDc,
      getPlayableCcFromHand,
      resolveAbility,
      updateDcActionsMessage,
      buildDcEmbedAndFiles,
      getConditionsForDcMessage,
      getDcPlayAreaComponents,
      buildBoardMapPayload,
      getBoardStateForMovement,
      getSpaceChoiceRows,
      getMapAttachmentForSpaces,
      ensureMovementBankMessage,
      updateMovementBankMessage,
      getConditionCardPath,
    };
    if (buttonKey === 'deck_illegal_play_') await handleDeckIllegalPlay(interaction, ccHandButtonContext);
    else if (buttonKey === 'deck_illegal_redo_') await handleDeckIllegalRedo(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_shuffle_draw_') await handleCcShuffleDraw(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_play_') await handleCcPlay(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_confirm_play_') await handleCcConfirmPlay(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_cancel_play_') await handleCcCancelPlay(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_draw_') await handleCcDraw(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_search_discard_') await handleCcSearchDiscard(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_close_discard_') await handleCcCloseDiscard(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_discard_') await handleCcDiscard(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_choice_') await handleCcChoice(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_space_') await handleCcSpacePick(interaction, ccHandButtonContext);
    else if (buttonKey === 'squad_select_') await handleSquadSelect(interaction, ccHandButtonContext);
    else if (buttonKey === 'illegal_cc_ignore_') await handleIllegalCcIgnore(interaction, ccHandButtonContext);
    else if (buttonKey === 'illegal_cc_unplay_') await handleIllegalCcUnplay(interaction, ccHandButtonContext);
    else if (buttonKey === 'negation_play_') await handleNegationPlay(interaction, ccHandButtonContext);
    else if (buttonKey === 'negation_let_resolve_') await handleNegationLetResolve(interaction, ccHandButtonContext);
    else if (buttonKey === 'celebration_play_') await handleCelebrationPlay(interaction, ccHandButtonContext);
    else if (buttonKey === 'celebration_pass_') await handleCelebrationPass(interaction, ccHandButtonContext);
    return;
  }

  if (buttonKey === 'dc_activate_' || buttonKey === 'dc_unactivate_' || buttonKey === 'dc_toggle_' || buttonKey === 'dc_deplete_' || buttonKey === 'dc_cc_special_' || buttonKey === 'dc_cc_eoa_' || buttonKey === 'dc_cc_double_' || buttonKey === 'dc_move_' || buttonKey === 'dc_attack_' || buttonKey === 'dc_interact_' || buttonKey === 'dc_special_' || buttonKey === 'pounce_space_' || buttonKey === 'dc_ability_choice_' || buttonKey === 'ee3_pick_die_' || buttonKey === 'false_orders_action_' || buttonKey === 'false_orders_space_') {
    const dcPlayAreaContext = {
      getGame,
      replyIfGameEnded,
      saveGames,
      pushUndo,
      client,
      dcMessageMeta,
      dcExhaustedState,
      dcDepletedState,
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
      logGameErrorToBotLogs,
      extractGameIdFromInteraction,
      logGameAction,
      isDepletedRemovedFromGame,
      getPlayableCcSpecialsForDc,
      getPlayableCcEndOfActivationForDc,
      getPlayableCcDoubleActionsForDc,
      getCcEffect,
      isCcAttachment,
      updateAttachmentMessageForDc,
      buildHandDisplayPayload,
      updateHandVisualMessage,
      updateDiscardPileMessage,
      updateDcActionsMessage,
      getDcStats,
      getDcEffects,
      getMapSpaces,
      getFigureSize,
      getFootprintCells,
      getRange,
      hasLineOfSight,
      isDcUnique,
      getCelebrationButtons,
      applyDamageAndFinishCombat,
      getEffectiveSpeed,
      ensureMovementBankMessage,
      getBoardStateForMovement,
      getMovementProfile,
      computeMovementCache,
      buildLetterRows,
      getMovementMinimapAttachment,
      clearMoveGridMessages,
      getLegalInteractOptions,
      FIGURE_LETTERS,
      resolveAbility,
      getNegationResponseButtons,
      sendBleedingPrompt,
      updateMovementBankMessage,
      getCommandCardImagePath,
      getConditionCardPath,
      buildBoardMapPayload,
      findDcMessageIdForFigure,
      isGroupDefeated,
      checkWinConditions,
      getSpaceChoiceRows,
      getMapAttachmentForSpaces,
      getMapTokensData,
    };
    if (buttonKey === 'dc_activate_') await handleDcActivate(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_unactivate_') await handleDcUnactivate(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_toggle_') await handleDcToggle(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_deplete_') await handleDcDeplete(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_cc_special_') await handleDcCcSpecial(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_cc_eoa_') await handleDcCcEndOfActivation(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_cc_double_') await handleDcCcDoubleAction(interaction, dcPlayAreaContext);
    else if (buttonKey === 'pounce_space_') await handlePounceSpacePick(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_ability_choice_') await handleDcAbilityChoice(interaction, dcPlayAreaContext);
    else if (buttonKey === 'ee3_pick_die_') await handleEe3DiePick(interaction, dcPlayAreaContext);
    else if (buttonKey === 'false_orders_action_') await handleFalseOrdersAction(interaction, dcPlayAreaContext);
    else if (buttonKey === 'false_orders_space_') await handleFalseOrdersMovePick(interaction, dcPlayAreaContext);
    else await handleDcAction(interaction, dcPlayAreaContext, buttonKey);
    return;
  }

  if (buttonKey === 'special_done_') {
    await handleSpecialDone(interaction);
    return;
  }

  if (buttonKey === 'move_mp_') {
    const moveContext = {
      getGame,
      dcMessageMeta,
      getBoardStateForMovement,
      getMovementProfile,
      ensureMovementCache,
      getSpacesAtCost,
      clearMoveGridMessages,
      getMoveSpaceGridRows,
      getMovementMinimapAttachment,
      client,
    };
    await handleMoveMp(interaction, moveContext);
    return;
  }
  if (buttonKey === 'move_adjust_mp_') {
    const moveAdjustContext = {
      getGame,
      dcMessageMeta,
      clearMoveGridMessages,
      getMoveMpButtonRows,
    };
    await handleMoveAdjustMp(interaction, moveAdjustContext);
    return;
  }
  if (buttonKey === 'move_letter_') {
    const moveLetterContext = {
      getGame,
      dcMessageMeta,
      clearMoveGridMessages,
      getMoveSpaceGridRows,
      buildLetterRows,
    };
    await handleMoveLetter(interaction, moveLetterContext);
    return;
  }
  if (buttonKey === 'move_back_letters_') {
    const moveBackLettersContext = {
      getGame,
      dcMessageMeta,
      clearMoveGridMessages,
      buildLetterRows,
    };
    await handleMoveLetterBack(interaction, moveBackLettersContext);
    return;
  }
  if (buttonKey === 'move_pick_') {
    const movePickContext = {
      getGame,
      dcMessageMeta,
      clearMoveGridMessages,
      getBoardStateForMovement,
      getMovementProfile,
      ensureMovementCache,
      computeMovementCache,
      normalizeCoord,
      getMovementTarget,
      getFigureSize,
      getNormalizedFootprint,
      resolveMassivePush,
      updateMovementBankMessage,
      getMovementPath,
      pushUndo,
      logGameAction,
      countTerminalsControlledByPlayer,
      buildLetterRows,
      getMovementMinimapAttachment,
      buildBoardMapPayload,
      updateDcActionsMessage,
      sendBleedingPrompt,
      getDcStats,
      dcHealthState,
      saveGames,
      client,
    };
    await handleMovePick(interaction, movePickContext);
    return;
  }

  if (buttonKey === 'sidewinder_apply_') { await handleSidewinderApply(interaction); return; }
  if (buttonKey === 'sidewinder_skip_') { await handleSidewinderSkip(interaction); return; }
  if (buttonKey === 'boltslinger_target_') { await handleBoltslingerTarget(interaction); return; }
  if (buttonKey === 'boltslinger_skip_') { await handleBoltslingerSkip(interaction); return; }
  if (buttonKey === 'indiscriminate_die_') { await handleIndiscriminateFireDie(interaction); return; }
  if (buttonKey === 'indiscriminate_skip_') { await handleIndiscriminateFireSkip(interaction); return; }
  if (buttonKey === 'fighting_knife_target_') { await handleFightingKnifeTarget(interaction); return; }
  if (buttonKey === 'fighting_knife_skip_') { await handleFightingKnifeSkip(interaction); return; }
  if (buttonKey === 'concussive_bolt_push_') { await handleConcussiveBoltPush(interaction); return; }
  if (buttonKey === 'concussive_bolt_skip_') { await handleConcussiveBoltSkip(interaction); return; }
  if (buttonKey === 'spread_pain_fig_') { await handleSpreadThePainFigPick(interaction); return; }
  if (buttonKey === 'spread_pain_skip_') { await handleSpreadThePainSkip(interaction); return; }
  if (buttonKey === 'missile_salvo_die_') { await handleMissileSalvoDie(interaction); return; }
  if (buttonKey === 'missile_salvo_done_') { await handleMissileSalvoDone(interaction); return; }

  if (buttonKey === 'cleave_target_' || buttonKey === 'attack_target_' || buttonKey === 'combat_resolve_ready_' || buttonKey === 'combat_ready_' || buttonKey === 'combat_roll_' || buttonKey === 'combat_surge_' || buttonKey === 'combat_reroll_' || buttonKey === 'combat_token_' || buttonKey === 'spread_pain_cond_' || buttonKey === 'figurehead_use_' || buttonKey === 'figurehead_skip_' || buttonKey === 'lasat_die_' || buttonKey === 'lasat_face_' || buttonKey === 'false_orders_atk_' || buttonKey === 'tough_luck_remove_' || buttonKey === 'tough_luck_skip_' || buttonKey === 'there_is_no_try_die_' || buttonKey === 'there_is_no_try_face_' || buttonKey === 'there_is_no_try_skip_' || buttonKey === 'vet_instincts_pick_' || buttonKey === 'hunter_protocol_trigger_' || buttonKey === 'hunter_protocol_skip_') {
    const combatContext = {
      getGame,
      replyIfGameEnded,
      dcMessageMeta,
      dcHealthState,
      findDcMessageIdForFigure,
      getDcStats,
      getDcEffects,
      updateDcActionsMessage,
      updateActivationsMessage,
      updateAttachmentMessageForDc,
      logGameAction,
      isGroupDefeated,
      checkWinConditions,
      finishCombatResolution,
      checkPostCombatSurges,
      ACTION_ICONS,
      ThreadAutoArchiveDuration,
      resolveCombatAfterRolls,
      saveGames,
      client,
      rollAttackDice,
      rollDefenseDice,
      rollSingleAttackDie,
      rollSingleDefenseDie,
      recalcAttackTotals,
      recalcDefenseTotals,
      getInnateRerolls,
      getAttackerSurgeAbilities,
      SURGE_LABELS,
      parseSurgeEffect,
      getAbility,
      resolveSurgeAbility,
      getSurgeAbilityLabel,
      getRange,
      hasLineOfSight,
      getDiceData,
    };
    if (buttonKey === 'cleave_target_') await handleCleaveTarget(interaction, combatContext);
    else if (buttonKey === 'attack_target_') await handleAttackTarget(interaction, combatContext);
    else if (buttonKey === 'combat_resolve_ready_') await handleCombatResolveReady(interaction, combatContext);
    else if (buttonKey === 'combat_ready_') await handleCombatReady(interaction, combatContext);
    else if (buttonKey === 'combat_roll_') await handleCombatRoll(interaction, combatContext);
    else if (buttonKey === 'combat_surge_') await handleCombatSurge(interaction, combatContext);
    else if (buttonKey === 'combat_reroll_') await handleCombatReroll(interaction, combatContext);
    else if (buttonKey === 'combat_token_') await handleCombatToken(interaction, combatContext);
    else if (buttonKey === 'spread_pain_cond_') await handleSpreadThePainCondPick(interaction, combatContext);
    else if (buttonKey === 'figurehead_use_' || buttonKey === 'figurehead_skip_') await handleFigureheadDecision(interaction, combatContext);
    else if (buttonKey === 'lasat_die_') await handleLasatDiePick(interaction, combatContext);
    else if (buttonKey === 'lasat_face_') await handleLasatFacePick(interaction, combatContext);
    else if (buttonKey === 'false_orders_atk_') await handleFalseOrdersAtkPick(interaction, combatContext);
    else if (buttonKey === 'tough_luck_remove_' || buttonKey === 'tough_luck_skip_') {
      // Tough Luck: remove a rerolled die or skip, then continue reroll flow
      const _tlParts = interaction.customId.split('_');
      const _tlGameId = _tlParts[3];
      const _tlGame = getGame(_tlGameId);
      if (!_tlGame?.pendingToughLuck) { await interaction.followUp({ content: 'No pending Tough Luck.', ephemeral: true }).catch(() => {}); return; }
      const _tlData = _tlGame.pendingToughLuck;
      const _tlCombat = _tlGame.pendingCombat;
      const _tlAtk = _tlCombat?.attackerPlayerNum;
      const _tlDef = _tlAtk === 1 ? 2 : 1;
      // TL player is the one who set toughLuckPlayerNum
      const _tlResponder = _tlGame.toughLuckPlayerNum;
      if (!canActAsPlayer(_tlGame, interaction.user.id, _tlResponder)) {
        await interaction.followUp({ content: 'Only the Tough Luck player may respond.', ephemeral: true }).catch(() => {}); return;
      }
      if (buttonKey === 'tough_luck_remove_') {
        const _tlDieIdx = parseInt(_tlParts[4], 10);
        if (_tlData.side === 'atk' && _tlCombat?.attackDiceResults?.[_tlDieIdx]) {
          const _tlDie = _tlCombat.attackDiceResults[_tlDieIdx];
          _tlCombat.attackDiceResults.splice(_tlDieIdx, 1);
          const t = recalcAttackTotals(_tlCombat.attackDiceResults);
          _tlCombat.attackRoll = { acc: t.acc, dmg: t.dmg, surge: t.surge };
          await logGameAction(_tlGame, client, `**Tough Luck** — Removed rerolled ${_tlDie.color} attack die. New totals: ${t.acc} acc, ${t.dmg} dmg, ${t.surge} surge.`, { phase: 'ROUND', icon: 'card' });
        } else if (_tlData.side === 'def' && _tlCombat?.defenseDiceResults?.[_tlDieIdx]) {
          const _tlDie = _tlCombat.defenseDiceResults[_tlDieIdx];
          _tlCombat.defenseDiceResults.splice(_tlDieIdx, 1);
          const t = recalcDefenseTotals(_tlCombat.defenseDiceResults);
          _tlCombat.defenseRoll = { block: t.block, evade: t.evade, dodge: t.dodge };
          await logGameAction(_tlGame, client, `**Tough Luck** — Removed rerolled ${_tlDie.color} defense die. New totals: ${t.block} block, ${t.evade} evade.`, { phase: 'ROUND', icon: 'card' });
        }
      } else {
        await logGameAction(_tlGame, client, '**Tough Luck** — Skipped.', { phase: 'ROUND', icon: 'card' });
      }
      _tlGame.pendingToughLuck = null;
      // Continue reroll flow
      const _tlThread = await client.channels.fetch(_tlCombat?.combatThreadId).catch(() => null);
      if (_tlThread && _tlCombat) {
        const _tlSide = _tlData.side;
        const _tlAtkRem = _tlCombat.attackerRerollsRemaining || 0;
        const _tlDefRem = _tlCombat.defenderRerollsRemaining || 0;
        if (_tlSide === 'atk' && _tlAtkRem > 0) {
          await sendRerollUI(_tlThread, _tlGame, _tlCombat, 'attacker');
        } else if (_tlSide === 'def' && _tlDefRem > 0) {
          await sendRerollUI(_tlThread, _tlGame, _tlCombat, 'defender');
        } else if (_tlSide === 'atk' && _tlDefRem > 0) {
          _tlCombat.rerollPhase = 'defender';
          await sendRerollUI(_tlThread, _tlGame, _tlCombat, 'defender');
        } else {
          _tlCombat.rerollPhase = null;
          await proceedAfterRerolls(_tlThread, _tlGame, _tlCombat, combatContext);
        }
      }
      saveGames(); return;
    } else if (buttonKey === 'there_is_no_try_die_' || buttonKey === 'there_is_no_try_face_' || buttonKey === 'there_is_no_try_skip_') {
      // There Is No Try: die picker → face picker → apply, then enter reroll window
      const _tintParts = interaction.customId.split('_');
      // Prefix pattern: there_is_no_try_{die|face|skip}_ → parts[0..4] are the prefix words
      const _tintType = _tintParts[4]; // 'die', 'face', or 'skip'
      const _tintGameId = _tintParts[5];
      const _tintGame = getGame(_tintGameId);
      if (!_tintGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
      const _tintCombat = _tintGame.pendingCombat;
      const _tintDefNum = _tintCombat?.defenderPlayerNum ?? (_tintCombat?.attackerPlayerNum === 1 ? 2 : 1);
      if (!canActAsPlayer(_tintGame, interaction.user.id, _tintDefNum)) {
        await interaction.followUp({ content: 'Only the defender may respond.', ephemeral: true }).catch(() => {}); return;
      }
      if (!_tintGame.pendingThereIsNoTry && _tintType !== 'skip') {
        await interaction.followUp({ content: 'No pending There Is No Try.', ephemeral: true }).catch(() => {}); return;
      }
      const _tintThread = await client.channels.fetch(_tintCombat?.combatThreadId).catch(() => null);
      if (_tintType === 'die') {
        const _tintDieIdx = parseInt(_tintParts[6], 10);
        const _tintDefDice = _tintCombat?.defenseDiceResults || [];
        const _tintDie = _tintDefDice[_tintDieIdx];
        if (!_tintDie) { await interaction.followUp({ content: 'Die not found.', ephemeral: true }).catch(() => {}); return; }
        _tintGame.pendingThereIsNoTry.pickedDieIdx = _tintDieIdx;
        // Build face options based on die color (white/black)
        const _tintColor = _tintDie.color || 'white';
        // Standard defense die faces: white: 0/0, 1/0, 1/1, 0/0/dodge; black: 0/0, 1/0, 2/0, 1/1, 0/1, dodge
        const _tintFaceOptions = _tintColor === 'black'
          ? [{ block: 0, evade: 0 }, { block: 1, evade: 0 }, { block: 2, evade: 0 }, { block: 1, evade: 1 }, { block: 0, evade: 1 }, { block: 0, evade: 0, dodge: true }]
          : [{ block: 0, evade: 0 }, { block: 1, evade: 0 }, { block: 1, evade: 1 }, { block: 0, evade: 0, dodge: true }];
        const _tintFaceBtns = _tintFaceOptions.map((face, fi) =>
          new ButtonBuilder()
            .setCustomId(`there_is_no_try_face_${_tintGameId}_${_tintDieIdx}_${face.block ?? 0}_${face.evade ?? 0}_${face.dodge ? 1 : 0}`)
            .setLabel(`${face.block ?? 0}B/${face.evade ?? 0}E${face.dodge ? '/Dodge' : ''}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        );
        if (_tintThread) await _tintThread.send({ content: `**There Is No Try** — Choose any face for die #${_tintDieIdx + 1} (${_tintColor}):`, components: [new ActionRowBuilder().addComponents(..._tintFaceBtns.slice(0, 5))] }).catch(() => {});
        saveGames(); return;
      }
      if (_tintType === 'face') {
        const _tintDieIdxF = parseInt(_tintParts[6], 10);
        const _tintBlock = parseInt(_tintParts[7], 10) || 0;
        const _tintEvade = parseInt(_tintParts[8], 10) || 0;
        const _tintDodgeFlag = parseInt(_tintParts[9], 10) === 1;
        const _tintDefDiceF = _tintCombat?.defenseDiceResults || [];
        if (_tintDefDiceF[_tintDieIdxF]) {
          const _tintOld = _tintDefDiceF[_tintDieIdxF];
          // Apply chosen face; convert any Dodge results on this die to Block+Block+Evade
          _tintDefDiceF[_tintDieIdxF] = { ..._tintOld, block: _tintBlock, evade: _tintEvade, dodge: _tintDodgeFlag };
          // Convert Dodge on this die to +2 Block +1 Evade (no dice dodge result)
          if (_tintDodgeFlag) {
            _tintDefDiceF[_tintDieIdxF] = { ..._tintOld, block: _tintBlock + 2, evade: _tintEvade + 1, dodge: false };
          }
          _tintCombat.defenseDiceResults = _tintDefDiceF;
          const _tintNewTotal = _tintDefDiceF.reduce((acc, d) => ({ block: acc.block + (d.block ?? 0), evade: acc.evade + (d.evade ?? 0), dodge: acc.dodge || !!d.dodge }), { block: 0, evade: 0, dodge: false });
          _tintCombat.defenseRoll = { block: _tintNewTotal.block, evade: _tintNewTotal.evade, dodge: _tintNewTotal.dodge };
          if (_tintThread) await _tintThread.send(`**There Is No Try** — Die set to ${_tintBlock}B/${_tintEvade}E${_tintDodgeFlag ? ' (Dodge→+2B+1E)' : ''}. New defense totals: ${_tintCombat.defenseRoll.block} block, ${_tintCombat.defenseRoll.evade} evade.`).catch(() => {});
        }
        _tintGame.pendingThereIsNoTry = null;
        _tintCombat.tintResolved = true;
      } else {
        // Skip
        _tintGame.pendingThereIsNoTry = null;
        _tintCombat.tintResolved = true;
        if (_tintThread) await _tintThread.send('**There Is No Try** — Skipped.').catch(() => {});
      }
      // After TINT resolves (face set or skipped): enter reroll window
      if (_tintThread && _tintCombat) {
        const _tintAtkRem = _tintCombat.attackerRerollsRemaining || 0;
        const _tintDefRem = _tintCombat.defenderRerollsRemaining || 0;
        if (_tintAtkRem > 0 || _tintDefRem > 0) {
          _tintCombat.rerollPhase = _tintAtkRem > 0 ? 'attacker' : 'defender';
          await sendRerollUI(_tintThread, _tintGame, _tintCombat, _tintCombat.rerollPhase);
        } else {
          _tintCombat.rerollPhase = null;
          await proceedAfterRerolls(_tintThread, _tintGame, _tintCombat, combatContext);
        }
      }
      saveGames(); return;
    } else if (buttonKey === 'vet_instincts_pick_') {
      // Veteran Instincts: attacker adds +1 Hit/Surge, defender adds +1 Block/Evade
      const _viParts = interaction.customId.split('_');
      const _viGameId = _viParts[3];
      const _viChoice = _viParts[4]; // hit/surge/block/evade/skip
      const _viGame = getGame(_viGameId);
      if (!_viGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
      const _viCombat = _viGame.pendingCombat;
      if (!_viCombat) { await interaction.followUp({ content: 'No active combat.', ephemeral: true }).catch(() => {}); return; }
      const _viAtk = _viCombat.attackerPlayerNum;
      const _viDef = _viAtk === 1 ? 2 : 1;
      // Determine phase: block/evade = defense; hit/surge = attack; skip depends on which phase is pending
      const _viIsDefPhase = _viChoice === 'block' || _viChoice === 'evade' || (_viChoice === 'skip' && _viCombat.vetInstinctsAttackApplied);
      const _viExpectedPlayer = _viIsDefPhase ? _viDef : _viAtk;
      if (!canActAsPlayer(_viGame, interaction.user.id, _viExpectedPlayer)) {
        await interaction.followUp({ content: `Only P${_viExpectedPlayer} may respond to Veteran Instincts.`, ephemeral: true }).catch(() => {}); return;
      }
      const _viThread = await client.channels.fetch(_viCombat.combatThreadId).catch(() => null);
      if (_viChoice === 'hit') {
        _viCombat.attackRoll = { ..._viCombat.attackRoll, dmg: (_viCombat.attackRoll?.dmg || 0) + 1 };
        _viCombat.vetInstinctsAttackApplied = true;
        if (_viThread) await _viThread.send('**Veteran Instincts** — +1 Hit added to attack roll.').catch(() => {});
      } else if (_viChoice === 'surge') {
        _viCombat.attackRoll = { ..._viCombat.attackRoll, surge: (_viCombat.attackRoll?.surge || 0) + 1 };
        _viCombat.vetInstinctsAttackApplied = true;
        if (_viThread) await _viThread.send('**Veteran Instincts** — +1 Surge added to attack roll.').catch(() => {});
      } else if (_viChoice === 'block') {
        _viCombat.defenseRoll = { ..._viCombat.defenseRoll, block: (_viCombat.defenseRoll?.block || 0) + 1 };
        _viCombat.vetInstinctsDefenseApplied = true;
        if (_viThread) await _viThread.send('**Veteran Instincts** — +1 Block added to defense roll.').catch(() => {});
      } else if (_viChoice === 'evade') {
        _viCombat.defenseRoll = { ..._viCombat.defenseRoll, evade: (_viCombat.defenseRoll?.evade || 0) + 1 };
        _viCombat.vetInstinctsDefenseApplied = true;
        if (_viThread) await _viThread.send('**Veteran Instincts** — +1 Evade added to defense roll.').catch(() => {});
      } else {
        // skip
        if (!_viCombat.vetInstinctsAttackApplied) {
          _viCombat.vetInstinctsAttackApplied = true;
          if (_viThread) await _viThread.send('**Veteran Instincts** — Attack bonus skipped.').catch(() => {});
        } else {
          _viCombat.vetInstinctsDefenseApplied = true;
          if (_viThread) await _viThread.send('**Veteran Instincts** — Defense bonus skipped.').catch(() => {});
        }
      }
      if (_viIsDefPhase && _viThread && _viCombat) {
        // Enter or continue the reroll window using stored pending counts
        const _viAtkRem = _viCombat.viPendingAtkRerolls || 0;
        const _viDefRem = _viCombat.viPendingDefRerolls || 0;
        if (_viAtkRem > 0 || _viDefRem > 0) {
          _viCombat.rerollPhase = _viAtkRem > 0 ? 'attacker' : 'defender';
          _viCombat.attackerRerollsRemaining = _viAtkRem;
          _viCombat.defenderRerollsRemaining = _viDefRem;
          await sendRerollUI(_viThread, _viGame, _viCombat, _viCombat.rerollPhase);
        } else {
          _viCombat.rerollPhase = null;
          await proceedAfterRerolls(_viThread, _viGame, _viCombat, combatContext);
        }
      }
      saveGames(); return;
    } else if (buttonKey === 'hunter_protocol_trigger_' || buttonKey === 'hunter_protocol_skip_') {
      // Hunter Protocol: re-trigger the same surge ability once
      const _hpGameId = interaction.customId.replace(/^hunter_protocol_(?:trigger|skip)_/, '');
      const _hpGame = getGame(_hpGameId);
      if (!_hpGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
      const _hpCombat = _hpGame.pendingCombat;
      if (!_hpCombat || !_hpGame.pendingHunterProtocol) { await interaction.followUp({ content: 'No pending Hunter Protocol.', ephemeral: true }).catch(() => {}); return; }
      const _hpAtk = _hpCombat.attackerPlayerNum;
      if (!canActAsPlayer(_hpGame, interaction.user.id, _hpAtk)) {
        await interaction.followUp({ content: 'Only the attacker may respond to Hunter Protocol.', ephemeral: true }).catch(() => {}); return;
      }
      const _hpThread = await client.channels.fetch(_hpCombat.combatThreadId).catch(() => null);
      const { key: _hpKey, cost: _hpCost } = _hpGame.pendingHunterProtocol;
      _hpGame.pendingHunterProtocol = null;
      if (buttonKey === 'hunter_protocol_trigger_' && _hpKey) {
        const _hpResolveSurge = resolveSurgeAbility || parseSurgeEffect;
        const _hpMod = _hpResolveSurge ? _hpResolveSurge(_hpKey) : {};
        _hpCombat.surgeDamage = (_hpCombat.surgeDamage || 0) + (_hpMod.damage ?? 0);
        _hpCombat.surgePierce = (_hpCombat.surgePierce || 0) + (_hpMod.pierce ?? 0);
        _hpCombat.surgeAccuracy = (_hpCombat.surgeAccuracy || 0) + (_hpMod.accuracy ?? 0);
        if (_hpMod.conditions?.length) _hpCombat.surgeConditions = (_hpCombat.surgeConditions || []).concat(_hpMod.conditions);
        _hpCombat.surgeBlast = (_hpCombat.surgeBlast || 0) + (_hpMod.blast ?? 0);
        _hpCombat.surgeRecover = (_hpCombat.surgeRecover || 0) + (_hpMod.recover ?? 0);
        _hpCombat.surgeCleave = (_hpCombat.surgeCleave || 0) + (_hpMod.cleave ?? 0);
        _hpCombat.surgeRemaining = Math.max(0, (_hpCombat.surgeRemaining || 0) - _hpCost);
        const _hpLabel = (SURGE_LABELS && SURGE_LABELS[_hpKey]) || getSurgeAbilityLabel?.(_hpKey) || _hpKey;
        if (_hpThread) await _hpThread.send(`**Hunter Protocol** — Triggered **${_hpLabel}** again (cost: ${_hpCost}). Surge remaining: ${_hpCombat.surgeRemaining}`).catch(() => {});
      } else {
        if (_hpThread) await _hpThread.send('**Hunter Protocol** — Skipped second trigger.').catch(() => {});
      }
      // Continue surge flow
      if ((_hpCombat.surgeRemaining || 0) <= 0) {
        _hpCombat.surgeRemaining = 0;
        if (_hpThread) await sendReadyToResolveRolls(_hpThread, _hpGameId);
      } else {
        const _hpSurgeAbilities = getAttackerSurgeAbilities(_hpCombat);
        const _hpRemaining = _hpCombat.surgeRemaining || 0;
        const _hpRows = [];
        for (let _hi = 0; _hi < _hpSurgeAbilities.length; _hi++) {
          const _hpSkey = _hpSurgeAbilities[_hi];
          const _hpScost = (_hpSkey?.startsWith?.('double:') ? 2 : (getAbility?.(_hpSkey)?.surgeCost ?? 1));
          if (_hpScost > _hpRemaining) continue;
          const _hpSlabel = ((SURGE_LABELS && SURGE_LABELS[_hpSkey]) || getSurgeAbilityLabel?.(_hpSkey) || _hpSkey).slice(0, 80);
          _hpRows.push(new ButtonBuilder().setCustomId(`combat_surge_${_hpGameId}_${_hi}`).setLabel((_hpScost > 1 ? `Spend ${_hpScost} surge: ${_hpSlabel}` : `Spend 1 surge: ${_hpSlabel}`).slice(0, 80)).setStyle(ButtonStyle.Secondary));
        }
        if (_hpCombat.attackerConds?.includes('Bleed') && !_hpCombat.surgePreventBleed) {
          _hpRows.push(new ButtonBuilder().setCustomId(`combat_surge_${_hpGameId}_bleed_prevention`).setLabel('Spend 1 Surge — Prevent Bleed').setStyle(ButtonStyle.Secondary));
        }
        _hpRows.push(new ButtonBuilder().setCustomId(`combat_surge_${_hpGameId}_done`).setLabel('Done (no more surge)').setStyle(ButtonStyle.Primary));
        if (_hpThread) await _hpThread.send({ content: `**Spend surge?** **${_hpRemaining}** surge left.`, components: [new ActionRowBuilder().addComponents(_hpRows.slice(0, 5))] }).catch(() => {});
      }
      saveGames(); return;
    }
    return;
  }

  if (buttonKey === 'bleed_accept_' || buttonKey === 'bleed_prevent_') {
    await handleBleedResolve(interaction);
    return;
  }

  if (buttonKey === 'reaction_skip_') {
    const gameId = interaction.customId.replace('reaction_skip_', '');
    const game = getGame(gameId);
    if (!game?.pendingReaction) { await interaction.followUp({ content: 'No pending reaction.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    const { ownerId, cardName } = game.pendingReaction;
    if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the reaction player can skip.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    await interaction.deferUpdate().catch(() => {});
    const pending = game.pendingReaction;
    delete game.pendingReaction;
    await interaction.message.edit({ components: [] }).catch(() => {});
    // Restore the card to hand (it was tentatively removed when prompting)
    const handKey = pending.defenderPlayerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    game[handKey] = game[handKey] || [];
    game[handKey].push(cardName);
    // Continue checking for more reactions or finish
    const cThread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
    if (cThread) {
      const triggered = await checkPostCombatSurges(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), cThread, ownerId, pending.defenderPlayerNum);
      if (triggered) { saveGames(); return; }
    }
    await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), client);
    saveGames();
    return;
  }

  if (buttonKey === 'reaction_use_') {
    const gameId = interaction.customId.replace('reaction_use_', '');
    const game = getGame(gameId);
    if (!game?.pendingReaction) { await interaction.followUp({ content: 'No pending reaction.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    const { ownerId, cardName, targetFigKey, attackerFigKey, attackerMsgId, defenderPlayerNum } = game.pendingReaction;
    if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the reaction player can use this.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    await interaction.deferUpdate().catch(() => {});
    await interaction.message.edit({ components: [] }).catch(() => {});
    const pending = game.pendingReaction;
    delete game.pendingReaction;
    // Card was already removed from hand when prompting; discard it (add to discard pile)
    const discardKey = defenderPlayerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    game[discardKey] = game[discardKey] || [];
    game[discardKey].push(cardName);
    const combat = pending.combat;
    const attackerPlayerNum = combat.attackerPlayerNum;
    const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);

    if (cardName === 'Payback') {
      // Payback: Dengar counter-attacks the attacker with +2 Surge bonus
      // Set a pending bonus surge for Dengar's next attack (keyed by Dengar's DC msgId)
      const dengarMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, targetFigKey);
      if (dengarMsgId) {
        game.paybackBonusSurge = game.paybackBonusSurge || {};
        game.paybackBonusSurge[dengarMsgId] = (game.paybackBonusSurge[dengarMsgId] || 0) + 2;
      }
      const attackerName = attackerFigKey.replace(/-\d+-\d+$/, '');
      if (thread) await thread.send(`**Payback** — Dengar may now counter-attack **${attackerName}**. Use the Attack button on Dengar's DC card. **+2 Surge** will be applied automatically to that attack.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } else if (cardName === 'Dangerous Prey') {
      // Dangerous Prey: attacker suffers 1 Damage (3 if adjacent to Bossk)
      const attackerPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigKey];
      const bosskPos = game.figurePositions?.[defenderPlayerNum]?.[targetFigKey];
      const ms = getMapSpaces(game.selectedMap?.id);
      const adjSet = new Set((ms?.adjacency?.[String(bosskPos).toLowerCase()] || []).map((s) => String(s).toLowerCase()));
      const isAdj = attackerPos && bosskPos && adjSet.has(String(attackerPos).toLowerCase());
      const dmg = isAdj ? 3 : 1;
      const atkMsgId = attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey);
      const attackerName = attackerFigKey.replace(/-\d+-\d+$/, '');
      if (thread) await thread.send(`**Dangerous Prey** — ${attackerName} suffers **${dmg} Damage**${isAdj ? ' (adjacent to Bossk)' : ''}. Bossk gains **2 MP**.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
      await applyDirectDamageToFigure(game, attackerPlayerNum, attackerFigKey, atkMsgId, dmg, client, null, 'Dangerous Prey');
      // Add 2 MP to Bossk's movement bank
      const bosskMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, targetFigKey);
      if (bosskMsgId) {
        game.movementBank = game.movementBank || {};
        game.movementBank[bosskMsgId] = game.movementBank[bosskMsgId] || { remaining: 0, total: 0 };
        game.movementBank[bosskMsgId].remaining += 2;
        game.movementBank[bosskMsgId].total += 2;
      }
    } else if (cardName === "Right Back At Ya!") {
      // Right Back At Ya!: attacker suffers 1 Damage (3 if Boba spends Block Token)
      const bobaTokens = game.figurePowerTokens?.[targetFigKey] || [];
      const hasBlock = bobaTokens.includes('Block');
      if (hasBlock) {
        // Prompt for block token choice
        game.pendingRightBackAtYa = {
          gameId: game.gameId,
          combatThreadId: pending.combatThreadId,
          attackerPlayerNum,
          defenderPlayerNum,
          ownerId,
          attackerFigKey,
          attackerMsgId: attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey),
          bobaFigKey: targetFigKey,
          resultText: pending.resultText,
          combat: pending.combat,
          initialEmbedRefreshMsgIds: pending.initialEmbedRefreshMsgIds,
        };
        const btn3 = new ButtonBuilder().setCustomId(`right_back_block_${gameId}`).setLabel('Spend Block Token — 3 Damage').setStyle(ButtonStyle.Danger);
        const btn1 = new ButtonBuilder().setCustomId(`right_back_nodmg_${gameId}`).setLabel('1 Damage (no token)').setStyle(ButtonStyle.Secondary);
        if (thread) await thread.send({
          content: `<@${ownerId}> **Right Back At Ya!** — Spend your Block Token for 3 Damage, or deal 1 Damage without spending it:`,
          allowedMentions: { users: [ownerId] },
          components: [new ActionRowBuilder().addComponents(btn3, btn1)],
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        saveGames();
        return;
      }
      // No block token — just 1 damage
      const atkMsgId2 = attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey);
      await applyDirectDamageToFigure(game, attackerPlayerNum, attackerFigKey, atkMsgId2, 1, client, thread, 'Right Back At Ya!');
    }

    // Check for more reactions or finish
    if (thread) {
      const triggered = await checkPostCombatSurges(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), thread, ownerId, defenderPlayerNum);
      if (triggered) { saveGames(); return; }
    }
    await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), client);
    saveGames();
    return;
  }

  if (buttonKey === 'right_back_block_' || buttonKey === 'right_back_nodmg_') {
    const isBlockVariant = buttonKey === 'right_back_block_';
    const gameId = interaction.customId.replace(buttonKey, '');
    const game = getGame(gameId);
    if (!game?.pendingRightBackAtYa) { await interaction.followUp({ content: 'No pending Right Back At Ya! choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    const { ownerId, attackerPlayerNum, defenderPlayerNum, attackerFigKey, attackerMsgId, bobaFigKey } = game.pendingRightBackAtYa;
    if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the reaction player can choose.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    await interaction.deferUpdate().catch(() => {});
    await interaction.message.edit({ components: [] }).catch(() => {});
    const rbPending = game.pendingRightBackAtYa;
    delete game.pendingRightBackAtYa;
    const thread = await client.channels.fetch(rbPending.combatThreadId).catch(() => null);
    let dmg = 1;
    if (isBlockVariant) {
      // Spend Block token
      const bobaTokens = game.figurePowerTokens?.[bobaFigKey] || [];
      const blockIdx = bobaTokens.indexOf('Block');
      if (blockIdx >= 0) bobaTokens.splice(blockIdx, 1);
      if (!game.figurePowerTokens) game.figurePowerTokens = {};
      game.figurePowerTokens[bobaFigKey] = bobaTokens;
      dmg = 3;
    }
    const atkMsgId = attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey);
    await applyDirectDamageToFigure(game, attackerPlayerNum, attackerFigKey, atkMsgId, dmg, client, thread, 'Right Back At Ya!');
    // Continue checking for more reactions or finish
    if (thread) {
      const triggered = await checkPostCombatSurges(game, rbPending.combat, rbPending.resultText, new Set(rbPending.initialEmbedRefreshMsgIds), thread, ownerId, defenderPlayerNum);
      if (triggered) { saveGames(); return; }
    }
    await finishCombatResolution(game, rbPending.combat, rbPending.resultText, new Set(rbPending.initialEmbedRefreshMsgIds), client);
    saveGames();
    return;
  }

  if (buttonKey === 'mastery_pick_' || buttonKey === 'mastery_skip_') {
    const isMasterySkip = buttonKey === 'mastery_skip_';
    const mastGameId = isMasterySkip ? interaction.customId.replace('mastery_skip_', '') : interaction.customId.match(/^mastery_pick_([^_]+)_\d+$/)?.[1];
    if (!mastGameId) { await interaction.followUp({ content: 'Invalid mastery interaction.', ephemeral: true }).catch(() => {}); return; }
    const mastGame = getGame(mastGameId);
    if (!mastGame?.pendingMastery) { await interaction.followUp({ content: 'No pending Mastery choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    const { attackerPlayerNum: mastAPN, discardKey: mastDK, eligible: mastEl, resultText: mastRT, combat: mastCombat, initialEmbedRefreshMsgIds: mastEmbed, defenderPlayerNum: mastDPN } = mastGame.pendingMastery;
    const mastOwnerId = mastAPN === 1 ? mastGame.player1Id : mastGame.player2Id;
    if (interaction.user.id !== mastOwnerId) { await interaction.followUp({ content: 'Only the attacker can resolve Mastery.', ephemeral: true }).catch(() => {}); return; }
    await interaction.deferUpdate().catch(() => {});
    await interaction.message.edit({ components: [] }).catch(() => {});
    delete mastGame.pendingMastery;
    if (!isMasterySkip) {
      const mastCardIdx = parseInt(interaction.customId.split('_').pop(), 10);
      const mastCard = mastEl[mastCardIdx];
      if (mastCard) {
        const mastDiscard = mastGame[mastDK] || [];
        const mastIdx = mastDiscard.indexOf(mastCard);
        if (mastIdx >= 0) mastDiscard.splice(mastIdx, 1);
        mastGame[mastDK] = mastDiscard;
        const mastHandKey = mastAPN === 1 ? 'player1CcHand' : 'player2CcHand';
        mastGame[mastHandKey] = mastGame[mastHandKey] || [];
        mastGame[mastHandKey].push(mastCard);
        const mastThread = await client.channels.fetch(mastCombat.combatThreadId).catch(() => null);
        if (mastThread) await mastThread.send(`**Mastery** — **${mastCard}** returned from discard to hand.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
        await updateHandChannelMessages(mastGame, mastAPN, client).catch(() => {});
      }
    }
    const mastCThread = await client.channels.fetch(mastCombat.combatThreadId).catch(() => null);
    if (mastCThread) {
      const triggered = await checkPostCombatSurges(mastGame, mastCombat, mastRT, new Set(mastEmbed), mastCThread, mastOwnerId, mastDPN);
      if (triggered) { saveGames(); return; }
    }
    await finishCombatResolution(mastGame, mastCombat, mastRT, new Set(mastEmbed), client);
    saveGames();
    return;
  }

  if (buttonKey === 'interrogate_pick_' || buttonKey === 'interrogate_discard_' || buttonKey === 'interrogate_skip_') {
    const intGameId = interaction.customId.match(/^interrogate_(?:pick|discard|skip)_([^_]+)/)?.[1];
    if (!intGameId) { await interaction.followUp({ content: 'Invalid interrogate interaction.', ephemeral: true }).catch(() => {}); return; }
    const intGame = getGame(intGameId);
    if (!intGame?.pendingInterrogate) { await interaction.followUp({ content: 'No pending Interrogate choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    const { attackerPlayerNum: intAPN, opponentPlayerNum: intOPN, opponentHandSnapshot: intOHS, chosenCardName: intChosen, ownEligibleSnapshot: intOES, resultText: intRT, combat: intCombat, initialEmbedRefreshMsgIds: intEmbed, defenderPlayerNum: intDPN } = intGame.pendingInterrogate;
    const intOwnerId = intAPN === 1 ? intGame.player1Id : intGame.player2Id;
    if (interaction.user.id !== intOwnerId) { await interaction.followUp({ content: 'Only the attacker can resolve Interrogate.', ephemeral: true }).catch(() => {}); return; }
    await interaction.deferUpdate().catch(() => {});
    await interaction.message.edit({ components: [] }).catch(() => {});
    const intThread = await client.channels.fetch(intCombat.combatThreadId).catch(() => null);

    if (buttonKey === 'interrogate_pick_') {
      // Step 1: attacker chose a card from opponent's hand. Show own hand to optionally discard.
      const intPickIdx = parseInt(interaction.customId.split('_').pop(), 10);
      const intChosenCard = intOHS[intPickIdx];
      if (!intChosenCard) { delete intGame.pendingInterrogate; saveGames(); return; }
      intGame.pendingInterrogate.chosenCardName = intChosenCard;
      const intChosenCost = getCcEffect(intChosenCard)?.cost ?? 0;
      const intHandKey = intAPN === 1 ? 'player1CcHand' : 'player2CcHand';
      const intOwnHand = intGame[intHandKey] || [];
      const intEligible = intOwnHand.filter((c) => (getCcEffect(c)?.cost ?? 0) >= intChosenCost);
      if (intEligible.length === 0) {
        // Can't afford to discard — just log and finish
        if (intThread) await intThread.send(`**Interrogate** — You chose **${intChosenCard}** (cost ${intChosenCost}). No cards in your hand with equal or greater cost to force the discard.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
        delete intGame.pendingInterrogate;
        const triggered = intThread ? await checkPostCombatSurges(intGame, intCombat, intRT, new Set(intEmbed), intThread, intOwnerId, intDPN) : false;
        if (triggered) { saveGames(); return; }
        await finishCombatResolution(intGame, intCombat, intRT, new Set(intEmbed), client);
        saveGames();
        return;
      }
      intGame.pendingInterrogate.ownEligibleSnapshot = intEligible;
      const intStep2Btns = intEligible.slice(0, 4).map((cardName, i) =>
        new ButtonBuilder().setCustomId(`interrogate_discard_${intGameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Danger)
      );
      intStep2Btns.push(new ButtonBuilder().setCustomId(`interrogate_skip_${intGameId}`).setLabel("Skip (don't discard)").setStyle(ButtonStyle.Secondary));
      if (intThread) await intThread.send({
        content: `<@${intOwnerId}> **Interrogate** — You chose **${intChosenCard}** (cost ${intChosenCost}). Discard a card (cost ≥ ${intChosenCost}) from your hand to force-discard it?`,
        allowedMentions: { users: [intOwnerId] },
        components: [new ActionRowBuilder().addComponents(intStep2Btns)],
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      saveGames();
      return;
    }

    // Step 2: interrogate_discard_ or interrogate_skip_
    if (!intChosen) { delete intGame.pendingInterrogate; saveGames(); return; }
    if (buttonKey === 'interrogate_discard_') {
      const intDisIdx = parseInt(interaction.customId.split('_').pop(), 10);
      const intOwnCard = (intOES || [])[intDisIdx];
      if (intOwnCard) {
        // Discard attacker's card from hand
        const intHandKey = intAPN === 1 ? 'player1CcHand' : 'player2CcHand';
        const intOwnHandArr = intGame[intHandKey] || [];
        const intOwnIdx = intOwnHandArr.indexOf(intOwnCard);
        if (intOwnIdx >= 0) intOwnHandArr.splice(intOwnIdx, 1);
        const intOwnDiscardKey = intAPN === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
        intGame[intOwnDiscardKey] = intGame[intOwnDiscardKey] || [];
        intGame[intOwnDiscardKey].push(intOwnCard);
        // Discard opponent's chosen card from hand
        const intOppHandKey = intOPN === 1 ? 'player1CcHand' : 'player2CcHand';
        const intOppHandArr = intGame[intOppHandKey] || [];
        const intOppIdx = intOppHandArr.indexOf(intChosen);
        if (intOppIdx >= 0) intOppHandArr.splice(intOppIdx, 1);
        const intOppDiscardKey = intOPN === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
        intGame[intOppDiscardKey] = intGame[intOppDiscardKey] || [];
        intGame[intOppDiscardKey].push(intChosen);
        if (intThread) await intThread.send(`**Interrogate** — Discarded **${intOwnCard}** from your hand; **${intChosen}** removed from opponent's hand.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
        await updateHandChannelMessages(intGame, intAPN, client).catch(() => {});
        await updateHandChannelMessages(intGame, intOPN, client).catch(() => {});
      }
    } else {
      // Skip — just log
      if (intThread) await intThread.send(`**Interrogate** — Chose to see **${intChosen}** from opponent's hand; no discard.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
    delete intGame.pendingInterrogate;
    const intTriggered = intThread ? await checkPostCombatSurges(intGame, intCombat, intRT, new Set(intEmbed), intThread, intOwnerId, intDPN) : false;
    if (intTriggered) { saveGames(); return; }
    await finishCombatResolution(intGame, intCombat, intRT, new Set(intEmbed), client);
    saveGames();
    return;
  }

  // Still Faster Than You: interrupt prompt response handlers
  if (buttonKey === 'still_faster_use_' || buttonKey === 'still_faster_skip_' || buttonKey === 'still_faster_dc_pick_') {
    const sftParts = interaction.customId.split('_');
    // still_faster_use_{gameId}_{activatingMsgId}
    // still_faster_skip_{gameId}_{activatingMsgId}
    // still_faster_dc_pick_{gameId}_{sftDcMsgId}_{activatingMsgId}
    let sftGameId, sftActivatingMsgId, sftPickedMsgId;
    if (buttonKey === 'still_faster_dc_pick_') {
      // still_faster_dc_pick_ prefix is 21 chars; remainder: gameId_sftDcMsgId_activatingMsgId
      const rem = interaction.customId.slice('still_faster_dc_pick_'.length);
      const remParts = rem.split('_');
      sftGameId = remParts[0];
      sftPickedMsgId = remParts[1];
      sftActivatingMsgId = remParts.slice(2).join('_');
    } else {
      const rem = interaction.customId.slice(buttonKey.length);
      const remParts = rem.split('_');
      sftGameId = remParts[0];
      sftActivatingMsgId = remParts.slice(1).join('_');
    }
    const sftGame = getGame(sftGameId);
    if (!sftGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }

    if (buttonKey === 'still_faster_skip_') {
      const sftPlayerNum = sftGame.pendingStillFaster?.sftPlayerNum;
      if (!canActAsPlayer(sftGame, interaction.user.id, sftPlayerNum)) { await interaction.followUp({ content: 'Only the Still Faster Than You player may respond.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      delete sftGame.pendingStillFaster;
      sftGame.stillFasterPlayerNum = null;
      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({ content: '**Still Faster Than You** — Skipped.', ephemeral: false }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      saveGames();
      return;
    }

    if (buttonKey === 'still_faster_use_') {
      const sftPending = sftGame.pendingStillFaster;
      if (!sftPending) { await interaction.followUp({ content: 'No pending Still Faster Than You.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      const { sftPlayerNum } = sftPending;
      if (!canActAsPlayer(sftGame, interaction.user.id, sftPlayerNum)) { await interaction.followUp({ content: 'Only the Still Faster Than You player may respond.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      // Show the SFTY player's non-exhausted DCs as picker buttons
      const sftDcList = sftPlayerNum === 1 ? (sftGame.p1DcList || []) : (sftGame.p2DcList || []);
      const sftMsgIds = sftPlayerNum === 1 ? (sftGame.p1DcMessageIds || []) : (sftGame.p2DcMessageIds || []);
      const sftActivatedIndices = sftPlayerNum === 1 ? (sftGame.p1ActivatedDcIndices || []) : (sftGame.p2ActivatedDcIndices || []);
      const sftButtons = [];
      for (let i = 0; i < sftDcList.length; i++) {
        const dc = sftDcList[i];
        if (!dc || dc.defeated || sftActivatedIndices.includes(i)) continue;
        const dcMsgId = sftMsgIds[i];
        if (!dcMsgId) continue;
        sftButtons.push(new ButtonBuilder()
          .setCustomId(`still_faster_dc_pick_${sftGameId}_${dcMsgId}_${sftActivatingMsgId}`)
          .setLabel((dc.displayName || dc.dcName).slice(0, 80))
          .setStyle(ButtonStyle.Primary));
      }
      if (sftButtons.length === 0) {
        delete sftGame.pendingStillFaster;
        sftGame.stillFasterPlayerNum = null;
        await interaction.deferUpdate().catch(() => {});
        await interaction.followUp({ content: '**Still Faster Than You** — No eligible figures to interrupt with.', ephemeral: false }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        saveGames();
        return;
      }
      const sftRows = [];
      for (let i = 0; i < sftButtons.length; i += 5) sftRows.push(new ActionRowBuilder().addComponents(sftButtons.slice(i, i + 5)));
      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({ content: '**Still Faster Than You** — Choose which figure interrupts (move 2 + attack):', components: sftRows.slice(0, 5), ephemeral: false }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      saveGames();
      return;
    }

    if (buttonKey === 'still_faster_dc_pick_') {
      const sftPending = sftGame.pendingStillFaster;
      if (!sftPending) { await interaction.followUp({ content: 'No pending Still Faster Than You.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      const { sftPlayerNum } = sftPending;
      if (!canActAsPlayer(sftGame, interaction.user.id, sftPlayerNum)) { await interaction.followUp({ content: 'Only the Still Faster Than You player may respond.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
      // Grant 2MP to the picked DC's movement bank and a free attack (excluding the activating hostile)
      sftGame.movementBank = sftGame.movementBank || {};
      const sftBank = sftGame.movementBank[sftPickedMsgId] || { total: 0, remaining: 0 };
      sftBank.total = (sftBank.total ?? 0) + 2;
      sftBank.remaining = (sftBank.remaining ?? 0) + 2;
      sftGame.movementBank[sftPickedMsgId] = sftBank;
      // Free attack: mark this DC with a free attack, excluding the activating hostile
      sftGame.fellSwoopFreeAttack = sftGame.fellSwoopFreeAttack || {};
      sftGame.fellSwoopFreeAttack[sftPickedMsgId] = true;
      // Store exclusion so handleAttackTarget can reject wrong target
      sftGame.stillFasterExcludeMsgId = sftActivatingMsgId;
      // Clear the flag (once-per-round CC; clear so it can't be used again)
      sftGame.stillFasterPlayerNum = null;
      delete sftGame.pendingStillFaster;
      const sftMeta = dcMessageMeta.get(sftPickedMsgId);
      const sftLabel = sftMeta?.displayName || sftMeta?.dcName || sftPickedMsgId;
      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({ content: `**Still Faster Than You** — **${sftLabel}** gains 2 MP and a free Attack. The attack must target a **different hostile** than the one that just activated.`, ephemeral: false }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      saveGames();
      return;
    }
    return;
  }

  // Squad Swarm: Yes/No handlers
  if (buttonKey === 'squad_swarm_yes_' || buttonKey === 'squad_swarm_no_') {
    const _swParts = interaction.customId.split('_');
    // squad_swarm_yes_{gameId}_{msgId}_{targetMsgId} OR squad_swarm_no_{gameId}_{msgId}
    const _swGameId = _swParts[3]; const _swMsgId = _swParts[4]; const _swTargetMsgId = _swParts[5];
    const _swGame = getGame(_swGameId);
    if (!_swGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
    const _swMeta = dcMessageMeta.get(_swMsgId);
    if (_swMeta && !canActAsPlayer(_swGame, interaction.user.id, _swMeta.playerNum)) {
      await interaction.followUp({ content: 'Only the Squad Swarm player may respond.', ephemeral: true }).catch(() => {}); return;
    }
    _swGame.squadSwarmPlayerNum = null;
    if (buttonKey === 'squad_swarm_yes_') {
      const _swTargetName = _swTargetMsgId ? (dcMessageMeta.get(_swTargetMsgId)?.displayName || 'another figure') : 'another figure';
      await logGameAction(_swGame, client, `**Squad Swarm** — Activating **${_swTargetName}**. Click its card to begin.`, { phase: 'ROUND', icon: 'activate' });
    } else {
      await logGameAction(_swGame, client, `**Squad Swarm** — Skipped.`, { phase: 'ROUND', icon: 'activate' });
    }
    saveGames(); return;
  }

  // Overdrive: DROID takes 1 damage for +1 action
  if (buttonKey === 'overdrive_use_') {
    const _odMsgId = interaction.customId.replace('overdrive_use_', '');
    const _odMeta = dcMessageMeta.get(_odMsgId);
    if (!_odMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(() => {}); return; }
    const _odGame = getGame(_odMeta.gameId);
    if (!_odGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
    if (!canActAsPlayer(_odGame, interaction.user.id, _odMeta.playerNum)) {
      await interaction.followUp({ content: 'Only the DC owner can use Overdrive.', ephemeral: true }).catch(() => {}); return;
    }
    const _odActionsData = _odGame.dcActionsData?.[_odMsgId];
    if (!_odActionsData) { await interaction.followUp({ content: 'No active activation found.', ephemeral: true }).catch(() => {}); return; }
    const _odHS = dcHealthState.get(_odMsgId) || [];
    let _odHpNote = '';
    if (_odHS[0]) {
      const [_oc, _om] = _odHS[0];
      const _onc = Math.max(0, (_oc ?? _om) - 1);
      _odHS[0] = [_onc, _om ?? _oc];
      dcHealthState.set(_odMsgId, _odHS);
      const _odDcIds = _odMeta.playerNum === 1 ? _odGame.p1DcMessageIds : _odGame.p2DcMessageIds;
      const _odDcList = _odMeta.playerNum === 1 ? _odGame.p1DcList : _odGame.p2DcList;
      const _odIdx = (_odDcIds || []).indexOf(_odMsgId);
      if (_odIdx >= 0 && _odDcList?.[_odIdx]) _odDcList[_odIdx].healthState = [..._odHS];
      _odHpNote = ` (HP: ${_oc ?? _om}→${_onc})`;
    }
    _odActionsData.remaining = Math.min((_odActionsData.total ?? DC_ACTIONS_PER_ACTIVATION) + 1, (_odActionsData.remaining || 0) + 1);
    const _odDgIdx = (_odMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    _odGame.overdriveUsedThisActivation = _odGame.overdriveUsedThisActivation || {};
    _odGame.overdriveUsedThisActivation[`${_odMeta.dcName}-${_odDgIdx}-0`] = true;
    await logGameAction(_odGame, client, `**Overdrive** — **${_odMeta.displayName || _odMeta.dcName}** took 1 Damage${_odHpNote}; +1 Action granted.`, { phase: 'ROUND', icon: 'activate' });
    await updateDcActionsMessage(_odGame, _odMsgId, client);
    const _odDisplayName = _odMeta.displayName || _odMeta.dcName;
    const { embed: _odEmbed, files: _odFiles } = await buildDcEmbedAndFiles(_odMeta.dcName, true, _odDisplayName, _odHS, getConditionsForDcMessage?.(_odGame, _odMeta), (_odGame?.p1DcAttachments?.[_odMsgId] || _odGame?.p2DcAttachments?.[_odMsgId] || []));
    try {
      const _odCh = await client.channels.fetch(_odMeta.playerNum === 1 ? _odGame.p1PlayAreaId : _odGame.p2PlayAreaId);
      const _odMsg = await _odCh.messages.fetch(_odMsgId);
      await _odMsg.edit({ embeds: [_odEmbed], files: _odFiles, components: getDcPlayAreaComponents(_odMsgId, true, _odGame, _odMeta.dcName) });
    } catch (err) { console.error('Overdrive embed refresh failed:', err); }
    saveGames(); return;
  }

  // Self-Destruct Probe: use or skip at end of round
  if (buttonKey === 'self_destruct_probe_use_' || buttonKey === 'self_destruct_probe_skip_') {
    const _sdpSuffix = interaction.customId.replace(buttonKey, '');
    const _sdpParts = _sdpSuffix.split('_');
    const _sdpGameId = _sdpParts[0]; const _sdpMsgId = _sdpParts.slice(1).join('_');
    const _sdpGame = getGame(_sdpGameId);
    if (!_sdpGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
    const _sdpMeta = dcMessageMeta.get(_sdpMsgId);
    if (!_sdpMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(() => {}); return; }
    if (!canActAsPlayer(_sdpGame, interaction.user.id, _sdpMeta.playerNum)) {
      await interaction.followUp({ content: 'Only the DC owner can respond.', ephemeral: true }).catch(() => {}); return;
    }
    if (buttonKey === 'self_destruct_probe_skip_') {
      await logGameAction(_sdpGame, client, `**Self-Destruct** — ${_sdpMeta.displayName || _sdpMeta.dcName} skipped.`, { phase: 'ROUND', icon: 'card' });
      saveGames(); return;
    }
    // Use: roll 1 red die, apply Hits to adjacent hostile figures, defeat probe
    const _sdpDiceData = getDiceData ? getDiceData() : null;
    const _sdpFaces = _sdpDiceData?.attack?.red || [];
    const _sdpFace = _sdpFaces[Math.floor(Math.random() * Math.max(_sdpFaces.length, 1))] || {};
    const _sdpHits = _sdpFace.dmg ?? 0;
    const _sdpFaceLabel = `${_sdpHits}H`;
    const _sdpPos = (() => { for (const [, pos] of Object.entries(_sdpGame.figurePositions?.[_sdpMeta.playerNum] || {})) { const fk = `${_sdpMeta.dcName}-1-0`; return _sdpGame.figurePositions?.[_sdpMeta.playerNum]?.[fk] || null; } return null; })();
    let _sdpResultLog = `Rolled red die: **${_sdpFaceLabel}** — `;
    if (_sdpHits > 0 && _sdpPos) {
      const _sdpMs = getMapSpaces ? getMapSpaces(_sdpGame.selectedMap?.id) : null;
      const _sdpAdj = _sdpMs?.adjacency?.[String(_sdpPos).toLowerCase()] || [];
      const _sdpAllAdjSpaces = new Set([String(_sdpPos).toLowerCase(), ..._sdpAdj.map(s => String(s).toLowerCase())]);
      const _sdpHostileNum = _sdpMeta.playerNum === 1 ? 2 : 1;
      const _sdpDamaged = [];
      for (const [_sdpFk, _sdpFkPos] of Object.entries(_sdpGame.figurePositions?.[_sdpHostileNum] || {})) {
        if (!_sdpFkPos || !_sdpAllAdjSpaces.has(String(_sdpFkPos).toLowerCase())) continue;
        let _sdpHMsgId = null;
        for (const [mid, mm] of dcMessageMeta) { if (mm.playerNum === _sdpHostileNum && _sdpFk.startsWith(mm.dcName + '-')) { _sdpHMsgId = mid; break; } }
        if (!_sdpHMsgId) continue;
        const _sdpHM = dcMessageMeta.get(_sdpHMsgId);
        const _sdpFkMatch = _sdpFk.match(/^(.+)-(\d+)-(\d+)$/);
        if (!_sdpFkMatch) continue;
        const _sdpHFigIdx = parseInt(_sdpFkMatch[3], 10);
        const _sdpHHS = dcHealthState.get(_sdpHMsgId) || [];
        if (!_sdpHHS[_sdpHFigIdx]) continue;
        const [_hc, _hm] = _sdpHHS[_sdpHFigIdx];
        if (_hc === null || _hc <= 0) continue;
        const _hnc = Math.max(0, _hc - _sdpHits);
        _sdpHHS[_sdpHFigIdx] = [_hnc, _hm ?? _hc];
        dcHealthState.set(_sdpHMsgId, _sdpHHS);
        const _sdpHDcIds = _sdpHostileNum === 1 ? _sdpGame.p1DcMessageIds : _sdpGame.p2DcMessageIds;
        const _sdpHDcList = _sdpHostileNum === 1 ? _sdpGame.p1DcList : _sdpGame.p2DcList;
        const _sdpHIdx = (_sdpHDcIds || []).indexOf(_sdpHMsgId);
        if (_sdpHIdx >= 0 && _sdpHDcList?.[_sdpHIdx]) _sdpHDcList[_sdpHIdx].healthState = [..._sdpHHS];
        _sdpDamaged.push(`${_sdpHM?.displayName || _sdpFkMatch[1]} (HP: ${_hc}→${_hnc})`);
      }
      _sdpResultLog += _sdpDamaged.length ? _sdpDamaged.join(', ') : 'No adjacent hostiles.';
    } else {
      _sdpResultLog += 'No hits.';
    }
    // Defeat the probe
    const _sdpDcIds2 = _sdpMeta.playerNum === 1 ? _sdpGame.p1DcMessageIds : _sdpGame.p2DcMessageIds;
    const _sdpDcList2 = _sdpMeta.playerNum === 1 ? _sdpGame.p1DcList : _sdpGame.p2DcList;
    const _sdpDcIdx = (_sdpDcIds2 || []).indexOf(_sdpMsgId);
    if (_sdpDcIdx >= 0 && _sdpDcList2?.[_sdpDcIdx]) {
      _sdpDcList2[_sdpDcIdx].healthState = [[0, _sdpDcList2[_sdpDcIdx].healthState?.[0]?.[1] ?? 0]];
      dcHealthState.set(_sdpMsgId, _sdpDcList2[_sdpDcIdx].healthState);
    }
    if (_sdpGame.figurePositions?.[_sdpMeta.playerNum]) delete _sdpGame.figurePositions[_sdpMeta.playerNum][`${_sdpMeta.dcName}-1-0`];
    await logGameAction(_sdpGame, client, `**Self-Destruct** — ${_sdpMeta.displayName || _sdpMeta.dcName}: ${_sdpResultLog} Probe defeated.`, { phase: 'ROUND', icon: 'attack' });
    saveGames(); return;
  }

  // Self-Destruct Protocol: pre-defeat use or skip during combat
  if (buttonKey === 'self_destruct_protocol_use_' || buttonKey === 'self_destruct_protocol_skip_') {
    await interaction.deferUpdate().catch(() => {});
    const _sdcpSuffix = interaction.customId.replace(buttonKey, '');
    const _sdcpParts = _sdcpSuffix.split('_');
    const _sdcpGameId = _sdcpParts[0]; const _sdcpTargetMsgId = _sdcpParts[1];
    const _sdcpGame = getGame(_sdcpGameId);
    if (!_sdcpGame || !_sdcpGame.pendingSelfDestruct) {
      await interaction.followUp({ content: 'No pending Self-Destruct Protocol.', ephemeral: true }).catch(() => {}); return;
    }
    const _sdcpPending = _sdcpGame.pendingSelfDestruct;
    if (!canActAsPlayer(_sdcpGame, interaction.user.id, _sdcpPending.defenderPlayerNum)) {
      await interaction.followUp({ content: 'Only the DC owner may respond.', ephemeral: true }).catch(() => {}); return;
    }
    delete _sdcpGame.pendingSelfDestruct;
    const _sdcpCombat = _sdcpGame.pendingCombat;
    if (buttonKey === 'self_destruct_protocol_use_') {
      // Roll 1 red die, apply Hit results as Damage to adjacent hostile figures
      const _sdcpDiceData = getDiceData ? getDiceData() : null;
      const _sdcpFaces = _sdcpDiceData?.attack?.red || [];
      const _sdcpFace = _sdcpFaces[Math.floor(Math.random() * Math.max(_sdcpFaces.length, 1))] || {};
      const _sdcpHits = _sdcpFace.dmg ?? 0;
      const _sdcpFaceLabel = `${_sdcpHits}H`;
      const _sdcpFigKey = _sdcpCombat?.target?.figureKey;
      const _sdcpPos = _sdcpFigKey ? _sdcpGame.figurePositions?.[_sdcpPending.defenderPlayerNum]?.[_sdcpFigKey] : null;
      let _sdcpResultLog = `Rolled red die: **${_sdcpFaceLabel}** — `;
      if (_sdcpHits > 0 && _sdcpPos && _sdcpGame.selectedMap?.id) {
        const _sdcpMs = getMapSpaces ? getMapSpaces(_sdcpGame.selectedMap.id) : null;
        const _sdcpAdj = _sdcpMs?.adjacency?.[String(_sdcpPos).toLowerCase()] || [];
        const _sdcpAllAdj = new Set([String(_sdcpPos).toLowerCase(), ..._sdcpAdj.map(s => String(s).toLowerCase())]);
        const _sdcpHostileNum = _sdcpPending.defenderPlayerNum === 1 ? 2 : 1;
        const _sdcpDamaged = [];
        for (const [_sfk, _sfkPos] of Object.entries(_sdcpGame.figurePositions?.[_sdcpHostileNum] || {})) {
          if (!_sfkPos || !_sdcpAllAdj.has(String(_sfkPos).toLowerCase())) continue;
          if (_sfk === _sdcpFigKey) continue;
          let _sfkMsgId = null;
          for (const [_mid, _mm] of dcMessageMeta) { if (_mm.playerNum === _sdcpHostileNum && _sfk.startsWith(_mm.dcName + '-')) { _sfkMsgId = _mid; break; } }
          if (!_sfkMsgId) continue;
          const _sfkFigMatch = _sfk.match(/^(.+)-(\d+)-(\d+)$/);
          if (!_sfkFigMatch) continue;
          const _sfkFigIdx = parseInt(_sfkFigMatch[3], 10);
          const _sfkHS = dcHealthState.get(_sfkMsgId) || [];
          if (!_sfkHS[_sfkFigIdx]) continue;
          const [_shc, _shm] = _sfkHS[_sfkFigIdx];
          if (_shc === null || _shc <= 0) continue;
          const _shnc = Math.max(0, _shc - _sdcpHits);
          _sfkHS[_sfkFigIdx] = [_shnc, _shm ?? _shc];
          dcHealthState.set(_sfkMsgId, _sfkHS);
          const _sfkDcIds = _sdcpHostileNum === 1 ? _sdcpGame.p1DcMessageIds : _sdcpGame.p2DcMessageIds;
          const _sfkDcList = _sdcpHostileNum === 1 ? _sdcpGame.p1DcList : _sdcpGame.p2DcList;
          const _sfkIdx = (_sfkDcIds || []).indexOf(_sfkMsgId);
          if (_sfkIdx >= 0 && _sfkDcList?.[_sfkIdx]) _sfkDcList[_sfkIdx].healthState = [..._sfkHS];
          _sdcpDamaged.push(`${dcMessageMeta.get(_sfkMsgId)?.displayName || _sfkFigMatch[1]} (HP: ${_shc}→${_shnc})`);
        }
        _sdcpResultLog += _sdcpDamaged.length ? _sdcpDamaged.join(', ') : 'No adjacent hostiles.';
      } else {
        _sdcpResultLog += 'No hits.';
      }
      await logGameAction(_sdcpGame, client, `**Self-Destruct Protocol** — ${_sdcpCombat?.target?.label || 'Figure'}: ${_sdcpResultLog}`, { phase: 'ROUND', icon: 'attack' });
    } else {
      await logGameAction(_sdcpGame, client, `**Self-Destruct Protocol** — Skipped. ${_sdcpCombat?.target?.label || 'Figure'} is defeated.`, { phase: 'ROUND', icon: 'card' });
    }
    // Finalize defeat by re-calling applyDamageAndFinishCombat (SDP flag already set so no re-trigger)
    await applyDamageAndFinishCombat(_sdcpGame, _sdcpCombat, {
      damage: _sdcpPending.damage, hit: _sdcpPending.hit, resultText: _sdcpPending.resultText,
      totalBlast: _sdcpPending.totalBlast, defenderPlayerNum: _sdcpPending.defenderPlayerNum,
      attackerPlayerNum: _sdcpPending.attackerPlayerNum, ownerId: _sdcpPending.ownerId,
      targetMsgId: _sdcpPending.targetMsgId, targetFigIndex: _sdcpPending.targetFigIndex,
    }, client);
    saveGames(); return;
  }

  // Behind Enemy Lines: sequential card reorder pickers
  if (buttonKey === 'bel_reorder_1_' || buttonKey === 'bel_reorder_2_') {
    const _belParts = interaction.customId.replace(buttonKey, '').split('_');
    const _belGameId = _belParts[0]; const _belCardIdx = parseInt(_belParts[1], 10);
    const _belGame = getGame(_belGameId);
    if (!_belGame || !_belGame.pendingBELReorder) { await interaction.followUp({ content: 'No pending deck reorder.', ephemeral: true }).catch(() => {}); return; }
    const _belData = _belGame.pendingBELReorder;
    if (!canActAsPlayer(_belGame, interaction.user.id, _belData.playerNum)) {
      await interaction.followUp({ content: 'Only the card owner may reorder.', ephemeral: true }).catch(() => {}); return;
    }
    if (buttonKey === 'bel_reorder_1_') {
      _belData.picked = [_belCardIdx];
      const _belRem = _belData.cards.filter((_, i) => i !== _belCardIdx);
      const _belBtns2 = _belRem.map((c, i) => {
        const _origIdx = _belData.cards.indexOf(c);
        return new ButtonBuilder().setCustomId(`bel_reorder_2_${_belGameId}_${_origIdx}`).setLabel(`2nd: ${c}`.slice(0, 80)).setStyle(ButtonStyle.Primary);
      });
      const _belHandId = _belData.playerNum === 1 ? _belGame.p1HandId : _belGame.p2HandId;
      const _belHandCh2 = await client.channels.fetch(_belHandId).catch(() => null);
      if (_belHandCh2) await _belHandCh2.send({ content: `**Behind Enemy Lines** — **${_belData.cards[_belCardIdx]}** goes 1st. Choose 2nd card:`, components: [new ActionRowBuilder().addComponents(..._belBtns2.slice(0, 5))] }).catch(() => {});
      saveGames(); return;
    }
    // bel_reorder_2_: finalize order
    const _belFirst = _belData.picked[0];
    const _belSecond = _belCardIdx;
    const _belThird = _belData.cards.findIndex((_, i) => i !== _belFirst && i !== _belSecond);
    const _belNewOrder = [_belData.cards[_belFirst], _belData.cards[_belSecond], _belData.cards[_belThird]];
    const _belDeck = _belGame[_belData.deckKey] || [];
    _belGame[_belData.deckKey] = [..._belNewOrder, ..._belDeck.slice(_belData.cards.length)];
    _belGame.pendingBELReorder = null;
    await logGameAction(_belGame, client, `**Behind Enemy Lines** — Opponent's deck top 3 reordered to: ${_belNewOrder.map(c => `**${c}**`).join(', ')}.`, { phase: 'ROUND', icon: 'card' });
    saveGames(); return;
  }

  if (buttonKey === 'status_phase_' || buttonKey === 'pass_activation_turn_' || buttonKey === 'end_turn_' || buttonKey === 'dc_end_activation_' || buttonKey === 'confirm_activate_' || buttonKey === 'cancel_activate_') {
    const activationContext = {
      getGame,
      replyIfGameEnded,
      hasActionsRemainingInGame,
      GAME_PHASES,
      PHASE_COLOR,
      getInitiativePlayerZoneLabel,
      getPlayerZoneLabel,
      logGameAction,
      pushUndo,
      updateHandChannelMessages,
      saveGames,
      client,
      dcMessageMeta,
      dcHealthState,
      buildDcEmbedAndFiles,
      getConditionsForDcMessage,
      getDcPlayAreaComponents,
      maybeShowEndActivationPhaseButton,
      dcExhaustedState,
      updateActivationsMessage,
      getActionsCounterContent,
      getDcActionButtons,
      getActivationMinimapAttachment,
      getActivateDcButtons,
      DC_ACTIONS_PER_ACTIVATION,
      ThreadAutoArchiveDuration,
      ACTION_ICONS,
      getDcStats,
    };
    if (buttonKey === 'status_phase_') await handleStatusPhase(interaction, activationContext);
    else if (buttonKey === 'pass_activation_turn_') await handlePassActivationTurn(interaction, activationContext);
    else if (buttonKey === 'end_turn_') await handleEndTurn(interaction, activationContext);
    else if (buttonKey === 'dc_end_activation_') await handleDcEndActivation(interaction, activationContext);
    else if (buttonKey === 'confirm_activate_') await handleConfirmActivate(interaction, activationContext);
    else if (buttonKey === 'cancel_activate_') await handleCancelActivate(interaction, activationContext);
    return;
  }

  if (buttonKey === 'end_end_of_round_') {
    const roundContext = {
      getGame,
      replyIfGameEnded,
      getPlayerZoneLabel,
      logGameAction,
      updateHandChannelMessages,
      saveGames,
      dcMessageMeta,
      dcExhaustedState,
      dcHealthState,
      isDepletedRemovedFromGame,
      buildDcEmbedAndFiles,
      getConditionsForDcMessage,
      getDcPlayAreaComponents,
      countTerminalsControlledByPlayer,
      isFigureInDeploymentZone,
      checkWinConditions,
      getMapTokensData,
      getSpaceController,
      getMissionRules,
      runEndOfRoundRules,
      runStartOfRoundRules,
      getFiguresOnOrAdjacentToSpace,
      runNpcThugActivation,
      runNpcKryknaActivation,
      applyNpcDamageToFigure,
      getMapSpaces,
      getMapRegistry,
      filterMapSpacesByBounds,
      getInitiativePlayerZoneLabel,
      updateHandVisualMessage,
      buildHandDisplayPayload,
      sendRoundActivationPhaseMessage,
      buildBoardMapPayload,
      postDevaronDoorButtons,
      postDevaronCratePushPrompts,
      postKryknaPushButtons,
      client,
    };
    await handleEndEndOfRound(interaction, roundContext);
    return;
  }
  if (buttonKey === 'end_start_of_round_') {
    const startOfRoundContext = {
      getGame,
      replyIfGameEnded,
      getPlayerZoneLabel,
      logGameAction,
      updateHandChannelMessages,
      saveGames,
      shouldShowEndActivationPhaseButton,
      countTerminalsControlledByPlayer,
      GAME_PHASES,
      PHASE_COLOR,
      client,
    };
    await handleEndStartOfRound(interaction, startOfRoundContext);
    return;
  }

  if (buttonKey === 'devaron_door_open_') {
    // customId: devaron_door_open_{gameId}_{a}|{b}
    const rest = interaction.customId.replace('devaron_door_open_', '');
    const pipeIdx = rest.indexOf('|');
    if (pipeIdx < 0) return;
    const beforePipe = rest.substring(0, pipeIdx);
    const afterPipe = rest.substring(pipeIdx + 1);
    const lastUnderscore = beforePipe.lastIndexOf('_');
    const gameId = beforePipe.substring(0, lastUnderscore);
    const edgeA = beforePipe.substring(lastUnderscore + 1);
    const openedEdgeKey = edgeKey(edgeA, afterPipe);
    const game = getGame(gameId);
    if (!game) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    const pending = game.pendingDoorSelections?.[0];
    if (!pending) { await interaction.followUp({ content: 'No pending door selections.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    if (!canActAsPlayer(game, interaction.user.id, pending.playerNum)) { await interaction.followUp({ content: 'Only the controlling player can select a door.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
    game.openedDoors = game.openedDoors || [];
    if (!game.openedDoors.includes(openedEdgeKey)) game.openedDoors.push(openedEdgeKey);
    const pid = pending.playerNum === 1 ? game.player1Id : game.player2Id;
    await logGameAction(game, client, `🚪 <@${pid}> opened door **${edgeA.toUpperCase()}↔${afterPipe.toUpperCase()}** (Crate Rush — terminal effect).`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
    pending.doorsRemaining--;
    if (pending.doorsRemaining <= 0) game.pendingDoorSelections.shift();
    await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    const allDoors = getMapTokensData()['devaron-garrison']?.doors || [];
    const generalCh = await client.channels.fetch(game.generalId);
    if (game.pendingDoorSelections.length > 0) {
      await postDevaronDoorButtons(game, allDoors, generalCh, gameId);
    } else {
      await postDevaronCratePushPrompts(game, generalCh, gameId);
    }
    saveGames();
    return;
  }

  if (buttonKey === 'devaron_crate_push_') {
    // customId: devaron_crate_push_{gameId}_{origCoord}
    const rest = interaction.customId.replace('devaron_crate_push_', '');
    const lastUnderscore = rest.lastIndexOf('_');
    const gameId = rest.substring(0, lastUnderscore);
    const origCoord = rest.substring(lastUnderscore + 1);
    const game = getGame(gameId);
    if (!game) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    const curCoord = String(game.cratePositions?.[origCoord] || origCoord).toLowerCase();
    const controller = getSpaceController(game, 'devaron-garrison', curCoord);
    if (!controller) { await interaction.followUp({ content: 'No one controls this crate currently.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    if (!canActAsPlayer(game, interaction.user.id, controller)) { await interaction.followUp({ content: 'Only the controlling player can push this crate.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    const modal = new ModalBuilder()
      .setCustomId(`devaron_crate_modal_${gameId}_${origCoord}`)
      .setTitle(`Push crate (at ${curCoord.toUpperCase()})`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_coord')
          .setLabel(`Target space (up to 3 spaces, e.g. K12)`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(curCoord.toUpperCase())
          .setRequired(true)
      )
    );
    await interaction.showModal(modal).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  if (buttonKey === 'krykna_push_') {
    // customId: krykna_push_{gameId}_krykna-{N}
    const rest = interaction.customId.replace('krykna_push_', '');
    const kryknaIdx = rest.indexOf('krykna-');
    if (kryknaIdx < 0) return;
    const gameId = rest.substring(0, kryknaIdx - 1);
    const kryknaId = rest.substring(kryknaIdx);
    const game = getGame(gameId);
    if (!game) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    if (!game.pendingKryknaPushQueue || game.pendingKryknaPushQueue.length === 0) {
      await interaction.followUp({ content: 'No Krykna push pending.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return;
    }
    const expectedPlayerNum = game.pendingKryknaPushQueue[0];
    if (!canActAsPlayer(game, interaction.user.id, expectedPlayerNum)) {
      await interaction.followUp({ content: `It's Player ${expectedPlayerNum}'s turn to push a Krykna.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return;
    }
    const krykna = (game.npcKrykna || []).find((k) => k.id === kryknaId);
    if (!krykna || krykna.defeated) { await interaction.followUp({ content: 'Krykna not found or already defeated.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
    const modal = new ModalBuilder()
      .setCustomId(`krykna_push_modal_${gameId}_${kryknaId}`)
      .setTitle(`Push ${kryknaId} (at ${String(krykna.coord).toUpperCase()})`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_coord')
          .setLabel(`Target space (up to 3 spaces from ${String(krykna.coord).toUpperCase()})`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(String(krykna.coord).toUpperCase())
          .setRequired(true)
      )
    );
    await interaction.showModal(modal).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  if (buttonKey === 'map_selection_' || buttonKey === 'draft_random_' || buttonKey === 'determine_initiative_' || buttonKey === 'deployment_zone_red_' || buttonKey === 'deployment_zone_blue_' || buttonKey === 'deployment_fig_' || buttonKey === 'deployment_orient_' || buttonKey === 'deploy_pick_' || buttonKey === 'deployment_done_') {
    const setupContext = {
      getGame,
      getPlayReadyMaps,
      getMapSelectionMenu,
      postMissionCardAfterMapSelection,
      postPinnedMissionCardFromGameState,
      buildBoardMapPayload,
      logGameAction,
      getGeneralSetupButtons,
      createPlayAreaChannels,
      createBoardChannel,
      createHandThreads,
      getHandTooltipEmbed,
      getHandSquadButtons,
      runDraftRandom,
      logGameErrorToBotLogs,
      extractGameIdFromInteraction,
      clearPreGameSetup,
      getDeploymentZoneButtons,
      getDeploymentZones,
      getDeployFigureLabels,
      getDeployButtonRows,
      getDeploymentMapAttachment,
      getFigureSize,
      getFootprintCells,
      filterValidTopLeftSpaces,
      getDeploySpaceGridRows,
      pushUndo,
      updateDeployPromptMessages,
      getInitiativePlayerZoneLabel,
      getCcShuffleDrawButton,
      client,
      saveGames,
      isDcAttachment,
      resolveDcName,
      isFigurelessDc,
      finishSetupAttachments,
    };
    if (buttonKey === 'map_selection_') await handleMapSelection(interaction, setupContext);
    else if (buttonKey === 'draft_random_') await handleDraftRandom(interaction, setupContext);
    else if (buttonKey === 'determine_initiative_') await handleDetermineInitiative(interaction, setupContext);
    else if (buttonKey === 'deployment_zone_red_' || buttonKey === 'deployment_zone_blue_') await handleDeploymentZone(interaction, setupContext);
    else if (buttonKey === 'deployment_fig_') await handleDeploymentFig(interaction, setupContext);
    else if (buttonKey === 'deployment_orient_') await handleDeploymentOrient(interaction, setupContext);
    else if (buttonKey === 'deploy_pick_') await handleDeployPick(interaction, setupContext);
    else if (buttonKey === 'deployment_done_') await handleDeploymentDone(interaction, setupContext);
    return;
  }

  if (buttonKey === 'interact_cancel_') {
    await handleInteractCancel(interaction, { getGame, dcMessageMeta });
    return;
  }
  if (buttonKey === 'interact_choice_') {
    const interactContext = {
      getGame,
      dcMessageMeta,
      getLegalInteractOptions,
      getDcStats,
      updateDcActionsMessage,
      logGameAction,
      sendBleedingPrompt,
      saveGames,
      pushUndo,
      getMissionTokenLabel,
    };
    await handleInteractChoice(interaction, interactContext);
    return;
  }

  if (buttonKey === 'refresh_map_') {
    const gameToolsContext = { getGame, buildBoardMapPayload, logGameErrorToBotLogs, client };
    await handleRefreshMap(interaction, gameToolsContext);
    return;
  }
  if (buttonKey === 'refresh_all_') {
    const gameToolsContext = { getGame, refreshAllGameComponents, logGameErrorToBotLogs, client };
    await handleRefreshAll(interaction, gameToolsContext);
    return;
  }

  if (buttonKey === 'undo_') {
    const gameToolsContext = {
      getGame,
      saveGames,
      updateMovementBankMessage,
      buildBoardMapPayload,
      logGameAction,
      updateDeployPromptMessages,
      updateDcActionsMessage,
      updateHandVisualMessage,
      updateDiscardPileMessage,
      updateAttachmentMessageForDc,
      client,
    };
    await handleUndo(interaction, gameToolsContext);
    return;
  }

  if (buttonKey.startsWith('botmenu_')) {
    const botmenuContext = {
      getGame,
      deleteGame,
      saveGames,
      dcMessageMeta,
      dcExhaustedState,
      dcDepletedState,
      dcHealthState,
      logGameErrorToBotLogs,
      client,
      deleteGameFromDb,
    };
    if (buttonKey === 'botmenu_archive_') await handleBotmenuArchive(interaction, botmenuContext);
    else if (buttonKey === 'botmenu_kill_') await handleBotmenuKill(interaction, botmenuContext);
    else if (buttonKey === 'botmenu_archive_yes_') await handleBotmenuArchiveYes(interaction, botmenuContext);
    else if (buttonKey === 'botmenu_archive_no_') await handleBotmenuArchiveNo(interaction, botmenuContext);
    else if (buttonKey === 'botmenu_kill_yes_') await handleBotmenuKillYes(interaction, botmenuContext);
    else if (buttonKey === 'botmenu_kill_no_') await handleBotmenuKillNo(interaction, botmenuContext);
    return;
  }

  if (buttonKey === 'fast_forward_') {
    const fastForwardContext = {
      getGame,
      saveGames,
      client,
      dcExhaustedState,
      dcHealthState,
      dcMessageMeta,
      buildDcEmbedAndFiles,
      getConditionsForDcMessage,
      getDcPlayAreaComponents,
      getDcActionButtons,
      getActionsCounterContent,
      getActivationMinimapAttachment,
      updateActivationsMessage,
      DC_ACTIONS_PER_ACTIVATION,
      logGameAction,
      getCcEffect,
      resolveAbility,
      updateHandVisualMessage,
      updateDiscardPileMessage,
    };
    await handleFastForward(interaction, fastForwardContext);
    return;
  }

  if (buttonKey === 'dc_cc_defender_') {
    const defenderCcContext = {
      getGame,
      saveGames,
      client,
      dcMessageMeta,
      getCcEffect,
      resolveAbility,
      logGameAction,
      updateHandVisualMessage,
      updateDiscardPileMessage,
    };
    await handleDefenderCcPlay(interaction, defenderCcContext);
    return;
  }

  if (buttonKey === 'kill_game_') {
    const gameToolsContext = {
      getGame,
      deleteGame,
      saveGames,
      dcMessageMeta,
      dcExhaustedState,
      dcDepletedState,
      dcHealthState,
      logGameErrorToBotLogs,
      client,
      deleteGameFromDb,
    };
    await handleKillGame(interaction, gameToolsContext);
    return;
  }
  if (buttonKey === 'default_deck_') {
    const gameToolsContext = {
      getGame,
      applySquadSubmission,
      logGameErrorToBotLogs,
      DEFAULT_DECK_REBELS,
      DEFAULT_DECK_SCUM,
      DEFAULT_DECK_IMPERIAL,
      client,
    };
    await handleDefaultDeck(interaction, gameToolsContext);
    return;
  }

  if (buttonKey === 'lobby_join_') {
    const lobbyContext = {
      getGame,
      setGame,
      lobbies: getLobbiesMap(),
      countActiveGamesForPlayer,
      MAX_ACTIVE_GAMES_PER_PLAYER,
      getLobbyEmbed,
      getLobbyStartButton,
      updateThreadName,
    };
    await handleLobbyJoin(interaction, lobbyContext);
    return;
  }

  if (buttonKey === 'lobby_start_') {
    const lobbyContext = {
      setGame,
      lobbies: getLobbiesMap(),
      countActiveGamesForPlayer,
      MAX_ACTIVE_GAMES_PER_PLAYER,
      createGameChannels,
      getGeneralSetupButtons,
      logGameErrorToBotLogs,
      updateThreadName,
      EmbedBuilder,
    };
    await handleLobbyStart(interaction, lobbyContext);
    return;
  }

  if (buttonKey === 'create_game') {
    await interaction.followUp({
      content: 'Go to **#new-games** and click **Create Post** to start a lobby. The bot will add the Join Game button.',
      components: [getMainMenu()],
      ephemeral: true,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (buttonKey === 'join_game') {
    await interaction.followUp({
      content: 'Browse **#new-games** and click **Join Game** on a lobby post that needs an opponent.',
      components: [getMainMenu()],
      ephemeral: true,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

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
