/**
 * Interact handlers: interact_cancel_, interact_choice_
 */
import { getPlayerId, getDcList, getDcMessageIds } from '../game/player-helpers.js';
import { isDcCompanion } from '../data-loader.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';

const FIGURE_LETTERS = 'abcdefghij';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta
 */
export async function handleInteractCancel(interaction, ctx) {
  const { getGame, dcMessageMeta } = ctx;
  const match = interaction.customId.match(/^interact_cancel_([^_]+)_(.+)_(\d+)$/);
  if (!match) return;
  const [, gameId, msgId, figureIdxStr] = match;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta || meta.gameId !== gameId) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, getLegalInteractOptions, getDcStats, updateDcActionsMessage, logGameAction, saveGames, pushUndo
 */
export async function handleInteractChoice(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    getLegalInteractOptions,
    getDcStats,
    updateDcActionsMessage,
    logGameAction,
    saveGames,
    pushUndo,
  } = ctx;
  const match = interaction.customId.match(/^interact_choice_([^_]+)_(.+)_(\d+)_(.+)$/);
  if (!match) return;
  const [, gameId, msgId, figureIdxStr, optionId] = match;
  const figureIndex = parseInt(figureIdxStr, 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta || meta.gameId !== gameId) {
    await interaction.followUp({ content: 'Invalid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner can perform this action.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // G48: Companion figures cannot interact (includes retrieve)
  if (isDcCompanion(meta.dcName)) {
    await interaction.followUp({ content: 'Companion figures cannot interact.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const actionsData = game.dcActionsData?.[msgId];
  const previousRemaining = actionsData?.remaining ?? 2;
  if (previousRemaining <= 0) {
    await interaction.followUp({ content: 'No actions remaining this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const playerNum = meta.playerNum;
  const mapId = game.selectedMap?.id;
  const options = mapId ? getLegalInteractOptions(game, playerNum, figureKey, mapId) : [];
  const opt = options.find((o) => o.id === optionId);
  if (!opt) {
    await interaction.followUp({ content: 'That interact is no longer valid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // F14: Snapshot state before mutate for undo
  const previousContraband = optionId === 'retrieve_contraband' ? game.figureContraband?.[figureKey] : undefined;
  // RTK-002: snapshot dropped-contraband list so undo can restore a dropped-space pickup
  const previousDroppedContrabandSpaces = optionId === 'retrieve_contraband' && game.droppedContrabandSpaces
    ? game.droppedContrabandSpaces.slice()
    : undefined;
  let previousLaunchPanelState;
  let previousOpenedDoors;
  let previousP1LaunchFlipped;
  let previousP2LaunchFlipped;
  if (optionId.startsWith('launch_panel_')) {
    const coord = optionId.replace('launch_panel_', '').split('_')[0]?.toLowerCase();
    previousLaunchPanelState = coord != null && game.launchPanelState ? game.launchPanelState[coord] : undefined;
    previousP1LaunchFlipped = game.p1LaunchPanelFlippedThisRound;
    previousP2LaunchFlipped = game.p2LaunchPanelFlippedThisRound;
  }
  if (optionId.startsWith('open_door_')) {
    previousOpenedDoors = game.openedDoors ? game.openedDoors.slice() : [];
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  actionsData.remaining = Math.max(0, previousRemaining - 1);
  await updateDcActionsMessage(game, msgId, interaction.client);

  const stats = getDcStats(meta.dcName);
  const displayName = meta.displayName || meta.dcName;
  const shortName = (displayName || meta.dcName || '').replace(/\s*\[(?:DG|Group) \d+\]$/, '') || displayName;
  const figLabel = (stats.figures ?? 1) > 1 ? `${shortName} ${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : shortName;
  const pLabel = `P${playerNum}`;

  const tokenLabel = typeof ctx.getMissionTokenLabel === 'function' ? ctx.getMissionTokenLabel(game) : 'Mission Token';

  let logMsg = null;
  if (optionId === 'retrieve_contraband') {
    game.figureContraband = game.figureContraband || {};
    game.figureContraband[figureKey] = true;
    // RTK-002: if picking up a dropped-on-defeat token, consume one dropped-space entry
    // that the figure is adjacent to / on. Static spawn-coord tokens are unaffected.
    if (game.droppedContrabandSpaces?.length) {
      const { getFigureAdjacentCoordsFromSet } = await import('../game/board-helpers.js');
      const { toLowerSet } = await import('../game/coords.js');
      const droppedSet = toLowerSet(game.droppedContrabandSpaces);
      const hits = getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, droppedSet);
      if (hits.length) {
        const consumed = String(hits[0]).toLowerCase();
        const idx = game.droppedContrabandSpaces.indexOf(consumed);
        if (idx >= 0) game.droppedContrabandSpaces.splice(idx, 1);
      }
    }
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** retrieved **${tokenLabel}**!`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId.startsWith('launch_panel_')) {
    const parts = optionId.replace('launch_panel_', '').split('_');
    const coord = parts[0];
    const side = parts[1];
    game.launchPanelState = game.launchPanelState || {};
    game.launchPanelState[coord.toLowerCase()] = side;
    if (playerNum === 1) game.p1LaunchPanelFlippedThisRound = true;
    else game.p2LaunchPanelFlippedThisRound = true;
    const upper = String(coord).toUpperCase();
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** flipped **${tokenLabel}** (${upper}) to **${side}**.`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId === 'use_terminal') {
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** used terminal.`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId.startsWith('open_door_')) {
    // Door ID may contain multiple comma-separated edge keys for multi-space doors
    const edgeKeys = optionId.replace('open_door_', '').split(',');
    game.openedDoors = game.openedDoors || [];
    for (const ek of edgeKeys) {
      if (!game.openedDoors.includes(ek)) game.openedDoors.push(ek);
    }
    const doorLabel = edgeKeys[0].split('|').map((s) => s.toUpperCase()).join('–');
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** opened door (${doorLabel}).`, { phase: 'ROUND', icon: 'deploy' });
  } else {
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** — ${opt.label}.`, { phase: 'ROUND', icon: 'deploy' });
  }

  if (pushUndo) {
    pushUndo(game, {
      type: 'interact',
      gameId: game.gameId,
      msgId,
      figureIndex,
      optionId,
      figureKey,
      previousRemaining,
      previousContraband,
      previousDroppedContrabandSpaces,
      previousLaunchPanelState,
      previousOpenedDoors,
      previousP1LaunchFlipped,
      previousP2LaunchFlipped,
      launchPanelCoord: optionId.startsWith('launch_panel_') ? optionId.replace('launch_panel_', '').split('_')[0]?.toLowerCase() : undefined,
      openDoorEdgeKey: optionId.startsWith('open_door_') ? optionId.replace('open_door_', '') : undefined,
      gameLogMessageId: logMsg?.id,
    });
  }
  // Bleeding: trigger after Interact action resolves
  if ((game.figureConditions?.[figureKey] || []).includes('Bleed') && ctx.sendBleedingPrompt) {
    await ctx.sendBleedingPrompt(game, interaction.channel, figureKey, playerNum, displayName);
  }
  // Curious (Loth-cat E/R): after interact, suffer 1 Strain (= 1 HP damage)
  if (ctx.getDcEffects) {
    const _curEff = ctx.getDcEffects()?.[meta.dcName];
    if ((_curEff?.passives || []).includes('Curious')) {
      const _curMsgId = msgId;
      const _curHS = ctx.dcHealthState?.get(_curMsgId);
      if (_curHS?.[figureIndex]) {
        const [_curCur, _curMax] = _curHS[figureIndex];
        const _curNew = Math.max(0, (_curCur || 0) - 1);
        _curHS[figureIndex] = [_curNew, _curMax || _curCur];
        ctx.dcHealthState?.set(_curMsgId, _curHS);
        const dcList = getDcList(game, playerNum);
        const dcIds = getDcMessageIds(game, playerNum) || [];
        const _curIdx = dcIds.indexOf(_curMsgId);
        if (_curIdx >= 0 && dcList?.[_curIdx]) dcList[_curIdx].healthState = [..._curHS];
        await logGameAction(game, interaction.client, `😿 **Curious** — **${shortName}** suffers 1 Strain after interacting.`, { phase: 'ROUND', icon: 'activate' });
      }
    }
  }
  saveGames(game.gameId);
}
