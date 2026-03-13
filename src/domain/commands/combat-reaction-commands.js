import { createDomainEvent } from '../events.js';

/**
 * Handles ResolveCombat command.
 * Emits CombatResolved event.
 */
export function handleResolveCombat(state, command) {
  const { gameId, playerId, payload } = command;
  const { damageDealt, defeated } = payload;

  const events = [
    createDomainEvent('CombatResolved', gameId, playerId, {
      damageDealt: damageDealt || 0,
      defeated: !!defeated,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles CancelCombat command.
 * Emits CombatCancelled event.
 */
export function handleCancelCombat(state, command) {
  const { gameId, playerId } = command;

  const events = [
    createDomainEvent('CombatCancelled', gameId, playerId, {}),
  ];

  return { events, error: null };
}

/**
 * Handles CombatPassive (defensive/attack modifiers).
 * Emits CombatPassiveApplied event.
 */
export function handleCombatPassive(state, command) {
  const { gameId, playerId, payload } = command;
  const { passiveName, effect } = payload;

  if (!passiveName) {
    return { events: [], error: 'Missing passiveName' };
  }

  const events = [
    createDomainEvent('CombatPassiveApplied', gameId, playerId, {
      passiveName,
      effect: effect || {},
    }),
  ];

  return { events, error: null };
}

/**
 * Handles CombatToken spend.
 * Emits CombatTokenApplied event.
 */
export function handleCombatToken(state, command) {
  const { gameId, playerId, payload } = command;
  const { tokenType, figureKey } = payload;

  if (!tokenType || !figureKey) {
    return { events: [], error: 'Missing tokenType or figureKey' };
  }

  const events = [
    createDomainEvent('CombatTokenApplied', gameId, playerId, {
      tokenType,
      figureKey,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles CleaveTarget selection.
 * Emits CleaveTargetSelected event.
 */
export function handleCleaveTarget(state, command) {
  const { gameId, playerId, payload } = command;
  const { targetFigureKey, cleaveDamage } = payload;

  if (!targetFigureKey) {
    return { events: [], error: 'Missing targetFigureKey' };
  }

  const events = [
    createDomainEvent('CleaveTargetSelected', gameId, playerId, {
      targetFigureKey,
      cleaveDamage: cleaveDamage || 0,
    }),
  ];

  return { events, error: null };
}
