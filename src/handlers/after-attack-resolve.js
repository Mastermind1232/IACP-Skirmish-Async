/**
 * Step-8 / after-attack-resolves window handlers.
 *
 * destruct 2026-05-08 spec: every step-8 effect (Blast, Cleave, Recover,
 * surge-conditions, after-resolve DC abilities, after-resolve CCs)
 * prompts the player rather than firing automatically. Multiple effects
 * fire in the player's chosen order. Each effect has its own button;
 * a Skip-this-effect button is offered for optional ones; a "Done"
 * button finishes the player's window.
 *
 * Window order:
 *   1. After main-target damage applies (step 7 done), enqueue eligible
 *      step-8 effects via enqueueAfterAttackEffect (see after-attack-queue.js).
 *   2. postAttackerPostResolveWindow — attacker clicks effects in any
 *      order; Done advances to defender window.
 *   3. postDefenderPostResolveWindow — defender resolves their own
 *      step-8 effects (Slippery, Force Deflection, Return Fire, etc.)
 *      and after-resolve CCs from hand.
 *   4. Defender Done → existing _finishCombatResolution closes combat.
 *
 * The fire handlers for each effect type (`fireRecover`, `fireBlast`,
 * `fireCleave`, `fireCondition`, ...) live in src/handlers/after-attack-fire.js
 * and are invoked from this module's button click router.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  enqueueAfterAttackEffect,
  getAfterAttackEffects,
  consumeAfterAttackEffect,
  hasPendingAfterAttackEffects,
  clearAfterAttackEffects,
} from '../engine/after-attack-queue.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { fetchCombatThread } from '../discord/channel-helpers.js';
import { getPlayerId, opponentPlayerNum } from '../game/player-helpers.js';
import { parseCustomId } from '../discord/custom-id.js';
import { requireGame } from '../utils/guards.js';
import { fireEffect } from './after-attack-fire.js';

/**
 * Enqueue all step-8 effects pending for the attacker side based on
 * current combat state. Called after main-target damage applies.
 *
 * Reads combat fields written during steps 1-7:
 *   surgeRecover, surgeBlast/bonusBlast, surgeCleave/passiveCleave,
 *   bonusConditions, cleaveSources, etc.
 *
 * Per-DC after-resolve abilities (Tress Leg Hydraulics, Heavy Fire,
 * Cover Fire, Stalk Prey, ...) get enqueued here in follow-up commits;
 * for now the keyword effects (Blast, Cleave, Recover, conditions) are
 * the minimum-viable set so the button window has something to render.
 */
export function enqueueAttackerStep8Effects(combat) {
  if (!combat) return;
  const hit = combat._step7Hit ?? true;
  const damage = combat._step7Damage ?? 0;

  // Recover N — heal attacker. Sustained by Rage blocks own Recover.
  // (Blocked elsewhere; here we just enqueue if the keyword fired.)
  if ((combat.surgeRecover || 0) > 0 && combat.attackerMsgId != null) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'recover',
      label: `Recover ${combat.surgeRecover}`,
      payload: { amount: combat.surgeRecover },
    });
  }

  // Blast N — applies to figures adjacent to target's pre-defeat coord.
  // Only fires when attack hit AND main-target damage > 0 (CRR step 8).
  const totalBlast = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
  if (hit && damage > 0 && totalBlast > 0) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'blast',
      label: `Apply Blast ${totalBlast}`,
      payload: { amount: totalBlast },
    });
  }

  // Cleave (one entry per accumulation site; multiple Cleaves resolve
  // in attacker's chosen order, CRR-CLV-005). cleaveSources holds the
  // list when populated by step-1/2; falls back to a single source for
  // the simple effectiveCleave path.
  if (hit && damage > 0) {
    const cleaveSources = Array.isArray(combat.cleaveSources) && combat.cleaveSources.length > 0
      ? combat.cleaveSources
      : ((combat.surgeCleave || 0) + (combat.passiveCleave || 0)) > 0
        ? [{ value: (combat.surgeCleave || 0) + (combat.passiveCleave || 0), label: `Cleave ${(combat.surgeCleave || 0) + (combat.passiveCleave || 0)}` }]
        : [];
    for (const src of cleaveSources) {
      enqueueAfterAttackEffect(combat, {
        side: 'attacker',
        type: 'cleave',
        label: src.label || `Cleave ${src.value}`,
        payload: { amount: src.value, sourceLabel: src.label },
      });
    }
  }

  // Surge-conditions: each condition queued by surge / passive / CC
  // becomes its own button (attacker decides whether to apply each).
  // Per destruct, conditions are damage-gated (already enforced inside
  // fireCondition handler).
  const condList = Array.isArray(combat.bonusConditions) ? combat.bonusConditions : [];
  for (const cond of condList) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'condition',
      label: `Apply ${cond}`,
      payload: { condition: cond },
    });
  }
}

/**
 * Enqueue defender-side step-8 effects. Called when attacker's window
 * closes (Done). Per-DC defender after-resolve abilities (Slippery,
 * Force Deflection, Return Fire, Deflect, Deflection) get enqueued
 * here in follow-up commits; this skeleton is intentionally empty so
 * the defender window opens-and-closes cleanly even when there are no
 * pending def effects.
 */
export function enqueueDefenderStep8Effects(_combat) {
  // Stub — populated in follow-up commits.
}

/**
 * Render and post the post-resolve window for one side. Each pending
 * effect for that side gets a Primary button with its label; a Done
 * button finishes the window. If the queue is empty for this side,
 * skips the prompt and advances directly.
 */
export async function postPostResolveWindow(thread, game, combat, side, ctx) {
  if (!combat) return;
  // Auto-drain conditions:
  //   - selfPlay (live Discord bot-vs-bot games)
  //   - !thread (no Discord thread to post into)
  //   - fake client (headless oracle/fixture tests)
  // Live human games keep the buttons + require a Done click.
  if (game.selfPlay || !thread || ctx?.client?._isFakeClient) {
    await _selfPlayDrain(thread, game, combat, side, ctx);
    return;
  }
  // destruct 2026-05-08: window must NEVER auto-advance even when the
  // queue is empty for this side — the player needs the chance to
  // play after-attack CCs from hand and then press Done. Always post
  // at least a Done button.
  const ownerPN = side === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1)
    : opponentPlayerNum(combat.attackerPlayerNum ?? 1);
  const ownerId = getPlayerId(game, ownerPN);
  const effects = getAfterAttackEffects(combat, side);
  const buttons = effects.slice(0, 24).map((eff) =>
    new ButtonBuilder()
      .setCustomId(`aar_fire_${game.gameId}_${eff.id}`)
      .setLabel(eff.label.slice(0, 80))
      .setStyle(ButtonStyle.Primary),
  );
  // Two literal customId variants so the handler-emit parity scanner
  // can find both `aar_done_atk_` and `aar_done_def_` prefixes in src/.
  const _doneId = side === 'attacker'
    ? `aar_done_atk_${game.gameId}`
    : `aar_done_def_${game.gameId}`;
  buttons.push(
    new ButtonBuilder()
      .setCustomId(_doneId)
      .setLabel('Done (skip remaining)')
      .setStyle(ButtonStyle.Secondary),
  );
  // Discord caps a row at 5 buttons; chunk into rows of 5.
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
  }
  const sideLabel = side === 'attacker' ? 'Attacker' : 'Defender';
  const mention = ownerId ? `<@${ownerId}> ` : '';
  await withDiscordRetry(() => thread.send({
    content: `${mention}**After Attack Resolves — ${sideLabel}:** click any pending effect to apply it (any order). Click **Done** when finished.`,
    components: rows.slice(0, 5),
    allowedMentions: ownerId ? { users: [ownerId] } : undefined,
  }));
}

/**
 * Click handler for `aar_fire_<gameId>_<effectId>` — fires the effect
 * via fireEffect (after-attack-fire.js), removes it from the queue,
 * and re-renders the window with remaining buttons.
 */
export async function handleAarFire(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^aar_fire_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, effectId] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) return;
  // Disable buttons on the source message — prevents double-clicks.
  try {
    const newRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) newRow.addComponents(ButtonBuilder.from(c).setDisabled(true));
      return newRow;
    });
    if (newRows.length > 0) await interaction.message.edit({ components: newRows }).catch(discordCatch);
  } catch { /* non-fatal */ }
  const effect = consumeAfterAttackEffect(combat, effectId);
  if (!effect) return;
  const thread = await fetchCombatThread(client, combat.combatThreadId);
  if (!thread) return;
  // Permission: only the side's owner may click their button.
  const ownerPN = effect.side === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1)
    : opponentPlayerNum(combat.attackerPlayerNum ?? 1);
  const ownerId = getPlayerId(game, ownerPN);
  if (ownerId && interaction.user.id !== ownerId && !game.isTestGame) {
    // Not the right player — re-enqueue the effect so the rightful
    // owner can still click it.
    enqueueAfterAttackEffect(combat, effect);
    saveGames?.(game.gameId);
    return;
  }
  await fireEffect(thread, game, combat, effect, ctx);
  // After firing, re-post the window so the player can fire more
  // pending effects, play after-attack CCs from hand, or click Done.
  // destruct 2026-05-08: never auto-advance — Done is mandatory.
  await postPostResolveWindow(thread, game, combat, effect.side, ctx);
  saveGames?.(game.gameId);
}

/**
 * Click handler for `aar_done_atk_<gameId>` and `aar_done_def_<gameId>`.
 * The owning side has chosen to skip all remaining (optional) effects.
 * Drain that side's queue without firing, then advance.
 */
export async function handleAarDone(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const isAtk = interaction.customId.startsWith('aar_done_atk_');
  const side = isAtk ? 'attacker' : 'defender';
  const gameId = parseCustomId(interaction.customId, isAtk ? 'aar_done_atk_' : 'aar_done_def_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) return;
  // Disable buttons on the source message.
  try {
    const newRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) newRow.addComponents(ButtonBuilder.from(c).setDisabled(true));
      return newRow;
    });
    if (newRows.length > 0) await interaction.message.edit({ components: newRows }).catch(discordCatch);
  } catch { /* non-fatal */ }
  const ownerPN = side === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1)
    : opponentPlayerNum(combat.attackerPlayerNum ?? 1);
  const ownerId = getPlayerId(game, ownerPN);
  if (ownerId && interaction.user.id !== ownerId && !game.isTestGame) return;
  // Drain remaining effects on this side. Skipped effects do NOT fire.
  const remaining = getAfterAttackEffects(combat, side);
  for (const e of remaining) consumeAfterAttackEffect(combat, e.id);
  const thread = await fetchCombatThread(client, combat.combatThreadId);
  if (thread) await _advanceFromSide(thread, game, combat, side, ctx);
  saveGames?.(game.gameId);
}

/**
 * Internal: advance from one side's window to the next. After
 * attacker → enqueue defender effects + post defender window. After
 * defender → run existing combat-close cleanup.
 */
async function _advanceFromSide(thread, game, combat, side, ctx) {
  if (side === 'attacker') {
    enqueueDefenderStep8Effects(combat);
    await postPostResolveWindow(thread, game, combat, 'defender', ctx);
    return;
  }
  // Defender done — close combat. Caller passes the existing
  // _finishCombatResolution handle through ctx.afterAttackClose.
  clearAfterAttackEffects(combat);
  if (typeof ctx.afterAttackClose === 'function') {
    await ctx.afterAttackClose(thread, game, combat);
  }
}

/**
 * Self-play: fire each pending effect with the auto-pick path, then
 * advance. Used by headless training so the bot never stalls waiting
 * for a button click.
 */
async function _selfPlayDrain(thread, game, combat, side, ctx) {
  while (hasPendingAfterAttackEffects(combat, side)) {
    const effects = getAfterAttackEffects(combat, side);
    const eff = effects[0];
    consumeAfterAttackEffect(combat, eff.id);
    await fireEffect(thread, game, combat, eff, ctx);
  }
  await _advanceFromSide(thread, game, combat, side, ctx);
}
