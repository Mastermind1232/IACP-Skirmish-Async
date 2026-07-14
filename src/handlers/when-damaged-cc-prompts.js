/**
 * Suffered-damage CC window handlers.
 *
 * When a figure suffers damage during a gate-sequence attack, the sequence
 * pauses if any player holds a CC with a suffered-damage timing that fires.
 * Currently two CCs use this:
 *
 *   Opportunistic (SCUM, afterHostileFigureSuffersDamage) — attacker's player
 *     picks a friendly SCUM figure within 3 of the damaged figure; that figure
 *     gains MP equal to the damage suffered (spend immediately).
 *
 *   Extra Protection (Onar Koma, whenFriendlyFigureWithin2SpacesSuffers3Plus) —
 *     defender's player; Onar may move up to 2 spaces then take a free attack.
 *     The hook + existing handleExtraProtection handler does the heavy lifting;
 *     this module only provides the drain bridge so the WD window drains when
 *     EP resolves.
 *
 * Both prompts go to the respective player's HAND CHANNEL (private). The
 * sequence does not advance to after_resolve until pendingWhenDamagedCcWindow
 * is empty.
 */
import { clearPendingOpportunisticPrompt } from '../game/interrupts.js';
import { getCcEffect } from '../data-loader.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';
import { playCcFull } from './cc-pipeline.js';

/**
 * Drain hookId from pendingWhenDamagedCcWindow. When empty:
 * - If deferredDefeatIds exist → set up pendingDefeatCcWindow and keep paused.
 * - Otherwise → resumeSequenceAfterInterrupt (gate) or no-op (legacy).
 */
export async function _drainWhenDamagedCcWindow(game, hookId, ctx) {
  const win = game.pendingWhenDamagedCcWindow;
  if (!win) return;
  win.pendingIds = win.pendingIds.filter(id => id !== hookId);
  if (win.pendingIds.length > 0) return;
  const { afterResolveArgs, combatThreadId, deferredDefeatIds } = win;
  delete game.pendingWhenDamagedCcWindow;
  if (deferredDefeatIds?.length > 0) {
    game.pendingDefeatCcWindow = {
      gameId: game.gameId,
      pendingIds: [...deferredDefeatIds],
      afterResolveArgs,
      combatThreadId,
    };
    // Gate: _afterResolveArgs is already stashed; defeat-CC handlers will drain.
    return;
  }
  // No deferred defeat CCs — resume directly.
  const combat = game.pendingCombat;
  if (!combat) return;
  if (combat._seqActive && combat._afterResolveArgs) {
    const { resumeSequenceAfterInterrupt } = await import('./combat.js');
    await resumeSequenceAfterInterrupt(game, combat, ctx, null);
  }
}

/**
 * Handle Opportunistic figure pick. customId: `opportunistic_pick_${gameId}_${figIdx}`
 * Plays the card via playCcFull, grants MP via resolveAbility, then drains window.
 */
export async function handleOpportunisticPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, resolveAbility,
          dcMessageMeta, dcHealthState, dcExhaustedState } = ctx;
  const m = interaction.customId.match(/^opportunistic_pick_([^_]+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid Opportunistic pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = m[1];
  const figIdx = parseInt(m[2], 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingOpportunisticPrompt;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Opportunistic prompt.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.playerPN);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  const opt = (pending.eligibleFigures || [])[figIdx];
  if (!opt) {
    clearPendingOpportunisticPrompt(game);
    if (typeof saveGames === 'function') await saveGames(gameId);
    await _drainWhenDamagedCcWindow(game, 'opportunistic_prompt', ctx);
    return;
  }
  clearPendingOpportunisticPrompt(game);
  const res = await playCcFull(game, gameId, pending.playerPN, null, 'Opportunistic', {
    skipExecute: true, skipTimingCheck: true, getEffect: getCcEffect,
  }, ctx, client);
  if (res.ok && !res.cancelled && typeof resolveAbility === 'function') {
    const result = resolveAbility('Opportunistic', {
      game, playerNum: pending.playerPN, cardName: 'Opportunistic',
      chosenFigureKey: opt.figureKey,
      n: 3,
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: game.pendingCombat,
    });
    if (result?.logMessage && typeof logGameAction === 'function' && client) {
      await logGameAction(game, client, result.logMessage, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
  if (typeof saveGames === 'function') await saveGames(gameId);
  await _drainWhenDamagedCcWindow(game, 'opportunistic_prompt', ctx);
}

/**
 * Handle Opportunistic skip. customId: `opportunistic_skip_${gameId}`
 */
export async function handleOpportunisticSkip(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const parts = splitCustomId(interaction.customId, 'opportunistic_skip_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingOpportunisticPrompt;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Opportunistic prompt.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.playerPN);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  clearPendingOpportunisticPrompt(game);
  if (typeof logGameAction === 'function' && client) {
    await logGameAction(game, client, '**Opportunistic** — skipped.', { phase: 'ROUND', icon: 'card' }).catch(() => {});
  }
  if (typeof saveGames === 'function') await saveGames(gameId);
  await _drainWhenDamagedCcWindow(game, 'opportunistic_prompt', ctx);
}
