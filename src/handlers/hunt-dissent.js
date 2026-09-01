/**
 * Hunt Dissent (Agent Kallus): when your opponent plays a Command
 * card for the FIRST TIME each round, post Kallus's controller a
 * "distribute 2 Damage Tokens" picker over friendly figures within 1
 * space (within 3 if [Advanced Com Systems] is attached to Kallus).
 * Limit once per round (the once-per-round gate fires on the FIRST
 * opponent CC of the round; subsequent CCs do not re-prompt).
 *
 * Trigger entry: fireHuntDissentIfFirstCcOfRound(game, ccPlayerNum, ctx)
 *   Called from cc-hand.js at the end of each CC-play resolution.
 *
 * Round-state field: game.huntDissentResolvedThisRound[kallusPN] = true
 *   when the trigger has already fired for that Kallus this round.
 *   Reset at start of round via the standard round-cleanup registry.
 *
 * Pending picker state: game.pendingHuntDissent = {
 *   kallusPn, kallusMsgId, remaining, distributed: [], validKeys
 * }
 *
 * Handler: handleHuntDissentPick — `hunt_dissent_pick_<gameId>_<figureKey|done>`.
 *   Each click grants 1 Damage Token to the picked figure and decrements
 *   `remaining`. When remaining hits 0 (or the player picks Done), state
 *   clears.
 */
import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getDcEffects } from '../data-loader.js';
import { dcNameFromFigureKey, grantPowerTokens } from '../game/index.js';
import { getPlayerId } from '../game/player-helpers.js';
import { countGameSpaces } from '../game/board-helpers.js';
import { cardNameIncludes } from '../game/card-names.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { parseCustomId } from '../discord/custom-id.js';

import { getDcEffect } from '../game/dc-helpers.js';
const HUNT_DISSENT_TOTAL = 2;

/**
 * Locate Kallus on the given side along with his msgId. Returns
 * { figureKey, msgId, kallusPn } or null. Skips if Kallus is defeated
 * or if the hunt_dissent_kallus passive isn't on his DC.
 */
function _locateKallus(game, kallusPn, dcMessageMeta) {
  const positions = game.figurePositions?.[kallusPn] || {};
  for (const [fk, pos] of Object.entries(positions)) {
    if (!pos) continue;
    const dcName = dcNameFromFigureKey(fk);
    const eff = getDcEffect(dcName);
    const sIds = eff?.specialAbilityIds || [];
    if (!sIds.includes('hunt_dissent_kallus')) continue;
    let msgId = null;
    if (dcMessageMeta) {
      for (const [mid, meta] of dcMessageMeta) {
        if (meta?.gameId !== game.gameId) continue;
        if (meta.playerNum === kallusPn && meta.dcName === dcName) {
          msgId = mid;
          break;
        }
      }
    }
    return { figureKey: fk, msgId, kallusPn, kallusPos: pos };
  }
  return null;
}

/**
 * Range = 1 (within 1 space). Extended to 3 when [Advanced Com Systems]
 * is attached to Kallus's DC.
 */
function _rangeForKallus(game, kallusMsgId) {
  if (!kallusMsgId) return 1;
  const atts = game.p1DcAttachments?.[kallusMsgId] || game.p2DcAttachments?.[kallusMsgId] || [];
  return cardNameIncludes(atts, 'Advanced Com Systems') ? 3 : 1;
}

/**
 * Called at the end of each CC-play resolution. Detects whether this
 * was the FIRST CC of the round from `ccPlayerNum`'s perspective for
 * the OPPOSING Kallus controller. If so, posts the distribution
 * picker.
 */
export async function fireHuntDissentIfFirstCcOfRound(game, ccPlayerNum, ctx) {
  if (!game || !ccPlayerNum) return;
  const kallusPn = ccPlayerNum === 1 ? 2 : 1;
  const dcMessageMeta = ctx?.dcMessageMeta;
  const kallus = _locateKallus(game, kallusPn, dcMessageMeta);
  if (!kallus) return;
  // Once-per-round gate.
  game.huntDissentResolvedThisRound = game.huntDissentResolvedThisRound || {};
  if (game.huntDissentResolvedThisRound[kallusPn]) return;
  game.huntDissentResolvedThisRound[kallusPn] = true;
  // Compute valid recipients: friendly figures within range of Kallus.
  const range = _rangeForKallus(game, kallus.msgId);
  const validKeys = [];
  const validLabels = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[kallusPn] || {})) {
    if (!pos) continue;
    if (countGameSpaces(game, kallus.kallusPos, pos) > range) continue;
    validKeys.push(fk);
    validLabels.push(dcNameFromFigureKey(fk));
  }
  if (validKeys.length === 0) {
    // Range gate triggers but no recipients. Effect fizzles silently;
    // mark resolved so it doesn't try again later this round.
    return;
  }
  game.pendingHuntDissent = {
    kallusPn,
    kallusMsgId: kallus.msgId,
    range,
    remaining: HUNT_DISSENT_TOTAL,
    distributed: [],
    validKeys,
  };
  await _postHuntDissentPicker(game, ctx);
}

async function _postHuntDissentPicker(game, ctx) {
  const pending = game.pendingHuntDissent;
  if (!pending) return;
  const { client, logGameAction } = ctx || {};
  const ownerId = getPlayerId(game, pending.kallusPn);
  const remaining = pending.remaining;
  const btns = pending.validKeys.slice(0, 20).map(fk => new ButtonBuilder()
    .setCustomId(`hunt_dissent_pick_${game.gameId}_${fk}`)
    .setLabel(dcNameFromFigureKey(fk).slice(0, 80))
    .setStyle(ButtonStyle.Primary));
  btns.push(new ButtonBuilder()
    .setCustomId(`hunt_dissent_pick_${game.gameId}_done`)
    .setLabel(`Done (${remaining} unspent)`)
    .setStyle(ButtonStyle.Secondary));
  const rows = chunkButtonsToRows(btns).slice(0, 5);
  const content = `<@${ownerId}> 🛡️ **Hunt Dissent** — Opponent played their first Command card. Distribute up to **2 Damage Tokens** among friendly figures within **${pending.range}** space${pending.range === 1 ? '' : 's'} of Agent Kallus (${remaining} remaining):`;
  await logGameAction?.(game, client, content, { components: rows, allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card', interrupt: true });
}

/**
 * Button handler: hunt_dissent_pick_<gameId>_<figureKey|done>.
 */
export async function handleHuntDissentPick(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'hunt_dissent_pick_');
  const firstUs = suffix.indexOf('_');
  const gameId = firstUs >= 0 ? suffix.slice(0, firstUs) : suffix;
  const target = firstUs >= 0 ? suffix.slice(firstUs + 1) : '';
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingHuntDissent;
  if (!pending) {
    await interaction.followUp({ content: '**Hunt Dissent** — no pending distribution.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.kallusPn, canActAsPlayer, "Only Kallus's controller may distribute.")) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  if (target === 'done' || pending.remaining <= 0) {
    delete game.pendingHuntDissent;
    await logGameAction?.(game, client, `🛡️ **Hunt Dissent** — distribution complete (${pending.distributed.length} of ${HUNT_DISSENT_TOTAL} token${pending.distributed.length === 1 ? '' : 's'} placed).`, { phase: 'ROUND', icon: 'card' });
    saveGames(game.gameId);
    return;
  }
  // Validate target.
  if (!pending.validKeys.includes(target)) {
    await interaction.followUp({ content: 'Invalid recipient.', ephemeral: true }).catch(discordCatch);
    return;
  }
  grantPowerTokens(game, target, 'Damage', 1);
  pending.distributed.push(target);
  pending.remaining -= 1;
  await logGameAction?.(game, client, `🛡️ **Hunt Dissent** — **${dcNameFromFigureKey(target)}** gains 1 Damage Token (${pending.remaining} remaining).`, { phase: 'ROUND', icon: 'card' });
  if (pending.remaining <= 0) {
    delete game.pendingHuntDissent;
    saveGames(game.gameId);
    return;
  }
  await _postHuntDissentPicker(game, ctx);
  saveGames(game.gameId);
}
