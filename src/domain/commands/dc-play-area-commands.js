import { createDomainEvent } from '../events.js';

/**
 * Handles PerformAction command (Move/Attack/Interact/Special).
 * Emits DcActionPerformed event.
 */
export function handlePerformAction(state, command) {
  const { gameId, playerId, payload } = command;
  const { msgId, actionType } = payload;

  if (state.dcActionsData?.[msgId]?.remaining <= 0) {
    return { events: [], error: 'No actions remaining' };
  }

  if (!msgId || !actionType) {
    return { events: [], error: 'Missing msgId or actionType' };
  }

  const events = [
    createDomainEvent('DcActionPerformed', gameId, playerId, {
      msgId,
      actionType,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles EndActivation for a DC.
 * Emits DcEndedActivation + ActivationCleanedUp events.
 */
export function handleDcEndActivation(state, command) {
  const { gameId, playerId, payload } = command;
  const { msgId } = payload;

  if (!msgId) {
    return { events: [], error: 'Missing msgId' };
  }

  const events = [
    createDomainEvent('DcEndedActivation', gameId, playerId, { msgId }),
    createDomainEvent('ActivationCleanedUp', gameId, playerId, { msgId }),
  ];

  return { events, error: null };
}
