import { createDomainEvent } from '../events.js';

/**
 * Handles PhaseGateReady command.
 * Validates state, emits PhaseGatePlayerReady.
 * If both players ready: also emits PhaseGateCleared.
 *
 * @param {Object} state - current game state
 * @param {Object} command - { type, gameId, playerId, payload: { playerNum } }
 * @returns {{ events: Array, error: string|null }}
 */
export function handlePhaseGateReady(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum } = payload;

  if (!state.phaseGate) {
    return { events: [], error: 'No phase gate is active' };
  }

  const readyKey = playerNum === 1 ? 'p1Ready' : 'p2Ready';
  if (state.phaseGate[readyKey]) {
    return { events: [], error: `Player ${playerNum} is already ready` };
  }

  const events = [];

  events.push(createDomainEvent('PhaseGatePlayerReady', gameId, playerId, { playerNum }));

  // Check if both players are now ready
  const otherReadyKey = playerNum === 1 ? 'p2Ready' : 'p1Ready';
  if (state.phaseGate[otherReadyKey]) {
    events.push(createDomainEvent('PhaseGateCleared', gameId, playerId, {
      gateType: state.phaseGate.phase,
    }));
  }

  return { events, error: null };
}

/**
 * Handles PhaseGateUnready command.
 */
export function handlePhaseGateUnready(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum } = payload;

  if (!state.phaseGate) {
    return { events: [], error: 'No phase gate is active' };
  }

  const readyKey = playerNum === 1 ? 'p1Ready' : 'p2Ready';
  if (!state.phaseGate[readyKey]) {
    return { events: [], error: `Player ${playerNum} is not ready` };
  }

  // Re-open gate by emitting a new PhaseGateOpened (resets both)
  const events = [
    createDomainEvent('PhaseGateOpened', gameId, playerId, {
      gateType: state.phaseGate.phase,
    }),
  ];

  return { events, error: null };
}
