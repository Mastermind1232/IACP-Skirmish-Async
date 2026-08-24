/**
 * Per-step interrupt loop for "move N spaces" abilities.
 *
 * destruct 2026-05-06 spec: every step of a "move N spaces" replay must
 * give the opponent a chance to play Parting Blow / Dirty Trick /
 * Self-Defense (when conditions match). The actual CC play happens via
 * the player's existing hand UI; this loop's job is to surface the
 * trigger window at each step and pause the move until the opponent
 * has had the chance to react.
 *
 * State machine:
 *
 *   1. Caller invokes `startMoveInterruptLoop(game, ctx, mover, path,
 *      opts, followup)`. The helper:
 *      - Runs `extractMoveInterruptOpportunities` to enumerate all
 *        trigger windows along the path.
 *      - Filters to opportunities where the opponent actually HOLDS the
 *        relevant CC in hand (no card → no possible play → skip).
 *      - Stores the queue on `game.pendingMoveInterrupts`.
 *      - Posts the first opportunity's prompt (or runs the followup
 *        immediately if the queue is empty).
 *
 *   2. Each prompt offers two buttons to the opponent:
 *        • `move_interrupt_play_<gameId>`  — opponent intends to play.
 *          The bot logs the declaration and pauses. The opponent plays
 *          the CC through their existing hand UI; once that CC's effect
 *          resolves through the standard CC pipeline, control returns
 *          here via the Continue Move flow.
 *        • `move_interrupt_skip_<gameId>`  — opponent declines. The
 *          loop advances to the next opportunity immediately.
 *
 *   3. After the last opportunity resolves, the loop invokes the
 *      followup callback registered when the loop was started (e.g.
 *      "explode after move" for IG-11 SDP, "perform attack after move"
 *      for Final Stand) and clears `pendingMoveInterrupts`.
 *
 * The figure's actual position is updated when the loop starts (the
 * destination is committed before opportunities are processed). This
 * matches IACP semantics: "move spaces" is a single atomic move; PB/
 * DT/SD interrupt the move's logical step-by-step path, not its
 * physical position update.
 *
 * Per-ability opt-out (`opts.skipInterrupts`) and per-player SD opt-out
 * (`opts.selfDefenseInDeck[playerNum]=false`) are honored via
 * extractMoveInterruptOpportunities.
 *
 * Followup descriptors:
 *   { type: 'sdp_explode', payload: { ...sdp pending fields } }
 *
 * Add new followup types as they're wired (Final Stand attack, etc.).
 */

import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { extractMoveInterruptOpportunities } from '../game/move-interrupts.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { getCcHand } from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { parseCustomId } from '../discord/custom-id.js';
import { requireGame, requirePlayer } from '../utils/guards.js';

export const INTERRUPT_CARD_BY_TYPE = {
  PB: 'Parting Blow',
  DT: 'Dirty Trick',
  SD: 'Self-Defense',
  ST: 'Slippery Target',
};

const TRIGGER_LABEL_BY_TYPE = {
  PB: 'EXIT adjacency to BRAWLER',
  DT: 'ENTRY adjacency to SMUGGLER/HUNTER',
  SD: 'ENTRY adjacency to opponent figure',
  ST: 'ENTRY adjacency to your SMUGGLER/SPY (gain MP=Speed)',
};

/**
 * Public entry point. Computes opportunities, persists state, posts the
 * first opponent prompt (or runs the followup immediately if no
 * opportunities apply).
 *
 * @param {object} game
 * @param {object} ctx - handler context (must include client, logGameAction, saveGames)
 * @param {object} mover - { figureKey, playerNum }
 * @param {string[]} path - cell sequence [start, ..., dest]
 * @param {object} opts - { skipInterrupts?, selfDefenseInDeck? }
 * @param {object|null} followup - { type, payload } or null
 */
export async function startMoveInterruptLoop(game, ctx, mover, path, opts = {}, followup = null) {
  const mapId = game.selectedMap?.id;
  const all = extractMoveInterruptOpportunities(game, mapId, mover, path, opts);
  // Filter to opportunities where the opponent actually holds the relevant CC.
  // (No card → no possible play → no reason to prompt.)
  const filtered = all.filter((op) => {
    const oppPN = op.triggerPlayerNum;
    const card = INTERRUPT_CARD_BY_TYPE[op.type];
    if (!card) return false;
    const hand = getCcHand(game, oppPN) || [];
    return hand.some((c) => String(c).toLowerCase() === card.toLowerCase());
  });

  game.pendingMoveInterrupts = {
    mover: { figureKey: mover.figureKey, playerNum: mover.playerNum, msgId: mover.msgId || null, dcName: mover.dcName || null },
    path: [...path],
    opportunities: filtered,
    opIndex: 0,
    followup: followup || null,
  };

  if (filtered.length === 0) {
    return runMoveInterruptFollowup(game, ctx);
  }
  return postNextMoveInterruptPrompt(game, ctx);
}

async function postNextMoveInterruptPrompt(game, ctx) {
  const pending = game.pendingMoveInterrupts;
  if (!pending) return;
  if (pending.opIndex >= pending.opportunities.length) {
    return runMoveInterruptFollowup(game, ctx);
  }
  const op = pending.opportunities[pending.opIndex];
  const cardName = INTERRUPT_CARD_BY_TYPE[op.type];
  // Parting Blow: stash reacting BRAWLER + exiting hostile so the
  // partingBlowEffect resolver targets correctly when the card is played
  // from hand during the opponent's move.
  if (op.type === 'PB') {
    game.pendingPartingBlow = {
      brawlerFigureKey: op.triggerFigureKey,
      brawlerPlayerNum: op.triggerPlayerNum,
      exitingHostileFigureKey: pending.mover.figureKey,
    };
  }
  const triggerLabel = TRIGGER_LABEL_BY_TYPE[op.type] || op.type;
  const oppPN = op.triggerPlayerNum;
  const ownerId = game[`player${oppPN}Id`];
  const triggerDcName = dcNameFromFigureKey(op.triggerFigureKey);
  const stepLabel = `${pending.path[op.step]?.toUpperCase()} → ${pending.path[op.step + 1]?.toUpperCase()}`;
  const moverDcName = pending.mover.dcName || dcNameFromFigureKey(pending.mover.figureKey);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`move_interrupt_play_${game.gameId}`)
      .setLabel(`Play ${cardName}`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`move_interrupt_skip_${game.gameId}`)
      .setLabel('Skip Reaction')
      .setStyle(ButtonStyle.Secondary),
  );
  await ctx.logGameAction(
    game,
    ctx.client,
    `<@${ownerId}> ⚠️ **Move Interrupt** — step ${op.step + 1} (${stepLabel}): **${moverDcName}** triggered ${triggerLabel} for your **${triggerDcName}**. Play **${cardName}** (via your hand UI, then click Continue Move) or Skip.`,
    { components: [row], allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card' },
  );
  ctx.saveGames?.(game.gameId);
}

async function runMoveInterruptFollowup(game, ctx) {
  const pending = game.pendingMoveInterrupts;
  if (!pending) return;
  const followup = pending.followup;
  delete game.pendingMoveInterrupts;
  if (!followup) {
    ctx.saveGames?.(game.gameId);
    return;
  }
  // Followups are routed via ctx.moveInterruptFollowupHandlers, a map
  // from followup.type → async handler(game, ctx, payload). Allows
  // each consumer (SDP, Final Stand, etc.) to register its post-move
  // resolution without this module having to know about all of them.
  const handlers = ctx.moveInterruptFollowupHandlers || {};
  const handler = handlers[followup.type];
  if (typeof handler === 'function') {
    await handler(game, ctx, followup.payload || {});
  }
  ctx.saveGames?.(game.gameId);
}

/** Button handler: opponent declared they will play the reaction CC. */
export async function handleSpacesMoveInterruptPlay(interaction, ctx) {
  const { getGame, canActAsPlayer, client, logGameAction, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = parseCustomId(interaction.customId, 'move_interrupt_play_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingMoveInterrupts;
  if (!pending) {
    await interaction.followUp({ content: 'No pending move interrupt.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const op = pending.opportunities[pending.opIndex];
  if (!op) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, op.triggerPlayerNum, canActAsPlayer, 'Only the triggered player may respond.')) return;
  const cardName = INTERRUPT_CARD_BY_TYPE[op.type];
  await logGameAction(game, client, `**Move Interrupt** — opponent will play **${cardName}**. Resolve it via the hand UI, then click **Continue Move**.`, { phase: 'ROUND', icon: 'card' });
  // Replace the prompt with a Continue Move button so the opponent can
  // resume the loop after their CC resolves through the normal pipeline.
  const continueRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`move_interrupt_continue_${game.gameId}`)
      .setLabel('Continue Move')
      .setStyle(ButtonStyle.Success),
  );
  const ownerId = game[`player${op.triggerPlayerNum}Id`];
  await logGameAction(game, client, `<@${ownerId}> Click **Continue Move** when **${cardName}** has resolved.`, { components: [continueRow], allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card', interrupt: true });
  saveGames?.(game.gameId);
}

/** Button handler: opponent skipped the reaction. */
export async function handleSpacesMoveInterruptSkip(interaction, ctx) {
  const { getGame, canActAsPlayer } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = parseCustomId(interaction.customId, 'move_interrupt_skip_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingMoveInterrupts;
  if (!pending) {
    await interaction.followUp({ content: 'No pending move interrupt.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const op = pending.opportunities[pending.opIndex];
  if (!op) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, op.triggerPlayerNum, canActAsPlayer, 'Only the triggered player may respond.')) return;
  pending.opIndex += 1;
  return postNextMoveInterruptPrompt(game, ctx);
}

/** Button handler: opponent done playing their reaction; advance the loop. */
export async function handleSpacesMoveInterruptContinue(interaction, ctx) {
  const { getGame, canActAsPlayer } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = parseCustomId(interaction.customId, 'move_interrupt_continue_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingMoveInterrupts;
  if (!pending) {
    await interaction.followUp({ content: 'No pending move interrupt.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const op = pending.opportunities[pending.opIndex];
  if (!op) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, op.triggerPlayerNum, canActAsPlayer, 'Only the triggered player may respond.')) return;
  pending.opIndex += 1;
  return postNextMoveInterruptPrompt(game, ctx);
}
