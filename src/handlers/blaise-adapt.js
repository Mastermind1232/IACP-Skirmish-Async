/**
 * Adapt (Agent Blaise): "The first time your opponent plays a Command
 * card each round, choose 1 SPY or TROOPER. That figure becomes Hidden."
 *
 * Mirrors the Hunt Dissent (Agent Kallus) pattern. Per alexanbv 2026-06-13.
 *
 * Trigger entry: fireAdaptBlaiseIfFirstCcOfRound(game, ccPlayerNum, ctx)
 *   Called from cc-hand.js alongside Hunt Dissent at the end of each
 *   CC-play resolution.
 *
 * Round gate: game.adaptBlaiseResolvedThisRound[blaisePN] = true once the
 *   trigger has fired for that Blaise this round (reset via round cleanup).
 *
 * Pending picker state: game.pendingAdaptBlaise = { blaisePn, validKeys }.
 * Handler: handleAdaptBlaisePick — `adapt_blaise_pick_<gameId>_<figureKey|skip>`.
 */
import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getDcEffects } from '../data-loader.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { applyCondition } from '../game/conditions.js';
import { getPlayerId } from '../game/player-helpers.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { parseCustomId } from '../discord/custom-id.js';

const ADAPT_KEYWORDS = new Set(['SPY', 'TROOPER']);

/** True if the figure's DC has the SPY or TROOPER keyword. */
function _isSpyOrTrooper(dcName) {
  const kws = getDcEffects()?.[dcName]?.keywords || [];
  return kws.some((k) => ADAPT_KEYWORDS.has(String(k).toUpperCase()));
}

/** Find a non-defeated Agent Blaise (adapt_blaise) on the given side. */
function _hasBlaise(game, blaisePn) {
  const positions = game.figurePositions?.[blaisePn] || {};
  for (const [fk, pos] of Object.entries(positions)) {
    if (!pos) continue;
    const eff = getDcEffects()?.[dcNameFromFigureKey(fk)];
    if ((eff?.specialAbilityIds || []).includes('adapt_blaise')) return true;
  }
  return false;
}

/**
 * Called at the end of each CC-play resolution. If this is the FIRST CC
 * of the round from ccPlayerNum and the opponent controls Agent Blaise,
 * post Blaise's controller a "choose a SPY/TROOPER to become Hidden" picker.
 */
export async function fireAdaptBlaiseIfFirstCcOfRound(game, ccPlayerNum, ctx) {
  if (!game || !ccPlayerNum) return;
  const blaisePn = ccPlayerNum === 1 ? 2 : 1;
  if (!_hasBlaise(game, blaisePn)) return;
  game.adaptBlaiseResolvedThisRound = game.adaptBlaiseResolvedThisRound || {};
  if (game.adaptBlaiseResolvedThisRound[blaisePn]) return;
  game.adaptBlaiseResolvedThisRound[blaisePn] = true;
  // Eligible: friendly SPY or TROOPER figures.
  const validKeys = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[blaisePn] || {})) {
    if (!pos) continue;
    if (_isSpyOrTrooper(dcNameFromFigureKey(fk))) validKeys.push(fk);
  }
  if (validKeys.length === 0) return; // nothing eligible; fizzle (gate already set)
  game.pendingAdaptBlaise = { blaisePn, validKeys };
  await _postAdaptPicker(game, ctx);
}

async function _postAdaptPicker(game, ctx) {
  const pending = game.pendingAdaptBlaise;
  if (!pending) return;
  const { client, logGameAction } = ctx || {};
  const ownerId = getPlayerId(game, pending.blaisePn);
  const btns = pending.validKeys.slice(0, 20).map((fk) => new ButtonBuilder()
    .setCustomId(`adapt_blaise_pick_${game.gameId}_${fk}`)
    .setLabel(dcNameFromFigureKey(fk).slice(0, 80))
    .setStyle(ButtonStyle.Primary));
  btns.push(new ButtonBuilder()
    .setCustomId(`adapt_blaise_pick_${game.gameId}_skip`)
    .setLabel('Skip')
    .setStyle(ButtonStyle.Secondary));
  const rows = chunkButtonsToRows(btns).slice(0, 5);
  const content = `<@${ownerId}> 🕵️ **Adapt** (Agent Blaise) — Opponent played their first Command card. Choose a friendly **SPY or TROOPER** to become **Hidden**:`;
  await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card', interrupt: true });
}

/** Button handler: adapt_blaise_pick_<gameId>_<figureKey|skip>. */
export async function handleAdaptBlaisePick(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'adapt_blaise_pick_');
  const firstUs = suffix.indexOf('_');
  const gameId = firstUs >= 0 ? suffix.slice(0, firstUs) : suffix;
  const target = firstUs >= 0 ? suffix.slice(firstUs + 1) : '';
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingAdaptBlaise;
  if (!pending) {
    await interaction.followUp({ content: '**Adapt** — no pending choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.blaisePn, canActAsPlayer, "Only Blaise's controller may choose.")) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  if (target === 'skip' || !pending.validKeys.includes(target)) {
    delete game.pendingAdaptBlaise;
    await logGameAction?.(game, client, `🕵️ **Adapt** — no figure chosen.`, { phase: 'ROUND', icon: 'card' });
    saveGames(game.gameId);
    return;
  }
  applyCondition(game, target, 'Hide');
  delete game.pendingAdaptBlaise;
  await logGameAction?.(game, client, `🕵️ **Adapt** — **${dcNameFromFigureKey(target)}** becomes **Hidden**.`, { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId);
}
