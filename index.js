import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  AttachmentBuilder,
} from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { parseVsav } from './src/vsav-parser.js';
import { rotateImage90 } from './src/dc-image-utils.js';
import { renderMap } from './src/map-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname);

// DC message metadata (messageId -> { gameId, playerNum, dcName, displayName })
const dcMessageMeta = new Map();
const dcExhaustedState = new Map(); // messageId -> boolean

let dcImages = {};
let figureImages = {};
let dcStats = {};
try {
  const dcData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-images.json'), 'utf8'));
  dcImages = dcData.dcImages || {};
} catch {}
try {
  const figData = JSON.parse(readFileSync(join(rootDir, 'data', 'figure-images.json'), 'utf8'));
  figureImages = figData.figureImages || {};
} catch {}
let figureSizes = {};
try {
  const szData = JSON.parse(readFileSync(join(rootDir, 'data', 'figure-sizes.json'), 'utf8'));
  figureSizes = szData.figureSizes || {};
} catch {}
try {
  const statsData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-stats.json'), 'utf8'));
  dcStats = statsData.dcStats || {};
} catch {}
let mapRegistry = [];
try {
  const mapData = JSON.parse(readFileSync(join(rootDir, 'data', 'map-registry.json'), 'utf8'));
  mapRegistry = mapData.maps || [];
} catch {}
let deploymentZones = {};
try {
  const dzData = JSON.parse(readFileSync(join(rootDir, 'data', 'deployment-zones.json'), 'utf8'));
  deploymentZones = dzData.maps || {};
} catch {}

/** Maps with deployment zones configured are play-ready. */
function getPlayReadyMaps() {
  return mapRegistry.filter(
    (m) => deploymentZones[m.id]?.red?.length > 0 && deploymentZones[m.id]?.blue?.length > 0
  );
}

// DC health state: msgId -> [[current, max], ...] per figure
const dcHealthState = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const lobbies = new Map();
const games = new Map(); // gameId -> { ..., p1ActivationsMessageId, p2ActivationsMessageId, p1ActivationsRemaining, p2ActivationsRemaining, p1ActivationsTotal, p2ActivationsTotal }
let gameIdCounter = 1;

const GAMES_STATE_PATH = join(rootDir, 'data', 'games-state.json');

function loadGames() {
  try {
    if (!existsSync(GAMES_STATE_PATH)) return;
    const raw = readFileSync(GAMES_STATE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      for (const [id, g] of Object.entries(data)) games.set(id, g);
    }
  } catch (err) {
    console.error('Failed to load games state:', err);
  }
}

function saveGames() {
  try {
    const data = Object.fromEntries(games);
    writeFileSync(GAMES_STATE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save games state:', err);
  }
}

loadGames();

const CATEGORIES = {
  general: '📢 General',
  lfg: '🎮 Looking for Game',
  games: '⚔️ Games',
  archived: '📁 Archived Games',
  admin: '🛠️ Bot / Admin',
};

const GAME_TAGS = [
  { name: 'Slow' },
  { name: 'Fast' },
  { name: 'Hyperspeed' },
  { name: 'Ranked' },
  { name: 'Test' },
];

const SAMPLE_DECK_P1 = {
  name: 'Imperial Test Deck',
  dcList: ['Darth Vader', 'Stormtrooper (Elite)', 'Stormtrooper (Regular)', 'Stormtrooper (Regular)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Lightning', 'Take Aim', 'Take Cover', 'Take Initiative', 'Take Down', 'Under Duress'],
  dcCount: 4,
  ccCount: 15,
};

const SAMPLE_DECK_P2 = {
  name: 'Rebel Test Deck',
  dcList: ['Luke Skywalker', 'Rebel Trooper (Elite)', 'Rebel Trooper (Regular)', 'Rebel Trooper (Regular)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Push', 'Take Aim', 'Take Cover', 'Take Initiative', 'Take Down', 'Under Duress'],
  dcCount: 4,
  ccCount: 15,
};

const DEFAULT_DECK_REBELS = {
  name: 'Default Rebels',
  dcList: ['Luke Skywalker', 'Rebel Trooper (Elite)', 'Rebel Trooper (Regular)', 'Rebel Trooper (Regular)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Push', 'Take Aim', 'Take Cover', 'Take Initiative', 'Take Down', 'Under Duress'],
  dcCount: 4,
  ccCount: 15,
};

const DEFAULT_DECK_SCUM = {
  name: 'Default Scum',
  dcList: ['Trandoshan Hunter (Elite)', 'Weequay Pirate (Elite)', 'Weequay Pirate (Regular)', 'Nexu (Elite)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lure', 'Take Aim', 'Take Cover', 'Take Initiative', 'Take Down', 'Under Duress', 'Urgency', 'Wookiee Rage'],
  dcCount: 4,
  ccCount: 15,
};

const DEFAULT_DECK_IMPERIAL = {
  name: 'Default Imperial',
  dcList: ['Darth Vader', 'Stormtrooper (Elite)', 'Stormtrooper (Regular)', 'Stormtrooper (Regular)'],
  ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Lightning', 'Take Aim', 'Take Cover', 'Take Initiative', 'Take Down', 'Under Duress'],
  dcCount: 4,
  ccCount: 15,
};

const CHANNELS = {
  announcements: { name: 'announcements', parent: 'general', type: ChannelType.GuildText },
  rulesAndFaq: { name: 'rules-and-faq', parent: 'general', type: ChannelType.GuildText },
  general: { name: 'general', parent: 'general', type: ChannelType.GuildText },
  lfg: { name: 'lfg', parent: 'lfg', type: ChannelType.GuildText },
  newGamesPosts: { name: 'new-games', parent: 'lfg', type: ChannelType.GuildForum },
  activeGames: { name: 'active-games', parent: 'lfg', type: ChannelType.GuildText },
  botLogs: { name: 'bot-logs', parent: 'admin', type: ChannelType.GuildText },
  suggestions: { name: 'suggestions', parent: 'admin', type: ChannelType.GuildText },
};

function getMainMenu() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('create_game')
      .setLabel('Create Game')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('join_game')
      .setLabel('Join Game')
      .setStyle(ButtonStyle.Secondary),
  );
}

function getLobbyJoinButton(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_join_${threadId}`)
      .setLabel('Join Game')
      .setStyle(ButtonStyle.Success),
  );
}

function getLobbyStartButton(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_start_${threadId}`)
      .setLabel('Start Game')
      .setStyle(ButtonStyle.Primary),
  );
}

function getLobbyRosterText(lobby) {
  const p1 = `1. **Player 1:** <@${lobby.creatorId}>`;
  const p2 = lobby.joinedId
    ? `2. **Player 2:** <@${lobby.joinedId}>`
    : `2. **Player 2:** *(not yet joined)*`;
  return `${p1}\n${p2}`;
}

function getLobbyEmbed(lobby) {
  const roster = getLobbyRosterText(lobby);
  const isReady = !!lobby.joinedId;
  const embed = new EmbedBuilder()
    .setTitle('Game Lobby')
    .setDescription(`${roster}\n\n${isReady ? 'Both players ready! Click **Start Game** to begin.' : 'Click **Join Game** to play!'}`)
    .setColor(0x2f3136);
  return embed;
}

async function getThreadName(thread, lobby) {
  const truncate = (s) => (s.length > 18 ? s.slice(0, 15) + '…' : s);
  let p1Name = 'Creator';
  let p2Name = lobby.joinedId ? 'Joiner' : '(waiting)';
  try {
    const p1 = await thread.client.users.fetch(lobby.creatorId);
    p1Name = truncate(p1.username || p1.globalName || 'P1');
    if (lobby.joinedId) {
      const p2 = await thread.client.users.fetch(lobby.joinedId);
      p2Name = truncate(p2.username || p2.globalName || 'P2');
    }
  } catch {
    // fallback to IDs if fetch fails
  }
  const status = lobby.status || (lobby.joinedId ? 'Full' : 'LFG');
  return `[${status}] ${p1Name} vs ${p2Name}`;
}

async function updateThreadName(thread, lobby) {
  try {
    const name = await getThreadName(thread, lobby);
    await thread.setName(name.slice(0, 100));
  } catch (err) {
    console.error('Failed to update thread name:', err);
  }
}

/** Create p1 and p2 Play Area channels (called when both squads are ready). */
async function createPlayAreaChannels(guild, gameCategory, prefix, player1Id, player2Id) {
  const playAreaPerms = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: guild.client.user.id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.ManageThreads },
  ];
  const p1 = await guild.channels.create({
    name: `${prefix} p1-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  const p2 = await guild.channels.create({
    name: `${prefix} p2-play-area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  return { p1PlayAreaChannel: p1, p2PlayAreaChannel: p2 };
}

async function createGameChannels(guild, player1Id, player2Id, options = {}) {
  const { createPlayAreas = false } = options;
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
  gameIdCounter = nextId + 1; // keep in sync for any future use
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

  const p1Only = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel },
    { id: botId, allow: PermissionFlagsBits.ViewChannel },
  ];
  const p2Only = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel },
    { id: botId, allow: PermissionFlagsBits.ViewChannel },
  ];
  // Play Area: both players can view, but only bot can send (static channel; DCs get threads)
  const playAreaPerms = [
    { id: everyoneRole.id, deny: PermissionFlagsBits.ViewChannel },
    { id: player1Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: player2Id, allow: PermissionFlagsBits.ViewChannel, deny: PermissionFlagsBits.SendMessages },
    { id: botId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.ManageThreads },
  ];

  const chatChannel = await guild.channels.create({
    name: `${prefix} General chat`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playerPerms,
  });
  const generalChannel = await guild.channels.create({
    name: `${prefix} Game Log`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playerPerms,
  });
  const boardChannel = await guild.channels.create({
    name: `${prefix} Board`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playerPerms,
  });
  const p1HandChannel = await guild.channels.create({
    name: `${prefix} p1-hand`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: p1Only,
  });
  const p2HandChannel = await guild.channels.create({
    name: `${prefix} p2-hand`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: p2Only,
  });
  let p1PlayAreaChannel = null;
  let p2PlayAreaChannel = null;
  if (createPlayAreas) {
    p1PlayAreaChannel = await guild.channels.create({
      name: `${prefix} p1-play-area`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: playAreaPerms,
    });
    p2PlayAreaChannel = await guild.channels.create({
      name: `${prefix} p2-play-area`,
      type: ChannelType.GuildText,
      parent: gameCategory.id,
      permissionOverwrites: playAreaPerms,
    });
  }

  return { gameCategory, gameId, generalChannel, chatChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel };
}

/** Game phases for visual organization */
const GAME_PHASES = {
  SETUP: { name: 'PRE-GAME SETUP', emoji: '⚙️', color: 0x95a5a6 },
  INITIATIVE: { name: 'INITIATIVE', emoji: '🎲', color: 0xf39c12 },
  DEPLOYMENT: { name: 'DEPLOYMENT', emoji: '📍', color: 0x3498db },
  ROUND: { name: 'ROUND', emoji: '⚔️', color: 0xe74c3c },
};

/** Action icons for game log */
const ACTION_ICONS = {
  squad: '📋',
  map: '🗺️',
  initiative: '🎲',
  zone: '🏁',
  deploy: '📍',
  exhaust: '😴',
  ready: '✨',
  move: '🚶',
  attack: '⚔️',
  interact: '🤝',
  special: '✴️',
  deployed: '✅',
};

/** Post a phase header to the game log (only when phase changes) */
async function logPhaseHeader(game, client, phase, roundNum = null) {
  const phaseKey = `currentPhase`;
  const phaseName = roundNum ? `${phase.name} ${roundNum}` : phase.name;
  const fullKey = roundNum ? `${phase.name}_${roundNum}` : phase.name;
  if (game[phaseKey] === fullKey) return;
  game[phaseKey] = fullKey;
  try {
    const ch = await client.channels.fetch(game.generalId);
    const embed = new EmbedBuilder()
      .setTitle(`${phase.emoji}  ${phaseName}`)
      .setColor(phase.color);
    await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error('Phase header error:', err);
  }
}

/** Log a game action with icon and clean formatting */
async function logGameAction(game, client, content, options = {}) {
  try {
    const ch = await client.channels.fetch(game.generalId);
    const icon = options.icon ? `${ACTION_ICONS[options.icon] || ''} ` : '';
    const phase = options.phase;
    if (phase) {
      await logPhaseHeader(game, client, GAME_PHASES[phase], options.roundNum);
    }
    const timestamp = `<t:${Math.floor(Date.now() / 1000)}:t>`;
    const msg = `${icon}${timestamp} — ${content}`;
    await ch.send({ content: msg, allowedMentions: options.allowedMentions });
  } catch (err) {
    console.error('Game log error:', err);
  }
}

function getSelectSquadButton(gameId, playerNum) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`squad_select_${gameId}_${playerNum}`)
      .setLabel('Select Squad')
      .setStyle(ButtonStyle.Primary)
  );
}

/** Select Squad + Default Rebels (red), Default Scum (green), Default Imperial (grey) for testing. */
function getHandSquadButtons(gameId, playerNum) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`squad_select_${gameId}_${playerNum}`)
      .setLabel('Select Squad')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`default_deck_${gameId}_${playerNum}_rebel`)
      .setLabel('Default Rebels')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`default_deck_${gameId}_${playerNum}_scum`)
      .setLabel('Default Scum')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`default_deck_${gameId}_${playerNum}_imperial`)
      .setLabel('Default Imperial')
      .setStyle(ButtonStyle.Secondary)
  );
}

function getKillGameButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`kill_game_${gameId}`)
      .setLabel('Kill Game (testing)')
      .setStyle(ButtonStyle.Danger)
  );
}

function getRefreshMapButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`refresh_map_${gameId}`)
      .setLabel('Refresh Map')
      .setStyle(ButtonStyle.Primary)
  );
}

/** Red Zone = Danger (red), Blue Zone = Primary (blue). Only valid before deployment zone is chosen. */
function getDeploymentZoneButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`deployment_zone_red_${gameId}`)
      .setLabel('Red Zone')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`deployment_zone_blue_${gameId}`)
      .setLabel('Blue Zone')
      .setStyle(ButtonStyle.Primary)
  );
}

function getDeploymentDoneButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`deployment_done_${gameId}`)
      .setLabel("I've Deployed")
      .setStyle(ButtonStyle.Success)
  );
}

/** Same display names as Play Area: duplicate DCs get [Group 1], [Group 2], etc. */
function getDeployDisplayNames(dcList) {
  if (!dcList?.length) return [];
  const totals = {};
  const counts = {};
  for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
  return dcList.map((dcName) => {
    counts[dcName] = (counts[dcName] || 0) + 1;
    const dgIndex = counts[dcName];
    return totals[dcName] > 1 ? `${dcName} [Group ${dgIndex}]` : dcName;
  });
}

const FIGURE_LETTERS = 'abcdefghij';

/** Per-figure deploy labels: one entry per figure (e.g. multi-figure DCs get "1a", "1b", "2a", "2b"). Returns { labels, metadata }. */
function getDeployFigureLabels(dcList) {
  if (!dcList?.length) return { labels: [], metadata: [] };
  const totals = {};
  const counts = {};
  for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
  const labels = [];
  const metadata = [];
  for (let i = 0; i < dcList.length; i++) {
    const dcName = dcList[i];
    counts[dcName] = (counts[dcName] || 0) + 1;
    const dgIndex = counts[dcName];
    const displayName = totals[dcName] > 1 ? `${dcName} [Group ${dgIndex}]` : dcName;
    const baseName = displayName.replace(/\s*\[Group \d+\]$/, '');
    const figures = getDcStats(dcName).figures ?? 1;
    if (figures <= 1) {
      labels.push(`Deploy ${displayName}`);
      metadata.push({ dcName, dgIndex, figureIndex: 0 });
    } else {
      for (let f = 0; f < figures; f++) {
        labels.push(`Deploy ${baseName} ${dgIndex}${FIGURE_LETTERS[f]}`);
        metadata.push({ dcName, dgIndex, figureIndex: f });
      }
    }
  }
  return { labels, metadata };
}

/** One button per row. Undeployed: colored Deploy X. Deployed: grey Deploy X (Location: B1). All clear when I've Deployed. */
function getDeployButtonRows(gameId, playerNum, dcList, zone, figurePositions) {
  const { labels, metadata } = getDeployFigureLabels(dcList);
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  const pos = figurePositions?.[playerNum] || {};
  const deployRows = [];
  for (let i = 0; i < labels.length; i++) {
    const meta = metadata[i];
    const figureKey = `${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`;
    const space = pos[figureKey];
    const displaySpace = space ? space.toUpperCase() : '';
    const label = space
      ? `${labels[i]} (Location: ${displaySpace})`.slice(0, 80)
      : labels[i].slice(0, 80);
    deployRows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`deployment_fig_${gameId}_${playerNum}_${i}`)
          .setLabel(label)
          .setStyle(space ? ButtonStyle.Secondary : zoneStyle)
      )
    );
  }
  const doneRow = getDeploymentDoneButton(gameId);
  return { deployRows, doneRow };
}

/** Rebuilds deploy prompt messages for a player, removing buttons for already-deployed figures. */
async function updateDeployPromptMessages(game, playerNum, client) {
  const isInitiative = playerNum === (game.initiativePlayerId === game.player1Id ? 1 : 2);
  const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
  const msgIds = game[idsKey];
  if (!msgIds?.length) return;
  const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
  const zone = isInitiative ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
  const dcList = squad?.dcList || [];
  try {
    const handChannel = await client.channels.fetch(handId);
    for (const msgId of msgIds) {
      try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
    }
    game[idsKey] = [];
    const { deployRows, doneRow } = getDeployButtonRows(game.gameId, playerNum, dcList, zone, game.figurePositions);
    const DEPLOY_ROWS_PER_MSG = 4;
    const zoneLabel = zone === 'red' ? 'red' : 'blue';
    const firstContent = isInitiative
      ? `You chose the **${zoneLabel}** zone. Deploy each figure below (one per row), then click **I've Deployed** when finished.`
      : `Your opponent has deployed. Deploy each figure in the **${zoneLabel}** zone below (one per row), then click **I've Deployed** when finished.`;
    if (deployRows.length === 0) {
      const msg = await handChannel.send({
        content: isInitiative ? `You chose the **${zoneLabel}** zone. When finished, click **I've Deployed** below.` : `Your opponent has deployed. Deploy in the **${zoneLabel}** zone. When finished, click **I've Deployed** below.`,
        components: [doneRow],
      });
      game[idsKey].push(msg.id);
    } else {
      for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
        const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
        const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
        const components = isLastChunk ? [...chunk, doneRow] : chunk;
        const msg = await handChannel.send({
          content: i === 0 ? firstContent : null,
          components,
        });
        game[idsKey].push(msg.id);
      }
    }
    game[isInitiative ? 'initiativeDeployMessageId' : 'nonInitiativeDeployMessageId'] = game[idsKey][game[idsKey].length - 1];
  } catch (err) {
    console.error('updateDeployPromptMessages error:', err);
  }
}

/** Returns action rows of space buttons (5 per row, max 5 rows). Sorts by row then col for grid feel. Excludes occupied spaces. */
function getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, occupiedSpaces, zone) {
  const occupied = new Set((occupiedSpaces || []).map((s) => String(s).toLowerCase()));
  const available = (validSpaces || [])
    .map((s) => String(s).toLowerCase())
    .filter((s) => !occupied.has(s))
    .sort((a, b) => {
      const mA = a.match(/^([a-z]+)(\d+)$/i);
      const mB = b.match(/^([a-z]+)(\d+)$/i);
      const numA = mA ? parseInt(mA[2], 10) : 0;
      const numB = mB ? parseInt(mB[2], 10) : 0;
      if (numA !== numB) return numA - numB;
      return (a || '').localeCompare(b || '');
    });
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  const rows = [];
  for (let i = 0; i < available.length && rows.length < 5; i += 5) {
    const chunk = available.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        chunk.map((space) =>
          new ButtonBuilder()
            .setCustomId(`deploy_pick_${gameId}_${playerNum}_${flatIndex}_${space}`)
            .setLabel(space.toUpperCase())
            .setStyle(zoneStyle)
        )
      )
    );
  }
  return { rows, available };
}

/** Convert game.figurePositions to renderMap figures format. Uses circular figure images from figure-images.json. */
function getFiguresForRender(game) {
  const pos = game.figurePositions;
  if (!pos || (!pos[1] && !pos[2])) return [];
  const figures = [];
  const colors = { 1: '#e74c3c', 2: '#3498db' };
  for (const p of [1, 2]) {
    const poses = pos[p] || {};
    for (const [figureKey, space] of Object.entries(poses)) {
      const dcName = figureKey.replace(/-\d+-\d+$/, '');
      const imagePath = getFigureImagePath(dcName);
      const figureSize = getFigureSize(dcName);
      figures.push({
        coord: space,
        color: colors[p] || '#888',
        imagePath: imagePath || undefined,
        dcName,
        figureSize,
      });
    }
  }
  return figures;
}

/** Build Scorecard embed with VP breakdown per player. */
function buildScorecardEmbed(game) {
  const vp1 = game.player1VP || { total: 0, kills: 0, objectives: 0 };
  const vp2 = game.player2VP || { total: 0, kills: 0, objectives: 0 };
  return new EmbedBuilder()
    .setTitle('Scorecard')
    .setColor(0x2f3136)
    .addFields(
      { name: 'Player 1', value: `<@${game.player1Id}>`, inline: true },
      { name: 'Player 2', value: `<@${game.player2Id}>`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Total VP', value: `${vp1.total}`, inline: true },
      { name: 'Total VP', value: `${vp2.total}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Kills', value: `${vp1.kills}`, inline: true },
      { name: 'Kills', value: `${vp2.kills}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Objectives', value: `${vp1.objectives}`, inline: true },
      { name: 'Objectives', value: `${vp2.objectives}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    );
}

/** Returns { content, files?, embeds?, components } for posting the game map. Includes Scorecard embed. */
async function buildBoardMapPayload(gameId, map, game) {
  const components = [getRefreshMapButton(gameId)];
  const embeds = game ? [buildScorecardEmbed(game)] : [];
  const figures = game ? getFiguresForRender(game) : [];
  const hasFigures = figures.length > 0;
  const imagePath = map.imagePath ? join(rootDir, map.imagePath) : null;
  const pdfPath = join(rootDir, 'data', 'map-pdfs', `${map.id}.pdf`);

  const allowedMentions = game ? { users: [game.player1Id, game.player2Id] } : undefined;
  if (hasFigures && imagePath && existsSync(imagePath)) {
    try {
      const buffer = await renderMap(map.id, { figures, showGrid: false, maxWidth: 1200 });
      return {
        content: `**Game map: ${map.name}** — Refresh to update figure positions.`,
        files: [new AttachmentBuilder(buffer, { name: 'map-with-figures.png' })],
        embeds,
        components,
        allowedMentions,
      };
    } catch (err) {
      console.error('Map render error:', err);
    }
  }
  if (existsSync(pdfPath)) {
    return {
      content: `**Game map: ${map.name}** (high-res PDF)`,
      files: [new AttachmentBuilder(pdfPath, { name: `${map.id}.pdf` })],
      embeds,
      components,
      allowedMentions,
    };
  }
  if (imagePath && existsSync(imagePath)) {
    return {
      content: `**Game map: ${map.name}** *(Add \`data/map-pdfs/${map.id}.pdf\` for high-res PDF)*`,
      files: [new AttachmentBuilder(imagePath, { name: `map.${(map.imagePath || '').split('.').pop() || 'gif'}` })],
      embeds,
      components,
      allowedMentions,
    };
  }
  return {
    content: `**Game map: ${map.name}** — Add high-res PDF at \`data/map-pdfs/${map.id}.pdf\` to display it here.`,
    embeds,
    components,
    allowedMentions,
  };
}

/** Returns one row: Map Selection (if not yet selected), Kill Game. Determine Initiative appears on the Both Squads Ready message. */
function getGeneralSetupButtons(game) {
  const killBtn = new ButtonBuilder()
    .setCustomId(`kill_game_${game.gameId}`)
    .setLabel('Kill Game (testing)')
    .setStyle(ButtonStyle.Danger);
  const components = [];
  if (!game.mapSelected) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`map_selection_${game.gameId}`)
        .setLabel('Map Selection')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  components.push(killBtn);
  return new ActionRowBuilder().addComponents(...components);
}

/** Returns Determine Initiative + Kill Game for the Both Squads Ready message. */
function getDetermineInitiativeButtons(game) {
  const components = [];
  if (!game.initiativeDetermined) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`determine_initiative_${game.gameId}`)
        .setLabel('Determine Initiative')
        .setStyle(ButtonStyle.Primary)
    );
  }
  components.push(
    new ButtonBuilder()
      .setCustomId(`kill_game_${game.gameId}`)
      .setLabel('Kill Game (testing)')
      .setStyle(ButtonStyle.Danger)
  );
  return new ActionRowBuilder().addComponents(...components);
}

function getSquadSelectEmbed(playerNum, squad) {
  const embed = new EmbedBuilder()
    .setTitle(`Player ${playerNum} – Deck Selection`)
    .setDescription(
      squad
        ? `**Squad:** ${squad.name}\n**Deployment Cards:** ${squad.dcCount ?? '—'} cards\n**Command Cards:** ${squad.ccCount ?? '—'} cards\n\n✓ Squad submitted.`
        : 'Click **Select Squad** or **upload a .vsav file** (from [IACP List Builder](https://iacp-list-builder.onrender.com/)) to submit your squad.'
    )
    .setColor(0x2f3136);
  return embed;
}

/** Resolve DC name to DC card image path (for deployment card embeds). */
function getDcImagePath(dcName) {
  if (!dcName || typeof dcName !== 'string') return null;
  const exact = dcImages[dcName];
  if (exact) return exact;
  const lower = dcName.toLowerCase();
  let key = Object.keys(dcImages).find((k) => k.toLowerCase() === lower);
  if (key) return dcImages[key];
  const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  if (base !== dcName) {
    key = Object.keys(dcImages).find((k) => k.toLowerCase() === base.toLowerCase());
    if (key) return dcImages[key];
    key = Object.keys(dcImages).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
    if (key) return dcImages[key];
  }
  key = Object.keys(dcImages).find((k) => k.toLowerCase().startsWith(lower) || lower.startsWith(k.toLowerCase()));
  return key ? dcImages[key] : null;
}

/** Get figure base size (1x1, 1x2, 2x2, 2x3) for map rendering. Default 1x1. */
function getFigureSize(dcName) {
  const exact = figureSizes[dcName];
  if (exact) return exact;
  const lower = dcName?.toLowerCase?.() || '';
  const key = Object.keys(figureSizes).find((k) => k.toLowerCase() === lower);
  if (key) return figureSizes[key];
  const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const key2 = Object.keys(figureSizes).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
  return key2 ? figureSizes[key2] : '1x1';
}

/** Resolve DC name to circular figure image (for map tokens). Tries exact, case-insensitive, then without (Elite)/(Regular), then prefix match. */
function getFigureImagePath(dcName) {
  if (!dcName || typeof dcName !== 'string') return null;
  const exact = figureImages[dcName];
  if (exact) return exact;
  const lower = dcName.toLowerCase();
  let key = Object.keys(figureImages).find((k) => k.toLowerCase() === lower);
  if (key) return figureImages[key];
  const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  if (base !== dcName) {
    key = Object.keys(figureImages).find((k) => k.toLowerCase() === base.toLowerCase());
    if (key) return figureImages[key];
    key = Object.keys(figureImages).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
    if (key) return figureImages[key];
  }
  key = Object.keys(figureImages).find((k) => k.toLowerCase().startsWith(lower) || lower.startsWith(k.toLowerCase()));
  return key ? figureImages[key] : null;
}

function getDcStats(dcName) {
  const exact = dcStats[dcName];
  if (exact) return exact;
  const lower = dcName?.toLowerCase?.() || '';
  const key = Object.keys(dcStats).find((k) => k.toLowerCase() === lower);
  if (key) return dcStats[key];
  return { health: null, figures: 1, specials: [] };
}

/** Returns action rows: one [Move][Attack][Interact] row per figure, plus specials if any. Max 5 rows (Discord limit). */
function getDcActionButtons(msgId, dcName, displayName) {
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  const specials = stats.specials || [];
  const dgIndex = displayName?.match(/\[Group (\d+)\]/)?.[1] ?? 1;
  const baseName = (displayName || dcName).replace(/\s*\[Group \d+\]$/, '') || dcName;
  const rows = [];
  for (let f = 0; f < figures && rows.length < 5; f++) {
    const suffix = figures <= 1 ? '' : ` ${dgIndex}${FIGURE_LETTERS[f]}`;
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dc_move_${msgId}_f${f}`).setLabel(`Move${suffix}`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`dc_attack_${msgId}_f${f}`).setLabel(`Attack${suffix}`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`dc_interact_${msgId}_f${f}`).setLabel(`Interact${suffix}`).setStyle(ButtonStyle.Secondary)
    ));
  }
  if (specials.length > 0 && rows.length < 5) {
    const specialBtns = specials.slice(0, 5).map((name, idx) =>
      new ButtonBuilder()
        .setCustomId(`dc_special_${idx}_${msgId}`)
        .setLabel(name.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    rows.push(new ActionRowBuilder().addComponents(...specialBtns));
  }
  return rows;
}

function formatHealthSection(dgIndex, healthState) {
  if (!healthState?.length) return 'Health\n—/—';
  const labels = 'abcdefghij';
  const lines = healthState.map(([cur, max], i) => {
    const c = cur != null ? cur : (max != null ? max : '?');
    const m = max != null ? max : '?';
    if (healthState.length === 1) return `${c}/${m}`;
    return `${dgIndex}${labels[i]}: ${c}/${m}`;
  });
  return `Health\n${lines.join('\n')}`;
}

function getDcToggleButton(msgId, exhausted) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dc_toggle_${msgId}`)
      .setLabel(exhausted ? 'Ready' : 'Exhaust')
      .setStyle(exhausted ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
}

async function buildDcEmbedAndFiles(dcName, exhausted, displayName, healthState) {
  const status = exhausted ? 'EXHAUSTED' : 'READIED';
  const color = exhausted ? 0xed4245 : 0x57f287; // red : green
  const dgIndex = displayName.match(/\[Group (\d+)\]/)?.[1] ?? 1;
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  const variant = dcName?.includes('(Elite)') ? 'Elite' : dcName?.includes('(Regular)') ? 'Regular' : null;
  const healthSection = formatHealthSection(Number(dgIndex), healthState);
  const lines = [
    `**Figures:** ${figures}`,
    variant ? `**Variant:** ${variant}` : null,
    '',
    healthSection,
  ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setTitle(`${status} — ${displayName}`)
    .setDescription(lines.join('\n'))
    .setColor(color);

  let files = [];
  const imagePath = getDcImagePath(dcName?.trim());
  if (imagePath) {
    const fullPath = join(rootDir, imagePath);
    if (existsSync(fullPath)) {
      const attachName = 'dc-thumb.png';
      if (exhausted) {
        const buffer = await rotateImage90(imagePath);
        if (buffer) {
          files.push(new AttachmentBuilder(buffer, { name: attachName }));
          embed.setThumbnail(`attachment://${attachName}`);
        } else {
          files.push(new AttachmentBuilder(fullPath, { name: attachName }));
          embed.setThumbnail(`attachment://${attachName}`);
        }
      } else {
        const ext = imagePath.split('.').pop() || 'png';
        const name = `dc-thumb.${ext}`;
        files.push(new AttachmentBuilder(fullPath, { name }));
        embed.setThumbnail(`attachment://${name}`);
      }
    }
  }
  return { embed, files };
}

/** Green = remaining, red = used. Returns e.g. "**Activations:** 🟢🟢🟢🔴 (3/4 remaining)" */
function getActivationsLine(remaining, total) {
  const green = '🟢';
  const red = '🔴';
  const used = Math.max(0, total - remaining);
  const circles = green.repeat(remaining) + red.repeat(used);
  return `**Activations:** ${circles} (${remaining}/${total} remaining)`;
}

/** Call after changing game.p1ActivationsRemaining or game.p2ActivationsRemaining to refresh the Play Area header. */
async function updateActivationsMessage(game, playerNum, client) {
  const msgId = playerNum === 1 ? game.p1ActivationsMessageId : game.p2ActivationsMessageId;
  const remaining = playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
  const total = playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
  if (msgId == null || total === 0) return;
  try {
    const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(msgId);
    await msg.edit(getActivationsLine(remaining, total));
  } catch (err) {
    console.error('Failed to update activations message:', err);
  }
}

async function populatePlayAreas(game, client) {
  const p1PlayArea = await client.channels.fetch(game.p1PlayAreaId);
  const p2PlayArea = await client.channels.fetch(game.p2PlayAreaId);
  const gameId = game.gameId;

  const p1Total = (game.player1Squad?.dcList?.length ?? game.player1Squad?.dcCount) || 0;
  const p2Total = (game.player2Squad?.dcList?.length ?? game.player2Squad?.dcCount) || 0;
  game.p1ActivationsTotal = p1Total;
  game.p2ActivationsTotal = p2Total;
  game.p1ActivationsRemaining = p1Total;
  game.p2ActivationsRemaining = p2Total;

  const p1ActivationsMsg = await p1PlayArea.send(getActivationsLine(p1Total, p1Total));
  const p2ActivationsMsg = await p2PlayArea.send(getActivationsLine(p2Total, p2Total));
  game.p1ActivationsMessageId = p1ActivationsMsg.id;
  game.p2ActivationsMessageId = p2ActivationsMsg.id;

  const dcToThread = async (channel, dcName, playerNum, displayName, healthState) => {
    const { embed, files } = await buildDcEmbedAndFiles(dcName, false, displayName, healthState);
    const msg = await channel.send({ embeds: [embed], files });
    dcMessageMeta.set(msg.id, { gameId, playerNum, dcName, displayName });
    dcExhaustedState.set(msg.id, false);
    dcHealthState.set(msg.id, healthState);
    await msg.edit({
      components: [getDcToggleButton(msg.id, false)],
    });
    const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
    const thread = await msg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
    await thread.send({
      content: '**Actions**',
      components: getDcActionButtons(msg.id, dcName, displayName),
    });
  };

  const processDcList = (dcList) => {
    const counts = {};
    const totals = {};
    for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
    return dcList.map((dcName) => {
      counts[dcName] = (counts[dcName] || 0) + 1;
      const dgIndex = counts[dcName];
      const displayName = totals[dcName] > 1 ? `${dcName} [Group ${dgIndex}]` : dcName;
      const stats = getDcStats(dcName);
      const health = stats.health ?? '?';
      const figures = stats.figures ?? 1;
      const healthState = Array.from({ length: figures }, () => [health, health]);
      return { dcName, displayName, healthState };
    });
  };

  const p1Dcs = processDcList(game.player1Squad.dcList || []);
  const p2Dcs = processDcList(game.player2Squad.dcList || []);

  for (const { dcName, displayName, healthState } of p1Dcs) {
    await dcToThread(p1PlayArea, dcName, 1, displayName, healthState);
  }
  for (const { dcName, displayName, healthState } of p2Dcs) {
    await dcToThread(p2PlayArea, dcName, 2, displayName, healthState);
  }
}

async function applySquadSubmission(game, isP1, squad, client) {
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
      embeds: [getSquadSelectEmbed(isP1 ? 1 : 2, squad)],
      components: [],
    });
  }
  const generalChannel = await client.channels.fetch(game.generalId);
  const bothReady = game.player1Squad && game.player2Squad && !game.bothReadyPosted;
  if (bothReady) {
    game.bothReadyPosted = true;
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
      await populatePlayAreas(game, client);
    } catch (err) {
      console.error('Failed to create/populate Play Areas:', err);
    }
    await generalChannel.send({
      content: `<@${game.player1Id}> <@${game.player2Id}> — Both squads are ready! Determine initiative below.`,
      allowedMentions: { users: [game.player1Id, game.player2Id] },
      embeds: [
        new EmbedBuilder()
          .setTitle('Both Squads Ready')
          .setDescription(
            `**Player 1:** ${game.player1Squad.name || 'Unnamed'} (${game.player1Squad.dcCount} DCs, ${game.player1Squad.ccCount} CCs)\n` +
              `**Player 2:** ${game.player2Squad.name || 'Unnamed'} (${game.player2Squad.dcCount} DCs, ${game.player2Squad.ccCount} CCs)\n\n` +
              'Play Area channels have been populated with one thread per Deployment Card. Next: Determine Initiative.'
          )
          .setColor(0x57f287),
      ],
      components: [getDetermineInitiativeButtons(game)],
    });
  }
  saveGames();
}

async function setupServer(guild) {
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
        ...(config.type === ChannelType.GuildForum && { availableTags: GAME_TAGS }),
      });
      if (config.type === ChannelType.GuildForum) forumChannel = created;
    } else if (config.type === ChannelType.GuildForum) {
      forumChannel = existing;
    }
  }

  if (forumChannel) {
    await forumChannel.setAvailableTags(GAME_TAGS);
  }

  return 'Server structure created: General, LFG (with #lfg chat + #new-games Forum with tags: Slow, Fast, Hyperspeed, Ranked), Games, Archived Games, Bot/Admin.';
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch();
      const hasLfg = guild.channels.cache.some(
        (c) => c.type === ChannelType.GuildText && c.name === 'lfg'
      );
      const hasNewGamesForum = guild.channels.cache.some(
        (c) => c.type === ChannelType.GuildForum && c.name === 'new-games'
      );
      if (!hasLfg || !hasNewGamesForum) {
        console.log(`Setting up server: ${guild.name}`);
        await setupServer(guild);
        console.log(`Setup complete for ${guild.name}`);
      } else {
        const forum = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildForum && c.name === 'new-games'
        );
        if (forum) {
          await forum.setAvailableTags(GAME_TAGS);
        }
      }
    } catch (err) {
      console.error(`Setup failed for ${guild.name}:`, err);
    }
  }
});

// Forum posts: thread isn't messageable until the author sends their first message.
// So we set up the lobby on the first message in a new-games thread.
async function maybeSetupLobbyFromFirstMessage(message) {
  const thread = message.channel;
  if (!thread?.isThread?.()) return false;
  const parent = thread.parent;
  if (parent?.name !== 'new-games') return false;
  if (lobbies.has(thread.id)) return false;
  const creator = message.author.id;
  const lobby = { creatorId: creator, joinedId: null, status: 'LFG' };
  lobbies.set(thread.id, lobby);
  await thread.send({
    embeds: [getLobbyEmbed(lobby)],
    components: [getLobbyJoinButton(thread.id)],
  });
  await updateThreadName(thread, lobby);
  return true;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Forum post first message: set up lobby buttons (thread isn't messageable until author posts)
  try {
    if (await maybeSetupLobbyFromFirstMessage(message)) return;
  } catch (err) {
    console.error('Lobby setup error:', err);
  }

  const content = message.content.toLowerCase().trim();

  if (content === 'testgame' && message.channel?.name === 'lfg') {
    const userId = message.author.id;
    const creatingMsg = await message.reply('Creating test game (you as both players)...');
    try {
      const guild = message.guild;
      const { gameId, generalChannel, chatChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel } =
        await createGameChannels(guild, userId, userId, { createPlayAreas: false });
      const game = {
        gameId,
        gameCategoryId: generalChannel.parentId,
        player1Id: userId,
        player2Id: userId,
        generalId: generalChannel.id,
        chatId: chatChannel.id,
        boardId: boardChannel.id,
        p1HandId: p1HandChannel.id,
        p2HandId: p2HandChannel.id,
        p1PlayAreaId: p1PlayAreaChannel?.id ?? null,
        p2PlayAreaId: p2PlayAreaChannel?.id ?? null,
        player1Squad: null,
        player2Squad: null,
        player1VP: { total: 0, kills: 0, objectives: 0 },
        player2VP: { total: 0, kills: 0, objectives: 0 },
      };
      games.set(gameId, game);

      const setupMsg = await generalChannel.send({
        content: `<@${userId}> — **Test game** created. You are both players. Map Selection below, then go to your **Hand** channels to pick decks. Use **General chat** for notes.`,
        allowedMentions: { users: [userId] },
        embeds: [
          new EmbedBuilder()
            .setTitle('Game Setup (Test)')
            .setDescription(
              '**Test game** — Use your **Hand** channels: click **Select Squad** or **Default Rebels** / **Default Scum** / **Default Imperial** to load decks for each "side".'
            )
            .setColor(0x2f3136),
        ],
        components: [getGeneralSetupButtons(game)],
      });
      game.generalSetupMessageId = setupMsg.id;
      await p1HandChannel.send({
        content: `Once the map is selected in **Game Log**, you'll be able to pick your squad here.`,
      });
      await p2HandChannel.send({
        content: `Once the map is selected in **Game Log**, you'll be able to pick your squad here.`,
      });
      await creatingMsg.edit(`Test game **IA Game #${gameId}** is ready! Check your Hand channels.`);
      saveGames();
    } catch (err) {
      console.error('Test game creation error:', err);
      await creatingMsg.edit(`Failed to create test game: ${err.message}`).catch(() => {});
    }
    return;
  }

  if (content === 'ping') {
    message.reply('Pong!');
    return;
  }

  if (content === 'cleanup' || content === 'kill games') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply('You need **Manage Channels** permission to run cleanup.');
      return;
    }
    await message.reply('Cleaning up game channels...');
    try {
      await message.guild.channels.fetch();
      const gameCategories = message.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildCategory && /^IA Game #\d+$/.test(c.name)
      );
      let deleted = 0;
      for (const cat of gameCategories.values()) {
        const children = message.guild.channels.cache.filter((c) => c.parentId === cat.id);
        for (const ch of children.values()) {
          await ch.delete();
          deleted++;
        }
        await cat.delete();
        deleted++;
      }
      games.clear();
      dcMessageMeta.clear();
      dcExhaustedState.clear();
      dcHealthState.clear();
      await message.channel.send(`Done. Deleted ${deleted} channel(s).`);
    } catch (err) {
      console.error('Cleanup error:', err);
      await message.channel.send(`Cleanup failed: ${err.message}`);
    }
    return;
  }

  if (content === 'setup') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply('You need **Manage Server** permission to run setup.');
      return;
    }
    await message.reply('Setting up server structure...');
    try {
      const result = await setupServer(message.guild);
      await message.channel.send(result);
    } catch (err) {
      console.error(err);
      await message.channel.send(
        `Setup failed. Ensure the bot has **Manage Channels** permission. Error: ${err.message}`
      );
    }
    return;
  }

  if (content === 'play' || content === 'skirmish' || content === 'ia') {
    const embed = new EmbedBuilder()
      .setTitle('Imperial Assault Skirmish')
      .setDescription('Choose an action:')
      .setColor(0x2f3136);
    await message.reply({
      embeds: [embed],
      components: [getMainMenu()],
    });
    return;
  }

  // .vsav file upload in Player Hand channel
  const vsavAttach = message.attachments?.find((a) => a.name?.toLowerCase().endsWith('.vsav'));
  if (vsavAttach) {
    const channelId = message.channel.id;
    for (const [gameId, game] of games) {
      const isP1 = game.p1HandId === channelId;
      const isP2 = game.p2HandId === channelId;
      if (!isP1 && !isP2) continue;
      const userId = isP1 ? game.player1Id : game.player2Id;
      if (message.author.id !== userId) {
        await message.reply('Only the owner of this hand can submit a squad.');
        return;
      }
      if (!game.mapSelected) {
        await message.reply('Map selection must be completed before you can submit your squad.');
        return;
      }
      try {
        const res = await fetch(vsavAttach.url);
        const content = await res.text();
        const parsed = parseVsav(content);
        if (!parsed || (parsed.dcList.length === 0 && parsed.ccList.length === 0)) {
          await message.reply('Could not parse that .vsav file. Make sure it was exported from the IACP List Builder.');
          return;
        }
        const squadName = vsavAttach.name
          ? vsavAttach.name.replace(/\.vsav$/i, '').replace(/^IA List \[[^\]]+\] - /, '').trim()
          : 'From .vsav';
        const squad = {
          name: squadName || 'From .vsav',
          dcList: parsed.dcList,
          ccList: parsed.ccList,
          dcCount: parsed.dcList.length,
          ccCount: parsed.ccList.length,
        };
        await applySquadSubmission(game, isP1, squad, message.client);
        await message.reply(`✓ Squad **${squad.name}** submitted from .vsav (${squad.dcCount} DCs, ${squad.ccCount} CCs)`);
      } catch (err) {
        console.error('vsav parse error:', err);
        await message.reply(`Failed to parse .vsav: ${err.message}`);
      }
      return;
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('squad_modal_')) {
      const [, , gameId, playerNum] = interaction.customId.split('_');
      const game = games.get(gameId);
      if (!game) {
        await interaction.reply({ content: 'This game no longer exists.', ephemeral: true });
        return;
      }
      if (!game.mapSelected) {
        await interaction.reply({ content: 'Map selection must be completed before you can submit your squad.', ephemeral: true });
        return;
      }
      const isP1 = playerNum === '1';
      const userId = isP1 ? game.player1Id : game.player2Id;
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: 'Only the player for this hand can submit.', ephemeral: true });
        return;
      }
      const name = interaction.fields.getTextInputValue('squad_name').trim() || 'Unnamed Squad';
      const dcText = interaction.fields.getTextInputValue('squad_dc').trim();
      const ccText = interaction.fields.getTextInputValue('squad_cc').trim();
      const dcList = dcText ? dcText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
      const ccList = ccText ? ccText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
      const squad = { name, dcList, ccList, dcCount: dcList.length, ccCount: ccList.length };
      await applySquadSubmission(game, isP1, squad, interaction.client);
      await interaction.reply({ content: `Squad **${name}** submitted. (${dcList.length} DCs, ${ccList.length} CCs)`, ephemeral: true });
    }
    if (interaction.customId.startsWith('deploy_modal_')) {
      const parts = interaction.customId.split('_');
      if (parts.length < 5) {
        await interaction.reply({ content: 'Invalid modal.', ephemeral: true }).catch(() => {});
        return;
      }
      const gameId = parts[2];
      const playerNum = parseInt(parts[3], 10);
      const flatIndex = parseInt(parts[4], 10);
      const game = games.get(gameId);
      if (!game) {
        await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
        return;
      }
      const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
      if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
        return;
      }
      const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
      const deployLabels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
      const figMeta = deployMeta?.[flatIndex];
      const figLabel = deployLabels?.[flatIndex];
      if (!figMeta || !figLabel) {
        await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
        return;
      }
      const space = (interaction.fields.getTextInputValue('deploy_space') || '').trim().toLowerCase();
      if (!space) {
        await interaction.reply({ content: 'Please enter a space (e.g. A1).', ephemeral: true }).catch(() => {});
        return;
      }
      const mapId = game.selectedMap?.id;
      const zones = mapId ? deploymentZones[mapId] : null;
      if (zones) {
        const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
        const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
        const validSpaces = (zones[playerZone] || []).map((s) => String(s).toLowerCase());
        if (validSpaces.length > 0 && !validSpaces.includes(space)) {
          await interaction.reply({ content: `**${space.toUpperCase()}** is not in your deployment zone. Check the map for valid cells (e.g. A1, B2).`, ephemeral: true }).catch(() => {});
          return;
        }
      }
      const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
      if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
      if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
      game.figurePositions[playerNum][figureKey] = space;
      saveGames();
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> deployed **${figLabel.replace(/^Deploy /, '')}** at **${space.toUpperCase()}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
      await updateDeployPromptMessages(game, playerNum, interaction.client);
      await interaction.reply({ content: `Deployed **${figLabel.replace(/^Deploy /, '')}** at **${space.toUpperCase()}**.`, ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith('dc_toggle_')) {
    const msgId = interaction.customId.replace('dc_toggle_', '');
    const meta = dcMessageMeta.get(msgId);
    if (!meta) {
      await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
      return;
    }
    const game = games.get(meta.gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this Play Area can toggle their DCs.', ephemeral: true }).catch(() => {});
      return;
    }
    const wasExhausted = dcExhaustedState.get(msgId) ?? false;
    const nowExhausted = !wasExhausted;
    dcExhaustedState.set(msgId, nowExhausted);
    const healthState = dcHealthState.get(msgId) ?? [[null, null]];
    
    // When going ready → exhausted, that uses an activation
    if (!wasExhausted && nowExhausted) {
      const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
      if (remaining > 0) {
        if (meta.playerNum === 1) {
          game.p1ActivationsRemaining--;
        } else {
          game.p2ActivationsRemaining--;
        }
        await updateActivationsMessage(game, meta.playerNum, client);
      }
    }
    // When going exhausted → ready, give an activation back (cap at total)
    if (wasExhausted && !nowExhausted) {
      const total = meta.playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
      const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
      if (remaining < total) {
        if (meta.playerNum === 1) {
          game.p1ActivationsRemaining++;
        } else {
          game.p2ActivationsRemaining++;
        }
        await updateActivationsMessage(game, meta.playerNum, client);
      }
    }
    saveGames();
    const displayName = meta.displayName || meta.dcName;
    const playerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    const action = nowExhausted ? 'exhausted' : 'readied';
    const actionIcon = action === 'exhausted' ? 'exhaust' : 'ready';
    await logGameAction(game, client, `<@${playerId}> ${action} **${displayName}**`, { allowedMentions: { users: [playerId] }, icon: actionIcon });
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, nowExhausted, displayName, healthState);
    await interaction.update({
      embeds: [embed],
      files,
      components: [getDcToggleButton(msgId, nowExhausted)],
    });
    return;
  }

  if (interaction.customId.startsWith('dc_move_') || interaction.customId.startsWith('dc_attack_') || interaction.customId.startsWith('dc_interact_') || interaction.customId.startsWith('dc_special_')) {
    let msgId, action, figureIndex = 0;
    if (interaction.customId.startsWith('dc_move_')) {
      const m = interaction.customId.match(/^dc_move_(.+)_f(\d+)$/);
      msgId = m ? m[1] : interaction.customId.replace('dc_move_', '');
      figureIndex = m ? parseInt(m[2], 10) : 0;
      action = 'Move';
    } else if (interaction.customId.startsWith('dc_attack_')) {
      const m = interaction.customId.match(/^dc_attack_(.+)_f(\d+)$/);
      msgId = m ? m[1] : interaction.customId.replace('dc_attack_', '');
      figureIndex = m ? parseInt(m[2], 10) : 0;
      action = 'Attack';
    } else if (interaction.customId.startsWith('dc_interact_')) {
      const m = interaction.customId.match(/^dc_interact_(.+)_f(\d+)$/);
      msgId = m ? m[1] : interaction.customId.replace('dc_interact_', '');
      figureIndex = m ? parseInt(m[2], 10) : 0;
      action = 'Interact';
    } else {
      const parts = interaction.customId.replace('dc_special_', '').split('_');
      const specialIdx = parseInt(parts[0], 10);
      msgId = parts.slice(1).join('_');
      const metaForAction = dcMessageMeta.get(msgId);
      const stats = metaForAction ? getDcStats(metaForAction.dcName) : { specials: [] };
      action = stats.specials?.[specialIdx] || 'Special';
    }
    const meta = dcMessageMeta.get(msgId);
    if (!meta) {
      await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
      return;
    }
    const game = games.get(meta.gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this Play Area can use these actions.', ephemeral: true }).catch(() => {});
      return;
    }
    if (action === 'Move') {
      const stats = getDcStats(meta.dcName);
      const speed = stats.speed ?? 4;
      await interaction.reply({
        content: `**Move** — Movement Points remaining: **${speed}**`,
        ephemeral: false,
      }).catch(() => {});
      return;
    }
    await interaction.reply({ content: `**${action}** — Coming soon.`, ephemeral: true }).catch(() => {});
    return;
  }

  if (interaction.customId.startsWith('map_selection_')) {
    const gameId = interaction.customId.replace('map_selection_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can select the map.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.mapSelected) {
      await interaction.reply({ content: `Map already selected: **${game.selectedMap?.name ?? 'Unknown'}**.`, ephemeral: true }).catch(() => {});
      return;
    }
    const playReadyMaps = getPlayReadyMaps();
    if (playReadyMaps.length === 0) {
      await interaction.reply({
        content: 'No maps have deployment zones configured yet. Add zone data to `data/deployment-zones.json` for at least one map.',
        ephemeral: true,
      }).catch(() => {});
      return;
    }
    const map = playReadyMaps[Math.floor(Math.random() * playReadyMaps.length)];
    game.selectedMap = { id: map.id, name: map.name, imagePath: map.imagePath };
    game.mapSelected = true;
    await interaction.deferUpdate();
    await logGameAction(game, client, `Map selected: **${map.name}**`, { phase: 'SETUP', icon: 'map' });
    if (game.generalSetupMessageId) {
      try {
        const generalChannel = await client.channels.fetch(game.generalId);
        const setupMsg = await generalChannel.messages.fetch(game.generalSetupMessageId);
        await setupMsg.edit({ components: [getGeneralSetupButtons(game)] });
      } catch (err) {
        console.error('Failed to remove Map Selection button:', err);
      }
    }
    if (game.boardId) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, map, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to post map to Board channel:', err);
      }
    }
    try {
      const p1Hand = await client.channels.fetch(game.p1HandId);
      const p2Hand = await client.channels.fetch(game.p2HandId);
      const isTest = game.player1Id === game.player2Id;
      const placeholderContent = `Once the map is selected in **Game Log**, you'll be able to pick your squad here.`;
      for (const ch of [p1Hand, p2Hand]) {
        const msgs = await ch.messages.fetch({ limit: 5 });
        const placeholder = msgs.find((m) => m.author.bot && m.content === placeholderContent);
        if (placeholder) await placeholder.delete().catch(() => {});
      }
      await p1Hand.send({
        content: `<@${game.player1Id}> — pick your squad below!${isTest ? ' *(Test — use Select Squad or Default deck buttons for each side.)*' : ''}`,
        allowedMentions: { users: [game.player1Id] },
        embeds: [getSquadSelectEmbed(1, null)],
        components: [getHandSquadButtons(game.gameId, 1)],
      });
      await p2Hand.send({
        content: `<@${game.player2Id}> — pick your squad below!${isTest ? ' *(Test — use Select Squad or Default deck buttons for each side.)*' : ''}`,
        allowedMentions: { users: [game.player2Id] },
        embeds: [getSquadSelectEmbed(2, null)],
        components: [getHandSquadButtons(game.gameId, 2)],
      });
    } catch (err) {
      console.error('Failed to populate Hand channels with squad UI:', err);
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('refresh_map_')) {
    const gameId = interaction.customId.replace('refresh_map_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can refresh the map.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!game.selectedMap) {
      await interaction.reply({ content: 'No map selected yet.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to refresh map:', err);
      await interaction.followUp({ content: 'Failed to refresh map.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith('determine_initiative_')) {
    const gameId = interaction.customId.replace('determine_initiative_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can determine initiative.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.initiativeDetermined) {
      await interaction.reply({ content: 'Initiative was already determined.', ephemeral: true }).catch(() => {});
      return;
    }
    const missing = [];
    if (!game.player1Squad) missing.push(`<@${game.player1Id}> (Player 1)`);
    if (!game.player2Squad) missing.push(`<@${game.player2Id}> (Player 2)`);
    if (missing.length > 0) {
      await interaction.reply({ content: 'Both players must select their squads before initiative can be determined.', ephemeral: true }).catch(() => {});
      const generalChannel = await client.channels.fetch(game.generalId).catch(() => null);
      if (generalChannel) {
        await generalChannel.send({
          content: `⚠️ **Initiative blocked** — Squad selection required first.\n\nStill needed: ${missing.join(', ')}`,
          allowedMentions: { users: [game.player1Id, game.player2Id] },
        }).catch(() => {});
      }
      return;
    }
    const winner = Math.random() < 0.5 ? game.player1Id : game.player2Id;
    const playerNum = winner === game.player1Id ? 1 : 2;
    game.initiativePlayerId = winner;
    game.initiativeDetermined = true;
    await interaction.deferUpdate();
    await logGameAction(game, client, `<@${winner}> won initiative! Chooses deployment zone and activates first each round.`, { allowedMentions: { users: [winner] }, phase: 'INITIATIVE', icon: 'initiative' });
    const generalChannel = await client.channels.fetch(game.generalId);
    const zoneMsg = await generalChannel.send({
      content: `<@${winner}> — Pick your deployment zone:`,
      allowedMentions: { users: [winner] },
      components: [getDeploymentZoneButtons(gameId)],
    });
    game.deploymentZoneMessageId = zoneMsg.id;
    if (game.generalSetupMessageId) {
      try {
        const setupMsg = await generalChannel.messages.fetch(game.generalSetupMessageId);
        await setupMsg.edit({ components: [getGeneralSetupButtons(game)] });
      } catch (err) {
        console.error('Failed to remove Determine Initiative button:', err);
      }
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('deployment_zone_red_') || interaction.customId.startsWith('deployment_zone_blue_')) {
    const isRed = interaction.customId.startsWith('deployment_zone_red_');
    const gameId = interaction.customId.replace(isRed ? 'deployment_zone_red_' : 'deployment_zone_blue_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.initiativePlayerId) {
      await interaction.reply({ content: 'Only the player with initiative can choose the deployment zone.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.deploymentZoneChosen) {
      await interaction.reply({ content: `Deployment zone already chosen: **${game.deploymentZoneChosen}**.`, ephemeral: true }).catch(() => {});
      return;
    }
    const zone = isRed ? 'red' : 'blue';
    game.deploymentZoneChosen = zone;
    await interaction.deferUpdate();
    await logGameAction(game, client, `<@${game.initiativePlayerId}> chose the **${zone}** deployment zone`, { allowedMentions: { users: [game.initiativePlayerId] }, phase: 'INITIATIVE', icon: 'zone' });
    if (game.deploymentZoneMessageId) {
      try {
        const generalChannel = await client.channels.fetch(game.generalId);
        const zoneMsg = await generalChannel.messages.fetch(game.deploymentZoneMessageId);
        await zoneMsg.edit({ content: `~~Pick your deployment zone~~ — **${zone}** chosen.`, components: [] });
      } catch (err) {
        console.error('Failed to remove deployment zone buttons:', err);
      }
    }
    const initiativeHandId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const initiativeSquad = initiativePlayerNum === 1 ? game.player1Squad : game.player2Squad;
    const initiativeDcList = initiativeSquad?.dcList || [];
    const { labels: initiativeLabels, metadata: initiativeMetadata } = getDeployFigureLabels(initiativeDcList);
    const deployLabelsKey = initiativePlayerNum === 1 ? 'player1DeployLabels' : 'player2DeployLabels';
    const deployMetadataKey = initiativePlayerNum === 1 ? 'player1DeployMetadata' : 'player2DeployMetadata';
    game[deployLabelsKey] = initiativeLabels;
    game[deployMetadataKey] = initiativeMetadata;
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    try {
      const initiativeHandChannel = await client.channels.fetch(initiativeHandId);
      const { deployRows, doneRow } = getDeployButtonRows(game.gameId, initiativePlayerNum, initiativeDcList, zone, game.figurePositions);
      const DEPLOY_ROWS_PER_MSG = 4;
      game.initiativeDeployMessageIds = game.initiativeDeployMessageIds || [];
      const initiativePing = `<@${game.initiativePlayerId}>`;
      if (deployRows.length === 0) {
        const msg = await initiativeHandChannel.send({
          content: `${initiativePing} — You chose the **${zone}** zone. When finished, click **I've Deployed** below.`,
          components: [doneRow],
          allowedMentions: { users: [game.initiativePlayerId] },
        });
        game.initiativeDeployMessageIds = [msg.id];
      } else {
        for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
          const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
          const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
          const components = isLastChunk ? [...chunk, doneRow] : chunk;
          const msg = await initiativeHandChannel.send({
            content: i === 0 ? `${initiativePing} — You chose the **${zone}** zone. Deploy each figure below (one per row), then click **I've Deployed** when finished.` : null,
            components,
            allowedMentions: { users: [game.initiativePlayerId] },
          });
          game.initiativeDeployMessageIds.push(msg.id);
        }
      }
      game.initiativeDeployMessageId = game.initiativeDeployMessageIds[game.initiativeDeployMessageIds.length - 1];
    } catch (err) {
      console.error('Failed to send deploy prompt to initiative player:', err);
    }
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('deployment_fig_')) {
    const parts = interaction.customId.split('_');
    if (parts.length < 5) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const gameId = parts[2];
    const playerNum = parseInt(parts[3], 10);
    const flatIndex = parseInt(parts[4], 10);
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
      return;
    }
    const labels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
    const label = labels?.[flatIndex];
    if (!label) {
      await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const mapId = game.selectedMap?.id;
    const zones = mapId ? deploymentZones[mapId] : null;
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
    const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
    const figMeta = deployMeta?.[flatIndex];
    const figureKey = figMeta ? `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}` : null;
    const occupied = [];
    if (game.figurePositions) {
      for (const p of [1, 2]) {
        for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
          if (p === playerNum && k === figureKey) continue;
          occupied.push(s);
        }
      }
    }
    if (validSpaces.length > 0) {
      const { rows, available } = getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, occupied, playerZone);
      if (available.length === 0) {
        await interaction.reply({ content: 'No spaces left in your deployment zone (all occupied).', ephemeral: true }).catch(() => {});
        return;
      }
      const BTM_PER_MSG = 5;
      const firstRows = rows.slice(0, BTM_PER_MSG);
      await interaction.reply({
        content: `Pick a space for **${label.replace(/^Deploy /, '')}**:`,
        components: firstRows,
        ephemeral: false,
      }).catch(() => {});
      for (let i = BTM_PER_MSG; i < rows.length; i += BTM_PER_MSG) {
        const more = rows.slice(i, i + BTM_PER_MSG);
        if (more.length > 0) await interaction.followUp({ content: null, components: more }).catch(() => {});
      }
    } else {
      const modal = new ModalBuilder()
        .setCustomId(`deploy_modal_${gameId}_${playerNum}_${flatIndex}`)
        .setTitle('Deploy figure');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('deploy_space')
            .setLabel('Space (e.g. A1)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. A1')
            .setRequired(true)
        )
      );
      await interaction.showModal(modal).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith('deploy_pick_')) {
    const match = interaction.customId.match(/^deploy_pick_([^_]+)_(\d+)_(\d+)_(.+)$/);
    if (!match) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const [, gameId, playerNumStr, flatIndexStr, space] = match;
    const playerNum = parseInt(playerNumStr, 10);
    const flatIndex = parseInt(flatIndexStr, 10);
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
      return;
    }
    const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
    const deployLabels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
    const figMeta = deployMeta?.[flatIndex];
    const figLabel = deployLabels?.[flatIndex];
    if (!figMeta || !figLabel) {
      await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
    game.figurePositions[playerNum][figureKey] = space.toLowerCase();
    saveGames();
    const spaceUpper = space.toUpperCase();
    await logGameAction(game, client, `<@${interaction.user.id}> deployed **${figLabel.replace(/^Deploy /, '')}** at **${spaceUpper}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
    await updateDeployPromptMessages(game, playerNum, client);
    await interaction.update({
      content: `✓ Deployed **${figLabel.replace(/^Deploy /, '')}** at **${spaceUpper}**.`,
      components: [],
    }).catch(() => interaction.reply({ content: `Deployed **${figLabel}** at **${spaceUpper}**.`, ephemeral: true }).catch(() => {}));
    return;
  }

  if (interaction.customId.startsWith('deployment_done_')) {
    const gameId = interaction.customId.replace('deployment_done_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can use this.', ephemeral: true }).catch(() => {});
      return;
    }
    const isInitiativePlayer = interaction.user.id === game.initiativePlayerId;
    const otherZone = game.deploymentZoneChosen === 'red' ? 'blue' : 'red';

    if (isInitiativePlayer) {
      if (game.initiativePlayerDeployed) {
        await interaction.reply({ content: "You've already marked deployed.", ephemeral: true }).catch(() => {});
        return;
      }
      game.initiativePlayerDeployed = true;
      await logGameAction(game, client, `<@${interaction.user.id}> finished deploying`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deployed' });
      await interaction.deferUpdate();
      if (game.initiativeDeployMessageIds?.length) {
        try {
          const handId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
          const handChannel = await client.channels.fetch(handId);
          for (const msgId of game.initiativeDeployMessageIds) {
            try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
          }
          game.initiativeDeployMessageIds = [];
          await handChannel.send({ content: '✓ **Deployed.**' });
        } catch (err) {
          console.error('Failed to update initiative deploy message:', err);
        }
      }
      const nonInitiativeHandId = game.initiativePlayerId === game.player1Id ? game.p2HandId : game.p1HandId;
      const nonInitiativePlayerNum = game.initiativePlayerId === game.player1Id ? 2 : 1;
      const nonInitiativeSquad = nonInitiativePlayerNum === 1 ? game.player1Squad : game.player2Squad;
      const nonInitiativeDcList = nonInitiativeSquad?.dcList || [];
      const { labels: nonInitiativeLabels, metadata: nonInitiativeMetadata } = getDeployFigureLabels(nonInitiativeDcList);
      const deployLabelsKey = nonInitiativePlayerNum === 1 ? 'player1DeployLabels' : 'player2DeployLabels';
      const deployMetadataKey = nonInitiativePlayerNum === 1 ? 'player1DeployMetadata' : 'player2DeployMetadata';
      game[deployLabelsKey] = nonInitiativeLabels;
      game[deployMetadataKey] = nonInitiativeMetadata;
      if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
      try {
        const nonInitiativePlayerId = nonInitiativePlayerNum === 1 ? game.player1Id : game.player2Id;
        const nonInitiativeHandChannel = await client.channels.fetch(nonInitiativeHandId);
        const { deployRows, doneRow } = getDeployButtonRows(gameId, nonInitiativePlayerNum, nonInitiativeDcList, otherZone, game.figurePositions);
        const DEPLOY_ROWS_PER_MSG = 4;
        game.nonInitiativeDeployMessageIds = game.nonInitiativeDeployMessageIds || [];
        const nonInitiativePing = `<@${nonInitiativePlayerId}>`;
        if (deployRows.length === 0) {
          const msg = await nonInitiativeHandChannel.send({
            content: `${nonInitiativePing} — Your opponent has deployed. Deploy in the **${otherZone}** zone. When finished, click **I've Deployed** below.`,
            components: [doneRow],
            allowedMentions: { users: [nonInitiativePlayerId] },
          });
          game.nonInitiativeDeployMessageIds = [msg.id];
        } else {
          for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
            const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
            const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
            const components = isLastChunk ? [...chunk, doneRow] : chunk;
            const msg = await nonInitiativeHandChannel.send({
              content: i === 0 ? `${nonInitiativePing} — Your opponent has deployed. Deploy each figure in the **${otherZone}** zone below (one per row), then click **I've Deployed** when finished.` : null,
              components,
              allowedMentions: { users: [nonInitiativePlayerId] },
            });
            game.nonInitiativeDeployMessageIds.push(msg.id);
          }
        }
        game.nonInitiativeDeployMessageId = game.nonInitiativeDeployMessageIds[game.nonInitiativeDeployMessageIds.length - 1];
      } catch (err) {
        console.error('Failed to send deploy prompt to non-initiative player:', err);
      }
      saveGames();
      return;
    }

    if (!game.initiativePlayerDeployed) {
      await interaction.reply({ content: 'Wait for the initiative player to deploy first.', ephemeral: true }).catch(() => {});
      return;
    }
    if (game.nonInitiativePlayerDeployed) {
      await interaction.reply({ content: "You've already marked deployed.", ephemeral: true }).catch(() => {});
      return;
    }
    game.nonInitiativePlayerDeployed = true;
    await interaction.deferUpdate();
    if (game.nonInitiativeDeployMessageIds?.length) {
      try {
        const handId = game.initiativePlayerId === game.player1Id ? game.p2HandId : game.p1HandId;
        const handChannel = await client.channels.fetch(handId);
        for (const msgId of game.nonInitiativeDeployMessageIds) {
          try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
        }
        game.nonInitiativeDeployMessageIds = [];
        await handChannel.send({ content: '✓ **Deployed.**' });
      } catch (err) {
        console.error('Failed to update non-initiative deploy message:', err);
      }
    }
    const generalChannel = await client.channels.fetch(game.generalId);
    await generalChannel.send({
      content: '**Both players have deployed.** Game on!',
    });
    saveGames();
    return;
  }

  if (interaction.customId.startsWith('kill_game_')) {
    const gameId = interaction.customId.replace('kill_game_', '');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found or already deleted.', ephemeral: true });
      return;
    }
    if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
      await interaction.reply({ content: 'Only players in this game can kill it.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const categoryId = interaction.channel.parentId;
      const category = await interaction.guild.channels.fetch(categoryId);
      const children = interaction.guild.channels.cache.filter((c) => c.parentId === categoryId);
      for (const ch of children.values()) {
        await ch.delete();
      }
      await category.delete();
      games.delete(gameId);
      saveGames();
      for (const [msgId, meta] of dcMessageMeta) {
        if (meta.gameId === gameId) {
          dcMessageMeta.delete(msgId);
          dcExhaustedState.delete(msgId);
          dcHealthState.delete(msgId);
        }
      }
      try {
        await interaction.editReply({ content: `Game **IA Game #${gameId}** deleted. All channels removed.` });
      } catch {
        // Channel was deleted, reply fails - ignore
      }
    } catch (err) {
      console.error('Kill game error:', err);
      try {
        await interaction.editReply({ content: `Failed to delete: ${err.message}` }).catch(() => {});
      } catch {
        // ignore
      }
    }
    return;
  }

  if (interaction.customId.startsWith('default_deck_')) {
    const parts = interaction.customId.split('_');
    if (parts.length < 5) {
      await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
      return;
    }
    const gameId = parts[2];
    const playerNum = parts[3];
    const faction = parts[4];
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!game.mapSelected) {
      await interaction.reply({ content: 'Map selection must be completed before you can load a squad.', ephemeral: true }).catch(() => {});
      return;
    }
    const isP1 = playerNum === '1';
    const userId = isP1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== userId) {
      await interaction.reply({ content: 'Only the owner of this hand can load a default deck.', ephemeral: true }).catch(() => {});
      return;
    }
    const squadMap = { rebel: DEFAULT_DECK_REBELS, scum: DEFAULT_DECK_SCUM, imperial: DEFAULT_DECK_IMPERIAL };
    const squad = squadMap[faction];
    if (!squad) {
      await interaction.reply({ content: 'Unknown faction.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      await applySquadSubmission(game, isP1, { ...squad }, client);
      await interaction.editReply({ content: `Loaded **${squad.name}** (${squad.dcCount} DCs, ${squad.ccCount} CCs).` }).catch(() => {});
    } catch (err) {
      console.error('Failed to apply default deck:', err);
      await interaction.editReply({ content: `Failed to load deck: ${err.message}` }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith('squad_select_')) {
    const [, , gameId, playerNum] = interaction.customId.split('_');
    const game = games.get(gameId);
    if (!game) {
      await interaction.reply({ content: 'This game no longer exists.', ephemeral: true });
      return;
    }
    if (!game.mapSelected) {
      await interaction.reply({ content: 'Map selection must be completed before you can select your squad.', ephemeral: true });
      return;
    }
    const isP1 = playerNum === '1';
    const userId = isP1 ? game.player1Id : game.player2Id;
    if (interaction.user.id !== userId) {
      await interaction.reply({ content: 'Only the owner of this hand can select a squad.', ephemeral: true });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`squad_modal_${gameId}_${playerNum}`)
      .setTitle('Submit Squad');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('squad_name')
          .setLabel('Squad name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Vader\'s Fist')
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('squad_dc')
          .setLabel('Deployment Cards (one per line, max 40 pts)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Darth Vader\nStormtrooper\nStormtrooper\n...')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('squad_cc')
          .setLabel('Command Cards (one per line, exactly 15)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Force Lightning\nBurst Fire\n...')
          .setRequired(true)
      )
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId.startsWith('lobby_join_')) {
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
    return;
  }

  if (interaction.customId.startsWith('lobby_start_')) {
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
    lobby.status = 'Launched';

    // Check if this is a Test game (thread has Test tag)
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
    try {
      const guild = interaction.guild;
      const { gameId, generalChannel, chatChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel } =
        await createGameChannels(guild, lobby.creatorId, lobby.joinedId, { createPlayAreas: false });
      const game = {
        gameId,
        gameCategoryId: generalChannel.parentId,
        player1Id: lobby.creatorId,
        player2Id: lobby.joinedId,
        generalId: generalChannel.id,
        chatId: chatChannel.id,
        boardId: boardChannel.id,
        p1HandId: p1HandChannel.id,
        p2HandId: p2HandChannel.id,
        p1PlayAreaId: p1PlayAreaChannel?.id ?? null,
        p2PlayAreaId: p2PlayAreaChannel?.id ?? null,
        player1Squad: null,
        player2Squad: null,
        player1VP: { total: 0, kills: 0, objectives: 0 },
        player2VP: { total: 0, kills: 0, objectives: 0 },
      };
      games.set(gameId, game);

      const setupMsg = await generalChannel.send({
        content: `<@${game.player1Id}> <@${game.player2Id}> — Game created. Map Selection below, then go to your **Hand** channel to pick your deck. Use **General chat** to talk with your opponent.`,
        allowedMentions: { users: [...new Set([game.player1Id, game.player2Id])] },
        embeds: [
          new EmbedBuilder()
            .setTitle(isTestGame ? 'Game Setup (Test)' : 'Game Setup')
            .setDescription(
              isTestGame
                ? '**Test game** — use your **Hand** channel: click **Select Squad** (form) or **Default Rebels** (red) / **Default Scum** (green) / **Default Imperial** (grey) to load a deck.'
                : '**Map Selection** first (button below), then both players: go to your **Hand** channel (private) and click **Select Squad** or a default deck button to submit your deck.'
            )
            .setColor(0x2f3136),
        ],
        components: [getGeneralSetupButtons(game)],
      });
      game.generalSetupMessageId = setupMsg.id;
      await p1HandChannel.send({
        content: `Once the map is selected in **Game Log**, you'll be able to pick your squad here.`,
      });
      await p2HandChannel.send({
        content: `Once the map is selected in **Game Log**, you'll be able to pick your squad here.`,
      });

      await interaction.followUp({
        content: `Game **IA Game #${gameId}** is ready!${isTestGame ? ' (Test)' : ''} Check your **Hand** channel: Select Squad or Default Rebels / Scum / Imperial.`,
        ephemeral: true,
      });
      await updateThreadName(interaction.channel, lobby);
      await interaction.channel.setArchived(true);
    } catch (err) {
      console.error('Failed to create game channels:', err);
      await interaction.followUp({
        content: `Failed to create game: ${err.message}. Ensure the bot has **Manage Channels** permission.`,
        ephemeral: true,
      });
    }
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  if (interaction.customId === 'create_game') {
    await interaction.editReply({
      content: 'Go to **#new-games** and click **Create Post** to start a lobby. The bot will add the Join Game button.',
      components: [getMainMenu()],
    });
  }
  if (interaction.customId === 'join_game') {
    await interaction.editReply({
      content: 'Browse **#new-games** and click **Join Game** on a lobby post that needs an opponent.',
      components: [getMainMenu()],
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
