import { createDomainEvent } from '../events.js';

/**
 * Handles starting a new round.
 * Emits RoundStarted event.
 */
export function handleStartRound(state, command) {
  const { gameId, playerId, payload } = command;
  const { roundNumber } = payload;

  if (!roundNumber && roundNumber !== 0) {
    return { events: [], error: 'Missing roundNumber' };
  }

  const events = [
    createDomainEvent('RoundStarted', gameId, playerId, { roundNumber }),
  ];

  return { events, error: null };
}

/**
 * Handles ending the current round.
 * Emits RoundEnded event.
 */
export function handleEndRound(state, command) {
  const { gameId, playerId, payload } = command;
  const roundNumber = payload.roundNumber || state.currentRound;

  const events = [
    createDomainEvent('RoundEnded', gameId, playerId, { roundNumber }),
  ];

  return { events, error: null };
}

/**
 * Handles starting end-of-round phase.
 * Emits EndOfRoundStarted event.
 */
export function handleEndOfRoundStart(state, command) {
  const { gameId, playerId } = command;

  const events = [
    createDomainEvent('EndOfRoundStarted', gameId, playerId, {}),
  ];

  return { events, error: null };
}

/**
 * Handles starting activation phase.
 * Emits ActivationPhaseStarted event.
 */
export function handleActivationPhaseStart(state, command) {
  const { gameId, playerId, payload } = command;

  const events = [
    createDomainEvent('ActivationPhaseStarted', gameId, playerId, {
      activePlayerId: payload.activePlayerId || null,
    }),
  ];

  return { events, error: null };
}
