/**
 * Movement handlers: move_mp_, move_adjust_mp_, move_pick_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getDcEffects, getMapSpaces } from '../data-loader.js';
import { bottomLeftCoord, getFootprintCells } from '../game/coords.js';
import { reduceHp, dcNameFromFigureKey, getMaxPowerTokens } from '../game/index.js';
import { getDcList, getDcMessageIds, getPlayerId, opponentPlayerNum } from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { detectPostMoveInterrupts } from '../game/movement-interrupts.js';

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
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, msgId, figureIndexStr, mpStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const mp = parseInt(mpStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { figureKey, playerNum, mpRemaining, displayName } = moveState;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner can move.')) return;
  if (mp < 1 || mp > mpRemaining) {
    await interaction.followUp({ content: `Choose 1–${mpRemaining} MP.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  // Urgency: must spend all MP at once (C77)
  if (game.urgencyMustSpendAll?.[msgId] && mp < mpRemaining) {
    await interaction.followUp({ content: `**Urgency** requires you to spend all **${mpRemaining}** MP at once.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  const boardState = moveState.boardState || getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const profile = moveState.movementProfile || getMovementProfile(meta.dcName, figureKey, game);
  // Force Jump: mobileMovementActive grants MOBILE movement (pass through figures/doors)
  if (game.mobileMovementActive?.[msgId]) {
    profile.isMobile = true;
    profile.ignoreBlocking = true;
    profile.ignoreFigureCost = true;
    profile.ignoreDifficult = true;
  }
  moveState.boardState = boardState;
  moveState.movementProfile = profile;
  const startCoord = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
  if (!startCoord) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Figure position missing. Movement cancelled.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const cache = ensureMovementCache(moveState, startCoord, mpRemaining, boardState, profile);
  const spaces = getSpacesAtCost(cache, mp);
  if (spaces.length === 0) {
    const validCosts = [...new Set([...cache.cells.values()].map((c) => c.cost))].filter((c) => c > 0 && c <= mpRemaining).sort((a, b) => a - b);
    const altText = validCosts.length > 0 ? ` Reachable: ${validCosts.join(', ')} MP.` : '';
    await interaction.followUp({ content: `No spaces exactly **${mp}** MP away.${altText}`, ephemeral: true }).catch(discordCatch);
    return;
  }
  // cache.cells now only stores topLeft cells, so spaces is already topLeft-only.
  const isMultiTile = profile.size && profile.size !== '1x1';
  const buttonSpaces = spaces;
  moveState.pendingMp = mp;
  await clearMoveGridMessages(game, moveKey, interaction.channel);
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  delete game.moveGridMessageIds[moveKey];
  if (moveState.distanceMessageId && interaction.message?.id === moveState.distanceMessageId) {
    await interaction.message.edit({
      content: `**Move** — Pick a destination (**${mp}** MP) — see map and buttons below.`,
      components: [],
    }).catch(discordCatch);
  }
  const { rows } = getMoveSpaceGridRows(msgId, figureIndex, buttonSpaces, boardState.mapSpaces, profile.size);
  const gridIds = [];
  const firstSpaceRows = rows.slice(0, SPACE_ROWS_ON_FIRST);
  const adjustRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`move_adjust_mp_${msgId}_${figureIndex}`)
      .setLabel('Adjust movement points spent')
      .setStyle(ButtonStyle.Secondary)
  );
  const firstRows = [...firstSpaceRows, adjustRow];
  const minimapCells = isMultiTile
    ? buttonSpaces.map((tl) => bottomLeftCoord(tl, profile.size))
    : spaces;
  const moveMinimap = await getMovementMinimapAttachment(game, msgId, figureKey, minimapCells);
  const multiTileNote = isMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';
  const gridPayload = {
    content: `**Move** — Pick destination (**${mp}** MP):${multiTileNote}`,
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
 * @param {object} ctx - getGame, dcMessageMeta, clearMoveGridMessages, getMoveMpButtonRows
 */
export async function handleMoveAdjustMp(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    clearMoveGridMessages,
    getMoveMpButtonRows,
  } = ctx;
  const m = interaction.customId.match(/^move_adjust_mp_(.+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, msgId, figureIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, mpRemaining } = moveState;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner can adjust.')) return;
  // Remove the clicked message from gridIds before clearing so we can transform it in-place
  const currentMsgId = interaction.message.id;
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  game.moveGridMessageIds[moveKey] = (game.moveGridMessageIds[moveKey] || []).filter((id) => id !== currentMsgId);
  moveState.pendingMp = null;
  await clearMoveGridMessages(game, moveKey, interaction.channel);
  game.moveGridMessageIds[moveKey] = [];
  const mpRows = getMoveMpButtonRows(msgId, figureIndex, mpRemaining);
  // Transform the clicked message (space grid or "Pick Path Manually" standalone) into the MP picker
  try {
    await interaction.message.edit({
      content: `**Move** — Pick distance (**${mpRemaining}** MP remaining):`,
      components: mpRows.length > 0 ? mpRows : [],
      files: [],
      attachments: [], // clear old minimap image
    });
    moveState.distanceMessageId = currentMsgId;
  } catch {
    // Fallback: send a new message if the original was somehow already gone
    const newMsg = await interaction.channel.send({
      content: `**Move** — Pick distance (**${mpRemaining}** MP remaining):`,
      components: mpRows.length > 0 ? mpRows : [],
    }).catch(() => null);
    if (newMsg?.id) moveState.distanceMessageId = newMsg.id;
  }
}

/**
 * Handles move_letter_ buttons: player picks a column letter, shows cells in that column.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, clearMoveGridMessages, getMoveSpaceGridRows, buildLetterRows
 */
export async function handleMoveLetter(interaction, ctx) {
  const m = interaction.customId.match(/^move_letter_(.+)_(\d+)_([a-z]+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, msgId, figureIndexStr, letter] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const { getGame, dcMessageMeta, clearMoveGridMessages, getMoveSpaceGridRows, buildLetterRows } = ctx;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, moveState.playerNum, canActAsPlayer, 'Only the owner can move.')) return;
  const { movementCache: cache, movementProfile: profile, boardState } = moveState;
  if (!cache) {
    await interaction.followUp({ content: 'Move cache expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Remove the current message from gridIds so clearMoveGridMessages won't delete it
  const currentMsgId = interaction.message.id;
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  game.moveGridMessageIds[moveKey] = (game.moveGridMessageIds[moveKey] || []).filter((id) => id !== currentMsgId);
  await clearMoveGridMessages(game, moveKey, interaction.channel);
  game.moveGridMessageIds[moveKey] = [];
  // cache.cells only stores topLeft cells — no filtering needed.
  const isMultiTile = profile.size && profile.size !== '1x1';
  const allCells = [...cache.cells.keys()];
  const letterCells = allCells.filter((c) => (c.match(/^([a-z]+)/)?.[1] ?? c[0]) === letter);
  const { rows: cellRows } = getMoveSpaceGridRows(msgId, figureIndex, letterCells, boardState.mapSpaces, profile.size);
  const multiTileNote = isMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`move_back_letters_${msgId}_${figureIndex}`)
      .setLabel('⬅️ Choose Column')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`move_adjust_mp_${msgId}_${figureIndex}`)
      .setLabel('🗺️ Pick Path Manually')
      .setStyle(ButtonStyle.Secondary)
  );
  const firstRows = [...cellRows.slice(0, 4), actionRow];
  try {
    await interaction.message.edit({
      content: `**Move** — Column **${letter.toUpperCase()}** (${letterCells.length} space${letterCells.length !== 1 ? 's' : ''}):${multiTileNote}`,
      components: firstRows,
      files: [],
      attachments: [], // clear minimap image from previous step
    });
  } catch { /* ignore */ }
  // Send overflow messages if the column has more than 20 cells
  const newGridIds = [];
  for (let i = 4; i < cellRows.length; i += 5) {
    const more = cellRows.slice(i, i + 5);
    if (more.length > 0) {
      const follow = await interaction.channel.send({ content: null, components: more }).catch(() => null);
      if (follow?.id) newGridIds.push(follow.id);
    }
  }
  game.moveGridMessageIds[moveKey] = newGridIds;
}

/**
 * Handles move_back_letters_ buttons: returns to the column letter picker.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, clearMoveGridMessages, buildLetterRows
 */
export async function handleMoveLetterBack(interaction, ctx) {
  const m = interaction.customId.match(/^move_back_letters_(.+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, msgId, figureIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const { getGame, dcMessageMeta, clearMoveGridMessages, buildLetterRows } = ctx;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, moveState.playerNum, canActAsPlayer, 'Only the owner can move.')) return;
  const { movementCache: cache, movementProfile: profile, mpRemaining } = moveState;
  if (!cache) {
    await interaction.followUp({ content: 'Move cache expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Remove the current message from gridIds so clearMoveGridMessages won't delete it
  const currentMsgId = interaction.message.id;
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  game.moveGridMessageIds[moveKey] = (game.moveGridMessageIds[moveKey] || []).filter((id) => id !== currentMsgId);
  await clearMoveGridMessages(game, moveKey, interaction.channel);
  game.moveGridMessageIds[moveKey] = [];
  // Rebuild the letter grid from the current cache.
  // cache.cells only stores topLeft cells — no filtering needed.
  const allCells = [...cache.cells.keys()];
  const letterRows = buildLetterRows(allCells, msgId, figureIndex);
  const manualPickRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`move_adjust_mp_${msgId}_${figureIndex}`)
      .setLabel('🗺️ Pick Path Manually')
      .setStyle(ButtonStyle.Secondary)
  );
  const firstRows = [...letterRows.slice(0, 4), manualPickRow];
  try {
    await interaction.message.edit({
      content: `**Move** — Pick a column (**${mpRemaining}** MP remaining):`,
      components: firstRows,
      files: [],
      attachments: [], // clear minimap image from previous step
    });
  } catch { /* ignore */ }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, clearMoveGridMessages, getBoardStateForMovement, getMovementProfile, ensureMovementCache, computeMovementCache, normalizeCoord, getMovementTarget, getFigureSize, getNormalizedFootprint, resolveMassivePush, updateMovementBankMessage, getMovementPath, pushUndo, logGameAction, countTerminalsControlledByPlayer, editDistanceMessage, getMoveMpButtonRows, buildBoardMapPayload, updateDcActionsMessage, saveGames, client
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
    buildLetterRows,
    getMovementMinimapAttachment,
    buildBoardMapPayload,
    getDcStats,
    saveGames,
    client,
  } = ctx;
  const m = interaction.customId.match(/^move_pick_(.+)_(\d+)_(.+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, msgId, figureIndexStr, space] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { figureKey, playerNum, mpRemaining, displayName } = moveState;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner can move.')) return;

  // Early termination: "done" ends movement immediately (forfeit remaining MP)
  if (space === 'done') {
    await clearMoveGridMessages(game, moveKey, interaction.channel);
    try { await interaction.message.delete(); } catch { /* already gone */ }
    if (game.mobileMovementActive?.[msgId]) delete game.mobileMovementActive[msgId];
    if (game.urgencyMustSpendAll?.[msgId]) delete game.urgencyMustSpendAll[msgId];
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: `**${displayName}** finished moving (${mpRemaining} MP forfeited).`, ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }

  await clearMoveGridMessages(game, moveKey, interaction.channel);
  // Also delete the message the user clicked on (it may have been edited in-place
  // by handleMoveLetter and removed from moveGridMessageIds tracking)
  try { await interaction.message.delete(); } catch { /* already gone or no perms */ }
  const boardState = getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const profile = getMovementProfile(meta.dcName, figureKey, game);
  // Force Jump: mobileMovementActive grants MOBILE movement (pass through figures/doors)
  if (game.mobileMovementActive?.[msgId]) {
    profile.isMobile = true;
    profile.ignoreBlocking = true;
    profile.ignoreFigureCost = true;
    profile.ignoreDifficult = true;
  }
  const startCoord = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
  if (!startCoord) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Figure position missing. Movement cancelled.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const cache = ensureMovementCache(moveState, startCoord, mpRemaining, boardState, profile);
  const targetLower = normalizeCoord(space);
  const targetInfo = getMovementTarget(cache, targetLower);
  if (!targetInfo) {
    await interaction.followUp({ content: 'Destination not valid for the selected MP.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (moveState.pendingMp && targetInfo.cost !== moveState.pendingMp) {
    await interaction.followUp({ content: 'Select a destination from the most recent distance choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const cost = targetInfo.cost;
  if (cost > mpRemaining) {
    await interaction.followUp({ content: 'Not enough movement points.', ephemeral: true }).catch(discordCatch);
    return;
  }
  moveState.pendingMp = null;
  const mapId = game.selectedMap?.id;

  // Cripple: figure cannot voluntarily exit its current space this round
  if (game.crippledFigures?.includes(displayName)) {
    const currentPos = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
    if (currentPos && targetInfo.topLeft !== currentPos) {
      await interaction.followUp({ content: `**${displayName}** is Crippled — cannot voluntarily exit its space this round.`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }

  // Hold Ground: SMALL hostile figures cannot voluntarily exit spaces adjacent to the Hold Ground player's figures
  if (game.holdGroundPlayerNum && game.holdGroundPlayerNum !== playerNum) {
    const isSMALL = getDcStats ? !((getDcStats(meta.dcName)?.keywords || []).some((k) => k === 'LARGE' || k === 'MASSIVE')) : false;
    if (isSMALL) {
      const holdPoses = game.figurePositions?.[game.holdGroundPlayerNum] || {};
      const holdPlayerCells = [];
      for (const [hfk, hPos] of Object.entries(holdPoses)) {
        if (!hPos) continue;
        const hSize = game.figureOrientations?.[hfk];
        if (hSize && hSize !== '1x1') {
          for (const c of getFootprintCells(hPos, hSize)) holdPlayerCells.push(String(c).toLowerCase());
        } else {
          holdPlayerCells.push(String(hPos).toLowerCase());
        }
      }
      if (holdPlayerCells.length > 0 && mapId) {
        const boardState = getBoardStateForMovement(game, null);
        const adjacency = boardState?.mapSpaces?.adjacency || {};
        const adjacentToHolder = new Set();
        for (const hLow of holdPlayerCells) {
          for (const adj of adjacency[hLow] || []) adjacentToHolder.add(String(adj).toLowerCase());
        }
        const currentPos = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
        if (currentPos && adjacentToHolder.has(String(currentPos).toLowerCase()) && targetInfo.topLeft !== currentPos) {
          await interaction.followUp({ content: `**${displayName}** cannot voluntarily exit this space — **Hold Ground** is active.`, ephemeral: true }).catch(discordCatch);
          return;
        }
      }
    }
  }

  // Tripod: if figure has attacked this activation, cannot exit its space
  if (game.tripodAttacked?.[figureKey]) {
    const currentPos = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
    if (currentPos && targetInfo.topLeft !== currentPos) {
      await interaction.followUp({ content: `**${displayName}** has **Tripod** and has already attacked — cannot exit its space this activation.`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }

  // Thrusters (74-Z Speeder Bike): after moving, must overlap at least 1 space the figure already occupies
  {
    const _thrEff = getDcEffects()?.[meta.dcName];
    if ((_thrEff?.passives || []).includes('Thrusters')) {
      const currentPos = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
      if (currentPos && targetInfo.topLeft !== currentPos) {
        const currentSize = game.figureOrientations?.[figureKey] || getFigureSize(meta.dcName);
        const oldFootprint = new Set(getNormalizedFootprint(currentPos, currentSize));
        const newFootprint = getNormalizedFootprint(targetInfo.topLeft, targetInfo.size || currentSize);
        const hasOverlap = newFootprint.some((cell) => oldFootprint.has(cell));
        if (!hasOverlap) {
          await interaction.followUp({ content: `**${displayName}** has **Thrusters** — must enter at least 1 space it already occupies.`, ephemeral: true }).catch(discordCatch);
          return;
        }
      }
    }
  }

  const terminalsBefore = mapId ? countTerminalsControlledByPlayer(game, playerNum, mapId) : 0;
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  const newTopLeft = targetInfo.topLeft;
  game.figurePositions[playerNum][figureKey] = newTopLeft;
  // Track that this figure has moved (used by Tripod, etc.)
  if (!game.figureMoved) game.figureMoved = {};
  game.figureMoved[figureKey] = true;
  // Overrun: when entering a hostile's space, deal 2 damage (once per hostile per move session)
  if (game.overrunThisActivation?.[msgId]) {
    const hostilePlayerNum = opponentPlayerNum(playerNum);
    const hostilePositions = game.figurePositions?.[hostilePlayerNum] || {};
    game.overrunDamagedThisMove = game.overrunDamagedThisMove || {};
    if (!game.overrunDamagedThisMove[msgId]) game.overrunDamagedThisMove[msgId] = [];
    const hostileDcList = getDcList(game, hostilePlayerNum) || [];
    const hostileMsgIds = getDcMessageIds(game, hostilePlayerNum) || [];
    const _dcHealthState = ctx.dcHealthState;
    // Compute the moving figure's footprint tentatively for overlap detection
    const _movingSize = targetInfo.size || getFigureSize(meta.dcName);
    const _movingFootprint = new Set(getNormalizedFootprint(newTopLeft, _movingSize));
    for (const [hostileFigureKey, hostilePos] of Object.entries(hostilePositions)) {
      if (!hostilePos) continue;
      if (game.overrunDamagedThisMove[msgId].includes(hostileFigureKey)) continue;
      const hFkMatch = hostileFigureKey.match(/^(.+)-(\d+)-(\d+)$/);
      if (!hFkMatch) continue;
      const [, hostileDcName, hostileDgIndex, hostileFigIndexStr] = hFkMatch;
      const hostileSize = game.figureOrientations?.[hostileFigureKey] || getFigureSize(hostileDcName);
      const hostileFootprint = new Set(getNormalizedFootprint(hostilePos, hostileSize));
      const overlaps = [..._movingFootprint].some((s) => hostileFootprint.has(s));
      if (!overlaps) continue;
      game.overrunDamagedThisMove[msgId].push(hostileFigureKey);
      if (!_dcHealthState) continue;
      let hostileMsgId = null;
      for (const [hMsgId, hMeta] of dcMessageMeta) {
        if (hMeta.gameId !== game.gameId) continue;
        if (hMeta.playerNum !== hostilePlayerNum) continue;
        if (hMeta.dcName !== hostileDcName) continue;
        const hDgMatch = (hMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const hDgIdx = hDgMatch ? hDgMatch[1] : '1';
        if (String(hDgIdx) === String(hostileDgIndex)) { hostileMsgId = hMsgId; break; }
      }
      if (!hostileMsgId) continue;
      const hFigIndex = parseInt(hostileFigIndexStr, 10);
      const hHealthState = _dcHealthState.get(hostileMsgId);
      const hEntry = hHealthState?.[hFigIndex];
      if (!hEntry || !Array.isArray(hEntry)) continue;
      const [hCur, hMax] = hEntry;
      const hCurHp = hCur ?? hMax ?? 0;
      if (hMax === 0 || hCurHp <= 0) continue;
      const { prevHp: curHp, newHp } = reduceHp(_dcHealthState, game, hostileMsgId, hFigIndex, 2, hostilePlayerNum);
      const hDisplayName = dcMessageMeta.get(hostileMsgId)?.displayName || hostileDcName;
      const defeatNote = newHp <= 0 ? ' **(may be defeated — check manually)**' : '';
      await logGameAction(game, client, `**Overrun** — **${displayName}** entered **${hDisplayName}**'s space: 2 Damage${defeatNote} (HP: ${curHp}→${newHp}).`, { phase: 'ROUND', icon: 'attack' });
    }
  }
  // Cut and Run (Davith Elso): when exiting a space containing a hostile, that hostile suffers 1 Damage (once/fig/round)
  {
    const _carEff = getDcEffects()?.[meta.dcName];
    if ((_carEff?.specialAbilityIds || []).includes('cut_and_run_davith') && startCoord && newTopLeft !== startCoord) {
      const hostilePlayerNum = opponentPlayerNum(playerNum);
      const hostilePositions = game.figurePositions?.[hostilePlayerNum] || {};
      const _movingSize = getFigureSize(meta.dcName);
      const _oldFootprint = new Set(getNormalizedFootprint(startCoord, _movingSize));
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      const hostileDcList = getDcList(game, hostilePlayerNum) || [];
      const hostileMsgIds = getDcMessageIds(game, hostilePlayerNum) || [];
      const _dcHs = ctx.dcHealthState;
      for (const [hFk, hPos] of Object.entries(hostilePositions)) {
        if (!hPos) continue;
        const _carKey = `cut_and_run_${hFk}`;
        if (game.roundFigureAbilityUsed[_carKey]) continue;
        const hMatch = hFk.match(/^(.+)-(\d+)-(\d+)$/);
        if (!hMatch) continue;
        const [, hDcName, hDgIdx, hFigIdxStr] = hMatch;
        const hSize = game.figureOrientations?.[hFk] || getFigureSize(hDcName);
        const hFootprint = new Set(getNormalizedFootprint(hPos, hSize));
        const wasAdjacent = [..._oldFootprint].some(s => hFootprint.has(s));
        if (!wasAdjacent) continue;
        game.roundFigureAbilityUsed[_carKey] = true;
        // Deal 1 damage to hostile
        if (!_dcHs) continue;
        let hMsgId = null;
        for (const [mId, mMeta] of dcMessageMeta) {
          if (mMeta.gameId !== game.gameId || mMeta.playerNum !== hostilePlayerNum || mMeta.dcName !== hDcName) continue;
          const dgM = (mMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
          if (String(dgM ? dgM[1] : '1') === String(hDgIdx)) { hMsgId = mId; break; }
        }
        if (!hMsgId) continue;
        const hFigIdx = parseInt(hFigIdxStr, 10);
        const hHealthState2 = _dcHs.get(hMsgId);
        const hEntry2 = hHealthState2?.[hFigIdx];
        if (!hEntry2 || !Array.isArray(hEntry2)) continue;
        const [hCur2, hMax2] = hEntry2;
        const hCurHp2 = hCur2 ?? hMax2 ?? 0;
        if (hMax2 === 0 || hCurHp2 <= 0) continue;
        const { prevHp: hCur, newHp: hNewHp } = reduceHp(_dcHs, game, hMsgId, hFigIdx, 1, hostilePlayerNum);
        const hDispName = dcMessageMeta.get(hMsgId)?.displayName || hDcName;
        const defeatNote = hNewHp <= 0 ? ' **(may be defeated)**' : '';
        await logGameAction(game, client, `⚔️ **Cut and Run** — **${displayName}** exits **${hDispName}**'s space: 1 Damage${defeatNote} (HP: ${hCur}→${hNewHp}).`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  const newSize = targetInfo.size;
  const storedSize = game.figureOrientations?.[figureKey] || getFigureSize(meta.dcName);
  if (newSize !== storedSize) {
    game.figureOrientations = game.figureOrientations || {};
    game.figureOrientations[figureKey] = newSize;
  }
  const footprintSet = new Set(getNormalizedFootprint(newTopLeft, newSize));
  const updatedProfile = getMovementProfile(meta.dcName, figureKey, game);
  await resolveMassivePush(game, updatedProfile, figureKey, playerNum, footprintSet, client, logGameAction);
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
  const destDisplay = bottomLeftCoord(newTopLeft, newSize).toUpperCase();
  const shortName = (displayName || meta.displayName || '').replace(/\s*\[(?:DG|Group) \d+\]$/, '') || displayName;
  const pLabel = `P${playerNum}`;
  const ownerId = getPlayerId(game, playerNum);
  const path = getMovementPath(cache, startCoord, newTopLeft, newSize, profile);
  const startDisplay = bottomLeftCoord(startCoord, profile.size).toUpperCase();
  const pathStr = path.length > 1
    ? ` via ${path.map((c) => bottomLeftCoord(String(c), profile.size).toUpperCase()).join(' → ')}`
    : '';
  const moveLogMsg = await logGameAction(game, client, `<@${ownerId}> moved **${displayName}** from **${startDisplay}** → **${destDisplay}** (**${cost} MP**${pathStr})`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'move' });
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
    // Delete all "Pick a destination" messages — grid messages already cleared above;
    // now also delete the distance message itself so nothing lingers.
    if (moveState.distanceMessageId) {
      try {
        const distMsg = await interaction.channel.messages.fetch(moveState.distanceMessageId);
        await distMsg.delete();
      } catch { /* already gone */ }
    }
    // Sweep thread for any leftover movement minimap messages (belt-and-suspenders cleanup)
    const actionsMessageId = game.dcActionsData?.[msgId]?.messageId;
    if (actionsMessageId && interaction.channel) {
      try {
        const msgs = await interaction.channel.messages.fetch({ limit: 30 });
        for (const [mId, m] of msgs) {
          if (mId === actionsMessageId) continue; // never delete the DC actions message
          if (m.author?.id !== client?.user?.id) continue; // only our own messages
          const hasMoveMinimap = m.attachments?.some(a => a.name === 'move-destinations.png');
          if (hasMoveMinimap) {
            try { await m.delete(); } catch { /* already gone */ }
          }
        }
      } catch { /* ignore fetch errors */ }
    }
    const wasPostDeploy = moveState.postDeployReturn;
    delete game.moveInProgress[moveKey];
    // Force Jump: clear mobileMovementActive when all MP is spent
    if (game.mobileMovementActive?.[msgId]) delete game.mobileMovementActive[msgId];
    // Urgency: clear must-spend-all flag when movement completes
    if (game.urgencyMustSpendAll?.[msgId]) delete game.urgencyMustSpendAll[msgId];
    // Post-deploy movement: advance the post-deploy queue
    if (wasPostDeploy && game.postDeployQueue) {
      const { onPostDeployMovementComplete } = await import('./post-deploy.js');
      await onPostDeployMovementComplete(game, meta.gameId, client, ctx);
    }
  } else {
    const nextBoard = getBoardStateForMovement(game, figureKey);
    if (nextBoard && computeMovementCache) {
      const nextProfile = getMovementProfile(meta.dcName, figureKey, game);
      // Force Jump: carry mobileMovement override into subsequent move steps
      if (game.mobileMovementActive?.[msgId]) {
        nextProfile.isMobile = true;
        nextProfile.ignoreBlocking = true;
        nextProfile.ignoreFigureCost = true;
        nextProfile.ignoreDifficult = true;
      }
      const nextCache = computeMovementCache(newTopLeft, newMp, nextBoard, nextProfile);
      moveState.boardState = nextBoard;
      moveState.movementProfile = nextProfile;
      moveState.movementCache = nextCache;
      moveState.cacheMaxMp = newMp;
      // Clean up old MP picker (distanceMessageId) if it exists from a previous manual-path selection
      if (moveState.distanceMessageId) {
        try {
          const distMsg = await interaction.channel.messages.fetch(moveState.distanceMessageId);
          await distMsg.delete();
        } catch { /* already gone */ }
        moveState.distanceMessageId = null;
      }
      // Show two-tier column picker for new position with remaining MP.
      // cache.cells only stores topLeft cells — no filtering needed.
      const newButtonSpaces = [...nextCache.cells.keys()];
      const newIsMultiTile = nextProfile.size && nextProfile.size !== '1x1';
      const newMultiTileNote = newIsMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';
      const newMinimapCells = newIsMultiTile
        ? newButtonSpaces.map((tl) => bottomLeftCoord(tl, nextProfile.size))
        : newButtonSpaces;
      const newMinimap = await getMovementMinimapAttachment(game, msgId, figureKey, newMinimapCells);
      const newLetterRows = buildLetterRows(newButtonSpaces, msgId, figureIndex);
      const newManualPickRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`move_adjust_mp_${msgId}_${figureIndex}`)
          .setLabel('🗺️ Pick Path Manually')
          .setStyle(ButtonStyle.Secondary)
      );
      const newFirstRows = [...newLetterRows.slice(0, 4), newManualPickRow];
      const newFirstPayload = {
        content: `**Move** — Pick a column (**${newMp}** MP remaining):${newMultiTileNote}`,
        components: newFirstRows,
        fetchReply: true,
      };
      if (newMinimap) newFirstPayload.files = [newMinimap];
      const newGridMsg = await interaction.followUp(newFirstPayload).catch(() => null);
      game.moveGridMessageIds = game.moveGridMessageIds || {};
      game.moveGridMessageIds[moveKey] = newGridMsg?.id ? [newGridMsg.id] : [];
    } else {
      game.moveGridMessageIds = game.moveGridMessageIds || {};
      game.moveGridMessageIds[moveKey] = [];
    }
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
  // Re-render the activation thread minimap so it shows the figure's new position
  if (ctx.updateDcActionsMessage) {
    try {
      await ctx.updateDcActionsMessage(game, msgId, client);
    } catch (err) {
      console.error('Failed to update activation minimap after move:', err);
    }
  }
  // Bleeding: trigger once after first space moved (pendingBleed set when Move action declared)
  if (moveState.pendingBleed && ctx.sendBleedingPrompt) {
    moveState.pendingBleed = false;
    if ((game.figureConditions?.[moveState.figureKey] || []).includes('Bleed')) {
      await ctx.sendBleedingPrompt(game, interaction.channel, moveState.figureKey, moveState.playerNum, moveState.displayName);
    }
  }
  // Rush (Onar): after all movement MP exhausted, offer push on adjacent SMALL hostile
  if (newMp <= 0 && game.rushPending?.[msgId]) {
    delete game.rushPending[msgId];
    const rushMapId = game.selectedMap?.id;
    const rushAdjSpaces = rushMapId ? (getMapSpaces(rushMapId)?.adjacency?.[newTopLeft] || []) : [];
    const rushEffects = getDcEffects();
    const rushOppNum = opponentPlayerNum(playerNum);
    const rushOppPos = game.figurePositions?.[rushOppNum] || {};
    const rushAdjSet = new Set(rushAdjSpaces);
    const rushTargets = [];
    for (const [fk, pos] of Object.entries(rushOppPos)) {
      if (!pos || !rushAdjSet.has(pos)) continue;
      const rDcName = dcNameFromFigureKey(fk);
      const rEff = rushEffects?.[rDcName];
      const rKw = (rEff?.keywords || []).map(k => String(k).toUpperCase());
      if (rKw.includes('LARGE') || rKw.includes('MASSIVE')) continue;
      // Spiked Boots: cannot be pushed except by MASSIVE
      if ((rEff?.specialAbilityIds || []).includes('spiked_boots_snowtrooper')) {
        const pusherEff = rushEffects?.[meta.dcName];
        if (!(pusherEff?.keywords || []).some(k => String(k).toUpperCase() === 'MASSIVE')) continue;
      }
      rushTargets.push({ figureKey: fk, dcName: rDcName });
    }
    if (rushTargets.length > 0) {
      game.pendingRushPush = {
        msgId, playerNum, activatorFigureKey: figureKey,
        activatorPos: newTopLeft,
        targets: rushTargets.map(t => t.figureKey),
      };
      const btns = rushTargets.map((t, i) =>
        new ButtonBuilder()
          .setCustomId(`rush_push_fig_${game.gameId}_${msgId}_${i}`)
          .setLabel(t.dcName.replace(/_/g, ' '))
          .setStyle(ButtonStyle.Primary)
      );
      btns.push(
        new ButtonBuilder()
          .setCustomId(`rush_push_skip_${game.gameId}_${msgId}`)
          .setLabel('Skip Rush Push')
          .setStyle(ButtonStyle.Secondary)
      );
      const rushRows = [];
      while (btns.length > 0) rushRows.push(new ActionRowBuilder().addComponents(btns.splice(0, 5)));
      await interaction.followUp({
        content: '**Rush** — Push an adjacent SMALL hostile 1 space? Both suffer 1 Damage.',
        components: rushRows.slice(0, 5),
      });
    }
  }
  // Shoulder Rush (KX-Series Security Droid): after movement MP exhausted, choose adjacent hostile → push if SMALL + enter space → free attack
  if (newMp <= 0 && game.shoulderRushPending?.[msgId]) {
    const srData = game.shoulderRushPending[msgId];
    delete game.shoulderRushPending[msgId];
    const srMapId = game.selectedMap?.id;
    const srAdjSpaces = srMapId ? (getMapSpaces(srMapId)?.adjacency?.[newTopLeft] || []) : [];
    const srEffects = getDcEffects();
    const srOppNum = opponentPlayerNum(playerNum);
    const srOppPos = game.figurePositions?.[srOppNum] || {};
    const srAdjSet = new Set(srAdjSpaces);
    const srTargets = [];
    for (const [fk, pos] of Object.entries(srOppPos)) {
      if (!pos || !srAdjSet.has(pos)) continue;
      const srDcName = dcNameFromFigureKey(fk);
      srTargets.push({ figureKey: fk, dcName: srDcName });
    }
    if (srTargets.length > 0) {
      game.pendingShoulderRush = {
        msgId, playerNum, activatorFigureKey: figureKey,
        activatorPos: newTopLeft,
        targets: srTargets.map(t => t.figureKey),
      };
      const srBtns = srTargets.map((t, i) =>
        new ButtonBuilder()
          .setCustomId(`shoulder_rush_fig_${game.gameId}_${msgId}_${i}`)
          .setLabel(t.dcName.replace(/_/g, ' '))
          .setStyle(ButtonStyle.Primary)
      );
      srBtns.push(
        new ButtonBuilder()
          .setCustomId(`shoulder_rush_skip_${game.gameId}_${msgId}`)
          .setLabel('Skip (No Target)')
          .setStyle(ButtonStyle.Secondary)
      );
      const srRows = [];
      while (srBtns.length > 0) srRows.push(new ActionRowBuilder().addComponents(srBtns.splice(0, 5)));
      await interaction.followUp({
        content: '**Shoulder Rush** — Choose an adjacent hostile figure to target:',
        components: srRows.slice(0, 5),
      });
    }
  }
  // Deference Protocol (KX-Series Security Droid): when a friendly LEADER enters a space adjacent to KX, it may gain 1 Block token (once per round)
  {
    const dpMapId = game.selectedMap?.id;
    const dpEffects = getDcEffects();
    // Check all figures on the same team: does any have deference_protocol and is adjacent to the figure that just moved?
    const friendlyPositions = game.figurePositions?.[playerNum] || {};
    const movedFigDcName = meta.dcName;
    const movedFigEff = dpEffects?.[movedFigDcName];
    const movedFigKw = (movedFigEff?.keywords || []).map(k => String(k).toUpperCase());
    const movedFigIsLeader = movedFigKw.includes('LEADER');
    if (movedFigIsLeader) {
      for (const [fk, pos] of Object.entries(friendlyPositions)) {
        if (!pos || fk === figureKey) continue; // skip self
        const dpDcName = dcNameFromFigureKey(fk);
        const dpEff = dpEffects?.[dpDcName];
        if (!(dpEff?.specialAbilityIds || []).includes('deference_protocol')) continue;
        // Check adjacency
        const adjSpaces = dpMapId ? (getMapSpaces(dpMapId)?.adjacency?.[pos] || []) : [];
        if (!adjSpaces.includes(newTopLeft)) continue;
        // Once per round check
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        const dpKey = `deference_protocol_${fk}`;
        if (game.roundFigureAbilityUsed[dpKey]) continue;
        game.roundFigureAbilityUsed[dpKey] = true;
        // Grant Block token
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
        if (game.figurePowerTokens[fk].length < getMaxPowerTokens(fk)) {
          game.figurePowerTokens[fk].push('Block');
          if (logGameAction) {
            await logGameAction(game, client, `**Deference Protocol** — **${dpDcName}** gained a Block token (friendly LEADER entered adjacent space).`, { phase: 'ROUND', icon: 'defend' });
          }
        }
      }
    }
  }
  // Cassian Said I Had To (K-2S0): when a friendly LEADER enters an adjacent space, gain up to 1 Hit Token (once per round)
  {
    const csMapId = game.selectedMap?.id;
    const csEffects = getDcEffects();
    const csFriendlyPositions = game.figurePositions?.[playerNum] || {};
    const csMovedFigDcName = meta.dcName;
    const csMovedFigEff = csEffects?.[csMovedFigDcName];
    const csMovedFigKw = (csMovedFigEff?.keywords || []).map(k => String(k).toUpperCase());
    const csMovedFigIsLeader = csMovedFigKw.includes('LEADER');
    if (csMovedFigIsLeader) {
      for (const [fk, pos] of Object.entries(csFriendlyPositions)) {
        if (!pos || fk === figureKey) continue;
        const csDcName = dcNameFromFigureKey(fk);
        const csEff = csEffects?.[csDcName];
        if (!(csEff?.specialAbilityIds || []).includes('cassian_said_i_had_to')) continue;
        const csAdjSpaces = csMapId ? (getMapSpaces(csMapId)?.adjacency?.[pos] || []) : [];
        if (!csAdjSpaces.includes(newTopLeft)) continue;
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        const csKey = `cassian_said_i_had_to_${fk}`;
        if (game.roundFigureAbilityUsed[csKey]) continue;
        game.roundFigureAbilityUsed[csKey] = true;
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
        if (game.figurePowerTokens[fk].length < getMaxPowerTokens(fk)) {
          game.figurePowerTokens[fk].push('Hit');
          if (logGameAction) {
            await logGameAction(game, client, `**Cassian Said I Had To** — **${csDcName}** gained a Hit token (friendly LEADER entered adjacent space).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
    }
  }
  // Swipe (Salacious B. Crumb): when entering a space containing a hostile figure during movement, deal 1 Damage (limit once per figure per round)
  if (meta.dcName === 'Salacious B. Crumb' && path && path.length >= 2) {
    const _swOppPN = opponentPlayerNum(playerNum);
    const _swEnemyFigs = game.figurePositions?.[_swOppPN] || {};
    const _swHs = ctx.dcHealthState;
    // Walk each space entered (skip path[0] which is start position)
    for (let _swPi = 1; _swPi < path.length; _swPi++) {
      const _swSpace = String(path[_swPi]).toLowerCase();
      for (const [_swEfk, _swEpos] of Object.entries(_swEnemyFigs)) {
        if (!_swEpos || String(_swEpos).toLowerCase() !== _swSpace) continue;
        const _swKey = `swipe_${figureKey}_${_swEfk}`;
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        if (game.roundFigureAbilityUsed[_swKey]) continue;
        game.roundFigureAbilityUsed[_swKey] = true;
        const _swTgtDcName = dcNameFromFigureKey(_swEfk);
        const _swMatch = _swEfk.match(/^(.+)-(\d+)-(\d+)$/);
        if (!_swMatch) continue;
        const [, , _swDgIdx, _swFigIdxStr] = _swMatch;
        const _swFigIdx = parseInt(_swFigIdxStr, 10);
        let _swTgtMsgId = null;
        for (const [mId, mMeta] of dcMessageMeta) {
          if (mMeta.gameId !== game.gameId || mMeta.playerNum !== _swOppPN || mMeta.dcName !== _swTgtDcName) continue;
          const dgM = (mMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
          if (String(dgM ? dgM[1] : '1') === String(_swDgIdx)) { _swTgtMsgId = mId; break; }
        }
        if (!_swTgtMsgId || !_swHs) continue;
        const _swEntry = _swHs.get(_swTgtMsgId)?.[_swFigIdx];
        if (!_swEntry || !Array.isArray(_swEntry)) continue;
        const [_swCur, _swMax] = _swEntry;
        if ((_swMax ?? 0) === 0 || ((_swCur ?? _swMax ?? 0) <= 0)) continue;
        const { prevHp: _swPrev, newHp: _swNew } = reduceHp(_swHs, game, _swTgtMsgId, _swFigIdx, 1, _swOppPN);
        const _swDefeat = _swNew <= 0 ? ' **(may be defeated)**' : '';
        await logGameAction(game, client, `**Swipe** — **Salacious B. Crumb** enters **${_swTgtDcName}**'s space: 1 Damage${_swDefeat} (HP: ${_swPrev}→${_swNew}).`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Attached (Dio): when Iden Versio exits Dio's space during movement, Dio may move up to 1 space
  if (meta.dcName === 'Iden Versio' && startCoord && String(newTopLeft).toLowerCase() !== String(startCoord).toLowerCase()) {
    const _dioFriendlyFigs = game.figurePositions?.[playerNum] || {};
    for (const [_dioFk, _dioPos] of Object.entries(_dioFriendlyFigs)) {
      if (!_dioPos) continue;
      if (!_dioFk.startsWith('Dio-')) continue;
      if (String(_dioPos).toLowerCase() !== String(startCoord).toLowerCase()) continue;
      // Iden was on Dio's space and has now moved away — trigger Attached
      const _dioMapId = game.selectedMap?.id;
      if (!_dioMapId) continue;
      const _dioAdj = getMapSpaces(_dioMapId)?.adjacency?.[_dioPos] || [];
      if (_dioAdj.length === 0) continue;
      // Best follow space is path[1] (first step on Iden's path)
      const _dioDefaultSpace = (path && path.length >= 2) ? String(path[1]).toLowerCase() : _dioAdj[0];
      game.pendingDioFollow = {
        dioFigureKey: _dioFk,
        dioPlayerNum: playerNum,
        currentSpace: _dioPos,
        followSpace: _dioDefaultSpace,
      };
      const _dioOwnerId = getPlayerId(game, playerNum);
      const _dioSpaceBtns = _dioAdj.slice(0, 19).map(s =>
        new ButtonBuilder()
          .setCustomId(`dio_follow_pick_${game.gameId}_${s}`)
          .setLabel(s.toUpperCase())
          .setStyle(s === _dioDefaultSpace ? ButtonStyle.Primary : ButtonStyle.Secondary)
      );
      _dioSpaceBtns.push(
        new ButtonBuilder()
          .setCustomId(`dio_stay_${game.gameId}`)
          .setLabel('Stay')
          .setStyle(ButtonStyle.Secondary)
      );
      const _dioRows = [];
      while (_dioSpaceBtns.length > 0) _dioRows.push(new ActionRowBuilder().addComponents(_dioSpaceBtns.splice(0, 5)));
      await interaction.followUp({
        content: `<@${_dioOwnerId}> **Attached** — **Iden Versio** exited **Dio**'s space. Dio may interrupt to move up to 1 space:`,
        components: _dioRows.slice(0, 5),
        allowedMentions: { users: _dioOwnerId ? [_dioOwnerId] : [] },
      }).catch(discordCatch);
      break;
    }
  }
  // --- Post-move interrupt detection: C23 Parting Blow, C15 Dirty Trick, C43 Disengage ---
  if (path && path.length >= 2) {
    const interruptTriggers = detectPostMoveInterrupts(game, playerNum, figureKey, path);
    for (const trigger of interruptTriggers) {
      const oppId = getPlayerId(game, trigger.candidatePlayerNum);
      if (trigger.type === 'overwatch') {
        // Overwatch uses different buttons (DC exhaust, not CC play)
        const owBtns = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`ow_interrupt_use_${game.gameId}_${trigger.owMsgId}`)
            .setLabel('Use Overwatch (Interrupt Attack)')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`ow_interrupt_skip_${game.gameId}_${trigger.owMsgId}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary),
        );
        await interaction.channel.send({
          content: `⚠️ <@${oppId}> — ${trigger.description}`,
          components: [owBtns],
          allowedMentions: { users: oppId ? [oppId] : [] },
        }).catch(discordCatch);
      } else {
        const triggerBtns = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`mvint_play_${game.gameId}_${trigger.type}_${trigger.candidateFigureKey}`)
            .setLabel(`Play ${trigger.cardName}`)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`mvint_skip_${game.gameId}_${trigger.type}_${trigger.candidateFigureKey}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary),
        );
        await interaction.channel.send({
          content: `⚠️ <@${oppId}> — ${trigger.description}`,
          components: [triggerBtns],
          allowedMentions: { users: oppId ? [oppId] : [] },
        }).catch(discordCatch);
      }
      await logGameAction(game, client, `⚠️ Movement interrupt opportunity: ${trigger.description}`, { phase: 'ROUND', icon: 'warn' });
    }
  }
  saveGames();
}

/**
 * Handle mvint_play_ — player chose to play a movement interrupt CC (Parting Blow / Dirty Trick / Disengage).
 * This acknowledges the choice and logs it; actual card resolution still goes through the normal CC play flow.
 */
export async function handleMoveInterruptPlay(interaction, ctx) {
  const { getGame, logGameAction, saveGames, client } = ctx;
  const m = interaction.customId.match(/^mvint_play_([^_]+)_(\w+)_(.+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, triggerType, candidateFigureKey] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const cardNames = { partingBlow: 'Parting Blow', dirtyTrick: 'Dirty Trick', disengage: 'Disengage' };
  const cardName = cardNames[triggerType] || triggerType;
  const dcName = dcNameFromFigureKey(candidateFigureKey).replace(/_/g, ' ');

  // Disable the buttons on the original message
  try {
    await interaction.update({ components: [] });
  } catch {
    try { await interaction.deferUpdate(); } catch { /* already handled */ }
  }

  await logGameAction(game, client, `**${dcName}** chose to play **${cardName}**. Resolve via the CC hand (play the card normally).`, { phase: 'ROUND', icon: 'cc' });
  await interaction.followUp({
    content: `✅ **${cardName}** acknowledged — play the card from your hand to resolve it.`,
    ephemeral: true,
  }).catch(discordCatch);
  saveGames();
}

/**
 * Handle mvint_skip_ — player chose to skip a movement interrupt opportunity.
 */
export async function handleMoveInterruptSkip(interaction, ctx) {
  const { getGame, logGameAction, saveGames, client } = ctx;
  const m = interaction.customId.match(/^mvint_skip_([^_]+)_(\w+)_(.+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, triggerType, candidateFigureKey] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const cardNames = { partingBlow: 'Parting Blow', dirtyTrick: 'Dirty Trick', disengage: 'Disengage' };
  const cardName = cardNames[triggerType] || triggerType;
  const dcName = dcNameFromFigureKey(candidateFigureKey).replace(/_/g, ' ');

  // Disable the buttons on the original message
  try {
    await interaction.update({ components: [] });
  } catch {
    try { await interaction.deferUpdate(); } catch { /* already handled */ }
  }

  await logGameAction(game, client, `**${dcName}** skipped **${cardName}** opportunity.`, { phase: 'ROUND', icon: 'skip' });
  saveGames();
}

/**
 * Handle ow_interrupt_use_ — player chose to use Overwatch interrupt attack.
 */
export async function handleOverwatchInterruptUse(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const m = interaction.customId.match(/^ow_interrupt_use_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, owMsgId] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  // Exhaust the Overwatch card
  game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
  game.exhaustedSkirmishUpgrades[owMsgId] = [...(game.exhaustedSkirmishUpgrades[owMsgId] || []), 'Overwatch'];

  // Remove the token
  if (game.overwatchTokenPosition) delete game.overwatchTokenPosition[owMsgId];

  // Determine DC name
  let dcDisplayName = 'E-Web Engineer';
  for (const pn of [1, 2]) {
    const dcList = getDcList(game, pn) || [];
    const msgIds = getDcMessageIds(game, pn) || [];
    const idx = msgIds.indexOf(owMsgId);
    if (idx >= 0) {
      dcDisplayName = dcList[idx]?.displayName || dcList[idx]?.dcName || dcDisplayName;
      break;
    }
  }

  try { await interaction.update({ components: [] }); } catch { try { await interaction.deferUpdate(); } catch { /* already handled */ } }

  await logGameAction(game, client, `**Overwatch** — **${dcDisplayName}** interrupts to perform an attack! Use the DC's Attack button. Token removed. (Exhausted)`, { phase: 'ROUND', icon: 'attack' });
  await interaction.followUp({ content: `✅ **Overwatch** activated — use **${dcDisplayName}**'s Attack button to perform the interrupt attack. The Overwatch token has been removed.`, ephemeral: true }).catch(discordCatch);
  saveGames();
}

/**
 * Handle ow_interrupt_skip_ — player chose to skip Overwatch interrupt.
 */
export async function handleOverwatchInterruptSkip(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const m = interaction.customId.match(/^ow_interrupt_skip_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  try { await interaction.update({ components: [] }); } catch { try { await interaction.deferUpdate(); } catch { /* already handled */ } }

  await logGameAction(game, client, `**Overwatch** interrupt opportunity skipped.`, { phase: 'ROUND', icon: 'skip' });
  saveGames();
}

/**
 * Handle dio_follow_pick_ — player chose a space for Dio to follow Iden.
 */
export async function handleDioFollowPick(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const m = interaction.customId.match(/^dio_follow_pick_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, space] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const pending = game.pendingDioFollow;
  if (!pending) {
    try { await interaction.update({ components: [] }); } catch { /* already handled */ }
    return;
  }

  try { await interaction.update({ components: [] }); } catch { try { await interaction.deferUpdate(); } catch { /* already handled */ } }

  // Move Dio to the chosen space
  const { dioFigureKey, dioPlayerNum, currentSpace } = pending;
  game.figurePositions = game.figurePositions || {};
  game.figurePositions[dioPlayerNum] = game.figurePositions[dioPlayerNum] || {};
  game.figurePositions[dioPlayerNum][dioFigureKey] = space;
  delete game.pendingDioFollow;

  await interaction.message.edit({ content: `**Attached** — **Dio** moved from **${currentSpace.toUpperCase()}** to **${space.toUpperCase()}** (following Iden Versio).`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Attached** — **Dio** moved to **${space.toUpperCase()}** (following Iden Versio).`, { phase: 'ROUND', icon: 'move' });
  saveGames();
}

/**
 * Handle dio_stay_ — player chose for Dio to stay put.
 */
export async function handleDioStay(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const m = interaction.customId.match(/^dio_stay_([^_]+)$/);
  if (!m) return;
  const [, gameId] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  try { await interaction.update({ components: [] }); } catch { try { await interaction.deferUpdate(); } catch { /* already handled */ } }

  delete game.pendingDioFollow;
  await interaction.message.edit({ content: `**Attached** — **Dio** stays put.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Attached** — Dio chose to stay (did not follow Iden).`, { phase: 'ROUND', icon: 'skip' });
  saveGames();
}
