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
  getPlayerId, getDcList, getDcMessageIds, getPlayAreaId, getHandChannelId,
  getActivationsRemaining, setActivationsRemaining,
  getActivatedDcIndices, setActivatedDcIndices,
  getCcHand, opponentPlayerNum,
  ccDeckKey, ccHandKey,
  getInitiativePlayerNum,
} from '../game/player-helpers.js';
import { countGameSpaces } from '../game/board-helpers.js';
import { groupEffectiveFigures } from '../game/squad-upgrades.js';
import { awrRange, enumerateAwrTargets } from '../game/awr-helpers.js';
import { detectDroidKitTrigger } from '../game/droid-kit-helpers.js';
import { hasFigureLineOfSight, getFigureFootprint, getAllFigureFootprints } from '../game/spatial.js';
import { getFootprintCells } from '../game/coords.js';
import { applyCondition, filterCondition, dcNameFromFigureKey, parseFigureKey, grantPowerTokens, grantMovementBank, figureChoiceLabels, isCompanionHostDefeated, reduceHp, figureKeyForActivation } from '../game/index.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { cardNameIncludes } from '../game/card-names.js';
import { getPlayableReactionCardsForTiming } from '../game/cc-timing.js';
import { getConfig } from '../game/figure-config.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { chunkButtonsToRows, truncateLabel } from '../discord/components.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { sendPowerTokenOverflowUI } from '../discord/power-token-prompts.js';
import { applyStartOfActivationEffects } from './activation-effects.js';
import { setPendingTokenDistribution, setPendingGeneralsOrders, setPendingConspire, setPendingStillFaster } from '../game/interrupts.js';
import { enumerateActivatorSoaDescriptors, startSoaResolution, describeChooserPrompt } from '../game/soa-orchestrator.js';
import { join } from 'path';

import { getDcEffect } from '../game/dc-helpers.js';
import { getDamageableObjectsAtCoord, isObjectAlive } from '../game/object-damage-pipeline.js';
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
    // Per destruct 2026-05-07: Junk Droid follows the standard companion
    // first/second rule like every other companion. The earlier
    // `isCoActivation` carveout was wrong — it treated Junk Droid as a
    // tightly-integrated co-activation that bypassed the prompt, but the
    // canonical rule (CRR + destruct) is "activates at start OR end of
    // host's activation, player choice." Junk Droid's special feature is
    // separate: Scrap Battalion auto-readies the Junk Droid at the start
    // of each Ugnaught's activation, enabling effective multiple
    // activations per round when paired with Spot Weld's place-and-ready.
    // That auto-ready is handled in applyStartOfActivationEffects, not
    // here.
    return { companionName, companionStats, isCoActivation: false };
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

/**
 * Resolve the companion msgId associated with a host msgId, or null.
 * Reads p{n}DcCompanionMessageIds at the host's index.
 */
export function getCompanionMsgIdForHost(game, hostMsgId) {
  for (const pn of [1, 2]) {
    const hostIds = pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const compIds = pn === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
    if (!hostIds || !compIds) continue;
    const idx = hostIds.indexOf(hostMsgId);
    if (idx >= 0) return compIds[idx] || null;
  }
  return null;
}

/**
 * Resolve the host msgId for a companion msgId, or null. Inverse of
 * getCompanionMsgIdForHost.
 */
export function getHostMsgIdForCompanion(game, companionMsgId) {
  for (const pn of [1, 2]) {
    const compIds = pn === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
    const hostIds = pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    if (!compIds || !hostIds) continue;
    const idx = compIds.indexOf(companionMsgId);
    if (idx >= 0) return hostIds[idx] || null;
  }
  return null;
}

/**
 * Given a msgId currently activating, return the PAIRED msgId (the host
 * if msgId is a companion, the companion if msgId is a host) when both
 * sides are allocated this activation, otherwise null. Used by the
 * End-Activation handler to gate thread archive + turn switch on BOTH
 * sides finishing — per alexanbv 2026-05-10, host and companion end
 * independently and the turn doesn't change until both are done.
 */
export function getPairedActiveMsgId(game, msgId) {
  const companionMsgId = getCompanionMsgIdForHost(game, msgId);
  if (companionMsgId && game.dcActionsData?.[companionMsgId]) return companionMsgId;
  const hostMsgId = getHostMsgIdForCompanion(game, msgId);
  if (hostMsgId && game.dcActionsData?.[hostMsgId]) return hostMsgId;
  return null;
}

/**
 * Mid-game companion bank allocation (slice 4). Allocates dcActionsData
 * + movementBank entries for a companion msgId WITH a full action bank
 * and 0 MP bank (per alexanbv 2026-05-10: "When deployed, all banks
 * refresh. Movement bank is 0 until companion performs move or gains
 * mp from some other effect.")
 *
 * Used by mid-game deploy paths (Static Pulse Branch B, post-deploy
 * companion_deploy, Ugnaught-style mid-game ready). No-op if the
 * companion's msgId is unknown or banks already exist.
 *
 * @param {object} game
 * @param {number} playerNum
 * @param {string} companionMsgId
 * @param {string} companionName
 * @param {object} opts
 * @param {number} opts.actionsPerActivation - usually DC_ACTIONS_PER_ACTIVATION (2)
 * @param {string} [opts.threadId] - host's activation thread id, if known
 */
export function allocateCompanionBanksMidGame(game, playerNum, companionMsgId, companionName, opts = {}) {
  if (!companionMsgId || !companionName) return;
  if (game.dcActionsData?.[companionMsgId]) return; // already allocated
  const actionsPerActivation = opts.actionsPerActivation ?? 2;
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[companionMsgId] = {
    // Per alexanbv 2026-06-13: actions are STRICTLY per-figure — no group-level
    // remaining/total. Companions are single-figure.
    perFigureRemaining: { 0: actionsPerActivation },
    figureLocked: {},
    figureSoaFired: {},
    figureEoaFired: {},
    messageId: null,
    threadId: opts.threadId || null,
    specialsUsed: [],
    isCompanion: true,
    hostMsgId: opts.hostMsgId || null,
  };
  game.movementBank = game.movementBank || {};
  game.movementBank[companionMsgId] = {
    threadId: opts.threadId || null,
    messageId: null,
    displayName: companionName,
    perFig: { 0: { total: 0, remaining: 0 } },
  };
  game.activationStartPositions = game.activationStartPositions || {};
  const prefix = `${companionName}-`;
  for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
    if (fk.startsWith(prefix)) game.activationStartPositions[fk] = pos;
  }
}

/**
 * Clear companion banks (mid-game removal / defeat / retrieval).
 * Mirror inverse of allocateCompanionBanksMidGame.
 */
export function clearCompanionBanks(game, companionMsgId) {
  if (!companionMsgId) return;
  if (game.dcActionsData?.[companionMsgId]) delete game.dcActionsData[companionMsgId];
  if (game.movementBank?.[companionMsgId]) delete game.movementBank[companionMsgId];
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

  // B1b. Reset the per-activation combat ability used-list. "once per activation"
  // reroll/combat limits (e.g. Lando's Shrewd Scoundrel) are keyed in
  // game.activationAbilityUsed; nothing else clears it, so a new group activation
  // is the refresh boundary. This also makes Shrewd re-available when Lando
  // attacks in another figure's activation (e.g. Leia-granted) — that's a new
  // activation. alexanbv 2026-06-17.
  game.activationAbilityUsed = {};

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

  // B7a. Same for Squad Swarm, which shares Strength in Numbers' timing
  // (alexanbv 2026-08-12). Both are consumed by the activation they permit.
  if (game.squadSwarmData && game.squadSwarmData.playerNum === playerNum) {
    game.squadSwarmData = null;
    game.squadSwarmPlayerNum = null;
  }

  // B7b. Clear Field Tactics immediate-activation grant. Once the granted
  // group begins activating (or any of this player's groups does), the
  // one-shot grant is consumed. Mirrors the Squad Swarm flag lifecycle.
  if (game.fieldTacticsActivationPlayerNum === playerNum) {
    game.fieldTacticsActivationPlayerNum = null;
    game.fieldTacticsActivationMsgId = null;
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
  // Per alexanbv 2026-06-13: MP is strictly per-figure. The top-level
  // movementBank[msgId] holds ONLY UI metadata; every figure of the group
  // gets its own perFig[i] sub-bank. A pending MP bonus applies to each
  // figure individually (per-figure semantics — no shared pool).
  game.movementBank = game.movementBank || {};
  const _pendingMp = game.pendingMpBonus?.[msgId] ?? 0;
  if (_pendingMp) delete game.pendingMpBonus[msgId];
  // Effective count includes a Squad Upgrade figure so it gets its own MP bank
  // slot. alexanbv 2026-06-17.
  const _b10FigCount = Math.max(1, groupEffectiveFigures(game, msgId, getDcEffect(dcName)?.figures ?? 1));
  const _b10PerFig = {};
  for (let _i = 0; _i < _b10FigCount; _i++) {
    _b10PerFig[_i] = { total: _pendingMp, remaining: _pendingMp };
  }
  game.movementBank[msgId] = { threadId: thread.id, messageId: null, displayName, perFig: _b10PerFig };

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
  // B11b. Board-wide position snapshot at the start of THIS activation. Needed by
  // abilities that ask "where was figure X when my activation began?" — Light It
  // Up (Rebel Pathfinder) checks whether the TARGET had LOS to the attacker at the
  // attacker's activation start, and the target is NOT the activating figure, so
  // its position must be read as-of this moment, not its current (possibly moved)
  // cell. Refreshed wholesale each activation start. alexanbv 2026-06-18.
  game.activationStartAllPositions = {};
  for (const team of Object.values(game.figurePositions || {})) {
    for (const [fk, pos] of Object.entries(team || {})) {
      game.activationStartAllPositions[fk] = pos;
    }
  }

  // B12. Init dcActionsData
  // Per destruct 2026-05-07: multi-figure groups give each figure 2 actions
  // individually (NOT 2 total for the group). For a 2-figure group, the
  // total budget is 4 actions (2 per figure). Track per-figure remaining
  // counts so each figure must complete its own 2 actions before another
  // figure can act.
  const _b12Eff = getDcEffect(dcName);
  // Effective count includes a Squad Upgrade figure so it gets its own per-figure
  // action budget (it activates as a full group member). alexanbv 2026-06-17.
  const _b12FigCount = Math.max(1, groupEffectiveFigures(game, msgId, _b12Eff?.figures ?? 1));
  const _b12PerFig = {};
  for (let _i = 0; _i < _b12FigCount; _i++) _b12PerFig[_i] = DC_ACTIONS_PER_ACTIVATION;
  game.dcActionsData = game.dcActionsData || {};
  // Per alexanbv 2026-06-13: actions are STRICTLY per-figure — no group-level
  // remaining/total counter. Each figure owns its budget in perFigureRemaining.
  game.dcActionsData[msgId] = {
    perFigureRemaining: _b12PerFig,
    figureLocked: {},
    // Per destruct 2026-05-07: each figure has individual SoA + EoA
    // checks. For 1-figure groups, fired at group-start / group-end.
    // For multi-figure groups, deferred per-figure: SoA on first figure
    // selection, EoA when each figure locks.
    figureSoaFired: {},
    figureEoaFired: {},
    messageId: null,
    threadId: thread.id,
    specialsUsed: [],
  };

  // B12.5. Init companion banks (paired-but-separate)
  // Per alexanbv 2026-05-10: companions activate with the host and get full
  // parity with a normal activating figure — their own dcActionsData (2
  // actions), movementBank, activationStartPositions, and per-figure
  // SoA/EoA hooks. Lifecycle is paired (allocated on host activation, both
  // cleared at activation end), but the action/movement banks are separate
  // so each figure must complete its own 2 actions per multi-figure rules.
  // Slice 1 (this commit): allocate banks. Slice 2 will post the UI.
  {
    const _hostAttachments = playerNum === 1
      ? (game.p1DcAttachments?.[msgId] || [])
      : (game.p2DcAttachments?.[msgId] || []);
    const _compInfo = getCompanionForDc(dcName, _hostAttachments);
    if (_compInfo) {
      const _compMsgIds = playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
      const _hostMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const _hostIdx = (_hostMsgIds || []).indexOf(msgId);
      const _companionMsgId = _hostIdx >= 0 ? _compMsgIds?.[_hostIdx] : null;
      const _compPrefix = `${_compInfo.companionName}-`;
      const _compInPlay = Object.keys(game.figurePositions?.[playerNum] || {})
        .some((fk) => fk.startsWith(_compPrefix));
      if (_companionMsgId && _compInPlay) {
        game.dcActionsData[_companionMsgId] = {
          // Per alexanbv 2026-06-13: actions are STRICTLY per-figure — no
          // group-level remaining/total. Companions are single-figure.
          perFigureRemaining: { 0: DC_ACTIONS_PER_ACTIVATION },
          figureLocked: {},
          figureSoaFired: {},
          figureEoaFired: {},
          messageId: null,
          threadId: thread.id,
          specialsUsed: [],
          isCompanion: true,
          hostMsgId: msgId,
        };
        const _compPendingMp = game.pendingMpBonus?.[_companionMsgId] ?? 0;
        if (_compPendingMp) delete game.pendingMpBonus[_companionMsgId];
        game.movementBank[_companionMsgId] = {
          threadId: thread.id,
          messageId: null,
          displayName: _compInfo.companionName,
          perFig: { 0: { total: _compPendingMp, remaining: _compPendingMp } },
        };
        for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
          if (fk.startsWith(_compPrefix)) game.activationStartPositions[fk] = pos;
        }
      }
    }
  }

  // B13. Send thread ping (actions buttons + minimap)
  // Actions are per-figure now (B12: _b12PerFig, DC_ACTIONS_PER_ACTIVATION each),
  // so the opening counter shows the activating figure's full budget. (_b12Total
  // was a removed group-level total — its dangling ref crashed finalizeActivation.)
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

  // B13.5. Companion action-counter message in the host's thread (slice 2)
  // Posts a parallel actions-counter + buttons message for the companion
  // so the player can see and click the companion's own action bank. The
  // companion's DC embed in the play area also auto-refreshes its buttons
  // via getDcPlayAreaComponents which reads dcActionsData[companionMsgId].
  {
    const _b13_5_compMsgIds = playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
    const _b13_5_hostMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const _b13_5_hostIdx = (_b13_5_hostMsgIds || []).indexOf(msgId);
    const _b13_5_companionMsgId = _b13_5_hostIdx >= 0 ? _b13_5_compMsgIds?.[_b13_5_hostIdx] : null;
    if (_b13_5_companionMsgId && game.dcActionsData[_b13_5_companionMsgId]) {
      const _compData = game.dcActionsData[_b13_5_companionMsgId];
      const _compName = _compData.isCompanion ? game.movementBank?.[_b13_5_companionMsgId]?.displayName || dcName : dcName;
      const _compMsg = await withDiscordRetry(() => thread.send(sanitizeMentions({
        content: `🐾 **${_compName}** (companion) — ${getActionsCounterContent(_compData.total, _compData.remaining)}`,
        components: getDcActionButtons(_b13_5_companionMsgId, _compName, _compName, _compData, game),
        allowedMentions: { users: [] },
      })));
      _compData.messageId = _compMsg.id;
      // Refresh companion's play-area DC embed so its CC-special / DC-special
      // buttons light up (getDcPlayAreaComponents reads dcActionsData).
      try {
        const playAreaId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
        if (playAreaId) {
          const _playArea = await fetchGameChannel(client, playAreaId);
          const _embedMsg = await _playArea.messages.fetch(_b13_5_companionMsgId).catch(() => null);
          if (_embedMsg) {
            await withDiscordRetry(() => _embedMsg.edit({
              components: getDcPlayAreaComponents(_b13_5_companionMsgId, false, game, _compName),
            }));
          }
        }
      } catch (err) {
        console.error('[activation-setup] companion embed refresh failed:', err?.message ?? err);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // [C] INTERRUPT-TIMING EFFECTS — other figures reacting to activation
  // ═══════════════════════════════════════════════════════════════════════════

  // C0. Findsman Meditation (Zuckuss): at start of an opponent's
  // activation matching the marked group, post Zuckuss's controller a
  // move-or-attack picker. Move → Speed-MP picker (rule 1, no bank).
  // Attack → granted attack. Skip → no-op. Once-per-round (cleared on
  // first resolution this round).
  {
    const _fmOpponentPN = opponentPlayerNum(playerNum);
    const _fmTarget = game.findsmanMeditationTarget?.[_fmOpponentPN];
    if (_fmTarget && (_fmTarget === dcName || _fmTarget === dcName?.replace(/\s*\[.*\]\s*$/, ''))) {
      // Locate Zuckuss on the opponent's side.
      let _fmZuckussFk = null;
      for (const fk of Object.keys(game.figurePositions?.[_fmOpponentPN] || {})) {
        if (fk.startsWith('Zuckuss-')) { _fmZuckussFk = fk; break; }
      }
      if (_fmZuckussFk) {
        const _fmZuckussMsgId = findDcMessageIdForFigure(gameId, _fmOpponentPN, _fmZuckussFk);
        if (_fmZuckussMsgId) {
          const _fmOwnerId = getPlayerId(game, _fmOpponentPN);
          const _fmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`findsman_med_${gameId}_${_fmZuckussMsgId}_move`).setLabel('Move (Speed MP)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`findsman_med_${gameId}_${_fmZuckussMsgId}_attack`).setLabel('Attack').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`findsman_med_${gameId}_${_fmZuckussMsgId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await logGameAction(game, client,
            `<@${_fmOwnerId}> **Findsman Meditation** — **${displayName}** is activating. **Zuckuss** may interrupt to perform a move or an attack:`,
            { phase: 'ACTIVATION', icon: 'card', allowedMentions: { users: [_fmOwnerId] }, components: [_fmRow] });
        }
      }
    }
  }

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

  // C1b. Overcharged Weapons (CC): same timing as Hair Trigger — at the start
  // of a hostile figure's activation, the holder may interrupt to perform an
  // attack with one of their Readied VEHICLE figures targeting the activating
  // figure (+Pierce 2, then exhaust that DC + become Weakened). Per alexanbv:
  // "Overcharged Weapons has the same timing as Jyn Hair Trigger." This is a
  // CC played from hand, so we only stash the activating-figure context here;
  // the cc-timing gate (whenEnemyFigureActivates) surfaces the card in the
  // holder's hand and the overchargedWeaponsEffect resolver reads this stash.
  {
    const _owHolderPN = opponentPlayerNum(playerNum);
    const _owHand = getCcHand(game, _owHolderPN) || [];
    if (_owHand.includes('Overcharged Weapons')) {
      const _owActDgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _owActFk = `${dcName}-${_owActDgIdx}-${figureIndex}`;
      if (game.figurePositions?.[playerNum]?.[_owActFk]) {
        game.pendingOverchargedWeapons = {
          holderPlayerNum: _owHolderPN,
          activatingPlayerNum: playerNum,
          activatingFigureKey: _owActFk,
        };
      }
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
          await _applyDamage(game, { dcHealthState, logGameAction, client }, {
            figureKey: _swEfk, msgId: _swTgtMsgId, figIndex: _swFigIdx,
            amount: 1, controllerPlayerNum: _swEnemyPN,
            source: 'Swipe',
          });
        }
        const _swTgtName = dcNameFromFigureKey(_swEfk);
        await thread.send(`**Swipe** — **Salacious B. Crumb** activates in **${_swTgtName}**'s space: **${_swTgtName}** suffers 1 Damage.`).catch(discordCatch);
        await logGameAction(game, client, `**Swipe** — **Salacious B. Crumb** deals 1 Damage to **${_swTgtName}** on activation.`, { phase: 'ACTIVATION', icon: 'attack' });
      }
    }
  }

  // C3. It Will Be Alright (Cassian Andor): sacrifice a friendly for free action.
  // ACS extends "within 2" → "within 3" when attached to Cassian's DC.
  if (dcName === 'Cassian Andor') {
    const _iwbaDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _iwbaSelfFk = `Cassian Andor-${_iwbaDgIndex}-0`;
    const _iwbaSelfPos = game.figurePositions?.[playerNum]?.[_iwbaSelfFk];
    if (_iwbaSelfPos) {
      const _iwbaAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      const _iwbaMaxRange = cardNameIncludes(_iwbaAtts, 'Advanced Com Systems') ? 3 : 2;
      const _iwbaTargets = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
        if (!pos || fk === _iwbaSelfFk) continue;
        if (countGameSpaces(game, _iwbaSelfPos, pos) > _iwbaMaxRange) continue;
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
  // Scrap Battalion (Ugnaught Tinkerer) auto-readied the Junk Droid —
  // applyStartOfActivationEffects records the intent on
  // game._scrapBattalionReadyJd; flip dcExhaustedState here.
  if (game._scrapBattalionReadyJd?.length && dcExhaustedState) {
    // Unified ready primitive (alexanbv 2026-08-11) — un-exhausting alone left
    // the Junk Droid in pXActivatedDcIndices, so Scrap Battalion readied it
    // visually without returning the activation.
    const { readyDeploymentCard: _readyDc } = await import('../game/card-state-helpers.js');
    for (const _jdMsgId of game._scrapBattalionReadyJd) {
      const _jdPn = (game.p1DcMessageIds || []).includes(_jdMsgId) ? 1 : 2;
      _readyDc(game, _jdPn, _jdMsgId, { dcExhaustedState, recomputeActivationCounts: deps?.recomputeActivationCounts });
    }
    delete game._scrapBattalionReadyJd;
  }
  // Into the Fray may cause power token overflow — handle Discord UI
  if (game.pendingPowerTokenOverflow?.length > 0) {
    await sendPowerTokenOverflowUI(game, gameId, thread, playerNum, saveGames);
  }

  // D2. Vigor: routed through the SoA orchestrator (per destruct 2026-05-07).
  // The chooser prompt below is posted only when there are pending SoA
  // descriptors; today this slice migrates Vigor as the canary, future slices
  // migrate the rest of the inline prompts in this file. Init-player goes
  // first; if init-player has no triggers, non-init's bucket is presented.
  // Activation-end is gated by isActivationActionInProgress while
  // pendingSoaResolution exists for this msgId.
  //
  // Per destruct 2026-05-07: each figure has individual SoA checks. For
  // 1-figure groups, SoA fires here at activation start (figure 0 is the
  // implicit activator). For multi-figure groups, SoA is DEFERRED to
  // per-figure-select (see index.js dc_fig_select_ handler) so each
  // figure's own SoA pass fires when that figure begins acting.
  if (_b12FigCount === 1) {
    const _soaDesc = enumerateActivatorSoaDescriptors(game, { dcName, playerNum, msgId, figureIndex: 0 });
    if (_soaDesc.length > 0) {
      // alexanbv 2026-08-12: this window resolves "in initiative order".
      // game.initiative / game.firstPlayer are never assigned anywhere, so
      // this always fell through to the ACTIVATOR and initiative order was
      // never actually applied. getInitiativePlayerNum reads the real field.
      const initPN = getInitiativePlayerNum(game);
      const _started = startSoaResolution(game, _soaDesc, initPN, { activatorPlayerNum: playerNum, activatorMsgId: msgId });
      if (_started) {
        const _soaShape = describeChooserPrompt(game.pendingSoaResolution, gameId);
        if (_soaShape) {
          const _soaButtons = _soaShape.choices.map((c) => {
            const style = c.descId === '__skip_all__' ? ButtonStyle.Secondary : ButtonStyle.Primary;
            return new ButtonBuilder().setCustomId(c.customId).setLabel(c.label).setStyle(style);
          });
          await thread.send({
            content: `\u{2728} **Start-of-Activation** — Player ${_soaShape.ownerPlayerNum}: choose which effect to resolve next, or skip all remaining.`,
            components: chunkButtonsToRows(_soaButtons),
          }).catch(discordCatch);
        }
      }
    }
    // Mark figure 0 SoA as fired so per-figure paths (defense in depth)
    // don't re-fire it.
    game.dcActionsData[msgId].figureSoaFired[0] = true;
  }

  // D3. Madness — now handled by applyStartOfActivationEffects()

  // D4-D7. Responsive / Fulcrum / Hunger Elite / Tactical Movement now flow
  // through the SoA orchestrator (slice 2 — see soa-orchestrator.js
  // enumerateActivatorSoaDescriptors). The chooser prompt posted above
  // covers them; click → sub-prompt → fire → consume.

  // D8. Into the Fray — now handled by applyStartOfActivationEffects()
  // (overflow UI handled after the shared function call above)

  // D9. Advanced Weapons Research: migrated to SoA orchestrator (slice
  // 8a — destruct 2026-05-07). See soa-orchestrator.js (subPromptKey
  // 'awr'). Range still uses awrRange() to honor the Advanced Com
  // Systems extension to 3 spaces.

  // D10. Durasteel Fist (Dark Trooper Mk III): NOT SoA per destruct
  // 2026-05-07 — ability fires anytime during activation. Same pattern
  // as Nemik's / Spectre Cell — button is posted at activation start
  // for visibility but stays clickable throughout the activation.
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
      // alexanbv 2026-06-22: Durasteel Fist may target an adjacent figure OR
      // OBJECT ("Choose 1 adjacent figure or object"). Add adjacent damageable
      // objects to the picker (object choices are tagged `obj:<id>`).
      const _dfObjTargets = [];
      const _dfObjSeen = new Set();
      for (const _coord of _dfAdj) {
        for (const _objId of getDamageableObjectsAtCoord(game, _coord)) {
          if (_dfObjSeen.has(_objId) || !isObjectAlive(game, _objId)) continue;
          _dfObjSeen.add(_objId);
          _dfObjTargets.push({ objId: _objId, name: game.objectMeta?.[_objId]?.name || _objId });
        }
      }
      if (_dfTargets.length > 0 || _dfObjTargets.length > 0) {
        const _dfSlice = _dfTargets.slice(0, 22);
        const _dfLabels = figureChoiceLabels(_dfSlice.map(({ fk }) => fk));
        const _dfBtns = _dfSlice.map(({ fk }, i) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_durasteelfist_${fk}`).setLabel(_dfLabels[i]).setStyle(ButtonStyle.Danger)
        );
        for (const { objId, name } of _dfObjTargets.slice(0, 24 - _dfSlice.length)) {
          _dfBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_durasteelfist_obj:${objId}`).setLabel(`📦 ${name}`.slice(0, 80)).setStyle(ButtonStyle.Danger));
        }
        _dfBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_durasteelfist_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `🤜 **Durasteel Fist** — At any point during this activation, you may target an adjacent figure or object (roll 1 green die, apply Hits as damage):`, components: chunkButtonsToRows(_dfBtns) }).catch(discordCatch);
      } else {
        await thread.send({ content: `🤜 **Durasteel Fist** — No adjacent figures or objects to target.` }).catch(discordCatch);
      }
    }
  }

  // D11. Comms Jammer — now handled by applyStartOfActivationEffects()

  // D12. Unstable Devices (Saska Teft): NOT SoA per destruct 2026-05-07
  // — fires anytime during activation. Same pattern as Nemik's.
  // Per IACP rule 2026-05-09: "once per activation" is per-figure
  // (Saska Thorn is unique single-figure so the gate is per-figureKey
  // rather than per-msgId).
  const _udDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const _udSelFigForGate = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
  const _udFigureKeyForGate = `${dcName}-${_udDgIndex}-${_udSelFigForGate}`;
  if (_abilityIds.includes('unstable_devices_saska') && !game.unstableDevicesUsedThisActivation?.[_udFigureKeyForGate]) {
    const _udMapSpaces = getMapDataFn(game.selectedMap?.id);
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
      await thread.send({ content: `🔧 **Unstable Devices** — At any point during this activation, grant **1 Device token** to **${f.dcName}**? (free, once per activation)`, components: [new ActionRowBuilder().addComponents(confirmBtn, skipBtn)] }).catch(discordCatch);
    } else if (_udFriendlies.length > 1) {
      const btns = _udFriendlies.slice(0, 24).map(f =>
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_unstabledev_${f.figureKey}`).setLabel(f.dcName).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_unstabledev_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🔧 **Unstable Devices** — At any point during this activation, choose a friendly figure in LOS to gain **1 Device token** (free, once per activation):`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
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

  // D15. Droid Kit (Iden Versio): NOT SoA per destruct 2026-05-07 —
  // fires anytime during activation. Per alexanbv 2026-06-26: "CSV is
  // correct, the player can gain any token of choice." Restore the 4-way
  // token picker (Damage / Surge / Block / Evade); the activation.js handler's
  // tokenMap already supports all four.
  if (dcName === 'Iden Versio') {
    const _dkDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _dkSelfFk = `${dcName}-${_dkDgIndex}-0`;
    const _dkResult = detectDroidKitTrigger(game, playerNum, _dkSelfFk);
    if (_dkResult.applicable) {
      const dkRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_damage`).setLabel('Damage').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_surge`).setLabel('Surge').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_block`).setLabel('Block').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_evade`).setLabel('Evade').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_droidkit_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `🤖 **Droid Kit** — At any point during this activation, while **Dio** is in **${displayName}**'s space, you may gain **1 Power Token** of your choice:`, components: [dkRow] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🤖 **Droid Kit** — ${_dkResult.reason}; no Damage Token available.` }).catch(discordCatch);
    }
  }

  // D16. Advanced Firepower (General Sorin)
  // ACS extends "adjacent" to "within 3 spaces" per the IACP ACS card text.
  if (_abilityIds.includes('advanced_firepower_sorin')) {
    const _afAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _afHasACS = cardNameIncludes(_afAtts, 'Advanced Com Systems');
    const _afRange = _afHasACS ? 'within 3 spaces (ACS)' : 'adjacent';
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

  // D19. Consider It My Payment (Asajj Ventress) — REMOVED.
  // Asajj Ventress was removed from the game per destruct 2026-05-05;
  // Session 8.1-8.3 of the combat-rebuild plan.

  // D20. General's Orders (General Weiss): choose up to 2 friendlies, each gains 2 MP
  if (_abilityIds.includes('generals_orders_weiss')) {
    const _goDgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _goSelfFk = `${dcName}-${_goDgIndex}-0`;
    const friendlyFigs = Object.entries(game.figurePositions?.[playerNum] || {})
      .filter(([fk, fp]) => fk !== _goSelfFk && fp);
    if (friendlyFigs.length > 0) {
      setPendingGeneralsOrders(game, { gameId, msgId, playerNum, remaining: 2, chosen: [] });
      const _goSlice = friendlyFigs.slice(0, 24);
      const _goLabels = figureChoiceLabels(_goSlice.map(([fk]) => fk));
      const btns = _goSlice.map(([fk], i) =>
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_genorders_${fk}`).setLabel(_goLabels[i]).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_genorders_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🎖️ **General's Orders** — Choose up to 2 friendly figures; each may **perform a Move** (their own Speed-MP, spend immediately):`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
    } else {
      await thread.send({ content: `🎖️ **General's Orders** — No friendly figures available.` }).catch(discordCatch);
    }
  }

  // D21. Long-Laid Plans — migrated to SoA orchestrator (destruct
  // 2026-05-07). Distribute N DIFFERENT power tokens (max 1 of each
  // type) where N = round number capped at 4. Multi-step descriptor
  // in soa-orchestrator.js.

  // D22. Strategize (Thrawn): look at top CC of each deck, may discard one.
  // Per alexanbv 2026-05-13: the two top cards Thrawn looks at are
  // SECRET — only Thrawn's player should see them. Post the picker to
  // Thrawn's PRIVATE hand channel, not the shared activation thread.
  // The activation thread gets a generic prompt-only note so both
  // players know Strategize is resolving.
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
    const _strHandChId = getHandChannelId(game, playerNum);
    let _strSent = false;
    if (_strHandChId) {
      try {
        const _strHandCh = await fetchGameChannel(client, _strHandChId);
        if (_strHandCh) {
          await _strHandCh.send({
            content: `🧠 **Strategize** — Top of each command deck:\n• **Your deck:** ${_strOwnTop}\n• **Opponent's deck:** ${_strOppTop}\n\nYou may discard one:`,
            components: [new ActionRowBuilder().addComponents(_strBtns)],
          }).catch(discordCatch);
          _strSent = true;
        }
      } catch (err) { /* fall through */ }
    }
    // Activation thread gets a no-leak notice so both players know
    // Strategize is resolving in Thrawn's private hand channel.
    await thread.send({
      content: `🧠 **Strategize** — Thrawn is reviewing the top of each command deck (resolution in his hand channel).`,
    }).catch(discordCatch);
    // Fallback: if hand channel was unavailable, post the picker to
    // the thread anyway so the game doesn't deadlock. This is the
    // pre-2026-05-13 behavior but should rarely fire.
    if (!_strSent) {
      await thread.send({
        content: `🧠 **Strategize** — (hand channel unavailable; falling back to thread): Top of each command deck:\n• **Your deck:** ${_strOwnTop}\n• **Opponent's deck:** ${_strOppTop}\n\nYou may discard one:`,
        components: [new ActionRowBuilder().addComponents(_strBtns)],
      }).catch(discordCatch);
    }
  }

  // D23. Wisdom — migrated to SoA orchestrator (destruct 2026-05-07).
  // handleSoaPick draws into hand and posts the return-card picker;
  // handleSoaFire completes the swap.

  // D24. Force Vision — migrated to SoA orchestrator (destruct
  // 2026-05-07). Opponent-trigger; descriptor enumerated in
  // soa-orchestrator.js for the opponent's bucket. handleSoaPick lists
  // ready groups; handleSoaFire sets forceVisionNextActivation.
  // forceVisionPending is no longer used; pendingSoaResolution itself
  // gates the activation flow.

  // D25. Arms Distribution (Ko-Tun) — SoA portion migrated to orchestrator
  // (destruct 2026-05-07). Total payout is 1 Power Token at deploy +
  // 1 at SoA (NOT 2 at SoA). Deploy-time portion is handled separately;
  // SoA descriptor enumerated in soa-orchestrator.js.

  // D26. Trust Goes Both Ways — migrated to SoA orchestrator (destruct
  // 2026-05-07). Descriptor enumerated in soa-orchestrator.js
  // enumerateActivatorSoaDescriptors when adjacent friendly exists and
  // ability has not yet been used this round.

  // D27. Dead Precise (Ko-Tun)
  if (_abilityIds.includes('dead_precise_kotun')) {
    await thread.send({ content: `🎯 **Dead Precise** — When an attacking figure within 3 spaces (including Ko-Tun) spent a Power Token, it may reroll 1 attack die and apply -1 Dodge to the attack results.` }).catch(discordCatch);
  }

  // D28. Adapt (Agent Blaise)
  if (_abilityIds.includes('adapt_blaise')) {
    await thread.send({ content: `🔄 **Adapt** — Choose a trait for this round. Agent Blaise gains that trait.` }).catch(discordCatch);
  }

  // D29. Hunt Dissent (Agent Kallus)
  if (_abilityIds.includes('hunt_dissent_kallus')) {
    await thread.send({ content: `🎯 **Hunt Dissent** — When you or a friendly TROOPER within 3 spaces defeats a hostile figure, gain 1 Block Token.` }).catch(discordCatch);
  }

  // D30. Air Support (Bodhi Rook): when a friendly figure spends a Power
  // Token while attacking and the attacker does NOT have Focus, apply +2
  // Accuracy to the attack results. Auto-applies at the attacker
  // token-spend site in combat.js via `_maybeApplyAirSupport`.
  if (_abilityIds.includes('air_support_bodhi')) {
    await thread.send({ content: `✈️ **Air Support** — When a friendly figure spends a Power Token while attacking and is **not Focused**, +2 Accuracy is applied to the attack.` }).catch(discordCatch);
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
      // Fleet (Streetrat): gain MP.
      // Per alexanbv 2026-05-13: per-figure bank. Fleet applies at
      // start-of-activation to figure 0 (the first activator).
      if (fCard?.fleetMp && fCard.fleetMp > 0) {
        // Per-figure bank: Fleet applies at start-of-activation to figure 0.
        // grantMovementBank ensures the figure's perFig sub-bank exists.
        grantMovementBank(game, msgId, fCard.fleetMp, 0);
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
            const btns = _conFriendlies.slice(0, 24).map(([fk2]) =>
              new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_conspire_${fk2}`).setLabel(dcNameFromFigureKey(fk2)).setStyle(ButtonStyle.Primary)
            );
            btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_conspire_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
            setPendingConspire(game, { tokensRemaining: _conDiceCount, senderFk: _conFk });
            await thread.send({ content: `🗣️ **Conspire** (Special Action) — Distribute **${_conDiceCount} Focus token(s)** to friendly figures within 1 space. Choose a figure:`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
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
            const btns = _suAvail.slice(0, 24).map(s =>
              new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_shieldsup_${s}`).setLabel(s.toUpperCase()).setStyle(ButtonStyle.Primary)
            );
            btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_shieldsup_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
            await thread.send({ content: `🛡️ **Shields Up** (Special Action) — Place an energy shield in an adjacent space:`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
          } else {
            await thread.send({ content: `🛡️ **Shields Up** — No adjacent empty spaces. Use manually if needed.` }).catch(discordCatch);
          }
        }
      }
    } else {
      await thread.send({ content: `🔄 **Shape** — No form card selected. Apply abilities manually.` }).catch(discordCatch);
    }
  }

  // D34. Scrap Battalion (Ugnaught): Junk Droid auto-readies + activates
  // as part of the group. Per alexanbv 2026-05-10: there is no "co-
  // activate" — every activation is sequenced and the player must pick
  // companion order (Before / After) via the SOA orchestrator's
  // companion_order picker. The pre-set that suppressed the picker has
  // been removed; the picker fires naturally when companionActivatedBefore
  // is absent.
  if (_abilityIds.includes('scrap_battalion_ugnaught_elite') || _abilityIds.includes('scrap_battalion_ugnaught_reg')) {
    const isElite = _abilityIds.includes('scrap_battalion_ugnaught_elite');
    await thread.send({ content: `🤖 **Scrap Battalion** — **Junk Droid** readies and activates as part of this group. Pick the activation order below.\n\`\`\`\nJunk Droid: Speed 4 | Health 1 | Melee (1 green) | +1 Damage\nSurge abilities (${dcName}'s): Bleed, Pierce ${isElite ? '2' : '1'}\n\`\`\`${isElite ? '\n⚡ **Overclock** (Special Action): The Junk Droid may **interrupt** to perform a move or attack.' : ''}` }).catch(discordCatch);
  }

  // D35. Skirmish Upgrade attachment activation effects
  // Focused on the Kill — now handled by applyStartOfActivationEffects()
  const _suActivationUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  if (_suActivationUpgrades.length) {
    // [Wookiee Avenger] (Chewbacca): per alexanbv 2026-05-10, the free
    // Slam is "Once during your activation" — i.e. ANYTIME during
    // activation, not locked to SoA. The SoA picker is removed in favor
    // of a `Free Slam (Wookiee Avenger)` button rendered on the DC
    // action row (components.js getDcActionButtons), which fires the
    // adjacent-hostile picker at click-time using the figure's CURRENT
    // (post-move) position. Handler: handleWookieeAvengerSlam.
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
        const _motSlice = _motFriendlies.slice(0, 24);
        const _motLabels = figureChoiceLabels(_motSlice.map(([fk]) => fk));
        const btns = _motSlice.map(([fk], i) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_motivation_${fk}`).setLabel(_motLabels[i]).setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_motivation_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `**Motivation** — Choose a friendly figure with lower cost in your LOS (recover 1 Damage or discard HARMFUL, then gain 1 MP):`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
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
        const _taSlice = _taFriendlies.slice(0, 24);
        const _taLabels = figureChoiceLabels(_taSlice.map(([fk]) => fk));
        const btns = _taSlice.map(([fk], i) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_trustedally_${fk}`).setLabel(_taLabels[i]).setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_trustedally_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `**Trusted Ally** — Choose an adjacent friendly figure (recover 1 Damage or discard 1 HARMFUL condition):`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
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

  // D37. Imperial Citadel — migrated to SoA orchestrator (destruct
  // 2026-05-07). Descriptor enumerated in soa-orchestrator.js
  // enumerateActivatorSoaDescriptors when activator is Imperial AND
  // its team owns [Imperial Citadel] AND tokens > 0.

  // D38. I Make the Rules Now — now handled by applyStartOfActivationEffects()

  // D39. Calming Presence — migrated to SoA orchestrator (destruct
  // 2026-05-07). Owner = Yoda's player (the activator's team).
  // Trigger fires at the activating figure's start, NOT Yoda's. Max 1
  // HARMFUL condition discarded; activating figure suffers 1 Strain.
  // Descriptor in soa-orchestrator.js enumerateActivatorSoaDescriptors.

  // D40. Unshakable: migrated to SoA orchestrator (slice 6 — destruct
  // 2026-05-07). Friendly-only trigger; descriptor in activator's
  // bucket. See soa-orchestrator.js enumerateActivatorSoaDescriptors.

  // D41. Nemik's Manifesto: NOT SoA per destruct 2026-05-07 — exhaust
  // anytime during activation. Button is posted at activation start for
  // visibility but stays clickable throughout the activation.
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
        await thread.send({ content: `📜 **Nemik's Manifesto** — At any point during this activation, you may exhaust to grant **${displayName}** +1 MP (suffers 2 Strain).`, components: [nmRow] }).catch(discordCatch);
      }
    }
  }

  // D42. [Spectre Cell]: the errata card has TWO abilities — the start-of-round
  // "distribute 1 Damage + 1 Block among friendly figures" (wired in
  // runStartOfRoundDcEffects, src/handlers/round.js, spectre_cell_dist_) AND this
  // activation-time exhaust: during a friendly figure's activation, exhaust to
  // choose ANOTHER friendly figure who gains +2 MP and may interrupt to attack.
  // The button is posted at activation start but stays clickable anytime during
  // the activation; the chosen friendly's interrupt attack uses the granted_attack_
  // primitive via the sc_fig_pick handler (src/handlers/activation.js).
  // (alexanbv 2026-06-18: restored — the exhaust is NOT pre-errata, it coexists
  // with the SoR distribute.)
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
          await thread.send({ content: `**[Spectre Cell]** — At any point during this activation, exhaust to choose another friendly figure: +2 MP and may interrupt to perform an attack.`, components: [scRow] }).catch(discordCatch);
        }
      }
    }
  }

  // D43. Voracious (Rancor): migrated to SoA orchestrator (slice 6 —
  // destruct 2026-05-07). See soa-orchestrator.js
  // enumerateActivatorSoaDescriptors / soa-handler.js voracious sub-
  // prompt + fire path. Once-per-round limit tracked via
  // game.voraciousUsed (cleared at round start via ROUND_OBJECT_FLAGS).
  // The previous inline auto-prompt set up pendingVoracious + posted
  // act_passive_*_voracious_* buttons that had no handler — broken
  // before this slice; orchestrator path is the canonical wiring now.

  // D44. Companion activation ordering: migrated to SoA orchestrator
  // (slice 8c — destruct 2026-05-07). See soa-orchestrator.js
  // (subPromptKey 'companion_order'). Old act_passive_*_companionbefore_*
  // / _companionafter_* buttons no longer posted; their handlers in
  // activation.js are dead-but-harmless until cleanup.

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
      const _natFk = figureKeyForActivation(game, msgId);
      if (_natFk) game.freeAttackBonusPending[_natFk] = true;
      if (_natData?.dice && _natFk) {
        // Per alexanbv 2026-05-13: keyed by activator figureKey.
        game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
        game.pendingOverrideAttackDice[_natFk] = { type: _natData.melee ? 'Melee' : null, dice: _natData.dice, pierce: 0, bonusAccuracy: 0 };
      }
      delete game.nextActivationFreeAttack[playerNum];
      if (logGameAction) await logGameAction(game, client, `**Meditation** — **${displayName}** has a free attack targeting an adjacent figure (using its own attack pool) available this activation.`, { phase: 'ROUND', icon: 'card' });
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
  saveGames(game.gameId);
  const logCh = await fetchGameChannel(client, game.generalId);
  const icon = ACTION_ICONS.activate || '⚡';
  const pLabel = `P${playerNum}`;
  const logMsg = await logCh.send(sanitizeMentions({
    content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${ownerId}> activated **${displayName}**!`,
    allowedMentions: { users: [ownerId] },
  }));
  game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
  game.dcActivationLogMessageIds[msgId] = logMsg.id;
  saveGames(game.gameId); // save again after storing log message ID

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
