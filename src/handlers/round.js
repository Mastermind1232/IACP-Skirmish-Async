/**
 * Round handlers: end_end_of_round_, end_start_of_round_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, updateHandChannelMessages, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState, isDepletedRemovedFromGame, buildDcEmbedAndFiles, getDcPlayAreaComponents, countTerminalsControlledByPlayer, isFigureInDeploymentZone, checkWinConditions, getMapTokensData, getSpaceController, getInitiativePlayerZoneLabel, updateHandVisualMessage, buildHandDisplayPayload, sendRoundActivationPhaseMessage, client
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
    getInitiativePlayerZoneLabel,
    updateHandVisualMessage,
    buildHandDisplayPayload,
    sendRoundActivationPhaseMessage,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('end_end_of_round_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!game.endOfRoundWhoseTurn) {
    await interaction.reply({ content: 'Not in End of Round window.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.endOfRoundWhoseTurn) {
    await interaction.reply({ content: "It's not your turn in the End of Round window.", ephemeral: true }).catch(() => {});
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
      await msg.edit({ embeds: [embed], files, components }).catch(() => {});
    } catch (err) {
      console.error('Failed to ready DC embed:', err);
    }
  }
  game.p1ActivationsRemaining = game.p1ActivationsTotal ?? 0;
  game.p2ActivationsRemaining = game.p2ActivationsTotal ?? 0;
  const mapId = game.selectedMap?.id;
  const p1Terminals = mapId ? countTerminalsControlledByPlayer(game, 1, mapId) : 0;
  const p2Terminals = mapId ? countTerminalsControlledByPlayer(game, 2, mapId) : 0;
  const p1DrawCount = 1 + p1Terminals;
  const p2DrawCount = 1 + p2Terminals;
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
  if (game.selectedMission?.variant === 'b' && mapId && game.figureContraband) {
    for (const pn of [1, 2]) {
      let scored = 0;
      for (const [figureKey, carrying] of Object.entries(game.figureContraband)) {
        if (!carrying) continue;
        const poses = game.figurePositions?.[pn] || {};
        if (!(figureKey in poses)) continue;
        if (!isFigureInDeploymentZone(game, pn, figureKey, mapId)) continue;
        const vp = game[`player${pn}VP`] || { total: 0, kills: 0, objectives: 0 };
        vp.total = (vp.total || 0) + 15;
        vp.objectives = (vp.objectives || 0) + 15;
        game[`player${pn}VP`] = vp;
        delete game.figureContraband[figureKey];
        scored++;
      }
      if (scored > 0) {
        const pid = pn === 1 ? game.player1Id : game.player2Id;
        await logGameAction(game, client, `<@${pid}> gained **${15 * scored} VP** for ${scored} figure(s) delivering contraband to deployment zone.`, { allowedMentions: { users: [pid] }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) {
          await interaction.message.edit({ components: [] }).catch(() => {});
          saveGames();
          return;
        }
      }
    }
  }
  if (game.selectedMission?.variant === 'a' && mapId) {
    const launchPanels = getMapTokensData()[mapId]?.missionA?.launchPanels || [];
    const state = game.launchPanelState || {};
    let p1Vp = 0, p2Vp = 0;
    for (const coord of launchPanels) {
      const c = String(coord).toLowerCase();
      const side = state[c];
      if (!side) continue;
      const controller = getSpaceController(game, mapId, coord);
      if (!controller) continue;
      const vp = side === 'colored' ? 5 : 2;
      if (controller === 1) p1Vp += vp;
      else p2Vp += vp;
    }
    if (p1Vp > 0 || p2Vp > 0) {
      if (p1Vp > 0) {
        game.player1VP = game.player1VP || { total: 0, kills: 0, objectives: 0 };
        game.player1VP.total += p1Vp;
        game.player1VP.objectives += p1Vp;
        await logGameAction(game, client, `<@${game.player1Id}> gained **${p1Vp} VP** for launch panels controlled.`, { allowedMentions: { users: [game.player1Id] }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) {
          await interaction.message.edit({ components: [] }).catch(() => {});
          saveGames();
          return;
        }
      }
      if (p2Vp > 0) {
        game.player2VP = game.player2VP || { total: 0, kills: 0, objectives: 0 };
        game.player2VP.total += p2Vp;
        game.player2VP.objectives += p2Vp;
        await logGameAction(game, client, `<@${game.player2Id}> gained **${p2Vp} VP** for launch panels controlled.`, { allowedMentions: { users: [game.player2Id] }, phase: 'ROUND', icon: 'round' });
        await checkWinConditions(game, client);
        if (game.ended) {
          await interaction.message.edit({ components: [] }).catch(() => {});
          saveGames();
          return;
        }
      }
    }
  }
  game.p1LaunchPanelFlippedThisRound = false;
  game.p2LaunchPanelFlippedThisRound = false;
  const prevInitiative = game.initiativePlayerId;
  game.initiativePlayerId = prevInitiative === game.player1Id ? game.player2Id : game.player1Id;
  game.currentRound = (game.currentRound || 1) + 1;
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
        await handMsg.edit({ content: payload.content, embeds: payload.embeds, files: payload.files || [], components: payload.components }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to update hand message:', err);
    }
  }
  const generalChannel = await client.channels.fetch(game.generalId);
  const drawDesc = p1Terminals > 0 || p2Terminals > 0
    ? `Draw 1 CC each (P1 +${p1Terminals} terminal${p1Terminals !== 1 ? 's' : ''}, P2 +${p2Terminals} terminal${p2Terminals !== 1 ? 's' : ''}).`
    : 'Draw 1 command card each.';
  const initZone = getInitiativePlayerZoneLabel(game);
  const initNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  await logGameAction(game, client, `**Status Phase** — 1. Ready cards ✓ 2. ${drawDesc} 3. End of round effects (scoring) ✓ 4. Initiative passes to ${initZone}P${initNum} <@${game.initiativePlayerId}>. Round **${game.currentRound}**.`, { phase: 'ROUND', icon: 'round' });
  await sendRoundActivationPhaseMessage(game, client);
  await interaction.message.edit({ components: [] }).catch(() => {});
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
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!game.startOfRoundWhoseTurn) {
    await interaction.reply({ content: 'Not in Start of Round window.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.startOfRoundWhoseTurn) {
    await interaction.reply({ content: "It's not your turn in the Start of Round window.", ephemeral: true }).catch(() => {});
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
  const p1Terminals = game.selectedMap?.id ? countTerminalsControlledByPlayer(game, 1, game.selectedMap.id) : 0;
  const p2Terminals = game.selectedMap?.id ? countTerminalsControlledByPlayer(game, 2, game.selectedMap.id) : 0;
  const drawRule = (p1Terminals > 0 || p2Terminals > 0)
    ? 'Draw 1 CC (+1 per controlled terminal). '
    : 'Draw 1 CC. ';
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const passHint = otherRem > initRem && initRem > 0 ? ' You may pass back (opponent has more activations).' : '';
  const content = showBtn
    ? `<@${game.initiativePlayerId}> (**Player ${initPlayerNum}**) **Round ${game.currentRound}** — Your turn! All deployment groups readied. ${drawRule}Both players: click **End R${game.currentRound} Activation Phase** when you've used all activations and any end-of-activation effects.${passHint}`
    : `<@${game.initiativePlayerId}> (**Player ${initPlayerNum}**) **Round ${game.currentRound}** — Your turn! All deployment groups readied. ${drawRule}Use all activations and actions. The **End R${game.currentRound} Activation Phase** button will appear when both players have done so.${passHint}`;
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
  await interaction.message.edit({ components: [] }).catch(() => {});
  saveGames();
}
