/**
 * Lobby handlers: lobby_join_, lobby_start_.
 * Dependencies passed via context from index (no import from index).
 */
import { CURRENT_GAME_VERSION } from '../game-state.js';

/**
 * Handle Join Game button in a lobby post.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, setGame, lobbies, countActiveGamesForPlayer, MAX_ACTIVE_GAMES_PER_PLAYER, getLobbyEmbed, getLobbyStartButton, updateThreadName
 */
export async function handleLobbyJoin(interaction, ctx) {
  const {
    lobbies,
    countActiveGamesForPlayer,
    MAX_ACTIVE_GAMES_PER_PLAYER,
    getLobbyEmbed,
    getLobbyStartButton,
    updateThreadName,
  } = ctx;
  const threadId = interaction.customId.replace('lobby_join_', '');
  const lobby = lobbies.get(threadId);
  if (!lobby) {
    await interaction.reply({ content: 'This lobby no longer exists.', ephemeral: true });
    return;
  }
  if (lobby.joinedId) {
    await interaction.reply({ content: 'This game already has two players.', ephemeral: true });
    return;
  }
  const joinerId = interaction.user.id;
  if (joinerId !== lobby.creatorId && countActiveGamesForPlayer(joinerId) >= MAX_ACTIVE_GAMES_PER_PLAYER) {
    await interaction.reply({
      content: `You are already in **${MAX_ACTIVE_GAMES_PER_PLAYER}** active games. Finish or leave a game before joining another.`,
      ephemeral: true,
    });
    return;
  }
  if (interaction.user.id === lobby.creatorId) {
    lobby.joinedId = interaction.user.id;
    lobby.status = 'Full';
    await interaction.update({
      embeds: [getLobbyEmbed(lobby)],
      components: [getLobbyStartButton(threadId)],
    });
    await updateThreadName(interaction.channel, lobby);
    await interaction.followUp({ content: '*(Testing: you joined as Player 2. Use a second account for real games.)*', ephemeral: true });
    return;
  }
  lobby.joinedId = interaction.user.id;
  lobby.status = 'Full';
  await interaction.update({
    embeds: [getLobbyEmbed(lobby)],
    components: [getLobbyStartButton(threadId)],
  });
  await updateThreadName(interaction.channel, lobby);
}

/**
 * Handle Start Game button in a lobby post.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - setGame, lobbies, countActiveGamesForPlayer, MAX_ACTIVE_GAMES_PER_PLAYER, createGameChannels, getGeneralSetupButtons, logGameErrorToBotLogs, updateThreadName, EmbedBuilder
 */
export async function handleLobbyStart(interaction, ctx) {
  const {
    setGame,
    lobbies,
    countActiveGamesForPlayer,
    MAX_ACTIVE_GAMES_PER_PLAYER,
    createGameChannels,
    getGeneralSetupButtons,
    logGameErrorToBotLogs,
    updateThreadName,
    EmbedBuilder,
  } = ctx;
  const threadId = interaction.customId.replace('lobby_start_', '');
  const lobby = lobbies.get(threadId);
  if (!lobby || !lobby.joinedId) {
    await interaction.reply({ content: 'Both players must join before starting. Player 2 has not joined yet.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== lobby.creatorId && interaction.user.id !== lobby.joinedId) {
    await interaction.reply({ content: 'Only players in this game can start it.', ephemeral: true });
    return;
  }
  const c1 = countActiveGamesForPlayer(lobby.creatorId);
  const c2 = countActiveGamesForPlayer(lobby.joinedId);
  if (c1 >= MAX_ACTIVE_GAMES_PER_PLAYER || c2 >= MAX_ACTIVE_GAMES_PER_PLAYER) {
    const who = [];
    if (c1 >= MAX_ACTIVE_GAMES_PER_PLAYER) who.push('<@' + lobby.creatorId + '>');
    if (c2 >= MAX_ACTIVE_GAMES_PER_PLAYER) who.push('<@' + lobby.joinedId + '>');
    await interaction.reply({
      content: `${who.join(' and ')} ${who.length > 1 ? 'are' : 'is'} already in **${MAX_ACTIVE_GAMES_PER_PLAYER}** active games. Finish or leave a game before starting another.`,
      ephemeral: true,
      allowedMentions: { users: [lobby.creatorId, lobby.joinedId] },
    });
    return;
  }
  lobby.status = 'Launched';

  let isTestGame = false;
  try {
    const thread = interaction.channel;
    const parent = thread.parent;
    if (parent?.availableTags) {
      const testTag = parent.availableTags.find((t) => t.name === 'Test');
      if (testTag && thread.appliedTags?.includes(testTag.id)) {
        isTestGame = true;
      }
    }
  } catch {
    // ignore
  }

  await interaction.reply({ content: 'Creating your game channels...', ephemeral: true });
  let gameId;
  try {
    const guild = interaction.guild;
    const { gameId: gid, generalChannel } =
      await createGameChannels(guild, lobby.creatorId, lobby.joinedId);
    gameId = gid;
    const game = {
      gameId,
      version: CURRENT_GAME_VERSION,
      gameCategoryId: generalChannel.parentId,
      player1Id: lobby.creatorId,
      player2Id: lobby.joinedId,
      generalId: generalChannel.id,
      chatId: null,
      boardId: null,
      p1HandId: null,
      p2HandId: null,
      p1PlayAreaId: null,
      p2PlayAreaId: null,
      player1Squad: null,
      player2Squad: null,
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },
      isTestGame: !!isTestGame,
      ended: false,
    };
    setGame(gameId, game);

    const setupMsg = await generalChannel.send({
      content: `<@${game.player1Id}> <@${game.player2Id}> — Game created. Map Selection below — Play Areas (with **Your Hand** threads) will appear after map selection.`,
      allowedMentions: { users: [...new Set([game.player1Id, game.player2Id])] },
      embeds: [
        new EmbedBuilder()
          .setTitle(isTestGame ? 'Game Setup (Test)' : 'Game Setup')
          .setDescription(
            isTestGame
              ? '**Test game** — Complete **MAP SELECTION** first (button below). This will randomly select a Map and its A or B mission variant. Play Areas with **Your Hand** threads will then appear for picking decks.'
              : 'Complete **MAP SELECTION** first (button below). This will randomly select a Map and its A or B mission variant. Play Areas will appear — pick your deck in the **Your Hand** thread (Select Squad or default deck buttons).'
          )
          .setColor(0x2f3136),
      ],
      components: [getGeneralSetupButtons(game)],
    });
    game.generalSetupMessageId = setupMsg.id;
    await interaction.followUp({
      content: `Game **IA Game #${gameId}** is ready!${isTestGame ? ' (Test)' : ''} Select the map in Game Log — Play Areas (with **Your Hand** threads) will appear after map selection.`,
      ephemeral: true,
    });
    await updateThreadName(interaction.channel, lobby);
    await interaction.channel.setArchived(true);
  } catch (err) {
    console.error('Failed to create game channels:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'create_game_channels');
    await interaction.followUp({
      content: `Failed to create game: ${err.message}. Ensure the bot has **Manage Channels** permission.`,
      ephemeral: true,
    });
  }
}
