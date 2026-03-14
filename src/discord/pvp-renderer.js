/**
 * PvP game view renderer — produces Discord message payloads for the
 * two-pinned-message async PvP model.
 *
 * Message 1: Board State  — map image + scorecard embed
 * Message 2: Turn Prompt  — context text + action buttons
 *
 * Both messages are edited in place after every action.
 * No Discord API calls here — pure payload construction.
 */

import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { COLORS } from './colors.js';
import { buildScorecardEmbed, formatHealthSection } from './embeds.js';
import { FIGURE_LETTERS } from './components.js';
import { actionsToButtons, describeContext } from './action-buttons.js';
import { getAvailableActions } from '../engine/available-actions.js';
import { PHASES } from '../game/phase.js';

import { renderMap } from '../map-renderer.js';
import { resolveAssetPath } from '../asset-paths.js';
import {
  getFiguresForRender,
  getMapTokensForRender,
} from '../rendering.js';
import {
  getInitiativePlayerNum,
  getSquad,
  getPlayerId,
  opponentPlayerNum,
} from '../game/player-helpers.js';
import { getDeploymentZones, getDcStats } from '../data-loader.js';
import { enforceContentLimit, DISCORD_CONTENT_LIMIT } from './limits.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

// ── Board State (Pinned Message 1) ─────────────────────────────────────────

/**
 * Render the Board State payload: map image + scorecard + army summary.
 * This is the top pinned message — visual state of the game.
 *
 * @param {object} game
 * @param {object} [opts]
 * @param {object} [opts.client] - Discord client (for username resolution)
 * @param {Function} [opts.getMissionVpBonus] - VP bonus calculator
 * @returns {Promise<object>} Discord message payload { content, embeds, files, components }
 */
export async function renderBoardState(game, opts = {}) {
  const { client, getMissionVpBonus } = opts;
  const map = game?.selectedMap;

  // Scorecard embed
  const missionBonus = getMissionVpBonus ? getMissionVpBonus(game) : null;
  const scorecardEmbed = game ? buildScorecardEmbed(game, missionBonus || 0) : null;
  const embeds = scorecardEmbed ? [scorecardEmbed] : [];

  // Army summary embed (both players' DCs with health)
  const armyEmbed = buildArmySummaryEmbed(game);
  if (armyEmbed) embeds.push(armyEmbed);

  // If no map selected yet, return text-only
  if (!map?.id) {
    return {
      content: '**Game Board** — No map selected yet.',
      embeds,
      files: undefined,
      components: [],
    };
  }

  // Render the map image
  const figures = game ? getFiguresForRender(game) : [];
  const tokens = getMapTokensForRender(
    map.id,
    game?.selectedMission?.variant,
    game?.openedDoors,
    game?.ancillaryTokens,
    game?.selectedMission?.tokenLabel || 'Token'
  );

  // Player labels over deployment zones
  const playerLabels = buildPlayerLabels(game, map, client);

  const resolvedMapPath = map.imagePath ? resolveAssetPath(map.imagePath, 'maps') : null;
  const imagePath = resolvedMapPath ? join(rootDir, resolvedMapPath) : null;

  if (imagePath && existsSync(imagePath)) {
    try {
      const buffer = await renderMap(map.id, {
        figures,
        tokens,
        showGrid: false,
        maxWidth: 1200,
        playerLabels,
      });
      return {
        content: `**${map.name}** — Round ${game.roundNumber || 0}`,
        embeds,
        files: [new AttachmentBuilder(buffer, { name: 'board.png' })],
        components: [],
      };
    } catch (err) {
      console.error('[pvp-renderer] Map render error:', err);
    }
  }

  return {
    content: `**${map.name}** — Round ${game.roundNumber || 0}`,
    embeds,
    files: undefined,
    components: [],
  };
}

// ── Turn Prompt (Pinned Message 2) ──────────────────────────────────────────

/**
 * Render the Turn Prompt payload: context description + action buttons.
 * This is the bottom pinned message — tells the active player what to do.
 *
 * @param {object} game
 * @param {number} playerNum - The player viewing this prompt (1 or 2)
 * @param {object} [deps] - Dependencies for getAvailableActions
 * @returns {object} Discord message payload { content, embeds, components }
 */
export function renderTurnPrompt(game, playerNum, deps = {}) {
  const actions = getAvailableActions(game, playerNum, deps);
  const context = describeContext(game, playerNum);
  const isActivePlayer = actions.length > 0;

  // Build the context embed
  const embed = new EmbedBuilder()
    .setColor(isActivePlayer ? COLORS.GREEN : COLORS.GRAY);

  if (isActivePlayer) {
    const playerId = getPlayerId(game, playerNum);
    embed.setTitle(`Your Turn — P${playerNum}`);
    embed.setDescription(context);
  } else {
    embed.setTitle('Waiting');
    embed.setDescription(context || 'Waiting for opponent...');
  }

  // Action buttons
  const buttonRows = actionsToButtons(actions, {
    includeRefresh: true,
    gameId: game.gameId,
  });

  return {
    content: isActivePlayer
      ? `<@${getPlayerId(game, playerNum)}> — it's your turn!`
      : null,
    embeds: [embed],
    files: undefined,
    components: buttonRows,
  };
}

// ── Combined Game View ──────────────────────────────────────────────────────

/**
 * Produce both pinned message payloads in one call.
 * This is the main entry point for the PvP renderer.
 *
 * @param {object} game
 * @param {number} playerNum - Viewing player
 * @param {object} [deps] - Dependencies for available actions
 * @param {object} [opts] - Options for board rendering (client, getMissionVpBonus)
 * @returns {Promise<{ boardState: object, turnPrompt: object }>}
 */
export async function renderGameView(game, playerNum, deps = {}, opts = {}) {
  const boardState = await renderBoardState(game, opts);
  const turnPrompt = renderTurnPrompt(game, playerNum, deps);
  return { boardState, turnPrompt };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build player labels for map rendering (names over deployment zones).
 */
function buildPlayerLabels(game, map, client) {
  const labels = [];
  if (!game?.deploymentZoneChosen || !game?.player1Id || !game?.player2Id) return labels;

  const zoneData = getDeploymentZones()[map.id] || {};
  const initZone = game.deploymentZoneChosen;
  const otherZone = initZone === 'red' ? 'blue' : 'red';
  const p1IsInit = game.player1Id === game.initiativePlayerId;
  const p1ZoneCells = zoneData[p1IsInit ? initZone : otherZone] || [];
  const p2ZoneCells = zoneData[p1IsInit ? otherZone : initZone] || [];

  const getName = (playerId) => {
    if (!client) return null;
    const user = client.users?.cache?.get(playerId);
    return user?.globalName || user?.username || null;
  };

  const p1Name = getName(game.player1Id) || 'P1';
  const p2Name = getName(game.player2Id) || 'P2';

  if (p1ZoneCells.length > 0) labels.push({ label: p1Name, zone: p1ZoneCells });
  if (p2ZoneCells.length > 0) labels.push({ label: p2Name, zone: p2ZoneCells });

  return labels;
}

/**
 * Build a compact army summary embed showing both players' DCs + health.
 * Fits in one embed alongside the scorecard.
 */
function buildArmySummaryEmbed(game) {
  if (!game || game.phase === PHASES.LOBBY || game.phase === PHASES.MAP_SELECTION) return null;

  const lines = [];
  for (const pn of [1, 2]) {
    const squad = getSquad(game, pn);
    const dcList = squad?.dcList || [];
    if (!dcList.length) continue;

    const playerLine = `**P${pn}:**`;
    const dcLines = [];
    for (let i = 0; i < dcList.length; i++) {
      const entry = dcList[i];
      const dcName = typeof entry === 'object' ? (entry.dcName || entry.displayName) : entry;
      if (!dcName) continue;

      const stats = getDcStats(dcName);
      const figures = stats?.figures ?? 1;
      const health = stats?.health;
      // Get current health from game state if available
      const healthState = game.deploymentGroupHealth?.[pn]?.[i];
      if (healthState?.length) {
        const healthParts = healthState.map(([cur, max], fi) => {
          if (figures > 1) return `${FIGURE_LETTERS[fi] || '?'}:${cur}/${max}`;
          return `${cur}/${max}`;
        });
        dcLines.push(`  ${dcName} [${healthParts.join(' ')}]`);
      } else if (health) {
        dcLines.push(`  ${dcName} [${health}hp]`);
      } else {
        dcLines.push(`  ${dcName}`);
      }
    }
    lines.push(playerLine);
    lines.push(...dcLines);
    if (pn === 1) lines.push('');
  }

  if (!lines.length) return null;

  return new EmbedBuilder()
    .setTitle('Armies')
    .setDescription(enforceContentLimit(lines.join('\n'), 4096))
    .setColor(COLORS.DARK_EMBED);
}
