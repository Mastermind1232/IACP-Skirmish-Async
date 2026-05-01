/**
 * Favorite squad confirmation UI builders.
 * Lives in src/discord/ so engine code can use it without importing from handlers/.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * Build the favorite-aware button row for the squad confirmation message.
 * @param {string} gameId
 * @param {number} playerNum
 * @param {object|null} existingFavorite - row from DB if deck is already a favorite, null otherwise
 * @returns {ActionRowBuilder}
 */
export function buildFavoriteConfirmButtons(gameId, playerNum, existingFavorite) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`squad_confirm_${gameId}_${playerNum}`)
      .setLabel('Confirm Deck')
      .setStyle(ButtonStyle.Success),
  ];

  if (existingFavorite) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`fav_rename_${gameId}_${playerNum}`)
        .setLabel('Rename Favorite')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`fav_remove_${gameId}_${playerNum}`)
        .setLabel('Remove Favorite')
        .setStyle(ButtonStyle.Danger),
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`fav_save_${gameId}_${playerNum}`)
        .setLabel('Save to Favorites')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`squad_cancel_${gameId}_${playerNum}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return new ActionRowBuilder().addComponents(...buttons);
}

/**
 * Build confirmation message content, optionally prepending the favorite indicator.
 */
export function buildFavoriteConfirmContent(baseText, existingFavorite) {
  if (!existingFavorite) return baseText;
  return `★ **Saved favorite:** "${existingFavorite.saved_name}"\n\n${baseText}`;
}
