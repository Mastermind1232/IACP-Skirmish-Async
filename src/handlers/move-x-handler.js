/**
 * Move-X handler (CRR MOVE-017 / MOVE-020).
 *
 * "Move X spaces" abilities (Leg Hydraulics, Fell Swoop, Mortar
 * Launcher, Lift Off, etc.) grant a per-effect movement budget in
 * SPACES — independent of the figure's regular MP bank. Each space
 * costs 1 regardless of difficult terrain or friendly-figure pass-
 * through (per MOVE-017). Large figures cannot rotate during the
 * move (per MOVE-020). When the budget is exhausted or the player
 * stops, the budget is discarded — never banked into movementBank.
 *
 * State: game.pendingMoveX[msgId] = { remaining, source, playerNum,
 *                                     figureKey, threadId, dcName }
 *
 * The picker walks 1 space at a time:
 *   1. setupPendingMoveX(...) creates the budget, posts the picker.
 *   2. handleMoveXStep moves the figure 1 space, decrements remaining;
 *      re-posts the picker if remaining > 0, or finishes.
 *   3. handleMoveXDone clears the budget early (player stops).
 *
 * Hostile figures still BLOCK movement (cannot end on a hostile or
 * pass through one). That gate comes from Mobile/Massive on the
 * figure itself, not from Move-X.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { getDcEffects, getMapData, getMapTokensData, getFigureSize } from '../data-loader.js';
import { getFootprintCells, normalizeCoord, edgeKey, shiftCoord } from '../game/coords.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { getPlayerId, opponentPlayerNum } from '../game/player-helpers.js';
import { fetchCombatThread, fetchGameChannel } from '../discord/channel-helpers.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { splitCustomId } from '../discord/custom-id.js';

/**
 * Begin a Move-X effect. Sets pendingMoveX state and posts the picker.
 *
 * @param {object} game
 * @param {object} ctx - { client, logGameAction, saveGames }
 * @param {object} opts
 * @param {string} opts.msgId
 * @param {string} opts.figureKey
 * @param {number} opts.playerNum
 * @param {number} opts.spaces - X (the number of spaces granted)
 * @param {string} opts.source - card name for logs ("Leg Hydraulics", etc.)
 * @param {string} [opts.threadId] - combat thread id, if posting there
 */
export async function setupPendingMoveX(game, ctx, opts) {
  const { msgId, figureKey, playerNum, spaces, source, threadId } = opts;
  if (!msgId || !figureKey || !playerNum || !spaces || spaces <= 0) return;
  game.pendingMoveX = game.pendingMoveX || {};
  game.pendingMoveX[msgId] = {
    remaining: spaces,
    source,
    playerNum,
    figureKey,
    dcName: dcNameFromFigureKey(figureKey),
    threadId: threadId || null,
  };
  await postMoveXPicker(game, ctx, msgId);
  ctx.saveGames?.(game.gameId);
}

export function clearPendingMoveX(game, msgId) {
  if (!game.pendingMoveX) return;
  delete game.pendingMoveX[msgId];
  if (Object.keys(game.pendingMoveX).length === 0) delete game.pendingMoveX;
}

export function isPendingMoveX(game, msgId) {
  return !!game.pendingMoveX?.[msgId];
}

/**
 * Compute the legal 1-space cardinal translations of a figure's
 * footprint. Returns a list of { topLeft, footprintCells } — one entry
 * per legal direction (N/S/E/W).
 *
 * MOVE-020: Large figures cannot rotate during a Move-X effect, so
 * only translations are considered. Validations:
 *   (a) every cell of the new footprint exists on the map.
 *   (b) every "leading" edge between the old footprint and the cells
 *       newly entered must be in the adjacency map and not blocked
 *       by a closed door.
 *   (c) every newly-entered cell must be unoccupied.
 *
 * For 1x1 figures the loop reduces to the obvious 4 neighbors.
 */
function _computeValidNeighbors(game, msgId) {
  const pending = game.pendingMoveX?.[msgId];
  if (!pending) return [];
  const { figureKey, playerNum } = pending;
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return [];
  const mapId = game.selectedMap?.id;
  const ms = mapId ? getMapData(mapId) : null;
  const adjacency = ms?.adjacency || {};
  if (Object.keys(adjacency).length === 0) return [];

  // Door edges closed for movement.
  const allDoors = mapId ? (getMapTokensData()?.[mapId]?.doors || []) : [];
  const opened = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
  const closedDoorEdges = new Set(
    allDoors
      .filter(e => {
        const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase();
        return !opened.has(`${a}|${b}`) && !opened.has(`${b}|${a}`);
      })
      .map(e => edgeKey(e[0], e[1])),
  );

  // Old footprint of the figure (cells it currently occupies).
  const dcName = dcNameFromFigureKey(figureKey);
  const size = game.figureOrientations?.[figureKey] || getFigureSize(dcName) || '1x1';
  const oldCells = getFootprintCells(pos, size).map(c => normalizeCoord(c));
  const oldSet = new Set(oldCells);

  // Set of every cell occupied by other figures (for occupancy filter).
  const occupied = new Set();
  for (const pn of [1, 2]) {
    for (const [otherFk, otherPos] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!otherPos) continue;
      if (otherFk === figureKey) continue;
      const otherDc = dcNameFromFigureKey(otherFk);
      const otherSize = game.figureOrientations?.[otherFk] || getFigureSize(otherDc) || '1x1';
      for (const c of getFootprintCells(otherPos, otherSize)) occupied.add(normalizeCoord(c));
    }
  }

  const candidates = [];
  const directions = [
    { dx: 0, dy: -1 }, // N
    { dx: 0, dy: 1 },  // S
    { dx: 1, dy: 0 },  // E
    { dx: -1, dy: 0 }, // W
  ];
  for (const { dx, dy } of directions) {
    const newTopLeft = normalizeCoord(shiftCoord(pos, dx, dy));
    const newCells = getFootprintCells(newTopLeft, size).map(c => normalizeCoord(c));
    let ok = true;
    // (a) every new cell exists on the map.
    for (const nc of newCells) {
      if (!Object.prototype.hasOwnProperty.call(adjacency, nc)) { ok = false; break; }
    }
    if (!ok) continue;
    // (b) every leading edge — between an old cell and its
    //     same-direction-shifted neighbor that's NOT in old footprint —
    //     must be in adjacency and not closed by a door.
    for (const oc of oldCells) {
      const corresponding = normalizeCoord(shiftCoord(oc, dx, dy));
      if (oldSet.has(corresponding)) continue; // moved into own old cell, no boundary crossed
      // Must be a real adjacency between oc and corresponding.
      const ocAdj = (adjacency[oc] || []).map(normalizeCoord);
      if (!ocAdj.includes(corresponding)) { ok = false; break; }
      if (closedDoorEdges.has(edgeKey(oc, corresponding))) { ok = false; break; }
    }
    if (!ok) continue;
    // (c) newly-entered cells must be unoccupied (own old cells are fine).
    for (const nc of newCells) {
      if (oldSet.has(nc)) continue;
      if (occupied.has(nc)) { ok = false; break; }
    }
    if (!ok) continue;
    candidates.push({ topLeft: newTopLeft, footprintCells: newCells });
  }
  return candidates;
}

/** Render-from-state: post the move-X picker with current valid cells. */
export async function postMoveXPicker(game, ctx, msgId) {
  const pending = game.pendingMoveX?.[msgId];
  if (!pending || pending.remaining <= 0) {
    clearPendingMoveX(game, msgId);
    return;
  }
  const { client, logGameAction } = ctx;
  const candidates = _computeValidNeighbors(game, msgId);
  const ownerId = getPlayerId(game, pending.playerNum);

  if (candidates.length === 0) {
    // No legal destinations — close the budget and tell the player.
    await logGameAction?.(game, client,
      `🦿 **${pending.source}** — **${pending.dcName}** has no legal destinations; remaining ${pending.remaining} space(s) discarded.`,
      { phase: 'ROUND', icon: 'attack' });
    clearPendingMoveX(game, msgId);
    return;
  }

  // Each candidate's button label shows the new top-left of the
  // figure's footprint. For 1x1 that IS the destination cell.
  const stepBtns = candidates.slice(0, 20).map(cand => new ButtonBuilder()
    .setCustomId(`move_x_step_${game.gameId}_${msgId}_${cand.topLeft}`)
    .setLabel(cand.topLeft.toUpperCase())
    .setStyle(ButtonStyle.Primary),
  );
  const doneBtn = new ButtonBuilder()
    .setCustomId(`move_x_done_${game.gameId}_${msgId}`)
    .setLabel('Stop (discard remaining)')
    .setStyle(ButtonStyle.Secondary);

  const rows = chunkButtonsToRows([...stepBtns, doneBtn]).slice(0, 5);
  const content = `<@${ownerId}> 🦿 **${pending.source}** — **${pending.dcName}** has **${pending.remaining}** space(s) remaining. Click an adjacent space to move 1 step:`;
  const opts = { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' };

  // Prefer the combat thread if we have one (after-attack abilities);
  // otherwise post into the game's main channel via logGameAction.
  if (pending.threadId) {
    const thread = await fetchCombatThread(client, pending.threadId);
    if (thread) {
      await thread.send({ content, components: rows, allowedMentions: { users: [ownerId] } }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, opts);
}

/**
 * Step handler — customId: move_x_step_${gameId}_${msgId}_${space}
 * Moves the figure 1 space and decrements remaining.
 */
export async function handleMoveXStep(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // customId fields after prefix `move_x_step_`: gameId, msgId, space (rest).
  const parts = splitCustomId(interaction.customId, 'move_x_step_');
  if (parts.length < 3) return;
  const [gameId, msgId, ...spaceParts] = parts;
  const space = normalizeCoord(spaceParts.join('_'));
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingMoveX?.[msgId];
  if (!pending) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the figure\'s controller can step.')) return;

  // Validate the chosen top-left is still a legal cardinal step for
  // the figure's full footprint (multi-cell aware).
  const candidates = _computeValidNeighbors(game, msgId);
  const match = candidates.find(c => c.topLeft === space);
  if (!match) {
    await interaction.followUp({ content: `Step to ${space.toUpperCase()} is no longer legal.`, ephemeral: true }).catch(discordCatch);
    return;
  }

  // Move the figure (top-left moves; footprint follows because we
  // store top-left in figurePositions and downstream consumers read
  // the size from figureOrientations / dc-effects).
  game.figurePositions = game.figurePositions || {};
  game.figurePositions[pending.playerNum] = game.figurePositions[pending.playerNum] || {};
  game.figurePositions[pending.playerNum][pending.figureKey] = match.topLeft;

  pending.remaining -= 1;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await logGameAction?.(game, client,
    `🦿 **${pending.source}** — **${pending.dcName}** moves to **${match.topLeft.toUpperCase()}** (${pending.remaining} space(s) left).`,
    { phase: 'ROUND', icon: 'attack' });

  if (pending.remaining <= 0) {
    clearPendingMoveX(game, msgId);
    await logGameAction?.(game, client,
      `🦿 **${pending.source}** — **${pending.dcName}** has used all granted spaces.`,
      { phase: 'ROUND', icon: 'attack' });
  } else {
    await postMoveXPicker(game, ctx, msgId);
  }
  saveGames?.(gameId);
}

/**
 * Done handler — customId: move_x_done_${gameId}_${msgId}
 * Player stops early; remaining is discarded (never banked).
 */
export async function handleMoveXDone(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const parts = splitCustomId(interaction.customId, 'move_x_done_');
  if (parts.length < 2) return;
  const [gameId, msgId] = parts;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingMoveX?.[msgId];
  if (!pending) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the figure\'s controller can stop.')) return;

  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const dropped = pending.remaining;
  clearPendingMoveX(game, msgId);
  await logGameAction?.(game, client,
    `🦿 **${pending.source}** — **${pending.dcName}** stops early; ${dropped} space(s) discarded.`,
    { phase: 'ROUND', icon: 'attack' });
  saveGames?.(gameId);
}
