/**
 * Movement handlers: move_mp_, move_adjust_mp_, move_pick_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getDcEffects, getMapSpaces } from '../data-loader.js';
import { bottomLeftCoord, getFootprintCells } from '../game/coords.js';
import { reduceHp } from '../game/index.js';

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
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, msgId, figureIndexStr, mpStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const mp = parseInt(mpStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { figureKey, playerNum, mpRemaining, displayName } = moveState;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owner can move.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (mp < 1 || mp > mpRemaining) {
    await interaction.followUp({ content: `Choose 1–${mpRemaining} MP.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const boardState = moveState.boardState || getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'Figure position missing. Movement cancelled.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const cache = ensureMovementCache(moveState, startCoord, mpRemaining, boardState, profile);
  const spaces = getSpacesAtCost(cache, mp);
  if (spaces.length === 0) {
    const validCosts = [...new Set([...cache.cells.values()].map((c) => c.cost))].filter((c) => c > 0 && c <= mpRemaining).sort((a, b) => a - b);
    const altText = validCosts.length > 0 ? ` Reachable: ${validCosts.join(', ')} MP.` : '';
    await interaction.followUp({ content: `No spaces exactly **${mp}** MP away.${altText}`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, msgId, figureIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { playerNum, mpRemaining } = moveState;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owner can adjust.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
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
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, msgId, figureIndexStr, letter] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const { getGame, dcMessageMeta, clearMoveGridMessages, getMoveSpaceGridRows, buildLetterRows } = ctx;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, moveState.playerNum)) {
    await interaction.followUp({ content: 'Only the owner can move.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { movementCache: cache, movementProfile: profile, boardState } = moveState;
  if (!cache) {
    await interaction.followUp({ content: 'Move cache expired.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, msgId, figureIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const { getGame, dcMessageMeta, clearMoveGridMessages, buildLetterRows } = ctx;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, moveState.playerNum)) {
    await interaction.followUp({ content: 'Only the owner can move.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { movementCache: cache, movementProfile: profile, mpRemaining } = moveState;
  if (!cache) {
    await interaction.followUp({ content: 'Move cache expired.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, msgId, figureIndexStr, space] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const moveKey = `${msgId}_${figureIndex}`;
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { figureKey, playerNum, mpRemaining, displayName } = moveState;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owner can move.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await clearMoveGridMessages(game, moveKey, interaction.channel);
  // Also delete the message the user clicked on (it may have been edited in-place
  // by handleMoveLetter and removed from moveGridMessageIds tracking)
  try { await interaction.message.delete(); } catch { /* already gone or no perms */ }
  const boardState = getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    delete game.moveInProgress[moveKey];
    await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'Figure position missing. Movement cancelled.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const cache = ensureMovementCache(moveState, startCoord, mpRemaining, boardState, profile);
  const targetLower = normalizeCoord(space);
  const targetInfo = getMovementTarget(cache, targetLower);
  if (!targetInfo) {
    await interaction.followUp({ content: 'Destination not valid for the selected MP.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (moveState.pendingMp && targetInfo.cost !== moveState.pendingMp) {
    await interaction.followUp({ content: 'Select a destination from the most recent distance choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const cost = targetInfo.cost;
  if (cost > mpRemaining) {
    await interaction.followUp({ content: 'Not enough movement points.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  moveState.pendingMp = null;
  const mapId = game.selectedMap?.id;

  // Cripple: figure cannot voluntarily exit its current space this round
  if (game.crippledFigures?.includes(displayName)) {
    const currentPos = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
    if (currentPos && targetInfo.topLeft !== currentPos) {
      await interaction.followUp({ content: `**${displayName}** is Crippled — cannot voluntarily exit its space this round.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
          await interaction.followUp({ content: `**${displayName}** cannot voluntarily exit this space — **Hold Ground** is active.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
          return;
        }
      }
    }
  }

  // Tripod: if figure has attacked this activation, cannot exit its space
  if (game.tripodAttacked?.[figureKey]) {
    const currentPos = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
    if (currentPos && targetInfo.topLeft !== currentPos) {
      await interaction.followUp({ content: `**${displayName}** has **Tripod** and has already attacked — cannot exit its space this activation.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
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
    const hostilePlayerNum = playerNum === 1 ? 2 : 1;
    const hostilePositions = game.figurePositions?.[hostilePlayerNum] || {};
    game.overrunDamagedThisMove = game.overrunDamagedThisMove || {};
    if (!game.overrunDamagedThisMove[msgId]) game.overrunDamagedThisMove[msgId] = [];
    const hostileDcList = hostilePlayerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const hostileMsgIds = hostilePlayerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
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
      const { prevHp: curHp, newHp, maxHp: _orMaxHp } = reduceHp(_dcHealthState, game, hostileMsgId, hFigIndex, 2, hostilePlayerNum);
      if (_orMaxHp === 0 || curHp === null || curHp <= 0) continue;
      const hDisplayName = dcMessageMeta.get(hostileMsgId)?.displayName || hostileDcName;
      const defeatNote = newHp <= 0 ? ' **(may be defeated — check manually)**' : '';
      await logGameAction(game, client, `**Overrun** — **${displayName}** entered **${hDisplayName}**'s space: 2 Damage${defeatNote} (HP: ${curHp}→${newHp}).`, { phase: 'ROUND', icon: 'attack' });
    }
  }
  // Cut and Run (Davith Elso): when exiting a space containing a hostile, that hostile suffers 1 Damage (once/fig/round)
  {
    const _carEff = getDcEffects()?.[meta.dcName];
    if ((_carEff?.specialAbilityIds || []).includes('cut_and_run_davith') && startCoord && newTopLeft !== startCoord) {
      const hostilePlayerNum = playerNum === 1 ? 2 : 1;
      const hostilePositions = game.figurePositions?.[hostilePlayerNum] || {};
      const _movingSize = getFigureSize(meta.dcName);
      const _oldFootprint = new Set(getNormalizedFootprint(startCoord, _movingSize));
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      const hostileDcList = hostilePlayerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const hostileMsgIds = hostilePlayerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
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
        const { prevHp: hCur, newHp: hNewHp, maxHp: _carMaxHp } = reduceHp(_dcHs, game, hMsgId, hFigIdx, 1, hostilePlayerNum);
        if (_carMaxHp === 0 || hCur === null || hCur <= 0) continue;
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
  const destDisplay = bottomLeftCoord(newTopLeft, newSize).toUpperCase();
  const shortName = (displayName || meta.displayName || '').replace(/\s*\[(?:DG|Group) \d+\]$/, '') || displayName;
  const pLabel = `P${playerNum}`;
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
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
    delete game.moveInProgress[moveKey];
    // Force Jump: clear mobileMovementActive when all MP is spent
    if (game.mobileMovementActive?.[msgId]) delete game.mobileMovementActive[msgId];
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
    const rushOppNum = playerNum === 1 ? 2 : 1;
    const rushOppPos = game.figurePositions?.[rushOppNum] || {};
    const rushAdjSet = new Set(rushAdjSpaces);
    const rushTargets = [];
    for (const [fk, pos] of Object.entries(rushOppPos)) {
      if (!pos || !rushAdjSet.has(pos)) continue;
      const rDcName = fk.replace(/-\d+-\d+$/, '');
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
  saveGames();
}
