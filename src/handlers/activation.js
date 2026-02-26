/**
 * Activation handlers: status_phase_, pass_activation_turn_, end_turn_, confirm_activate_, cancel_activate_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getCcEffectsData, getDcEffects, getMapSpaces } from '../data-loader.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, hasActionsRemainingInGame, GAME_PHASES, PHASE_COLOR, getInitiativePlayerZoneLabel, logGameAction, updateHandChannelMessages, saveGames, client
 */
export async function handleStatusPhase(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    hasActionsRemainingInGame,
    GAME_PHASES,
    PHASE_COLOR,
    getInitiativePlayerZoneLabel,
    logGameAction,
    updateHandChannelMessages,
    saveGames,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('status_phase_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.followUp({ content: 'Only players in this game can end the activation phase.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const r1 = game.p1ActivationsRemaining ?? 0;
  const r2 = game.p2ActivationsRemaining ?? 0;
  const hasActions = hasActionsRemainingInGame(game, gameId);
  if (r1 > 0 || r2 > 0 || hasActions) {
    const parts = [];
    if (r1 > 0 || r2 > 0) parts.push(`P1: ${r1} activations left, P2: ${r2} activations left`);
    if (hasActions) parts.push('some DCs still have actions to spend');
    await interaction.followUp({
      content: `Both players must use all activations and actions first. (${parts.join('; ')})`,
      ephemeral: true,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const round = game.currentRound || 1;
  const clickerIsP1 = interaction.user.id === game.player1Id;
  game.p1ActivationPhaseEnded = game.p1ActivationPhaseEnded || false;
  game.p2ActivationPhaseEnded = game.p2ActivationPhaseEnded || false;
  // In test games, human (P1) clicks for both sides; first click = P1, second = P2
  if (game.isTestGame && clickerIsP1) {
    if (!game.p1ActivationPhaseEnded) game.p1ActivationPhaseEnded = true;
    else game.p2ActivationPhaseEnded = true;
  } else if (clickerIsP1) {
    game.p1ActivationPhaseEnded = true;
  } else {
    game.p2ActivationPhaseEnded = true;
  }
  const bothEnded = game.p1ActivationPhaseEnded && game.p2ActivationPhaseEnded;
  if (!bothEnded) {
    const waiting = !game.p1ActivationPhaseEnded ? 'P1' : 'P2';
    await interaction.followUp({
      content: `${clickerIsP1 ? 'P1' : 'P2'} has ended activation. Waiting for **${waiting}** to click **End R${round} Activation Phase**.`,
      ephemeral: true,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    const generalChannel = await client.channels.fetch(game.generalId);
    const roundEmbed = new EmbedBuilder()
      .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${round} - Activation Phase`)
      .setColor(PHASE_COLOR);
    const endBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${round} Activation Phase`)
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.message.edit({
      content: `**Round ${round}** — ${game.p1ActivationPhaseEnded ? '✓ P1' : 'P1'} ended activation. ${game.p2ActivationPhaseEnded ? '✓ P2' : 'P2'} ended activation. Both players must click the button when done with activations and any end-of-activation effects.`,
      embeds: [roundEmbed],
      components: [endBtn],
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    return;
  }
  game.p1ActivationPhaseEnded = false;
  game.p2ActivationPhaseEnded = false;
  game.endOfRoundWhoseTurn = game.initiativePlayerId;
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const otherPlayerId = game.initiativePlayerId === game.player1Id ? game.player2Id : game.player1Id;
  const initZone = getInitiativePlayerZoneLabel(game);
  await logGameAction(game, client, `**End of Round** — 1. Mission Rules/Effects (resolve as needed). 2. <@${game.initiativePlayerId}> (${initZone}Initiative). 3. <@${otherPlayerId}>. 4. Next phase. Initiative player: play any end-of-round effects or CCs, then click **End 'End of Round' window** in your Hand.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [game.initiativePlayerId, otherPlayerId] } });
  const generalChannel = await client.channels.fetch(game.generalId);
  const roundEmbed = new EmbedBuilder()
    .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${round} - Status Phase`)
    .setDescription(`1. Mission Rules/Effects 2. <@${game.initiativePlayerId}> (${getInitiativePlayerZoneLabel(game)}Initiative) 3. <@${otherPlayerId}> 4. Go. Both must click **End 'End of Round' window** in their Hand.`)
    .setColor(PHASE_COLOR);
  await generalChannel.send({
    content: `**End of Round window** — <@${game.initiativePlayerId}> (${getInitiativePlayerZoneLabel(game)}Player ${initPlayerNum}), play any end-of-round effects/CCs, then click the button in your Hand.`,
    embeds: [roundEmbed],
    allowedMentions: { users: [game.initiativePlayerId] },
  });
  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  await updateHandChannelMessages(game, client);
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, pushUndo, client, saveGames
 */
export async function handlePassActivationTurn(interaction, ctx) {
  const { getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, pushUndo, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('pass_activation_turn_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  const turnPlayerNum = turnPlayerId === game.player1Id ? 1 : 2;
  if (!canActAsPlayer(game, interaction.user.id, turnPlayerNum)) {
    await interaction.followUp({ content: "It's not your turn to pass.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const myRem = turnPlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const otherRem = turnPlayerId === game.player1Id ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
  if (otherRem <= myRem) {
    await interaction.followUp({ content: 'The other player does not have more activations than you.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const otherPlayerId = turnPlayerId === game.player1Id ? game.player2Id : game.player1Id;
  const otherPlayerNum = otherPlayerId === game.player1Id ? 1 : 2;
  const round = game.currentRound || 1;
  const turnNum = turnPlayerId === game.player1Id ? 1 : 2;
  const turnZone = getPlayerZoneLabel(game, turnPlayerId);
  const roundContentBefore = `<@${turnPlayerId}> (${turnZone}**Player ${turnNum}**) **Round ${round}** — Your turn to activate! You may pass back if the other player has more activations.`;
  game.currentActivationTurnPlayerId = otherPlayerId;
  const passLogMsg = await logGameAction(game, client, `<@${turnPlayerId}> passed the turn to <@${otherPlayerId}> (Player ${otherPlayerNum} has more activations remaining).`, { phase: 'ROUND', icon: 'activate', allowedMentions: { users: [otherPlayerId] } });
  pushUndo(game, {
    type: 'pass_turn',
    previousTurnPlayerId: turnPlayerId,
    gameLogMessageId: passLogMsg?.id,
    roundMessageId: game.roundActivationMessageId,
    roundContentBefore,
    gameId,
  });
  if (game.roundActivationMessageId && game.generalId) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(game.roundActivationMessageId);
      const initNum = otherPlayerId === game.player1Id ? 1 : 2;
      const newCurrentRem = otherPlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const justPassedRem = turnPlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const passRows = [];
      if (justPassedRem > newCurrentRem && newCurrentRem > 0) {
        passRows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pass_activation_turn_${gameId}`)
            .setLabel('Pass turn to opponent')
            .setStyle(ButtonStyle.Secondary)
        ));
      }
      const otherZone = getPlayerZoneLabel(game, otherPlayerId);
      await msg.edit({
        content: `<@${otherPlayerId}> (${otherZone}**Player ${initNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back if the other player has more activations.' : ''}`,
        components: passRows,
        allowedMentions: { users: [otherPlayerId] },
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch (err) {
      console.error('Failed to update round message for pass:', err);
    }
  }
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, dcMessageMeta, dcHealthState, buildDcEmbedAndFiles, getDcPlayAreaComponents, logGameAction, maybeShowEndActivationPhaseButton, client, saveGames
 */
export async function handleEndTurn(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    dcHealthState,
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getDcPlayAreaComponents,
    logGameAction,
    maybeShowEndActivationPhaseButton,
    client,
    saveGames,
  } = ctx;
  const match = interaction.customId.match(/^end_turn_([^_]+)_(.+)$/);
  if (!match) return;
  const gameId = match[1];
  const dcMsgId = match[2];
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const meta = dcMessageMeta.get(dcMsgId);
  if (!meta || meta.gameId !== gameId) {
    await interaction.followUp({ content: 'Invalid End Turn.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the player who finished that activation can end the turn.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const pending = game.pendingEndTurn?.[dcMsgId];
  if (!pending) {
    await interaction.followUp({ content: 'This turn was already ended.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const otherPlayerId = meta.playerNum === 1 ? game.player2Id : game.player1Id;
  const otherPlayerNum = meta.playerNum === 1 ? 2 : 1;
  game.dcFinishedPinged = game.dcFinishedPinged || {};
  game.dcFinishedPinged[dcMsgId] = true;
  game.lastActivationMsgIdByPlayer = game.lastActivationMsgIdByPlayer || {};
  game.lastActivationMsgIdByPlayer[meta.playerNum] = dcMsgId;
  delete game.pendingEndTurn[dcMsgId];
  if (pending.messageId) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const endTurnMsg = await ch.messages.fetch(pending.messageId);
      await endTurnMsg.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch {}
  }
  // Shield (Riot Trooper E/R): at end of activation, if no Block tokens, gain 1 Block token
  const _shieldEff = getDcEffects()?.[meta.dcName];
  if ((_shieldEff?.passives || []).includes('Shield')) {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const prefix = `${meta.dcName}-${dgIndex}-`;
    const figureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(k => k.startsWith(prefix));
    for (const fk of figureKeys) {
      const tokens = game.figurePowerTokens?.[fk] || [];
      if (!tokens.includes('Block')) {
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
        if (game.figurePowerTokens[fk].length < 2) {
          game.figurePowerTokens[fk].push('Block');
          const fkName = fk.replace(/-\d+-\d+$/, '');
          await logGameAction(game, client, `🛡️ **Shield** — **${fkName}** gained 1 **Block Token** at end of activation.`, { phase: 'ROUND', icon: 'activate' });
        }
      }
    }
  }

  // In The Shadows (ISB Infiltrator Elite): become Hidden at end of activation
  if (meta.dcName === 'ISB Infiltrator (Elite)') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const prefix = `${meta.dcName}-${dgIndex}-`;
    const figureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(k => k.startsWith(prefix));
    for (const fk of figureKeys) {
      game.figureConditions = game.figureConditions || {};
      game.figureConditions[fk] = game.figureConditions[fk] || [];
      if (!game.figureConditions[fk].includes('Hide')) game.figureConditions[fk].push('Hide');
    }
    if (figureKeys.length > 0) {
      await logGameAction(game, client, `🥷 **In The Shadows** — **ISB Infiltrator (Elite)** figures became **Hidden** at end of activation.`, { phase: 'ROUND', icon: 'activate' });
    }
  }
  // Unnerving (0-0-0): at end of activation, each adjacent hostile becomes Weakened
  if (meta.dcName === '0-0-0') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const prefix = `${meta.dcName}-${dgIndex}-`;
    const figureKeys000 = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(k => k.startsWith(prefix));
    const enemyNum = meta.playerNum === 1 ? 2 : 1;
    const ms = getMapSpaces(game.selectedMap?.id);
    const weakened = [];
    for (const fk of figureKeys000) {
      const pos = game.figurePositions?.[meta.playerNum]?.[fk];
      if (!pos) continue;
      const posNorm = String(pos).toLowerCase();
      const adj = (ms?.adjacency?.[posNorm] || []).map(a => String(a).toLowerCase());
      for (const [eFk, ePos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
        if (!ePos) continue;
        if (!adj.includes(String(ePos).toLowerCase())) continue;
        game.figureConditions = game.figureConditions || {};
        game.figureConditions[eFk] = game.figureConditions[eFk] || [];
        if (!game.figureConditions[eFk].includes('Weaken')) {
          game.figureConditions[eFk].push('Weaken');
          weakened.push(eFk.replace(/-\d+-\d+$/, ''));
        }
      }
    }
    if (weakened.length > 0) {
      await logGameAction(game, client, `😈 **Unnerving** — **0-0-0** Weakened adjacent hostiles: ${weakened.join(', ')}.`, { phase: 'ROUND', icon: 'activate' });
    }
  }
  // Hold the Line (Baze Malbus): at end of activation, gain 1 Block Token per hostile with LOS
  if (meta.dcName === 'Baze Malbus') {
    const _htlHasLos = ctx.hasLineOfSight;
    const _htlMapSpaces = ctx.getMapSpaces?.(game.selectedMap?.id);
    const _htlDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _htlFk = `Baze Malbus-${_htlDgIndex}-0`;
    const _htlPos = game.figurePositions?.[meta.playerNum]?.[_htlFk];
    let _htlBlockCount = 0;
    if (_htlPos && _htlHasLos && _htlMapSpaces) {
      const _htlEnemyNum = meta.playerNum === 1 ? 2 : 1;
      const _htlAllFigCoords = [];
      for (const [, fp] of Object.entries(game.figurePositions?.[1] || {})) if (fp) _htlAllFigCoords.push(String(fp).toLowerCase());
      for (const [, fp] of Object.entries(game.figurePositions?.[2] || {})) if (fp) _htlAllFigCoords.push(String(fp).toLowerCase());
      for (const [, ePos] of Object.entries(game.figurePositions?.[_htlEnemyNum] || {})) {
        if (!ePos) continue;
        if (_htlHasLos(String(_htlPos).toLowerCase(), String(ePos).toLowerCase(), _htlMapSpaces, _htlAllFigCoords)) _htlBlockCount++;
      }
    }
    if (_htlBlockCount > 0) {
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[_htlFk] = game.figurePowerTokens[_htlFk] || [];
      for (let i = 0; i < _htlBlockCount; i++) game.figurePowerTokens[_htlFk].push('Block');
    }
    await logGameAction(game, client, `🛡️ **Hold the Line** — **${meta.displayName || 'Baze Malbus'}** gained **${_htlBlockCount} Block Token${_htlBlockCount !== 1 ? 's' : ''}** (${_htlBlockCount} hostile${_htlBlockCount !== 1 ? 's' : ''} with LOS).`, { phase: 'ROUND', icon: 'activate' });
  }

  const actionsData = game.dcActionsData?.[dcMsgId];
  if (actionsData?.threadId) {
    try {
      const thread = await client.channels.fetch(actionsData.threadId);
      await thread.delete();
    } catch (err) {
      console.error('Failed to delete DC activation thread:', err);
    }
    if (game.dcActionsData?.[dcMsgId]) delete game.dcActionsData[dcMsgId];
    if (game.nextAttacksBonusHits?.[meta.playerNum]) delete game.nextAttacksBonusHits[meta.playerNum];
    if (game.nextAttacksBonusConditions?.[meta.playerNum]) delete game.nextAttacksBonusConditions[meta.playerNum];
    if (game.nextAttackBonusSurgeAbilities?.[meta.playerNum]) delete game.nextAttackBonusSurgeAbilities[meta.playerNum];
    if (game.nextAttackBonusPierce?.[meta.playerNum]) delete game.nextAttackBonusPierce[meta.playerNum];
    if (game.movementBank?.[dcMsgId]) delete game.movementBank[dcMsgId];
  }
  try {
    const playAreaId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
    const playChannel = await client.channels.fetch(playAreaId);
    const dcMsg = await playChannel.messages.fetch(dcMsgId);
    const healthState = dcHealthState.get(dcMsgId) ?? [[null, null]];
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, meta.displayName, healthState, getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[dcMsgId] || game?.p2DcAttachments?.[dcMsgId] || []));
    const components = getDcPlayAreaComponents(dcMsgId, true, game, meta.dcName);
    await dcMsg.edit({
      embeds: [embed],
      files,
      components,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch (err) {
    console.error('Failed to update DC card after End Turn:', err);
  }
  // Son of Skywalker: auto-ready Luke's DC after any activation ends
  if (game.sonOfSkywalkerActive) {
    const sos = game.sonOfSkywalkerActive;
    const sosDcMsgId = sos.dcMsgId;
    const sosPlayerNum = sos.playerNum;
    // Don't re-ready if this IS Luke's activation ending (he just activated, should stay exhausted)
    if (sosDcMsgId !== dcMsgId) {
      const sosActivatedKey = sosPlayerNum === 1 ? 'p1ActivatedDcIndices' : 'p2ActivatedDcIndices';
      const sosDcIds = sosPlayerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
      const sosIdx = sosDcIds.indexOf(sosDcMsgId);
      if (sosIdx >= 0 && Array.isArray(game[sosActivatedKey]) && game[sosActivatedKey].includes(sosIdx)) {
        game[sosActivatedKey] = game[sosActivatedKey].filter((i) => i !== sosIdx);
        const sosMeta = dcMessageMeta.get(sosDcMsgId);
        const sosName = sosMeta?.displayName || sosMeta?.dcName || 'Luke Skywalker';
        await logGameAction(game, client, `⚡ **Son of Skywalker** — **${sosName}** is automatically **Readied**.`, { phase: 'ROUND', icon: 'activate' });
      }
    }
  }

  game.currentActivationTurnPlayerId = otherPlayerId;
  await logGameAction(game, client, `<@${otherPlayerId}> (**Player ${otherPlayerNum}'s turn**) **${pending.displayName}** finished all actions — your turn to activate a figure!`, {
    allowedMentions: { users: [otherPlayerId] },
    phase: 'ROUND',
    icon: 'activate',
  });
  if (game.roundActivationMessageId && game.generalId && !game.roundActivationButtonShown) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(game.roundActivationMessageId);
      const round = game.currentRound || 1;
      const newCurrentRem = otherPlayerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const justActedRem = meta.playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const passRows = [];
      if (justActedRem > newCurrentRem && newCurrentRem > 0) {
        passRows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pass_activation_turn_${gameId}`)
            .setLabel('Pass turn to opponent')
            .setStyle(ButtonStyle.Secondary)
        ));
      }
      await msg.edit({
        content: `<@${otherPlayerId}> (**Player ${otherPlayerNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back (opponent has more activations).' : ''}`,
        components: passRows,
        allowedMentions: { users: [otherPlayerId] },
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch (err) {
      console.error('Failed to update round message after end turn:', err);
    }
  }
  await maybeShowEndActivationPhaseButton(game, client);
  saveGames();
}

/**
 * Handle dc_end_activation_ — red "End Activation" button on the DC card.
 * Immediately ends the current activation: deletes thread, cleans up state, pings opponent.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcEndActivation(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    dcHealthState,
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getDcPlayAreaComponents,
    logGameAction,
    maybeShowEndActivationPhaseButton,
    client,
    saveGames,
  } = ctx;
  const msgId = interaction.customId.replace('dc_end_activation_', '');
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner can end this activation.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const otherPlayerId = meta.playerNum === 1 ? game.player2Id : game.player1Id;
  const otherPlayerNum = meta.playerNum === 1 ? 2 : 1;
  const displayName = meta.displayName || meta.dcName;
  const gameId = game.gameId;

  // Clean up activation state
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData?.threadId) {
    try {
      const thread = await client.channels.fetch(actionsData.threadId);
      await thread.delete();
    } catch (err) {
      console.error('Failed to delete DC activation thread on End Activation:', err);
    }
  }
  if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
  if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
  if (game.nextAttacksBonusHits?.[meta.playerNum]) delete game.nextAttacksBonusHits[meta.playerNum];
  if (game.nextAttacksBonusConditions?.[meta.playerNum]) delete game.nextAttacksBonusConditions[meta.playerNum];
  if (game.nextAttackBonusSurgeAbilities?.[meta.playerNum]) delete game.nextAttackBonusSurgeAbilities[meta.playerNum];
  if (game.nextAttackBonusPierce?.[meta.playerNum]) delete game.nextAttackBonusPierce[meta.playerNum];
  if (game.dcFinishedPinged?.[msgId]) delete game.dcFinishedPinged[msgId];
  if (game.pendingEndTurn?.[msgId]) delete game.pendingEndTurn[msgId];
  // Stun: discarded at end of activation
  if (game.figureConditions && ctx.getDcStats) {
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figures = ctx.getDcStats(meta.dcName).figures ?? 1;
    for (let f = 0; f < figures; f++) {
      const fk = `${meta.dcName}-${dgIndex}-${f}`;
      if (game.figureConditions[fk]) game.figureConditions[fk] = game.figureConditions[fk].filter((c) => c !== 'Stun');
    }
  }

  game.lastActivationMsgIdByPlayer = game.lastActivationMsgIdByPlayer || {};
  game.lastActivationMsgIdByPlayer[meta.playerNum] = msgId;
  game.currentActivationTurnPlayerId = otherPlayerId;

  // Update DC card (stays exhausted)
  try {
    const playAreaId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
    const playChannel = await client.channels.fetch(playAreaId);
    const dcMsg = await playChannel.messages.fetch(msgId);
    const healthState = dcHealthState.get(msgId) ?? [[null, null]];
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, displayName, healthState, getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []));
    await dcMsg.edit({ embeds: [embed], files, components: getDcPlayAreaComponents(msgId, true, game, meta.dcName) }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch (err) {
    console.error('Failed to update DC card after End Activation:', err);
  }

  // Ping opponent
  await logGameAction(game, client, `<@${otherPlayerId}> (**Player ${otherPlayerNum}'s turn**) **${displayName}** ended activation — your turn to activate a figure!`, {
    allowedMentions: { users: [otherPlayerId] },
    phase: 'ROUND',
    icon: 'activate',
  });

  // Update round activation message
  if (game.roundActivationMessageId && game.generalId && !game.roundActivationButtonShown) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(game.roundActivationMessageId);
      const round = game.currentRound || 1;
      const newCurrentRem = otherPlayerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const justActedRem = meta.playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const passRows = [];
      if (justActedRem > newCurrentRem && newCurrentRem > 0) {
        passRows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pass_activation_turn_${gameId}`)
            .setLabel('Pass turn to opponent')
            .setStyle(ButtonStyle.Secondary)
        ));
      }
      await msg.edit({
        content: `<@${otherPlayerId}> (**Player ${otherPlayerNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back (opponent has more activations).' : ''}`,
        components: passRows,
        allowedMentions: { users: [otherPlayerId] },
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch (err) {
      console.error('Failed to update round message after End Activation:', err);
    }
  }
  await maybeShowEndActivationPhaseButton(game, client);

  // Squad Swarm: after ending activation, offer to activate another DC with the same name (combined cost ≤ 15)
  if (game.squadSwarmPlayerNum === meta.playerNum) {
    const _sqDcList = meta.playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const _sqDcIds = meta.playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const sameNameIds = _sqDcIds.filter((id, i) => {
      if (!id || id === msgId) return false;
      const dc = _sqDcList[i];
      if (!dc || dc.defeated || dc.dcName !== meta.dcName) return false;
      return !ctx.dcExhaustedState?.get(id);
    });
    const activatedCost = ctx.getDcStats?.(meta.dcName)?.cost ?? 0;
    const eligibleIds = sameNameIds.filter(() => (activatedCost + (ctx.getDcStats?.(meta.dcName)?.cost ?? 0)) <= 15);
    if (eligibleIds.length > 0) {
      const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
      const btns = eligibleIds.slice(0, 4).map((id) =>
        new ButtonBuilder()
          .setCustomId(`squad_swarm_yes_${gameId}_${msgId}_${id}`)
          .setLabel(`Activate ${ctx.dcMessageMeta?.get(id)?.displayName || meta.dcName}`.slice(0, 80))
          .setStyle(ButtonStyle.Success)
      );
      btns.push(new ButtonBuilder().setCustomId(`squad_swarm_no_${gameId}_${msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      await logGameAction(game, client, `<@${ownerId}> **Squad Swarm** — activate another **${meta.dcName}**?`, {
        components: [new ActionRowBuilder().addComponents(...btns)],
        allowedMentions: { users: [ownerId] },
      });
    }
  }

  // Auto-prompt owner for post-activation reaction cards (Change of Plans, Provoke, etc.)
  try {
    const ccCards = getCcEffectsData?.()?.cards || {};
    const _endActTimings = new Set(['afterYouResolveGroupsActivation', 'afterActivationResolves', 'endOfActivation']);
    const hand = meta.playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
    const reactCards = [...new Set(hand)].filter(c => ccCards[c]?.timing && _endActTimings.has(ccCards[c].timing));
    if (reactCards.length) {
      const cardList = reactCards.map(c => `**${c}** (cost ${ccCards[c].cost ?? 0})`).join(', ');
      await logGameAction(game, client, `<@${ownerId}> — Activation ended! Reaction card(s) in hand: ${cardList}. Play from Hand if desired.`, {
        allowedMentions: { users: [ownerId] },
        phase: 'ROUND',
        icon: 'card',
      });
    }
  } catch (_endActErr) {
    console.error('End-activation reaction prompt error:', _endActErr?.message ?? _endActErr);
  }

  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, dcExhaustedState, dcHealthState, buildDcEmbedAndFiles, getDcPlayAreaComponents, updateActivationsMessage, getActionsCounterContent, getDcActionButtons, getActivationMinimapAttachment, getActivateDcButtons, DC_ACTIONS_PER_ACTIVATION, ThreadAutoArchiveDuration, ACTION_ICONS, client, saveGames
 */
export async function handleConfirmActivate(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getDcPlayAreaComponents,
    updateActivationsMessage,
    getActionsCounterContent,
    getDcActionButtons,
    getActivationMinimapAttachment,
    getActivateDcButtons,
    DC_ACTIONS_PER_ACTIVATION,
    ThreadAutoArchiveDuration,
    ACTION_ICONS,
    client,
    saveGames,
  } = ctx;
  const match = interaction.customId.match(/^confirm_activate_([^_]+)_(.+)_(\d+)$/);
  if (!match) return;
  const [, gameId, msgId, activateCardMsgIdStr] = match;
  const activateCardMsgId = activateCardMsgIdStr === '0' ? null : activateCardMsgIdStr;
  const game = getGame(gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta || meta.gameId !== gameId) return;
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) return;
  const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
  if (remaining <= 0) {
    await interaction.followUp({ content: 'No activations remaining.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  dcExhaustedState.set(msgId, true);
  if (meta.playerNum === 1) {
    game.p1ActivationsRemaining--;
    const dcIndex = (game.p1DcMessageIds || []).indexOf(msgId);
    if (dcIndex !== -1) { game.p1ActivatedDcIndices = game.p1ActivatedDcIndices || []; game.p1ActivatedDcIndices.push(dcIndex); }
  } else {
    game.p2ActivationsRemaining--;
    const dcIndex = (game.p2DcMessageIds || []).indexOf(msgId);
    if (dcIndex !== -1) { game.p2ActivatedDcIndices = game.p2ActivatedDcIndices || []; game.p2ActivatedDcIndices.push(dcIndex); }
  }
  await updateActivationsMessage(game, meta.playerNum, client);
  const displayName = meta.displayName || meta.dcName;
  const playAreaId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
  const playChannel = await client.channels.fetch(playAreaId);
  const dcMsg = await playChannel.messages.fetch(msgId);
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, displayName, dcHealthState.get(msgId) ?? [[null, null]], getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []));
  await dcMsg.edit({ embeds: [embed], files, components: getDcPlayAreaComponents(msgId, true, game, meta.dcName) });
  const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
  const thread = await dcMsg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
  game.movementBank = game.movementBank || {};
  game.movementBank[msgId] = { total: 0, remaining: 0, threadId: thread.id, messageId: null, displayName };
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id, specialsUsed: [] };
  const pingContent = `<@${ownerId}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
  const actMinimap = await getActivationMinimapAttachment(game, msgId);
  const actionsPayload = {
    content: pingContent,
    components: getDcActionButtons(msgId, meta.dcName, displayName, game.dcActionsData[msgId], game),
    allowedMentions: { users: [ownerId] },
  };
  if (actMinimap) actionsPayload.files = [actMinimap];
  const actionsMsg = await thread.send(actionsPayload);
  game.dcActionsData[msgId].messageId = actionsMsg.id;
  // Mounted (Captain Terro, Kuiil): gain 3 MP at start of activation
  const _mountedEff = getDcEffects()?.[meta.dcName];
  const _mountedIds = _mountedEff?.specialAbilityIds || [];
  if (_mountedIds.includes('mounted_terro') || _mountedIds.includes('mounted_kuiil') || _mountedIds.includes('mounted_dewback')) {
    game.movementBank = game.movementBank || {};
    game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
    game.movementBank[msgId].total += 3;
    game.movementBank[msgId].remaining += 3;
    await thread.send({ content: `🐎 **Mounted** — **${displayName}** gains **3 movement points** at the start of activation.` }).catch(() => {});
  }
  // Vigor (Ahsoka Tano, Fifth Brother): choose 2 MP or 1 Block Token
  if (meta.dcName === 'Ahsoka Tano' || meta.dcName === 'Fifth Brother') {
    const vigorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_vigor_mp`).setLabel('Gain 2 MP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_vigor_block`).setLabel('Gain 1 Block Token').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({ content: `✨ **Vigor** — **${displayName}**: Choose one:`, components: [vigorRow] }).catch(() => {});
  }
  // Madness (Taron Malicos): if ≤2 CC cards in hand, suffer 1 Strain and become Focused
  if (meta.dcName === 'Taron Malicos') {
    const hand = meta.playerNum === 1 ? (game.p1Hand || []) : (game.p2Hand || []);
    if (hand.length <= 2) {
      const figureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(fk => fk.startsWith('Taron Malicos-'));
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      for (const fk of figureKeys) {
        game.figureConditions = game.figureConditions || {};
        game.figureConditions[fk] = game.figureConditions[fk] || [];
        if (!game.figureConditions[fk].includes('Focus')) game.figureConditions[fk].push('Focus');
        // Apply 1 Strain (= 1 HP damage)
        const fkMsgId = msgId;
        const fkIdx = parseInt(fk.split('-').pop(), 10) || 0;
        const hs = dcHealthState.get(fkMsgId);
        if (hs?.[fkIdx]) {
          hs[fkIdx].current = Math.max(0, hs[fkIdx].current - 1);
        }
      }
      await thread.send({ content: `😤 **Madness** — **${displayName}** has ${hand.length} CC card${hand.length !== 1 ? 's' : ''} in hand (≤2). Suffered **1 Strain** and became **Focused**.` }).catch(() => {});
    }
  }
  // Responsive (Shyla Varad): choose 1 MP or recover 1 Damage
  if (meta.dcName === 'Shyla Varad') {
    const respRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_responsive_mp`).setLabel('Gain 1 MP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_responsive_heal`).setLabel('Recover 1 Damage').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({ content: `🏃 **Responsive** — **${displayName}**: Choose one:`, components: [respRow] }).catch(() => {});
  }
  // Fulcrum (Agent Kallus): at start of activation, each player draws 1 CC
  if (meta.dcName === 'Agent Kallus') {
    const _fParts = [];
    for (const pn of [1, 2]) {
      const deckKey = pn === 1 ? 'player1CcDeck' : 'player2CcDeck';
      const handKey = pn === 1 ? 'player1CcHand' : 'player2CcHand';
      const deck = game[deckKey] || [];
      if (deck.length > 0) {
        const card = deck.shift();
        game[handKey] = [...(game[handKey] || []), card];
        _fParts.push(`P${pn} drew 1 CC`);
      } else {
        _fParts.push(`P${pn} deck empty`);
      }
    }
    await thread.send({ content: `🕵️ **Fulcrum** — Each player draws 1 Command card. (${_fParts.join(', ')})` }).catch(() => {});
  }
  // Hunger (Wampa Regular/Elite): position-aware hostile proximity check
  {
    const _getRange = ctx.getRange;
    const _hungerCheck = (dcName, range, mpGain, elite) => {
      if (meta.dcName !== dcName) return false;
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const figureKey = `${dcName}-${dgIndex}-0`;
      const pos = game.figurePositions?.[meta.playerNum]?.[figureKey];
      if (!pos || !_getRange) return false;
      const enemyNum = meta.playerNum === 1 ? 2 : 1;
      const hostilePos = Object.values(game.figurePositions?.[enemyNum] || {});
      const anyHostileInRange = hostilePos.some(hp => hp && _getRange(pos, hp) <= range);
      return !anyHostileInRange;
    };
    if (meta.dcName === 'Wampa' && _hungerCheck('Wampa', 3, 2, false)) {
      game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
      game.movementBank[msgId].total += 2;
      game.movementBank[msgId].remaining += 2;
      await thread.send({ content: `🐻 **Hunger** — **${displayName}** gains **2 MP** (no hostile within 3 spaces).` }).catch(() => {});
    } else if (meta.dcName === 'Wampa' && !_hungerCheck('Wampa', 3, 2, false)) {
      await thread.send({ content: `🐻 **Hunger** — Hostile figure within 3 spaces; **${displayName}** does not gain MP.` }).catch(() => {});
    }
    if (meta.dcName === 'Wampa (Elite)') {
      if (_hungerCheck('Wampa (Elite)', 2, 3, true)) {
        game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
        game.movementBank[msgId].total += 3;
        game.movementBank[msgId].remaining += 3;
        // Also gain 1 Block or Evade Token — choice buttons
        const hungerRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_hunger_block`).setLabel('Block Token').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_hunger_evade`).setLabel('Evade Token').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `🐻 **Hunger** — **${displayName}** gains **3 MP** (no hostile within 2 spaces). Choose a token:`, components: [hungerRow] }).catch(() => {});
      } else {
        await thread.send({ content: `🐻 **Hunger** — Hostile figure within 2 spaces; **${displayName}** does not gain MP or tokens.` }).catch(() => {});
      }
    }
  }
  // Tactical Movement (Fenn Signis): choose a friendly figure within 3 → gains 2 MP
  if (meta.dcName === 'Fenn Signis') {
    const _getRange = ctx.getRange;
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const selfFk = `${meta.dcName}-${dgIndex}-0`;
    const selfPos = game.figurePositions?.[meta.playerNum]?.[selfFk];
    if (selfPos && _getRange) {
      const friendlyFigs = Object.entries(game.figurePositions?.[meta.playerNum] || {})
        .filter(([fk, fp]) => fk !== selfFk && fp && _getRange(selfPos, fp) <= 3);
      if (friendlyFigs.length > 0) {
        const btns = friendlyFigs.slice(0, 4).map(([fk]) => {
          const label = fk.replace(/-\d+-\d+$/, '');
          return new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_tacmove_${fk}`).setLabel(label).setStyle(ButtonStyle.Primary);
        });
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_tacmove_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const tmRow = new ActionRowBuilder().addComponents(btns);
        await thread.send({ content: `🎯 **Tactical Movement** — Choose a friendly figure within 3 spaces to gain **2 MP**:`, components: [tmRow] }).catch(() => {});
      } else {
        await thread.send({ content: `🎯 **Tactical Movement** — No friendly figures within 3 spaces.` }).catch(() => {});
      }
    }
  }
  // Into the Fray (Baze Malbus): gain 1 Surge Token per hostile with LOS, then gain 1 MP
  if (meta.dcName === 'Baze Malbus') {
    game.movementBank = game.movementBank || {};
    game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
    game.movementBank[msgId].total += 1;
    game.movementBank[msgId].remaining += 1;
    // Count hostiles with LOS
    const _hasLos = ctx.hasLineOfSight;
    const _mapSpaces = ctx.getMapSpaces?.(game.selectedMap?.id);
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const selfFk = `Baze Malbus-${dgIndex}-0`;
    const selfPos = game.figurePositions?.[meta.playerNum]?.[selfFk];
    let surgeCount = 0;
    if (selfPos && _hasLos && _mapSpaces) {
      const enemyNum = meta.playerNum === 1 ? 2 : 1;
      const allFigCoords = [];
      for (const [, fp] of Object.entries(game.figurePositions?.[1] || {})) if (fp) allFigCoords.push(String(fp).toLowerCase());
      for (const [, fp] of Object.entries(game.figurePositions?.[2] || {})) if (fp) allFigCoords.push(String(fp).toLowerCase());
      for (const [, ePos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
        if (!ePos) continue;
        if (_hasLos(String(selfPos).toLowerCase(), String(ePos).toLowerCase(), _mapSpaces, allFigCoords)) surgeCount++;
      }
    }
    if (surgeCount > 0) {
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[selfFk] = game.figurePowerTokens[selfFk] || [];
      for (let i = 0; i < surgeCount; i++) game.figurePowerTokens[selfFk].push('Surge');
    }
    await thread.send({ content: `🔥 **Into the Fray** — **${displayName}** gains **1 MP** and **${surgeCount} Surge Token${surgeCount !== 1 ? 's' : ''}** (${surgeCount} hostile${surgeCount !== 1 ? 's' : ''} with LOS).` }).catch(() => {});
  }
  // Advanced Weapons Research (Director Krennic): friendly within 2 gains 1 Hit or Surge Token
  if (meta.dcName === 'Director Krennic') {
    const _getRange = ctx.getRange;
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const selfFk = `Director Krennic-${dgIndex}-0`;
    const selfPos = game.figurePositions?.[meta.playerNum]?.[selfFk];
    if (selfPos && _getRange) {
      const friendlyFigs = Object.entries(game.figurePositions?.[meta.playerNum] || {})
        .filter(([fk, fp]) => fk !== selfFk && fp && _getRange(selfPos, fp) <= 2);
      if (friendlyFigs.length > 0) {
        const btns = friendlyFigs.slice(0, 3).map(([fk]) => {
          const label = fk.replace(/-\d+-\d+$/, '');
          return new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_awr_${fk}`).setLabel(label).setStyle(ButtonStyle.Primary);
        });
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_awr_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const awrRow = new ActionRowBuilder().addComponents(btns);
        game.pendingAwr = { gameId: game.gameId, msgId, playerNum: meta.playerNum };
        await thread.send({ content: `🔬 **Advanced Weapons Research** — Choose a friendly figure within 2 spaces to grant a **Hit Token** or **Surge Token**:`, components: [awrRow] }).catch(() => {});
      } else {
        await thread.send({ content: `🔬 **Advanced Weapons Research** — No friendly figures within 2 spaces.` }).catch(() => {});
      }
    }
  }
  const logCh = await client.channels.fetch(game.generalId);
  const icon = ACTION_ICONS.activate || '⚡';
  const pLabel = `P${meta.playerNum}`;
  const logMsg = await logCh.send({
    content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${ownerId}> activated **${displayName}**!`,
    allowedMentions: { users: [ownerId] },
  });
  game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
  game.dcActivationLogMessageIds[msgId] = logMsg.id;
  if (activateCardMsgId) {
    try {
      const activateCardMsg = await logCh.messages.fetch(activateCardMsgId);
      const activateRows = getActivateDcButtons(game, meta.playerNum);
      await activateCardMsg.edit({ content: '**Activate a Deployment Card**', components: activateRows.length > 0 ? activateRows : [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch {}
  }
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - (none required; just deferUpdate and edit)
 */
export async function handleCancelActivate(interaction, _ctx) {
  const match = interaction.customId.match(/^cancel_activate_([^_]+)_(.+)$/);
  if (!match) return;
  const [, gameId, ownerId] = match;
  if (interaction.user.id !== ownerId) return;
  await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/**
 * Handle activation-passive choice buttons (act_passive_).
 * Covers: Vigor, Responsive, Hunger (Elite token choice), Tactical Movement, Advanced Weapons Research.
 */
export async function handleActPassive(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const { getGame, dcMessageMeta, dcHealthState, saveGames, logGameAction, client, buildDcEmbedAndFiles, getDcPlayAreaComponents } = ctx;
  // Parse: act_passive_{gameId}_{msgId}_{ability}_{choice}
  const parts = interaction.customId.replace(/^act_passive_/, '').split('_');
  if (parts.length < 3) return;
  const gameId = parts[0];
  const msgId = parts[1];
  const ability = parts[2];
  const choice = parts.slice(3).join('_');
  const game = getGame(gameId);
  if (!game) return;
  const meta = dcMessageMeta?.get(msgId);
  if (!meta) return;
  const displayName = meta.displayName || meta.dcName;
  // Remove buttons from message
  await interaction.message.edit({ components: [] }).catch(() => {});

  if (ability === 'vigor') {
    if (choice === 'mp') {
      game.movementBank = game.movementBank || {};
      game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
      game.movementBank[msgId].total += 2;
      game.movementBank[msgId].remaining += 2;
      await interaction.message.edit({ content: `✨ **Vigor** — **${displayName}** gained **2 MP**.`, components: [] }).catch(() => {});
    } else if (choice === 'block') {
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const fk = `${meta.dcName}-${dgIndex}-0`;
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
      game.figurePowerTokens[fk].push('Block');
      await interaction.message.edit({ content: `✨ **Vigor** — **${displayName}** gained **1 Block Token**.`, components: [] }).catch(() => {});
    }
  } else if (ability === 'responsive') {
    if (choice === 'mp') {
      game.movementBank = game.movementBank || {};
      game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
      game.movementBank[msgId].total += 1;
      game.movementBank[msgId].remaining += 1;
      await interaction.message.edit({ content: `🏃 **Responsive** — **${displayName}** gained **1 MP**.`, components: [] }).catch(() => {});
    } else if (choice === 'heal') {
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const fk = `${meta.dcName}-${dgIndex}-0`;
      const fkIdx = 0;
      const hs = dcHealthState.get(msgId);
      if (hs?.[fkIdx]) {
        const max = hs[fkIdx].max ?? hs[fkIdx].current;
        hs[fkIdx].current = Math.min(max, hs[fkIdx].current + 1);
      }
      await interaction.message.edit({ content: `🏃 **Responsive** — **${displayName}** recovered **1 Damage**.`, components: [] }).catch(() => {});
    }
  } else if (ability === 'hunger') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const fk = `${meta.dcName}-${dgIndex}-0`;
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
    if (choice === 'block') {
      game.figurePowerTokens[fk].push('Block');
      await interaction.message.edit({ content: `🐻 **Hunger** — **${displayName}** gained 3 MP and **1 Block Token**.`, components: [] }).catch(() => {});
    } else if (choice === 'evade') {
      game.figurePowerTokens[fk].push('Evade');
      await interaction.message.edit({ content: `🐻 **Hunger** — **${displayName}** gained 3 MP and **1 Evade Token**.`, components: [] }).catch(() => {});
    }
  } else if (ability === 'tacmove') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🎯 **Tactical Movement** — Skipped.`, components: [] }).catch(() => {});
    } else {
      // choice is the figureKey of the target
      const targetFk = choice;
      const targetDcName = targetFk.replace(/-\d+-\d+$/, '');
      // Find the target's msgId to add MP to their movement bank
      let targetMsgId = null;
      for (const [mId, mMeta] of dcMessageMeta) {
        if (mMeta.gameId !== gameId) continue;
        if (mMeta.dcName === targetDcName && mMeta.playerNum === meta.playerNum) {
          targetMsgId = mId;
          break;
        }
      }
      if (targetMsgId) {
        game.movementBank = game.movementBank || {};
        game.movementBank[targetMsgId] = game.movementBank[targetMsgId] || { total: 0, remaining: 0 };
        game.movementBank[targetMsgId].total += 2;
        game.movementBank[targetMsgId].remaining += 2;
      }
      await interaction.message.edit({ content: `🎯 **Tactical Movement** — **${targetDcName}** gained **2 MP**.`, components: [] }).catch(() => {});
    }
  } else if (ability === 'awr') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🔬 **Advanced Weapons Research** — Skipped.`, components: [] }).catch(() => {});
      delete game.pendingAwr;
    } else {
      // choice is the figureKey of the target — now offer Hit or Surge token choice
      game.pendingAwr = game.pendingAwr || {};
      game.pendingAwr.targetFk = choice;
      const targetDcName = choice.replace(/-\d+-\d+$/, '');
      const tokenRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_awrtoken_hit`).setLabel('Hit Token').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_awrtoken_surge`).setLabel('Surge Token').setStyle(ButtonStyle.Primary),
      );
      await interaction.message.edit({ content: `🔬 **Advanced Weapons Research** — **${targetDcName}**: Choose token type:`, components: [tokenRow] }).catch(() => {});
    }
  } else if (ability === 'awrtoken') {
    const targetFk = game.pendingAwr?.targetFk;
    if (!targetFk) return;
    const targetDcName = targetFk.replace(/-\d+-\d+$/, '');
    const tokenType = choice === 'hit' ? 'Hit' : 'Surge';
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[targetFk] = game.figurePowerTokens[targetFk] || [];
    game.figurePowerTokens[targetFk].push(tokenType);
    delete game.pendingAwr;
    await interaction.message.edit({ content: `🔬 **Advanced Weapons Research** — **${targetDcName}** gained **1 ${tokenType} Token**.`, components: [] }).catch(() => {});
  } else if (ability === 'openminded') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const fk = `${meta.dcName}-${dgIndex}-0`;
    if (choice === 'mp') {
      game.movementBank = game.movementBank || {};
      game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
      game.movementBank[msgId].total += 1;
      game.movementBank[msgId].remaining += 1;
      await interaction.message.edit({ content: `🧠 **Open-Minded** — **${displayName}** gained **1 MP**.`, components: [] }).catch(() => {});
    } else if (choice === 'token') {
      // Grant 1 Power Token — player chooses type via power_token_choice_ flow
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
      game.pendingPowerTokenGrant = { grants: [{ figureKey: fk, figName: meta.dcName, count: 1 }], channelId: interaction.channelId, playerNum: meta.playerNum };
      const { ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = await import('discord.js');
      const tokenBtns = ['Hit', 'Surge', 'Block', 'Evade'].map(t =>
        new BB().setCustomId(`power_token_choice_${gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(BS.Secondary)
      );
      await interaction.message.edit({ content: `🧠 **Open-Minded** — **${displayName}**: Choose Power Token type:`, components: [new AR().addComponents(tokenBtns)] }).catch(() => {});
      saveGames();
      return; // Don't save twice
    }
  }
  saveGames();
}
