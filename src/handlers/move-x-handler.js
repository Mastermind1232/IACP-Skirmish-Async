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
import { markMapDirty } from '../game/game-helpers.js';
import { getReachableSpaces, getMovementKeywords, initMassiveDisplacement, resolveNextDisplacements, getNormalizedFootprint, getMovementProfile, getBoardStateForMovement } from '../game/movement.js';
import { setPendingMassivePush, setPendingRushPush, setPendingShoulderRush, setPendingCrushChoice, clearPendingCrushChoice } from '../game/interrupts.js';
import { renderMassivePushSpacePrompt, renderMassivePushFigurePrompt } from './movement.js';
import { getPlayerId, opponentPlayerNum, ccHandKey, ccDiscardKey } from '../game/player-helpers.js';
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
  const { msgId, figureKey, playerNum, spaces, source, threadId, bypassCosts, nextAction } = opts;
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
    //   Travel keywords still bypass via getMovementProfile flags).
    bypassCosts: bypassCosts !== false,
    msgId,
    // Optional typed continuation that fires after the picker drains
    // (handleMoveXStep when remaining=0, handleMoveXDone, or
    // postMoveXPicker's no-candidates auto-finish). Drives compound
    // abilities — rollOneDieSpacePick (Mortar Launcher), sdpExplode
    // (IG-11 Self-Destruct), etc.
    nextAction: nextAction || null,
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
  // MASSIVE pushed-this-phase gate (CRR 2026-05-09): if the figure
  // already pushed during the current phase, refuse the move grant.
  // Flag clears at phase boundaries (cleanupActivation +
  // setRoundPhase).
  if (opts?.figureKey && game.massivePushedThisPhase?.[opts.figureKey]) {
    const dcName = dcNameFromFigureKey(opts.figureKey);
    await ctx.logGameAction?.(game, ctx.client,
      `🦿 **MASSIVE blocked** — **${dcName}** already pushed a figure this phase; cannot move again until next phase.`,
      { phase: 'ROUND', icon: 'move' });
    return;
  }
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
  const _isMassive = _isMovingFigureMassive(game, pending.figureKey);
  // Diagnostic: log _finishPicker entry + isMassive verdict so future
  // bug reports can tell whether the check even ran. Per user 2026-05-09:
  // AT-DP moved 3 spaces but no displacement; need to confirm whether
  // _isMovingFigureMassive returns true for the AT-DP figureKey.
  await ctx.logGameAction?.(game, ctx.client,
    `🦿 **_finishPicker** — figureKey=${pending.figureKey}, dcName=${pending.dcName || dcNameFromFigureKey(pending.figureKey)}, isMassive=${_isMassive}`,
    { phase: 'ROUND', icon: 'move' });
  if (_isMassive) {
    await _runMassiveDisplacement(game, ctx, pending);
  }
  // Per alexanbv 2026-05-12: if MASSIVE displacement created a
  // pendingMassivePush prompt, DEFER both the sequence-afterAction
  // AND the single-figure nextAction. Both fire from the
  // resumeDeferredAfterMassivePush helper once the displacement
  // queue drains via the massive-push dispatcher. Without this gate,
  // post-deploy and post-move-X chains race past the push and the
  // player loses the prompt entirely.
  if (game.pendingMassivePush) {
    // Defer single-figure nextAction (sdpExplode / freeAttackPrompt /
    // grantPowerToken / etc.) onto the unified deferral queue. The
    // sequence-afterAction deferral is added by _advanceMoveXSequence
    // below if it runs.
    if (nextAction) {
      const q = _ensureDeferredQueue(game);
      q.push({ kind: 'finishPickerNextAction', msgId, pending, nextAction });
    }
    if (game.pendingMoveXSequence && game.pendingMoveXSequence.currentMsgId === msgId) {
      await _advanceMoveXSequence(game, ctx);
    }
    ctx.saveGames?.(game.gameId);
    return;
  }
  // Multi-figure MP-gain orchestration: if a sequence is active and
  // this figure was the current one, mark it complete and advance
  // (post the next order-pick if more figures remain, else clear).
  if (game.pendingMoveXSequence && game.pendingMoveXSequence.currentMsgId === msgId) {
    await _advanceMoveXSequence(game, ctx);
  }
  if (!nextAction) return;
  await _runFinishPickerNextAction(game, ctx, msgId, pending, nextAction);
}

/**
 * Dispatch the single-figure Move-X nextAction. Extracted from
 * `_finishPicker` so the post-MASSIVE resume helper can fire the
 * same dispatch when the displacement queue drains.
 */
async function _runFinishPickerNextAction(game, ctx, msgId, pending, nextAction) {
  if (!nextAction || !nextAction.type) return;
  if (nextAction.type === 'rollOneDieSpacePick') {
    await _runRollOneDieSpacePickContinuation(game, ctx, msgId, pending, nextAction);
  } else if (nextAction.type === 'sdpExplode') {
    // Self-Destruct Protocol (IG-11): roll 1 red die at the figure's
    // current position, damage adjacents, then finalize defeat. The
    // existing _runSelfDestructExplode owns the dice + adjacency +
    // defeat finalization; we just hand it the payload.
    try {
      const { _runSelfDestructExplode } = await import('./interrupts.js');
      await _runSelfDestructExplode(game, nextAction.payload || {}, ctx);
    } catch (err) {
      console.error('[move-x] sdpExplode failed:', err?.message ?? err);
    }
  } else if (nextAction.type === 'freeAttackPrompt') {
    // Generic "after the move, take a free attack" continuation.
    // Used by Executor, Leaping Slash, Tonfa Strike, Fell Swoop,
    // Sidewinder, etc. The figure already has freeAttackBonusPending
    // set in abilities.js / fire-handler dispatch; this just posts
    // the explicit "Declare Attack" prompt so the player gets the
    // continuation as a click instead of a side-channel flag.
    await _runFreeAttackPromptContinuation(game, ctx, pending, nextAction);
  } else if (nextAction.type === 'freeSpecialPrompt') {
    // Generic "after the move, perform a free Special Action" continuation.
    // Used by Jundland Terror (immediate EOR interrupt). Posts a single
    // "Perform <Special>" button that routes to handleJtSpecial, which
    // resolves the chosen native special NOW at 0 action cost, out of
    // activation — mirrors freeAttackPrompt's out-of-activation attack button.
    await _runFreeSpecialPromptContinuation(game, ctx, pending, nextAction);
  } else if (nextAction.type === 'rushPostMove') {
    await _runRushPostMoveContinuation(game, ctx, pending);
  } else if (nextAction.type === 'shoulderRushPostMove') {
    await _runShoulderRushPostMoveContinuation(game, ctx, pending);
  } else if (nextAction.type === 'lordOfSithChoice') {
    await _runLordOfSithChoiceContinuation(game, ctx, pending);
  } else if (nextAction.type === 'cahTargetPick') {
    await _runCahTargetPickContinuation(game, ctx, pending, nextAction);
  } else if (nextAction.type === 'grantPowerToken') {
    await _runGrantPowerTokenContinuation(game, ctx, pending, nextAction);
  } else if (nextAction.type === 'whistlingBirdsRoll') {
    await _runWhistlingBirdsRollContinuation(game, ctx, pending, nextAction);
  } else if (nextAction.type === 'headbuttRoll') {
    await _runHeadbuttRollContinuation(game, ctx, pending, nextAction);
  } else if (nextAction.type === 'dbhForceChoke') {
    await _runDbhForceChokeContinuation(game, ctx, pending, nextAction);
  } else if (nextAction.type === 'dbhPostMovePick') {
    await _runDbhPostMovePickContinuation(game, ctx, pending, nextAction);
  }
  // Future continuation types plug in here.
}

/**
 * Post-move picker for [Driven by Hatred]: after the 2-space move-X
 * drains, post a Force Choke / Attack / Skip choice. Per alexanbv
 * 2026-05-10: the choice is made AFTER the move so the player can
 * see post-move adjacency before committing.
 */
async function _runDbhPostMovePickContinuation(game, ctx, pending, next) {
  const { client, logGameAction } = ctx;
  const msgId = next.payload?.msgId || pending.msgId;
  const playerNum = next.payload?.playerNum || pending.playerNum;
  const ownerId = getPlayerId(game, playerNum);
  const gameId = game.gameId;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dbh_post_choke_${gameId}_${msgId}`).setLabel('Force Choke (adjacent hostile)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`dbh_post_attack_${gameId}_${msgId}`).setLabel('Free Attack (-1 die)').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`dbh_post_skip_${gameId}_${msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  );
  await logGameAction?.(game, client,
    `<@${ownerId}> 🩸 **Driven by Hatred** — move complete. Choose: Force Choke an adjacent hostile (2 Dmg + 1 Strain), free Melee Attack (-1 die from pool), or Skip.`,
    { components: [row], allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card' });
}

/**
 * Exposed wrapper around _runDbhForceChokeContinuation so the post-move
 * handler (handleDbhPostMove) can fire the Force Choke target picker
 * after the player makes the post-move choice. The wrapper accepts a
 * minimal "pending" shape so it doesn't need an actual pendingMoveX.
 */
export async function _runDbhForceChokeContinuationDirect(game, ctx, { msgId, playerNum, figureKey }) {
  await _runDbhForceChokeContinuation(game, ctx, { msgId, playerNum, figureKey }, { payload: { msgId, playerNum } });
}

/**
 * [Driven by Hatred] post-move Force Choke target picker. Mirrors the
 * Lord of the Sith Force Choke phase: presents adjacent-hostile
 * picker computed against the figure's NEW position, applies 2 Dmg +
 * 1 Strain on selection.
 */
async function _runDbhForceChokeContinuation(game, ctx, pending, next) {
  const { client, logGameAction, dcMessageMeta, dcHealthState } = ctx;
  const playerNum = next.payload?.playerNum || pending.playerNum;
  const oppNum = playerNum === 1 ? 2 : 1;
  const pos = game.figurePositions?.[playerNum]?.[pending.figureKey];
  if (!pos) return;
  const mapId = game.selectedMap?.id;
  const ms = mapId ? getMapData(mapId) : null;
  const adjSet = new Set((ms?.adjacency?.[String(pos).toLowerCase()] || []).map(s => String(s).toLowerCase()));
  const hostiles = [];
  for (const [fk, fpos] of Object.entries(game.figurePositions?.[oppNum] || {})) {
    if (!fpos || !adjSet.has(String(fpos).toLowerCase())) continue;
    hostiles.push(fk);
  }
  if (hostiles.length === 0) {
    await logGameAction?.(game, client, `**Driven by Hatred** — no adjacent hostile after the move; Force Choke fizzles.`, { phase: 'ROUND', icon: 'card' });
    return;
  }
  // Auto-apply when only one adjacent hostile (matches LotS phase).
  const apply = async (targetFigureKey) => {
    const { findMsgIdForFigureKey, syncHealthStateToList } = await import('../game/index.js').catch(() => ({}));
    const tMsgId = typeof findMsgIdForFigureKey === 'function'
      ? findMsgIdForFigureKey(game, oppNum, targetFigureKey, dcMessageMeta)
      : null;
    let dmgNote = '2 Damage manually';
    if (tMsgId && dcHealthState) {
      const hs = dcHealthState.get(tMsgId) || [];
      const fkM = targetFigureKey.match(/-(\d+)-(\d+)$/);
      const fi = fkM ? parseInt(fkM[2], 10) : 0;
      const hp = hs[fi];
      if (hp) {
        // Unified damage pipeline (alexanbv 2026-06-22): all suffer-damage
        // routes through applyDamage so when-damaged / before-defeated /
        // when-defeated hooks + CC windows fire. Strain via applyStrain below.
        const { applyDamage } = await import('../game/damage-pipeline.js');
        const _dbhRes = await applyDamage(game, ctx, {
          figureKey: targetFigureKey, msgId: tMsgId, figIndex: fi,
          amount: 2, controllerPlayerNum: oppNum, attackerPlayerNum: playerNum,
          source: 'Driven by Hatred', combat: false,
        });
        if (_dbhRes?.wasDefeated && ctx.processFigureDefeat) {
          await ctx.processFigureDefeat(game, {
            defeatedPlayerNum: oppNum, figureKey: targetFigureKey, msgId: tMsgId,
            attackerPlayerNum: playerNum, source: 'Driven by Hatred',
          });
        }
        dmgNote = `2 Damage (HP: ${_dbhRes.prevHp} → ${_dbhRes.newHp}) + 1 Strain (queued)`;
      }
    }
    // Route 1 Strain through applyStrain (Fireproof / Headhunter / per-
    // strain choice / Under Duress / Paz).
    const { applyStrain } = await import('./strain-handler.js');
    await applyStrain(game, ctx, {
      figureKey: targetFigureKey,
      controllerPlayerNum: oppNum,
      amount: 1,
      source: 'Driven by Hatred — Force Choke',
    });
    await logGameAction?.(game, client, `**Driven by Hatred** — Force Choke **${dcNameFromFigureKey(targetFigureKey)}**: ${dmgNote}.`, { phase: 'ROUND', icon: 'card' });
  };
  if (hostiles.length === 1) {
    await apply(hostiles[0]);
    return;
  }
  // Multiple adjacent → cc_choice picker; 'Driven by Hatred' isn't an
  // ability-library entry so we synthesize a one-shot pendingCcChoice
  // that resolves right back here through a direct ability dispatch
  // — easiest path is to reuse Lord of the Sith Phase 3 since the
  // damage shape is identical (2 Dmg + 1 Strain, post-move adj).
  const ownerId = getPlayerId(game, playerNum);
  const labels = hostiles.map(fk => `Force Choke: ${dcNameFromFigureKey(fk)}`);
  game.pendingCcChoice = {
    gameId: game.gameId,
    playerNum,
    cardName: 'Driven by Hatred',
    abilityId: 'Lord of the Sith',
    choiceOptions: labels,
    choiceValues: hostiles,
  };
  const btns = labels.slice(0, 20).map((label) => new ButtonBuilder()
    .setCustomId(`cc_choice_${game.gameId}_${label}`)
    .setLabel(label.length > 80 ? label.slice(0, 77) + '…' : label)
    .setStyle(ButtonStyle.Danger));
  const rows = chunkButtonsToRows(btns).slice(0, 5);
  await logGameAction?.(game, client, `<@${ownerId}> 🩸 **Driven by Hatred** — choose an adjacent hostile to Force Choke (2 Dmg + 1 Strain):`, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card', interrupt: true });
}

/**
 * Headbutt post-move: roll 1 die against an adjacent hostile (auto-pick
 * if exactly one, prompt if multiple). Damage = # Hits.
 */
async function _runHeadbuttRollContinuation(game, ctx, pending, next) {
  const payload = next.payload || {};
  const { client, logGameAction, dcMessageMeta, dcHealthState } = ctx;
  const playerNum = payload.playerNum || pending.playerNum;
  const figureKey = payload.figureKey || pending.figureKey;
  const dieColor = (payload.dieColor || 'red').toLowerCase();
  const label = payload.label || 'Headbutt';
  const oppNum = playerNum === 1 ? 2 : 1;
  const mapId = game.selectedMap?.id;
  if (!mapId) {
    await logGameAction?.(game, client, `**${label}** — no map data; resolve attack manually.`, { phase: 'ROUND', icon: 'card' });
    return;
  }
  const { getFiguresAdjacentToTarget } = await import('../game/spatial.js').catch(() => ({}));
  if (typeof getFiguresAdjacentToTarget !== 'function') return;
  const adj = getFiguresAdjacentToTarget(game, figureKey, mapId);
  const hostiles = adj.filter(f => f.playerNum === oppNum);
  if (hostiles.length === 0) {
    await logGameAction?.(game, client, `**${label}** — no adjacent hostile; effect fizzles.`, { phase: 'ROUND', icon: 'card' });
    return;
  }
  const rollAndApply = async (targetFigureKey) => {
    const { getDiceData: gdLazy } = await import('../data-loader.js');
    const faces = gdLazy()?.attack?.[dieColor] || [];
    if (!faces.length) {
      await logGameAction?.(game, client, `**${label}** — Roll 1 ${dieColor} die against **${dcNameFromFigureKey(targetFigureKey)}** manually.`, { phase: 'ROUND', icon: 'card' });
      return;
    }
    const _hbFaceIdx = Math.floor(Math.random() * faces.length);
    const face = faces[_hbFaceIdx];
    // Show the rolled die FACE in the activation thread (mirrors combat).
    try {
      if (pending.threadId) {
        const _hbThread = await fetchCombatThread(client, pending.threadId).catch(() => null);
        if (_hbThread) {
          const { postDieRollResult } = await import('../discord/dice-renderer.js');
          await postDieRollResult(_hbThread, {
            content: `🎲 **${label}** — rolled 1 ${dieColor} die:`,
            dice: [{ color: dieColor, faceIdx: _hbFaceIdx, dmg: face.dmg ?? 0, surge: face.surge ?? 0, acc: face.acc ?? 0 }],
          });
        }
      }
    } catch { /* never block the ability flow on the reveal */ }
    const hits = face.dmg ?? 0;
    const dieParts = [];
    if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
    if (face.surge) dieParts.push(`${face.surge} Surge${face.surge !== 1 ? 's' : ''}`);
    const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
    let resPart = '';
    if (hits > 0) {
      const { findMsgIdForFigureKey, syncHealthStateToList } = await import('../game/index.js').catch(() => ({}));
      const targetMsgId = typeof findMsgIdForFigureKey === 'function' ? findMsgIdForFigureKey(game, oppNum, targetFigureKey, dcMessageMeta) : null;
      if (targetMsgId && dcHealthState) {
        const hs = dcHealthState.get(targetMsgId) || [];
        const fkMatch = targetFigureKey.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const hp = hs[figIdx];
        if (hp) {
          // Unified damage pipeline (alexanbv 2026-06-22).
          const { applyDamage } = await import('../game/damage-pipeline.js');
          const _hbcRes = await applyDamage(game, ctx, {
            figureKey: targetFigureKey, msgId: targetMsgId, figIndex: figIdx,
            amount: hits, controllerPlayerNum: oppNum, attackerPlayerNum: playerNum,
            source: 'Headbutt', combat: false,
          });
          if (_hbcRes?.wasDefeated && ctx.processFigureDefeat) {
            await ctx.processFigureDefeat(game, {
              defeatedPlayerNum: oppNum, figureKey: targetFigureKey, msgId: targetMsgId,
              attackerPlayerNum: playerNum, source: 'Headbutt',
            });
          }
          resPart = ` — ${hits} Damage (HP: ${_hbcRes.prevHp} → ${_hbcRes.newHp})`;
        }
      }
    }
    await logGameAction?.(game, client, `**${label}** — Rolled 1 ${dieColor} die: **${diceResult}**. **${dcNameFromFigureKey(targetFigureKey)}**${resPart}.`, { phase: 'ROUND', icon: 'card' });
  };
  if (hostiles.length === 1) {
    await rollAndApply(hostiles[0].figureKey);
    return;
  }
  // Multiple adjacent hostiles → target picker via pendingCcChoice.
  const ownerId = getPlayerId(game, playerNum);
  const choiceOptions = hostiles.map(h => `Target: ${dcNameFromFigureKey(h.figureKey)}`);
  game.pendingCcChoice = {
    gameId: game.gameId,
    playerNum,
    cardName: label,
    abilityId: 'headbutt_tauntaun',
    choiceOptions,
    choiceValues: hostiles.map(h => h.figureKey),
  };
  const btns = choiceOptions.slice(0, 20).map((lbl) => new ButtonBuilder()
    .setCustomId(`cc_choice_${game.gameId}_${lbl}`)
    .setLabel(lbl.length > 80 ? lbl.slice(0, 77) + '…' : lbl)
    .setStyle(ButtonStyle.Danger));
  const rows = chunkButtonsToRows(btns).slice(0, 5);
  await logGameAction?.(game, client, `<@${ownerId}> 🐂 **${label}** — choose an adjacent hostile to ram:`, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card', interrupt: true });
}

/**
 * Whistling Birds post-move: roll 1 red die, then deal that many
 * Damage to up to 3 hostiles within 2 spaces of the figure's NEW
 * position. Mirrors the prior whistlingBirdsEffect dispatch's
 * application logic, just using the post-move adjacency.
 */
async function _runWhistlingBirdsRollContinuation(game, ctx, pending, next) {
  const { client, logGameAction } = ctx;
  const { getDiceData: gd } = ctx;
  const playerNum = next.payload?.playerNum || pending.playerNum;
  const { getDiceData } = await import('../data-loader.js');
  const faces = (gd?.()?.attack?.red) || (getDiceData()?.attack?.red) || [];
  if (!faces.length) {
    await logGameAction?.(game, client, '**Whistling Birds** — Roll 1 red die manually (dice data unavailable).', { phase: 'ROUND', icon: 'card' });
    return;
  }
  const _wbFaceIdx = Math.floor(Math.random() * faces.length);
  const face = faces[_wbFaceIdx];
  // Show the rolled die FACE in the activation thread (mirrors combat).
  try {
    if (pending.threadId) {
      const _wbThread = await fetchCombatThread(client, pending.threadId).catch(() => null);
      if (_wbThread) {
        const { postDieRollResult } = await import('../discord/dice-renderer.js');
        await postDieRollResult(_wbThread, {
          content: '🎲 **Whistling Birds** — rolled 1 red die:',
          dice: [{ color: 'red', faceIdx: _wbFaceIdx, dmg: face.dmg ?? 0, surge: face.surge ?? 0, acc: face.acc ?? 0 }],
        });
      }
    }
  } catch { /* never block the ability flow on the reveal */ }
  const hits = face.dmg ?? 0;
  if (hits === 0) {
    await logGameAction?.(game, client, '**Whistling Birds** — Rolled 1 red die: **0 Hits** — no Damage applied.', { phase: 'ROUND', icon: 'card' });
    return;
  }
  const activatorPos = game.figurePositions?.[playerNum]?.[pending.figureKey];
  if (!activatorPos) {
    await logGameAction?.(game, client, `**Whistling Birds** — rolled **${hits}** but activator position is missing; resolve manually.`, { phase: 'ROUND', icon: 'card' });
    return;
  }
  const { countGameSpaces } = await import('../game/movement.js').catch(() => ({}));
  // CSV (docs/combat-spec.csv:870): "Choose up to 3 FIGURES within 2 spaces ...
  // each suffers Damage equal to the Hit results." Target is "figures" (friendly
  // OR hostile, excluding only the activator) and the controlling player CHOOSES
  // which up-to-3. Enumerate all figures (both players) within 2 spaces, then
  // hand off to the whistlingBirdsEffect Phase-2 picker via pendingCcChoice.
  const candidates = [];
  const labels = [];
  for (const pn of [1, 2]) {
    for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!coord || fk === pending.figureKey) continue;
      if (typeof countGameSpaces === 'function' && countGameSpaces(game, activatorPos, coord) > 2) continue;
      candidates.push(fk);
      labels.push(dcNameFromFigureKey(fk));
    }
  }
  if (candidates.length === 0) {
    await logGameAction?.(game, client, `**Whistling Birds** — Rolled 1 red die: **${hits} Hit${hits !== 1 ? 's' : ''}** → no figures within 2 spaces.`, { phase: 'ROUND', icon: 'card' });
    return;
  }
  // Stamp the pending state the whistlingBirdsEffect Phase-2 resolver reads.
  game._whistlingBirdsPending = {
    hits,
    playerNum,
    figureKey: pending.figureKey,
    targets: [],
    playerOf: {},
    armed: true,
  };
  const ownerId = getPlayerId(game, playerNum);
  // pendingCcChoice routes each pick back through handleCcChoice →
  // resolveAbility('Whistling Birds', { chosenFigureKey }) (multi-pick loop).
  game.pendingCcChoice = {
    gameId: game.gameId,
    playerNum,
    cardName: 'Whistling Birds',
    abilityId: 'Whistling Birds',
    choiceOptions: [...labels, `Done (0 chosen)`],
    choiceValues: [...candidates, 'whistling_birds_done'],
  };
  // Cap candidate buttons at 24 so the Done button always fits within Discord's
  // 25-button (5-row) max and is never dropped (alexanbv 2026-06-21: 25 is
  // enough; board density keeps figures-within-2 well under this in practice).
  const btns = labels.slice(0, 24).map((label) => new ButtonBuilder()
    .setCustomId(`cc_choice_${game.gameId}_${label}`)
    .setLabel(label.length > 80 ? label.slice(0, 77) + '…' : label)
    .setStyle(ButtonStyle.Danger));
  btns.push(new ButtonBuilder()
    .setCustomId(`cc_choice_${game.gameId}_whistling_birds_done`)
    .setLabel('Done')
    .setStyle(ButtonStyle.Secondary));
  const rows = chunkButtonsToRows(btns);
  const content = `<@${ownerId}> **Whistling Birds** — Rolled 1 red die: **${hits} Hit${hits !== 1 ? 's' : ''}**. Choose up to 3 figures within 2 spaces (each suffers ${hits} Damage):`;
  if (pending.threadId) {
    const thread = await fetchCombatThread(client, pending.threadId);
    if (thread) {
      await thread.send({ content, components: rows, allowedMentions: { users: [ownerId] } }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card', interrupt: true });
}

/**
 * Power-token grant continuation. Used when a Move-X ability also
 * grants a Power Token (Looking for a Fight). After the picker drains,
 * sets pendingPowerTokenGrant + posts the token-type prompt so the
 * player picks Block / Evade / Damage / Surge.
 */
async function _runGrantPowerTokenContinuation(game, ctx, pending, next) {
  const payload = next.payload || {};
  const grantFigureKey = payload.figureKey || pending.figureKey;
  const playerNum = payload.playerNum || pending.playerNum;
  const count = payload.count || 1;
  if (!grantFigureKey || !playerNum) return;
  game.pendingPowerTokenGrant = {
    grants: [{ figureKey: grantFigureKey, figName: dcNameFromFigureKey(grantFigureKey), count }],
    channelId: null,
    playerNum,
  };
  try {
    const { client } = ctx;
    const thread = await fetchCombatThread(client, game).catch(() => null);
    if (thread) {
      game.pendingPowerTokenGrant.channelId = thread.id;
      const { sendPowerTokenChoicePrompt } = await import('./combat.js');
      await sendPowerTokenChoicePrompt(thread, game.gameId, game.pendingPowerTokenGrant.grants);
    }
  } catch (err) {
    console.error('[move-x] grantPowerToken continuation failed:', err?.message ?? err);
  }
}

/**
 * "Choose adjacent hostile, then" target picker continuation.
 * Used by Ambush, Force Surge, and any Move-X CC that follows the
 * move with an adjacent-hostile damage/strain effect. Recomputes
 * adjacent hostiles from the figure's NEW post-move position and
 * posts the target picker via game.pendingCcChoice → handleCcChoice
 * → resolveAbility(cardName, { chosenFigureKey }) for the existing
 * Phase-2 damage application.
 */
async function _runCahTargetPickContinuation(game, ctx, pending, next) {
  const { client, logGameAction } = ctx;
  const payload = next.payload || {};
  const cardName = payload.cardName;
  const playerNum = payload.playerNum;
  if (!cardName || !playerNum) return;
  const pos = game.figurePositions?.[playerNum]?.[pending.figureKey];
  if (!pos) return;
  const mapId = game.selectedMap?.id;
  const ms = mapId ? getMapData(mapId) : null;
  const adjacency = ms?.adjacency || {};
  const adjSet = new Set((adjacency[String(pos).toLowerCase()] || []).map(s => String(s).toLowerCase()));
  const oppNum = playerNum === 1 ? 2 : 1;
  const hostiles = [];
  const hostileLabels = [];
  for (const [fk, fpos] of Object.entries(game.figurePositions?.[oppNum] || {})) {
    if (!fpos || !adjSet.has(String(fpos).toLowerCase())) continue;
    hostiles.push(fk);
    hostileLabels.push(dcNameFromFigureKey(fk));
  }
  if (hostiles.length === 0) {
    await logGameAction?.(game, client, `**${cardName}** — no adjacent hostile after the move; effect skipped.`, { phase: 'ROUND', icon: 'card' });
    return;
  }
  const ownerId = getPlayerId(game, playerNum);
  // Set up pendingCcChoice so handleCcChoice can route the click back
  // through resolveAbility with chosenFigureKey for damage application.
  game.pendingCcChoice = {
    gameId: game.gameId,
    playerNum,
    cardName,
    abilityId: cardName,
    choiceOptions: hostileLabels,
    choiceValues: hostiles,
  };
  const btns = hostileLabels.map((label, i) => new ButtonBuilder()
    .setCustomId(`cc_choice_${game.gameId}_${label}`)
    .setLabel(label.length > 80 ? label.slice(0, 77) + '…' : label)
    .setStyle(ButtonStyle.Danger));
  const rows = chunkButtonsToRows(btns).slice(0, 5);
  const dmgNote = (payload.damage || 0) > 0 && (payload.strain || 0) > 0
    ? `${payload.damage} Damage + ${payload.strain} Strain`
    : (payload.damage || 0) > 0 ? `${payload.damage} Damage`
    : (payload.strain || 0) > 0 ? `${payload.strain} Strain`
    : 'effect';
  const content = `<@${ownerId}> **${cardName}** — choose an adjacent hostile to deal ${dmgNote}:`;
  if (pending.threadId) {
    const thread = await fetchCombatThread(client, pending.threadId);
    if (thread) {
      await thread.send({ content, components: rows, allowedMentions: { users: [ownerId] } }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card', interrupt: true });
}

/**
 * Lord of the Sith post-move continuation: present a 2-button picker
 * (Force Choke / Free Melee Attack) that routes back through
 * handleCcChoice → resolveAbility('Lord of the Sith', { choiceIndex }).
 * Force Choke target picker fires from Vader's NEW position; the
 * adjacency rules are computed at choice-resolution time.
 */
async function _runLordOfSithChoiceContinuation(game, ctx, pending) {
  const { client, logGameAction } = ctx;
  const ownerId = getPlayerId(game, pending.playerNum);
  const choiceOptions = ['Force Choke adjacent hostile (2 Dmg + 2 Strain)', 'Perform free Melee attack'];
  game.pendingCcChoice = {
    gameId: game.gameId,
    playerNum: pending.playerNum,
    cardName: 'Lord of the Sith',
    abilityId: 'Lord of the Sith',
    choiceOptions,
  };
  const btns = choiceOptions.map(opt => new ButtonBuilder()
    .setCustomId(`cc_choice_${game.gameId}_${opt}`)
    .setLabel(opt.length > 80 ? opt.slice(0, 77) + '…' : opt)
    .setStyle(ButtonStyle.Primary));
  const rows = chunkButtonsToRows(btns).slice(0, 5);
  const content = `<@${ownerId}> ⚔\u{FE0F} **Lord of the Sith** — choose:`;
  if (pending.threadId) {
    const thread = await fetchCombatThread(client, pending.threadId);
    if (thread) {
      await thread.send({ content, components: rows, allowedMentions: { users: [ownerId] } }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card', interrupt: true });
}

/** Push-immunity check shared by every Move-X-then-push continuation
 *  (Rush, Shoulder Rush, Ram, Headbutt, On a Mission, etc.).
 *  Snowtroopers (Spiked Boots) and any figure with the round-scoped
 *  Take Position immunity (game.roundPushImmuneUnlessMassive) cannot
 *  be pushed — UNLESS the pusher is a MASSIVE figure. Returns true
 *  if the targetFigureKey is push-immune relative to the pusher. */
function _isPushImmune(game, pusherDcName, targetFigureKey) {
  const dcEffects = getDcEffects() || {};
  const targetDcName = dcNameFromFigureKey(targetFigureKey);
  const targetEff = dcEffects[targetDcName];
  const pusherEff = dcEffects[pusherDcName];
  const pusherIsMassive = (pusherEff?.keywords || [])
    .some(k => String(k).toUpperCase() === 'MASSIVE');
  if (pusherIsMassive) return false; // Massive overrides all push-immunity
  if ((targetEff?.specialAbilityIds || []).includes('spiked_boots_snowtrooper')) return true;
  if (game.roundPushImmuneUnlessMassive?.[targetFigureKey]) return true;
  return false;
}

/** Compute adjacent figures of a given side relative to the moving
 *  figure's current position. Returns [{ figureKey, dcName }]. */
function _computeAdjacentFigures(game, pending, sideFilter /* 'hostile' | 'friendly' | 'any' */) {
  const pos = game.figurePositions?.[pending.playerNum]?.[pending.figureKey];
  if (!pos) return [];
  const mapId = game.selectedMap?.id;
  const ms = mapId ? getMapData(mapId) : null;
  const adjacency = ms?.adjacency || {};
  const adjSpaces = new Set((adjacency[String(pos).toLowerCase()] || []).map(s => String(s).toLowerCase()));
  const oppNum = pending.playerNum === 1 ? 2 : 1;
  const out = [];
  const sides = sideFilter === 'hostile' ? [oppNum] : sideFilter === 'friendly' ? [pending.playerNum] : [1, 2];
  for (const pn of sides) {
    for (const [fk, fpos] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!fpos) continue;
      if (pn === pending.playerNum && fk === pending.figureKey) continue;
      if (!adjSpaces.has(String(fpos).toLowerCase())) continue;
      out.push({ figureKey: fk, dcName: dcNameFromFigureKey(fk), playerNum: pn });
    }
  }
  return out;
}

/**
 * Rush (Onar Koma) post-move continuation: prompt for adjacent
 * SMALL hostile to push 1 space; both figures suffer 1 Damage.
 * Posts the existing rush_push_fig_ buttons that hand off to the
 * existing handleRushPushFig flow.
 */
async function _runRushPostMoveContinuation(game, ctx, pending) {
  const { client, logGameAction } = ctx;
  // CSV "an adjacent SMALL figure" — no hostile qualifier, so a friendly
  // SMALL figure may also be chosen as the push target.
  const adj = _computeAdjacentFigures(game, pending, 'any');
  const dcEffects = getDcEffects() || {};
  const rushTargets = [];
  for (const t of adj) {
    const eff = dcEffects[t.dcName];
    const kw = (eff?.keywords || []).map(k => String(k).toUpperCase());
    if (kw.includes('LARGE') || kw.includes('MASSIVE')) continue;
    if (_isPushImmune(game, pending.dcName, t.figureKey)) continue;
    rushTargets.push(t);
  }
  if (rushTargets.length === 0) {
    await logGameAction?.(game, client, `**Rush** — **${pending.dcName}** ends movement; no adjacent SMALL figure to push.`, { phase: 'ROUND', icon: 'attack' });
    return;
  }
  const pos = game.figurePositions?.[pending.playerNum]?.[pending.figureKey];
  setPendingRushPush(game, {
    msgId: pending.msgId,
    playerNum: pending.playerNum,
    activatorFigureKey: pending.figureKey,
    activatorPos: pos,
    targets: rushTargets.map(t => t.figureKey),
  });
  const btns = rushTargets.map((t, i) => new ButtonBuilder()
    .setCustomId(`rush_push_fig_${game.gameId}_${pending.msgId}_${i}`)
    .setLabel(t.dcName.replace(/_/g, ' '))
    .setStyle(ButtonStyle.Primary));
  btns.push(new ButtonBuilder()
    .setCustomId(`rush_push_skip_${game.gameId}_${pending.msgId}`)
    .setLabel('Skip Rush Push')
    .setStyle(ButtonStyle.Secondary));
  const rows = chunkButtonsToRows(btns).slice(0, 5);
  const content = `**Rush** — Push an adjacent SMALL figure 1 space? Both suffer 1 Damage.`;
  if (pending.threadId) {
    const thread = await fetchCombatThread(client, pending.threadId);
    if (thread) {
      await thread.send({ content, components: rows }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, { components: rows, phase: 'ROUND', icon: 'attack', interrupt: true });
}

/**
 * Shoulder Rush (KX-Series Security Droid Elite) post-move
 * continuation: prompt for adjacent hostile, push if SMALL + enter
 * vacated space, then declare a free attack against that figure.
 * Posts the existing shoulder_rush_fig_ buttons.
 */
async function _runShoulderRushPostMoveContinuation(game, ctx, pending) {
  const { client, logGameAction } = ctx;
  const adj = _computeAdjacentFigures(game, pending, 'hostile');
  if (adj.length === 0) {
    await logGameAction?.(game, client, `**Shoulder Rush** — **${pending.dcName}** ends movement; no adjacent hostile to target.`, { phase: 'ROUND', icon: 'attack' });
    return;
  }
  const pos = game.figurePositions?.[pending.playerNum]?.[pending.figureKey];
  setPendingShoulderRush(game, {
    msgId: pending.msgId,
    playerNum: pending.playerNum,
    activatorFigureKey: pending.figureKey,
    activatorPos: pos,
    targets: adj.map(t => t.figureKey),
  });
  const btns = adj.map((t, i) => new ButtonBuilder()
    .setCustomId(`shoulder_rush_fig_${game.gameId}_${pending.msgId}_${i}`)
    .setLabel(t.dcName.replace(/_/g, ' '))
    .setStyle(ButtonStyle.Primary));
  btns.push(new ButtonBuilder()
    .setCustomId(`shoulder_rush_skip_${game.gameId}_${pending.msgId}`)
    .setLabel('Skip (No Target)')
    .setStyle(ButtonStyle.Secondary));
  const rows = chunkButtonsToRows(btns).slice(0, 5);
  const content = `**Shoulder Rush** — Choose an adjacent hostile figure to target:`;
  if (pending.threadId) {
    const thread = await fetchCombatThread(client, pending.threadId);
    if (thread) {
      await thread.send({ content, components: rows }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, { components: rows, phase: 'ROUND', icon: 'attack', interrupt: true });
}

/**
 * "Declare Attack" prompt continuation. Posts a single button in the
 * figure's combat thread (or game-log channel as fallback) that
 * routes through the standard granted-attack pipeline. The free-
 * attack flag (freeAttackBonusPending / fellSwoopFreeAttack /
 * pendingExecutiveOrder) is already set by the originating dispatch
 * — combat.js consumes it to mark the attack as free.
 */
async function _runFreeAttackPromptContinuation(game, ctx, pending, next) {
  const { client, logGameAction } = ctx;
  const payload = next.payload || {};
  const granteeMsgId = payload.msgId || pending.msgId;
  const granteeFigureKey = payload.figureKey || pending.figureKey;
  const sourceLabel = payload.sourceLabel || pending.source || 'Free Attack';
  const granteeName = pending.dcName || dcNameFromFigureKey(granteeFigureKey);
  if (!granteeMsgId || !granteeFigureKey) return;
  const ownerId = getPlayerId(game, pending.playerNum);

  // If a forcedAttackTarget is set for this grantee (e.g. Battlefield
  // Leadership: friendly must attack Leia's target), verify the grantee
  // has Line of Sight to the forced target from its CURRENT post-move
  // position. Per alexanbv 2026-05-10: BL friendly "may move 1 and not
  // gain los, in which case it does not attack." If no LoS, do not
  // post the attack button; clean up forced-target + BL pending state
  // and log the outcome.
  // Per alexanbv 2026-05-13: forcedAttackTarget keyed by grantee
  // figureKey post-migration.
  const forcedTargetFk = game.forcedAttackTarget?.[granteeFigureKey];
  if (forcedTargetFk) {
    try {
      const { hasLineOfSightByCoord } = await import('../game/spatial.js').catch(() => ({}));
      const { getMapData, getFigureSize } = await import('../data-loader.js').catch(() => ({}));
      const mapId = game.selectedMap?.id;
      const ms = mapId && typeof getMapData === 'function' ? getMapData(mapId) : null;
      const granteePos = game.figurePositions?.[pending.playerNum]?.[granteeFigureKey];
      // Forced target may be on either player; check both.
      const targetPos = game.figurePositions?.[1]?.[forcedTargetFk] || game.figurePositions?.[2]?.[forcedTargetFk] || null;
      if (typeof hasLineOfSightByCoord === 'function' && ms && granteePos && targetPos) {
        const hasLos = hasLineOfSightByCoord(game, granteePos, targetPos, ms, getFigureSize);
        if (!hasLos) {
          // No LoS: free attack skipped. Clean up state.
          delete game.forcedAttackTarget[granteeFigureKey];
          if (game.pendingBattlefieldLeadership) {
            try {
              const { clearPendingBattlefieldLeadership } = await import('../game/interrupts.js');
              clearPendingBattlefieldLeadership(game);
            } catch {}
          }
          if (game.freeAttackBonusPending?.[granteeFigureKey]) {
            delete game.freeAttackBonusPending[granteeFigureKey];
          }
          const noLosMsg = `⚔️ **${sourceLabel}** — **${granteeName}** does not have line of sight to **${dcNameFromFigureKey(forcedTargetFk)}** after moving. Free attack is skipped.`;
          if (pending.threadId) {
            const thread = await fetchCombatThread(client, pending.threadId);
            if (thread) {
              await thread.send({ content: noLosMsg }).catch(discordCatch);
              return;
            }
          }
          await logGameAction?.(game, client, noLosMsg, { phase: 'ROUND', icon: 'attack' });
          return;
        }
      }
    } catch (err) {
      console.error('Free-attack LoS check failed:', err?.message ?? err);
    }
  }

  const _gabFkMatch = String(granteeFigureKey).match(/-(\d+)-(\d+)$/);
  const _gabFigIdx = _gabFkMatch ? _gabFkMatch[2] : '0';
  const btn = new ButtonBuilder()
    .setCustomId(`granted_attack_${game.gameId}_${granteeMsgId}_f${_gabFigIdx}`)
    .setLabel(`Declare Attack (${granteeName})`)
    .setStyle(ButtonStyle.Danger);
  const row = new ActionRowBuilder().addComponents(btn);
  const content = `<@${ownerId}> ⚔\u{FE0F} **${sourceLabel}** — click below to declare the free attack with **${granteeName}**.`;
  if (pending.threadId) {
    const thread = await fetchCombatThread(client, pending.threadId);
    if (thread) {
      await thread.send({ content, components: [row], allowedMentions: { users: [ownerId] } }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, { components: [row], allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack', interrupt: true });
}

/**
 * REUSABLE "interrupt to perform a Special Action" continuation. Posts a
 * single button that, when clicked, resolves a specific NATIVE Special
 * Action for the grantee figure NOW — out of activation, at 0 action cost.
 *
 * The button routes to handleJtSpecial (dc-play-area.js), which synthesizes a
 * minimal, 0-cost, out-of-activation activation context and re-dispatches the
 * exact dc_special_<idx>_<msgId> into the standard special pipeline
 * (handleDcAction → resolveAbility + applyAbilityResult). This means every
 * special branch (Trample target picker, Tusken Cycler's own attack, pounce
 * space-pick, etc.) is reused without re-implementation.
 *
 * Other effects that need an immediate free Special Action can chain a
 * { type: 'freeSpecialPrompt', payload: { msgId, playerNum, figureKey,
 *   specialIdx, specialLabel, sourceLabel } } nextAction off their Move-X
 * picker (or call postFreeSpecialPrompt directly).
 */
async function _runFreeSpecialPromptContinuation(game, ctx, pending, next) {
  const payload = next.payload || {};
  await postFreeSpecialPrompt(game, ctx, {
    msgId: payload.msgId || pending.msgId,
    playerNum: payload.playerNum || pending.playerNum,
    figureKey: payload.figureKey || pending.figureKey,
    specialIdx: payload.specialIdx,
    specialLabel: payload.specialLabel,
    sourceLabel: payload.sourceLabel || pending.source || 'Free Special Action',
    threadId: pending.threadId,
    dcName: pending.dcName,
  });
}

/**
 * Post the out-of-activation "Perform <Special>" interrupt button.
 * customId: jt_special_<gameId>_<msgId>_<specialIdx>
 * @param {object} opts - { msgId, playerNum, figureKey, specialIdx, specialLabel, sourceLabel, threadId?, dcName? }
 */
export async function postFreeSpecialPrompt(game, ctx, opts) {
  const { client, logGameAction } = ctx;
  const { msgId, playerNum, figureKey, specialIdx, specialLabel, sourceLabel } = opts;
  if (!msgId || specialIdx == null || specialIdx < 0) return;
  const granteeName = opts.dcName || dcNameFromFigureKey(figureKey);
  const ownerId = getPlayerId(game, playerNum);
  const label = `Perform ${specialLabel || 'Special Action'} (${granteeName})`.slice(0, 80);
  // Thread the chosen figure's index so a multi-figure group (Tusken Raiders
  // deploy as a group) resolves the special as the EXACT figure picked in
  // Phase 1, not group-figure 0. figureKey = "<DcName>-<dg>-<figIdx>".
  const _figIdx = (String(figureKey || '').match(/-(\d+)$/) || [])[1] ?? '0';
  const btn = new ButtonBuilder()
    .setCustomId(`jt_special_${game.gameId}_${msgId}_f${_figIdx}_${specialIdx}`)
    .setLabel(label)
    .setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(btn);
  const content = `<@${ownerId}> 🪕 **${sourceLabel || 'Free Special Action'}** — click below to perform **${specialLabel || 'the Special Action'}** with **${granteeName}** now (free, 0 actions).`;
  if (opts.threadId) {
    const thread = await fetchCombatThread(client, opts.threadId);
    if (thread) {
      await thread.send({ content, components: [row], allowedMentions: { users: [ownerId] } }).catch(discordCatch);
      return;
    }
  }
  await logGameAction?.(game, client, content, { components: [row], allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card', interrupt: true });
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
  await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack', interrupt: true });
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
    // Per alexanbv 2026-05-12: if a MASSIVE displacement is in flight,
    // DO NOT fire the post-sequence continuation yet — post-deploy or
    // post-move chains would silently advance past the push before
    // the player resolves it. Stash on the unified deferral queue;
    // the massive-push dispatcher drains via
    // `resumeDeferredAfterMassivePush` when the displacement queue
    // empties.
    if (game.pendingMassivePush && afterAction) {
      const q = _ensureDeferredQueue(game);
      q.push({ kind: 'sequenceAfterAction', afterAction });
      ctx.saveGames?.(game.gameId);
      return;
    }
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

/** Lazy-init the post-MASSIVE deferral queue. */
function _ensureDeferredQueue(game) {
  if (!Array.isArray(game._deferredAfterMassivePush)) {
    game._deferredAfterMassivePush = [];
  }
  return game._deferredAfterMassivePush;
}

/**
 * Resume any deferred continuations stashed by `_finishPicker` /
 * `_advanceMoveXSequence` when they encountered pendingMassivePush
 * mid-flight. Called from the massive-push dispatcher in movement.js
 * once the displacement queue drains.
 *
 * Each queue entry is either:
 *   - { kind: 'sequenceAfterAction', afterAction } — post-Move-X-sequence
 *     continuation (Scavenged Walker postDeployAdvance, Strike Team
 *     token distrib, etc.).
 *   - { kind: 'finishPickerNextAction', msgId, pending, nextAction } —
 *     single-figure Move-X continuation (sdpExplode, freeAttackPrompt,
 *     etc.).
 *
 * Drains in FIFO order — sequence afterActions typically queue first
 * (the sequence finishes before the single nextAction fires), so the
 * post-deploy advance runs before any chained per-figure prompt.
 */
export async function resumeDeferredAfterMassivePush(game, ctx) {
  const stashed = game._deferredAfterMassivePush;
  if (!Array.isArray(stashed) || stashed.length === 0) {
    if (stashed) delete game._deferredAfterMassivePush;
    return;
  }
  delete game._deferredAfterMassivePush;
  ctx.saveGames?.(game.gameId);
  for (const entry of stashed) {
    try {
      if (entry?.kind === 'sequenceAfterAction') {
        await _runSequenceAfterAction(game, ctx, entry.afterAction);
      } else if (entry?.kind === 'finishPickerNextAction') {
        await _runFinishPickerNextAction(game, ctx, entry.msgId, entry.pending, entry.nextAction);
      }
    } catch (err) {
      console.error('[move-x] resumeDeferredAfterMassivePush entry failed:', err?.message ?? err);
    }
  }
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
  if (afterAction.type === 'strikeTeamTokenDistrib') {
    // After Cassian + the chosen friend complete their MP pickers,
    // hand off to Strike Team's existing token-distribution flow.
    // Caller is responsible for having stamped activeAbility with
    // tokenRemaining + alreadyReceived before the sequence fired.
    try {
      const { _postStrikeTeamTokenPicker } = await import('./post-deploy.js');
      await _postStrikeTeamTokenPicker(game, game.gameId, afterAction.playerNum, ctx.client, ctx.logGameAction);
    } catch (err) {
      console.error('[move-x] strikeTeamTokenDistrib failed:', err?.message ?? err);
    }
    return;
  }
  if (afterAction.type === 'packAlphaTarget') {
    // After all CREATUREs have moved, post the hostile-target picker
    // via pendingCcChoice → handleCcChoice → resolveAbility(... chosenFigureKey).
    // Phase 2 of packAlphaEffect counts adjacent CREATUREs at the
    // chosen hostile's space and applies the damage.
    try {
      const { client, logGameAction } = ctx;
      const playerNum = afterAction.playerNum;
      const oppNum = playerNum === 1 ? 2 : 1;
      const hostileKeys = [];
      const hostileLabels = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[oppNum] || {})) {
        if (!pos) continue;
        hostileKeys.push(fk);
        hostileLabels.push(dcNameFromFigureKey(fk));
      }
      if (hostileKeys.length === 0) {
        await logGameAction?.(game, client, `**Pack Alpha** — no hostile figures on the board; effect skipped.`, { phase: 'ROUND', icon: 'card' });
        return;
      }
      const ownerId = getPlayerId(game, playerNum);
      const choiceOptions = hostileLabels.map(n => `Target: ${n}`);
      game.pendingCcChoice = {
        gameId: game.gameId,
        playerNum,
        cardName: 'Pack Alpha',
        abilityId: 'Pack Alpha',
        choiceOptions,
        choiceValues: hostileKeys,
        // CSV: damage counts only the up-to-3 CREATUREs moved by THIS card.
        // Carry the selected set to Phase 2 (packAlphaEffect). alexanbv 2026-06-20.
        packAlphaCreatureKeys: afterAction.creatureFigureKeys || null,
      };
      const btns = choiceOptions.slice(0, 20).map((label) => new ButtonBuilder()
        .setCustomId(`cc_choice_${game.gameId}_${label}`)
        .setLabel(label.length > 80 ? label.slice(0, 77) + '…' : label)
        .setStyle(ButtonStyle.Danger));
      const rows = chunkButtonsToRows(btns).slice(0, 5);
      const content = `<@${ownerId}> 🐺 **Pack Alpha** — choose a hostile figure. Damage = # of friendly CREATUREs adjacent to it.`;
      await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack', interrupt: true });
    } catch (err) {
      console.error('[move-x] packAlphaTarget failed:', err?.message ?? err);
    }
    return;
  }
  if (afterAction.type === 'closeTheGapBlockTokens') {
    // Close the Gap: after all friendly BRAWLERs have moved, grant 1
    // Block Token to each BRAWLER within 4 spaces of any hostile
    // figure (recomputed against post-move positions).
    try {
      const { client, logGameAction } = ctx;
      const playerNum = afterAction.playerNum;
      const oppNum = playerNum === 1 ? 2 : 1;
      const keyword = String(afterAction.keyword || '').toUpperCase();
      const within = afterAction.withinSpaces || 4;
      const { getDcEffects } = await import('../data-loader.js').catch(() => ({}));
      const { countGameSpaces } = await import('../game/movement.js').catch(() => ({}));
      const { grantPowerTokens } = await import('../game/index.js').catch(() => ({}));
      const dcEffects = typeof getDcEffects === 'function' ? getDcEffects() : {};
      const grantedNames = [];
      const hostilePositions = Object.values(game.figurePositions?.[oppNum] || {}).filter(Boolean);
      for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
        if (!pos) continue;
        const dcN = dcNameFromFigureKey(fk);
        const eff = dcEffects[dcN] || dcEffects[dcN?.replace(/\s*\[.*\]\s*$/, '')];
        const kws = (eff?.keywords || []).map(k => String(k).toUpperCase());
        if (!kws.includes(keyword)) continue;
        const closeEnough = hostilePositions.some(hp => typeof countGameSpaces === 'function' && countGameSpaces(game, pos, hp) <= within);
        if (!closeEnough) continue;
        if (typeof grantPowerTokens === 'function') grantPowerTokens(game, fk, 'Block', 1);
        grantedNames.push(dcN);
      }
      const msg = grantedNames.length
        ? `**Close the Gap** — granted **1 Block Token** to: ${grantedNames.join(', ')}.`
        : `**Close the Gap** — no friendly ${keyword} ended within ${within} spaces of a hostile; no tokens granted.`;
      await logGameAction?.(game, client, msg, { phase: 'ROUND', icon: 'card' });
    } catch (err) {
      console.error('[move-x] closeTheGapBlockTokens failed:', err?.message ?? err);
    }
    return;
  }
  if (afterAction.type === 'triangulateTarget') {
    // Triangulate: after up to 3 DROIDs have each moved 1 space, post
    // the hostile-target picker. Target list is restricted to hostiles
    // within 5 spaces of *and* LOS from at least one moved DROID. The
    // moved-figureKeys snapshot is parked on game.pendingTriangulate
    // so Phase 2 (resolveAbility chosenFigureKey) computes damage as
    // # of moved DROIDs with LOS to the chosen target.
    try {
      const { client, logGameAction } = ctx;
      const playerNum = afterAction.playerNum;
      const oppNum = playerNum === 1 ? 2 : 1;
      const movedFigKeys = Array.isArray(afterAction.movedFigKeys) ? afterAction.movedFigKeys : [];
      const mapId = game.selectedMap?.id;
      const ms = mapId ? getMapData(mapId) : null;
      // Snapshot the moved figureKeys for Phase 2 LOS-count.
      game.pendingTriangulate = { movedFigKeys, playerNum };
      const { hasLineOfSightByCoord } = await import('../game/spatial.js').catch(() => ({}));
      const { countGameSpaces } = await import('../game/board-helpers.js').catch(() => ({}));
      const hostileKeys = [];
      const hostileLabels = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[oppNum] || {})) {
        if (!pos) continue;
        // Eligibility: at least one moved DROID within 5 + LOS to this
        // hostile. If LOS lookup is unavailable, fall back to within-5.
        let eligible = false;
        for (const dfk of movedFigKeys) {
          const dPos = game.figurePositions?.[playerNum]?.[dfk];
          if (!dPos) continue;
          if (typeof countGameSpaces === 'function' && countGameSpaces(game, dPos, pos) > 5) continue;
          if (typeof hasLineOfSightByCoord === 'function' && ms) {
            if (!hasLineOfSightByCoord(game, dPos, pos, ms, getFigureSize)) continue;
          }
          eligible = true;
          break;
        }
        if (!eligible) continue;
        hostileKeys.push(fk);
        hostileLabels.push(dcNameFromFigureKey(fk));
      }
      if (hostileKeys.length === 0) {
        await logGameAction?.(game, client, `**Triangulate** — no hostile in range/LOS of any moved DROID; effect skipped.`, { phase: 'ROUND', icon: 'card' });
        delete game.pendingTriangulate;
        return;
      }
      const ownerId = getPlayerId(game, playerNum);
      const choiceOptions = hostileLabels.map(n => `Target: ${n}`);
      game.pendingCcChoice = {
        gameId: game.gameId,
        playerNum,
        cardName: 'Triangulate',
        abilityId: 'Triangulate',
        choiceOptions,
        choiceValues: hostileKeys,
      };
      const btns = choiceOptions.slice(0, 20).map((label) => new ButtonBuilder()
        .setCustomId(`cc_choice_${game.gameId}_${label}`)
        .setLabel(label.length > 80 ? label.slice(0, 77) + '…' : label)
        .setStyle(ButtonStyle.Danger));
      const rows = chunkButtonsToRows(btns).slice(0, 5);
      const content = `<@${ownerId}> 📡 **Triangulate** — choose a hostile (within 5 + LOS of at least one moved DROID). Damage = # of those DROIDs with LOS to the target.`;
      await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack', interrupt: true });
    } catch (err) {
      console.error('[move-x] triangulateTarget failed:', err?.message ?? err);
    }
    return;
  }
  console.warn(`[move-x] unknown sequence afterAction type "${afterAction.type}"; dropping`);
}

/**
 * Granted Move-X handler — customId: granted_move_x_${gameId}_${granteeMsgId}_${spaces}
 * Posted by apply-ability-result for cards that grant a free move
 * (Executive Order, etc.). Clicking it stamps pendingMoveX on the
 * grantee with bypassCosts: false (rule 2 — special-action MP gain)
 * and posts the picker in the grantee's flow.
 */
export async function handleGrantedMoveX(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction, dcMessageMeta } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const parts = splitCustomId(interaction.customId, 'granted_move_x_');
  if (parts.length < 3) return;
  const [gameId, granteeMsgId, spacesStr] = parts;
  const spaces = parseInt(spacesStr, 10);
  if (!Number.isFinite(spaces) || spaces <= 0) return;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta?.get?.(granteeMsgId);
  if (!meta) return;
  const figureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {})
    .filter(k => k.startsWith(meta.dcName + '-'));
  const figureKey = figureKeys[0];
  if (!figureKey) {
    await interaction.followUp({ content: 'Grantee has no deployed figure.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the grantee\'s controller can take the free move.')) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  // Clear any pendingExecutiveOrder gate (the move side resolves it).
  if (game.pendingExecutiveOrder?.forMsgId === granteeMsgId) {
    delete game.pendingExecutiveOrder;
  }
  await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
    msgId: granteeMsgId, figureKey, playerNum: meta.playerNum,
    spaces, source: 'Executive Order', threadId: null, bypassCosts: false,
  });
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
export async function runMassiveDisplacement(game, ctx, pending) {
  return _runMassiveDisplacement(game, ctx, pending);
}

/**
 * Crush (CC) end-of-massive-move resolution. Called from within
 * _runMassiveDisplacement at the SAME pre-push point as Stampede (after the
 * enemyQueue is gathered, before resolveNextDisplacements runs the push). When
 * the MASSIVE figure's controller holds the Crush CC and there is a SMALL enemy
 * figure in the ending footprint, Crush is played: one SMALL enemy in the
 * footprint suffers 4 Damage, and the card is moved to the discard pile.
 *
 * Per alexanbv ruling (2026-06-20 — supersedes the earlier "no prompt" note):
 * "You need to prompt the OWNER of the massive figure to choose which figure for
 * Crush. It should not just pick the first one." So when 2+ SMALL enemy figures are
 * eligible in the ending footprint, the Crush player (= the massive figure's
 * controller, pending.playerNum) is PROMPTED to pick which one suffers 4 Damage.
 * When exactly 1 is eligible we auto-resolve (no prompt). The "holds Crush in hand"
 * gate is against that same player.
 *
 * Suspend/resume (mirrors pendingMassivePush in handlers/movement.js): with 2+
 * eligible, this stashes game.pendingCrushChoice (figureKey + queue context),
 * posts crush_pick_<gameId>_<idx> buttons to the controller, and returns true to
 * signal _runMassiveDisplacement to STOP before the push. handleCrushPick applies
 * 4 Damage to the chosen figure, clears the suspend, and RE-ENTERS the push portion
 * via resumeCrushPush (same continuation the non-suspended path runs).
 *
 * Returns true when SUSPENDED (caller must not run the push synchronously); false
 * otherwise (auto-resolved or no-op — caller proceeds to the push as before).
 */
export async function _applyCrushBeforePush(game, ctx, pending, dispPending) {
  const { client, logGameAction } = ctx;
  const movingPN = pending.playerNum;
  // 1. Controller must hold Crush in hand.
  const handKey = ccHandKey(movingPN);
  const hand = game[handKey];
  if (!Array.isArray(hand) || !hand.includes('Crush')) return false;
  // 2. Moving figure must be MASSIVE (only a MASSIVE figure ends movement in
  //    spaces "containing other figures" via the displacement framework).
  const dcEffects = getDcEffects() || {};
  const moverKw = (dcEffects[dcNameFromFigureKey(pending.figureKey)]?.keywords || [])
    .map((k) => String(k).toUpperCase());
  if (!moverKw.includes('MASSIVE')) return false;
  // 3. Gather ALL eligible SMALL enemy figures in dispPending.enemyQueue (same
  //    deterministic initMassiveDisplacement ordering Stampede iterates).
  const _isSmall = (fk) => {
    const kw = (dcEffects[dcNameFromFigureKey(fk)]?.keywords || []).map((k) => String(k).toUpperCase());
    return !(kw.includes('LARGE') || kw.includes('MASSIVE'));
  };
  const eligible = (dispPending.enemyQueue || []).filter((e) => e?.figureKey && _isSmall(e.figureKey));
  if (eligible.length === 0) return false;
  // 4. Exactly 1 eligible → auto-resolve (no prompt). 2+ → suspend and prompt the
  //    Crush player (= massive figure's controller) to pick which one.
  if (eligible.length === 1) {
    await _applyCrushDamageAndConsume(game, ctx, pending, eligible[0]);
    return false;
  }
  // SUSPEND: stash queue context + post crush_pick_ buttons to the controller.
  setPendingCrushChoice(game, {
    gameId: game.gameId,
    playerNum: movingPN,
    figureKey: pending.figureKey,
    dcName: pending.dcName || dcNameFromFigureKey(pending.figureKey),
    eligible: eligible.map((e) => ({ figureKey: e.figureKey, dcName: e.dcName ?? dcNameFromFigureKey(e.figureKey) })),
  });
  await renderCrushPickPrompt(game, client, { fallbackChannel: ctx.fallbackChannel });
  return true;
}

/**
 * Apply Crush's 4 Damage to one chosen SMALL enemy figure and consume the card
 * (first copy) from the Crush player's hand → discard. Shared by the auto-resolve
 * (exactly-1-eligible) path and the handleCrushPick resume path.
 */
async function _applyCrushDamageAndConsume(game, ctx, pending, target) {
  const { client, logGameAction, dcMessageMeta } = ctx;
  const movingPN = pending.playerNum;
  const oppPN = movingPN === 1 ? 2 : 1;
  const fkMatch = String(target.figureKey).match(/-(\d+)-(\d+)$/);
  if (!fkMatch) return false;
  const figIdx = parseInt(fkMatch[2], 10);
  const tDcName = dcNameFromFigureKey(target.figureKey);
  let tMsgId = null;
  for (const [mId, mMeta] of (dcMessageMeta || [])) {
    if (mMeta.gameId !== game.gameId || mMeta.playerNum !== oppPN || mMeta.dcName !== tDcName) continue;
    const dgM = (mMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIdx = dgM ? dgM[1] : '1';
    if (String(dgIdx) === String(fkMatch[1])) { tMsgId = mId; break; }
  }
  if (!tMsgId) return false;
  const { applyDamage: _crApplyDamage } = await import('../game/damage-pipeline.js');
  try {
    await _crApplyDamage(game, { dcHealthState: ctx.dcHealthState, logGameAction, client }, {
      figureKey: target.figureKey, msgId: tMsgId, figIndex: figIdx,
      amount: 4, controllerPlayerNum: oppPN,
      attackerPlayerNum: movingPN,
      source: 'Crush',
    });
  } catch (err) {
    console.error('[crush] applyDamage failed:', err?.message ?? err);
    return false;
  }
  const hand = game[ccHandKey(movingPN)];
  const idx = Array.isArray(hand) ? hand.indexOf('Crush') : -1;
  if (idx >= 0) hand.splice(idx, 1);
  const discKey = ccDiscardKey(movingPN);
  game[discKey] = game[discKey] || [];
  game[discKey].push('Crush');
  await logGameAction?.(game, client,
    `💥 **Crush** — **${tDcName}** in **${pending.dcName || dcNameFromFigureKey(pending.figureKey)}**'s ending space: 4 Damage before push.`,
    { phase: 'ROUND', icon: 'attack' });
  return true;
}

/**
 * Render-from-state: post the Crush figure-pick buttons (one per eligible SMALL
 * enemy figure) to the massive figure's controller. Mirrors
 * renderMassivePushFigurePrompt: figures are encoded by index into
 * pending.eligible (figure keys don't round-trip cleanly through a customId).
 */
export async function renderCrushPickPrompt(game, client, opts = {}) {
  const pending = game.pendingCrushChoice;
  if (!pending) return;
  const eligible = pending.eligible || [];
  if (eligible.length === 0) return;
  const btns = eligible.map((e, idx) => {
    const pos = game.figurePositions?.[game.pendingCrushChoice.playerNum === 1 ? 2 : 1]?.[e.figureKey];
    const label = `${e.dcName}${pos ? ` @ ${String(pos).toUpperCase()}` : ''}`.slice(0, 80);
    return new ButtonBuilder()
      .setCustomId(`crush_pick_${pending.gameId}_${idx}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Danger);
  });
  const rows = [];
  while (btns.length > 0) rows.push(new ActionRowBuilder().addComponents(btns.splice(0, 5)));
  const threadId = game.dcActionsData ? Object.values(game.dcActionsData).find((d) => d.threadId)?.threadId : null;
  let channel = threadId ? await fetchGameChannel(client, threadId) : null;
  if (!channel && opts.fallbackChannel) channel = opts.fallbackChannel;
  if (!channel && game.generalId) channel = await fetchGameChannel(client, game.generalId);
  if (!channel) return;
  const sent = await channel.send({
    content: `💥 **Crush** — **${pending.dcName}** ends movement on 2+ SMALL enemy figures. Choose which one suffers **4 Damage** (before the push).`,
    components: rows.slice(0, 5),
  }).catch(discordCatch);
  if (sent?.id) {
    const { recordPromptMessage, signatureFor } = await import('../engine/prompt-reconciler.js');
    recordPromptMessage(game, 'crushPick', sent.channelId || channel.id, sent.id, signatureFor('crushPick', game));
  }
}

/**
 * Resume the massive-displacement PUSH after a Crush pick is resolved. Re-enters
 * the same push portion _runMassiveDisplacement runs after the (now-completed)
 * Crush step — recomputes dispPending from current positions and drives
 * resolveNextDisplacements / the existing massive-push pickers.
 */
async function resumeCrushPush(game, ctx, pending) {
  await _runMassiveDisplacementPush(game, ctx, pending);
}

/**
 * Handle the Crush figure-pick button (crush_pick_<gameId>_<idx>). Applies 4
 * Damage to the chosen SMALL enemy figure, clears pendingCrushChoice, then resumes
 * the massive-displacement push pipeline.
 */
export async function handleCrushPick(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const match = interaction.customId.match(/^crush_pick_([^_]+)_(\d+)$/);
  if (!match) { await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch); return; }
  const [, gameId, idxStr] = match;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingCrushChoice;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Crush choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Authority: only the massive figure's controller (= the Crush player) picks.
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer,
    'Only the massive figure\'s controller can choose the Crush target.')) return;
  const idx = parseInt(idxStr, 10);
  const choice = (pending.eligible || [])[idx];
  if (!choice) {
    await interaction.followUp({ content: 'Invalid pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Reconstruct the minimal pending context the push/damage helpers expect.
  const pushPending = {
    playerNum: pending.playerNum,
    figureKey: pending.figureKey,
    dcName: pending.dcName,
  };
  await _applyCrushDamageAndConsume(game, ctx, pushPending, choice);
  clearPendingCrushChoice(game);
  try { await interaction.message.edit({ content: `💥 **Crush** target: **${choice.dcName}** suffers 4 Damage.`, components: [] }).catch(discordCatch); } catch {}
  const { clearPromptRecord } = await import('../engine/prompt-reconciler.js');
  clearPromptRecord(game, 'crushPick');
  await resumeCrushPush(game, ctx, pushPending);
  if (saveGames) saveGames(game.gameId);
}
async function _runMassiveDisplacement(game, ctx, pending) {
  const { client, logGameAction } = ctx;
  const pos = game.figurePositions?.[pending.playerNum]?.[pending.figureKey];
  if (!pos) return;
  const dcName = dcNameFromFigureKey(pending.figureKey);
  const size = game.figureOrientations?.[pending.figureKey] || getFigureSize(dcName) || '1x1';
  const footprintSet = new Set(getNormalizedFootprint(pos, size));
  const dispPending = initMassiveDisplacement(game, pending.playerNum, pending.figureKey, footprintSet);
  // Stampede (Bantha Rider) per alexanbv 2026-05-10: when Bantha Rider
  // is the MASSIVE pusher, each enemy figure being displaced (already
  // in Bantha's final footprint) takes 1 Damage BEFORE the push. Folded
  // into the MASSIVE framework, replacing the old end-of-movement impl
  // in handlers/movement.js.
  if (dispPending && /^Bantha Rider-/.test(pending.figureKey)) {
    const { applyDamage: _stApplyDamage } = await import('../game/damage-pipeline.js');
    const { dcMessageMeta } = ctx;
    const oppPN = pending.playerNum === 1 ? 2 : 1;
    for (const entry of dispPending.enemyQueue) {
      if (!entry?.figureKey) continue;
      const fkMatch = entry.figureKey.match(/-(\d+)-(\d+)$/);
      if (!fkMatch) continue;
      const figIdx = parseInt(fkMatch[2], 10);
      const tDcName = dcNameFromFigureKey(entry.figureKey);
      let tMsgId = null;
      for (const [mId, mMeta] of (dcMessageMeta || [])) {
        if (mMeta.gameId !== game.gameId || mMeta.playerNum !== oppPN || mMeta.dcName !== tDcName) continue;
        const dgM = (mMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIdx = dgM ? dgM[1] : '1';
        if (String(dgIdx) === String(fkMatch[1])) { tMsgId = mId; break; }
      }
      if (!tMsgId) continue;
      try {
        await _stApplyDamage(game, { dcHealthState: ctx.dcHealthState, logGameAction, client }, {
          figureKey: entry.figureKey, msgId: tMsgId, figIndex: figIdx,
          amount: 1, controllerPlayerNum: oppPN,
          attackerPlayerNum: pending.playerNum,
          source: 'Stampede',
        });
        await logGameAction?.(game, client,
          `🐃 **Stampede** — **${tDcName}** in **Bantha Rider**'s footprint: 1 Damage before push.`,
          { phase: 'ROUND', icon: 'attack' });
      } catch (err) {
        console.error('[stampede] applyDamage failed:', err?.message ?? err);
      }
    }
  }
  // Crush (CC, row 594) per alexanbv ruling: "Crush should be applied as part of
  // the massive figure end movement pipeline — BEFORE figures are pushed. Same
  // timing as Bantha Rider's Stampede ability." CSV: conditional "you end
  // movement in spaces containing one or more other figures"; effect "Choose a
  // SMALL figure in those spaces; it suffers 4 Damage".
  //
  // Interpretation: this fires when a MASSIVE figure whose controller holds the
  // Crush CC ends its move overlapping a SMALL enemy figure (the "ending space
  // contains other figures" condition is exactly the MASSIVE-overlap that
  // triggers displacement). The 4 Damage resolves HERE — at the same pre-push
  // point as Stampede, over the same enemyQueue — and the card is consumed from
  // the controller's hand. Only SMALL enemy figures in the ending footprint are
  // eligible (the CSV "SMALL figure" filter, mirroring abilities.js requiresSmall).
  if (dispPending) {
    // Crush may SUSPEND here (2+ eligible SMALL enemies → controller prompt).
    // When suspended, _applyCrushBeforePush has stashed pendingCrushChoice and
    // posted the picker; the push runs later from handleCrushPick → resumeCrushPush
    // → _runMassiveDisplacementPush. Stop now so the push doesn't run pre-pick.
    const suspended = await _applyCrushBeforePush(game, ctx, pending, dispPending);
    if (suspended) return;
  }
  if (!dispPending) {
    // Diagnostic: log that the MASSIVE displacement check ran but
    // found no overlaps. Helps debug bug reports like "AT-DP moved
    // 3 spaces but didn't push" — confirms whether the trigger fired
    // at all vs. there were genuinely no figures in the final footprint.
    await logGameAction?.(game, client,
      `🦿 **MASSIVE check** — **${pending.dcName || dcName}** at ${String(pos).toUpperCase()} (footprint ${size}): no smaller figures in final footprint, no displacement.`,
      { phase: 'ROUND', icon: 'move' });
    return;
  }
  await _runMassiveDisplacementPush(game, ctx, pending);
}

/**
 * The PUSH portion of the MASSIVE end-of-move pipeline, split out so the Crush
 * suspend/resume (handleCrushPick) can re-enter it after the controller picks a
 * target. Recomputes the displacement set from current positions (identical to the
 * head of _runMassiveDisplacement), marks the per-phase "cannot move again" flag,
 * runs resolveNextDisplacements, and posts the existing massive-push pickers when
 * interactive resolution remains. Stampede / Crush already ran before this point.
 */
async function _runMassiveDisplacementPush(game, ctx, pending) {
  const { client, logGameAction } = ctx;
  const pos = game.figurePositions?.[pending.playerNum]?.[pending.figureKey];
  if (!pos) return;
  const dcName = pending.dcName || dcNameFromFigureKey(pending.figureKey);
  const size = game.figureOrientations?.[pending.figureKey] || getFigureSize(dcNameFromFigureKey(pending.figureKey)) || '1x1';
  const footprintSet = new Set(getNormalizedFootprint(pos, size));
  const dispPending = initMassiveDisplacement(game, pending.playerNum, pending.figureKey, footprintSet);
  if (!dispPending) return;
  // Per CRR (2026-05-09): once a MASSIVE figure displaces another figure, it may
  // no longer move during the current phase. Flag is cleared on phase boundaries.
  game.massivePushedThisPhase = game.massivePushedThisPhase || {};
  game.massivePushedThisPhase[pending.figureKey] = true;
  await logGameAction?.(game, client,
    `🦿 **MASSIVE displaced** — **${dcName}** pushed ${dispPending.totalDisplaced} figure(s); cannot move again this phase.`,
    { phase: 'ROUND', icon: 'move' });
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
  let validSet = new Set([String(figurePos).toLowerCase(), ...reachable.map(s => String(s).toLowerCase())]);
  // Mortar Launcher (and any future spaceWithin ability with
  // requireHostileOccupant): the target space must contain a hostile
  // figure (opp regular OR hostileToAll NPC). Per alexanbv 2026-05-10.
  if (next.requireHostileOccupant) {
    const oppPN = pending.playerNum === 1 ? 2 : 1;
    const hostileCoords = new Set();
    for (const [, c] of Object.entries(game.figurePositions?.[oppPN] || {})) {
      if (c) hostileCoords.add(String(c).toLowerCase());
    }
    for (const arrName of ['npcThugs', 'npcKrykna']) {
      const arr = game[arrName];
      if (!Array.isArray(arr)) continue;
      for (const npc of arr) {
        if (!npc || npc.defeated || !npc.coord) continue;
        const h = npc.hostility || (npc.hostileToAll ? 'hostile' : 'neutral');
        if (h === 'neutral') continue;
        hostileCoords.add(String(npc.coord).toLowerCase());
      }
    }
    validSet = new Set([...validSet].filter((c) => hostileCoords.has(c)));
  }
  const validSpaces = [...validSet];
  if (validSpaces.length === 0) {
    await logGameAction?.(game, client,
      `**${next.label}** — ${next.requireHostileOccupant ? 'No hostile figure in range; effect skipped.' : 'No valid target spaces from current position; effect skipped.'}`,
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
  await logGameAction?.(game, client, content, { components: rowBtns.slice(0, 5), phase: 'ROUND', icon: 'attack', interrupt: true });
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
    // No legal destinations — close the budget and run any chained
    // continuation. (For SDP and similar "must do something even if
    // I can't move" effects, the continuation needs to fire even
    // when the figure has nowhere to go.) _finishPicker handles
    // both the clear and the continuation dispatch.
    await logGameAction?.(game, client,
      `🦿 **${pending.source}** — **${pending.dcName}** has no legal destinations; remaining ${pending.remaining} space(s) discarded.`,
      { phase: 'ROUND', icon: 'attack' });
    await _finishPicker(game, ctx, msgId);
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
  // Multi-cell figure footprint clarifier: button labels show the
  // top-left cell of the candidate footprint. Adding a footnote so the
  // player knows which cell of the figure the coordinate refers to.
  const _figSize = game.figureOrientations?.[pending.figureKey] || getFigureSize(pending.dcName) || '1x1';
  const _isMultiCell = _figSize !== '1x1';
  const _anchorNote = _isMultiCell ? '\n_(coordinates show the **top-left** cell of the figure\'s footprint.)_' : '';
  const content = `<@${ownerId}> 🦿 **${pending.source}** — **${pending.dcName}** has **${pending.remaining}** ${unitLabel} remaining${overlapNote}. Click an adjacent space to move 1 step:${_anchorNote}`;
  const opts = { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack', interrupt: true };

  // Per alexanbv 2026-05-17: interrupt-grant pickers (Order, Tactical
  // Maneuver, Bombardment, etc.) should post in the ACTIVATOR's thread,
  // not the general game log. If the caller didn't stamp a threadId,
  // fall back to the currently-activating DC's thread for this player
  // via lastActivationMsgIdByPlayer.
  let _resolvedThreadId = pending.threadId;
  if (!_resolvedThreadId) {
    const _actorMsgId = game.lastActivationMsgIdByPlayer?.[pending.playerNum];
    if (_actorMsgId) {
      _resolvedThreadId = game.dcActionsData?.[_actorMsgId]?.threadId || null;
    }
  }
  if (_resolvedThreadId) {
    const thread = await fetchCombatThread(client, _resolvedThreadId);
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
  markMapDirty(game);

  const cost = match.stepCost ?? 1;
  pending.remaining = Math.max(0, pending.remaining - cost);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const costNote = cost > 1 ? ` (cost ${cost} MP)` : '';
  await logGameAction?.(game, client,
    `🦿 **${pending.source}** — **${pending.dcName}** moves to **${match.topLeft.toUpperCase()}**${costNote} (${pending.remaining} left).`,
    { phase: 'ROUND', icon: 'attack' });

  // On a Mission per-step hook: if the activator's new footprint
  // contains a SMALL figure, suspend the picker and post a 1-space
  // push prompt. The valid push destinations come from the same
  // 8-direction `mapSpaces.adjacency` lookup other CC pushes use
  // (Looking for a Fight, Force Push, etc.) — filtered to spaces not
  // occupied by another figure. handleOnAMissionPush resolves the
  // chosen space (or skip) and resumes the picker.
  if (pending.onEnterPushSmall) {
    const targetSmall = _findSmallInFootprint(game, pending);
    if (targetSmall) {
      const targetPos = game.figurePositions?.[targetSmall.playerNum]?.[targetSmall.figureKey];
      const mapId = game.selectedMap?.id;
      const ms = mapId ? getMapData(mapId) : null;
      const adjRaw = (ms?.adjacency?.[String(targetPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
      const occupiedSet = new Set([
        ...Object.values(game.figurePositions?.[1] || {}),
        ...Object.values(game.figurePositions?.[2] || {}),
      ].filter(Boolean).map(s => String(s).toLowerCase()));
      occupiedSet.delete(String(targetPos).toLowerCase());
      const validSpaces = adjRaw.filter(s => !occupiedSet.has(s));
      game.pendingOnAMissionPush = game.pendingOnAMissionPush || {};
      game.pendingOnAMissionPush[msgId] = {
        smallFigureKey: targetSmall.figureKey,
        smallPlayerNum: targetSmall.playerNum,
        msgId,
        validSpaces,
      };
      const ownerId = getPlayerId(game, pending.playerNum);
      const smallName = dcNameFromFigureKey(targetSmall.figureKey);
      const btns = validSpaces.slice(0, 24).map(sp => new ButtonBuilder()
        .setCustomId(`on_a_mission_push_${game.gameId}_${msgId}_${sp}`)
        .setLabel(sp.toUpperCase().slice(0, 80))
        .setStyle(ButtonStyle.Primary));
      btns.push(new ButtonBuilder()
        .setCustomId(`on_a_mission_push_${game.gameId}_${msgId}_skip`)
        .setLabel('Skip push')
        .setStyle(ButtonStyle.Secondary));
      const rows = chunkButtonsToRows(btns).slice(0, 5);
      const content = validSpaces.length === 0
        ? `<@${ownerId}> 🦿 **On a Mission** — entered space containing **${smallName}** (SMALL), but no valid push space; press Skip to continue.`
        : `<@${ownerId}> 🦿 **On a Mission** — entered space containing **${smallName}** (SMALL). May push 1 space:`;
      if (pending.threadId) {
        const thread = await fetchCombatThread(client, pending.threadId);
        if (thread) await thread.send({ content, components: rows, allowedMentions: { users: [ownerId] } }).catch(discordCatch);
      } else {
        await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack', interrupt: true });
      }
      saveGames?.(gameId);
      return;
    }
  }

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
 * Locate a SMALL figure (any allegiance) sitting on the moving
 * figure's current footprint. Returns the first match or null. Used
 * by the On a Mission per-step hook.
 */
function _findSmallInFootprint(game, pending) {
  const pos = game.figurePositions?.[pending.playerNum]?.[pending.figureKey];
  if (!pos) return null;
  const size = game.figureOrientations?.[pending.figureKey] || getFigureSize(pending.dcName) || '1x1';
  const cells = new Set(getFootprintCells(pos, size).map(c => String(c).toLowerCase()));
  const dcEffects = getDcEffects();
  for (const pn of [1, 2]) {
    const positions = game.figurePositions?.[pn] || {};
    for (const [fk, fpos] of Object.entries(positions)) {
      if (!fpos) continue;
      if (pn === pending.playerNum && fk === pending.figureKey) continue;
      const fSize = game.figureOrientations?.[fk] || getFigureSize(dcNameFromFigureKey(fk)) || '1x1';
      const fCells = getFootprintCells(fpos, fSize).map(c => String(c).toLowerCase());
      if (!fCells.some(c => cells.has(c))) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = dcEffects[dcN] || dcEffects[dcN?.replace(/\s*\[.*\]\s*$/, '')];
      const kws = (eff?.keywords || []).map(k => String(k).toUpperCase());
      if (kws.includes('LARGE') || kws.includes('MASSIVE')) continue;
      return { figureKey: fk, playerNum: pn };
    }
  }
  return null;
}

/**
 * Handler for the On a Mission per-step push prompt.
 * customId: on_a_mission_push_${gameId}_${msgId}_${space|'skip'}
 */
export async function handleOnAMissionPush(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const parts = splitCustomId(interaction.customId, 'on_a_mission_push_');
  if (parts.length < 3) return;
  const gameId = parts[0];
  const msgId = parts[1];
  const choice = parts.slice(2).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pendingPush = game.pendingOnAMissionPush?.[msgId];
  const pending = game.pendingMoveX?.[msgId];
  if (!pendingPush || !pending) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the activator can resolve the push.')) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  if (choice === 'skip') {
    delete game.pendingOnAMissionPush[msgId];
    if (Object.keys(game.pendingOnAMissionPush).length === 0) delete game.pendingOnAMissionPush;
    await logGameAction?.(game, client, `🦿 **On a Mission** — push skipped.`, { phase: 'ROUND', icon: 'attack' });
  } else {
    const valid = (pendingPush.validSpaces || []).map(s => String(s).toLowerCase());
    if (!valid.includes(String(choice).toLowerCase())) {
      await interaction.followUp({ content: 'Invalid push space.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const { pushFigure } = await import('../game/player-helpers.js');
    pushFigure(game, pendingPush.smallPlayerNum, pendingPush.smallFigureKey, choice);
    const smallName = dcNameFromFigureKey(pendingPush.smallFigureKey);
    await logGameAction?.(game, client, `🦿 **On a Mission** — pushed **${smallName}** to **${String(choice).toUpperCase()}**.`, { phase: 'ROUND', icon: 'attack' });
    delete game.pendingOnAMissionPush[msgId];
    if (Object.keys(game.pendingOnAMissionPush).length === 0) delete game.pendingOnAMissionPush;
  }
  if (pending.remaining <= 0) {
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
  markMapDirty(game);
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
