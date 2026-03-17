/**
 * Phase gate handlers: phase_gate_ready_, phase_gate_unready_
 * Sends confirmation messages to both hand channels before advancing phases.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  createPhaseGate, recordPhaseGateReady, recordPhaseGateUnready,
  clearPhaseGate, PHASE_GATE_LABELS, playerNumFromId,
} from '../game/phase-gate.js';
import {
  getPlayerId, getHandChannelId, getInitiativePlayerNum,
} from '../game/player-helpers.js';
import { setPhase, setRoundPhase, PHASES, ROUND_PHASES } from '../game/phase.js';
import { discordCatch } from '../error-handling.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';

// ── Message builders ────────────────────────────────────────────────────────

/**
 * @param {object} gate
 * @param {object} game
 * @param {number} [viewerPn] - If provided, only ping this player; show opponent as "Opponent".
 *                               Omit for game log (pings both).
 */
function buildStatusLine(gate, game, viewerPn) {
  const p1Id = getPlayerId(game, 1);
  const p2Id = getPlayerId(game, 2);
  const p1Label = (!viewerPn || viewerPn === 1) ? (p1Id ? `<@${p1Id}>` : 'P1') : 'Opponent';
  const p2Label = (!viewerPn || viewerPn === 2) ? (p2Id ? `<@${p2Id}>` : 'P2') : 'Opponent';
  const p1 = gate.p1Ready ? `${p1Label} ✅` : `${p1Label} ⏳`;
  const p2 = gate.p2Ready ? `${p2Label} ✅` : `${p2Label} ⏳`;
  const suffix = (gate.p1Ready && gate.p2Ready) ? ' — Advancing...' : '';
  return `${p1} | ${p2}${suffix}`;
}

function buildGateLabel(phase, game) {
  return (PHASE_GATE_LABELS[phase] || 'Phase gate active')
    .replace('{round}', String(game.currentRound || 1));
}

function buildGateContent(phase, gate, game, viewerPn) {
  const label = buildGateLabel(phase, game);
  const status = buildStatusLine(gate, game, viewerPn);
  return `🔔 ${label}\n${status}`;
}

function buildGateButtons(gameId, playerNum, gate) {
  const isReady = playerNum === 1 ? gate.p1Ready : gate.p2Ready;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`phase_gate_ready_${gameId}`)
      .setLabel('✅ Ready')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isReady),
    new ButtonBuilder()
      .setCustomId(`phase_gate_unready_${gameId}`)
      .setLabel('❌ Not Ready')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isReady),
  );
}

function buildGatePayload(gameId, playerNum, gate, game) {
  // Pass playerNum as viewerPn so only the owning player is @-mentioned
  const content = buildGateContent(gate.phase, gate, game, playerNum);
  const bothReady = gate.p1Ready && gate.p2Ready;
  return {
    content,
    components: bothReady ? [] : [buildGateButtons(gameId, playerNum, gate)],
  };
}

// ── Send phase gate messages ────────────────────────────────────────────────

/**
 * Create and send phase gate messages to both hand channels.
 * @param {object} game
 * @param {string} phase - One of the PHASE_GATE_LABELS keys
 * @param {object} ctx - needs client, logGameAction, saveGames
 */
export async function sendPhaseGateMessages(game, phase, ctx) {
  const { client, logGameAction, saveGames } = ctx;
  const gameId = game.gameId;

  createPhaseGate(game, phase);
  const gate = game.phaseGate;

  // Send to each player's hand channel
  for (const pn of [1, 2]) {
    const handId = getHandChannelId(game, pn);
    if (!handId) continue;
    try {
      const handCh = await fetchGameChannel(client, handId);
      const payload = buildGatePayload(gameId, pn, gate, game);
      const msg = await handCh.send(payload);
      if (pn === 1) gate.p1MsgId = msg.id;
      else gate.p2MsgId = msg.id;
    } catch (err) {
      console.error(`[phase-gate] Failed to send gate message to P${pn} hand:`, err.message);
    }
  }

  // Hand channel messages are sufficient — no Game Log message needed
  // (players see Ready/Not Ready buttons in their Hand channels without revealing opponent status)

  if (saveGames) saveGames();
}

// ── Update gate messages ────────────────────────────────────────────────────

async function updateGateMessages(game, ctx) {
  const { client } = ctx;
  const gate = game.phaseGate;
  if (!gate) return;
  const gameId = game.gameId;

  for (const pn of [1, 2]) {
    const handId = getHandChannelId(game, pn);
    const msgId = pn === 1 ? gate.p1MsgId : gate.p2MsgId;
    if (!handId || !msgId) continue;
    try {
      const handCh = await fetchGameChannel(client, handId);
      const msg = await handCh.messages.fetch(msgId);
      const payload = buildGatePayload(gameId, pn, gate, game);
      await msg.edit(payload).catch(discordCatch);
    } catch {
      // Message gone — ignore, recovery can handle later
    }
  }
}

async function deleteGateMessages(game, ctx) {
  const { client } = ctx;
  const gate = game.phaseGate;
  if (!gate) return;

  for (const pn of [1, 2]) {
    const handId = getHandChannelId(game, pn);
    const msgId = pn === 1 ? gate.p1MsgId : gate.p2MsgId;
    if (!handId || !msgId) continue;
    try {
      const handCh = await fetchGameChannel(client, handId);
      const msg = await handCh.messages.fetch(msgId);
      await msg.delete().catch(discordCatch);
    } catch {
      // Message already gone — fine
    }
  }
}

// ── Ready handler ───────────────────────────────────────────────────────────

/**
 * Handle phase_gate_ready_ button click.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handlePhaseGateReady(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  const gameId = interaction.customId.replace('phase_gate_ready_', '');
  const game = getGame(gameId);
  if (!game || game.ended) {
    await interaction.followUp({ content: 'Game not found or ended.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!game.phaseGate) {
    await interaction.followUp({ content: 'No pending phase gate.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const userId = interaction.user.id;
  const clickerPn = playerNumFromId(game, userId);
  if (clickerPn === 0 && !game.isTestGame) {
    await interaction.followUp({ content: 'Only players in this game can use this.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const { alreadyReady, bothReady, playerNum } = recordPhaseGateReady(game, userId);
  if (alreadyReady) {
    await interaction.followUp({ content: "You're already marked as ready.", ephemeral: true }).catch(discordCatch);
    return;
  }

  if (!bothReady) {
    await updateGateMessages(game, ctx);
    saveGames();
    return;
  }

  // Both ready — finalize: delete gate messages from hand channels (no need to leave stale text)
  await deleteGateMessages(game, ctx);

  const phase = game.phaseGate.phase;
  clearPhaseGate(game);
  await dispatchPhaseAdvance(game, phase, ctx);
  saveGames();
}

// ── Unready handler ─────────────────────────────────────────────────────────

/**
 * Handle phase_gate_unready_ button click.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handlePhaseGateUnready(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const gameId = interaction.customId.replace('phase_gate_unready_', '');
  const game = getGame(gameId);
  if (!game || game.ended) {
    await interaction.followUp({ content: 'Game not found or ended.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!game.phaseGate) {
    await interaction.followUp({ content: 'No pending phase gate.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const userId = interaction.user.id;
  const clickerPn = playerNumFromId(game, userId);
  if (clickerPn === 0 && !game.isTestGame) {
    await interaction.followUp({ content: 'Only players in this game can use this.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const { alreadyUnready } = recordPhaseGateUnready(game, userId);
  if (alreadyUnready) {
    await interaction.followUp({ content: "You're already marked as not ready.", ephemeral: true }).catch(discordCatch);
    return;
  }

  await updateGateMessages(game, ctx);
  saveGames();
}

// ── Dispatch table ──────────────────────────────────────────────────────────

async function dispatchPhaseAdvance(game, phase, ctx) {
  const { client, logGameAction, saveGames } = ctx;
  const gameId = game.gameId;

  switch (phase) {
    case 'deploy_done':
      await advanceFromDeployment(game, ctx);
      break;

    case 'attach_done': {
      const { finishSetupAttachments } = ctx;
      if (finishSetupAttachments) {
        await finishSetupAttachments(game, client);
      }
      break;
    }

    case 'cc_drawn': {
      setPhase(game, PHASES.ROUND_ACTIVE, ROUND_PHASES.START_OF_ROUND);
      const { runStartOfRoundDcEffects, sendPhaseGateMessages: sendGate } = ctx;
      const hasPendingSor = runStartOfRoundDcEffects
        ? await runStartOfRoundDcEffects(game, gameId, client, { logGameAction })
        : false;
      if (!hasPendingSor) {
        const gateFn = sendGate || sendPhaseGateMessages;
        await gateFn(game, 'pre_activation', ctx);
      }
      break;
    }

    case 'pre_end_of_round': {
      setRoundPhase(game, ROUND_PHASES.END_OF_ROUND);
      game.endOfRoundWhoseTurn = game.initiativePlayerId;
      const { getInitiativePlayerZoneLabel, updateHandChannelMessages } = ctx;
      const _eorInitPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
      const _eorOtherPlayerId = game.initiativePlayerId === game.player1Id ? game.player2Id : game.player1Id;
      const _eorInitZone = getInitiativePlayerZoneLabel ? getInitiativePlayerZoneLabel(game) : '';
      if (logGameAction) {
        await logGameAction(game, client, `**End of Round** — 1. Mission Rules/Effects (resolve as needed). 2. <@${game.initiativePlayerId}> (${_eorInitZone}Initiative). 3. <@${_eorOtherPlayerId}>. 4. Next phase. Initiative player: play any end-of-round effects or CCs, then click **End 'End of Round' window** in your Hand.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [game.initiativePlayerId, _eorOtherPlayerId] } });
      }
      if (updateHandChannelMessages) {
        await updateHandChannelMessages(game, client);
      }
      break;
    }

    case 'post_end_of_round': {
      // Run the status phase (CC draw, initiative swap, etc.) then gate before activation
      const { runStatusPhaseAfterEndOfRound } = ctx;
      if (runStatusPhaseAfterEndOfRound) {
        await runStatusPhaseAfterEndOfRound(game, ctx);
      }
      break;
    }

    case 'post_start_of_round': {
      // Start-of-round effects done — gate before activation
      await sendPhaseGateMessages(game, 'pre_activation', ctx);
      break;
    }

    case 'pre_activation': {
      setRoundPhase(game, ROUND_PHASES.ACTIVATION);
      const { sendRoundActivationPhaseMessage } = ctx;
      if (sendRoundActivationPhaseMessage) {
        await sendRoundActivationPhaseMessage(game, client);
      }
      break;
    }

    default:
      console.warn(`[phase-gate] Unknown phase for dispatch: ${phase}`);
  }
}

// ── advanceFromDeployment (extracted from setup.js) ─────────────────────────

/**
 * Logic after both players have deployed: proceed to CC draw.
 * Attachments are already placed before deployment, so no attachment check needed.
 */
async function advanceFromDeployment(game, ctx) {
  const {
    client, logGameAction, saveGames,
    getInitiativePlayerZoneLabel, clearPreGameSetup,
    runPostDeployPhase, getCcShuffleDrawButton,
    // Companion DC embed deps (threaded to runPostDeployPhase)
    buildDcEmbedAndFiles, dcMessageMeta, dcExhaustedState, dcHealthState,
    getDcPlayAreaComponents, getNicknamesForDcMessage,
  } = ctx;
  const gameId = game.gameId;

  const p1CcList = game.player1Squad?.ccList || [];
  const p2CcList = game.player2Squad?.ccList || [];

  game.currentRound = 1;
  setPhase(game, PHASES.CC_DRAW);
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  if (clearPreGameSetup) await clearPreGameSetup(game, client);

  const _sendCcPrompts = async () => {
    const generalChannel = await fetchGameChannel(client, game.generalId);
    const initPlayerNum = getInitiativePlayerNum(game);
    const deployContent = `<@${game.initiativePlayerId}> (${getInitiativePlayerZoneLabel(game)}**Player ${initPlayerNum}**) **Both players have deployed.** Both players: draw your starting hands in the **Your Hand** thread (inside your Play Area). Round 1 will begin when both have drawn.`;
    await generalChannel.send({
      content: deployContent,
      allowedMentions: { users: [game.initiativePlayerId] },
    });
    // Filter out attached CCs from deck lists
    const p1Placed = (game.p1CcAttachments && Object.values(game.p1CcAttachments).flat()) || [];
    const p2Placed = (game.p2CcAttachments && Object.values(game.p2CcAttachments).flat()) || [];
    const p1DeckList = p1CcList.filter((c) => !p1Placed.includes(c));
    const p2DeckList = p2CcList.filter((c) => !p2Placed.includes(c));
    try {
      const p1HandChannel = await fetchGameChannel(client, game.p1HandId);
      const p2HandChannel = await fetchGameChannel(client, game.p2HandId);
      const ccDeckText = (list) => list.length ? list.join(', ') : '(no command cards)';
      await p1HandChannel.send({
        content: `**Your Command Card deck** (${p1DeckList.length} cards):\n${ccDeckText(p1DeckList)}\n\nWhen ready, shuffle and draw your starting 3.`,
        components: [getCcShuffleDrawButton(gameId)],
      });
      await p2HandChannel.send({
        content: `**Your Command Card deck** (${p2DeckList.length} cards):\n${ccDeckText(p2DeckList)}\n\nWhen ready, shuffle and draw your starting 3.`,
        components: [getCcShuffleDrawButton(gameId)],
      });
    } catch (err) {
      console.error('Failed to send CC deck prompt:', err);
    }
    if (saveGames) saveGames();
  };

  let postDeployActive = false;
  if (runPostDeployPhase) {
    postDeployActive = await runPostDeployPhase(game, gameId, client, {
      logGameAction, saveGames,
      buildDcEmbedAndFiles, dcMessageMeta, dcExhaustedState, dcHealthState,
      getDcPlayAreaComponents, getNicknamesForDcMessage,
    }, _sendCcPrompts);
  }
  if (!postDeployActive) {
    await _sendCcPrompts();
  }
  if (saveGames) saveGames();
}
