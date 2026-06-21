/**
 * Round handlers: end_end_of_round_, end_start_of_round_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDcEffects, getMapData, getFormCards, getCcEffectsData, getMapTokensData as _getMapTokensData } from '../data-loader.js';
import { getConfig, getFormsChosenByTeamClawdites } from '../game/figure-config.js';
import { cleanupRoundStart } from '../game/activation-state.js';
import { clearRoundModifiersUntilEor } from '../game/round-modifiers.js';
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
import { exhaustAttachment } from '../game/card-state-helpers.js';
import { findSmugglingCompartmentMsgId, smugglingCompartmentPeek, applySmugglingCompartmentReorder } from '../game/smuggling-compartment.js';
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
    // Step 5: resolve the NON-init player's DC end-of-round effects now, so
    // they interleave with that player's CC plays in their own window turn
    // (alexanbv 2026-06-13).
    await _runDcEorForPlayer(game, gameId, interaction, ctx, otherNum);
    await updateHandChannelMessages(game, client);
    saveGames(game.gameId);
    return;
  }
  game.endOfRoundWhoseTurn = null;

  // alexanbv 2026-06-13: both players have taken their EoR window turn (step 4
  // init, step 5 non-init), AFTER the status-phase prefix (draw/ready/mission)
  // and mission scoring. Each player's DC EoR effects already resolved during
  // their own window turn (_runDcEorForPlayer). Now run the round tail only —
  // initiative swap → status SOR gate → next round.
  if (interaction?.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
  await _runEorTailAndContinue(game, gameId, interaction, ctx, game._eorSuffixLogVars || {});
  delete game._eorSuffixLogVars;
  saveGames(game.gameId);
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

/**
 * Clear "until the end of the round" active effects. Per alexanbv (2026-06-20):
 * effects worded "until the end of the round" turn off at the START of the EOR
 * (status) phase, so they fall off BEFORE EOR scoring/triggers resolve. This is
 * distinct from "during this round" effects, which persist THROUGH the EOR phase
 * and only clear at the round boundary (cleanupRoundStart, the ROUND_* buckets).
 *
 * Each flag below is ALSO registered in a ROUND_* bucket in activation-state.js;
 * that round-start reset is a harmless safety net. The point of clearing here is
 * that these effects must be GONE before EOR effects evaluate.
 *
 * NOTE — the old SHARED per-player combat counters (roundDefenseBonusBlock /
 * roundDefenseBonusEvade / roundDefenseAccuracyPenalty / roundAttackSurgeBonus
 * etc.) were REMOVED 2026-06-20 and replaced by the per-figure activeRoundModifiers
 * registry. Each descriptor now carries its own duration: 'until-eor' descriptors
 * (Survival Instincts, Fuel Upgrade, Deflection, Smuggled Supplies) are cleared
 * here via clearRoundModifiersUntilEor(game); 'during-round' descriptors persist
 * through the EOR phase and clear at the round boundary. Payback / Reverse
 * Engineer +Surge are now per-figure IMMEDIATE attack bonuses (paybackBonusSurge),
 * not round-scoped at all.
 *
 *   - roundEfficientTravel is "until end of round" but is a movement-only effect
 *     that cannot be read during EOR scoring, so re-bucketing has no effect.
 */
export function clearUntilEndOfRoundFlags(game) {
  // Disarm permanent Weakened lock — Disarm card leaves play at end of round.
  game.disarmPermanentWeakened = {};
  // In the Shadows (CC) — "until the end of the round" LOS effect.
  game.roundInTheShadows = null;
  // I Must Go Alone (CC) — "Until the end of the round, hostile figures cannot
  // declare attacks targeting you unless within 3 spaces." Targeting/defense
  // buff; isolated flag; moved to EOR-start clearing 2026-06-20.
  game.roundDefenderCannotBeTargetedUnlessWithinSpaces = null;
  // Programming Override (4-LOM DC) — "You gain that TRAIT until the end of the
  // round." TRAIT grants can gate EOR scoring/triggers, so the grant must be
  // gone before EOR effects evaluate. Isolated flag; moved 2026-06-20.
  game.roundProgrammingOverrideTrait = {};
  // Active round-modifier registry (alexanbv 2026-06-20): drop 'until-eor'
  // descriptors (Survival Instincts, Fuel Upgrade, Deflection, Smuggled
  // Supplies) so they are GONE before EOR effects evaluate. 'during-round'
  // descriptors persist through the EOR phase and clear at the round boundary.
  clearRoundModifiersUntilEor(game);
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
  // "Until the end of the round" effects fall off HERE (start of the EOR/status
  // phase), BEFORE end-of-round scoring/triggers resolve. (Distinct from "during
  // this round" effects, which persist THROUGH the EOR phase and clear at round
  // start via cleanupRoundStart.) See clearUntilEndOfRoundFlags.
  clearUntilEndOfRoundFlags(game);

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
    exhaustAttachment(game, _ctfMid, 'Channel the Force');
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

  // Async mission EoR effects (thug picker, Krykna push, ...) are
  // declared per-mission in data/mission-cards.json under rules.endOfRound
  // and dispatched via the mission-eor-effects registry. Each registered
  // effect can return { pending: true } to halt the round-end chain;
  // its drain handler resumes via runRemainingMissionEorEffects + then
  // _runDcEorAndContinue. See src/game/mission-eor-effects-wiring.js for
  // registered handlers.
  {
    const _logVars = { p1Terminals, p1HasRHC, p2Terminals, p2HasRHC, p1DrawCount, p2DrawCount, hadCutLines };
    const { runMissionEorEffects } = await import('../game/mission-eor-effects.js');
    await import('../game/mission-eor-effects-wiring.js'); // side-effect: registers handlers
    const _missionEorRes = endOfRoundRules
      ? await runMissionEorEffects(game, endOfRoundRules, ctx, { gameId, interaction, logVars: _logVars })
      : { pending: false };
    if (_missionEorRes.pending) {
      if (interaction?.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
  }

  await _openEorWindowAfterMission(game, gameId, interaction, ctx,
    { p1Terminals, p1HasRHC, p2Terminals, p2HasRHC, p1DrawCount, p2DrawCount, hadCutLines });
}

/**
 * Single post-mission-EoR continuation (alexanbv 2026-06-13): every path
 * that finishes the mission EoR rules — the linear status-phase flow AND
 * each async mission-effect resume (Krykna, Devaron, fluctuation, reveal) —
 * funnels here. It opens the player End-of-Round window (init player first),
 * which is steps 4-5 of the status phase, AFTER mission scoring (step 3), and
 * resolves the INIT player's DC EoR effects (_runDcEorForPlayer) so they
 * interleave with that player's CC plays. The non-init player's DC EoR runs
 * when init closes their window (handleEndEndOfRound); the round tail
 * (_runEorTailAndContinue) runs when the non-init player closes theirs.
 * logVars are stashed (game._eorSuffixLogVars) for that tail.
 */
export async function _openEorWindowAfterMission(game, gameId, interaction, ctx, logVars) {
  const { logGameAction, client, updateHandChannelMessages, getInitiativePlayerZoneLabel, saveGames } = ctx;
  game._eorSuffixLogVars = logVars || {};
  game.endOfRoundWhoseTurn = game.initiativePlayerId;
  const _eorOtherPlayerId = game.initiativePlayerId === game.player1Id ? game.player2Id : game.player1Id;
  const _eorInitZone = getInitiativePlayerZoneLabel ? getInitiativePlayerZoneLabel(game) : '';
  if (logGameAction) {
    await logGameAction(game, client, `**End of Round** — Mission rules resolved ✓. <@${game.initiativePlayerId}> (${_eorInitZone}Initiative) — play any end-of-round effects or CCs in any order, then click **End 'End of Round' window** in your Hand. Then <@${_eorOtherPlayerId}>.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [game.initiativePlayerId, _eorOtherPlayerId] } });
  }
  // Step 4: resolve the INIT player's DC end-of-round effects now (auto
  // effects fire, interactive prompts post into their window) so they
  // interleave with the init player's CC plays (alexanbv 2026-06-13).
  const _eorInitNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  await _runDcEorForPlayer(game, gameId, interaction, ctx, _eorInitNum);
  if (updateHandChannelMessages) await updateHandChannelMessages(game, client);
  if (saveGames) saveGames(game.gameId);
}

/**
 * DC EoR loops + post-DC tail (Krykna push / fluctuation gate / initiative
 * swap). Called both inline by handleEndEndOfRound (no thug picker) and by
 * the thug-picker resume continuation after the picker drains — so DC EoR
 * always runs after mission EoR per CRR, even on rounds where the thug
 * picker intercepts the inline flow.
 */
export async function _runDcEorForPlayer(game, gameId, interaction, ctx, _eorPlayerNum) {
  const {
    logGameAction, client, saveGames,
    dcMessageMeta, dcHealthState, isDepletedRemovedFromGame,
    isFigureInDeploymentZone, checkWinConditions,
  } = ctx;
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  // alexanbv 2026-06-13: a player's DC EoR effects resolve during THEIR own
  // window turn (step 4 = init player, step 5 = non-init), interleaved with
  // their CC plays — NOT all-at-once after both players pass. _eorPlayers
  // scopes every block below to the single active player. The round tail
  // (initiative swap → next round) runs separately, after the non-init player
  // closes their window (see handleEndEndOfRound).
  const _eorPlayers = [_eorPlayerNum];

  // DC ability EoR effects (run after mission EoR per CRR)
  const dcEffects = getDcEffects();
  // Regenerate (Bossk): recover 2 HP and discard Bleed at end of round
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (meta.playerNum !== _eorPlayerNum) continue;
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
    if (meta.playerNum !== _eorPlayerNum) continue;
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
    for (const pn of _eorPlayers) {
      const dcList = getDcList(game, pn) || [];
      const msgIds = getDcMessageIds(game, pn) || [];
      for (let i = 0; i < dcList.length; i++) {
        const dc = dcList[i];
        if (!dc || dc.defeated) continue;
        const eff = _wymEff[dc.dcName] || _wymEff[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!(eff?.specialAbilityIds || []).includes('whats_yours_is_mine_hondo')) continue;
        const mid = msgIds[i];
        if (!mid) continue;
        // Once per MISSION (CSV row 283) — alexanbv 2026-06-20. Skip if Hondo
        // has already stolen VP this game (this flag is never reset).
        if (game.whatsYoursIsMineUsed?.[mid]) continue;
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
            // Two independent effects: opponent loses 2 VP (clamped so they
            // cannot go below 0), and you ALWAYS gain 2 VP regardless of how
            // much the opponent was able to lose.
            const _wymOppVpKey = oppNum === 1 ? 'player1VP' : 'player2VP';
            const _wymLose = Math.min(2, game[_wymOppVpKey]?.total || 0);
            const _wymGain = 2;
            deductVp(game, oppNum, _wymLose);
            awardObjectiveVp(game, pn, _wymGain);
            // Consume the once-per-mission use.
            game.whatsYoursIsMineUsed = game.whatsYoursIsMineUsed || {};
            game.whatsYoursIsMineUsed[mid] = true;
            await logGameAction(game, client, `💰 **What's Yours is Mine** — **${dc.displayName || dc.dcName}** is in the opponent's deployment zone! Player ${oppNum} loses **${_wymLose} VP**, you gain **${_wymGain} VP**.`, { phase: 'ROUND', icon: 'round' });
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
    if (_pNum !== _eorPlayerNum) continue;
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
    for (const playerNum of _eorPlayers) {
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
      if (Number(pn) !== _eorPlayerNum) continue;
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
  // Adrenaline: at end of round, remove the temporary +5 Health bonus for each
  // boosted WOOKIEE. Spec (combat-spec.csv:528 / cc-effects.json): the card ONLY
  // grants "+5 Health to each of your WOOKIEEs during this round" — there is NO
  // damage clause. Revert by lowering max HP by 5 and clamping current to the new
  // max; never deal damage and never defeat a figure.
  if (game.adrenalineBonuses && typeof game.adrenalineBonuses === 'object') {
    for (const [msgId, info] of Object.entries(game.adrenalineBonuses)) {
      const pn = info.playerNum;
      if (Number(pn) !== _eorPlayerNum) continue;
      if (!dcMessageMeta.get(msgId)) continue;
      const healthState = dcHealthState.get(msgId);
      if (!healthState) continue;
      for (let fi = 0; fi < healthState.length; fi++) {
        if (!Array.isArray(healthState[fi])) continue;
        const [cur, max] = healthState[fi];
        const curHp = cur ?? max ?? 0;
        const maxHp = max ?? cur ?? 0;
        // Revert the +5 max HP bonus; clamp current to the new max (no damage).
        const newMax = Math.max(0, maxHp - 5);
        const newCur = Math.min(curHp, newMax);
        healthState[fi] = [newCur, newMax];
      }
      dcHealthState.set(msgId, healthState);
      // Sync to dcList
      const dcIds = getDcMessageIds(game, pn) || [];
      const dcListArr = getDcList(game, pn) || [];
      const idx = dcIds.indexOf(msgId);
      if (idx >= 0 && dcListArr[idx]) dcListArr[idx].healthState = [...healthState];
      await logGameAction(game, client, `**End of round — Adrenaline** — **${info.dcName}** lost the **+5 Health** bonus.`, { phase: 'ROUND', icon: 'round' });
    }
    game.adrenalineBonuses = {};
  }
  // Scavenged Walker: end of round, may interrupt to perform an attack with -1 Hit
  for (const pn of _eorPlayers) {
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
        new ButtonBuilder().setCustomId(`scavenged_walker_attack_${gameId}_${_swMid}`).setLabel('Interrupt Attack (-1 Damage)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`scavenged_walker_skip_${gameId}_${_swMid}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await logGameAction(game, client, `<@${_swOwnerId}> **Scavenged Walker** — **${_swDc.displayName || _swDc.dcName}** may interrupt to perform an attack with -1 Damage at end of round.`, {
        components: [_swRow],
        allowedMentions: { users: [_swOwnerId] },
      });
    }
  }
  // Mortar Launcher (AT-RT): at the end of the round, may move up to 2 spaces,
  // then choose a space within 3 containing a hostile figure and roll 1 red
  // die (area damage). Driven from EoR (NOT a mid-activation special action).
  // (alexanbv 2026-06-18.)
  {
    const _mlEff = getDcEffects();
    for (const pn of _eorPlayers) {
      const _mlMsgIds = getDcMessageIds(game, pn) || [];
      const _mlDcList = getDcList(game, pn) || [];
      for (let i = 0; i < _mlMsgIds.length; i++) {
        const _mlMid = _mlMsgIds[i];
        if (!_mlMid) continue;
        const _mlDc = _mlDcList[i];
        if (!_mlDc?.dcName || _mlDc.defeated) continue;
        const _mlAbil = _mlEff[_mlDc.dcName] || _mlEff[_mlDc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!(_mlAbil?.specialAbilityIds || []).includes('mortar_launcher')) continue;
        // Confirm at least one live figure of this DC is on the board.
        const _mlDgIdx = (_mlDc.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _mlFk = `${_mlDc.dcName}-${_mlDgIdx}-0`;
        if (!game.figurePositions?.[pn]?.[_mlFk]) continue;
        const _mlOwnerId = game[`player${pn}Id`];
        const _mlRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`mortar_eor_use_${gameId}_${_mlMid}`).setLabel('Use Mortar Launcher (Move 2 + Mortar)').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`mortar_eor_skip_${gameId}_${_mlMid}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await logGameAction(game, client, `<@${_mlOwnerId}> 💥 **Mortar Launcher** — **${_mlDc.displayName || _mlDc.dcName}** may move up to 2 spaces, then mortar a space within 3 (end of round).`, {
          components: [_mlRow],
          allowedMentions: { users: [_mlOwnerId] },
        });
      }
    }
  }
  // [Rogue Smuggler] (Han Solo) — once-per-round EoR free attack.
  // Per alexanbv 2026-05-10: the card text uses "Exhaust this card" but
  // we treat this as a once-per-round ability gated on a round-scoped
  // flag (`game.roundFigureAbilityUsed[\`${msgId}_rogueSmugglerEor\`]`),
  // not via the deprecated exhaust mechanic. Round-flag is wiped at
  // start of the next round by the standard round-reset sweep.
  for (const pn of _eorPlayers) {
    const _rsMsgIds = getDcMessageIds(game, pn) || [];
    const _rsDcList = getDcList(game, pn) || [];
    const _rsAtts = getDcAttachments(game, pn) || {};
    for (let i = 0; i < _rsMsgIds.length; i++) {
      const _rsMid = _rsMsgIds[i];
      if (!cardNameIncludes(_rsAtts[_rsMid], 'Rogue Smuggler')) continue;
      const _rsDc = _rsDcList[i];
      if (!_rsDc?.dcName || _rsDc.defeated) continue;
      const _rsDgIdx = (_rsDc.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _rsFk = `${_rsDc.dcName}-${_rsDgIdx}-0`;
      // Per alexanbv 2026-06-13: per FIGURE (key by Han's figureKey, not the group msgId).
      const _rsRoundKey = `${_rsFk}_rogueSmugglerEor`;
      if (game.roundFigureAbilityUsed?.[_rsRoundKey]) continue;
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
  // Set a Trap (CC) is intentionally unimplemented (requires a map-tile model
  // this engine lacks); see setATrapEffect in abilities.js. No end-of-round
  // driver fires. (alexanbv 2026-06-18.)
  // Rest in Peace (CC): per errata the "discard this card and draw 1 Command
  // card" resolves at END OF ROUND, not at play time. The card is already in
  // discard (CC play auto-discards), satisfying "discard this card"; here we
  // draw 1 CC for each owner who played it this round. (alexanbv 2026-06-18.)
  if (Array.isArray(game.restInPeacePending) && game.restInPeacePending.includes(_eorPlayerNum)) {
    const _ripDeckKey = ccDeckKey(_eorPlayerNum);
    const _ripHandKey = ccHandKey(_eorPlayerNum);
    const _ripDeck = game[_ripDeckKey] || [];
    if (_ripDeck.length > 0) {
      const _ripDrawn = _ripDeck.shift();
      const _ripHand = game[_ripHandKey] || [];
      _ripHand.push(_ripDrawn);
      game[_ripDeckKey] = _ripDeck;
      game[_ripHandKey] = _ripHand;
      await logGameAction(game, client, `🪦 **Rest in Peace** — Player ${_eorPlayerNum} discards Rest in Peace and draws 1 Command card (end of round).`, { phase: 'ROUND', icon: 'card' });
      if (ctx.updateHandChannelMessages) await ctx.updateHandChannelMessages(game, client);
    } else {
      await logGameAction(game, client, `🪦 **Rest in Peace** — Player ${_eorPlayerNum}: Command deck empty, no card drawn (end of round).`, { phase: 'ROUND', icon: 'card' });
    }
    game.restInPeacePending = game.restInPeacePending.filter(p => p !== _eorPlayerNum);
  }
  // Driven by Hatred (Darth Vader): end of round, move up to 2 spaces, then may use Force Choke or perform an attack (-1 die)
  for (const pn of _eorPlayers) {
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
    for (const pn of _eorPlayers) {
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
    for (const pn of _eorPlayers) {
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
  // [Smuggling Compartment] SU Part 2: before the Status Phase, look at the top
  // and bottom cards of your Command deck and optionally move 1 to the top or
  // bottom. Private (hand channel) — deck contents are secret. No exhaust gate
  // (only Part 1's reaction exhausts the card). alexanbv 2026-06-17.
  for (const pn of _eorPlayers) {
    const _scMid = findSmugglingCompartmentMsgId(
      getDcList(game, pn), getDcMessageIds(game, pn), (mid) => isDepletedRemovedFromGame(game, mid),
    );
    if (!_scMid) continue;
    const _scDeckKey = pn === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const _scPeek = smugglingCompartmentPeek(game[_scDeckKey] || []);
    if (!_scPeek) continue; // empty deck — nothing to look at
    const _scHandChId = getHandChannelId(game, pn);
    if (!_scHandChId) continue;
    try {
      const _scCh = await fetchGameChannel(client, _scHandChId);
      if (_scPeek.single) {
        await _scCh.send({ content: `**[Smuggling Compartment]** — Your Command deck has a single card (top = bottom): **${_scPeek.top}**. Nothing to reorder.` });
        continue;
      }
      game.pendingSmugglingCompartmentPeek = game.pendingSmugglingCompartmentPeek || {};
      game.pendingSmugglingCompartmentPeek[pn] = { top: _scPeek.top, bottom: _scPeek.bottom };
      const _scRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sc_reorder_${gameId}_${pn}_topToBottom`).setLabel(truncateLabel(`Top → bottom: ${_scPeek.top}`)).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`sc_reorder_${gameId}_${pn}_bottomToTop`).setLabel(truncateLabel(`Bottom → top: ${_scPeek.bottom}`)).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`sc_reorder_${gameId}_${pn}_skip`).setLabel('Leave as-is').setStyle(ButtonStyle.Secondary),
      );
      await _scCh.send({
        content: `**[Smuggling Compartment]** — Top of deck: **${_scPeek.top}** · Bottom of deck: **${_scPeek.bottom}**. You may move 1 of them to the top or bottom of your Command deck:`,
        components: [_scRow],
      });
    } catch (err) {
      console.error('Smuggling Compartment peek error:', err);
    }
  }

  // [Doubt] SU: at end of round, choose hostile figure, discard 1 condition or Power Token
  for (const pn of _eorPlayers) {
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
  // NOTE: Hardy + Regenerate already processed above. Fluctuation swap gate
  // lives in the mission EoR phase (src/game/mission-eor-effects-wiring.js),
  // which runs BEFORE this per-player DC EoR. The round tail (initiative swap
  // → next round) is NOT run here — it fires once, after the non-init player
  // closes their window (handleEndEndOfRound → _runEorTailAndContinue).
  if (saveGames) saveGames(game.gameId);
}

/**
 * The end-of-round tail: initiative swap → status-phase log → mission SOR
 * gate → next round. Runs ONCE, after BOTH players have closed their EoR
 * window (step 5 complete). Pulls the captured status-phase logVars stashed
 * by _openEorWindowAfterMission.
 */
export async function _runEorTailAndContinue(game, gameId, interaction, ctx, logVars) {
  const v = logVars || {};
  await _runInitiativeSwapAndContinue(game, gameId, interaction, ctx, {
    p1Terminals: v.p1Terminals, p1HasRHC: v.p1HasRHC,
    p2Terminals: v.p2Terminals, p2HasRHC: v.p2HasRHC,
    p1DrawCount: v.p1DrawCount, p2DrawCount: v.p2DrawCount,
    hadCutLines: v.hadCutLines,
  });
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
  // Per alexanbv 2026-06-13: mission SoR rules resolve BEFORE either
  // player's Start-of-Round window opens. The window (startOfRoundWhoseTurn)
  // is now opened in _continueAfterMissionSor, which runs after the mission
  // rules above (and on the pending-resume path), not here.
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

  // Reset per-round ability-usage flags as the FIRST thing in SOR, BEFORE mission
  // rules (alexanbv 2026-06-16: "each once/round ability should have a used flag …
  // reset as the first thing in the SOR phase before mission rules"). The generic
  // limit guard (combat-conditions.js limitGuard) reads game.roundAbilityUsed.
  game.roundAbilityUsed = {};
  // Deadly Precision (CC) is a "this round" effect — clear it each new round.
  game.deadlyPrecisionActive = {};
  // There is Another (Leia CC) relaxes CC play-legality for one round — clear it.
  game.thereIsAnotherActive = {};
  // Hold Ground (CC): "until the end of the round" — clear the holder each round
  // (alexanbv 2026-06-19; previously persisted across rounds).
  game.holdGroundPlayerNum = null;
  // Hide in Plain Sight (CC): "cannot be targeted until end of round" — clear it.
  game.untargetableUntilRoundEnd = {};
  // Brutal Tactics (Saw): once-per-round trigger limit — reset each round.
  game.brutalTacticsUsedThisRound = {};

  // Mission SOR async effects: dispatch via the mission-eor-effects
  // registry (which now handles both EoR and SOR). Halts early on any
  // pending picker; drain handlers resume via runRemainingMissionSorEffects
  // + then _continueAfterMissionSor.
  {
    const { runMissionSorEffects } = await import('../game/mission-eor-effects.js');
    await import('../game/mission-eor-effects-wiring.js'); // side-effect: registers handlers
    const sorRes = missionRules?.startOfRound
      ? await runMissionSorEffects(game, missionRules.startOfRound, ctx, { gameId, interaction })
      : { pending: false };
    if (sorRes.pending) {
      if (interaction?.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
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
 *   - DC start-of-round passives (Brash, Force Slow, Excavation, etc.)
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

  // Open the Start-of-Round window now — AFTER mission SoR rules have
  // resolved (alexanbv 2026-06-13: mission rules happen first, before
  // either player's window). Init player takes their window turn first.
  if (!game.startOfRoundWhoseTurn) game.startOfRoundWhoseTurn = game.initiativePlayerId;

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
  // Devaron Garrison B (openDoorPerTerminal), Krykna push, and
  // fluctuation swap moved to mission EoR phase in handleEndEndOfRound
  // via the mission-eor-effects registry (runs BEFORE player DC EoR
  // per CRR + alexanbv 2026-05-10). See src/game/mission-eor-effects-wiring.js.

  if (interaction?.message) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
  }
  saveGames(game.gameId);
}

/**
 * Resume after fluctuation swap drains. Fluctuation swap is a mission
 * EoR effect (registered in src/game/mission-eor-effects-wiring.js) —
 * runs BEFORE DC EoR per CRR. Drain handler resumes via
 * runRemainingMissionEorEffects (any subsequent pending mission EoR
 * effects) followed by _openEorWindowAfterMission (opens the player window
 * and resolves the init player's DC EoR effects).
 */
export async function continueAfterFluctuationSwap(game, gameId, interaction, ctx) {
  const logVars = game._fluctuationResumeLogVars || game._pendingStatusPhaseLog || {};
  delete game._fluctuationResumeLogVars;
  delete game._pendingStatusPhaseLog;
  delete game.pendingFluctuationSwapQueue;
  delete game.pendingFluctuationSwapFirst;
  const { runRemainingMissionEorEffects } = await import('../game/mission-eor-effects.js');
  const res = await runRemainingMissionEorEffects(game, ctx);
  if (res.pending) {
    if (ctx.saveGames) ctx.saveGames(game.gameId);
    return;
  }
  // Mission EoR rules done → open the player window (alexanbv 2026-06-13).
  await _openEorWindowAfterMission(game, gameId, interaction, ctx, logVars);
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

        // Brash (Ezra Bridger): "Move up to 4 spaces" at start of
        // round. CRR MOVE-017 — pendingMoveX picker, bypassCosts true,
        // 4-space budget, no banking. Out-of-activation timing per
        // rule 1: spent immediately.
        if (sIds.includes('brash_ezra')) {
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
                source: 'Brash',
                threadId: null,
                bypassCosts: true,
              });
              await logGameAction(game, client, `🌿 **Brash** — **${dc.displayName || dc.dcName}** may move up to 4 spaces at the start of the round.`, { phase: 'ROUND', icon: 'round' });
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

        // Shift (Clawdite Shapeshifter): form re-pick at start of round.
        // Shape (initial Form pick at post-deploy) is handled in
        // src/handlers/setup.js — do NOT add `shape_clawdite_*` here.
        if (sIds.includes('shift_clawdite_elite') || sIds.includes('shift_clawdite_reg')) {
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

        // [Spectre Cell] (errata): At the start of each round, distribute
        // 1 Damage and 1 Block token among friendly figures (once per round).
        // The owner picks a friendly figure for the Damage token, then for the
        // Block token, via the spectre_cell_dist_ picker.
        if (dcName === '[Spectre Cell]') {
          const _scFks = Object.keys(game.figurePositions?.[playerNum] || {}).filter(k => game.figurePositions[playerNum][k]);
          if (_scFks.length > 0) {
            game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
            game[`pendingSpectreCell_p${playerNum}`] = { remaining: ['Damage', 'Block'] };
            const _scBtns = _scFks.slice(0, 24).map(fk => new ButtonBuilder()
              .setCustomId(`spectre_cell_dist_${gameId}_${playerNum}_${fk}`)
              .setLabel(truncateLabel(buildFigureButtonLabel(fk, game)))
              .setStyle(ButtonStyle.Danger)
            );
            _stashSorActions(game, _scBtns, 'Spectre Cell', playerNum);
            const _scRows = chunkButtonsToRows(_scBtns);
            await logGameAction(game, client, `👻 **[Spectre Cell]** — <@${ownerId}>, choose a friendly figure to gain **1 Damage** token (start of round):`, {
              components: _scRows.slice(0, 5),
              allowedMentions: { users: [ownerId] },
            });
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

        // Brash (Ezra Bridger): "Move up to 4 spaces" at start of
        // round. CRR MOVE-017 — pendingMoveX picker, bypassCosts true,
        // 4-space budget, no banking. Out-of-activation timing per
        // rule 1: spent immediately.
        if (sIds.includes('brash_ezra')) {
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
                source: 'Brash',
                threadId: null,
                bypassCosts: true,
              });
              await logGameAction(game, client, `🌿 **Brash** — **${dc.displayName || dc.dcName}** may move up to 4 spaces at the start of the round.`, { phase: 'ROUND', icon: 'round' });
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

        // Shift (Clawdite Shapeshifter): form re-pick at start of round.
        // Shape (initial Form pick at post-deploy) is handled in
        // src/handlers/setup.js — do NOT add `shape_clawdite_*` here.
        if (sIds.includes('shift_clawdite_elite') || sIds.includes('shift_clawdite_reg')) {
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
 * [Smuggling Compartment] Part 2: owner chooses whether to move the top or
 * bottom card of their Command deck (or leave it). Deck contents are secret, so
 * the log names only the action, not the moved card.
 */
export async function handleSmugglingCompartmentReorder(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_reorder_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const action = parts[2];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const deckKey = ccDeckKey(playerNum);
  game[deckKey] = applySmugglingCompartmentReorder(game[deckKey] || [], action);
  if (game.pendingSmugglingCompartmentPeek) delete game.pendingSmugglingCompartmentPeek[playerNum];
  const verb = action === 'topToBottom'
    ? 'sent the top card to the bottom'
    : action === 'bottomToTop'
      ? 'brought the bottom card to the top'
      : 'left the deck unchanged';
  await interaction.message.edit({
    content: `**[Smuggling Compartment]** — ${action === 'skip' ? 'Left deck as-is.' : 'Deck reordered.'}`,
    components: [],
  }).catch(discordCatch);
  await logGameAction(game, client, `**[Smuggling Compartment]** — P${playerNum} ${verb}.`, { phase: 'ROUND', icon: 'card' });
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
 * Handle spectre_cell_dist_ button: [Spectre Cell] (errata) start-of-round
 * distribution of 1 Damage + 1 Block token among friendly figures.
 * customId: spectre_cell_dist_{gameId}_{playerNum}_{figureKey}
 * Two-step picker: first click places the Damage token, the re-posted picker
 * places the Block token, then resolves the SoR effect.
 */
export async function handleSpectreCellDist(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, logGameAction, client } = ctx;
  const full = parseCustomId(interaction.customId, 'spectre_cell_dist_');
  const parts = full.split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the Spectre Cell owner can distribute these tokens.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pending = game[`pendingSpectreCell_p${playerNum}`];
  if (!pending || !pending.remaining?.length) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    return;
  }
  const tokenType = pending.remaining.shift(); // 'Damage' then 'Block'
  grantPowerTokens(game, figureKey, tokenType, 1);
  const figName = dcNameFromFigureKey(figureKey);
  await logGameAction(game, client, `👻 **[Spectre Cell]** — **${figName}** gains **1 ${tokenType}** token.`, { phase: 'ROUND', icon: 'round' });
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  if (pending.remaining.length > 0) {
    // Post the next token's picker (Block).
    const nextType = pending.remaining[0];
    const fks = Object.keys(game.figurePositions?.[playerNum] || {}).filter(k => game.figurePositions[playerNum][k]);
    const btns = fks.slice(0, 24).map(fk => new ButtonBuilder()
      .setCustomId(`spectre_cell_dist_${gameId}_${playerNum}_${fk}`)
      .setLabel(truncateLabel(buildFigureButtonLabel(fk, game)))
      .setStyle(nextType === 'Damage' ? ButtonStyle.Danger : ButtonStyle.Primary)
    );
    _stashSorActions(game, btns, 'Spectre Cell', playerNum);
    const rows = chunkButtonsToRows(btns);
    await logGameAction(game, client, `👻 **[Spectre Cell]** — <@${ownerId}>, choose a friendly figure to gain **1 ${nextType}** token:`, {
      components: rows.slice(0, 5),
      allowedMentions: { users: [ownerId] },
    });
    saveGames(game.gameId);
    return;
  }
  // Both tokens placed — done.
  delete game[`pendingSpectreCell_p${playerNum}`];
  await resolveStartOfRoundEffect(game, ctx);
  saveGames(game.gameId);
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
