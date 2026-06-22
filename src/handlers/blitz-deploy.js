/**
 * Blitz deployment handlers — Lothal-Wastes-A special deployment flow.
 *
 * Blitz rules (from mission card):
 * "Players do not deploy normally. Instead, players alternate deploying groups,
 *  following the rules for passing. When a figure is deployed, it may move up
 *  to 8 spaces."
 *
 * State machine: group_select → figure_place → movement → (next turn or done)
 *
 * Each figure gets 8 MP of standard movement (terrain costs, blocking apply)
 * after being placed. Passing follows standard IA rules: both consecutive
 * passes end deployment.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { buildRowPickerButtons, cleanupSpacePick, chunkButtonsToRows } from '../discord/components.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';
import {
  getPlayerId, getHandChannelId, getInitiativePlayerNum,
  opponentPlayerNum, getSquad,
  deployMetadataKey, deployLabelsKey,
} from '../game/player-helpers.js';
import { getDcStats } from '../data-loader.js';
import {
  getBoardStateForMovement, getMovementProfile, computeMovementCache,
} from '../game/movement.js';
import { normalizeCoord } from '../game/coords.js';

const BLITZ_MP = 8;

// ── Detection ──────────────────────────────────────────────────────────────

export function isBlitzMission(game) {
  return game.selectedMission?.name === 'Blitz';
}

// ── State initialization ───────────────────────────────────────────────────

export function initBlitzDeployment(game) {
  const initiativePlayerNum = getInitiativePlayerNum(game);
  game.blitzDeployment = {
    phase: 'group_select',
    currentPlayerNum: initiativePlayerNum,
    consecutivePasses: 0,
    deployedGroups: { 1: [], 2: [] },
    activeGroup: null,
    pendingMovement: null,
    uiMessageIds: { 1: [], 2: [] },
  };
}

// ── Deploy label helpers ───────────────────────────────────────────────────

/**
 * Ensure deploy labels/metadata exist for a player. Normally computed during
 * _sendInitiativeDeployButtons, but Blitz needs them for both players upfront.
 */
function ensureDeployLabels(game, playerNum, ctx) {
  if (game[deployLabelsKey(playerNum)]) return;
  const squad = getSquad(game, playerNum);
  const dcList = squad?.dcList || [];
  const { labels, metadata } = ctx.getDeployFigureLabels(dcList, game);
  game[deployLabelsKey(playerNum)] = labels;
  game[deployMetadataKey(playerNum)] = metadata;
}

// ── Group utilities ────────────────────────────────────────────────────────

/** Get deployment groups for a player from stored deploy metadata. */
function getDeployGroups(game, playerNum) {
  const metadata = game[deployMetadataKey(playerNum)] || [];
  const labels = game[deployLabelsKey(playerNum)] || [];
  const groups = [];
  const seen = new Map();

  for (let i = 0; i < metadata.length; i++) {
    const meta = metadata[i];
    const key = `${meta.dcName}|${meta.dgIndex}`;
    if (!seen.has(key)) {
      seen.set(key, groups.length);
      const stats = getDcStats(meta.dcName);
      groups.push({
        dcName: meta.dcName,
        dgIndex: meta.dgIndex,
        figures: stats?.figures ?? 1,
        flatIndices: [i],
        figureKeys: [`${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`],
      });
    } else {
      const gi = seen.get(key);
      groups[gi].flatIndices.push(i);
      groups[gi].figureKeys.push(`${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`);
    }
  }
  return groups;
}

/** Check if a group's figures all have positions. */
function isGroupFullyDeployed(game, playerNum, group) {
  const pos = game.figurePositions?.[playerNum] || {};
  return group.figureKeys.every(fk => pos[fk]);
}

/** Get groups that haven't been fully placed yet. */
function getUndeployedGroups(game, playerNum) {
  return getDeployGroups(game, playerNum).filter(
    g => !isGroupFullyDeployed(game, playerNum, g)
  );
}

// ── UI cleanup ─────────────────────────────────────────────────────────────

async function cleanupBlitzMessages(game, playerNum, client) {
  const ids = game.blitzDeployment?.uiMessageIds?.[playerNum] || [];
  if (ids.length === 0) return;
  const handId = getHandChannelId(game, playerNum);
  try {
    const ch = await fetchGameChannel(client, handId);
    for (const msgId of ids) {
      try { await (await ch.messages.fetch(msgId)).delete(); } catch {}
    }
  } catch {}
  if (game.blitzDeployment?.uiMessageIds) {
    game.blitzDeployment.uiMessageIds[playerNum] = [];
  }
}

// ── UI: Group selection prompt ─────────────────────────────────────────────

export async function sendBlitzTurnPrompt(game, playerNum, ctx) {
  const { client, saveGames, logGameAction } = ctx;
  const gameId = game.gameId;

  ensureDeployLabels(game, playerNum, ctx);
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };

  const handId = getHandChannelId(game, playerNum);
  const handChannel = await fetchGameChannel(client, handId);
  const playerId = getPlayerId(game, playerNum);

  await cleanupBlitzMessages(game, playerNum, client);

  const undeployed = getUndeployedGroups(game, playerNum);

  // If no groups to deploy, auto-pass
  if (undeployed.length === 0) {
    await handleAutoPass(game, playerNum, ctx);
    return;
  }

  // Build group buttons (index into ALL groups for this player, not just undeployed)
  const allGroups = getDeployGroups(game, playerNum);
  const groupBtns = [];
  for (const g of undeployed) {
    const groupIndex = allGroups.findIndex(
      ag => ag.dcName === g.dcName && ag.dgIndex === g.dgIndex
    );
    const label = g.figures > 1
      ? `Deploy ${g.dcName} (${g.figures} figures)`
      : `Deploy ${g.dcName}`;
    groupBtns.push(
      new ButtonBuilder()
        .setCustomId(`blitz_group_${gameId}_${playerNum}_${groupIndex}`)
        .setLabel(label.slice(0, 80))
        .setStyle(ButtonStyle.Success)
    );
  }

  // Chunk group buttons 5-per-row, capping item rows at 4 so the Pass row
  // (added as its own final row below) is never dropped (4 item rows + 1 = 5).
  const itemRows = chunkButtonsToRows(groupBtns).slice(0, 4);

  // Pass button — kept in its own final row so it is always rendered.
  const passRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`blitz_pass_${gameId}_${playerNum}`)
      .setLabel('Pass (do not deploy)')
      .setStyle(ButtonStyle.Secondary)
  );

  const deployed = allGroups.length - undeployed.length;
  const msg = await handChannel.send({
    content: `<@${playerId}> **Blitz Deployment** — Your turn. Choose a group to deploy (${deployed}/${allGroups.length} deployed).`,
    components: [...itemRows, passRow],
    allowedMentions: { users: [playerId] },
  });

  game.blitzDeployment.uiMessageIds[playerNum] = [msg.id];
  game.blitzDeployment.phase = 'group_select';
  if (saveGames) saveGames(game.gameId);
}

// ── UI: Group figure deploy buttons ────────────────────────────────────────

async function sendBlitzGroupDeployButtons(game, playerNum, ctx) {
  const { client, getDeploymentMapAttachment } = ctx;
  const gameId = game.gameId;
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await fetchGameChannel(client, handId);
  const playerId = getPlayerId(game, playerNum);

  const initiativePlayerNum = getInitiativePlayerNum(game);
  const zone = playerNum === initiativePlayerNum
    ? game.deploymentZoneChosen
    : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;

  const group = game.blitzDeployment.activeGroup;
  const labels = game[deployLabelsKey(playerNum)] || [];
  const positions = game.figurePositions?.[playerNum] || {};

  await cleanupBlitzMessages(game, playerNum, client);

  const deployRows = [];
  for (let idx = 0; idx < group.flatIndices.length; idx++) {
    const flatIndex = group.flatIndices[idx];
    const fk = group.figureKeys[idx];
    const label = labels[flatIndex] || `Deploy figure ${idx}`;
    const space = positions[fk];
    const displaySpace = space ? space.toUpperCase() : '';
    const btnLabel = space
      ? `${label} (at ${displaySpace})`.slice(0, 80)
      : label.slice(0, 80);
    deployRows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`deployment_fig_${gameId}_${playerNum}_${flatIndex}`)
          .setLabel(btnLabel)
          .setStyle(space ? ButtonStyle.Secondary : zoneStyle)
          .setDisabled(!!space)
      )
    );
  }

  const mapAttachment = await getDeploymentMapAttachment(game, zone);
  const payload = {
    content: `<@${playerId}> Deploy **${group.dcName}** — place each figure in the **${zone}** zone:`,
    components: deployRows.slice(0, 5),
    allowedMentions: { users: [playerId] },
  };
  if (mapAttachment) payload.files = [mapAttachment];

  const msg = await handChannel.send(payload);
  game.blitzDeployment.uiMessageIds[playerNum] = [msg.id];
}

// ── UI: Post-deploy movement prompt ────────────────────────────────────────

async function sendBlitzMovementPrompt(game, playerNum, ctx) {
  const { client } = ctx;
  const gameId = game.gameId;
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await fetchGameChannel(client, handId);
  const playerId = getPlayerId(game, playerNum);

  const pending = game.blitzDeployment.pendingMovement;
  const remaining = pending.figureKeys.filter(fk => !pending.movedKeys.includes(fk));

  if (remaining.length === 0) {
    await advanceBlitzTurn(game, ctx);
    return;
  }

  await cleanupBlitzMessages(game, playerNum, client);

  const rows = [];
  for (let i = 0; i < pending.figureKeys.length; i++) {
    const fk = pending.figureKeys[i];
    if (pending.movedKeys.includes(fk)) continue;
    const dcName = fk.replace(/-\d+-\d+$/, '');
    const pos = game.figurePositions?.[playerNum]?.[fk] || '?';
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`blitz_move_fig_${gameId}_${i}`)
          .setLabel(`Move ${dcName} (at ${pos.toUpperCase()}) — ${BLITZ_MP} MP`.slice(0, 80))
          .setStyle(ButtonStyle.Primary)
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`blitz_move_done_${gameId}`)
        .setLabel('Skip Remaining Movement')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const msg = await handChannel.send({
    content: `<@${playerId}> **Blitz Movement** — Each deployed figure may move up to **${BLITZ_MP} spaces**. Select a figure to move, or skip.`,
    components: rows.slice(0, 5),
    allowedMentions: { users: [playerId] },
  });

  game.blitzDeployment.uiMessageIds[playerNum] = [msg.id];
}

// ── Handler: Group select ──────────────────────────────────────────────────

export async function handleBlitzGroupSelect(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;

  const m = interaction.customId.match(/^blitz_group_(\w+)_(\d+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, playerNumStr, groupIndexStr] = m;
  const playerNum = parseInt(playerNumStr, 10);
  const groupIndex = parseInt(groupIndexStr, 10);

  const game = await requireGame(interaction, getGame, gameId);
  if (!game?.blitzDeployment) return;

  if (game.blitzDeployment.currentPlayerNum !== playerNum) {
    await interaction.followUp({ content: "It's not your turn to deploy.", ephemeral: true }).catch(discordCatch);
    return;
  }
  if (interaction.user.id !== getPlayerId(game, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can deploy.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const groups = getDeployGroups(game, playerNum);
  const group = groups[groupIndex];
  if (!group) {
    await interaction.followUp({ content: 'Group not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (isGroupFullyDeployed(game, playerNum, group)) {
    await interaction.followUp({ content: 'This group is already deployed.', ephemeral: true }).catch(discordCatch);
    return;
  }

  game.blitzDeployment.activeGroup = {
    dcName: group.dcName,
    dgIndex: group.dgIndex,
    figures: group.figures,
    figureKeys: [...group.figureKeys],
    flatIndices: [...group.flatIndices],
  };
  game.blitzDeployment.phase = 'figure_place';

  await cleanupBlitzMessages(game, playerNum, client);
  await logGameAction(game, client, `<@${interaction.user.id}> selected **${group.dcName}** to deploy (Blitz)`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
  await sendBlitzGroupDeployButtons(game, playerNum, ctx);
  saveGames(game.gameId);
}

// ── Handler: Pass ──────────────────────────────────────────────────────────

export async function handleBlitzPass(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;

  const m = interaction.customId.match(/^blitz_pass_(\w+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, playerNumStr] = m;
  const playerNum = parseInt(playerNumStr, 10);

  const game = await requireGame(interaction, getGame, gameId);
  if (!game?.blitzDeployment) return;

  if (game.blitzDeployment.currentPlayerNum !== playerNum) {
    await interaction.followUp({ content: "It's not your turn.", ephemeral: true }).catch(discordCatch);
    return;
  }
  if (interaction.user.id !== getPlayerId(game, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can pass.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await cleanupBlitzMessages(game, playerNum, client);
  await logGameAction(game, client, `<@${interaction.user.id}> passed (Blitz deployment)`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });

  game.blitzDeployment.consecutivePasses++;

  if (game.blitzDeployment.consecutivePasses >= 2) {
    await endBlitzDeployment(game, ctx);
  } else {
    // Switch to other player
    const nextPlayerNum = opponentPlayerNum(playerNum);
    game.blitzDeployment.currentPlayerNum = nextPlayerNum;
    await sendBlitzTurnPrompt(game, nextPlayerNum, ctx);
  }
  saveGames(game.gameId);
}

/** Auto-pass when a player has no undeployed groups. */
async function handleAutoPass(game, playerNum, ctx) {
  const { client, logGameAction, saveGames } = ctx;

  await logGameAction(game, client, `Player ${playerNum} auto-passed (no groups left to deploy, Blitz)`, { phase: 'DEPLOYMENT', icon: 'deploy' });

  game.blitzDeployment.consecutivePasses++;

  if (game.blitzDeployment.consecutivePasses >= 2) {
    await endBlitzDeployment(game, ctx);
  } else {
    const nextPlayerNum = opponentPlayerNum(playerNum);
    game.blitzDeployment.currentPlayerNum = nextPlayerNum;
    await sendBlitzTurnPrompt(game, nextPlayerNum, ctx);
  }
  if (saveGames) saveGames(game.gameId);
}

// ── Handler: Move figure select ────────────────────────────────────────────

export async function handleBlitzMoveFig(interaction, ctx) {
  const { getGame, client, saveGames } = ctx;

  const m = interaction.customId.match(/^blitz_move_fig_(\w+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, figureIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);

  const game = await requireGame(interaction, getGame, gameId);
  if (!game?.blitzDeployment?.pendingMovement) {
    await interaction.followUp({ content: 'No pending Blitz movement.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const blitz = game.blitzDeployment;
  const playerNum = blitz.pendingMovement.playerNum;
  if (interaction.user.id !== getPlayerId(game, playerNum)) {
    await interaction.followUp({ content: 'Only the deploying player can move figures.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const figureKey = blitz.pendingMovement.figureKeys[figureIndex];
  if (!figureKey) {
    await interaction.followUp({ content: 'Figure not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (blitz.pendingMovement.movedKeys.includes(figureKey)) {
    await interaction.followUp({ content: 'This figure has already moved.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const startCoord = game.figurePositions?.[playerNum]?.[figureKey];
  if (!startCoord) {
    await interaction.followUp({ content: 'Figure has no position.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Compute reachable spaces (8 MP, standard movement rules)
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const board = getBoardStateForMovement(game, figureKey);
  const profile = getMovementProfile(dcName, figureKey, game);
  const cache = computeMovementCache(normalizeCoord(startCoord), BLITZ_MP, board, profile);

  const reachable = [];
  for (const [coord, info] of cache.cells) {
    reachable.push(coord);
  }

  if (reachable.length === 0) {
    await interaction.followUp({ content: `No reachable spaces for **${dcName}** (surrounded by blocking terrain or figures). Figure stays at **${startCoord.toUpperCase()}**.`, ephemeral: true }).catch(discordCatch);
    // Mark as moved (nowhere to go)
    blitz.pendingMovement.movedKeys.push(figureKey);
    await sendBlitzMovementPrompt(game, playerNum, ctx);
    saveGames(game.gameId);
    return;
  }

  // Set up generic space picker
  const contextKey = `${gameId}_blitzmv`;
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[contextKey] = {
    validSpaces: reachable,
    cellPrefix: `blitz_move_pick_${gameId}_${figureIndex}_`,
    mapSpaces: board.mapSpaces,
    headerText: `**Blitz Move** — ${dcName} from ${startCoord.toUpperCase()} (${BLITZ_MP} MP)`,
    actionButtons: [
      { customId: `blitz_move_done_${gameId}`, label: 'Skip Remaining Movement', style: ButtonStyle.Secondary },
    ],
  };

  const { rows: rowBtns } = buildRowPickerButtons(reachable, `space_row_${contextKey}_`);

  await cleanupBlitzMessages(game, playerNum, client);

  const handId = getHandChannelId(game, playerNum);
  const handChannel = await fetchGameChannel(client, handId);
  const skipBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`blitz_move_done_${gameId}`)
      .setLabel('Skip Remaining Movement')
      .setStyle(ButtonStyle.Secondary)
  );

  const msg = await handChannel.send({
    content: `**Blitz Move** — ${dcName} from **${startCoord.toUpperCase()}** (${BLITZ_MP} MP):\nChoose a row:`,
    components: [...rowBtns.slice(0, 4), skipBtn],
  });

  blitz.uiMessageIds[playerNum] = [msg.id];
  saveGames(game.gameId);
}

// ── Handler: Move pick (destination selected) ──────────────────────────────

export async function handleBlitzMovePick(interaction, ctx) {
  const { getGame, client, saveGames, logGameAction, buildBoardMapPayload } = ctx;

  // Parse: blitz_move_pick_{gameId}_{figureIndex}_{coord}
  const m = interaction.customId.match(/^blitz_move_pick_(\w+)_(\d+)_(.+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, figureIndexStr, coord] = m;
  const figureIndex = parseInt(figureIndexStr, 10);

  const game = await requireGame(interaction, getGame, gameId);
  if (!game?.blitzDeployment?.pendingMovement) {
    await interaction.followUp({ content: 'No pending Blitz movement.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const blitz = game.blitzDeployment;
  const playerNum = blitz.pendingMovement.playerNum;
  if (interaction.user.id !== getPlayerId(game, playerNum)) {
    await interaction.followUp({ content: 'Only the deploying player can move figures.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const figureKey = blitz.pendingMovement.figureKeys[figureIndex];
  if (!figureKey) {
    await interaction.followUp({ content: 'Figure not found.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Validate the destination is in the valid spaces
  const contextKey = `${gameId}_blitzmv`;
  const pending = game.pendingSpacePick?.[contextKey];
  const normalDest = normalizeCoord(coord);
  if (pending && !pending.validSpaces.includes(normalDest)) {
    await interaction.followUp({ content: 'Invalid destination.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Move the figure
  const oldPos = game.figurePositions[playerNum][figureKey];
  game.figurePositions[playerNum][figureKey] = normalDest;

  // Clean up space picker
  cleanupSpacePick(game, contextKey);

  // Mark as moved
  blitz.pendingMovement.movedKeys.push(figureKey);

  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  await logGameAction(game, client,
    `**${dcName}** moved from **${(oldPos || '?').toUpperCase()}** to **${normalDest.toUpperCase()}** (Blitz deployment, ${BLITZ_MP} MP)`,
    { phase: 'DEPLOYMENT', icon: 'move' });

  // Update board map
  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await fetchGameChannel(client, game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to update map after Blitz move:', err);
    }
  }

  // Continue with remaining movement or advance turn
  await sendBlitzMovementPrompt(game, playerNum, ctx);
  saveGames(game.gameId);
}

// ── Handler: Skip remaining movement ───────────────────────────────────────

export async function handleBlitzMoveDone(interaction, ctx) {
  const { getGame, client, saveGames, logGameAction } = ctx;

  const m = interaction.customId.match(/^blitz_move_done_(\w+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId] = m;

  const game = await requireGame(interaction, getGame, gameId);
  if (!game?.blitzDeployment) {
    await interaction.followUp({ content: 'No active Blitz deployment.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const blitz = game.blitzDeployment;
  // Determine which player triggered this
  const playerNum = blitz.pendingMovement?.playerNum || blitz.currentPlayerNum;
  if (interaction.user.id !== getPlayerId(game, playerNum)) {
    await interaction.followUp({ content: 'Only the deploying player can skip movement.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Clean up space picker if active
  const contextKey = `${gameId}_blitzmv`;
  cleanupSpacePick(game, contextKey);

  await cleanupBlitzMessages(game, playerNum, client);
  await logGameAction(game, client, `<@${interaction.user.id}> skipped remaining Blitz movement`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'move' });

  await advanceBlitzTurn(game, ctx);
  saveGames(game.gameId);
}

// ── Blitz group completion check (called from handleDeployPick) ────────────

export async function checkBlitzGroupComplete(game, playerNum, interaction, ctx) {
  const blitz = game.blitzDeployment;
  if (!blitz?.activeGroup) return;

  // Don't proceed if loadout/form selection is pending
  if (game.pendingLoadoutSelection?.playerNum === playerNum) return;

  const positions = game.figurePositions?.[playerNum] || {};
  const allPlaced = blitz.activeGroup.figureKeys.every(fk => positions[fk]);

  if (!allPlaced) {
    // Not all placed — refresh group deploy buttons
    await sendBlitzGroupDeployButtons(game, playerNum, ctx);
    ctx.saveGames(game.gameId);
    return;
  }

  // All placed — mark group as deployed
  blitz.deployedGroups[playerNum].push(`${blitz.activeGroup.dcName}|${blitz.activeGroup.dgIndex}`);
  blitz.consecutivePasses = 0;

  const groupDcName = blitz.activeGroup.dcName;
  const groupFigureKeys = [...blitz.activeGroup.figureKeys];

  // Transition to movement phase
  blitz.phase = 'movement';
  blitz.pendingMovement = {
    figureKeys: groupFigureKeys,
    movedKeys: [],
    playerNum,
  };
  blitz.activeGroup = null;

  await cleanupBlitzMessages(game, playerNum, ctx.client);

  await ctx.logGameAction(game, ctx.client,
    `**${groupDcName}** fully deployed (Blitz). Each figure may move up to ${BLITZ_MP} spaces.`,
    { phase: 'DEPLOYMENT', icon: 'deploy' });

  await sendBlitzMovementPrompt(game, playerNum, ctx);
  ctx.saveGames(game.gameId);
}

// ── Turn management ────────────────────────────────────────────────────────

async function advanceBlitzTurn(game, ctx) {
  const { client, logGameAction } = ctx;
  const blitz = game.blitzDeployment;

  // Clean up current player's UI
  const currentPN = blitz.currentPlayerNum;
  await cleanupBlitzMessages(game, currentPN, client);

  // Clear movement state
  blitz.pendingMovement = null;
  blitz.activeGroup = null;

  // Check if both players have deployed all groups
  const p1Undeployed = getUndeployedGroups(game, 1);
  const p2Undeployed = getUndeployedGroups(game, 2);
  if (p1Undeployed.length === 0 && p2Undeployed.length === 0) {
    await endBlitzDeployment(game, ctx);
    return;
  }

  // Switch to other player
  const nextPN = opponentPlayerNum(currentPN);
  blitz.currentPlayerNum = nextPN;
  blitz.phase = 'group_select';

  await sendBlitzTurnPrompt(game, nextPN, ctx);
}

async function endBlitzDeployment(game, ctx) {
  const { client, logGameAction, saveGames, sendPhaseGateMessages } = ctx;

  // Mark deployment as complete (for compatibility with phase gate checks)
  game.initiativePlayerDeployed = true;
  game.nonInitiativePlayerDeployed = true;

  // Clean up blitz state messages for both players
  await cleanupBlitzMessages(game, 1, client);
  await cleanupBlitzMessages(game, 2, client);

  await logGameAction(game, client, '**Blitz deployment complete.** Both players have finished deploying.', { phase: 'DEPLOYMENT', icon: 'deployed' });

  // Per user 2026-05-09: removed the deploy_done ready check —
  // proceed directly to the post-deploy step.
  const { advanceFromDeployment } = await import('./phase-gate.js');
  await advanceFromDeployment(game, ctx);
  if (saveGames) saveGames(game.gameId);
}
