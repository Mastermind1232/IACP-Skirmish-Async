/**
 * Parting Shot interrupt — deferred-defeat handler.
 *
 * Flow (per CRR + destruct 2026-05-08):
 *   1. Attack damage would defeat a Hired Gun / Greedo (parting_shot
 *      specialAbilityId).
 *   2. BEFORE_DEFEATED hook in damage-pipeline-hooks.js detects this,
 *      sets `pendingPartingShot`, posts [Fire Parting Shot] [Skip],
 *      and returns `preventDefeat: true` so reduceHp is skipped — the
 *      figure stays alive at its pre-defeat HP for the interrupt
 *      window.
 *   3. Player clicks "Skip Parting Shot" → `handleSkipPartingShot`
 *      runs, calls `completeDeferredDefeat`, defeat finalizes through
 *      applyDamage with `_skipBeforeDefeatedHooks: true` so the hook
 *      doesn't re-fire and loop.
 *   4. Player clicks "Fire Parting Shot" → `handleFirePartingShot`
 *      flips `pendingPartingShot.active = true`. Player then declares
 *      an attack via the figure's normal Attack button. The combat
 *      resolves; combat-bridge.js end-of-resolveCombat checks for
 *      `pendingPartingShot.active && completedThisAttack` and calls
 *      `completeDeferredDefeat` to finalize the defeat.
 */

import { WHEN_DEFEATED_HOOKS, _ensureHooksLoaded } from '../game/damage-pipeline.js';
import { setPendingPartingShot, clearPendingPartingShot } from '../game/interrupts.js';
import { processFigureDefeat } from '../engine/defeat-handler.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { getDcList, getDcMessageIds, opponentPlayerNum } from '../game/player-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';

/**
 * Resume a defeat that was deferred by a BEFORE_DEFEATED interrupt.
 * Called by Skip handler (immediately) or by combat-bridge.js after
 * the interrupt ability's attack resolves.
 *
 * The figure's HP is already at 0 (reduceHp ran when damage was first
 * applied — preventDefeat only deferred the WHEN_DEFEATED hooks +
 * processFigureDefeat, NOT reduceHp). Resume by firing WHEN_DEFEATED
 * hooks + calling processFigureDefeat to finalize the defeat.
 */
export async function completeDeferredDefeat(game, ctx) {
  const pending = game.pendingPartingShot;
  if (!pending) return null;
  clearPendingPartingShot(game);
  await _ensureHooksLoaded();

  // Snapshot defeated position before processFigureDefeat clears it.
  const defeatedPos = game.figurePositions?.[pending.controllerPlayerNum]?.[pending.figureKey] || null;
  const dcHealth = ctx?.dcHealthState?.get?.(pending.msgId) || [];
  const figEntry = dcHealth[pending.figIndex] || [0, 0];
  const prevHp = figEntry[0] ?? 0;

  // "Prevent defeat" effects:
  //   - Second Chance / Miracle Worker: heal HP > 0 → figure visibly
  //     alive; check HP.
  //   - YWNDM (Fifth Brother): keeps figure at HP=0 until falloff
  //     condition triggers (per destruct 2026-05-08 — YWNDM doesn't
  //     heal). Check the YWNDM flag.
  if (prevHp > 0) {
    return { wasDefeated: false };
  }
  if (game.youWillNotDenyMeActive?.playerNum === pending.controllerPlayerNum) {
    const fName = dcNameFromFigureKey(pending.figureKey);
    if (String(fName).toLowerCase().includes('fifth')) {
      return { wasDefeated: false };
    }
  }

  // 1. WHEN_DEFEATED hooks (deferred from the original applyDamage call).
  const defeatedOpts = {
    figureKey: pending.figureKey,
    msgId: pending.msgId,
    figIndex: pending.figIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Parting Shot resumed)`,
    amount: 0,
    prevHp,
    defeatedPos,
  };
  for (const hook of WHEN_DEFEATED_HOOKS) {
    if (!hook.probe || !hook.apply) continue;
    if (!hook.probe(game, defeatedOpts)) continue;
    try {
      await hook.apply(game, defeatedOpts, ctx);
    } catch (err) {
      console.error(`[parting-shot] WHEN_DEFEATED hook ${hook.id} threw:`, err?.message ?? err);
    }
  }

  // 2. processFigureDefeat — canonical defeat resolution (position
  //    cleanup, conditions, VP, defeat log, etc.).
  const dcList = getDcList(game, pending.controllerPlayerNum) || [];
  const dcMessageIds = getDcMessageIds(game, pending.controllerPlayerNum) || [];
  const dcIdx = dcMessageIds.indexOf(pending.msgId);
  const dcName = dcNameFromFigureKey(pending.figureKey);
  await processFigureDefeat(game, {
    defeatedPlayerNum: pending.controllerPlayerNum,
    figureKey: pending.figureKey,
    attackerPlayerNum: pending.attackerPlayerNum ?? opponentPlayerNum(pending.controllerPlayerNum),
    msgId: pending.msgId,
    dcIdx,
    dcName,
    source: `Parting Shot defeat`,
  }, ctx);
  return { wasDefeated: true };
}

export async function handleSkipPartingShot(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcHealthState, logGameAction } = ctx;
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
  await completeDeferredDefeat(game, { dcHealthState, logGameAction, client });
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
