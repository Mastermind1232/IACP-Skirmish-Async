/**
 * Async strain handler — opponent prompt + per-strain choice loop.
 *
 * Entry: applyStrain(game, ctx, opts) queues a strain event and posts
 * the first prompt. The full sequence:
 *
 *   1. (Optional UD pre-prompt)
 *      If the opponent has Under Duress attached and not yet depleted,
 *      post a "Deplete Under Duress?" prompt to the OPPONENT first.
 *      destruct 2026-05-06: this fires regardless of who caused the
 *      strain. Choices:
 *        - Deplete UD → flips chooser to opponent + costMultiplier = 2
 *        - Skip       → original controller chooses, costMultiplier = 1
 *
 *   2. Per-strain choice prompt
 *      The chooser sees buttons:
 *        - Take 1 Damage
 *        - Discard 1 (or 2 under UD) from top of deck
 *        - [if Paz Vizsla AND discard non-empty] Return CC from discard
 *      Each click resolves one strain unit via resolveSingleStrainChoice
 *      (deck shuffle / discard append / damageInflicted=1) then either
 *      re-prompts for the next strain or runs the followup.
 *
 *   3. Followup
 *      When the queue empties, run the registered followup descriptor
 *      (caller-supplied; e.g. "Trained reroll grant", "Bleed end-of-action
 *      complete"). The followup handler is looked up via
 *      ctx.strainFollowupHandlers[type].
 *
 * State on game: pendingStrainEvent.
 *   {
 *     eventId, figureKey, controllerPN, originalControllerPN,
 *     remaining, totalAmount, source,
 *     costMultiplier, udPrompted, udMsgId, udResolved,
 *     followup: { type, payload } | null,
 *   }
 */

import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { parseCustomId } from '../discord/custom-id.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { cardNameIncludes } from '../game/card-names.js';
import { getDcMessageIds, getDcAttachments, getCcHand, ccHandKey, ccDiscardKey, getPlayerId } from '../game/player-helpers.js';
import {
  STRAIN_OPTIONS,
  resolveSingleStrainChoice,
  pazReturnAvailable,
  findUnderDuressDepleters,
} from '../game/strain-resolver.js';

const STRAIN_DC_PAZ = 'Paz Vizsla';

/**
 * Public entry: queue a strain event and start the prompt cascade.
 *
 * @param {object} game
 * @param {object} ctx - { client, logGameAction, saveGames, dcHealthState,
 *                         findDcMessageIdForFigure, processFigureDefeat,
 *                         strainFollowupHandlers? }
 * @param {object} opts
 * @param {string} opts.figureKey
 * @param {number} opts.controllerPlayerNum
 * @param {number} opts.amount  (≥1)
 * @param {string} [opts.source='Strain']
 * @param {object|null} [opts.followup]  { type, payload }
 */
export async function applyStrain(game, ctx, opts) {
  let amount = Math.max(0, parseInt(opts.amount || 0, 10));
  if (amount === 0) {
    return _runStrainFollowup(game, ctx, opts.followup || null);
  }
  const figureKey = opts.figureKey;
  const controllerPN = opts.controllerPlayerNum;
  const source = opts.source || 'Strain';

  // ── Fireproof (Flame Trooper attachment): immune to Strain. Find the
  //    figure's msgId via dcMessageMeta and check attachments.
  const _fpMsgId = ctx.findDcMessageIdForFigure?.(game.gameId, controllerPN, figureKey);
  if (_fpMsgId) {
    const _fpAtts = (controllerPN === 1 ? game.p1DcAttachments : game.p2DcAttachments)?.[_fpMsgId] || [];
    if (cardNameIncludes(_fpAtts, 'Flame Trooper')) {
      const dcName = dcNameFromFigureKey(figureKey);
      await ctx.logGameAction?.(game, ctx.client, `**Fireproof** — **${dcName}** is immune to Strain from ${source}.`, { phase: 'ROUND', icon: 'card' });
      return _runStrainFollowup(game, ctx, opts.followup || null);
    }
  }

  // ── Headhunter (attachment): when a hostile figure suffers Strain during
  //    the Headhunter owner's activation, exhaust to reduce strain by 1
  //    and force the controller to discard a random CC from hand (or +1
  //    damage if hand is empty).
  const _hhOwnerPN = controllerPN === 1 ? 2 : 1;
  const _hhOwnerMsgIds = getDcMessageIds(game, _hhOwnerPN) || [];
  const _hhOwnerAtts = getDcAttachments(game, _hhOwnerPN) || {};
  const _hhInActivation = _hhOwnerMsgIds.some((mid) => game.dcActionsData?.[mid]?.threadId);
  let _hhExtraDamage = 0;
  if (_hhInActivation && amount > 0) {
    for (const _hhMid of _hhOwnerMsgIds) {
      const _hhAtts = _hhOwnerAtts[_hhMid] || [];
      const _hhExh = game.exhaustedSkirmishUpgrades?.[_hhMid] || [];
      if (_hhAtts.includes('Headhunter') && !_hhExh.includes('Headhunter')) {
        amount = Math.max(0, amount - 1);
        game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
        game.exhaustedSkirmishUpgrades[_hhMid] = [..._hhExh, 'Headhunter'];
        const _hhHandKey = ccHandKey(controllerPN);
        const _hhHand = game[_hhHandKey] || [];
        if (_hhHand.length > 0) {
          const _hhRand = Math.floor(Math.random() * _hhHand.length);
          const _hhDiscarded = _hhHand.splice(_hhRand, 1)[0];
          const _hhDiscardKey = ccDiscardKey(controllerPN);
          game[_hhDiscardKey] = (game[_hhDiscardKey] || []).concat(_hhDiscarded);
          await ctx.logGameAction?.(game, ctx.client, `**Headhunter** — Strain on **${dcNameFromFigureKey(figureKey)}** reduced by 1; controller discards **${_hhDiscarded}** from hand.`, { phase: 'ROUND', icon: 'card' });
        } else {
          _hhExtraDamage = 1;
          await ctx.logGameAction?.(game, ctx.client, `**Headhunter** — Strain on **${dcNameFromFigureKey(figureKey)}** reduced by 1; controller has no CCs in hand → suffers 1 Damage instead.`, { phase: 'ROUND', icon: 'card' });
        }
        break; // only one Headhunter per strain event
      }
    }
  }
  // Apply Headhunter's "no CCs → 1 damage" immediately (this is direct
  // damage, not strain — no choice prompt for it).
  if (_hhExtraDamage > 0) {
    await _applyDamageFromStrain(game, ctx, {
      figureKey, controllerPN, originalControllerPN: controllerPN, source: 'Headhunter',
    });
  }
  // If Headhunter fully neutralized the strain (was 1, now 0), no prompt.
  if (amount === 0) {
    return _runStrainFollowup(game, ctx, opts.followup || null);
  }

  const eventId = `strain_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const ev = {
    eventId,
    figureKey,
    originalControllerPN: controllerPN,
    controllerPN,
    remaining: amount,
    totalAmount: amount,
    source,
    costMultiplier: 1,
    udPrompted: false,
    udResolved: false,
    udMsgId: null,
    followup: opts.followup || null,
  };
  game.pendingStrainEvent = ev;

  // Step 1: UD pre-prompt (if any opponent has Under Duress).
  const udMsgIds = findUnderDuressDepleters(game, ev.originalControllerPN);
  if (udMsgIds.length > 0) {
    ev.udPrompted = true;
    ev.udMsgId = udMsgIds[0]; // first eligible UD attachment
    return _postUdPrompt(game, ctx, ev);
  }

  // No UD eligible — proceed directly to per-strain choice.
  ev.udResolved = true;
  return _postStrainChoicePrompt(game, ctx, ev);
}

async function _postUdPrompt(game, ctx, ev) {
  const oppPN = ev.originalControllerPN === 1 ? 2 : 1;
  const ownerId = game[`player${oppPN}Id`];
  const dcName = dcNameFromFigureKey(ev.figureKey);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`strain_resolve_ud_deplete_${game.gameId}_${ev.eventId}`)
      .setLabel('Deplete Under Duress (doubles cost; you choose)')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`strain_resolve_ud_skip_${game.gameId}_${ev.eventId}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary),
  );
  await ctx.logGameAction(
    game,
    ctx.client,
    `<@${ownerId}> ⚠️ **Strain on ${dcName}** (${ev.totalAmount} from ${ev.source}). You may **deplete Under Duress** to take over the choice for this event (cost doubles to 2 cards/strain).`,
    { components: [row], allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card' },
  );
  ctx.saveGames?.(game.gameId);
}

async function _postStrainChoicePrompt(game, ctx, ev) {
  if (ev.remaining <= 0) {
    return _completeStrainEvent(game, ctx, ev);
  }
  const ownerId = game[`player${ev.controllerPN}Id`];
  const dcName = dcNameFromFigureKey(ev.figureKey);
  const cost = ev.costMultiplier;
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`strain_resolve_damage_${game.gameId}_${ev.eventId}`)
      .setLabel('Take 1 Damage')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`strain_resolve_discard_${game.gameId}_${ev.eventId}`)
      .setLabel(cost > 1 ? `Discard ${cost} from top of deck` : 'Discard 1 from top of deck')
      .setStyle(ButtonStyle.Primary),
  ];
  if (pazReturnAvailable(game, ev.controllerPN, ev.figureKey)) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`strain_resolve_paz_${game.gameId}_${ev.eventId}`)
        .setLabel('Return CC from Discard → Game Box (Paz)')
        .setStyle(ButtonStyle.Success),
    );
  }
  const row = new ActionRowBuilder().addComponents(...buttons);
  const flipNote = ev.controllerPN !== ev.originalControllerPN ? ' (UD-controller choosing)' : '';
  await ctx.logGameAction(
    game,
    ctx.client,
    `<@${ownerId}> 🩸 **Strain on ${dcName}** — strain ${ev.totalAmount - ev.remaining + 1}/${ev.totalAmount} from ${ev.source}. Choose how to absorb${flipNote}.`,
    { components: [row], allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card' },
  );
  ctx.saveGames?.(game.gameId);
}

async function _completeStrainEvent(game, ctx, ev) {
  const followup = ev.followup;
  delete game.pendingStrainEvent;
  await _runStrainFollowup(game, ctx, followup);
  ctx.saveGames?.(game.gameId);
}

// ─── Followup registry ────────────────────────────────────────────────────
//
// Consumers that need to resume a flow after a strain event resolves
// register a named followup handler at module-load time. Handler
// signature: async (game, ctx, payload) => void.
//
// applyStrain's caller passes followup: { type, payload } and the
// dispatcher looks up the registered handler by `type` and invokes
// it once all strain units have resolved.

const _strainFollowupHandlers = new Map();

export function registerStrainFollowup(type, handler) {
  if (typeof type !== 'string' || !type) throw new Error('registerStrainFollowup: type must be a non-empty string');
  if (typeof handler !== 'function') throw new Error('registerStrainFollowup: handler must be a function');
  _strainFollowupHandlers.set(type, handler);
}

async function _runStrainFollowup(game, ctx, followup) {
  if (!followup) return;
  const handler = _strainFollowupHandlers.get(followup.type);
  if (typeof handler === 'function') {
    await handler(game, ctx, followup.payload || {});
  }
}

async function _applyDamageFromStrain(game, ctx, ev) {
  const { dcHealthState, findDcMessageIdForFigure, processFigureDefeat, client, logGameAction } = ctx;
  if (!dcHealthState || !findDcMessageIdForFigure) return;
  const msgId = findDcMessageIdForFigure(game.gameId, ev.controllerPN === ev.originalControllerPN ? ev.originalControllerPN : ev.originalControllerPN, ev.figureKey)
    || findDcMessageIdForFigure(game.gameId, ev.originalControllerPN, ev.figureKey);
  if (!msgId) return;
  const figMatch = ev.figureKey.match(/-(\d+)-(\d+)$/);
  const figureIndex = figMatch ? parseInt(figMatch[2], 10) : 0;
  const dcName = dcNameFromFigureKey(ev.figureKey);
  const healthState = dcHealthState.get(msgId) || [];
  const entry = healthState[figureIndex];
  if (!entry) return;
  const [cur, max] = entry;
  const newHp = Math.max(0, cur - 1);
  healthState[figureIndex] = [newHp, max];
  dcHealthState.set(msgId, healthState);
  await logGameAction(game, client, `🩸 **Strain → Damage** — **${dcName}**: HP ${cur} → ${newHp}.`, { phase: 'ROUND', icon: 'card' });
  if (newHp <= 0 && processFigureDefeat) {
    await processFigureDefeat(game, {
      defeatedPlayerNum: ev.originalControllerPN,
      figureKey: ev.figureKey,
      attackerPlayerNum: null,
      msgId,
      dcIdx: -1,
      dcName,
      displayName: dcName,
      source: `Strain (${ev.source})`,
    });
  }
}

// ─── Button handlers ───────────────────────────────────────────────────

export async function handleStrainUdDeplete(interaction, ctx) {
  const { getGame, canActAsPlayer, client, logGameAction, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'strain_resolve_ud_deplete_');
  const [gameId, eventId] = suffix.split('_').reduce((acc, part, idx, arr) => {
    if (idx === 0) return [part, arr.slice(1).join('_')];
    return acc;
  }, ['', '']);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game?.pendingStrainEvent || game.pendingStrainEvent.eventId !== eventId) {
    await interaction.followUp({ content: 'No pending strain event.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ev = game.pendingStrainEvent;
  const oppPN = ev.originalControllerPN === 1 ? 2 : 1;
  if (!await requirePlayer(interaction, game, interaction.user.id, oppPN, canActAsPlayer, 'Only the UD-controller may deplete.')) return;
  // Mark UD depleted.
  game.depletedSkirmishUpgrades = game.depletedSkirmishUpgrades || {};
  if (ev.udMsgId) {
    const cur = game.depletedSkirmishUpgrades[ev.udMsgId] || [];
    if (!cur.includes('Under Duress')) game.depletedSkirmishUpgrades[ev.udMsgId] = [...cur, 'Under Duress'];
  }
  ev.controllerPN = oppPN;
  ev.costMultiplier = 2;
  ev.udResolved = true;
  await logGameAction(game, client, `**Under Duress depleted** — opponent will choose strain absorption (cost: 2 cards/strain).`, { phase: 'ROUND', icon: 'card' });
  saveGames?.(game.gameId);
  return _postStrainChoicePrompt(game, ctx, ev);
}

export async function handleStrainUdSkip(interaction, ctx) {
  const { getGame, canActAsPlayer, client, logGameAction, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'strain_resolve_ud_skip_');
  const [gameId, eventId] = _splitEventId(suffix);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game?.pendingStrainEvent || game.pendingStrainEvent.eventId !== eventId) {
    await interaction.followUp({ content: 'No pending strain event.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ev = game.pendingStrainEvent;
  const oppPN = ev.originalControllerPN === 1 ? 2 : 1;
  if (!await requirePlayer(interaction, game, interaction.user.id, oppPN, canActAsPlayer, 'Only the UD-controller may respond.')) return;
  ev.udResolved = true;
  saveGames?.(game.gameId);
  return _postStrainChoicePrompt(game, ctx, ev);
}

async function _resolveStrainChoiceCommon(interaction, ctx, choiceOption, prefix) {
  const { getGame, canActAsPlayer, client, logGameAction, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, prefix);
  const [gameId, eventId] = _splitEventId(suffix);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game?.pendingStrainEvent || game.pendingStrainEvent.eventId !== eventId) {
    await interaction.followUp({ content: 'No pending strain event.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ev = game.pendingStrainEvent;
  if (!await requirePlayer(interaction, game, interaction.user.id, ev.controllerPN, canActAsPlayer, 'Only the strain chooser may respond.')) return;
  const result = resolveSingleStrainChoice(game, ev.controllerPN, choiceOption, { costMultiplier: ev.costMultiplier, figureKey: ev.figureKey });
  ev.remaining -= 1;
  if (result.deckDiscarded > 0) {
    await logGameAction(game, client, `**Strain absorbed** — discarded ${result.deckDiscarded} card${result.deckDiscarded === 1 ? '' : 's'} from top of deck.`, { phase: 'ROUND', icon: 'card' });
  }
  if (result.pazReturned > 0) {
    await logGameAction(game, client, `**Strain absorbed** — Paz Vizsla returns 1 CC from discard to the game box.`, { phase: 'ROUND', icon: 'card' });
  }
  if (result.fellThroughTo === STRAIN_OPTIONS.TAKE_DAMAGE) {
    await logGameAction(game, client, `**Strain fallthrough** — option unavailable, taking damage instead.`, { phase: 'ROUND', icon: 'card' });
  }
  if (result.damageInflicted > 0) {
    await _applyDamageFromStrain(game, ctx, ev);
  }
  saveGames?.(game.gameId);
  if (ev.remaining > 0) {
    return _postStrainChoicePrompt(game, ctx, ev);
  }
  return _completeStrainEvent(game, ctx, ev);
}

export async function handleStrainChoiceDamage(interaction, ctx) {
  return _resolveStrainChoiceCommon(interaction, ctx, STRAIN_OPTIONS.TAKE_DAMAGE, 'strain_resolve_damage_');
}

export async function handleStrainChoiceDiscard(interaction, ctx) {
  return _resolveStrainChoiceCommon(interaction, ctx, STRAIN_OPTIONS.DISCARD_DECK_TOP, 'strain_resolve_discard_');
}

export async function handleStrainChoicePaz(interaction, ctx) {
  return _resolveStrainChoiceCommon(interaction, ctx, STRAIN_OPTIONS.PAZ_RETURN_FROM_DISCARD, 'strain_resolve_paz_');
}

// Helpers

function _splitEventId(suffix) {
  // suffix shape: "<gameId>_<eventId>" but eventId can contain underscores
  // (e.g. "strain_<ts>_<rand>"). gameId is guaranteed numeric here, so the
  // first underscore is the boundary.
  const idx = suffix.indexOf('_');
  if (idx < 0) return [suffix, ''];
  return [suffix.slice(0, idx), suffix.slice(idx + 1)];
}
