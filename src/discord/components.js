import { ActionRowBuilder, ButtonStyle } from 'discord.js';

const MAX_BUTTONS_PER_ROW = 5;
const MAX_ROWS_PER_MESSAGE = 5;

/**
 * Area-based button styles per plan 2.5: combat=red, confirm=green, cancel=grey, etc.
 * @param {string} area - 'attack'|'confirm'|'cancel'|'destructive'|'setup'|'movement'|'surge'|'interact'|'primary'|'secondary'
 */
export function getButtonStyle(area) {
  switch (area) {
    case 'attack':
    case 'destructive':
      return ButtonStyle.Danger;
    case 'confirm':
    case 'setup':
      return ButtonStyle.Success;
    case 'cancel':
    case 'movement':
    case 'interact':
    case 'surge':
      return ButtonStyle.Secondary;
    case 'primary':
      return ButtonStyle.Primary;
    case 'secondary':
    default:
      return ButtonStyle.Secondary;
  }
}

/**
 * Chunk an array of button components into ActionRows with at most maxPerRow buttons per row.
 * Enforces Discord limit of 5 buttons per row and 5 rows per message.
 * @param {import('discord.js').ButtonBuilder[]} components
 * @param {number} [maxPerRow=5]
 */
export function chunkButtonsToRows(components, maxPerRow = MAX_BUTTONS_PER_ROW) {
  const capped = Math.min(maxPerRow, MAX_BUTTONS_PER_ROW);
  const rows = [];
  for (let r = 0; r < components.length && rows.length < MAX_ROWS_PER_MESSAGE; r += capped) {
    const slice = components.slice(r, r + capped);
    rows.push(new ActionRowBuilder().addComponents(...slice));
  }
  return rows;
}

export { MAX_BUTTONS_PER_ROW, MAX_ROWS_PER_MESSAGE };
