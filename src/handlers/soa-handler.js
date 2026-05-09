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
import { healHp, reduceHp } from '../game/damage-helpers.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { ccDeckKey, ccHandKey, opponentPlayerNum, getCcHand, getDcList } from '../game/player-helpers.js';
import { dcNameFromFigureKey, parseFigureKey } from '../game/dc-helpers.js';
import { applyCondition } from '../game/conditions.js';
import { getDcEffects, getDcStats, getMapData, getFigureSize } from '../data-loader.js';
import { hasFigureLineOfSight, getFigureFootprint, getAllFigureFootprints } from '../game/spatial.js';
import { updateDcCardMessage } from '../engine/message-updaters.js';
import { getDcMessageIds } from '../game/player-helpers.js';

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
  } else if (desc.subPromptKey === 'mounted') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_apply`).setLabel('Apply (Gain 3 MP)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F40E} **Mounted** — **${displayName}** may gain **3 MP** at start of activation:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'hunger_regular') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_apply`).setLabel('Apply (Gain 2 MP)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F43B} **Hunger** — **${displayName}** may gain **2 MP** (no hostile within 3 spaces):`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'fotk') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_apply`).setLabel('Apply (Gain 2 MP)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F3AF} **Focused on the Kill** — **${displayName}** may gain **2 MP**:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'comms_jammer') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_apply`).setLabel('Apply (Lock opponent CCs)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F4F6} **Comms Jammer** — **${displayName}** may prevent opponent from playing Command Cards during this activation:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'madness') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_apply`).setLabel('Apply (Strain + Focus, if hand ≤ 2)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F4A2} **Madness** — **${displayName}**: if you have ≤2 Command Cards in hand at fire time, suffer **1 Strain** and become **Focused**:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'into_the_fray') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_apply`).setLabel('Apply (+1 MP, +Surge per LOS)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F525} **Into the Fray** — **${displayName}**: gain **1 MP** and **1 Surge Token** per hostile figure with LOS:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'beast_tamer') {
    const buttons = [
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_mp`).setLabel('Exhaust → gain Speed MP').setStyle(ButtonStyle.Primary),
    ];
    if (desc.extras?.isNonSentient) {
      buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_override`).setLabel('Exhaust → Interact Override').setStyle(ButtonStyle.Primary));
    }
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const row = new ActionRowBuilder().addComponents(buttons);
    await interaction.message.channel.send({
      content: `\u{1F436} **Beast Tamer** — **${displayName}**: exhaust the upgrade for one effect:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'hair_trigger') {
    const targetName = dcNameFromFigureKey(desc.extras?.targetFigureKey || '');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_apply`).setLabel(`Apply (Free attack vs ${targetName})`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F52B} **Hair Trigger** — **Jyn Odan** may interrupt to perform a free attack against **${targetName}**:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'companion_order') {
    const cmpName = desc.extras?.companionName || 'companion';
    const hostName = desc.extras?.dcName || displayName;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_first`).setLabel(`${cmpName} first`).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_second`).setLabel(`${hostName} first`).setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.channel.send({
      content: `\u{1F43E} **Companion order** — Does **${cmpName}** activate FIRST (full activation, then ${hostName}) or SECOND (after ${hostName} completes)?`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'awr') {
    // Flat (figure × type) sub-prompt — one button per pair so the
    // entire choice fits in one click. choiceKey format:
    // `${figureKey}|damage` or `${figureKey}|surge`. Skip button trails.
    const ownerPn = bucket.ownerPlayerNum;
    const selfFk = desc.extras?.selfFigureKey;
    const range = desc.extras?.range || 2;
    const { enumerateAwrTargets } = await import('../game/awr-helpers.js');
    const targets = enumerateAwrTargets(game, ownerPn, selfFk, range).map(([fk]) => fk);
    if (targets.length === 0) {
      await interaction.followUp({ content: 'No eligible friendlies in range.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = [];
    for (const fk of targets) {
      const name = dcNameFromFigureKey(fk);
      buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}|damage`).setLabel(`${name}: Damage`).setStyle(ButtonStyle.Danger));
      buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}|surge`).setLabel(`${name}: Surge`).setStyle(ButtonStyle.Primary));
    }
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    await interaction.message.channel.send({
      content: `\u{1F52C} **Advanced Weapons Research** — Pick a friendly within ${range} spaces and a token type:`,
      components: rows,
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'unshakable') {
    // Sub-prompt: one button per (figure × HARMFUL condition) pair so
    // the player picks which condition to discard explicitly. Per
    // destruct 2026-05-07: "player should choose which condition to
    // discard". choiceKey format: `${fk}|${condition}` (pipe-separated;
    // figureKeys don't contain `|`).
    const ownerPn = bucket.ownerPlayerNum;
    const _usAllFigPos = game.figurePositions?.[ownerPn] || {};
    const dcEff = getDcEffects() || {};
    const _usPairs = [];
    for (const [fk, fp] of Object.entries(_usAllFigPos)) {
      if (!fp) continue;
      const fkDcName = dcNameFromFigureKey(fk);
      const fkCost = dcEff[fkDcName]?.cost ?? 0;
      if (fkCost < 9) continue;
      const conds = game.figureConditions?.[fk] || [];
      for (const c of conds) {
        if (!['Stun', 'Bleed', 'Weaken'].includes(c)) continue;
        if (c === 'Weaken' && game.disarmPermanentWeakened?.[fk]) continue;
        _usPairs.push({ fk, condition: c });
      }
    }
    if (_usPairs.length === 0) {
      await interaction.followUp({ content: 'No eligible figures with HARMFUL conditions.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = _usPairs.map(({ fk, condition }) =>
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}|${condition}`).setLabel(`${dcNameFromFigureKey(fk)}: ${condition}`.slice(0, 80)).setStyle(ButtonStyle.Primary)
    );
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    await interaction.message.channel.send({
      content: `\u{1F6E1}\u{FE0F} **Unshakable** — Choose a (figure, condition) pair to discard (figure suffers 1 Strain):`,
      components: rows,
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'voracious') {
    // Sub-prompt: list eligible friendly non-companion figures within 2
    // spaces of Rancor as sacrifice targets. Recomputed at fire time so
    // positions/membership are fresh.
    const rPn = desc.extras?.rancorPlayerNum;
    const rFk = desc.extras?.rancorFigureKey;
    const rPos = game.figurePositions?.[rPn]?.[rFk];
    const _vrEligible = [];
    if (rPn && rPos) {
      const friendlyPos = game.figurePositions?.[rPn] || {};
      const { countGameSpaces } = await import('../game/board-helpers.js');
      for (const [fk, fp] of Object.entries(friendlyPos)) {
        if (!fp || fk === rFk) continue;
        if (countGameSpaces(game, rPos, fp) > 2) continue;
        _vrEligible.push(fk);
      }
    }
    if (_vrEligible.length === 0) {
      await interaction.followUp({ content: 'No eligible sacrifice targets within 2 spaces.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = _vrEligible.map((fk) =>
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}`).setLabel(`Sacrifice ${dcNameFromFigureKey(fk)}`).setStyle(ButtonStyle.Danger)
    );
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    await interaction.message.channel.send({
      content: `\u{1F432} **Voracious** — **Rancor** may defeat a friendly non-companion figure within 2 spaces to recover **2 Damage** and ready his card. Choose a target:`,
      components: rows,
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'imrn') {
    // Recompute eligible HUNTERs at fire time (positions/membership may
    // have shifted between enumerate and pick). Sub-prompt lists every
    // friendly HUNTER within 4 of Cad Bane — including Cad Bane himself.
    const cadPn = desc.extras?.cadPlayerNum;
    const cadFk = desc.extras?.cadFigureKey;
    const cadPos = game.figurePositions?.[cadPn]?.[cadFk];
    const _imrnEligible = [];
    if (cadPn && cadPos) {
      const friendlyPos = game.figurePositions?.[cadPn] || {};
      const dcEff = getDcEffects() || {};
      for (const [fk, fp] of Object.entries(friendlyPos)) {
        if (!fp) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = dcEff[fkDcName];
        const fkKws = (fkEff?.keywords || []).map((k) => String(k).toUpperCase());
        if (!fkKws.includes('HUNTER')) continue;
        const { countGameSpaces } = await import('../game/board-helpers.js');
        if (countGameSpaces(game, cadPos, fp) > 4) continue;
        _imrnEligible.push(fk);
      }
    }
    if (_imrnEligible.length === 0) {
      await interaction.followUp({ content: 'No eligible HUNTERs within 4 spaces of Cad Bane.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = _imrnEligible.map((fk) =>
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
    );
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    await interaction.message.channel.send({
      content: `\u{1F3AF} **I Make the Rules Now** — **Cad Bane**: choose a friendly HUNTER within 4 to gain **1 MP** (must be used immediately if not the activator):`,
      components: rows,
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'calming_presence') {
    // Recompute pairs at fire time so positions/conditions are fresh.
    const ownerPn = bucket.ownerPlayerNum;
    const actDcName = desc.extras?.dcName;
    const actEff = getDcEffects()?.[actDcName];
    const meta2 = dcMessageMeta?.get(desc.sourceMsgId);
    const dgIdx2 = (meta2?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const figures = actEff?.figures ?? 1;
    const pairs = [];
    for (let fi = 0; fi < figures; fi++) {
      const fk = `${actDcName}-${dgIdx2}-${fi}`;
      const conds = game.figureConditions?.[fk] || [];
      for (const c of conds) {
        if (!['Stun', 'Bleed', 'Weaken'].includes(c)) continue;
        if (c === 'Weaken' && game.disarmPermanentWeakened?.[fk]) continue;
        pairs.push({ fk, condition: c });
      }
    }
    const seen = new Set();
    const unique = pairs.filter((p) => {
      const k = `${p.fk}|${p.condition}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (unique.length === 0) {
      await interaction.followUp({ content: 'No harmful conditions on activator figures.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = unique.slice(0, 4).map(({ fk, condition }) => {
      const label = (figures > 1) ? `${dcNameFromFigureKey(fk)}: ${condition}` : condition;
      return new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}|${condition}`).setLabel(label.slice(0, 80)).setStyle(ButtonStyle.Primary);
    });
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const cpRow = new ActionRowBuilder().addComponents(buttons);
    await interaction.message.channel.send({
      content: `\u{1F9D8} **Calming Presence** (Yoda) — **${displayName}** is a REBEL figure. Remove 1 HARMFUL condition (the activating figure suffers 1 Strain):`,
      components: [cpRow],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'long_laid_plans') {
    // Multi-step: handleSoaPick posts the FIRST figure×type prompt;
    // handleSoaFire grants 1 token and re-prompts with reduced types
    // until remainingCount === 0 or no types left.
    const candidates = desc.extras?.candidates || [];
    const used = desc.extras?.usedTypes || [];
    const remainingTypes = ['damage', 'block', 'surge', 'evade'].filter((t) => !used.includes(t));
    if (candidates.length === 0 || remainingTypes.length === 0) {
      await interaction.followUp({ content: 'No eligible friendlies or token types remaining.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = [];
    for (const fk of candidates) {
      const name = dcNameFromFigureKey(fk);
      for (const t of remainingTypes) {
        buttons.push(new ButtonBuilder()
          .setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}|${t}`)
          .setLabel(`${name}: ${t.charAt(0).toUpperCase() + t.slice(1)}`)
          .setStyle(t === 'damage' ? ButtonStyle.Danger : ButtonStyle.Primary));
      }
    }
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip remaining').setStyle(ButtonStyle.Secondary));
    const llpRows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      llpRows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    await interaction.message.channel.send({
      content: `\u{1F9E0} **Long-Laid Plans** — **${displayName}** distributes **${desc.extras?.remainingCount ?? 1}** Power Tokens (each a different type) among friendlies within 3:`,
      components: llpRows.slice(0, 5),
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'arms_distribution') {
    // Flat (figure × type) sub-prompt. choiceKey: `${figureKey}|damage`
    // or `${figureKey}|block`. Skip button trails.
    const candidates = desc.extras?.candidates || [];
    if (candidates.length === 0) {
      await interaction.followUp({ content: 'No eligible friendlies within 3 spaces.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = [];
    for (const fk of candidates) {
      const name = dcNameFromFigureKey(fk);
      buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}|damage`).setLabel(`${name}: Damage`).setStyle(ButtonStyle.Danger));
      buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}|block`).setLabel(`${name}: Block`).setStyle(ButtonStyle.Primary));
    }
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const adRows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      adRows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    await interaction.message.channel.send({
      content: `\u{1F3AF} **Arms Distribution** — **${displayName}** picks a friendly figure within 3 to gain **1 Power Token** (Damage or Block):`,
      components: adRows.slice(0, 5),
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'force_vision') {
    // Owner is the opponent (Kanan's enemy). List the opponent's
    // currently-ready groups (recomputed at fire time). Choosing one
    // sets game.forceVisionNextActivation so the chosen group must be
    // activated next.
    const ownerPn = bucket.ownerPlayerNum;
    const _fvDcList = getDcList(game, ownerPn) || [];
    const { getActivatedDcIndices } = await import('../game/player-helpers.js');
    const _fvActivated = getActivatedDcIndices(game, ownerPn) || [];
    const _fvReady = [];
    for (let i = 0; i < _fvDcList.length; i++) {
      if (_fvActivated.includes(i)) continue;
      const dc = _fvDcList[i];
      if (!dc?.dcName) continue;
      const figs = game.figurePositions?.[ownerPn] || {};
      const alive = Object.entries(figs).some(([fk, pos]) => fk.startsWith(dc.dcName + '-') && pos);
      if (!alive) continue;
      _fvReady.push({ index: i, dcName: dc.dcName, displayName: dc.displayName || dc.dcName });
    }
    if (_fvReady.length === 0) {
      await interaction.followUp({ content: 'No ready groups to choose.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = _fvReady.slice(0, 20).map((rg) =>
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${rg.index}`).setLabel(String(rg.displayName).slice(0, 80)).setStyle(ButtonStyle.Primary)
    );
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    await interaction.message.channel.send({
      content: `\u{1F441}\u{FE0F} **Force Vision** — Choose one of your ready groups; you **must** activate it next, if possible:`,
      components: rows.slice(0, 5),
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'wisdom') {
    // handleSoaPick draws 1 CC into Yoda's hand, then posts a picker for
    // which card to return to the bottom of the deck. handleSoaFire
    // receives the chosen card index and completes the swap.
    const ownerPn = bucket.ownerPlayerNum;
    const _wDeckKey = ccDeckKey(ownerPn);
    const _wHandKey = ccHandKey(ownerPn);
    const _wDeck = game[_wDeckKey] || [];
    if (_wDeck.length === 0) {
      await interaction.followUp({ content: 'Command deck is empty; cannot draw.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const _wDrawn = _wDeck.shift();
    game[_wDeckKey] = _wDeck;
    game[_wHandKey] = [...(game[_wHandKey] || []), _wDrawn];
    const _wHand = game[_wHandKey] || [];
    const _wUnique = [...new Set(_wHand)];
    const _wButtons = _wUnique.map((c, ci) =>
      new ButtonBuilder()
        .setCustomId(`soa_fire_${gameId}_${desc.id}_${ci}`)
        .setLabel(c.length > 70 ? c.slice(0, 67) + '...' : c)
        .setStyle(ButtonStyle.Secondary)
    );
    const _wRows = [];
    for (let i = 0; i < _wButtons.length; i += 5) {
      _wRows.push(new ActionRowBuilder().addComponents(_wButtons.slice(i, i + 5)));
    }
    await interaction.message.channel.send({
      content: `\u{1F9D8} **Wisdom** — Drew **${_wDrawn}**. Choose a card from your hand to return to the **bottom** of your deck:`,
      components: _wRows.slice(0, 5),
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'trust_both_ways') {
    const ownerPn = bucket.ownerPlayerNum;
    const selfFk = desc.extras?.selfFigureKey;
    const selfPos = game.figurePositions?.[ownerPn]?.[selfFk];
    const { countGameSpaces } = await import('../game/board-helpers.js');
    const _tgbwAdj = selfPos ? Object.entries(game.figurePositions?.[ownerPn] || {})
      .filter(([fk, fp]) => fk !== selfFk && fp && countGameSpaces(game, selfPos, fp) <= 1)
      .map(([fk]) => fk) : [];
    if (_tgbwAdj.length === 0) {
      await interaction.followUp({ content: 'No adjacent friendly figures.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = _tgbwAdj.slice(0, 4).map((fk) =>
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
    );
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const row = new ActionRowBuilder().addComponents(buttons);
    await interaction.message.channel.send({
      content: `\u{1F91D} **Trust Goes Both Ways** — Pick an adjacent friendly figure. **${displayName}** and that figure each **Recover 1 Damage** and **gain 1 Surge Token**:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'imperial_citadel') {
    const _icTokens = game.imperialCitadelTokens || {};
    const _icAvailable = Object.entries(_icTokens).filter(([, count]) => count > 0);
    if (_icAvailable.length === 0) {
      await interaction.followUp({ content: 'No tokens available at the Imperial Citadel.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const buttons = _icAvailable.slice(0, 4).map(([type, count]) =>
      new ButtonBuilder()
        .setCustomId(`soa_fire_${gameId}_${desc.id}_${type}`)
        .setLabel(`${type.charAt(0).toUpperCase() + type.slice(1)} (${count})`)
        .setStyle(ButtonStyle.Primary)
    );
    buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const row = new ActionRowBuilder().addComponents(buttons);
    await interaction.message.channel.send({
      content: `\u{1F3F0} **Imperial Citadel** — **${displayName}** may gain 1 Power Token from the Citadel:`,
      components: [row],
    }).catch(discordCatch);
  } else if (desc.subPromptKey === 'tac_move') {
    // destruct 2026-05-07: show ALL eligible figures (no cap). Discord
    // ActionRow caps at 5 buttons; chunk into multiple rows. Reserve the
    // last slot of the final row for the Skip button.
    const candidates = desc.extras?.candidates || [];
    const allButtons = candidates.map((fk) =>
      new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
    );
    allButtons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const rows = [];
    for (let i = 0; i < allButtons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(allButtons.slice(i, i + 5)));
    }
    await interaction.message.channel.send({
      content: `\u{1F3AF} **Tactical Movement** — Choose a friendly figure within 3 spaces to gain **2 MP** (must be used immediately if not Fenn himself):`,
      components: rows,
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

  // --- Mounted (Captain Terro / Kuiil / Dewback) ---
  } else if (desc.subPromptKey === 'mounted') {
    if (choiceKey === 'apply') {
      grantMovementBank(game, desc.sourceMsgId, 3);
      await interaction.message.edit({ content: `\u{1F40E} **Mounted** — **${displayName}** gained **3 MP**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F40E} **Mounted** — ${displayName} gained 3 MP.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F40E} **Mounted** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Unknown Mounted choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Hunger Regular (Wampa) ---
  } else if (desc.subPromptKey === 'hunger_regular') {
    if (choiceKey === 'apply') {
      grantMovementBank(game, desc.sourceMsgId, 2);
      await interaction.message.edit({ content: `\u{1F43B} **Hunger** — **${displayName}** gained **2 MP**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F43B} **Hunger** — ${displayName} gained 2 MP.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F43B} **Hunger** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Unknown Hunger choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Focused on the Kill (Skirmish Upgrade) ---
  } else if (desc.subPromptKey === 'fotk') {
    if (choiceKey === 'apply') {
      grantMovementBank(game, desc.sourceMsgId, 2);
      await interaction.message.edit({ content: `\u{1F3AF} **Focused on the Kill** — **${displayName}** gained **2 MP**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F3AF} **Focused on the Kill** — ${displayName} gained 2 MP.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F3AF} **Focused on the Kill** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Unknown FotK choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Comms Jammer (ISB Infiltrator Elite) ---
  } else if (desc.subPromptKey === 'comms_jammer') {
    if (choiceKey === 'apply') {
      game.commsJammerActivePlayerNum = ownerPlayerNum;
      const oppNum = opponentPlayerNum(ownerPlayerNum);
      await interaction.message.edit({ content: `\u{1F4F6} **Comms Jammer** — Opponent (P${oppNum}) cannot play Command Cards during this activation.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F4F6} **Comms Jammer** — opponent CCs locked.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F4F6} **Comms Jammer** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Unknown Comms Jammer choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Madness (Taron Malicos) ---
  // Hand count is re-checked at fire time per destruct 2026-05-07 (the
  // player can play another SoR CC first to change the count).
  } else if (desc.subPromptKey === 'madness') {
    if (choiceKey === 'apply') {
      const hand = getCcHand(game, ownerPlayerNum) || [];
      if (hand.length <= 2) {
        const figureKeys = Object.keys(game.figurePositions?.[ownerPlayerNum] || {}).filter(fk => fk.startsWith('Taron Malicos-'));
        for (const fk of figureKeys) {
          applyCondition(game, fk, 'Focus');
          if (dcHealthState) {
            const fkIdx = parseFigureKey(fk).figureIndex;
            await _applyDamage(game, { dcHealthState, logGameAction, client }, {
              figureKey: fk, msgId: desc.sourceMsgId, figIndex: fkIdx,
              amount: 1, controllerPlayerNum: ownerPlayerNum,
              source: 'Madness', viaStrain: true,
            });
          }
        }
        await interaction.message.edit({ content: `\u{1F4A2} **Madness** — **${displayName}** suffered **1 Strain** and became **Focused** (hand size ${hand.length}).`, components: [] }).catch(discordCatch);
        if (logGameAction) await logGameAction(game, client, `\u{1F4A2} **Madness** — ${displayName} suffered 1 strain + Focus.`, { phase: 'ROUND', icon: 'card' });
      } else {
        await interaction.message.edit({ content: `\u{1F4A2} **Madness** — Hand size is ${hand.length} (>2); no effect.`, components: [] }).catch(discordCatch);
      }
    } else if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F4A2} **Madness** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Unknown Madness choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Into the Fray (Baze Malbus) ---
  } else if (desc.subPromptKey === 'into_the_fray') {
    if (choiceKey === 'apply') {
      grantMovementBank(game, desc.sourceMsgId, 1);
      const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const selfFk = `Baze Malbus-${dgIndex}-0`;
      const ms = getMapData(game.selectedMap?.id);
      const selfPos = game.figurePositions?.[ownerPlayerNum]?.[selfFk];
      let surgeCount = 0;
      if (selfPos && ms) {
        const enemyNum = opponentPlayerNum(ownerPlayerNum);
        const allFootprints = getAllFigureFootprints(game, getFigureSize);
        const selfFp = getFigureFootprint(game, ownerPlayerNum, selfFk, getFigureSize);
        for (const [eFk] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
          const eFp = getFigureFootprint(game, enemyNum, eFk, getFigureSize);
          if (!eFp.length) continue;
          if (hasFigureLineOfSight(selfFp, eFp, ms, allFootprints)) surgeCount++;
        }
      }
      if (surgeCount > 0) grantPowerTokens(game, selfFk, 'Surge', surgeCount);
      await interaction.message.edit({ content: `\u{1F525} **Into the Fray** — **${displayName}** gained **1 MP** and **${surgeCount} Surge Token${surgeCount !== 1 ? 's' : ''}** (${surgeCount} hostile${surgeCount !== 1 ? 's' : ''} with LOS).`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F525} **Into the Fray** — ${displayName} +1 MP, +${surgeCount} Surge.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F525} **Into the Fray** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Unknown ItF choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Beast Tamer (Skirmish Upgrade) ---
  // Per destruct 2026-05-07: exhaust for EITHER Speed MP OR Interact Override
  // (Non-Sentient only). Both options exhaust the upgrade.
  } else if (desc.subPromptKey === 'beast_tamer') {
    const _markExhausted = () => {
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[desc.sourceMsgId] = game.exhaustedSkirmishUpgrades[desc.sourceMsgId] || [];
      game.exhaustedSkirmishUpgrades[desc.sourceMsgId].push('Beast Tamer');
    };
    if (choiceKey === 'mp') {
      _markExhausted();
      const speed = getDcStats(desc.extras?.dcName || meta?.dcName)?.speed ?? 0;
      if (speed > 0) grantMovementBank(game, desc.sourceMsgId, speed);
      await interaction.message.edit({ content: `\u{1F436} **Beast Tamer** — **${displayName}** exhausted for **${speed} MP** (Speed).`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F436} **Beast Tamer** — ${displayName} +${speed} MP.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'override') {
      _markExhausted();
      game.beastTamerInteractOverride = game.beastTamerInteractOverride || {};
      game.beastTamerInteractOverride[desc.sourceMsgId] = true;
      await interaction.message.edit({ content: `\u{1F436} **Beast Tamer** — **${displayName}** exhausted for **Interact Override** (Non-Sentient).`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F436} **Beast Tamer** — ${displayName} can interact (Non-Sentient override).`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F436} **Beast Tamer** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Unknown Beast Tamer choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Companion order (host activation companion: first or second) ---
  // Sets game.companionActivatedBefore[hostMsgId] which is read by the
  // existing inline activation logic to gate "before vs after" host
  // activation. Per destruct 2026-05-07: companion's full activation
  // (2 actions) must complete before the other goes — that gate is a
  // separate item (audit (c) follow-up).
  } else if (desc.subPromptKey === 'companion_order') {
    game.companionActivatedBefore = game.companionActivatedBefore || {};
    if (choiceKey === 'first') {
      game.companionActivatedBefore[desc.sourceMsgId] = 'before';
      await interaction.message.edit({ content: `\u{1F43E} **Companion order** — **${desc.extras?.companionName}** activates FIRST. Complete its full activation before ${desc.extras?.dcName}.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F43E} **Companion order** — ${desc.extras?.companionName} first.`, { phase: 'ROUND', icon: 'card' });
    } else if (choiceKey === 'second') {
      game.companionActivatedBefore[desc.sourceMsgId] = 'after';
      await interaction.message.edit({ content: `\u{1F43E} **Companion order** — **${desc.extras?.dcName}** activates first; **${desc.extras?.companionName}** activates after.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F43E} **Companion order** — ${desc.extras?.dcName} first, ${desc.extras?.companionName} after.`, { phase: 'ROUND', icon: 'card' });
    } else {
      await interaction.followUp({ content: `Unknown companion order choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Advanced Weapons Research (Director Krennic) ---
  // choiceKey is `${figureKey}|damage` or `${figureKey}|surge`, or 'skip'.
  // Apply: grant 1 Damage or Surge token to the chosen friendly.
  } else if (desc.subPromptKey === 'awr') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F52C} **Advanced Weapons Research** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const _splitIdx = choiceKey.indexOf('|');
      if (_splitIdx < 0) {
        await interaction.followUp({ content: `Malformed AWR choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const targetFk = choiceKey.slice(0, _splitIdx);
      const tokenType = choiceKey.slice(_splitIdx + 1) === 'damage' ? 'Damage' : 'Surge';
      grantPowerTokens(game, targetFk, tokenType, 1);
      const targetDcName = dcNameFromFigureKey(targetFk);
      await interaction.message.edit({ content: `\u{1F52C} **Advanced Weapons Research** — **${targetDcName}** gained **1 ${tokenType} Token**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F52C} **Advanced Weapons Research** — ${targetDcName} +1 ${tokenType} Token.`, { phase: 'ROUND', icon: 'card' });
    }

  // --- Unshakable (Skirmish Upgrade) ---
  // Per destruct 2026-05-07 corrections: player picks which HARMFUL
  // condition to discard (sub-prompt enumerates pairs, choiceKey is
  // `${fk}|${condition}`); strain routes through applyStrain so the
  // standard player-choice strain subroutine fires (Under Duress prompt,
  // Fireproof, Headhunter, etc.).
  } else if (desc.subPromptKey === 'unshakable') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F6E1}\u{FE0F} **Unshakable** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const _splitIdx = choiceKey.indexOf('|');
      if (_splitIdx < 0) {
        await interaction.followUp({ content: `Malformed Unshakable choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const targetFk = choiceKey.slice(0, _splitIdx);
      const chosenCond = choiceKey.slice(_splitIdx + 1);
      const targetDcName = dcNameFromFigureKey(targetFk);
      const conds = game.figureConditions?.[targetFk] || [];
      if (!conds.includes(chosenCond)) {
        await interaction.followUp({ content: `${targetDcName} no longer has ${chosenCond}; resolve manually.`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const { filterCondition } = await import('../game/conditions.js');
      filterCondition(game, targetFk, chosenCond);
      // Exhaust Unshakable.
      const usMsgId = desc.extras?.unshakableMsgId || desc.sourceMsgId;
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[usMsgId] = game.exhaustedSkirmishUpgrades[usMsgId] || [];
      if (!game.exhaustedSkirmishUpgrades[usMsgId].includes('Unshakable')) {
        game.exhaustedSkirmishUpgrades[usMsgId].push('Unshakable');
      }
      await interaction.message.edit({ content: `\u{1F6E1}\u{FE0F} **Unshakable** — **${targetDcName}** discarded **${chosenCond}**. Now suffering **1 Strain**...`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F6E1}\u{FE0F} **Unshakable** — ${targetDcName} -${chosenCond}, +1 strain.`, { phase: 'ROUND', icon: 'card' });
      // Strain via the player-choice subroutine (UD prompt, Fireproof,
      // Headhunter, etc.). Controller is the figure's owner = bucket
      // owner (Unshakable is friendly trigger).
      const { applyStrain } = await import('./strain-handler.js');
      await applyStrain(game, ctx, {
        figureKey: targetFk,
        controllerPlayerNum: ownerPlayerNum,
        amount: 1,
        source: 'Unshakable',
      });
    }

  // --- Hair Trigger (Jyn Odan) ---
  // Apply: post a granted_attack_* button for Jyn to perform a free
  // interrupt attack against the activator. Reuses the existing
  // granted-attack primitive (rewrites to dc_attack_*, freeAttackBonusPending
  // makes it free, forcedAttackTarget restricts the target). Marks
  // game.jynHairTriggerUsed[jynMsgId] for once-per-round limit.
  } else if (desc.subPromptKey === 'hair_trigger') {
    if (choiceKey === 'apply') {
      const jynMsgId = desc.sourceMsgId;
      const jynFk = desc.extras?.jynFigureKey;
      const targetFk = desc.extras?.targetFigureKey;
      game.jynHairTriggerUsed = game.jynHairTriggerUsed || {};
      game.jynHairTriggerUsed[jynMsgId] = true;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[jynMsgId] = true;
      game.forcedAttackTarget = game.forcedAttackTarget || {};
      game.forcedAttackTarget[jynMsgId] = targetFk;
      const _jynFkMatch = String(jynFk || '').match(/-(\d+)-(\d+)$/);
      const _jynFigIdx = _jynFkMatch ? _jynFkMatch[2] : '0';
      const _haBtn = new ButtonBuilder()
        .setCustomId(`granted_attack_${gameId}_${jynMsgId}_f${_jynFigIdx}`)
        .setLabel(`Declare Hair Trigger Attack (Jyn Odan)`)
        .setStyle(ButtonStyle.Danger);
      const _haRow = new ActionRowBuilder().addComponents(_haBtn);
      await interaction.message.edit({
        content: `\u{1F52B} **Hair Trigger** — **Jyn Odan** must perform her free attack now. Click below to declare.`,
        components: [_haRow],
      }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F52B} **Hair Trigger** — Jyn Odan interrupt-attack triggered.`, { phase: 'ROUND', icon: 'attack' });
    } else if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F52B} **Hair Trigger** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Unknown Hair Trigger choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Voracious (Rancor) ---
  // Sub-prompt yields a friendly figureKey to sacrifice or 'skip'. On
  // sacrifice: defeat the chosen friendly, recover 2 HP on Rancor, ready
  // Rancor's DC, mark game.voraciousUsed[rancorMsgId] for once-per-round.
  } else if (desc.subPromptKey === 'voracious') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F432} **Voracious** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choiceKey;
      const targetDcName = dcNameFromFigureKey(targetFk);
      const rancorMsgId = desc.sourceMsgId;
      const rancorPn = desc.extras?.rancorPlayerNum;
      const rancorFk = desc.extras?.rancorFigureKey;
      // Mark once-per-round
      game.voraciousUsed = game.voraciousUsed || {};
      game.voraciousUsed[rancorMsgId] = true;
      // Recover 2 HP on Rancor
      if (dcHealthState && rancorPn) {
        const rFkParsed = rancorFk?.match(/-(\d+)-(\d+)$/);
        const rFigIdx = rFkParsed ? parseInt(rFkParsed[2], 10) : 0;
        healHp(dcHealthState, game, rancorMsgId, rFigIdx, 2, rancorPn);
      }
      // Ready Rancor's DC (un-exhaust)
      if (ctx.dcExhaustedState) {
        ctx.dcExhaustedState.set(rancorMsgId, false);
      }
      // Direct-defeat: per IACP these abilities skip WHEN_DAMAGED and
      // BEFORE_DEFEATED. applyDirectDefeat records HP=0, fires
      // WHEN_DEFEATED hooks (Last Stand, Bounty, etc.), and finalizes
      // via processFigureDefeat. Self-inflicted: attacker = controller
      // so no VP is awarded.
      const targetFkParsed = String(targetFk).match(/-(\d+)-(\d+)$/);
      const targetFigIdx = targetFkParsed ? parseInt(targetFkParsed[2], 10) : 0;
      let targetMsgId = null;
      if (dcMessageMeta && rancorPn) {
        for (const [mId, mMeta] of dcMessageMeta) {
          if (mMeta.gameId !== gameId) continue;
          if (mMeta.dcName === targetDcName && mMeta.playerNum === rancorPn) {
            targetMsgId = mId;
            break;
          }
        }
      }
      if (rancorPn && targetMsgId) {
        const { applyDirectDefeat } = await import('../game/damage-pipeline.js');
        await applyDirectDefeat(game, ctx, {
          figureKey: targetFk,
          msgId: targetMsgId,
          figIndex: targetFigIdx,
          controllerPlayerNum: rancorPn,
          attackerPlayerNum: rancorPn,
          dcName: targetDcName,
          displayName: targetDcName,
          source: 'Voracious',
        });
      }
      await interaction.message.edit({ content: `\u{1F432} **Voracious** — **${targetDcName}** sacrificed; **Rancor** recovered **2 Damage** and readied his card.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F432} **Voracious** — Rancor sacrificed ${targetDcName} → +2 HP, readied DC.`, { phase: 'ROUND', icon: 'card' });
    }

  // --- I Make the Rules Now (Cad Bane) ---
  // Sub-prompt yields the chosen HUNTER's figureKey (or 'skip'). Grant 1
  // MP to that HUNTER's bank. If the chosen HUNTER is the activator, the
  // MP goes into the activation bank normally; if NOT the activator, the
  // MP must be used immediately via the interrupt-move pattern (same as
  // Tactical Movement when target ≠ Fenn).
  } else if (desc.subPromptKey === 'imrn') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F3AF} **I Make the Rules Now** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choiceKey;
      const targetDcName = dcNameFromFigureKey(targetFk);
      const cadPn = desc.extras?.cadPlayerNum;
      // Find target's msgId on Cad Bane's team.
      let targetMsgId = null;
      if (dcMessageMeta && cadPn) {
        for (const [mId, mMeta] of dcMessageMeta) {
          if (mMeta.gameId !== gameId) continue;
          if (mMeta.dcName === targetDcName && mMeta.playerNum === cadPn) {
            targetMsgId = mId;
            break;
          }
        }
      }
      const activatorMsgId = desc.extras?.activatorMsgId;
      if (!targetMsgId) {
        await interaction.message.edit({ content: `\u{1F3AF} **I Make the Rules Now** — could not locate **${targetDcName}**'s movement bank; resolve manually.`, components: [] }).catch(discordCatch);
      } else if (targetMsgId === activatorMsgId) {
        // Recipient = the figure whose activation just started → bank
        // (rule 3, in-activation grant on the activator).
        grantMovementBank(game, targetMsgId, 1);
        await interaction.message.edit({ content: `\u{1F3AF} **I Make the Rules Now** — **${targetDcName}** gained **1 MP** (added to activation bank).`, components: [] }).catch(discordCatch);
        if (logGameAction) await logGameAction(game, client, `\u{1F3AF} **I Make the Rules Now** — ${targetDcName} +1 MP.`, { phase: 'ROUND', icon: 'card' });
      } else {
        // Recipient ≠ activator → spend immediately, no bank
        // (rule 1, out-of-activation grant on another figure). Stamp
        // pendingMoveX with bypassCosts: false so each step honors
        // terrain/figure adders.
        const { setupPendingMoveX } = await import('./move-x-handler.js');
        await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
          msgId: targetMsgId,
          figureKey: targetFk,
          playerNum: cadPn,
          spaces: 1,
          source: 'I Make the Rules Now',
          threadId: null,
          bypassCosts: false,
        });
        await interaction.message.edit({
          content: `\u{1F3AF} **I Make the Rules Now** — **${targetDcName}** gains **1 MP** — spend at once, remainder lost (picker posted).`,
          components: [],
        }).catch(discordCatch);
        if (logGameAction) await logGameAction(game, client, `\u{1F3AF} **I Make the Rules Now** — ${targetDcName} gains 1 MP (spend immediately, no bank).`, { phase: 'ROUND', icon: 'card' });
      }
    }

  // --- Tactical Movement (Fenn Signis) ---
  // destruct 2026-05-07: if the chosen figure is Fenn himself the 2 MP go
  // into Fenn's activation bank as a normal SoA grant. If the chosen figure
  // is ANY OTHER friendly the 2 MP must be used IMMEDIATELY via interrupt
  // (it is not that figure's activation). Post a granted-move button so
  // the player can spend the 2 MP right now via the chosen figure's
  // standard Move flow.
  } else if (desc.subPromptKey === 'tac_move') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F3AF} **Tactical Movement** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choiceKey;
      const targetDcName = dcNameFromFigureKey(targetFk);
      const sourceFk = desc.extras?.sourceFigureKey;
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
      if (!targetMsgId) {
        await interaction.message.edit({ content: `\u{1F3AF} **Tactical Movement** — could not locate **${targetDcName}**'s movement bank; resolve manually.`, components: [] }).catch(discordCatch);
      } else if (targetFk === sourceFk) {
        // Self-target = activator → bank (rule 3, in-activation grant
        // on the activator).
        grantMovementBank(game, targetMsgId, 2);
        await interaction.message.edit({ content: `\u{1F3AF} **Tactical Movement** — **${targetDcName}** gained **2 MP** (added to activation bank).`, components: [] }).catch(discordCatch);
        if (logGameAction) await logGameAction(game, client, `\u{1F3AF} **Tactical Movement** — ${targetDcName} gained 2 MP.`, { phase: 'ROUND', icon: 'card' });
      } else {
        // Recipient ≠ activator → no bank, picker posted with the
        // 2-MP budget; bypassCosts: false so terrain/figure adders
        // still apply (the figure's profile keywords still bypass).
        const { setupPendingMoveX } = await import('./move-x-handler.js');
        await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
          msgId: targetMsgId,
          figureKey: targetFk,
          playerNum: ownerPlayerNum,
          spaces: 2,
          source: 'Tactical Movement',
          threadId: null,
          bypassCosts: false,
        });
        await interaction.message.edit({
          content: `\u{1F3AF} **Tactical Movement** — **${targetDcName}** gains **2 MP** — spend at once, remainder lost (picker posted).`,
          components: [],
        }).catch(discordCatch);
        if (logGameAction) await logGameAction(game, client, `\u{1F3AF} **Tactical Movement** — ${targetDcName} gained 2 MP (spend immediately, no bank).`, { phase: 'ROUND', icon: 'card' });
      }
    }

  // --- Calming Presence (Yoda) ---
  // choiceKey is `${fk}|${condition}` or 'skip'. Remove the chosen
  // condition; activating figure suffers 1 Strain through applyStrain
  // (player-choice subroutine for Under Duress / Fireproof / Headhunter
  // interactions).
  } else if (desc.subPromptKey === 'calming_presence') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F9D8} **Calming Presence** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const _cpSplit = choiceKey.indexOf('|');
      if (_cpSplit < 0) {
        await interaction.followUp({ content: `Malformed Calming Presence choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const targetFk = choiceKey.slice(0, _cpSplit);
      const condName = choiceKey.slice(_cpSplit + 1);
      const conds = game.figureConditions?.[targetFk] || [];
      if (!conds.includes(condName)) {
        await interaction.message.edit({ content: `\u{1F9D8} **Calming Presence** — **${dcNameFromFigureKey(targetFk)}** no longer has ${condName}.`, components: [] }).catch(discordCatch);
      } else {
        const { filterCondition } = await import('../game/conditions.js');
        filterCondition(game, targetFk, condName);
        const targetDcName = dcNameFromFigureKey(targetFk);
        await interaction.message.edit({ content: `\u{1F9D8} **Calming Presence** — Removed **${condName}** from **${targetDcName}**. **${displayName}** suffers **1 Strain**...`, components: [] }).catch(discordCatch);
        if (logGameAction) await logGameAction(game, client, `\u{1F9D8} **Calming Presence** — Removed ${condName} from ${targetDcName}; ${displayName} suffered 1 Strain.`, { phase: 'ROUND', icon: 'condition' });
        // Strain on activating figure (lead figure of the activation).
        const actLeadFk = `${desc.extras?.dcName}-${(meta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1'}-0`;
        const { applyStrain } = await import('./strain-handler.js');
        await applyStrain(game, ctx, {
          figureKey: actLeadFk,
          controllerPlayerNum: ownerPlayerNum,
          amount: 1,
          source: 'Calming Presence',
        });
      }
    }

  // --- Long-Laid Plans (Thrawn) ---
  // Multi-step: each click grants 1 token of the chosen type to the
  // chosen figure, marks the type as used, and re-prompts with
  // remaining types until count === 0 or no types left. Returns early
  // (skips consumeDescriptor) when re-prompting; consumes when done.
  } else if (desc.subPromptKey === 'long_laid_plans') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F9E0} **Long-Laid Plans** — Skipped remaining.`, components: [] }).catch(discordCatch);
    } else {
      const _llpSplit = choiceKey.indexOf('|');
      if (_llpSplit < 0) {
        await interaction.followUp({ content: `Malformed Long-Laid Plans choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const targetFk = choiceKey.slice(0, _llpSplit);
      const tokenTypeLower = choiceKey.slice(_llpSplit + 1);
      const tokenType = tokenTypeLower.charAt(0).toUpperCase() + tokenTypeLower.slice(1);
      grantPowerTokens(game, targetFk, tokenType, 1);
      desc.extras.usedTypes = desc.extras.usedTypes || [];
      desc.extras.usedTypes.push(tokenTypeLower);
      desc.extras.remainingCount = (desc.extras.remainingCount || 1) - 1;
      const targetDcName = dcNameFromFigureKey(targetFk);
      const remainingTypes = ['damage', 'block', 'surge', 'evade'].filter((t) => !desc.extras.usedTypes.includes(t));
      if (logGameAction) await logGameAction(game, client, `\u{1F9E0} **Long-Laid Plans** — ${targetDcName} +1 ${tokenType} Token (${desc.extras.remainingCount} left).`, { phase: 'ROUND', icon: 'card' });
      if (desc.extras.remainingCount > 0 && remainingTypes.length > 0) {
        // Re-prompt with reduced types; do NOT consume.
        const candidates = desc.extras.candidates || [];
        const buttons = [];
        for (const fk of candidates) {
          const name = dcNameFromFigureKey(fk);
          for (const t of remainingTypes) {
            buttons.push(new ButtonBuilder()
              .setCustomId(`soa_fire_${gameId}_${desc.id}_${fk}|${t}`)
              .setLabel(`${name}: ${t.charAt(0).toUpperCase() + t.slice(1)}`)
              .setStyle(t === 'damage' ? ButtonStyle.Danger : ButtonStyle.Primary));
          }
        }
        buttons.push(new ButtonBuilder().setCustomId(`soa_fire_${gameId}_${desc.id}_skip`).setLabel('Skip remaining').setStyle(ButtonStyle.Secondary));
        const llpRows = [];
        for (let i = 0; i < buttons.length; i += 5) {
          llpRows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }
        await interaction.message.edit({
          content: `\u{1F9E0} **Long-Laid Plans** — **${targetDcName}** gained **1 ${tokenType} Token**. Distribute **${desc.extras.remainingCount}** more (different type):`,
          components: llpRows.slice(0, 5),
        }).catch(discordCatch);
        saveGames(game.gameId);
        return;
      }
      await interaction.message.edit({ content: `\u{1F9E0} **Long-Laid Plans** — **${targetDcName}** gained **1 ${tokenType} Token**. Distribution complete.`, components: [] }).catch(discordCatch);
    }

  // --- Arms Distribution (Ko-Tun) — SoA portion ---
  // choiceKey is `${figureKey}|damage` or `${figureKey}|block`, or 'skip'.
  // Grants 1 Damage or Block token to the chosen friendly.
  } else if (desc.subPromptKey === 'arms_distribution') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F3AF} **Arms Distribution** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const _adSplit = choiceKey.indexOf('|');
      if (_adSplit < 0) {
        await interaction.followUp({ content: `Malformed Arms Distribution choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const targetFk = choiceKey.slice(0, _adSplit);
      const tokenType = choiceKey.slice(_adSplit + 1) === 'damage' ? 'Damage' : 'Block';
      grantPowerTokens(game, targetFk, tokenType, 1);
      const targetDcName = dcNameFromFigureKey(targetFk);
      await interaction.message.edit({ content: `\u{1F3AF} **Arms Distribution** — **${targetDcName}** gained **1 ${tokenType} Token**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F3AF} **Arms Distribution** — ${targetDcName} +1 ${tokenType} Token.`, { phase: 'ROUND', icon: 'card' });
    }

  // --- Force Vision (Kanan Jarrus) ---
  // choiceKey is the chosen DC index in the opponent's dcList. Set
  // game.forceVisionNextActivation so the lock fires when the opponent
  // next activates a group.
  } else if (desc.subPromptKey === 'force_vision') {
    const dcIndex = parseInt(choiceKey, 10);
    const _fvDcList = getDcList(game, ownerPlayerNum) || [];
    const _fvDc = Number.isFinite(dcIndex) ? _fvDcList[dcIndex] : null;
    if (!_fvDc) {
      await interaction.followUp({ content: `Invalid Force Vision choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }
    const _fvDispName = _fvDc.displayName || _fvDc.dcName;
    game.forceVisionNextActivation = { playerNum: ownerPlayerNum, dcName: _fvDc.dcName };
    await interaction.message.edit({
      content: `\u{1F441}\u{FE0F} **Force Vision** — **${_fvDispName}** must be activated next by Player ${ownerPlayerNum}, if possible.`,
      components: [],
    }).catch(discordCatch);
    if (logGameAction) await logGameAction(game, client, `\u{1F441}\u{FE0F} **Force Vision** — ${_fvDispName} forced next for Player ${ownerPlayerNum}.`, { phase: 'ROUND', icon: 'activate' });

  // --- Wisdom (Yoda) ---
  // choiceKey is the card index in the unique-hand list (the picker
  // posted at handleSoaPick time). Remove that card from hand and push
  // to the bottom of the deck. Hand state already includes the card
  // drawn during handleSoaPick.
  } else if (desc.subPromptKey === 'wisdom') {
    const _wDeckKey = ccDeckKey(ownerPlayerNum);
    const _wHandKey = ccHandKey(ownerPlayerNum);
    const _wHand = game[_wHandKey] || [];
    const _wUnique = [...new Set(_wHand)];
    const cardIndex = parseInt(choiceKey, 10);
    if (Number.isFinite(cardIndex) && cardIndex >= 0 && cardIndex < _wUnique.length) {
      const cardName = _wUnique[cardIndex];
      const _wIdx = _wHand.indexOf(cardName);
      if (_wIdx >= 0) {
        _wHand.splice(_wIdx, 1);
        game[_wHandKey] = _wHand;
        game[_wDeckKey] = game[_wDeckKey] || [];
        game[_wDeckKey].push(cardName);
        await interaction.message.edit({ content: `\u{1F9D8} **Wisdom** — Returned **${cardName}** to the bottom of the deck.`, components: [] }).catch(discordCatch);
        if (logGameAction) await logGameAction(game, client, `\u{1F9D8} **Wisdom** — Yoda drew 1 CC, returned ${cardName} to bottom.`, { phase: 'ROUND', icon: 'card' });
      } else {
        await interaction.message.edit({ content: `\u{1F9D8} **Wisdom** — Card no longer in hand.`, components: [] }).catch(discordCatch);
      }
    } else {
      await interaction.followUp({ content: `Invalid Wisdom choice: ${choiceKey}`, ephemeral: true }).catch(discordCatch);
      return;
    }

  // --- Trust Goes Both Ways (Jyn Erso) ---
  // Recover 1 Damage on Jyn + chosen friendly. Grant 1 Surge Token to
  // both. Mark once-per-round.
  } else if (desc.subPromptKey === 'trust_both_ways') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F91D} **Trust Goes Both Ways** — Skipped.`, components: [] }).catch(discordCatch);
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
      await interaction.message.edit({ content: `\u{1F91D} **Trust Goes Both Ways** — ${parts.join('; ')}.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `\u{1F91D} **Trust Goes Both Ways** — ${parts.join('; ')}.`, { phase: 'ROUND', icon: 'card' });
    }

  // --- Imperial Citadel (I47) ---
  // Decrement Citadel pool by 1 of chosen type, grant Power Token to
  // activator's lead figure, refresh the Citadel DC embed to show new
  // count.
  } else if (desc.subPromptKey === 'imperial_citadel') {
    if (choiceKey === 'skip') {
      await interaction.message.edit({ content: `\u{1F3F0} **Imperial Citadel** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const tokenType = choiceKey;
      const _icTokens = game.imperialCitadelTokens || {};
      if ((_icTokens[tokenType] || 0) > 0) {
        _icTokens[tokenType]--;
        game.imperialCitadelTokens = _icTokens;
        const _icCap = tokenType.charAt(0).toUpperCase() + tokenType.slice(1);
        grantPowerTokens(game, selfFigKey, _icCap, 1);
        await interaction.message.edit({ content: `\u{1F3F0} **Imperial Citadel** — **${displayName}** gained **1 ${_icCap} Token**.`, components: [] }).catch(discordCatch);
        if (logGameAction) await logGameAction(game, client, `\u{1F3F0} **Imperial Citadel** — ${displayName} gained 1 ${_icCap} Token.`, { phase: 'ROUND', icon: 'card' });
        // Refresh the Citadel DC embed so token counts update on screen.
        const _icDcListR = getDcList(game, ownerPlayerNum) || [];
        const _icMsgIdsR = getDcMessageIds(game, ownerPlayerNum) || [];
        const _icIdxR = _icDcListR.findIndex((dc) => dc?.dcName === '[Imperial Citadel]');
        if (_icIdxR >= 0 && _icMsgIdsR[_icIdxR]) {
          await updateDcCardMessage(client, game, _icMsgIdsR[_icIdxR], ctx, { errorContext: 'Failed to refresh Imperial Citadel embed:' });
        }
      } else {
        await interaction.message.edit({ content: `\u{1F3F0} **Imperial Citadel** — No ${tokenType} tokens remaining.`, components: [] }).catch(discordCatch);
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
