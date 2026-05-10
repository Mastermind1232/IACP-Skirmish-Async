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
import { clearPendingDefeatCcPrompt, setPendingDefeatCcPrompt } from '../game/interrupts.js';
import { ccHandKey, ccDiscardKey, getDcMessageIds, getDcList } from '../game/player-helpers.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { getDcEffects } from '../data-loader.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';

/**
 * Enumerate alive friendly DCs for a player, optionally filtering by
 * keyword (e.g. GUARDIAN for Retaliation). Returns
 * { msgId, dcName, displayName, figureKey } for the FIRST figure of
 * each matching DC. Used by Debts Repaid / Retaliation target
 * picker per alexanbv 2026-05-10.
 */
function _friendlyDcOptions(game, playerNum, requiredKeyword = null) {
  const out = [];
  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const dcList = getDcList(game, playerNum) || [];
  const figs = game.figurePositions?.[playerNum] || {};
  const dcEffects = requiredKeyword ? (getDcEffects() || {}) : null;
  for (let i = 0; i < dcMsgIds.length; i++) {
    const dc = dcList[i];
    if (!dc || dc.defeated) continue;
    const dcName = (typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc) || '';
    const displayName = (typeof dc === 'object' ? dc.displayName : dcName) || dcName;
    const firstFig = Object.keys(figs).find(fk => fk.startsWith(dcName + '-'));
    if (!firstFig) continue;
    if (requiredKeyword && dcEffects) {
      const eff = dcEffects[dcName] || dcEffects[dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')];
      const kws = (eff?.keywords || []).map(k => String(k).toUpperCase());
      if (!kws.includes(String(requiredKeyword).toUpperCase())) continue;
    }
    out.push({ msgId: dcMsgIds[i], dcName, displayName, figureKey: firstFig });
  }
  return out;
}

const _NEEDS_TARGET_PICKER = new Set(['Debts Repaid', 'Retaliation']);
const _CARD_TARGET_KEYWORD = {
  'Retaliation': 'GUARDIAN',
};

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
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
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

  // Debts Repaid / Retaliation: post a friendly-DC target picker per
  // alexanbv 2026-05-10. These cards say "your Deployment card" /
  // "you" — player chooses which DC the effect lands on. Retaliation
  // additionally filters to GUARDIAN-keyword DCs per its playableBy
  // restriction.
  if (_NEEDS_TARGET_PICKER.has(cardName)) {
    const keyword = _CARD_TARGET_KEYWORD[cardName] || null;
    const options = _friendlyDcOptions(game, playerPN, keyword);
    if (options.length === 0) {
      clearPendingDefeatCcPrompt(game);
      if (typeof logGameAction === 'function' && client) {
        const kwNote = keyword ? ` (no friendly ${keyword} on board)` : ' — no eligible friendly Deployment card on board.';
        await logGameAction(game, client, `**${cardName}** — no eligible target${kwNote}.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
      if (typeof saveGames === 'function') await saveGames(gameId);
      return;
    }
    if (ButtonBuilder && ButtonStyle && ActionRowBuilder && interaction.channel?.send) {
      const buttons = options.slice(0, 5).map((opt, i) =>
        new ButtonBuilder()
          .setCustomId(`defeat_cc_target_${gameId}_${i}`)
          .setLabel(String(opt.displayName).slice(0, 80))
          .setStyle(ButtonStyle.Primary),
      );
      const row = new ActionRowBuilder().addComponents(buttons);
      setPendingDefeatCcPrompt(game, {
        ...pending,
        phase: 'target-pick',
        targetOptions: options,
      });
      const targetVerb = keyword
        ? `Choose a friendly **${keyword}** to play the card`
        : 'Choose a friendly Deployment card to receive the effect';
      await interaction.channel.send({
        content: `📜 **${cardName}** — ${targetVerb}:`,
        components: [row],
      }).catch(() => {});
      if (typeof saveGames === 'function') await saveGames(gameId);
      return;
    }
    // Discord components missing — fall through to immediate resolve.
  }

  clearPendingDefeatCcPrompt(game);

  if (typeof resolveAbility === 'function') {
    const result = resolveAbility(cardName, {
      game,
      playerNum: playerPN,
      cardName,
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

/**
 * Handle target-DC pick for Debts Repaid / Retaliation. customId:
 * `defeat_cc_target_${gameId}_${optionIdx}`. Reads pendingDefeatCcPrompt
 * (phase='target-pick'), runs resolveAbility with the chosen DC's
 * msgId in context, clears pending.
 */
export async function handleDefeatCcTargetPick(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client, logGameAction,
    resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
  } = ctx;
  const customId = interaction.customId;
  const m = customId.match(/^defeat_cc_target_([^_]+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid target pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = m[1];
  const optionIdx = parseInt(m[2], 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingDefeatCcPrompt;
  if (!pending || pending.gameId !== gameId || pending.phase !== 'target-pick') {
    await interaction.followUp({ content: 'No pending target pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.playerPN);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  const opt = (pending.targetOptions || [])[optionIdx];
  if (!opt) {
    clearPendingDefeatCcPrompt(game);
    if (typeof logGameAction === 'function' && client) {
      await logGameAction(game, client, `**${pending.cardName}** — invalid target index ${optionIdx}.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
    if (typeof saveGames === 'function') await saveGames(gameId);
    return;
  }

  // Retaliation: after the GUARDIAN is chosen, post a chooseOne mode
  // picker (Focused / 2 Power Tokens / Move 2). The next click runs
  // resolveAbility with msgId + choiceIndex.
  if (pending.cardName === 'Retaliation' && ButtonBuilder && ButtonStyle && ActionRowBuilder && interaction.channel?.send) {
    setPendingDefeatCcPrompt(game, {
      ...pending,
      phase: 'mode-pick',
      pickedMsgId: opt.msgId,
      pickedFigureKey: opt.figureKey,
      pickedDisplayName: opt.displayName,
    });
    const buttons = [
      new ButtonBuilder().setCustomId(`defeat_cc_mode_${gameId}_0`).setLabel('Become Focused').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`defeat_cc_mode_${gameId}_1`).setLabel('Gain 2 Power Tokens').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`defeat_cc_mode_${gameId}_2`).setLabel('Move up to 2 spaces').setStyle(ButtonStyle.Primary),
    ];
    await interaction.channel.send({
      content: `📜 **Retaliation** — **${opt.displayName}** chosen. Pick the effect:`,
      components: [new ActionRowBuilder().addComponents(buttons)],
    }).catch(() => {});
    if (typeof saveGames === 'function') await saveGames(gameId);
    return;
  }

  // Single-effect cards (Debts Repaid): run resolveAbility with the
  // chosen DC's msgId.
  clearPendingDefeatCcPrompt(game);
  if (typeof resolveAbility === 'function') {
    const result = resolveAbility(pending.cardName, {
      game,
      playerNum: pending.playerPN,
      cardName: pending.cardName,
      msgId: opt.msgId,
      chosenFigureKey: opt.figureKey,
      dcMessageMeta,
      dcHealthState,
      dcExhaustedState,
      combat: game.pendingCombat,
    });
    if (result?.logMessage && typeof logGameAction === 'function' && client) {
      const note = result.applied
        ? `**${pending.cardName}** — Target **${opt.displayName}**. ${result.logMessage}`
        : `**${pending.cardName}** — Target **${opt.displayName}**. ${result.manualMessage || result.logMessage}`;
      await logGameAction(game, client, note, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
  if (typeof saveGames === 'function') await saveGames(gameId);
}

/**
 * Handle chooseOne-mode pick for Retaliation. customId:
 * `defeat_cc_mode_${gameId}_${choiceIdx}`. Reads
 * pendingDefeatCcPrompt (phase='mode-pick') for the previously-chosen
 * target figure, then runs resolveAbility with msgId + choiceIndex.
 */
export async function handleDefeatCcModePick(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client, logGameAction,
    resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState,
  } = ctx;
  const customId = interaction.customId;
  const m = customId.match(/^defeat_cc_mode_([^_]+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid mode pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = m[1];
  const choiceIdx = parseInt(m[2], 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingDefeatCcPrompt;
  if (!pending || pending.gameId !== gameId || pending.phase !== 'mode-pick') {
    await interaction.followUp({ content: 'No pending mode pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ok = await requirePlayer(interaction, canActAsPlayer, gameId, pending.playerPN);
  if (!ok) return;
  await interaction.update({ components: [] }).catch(() => {});
  clearPendingDefeatCcPrompt(game);
  if (typeof resolveAbility === 'function') {
    const result = resolveAbility(pending.cardName, {
      game,
      playerNum: pending.playerPN,
      cardName: pending.cardName,
      msgId: pending.pickedMsgId,
      chosenFigureKey: pending.pickedFigureKey,
      choiceIndex: choiceIdx,
      dcMessageMeta,
      dcHealthState,
      dcExhaustedState,
      combat: game.pendingCombat,
    });
    if (result?.logMessage && typeof logGameAction === 'function' && client) {
      const note = result.applied
        ? `**${pending.cardName}** — Target **${pending.pickedDisplayName}**. ${result.logMessage}`
        : `**${pending.cardName}** — Target **${pending.pickedDisplayName}**. ${result.manualMessage || result.logMessage}`;
      await logGameAction(game, client, note, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
  if (typeof saveGames === 'function') await saveGames(gameId);
}
