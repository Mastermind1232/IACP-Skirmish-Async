/**
 * Map event handlers: devaron_door_open_, devaron_crate_push_, krykna_push_, krykna_place_, krykna_place_skip_, krykna_place_pick_, fluctuation_swap_, fluctuation_skip_
 */
import { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, ButtonStyle } from 'discord.js';
import { getPlayerId, getInitiativePlayerNum, opponentPlayerNum } from '../game/player-helpers.js';
import { edgeKey, normalizeCoord } from '../game/coords.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { getMissionFlag } from '../data-loader.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { parseCustomId } from '../discord/custom-id.js';
import { buildRowPickerButtons, cleanupSpacePick } from '../discord/components.js';
import { getValidKryknaPlacementSpaces } from '../game/mission-rules.js';
import { continueAfterFluctuationSwap } from './round.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, canActAsPlayer, saveGames, client, logGameAction, getMapTokensData, postDevaronDoorButtons, postDevaronCratePushPrompts
 */
export async function handleDevaronDoorOpen(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, getMapTokensData, postDevaronDoorButtons, postDevaronCratePushPrompts } = ctx;
    // customId: devaron_door_open_{gameId}_{a}|{b}
    const rest = parseCustomId(interaction.customId, 'devaron_door_open_');
    const pipeIdx = rest.indexOf('|');
    if (pipeIdx < 0) return;
    const beforePipe = rest.substring(0, pipeIdx);
    const afterPipe = rest.substring(pipeIdx + 1);
    const lastUnderscore = beforePipe.lastIndexOf('_');
    const gameId = beforePipe.substring(0, lastUnderscore);
    const edgeA = beforePipe.substring(lastUnderscore + 1);
    const openedEdgeKey = edgeKey(edgeA, afterPipe);
    const game = await requireGame(interaction, getGame, gameId);
    if (!game) return;
    const pending = game.pendingDoorSelections?.[0];
    if (!pending) { await interaction.followUp({ content: 'No pending door selections.', ephemeral: true }).catch(discordCatch); return; }
    if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the controlling player can select a door.')) return;
    await interaction.deferUpdate().catch(discordCatch);
    game.openedDoors = game.openedDoors || [];
    if (!game.openedDoors.includes(openedEdgeKey)) game.openedDoors.push(openedEdgeKey);
    const pid = getPlayerId(game, pending.playerNum);
    await logGameAction(game, client, `🚪 <@${pid}> opened door **${edgeA.toUpperCase()}↔${afterPipe.toUpperCase()}** (Crate Rush — terminal effect).`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
    pending.doorsRemaining--;
    if (pending.doorsRemaining <= 0) game.pendingDoorSelections.shift();
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    const allDoors = getMapTokensData()['devaron-garrison']?.doors || [];
    const generalCh = await fetchGameChannel(client, game.generalId);
    if (game.pendingDoorSelections.length > 0) {
      await postDevaronDoorButtons(game, allDoors, generalCh, gameId);
    } else {
      await postDevaronCratePushPrompts(game, generalCh, gameId);
    }
    saveGames(game.gameId);
    return;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, canActAsPlayer, client, getSpaceController
 */
export async function handleDevaronCratePush(interaction, ctx) {
  const { getGame, canActAsPlayer, client, getSpaceController } = ctx;
    // customId: devaron_crate_push_{gameId}_{origCoord}
    const rest = parseCustomId(interaction.customId, 'devaron_crate_push_');
    const lastUnderscore = rest.lastIndexOf('_');
    const gameId = rest.substring(0, lastUnderscore);
    const origCoord = rest.substring(lastUnderscore + 1);
    const game = await requireGame(interaction, getGame, gameId);
    if (!game) return;
    const curCoord = String(game.cratePositions?.[origCoord] || origCoord).toLowerCase();
    const controller = getSpaceController(game, 'devaron-garrison', curCoord);
    if (!controller) { await interaction.followUp({ content: 'No one controls this crate currently.', ephemeral: true }).catch(discordCatch); return; }
    if (!await requirePlayer(interaction, game, interaction.user.id, controller, canActAsPlayer, 'Only the controlling player can push this crate.')) return;
    // Push distance from rule data — pushControlledCratesUpTo: 3 in
    // mission-cards.json's devaron-garrison b rules. Read so the UI label and
    // (downstream) validation aren't hardcoded.
    const pushMaxRule = getMissionFlag('devaron-garrison', game.selectedMission?.variant || 'b', 'pushControlledCratesUpTo');
    const pushMax = typeof pushMaxRule === 'number' ? pushMaxRule : 3;
    const modal = new ModalBuilder()
      .setCustomId(`devaron_crate_modal_${gameId}_${origCoord}`)
      .setTitle(`Push crate (at ${curCoord.toUpperCase()})`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_coord')
          .setLabel(`Target space (up to ${pushMax} spaces, e.g. K12)`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(curCoord.toUpperCase())
          .setRequired(true)
      )
    );
    await interaction.showModal(modal).catch(discordCatch);
    return;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, canActAsPlayer, client
 */
export async function handleKryknaPush(interaction, ctx) {
  const { getGame, canActAsPlayer, client } = ctx;
    // customId: krykna_push_{gameId}_krykna-{N}
    const rest = parseCustomId(interaction.customId, 'krykna_push_');
    const kryknaIdx = rest.indexOf('krykna-');
    if (kryknaIdx < 0) return;
    const gameId = rest.substring(0, kryknaIdx - 1);
    const kryknaId = rest.substring(kryknaIdx);
    const game = await requireGame(interaction, getGame, gameId);
    if (!game) return;
    if (!game.pendingKryknaPushQueue || game.pendingKryknaPushQueue.length === 0) {
      await interaction.followUp({ content: 'No Krykna push pending.', ephemeral: true }).catch(discordCatch); return;
    }
    const expectedPlayerNum = game.pendingKryknaPushQueue[0];
    if (!await requirePlayer(interaction, game, interaction.user.id, expectedPlayerNum, canActAsPlayer, `It's Player ${expectedPlayerNum}'s turn to push a Krykna.`)) return;
    const krykna = (game.npcKrykna || []).find((k) => k.id === kryknaId);
    if (!krykna || krykna.defeated) { await interaction.followUp({ content: 'Krykna not found or already defeated.', ephemeral: true }).catch(discordCatch); return; }
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
    await interaction.showModal(modal).catch(discordCatch);
    return;
}

/**
 * Handle fluctuation swap pick (first or second).
 * First click: saves source coord to game.pendingFluctuationSwapFirst, re-posts target buttons.
 * Second click: executes swap, advances queue. If queue empty, continues round flow.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleFluctuationSwap(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction, postFluctuationSwapButtons } = ctx;
  // customId: fluctuation_swap_{gameId}_{coord}
  const rest = parseCustomId(interaction.customId, 'fluctuation_swap_');
  const lastUnderscore = rest.lastIndexOf('_');
  const gameId = rest.substring(0, lastUnderscore);
  const coord = rest.substring(lastUnderscore + 1).toLowerCase();
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingFluctuationSwapQueue || game.pendingFluctuationSwapQueue.length === 0) {
    await interaction.followUp({ content: 'No fluctuation swap pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const expectedPlayerNum = game.pendingFluctuationSwapQueue[0];
  const expectedPlayerId = getPlayerId(game, expectedPlayerNum);
  if (interaction.user.id !== expectedPlayerId) {
    await interaction.followUp({ content: `It's Player ${expectedPlayerNum}'s turn to swap a fluctuation.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch);

  if (!game.pendingFluctuationSwapFirst) {
    // First pick — save source, re-post target buttons
    game.pendingFluctuationSwapFirst = coord;
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    const generalCh = await fetchGameChannel(client, game.generalId);
    if (postFluctuationSwapButtons) {
      await postFluctuationSwapButtons(game, generalCh, gameId, expectedPlayerNum);
    }
    saveGames(game.gameId);
    return;
  }

  // Second pick — execute the swap
  const source = game.pendingFluctuationSwapFirst;
  const target = coord;
  game.pendingFluctuationSwapFirst = null;

  // Find which token type IDs contain source and target coords
  const positions = game.fluctuationPositions || {};
  let sourceTypeId = null, sourceIdx = -1;
  let targetTypeId = null, targetIdx = -1;
  for (const [id, coords] of Object.entries(positions)) {
    if (!Array.isArray(coords)) continue;
    const sIdx = coords.findIndex(c => normalizeCoord(c) === normalizeCoord(source));
    if (sIdx >= 0) { sourceTypeId = id; sourceIdx = sIdx; }
    const tIdx = coords.findIndex(c => normalizeCoord(c) === normalizeCoord(target));
    if (tIdx >= 0) { targetTypeId = id; targetIdx = tIdx; }
  }
  if (sourceTypeId === null || targetTypeId === null) {
    await interaction.followUp({ content: 'Could not find fluctuation positions to swap.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Swap the coordinates between the two token type arrays
  positions[sourceTypeId][sourceIdx] = normalizeCoord(target);
  positions[targetTypeId][targetIdx] = normalizeCoord(source);

  // Mark both coords as swapped this round
  game.fluctuationSwappedThisRound = game.fluctuationSwappedThisRound || [];
  game.fluctuationSwappedThisRound.push(normalizeCoord(source), normalizeCoord(target));

  const pid = getPlayerId(game, expectedPlayerNum);
  await logGameAction(game, client, `🔄 <@${pid}> swapped fluctuations **${source.toUpperCase()}** ↔ **${target.toUpperCase()}**.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Advance queue
  game.pendingFluctuationSwapQueue.shift();
  if (game.pendingFluctuationSwapQueue.length > 0) {
    // Next player's turn to swap
    const nextPn = game.pendingFluctuationSwapQueue[0];
    const generalCh = await fetchGameChannel(client, game.generalId);
    if (postFluctuationSwapButtons) {
      await postFluctuationSwapButtons(game, generalCh, gameId, nextPn);
    }
    saveGames(game.gameId);
    return;
  }

  // Queue empty — continue round flow
  await continueAfterFluctuationSwap(game, gameId, interaction, ctx);
  saveGames(game.gameId);
}

/**
 * Handle fluctuation swap skip (player declines to swap).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleFluctuationSkip(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction, postFluctuationSwapButtons } = ctx;
  const gameId = parseCustomId(interaction.customId, 'fluctuation_skip_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingFluctuationSwapQueue || game.pendingFluctuationSwapQueue.length === 0) {
    await interaction.followUp({ content: 'No fluctuation swap pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const expectedPlayerNum = game.pendingFluctuationSwapQueue[0];
  const expectedPlayerId = getPlayerId(game, expectedPlayerNum);
  if (interaction.user.id !== expectedPlayerId) {
    await interaction.followUp({ content: `It's Player ${expectedPlayerNum}'s turn to swap a fluctuation.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch);

  // Clear any first-pick state
  game.pendingFluctuationSwapFirst = null;

  const pid = getPlayerId(game, expectedPlayerNum);
  await logGameAction(game, client, `🔄 <@${pid}> skipped fluctuation swap.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Advance queue
  game.pendingFluctuationSwapQueue.shift();
  if (game.pendingFluctuationSwapQueue.length > 0) {
    // Next player's turn to swap
    const nextPn = game.pendingFluctuationSwapQueue[0];
    const generalCh = await fetchGameChannel(client, game.generalId);
    if (postFluctuationSwapButtons) {
      await postFluctuationSwapButtons(game, generalCh, gameId, nextPn);
    }
    saveGames(game.gameId);
    return;
  }

  // Queue empty — continue round flow
  await continueAfterFluctuationSwap(game, gameId, interaction, ctx);
  saveGames(game.gameId);
}

// ── Claimed Krykna Placement handlers ──────────────────────────────────────

/**
 * Player clicks "Place a Krykna" — show space grid for opponent's deployment zone.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleKryknaPlace(interaction, ctx) {
  const { getGame, saveGames, canActAsPlayer } = ctx;
  const gameId = parseCustomId(interaction.customId, 'krykna_place_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingClaimedKryknaQueue || game.pendingClaimedKryknaQueue.length === 0) {
    await interaction.followUp({ content: 'No Krykna placement pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const expectedPlayerNum = game.pendingClaimedKryknaQueue[0];
  if (!await requirePlayer(interaction, game, interaction.user.id, expectedPlayerNum, canActAsPlayer, `It's Player ${expectedPlayerNum}'s turn to place a Krykna.`)) return;

  const claimed = game.claimedKrykna?.[expectedPlayerNum] || 0;
  if (claimed <= 0) {
    await interaction.followUp({ content: 'You have no claimed Krykna to place.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const mapId = game.selectedMap?.id;
  const validSpaces = getValidKryknaPlacementSpaces(game, expectedPlayerNum, mapId);
  if (validSpaces.length === 0) {
    await interaction.followUp({ content: 'No valid spaces in opponent\'s deployment zone (all occupied).', ephemeral: true }).catch(discordCatch);
    return;
  }

  await interaction.deferUpdate().catch(discordCatch);

  // Set up pendingSpacePick for the generic space picker
  const contextKey = `${gameId}_krykna_place`;
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[contextKey] = {
    validSpaces,
    cellPrefix: `krykna_place_pick_${gameId}_`,
    mapSpaces: null,
    headerText: `Place claimed Krykna in opponent's deployment zone`,
    style: ButtonStyle.Success,
  };

  const { rows } = buildRowPickerButtons(validSpaces, `space_row_${contextKey}_`, { style: ButtonStyle.Success });
  await interaction.message.edit({
    content: `🕷️ **Place Krykna** — Pick a row, then a space in opponent's deployment zone:`,
    components: rows.slice(0, 5),
  }).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Player clicks "Skip" — declines to place a claimed Krykna this round.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleKryknaPlaceSkip(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction, canActAsPlayer, postKryknaPlaceButtons } = ctx;
  const gameId = parseCustomId(interaction.customId, 'krykna_place_skip_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingClaimedKryknaQueue || game.pendingClaimedKryknaQueue.length === 0) {
    await interaction.followUp({ content: 'No Krykna placement pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const expectedPlayerNum = game.pendingClaimedKryknaQueue[0];
  if (!await requirePlayer(interaction, game, interaction.user.id, expectedPlayerNum, canActAsPlayer, `It's Player ${expectedPlayerNum}'s turn to place a Krykna.`)) return;

  await interaction.deferUpdate().catch(discordCatch);
  const pid = getPlayerId(game, expectedPlayerNum);
  await logGameAction(game, client, `🕷️ <@${pid}> skipped claimed Krykna placement.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Advance queue
  game.pendingClaimedKryknaQueue.shift();
  if (game.pendingClaimedKryknaQueue.length > 0) {
    const generalCh = await fetchGameChannel(client, game.generalId);
    if (generalCh && postKryknaPlaceButtons) {
      await postKryknaPlaceButtons(game, generalCh, gameId, { getPlayerId, discordCatch });
    }
  } else {
    delete game.pendingClaimedKryknaQueue;
  }
  saveGames(game.gameId);
}

/**
 * Player picked a space from the grid — place a Krykna NPC there.
 * customId: krykna_place_pick_{gameId}_{coord}
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleKryknaPlacePick(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction, canActAsPlayer, postKryknaPlaceButtons } = ctx;
  const rest = parseCustomId(interaction.customId, 'krykna_place_pick_');
  const lastUnderscore = rest.lastIndexOf('_');
  const gameId = rest.substring(0, lastUnderscore);
  const coord = rest.substring(lastUnderscore + 1).toLowerCase();
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingClaimedKryknaQueue || game.pendingClaimedKryknaQueue.length === 0) {
    await interaction.followUp({ content: 'No Krykna placement pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const expectedPlayerNum = game.pendingClaimedKryknaQueue[0];
  if (!await requirePlayer(interaction, game, interaction.user.id, expectedPlayerNum, canActAsPlayer, `It's Player ${expectedPlayerNum}'s turn to place a Krykna.`)) return;

  // Validate the coord is still valid (occupancy may have changed)
  const mapId = game.selectedMap?.id;
  const validSpaces = getValidKryknaPlacementSpaces(game, expectedPlayerNum, mapId);
  if (!validSpaces.includes(normalizeCoord(coord))) {
    await interaction.followUp({ content: `${coord.toUpperCase()} is not a valid placement space (occupied or outside zone).`, ephemeral: true }).catch(discordCatch);
    return;
  }

  await interaction.deferUpdate().catch(discordCatch);

  // Place a new Krykna NPC
  const nextId = `krykna-${(game.npcKrykna || []).length + 1}`;
  game.npcKrykna = game.npcKrykna || [];
  game.npcKrykna.push({ id: nextId, coord: normalizeCoord(coord), hp: 8, maxHp: 8, defeated: false });

  // Decrement claimed count
  game.claimedKrykna[expectedPlayerNum] = Math.max(0, (game.claimedKrykna[expectedPlayerNum] || 0) - 1);

  // Clean up space picker
  cleanupSpacePick(game, `${gameId}_krykna_place`);

  const pid = getPlayerId(game, expectedPlayerNum);
  await logGameAction(game, client, `🕷️ <@${pid}> placed a claimed Krykna at **${coord.toUpperCase()}** (${nextId}).`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Advance queue
  game.pendingClaimedKryknaQueue.shift();
  if (game.pendingClaimedKryknaQueue.length > 0) {
    const generalCh = await fetchGameChannel(client, game.generalId);
    if (generalCh && postKryknaPlaceButtons) {
      await postKryknaPlaceButtons(game, generalCh, gameId, { getPlayerId, discordCatch });
    }
  } else {
    delete game.pendingClaimedKryknaQueue;
  }
  saveGames(game.gameId);
}
