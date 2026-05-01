/**
 * Miscellaneous helper functions extracted from index.js.
 * Includes attachment embed building, game-end checks, undo, ID extraction, round messaging.
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from 'discord.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { computeDeckHash } from '../game/deck-hash.js';
import { getFavoriteDeckByHash, isFavoritesAvailable } from '../db.js';
import { buildFavoriteConfirmButtons, buildFavoriteConfirmContent } from '../discord/favorite-prompts.js';
import { getLoadoutCards, getRootDir } from '../data-loader.js';

/**
 * Build embeds and files for the "Attachments" message under a DC.
 * CC attachments then DC (Skirmish Upgrade) attachments.
 * @param {string[]} ccNames
 * @param {string[]} [dcNames]
 * @param {string|null} [attachedToDcName]
 * @param {object} deps
 * @returns {Promise<{ embeds: EmbedBuilder[], files: AttachmentBuilder[] }>}
 */
export async function buildAttachmentEmbedsAndFiles(ccNames, dcNames, attachedToDcName, deps) {
  const embeds = [];
  const files = [];
  const loadoutCards = getLoadoutCards();
  const rootDir = getRootDir();
  const items = [
    ...(ccNames || []).map((name, i) => ({ name, prefix: 'cc-attach', fallbackLabel: `Attachment ${i + 1}`, resolvePath: deps.getCommandCardImagePath })),
    ...(dcNames || []).map((name, i) => {
      const loadout = loadoutCards[name];
      if (loadout) {
        return {
          name, prefix: 'loadout', fallbackLabel: 'Loadout',
          resolvePath: () => loadout.imagePath ? deps.join(rootDir, loadout.imagePath) : null,
          isLoadout: true, abilityText: loadout.abilityText,
        };
      }
      return { name, prefix: 'dc-attach', fallbackLabel: `Skirmish Upgrade ${i + 1}`, resolvePath: (n) => { const rel = deps.getDcImagePath(n); return rel ? deps.join(deps.rootDir, rel) : null; } };
    }),
  ];
  for (let i = 0; i < items.length; i++) {
    const { name, prefix, fallbackLabel, resolvePath, isLoadout, abilityText } = items[i];
    const path = resolvePath(name);
    const ext = path ? (path.toLowerCase().endsWith('.png') ? 'png' : 'jpg') : 'jpg';
    const fileName = `${prefix}-${i}-${(name || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const embed = new EmbedBuilder()
      .setTitle(isLoadout ? `\u2694\uFE0F Imperial Loadout: ${name}` : `\uD83D\uDCCE ${name || fallbackLabel}`)
      .setColor(deps.COLORS.BLURPLE);
    if (attachedToDcName) {
      embed.setDescription(isLoadout
        ? `**${attachedToDcName}** \u2014 ${abilityText}`
        : `Attached to: **${attachedToDcName}**`);
    }
    if (path && deps.existsSync(path)) {
      files.push(new AttachmentBuilder(path, { name: fileName }));
      if (isLoadout) {
        embed.setImage(`attachment://${fileName}`);
      } else {
        embed.setThumbnail(`attachment://${fileName}`);
      }
    }
    embeds.push(embed);
  }
  return { embeds, files };
}

/**
 * Returns true if game ended (and replied to user). Call after getGame() in handlers to block further actions.
 * @param {object} game
 * @param {object} interaction
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
export async function replyIfGameEnded(game, interaction, deps) {
  if (game?.ended) {
    await interaction.followUp({ content: 'This game has ended.', ephemeral: true }).catch(deps.discordCatch);
    return true;
  }
  return false;
}

/**
 * Push one undo step. Trims to MAX_UNDO_DEPTH to prevent unbounded growth.
 * @param {object} game
 * @param {object} entry
 * @param {object} deps
 */
export function pushUndo(game, entry, deps) {
  game.undoStack = game.undoStack || [];
  const { undoStack, ...rest } = game;
  const snapshot = JSON.parse(JSON.stringify(rest));
  game.undoStack.push({ ...entry, snapshot, ts: Date.now() });
  if (game.undoStack.length > deps.MAX_UNDO_DEPTH) game.undoStack.shift();
}

/**
 * Extract game ID from an interaction's customId using known prefix patterns.
 * @param {object} interaction
 * @param {object} deps
 * @returns {string|null}
 */
export function extractGameIdFromInteraction(interaction, deps) {
  const id = interaction.customId || interaction.values?.[0] || '';
  const prefixes = [
    'status_phase_', 'end_end_of_round_', 'end_start_of_round_', 'map_selection_', 'draft_random_',
    'pass_activation_turn_', 'combat_ready_', 'combat_roll_', 'cc_play_select_', 'cc_discard_select_', 'cc_attach_to_',
    'botmenu_kill_yes_', 'botmenu_kill_no_', 'botmenu_kill_',
    'kill_game_', 'refresh_map_', 'refresh_all_', 'undo_', 'deployment_zone_red_', 'deployment_zone_blue_',
  ];
  const games = deps.getGamesMap();
  for (const p of prefixes) {
    if (id.startsWith(p)) {
      const rest = id.slice(p.length);
      const gameId = rest.split('_')[0];
      if (gameId && games.has(gameId)) return gameId;
      return gameId || null;
    }
  }
  const m = id.match(/^(?:squad_modal_|deploy_modal_|special_done_|interact_choice_|interact_cancel_)([^_]+)/);
  if (m && games.has(m[1])) return m[1];
  const dcMatch = id.match(/^dc_(?:activate|move|attack|interact|special)_([^_]+)/);
  if (dcMatch) {
    const part = dcMatch[1];
    if (games.has(part)) return part;
    for (const [gid, g] of games) {
      if (g.p1DcMessageIds?.includes(part) || g.p2DcMessageIds?.includes(part)) return gid;
      for (const [msgId, meta] of deps.dcMessageMeta) {
        if (meta.gameId === gid && (String(msgId) === part || part.startsWith(msgId))) return gid;
      }
    }
  }
  const moveMatch = id.match(/^move_(?:mp|pick)_([^_]+)/);
  if (moveMatch && games.has(moveMatch[1])) return moveMatch[1];
  const attackMatch = id.match(/^attack_target_(.+)_\d+_\d+$/);
  if (attackMatch) {
    const msgId = attackMatch[1];
    for (const [gid, g] of games) {
      if ([...(g.p1DcMessageIds || []), ...(g.p2DcMessageIds || [])].includes(msgId)) return gid;
    }
  }
  return null;
}

/**
 * Resolve game ID for per-game mutex locking.
 * Tries multiple strategies: prefix stripping, dcMessageMeta lookup, existing extractor, channel-based.
 * Returns null for interactions that don't belong to a game (lobby, menu, etc.) — those run without lock.
 * @param {object} interaction
 * @param {object} deps
 * @returns {string|null}
 */
export function resolveGameIdForLock(interaction, deps) {
  const customId = interaction.customId || '';
  if (!customId) return null;

  const type = interaction.isButton?.() ? 'button'
    : interaction.isStringSelectMenu?.() ? 'select'
    : interaction.isModalSubmit?.() ? 'modal'
    : null;
  if (!type) return null;

  const prefix = deps.getHandlerKey(customId, type);
  if (!prefix) return null;

  const payload = customId.slice(prefix.length);
  const firstSegment = payload.split('_')[0];

  // Strategy 1: first segment is a gameId directly (5-digit zero-padded)
  if (firstSegment && deps.getGame(firstSegment)) return firstSegment;

  // Strategy 2: first segment is a Discord message ID -> look up in dcMessageMeta
  if (firstSegment && /^\d{10,}$/.test(firstSegment)) {
    const meta = deps.dcMessageMeta.get(firstSegment);
    if (meta?.gameId) return meta.gameId;
  }

  // Strategy 3: fall back to existing extractor (handles more complex patterns)
  const existing = extractGameIdFromInteraction(interaction, deps);
  if (existing) return existing;

  // Strategy 4: resolve by channel (covers thread-based interactions)
  const _chMatch = deps.findGameByChannel(deps.getGamesMap(), interaction.channelId);
  if (_chMatch) return _chMatch.gameId;

  return null;
}

/**
 * Extract game ID from a message by channel lookup.
 * @param {object} message
 * @param {object} deps
 * @returns {string|null}
 */
export function extractGameIdFromMessage(message, deps) {
  const chId = message.channel?.id;
  if (!chId) return null;
  const _msgMatch = deps.findGameByChannel(deps.getGamesMap(), chId);
  if (_msgMatch) return _msgMatch.gameId;
  if (message.channel?.isThread?.()) {
    const parent = message.channel.parent;
    if (parent?.name === 'new-games') return null;
    for (const [gameId, g] of deps.getGamesMap()) {
      const cat = message.guild?.channels?.cache?.get(g.gameCategoryId);
      if (cat && message.channel.parentId === cat.id) return gameId;
    }
  }
  return null;
}

/**
 * Post Devaron Garrison B door-selection buttons for the next player in game.pendingDoorSelections.
 * @param {object} game
 * @param {Array} allDoors - from map-tokens.json, array of [a, b] coordinate pairs
 * @param {import('discord.js').TextChannel} channel - general channel
 * @param {string} gameId
 * @param {object} deps
 */
export async function postDevaronDoorButtons(game, allDoors, channel, gameId, deps) {
  if (!game.pendingDoorSelections || game.pendingDoorSelections.length === 0) return;
  const pending = game.pendingDoorSelections[0];
  const { playerNum, doorsRemaining } = pending;
  const pid = deps.getPlayerId(game, playerNum);
  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  const available = (allDoors || []).filter(([a, b]) => {
    const ek1 = `${a}|${b}`.toLowerCase();
    const ek2 = `${b}|${a}`.toLowerCase();
    return !openedSet.has(ek1) && !openedSet.has(ek2);
  });
  if (available.length === 0) {
    game.pendingDoorSelections.shift();
    await channel.send(sanitizeMentions({ content: `<@${pid}> — All doors are already open (no more selections needed).`, allowedMentions: { users: [pid] } })).catch(deps.discordCatch);
    return;
  }
  const rows = [];
  for (let i = 0; i < Math.min(available.length, 20); i += 5) {
    const chunk = available.slice(i, i + 5);
    rows.push(new ActionRowBuilder().addComponents(
      chunk.map(([a, b]) => new ButtonBuilder()
        .setCustomId(`devaron_door_open_${gameId}_${a.toLowerCase()}|${b.toLowerCase()}`)
        .setLabel(`Open door ${a.toUpperCase()}↔${b.toUpperCase()}`)
        .setStyle(ButtonStyle.Primary)
      )
    ));
  }
  await channel.send(sanitizeMentions({
    content: `<@${pid}> — **Crate Rush (EoR)**: You control ${doorsRemaining} terminal${doorsRemaining !== 1 ? 's' : ''}. Choose a door to open (${doorsRemaining} remaining):`,
    components: rows,
    allowedMentions: { users: [pid] },
  })).catch(deps.discordCatch);
}

/**
 * Post crate-push buttons for Devaron Garrison B end-of-round crate push phase.
 * @param {object} game
 * @param {import('discord.js').TextChannel} channel - general channel
 * @param {string} gameId
 * @param {object} deps
 */
export async function postDevaronCratePushPrompts(game, channel, gameId, deps) {
  const mapData = deps.getMapTokensData()['devaron-garrison'];
  const allOrigCoords = Object.values(mapData?.missionB?.positions || {}).flat().filter(Boolean).map((c) => String(c).toLowerCase());
  if (allOrigCoords.length === 0) return;
  for (const pn of [1, 2]) {
    const pid = deps.getPlayerId(game, pn);
    const controlled = allOrigCoords.filter((origCoord) => {
      const cur = String(game.cratePositions?.[origCoord] || origCoord).toLowerCase();
      return deps.getSpaceController(game, 'devaron-garrison', cur) === pn;
    });
    if (controlled.length === 0) continue;
    const rows = [];
    for (let i = 0; i < Math.min(controlled.length, 20); i += 5) {
      const chunk = controlled.slice(i, i + 5);
      rows.push(new ActionRowBuilder().addComponents(
        chunk.map((origCoord) => {
          const cur = String(game.cratePositions?.[origCoord] || origCoord).toLowerCase();
          return new ButtonBuilder()
            .setCustomId(`devaron_crate_push_${gameId}_${origCoord}`)
            .setLabel(`Push crate @ ${cur.toUpperCase()}`)
            .setStyle(ButtonStyle.Secondary);
        })
      ));
    }
    await channel.send(sanitizeMentions({
      content: `<@${pid}> — **Crate Rush (EoR)**: Push each controlled crate up to 3 spaces. Select a crate:`,
      components: rows,
      allowedMentions: { users: [pid] },
    })).catch(deps.discordCatch);
  }
}

/**
 * Post Krykna push selection buttons for Chopper Base A end-of-round push phase.
 * Shows the next player in game.pendingKryknaPushQueue buttons for each un-pushed Krykna.
 * @param {object} game
 * @param {import('discord.js').TextChannel} channel
 * @param {string} gameId
 * @param {object} deps
 */
export async function postKryknaPushButtons(game, channel, gameId, deps) {
  if (!game.pendingKryknaPushQueue || game.pendingKryknaPushQueue.length === 0) return;
  const playerNum = game.pendingKryknaPushQueue[0];
  const pid = deps.getPlayerId(game, playerNum);
  const pushedIds = new Set(game.kryknaPushedIds || []);
  const activeKrykna = (game.npcKrykna || []).filter((k) => !k.defeated && !pushedIds.has(k.id));
  if (activeKrykna.length === 0) return;
  const remaining = game.pendingKryknaPushQueue.length;
  const buttons = activeKrykna.map((k) =>
    new ButtonBuilder()
      .setCustomId(`krykna_push_${gameId}_${k.id}`)
      .setLabel(`Push ${k.id} @ ${String(k.coord).toUpperCase()}`)
      .setStyle(ButtonStyle.Danger)
  );
  const rows = chunkButtonsToRows(buttons);
  await channel.send(sanitizeMentions({
    content: `\uD83D\uDD77\uFE0F **Krykna Push Phase** (${remaining} push${remaining !== 1 ? 'es' : ''} remaining) — <@${pid}>, choose a Krykna to push up to 3 spaces (end adjacent to most figures if possible):`,
    components: rows,
    allowedMentions: { users: [pid] },
  })).catch(deps.discordCatch);
}

/**
 * Post claimed Krykna placement buttons (Place / Skip) for the current player.
 * @param {object} game
 * @param {import('discord.js').TextChannel} channel
 * @param {string} gameId
 * @param {object} deps - { getPlayerId, discordCatch }
 */
export async function postKryknaPlaceButtons(game, channel, gameId, deps) {
  if (!game.pendingClaimedKryknaQueue || game.pendingClaimedKryknaQueue.length === 0) return;
  const playerNum = game.pendingClaimedKryknaQueue[0];
  const pid = deps.getPlayerId(game, playerNum);
  const claimed = game.claimedKrykna?.[playerNum] || 0;
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`krykna_place_${gameId}`)
        .setLabel(`Place a Krykna (${claimed} claimed)`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`krykna_place_skip_${gameId}`)
        .setLabel('Skip')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
  await channel.send(sanitizeMentions({
    content: `🕷️ **Claimed Krykna Placement** — <@${pid}>, you may place 1 claimed Krykna in your opponent's deployment zone:`,
    components: rows,
    allowedMentions: { users: [pid] },
  })).catch(deps.discordCatch);
}

/**
 * Post fluctuation swap buttons for Lothal Wastes B end-of-round swap phase.
 * Shows one button per fluctuation position (that hasn't been moved this round) + Skip.
 * If game.pendingFluctuationSwapFirst is set, we're in the second-pick phase (target selection).
 * @param {object} game
 * @param {import('discord.js').TextChannel} channel - general channel
 * @param {string} gameId
 * @param {number} playerNum - whose turn to swap
 * @param {object} deps - { getPlayerId, getMapTokensData, discordCatch, getCurrentFluctuationPositions }
 */
export async function postFluctuationSwapButtons(game, channel, gameId, playerNum, deps) {
  const pid = deps.getPlayerId(game, playerNum);
  const mapId = game.selectedMap?.id;
  const positions = deps.getCurrentFluctuationPositions(game, mapId, deps.getMapTokensData);
  const allTokens = deps.getMapTokensData()[mapId]?.missionB;
  const tokenTypes = allTokens?.tokenTypes || [];
  const colorToPowerToken = { yellow: 'Surge', blue: 'Evade', green: 'Block', red: 'Damage' };
  const swappedSet = new Set(game.fluctuationSwappedThisRound || []);
  const firstPick = game.pendingFluctuationSwapFirst || null;

  // Build flat list of {coord, color, label} for all current fluctuation positions
  const allFluctuations = [];
  for (const [id, coords] of Object.entries(positions)) {
    if (!Array.isArray(coords)) continue;
    const typeInfo = tokenTypes[parseInt(id)];
    const imageMatch = (typeInfo?.image || '').match(/Neutral (\w+)\./i);
    const color = imageMatch ? imageMatch[1].toLowerCase() : 'unknown';
    for (const coord of coords) {
      if (!coord) continue;
      allFluctuations.push({ coord: String(coord).toLowerCase(), color, id });
    }
  }

  // Filter: exclude already-swapped-this-round coords
  let available = allFluctuations.filter(f => !swappedSet.has(f.coord));
  // In second-pick mode, exclude the first pick itself
  if (firstPick) {
    available = available.filter(f => f.coord !== firstPick);
  }

  if (available.length === 0 && !firstPick) {
    // No fluctuations available to swap — auto-skip
    await channel.send(sanitizeMentions({
      content: `<@${pid}> — **Fluctuations**: No swappable fluctuations remaining. Skipping.`,
      allowedMentions: { users: [pid] },
    })).catch(deps.discordCatch);
    return;
  }

  const label = firstPick
    ? `Select target fluctuation to swap with **${firstPick.toUpperCase()}** (${allFluctuations.find(f => f.coord === firstPick)?.color?.toUpperCase() || '?'}):`
    : `Select a fluctuation to swap (or Skip):`;

  const buttons = available.slice(0, 24).map(f =>
    new ButtonBuilder()
      .setCustomId(`fluctuation_swap_${gameId}_${f.coord}`)
      .setLabel(`${f.color.charAt(0).toUpperCase() + f.color.slice(1)} @ ${f.coord.toUpperCase()}`)
      .setStyle(ButtonStyle.Primary)
  );
  if (!firstPick) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`fluctuation_skip_${gameId}`)
        .setLabel('Skip Swap')
        .setStyle(ButtonStyle.Secondary)
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`fluctuation_skip_${gameId}`)
        .setLabel('Cancel (Skip)')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  const rows = chunkButtonsToRows(buttons);
  await channel.send(sanitizeMentions({
    content: `🔄 **Fluctuation Swap** — <@${pid}> (P${playerNum}), ${label}`,
    components: rows.slice(0, 5),
    allowedMentions: { users: [pid] },
  })).catch(deps.discordCatch);
}

/**
 * Find a Figurehead figure within range 4 of the target (for Figurehead ability).
 * @param {object} game
 * @param {number} defenderPlayerNum
 * @param {string} targetFigureKey
 * @param {object} deps
 * @returns {{ figureKey: string, msgId: string, figIndex: number, label: string }|null}
 */
export function findFigureheadFigure(game, defenderPlayerNum, targetFigureKey, deps) {
  if (!game.selectedMap?.id) return null;
  const targetPos = game.figurePositions?.[defenderPlayerNum]?.[targetFigureKey];
  if (!targetPos) return null;
  const dcList = deps.getDcList(game, defenderPlayerNum);
  if (!dcList) return null;
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    if (!dc) continue;
    const dcName = dc.dcName;
    const eff = deps.getDcEffect(dcName);
    if (!(eff?.specialAbilityIds || []).includes('figurehead')) continue;
    const figures = game.figurePositions?.[defenderPlayerNum] || {};
    for (const [fk, pos] of Object.entries(figures)) {
      if (fk === targetFigureKey) continue;
      if (deps.dcNameFromFigureKey(fk) !== dcName) continue;
      if (!deps.isWithinN(pos, targetPos, 4, game.selectedMap.id)) continue;
      const msgId = deps.findDcMessageIdForFigure(game.gameId, defenderPlayerNum, fk);
      const { figureIndex: figIndex } = deps.parseFigureKey(fk);
      return { figureKey: fk, msgId, figIndex, label: dc.displayName || dcName };
    }
  }
  return null;
}

/**
 * Send deck-illegal alert with PLAY IT ANYWAY / REDO buttons to the hand channel.
 * @param {object} game
 * @param {boolean} isP1
 * @param {object} squad
 * @param {object} validation
 * @param {object} client - Discord client
 * @param {object} deps
 */
export async function sendDeckIllegalAlert(game, isP1, squad, validation, client, deps) {
  const gameId = game.gameId;
  const playerNum = isP1 ? 1 : 2;
  const playerId = isP1 ? game.player1Id : game.player2Id;
  const key = `${gameId}_${playerNum}`;
  deps.pendingIllegalSquad.set(key, { squad, timestamp: Date.now() });
  const handChannelId = isP1 ? game.p1HandId : game.p2HandId;
  const handChannel = await fetchGameChannel(client, handChannelId);
  const errorList = validation.errors.map((e) => `\u2022 ${e}`).join('\n');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(deps.getDeckIllegalPlayCustomId(gameId, playerNum))
      .setLabel('PLAY IT ANYWAY')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(deps.getDeckIllegalRedoCustomId(gameId, playerNum))
      .setLabel('REDO')
      .setStyle(ButtonStyle.Danger)
  );
  await handChannel.send(sanitizeMentions({
    content: `<@${playerId}> — Your deck is **not legal**.\n\n${errorList}\n\nChoose an option below:`,
    components: [row],
    allowedMentions: { users: [playerId] },
  }));
}

/**
 * Send squad confirmation message with Confirm/Cancel buttons to the hand channel.
 * @param {object} game
 * @param {boolean} isP1
 * @param {object} squad
 * @param {object} validation
 * @param {object} client - Discord client
 * @param {object} deps
 */
export async function sendSquadConfirmation(game, isP1, squad, validation, client, deps) {
  const gameId = game.gameId;
  const playerNum = isP1 ? 1 : 2;
  const playerId = isP1 ? game.player1Id : game.player2Id;
  const key = `${gameId}_${playerNum}`;
  deps.pendingSquadConfirm.set(key, { squad, validation, timestamp: Date.now() });
  const handChannelId = isP1 ? game.p1HandId : game.p2HandId;
  const handChannel = await fetchGameChannel(client, handChannelId);
  const text = deps.buildSquadConfirmText(squad, validation);

  // Look up existing favorite if DB is available
  let existingFavorite = null;
  if (isFavoritesAvailable()) {
    const deckHash = computeDeckHash(squad);
    existingFavorite = await getFavoriteDeckByHash(playerId, deckHash);
  }

  const row = buildFavoriteConfirmButtons(gameId, playerNum, existingFavorite);
  const content = buildFavoriteConfirmContent(text, existingFavorite);

  await handChannel.send(sanitizeMentions({
    content,
    components: [row],
    allowedMentions: { users: [playerId] },
  }));
}

/**
 * Send round activation phase message to general channel.
 * @param {object} game
 * @param {object} client - Discord client
 * @param {object} deps
 */
export async function sendRoundActivationPhaseMessage(game, client, deps) {
  const gameId = game.gameId;
  const generalChannel = await fetchGameChannel(client, game.generalId);
  const round = game.currentRound || 1;
  const roundEmbed = new EmbedBuilder()
    .setTitle(`${deps.GAME_PHASES.ROUND.emoji}  ROUND ${round} - Start of Round`)
    .setColor(deps.PHASE_COLOR);
  const showBtn = deps.shouldShowEndActivationPhaseButton(game, gameId);
  const components = [];
  if (showBtn) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${game.currentRound || 1} Activation Phase`)
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  const initRem = game.initiativePlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const otherRem = game.initiativePlayerId === game.player1Id ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
  if (otherRem > initRem && initRem > 0) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pass_activation_turn_${gameId}`)
        .setLabel(`Pass (opponent has ${otherRem - initRem} more activation${otherRem - initRem !== 1 ? 's' : ''} than you)`)
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  const initPlayerNum = deps.getInitiativePlayerNum(game);
  const initZone = deps.getInitiativePlayerZoneLabel(game);
  const passHint = otherRem > initRem && initRem > 0 ? ' You may pass back (opponent has more activations).' : '';
  const content = showBtn
    ? `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Your turn! All deployment groups readied. Both players: click **End R${round} Activation Phase** when you've used all activations and any end-of-activation effects.${passHint}`
    : `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Your turn! All deployment groups readied. Use all activations and actions. The **End R${round} Activation Phase** button will appear when both players have done so.${passHint}`;
  const sent = await generalChannel.send(sanitizeMentions({
    content,
    embeds: [roundEmbed],
    components,
    allowedMentions: { users: [game.initiativePlayerId] },
  }));
  game.roundActivationMessageId = sent.id;
  game.roundActivationButtonShown = showBtn;
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  // Pure-state flag for restart-strand recovery: once this function has posted
  // the round activation message, the safety net in refreshAllGameComponents
  // and finishPostDeploy must not re-post it. Monotonically true after first set.
  game.activationPhaseMessagePosted = true;
  await deps.updateHandChannelMessages(game, client);
}
