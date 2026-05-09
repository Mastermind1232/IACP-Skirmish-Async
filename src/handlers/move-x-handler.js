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
import { getFootprintCells, normalizeCoord, edgeKey, shiftCoord, rotateSizeString, parseCoord, colRowToCoord } from '../game/coords.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { getReachableSpaces, getMovementKeywords, initMassiveDisplacement, resolveNextDisplacements, getNormalizedFootprint, getMovementProfile, getBoardStateForMovement } from '../game/movement.js';
import { setPendingMassivePush } from '../game/interrupts.js';
import { renderMassivePushSpacePrompt, renderMassivePushFigurePrompt } from './movement.js';
import { getPlayerId, opponentPlayerNum } from '../game/player-helpers.js';
import { fetchCombatThread, fetchGameChannel } from '../discord/channel-helpers.js';
import { chunkButtonsToRows, buildRowPickerButtons } from '../discord/components.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { splitCustomId } from '../discord/custom-id.js';

/**
 * Synchronously stamp pendingMoveX state (no Discord side effects).
 * For sync ability-dispatch paths that can't await the picker post.
 * The caller must follow up with postMoveXPicker to surface the UI.
 */
export function stampPendingMoveX(game, opts) {
  const { msgId, figureKey, playerNum, spaces, source, threadId, bypassCosts } = opts;
  if (!msgId || !figureKey || !playerNum || !spaces || spaces <= 0) return false;
  game.pendingMoveX = game.pendingMoveX || {};
  game.pendingMoveX[msgId] = {
    remaining: spaces,
    source,
    playerNum,
    figureKey,
    dcName: dcNameFromFigureKey(figureKey),
    threadId: threadId || null,
    // bypassCosts: true (default) for Move-X effects per CRR MOVE-017 —
    //   each step consumes 1 budget regardless of terrain/figure cost.
    // bypassCosts: false for regular MP-gain effects (Slippery, Smooth
    //   Landing, etc.) — each step consumes 1 + difficult adder + hostile
    //   adder, honoring the figure's profile (Mobile / Massive / Efficient
    //   Travel keywords still bypass via getMovementProfile flags). The
    //   cost-aware step calculation lands in a follow-up commit; this
    //   field is wired through now so callers can declare intent.
    bypassCosts: bypassCosts !== false,
  };
  return true;
}

/**
 * Begin a Move-X effect end-to-end: stamp state, post the picker,
 * persist. Async wrapper around stampPendingMoveX + postMoveXPicker
 * for callers that already have ctx.client and can await UI.
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
  if (!stampPendingMoveX(game, opts)) return;
  await postMoveXPicker(game, ctx, opts.msgId);
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
 * Finish a Move-X budget: snapshot the deferred continuation (if any),
 * clear pendingMoveX, then trigger the continuation. Used by both
 * "exhausted budget" (handleMoveXStep / Rotate when remaining hits 0)
 * and "stopped early" (handleMoveXDone) paths so chained abilities
 * fire AFTER the picker fully completes — not concurrently.
 */
async function _finishPicker(game, ctx, msgId) {
  const pending = game.pendingMoveX?.[msgId];
  if (!pending) return;
  const nextAction = pending.nextAction || null;
  clearPendingMoveX(game, msgId);
  // Massive end-of-movement displacement: if the moving figure has
  // the MASSIVE keyword and its final footprint overlaps any other
  // figure, route those overlapping figures through the existing
  // pendingMassivePush flow.
  if (_isMovingFigureMassive(game, pending.figureKey)) {
    await _runMassiveDisplacement(game, ctx, pending);
  }
  // Multi-figure MP-gain orchestration: if a sequence is active and
  // this figure was the current one, mark it complete and advance
  // (post the next order-pick if more figures remain, else clear).
  if (game.pendingMoveXSequence && game.pendingMoveXSequence.currentMsgId === msgId) {
    await _advanceMoveXSequence(game, ctx);
  }
  if (!nextAction) return;
  if (nextAction.type === 'rollOneDieSpacePick') {
    await _runRollOneDieSpacePickContinuation(game, ctx, msgId, pending, nextAction);
  }
  // Future continuation types plug in here.
}

// ── Multi-figure MP-gain sequencing ──────────────────────────────────
//
// Some effects grant MP to multiple figures at once (Smooth Landing:
// Bodhi + each adjacent friendly; Strike Team: Cassian + chosen
// adjacent friendly; etc.). Per the gain-MP rules audit, the MP must
// be spent immediately by each figure in turn — and the player must
// be prompted to choose the ORDER, since earlier figures may move
// out of the way / into spaces that change what later figures can do.
//
// State: game.pendingMoveXSequence = {
//   gameId, source, threadId,
//   queue: [{ msgId, figureKey, playerNum, spaces, dcName }, ...],
//   completed: [figureKey, ...],
//   currentMsgId: string | null,  // the figure currently in their picker
// }

/**
 * Begin a multi-figure MP-gain sequence. Posts the order-pick prompt;
 * the player chooses which figure goes first, that figure's picker
 * runs to completion, then the prompt re-posts with remaining
 * figures, and so on.
 */
export async function setupPendingMoveXSequence(game, ctx, opts) {
  const { figures, source, threadId, bypassCosts, afterAction } = opts;
  if (!Array.isArray(figures) || figures.length === 0) return;
  game.pendingMoveXSequence = {
    gameId: game.gameId,
    source,
    threadId: threadId || null,
    queue: figures.map(f => ({ ...f })),
    completed: [],
    currentMsgId: null,
    bypassCosts: bypassCosts !== false,
    // afterAction: typed continuation that fires once the queue is
    // fully drained (every figure's picker has resolved). Currently
    // supported types:
    //   { type: 'postDeployAdvance' } — calls advancePostDeployQueue
    //     so the post-deploy ability queue advances to the next ability.
    afterAction: afterAction || null,
  };
  await _postSequenceOrderPicker(game, ctx);
  ctx.saveGames?.(game.gameId);
}

async function _postSequenceOrderPicker(game, ctx) {
  const seq = game.pendingMoveXSequence;
  if (!seq || seq.queue.length === 0) {
    delete game.pendingMoveXSequence;
    return;
  }
  if (seq.queue.length === 1) {
    // Only one figure left — auto-pick, no prompt.
    const f = seq.queue[0];
    seq.currentMsgId = f.msgId;
    await setupPendingMoveX(game, ctx, {
      msgId: f.msgId, figureKey: f.figureKey, playerNum: f.playerNum,
      spaces: f.spaces, source: seq.source, threadId: seq.threadId,
      bypassCosts: seq.bypassCosts,
    });
    return;
  }
  const { client, logGameAction } = ctx;
  const ownerPN = seq.queue[0].playerNum; // sequence is single-player
  const ownerId = getPlayerId(game, ownerPN);
  const btns = seq.queue.slice(0, 20).map(f => new ButtonBuilder()
    .setCustomId(`move_x_seq_pick_${game.gameId}_${f.figureKey}`)
    .setLabel(`${f.dcName || dcNameFromFigureKey(f.figureKey)} (${f.spaces} sp)`.slice(0, 80))
    .setStyle(ButtonStyle.Primary));
  const rows = chunkButtonsToRows(btns).slice(0, 5);
  const content = `<@${ownerId}> 🦿 **${seq.source}** — ${seq.queue.length} figure(s) remaining. Pick which figure resolves next:`;
  if (seq.threadId) {
    const thread = await fetchCombatThread(client, seq.threadId);
    if (thread) {
      await thread.send({ content, components: rows, allowedMentions: { users: [ownerId] } }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
}

async function _advanceMoveXSequence(game, ctx) {
  const seq = game.pendingMoveXSequence;
  if (!seq) return;
  // Mark current as completed, drop from queue.
  if (seq.currentMsgId) {
    seq.queue = seq.queue.filter(f => f.msgId !== seq.currentMsgId);
    seq.completed.push(seq.currentMsgId);
    seq.currentMsgId = null;
  }
  if (seq.queue.length === 0) {
    const afterAction = seq.afterAction || null;
    delete game.pendingMoveXSequence;
    ctx.saveGames?.(game.gameId);
    // Dispatch sequence-completion continuation, if any.
    if (afterAction) {
      await _runSequenceAfterAction(game, ctx, afterAction);
    }
    return;
  }
  await _postSequenceOrderPicker(game, ctx);
  ctx.saveGames?.(game.gameId);
}

/**
 * Dispatch the post-sequence continuation. New types plug in here.
 * Imports the post-deploy advance lazily to avoid a cycle.
 */
async function _runSequenceAfterAction(game, ctx, afterAction) {
  if (!afterAction || !afterAction.type) return;
  if (afterAction.type === 'postDeployAdvance') {
    try {
      const { advancePostDeployQueue } = await import('./post-deploy.js');
      await advancePostDeployQueue(game, game.gameId, ctx.client, ctx);
    } catch (err) {
      console.error('[move-x] postDeployAdvance failed:', err?.message ?? err);
    }
    return;
  }
  // Unknown type — log and drop.
  console.warn(`[move-x] unknown sequence afterAction type "${afterAction.type}"; dropping`);
}

/** Order-pick handler — customId: move_x_seq_pick_${gameId}_${figureKey}
 *  Player picks which figure resolves their MP gain next. */
export async function handleMoveXSeqPick(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const parts = splitCustomId(interaction.customId, 'move_x_seq_pick_');
  if (parts.length < 2) return;
  const [gameId, ...fkParts] = parts;
  const figureKey = fkParts.join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const seq = game.pendingMoveXSequence;
  if (!seq) return;
  const entry = seq.queue.find(f => f.figureKey === figureKey);
  if (!entry) {
    await interaction.followUp({ content: 'That figure is no longer in the sequence.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, entry.playerNum, canActAsPlayer, 'Only the owning player can choose order.')) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  seq.currentMsgId = entry.msgId;
  await setupPendingMoveX(game, ctx, {
    msgId: entry.msgId, figureKey: entry.figureKey, playerNum: entry.playerNum,
    spaces: entry.spaces, source: seq.source, threadId: seq.threadId,
  });
  saveGames?.(gameId);
}

/**
 * Massive end-of-movement displacement. Computes the moving figure's
 * current footprint, calls initMassiveDisplacement to gather overlaps,
 * iteratively resolves auto cases (0/1 valid space), and stashes
 * pendingMassivePush + posts the existing space picker if any
 * displaced figure has 2+ valid spaces (needs a controller choice).
 */
async function _runMassiveDisplacement(game, ctx, pending) {
  const { client, logGameAction } = ctx;
  const pos = game.figurePositions?.[pending.playerNum]?.[pending.figureKey];
  if (!pos) return;
  const dcName = dcNameFromFigureKey(pending.figureKey);
  const size = game.figureOrientations?.[pending.figureKey] || getFigureSize(dcName) || '1x1';
  const footprintSet = new Set(getNormalizedFootprint(pos, size));
  const dispPending = initMassiveDisplacement(game, pending.playerNum, pending.figureKey, footprintSet);
  if (!dispPending) return;
  const result = resolveNextDisplacements(game, dispPending);
  for (const r of result.autoResolved) {
    const from = r.prevPos ? String(r.prevPos).toUpperCase() : '?';
    const to = r.newPos ? String(r.newPos).toUpperCase() : '?';
    const suffix = r.bfs ? ' (no adjacent spaces)' : '';
    await logGameAction?.(game, client,
      `**${r.entry.dcName}** displaced **${from}** → **${to}** by **${pending.dcName}**${suffix}.`,
      { icon: 'move', phase: 'ROUND' });
  }
  if (result.done) return;
  // Interactive resolution remains — store pending state and post
  // the figure/space picker. handleMassivePushFigure /
  // handleMassivePushSpace pick up the customId clicks and continue
  // iterating resolveNextDisplacements until done.
  setPendingMassivePush(game, { ...dispPending, gameId: game.gameId });
  const pendingMpush = game.pendingMassivePush;
  if (result.needsFigurePick) {
    pendingMpush._currentControllerPlayerNum = result.needsFigurePick.controllerPlayerNum;
    pendingMpush._currentPickable = result.needsFigurePick.pickable.map(e => ({
      figureKey: e.figureKey, dcName: e.dcName, playerNum: e.playerNum,
    }));
    pendingMpush._currentValidSpaces = null;
    await renderMassivePushFigurePrompt(game, client);
  } else if (result.needsChoice) {
    pendingMpush._currentControllerPlayerNum = result.needsChoice.controllerPlayerNum;
    pendingMpush._currentValidSpaces = result.needsChoice.validSpaces;
    await renderMassivePushSpacePrompt(game, client);
  }
}

/**
 * Continuation for the rollOneDie + freeMoveBonus chain (Mortar
 * Launcher and friends). Recomputes the valid target spaces from
 * the figure's NEW position, sets up pendingPounceSpaceChoice +
 * pendingSpacePick, and posts the row picker via the figure's
 * combat thread (or the game-log channel as fallback).
 */
async function _runRollOneDieSpacePickContinuation(game, ctx, msgId, pending, next) {
  const { client, logGameAction } = ctx;
  const figurePos = game.figurePositions?.[pending.playerNum]?.[pending.figureKey];
  if (!figurePos) return;
  const mapId = game.selectedMap?.id;
  const ms = mapId ? getMapData(mapId) : null;
  if (!ms) return;
  // Build occupiedSet (every cell occupied by any figure other than
  // the activating figure — the figure may target its own space).
  const occupied = new Set();
  for (const pn of [1, 2]) {
    for (const [otherFk, otherPos] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!otherPos || otherFk === pending.figureKey) continue;
      const otherDc = dcNameFromFigureKey(otherFk);
      const otherSize = game.figureOrientations?.[otherFk] || getFigureSize(otherDc) || '1x1';
      for (const c of getFootprintCells(otherPos, otherSize)) occupied.add(normalizeCoord(c));
    }
  }
  const reachable = getReachableSpaces(figurePos, next.range, ms, [...occupied]);
  const validSet = new Set([String(figurePos).toLowerCase(), ...reachable.map(s => String(s).toLowerCase())]);
  const validSpaces = [...validSet];
  if (validSpaces.length === 0) {
    await logGameAction?.(game, client,
      `**${next.label}** — No valid target spaces from current position; effect skipped.`,
      { phase: 'ROUND', icon: 'attack' });
    return;
  }
  // Set up pendingPounceSpaceChoice + pendingSpacePick state for the
  // existing space-row pick handler.
  game.pendingPounceSpaceChoice = game.pendingPounceSpaceChoice || {};
  game.pendingPounceSpaceChoice[msgId] = {
    gameId: game.gameId,
    playerNum: pending.playerNum,
    figureIndex: next.figureIndex,
    msgId,
    abilityId: next.abilityId,
    specialIdx: next.specialIdx,
    validSpaces,
    targetFigureKey: null,
  };
  const pounceContextKey = `${game.gameId}_${msgId}_${next.figureIndex}`;
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[pounceContextKey] = {
    validSpaces,
    cellPrefix: `pounce_space_${game.gameId}_${msgId}_${next.figureIndex}_`,
    mapSpaces: ms,
    headerText: next.spaceChoiceLabel,
  };
  const { rows: rowBtns } = buildRowPickerButtons(validSpaces, `space_row_${pounceContextKey}_`);
  const content = `${next.spaceChoiceLabel}\nChoose a row:`;
  if (pending.threadId) {
    const thread = await fetchCombatThread(client, pending.threadId);
    if (thread) {
      await thread.send({ content, components: rowBtns.slice(0, 5) }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, { components: rowBtns.slice(0, 5), phase: 'ROUND', icon: 'attack' });
}

/**
 * Compute the legal 1-space cardinal translations of a figure's
 * footprint. Returns a list of { topLeft, footprintCells, passThrough }
 * — one entry per legal direction (N/S/E/W).
 *
 * MOVE-020: Large figures cannot rotate during a Move-X effect, so
 * only translations are considered.
 *
 * Occupancy semantics (per IA / destruct ruling): MOVE-017 says
 * "Move X spaces" ignores extra MP for both friendly AND hostile
 * figures, so during a Move-X step ANY occupied cell can be passed
 * through. The only restriction is the FINAL stopping cell — it
 * must be unoccupied for non-Massive figures (Massive figures can
 * end on an occupied cell via the existing displacement flow,
 * TODO).
 *
 * A candidate whose newly-entered cells overlap any other figure is
 * therefore flagged `passThrough: true`. Pass-through is only a
 * legal choice when remaining > 1 (so the figure can step out
 * before its final stop). That gate is enforced at picker-render
 * time.
 *
 * Other validations:
 *   (a) every cell of the new footprint exists on the map.
 *   (b) every "leading" edge between the old footprint and the cells
 *       newly entered must be in adjacency and not blocked by a
 *       closed door.
 */
function _computeOccupancy(game, movingFigureKey) {
  const occupied = new Set();
  for (const pn of [1, 2]) {
    for (const [otherFk, otherPos] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!otherPos || otherFk === movingFigureKey) continue;
      const otherDc = dcNameFromFigureKey(otherFk);
      const otherSize = game.figureOrientations?.[otherFk] || getFigureSize(otherDc) || '1x1';
      for (const c of getFootprintCells(otherPos, otherSize)) occupied.add(normalizeCoord(c));
    }
  }
  return occupied;
}

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

  const dcName = dcNameFromFigureKey(figureKey);
  const size = game.figureOrientations?.[figureKey] || getFigureSize(dcName) || '1x1';
  const oldCells = getFootprintCells(pos, size).map(c => normalizeCoord(c));
  const oldSet = new Set(oldCells);
  const occupied = _computeOccupancy(game, figureKey);

  // Cost mode: bypassCosts=true (Move-X effects per MOVE-017) → every
  // step costs 1; bypassCosts=false (regular MP gain — Slippery,
  // Smooth Landing, etc.) → 1 + (entering difficult ? +1 : 0) +
  // (entering hostile ? +1 : 0), with the figure's profile flags
  // (Mobile/Massive/Efficient Travel/Survivalist) overriding the
  // adders via getMovementProfile.
  const bypassCosts = pending.bypassCosts !== false;
  let profile = null;
  let board = null;
  if (!bypassCosts) {
    try {
      profile = getMovementProfile(dcName, figureKey, game);
      board = getBoardStateForMovement(game, figureKey);
    } catch { /* fall back to bypass if profile fails */ }
  }
  const _stepCostFor = (newCells) => {
    if (bypassCosts || !profile || !board) return 1;
    const entering = newCells.filter(c => !oldSet.has(c));
    if (entering.length === 0) return 1;
    let cost = 1;
    const enteringDifficult = !profile.ignoreDifficult &&
      entering.some(c => (board.terrain?.[c] || 'normal') === 'difficult');
    if (enteringDifficult) cost += 1;
    if (!profile.ignoreFigureCost) {
      const hostileSet = board.hostileOccupiedSet || board.occupiedSet;
      if (hostileSet && entering.some(c => hostileSet.has(c))) cost += 1;
    }
    return cost;
  };

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
    // (b) every leading edge between old footprint and newly-entered
    //     cells must be in adjacency and not closed by a door.
    for (const oc of oldCells) {
      const corresponding = normalizeCoord(shiftCoord(oc, dx, dy));
      if (oldSet.has(corresponding)) continue; // own old cell — no edge crossed
      const ocAdj = (adjacency[oc] || []).map(normalizeCoord);
      if (!ocAdj.includes(corresponding)) { ok = false; break; }
      if (closedDoorEdges.has(edgeKey(oc, corresponding))) { ok = false; break; }
    }
    if (!ok) continue;
    // (c) MOVE-017: any occupied cell (friendly OR hostile) is
    //     pass-through during a Move-X step. The figure can step
    //     onto it but cannot STOP there — pass-through gating
    //     happens at picker-render time (refused when remaining=1).
    let passThrough = false;
    for (const nc of newCells) {
      if (oldSet.has(nc)) continue;
      if (occupied.has(nc)) { passThrough = true; break; }
    }
    const stepCost = _stepCostFor(newCells);
    if (stepCost > pending.remaining) continue; // can't afford this step
    candidates.push({ kind: 'translate', topLeft: newTopLeft, footprintCells: newCells, passThrough, stepCost });
  }

  // Rotation candidates (Large/Massive figures). MOVE-020: rotation
  // is allowed during Move-X (no-rotate applies to Push only). Each
  // candidate is keyed by (pivotCell, direction): the chosen pivot
  // cell stays at its current world coordinate, the rest of the
  // footprint rotates 90° around it.
  const isLarge = String(size).split('x').some(n => Number(n) > 1);
  if (isLarge) {
    const rotatedSize = rotateSizeString(size);
    for (const pivotCell of oldCells) {
      const pc = parseCoord(pivotCell);
      for (const direction of ['CW', 'CCW']) {
        // Compute rotated footprint cells: rotate each old offset 90°
        // around the pivot.
        const rotated = oldCells.map(c => {
          const cell = parseCoord(c);
          const dx = cell.col - pc.col;
          const dy = cell.row - pc.row;
          const ndx = direction === 'CW' ? -dy : dy;
          const ndy = direction === 'CW' ? dx : -dx;
          return normalizeCoord(colRowToCoord(pc.col + ndx, pc.row + ndy));
        });
        // Compute the new top-left for figurePositions storage:
        // min(col), min(row) of the rotated cells.
        let minCol = Infinity, minRow = Infinity;
        for (const r of rotated) {
          const p = parseCoord(r);
          if (p.col < minCol) minCol = p.col;
          if (p.row < minRow) minRow = p.row;
        }
        if (!Number.isFinite(minCol) || !Number.isFinite(minRow) || minCol < 0 || minRow < 0) continue;
        const newTopLeft = normalizeCoord(colRowToCoord(minCol, minRow));
        const newCells = rotated;
        // Validate: every new cell on the map.
        let ok = true;
        for (const nc of newCells) {
          if (!Object.prototype.hasOwnProperty.call(adjacency, nc)) { ok = false; break; }
        }
        if (!ok) continue;
        // Passthrough = newly-entered cells overlap any other figure.
        let passThrough = false;
        for (const nc of newCells) {
          if (oldSet.has(nc)) continue;
          if (occupied.has(nc)) { passThrough = true; break; }
        }
        // De-dupe identical rotations (square footprints can produce
        // duplicate (pivot, dir) outcomes).
        const sig = newCells.slice().sort().join(',');
        if (candidates.some(c => c.kind === 'rotate' && c.signature === sig)) continue;
        const stepCost = _stepCostFor(newCells);
        if (stepCost > pending.remaining) continue;
        candidates.push({
          kind: 'rotate',
          topLeft: newTopLeft,
          footprintCells: newCells,
          passThrough,
          rotatedSize,
          pivotCell,
          direction,
          stepCost,
          signature: sig,
        });
      }
    }
  }

  return candidates;
}

/** True when the moving figure has the MASSIVE keyword. Massive
 *  figures can end movement on an occupied cell — the occupants are
 *  displaced via the existing pendingMassivePush flow. */
function _isMovingFigureMassive(game, figureKey) {
  if (!figureKey) return false;
  const dcName = dcNameFromFigureKey(figureKey);
  const keywords = getMovementKeywords(dcName, game);
  return keywords?.has?.('massive') === true;
}

/** True when the moving figure currently overlaps another figure
 *  (i.e., is mid-pass-through and must keep moving before stopping).
 *  Massive figures are exempt — they can stop wherever and the
 *  displacement flow resolves the overlaps. */
function _isCurrentlyOverlapping(game, msgId) {
  const pending = game.pendingMoveX?.[msgId];
  if (!pending) return false;
  const { figureKey, playerNum } = pending;
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return false;
  const dcName = dcNameFromFigureKey(figureKey);
  const size = game.figureOrientations?.[figureKey] || getFigureSize(dcName) || '1x1';
  const cells = getFootprintCells(pos, size).map(c => normalizeCoord(c));
  const occupied = _computeOccupancy(game, figureKey);
  for (const c of cells) {
    if (occupied.has(c)) return true;
  }
  return false;
}

/** Render-from-state: post the move-X picker with current valid cells. */
export async function postMoveXPicker(game, ctx, msgId) {
  const pending = game.pendingMoveX?.[msgId];
  if (!pending || pending.remaining <= 0) {
    clearPendingMoveX(game, msgId);
    return;
  }
  const { client, logGameAction } = ctx;
  const allCandidates = _computeValidNeighbors(game, msgId);
  const isMassive = _isMovingFigureMassive(game, pending.figureKey);
  // Massive figures can end on occupied cells (displacement runs in
  // _finishPicker). They're never "stuck" mid-pass-through, so the
  // overlap gate doesn't apply and the Done button is always offered.
  const overlapping = !isMassive && _isCurrentlyOverlapping(game, msgId);
  const ownerId = getPlayerId(game, pending.playerNum);

  // Pass-through filter: if the figure has more budget than this
  // step's cost, both clean and pass-through candidates are legal
  // (the figure can step out next click). If remaining === stepCost,
  // only clean candidates are legal — that step is the figure's
  // final stop. Massive figures can end on an occupied cell
  // (displacement at finish), so pass-through remains legal.
  const candidates = isMassive
    ? allCandidates
    : allCandidates.filter(c => !c.passThrough || pending.remaining > (c.stepCost ?? 1));

  if (candidates.length === 0) {
    // No legal destinations — close the budget and tell the player.
    // (If the figure is mid-pass-through and stuck, this leaves them
    // overlapping a friendly; manual resolution may be required.)
    await logGameAction?.(game, client,
      `🦿 **${pending.source}** — **${pending.dcName}** has no legal destinations; remaining ${pending.remaining} space(s) discarded.`,
      { phase: 'ROUND', icon: 'attack' });
    clearPendingMoveX(game, msgId);
    return;
  }

  const _costSuffix = (cand) => (cand.stepCost && cand.stepCost > 1) ? ` [${cand.stepCost} MP]` : '';
  const stepBtns = candidates.slice(0, 20).map(cand => {
    if (cand.kind === 'rotate') {
      const dirArrow = cand.direction === 'CW' ? '↻' : '↺';
      const ptSuffix = cand.passThrough ? ' (pass-through)' : '';
      const label = `Rotate ${dirArrow} pivot ${cand.pivotCell.toUpperCase()}${_costSuffix(cand)}${ptSuffix}`;
      return new ButtonBuilder()
        .setCustomId(`move_x_rotate_${game.gameId}_${msgId}_${cand.pivotCell}_${cand.direction}`)
        .setLabel(label.slice(0, 80))
        .setStyle(ButtonStyle.Success);
    }
    const ptSuffix = cand.passThrough ? ' (pass-through)' : '';
    return new ButtonBuilder()
      .setCustomId(`move_x_step_${game.gameId}_${msgId}_${cand.topLeft}`)
      .setLabel(`${cand.topLeft.toUpperCase()}${_costSuffix(cand)}${ptSuffix}`.slice(0, 80))
      .setStyle(cand.passThrough ? ButtonStyle.Secondary : ButtonStyle.Primary);
  });
  // Done button is hidden while the figure is overlapping another
  // figure — must move out before stopping.
  const buttons = [...stepBtns];
  if (!overlapping) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`move_x_done_${game.gameId}_${msgId}`)
      .setLabel('Stop (discard remaining)')
      .setStyle(ButtonStyle.Secondary));
  }

  const rows = chunkButtonsToRows(buttons).slice(0, 5);
  const overlapNote = overlapping ? ' — **must keep moving** (currently overlapping another figure)' : '';
  const unitLabel = pending.bypassCosts === false ? 'MP' : 'space(s)';
  const content = `<@${ownerId}> 🦿 **${pending.source}** — **${pending.dcName}** has **${pending.remaining}** ${unitLabel} remaining${overlapNote}. Click an adjacent space to move 1 step:`;
  const opts = { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' };

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

  // Validate the chosen top-left is still a legal cardinal translation
  // for the figure's full footprint (multi-cell aware). Translations
  // and rotations are different button prefixes; this handler only
  // serves translations (kind === 'translate').
  const candidates = _computeValidNeighbors(game, msgId);
  const match = candidates.find(c => c.kind === 'translate' && c.topLeft === space);
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

  const cost = match.stepCost ?? 1;
  pending.remaining = Math.max(0, pending.remaining - cost);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const costNote = cost > 1 ? ` (cost ${cost} MP)` : '';
  await logGameAction?.(game, client,
    `🦿 **${pending.source}** — **${pending.dcName}** moves to **${match.topLeft.toUpperCase()}**${costNote} (${pending.remaining} left).`,
    { phase: 'ROUND', icon: 'attack' });

  if (pending.remaining <= 0) {
    await logGameAction?.(game, client,
      `🦿 **${pending.source}** — **${pending.dcName}** has used all granted MP.`,
      { phase: 'ROUND', icon: 'attack' });
    await _finishPicker(game, ctx, msgId);
  } else {
    await postMoveXPicker(game, ctx, msgId);
  }
  saveGames?.(gameId);
}

/**
 * Rotate handler — customId: move_x_rotate_${gameId}_${msgId}_${pivotCell}_${direction}
 * Rotates the figure 90° about the pivot cell, costs 1 space.
 * Move-X allows rotation per CRR MOVE-020 (the no-rotate restriction
 * applies to Push only).
 */
export async function handleMoveXRotate(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const parts = splitCustomId(interaction.customId, 'move_x_rotate_');
  if (parts.length < 4) return;
  const gameId = parts[0];
  const msgId = parts[1];
  const direction = parts[parts.length - 1];
  const pivotCell = normalizeCoord(parts.slice(2, -1).join('_'));
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingMoveX?.[msgId];
  if (!pending) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the figure\'s controller can rotate.')) return;

  const candidates = _computeValidNeighbors(game, msgId);
  const match = candidates.find(c => c.kind === 'rotate' && c.pivotCell === pivotCell && c.direction === direction);
  if (!match) {
    await interaction.followUp({ content: `Rotation about ${pivotCell.toUpperCase()} (${direction}) is no longer legal.`, ephemeral: true }).catch(discordCatch);
    return;
  }

  // Apply rotation: update figurePositions top-left and figureOrientations size.
  game.figurePositions = game.figurePositions || {};
  game.figurePositions[pending.playerNum] = game.figurePositions[pending.playerNum] || {};
  game.figurePositions[pending.playerNum][pending.figureKey] = match.topLeft;
  game.figureOrientations = game.figureOrientations || {};
  game.figureOrientations[pending.figureKey] = match.rotatedSize;

  const cost = match.stepCost ?? 1;
  pending.remaining = Math.max(0, pending.remaining - cost);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const dirArrow = direction === 'CW' ? '↻' : '↺';
  const costNote = cost > 1 ? ` (cost ${cost} MP)` : '';
  await logGameAction?.(game, client,
    `🦿 **${pending.source}** — **${pending.dcName}** rotates ${dirArrow} about **${pivotCell.toUpperCase()}**${costNote} (${pending.remaining} left).`,
    { phase: 'ROUND', icon: 'attack' });

  if (pending.remaining <= 0) {
    await logGameAction?.(game, client,
      `🦿 **${pending.source}** — **${pending.dcName}** has used all granted MP.`,
      { phase: 'ROUND', icon: 'attack' });
    await _finishPicker(game, ctx, msgId);
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
  await logGameAction?.(game, client,
    `🦿 **${pending.source}** — **${pending.dcName}** stops early; ${dropped} space(s) discarded.`,
    { phase: 'ROUND', icon: 'attack' });
  await _finishPicker(game, ctx, msgId);
  saveGames?.(gameId);
}
