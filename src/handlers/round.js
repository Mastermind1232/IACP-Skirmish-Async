/**
 * Round handlers: end_end_of_round_, end_start_of_round_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDcEffects, getMapSpaces, getFormCards } from '../data-loader.js';
import { getConfig } from '../game/figure-config.js';
import { cleanupRoundStart } from '../game/activation-state.js';

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
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!game.endOfRoundWhoseTurn) {
    await interaction.followUp({ content: 'Not in End of Round window.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== game.endOfRoundWhoseTurn) {
    await interaction.followUp({ content: "It's not your turn in the End of Round window.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  const clearedConditions = []; // collect {figureKey, cleared[]} for announcement
  if (game.figureConditions) {
    for (const fk of Object.keys(game.figureConditions)) {
      const before = game.figureConditions[fk];
      const toRemove = before.filter((c) => c === 'Stun' || c === 'Weaken');
      game.figureConditions[fk] = before.filter((c) => c !== 'Stun' && c !== 'Weaken');
      if (game.figureConditions[fk].length === 0) delete game.figureConditions[fk];
      if (toRemove.length > 0) clearedConditions.push({ figureKey: fk, cleared: toRemove });
    }
  }
  if (clearedConditions.length > 0) {
    const condSummary = clearedConditions.map(({ figureKey, cleared }) => {
      const dcName = figureKey.replace(/-\d+-\d+$/, '');
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
    const healthState = dcHealthState.get(msgId);
    if (!healthState) continue;
    let healed = false;
    for (let i = 0; i < healthState.length; i++) {
      const entry = healthState[i];
      if (!Array.isArray(entry)) continue;
      const [cur, max] = entry;
      if (cur == null || max == null || cur >= max) continue;
      healthState[i] = [Math.min(cur + 2, max), max];
      healed = true;
    }
    if (healed) {
      dcHealthState.set(msgId, healthState);
      const dcIds = meta.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList = meta.playerNum === 1 ? game.p1DcList : game.p2DcList;
      const idx = (dcIds || []).indexOf(msgId);
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
      await logGameAction(game, client, `♻️ **Regenerate** — **${meta.dcName}** recovered 2 HP.`, { phase: 'ROUND', icon: 'round' });
    }
    // Discard Bleed (Stun/Weaken already cleared above)
    for (const fk of Object.keys(game.figureConditions || {})) {
      if (!fk.startsWith(meta.dcName + '-')) continue;
      game.figureConditions[fk] = (game.figureConditions[fk] || []).filter(c => c !== 'Bleed');
      if (game.figureConditions[fk].length === 0) delete game.figureConditions[fk];
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
      game.figureConditions[fk] = (game.figureConditions[fk] || []).filter(c => !HARMFUL.includes(c));
      if (game.figureConditions[fk].length === 0) delete game.figureConditions[fk];
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
      const dcList = pn === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const msgIds = pn === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
      for (let i = 0; i < dcList.length; i++) {
        const dc = dcList[i];
        if (!dc || dc.defeated) continue;
        const eff = _wymEff[dc.dcName] || _wymEff[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!(eff?.specialAbilityIds || []).includes('whats_yours_is_mine_hondo')) continue;
        const mid = msgIds[i];
        if (!mid) continue;
        const ownerId = pn === 1 ? game.player1Id : game.player2Id;
        const oppNum = pn === 1 ? 2 : 1;
        await logGameAction(game, client, `💰 **What's Yours is Mine** — <@${ownerId}>, if **${dc.displayName || dc.dcName}** is in the opponent's deployment zone, steal 2 VP from Player ${oppNum}. *(Honor system.)*`, {
          phase: 'ROUND', icon: 'round',
          allowedMentions: { users: [ownerId] },
        });
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
      const _probeOwnerId = _pNum === 1 ? game.player1Id : game.player2Id;
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
      const healthState = dcHealthState.get(msgId);
      if (healthState && Array.isArray(healthState[0])) {
        const [cur, max] = healthState[0];
        const newCur = Math.max(0, (cur ?? max ?? 0) - entry.damage);
        healthState[0] = [newCur, max ?? cur];
        dcHealthState.set(msgId, healthState);
        const meta = dcMessageMeta.get(msgId);
        const dcMessageIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
        const idx = (dcMessageIds || []).indexOf(msgId);
        if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
        const displayName = meta?.displayName || meta?.dcName || 'Figure';
        await logGameAction(game, client, `**End of round:** ${displayName} suffered ${entry.damage} Damage (e.g. Blaze of Glory).`, { phase: 'ROUND', icon: 'round' });
      }
    }
    game.endOfRoundSelfDamage = {};
  }
  // Scavenged Walker: end of round, may interrupt to perform an attack with -1 Hit
  for (const pn of [1, 2]) {
    const _swMsgIds = pn === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const _swDcList = pn === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const _swAtts = pn === 1 ? (game.p1DcAttachments || {}) : (game.p2DcAttachments || {});
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
      await logGameAction(game, client, `<@${_swOwnerId}> **Scavenged Walker** — **${_swDc.displayName || _swDc.dcName}** may interrupt to perform an attack with -1 Hit at end of round. Use Attack button to perform this attack (remember -1 Hit penalty). *(Honor system for -1 Hit.)*`, {
        components: [_swRow],
        allowedMentions: { users: [_swOwnerId] },
      });
    }
  }
  // Survivalist (Skirmish Upgrade): end of round, if in exterior space, recover 1 Damage
  const _svMapSpaces = game.selectedMap?.id ? getMapSpaces?.(game.selectedMap.id) : null;
  if (_svMapSpaces?.exterior) {
    const _svExterior = new Set((Array.isArray(_svMapSpaces.exterior) ? _svMapSpaces.exterior : []).map(s => String(s).toLowerCase()));
    for (const pn of [1, 2]) {
      const _svMsgIds = pn === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
      const _svDcList = pn === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const _svAtts = pn === 1 ? (game.p1DcAttachments || {}) : (game.p2DcAttachments || {});
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
          const _svHs = dcHealthState.get(_svMid);
          const _svFi = parseInt(fk.split('-').pop(), 10);
          if (_svHs?.[_svFi]) {
            const [_svCur, _svMax] = _svHs[_svFi];
            if (_svCur < _svMax) {
              _svHs[_svFi] = [Math.min(_svMax, _svCur + 1), _svMax];
              dcHealthState.set(_svMid, _svHs);
              const _svIdx = _svMsgIds.indexOf(_svMid);
              if (_svIdx >= 0 && _svDcList[_svIdx]) _svDcList[_svIdx].healthState = [..._svHs];
              await logGameAction(game, client, `**Survivalist** — **${_svDc.displayName || _svDc.dcName}** recovers 1 Damage (exterior space).`, { phase: 'ROUND', icon: 'round' });
            }
          }
        }
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
      const chId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
      const ch = await client.channels.fetch(chId);
      const msg = await ch.messages.fetch(msgId);
      const healthState = dcHealthState.get(msgId) || [];
      const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, meta.displayName, healthState, getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []));
      const components = getDcPlayAreaComponents(msgId, false, game, meta.dcName);
      await msg.edit({ embeds: [embed], files, components }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  game.p1ActivationsRemaining = game.p1ActivationsTotal ?? 0;
  game.p2ActivationsRemaining = game.p2ActivationsTotal ?? 0;
  game.p1ActivatedDcIndices = [];
  game.p2ActivatedDcIndices = [];
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
    const dtHandKey = dt.playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const dtOppDiscardKey = dt.playerNum === 1 ? 'player2CcDiscard' : 'player1CcDiscard';
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
      await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
        await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        saveGames();
        return;
      }
    }
  }

  // NPC Krykna push+damage phase (Chopper Base A): build push queue here; damage runs after all pushes (in modal handler)

  // Hardy + Regenerate: end-of-round passive effects
  {
    const _harmfulConds = ['Bleed', 'Stun', 'Weaken'];
    const _allEff = getDcEffects() || {};
    for (const pn of [1, 2]) {
      for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!pos) continue;
        const dcName = fk.replace(/-\d+-\d+$/, '');
        const passives = _allEff[dcName]?.passives || [];
        // Hardy: discard all harmful conditions
        if (passives.includes('Hardy')) {
          const conds = game.figureConditions?.[fk] || [];
          const removed = conds.filter(c => _harmfulConds.includes(c));
          if (removed.length > 0) {
            game.figureConditions[fk] = conds.filter(c => !_harmfulConds.includes(c));
            await logGameAction(game, client, `💪 **Hardy** — **${dcName}** discarded harmful conditions: ${removed.join(', ')}.`, { phase: 'ROUND', icon: 'round' });
          }
        }
        // Regenerate: recover 2 HP + discard all harmful conditions
        if (passives.includes('Regenerate')) {
          const dcIds = pn === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
          const dcList = pn === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
          const _regMsgId = dcIds.find((id, i) => dcList[i]?.dcName === dcName);
          if (_regMsgId) {
            const _regHS = dcHealthState.get(_regMsgId);
            const _regFigIdx = parseInt(fk.split('-').pop(), 10) || 0;
            if (_regHS?.[_regFigIdx]) {
              const [cur, max] = _regHS[_regFigIdx];
              const newCur = Math.min((cur || 0) + 2, max || cur);
              _regHS[_regFigIdx] = [newCur, max || cur];
              dcHealthState.set(_regMsgId, _regHS);
              const idx = dcIds.indexOf(_regMsgId);
              if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [..._regHS];
              if (newCur > (cur || 0)) {
                await logGameAction(game, client, `🩹 **Regenerate** — **${dcName}** recovered ${newCur - (cur || 0)} HP (${cur} → ${newCur}).`, { phase: 'ROUND', icon: 'round' });
              }
            }
          }
          const conds = game.figureConditions?.[fk] || [];
          const removed = conds.filter(c => _harmfulConds.includes(c));
          if (removed.length > 0) {
            game.figureConditions[fk] = conds.filter(c => !_harmfulConds.includes(c));
            await logGameAction(game, client, `🩹 **Regenerate** — **${dcName}** discarded harmful conditions: ${removed.join(', ')}.`, { phase: 'ROUND', icon: 'round' });
          }
        }
      }
    }
  }

  const prevInitiative = game.initiativePlayerId;
  game.initiativePlayerId = prevInitiative === game.player1Id ? game.player2Id : game.player1Id;
  game.currentRound = (game.currentRound || 1) + 1;
  cleanupRoundStart(game);
  if (runStartOfRoundRules && missionRules?.startOfRound) {
    await runStartOfRoundRules(game, mapId, variant, missionRules.startOfRound, { logGameAction, client, getMapTokensData });
  }
  await updateHandVisualMessage(game, 1, client);
  await updateHandVisualMessage(game, 2, client);
  for (const pn of [1, 2]) {
    const hand = pn === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
    const deck = pn === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
    const handId = pn === 1 ? game.p1HandId : game.p2HandId;
    if (!handId) continue;
    try {
      const handCh = await client.channels.fetch(handId);
      const msgs = await handCh.messages.fetch({ limit: 20 });
      const handMsg = msgs.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      if (handMsg) {
        const payload = buildHandDisplayPayload(hand, deck, game.gameId, game, pn);
        await handMsg.edit({ content: payload.content, embeds: payload.embeds, files: payload.files || [], components: payload.components }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  const initNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  await logGameAction(game, client, `**Status Phase** — 1. Ready cards ✓ 2. ${drawDesc} 3. End of round effects (scoring) ✓ 4. Initiative passes to ${initZone}P${initNum} <@${game.initiativePlayerId}>. Round **${game.currentRound}**.`, { phase: 'ROUND', icon: 'round' });
  await sendRoundActivationPhaseMessage(game, client);

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
      const initNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
      const otherNum = initNum === 1 ? 2 : 1;
      const queue = [];
      for (let i = 0; i < activeKrykna.length; i++) queue.push(i % 2 === 0 ? initNum : otherNum);
      game.pendingKryknaPushQueue = queue;
      game.kryknaPushedIds = [];
      await postKryknaPushButtons(game, generalChannel, gameId);
    }
  }

  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  saveGames();
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
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!game.startOfRoundWhoseTurn) {
    await interaction.followUp({ content: 'Not in Start of Round window.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== game.startOfRoundWhoseTurn) {
    await interaction.followUp({ content: "It's not your turn in the Start of Round window.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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

  // Post-deploy effects: fire once at the start of round 1
  if (game.currentRound === 1 && !game.postDeployEffectsFired) {
    game.postDeployEffectsFired = true;
    const _pdEff = getDcEffects() || {};
    for (const pn of [1, 2]) {
      for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!pos) continue;
        const dcName = fk.replace(/-\d+-\d+$/, '');
        const passives = _pdEff[dcName]?.passives || [];
        // Beskar Armor (The Mandalorian / The Armorer): gain 2 Block Tokens
        if (passives.includes('Beskar Armor')) {
          game.figurePowerTokens = game.figurePowerTokens || {};
          game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
          game.figurePowerTokens[fk].push('Block');
          game.figurePowerTokens[fk].push('Block');
          await logGameAction(game, client, `🛡️ **Beskar Armor** — **${dcName}** gains **2 Block Tokens** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
        }
        // Stealthy (Davith Elso): become Hidden at start of mission
        if (passives.includes('Stealthy')) {
          game.figureConditions = game.figureConditions || {};
          game.figureConditions[fk] = game.figureConditions[fk] || [];
          if (!game.figureConditions[fk].includes('Hide')) game.figureConditions[fk].push('Hide');
          await logGameAction(game, client, `🥷 **Stealthy** — **${dcName}** becomes **Hidden** at start of mission.`, { phase: 'ROUND', icon: 'deployed' });
        }
        // Ambush (Ewok Warrior Elite): become Hidden after deployment
        if (passives.includes('Ambush')) {
          game.figureConditions = game.figureConditions || {};
          game.figureConditions[fk] = game.figureConditions[fk] || [];
          if (!game.figureConditions[fk].includes('Hide')) game.figureConditions[fk].push('Hide');
          await logGameAction(game, client, `🥷 **Ambush** — **${dcName}** becomes **Hidden** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
        }
        // Security Detail (Death Trooper Regular): a friendly LEADER gains 1 Block Token
        if (passives.includes('Security Detail')) {
          const _sdEff = _pdEff || {};
          const leaderFk = Object.keys(game.figurePositions?.[pn] || {}).find(lfk => {
            if (!game.figurePositions[pn][lfk]) return false;
            const ldn = lfk.replace(/-\d+-\d+$/, '');
            return (_sdEff[ldn]?.keywords || []).some(k => k.toUpperCase() === 'LEADER');
          });
          if (leaderFk) {
            game.figurePowerTokens = game.figurePowerTokens || {};
            game.figurePowerTokens[leaderFk] = game.figurePowerTokens[leaderFk] || [];
            game.figurePowerTokens[leaderFk].push('Block');
            const leaderName = leaderFk.replace(/-\d+-\d+$/, '');
            await logGameAction(game, client, `🛡️ **Security Detail** — **${leaderName}** gains **1 Block Token** (from ${dcName}).`, { phase: 'ROUND', icon: 'deployed' });
          }
        }
        // Forward Emplacement (E-Web Engineer Elite): gain movement points equal to speed
        if (passives.includes('Forward Emplacement')) {
          const _feSpeed = _pdEff[dcName]?.speed || 0;
          if (_feSpeed > 0) {
            game.deployBonusMp = game.deployBonusMp || {};
            game.deployBonusMp[fk] = (game.deployBonusMp[fk] || 0) + _feSpeed;
            await logGameAction(game, client, `🏗️ **Forward Emplacement** — **${dcName}** gains **${_feSpeed} MP** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
          }
        }
        // Smooth Landing (Bodhi Rook, Hera Syndulla): self + adjacent friendlies gain 1 MP
        if (passives.includes('Smooth Landing')) {
          const _slPos = game.figurePositions?.[pn]?.[fk];
          if (_slPos) {
            // Grant 1 MP to self
            game.deployBonusMp = game.deployBonusMp || {};
            game.deployBonusMp[fk] = (game.deployBonusMp[fk] || 0) + 1;
            const _slGranted = [dcName];
            // Grant 1 MP to adjacent friendlies
            const _slMs = getMapSpaces(game.selectedMap?.id);
            const _slAdj = (_slMs?.adjacency?.[String(_slPos).toLowerCase()] || []).map(a => String(a).toLowerCase());
            const _slDone = new Set();
            for (const [afk, apos] of Object.entries(game.figurePositions?.[pn] || {})) {
              if (!apos || afk === fk) continue;
              if (!_slAdj.includes(String(apos).toLowerCase())) continue;
              // Only grant once per figure
              if (_slDone.has(afk)) continue;
              _slDone.add(afk);
              game.deployBonusMp[afk] = (game.deployBonusMp[afk] || 0) + 1;
              _slGranted.push(afk.replace(/-\d+-\d+$/, ''));
            }
            await logGameAction(game, client, `🛬 **Smooth Landing** — ${_slGranted.join(', ')} gain${_slGranted.length === 1 ? 's' : ''} **1 MP** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
          }
        }
      }
    }
  }

  // Start-of-round DC passive hooks
  {
    const _sorEff = getDcEffects() || {};
    for (const playerNum of [1, 2]) {
      const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const msgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
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

        // Unstable Devices (Saska Teft): gain 1 device token at start of round
        if (sIds.includes('unstable_devices_saska')) {
          game.deviceTokens = game.deviceTokens || {};
          const _fk = `${dc.dcName}-0-0`;
          game.deviceTokens[_fk] = (game.deviceTokens[_fk] || 0) + 1;
          await logGameAction(game, client, `🔧 **Unstable Devices** — **${dc.displayName || dc.dcName}** gains 1 Device token (now ${game.deviceTokens[_fk]}).`, { phase: 'ROUND', icon: 'round' });
        }

        // Force Slow (Cal Kestis): choose a hostile within 3 to skip activation
        if (sIds.includes('force_slow_cal')) {
          const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
          await logGameAction(game, client, `🐌 **Force Slow** — <@${ownerId}>, choose a hostile figure within 3 spaces of **${dc.displayName || dc.dcName}**; that figure skips its next activation. *(Honor system.)*`, {
            phase: 'ROUND', icon: 'round',
            allowedMentions: { users: [ownerId] },
          });
        }

        // Excavation (Doctor Aphra): choose a CC from discard with cost ≤1, add to hand
        if (sIds.includes('excavation_aphra')) {
          const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
          await logGameAction(game, client, `⛏️ **Excavation** — <@${ownerId}>, choose a Command Card from your discard pile with cost 1 or less and add it to your hand. *(Honor system.)*`, {
            phase: 'ROUND', icon: 'round',
            allowedMentions: { users: [ownerId] },
          });
        }

        // Shape/Shift (Clawdite Shapeshifter): form picker at start of round
        if (sIds.includes('shape_clawdite_elite') || sIds.includes('shape_clawdite_reg') || sIds.includes('shift_clawdite_elite') || sIds.includes('shift_clawdite_reg')) {
          const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
          const _fk = Object.keys(game.figurePositions?.[playerNum] || {}).find(k => k.startsWith(dc.dcName + '-'));
          const _curForm = _fk ? getConfig(game, _fk)?.form : null;
          const formCards = getFormCards();
          const formNames = Object.keys(formCards);
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
  const initRem = game.initiativePlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const otherRem = game.initiativePlayerId === game.player1Id ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
  if (otherRem > initRem && initRem > 0) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pass_activation_turn_${gameId}`)
        .setLabel('Pass turn to opponent')
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
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
  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  saveGames();
}
