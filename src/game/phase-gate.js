/**
 * Phase gate state management and getWaitingPlayers utility.
 * Pure logic — no Discord dependencies.
 */
import { getPlayerId, getHandChannelId, opponentPlayerNum } from './player-helpers.js';
import { PHASES, ROUND_PHASES } from './phase.js';

// ── Phase gate labels ───────────────────────────────────────────────────────

export const PHASE_GATE_LABELS = {
  deploy_done:          'Both players have deployed. Ready to proceed?',
  attach_done:          'Attachments placed and confirmed. Ready to draw starting hands?',
  cc_drawn:             'Both players drew starting hands. Ready to begin Round {round}?',
  pre_end_of_round:     'Round {round} — All activations done. Ready to enter End of Round?',
  post_end_of_round:    'Round {round} — End of Round effects done. Ready to proceed to Status Phase?',
  post_start_of_round:  'Round {round} — Start of Round effects done. Ready to proceed?',
  pre_activation:       'Ready to begin Round {round} Activation Phase?',
};

// ── State management ────────────────────────────────────────────────────────

/**
 * Initialize a phase gate on the game object.
 * @param {object} game
 * @param {string} phase - One of the PHASE_GATE_LABELS keys
 */
export function createPhaseGate(game, phase) {
  game.phaseGate = {
    phase,
    p1Ready: false,
    p2Ready: false,
    p1MsgId: null,
    p2MsgId: null,
  };
}

/**
 * Mark a player as ready. Handles test game (P1 acts for both).
 * @param {object} game
 * @param {string} userId
 * @returns {{ alreadyReady: boolean, bothReady: boolean, playerNum: number }}
 */
export function recordPhaseGateReady(game, userId) {
  const gate = game.phaseGate;
  let playerNum = playerNumFromId(game, userId);

  // Test game: P1 clicks for both — first click = P1, second = P2
  if (game.isTestGame && playerNum === 1) {
    playerNum = gate.p1Ready ? 2 : 1;
  }

  const key = playerNum === 1 ? 'p1Ready' : 'p2Ready';
  if (gate[key]) {
    return { alreadyReady: true, bothReady: false, playerNum };
  }

  gate[key] = true;
  const bothReady = gate.p1Ready && gate.p2Ready;
  return { alreadyReady: false, bothReady, playerNum };
}

/**
 * Mark a player as unready. Handles test game (un-readies last readied).
 * @param {object} game
 * @param {string} userId
 * @returns {{ alreadyUnready: boolean, playerNum: number }}
 */
export function recordPhaseGateUnready(game, userId) {
  const gate = game.phaseGate;
  let playerNum = playerNumFromId(game, userId);

  // Test game: P1 acts for both — un-ready the last one that was readied
  if (game.isTestGame && playerNum === 1) {
    if (gate.p2Ready) playerNum = 2;
    else playerNum = 1;
  }

  const key = playerNum === 1 ? 'p1Ready' : 'p2Ready';
  if (!gate[key]) {
    return { alreadyUnready: true, playerNum };
  }

  gate[key] = false;
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
  // pendingCombat — not both ready
  if (game.pendingCombat && (!game.pendingCombat.p1Ready || !game.pendingCombat.p2Ready)) {
    const waiting = [];
    if (!game.pendingCombat.p1Ready) waiting.push(1);
    if (!game.pendingCombat.p2Ready) waiting.push(2);
    return { waitType: 'combatReady', description: 'Waiting for combat ready', playerNums: waiting };
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
  // pendingCombat — not both ready
  if (game.pendingCombat && (!game.pendingCombat.p1Ready || !game.pendingCombat.p2Ready)) {
    const waiting = [];
    if (!game.pendingCombat.p1Ready) waiting.push(1);
    if (!game.pendingCombat.p2Ready) waiting.push(2);
    return { waitType: 'combatReady', description: 'Waiting for combat ready', playerNums: waiting };
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
  // Phase gate always takes priority (blocks all other actions)
  if (game.phaseGate) {
    const gate = game.phaseGate;
    const waiting = [];
    if (!gate.p1Ready) waiting.push(1);
    if (!gate.p2Ready) waiting.push(2);
    const label = (PHASE_GATE_LABELS[gate.phase] || 'Phase gate active')
      .replace('{round}', String(game.currentRound || 1));
    return { waitType: 'phaseGate', description: label, playerNums: waiting.length ? waiting : [1, 2] };
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
