/**
 * Map event handlers: devaron_door_open_, devaron_crate_push_, krykna_push_
 */
import { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getPlayerId } from '../game/player-helpers.js';
import { edgeKey } from '../game/coords.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, canActAsPlayer, saveGames, client, logGameAction, getMapTokensData, postDevaronDoorButtons, postDevaronCratePushPrompts
 */
export async function handleDevaronDoorOpen(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, getMapTokensData, postDevaronDoorButtons, postDevaronCratePushPrompts } = ctx;
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
    const generalCh = await client.channels.fetch(game.generalId);
    if (game.pendingDoorSelections.length > 0) {
      await postDevaronDoorButtons(game, allDoors, generalCh, gameId);
    } else {
      await postDevaronCratePushPrompts(game, generalCh, gameId);
    }
    saveGames();
    return;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, canActAsPlayer, client, getSpaceController
 */
export async function handleDevaronCratePush(interaction, ctx) {
  const { getGame, canActAsPlayer, client, getSpaceController } = ctx;
    // customId: devaron_crate_push_{gameId}_{origCoord}
    const rest = interaction.customId.replace('devaron_crate_push_', '');
    const lastUnderscore = rest.lastIndexOf('_');
    const gameId = rest.substring(0, lastUnderscore);
    const origCoord = rest.substring(lastUnderscore + 1);
    const game = await requireGame(interaction, getGame, gameId);
    if (!game) return;
    const curCoord = String(game.cratePositions?.[origCoord] || origCoord).toLowerCase();
    const controller = getSpaceController(game, 'devaron-garrison', curCoord);
    if (!controller) { await interaction.followUp({ content: 'No one controls this crate currently.', ephemeral: true }).catch(discordCatch); return; }
    if (!await requirePlayer(interaction, game, interaction.user.id, controller, canActAsPlayer, 'Only the controlling player can push this crate.')) return;
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
    const rest = interaction.customId.replace('krykna_push_', '');
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
