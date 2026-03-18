/**
 * Favorite deck handlers for setup flow and /favorites management.
 *
 * Button prefixes: fav_save_, fav_remove_, fav_rename_, fav_choose_, fav_choose_select_
 * Modal prefixes: fav_name_modal_, fav_rename_modal_
 * /favorites list: fav_list_select_, fav_list_rename_, fav_list_remove_, fav_list_back_
 * /favorites modal: fav_list_rename_modal_
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { splitCustomId } from '../discord/custom-id.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { normalizeSquadInput, validateDeckLegal } from '../game/validation.js';
import { computeDeckHash } from '../game/deck-hash.js';
import {
  isFavoritesAvailable,
  getFavoriteDecks,
  getFavoriteDeckByHash,
  getFavoriteDeckById,
  insertFavoriteDeck,
  deleteFavoriteDeck,
  renameFavoriteDeck,
  touchFavoriteDeckUsage,
} from '../db.js';
import { validateArmyAffiliation } from '../game/validation.js';
import { truncateLabel } from '../discord/components.js';
import { getPlayerId } from '../game/player-helpers.js';

const UNAVAILABLE_MSG = 'Favorites are unavailable right now.';
const MAX_SELECT_OPTIONS = 25;
const MAX_DESCRIPTION_LENGTH = 100;

/** Truncate a string for select menu description (max 100 chars in Discord). */
function truncateDescription(s, max = MAX_DESCRIPTION_LENGTH) {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

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

// ── Setup flow handlers ──

/** Save to Favorites button → show naming modal */
export async function handleFavSave(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const { getGame, pendingSquadConfirm, PENDING_ILLEGAL_TTL_MS } = ctx;
  const parts = splitCustomId(interaction.customId, 'fav_save_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can save favorites.')) return;

  const key = `${gameId}_${playerNum}`;
  const pending = pendingSquadConfirm.get(key);
  if (!pending || (Date.now() - pending.timestamp > PENDING_ILLEGAL_TTL_MS)) {
    await interaction.reply({ content: 'This squad confirmation has expired. Please submit your squad again.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`fav_name_modal_${gameId}_${playerNum}`)
    .setTitle('Name Your Favorite');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('fav_deck_name')
        .setLabel('Favorite Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Vader\'s Fist')
        .setRequired(true)
        .setMaxLength(100)
    ),
  );
  await interaction.showModal(modal);
}

/** Save to Favorites modal submit → insert into DB */
export async function handleFavNameModal(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const { getGame, pendingSquadConfirm, PENDING_ILLEGAL_TTL_MS } = ctx;
  const parts = splitCustomId(interaction.customId, 'fav_name_modal_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId, { useReply: true });
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can save favorites.', { useReply: true })) return;

  const key = `${gameId}_${playerNum}`;
  const pending = pendingSquadConfirm.get(key);
  if (!pending || (Date.now() - pending.timestamp > PENDING_ILLEGAL_TTL_MS)) {
    await interaction.reply({ content: 'This squad confirmation has expired. Please submit your squad again.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const savedName = interaction.fields.getTextInputValue('fav_deck_name').trim();
  if (!savedName) {
    await interaction.reply({ content: 'Favorite name cannot be empty.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const squad = pending.squad;
  const deckHash = computeDeckHash(squad);
  const userId = interaction.user.id;

  // Check if already exists
  const existing = await getFavoriteDeckByHash(userId, deckHash);
  if (existing) {
    await interaction.reply({ content: `This deck is already saved as **"${existing.saved_name}"**.`, ephemeral: true }).catch(discordCatch);
    return;
  }

  const { primaryAffiliation } = validateArmyAffiliation(squad);
  const validation = pending.validation;
  const deckData = { dcList: squad.dcList, ccList: squad.ccList, dcCount: squad.dcCount, ccCount: squad.ccCount };
  const rawText = squad._rawListText || null;

  const row = await insertFavoriteDeck(userId, deckHash, savedName, deckData, rawText, primaryAffiliation, validation.dcTotal);
  if (!row) {
    await interaction.reply({ content: 'This deck is already saved as a favorite.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Update the pending entry to track that it's now a favorite
  pending._favoriteId = row.id;
  pending._favoriteName = savedName;

  // Refresh the confirmation message with favorite-aware buttons
  const favoriteInfo = { saved_name: savedName, id: row.id };
  try {
    const text = buildFavoriteConfirmContent(interaction.message.content, favoriteInfo);
    const buttons = buildFavoriteConfirmButtons(gameId, playerNum, favoriteInfo);
    await interaction.message.edit({ content: text, components: [buttons] }).catch(discordCatch);
  } catch { /* non-fatal: buttons may have been removed */ }

  await interaction.reply({ content: `Saved to favorites as **"${savedName}"**.`, ephemeral: true }).catch(discordCatch);
}

/** Remove Favorite button (setup flow) */
export async function handleFavRemove(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const { getGame, pendingSquadConfirm, PENDING_ILLEGAL_TTL_MS } = ctx;
  const parts = splitCustomId(interaction.customId, 'fav_remove_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can remove favorites.')) return;

  const key = `${gameId}_${playerNum}`;
  const pending = pendingSquadConfirm.get(key);
  if (!pending || (Date.now() - pending.timestamp > PENDING_ILLEGAL_TTL_MS)) {
    await interaction.reply({ content: 'This squad confirmation has expired. Please submit your squad again.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const squad = pending.squad;
  const deckHash = computeDeckHash(squad);
  const userId = interaction.user.id;
  const existing = await getFavoriteDeckByHash(userId, deckHash);
  if (!existing) {
    await interaction.reply({ content: 'This deck is not in your favorites.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await deleteFavoriteDeck(userId, existing.id);
  delete pending._favoriteId;
  delete pending._favoriteName;

  // Refresh: swap back to Save to Favorites
  try {
    // Strip the ★ favorite indicator from the content
    const content = interaction.message.content.replace(/^★ \*\*Saved favorite:\*\* "[^"]*"\n\n/, '');
    const buttons = buildFavoriteConfirmButtons(gameId, playerNum, null);
    await interaction.message.edit({ content, components: [buttons] }).catch(discordCatch);
  } catch { /* non-fatal */ }

  await interaction.reply({ content: 'Removed from favorites.', ephemeral: true }).catch(discordCatch);
}

/** Rename Favorite button (setup flow) → show rename modal */
export async function handleFavRename(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const { getGame, pendingSquadConfirm, PENDING_ILLEGAL_TTL_MS } = ctx;
  const parts = splitCustomId(interaction.customId, 'fav_rename_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can rename favorites.')) return;

  const key = `${gameId}_${playerNum}`;
  const pending = pendingSquadConfirm.get(key);
  if (!pending || (Date.now() - pending.timestamp > PENDING_ILLEGAL_TTL_MS)) {
    await interaction.reply({ content: 'This squad confirmation has expired. Please submit your squad again.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const squad = pending.squad;
  const deckHash = computeDeckHash(squad);
  const userId = interaction.user.id;
  const existing = await getFavoriteDeckByHash(userId, deckHash);
  if (!existing) {
    await interaction.reply({ content: 'This deck is not in your favorites.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`fav_rename_modal_${gameId}_${playerNum}`)
    .setTitle('Rename Favorite');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('fav_deck_name')
        .setLabel('New Favorite Name')
        .setStyle(TextInputStyle.Short)
        .setValue(existing.saved_name)
        .setRequired(true)
        .setMaxLength(100)
    ),
  );
  await interaction.showModal(modal);
}

/** Rename Favorite modal submit (setup flow) */
export async function handleFavRenameModal(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const { getGame, pendingSquadConfirm, PENDING_ILLEGAL_TTL_MS } = ctx;
  const parts = splitCustomId(interaction.customId, 'fav_rename_modal_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId, { useReply: true });
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can rename favorites.', { useReply: true })) return;

  const key = `${gameId}_${playerNum}`;
  const pending = pendingSquadConfirm.get(key);
  if (!pending) {
    await interaction.reply({ content: 'This squad confirmation has expired.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const newName = interaction.fields.getTextInputValue('fav_deck_name').trim();
  if (!newName) {
    await interaction.reply({ content: 'Favorite name cannot be empty.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const squad = pending.squad;
  const deckHash = computeDeckHash(squad);
  const userId = interaction.user.id;
  const existing = await getFavoriteDeckByHash(userId, deckHash);
  if (!existing) {
    await interaction.reply({ content: 'This deck is not in your favorites.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await renameFavoriteDeck(userId, existing.id, newName);
  pending._favoriteName = newName;

  // Refresh the confirmation message
  try {
    const baseContent = interaction.message.content.replace(/^★ \*\*Saved favorite:\*\* "[^"]*"\n\n/, '');
    const favoriteInfo = { saved_name: newName, id: existing.id };
    const text = buildFavoriteConfirmContent(baseContent, favoriteInfo);
    const buttons = buildFavoriteConfirmButtons(gameId, playerNum, favoriteInfo);
    await interaction.message.edit({ content: text, components: [buttons] }).catch(discordCatch);
  } catch { /* non-fatal */ }

  await interaction.reply({ content: `Favorite renamed to **"${newName}"**.`, ephemeral: true }).catch(discordCatch);
}

// ── Choose from Favorites (setup flow) ──

/** Choose from Favorites button → show select menu */
export async function handleFavChoose(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const { getGame } = ctx;
  const parts = splitCustomId(interaction.customId, 'fav_choose_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can choose favorites.')) return;

  if (!game.mapSelected) {
    await interaction.reply({ content: 'Map selection must be completed before you can select your squad.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const userId = interaction.user.id;
  const favorites = await getFavoriteDecks(userId);
  if (favorites === null) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  if (favorites.length === 0) {
    await interaction.reply({ content: 'You don\'t have any saved favorites yet. Use **Enter List** to submit a deck, then save it.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const options = favorites.slice(0, MAX_SELECT_OPTIONS).map((fav) => {
    const desc = [fav.affiliation, fav.point_total != null ? `${fav.point_total}pt` : null, fav.use_count ? `used ${fav.use_count}x` : null]
      .filter(Boolean).join(' · ');
    return new StringSelectMenuOptionBuilder()
      .setLabel(truncateLabel(fav.saved_name, 100))
      .setDescription(truncateDescription(desc))
      .setValue(String(fav.id));
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`fav_choose_select_${gameId}_${playerNum}`)
    .setPlaceholder('Select a saved favorite')
    .addOptions(options);

  await interaction.reply({
    content: '**Choose from Favorites**\nSelect a saved deck to load.',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  }).catch(discordCatch);
}

/** Choose from Favorites select → load deck into confirmation flow */
export async function handleFavChooseSelect(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const { getGame, validateDeckLegal, sendSquadConfirmation } = ctx;
  const parts = splitCustomId(interaction.customId, 'fav_choose_select_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can choose favorites.')) return;

  const userId = interaction.user.id;
  const favoriteId = parseInt(interaction.values[0], 10);
  const fav = await getFavoriteDeckById(userId, favoriteId);
  if (!fav) {
    await interaction.reply({ content: 'Favorite not found.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Reconstruct squad from deck_data, using saved_name as the squad name
  const deckData = typeof fav.deck_data === 'string' ? JSON.parse(fav.deck_data) : fav.deck_data;
  const squad = {
    name: fav.saved_name,
    dcList: deckData.dcList || [],
    ccList: deckData.ccList || [],
    dcCount: deckData.dcCount ?? deckData.dcList?.length ?? 0,
    ccCount: deckData.ccCount ?? deckData.ccList?.length ?? 0,
  };

  // Re-normalize and re-validate against current card data
  normalizeSquadInput(squad);
  const validation = validateDeckLegal(squad);
  const isP1 = playerNum === 1;

  // Bump usage stats
  await touchFavoriteDeckUsage(userId, favoriteId);

  // Feed into the standard confirmation flow
  await sendSquadConfirmation(game, isP1, squad, validation, interaction.client);

  // Clean up the select menu message
  try {
    await interaction.update({ content: `Loading **"${fav.saved_name}"**…`, components: [] }).catch(discordCatch);
  } catch {
    await interaction.deferUpdate().catch(discordCatch);
  }
}

// ── /favorites list management handlers ──

/**
 * Build the /favorites list view (select menu + summary).
 * @param {Array} favorites - rows from getFavoriteDecks
 * @returns {{ content: string, components: ActionRowBuilder[] }}
 */
export function buildFavoritesListPayload(favorites) {
  if (!favorites || favorites.length === 0) {
    return {
      content: 'You don\'t have any saved favorites yet.\nSave a deck during game setup to add one here.',
      components: [],
    };
  }

  const options = favorites.slice(0, MAX_SELECT_OPTIONS).map((fav) => {
    const desc = [fav.affiliation, fav.point_total != null ? `${fav.point_total}pt` : null, fav.use_count ? `used ${fav.use_count}x` : null]
      .filter(Boolean).join(' · ');
    return new StringSelectMenuOptionBuilder()
      .setLabel(truncateLabel(fav.saved_name, 100))
      .setDescription(truncateDescription(desc || 'Saved deck'))
      .setValue(String(fav.id));
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('fav_list_select_')
    .setPlaceholder('Select a favorite to view')
    .addOptions(options);

  let content = `**Your Saved Favorites** (${favorites.length} deck${favorites.length !== 1 ? 's' : ''})`;
  if (favorites.length > MAX_SELECT_OPTIONS) {
    content += `\n*Showing ${MAX_SELECT_OPTIONS} most recently used.*`;
  }

  return {
    content,
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

/**
 * Build the /favorites detail view for a single favorite.
 * @param {object} fav - row from getFavoriteDeckById
 * @param {object} deps - { buildSquadConfirmText, validateDeckLegal }
 * @returns {{ content: string, components: ActionRowBuilder[] }}
 */
export function buildFavoriteDetailPayload(fav, deps) {
  const deckData = typeof fav.deck_data === 'string' ? JSON.parse(fav.deck_data) : fav.deck_data;
  const squad = {
    name: fav.saved_name,
    dcList: deckData.dcList || [],
    ccList: deckData.ccList || [],
    dcCount: deckData.dcCount ?? deckData.dcList?.length ?? 0,
    ccCount: deckData.ccCount ?? deckData.ccList?.length ?? 0,
  };

  normalizeSquadInput(squad);
  const validation = deps.validateDeckLegal(squad);
  const deckText = deps.buildSquadConfirmText(squad, validation);

  const affLine = fav.affiliation ? ` (${fav.affiliation}, ${fav.point_total ?? '?'}pt)` : '';
  const usageParts = [];
  if (fav.created_at) usageParts.push(`Saved: ${new Date(fav.created_at).toLocaleDateString()}`);
  if (fav.last_used_at) usageParts.push(`Last used: ${new Date(fav.last_used_at).toLocaleDateString()}`);
  if (fav.use_count) usageParts.push(`Used ${fav.use_count} time${fav.use_count !== 1 ? 's' : ''}`);
  const usageLine = usageParts.length ? `\n*${usageParts.join(' · ')}*` : '';

  const content = `★ **${fav.saved_name}**${affLine}\n\n${deckText}${usageLine}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fav_list_rename_${fav.id}`)
      .setLabel('Rename Favorite')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fav_list_remove_${fav.id}`)
      .setLabel('Remove Favorite')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('fav_list_back_')
      .setLabel('Back to List')
      .setStyle(ButtonStyle.Secondary),
  );

  return { content, components: [row] };
}

/** /favorites select menu → show detail view */
export async function handleFavListSelect(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const userId = interaction.user.id;
  const favoriteId = parseInt(interaction.values[0], 10);
  const fav = await getFavoriteDeckById(userId, favoriteId);
  if (!fav) {
    await interaction.reply({ content: 'Favorite not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { validateDeckLegal, buildSquadConfirmText } = ctx;
  const payload = buildFavoriteDetailPayload(fav, { validateDeckLegal, buildSquadConfirmText });
  await interaction.update(payload).catch(discordCatch);
}

/** /favorites rename button → show modal */
export async function handleFavListRename(interaction) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const favoriteId = splitCustomId(interaction.customId, 'fav_list_rename_')[0];
  const userId = interaction.user.id;
  const fav = await getFavoriteDeckById(userId, parseInt(favoriteId, 10));
  if (!fav) {
    await interaction.reply({ content: 'Favorite not found.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`fav_list_rename_modal_${favoriteId}`)
    .setTitle('Rename Favorite');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('fav_deck_name')
        .setLabel('New Favorite Name')
        .setStyle(TextInputStyle.Short)
        .setValue(fav.saved_name)
        .setRequired(true)
        .setMaxLength(100)
    ),
  );
  await interaction.showModal(modal);
}

/** /favorites rename modal submit */
export async function handleFavListRenameModal(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const favoriteId = parseInt(splitCustomId(interaction.customId, 'fav_list_rename_modal_')[0], 10);
  const userId = interaction.user.id;
  const fav = await getFavoriteDeckById(userId, favoriteId);
  if (!fav) {
    await interaction.reply({ content: 'Favorite not found.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const newName = interaction.fields.getTextInputValue('fav_deck_name').trim();
  if (!newName) {
    await interaction.reply({ content: 'Favorite name cannot be empty.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await renameFavoriteDeck(userId, favoriteId, newName);

  // Refresh detail view
  const { validateDeckLegal, buildSquadConfirmText } = ctx;
  const updated = await getFavoriteDeckById(userId, favoriteId);
  if (updated) {
    const payload = buildFavoriteDetailPayload(updated, { validateDeckLegal, buildSquadConfirmText });
    try {
      await interaction.message.edit(payload).catch(discordCatch);
    } catch { /* non-fatal */ }
  }
  await interaction.reply({ content: `Favorite renamed to **"${newName}"**.`, ephemeral: true }).catch(discordCatch);
}

/** /favorites remove button */
export async function handleFavListRemove(interaction, ctx) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const favoriteId = parseInt(splitCustomId(interaction.customId, 'fav_list_remove_')[0], 10);
  const userId = interaction.user.id;
  const fav = await getFavoriteDeckById(userId, favoriteId);
  if (!fav) {
    await interaction.reply({ content: 'Favorite not found.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await deleteFavoriteDeck(userId, favoriteId);

  // Refresh: go back to list view
  const favorites = await getFavoriteDecks(userId);
  const payload = buildFavoritesListPayload(favorites || []);
  try {
    await interaction.update(payload).catch(discordCatch);
  } catch {
    await interaction.reply({ ...payload, ephemeral: true }).catch(discordCatch);
  }
}

/** /favorites back button → re-render list view */
export async function handleFavListBack(interaction) {
  if (!isFavoritesAvailable()) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const userId = interaction.user.id;
  const favorites = await getFavoriteDecks(userId);
  if (favorites === null) {
    await interaction.reply({ content: UNAVAILABLE_MSG, ephemeral: true }).catch(discordCatch);
    return;
  }
  const payload = buildFavoritesListPayload(favorites);
  await interaction.update(payload).catch(discordCatch);
}
