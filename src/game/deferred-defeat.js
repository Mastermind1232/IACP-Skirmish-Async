/**
 * Shared helper for resuming a deferred defeat after a BEFORE_DEFEATED
 * interrupt resolves (Parting Shot, Last Resort, Self-Destruct
 * Protocol, Final Stand, etc.).
 *
 * Per destruct 2026-05-08:
 *   - reduceHp ALWAYS ran when the original damage applied. The
 *     figure's HP is at 0 (or healed back > 0 if Second Chance /
 *     Miracle Worker fired during the BEFORE_DEFEATED window).
 *   - This helper checks the post-interrupt state:
 *       * HP > 0 → figure was healed (SC/MW), no defeat finalization.
 *       * YWNDM flag active for that player + Fifth Brother → no defeat.
 *       * Otherwise → fire WHEN_DEFEATED hooks + processFigureDefeat.
 *
 * Each interrupt handler clears its own pending state, then calls
 * `completeDeferredDefeat(game, ctx, payload)` with the figure info.
 */

import { WHEN_DEFEATED_HOOKS, _ensureHooksLoaded } from './damage-pipeline.js';
import { processFigureDefeat as _defaultProcessFigureDefeat } from '../engine/defeat-handler.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { getDcMessageIds, opponentPlayerNum } from './player-helpers.js';

/**
 * @param {object} game
 * @param {object} ctx - { dcHealthState, logGameAction, client, deps?, thread? }
 * @param {object} payload - {
 *   figureKey, msgId, figIndex,
 *   controllerPlayerNum, attackerPlayerNum,
 *   source - free-form label appended to the defeat source
 * }
 * @returns {Promise<{ wasDefeated: boolean }>}
 */
export async function completeDeferredDefeat(game, ctx, payload) {
  if (!payload || !payload.figureKey || !payload.msgId || !payload.controllerPlayerNum) {
    return { wasDefeated: false };
  }
  await _ensureHooksLoaded();

  const defeatedPos = game.figurePositions?.[payload.controllerPlayerNum]?.[payload.figureKey] || null;
  const dcHealth = ctx?.dcHealthState?.get?.(payload.msgId) || [];
  const figEntry = dcHealth[payload.figIndex] || [0, 0];
  const curHp = figEntry[0] ?? 0;

  // Prevent-defeat exits:
  //   - Second Chance / Miracle Worker healed → HP > 0.
  //   - YWNDM keeps figure at HP=0 with the active flag.
  if (curHp > 0) {
    return { wasDefeated: false };
  }
  if (game.youWillNotDenyMeActive?.playerNum === payload.controllerPlayerNum) {
    const fName = dcNameFromFigureKey(payload.figureKey);
    if (String(fName).toLowerCase().includes('fifth')) {
      return { wasDefeated: false };
    }
  }

  // 1. WHEN_DEFEATED hooks (deferred from the original applyDamage call).
  const defeatedOpts = {
    figureKey: payload.figureKey,
    msgId: payload.msgId,
    figIndex: payload.figIndex,
    controllerPlayerNum: payload.controllerPlayerNum,
    attackerPlayerNum: payload.attackerPlayerNum,
    source: payload.source || 'Damage (deferred-defeat resumed)',
    amount: 0,
    prevHp: curHp,
    defeatedPos,
  };
  for (const hook of WHEN_DEFEATED_HOOKS) {
    if (!hook.probe || !hook.apply) continue;
    if (!hook.probe(game, defeatedOpts)) continue;
    try {
      await hook.apply(game, defeatedOpts, ctx);
    } catch (err) {
      console.error(`[deferred-defeat] WHEN_DEFEATED hook ${hook.id} threw:`, err?.message ?? err);
    }
  }

  // 2. processFigureDefeat — canonical defeat resolution. Use the
  //    ctx-provided fn when present (production wires it via deps;
  //    tests mock it). Fall back to the imported real implementation
  //    if the caller only has a partial ctx.
  const dcMessageIds = getDcMessageIds(game, payload.controllerPlayerNum) || [];
  const dcIdx = dcMessageIds.indexOf(payload.msgId);
  const dcName = dcNameFromFigureKey(payload.figureKey);
  const processFigureDefeat = ctx?.processFigureDefeat ?? _defaultProcessFigureDefeat;
  await processFigureDefeat(game, {
    defeatedPlayerNum: payload.controllerPlayerNum,
    figureKey: payload.figureKey,
    attackerPlayerNum: payload.attackerPlayerNum ?? opponentPlayerNum(payload.controllerPlayerNum),
    msgId: payload.msgId,
    dcIdx,
    dcName,
    source: payload.source || 'Deferred-defeat',
  }, ctx);
  return { wasDefeated: true };
}
