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
  getPlayerId, getHandChannelId,
} from '../game/player-helpers.js';
import { setPhase, setRoundPhase, PHASES, ROUND_PHASES } from '../game/phase.js';
import { recomputeActivationCounts } from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { setPendingMissionSorReveal } from '../game/interrupts.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { parseCustomId } from '../discord/custom-id.js';
import { getDcEffects } from '../data-loader.js';
import { getConfig } from '../game/figure-config.js';
import { sendCcShuffleDrawPrompts } from '../engine/cc-draw-prompts.js';

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
  const acked = gate.acked || {};
  const tag = (pn, label) => {
    if (acked[pn]) return `${label} ✅`;
    if (gate.activePlayer === pn) return `${label} 👈 your turn`;
    return `${label} ⏳ waits`;
  };
  const bothReady = Boolean(acked[1]) && Boolean(acked[2]);
  const suffix = bothReady ? ' — Advancing...' : '';
  return `${tag(1, p1Label)} | ${tag(2, p2Label)}${suffix}`;
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
  const acked = gate.acked || {};
  const isReady = Boolean(acked[playerNum]);
  // Sequential gate: ready button enabled only when it's this player's
  // turn AND they haven't already acked. Unready stays available to the
  // player whose ack is still in place.
  const isActive = gate.activePlayer === playerNum;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`phase_gate_ready_${gameId}`)
      .setLabel('✅ Ready')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isReady || !isActive),
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
  const acked = gate.acked || {};
  const bothReady = Boolean(acked[1]) && Boolean(acked[2]);
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

  if (saveGames) saveGames(game.gameId);
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
    // alexanbv 2026-06-23: keep message (no delete) for traceability
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
  const gameId = parseCustomId(interaction.customId, 'phase_gate_ready_');
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

  // Block deploy_done if this player has incomplete loadout/form selections
  if (game.phaseGate?.phase === 'deploy_done') {
    const pn = clickerPn || (game.isTestGame ? 1 : 0);
    if (pn > 0) {
      const missing = getIncompleteDeploySelections(game, pn);
      if (missing.length > 0) {
        const list = missing.map(m => `• **${m.dcName}**: ${m.what}`).join('\n');
        await interaction.followUp({
          content: `Cannot mark ready — incomplete setup:\n${list}\n\nPlease complete these selections in your Hand channel first.`,
          ephemeral: true,
        }).catch(discordCatch);
        return;
      }
    }
  }

  const { alreadyReady, bothReady, outOfTurn, playerNum } = recordPhaseGateReady(game, userId);
  if (outOfTurn) {
    const _activePn = game.phaseGate?.activePlayer;
    const _activeName = _activePn === 1 ? 'P1' : 'P2';
    const _isInitiative = (_activePn === 1 ? game.player1Id : game.player2Id) === game.initiativePlayerId;
    const _label = _isInitiative ? 'initiative player' : 'opponent';
    await interaction.followUp({
      content: `Sequential gate: waiting on the ${_label} (${_activeName}) to confirm first.`,
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  if (alreadyReady) {
    await interaction.followUp({ content: "You're already marked as ready.", ephemeral: true }).catch(discordCatch);
    return;
  }

  if (!bothReady) {
    await updateGateMessages(game, ctx);
    saveGames(game.gameId);
    return;
  }

  // Both ready — finalize: delete gate messages from hand channels (no need to leave stale text)
  await deleteGateMessages(game, ctx);

  const phase = game.phaseGate.phase;
  clearPhaseGate(game);
  await dispatchPhaseAdvance(game, phase, ctx);
  saveGames(game.gameId);
}

// ── Unready handler ─────────────────────────────────────────────────────────

/**
 * Handle phase_gate_unready_ button click.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handlePhaseGateUnready(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'phase_gate_unready_');
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
  saveGames(game.gameId);
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

    case 'cc_drawn':
      await advanceFromCcDraw(game, ctx);
      break;

    case 'pre_end_of_round': {
      setRoundPhase(game, ROUND_PHASES.END_OF_ROUND);
      // alexanbv 2026-06-13: run the status-phase prefix (draw, ready DCs,
      // mission EoR rules/scoring = steps 1-3) FIRST. That flow ends in
      // _openEorWindowAfterMission, which opens the player EoR window
      // (steps 4-5: init then non-init) AFTER mission scoring. The player
      // window no longer opens here before mission rules.
      const { runStatusPhaseAfterEndOfRound: _eorRunStatus } = ctx;
      if (_eorRunStatus) {
        await _eorRunStatus(game, ctx);
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

// ── Deploy-time selection validation ────────────────────────────────────────

const LOADOUT_ABILITY_IDS = ['imperial_loadout_purge_trooper'];
const FORM_ABILITY_IDS = ['shape_clawdite_elite', 'shape_clawdite_reg'];

/**
 * Check if a player has any deployed figures missing required selections (loadout, form).
 * @returns {Array<{ dcName: string, what: string }>} List of missing selections
 */
function getIncompleteDeploySelections(game, playerNum) {
  const missing = [];
  const allEffects = getDcEffects() || {};
  const positions = game.figurePositions?.[playerNum] || {};
  for (const [fk, pos] of Object.entries(positions)) {
    if (!pos) continue;
    const dcName = fk.replace(/-\d+-\d+$/, '');
    const eff = allEffects[dcName];
    if (!eff?.specialAbilityIds) continue;
    const cfg = getConfig(game, fk);
    if (eff.specialAbilityIds.some(id => LOADOUT_ABILITY_IDS.includes(id)) && !cfg.loadout) {
      missing.push({ dcName: dcName.replace(/_/g, ' '), what: 'select a Loadout card' });
    }
    if (eff.specialAbilityIds.some(id => FORM_ABILITY_IDS.includes(id)) && !cfg.form) {
      missing.push({ dcName: dcName.replace(/_/g, ' '), what: 'select a Form card' });
    }
  }
  return missing;
}

// ── advanceFromCcDraw (extracted from cc_drawn dispatch case) ───────────────

/**
 * Logic to enter Round 1's start-of-round phase after CC draw is
 * complete. Per user 2026-05-09 the cc_drawn ready check was
 * removed — we proceed directly here once both players have drawn.
 * SoR ability check is still posted by runStartOfRoundContinuation
 * via the post_start_of_round phase gate.
 */
export async function advanceFromCcDraw(game, ctx) {
  const { client, logGameAction, saveGames } = ctx;
  const gameId = game.gameId;
  setPhase(game, PHASES.ROUND_ACTIVE, ROUND_PHASES.START_OF_ROUND);
  // Recompute activation counts now that figures are deployed and we're
  // entering the round. Mirror of the fix in setup-bridge.js#runDraftRandom
  // — the populatePlayAreas recompute fires before figures are placed,
  // so the round can otherwise open with 0/0 remaining.
  recomputeActivationCounts(game, 1);
  recomputeActivationCounts(game, 2);
  const { getMissionRules, getMapTokensData, runStartOfRoundRules, runStartOfRoundContinuation } = ctx;

  // Round 1 enters start-of-round here (Round 2+ uses _runInitiativeSwapAndContinue).
  // Run the same mission SOR gate + shared continuation so every start-of-round
  // effect (mission rules, CC passives, DC passives, hand refresh, phase gate,
  // mission-specific prompts) fires identically in both paths.
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  const missionRules = getMissionRules?.(mapId, variant) ?? {};
  if (missionRules?.startOfRound?.randomRevealAndPlaceStrain) {
    const missionName = game.selectedMission?.name || 'Mission Effect';
    const generalChannel = await fetchGameChannel(client, game.generalId);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sor_mission_reveal_${gameId}`)
        .setLabel('Reveal Mission Tokens')
        .setStyle(ButtonStyle.Primary)
    );
    await generalChannel.send({
      content: `⚡ **Round ${game.currentRound || 1} — ${missionName}** — Each player randomly reveals 1 set-aside mission token. Either player: press to reveal.`,
      components: [row],
    });
    setPendingMissionSorReveal(game);
    saveGames?.(game.gameId);
    return;
  }
  if (runStartOfRoundRules && missionRules?.startOfRound) {
    await runStartOfRoundRules(game, mapId, variant, missionRules.startOfRound, { logGameAction, client, getMapTokensData });
  }
  if (runStartOfRoundContinuation) {
    await runStartOfRoundContinuation(game, gameId, null, ctx);
  }
}

// ── advanceFromDeployment (extracted from setup.js) ─────────────────────────

/**
 * Logic after both players have deployed: proceed to CC draw.
 * Attachments are already placed before deployment, so no attachment check needed.
 */
export async function advanceFromDeployment(game, ctx) {
  const {
    client, logGameAction, saveGames,
    getInitiativePlayerZoneLabel, clearPreGameSetup,
    runPostDeployPhase, getCcShuffleDrawButton,
    // Companion DC embed deps (threaded to runPostDeployPhase)
    buildDcEmbedAndFiles, dcMessageMeta, dcExhaustedState, dcHealthState,
    getDcPlayAreaComponents, getNicknamesForDcMessage,
  } = ctx;
  const gameId = game.gameId;

  game.currentRound = 1;
  setPhase(game, PHASES.CC_DRAW);
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  if (clearPreGameSetup) await clearPreGameSetup(game, client);

  // Per user 2026-05-09: auto-fire shuffle-and-draw for both players
  // when post-deploy completes. Per user clarification: I Know
  // Everything (Moff Gideon) must fire AND resolve BEFORE any
  // shuffle-and-draw runs. autoDrawAllStartingHands handles both
  // phases: triggers IKE first; if IKE is pending, waits for the
  // IKE handler to call back; otherwise draws for both players in
  // initiative order and advances to round 1 SoR.
  const _autoDrawBoth = async () => {
    try {
      const { autoDrawAllStartingHands } = await import('./cc-hand.js');
      await autoDrawAllStartingHands(game, ctx);
    } catch (err) {
      console.error('advanceFromDeployment auto-draw failed; falling back to manual prompts', err);
      // Safety net: if the auto-draw path errors, post the legacy
      // Shuffle & Draw buttons so the game can still progress.
      await sendCcShuffleDrawPrompts(game, client, {
        getCcShuffleDrawButton, getInitiativePlayerZoneLabel, saveGames,
      });
    }
  };

  let postDeployActive = false;
  if (runPostDeployPhase) {
    postDeployActive = await runPostDeployPhase(game, gameId, client, {
      logGameAction, saveGames,
      buildDcEmbedAndFiles, dcMessageMeta, dcExhaustedState, dcHealthState,
      getDcPlayAreaComponents, getNicknamesForDcMessage,
    }, _autoDrawBoth);
  }
  if (!postDeployActive) {
    await _autoDrawBoth();
  }
  if (saveGames) saveGames(game.gameId);
}
