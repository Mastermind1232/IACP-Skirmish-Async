/**
 * Round handlers: end_end_of_round_, end_start_of_round_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDcEffects, getMapData, getFormCards, getCcEffectsData, getMapTokensData as _getMapTokensData } from '../data-loader.js';
import { getConfig, getFormsChosenByTeamClawdites } from '../game/figure-config.js';
import { cleanupRoundStart } from '../game/activation-state.js';
import { reduceHp, healHp, healHpDistributed, applyCondition, filterCondition, dcNameFromFigureKey, parseFigureKey, awardKillVp, awardObjectiveVp, deductVp, grantPowerTokens, grantMovementBank, buildFigureButtonLabel, getMaxPowerTokens } from '../game/index.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { processFigureDefeat } from '../engine/defeat-handler.js';
import { sendPowerTokenOverflowUI } from './combat.js';
import { updateDcCardMessage } from '../engine/message-updaters.js';
import { countSpaces } from '../game/spatial.js';
import { edgeKey } from '../game/coords.js';
import { cardNameIncludes } from '../game/card-names.js';
import { getDeploymentZones, getCcEffect, hasMissionFlag } from '../data-loader.js';
import { setPendingMissionSorReveal, clearPendingMissionSorReveal, setPendingChannelTheForceStrain, clearPendingChannelTheForceStrain } from '../game/interrupts.js';
import { setRoundPhase, ROUND_PHASES } from '../game/phase.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getPlayAreaId, getHandChannelId,
  getCcHand, getCcDeck, getCcDiscard, getDcAttachments,
  setActivatedDcIndices, recomputeActivationCounts,
  ccHandKey, ccDiscardKey, ccDeckKey,
  opponentPlayerNum, syncHealthStateToList,
  getInitiativePlayerNum,
  removeFigurePosition,
} from '../game/player-helpers.js';
import { checkStartOfRoundPassiveRedraws } from '../game/cc-passive-redraw.js';
import { FIGURE_LETTERS, chunkButtonsToRows, truncateLabel } from '../discord/components.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { requireGame, requireParticipant } from '../utils/guards.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';

/**
 * Stash pending button customIds on game.pendingSorActions so getAvailableActions
 * can surface them for the AI / selfplay without duplicating button-generation logic.
 * @param {object} game
 * @param {Array} buttons - ButtonBuilder instances or objects with customId/custom_id
 * @param {string} label - Human-readable label for the effect
 * @param {number} playerNum - Owning player
 */
function _stashSorActions(game, buttons, label, playerNum) {
  game.pendingSorActions = game.pendingSorActions || [];
  const newActions = buttons.map(b => ({
    type: 'sor_effect',
    customId: b.data?.custom_id ?? b.customId ?? b,
    description: `SOR: ${label}`,
    playerNum,
  }));
  game.pendingSorActions.push(...newActions);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, updateHandChannelMessages, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState, isDepletedRemovedFromGame, buildDcEmbedAndFiles, getDcPlayAreaComponents, countTerminalsControlledByPlayer, isFigureInDeploymentZone, checkWinConditions, getMapTokensData, getSpaceController, getMissionRules, runEndOfRoundRules, getFiguresOnOrAdjacentToSpace, runNpcThugActivation, applyNpcDamageToFigure, getMapData, getMapRegistry, filterMapSpacesByBounds, getInitiativePlayerZoneLabel, updateHandVisualMessage, buildHandDisplayPayload, sendRoundActivationPhaseMessage, buildBoardMapPayload, postDevaronDoorButtons, postDevaronCratePushPrompts, postKryknaPushButtons, client
 */
export async function handleEndEndOfRound(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    getPlayerZoneLabel,
    logGameAction,
    updateHandChannelMessages,
    saveGames,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    isDepletedRemovedFromGame,
    renderDcEmbed,
    getDcPlayAreaComponents,
    countTerminalsControlledByPlayer,
    isFigureInDeploymentZone,
    checkWinConditions,
    getMapTokensData,
    getSpaceController,
    getMissionRules,
    runEndOfRoundRules,
    runStartOfRoundRules,
    getFiguresOnOrAdjacentToSpace,
    runNpcThugActivation,
    runNpcKryknaActivation,
    applyNpcDamageToFigure,
    getMapData,
    getMapRegistry,
    filterMapSpacesByBounds,
    getInitiativePlayerZoneLabel,
    updateHandVisualMessage,
    buildHandDisplayPayload,
    sendRoundActivationPhaseMessage,
    buildBoardMapPayload,
    postDevaronDoorButtons,
    postDevaronCratePushPrompts,
    postKryknaPushButtons,
    client,
  } = ctx;
  const gameId = parseCustomId(interaction.customId, 'end_end_of_round_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  if (!game.endOfRoundWhoseTurn) {
    await interaction.followUp({ content: 'Not in End of Round window.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (interaction.user.id !== game.endOfRoundWhoseTurn) {
    await interaction.followUp({ content: "It's not your turn in the End of Round window.", ephemeral: true }).catch(discordCatch);
    return;
  }
  const initiativeId = game.initiativePlayerId;
  const otherId = initiativeId === game.player1Id ? game.player2Id : game.player1Id;
  if (interaction.user.id === initiativeId) {
    game.endOfRoundWhoseTurn = otherId;
    const initNum = initiativeId === game.player1Id ? 1 : 2;
    const otherNum = 3 - initNum;
    const otherZone = getPlayerZoneLabel(game, otherId);
    await logGameAction(game, client, `**End of Round** — 2. Initiative done ✓. 3. <@${otherId}> (${otherZone}Player ${otherNum}) — your turn for end-of-round effects. Click **End 'End of Round' window** in your Hand when done.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [otherId] } });
    await updateHandChannelMessages(game, client);
    saveGames(game.gameId);
    return;
  }
  game.endOfRoundWhoseTurn = null;

  // Phase gate: both players confirm before advancing to status phase
  const { sendPhaseGateMessages: _eorSendGate } = ctx;
  if (_eorSendGate) {
    if (interaction?.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
    await _eorSendGate(game, 'post_end_of_round', ctx);
    saveGames(game.gameId);
    return;
  }
  // Fallback: no gate function available, run status phase directly
  await _runStatusPhaseLogic(game, gameId, interaction, ctx);
}

/**
 * Extracted status phase logic — called after post_end_of_round gate clears
 * or directly from handleEndEndOfRound if no gate function is available.
 * Also exported so phase-gate dispatchPhaseAdvance can call it.
 */
export async function runStatusPhaseAfterEndOfRound(game, ctx) {
  const gameId = game.gameId;
  await _runStatusPhaseLogic(game, gameId, null, ctx);
}

async function _runStatusPhaseLogic(game, gameId, interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    getPlayerZoneLabel,
    logGameAction,
    updateHandChannelMessages,
    saveGames,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    isDepletedRemovedFromGame,
    renderDcEmbed,
    getDcPlayAreaComponents,
    countTerminalsControlledByPlayer,
    isFigureInDeploymentZone,
    checkWinConditions,
    getMapTokensData,
    getSpaceController,
    getMissionRules,
    runEndOfRoundRules,
    runStartOfRoundRules,
    getFiguresOnOrAdjacentToSpace,
    runNpcThugActivation,
    runNpcKryknaActivation,
    applyNpcDamageToFigure,
    getMapData: getMapDataFn,
    getMapRegistry,
    filterMapSpacesByBounds,
    getInitiativePlayerZoneLabel,
    updateHandVisualMessage,
    buildHandDisplayPayload,
    sendRoundActivationPhaseMessage,
    buildBoardMapPayload,
    postDevaronDoorButtons,
    postDevaronCratePushPrompts,
    postKryknaPushButtons,
    postFluctuationSwapButtons,
    client,
  } = ctx;

  game.dcFinishedPinged = {};
  game.pendingEndTurn = {};
  // G102: Ready (un-exhaust) all Skirmish Upgrades BEFORE End of Round effects,
  // so cards like Zillo Technique can be used during EOR triggers.
  if (game.exhaustedSkirmishUpgrades) {
    for (const msgId of Object.keys(game.exhaustedSkirmishUpgrades)) {
      delete game.exhaustedSkirmishUpgrades[msgId];
    }
  }
  // Stun is NOT cleared at end of round — figure must spend 1 action to remove it (rules: STUNNED L2759-2762).
  // Weakened is NOT cleared here — rules say "discarded at the end of a figure's activation" only.
  // Disarm permanent Weakened lock: clear at end of round (Disarm card leaves play at end of round).
  game.disarmPermanentWeakened = {};

  // ══ STEP 1: Ready Cards (rules: STATUS PHASE IN A SKIRMISH L2714-2715) ══
  // SU ready already done above (L170-176). Now ready all DCs (un-exhaust).
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (isDepletedRemovedFromGame(game, msgId)) continue;
    dcExhaustedState.set(msgId, false);
    if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
    if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
    if (game.exhaustedSkirmishUpgrades?.[msgId]) delete game.exhaustedSkirmishUpgrades[msgId];
    await updateDcCardMessage(client, game, msgId, ctx, { exhausted: false, errorContext: 'Failed to ready DC embed:' });
  }
  // Regenerate the board map so condition icons and updated health are reflected
  if (buildBoardMapPayload && game.boardId && game.selectedMap) {
    try {
      const boardChannel = await fetchGameChannel(client, game.boardId);
      const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
      await withDiscordRetry(() => boardChannel.send(payload));
    } catch (err) {
      console.error('Failed to refresh board at end of round:', err);
    }
  }
  for (const pn of [1, 2]) {
    setActivatedDcIndices(game, pn, []);
    recomputeActivationCounts(game, pn);
  }

  // ══ STEP 2: Draw Command Cards (rules: STATUS PHASE IN A SKIRMISH L2716-2717) ══
  const mapId = game.selectedMap?.id;
  const p1Terminals = mapId ? countTerminalsControlledByPlayer(game, 1, mapId) : 0;
  const p2Terminals = mapId ? countTerminalsControlledByPlayer(game, 2, mapId) : 0;
  // Rebel High Command: draw 1 additional CC at end of each round
  const p1HasRHC = (getDcList(game, 1) || []).some(dc => (dc.dcName || dc) === '[Rebel High Command]');
  const p2HasRHC = (getDcList(game, 2) || []).some(dc => (dc.dcName || dc) === '[Rebel High Command]');
  let p1DrawCount = 1 + p1Terminals + (p1HasRHC ? 1 : 0);
  let p2DrawCount = 1 + p2Terminals + (p2HasRHC ? 1 : 0);
  // Channel the Force: draw 1 fewer, then search deck for FORCE USER CC
  const p1HasCtF = (getDcList(game, 1) || []).some(dc => (dc.dcName || dc) === '[Channel the Force]');
  const p2HasCtF = (getDcList(game, 2) || []).some(dc => (dc.dcName || dc) === '[Channel the Force]');
  // Check if not already exhausted
  const _ctfExhCheck = (pn) => {
    const dcList = getDcList(game, pn) || [];
    const dcMsgIds = getDcMessageIds(game, pn) || [];
    for (let i = 0; i < dcList.length; i++) {
      if ((dcList[i]?.dcName || dcList[i]) === '[Channel the Force]') {
        const mid = dcMsgIds[i];
        if (mid && !cardNameIncludes(game.exhaustedSkirmishUpgrades?.[mid], 'Channel the Force')) return mid;
      }
    }
    return null;
  };
  const p1CtFMsgId = p1HasCtF ? _ctfExhCheck(1) : null;
  const p2CtFMsgId = p2HasCtF ? _ctfExhCheck(2) : null;
  if (p1CtFMsgId && p1DrawCount > 0) p1DrawCount = Math.max(0, p1DrawCount - 1);
  if (p2CtFMsgId && p2DrawCount > 0) p2DrawCount = Math.max(0, p2DrawCount - 1);
  const hadCutLines = !!game.noCommandDrawThisRound;
  if (game.noCommandDrawThisRound) {
    p1DrawCount = 0;
    p2DrawCount = 0;
    game.noCommandDrawThisRound = false;
  }

  // Data Theft: return stolen card to opponent's discard if still in hand at end of round
  if (game.dataTheftStolenCard) {
    const dt = game.dataTheftStolenCard;
    const dtHandKey = ccHandKey(dt.playerNum);
    const dtOppNum = opponentPlayerNum(dt.playerNum);
    const dtOppDiscardKey = ccDiscardKey(dtOppNum);
    const dtHand = game[dtHandKey] || [];
    const dtIdx = dtHand.indexOf(dt.cardName);
    if (dtIdx >= 0) {
      dtHand.splice(dtIdx, 1);
      game[dtHandKey] = dtHand;
      game[dtOppDiscardKey] = (game[dtOppDiscardKey] || []).concat([dt.cardName]);
      await logGameAction(game, client, `📋 **Data Theft** — **${dt.cardName}** returned to opponent's discard (unplayed).`, { phase: 'ROUND' });
    }
    game.dataTheftStolenCard = null;
  }

  const p1Deck = game.player1CcDeck || [];
  const p2Deck = game.player2CcDeck || [];
  const p1Drawn = [];
  const p2Drawn = [];
  for (let i = 0; i < p1DrawCount && p1Deck.length > 0; i++) {
    const drawn = p1Deck.shift();
    p1Drawn.push(drawn);
  }
  game.player1CcHand = [...(game.player1CcHand || []), ...p1Drawn];
  game.player1CcDeck = p1Deck;
  for (let i = 0; i < p2DrawCount && p2Deck.length > 0; i++) {
    const drawn = p2Deck.shift();
    p2Drawn.push(drawn);
  }
  game.player2CcHand = [...(game.player2CcHand || []), ...p2Drawn];
  game.player2CcDeck = p2Deck;

  // Channel the Force: search deck for FORCE USER CC, add to hand, shuffle, suffer Strain
  for (const _ctfPn of [1, 2]) {
    const _ctfMid = _ctfPn === 1 ? p1CtFMsgId : p2CtFMsgId;
    if (!_ctfMid || hadCutLines) continue;
    // Exhaust the card
    game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
    game.exhaustedSkirmishUpgrades[_ctfMid] = [...(game.exhaustedSkirmishUpgrades[_ctfMid] || []), 'Channel the Force'];
    // Find FORCE USER cards in deck
    const _ctfDeckKey = _ctfPn === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const _ctfDeck = game[_ctfDeckKey] || [];
    const _ctfCcEffData = getCcEffectsData?.()?.cards || {};
    const _ctfForceCards = [];
    for (let ci = 0; ci < _ctfDeck.length; ci++) {
      const ccName = _ctfDeck[ci];
      const ccEff = _ctfCcEffData[ccName];
      const playableBy = String(ccEff?.playableBy || '').toUpperCase();
      if (playableBy.includes('FORCE USER')) _ctfForceCards.push({ name: ccName, deckIdx: ci });
    }
    if (_ctfForceCards.length === 0) {
      await logGameAction(game, client, `**Channel the Force** — P${_ctfPn} searched deck but found no FORCE USER Command cards.`, { phase: 'ROUND', icon: 'card' });
      continue;
    }
    // Dedupe by card name for button display
    const _ctfUnique = [...new Map(_ctfForceCards.map(c => [c.name, c])).values()];
    const handChId = getHandChannelId(game, _ctfPn);
    if (handChId) {
      try {
        const handCh = await fetchGameChannel(client, handChId);
        const btns = _ctfUnique.slice(0, 20).map((c, i) =>
          new ButtonBuilder()
            .setCustomId(`ctf_pick_${gameId}_${_ctfPn}_${i}`)
            .setLabel(truncateLabel(c.name))
            .setStyle(ButtonStyle.Primary)
        );
        const rows = chunkButtonsToRows(btns);
        game[`pendingChannelTheForce_p${_ctfPn}`] = { cards: _ctfUnique };
        await handCh.send({
          content: `**Channel the Force** — Choose a FORCE USER Command card from your deck to add to your hand:`,
          components: rows.slice(0, 5),
        });
      } catch (err) {
        console.error('Channel the Force pick error:', err);
      }
    }
  }

  // ══ STEP 3: End of Round Effects (rules: STATUS PHASE IN A SKIRMISH L2718) ══
  // Per CRR + alexanbv 2026-05-10: mission EoR rules fire FIRST, before
  // either player's DC EoR effects. Within DC EoR (further down), the
  // initiative player resolves their effects before the non-initiative
  // player.
  const variant = game.selectedMission?.variant;
  const missionRules = getMissionRules?.(mapId, variant) ?? {};
  const endOfRoundRules = missionRules.endOfRound;
  if (endOfRoundRules && runEndOfRoundRules) {
    const ruleCtx = { logGameAction, checkWinConditions, getMapTokensData, getSpaceController, isFigureInDeploymentZone, getFiguresOnOrAdjacentToSpace, countTerminalsControlledByPlayer, client };
    const { gameEnded } = await runEndOfRoundRules(game, mapId, variant, endOfRoundRules, ruleCtx);
    if (gameEnded) {
      if (interaction?.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    if (game.pendingPowerTokenOverflow?.length > 0) {
      const _ovCh = await fetchGameChannel(client, game.generalId);
      if (_ovCh) {
        const _ovEntry = game.pendingPowerTokenOverflow[0];
        const _ovPn = Object.entries(game.figurePositions || {}).find(([, figs]) => figs?.[_ovEntry.figureKey])?.[0];
        await sendPowerTokenOverflowUI(game, gameId, _ovCh, _ovPn ? parseInt(_ovPn, 10) : 1, saveGames);
      }
    }
  }

  // NPC thug activation (Corellian Underground A — driven by rules.npcThugs flag)
  // alexanbv 2026-05-10: Player with initiative moves all thugs 1 at a time
  // via an interactive picker. After all thugs moved, damage applies. The
  // picker handler in src/handlers/thug-movement.js resumes the round-end
  // chain via the closure registered as game._resumeAfterThugMovementFn.
  if (runNpcThugActivation && hasMissionFlag(mapId, variant, 'npcThugs')) {
    if (!game.npcThugs) {
      const missionData = getMapTokensData?.()[mapId]?.missionA;
      const positions = Object.values(missionData?.positions || {}).flat().filter(Boolean);
      if (positions.length > 0) {
        game.npcThugs = positions.map((coord, i) => ({ id: `thug-${i + 1}`, coord: String(coord).toLowerCase(), hp: 4, maxHp: 4, defeated: false, hostility: 'hostile' }));
      }
    }
    const activeIndexes = (game.npcThugs || []).map((t, i) => (t && !t.defeated ? i : -1)).filter((i) => i >= 0);
    if (activeIndexes.length > 0) {
      const { initThugMovementQueue } = await import('../game/thug-movement.js');
      const { postThugPickerPrompt } = await import('./thug-movement.js');
      const initPN = getInitiativePlayerNum(game);
      initThugMovementQueue(game, initPN, mapId);
      const _resumeVars = { p1Terminals, p1HasRHC, p2Terminals, p2HasRHC, p1DrawCount, p2DrawCount, hadCutLines };
      // Resume continuation: after the picker drains, run _runDcEorAndContinue
      // which preserves CRR order — DC EoR (Regenerate / Hardy / WYIM /
      // Driven by Hatred / Inspiration / ...) → Krykna note → fluctuation
      // gate → initiative swap. Critical: DC EoR MUST run on rounds where
      // the thug picker fires (otherwise every Corellian Underground A
      // round silently skips player EoR effects).
      game._resumeAfterThugMovementFn = async (g, c) => {
        await _runDcEorAndContinue(g, g.gameId, null, c, _resumeVars);
      };
      await postThugPickerPrompt(game, client, interaction?.channel);
      if (interaction?.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
  }

  await _runDcEorAndContinue(game, gameId, interaction, ctx,
    { p1Terminals, p1HasRHC, p2Terminals, p2HasRHC, p1DrawCount, p2DrawCount, hadCutLines });
}

/**
 * DC EoR loops + post-DC tail (Krykna push / fluctuation gate / initiative
 * swap). Called both inline by handleEndEndOfRound (no thug picker) and by
 * the thug-picker resume continuation after the picker drains — so DC EoR
 * always runs after mission EoR per CRR, even on rounds where the thug
 * picker intercepts the inline flow.
 */
export async function _runDcEorAndContinue(game, gameId, interaction, ctx, logVars) {
  const {
    logGameAction, client, saveGames,
    dcMessageMeta, dcHealthState, isDepletedRemovedFromGame,
    isFigureInDeploymentZone, checkWinConditions,
    postFluctuationSwapButtons,
  } = ctx;
  const { p1Terminals, p1HasRHC, p2Terminals, p2HasRHC, p1DrawCount, p2DrawCount, hadCutLines } = logVars;
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;

  // DC ability EoR effects (run after mission EoR per CRR)
  const dcEffects = getDcEffects();
  // Regenerate (Bossk): recover 2 HP and discard Bleed at end of round
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (isDepletedRemovedFromGame(game, msgId)) continue;
    const eff = dcEffects[meta.dcName] || dcEffects[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
    if (!(eff?.specialAbilityIds || []).includes('regenerate_bossk')) continue;
    const { totalRecovered } = healHpDistributed(dcHealthState, game, msgId, 2, meta.playerNum);
    if (totalRecovered > 0) {
      await logGameAction(game, client, `♻️ **Regenerate** — **${meta.dcName}** recovered ${totalRecovered} HP.`, { phase: 'ROUND', icon: 'round' });
    }
    // Discard all Harmful conditions (CRR: Bleed, Stun, Weaken)
    const _regenHarmful = ['Bleed', 'Stun', 'Weaken'];
    let _regenCleared = false;
    for (const fk of Object.keys(game.figureConditions || {})) {
      if (!fk.startsWith(meta.dcName + '-')) continue;
      const _regenBefore = game.figureConditions[fk]?.length || 0;
      for (const h of _regenHarmful) filterCondition(game, fk, h);
      if ((game.figureConditions[fk]?.length || 0) < _regenBefore) _regenCleared = true;
    }
    if (_regenCleared) {
      await logGameAction(game, client, `♻️ **Regenerate** — **${meta.dcName}** discarded harmful conditions.`, { phase: 'ROUND', icon: 'round' });
    }
  }
  // Hardy (Trandoshan Hunter Elite): discard all HARMFUL conditions at end of round
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (isDepletedRemovedFromGame(game, msgId)) continue;
    const _hardyEff = dcEffects[meta.dcName] || dcEffects[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
    if (!(_hardyEff?.passives || []).includes('Hardy')) continue;
    const HARMFUL = ['Bleed', 'Stun', 'Weaken'];
    let cleared = false;
    for (const fk of Object.keys(game.figureConditions || {})) {
      if (!fk.startsWith(meta.dcName + '-')) continue;
      const before = game.figureConditions[fk]?.length || 0;
      for (const h of HARMFUL) filterCondition(game, fk, h);
      if ((game.figureConditions[fk]?.length || 0) < before) cleared = true;
    }
    if (cleared) {
      await logGameAction(game, client, `💪 **Hardy** — **${meta.dcName}** discarded all harmful conditions at end of round.`, { phase: 'ROUND', icon: 'round' });
    }
  }

  // What's Yours is Mine (Hondo): at end of round, if in opponent's deployment zone, steal 2 VP
  {
    const _wymEff = getDcEffects() || {};
    for (const pn of [1, 2]) {
      const dcList = getDcList(game, pn) || [];
      const msgIds = getDcMessageIds(game, pn) || [];
      for (let i = 0; i < dcList.length; i++) {
        const dc = dcList[i];
        if (!dc || dc.defeated) continue;
        const eff = _wymEff[dc.dcName] || _wymEff[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!(eff?.specialAbilityIds || []).includes('whats_yours_is_mine_hondo')) continue;
        const mid = msgIds[i];
        if (!mid) continue;
        const ownerId = getPlayerId(game, pn);
        const oppNum = opponentPlayerNum(pn);
        // Auto-check if any figure of this DC is in the opponent's deployment zone
        const mapId = game.selectedMap?.id;
        if (mapId && isFigureInDeploymentZone) {
          // Check if any figure of this DC is in the OPPONENT's deployment zone
          const _wymFigPos = game.figurePositions?.[pn] || {};
          let _wymInOppZone = false;
          for (const fk of Object.keys(_wymFigPos)) {
            if (!fk.startsWith(dc.dcName + '-')) continue;
            if (!_wymFigPos[fk]) continue;
            // isFigureInDeploymentZone checks if figure is in their OWN zone, so we need to check oppNum's zone manually
            const _wymZoneData = getDeploymentZones()[mapId];
            if (!_wymZoneData) break;
            const _wymInitPn = getInitiativePlayerNum(game);
            const _wymOppZone = oppNum === _wymInitPn ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
            const _wymOppSpaces = new Set((_wymZoneData[_wymOppZone] || []).map(s => String(s).toLowerCase()));
            if (_wymOppSpaces.has(String(_wymFigPos[fk]).toLowerCase())) { _wymInOppZone = true; break; }
          }
          if (_wymInOppZone) {
            // Steal 2 VP: deduct from opponent, add to owner
            const _wymOppVpKey = oppNum === 1 ? 'player1VP' : 'player2VP';
            const _wymSteal = Math.min(2, game[_wymOppVpKey]?.total || 0);
            deductVp(game, oppNum, _wymSteal);
            awardObjectiveVp(game, pn, _wymSteal);
            await logGameAction(game, client, `💰 **What's Yours is Mine** — **${dc.displayName || dc.dcName}** is in the opponent's deployment zone! Stole **${_wymSteal} VP** from Player ${oppNum}.`, { phase: 'ROUND', icon: 'round' });
            await checkWinConditions(game, client);
          } else {
            await logGameAction(game, client, `💰 **What's Yours is Mine** — **${dc.displayName || dc.dcName}** is not in the opponent's deployment zone. No VP stolen.`, { phase: 'ROUND', icon: 'round' });
          }
        }
      }
    }
  }

  // Self-Destruct Probe: prompt each player who has a live Probe Droid DC
  const _sdpEffs = getDcEffects();
  for (const [_pNum, _getDcIds, _getDcListF] of [[1, () => game.p1DcMessageIds, () => game.p1DcList], [2, () => game.p2DcMessageIds, () => game.p2DcList]]) {
    const _sdpIds = _getDcIds() || [];
    const _sdpList = _getDcListF() || [];
    for (let _i = 0; _i < _sdpIds.length; _i++) {
      const _probeMsgId = _sdpIds[_i];
      if (!_probeMsgId) continue;
      const _probeDc = _sdpList[_i];
      if (!_probeDc || _probeDc.defeated) continue;
      const _probeEff = _sdpEffs[_probeDc.dcName] || _sdpEffs[_probeDc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
      if (!(_probeEff?.specialAbilityIds || []).includes('self_destruct_probe')) continue;
      const _probeOwnerId = getPlayerId(game, _pNum);
      const _sdpRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`self_destruct_probe_use_${gameId}_${_probeMsgId}`).setLabel('Use Self-Destruct').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`self_destruct_probe_skip_${gameId}_${_probeMsgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await logGameAction(game, client, `<@${_probeOwnerId}> **Self-Destruct** (${_probeDc.displayName || _probeDc.dcName}) — use at end of round?`, {
        components: [_sdpRow],
        allowedMentions: { users: [_probeOwnerId] },
      });
    }
  }

  // Apply end-of-round self damage (e.g. Blaze of Glory)
  const eorSelfDamage = game.endOfRoundSelfDamage;
  if (eorSelfDamage && typeof eorSelfDamage === 'object') {
    for (const playerNum of [1, 2]) {
      const entry = eorSelfDamage[playerNum];
      if (!entry || typeof entry.damage !== 'number') continue;
      const msgId = entry.msgId;
      if (!msgId || !dcMessageMeta.get(msgId)) continue;
      const _eorDcN = dcMessageMeta.get(msgId)?.dcName || 'Figure';
      const _eorDgM = (dcMessageMeta.get(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _eorFkX = `${_eorDcN.replace(/\s*\[.*\]\s*$/, '').trim()}-${_eorDgM ? _eorDgM[1] : '1'}-0`;
      const { wasDefeated: _eorDied } = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
        figureKey: _eorFkX, msgId, figIndex: 0,
        amount: entry.damage, controllerPlayerNum: playerNum,
        source: 'End-of-Round Self-Damage',
      });
      const meta = dcMessageMeta.get(msgId);
      const displayName = meta?.displayName || meta?.dcName || 'Figure';
      await logGameAction(game, client, `**End of round:** ${displayName} suffered ${entry.damage} Damage (e.g. Blaze of Glory).`, { phase: 'ROUND', icon: 'round' });
      if (_eorDied) {
        const _eorDcName = meta?.dcName || 'Figure';
        const _eorDgMatch = (meta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const _eorDgIdx = _eorDgMatch ? _eorDgMatch[1] : '0';
        const _eorFigKey = `${_eorDcName.replace(/\s*\[.*\]\s*$/, '').trim()}-${_eorDgIdx}-0`;
        const _eorDcIds = getDcMessageIds(game, playerNum) || [];
        const _eorIdx = _eorDcIds.indexOf(msgId);
        await processFigureDefeat(game, {
          defeatedPlayerNum: playerNum,
          figureKey: _eorFigKey,
          attackerPlayerNum: playerNum,
          msgId,
          dcIdx: _eorIdx,
          dcName: _eorDcName,
          displayName,
          source: 'Blaze of Glory',
          awardVp: false,
        }, {
          removeFigurePosition,
          calculateKillVp: () => 0,
          awardKillVp,
          dcNameFromFigureKey,
          logGameAction,
          client,
          checkWinConditions,
        });
      }
    }
    game.endOfRoundSelfDamage = {};
  }
  // Second Chance: end-of-round — recover 2 Damage for any DC that still has Second Chance, then discard
  if (game.secondChanceDcMsgId && typeof game.secondChanceDcMsgId === 'object') {
    for (const [msgId, pn] of Object.entries(game.secondChanceDcMsgId)) {
      const meta = dcMessageMeta.get(msgId);
      if (!meta) continue;
      const healthState = dcHealthState.get(msgId);
      if (!healthState) continue;
      for (let fi = 0; fi < healthState.length; fi++) {
        const hp = healthState[fi];
        if (!Array.isArray(hp)) continue;
        const [cur, max] = hp;
        const damage = (max ?? cur) - (cur ?? 0);
        if (damage <= 0) continue;
        const heal = Math.min(2, damage);
        healthState[fi] = [(cur ?? 0) + heal, max];
        dcHealthState.set(msgId, healthState);
        syncHealthStateToList(game, pn, msgId, healthState);
        await logGameAction(game, client, `**Second Chance** (end of round) — **${meta.displayName || meta.dcName}** recovered ${heal} Damage. Card discarded.`, { phase: 'ROUND', icon: 'card' });
        break; // only heal first damaged figure
      }
    }
    game.secondChanceDcMsgId = {};
  }
  // Adrenaline: deal 5 Damage then revert +5 maxHp bonus for each boosted WOOKIEE
  if (game.adrenalineBonuses && typeof game.adrenalineBonuses === 'object') {
    for (const [msgId, info] of Object.entries(game.adrenalineBonuses)) {
      const pn = info.playerNum;
      if (!dcMessageMeta.get(msgId)) continue;
      const healthState = dcHealthState.get(msgId);
      if (!healthState) continue;
      for (let fi = 0; fi < healthState.length; fi++) {
        if (!Array.isArray(healthState[fi])) continue;
        const [cur, max] = healthState[fi];
        const curHp = cur ?? max ?? 0;
        const maxHp = max ?? cur ?? 0;
        // 1. Suffer 5 damage
        const afterDamage = Math.max(0, curHp - 5);
        // 2. Revert the +5 max HP bonus
        const newMax = Math.max(0, maxHp - 5);
        // Clamp current to new max
        const newCur = Math.min(afterDamage, newMax);
        healthState[fi] = [newCur, newMax];
      }
      dcHealthState.set(msgId, healthState);
      // Sync to dcList
      const dcIds = getDcMessageIds(game, pn) || [];
      const dcListArr = getDcList(game, pn) || [];
      const idx = dcIds.indexOf(msgId);
      if (idx >= 0 && dcListArr[idx]) dcListArr[idx].healthState = [...healthState];
      // Check for defeats
      const meta = dcMessageMeta.get(msgId);
      const dgMatch = meta?.displayName?.match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : '0';
      for (let fi = 0; fi < healthState.length; fi++) {
        if (!Array.isArray(healthState[fi])) continue;
        if (healthState[fi][0] <= 0) {
          // Figure defeated by Adrenaline end-of-round damage (self-inflicted, no VP)
          const baseName = (info.dcName || 'Figure').replace(/\s*\[.*\]\s*$/, '').trim();
          const figureKey = `${baseName}-${dgIndex}-${fi}`;
          await processFigureDefeat(game, {
            defeatedPlayerNum: pn,
            figureKey,
            attackerPlayerNum: pn,
            msgId,
            dcIdx: idx,
            dcName: info.dcName,
            displayName: info.dcName,
            source: 'Adrenaline',
            awardVp: false,
          }, {
            removeFigurePosition,
            calculateKillVp: () => 0,
            awardKillVp,
            dcNameFromFigureKey,
            logGameAction,
            client,
            checkWinConditions,
          });
        }
      }
      await logGameAction(game, client, `**End of round — Adrenaline** — **${info.dcName}** lost **+5 Health** bonus and suffered **5 Damage**.`, { phase: 'ROUND', icon: 'round' });
    }
    game.adrenalineBonuses = {};
  }
  // Scavenged Walker: end of round, may interrupt to perform an attack with -1 Hit
  for (const pn of [1, 2]) {
    const _swMsgIds = getDcMessageIds(game, pn) || [];
    const _swDcList = getDcList(game, pn) || [];
    const _swAtts = getDcAttachments(game, pn) || {};
    for (let i = 0; i < _swMsgIds.length; i++) {
      const _swMid = _swMsgIds[i];
      if (!cardNameIncludes(_swAtts[_swMid], 'Scavenged Walker')) continue;
      const _swDc = _swDcList[i];
      if (!_swDc?.dcName || _swDc.defeated) continue;
      const _swOwnerId = game[`player${pn}Id`];
      const _swRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`scavenged_walker_attack_${gameId}_${_swMid}`).setLabel('Interrupt Attack (-1 Hit)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`scavenged_walker_skip_${gameId}_${_swMid}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await logGameAction(game, client, `<@${_swOwnerId}> **Scavenged Walker** — **${_swDc.displayName || _swDc.dcName}** may interrupt to perform an attack with -1 Hit at end of round.`, {
        components: [_swRow],
        allowedMentions: { users: [_swOwnerId] },
      });
    }
  }
  // [Rogue Smuggler] (Han Solo) — once-per-round EoR free attack.
  // Per alexanbv 2026-05-10: the card text uses "Exhaust this card" but
  // we treat this as a once-per-round ability gated on a round-scoped
  // flag (`game.roundFigureAbilityUsed[\`${msgId}_rogueSmugglerEor\`]`),
  // not via the deprecated exhaust mechanic. Round-flag is wiped at
  // start of the next round by the standard round-reset sweep.
  for (const pn of [1, 2]) {
    const _rsMsgIds = getDcMessageIds(game, pn) || [];
    const _rsDcList = getDcList(game, pn) || [];
    const _rsAtts = getDcAttachments(game, pn) || {};
    for (let i = 0; i < _rsMsgIds.length; i++) {
      const _rsMid = _rsMsgIds[i];
      if (!cardNameIncludes(_rsAtts[_rsMid], 'Rogue Smuggler')) continue;
      const _rsRoundKey = `${_rsMid}_rogueSmugglerEor`;
      if (game.roundFigureAbilityUsed?.[_rsRoundKey]) continue;
      const _rsDc = _rsDcList[i];
      if (!_rsDc?.dcName || _rsDc.defeated) continue;
      const _rsDgIdx = (_rsDc.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _rsFk = `${_rsDc.dcName}-${_rsDgIdx}-0`;
      if (!game.figurePositions?.[pn]?.[_rsFk]) continue;
      const _rsOwnerId = game[`player${pn}Id`];
      const _rsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rs_attack_${gameId}_${_rsMid}`).setLabel('Free Attack ([Rogue Smuggler])').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`rs_skip_${gameId}_${_rsMid}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await logGameAction(game, client,
        `<@${_rsOwnerId}> **[Rogue Smuggler]** — **${_rsDc.displayName || _rsDc.dcName}** may interrupt to perform a free attack at end of round (once per round).`,
        { components: [_rsRow], allowedMentions: { users: [_rsOwnerId] } });
    }
  }
  // Driven by Hatred (Darth Vader): end of round, move up to 2 spaces, then may use Force Choke or perform an attack (-1 die)
  for (const pn of [1, 2]) {
    const _dbhMsgIds = getDcMessageIds(game, pn) || [];
    const _dbhDcList = getDcList(game, pn) || [];
    const _dbhAtts = getDcAttachments(game, pn) || {};
    for (let i = 0; i < _dbhMsgIds.length; i++) {
      const _dbhMid = _dbhMsgIds[i];
      if (!cardNameIncludes(_dbhAtts[_dbhMid], 'Driven by Hatred')) continue;
      const _dbhDc = _dbhDcList[i];
      if (!_dbhDc?.dcName || _dbhDc.defeated) continue;
      const _dbhOwnerId = game[`player${pn}Id`];
      // Per alexanbv 2026-05-10: choice happens AFTER move, not before.
      // Single Move button stamps pendingMoveX with a dbhPostMovePick
      // continuation that fires the Force Choke / Attack / Skip picker
      // once the player has finished moving 0–2 spaces.
      const _dbhRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dbh_move_${gameId}_${_dbhMid}`).setLabel('Move up to 2 (then choose)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`dbh_skip_${gameId}_${_dbhMid}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await logGameAction(game, client, `<@${_dbhOwnerId}> **Driven by Hatred** — **${_dbhDc.displayName || _dbhDc.dcName}** may move up to 2 spaces, then choose Force Choke or a free attack (-1 die).`, {
        components: [_dbhRow],
        allowedMentions: { users: [_dbhOwnerId] },
      });
    }
  }
  // Survivalist (Skirmish Upgrade): end of round, if in exterior space, recover 1 Damage
  const _svMapSpaces = game.selectedMap?.id ? getMapData?.(game.selectedMap.id) : null;
  if (_svMapSpaces?.exterior) {
    const _svExterior = new Set((Array.isArray(_svMapSpaces.exterior) ? _svMapSpaces.exterior : []).map(s => String(s).toLowerCase()));
    for (const pn of [1, 2]) {
      const _svMsgIds = getDcMessageIds(game, pn) || [];
      const _svDcList = getDcList(game, pn) || [];
      const _svAtts = getDcAttachments(game, pn) || {};
      for (let i = 0; i < _svMsgIds.length; i++) {
        const _svMid = _svMsgIds[i];
        if (!cardNameIncludes(_svAtts[_svMid], 'Survivalist')) continue;
        const _svDc = _svDcList[i];
        if (!_svDc?.dcName || _svDc.defeated) continue;
        // Check if any figure in this group is in an exterior space
        const _svDgIdx = (_svDc.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _svFigs = game.figurePositions?.[pn] || {};
        for (const [fk, pos] of Object.entries(_svFigs)) {
          if (!fk.startsWith(`${_svDc.dcName}-${_svDgIdx}-`)) continue;
          if (!_svExterior.has(String(pos).toLowerCase())) continue;
          // Recover 1 HP for this figure
          const _svFi = parseFigureKey(fk).figureIndex;
          const { healed: _svHealed } = healHp(dcHealthState, game, _svMid, _svFi, 1, pn);
          if (_svHealed > 0) {
            await logGameAction(game, client, `**Survivalist** — **${_svDc.displayName || _svDc.dcName}** recovers 1 Damage (exterior space).`, { phase: 'ROUND', icon: 'round' });
          }
        }
      }
    }
  }
  // [Black Market] SU: at end of round, if owner has a friendly SMUGGLER, reveal top CC and offer 3 choices
  {
    const _bmEffs = getDcEffects();
    for (const pn of [1, 2]) {
      const _bmDcList = getDcList(game, pn) || [];
      const _bmMsgIds = getDcMessageIds(game, pn) || [];
      for (let i = 0; i < _bmDcList.length; i++) {
        const _bmDc = _bmDcList[i];
        if (!_bmDc || _bmDc.defeated) continue;
        if (_bmDc.dcName !== '[Black Market]') continue;
        const _bmMid = _bmMsgIds[i];
        if (!_bmMid) continue;
        if (isDepletedRemovedFromGame(game, _bmMid)) continue;
        // Check if this player has a friendly SMUGGLER on the board
        const _bmFigPos = game.figurePositions?.[pn] || {};
        let _bmSmugglerFk = null;
        let _bmSmugglerMsgId = null;
        let _bmSmugglerFigIdx = 0;
        for (let di = 0; di < _bmDcList.length; di++) {
          const _bmOtherDc = _bmDcList[di];
          if (!_bmOtherDc || _bmOtherDc.defeated) continue;
          const _bmOtherName = _bmOtherDc.dcName?.replace(/\s*\[.*\]\s*$/, '');
          const _bmOtherEff = _bmEffs[_bmOtherDc.dcName] || _bmEffs[_bmOtherName];
          if (!(_bmOtherEff?.keywords || []).some(k => String(k).toUpperCase() === 'SMUGGLER')) continue;
          // Found a SMUGGLER DC — find its first alive figure key
          for (const [fk, pos] of Object.entries(_bmFigPos)) {
            if (!fk.startsWith((_bmOtherName || _bmOtherDc.dcName) + '-')) continue;
            if (!pos) continue;
            // Check if figure is alive (HP > 0)
            const _bmFkMid = _bmMsgIds[di];
            if (!_bmFkMid) continue;
            const _bmFkHs = dcHealthState.get(_bmFkMid);
            const _bmFkIdx = parseFigureKey(fk).figureIndex;
            if (_bmFkHs?.[_bmFkIdx] && Array.isArray(_bmFkHs[_bmFkIdx]) && _bmFkHs[_bmFkIdx][0] > 0) {
              _bmSmugglerFk = fk;
              _bmSmugglerMsgId = _bmFkMid;
              _bmSmugglerFigIdx = _bmFkIdx;
              break;
            }
          }
          if (_bmSmugglerFk) break;
        }
        if (!_bmSmugglerFk) continue; // no alive SMUGGLER — skip
        // Peek at top CC deck card
        const _bmDeckKey = pn === 1 ? 'player1CcDeck' : 'player2CcDeck';
        const _bmDeck = game[_bmDeckKey] || [];
        if (_bmDeck.length === 0) continue; // empty deck — skip
        const _bmTopCard = _bmDeck[0];
        const _bmCcEff = getCcEffect(_bmTopCard);
        const _bmCardCost = _bmCcEff?.cost ?? 0;
        const _bmOwnerId = game[`player${pn}Id`];
        const _bmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`bm_draw_${gameId}_${_bmMid}_${pn}`).setLabel(`Draw (spend ${_bmCardCost} VP)`).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`bm_discard_${gameId}_${_bmMid}_${pn}`).setLabel(`Discard (gain ${_bmCardCost} VP)`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`bm_return_${gameId}_${_bmMid}_${pn}`).setLabel('Return to top').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`bm_skip_${gameId}_${_bmMid}_${pn}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        // Store pending state so the handler knows which card/smuggler to apply
        game.pendingBlackMarket = game.pendingBlackMarket || {};
        game.pendingBlackMarket[pn] = {
          topCard: _bmTopCard,
          cardCost: _bmCardCost,
          smugglerFk: _bmSmugglerFk,
          smugglerMsgId: _bmSmugglerMsgId,
          smugglerFigIdx: _bmSmugglerFigIdx,
        };
        const _bmSmugglerName = dcNameFromFigureKey(_bmSmugglerFk);
        await logGameAction(game, client, `<@${_bmOwnerId}> **[Black Market]** — Top CC revealed: **${_bmTopCard}** (cost ${_bmCardCost}). A friendly SMUGGLER (**${_bmSmugglerName}**) may suffer 1 Strain. Choose:`, {
          components: [_bmRow],
          allowedMentions: { users: [_bmOwnerId] },
        });
      }
    }
  }
  // [Doubt] SU: at end of round, choose hostile figure, discard 1 condition or Power Token
  for (const pn of [1, 2]) {
    const _dbtDcList = getDcList(game, pn) || [];
    const _dbtMsgIds = getDcMessageIds(game, pn) || [];
    for (let i = 0; i < _dbtDcList.length; i++) {
      const _dbtDc = _dbtDcList[i];
      if (!_dbtDc || _dbtDc.defeated) continue;
      if ((_dbtDc.dcName || _dbtDc) !== '[Doubt]') continue;
      const _dbtMid = _dbtMsgIds[i];
      if (!_dbtMid) continue;
      if (isDepletedRemovedFromGame(game, _dbtMid)) continue;
      // Find hostile figures with conditions or power tokens
      const oppPn = pn === 1 ? 2 : 1;
      const oppFigs = game.figurePositions?.[oppPn] || {};
      const _dbtCandidates = [];
      for (const [fk, pos] of Object.entries(oppFigs)) {
        if (!pos) continue;
        const conds = game.figureConditions?.[fk] || [];
        const tokens = game.figurePowerTokens?.[fk] || [];
        if (conds.length === 0 && tokens.length === 0) continue;
        _dbtCandidates.push({ fk, dcName: dcNameFromFigureKey(fk), conds, tokens });
      }
      if (_dbtCandidates.length === 0) continue;
      const _dbtOwnerId = game[`player${pn}Id`];
      const _dbtBtns = _dbtCandidates.slice(0, 24).map(({ fk, dcName: dn, conds, tokens }) => {
        const info = [...conds, ...tokens.map(t => `${t} Token`)].join(', ');
        const label = `${dn}: ${info}`;
        return new ButtonBuilder()
          .setCustomId(`doubt_fig_${gameId}_${pn}_${fk}`)
          .setLabel(truncateLabel(label))
          .setStyle(ButtonStyle.Danger);
      });
      _dbtBtns.push(new ButtonBuilder().setCustomId(`doubt_fig_${gameId}_${pn}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      const _dbtRows = chunkButtonsToRows(_dbtBtns);
      await logGameAction(game, client, `<@${_dbtOwnerId}> **[Doubt]** — Choose a hostile figure to discard 1 condition or Power Token:`, {
        components: _dbtRows.slice(0, 5),
        allowedMentions: { users: [_dbtOwnerId] },
      });
    }
  }
  // NPC Krykna push+damage phase (Chopper Base A): build push queue here; damage runs after all pushes (in modal handler)

  // NOTE: Hardy + Regenerate already processed above (lines 103-154). Duplicate block removed.

  // Fluctuation swap gate (Lothal Wastes B — driven by rules.fluctuationSwapGate flag)
  if (hasMissionFlag(mapId, variant, 'fluctuationSwapGate')) {
    const _fInitNum = getInitiativePlayerNum(game);
    const _fOtherNum = opponentPlayerNum(_fInitNum);
    game.pendingFluctuationSwapQueue = [_fInitNum, _fOtherNum];
    game.fluctuationSwappedThisRound = [];
    game.pendingFluctuationSwapFirst = null;
    game._pendingStatusPhaseLog = { p1Terminals, p1HasRHC, p2Terminals, p2HasRHC, p1DrawCount, p2DrawCount, hadCutLines };
    const _fGenCh = await fetchGameChannel(client, game.generalId);
    if (postFluctuationSwapButtons) {
      await postFluctuationSwapButtons(game, _fGenCh, gameId, _fInitNum);
    }
    if (interaction?.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  await _runInitiativeSwapAndContinue(game, gameId, interaction, ctx,
    { p1Terminals, p1HasRHC, p2Terminals, p2HasRHC, p1DrawCount, p2DrawCount, hadCutLines });
}

/**
 * Continuation after fluctuation swap (or when no swap needed).
 * Runs initiative swap, status phase log, mission SOR gate, and continues to activation phase.
 */
async function _runInitiativeSwapAndContinue(game, gameId, interaction, ctx, logVars) {
  const {
    logGameAction, client, saveGames,
    getMissionRules, getMapTokensData, runStartOfRoundRules,
    getInitiativePlayerZoneLabel,
  } = ctx;
  const { p1Terminals, p1HasRHC, p2Terminals, p2HasRHC, p1DrawCount, p2DrawCount, hadCutLines } = logVars;
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  const missionRules = getMissionRules?.(mapId, variant) ?? {};

  const prevInitiative = game.initiativePlayerId;
  game.initiativePlayerId = prevInitiative === game.player1Id ? game.player2Id : game.player1Id;
  game.currentRound = (game.currentRound || 1) + 1;
  setRoundPhase(game, ROUND_PHASES.START_OF_ROUND);
  game.startOfRoundWhoseTurn = game.initiativePlayerId;
  cleanupRoundStart(game);

  // Status Phase summary log (posted before mission SOR may pause for player prompt)
  const generalChannel = await fetchGameChannel(client, game.generalId);
  const p1DrawDetail = `${p1Terminals} terminal${p1Terminals !== 1 ? 's' : ''}${p1HasRHC ? ' + Rebel High Command' : ''}`;
  const p2DrawDetail = `${p2Terminals} terminal${p2Terminals !== 1 ? 's' : ''}${p2HasRHC ? ' + Rebel High Command' : ''}`;
  const drawDesc = hadCutLines
    ? 'No Command card draw this round (Cut Lines).'
    : `P1 drew ${p1DrawCount} card${p1DrawCount !== 1 ? 's' : ''} (${p1DrawDetail}). P2 drew ${p2DrawCount} card${p2DrawCount !== 1 ? 's' : ''} (${p2DrawDetail}). ✓`;
  const initZone = getInitiativePlayerZoneLabel(game);
  const initNum = getInitiativePlayerNum(game);
  await logGameAction(game, client, `**Status Phase** — 1. Ready cards ✓ 2. ${drawDesc} 3. End of round effects (scoring) ✓ 4. Initiative passes to ${initZone}P${initNum} <@${game.initiativePlayerId}>. Round **${game.currentRound}**.`, { phase: 'ROUND', icon: 'round' });

  // Mission SOR: if randomRevealAndPlaceStrain, prompt players before auto-reveal
  if (missionRules?.startOfRound?.randomRevealAndPlaceStrain) {
    const missionName = game.selectedMission?.name || 'Mission Effect';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sor_mission_reveal_${gameId}`)
        .setLabel('Reveal Mission Tokens')
        .setStyle(ButtonStyle.Primary)
    );
    await generalChannel.send({
      content: `⚡ **Round ${game.currentRound} — ${missionName}** — Each player randomly reveals 1 set-aside mission token. Either player: press to reveal.`,
      components: [row],
    });
    setPendingMissionSorReveal(game);
    if (interaction?.message) {
      await interaction.message.edit({ components: [] }).catch(discordCatch);
    }
    saveGames(game.gameId);
    return;
  }

  if (runStartOfRoundRules && missionRules?.startOfRound) {
    await runStartOfRoundRules(game, mapId, variant, missionRules.startOfRound, { logGameAction, client, getMapTokensData });
  }
  await _continueAfterMissionSor(game, gameId, interaction, ctx);
}

/**
 * Shared start-of-round continuation helper. Runs every effect that must fire
 * after mission SOR rules are in place:
 *   - CC passive start-of-round redraws (Rebel Graffiti / Sabine)
 *   - DC start-of-round passives (Brush, Force Slow, Excavation, etc.)
 *   - Hand visual refresh + hand-channel message rebuild
 *   - Phase gate → pre_activation (unless a DC SOR effect is pending)
 *   - Mission-specific round-start prompts (Devaron B doors/crates, Chopper A Krykna push)
 *
 * Called from round.js:_runInitiativeSwapAndContinue (round 2+), handleSorMissionReveal
 * (reveal-button completion), phase-gate.js cc_drawn (round 1 normal), and
 * setup-bridge.js runDraftRandom (round 1 Draft Random).
 *
 * @param {object} game
 * @param {string} gameId
 * @param {?import('discord.js').ButtonInteraction} interaction - May be null (non-button entry)
 * @param {object} ctx - Must include all deps consumed by the body below
 */
export async function runStartOfRoundContinuation(game, gameId, interaction, ctx) {
  return _continueAfterMissionSor(game, gameId, interaction, ctx);
}

/**
 * Continuation after mission SOR rules have fired (or been skipped).
 * Runs CC passive redraws, DC SOR effects, hand updates, phase gate, mission-specific prompts.
 */
async function _continueAfterMissionSor(game, gameId, interaction, ctx) {
  const {
    logGameAction, client, updateHandChannelMessages, updateHandVisualMessage,
    buildHandDisplayPayload, sendPhaseGateMessages, countTerminalsControlledByPlayer,
    getMapTokensData, postDevaronDoorButtons, postDevaronCratePushPrompts,
    postKryknaPushButtons, saveGames, checkWinConditions,
  } = ctx;
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;

  // CC Passive Redraw: start-of-round trigger REMOVED 2026-05-09.
  // Rebel Graffiti now redraws inline at end-of-Sabine's-activation
  // when she plays the card (via pendingRedraw on the ability result).
  // checkStartOfRoundPassiveRedraws is kept exported for any future
  // round-scoped redraw card; currently no SoR redraws are wired.
  // Run start-of-round DC effects (post-deploy for R1, DC abilities every round)
  const hasPendingSor = await runStartOfRoundDcEffects(game, gameId, client, { logGameAction, updateHandChannelMessages, checkWinConditions });
  await updateHandVisualMessage(game, 1, client);
  await updateHandVisualMessage(game, 2, client);
  for (const pn of [1, 2]) {
    const hand = getCcHand(game, pn) || [];
    const deck = getCcDeck(game, pn) || [];
    const handId = getHandChannelId(game, pn);
    if (!handId) continue;
    try {
      const handCh = await fetchGameChannel(client, handId);
      const msgs = await handCh.messages.fetch({ limit: 20 });
      const handMsg = msgs.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      if (handMsg) {
        const payload = buildHandDisplayPayload(hand, deck, game.gameId, game, pn);
        await handMsg.edit({ content: payload.content, embeds: payload.embeds, files: payload.files || [], components: payload.components }).catch(discordCatch);
      }
    } catch (err) {
      console.error('Failed to update hand message:', err);
    }
  }
  if (!hasPendingSor) {
    if (sendPhaseGateMessages) {
      await sendPhaseGateMessages(game, 'pre_activation', ctx);
    }
  }

  // Arms Salvage (Devaron Garrison A): if EoR queued an interactive
  // distribute, post the first prompt now. Subsequent prompts fire
  // from the handler chain.
  const generalChannel = await fetchGameChannel(client, game.generalId);
  if (game.pendingArmsDistribution?.queue?.length > 0 && ctx.postArmsDistributionPrompt) {
    await ctx.postArmsDistributionPrompt(game, generalChannel, gameId);
  }
  if (Array.isArray(game.pendingPrototypeMoveQueue) && game.pendingPrototypeMoveQueue.length > 0 && ctx.postPrototypeMovePrompt) {
    await ctx.postPrototypeMovePrompt(game, generalChannel, gameId);
  }
  // Devaron Garrison B: terminal→door selection + crate push prompts.
  // Driven by rules.openDoorPerTerminal flag (CRR mission card data).
  if (hasMissionFlag(mapId, variant, 'openDoorPerTerminal')) {
    if (!game.objectHealth?.['crate-' + (game.selectedMap?.crateOrigInitDone || '__sentinel__')] && !game._devaronCratesInited) {
      // Slice 5 (alexanbv 2026-05-10): unified state only. Legacy
      // cratePositions removed — push-mechanic, attack-targeting,
      // damage, and splashOnDefeat all flow through
      // game.objectHealth / game.objectPositions / game.objectMeta.
      const dMap = getMapTokensData()['devaron-garrison'];
      const allCrates = Object.values(dMap?.missionB?.positions || {}).flat().filter(Boolean).map((c) => String(c).toLowerCase());
      game.objectHealth = game.objectHealth || {};
      game.objectPositions = game.objectPositions || {};
      game.objectMeta = game.objectMeta || {};
      for (const c of allCrates) {
        const id = `crate-${c}`;
        if (game.objectHealth[id]) continue;
        game.objectHealth[id] = [5, 5];
        game.objectPositions[id] = c;
        game.objectMeta[id] = {
          name: `Crate @ ${c.toUpperCase()}`,
          targetable: true,
          defenseBlock: 1,
          defenseEvade: 0,
          splashOnDefeat: { amount: 2, radius: 1, target: 'all' },
          vpOnDefeat: null,
          moves: true,
        };
      }
      game._devaronCratesInited = true;
    }
    const p1T = countTerminalsControlledByPlayer(game, 1, mapId);
    const p2T = countTerminalsControlledByPlayer(game, 2, mapId);
    if ((p1T > 0 || p2T > 0) && postDevaronDoorButtons) {
      game.pendingDoorSelections = [];
      if (p1T > 0) game.pendingDoorSelections.push({ playerNum: 1, doorsRemaining: p1T });
      if (p2T > 0) game.pendingDoorSelections.push({ playerNum: 2, doorsRemaining: p2T });
      const dDoors = getMapTokensData()['devaron-garrison']?.doors || [];
      await postDevaronDoorButtons(game, dDoors, generalChannel, gameId);
    }
    if (postDevaronCratePushPrompts) {
      await postDevaronCratePushPrompts(game, generalChannel, gameId);
    }
  }

  // Krykna push queue + buttons (damage fires after all pushes in modal handler).
  // Driven by rules.npcKryknaActivation flag.
  if (hasMissionFlag(mapId, variant, 'npcKryknaActivation') && postKryknaPushButtons) {
    // Lazy-init npcKrykna from missionA token positions (breaks chicken-and-egg with self-play.js)
    if (!game.npcKrykna) {
      const missionData = getMapTokensData()['chopper-base-atollon']?.missionA;
      const positions = Object.values(missionData?.positions || {}).flat().filter(Boolean);
      if (positions.length > 0) {
        game.npcKrykna = positions.map((coord, i) => ({ id: `krykna-${i + 1}`, coord: String(coord).toLowerCase().trim(), hp: 8, maxHp: 8, defeated: false }));
      }
    }
    const activeKrykna = (game.npcKrykna || []).filter((k) => !k.defeated);
    if (activeKrykna.length > 0) {
      const _initNum = getInitiativePlayerNum(game);
      const _otherNum = opponentPlayerNum(_initNum);
      const queue = [];
      for (let i = 0; i < activeKrykna.length; i++) queue.push(i % 2 === 0 ? _initNum : _otherNum);
      game.pendingKryknaPushQueue = queue;
      game.kryknaPushedIds = [];
      await postKryknaPushButtons(game, generalChannel, gameId);
    }
  }

  if (interaction?.message) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
  }
  saveGames(game.gameId);
}

/**
 * Resume status phase flow after fluctuation swap phase completes.
 * Called from map-events.js handleFluctuationSwap/handleFluctuationSkip when queue is empty.
 */
export async function continueAfterFluctuationSwap(game, gameId, interaction, ctx) {
  const logVars = game._pendingStatusPhaseLog || {};
  delete game._pendingStatusPhaseLog;
  delete game.pendingFluctuationSwapQueue;
  delete game.pendingFluctuationSwapFirst;
  // fluctuationSwappedThisRound is cleared at next round start in cleanupRoundStart — leave it for now
  await _runInitiativeSwapAndContinue(game, gameId, interaction, ctx, logVars);
}

/**
 * Shared button handler: either player presses to trigger mission SOR token reveal.
 * Used by Powered Perimeter (Chopper Base Atollon B) randomRevealAndPlaceStrain.
 */
export async function handleSorMissionReveal(interaction, ctx) {
  const {
    getGame, logGameAction, client, getMissionRules, getMapTokensData,
    runStartOfRoundRules, saveGames,
  } = ctx;
  const gameId = parseCustomId(interaction.customId, 'sor_mission_reveal_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'press this')) return;
  if (!game.pendingMissionSorReveal) {
    await interaction.followUp({ content: 'Mission token reveal already completed.', ephemeral: true }).catch(discordCatch);
    return;
  }
  clearPendingMissionSorReveal(game);
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  const missionRules = getMissionRules?.(mapId, variant) ?? {};
  if (runStartOfRoundRules && missionRules?.startOfRound) {
    await runStartOfRoundRules(game, mapId, variant, missionRules.startOfRound, { logGameAction, client, getMapTokensData });
  }
  // Disable the reveal button
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await _continueAfterMissionSor(game, gameId, interaction, ctx);
}

/**
 * Run automatic start-of-round DC effects and post-deploy effects.
 * Called from handleEndEndOfRound (rounds 2+) and after CC draw (round 1).
 * @param {object} game
 * @param {string} gameId
 * @param {object} client - Discord client
 * @param {object} ctx - { logGameAction, dcHealthState?, dcMessageMeta? }
 */
export async function runStartOfRoundDcEffects(game, gameId, client, ctx) {
  const { logGameAction, updateHandChannelMessages, checkWinConditions } = ctx;

  // Post-deploy effects now handled by runPostDeployPhase() in post-deploy.js
  // (called from the appropriate trigger points: cc-hand.js, index.js Draft Random, etc.)

  // Start-of-round DC passive hooks (initiative player first per IA rules)
  {
    const _sorEff = getDcEffects() || {};
    const _initPn = getInitiativePlayerNum(game);
    const _sorPlayerOrder = _initPn === 1 ? [1, 2] : [2, 1];
    for (const playerNum of _sorPlayerOrder) {
      const dcList = getDcList(game, playerNum) || [];
      const msgIds = getDcMessageIds(game, playerNum) || [];
      for (let i = 0; i < dcList.length; i++) {
        const dc = dcList[i];
        if (!dc || dc.defeated) continue;
        const eff = _sorEff[dc.dcName] || _sorEff[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        const sIds = eff?.specialAbilityIds || [];

        // Brush (Ezra Bridger): "Move up to 4 spaces" at start of
        // round. CRR MOVE-017 — pendingMoveX picker, bypassCosts true,
        // 4-space budget, no banking. Out-of-activation timing per
        // rule 1: spent immediately.
        if (sIds.includes('brush_ezra')) {
          const mid = msgIds[i];
          if (mid) {
            const figKeys = Object.keys(game.figurePositions?.[playerNum] || {})
              .filter(k => k.startsWith((dc.dcName || '') + '-'));
            const fk = figKeys[0] || null;
            if (fk) {
              const { setupPendingMoveX } = await import('./move-x-handler.js');
              await setupPendingMoveX(game, { client, logGameAction, saveGames: ctx?.saveGames }, {
                msgId: mid,
                figureKey: fk,
                playerNum,
                spaces: 4,
                source: 'Brush',
                threadId: null,
                bypassCosts: true,
              });
              await logGameAction(game, client, `🌿 **Brush** — **${dc.displayName || dc.dcName}** may move up to 4 spaces at the start of the round.`, { phase: 'ROUND', icon: 'round' });
            }
          }
        }

        // Unstable Devices (Saska Teft): "Once during your activation" — NOT a start-of-round effect
        // Device token is now granted during activation (activation.js), not here

        // Force Slow (Cal Kestis): choose a hostile within 3 to skip activation
        if (sIds.includes('force_slow_cal')) {
          await _postForceSlowPicker(game, gameId, playerNum, dc, logGameAction, client);
        }

        // Excavation (Doctor Aphra): choose a CC from discard with cost ≤1, add to hand
        if (sIds.includes('excavation_aphra')) {
          await _postExcavationPicker(game, gameId, playerNum, dc, logGameAction, client);
        }

        // Programming Override (4-LOM): choose a TRAIT at start of round.
        // Suppressed if Preservation Protocol was played on this 4-LOM —
        // PP rule says "Until the end of the game, you lose Programming
        // Override and Shared Intuition" (alexanbv 2026-05-10).
        const _4lomFk = Object.keys(game.figurePositions?.[playerNum] || {}).find(k => k.startsWith('4-LOM-'));
        const _ppSuppressed = !!(game.preservationProtocolUsed?.[playerNum]?.[_4lomFk]);
        if (sIds.includes('programming_override_4lom') && !_ppSuppressed) {
          game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
          const ownerId = getPlayerId(game, playerNum);
          const traits = ['TROOPER', 'SPY', 'HUNTER', 'SMUGGLER', 'FORCE USER', 'BRAWLER', 'CREATURE', 'LEADER', 'GUARDIAN', 'WOOKIEE', 'VEHICLE'];
          const btns = traits.map(t => new ButtonBuilder()
            .setCustomId(`prog_override_${gameId}_${playerNum}_${t.replace(/\s/g, '_')}`)
            .setLabel(t)
            .setStyle(ButtonStyle.Primary)
          );
          _stashSorActions(game, btns, 'Programming Override', playerNum);
          const rows = chunkButtonsToRows(btns);
          await logGameAction(game, client, `🔧 **Programming Override** — <@${ownerId}>, choose a TRAIT for **${dc.displayName || dc.dcName}** to gain this round:`, {
            phase: 'ROUND', icon: 'round',
            components: rows,
            allowedMentions: { users: [ownerId] },
          });
        }

        // Shape/Shift (Clawdite Shapeshifter): form picker at start of round
        if (sIds.includes('shape_clawdite_elite') || sIds.includes('shape_clawdite_reg') || sIds.includes('shift_clawdite_elite') || sIds.includes('shift_clawdite_reg')) {
          const ownerId = getPlayerId(game, playerNum);
          const _fk = Object.keys(game.figurePositions?.[playerNum] || {}).find(k => k.startsWith(dc.dcName + '-'));
          const _curForm = _fk ? getConfig(game, _fk)?.form : null;
          const formCards = getFormCards();
          const takenForms = _fk ? getFormsChosenByTeamClawdites(game, playerNum, _fk) : new Set();
          const formNames = Object.keys(formCards).filter(n => !takenForms.has(n));
          if (_fk && formNames.length > 0) {
            game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
            const btns = formNames.map(name => new ButtonBuilder()
              .setCustomId(`form_pick_${gameId}_${_fk}_${name}`)
              .setLabel(name === _curForm ? `${name} (current)` : name)
              .setStyle(name === _curForm ? ButtonStyle.Secondary : ButtonStyle.Primary)
            );
            _stashSorActions(game, btns, 'Shape/Shift', playerNum);
            const rows = chunkButtonsToRows(btns);
            await logGameAction(game, client, `🔄 **Shift** — <@${ownerId}>, you may switch **${dc.displayName || dc.dcName}**'s Form card (current: **${_curForm || 'none'}**):`, {
              phase: 'ROUND', icon: 'round',
              components: rows,
              allowedMentions: { users: [ownerId] },
            });
          }
        }
      }
    }
  }

  // Skirmish Upgrade timing effects (figureless DCs)
  {
    const _suEff = getDcEffects() || {};
    for (const playerNum of [1, 2]) {
      const dcList = getDcList(game, playerNum) || [];
      const ownerId = getPlayerId(game, playerNum);
      for (const dc of dcList) {
        if (!dc) continue;
        const dcName = dc.dcName;
        const eff = _suEff[dcName] || _suEff[`[${dcName}]`] || _suEff[dcName?.replace(/^\[|\]$/g, '')];
        if (!eff) continue;
        const text = eff.abilityText || '';

        // [First Strike]: After setup, both players receive 4 VPs (round 1 only)
        if (dcName.includes('First Strike') && game.currentRound === 1 && !game.firstStrikeFired) {
          game.firstStrikeFired = true;
          awardObjectiveVp(game, 1, 4);
          awardObjectiveVp(game, 2, 4);
          await logGameAction(game, client, `⚔️ **First Strike** — Both players receive **4 VPs**.`);
          await checkWinConditions(game, client);
        }

        // [Extra Armor]: Now handled by post-deploy queue (post-deploy.js)

        // [Rule by Fear]: At the start of the first game round, draw 2 CCs, then discard 1
        if (dcName.includes('Rule by Fear') && game.currentRound === 1 && !game[`ruleByFearFired_p${playerNum}`]) {
          game[`ruleByFearFired_p${playerNum}`] = true;
          const deckKey = ccDeckKey(playerNum);
          const handKey = ccHandKey(playerNum);
          const deck = game[deckKey] || [];
          const hand = game[handKey] || [];
          const drew = [];
          for (let d = 0; d < 2 && deck.length > 0; d++) {
            drew.push(deck.shift());
          }
          hand.push(...drew);
          game[deckKey] = deck;
          game[handKey] = hand;
          const drewText = drew.length ? drew.map(c => `**${c}**`).join(', ') : 'none (deck empty)';
          await logGameAction(game, client, `📜 **Rule by Fear** — <@${ownerId}> drew ${drew.length} CC${drew.length !== 1 ? 's' : ''}. Choose 1 to discard in your hand channel.`, {
            allowedMentions: { users: [ownerId] },
          });
          if (updateHandChannelMessages) await updateHandChannelMessages(game, client);
          // Post discard picker in hand channel
          if (hand.length > 0) {
            game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
            const handChannelId = getHandChannelId(game, playerNum);
            try {
              const handCh = await fetchGameChannel(client, handChannelId);
              const discardBtns = hand.slice(0, 25).map((card, idx) => new ButtonBuilder()
                .setCustomId(`rbf_discard_${gameId}_${playerNum}_${idx}`)
                .setLabel(truncateLabel(card))
                .setStyle(ButtonStyle.Danger)
              );
              _stashSorActions(game, discardBtns, 'Rule by Fear', playerNum);
              const discardRows = chunkButtonsToRows(discardBtns);
              await withDiscordRetry(() => handCh.send({ content: `<@${ownerId}> **Rule by Fear** — You drew: ${drewText}. Choose 1 card from your hand to discard:`, components: discardRows, allowedMentions: { users: [ownerId] } }));
            } catch (err) {
              console.error('Rule by Fear discard picker failed:', err);
            }
          }
        }

        // [Rogue One]: At the start of the first game round, draw 3 CCs, place 2 on top of deck
        if (dcName.includes('Rogue One') && game.currentRound === 1 && !game[`rogueOneFired_p${playerNum}`]) {
          game[`rogueOneFired_p${playerNum}`] = true;
          const deckKey = ccDeckKey(playerNum);
          const handKey = ccHandKey(playerNum);
          const deck = game[deckKey] || [];
          const hand = game[handKey] || [];
          const drew = [];
          for (let d = 0; d < 3 && deck.length > 0; d++) {
            drew.push(deck.shift());
          }
          hand.push(...drew);
          game[deckKey] = deck;
          game[handKey] = hand;
          const drewText = drew.length ? drew.map(c => `**${c}**`).join(', ') : 'none (deck empty)';
          await logGameAction(game, client, `🎯 **Rogue One** — <@${ownerId}> drew ${drew.length} CC${drew.length !== 1 ? 's' : ''}. Place 2 back on top of your deck in your hand channel.`, {
            allowedMentions: { users: [ownerId] },
          });
          if (updateHandChannelMessages) await updateHandChannelMessages(game, client);
          // Post picker in hand channel
          if (hand.length > 0) {
            game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
            game[`pendingRogueOne_p${playerNum}`] = { remaining: 2 };
            const handChannelId = getHandChannelId(game, playerNum);
            try {
              const handCh = await fetchGameChannel(client, handChannelId);
              const pickBtns = hand.slice(0, 25).map((card, idx) => new ButtonBuilder()
                .setCustomId(`rogue_one_return_${gameId}_${playerNum}_${idx}`)
                .setLabel(truncateLabel(card))
                .setStyle(ButtonStyle.Primary)
              );
              _stashSorActions(game, pickBtns, 'Rogue One', playerNum);
              const pickRows = chunkButtonsToRows(pickBtns);
              await withDiscordRetry(() => handCh.send({ content: `<@${ownerId}> **Rogue One** — You drew: ${drewText}. Choose a card to place on top of your deck (1 of 2):`, components: pickRows, allowedMentions: { users: [ownerId] } }));
            } catch (err) {
              console.error('Rogue One return picker failed:', err);
            }
          }
        }

        // [Imperial Citadel]: At the start of each round, place 1 Damage or Block token on this card
        if (dcName.includes('Imperial Citadel') && text.includes('At the start of each round')) {
          game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
          const btns = [
            new ButtonBuilder()
              .setCustomId(`imp_citadel_${gameId}_${playerNum}_damage`)
              .setLabel('Place Damage Token')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`imp_citadel_${gameId}_${playerNum}_block`)
              .setLabel('Place Block Token')
              .setStyle(ButtonStyle.Primary),
          ];
          _stashSorActions(game, btns, 'Imperial Citadel', playerNum);
          await logGameAction(game, client, `🏰 **Imperial Citadel** — <@${ownerId}>, place 1 token on Imperial Citadel:`, {
            components: [new ActionRowBuilder().addComponents(btns)],
            allowedMentions: { users: [ownerId] },
          });
        }
      }
    }
  }
  // Return true if there are pending async effects that block the activation phase
  return (game.pendingStartOfRoundResolve || 0) > 0;
}

/**
 * Called by resolution handlers (rbf_discard, rogue_one_return) when their async
 * effect completes. Decrements the counter and triggers the activation phase when
 * all pending effects are resolved.
 */
export async function resolveStartOfRoundEffect(game, ctx) {
  game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 1) - 1;
  if (game.pendingStartOfRoundResolve <= 0) {
    delete game.pendingStartOfRoundResolve;
    delete game.pendingSorActions;
    const { sendPhaseGateMessages, saveGames } = ctx;
    if (sendPhaseGateMessages) {
      await sendPhaseGateMessages(game, 'pre_activation', ctx);
    }
    if (saveGames) saveGames(game.gameId);
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, updateHandChannelMessages, saveGames, shouldShowEndActivationPhaseButton, countTerminalsControlledByPlayer, GAME_PHASES, PHASE_COLOR, client
 */
export async function handleEndStartOfRound(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    getPlayerZoneLabel,
    logGameAction,
    updateHandChannelMessages,
    saveGames,
    shouldShowEndActivationPhaseButton,
    countTerminalsControlledByPlayer,
    GAME_PHASES,
    PHASE_COLOR,
    client,
  } = ctx;
  const gameId = parseCustomId(interaction.customId, 'end_start_of_round_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  if (!game.startOfRoundWhoseTurn) {
    await interaction.followUp({ content: 'Not in Start of Round window.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (interaction.user.id !== game.startOfRoundWhoseTurn) {
    await interaction.followUp({ content: "It's not your turn in the Start of Round window.", ephemeral: true }).catch(discordCatch);
    return;
  }
  const initiativeId = game.initiativePlayerId;
  const otherId = initiativeId === game.player1Id ? game.player2Id : game.player1Id;
  if (interaction.user.id === initiativeId) {
    game.startOfRoundWhoseTurn = otherId;
    const initNum = initiativeId === game.player1Id ? 1 : 2;
    const otherNum = 3 - initNum;
    const otherZone = getPlayerZoneLabel(game, otherId);
    await logGameAction(game, client, `**Start of Round** — 2. Initiative done ✓. 3. <@${otherId}> (${otherZone}Player ${otherNum}) — your turn for start-of-round effects. Click **End 'Start of Round' window** in your Hand when done.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [otherId] } });
    await updateHandChannelMessages(game, client);
    saveGames(game.gameId);
    return;
  }
  game.startOfRoundWhoseTurn = null;

  // Post-deploy effects now handled by runPostDeployPhase() in post-deploy.js

  // Start-of-round DC passive hooks (initiative player first per IA rules)
  {
    const _sorEff = getDcEffects() || {};
    const _initPn = getInitiativePlayerNum(game);
    const _sorPlayerOrder = _initPn === 1 ? [1, 2] : [2, 1];
    for (const playerNum of _sorPlayerOrder) {
      const dcList = getDcList(game, playerNum) || [];
      const msgIds = getDcMessageIds(game, playerNum) || [];
      for (let i = 0; i < dcList.length; i++) {
        const dc = dcList[i];
        if (!dc || dc.defeated) continue;
        const eff = _sorEff[dc.dcName] || _sorEff[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        const sIds = eff?.specialAbilityIds || [];

        // Brush (Ezra Bridger): "Move up to 4 spaces" at start of
        // round. CRR MOVE-017 — pendingMoveX picker, bypassCosts true,
        // 4-space budget, no banking. Out-of-activation timing per
        // rule 1: spent immediately.
        if (sIds.includes('brush_ezra')) {
          const mid = msgIds[i];
          if (mid) {
            const figKeys = Object.keys(game.figurePositions?.[playerNum] || {})
              .filter(k => k.startsWith((dc.dcName || '') + '-'));
            const fk = figKeys[0] || null;
            if (fk) {
              const { setupPendingMoveX } = await import('./move-x-handler.js');
              await setupPendingMoveX(game, { client, logGameAction, saveGames: ctx?.saveGames }, {
                msgId: mid,
                figureKey: fk,
                playerNum,
                spaces: 4,
                source: 'Brush',
                threadId: null,
                bypassCosts: true,
              });
              await logGameAction(game, client, `🌿 **Brush** — **${dc.displayName || dc.dcName}** may move up to 4 spaces at the start of the round.`, { phase: 'ROUND', icon: 'round' });
            }
          }
        }

        // Unstable Devices (Saska Teft): "Once during your activation" — NOT a start-of-round effect
        // Device token is now granted during activation (activation.js), not here

        // Force Slow (Cal Kestis): choose a hostile within 3 to skip activation
        if (sIds.includes('force_slow_cal')) {
          await _postForceSlowPicker(game, gameId, playerNum, dc, logGameAction, client);
        }

        // Excavation (Doctor Aphra): choose a CC from discard with cost ≤1, add to hand
        if (sIds.includes('excavation_aphra')) {
          await _postExcavationPicker(game, gameId, playerNum, dc, logGameAction, client);
        }

        // Shape/Shift (Clawdite Shapeshifter): form picker at start of round
        if (sIds.includes('shape_clawdite_elite') || sIds.includes('shape_clawdite_reg') || sIds.includes('shift_clawdite_elite') || sIds.includes('shift_clawdite_reg')) {
          const ownerId = getPlayerId(game, playerNum);
          const _fk = Object.keys(game.figurePositions?.[playerNum] || {}).find(k => k.startsWith(dc.dcName + '-'));
          const _curForm = _fk ? getConfig(game, _fk)?.form : null;
          const formCards = getFormCards();
          const takenForms = _fk ? getFormsChosenByTeamClawdites(game, playerNum, _fk) : new Set();
          const formNames = Object.keys(formCards).filter(n => !takenForms.has(n));
          if (_fk && formNames.length > 0) {
            game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
            const btns = formNames.map(name => new ButtonBuilder()
              .setCustomId(`form_pick_${gameId}_${_fk}_${name}`)
              .setLabel(name === _curForm ? `${name} (current)` : name)
              .setStyle(name === _curForm ? ButtonStyle.Secondary : ButtonStyle.Primary)
            );
            _stashSorActions(game, btns, 'Shape/Shift', playerNum);
            const rows = chunkButtonsToRows(btns);
            await logGameAction(game, client, `🔄 **Shift** — <@${ownerId}>, you may switch **${dc.displayName || dc.dcName}**'s Form card (current: **${_curForm || 'none'}**):`, {
              phase: 'ROUND', icon: 'round',
              components: rows,
              allowedMentions: { users: [ownerId] },
            });
          }
        }
      }
    }
  }

  // Phase gate: both confirm SOR effects done before activation begins
  if ((game.pendingStartOfRoundResolve || 0) > 0) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  const { sendPhaseGateMessages: _sorSendGate } = ctx;
  if (_sorSendGate) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    await _sorSendGate(game, 'pre_activation', ctx);
    saveGames(game.gameId);
    return;
  }

  // Fallback: no gate function, start activation directly
  const generalChannel = await fetchGameChannel(client, game.generalId);
  // Round header lives in its own message so it stays above the prompt.
  const roundEmbed = new EmbedBuilder()
    .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${game.currentRound} - Start of Round`)
    .setColor(PHASE_COLOR);
  await generalChannel.send({ embeds: [roundEmbed] }).catch(() => {});
  const showBtn = shouldShowEndActivationPhaseButton(game, gameId);
  const components = [];
  if (showBtn) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${game.currentRound} Activation Phase`)
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  const initRem = getInitiativePlayerNum(game) === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const otherRem = getInitiativePlayerNum(game) === 1 ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
  if (otherRem > initRem && initRem > 0) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pass_activation_turn_${gameId}`)
        .setLabel(`Pass (opponent has ${otherRem - initRem} more activation${otherRem - initRem !== 1 ? 's' : ''} than you)`)
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  const initPlayerNum = getInitiativePlayerNum(game);
  const initPlayAreaId = getPlayAreaId(game, initPlayerNum);
  const passHint = otherRem > initRem && initRem > 0 ? ' You may pass (opponent has more activations).' : '';
  const content = `<@${game.initiativePlayerId}> **Round ${game.currentRound}** — Your turn! Activate DCs in <#${initPlayAreaId}>.${passHint}`;
  const sent = await withDiscordRetry(() => generalChannel.send({
    content,
    components,
    allowedMentions: { users: [game.initiativePlayerId] },
  }));
  game.roundActivationMessageId = sent.id;
  game.roundActivationButtonShown = showBtn;
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  await updateHandChannelMessages(game, client);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

// ── Helpers: Force Slow & Excavation pickers (shared by handleEndEndOfRound + handleEndStartOfRound) ──

async function _postForceSlowPicker(game, gameId, playerNum, dc, logGameAction, client) {
  const ownerId = getPlayerId(game, playerNum);
  const oppNum = opponentPlayerNum(playerNum);
  // Find figure key for this DC to get its position
  const calFk = Object.keys(game.figurePositions?.[playerNum] || {}).find(k => k.startsWith(dc.dcName + '-'));
  const calPos = calFk ? game.figurePositions[playerNum][calFk] : null;
  if (!calPos) {
    await logGameAction(game, client, `🐌 **Force Slow** — **${dc.displayName || dc.dcName}** has no figure on board. Skipped.`, { phase: 'ROUND', icon: 'round' });
    return;
  }
  // Find hostile figures within 3 spaces (graph distance)
  const _fsMapId = game.selectedMap?.id;
  const _fsMs = _fsMapId ? getMapData(_fsMapId) : null;
  const _fsAllDoors = _fsMapId ? (_getMapTokensData()?.[_fsMapId]?.doors || []) : [];
  const _fsOpenedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
  const _fsClosedDoorEdges = new Set(
    _fsAllDoors
      .filter(e => { const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase(); return !_fsOpenedSet.has(`${a}|${b}`) && !_fsOpenedSet.has(`${b}|${a}`); })
      .map(e => edgeKey(e[0], e[1]))
  );
  const hostiles = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[oppNum] || {})) {
    if (!pos) continue;
    if (countSpaces(_fsMs, calPos, pos, _fsClosedDoorEdges) <= 3) hostiles.push({ fk, dcName: dcNameFromFigureKey(fk) });
  }
  if (hostiles.length === 0) {
    await logGameAction(game, client, `🐌 **Force Slow** — No hostile figures within 3 spaces of **${dc.displayName || dc.dcName}**. Skipped.`, { phase: 'ROUND', icon: 'round' });
    return;
  }
  if (hostiles.length === 1) {
    // Auto-select the only target
    game.forceSlowSkipActivation = game.forceSlowSkipActivation || {};
    game.forceSlowSkipActivation[hostiles[0].fk] = true;
    await logGameAction(game, client, `🐌 **Force Slow** — **${hostiles[0].dcName}** will skip its next activation (only hostile in range).`, { phase: 'ROUND', icon: 'round' });
    return;
  }
  // Multiple targets — show picker (block activation until resolved)
  game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
  const btns = hostiles.map(({ fk, dcName }) =>
    new ButtonBuilder().setCustomId(`force_slow_pick_${gameId}_${playerNum}_${fk}`).setLabel(dcName).setStyle(ButtonStyle.Primary)
  );
  _stashSorActions(game, btns, 'Force Slow', playerNum);
  const rows = chunkButtonsToRows(btns);
  await logGameAction(game, client, `🐌 **Force Slow** — <@${ownerId}>, choose a hostile figure within 3 spaces of **${dc.displayName || dc.dcName}** to skip its next activation:`, {
    phase: 'ROUND', icon: 'round',
    components: rows,
    allowedMentions: { users: [ownerId] },
  });
}

async function _postExcavationPicker(game, gameId, playerNum, dc, logGameAction, client) {
  // Rest in Peace: block discard-pile access
  if (game.restInPeaceActive) {
    await logGameAction(game, client, `⛏️ **Excavation** — **${dc.displayName || dc.dcName}**: blocked by **Rest in Peace** (cannot retrieve from discard piles this round).`, { phase: 'ROUND', icon: 'round' });
    return;
  }
  const ownerId = getPlayerId(game, playerNum);
  // Per card text: "any discard pile" — scan both. Exclude "Take Initiative".
  // Card stays in discard; Aphra's player may play it from discard once this
  // round, then it returns to the game box. If something redraws it out of
  // discard before play, Aphra cannot use it.
  const eligible = [];
  for (const sourcePN of [1, 2]) {
    const discard = getCcDiscard(game, sourcePN) || [];
    for (let i = 0; i < discard.length; i++) {
      const cardName = discard[i];
      if (cardName === 'Take Initiative') continue;
      const ccData = getCcEffect(cardName);
      const cost = ccData?.cost ?? 99;
      if (cost <= 1) eligible.push({ name: cardName, sourcePN });
    }
  }
  if (eligible.length === 0) {
    await logGameAction(game, client, `⛏️ **Excavation** — **${dc.displayName || dc.dcName}**: no eligible Command Cards (cost ≤1, excluding "Take Initiative") in any discard pile.`, { phase: 'ROUND', icon: 'round' });
    return;
  }
  // Always show the picker — never auto-pick — because Aphra is committing to
  // ONE specific card for the round and the player may want to skip if all
  // options are unfavorable.
  game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
  const btns = eligible.map(({ name, sourcePN }, i) => {
    const label = sourcePN === playerNum ? name : `${name} (P${sourcePN})`;
    return new ButtonBuilder()
      .setCustomId(`excavation_pick_${gameId}_${playerNum}_${sourcePN}_${i}`)
      .setLabel(label.slice(0, 80))
      .setStyle(ButtonStyle.Primary);
  });
  btns.push(new ButtonBuilder().setCustomId(`excavation_skip_${gameId}_${playerNum}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
  _stashSorActions(game, btns, 'Excavation', playerNum);
  // Stash the eligible list so the click handler can resolve sourcePN/cardName
  // by index without re-scanning (defends against discard mutations between
  // picker post and click).
  game.aphraExcavationOptions = game.aphraExcavationOptions || {};
  game.aphraExcavationOptions[playerNum] = eligible;
  const rows = chunkButtonsToRows(btns);
  await logGameAction(game, client, `⛏️ **Excavation** — <@${ownerId}>, choose a Command Card (cost ≤1, any discard pile, except "Take Initiative") to mark for play this round. The card stays in its discard pile; you may play it once this round, then it returns to the game box.`, {
    phase: 'ROUND', icon: 'round',
    components: rows,
    allowedMentions: { users: [ownerId] },
  });
}

// ---- Skirmish Upgrade SOR button handlers ----

/* ── Extra Armor helpers ── */

/** Build the button label for a figure in the Extra Armor picker, showing pending allocation. */
function _extraArmorLabel(fk, game, allocation) {
  const dcName = dcNameFromFigureKey(fk);
  const { dgIndex, figureIndex } = parseFigureKey(fk);
  const letters = 'abcdefghij';
  const letter = letters[figureIndex] || 'a';
  const pending = allocation[fk] || 0;
  const max = getMaxPowerTokens(fk);
  const existing = (game.figurePowerTokens?.[fk] || []).length;
  let label = `${dcName} (${dgIndex}${letter})`;
  if (pending > 0) label += ` [${pending}/${max - existing}]`;
  return label;
}

/** Get the button style for a figure based on its pending token count. */
function _extraArmorStyle(fk, allocation) {
  const pending = allocation[fk] || 0;
  if (pending === 0) return ButtonStyle.Primary;    // blue  — 0 tokens
  if (pending === 1) return ButtonStyle.Success;     // green — 1 token
  return ButtonStyle.Danger;                          // red   — 2 tokens
}

/** Build the full Extra Armor UI rows (figure buttons + optional confirm). */
function _buildExtraArmorUI(gameId, playerNum, allFks, game, allocation, total) {
  const placed = Object.values(allocation).reduce((s, n) => s + n, 0);
  const remaining = total - placed;
  const btns = allFks.slice(0, 20).map(fk => new ButtonBuilder()
    .setCustomId(`extra_armor_pick_${gameId}_${playerNum}_${fk}`)
    .setLabel(_extraArmorLabel(fk, game, allocation))
    .setStyle(_extraArmorStyle(fk, allocation))
  );
  const rows = chunkButtonsToRows(btns);
  // Show confirm button only when all tokens are placed
  if (remaining <= 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`extra_armor_confirm_${gameId}_${playerNum}`)
        .setLabel('Confirm Allocation')
        .setStyle(ButtonStyle.Success)
    ));
  }
  const content = remaining > 0
    ? `🛡️ **Extra Armor** — Distribute Block Tokens among your figures (${remaining} of ${total} remaining):`
    : `🛡️ **Extra Armor** — All ${total} Block Tokens allocated. Press **Confirm** to apply.`;
  return { content, components: rows };
}

/**
 * Extra Armor: cycle a figure's pending token count (0 → 1 → 2 → 0).
 * No game-state changes until confirm.
 */
export async function handleExtraArmorPick(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames } = ctx;
  const parts = splitCustomId(interaction.customId, 'extra_armor_pick_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owning player can distribute Extra Armor tokens.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pending = game[`pendingExtraArmor_p${playerNum}`];
  if (!pending) return;
  const total = pending.total || 4;
  const allocation = pending.allocation || {};

  // Calculate max tokens this figure can receive (cap minus existing)
  const existing = (game.figurePowerTokens?.[figureKey] || []).length;
  const maxForFigure = getMaxPowerTokens(figureKey) - existing;
  const current = allocation[figureKey] || 0;
  const placed = Object.values(allocation).reduce((s, n) => s + n, 0);

  // Cycle: 0 → 1 → 2 → 0 (capped by per-figure max and total remaining)
  let next;
  if (current >= maxForFigure || current >= 2) {
    // At max for this figure — cycle back to 0
    next = 0;
  } else if (placed - current + (current + 1) > total) {
    // Adding one more would exceed total — cycle back to 0
    next = 0;
  } else {
    next = current + 1;
  }

  if (next === 0) {
    delete allocation[figureKey];
  } else {
    allocation[figureKey] = next;
  }
  pending.allocation = allocation;
  saveGames(game.gameId);

  const allFks = Object.keys(game.figurePositions?.[playerNum] || {});
  const ui = _buildExtraArmorUI(gameId, playerNum, allFks, game, allocation, total);
  await interaction.message.edit(ui).catch(discordCatch);
}

/**
 * Extra Armor confirm: apply all allocated Block Tokens at once and log.
 */
export async function handleExtraArmorConfirm(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'extra_armor_confirm_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owning player can distribute Extra Armor tokens.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pending = game[`pendingExtraArmor_p${playerNum}`];
  if (!pending) return;
  const allocation = pending.allocation || {};
  const total = pending.total || 4;
  const placed = Object.values(allocation).reduce((s, n) => s + n, 0);
  if (placed < total) {
    await interaction.followUp({ content: `Still ${total - placed} token(s) left to allocate.`, ephemeral: true }).catch(discordCatch);
    return;
  }

  // Apply all tokens
  const logParts = [];
  for (const [fk, count] of Object.entries(allocation)) {
    if (count <= 0) continue;
    grantPowerTokens(game, fk, 'Block', count);
    logParts.push(`**${dcNameFromFigureKey(fk)}** +${count}`);
  }
  delete game[`pendingExtraArmor_p${playerNum}`];
  saveGames(game.gameId);

  // Single log entry for the whole allocation
  await logGameAction(game, client, `🛡️ **Extra Armor** — Block Tokens distributed: ${logParts.join(', ')}.`);

  // Check for power token overflow
  if (game.pendingPowerTokenOverflow?.length > 0) {
    await sendPowerTokenOverflowUI(game, gameId, interaction.channel, playerNum, saveGames);
  }

  await interaction.message.edit({ content: `🛡️ **Extra Armor** — All ${total} Block Tokens distributed.`, components: [] }).catch(discordCatch);

  // Advance post-deploy queue if active
  if (game.postDeployQueue) {
    const { onExtraArmorComplete } = await import('./post-deploy.js');
    await onExtraArmorComplete(game, gameId, client, { logGameAction, saveGames });
  }
}

/**
 * Extra Armor cancel: kept for backwards compat but no longer used in the new UI.
 */
export async function handleExtraArmorCancel(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
}

/**
 * Rule by Fear: player picks 1 card from hand to discard.
 */
export async function handleRbfDiscard(interaction, ctx) {
  const { getGame, saveGames, updateHandVisualMessage, updateDiscardPileMessage, updateHandChannelMessages, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'rbf_discard_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const cardIdx = parseInt(parts[2], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const handKey = ccHandKey(playerNum);
  const discKey = ccDiscardKey(playerNum);
  const hand = game[handKey] || [];
  if (cardIdx < 0 || cardIdx >= hand.length) {
    await interaction.followUp({ content: 'Invalid card selection.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const card = hand.splice(cardIdx, 1)[0];
  game[discKey] = game[discKey] || [];
  game[discKey].push(card);
  game[handKey] = hand;
  await logGameAction(game, client, `📜 **Rule by Fear** — **P${playerNum}** discarded 1 CC.`);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  if (updateHandVisualMessage) await updateHandVisualMessage(game, playerNum, client).catch(discordCatch);
  if (updateDiscardPileMessage) await updateDiscardPileMessage(game, playerNum, client).catch(discordCatch);
  if (updateHandChannelMessages) await updateHandChannelMessages(game, client);
  saveGames(game.gameId);
  await interaction.followUp({ content: `Discarded **${card}**.`, ephemeral: true }).catch(discordCatch);
  // Resolve start-of-round blocking effect
  if (game.pendingStartOfRoundResolve > 0) {
    await resolveStartOfRoundEffect(game, ctx);
  }
}

/**
 * Rogue One: player picks cards to put on top of deck (2 picks).
 */
export async function handleRogueOneReturn(interaction, ctx) {
  const { getGame, saveGames, updateHandVisualMessage, updateHandChannelMessages, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'rogue_one_return_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const cardIdx = parseInt(parts[2], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game[`pendingRogueOne_p${playerNum}`];
  if (!pending || pending.remaining <= 0) {
    await interaction.followUp({ content: 'Rogue One card returns already complete.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const handKey = ccHandKey(playerNum);
  const deckKey = ccDeckKey(playerNum);
  const hand = game[handKey] || [];
  if (cardIdx < 0 || cardIdx >= hand.length) {
    await interaction.followUp({ content: 'Invalid card selection.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const card = hand.splice(cardIdx, 1)[0];
  game[deckKey] = game[deckKey] || [];
  game[deckKey].unshift(card);
  game[handKey] = hand;
  pending.remaining -= 1;
  await logGameAction(game, client, `🎯 **Rogue One** — **P${playerNum}** placed a card on top of deck (${pending.remaining} remaining).`);
  if (pending.remaining <= 0) {
    delete game[`pendingRogueOne_p${playerNum}`];
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    await interaction.followUp({ content: 'Both cards returned to deck.', ephemeral: true }).catch(discordCatch);
    // Resolve start-of-round blocking effect
    if (game.pendingStartOfRoundResolve > 0) {
      await resolveStartOfRoundEffect(game, ctx);
    }
  } else {
    // Rebuild buttons with updated hand — re-stash for AI visibility
    const pickBtns = hand.slice(0, 25).map((c, idx) => new ButtonBuilder()
      .setCustomId(`rogue_one_return_${gameId}_${playerNum}_${idx}`)
      .setLabel(truncateLabel(c))
      .setStyle(ButtonStyle.Primary)
    );
    // Clear old Rogue One stash entries and re-stash with updated indices
    if (game.pendingSorActions) {
      game.pendingSorActions = game.pendingSorActions.filter(a => !a.customId.startsWith('rogue_one_return_'));
    }
    _stashSorActions(game, pickBtns, 'Rogue One', playerNum);
    const pickRows = chunkButtonsToRows(pickBtns);
    await interaction.message.edit({ components: pickRows }).catch(discordCatch);
    await interaction.followUp({ content: `Placed **${card}** on deck. Pick 1 more card to return.`, ephemeral: true }).catch(discordCatch);
  }
  if (updateHandVisualMessage) await updateHandVisualMessage(game, playerNum, client).catch(discordCatch);
  if (updateHandChannelMessages) await updateHandChannelMessages(game, client);
  saveGames(game.gameId);
}

/**
 * Channel the Force: player picks a FORCE USER CC from deck to add to hand.
 */
export async function handleCtfPick(interaction, ctx) {
  const { getGame, saveGames, updateHandVisualMessage, logGameAction, client, dcHealthState, dcMessageMeta } = ctx;
  const parts = splitCustomId(interaction.customId, 'ctf_pick_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const pickIdx = parseInt(parts[2], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game[`pendingChannelTheForce_p${playerNum}`];
  if (!pending) {
    await interaction.followUp({ content: 'No Channel the Force pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const picked = pending.cards[pickIdx];
  if (!picked) {
    await interaction.followUp({ content: 'Invalid selection.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const deckKey = ccDeckKey(playerNum);
  const handKey = ccHandKey(playerNum);
  const deck = game[deckKey] || [];
  const cardIdx = deck.indexOf(picked.name);
  if (cardIdx < 0) {
    await interaction.followUp({ content: 'Card no longer in deck.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Remove from deck, add to hand
  deck.splice(cardIdx, 1);
  game[handKey] = [...(game[handKey] || []), picked.name];
  // Shuffle deck
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  game[deckKey] = deck;
  delete game[`pendingChannelTheForce_p${playerNum}`];
  // Determine cost of the chosen card for Strain
  const ccEffData = getCcEffectsData?.()?.cards || {};
  const ccEff = ccEffData[picked.name];
  const cost = ccEff?.cost ?? 0;
  await interaction.message.edit({
    content: `**Channel the Force** — Added **${picked.name}** to hand. Deck shuffled.`,
    components: [],
  }).catch(discordCatch);
  await logGameAction(game, client,
    `**Channel the Force** — P${playerNum} searched deck and added **${picked.name}** (cost ${cost}) to hand. Deck shuffled.`,
    { phase: 'ROUND', icon: 'card' });
  // Apply Strain to a friendly FORCE USER figure equal to cost
  if (cost > 0) {
    const dcList = getDcList(game, playerNum) || [];
    const dcEffAll = getDcEffects?.() || {};
    const fuFigures = [];
    const figPos = game.figurePositions?.[playerNum] || {};
    for (const dc of dcList) {
      const dn = dc?.dcName || dc;
      if (/^\[.+\]$/.test(dn)) continue;
      const eff = dcEffAll[dn];
      const kws = (eff?.keywords || []).map(k => String(k).toUpperCase());
      if (!kws.includes('FORCE USER')) continue;
      for (const [fk, pos] of Object.entries(figPos)) {
        if (fk.startsWith(dn + '-') && pos) fuFigures.push({ fk, dcName: dn });
      }
    }
    if (fuFigures.length === 1) {
      // Auto-apply strain to only FORCE USER
      const { fk, dcName: fuName } = fuFigures[0];
      // Find the DC message ID for this figure
      const _ctfDcMsgIds = getDcMessageIds(game, playerNum) || [];
      const _ctfDcList = getDcList(game, playerNum) || [];
      let _ctfFigMsgId = null;
      for (let i = 0; i < _ctfDcList.length; i++) {
        if ((_ctfDcList[i]?.dcName || _ctfDcList[i]) === fuName) { _ctfFigMsgId = _ctfDcMsgIds[i]; break; }
      }
      if (_ctfFigMsgId && dcHealthState) {
        // Strain via the canonical applyStrain pipeline.
        const { applyStrain: _applyStrainCb } = await import('./strain-handler.js');
        await _applyStrainCb(game, ctx, {
          figureKey: fk,
          controllerPlayerNum: playerNum,
          amount: cost,
          source: 'Channel the Force',
        });
      }
      await logGameAction(game, client,
        `**Channel the Force** — **${fuName}** suffers **${cost} Strain**.`,
        { phase: 'ROUND', icon: 'condition' });
    } else if (fuFigures.length > 1) {
      // Multiple FORCE USER figures — show picker
      setPendingChannelTheForceStrain(game, { playerNum, cost, figures: fuFigures });
      const handChId = getHandChannelId(game, playerNum);
      if (handChId) {
        try {
          const handCh = await fetchGameChannel(client, handChId);
          const btns = fuFigures.slice(0, 10).map((f, i) =>
            new ButtonBuilder()
              .setCustomId(`ctf_strain_${gameId}_${playerNum}_${i}`)
              .setLabel(f.dcName)
              .setStyle(ButtonStyle.Danger)
          );
          const rows = chunkButtonsToRows(btns);
          await handCh.send({
            content: `**Channel the Force** — Choose a FORCE USER figure to suffer **${cost} Strain**:`,
            components: rows.slice(0, 5),
          });
        } catch (err) {
          console.error('Channel the Force strain pick error:', err);
        }
      }
    }
  }
  if (updateHandVisualMessage) await updateHandVisualMessage(game, playerNum, client).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Channel the Force: player picks which FORCE USER figure suffers Strain.
 */
export async function handleCtfStrain(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client, dcHealthState } = ctx;
  const parts = splitCustomId(interaction.customId, 'ctf_strain_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figIdx = parseInt(parts[2], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingChannelTheForceStrain;
  if (!pending || pending.playerNum !== playerNum) {
    await interaction.followUp({ content: 'No Channel the Force strain pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const fig = pending.figures[figIdx];
  if (!fig) {
    await interaction.followUp({ content: 'Invalid selection.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Apply strain via dcHealthState
  const _ctsDcMsgIds = getDcMessageIds(game, playerNum) || [];
  const _ctsDcList = getDcList(game, playerNum) || [];
  let _ctsFigMsgId = null;
  for (let i = 0; i < _ctsDcList.length; i++) {
    if ((_ctsDcList[i]?.dcName || _ctsDcList[i]) === fig.dcName) { _ctsFigMsgId = _ctsDcMsgIds[i]; break; }
  }
  if (_ctsFigMsgId && dcHealthState) {
    // Strain via the canonical applyStrain pipeline.
    const { applyStrain: _applyStrainCtf } = await import('./strain-handler.js');
    await _applyStrainCtf(game, ctx, {
      figureKey: fig.fk,
      controllerPlayerNum: playerNum,
      amount: pending.cost,
      source: 'Channel the Force',
    });
  }
  clearPendingChannelTheForceStrain(game);
  await interaction.message.edit({
    content: `**Channel the Force** — **${fig.dcName}** suffered **${pending.cost} Strain**.`,
    components: [],
  }).catch(discordCatch);
  await logGameAction(game, client,
    `**Channel the Force** — **${fig.dcName}** suffers **${pending.cost} Strain**.`,
    { phase: 'ROUND', icon: 'condition' });
  saveGames(game.gameId);
}

/**
 * Imperial Citadel: player picks Focus or Damage token to place on the card.
 */
export async function handleImpCitadel(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'imp_citadel_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const tokenType = parts[2]; // 'damage' or 'block'
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  game.imperialCitadelTokens = game.imperialCitadelTokens || { damage: 0, block: 0 };
  // Migrate legacy focus→block if present
  if (game.imperialCitadelTokens.focus != null) {
    game.imperialCitadelTokens.block = (game.imperialCitadelTokens.block || 0) + (game.imperialCitadelTokens.focus || 0);
    delete game.imperialCitadelTokens.focus;
  }
  const label = tokenType === 'damage' ? 'Damage' : 'Block';
  game.imperialCitadelTokens[tokenType] = (game.imperialCitadelTokens[tokenType] || 0) + 1;
  const total = game.imperialCitadelTokens;
  await logGameAction(game, client, `🏰 **Imperial Citadel** — placed **1 ${label}** token (now: ${total.damage} Damage, ${total.block} Block).`);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  // Refresh Imperial Citadel embed in play area to show updated token counts
  const dcList = getDcList(game, playerNum) || [];
  const msgIds = getDcMessageIds(game, playerNum) || [];
  const idx = dcList.findIndex(dc => dc?.dcName === '[Imperial Citadel]');
  if (idx >= 0 && msgIds[idx]) {
    await updateDcCardMessage(client, game, msgIds[idx], ctx, { errorContext: 'Failed to refresh Imperial Citadel embed:' });
  }
  await resolveStartOfRoundEffect(game, ctx);
  saveGames(game.gameId);
  await interaction.followUp({ content: `Placed ${label} token on Imperial Citadel.`, ephemeral: true }).catch(discordCatch);
}

/**
 * Handle prog_override_ button: 4-LOM chose a TRAIT for the round.
 * customId: prog_override_{gameId}_{playerNum}_{TRAIT}
 */
export async function handleProgrammingOverride(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, logGameAction, client, saveGames } = ctx;
  const withoutPrefix = parseCustomId(interaction.customId, 'prog_override_');
  const parts = withoutPrefix.split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const trait = parts.slice(2).join(' '); // e.g. "FORCE_USER" → "FORCE USER"
  const game = getGame(gameId);
  if (!game) return;
  game.roundProgrammingOverrideTrait = game.roundProgrammingOverrideTrait || {};
  game.roundProgrammingOverrideTrait[playerNum] = trait;
  await logGameAction(game, client, `🔧 **Programming Override** — **4-LOM** gains **${trait}** until end of round.`, { phase: 'ROUND', icon: 'round' });
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await resolveStartOfRoundEffect(game, ctx);
  saveGames(game.gameId);
}

/**
 * Handle doubt_fig_ button: player picks a hostile figure to remove a condition/token from.
 * customId: doubt_fig_{gameId}_{playerNum}_{figureKey|skip}
 */
export async function handleDoubtFigPick(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, logGameAction, client } = ctx;
  const full = parseCustomId(interaction.customId, 'doubt_fig_');
  const parts = full.split('_');
  const gameId = parts[0];
  const pn = parseInt(parts[1], 10);
  const target = parts.slice(2).join('_');

  const game = getGame(gameId);
  if (!game) return;

  if (target === 'skip') {
    await interaction.message.edit({ content: '**[Doubt]** — Skipped condition/token removal.', components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  const targetFk = target;
  const targetDcName = dcNameFromFigureKey(targetFk);
  const conds = game.figureConditions?.[targetFk] || [];
  const tokens = game.figurePowerTokens?.[targetFk] || [];
  const removables = [
    ...conds.map((c, i) => ({ type: 'condition', value: c, index: i })),
    ...tokens.map((t, i) => ({ type: 'token', value: t, index: i })),
  ];

  if (removables.length === 1) {
    // Only one option — auto-remove
    const item = removables[0];
    if (item.type === 'condition') {
      filterCondition(game, targetFk, item.value);
    } else {
      const arr = game.figurePowerTokens[targetFk] || [];
      arr.splice(item.index, 1);
      if (arr.length === 0) delete game.figurePowerTokens[targetFk];
    }
    const label = item.type === 'condition' ? item.value : `${item.value} Token`;
    await interaction.message.edit({ content: `**[Doubt]** — Discarded **${label}** from **${targetDcName}**.`, components: [] }).catch(discordCatch);
    await logGameAction(game, client, `**[Doubt]** — Discarded ${label} from ${targetDcName}.`, { phase: 'ROUND', icon: 'card' });
  } else {
    // Multiple options — show picker
    const btns = removables.slice(0, 24).map(({ type, value }, i) => {
      const label = type === 'condition' ? `Discard ${value}` : `Discard ${value} Token`;
      return new ButtonBuilder()
        .setCustomId(`doubt_remove_${gameId}_${pn}_${targetFk}_${type}_${i}`)
        .setLabel(truncateLabel(label))
        .setStyle(ButtonStyle.Danger);
    });
    const rows = chunkButtonsToRows(btns);
    await interaction.message.edit({
      content: `**[Doubt]** — Choose a condition or Power Token to discard from **${targetDcName}**:`,
      components: rows.slice(0, 5),
    }).catch(discordCatch);
  }
  saveGames(game.gameId);
}

/**
 * Handle doubt_remove_ button: player picks which condition/token to remove.
 * customId: doubt_remove_{gameId}_{playerNum}_{figureKey}_{condition|token}_{index}
 */
export async function handleDoubtRemove(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, logGameAction, client } = ctx;
  const full = parseCustomId(interaction.customId, 'doubt_remove_');
  // Last two parts are type and index; everything before (after gameId and pn) is the figureKey
  const parts = full.split('_');
  const gameId = parts[0];
  const indexStr = parts.pop();
  const type = parts.pop(); // 'condition' or 'token'
  const targetFk = parts.slice(2).join('_');

  const game = getGame(gameId);
  if (!game) return;

  const targetDcName = dcNameFromFigureKey(targetFk);
  const idx = parseInt(indexStr, 10);

  if (type === 'condition') {
    const conds = game.figureConditions?.[targetFk] || [];
    if (idx < conds.length) {
      const removed = conds[idx];
      filterCondition(game, targetFk, removed);
      await interaction.message.edit({ content: `**[Doubt]** — Discarded **${removed}** from **${targetDcName}**.`, components: [] }).catch(discordCatch);
      await logGameAction(game, client, `**[Doubt]** — Discarded ${removed} from ${targetDcName}.`, { phase: 'ROUND', icon: 'card' });
    }
  } else if (type === 'token') {
    const tokens = game.figurePowerTokens?.[targetFk] || [];
    if (idx < tokens.length) {
      const removed = tokens[idx];
      tokens.splice(idx, 1);
      if (tokens.length === 0) delete game.figurePowerTokens[targetFk];
      else game.figurePowerTokens[targetFk] = tokens;
      await interaction.message.edit({ content: `**[Doubt]** — Discarded **${removed} Token** from **${targetDcName}**.`, components: [] }).catch(discordCatch);
      await logGameAction(game, client, `**[Doubt]** — Discarded ${removed} Token from ${targetDcName}.`, { phase: 'ROUND', icon: 'card' });
    }
  }
  saveGames(game.gameId);
}
