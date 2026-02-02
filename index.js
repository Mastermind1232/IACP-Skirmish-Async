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

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname);

// DC message metadata (messageId -> { gameId, playerNum, dcName, displayName })
const dcMessageMeta = new Map();
const dcExhaustedState = new Map(); // messageId -> boolean

let dcImages = {};
let dcStats = {};
try {
  const dcData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-images.json'), 'utf8'));
  dcImages = dcData.dcImages || {};
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

async function createGameChannels(guild, player1Id, player2Id) {
  // Scan for existing IA #XXXXX categories (active, archived, completed) so we never reuse an ID
  await guild.channels.fetch();
  const gameCategories = guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildCategory && /^IA #(\d+)$/.test(c.name)
  );
  const maxId = gameCategories.reduce((max, c) => {
    const m = c.name.match(/^IA #(\d+)$/);
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
    name: `IA #${gameId}`,
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

  const generalChannel = await guild.channels.create({
    name: `${prefix} General chat`,
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
    name: `${prefix} Player 1 Hand`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: p1Only,
  });
  const p2HandChannel = await guild.channels.create({
    name: `${prefix} Player 2 Hand`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: p2Only,
  });
  const p1PlayAreaChannel = await guild.channels.create({
    name: `${prefix} Player 1 Play Area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });
  const p2PlayAreaChannel = await guild.channels.create({
    name: `${prefix} Player 2 Play Area`,
    type: ChannelType.GuildText,
    parent: gameCategory.id,
    permissionOverwrites: playAreaPerms,
  });

  return { gameCategory, gameId, generalChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel };
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

/** Same display names as Play Area: duplicate DCs get [DG 1], [DG 2], etc. */
function getDeployDisplayNames(dcList) {
  if (!dcList?.length) return [];
  const totals = {};
  const counts = {};
  for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
  return dcList.map((dcName) => {
    counts[dcName] = (counts[dcName] || 0) + 1;
    const dgIndex = counts[dcName];
    return totals[dcName] > 1 ? `${dcName} [DG ${dgIndex}]` : dcName;
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
    const displayName = totals[dcName] > 1 ? `${dcName} [DG ${dgIndex}]` : dcName;
    const baseName = displayName.replace(/\s*\[DG \d+\]$/, '');
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

/** One button per row (vertical list). Zone = 'red' | 'blue' for button color. Returns { deployRows, doneRow }; deployRows may exceed 5 (caller splits into messages). */
function getDeployButtonRows(gameId, playerNum, dcList, zone) {
  const { labels } = getDeployFigureLabels(dcList);
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  const deployRows = labels.map((label, i) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`deployment_fig_${gameId}_${playerNum}_${i}`)
        .setLabel(label.slice(0, 80))
        .setStyle(zoneStyle)
    )
  );
  const doneRow = getDeploymentDoneButton(gameId);
  return { deployRows, doneRow };
}

/** Returns { content, files?, components } for posting the game map to the Board channel (initial or refresh). */
function buildBoardMapPayload(gameId, map) {
  const pdfPath = join(rootDir, 'data', 'map-pdfs', `${map.id}.pdf`);
  const imagePath = map.imagePath ? join(rootDir, map.imagePath) : null;
  const components = [getRefreshMapButton(gameId)];
  if (existsSync(pdfPath)) {
    return {
      content: `**Game map: ${map.name}** (high-res PDF)`,
      files: [new AttachmentBuilder(pdfPath, { name: `${map.id}.pdf` })],
      components,
    };
  }
  if (imagePath && existsSync(imagePath)) {
    return {
      content: `**Game map: ${map.name}** *(Add \`data/map-pdfs/${map.id}.pdf\` for high-res PDF)*`,
      files: [new AttachmentBuilder(imagePath, { name: `map.${(map.imagePath || '').split('.').pop() || 'gif'}` })],
      components,
    };
  }
  return {
    content: `**Game map: ${map.name}** — Add high-res PDF at \`data/map-pdfs/${map.id}.pdf\` to display it here.`,
    components,
  };
}

/** Returns one row: Map Selection (if not yet selected), then Determine Initiative (if not yet determined), then Kill Game. */
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
  if (!game.initiativeDetermined) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`determine_initiative_${game.gameId}`)
        .setLabel('Determine Initiative')
        .setStyle(ButtonStyle.Primary)
    );
  }
  components.push(killBtn);
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

function getDcImagePath(dcName) {
  if (!dcName || typeof dcName !== 'string') return null;
  const exact = dcImages[dcName];
  if (exact) return exact;
  const lower = dcName.toLowerCase();
  const key = Object.keys(dcImages).find((k) => k.toLowerCase() === lower);
  return key ? dcImages[key] : null;
}

function getDcStats(dcName) {
  const exact = dcStats[dcName];
  if (exact) return exact;
  const lower = dcName?.toLowerCase?.() || '';
  const key = Object.keys(dcStats).find((k) => k.toLowerCase() === lower);
  if (key) return dcStats[key];
  return { health: null, figures: 1, specials: [] };
}

/** Returns [universalActionsRow, specialsRow?]. Row 1: Move (green), Attack (red), Interact (grey). Row 2: up to 5 blue special buttons. */
function getDcActionButtons(msgId, dcName) {
  const stats = getDcStats(dcName);
  const specials = stats.specials || [];

  const universalRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dc_move_${msgId}`).setLabel('Move').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`dc_attack_${msgId}`).setLabel('Attack').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`dc_interact_${msgId}`).setLabel('Interact').setStyle(ButtonStyle.Secondary)
  );

  const specialBtns = specials.slice(0, 5).map((name, idx) =>
    new ButtonBuilder()
      .setCustomId(`dc_special_${idx}_${msgId}`)
      .setLabel(name.slice(0, 80))
      .setStyle(ButtonStyle.Primary)
  );
  const specialsRow = specialBtns.length > 0
    ? new ActionRowBuilder().addComponents(...specialBtns)
    : null;

  return specialsRow ? [universalRow, specialsRow] : [universalRow];
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
  const dgIndex = displayName.match(/\[DG (\d+)\]/)?.[1] ?? 1;
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  const variant = dcName?.includes('(Elite)') ? 'Elite' : dcName?.includes('(Regular)') ? 'Regular' : null;
  const specials = (stats.specials || []).length > 0 ? stats.specials.join(', ') : 'None';
  const healthSection = formatHealthSection(Number(dgIndex), healthState);
  const lines = [
    `**Figures:** ${figures}`,
    variant ? `**Variant:** ${variant}` : null,
    '',
    healthSection,
    '',
    `**Specials:** ${specials}`,
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
      components: getDcActionButtons(msg.id, dcName),
    });
  };

  const processDcList = (dcList) => {
    const counts = {};
    const totals = {};
    for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
    return dcList.map((dcName) => {
      counts[dcName] = (counts[dcName] || 0) + 1;
      const dgIndex = counts[dcName];
      const displayName = totals[dcName] > 1 ? `${dcName} [DG ${dgIndex}]` : dcName;
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
      await populatePlayAreas(game, client);
    } catch (err) {
      console.error('Failed to populate Play Areas:', err);
    }
    await generalChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('Both Squads Ready')
          .setDescription(
            `**Player 1:** ${game.player1Squad.name || 'Unnamed'} (${game.player1Squad.dcCount} DCs, ${game.player1Squad.ccCount} CCs)\n` +
              `**Player 2:** ${game.player2Squad.name || 'Unnamed'} (${game.player2Squad.dcCount} DCs, ${game.player2Squad.ccCount} CCs)\n\n` +
              'Play Area channels have been populated with one thread per Deployment Card. Next: map selection (coming soon).'
          )
          .setColor(0x57f287),
      ],
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
        (c) => c.type === ChannelType.GuildCategory && /^IA #\d+$/.test(c.name)
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
        await interaction.reply({ content: 'Please enter a space (e.g. a1).', ephemeral: true }).catch(() => {});
        return;
      }
      const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
      if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
      if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
      game.figurePositions[playerNum][figureKey] = space;
      saveGames();
      await interaction.reply({ content: `Deployed **${figLabel}** at **${space}**.`, ephemeral: true }).catch(() => {});
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
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, nowExhausted, meta.displayName || meta.dcName, healthState);
    await interaction.update({
      embeds: [embed],
      files,
      components: [getDcToggleButton(msgId, nowExhausted)],
    });
    return;
  }

  if (interaction.customId.startsWith('dc_move_') || interaction.customId.startsWith('dc_attack_') || interaction.customId.startsWith('dc_interact_') || interaction.customId.startsWith('dc_special_')) {
    // Parse: dc_move_msgId, dc_attack_msgId, dc_interact_msgId, or dc_special_idx_msgId
    let msgId, action;
    if (interaction.customId.startsWith('dc_move_')) {
      msgId = interaction.customId.replace('dc_move_', '');
      action = 'Move';
    } else if (interaction.customId.startsWith('dc_attack_')) {
      msgId = interaction.customId.replace('dc_attack_', '');
      action = 'Attack';
    } else if (interaction.customId.startsWith('dc_interact_')) {
      msgId = interaction.customId.replace('dc_interact_', '');
      action = 'Interact';
    } else {
      // dc_special_idx_msgId
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
    if (mapRegistry.length === 0) {
      await interaction.reply({ content: 'No maps in registry.', ephemeral: true }).catch(() => {});
      return;
    }
    const map = mapRegistry[Math.floor(Math.random() * mapRegistry.length)];
    game.selectedMap = { id: map.id, name: map.name, imagePath: map.imagePath };
    game.mapSelected = true;
    await interaction.deferUpdate();
    const generalChannel = await client.channels.fetch(game.generalId);
    await generalChannel.send({
      content: `**Map:** **${map.name}** was randomly selected as the game map.`,
    });
    if (game.generalSetupMessageId) {
      try {
        const setupMsg = await generalChannel.messages.fetch(game.generalSetupMessageId);
        await setupMsg.edit({ components: [getGeneralSetupButtons(game)] });
      } catch (err) {
        console.error('Failed to remove Map Selection button:', err);
      }
    }
    if (game.boardId) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = buildBoardMapPayload(game.gameId, map);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to post map to Board channel:', err);
      }
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
      const payload = buildBoardMapPayload(gameId, game.selectedMap);
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
    const winner = Math.random() < 0.5 ? game.player1Id : game.player2Id;
    const playerNum = winner === game.player1Id ? 1 : 2;
    game.initiativePlayerId = winner;
    game.initiativeDetermined = true;
    await interaction.deferUpdate();
    const generalChannel = await client.channels.fetch(game.generalId);
    await generalChannel.send({
      content: `**Initiative:** <@${winner}> (Player ${playerNum}) has the initiative token! They choose deployment zone (red or blue) and activate first each round.`,
      allowedMentions: { users: [winner] },
    });
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
    const generalChannel = await client.channels.fetch(game.generalId);
    await generalChannel.send({
      content: `**Deployment zone:** <@${game.initiativePlayerId}> chose the **${zone}** zone. Their figures deploy there; opponent deploys in the other zone.`,
      allowedMentions: { users: [game.initiativePlayerId] },
    });
    if (game.deploymentZoneMessageId) {
      try {
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
      const { deployRows, doneRow } = getDeployButtonRows(game.gameId, initiativePlayerNum, initiativeDcList, zone);
      const DEPLOY_ROWS_PER_MSG = 4;
      let lastMsg = null;
      if (deployRows.length === 0) {
        lastMsg = await initiativeHandChannel.send({
          content: `You chose the **${zone}** zone. When finished, click **I've Deployed** below.`,
          components: [doneRow],
        });
      } else {
        for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
          const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
          const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
          const components = isLastChunk ? [...chunk, doneRow] : chunk;
          lastMsg = await initiativeHandChannel.send({
            content: i === 0 ? `You chose the **${zone}** zone. Deploy each figure below (one per row), then click **I've Deployed** when finished.` : null,
            components,
          });
        }
      }
      if (lastMsg) game.initiativeDeployMessageId = lastMsg.id;
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
    const modal = new ModalBuilder()
      .setCustomId(`deploy_modal_${gameId}_${playerNum}_${flatIndex}`)
      .setTitle('Deploy figure');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deploy_space')
          .setLabel('Space (e.g. a1)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. a1')
          .setRequired(true)
      )
    );
    await interaction.showModal(modal).catch(() => {});
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
      await interaction.deferUpdate();
      if (game.initiativeDeployMessageId) {
        try {
          const handId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
          const handChannel = await client.channels.fetch(handId);
          const msg = await handChannel.messages.fetch(game.initiativeDeployMessageId);
          await msg.edit({ content: '✓ **Deployed.**', components: [] });
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
        const nonInitiativeHandChannel = await client.channels.fetch(nonInitiativeHandId);
        const { deployRows, doneRow } = getDeployButtonRows(gameId, nonInitiativePlayerNum, nonInitiativeDcList, otherZone);
        const DEPLOY_ROWS_PER_MSG = 4;
        let lastMsg = null;
        if (deployRows.length === 0) {
          lastMsg = await nonInitiativeHandChannel.send({
            content: `Your opponent has deployed. Deploy in the **${otherZone}** zone. When finished, click **I've Deployed** below.`,
            components: [doneRow],
          });
        } else {
          for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
            const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
            const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
            const components = isLastChunk ? [...chunk, doneRow] : chunk;
            lastMsg = await nonInitiativeHandChannel.send({
              content: i === 0 ? `Your opponent has deployed. Deploy each figure in the **${otherZone}** zone below (one per row), then click **I've Deployed** when finished.` : null,
              components,
            });
          }
        }
        if (lastMsg) game.nonInitiativeDeployMessageId = lastMsg.id;
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
    if (game.nonInitiativeDeployMessageId) {
      try {
        const handId = game.initiativePlayerId === game.player1Id ? game.p2HandId : game.p1HandId;
        const handChannel = await client.channels.fetch(handId);
        const msg = await handChannel.messages.fetch(game.nonInitiativeDeployMessageId);
        await msg.edit({ content: '✓ **Deployed.**', components: [] });
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
        await interaction.editReply({ content: `Game **IA #${gameId}** deleted. All channels removed.` });
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
      const { gameId, generalChannel, boardChannel, p1HandChannel, p2HandChannel, p1PlayAreaChannel, p2PlayAreaChannel } =
        await createGameChannels(guild, lobby.creatorId, lobby.joinedId);
      const game = {
        gameId,
        player1Id: lobby.creatorId,
        player2Id: lobby.joinedId,
        generalId: generalChannel.id,
        boardId: boardChannel.id,
        p1HandId: p1HandChannel.id,
        p2HandId: p2HandChannel.id,
        p1PlayAreaId: p1PlayAreaChannel.id,
        p2PlayAreaId: p2PlayAreaChannel.id,
        player1Squad: null,
        player2Squad: null,
      };
      games.set(gameId, game);

      const setupMsg = await generalChannel.send({
        content: `<@${game.player1Id}> <@${game.player2Id}> — Game created. Map Selection below, then go to your **Hand** channel to pick your deck (Select Squad or default buttons).`,
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
        content: `<@${lobby.creatorId}> — add your deck below!${isTestGame ? ' *(Test — use Select Squad or the default deck buttons.)*' : ''}`,
        allowedMentions: { users: [lobby.creatorId] },
        embeds: [getSquadSelectEmbed(1, null)],
        components: [getHandSquadButtons(gameId, 1)],
      });
      await p2HandChannel.send({
        content: `<@${lobby.joinedId}> — add your deck below!${isTestGame ? ' *(Test — use Select Squad or the default deck buttons.)*' : ''}`,
        allowedMentions: { users: [lobby.joinedId] },
        embeds: [getSquadSelectEmbed(2, null)],
        components: [getHandSquadButtons(gameId, 2)],
      });

      await interaction.followUp({
        content: `Game **IA #${gameId}** is ready!${isTestGame ? ' (Test)' : ''} Check your **Hand** channel: Select Squad or Default Rebels / Scum / Imperial.`,
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
