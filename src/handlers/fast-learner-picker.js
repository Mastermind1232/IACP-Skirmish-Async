/**
 * Mara Jade Fast Learner picker — `cc_fl_pick_named_*` / `cc_fl_pick_mara_*`.
 *
 * When a unique-figure CC is played AND Mara is in the army with Fast Learner
 * unused this round AND the named figure is ALSO in army, the player must
 * choose which figure plays the CC. Picking Mara consumes her once-per-round
 * Fast Learner ability.
 *
 * Excluded by data: Arcing Shot (explicit FL exclusion), You Will Not Deny Me
 * (always retargets to 5th Brother regardless of player).
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { parseCustomId } from '../discord/custom-id.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { getHandChannelId } from '../game/player-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import {
  setPendingFastLearnerPick,
  clearPendingFastLearnerPick,
  setPendingCcConfirmation,
} from '../game/interrupts.js';

const PICK_TTL_MS = 10 * 60 * 1000;

/**
 * Posts the named/Mara picker to the player's hand channel and stashes
 * pending state. Caller (handleCcConfirmPlay) bails after this.
 */
export async function presentFastLearnerPicker(interaction, game, playerNum, card, eligibility) {
  const gameId = game.gameId;
  const namedLabel = eligibility.namedFigures.map(f => f.displayName).join(' / ');
  const maraLabel = eligibility.maraDc.displayName;

  setPendingFastLearnerPick(game, {
    playerNum,
    card,
    ts: Date.now(),
    namedFigures: eligibility.namedFigures.map(f => ({ dcName: f.dcName, displayName: f.displayName })),
    maraDc: { dcName: eligibility.maraDc.dcName, displayName: eligibility.maraDc.displayName },
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cc_fl_pick_named_${gameId}`).setLabel(`Play as ${namedLabel}`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cc_fl_pick_mara_${gameId}`).setLabel(`Play via Fast Learner (${maraLabel})`).setStyle(ButtonStyle.Secondary),
  );

  await interaction.deferUpdate().catch(discordCatch);
  // alexanbv 2026-06-23: keep message (no delete) for traceability
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await fetchGameChannel(interaction.client, handId);
  await withDiscordRetry(() => handChannel.send({
    content: `Both **${namedLabel}** and **${maraLabel}** can play **${card}**. Choose who plays it — picking Mara Jade consumes her Fast Learner ability this round.`,
    components: [row],
  }));
}

async function _resolvePick(interaction, ctx, choice) {
  const prefix = choice === 'mara' ? 'cc_fl_pick_mara_' : 'cc_fl_pick_named_';
  const { getGame, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, prefix);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pick = game.pendingFastLearnerPick;
  if (!pick) {
    await interaction.followUp({ content: 'No pending Fast Learner choice — picker may have expired.', ephemeral: true }).catch(discordCatch);
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    return;
  }
  if (Date.now() - (pick.ts || 0) > PICK_TTL_MS) {
    clearPendingFastLearnerPick(game);
    saveGames(game.gameId);
    await interaction.followUp({ content: 'Choice expired — replay the card from your hand.', ephemeral: true }).catch(discordCatch);
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pick.playerNum, canActAsPlayer, 'Not your card to confirm.')) return;

  const { playerNum, card } = pick;
  clearPendingFastLearnerPick(game);

  // Re-establish pendingCcConfirmation with the picker outcome encoded.
  // handleCcConfirmPlay reads `_flResolved` before clearing the pending
  // confirmation and uses it to skip the picker check + drive FL marking.
  setPendingCcConfirmation(game, { playerNum, card, ts: Date.now(), _flResolved: choice });
  saveGames(game.gameId);

  // Synthesize an interaction whose customId looks like a PLAY CARD click,
  // so handleCcConfirmPlay can parse gameId normally. Object.create chains
  // through the real interaction for everything except customId.
  const synthetic = Object.create(interaction);
  Object.defineProperty(synthetic, 'customId', {
    value: `cc_confirm_play_${gameId}`,
    configurable: true,
    enumerable: true,
  });

  const { handleCcConfirmPlay } = await import('./cc-hand.js');
  await handleCcConfirmPlay(synthetic, ctx);
}

export async function handleFastLearnerPickNamed(interaction, ctx) {
  await _resolvePick(interaction, ctx, 'named');
}

export async function handleFastLearnerPickMara(interaction, ctx) {
  await _resolvePick(interaction, ctx, 'mara');
}

// ── Unified unique-figure-CC player picker (alexanbv 2026-06-21) ─────────────
// Generalizes the named-vs-Mara picker to ALL enablers (Fast Learner, There is
// Another, A New Hope). One button per eligible on-board figure; the label shows
// how that figure plays. The chosen figureKey becomes the range anchor and its
// `consume` is applied by handleCcConfirmPlay on re-entry.

const _KIND_LABEL = {
  named: '',
  anchor: '',
  restriction: '',
  fast_learner: ' (Fast Learner)',
  there_is_another: ' (There is Another)',
  a_new_hope: ' (A New Hope)',
};

function _displayForFigureKey(figureKey) {
  return String(figureKey || '').replace(/-\d+-\d+$/, '');
}

/**
 * Posts the unified player picker to the player's hand channel and stashes the
 * options. Caller (handleCcConfirmPlay) bails after this. customIds are
 * `cc_uccp_<idx>_<gameId>`.
 */
export async function presentUniqueCcPlayerPicker(interaction, game, playerNum, card, options) {
  const gameId = game.gameId;

  setPendingFastLearnerPick(game, {
    playerNum,
    card,
    ts: Date.now(),
    // Unified options: the presence of `uccpOptions` distinguishes this from the
    // legacy named/Mara pick state.
    uccpOptions: options.map((o) => ({
      figureKey: o.figureKey,
      displayName: o.displayName || _displayForFigureKey(o.figureKey),
      kind: o.kind,
      consume: o.consume,
    })),
  });

  const buttons = options.slice(0, 24).map((o, i) => new ButtonBuilder()
    .setCustomId(`cc_uccp_${i}_${gameId}`)
    .setLabel(`${(o.displayName || _displayForFigureKey(o.figureKey)).slice(0, 60)}${_KIND_LABEL[o.kind] || ''}`.slice(0, 80))
    .setStyle((o.kind === 'named' || o.kind === 'restriction') ? ButtonStyle.Primary : ButtonStyle.Secondary));

  await interaction.deferUpdate().catch(discordCatch);
  // alexanbv 2026-06-23: keep message (no delete) for traceability
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await fetchGameChannel(interaction.client, handId);
  const _anyConsumes = options.some((o) => o.consume && o.consume !== 'none');
  await withDiscordRetry(() => handChannel.send({
    content: `Multiple figures can play **${card}**. Choose who plays it — the range is measured from the figure you pick.${_anyConsumes ? ' Fast Learner / A New Hope choices consume that ability.' : ''}`,
    components: chunkButtonsToRows(buttons),
  }));
}

export async function handleUniqueCcPlayerPick(interaction, ctx) {
  const prefix = 'cc_uccp_';
  const { getGame, saveGames } = ctx;
  // customId form: cc_uccp_<idx>_<gameId>
  const rest = interaction.customId.slice(prefix.length);
  const usIdx = rest.indexOf('_');
  const chosenIdx = Number(rest.slice(0, usIdx));
  const gameId = rest.slice(usIdx + 1);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pick = game.pendingFastLearnerPick;
  if (!pick || !Array.isArray(pick.uccpOptions)) {
    await interaction.followUp({ content: 'No pending choice — picker may have expired.', ephemeral: true }).catch(discordCatch);
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    return;
  }
  if (Date.now() - (pick.ts || 0) > PICK_TTL_MS) {
    clearPendingFastLearnerPick(game);
    saveGames(game.gameId);
    await interaction.followUp({ content: 'Choice expired — replay the card from your hand.', ephemeral: true }).catch(discordCatch);
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pick.playerNum, canActAsPlayer, 'Not your card to confirm.')) return;

  const chosen = pick.uccpOptions[chosenIdx];
  if (!chosen) {
    await interaction.followUp({ content: 'That option is no longer valid — replay the card.', ephemeral: true }).catch(discordCatch);
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    return;
  }
  const { playerNum, card } = pick;
  clearPendingFastLearnerPick(game);

  // Re-establish pendingCcConfirmation with the chosen figure + consumption
  // encoded in _flResolved (object form). handleCcConfirmPlay reads it, skips the
  // picker, applies the matching consumption, and anchors the range on the figure.
  setPendingCcConfirmation(game, {
    playerNum, card, ts: Date.now(),
    _flResolved: { figureKey: chosen.figureKey, consume: chosen.consume, kind: chosen.kind },
  });
  saveGames(game.gameId);

  const synthetic = Object.create(interaction);
  Object.defineProperty(synthetic, 'customId', {
    value: `cc_confirm_play_${gameId}`,
    configurable: true,
    enumerable: true,
  });

  const { handleCcConfirmPlay } = await import('./cc-hand.js');
  await handleCcConfirmPlay(synthetic, ctx);
}
