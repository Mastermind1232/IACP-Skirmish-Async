import { createDomainEvent } from '../events.js';

/**
 * Handles PlayCommandCard command.
 * Emits CardPlayed event.
 */
export function handlePlayCommandCard(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum, cardName } = payload;

  if (!cardName) {
    return { events: [], error: 'Missing cardName' };
  }

  const events = [
    createDomainEvent('CardPlayed', gameId, playerId, {
      playerNum: playerNum || null,
      cardName,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles DiscardCommandCard command.
 * Emits CardDiscarded event.
 */
export function handleDiscardCommandCard(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum, cardName } = payload;

  if (!cardName) {
    return { events: [], error: 'Missing cardName' };
  }

  const events = [
    createDomainEvent('CardDiscarded', gameId, playerId, {
      playerNum: playerNum || null,
      cardName,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles DrawCommandCards command.
 * Emits CardsDrawn event.
 */
export function handleDrawCommandCards(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum, count } = payload;

  const events = [
    createDomainEvent('CardsDrawn', gameId, playerId, {
      playerNum: playerNum || null,
      count: count || 1,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles NegationAttempt command.
 * Emits NegationAttempted event.
 */
export function handleNegationAttempt(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum, targetCardName } = payload;

  if (!targetCardName) {
    return { events: [], error: 'Missing targetCardName' };
  }

  const events = [
    createDomainEvent('NegationAttempted', gameId, playerId, {
      playerNum: playerNum || null,
      targetCardName,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles NegationResolve command.
 * Emits NegationResolved event.
 */
export function handleNegationResolve(state, command) {
  const { gameId, playerId, payload } = command;
  const { negated } = payload;

  const events = [
    createDomainEvent('NegationResolved', gameId, playerId, {
      negated: !!negated,
    }),
  ];

  return { events, error: null };
}
