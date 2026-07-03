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
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';
import { playCcFull } from './cc-pipeline.js';

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

  const ownerPN = pending.controllerPlayerNum;
  const fsRes = await playCcFull(game, gameId, ownerPN, null, 'Final Stand', {
    skipExecute: true, skipTimingCheck: true,
  }, ctx, client);

  if (fsRes.ok && !fsRes.cancelled) {
    // Passed the counter window: mark pending active (signals finishCombatResolution
    // to call completeDeferredDefeat once Baze's free attack resolves) and run effect.
    pending.active = true;
    setPendingFinalStand(game, pending);
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
      const { applyDeferredAbilityEffects } = await import('../game/damage-pipeline.js');
      await applyDeferredAbilityEffects(game, ctx, result);
      if (result?.logMessage && typeof logGameAction === 'function' && client) {
        await logGameAction(game, client, `**Final Stand** — **Baze Malbus** intervenes! ${result.logMessage}`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
    }
  } else {
    // Card not in hand, or cancelled by Negate/Comms: target figure defeats normally.
    await completeDeferredDefeat(game, ctx);
  }

  if (typeof saveGames === 'function') await saveGames(gameId);
}
