/**
 * EoA orchestrator button handlers (mirror of soa-handler.js).
 *
 * Three customId prefixes:
 *   eoa_pick_<gameId>_<descId>      — bucket-owner picks which trigger to fire next
 *   eoa_fire_<gameId>_<descId>_<key>— resolve the sub-prompt for a specific trigger
 *   eoa_skip_all_<gameId>           — discharge all remaining triggers in the current bucket
 *
 * Per alexanbv 2026-05-11: window fires AFTER the activator clicks End
 * Activation, BEFORE the turn passes. Initial sub-prompt: Trust Goes
 * Both Ways EoA branch (Jyn Erso); more will be added per audit pass.
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { parseCustomId } from '../discord/custom-id.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { findDescriptorInCurrentBucket, consumeDescriptor, skipCurrentBucket, describeChooserPrompt } from '../game/eoa-orchestrator.js';
import { grantPowerTokens } from '../game/game-helpers.js';
import { healHp } from '../game/damage-helpers.js';
import { dcNameFromFigureKey, parseFigureKey } from '../game/dc-helpers.js';
import { countGameSpaces } from '../game/board-helpers.js';
import { applyCondition } from '../game/conditions.js';
import { opponentPlayerNum } from '../game/player-helpers.js';
import { getMapData, getFigureSize } from '../data-loader.js';
import { hasFigureLineOfSight, getFigureFootprint, getAllFigureFootprints } from '../game/spatial.js';
import { chunkButtonsToRows } from '../discord/components.js';

// EoA DC passive abilities resolved as a simple Apply/Skip (no sub-target).
const EOA_AUTO_APPLY_KEYS = new Set(['hold_the_line', 'shield', 'in_the_shadows', 'unnerving']);

/**
 * Re-post the bucket's chooser prompt after a trigger fires (or none yet
 * fired). When the resolution is fully exhausted, post a "EoA resolved"
 * message so the activator's End Activation flow can finalize.
 */
// The `onComplete` parameter this used to take was dead: nothing anywhere
// provided ctx.eoaResolvedCallback, so it was always undefined and the callback
// could never fire. Removed 2026-08-12 rather than registered as a ctx key with
// no producer — smoke:context flagged it the moment a new caller passed it.
async function postChooserOrComplete(game, gameId, ctx, channel) {
  const desc = describeChooserPrompt(game.pendingEoaResolution, gameId);
  if (!desc) {
    await channel.send({ content: '\u{1F3C1} End-of-Activation effects resolved. Activation ending.' }).catch(discordCatch);
    // The window is closed, so the deferred teardown can finally run. This is
    // the whole point of the EoA rework (alexanbv 2026-08-12): end-of-activation
    // effects resolve while the activation still exists, and only then is it
    // dismantled. handleDcEndActivation stopped short and left this behind.
    //
    // Dynamic import to keep handlers/activation.js off this module's static
    // graph. It is re-entrancy safe: the marker is deleted before the call, so
    // a second completion cannot run teardown twice.
    const resume = game.pendingEndActivationResume;
    if (resume) {
      delete game.pendingEndActivationResume;
      const meta = ctx.dcMessageMeta?.get?.(resume.msgId);
      if (meta) {
        const { finishDcEndActivation } = await import('./activation.js');
        await finishDcEndActivation(ctx, { game, meta, ...resume });
      } else {
        console.error(`[eoa] cannot finish end-activation: no dcMessageMeta for ${resume.msgId}`);
      }
    }
    return;
  }
  const buttons = desc.choices.map((c) => {
    const style = c.descId === '__skip_all__' ? ButtonStyle.Secondary : ButtonStyle.Primary;
    return new ButtonBuilder().setCustomId(c.customId).setLabel(c.label).setStyle(style);
  });
  const row = new ActionRowBuilder().addComponents(buttons);
  await channel.send({
    content: `\u{1F3C1} **End-of-Activation** — Player ${desc.ownerPlayerNum}: choose which effect to resolve next, or skip all remaining.`,
    components: [row],
  }).catch(discordCatch);
}

export async function handleEoaPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, dcMessageMeta } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'eoa_pick_');
  const _u = suffix.indexOf('_');
  if (_u < 0) { await interaction.followUp({ content: 'Invalid EoA pick.', ephemeral: true }).catch(discordCatch); return; }
  const gameId = suffix.slice(0, _u);
  const descId = suffix.slice(_u + 1);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const r = game.pendingEoaResolution;
  if (!r) { await interaction.followUp({ content: 'No EoA resolution pending.', ephemeral: true }).catch(discordCatch); return; }
  const bucket = r.buckets[r.currentBucketIdx];
  if (!await requirePlayer(interaction, game, interaction.user.id, bucket.ownerPlayerNum, canActAsPlayer, 'Only the bucket owner may pick.')) return;
  const desc = findDescriptorInCurrentBucket(game, descId);
  if (!desc) { await interaction.followUp({ content: 'That trigger is no longer pending.', ephemeral: true }).catch(discordCatch); return; }

  const meta = dcMessageMeta?.get(desc.sourceMsgId);
  const displayName = meta?.displayName || desc.extras?.dcName || 'figure';

  if (desc.subPromptKey === 'trust_both_ways_eoa') {
    const ownerPn = bucket.ownerPlayerNum;
    const selfFk = desc.extras?.selfFigureKey;
    const selfPos = game.figurePositions?.[ownerPn]?.[selfFk];
    const adj = selfPos ? Object.entries(game.figurePositions?.[ownerPn] || {})
      .filter(([fk, fp]) => fk !== selfFk && fp && countGameSpaces(game, selfPos, fp) <= 1)
      .map(([fk]) => fk) : [];
    if (adj.length === 0) {
      await interaction.followUp({ content: 'No adjacent friendly figures.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = adj.map((fk) =>
      new ButtonBuilder().setCustomId(`eoa_fire_${gameId}_${desc.id}_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary),
    );
    buttons.push(new ButtonBuilder().setCustomId(`eoa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    await interaction.message.channel.send({
      content: `\u{1F91D} **Trust Goes Both Ways (EoA)** — Pick an adjacent friendly figure. **${displayName}** and that figure each **Recover 1 Damage** and **gain 1 Surge Token**:`,
      components: chunkButtonsToRows(buttons),
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'diplomatic_mission') {
    // Post the same three-way bonus choice the ad-hoc prompt used, on the same
    // customId, so the existing handleOnDiplomatic resolves it unchanged. What
    // moves is WHEN it is offered: inside the host's end-of-activation window,
    // orderable against the companion activation and the Clan of Two placement,
    // instead of after teardown. alexanbv 2026-08-12.
    const _dmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`on_diplomatic_${gameId}_${desc.sourceMsgId}_mp`).setLabel('+2 MP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`on_diplomatic_${gameId}_${desc.sourceMsgId}_evade`).setLabel('+1 Evade (rest of round)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`on_diplomatic_${gameId}_${desc.sourceMsgId}_vp`).setLabel('+1 VP').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`on_diplomatic_${gameId}_${desc.sourceMsgId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F54A}\u{FE0F} **On a Diplomatic Mission** — **${displayName}** did not attack. Choose a bonus:`,
      components: [_dmRow],
    }).catch(discordCatch);
    consumeDescriptor(game, desc.id);
    await postChooserOrComplete(game, gameId, ctx, interaction.message.channel);
    if (saveGames) saveGames(game.gameId);
    return;
  } else if (desc.subPromptKey === 'companion_activate') {
    // Hand the activation lock to the companion so it can act INSIDE this
    // window (alexanbv 2026-08-12). The host keeps game.activationLockKey until
    // cleanupActivation, which since slice 1 runs after this window closes — so
    // without this hand-off the companion is locked out for the whole window and
    // "activate host, activate companion, then place" is unreachable.
    //
    // Consumed on pick, like the other descriptors here: the companion's
    // activation is a separate activation with its own End Activation, and
    // waiting on it would hold this window open indefinitely. The existing
    // paired-activation logic already stops the host finishing for real while
    // the companion is still live, so nothing is lost by closing the window.
    const _caCmpMsgId = desc.extras?.companionMsgId;
    if (_caCmpMsgId) {
      game.activationLockKey = `${_caCmpMsgId}_f0`;
      await interaction.message.channel.send({
        content: `\u{1F43E} **${desc.extras?.companionName || 'Companion'}** may act now — its activation resolves inside **${displayName}**'s end-of-activation window. Click its card to begin.`,
      }).catch(discordCatch);
    }
    consumeDescriptor(game, desc.id);
    await postChooserOrComplete(game, gameId, ctx, interaction.message.channel);
    if (saveGames) saveGames(game.gameId);
    return;
  } else if (desc.subPromptKey === 'clan_of_two_teleport') {
    // Post the destination buttons, then consume the descriptor immediately.
    //
    // The teleport itself is resolved by the existing handleClanOfTwoTeleport
    // handler on the clan_of_two_teleport_ customId, which knows nothing about
    // EoA bookkeeping. Waiting for it to report back would leave the window open
    // if the player never clicked a destination, and a window that never closes
    // strands the activation — the one failure mode this whole rework exists to
    // prevent. Consuming on pick cannot strand, and matches the previous
    // behaviour where the button row could simply be ignored.
    //
    // What the player gains is the ORDERING: choosing this from the chooser is
    // what decides whether the placement happens before or after the companion's
    // own activation (alexanbv 2026-08-12).
    const _cotHostPos = desc.extras?.hostPos;
    const _cotChildFk = desc.extras?.childFigureKey;
    const _cotMap = getMapData(game.selectedMap?.id);
    const _cotAdj = (_cotMap?.adjacency?.[String(_cotHostPos).toLowerCase()] || []).map((sp) => String(sp).toLowerCase());
    const _cotBtns = [String(_cotHostPos).toLowerCase(), ..._cotAdj].slice(0, 24).map((sp) =>
      new ButtonBuilder()
        .setCustomId(`clan_of_two_teleport_${gameId}_${desc.sourceMsgId}_${sp}`)
        .setLabel(`Place at ${sp.toUpperCase()}`)
        .setStyle(ButtonStyle.Primary),
    );
    if (_cotBtns.length) {
      await interaction.message.channel.send({
        content: `\u{1F4AB} **Clan of Two** — place **The Child** on **${displayName}**'s space or adjacent (currently ${String(game.figurePositions?.[bucket.ownerPlayerNum]?.[_cotChildFk] || '?').toUpperCase()}):`,
        components: chunkButtonsToRows(_cotBtns),
      }).catch(discordCatch);
    }
    consumeDescriptor(game, desc.id);
    await postChooserOrComplete(game, gameId, ctx, interaction.message.channel);
    if (saveGames) saveGames(game.gameId);
    return;
  } else if (desc.subPromptKey === 'eoa_cc_window') {
    // Placeholder descriptor that exists only to hold the activation open while
    // this player decides whether to play an end-of-activation Command Card.
    // Nothing resolves here: the card is played from hand through the normal
    // path, and Done closes the window.
    //
    // This exists for ORDERING, not because the effects need a live activation
    // — immediate spends work fine outside one (alexanbv 2026-08-12). It keeps
    // end-of-activation strictly ahead of the after-resolves window.
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`eoa_fire_${gameId}_${desc.id}_done`).setLabel('Done').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F3C1} **End of activation** — Player ${bucket.ownerPlayerNum}: play your end-of-activation Command Card from hand now if you want it. **${displayName}**'s activation is held open until you press Done.`,
      components: [row],
    }).catch(discordCatch);
  } else if (EOA_AUTO_APPLY_KEYS.has(desc.subPromptKey)) {
    // Auto-apply DC passive EoA abilities — single Apply/Skip prompt; the
    // effect resolves in handleEoaFire on 'apply'. Per alexanbv 2026-06-13.
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`eoa_fire_${gameId}_${desc.id}_apply`).setLabel('Apply').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`eoa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F3C1} **${desc.sourceLabel}** — **${displayName}**: resolve this end-of-activation effect?`,
      components: [row],
    }).catch(discordCatch);
  } else {
    await interaction.followUp({ content: `Unknown EoA sub-prompt: ${desc.subPromptKey}`, ephemeral: true }).catch(discordCatch);
  }
}

export async function handleEoaFire(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, dcMessageMeta, dcHealthState } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'eoa_fire_');
  const _u = suffix.indexOf('_');
  if (_u < 0) { await interaction.followUp({ content: 'Invalid EoA fire.', ephemeral: true }).catch(discordCatch); return; }
  const gameId = suffix.slice(0, _u);
  const rest = suffix.slice(_u + 1);
  const _lastUnderscore = rest.lastIndexOf('_');
  if (_lastUnderscore < 0) { await interaction.followUp({ content: 'Invalid EoA fire (malformed id).', ephemeral: true }).catch(discordCatch); return; }
  const descId = rest.slice(0, _lastUnderscore);
  const choiceKey = rest.slice(_lastUnderscore + 1);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const r = game.pendingEoaResolution;
  if (!r) { await interaction.followUp({ content: 'No EoA resolution pending.', ephemeral: true }).catch(discordCatch); return; }
  const bucket = r.buckets[r.currentBucketIdx];
  if (!await requirePlayer(interaction, game, interaction.user.id, bucket.ownerPlayerNum, canActAsPlayer, 'Only the bucket owner may resolve.')) return;
  const desc = findDescriptorInCurrentBucket(game, descId);
  if (!desc) { await interaction.followUp({ content: 'That trigger is no longer pending.', ephemeral: true }).catch(discordCatch); return; }

  const meta = dcMessageMeta?.get(desc.sourceMsgId);
  const displayName = meta?.displayName || desc.extras?.dcName || 'figure';
  const ownerPlayerNum = bucket.ownerPlayerNum;

  if (desc.subPromptKey === 'trust_both_ways_eoa') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F91D} **Trust Goes Both Ways (EoA)** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choiceKey;
      const targetDcName = dcNameFromFigureKey(targetFk);
      const { figureIndex: targetFigIdx } = parseFigureKey(targetFk);
      const selfFk = desc.extras?.selfFigureKey;
      let targetMsgId = null;
      if (dcMessageMeta) {
        for (const [mId, mMeta] of dcMessageMeta) {
          if (mMeta.gameId !== gameId) continue;
          if (mMeta.dcName === targetDcName && mMeta.playerNum === ownerPlayerNum) {
            targetMsgId = mId;
            break;
          }
        }
      }
      let selfHeal = { healed: 0 };
      let targetHeal = { healed: 0 };
      if (dcHealthState) {
        selfHeal = healHp(dcHealthState, game, desc.sourceMsgId, 0, 1, ownerPlayerNum);
        if (targetMsgId) targetHeal = healHp(dcHealthState, game, targetMsgId, targetFigIdx, 1, ownerPlayerNum);
      }
      if (selfFk) grantPowerTokens(game, selfFk, 'Surge', 1);
      grantPowerTokens(game, targetFk, 'Surge', 1);
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`trustBothWays_${desc.sourceMsgId}`] = true;
      const parts = [];
      if (selfHeal.healed > 0) parts.push(`**${displayName}** recovered 1 Damage`);
      if (targetHeal.healed > 0) parts.push(`**${targetDcName}** recovered 1 Damage`);
      parts.push(`both gained **1 Surge Token**`);
      await interaction.message.edit({ content: `\u{1F91D} **Trust Goes Both Ways (EoA)** — ${parts.join('; ')}.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F91D} **Trust Goes Both Ways (EoA)** — ${displayName} + ${targetDcName} recover 1 Damage, gain 1 Surge Token.`, { phase: 'ROUND', icon: 'card' });
    }
  } else if (desc.subPromptKey === 'eoa_cc_window') {
    // Done: the player has finished with their end-of-activation cards.
    // consumeDescriptor below closes their bucket and, once both are closed,
    // releases the deferred teardown.
    await interaction.message.edit({
      content: '\u{1F3C1} **End of activation** — done.',
      components: [],
    }).catch(discordCatch);
  } else if (EOA_AUTO_APPLY_KEYS.has(desc.subPromptKey)) {
    const selfFk = desc.extras?.selfFigureKey;
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F3C1} **${desc.sourceLabel}** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      let summary = '';
      if (desc.subPromptKey === 'in_the_shadows') {
        // ISB Infiltrator: the activating figure becomes Hidden (per-figure
        // EoA — fires at this figure's own activation end).
        if (selfFk) applyCondition(game, selfFk, 'Hide');
        summary = `**${displayName}** becomes **Hidden**`;
      } else if (desc.subPromptKey === 'shield') {
        // Riot Trooper: if the figure has no Block Tokens, gain 1.
        const tokens = game.figurePowerTokens?.[selfFk] || [];
        if (!tokens.includes('Block')) { grantPowerTokens(game, selfFk, 'Block', 1); summary = `**${displayName}** gains **1 Block Token**`; }
        else summary = `**${displayName}** already has a Block Token — no gain`;
      } else if (desc.subPromptKey === 'hold_the_line') {
        // Baze Malbus: gain 1 Block Token per hostile figure with LOS.
        const ms = getMapData(game.selectedMap?.id);
        const selfPos = game.figurePositions?.[ownerPlayerNum]?.[selfFk];
        let n = 0;
        if (selfPos && ms) {
          const enemyNum = opponentPlayerNum(ownerPlayerNum);
          const allFp = getAllFigureFootprints(game, getFigureSize);
          const selfFp = getFigureFootprint(game, ownerPlayerNum, selfFk, getFigureSize);
          for (const [eFk] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
            const eFp = getFigureFootprint(game, enemyNum, eFk, getFigureSize);
            if (eFp.length && hasFigureLineOfSight(selfFp, eFp, ms, allFp)) n++;
          }
        }
        if (n > 0) grantPowerTokens(game, selfFk, 'Block', n);
        summary = `**${displayName}** gains **${n} Block Token${n !== 1 ? 's' : ''}** (${n} hostile${n !== 1 ? 's' : ''} with LOS)`;
      } else if (desc.subPromptKey === 'unnerving') {
        // 0-0-0: each adjacent hostile figure becomes Weakened.
        const enemyNum = opponentPlayerNum(ownerPlayerNum);
        const selfPos = game.figurePositions?.[ownerPlayerNum]?.[selfFk];
        const hit = [];
        if (selfPos) {
          for (const [eFk, ePos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
            if (ePos && countGameSpaces(game, selfPos, ePos) <= 1) { applyCondition(game, eFk, 'Weaken'); hit.push(dcNameFromFigureKey(eFk)); }
          }
        }
        summary = hit.length ? `Weakened: ${hit.join(', ')}` : 'no adjacent hostiles';
      }
      await interaction.message.edit({ content: `\u{1F3C1} **${desc.sourceLabel}** — ${summary}.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F3C1} **${desc.sourceLabel}** — ${summary}.`, { phase: 'ROUND', icon: 'card' });
    }
  } else {
    await interaction.followUp({ content: `Unknown EoA descriptor key: ${desc.subPromptKey}`, ephemeral: true }).catch(discordCatch);
    return;
  }

  consumeDescriptor(game, desc.id);
  await postChooserOrComplete(game, gameId, ctx, interaction.message.channel);
  saveGames(game.gameId);
}

export async function handleEoaSkipAll(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = parseCustomId(interaction.customId, 'eoa_skip_all_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const r = game.pendingEoaResolution;
  if (!r) { await interaction.followUp({ content: 'No EoA resolution pending.', ephemeral: true }).catch(discordCatch); return; }
  const bucket = r.buckets[r.currentBucketIdx];
  if (!await requirePlayer(interaction, game, interaction.user.id, bucket.ownerPlayerNum, canActAsPlayer, 'Only the bucket owner may skip.')) return;
  skipCurrentBucket(game);
  await postChooserOrComplete(game, gameId, ctx, interaction.message.channel);
  if (saveGames) saveGames(game.gameId);
}
