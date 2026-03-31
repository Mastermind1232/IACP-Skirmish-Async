/**
 * Generic 2-step space picker handlers: space_row_, space_row_back_
 *
 * Usage contract:
 * 1. Flow stores game.pendingSpacePick[contextKey] with validSpaces, cellPrefix, etc.
 * 2. Flow calls buildRowPickerButtons(validSpaces, `space_row_${contextKey}_`, options)
 * 3. These generic handlers manage the row→cell→back cycle
 * 4. Cell pick still routes to the flow's own handler (via cellPrefix)
 * 5. Flow's cell handler calls cleanupSpacePick(game, contextKey) on resolution
 *
 * pendingSpacePick[contextKey] shape:
 *   { validSpaces, cellPrefix, mapSpaces, labelMap?, headerText?, style? }
 *
 * contextKey format: must start with gameId (e.g. '00001_msgId' or '00001_msgId_figIdx').
 * gameId is extracted as contextKey.split('_')[0].
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  buildRowPickerButtons,
  filterSpacesToRow,
  getSpaceChoiceRows,
} from '../discord/components.js';
import { requireGame } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';

/**
 * Handle space_row_{contextKey}_{rowNum}: user picked a row, show cells in that row.
 */
export async function handleSpaceRow(interaction, ctx) {
  const { getGame } = ctx;
  // contextKey can contain underscores; rowNum is always the last numeric segment
  const m = interaction.customId.match(/^space_row_(.+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, contextKey, rowNumStr] = m;
  const rowNum = parseInt(rowNumStr, 10);
  const gameId = contextKey.split('_')[0];

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const pending = game.pendingSpacePick?.[contextKey];
  if (!pending) {
    await interaction.followUp({ content: 'Space selection expired.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const filtered = filterSpacesToRow(pending.validSpaces, rowNum);
  if (filtered.length === 0) {
    await interaction.followUp({ content: `No spaces in Row ${rowNum}.`, ephemeral: true }).catch(discordCatch);
    return;
  }

  const { rows: cellRows } = getSpaceChoiceRows(
    pending.cellPrefix,
    filtered,
    pending.mapSpaces,
    Infinity,
    pending.labelMap || {},
  );

  const backBtn = new ButtonBuilder()
    .setCustomId(`space_row_back_${contextKey}`)
    .setLabel('Back to Rows')
    .setStyle(ButtonStyle.Secondary);
  const backRow = new ActionRowBuilder().addComponents(backBtn);

  const components = [...cellRows.slice(0, 4), backRow];

  try {
    await interaction.message.edit({
      content: `${pending.headerText || 'Pick a space'} — **Row ${rowNum}** (${filtered.length} space${filtered.length !== 1 ? 's' : ''}):`,
      components,
    });
  } catch {
    await interaction.followUp({
      content: `**Row ${rowNum}** — pick a space:`,
      components,
      ephemeral: false,
    }).catch(discordCatch);
  }
}

/**
 * Handle space_row_back_{contextKey}: return to the row picker.
 */
export async function handleSpaceRowBack(interaction, ctx) {
  const { getGame } = ctx;
  const m = interaction.customId.match(/^space_row_back_(.+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, contextKey] = m;
  const gameId = contextKey.split('_')[0];

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const pending = game.pendingSpacePick?.[contextKey];
  if (!pending) {
    await interaction.followUp({ content: 'Space selection expired.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const { rows } = buildRowPickerButtons(
    pending.validSpaces,
    `space_row_${contextKey}_`,
    { style: pending.style || ButtonStyle.Primary },
  );

  try {
    await interaction.message.edit({
      content: pending.headerText || 'Pick a row:',
      components: rows.slice(0, 5),
    });
  } catch {
    await interaction.followUp({
      content: pending.headerText || 'Pick a row:',
      components: rows.slice(0, 5),
      ephemeral: false,
    }).catch(discordCatch);
  }
}
