import { createDomainEvent } from '../events.js';

/**
 * Handles DeclareAttack command.
 * Emits CombatDeclared event.
 */
export function handleDeclareAttack(state, command) {
  const { gameId, playerId, payload } = command;
  const { attackerMsgId, defenderMsgId, attackerPlayerNum } = payload;

  if (state.pendingCombat) {
    return { events: [], error: 'Combat already in progress' };
  }

  if (!attackerMsgId || !defenderMsgId) {
    return { events: [], error: 'Missing attacker or defender msgId' };
  }

  const events = [
    createDomainEvent('CombatDeclared', gameId, playerId, {
      attackerMsgId,
      defenderMsgId,
      attackerPlayerNum: attackerPlayerNum || null,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles ReadyForCombat command.
 * Emits CombatPlayerReady event.
 */
export function handleReadyForCombat(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum } = payload;

  const events = [
    createDomainEvent('CombatPlayerReady', gameId, playerId, { playerNum }),
  ];

  return { events, error: null };
}

/**
 * Handles RollCombatDice command.
 * Emits CombatDiceRolled event.
 */
export function handleRollCombatDice(state, command) {
  const { gameId, playerId, payload } = command;
  const { side, dice } = payload;

  if (!side || !dice) {
    return { events: [], error: 'Missing side or dice data' };
  }

  const events = [
    createDomainEvent('CombatDiceRolled', gameId, playerId, { side, dice }),
  ];

  return { events, error: null };
}

/**
 * Handles SpendSurge command.
 * Emits CombatSurgeSpent event.
 */
export function handleSpendSurge(state, command) {
  const { gameId, playerId, payload } = command;
  const { surgeKey } = payload;

  if (!state.pendingCombat) {
    return { events: [], error: 'No active combat' };
  }
  if ((state.pendingCombat.surgeRemaining || 0) < 1) {
    return { events: [], error: 'No surges remaining' };
  }

  if (!surgeKey) {
    return { events: [], error: 'Missing surgeKey' };
  }

  const events = [
    createDomainEvent('CombatSurgeSpent', gameId, playerId, { surgeKey }),
  ];

  return { events, error: null };
}

/**
 * Handles PerformReroll command.
 * Emits CombatRerollPerformed event.
 */
export function handlePerformReroll(state, command) {
  const { gameId, playerId, payload } = command;
  const { side, dieIndex, newFace } = payload;

  if (!state.pendingCombat) {
    return { events: [], error: 'No active combat' };
  }

  if (!side || dieIndex === undefined) {
    return { events: [], error: 'Missing side or dieIndex' };
  }

  const events = [
    createDomainEvent('CombatRerollPerformed', gameId, playerId, {
      side,
      dieIndex,
      newFace: newFace || null,
    }),
  ];

  return { events, error: null };
}
