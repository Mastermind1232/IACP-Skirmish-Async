import { createDomainEvent } from './events.js';

/**
 * Translate a state diff (from event-log.js computeDiff) into domain events.
 * @param {string} handlerKey - the button/select prefix that triggered the change
 * @param {{ set: object, deleted: string[] } | null} diff
 * @param {{ gameId: string, playerId: string, before: object, after: object, correlationId?: string }} context
 * @returns {object[]} array of domain events
 */
export function translateDiffToEvents(handlerKey, diff, context) {
  const events = [];
  if (!diff) return events;
  const { set, deleted } = diff;
  const { gameId, playerId, before, after } = context;
  const meta = { correlationId: context.correlationId || null };

  // ── Phase changes ──
  if (set?.phase && set.phase !== before?.phase) {
    const phaseEvents = translatePhaseChange(before, after, gameId, playerId, meta);
    events.push(...phaseEvents);
  }

  // ── Phase gate ──
  if (set?.phaseGate && !before?.phaseGate) {
    events.push(createDomainEvent('PhaseGateOpened', gameId, playerId,
      { gateType: set.phaseGate.phase }, meta));
  }
  if (set?.phaseGate && before?.phaseGate) {
    if (set.phaseGate.p1Ready && !before.phaseGate.p1Ready) {
      events.push(createDomainEvent('PhaseGatePlayerReady', gameId, playerId,
        { playerNum: 1 }, meta));
    }
    if (set.phaseGate.p2Ready && !before.phaseGate.p2Ready) {
      events.push(createDomainEvent('PhaseGatePlayerReady', gameId, playerId,
        { playerNum: 2 }, meta));
    }
  }
  if (deleted?.includes('phaseGate') || (before?.phaseGate && !after?.phaseGate)) {
    events.push(createDomainEvent('PhaseGateCleared', gameId, playerId,
      { gateType: before.phaseGate?.phase || 'unknown' }, meta));
  }

  // ── Combat ──
  if (set?.pendingCombat && !before?.pendingCombat) {
    events.push(createDomainEvent('CombatDeclared', gameId, playerId, {
      attackerMsgId: set.pendingCombat.attackerMsgId,
      defenderMsgId: set.pendingCombat.defenderMsgId,
      attackerPlayerNum: set.pendingCombat.attackerPlayerNum,
    }, meta));
  }
  if (set?.pendingCombat && before?.pendingCombat) {
    if (set.pendingCombat.p1Ready && !before.pendingCombat.p1Ready) {
      events.push(createDomainEvent('CombatPlayerReady', gameId, playerId,
        { playerNum: 1 }, meta));
    }
    if (set.pendingCombat.p2Ready && !before.pendingCombat.p2Ready) {
      events.push(createDomainEvent('CombatPlayerReady', gameId, playerId,
        { playerNum: 2 }, meta));
    }
    if (set.pendingCombat.attackRoll && !before.pendingCombat.attackRoll) {
      events.push(createDomainEvent('CombatDiceRolled', gameId, playerId,
        { side: 'attack', dice: set.pendingCombat.attackRoll }, meta));
    }
    if (set.pendingCombat.defenseRoll && !before.pendingCombat.defenseRoll) {
      events.push(createDomainEvent('CombatDiceRolled', gameId, playerId,
        { side: 'defense', dice: set.pendingCombat.defenseRoll }, meta));
    }
  }
  if ((deleted?.includes('pendingCombat') || (before?.pendingCombat && !after?.pendingCombat))) {
    events.push(createDomainEvent('CombatResolved', gameId, playerId,
      { damageDealt: 0, defeated: false }, meta));
  }

  // ── Movement ──
  if (set?.moveInProgress) {
    for (const [figKey, moveData] of Object.entries(set.moveInProgress)) {
      if (!before?.moveInProgress?.[figKey]) {
        events.push(createDomainEvent('MovementStarted', gameId, playerId,
          { figureKey: figKey, movementPoints: moveData.movementPoints || moveData.remaining || 0 }, meta));
      }
    }
  }
  if (before?.moveInProgress) {
    for (const figKey of Object.keys(before.moveInProgress)) {
      if (!after?.moveInProgress?.[figKey]) {
        events.push(createDomainEvent('MovementCompleted', gameId, playerId,
          { figureKey: figKey }, meta));
      }
    }
  }

  // ── Figure positions (FigureMoved) ──
  if (set?.figurePositions && before?.figurePositions) {
    for (const playerNum of [1, 2]) {
      const beforePos = before.figurePositions?.[playerNum] || {};
      const afterPos = after?.figurePositions?.[playerNum] || {};
      for (const [figKey, newCoord] of Object.entries(afterPos)) {
        const oldCoord = beforePos[figKey];
        if (oldCoord && oldCoord !== newCoord) {
          events.push(createDomainEvent('FigureMoved', gameId, playerId,
            { figureKey: figKey, fromCoord: oldCoord, toCoord: newCoord }, meta));
        }
      }
    }
  }

  // ── Figure defeated (removed from positions) ──
  if (set?.figurePositions && before?.figurePositions) {
    for (const playerNum of [1, 2]) {
      const beforePos = before.figurePositions?.[playerNum] || {};
      const afterPos = after?.figurePositions?.[playerNum] || {};
      for (const figKey of Object.keys(beforePos)) {
        if (!(figKey in afterPos)) {
          events.push(createDomainEvent('FigureDefeated', gameId, playerId,
            { figureKey: figKey, dcName: figKey.split('-')[0], playerNum }, meta));
        }
      }
    }
  }

  // ── VP changes ──
  for (const playerNum of [1, 2]) {
    const vpKey = `player${playerNum}VP`;
    if (set?.[vpKey] && before?.[vpKey]) {
      const diff_vp = (set[vpKey].total || 0) - (before[vpKey].total || 0);
      if (diff_vp > 0) {
        events.push(createDomainEvent('VpAwarded', gameId, playerId,
          { playerNum, amount: diff_vp, reason: 'unknown' }, meta));
      }
    }
  }

  // ── Conditions ──
  if (set?.figureConditions && before?.figureConditions) {
    for (const [figKey, newConds] of Object.entries(after?.figureConditions || {})) {
      const oldConds = before.figureConditions?.[figKey] || [];
      for (const c of newConds) {
        if (!oldConds.includes(c)) {
          events.push(createDomainEvent('ConditionApplied', gameId, playerId,
            { figureKey: figKey, condition: c }, meta));
        }
      }
    }
  }

  // ── Activation turn passed ──
  if (set?.currentActivationTurnPlayerId &&
      set.currentActivationTurnPlayerId !== before?.currentActivationTurnPlayerId) {
    const newNum = set.currentActivationTurnPlayerId === after?.player1Id ? 1 : 2;
    events.push(createDomainEvent('ActivationTurnPassed', gameId, playerId,
      { newActivePlayerNum: newNum }, meta));
  }

  return events;
}

function translatePhaseChange(before, after, gameId, playerId, meta) {
  const events = [];
  const newPhase = after?.phase;

  switch (newPhase) {
    case 'initiative':
      events.push(createDomainEvent('MapSelected', gameId, playerId,
        { mapId: after.selectedMap || 'unknown' }, meta));
      break;
    case 'zone_selection':
      events.push(createDomainEvent('InitiativeDetermined', gameId, playerId,
        { initiativePlayerNum: after.initiativePlayerNum || 0 }, meta));
      break;
    case 'deployment':
      events.push(createDomainEvent('DeploymentZoneChosen', gameId, playerId,
        { playerNum: 0, zoneId: 'unknown' }, meta));
      break;
    case 'ended':
      events.push(createDomainEvent('GameEnded', gameId, playerId,
        { winnerId: after.winnerId || null }, meta));
      break;
  }

  return events;
}
