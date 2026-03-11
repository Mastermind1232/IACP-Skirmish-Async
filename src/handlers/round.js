/**
 * Round handlers: end_end_of_round_, end_start_of_round_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDcEffects, getMapSpaces, getFormCards } from '../data-loader.js';
import { getConfig } from '../game/figure-config.js';
import { cleanupRoundStart } from '../game/activation-state.js';
import { reduceHp, healHp, healHpDistributed, applyCondition, filterCondition, dcNameFromFigureKey, awardKillVp, deductVp } from '../game/index.js';
import { getRange } from '../game/spatial.js';
import { getDeploymentZones, getCcEffect } from '../data-loader.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getPlayAreaId, getHandChannelId,
  getCcHand, getCcDeck, getCcDiscard, getDcAttachments,
  setActivationsRemaining, setActivatedDcIndices,
  getActivationsTotal,
  ccHandKey, ccDiscardKey, ccDeckKey,
  opponentPlayerNum,
  getInitiativePlayerNum,
} from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';

/**
 * Returns a Set of form names already chosen by OTHER Clawdite Shapeshifters
 * on the same team.  Used to prevent two Clawdites from sharing a form.
 */
function getFormsChosenByTeamClawdites(game, playerNum, excludeFigureKey) {
  const taken = new Set();
  const positions = game.figurePositions?.[playerNum] || {};
  for (const fk of Object.keys(positions)) {
    if (fk === excludeFigureKey) continue;
    if (!fk.startsWith('Clawdite Shapeshifter')) continue;
    const form = getConfig(game, fk)?.form;
    if (form) taken.add(form);
  }
  return taken;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, updateHandChannelMessages, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState, isDepletedRemovedFromGame, buildDcEmbedAndFiles, getDcPlayAreaComponents, countTerminalsControlledByPlayer, isFigureInDeploymentZone, checkWinConditions, getMapTokensData, getSpaceController, getMissionRules, runEndOfRoundRules, getFiguresOnOrAdjacentToSpace, runNpcThugActivation, applyNpcDamageToFigure, getMapSpaces, getMapRegistry, filterMapSpacesByBounds, getInitiativePlayerZoneLabel, updateHandVisualMessage, buildHandDisplayPayload, sendRoundActivationPhaseMessage, buildBoardMapPayload, postDevaronDoorButtons, postDevaronCratePushPrompts, postKryknaPushButtons, client
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
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
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
    getMapSpaces,
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
  const gameId = interaction.customId.replace('end_end_of_round_', '');
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
    saveGames();
    return;
  }
  game.endOfRoundWhoseTurn = null;
  game.dcFinishedPinged = {};
  game.pendingEndTurn = {};
  // Clear per-activation conditions (Stun, Weaken) from all figures at end of round.
  // Rules: Stun/Weaken removed at end of that figure's activation; each figure activates once per round,
  // so clearing at end of round is equivalent.
  // Disarm permanent Weakened: clear the lock now so the Weaken can be removed normally at end of round.
  // The Disarm card leaves play at end of round, so the permanent lock expires here.
  game.disarmPermanentWeakened = {};
  const clearedConditions = []; // collect {figureKey, cleared[]} for announcement
  if (game.figureConditions) {
    for (const fk of Object.keys(game.figureConditions)) {
      const before = game.figureConditions[fk];
      const toRemove = before.filter((c) => c === 'Stun' || c === 'Weaken');
      filterCondition(game, fk, 'Stun');
      filterCondition(game, fk, 'Weaken');
      if (toRemove.length > 0) clearedConditions.push({ figureKey: fk, cleared: toRemove });
    }
  }
  if (clearedConditions.length > 0) {
    const condSummary = clearedConditions.map(({ figureKey, cleared }) => {
      const dcName = dcNameFromFigureKey(figureKey);
      return `**${dcName}**: ${cleared.join(', ')} removed`;
    }).join('; ');
    await logGameAction(game, client, `🔄 **End of Round** — Conditions cleared: ${condSummary}.`, { phase: 'ROUND', icon: 'round' });
  }
  // Regenerate (Bossk): recover 2 HP and discard Bleed at end of round
  const dcEffects = getDcEffects();
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (isDepletedRemovedFromGame(game, msgId)) continue;
    const eff = dcEffects[meta.dcName] || dcEffects[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
    if (!(eff?.specialAbilityIds || []).includes('regenerate_bossk')) continue;
    const { totalRecovered } = healHpDistributed(dcHealthState, game, msgId, 2, meta.playerNum);
    if (totalRecovered > 0) {
      await logGameAction(game, client, `♻️ **Regenerate** — **${meta.dcName}** recovered ${totalRecovered} HP.`, { phase: 'ROUND', icon: 'round' });
    }
    // Discard Bleed (Stun/Weaken already cleared above)
    for (const fk of Object.keys(game.figureConditions || {})) {
      if (!fk.startsWith(meta.dcName + '-')) continue;
      filterCondition(game, fk, 'Bleed');
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
            const _wymOwnVpKey = pn === 1 ? 'player1VP' : 'player2VP';
            const _wymSteal = Math.min(2, game[_wymOppVpKey] || 0);
            game[_wymOppVpKey] = (game[_wymOppVpKey] || 0) - _wymSteal;
            game[_wymOwnVpKey] = (game[_wymOwnVpKey] || 0) + _wymSteal;
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
      reduceHp(dcHealthState, game, msgId, 0, entry.damage, playerNum);
      const meta = dcMessageMeta.get(msgId);
      const displayName = meta?.displayName || meta?.dcName || 'Figure';
      await logGameAction(game, client, `**End of round:** ${displayName} suffered ${entry.damage} Damage (e.g. Blaze of Glory).`, { phase: 'ROUND', icon: 'round' });
    }
    game.endOfRoundSelfDamage = {};
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
      for (let fi = 0; fi < healthState.length; fi++) {
        if (!Array.isArray(healthState[fi])) continue;
        if (healthState[fi][0] <= 0) {
          // Figure defeated by Adrenaline end-of-round damage
          const dcName = info.dcName || 'Figure';
          const figureKey = Object.keys(game.figurePositions?.[pn] || {}).find(fk => fk.startsWith(dcName.replace(/\s*\[.*\]\s*$/, '').trim()));
          if (figureKey && game.figurePositions?.[pn]?.[figureKey]) {
            delete game.figurePositions[pn][figureKey];
          }
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
      if (!(_swAtts[_swMid] || []).includes('Scavenged Walker')) continue;
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
  // Driven by Hatred (Darth Vader): end of round, move up to 2 spaces, then may use Force Choke or perform an attack (-1 die)
  for (const pn of [1, 2]) {
    const _dbhMsgIds = getDcMessageIds(game, pn) || [];
    const _dbhDcList = getDcList(game, pn) || [];
    const _dbhAtts = getDcAttachments(game, pn) || {};
    for (let i = 0; i < _dbhMsgIds.length; i++) {
      const _dbhMid = _dbhMsgIds[i];
      if (!(_dbhAtts[_dbhMid] || []).includes('Driven by Hatred')) continue;
      const _dbhDc = _dbhDcList[i];
      if (!_dbhDc?.dcName || _dbhDc.defeated) continue;
      const _dbhOwnerId = game[`player${pn}Id`];
      const _dbhRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dbh_force_choke_${gameId}_${_dbhMid}`).setLabel('Move 2 + Force Choke').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`dbh_attack_${gameId}_${_dbhMid}`).setLabel('Move 2 + Attack (-1 die)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`dbh_skip_${gameId}_${_dbhMid}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await logGameAction(game, client, `<@${_dbhOwnerId}> **Driven by Hatred** — **${_dbhDc.displayName || _dbhDc.dcName}** may move up to 2 spaces and then use Force Choke or perform an attack (-1 die) at end of round.`, {
        components: [_dbhRow],
        allowedMentions: { users: [_dbhOwnerId] },
      });
    }
  }
  // Survivalist (Skirmish Upgrade): end of round, if in exterior space, recover 1 Damage
  const _svMapSpaces = game.selectedMap?.id ? getMapSpaces?.(game.selectedMap.id) : null;
  if (_svMapSpaces?.exterior) {
    const _svExterior = new Set((Array.isArray(_svMapSpaces.exterior) ? _svMapSpaces.exterior : []).map(s => String(s).toLowerCase()));
    for (const pn of [1, 2]) {
      const _svMsgIds = getDcMessageIds(game, pn) || [];
      const _svDcList = getDcList(game, pn) || [];
      const _svAtts = getDcAttachments(game, pn) || {};
      for (let i = 0; i < _svMsgIds.length; i++) {
        const _svMid = _svMsgIds[i];
        if (!(_svAtts[_svMid] || []).includes('Survivalist')) continue;
        const _svDc = _svDcList[i];
        if (!_svDc?.dcName || _svDc.defeated) continue;
        // Check if any figure in this group is in an exterior space
        const _svDgIdx = (_svDc.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _svFigs = game.figurePositions?.[pn] || {};
        for (const [fk, pos] of Object.entries(_svFigs)) {
          if (!fk.startsWith(`${_svDc.dcName}-${_svDgIdx}-`)) continue;
          if (!_svExterior.has(String(pos).toLowerCase())) continue;
          // Recover 1 HP for this figure
          const _svFi = parseInt(fk.split('-').pop(), 10);
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
            const _bmFkIdx = parseInt(fk.split('-').pop(), 10) || 0;
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
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (isDepletedRemovedFromGame(game, msgId)) continue;
    dcExhaustedState.set(msgId, false);
    if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
    if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
    if (game.exhaustedSkirmishUpgrades?.[msgId]) delete game.exhaustedSkirmishUpgrades[msgId];
    try {
      const chId = getPlayAreaId(game, meta.playerNum);
      const ch = await client.channels.fetch(chId);
      const msg = await ch.messages.fetch(msgId);
      const healthState = dcHealthState.get(msgId) || [];
      const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, meta.displayName, healthState, getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []));
      const components = getDcPlayAreaComponents(msgId, false, game, meta.dcName);
      await msg.edit({ embeds: [embed], files, components }).catch(discordCatch);
    } catch (err) {
      console.error('Failed to ready DC embed:', err);
    }
  }
  // Regenerate the board map so condition icons and updated health are reflected
  if (buildBoardMapPayload && game.boardId && game.selectedMap) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to refresh board at end of round:', err);
    }
  }
  for (const pn of [1, 2]) {
    setActivationsRemaining(game, pn, getActivationsTotal(game, pn) ?? 0);
    setActivatedDcIndices(game, pn, []);
  }
  const mapId = game.selectedMap?.id;
  const p1Terminals = mapId ? countTerminalsControlledByPlayer(game, 1, mapId) : 0;
  const p2Terminals = mapId ? countTerminalsControlledByPlayer(game, 2, mapId) : 0;
  let p1DrawCount = 1 + p1Terminals;
  let p2DrawCount = 1 + p2Terminals;
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
  const variant = game.selectedMission?.variant;
  const missionRules = getMissionRules?.(mapId, variant) ?? {};
  const endOfRoundRules = missionRules.endOfRound;
  if (endOfRoundRules && runEndOfRoundRules) {
    const ruleCtx = { logGameAction, checkWinConditions, getMapTokensData, getSpaceController, isFigureInDeploymentZone, getFiguresOnOrAdjacentToSpace, client };
    const { gameEnded } = await runEndOfRoundRules(game, mapId, variant, endOfRoundRules, ruleCtx);
    if (gameEnded) {
      await interaction.message.edit({ components: [] }).catch(discordCatch);
      saveGames();
      return;
    }
  }

  // NPC thug activation (Corellian Underground A)
  if (runNpcThugActivation && mapId === 'corellian-underground' && variant === 'a') {
    const { logs: thugLogs, damageEvents } = runNpcThugActivation(game, mapId, { getMapTokensData, getMapSpaces, getMapRegistry, filterMapSpacesByBounds });
    for (const line of thugLogs) {
      await logGameAction(game, client, `🔫 **Thug:** ${line}`, { phase: 'ROUND', icon: 'attack' });
    }
    for (const { figureKey, playerNum, damage } of damageEvents) {
      await applyNpcDamageToFigure(game, playerNum, figureKey, damage, 'Thug', logGameAction, client, dcHealthState, dcMessageMeta);
    }
    if (damageEvents.length > 0) {
      await checkWinConditions(game, client);
      if (game.ended) {
        await interaction.message.edit({ components: [] }).catch(discordCatch);
        saveGames();
        return;
      }
    }
  }

  // NPC Krykna push+damage phase (Chopper Base A): build push queue here; damage runs after all pushes (in modal handler)

  // NOTE: Hardy + Regenerate already processed above (lines 103-154). Duplicate block removed.

  const prevInitiative = game.initiativePlayerId;
  game.initiativePlayerId = prevInitiative === game.player1Id ? game.player2Id : game.player1Id;
  game.currentRound = (game.currentRound || 1) + 1;
  cleanupRoundStart(game);
  if (runStartOfRoundRules && missionRules?.startOfRound) {
    await runStartOfRoundRules(game, mapId, variant, missionRules.startOfRound, { logGameAction, client, getMapTokensData });
  }
  // Run start-of-round DC effects (post-deploy for R1, DC abilities every round)
  const hasPendingSor = await runStartOfRoundDcEffects(game, gameId, client, { logGameAction });
  await updateHandVisualMessage(game, 1, client);
  await updateHandVisualMessage(game, 2, client);
  for (const pn of [1, 2]) {
    const hand = getCcHand(game, pn) || [];
    const deck = getCcDeck(game, pn) || [];
    const handId = getHandChannelId(game, pn);
    if (!handId) continue;
    try {
      const handCh = await client.channels.fetch(handId);
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
  const generalChannel = await client.channels.fetch(game.generalId);
  const drawDesc = hadCutLines
    ? 'No Command card draw this round (Cut Lines).'
    : `P1 drew ${p1DrawCount} card${p1DrawCount !== 1 ? 's' : ''} (${p1Terminals} terminal${p1Terminals !== 1 ? 's' : ''} controlled). P2 drew ${p2DrawCount} card${p2DrawCount !== 1 ? 's' : ''} (${p2Terminals} terminal${p2Terminals !== 1 ? 's' : ''} controlled). ✓`;
  const initZone = getInitiativePlayerZoneLabel(game);
  const initNum = getInitiativePlayerNum(game);
  await logGameAction(game, client, `**Status Phase** — 1. Ready cards ✓ 2. ${drawDesc} 3. End of round effects (scoring) ✓ 4. Initiative passes to ${initZone}P${initNum} <@${game.initiativePlayerId}>. Round **${game.currentRound}**.`, { phase: 'ROUND', icon: 'round' });
  if (!hasPendingSor) {
    await sendRoundActivationPhaseMessage(game, client);
  }

  // Devaron Garrison B: terminal→door selection + crate push prompts (posted after round starts)
  if (mapId === 'devaron-garrison' && variant === 'b') {
    if (!game.cratePositions) {
      const dMap = getMapTokensData()['devaron-garrison'];
      const allCrates = Object.values(dMap?.missionB?.positions || {}).flat().filter(Boolean).map((c) => String(c).toLowerCase());
      game.cratePositions = {};
      for (const c of allCrates) game.cratePositions[c] = c;
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

  // Chopper Base A: build Krykna push queue and post buttons (damage fires after all pushes in modal handler)
  if (mapId === 'chopper-base-atollon' && variant === 'a' && postKryknaPushButtons) {
    const activeKrykna = (game.npcKrykna || []).filter((k) => !k.defeated);
    if (activeKrykna.length > 0) {
      const initNum = getInitiativePlayerNum(game);
      const otherNum = opponentPlayerNum(initNum);
      const queue = [];
      for (let i = 0; i < activeKrykna.length; i++) queue.push(i % 2 === 0 ? initNum : otherNum);
      game.pendingKryknaPushQueue = queue;
      game.kryknaPushedIds = [];
      await postKryknaPushButtons(game, generalChannel, gameId);
    }
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames();
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
  const { logGameAction } = ctx;

  // Post-deploy effects now handled by runPostDeployPhase() in post-deploy.js
  // (called from the appropriate trigger points: cc-hand.js, index.js Draft Random, etc.)

  // Start-of-round DC passive hooks
  {
    const _sorEff = getDcEffects() || {};
    for (const playerNum of [1, 2]) {
      const dcList = getDcList(game, playerNum) || [];
      const msgIds = getDcMessageIds(game, playerNum) || [];
      for (let i = 0; i < dcList.length; i++) {
        const dc = dcList[i];
        if (!dc || dc.defeated) continue;
        const eff = _sorEff[dc.dcName] || _sorEff[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        const sIds = eff?.specialAbilityIds || [];

        // Brush (Ezra Bridger): gain 4 MP at start of round
        if (sIds.includes('brush_ezra')) {
          const mid = msgIds[i];
          if (mid) {
            game.movementBank = game.movementBank || {};
            game.movementBank[mid] = game.movementBank[mid] || { total: 0, remaining: 0 };
            game.movementBank[mid].total += 4;
            game.movementBank[mid].remaining += 4;
            await logGameAction(game, client, `🌿 **Brush** — **${dc.displayName || dc.dcName}** gains **4 MP** at the start of the round.`, { phase: 'ROUND', icon: 'round' });
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

        // Programming Override (4-LOM): choose a TRAIT at start of round
        if (sIds.includes('programming_override_4lom')) {
          const ownerId = getPlayerId(game, playerNum);
          const traits = ['TROOPER', 'SPY', 'HUNTER', 'SMUGGLER', 'FORCE USER', 'BRAWLER', 'CREATURE', 'LEADER', 'GUARDIAN', 'WOOKIEE', 'VEHICLE'];
          const btns = traits.map(t => new ButtonBuilder()
            .setCustomId(`prog_override_${gameId}_${playerNum}_${t.replace(/\s/g, '_')}`)
            .setLabel(t)
            .setStyle(ButtonStyle.Primary)
          );
          const rows = [];
          for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
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
            const btns = formNames.map(name => new ButtonBuilder()
              .setCustomId(`form_pick_${gameId}_${_fk}_${name}`)
              .setLabel(name === _curForm ? `${name} (current)` : name)
              .setStyle(name === _curForm ? ButtonStyle.Secondary : ButtonStyle.Primary)
            );
            const rows = [];
            for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
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
          game.player1Vp = (game.player1Vp || 0) + 4;
          game.player2Vp = (game.player2Vp || 0) + 4;
          await logGameAction(game, client, `⚔️ **First Strike** — Both players receive **4 VPs**.`);
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
          await logGameAction(game, client, `📜 **Rule by Fear** — <@${ownerId}> drew ${drew.length} CC${drew.length !== 1 ? 's' : ''}: ${drewText}. Now choose 1 card to discard.`, {
            allowedMentions: { users: [ownerId] },
          });
          // Post discard picker in hand channel
          if (hand.length > 0) {
            game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
            const handChannelId = getHandChannelId(game, playerNum);
            try {
              const handCh = await client.channels.fetch(handChannelId);
              const discardBtns = hand.slice(0, 25).map((card, idx) => new ButtonBuilder()
                .setCustomId(`rbf_discard_${gameId}_${playerNum}_${idx}`)
                .setLabel(card.length > 80 ? card.slice(0, 77) + '...' : card)
                .setStyle(ButtonStyle.Danger)
              );
              const discardRows = [];
              for (let r = 0; r < discardBtns.length; r += 5) discardRows.push(new ActionRowBuilder().addComponents(discardBtns.slice(r, r + 5)));
              await handCh.send({ content: '**Rule by Fear** — Choose 1 card from your hand to discard:', components: discardRows });
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
          await logGameAction(game, client, `🎯 **Rogue One** — <@${ownerId}> drew ${drew.length} CC${drew.length !== 1 ? 's' : ''}: ${drewText}. Now place 2 cards from your hand on top of your deck.`, {
            allowedMentions: { users: [ownerId] },
          });
          // Post picker in hand channel
          if (hand.length > 0) {
            game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 0) + 1;
            game[`pendingRogueOne_p${playerNum}`] = { remaining: 2 };
            const handChannelId = getHandChannelId(game, playerNum);
            try {
              const handCh = await client.channels.fetch(handChannelId);
              const pickBtns = hand.slice(0, 25).map((card, idx) => new ButtonBuilder()
                .setCustomId(`rogue_one_return_${gameId}_${playerNum}_${idx}`)
                .setLabel(card.length > 80 ? card.slice(0, 77) + '...' : card)
                .setStyle(ButtonStyle.Primary)
              );
              const pickRows = [];
              for (let r = 0; r < pickBtns.length; r += 5) pickRows.push(new ActionRowBuilder().addComponents(pickBtns.slice(r, r + 5)));
              await handCh.send({ content: '**Rogue One** — Choose a card to place on top of your deck (1 of 2):', components: pickRows });
            } catch (err) {
              console.error('Rogue One return picker failed:', err);
            }
          }
        }

        // [Imperial Citadel]: At the start of each round, place 1 Focus or Damage token on this card
        if (dcName.includes('Imperial Citadel') && text.includes('At the start of each round')) {
          const btns = [
            new ButtonBuilder()
              .setCustomId(`imp_citadel_${gameId}_${playerNum}_focus`)
              .setLabel('Place Focus Token')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`imp_citadel_${gameId}_${playerNum}_damage`)
              .setLabel('Place Damage Token')
              .setStyle(ButtonStyle.Danger),
          ];
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
async function resolveStartOfRoundEffect(game, ctx) {
  game.pendingStartOfRoundResolve = (game.pendingStartOfRoundResolve || 1) - 1;
  if (game.pendingStartOfRoundResolve <= 0) {
    delete game.pendingStartOfRoundResolve;
    const { sendRoundActivationPhaseMessage, client, saveGames } = ctx;
    if (sendRoundActivationPhaseMessage) {
      await sendRoundActivationPhaseMessage(game, client);
    }
    if (saveGames) saveGames();
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
  const gameId = interaction.customId.replace('end_start_of_round_', '');
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
    saveGames();
    return;
  }
  game.startOfRoundWhoseTurn = null;

  // Post-deploy effects now handled by runPostDeployPhase() in post-deploy.js

  // Start-of-round DC passive hooks
  {
    const _sorEff = getDcEffects() || {};
    for (const playerNum of [1, 2]) {
      const dcList = getDcList(game, playerNum) || [];
      const msgIds = getDcMessageIds(game, playerNum) || [];
      for (let i = 0; i < dcList.length; i++) {
        const dc = dcList[i];
        if (!dc || dc.defeated) continue;
        const eff = _sorEff[dc.dcName] || _sorEff[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        const sIds = eff?.specialAbilityIds || [];

        // Brush (Ezra Bridger): gain 4 MP at start of round
        if (sIds.includes('brush_ezra')) {
          const mid = msgIds[i];
          if (mid) {
            game.movementBank = game.movementBank || {};
            game.movementBank[mid] = game.movementBank[mid] || { total: 0, remaining: 0 };
            game.movementBank[mid].total += 4;
            game.movementBank[mid].remaining += 4;
            await logGameAction(game, client, `🌿 **Brush** — **${dc.displayName || dc.dcName}** gains **4 MP** at the start of the round.`, { phase: 'ROUND', icon: 'round' });
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
            const btns = formNames.map(name => new ButtonBuilder()
              .setCustomId(`form_pick_${gameId}_${_fk}_${name}`)
              .setLabel(name === _curForm ? `${name} (current)` : name)
              .setStyle(name === _curForm ? ButtonStyle.Secondary : ButtonStyle.Primary)
            );
            const rows = [];
            for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
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

  const generalChannel = await client.channels.fetch(game.generalId);
  const roundEmbed = new EmbedBuilder()
    .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${game.currentRound} - Start of Round`)
    .setColor(PHASE_COLOR);
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
        .setLabel('Pass turn to opponent')
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  const initPlayerNum = getInitiativePlayerNum(game);
  const passHint = otherRem > initRem && initRem > 0 ? ' You may pass back (opponent has more activations).' : '';
  const content = showBtn
    ? `<@${game.initiativePlayerId}> (**Player ${initPlayerNum}**) **Round ${game.currentRound}** — Your turn! All deployment groups readied. Both players: click **End R${game.currentRound} Activation Phase** when you've used all activations and any end-of-activation effects.${passHint}`
    : `<@${game.initiativePlayerId}> (**Player ${initPlayerNum}**) **Round ${game.currentRound}** — Your turn! All deployment groups readied. Use all activations and actions. The **End R${game.currentRound} Activation Phase** button will appear when both players have done so.${passHint}`;
  const sent = await generalChannel.send({
    content,
    embeds: [roundEmbed],
    components,
    allowedMentions: { users: [game.initiativePlayerId] },
  });
  game.roundActivationMessageId = sent.id;
  game.roundActivationButtonShown = showBtn;
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  await updateHandChannelMessages(game, client);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames();
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
  // Find hostile figures within 3 spaces
  const hostiles = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[oppNum] || {})) {
    if (!pos) continue;
    if (getRange(calPos, pos) <= 3) hostiles.push({ fk, dcName: dcNameFromFigureKey(fk) });
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
  // Multiple targets — show picker
  const btns = hostiles.map(({ fk, dcName }) =>
    new ButtonBuilder().setCustomId(`force_slow_pick_${gameId}_${playerNum}_${fk}`).setLabel(dcName).setStyle(ButtonStyle.Primary)
  );
  const rows = [];
  for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
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
  const discard = getCcDiscard(game, playerNum) || [];
  // Filter to cost <= 1 cards
  const eligible = [];
  for (let i = 0; i < discard.length; i++) {
    const ccData = getCcEffect(discard[i]);
    const cost = ccData?.cost ?? 99;
    if (cost <= 1) eligible.push({ name: discard[i], index: i });
  }
  if (eligible.length === 0) {
    await logGameAction(game, client, `⛏️ **Excavation** — **${dc.displayName || dc.dcName}**: no Command Cards with cost 1 or less in discard pile.`, { phase: 'ROUND', icon: 'round' });
    return;
  }
  if (eligible.length === 1) {
    // Auto-select the only eligible card
    const cardName = eligible[0].name;
    const discardKey = ccDiscardKey(playerNum);
    const handKey = ccHandKey(playerNum);
    game[discardKey] = discard.filter((_, i) => i !== eligible[0].index);
    game[handKey] = game[handKey] || [];
    game[handKey].push(cardName);
    await logGameAction(game, client, `⛏️ **Excavation** — **${dc.displayName || dc.dcName}** retrieved **${cardName}** from discard pile (only eligible card).`, { phase: 'ROUND', icon: 'round' });
    return;
  }
  // Multiple eligible — show picker
  const btns = eligible.map(({ name, index }) =>
    new ButtonBuilder().setCustomId(`excavation_pick_${gameId}_${playerNum}_${index}`).setLabel(name.slice(0, 80)).setStyle(ButtonStyle.Primary)
  );
  const rows = [];
  for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
  await logGameAction(game, client, `⛏️ **Excavation** — <@${ownerId}>, choose a Command Card (cost ≤1) from your discard pile to add to hand:`, {
    phase: 'ROUND', icon: 'round',
    components: rows,
    allowedMentions: { users: [ownerId] },
  });
}

// ---- Skirmish Upgrade SOR button handlers ----

/**
 * Extra Armor: player picks a figure to give 1 Block Token (repeats until 4 distributed).
 * Confirm step: first click shows confirm/cancel, second click applies the token.
 */
export async function handleExtraArmorPick(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('extra_armor_pick_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  // Player verification
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owning player can distribute Extra Armor tokens.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pending = game[`pendingExtraArmor_p${playerNum}`];
  if (!pending || pending.remaining <= 0) {
    await interaction.followUp({ content: 'Extra Armor tokens already distributed.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const dcName = dcNameFromFigureKey(figureKey);
  // Show confirm/cancel buttons
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`extra_armor_confirm_${gameId}_${playerNum}_${figureKey}`).setLabel(`Confirm: ${dcName}`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`extra_armor_cancel_${gameId}_${playerNum}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  await interaction.message.edit({
    content: `🛡️ **Extra Armor** — Place **1 Block Token** on **${dcName}**? (${pending.remaining} remaining)`,
    components: [confirmRow],
  }).catch(discordCatch);
}

/**
 * Extra Armor confirm: apply the Block Token.
 */
export async function handleExtraArmorConfirm(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('extra_armor_confirm_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owning player can distribute Extra Armor tokens.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pending = game[`pendingExtraArmor_p${playerNum}`];
  if (!pending || pending.remaining <= 0) {
    await interaction.followUp({ content: 'Extra Armor tokens already distributed.', ephemeral: true }).catch(discordCatch);
    return;
  }
  game.figurePowerTokens = game.figurePowerTokens || {};
  game.figurePowerTokens[figureKey] = game.figurePowerTokens[figureKey] || [];
  game.figurePowerTokens[figureKey].push('Block');
  pending.remaining -= 1;
  const dcName = dcNameFromFigureKey(figureKey);
  await logGameAction(game, client, `🛡️ **Extra Armor** — **${dcName}** gains **1 Block Token** (${pending.remaining} remaining).`);
  if (pending.remaining <= 0) {
    delete game[`pendingExtraArmor_p${playerNum}`];
    await interaction.message.edit({ content: '🛡️ **Extra Armor** — All 4 Block Tokens distributed.', components: [] }).catch(discordCatch);
    // If post-deploy queue is active, advance it
    if (game.postDeployQueue) {
      const { onExtraArmorComplete } = await import('./post-deploy.js');
      await onExtraArmorComplete(game, gameId, client, { logGameAction, saveGames });
    }
  } else {
    // Rebuild figure picker with remaining count
    const allFks = Object.keys(game.figurePositions?.[playerNum] || {});
    const btns = allFks.slice(0, 20).map(fk => new ButtonBuilder()
      .setCustomId(`extra_armor_pick_${gameId}_${playerNum}_${fk}`)
      .setLabel(fk.replace(/-\d+-\d+$/, ''))
      .setStyle(ButtonStyle.Primary)
    );
    const rows = [];
    for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
    await interaction.message.edit({
      content: `🛡️ **Extra Armor** — Choose a figure to give **1 Block Token** (${pending.remaining} remaining):`,
      components: rows,
    }).catch(discordCatch);
  }
  saveGames();
}

/**
 * Extra Armor cancel: go back to figure picker.
 */
export async function handleExtraArmorCancel(interaction, ctx) {
  const { getGame } = ctx;
  const parts = interaction.customId.replace('extra_armor_cancel_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owning player can distribute Extra Armor tokens.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pending = game[`pendingExtraArmor_p${playerNum}`];
  if (!pending || pending.remaining <= 0) return;
  const allFks = Object.keys(game.figurePositions?.[playerNum] || {});
  const btns = allFks.slice(0, 20).map(fk => new ButtonBuilder()
    .setCustomId(`extra_armor_pick_${gameId}_${playerNum}_${fk}`)
    .setLabel(fk.replace(/-\d+-\d+$/, ''))
    .setStyle(ButtonStyle.Primary)
  );
  const rows = [];
  for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
  await interaction.message.edit({
    content: `🛡️ **Extra Armor** — Choose a figure to give **1 Block Token** (${pending.remaining} remaining):`,
    components: rows,
  }).catch(discordCatch);
}

/**
 * Rule by Fear: player picks 1 card from hand to discard.
 */
export async function handleRbfDiscard(interaction, ctx) {
  const { getGame, saveGames, updateHandVisualMessage, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('rbf_discard_', '').split('_');
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
  await logGameAction(game, client, `📜 **Rule by Fear** — discarded **${card}**.`);
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  if (updateHandVisualMessage) await updateHandVisualMessage(game, playerNum, client).catch(discordCatch);
  saveGames();
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
  const { getGame, saveGames, updateHandVisualMessage, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('rogue_one_return_', '').split('_');
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
  await logGameAction(game, client, `🎯 **Rogue One** — placed **${card}** on top of deck (${pending.remaining} remaining).`);
  if (pending.remaining <= 0) {
    delete game[`pendingRogueOne_p${playerNum}`];
    try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
    await interaction.followUp({ content: 'Both cards returned to deck.', ephemeral: true }).catch(discordCatch);
    // Resolve start-of-round blocking effect
    if (game.pendingStartOfRoundResolve > 0) {
      await resolveStartOfRoundEffect(game, ctx);
    }
  } else {
    // Rebuild buttons with updated hand
    const pickBtns = hand.slice(0, 25).map((c, idx) => new ButtonBuilder()
      .setCustomId(`rogue_one_return_${gameId}_${playerNum}_${idx}`)
      .setLabel(c.length > 80 ? c.slice(0, 77) + '...' : c)
      .setStyle(ButtonStyle.Primary)
    );
    const pickRows = [];
    for (let r = 0; r < pickBtns.length; r += 5) pickRows.push(new ActionRowBuilder().addComponents(pickBtns.slice(r, r + 5)));
    try { await interaction.message.edit({ components: pickRows }).catch(discordCatch); } catch {}
    await interaction.followUp({ content: `Placed **${card}** on deck. Pick 1 more card to return.`, ephemeral: true }).catch(discordCatch);
  }
  if (updateHandVisualMessage) await updateHandVisualMessage(game, playerNum, client).catch(discordCatch);
  saveGames();
}

/**
 * Imperial Citadel: player picks Focus or Damage token to place on the card.
 */
export async function handleImpCitadel(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('imp_citadel_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const tokenType = parts[2]; // 'focus' or 'damage'
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  game.imperialCitadelTokens = game.imperialCitadelTokens || { focus: 0, damage: 0 };
  const label = tokenType === 'focus' ? 'Focus' : 'Damage';
  game.imperialCitadelTokens[tokenType] = (game.imperialCitadelTokens[tokenType] || 0) + 1;
  const total = game.imperialCitadelTokens;
  await logGameAction(game, client, `🏰 **Imperial Citadel** — placed **1 ${label}** token (now: ${total.focus} Focus, ${total.damage} Damage).`);
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  saveGames();
  await interaction.followUp({ content: `Placed ${label} token on Imperial Citadel.`, ephemeral: true }).catch(discordCatch);
}

/**
 * Handle prog_override_ button: 4-LOM chose a TRAIT for the round.
 * customId: prog_override_{gameId}_{playerNum}_{TRAIT}
 */
export async function handleProgrammingOverride(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, logGameAction, client, saveGames } = ctx;
  const withoutPrefix = interaction.customId.replace('prog_override_', '');
  const parts = withoutPrefix.split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const trait = parts.slice(2).join(' '); // e.g. "FORCE_USER" → "FORCE USER"
  const game = getGame(gameId);
  if (!game) return;
  game.roundProgrammingOverrideTrait = game.roundProgrammingOverrideTrait || {};
  game.roundProgrammingOverrideTrait[playerNum] = trait;
  await logGameAction(game, client, `🔧 **Programming Override** — **4-LOM** gains **${trait}** until end of round.`, { phase: 'ROUND', icon: 'round' });
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  saveGames();
}
