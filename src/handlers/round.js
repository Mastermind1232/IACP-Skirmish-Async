/**
 * Round handlers: end_end_of_round_, end_start_of_round_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, updateHandChannelMessages, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState, isDepletedRemovedFromGame, buildDcEmbedAndFiles, getDcPlayAreaComponents, countTerminalsControlledByPlayer, isFigureInDeploymentZone, checkWinConditions, getMapTokensData, getSpaceController, getMissionRules, runEndOfRoundRules, getInitiativePlayerZoneLabel, updateHandVisualMessage, buildHandDisplayPayload, sendRoundActivationPhaseMessage, client
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
    getInitiativePlayerZoneLabel,
    updateHandVisualMessage,
    buildHandDisplayPayload,
    sendRoundActivationPhaseMessage,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('end_end_of_round_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!game.endOfRoundWhoseTurn) {
    await interaction.reply({ content: 'Not in End of Round window.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== game.endOfRoundWhoseTurn) {
    await interaction.reply({ content: "It's not your turn in the End of Round window.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  await interaction.deferUpdate();
  game.dcFinishedPinged = {};
  game.pendingEndTurn = {};
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
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (isDepletedRemovedFromGame(game, msgId)) continue;
    dcExhaustedState.set(msgId, false);
    if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
    if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
    try {
      const chId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
      const ch = await client.channels.fetch(chId);
      const msg = await ch.messages.fetch(msgId);
      const healthState = dcHealthState.get(msgId) || [];
      const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, meta.displayName, healthState, getConditionsForDcMessage?.(game, meta));
      const components = getDcPlayAreaComponents(msgId, false, game, meta.dcName);
      await msg.edit({ embeds: [embed], files, components }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch (err) {
      console.error('Failed to ready DC embed:', err);
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
  if (game.shadowOpsBlockedPlayer) game.shadowOpsBlockedPlayer = null;
  game.signalJammerActive = null;
  game.harshEnvironmentActive = false;
  game.terminalControlPlayerNum = null;
  game.unlimitedPowerActive = null;
  game.crippledFigures = [];
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
    const ruleCtx = { logGameAction, checkWinConditions, getMapTokensData, getSpaceController, isFigureInDeploymentZone, client };
    const { gameEnded } = await runEndOfRoundRules(game, mapId, variant, endOfRoundRules, ruleCtx);
    if (gameEnded) {
      await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      saveGames();
      return;
    }
  }
  game.p1LaunchPanelFlippedThisRound = false;
  game.p2LaunchPanelFlippedThisRound = false;
  const prevInitiative = game.initiativePlayerId;
  game.initiativePlayerId = prevInitiative === game.player1Id ? game.player2Id : game.player1Id;
  game.currentRound = (game.currentRound || 1) + 1;
  game.roundDefenseBonusBlock = {};
  game.roundDefenseBonusEvade = {};
  game.roundDefenderBonusBlockPerEvade = {};
  game.roundDroidExtraActionCostDamage = null;
  game.sitTightPlayerNum = null;
  game.roundInTheShadowsPlayerNum = null;
  game.strengthInNumbersPlayerNum = null;
  game.provokeNextActivation = null;
  game.roundAttackSurgeBonus = {};
  game.roundUtinniJawaBuffs = null;
  game.roundSmugglersTricksPlayerNum = null;
  game.squadSwarmPlayerNum = null;
  game.whenDefeatHostileWithin3GainBlockTokens = null;
  game.overrunThisActivation = {};
  if (runStartOfRoundRules && missionRules?.startOfRound) {
    runStartOfRoundRules(game, mapId, variant, missionRules.startOfRound, { logGameAction, client });
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
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!game.startOfRoundWhoseTurn) {
    await interaction.reply({ content: 'Not in Start of Round window.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== game.startOfRoundWhoseTurn) {
    await interaction.reply({ content: "It's not your turn in the Start of Round window.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  await interaction.deferUpdate();
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
