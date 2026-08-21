/**
 * Granted actions — "that figure interrupts to perform an ACTION".
 *
 * alexanbv 2026-08-21:
 *   "perform an action refers to any action, including interact move attack or
 *    special action. No rest actions in skirmish."
 *   "you must do all of them. Remember that there are other possibilities for
 *    actions also include: discarding bleed / Discarding stun / Special actions
 *    from mission rules"
 * and, on the shape of the prompt:
 *   "There needs to be a menu to choose which figure is being selected and then
 *    another menu for which action that figure is doing."
 *
 * So this is the second menu: every action the grantee could legally take,
 * offered to a figure that is NOT activating.
 *
 * Note the neighbouring ruling, which is why this is separate from the
 * granted-ATTACK primitive rather than an extension of it: "when it says 'may
 * perform an attack' that is just a regular attack, and cannot be used for a
 * special attack action (ex crippling blow on rancor). If it says perform an
 * action, that is different. That may include attacks or special attack
 * actions." `granted_attack_` stays the narrow one; this is the wide one.
 *
 * ── How it works ──────────────────────────────────────────────────────────
 * Rather than re-implement move / attack / interact / every special / the
 * condition discards for the out-of-activation case, this borrows the trick
 * handleJtSpecial already uses for Jundland Terror: synthesize a minimal
 * activation context for the grantee and re-dispatch the figure's own ordinary
 * button into the standard pipeline. Every branch downstream (target pickers,
 * combat threads, Trample's multi-pick, mission-injected specials) is reused
 * untouched.
 *
 * The one thing that must NOT happen is the interrupt spending a real action or
 * taking the activation lock, so the synthesized context is stamped
 * `grantedAction: true` and consumeActionForCurrentFigure early-returns on it.
 * figureActionsRemaining reads `perFigureRemaining?.[idx] ?? 2`, which the
 * synthesized record deliberately leaves unset so the "no actions remaining"
 * gates pass.
 */
import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { requireGame } from '../utils/guards.js';

/** Grantee figure index out of "<DcName>-<dg>-<figIdx>". */
function figIdxOf(figureKey) {
  const m = String(figureKey || '').match(/-(\d+)$/);
  return m ? m[1] : '0';
}

/**
 * Every action this figure could take right now.
 *
 * This does NOT re-derive the list. getDcActionButtons in discord/components.js
 * is the one place that knows what a DC can actually do — native specials,
 * attachment-injected ones, mission-injected ones (Bomb Drop, Experimental
 * Weapons), specials REMOVED by an attachment (Driven by Hatred takes
 * Brutality), Stun blocking Move and Attack but not Interact or Specials,
 * Disabled blocking specials, and the condition-discard row. Re-deriving any of
 * that here would be a second copy of a rule that has already drifted once in
 * this codebase, so instead we render the real buttons for the grantee and
 * rewrite their custom ids to route through the granted-action flow.
 *
 * "No rest actions in skirmish" (alexanbv 2026-08-21) — there is no Rest button
 * to inherit, so nothing to exclude.
 *
 * Returns [{ key, label, style }].
 */
export function buildGrantedActionOptions(game, meta, figureKey, deps = {}) {
  const { getDcActionButtons, getDcStats, getPlayerNumForMsgId } = deps;
  if (!getDcActionButtons) return [];
  const figIdx = Number(figIdxOf(figureKey));
  // Synthesized context: no perFigureRemaining, so figureActionsRemaining
  // reports the full budget and nothing renders as "no actions left".
  const actionsData = { selectedFigure: figIdx, grantedAction: true };
  let rows = [];
  try {
    rows = getDcActionButtons(meta.msgId || deps.msgId, meta.dcName, meta.displayName || meta.dcName,
      actionsData, game, { getDcStats, getPlayerNumForMsgId }) || [];
  } catch {
    return [];
  }

  // Disable (the CC) blocks Special Actions for the round. handleDcAction is the
  // real gate and rejects the click, but the button builder does not know about
  // it, so offering a special here would just hand the player a dead button.
  const disabledFigure = !!game.disabledFigures?.includes(meta.displayName || meta.dcName);

  const out = [];
  const seen = new Set();
  for (const row of rows) {
    for (const comp of (row?.components || [])) {
      const data = comp?.data || comp;
      const id = data?.custom_id ?? data?.customId;
      if (!id || data?.disabled) continue;
      const key = grantedActionKeyFor(id);
      if (!key || seen.has(key)) continue;
      if (disabledFigure && key.startsWith('special:')) continue;
      seen.add(key);
      out.push({ key, label: String(data.label || key).slice(0, 80), style: data.style ?? ButtonStyle.Secondary });
    }
  }
  return out;
}

/** Reverse of grantedActionCustomId: ordinary DC button id -> action key, or null if unsupported. */
export function grantedActionKeyFor(customId) {
  const id = String(customId || '');
  if (/^dc_move_/.test(id)) return 'move';
  if (/^dc_attack_/.test(id)) return 'attack';
  if (/^dc_interact_/.test(id)) return 'interact';
  if (/^dc_remove_stun_/.test(id)) return 'stun';
  if (/^dc_remove_bleed_/.test(id)) return 'bleed';
  const sp = id.match(/^dc_special_(\d+)_/);
  if (sp) return `special:${sp[1]}`;
  // Everything else on the DC row (heroic attack, CC specials, figure picks,
  // end-activation, MP spend) is either not an ACTION or has its own economy.
  return null;
}

/** Map an option key to the ordinary DC button it re-dispatches into. */
export function grantedActionCustomId(key, msgId, figIdx) {
  if (key === 'move') return { id: `dc_move_${msgId}_f${figIdx}`, buttonKey: 'dc_move_' };
  if (key === 'attack') return { id: `dc_attack_${msgId}_f${figIdx}`, buttonKey: 'dc_attack_' };
  if (key === 'interact') return { id: `dc_interact_${msgId}_f${figIdx}`, buttonKey: 'dc_interact_' };
  if (key === 'stun') return { id: `dc_remove_stun_${msgId}_f${figIdx}`, buttonKey: 'dc_remove_stun_' };
  if (key === 'bleed') return { id: `dc_remove_bleed_${msgId}_f${figIdx}`, buttonKey: 'dc_remove_bleed_' };
  const sp = String(key).match(/^special:(\d+)$/);
  if (sp) return { id: `dc_special_${sp[1]}_${msgId}`, buttonKey: 'dc_special_' };
  return null;
}

/**
 * Post the action menu for a granted action. Buttons are chunked across rows
 * (Discord allows 5 per row, 5 rows), and the list is truncated at 25 with a
 * note rather than silently dropped.
 *
 * @param {object} opts - { granteeMsgId, granteeFigureKey, granteeName, sourceLabel, playerNum, threadId? }
 */
export async function postGrantedActionMenu(game, ctx, opts) {
  const { client, logGameAction, dcMessageMeta } = ctx;
  const { granteeMsgId, granteeFigureKey, sourceLabel, playerNum } = opts;
  const meta = dcMessageMeta?.get(granteeMsgId);
  if (!meta) return;
  const granteeName = opts.granteeName || dcNameFromFigureKey(granteeFigureKey) || meta.dcName;
  const figIdx = figIdxOf(granteeFigureKey);
  // Imported rather than taken off ctx: applyAbilityResult's ctx does not carry
  // these, and a silently-defaulted getDcStats would render an empty menu.
  const { getDcActionButtons } = await import('../discord/components.js');
  const { getDcStats } = await import('../data-loader.js');
  const { getPlayerId } = await import('../game/player-helpers.js');
  const _pn = playerNum ?? meta.playerNum;
  const options = buildGrantedActionOptions(game, meta, granteeFigureKey, {
    getDcActionButtons, getDcStats, getPlayerNumForMsgId: () => _pn, msgId: granteeMsgId,
  });
  if (!options.length) return;

  const MAX = 25;
  const shown = options.slice(0, MAX);
  const rows = [];
  for (let i = 0; i < shown.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      ...shown.slice(i, i + 5).map((o) => new ButtonBuilder()
        .setCustomId(`granted_do_${game.gameId}_${granteeMsgId}_f${figIdx}_${o.key}`)
        .setLabel(o.label)
        .setStyle(o.style)),
    ));
  }
  const ownerId = getPlayerId(game, _pn);
  const dropped = options.length - shown.length;
  const content = `${ownerId ? `<@${ownerId}> ` : ''}\u{26A1} **${sourceLabel || 'Granted action'}** — **${granteeName}** interrupts to perform an action. Choose which:`
    + (dropped > 0 ? `\n_(${dropped} further option(s) not shown — Discord caps this at ${MAX} buttons.)_` : '');
  await logGameAction?.(game, client, content, {
    components: rows,
    ...(ownerId ? { allowedMentions: { users: [ownerId] } } : {}),
    phase: 'ROUND',
    icon: 'card',
    interrupt: true,
  });
}

/**
 * granted_do_<gameId>_<msgId>_f<figIdx>_<actionKey>
 *
 * Synthesizes the out-of-activation context and re-dispatches into the ordinary
 * handler for the chosen action.
 */
export async function handleGrantedActionDo(interaction, ctx) {
  const { getGame, dcMessageMeta } = ctx;
  const m = interaction.customId.match(/^granted_do_(.+)_f(\d+)_(.+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid granted-action button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, suffix, figIdxStr, actionKey] = m;
  // suffix = <gameId>_<msgId>; gameIds do not contain `_`, so split on the first.
  const u = suffix.indexOf('_');
  if (u < 0) {
    await interaction.followUp({ content: 'Invalid granted-action button (malformed id).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = suffix.slice(0, u);
  const msgId = suffix.slice(u + 1);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta?.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const target = grantedActionCustomId(actionKey, msgId, figIdxStr);
  if (!target) {
    await interaction.followUp({ content: 'Unknown granted action.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const dgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const figureKey = `${meta.dcName}-${dgIdx}-${figIdxStr}`;

  // Minimal out-of-activation context. grantedAction makes the action free AND
  // keeps consumeActionForCurrentFigure from taking the activation lock.
  game.dcActionsData = game.dcActionsData || {};
  if (!game.dcActionsData[msgId]) {
    game.dcActionsData[msgId] = { selectedFigure: Number(figIdxStr), grantedAction: true };
  } else {
    game.dcActionsData[msgId].selectedFigure = Number(figIdxStr);
    game.dcActionsData[msgId].grantedAction = true;
  }
  // Attack additionally needs the free-attack marker: handleDcAction zeroes the
  // action cost off it, and combat.js reads it to know the attack is free.
  if (actionKey === 'attack') {
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[figureKey] = { from: 'granted action' };
  }

  const { handleDcAction, handleDcRemoveStun, handleDcRemoveBleed } = await import('./dc-play-area.js');
  try {
    Object.defineProperty(interaction, 'customId', { value: target.id, writable: true, configurable: true });
  } catch {
    interaction.customId = target.id;
  }
  if (target.buttonKey === 'dc_remove_stun_') return handleDcRemoveStun(interaction, ctx);
  if (target.buttonKey === 'dc_remove_bleed_') return handleDcRemoveBleed(interaction, ctx);
  return handleDcAction(interaction, ctx, target.buttonKey);
}
