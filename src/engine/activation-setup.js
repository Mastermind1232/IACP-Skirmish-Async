/**
 * Single-source-of-truth orchestrator for DC activation.
 *
 * All three activation entry points (handleDcActivate, handleDcToggle,
 * handleConfirmActivate) funnel here after their caller-specific guards pass.
 * Every start-of-activation passive, interrupt, state mutation, thread
 * creation, and log message lives in this one function.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ThreadAutoArchiveDuration, AttachmentBuilder } from 'discord.js';
import { getDcEffects, getDcStats as _getDcStats, getMapData as _getMapData, getFigureSize, getLoadoutCards, getFormCards, getRootDir } from '../data-loader.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getPlayAreaId,
  getActivationsRemaining, setActivationsRemaining,
  getActivatedDcIndices, setActivatedDcIndices,
  getCcHand, opponentPlayerNum,
  ccDeckKey, ccHandKey,
} from '../game/player-helpers.js';
import { countGameSpaces } from '../game/board-helpers.js';
import { awrRange, enumerateAwrTargets } from '../game/awr-helpers.js';
import { detectDroidKitTrigger } from '../game/droid-kit-helpers.js';
import { hasFigureLineOfSight, getFigureFootprint, getAllFigureFootprints } from '../game/spatial.js';
import { getFootprintCells } from '../game/coords.js';
import { applyCondition, filterCondition, dcNameFromFigureKey, parseFigureKey, grantPowerTokens, grantMovementBank, figureChoiceLabels, isCompanionHostDefeated, reduceHp } from '../game/index.js';
import { cardNameIncludes } from '../game/card-names.js';
import { getPlayableReactionCardsForTiming } from '../game/cc-timing.js';
import { getConfig } from '../game/figure-config.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { chunkButtonsToRows, truncateLabel } from '../discord/components.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { sendPowerTokenOverflowUI } from '../handlers/combat.js';
import { applyStartOfActivationEffects } from './activation-effects.js';
import { setPendingTokenDistribution, setPendingGeneralsOrders, setPendingConspire, setPendingStillFaster } from '../game/interrupts.js';
import { join } from 'path';

// ─── Companion helpers (used by activation.js too) ───────────────────────────

/**
 * Determine the companion (if any) for a given DC, considering both
 * direct companion fields and attachment-based companions.
 * Returns { companionName, companionStats, isCoActivation } or null.
 */
export function getCompanionForDc(dcName, attachments) {
  const eff = getDcEffects();
  if (!eff) return null;
  const dcData = eff[dcName];
  if (!dcData) return null;
  if (typeof dcData.companion === 'string') {
    const companionName = dcData.companion;
    const companionStats = eff[companionName];
    if (!companionStats) return null;
    const isCoActivation = companionName === 'Junk Droid';
    return { companionName, companionStats, isCoActivation };
  }
  if (attachments?.length) {
    for (const attName of attachments) {
      const attData = eff[attName] || eff[`[${attName}]`];
      if (attData && typeof attData.companion === 'string') {
        const companionName = attData.companion;
        const companionStats = eff[companionName];
        if (!companionStats) continue;
        return { companionName, companionStats, isCoActivation: false };
      }
    }
  }
  return null;
}

/** Build a summary string for a companion's stats. */
export function formatCompanionStats(name, stats) {
  const parts = [`**${name}**`];
  if (stats.health) parts.push(`Health ${stats.health}`);
  if (stats.speed) parts.push(`Speed ${stats.speed}`);
  if (stats.attack) {
    const dice = (stats.attack.dice || []).join(', ');
    parts.push(`${stats.attack.type === 'melee' ? 'Melee' : 'Ranged'} (${dice})`);
  }
  if (stats.defense?.length) parts.push(`Defense: ${stats.defense.join(', ')}`);
  if (stats.passives?.length) parts.push(stats.passives.join(', '));
  if (stats.surgeAbilities?.length) parts.push(`Surges: ${stats.surgeAbilities.join('; ')}`);
  const specials = stats.specials?.length ? `\nSpecials: ${stats.specials.join(', ')}` : '';
  const abilitySnippet = stats.abilityText ? `\n${stats.abilityText.split('\n').slice(0, 2).join(' | ')}` : '';
  return parts.join(' | ') + specials + abilitySnippet;
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

/**
 * Finalize a DC activation after all pre-activation guards have passed.
 *
 * @param {object} params
 * @param {object} params.game
 * @param {string} params.gameId
 * @param {number} params.playerNum
 * @param {number} params.dcIndex - index in dcList
 * @param {string} params.dcName
 * @param {string} params.displayName
 * @param {string} params.msgId - DC message ID
 * @param {string} params.ownerId - player's Discord user ID
 * @param {object} params.dcMessage - Discord message to start thread on
 * @param {Function|null} params.pushUndo - undo function or null
 * @param {object|null} params.confirmationMessage - message to clear components on (Path 3)
 * @param {string|null} params.activateCardMsgId - for updating "Activate a DC" card
 * @param {Function|null} params.editActivateReplyFn - for updating activate buttons (Path 1)
 * @param {object} params.deps - runtime ctx deps
 */
export async function finalizeActivation({
  game, gameId, playerNum, dcIndex, dcName, displayName, msgId, ownerId,
  dcMessage,
  pushUndo = null,
  confirmationMessage = null,
  activateCardMsgId = null,
  editActivateReplyFn = null,
  deps,
}) {
  const {
    dcExhaustedState, dcHealthState, dcMessageMeta,
    renderDcEmbed, getDcPlayAreaComponents,
    updateActivationsMessage, getActionsCounterContent,
    getDcActionButtons, getActivationMinimapAttachment,
    getActivateDcButtons,
    DC_ACTIONS_PER_ACTIVATION, ACTION_ICONS,
    logGameAction, saveGames, client,
    findDcMessageIdForFigure, hasLineOfSight,
  } = deps;
  // Prefer ctx-provided getDcStats/getMapData, fall back to direct imports
  const getDcStatsFn = deps.getDcStats || _getDcStats;
  const getMapDataFn = deps.getMapData || _getMapData;

  const dcList = getDcList(game, playerNum) || [];
  const meta = dcMessageMeta?.get(msgId);

  // ═══════════════════════════════════════════════════════════════════════════
  // [B] ACTIVATION SETUP — state mutations, thread creation, initial message
  // ═══════════════════════════════════════════════════════════════════════════

  // B1. Push undo snapshot
  if (pushUndo) {
    pushUndo(game, {
      type: 'activation',
      label: `Activate ${displayName}`,
      msgId,
      playerNum,
      gameId,
    });
  }

  // B2. Clear confirmation message (off-turn path only)
  if (confirmationMessage) {
    await confirmationMessage.edit({ components: [] }).catch(discordCatch);
  }

  // B3. Mark DC exhausted + re-render embed
  dcExhaustedState.set(msgId, true);
  const { embed, files } = await renderDcEmbed(game, msgId, deps, { exhausted: true });
  await withDiscordRetry(() => dcMessage.edit({
    embeds: [embed], files,
    components: getDcPlayAreaComponents(msgId, true, game, dcName),
  }));

  // B4-B5. Decrement activationsRemaining + push dcIndex
  setActivationsRemaining(game, playerNum, (getActivationsRemaining(game, playerNum) || 0) - 1);
  {
    const indices = getActivatedDcIndices(game, playerNum) || [];
    setActivatedDcIndices(game, playerNum, [...indices, dcIndex]);
  }

  // B6. Update activations message
  await updateActivationsMessage(game, playerNum, client);

  // B7. Clear Strength in Numbers data
  if (game.strengthInNumbersData && game.strengthInNumbersData.playerNum === playerNum) {
    game.strengthInNumbersData = null;
    game.strengthInNumbersPlayerNum = null;
  }

  // B8. Create activation thread (with reuse logic)
  const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
  let thread;
  try {
    thread = await dcMessage.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
  } catch (threadErr) {
    if (threadErr.code === 'MessageExistingThread' || threadErr.code === 160004) {
      thread = dcMessage.thread;
      if (thread?.archived) await thread.setArchived(false);
    } else {
      throw threadErr;
    }
  }

  // B9. Store thread ID on undo entry
  if (pushUndo && game.undoStack?.length > 0) {
    const lastUndo = game.undoStack[game.undoStack.length - 1];
    if (lastUndo.type === 'activation' && lastUndo.msgId === msgId) {
      lastUndo.activationThreadId = thread.id;
    }
  }

  // B10. Init movementBank (merge pendingMpBonus + deployBonusMp)
  game.movementBank = game.movementBank || {};
  const _pendingMp = game.pendingMpBonus?.[msgId] ?? 0;
  if (_pendingMp) delete game.pendingMpBonus[msgId];
  game.movementBank[msgId] = { total: _pendingMp, remaining: _pendingMp, threadId: thread.id, messageId: null, displayName };

  // Deploy bonus MP (legacy backward-compat)
  if (game.deployBonusMp) {
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const prefix = `${dcName}-${dgIndex}-`;
    let _dbTotal = 0;
    for (const [dbFk, dbAmt] of Object.entries(game.deployBonusMp)) {
      if (dbFk.startsWith(prefix) && dbAmt > 0) {
        _dbTotal = Math.max(_dbTotal, dbAmt);
        delete game.deployBonusMp[dbFk];
      }
    }
    if (_dbTotal > 0) {
      grantMovementBank(game, msgId, _dbTotal);
    }
    if (Object.keys(game.deployBonusMp).length === 0) delete game.deployBonusMp;
  }

  // B11. Track activation start positions
  game.activationStartPositions = game.activationStartPositions || {};
  {
    const _aspDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _aspPrefix = `${dcName}-${_aspDgIndex}-`;
    const _aspFigPos = game.figurePositions?.[playerNum] || {};
    for (const [fk, pos] of Object.entries(_aspFigPos)) {
      if (fk.startsWith(_aspPrefix)) game.activationStartPositions[fk] = pos;
    }
  }

  // B12. Init dcActionsData
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id, specialsUsed: [] };

  // B13. Send thread ping (actions buttons + minimap)
  const pingContent = `<@${ownerId}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
  const actMinimap = await getActivationMinimapAttachment(game, msgId);
  const actionsPayload = sanitizeMentions({
    content: pingContent,
    components: getDcActionButtons(msgId, dcName, displayName, game.dcActionsData[msgId], game),
    allowedMentions: { users: [ownerId] },
  });
  if (actMinimap) actionsPayload.files = [actMinimap];
  const actionsMsg = await withDiscordRetry(() => thread.send(actionsPayload));
  game.dcActionsData[msgId].messageId = actionsMsg.id;

  // ═══════════════════════════════════════════════════════════════════════════
  // [C] INTERRUPT-TIMING EFFECTS — other figures reacting to activation
  // ═══════════════════════════════════════════════════════════════════════════

  // C1. Hair Trigger (Jyn Odan): at start of hostile activation, interrupt to attack
  {
    const _htOpponentPN = opponentPlayerNum(playerNum);
    const _htDcEffects = getDcEffects();
    for (const [_htFk, _htPos] of Object.entries(game.figurePositions?.[_htOpponentPN] || {})) {
      if (!_htPos) continue;
      const _htDcName = dcNameFromFigureKey(_htFk);
      const _htEff = _htDcEffects?.[_htDcName];
      if (!((_htEff?.specialAbilityIds || []).includes('hair_trigger'))) continue;
      const _htKey = `hairTrigger_${_htFk}`;
      if (game.roundFigureAbilityUsed?.[_htKey]) continue;
      const _htMsgId = findDcMessageIdForFigure(game.gameId, _htOpponentPN, _htFk);
      if (!_htMsgId) continue;
      const _htOwnerId = getPlayerId(game, _htOpponentPN);
      const _htRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`hair_trigger_use_${gameId}_${_htMsgId}_${_htFk}`).setLabel(`Use Hair Trigger (${_htDcName})`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`hair_trigger_skip_${gameId}_${_htFk}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await logGameAction(game, client, `<@${_htOwnerId}> **Hair Trigger** — **${_htDcName}** may interrupt to perform an attack targeting **${displayName}**. (Once per round)`, {
        phase: 'ACTIVATION', icon: 'card',
        allowedMentions: { users: [_htOwnerId] },
        components: [_htRow],
      });
      break; // Only one Hair Trigger prompt per activation
    }
  }

  // C2. Swipe (Salacious B. Crumb): activation in shared space deals 1 Damage
  if (dcName === 'Salacious B. Crumb') {
    const _swDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _swFk = `Salacious B. Crumb-${_swDgIndex}-0`;
    const _swPos = game.figurePositions?.[playerNum]?.[_swFk];
    if (_swPos) {
      const _swEnemyPN = opponentPlayerNum(playerNum);
      const _swEnemyFigs = game.figurePositions?.[_swEnemyPN] || {};
      for (const [_swEfk, _swEpos] of Object.entries(_swEnemyFigs)) {
        if (!_swEpos || String(_swEpos).toLowerCase() !== String(_swPos).toLowerCase()) continue;
        const _swKey = `swipe_${_swFk}_${_swEfk}`;
        if (game.roundFigureAbilityUsed?.[_swKey]) continue;
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        game.roundFigureAbilityUsed[_swKey] = true;
        const _swTgtMsgId = findDcMessageIdForFigure(gameId, _swEnemyPN, _swEfk);
        if (_swTgtMsgId) {
          const _swFigIdx = parseFigureKey(_swEfk).figureIndex;
          reduceHp(dcHealthState, game, _swTgtMsgId, _swFigIdx, 1, _swEnemyPN);
        }
        const _swTgtName = dcNameFromFigureKey(_swEfk);
        await thread.send(`**Swipe** — **Salacious B. Crumb** activates in **${_swTgtName}**'s space: **${_swTgtName}** suffers 1 Damage.`).catch(discordCatch);
        await logGameAction(game, client, `**Swipe** — **Salacious B. Crumb** deals 1 Damage to **${_swTgtName}** on activation.`, { phase: 'ACTIVATION', icon: 'attack' });
      }
    }
  }

  // C3. It Will Be Alright (Cassian Andor): sacrifice a friendly for free action
  if (dcName === 'Cassian Andor') {
    const _iwbaDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _iwbaSelfFk = `Cassian Andor-${_iwbaDgIndex}-0`;
    const _iwbaSelfPos = game.figurePositions?.[playerNum]?.[_iwbaSelfFk];
    if (_iwbaSelfPos) {
      const _iwbaTargets = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
        if (!pos || fk === _iwbaSelfFk) continue;
        if (countGameSpaces(game, _iwbaSelfPos, pos) > 2) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkMsgId = findDcMessageIdForFigure(gameId, playerNum, fk);
        if (!fkMsgId) continue;
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const fkFigIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const fkEntry = dcHealthState?.get(fkMsgId)?.[fkFigIdx];
        if (!fkEntry || !Array.isArray(fkEntry)) continue;
        const [fkCur, fkMax] = fkEntry;
        if ((fkMax ?? 0) === 0 || ((fkCur ?? fkMax ?? 0) <= 0)) continue;
        _iwbaTargets.push({ figureKey: fk, dcName: fkDcName, msgId: fkMsgId, figIdx: fkFigIdx });
      }
      if (_iwbaTargets.length > 0) {
        const _iwbaRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`iwba_use_${gameId}_${msgId}`).setLabel('It Will Be Alright (sacrifice a friendly)').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`iwba_skip_${gameId}_${msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({
          content: `**It Will Be Alright** — **${displayName}** may sacrifice a friendly figure within 2 spaces to perform a free move or attack.`,
          components: [_iwbaRow],
        }).catch(discordCatch);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // [D] START-OF-ACTIVATION PASSIVES
  // ═══════════════════════════════════════════════════════════════════════════

  const _dcEff = getDcEffects()?.[dcName];
  const _abilityIds = _dcEff?.specialAbilityIds || [];

  // Shared deterministic start-of-activation effects (Mounted, Madness, Into the Fray, Comms Jammer, Focused on the Kill)
  const { applied: _startEffects } = applyStartOfActivationEffects(game, { dcName, playerNum, displayName, msgId, dcHealthState });
  for (const eff of _startEffects) {
    await thread.send({ content: eff.message }).catch(discordCatch);
  }
  // Into the Fray may cause power token overflow — handle Discord UI
  if (game.pendingPowerTokenOverflow?.length > 0) {
    await sendPowerTokenOverflowUI(game, gameId, thread, playerNum, saveGames);
  }

  // D2. Vigor (Ahsoka Tano, Fifth Brother): choose 2 MP or 1 Block Token
  if (dcName === 'Ahsoka Tano' || dcName === 'Fifth Brother') {
    const vigorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_vigor_mp`).setLabel('Gain 2 MP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_vigor_block`).setLabel('Gain 1 Block Token').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({ content: `✨ **Vigor** — **${displayName}**: Choose one:`, components: [vigorRow] }).catch(discordCatch);
  }

  // D3. Madness — now handled by applyStartOfActivationEffects()

  // D4. Responsive (Shyla Varad): choose 1 MP or recover 1 Damage
  if (dcName === 'Shyla Varad') {
    const respRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_responsive_mp`).setLabel('Gain 1 MP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_responsive_heal`).setLabel('Recover 1 Damage').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({ content: `🏃 **Responsive** — **${displayName}**: Choose one:`, components: [respRow] }).catch(discordCatch);
  }

  // D5. Fulcrum (Agent Kallus): each player may draw 1 CC
  if (dcName === 'Agent Kallus') {
    const fulcrumRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_fulcrum_use`).setLabel('Use Fulcrum').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_fulcrum_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({ content: `🕵️ **Fulcrum** — **${displayName}**: Each player may draw 1 Command card. Use Fulcrum?`, components: [fulcrumRow] }).catch(discordCatch);
  }

  // D6. Hunger — Wampa Regular now handled by applyStartOfActivationEffects().
  // Wampa Elite Hunger remains inline: it has a choice branch (Block or Evade token)
  // that cannot be expressed in the deterministic shared helper. This split is intentional.
  if (dcName === 'Wampa (Elite)') {
    const _hungerEliteCheck = () => {
      const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const figureKey = `Wampa (Elite)-${dgIndex}-0`;
      const pos = game.figurePositions?.[playerNum]?.[figureKey];
      if (!pos) return false;
      const enemyNum = opponentPlayerNum(playerNum);
      const hostilePos = Object.values(game.figurePositions?.[enemyNum] || {});
      return !hostilePos.some(hp => hp && countGameSpaces(game, pos, hp) <= 2);
    };
    if (_hungerEliteCheck()) {
      grantMovementBank(game, msgId, 3);
      const hungerRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_hunger_block`).setLabel('Block Token').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_hunger_evade`).setLabel('Evade Token').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `🐻 **Hunger** — **${displayName}** gains **3 MP** (no hostile within 2 spaces). Choose a token:`, components: [hungerRow] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🐻 **Hunger** — Hostile figure within 2 spaces; **${displayName}** does not gain MP or tokens.` }).catch(discordCatch);
    }
  }

  // D7. Tactical Movement (Fenn Signis): choose a friendly within 3 → gains 2 MP
  if (dcName === 'Fenn Signis') {
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const selfFk = `${dcName}-${dgIndex}-0`;
    const selfPos = game.figurePositions?.[playerNum]?.[selfFk];
    if (selfPos) {
      const friendlyFigs = Object.entries(game.figurePositions?.[playerNum] || {})
        .filter(([fk, fp]) => fp && countGameSpaces(game, selfPos, fp) <= 3);
      if (friendlyFigs.length > 0) {
        const btns = friendlyFigs.slice(0, 4).map(([fk]) => {
          const label = dcNameFromFigureKey(fk);
          return new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tacmove_${fk}`).setLabel(label).setStyle(ButtonStyle.Primary);
        });
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tacmove_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const tmRow = new ActionRowBuilder().addComponents(btns);
        await thread.send({ content: `🎯 **Tactical Movement** — Choose a friendly figure within 3 spaces to gain **2 MP**:`, components: [tmRow] }).catch(discordCatch);
      } else {
        await thread.send({ content: `🎯 **Tactical Movement** — No friendly figures within 3 spaces.` }).catch(discordCatch);
      }
    }
  }

  // D8. Into the Fray — now handled by applyStartOfActivationEffects()
  // (overflow UI handled after the shared function call above)

  // D9. Advanced Weapons Research (Director Krennic): friendly within range gains token
  if (dcName === 'Director Krennic') {
    try {
      const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const selfFk = `Director Krennic-${dgIndex}-0`;
      const selfPos = game.figurePositions?.[playerNum]?.[selfFk];
      if (selfPos) {
        const _awrAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
        const _awrRange = awrRange(_awrAtts);
        const friendlyFigs = enumerateAwrTargets(game, playerNum, selfFk, _awrRange);
        if (friendlyFigs.length > 0) {
          const _awrSlice = friendlyFigs.slice(0, 4);
          const _awrLabels = figureChoiceLabels(_awrSlice.map(([fk]) => fk));
          const btns = _awrSlice.map(([fk], i) =>
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_awr_${fk}`).setLabel(_awrLabels[i]).setStyle(ButtonStyle.Primary)
          );
          btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_awr_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          const awrRow = new ActionRowBuilder().addComponents(btns);
          game.pendingAwr = { gameId, msgId, playerNum };
          await thread.send({ content: `🔬 **Advanced Weapons Research** — Choose a friendly figure within ${_awrRange} spaces to grant a **Damage Token** or **Surge Token**:`, components: [awrRow] });
        } else {
          await thread.send({ content: `🔬 **Advanced Weapons Research** — No friendly figures within ${_awrRange} spaces.` });
        }
      } else {
        console.error(`[AWR] Krennic selfPos is null — figurePositions[${playerNum}] keys:`, Object.keys(game.figurePositions?.[playerNum] || {}));
        await thread.send({ content: `⚠️ **Advanced Weapons Research** — Could not locate Krennic's position (key: \`Director Krennic-${(displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1'}-0\`). Available: ${Object.keys(game.figurePositions?.[playerNum] || {}).filter(k => k.startsWith('Director Krennic')).join(', ') || 'none'}` }).catch(discordCatch);
      }
    } catch (err) {
      console.error('[AWR] Failed to send Advanced Weapons Research prompt:', err);
      await thread.send({ content: `⚠️ **Advanced Weapons Research** — Error: ${err.message}` }).catch(discordCatch);
    }
  }

  // D10. Durasteel Fist (Dark Trooper Mk III): choose adjacent figure, roll 1 green die
  if (_abilityIds.includes('durasteel_fist_dark_trooper') && !game.roundFigureAbilityUsed?.[`${dcName}_durasteel_fist_${msgId}`]) {
    const _dfDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _dfActData = game.dcActionsData?.[msgId];
    const _dfSelFig = _dfActData?.selectedFigure ?? 0;
    const _dfSelfFk = `${dcName}-${_dfDgIndex}-${_dfSelFig}`;
    const _dfSelfPos = game.figurePositions?.[playerNum]?.[_dfSelfFk];
    if (_dfSelfPos) {
      const _dfMapId = game.selectedMap?.id;
      const _dfMs = _getMapData(_dfMapId);
      const _dfAdj = (_dfMs?.adjacency?.[String(_dfSelfPos).toLowerCase()] || []).map(a => String(a).toLowerCase());
      const _dfTargets = [];
      for (const pn of [1, 2]) {
        for (const [fk, fp] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!fp || fk === _dfSelfFk) continue;
          if (_dfAdj.includes(String(fp).toLowerCase())) {
            _dfTargets.push({ fk, playerNum: pn });
          }
        }
      }
      if (_dfTargets.length > 0) {
        const _dfSlice = _dfTargets.slice(0, 4);
        const _dfLabels = figureChoiceLabels(_dfSlice.map(({ fk }) => fk));
        const _dfBtns = _dfSlice.map(({ fk }, i) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_durasteelfist_${fk}`).setLabel(_dfLabels[i]).setStyle(ButtonStyle.Danger)
        );
        _dfBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_durasteelfist_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `🤜 **Durasteel Fist** — Choose an adjacent figure to target (roll 1 green die, apply Hits as damage):`, components: [new ActionRowBuilder().addComponents(_dfBtns)] }).catch(discordCatch);
      } else {
        await thread.send({ content: `🤜 **Durasteel Fist** — No adjacent figures to target.` }).catch(discordCatch);
      }
    }
  }

  // D11. Comms Jammer — now handled by applyStartOfActivationEffects()

  // D12. Unstable Devices (Saska Teft): friendly in LOS gains 1 Device token
  if (_abilityIds.includes('unstable_devices_saska') && !game.unstableDevicesUsedThisActivation?.[msgId]) {
    const _udMapSpaces = getMapDataFn(game.selectedMap?.id);
    const _udDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _udSelfFk = `${dcName}-${_udDgIndex}-0`;
    const _udSelfPos = game.figurePositions?.[playerNum]?.[_udSelfFk];
    const _udAllFootprints = getAllFigureFootprints(game, getFigureSize);
    const _udSelfFp = getFigureFootprint(game, playerNum, _udSelfFk, getFigureSize);
    const _udFriendlies = [];
    if (_udSelfPos && _udMapSpaces) {
      for (const fk of Object.keys(game.figurePositions?.[playerNum] || {})) {
        const fp = getFigureFootprint(game, playerNum, fk, getFigureSize);
        if (!fp.length) continue;
        if (hasFigureLineOfSight(_udSelfFp, fp, _udMapSpaces, _udAllFootprints)) {
          _udFriendlies.push({ figureKey: fk, dcName: dcNameFromFigureKey(fk) });
        }
      }
    }
    if (_udFriendlies.length === 1) {
      const f = _udFriendlies[0];
      const confirmBtn = new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_unstabledev_${f.figureKey}`).setLabel(`Grant to ${f.dcName}`).setStyle(ButtonStyle.Primary);
      const skipBtn = new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_unstabledev_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary);
      await thread.send({ content: `🔧 **Unstable Devices** — Grant **1 Device token** to **${f.dcName}**? (free, once per activation)`, components: [new ActionRowBuilder().addComponents(confirmBtn, skipBtn)] }).catch(discordCatch);
    } else if (_udFriendlies.length > 1) {
      const btns = _udFriendlies.slice(0, 4).map(f =>
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_unstabledev_${f.figureKey}`).setLabel(f.dcName).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_unstabledev_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🔧 **Unstable Devices** — Choose a friendly figure in LOS to gain **1 Device token** (free, once per activation):`, components: [new ActionRowBuilder().addComponents(...btns)] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🔧 **Unstable Devices** — No friendly figures in line of sight.` }).catch(discordCatch);
    }
  }

  // D13. Negotiate (Hondo)
  if (_abilityIds.includes('negotiate_hondo')) {
    await thread.send({ content: `💰 **Negotiate** available — When you attack, the target suffers +2 Damage unless they pay 2 VP.` }).catch(discordCatch);
  }

  // D14. Airborne Commander (Gar Saxon)
  if (_abilityIds.includes('airborne_commander_gar_saxon')) {
    await thread.send({ content: `🪂 **Airborne Commander** — Mobile figures within 4 spaces may use Gar Saxon's surge abilities.` }).catch(discordCatch);
  }

  // D15. Droid Kit (Iden Versio): Dio in same space → gain 1 Power Token
  if (dcName === 'Iden Versio') {
    const _dkDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _dkSelfFk = `${dcName}-${_dkDgIndex}-0`;
    const _dkResult = detectDroidKitTrigger(game, playerNum, _dkSelfFk);
    if (_dkResult.applicable) {
      const dkRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_damage`).setLabel('Damage Token').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_surge`).setLabel('Surge Token').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_block`).setLabel('Block Token').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_evade`).setLabel('Evade Token').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `🤖 **Droid Kit** — **Dio** is in **${displayName}**'s space. Gain 1 Power Token:`, components: [dkRow] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🤖 **Droid Kit** — ${_dkResult.reason}; no Power Token gained.` }).catch(discordCatch);
    }
  }

  // D16. Advanced Firepower (General Sorin)
  if (_abilityIds.includes('advanced_firepower_sorin')) {
    const _afAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _afHasACS = cardNameIncludes(_afAtts, 'Advanced Com Systems');
    const _afRange = _afHasACS ? 'within 2 spaces (ACS)' : 'adjacent';
    await thread.send({ content: `🔧 **Advanced Firepower** — ${_afRange} DROID or VEHICLE figures may use Sorin's surge abilities.` }).catch(discordCatch);
  }

  // D17. Unhinged Director (Director Krennic)
  if (_abilityIds.includes('unhinged_director_krennic')) {
    const _udAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _udHasACS = cardNameIncludes(_udAtts, 'Advanced Com Systems');
    const _udRange = _udHasACS ? '3 (ACS)' : '2';
    await thread.send({ content: `📋 **Unhinged Director** — TROOPER or GUARDIAN within ${_udRange} spaces gain +2 (instead of +1) when spending power tokens.` }).catch(discordCatch);
  }

  // D18. Squad Cohesion (Ko-Tun)
  if (_abilityIds.includes('squad_cohesion_kotun')) {
    await thread.send({ content: `🤝 **Squad Cohesion** — REBEL figures within 3 spaces may spend each other's power tokens.` }).catch(discordCatch);
  }

  // D19. Consider It My Payment (Asajj)
  if (_abilityIds.includes('consider_it_my_payment_asajj')) {
    const oppNum = opponentPlayerNum(playerNum);
    const oppOwnerId = game[`player${oppNum}Id`];
    await logGameAction(game, client, `💳 **Consider It My Payment** — <@${oppOwnerId}>, reveal a Command Card from your hand.`, {
      phase: 'ACTIVATION', icon: 'card',
      allowedMentions: { users: [oppOwnerId] },
    });
  }

  // D20. General's Orders (General Weiss): choose up to 2 friendlies, each gains 2 MP
  if (_abilityIds.includes('generals_orders_weiss')) {
    const _goDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _goSelfFk = `${dcName}-${_goDgIndex}-0`;
    const friendlyFigs = Object.entries(game.figurePositions?.[playerNum] || {})
      .filter(([fk, fp]) => fk !== _goSelfFk && fp);
    if (friendlyFigs.length > 0) {
      setPendingGeneralsOrders(game, { gameId, msgId, playerNum, remaining: 2, chosen: [] });
      const _goSlice = friendlyFigs.slice(0, 4);
      const _goLabels = figureChoiceLabels(_goSlice.map(([fk]) => fk));
      const btns = _goSlice.map(([fk], i) =>
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_genorders_${fk}`).setLabel(_goLabels[i]).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_genorders_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🎖️ **General's Orders** — Choose up to 2 friendly figures; each gains **2 MP** (pick 1 of 2):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🎖️ **General's Orders** — No friendly figures available.` }).catch(discordCatch);
    }
  }

  // D21. Long-Laid Plans (Thrawn): distribute N power tokens (N = round#) among friendlies within 3
  if (_abilityIds.includes('long_laid_plans_thrawn')) {
    const roundNum = game.currentRound || 1;
    const _llpDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _llpSelfFk = `${dcName}-${_llpDgIndex}-0`;
    const _llpSelfPos = game.figurePositions?.[playerNum]?.[_llpSelfFk];
    const _llpFriendlies = _llpSelfPos ? Object.entries(game.figurePositions?.[playerNum] || {})
      .filter(([fk, fp]) => fp && countGameSpaces(game, _llpSelfPos, fp) <= 3) : [];
    if (_llpFriendlies.length > 0 && roundNum > 0) {
      setPendingTokenDistribution(game, { gameId, msgId, playerNum, remaining: roundNum, ability: 'longlaid', tokenTypes: ['Damage', 'Block', 'Surge', 'Evade'] });
      const _llpLabels = figureChoiceLabels(_llpFriendlies.map(([fk]) => fk));
      const btns = _llpFriendlies.map(([fk], i) =>
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tokendist_${fk}`).setLabel(_llpLabels[i]).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tokendist_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🧠 **Long-Laid Plans** — Distribute **${roundNum} power token${roundNum > 1 ? 's' : ''}** among friendly figures within 3 spaces. Pick a figure (${roundNum} remaining):`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
    } else {
      await thread.send({ content: `🧠 **Long-Laid Plans** — No friendly figures within 3 spaces (or round 0).` }).catch(discordCatch);
    }
  }

  // D22. Strategize (Thrawn): look at top CC of each deck, may discard one
  if (_abilityIds.includes('strategize_thrawn')) {
    const _strOppNum = opponentPlayerNum(playerNum);
    const _strOwnDeck = game[ccDeckKey(playerNum)] || [];
    const _strOppDeck = game[ccDeckKey(_strOppNum)] || [];
    const _strOwnTop = _strOwnDeck[0] || '(empty)';
    const _strOppTop = _strOppDeck[0] || '(empty)';
    const _strBtns = [];
    if (_strOwnDeck.length > 0) _strBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_strategize_own`).setLabel(`Discard yours: ${_strOwnTop.slice(0, 60)}`).setStyle(ButtonStyle.Danger));
    if (_strOppDeck.length > 0) _strBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_strategize_opp`).setLabel(`Discard opponent: ${_strOppTop.slice(0, 60)}`).setStyle(ButtonStyle.Danger));
    _strBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_strategize_skip`).setLabel('Discard neither').setStyle(ButtonStyle.Secondary));
    await thread.send({
      content: `🧠 **Strategize** — Top of each command deck:\n• **Your deck:** ${_strOwnTop}\n• **Opponent's deck:** ${_strOppTop}\n\nYou may discard one:`,
      components: [new ActionRowBuilder().addComponents(_strBtns)],
    }).catch(discordCatch);
  }

  // D23. Wisdom (Yoda): draw 1 CC, return 1 to bottom of deck
  if (_abilityIds.includes('wisdom_yoda')) {
    const deckKey = ccDeckKey(playerNum);
    const handKey = ccHandKey(playerNum);
    const deck = game[deckKey] || [];
    if (deck.length > 0) {
      const card = deck.shift();
      game[handKey] = [...(game[handKey] || []), card];
      const hand = game[handKey] || [];
      const uniqueCards = [...new Set(hand)];
      if (uniqueCards.length > 0) {
        const btns = uniqueCards.map((c, ci) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_wisdom_${ci}`).setLabel(c.length > 70 ? c.slice(0, 67) + '...' : c).setStyle(ButtonStyle.Secondary)
        );
        const rows = chunkButtonsToRows(btns);
        await thread.send({ content: `🧘 **Wisdom** — Drew 1 CC. Choose a card from your hand to return to the bottom of your deck:`, components: rows }).catch(discordCatch);
      } else {
        await thread.send({ content: `🧘 **Wisdom** — Drew 1 CC but hand is empty (cannot return).` }).catch(discordCatch);
      }
    } else {
      await thread.send({ content: `🧘 **Wisdom** — Deck is empty; cannot draw.` }).catch(discordCatch);
    }
  }

  // D24. Force Vision (Kanan): opponent chooses ready group, must activate next
  if (_abilityIds.includes('force_vision_kanan')) {
    const _fvOppNum = opponentPlayerNum(playerNum);
    const _fvOppOwnerId = getPlayerId(game, _fvOppNum);
    const _fvOppDcList = getDcList(game, _fvOppNum) || [];
    const _fvOppActivated = getActivatedDcIndices(game, _fvOppNum) || [];
    const _fvReadyGroups = [];
    for (let i = 0; i < _fvOppDcList.length; i++) {
      if (_fvOppActivated.includes(i)) continue;
      const dc = _fvOppDcList[i];
      const figs = game.figurePositions?.[_fvOppNum] || {};
      const alive = Object.entries(figs).some(([fk, pos]) => fk.startsWith(dc.dcName + '-') && pos);
      if (!alive) continue;
      _fvReadyGroups.push({ index: i, dcName: dc.dcName, displayName: dc.displayName || dc.dcName });
    }
    if (_fvReadyGroups.length > 0) {
      game.forceVisionPending = _fvOppNum;
      const _fvRows = [];
      const _fvBtns = [];
      for (const rg of _fvReadyGroups.slice(0, 20)) {
        _fvBtns.push(
          new ButtonBuilder()
            .setCustomId(`fv_pick_${gameId}_${_fvOppNum}_${rg.index}`)
            .setLabel(truncateLabel(rg.displayName))
            .setStyle(ButtonStyle.Primary)
        );
        if (_fvBtns.length === 5) {
          _fvRows.push(new ActionRowBuilder().addComponents(..._fvBtns.splice(0)));
        }
      }
      if (_fvBtns.length > 0) _fvRows.push(new ActionRowBuilder().addComponents(..._fvBtns));
      try {
        const _fvGeneralCh = await fetchGameChannel(client, game.generalId);
        await _fvGeneralCh.send({
          content: `👁️ **Force Vision** — <@${_fvOppOwnerId}>, **Kanan Jarrus** is activating! Choose one of your ready groups — you **must** activate it next, if possible:`,
          components: _fvRows.slice(0, 5),
          allowedMentions: { users: [_fvOppOwnerId] },
        });
      } catch (_fvErr) {
        console.error('Force Vision prompt error:', _fvErr);
      }
    } else {
      await thread.send({ content: `👁️ **Force Vision** — Opponent has no ready groups to choose from.` }).catch(discordCatch);
    }
  }

  // D25. Arms Distribution (Ko-Tun): distribute 2 power tokens among friendlies within 3
  if (_abilityIds.includes('arms_distribution_kotun')) {
    const _adDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _adSelfFk = `${dcName}-${_adDgIndex}-0`;
    const _adSelfPos = game.figurePositions?.[playerNum]?.[_adSelfFk];
    const _adFriendlies = _adSelfPos ? Object.entries(game.figurePositions?.[playerNum] || {})
      .filter(([fk, fp]) => fp && countGameSpaces(game, _adSelfPos, fp) <= 3) : [];
    if (_adFriendlies.length > 0) {
      setPendingTokenDistribution(game, { gameId, msgId, playerNum, remaining: 2, ability: 'armsdist', tokenTypes: ['Damage', 'Block'] });
      const _adSlice = _adFriendlies.slice(0, 4);
      const _adLabels = figureChoiceLabels(_adSlice.map(([fk]) => fk));
      const btns = _adSlice.map(([fk], i) =>
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tokendist_${fk}`).setLabel(_adLabels[i]).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tokendist_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🎯 **Arms Distribution** — Distribute **2 power tokens** (Hit or Block) among friendly figures within 3 spaces. Pick a figure (2 remaining):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🎯 **Arms Distribution** — No friendly figures within 3 spaces.` }).catch(discordCatch);
    }
  }

  // D26. Trust Goes Both Ways (Jyn Erso)
  if (_abilityIds.includes('trust_goes_both_ways_jyn')) {
    const _tgbwRoundKey = `trustBothWays_${msgId}`;
    if (!game.roundFigureAbilityUsed?.[_tgbwRoundKey]) {
      const _tgbwDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _tgbwSelfFk = `${dcName}-${_tgbwDgIndex}-0`;
      const _tgbwSelfPos = game.figurePositions?.[playerNum]?.[_tgbwSelfFk];
      const _tgbwFriendlies = _tgbwSelfPos ? Object.entries(game.figurePositions?.[playerNum] || {})
        .filter(([fk, fp]) => fk !== _tgbwSelfFk && fp && countGameSpaces(game, _tgbwSelfPos, fp) <= 1) : [];
      if (_tgbwFriendlies.length > 0) {
        const _tgbw2Slice = _tgbwFriendlies.slice(0, 4);
        const _tgbw2Labels = figureChoiceLabels(_tgbw2Slice.map(([fk]) => fk));
        const btns = _tgbw2Slice.map(([fk], i) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_trustboth_${fk}`).setLabel(_tgbw2Labels[i]).setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_trustboth_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `🤝 **Trust Goes Both Ways** — Choose an adjacent friendly figure. You and that figure each **Recover 1 Damage** and **gain 1 Surge Token**:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
      } else {
        await thread.send({ content: `🤝 **Trust Goes Both Ways** — No adjacent friendly figures.` }).catch(discordCatch);
      }
    }
  }

  // D27. Dead Precise (Ko-Tun)
  if (_abilityIds.includes('dead_precise_kotun')) {
    await thread.send({ content: `🎯 **Dead Precise** — If you do not move during this activation, apply +2 Accuracy while attacking.` }).catch(discordCatch);
  }

  // D28. Adapt (Agent Blaise)
  if (_abilityIds.includes('adapt_blaise')) {
    await thread.send({ content: `🔄 **Adapt** — Choose a trait for this round. Agent Blaise gains that trait.` }).catch(discordCatch);
  }

  // D29. Hunt Dissent (Agent Kallus)
  if (_abilityIds.includes('hunt_dissent_kallus')) {
    await thread.send({ content: `🎯 **Hunt Dissent** — When you or a friendly TROOPER within 3 spaces defeats a hostile figure, gain 1 Block Token.` }).catch(discordCatch);
  }

  // D30. Air Support (Bodhi)
  if (_abilityIds.includes('air_support_bodhi')) {
    await thread.send({ content: `✈️ **Air Support** — After a friendly figure resolves an attack, if the target is in Bodhi's LOS, the target suffers 1 additional Damage.` }).catch(discordCatch);
  }

  // D31. Fast Learner (Mara Jade)
  if (_abilityIds.includes('fast_learner_mara_jade') && !game.roundFigureAbilityUsed?.[`${dcName}_fast_learner`]) {
    await thread.send({ content: `📚 **Fast Learner** — Once this round, Mara Jade may play a Command card whose restriction matches the name of another Deployment card in your army (except "Arcing Shot").` }).catch(discordCatch);
  }

  // D32. Imperial Loadout (Purge Trooper)
  if (_abilityIds.includes('imperial_loadout_purge_trooper')) {
    const fks = Object.keys(game.figurePositions?.[playerNum] || {}).filter(fk => fk.startsWith(dcName + '-'));
    const chosenLoadout = fks.length > 0 ? getConfig(game, fks[0])?.loadout : null;
    if (chosenLoadout) {
      const lCard = getLoadoutCards()[chosenLoadout];
      const imgFiles = [];
      if (lCard?.imagePath) try { imgFiles.push(new AttachmentBuilder(join(getRootDir(), lCard.imagePath))); } catch {}
      await thread.send({ content: `⚔️ **Imperial Loadout: ${chosenLoadout}** — ${lCard?.abilityText || 'Apply loadout abilities.'}`, files: imgFiles }).catch(discordCatch);
    } else {
      await thread.send({ content: `⚔️ **Imperial Loadout** — No loadout card selected. Apply abilities manually.` }).catch(discordCatch);
    }
  }

  // D33. Clawdite Form + Fleet + Conspire + Shields Up (Streetrat)
  if (_abilityIds.includes('shape_clawdite_elite') || _abilityIds.includes('shape_clawdite_reg')) {
    const fks = Object.keys(game.figurePositions?.[playerNum] || {}).filter(fk => fk.startsWith(dcName + '-'));
    const chosenForm = fks.length > 0 ? getConfig(game, fks[0])?.form : null;
    if (chosenForm) {
      const fCard = getFormCards()[chosenForm];
      const imgFiles = [];
      if (fCard?.imagePath) try { imgFiles.push(new AttachmentBuilder(join(getRootDir(), fCard.imagePath))); } catch {}
      await thread.send({ content: `🔄 **Form: ${chosenForm}** — ${fCard?.abilityText || 'Apply form abilities.'}`, files: imgFiles }).catch(discordCatch);
      // Fleet (Streetrat): gain MP
      if (fCard?.fleetMp && fCard.fleetMp > 0) {
        grantMovementBank(game, msgId, fCard.fleetMp);
        await thread.send({ content: `🏃 **Fleet** — **${dcName}** gains **${fCard.fleetMp} MP** at start of activation.` }).catch(discordCatch);
      }
      // Conspire (Senator)
      if (chosenForm === 'Senator') {
        const _conFk = fks[0];
        const _conPos = game.figurePositions?.[playerNum]?.[_conFk];
        if (_conPos) {
          const _conMs = _getMapData(game.selectedMap?.id);
          const _conAdj = (_conMs?.adjacency?.[String(_conPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
          const _conEff = getDcEffects()[dcName] || {};
          const _conDiceCount = (_conEff.attack?.dice || []).length;
          const _conFriendlies = Object.entries(game.figurePositions?.[playerNum] || {})
            .filter(([fk2, pos2]) => fk2 !== _conFk && pos2 && _conAdj.includes(String(pos2).toLowerCase()));
          if (_conFriendlies.length > 0 && _conDiceCount > 0) {
            const btns = _conFriendlies.slice(0, 4).map(([fk2]) =>
              new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_conspire_${fk2}`).setLabel(dcNameFromFigureKey(fk2)).setStyle(ButtonStyle.Primary)
            );
            btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_conspire_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
            setPendingConspire(game, { tokensRemaining: _conDiceCount, senderFk: _conFk });
            await thread.send({ content: `🗣️ **Conspire** (Special Action) — Distribute **${_conDiceCount} Focus token(s)** to friendly figures within 1 space. Choose a figure:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
          } else {
            await thread.send({ content: `🗣️ **Conspire** — No friendly figures within 1 space (or no dice in attack pool). Use manually if needed.` }).catch(discordCatch);
          }
        }
      }
      // Shields Up (Soldier)
      if (chosenForm === 'Soldier') {
        const _suFk = fks[0];
        const _suPos = game.figurePositions?.[playerNum]?.[_suFk];
        if (_suPos) {
          const _suMs = _getMapData(game.selectedMap?.id);
          const _suAdj = (_suMs?.adjacency?.[String(_suPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
          const _suOccupied = new Set([...Object.values(game.figurePositions?.[1] || {}), ...Object.values(game.figurePositions?.[2] || {})].filter(Boolean).map(s => String(s).toLowerCase()));
          const _suAvail = _suAdj.filter(s => !_suOccupied.has(s));
          if (_suAvail.length > 0) {
            const btns = _suAvail.slice(0, 4).map(s =>
              new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_shieldsup_${s}`).setLabel(s.toUpperCase()).setStyle(ButtonStyle.Primary)
            );
            btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_shieldsup_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
            await thread.send({ content: `🛡️ **Shields Up** (Special Action) — Place an energy shield in an adjacent space:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
          } else {
            await thread.send({ content: `🛡️ **Shields Up** — No adjacent empty spaces. Use manually if needed.` }).catch(discordCatch);
          }
        }
      }
    } else {
      await thread.send({ content: `🔄 **Shape** — No form card selected. Apply abilities manually.` }).catch(discordCatch);
    }
  }

  // D34. Scrap Battalion (Ugnaught): Junk Droid co-activates
  if (_abilityIds.includes('scrap_battalion_ugnaught_elite') || _abilityIds.includes('scrap_battalion_ugnaught_reg')) {
    const isElite = _abilityIds.includes('scrap_battalion_ugnaught_elite');
    game.companionActivatedBefore = game.companionActivatedBefore || {};
    game.companionActivatedBefore[msgId] = 'co-activate';
    const _sbCompMsgIds = playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
    const _sbDcMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    let _sbJunkDroidMsgId = null;
    if (_sbCompMsgIds) {
      for (let i = 0; i < _sbCompMsgIds.length; i++) {
        if (_sbCompMsgIds[i] && _sbDcMsgIds?.[i] === msgId) {
          _sbJunkDroidMsgId = _sbCompMsgIds[i];
          break;
        }
      }
    }
    if (_sbJunkDroidMsgId) {
      game.movementBank = game.movementBank || {};
      game.movementBank[_sbJunkDroidMsgId] = { remaining: 4, total: 4, threadId: thread.id, messageId: null, displayName: 'Junk Droid' };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[_sbJunkDroidMsgId] = { from: 'Scrap Battalion' };
    }
    await thread.send({ content: `🤖 **Scrap Battalion — Junk Droid Co-Activates**\nThe Junk Droid readies and activates **as part of this group**.${_sbJunkDroidMsgId ? ' **4 MP** and **1 free attack** granted — use its Move/Attack buttons.' : ' Move and attack with it during this activation.'}\n\`\`\`\nJunk Droid: Speed 4 | Health 1 | Melee (1 green) | +1 Hit\nSurge abilities (${dcName}'s): Bleed, Pierce ${isElite ? '2' : '1'}\n\`\`\`${isElite ? '\n⚡ **Overclock** (Special Action): The Junk Droid may **interrupt** to perform a move or attack.' : ''}` }).catch(discordCatch);
  }

  // D35. Skirmish Upgrade attachment activation effects
  // Focused on the Kill — now handled by applyStartOfActivationEffects()
  const _suActivationUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  if (_suActivationUpgrades.length) {
    // Wookiee Avenger (Chewbacca): free Slam
    if (cardNameIncludes(_suActivationUpgrades, 'Wookiee Avenger') && !game.wookieeAvengerSlamUsed?.[msgId]) {
      const _waMapId = game.selectedMap?.id;
      const _waMs = _waMapId ? _getMapData(_waMapId) : null;
      const _waDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _waSelfFk = `${dcName}-${_waDgIndex}-0`;
      const _waSelfPos = game.figurePositions?.[playerNum]?.[_waSelfFk];
      if (_waSelfPos && _waMs) {
        const _waAdj = (_waMs.adjacency?.[String(_waSelfPos).toLowerCase()] || []).map(a => String(a).toLowerCase());
        const _waEnemyNum = opponentPlayerNum(playerNum);
        const _waHostiles = Object.entries(game.figurePositions?.[_waEnemyNum] || {})
          .filter(([, fp]) => fp && _waAdj.includes(String(fp).toLowerCase()));
        if (_waHostiles.length > 0) {
          const _waSlice = _waHostiles.slice(0, 4);
          const _waLabels = figureChoiceLabels(_waSlice.map(([fk]) => fk));
          const btns = _waSlice.map(([fk], i) =>
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_wookslam_${fk}`).setLabel(_waLabels[i]).setStyle(ButtonStyle.Primary)
          );
          btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_wookslam_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread.send({ content: `**Wookiee Avenger** — **${dcName}** may use **Slam** without spending an action. Choose an adjacent hostile figure:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
        } else {
          await thread.send({ content: `**Wookiee Avenger** — No adjacent hostile figures for free Slam.` }).catch(discordCatch);
        }
      }
    }
    // Motivation (UNIQUE): exhaust during activation
    if (cardNameIncludes(_suActivationUpgrades, 'Motivation') && !cardNameIncludes(game.exhaustedSkirmishUpgrades?.[msgId], 'Motivation')) {
      const _motMapSpaces = getMapDataFn(game.selectedMap?.id);
      const _motDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _motSelfFk = `${dcName}-${_motDgIndex}-0`;
      const _motSelfPos = game.figurePositions?.[playerNum]?.[_motSelfFk];
      const _motSelfCost = getDcStatsFn(dcName)?.cost ?? 99;
      const _motAllFootprints = getAllFigureFootprints(game, getFigureSize);
      const _motSelfFp = getFigureFootprint(game, playerNum, _motSelfFk, getFigureSize);
      const _motFriendlies = _motSelfPos ? Object.entries(game.figurePositions?.[playerNum] || {})
        .filter(([fk, fp]) => {
          if (fk === _motSelfFk || !fp) return false;
          const dcN = dcNameFromFigureKey(fk);
          const cost = getDcStatsFn(dcN)?.cost ?? 99;
          if (cost >= _motSelfCost) return false;
          if (_motMapSpaces) {
            const fkFp = getFigureFootprint(game, playerNum, fk, getFigureSize);
            return hasFigureLineOfSight(_motSelfFp, fkFp, _motMapSpaces, _motAllFootprints);
          }
          return true;
        }) : [];
      if (_motFriendlies.length > 0) {
        const _motSlice = _motFriendlies.slice(0, 4);
        const _motLabels = figureChoiceLabels(_motSlice.map(([fk]) => fk));
        const btns = _motSlice.map(([fk], i) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_motivation_${fk}`).setLabel(_motLabels[i]).setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_motivation_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `**Motivation** — Choose a friendly figure with lower cost in your LOS (recover 1 Damage or discard HARMFUL, then gain 1 MP):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
      } else {
        await thread.send({ content: `**Motivation** — No eligible friendly figures (lower cost with LOS).` }).catch(discordCatch);
      }
    }
    // Trusted Ally (DROID): exhaust during activation
    if (cardNameIncludes(_suActivationUpgrades, 'Trusted Ally') && !cardNameIncludes(game.exhaustedSkirmishUpgrades?.[msgId], 'Trusted Ally')) {
      const _taMapId = game.selectedMap?.id;
      const _taMs = _getMapData(_taMapId);
      const _taDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _taSelfFk = `${dcName}-${_taDgIndex}-0`;
      const _taSelfPos = game.figurePositions?.[playerNum]?.[_taSelfFk];
      const _taAdj = _taSelfPos ? (_taMs?.adjacency?.[String(_taSelfPos).toLowerCase()] || []).map(a => String(a).toLowerCase()) : [];
      const _taFriendlies = Object.entries(game.figurePositions?.[playerNum] || {})
        .filter(([fk, fp]) => fk !== _taSelfFk && fp && _taAdj.includes(String(fp).toLowerCase()));
      if (_taFriendlies.length > 0) {
        const _taSlice = _taFriendlies.slice(0, 4);
        const _taLabels = figureChoiceLabels(_taSlice.map(([fk]) => fk));
        const btns = _taSlice.map(([fk], i) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_trustedally_${fk}`).setLabel(_taLabels[i]).setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_trustedally_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `**Trusted Ally** — Choose an adjacent friendly figure (recover 1 Damage or discard 1 HARMFUL condition):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
      } else {
        await thread.send({ content: `**Trusted Ally** — No adjacent friendly figures.` }).catch(discordCatch);
      }
    }
    // Beast Tamer — now handled by applyStartOfActivationEffects()
  }

  // D36. Imperial Retrofitting (I48)
  {
    const _irEligibleNames = ['AT-ST', 'General Weiss', 'SC2-M Repulsor Tank'];
    if (_irEligibleNames.includes(dcName)) {
      const _irDcList = getDcList(game, playerNum) || [];
      const _irDcMsgIds = getDcMessageIds(game, playerNum) || [];
      let _irMsgId = null;
      for (let di = 0; di < _irDcList.length; di++) {
        const dc = _irDcList[di];
        if (dc?.dcName === '[Imperial Retrofitting]') {
          _irMsgId = _irDcMsgIds[di] || null;
          break;
        }
      }
      if (_irMsgId) {
        const _irDepleted = (game.p1DepletedDcMessageIds || []).includes(_irMsgId) || (game.p2DepletedDcMessageIds || []).includes(_irMsgId);
        const _irExhausted = cardNameIncludes(game.exhaustedSkirmishUpgrades?.[_irMsgId], 'Imperial Retrofitting');
        if (!_irDepleted) {
          const _irBtns = [];
          if (!_irExhausted) {
            _irBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_multiattack_${_irMsgId}`).setLabel('IR: Multi-Attack (Exhaust)').setStyle(ButtonStyle.Primary));
            _irBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_move_${_irMsgId}`).setLabel('IR: Move (Exhaust)').setStyle(ButtonStyle.Primary));
          }
          _irBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_focus_${_irMsgId}`).setLabel('IR: Focus (Deplete)').setStyle(ButtonStyle.Danger));
          _irBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread.send({ content: `**Imperial Retrofitting** — Choose an option for **${displayName}**:`, components: [new ActionRowBuilder().addComponents(_irBtns)] }).catch(discordCatch);
        }
      }
    }
  }

  // D37. Imperial Citadel (I47): friendly Imperial may gain 1 Power Token
  {
    const _icAtkEff = getDcEffects()?.[dcName];
    if (_icAtkEff?.affiliation === 'Imperial') {
      if (dcList.some(dc => dc.dcName === '[Imperial Citadel]')) {
        const _icTokens = game.imperialCitadelTokens || {};
        const _icAvailable = Object.entries(_icTokens).filter(([, count]) => count > 0);
        if (_icAvailable.length > 0) {
          const _icBtns = _icAvailable.slice(0, 4).map(([type, count]) => {
            const label = `${type.charAt(0).toUpperCase() + type.slice(1)} (${count})`;
            return new ButtonBuilder()
              .setCustomId(`act_passive_${gameId}_${msgId}_citadel_token_${type}`)
              .setLabel(label)
              .setStyle(ButtonStyle.Primary);
          });
          _icBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_citadel_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await logGameAction(game, client, `🏰 **Imperial Citadel** — <@${ownerId}>, **${displayName}** may gain 1 Power Token from the Citadel:`, {
            phase: 'ACTIVATION', icon: 'card',
            components: [new ActionRowBuilder().addComponents(_icBtns)],
            allowedMentions: { users: [ownerId] },
          });
        }
      }
    }
  }

  // D38. I Make the Rules Now — now handled by applyStartOfActivationEffects()

  // D39. Calming Presence (Yoda): when friendly REBEL activates, remove 1 harmful condition
  if (playerNum) {
    const _cpDcList = getDcList(game, playerNum) || [];
    for (const dc of _cpDcList) {
      if (!dc?.dcName) continue;
      const eff = getDcEffects()?.[dc.dcName];
      if (!(eff?.specialAbilityIds || []).includes('calming_presence_yoda')) continue;
      if (dc.dcName === dcName) continue;
      const activatingEff = getDcEffects()?.[dcName];
      if (activatingEff?.affiliation !== 'Rebel') continue;
      const dgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const figures = activatingEff?.figures ?? 1;
      const _cpHarmfulEntries = [];
      for (let fi = 0; fi < figures; fi++) {
        const fk = `${dcName}-${dgIdx}-${fi}`;
        const conds = game.figureConditions?.[fk] || [];
        const harmful = conds.filter(c => ['Stun', 'Bleed', 'Weaken'].includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[fk]));
        for (const h of harmful) {
          _cpHarmfulEntries.push({ fk, condition: h, figIndex: fi });
        }
      }
      if (_cpHarmfulEntries.length > 0) {
        const seen = new Set();
        const unique = _cpHarmfulEntries.filter(e => {
          const key = `${e.fk}_${e.condition}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const btns = unique.slice(0, 4).map(({ fk, condition }) => {
          const label = figures > 1 ? `${dcNameFromFigureKey(fk)}: ${condition}` : condition;
          return new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_calmpres_${fk}_${condition}`).setLabel(label).setStyle(ButtonStyle.Primary);
        });
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_calmpres_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `🧘 **Calming Presence** (Yoda) — **${dcName}** is a REBEL figure. Remove 1 harmful condition (the activating figure suffers 1 Strain):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
      }
      break;
    }
  }

  // D40. Unshakable: exhaust at start of activation → cost≥9 figure discards 1 harmful
  {
    const _usDcList = getDcList(game, playerNum) || [];
    const _usDcMsgIds = getDcMessageIds(game, playerNum) || [];
    let _usMsgId = null;
    for (let _usI = 0; _usI < _usDcList.length; _usI++) {
      if ((_usDcList[_usI]?.dcName || _usDcList[_usI]) === '[Unshakable]') { _usMsgId = _usDcMsgIds[_usI] || null; break; }
    }
    if (_usMsgId) {
      const _usExh = game.exhaustedSkirmishUpgrades?.[_usMsgId] || [];
      const _usDepleted = (game[`p${playerNum}DepletedDcMessageIds`] || []).includes(_usMsgId);
      if (!cardNameIncludes(_usExh, 'Unshakable') && !_usDepleted) {
        const _usAllFigPos = game.figurePositions?.[playerNum] || {};
        const _usCandidates = [];
        for (const [fk, pos] of Object.entries(_usAllFigPos)) {
          if (!pos) continue;
          const fkDcName = dcNameFromFigureKey(fk);
          const fkCost = _getDcStats(fkDcName)?.cost ?? 0;
          if (fkCost < 9) continue;
          const conds = game.figureConditions?.[fk] || [];
          const harmful = conds.filter(c => ['Stun', 'Bleed', 'Weaken'].includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[fk]));
          if (harmful.length > 0) _usCandidates.push({ fk, dcName: fkDcName, harmful });
        }
        if (_usCandidates.length > 0) {
          const btns = _usCandidates.slice(0, 4).map(({ fk, dcName: dName, harmful }) => {
            const label = `${dName}: ${harmful.join(', ')}`;
            return new ButtonBuilder()
              .setCustomId(`act_passive_${gameId}_${msgId}_unshakable_${fk}`)
              .setLabel(truncateLabel(label))
              .setStyle(ButtonStyle.Primary);
          });
          btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_unshakable_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread.send({
            content: `**Unshakable** — Choose a figure (cost ≥ 9) to discard 1 harmful condition (suffers 1 Strain):`,
            components: [new ActionRowBuilder().addComponents(btns)],
          }).catch(discordCatch);
        }
      }
    }
  }

  // D41. Nemik's Manifesto: exhaust → suffer 2 Strain, gain 1 MP
  {
    const _nmDcList = getDcList(game, playerNum) || [];
    const _nmDcMsgIds = getDcMessageIds(game, playerNum) || [];
    let _nmMsgId = null;
    for (let _nmI = 0; _nmI < _nmDcList.length; _nmI++) {
      if ((_nmDcList[_nmI]?.dcName || _nmDcList[_nmI]) === "[Nemik's Manifesto]") { _nmMsgId = _nmDcMsgIds[_nmI] || null; break; }
    }
    if (_nmMsgId) {
      const _nmExh = game.exhaustedSkirmishUpgrades?.[_nmMsgId] || [];
      const _nmDepleted = (game[`p${playerNum}DepletedDcMessageIds`] || []).includes(_nmMsgId);
      if (!_nmExh.includes("Nemik's Manifesto") && !_nmDepleted) {
        const nmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_nemik_use_${_nmMsgId}`).setLabel("Use Nemik's Manifesto (+1 MP, -2 Strain)").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_nemik_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `📜 **Nemik's Manifesto** — Exhaust to grant **${displayName}** +1 MP (suffers 2 Strain)?`, components: [nmRow] }).catch(discordCatch);
      }
    }
  }

  // D42. [Spectre Cell]: exhaust → +2 MP, may interrupt attack
  {
    const _scDcList = getDcList(game, playerNum) || [];
    const _scDcMsgIds = getDcMessageIds(game, playerNum) || [];
    let _scMsgId = null;
    for (let _scI = 0; _scI < _scDcList.length; _scI++) {
      if ((_scDcList[_scI]?.dcName || _scDcList[_scI]) === '[Spectre Cell]') { _scMsgId = _scDcMsgIds[_scI] || null; break; }
    }
    if (_scMsgId) {
      const _scExh = game.exhaustedSkirmishUpgrades?.[_scMsgId] || [];
      const _scDepleted = (game[`p${playerNum}DepletedDcMessageIds`] || []).includes(_scMsgId);
      if (!cardNameIncludes(_scExh, 'Spectre Cell') && !_scDepleted) {
        const _scAllFigs = game.figurePositions?.[playerNum] || {};
        const _scActivatingPrefix = `${dcName}-`;
        const _scHasOther = Object.entries(_scAllFigs).some(([fk, pos]) => pos && !fk.startsWith(_scActivatingPrefix));
        if (_scHasOther) {
          const scRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_spectrecell_use`).setLabel('Use Spectre Cell (+2 MP + interrupt attack)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_spectrecell_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await thread.send({ content: `**[Spectre Cell]** — Exhaust to choose another friendly figure: +2 MP and may interrupt to perform an attack.`, components: [scRow] }).catch(discordCatch);
        }
      }
    }
  }

  // D43. Voracious (Rancor): adjacent activation → free melee attack
  for (const rancorPn of [1, 2]) {
    const rDcList = getDcList(game, rancorPn) || [];
    const rDcMsgIds = getDcMessageIds(game, rancorPn) || [];
    for (let ri = 0; ri < rDcList.length; ri++) {
      const rDc = rDcList[ri];
      if (!rDc?.dcName) continue;
      const rEff = getDcEffects()?.[rDc.dcName];
      if (!(rEff?.specialAbilityIds || []).includes('voracious_rancor')) continue;
      if (rDc.dcName === dcName && rancorPn === playerNum) continue;
      const rMsgId = rDcMsgIds[ri];
      if (!rMsgId) continue;
      const rDgIdx = (rDc.displayName || rDc.dcName).match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const rFk = `${rDc.dcName}-${rDgIdx}-0`;
      const rPos = game.figurePositions?.[rancorPn]?.[rFk];
      if (!rPos) continue;
      const rSize = game.figureOrientations?.[rFk] || getFigureSize(rDc.dcName) || '2x3';
      const rCells = getFootprintCells(rPos, rSize);
      const actDgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const actStats = getDcStatsFn(dcName);
      const actFigCount = actStats?.figures ?? 1;
      let anyAdjacent = false;
      const adjacentActFks = [];
      for (let fi = 0; fi < actFigCount; fi++) {
        const actFk = `${dcName}-${actDgIdx}-${fi}`;
        const actPos = game.figurePositions?.[playerNum]?.[actFk];
        if (!actPos) continue;
        const actSize = game.figureOrientations?.[actFk] || getFigureSize(dcName) || '1x1';
        const actCells = getFootprintCells(actPos, actSize);
        let isAdj = false;
        for (const rc of rCells) {
          for (const ac of actCells) {
            if (countGameSpaces(game, rc, ac) === 1) { isAdj = true; break; }
          }
          if (isAdj) break;
        }
        if (isAdj) {
          anyAdjacent = true;
          adjacentActFks.push(actFk);
        }
      }
      if (anyAdjacent && adjacentActFks.length > 0) {
        const rDisplayName = rDc.displayName || rDc.dcName;
        const rancorOwner = rancorPn === playerNum ? 'friendly' : 'hostile';
        game.pendingVoracious = game.pendingVoracious || {};
        game.pendingVoracious[rMsgId] = {
          rancorMsgId: rMsgId,
          rancorDcName: rDc.dcName,
          rancorPlayerNum: rancorPn,
          rancorFigureKey: rFk,
          rancorDisplayName: rDisplayName,
          targetFigureKeys: adjacentActFks,
          targetPlayerNum: playerNum,
          targetDcName: dcName,
          activatingMsgId: msgId,
        };
        const vorBtns = [];
        for (const tFk of adjacentActFks.slice(0, 4)) {
          const tLabel = actFigCount > 1 ? `Attack ${dcNameFromFigureKey(tFk)}` : `Attack ${dcName}`;
          vorBtns.push(
            new ButtonBuilder()
              .setCustomId(`act_passive_${gameId}_${msgId}_voracious_${rMsgId}_${tFk}`)
              .setLabel(tLabel)
              .setStyle(ButtonStyle.Danger)
          );
        }
        vorBtns.push(
          new ButtonBuilder()
            .setCustomId(`act_passive_${gameId}_${msgId}_voracious_${rMsgId}_skip`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary)
        );
        await thread.send({
          content: `**Voracious** — **${rDisplayName}** (${rancorOwner}, P${rancorPn}) is adjacent to the activating figure. The Rancor may perform a free melee attack:`,
          components: [new ActionRowBuilder().addComponents(vorBtns)],
        }).catch(discordCatch);
      }
    }
  }

  // D44. Companion activation ordering (before/after)
  {
    const _compAttachments = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _compInfo = getCompanionForDc(dcName, _compAttachments);
    if (_compInfo && !_compInfo.isCoActivation) {
      game.companionActivatedBefore = game.companionActivatedBefore || {};
      if (!game.companionActivatedBefore[msgId]) {
        const _compRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`act_passive_${gameId}_${msgId}_companionbefore_activate`)
            .setLabel(`Activate ${_compInfo.companionName} Now (Before)`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`act_passive_${gameId}_${msgId}_companionafter_skip`)
            .setLabel(`Skip (Activate ${_compInfo.companionName} After)`)
            .setStyle(ButtonStyle.Secondary),
        );
        const _compSummary = formatCompanionStats(_compInfo.companionName, _compInfo.companionStats);
        await thread.send({
          content: `🐾 **Companion: ${_compInfo.companionName}** — Activates at the start or end of **${displayName}**'s activation.\n${_compSummary}\n\nActivate the companion now (before ${dcName}) or after?`,
          components: [_compRow],
        }).catch(discordCatch);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // [E] POST-PASSIVE EFFECTS — logging, interrupts, post-activation triggers
  // ═══════════════════════════════════════════════════════════════════════════

  // E1. Meditation: FORCE USER free attack
  if (game.nextActivationFreeAttack?.[playerNum]) {
    const _natEff = getDcEffects()?.[dcName];
    const _natKws = (_natEff?.keywords || []).map((k) => String(k).toUpperCase());
    if (_natKws.includes('FORCE USER')) {
      const _natData = game.nextActivationFreeAttack[playerNum];
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = true;
      if (_natData?.dice) {
        game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
        game.pendingOverrideAttackDice[msgId] = { type: _natData.melee ? 'Melee' : null, dice: _natData.dice, pierce: 0, bonusAccuracy: 0 };
      }
      delete game.nextActivationFreeAttack[playerNum];
      if (logGameAction) await logGameAction(game, client, `**Meditation** — **${displayName}** has a free Melee attack (1 red + 1 yellow) available this activation.`, { phase: 'ROUND', icon: 'card' });
    }
  }

  // E2. Orbital Bombardment: prompt to deplete tokens
  const _obTokens = game.orbitalBombardmentTokens?.[msgId] || 0;
  if (_obTokens > 0) {
    const _obAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    if (_obAtts.includes('Orbital Bombardment')) {
      const obRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ob_deplete_${gameId}_${msgId}`).setLabel(`Deplete OB: ${_obTokens} spaces, 2 dmg each`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ob_skip_${gameId}_${msgId}`).setLabel('Keep tokens').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({
        content: `**Orbital Bombardment** — You have **${_obTokens} Bombardment token${_obTokens > 1 ? 's' : ''}**. Deplete to choose ${_obTokens} space${_obTokens > 1 ? 's' : ''} — each figure on a chosen space suffers 2 Damage.`,
        components: [obRow],
      }).catch(discordCatch);
    }
  }

  // E3. Overwatch: remind if token placed
  const _owPos = game.overwatchTokenPosition?.[msgId];
  if (_owPos) {
    await thread.send(`**Overwatch** — Your token is at **${String(_owPos).toUpperCase()}**. Exhaust when a hostile enters a space on/adjacent to the token to interrupt and perform an attack.`).catch(discordCatch);
  }

  // E4. Companion attachment reminders (only if not already handled by ordering above)
  {
    const _cmpAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    if (_cmpAtts.includes('Clan of Two') && !game.companionActivatedBefore?.[msgId]) {
      await thread.send(`**Clan of Two** — **The Child** activates at the start or end of this activation. At the end, push The Child to your space or an adjacent space.`).catch(discordCatch);
    }
    if (_cmpAtts.includes('Indentured Jester') && !game.companionActivatedBefore?.[msgId]) {
      await thread.send(`**Indentured Jester** — **Salacious B. Crumb** activates at the start or end of this activation. (Not counted for control.)`).catch(discordCatch);
    }
  }

  // E5. saveGames + log message + store ID
  saveGames();
  const logCh = await fetchGameChannel(client, game.generalId);
  const icon = ACTION_ICONS.activate || '⚡';
  const pLabel = `P${playerNum}`;
  const logMsg = await logCh.send(sanitizeMentions({
    content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${ownerId}> activated **${displayName}**!`,
    allowedMentions: { users: [ownerId] },
  }));
  game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
  game.dcActivationLogMessageIds[msgId] = logMsg.id;
  saveGames(); // save again after storing log message ID

  // E6. Still Faster Than You: opponent interrupt
  if (game.stillFasterPlayerNum && game.stillFasterPlayerNum !== playerNum) {
    const sftPlayerNum = game.stillFasterPlayerNum;
    const sftOwnerId = getPlayerId(game, sftPlayerNum);
    const sftRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`still_faster_use_${gameId}_${msgId}`).setLabel('Use Still Faster Than You').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`still_faster_skip_${gameId}_${msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: `<@${sftOwnerId}> — **Still Faster Than You**: interrupt now (move 2 + attack a different hostile) or skip?`,
      components: [sftRow],
      allowedMentions: { users: [sftOwnerId] },
    }).catch(discordCatch);
    setPendingStillFaster(game, { gameId, activatingMsgId: msgId, activatingPlayerNum: playerNum, sftPlayerNum });
  }

  // E7. Hostile activation reaction card prompts.
  // Posted privately to the opponent's hand channel — the activation thread is
  // shared (both players have ViewChannel on each play area), so a count of
  // playable reaction cards there leaks hand-state info to the active player.
  try {
    const oppNum = opponentPlayerNum(playerNum);
    const reactCards = getPlayableReactionCardsForTiming(game, oppNum, [
      'whenEnemyFigureActivates', 'atStartOfHostileFigureActivation', 'atStartOfActivationOfHostileFigureInYourLineOfSight',
    ]);
    if (reactCards.length) {
      const oppId = getPlayerId(game, oppNum);
      const oppHandId = oppNum === 1 ? game.p1HandId : game.p2HandId;
      if (oppHandId) {
        try {
          const oppHandCh = await fetchGameChannel(client, oppHandId);
          await oppHandCh.send({
            content: `<@${oppId}> — Hostile activated! You have **${reactCards.length}** reaction card(s) playable now. Check your hand below.`,
            allowedMentions: { users: [oppId] },
          }).catch(discordCatch);
        } catch (_handChErr) {
          console.error('Activation reaction prompt: hand channel unreachable', _handChErr?.message ?? _handChErr);
        }
      }
    }
  } catch (_actReactErr) {
    console.error('Activation reaction prompt error:', _actReactErr?.message ?? _actReactErr);
  }

  // E8. Update "Activate a DC" message
  if (activateCardMsgId) {
    try {
      const activateCardMsg = await logCh.messages.fetch(activateCardMsgId);
      const activateRows = getActivateDcButtons(game, playerNum);
      await activateCardMsg.edit({ content: '**Activate a Deployment Card**', components: activateRows.length > 0 ? activateRows : [] }).catch(discordCatch);
    } catch {}
  }
  if (editActivateReplyFn) {
    const activateRows = getActivateDcButtons(game, playerNum);
    await editActivateReplyFn(activateRows).catch(discordCatch);
  }
}
