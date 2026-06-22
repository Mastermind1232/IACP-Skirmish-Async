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
 *   { validSpaces, cellPrefix, mapSpaces, labelMap?, headerText?, style?, actionButtons? }
 *
 * actionButtons (optional): serializable button descriptors shown alongside Back on cell view
 * and alongside rows on row view. Format: [{ customId, label, style (ButtonStyle int) }]
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

// Cell button-rows per page (4 rows × 5 = 20 cells); the 5th row holds Back +
// Prev/Next + any flow action buttons.
const CELL_ROWS_PER_PAGE = 4;

/**
 * Render one page of a row's cells. A board row can hold up to ~36 cells
 * (corellian-underground), which exceeds Discord's 25-button / 5-row max, so
 * wide rows paginate (alexanbv 2026-06-21) — no cell is ever dropped. The cell
 * buttons keep their `${cellPrefix}${space}` customIds, so the flows' own cell
 * handlers are unchanged.
 */
async function _renderRowCells(interaction, pending, contextKey, rowNum, page) {
  const filtered = filterSpacesToRow(pending.validSpaces, rowNum);
  const displayRow = rowNum + (pending.rowDisplayOffset || 0);
  if (filtered.length === 0) {
    await interaction.followUp({ content: `No spaces in Row ${displayRow}.`, ephemeral: true }).catch(discordCatch);
    return;
  }

  const { rows: cellRows } = getSpaceChoiceRows(
    pending.cellPrefix,
    filtered,
    pending.mapSpaces,
    Infinity,
    pending.labelMap || {},
  );

  const totalPages = Math.max(1, Math.ceil(cellRows.length / CELL_ROWS_PER_PAGE));
  const pg = Math.max(0, Math.min(page || 0, totalPages - 1));
  const pageCellRows = cellRows.slice(pg * CELL_ROWS_PER_PAGE, pg * CELL_ROWS_PER_PAGE + CELL_ROWS_PER_PAGE);

  const navBtns = [
    new ButtonBuilder().setCustomId(`space_row_back_${contextKey}`).setLabel('Back to Rows').setStyle(ButtonStyle.Secondary),
  ];
  if (totalPages > 1) {
    if (pg > 0) navBtns.push(new ButtonBuilder().setCustomId(`space_cellpg_${contextKey}_${rowNum}_${pg - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary));
    if (pg < totalPages - 1) navBtns.push(new ButtonBuilder().setCustomId(`space_cellpg_${contextKey}_${rowNum}_${pg + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary));
  }
  for (const b of (pending.actionButtons || [])) {
    navBtns.push(new ButtonBuilder().setCustomId(b.customId).setLabel(b.label).setStyle(b.style || ButtonStyle.Secondary));
  }
  // Discord caps an ActionRow at 5 buttons — Back + Prev + Next + up to 2 extras.
  const actionRow = new ActionRowBuilder().addComponents(...navBtns.slice(0, 5));
  const components = [...pageCellRows, actionRow];

  const pageNote = totalPages > 1 ? ` — page ${pg + 1}/${totalPages}` : '';
  try {
    await interaction.message.edit({
      content: `${pending.headerText || 'Pick a space'} — **Row ${displayRow}** (${filtered.length} space${filtered.length !== 1 ? 's' : ''})${pageNote}:`,
      components,
    });
  } catch {
    await interaction.followUp({
      content: `**Row ${displayRow}** — pick a space${pageNote}:`,
      components,
      ephemeral: false,
    }).catch(discordCatch);
  }
}

/**
 * Handle space_row_{contextKey}_{rowNum}: user picked a row, show cells (page 0).
 */
export async function handleSpaceRow(interaction, ctx) {
  const { getGame } = ctx;
  let contextKey, rowNum;
  if (interaction.isStringSelectMenu?.() && interaction.values?.length) {
    // Select-menu form (maps with >20 rows): customId `space_row_<contextKey>_`
    // (trailing `_`, no row number); the chosen row is in values[0].
    contextKey = interaction.customId.replace(/^space_row_/, '').replace(/_$/, '');
    rowNum = parseInt(interaction.values[0], 10);
  } else {
    // Button form: customId `space_row_<contextKey>_<rowNum>` (contextKey may
    // contain underscores; rowNum is the last numeric segment).
    const m = interaction.customId.match(/^space_row_(.+)_(\d+)$/);
    if (!m) {
      await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
      return;
    }
    contextKey = m[1];
    rowNum = parseInt(m[2], 10);
  }
  const gameId = contextKey.split('_')[0];

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const pending = game.pendingSpacePick?.[contextKey];
  if (!pending) {
    await interaction.followUp({ content: 'Space selection expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await _renderRowCells(interaction, pending, contextKey, rowNum, 0);
}

/**
 * Handle space_cellpg_{contextKey}_{rowNum}_{page}: page through a wide row's cells.
 */
export async function handleSpaceCellPage(interaction, ctx) {
  const { getGame } = ctx;
  // contextKey may contain underscores; rowNum and page are the last two numerics
  const m = interaction.customId.match(/^space_cellpg_(.+)_(\d+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, contextKey, rowNumStr, pageStr] = m;
  const gameId = contextKey.split('_')[0];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingSpacePick?.[contextKey];
  if (!pending) {
    await interaction.followUp({ content: 'Space selection expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await _renderRowCells(interaction, pending, contextKey, parseInt(rowNumStr, 10), parseInt(pageStr, 10));
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
    { style: pending.style || ButtonStyle.Primary, rowDisplayOffset: pending.rowDisplayOffset || 0 },
  );

  const maxRowBtns = pending.actionButtons?.length ? 4 : 5;
  const components = rows.slice(0, maxRowBtns);
  if (pending.actionButtons?.length) {
    const extraBtns = pending.actionButtons.map(b =>
      new ButtonBuilder().setCustomId(b.customId).setLabel(b.label).setStyle(b.style || ButtonStyle.Secondary)
    );
    components.push(new ActionRowBuilder().addComponents(...extraBtns));
  }

  try {
    await interaction.message.edit({
      content: pending.headerText || 'Pick a row:',
      components,
    });
  } catch {
    await interaction.followUp({
      content: pending.headerText || 'Pick a row:',
      components,
      ephemeral: false,
    }).catch(discordCatch);
  }
}
