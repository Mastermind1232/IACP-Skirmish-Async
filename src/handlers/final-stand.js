/**
 * Final Stand interrupt — deferred-defeat handler (alexanbv 2026-05-10).
 *
 * Card text (CC, playableBy: Baze Malbus): "Use when a friendly figure
 * within 3 spaces has suffered damage equal to its Health, before it is
 * defeated. Move up to 2 spaces, gain 1 Power Token, and then perform an
 * attack. Then, that friendly figure is defeated."
 *
 * Flow:
 *   1. Damage applied via applyDamage; reduceHp brings TARGET HP to 0.
 *   2. BEFORE_DEFEATED hook in damage-pipeline-hooks.js detects Final
 *      Stand (FS in hand + Baze within 3 of target), sets
 *      `pendingFinalStand`, posts [Play Final Stand] [Skip], returns
 *      `preventDefeat: true` so the caller skips processFigureDefeat
 *      for the TARGET.
 *   3. Player clicks Skip → handleSkipFinalStand →
 *      completeDeferredDefeat(target).
 *   4. Player clicks Play → handleFireFinalStand:
 *        - Removes Final Stand from hand → discard
 *        - Stamps pendingMoveX[bazeMsgId] with mpBonus=2 + freeAttackPrompt
 *          continuation, plus pendingPowerTokenGrant for 1 token (deferred
 *          MoveX after token-type chosen)
 *        - Marks pendingFinalStand.active = true
 *      After Baze's free attack resolves, finishCombatResolution checks
 *      `pendingFinalStand.active && combat.attackerFigureKey ===
 *      pendingFinalStand.playingFigureKey` and calls
 *      completeDeferredDefeat(target) to finalize the original figure's
 *      defeat.
 *
 * Mara Jade Fast Learner integration: NOT WIRED YET — Baze is the only
 * eligible playing figure today. Mara picker comes in a follow-up.
 */
import { setPendingFinalStand, clearPendingFinalStand } from '../game/interrupts.js';
import { completeDeferredDefeat as _completeDeferredDefeat } from '../game/deferred-defeat.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { ccHandKey, ccDiscardKey } from '../game/player-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';

/**
 * Resume a Final Stand deferred defeat. Reads `pendingFinalStand`,
 * clears it, then delegates to the shared completeDeferredDefeat for
 * the TARGET figure (the one that suffered damage = health), NOT Baze.
 */
export async function completeDeferredDefeat(game, ctx) {
  const pending = game.pendingFinalStand;
  if (!pending) return null;
  clearPendingFinalStand(game);
  return _completeDeferredDefeat(game, ctx, {
    figureKey: pending.targetFigureKey,
    msgId: pending.targetMsgId,
    figIndex: pending.targetFigIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Final Stand resumed)`,
  });
}

export async function handleSkipFinalStand(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const parts = splitCustomId(interaction.customId, 'final_stand_skip_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingFinalStand;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Final Stand.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  if (typeof logGameAction === 'function' && client) {
    await logGameAction(game, client, `**Final Stand** skipped — figure defeats normally.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  }
  await completeDeferredDefeat(game, ctx);
  if (typeof saveGames === 'function') await saveGames(gameId);
}

export async function handleFireFinalStand(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client, logGameAction,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState,
  } = ctx;
  const parts = splitCustomId(interaction.customId, 'final_stand_play_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingFinalStand;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Final Stand.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});

  // Remove Final Stand from controlling player's hand → discard.
  const ownerPN = pending.controllerPlayerNum;
  const handKey = ccHandKey(ownerPN);
  const discardKey = ccDiscardKey(ownerPN);
  const hand = game[handKey] || [];
  const fsIdx = hand.indexOf('Final Stand');
  if (fsIdx < 0) {
    // Card disappeared between prompt and click — fall back to skip semantics.
    await completeDeferredDefeat(game, ctx);
    if (typeof saveGames === 'function') await saveGames(gameId);
    return;
  }
  hand.splice(fsIdx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Final Stand');

  // Mark pending as active so finishCombatResolution knows to call
  // completeDeferredDefeat after Baze's free attack resolves.
  pending.active = true;
  setPendingFinalStand(game, pending);

  // Run the Final Stand resolver targeted at Baze's msgId. The resolver
  // already handles powerTokenGain → pendingPowerTokenGrant (deferred
  // MoveX) → freeAttackPrompt continuation when token type is chosen.
  // Passing context.msgId overrides the default findActiveActivationMsgId
  // lookup (abilities.js:2107) so the Move+Attack chain runs on Baze
  // regardless of whose activation is in progress.
  if (typeof resolveAbility === 'function') {
    const result = resolveAbility('Final Stand', {
      game,
      playerNum: ownerPN,
      cardName: 'Final Stand',
      msgId: pending.playingMsgId,
      dcMessageMeta,
      dcHealthState,
      dcExhaustedState,
      combat: game.pendingCombat,
    });
    // Drain any queued damage through the ONE applyDamage pipeline (alexanbv
    // 2026-06-23). Idempotent; ctx carries dcHealthState + processFigureDefeat.
    if (game._pendingDamage?.length || result?.pendingDamage?.length) {
      const { drainPendingDamage } = await import('../game/damage-pipeline.js');
      await drainPendingDamage(game, ctx, result);
    }
    if (result?.logMessage && typeof logGameAction === 'function' && client) {
      await logGameAction(game, client, `**Final Stand** — **Baze Malbus** intervenes! ${result.logMessage}`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }

  if (typeof saveGames === 'function') await saveGames(gameId);
}
