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

  // ── Health changes ──
  if (set?.dcHealthState && before?.dcHealthState) {
    for (const [figKey, newHp] of Object.entries(after?.dcHealthState || {})) {
      const oldHp = before.dcHealthState?.[figKey];
      if (oldHp != null && newHp != null && oldHp !== newHp) {
        if (newHp < oldHp) {
          events.push(createDomainEvent('FigureDamaged', gameId, playerId,
            { figureKey: figKey, amount: oldHp - newHp }, meta));
        } else {
          events.push(createDomainEvent('FigureHealed', gameId, playerId,
            { figureKey: figKey, amount: newHp - oldHp, maxHp: newHp }, meta));
        }
      }
    }
  }

  // ── Condition removed ──
  if (set?.figureConditions && before?.figureConditions) {
    for (const [figKey, oldConds] of Object.entries(before.figureConditions || {})) {
      const newConds = after?.figureConditions?.[figKey] || [];
      for (const c of oldConds) {
        if (!newConds.includes(c)) {
          events.push(createDomainEvent('ConditionRemoved', gameId, playerId,
            { figureKey: figKey, condition: c }, meta));
        }
      }
    }
  }

  // ── Power token changes ──
  if (set?.figurePowerTokens || (before?.figurePowerTokens && after?.figurePowerTokens)) {
    const allFigKeys = new Set([
      ...Object.keys(before?.figurePowerTokens || {}),
      ...Object.keys(after?.figurePowerTokens || {}),
    ]);
    for (const figKey of allFigKeys) {
      const oldTokens = [...(before?.figurePowerTokens?.[figKey] || [])];
      const newTokens = [...(after?.figurePowerTokens?.[figKey] || [])];
      // Count tokens by type
      const oldCounts = {};
      for (const t of oldTokens) oldCounts[t] = (oldCounts[t] || 0) + 1;
      const newCounts = {};
      for (const t of newTokens) newCounts[t] = (newCounts[t] || 0) + 1;
      const allTypes = new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)]);
      for (const tokenType of allTypes) {
        const oldCount = oldCounts[tokenType] || 0;
        const newCount = newCounts[tokenType] || 0;
        for (let i = 0; i < newCount - oldCount; i++) {
          events.push(createDomainEvent('PowerTokenGained', gameId, playerId,
            { figureKey: figKey, tokenType }, meta));
        }
        for (let i = 0; i < oldCount - newCount; i++) {
          events.push(createDomainEvent('PowerTokenSpent', gameId, playerId,
            { figureKey: figKey, tokenType }, meta));
        }
      }
    }
  }

  // ── DC activation ──
  if (set?.dcActionsData && before?.dcActionsData) {
    for (const [msgId, data] of Object.entries(after?.dcActionsData || {})) {
      if (!before.dcActionsData?.[msgId]) {
        events.push(createDomainEvent('DcActivated', gameId, playerId,
          { msgId, totalActions: data?.total || 2 }, meta));
      }
    }
  } else if (set?.dcActionsData && !before?.dcActionsData) {
    for (const [msgId, data] of Object.entries(set.dcActionsData || {})) {
      events.push(createDomainEvent('DcActivated', gameId, playerId,
        { msgId, totalActions: data?.total || 2 }, meta));
    }
  }

  // ── DC action performed ──
  if (set?.dcActionsData && before?.dcActionsData) {
    for (const [msgId, data] of Object.entries(after?.dcActionsData || {})) {
      const oldData = before.dcActionsData?.[msgId];
      if (oldData && data?.remaining != null && oldData.remaining != null) {
        const diff_actions = oldData.remaining - data.remaining;
        if (diff_actions > 0 && data.remaining >= 0) {
          events.push(createDomainEvent('DcActionPerformed', gameId, playerId,
            { msgId, actionCost: diff_actions }, meta));
        }
      }
    }
  }

  // ── DC ended activation ──
  if (before?.dcActionsData) {
    for (const [msgId, oldData] of Object.entries(before.dcActionsData)) {
      const newData = after?.dcActionsData?.[msgId];
      if (oldData?.remaining > 0 && newData?.remaining === 0) {
        events.push(createDomainEvent('DcEndedActivation', gameId, playerId,
          { msgId }, meta));
      }
    }
  }

  // ── Round transitions ──
  if (set?.currentRound && set.currentRound !== before?.currentRound) {
    events.push(createDomainEvent('RoundStarted', gameId, playerId,
      { roundNumber: set.currentRound }, meta));
  }
  if (set?.roundPhase) {
    if (set.roundPhase === 'activation' && before?.roundPhase === 'start_of_round') {
      events.push(createDomainEvent('ActivationPhaseStarted', gameId, playerId,
        { activePlayerId: after?.currentActivationTurnPlayerId || null }, meta));
    }
    if (set.roundPhase === 'end_of_round' && before?.roundPhase !== 'end_of_round') {
      events.push(createDomainEvent('EndOfRoundStarted', gameId, playerId, {}, meta));
    }
  }
  if (before?.roundPhase && !after?.roundPhase) {
    events.push(createDomainEvent('RoundEnded', gameId, playerId,
      { roundNumber: before.currentRound || 0 }, meta));
  }

  // ── Combat surge spent ──
  if (set?.pendingCombat && before?.pendingCombat) {
    const oldSurge = before.pendingCombat.surgeRemaining;
    const newSurge = after?.pendingCombat?.surgeRemaining;
    if (oldSurge != null && newSurge != null && newSurge < oldSurge) {
      // Detect which surge was spent from surgesSpent array
      const oldSpent = before.pendingCombat.surgesSpent || [];
      const newSpent = after?.pendingCombat?.surgesSpent || [];
      for (const key of newSpent) {
        if (!oldSpent.includes(key) || newSpent.filter(k => k === key).length > oldSpent.filter(k => k === key).length) {
          events.push(createDomainEvent('CombatSurgeSpent', gameId, playerId,
            { surgeKey: key, cost: 1 }, meta));
          break; // One surge per handler call
        }
      }
    }
  }

  // ── Combat reroll ──
  if (set?.pendingCombat && before?.pendingCombat) {
    for (const side of ['attack', 'defense']) {
      const rollKey = side === 'attack' ? 'attackRoll' : 'defenseRoll';
      const oldRoll = before.pendingCombat[rollKey];
      const newRoll = after?.pendingCombat?.[rollKey];
      if (oldRoll && newRoll && oldRoll.length === newRoll.length) {
        for (let i = 0; i < oldRoll.length; i++) {
          if (JSON.stringify(oldRoll[i]?.face) !== JSON.stringify(newRoll[i]?.face)) {
            events.push(createDomainEvent('CombatRerollPerformed', gameId, playerId,
              { side, dieIndex: i, newFace: newRoll[i].face }, meta));
          }
        }
      }
    }
  }

  // ── Figure deployed (new position, not moved) ──
  if (set?.figurePositions && before?.figurePositions) {
    for (const playerNum of [1, 2]) {
      const beforePos = before.figurePositions?.[playerNum] || {};
      const afterPos = after?.figurePositions?.[playerNum] || {};
      for (const [figKey, coord] of Object.entries(afterPos)) {
        if (!(figKey in beforePos)) {
          events.push(createDomainEvent('FigureDeployed', gameId, playerId,
            { figureKey: figKey, dcName: figKey.split('-').slice(0, -2).join('-'), playerNum, coord }, meta));
        }
      }
    }
  }

  // ── Hand changes ──
  for (const playerNum of [1, 2]) {
    const handKey = `player${playerNum}Hand`;
    const discardKey = `player${playerNum}Discard`;
    const oldHand = before?.[handKey] || [];
    const newHand = after?.[handKey] || [];
    const oldDiscard = before?.[discardKey] || [];
    const newDiscard = after?.[discardKey] || [];

    if (set?.[handKey] || set?.[discardKey]) {
      // Cards that left the hand and entered discard
      for (const card of oldHand) {
        if (!newHand.includes(card) && newDiscard.includes(card) && !oldDiscard.includes(card)) {
          events.push(createDomainEvent('CardPlayed', gameId, playerId,
            { playerNum, cardName: card }, meta));
        }
      }
      // Cards drawn (appeared in hand, not from discard)
      const drawnCards = newHand.filter(c => !oldHand.includes(c));
      if (drawnCards.length > 0 && !set?.[discardKey]) {
        events.push(createDomainEvent('CardsDrawn', gameId, playerId,
          { playerNum, count: drawnCards.length }, meta));
      }
    }
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
