/**
 * Game-creation related functions extracted from index.js.
 *
 * Each function receives a `deps` context object containing the external
 * dependencies it needs (Discord client, game-state helpers, UI builders, etc.).
 * This avoids closing over index.js scope and keeps the module portable.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { PHASES } from './game/phase.js';

/**
 * Sanitize a display name for use in Discord channel names.
 */
function channelSafeName(displayName) {
  return (displayName || 'player')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 16) || 'player';
}

/**
 * Get a short channel-safe display name for a user ID.
 */
async function getPlayerChannelName(guild, userId) {
  try {
    const member = await guild.members.fetch(userId);
    return channelSafeName(member.displayName);
  } catch {
    return channelSafeName(userId.slice(-6));
  }
}

/**
 * Create p1 and p2 Play Area channels.
 */
export async function createPlayAreaChannels(guild, gameCategory, prefix, player1Id, player2Id) {
  const p1Name = await getPlayerChannelName(guild, player1Id);
  const p2Name = await getPlayerChannelName(guild, player2Id);
  const playAreaPerms = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessagesInThreads, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessagesInThreads, deny: PermissionFlagsBits.SendMessages },
    { id: guild.client.user.id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads | PermissionFlagsBits.ManageThreads | PermissionFlagsBits.SendMessagesInThreads },
  ];
  const p1 = await guild.channels.create({
    name: `${prefix} ${p1Name}-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  const p2 = await guild.channels.create({
    name: `${prefix} ${p2Name}-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  return { p1PlayAreaChannel: p1, p2PlayAreaChannel: p2 };
}

/**
 * Create private hand threads inside each player's play area channel.
 * @param {object} deps - { discordCatch }
 */
export async function createHandThreads(client, game, deps) {
  const { discordCatch } = deps;
  const p1PlayArea = await client.channels.fetch(game.p1PlayAreaId);
  const p2PlayArea = await client.channels.fetch(game.p2PlayAreaId);
  const p1Thread = await p1PlayArea.threads.create({
    name: 'Your Hand',
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    type: ChannelType.PrivateThread,
    invitable: false,
  });
  await p1Thread.members.add(game.player1Id).catch(discordCatch);
  const p2Thread = await p2PlayArea.threads.create({
    name: 'Your Hand',
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    type: ChannelType.PrivateThread,
    invitable: false,
  });
  await p2Thread.members.add(game.player2Id).catch(discordCatch);
  game.p1HandId = p1Thread.id;
  game.p2HandId = p2Thread.id;
  return { p1HandThread: p1Thread, p2HandThread: p2Thread };
}

/**
 * Create the game category and core channels (Game Log + General Chat).
 * @param {object} deps - { CATEGORIES, gameIdCounter, setGameIdCounter }
 *   gameIdCounter / setGameIdCounter: getter/setter for the mutable counter in index.js
 */
export async function createGameChannels(guild, player1Id, player2Id, deps) {
  const { CATEGORIES, getGameIdCounter, setGameIdCounter } = deps;
  // Scan for existing IA Game #XXXXX categories (active, archived, completed) so we never reuse an ID
  await guild.channels.fetch();
  const gameCategories = guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildCategory && /^IA Game #(\d+)$/.test(c.name)
  );
  const maxId = gameCategories.reduce((max, c) => {
    const m = c.name.match(/^IA Game #(\d+)$/);
    const n = m ? parseInt(m[1], 10) : 0;
    return Math.max(max, n);
  }, 0);
  const nextId = maxId + 1;
  setGameIdCounter(nextId + 1); // keep in sync for any future use
  const gameId = String(nextId).padStart(5, '0');
  const prefix = `IA${gameId}`;
  const everyoneRole = guild.roles.everyone;
  const botId = guild.client.user.id;

  const playerPerms = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel },
    { id: botId, allow: PermissionFlagsBits.ViewChannel },
  ];

  const gamesCategory = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORIES.games
  );
  const position = gamesCategory ? gamesCategory.position + 1 : 0;

  const gameCategory = await guild.channels.create({
    name: `IA Game #${gameId}`,
    type: ChannelType.GuildCategory,
    permissionOverwrites: playerPerms,
    position,
  });

  const gameLogPerms = [
    ...playerPerms.filter((p) => p.id !== botId),
    { id: botId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageMessages },
  ];
  const generalChannel = await guild.channels.create({
    name: `${prefix} Game Log`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: gameLogPerms,
  });
  const chatChannel = await guild.channels.create({
    name: `${prefix} General Chat`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playerPerms,
  });
  return { gameCategory, gameId, generalChannel, chatChannel };
}

/**
 * Create the Map Updates channel for a game. Call AFTER play area channels so it appears last.
 */
export async function createBoardChannel(guild, gameCategory, prefix, player1Id, player2Id) {
  const everyoneRole = guild.roles.everyone;
  const botId = guild.client.user.id;
  const boardPerms = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: botId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageMessages },
  ];
  return await guild.channels.create({
    name: `${prefix} Map Updates`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: boardPerms,
  });
}

/**
 * Create a test game (shared by #lfg message handler and HTTP POST /testgame).
 * @param {object} deps - Dependencies from index.js scope:
 *   { testGameCreationInProgress, countActiveGamesForPlayer, MAX_ACTIVE_GAMES_PER_PLAYER,
 *     createGameChannelsFn, CURRENT_GAME_VERSION, setGame, getScenarioPrimaryCard,
 *     IMPLEMENTED_SCENARIOS, runDraftRandom, getCcEffect, getTimingTestInfo,
 *     discordCatch, COLORS, getGeneralSetupButtons, saveGames }
 */
export async function createTestGame(client, guild, userId, scenarioId, feedbackChannel, options = {}, deps) {
  const {
    testGameCreationInProgress, countActiveGamesForPlayer, MAX_ACTIVE_GAMES_PER_PLAYER,
    createGameChannelsFn, CURRENT_GAME_VERSION, setGame, getScenarioPrimaryCard,
    IMPLEMENTED_SCENARIOS, runDraftRandom, getCcEffect, getTimingTestInfo,
    discordCatch, COLORS, getGeneralSetupButtons, saveGames,
    getScenarioMutator, getScenarioHowToTest, mutatorDeps, deleteGameChannelsAndGame, cleanupCtx,
  } = deps;

  if (testGameCreationInProgress.has(userId)) {
    throw new Error('A test game is already being created. Please wait.');
  }
  if (countActiveGamesForPlayer(userId) >= MAX_ACTIVE_GAMES_PER_PLAYER) {
    throw new Error(`You are already in **${MAX_ACTIVE_GAMES_PER_PLAYER}** active games. Finish or leave a game before creating another.`);
  }
  testGameCreationInProgress.add(userId);
  try {
    const botId = client.user.id;
    const p2Id = options.player2Id || botId;
    const p2IsBot = p2Id === botId;
    const { gameId, generalChannel, chatChannel } =
      await createGameChannelsFn(guild, userId, p2Id);
    const game = {
      gameId,
      version: CURRENT_GAME_VERSION,
      gameCategoryId: generalChannel.parentId,
      player1Id: userId,
      player2Id: p2Id,
      generalId: generalChannel.id,
      chatId: chatChannel?.id || null,
      boardId: null,
      p1HandId: null,
      p2HandId: null,
      p1PlayAreaId: null,
      p2PlayAreaId: null,
      player1Squad: null,
      player2Squad: null,
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },
      isTestGame: true,
      testP2IsBot: p2IsBot,
      testScenario: scenarioId || undefined,
      testScenarioPrimaryCard: scenarioId ? getScenarioPrimaryCard(scenarioId) : undefined,
      phase: PHASES.MAP_SELECTION,
      ended: false,
    };
    setGame(gameId, game);

    const scenarioImplemented = scenarioId && IMPLEMENTED_SCENARIOS.includes(scenarioId);
    const p2Label = p2IsBot ? 'the bot' : `<@${p2Id}>`;
    const mentionUsers = p2IsBot ? [userId] : [userId, p2Id];
    const killRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kill_game_${gameId}`).setLabel('Kill Test Game').setStyle(ButtonStyle.Danger),
    );
    if (scenarioImplemented) {
      await runDraftRandom(game, client, { scenarioId });

      // Phase-jump mutator: mutate game state to target phase after runDraftRandom setup
      const mutator = getScenarioMutator?.(scenarioId);
      if (mutator) {
        try {
          await mutator(game, client, mutatorDeps, userId);
        } catch (err) {
          // Fail-fast: clean up all channels and game state, then propagate
          await deleteGameChannelsAndGame?.(game, gameId, cleanupCtx).catch(() => {});
          const errMsg = err.scenario ? err.message : `Scenario mutation error: ${err.message}`;
          throw new Error(errMsg);
        }
      }

      const scenarioPrimaryCard = getScenarioPrimaryCard(scenarioId);
      const ccEffectData = scenarioPrimaryCard ? getCcEffect(scenarioPrimaryCard) : null;
      const effectText = ccEffectData?.effect || '';
      const timingText = ccEffectData?.timing || '';
      const costText = ccEffectData?.cost != null ? `Cost: ${ccEffectData.cost}` : '';
      const cardDetails = [costText, timingText].filter(Boolean).join(' · ');
      const timingInfo = scenarioPrimaryCard ? getTimingTestInfo(scenarioPrimaryCard) : null;

      // Phase-jump scenarios use howToTest from test-scenarios.json; regular scenarios use timing-based prompt
      const scenarioHowToTest = mutator ? getScenarioHowToTest?.(scenarioId) : null;
      const howToTest = scenarioHowToTest || timingInfo?.prompt || 'Activate a DC, then play the card.';
      const opponentNote = timingInfo?.needsOpponent ? '\n⚠️ **This card requires P2 to act.** Switch to your P2 account when instructed.' : '';
      const testPrompt = scenarioPrimaryCard
        ? `🧪 <@${userId}> — **Testing: ${scenarioPrimaryCard}** (scenario: \`${scenarioId}\`)\n${cardDetails ? `*${cardDetails}*\n` : ''}> *${effectText}*\n\n**How to test:** ${howToTest}${opponentNote}\nThe card is in P1's **Your Hand** thread (inside Play Area).`
        : `🧪 <@${userId}> — **Testing scenario: \`${scenarioId}\`**`;
      await generalChannel.send({ content: testPrompt, allowedMentions: { users: [userId] } }).catch(discordCatch);
      await generalChannel.send({ content: `Done testing? Kill the game here:`, components: [killRow] }).catch(discordCatch);
      const phaseLabel = mutator ? ' (phase-jump)' : '';
      const scenarioDoneText = scenarioPrimaryCard
        ? `Test game **IA Game #${gameId}** ready${phaseLabel} (P1 <@${userId}> vs P2 ${p2Label})! Go to **Game Log**. P1's **Your Hand** thread (inside Play Area) has **${scenarioPrimaryCard}**. **How to test:** ${howToTest}`
        : `Test game **IA Game #${gameId}** ready${phaseLabel} (P1 <@${userId}> vs P2 ${p2Label})! Go to **Game Log**. Scenario: **${scenarioId}**.`;
      if (options.editMessageInstead) {
        await options.editMessageInstead.edit({ content: scenarioDoneText, allowedMentions: { users: mentionUsers } }).catch(discordCatch);
      } else {
        await feedbackChannel.send({
          content: scenarioDoneText,
          allowedMentions: { users: mentionUsers },
        }).catch(discordCatch);
      }
    } else {
      const setupDesc = p2IsBot
        ? '**Test game** — You play as P1 vs the bot as P2. Select the map below. Play Areas with **Your Hand** threads will then appear; use them to pick decks (Select Squad or Default Rebels / Scum / Imperial) for each side.'
        : `**Test game** — <@${userId}> is P1, <@${p2Id}> is P2. Select the map below. Play Areas with **Your Hand** threads will then appear; use them to pick decks.`;
      const setupMsg = await generalChannel.send({
        content: `<@${userId}> — **Test game** created. You are P1, P2 is ${p2Label}. Map Selection below — Play Areas (with **Your Hand** threads) will appear after map selection.`,
        allowedMentions: { users: mentionUsers },
        embeds: [
          new EmbedBuilder()
            .setTitle('Game Setup (Test)')
            .setDescription(setupDesc)
            .setColor(COLORS.DARK_EMBED),
        ],
        components: [getGeneralSetupButtons(game)],
      });
      game.generalSetupMessageId = setupMsg.id;
      await generalChannel.send({ content: `🧪 **Test Game #${gameId}** — done? Kill it here:`, components: [killRow] }).catch(discordCatch);
      const doneText = scenarioId && !scenarioImplemented
        ? `Scenario **${scenarioId}** is not yet implemented. Test game **IA Game #${gameId}** created with standard setup — select the map in Game Log.`
        : `Test game **IA Game #${gameId}** is ready (P1 <@${userId}> vs P2 ${p2Label})! Select the map in Game Log — Play Areas (with **Your Hand** threads) will appear after map selection.`;
      if (options.editMessageInstead) {
        await options.editMessageInstead.edit({ content: doneText, allowedMentions: { users: mentionUsers } }).catch(discordCatch);
      } else {
        await feedbackChannel.send({
          content: doneText,
          allowedMentions: { users: mentionUsers },
        }).catch(discordCatch);
      }
    }
    saveGames();
    return { gameId };
  } finally {
    testGameCreationInProgress.delete(userId);
  }
}

/**
 * Apply a squad submission for one player.
 * @param {object} deps - Dependencies:
 *   { logGameAction, getHandTooltipEmbed, createPlayAreaChannelsFn, createBoardChannelFn,
 *     buildBoardMapPayload, discordCatch, populatePlayAreas, COLORS,
 *     getDetermineInitiativeButtons, saveGames }
 */
export async function applySquadSubmission(game, isP1, squad, client, deps) {
  const {
    logGameAction, getHandTooltipEmbed, createPlayAreaChannelsFn, createBoardChannelFn,
    buildBoardMapPayload, discordCatch, populatePlayAreas, COLORS,
    getDetermineInitiativeButtons, saveGames,
  } = deps;

  if (isP1) game.player1Squad = squad;
  else game.player2Squad = squad;
  const playerId = isP1 ? game.player1Id : game.player2Id;
  const playerNum = isP1 ? 1 : 2;
  await logGameAction(game, client, `<@${playerId}> submitted squad **${squad.name || 'Unnamed'}** (${squad.dcCount ?? 0} DCs, ${squad.ccCount ?? 0} CCs)`, { allowedMentions: { users: [playerId] }, phase: 'SETUP', icon: 'squad' });
  const handChannelId = isP1 ? game.p1HandId : game.p2HandId;
  const handChannel = await client.channels.fetch(handChannelId);
  const handMessages = await handChannel.messages.fetch({ limit: 10 });
  const botMsg = handMessages.find((m) => m.author.bot && m.components.length > 0);
  if (botMsg) {
    await botMsg.edit({
      embeds: [getHandTooltipEmbed(game, isP1 ? 1 : 2, squad)],
      components: [],
    });
  }
  const bothReady = game.player1Squad && game.player2Squad && !game.bothReadyPosted;
  if (bothReady) {
    await postBothSquadsReady(game, client, {
      createPlayAreaChannels: createPlayAreaChannelsFn,
      createBoardChannel: createBoardChannelFn,
      buildBoardMapPayload, populatePlayAreas,
      getDetermineInitiativeButtons,
    });
  }
  saveGames();
}

/**
 * Ensure play area/board channels exist, populate them, and post the
 * "Both Squads Ready" message with the initiative button.
 *
 * Single source of truth — called by applySquadSubmission (happy path)
 * and recoverBothSquadsReady (recovery path).
 *
 * Sets game.bothReadyPosted = true ONLY after the Discord message is
 * successfully sent, so a crash before that point is recoverable.
 *
 * @param {object} game
 * @param {import('discord.js').Client} client
 * @param {object} deps - { createPlayAreaChannels, createBoardChannel,
 *   buildBoardMapPayload, populatePlayAreas, getDetermineInitiativeButtons }
 * @param {object} [opts]
 * @param {string} [opts.tag] - prefix for the message content (e.g. '[Recovered]')
 */
export async function postBothSquadsReady(game, client, deps, opts = {}) {
  const { createPlayAreaChannels, createBoardChannel,
    buildBoardMapPayload, populatePlayAreas, getDetermineInitiativeButtons } = deps;

  const generalChannel = await client.channels.fetch(game.generalId);

  // ── Temporary "setting up" message while Play Areas are created ──
  let settingUpMsg = null;
  try {
    settingUpMsg = await generalChannel.send({
      content: '⏳ Setting up Play Areas and Deployment Cards — one moment...',
    });
  } catch {}

  // ── Ensure play area + board channels exist ──────────────────────
  try {
    if (!game.p1PlayAreaId || !game.p2PlayAreaId) {
      const guild = generalChannel.guild;
      const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
      const prefix = `IA${game.gameId}`;
      const { p1PlayAreaChannel, p2PlayAreaChannel } = await createPlayAreaChannels(
        guild, gameCategory, prefix, game.player1Id, game.player2Id
      );
      game.p1PlayAreaId = p1PlayAreaChannel.id;
      game.p2PlayAreaId = p2PlayAreaChannel.id;
    }
    if (!game.boardId) {
      const guild = generalChannel.guild;
      const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
      const prefix = `IA${game.gameId}`;
      const boardChannel = await createBoardChannel(guild, gameCategory, prefix, game.player1Id, game.player2Id);
      game.boardId = boardChannel.id;
      if (game.selectedMap) {
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload).catch(() => {});
      }
    }
    await populatePlayAreas(game, client);
  } catch (err) {
    console.error('Failed to create/populate Play Areas:', err);
  }

  // Clean up the temporary message
  if (settingUpMsg) settingUpMsg.delete().catch(() => {});

  // ── Post initiative button ───────────────────────────────────────
  const tag = opts.tag ? `**${opts.tag}** ` : '';
  const bothReadyMsg = await generalChannel.send({
    content: `<@${game.player1Id}> <@${game.player2Id}> — ${tag}Both squads are ready! Determine initiative below.`,
    allowedMentions: { users: [...new Set([game.player1Id, game.player2Id])] },
    embeds: [
      new EmbedBuilder()
        .setTitle('Both Squads Ready')
        .setDescription(
          `**Player 1:** ${game.player1Squad.name || 'Unnamed'} (${game.player1Squad.dcCount} DCs, ${game.player1Squad.ccCount} CCs)\n` +
            `**Player 2:** ${game.player2Squad.name || 'Unnamed'} (${game.player2Squad.dcCount} DCs, ${game.player2Squad.ccCount} CCs)\n\n` +
            'Play Area channels have been populated with one thread per Deployment Card. Next: Determine Initiative.'
        )
        .setColor(0x57F287),
    ],
    components: [getDetermineInitiativeButtons(game)],
  });
  game.bothReadyMessageId = bothReadyMsg.id;
  // Set flag AFTER message sent — prevents stuck state where flag is
  // true but the initiative button was never posted.
  game.bothReadyPosted = true;

  // ── Create PvP thread (if wired) ──────────────────────────────────
  if (deps.createGameThread) {
    try {
      await deps.createGameThread({
        parentChannel: generalChannel,
        game,
        client,
        deps: deps.pvpDeps || {},
      });
    } catch (err) {
      console.error('[pvp-thread] Failed to create game thread:', err.message);
    }
  }
}

/**
 * Set up server structure (categories + channels).
 * @param {object} deps - { CATEGORIES, CHANNELS, GAME_TAGS }
 */
export async function setupServer(guild, deps) {
  const { CATEGORIES, CHANNELS, GAME_TAGS } = deps;
  const categories = {};
  for (const [key, name] of Object.entries(CATEGORIES)) {
    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === name
    );
    categories[key] =
      existing ||
      (await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
      }));
  }

  let forumChannel = null;
  for (const [key, config] of Object.entries(CHANNELS)) {
    const parent = categories[config.parent];
    const existing = guild.channels.cache.find(
      (c) => c.parentId === parent.id && c.name === config.name
    );
    if (!existing) {
      const created = await guild.channels.create({
        name: config.name,
        type: config.type,
        parent: parent.id,
        ...(config.type === ChannelType.GuildForum && config.name === 'new-games' && { availableTags: GAME_TAGS }),
      });
      if (config.type === ChannelType.GuildForum && config.name === 'new-games') forumChannel = created;
    } else if (config.type === ChannelType.GuildForum && config.name === 'new-games') {
      forumChannel = existing;
    }
  }

  if (forumChannel) {
    await forumChannel.setAvailableTags(GAME_TAGS);
  }

  return 'Server structure created: General, LFG (with #lfg chat + #new-games Forum with tags: Slow, Fast, Hyperspeed, Ranked), Games, Archived Games, Bot/Admin.';
}
