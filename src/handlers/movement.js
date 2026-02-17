/**
 * Movement handlers: move_mp_, move_adjust_mp_, move_pick_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';

const BTM_PER_MSG = 5;
const SPACE_ROWS_ON_FIRST = 4;

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, getBoardStateForMovement, getMovementProfile, ensureMovementCache, getSpacesAtCost, clearMoveGridMessages, getMoveSpaceGridRows, getMovementMinimapAttachment, client
 */
export async function handleMoveMp(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    getBoardStateForMovement,
    getMovementProfile,
    ensureMovementCache,
    getSpacesAtCost,
    clearMoveGridMessages,
    getMoveSpaceGridRows,
    getMovementMinimapAttachment,
    client,
  } = ctx;
  const m = interaction.customId.match(/^move_mp_(.+)_(\d+)_(\d+)$/);
  if (!m) {
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
    return;
  }
  const [, msgId, figureIndexStr, mpStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const mp = parseInt(mpStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.reply({ content: 'DC no longer tracked.', ephemeral: true }).catch(() => {});
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.reply({ content: 'Move session expired.', ephemeral: true }).catch(() => {});
    return;
  }
  const { figureKey, playerNum, mpRemaining, displayName } = moveState;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the owner can move.', ephemeral: true }).catch(() => {});
    return;
  }
  if (mp < 1 || mp > mpRemaining) {
    await interaction.reply({ content: `Choose 1–${mpRemaining} MP.`, ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  const boardState = moveState.boardState || getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch(() => {});
    return;
  }
  const profile = moveState.movementProfile || getMovementProfile(meta.dcName, figureKey, game);
  moveState.boardState = boardState;
  moveState.movementProfile = profile;
  const startCoord = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
  if (!startCoord) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Figure position missing. Movement cancelled.', ephemeral: true }).catch(() => {});
    return;
  }
  const cache = ensureMovementCache(moveState, startCoord, mpRemaining, boardState, profile);
  const spaces = getSpacesAtCost(cache, mp);
  if (spaces.length === 0) {
    await interaction.followUp({ content: `No spaces exactly **${mp}** MP away.`, ephemeral: true }).catch(() => {});
    return;
  }
  moveState.pendingMp = mp;
  await clearMoveGridMessages(game, moveKey, interaction.channel);
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  delete game.moveGridMessageIds[moveKey];
  if (moveState.distanceMessageId && interaction.message?.id === moveState.distanceMessageId) {
    await interaction.message.edit({
      content: `**Move** — Pick a destination (**${mp}** MP) — see map and buttons below.`,
      components: [],
    }).catch(() => {});
  }
  const { rows } = getMoveSpaceGridRows(msgId, figureIndex, spaces, boardState.mapSpaces);
  const gridIds = [];
  const firstSpaceRows = rows.slice(0, SPACE_ROWS_ON_FIRST);
  const adjustRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`move_adjust_mp_${msgId}_${figureIndex}`)
      .setLabel('Adjust movement points spent')
      .setStyle(ButtonStyle.Secondary)
  );
  const firstRows = [...firstSpaceRows, adjustRow];
  const moveMinimap = await getMovementMinimapAttachment(game, msgId, figureKey, spaces);
  const gridPayload = {
    content: `**Move** — Pick destination (**${mp}** MP):`,
    components: firstRows,
    fetchReply: true,
  };
  if (moveMinimap) gridPayload.files = [moveMinimap];
  const gridMsg = await interaction.followUp(gridPayload).catch(() => null);
  if (gridMsg?.id) gridIds.push(gridMsg.id);
  for (let i = SPACE_ROWS_ON_FIRST; i < rows.length; i += BTM_PER_MSG) {
    const more = rows.slice(i, i + BTM_PER_MSG);
    if (more.length > 0) {
      const follow = await interaction.channel.send({ content: null, components: more }).catch(() => null);
      if (follow?.id) gridIds.push(follow.id);
    }
  }
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  game.moveGridMessageIds[moveKey] = gridIds;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, clearMoveGridMessages, getMoveMpButtonRows, editDistanceMessage
 */
export async function handleMoveAdjustMp(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    clearMoveGridMessages,
    getMoveMpButtonRows,
    editDistanceMessage,
  } = ctx;
  const m = interaction.customId.match(/^move_adjust_mp_(.+)_(\d+)$/);
  if (!m) {
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
    return;
  }
  const [, msgId, figureIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.reply({ content: 'DC no longer tracked.', ephemeral: true }).catch(() => {});
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.reply({ content: 'Move session expired.', ephemeral: true }).catch(() => {});
    return;
  }
  const { playerNum, mpRemaining } = moveState;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the owner can adjust.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  moveState.pendingMp = null;
  await clearMoveGridMessages(game, moveKey, interaction.channel);
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  delete game.moveGridMessageIds[moveKey];
  const mpRows = getMoveMpButtonRows(msgId, figureIndex, mpRemaining);
  await editDistanceMessage(moveState, interaction.channel, `**Move** — Pick distance (**${mpRemaining}** MP remaining):`, mpRows);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, clearMoveGridMessages, getBoardStateForMovement, getMovementProfile, ensureMovementCache, computeMovementCache, normalizeCoord, getMovementTarget, getFigureSize, getNormalizedFootprint, resolveMassivePush, updateMovementBankMessage, getMovementPath, pushUndo, logGameAction, countTerminalsControlledByPlayer, editDistanceMessage, getMoveMpButtonRows, buildBoardMapPayload, saveGames, client
 */
export async function handleMovePick(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    clearMoveGridMessages,
    getBoardStateForMovement,
    getMovementProfile,
    ensureMovementCache,
    computeMovementCache,
    normalizeCoord,
    getMovementTarget,
    getFigureSize,
    getNormalizedFootprint,
    resolveMassivePush,
    updateMovementBankMessage,
    getMovementPath,
    pushUndo,
    logGameAction,
    countTerminalsControlledByPlayer,
    editDistanceMessage,
    getMoveMpButtonRows,
    buildBoardMapPayload,
    saveGames,
    client,
  } = ctx;
  const m = interaction.customId.match(/^move_pick_(.+)_(\d+)_(.+)$/);
  if (!m) {
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
    return;
  }
  const [, msgId, figureIndexStr, space] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.reply({ content: 'DC no longer tracked.', ephemeral: true }).catch(() => {});
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.reply({ content: 'Move session expired.', ephemeral: true }).catch(() => {});
    return;
  }
  const { figureKey, playerNum, mpRemaining, displayName } = moveState;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the owner can move.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  await clearMoveGridMessages(game, moveKey, interaction.channel);
  const boardState = getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch(() => {});
    return;
  }
  const profile = getMovementProfile(meta.dcName, figureKey, game);
  const startCoord = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
  if (!startCoord) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Figure position missing. Movement cancelled.', ephemeral: true }).catch(() => {});
    return;
  }
  const cache = ensureMovementCache(moveState, startCoord, mpRemaining, boardState, profile);
  const targetLower = normalizeCoord(space);
  const targetInfo = getMovementTarget(cache, targetLower);
  if (!targetInfo) {
    await interaction.followUp({ content: 'Destination not valid for the selected MP.', ephemeral: true }).catch(() => {});
    return;
  }
  if (moveState.pendingMp && targetInfo.cost !== moveState.pendingMp) {
    await interaction.followUp({ content: 'Select a destination from the most recent distance choice.', ephemeral: true }).catch(() => {});
    return;
  }
  const cost = targetInfo.cost;
  if (cost > mpRemaining) {
    await interaction.followUp({ content: 'Not enough movement points.', ephemeral: true }).catch(() => {});
    return;
  }
  moveState.pendingMp = null;
  const mapId = game.selectedMap?.id;
  const terminalsBefore = mapId ? countTerminalsControlledByPlayer(game, playerNum, mapId) : 0;
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  const newTopLeft = targetInfo.topLeft;
  game.figurePositions[playerNum][figureKey] = newTopLeft;
  const newSize = targetInfo.size;
  const storedSize = game.figureOrientations?.[figureKey] || getFigureSize(meta.dcName);
  if (newSize !== storedSize) {
    game.figureOrientations = game.figureOrientations || {};
    game.figureOrientations[figureKey] = newSize;
  }
  const footprintSet = new Set(getNormalizedFootprint(newTopLeft, newSize));
  const updatedProfile = getMovementProfile(meta.dcName, figureKey, game);
  await resolveMassivePush(game, updatedProfile, figureKey, playerNum, footprintSet, client);
  const newMp = mpRemaining - cost;
  moveState.mpRemaining = newMp;
  moveState.startCoord = targetInfo.topLeft;
  moveState.boardState = null;
  moveState.movementCache = null;
  moveState.cacheMaxMp = 0;
  if (game.movementBank?.[msgId]) {
    game.movementBank[msgId].remaining = Math.max(0, newMp);
    await updateMovementBankMessage(game, msgId, client);
  }
  const destDisplay = space.toUpperCase();
  const shortName = (displayName || meta.displayName || '').replace(/\s*\[(?:DG|Group) \d+\]$/, '') || displayName;
  const pLabel = `P${playerNum}`;
  const path = getMovementPath(cache, startCoord, newTopLeft, newSize, profile);
  const pathStr = path.length > 1
    ? ` (path: ${path.map((c) => String(c).toUpperCase()).join(' → ')})`
    : '';
  const moveLogMsg = await logGameAction(game, client, `<@${ownerId}> moved **${displayName}** to **${destDisplay}**${pathStr}`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'move' });
  pushUndo(game, {
    type: 'move',
    gameId: game.gameId,
    playerNum,
    figureKey,
    msgId,
    figureIndex,
    previousTopLeft: startCoord,
    previousSize: storedSize,
    mpRemainingBefore: mpRemaining,
    displayName: (displayName || meta.displayName || '').replace(/\s*\[(?:DG|Group) \d+\]$/, '') || meta.dcName || figureKey,
    gameLogMessageId: moveLogMsg?.id,
  });
  const terminalsAfter = mapId ? countTerminalsControlledByPlayer(game, playerNum, mapId) : 0;
  if (terminalsAfter > terminalsBefore) {
    await logGameAction(game, client, `**${pLabel}: ${shortName}** has taken control of a terminal!`, { phase: 'ROUND', icon: 'deploy' });
  }
  if (newMp <= 0) {
    await editDistanceMessage(moveState, interaction.channel, `✓ Moved **${displayName}** to **${destDisplay}**.`, []);
    delete game.moveInProgress[moveKey];
  } else {
    const nextBoard = getBoardStateForMovement(game, figureKey);
    if (nextBoard && computeMovementCache) {
      const nextProfile = getMovementProfile(meta.dcName, figureKey, game);
      const nextCache = computeMovementCache(newTopLeft, newMp, nextBoard, nextProfile);
      moveState.boardState = nextBoard;
      moveState.movementProfile = nextProfile;
      moveState.movementCache = nextCache;
      moveState.cacheMaxMp = newMp;
    }
    const mpRows = getMoveMpButtonRows(msgId, figureIndex, newMp);
    await editDistanceMessage(moveState, interaction.channel, `**Move** — Pick distance (**${newMp}** MP remaining):`, mpRows);
    game.moveGridMessageIds = game.moveGridMessageIds || {};
    game.moveGridMessageIds[moveKey] = [];
  }
  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to update map after move:', err);
    }
  }
  saveGames();
}
