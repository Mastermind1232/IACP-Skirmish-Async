/**
 * Parting Shot interrupt — deferred-defeat handler.
 *
 * Flow (per CRR + destruct 2026-05-08):
 *   1. Damage applied via applyDamage; reduceHp brought HP to 0.
 *   2. BEFORE_DEFEATED hook in damage-pipeline-hooks.js detects PS,
 *      sets `pendingPartingShot`, posts [Fire Parting Shot] [Skip],
 *      returns `preventDefeat: true` so the caller skips
 *      processFigureDefeat.
 *   3. Player clicks "Skip Parting Shot" → handleSkipPartingShot →
 *      completeDeferredDefeat (shared in src/game/deferred-defeat.js).
 *      That helper checks HP > 0 (Second Chance/MW healed) and YWNDM
 *      flag before firing WHEN_DEFEATED hooks + processFigureDefeat.
 *   4. Player clicks "Fire Parting Shot" → handleFirePartingShot
 *      flips `pendingPartingShot.active = true`. Posts a
 *      `granted_attack_*` button so the player declares the free
 *      interrupt attack. After that combat resolves,
 *      end-of-finishCombatResolution calls completeDeferredDefeat.
 */

import { setPendingPartingShot, clearPendingPartingShot } from '../game/interrupts.js';
import { completeDeferredDefeat as _completeDeferredDefeat } from '../game/deferred-defeat.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';

/**
 * Resume a Parting Shot deferred defeat. Reads `pendingPartingShot`,
 * clears it, then delegates to the shared completeDeferredDefeat.
 */
export async function completeDeferredDefeat(game, ctx) {
  const pending = game.pendingPartingShot;
  if (!pending) return null;
  clearPendingPartingShot(game);
  return _completeDeferredDefeat(game, ctx, {
    figureKey: pending.figureKey,
    msgId: pending.msgId,
    figIndex: pending.figIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Parting Shot resumed)`,
  });
}

export async function handleSkipPartingShot(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const parts = splitCustomId(interaction.customId, 'parting_shot_skip_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingPartingShot;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Parting Shot.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  if (typeof logGameAction === 'function' && client) {
    await logGameAction(game, client, `**Parting Shot** skipped — figure defeats normally.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  }
  // Pass full ctx so processFigureDefeat has its required deps.
  await completeDeferredDefeat(game, ctx);
  if (typeof saveGames === 'function') await saveGames(gameId);
}

export async function handleFirePartingShot(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  const parts = splitCustomId(interaction.customId, 'parting_shot_fire_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingPartingShot;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Parting Shot.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  pending.active = true;
  setPendingPartingShot(game, pending);
  await interaction.update({ components: [] }).catch(() => {});
  // Post a granted_attack_* button so the player can declare the
  // free interrupt attack with the figure. Per destruct 2026-05-08:
  // "treat these interrupt attacks like granted attacks for all
  // intents and purposes." After this attack's combat resolves,
  // end-of-finishCombatResolution calls completeDeferredDefeat.
  const figIdxMatch = String(pending.figureKey).match(/-(\d+)-(\d+)$/);
  const figIdx = figIdxMatch ? figIdxMatch[2] : '0';
  const dcName = dcNameFromFigureKey(pending.figureKey);
  if (ButtonBuilder && ButtonStyle && ActionRowBuilder && interaction.channel?.send) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`granted_attack_${gameId}_${pending.msgId}_f${figIdx}`)
        .setLabel(`Fire Parting Shot (${dcName})`)
        .setStyle(ButtonStyle.Danger),
    );
    await interaction.channel.send({
      content: `⚔️ **Parting Shot** armed — fire your free attack now. The figure will defeat after the attack resolves.`,
      components: [row],
    }).catch(() => {});
  }
  if (typeof logGameAction === 'function' && client) {
    await logGameAction(
      game,
      client,
      `**Parting Shot** armed — granted free attack queued.`,
      { phase: 'ROUND', icon: 'attack' },
    ).catch(() => {});
  }
  if (typeof saveGames === 'function') await saveGames(gameId);
}
