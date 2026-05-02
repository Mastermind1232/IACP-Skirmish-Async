import { createDomainEvent } from '../events.js';

/**
 * Handles StartMovement command.
 * Emits MovementStarted event.
 */
export function handleStartMovement(state, command) {
  const { gameId, playerId, payload } = command;
  const { figureKey, movementPoints } = payload;

  if (!figureKey) {
    return { events: [], error: 'Missing figureKey' };
  }

  const events = [
    createDomainEvent('MovementStarted', gameId, playerId, {
      figureKey,
      movementPoints: movementPoints || 0,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles MoveToSpace command.
 * Emits FigureMoved event.
 */
export function handleMoveToSpace(state, command) {
  const { gameId, playerId, payload } = command;
  const { figureKey, fromCoord, toCoord, cost } = payload;

  if (!state.moveInProgress) {
    return { events: [], error: 'No movement session active' };
  }

  if (!toCoord) {
    return { events: [], error: 'Missing toCoord' };
  }

  const events = [
    createDomainEvent('FigureMoved', gameId, playerId, {
      figureKey: figureKey || null,
      fromCoord: fromCoord || null,
      toCoord,
      cost: cost || 1,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles CompleteMovement command.
 * Emits MovementCompleted event.
 */
export function handleCompleteMovement(state, command) {
  const { gameId, playerId, payload } = command;
  const { figureKey } = payload;

  const events = [
    createDomainEvent('MovementCompleted', gameId, playerId, {
      figureKey: figureKey || null,
    }),
  ];

  return { events, error: null };
}
