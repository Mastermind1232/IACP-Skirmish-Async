/**
 * Discord UI projection — translates domain events into Discord messages.
 * Each handler receives (event, client, getGameState) where getGameState
 * returns the current projected game state for the event's gameId.
 *
 * This is a scaffold; real Discord API calls will be wired in Phase 4.8
 * when the projection replaces direct UI updates in handlers.
 */

function handleRoundStarted(event, client, getGameState) {
  const { round } = event.payload;
  const gameId = event.gameId;
  // Future: post round announcement to game channel
  return { action: 'postRoundAnnouncement', gameId, round };
}

function handleFigureDefeated(event, client, getGameState) {
  const { figureKey, attackerPlayerNum } = event.payload;
  const gameId = event.gameId;
  // Future: post defeat log to game channel
  return { action: 'postDefeatLog', gameId, figureKey, attackerPlayerNum };
}

function handleVpAwarded(event, client, getGameState) {
  const { playerNum, amount, reason } = event.payload;
  const gameId = event.gameId;
  // Future: update VP display embed
  return { action: 'updateVpDisplay', gameId, playerNum, amount, reason };
}

function handleGameEnded(event, client, getGameState) {
  const { winner, reason } = event.payload;
  const gameId = event.gameId;
  // Future: post game over message + archive
  return { action: 'postGameOver', gameId, winner, reason };
}

function handleCombatDeclared(event, client, getGameState) {
  const { attackerFigureKey, defenderFigureKey } = event.payload;
  const gameId = event.gameId;
  // Future: create combat thread
  return { action: 'createCombatThread', gameId, attackerFigureKey, defenderFigureKey };
}

function handleDcActivated(event, client, getGameState) {
  const { msgId, dcName } = event.payload;
  return { action: 'postActivationStart', gameId: event.gameId, data: { msgId, dcName } };
}

function handleDcEndedActivation(event, client, getGameState) {
  const { msgId } = event.payload;
  return { action: 'postActivationEnd', gameId: event.gameId, data: { msgId } };
}

function handleDcActionPerformed(event, client, getGameState) {
  const { msgId, actionType } = event.payload;
  return { action: 'logActionPerformed', gameId: event.gameId, data: { msgId, actionType } };
}

function handleMovementStarted(event, client, getGameState) {
  const { figureKey } = event.payload;
  return { action: 'logMovementStart', gameId: event.gameId, data: { figureKey } };
}

function handleFigureMoved(event, client, getGameState) {
  const { figureKey, toCoord } = event.payload;
  return { action: 'updateBoardPosition', gameId: event.gameId, data: { figureKey, toCoord } };
}

function handleMovementCompleted(event, client, getGameState) {
  const { figureKey } = event.payload;
  return { action: 'logMovementEnd', gameId: event.gameId, data: { figureKey } };
}

function handleCombatDiceRolled(event, client, getGameState) {
  const { side, dice } = event.payload;
  return { action: 'postDiceRoll', gameId: event.gameId, data: { side, dice } };
}

function handleCombatSurgeSpent(event, client, getGameState) {
  const { surgeKey } = event.payload;
  return { action: 'logSurgeSpent', gameId: event.gameId, data: { surgeKey } };
}

function handleCombatResolved(event, client, getGameState) {
  const { damageDealt, defenderDefeated } = event.payload;
  return { action: 'postCombatResult', gameId: event.gameId, data: { damageDealt, defenderDefeated } };
}

function handleConditionApplied(event, client, getGameState) {
  const { figureKey, condition } = event.payload;
  return { action: 'logConditionApplied', gameId: event.gameId, data: { figureKey, condition } };
}

function handleConditionRemoved(event, client, getGameState) {
  const { figureKey, condition } = event.payload;
  return { action: 'logConditionRemoved', gameId: event.gameId, data: { figureKey, condition } };
}

function handlePowerTokenGained(event, client, getGameState) {
  const { figureKey, tokenType } = event.payload;
  return { action: 'logTokenGained', gameId: event.gameId, data: { figureKey, tokenType } };
}

function handlePowerTokenSpent(event, client, getGameState) {
  const { figureKey, tokenType } = event.payload;
  return { action: 'logTokenSpent', gameId: event.gameId, data: { figureKey, tokenType } };
}

function handlePhaseGateOpened(event, client, getGameState) {
  const { gateType } = event.payload;
  return { action: 'postGateOpened', gameId: event.gameId, data: { gateType } };
}

function handlePhaseGatePlayerReady(event, client, getGameState) {
  const { playerNum } = event.payload;
  return { action: 'updateGateReady', gameId: event.gameId, data: { playerNum } };
}

function handlePhaseGateCleared(event, client, getGameState) {
  const { gateType } = event.payload;
  return { action: 'postGateCleared', gameId: event.gameId, data: { gateType } };
}

function handleCardPlayed(event, client, getGameState) {
  const { playerNum, cardName } = event.payload;
  return { action: 'logCardPlayed', gameId: event.gameId, data: { playerNum, cardName } };
}

function handleCardDiscarded(event, client, getGameState) {
  const { playerNum, cardName } = event.payload;
  return { action: 'logCardDiscarded', gameId: event.gameId, data: { playerNum, cardName } };
}

const EVENT_HANDLERS = {
  RoundStarted: handleRoundStarted,
  FigureDefeated: handleFigureDefeated,
  VpAwarded: handleVpAwarded,
  GameEnded: handleGameEnded,
  CombatDeclared: handleCombatDeclared,
  DcActivated: handleDcActivated,
  DcEndedActivation: handleDcEndedActivation,
  DcActionPerformed: handleDcActionPerformed,
  MovementStarted: handleMovementStarted,
  FigureMoved: handleFigureMoved,
  MovementCompleted: handleMovementCompleted,
  CombatDiceRolled: handleCombatDiceRolled,
  CombatSurgeSpent: handleCombatSurgeSpent,
  CombatResolved: handleCombatResolved,
  ConditionApplied: handleConditionApplied,
  ConditionRemoved: handleConditionRemoved,
  PowerTokenGained: handlePowerTokenGained,
  PowerTokenSpent: handlePowerTokenSpent,
  PhaseGateOpened: handlePhaseGateOpened,
  PhaseGatePlayerReady: handlePhaseGatePlayerReady,
  PhaseGateCleared: handlePhaseGateCleared,
  CardPlayed: handleCardPlayed,
  CardDiscarded: handleCardDiscarded,
};

export function handleEvent(event, client, getGameState) {
  const handler = EVENT_HANDLERS[event.type];
  if (!handler) return null;
  return handler(event, client, getGameState);
}

export function getHandledEventTypes() {
  return Object.keys(EVENT_HANDLERS);
}
