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
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { clearPendingDefeatCcPrompt, setPendingDefeatCcPrompt } from '../game/interrupts.js';
import { ccHandKey, ccDiscardKey, getDcMessageIds, getDcList, getPlayerId } from '../game/player-helpers.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { countGameSpaces } from '../game/board-helpers.js';
import { getDcEffects, getCcEffect } from '../data-loader.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { runCcPlayTriggers } from './cc-hand.js';
import { openCcCounterWindow, registerCcCustomResolve } from './cc-pipeline.js';

// Drain the deferred side-effects a (sync) resolveAbility produced in the one
// canonical order: strain COST → DAMAGE → dealt STRAIN → CONDITIONS (alexanbv
// 2026-06-23). Defeat CCs like Lord of the Sith (Force Choke) deal Damage +
// Strain here. ctx carries dcHealthState + processFigureDefeat. Idempotent.
async function _drainDefeatCcDamage(game, ctx, result) {
  if (!game) return;
  const { applyDeferredAbilityEffects } = await import('../game/damage-pipeline.js');
  await applyDeferredAbilityEffects(game, ctx, result);
}

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
// Unique-figure CCs: playableBy is a specific NAMED figure (not a
// keyword like TROOPER/GUARDIAN). Mara Jade can play these via Fast
// Learner once per round. Map cardName → namedFigure for the picker.
const _CARD_UNIQUE_FIGURE = {
  'Debts Repaid': 'Chewbacca',
};

/**
 * Look up a single named DC for a player. Returns
 * { msgId, dcName, displayName, figureKey } or null if the named figure
 * isn't in the army or is fully defeated.
 */
function _findNamedDc(game, playerNum, namedFigure) {
  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const dcList = getDcList(game, playerNum) || [];
  const figs = game.figurePositions?.[playerNum] || {};
  const wantLower = String(namedFigure).toLowerCase();
  for (let i = 0; i < dcMsgIds.length; i++) {
    const dc = dcList[i];
    if (!dc || dc.defeated) continue;
    const dcName = (typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc) || '';
    const dcBase = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim().toLowerCase();
    if (dcBase !== wantLower && dcName.toLowerCase() !== wantLower) continue;
    const figureKey = Object.keys(figs).find(fk => fk.startsWith(dcName + '-'));
    if (!figureKey) continue;
    const displayName = (typeof dc === 'object' ? dc.displayName : dcName) || dcName;
    return { msgId: dcMsgIds[i], dcName, displayName, figureKey };
  }
  return null;
}

/**
 * Mara Jade's Fast Learner availability: returns Mara's DC info if
 * she's alive on the player's side AND `${maraDcName}_fast_learner`
 * hasn't been set in `game.roundFigureAbilityUsed`. Otherwise null.
 */
function _maraFastLearnerOption(game, playerNum) {
  const dcList = getDcList(game, playerNum) || [];
  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const figs = game.figurePositions?.[playerNum] || {};
  const dcEffects = getDcEffects() || {};
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    const dcName = (typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc) || '';
    const eff = dcEffects[dcName] || dcEffects[dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')];
    if (!(eff?.specialAbilityIds || []).includes('fast_learner_mara_jade')) continue;
    if (game.roundFigureAbilityUsed?.[`${dcName}_fast_learner`]) return null;
    const figureKey = Object.keys(figs).find(fk => fk.startsWith(dcName + '-'));
    if (!figureKey) return null;
    const displayName = (typeof dc === 'object' ? dc.displayName : dcName) || dcName;
    return { msgId: dcMsgIds[i], dcName, displayName, figureKey, viaFastLearner: true };
  }
  return null;
}

/**
 * Unique-figure CC eligibility: returns [namedFigure, ...maraIfFL].
 * Length 0 → restriction-check should've already blocked the play.
 * Length 1 → auto-resolve, no picker. Length 2 → picker.
 */
function _uniqueFigurePlayers(game, playerNum, namedFigure) {
  const out = [];
  const named = _findNamedDc(game, playerNum, namedFigure);
  if (named) out.push({ ...named, viaFastLearner: false });
  const mara = _maraFastLearnerOption(game, playerNum);
  if (mara && (!named || mara.dcName !== named.dcName)) out.push(mara);
  return out;
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
  // Play-time: validate + commit + open the counter-window. The effect (picker /
  // resolveAbility) is deferred to the 'defeat_cc' continuation below.
  _ensureDefeatCcResolver();
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, dcMessageMeta } = ctx;
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

  // Route through the unified counter-window: ALL CCs are counterable
  // (alexanbv 2026-06-19). The bespoke target/mode picker (or direct resolve)
  // runs via the 'defeat_cc' continuation ONLY if the card survives the
  // Negate/Comms window. The captured channelId lets the continuation post the
  // first picker without an interaction.
  // Capture the defeat context BEFORE clearing — some defeat CCs (Paid in
  // Beskar) need the defeated figure's position to resolve their effect.
  const _defeatedPos = pending.defeatedPos ?? null;
  const _defeatedFigureKey = pending.defeatedFigureKey ?? null;
  clearPendingDefeatCcPrompt(game);
  // Public play-reveal: announce the played card to both players (matches the
  // hand-play reveal style) before triggers / the counter-window open.
  const _defeatPid = getPlayerId(game, playerPN);
  if (typeof logGameAction === 'function' && client) {
    await logGameAction(game, client, `<@${_defeatPid}> played command card **${cardName}**.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: _defeatPid ? [_defeatPid] : [] } });
  }
  await runCcPlayTriggers(game, playerPN, { client, logGameAction, dcMessageMeta, saveGames });
  const _dcCost = getCcEffect(cardName)?.cost;
  await openCcCounterWindow(game, gameId, {
    card: cardName, cost: typeof _dcCost === 'number' ? _dcCost : 0,
    playedBy: playerPN, abilityId: cardName,
    customResolve: 'defeat_cc', channelId: interaction.channel?.id ?? null,
    defeatedPos: _defeatedPos, defeatedFigureKey: _defeatedFigureKey,
  }, ctx, client);
  if (typeof saveGames === 'function') await saveGames(gameId);
}

// WHEN_DEFEATED CCs (Debts Repaid, Retaliation, ...) — post-counter-window
// continuation. Runs the target/mode picker (or resolves directly) once the
// card has survived the Negate/Comms window. Mirrors the original inline flow,
// but posts the first picker to the captured channel (no interaction) and
// reconstructs the target-pick pending state for the existing
// defeat_cc_target_/defeat_cc_mode_ sub-handlers (which keep their own
// interaction). A cancelled card never reaches here.
// Registered lazily (first play) rather than at module load to avoid a
// load-time circular-import TDZ with cc-hand.js (which this file imports).
let _defeatCcResolverRegistered = false;
function _ensureDefeatCcResolver() {
  if (_defeatCcResolverRegistered) return;
  _defeatCcResolverRegistered = true;
  registerCcCustomResolve('defeat_cc', _resolveDefeatCcEffect);
}

/**
 * Friendly figures with `keyword` that are within `range` spaces of `pos`.
 * Used by the Paid in Beskar HUNTER picker so the player only ever chooses an
 * ELIGIBLE anchor (the within-3 gate is part of the card). Returns figure-level
 * options ({figureKey, displayName}) — a DC can field multiple figures at
 * different distances, so the choice is per-figure, not per-DC.
 */
function _friendlyKeywordFiguresWithin(game, playerNum, keyword, pos, range) {
  const out = [];
  if (!pos) return out;
  const dcEffects = getDcEffects() || {};
  const figs = game.figurePositions?.[playerNum] || {};
  const want = String(keyword).toUpperCase();
  for (const [fk, fpos] of Object.entries(figs)) {
    if (!fpos) continue;
    const dn = dcNameFromFigureKey(fk);
    const eff = dcEffects[dn] || dcEffects[dn.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')];
    const kws = (eff?.keywords || []).map((k) => String(k).toUpperCase());
    if (!kws.includes(want)) continue;
    if (countGameSpaces(game, pos, fpos) > range) continue;
    out.push({ figureKey: fk, displayName: dn });
  }
  return out;
}

async function _resolveDefeatCcEffect(game, entry, ctx, client) {
  const { resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState, logGameAction, saveGames } = ctx;
  const cardName = entry.card;
  const playerPN = entry.playedBy;
  const gameId = game.gameId;
  const channel = entry.channelId ? await fetchGameChannel(client, entry.channelId) : null;

  // Paid in Beskar (HUNTER, when_defeated): the player chooses WHICH HUNTER
  // within 3 of the defeated hostile plays it / gains the 2 Block tokens
  // (alexanbv 2026-06-21 — every selection is a player pick). Offer only
  // eligible (within-range) HUNTERs; auto-resolve when exactly one.
  if (cardName === 'Paid in Beskar') {
    const dPos = entry.defeatedPos ?? null;
    const range = 3;
    const eligible = _friendlyKeywordFiguresWithin(game, playerPN, 'HUNTER', dPos, range);
    const _resolveWith = async (figureKey, displayName) => {
      if (typeof resolveAbility !== 'function') return;
      const result = resolveAbility(cardName, {
        game, playerNum: playerPN, cardName, chosenFigureKey: figureKey,
        defeatedPos: dPos, defeatedFigureKey: entry.defeatedFigureKey ?? null,
        dcMessageMeta, dcHealthState, dcExhaustedState, combat: game.pendingCombat,
      });
      await _drainDefeatCcDamage(game, ctx, result);
      if (result?.logMessage && typeof logGameAction === 'function' && client) {
        const note = result.applied
          ? `**${cardName}** — Played by **${displayName}**. ${result.logMessage}`
          : `**${cardName}** — ${result.manualMessage || result.logMessage}`;
        await logGameAction(game, client, note, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
    };
    if (eligible.length === 0) {
      if (typeof logGameAction === 'function' && client) {
        await logGameAction(game, client, `**${cardName}** — no friendly HUNTER within ${range} spaces of the defeated figure.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
      return;
    }
    if (eligible.length === 1) {
      await _resolveWith(eligible[0].figureKey, eligible[0].displayName);
      return;
    }
    if (channel) {
      const buttons = eligible.slice(0, 24).map((opt, i) =>
        new ButtonBuilder()
          .setCustomId(`defeat_cc_target_${gameId}_${i}`)
          .setLabel(String(opt.displayName).slice(0, 80))
          .setStyle(ButtonStyle.Primary),
      );
      setPendingDefeatCcPrompt(game, { gameId, playerPN, cardName, phase: 'target-pick', targetOptions: eligible, defeatedPos: dPos, defeatedFigureKey: entry.defeatedFigureKey ?? null });
      await channel.send({ content: `📜 **${cardName}** — Choose which **HUNTER** (within ${range}) gains the 2 Block Tokens:`, components: chunkButtonsToRows(buttons) }).catch(() => {});
      if (typeof saveGames === 'function') await saveGames(gameId);
      return;
    }
    // No channel — auto-resolve with the first eligible HUNTER.
    await _resolveWith(eligible[0].figureKey, eligible[0].displayName);
    return;
  }

  if (_NEEDS_TARGET_PICKER.has(cardName)) {
    const namedFigure = _CARD_UNIQUE_FIGURE[cardName];
    const keyword = _CARD_TARGET_KEYWORD[cardName] || null;
    const options = namedFigure
      ? _uniqueFigurePlayers(game, playerPN, namedFigure)
      : _friendlyDcOptions(game, playerPN, keyword);
    if (options.length === 0) {
      if (typeof logGameAction === 'function' && client) {
        const kwNote = keyword ? ` (no friendly ${keyword} on board)` : ' — no eligible playing figure on board.';
        await logGameAction(game, client, `**${cardName}** — no eligible target${kwNote}.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
      return;
    }
    // Unique-figure CC with only the named figure eligible (no Mara FL): auto-resolve.
    if (namedFigure && options.length === 1) {
      const opt = options[0];
      if (opt.viaFastLearner) {
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        game.roundFigureAbilityUsed[`${opt.dcName}_fast_learner`] = true;
      }
      if (typeof resolveAbility === 'function') {
        const result = resolveAbility(cardName, {
          game, playerNum: playerPN, cardName, msgId: opt.msgId, chosenFigureKey: opt.figureKey,
          dcMessageMeta, dcHealthState, dcExhaustedState, combat: game.pendingCombat,
        });
        await _drainDefeatCcDamage(game, ctx, result);
        if (result?.logMessage && typeof logGameAction === 'function' && client) {
          const note = result.applied
            ? `**${cardName}** — Played by **${opt.displayName}**. ${result.logMessage}`
            : `**${cardName}** — Played by **${opt.displayName}**. ${result.manualMessage || result.logMessage}`;
          await logGameAction(game, client, note, { phase: 'ROUND', icon: 'card' }).catch(() => {});
        }
      }
      return;
    }
    if (channel) {
      const buttons = options.slice(0, 5).map((opt, i) =>
        new ButtonBuilder()
          .setCustomId(`defeat_cc_target_${gameId}_${i}`)
          .setLabel(String(opt.displayName).slice(0, 80))
          .setStyle(ButtonStyle.Primary),
      );
      const row = new ActionRowBuilder().addComponents(buttons);
      setPendingDefeatCcPrompt(game, { gameId, playerPN, cardName, phase: 'target-pick', targetOptions: options });
      const targetVerb = keyword
        ? `Choose a friendly **${keyword}** to play the card`
        : namedFigure
          ? `Play with **${namedFigure}** or use **Mara Jade**'s Fast Learner`
          : 'Choose a friendly Deployment card to receive the effect';
      await channel.send({ content: `📜 **${cardName}** — ${targetVerb}:`, components: [row] }).catch(() => {});
      if (typeof saveGames === 'function') await saveGames(gameId);
      return;
    }
    // No channel to post the picker — fall through to a direct resolve.
  }

  if (typeof resolveAbility === 'function') {
    const result = resolveAbility(cardName, {
      game, playerNum: playerPN, cardName,
      dcMessageMeta, dcHealthState, dcExhaustedState, combat: game.pendingCombat,
      defeatedPos: entry.defeatedPos ?? null, defeatedFigureKey: entry.defeatedFigureKey ?? null,
    });
    await _drainDefeatCcDamage(game, ctx, result);
    if (result?.logMessage && typeof logGameAction === 'function' && client) {
      const note = result.applied
        ? `**${cardName}** — ${result.logMessage}`
        : `**${cardName}** — ${result.manualMessage || result.logMessage}`;
      await logGameAction(game, client, note, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
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
  // chosen DC's msgId. If the chosen option is via Fast Learner (Mara
  // picked instead of the named figure), mark FL used for the round.
  clearPendingDefeatCcPrompt(game);
  if (opt.viaFastLearner) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    game.roundFigureAbilityUsed[`${opt.dcName}_fast_learner`] = true;
  }
  if (typeof resolveAbility === 'function') {
    const result = resolveAbility(pending.cardName, {
      game,
      playerNum: pending.playerPN,
      cardName: pending.cardName,
      msgId: opt.msgId,
      chosenFigureKey: opt.figureKey,
      // Threaded for Paid in Beskar (within-3 HUNTER pick) so the resolver still
      // sees the defeated hostile position after the figure choice.
      defeatedPos: pending.defeatedPos ?? null,
      defeatedFigureKey: pending.defeatedFigureKey ?? null,
      dcMessageMeta,
      dcHealthState,
      dcExhaustedState,
      combat: game.pendingCombat,
    });
    await _drainDefeatCcDamage(game, ctx, result);
    if (result?.logMessage && typeof logGameAction === 'function' && client) {
      const flNote = opt.viaFastLearner ? ' (via Fast Learner)' : '';
      const note = result.applied
        ? `**${pending.cardName}** — Target **${opt.displayName}**${flNote}. ${result.logMessage}`
        : `**${pending.cardName}** — Target **${opt.displayName}**${flNote}. ${result.manualMessage || result.logMessage}`;
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
    await _drainDefeatCcDamage(game, ctx, result);
    if (result?.logMessage && typeof logGameAction === 'function' && client) {
      const note = result.applied
        ? `**${pending.cardName}** — Target **${pending.pickedDisplayName}**. ${result.logMessage}`
        : `**${pending.cardName}** — Target **${pending.pickedDisplayName}**. ${result.manualMessage || result.logMessage}`;
      await logGameAction(game, client, note, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
  if (typeof saveGames === 'function') await saveGames(gameId);
}
