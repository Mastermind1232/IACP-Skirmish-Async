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
import { isAiUserId } from './discord/channel-helpers.js';
import { getDisplayNameFromId, ensurePlayersCached } from './discord/user-helpers.js';
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
  getMapData,
  getMapSpaceSet,
  getFigureSize,
  isDcCompanion,
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
  getConfig,
} from './game/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

/**
 * Extract the loadout name for a DC embed, if a loadout card is configured for the first figure.
 * @param {object} game
 * @param {string} dcName
 * @param {number} playerNum
 * @param {string} displayName - for DG index extraction
 * @returns {string|null}
 */
export function getLoadoutNameForEmbed(game, dcName, playerNum, displayName) {
  if (!game || !dcName) return null;
  const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const fks = Object.keys(game.figurePositions?.[playerNum] || {}).filter(fk => fk.startsWith(`${dcName}-${dgIndex}-`));
  if (fks.length === 0) return null;
  return getConfig(game, fks[0])?.loadout || null;
}

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
  // Discord allows max 10 embeds per message (1 header + 9 cards)
  const maxCardEmbeds = 9;
  for (let i = 0; i < Math.min(hand.length, maxCardEmbeds); i++) {
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
      // Find damage for this figure from dcList healthState
      let damage = 0;
      let _dgCount = 0;
      for (const d of dcList) {
        if (resolveDcName(d) === dcName) {
          _dgCount++;
          if (_dgCount === dgIndex) {
            const hs = d.healthState;
            if (hs?.[figureIndex]) damage = hs[figureIndex][1] - hs[figureIndex][0];
            break;
          }
        }
      }
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
        damage,
        isCompanion: isDcCompanion(dcName),
      });
    }
  }
  return figures;
}

// ---------------------------------------------------------------------------
// buildMissionTokens
// ---------------------------------------------------------------------------

/** Build rich token array from tokenTypes + positions. Returns [{coord, label, image}]. Falls back to flat coord array with fallbackLabel.
 *  @param {object} [labelCounts] - Optional map of base-label → numeric count. When a token's label matches a key, " (N)" is appended so dynamic counters render next to the icon (e.g. Sabacc VPs). Zero/missing counts are omitted. */
export function buildMissionTokens(missionData, fallbackLabel, labelCounts = null) {
  if (!missionData) return [];
  const applyCount = (label) => {
    if (!labelCounts || !label) return label;
    const n = labelCounts[label];
    return typeof n === 'number' && n > 0 ? `${label} (${n})` : label;
  };
  const tokenTypes = missionData.tokenTypes;
  const positions = missionData.positions;
  if (Array.isArray(tokenTypes) && positions && typeof positions === 'object') {
    const typeMap = {};
    for (const t of tokenTypes) typeMap[t.id] = t;
    const result = [];
    for (const [typeId, coords] of Object.entries(positions)) {
      const tDef = typeMap[typeId] || {};
      const baseLabel = tDef.label || fallbackLabel;
      for (const coord of Array.isArray(coords) ? coords : [coords]) {
        result.push({ coord, label: applyCount(baseLabel), image: tDef.image || null });
      }
    }
    return result;
  }
  const flat = getMissionTokenCoords(missionData);
  return flat.map((coord) => ({ coord, label: applyCount(fallbackLabel), image: null }));
}

// ---------------------------------------------------------------------------
// getMapTokensForRender
// ---------------------------------------------------------------------------

/** Get map tokens (terminals + mission-specific + closed doors + ancillary) for renderMap.
 * @param {object|null} fluctuationPositions - If provided, overrides missionB positions for Lothal Wastes B swap rendering.
 *   Shape: { "0": ["j10", "p10"], ... } — same as game.fluctuationPositions from getCurrentFluctuationPositions(). */
/** Derive per-label counters for mission tokens. Currently: Sabacc VPs (Corellian Underground B). */
export function buildLabelCountsFromGame(game) {
  if (!game) return null;
  const counts = {};
  if (typeof game.sabaccTokenCount === 'number' && game.sabaccTokenCount > 0) {
    counts['Sabacc VPs'] = game.sabaccTokenCount;
  }
  return Object.keys(counts).length ? counts : null;
}

export function getMapTokensForRender(mapId, missionVariant, openedDoors = [], ancillaryTokens = null, tokenLabel = 'Token', strainMap = null, fluctuationPositions = null, labelCounts = null) {
  const mapData = getMapTokensData()[mapId];
  if (!mapData) return { terminals: [], missionA: [], missionB: [], doors: [], smoke: [], rubble: [], energyShield: [], device: [], napalm: [] };
  const terminals = mapData.terminals || [];
  const missionA = buildMissionTokens(mapData.missionA, tokenLabel, labelCounts);
  // If fluctuation positions are provided (post-swap), build missionB with overridden positions
  let missionBData = mapData.missionB;
  if (fluctuationPositions && missionBData) {
    missionBData = { ...missionBData, positions: fluctuationPositions };
  }
  const missionB = buildMissionTokens(missionBData, tokenLabel, labelCounts);
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
    namedAreas: (mapData.namedAreas || []).filter(a => a.name && a.cells?.length),
    strainMarkers: _buildStrainMarkers(strainMap),
  };
}

/** Convert strain state map {coord: count} to render-ready array [{coord, count}]. */
function _buildStrainMarkers(strainMap) {
  if (!strainMap || typeof strainMap !== 'object') return [];
  const markers = [];
  for (const [coord, count] of Object.entries(strainMap)) {
    if (count > 0) markers.push({ coord, count });
  }
  return markers;
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
  // Only label valid map spaces within the crop zone (not off-map/wall cells)
  const mapSpaceSet = getMapSpaceSet(map.id);
  const labelCoords = mapSpaceSet.size
    ? cropCoords.filter(c => mapSpaceSet.has(c.toLowerCase())).map(c => c.toLowerCase())
    : [];
  try {
    const figures = getFiguresForRender(game);
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token', game?.signalMarkerStrain, game?.fluctuationPositions, buildLabelCountsFromGame(game));
    const buffer = await renderMap(map.id, {
      figures,
      tokens,
      showGrid: true,
      maxWidth: 800,
      cropToZone: cropCoords,
      gridStyle: 'black',
      showGridOnlyOnCoords: labelCoords,
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
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token', game?.signalMarkerStrain, game?.fluctuationPositions, buildLabelCountsFromGame(game));
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
    const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token', game?.signalMarkerStrain, game?.fluctuationPositions, buildLabelCountsFromGame(game));
    let zoneSpaces = zone && getDeploymentZones()[map.id]?.[zone] ? [...getDeploymentZones()[map.id][zone]] : null;
    // For Massive/Mobile figures, include blocking cells in the zone so they appear numbered
    if (opts.includeBlocking && zoneSpaces) {
      const ms = getMapData(map.id);
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
  await ensurePlayersCached(client, game);
  const components = getBoardButtons(gameId, { game });
  const embeds = game && getMissionVpBonus ? [buildScorecardEmbed(game, getMissionVpBonus(game), client)] : (game ? [buildScorecardEmbed(game, 0, client)] : []);
  const figures = game ? getFiguresForRender(game) : [];
  const tokens = getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token', game?.signalMarkerStrain, game?.fluctuationPositions, buildLabelCountsFromGame(game));
  const hasFigures = figures.length > 0;
  const hasAncillary = (tokens.smoke?.length || 0) + (tokens.rubble?.length || 0) + (tokens.energyShield?.length || 0) + (tokens.device?.length || 0) + (tokens.napalm?.length || 0) > 0;
  const hasTokens = tokens.terminals?.length > 0 || tokens.missionA?.length > 0 || tokens.missionB?.length > 0 || tokens.doors?.length > 0 || hasAncillary;
  const resolvedMapPath = map.imagePath ? resolveAssetPath(map.imagePath, 'maps') : null;
  const imagePath = resolvedMapPath ? join(rootDir, resolvedMapPath) : null;
  const pdfPath = join(rootDir, 'data', 'map-pdfs', `${map.id}.pdf`);

  // Map updates re-post on every figure move / refresh. The scorecard
  // embed contains `<@ID>` mentions for the Players + Initiative fields,
  // which Discord renders as @username (good — clickable, shows display
  // name) but ALSO pings if those IDs are listed in allowedMentions.users.
  // Set allowedMentions to suppress all user pings while keeping the
  // names rendered as text.
  const allowedMentions = { users: [] };
  // Player labels: Discord names over each player's deployment zone
  const playerLabels = [];
  if (game?.deploymentZoneChosen && game?.player1Id && game?.player2Id) {
    const zoneData = getDeploymentZones()[map.id] || {};
    const initZone = game.deploymentZoneChosen;
    const otherZone = initZone === 'red' ? 'blue' : 'red';
    const p1IsInit = game.player1Id === game.initiativePlayerId;
    const p1ZoneCells = zoneData[p1IsInit ? initZone : otherZone] || [];
    const p2ZoneCells = zoneData[p1IsInit ? otherZone : initZone] || [];
    const p1Name = getDisplayNameFromId(client, game.player1Id, 'P1');
    const p2Name = getDisplayNameFromId(client, game.player2Id, 'P2');
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

export async function buildDcEmbedAndFiles(dcName, exhausted, displayName, healthState, conditionsByFigure, dcAttachments = [], tokensByFigure = null, actionsData = null, nicknamesByFigure = null, options = {}) {
  const loadoutName = options.loadoutName || (options.game && options.playerNum ? getLoadoutNameForEmbed(options.game, dcName, options.playerNum, displayName) : null);
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
  const loadoutLine = loadoutName ? `**Loadout:** ${loadoutName}` : null;
  // Imperial Citadel: show token inventory on the card
  let citadelTokenLine = null;
  if (figureless && dcName?.includes('Imperial Citadel') && options.game?.imperialCitadelTokens) {
    const ct = options.game.imperialCitadelTokens;
    const parts = Object.entries(ct).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k.charAt(0).toUpperCase() + k.slice(1)}`);
    citadelTokenLine = parts.length > 0 ? `**Tokens:** ${parts.join(', ')}` : '**Tokens:** none';
  }
  const lines = figureless
    ? [actionsLine, variant ? `**Variant:** ${variant}` : null, citadelTokenLine].filter(Boolean)
    : [
        actionsLine,
        `**Figures:** ${figures}`,
        variant ? `**Variant:** ${variant}` : null,
        loadoutLine,
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
