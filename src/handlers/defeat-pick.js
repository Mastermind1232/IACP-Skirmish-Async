/**
 * Player-pick prompts for "when defeated" abilities that require the
 * controlling player to choose a target: Into the Force (focus a
 * friendly), Useful Hide (distribute Evade tokens), Brutal Tactics
 * (Weaken a hostile within 3).
 *
 * Each prompt sets `game.pendingDefeatPick` and posts a button row in
 * the combat thread. Buttons carry the pick index. The handler reads
 * the pending state, applies the effect, optionally re-prompts (Useful
 * Hide distributes up to 2), and clears the state.
 *
 * customId pattern:
 *   defeat_pick_${gameId}_${kind}_${idx}
 *   defeat_pick_skip_${gameId}_${kind}     (Useful Hide / Brutal Tactics
 *                                          may decline remaining picks)
 */

import { applyCondition, isConditionImmune } from '../game/conditions.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { grantPowerTokens } from '../game/game-helpers.js';
import { setPendingDefeatPick, clearPendingDefeatPick } from '../game/interrupts.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { splitCustomId } from '../discord/custom-id.js';

const KIND_LABEL = {
  itf: 'Into the Force',
  uh: 'Useful Hide',
  bt: 'Brutal Tactics',
};

function pickPlayerForKind(kind, opts) {
  // Who clicks the buttons? ItF/UH = the defeated figure's owner.
  // BT = the side that has Saw on board (= opposite of defeated owner).
  const defOwner = opts.controllerPlayerNum;
  if (!defOwner) return null;
  if (kind === 'bt') return defOwner === 1 ? 2 : 1;
  return defOwner;
}

/**
 * Build a button row for the current pick state and post it to the
 * thread. Caller is responsible for setting the pending state first.
 */
async function postPickPrompt(game, ctx, payload) {
  const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
  const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
  const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
  const thread = ctx?.thread ?? ctx?.channel;
  if (!ButtonBuilder || !ButtonStyle || !ActionRowBuilder || !thread?.send) return false;
  const deps = { ButtonBuilder, ButtonStyle, ActionRowBuilder };
  const { kind, options, alreadyPicked = [], remaining } = payload;
  const remainingOptions = options.filter(o => !alreadyPicked.includes(o.figureKey));
  if (remainingOptions.length === 0) return false;

  const buttons = remainingOptions.slice(0, 4).map((opt, i) => {
    const idx = options.findIndex(o => o.figureKey === opt.figureKey);
    return new deps.ButtonBuilder()
      .setCustomId(`defeat_pick_${game.gameId}_${kind}_${idx}`)
      .setLabel(opt.label.length > 40 ? opt.label.slice(0, 37) + '...' : opt.label)
      .setStyle(deps.ButtonStyle.Primary);
  });
  // Skip button only useful when picking is optional or distribution
  // has already started (Useful Hide partial).
  if (kind === 'bt' || (kind === 'uh' && (alreadyPicked.length > 0 || remainingOptions.length > 0))) {
    buttons.push(
      new deps.ButtonBuilder()
        .setCustomId(`defeat_pick_skip_${game.gameId}_${kind}`)
        .setLabel(kind === 'bt' ? 'No Target' : (alreadyPicked.length > 0 ? 'Done' : 'Skip'))
        .setStyle(deps.ButtonStyle.Secondary),
    );
  }

  const label = KIND_LABEL[kind] || 'Defeat Pick';
  const tail = (kind === 'uh' && typeof remaining === 'number')
    ? ` (${remaining} Evade Token${remaining !== 1 ? 's' : ''} remaining)`
    : '';
  const verb = kind === 'itf' ? 'Choose a friendly figure to **Focus**'
    : kind === 'uh' ? 'Choose a friendly figure to receive **1 Evade Token**'
    : 'Choose a hostile figure to **Weaken**';
  await thread.send({
    content: `**${label}** — ${verb}${tail}:`,
    components: [new deps.ActionRowBuilder().addComponents(buttons)],
  }).catch(() => {});
  return true;
}

/**
 * Open a Defeat Pick prompt for the given kind. Called from the
 * damage pipeline's WHEN_DEFEATED hooks. Returns true if a prompt was
 * posted, false otherwise (caller may fall back to auto-apply).
 */
export async function openDefeatPick(game, ctx, { kind, controllerPlayerNum, defeatedFigureKey, options, remaining }) {
  if (!options || options.length === 0) return false;
  const choosingPlayerNum = pickPlayerForKind(kind, { controllerPlayerNum });
  if (!choosingPlayerNum) return false;
  const payload = {
    gameId: game.gameId,
    kind,
    choosingPlayerNum,
    controllerPlayerNum,
    defeatedFigureKey,
    options: options.map(o => ({ figureKey: o.figureKey, label: o.label })),
    alreadyPicked: [],
    ...(typeof remaining === 'number' ? { remaining } : {}),
  };
  setPendingDefeatPick(game, payload);
  const ok = await postPickPrompt(game, ctx, payload);
  if (!ok) {
    // Couldn't post — clear pending so the game doesn't hang.
    clearPendingDefeatPick(game);
    return false;
  }
  return true;
}

/**
 * Apply the picked target's effect for a given kind.
 */
async function applyPick(game, ctx, kind, target) {
  if (kind === 'itf') {
    if (applyCondition(game, target, 'Focus')) {
      const tName = dcNameFromFigureKey(target);
      if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
        await ctx.logGameAction(game, ctx.client, `✨ **Into the Force** — **${tName}** becomes **Focused**.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
    }
    return { repeatable: false };
  }
  if (kind === 'uh') {
    const granted = grantPowerTokens(game, target, 'Evade', 1, 2);
    if (granted > 0 && typeof ctx?.logGameAction === 'function' && ctx?.client) {
      const tName = dcNameFromFigureKey(target);
      await ctx.logGameAction(game, ctx.client, `🎭 **Useful Hide** — **${tName}** gains 1 **Evade Token**.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
    return { repeatable: true };
  }
  if (kind === 'bt') {
    if (isConditionImmune(game, target)) {
      if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
        await ctx.logGameAction(game, ctx.client, `⚔️ **Brutal Tactics** — chosen target is immune to conditions; nothing applied.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
    } else if (applyCondition(game, target, 'Weaken')) {
      const tName = dcNameFromFigureKey(target);
      if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
        await ctx.logGameAction(game, ctx.client, `⚔️ **Brutal Tactics** — **${tName}** becomes **Weakened**.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
    }
    return { repeatable: false };
  }
  return { repeatable: false };
}

export async function handleDefeatPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const isSkip = interaction.customId.startsWith('defeat_pick_skip_');
  const prefix = isSkip ? 'defeat_pick_skip_' : 'defeat_pick_';
  const parts = splitCustomId(interaction.customId, prefix);
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingDefeatPick;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending defeat pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // requirePlayer signature is (interaction, game, userId, playerNum,
  // canActAsPlayer, message). The previous call passed canActAsPlayer in the
  // `game` slot and omitted the function arg entirely, so the guard threw
  // "canActAsPlayer is not a function" — every defeat-pick (Useful Hide, Into
  // the Force, Brutal Tactics) crashed on the player check.
  const ok = await requirePlayer(interaction, game, interaction.user.id, pending.choosingPlayerNum, canActAsPlayer, 'Only the choosing player may pick.');
  if (!ok) return;

  const kind = parts[1];
  if (kind !== pending.kind) {
    await interaction.followUp({ content: 'Mismatched defeat pick kind.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const fetchOpts = {
    ButtonBuilder: ctx.ButtonBuilder,
    ButtonStyle: ctx.ButtonStyle,
    ActionRowBuilder: ctx.ActionRowBuilder,
    channel: interaction.channel,
    client,
    logGameAction,
  };

  if (isSkip) {
    clearPendingDefeatPick(game);
    await interaction.update({ components: [] }).catch(() => {});
    if (typeof logGameAction === 'function' && client) {
      const label = KIND_LABEL[kind] || 'Defeat Pick';
      await logGameAction(game, client, `**${label}** — pick skipped.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
    if (typeof saveGames === 'function') await saveGames(gameId);
    return;
  }

  const idx = parseInt(parts[2], 10);
  const opt = pending.options?.[idx];
  if (!opt) {
    await interaction.followUp({ content: 'Invalid defeat pick option.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.update({ components: [] }).catch(() => {});

  const { repeatable } = await applyPick(game, fetchOpts, kind, opt.figureKey);

  // Useful Hide: re-prompt for second pick if remaining > 1 and options left.
  const newAlreadyPicked = [...(pending.alreadyPicked || []), opt.figureKey];
  const newRemaining = typeof pending.remaining === 'number' ? pending.remaining - 1 : 0;
  const optionsLeft = (pending.options || []).filter(o => !newAlreadyPicked.includes(o.figureKey));
  if (repeatable && newRemaining > 0 && optionsLeft.length > 0) {
    const nextPayload = { ...pending, alreadyPicked: newAlreadyPicked, remaining: newRemaining };
    setPendingDefeatPick(game, nextPayload);
    await postPickPrompt(game, fetchOpts, nextPayload);
  } else {
    clearPendingDefeatPick(game);
  }
  if (typeof saveGames === 'function') await saveGames(gameId);
}
