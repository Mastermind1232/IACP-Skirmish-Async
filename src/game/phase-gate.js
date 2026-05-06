/**
 * Phase gate state management and getWaitingPlayers utility.
 * Pure logic — no Discord dependencies.
 */
import { getPlayerId, getHandChannelId, opponentPlayerNum } from './player-helpers.js';
import { PHASES, ROUND_PHASES } from './phase.js';

// ── Phase gate labels ───────────────────────────────────────────────────────

export const PHASE_GATE_LABELS = {
  deploy_done:          'Currently in Deployment. Ready to proceed to Command Card Draw?',
  attach_done:          'Currently in Attachments. Ready to proceed to Deployment?',
  cc_drawn:             'Currently in Command Card Draw. Ready to proceed to Round {round}?',
  pre_end_of_round:     'Currently in Round {round} Activation. Ready to proceed to End of Round?',
  post_end_of_round:    'Currently in Round {round} End of Round. Ready to proceed to Status Phase?',
  post_start_of_round:  'Currently in Round {round} Start of Round. Effects resolved \u2014 ready to proceed?',
  pre_activation:       'Currently in Round {round} Start of Round. Ready to begin Activation?',
};

// ── State management ────────────────────────────────────────────────────────

/**
 * Initialize a phase gate on the game object.
 *
 * Sequential gate (destruct 2026-05-06): the initiative player acks first,
 * then the opponent. activePlayer rotates after each ack. Out-of-combat
 * gates use this ordering; combat gates use attacker-then-defender (see
 * combat.js sendCombatGate).
 *
 * @param {object} game
 * @param {string} phase - One of the PHASE_GATE_LABELS keys
 */
export function createPhaseGate(game, phase) {
  const initPn = game.initiativePlayerId === game.player2Id ? 2 : 1;
  game.phaseGate = {
    phase,
    acked: {},
    activePlayer: initPn,
    p1MsgId: null,
    p2MsgId: null,
  };
}

/**
 * Mark the active player as ready. Sequential gate: only the activePlayer
 * may ack at any given time; clicks from the inactive player return
 * `outOfTurn: true`. After ack, activePlayer rotates to the opponent.
 *
 * @param {object} game
 * @param {string} userId
 * @returns {{ alreadyReady: boolean, bothReady: boolean, outOfTurn: boolean, playerNum: number }}
 */
export function recordPhaseGateReady(game, userId) {
  const gate = game.phaseGate;
  gate.acked = gate.acked || {};
  let playerNum = playerNumFromId(game, userId);

  // Test game: P1 acts for whoever is active right now.
  if (game.isTestGame && playerNum === 1) {
    playerNum = gate.activePlayer || 1;
  }

  if (playerNum !== gate.activePlayer) {
    return { alreadyReady: false, bothReady: false, outOfTurn: true, playerNum };
  }
  if (gate.acked[playerNum]) {
    return { alreadyReady: true, bothReady: false, outOfTurn: false, playerNum };
  }

  gate.acked[playerNum] = true;
  const bothReady = Boolean(gate.acked[1]) && Boolean(gate.acked[2]);
  if (!bothReady) {
    gate.activePlayer = playerNum === 1 ? 2 : 1;
  }
  return { alreadyReady: false, bothReady, outOfTurn: false, playerNum };
}

/**
 * Mark a player as unready (revoke their previous ack). In sequential
 * mode a player can only un-ack their own confirmation; activePlayer
 * rolls back to whoever just unready'd so they get the prompt again.
 *
 * @param {object} game
 * @param {string} userId
 * @returns {{ alreadyUnready: boolean, playerNum: number }}
 */
export function recordPhaseGateUnready(game, userId) {
  const gate = game.phaseGate;
  gate.acked = gate.acked || {};
  let playerNum = playerNumFromId(game, userId);

  // Test game: P1 acts for both — un-ready the most-recently readied player.
  if (game.isTestGame && playerNum === 1) {
    if (gate.acked[2]) playerNum = 2;
    else playerNum = 1;
  }

  if (!gate.acked[playerNum]) {
    return { alreadyUnready: true, playerNum };
  }

  gate.acked[playerNum] = false;
  // Roll active back so the unready'd player can re-ack.
  gate.activePlayer = playerNum;
  return { alreadyUnready: false, playerNum };
}

/**
 * Clear the phase gate from the game object.
 * @param {object} game
 */
export function clearPhaseGate(game) {
  game.phaseGate = null;
}

// ── getWaitingPlayers ───────────────────────────────────────────────────────

/**
 * Compute waiting players for round_active sub-states (combat, movement, etc.).
 * @param {object} game
 * @returns {{ waitType: string, description: string, playerNums: number[] }}
 */
function computeRoundActiveWaiting(game) {
  // pendingCombat — combat sub-phase gate (sequential: only activePlayer waits)
  if (game.pendingCombat?.combatGate) {
    const gate = game.pendingCombat.combatGate;
    const _acked = gate.acked || {};
    const waiting = gate.activePlayer && !_acked[gate.activePlayer]
      ? [gate.activePlayer]
      : [];
    return { waitType: 'combatGate', description: `Combat gate: ${gate.phase}`, playerNums: waiting };
  }

  // pendingCombat — modify-yn gate still pending. Session 11 migration:
  // read currentStep + acked map instead of legacy p1Ready/p2Ready.
  if (game.pendingCombat) {
    const _cbt = game.pendingCombat;
    const _isPreRoll = _cbt.currentStep === 'step1+2-attacker'
      || _cbt.currentStep === 'step1+2-defender';
    if (_isPreRoll) {
      const _acked = _cbt.acked || {};
      const waiting = [];
      if (!_acked[1]) waiting.push(1);
      if (!_acked[2]) waiting.push(2);
      return { waitType: 'combatReady', description: 'Waiting for combat ready', playerNums: waiting };
    }
  }

  // pendingCombat — reroll phase
  if (game.pendingCombat?.rerollPhase) {
    const rp = game.pendingCombat.rerollPhase;
    const attackerPn = game.pendingCombat.attackerPlayerNum || 1;
    const defenderPn = opponentPlayerNum(attackerPn);
    const pn = rp === 'attacker' ? attackerPn : defenderPn;
    return { waitType: 'combatReroll', description: 'Reroll decision', playerNums: [pn] };
  }

  // pendingCombat — rolls done, no reroll
  if (game.pendingCombat?.attackRoll && game.pendingCombat?.defenseRoll) {
    return { waitType: 'combatResolution', description: 'Combat resolution in progress', playerNums: [1, 2] };
  }

  // pendingNegation
  if (game.pendingNegation) {
    const oppPn = opponentPlayerNum(game.pendingNegation.playedBy);
    return { waitType: 'negation', description: 'Negation window', playerNums: [oppPn] };
  }

  // forceVisionPending
  if (game.forceVisionPending) {
    return { waitType: 'forceVision', description: 'Force Vision pick', playerNums: [game.forceVisionPending] };
  }

  // endOfRoundWhoseTurn
  if (game.endOfRoundWhoseTurn) {
    const pn = game.endOfRoundWhoseTurn === game.player1Id ? 1 : 2;
    return { waitType: 'eorWindow', description: 'End of Round window', playerNums: [pn] };
  }

  // pendingStartOfRoundResolve
  if ((game.pendingStartOfRoundResolve || 0) > 0) {
    const waiting = [];
    if (game.pendingRogueOne_p1) waiting.push(1);
    if (game.pendingRogueOne_p2) waiting.push(2);
    return { waitType: 'sorEffect', description: 'Start-of-round effects', playerNums: waiting.length ? waiting : [1, 2] };
  }

  // pendingEndTurn
  if (game.pendingEndTurn && Object.keys(game.pendingEndTurn).length > 0) {
    const pns = new Set();
    for (const entry of Object.values(game.pendingEndTurn)) {
      if (entry.playerNum) pns.add(entry.playerNum);
    }
    return { waitType: 'endTurn', description: 'End Turn confirmation', playerNums: pns.size ? [...pns] : [1, 2] };
  }

  // moveInProgress
  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) {
    const pns = new Set();
    for (const ms of Object.values(game.moveInProgress)) {
      if (ms?.playerNum) pns.add(ms.playerNum);
    }
    return { waitType: 'movement', description: 'Movement in progress', playerNums: pns.size ? [...pns] : [1, 2] };
  }

  // currentActivationTurnPlayerId
  if (game.currentActivationTurnPlayerId) {
    const pn = game.currentActivationTurnPlayerId === game.player1Id ? 1 : 2;
    return { waitType: 'activation', description: 'Activation turn', playerNums: [pn] };
  }

  return { waitType: 'unknown', description: 'Game active', playerNums: [1, 2] };
}

/**
 * Legacy flag-based getWaitingPlayers for unmigrated games (no game.phase).
 * @param {object} game
 * @returns {{ waitType: string, description: string, playerNums: number[] }}
 */
function getWaitingPlayersLegacy(game) {
  // pendingCombat — combat sub-phase gate (sequential: only activePlayer waits)
  if (game.pendingCombat?.combatGate) {
    const gate = game.pendingCombat.combatGate;
    const _acked = gate.acked || {};
    const waiting = gate.activePlayer && !_acked[gate.activePlayer]
      ? [gate.activePlayer]
      : [];
    return { waitType: 'combatGate', description: `Combat gate: ${gate.phase}`, playerNums: waiting };
  }
  // pendingCombat — modify-yn gate still pending. Session 11 migration:
  // read currentStep + acked map instead of legacy p1Ready/p2Ready.
  if (game.pendingCombat) {
    const _cbt = game.pendingCombat;
    const _isPreRoll = _cbt.currentStep === 'step1+2-attacker'
      || _cbt.currentStep === 'step1+2-defender';
    if (_isPreRoll) {
      const _acked = _cbt.acked || {};
      const waiting = [];
      if (!_acked[1]) waiting.push(1);
      if (!_acked[2]) waiting.push(2);
      return { waitType: 'combatReady', description: 'Waiting for combat ready', playerNums: waiting };
    }
  }
  if (game.pendingCombat?.rerollPhase) {
    const rp = game.pendingCombat.rerollPhase;
    const attackerPn = game.pendingCombat.attackerPlayerNum || 1;
    const defenderPn = opponentPlayerNum(attackerPn);
    const pn = rp === 'attacker' ? attackerPn : defenderPn;
    return { waitType: 'combatReroll', description: 'Reroll decision', playerNums: [pn] };
  }
  if (game.pendingCombat?.attackRoll && game.pendingCombat?.defenseRoll) {
    return { waitType: 'combatResolution', description: 'Combat resolution in progress', playerNums: [1, 2] };
  }
  if (game.pendingNegation) {
    const oppPn = opponentPlayerNum(game.pendingNegation.playedBy);
    return { waitType: 'negation', description: 'Negation window', playerNums: [oppPn] };
  }
  if (game.forceVisionPending) {
    return { waitType: 'forceVision', description: 'Force Vision pick', playerNums: [game.forceVisionPending] };
  }
  if (game.setupAttachmentPhase) {
    const waiting = [];
    if (!game.setupAttachmentConfirmed?.[1]) waiting.push(1);
    if (!game.setupAttachmentConfirmed?.[2]) waiting.push(2);
    return { waitType: 'setupAttach', description: 'Placing attachments', playerNums: waiting.length ? waiting : [1, 2] };
  }
  if ((game.p1HandId || game.p2HandId) && (!game.player1CcDrawn || !game.player2CcDrawn)) {
    if (game.initiativePlayerDeployed && game.nonInitiativePlayerDeployed) {
      const waiting = [];
      if (!game.player1CcDrawn) waiting.push(1);
      if (!game.player2CcDrawn) waiting.push(2);
      return { waitType: 'ccDraw', description: 'Drawing command cards', playerNums: waiting };
    }
  }
  if (game.deploymentZoneChosen && (!game.initiativePlayerDeployed || !game.nonInitiativePlayerDeployed)) {
    const initPn = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const otherPn = opponentPlayerNum(initPn);
    if (!game.initiativePlayerDeployed) {
      return { waitType: 'deploy', description: 'Deploying figures', playerNums: [initPn] };
    }
    return { waitType: 'deploy', description: 'Deploying figures', playerNums: [otherPn] };
  }
  if (game.endOfRoundWhoseTurn) {
    const pn = game.endOfRoundWhoseTurn === game.player1Id ? 1 : 2;
    return { waitType: 'eorWindow', description: 'End of Round window', playerNums: [pn] };
  }
  if ((game.pendingStartOfRoundResolve || 0) > 0) {
    const waiting = [];
    if (game.pendingRogueOne_p1) waiting.push(1);
    if (game.pendingRogueOne_p2) waiting.push(2);
    return { waitType: 'sorEffect', description: 'Start-of-round effects', playerNums: waiting.length ? waiting : [1, 2] };
  }
  if (game.pendingEndTurn && Object.keys(game.pendingEndTurn).length > 0) {
    const pns = new Set();
    for (const entry of Object.values(game.pendingEndTurn)) {
      if (entry.playerNum) pns.add(entry.playerNum);
    }
    return { waitType: 'endTurn', description: 'End Turn confirmation', playerNums: pns.size ? [...pns] : [1, 2] };
  }
  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) {
    const pns = new Set();
    for (const ms of Object.values(game.moveInProgress)) {
      if (ms?.playerNum) pns.add(ms.playerNum);
    }
    return { waitType: 'movement', description: 'Movement in progress', playerNums: pns.size ? [...pns] : [1, 2] };
  }
  if (game.currentActivationTurnPlayerId) {
    const pn = game.currentActivationTurnPlayerId === game.player1Id ? 1 : 2;
    return { waitType: 'activation', description: 'Activation turn', playerNums: [pn] };
  }
  return { waitType: 'unknown', description: 'Game active', playerNums: [1, 2] };
}

/**
 * Determine who the game is waiting on using phase-based dispatch.
 * Falls back to legacy flag-based chain for unmigrated games.
 * @param {object} game
 * @returns {{ waitType: string, description: string, playerNums: number[] }}
 */
export function getWaitingPlayers(game) {
  // Phase gate always takes priority (blocks all other actions).
  // Sequential gate: only the activePlayer is currently waited on.
  if (game.phaseGate) {
    const gate = game.phaseGate;
    const _acked = gate.acked || {};
    const waiting = gate.activePlayer && !_acked[gate.activePlayer]
      ? [gate.activePlayer]
      : [];
    const label = (PHASE_GATE_LABELS[gate.phase] || 'Phase gate active')
      .replace('{round}', String(game.currentRound || 1));
    return { waitType: 'phaseGate', description: label, playerNums: waiting };
  }

  // Legacy fallback for unmigrated games
  if (!game.phase) {
    return getWaitingPlayersLegacy(game);
  }

  switch (game.phase) {
    case 'lobby':
    case 'map_selection':
    case 'initiative':
      return { waitType: 'setup', description: 'Game setup in progress', playerNums: [1, 2] };

    case 'zone_selection': {
      const chooserId = game.deviousSchemeZoneChooser || game.initiativePlayerId;
      const chooserPn = chooserId === game.player1Id ? 1 : 2;
      return { waitType: 'zoneSelection', description: 'Picking deployment zone', playerNums: [chooserPn] };
    }

    case 'deployment': {
      const initPn = game.initiativePlayerId === game.player1Id ? 1 : 2;
      const otherPn = opponentPlayerNum(initPn);
      if (!game.initiativePlayerDeployed) {
        return { waitType: 'deploy', description: 'Deploying figures', playerNums: [initPn] };
      }
      return { waitType: 'deploy', description: 'Deploying figures', playerNums: [otherPn] };
    }

    case 'attachment': {
      const waiting = [];
      if (!game.setupAttachmentConfirmed?.[1]) waiting.push(1);
      if (!game.setupAttachmentConfirmed?.[2]) waiting.push(2);
      return { waitType: 'setupAttach', description: 'Placing attachments', playerNums: waiting.length ? waiting : [1, 2] };
    }

    case 'cc_draw': {
      const waiting = [];
      if (!game.player1CcDrawn) waiting.push(1);
      if (!game.player2CcDrawn) waiting.push(2);
      return { waitType: 'ccDraw', description: 'Drawing command cards', playerNums: waiting.length ? waiting : [1, 2] };
    }

    case 'round_active':
      return computeRoundActiveWaiting(game);

    case 'ended':
      return { waitType: 'ended', description: 'Game ended', playerNums: [] };

    default:
      return { waitType: 'unknown', description: 'Game active', playerNums: [1, 2] };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get player number (1 or 2) from userId.
 * @param {object} game
 * @param {string} userId
 * @returns {number} 1 or 2, or 0 if not a player
 */
export function playerNumFromId(game, userId) {
  if (userId === game.player1Id) return 1;
  if (userId === game.player2Id) return 2;
  return 0;
}
