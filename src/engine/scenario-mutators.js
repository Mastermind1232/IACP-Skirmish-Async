/**
 * Phase-jump scenario mutators.
 *
 * After runDraftRandom() creates a fully-deployed round-1 game with all Discord
 * infrastructure, a mutator function mutates game state to jump to a target phase,
 * sends appropriate Discord messages/buttons, and persists.
 *
 * Dev-only: guarded by PHASE_JUMP_ALLOWED_USERS env (fail-closed).
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';

// ── Error class ──────────────────────────────────────────────────────────────

export class ScenarioMutationError extends Error {
  constructor(scenario, reason) {
    super(`Scenario '${scenario}' failed: ${reason}`);
    this.scenario = scenario;
  }
}

// ── Dev-only guard: fail-closed ──────────────────────────────────────────────

const PHASE_JUMP_ALLOWED_USERS = (process.env.PHASE_JUMP_ALLOWED_USERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ── Mutator registry ─────────────────────────────────────────────────────────

export const SCENARIO_MUTATORS = {
  eor_cc_window: mutateToEndOfRound,
  sor_cc_window: mutateToStartOfRound,
  mid_combat: mutateToCombat,
};

// ── Shared validation ────────────────────────────────────────────────────────

function validateBaseState(game, scenario, userId) {
  if (!PHASE_JUMP_ALLOWED_USERS.includes(userId)) {
    throw new ScenarioMutationError(
      scenario,
      'not authorized — set PHASE_JUMP_ALLOWED_USERS env',
    );
  }
  if (!game.figurePositions?.[1] || !game.figurePositions?.[2]) {
    throw new ScenarioMutationError(
      scenario,
      'no figure positions — deployment failed',
    );
  }
  if (!game.p1DcMessageIds?.length || !game.p2DcMessageIds?.length) {
    throw new ScenarioMutationError(
      scenario,
      'no DC message IDs — DC init failed',
    );
  }
  if (!game.generalId) {
    throw new ScenarioMutationError(
      scenario,
      'no generalId — channel setup failed',
    );
  }
}

// ── Mutators ─────────────────────────────────────────────────────────────────

/**
 * Jump to End of Round CC window.
 * Exhausts all DCs, sets round phase to END_OF_ROUND, posts EOR button.
 */
async function mutateToEndOfRound(game, client, deps, userId) {
  validateBaseState(game, 'eor_cc_window', userId);
  const {
    setRoundPhase, ROUND_PHASES, logGameAction,
    updatePlayAreaDcButtons, dcExhaustedState, saveGames,
    updateHandChannelMessages,
  } = deps;

  // Exhaust all DCs for both players
  game.p1ActivationsRemaining = 0;
  game.p2ActivationsRemaining = 0;
  game.p1ActivatedDcIndices = (game.p1DcMessageIds || []).map((_, i) => i);
  game.p2ActivatedDcIndices = (game.p2DcMessageIds || []).map((_, i) => i);
  for (const msgId of [...(game.p1DcMessageIds || []), ...(game.p2DcMessageIds || [])]) {
    dcExhaustedState.set(msgId, true);
  }

  // Set round phase
  setRoundPhase(game, ROUND_PHASES.END_OF_ROUND);
  game.endOfRoundWhoseTurn = game.initiativePlayerId;
  game.testScenarioPattern = 'phase_jump';

  // Log to Game Log
  await logGameAction(
    game, client,
    '🧪 **Phase-jump scenario: eor_cc_window** — End of Round CC window. Initiative player goes first.',
    { phase: 'ROUND', icon: 'round' },
  );

  // Send EOR button to Game Log
  const generalChannel = await client.channels.fetch(game.generalId);
  const eorRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`end_end_of_round_${game.gameId}`)
      .setLabel("End 'End of Round' window")
      .setStyle(ButtonStyle.Primary),
  );
  await generalChannel.send({
    content: `<@${game.initiativePlayerId}> — **End of Round** window is open. Play end-of-round CCs from your Hand, then click the button below when done.`,
    components: [eorRow],
    allowedMentions: { users: [game.initiativePlayerId] },
  });

  // Update DC embeds to show exhausted state
  await updatePlayAreaDcButtons(game, client);
  // Update hand channel messages to show EOR CC play buttons
  await updateHandChannelMessages(game, client);
  saveGames();
}

/**
 * Jump to Start of Round (round 2).
 * Resets round-scoped flags, sends phase gate messages.
 */
async function mutateToStartOfRound(game, client, deps, userId) {
  validateBaseState(game, 'sor_cc_window', userId);
  const {
    setRoundPhase, ROUND_PHASES, logGameAction,
    updatePlayAreaDcButtons, cleanupRoundStart, saveGames,
    sendPhaseGateMessages, dcExhaustedState,
  } = deps;

  // Advance to round 2 (more interesting — tests round transition)
  game.currentRound = 2;
  cleanupRoundStart(game);

  // Un-exhaust all DCs for fresh round
  game.p1ActivationsRemaining = game.p1ActivationsTotal || (game.p1DcMessageIds || []).length;
  game.p2ActivationsRemaining = game.p2ActivationsTotal || (game.p2DcMessageIds || []).length;
  game.p1ActivatedDcIndices = [];
  game.p2ActivatedDcIndices = [];
  for (const msgId of [...(game.p1DcMessageIds || []), ...(game.p2DcMessageIds || [])]) {
    dcExhaustedState.set(msgId, false);
  }

  // Set round phase
  setRoundPhase(game, ROUND_PHASES.START_OF_ROUND);
  game.roundActivationMessageId = null;
  game.testScenarioPattern = 'phase_jump';

  // Log to Game Log
  await logGameAction(
    game, client,
    '🧪 **Phase-jump scenario: sor_cc_window** — Start of Round CC window (Round 2). Both players must Ready to advance.',
    { phase: 'ROUND', icon: 'round' },
  );

  // Send phase gate so both players see Ready buttons
  await sendPhaseGateMessages(game, 'pre_activation', {
    client, logGameAction, saveGames,
  });

  // Update DC embeds to show fresh (unexhausted) state
  await updatePlayAreaDcButtons(game, client);
  saveGames();
}

/**
 * Jump to mid-combat state.
 * Picks first P1 figure as attacker, first P2 figure as defender.
 * Sets pendingCombat so the combat flow can proceed.
 */
async function mutateToCombat(game, client, deps, userId) {
  validateBaseState(game, 'mid_combat', userId);
  const {
    setRoundPhase, ROUND_PHASES, logGameAction,
    updatePlayAreaDcButtons, dcExhaustedState, saveGames,
  } = deps;

  // Find first P1 and P2 figures
  const p1Figures = game.figurePositions?.[1] || {};
  const p2Figures = game.figurePositions?.[2] || {};
  const p1Keys = Object.keys(p1Figures);
  const p2Keys = Object.keys(p2Figures);
  if (p1Keys.length === 0 || p2Keys.length === 0) {
    throw new ScenarioMutationError('mid_combat', 'need at least one figure per player');
  }

  const attackerFigureKey = p1Keys[0];
  const defenderFigureKey = p2Keys[0];
  const attackerMsgId = (game.p1DcMessageIds || [])[0];
  const defenderMsgId = (game.p2DcMessageIds || [])[0];

  if (!attackerMsgId) {
    throw new ScenarioMutationError('mid_combat', 'no P1 DC message ID for attacker');
  }

  // Set up activation state for attacker's DC
  game.currentActivatingDcMsgId = attackerMsgId;
  if (!game.dcActionsData) game.dcActionsData = {};
  game.dcActionsData[attackerMsgId] = { actions: 2, moved: false };
  dcExhaustedState.set(attackerMsgId, false);

  // Ensure activation phase
  setRoundPhase(game, ROUND_PHASES.ACTIVATION);
  game.testScenarioPattern = 'phase_jump';

  // Extract DC names from figure keys (format: "DcName-groupIdx-figIdx")
  const attackerDcName = dcNameFromFigureKey(attackerFigureKey);
  const defenderDcName = dcNameFromFigureKey(defenderFigureKey);

  // Set pendingCombat (minimal structure — combat handlers fill rest)
  game.pendingCombat = {
    gameId: game.gameId,
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    attackerMsgId,
    attackerDcName,
    attackerFigureKey,
    defenderDcName,
    defenderFigureKey,
    target: {
      figureKey: defenderFigureKey,
      space: p2Figures[defenderFigureKey],
      dcName: defenderDcName,
      msgId: defenderMsgId,
      dist: 1,
    },
    attackDice: [],
    defenseDice: [],
    bonusSurgeAbilities: [],
    bonusPierce: 0,
    isRanged: false,
    p1Ready: false,
    p2Ready: false,
  };

  // Log to Game Log
  await logGameAction(
    game, client,
    `🧪 **Phase-jump scenario: mid_combat** — Combat ready state. **${attackerDcName}** (P1) attacks **${defenderDcName}** (P2). Both players click Ready to begin.`,
    { phase: 'ACTION', icon: 'attack' },
  );

  // Send combat prompt to Game Log
  const generalChannel = await client.channels.fetch(game.generalId);
  const readyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`combat_ready_${game.gameId}`)
      .setLabel('Ready to roll combat dice')
      .setStyle(ButtonStyle.Secondary),
  );
  await generalChannel.send({
    content: `**Pre-combat window** — <@${game.player1Id}> (attacker: **${attackerDcName}**) vs <@${game.player2Id}> (defender: **${defenderDcName}**)\nBoth players: resolve any Command Cards, etc. When ready, click **Ready to roll combat dice**.`,
    components: [readyRow],
    allowedMentions: { users: [game.player1Id, game.player2Id] },
  });

  await updatePlayAreaDcButtons(game, client);
  saveGames();
}
