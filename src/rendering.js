/**
 * Rendering / display helpers extracted from index.js.
 * Builds payloads (embeds, files, components) for board maps, DC cards,
 * hand displays, discard piles, minimaps, and deployment-zone maps.
 */

import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { COLORS } from './discord/colors.js';
import { snowflakeUsers } from './discord/channel-helpers.js';
import { renderMap } from './map-renderer.js';
import { getCommandCardImagePath, getDcImagePath, getFigureImagePath, resolveAssetPath, UPGRADE_IMAGE_OVERRIDES } from './asset-paths.js';
import {
  resolveDcName,
  parseCoord,
  edgeKey,
  toLowerSet,
  dcNameFromFigureKey,
  parseFigureKey,
  getInitiativePlayerNum,
  getEffectiveFigureSize,
  getMissionTokenCoords,
  getEffectiveSpeed,
  getOccupiedSpacesForMovement,
  colRowToCoord,
} from './game/index.js';
import {
  getDcEffects,
  getDcStats,
  getMapTokensData,
  getDeploymentZones,
  getMapSpaces,
  getFigureSize,
} from './data-loader.js';
import { dcMessageMeta } from './game-state.js';
import { getSquad } from './game/player-helpers.js';
import {
  buildScorecardEmbed,
  formatHealthSection,
  EMBEDS_PER_MESSAGE,
  FIGURE_LETTERS,
  getActionsCounterContent,
  getCcActionButtons,
  getBoardButtons,
} from './discord/index.js';
import {
  isFigurelessDc as _isFigurelessDc,
  hasDepleteEffect as _hasDepleteEffect,
  hasExhaustEffect as _hasExhaustEffect,
} from './game/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const isFigurelessDc = _isFigurelessDc;
const hasDepleteEffect = _hasDepleteEffect;
const hasExhaustEffect = _hasExhaustEffect;

// ---------------------------------------------------------------------------
// buildHandDisplayPayload
// ---------------------------------------------------------------------------

/**
 * Build the payload for showing a player's hand of command cards.
 * @param {Function} getHandWindowButtonRow - locally defined in index.js, passed in
 */
export function buildHandDisplayPayload(hand, deck, gameId, game = null, playerNum = 1, { getHandWindowButtonRow } = {}) {
  const files = [];
  const embeds = [];

  // Header embed
  embeds.push(new EmbedBuilder()
    .setTitle('Command Cards in Hand')
    .setDescription(`**${hand.length}** cards in hand • **${deck.length}** in deck`)
    .setColor(COLORS.DARK_EMBED));

  // One embed per card (thumbnail = same size as DC embeds in Play Area)
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    const path = getCommandCardImagePath(card);
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `cc-${i}-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(card || `Card ${i + 1}`)
      .setColor(COLORS.DARK_EMBED);
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
  const windowRow = getHandWindowButtonRow ? getHandWindowButtonRow(game, playerNum, gameId) : null;
  if (windowRow) rows.push(windowRow);
  return {
    content,
    embeds,
    files: files.length > 0 ? files : undefined,
    components: rows,
  };
}

// ---------------------------------------------------------------------------
// getFiguresForRender
// ---------------------------------------------------------------------------

export function getFiguresForRender(game) {
  const pos = game.figurePositions;
  if (!pos || (!pos[1] && !pos[2])) return [];
  const figures = [];
  const zoneColors = { red: '#e74c3c', blue: '#3498db' };
  const initiativePlayerNum = getInitiativePlayerNum(game);
  const chosen = game.deploymentZoneChosen;
  if (!chosen) return figures;
  const otherZone = chosen === 'red' ? 'blue' : 'red';
  for (const p of [1, 2]) {
    const zone = p === initiativePlayerNum ? chosen : otherZone;
    const color = zoneColors[zone] || '#888';
    const poses = pos[p] || {};
    const dcList = getSquad(game, p)?.dcList || [];
    const totals = {};
    for (const d of dcList) {
      const n = resolveDcName(d);
      if (n && !isFigurelessDc(n)) totals[n] = (totals[n] || 0) + 1;
    }
    for (const [figureKey, space] of Object.entries(poses)) {
      const dcName = dcNameFromFigureKey(figureKey);
      const { dgIndex, figureIndex } = parseFigureKey(figureKey);
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
        baseSize,
        label,
        figureKey,
        powerTokens,
        conditions,
      });
    }
  }
  return figures;
}

// ---------------------------------------------------------------------------
// buildMissionTokens
// ---------------------------------------------------------------------------

/** Build rich token array from tokenTypes + positions. Returns [{coord, label, image}]. Falls back to flat coord array with fallbackLabel. */
export function buildMissionTokens(missionData, fallbackLabel) {
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

// ---------------------------------------------------------------------------
// getMapTokensForRender
// ---------------------------------------------------------------------------

/** Get map tokens (terminals + mission-specific + closed doors + ancillary) for renderMap. */
export function getMapTokensForRender(mapId, missionVariant, openedDoors = [], ancillaryTokens = null, tokenLabel = 'Token') {
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

// ---------------------------------------------------------------------------
// getActivationMinimapAttachment
// ---------------------------------------------------------------------------

/** Returns AttachmentBuilder for activation minimap (zoomed on figure, size = speed * 1.75 cells). msgId = DC message ID. */
export async function getActivationMinimapAttachment(game, msgId) {
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
  const size = getEffectiveFigureSize(game, figureKey, dcName);
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

// ---------------------------------------------------------------------------
// getMovementMinimapAttachment
// ---------------------------------------------------------------------------

/** Returns AttachmentBuilder for movement minimap (zoomed on figure, coords only on spacesAtCost). */
export async function getMovementMinimapAttachment(game, msgId, figureKey, spacesAtCost) {
  const meta = dcMessageMeta.get(msgId);
  const map = game?.selectedMap;
  if (!meta || !map?.id || !spacesAtCost?.length) return null;
  const playerNum = meta.playerNum;
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return null;
  const dcName = dcNameFromFigureKey(figureKey);
  const speed = getEffectiveSpeed(dcName, figureKey, game, playerNum);
  const size = getEffectiveFigureSize(game, figureKey, dcName);
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

// ---------------------------------------------------------------------------
// getDeploymentMapAttachment
// ---------------------------------------------------------------------------

/** Returns AttachmentBuilder for deployment zone map (zoomed, black coords). zone = 'red' | 'blue'. */
export async function getDeploymentMapAttachment(game, zone, opts = {}) {
  const map = game?.selectedMap;
  if (!map?.id) return null;
  try {
    const figures = getFiguresForRender(game);
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token');
    let zoneSpaces = zone && getDeploymentZones()[map.id]?.[zone] ? [...getDeploymentZones()[map.id][zone]] : null;
    // For Massive/Mobile figures, include blocking cells in the zone so they appear numbered
    if (opts.includeBlocking && zoneSpaces) {
      const ms = getMapSpaces(map.id);
      const blockingCells = (ms?.blocking || []).map(s => String(s).toLowerCase());
      zoneSpaces = [...new Set([...zoneSpaces, ...blockingCells])];
    }
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

// ---------------------------------------------------------------------------
// buildBoardMapPayload
// ---------------------------------------------------------------------------

/**
 * Build the full board-map message payload (map image, scorecard, buttons).
 * @param {object} client - Discord.js Client instance (for user cache lookups)
 * @param {object} deps - { getMissionVpBonus, getHandWindowButtonRow } local helpers from index.js
 */
export async function buildBoardMapPayload(gameId, map, game, client, { getMissionVpBonus } = {}) {
  const components = getBoardButtons(gameId, { game });
  const embeds = game && getMissionVpBonus ? [buildScorecardEmbed(game, getMissionVpBonus(game))] : (game ? [buildScorecardEmbed(game, 0)] : []);
  const figures = game ? getFiguresForRender(game) : [];
  const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token');
  const hasFigures = figures.length > 0;
  const hasAncillary = (tokens.smoke?.length || 0) + (tokens.rubble?.length || 0) + (tokens.energyShield?.length || 0) + (tokens.device?.length || 0) + (tokens.napalm?.length || 0) > 0;
  const hasTokens = tokens.terminals?.length > 0 || tokens.missionA?.length > 0 || tokens.missionB?.length > 0 || tokens.doors?.length > 0 || hasAncillary;
  const resolvedMapPath = map.imagePath ? resolveAssetPath(map.imagePath, 'maps') : null;
  const imagePath = resolvedMapPath ? join(rootDir, resolvedMapPath) : null;
  const pdfPath = join(rootDir, 'data', 'map-pdfs', `${map.id}.pdf`);

  const rawUsers = game ? snowflakeUsers([...new Set([game.player1Id, game.player2Id])]) : [];
  const allowedMentions = rawUsers.length > 0 ? { users: rawUsers } : undefined;
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

// ---------------------------------------------------------------------------
// buildDcEmbedAndFiles
// ---------------------------------------------------------------------------

export async function buildDcEmbedAndFiles(dcName, exhausted, displayName, healthState, conditionsByFigure, dcAttachments = [], tokensByFigure = null, actionsData = null, nicknamesByFigure = null) {
  const figureless = isFigurelessDc(dcName);
  const canExhaust = figureless && (hasExhaustEffect(dcName) || hasDepleteEffect(dcName));
  const showStatus = !figureless || canExhaust;
  const status = showStatus ? (exhausted ? 'EXHAUSTED' : 'READIED') : null;
  const color = exhausted ? COLORS.RED : COLORS.GREEN; // red : green
  const dgIndex = displayName.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  const variant = dcName?.includes('(Elite)') ? 'Elite' : dcName?.includes('(Regular)') ? 'Regular' : null;
  const healthSection = figureless ? null : formatHealthSection(Number(dgIndex), healthState, conditionsByFigure, tokensByFigure, nicknamesByFigure);
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
    .setTitle(status ? `${status} — ${displayName}` : displayName)
    .setDescription(lines.length ? lines.join('\n') : '\u200b')
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

// ---------------------------------------------------------------------------
// buildDiscardPileDisplayPayload
// ---------------------------------------------------------------------------

/** Build discard pile display for thread (embeds with card images, like hand view). Returns array of { embeds, files } for chunked sends. */
export function buildDiscardPileDisplayPayload(discard) {
  const cardData = [];
  for (let i = 0; i < discard.length; i++) {
    const card = discard[i];
    const path = getCommandCardImagePath(card);
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `cc-discard-${i}-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(card || `Card ${i + 1}`)
      .setColor(COLORS.DARK_EMBED);
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
    .setColor(COLORS.DARK_EMBED);
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
