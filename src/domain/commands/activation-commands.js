import { createDomainEvent } from '../events.js';

/**
 * Handles EndTurn command.
 * Emits DcEndedActivation + ActivationCleanedUp events.
 */
export function handleEndTurn(state, command) {
  const { gameId, playerId, payload } = command;
  const { msgId } = payload;

  if (!msgId) {
    return { events: [], error: 'No msgId provided' };
  }

  const events = [
    createDomainEvent('DcEndedActivation', gameId, playerId, { msgId }),
    createDomainEvent('ActivationCleanedUp', gameId, playerId, { msgId }),
  ];

  return { events, error: null };
}

/**
 * Handles PassActivationTurn command.
 * Emits ActivationTurnPassed event.
 */
export function handlePassActivationTurn(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum } = payload;

  const newActivePlayerNum = playerNum === 1 ? 2 : 1;

  const events = [
    createDomainEvent('ActivationTurnPassed', gameId, playerId, { newActivePlayerNum }),
  ];

  return { events, error: null };
}

/**
 * Handles ActivateDc command.
 * Emits DcActivated event.
 */
export function handleActivateDc(state, command) {
  const { gameId, playerId, payload } = command;
  const { msgId, dcName, playerNum } = payload;

  if (state.roundPhase && state.roundPhase !== 'activation') {
    return { events: [], error: 'Not in activation phase' };
  }

  if (!msgId) {
    return { events: [], error: 'No msgId provided' };
  }

  const events = [
    createDomainEvent('DcActivated', gameId, playerId, {
      msgId,
      dcName: dcName || 'unknown',
      playerNum: playerNum || null,
    }),
  ];

  return { events, error: null };
}
