/**
 * Movement handlers: move_mp_, move_adjust_mp_, move_pick_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { applyStrain } from './strain-handler.js';
import { buildRowPickerButtons, cleanupSpacePick } from '../discord/components.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getDcEffects, getMapData } from '../data-loader.js';
import { bottomLeftCoord, getFootprintCells, normalizeCoord, parseSizeString } from '../game/coords.js';
import { reduceHp, dcNameFromFigureKey, getMaxPowerTokens, grantPowerTokens } from '../game/index.js';
import { markMapDirty, setFigureMp } from '../game/game-helpers.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { areConditionEffectsSuppressed } from '../game/conditions.js';
import { getDcList, getDcMessageIds, getPlayerId, opponentPlayerNum } from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { detectPostMoveInterrupts } from '../game/movement-interrupts.js';
import { getImmediateStepSpaces } from '../game/movement.js';
import { isForcedStepByStep } from '../game/forced-step-movement.js';
import { applyHopOnPush } from '../game/hop-on.js';
import { detectAttachedTrigger, applyDioFollow } from '../game/attached-dio-helpers.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { setPendingRushPush, setPendingShoulderRush, setPendingMassivePush, clearPendingMassivePush, setPendingDioFollow, clearPendingDioFollow } from '../game/interrupts.js';
import { exhaustAttachment } from '../game/card-state-helpers.js';

const BTM_PER_MSG = 5;
const SPACE_ROWS_ON_FIRST = 4;

/**
 * Toggle button descriptor for the two movement modes (alexanbv 2026-06-19):
 *  - default (stepByStep=false): auto A→B path that avoids enemy-adjacent spaces
 *  - stepByStep=true: move one space at a time (immediate neighbours only)
 * The label shows the mode you can switch TO.
 */
function _stepModeToggleBtn(msgId, figureIndex, stepByStep) {
  return {
    customId: `move_stepmode_${msgId}_${figureIndex}`,
    label: stepByStep ? '🎯 Auto (A→B)' : '👣 Step-by-step',
    style: ButtonStyle.Secondary,
  };
}

/** Clean up all movement-related state flags for a completed/cancelled move. */
function _cleanupMoveState(game, moveKey, msgId) {
  delete game.moveInProgress[moveKey];
  // Per alexanbv 2026-05-12: the paired pendingSpacePick entry must
  // clear here too. Move grids register a pick at
  // `${gameId}_${moveKey}` (see lines that set
  // game.pendingSpacePick[moveContextKey]). Previously only
  // moveInProgress was dropped — leaving the pendingSpacePick entry
  // stuck so isActivationActionInProgress kept reporting true after
  // End Movement, blocking End Activation with an unspent bank.
  if (game.gameId && game.pendingSpacePick) {
    const ctxKey = `${game.gameId}_${moveKey}`;
    if (game.pendingSpacePick[ctxKey]) delete game.pendingSpacePick[ctxKey];
  }
  if (game.mobileMovementActive?.[figureKey]) delete game.mobileMovementActive[figureKey];
  if (game.urgencyMustSpendAll?.[msgId]) delete game.urgencyMustSpendAll[msgId];
}

/**
 * Discard any open move-grid state for a DC msgId. Called by
 * handleDcEndActivation per alexanbv 2026-05-12 — unspent MP must not
 * block End Activation. Drops moveInProgress entries for this msgId,
 * the matching pendingSpacePick entries (move grids use a context key
 * of `${gameId}_${msgId}_${figureIndex}` so we delete it alongside the
 * moveInProgress entry, guaranteeing we only remove move-grid picks
 * and not other ability picks that happen to share the schema), and
 * the activation movement bank. The stale grid buttons remain in
 * Discord — cleanup is best-effort if a channel is reachable.
 */
export function discardOpenMoveGrids(game, msgId) {
  if (!game || !msgId) return;
  const prefix = `${msgId}_`;
  if (game.moveInProgress) {
    for (const moveKey of Object.keys(game.moveInProgress)) {
      if (!moveKey.startsWith(prefix)) continue;
      const ctxKey = `${game.gameId}_${moveKey}`;
      if (game.pendingSpacePick?.[ctxKey]) delete game.pendingSpacePick[ctxKey];
      _cleanupMoveState(game, moveKey, msgId);
    }
  }
  // Belt-and-suspenders: even when moveInProgress is already gone (e.g.
  // a prior cleanup path that didn't sync pendingSpacePick), drop any
  // pendingSpacePick entries that are movement picks for this msgId.
  // Movement picks are identified by cellPrefix starting with
  // 'move_pick_' (set at the 4 register sites in movement.js +
  // dc-play-area.js). The msgId is encoded in that cellPrefix, so the
  // marker also tells us the entry belongs to this msgId — disambiguates
  // safely from other ability picks that share the key schema (pounce,
  // p2, etc.).
  if (game.pendingSpacePick) {
    const cellMarker = `move_pick_${msgId}_`;
    for (const ctxKey of Object.keys(game.pendingSpacePick)) {
      const entry = game.pendingSpacePick[ctxKey];
      if (entry?.cellPrefix && entry.cellPrefix.startsWith(cellMarker)) {
        delete game.pendingSpacePick[ctxKey];
      }
    }
  }
  if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
}

/**
 * Show space picker buttons for a massive-push displaced figure.
 * Stores controller + validSpaces on pending, then delegates rendering to
 * renderMassivePushSpacePrompt so the reconciler can re-post from state alone.
 * @param {object} choice - { entry, validSpaces, controllerPlayerNum } from resolveNextDisplacements
 */
async function _showMassivePushPicker(game, choice, interaction, client, logGameAction, buildBoardMapPayload, saveGames) {
  const pending = game.pendingMassivePush;
  if (!pending || !choice) { clearPendingMassivePush(game); return; }
  const { validSpaces, controllerPlayerNum } = choice;
  pending._currentControllerPlayerNum = controllerPlayerNum;
  pending._currentValidSpaces = validSpaces;
  await renderMassivePushSpacePrompt(game, client, { fallbackChannel: interaction?.channel });
  if (saveGames) saveGames(game.gameId);
}

/**
 * Show figure-order picker: when 2+ displaced figures remain in the active phase,
 * the controller chooses which one to place next. Figures are encoded by index
 * into pending._currentPickable (figure keys can contain spaces / dashes and
 * don't round-trip cleanly through a customId).
 * Delegates rendering to renderMassivePushFigurePrompt.
 * @param {object} figurePick - { pickable, controllerPlayerNum } from resolveNextDisplacements
 */
async function _showMassivePushFigurePicker(game, figurePick, interaction, client, saveGames) {
  const pending = game.pendingMassivePush;
  if (!pending || !figurePick) { clearPendingMassivePush(game); return; }
  const { pickable, controllerPlayerNum } = figurePick;
  pending._currentControllerPlayerNum = controllerPlayerNum;
  pending._currentPickable = pickable.map((e) => ({
    figureKey: e.figureKey,
    dcName: e.dcName,
    playerNum: e.playerNum,
  }));
  pending._currentValidSpaces = null;
  await renderMassivePushFigurePrompt(game, client, { fallbackChannel: interaction?.channel });
  if (saveGames) saveGames(game.gameId);
}

/**
 * Render-from-state: post the massive-push space picker using only game state
 * and client. Used by _showMassivePushPicker (after it caches
 * _currentValidSpaces on pending) and by the prompt reconciler on refresh.
 * Records the resulting msg into game.promptMessageIds.massivePushSpace.
 */
export async function renderMassivePushSpacePrompt(game, client, opts = {}) {
  const pending = game.pendingMassivePush;
  if (!pending) return;
  const validSpaces = pending._currentValidSpaces || [];
  if (validSpaces.length === 0) return;
  const queue = pending.phase === 'friendly' ? pending.friendlyQueue : pending.enemyQueue;
  const entry = queue?.[pending.currentIndex];
  if (!entry) return;
  const prevPos = game.figurePositions?.[entry.playerNum]?.[entry.figureKey];
  const btns = validSpaces.map((space) =>
    new ButtonBuilder()
      .setCustomId(`massive_push_space_${pending.gameId}_${space}`)
      .setLabel(String(space).toUpperCase())
      .setStyle(ButtonStyle.Primary)
  );
  const rows = [];
  while (btns.length > 0) rows.push(new ActionRowBuilder().addComponents(btns.splice(0, 5)));
  const from = prevPos ? String(prevPos).toUpperCase() : '?';
  const controllerTag = pending.phase === 'friendly' ? 'your figure' : 'opponent\'s figure';
  // Per alexanbv 2026-05-12: fall through threadId → opts fallback
  // → game.generalId so the prompt always lands somewhere (post-deploy
  // MASSIVE pushes have empty dcActionsData and silently dropped pre-fix).
  const threadId = game.dcActionsData ? Object.values(game.dcActionsData).find((d) => d.threadId)?.threadId : null;
  let channel = threadId ? await fetchGameChannel(client, threadId) : null;
  if (!channel && opts.fallbackChannel) channel = opts.fallbackChannel;
  if (!channel && game.generalId) channel = await fetchGameChannel(client, game.generalId);
  if (!channel) return;
  const sent = await channel.send({
    content: `**Massive Displacement** — Place **${entry.dcName}** (${controllerTag}, currently at **${from}**) to which space?`,
    components: rows.slice(0, 5),
  }).catch(discordCatch);
  if (sent?.id) {
    const { recordPromptMessage, signatureFor } = await import('../engine/prompt-reconciler.js');
    recordPromptMessage(game, 'massivePushSpace', sent.channelId || channel.id, sent.id, signatureFor('massivePushSpace', game));
  }
}

/**
 * Render-from-state: post the massive-push figure-order picker using only
 * game state and client. Records msg into game.promptMessageIds.massivePushFigure.
 */
export async function renderMassivePushFigurePrompt(game, client, opts = {}) {
  const pending = game.pendingMassivePush;
  if (!pending) return;
  const pickable = pending._currentPickable || [];
  if (pickable.length === 0) return;
  const btns = pickable.map((entry, idx) => {
    const pos = game.figurePositions?.[entry.playerNum]?.[entry.figureKey];
    const label = `${entry.dcName}${pos ? ` @ ${String(pos).toUpperCase()}` : ''}`.slice(0, 80);
    return new ButtonBuilder()
      .setCustomId(`massive_push_figure_${pending.gameId}_${idx}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary);
  });
  const rows = [];
  while (btns.length > 0) rows.push(new ActionRowBuilder().addComponents(btns.splice(0, 5)));
  const phaseLabel = pending.phase === 'friendly' ? 'your figures' : 'opponent\'s figures';
  // Per alexanbv 2026-05-12: pre-2026-05-12 this only searched
  // `game.dcActionsData` for a thread. During POST-DEPLOY movement
  // (e.g. AT-DP Scavenged Walker), `dcActionsData` is empty because
  // activations haven't started yet — so threadId was null,
  // opts.fallbackChannel was unset, and the prompt SILENTLY DROPPED.
  // The MASSIVE-displaced log line fired but no picker posted and the
  // figures stayed overlapping. Now: fall through threadId → opts
  // fallback → game.generalId so the picker always lands somewhere.
  const threadId = game.dcActionsData ? Object.values(game.dcActionsData).find((d) => d.threadId)?.threadId : null;
  let channel = threadId ? await fetchGameChannel(client, threadId) : null;
  if (!channel && opts.fallbackChannel) channel = opts.fallbackChannel;
  if (!channel && game.generalId) channel = await fetchGameChannel(client, game.generalId);
  if (!channel) return;
  const sent = await channel.send({
    content: `**Massive Displacement** — Pick which of **${phaseLabel}** to place next.`,
    components: rows.slice(0, 5),
  }).catch(discordCatch);
  if (sent?.id) {
    const { recordPromptMessage, signatureFor } = await import('../engine/prompt-reconciler.js');
    recordPromptMessage(game, 'massivePushFigure', sent.channelId || channel.id, sent.id, signatureFor('massivePushFigure', game));
  }
}

/**
 * Dispatcher: after resolveNextDisplacements returns a result, either:
 *   - result.done        → cleanup pendingMassivePush, refresh board, resume any
 *                          deferred post-deploy movement-complete callback.
 *   - result.needsFigurePick → post figure-order picker.
 *   - result.needsChoice → post space picker for the current figure.
 */
async function _dispatchNextMassivePush(game, result, interaction, ctx) {
  const { client, logGameAction, buildBoardMapPayload, saveGames } = ctx;
  if (result.done) {
    const gameId = game.pendingMassivePush?.gameId || game.gameId;
    clearPendingMassivePush(game);
    if (game.boardId && game.selectedMap && buildBoardMapPayload) {
      try {
        const boardChannel = await fetchGameChannel(client, game.boardId);
        if (boardChannel) {
          const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        }
      } catch (err) { console.error('Massive push: board refresh failed', err); }
    }
    // Resume any deferred post-deploy movement-complete callback gated on
    // pendingMassivePush. No-op if nothing was deferred.
    const { resumeDeferredPostDeployMove } = await import('./post-deploy.js');
    await resumeDeferredPostDeployMove(game, gameId, client, ctx);
    // Resume any deferred sequence afterAction (e.g. Scavenged Walker's
    // postDeployAdvance) stashed by _advanceMoveXSequence when it
    // encountered pendingMassivePush mid-flight. Per alexanbv
    // 2026-05-12: prevents the post-deploy flow from advancing to the
    // next ability while figures are still overlapping the MASSIVE
    // figure's footprint.
    const { resumeDeferredAfterMassivePush } = await import('./move-x-handler.js');
    await resumeDeferredAfterMassivePush(game, ctx);
    if (saveGames) saveGames(game.gameId);
    return;
  }
  if (result.needsFigurePick) {
    await _showMassivePushFigurePicker(game, result.needsFigurePick, interaction, client, saveGames);
    return;
  }
  if (result.needsChoice) {
    await _showMassivePushPicker(game, result.needsChoice, interaction, client, logGameAction, buildBoardMapPayload, saveGames);
  }
}

/**
 * Handle massive push space pick button (massive_push_space_).
 * Places the displaced figure, then continues iterative resolution.
 * Push authority: friendly phase → massive controller, enemy phase → enemy player.
 */
export async function handleMassivePushSpace(interaction, ctx) {
  const { getGame, logGameAction, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const match = interaction.customId.match(/^massive_push_space_([^_]+)_(.+)$/);
  if (!match) { await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch); return; }
  const [, gameId, chosenSpace] = match;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingMassivePush;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending displacement.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Push authority: friendly phase → massive controller picks; enemy phase → enemy player picks
  const controllerPlayerNum = pending._currentControllerPlayerNum ?? pending.movingPlayerNum;
  const authorityLabel = pending.phase === 'friendly'
    ? 'Only the massive figure\'s controller can place friendly figures.'
    : 'Only the displaced figure\'s controller can place their figures.';
  if (!await requirePlayer(interaction, game, interaction.user.id, controllerPlayerNum, canActAsPlayer, authorityLabel)) return;
  const valid = (pending._currentValidSpaces || []).map(s => s.toLowerCase());
  if (!valid.includes(chosenSpace.toLowerCase())) {
    await interaction.followUp({ content: 'Invalid space.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Apply choice via shared engine
  const { applyDisplacementChoice, resolveNextDisplacements } = await import('../game/movement.js');
  const applied = applyDisplacementChoice(game, pending, chosenSpace);
  if (applied) {
    const from = applied.prevPos ? String(applied.prevPos).toUpperCase() : '?';
    await logGameAction(game, client, `**${applied.entry.dcName}** displaced **${from}** → **${chosenSpace.toUpperCase()}** by massive figure (controller choice).`, { icon: 'move', phase: 'ROUND' });
  }
  try { await interaction.message.edit({ content: `Placed **${applied?.entry?.dcName || 'figure'}** at **${chosenSpace.toUpperCase()}**.`, components: [] }).catch(discordCatch); } catch {}
  const { clearPromptRecord } = await import('../engine/prompt-reconciler.js');
  clearPromptRecord(game, 'massivePushSpace');
  // Continue iterative resolution — may auto-resolve more figures before next choice
  const result = resolveNextDisplacements(game, pending);
  for (const r of result.autoResolved) {
    const from = r.prevPos ? String(r.prevPos).toUpperCase() : '?';
    const to = r.newPos ? String(r.newPos).toUpperCase() : '?';
    const suffix = r.bfs ? ' (no adjacent spaces)' : '';
    await logGameAction(game, client, `**${r.entry.dcName}** displaced **${from}** → **${to}** by massive figure${suffix}.`, { icon: 'move', phase: 'ROUND' });
  }
  await _dispatchNextMassivePush(game, result, interaction, ctx);
  if (saveGames) saveGames(game.gameId);
}

/**
 * Handle massive push figure-order pick (massive_push_figure_).
 * Controller chooses WHICH displaced figure to place next (when 2+ remain in phase).
 * Authority matches space-pick: friendly phase → massive controller; enemy phase → enemy player.
 */
export async function handleMassivePushFigure(interaction, ctx) {
  const { getGame, logGameAction, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const match = interaction.customId.match(/^massive_push_figure_([^_]+)_(\d+)$/);
  if (!match) { await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch); return; }
  const [, gameId, idxStr] = match;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingMassivePush;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending displacement.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const controllerPlayerNum = pending._currentControllerPlayerNum ?? pending.movingPlayerNum;
  const authorityLabel = pending.phase === 'friendly'
    ? 'Only the massive figure\'s controller can pick placement order.'
    : 'Only the displaced figure\'s controller can pick placement order.';
  if (!await requirePlayer(interaction, game, interaction.user.id, controllerPlayerNum, canActAsPlayer, authorityLabel)) return;
  const idx = parseInt(idxStr, 10);
  const pickable = pending._currentPickable || [];
  const choice = pickable[idx];
  if (!choice) {
    await interaction.followUp({ content: 'Invalid pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { applyFigurePick, resolveNextDisplacements } = await import('../game/movement.js');
  if (!applyFigurePick(pending, choice.figureKey)) {
    await interaction.followUp({ content: 'Invalid pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  try { await interaction.message.edit({ content: `Order set: **${choice.dcName}** placed next.`, components: [] }).catch(discordCatch); } catch {}
  const { clearPromptRecord } = await import('../engine/prompt-reconciler.js');
  clearPromptRecord(game, 'massivePushFigure');
  // Drive one more resolution step — with the order locked in, it will either
  // auto-drain (0/1-space edge cases) or return needsChoice for this figure.
  const result = resolveNextDisplacements(game, pending);
  for (const r of result.autoResolved) {
    const from = r.prevPos ? String(r.prevPos).toUpperCase() : '?';
    const to = r.newPos ? String(r.newPos).toUpperCase() : '?';
    const suffix = r.bfs ? ' (no adjacent spaces)' : '';
    await logGameAction(game, client, `**${r.entry.dcName}** displaced **${from}** → **${to}** by massive figure${suffix}.`, { icon: 'move', phase: 'ROUND' });
  }
  await _dispatchNextMassivePush(game, result, interaction, ctx);
  if (saveGames) saveGames(game.gameId);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, getBoardStateForMovement, getMovementProfile, ensureMovementCache, getSpacesAtCost, clearMoveGridMessages, getMovementMinimapAttachment, client
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
    // Diagnostic for post-deploy MASSIVE figure issue (destruct 2026-05-08).
    // Log the full state context so the next repro shows where the gap is.
    console.warn(`[move-session-expired] moveKey=${moveKey} not in moveInProgress`,
      { existingKeys: Object.keys(game.moveInProgress || {}),
        postDeployActive: game.postDeployQueue?.activeAbility?.abilityId ?? 'none',
        postDeployActiveMsgId: game.postDeployQueue?.activeAbility?.msgId ?? null,
        massiveLocked: !!game.massiveMovementLocked,
        pendingMassivePush: !!game.pendingMassivePush,
        mp });
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
    _cleanupMoveState(game, moveKey, msgId);
    await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const profile = moveState.movementProfile || getMovementProfile(meta.dcName, figureKey, game);
  // Force Jump: mobileMovementActive grants MOBILE movement (pass through figures/doors)
  if (game.mobileMovementActive?.[figureKey]) {
    profile.isMobile = true;
    profile.ignoreBlocking = true;
    profile.ignoreFigureCost = true;
    profile.ignoreDifficult = true;
    // Force Jump CSV: "cannot end in blocking or impassable terrain". MOBILE lets
    // the figure pass THROUGH blocking; this flag forbids ENDING on it.
    profile.cannotEndOnBlocking = true;
  }
  // CRR MOVE-017 / MOVE-020 are now enforced structurally by the
  // Move-X picker (src/handlers/move-x-handler.js): each step costs
  // exactly 1 space regardless of terrain/figure cost, and the
  // picker only emits cardinal translations so Large figures cannot
  // rotate during Move-X. The legacy moveXBypassActive flag is gone.
  moveState.boardState = boardState;
  moveState.movementProfile = profile;
  const startCoord = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
  if (!startCoord) {
    _cleanupMoveState(game, moveKey, msgId);
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
  // Build 2-step row→cell picker via generic space_row_ handler
  const labelMap = {};
  if (isMultiTile) {
    for (const s of buttonSpaces) {
      const n = normalizeCoord(s);
      labelMap[n] = bottomLeftCoord(n, profile.size).toUpperCase();
    }
  }
  const multiTileNote = isMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';
  const rowDisplayOffset = isMultiTile ? parseSizeString(profile.size).rows - 1 : 0;
  const moveContextKey = `${meta.gameId}_${moveKey}`;
  const moveHeader = `**Move** — Pick destination (**${mp}** MP):${multiTileNote}`;
  const moveActionBtns = [
    { customId: `move_adjust_mp_${msgId}_${figureIndex}`, label: 'Adjust movement points spent', style: ButtonStyle.Secondary },
    _stepModeToggleBtn(msgId, figureIndex, moveState.stepByStep),
  ];
  if (!game.urgencyMustSpendAll?.[msgId]) {
    moveActionBtns.push(
      { customId: `move_pick_${msgId}_${figureIndex}_done`, label: 'End Movement', style: ButtonStyle.Secondary }
    );
  }
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[moveContextKey] = {
    validSpaces: buttonSpaces,
    cellPrefix: `move_pick_${msgId}_${figureIndex}_`,
    mapSpaces: boardState.mapSpaces,
    labelMap,
    headerText: moveHeader,
    actionButtons: moveActionBtns,
    rowDisplayOffset,
  };
  const { rows: moveRowBtns } = buildRowPickerButtons(buttonSpaces, `space_row_${moveContextKey}_`, { rowDisplayOffset });
  const actionBtns = moveActionBtns.map(b =>
    new ButtonBuilder().setCustomId(b.customId).setLabel(b.label).setStyle(b.style)
  );
  const actionRow = new ActionRowBuilder().addComponents(...actionBtns);
  const minimapCells = isMultiTile
    ? buttonSpaces.map((tl) => bottomLeftCoord(tl, profile.size))
    : spaces;
  const moveMinimap = await getMovementMinimapAttachment(game, msgId, figureKey, minimapCells);
  const gridPayload = {
    content: `${moveHeader}\nChoose a row:`,
    components: [...moveRowBtns.slice(0, 4), actionRow],
    fetchReply: true,
  };
  if (moveMinimap) gridPayload.files = [moveMinimap];
  const gridMsg = await interaction.followUp(gridPayload).catch(() => null);
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  game.moveGridMessageIds[moveKey] = gridMsg?.id ? [gridMsg.id] : [];
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
  cleanupSpacePick(game, `${meta.gameId}_${moveKey}`);
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, mpRemaining } = moveState;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner can adjust.')) return;
  // Forced step-by-step DCs (Iden Versio + Dio) cannot use the auto A→B path
  // picker — it would skip the per-step Dio-follow trigger. Refuse a stale click.
  if (moveState.forcedStepByStep) {
    await interaction.followUp({ content: 'This figure must move step-by-step (one space at a time).', ephemeral: true }).catch(discordCatch);
    return;
  }
  // The MP-distance picker is the auto A→B sub-flow (pick N MP → pick a cell
  // exactly N away → auto-path); leaving step-by-step mode here keeps the
  // toggle label consistent.
  moveState.stepByStep = false;
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
 * Toggle a move between auto A→B (avoid enemy spaces) and step-by-step.
 * customId: move_stepmode_<msgId>_<figureIndex>. Flips moveState.stepByStep and
 * re-renders the destination grid in the new mode (movePick ctx group).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - movePick group deps (getGame, dcMessageMeta, clearMoveGridMessages, computeMovementCache, getBoardStateForMovement, getMovementProfile, getMovementMinimapAttachment, saveGames, client)
 */
export async function handleMoveStepModeToggle(interaction, ctx) {
  const { getGame, dcMessageMeta, clearMoveGridMessages, saveGames } = ctx;
  const m = interaction.customId.match(/^move_stepmode_(.+)_(\d+)$/);
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
  const { figureKey, playerNum } = moveState;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner can move.')) return;
  // Forced step-by-step DCs cannot leave step-by-step mode (stale-click guard).
  if (moveState.forcedStepByStep) {
    await interaction.followUp({ content: 'This figure must move step-by-step (one space at a time).', ephemeral: true }).catch(discordCatch);
    return;
  }
  moveState.stepByStep = !moveState.stepByStep;
  // Drop the current grid (and the distance/MP message) and re-render in the new
  // mode from the figure's current position with its remaining MP.
  const currentMsgId = interaction.message?.id;
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  if (currentMsgId) {
    game.moveGridMessageIds[moveKey] = (game.moveGridMessageIds[moveKey] || []).filter((id) => id !== currentMsgId);
    try { await interaction.message.delete(); } catch { /* already gone */ }
  }
  await clearMoveGridMessages(game, moveKey, interaction.channel);
  game.moveGridMessageIds[moveKey] = [];
  const curCoord = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
  const remainingMp = typeof moveState.mpRemaining === 'number' ? moveState.mpRemaining : 0;
  await _renderNextMoveGrid(interaction, ctx, game, moveState, meta, msgId, figureKey, figureIndex, moveKey, curCoord, remainingMp);
  if (saveGames) saveGames(game.gameId);
}


async function _renderNextMoveGrid(interaction, ctx, game, moveState, meta, msgId, figureKey, figureIndex, moveKey, newTopLeft, newMp) {
  const { getBoardStateForMovement, getMovementProfile, computeMovementCache, getMovementMinimapAttachment } = ctx;
  const nextBoard = getBoardStateForMovement(game, figureKey);
  if (!nextBoard || !computeMovementCache) {
    game.moveGridMessageIds = game.moveGridMessageIds || {};
    game.moveGridMessageIds[moveKey] = [];
    return;
  }
  const nextProfile = getMovementProfile(meta.dcName, figureKey, game);
  if (game.mobileMovementActive?.[figureKey]) {
    nextProfile.isMobile = true;
    nextProfile.ignoreBlocking = true;
    nextProfile.ignoreFigureCost = true;
    nextProfile.ignoreDifficult = true;
    // Force Jump CSV: "cannot end in blocking or impassable terrain".
    nextProfile.cannotEndOnBlocking = true;
  }
  // CRR MOVE-017: "Move X spaces" effects (freeMoveBonus) ignore MP costs.
  // CRR MOVE-020: during "Move X spaces", a Large figure's base cannot rotate.
  if (game.moveXBypassActive?.[msgId]) {
    nextProfile.ignoreFigureCost = true;
    nextProfile.ignoreDifficult = true;
    if (nextProfile.isLarge) nextProfile.canRotate = false;
  }
  const nextCache = computeMovementCache(newTopLeft, newMp, nextBoard, nextProfile);
  moveState.boardState = nextBoard;
  moveState.movementProfile = nextProfile;
  moveState.movementCache = nextCache;
  moveState.cacheMaxMp = newMp;
  if (moveState.distanceMessageId) {
    try {
      const distMsg = await interaction.channel.messages.fetch(moveState.distanceMessageId);
      await distMsg.delete();
    } catch { /* already gone */ }
    moveState.distanceMessageId = null;
  }
  // Step-by-step mode shows only immediate one-step neighbours so the player
  // advances a single space at a time; auto mode shows every reachable cell
  // (the pick is then auto-pathed with enemy-space avoidance in handleMovePick).
  // Forced step-by-step DCs (Iden Versio + Dio) are locked into step-by-step
  // so the per-step Dio-follow trigger fires after EACH step.
  const forcedStep = !!moveState.forcedStepByStep;
  const stepByStep = forcedStep ? true : !!moveState.stepByStep;
  const newButtonSpaces = stepByStep
    ? getImmediateStepSpaces(newTopLeft, nextBoard, nextProfile, newMp)
    : [...nextCache.cells.keys()];
  const newIsMultiTile = nextProfile.size && nextProfile.size !== '1x1';
  const newMultiTileNote = newIsMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';
  const newMinimapCells = newIsMultiTile
    ? newButtonSpaces.map((tl) => bottomLeftCoord(tl, nextProfile.size))
    : newButtonSpaces;
  const newMinimap = await getMovementMinimapAttachment(game, msgId, figureKey, newMinimapCells);
  const newLabelMap = {};
  if (newIsMultiTile) {
    for (const s of newButtonSpaces) {
      const n = normalizeCoord(s);
      newLabelMap[n] = bottomLeftCoord(n, nextProfile.size).toUpperCase();
    }
  }
  const newMoveContextKey = `${meta.gameId}_${moveKey}`;
  const newModeNote = forcedStep
    ? `\n👣 **Step-by-step** (locked) — pick an adjacent space (one at a time).`
    : stepByStep
      ? `\n👣 **Step-by-step** — pick an adjacent space (one at a time).`
      : `\n🎯 **Auto** — pick any space; routes A→B avoiding enemy-adjacent spaces when possible.`;
  const newMoveHeader = `**Move** — Pick destination (**${newMp}** MP remaining):${newModeNote}${newMultiTileNote}`;
  // Forced step-by-step suppresses the auto-path picker and the mode toggle so
  // the player cannot bypass the per-step model.
  const newMoveActionBtns = forcedStep ? [] : [
    { customId: `move_adjust_mp_${msgId}_${figureIndex}`, label: 'Pick Path Manually', style: ButtonStyle.Secondary },
    _stepModeToggleBtn(msgId, figureIndex, stepByStep),
  ];
  if (!game.urgencyMustSpendAll?.[msgId]) {
    newMoveActionBtns.push(
      { customId: `move_pick_${msgId}_${figureIndex}_done`, label: 'End Movement', style: ButtonStyle.Secondary }
    );
  }
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[newMoveContextKey] = {
    validSpaces: newButtonSpaces,
    cellPrefix: `move_pick_${msgId}_${figureIndex}_`,
    mapSpaces: nextBoard.mapSpaces,
    labelMap: newLabelMap,
    headerText: newMoveHeader,
    actionButtons: newMoveActionBtns,
  };
  const { rows: newRowBtns } = buildRowPickerButtons(newButtonSpaces, `space_row_${newMoveContextKey}_`);
  const newActionBtns = newMoveActionBtns.map(b =>
    new ButtonBuilder().setCustomId(b.customId).setLabel(b.label).setStyle(b.style)
  );
  const newActionRowComponents = newActionBtns.length > 0
    ? [new ActionRowBuilder().addComponents(...newActionBtns)]
    : [];
  const newFirstPayload = {
    content: `${newMoveHeader}\nChoose a row:`,
    components: [...newRowBtns.slice(0, 4), ...newActionRowComponents],
    fetchReply: true,
  };
  if (newMinimap) newFirstPayload.files = [newMinimap];
  const newGridMsg = await interaction.followUp(newFirstPayload).catch(() => null);
  game.moveGridMessageIds = game.moveGridMessageIds || {};
  game.moveGridMessageIds[moveKey] = newGridMsg?.id ? [newGridMsg.id] : [];
}

async function _renderPostMoveBoardUpdate(ctx, game, msgId) {
  const { client, buildBoardMapPayload, updateDcActionsMessage } = ctx;
  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await fetchGameChannel(client, game.boardId);
      if (!boardChannel) throw new Error('Board channel not found');
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to update map after move:', err);
    }
  }
  if (updateDcActionsMessage) {
    try {
      await updateDcActionsMessage(game, msgId, client);
    } catch (err) {
      console.error('Failed to update activation minimap after move:', err);
    }
  }
}

async function _renderRushPushPrompt(interaction, gameId, msgId, rushTargets) {
  const btns = rushTargets.map((t, i) =>
    new ButtonBuilder()
      .setCustomId(`rush_push_fig_${gameId}_${msgId}_${i}`)
      .setLabel(t.dcName.replace(/_/g, ' '))
      .setStyle(ButtonStyle.Primary)
  );
  btns.push(
    new ButtonBuilder()
      .setCustomId(`rush_push_skip_${gameId}_${msgId}`)
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

async function _renderShoulderRushPrompt(interaction, gameId, msgId, srTargets) {
  const srBtns = srTargets.map((t, i) =>
    new ButtonBuilder()
      .setCustomId(`shoulder_rush_fig_${gameId}_${msgId}_${i}`)
      .setLabel(t.dcName.replace(/_/g, ' '))
      .setStyle(ButtonStyle.Primary)
  );
  srBtns.push(
    new ButtonBuilder()
      .setCustomId(`shoulder_rush_skip_${gameId}_${msgId}`)
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


/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, clearMoveGridMessages, getBoardStateForMovement, getMovementProfile, ensureMovementCache, computeMovementCache, normalizeCoord, getMovementTarget, getFigureSize, getNormalizedFootprint, resolveMassivePush, updateMovementBankMessage, getMovementPath, pushUndo, logGameAction, countTerminalsControlledByPlayer, editDistanceMessage, getMoveMpButtonRows, buildBoardMapPayload, updateDcActionsMessage, saveGames, client
 */
export async function handleMovePick(interaction, ctx, opts = {}) {
  const fastPath = !!opts.fastPath;
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
    updateMovementBankMessage,
    getMovementPath,
    pushUndo,
    logGameAction,
    countTerminalsControlledByPlayer,
    getMovementMinimapAttachment,
    buildBoardMapPayload,
    getDcStats,
    saveGames,
    client,
    processFigureDefeat,
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
  cleanupSpacePick(game, `${meta.gameId}_${moveKey}`);
  const moveState = game.moveInProgress?.[moveKey];
  if (!moveState) {
    await interaction.followUp({ content: 'Move session expired.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { figureKey, playerNum, mpRemaining, displayName } = moveState;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner can move.')) return;

  // Early termination: "done" ends movement immediately. Remaining MP
  // stays in the bank — the player can click Spend MP later to spend
  // them. Per alexanbv 2026-05-10: the previous "X MP forfeited"
  // message was erroneous; MP are not forfeited on End Movement.
  if (space === 'done') {
    await clearMoveGridMessages(game, moveKey, interaction.channel);
    try { await interaction.message.delete(); } catch { /* already gone */ }
    _cleanupMoveState(game, moveKey, msgId);
    const _mpRemainingNote = mpRemaining > 0 ? ` — **${mpRemaining}** MP remain in bank.` : '';
    await interaction.followUp({ content: `**${displayName}** ended movement${_mpRemainingNote}`, ephemeral: false }).catch(discordCatch);
    // Restore activation buttons (figure selector, Move/Attack/etc.)
    if (ctx.updateDcActionsMessage) {
      await ctx.updateDcActionsMessage(game, msgId, client).catch(() => {});
    }
    saveGames(game.gameId);
    return;
  }

  await clearMoveGridMessages(game, moveKey, interaction.channel);
  // Also delete the message the user clicked on (it may have been edited in-place
  // by the row→cell picker and removed from moveGridMessageIds tracking)
  try { await interaction.message.delete(); } catch { /* already gone or no perms */ }
  const boardState = getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    _cleanupMoveState(game, moveKey, msgId);
    await interaction.followUp({ content: 'Map data missing. Movement cancelled.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const profile = getMovementProfile(meta.dcName, figureKey, game);
  // Force Jump: mobileMovementActive grants MOBILE movement (pass through figures/doors)
  if (game.mobileMovementActive?.[figureKey]) {
    profile.isMobile = true;
    profile.ignoreBlocking = true;
    profile.ignoreFigureCost = true;
    profile.ignoreDifficult = true;
    // Force Jump CSV: "cannot end in blocking or impassable terrain".
    profile.cannotEndOnBlocking = true;
  }
  // CRR MOVE-017: "Move X spaces" effects (freeMoveBonus) ignore MP costs.
  // CRR MOVE-020: during "Move X spaces", a Large figure's base cannot rotate.
  if (game.moveXBypassActive?.[msgId]) {
    profile.ignoreFigureCost = true;
    profile.ignoreDifficult = true;
    if (profile.isLarge) profile.canRotate = false;
  }
  const startCoord = moveState.startCoord || game.figurePositions?.[playerNum]?.[figureKey];
  if (!startCoord) {
    _cleanupMoveState(game, moveKey, msgId);
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
  markMapDirty(game);
  // Track that this figure has moved (used by Tripod, etc.)
  if (!game.figureMoved) game.figureMoved = {};
  game.figureMoved[figureKey] = true;
  // Line of Fire (Anchorhead B): extractionPointVp — when a figure
  // carrying a crate enters the extraction point, discard 1 crate and
  // score (vpBase − vpPenaltyPerBlockSuffered × blockSuffered) VP.
  // Per destruct 2026-05-08. Coord sourced from
  // game.selectedMission.rules.persistent.extractionPointCoord (or
  // map-tokens), which is null until the IACP card layout lands.
  try {
    const _lofExt = game?.selectedMission?.rules?.persistent?.extractionPointVp;
    // Per destruct 2026-05-08: extraction-point may be a single coord
    // or an array of coords (Anchorhead B has 2 cells). Support both.
    const _lofRuleCoord = game?.selectedMission?.rules?.persistent?.extractionPointCoord;
    const _lofMapToks = ctx?.getMapTokensData?.()[mapId];
    const _lofExtCoords = (
      Array.isArray(_lofRuleCoord) ? _lofRuleCoord :
      typeof _lofRuleCoord === 'string' ? [_lofRuleCoord] :
      Array.isArray(_lofMapToks?.extractionPoints) ? _lofMapToks.extractionPoints :
      typeof _lofMapToks?.extractionPoint === 'string' ? [_lofMapToks.extractionPoint] :
      []
    ).map((c) => String(c).toLowerCase());
    if (_lofExt && _lofExtCoords.length > 0 && game.figureContraband?.[figureKey]) {
      const _lofEnterCoord = String(newTopLeft).toLowerCase();
      if (_lofExtCoords.includes(_lofEnterCoord)) {
        const _lofEpCoord = _lofEnterCoord;
        const _lofBlocks = game.lineOfFireCrateBlock?.[figureKey] || [];
        const _lofBlockSuffered = _lofBlocks.length > 0 ? (_lofBlocks[0] || 0) : 0;
        const _lofVp = Math.max(0, (_lofExt.vpBase || 10) - (_lofExt.vpPenaltyPerBlockSuffered || 2) * _lofBlockSuffered);
        if (typeof game.figureContraband[figureKey] === 'number') {
          game.figureContraband[figureKey] -= 1;
          if (game.figureContraband[figureKey] <= 0) delete game.figureContraband[figureKey];
        } else {
          delete game.figureContraband[figureKey];
        }
        if (Array.isArray(game.lineOfFireCrateBlock?.[figureKey])) {
          game.lineOfFireCrateBlock[figureKey].shift();
          if (game.lineOfFireCrateBlock[figureKey].length === 0) delete game.lineOfFireCrateBlock[figureKey];
        }
        const _lofAwardVp = ctx?.awardObjectiveVp || (await import('../game/vp-helpers.js')).awardObjectiveVp;
        if (_lofVp > 0 && typeof _lofAwardVp === 'function') {
          _lofAwardVp(game, playerNum, _lofVp);
        }
        if (typeof logGameAction === 'function') {
          await logGameAction(game, client, `📦 **Line of Fire** — **${meta.displayName || meta.dcName}** delivered a crate to the extraction point at **${_lofEpCoord.toUpperCase()}** (block suffered: ${_lofBlockSuffered}). +**${_lofVp} VP**.`, { phase: 'ROUND', icon: 'round' });
        }
      }
    }
  } catch (_lofErr) { /* fail-open */ }
  // Overrun: when entering a hostile's space, deal 2 damage (once per hostile per move session).
  // Per alexanbv 2026-05-13: "during this activation" = per-figure activation; keyed by figureKey.
  if (game.overrunThisActivation?.[figureKey]) {
    const hostilePlayerNum = opponentPlayerNum(playerNum);
    const hostilePositions = game.figurePositions?.[hostilePlayerNum] || {};
    game.overrunDamagedThisMove = game.overrunDamagedThisMove || {};
    if (!game.overrunDamagedThisMove[figureKey]) game.overrunDamagedThisMove[figureKey] = [];
    const hostileDcList = getDcList(game, hostilePlayerNum) || [];
    const hostileMsgIds = getDcMessageIds(game, hostilePlayerNum) || [];
    const _dcHealthState = ctx.dcHealthState;
    // Compute the moving figure's footprint tentatively for overlap detection
    const _movingSize = targetInfo.size || getFigureSize(meta.dcName);
    const _movingFootprint = new Set(getNormalizedFootprint(newTopLeft, _movingSize));
    for (const [hostileFigureKey, hostilePos] of Object.entries(hostilePositions)) {
      if (!hostilePos) continue;
      if (game.overrunDamagedThisMove[figureKey].includes(hostileFigureKey)) continue;
      const hFkMatch = hostileFigureKey.match(/^(.+)-(\d+)-(\d+)$/);
      if (!hFkMatch) continue;
      const [, hostileDcName, hostileDgIndex, hostileFigIndexStr] = hFkMatch;
      const hostileSize = game.figureOrientations?.[hostileFigureKey] || getFigureSize(hostileDcName);
      const hostileFootprint = new Set(getNormalizedFootprint(hostilePos, hostileSize));
      const overlaps = [..._movingFootprint].some((s) => hostileFootprint.has(s));
      if (!overlaps) continue;
      game.overrunDamagedThisMove[figureKey].push(hostileFigureKey);
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
      const _orRes = await _applyDamage(game, { dcHealthState: _dcHealthState, logGameAction, client }, {
        figureKey: hostileFigureKey, msgId: hostileMsgId, figIndex: hFigIndex,
        amount: 2, controllerPlayerNum: hostilePlayerNum,
        source: 'Overrun',
      });
      const curHp = _orRes.prevHp;
      const newHp = _orRes.newHp;
      const hDisplayName = dcMessageMeta.get(hostileMsgId)?.displayName || hostileDcName;
      const defeatNote = newHp <= 0 ? ' **(defeated)**' : '';
      await logGameAction(game, client, `**Overrun** — **${displayName}** entered **${hDisplayName}**'s space: 2 Damage${defeatNote} (HP: ${curHp}→${newHp}).`, { phase: 'ROUND', icon: 'attack' });
      if (newHp <= 0 && processFigureDefeat) {
        await processFigureDefeat(game, {
          defeatedPlayerNum: hostilePlayerNum,
          figureKey: hostileFigureKey,
          attackerPlayerNum: playerNum,
          source: 'Overrun',
        });
      }
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
        const _crRes = await _applyDamage(game, { dcHealthState: _dcHs, logGameAction, client }, {
          figureKey: hFk, msgId: hMsgId, figIndex: hFigIdx,
          amount: 1, controllerPlayerNum: hostilePlayerNum,
          source: 'Cut and Run',
        });
        const hCur = _crRes.prevHp;
        const hNewHp = _crRes.newHp;
        const hDispName = dcMessageMeta.get(hMsgId)?.displayName || hDcName;
        const defeatNote = hNewHp <= 0 ? ' **(defeated)**' : '';
        await logGameAction(game, client, `⚔️ **Cut and Run** — **${displayName}** exits **${hDispName}**'s space: 1 Damage${defeatNote} (HP: ${hCur}→${hNewHp}).`, { phase: 'ROUND', icon: 'attack' });
        if (hNewHp <= 0 && processFigureDefeat) {
          await processFigureDefeat(game, {
            defeatedPlayerNum: hostilePlayerNum,
            figureKey: hFk,
            attackerPlayerNum: playerNum,
            source: 'Cut and Run',
          });
        }
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
  // Interactive massive displacement: iterative engine resolves one figure at a time,
  // recalculating valid spaces after each displacement (board state changes).
  // Rules: friendly first, then enemy player pushes their own figures.
  if (updatedProfile.canEndOnOccupied) {
    const { initMassiveDisplacement, resolveNextDisplacements } = await import('../game/movement.js');
    const pending = initMassiveDisplacement(game, playerNum, figureKey, footprintSet);
    if (pending) {
      // Resolve auto cases (0/1 valid space) iteratively until a choice is needed
      const result = resolveNextDisplacements(game, pending);
      for (const r of result.autoResolved) {
        const from = r.prevPos ? String(r.prevPos).toUpperCase() : '?';
        const to = r.newPos ? String(r.newPos).toUpperCase() : '?';
        const suffix = r.bfs ? ' (no adjacent spaces)' : '';
        await logGameAction(game, client, `**${r.entry.dcName}** displaced **${from}** → **${to}** by massive figure${suffix}.`, { icon: 'move', phase: 'ROUND' });
      }
      game.massiveMovementLocked = game.massiveMovementLocked || {};
      game.massiveMovementLocked[figureKey] = true;
      await logGameAction(game, client, `Massive figure displaced ${pending.totalDisplaced} figure(s). Movement locked for this phase.`, { icon: 'move', phase: 'ROUND' });
      if (!result.done) {
        // Store pending state for interactive resolution
        setPendingMassivePush(game, { ...pending, gameId: game.gameId });
        await _dispatchNextMassivePush(game, result, interaction, ctx);
      }
    }
  }
  // Massive figure that pushed someone: movement ends immediately (cannot continue moving)
  const massivePushHappened = game.massiveMovementLocked?.[figureKey];
  const newMp = massivePushHappened ? 0 : (mpRemaining - cost);
  moveState.mpRemaining = newMp;
  // Track visited coords for anti-oscillation: record the space we're leaving
  if (moveState.startCoord) {
    if (!moveState.visitedCoords) moveState.visitedCoords = [];
    moveState.visitedCoords.push(String(moveState.startCoord).toLowerCase());
  }
  moveState.startCoord = targetInfo.topLeft;
  moveState.boardState = null;
  moveState.movementCache = null;
  moveState.cacheMaxMp = 0;
  if (game.movementBank?.[msgId]) {
    // Per-figure bank only — no top-level .remaining mirror.
    setFigureMp(game, msgId, figureIndex, Math.max(0, newMp));
    await updateMovementBankMessage(game, msgId, client);
  }
  const destDisplay = bottomLeftCoord(newTopLeft, newSize).toUpperCase();
  const shortName = (displayName || meta.displayName || '').replace(/\s*\[(?:DG|Group) \d+\]$/, '') || displayName;
  const pLabel = `P${playerNum}`;
  const ownerId = getPlayerId(game, playerNum);
  // Point-A-to-point-B auto-path. Among equal-MP shortest routes, prefer the one
  // that touches the fewest enemy-adjacent ("danger") cells, so the figure
  // avoids triggering Parting Blow / Dirty Trick / Self-Defense / Overwatch when
  // an equally-cheap route exists (alexanbv 2026-06-19). Same MP cost & length;
  // only the route through equal-cost cells changes. Feeds the move log AND the
  // downstream interrupt detection below.
  let path = getMovementPath(cache, startCoord, newTopLeft, newSize, profile);
  try {
    const { getMovementPathAvoiding } = await import('../game/movement.js');
    const { computeEnemyAdjacencyDangerSet } = await import('../game/movement-interrupts.js');
    const dangerSet = computeEnemyAdjacencyDangerSet(game, playerNum);
    const avoided = getMovementPathAvoiding(cache, boardState, startCoord, newTopLeft, newSize, profile, dangerSet);
    if (Array.isArray(avoided) && avoided.length >= 2) path = avoided;
  } catch { /* fall back to the plain shortest path */ }
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
    _cleanupMoveState(game, moveKey, msgId);
    // Post-deploy movement: advance the post-deploy queue
    if (wasPostDeploy && game.postDeployQueue) {
      const { onPostDeployMovementComplete } = await import('./post-deploy.js');
      await onPostDeployMovementComplete(game, meta.gameId, client, ctx, figureKey);
    }
  } else if (!fastPath) {
    await _renderNextMoveGrid(interaction, ctx, game, moveState, meta, msgId, figureKey, figureIndex, moveKey, newTopLeft, newMp);
  }
  if (!fastPath) {
    await _renderPostMoveBoardUpdate(ctx, game, msgId);
  }
  // (Interactive massive-push prompts are posted directly from the init block
  // above via _dispatchNextMassivePush. No post-hoc branch needed here.)
  // Bleed strain on Move action: timing fix (slice 9, destruct 2026-05-06).
  // Move-action Bleed now fires at action-declare time (when MP is granted)
  // via dc-play-area.js's Move handler — BEFORE any cell is picked. The old
  // post-first-space pendingBleed flag is retired; this block is a no-op
  // legacy guard for any in-flight game state still carrying the flag.
  if (moveState.pendingBleed) {
    moveState.pendingBleed = false; // discard legacy flag without firing
  }
  // Rush (Onar): after all movement MP exhausted, offer push on adjacent
  // SMALL figure. CSV "an adjacent SMALL figure" — no hostile qualifier,
  // so friendly SMALL figures are eligible push targets too (the activator
  // itself is excluded below).
  if (newMp <= 0 && game.rushPending?.[msgId]) {
    delete game.rushPending[msgId];
    const rushMapId = game.selectedMap?.id;
    const rushAdjSpaces = rushMapId ? (getMapData(rushMapId)?.adjacency?.[newTopLeft] || []) : [];
    const rushEffects = getDcEffects();
    const rushOppNum = opponentPlayerNum(playerNum);
    const rushCandidates = {
      ...(game.figurePositions?.[rushOppNum] || {}),
      ...(game.figurePositions?.[playerNum] || {}),
    };
    const rushAdjSet = new Set(rushAdjSpaces);
    const rushTargets = [];
    for (const [fk, pos] of Object.entries(rushCandidates)) {
      if (!pos || !rushAdjSet.has(pos)) continue;
      if (fk === figureKey) continue; // never push the rushing figure itself
      const rDcName = dcNameFromFigureKey(fk);
      const rEff = rushEffects?.[rDcName];
      const rKw = (rEff?.keywords || []).map(k => String(k).toUpperCase());
      if (rKw.includes('LARGE') || rKw.includes('MASSIVE')) continue;
      // Spiked Boots: cannot be pushed except by MASSIVE
      if ((rEff?.specialAbilityIds || []).includes('spiked_boots_snowtrooper')) {
        const pusherEff = rushEffects?.[meta.dcName];
        if (!(pusherEff?.keywords || []).some(k => String(k).toUpperCase() === 'MASSIVE')) continue;
      }
      // Take Position (CC): same per-round push-immunity rule, except by MASSIVE
      if (game.roundPushImmuneUnlessMassive?.[fk]) {
        const pusherEff = rushEffects?.[meta.dcName];
        if (!(pusherEff?.keywords || []).some(k => String(k).toUpperCase() === 'MASSIVE')) continue;
      }
      rushTargets.push({ figureKey: fk, dcName: rDcName });
    }
    if (rushTargets.length > 0) {
      setPendingRushPush(game, {
        msgId, playerNum, activatorFigureKey: figureKey,
        activatorPos: newTopLeft,
        targets: rushTargets.map(t => t.figureKey),
      });
      await _renderRushPushPrompt(interaction, game.gameId, msgId, rushTargets);
    }
  }
  // Shoulder Rush (KX-Series Security Droid): after movement MP exhausted, choose adjacent hostile → push if SMALL + enter space → free attack
  if (newMp <= 0 && game.shoulderRushPending?.[msgId]) {
    const srData = game.shoulderRushPending[msgId];
    delete game.shoulderRushPending[msgId];
    const srMapId = game.selectedMap?.id;
    const srAdjSpaces = srMapId ? (getMapData(srMapId)?.adjacency?.[newTopLeft] || []) : [];
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
      setPendingShoulderRush(game, {
        msgId, playerNum, activatorFigureKey: figureKey,
        activatorPos: newTopLeft,
        targets: srTargets.map(t => t.figureKey),
      });
      await _renderShoulderRushPrompt(interaction, game.gameId, msgId, srTargets);
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
        // Check adjacency. CRR p.21 COMPANIONS: same-space figures count
        // as adjacent — so a LEADER moving INTO KX's own space also
        // qualifies as "entering an adjacent space."
        const adjSpaces = dpMapId ? (getMapData(dpMapId)?.adjacency?.[pos] || []) : [];
        if (!adjSpaces.includes(newTopLeft) && pos !== newTopLeft) continue;
        // Once per round check
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        const dpKey = `deference_protocol_${fk}`;
        if (game.roundFigureAbilityUsed[dpKey]) continue;
        game.roundFigureAbilityUsed[dpKey] = true;
        // Grant Block token
        grantPowerTokens(game, fk, 'Block', 1);
        if (logGameAction) {
          await logGameAction(game, client, `**Deference Protocol** — **${dpDcName}** gained a Block token (friendly LEADER entered adjacent space).`, { phase: 'ROUND', icon: 'defend' });
        }
      }
    }
  }
  // Cassian Said I Had To (K-2S0): when a friendly LEADER enters an adjacent space, gain up to 1 Damage Token (once per round)
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
        // CRR p.21 COMPANIONS: same-space figures count as adjacent.
        const csAdjSpaces = csMapId ? (getMapData(csMapId)?.adjacency?.[pos] || []) : [];
        if (!csAdjSpaces.includes(newTopLeft) && pos !== newTopLeft) continue;
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        const csKey = `cassian_said_i_had_to_${fk}`;
        if (game.roundFigureAbilityUsed[csKey]) continue;
        // Card text: "gain UP TO 1 Damage Token" — the player MAY decline (gain 0).
        // Offer a Use/Skip opt-in; the once-per-round flag is NOT consumed unless
        // the player chooses Use (handled in handleCassianSaidIHadTo).
        const csOwnerId = getPlayerId(game, playerNum);
        const csBtns = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`cassian_kx_use_${game.gameId}_${fk}`)
            .setLabel('Gain Damage Token')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`cassian_kx_skip_${game.gameId}_${fk}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary),
        );
        await interaction.channel?.send?.({
          content: `🤖 <@${csOwnerId}> — **Cassian Said I Had To**: **${csDcName}** may gain **1 Damage Token** (friendly LEADER entered adjacent space).`,
          components: [csBtns],
          allowedMentions: { users: csOwnerId ? [csOwnerId] : [] },
        }).catch(discordCatch);
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
        const _swDmgRes = await _applyDamage(game, { dcHealthState: _swHs, logGameAction, client }, {
          figureKey: _swEfk, msgId: _swTgtMsgId, figIndex: _swFigIdx,
          amount: 1, controllerPlayerNum: _swOppPN,
          attackerPlayerNum: playerNum, source: 'Swipe',
        });
        const _swPrev = _swDmgRes.prevHp;
        const _swNew = _swDmgRes.newHp;
        const _swDefeat = _swNew <= 0 ? ' **(defeated)**' : '';
        await logGameAction(game, client, `**Swipe** — **Salacious B. Crumb** enters **${_swTgtDcName}**'s space: 1 Damage${_swDefeat} (HP: ${_swPrev}→${_swNew}).`, { phase: 'ROUND', icon: 'attack' });
        if (_swNew <= 0 && processFigureDefeat) {
          await processFigureDefeat(game, {
            defeatedPlayerNum: _swOppPN,
            figureKey: _swEfk,
            attackerPlayerNum: playerNum,
            source: 'Swipe',
          });
        }
      }
    }
  }
  // Stampede (Bantha Rider): per alexanbv 2026-05-10, this is now folded
  // into the MASSIVE push framework — each displaced enemy in Bantha's
  // final footprint takes 1 Damage BEFORE being pushed. Implementation
  // moved to `_runMassiveDisplacement` in move-x-handler.js.
  // Hop On! (Kuiil) — on-enter push during movement (alexanbv 2026-06-21).
  // While a Hop On designation is active for the moving figure, each time
  // Kuiil's footprint ENTERS the designated figure's space (this step's commit),
  // push that figure 1 space in Kuiil's direction of travel — the space beyond
  // it along the move — so the space is vacated and Kuiil occupies it. The
  // designation persists for the rest of the activation, so repeated entries
  // (Kuiil chasing the figure he keeps pushing) chain naturally. Kuiil is forced
  // step-by-step while designated (forced-step-movement.js), so each entry is a
  // discrete, detectable single-space step.
  {
    const _hopDesigKey = game.hopOnDesignated?.[figureKey];
    if (_hopDesigKey && startCoord && newTopLeft && startCoord !== newTopLeft) {
      const _hopDesigPos = game.figurePositions?.[playerNum]?.[_hopDesigKey];
      if (_hopDesigPos) {
        const _hopDesigDc = dcNameFromFigureKey(_hopDesigKey);
        const _hopDesigSize = game.figureOrientations?.[_hopDesigKey] || getFigureSize(_hopDesigDc);
        // Board for push-destination validation: exclude BOTH Kuiil and the
        // designated figure from the occupied set so the figure can be pushed
        // into a space neither of them blocks.
        const _hopBoard = getBoardStateForMovement(game, figureKey);
        const _hopOcc = new Set(_hopBoard?.occupiedSet || []);
        for (const c of getNormalizedFootprint(_hopDesigPos, _hopDesigSize)) _hopOcc.delete(String(c).toLowerCase());
        // Push the designated figure via the game-layer applyHopOnPush (which
        // performs the pushFigure write) — the handler layer must not call
        // pushFigure directly (CRR-PSH-003 voluntary-exit invariant).
        const _hopRes = applyHopOnPush(game, playerNum, _hopDesigKey, {
          kuiilStartCoord: startCoord,
          kuiilNewCoord: newTopLeft,
          kuiilSize: newSize,
          designatedSize: _hopDesigSize,
          spacesSet: _hopBoard?.spacesSet || new Set(),
          occupiedSet: _hopOcc,
          blockingSet: _hopBoard?.blockingSet || new Set(),
        });
        if (_hopRes.entered && _hopRes.pushed) {
          await logGameAction(
            game, client,
            `**Hop On!** — **${displayName}** entered **${_hopDesigDc}**'s space (${String(_hopRes.fromPos).toUpperCase()}); pushed it 1 space to **${String(_hopRes.toPos).toUpperCase()}**.`,
            { phase: 'ROUND', icon: 'move' },
          );
        } else if (_hopRes.entered && !_hopRes.pushed) {
          // Entered but no legal push (blocked / off-board). Kuiil still occupies
          // the space (engine shares it transiently); the figure stays put.
          await logGameAction(
            game, client,
            `**Hop On!** — **${displayName}** entered **${_hopDesigDc}**'s space but it could not be pushed (no legal space ahead).`,
            { phase: 'ROUND', icon: 'move' },
          );
        }
      }
    }
  }
  // Attached (Dio): when Iden Versio exits Dio's space during movement, Dio may move up to 1 space
  {
    const _attachedTrigger = detectAttachedTrigger(game, playerNum, meta.dcName, startCoord, newTopLeft, path);
    if (_attachedTrigger) {
      const { dioFigureKey: _dioFk, dioPos: _dioPos, adjacencies: _dioAdj, defaultFollowSpace: _dioDefaultSpace } = _attachedTrigger;
      setPendingDioFollow(game, {
        dioFigureKey: _dioFk,
        dioPlayerNum: playerNum,
        currentSpace: _dioPos,
        followSpace: _dioDefaultSpace,
      });
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
        // Parting Blow: stash the reacting BRAWLER + exiting hostile so the
        // partingBlowEffect resolver can target correctly during the
        // opponent's move (findActiveActivationMsgId(holder) is null then).
        // candidateFigureKey is the holder's BRAWLER; figureKey is the mover.
        if (trigger.type === 'partingBlow') {
          game.pendingPartingBlow = {
            brawlerFigureKey: trigger.candidateFigureKey,
            brawlerPlayerNum: trigger.candidatePlayerNum,
            exitingHostileFigureKey: figureKey,
          };
        }
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
  saveGames(game.gameId);
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
  saveGames(game.gameId);
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
  saveGames(game.gameId);
}

/**
 * Handle cassian_kx_use_ — K-2S0's owner chose to gain the (optional, "up to 1")
 * Damage Token from Cassian Said I Had To. Consumes the once-per-round flag and
 * grants the token only on Use.
 */
export async function handleCassianSaidIHadTo(interaction, ctx) {
  const { getGame, logGameAction, saveGames, client } = ctx;
  const m = interaction.customId.match(/^cassian_kx_use_([^_]+)_(.+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, fk] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  try { await interaction.update({ components: [] }); } catch { try { await interaction.deferUpdate(); } catch { /* handled */ } }
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  const csKey = `cassian_said_i_had_to_${fk}`;
  if (game.roundFigureAbilityUsed[csKey]) {
    await interaction.followUp({ content: 'Already used this round.', ephemeral: true }).catch(discordCatch);
    return;
  }
  game.roundFigureAbilityUsed[csKey] = true;
  grantPowerTokens(game, fk, 'Damage', 1);
  const csDcName = dcNameFromFigureKey(fk);
  if (logGameAction) {
    await logGameAction(game, client, `**Cassian Said I Had To** — **${csDcName}** gained a Damage Token (friendly LEADER entered adjacent space).`, { phase: 'ROUND', icon: 'attack' });
  }
  saveGames(game.gameId);
}

/**
 * Handle cassian_kx_skip_ — owner declined the optional Damage Token. The
 * once-per-round flag is NOT consumed, so it may still trigger later this round.
 */
export async function handleCassianSaidIHadToSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const m = interaction.customId.match(/^cassian_kx_skip_([^_]+)_(.+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  try { await interaction.update({ components: [] }); } catch { try { await interaction.deferUpdate(); } catch { /* handled */ } }
  saveGames(game.gameId);
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

  // Remove the token, then exhaust the Overwatch card (effect fully resolves)
  if (game.overwatchTokenPosition) delete game.overwatchTokenPosition[owMsgId];
  exhaustAttachment(game, owMsgId, 'Overwatch');

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
  saveGames(game.gameId);
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
  saveGames(game.gameId);
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
  applyDioFollow(game, dioFigureKey, dioPlayerNum, space);
  clearPendingDioFollow(game);

  await interaction.message.edit({ content: `**Attached** — **Dio** moved from **${currentSpace.toUpperCase()}** to **${space.toUpperCase()}** (following Iden Versio).`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Attached** — **Dio** moved to **${space.toUpperCase()}** (following Iden Versio).`, { phase: 'ROUND', icon: 'move' });
  saveGames(game.gameId);
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

  clearPendingDioFollow(game);
  await interaction.message.edit({ content: `**Attached** — **Dio** stays put.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Attached** — Dio chose to stay (did not follow Iden).`, { phase: 'ROUND', icon: 'skip' });
  saveGames(game.gameId);
}

