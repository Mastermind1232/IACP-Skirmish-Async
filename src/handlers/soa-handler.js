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
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, dcMessageMeta } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'soa_fire_');
  // suffix = `${gameId}_${descId}_${choiceKey}` — gameId has no `_`, descId may
  // contain `:`; choiceKey is the trailing token after the LAST `_`.
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

  // --- Vigor ---
  if (desc.subPromptKey === 'vigor') {
    if (choiceKey === 'mp') {
      grantMovementBank(game, desc.sourceMsgId, 2);
      await interaction.message.edit({ content: `\u{2728} **Vigor** — **${displayName}** gained **2 MP**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{2728} **Vigor** — ${displayName} gained 2 MP.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'block') {
      // Block token via grantPowerTokens on the figure key (selected fig 0)
      const dgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const figKey = `${desc.extras?.dcName || meta?.dcName || ''}-${dgIdx}-0`;
      if (figKey && desc.extras?.dcName) grantPowerTokens(game, figKey, 'Block', 1);
      await interaction.message.edit({ content: `\u{2728} **Vigor** — **${displayName}** gained **1 Block Token**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{2728} **Vigor** — ${displayName} gained 1 Block Token.`, { phase: 'ROUND', icon: 'card' });
    } else {
      await interaction.followUp({ content: `Unknown Vigor choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
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
