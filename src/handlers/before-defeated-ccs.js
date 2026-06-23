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
import { ccHandKey, ccDiscardKey } from '../game/player-helpers.js';
import { healHp } from '../game/damage-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';

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
  const handKey = ccHandKey(ownerPN);
  const discardKey = ccDiscardKey(ownerPN);
  const hand = game[handKey] || [];
  const dlIdx = hand.indexOf('Dying Lunge');
  if (dlIdx < 0) {
    await completeDyingLungeDefeat(game, ctx);
    if (typeof saveGames === 'function') await saveGames(gameId);
    return;
  }
  hand.splice(dlIdx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Dying Lunge');

  pending.active = true;
  setPendingDyingLunge(game, pending);

  // Run resolver targeted at the dying figure's msgId — it's the same
  // figure that will perform Move + free Melee attack. abilities.js:2107
  // honors the explicit context.msgId override.
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
    // Drain any queued damage through the ONE applyDamage pipeline (alexanbv
    // 2026-06-23). Idempotent; ctx carries dcHealthState + processFigureDefeat.
    if (game._pendingDamage?.length || result?.pendingDamage?.length) {
      const { drainPendingDamage } = await import('../game/damage-pipeline.js');
      await drainPendingDamage(game, ctx, result);
    }
    if (result?.logMessage && typeof logGameAction === 'function' && client) {
      await logGameAction(game, client, `**Dying Lunge** — ${result.logMessage}`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
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
  const handKey = ccHandKey(ownerPN);
  const discardKey = ccDiscardKey(ownerPN);
  const hand = game[handKey] || [];
  const mwIdx = hand.indexOf('Miracle Worker');
  if (mwIdx < 0) {
    clearPendingMiracleWorker(game);
    await _completeDeferredDefeat(game, ctx, {
      figureKey: pending.targetFigureKey,
      msgId: pending.targetMsgId,
      figIndex: pending.targetFigIndex,
      controllerPlayerNum: pending.controllerPlayerNum,
      attackerPlayerNum: pending.attackerPlayerNum,
      source: `${pending.source || 'Damage'} (Miracle Worker — card vanished)`,
    });
    if (typeof saveGames === 'function') await saveGames(gameId);
    return;
  }
  hand.splice(mwIdx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Miracle Worker');

  // Heal the target by 3 Damage. completeDeferredDefeat sees HP > 0 and
  // exits with wasDefeated:false.
  if (dcHealthState) {
    const { newHp } = healHp(dcHealthState, game, pending.targetMsgId, pending.targetFigIndex, pending.healAmount ?? 3, pending.controllerPlayerNum);
    if (typeof logGameAction === 'function' && client) {
      const targetDcName = dcNameFromFigureKey(pending.targetFigureKey);
      await logGameAction(game, client, `✨ **Miracle Worker** — **MHD-19** heals **${targetDcName}** for ${pending.healAmount ?? 3} (HP → ${newHp}). Defeat prevented.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
  clearPendingMiracleWorker(game);
  // Call completeDeferredDefeat — it sees HP > 0 and returns no-defeat.
  await _completeDeferredDefeat(game, ctx, {
    figureKey: pending.targetFigureKey,
    msgId: pending.targetMsgId,
    figIndex: pending.targetFigIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Miracle Worker resumed)`,
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
  const handKey = ccHandKey(ownerPN);
  const discardKey = ccDiscardKey(ownerPN);
  const hand = game[handKey] || [];
  const ppIdx = hand.indexOf('Preservation Protocol');
  if (ppIdx < 0) {
    clearPendingPreservationProtocol(game);
    await _completeDeferredDefeat(game, ctx, {
      figureKey: pending.figureKey,
      msgId: pending.msgId,
      figIndex: pending.figIndex,
      controllerPlayerNum: pending.controllerPlayerNum,
      attackerPlayerNum: pending.attackerPlayerNum,
      source: `${pending.source || 'Damage'} (Preservation Protocol — card vanished)`,
    });
    if (typeof saveGames === 'function') await saveGames(gameId);
    return;
  }
  hand.splice(ppIdx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Preservation Protocol');

  // Heal 4-LOM by 1 Damage and stamp the permanent ability-suppression
  // marker. The Programming Override + Shared Intuition resolvers must
  // consult game.preservationProtocolUsed[playerNum][figureKey] to
  // suppress those abilities for the rest of the game.
  if (dcHealthState) {
    const { newHp } = healHp(dcHealthState, game, pending.msgId, pending.figIndex, pending.healAmount ?? 1, pending.controllerPlayerNum);
    if (typeof logGameAction === 'function' && client) {
      await logGameAction(game, client, `🛡️ **Preservation Protocol** — **4-LOM** recovers ${pending.healAmount ?? 1} Damage (HP → ${newHp}). Loses **Programming Override** and **Shared Intuition** for the rest of the game.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
  game.preservationProtocolUsed = game.preservationProtocolUsed || {};
  game.preservationProtocolUsed[ownerPN] = game.preservationProtocolUsed[ownerPN] || {};
  game.preservationProtocolUsed[ownerPN][pending.figureKey] = true;
  // Programming Override is lost too — clear any active trait grant for
  // this player's 4-LOM. (The flag is stored at game.roundProgrammingOverrideTrait[playerNum].)
  if (game.roundProgrammingOverrideTrait?.[ownerPN] != null) {
    game.roundProgrammingOverrideTrait[ownerPN] = null;
  }

  clearPendingPreservationProtocol(game);
  await _completeDeferredDefeat(game, ctx, {
    figureKey: pending.figureKey,
    msgId: pending.msgId,
    figIndex: pending.figIndex,
    controllerPlayerNum: pending.controllerPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: `${pending.source || 'Damage'} (Preservation Protocol resumed)`,
  });
  if (typeof saveGames === 'function') await saveGames(gameId);
}
