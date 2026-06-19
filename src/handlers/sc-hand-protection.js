/**
 * [Smuggling Compartment] hand-protection — a reusable hook for any ability that
 * affects an opponent's Command-card hand.
 *
 * The card lets its owner, "before your opponent resolves a Command card or
 * ability," exhaust to set aside any number of CCs from hand (returned at the
 * start of their next activation or the next phase). Different hand-affecting
 * abilities resolve in different pipelines, so each call site:
 *   1. calls offerScSetAside(...) before resolving; if it returns true, the site
 *      defers and stores its own continuation,
 *   2. on the owner's response (a `${idPrefix}_open_/skip_/confirm_` button or
 *      select), applies the set-aside via applyScSetAside and resumes.
 *
 * Wired so far: Agent Blaise's Interrogate surge (post-combat) and [Headhunter]
 * (strain pipeline). alexanbv 2026-06-17: "needs to also fire before headhunter,
 * and other abilities that affect the hand of CCs."
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { getPlayerId, getHandChannelId, getDcList, getDcMessageIds, ccHandKey } from '../game/player-helpers.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { exhaustAttachment } from '../game/card-state-helpers.js';
import { discordCatch } from '../error-handling.js';
import { findSmugglingCompartmentMsgId, setAsideFromHand, scReactionAvailable } from '../game/smuggling-compartment.js';

// scReactionAvailable now lives in the game layer (game/smuggling-compartment.js)
// so the ability engine can call it too; re-exported here for existing importers.
export { scReactionAvailable };

/**
 * Offer the set-aside reaction privately in the owner's hand channel.
 * Returns true if the offer was posted (caller should defer and store its
 * continuation), false otherwise (caller proceeds normally).
 * Produces buttons `${idPrefix}_open_${gameId}_${ownerNum}` and `${idPrefix}_skip_...`.
 */
export async function offerScSetAside(game, ownerNum, client, { idPrefix, promptText }) {
  if (!scReactionAvailable(game, ownerNum)) return false;
  const handChId = getHandChannelId(game, ownerNum);
  if (!handChId) return false;
  try {
    const ch = await fetchGameChannel(client, handChId);
    if (!ch) return false;
    const ownerId = getPlayerId(game, ownerNum);
    await ch.send(sanitizeMentions({
      content: promptText,
      allowedMentions: { users: [ownerId] },
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${idPrefix}_open_${game.gameId}_${ownerNum}`).setLabel('Set aside CCs (Smuggling Compartment)').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${idPrefix}_skip_${game.gameId}_${ownerNum}`).setLabel('No').setStyle(ButtonStyle.Secondary),
      )],
    })).catch(discordCatch);
    return true;
  } catch (err) {
    console.error('offerScSetAside error:', err);
    return false;
  }
}

/** Build the hand multi-select row (deduped) for the set-aside picker. */
export function scSetAsideSelectRow(hand, confirmCustomId) {
  const seen = new Set();
  const opts = [];
  for (const c of (hand || [])) {
    if (seen.has(c)) continue;
    seen.add(c);
    opts.push(new StringSelectMenuOptionBuilder().setLabel(c.slice(0, 100)).setValue(c));
    if (opts.length >= 25) break;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(confirmCustomId)
    .setPlaceholder('Choose Command cards to set aside')
    .setMinValues(1)
    .setMaxValues(Math.max(1, opts.length))
    .addOptions(opts);
  return new ActionRowBuilder().addComponents(select);
}

/**
 * Apply the set-aside: move chosen cards out of hand, exhaust the card, and
 * stock the return pile (released at the owner's next activation / next phase
 * by the existing release trigger). Returns the number of cards set aside.
 */
export function applyScSetAside(game, ownerNum, chosenCards) {
  const handKey = ccHandKey(ownerNum);
  const { hand, setAside } = setAsideFromHand(game[handKey] || [], chosenCards);
  if (setAside.length === 0) return 0;
  const mid = findSmugglingCompartmentMsgId(getDcList(game, ownerNum), getDcMessageIds(game, ownerNum));
  if (mid) exhaustAttachment(game, mid, 'Smuggling Compartment');
  game[handKey] = hand;
  game.smugglingCompartmentSetAside = game.smugglingCompartmentSetAside || {};
  game.smugglingCompartmentSetAside[ownerNum] = [...(game.smugglingCompartmentSetAside[ownerNum] || []), ...setAside];
  return setAside.length;
}
