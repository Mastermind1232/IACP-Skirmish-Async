/**
 * BEFORE_DEFEATED CC interrupt handlers (alexanbv 2026-05-10):
 *
 *   Dying Lunge (any-figure deferred-defeat — same shape as Parting Shot
 *     but as a CC). The dying figure performs Move 2 + free Melee attack,
 *     then is defeated.
 *   Miracle Worker (MHD-19 prevents-defeat). Heals a friendly within 3
 *     by 3 Damage; figure no longer at 0 HP, defeat exits via the
 *     curHp > 0 gate in completeDeferredDefeat.
 *   Preservation Protocol (4-LOM prevents-defeat). Heals 1 Damage on
 *     4-LOM and stamps a permanent flag suppressing 'Programming
 *     Override' + 'Shared Intuition' for the rest of the game.
 *
 * All three resume defeat (or skip-defeat) via the shared
 * `completeDeferredDefeat` helper in src/game/deferred-defeat.js, which
 * checks HP > 0 (heal-then-no-defeat) and YWNDM, then runs
 * WHEN_DEFEATED hooks + processFigureDefeat.
 *
 * Dying Lunge needs a combat-bridge resume hook (the dying figure's
 * free attack triggers final defeat); Miracle Worker and Preservation
 * Protocol resume immediately on the Play click because they heal
 * (no free attack).
 */
import {
  setPendingDyingLunge, clearPendingDyingLunge,
  clearPendingMiracleWorker,
  clearPendingPreservationProtocol,
} from '../game/interrupts.js';
import { completeDeferredDefeat as _completeDeferredDefeat } from '../game/deferred-defeat.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { healHp } from '../game/damage-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';
import { playCcFull } from './cc-pipeline.js';

// ── Dying Lunge ──────────────────────────────────────────────────────────

/**
 * Resume a Dying Lunge deferred defeat. Reads `pendingDyingLunge`,
 * clears it, then delegates to shared completeDeferredDefeat for the
 * dying figure (which IS the playing figure for Dying Lunge).
 */
export async function completeDyingLungeDefeat(game, ctx) {
  const pending = game.pendingDyingLunge;
  if (!pending) return null;
  clearPendingDyingLunge(game);
  return _completeDeferredDefeat(game, ctx, {
    figureKey: pending.figureKey,
    msgId: pending.msgId,
    figIndex: pending.figIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Dying Lunge resumed)`,
  });
}

export async function handleSkipDyingLunge(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const parts = splitCustomId(interaction.customId, 'dying_lunge_skip_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingDyingLunge;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Dying Lunge.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  if (typeof logGameAction === 'function' && client) {
    await logGameAction(game, client, `**Dying Lunge** skipped — figure defeats normally.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  }
  await completeDyingLungeDefeat(game, ctx);
  if (typeof saveGames === 'function') await saveGames(gameId);
}

export async function handleFireDyingLunge(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client, logGameAction,
    resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState,
  } = ctx;
  const parts = splitCustomId(interaction.customId, 'dying_lunge_play_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingDyingLunge;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Dying Lunge.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});

  const ownerPN = pending.controllerPlayerNum;
  // Guard: if another BEFORE_DEFEATED handler already cleared the figure,
  // skip rather than firing an attack with a non-existent figure.
  if (!game.figurePositions?.[ownerPN]?.[pending.figureKey]) {
    clearPendingDyingLunge(game);
    if (typeof logGameAction === 'function' && client) {
      await logGameAction(game, client, `**Dying Lunge** — figure already defeated; skipping.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
    if (typeof saveGames === 'function') await saveGames(gameId);
    return;
  }
  const dlRes = await playCcFull(game, gameId, ownerPN, null, 'Dying Lunge', {
    skipExecute: true, skipTimingCheck: true,
  }, ctx, client);

  if (dlRes.ok && !dlRes.cancelled) {
    // Passed: run move+attack, then deferred defeat fires after the attack.
    pending.active = true;
    setPendingDyingLunge(game, pending);
    if (typeof resolveAbility === 'function') {
      const result = resolveAbility('Dying Lunge', {
        game,
        playerNum: ownerPN,
        cardName: 'Dying Lunge',
        msgId: pending.msgId,
        dcMessageMeta,
        dcHealthState,
        dcExhaustedState,
        combat: game.pendingCombat,
      });
      const { applyDeferredAbilityEffects } = await import('../game/damage-pipeline.js');
      await applyDeferredAbilityEffects(game, ctx, result);
      if (result?.logMessage && typeof logGameAction === 'function' && client) {
        await logGameAction(game, client, `**Dying Lunge** — ${result.logMessage}`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
    }
  } else {
    // Card not in hand, or cancelled by Negate/Comms: figure defeats normally.
    await completeDyingLungeDefeat(game, ctx);
  }

  if (typeof saveGames === 'function') await saveGames(gameId);
}

// ── Miracle Worker ───────────────────────────────────────────────────────

export async function handleSkipMiracleWorker(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const parts = splitCustomId(interaction.customId, 'miracle_worker_skip_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingMiracleWorker;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Miracle Worker.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  clearPendingMiracleWorker(game);
  if (typeof logGameAction === 'function' && client) {
    await logGameAction(game, client, `**Miracle Worker** skipped — figure defeats normally.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  }
  await _completeDeferredDefeat(game, ctx, {
    figureKey: pending.targetFigureKey,
    msgId: pending.targetMsgId,
    figIndex: pending.targetFigIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Miracle Worker skipped)`,
  });
  if (typeof saveGames === 'function') await saveGames(gameId);
}

export async function handlePlayMiracleWorker(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, dcHealthState } = ctx;
  const parts = splitCustomId(interaction.customId, 'miracle_worker_play_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingMiracleWorker;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Miracle Worker.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});

  const ownerPN = pending.controllerPlayerNum;
  const mwRes = await playCcFull(game, gameId, ownerPN, null, 'Miracle Worker', {
    skipExecute: true, skipTimingCheck: true,
  }, ctx, client);

  // Heal only if the card successfully passed the counter window.
  if (mwRes.ok && !mwRes.cancelled && dcHealthState) {
    const { newHp } = healHp(dcHealthState, game, pending.targetMsgId, pending.targetFigIndex, pending.healAmount ?? 3, pending.controllerPlayerNum);
    if (typeof logGameAction === 'function' && client) {
      const targetDcName = dcNameFromFigureKey(pending.targetFigureKey);
      await logGameAction(game, client, `✨ **Miracle Worker** — **MHD-19** heals **${targetDcName}** for ${pending.healAmount ?? 3} (HP → ${newHp}). Defeat prevented.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
  clearPendingMiracleWorker(game);
  // Always complete deferred defeat — if healing brought HP > 0, completeDeferredDefeat
  // sees that and returns no-defeat; if cancelled/failed, figure defeats normally.
  await _completeDeferredDefeat(game, ctx, {
    figureKey: pending.targetFigureKey,
    msgId: pending.targetMsgId,
    figIndex: pending.targetFigIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Miracle Worker${mwRes.ok && !mwRes.cancelled ? ' resumed' : ' cancelled'})`,
  });
  if (typeof saveGames === 'function') await saveGames(gameId);
}

// ── Preservation Protocol ────────────────────────────────────────────────

export async function handleSkipPreservationProtocol(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const parts = splitCustomId(interaction.customId, 'preservation_protocol_skip_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingPreservationProtocol;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Preservation Protocol.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  clearPendingPreservationProtocol(game);
  if (typeof logGameAction === 'function' && client) {
    await logGameAction(game, client, `**Preservation Protocol** skipped — 4-LOM defeats normally.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  }
  await _completeDeferredDefeat(game, ctx, {
    figureKey: pending.figureKey,
    msgId: pending.msgId,
    figIndex: pending.figIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Preservation Protocol skipped)`,
  });
  if (typeof saveGames === 'function') await saveGames(gameId);
}

export async function handlePlayPreservationProtocol(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, dcHealthState } = ctx;
  const parts = splitCustomId(interaction.customId, 'preservation_protocol_play_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingPreservationProtocol;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Preservation Protocol.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.controllerPlayerNum);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});

  const ownerPN = pending.controllerPlayerNum;
  const ppRes = await playCcFull(game, gameId, ownerPN, null, 'Preservation Protocol', {
    skipExecute: true, skipTimingCheck: true,
  }, ctx, client);

  if (ppRes.ok && !ppRes.cancelled) {
    // Passed: heal 4-LOM and stamp permanent ability-suppression.
    if (dcHealthState) {
      const { newHp } = healHp(dcHealthState, game, pending.msgId, pending.figIndex, pending.healAmount ?? 1, pending.controllerPlayerNum);
      if (typeof logGameAction === 'function' && client) {
        await logGameAction(game, client, `🛡️ **Preservation Protocol** — **4-LOM** recovers ${pending.healAmount ?? 1} Damage (HP → ${newHp}). Loses **Programming Override** and **Shared Intuition** for the rest of the game.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
    }
    game.preservationProtocolUsed = game.preservationProtocolUsed || {};
    game.preservationProtocolUsed[ownerPN] = game.preservationProtocolUsed[ownerPN] || {};
    game.preservationProtocolUsed[ownerPN][pending.figureKey] = true;
    if (game.roundProgrammingOverrideTrait?.[ownerPN] != null) {
      game.roundProgrammingOverrideTrait[ownerPN] = null;
    }
  }
  clearPendingPreservationProtocol(game);
  // Always complete deferred defeat — if healing brought HP > 0, completeDeferredDefeat
  // returns no-defeat; if cancelled/failed, 4-LOM defeats normally.
  await _completeDeferredDefeat(game, ctx, {
    figureKey: pending.figureKey,
    msgId: pending.msgId,
    figIndex: pending.figIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Preservation Protocol${ppRes.ok && !ppRes.cancelled ? ' resumed' : ' cancelled'})`,
  });
  if (typeof saveGames === 'function') await saveGames(gameId);
}
