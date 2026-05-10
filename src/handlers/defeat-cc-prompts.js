/**
 * Player-choice WHEN_DEFEATED CC auto-prompt handlers (alexanbv 2026-05-10).
 *
 * Four CCs that fire on figure defeat and were previously visible only as
 * silent "you have N reaction cards" pings via _notifyCcPlayWindow. Now
 * each posts an explicit Play/Skip prompt in the combat thread when its
 * conditions match (hook in damage-pipeline-hooks.js).
 *
 *   Debts Repaid (Chewbacca) — friendly defeated → Focused + ready DC
 *   Lord of the Sith (Vader) — hostile defeated NOT your activation →
 *     move 2 + Force Choke or free Melee attack
 *   Paid in Beskar (HUNTER) — hostile within 3 defeated → set "next
 *     hostile defeat grants 2 Block Tokens" flag (per existing
 *     whenDefeatHostileWithin3GainBlockTokens resolver)
 *   Retaliation (GUARDIAN) — friendly defeated → chooseOne: Focused /
 *     2 Power Tokens / Move 2
 *
 * Click handlers route through resolveAbility for the actual effect.
 * The four resolvers are already wired in abilities.js + ability-library
 * with `applyFocus + readyActiveDc`, `lordOfTheSithEffect`,
 * `whenDefeatHostileWithin3GainBlockTokens`, and `chooseOne` paths.
 *
 * NOTE: some resolvers (Debts Repaid, Retaliation) depend on
 * findActiveActivationMsgId — when played out-of-activation, they
 * return manualMessage. That's a separate resolver-side fix; the
 * auto-prompt itself is correct.
 */
import { clearPendingDefeatCcPrompt } from '../game/interrupts.js';
import { ccHandKey, ccDiscardKey, getDcMessageIds, getDcList } from '../game/player-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';

/**
 * Find the first friendly DC msgId for a player that has at least one
 * figure on the board. Used as the default target for out-of-activation
 * Debts Repaid / Retaliation plays. Not a picker — picker UX is a
 * follow-up; this unblocks the canonical "fires regardless of whose
 * activation" trigger so the card actually resolves.
 */
function _firstFriendlyDcMsgId(game, playerNum) {
  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const dcList = getDcList(game, playerNum) || [];
  const figs = game.figurePositions?.[playerNum] || {};
  for (let i = 0; i < dcMsgIds.length; i++) {
    const dc = dcList[i];
    if (!dc || dc.defeated) continue;
    const dcName = (typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc) || '';
    const hasFigure = Object.keys(figs).some(fk => fk.startsWith(dcName + '-'));
    if (hasFigure) return dcMsgIds[i];
  }
  return null;
}

export async function handleSkipDefeatCcPrompt(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const parts = splitCustomId(interaction.customId, 'defeat_cc_skip_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingDefeatCcPrompt;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending defeat CC prompt.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.playerPN);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  clearPendingDefeatCcPrompt(game);
  if (typeof logGameAction === 'function' && client) {
    await logGameAction(game, client, `**${pending.cardName}** — skipped.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  }
  if (typeof saveGames === 'function') await saveGames(gameId);
}

export async function handlePlayDefeatCcPrompt(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client, logGameAction,
    resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState,
  } = ctx;
  const parts = splitCustomId(interaction.customId, 'defeat_cc_play_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingDefeatCcPrompt;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending defeat CC prompt.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.playerPN);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});

  const { playerPN, cardName } = pending;
  const handKey = ccHandKey(playerPN);
  const discardKey = ccDiscardKey(playerPN);
  const hand = game[handKey] || [];
  const idx = hand.indexOf(cardName);
  if (idx < 0) {
    clearPendingDefeatCcPrompt(game);
    if (typeof logGameAction === 'function' && client) {
      await logGameAction(game, client, `**${cardName}** — card no longer in hand.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
    if (typeof saveGames === 'function') await saveGames(gameId);
    return;
  }
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(cardName);
  clearPendingDefeatCcPrompt(game);

  if (typeof resolveAbility === 'function') {
    // Out-of-activation auto-targeting: per alexanbv 2026-05-10, Debts
    // Repaid and Retaliation must work regardless of whose activation
    // is in progress. When the controller isn't currently activating,
    // their canonical resolvers (Focus + readyActiveDc, etc.) need an
    // explicit target msgId. Pass the first friendly DC's msgId as the
    // default target; the resolver honors context.msgId override (see
    // abilities.js Focus resolver). Picker UX is a follow-up.
    let _targetMsgId = null;
    if (cardName === 'Debts Repaid' || cardName === 'Retaliation') {
      _targetMsgId = _firstFriendlyDcMsgId(game, playerPN);
    }
    const result = resolveAbility(cardName, {
      game,
      playerNum: playerPN,
      cardName,
      msgId: _targetMsgId ?? undefined,
      dcMessageMeta,
      dcHealthState,
      dcExhaustedState,
      combat: game.pendingCombat,
    });
    if (result?.logMessage && typeof logGameAction === 'function' && client) {
      const note = result.applied
        ? `**${cardName}** — ${result.logMessage}`
        : `**${cardName}** — ${result.manualMessage || result.logMessage}`;
      await logGameAction(game, client, note, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
  if (typeof saveGames === 'function') await saveGames(gameId);
}
