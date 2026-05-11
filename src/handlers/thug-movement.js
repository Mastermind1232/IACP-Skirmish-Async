/**
 * Thug end-of-round picker UI + handlers (alexanbv 2026-05-10).
 *
 * Drives the player-interactive thug-movement queue. The initiative
 * player picks WHICH thug to move first, then for each thug picks the
 * destination from the candidate set computed by computeThugCandidates.
 *
 * Pattern mirrors massive-push (movement.js):
 *   - game.pendingThugMovement holds the queue + selected-thug-index state
 *   - Two button prefixes: thug_pick_<gameId>_<idx>, thug_dest_<gameId>_<coord>
 *   - When queue empties, computeThugDamageEvents fires + resume hook runs
 *
 * Resume hook: callers must set game._resumeAfterThugMovement (function
 * reference is not persistable, so this is invoked synchronously from the
 * triggering round-end handler). For checkpoint reloads mid-queue, the
 * round-end code path re-detects pendingThugMovement and re-posts the
 * appropriate picker.
 */
import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getPlayerId } from '../game/player-helpers.js';
import { computeThugCandidates, applyThugMove, computeThugDamageEvents, clearPendingThugMovement } from '../game/thug-movement.js';
import { getMapData, getMapRegistry } from '../data-loader.js';
import { filterMapSpacesByBounds } from '../game/movement.js';

function _resolveAdjacency(game, mapId) {
  const raw = getMapData(mapId);
  if (!raw?.adjacency) return {};
  const mapDef = getMapRegistry().find((m) => m.id === mapId);
  const mapSpaces = filterMapSpacesByBounds(raw, mapDef?.gridBounds) || raw;
  return mapSpaces.adjacency || {};
}

/**
 * Post the "which thug to move next" picker to the initiative player.
 * One button per remaining thug, label "Thug N @ COORD".
 */
export async function postThugPickerPrompt(game, client, fallbackChannel = null) {
  const pending = game.pendingThugMovement;
  if (!pending || pending.remainingThugIndexes.length === 0) return;
  const initPN = pending.initiativePlayerNum;
  const initId = getPlayerId(game, initPN);
  const buttons = pending.remainingThugIndexes.map((idx) => {
    const npc = game.npcThugs?.[idx];
    const coord = npc?.coord ? String(npc.coord).toUpperCase() : '?';
    return new ButtonBuilder()
      .setCustomId(`thug_pick_${game.gameId}_${idx}`)
      .setLabel(`Thug ${idx + 1} @ ${coord}`.slice(0, 80))
      .setStyle(ButtonStyle.Primary);
  });
  const rows = [];
  while (buttons.length > 0) rows.push(new ActionRowBuilder().addComponents(buttons.splice(0, 5)));
  const channelId = game.generalId;
  const channel = channelId ? await fetchGameChannel(client, channelId) : fallbackChannel;
  if (!channel) return;
  await channel.send({
    content: `🔫 **Thug end-of-round movement** — <@${initId}> (initiative), pick which Thug to move first:`,
    components: rows.slice(0, 5),
    allowedMentions: { users: [initId] },
  }).catch(discordCatch);
}

/**
 * Post destination picker for the currently-selected thug. Candidates
 * come from computeThugCandidates per CRR rule (b).
 */
export async function postThugDestPrompt(game, client, fallbackChannel = null) {
  const pending = game.pendingThugMovement;
  if (!pending || pending.selectedThugIndex == null) return;
  const thugIdx = pending.selectedThugIndex;
  const thug = game.npcThugs?.[thugIdx];
  if (!thug || thug.defeated) {
    pending.selectedThugIndex = null;
    return;
  }
  const adjacency = _resolveAdjacency(game, pending.mapId);
  const candidates = computeThugCandidates(game, pending.mapId, thugIdx, adjacency);
  if (candidates.length === 0) {
    pending.remainingThugIndexes = pending.remainingThugIndexes.filter((i) => i !== thugIdx);
    pending.selectedThugIndex = null;
    return;
  }
  const initId = getPlayerId(game, pending.initiativePlayerNum);
  const buttons = candidates.map((coord) =>
    new ButtonBuilder()
      .setCustomId(`thug_dest_${game.gameId}_${coord}`)
      .setLabel(String(coord).toUpperCase())
      .setStyle(ButtonStyle.Primary)
  );
  const rows = [];
  while (buttons.length > 0) rows.push(new ActionRowBuilder().addComponents(buttons.splice(0, 5)));
  const channelId = game.generalId;
  const channel = channelId ? await fetchGameChannel(client, channelId) : fallbackChannel;
  if (!channel) return;
  const startCoord = String(thug.coord).toUpperCase();
  await channel.send({
    content: `🔫 **Thug ${thugIdx + 1}** (currently at **${startCoord}**) — <@${initId}>, pick destination:`,
    components: rows.slice(0, 5),
    allowedMentions: { users: [initId] },
  }).catch(discordCatch);
}

/**
 * Handler for `thug_pick_<gameId>_<idx>` — sets the selected thug,
 * posts the destination picker.
 */
export async function handleThugPick(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^thug_pick_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingThugMovement;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending thug movement.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.initiativePlayerNum, canActAsPlayer,
      'Only the initiative player moves thugs.')) return;
  const idx = parseInt(idxStr, 10);
  if (!pending.remainingThugIndexes.includes(idx)) {
    await interaction.followUp({ content: 'That thug is no longer pickable.', ephemeral: true }).catch(discordCatch);
    return;
  }
  pending.selectedThugIndex = idx;
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  await postThugDestPrompt(game, client, interaction.channel);
  if (saveGames) saveGames(game.gameId);
}

/**
 * Handler for `thug_dest_<gameId>_<coord>` — applies the move, advances
 * the queue, fires damage events + resume hook when drained.
 */
export async function handleThugDest(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client, applyNpcDamageToFigure,
    dcHealthState, dcMessageMeta, checkWinConditions } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^thug_dest_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, coordRaw] = m;
  const coord = String(coordRaw).toLowerCase();
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingThugMovement;
  if (!pending || pending.gameId !== gameId || pending.selectedThugIndex == null) {
    await interaction.followUp({ content: 'No pending thug destination.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.initiativePlayerNum, canActAsPlayer,
      'Only the initiative player moves thugs.')) return;
  const thugIdx = pending.selectedThugIndex;
  const adjacency = _resolveAdjacency(game, pending.mapId);
  const valid = new Set(computeThugCandidates(game, pending.mapId, thugIdx, adjacency).map((c) => String(c).toLowerCase()));
  if (!valid.has(coord)) {
    await interaction.followUp({ content: 'That destination is no longer valid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const result = applyThugMove(game, thugIdx, coord);
  if (result) {
    await logGameAction?.(game, client, `🔫 **Thug ${thugIdx + 1}** moved **${String(result.prevCoord).toUpperCase()}** → **${String(result.newCoord).toUpperCase()}**.`, { phase: 'ROUND', icon: 'move' }).catch(() => {});
  }
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  if (pending.remainingThugIndexes.length > 0) {
    await postThugPickerPrompt(game, client, interaction.channel);
    if (saveGames) saveGames(game.gameId);
    return;
  }
  // Queue drained: apply damage + run resume hook
  const damageEvents = computeThugDamageEvents(game, adjacency);
  clearPendingThugMovement(game);
  for (const { figureKey, playerNum, damage } of damageEvents) {
    if (applyNpcDamageToFigure) {
      await applyNpcDamageToFigure(game, playerNum, figureKey, damage, 'Thug', logGameAction, client, dcHealthState, dcMessageMeta);
    }
  }
  if (damageEvents.length > 0 && checkWinConditions) {
    await checkWinConditions(game, client);
    if (game.ended) {
      if (saveGames) saveGames(game.gameId);
      return;
    }
  }
  // Resume the round-end chain via the registered continuation.
  const resume = game._resumeAfterThugMovementFn;
  delete game._resumeAfterThugMovementFn;
  if (typeof resume === 'function') {
    await resume(game, ctx).catch((err) => console.error('Thug resume continuation failed:', err));
  }
  if (saveGames) saveGames(game.gameId);
}
