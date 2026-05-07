/**
 * SoA orchestrator button handlers.
 *
 * Three customId prefixes:
 *   soa_pick_<gameId>_<descId>      — bucket-owner picks which trigger to fire next
 *   soa_fire_<gameId>_<descId>_<key>— resolve the sub-prompt for a specific trigger
 *   soa_skip_all_<gameId>           — discharge all remaining triggers in the current bucket
 *
 * Per destruct 2026-05-07: every SoA effect is a player-driven trigger. The
 * orchestrator walks buckets init-player first then non-init; within a
 * bucket the owner picks order. See src/game/soa-orchestrator.js for state
 * and helpers.
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { parseCustomId } from '../discord/custom-id.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { findDescriptorInCurrentBucket, consumeDescriptor, skipCurrentBucket, describeChooserPrompt } from '../game/soa-orchestrator.js';
import { grantMovementBank, grantPowerTokens } from '../game/game-helpers.js';
import { healHp } from '../game/damage-helpers.js';
import { ccDeckKey, ccHandKey } from '../game/player-helpers.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';

/**
 * Re-post the bucket's chooser prompt after a trigger fires (or none yet
 * fired). When the resolution is fully exhausted, post a "SoA resolved"
 * message instead so the activator knows they can proceed.
 */
async function postChooserOrComplete(game, gameId, ctx, channel) {
  const desc = describeChooserPrompt(game.pendingSoaResolution, gameId);
  if (!desc) {
    await channel.send({ content: '\u{2728} Start-of-Activation effects resolved.' }).catch(discordCatch);
    return;
  }
  const buttons = desc.choices.map((c) => {
    const style = c.descId === '__skip_all__' ? ButtonStyle.Secondary : ButtonStyle.Primary;
    return new ButtonBuilder().setCustomId(c.customId).setLabel(c.label).setStyle(style);
  });
  const row = new ActionRowBuilder().addComponents(buttons);
  await channel.send({
    content: `\u{2728} **Start-of-Activation** — Player ${desc.ownerPlayerNum}: choose which effect to resolve next, or skip all remaining.`,
    components: [row],
  }).catch(discordCatch);
}

/**
 * soa_pick_<gameId>_<descId>: bucket-owner picked which descriptor to fire.
 * Look up the descriptor and post its sub-prompt.
 */
export async function handleSoaPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, dcMessageMeta } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'soa_pick_');
  const _u = suffix.indexOf('_');
  if (_u < 0) { await interaction.followUp({ content: 'Invalid SoA pick.', ephemeral: true }).catch(discordCatch); return; }
  const gameId = suffix.slice(0, _u);
  const descId = suffix.slice(_u + 1);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const r = game.pendingSoaResolution;
  if (!r) { await interaction.followUp({ content: 'No SoA resolution pending.', ephemeral: true }).catch(discordCatch); return; }
  const bucket = r.buckets[r.currentBucketIdx];
  if (!await requirePlayer(interaction, game, interaction.user.id, bucket.ownerPlayerNum, canActAsPlayer, 'Only the bucket owner may pick.')) return;
  const desc = findDescriptorInCurrentBucket(game, descId);
  if (!desc) { await interaction.followUp({ content: 'That trigger is no longer pending.', ephemeral: true }).catch(discordCatch); return; }

  // Sub-prompt routing: each descriptor.subPromptKey has its own UI shape.
  const meta = dcMessageMeta?.get(desc.sourceMsgId);
  const displayName = meta?.displayName || desc.extras?.dcName || 'figure';
  if (desc.subPromptKey === 'vigor') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_mp`).setLabel('Gain 2 MP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_block`).setLabel('Gain 1 Block Token').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{2728} **Vigor** — **${displayName}**: Choose one:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'responsive') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_mp`).setLabel('Gain 1 MP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_heal`).setLabel('Recover 1 Damage').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F3C3} **Responsive** — **${displayName}**: Choose one:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'fulcrum') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_use`).setLabel('Use Fulcrum').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F575}\u{FE0F} **Fulcrum** — **${displayName}**: Each player may draw 1 Command card. Use Fulcrum?`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'hunger_elite') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_block`).setLabel('Block Token').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_evade`).setLabel('Evade Token').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F43B} **Hunger** — **${displayName}** gains **3 MP**. Choose a token:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'tac_move') {
    const candidates = desc.extras?.candidates || [];
    const buttons = candidates.slice(0, 4).map((fk) =>
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
    );
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const row = new ActionRowBuilder().addComponents(buttons);
    await interaction.message.channel.send({
      content: `\u{1F3AF} **Tactical Movement** — Choose a friendly figure within 3 spaces to gain **2 MP**:`,
      components: [row],
    }).catch(discordCatch);
  } else {
    await interaction.followUp({ content: `Unknown SoA sub-prompt: ${desc.subPromptKey}`, ephemeral: true }).catch(discordCatch);
  }
}

/**
 * soa_fire_<gameId>_<descId>_<choiceKey>: resolve a specific sub-prompt
 * choice for a descriptor. After firing, consume the descriptor and re-post
 * the chooser (or completion message).
 */
export async function handleSoaFire(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, dcMessageMeta, dcHealthState } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'soa_fire_');
  // suffix = `${gameId}_${descId}_${choiceKey}` — gameId has no `_`, descId may
  // contain `:`; choiceKey is the trailing token after the LAST `_`. For
  // tac_move the choiceKey is a figureKey which itself contains `-` but no
  // `_`, so the lastIndexOf('_') split is still correct.
  const _u = suffix.indexOf('_');
  if (_u < 0) { await interaction.followUp({ content: 'Invalid SoA fire.', ephemeral: true }).catch(discordCatch); return; }
  const gameId = suffix.slice(0, _u);
  const rest = suffix.slice(_u + 1);
  const _lastUnderscore = rest.lastIndexOf('_');
  if (_lastUnderscore < 0) { await interaction.followUp({ content: 'Invalid SoA fire (malformed id).', ephemeral: true }).catch(discordCatch); return; }
  const descId = rest.slice(0, _lastUnderscore);
  const choiceKey = rest.slice(_lastUnderscore + 1);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const r = game.pendingSoaResolution;
  if (!r) { await interaction.followUp({ content: 'No SoA resolution pending.', ephemeral: true }).catch(discordCatch); return; }
  const bucket = r.buckets[r.currentBucketIdx];
  if (!await requirePlayer(interaction, game, interaction.user.id, bucket.ownerPlayerNum, canActAsPlayer, 'Only the bucket owner may resolve.')) return;
  const desc = findDescriptorInCurrentBucket(game, descId);
  if (!desc) { await interaction.followUp({ content: 'That trigger is no longer pending.', ephemeral: true }).catch(discordCatch); return; }

  const meta = dcMessageMeta?.get(desc.sourceMsgId);
  const displayName = meta?.displayName || desc.extras?.dcName || 'figure';

  const ownerPlayerNum = bucket.ownerPlayerNum;
  const dgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const selfFigKey = `${desc.extras?.dcName || meta?.dcName || ''}-${dgIdx}-0`;

  // --- Vigor ---
  if (desc.subPromptKey === 'vigor') {
    if (choiceKey === 'mp') {
      grantMovementBank(game, desc.sourceMsgId, 2);
      await interaction.message.edit({ content: `\u{2728} **Vigor** — **${displayName}** gained **2 MP**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{2728} **Vigor** — ${displayName} gained 2 MP.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'block') {
      if (selfFigKey && desc.extras?.dcName) grantPowerTokens(game, selfFigKey, 'Block', 1);
      await interaction.message.edit({ content: `\u{2728} **Vigor** — **${displayName}** gained **1 Block Token**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{2728} **Vigor** — ${displayName} gained 1 Block Token.`, { phase: 'ROUND', icon: 'card' });
    } else {
      await interaction.followUp({ content: `Unknown Vigor choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Responsive ---
  } else if (desc.subPromptKey === 'responsive') {
    if (choiceKey === 'mp') {
      grantMovementBank(game, desc.sourceMsgId, 1);
      await interaction.message.edit({ content: `\u{1F3C3} **Responsive** — **${displayName}** gained **1 MP**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F3C3} **Responsive** — ${displayName} gained 1 MP.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'heal') {
      if (dcHealthState) healHp(dcHealthState, game, desc.sourceMsgId, 0, 1, ownerPlayerNum);
      await interaction.message.edit({ content: `\u{1F3C3} **Responsive** — **${displayName}** recovered **1 Damage**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F3C3} **Responsive** — ${displayName} recovered 1 Damage.`, { phase: 'ROUND', icon: 'card' });
    } else {
      await interaction.followUp({ content: `Unknown Responsive choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Fulcrum ---
  } else if (desc.subPromptKey === 'fulcrum') {
    if (choiceKey === 'use') {
      const parts = [];
      for (const pn of [1, 2]) {
        const deck = game[ccDeckKey(pn)] || [];
        if (deck.length > 0) {
          const card = deck.shift();
          game[ccHandKey(pn)] = [...(game[ccHandKey(pn)] || []), card];
          parts.push(`P${pn} drew 1 CC`);
        } else {
          parts.push(`P${pn} deck empty`);
        }
      }
      await interaction.message.edit({ content: `\u{1F575}\u{FE0F} **Fulcrum** — Each player draws 1 Command card. (${parts.join(', ')})`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F575}\u{FE0F} **Fulcrum** — both players drew 1 CC.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F575}\u{FE0F} **Fulcrum** — Declined.`, components: [] }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Unknown Fulcrum choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Hunger (Wampa Elite) ---
  } else if (desc.subPromptKey === 'hunger_elite') {
    grantMovementBank(game, desc.sourceMsgId, 3);
    const figKey = desc.extras?.figureKey || selfFigKey;
    if (choiceKey === 'block') {
      if (figKey) grantPowerTokens(game, figKey, 'Block', 1);
      await interaction.message.edit({ content: `\u{1F43B} **Hunger** — **${displayName}** gained 3 MP and **1 Block Token**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F43B} **Hunger** — ${displayName} gained 3 MP and 1 Block Token.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'evade') {
      if (figKey) grantPowerTokens(game, figKey, 'Evade', 1);
      await interaction.message.edit({ content: `\u{1F43B} **Hunger** — **${displayName}** gained 3 MP and **1 Evade Token**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F43B} **Hunger** — ${displayName} gained 3 MP and 1 Evade Token.`, { phase: 'ROUND', icon: 'card' });
    } else {
      await interaction.followUp({ content: `Unknown Hunger choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Tactical Movement (Fenn Signis) ---
  } else if (desc.subPromptKey === 'tac_move') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F3AF} **Tactical Movement** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      // choiceKey is a figureKey; locate its msgId and add 2 MP to that bank.
      const targetFk = choiceKey;
      const targetDcName = dcNameFromFigureKey(targetFk);
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
      if (targetMsgId) {
        grantMovementBank(game, targetMsgId, 2);
        await interaction.message.edit({ content: `\u{1F3AF} **Tactical Movement** — **${targetDcName}** gained **2 MP**.`, components: [] }).catch(discordCatch);
        if (logGameAction) await logGameAction(game, client, `\u{1F3AF} **Tactical Movement** — ${targetDcName} gained 2 MP.`, { phase: 'ROUND', icon: 'card' });
      } else {
        await interaction.message.edit({ content: `\u{1F3AF} **Tactical Movement** — could not locate **${targetDcName}**'s movement bank; resolve manually.`, components: [] }).catch(discordCatch);
      }
    }

  } else {
    await interaction.followUp({ content: `Unknown SoA descriptor key: ${desc.subPromptKey}`, ephemeral: true }).catch(discordCatch);
    return;
  }

  consumeDescriptor(game, desc.id);
  await postChooserOrComplete(game, gameId, ctx, interaction.message.channel);
  saveGames(game.gameId);
}

/**
 * soa_skip_all_<gameId>: discharge all remaining triggers in the current
 * bucket, advance to the next bucket (or finish).
 */
export async function handleSoaSkipAll(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = parseCustomId(interaction.customId, 'soa_skip_all_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const r = game.pendingSoaResolution;
  if (!r) { await interaction.followUp({ content: 'No SoA resolution pending.', ephemeral: true }).catch(discordCatch); return; }
  const bucket = r.buckets[r.currentBucketIdx];
  if (!await requirePlayer(interaction, game, interaction.user.id, bucket.ownerPlayerNum, canActAsPlayer, 'Only the bucket owner may skip.')) return;
  await interaction.message.edit({ content: '\u{2728} Skipped all remaining SoA triggers in this bucket.', components: [] }).catch(discordCatch);
  skipCurrentBucket(game);
  await postChooserOrComplete(game, gameId, ctx, interaction.message.channel);
  saveGames(game.gameId);
}
