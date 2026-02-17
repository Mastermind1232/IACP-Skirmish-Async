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
  getAffiliationWinRates,
  getDcWinRates,
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
import { MAX_ACTIVE_GAMES_PER_PLAYER, PENDING_ILLEGAL_TTL_MS } from './src/constants.js';
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
  handleAttackTarget,
  handleCleaveTarget,
  handleCombatReady,
  handleCombatResolveReady,
  handleCombatRoll,
  handleCombatSurge,
  handleStatusPhase,
  handlePassActivationTurn,
  handleEndTurn,
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
  handleDcAction,
  handleSquadModal,
  handleDeployModal,
  handleCcAttachTo,
  handleCcPlaySelect,
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
  getDcActionButtons as getDcActionButtonsFromDiscord,
  getActivateDcButtons as getActivateDcButtonsFromDiscord,
} from './src/discord/index.js';
import {
  reloadGameData,
  getDcImages,
  getFigureImages,
  getFigureSizes,
  getFigureSize,
  getDcStats as getDcStatsMap,
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
} from './src/data-loader.js';
import { runEndOfRoundRules, runStartOfRoundRules } from './src/game/mission-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname);

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
      await msg.delete().catch(() => {});
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

/** True if this DC can legally play this CC (for Special Action timing). playableBy: "Any Figure", specific name, or trait. */
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
  const p = playableBy.toLowerCase();
  const d = dcBase.toLowerCase();
  const disp = displayBase.toLowerCase();
  if (d.includes(p) || p.includes(d) || disp.includes(p) || p.includes(disp)) return true;
  const keywords = getDcKeywords()[dcName] || getDcKeywords()[dcBase];
  if (keywords && Array.isArray(keywords) && keywords.some((k) => String(k).toLowerCase() === p)) return true;
  return false;
}

/** CC names in hand that are Special Action and legally playable by this DC. */
function getPlayableCcSpecialsForDc(game, playerNum, dcName, displayName) {
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  return hand.filter((ccName) => isCcPlayableByDc(ccName, dcName, displayName));
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

/** Mission B: True if figure is adjacent to or on a contraband space. */
function isFigureAdjacentOrOnContraband(game, playerNum, figureKey, mapId) {
  if (game?.selectedMission?.variant !== 'b') return false;
  const mapData = getMapTokensData()[mapId];
  const contraband = mapData?.missionB?.contraband || mapData?.missionB?.crates || [];
  if (!contraband.length) return false;
  const rawMapSpaces = getMapSpaces(mapId);
  if (!rawMapSpaces?.adjacency) return false;
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(rawMapSpaces, mapDef?.gridBounds);
  const adjacency = mapSpaces.adjacency || {};
  const contrabandSet = toLowerSet(contraband);
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return false;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const footprint = getFootprintCells(pos, game.figureOrientations?.[figureKey] || getFigureSize(dcName));
  for (const c of footprint) {
    const n = normalizeCoord(c);
    if (contrabandSet.has(n)) return true;
    for (const adj of adjacency[n] || []) {
      if (contrabandSet.has(normalizeCoord(adj))) return true;
    }
  }
  return false;
}

/** Mission B: Effective speed (base - 2 when carrying contraband). */
function getEffectiveSpeed(dcName, figureKey, game) {
  const base = getDcStats(dcName).speed ?? 4;
  if (game?.selectedMission?.variant !== 'b') return base;
  if (game.figureContraband?.[figureKey]) return Math.max(0, base - 2);
  return base;
}

/** Mission B: True if figure is in player's deployment zone. */
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

/** Returns legal interact options for a figure. Mission-specific first (blue), standard (grey). */
function getLegalInteractOptions(game, playerNum, figureKey, mapId) {
  const options = [];
  const mapData = getMapTokensData()[mapId];
  if (!mapData) return options;

  const variant = game?.selectedMission?.variant;

  if (variant === 'b') {
    if (!game.figureContraband?.[figureKey] && isFigureAdjacentOrOnContraband(game, playerNum, figureKey, mapId)) {
      options.push({ id: 'retrieve_contraband', label: 'Retrieve Contraband', missionSpecific: true });
    }
  }

  if (variant === 'a') {
    const launchPanels = mapData.missionA?.launchPanels || [];
    const flippedThisRound = playerNum === 1 ? game.p1LaunchPanelFlippedThisRound : game.p2LaunchPanelFlippedThisRound;
    if (launchPanels.length && !flippedThisRound) {
      const panelSet = toLowerSet(launchPanels);
      const adjacent = getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, panelSet);
      for (const coord of adjacent) {
        const upper = String(coord).toUpperCase();
        options.push({ id: `launch_panel_${coord}_colored`, label: `Launch Panel (${upper}) → Colored`, missionSpecific: true });
        options.push({ id: `launch_panel_${coord}_gray`, label: `Launch Panel (${upper}) → Gray`, missionSpecific: true });
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

/** Line-of-sight: true if no blocking terrain or solid walls on line. Dotted red (movementBlockingEdges) do NOT block LOS. */
function hasLineOfSight(coord1, coord2, mapSpaces) {
  const blocking = new Set((mapSpaces?.blocking || []).map((s) => String(s).toLowerCase()));
  const impSet = new Set((mapSpaces?.impassableEdges || []).map((e) => edgeKey(e[0], e[1])));
  const a = parseCoord(coord1);
  const b = parseCoord(coord2);
  if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) return false;
  const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row), 1);
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const col = Math.round(a.col + t * (b.col - a.col));
    const row = Math.round(a.row + t * (b.row - a.row));
    const c = colRowToCoord(col, row);
    if (blocking.has(c)) return false;
    if (prev && prev !== c) {
      const p = parseCoord(prev);
      const dc = Math.abs(col - p.col), dr = Math.abs(row - p.row);
      if (dc === 1 && dr === 0 && impSet.has(edgeKey(prev, c))) return false;
      if (dc === 0 && dr === 1 && impSet.has(edgeKey(prev, c))) return false;
      if (dc === 1 && dr === 1) {
        const mid1 = colRowToCoord(p.col, row);
        const mid2 = colRowToCoord(col, p.row);
        if (impSet.has(edgeKey(prev, mid1)) || impSet.has(edgeKey(prev, mid2))) return false;
      }
    }
    prev = c;
  }
  return true;
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
      if (msg) await msg.delete().catch(() => {});
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

/** Pick a random scenario with status "testready" and implemented in runDraftRandom. Returns scenario id or null. */
function getRandomTestreadyScenario() {
  try {
    const path = join(rootDir, 'data', 'test-scenarios.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const scenarios = data.scenarios || {};
    const testready = Object.entries(scenarios).filter(
      ([id, s]) => s && s.status === 'testready' && IMPLEMENTED_SCENARIOS.includes(id)
    );
    if (testready.length === 0) return null;
    return testready[Math.floor(Math.random() * testready.length)][0];
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

/** Sample DCs per affiliation for testready — 2 DCs, 1–2 groups. Includes Trooper/Technician for CCs like Smoke Grenade. */
const TESTREADY_SAMPLE_DCS = {
  rebel: {
    troopers: ['Rebel Trooper (Elite)', 'Rebel Trooper (Regular)'],
    others: ['Wookiee Warrior (Elite)', 'Luke Skywalker'],
  },
  scum: {
    troopers: ['Hired Gun (Elite)'],
    technicians: ['Ugnaught Tinkerer (Elite)'],
    others: ['Nexu (Elite)', 'Trandoshan Hunter (Elite)', 'Boba Fett'],
  },
};

/** Scenario requirements: playableBy traits needed for P1 (e.g. smoke_grenade needs TROOPER or TECHNICIAN). */
const TESTREADY_SCENARIO_DC_REQUIREMENTS = {
  smoke_grenade: ['troopers', 'technicians'],
};

function buildTestreadyDeck(affiliation, scenarioId, baseCcList) {
  const samples = TESTREADY_SAMPLE_DCS[affiliation];
  if (!samples) return null;
  const required = TESTREADY_SCENARIO_DC_REQUIREMENTS[scenarioId];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const all = [...(samples.troopers || []), ...(samples.technicians || []), ...(samples.others || [])];

  let dc1;
  if (required && affiliation === 'rebel') {
    const eligibles = [...(samples.troopers || []), ...(samples.technicians || [])];
    if (eligibles.length > 0) dc1 = pick(eligibles);
  }
  if (!dc1) dc1 = pick(all);

  const rest = all.filter((d) => d !== dc1);
  const dc2 = rest.length > 0 ? pick(rest) : dc1;

  const dcList = [dc1, dc2];
  const name = affiliation === 'rebel' ? 'Testready Rebels' : 'Testready Scum';
  return {
    name,
    dcList,
    ccList: [...(baseCcList || [])],
    dcCount: dcList.length,
    ccCount: (baseCcList || []).length,
  };
}

const DEFAULT_DECK_IMPERIAL = {
  name: 'Default Imperial',
  dcList: ['Darth Vader', 'Emperor Palpatine', 'Stormtrooper (Elite)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Lightning', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
  dcCount: 3,
  ccCount: 15,
};

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
  const candidates = [];
  if (cardName.trim().toLowerCase() === 'smoke grenade') {
    candidates.push('Smoke Grenade Final.png', '003 Smoke Grenade Final.png');
  }
  candidates.push(
    `C card--${cardName}.jpg`,
    `C card--${cardName}.png`,
    `IACP_C card--${cardName}.png`,
    `IACP_C card--${cardName}.jpg`,
    `IACP9_C card--${cardName}.png`,
    `IACP9_C card--${cardName}.jpg`,
    `IACP10_C card--${cardName}.png`,
    `IACP10_C card--${cardName}.jpg`,
    `IACP11_C card--${cardName}.png`,
    `IACP11_C card--${cardName}.jpg`
  );
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

/** Create p1 and p2 Hand channels (called when map is selected). */
async function createHandChannels(guild, gameCategory, prefix, player1Id, player2Id) {
  const p1Only = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel },
    { id: guild.client.user.id, allow: PermissionFlagsBits.ViewChannel },
  ];
  const p2Only = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel },
    { id: guild.client.user.id, allow: PermissionFlagsBits.ViewChannel },
  ];
  const p1 = await guild.channels.create({
    name: `${prefix} p1-hand`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: p1Only,
  });
  const p2 = await guild.channels.create({
    name: `${prefix} p2-hand`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: p2Only,
  });
  return { p1HandChannel: p1, p2HandChannel: p2 };
}

/** Create p1 and p2 Play Area channels (called when both squads are ready). */
async function createPlayAreaChannels(guild, gameCategory, prefix, player1Id, player2Id) {
  const playAreaPerms = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: guild.client.user.id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.ManageThreads },
  ];
  const p1 = await guild.channels.create({
    name: `${prefix} p1-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  const p2 = await guild.channels.create({
    name: `${prefix} p2-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  return { p1PlayAreaChannel: p1, p2PlayAreaChannel: p2 };
}

async function createGameChannels(guild, player1Id, player2Id, options = {}) {
  const { createPlayAreas = false, createHandChannels = false } = options;
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

  const p1Only = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel },
    { id: botId, allow: PermissionFlagsBits.ViewChannel },
  ];
  const p2Only = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel },
    { id: botId, allow: PermissionFlagsBits.ViewChannel },
  ];
  // Play Area: both players can view, but only bot can send (static channel; DCs get threads)
  const playAreaPerms = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: botId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.ManageThreads },
  ];

  const chatChannel = await guild.channels.create({
    name: `${prefix} General chat`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playerPerms,
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
  const boardChannel = await guild.channels.create({
    name: `${prefix} Board`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playerPerms,
  });
  let p1HandChannel = null;
  let p2HandChannel = null;
  if (createHandChannels) {
    p1HandChannel = await guild.channels.create({
      name: `${prefix} p1-hand`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: p1Only,
    });
    p2HandChannel = await guild.channels.create({
      name: `${prefix} p2-hand`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: p2Only,
    });
  }
  let p1PlayAreaChannel = null;
  let p2PlayAreaChannel = null;
  if (createPlayAreas) {
    p1PlayAreaChannel = await guild.channels.create({
      name: `${prefix} p1-play-area`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: playAreaPerms,
    });
    p2PlayAreaChannel = await guild.channels.create({
      name: `${prefix} p2-play-area`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: playAreaPerms,
    });
  }

  return { gameCategory, gameId, generalChannel, chatChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel };
}

/**
 * Create a test game (shared by #lfg message handler and HTTP POST /testgame).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {string} userId - Discord user ID (P1 and P2 for test)
 * @param {string|null} scenarioId - e.g. 'smoke_grenade'
 * @param {import('discord.js').TextChannel} feedbackChannel - where to send "Test game #X created" (or editMessageInstead)
 * @param {{ editMessageInstead?: import('discord.js').Message }} [options] - if set, edit this message on success instead of sending new
 * @returns {Promise<{ gameId: string }>}
 */
const IMPLEMENTED_SCENARIOS = ['smoke_grenade'];

async function createTestGame(client, guild, userId, scenarioId, feedbackChannel, options = {}) {
  if (testGameCreationInProgress.has(userId)) {
    throw new Error('A test game is already being created. Please wait.');
  }
  if (countActiveGamesForPlayer(userId) >= MAX_ACTIVE_GAMES_PER_PLAYER) {
    throw new Error(`You are already in **${MAX_ACTIVE_GAMES_PER_PLAYER}** active games. Finish or leave a game before creating another.`);
  }
  testGameCreationInProgress.add(userId);
  try {
    const { gameId, generalChannel, chatChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel } =
      await createGameChannels(guild, userId, userId, { createPlayAreas: false, createHandChannels: false });
    const game = {
      gameId,
      version: CURRENT_GAME_VERSION,
      gameCategoryId: generalChannel.parentId,
      player1Id: userId,
      player2Id: userId,
      generalId: generalChannel.id,
      chatId: chatChannel.id,
      boardId: boardChannel.id,
      p1HandId: p1HandChannel?.id ?? null,
      p2HandId: p2HandChannel?.id ?? null,
      p1PlayAreaId: p1PlayAreaChannel?.id ?? null,
      p2PlayAreaId: p2PlayAreaChannel?.id ?? null,
      player1Squad: null,
      player2Squad: null,
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },
      isTestGame: true,
      testScenario: scenarioId || undefined,
      ended: false,
    };
    setGame(gameId, game);

    const scenarioImplemented = scenarioId && IMPLEMENTED_SCENARIOS.includes(scenarioId);
    if (scenarioImplemented) {
      // Apply scenario: run full setup (map, decks, deploy, draw) — user goes straight to test point
      await runDraftRandom(game, client, { scenarioId });
      const scenarioDoneText = scenarioId === 'smoke_grenade'
        ? `Test game **IA Game #${gameId}** ready! Go to **Game Log** for Round 1. Your **Hand channel** has Smoke Grenade — activate a DC, then play it to test pick-a-space.`
        : `Test game **IA Game #${gameId}** ready! Go to **Game Log** for Round 1. Scenario: **${scenarioId}**.`;
      if (options.editMessageInstead) {
        await options.editMessageInstead.edit(scenarioDoneText).catch(() => {});
      } else {
        await feedbackChannel.send({
          content: `<@${userId}> — ${scenarioDoneText}`,
          allowedMentions: { users: [userId] },
        }).catch(() => {});
      }
    } else {
      // No scenario (or unimplemented scenario): show map selection as usual
      const setupMsg = await generalChannel.send({
        content: `<@${userId}> — **Test game** created. You are both players. Map Selection below — Hand channels will appear after map selection. Use **General chat** for notes.`,
        allowedMentions: { users: [userId] },
        embeds: [
          new EmbedBuilder()
            .setTitle('Game Setup (Test)')
            .setDescription('**Test game** — Select the map below. Hand channels will then appear; use them to pick decks (Select Squad or Default Rebels / Scum / Imperial) for each "side".')
            .setColor(0x2f3136),
        ],
        components: [getGeneralSetupButtons(game)],
      });
      game.generalSetupMessageId = setupMsg.id;
      const doneText = scenarioId && !scenarioImplemented
        ? `Scenario **${scenarioId}** is not yet implemented. Test game **IA Game #${gameId}** created with standard setup — select the map in Game Log.`
        : `Test game **IA Game #${gameId}** is ready! Select the map in Game Log — Hand channels will appear after map selection.`;
      if (options.editMessageInstead) {
        await options.editMessageInstead.edit(doneText).catch(() => {});
      } else {
        await feedbackChannel.send({
          content: `<@${userId}> — ${doneText}`,
          allowedMentions: { users: [userId] },
        }).catch(() => {});
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
  game.selectedMission = { variant, name: mission.name, fullName };
  await postPinnedMissionCardFromGameState(game, client);
}

/** Post mission card when game.selectedMission and game.selectedMap are already set (e.g. Competitive). */
async function postPinnedMissionCardFromGameState(game, client) {
  const mission = game.selectedMission;
  const map = game.selectedMap;
  if (!mission || !map) return;
  const fullName = mission.fullName || `${map.name || map.id} — ${mission.name}`;
  const missionData = getMissionCardsData()[map.id]?.[mission.variant];
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
      sentMsg = await ch.send({ content: `🎯 **Mission:** ${fullName}` });
    }
    await sentMsg.pin().catch(() => {});
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
        const key = Object.keys(getDcStatsMap() || {}).find(
          (k) => k.toLowerCase().startsWith(base.toLowerCase() + ' ') || k.toLowerCase() === base.toLowerCase()
        );
        if (key) figureCount = getDcStatsMap()[key]?.figures ?? figureCount;
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
      figures.push({
        coord: space,
        color,
        imagePath: imagePath || undefined,
        dcName,
        figureSize,
        label,
        figureKey,
        powerTokens,
      });
    }
  }
  return figures;
}

/** Get map tokens (terminals + mission-specific + closed doors) for renderMap. */
function getMapTokensForRender(mapId, missionVariant, openedDoors = []) {
  const mapData = getMapTokensData()[mapId];
  if (!mapData) return { terminals: [], missionA: [], missionB: [], doors: [] };
  const terminals = mapData.terminals || [];
  const missionA = mapData.missionA?.launchPanels || [];
  const missionB = mapData.missionB?.contraband || mapData.missionB?.crates || [];
  const doorEdges = mapData.doors || [];
  const openedSet = new Set((openedDoors || []).map((k) => String(k).toLowerCase()));
  const doors = doorEdges.filter((edge) => {
    if (!edge || edge.length < 2) return false;
    const ek = edgeKey(edge[0], edge[1]);
    return !openedSet.has(ek);
  });
  return {
    terminals,
    missionA: missionVariant === 'a' ? missionA : [],
    missionB: missionVariant === 'b' ? missionB : [],
    doors,
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
  const speed = getEffectiveSpeed(dcName, figureKey, game);
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
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors);
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
  const speed = getEffectiveSpeed(dcName, figureKey, game);
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
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors);
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
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors);
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
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors);
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

/** Check win conditions. Returns { ended, winnerId?, reason? }. Posts game-over and sets game.ended if ended. */
async function checkWinConditions(game, client) {
  const vp1 = game.player1VP?.total ?? 0;
  const vp2 = game.player2VP?.total ?? 0;
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

async function postGameOver(game, client, winnerId, reason) {
  game.ended = true;
  game.winnerId = winnerId ?? game.winnerId ?? null;
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
  }
  saveGames();
}

/** Returns true if game ended (and replied to user). Call after getGame() in handlers to block further actions. */
async function replyIfGameEnded(game, interaction) {
  if (game?.ended) {
    await interaction.reply({ content: 'This game has ended.', ephemeral: true }).catch(() => {});
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
      const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, displayName, healthState, getConditionsForDcMessage(game, meta));
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
  const components = [getBoardButtons(gameId, { game })];
  const embeds = game ? [buildScorecardEmbed(game)] : [];
  const figures = game ? getFiguresForRender(game) : [];
  const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors);
  const hasFigures = figures.length > 0;
  const hasTokens = tokens.terminals?.length > 0 || tokens.missionA?.length > 0 || tokens.missionB?.length > 0 || tokens.doors?.length > 0;
  const resolvedMapPath = map.imagePath ? resolveAssetPath(map.imagePath, 'maps') : null;
  const imagePath = resolvedMapPath ? join(rootDir, resolvedMapPath) : null;
  const pdfPath = join(rootDir, 'data', 'map-pdfs', `${map.id}.pdf`);

  const allowedMentions = game ? { users: [...new Set([game.player1Id, game.player2Id])] } : undefined;
  if ((hasFigures || hasTokens) && imagePath && existsSync(imagePath)) {
    try {
      const buffer = await renderMap(map.id, { figures, tokens, showGrid: false, maxWidth: 1200 });
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
  const deployContent = `<@${game.initiativePlayerId}> (${getInitiativePlayerZoneLabel(game)}**Player ${initPlayerNum}**) **Both players have deployed.** Both players: draw your starting hands in your Hand channel. Round 1 will begin when both have drawn.`;
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
    if (game.boardId) {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, map, game);
      await boardChannel.send(payload);
    }
    await logGameAction(game, client, `Map selected: **${map.name}** — View in Board channel.`, { phase: 'SETUP', icon: 'map' });
  }

  // Hand channels
  if (!game.p1HandId || !game.p2HandId) {
    const guild = generalChannel.guild;
    const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
    const prefix = `IA${game.gameId}`;
    const { p1HandChannel, p2HandChannel } = await createHandChannels(
      guild, gameCategory, prefix, game.player1Id, game.player2Id
    );
    game.p1HandId = p1HandChannel.id;
    game.p2HandId = p2HandChannel.id;
  }

  // One side Rebels, one side Scum. Testready: 2 sample DCs per player (1-2 groups, different affiliations), scenario-aware (e.g. smoke_grenade needs Trooper/Technician)
  let p1Deck;
  let p2Deck;
  if (scenarioId) {
    const p1Cc = scenarioId === 'smoke_grenade'
      ? (() => {
          const cc = [...(DEFAULT_DECK_REBELS.ccList || [])];
          const idx = cc.findIndex((c) => c === 'Force Push');
          if (idx >= 0) cc[idx] = 'Smoke Grenade';
          else cc[0] = 'Smoke Grenade';
          return cc;
        })()
      : (DEFAULT_DECK_REBELS.ccList || []);
    p1Deck = buildTestreadyDeck('rebel', scenarioId, p1Cc) || { ...DEFAULT_DECK_REBELS };
    p2Deck = buildTestreadyDeck('scum', scenarioId, DEFAULT_DECK_SCUM.ccList || []) || { ...DEFAULT_DECK_SCUM };
  } else {
    p1Deck = { ...DEFAULT_DECK_REBELS };
    p2Deck = { ...DEFAULT_DECK_SCUM };
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

  const deployForPlayer = (playerNum, zone) => {
    const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
    const dcList = squad?.dcList || [];
    const { metadata } = getDeployFigureLabels(dcList);
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
      const space = validSpaces[Math.floor(Math.random() * validSpaces.length)];
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
  deployForPlayer(initiativePlayerNum, zone);
  deployForPlayer(nonInitiativePlayerNum, otherZone);

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
    if (scenarioId === 'smoke_grenade' && playerNum === 1 && !hand.includes('Smoke Grenade')) {
      const replaced = hand[0];
      hand = ['Smoke Grenade', hand[1], hand[2]].filter(Boolean);
      if (replaced) deck.push(replaced);
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

/** F14: Push one undo step. No cap on stack size so undo works after bot restart. */
function pushUndo(game, entry) {
  game.undoStack = game.undoStack || [];
  game.undoStack.push({ ...entry, ts: Date.now() });
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

/**
 * Get size trait (SMALL | LARGE | MASSIVE) for effects (command cards, abilities).
 * Rule: if a DC does not explicitly have LARGE or MASSIVE, it is SMALL.
 * Explicit: dc-keywords "Massive"/"Large" OR footprint from figure-sizes (1x2/2x2→LARGE, 2x3→MASSIVE).
 * Default: SMALL (unknown DCs, 1x1 footprint).
 */
function getFigureSizeTrait(dcName) {
  const keywords = getMovementKeywords(dcName);
  if (keywords.has('massive')) return 'MASSIVE';
  if (keywords.has('large')) return 'LARGE';
  const footprint = getFigureSize(dcName) || '1x1';
  const [cols, rows] = String(footprint).toLowerCase().split('x').map((n) => parseInt(n, 10) || 1);
  const c = cols || 1;
  const r = rows || 1;
  if (c === 2 && r === 3) return 'MASSIVE';
  if (c === 3 && r === 2) return 'MASSIVE';
  if (c === 1 && r === 2) return 'LARGE';
  if (c === 2 && r === 1) return 'LARGE';
  if (c === 2 && r === 2) return 'LARGE';
  return 'SMALL';
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
  const { hit, damage, resultText } = computeCombatResult(combat);
  const totalBlast = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
  const attackerPlayerNum = combat.attackerPlayerNum;
  const ownerId = attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
  const targetMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, combat.target.figureKey);
  const tm = combat.target.figureKey.match(/-(\d+)-(\d+)$/);
  const targetFigIndex = tm ? parseInt(tm[2], 10) : 0;

  const thread = await client.channels.fetch(combat.combatThreadId);
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
      if (newCur <= 0) {
        // F7: Keep healthState, figurePositions, and DC embed in sync when one figure in a group dies.
        if (game.figurePositions?.[defenderPlayerNum]) delete game.figurePositions[defenderPlayerNum][combat.target.figureKey];
        const { cost, subCost, figures } = combat.targetStats;
        const vp = (figures > 1 && subCost != null) ? subCost : (cost ?? 5);
        const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
        game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
        game[vpKey].kills += vp;
        game[vpKey].total += vp;
        resultText += ` — **${combat.target.label} defeated!** +${vp} VP`;
        await logGameAction(game, client, `<@${ownerId}> defeated **${combat.target.label}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
        if (idx >= 0 && isGroupDefeated(game, defenderPlayerNum, idx)) {
          const activatedIndices = defenderPlayerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
          if (!activatedIndices.includes(idx)) {
            if (defenderPlayerNum === 1) game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining ?? 0) - 1);
            else game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining ?? 0) - 1);
            await updateActivationsMessage(game, defenderPlayerNum, client);
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
          }).catch(() => {});
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
    if (totalBlast > 0 && hit && game.selectedMap?.id) {
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
          }
          await checkWinConditions(game, client);
          const blastDefeatedDcName = blastDcList[blastIdx]?.dcName;
          if (!game.pendingCelebration && isDcUnique(blastDefeatedDcName)) {
            game.pendingCelebration = { attackerPlayerNum, combatThreadId: combat.combatThreadId };
            await thread.send({
              content: `<@${ownerId}> — You defeated a unique figure (Blast). Play **Celebration** to gain 4 VP?`,
              components: [getCelebrationButtons(game.gameId)],
              allowedMentions: { users: [ownerId] },
            }).catch(() => {});
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
  const embedRefreshMsgIds = new Set(damage > 0 && targetMsgId ? [targetMsgId] : []);
  if (combat.surgeRecover > 0 && combat.attackerMsgId != null) embedRefreshMsgIds.add(combat.attackerMsgId);
  if (totalBlast > 0 && hit && game.selectedMap?.id) {
    const blastAdjacent = getFiguresAdjacentToTarget(game, combat.target.figureKey, game.selectedMap.id);
    for (const { figureKey: bk, playerNum: bp } of blastAdjacent) {
      const mid = findDcMessageIdForFigure(game.gameId, bp, bk);
      if (mid) embedRefreshMsgIds.add(mid);
    }
  }
  // F6 Cleave: attacker may choose one other figure in melee (adjacent to attacker) to apply cleave damage
  if (hit && (combat.surgeCleave || 0) > 0 && game.selectedMap?.id) {
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
          surgeCleave: combat.surgeCleave || 0,
          attackerPlayerNum,
          ownerId,
          targets: targetsWithLabels,
          resultText,
          combat,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        };
        const cleaveRows = getCleaveTargetButtons(game.gameId, targetsWithLabels);
        await thread.send({
          content: `**Cleave (${combat.surgeCleave} damage):** <@${ownerId}> — Choose one target in melee to apply cleave damage:`,
          allowedMentions: { users: [ownerId] },
          components: cleaveRows,
        });
        return;
      }
    }
  }
  await finishCombatResolution(game, combat, resultText, embedRefreshMsgIds, client);
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
  delete game.pendingCombat;
  delete game.pendingCleave;
  if (combat.rollMessageId) {
    try {
      const rollMsg = await thread.messages.fetch(combat.rollMessageId);
      await rollMsg.edit({ components: [] }).catch(() => {});
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
        const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, meta.displayName, healthState, getConditionsForDcMessage(game, meta));
        await dcMsg.edit({ embeds: [embed], files }).catch(() => {});
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
  const map = getDcStatsMap();
  const exact = map[dcName];
  if (exact) return { ...exact, figures: isFigurelessDc(dcName) ? 0 : (exact.figures ?? 1) };
  const lower = dcName?.toLowerCase?.() || '';
  const key = Object.keys(map).find((k) => k.toLowerCase() === lower);
  if (key) {
    const base = map[key];
    return { ...base, figures: isFigurelessDc(dcName) ? 0 : (base.figures ?? 1) };
  }
  return { health: null, figures: isFigurelessDc(dcName) ? 0 : 1, specials: [] };
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
  const p1Terminals = game.selectedMap?.id ? countTerminalsControlledByPlayer(game, 1, game.selectedMap.id) : 0;
  const p2Terminals = game.selectedMap?.id ? countTerminalsControlledByPlayer(game, 2, game.selectedMap.id) : 0;
  const drawRule = (p1Terminals > 0 || p2Terminals > 0)
    ? 'Draw 1 CC (+1 per controlled terminal). '
    : 'Draw 1 CC. ';
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const initZone = getInitiativePlayerZoneLabel(game);
  const passHint = otherRem > initRem && initRem > 0 ? ' You may pass back (opponent has more activations).' : '';
  const content = showBtn
    ? `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Your turn! All deployment groups readied. ${drawRule}Both players: click **End R${round} Activation Phase** when you've used all activations and any end-of-activation effects.${passHint}`
    : `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Your turn! All deployment groups readied. ${drawRule}Use all activations and actions. The **End R${round} Activation Phase** button will appear when both players have done so.${passHint}`;
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
    }).catch(() => {});
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
      if (actMinimap) editPayload.files = [actMinimap];
      await msg.edit(editPayload).catch(() => {});
    } catch (err) {
      console.error('Failed to update DC actions message:', err);
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

async function buildDcEmbedAndFiles(dcName, exhausted, displayName, healthState, conditionsByFigure) {
  const status = exhausted ? 'EXHAUSTED' : 'READIED';
  const color = exhausted ? 0xed4245 : 0x57f287; // red : green
  const figureless = isFigurelessDc(dcName);
  const dgIndex = displayName.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  const variant = dcName?.includes('(Elite)') ? 'Elite' : dcName?.includes('(Regular)') ? 'Regular' : null;
  const healthSection = figureless ? null : formatHealthSection(Number(dgIndex), healthState, conditionsByFigure);
  const lines = figureless
    ? [variant ? `**Variant:** ${variant}` : null].filter(Boolean)
    : [
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
  const imagePath = getDcImagePath(dcName?.trim());
  if (imagePath) {
    const fullPath = join(rootDir, imagePath);
    if (existsSync(fullPath)) {
      const attachName = 'dc-thumb.png';
      if (exhausted) {
        const buffer = await rotateImage90(imagePath);
        if (buffer) {
          files.push(new AttachmentBuilder(buffer, { name: attachName }));
          embed.setThumbnail(`attachment://${attachName}`);
        } else {
          files.push(new AttachmentBuilder(fullPath, { name: attachName }));
          embed.setThumbnail(`attachment://${attachName}`);
        }
      } else {
        const ext = imagePath.split('.').pop() || 'png';
        const name = `dc-thumb.${ext}`;
        files.push(new AttachmentBuilder(fullPath, { name }));
        embed.setThumbnail(`attachment://${name}`);
      }
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
        await handMsg.edit({ content: payload.content, embeds: payload.embeds, files: payload.files || [], components: payload.components }).catch(() => {});
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
        await msg.edit({ components }).catch(() => {});
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
      embeds: [getHandTooltipEmbed(game, isP1 ? 1 : 2), getSquadSelectEmbed(isP1 ? 1 : 2, squad)],
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
      .setDescription('Show completed games summary (total, draws). Use in #statistics.');
    const affiliation = new SlashCommandBuilder()
      .setName('affiliation')
      .setDescription('Win rate by affiliation (Imperial, Rebel, Scum). Use in #statistics.');
    const dcwinrate = new SlashCommandBuilder()
      .setName('dcwinrate')
      .setDescription('Win rate by Deployment Card (top N by games played). Use in #statistics.')
      .addIntegerOption((o) => o.setName('limit').setDescription('Max number of DCs to show (default 20)').setMinValue(5).setMaxValue(50));
    const powertoken = new SlashCommandBuilder()
      .setName('power-token')
      .setDescription('Add or remove a Power Token on a figure. Use in Game Log / Board channel.')
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
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: [botmenu.toJSON(), statcheck.toJSON(), affiliation.toJSON(), dcwinrate.toJSON(), powertoken.toJSON()],
    });
    console.log('Slash commands registered: /botmenu, /statcheck, /affiliation, /dcwinrate, /power-token');
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
          const { gameId } = await createTestGame(client, guild, userId, scenarioId, lfg);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ gameId, message: 'Test game created. Check #lfg in Discord.' }));
        } catch (err) {
          console.error('POST /testgame error:', err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Test game creation failed' }));
        }
      });
    }).listen(port, '127.0.0.1', () => {
      console.log(`Testgame HTTP: POST http://127.0.0.1:${port}/testgame (body: { "userId?", "scenarioId?" }, or set TESTGAME_USER_ID)`);
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
      await message.reply('This command must be used in a server channel.').catch(() => {});
      return;
    }
    const scenarioId = getRandomTestreadyScenario();
    if (!scenarioId) {
      await message.reply('No testready scenarios. Add scenarios with `status: "testready"` in `data/test-scenarios.json` and implement them in runDraftRandom.').catch(() => {});
      return;
    }
    const msgId = message.id;
    if (processedTestGameMessageIds.has(msgId)) return;
    processedTestGameMessageIds.add(msgId);
    if (processedTestGameMessageIds.size > 500) processedTestGameMessageIds.clear();
    const userId = message.author.id;
    const creatingMsg = await message.reply(`Creating test game (random testready scenario: **${scenarioId}**)...`);
    try {
      await createTestGame(message.client, message.guild, userId, scenarioId, message.channel, { editMessageInstead: creatingMsg });
    } catch (err) {
      console.error('Test game creation error:', err);
      await logGameErrorToBotLogs(message.client, message.guild, null, err, 'test_game_create');
      await creatingMsg.edit(`Failed to create test game: ${err.message}`).catch(() => {});
    }
    return;
  }

  const isTestGameCmd = content.startsWith('testgame') && channelNameLc === 'lfg';
  if (isTestGameCmd) {
    if (!message.guild) {
      await message.reply('This command must be used in a server channel.').catch(() => {});
      return;
    }
    const parts = content.split(/\s+/);
    const scenarioId = parts[1] && parts[1].toLowerCase() || null; // e.g. 'smoke_grenade', 'blaze'
    const msgId = message.id;
    if (processedTestGameMessageIds.has(msgId)) return; // dedupe: Discord sometimes fires messageCreate twice
    processedTestGameMessageIds.add(msgId);
    if (processedTestGameMessageIds.size > 500) processedTestGameMessageIds.clear();
    const userId = message.author.id;
    const creatingMsg = await message.reply(scenarioId ? `Creating test game (scenario: **${scenarioId}**)...` : 'Creating test game (you as both players)...');
    try {
      await createTestGame(message.client, message.guild, userId, scenarioId, message.channel, { editMessageInstead: creatingMsg });
    } catch (err) {
      console.error('Test game creation error:', err);
      await logGameErrorToBotLogs(message.client, message.guild, null, err, 'test_game_create');
      await creatingMsg.edit(`Failed to create test game: ${err.message}`).catch(() => {});
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
        await message.reply('This game has ended. VP cannot be changed.').catch(() => {});
        return;
      }
      const authorId = message.author.id;
      const isP1 = authorId === game.player1Id;
      const isP2 = authorId === game.player2Id;
      if (!isP1 && !isP2) {
        await message.reply('Only players in this game can use /editvp.').catch(() => {});
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
      await message.reply(`✓ **${side}** VP adjusted ${actualDelta >= 0 ? '+' : ''}${actualDelta}. Total is now **${newTotal}** VP.`).catch(() => {});
      // Update scorecard embed in Board channel if present
      if (game.boardId && game.selectedMap) {
        try {
          const boardChannel = await message.client.channels.fetch(game.boardId);
          const messages = await boardChannel.messages.fetch({ limit: 15 });
          const withScorecard = messages.find((m) => m.embeds?.[0]?.title === 'Scorecard');
          if (withScorecard) {
            const embed = buildScorecardEmbed(game);
            await withScorecard.edit({ embeds: [embed] }).catch(() => {});
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
        }).catch(() => {});
        return;
      }
      await interaction.reply({
        content: '**Bot Stuff** — Choose an action:',
        components: [getBotmenuButtons(gameByChannel.gameId)],
        ephemeral: false,
      }).catch(() => {});
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
        }).catch(() => {});
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
        }).catch(() => {});
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
        }).catch(() => {});
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
          }).catch(() => {});
          return;
        }
        game.figurePowerTokens[fk] = [...game.figurePowerTokens[fk], type];
        saveGames();
        await interaction.reply({
          content: `Added **${type}** Power Token to **${fk}**.`,
          ephemeral: false,
        }).catch(() => {});
      } else {
        const idx = interaction.options.getInteger('index');
        const arr = game.figurePowerTokens[fk];
        if (!arr || arr.length < idx) {
          await interaction.reply({
            content: `${fk} does not have a token at index ${idx}. Current: ${(arr || []).join(', ') || 'none'}`,
            ephemeral: true,
          }).catch(() => {});
          return;
        }
        const removed = arr[idx - 1];
        game.figurePowerTokens[fk] = arr.filter((_, i) => i !== idx - 1);
        if (game.figurePowerTokens[fk].length === 0) delete game.figurePowerTokens[fk];
        saveGames();
        await interaction.reply({
          content: `Removed **${removed}** Power Token from **${fk}**.`,
          ephemeral: false,
        }).catch(() => {});
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
    // Stats commands: only in #statistics channel; require DB
    const statsChannelName = (interaction.channel?.name || '').toLowerCase();
    if (['statcheck', 'affiliation', 'dcwinrate'].includes(cmd)) {
      if (statsChannelName !== 'statistics') {
        await interaction.reply({
          content: 'Use this command in the **#statistics** channel.',
          ephemeral: true,
        }).catch(() => {});
        return;
      }
      if (!isDbConfigured()) {
        await interaction.reply({
          content: 'Stats require a database (DATABASE_URL). No data available.',
          ephemeral: true,
        }).catch(() => {});
        return;
      }
      await interaction.deferReply({ ephemeral: false }).catch(() => {});
      try {
        if (cmd === 'statcheck') {
          const { totalGames, draws } = await getStatsSummary();
          await interaction.editReply({
            content: `**Completed games:** ${totalGames}\n**Draws:** ${draws}`,
          }).catch(() => {});
        } else if (cmd === 'affiliation') {
          const rows = await getAffiliationWinRates();
          const lines = rows.length
            ? rows.map((r) => `${r.affiliation}: **${r.wins}** / **${r.games}** (${r.winRate}% win rate)`).join('\n')
            : 'No completed games with affiliation data yet.';
          await interaction.editReply({ content: `**Win rate by affiliation**\n${lines}` }).catch(() => {});
        } else if (cmd === 'dcwinrate') {
          const limit = interaction.options.getInteger('limit') ?? 20;
          const rows = await getDcWinRates(limit);
          const lines = rows.length
            ? rows.map((r) => `${r.dcName}: **${r.wins}** / **${r.games}** (${r.winRate}%)`).join('\n')
            : 'No completed games with army data yet.';
          await interaction.editReply({
            content: `**Win rate by Deployment Card** (top ${limit} by games played)\n${lines}`,
          }).catch(() => {});
        }
      } catch (err) {
        console.error(`Stats command /${cmd} failed:`, err);
        await interaction.editReply({
          content: `Something went wrong: ${err.message}`,
        }).catch(() => {});
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
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const selectKey = getHandlerKey(interaction.customId, 'select');
    if (!selectKey) return;
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
        createHandChannels,
        getHandTooltipEmbed,
        getSquadSelectEmbed,
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
    };
    if (selectKey === 'cc_attach_to_') await handleCcAttachTo(interaction, ccHandSelectContext);
    else if (selectKey === 'cc_play_select_') await handleCcPlaySelect(interaction, ccHandSelectContext);
    else if (selectKey === 'cc_discard_select_') await handleCcDiscardSelect(interaction, ccHandSelectContext);
    return;
  }

  if (!interaction.isButton()) return;
  const buttonKey = getHandlerKey(interaction.customId, 'button');
  if (!buttonKey) return;

    if (buttonKey === 'deck_illegal_play_' || buttonKey === 'deck_illegal_redo_' || buttonKey === 'cc_shuffle_draw_' || buttonKey === 'cc_play_' || buttonKey === 'cc_draw_' || buttonKey === 'cc_search_discard_' || buttonKey === 'cc_close_discard_' || buttonKey === 'cc_discard_' || buttonKey === 'cc_choice_' || buttonKey === 'cc_space_' || buttonKey === 'squad_select_' || buttonKey === 'illegal_cc_ignore_' || buttonKey === 'illegal_cc_unplay_' || buttonKey === 'negation_play_' || buttonKey === 'negation_let_resolve_' || buttonKey === 'celebration_play_' || buttonKey === 'celebration_pass_') {
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
      getSquadSelectEmbed,
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
      updateAttachmentMessageForDc,
      getPlayableCcFromHand,
      resolveAbility,
      updateDcActionsMessage,
      buildDcEmbedAndFiles,
      getConditionsForDcMessage,
      getDcPlayAreaComponents,
    };
    if (buttonKey === 'deck_illegal_play_') await handleDeckIllegalPlay(interaction, ccHandButtonContext);
    else if (buttonKey === 'deck_illegal_redo_') await handleDeckIllegalRedo(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_shuffle_draw_') await handleCcShuffleDraw(interaction, ccHandButtonContext);
    else if (buttonKey === 'cc_play_') await handleCcPlay(interaction, ccHandButtonContext);
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

  if (buttonKey === 'dc_activate_' || buttonKey === 'dc_unactivate_' || buttonKey === 'dc_toggle_' || buttonKey === 'dc_deplete_' || buttonKey === 'dc_cc_special_' || buttonKey === 'dc_move_' || buttonKey === 'dc_attack_' || buttonKey === 'dc_interact_' || buttonKey === 'dc_special_') {
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
      getEffectiveSpeed,
      ensureMovementBankMessage,
      getBoardStateForMovement,
      getMovementProfile,
      computeMovementCache,
      getMoveMpButtonRows,
      getLegalInteractOptions,
      FIGURE_LETTERS,
      resolveAbility,
      getNegationResponseButtons,
    };
    if (buttonKey === 'dc_activate_') await handleDcActivate(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_unactivate_') await handleDcUnactivate(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_toggle_') await handleDcToggle(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_deplete_') await handleDcDeplete(interaction, dcPlayAreaContext);
    else if (buttonKey === 'dc_cc_special_') await handleDcCcSpecial(interaction, dcPlayAreaContext);
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
      editDistanceMessage,
    };
    await handleMoveAdjustMp(interaction, moveAdjustContext);
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
      editDistanceMessage,
      getMoveMpButtonRows,
      buildBoardMapPayload,
      saveGames,
      client,
    };
    await handleMovePick(interaction, movePickContext);
    return;
  }

  if (buttonKey === 'cleave_target_' || buttonKey === 'attack_target_' || buttonKey === 'combat_resolve_ready_' || buttonKey === 'combat_ready_' || buttonKey === 'combat_roll_' || buttonKey === 'combat_surge_') {
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
      logGameAction,
      isGroupDefeated,
      checkWinConditions,
      finishCombatResolution,
      ACTION_ICONS,
      ThreadAutoArchiveDuration,
      resolveCombatAfterRolls,
      saveGames,
      client,
      rollAttackDice,
      rollDefenseDice,
      getAttackerSurgeAbilities,
      SURGE_LABELS,
      parseSurgeEffect,
      getAbility,
      resolveSurgeAbility,
      getSurgeAbilityLabel,
    };
    if (buttonKey === 'cleave_target_') await handleCleaveTarget(interaction, combatContext);
    else if (buttonKey === 'attack_target_') await handleAttackTarget(interaction, combatContext);
    else if (buttonKey === 'combat_resolve_ready_') await handleCombatResolveReady(interaction, combatContext);
    else if (buttonKey === 'combat_ready_') await handleCombatReady(interaction, combatContext);
    else if (buttonKey === 'combat_roll_') await handleCombatRoll(interaction, combatContext);
    else if (buttonKey === 'combat_surge_') await handleCombatSurge(interaction, combatContext);
    return;
  }

  if (buttonKey === 'status_phase_' || buttonKey === 'pass_activation_turn_' || buttonKey === 'end_turn_' || buttonKey === 'confirm_activate_' || buttonKey === 'cancel_activate_') {
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
    };
    if (buttonKey === 'status_phase_') await handleStatusPhase(interaction, activationContext);
    else if (buttonKey === 'pass_activation_turn_') await handlePassActivationTurn(interaction, activationContext);
    else if (buttonKey === 'end_turn_') await handleEndTurn(interaction, activationContext);
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
      getInitiativePlayerZoneLabel,
      updateHandVisualMessage,
      buildHandDisplayPayload,
      sendRoundActivationPhaseMessage,
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
      createHandChannels,
      getHandTooltipEmbed,
      getSquadSelectEmbed,
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
      saveGames,
      pushUndo,
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
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: 'Go to **#new-games** and click **Create Post** to start a lobby. The bot will add the Join Game button.',
      components: [getMainMenu()],
    });
    return;
  }
  if (buttonKey === 'join_game') {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: 'Browse **#new-games** and click **Join Game** on a lobby post that needs an opponent.',
      components: [getMainMenu()],
    });
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
  }
});

if (process.argv.includes('--test-movement')) {
  runMovementTests()
    .then((code) => process.exit(code || 0))
    .catch((err) => { console.error(err); process.exit(1); });
} else {
  client.login(process.env.DISCORD_TOKEN);
}
